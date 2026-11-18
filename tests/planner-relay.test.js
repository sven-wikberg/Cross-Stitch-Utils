const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const model = require("../src/stitch-model.js");
async function run() {
  const root = path.resolve(__dirname, ".."), output = path.join(root, "exports/verification");
  await fs.mkdir(output, { recursive: true });
  const points = require("./fixtures/combined-search.js").cutAware, keys = new Set(points.map(model.cellKey));
  const pattern = { kind: "cross-stitch-pattern", schemaVersion: 1, project: { name: "Relais au plateau" },
    colors: [{ dmc: "310", symbol: "A", hex: "#111111" }], grid: { width: 14, height: 12,
      cells: Array.from({ length: 168 }, (_, i) => { const x = i % 14, y = Math.floor(i / 14), filled = keys.has(`${x},${y}`);
        return { x, y, empty: !filled, dmc: filled ? "310" : null, symbol: filled ? "A" : null }; }) } };
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(pathToFileURL(path.join(root, "plan-paths.html")).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    assert.equal(await page.locator("#optimizeRegionButton, #pathRegionStatus, #pathSelectMode, #pathClearSelection").count(), 0);
    assert.equal(await page.evaluate(() => typeof window.createRegionOptimizerWorker), "undefined");
    assert.equal(await page.locator('script[src*="region-optimizer"]').count(), 0);
    await page.locator("#patternJsonFile").setInputFiles({ name: "relay.pattern.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(pattern)) });
    await page.waitForFunction(() => loadedPattern?.project.name === "Relais au plateau");
    await page.locator("#cutThresholdInput").fill("3"); await page.locator("#cutThresholdInput").dispatchEvent("change");
    await page.evaluate(() => {
      window.relayReports = [];
      const original = window.createPathOptimizerWorker;
      window.createPathOptimizerWorker = () => {
        const worker = original();
        worker.addEventListener("message", e => {
          const s = e.data;
          if (s.stage === "relay" || s.stage === "search" || s.type === "complete") {
            relayReports.push({ stage: s.stage, score: s.metrics?.score, relays: s.relayImprovements || 0,
              lastRelayImprovement: s.lastRelayImprovement });
          }
        });
        return worker;
      };
    });
    await page.locator("#optimizedPathButton").click();
    await page.waitForFunction(() => !pathAlgorithmRunning && relayReports.some(s => s.stage === "complete"));
    const result = await page.evaluate(() => ({ path: currentPath(), reports: relayReports,
      highlights: pathImprovement?.relayDiagonals || [], score: pathPerformanceMetrics(currentPath(), selectedDmc).score }));
    assert.equal(model.validateRoute(result.path, points), "");
    assert.ok(result.score < 41);
    assert.ok(result.highlights.length > 0, JSON.stringify(result.reports));
    const lastRelay = result.reports.at(-1).lastRelayImprovement;
    assert.ok(lastRelay);
    assert.equal(await page.locator("#pathLastRelayPosition").innerText(), `${lastRelay.rank} / ${lastRelay.total}`);
    assert.ok(await page.locator("#pathLastRelay").isVisible());
    const firstRelay = result.reports.findIndex(s => s.stage === "relay");
    assert.ok(firstRelay >= 0 && result.reports.slice(firstRelay + 1).some(s => s.stage === "search" && s.relays > 0));
    await page.locator("#pathDetails summary").click();
    assert.ok(Number(await page.locator("#pathRelayImprovements").textContent()) >= 1);
    await page.screenshot({ path: path.join(output, "planner-relay-desktop.png"), fullPage: true });
    // Inspect the real relay progress presentation without changing any route or saved state.
    await page.evaluate(() => {
      pathAlgorithmRunning = true;
      const lastRelayImprovement = { rank: 45, total: 76, length: Math.sqrt(13), pass: 2 };
      for (const stage of ["search", "relay"]) showAdvancedPathFeedback({ stage, relayPasses: 3,
        relay: { examined: 5, total: 12 }, relayImprovements: 1, elapsedMs: 1000, lastRelayImprovement });
    });
    assert.match(await page.locator("#pathAlgorithmDistance").innerText(), /Recherche de relais : passe 3/);
    assert.equal(await page.locator("#pathLastRelayPosition").innerText(), "45 / 76");
    assert.equal(await page.locator("#pathLastRelayLength").innerText(), "3.6 cases avant");
    assert.match(await page.locator("#pathLastRelay").getAttribute("title"), /Passe 2, rang par cout/);
    assert.equal(await page.locator("#pathAlgorithmProgress").getAttribute("max"), "12");
    assert.equal(await page.locator("#pathAlgorithmProgress").getAttribute("value"), "5");
    await page.screenshot({ path: path.join(output, "planner-relay-progress.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(output, "planner-relay-mobile.png"), fullPage: true });
    await page.evaluate(() => resetAlgorithmLiveMetrics());
    assert.equal(await page.locator("#pathLastRelay").isVisible(), false);
    await page.evaluate(() => {
      pathAlgorithmRunning = false; renderPathTool(); window.relayStopSeen = false;
      const original = window.createPathOptimizerWorker;
      window.createPathOptimizerWorker = () => {
        const worker = original();
        worker.addEventListener("message", e => {
          if (e.data.stage === "relay" && !relayStopSeen) {
            relayStopSeen = true; queueMicrotask(() => stopAdvancedPathSearch());
          }
        });
        return worker;
      };
    });
    await page.locator("#optimizedPathButton").click();
    await page.waitForFunction(() => relayStopSeen && !pathAlgorithmRunning);
    const stopped = await page.evaluate(() => currentPath());
    assert.equal(model.validateRoute(stopped, points), "");
    assert.ok(model.metrics(stopped, 3, true).score <= result.score + 1e-8);
    assert.ok(await page.locator("#optimizedPathButton").isEnabled());
    assert.equal(await page.locator("#pathLastRelay").isVisible(), false, "A new run without a relay gain has no stale rank");
    assert.deepEqual(errors, []);
    console.log("relay UI passed: real worker plateau/resume/stop, single-diagonal highlight, global gain, progress counts and mobile layout");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
