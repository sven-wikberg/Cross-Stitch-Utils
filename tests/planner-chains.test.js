const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const model = require("../src/stitch-model.js");
async function run() {
  const root = path.resolve(__dirname, ".."), output = path.join(root, "exports/verification");
  await fs.mkdir(output, { recursive: true });
  const points = Array.from({ length: 600 }, (_, i) => { const index = (i * 137) % 600; return { x: index % 30 + 2, y: Math.floor(index / 30) + 2 }; });
  const keys = new Set(points.map(model.cellKey));
  const pattern = { kind: "cross-stitch-pattern", schemaVersion: 1, project: { name: "Test de reinsertion de chaines" },
    colors: [{ dmc: "310", symbol: "A", hex: "#111111" }], grid: { width: 34, height: 24,
      cells: Array.from({ length: 816 }, (_, i) => { const x = i % 34, y = Math.floor(i / 34), filled = keys.has(`${x},${y}`);
        return { x, y, empty: !filled, dmc: filled ? "310" : null, symbol: filled ? "A" : null }; }) } };
  const data = { kind: "cross-stitch-paths", schemaVersion: 1, project: pattern.project, pattern,
    settings: { cutThreshold: 3 }, paths: [{ dmc: "310", points }] };
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(pathToFileURL(path.join(root, "plan-paths.html")).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    assert.equal(await page.locator("#chainsOptimizeButton").isVisible(), false);
    await page.locator("#patternJsonFile").setInputFiles({ name: "chains.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(() => loadedPattern?.project.name === "Test de reinsertion de chaines");
    const initial = await page.evaluate(() => currentPath());
    await page.evaluate(() => {
      window.chainsReports = []; window.chainsBudget = null;
      const create = window.createChainOptimizerWorker;
      window.createChainOptimizerWorker = () => {
        const worker = create(), post = worker.postMessage.bind(worker);
        worker.postMessage = message => { window.chainsPosted = message; post({ ...message, totalLimitMs: chainsBudget || message.totalLimitMs }); };
        worker.addEventListener("message", event => chainsReports.push(event.data)); return worker;
      };
    });
    await page.locator("#adaptiveSearchBudget").selectOption("60000");
    await page.locator("#chainsOptimizeButton").click();
    await page.waitForFunction(() => activePathOptimizerSnapshot?.chainSearch?.moves > 0 && pathImprovement && scoreHistory.length > 1);
    assert.equal(await page.evaluate(() => chainsPosted.totalLimitMs), 60000);
    for (const id of ["chainsOptimizeButton", "segmentsOptimizeButton", "sectionsOptimizeButton", "pointsOptimizeButton", "adaptiveOptimizeButton", "adaptiveSearchBudget", "optimizedPathButton", "deepOptimizeButton", "relayOptimizeButton"]) {
      assert.ok(await page.locator(`#${id}`).isDisabled());
    }
    assert.ok(await page.locator("#pathChainsMetrics").isVisible());
    for (const id of ["pathSegmentsMetrics", "pathPointsMetrics", "pathSectionsMetrics", "pathLnsMetrics", "pathRelayMetrics"]) assert.equal(await page.locator(`#${id}`).isVisible(), false);
    assert.equal(await page.locator("#pathAlgorithmClockLabel").textContent(), "Temps restant");
    assert.equal(await page.locator("#pathAlgorithmProgress").getAttribute("max"), "60000");
    assert.ok(Number(await page.locator("#pathChainMoves").textContent()) > 0);
    await page.screenshot({ path: path.join(output, "planner-chains-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(output, "planner-chains-mobile.png"), fullPage: true });
    const visibleScore = await page.evaluate(() => pathPerformanceMetrics(currentPath()).score);
    await page.locator("#stopPathAlgorithmButton").click(); await page.waitForFunction(() => !pathAlgorithmRunning);
    const stopped = await page.evaluate(() => currentPath());
    assert.equal(model.validateRoute(stopped, points), ""); assert.ok(model.metrics(stopped, 3, true).score <= visibleScore + 1e-8);
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    await page.locator("#undoPathPointButton").click(); assert.deepEqual(await page.evaluate(() => currentPath()), initial);
    assert.deepEqual(await page.evaluate(() => bestPathsByDmc["310"]), stopped);
    await page.locator("#restoreBestPathButton").click(); assert.deepEqual(await page.evaluate(() => currentPath()), stopped);
    await page.locator("#undoPathPointButton").click(); assert.deepEqual(await page.evaluate(() => currentPath()), initial);
    await page.evaluate(() => { chainsBudget = 500; chainsReports = []; });
    await page.locator("#chainsOptimizeButton").click();
    await page.waitForFunction(() => !pathAlgorithmRunning && chainsReports.some(s => s.type === "complete"));
    assert.deepEqual(await page.evaluate(() => chainsPosted.initialPath), stopped, "A relaunch resumes the historical best, not the worse undone route");
    const result = await page.evaluate(() => chainsReports.at(-1));
    assert.equal(result.totalLimitMs, 500); assert.ok(result.chainSearch.chains > 0);
    let previous = model.metrics(stopped, 3, true).score;
    for (const s of await page.evaluate(() => chainsReports.filter(s => s.path))) {
      assert.equal(model.validateRoute(s.path, points), ""); assert.ok(s.metrics.score <= previous + 1e-8); previous = s.metrics.score;
    }
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    await page.evaluate(() => plannerSaveQueue); await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert);
    await page.locator('[data-step="paths"]').click();
    assert.equal(model.validateRoute(await page.evaluate(() => currentPath()), points), "");
    assert.ok(await page.locator("#segmentsOptimizeButton").isEnabled());
    assert.deepEqual(errors, []);
    console.log("chains planner passed: real worker, global gains, feedback, desktop/mobile, stop, undo, best recovery and resume, completion, reload");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
