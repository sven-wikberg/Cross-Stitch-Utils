const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const model = require("../src/stitch-model.js");
async function run() {
  const root = path.resolve(__dirname, ".."), output = path.join(root, "exports/verification");
  await fs.mkdir(output, { recursive: true });
  const points = require("./fixtures/combined-search.js").timerRecovery, keys = new Set(points.map(model.cellKey));
  const pattern = { kind: "cross-stitch-pattern", schemaVersion: 1, project: { name: "Points puis diagonales" },
    colors: [{ dmc: "310", symbol: "A", hex: "#111111" }], grid: { width: 14, height: 12,
      cells: Array.from({ length: 168 }, (_, i) => { const x = i % 14, y = Math.floor(i / 14), filled = keys.has(`${x},${y}`);
        return { x, y, empty: !filled, dmc: filled ? "310" : null, symbol: filled ? "A" : null }; }) } };
  const data = { kind: "cross-stitch-paths", schemaVersion: 1, project: pattern.project, pattern,
    settings: { cutThreshold: 3 }, paths: [{ dmc: "310", points }] };
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(pathToFileURL(path.join(root, "plan-paths.html")).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    assert.equal(await page.locator("#pointsOptimizeButton").isVisible(), false);
    await page.locator("#patternJsonFile").setInputFiles({ name: "points.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(() => loadedPattern?.project.name === "Points puis diagonales");
    const initial = await page.evaluate(() => currentPath());
    assert.equal(await page.locator("#adaptiveSearchBudget").inputValue(), "3600000");
    await page.evaluate(() => {
      window.pointsReports = []; window.pointsBudget = null;
      const create = window.createPointsDiagonalWorker;
      window.createPointsDiagonalWorker = () => {
        const worker = create(), post = worker.postMessage.bind(worker);
        worker.postMessage = message => { window.pointsPosted = message; post({ ...message, totalLimitMs: pointsBudget || message.totalLimitMs }); };
        worker.addEventListener("message", event => pointsReports.push(event.data));
        return worker;
      };
    });
    await page.locator("#adaptiveSearchBudget").selectOption("60000");
    await page.locator("#pointsOptimizeButton").click();
    await page.waitForFunction(() => activePathOptimizerSnapshot?.pointsSearch?.pointEvaluations > 0);
    assert.equal(await page.evaluate(() => pointsPosted.totalLimitMs), 60000);
    for (const id of ["pointsOptimizeButton", "adaptiveOptimizeButton", "adaptiveSearchBudget", "optimizedPathButton", "deepOptimizeButton"]) assert.ok(await page.locator(`#${id}`).isDisabled());
    assert.ok(await page.locator("#pathPointsMetrics").isVisible());
    assert.equal(await page.locator("#pathLnsMetrics").isVisible(), false);
    assert.equal(await page.locator("#pathAlgorithmClockLabel").textContent(), "Temps restant");
    assert.equal(await page.locator("#pathAlgorithmProgress").getAttribute("max"), "60000");
    await page.waitForFunction(() => pathImprovement && scoreHistory.length > 1);
    await page.screenshot({ path: path.join(output, "planner-points-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(output, "planner-points-mobile.png"), fullPage: true });
    const visibleScore = await page.evaluate(() => pathPerformanceMetrics(currentPath()).score);
    await page.locator("#stopPathAlgorithmButton").click();
    await page.waitForFunction(() => !pathAlgorithmRunning);
    const stopped = await page.evaluate(() => currentPath());
    assert.equal(model.validateRoute(stopped, points), "");
    assert.ok(model.metrics(stopped, 3, true).score <= visibleScore + 1e-8);
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    await page.locator("#undoPathPointButton").click(); assert.deepEqual(await page.evaluate(() => currentPath()), initial);
    assert.deepEqual(await page.evaluate(() => bestPathsByDmc["310"]), stopped);
    await page.locator("#redoPathActionButton").click(); assert.deepEqual(await page.evaluate(() => currentPath()), stopped);
    await page.evaluate(() => { pointsBudget = 350; pointsReports = []; });
    await page.locator("#pointsOptimizeButton").click();
    await page.waitForFunction(() => !pathAlgorithmRunning && pointsReports.some(s => s.type === "complete"));
    const result = await page.evaluate(() => pointsReports.at(-1));
    assert.equal(result.totalLimitMs, 350);
    assert.ok(result.pointsSearch.refinements > 0);
    assert.ok(result.metrics.score <= model.metrics(stopped, 3, true).score + 1e-8);
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    assert.ok(await page.locator("#optimizedPathButton").isEnabled());
    await page.evaluate(() => plannerSaveQueue); await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert);
    await page.locator('[data-step="paths"]').click();
    assert.equal(model.validateRoute(await page.evaluate(() => currentPath()), points), "");
    assert.deepEqual(errors, []);
    console.log("points planner passed: real worker, budget, gains, highlights, desktop/mobile, stop, best, undo/redo, completion, reload");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
