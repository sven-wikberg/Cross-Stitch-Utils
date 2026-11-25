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
  const pattern = { kind: "cross-stitch-pattern", schemaVersion: 1, project: { name: "Recherche approfondie" },
    colors: [{ dmc: "310", symbol: "A", hex: "#111111" }], grid: { width: 14, height: 12,
      cells: Array.from({ length: 168 }, (_, i) => { const x = i % 14, y = Math.floor(i / 14), filled = keys.has(`${x},${y}`);
        return { x, y, empty: !filled, dmc: filled ? "310" : null, symbol: filled ? "A" : null }; }) } };
  const data = { kind: "cross-stitch-paths", schemaVersion: 1, project: pattern.project, pattern,
    settings: { cutThreshold: 3 }, paths: [{ dmc: "310", points }] };
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const instrument = async () => page.evaluate(() => {
    window.deepReports = []; window.deepPosted = []; window.deepTestBudget = 3600000;
    const create = window.createDeepPathOptimizerWorker;
    window.createDeepPathOptimizerWorker = () => {
      const worker = create(), post = worker.postMessage.bind(worker);
      worker.postMessage = message => { deepPosted.push(message); post({ ...message, totalLimitMs: deepTestBudget,
        ...(message.stopAfterInactivity ? { stagnationLimitMs: 1000 } : {}), warmupMs: 0 }); };
      worker.addEventListener("message", event => {
        const s = event.data;
        deepReports.push({ type: s.type, stage: s.stage, metrics: s.metrics, lns: s.lns, totalLimitMs: s.totalLimitMs,
          elapsedMs: s.elapsedMs, stopAfterInactivity: s.stopAfterInactivity, lastImprovementMs: s.lastImprovementMs,
          resetBudgetOnImprovement: s.resetBudgetOnImprovement, remainingMs: s.remainingMs, preparing: s.preparing });
      });
      return worker;
    };
  });
  try {
    await page.goto(pathToFileURL(path.join(root, "plan-paths.html")).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    assert.equal(await page.locator("#deepOptimizeButton").isVisible(), false);
    await page.locator("#patternJsonFile").setInputFiles({ name: "deep.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(() => loadedPattern?.project.name === "Recherche approfondie");
    const initial = await page.evaluate(() => currentPath());
    const initialScore = model.metrics(initial, 3, true).score;
    assert.equal(await page.locator("#deepResetOnGain").isChecked(), false);
    await instrument();
    await page.locator("#deepOptimizeButton").click();
    await page.waitForFunction(() => activePathOptimizerSnapshot?.lns?.improvements > 0);
    assert.equal(await page.evaluate(() => deepPosted[0].totalLimitMs), 3600000);
    assert.equal(await page.evaluate(() => deepPosted[0].resetBudgetOnImprovement), undefined);
    assert.notEqual(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    assert.ok(await page.locator("#optimizedPathButton").isDisabled());
    assert.ok(await page.locator("#deepOptimizeButton").isDisabled());
    assert.ok(await page.locator("#lnsOptimizeButton").isDisabled());
    assert.ok(await page.locator("#pathLnsMetrics").isVisible());
    assert.equal(await page.locator("#pathAlgorithmClockLabel").textContent(), "Temps restant");
    assert.equal(await page.locator("#pathAlgorithmProgress").getAttribute("max"), "3600000");
    assert.ok(await page.evaluate(() => pathImprovement && scoreHistory.length > 1));
    await page.screenshot({ path: path.join(output, "planner-deep-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(output, "planner-deep-mobile.png"), fullPage: true });
    const visibleScore = await page.evaluate(() => pathPerformanceMetrics(currentPath()).score);
    await page.locator("#stopPathAlgorithmButton").click();
    await page.waitForFunction(() => !pathAlgorithmRunning);
    const stopped = await page.evaluate(() => currentPath());
    assert.equal(model.validateRoute(stopped, points), "");
    assert.ok(model.metrics(stopped, 3, true).score <= visibleScore + 1e-8);
    assert.ok(model.metrics(stopped, 3, true).score < initialScore);
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    await page.locator("#undoPathPointButton").click();
    assert.deepEqual(await page.evaluate(() => currentPath()), initial);
    assert.deepEqual(await page.evaluate(() => bestPathsByDmc["310"]), stopped);
    await page.locator("#redoPathActionButton").click();
    assert.deepEqual(await page.evaluate(() => currentPath()), stopped);
    await page.evaluate(() => plannerSaveQueue); await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert);
    await page.locator('[data-step="paths"]').click();
    assert.deepEqual(await page.evaluate(() => currentPath()), stopped);
    await instrument(); await page.evaluate(() => { deepTestBudget = 300; });
    await page.locator("#deepOptimizeButton").click();
    await page.waitForFunction(() => !pathAlgorithmRunning && deepReports.some(s => s.type === "complete"));
    const completed = await page.evaluate(() => deepReports.at(-1));
    assert.equal(completed.totalLimitMs, 300); assert.ok(completed.elapsedMs >= 300);
    assert.ok(model.metrics(await page.evaluate(() => currentPath()), 3, true).score <= model.metrics(stopped, 3, true).score + 1e-8);
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    assert.ok(await page.locator("#optimizedPathButton").isEnabled());
    const beforeM6 = await page.evaluate(() => pathPerformanceMetrics(currentPath()).score);
    await page.locator("#lnsOptimizeButton").click();
    await page.waitForFunction(() => pathAlgorithmRunning && activePathOptimizerSnapshot?.stopAfterInactivity === true && !activePathOptimizerSnapshot.preparing);
    assert.equal(await page.evaluate(() => deepPosted.at(-1).stopAfterInactivity), true);
    assert.equal(await page.evaluate(() => deepPosted.at(-1).totalLimitMs), undefined);
    assert.equal(await page.evaluate(() => deepPosted.at(-1).stagnationLimitMs), 60000);
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    assert.notEqual(await page.locator("#pathAlgorithmClockLabel").textContent(), "Temps restant");
    assert.equal(await page.locator("#pathAlgorithmProgress").getAttribute("max"), "1000");
    assert.ok(await page.locator("#deepOptimizeButton").isDisabled());
    await page.waitForFunction(() => !pathAlgorithmRunning && deepReports.at(-1)?.stopAfterInactivity === true);
    assert.equal(await page.evaluate(() => deepReports.at(-1).totalLimitMs), null);
    assert.ok(await page.evaluate(() => deepReports.at(-1).lastImprovementMs >= 1000));
    assert.ok(model.metrics(await page.evaluate(() => currentPath()), 3, true).score <= beforeM6 + 1e-8);
    assert.equal(await page.evaluate(() => pathSearchStatsByDmc["310"].totals.deep.runs), 3);
    await page.evaluate(() => {
      const create = window.createPathOptimizerWorker;
      window.createPathOptimizerWorker = () => {
        const worker = create(), post = worker.postMessage.bind(worker);
        worker.postMessage = message => { window.normalPosted = message; post({ ...message, stagnationLimitMs: 20 }); };
        return worker;
      };
    });
    await page.locator("#optimizedPathButton").click();
    await page.waitForFunction(() => !pathAlgorithmRunning);
    assert.equal(await page.evaluate(() => normalPosted.totalLimitMs), undefined);
    assert.equal(await page.locator("#pathLnsMetrics").isVisible(), false);
    await page.locator("#deepResetOnGain").check();
    await page.evaluate(() => plannerSaveQueue); await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert);
    await page.locator('[data-step="paths"]').click();
    assert.equal(await page.locator("#deepResetOnGain").isChecked(), true);
    await instrument(); await page.evaluate(() => { deepTestBudget = 3000; });
    const fresh = structuredClone(data);
    fresh.project.name = fresh.pattern.project.name = "Recherche renouvelable";
    await page.locator("#patternJsonFile").setInputFiles({ name: "renewable.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fresh)) });
    await page.waitForFunction(() => loadedPattern?.project.name === "Recherche renouvelable");
    await page.locator("#deepOptimizeButton").click();
    await page.waitForFunction(() => activePathOptimizerSnapshot?.resetBudgetOnImprovement && activePathOptimizerSnapshot?.lns?.improvements > 0);
    assert.equal(await page.evaluate(() => deepPosted.at(-1).resetBudgetOnImprovement), true);
    assert.equal(await page.evaluate(() => deepPosted.at(-1).totalLimitMs), 3600000);
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    assert.ok(await page.locator("#deepResetOnGain").isDisabled());
    assert.equal(await page.locator("#pathAlgorithmClockLabel").textContent(), "Temps restant");
    assert.equal(await page.locator("#pathAlgorithmProgress").getAttribute("max"), "3000");
    assert.ok(await page.evaluate(() => deepReports.some(s => s.resetBudgetOnImprovement && s.lns?.improvements > 0 && s.remainingMs > 2500)));
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.screenshot({ path: path.join(output, "planner-deep-renewable-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(output, "planner-deep-renewable-mobile.png"), fullPage: true });
    await page.waitForFunction(() => !pathAlgorithmRunning && deepReports.at(-1)?.type === "complete");
    assert.ok(await page.evaluate(() => deepReports.at(-1).lastImprovementMs >= 3000));
    assert.equal(await page.evaluate(() => deepReports.at(-1).remainingMs), 0);
    assert.equal(model.validateRoute(await page.evaluate(() => currentPath()), points), "");
    await page.locator("#lnsOptimizeButton").click();
    await page.waitForFunction(() => deepPosted.at(-1)?.stopAfterInactivity === true);
    assert.equal(await page.evaluate(() => deepPosted.at(-1).resetBudgetOnImprovement), undefined);
    assert.equal(await page.evaluate(() => deepPosted.at(-1).stagnationLimitMs), 60000);
    await page.waitForFunction(() => !pathAlgorithmRunning);
    assert.deepEqual(errors, []);
    console.log("deep planner passed: fixed/renewable one-hour modes, independent automatic M6, real gains, countdown, stop, best, undo/redo, persistence, desktop/mobile");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
