const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const model = require("../src/stitch-model.js");
const { createRegionOptimizer } = require("../src/region-optimizer-worker.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const api = createRegionOptimizer(model, createOrthogonalPathBuilder);

async function run() {
  const root = path.resolve(__dirname, ".."), output = path.join(root, "exports", "verification");
  await fs.mkdir(output, { recursive: true });
  const points = [{ x: 0, y: 2 }, { x: 5, y: 2 }, { x: 2, y: 2 }, { x: 8, y: 2 }];
  const other = [{ x: 4, y: 3 }, { x: 5, y: 3 }];
  const palette = [{ dmc: "310", symbol: "A", hex: "#111111" }, { dmc: "321", symbol: "B", hex: "#aa3333" }];
  const source = new Map([...points.map(p => [model.cellKey(p), "310"]), ...other.map(p => [model.cellKey(p), "321"])]);
  const pattern = { kind: "cross-stitch-pattern", schemaVersion: 1, project: { name: "Selection locale" }, colors: palette,
    grid: { width: 40, height: 30, cells: Array.from({ length: 1200 }, (_, i) => {
      const x = i % 40, y = Math.floor(i / 40), dmc = source.get(`${x},${y}`) || null;
      return { x, y, empty: !dmc, dmc, symbol: dmc === "310" ? "A" : dmc ? "B" : null };
    }) } };
  const initial = model.expandCells(points), otherPath = model.expandCells(other);
  const data = { kind: "cross-stitch-paths", schemaVersion: 2, stitchUnit: "diagonal", project: pattern.project, pattern,
    settings: { cutThreshold: 10 }, paths: [{ dmc: "310", points: initial }, { dmc: "321", points: otherPath }] };
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  const frame = () => page.evaluate(() => new Promise(requestAnimationFrame));
  const upload = async value => {
    await page.locator("#patternJsonFile").setInputFiles({ name: "local.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
    await page.waitForFunction(name => loadedPattern?.project.name === name, value.project.name);
  };
  async function drag(a, b) {
    const [first, last] = await page.evaluate(([a, b]) => [pathViewport.toScreen(a), pathViewport.toScreen(b)], [a, b]);
    const box = await page.locator("#patternCanvas").boundingBox();
    await page.mouse.move(box.x + first.x, box.y + first.y); await page.mouse.down();
    await page.mouse.move(box.x + last.x, box.y + last.y, { steps: 5 }); await page.mouse.up(); await frame();
  }
  try {
    await page.goto(pathToFileURL(path.join(root, "plan-paths.html")).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    await upload(data);
    assert.ok(await page.locator("#optimizeRegionButton").isDisabled());
    await page.locator("#pathZoomIn").click(); await frame();
    await page.evaluate(() => { pathViewport.center({ x: 4, y: 3 }); pathViewport.pan(-15, -12); queueViewportRender(); }); await frame();
    const camera = await page.evaluate(() => pathViewport.state);
    const history = await page.evaluate(() => JSON.stringify(pathEditHistory.toJSON()));
    await page.locator("#pathSelectMode").click();
    await drag({ x: 2.1, y: 1.1 }, { x: 5.8, y: 4.8 });
    const region = { minX: 2, minY: 1, maxX: 6, maxY: 5 };
    assert.deepEqual(await page.evaluate(() => selectedPathRegion), region);
    assert.deepEqual(await page.evaluate(() => currentPath()), initial);
    assert.equal(await page.evaluate(() => JSON.stringify(pathEditHistory.toJSON())), history);
    assert.equal(await page.locator("#optimizeRegionButton").isDisabled(), false);
    assert.match(await page.locator("#pathRegionStatus").innerText(), /2 croix.*1 passage/);
    assert.ok(await page.locator('#pathSelectMode img').evaluate(img => img.complete && img.naturalWidth > 0));
    const selectionPixels = await page.evaluate(() => {
      const data = patternCanvas.getContext("2d").getImageData(0, 0, patternCanvas.width, patternCanvas.height).data;
      let count = 0; for (let i = 0; i < data.length; i += 4) if (data[i] === 18 && data[i + 1] === 103 && data[i + 2] === 178) count++;
      return count;
    });
    assert.ok(selectionPixels > 30, "the actual rectangle border is painted");
    const differentBest = model.expandCells([...points].sort((a, b) => b.x - a.x));
    assert.ok(model.metrics(differentBest, 10, true).score < model.metrics(initial, 10, true).score);
    await page.evaluate(path => { bestPathsByDmc["310"] = path; }, differentBest);
    await page.locator("#optimizeRegionButton").click();
    await page.waitForFunction(() => !pathAlgorithmRunning && pathConstructionSummaries["310"]?.snapshot.method === "region-optimization");
    const optimized = await page.evaluate(() => currentPath());
    assert.ok(model.metrics(optimized, 10, true).score < model.metrics(initial, 10, true).score);
    assert.ok(api.preservesOutside(initial, optimized, region));
    assert.deepEqual(await page.evaluate(() => pathsByDmc["321"]), otherPath);
    assert.deepEqual(await page.evaluate(() => pathViewport.state), camera, "optimization never moves the view");
    assert.deepEqual(await page.evaluate(() => comparisonPaths.get("310").path), initial);
    assert.notDeepEqual(optimized, differentBest, "local search starts from the visible path, not a saved path with different outside actions");
    await page.locator("#pathViewBefore").click(); await frame();
    assert.ok(await page.locator("#pathSelectMode").isDisabled());
    await page.locator("#pathViewAfter").click(); await frame();
    await page.screenshot({ path: path.join(output, "planner-region-desktop.png"), fullPage: true });
    await page.locator("#undoPathPointButton").click();
    assert.deepEqual(await page.evaluate(() => currentPath()), initial);
    await page.locator("#redoPathActionButton").click();
    assert.deepEqual(await page.evaluate(() => currentPath()), optimized);
    assert.deepEqual(await page.evaluate(() => pathsByDmc["321"]), otherPath);
    // Move and resize the rectangle without changing the route or adding history.
    await page.locator("#pathSelectMode").click();
    const beforeAdjustments = await page.evaluate(() => JSON.stringify(pathEditHistory.toJSON()));
    await drag({ x: 3.5, y: 2.5 }, { x: 4.5, y: 3.5 });
    assert.deepEqual(await page.evaluate(() => selectedPathRegion), { minX: 3, minY: 2, maxX: 7, maxY: 6 });
    await drag({ x: 7, y: 6 }, { x: 9, y: 7 });
    assert.deepEqual(await page.evaluate(() => selectedPathRegion), { minX: 3, minY: 2, maxX: 9, maxY: 7 });
    assert.equal(await page.evaluate(() => JSON.stringify(pathEditHistory.toJSON())), beforeAdjustments);
    await page.locator("#pathClearSelection").click(); await frame();
    await drag({ x: 20.1, y: 12.1 }, { x: 22.8, y: 14.8 });
    assert.ok(await page.locator("#optimizeRegionButton").isDisabled());
    assert.match(await page.locator("#pathRegionStatus").innerText(), /Selection vide/);
    await page.locator("#pathClearSelection").click(); await frame();
    await page.locator("#pathFitView").click(); await frame();
    await drag({ x: 1.1, y: 1.1 }, { x: 6.8, y: 4.8 });
    await page.setViewportSize({ width: 390, height: 844 }); await frame(); await frame();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(output, "planner-region-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 2560, height: 1440 }); await frame(); await frame();
    await page.screenshot({ path: path.join(output, "planner-region-wide.png"), fullPage: true });
    await page.evaluate(() => plannerSaveQueue);
    await page.reload(); await page.waitForFunction(() => !document.querySelector("main").inert);
    await page.locator('[data-step="paths"]').click();
    assert.deepEqual(await page.evaluate(() => currentPath()), optimized);
    assert.equal(await page.evaluate(() => selectedPathRegion), null, "selection is view state, not a change to exported paths");
    // A fresh pattern can be selected but not locally optimized until it has a full route.
    await page.locator('[data-step="load"]').click();
    await upload({ ...pattern, project: { name: "Sans parcours" } });
    await page.locator("#pathSelectMode").click();
    await drag({ x: 1.1, y: 1.1 }, { x: 6.8, y: 4.8 });
    assert.ok(await page.locator("#optimizeRegionButton").isDisabled());
    assert.match(await page.locator("#pathRegionStatus").innerText(), /Chemin complet requis/);
    // A long regional calculation remains stoppable, retaining only complete valid incumbents.
    const largeCells = [{ x: 0, y: 0 }, ...Array.from({ length: 18 }, (_, i) => ({ x: 2 + i % 6 * 2, y: 2 + Math.floor(i / 6) * 2 })), { x: 20, y: 0 }];
    const largeSet = new Set(largeCells.map(model.cellKey)), largePath = model.expandCells(largeCells);
    const largePattern = { ...pattern, project: { name: "Arret local" }, colors: [palette[0]], grid: { ...pattern.grid,
      cells: pattern.grid.cells.map(cell => ({ ...cell, empty: !largeSet.has(model.cellKey(cell)), dmc: largeSet.has(model.cellKey(cell)) ? "310" : null })) } };
    await page.locator('[data-step="load"]').click();
    await upload({ ...data, project: largePattern.project, pattern: largePattern, paths: [{ dmc: "310", points: largePath }] });
    await page.locator("#pathSelectMode").click(); await frame();
    await drag({ x: 2.1, y: 2.1 }, { x: 12.8, y: 6.8 });
    const largeRegion = await page.evaluate(() => selectedPathRegion);
    await page.locator("#optimizeRegionButton").click();
    await page.waitForFunction(() => pathAlgorithmRunning && activePathOptimizerSnapshot?.region);
    assert.ok(await page.locator("#pathSelectMode").isDisabled());
    await page.locator("#stopPathAlgorithmButton").click();
    const stopped = await page.evaluate(() => currentPath());
    assert.equal(await page.evaluate(() => pathAlgorithmRunning), false);
    assert.equal(model.validateRoute(stopped, largeCells), "");
    assert.ok(api.preservesOutside(largePath, stopped, largeRegion));
    assert.ok(model.metrics(stopped, 10, true).score <= model.metrics(largePath, 10, true).score);
    assert.deepEqual(errors, []);
    console.log("regional planner passed: zoomed rectangle, move/resize, strict global gain, outside and other color unchanged, undo/redo, comparison, persistence and responsive layouts");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
