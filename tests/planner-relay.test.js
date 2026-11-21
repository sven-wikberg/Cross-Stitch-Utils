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
  const pattern = { kind: "cross-stitch-pattern", schemaVersion: 1, project: { name: "Relais independants" },
    colors: [{ dmc: "310", symbol: "A", hex: "#111111" }], grid: { width: 14, height: 12,
      cells: Array.from({ length: 168 }, (_, i) => { const x = i % 14, y = Math.floor(i / 14), filled = keys.has(`${x},${y}`);
        return { x, y, empty: !filled, dmc: filled ? "310" : null, symbol: filled ? "A" : null }; }) } };
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(pathToFileURL(path.join(root, "plan-paths.html")).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    await page.locator("#patternJsonFile").setInputFiles({ name: "relay.pattern.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(pattern)) });
    await page.waitForFunction(() => loadedPattern?.project.name === "Relais independants");
    assert.ok(await page.locator("#relayOptimizeButton").isDisabled());
    await page.locator("#cutThresholdInput").fill("3"); await page.locator("#cutThresholdInput").dispatchEvent("change");
    await page.locator("#pathStagnationLimit").selectOption("10000");
    await page.evaluate(() => {
      window.baseReports = []; window.relayReports = []; window.relayStop = false; window.relayStopSeen = false;
      const base = window.createPathOptimizerWorker, relay = window.createRelayOptimizerWorker;
      window.createPathOptimizerWorker = () => {
        const worker = base(); worker.addEventListener("message", event => baseReports.push(event.data)); return worker;
      };
      window.createRelayOptimizerWorker = () => {
        const worker = relay();
        worker.addEventListener("message", event => {
          relayReports.push(event.data);
          if (relayStop && event.data.stage === "relay" && !relayStopSeen) {
            relayStopSeen = true; setTimeout(() => document.querySelector("#stopPathAlgorithmButton").click(), 0);
          }
        });
        return worker;
      };
    });
    await page.locator("#optimizedPathButton").click();
    await page.waitForFunction(() => !pathAlgorithmRunning && baseReports.some(s => s.type === "complete"));
    const base = await page.evaluate(() => ({ path: currentPath(), reports: baseReports }));
    assert.ok(base.reports.every(s => s.stage !== "relay"));
    assert.ok(await page.locator("#relayOptimizeButton").isEnabled());
    await page.locator("#relayOptimizeButton").click();
    await page.waitForFunction(() => !pathAlgorithmRunning && relayReports.some(s => s.type === "complete"));
    const result = await page.evaluate(() => ({ path: currentPath(), reports: relayReports, highlights: pathImprovement?.relayDiagonals || [] }));
    const final = result.reports.at(-1);
    assert.equal(final.reason, "exhausted"); assert.ok(final.improvements > 0);
    assert.equal(model.validateRoute(result.path, points), "");
    assert.ok(model.metrics(result.path, 3, true).score < model.metrics(base.path, 3, true).score);
    assert.ok(result.highlights.length > 0);
    assert.ok(result.reports.every(s => ["relay", "complete"].includes(s.stage)));
    assert.equal(final.relay.examined, final.relay.total);
    assert.equal(await page.locator("#pathLastRelayPosition").innerText(), `${final.lastRelayImprovement.rank} / ${final.lastRelayImprovement.total}`);
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    assert.equal(await page.locator("#pathStagnationLimit").inputValue(), "10000");
    await page.locator("#undoPathPointButton").click();
    assert.deepEqual(await page.evaluate(() => currentPath()), base.path);
    assert.deepEqual(await page.evaluate(() => bestPathsByDmc["310"]), result.path);
    await page.locator("#restoreBestPathButton").click();
    assert.deepEqual(await page.evaluate(() => currentPath()), result.path);
    // Render a mid-neighborhood report against the actual retained route.
    await page.evaluate(() => {
      pathAlgorithmRunning = true;
      showAdvancedPathFeedback({ method: "relay-optimization", stage: "relay", phase: "Recherche de relais : passe 3",
        relayPasses: 3, relay: { examined: 4, total: 12, candidateCount: 64, candidatesExamined: 45 },
        lastRelayImprovement: { rank: 5, total: 16, length: 7, pass: 2 }, elapsedMs: 3000 });
    });
    assert.equal(await page.locator("#pathRelayCandidates").innerText(), "45 / 64");
    assert.equal(await page.locator("#pathAlgorithmClockLabel").innerText(), "Liaisons examinees");
    assert.equal(await page.locator("#pathAlgorithmProgress").getAttribute("max"), "12");
    assert.equal(await page.locator("#pathAlgorithmProgress").getAttribute("value"), "4");
    await page.screenshot({ path: path.join(output, "planner-relay-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(output, "planner-relay-mobile.png"), fullPage: true });
    await page.evaluate(() => { pathAlgorithmRunning = false; renderPathTool(); relayStop = true; relayReports = []; });
    await page.locator("#relayOptimizeButton").click();
    await page.waitForFunction(() => relayStopSeen && !pathAlgorithmRunning);
    assert.deepEqual(await page.evaluate(() => currentPath()), result.path);
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    assert.ok(await page.locator("#optimizedPathButton").isEnabled());
    assert.equal(await page.locator("#pathLastRelay").isVisible(), false);
    await page.evaluate(() => plannerSaveQueue); await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert);
    await page.locator('[data-step="paths"]').click();
    assert.deepEqual(await page.evaluate(() => currentPath()), result.path);
    assert.deepEqual(errors, []);
    console.log("standalone relay UI passed: separation, real worker, gains, candidate counts, desktop/mobile, undo, best, stop, reload");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
