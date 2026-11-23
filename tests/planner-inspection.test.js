const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const model = require("../src/stitch-model.js");
const fixture = require("./fixtures/combined-search.js").cutAware;

async function run() {
  const root = path.resolve(__dirname, ".."), output = path.join(root, "exports", "verification");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  const source = new Set(fixture.map(model.cellKey));
  const pattern = { kind: "cross-stitch-pattern", schemaVersion: 1, project: { name: "Inspection" },
    colors: [{ dmc: "310", symbol: "A", hex: "#111111" }],
    grid: { width: 80, height: 50, cells: Array.from({ length: 4000 }, (_, i) => {
      const x = i % 80, y = Math.floor(i / 80), empty = !source.has(`${x},${y}`);
      return { x, y, empty, dmc: empty ? null : "310", symbol: empty ? null : "A" };
    }) } };
  const initialPath = model.expandCells(fixture, 3);
  const data = { kind: "cross-stitch-paths", schemaVersion: 2, stitchUnit: "diagonal", project: pattern.project, pattern,
    settings: { cutThreshold: 3 }, paths: [{ dmc: "310", points: initialPath }] };
  const frame = () => page.evaluate(() => new Promise(requestAnimationFrame));
  const camera = () => page.evaluate(() => pathViewport.state);
  const state = () => page.evaluate(() => JSON.stringify({ paths: pathsByDmc, constraints: constraintsByDmc, best: bestPathsByDmc, history: pathEditHistory.toJSON() }));
  const upload = async value => {
    await page.locator("#patternJsonFile").setInputFiles({ name: "inspection.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
    await page.waitForFunction(name => loadedPattern?.project.name === name, value.project.name);
  };
  try {
    await page.goto(pathToFileURL(path.join(root, "plan-paths.html")).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    await upload(data);
    assert.equal(await page.locator("#pathSearchCanvas").count(), 0);
    assert.equal(await page.locator("#pathViewBefore").isDisabled(), true);
    assert.equal(await page.locator("#pathFollowGains").isChecked(), false);
    const initialCamera = await camera();
    await page.locator("#pathFollowGains").check(); await frame();
    assert.deepEqual(await camera(), initialCamera, "Enabling follow without a gain does not move the camera");
    assert.ok(await page.locator(".path-view-button img").evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)));
    await page.evaluate(() => {
      const create = window.createPathOptimizerWorker;
      window.createPathOptimizerWorker = () => {
        const worker = create(), post = worker.postMessage.bind(worker);
        worker.postMessage = message => post({ ...message, stagnationLimitMs: 250 });
        return worker;
      };
    });
    await page.locator("#optimizedPathButton").click();
    await page.waitForFunction(() => !pathAlgorithmRunning && comparisonPaths.has("310"));
    const optimized = await page.evaluate(() => currentPath());
    assert.ok(model.metrics(optimized, 3, true).score < model.metrics(initialPath, 3, true).score);
    assert.deepEqual(await page.evaluate(() => comparisonPaths.get("310").path), initialPath);
    assert.ok((await camera()).zoom > initialCamera.zoom, "Accepted real-worker gains automatically zoom the view");
    assert.equal(await page.evaluate(() => followedPathImprovement === pathImprovement), true);
    const followedState = await state();
    await page.locator("#pathFollowGains").uncheck();
    await page.locator("#pathFitView").click(); await frame();
    const manualCamera = await camera();
    await page.evaluate(before => { recordPathImprovement(selectedDmc, before, currentPath()); renderPatternGrid(true); }, initialPath);
    assert.deepEqual(await camera(), manualCamera, "Accepted gains do not move the camera with follow disabled");
    await page.locator("#pathFollowGains").check(); await frame();
    assert.ok((await camera()).zoom > manualCamera.zoom, "Enabling follow frames the latest existing gain immediately");
    const automaticCamera = await camera();
    await page.evaluate(() => {
      recordPathImprovement(selectedDmc, currentPath(), currentPath());
      renderPatternGrid(true); renderPatternGrid(true);
    });
    assert.deepEqual(await camera(), automaticCamera, "Repeated renders and non-improving routes do not refocus");
    assert.equal(await state(), followedState, "The follow toggle and camera never edit paths or history");
    await page.locator("#pathFocusGain").click(); await frame();
    const focused = await camera(), afterPixels = await page.evaluate(() => patternCanvas.toDataURL());
    const afterState = await state();
    await page.locator("#pathViewBefore").click(); await frame();
    assert.deepEqual(await camera(), focused, "before/after retains the exact camera");
    assert.deepEqual(await page.evaluate(() => displayedPath()), initialPath);
    assert.notEqual(await page.evaluate(() => patternCanvas.toDataURL()), afterPixels, "the actual before path is drawn");
    assert.equal(await page.locator("#pathDrawMode").isDisabled(), true);
    assert.equal(await page.evaluate(() => pathImprovementCanvas.classList.contains("active")), false);
    const box = await page.locator("#patternCanvas").boundingBox();
    await page.mouse.move(box.x + 240, box.y + 180); await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 110, { steps: 5 }); await page.mouse.up(); await frame();
    const panned = await camera(); assert.ok(panned.x > focused.x || panned.y > focused.y);
    assert.equal(await state(), afterState, "panning the before path never edits the real paths or history");
    await page.evaluate(before => { recordPathImprovement(selectedDmc, before, currentPath()); renderPatternGrid(true); }, initialPath);
    assert.deepEqual(await camera(), panned, "A new gain cannot move the camera in Before mode");
    assert.match(await page.locator(".path-follow-toggle").getAttribute("title"), /pause/);
    await page.locator("#pathFollowGains").uncheck(); await frame();
    await page.locator("#pathViewAfter").click(); await frame();
    assert.deepEqual(await camera(), panned);
    assert.deepEqual(await page.evaluate(() => displayedPath()), optimized);
    assert.equal(await page.evaluate(() => pathImprovementCanvas.classList.contains("active")), true);
    await page.locator("#pathFollowGains").check(); await frame();
    const anchor = { x: box.x + 220, y: box.y + 200 };
    await page.mouse.move(anchor.x, anchor.y);
    const world = await page.evaluate(() => pathViewport.toWorld({ x: 220, y: 200 }));
    await page.mouse.wheel(0, -150); await page.waitForTimeout(80);
    const nextWorld = await page.evaluate(() => pathViewport.toWorld({ x: 220, y: 200 }));
    assert.ok(Math.abs(world.x - nextWorld.x) < 1e-6 && Math.abs(world.y - nextWorld.y) < 1e-6);
    assert.equal(await state(), afterState);
    assert.equal((await camera()).width, focused.width, "zoom does not allocate a larger backing canvas");
    await page.locator("#pathOverview").click({ position: { x: 110, y: 60 } }); await frame();
    assert.ok((await camera()).x > panned.x, "overview recenters the current zoom");
    await page.locator("#pathFitView").click(); await frame();
    assert.equal((await camera()).zoom, 1);
    await page.locator("#pathFocusGain").click(); await frame();
    const cutPixels = await page.evaluate(() => currentPath().flatMap((point, i, route) => {
      if (!i || !isCutJump(route[i - 1], point)) return [];
      const a = StitchModel.holes(route[i - 1]).end, b = StitchModel.holes(point).start;
      return [pathViewport.toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })];
    }));
    let inspectedCut = false;
    for (const point of cutPixels) {
      const rect = await page.locator("#patternCanvas").boundingBox();
      await page.mouse.move(rect.x + point.x, rect.y + point.y); await frame();
      if ((await page.locator("#pathInspection").innerText()).startsWith("Coupe")) inspectedCut = true;
    }
    assert.ok(inspectedCut, "a real cut exposes its hole-to-hole distance");
    await page.screenshot({ path: path.join(output, "planner-inspection-after.png"), fullPage: true });
    await page.locator("#pathViewBefore").click(); await frame();
    await page.screenshot({ path: path.join(output, "planner-inspection-before.png"), fullPage: true });
    await page.locator("#pathViewAfter").click(); await frame();
    await page.evaluate(() => plannerSaveQueue);
    const reopened = await context.newPage();
    await reopened.goto(pathToFileURL(path.join(root, "plan-paths.html")).href);
    await reopened.waitForFunction(() => !document.querySelector("main").inert);
    await reopened.locator('[data-step="paths"]').click();
    assert.equal(await reopened.locator("#pathViewBefore").isDisabled(), true, "comparison references are session-only");
    assert.equal(await reopened.locator("#pathFollowGains").isChecked(), true, "The follow preference is restored independently of the project");
    assert.deepEqual(await reopened.evaluate(() => currentPath()), optimized, "reopening still restores the actual best path");
    await reopened.close();
    // Pointer conversion remains correct when editing a zoomed and shifted grid.
    await page.locator("#clearPathButton").click();
    await page.locator("#pathDrawMode").click();
    const cell = fixture.find(p => p.x === 4 && p.y === 3);
    const pixel = await page.evaluate(point => pathViewport.toScreen({ x: point.x + 0.5, y: point.y + 0.5 }), cell);
    await page.locator("#patternCanvas").click({ position: pixel });
    assert.deepEqual(await page.evaluate(() => currentPath().map(p => ({ x: p.x, y: p.y }))), [cell]);
    await page.locator("#undoPathPointButton").click();
    assert.equal(await page.evaluate(() => currentPath().length), 0);
    const big = require("../data/examples/grands-ilots.pattern.json");
    await upload(big); await page.locator("#pathZoomIn").click(); await page.locator("#pathZoomIn").click(); await frame();
    const oldScale = (await camera()).scale;
    await page.setViewportSize({ width: 390, height: 844 }); await frame(); await frame();
    assert.equal((await camera()).scale, oldScale, "resize does not reset an inspected zoom");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator("#pathPanMode").click();
    await page.locator("#patternCanvas").scrollIntoViewIfNeeded();
    const touchBox = await page.locator("#patternCanvas").boundingBox(), touchState = await state();
    const touchScale = (await camera()).scale, session = await context.newCDPSession(page);
    const touch = (dx, dy) => [{ x: touchBox.x + 75 - dx, y: touchBox.y + 150 - dy },
      { x: touchBox.x + 175 + dx, y: touchBox.y + 250 + dy }];
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch(0, 0) });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touch(20, 20) });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await frame();
    assert.ok((await camera()).scale > touchScale, "two-finger pinch zooms in hand mode");
    assert.equal(await state(), touchState);
    await session.detach();
    await page.screenshot({ path: path.join(output, "planner-inspection-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 2560, height: 1440 }); await frame(); await page.locator("#pathFitView").click(); await frame();
    assert.ok(await page.evaluate(() => Math.abs(pathViewport.bounds.maxX - loadedPattern.grid.width) < 1e-7
      && Math.abs(pathViewport.bounds.maxY - loadedPattern.grid.height) < 1e-7), JSON.stringify(await camera()));
    assert.ok(await page.evaluate(() => {
      const pixels = patternCanvas.getContext("2d").getImageData(0, 0, patternCanvas.width, patternCanvas.height).data;
      return pixels.some((value, i) => i % 4 === 0 && value < 180 && pixels[i + 3] > 0);
    }));
    await page.screenshot({ path: path.join(output, "planner-inspection-wide.png"), fullPage: true });
    assert.deepEqual(errors, []);
    console.log("planner inspection passed: automatic gain follow, preference, comparison pause, camera, wheel, pan, overview, cut inspection, zoomed editing, mobile and wide layouts");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
