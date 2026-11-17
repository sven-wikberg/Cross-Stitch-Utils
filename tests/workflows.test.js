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
    assert.equal(await page.evaluate(() => stitchedCountForDmc("310")), 3);
    assert.match(await page.locator("#nextCutText").innerText(), /Couper le fil/);
    await page.locator("#sessionModeButton").click();
    await page.locator("#zoomInButton").click();
    await page.evaluate(() => localSaveQueue);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert && activeProgressStep === "stitch");
    assert.deepEqual(await page.evaluate(() => [stitchedCountForDmc("310"), sessionMode, stitchZoom, undoActions.length]), [3, true, 1.25, 3]);
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
    assert.equal(await other.evaluate(() => stitchedCountForDmc("310")), 3);
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
    await other.waitForFunction(() => stitchedCountForDmc("310") === 3);
    await other.evaluate(() => localSaveQueue);
    assert.match(await other.locator("#syncStateText").innerText(), /Modifications locales/);
    await otherContext.close();

    const planner = await context.newPage();
    await planner.goto(`${origin}/plan-paths.html`);
    await planner.waitForFunction(() => !document.querySelector("main").inert);
    await planner.locator("#patternJsonFile").setInputFiles({ name: "fixture.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    assert.equal(await planner.locator("#cutThresholdInput").inputValue(), "12");
    await planner.locator("#pathEditMode").selectOption("start");
    await planner.locator("#patternCanvas").click({ position: { x: 35, y: 35 } });
    await planner.locator("#pathEditMode").selectOption("cut");
    await planner.locator("#patternCanvas").click({ position: { x: 53, y: 35 } });
    assert.equal(await planner.evaluate(() => constraintsByDmc["310"].forcedCuts.length), 1);
    await planner.locator("#lockedPrefixCount").fill("2");
    await planner.locator("#lockedPrefixCount").dispatchEvent("change");
    await planner.evaluate(() => { pathStagnationLimitMs = 1000; });
    await planner.locator("#batchOptimizeButton").click();
    await planner.waitForFunction(() => pathAlgorithmRunning);
    await planner.locator("#stopPathAlgorithmButton").click();
    assert.equal(await planner.evaluate(() => batchPlan.pending.length), 2);
    await planner.evaluate(() => plannerSaveQueue);
    await planner.reload();
    await planner.waitForFunction(() => !document.querySelector("main").inert);
    await planner.locator('[data-step="paths"]').click();
    await planner.evaluate(() => { pathStagnationLimitMs = 1000; });
    await planner.locator("#batchOptimizeButton").click();
    await planner.waitForFunction(() => !batchRunning && batchPlan.results.length === 2, { timeout: 15000 });
    assert.deepEqual(await planner.evaluate(() => pathsByDmc["310"].slice(0, 2)), data.paths[0].points.slice(0, 2));
    assert.equal(await planner.evaluate(() => buildPathExport().settings.cutThreshold), 12);
    await planner.evaluate(() => { pathStagnationLimitMs = 60000; renderPathTool(); });
    await planner.screenshot({ path: path.join(screenshotDirectory, "planner.png"), fullPage: true });

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
      const result = require("../src/path-optimizer-worker.js").createPathOptimizerApi().optimizePath({ points: route.points, initialPath: route.points, cutThreshold: 10, stagnationLimitMs: 1000 });
      assert.equal(new Set(result.route).size, route.points.length);
      assert.ok(result.metrics.score <= result.initialMetrics.score + 0.0001);
      console.log(`large optimizer passed (${route.points.length} points, ${Math.round(result.elapsedMs)} ms, short stagnation test)`);
    }
    assert.deepEqual(errors, []);
    console.log("browser workflows passed: resume, undo/redo, session, batch, constraints, group editing, source overlay, responsive layout");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
