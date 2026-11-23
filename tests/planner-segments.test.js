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
  const pattern = { kind: "cross-stitch-pattern", schemaVersion: 1, project: { name: "Test des raccordements" },
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
    assert.equal(await page.locator("#segmentsOptimizeButton").isVisible(), false);
    await page.locator("#patternJsonFile").setInputFiles({ name: "segments.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(() => loadedPattern?.project.name === "Test des raccordements");
    const initial = await page.evaluate(() => currentPath());
    assert.equal(await page.locator("#adaptiveSearchBudget").count(), 0);
    assert.equal(await page.locator("#pathStagnationLimit").inputValue(), "60000");
    await page.evaluate(() => {
      window.segmentsReports = []; window.segmentsInactivity = null;
      const create = window.createSegmentOptimizerWorker;
      window.createSegmentOptimizerWorker = () => {
        const worker = create(), post = worker.postMessage.bind(worker);
        worker.postMessage = message => { window.segmentsPosted = message; post({ ...message, stagnationLimitMs: segmentsInactivity ?? message.stagnationLimitMs }); };
        worker.addEventListener("message", event => segmentsReports.push(event.data)); return worker;
      };
    });
    await page.locator("#pathStagnationLimit").selectOption("30000");
    await page.locator("#segmentsOptimizeButton").click();
    await page.waitForFunction(() => activePathOptimizerSnapshot?.segmentSearch?.repairs > 0 && pathImprovement && scoreHistory.length > 1);
    const posted = await page.evaluate(() => segmentsPosted);
    assert.equal(posted.stopAfterInactivity, true);
    assert.equal(posted.stagnationLimitMs, 30000);
    assert.equal(Object.hasOwn(posted, "totalLimitMs"), false);
    assert.deepEqual(posted.initialPath, initial);
    assert.equal(posted.cutThreshold, 3);
    assert.deepEqual(posted.constraints, { forcedCuts: [], lockedPrefix: [] });
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    for (const id of ["segmentsOptimizeButton", "sectionsOptimizeButton", "pointsOptimizeButton", "adaptiveOptimizeButton", "pathStagnationLimit", "optimizedPathButton", "deepOptimizeButton", "relayOptimizeButton", "batchOptimizeButton", "currentColorOptimizeButton"]) {
      assert.ok(await page.locator(`#${id}`).isDisabled());
    }
    assert.ok(await page.locator("#pathSegmentsMetrics").isVisible());
    for (const id of ["pathPointsMetrics", "pathSectionsMetrics", "pathLnsMetrics", "pathRelayMetrics"]) assert.equal(await page.locator(`#${id}`).isVisible(), false);
    assert.match(await page.locator("#pathAlgorithmClockLabel").textContent(), /inactivit|sans amelioration/i);
    assert.equal(await page.locator("#pathAlgorithmProgress").getAttribute("max"), "30000");
    assert.ok(Number(await page.locator("#pathSegmentRepairs").textContent()) > 0);
    await page.screenshot({ path: path.join(output, "planner-segments-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(output, "planner-segments-mobile.png"), fullPage: true });
    const visibleScore = await page.evaluate(() => pathPerformanceMetrics(currentPath()).score);
    await page.locator("#stopPathAlgorithmButton").click(); await page.waitForFunction(() => !pathAlgorithmRunning);
    const stopped = await page.evaluate(() => currentPath());
    assert.equal(model.validateRoute(stopped, points), ""); assert.ok(model.metrics(stopped, 3, true).score <= visibleScore + 1e-8);
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    await page.locator("#undoPathPointButton").click(); assert.deepEqual(await page.evaluate(() => currentPath()), initial);
    assert.deepEqual(await page.evaluate(() => bestPathsByDmc["310"]), stopped);
    await page.locator("#restoreBestPathButton").click(); assert.deepEqual(await page.evaluate(() => currentPath()), stopped);
    await page.evaluate(() => { segmentsInactivity = 500; segmentsReports = []; });
    await page.locator("#segmentsOptimizeButton").click();
    await page.waitForFunction(() => !pathAlgorithmRunning && segmentsReports.some(s => s.type === "complete"));
    const result = await page.evaluate(() => segmentsReports.at(-1));
    assert.equal(result.stopAfterInactivity, true);
    assert.equal(result.stagnationLimitMs, 500);
    assert.notEqual(result.reason, "time-limit");
    assert.ok(result.segmentSearch.repairs > 0);
    let previous = model.metrics(stopped, 3, true).score;
    for (const s of await page.evaluate(() => segmentsReports.filter(s => s.path))) {
      assert.equal(model.validateRoute(s.path, points), ""); assert.ok(s.metrics.score <= previous + 1e-8); previous = s.metrics.score;
    }
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    await page.evaluate(() => plannerSaveQueue); await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert);
    await page.locator('[data-step="paths"]').click();
    assert.equal(model.validateRoute(await page.evaluate(() => currentPath()), points), "");
    assert.ok(await page.locator("#sectionsOptimizeButton").isEnabled());
    assert.deepEqual(errors, []);
    console.log("segments planner passed: real worker, inactivity, global gains, feedback, desktop/mobile, stop, undo, best recovery, completion, reload");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
