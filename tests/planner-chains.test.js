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
    assert.equal(await page.locator("#adaptiveSearchBudget").count(), 0);
    assert.equal(await page.locator("#pathStagnationLimit").inputValue(), "60000");
    assert.match(await page.locator("#chainsOptimizeButton").textContent(), /^Boucle 1\b/);
    await page.evaluate(() => {
      window.chainsReports = [];
      const create = window.createChainOptimizerWorker;
      window.createChainOptimizerWorker = () => {
        const worker = create(), post = worker.postMessage.bind(worker);
        worker.postMessage = message => { window.chainsPosted = message; post(message); };
        worker.addEventListener("message", event => chainsReports.push(event.data)); return worker;
      };
    });
    await page.locator("#pathStagnationLimit").selectOption("30000");
    await page.locator("#chainsOptimizeButton").click();
    await page.waitForFunction(() => activePathOptimizerSnapshot?.chainSearch?.moves > 0 && pathImprovement && scoreHistory.length > 1);
    const posted = await page.evaluate(() => chainsPosted);
    assert.equal(posted.untilStable, true);
    assert.equal(Object.hasOwn(posted, "totalLimitMs"), false);
    assert.notEqual(posted.stopAfterInactivity, true);
    assert.deepEqual(posted.initialPath, initial);
    assert.equal(posted.cutThreshold, 3);
    assert.deepEqual(posted.constraints, { forcedCuts: [], lockedPrefix: [] });
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    for (const id of ["chainsOptimizeButton", "segmentsOptimizeButton", "sectionsOptimizeButton", "pointsOptimizeButton", "adaptiveOptimizeButton", "pathStagnationLimit", "optimizedPathButton", "deepOptimizeButton", "relayOptimizeButton", "batchOptimizeButton", "currentColorOptimizeButton"]) {
      assert.ok(await page.locator(`#${id}`).isDisabled());
    }
    assert.ok(await page.locator("#pathChainsMetrics").isVisible());
    for (const id of ["pathSegmentsMetrics", "pathPointsMetrics", "pathSectionsMetrics", "pathLnsMetrics", "pathRelayMetrics"]) assert.equal(await page.locator(`#${id}`).isVisible(), false);
    assert.equal(await page.locator("#pathAlgorithmClockLabel").textContent(), "Liaisons examinees");
    assert.ok(Number(await page.locator("#pathAlgorithmProgress").getAttribute("max")) > 0);
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
    await page.evaluate(() => { chainsReports = []; });
    await page.locator("#chainsOptimizeButton").click();
    await page.waitForFunction(() => chainsReports.some(s => s.chainSearch?.chains > 0));
    assert.deepEqual(await page.evaluate(() => chainsPosted.initialPath), stopped, "A relaunch resumes the historical best, not the worse undone route");
    assert.equal(await page.evaluate(() => chainsPosted.untilStable), true);
    assert.equal(await page.evaluate(() => Object.hasOwn(chainsPosted, "totalLimitMs")), false);
    await page.locator("#stopPathAlgorithmButton").click(); await page.waitForFunction(() => !pathAlgorithmRunning);
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
    // A small real search can reach stability without imposing a test-only time budget.
    const completionPoints = require("./fixtures/combined-search.js").timerRecovery;
    const completionKeys = new Set(completionPoints.map(model.cellKey));
    const completionPattern = { ...pattern, project: { name: "Boucle 1 jusqu'a stabilite" }, grid: { ...pattern.grid,
      cells: pattern.grid.cells.map(cell => { const filled = completionKeys.has(model.cellKey(cell));
        return { ...cell, empty: !filled, dmc: filled ? "310" : null, symbol: filled ? "A" : null }; }) } };
    const completionData = { ...data, project: completionPattern.project, pattern: completionPattern,
      paths: [{ dmc: "310", points: completionPoints }] };
    await page.locator("#patternJsonFile").setInputFiles({ name: "stable-chains.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(completionData)) });
    await page.waitForFunction(() => loadedPattern?.project.name === "Boucle 1 jusqu'a stabilite");
    await page.evaluate(() => {
      window.chainsReports = [];
      const create = window.createChainOptimizerWorker;
      window.createChainOptimizerWorker = () => {
        const worker = create(), post = worker.postMessage.bind(worker);
        worker.postMessage = message => { window.chainsPosted = message; post(message); };
        worker.addEventListener("message", event => chainsReports.push(event.data)); return worker;
      };
    });
    const completionInitial = await page.evaluate(() => currentPath());
    await page.locator("#chainsOptimizeButton").click();
    await page.waitForFunction(() => !pathAlgorithmRunning && chainsReports.some(s => s.type === "complete"));
    assert.equal(await page.evaluate(() => chainsPosted.untilStable), true);
    assert.equal(await page.evaluate(() => Object.hasOwn(chainsPosted, "totalLimitMs")), false);
    const result = await page.evaluate(() => chainsReports.at(-1));
    assert.equal(result.untilStable, true);
    assert.notEqual(result.reason, "time-limit");
    assert.equal(model.validateRoute(result.path, completionPoints), "");
    previous = model.metrics(completionInitial, 3, true).score;
    for (const snapshot of await page.evaluate(() => chainsReports.filter(s => s.path))) {
      assert.equal(model.validateRoute(snapshot.path, completionPoints), "");
      assert.ok(snapshot.metrics.score <= previous + 1e-8); previous = snapshot.metrics.score;
    }
    assert.deepEqual(await page.evaluate(() => currentPath()), result.path);
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    assert.ok(await page.locator("#chainsOptimizeButton").isEnabled());
    assert.deepEqual(errors, []);
    console.log("chains planner passed: real worker, until stable, global gains, feedback, desktop/mobile, stop, undo, best recovery and resume, completion, reload");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
