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

async function observePathWorkers(page, holdMessages = false, stagnationLimitMs = 50, captureProgressPaths = true) {
  await page.evaluate(({ hold, limit, capturePaths }) => {
    const createWorker = window.pathWorkerHarness?.createWorker || window.createPathOptimizerWorker;
    const harness = window.pathWorkerHarness = { createWorker, holdMessages: hold, messages: [], workers: [], stagnationLimitMs: limit };
    window.createPathOptimizerWorker = () => {
      const worker = createWorker(), target = new EventTarget();
      const record = { pending: [], posted: [], terminated: false,
        deliverNext() {
          if (!this.terminated && this.pending.length) {
            target.dispatchEvent(new MessageEvent("message", { data: this.pending.shift() }));
          }
        } };
      harness.workers.push(record);
      target.postMessage = message => {
        record.posted.push(structuredClone(message));
        worker.postMessage(message.type === "start" ? { ...message, stagnationLimitMs: harness.stagnationLimitMs } : message);
      };
      target.terminate = () => { record.terminated = true; worker.terminate(); };
      worker.addEventListener("message", event => {
        const message = event.data;
        // Large previews are validated in-browser instead of retaining hundreds of full routes.
        if (!capturePaths && message.type === "progress" && Array.isArray(message.path)) {
          const route = message.path;
          harness.messages.push({ ...message, path: undefined, unitLinks: undefined, pathSummary: {
            length: route.length, complete: !StitchModel.validateRoute(route, cellsForSelectedColor()),
            validationError: StitchModel.validateRoute(route, cellsForSelectedColor(), false),
            metrics: StitchModel.metrics(route, cutThreshold, true),
            unitLinksValid: message.unitLinks?.length === route.length && message.unitLinks.every((unit, i) =>
              typeof unit === "boolean" && (!unit || (i > 0 && StitchModel.distance(route[i - 1], route[i]) === 1)))
          } });
        } else harness.messages.push(message);
        if (record.terminated) return;
        if (harness.holdMessages && ["progress", "complete"].includes(event.data.type)) record.pending.push(event.data);
        else target.dispatchEvent(new MessageEvent("message", { data: event.data }));
      });
      worker.addEventListener("error", event => target.dispatchEvent(new ErrorEvent("error", { message: event.message })));
      return target;
    };
  }, { hold: holdMessages, limit: stagnationLimitMs, capturePaths: captureProgressPaths });
}

async function deliverWorkerMessages(page, workerIndex, throughIndex) {
  return page.evaluate(({ workerIndex, throughIndex }) => {
    const worker = pathWorkerHarness.workers[workerIndex], displayed = [];
    for (let i = 0; i <= throughIndex; i++) {
      worker.deliverNext();
      flushAdvancedPathSnapshot();
      displayed.push({ snapshot: activePathOptimizerSnapshot, path: currentPath(), best: bestPathsByDmc[selectedDmc] });
    }
    return displayed;
  }, { workerIndex, throughIndex });
}

function compareObjective(a, b) {
  return Math.abs(a.score - b.score) > 1e-8 ? a.score - b.score : a.cuts - b.cuts || a.distance - b.distance;
}

function assertBlockResult(snapshot, cells, constraints = {}, threshold = 12, requireUnitCoverage = true) {
  const model = require("../src/stitch-model.js");
  assert.equal(snapshot.method, "block-optimization");
  assert.equal(snapshot.type, "complete");
  assert.equal(snapshot.stage, "complete");
  assert.equal(snapshot.progress, 100);
  assert.equal(snapshot.blocks.prepared, snapshot.blocks.total);
  assert.ok(snapshot.blocks.total > 0);
  assert.equal(model.validateRoute(snapshot.path, cells), "");
  assert.ok(model.satisfiesConstraints(snapshot.path, constraints));
  assert.equal(snapshot.unitLinks.length, snapshot.path.length);
  const prefixLength = constraints.lockedPrefix?.length || (constraints.start ? 1 : 0);
  const minimumUnitLinks = snapshot.path.length - prefixLength - snapshot.blocks.total;
  const unitLinkCount = snapshot.unitLinks.filter(Boolean).length;
  if (requireUnitCoverage) assert.ok(unitLinkCount >= minimumUnitLinks, "Constructed block interiors retain their unit links");
  snapshot.path.forEach((point, i) => {
    assert.equal(typeof snapshot.unitLinks[i], "boolean");
    if (snapshot.unitLinks[i]) {
      assert.ok(i > 0);
      assert.equal(model.distance(snapshot.path[i - 1], point), 1, `Non-unit link at diagonal ${i}`);
    }
  });
  const metrics = model.metrics(snapshot.path, threshold, true);
  for (const name of ["score", "cuts", "distance"]) assert.ok(Math.abs(snapshot.metrics[name] - metrics[name]) < 1e-7, `Accurate ${name}`);

  // Check direction choices independently when the result was constructed by the optimizer.
  if (requireUnitCoverage && snapshot.path.length <= 14) {
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

function assertSearchSnapshots(snapshots, cells, threshold = 12) {
  const model = require("../src/stitch-model.js");
  assert.ok(snapshots.some(snapshot => snapshot.stage === "configuration"), "Configuration feedback is emitted");
  assert.ok(snapshots.some(snapshot => snapshot.stage === "search"), "Search feedback is emitted");
  let best = null;
  for (const snapshot of snapshots) {
    assert.equal(snapshot.method, "block-optimization");
    assert.ok(["construction", "configuration", "search", "complete"].includes(snapshot.stage));
    assert.ok(Number.isFinite(snapshot.elapsedMs) && snapshot.elapsedMs >= 0);
    assert.ok(Number.isFinite(snapshot.lastImprovementMs) && snapshot.lastImprovementMs >= 0);
    assert.ok(snapshot.stagnationLimitMs > 0);
    if (snapshot.path && !model.validateRoute(snapshot.path, cells)) {
      const metrics = model.metrics(snapshot.path, threshold, true);
      if (best) assert.ok(compareObjective(metrics, best) <= 1e-7, "Published complete paths never worsen");
      best = metrics;
    }
    if (snapshot.pathSummary) {
      assert.equal(snapshot.pathSummary.validationError, "");
      assert.equal(snapshot.pathSummary.unitLinksValid, true);
      if (snapshot.pathSummary.complete) {
        assert.equal(snapshot.pathSummary.length, cells.length * 2);
        if (best) assert.ok(compareObjective(snapshot.pathSummary.metrics, best) <= 1e-7, "Large published complete paths never worsen");
        best = snapshot.pathSummary.metrics;
      }
    }
    if (snapshot.stage === "search") {
      assert.equal(snapshot.blocks.prepared, snapshot.blocks.total);
      assert.ok(Number.isFinite(snapshot.attempts) && snapshot.attempts >= 0);
      assert.ok(Number.isFinite(snapshot.improvements) && snapshot.improvements >= 0);
    }
  }
  assert.ok(best, "A complete best path is published");
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
    assert.ok(plannerScripts.has("/src/block-optimizer-worker.js"));
    assert.ok(await planner.evaluate(() => {
      const sources = [...document.scripts].map(script => new URL(script.src || location.href).pathname);
      return sources.indexOf("/src/block-optimizer-worker.js") > sources.indexOf("/src/orthogonal-path-worker.js");
    }), "The active optimizer is loaded after its orthogonal construction dependency");
    assert.equal(await planner.evaluate(() => typeof createPathOptimizerApi().optimizePath), "function");
    assert.equal([...plannerScripts].some(src => /(?:path-optimizer|diagonal-optimizer)(?:-worker)?\.js$/.test(src)), false, "The legacy engines are not loaded");
    assert.equal(await planner.locator("#optimizedPathButton").innerText(), "Optimiser les blocs");
    assert.match(await planner.locator('label[for="pathStagnationLimit"]').innerText(), /Sans amelioration\s*\(couleur\)/);
    assert.equal(await planner.locator("#pathStagnationLimit").inputValue(), "60000");
    assert.equal(await planner.locator("#pathStagnationLimit option").evaluateAll(options => Math.min(...options.map(option => Number(option.value)))), 30000);
    for (const id of ["pathAlgorithmZoneLimit", "pathAlgorithmZoneInitial", "pathAlgorithmZoneScore"]) {
      assert.equal(await planner.locator(`#${id}`).isVisible(), false, `${id} is a hidden legacy field`);
    }
    await planner.locator("#patternJsonFile").setInputFiles({ name: "fixture.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    await planner.waitForFunction(() => loadedPattern?.project.name === "Verification");
    assert.equal(await planner.locator("#pathStagnationLimit").isVisible(), true);
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
    assert.equal(await planner.evaluate(() => pathWorkerHarness.workers[0].posted[0].stagnationLimitMs), 60000,
      "Only the test worker transport shortens inactivity; the UI retains its production setting");
    assert.equal(await planner.evaluate(() => pathAlgorithmRunning && activePathOptimizerSnapshot === null), true);
    assert.equal(await planner.locator("#restoreBestPathButton").isEnabled(), false);
    await planner.locator("#stopPathAlgorithmButton").click();
    assert.deepEqual(await planner.evaluate(() => [pathAlgorithmRunning, batchRunning, batchPlan.pending.length, batchPlan.results.length]), [false, false, 2, 0]);
    assert.deepEqual(await planner.evaluate(() => currentPath()), constrainedPath, "Stopping before any result does not erase or reorient the old path");
    assert.deepEqual(await planner.evaluate(() => bestPathsByDmc["310"]), constrainedPath);

    await planner.locator("#batchOptimizeButton").click();
    await planner.waitForFunction(() => pathWorkerHarness.workers[1]?.pending.some(message => message.type === "complete"));
    const searchIndex = await planner.evaluate(() => pathWorkerHarness.workers[1].pending.findIndex(message => message.stage === "search"));
    assert.ok(searchIndex >= 0);
    const retainedDisplays = await deliverWorkerMessages(planner, 1, searchIndex);
    assert.ok(retainedDisplays.every(display => display.path.length === constrainedPath.length),
      "Preparation never replaces an available complete route with a partial construction");
    const retainedBest = await planner.evaluate(() => currentPath());
    assert.ok(await planner.evaluate(old => comparePathPerformance(currentPath(), old) <= 0, constrainedPath));
    await planner.locator("#stopPathAlgorithmButton").click();
    assert.deepEqual(await planner.evaluate(() => currentPath()), retainedBest, "Stop retains the best complete path received so far");
    assert.deepEqual(await planner.evaluate(() => bestPathsByDmc["310"]), retainedBest);

    // A fresh pattern has no complete incumbent to hide the partial construction.
    const freshPattern = structuredClone(data.pattern);
    freshPattern.project.name = "Fresh constrained construction";
    await planner.locator('[data-step="load"]').click();
    await planner.locator("#patternJsonFile").setInputFiles({ name: "fresh.pattern.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(freshPattern)) });
    await planner.waitForFunction(() => loadedPattern?.project.name === "Fresh constrained construction");
    await planner.locator("#cutThresholdInput").fill("12");
    await planner.locator("#cutThresholdInput").dispatchEvent("change");
    await planner.evaluate(({ prefix, constraints }) => {
      pathsByDmc["310"] = prefix;
      constraintsByDmc["310"] = constraints;
      batchPlan = { pending: ["310", "321"], results: [] };
      renderPathTool();
    }, { prefix: lockedDiagonals, constraints: savedConstraints });
    await planner.locator("#batchOptimizeButton").click();
    await planner.waitForFunction(() => pathWorkerHarness.workers[2]?.pending.some(message => message.type === "complete"));
    const partialIndex = await planner.evaluate(() => pathWorkerHarness.workers[2].pending.findIndex(message =>
      message.stage === "construction" && Array.isArray(message.path) && message.path.length < cellsForSelectedColor().length * 2));
    assert.ok(partialIndex >= 0, "Construction publishes a partial route when no complete incumbent exists");
    await deliverWorkerMessages(planner, 2, partialIndex);
    const partialPath = await planner.evaluate(() => currentPath());
    assert.deepEqual(partialPath.slice(0, lockedDiagonals.length), lockedDiagonals);
    assert.ok(partialPath.length < constrainedPath.length);
    await planner.locator("#stopPathAlgorithmButton").click();
    assert.deepEqual(await planner.evaluate(() => currentPath()), partialPath, "Stopping retains the partial route without generic reorientation");
    assert.equal(await planner.evaluate(() => StitchModel.validateRoute(currentPath(), cellsForSelectedColor(), false)), "");
    assert.equal(await planner.evaluate(() => bestPathsByDmc["310"]?.length || 0), 0, "A partial route is not saved as a complete best");
    assert.deepEqual(await planner.evaluate(() => [batchPlan.pending.length, batchPlan.results.length]), [2, 0]);
    await planner.evaluate(() => plannerSaveQueue);
    await planner.reload();
    await planner.waitForFunction(() => !document.querySelector("main").inert);
    assert.deepEqual(await planner.evaluate(() => pathsByDmc["310"]), partialPath);
    assert.equal(await planner.evaluate(() => bestPathsByDmc["310"]?.length || 0), 0);
    assert.deepEqual(await planner.evaluate(() => constraintsByDmc["310"]), savedConstraints);
    await planner.locator('[data-step="paths"]').click();
    await observePathWorkers(planner);
    await planner.locator("#batchOptimizeButton").click();
    await planner.waitForFunction(() => !pathAlgorithmRunning && !batchRunning && batchPlan.results.length === 2);
    const batchSnapshots = await planner.evaluate(() => pathWorkerHarness.messages.filter(message => message.type === "complete"));
    assert.equal(batchSnapshots.length, 2);
    for (let i = 0; i < data.paths.length; i++) {
      const dmc = data.paths[i].dmc;
      assertBlockResult(batchSnapshots[i], data.paths[i].points, dmc === "310" ? savedConstraints : {});
      assertSearchSnapshots(await planner.evaluate(runId => pathWorkerHarness.messages.filter(message => message.runId === runId), batchSnapshots[i].runId), data.paths[i].points);
      assert.deepEqual(await planner.evaluate(dmc => pathsByDmc[dmc], dmc), batchSnapshots[i].path);
    }
    assert.deepEqual(await planner.evaluate(() => pathsByDmc["310"].slice(0, 2)), lockedDiagonals);
    assert.deepEqual(await planner.evaluate(() => constraintsByDmc["310"]), savedConstraints);
    assert.equal(await planner.evaluate(() => buildPathExport().schemaVersion), 2);
    assert.equal(await planner.evaluate(() => buildPathExport().stitchUnit), "diagonal");
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
    const alternatingBefore = await planner.evaluate(() => currentPath());
    await observePathWorkers(planner, true);
    await planner.locator("#optimizedPathButton").click();
    await planner.waitForFunction(() => pathWorkerHarness.messages.some(message => message.type === "complete"));
    const configurationIndex = await planner.evaluate(() => pathWorkerHarness.workers[0].pending.findIndex(message => message.stage === "configuration"));
    assert.ok(configurationIndex >= 0);
    const configurationDisplays = await deliverWorkerMessages(planner, 0, configurationIndex);
    const configuration = configurationDisplays.at(-1).snapshot;
    assert.equal(configuration.stage, "configuration");
    assert.equal(await planner.locator("#pathAlgorithmLastImprovement").isVisible(), true);
    assert.notEqual(await planner.locator("#pathAlgorithmLastImprovement").innerText(), "-");
    assert.match(await planner.locator("#pathAlgorithmClockLabel").innerText(), /couleur/i);
    assert.ok((await planner.locator("#pathAlgorithmDistance").innerText()).includes(configuration.phase));
    const lastSearchIndex = await planner.evaluate(() => pathWorkerHarness.workers[0].pending.findLastIndex(message => message.stage === "search"));
    assert.ok(lastSearchIndex >= 0);
    const searchDisplays = await deliverWorkerMessages(planner, 0, lastSearchIndex);
    const search = searchDisplays.at(-1).snapshot;
    assert.equal(search.stage, "search");
    assert.equal(search.blocks.prepared, search.blocks.total);
    assert.equal(await planner.locator("#pathAlgorithmZonesDone").innerText(), `${search.blocks.prepared} / ${search.blocks.total}`);
    assert.equal(await planner.locator("#pathAlgorithmAttempts").innerText(), String(search.attempts));
    assert.equal(await planner.locator("#pathAlgorithmRestarts").innerText(), String(search.restarts));
    assert.equal(await planner.locator("#pathAlgorithmImprovements").innerText(), String(search.improvements));
    assert.equal(await planner.locator("#pathAlgorithmLastImprovement").isVisible(), true);
    assert.equal(await planner.locator("#pathAlgorithmProgress").getAttribute("aria-label"), "Sans amelioration (couleur)");
    assert.equal(await planner.locator("#pathAlgorithmLastImprovement").innerText(),
      await planner.evaluate(snapshot => `${formatAlgorithmTime(snapshot.lastImprovementMs)} / ${formatAlgorithmTime(snapshot.stagnationLimitMs)}`, search));
    assert.ok((await planner.locator("#pathAlgorithmDistance").innerText()).includes(search.phase));
    let previousDisplay = alternatingBefore;
    for (const display of [...configurationDisplays, ...searchDisplays]) {
      assert.equal(require("../src/stitch-model.js").validateRoute(display.path, alternating.paths[0].points), "");
      assert.ok(compareObjective(require("../src/stitch-model.js").metrics(display.path, 12, true),
        require("../src/stitch-model.js").metrics(previousDisplay, 12, true)) <= 1e-7, "The displayed route never worsens during preparation or search");
      previousDisplay = display.path;
    }
    assert.ok(await planner.evaluate(old => comparePathPerformance(currentPath(), old) < 0, alternatingBefore), "The alternating fixture receives a better complete path");
    const stoppedBest = await planner.evaluate(() => currentPath());
    const stoppedBaseline = await planner.evaluate(() => pathOptimizationBaselinesByDmc[selectedDmc]);
    await planner.locator("#stopPathAlgorithmButton").click();
    assert.deepEqual(await planner.evaluate(() => currentPath()), stoppedBest);
    assert.deepEqual(await planner.evaluate(() => bestPathsByDmc[selectedDmc]), stoppedBest);
    assert.equal(await planner.evaluate(() => pathWorkerHarness.workers[0].terminated), true);
    await planner.evaluate(() => plannerSaveQueue);
    await planner.reload();
    await planner.waitForFunction(() => !document.querySelector("main").inert);
    await planner.locator('[data-step="paths"]').click();
    assert.deepEqual(await planner.evaluate(() => currentPath()), stoppedBest, "Stopping persists the latest complete best");
    assert.deepEqual(await planner.evaluate(() => bestPathsByDmc[selectedDmc]), stoppedBest);
    assert.equal(await planner.evaluate(() => pathOptimizationBaselinesByDmc[selectedDmc]), stoppedBaseline);
    await observePathWorkers(planner);
    await planner.locator("#optimizedPathButton").click();
    await planner.waitForFunction(() => !pathAlgorithmRunning && pathWorkerHarness.messages.some(message => message.type === "complete"));
    const groupSnapshots = await planner.evaluate(() => pathWorkerHarness.messages);
    const completedGroups = groupSnapshots.find(message => message.type === "complete");
    assertBlockResult(completedGroups, alternating.paths[0].points);
    assertSearchSnapshots(groupSnapshots, alternating.paths[0].points);
    assert.equal(completedGroups.blocks.total, 2);
    assert.equal(completedGroups.reason, "exhaustive", "Small block sets finish once every order is tested");
    assert.ok(completedGroups.attempts > 0, "Block-order or entry/exit candidates were evaluated");
    completedGroups.path.forEach((point, i, route) => {
      const sameGroup = i > 0 && (point.x < 20) === (route[i - 1].x < 20);
      assert.equal(completedGroups.unitLinks[i], sameGroup, "Every link inside an orthogonal group is constrained to one unit");
    });
    assert.deepEqual(await planner.evaluate(() => currentPath()), completedGroups.path);
    assert.equal(await planner.locator("#pathAlgorithmZonesDone").innerText(), "2 / 2");
    assert.notEqual(await planner.locator("#pathAlgorithmTotalScore").innerText(), "-");
    assert.equal(await planner.locator("#pathAlgorithmAttempts").innerText(), String(completedGroups.attempts));
    assert.equal(await planner.locator("#pathAlgorithmRestarts").innerText(), String(completedGroups.restarts));
    assert.equal(await planner.locator("#pathAlgorithmImprovements").innerText(), String(completedGroups.improvements));
    assert.equal(await planner.locator("#pathAlgorithmProgress").getAttribute("value"), "100");
    assert.match(await planner.locator("#pathAlgorithmDistance").innerText(), /Optimisation.*termin/i);
    const completedFeedback = await planner.locator("#pathAlgorithmFeedback").innerText();
    await planner.screenshot({ path: path.join(screenshotDirectory, "planner-block-complete.png"), fullPage: true });
    await planner.setViewportSize({ width: 390, height: 844 });
    assert.equal(await planner.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await planner.locator("#pathAlgorithmFeedback").innerText(), completedFeedback, "Completed statistics survive mobile resize");
    await planner.screenshot({ path: path.join(screenshotDirectory, "planner-block-complete-mobile.png"), fullPage: true });
    await planner.setViewportSize({ width: 1600, height: 1000 });
    await planner.locator('[data-dmc="321"]').click();
    await planner.locator('[data-dmc="310"]').click();
    assert.equal(await planner.locator("#pathAlgorithmFeedback").innerText(), completedFeedback, "Completed statistics survive returning to the color");
    assert.ok(await planner.evaluate(() => pathPerformanceMetrics(currentPath()).cutTravel > 0));
    assert.ok(await planner.evaluate(() => {
      const measure = pathPerformanceMetrics;
      try {
        pathPerformanceMetrics = value => value;
        const metric = (score, cuts, distance, zoneReturns) => ({ score, realisticScore: score, cuts, distance, zoneReturns });
        return comparePathPerformance(metric(10, 4, 20, 9), metric(11, 0, 5, 0)) < 0
          && comparePathPerformance(metric(10, 1, 20, 9), metric(10, 2, 5, 0)) < 0
          && comparePathPerformance(metric(10 + 1e-9, 1, 20, 9), metric(10, 2, 5, 0)) < 0
          && comparePathPerformance(metric(10, 1, 5, 9), metric(10, 1, 6, 0)) < 0
          && comparePathPerformance(metric(10, 1, 5, 9), metric(10, 1, 5, 0)) === 0;
      } finally { pathPerformanceMetrics = measure; }
    }), "The UI objective orders score, cuts and distance, with no zone-return priority");
    assert.ok(await planner.evaluate(() => {
      const old = { pattern: loadedPattern, pathSchemaVersion: 2, pathObjectiveVersion: 2,
        pathsByDmc, bestPathsByDmc, constraintsByDmc, selectedDmc,
        pathOptimizationBaselinesByDmc: { [selectedDmc]: 123 }, batchPlan: { pending: [selectedDmc], results: [] } };
      const migrated = migratePlannerState(old);
      return migrated.pathsByDmc === old.pathsByDmc && migrated.bestPathsByDmc === old.bestPathsByDmc
        && migrated.constraintsByDmc === old.constraintsByDmc && migrated.selectedDmc === old.selectedDmc
        && Object.keys(migrated.pathOptimizationBaselinesByDmc).length === 0 && migrated.batchPlan.pending.length === 0;
    }), "Changing the objective retains paths and constraints, resetting only obsolete search statistics");

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
    assertBlockResult(newConstruction, betterOldRoute.paths[0].points, {}, 12, false);
    assertSearchSnapshots(await planner.evaluate(() => pathWorkerHarness.messages), betterOldRoute.paths[0].points);
    assert.ok(await planner.evaluate(old => comparePathPerformance(currentPath(), old) <= 0, previousBest), "A run never discards a better saved incumbent");
    assert.deepEqual(await planner.evaluate(() => currentPath()), newConstruction.path);
    const optimizedBest = await planner.evaluate(() => bestPathsByDmc[selectedDmc]);
    assert.deepEqual(optimizedBest, newConstruction.path);
    await planner.evaluate(() => plannerSaveQueue);
    await planner.reload();
    await planner.waitForFunction(() => !document.querySelector("main").inert);
    await planner.locator('[data-step="paths"]').click();
    assert.deepEqual(await planner.evaluate(() => currentPath()), newConstruction.path);
    assert.deepEqual(await planner.evaluate(() => bestPathsByDmc[selectedDmc]), optimizedBest);
    const worsePath = await planner.evaluate(() => {
      const best = currentPath();
      for (let i = 0; i < best.length; i++) {
        const candidate = best.map((point, index) => ({ ...point, direction: index === i ? -point.direction : point.direction }));
        if (!StitchModel.validateRoute(candidate, cellsForSelectedColor()) && comparePathPerformance(candidate, best) > 0) return candidate;
      }
      return null;
    });
    assert.ok(worsePath, "The restore fixture has a valid, worse orientation");
    await planner.evaluate(route => {
      pathsByDmc[selectedDmc] = route;
      batchPlan = { pending: ["321"], results: [{ dmc: selectedDmc, score: pathPerformanceMetrics(route).score }] };
      renderPathTool();
      savePathPlannerState();
    }, worsePath);
    await planner.evaluate(() => plannerSaveQueue);
    await planner.reload();
    await planner.waitForFunction(() => !document.querySelector("main").inert);
    await planner.locator('[data-step="paths"]').click();
    assert.deepEqual(await planner.evaluate(() => currentPath()), worsePath);
    assert.deepEqual(await planner.evaluate(() => bestPathsByDmc[selectedDmc]), optimizedBest);
    assert.equal(await planner.locator("#restoreBestPathButton").isEnabled(), true);
    await planner.locator("#restoreBestPathButton").click();
    assert.deepEqual(await planner.evaluate(() => currentPath()), optimizedBest);
    assert.deepEqual(await planner.evaluate(() => batchPlan.results), [], "Restoring a best path invalidates the stale batch score");
    assert.deepEqual(await planner.evaluate(() => batchPlan.pending), ["321", "310"]);
    assert.equal(await planner.evaluate(() => StitchModel.validateRoute(currentPath(), cellsForSelectedColor())), "");
    await planner.evaluate(() => plannerSaveQueue);
    await planner.reload();
    await planner.waitForFunction(() => !document.querySelector("main").inert);
    assert.deepEqual(await planner.evaluate(() => currentPath()), optimizedBest, "The explicitly restored path is persisted");
    await planner.locator('[data-step="paths"]').click();
    await planner.screenshot({ path: path.join(screenshotDirectory, "planner-restored-best.png"), fullPage: true });

    await planner.evaluate(() => {
      batchPlan = { pending: ["321"], results: [{ dmc: "310", score: pathPerformanceMetrics(currentPath()).score }] };
      renderPathTool();
    });
    await observePathWorkers(planner, true);
    await planner.locator("#optimizedPathButton").click();
    await planner.waitForFunction(() => pathWorkerHarness.messages.some(message => message.type === "complete"));
    const regenerationIndex = await planner.evaluate(() => pathWorkerHarness.workers[0].pending.findIndex(message => message.stage === "search"));
    assert.ok(regenerationIndex >= 0);
    await deliverWorkerMessages(planner, 0, regenerationIndex);
    await planner.locator("#stopPathAlgorithmButton").click();
    assert.deepEqual(await planner.evaluate(() => batchPlan.pending), ["321", "310"]);
    assert.deepEqual(await planner.evaluate(() => batchPlan.results), [], "An interrupted regeneration invalidates its previous batch completion");
    await planner.evaluate(() => { pathWorkerHarness.holdMessages = false; });
    await planner.locator("#batchOptimizeButton").click();
    await planner.waitForFunction(() => !pathAlgorithmRunning && !batchRunning && batchPlan.results.length === 2);
    assert.equal(await planner.evaluate(() => areAllColorPathsComplete(loadedPattern, pathsByDmc)), true,
      "Batch resume rebuilds the manually interrupted color as well as the other pending color");

    const timed = structuredClone(data);
    timed.project.name = timed.pattern.project.name = "Global inactivity";
    timed.paths[0].points = Array.from({ length: 9 }, (_, i) => ({ x: i * 3, y: 10 }));
    timed.pattern.grid.cells = timed.pattern.grid.cells.map(cell => {
      const dmc = timed.paths.find(route => route.points.some(point => point.x === cell.x && point.y === cell.y))?.dmc;
      return { ...cell, dmc: dmc || null, empty: !dmc, symbol: dmc === "310" ? "A" : dmc ? "B" : null };
    });
    await planner.locator('[data-step="load"]').click();
    await planner.locator("#patternJsonFile").setInputFiles({ name: "timed.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(timed)) });
    await planner.waitForFunction(() => loadedPattern?.project.name === "Global inactivity");
    await observePathWorkers(planner);
    await planner.locator("#optimizedPathButton").click();
    await planner.waitForFunction(() => !pathAlgorithmRunning && pathWorkerHarness.messages.some(message => message.type === "complete"));
    const timedSnapshots = await planner.evaluate(() => pathWorkerHarness.messages);
    const timedResult = timedSnapshots.find(message => message.type === "complete");
    assertBlockResult(timedResult, timed.paths[0].points);
    assertSearchSnapshots(timedSnapshots, timed.paths[0].points);
    assert.equal(timedResult.blocks.total, 9);
    assert.equal(timedResult.reason, "inactivity");
    assert.equal(timedResult.stagnationLimitMs, 50);
    assert.ok(timedResult.lastImprovementMs >= timedResult.stagnationLimitMs, "The global color timer expires after the final improvement");
    assert.ok(timedResult.elapsedMs >= timedResult.lastImprovementMs);
    assert.deepEqual(await planner.evaluate(() => currentPath()), timedResult.path);
    assert.equal(await planner.locator("#pathStagnationLimit").inputValue(), "60000");

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
      await observePathWorkers(planner, false, 300, false);
      const largeInput = await planner.evaluate(() => ({ cells: cellsForSelectedColor(), constraints: constraintsByDmc[selectedDmc] || {}, cutThreshold }));
      await planner.locator("#optimizedPathButton").click();
      await planner.waitForFunction(() => !pathAlgorithmRunning, null, { timeout: 120000 });
      const largeSnapshot = await planner.evaluate(() => pathWorkerHarness.messages.find(message => message.type === "complete"));
      assert.ok(largeSnapshot, await planner.locator("#pathAlgorithmDistance").innerText());
      assertBlockResult(largeSnapshot, largeInput.cells, largeInput.constraints, largeInput.cutThreshold, false);
      assertSearchSnapshots(await planner.evaluate(() => pathWorkerHarness.messages), largeInput.cells, largeInput.cutThreshold);
      assert.equal(largeSnapshot.reason, "inactivity");
      assert.equal(largeSnapshot.stagnationLimitMs, 300);
      assert.ok(largeSnapshot.lastImprovementMs >= largeSnapshot.stagnationLimitMs);
      assert.deepEqual(await planner.evaluate(() => currentPath()), largeSnapshot.path);
      assert.notEqual(await planner.locator("#pathAlgorithmZonesDone").innerText(), "-");
      assert.equal(await planner.locator("#pathAlgorithmLastImprovement").isVisible(), true);
      assert.notEqual(await planner.locator("#pathAlgorithmTotalScore").innerText(), "-");
      const result = await planner.evaluate(() => ({ count: currentPath().length,
        error: StitchModel.validateRoute(currentPath(), cellsForSelectedColor()), metrics: pathPerformanceMetrics(currentPath()),
        feedback: pathAlgorithmDistance.textContent }));
      assert.equal(result.count, largeInput.cells.length * 2);
      assert.equal(result.error, "");
      assert.doesNotMatch(result.feedback, /Erreur/);
      await planner.evaluate(() => plannerSaveQueue);
      console.log(`large block optimizer passed (${result.count} diagonals, ${largeSnapshot.blocks.total} blocks, ${largeSnapshot.attempts} attempts, score ${result.metrics.score.toFixed(2)})`);
    }
    assert.deepEqual(errors, []);
    console.log("browser workflows passed: resume, undo/redo, session, batch, constraints, group editing, source overlay, responsive layout");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
