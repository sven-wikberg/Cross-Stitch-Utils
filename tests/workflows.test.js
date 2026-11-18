const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const screenshotDirectory = path.join(root, "exports", "verification");

function fixture() {
  const colors = [{ dmc: "310", hex: "#111111", symbol: "A" }, { dmc: "321", hex: "#cd2444", symbol: "B" }];
  const paths = [
    { dmc: "310", points: [0, 1, 2, 20, 21, 22].map(x => ({ x, y: 0 })) },
    { dmc: "321", points: [{ x: 1, y: 5 }, { x: 2, y: 5 }] }
  ];
  const cells = Array.from({ length: 40 * 30 }, (_, i) => {
    const x = i % 40, y = Math.floor(i / 40);
    const color = paths.find(route => route.points.some(p => p.x === x && p.y === y))?.dmc;
    return { x, y, dmc: color || null, empty: !color, symbol: color === "310" ? "A" : color ? "B" : null };
  });
  return { kind: "cross-stitch-paths", schemaVersion: 1, project: { name: "Verification" }, settings: { cutThreshold: 12 },
    pattern: { kind: "cross-stitch-pattern", schemaVersion: 1, project: { name: "Verification" }, colors, grid: { width: 40, height: 30, cells } }, paths };
}

async function observePathWorkers(page, holdMessages = false) {
  await page.evaluate(hold => {
    const createWorker = window.createPathOptimizerWorker;
    const harness = window.pathWorkerHarness = { holdMessages: hold, messages: [], workers: [] };
    window.createPathOptimizerWorker = () => {
      const worker = createWorker(), target = new EventTarget();
      const record = { pending: [], terminated: false,
        deliverNext() {
          if (!this.terminated && this.pending.length) {
            target.dispatchEvent(new MessageEvent("message", { data: this.pending.shift() }));
          }
        } };
      harness.workers.push(record);
      target.postMessage = message => worker.postMessage(message);
      target.terminate = () => { record.terminated = true; worker.terminate(); };
      worker.addEventListener("message", event => {
        harness.messages.push(event.data);
        if (record.terminated) return;
        if (harness.holdMessages && ["progress", "complete"].includes(event.data.type)) record.pending.push(event.data);
        else target.dispatchEvent(new MessageEvent("message", { data: event.data }));
      });
      worker.addEventListener("error", event => target.dispatchEvent(new ErrorEvent("error", { message: event.message })));
      return target;
    };
  }, holdMessages);
}

function assertOrthogonalResult(snapshot, cells, constraints = {}, threshold = 12) {
  const model = require("../src/stitch-model.js");
  assert.equal(snapshot.method, "orthogonal-backtracking");
  assert.equal(snapshot.type, "complete");
  assert.equal(snapshot.progress, 100);
  assert.equal(snapshot.zone.completed, snapshot.zone.total);
  assert.equal(model.validateRoute(snapshot.path, cells), "");
  assert.ok(model.satisfiesConstraints(snapshot.path, constraints));
  assert.equal(snapshot.unitLinks.length, snapshot.path.length);
  const prefixLength = constraints.lockedPrefix?.length || (constraints.start ? 1 : 0);
  const minimumUnitLinks = snapshot.path.length - prefixLength - snapshot.zone.total;
  const unitLinkCount = snapshot.unitLinks.filter(Boolean).length;
  // Resuming an open lower diagonal also constrains the first newly generated link.
  assert.ok(unitLinkCount >= minimumUnitLinks && unitLinkCount <= minimumUnitLinks + 1);
  snapshot.path.forEach((point, i) => {
    if (snapshot.unitLinks[i]) assert.equal(model.distance(snapshot.path[i - 1], point), 1, `Non-unit link at diagonal ${i}`);
  });
  assert.ok(Math.abs(snapshot.metrics.score - model.metrics(snapshot.path, threshold, true).score) < 1e-7);

  // Exhaustively check small routes, including inter-group links, independently of the worker's DP.
  if (snapshot.path.length <= 14) {
    let minimum = Infinity;
    const visit = (i, previous, score) => {
      if (score >= minimum) return;
      if (i === snapshot.path.length) { minimum = score; return; }
      const fixed = constraints.lockedPrefix?.[i] || (i === 0 ? constraints.start : null);
      for (const direction of fixed ? [fixed.direction] : [1, -1]) {
        const point = { ...snapshot.path[i], direction };
        if (snapshot.unitLinks[i] && model.distance(previous, point) !== 1) continue;
        visit(i + 1, point, score + model.cost(previous, point, threshold, true));
      }
    };
    visit(0, null, 0);
    assert.ok(Math.abs(snapshot.metrics.score - minimum) < 1e-7, "Directions minimize the score across all links while retaining unit links");
  }
}

async function run() {
  await fs.mkdir(screenshotDirectory, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      const filename = path.resolve(root, `.${decodeURIComponent(new URL(req.url, "http://localhost").pathname)}`);
      if (!filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
      if (filename.endsWith("builtin-progress.js")) { res.setHeader("Content-Type", "text/javascript"); res.end("window.BUILTIN_STITCH_PROGRESS = null;"); return; }
      const content = await fs.readFile(filename);
      res.setHeader("Content-Type", filename.endsWith(".html") ? "text/html" : filename.endsWith(".js") ? "text/javascript" : "text/css");
      res.end(content);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try { browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || "msedge" }); }
  catch (error) { server.close(); throw error; }
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  context.on("page", page => { page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept()); });
  const remoteFiles = new Map();
  const history = [];
  let version = 0;
  let writes = 0;
  async function githubMock(route) {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (status, data) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (url.pathname.endsWith("/commits")) return reply(200, history.map(entry => ({ sha: entry.sha, commit: { author: { date: entry.data.savedAt } } })));
    const key = url.pathname.split("/contents/")[1];
    const file = url.searchParams.get("ref")?.startsWith("test-") && key === "data/progress-state.json"
      ? history.find(entry => entry.sha === url.searchParams.get("ref")) : remoteFiles.get(key);
    if (request.method() === "PUT") {
      const body = request.postDataJSON();
      if ((file?.sha || null) !== (body.sha || null)) return reply(409, { message: "Conflict" });
      const saved = { sha: `test-${++version}`, data: JSON.parse(Buffer.from(body.content, "base64").toString("utf8")) };
      remoteFiles.set(key, saved); writes++;
      if (key === "data/progress-state.json") history.unshift(structuredClone(saved));
      return reply(200, { content: { sha: saved.sha } });
    }
    return file ? reply(200, { sha: file.sha, encoding: "base64", content: Buffer.from(JSON.stringify(file.data)).toString("base64") }) : reply(404, {});
  }
  await context.route("https://api.github.com/**", githubMock);
  try {
    const data = fixture();
    const page = await context.newPage();
    await page.goto(`${origin}/stitch-progress.html`);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    await page.locator("#pathsJsonFile").setInputFiles({ name: "fixture.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(() => activeProgressStep === "stitch");
    await page.locator("#nextStitchButton").click();
    assert.equal(await page.evaluate(() => stitchedCountForDmc("310")), 1);
    await page.locator("#undoActionButton").click();
    assert.equal(await page.evaluate(() => stitchedCountForDmc("310")), 0);
    await page.locator("#redoActionButton").click();
    await page.locator("body").click({ position: { x: 1595, y: 5 } });
    await page.keyboard.down("Space");
    await page.keyboard.down("Space");
    await page.keyboard.up("Space");
    assert.equal(await page.evaluate(() => stitchedCountForDmc("310")), 2, "Holding Space only adds one stitch");
    await page.locator("#markUntilToggle").check();
    const point = await page.evaluate(() => {
      const rect = stitchCanvas.getBoundingClientRect();
      const size = (stitchCanvas.width - GRID_RULER_SIZE) / loadedPaths.pattern.grid.width;
      return { x: rect.x + GRID_RULER_SIZE + size * 2.5, y: rect.y + GRID_RULER_SIZE + size * 0.5 };
    });
    await page.mouse.click(point.x, point.y);
    assert.equal(await page.evaluate(() => stitchedCountForDmc("310")), 6);
    assert.match(await page.locator("#nextCutText").innerText(), /Couper le fil/);
    await page.locator("#sessionModeButton").click();
    await page.locator("#zoomInButton").click();
    await page.evaluate(() => localSaveQueue);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert && activeProgressStep === "stitch");
    assert.deepEqual(await page.evaluate(() => [stitchedCountForDmc("310"), sessionMode, stitchZoom, undoActions.length]), [6, true, 1.25, 3]);
    const active = await page.evaluate(() => progressStore.read("active"));
    assert.ok(!active.pathsFile && active.patternId.length === 64);
    await page.screenshot({ path: path.join(screenshotDirectory, "stitch-session.png"), fullPage: true });

    await page.evaluate(() => localStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, "test-only-token"));
    await page.locator("#writeBuiltinProgressButton").click();
    await page.waitForFunction(() => !githubSyncInProgress);
    assert.match(await page.locator("#syncStateText").innerText(), /Synchronise le/);
    assert.equal(writes, 2, "First sync writes a pattern and a small progress state");
    const otherContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await otherContext.route("https://api.github.com/**", githubMock);
    const other = await otherContext.newPage();
    other.on("dialog", dialog => dialog.accept());
    other.on("pageerror", error => errors.push(error.message));
    await other.goto(`${origin}/stitch-progress.html`);
    await other.waitForFunction(() => !document.querySelector("main").inert);
    await other.evaluate(() => localStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, "test-only-token"));
    await other.locator("#loadBuiltinProgressButton").click();
    await other.waitForFunction(() => activeProgressStep === "stitch" && !githubSyncInProgress);
    await other.evaluate(() => localSaveQueue);
    assert.equal(await other.evaluate(() => stitchedCountForDmc("310")), 6);
    assert.match(await other.locator("#syncStateText").innerText(), /Synchronise le/);
    await page.locator("#nextStitchButton").click();
    await page.locator("#writeBuiltinProgressButton").click();
    await page.waitForFunction(() => !githubSyncInProgress);
    const beforeConflict = writes;
    await other.locator("#nextStitchButton").click();
    await other.locator("#writeBuiltinProgressButton").click();
    await other.waitForFunction(() => !githubSyncInProgress && !syncConflictPanel.classList.contains("hidden"));
    assert.equal(writes, beforeConflict, "A stale PC must not overwrite the newer save");
    await other.locator("#useRemoteButton").click();
    await other.waitForFunction(() => !githubSyncInProgress && syncConflictPanel.classList.contains("hidden"));
    await other.locator("#historyButton").click();
    await other.locator("#historyPanel").waitFor({ state: "visible" });
    await other.locator("#historySelect").selectOption(history[history.length - 1].sha);
    await other.locator("#restoreHistoryButton").click();
    await other.waitForFunction(() => stitchedCountForDmc("310") === 6);
    await other.evaluate(() => localSaveQueue);
    assert.match(await other.locator("#syncStateText").innerText(), /Modifications locales/);
    await otherContext.close();

    const migrationContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await migrationContext.route("https://api.github.com/**", route => route.abort());
    const migrated = await migrationContext.newPage();
    migrated.on("pageerror", error => errors.push(error.message));
    await migrated.goto(`${origin}/stitch-progress.html`);
    await migrated.waitForFunction(() => !document.querySelector("main").inert);
    const legacyState = await migrated.evaluate(async paths => {
      const patternId = await progressStore.identify(paths);
      const state = { kind: "cross-stitch-progress-state", schemaVersion: 2, patternId,
        stitchedByDmc: { "310": 3, "321": 1 }, selectedDmc: "321", zoom: 1.25,
        undoActions: [{ dmc: "321", before: 0, after: 1 }], redoActions: [] };
      await progressStore.write(`pattern:${patternId}`, paths);
      await progressStore.write("active", state);
      return state;
    }, data);
    await migrated.reload();
    await migrated.waitForFunction(() => !document.querySelector("main").inert && activeProgressStep === "stitch");
    await migrated.evaluate(() => localSaveQueue);
    assert.deepEqual(await migrated.evaluate(() => [stitchedByDmc, selectedDmc, stitchZoom, undoActions[0]]),
      [{ "310": 6, "321": 2 }, "321", 1.25, { dmc: "321", before: 0, after: 2 }]);
    assert.deepEqual(await migrated.evaluate(id => progressStore.read(`migration-backup:${id}`), legacyState.patternId), legacyState);
    assert.deepEqual(await migrated.evaluate(id => progressStore.read(`pattern:${id}`), legacyState.patternId), data);
    assert.equal(await migrated.evaluate(async () => (await progressStore.read("active")).schemaVersion), 3);
    await migrated.locator("#nextStitchButton").click();
    assert.equal(await migrated.locator("#selectedPartialCrosses").innerText(), "1");
    assert.equal(await migrated.locator("#selectedCompleteCrosses").innerText(), "1");
    const partialSave = await migrated.evaluate(() => buildProgressSave());
    await migrated.evaluate(() => localSaveQueue);
    await migrated.reload();
    await migrated.waitForFunction(() => !document.querySelector("main").inert && activeProgressStep === "stitch");
    assert.equal(await migrated.evaluate(() => stitchedCountForDmc("321")), 3);
    assert.equal(await migrated.locator("#selectedPartialCrosses").innerText(), "1");
    assert.deepEqual(await migrated.evaluate(() => buildProgressSave().stitchedByDmc), partialSave.stitchedByDmc);
    await migrationContext.close();

    const planner = await context.newPage();
    const plannerScripts = new Set();
    planner.on("request", request => { if (request.resourceType() === "script") plannerScripts.add(new URL(request.url()).pathname); });
    await planner.goto(`${origin}/plan-paths.html`);
    await planner.waitForFunction(() => !document.querySelector("main").inert);
    assert.ok(plannerScripts.has("/src/orthogonal-path-worker.js"));
    assert.equal([...plannerScripts].some(src => /(?:path-optimizer|diagonal-optimizer)(?:-worker)?\.js$/.test(src)), false, "The legacy engines are not loaded");
    assert.deepEqual(await planner.evaluate(() => Object.keys(createPathOptimizerApi()).sort()),
      ["buildPath", "buildSequence", "orientUnitPath", "orthogonalComponents", "satisfiesConstraints"]);
    assert.equal(await planner.locator("#optimizedPathButton").innerText(), "Parcours par retours");
    for (const id of ["pathStagnationLimit", "pathAlgorithmZoneLimit", "pathAlgorithmZoneInitial", "pathAlgorithmZoneScore", "pathAlgorithmLastImprovement"]) {
      assert.equal(await planner.locator(`#${id}`).isVisible(), false, `${id} is a hidden legacy field`);
    }
    await planner.locator("#patternJsonFile").setInputFiles({ name: "fixture.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    assert.equal(await planner.locator("#cutThresholdInput").inputValue(), "12");
    await planner.locator("#pathEditMode").selectOption("start");
    await planner.locator("#patternCanvas").click({ position: { x: 35, y: 35 } });
    await planner.locator("#pathEditMode").selectOption("cut");
    await planner.locator("#patternCanvas").click({ position: { x: 53, y: 35 } });
    assert.equal(await planner.evaluate(() => constraintsByDmc["310"].forcedCuts.length), 1);
    await planner.locator("#lockedPrefixCount").fill("2");
    await planner.locator("#lockedPrefixCount").dispatchEvent("change");
    const lockedDiagonals = await planner.evaluate(() => currentPath().slice(0, 2));
    const constrainedPath = await planner.evaluate(() => currentPath());
    const savedConstraints = await planner.evaluate(() => constraintsByDmc["310"]);
    await observePathWorkers(planner, true);
    await planner.locator("#batchOptimizeButton").click();
    await planner.waitForFunction(() => pathWorkerHarness.messages.some(message => message.type === "complete"));
    assert.equal(await planner.evaluate(() => pathAlgorithmRunning && activePathOptimizerSnapshot === null), true);
    assert.equal(await planner.locator("#restoreBestPathButton").isEnabled(), false);
    await planner.locator("#stopPathAlgorithmButton").click();
    assert.deepEqual(await planner.evaluate(() => [pathAlgorithmRunning, batchRunning, batchPlan.pending.length, batchPlan.results.length]), [false, false, 2, 0]);
    assert.deepEqual(await planner.evaluate(() => currentPath()), constrainedPath, "Stopping before any result does not erase or reorient the old path");
    assert.deepEqual(await planner.evaluate(() => bestPathsByDmc["310"]), constrainedPath);

    await planner.locator("#batchOptimizeButton").click();
    await planner.waitForFunction(() => pathWorkerHarness.workers[1]?.pending.some(message => message.type === "complete"));
    await planner.evaluate(() => pathWorkerHarness.workers[1].deliverNext());
    await planner.waitForFunction(() => activePathOptimizerSnapshot?.method === "orthogonal-backtracking");
    const partialPath = await planner.evaluate(() => currentPath());
    assert.deepEqual(partialPath, lockedDiagonals, "The initial construction snapshot contains the locked partial route");
    await planner.locator("#stopPathAlgorithmButton").click();
    assert.deepEqual(await planner.evaluate(() => currentPath()), partialPath, "Stopping retains the partial route without generic reorientation");
    assert.equal(await planner.evaluate(() => StitchModel.validateRoute(currentPath(), cellsForSelectedColor(), false)), "");
    assert.deepEqual(await planner.evaluate(() => bestPathsByDmc["310"]), constrainedPath);
    assert.deepEqual(await planner.evaluate(() => [batchPlan.pending.length, batchPlan.results.length]), [2, 0]);
    await planner.evaluate(() => plannerSaveQueue);
    await planner.reload();
    await planner.waitForFunction(() => !document.querySelector("main").inert);
    assert.deepEqual(await planner.evaluate(() => pathsByDmc["310"]), partialPath);
    assert.deepEqual(await planner.evaluate(() => bestPathsByDmc["310"]), constrainedPath);
    assert.deepEqual(await planner.evaluate(() => constraintsByDmc["310"]), savedConstraints);
    await planner.locator('[data-step="paths"]').click();
    await observePathWorkers(planner);
    await planner.locator("#batchOptimizeButton").click();
    await planner.waitForFunction(() => !pathAlgorithmRunning && !batchRunning && batchPlan.results.length === 2);
    const batchSnapshots = await planner.evaluate(() => pathWorkerHarness.messages.filter(message => message.type === "complete"));
    assert.equal(batchSnapshots.length, 2);
    for (let i = 0; i < data.paths.length; i++) {
      const dmc = data.paths[i].dmc;
      assertOrthogonalResult(batchSnapshots[i], data.paths[i].points, dmc === "310" ? savedConstraints : {});
      assert.deepEqual(await planner.evaluate(dmc => pathsByDmc[dmc], dmc), batchSnapshots[i].path);
    }
    assert.deepEqual(await planner.evaluate(() => pathsByDmc["310"].slice(0, 2)), lockedDiagonals);
    assert.deepEqual(await planner.evaluate(() => constraintsByDmc["310"]), savedConstraints);
    assert.equal(await planner.evaluate(() => buildPathExport().schemaVersion), 2);
    assert.equal(await planner.evaluate(() => StitchModel.validateRoute(currentPath(), cellsForSelectedColor())), "");
    assert.equal(await planner.evaluate(() => buildPathExport().settings.cutThreshold), 12);
    const exported = await planner.evaluate(() => buildPathExport());
    assert.doesNotThrow(() => require("../src/stitch-model.js").upgradePathsFile(exported));
    assert.deepEqual(exported.paths.find(route => route.dmc === "310").constraints, savedConstraints);
    assert.deepEqual(exported.paths.find(route => route.dmc === "310").forcedCuts.map(point => [point.x, point.y, point.diagonal]),
      savedConstraints.forcedCuts.map(point => [point.x, point.y, point.diagonal]));
    await planner.screenshot({ path: path.join(screenshotDirectory, "planner.png"), fullPage: true });

    const alternating = structuredClone(data);
    alternating.project.name = "Alternating zones";
    alternating.pattern.project.name = "Alternating zones";
    alternating.paths[0].points = [0, 3, 1, 4, 2, 5].map(i => data.paths[0].points[i]);
    await planner.locator('[data-step="load"]').click();
    await planner.locator("#patternJsonFile").setInputFiles({ name: "alternating.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(alternating)) });
    await planner.waitForFunction(() => loadedPattern?.project.name === "Alternating zones");
    assert.ok(await planner.evaluate(() => pathPerformanceMetrics(currentPath()).zoneReturns > 0));
    await planner.evaluate(() => { pathWorkerHarness.messages = []; });
    await planner.locator("#optimizedPathButton").click();
    await planner.waitForFunction(() => !pathAlgorithmRunning && pathWorkerHarness.messages.some(message => message.type === "complete"));
    const groupSnapshots = await planner.evaluate(() => pathWorkerHarness.messages);
    const completedGroups = groupSnapshots.find(message => message.type === "complete");
    assertOrthogonalResult(completedGroups, alternating.paths[0].points);
    assert.ok(groupSnapshots.some(snapshot => snapshot.type === "progress" && snapshot.stage === "zones"));
    assert.ok(groupSnapshots.every(snapshot => snapshot.method === "orthogonal-backtracking"));
    assert.ok(groupSnapshots.every(snapshot => snapshot.stagnationLimitMs === undefined && snapshot.zone.stagnationLimitMs === undefined));
    assert.ok(groupSnapshots.every((snapshot, i) => !i || snapshot.zone.completed >= groupSnapshots[i - 1].zone.completed));
    assert.equal(completedGroups.zone.completed, 2);
    assert.equal(completedGroups.diagnostics.groups, 2);
    assert.ok(completedGroups.restarts > 0, "Entry/exit candidate pairs were evaluated");
    completedGroups.path.forEach((point, i, route) => {
      const sameGroup = i > 0 && (point.x < 20) === (route[i - 1].x < 20);
      assert.equal(completedGroups.unitLinks[i], sameGroup, "Every link inside an orthogonal group is constrained to one unit");
    });
    assert.deepEqual(await planner.evaluate(() => currentPath()), completedGroups.path);
    assert.equal(await planner.locator("#pathAlgorithmZone").innerText(), "2 / 2");
    assert.equal(await planner.locator("#pathAlgorithmZonesDone").innerText(), "2 / 2");
    assert.notEqual(await planner.locator("#pathAlgorithmTotalScore").innerText(), "-");
    assert.equal(await planner.locator("#pathAlgorithmZoneCrosses").innerText(), "3");
    assert.equal(await planner.locator("#pathAlgorithmRestarts").innerText(), String(completedGroups.restarts));
    assert.equal(await planner.locator("#pathAlgorithmImprovements").innerText(), String(completedGroups.diagnostics.entryExitChanges));
    assert.equal(await planner.locator("#pathAlgorithmProgress").getAttribute("value"), "100");
    assert.match(await planner.locator("#pathAlgorithmDistance").innerText(), /Parcours par retours termine/);
    const completedFeedback = await planner.locator("#pathAlgorithmFeedback").innerText();
    await planner.screenshot({ path: path.join(screenshotDirectory, "planner-orthogonal-complete.png"), fullPage: true });
    await planner.setViewportSize({ width: 390, height: 844 });
    assert.equal(await planner.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await planner.locator("#pathAlgorithmFeedback").innerText(), completedFeedback, "Completed statistics survive mobile resize");
    await planner.screenshot({ path: path.join(screenshotDirectory, "planner-orthogonal-complete-mobile.png"), fullPage: true });
    await planner.setViewportSize({ width: 1600, height: 1000 });
    await planner.locator('[data-dmc="321"]').click();
    await planner.locator('[data-dmc="310"]').click();
    assert.equal(await planner.locator("#pathAlgorithmFeedback").innerText(), completedFeedback, "Completed statistics survive returning to the color");
    assert.equal(await planner.locator("#metricZoneReturns").innerText(), "0");
    assert.equal(await planner.evaluate(() => pathPerformanceMetrics(bestPathsByDmc[selectedDmc]).zoneReturns), 0);
    assert.ok(await planner.evaluate(() => pathPerformanceMetrics(currentPath()).cutTravel > 0));
    assert.ok(await planner.evaluate(() => {
      const old = { pattern: loadedPattern, pathSchemaVersion: 2, pathObjectiveVersion: 1,
        pathsByDmc, bestPathsByDmc, constraintsByDmc, selectedDmc,
        pathOptimizationBaselinesByDmc: { [selectedDmc]: 123 }, batchPlan: { pending: [selectedDmc], results: [] } };
      const migrated = migratePlannerState(old);
      return migrated.pathsByDmc === old.pathsByDmc && migrated.bestPathsByDmc === old.bestPathsByDmc
        && migrated.constraintsByDmc === old.constraintsByDmc && migrated.selectedDmc === old.selectedDmc
        && Object.keys(migrated.pathOptimizationBaselinesByDmc).length === 0 && migrated.batchPlan.pending.length === 0;
    }), "Changing the zone definition retains paths and constraints, resetting only obsolete search statistics");

    await planner.locator('[data-dmc="310"]').click();
    await planner.locator("#clearPathButton").click();
    assert.equal(await planner.locator("#pathAlgorithmZonesDone").innerText(), "-", "Editing clears obsolete construction statistics");
    assert.equal(await planner.locator("#pathAlgorithmRestarts").innerText(), "-");
    await planner.locator("#diagonalMode").selectOption("upper");
    const canvasCell = async x => planner.locator("#patternCanvas").click({ position: { x: 26 + (x + 0.5) * 18, y: 35 } });
    await canvasCell(2);
    assert.equal(await planner.evaluate(() => currentPath().length), 0, "An upper leg cannot precede its lower leg");
    await planner.locator("#diagonalMode").selectOption("lower");
    await planner.locator("#diagonalDirection").selectOption("1");
    await canvasCell(2); await canvasCell(1);
    await planner.locator("#diagonalMode").selectOption("upper");
    await canvasCell(2);
    assert.equal(await planner.evaluate(() => currentPath().length), 2, "A same-hole transition is refused in manual mode");
    await planner.locator("#diagonalDirection").selectOption("auto");
    await canvasCell(2);
    assert.equal(await planner.evaluate(() => currentPath().length), 3);
    assert.equal(await planner.evaluate(() => currentPath()[2].direction), -1);
    assert.equal(await planner.evaluate(() => StitchModel.validateRoute(currentPath(), cellsForSelectedColor(), false)), "");

    const betterOldRoute = structuredClone(data);
    betterOldRoute.project.name = betterOldRoute.pattern.project.name = "Restore a better saved route";
    betterOldRoute.paths[0].points = [{ x: 6, y: 0 }, { x: 7, y: 2 }, { x: 6, y: 5 }, { x: 5, y: 2 }, { x: 0, y: 1 }];
    betterOldRoute.pattern.grid.cells = betterOldRoute.pattern.grid.cells.map(cell => {
      const dmc = betterOldRoute.paths.find(route => route.points.some(point => point.x === cell.x && point.y === cell.y))?.dmc;
      return { ...cell, dmc: dmc || null, empty: !dmc, symbol: dmc === "310" ? "A" : dmc ? "B" : null };
    });
    await planner.locator('[data-step="load"]').click();
    await planner.locator("#patternJsonFile").setInputFiles({ name: "better-old.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(betterOldRoute)) });
    await planner.waitForFunction(() => loadedPattern?.project.name === "Restore a better saved route");
    const previousBest = await planner.evaluate(() => currentPath());
    await planner.evaluate(() => { pathWorkerHarness.messages = []; });
    await planner.locator("#optimizedPathButton").click();
    await planner.waitForFunction(() => !pathAlgorithmRunning && pathWorkerHarness.messages.some(message => message.type === "complete"));
    const newConstruction = await planner.evaluate(() => pathWorkerHarness.messages.find(message => message.type === "complete"));
    assertOrthogonalResult(newConstruction, betterOldRoute.paths[0].points);
    assert.ok(await planner.evaluate(old => comparePathPerformance(old, currentPath()) < 0, previousBest), "This fixture's old route is strictly better");
    assert.deepEqual(await planner.evaluate(() => currentPath()), newConstruction.path, "The newly constructed route is displayed even when it is not better");
    assert.deepEqual(await planner.evaluate(() => bestPathsByDmc[selectedDmc]), previousBest, "The better old route remains stored");
    await planner.evaluate(() => plannerSaveQueue);
    await planner.reload();
    await planner.waitForFunction(() => !document.querySelector("main").inert);
    await planner.locator('[data-step="paths"]').click();
    assert.deepEqual(await planner.evaluate(() => currentPath()), newConstruction.path);
    assert.deepEqual(await planner.evaluate(() => bestPathsByDmc[selectedDmc]), previousBest);
    assert.equal(await planner.locator("#restoreBestPathButton").isEnabled(), true);
    await planner.locator("#restoreBestPathButton").click();
    assert.deepEqual(await planner.evaluate(() => currentPath()), previousBest);
    assert.equal(await planner.evaluate(() => StitchModel.validateRoute(currentPath(), cellsForSelectedColor())), "");
    await planner.evaluate(() => plannerSaveQueue);
    await planner.reload();
    await planner.waitForFunction(() => !document.querySelector("main").inert);
    assert.deepEqual(await planner.evaluate(() => currentPath()), previousBest, "The explicitly restored path is persisted");
    await planner.locator('[data-step="paths"]').click();
    await planner.screenshot({ path: path.join(screenshotDirectory, "planner-restored-best.png"), fullPage: true });

    await planner.evaluate(() => {
      batchPlan = { pending: ["321"], results: [{ dmc: "310", score: pathPerformanceMetrics(currentPath()).score }] };
      renderPathTool();
    });
    await observePathWorkers(planner, true);
    await planner.locator("#optimizedPathButton").click();
    await planner.waitForFunction(() => pathWorkerHarness.messages.some(message => message.type === "complete"));
    await planner.evaluate(() => pathWorkerHarness.workers[0].deliverNext());
    await planner.waitForFunction(() => activePathOptimizerSnapshot?.method === "orthogonal-backtracking");
    await planner.locator("#stopPathAlgorithmButton").click();
    assert.deepEqual(await planner.evaluate(() => batchPlan.pending), ["321", "310"]);
    assert.deepEqual(await planner.evaluate(() => batchPlan.results), [], "An interrupted regeneration invalidates its previous batch completion");
    await planner.evaluate(() => { pathWorkerHarness.holdMessages = false; });
    await planner.locator("#batchOptimizeButton").click();
    await planner.waitForFunction(() => !pathAlgorithmRunning && !batchRunning && batchPlan.results.length === 2);
    assert.equal(await planner.evaluate(() => areAllColorPathsComplete(loadedPattern, pathsByDmc)), true,
      "Batch resume rebuilds the manually interrupted color as well as the other pending color");

    const importer = await context.newPage();
    await importer.goto(`${origin}/import-pattern.html`);
    await importer.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 120; canvas.height = 40;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#ee3344"; ctx.fillRect(0, 0, 120, 40);
      pattern = { ...defaultPattern, project: { name: "Source test" }, colors: [{ dmc: "321", hex: "#cc1122" }], partsExpected: 1,
        parts: [{ id: "test-part", name: "Part 1", startX: 0, startY: 0, width: 3, height: 1, imageDataUrl: canvas.toDataURL() }],
        grid: { width: 3, height: 1, cells: [0, 1, 2].map(x => ({ x, y: 0, partId: "test-part", sampleSignature: "#CC1122", sampleMean: "#CC1122", sampleSource: "image-slice", dmc: x === 0 ? null : "321", empty: x === 0, symbol: null })) },
        symbolGroups: [{ id: "group-1", signature: "#CC1122", sampleMean: "#CC1122", cellKeys: ["0,0", "1,0", "2,0"], cellCount: 3, dmc: "321", isEmpty: false }] };
      progress = { project: true, colors: true, dimensions: true, parts: true, grid: true, analysis: true, groups: true, assignments: true };
      activeStep = "assignments"; render();
    });
    await importer.locator("#groupEditor summary").click();
    await importer.locator("#splitCellGrid input").nth(1).check();
    await importer.locator("#splitGroupButton").click();
    await importer.locator("#assignmentPreviewWrap img").waitFor({ state: "visible" });
    assert.deepEqual(await importer.evaluate(() => pattern.symbolGroups.map(g => [g.cellCount, g.dmc])), [[2, "321"], [1, null]]);
    await importer.locator("#mergeTarget").selectOption("group-1");
    await importer.locator("#mergeGroupButton").click();
    assert.equal(await importer.evaluate(() => pattern.symbolGroups.length), 1);
    await importer.locator("#undoGroupEditButton").click();
    assert.equal(await importer.evaluate(() => pattern.symbolGroups.length), 2);
    await importer.locator('#assignmentChoices [data-dmc="321"]').click();
    await importer.locator("#applyAssignmentsButton").click();
    assert.equal(await importer.evaluate(() => pattern.grid.cells[0].empty), true, "An unrelated manual correction is retained");
    await importer.locator("#reviewSourceOpacity").fill("100");
    await importer.locator("#reviewSourceOpacity").dispatchEvent("input");
    await importer.waitForFunction(() => document.querySelector("#reviewSourceStatus").textContent === "");
    const pixel = await importer.evaluate(() => [...reviewPatternCanvas.getContext("2d").getImageData(5, 5, 1, 1).data]);
    assert.deepEqual(pixel.slice(0, 3), [238, 51, 68]);
    await importer.locator("#reviewZoom").fill("200");
    await importer.locator("#reviewZoom").dispatchEvent("input");
    assert.equal(await importer.evaluate(() => reviewPatternCanvas.width), 60);
    await importer.screenshot({ path: path.join(screenshotDirectory, "import-review.png"), fullPage: true });
    for (const screen of [page, planner, importer]) {
      await screen.setViewportSize({ width: 390, height: 844 });
      const overflow = await screen.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      await screen.screenshot({ path: path.join(screenshotDirectory, `mobile-${new URL(screen.url()).pathname.slice(1)}.png`), fullPage: true });
      if (overflow) console.log(await screen.evaluate(() => [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(el).position !== "absolute").slice(0, 12).map(el => [el.tagName, el.id, el.className, el.getBoundingClientRect().width])));
      assert.equal(overflow, false, `${screen.url()} overflows mobile viewport`);
    }
    if (process.env.REAL_PATTERN_TEST === "1") {
      const raw = (await fs.readFile(path.join(root, "data", "builtin-progress.js"), "utf8")).trim();
      const save = JSON.parse(raw.slice(raw.indexOf("=") + 1).trim().replace(/;$/, ""));
      const large = JSON.stringify(save.pathsFile);
      await planner.setViewportSize({ width: 1600, height: 1000 });
      await planner.locator('[data-step="load"]').click();
      await planner.locator("#patternJsonFile").setInputFiles({ name: "large.paths.json", mimeType: "application/json", buffer: Buffer.from(large) });
      await planner.waitForFunction(expected => loadedPattern?.grid.cells.length === expected, save.pathsFile.pattern.grid.cells.length);
      await planner.evaluate(() => plannerSaveQueue);
      assert.equal(await planner.evaluate(() => plannerSaveFailed), false);
      await planner.reload();
      await planner.waitForFunction(() => !document.querySelector("main").inert);
      assert.equal(await planner.evaluate(() => loadedPattern.grid.cells.length), save.pathsFile.pattern.grid.cells.length);
      const fileContext = await browser.newContext();
      const local = await fileContext.newPage();
      local.on("pageerror", error => errors.push(error.message));
      await local.goto(require("node:url").pathToFileURL(path.join(root, "stitch-progress.html")).href);
      await local.waitForFunction(() => !document.querySelector("main").inert);
      await local.locator("#pathsJsonFile").setInputFiles({ name: "large.paths.json", mimeType: "application/json", buffer: Buffer.from(large) });
      await local.waitForFunction(expected => loadedPaths?.pattern.grid.cells.length === expected, save.pathsFile.pattern.grid.cells.length);
      await local.evaluate(() => localSaveQueue);
      await local.reload();
      await local.waitForFunction(() => !document.querySelector("main").inert && activeProgressStep === "stitch");
      assert.equal(await local.evaluate(() => loadedPaths.pattern.grid.cells.length), save.pathsFile.pattern.grid.cells.length);
      await fileContext.close();
      console.log(`large real pattern restored through IndexedDB and file:// (${large.length} bytes)`);
      const route = save.pathsFile.paths.reduce((a, b) => a.points.length > b.points.length ? a : b);
      await planner.locator('[data-step="paths"]').click();
      await planner.evaluate(dmc => { selectedDmc = dmc; renderPathTool(); }, route.dmc);
      await observePathWorkers(planner);
      const largeInput = await planner.evaluate(() => ({ cells: cellsForSelectedColor(), constraints: constraintsByDmc[selectedDmc] || {}, cutThreshold }));
      await planner.locator("#optimizedPathButton").click();
      await planner.waitForFunction(() => !pathAlgorithmRunning, null, { timeout: 120000 });
      const largeSnapshot = await planner.evaluate(() => pathWorkerHarness.messages.find(message => message.type === "complete"));
      assert.ok(largeSnapshot, await planner.locator("#pathAlgorithmDistance").innerText());
      assertOrthogonalResult(largeSnapshot, largeInput.cells, largeInput.constraints, largeInput.cutThreshold);
      assert.deepEqual(await planner.evaluate(() => currentPath()), largeSnapshot.path);
      assert.notEqual(await planner.locator("#pathAlgorithmZone").innerText(), "-");
      assert.notEqual(await planner.locator("#pathAlgorithmTotalScore").innerText(), "-");
      const result = await planner.evaluate(() => ({ count: currentPath().length,
        error: StitchModel.validateRoute(currentPath(), cellsForSelectedColor()), metrics: pathPerformanceMetrics(currentPath()),
        feedback: pathAlgorithmDistance.textContent }));
      assert.equal(result.count, largeInput.cells.length * 2);
      assert.equal(result.error, "");
      assert.equal(result.metrics.zoneReturns, 0);
      assert.doesNotMatch(result.feedback, /Erreur/);
      await planner.evaluate(() => plannerSaveQueue);
      console.log(`large orthogonal builder passed (${result.count} diagonals, ${largeSnapshot.zone.completed} groups, ${largeSnapshot.restarts} candidate pairs, score ${result.metrics.score.toFixed(2)})`);
    }
    assert.deepEqual(errors, []);
    console.log("browser workflows passed: resume, undo/redo, session, batch, constraints, group editing, source overlay, responsive layout");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
