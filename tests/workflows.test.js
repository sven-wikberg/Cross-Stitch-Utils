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
    window.batchTestFactories ||= Object.fromEntries(["createAdaptivePathOptimizerWorker", "createPointsDiagonalWorker",
      "createSectionOptimizerWorker", "createSegmentOptimizerWorker", "createChainOptimizerWorker"].map(name => [name, window[name]]));
    for (const [name, create] of Object.entries(window.batchTestFactories)) {
      window[name] = () => {
        const worker = create(), post = worker.postMessage.bind(worker);
        worker.postMessage = message => post({ ...message, totalLimitMs: 100, stagnationLimitMs: limit });
        return worker;
      };
    }
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
  const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
  const orthogonalCount = createOrthogonalPathBuilder(model).orthogonalComponents(cells).length;
  if (requireUnitCoverage && !snapshot.relayImprovements && orthogonalCount === snapshot.blocks.total) {
    assert.ok(unitLinkCount >= minimumUnitLinks, "Purely orthogonal block interiors retain their unit links before relay edits");
  }
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
    assert.ok(["construction", "configuration", "search", "relay", "complete"].includes(snapshot.stage));
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
    await page.locator('#stitchColorLegend [data-dmc="310"]').click();
    await page.locator("#nextStitchButton").click();
    assert.equal(await page.evaluate(() => stitchedCountForDmc("310")), 1);
    await page.locator("#undoActionButton").click();
    assert.equal(await page.evaluate(() => stitchedCountForDmc("310")), 0);
    await page.locator("#redoActionButton").click();
    await page.locator("body").click({ position: { x: 1595, y: 5 } });
    await page.keyboard.press("Space");
    assert.equal(await page.evaluate(() => stitchedCountForDmc("310")), 2, "A brief Space press adds one diagonal");
    await page.keyboard.down("Space");
    await page.keyboard.down("Space");
    await page.keyboard.up("Space");
    assert.equal(await page.evaluate(() => stitchedCountForDmc("310")), 4, "Repeated Space keydowns keep advancing diagonals");
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => stitchedCountForDmc("310")), 4, "Releasing Space stops advancement");
    assert.equal(await page.evaluate(() => {
      for (const tag of ["input", "textarea", "select", "button", "a", "div"]) {
        const target = document.createElement(tag);
        if (tag === "div") target.contentEditable = "true";
        document.body.append(target);
        for (const repeat of [false, true]) target.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", repeat, bubbles: true, cancelable: true }));
        target.remove();
      }
      goToProgressStep("load");
      document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", repeat: true, bubbles: true, cancelable: true }));
      goToProgressStep("stitch");
      return stitchedCountForDmc("310");
    }), 4, "Typing, interactive controls and the loading step never trigger the shortcut");
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
    assert.deepEqual(await page.evaluate(() => [stitchedCountForDmc("310"), sessionMode, stitchZoom, undoActions.length]), [6, true, 1.25, 5]);
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
    await migrated.locator("body").click({ position: { x: 1595, y: 5 } });
    for (let i = 0; i < 6; i++) await migrated.keyboard.down("Space");
    await migrated.keyboard.up("Space");
    assert.deepEqual(await migrated.evaluate(() => [stitchedByDmc, selectedDmc]), [{ "310": 6, "321": 4 }, "321"],
      "Holding Space stops at the selected color's end without advancing another color");
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
    assert.equal(await planner.locator("#optimizedPathButton").innerText(), "Moteur 1 : blocs");
    assert.match(await planner.locator('label[for="pathStagnationLimit"]').innerText(), /Arret sans amelioration/);
    assert.equal(await planner.locator("#pathStagnationLimit").inputValue(), "60000");
    assert.equal(await planner.locator("#pathStagnationLimit option").evaluateAll(options => Math.min(...options.map(option => Number(option.value)))), 10000);
    for (const id of ["pathAlgorithmZoneLimit", "pathAlgorithmZoneInitial", "pathAlgorithmZoneScore"]) {
      assert.equal(await planner.locator(`#${id}`).count(), 0, `${id} is removed from the interface`);
    }
    await planner.locator("#patternJsonFile").setInputFiles({ name: "fixture.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    await planner.waitForFunction(() => loadedPattern?.project.name === "Verification");
    await planner.locator('#pathColorLegend [data-dmc="310"]').click();
    assert.equal(await planner.locator("#pathStagnationLimit").isVisible(), true);
    await planner.locator("#pathStagnationLimit").selectOption("10000");
    await planner.evaluate(() => plannerSaveQueue);
    await planner.reload();
    await planner.waitForFunction(() => !document.querySelector("main").inert && loadedPattern?.project.name === "Verification");
    await planner.locator('[data-step="paths"]').click();
    assert.equal(await planner.locator("#pathStagnationLimit").inputValue(), "10000", "The 10-second delay survives reload");
    assert.equal(await planner.locator("#cutThresholdInput").inputValue(), "12");
    assert.equal(await planner.locator("#pathAlgorithmFeedback").isVisible(), false, "No stale search status before a run");
    assert.equal(await planner.locator("#pathDetails").getAttribute("open"), null);
    assert.equal(await planner.locator("#metricCutTravel").isVisible(), false);
    assert.equal(await planner.locator("#metricZoneReturns").count(), 0);
    assert.equal(await planner.locator("#pathAlgorithmTotalScore").count(), 0, "The score has a single main readout");
    assert.equal(await planner.locator("#pathGridStatus").isVisible(), false);
    const exportBeforePanels = await planner.evaluate(() => buildPathExport());
    await planner.locator("#pathDetails > summary").click();
    assert.equal(await planner.locator("#metricCutTravel").isVisible(), true);
    await planner.locator("#pathDetails > summary").click();
    assert.deepEqual(await planner.evaluate(() => buildPathExport()), exportBeforePanels);
    assert.equal(await planner.locator("#pathManualControls").getAttribute("open"), null);
    await planner.locator("#pathManualControls > summary").click();
    await planner.locator("#pathEditMode").selectOption("start");
    await planner.locator("#patternCanvas").click({ position: { x: 35, y: 35 } });
    await planner.locator("#pathEditMode").selectOption("cut");
    await planner.locator("#patternCanvas").click({ position: { x: 53, y: 35 } });
    assert.equal(await planner.evaluate(() => constraintsByDmc["310"].forcedCuts.length), 1);
    await planner.locator("#lockedPrefixCount").fill("2");
    await planner.locator("#lockedPrefixCount").dispatchEvent("change");
    await planner.locator("#lockedPrefixCount").press("Tab");
    const lockedDiagonals = await planner.evaluate(() => currentPath().slice(0, 2));
    const constrainedPath = await planner.evaluate(() => currentPath());
    const savedConstraints = await planner.evaluate(() => constraintsByDmc["310"]);
    await planner.evaluate(() => { batchPlan = PathBatchPlan.prepare({ pending: ["310", "321"], results: [] }, null); });
    await observePathWorkers(planner, true);
    await planner.locator("#batchOptimizeButton").click();
    await planner.waitForFunction(() => pathWorkerHarness.messages.some(message => message.type === "complete"));
    assert.equal(await planner.evaluate(() => pathWorkerHarness.workers[0].posted[0].stagnationLimitMs), 10000,
      "Only the test worker transport shortens inactivity; the UI retains its production setting");
    assert.equal(await planner.evaluate(() => pathAlgorithmRunning && activePathOptimizerSnapshot === null), true);
    assert.equal(await planner.locator("#restoreBestPathButton").isEnabled(), false);
    await planner.locator("#stopPathAlgorithmButton").click();
    assert.deepEqual(await planner.evaluate(() => [pathAlgorithmRunning, batchRunning, batchPlan.pending.length, batchPlan.results.length]), [false, false, 2, 0]);
    assert.deepEqual(await planner.evaluate(() => currentPath()), constrainedPath, "Stopping before any result does not erase or reorient the old path");
    assert.deepEqual(await planner.evaluate(() => bestPathsByDmc["310"]), constrainedPath);
    await planner.locator("#pathStagnationLimit").selectOption("60000");

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
    await planner.locator("#cutThresholdInput").press("Tab");
    await planner.evaluate(({ prefix, constraints }) => {
      pathsByDmc["310"] = prefix;
      constraintsByDmc["310"] = constraints;
      batchPlan = PathBatchPlan.prepare({ pending: ["310", "321"], results: [] }, null);
      renderPathTool();
    }, { prefix: lockedDiagonals, constraints: savedConstraints });
    await planner.locator("#batchOptimizeButton").click();
    await planner.waitForFunction(() => pathWorkerHarness.workers[2]?.pending.some(message => message.type === "complete"));
    const partialIndex = await planner.evaluate(() => pathWorkerHarness.workers[2].pending.findIndex(message =>
      message.stage === "construction" && Array.isArray(message.path) && message.path.length < cellsForSelectedColor().length * 2));
    assert.ok(partialIndex >= 0, "Construction publishes a partial route when no complete incumbent exists");
    await deliverWorkerMessages(planner, 2, partialIndex);
    assert.equal(await planner.locator("#pathConstructionMetrics").isVisible(),
      await planner.evaluate(() => activePathOptimizerSnapshot.zone?.status === "running"));
    assert.equal(await planner.locator("#pathAlgorithmLastImprovement").isVisible(), false);
    assert.equal(await planner.locator("#pathAlgorithmProgress").isVisible(), true);
    assert.doesNotMatch(await planner.locator("#pathAlgorithmFeedback").innerText(), /%|score|retours/i);
    const partialPath = await planner.evaluate(() => currentPath());
    assert.deepEqual(partialPath.slice(0, lockedDiagonals.length), lockedDiagonals);
    assert.ok(partialPath.length < constrainedPath.length);
    await planner.locator("#stopPathAlgorithmButton").click();
    assert.deepEqual(await planner.evaluate(() => currentPath()), partialPath, "Stopping retains the partial route without generic reorientation");
    assert.equal(await planner.locator("#pathConstructionMetrics").isVisible(), false);
    assert.equal(await planner.locator("#pathAlgorithmProgress").isVisible(), false);
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
    assert.ok(batchSnapshots.length >= 2);
    for (let i = 0; i < data.paths.length; i++) {
      const dmc = data.paths[i].dmc;
      const snapshots = batchSnapshots.filter(snapshot => !require("../src/stitch-model.js").validateRoute(snapshot.path, data.paths[i].points));
      assert.ok(snapshots.length > 0);
      for (const snapshot of snapshots) {
        assertBlockResult(snapshot, data.paths[i].points, dmc === "310" ? savedConstraints : {}, 12, false);
        assertSearchSnapshots(await planner.evaluate(runId => pathWorkerHarness.messages.filter(message => message.runId === runId), snapshot.runId), data.paths[i].points);
      }
      assert.ok(await planner.evaluate(({ dmc, initial }) => comparePathPerformance(pathsByDmc[dmc], initial, dmc) <= 0,
        { dmc, initial: snapshots[0].path }), "Later batch engines preserve or improve the blocks result");
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
    await planner.locator('#pathColorLegend [data-dmc="310"]').click();
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
    assert.equal(await planner.locator("#pathAlgorithmLastImprovement").isVisible(), false);
    assert.equal(await planner.locator("#pathPreparationCount").isVisible(), true);
    assert.match(await planner.locator("#pathAlgorithmClockLabel").innerText(), /Blocs prepares/);
    assert.equal(await planner.locator("#pathAlgorithmDistance").innerText(), "Preparation des entrees et sorties");
    assert.equal(await planner.locator("#pathConstructionMetrics").isVisible(), false);
    const lastSearchIndex = await planner.evaluate(() => pathWorkerHarness.workers[0].pending.findLastIndex(message => message.stage === "search"));
    assert.ok(lastSearchIndex >= 0);
    const searchDisplays = await deliverWorkerMessages(planner, 0, lastSearchIndex);
    const search = searchDisplays.at(-1).snapshot;
    assert.equal(search.stage, "search");
    assert.equal(search.blocks.prepared, search.blocks.total);
    assert.equal(await planner.locator("#pathAlgorithmZonesDone").textContent(), `${search.blocks.prepared} / ${search.blocks.total}`);
    assert.equal(await planner.locator("#pathAlgorithmAttempts").textContent(), String(search.attempts));
    assert.equal(await planner.locator("#pathAlgorithmRestarts").textContent(), String(search.restarts));
    assert.equal(await planner.locator("#pathAlgorithmImprovements").textContent(), String(search.improvements));
    assert.equal(await planner.locator("#pathAlgorithmLastImprovement").isVisible(), true);
    assert.equal(await planner.locator("#pathAlgorithmProgress").getAttribute("aria-label"), "Sans amelioration");
    assert.equal(await planner.locator("#pathAlgorithmLastImprovement").innerText(),
      await planner.evaluate(snapshot => `${formatAlgorithmTime(snapshot.lastImprovementMs)} / ${formatAlgorithmTime(snapshot.stagnationLimitMs, true)}`, search));
    assert.equal(await planner.locator("#pathAlgorithmDistance").innerText(), "Recherche en cours");
    assert.equal(await planner.locator("#pathConstructionMetrics").isVisible(), false);
    assert.equal(await planner.locator("#pathPreparationCount").isVisible(), false);
    assert.equal(await planner.locator("#pathAlgorithmAttempts").isVisible(), false);
    assert.doesNotMatch(await planner.locator("#pathAlgorithmFeedback").innerText(), /%|score|retours/i);
    await planner.locator("#pathDetails > summary").click();
    assert.equal(await planner.locator("#pathAlgorithmAttempts").isVisible(), true);
    await planner.locator("#pathDetails > summary").click();
    let previousDisplay = alternatingBefore;
    for (const display of [...configurationDisplays, ...searchDisplays]) {
      assert.equal(require("../src/stitch-model.js").validateRoute(display.path, alternating.paths[0].points), "");
      assert.ok(compareObjective(require("../src/stitch-model.js").metrics(display.path, 12, true),
        require("../src/stitch-model.js").metrics(previousDisplay, 12, true)) <= 1e-7, "The displayed route never worsens during preparation or search");
      previousDisplay = display.path;
    }
    assert.ok(await planner.evaluate(old => comparePathPerformance(currentPath(), old) < 0, alternatingBefore), "The alternating fixture receives a better complete path");
    assert.match(await planner.locator("#pathImprovementGain").innerText(), /^Dernier gain : /,
      "Retained worker improvements automatically update visual feedback");
    const feedbackCheck = await planner.evaluate(before => {
      const wrap = patternCanvas.closest(".pattern-canvas-wrap");
      wrap.scrollTop = 45;
      const location = { x: wrap.scrollLeft, y: wrap.scrollTop, pageX: scrollX, pageY: scrollY,
        width: patternCanvas.width, height: patternCanvas.height };
      const path = currentPath(), saved = JSON.stringify(path);
      recordPathImprovement(selectedDmc, before, path);
      renderPatternGrid();
      const pixels = pathImprovementCanvas.getContext("2d").getImageData(0, 0, pathImprovementCanvas.width, pathImprovementCanvas.height).data;
      let visible = 0, blue = 0, red = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3]) visible++;
        if (pixels[i + 3] > 100 && pixels[i] < 40 && pixels[i + 1] > 90 && pixels[i + 2] > 180) blue++;
        if (pixels[i + 3] > 100 && pixels[i] > 150 && pixels[i + 1] < 100 && pixels[i + 2] < 120) red++;
      }
      return { location, after: { x: wrap.scrollLeft, y: wrap.scrollTop, pageX: scrollX, pageY: scrollY,
        width: patternCanvas.width, height: patternCanvas.height }, visible, blue, red,
        added: pathImprovement.added.length, removed: pathImprovement.removed.length,
        unchanged: saved === JSON.stringify(path), gain: pathImprovementGain.textContent,
        active: pathImprovementCanvas.classList.contains("active"),
        pointerEvents: getComputedStyle(pathImprovementCanvas).pointerEvents };
    }, alternatingBefore);
    assert.deepEqual(feedbackCheck.after, feedbackCheck.location, "Highlighting does not move the view or resize the pattern");
    assert.ok(feedbackCheck.visible > 0 && feedbackCheck.removed > 0);
    assert.ok(feedbackCheck.blue > 0 && feedbackCheck.red > 0, "Changed cuts have a blue highlight with a red core");
    assert.ok(feedbackCheck.unchanged && feedbackCheck.active);
    assert.equal(feedbackCheck.pointerEvents, "none", "The overlay never intercepts path editing");
    assert.match(feedbackCheck.gain, /^Dernier gain : /);
    await planner.screenshot({ path: path.join(screenshotDirectory, "planner-improvement.png"), fullPage: true });
    const gainText = await planner.locator("#pathImprovementGain").innerText();
    await planner.setViewportSize({ width: 390, height: 844 });
    await planner.evaluate(() => new Promise(requestAnimationFrame));
    assert.ok(await planner.evaluate(() => {
      const gain = pathImprovementGain.getBoundingClientRect(), heading = pathImprovementGain.parentElement.getBoundingClientRect();
      return gain.bottom <= heading.bottom + 1 && document.documentElement.scrollWidth <= innerWidth + 1;
    }), "The reserved gain area fits without overlap or horizontal page overflow on mobile");
    await planner.screenshot({ path: path.join(screenshotDirectory, "planner-improvement-mobile.png"), fullPage: true });
    await planner.setViewportSize({ width: 1600, height: 1000 });
    await planner.evaluate(() => new Promise(requestAnimationFrame));
    const originalPixels = await planner.evaluate(() => patternCanvas.toDataURL());
    const originalOverlay = await planner.evaluate(() => pathImprovementCanvas.toDataURL());
    await planner.evaluate(() => new Promise(resolve => setTimeout(resolve, 1800)));
    assert.equal(await planner.evaluate(() => patternCanvas.toDataURL()), originalPixels, "Keeping the highlight never redraws the base canvas");
    assert.equal(await planner.evaluate(() => pathImprovementCanvas.toDataURL()), originalOverlay);
    assert.equal(await planner.evaluate(() => pathImprovementCanvas.classList.contains("active")), true,
      "The last improvement stays highlighted beyond the former expiry delay");
    assert.equal(await planner.locator("#pathImprovementGain").innerText(), gainText);
    const connectionContrast = await planner.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 125; canvas.height = 75;
      const context = canvas.getContext("2d");
      const from = { x: 0, y: 0, diagonal: "upper", direction: 1 };
      const to = { x: 4, y: 0, diagonal: "lower", direction: 1 };
      const counts = [];
      for (const background of ["#ffffff", "#111111"]) {
        context.fillStyle = background; context.fillRect(0, 0, 125, 75);
        drawPathSegment(context, from, to, 18, { line: "#ffffff" }, false);
        const pixels = context.getImageData(42, 40, 60, 9).data;
        let ink = 0, outline = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] === 63 && pixels[i + 1] === 75 && pixels[i + 2] === 85) ink++;
          if (pixels[i] > 120 && pixels[i + 1] > 120 && pixels[i + 2] > 120) outline++;
        }
        counts.push({ background, ink, outline });
      }
      return counts;
    });
    assert.ok(connectionContrast.every(count => count.ink > 20 && count.outline > 20),
      `Inter-block connections remain contrasted on white and dark fabric colors: ${JSON.stringify(connectionContrast)}`);
    assert.ok(await planner.evaluate(() => {
      clearPendingOptimizerSnapshot();
      optimizerLastRenderedAt = performance.now();
      const worker = pathWorkerHarness.workers[0], route = currentPath().map(copyPoint);
      const previousPhase = activePathOptimizerSnapshot.phase;
      const message = { ...activePathOptimizerSnapshot, type: "progress", runId: activePathOptimizerRunId,
        phase: "Dernier apercu groupe", path: route };
      worker.pending.unshift(message, { ...message, path: undefined, elapsedMs: message.elapsedMs + 100 });
      worker.deliverNext(); worker.deliverNext();
      return optimizerSnapshotTimer !== null && optimizerSnapshotFrame === null
        && activePathOptimizerSnapshot.phase === previousPhase && pendingOptimizerSnapshot.path === route
        && pendingOptimizerSnapshot.elapsedMs === message.elapsedMs + 100;
    }), "Rapid previews are coalesced without dropping the newest path when a timer-only update follows");
    const stoppedBest = await planner.evaluate(() => currentPath());
    const stoppedBaseline = await planner.evaluate(() => pathOptimizationBaselinesByDmc[selectedDmc]);
    await planner.locator("#stopPathAlgorithmButton").click();
    assert.ok(await planner.evaluate(() => optimizerSnapshotTimer === null && pendingOptimizerSnapshot === null),
      "Stop immediately flushes the latest preview and cancels its pending delay");
    assert.deepEqual(await planner.evaluate(() => currentPath()), stoppedBest);
    assert.deepEqual(await planner.evaluate(() => bestPathsByDmc[selectedDmc]), stoppedBest);
    assert.equal(await planner.evaluate(() => pathWorkerHarness.workers[0].terminated), true);
    assert.equal(await planner.locator("#pathSearchCanvas").count(), 0,
      "No trial regions are present, while the retained improvement remains visible");
    assert.equal(await planner.evaluate(() => pathImprovementCanvas.classList.contains("active")), true,
      "Stopping preserves the last highlighted improvement");
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
    assert.equal(completedGroups.reason, "inactivity", "Small block sets also use the selected idle limit");
    assert.ok(completedGroups.lastImprovementMs >= completedGroups.stagnationLimitMs);
    assert.ok(completedGroups.attempts > 0, "Block-order or entry/exit candidates were evaluated");
    completedGroups.path.forEach((point, i, route) => {
      const sameGroup = i > 0 && (point.x < 20) === (route[i - 1].x < 20);
      assert.equal(completedGroups.unitLinks[i], sameGroup, "Every link inside an orthogonal group is constrained to one unit");
    });
    assert.deepEqual(await planner.evaluate(() => currentPath()), completedGroups.path);
    assert.equal(await planner.locator("#pathAlgorithmZonesDone").textContent(), "2 / 2");
    assert.notEqual(await planner.locator("#metricRealisticScore").innerText(), "-");
    assert.equal(await planner.locator("#pathAlgorithmAttempts").textContent(), String(completedGroups.attempts));
    assert.equal(await planner.locator("#pathAlgorithmRestarts").textContent(), String(completedGroups.restarts));
    assert.equal(await planner.locator("#pathAlgorithmImprovements").textContent(), String(completedGroups.improvements));
    assert.equal(await planner.locator("#pathAlgorithmProgress").isVisible(), false);
    assert.equal(await planner.locator("#pathConstructionMetrics").isVisible(), false);
    assert.match(await planner.locator("#pathAlgorithmDistance").innerText(), /Optimisation.*termin/i);
    const completedFeedback = await planner.locator("#pathAlgorithmFeedback").innerText();
    await planner.screenshot({ path: path.join(screenshotDirectory, "planner-block-complete.png"), fullPage: true });
    await planner.setViewportSize({ width: 390, height: 844 });
    assert.equal(await planner.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await planner.locator("#pathAlgorithmFeedback").innerText(), completedFeedback, "Completed statistics survive mobile resize");
    await planner.screenshot({ path: path.join(screenshotDirectory, "planner-block-complete-mobile.png"), fullPage: true });
    await planner.setViewportSize({ width: 1600, height: 1000 });
    await planner.locator('[data-dmc="321"]').click();
    assert.equal(await planner.locator("#pathAlgorithmFeedback").isVisible(), false, "Another color does not inherit the last run's feedback");
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
    assert.equal(await planner.locator("#pathAlgorithmZonesDone").textContent(), "-", "Editing clears obsolete construction statistics");
    assert.equal(await planner.locator("#pathAlgorithmRestarts").textContent(), "-");
    await planner.locator("#pathManualControls").evaluate(el => { el.open = true; });
    await planner.locator("#diagonalMode").selectOption("upper");
    const canvasCell = async x => planner.locator("#patternCanvas").click({ position: { x: 26 + (x + 0.5) * 18, y: 35 } });
    const canvasBeforeError = await planner.locator("#patternCanvas").boundingBox();
    await canvasCell(2);
    assert.equal(await planner.evaluate(() => currentPath().length), 0, "An upper leg cannot precede its lower leg");
    assert.equal(await planner.locator("#pathGridStatus").isVisible(), true);
    assert.deepEqual(await planner.locator("#patternCanvas").boundingBox(), canvasBeforeError, "A manual validation error must not displace the canvas");
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
    await planner.locator('#pathColorLegend [data-dmc="310"]').click();
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
    await planner.locator('#pathColorLegend [data-dmc="310"]').click();
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

    const bridge = structuredClone(data);
    bridge.project.name = bridge.pattern.project.name = "Small block bridges";
    bridge.paths[0].points = [...Array.from({ length: 12 }, (_, x) => ({ x, y: 2 })),
      ...[0, 5, 10].flatMap(x => [{ x, y: 0 }, { x: x + 1, y: 0 }])];
    bridge.pattern.grid.cells = bridge.pattern.grid.cells.map(cell => {
      const dmc = bridge.paths.find(route => route.points.some(point => point.x === cell.x && point.y === cell.y))?.dmc;
      return { ...cell, dmc: dmc || null, empty: !dmc, symbol: dmc === "310" ? "A" : dmc ? "B" : null };
    });
    await planner.locator('[data-step="load"]').click();
    await planner.locator("#patternJsonFile").setInputFiles({ name: "bridge.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bridge)) });
    await planner.waitForFunction(() => loadedPattern?.project.name === "Small block bridges");
    await planner.locator('#pathColorLegend [data-dmc="310"]').click();
    const originalBridgeExport = await planner.evaluate(() => buildPathExport());
    await planner.locator("#pathWorkColor").evaluate(input => {
      input.value = "#007fa3"; input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const workDrawing = await planner.evaluate(() => selectedPathDrawingColors());
    await planner.locator('[data-dmc="321"]').click();
    assert.deepEqual(await planner.evaluate(() => selectedPathDrawingColors()), workDrawing, "All DMC colors use the same chosen work style");
    await planner.locator('[data-dmc="310"]').click();
    assert.deepEqual(await planner.evaluate(() => buildPathExport()), originalBridgeExport, "Display colors never change DMC data or export settings");
    await observePathWorkers(planner, true, 300);
    await planner.locator("#optimizedPathButton").click();
    await planner.waitForFunction(() => pathWorkerHarness.messages.some(message => message.type === "complete"));
    const insertionIndex = await planner.evaluate(() => pathWorkerHarness.workers[0].pending.findIndex(message =>
      message.stage === "search" && message.insertions > 0 && message.path));
    assert.ok(insertionIndex >= 0, "Insertion improvements produce a live worker preview before completion");
    const viewBeforeInsertion = await planner.evaluate(() => ({ x: scrollX, y: scrollY, width: patternCanvas.width, height: patternCanvas.height }));
    await deliverWorkerMessages(planner, 0, insertionIndex);
    assert.ok(await planner.evaluate(() => activePathOptimizerSnapshot.insertions > 0 && pathAlgorithmRunning));
    assert.equal(await planner.locator("#pathAlgorithmDistance").innerText(), "Recherche en cours");
    assert.equal(await planner.evaluate(() => pathPerformanceMetrics(currentPath()).score), 35);
    assert.equal(await planner.evaluate(() => pathImprovementCanvas.classList.contains("active")), true);
    assert.ok(await planner.evaluate(() => scoreHistory.length >= 2));
    assert.equal(await planner.locator("#pathSearchActivity").count(), 0);
    assert.ok(await planner.evaluate(() => {
      const pixels = pathScoreHistory.getContext("2d").getImageData(0, 0, pathScoreHistory.width, pathScoreHistory.height).data;
      const rgb = PathSearchStats.modes.normal.color.match(/\w\w/g).map(value => parseInt(value, 16));
      return pixels.some((value, i) => i % 4 === 0 && rgb.every((channel, c) => Math.abs(pixels[i + c] - channel) < 4) && pixels[i + 3] > 200);
    }),
      "The score chart contains a visible improvement trace");
    assert.equal(await planner.locator("#pathSearchCanvas").count(), 0, "Orange trial regions have been removed");
    const beforeProbeOnly = await planner.evaluate(() => ({ pixels: patternCanvas.toDataURL(), path: currentPath(),
      scroll: [patternCanvas.parentElement.parentElement.scrollLeft, patternCanvas.parentElement.parentElement.scrollTop] }));
    await planner.evaluate(() => applyAdvancedPathSnapshot(selectedDmc, { ...activePathOptimizerSnapshot, path: undefined,
      activity: { kind: "order", regions: [{ minX: 3, minY: 1, maxX: 5, maxY: 3 }] } }));
    assert.deepEqual(await planner.evaluate(() => ({ pixels: patternCanvas.toDataURL(), path: currentPath(),
      scroll: [patternCanvas.parentElement.parentElement.scrollLeft, patternCanvas.parentElement.parentElement.scrollTop] })), beforeProbeOnly,
      "Activity-only previews do not redraw the base pattern, edit the best path or move the view");
    assert.ok(await planner.evaluate(() => pathImprovementCanvas.getContext("2d")
      .getImageData(0, 0, pathImprovementCanvas.width, pathImprovementCanvas.height).data.some((value, i) => i % 4 === 3 && value > 0)),
      "Inserted connections draw visible highlight pixels");
    assert.deepEqual(await planner.evaluate(() => ({ x: scrollX, y: scrollY, width: patternCanvas.width, height: patternCanvas.height })), viewBeforeInsertion,
      "An insertion preview does not move or resize the view");
    await planner.screenshot({ path: path.join(screenshotDirectory, "planner-small-block-insertion.png"), fullPage: true });
    await planner.setViewportSize({ width: 390, height: 844 });
    await planner.evaluate(() => new Promise(requestAnimationFrame));
    assert.ok(await planner.evaluate(() => {
      const heading = document.querySelector(".path-canvas-heading").getBoundingClientRect();
      return [pathWorkColor, pathImprovementGain, pathComparisonScore, pathScoreHistory].every(element => {
        const rect = element.getBoundingClientRect(); return rect.right <= heading.right + 1 && rect.bottom <= heading.bottom + 1;
      }) && document.documentElement.scrollWidth <= innerWidth + 1;
    }), "Work color, live status and chart fit the mobile heading");
    await planner.screenshot({ path: path.join(screenshotDirectory, "planner-search-mobile.png"), fullPage: true });
    await planner.setViewportSize({ width: 1600, height: 1000 });
    const pendingInsertionMessages = await planner.evaluate(() => pathWorkerHarness.workers[0].pending.length);
    await planner.locator("#pathViewBefore").click();
    await planner.evaluate(() => new Promise(requestAnimationFrame));
    const comparisonDuringSearch = await planner.evaluate(() => ({ camera: pathViewport.state, path: displayedPath(), pixels: patternCanvas.toDataURL() }));
    await deliverWorkerMessages(planner, 0, pendingInsertionMessages - 1);
    assert.deepEqual(await planner.evaluate(() => ({ camera: pathViewport.state, path: displayedPath(), pixels: patternCanvas.toDataURL() })),
      comparisonDuringSearch, "new best results do not replace the before view or move its camera");
    await planner.locator("#pathViewAfter").click();
    await planner.evaluate(() => new Promise(requestAnimationFrame));
    const bridgeResult = await planner.evaluate(() => pathWorkerHarness.messages.find(message => message.type === "complete"));
    assertBlockResult(bridgeResult, bridge.paths[0].points, {}, 12, false);
    assert.ok(bridgeResult.insertions >= 2);
    for (const x of [0, 5, 10]) {
      const indices = bridgeResult.path.flatMap((point, i) => point.y === 0 && point.x >= x && point.x <= x + 1 ? [i] : []);
      assert.equal(indices.length, 4);
      assert.equal(indices.at(-1) - indices[0], 3, "Each inserted two-cross block remains contiguous and complete");
    }
    assert.deepEqual(await planner.evaluate(() => currentPath()), bridgeResult.path);
    assert.equal(await planner.locator("#pathSearchCanvas").count(), 0, "No obsolete trial overlay remains");
    assert.equal(await planner.evaluate(() => pathImprovementCanvas.classList.contains("active")), true);
    await planner.evaluate(() => plannerSaveQueue);
    await planner.reload();
    await planner.waitForFunction(() => !document.querySelector("main").inert);
    await planner.locator('[data-step="paths"]').click();
    assert.deepEqual(await planner.evaluate(() => currentPath()), bridgeResult.path);
    assert.equal(await planner.locator("#pathWorkColor").inputValue(), "#007fa3", "The work color survives reload independently of the project");
    await observePathWorkers(planner);
    await planner.locator("#optimizedPathButton").click();
    await planner.waitForFunction(() => !pathAlgorithmRunning && pathWorkerHarness.messages.some(message => message.type === "complete"));
    assert.deepEqual(await planner.evaluate(() => currentPath()), bridgeResult.path, "Reloading and rerunning retains the interleaved best");
    assertSearchSnapshots(await planner.evaluate(() => pathWorkerHarness.messages), bridge.paths[0].points);

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
      // Relay gains intentionally restart search; exercise several cycles, then test an explicit stop on this large input.
      await planner.waitForFunction(() => !pathAlgorithmRunning || pathWorkerHarness.messages.some(s => s.relayImprovements >= 3), null, { timeout: 120000 });
      const interrupted = await planner.evaluate(() => pathAlgorithmRunning);
      if (interrupted) await planner.locator("#stopPathAlgorithmButton").click();
      const largeSnapshot = await planner.evaluate(() => pathWorkerHarness.messages.find(message => message.type === "complete")
        || pathConstructionSummaries[selectedDmc]?.snapshot);
      assert.ok(largeSnapshot, await planner.locator("#pathAlgorithmDistance").innerText());
      if (!interrupted) assertBlockResult(largeSnapshot, largeInput.cells, largeInput.constraints, largeInput.cutThreshold, false);
      else assert.ok(largeSnapshot.relayImprovements >= 3, "the large pattern exercises accepted relay/resume cycles before stopping");
      assertSearchSnapshots(await planner.evaluate(() => pathWorkerHarness.messages), largeInput.cells, largeInput.cutThreshold);
      assert.equal(largeSnapshot.stagnationLimitMs, 300);
      if (!interrupted) {
        assert.equal(largeSnapshot.reason, "inactivity");
        assert.ok(largeSnapshot.lastImprovementMs >= largeSnapshot.stagnationLimitMs);
        assert.deepEqual(await planner.evaluate(() => currentPath()), largeSnapshot.path);
      }
      assert.ok(await planner.evaluate(constraints => StitchModel.satisfiesConstraints(currentPath(), constraints), largeInput.constraints));
      assert.notEqual(await planner.locator("#pathAlgorithmZonesDone").textContent(), "-");
      assert.equal(await planner.locator("#pathAlgorithmLastImprovement").isVisible(), false);
      assert.notEqual(await planner.locator("#metricRealisticScore").innerText(), "-");
      const result = await planner.evaluate(() => ({ count: currentPath().length,
        error: StitchModel.validateRoute(currentPath(), cellsForSelectedColor()), metrics: pathPerformanceMetrics(currentPath()),
        feedback: pathAlgorithmDistance.textContent }));
      assert.equal(result.count, largeInput.cells.length * 2);
      assert.equal(result.error, "");
      assert.doesNotMatch(result.feedback, /Erreur/);
      await planner.evaluate(() => plannerSaveQueue);
      console.log(`large block optimizer passed (${result.count} diagonals, ${largeSnapshot.blocks.total} blocks, ${largeSnapshot.attempts} attempts, ${largeSnapshot.relayImprovements} relay gains, score ${result.metrics.score.toFixed(2)}, ${interrupted ? "stopped with best route" : "completed"})`);
    }
    assert.deepEqual(errors, []);
    console.log("browser workflows passed: resume, undo/redo, session, batch, constraints, group editing, source overlay, responsive layout");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
