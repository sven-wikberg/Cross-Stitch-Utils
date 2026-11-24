const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const model = require("../src/stitch-model.js");

async function installHarness(page, real = false) {
  await page.evaluate(real => {
    window.batchRuns = [];
    for (const [mode, name] of Object.entries({ normal: "createPathOptimizerWorker", adaptive: "createAdaptivePathOptimizerWorker",
      points: "createPointsDiagonalWorker", sections: "createSectionOptimizerWorker", segments: "createSegmentOptimizerWorker",
      deep: "createDeepPathOptimizerWorker", chains: "createChainOptimizerWorker", relay: "createRelayOptimizerWorker" })) {
      const create = window[name];
      window[name] = () => {
        const worker = real ? create() : new EventTarget();
        const post = real ? worker.postMessage.bind(worker) : () => {};
        const terminate = real ? worker.terminate.bind(worker) : () => {};
        const run = { mode, worker, stopped: false, reports: [] };
        worker.postMessage = message => {
          run.message = structuredClone(message); run.dmc = selectedDmc; batchRuns.push(run);
          post({ ...message, totalLimitMs: 100, stagnationLimitMs: 20 });
        };
        worker.terminate = () => { run.stopped = true; terminate(); };
        worker.addEventListener("message", event => run.reports.push(event.data));
        return worker;
      };
    }
    window.deliverBatch = (route, type = "complete") => {
      const run = batchRuns.at(-1), metrics = StitchModel.metrics(route, cutThreshold, true);
      const method = { normal: "block-optimization", adaptive: "adaptive-optimization", points: "points-diagonals",
        sections: "point-sections", segments: "segment-optimization", deep: "deep-optimization", chains: "chain-reinsertion", relay: "relay-optimization" }[run.mode];
      run.worker.dispatchEvent(new MessageEvent("message", { data: { type, runId: run.message.runId, path: route,
        method, stage: type === "complete" ? "complete" : "search", phase: "Verification du lot", metrics,
        initialMetrics: metrics, elapsedMs: 100, progress: type === "complete" ? 100 : 50,
        stopAfterInactivity: run.message.stopAfterInactivity, stagnationLimitMs: run.message.stagnationLimitMs,
        untilStable: run.message.untilStable } }));
      if (type === "progress") flushAdvancedPathSnapshot();
    };
  }, real);
}

async function run() {
  const root = path.resolve(__dirname, ".."), output = path.join(root, "exports/verification");
  await fs.mkdir(output, { recursive: true });
  const points = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 7, y: 2 }, { x: 8, y: 2 }, { x: 6, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 6 }];
  const other = [{ x: 9, y: 7 }, { x: 10, y: 7 }];
  const colors = [{ dmc: "310", symbol: "A", hex: "#111111" }, { dmc: "321", symbol: "B", hex: "#cd2444" }, { dmc: "BLANC", symbol: "C", hex: "#ffffff" }];
  const pattern = { kind: "cross-stitch-pattern", schemaVersion: 1, project: { name: "Test des phases automatiques" }, colors,
    grid: { width: 12, height: 9, cells: Array.from({ length: 108 }, (_, i) => {
      const x = i % 12, y = Math.floor(i / 12);
      const dmc = points.some(p => p.x === x && p.y === y) ? "310" : other.some(p => p.x === x && p.y === y) ? "321" : null;
      return { x, y, empty: !dmc, dmc, symbol: dmc === "310" ? "A" : dmc ? "B" : null };
    }) } };
  let seed = 41;
  const routes = Array.from({ length: 100 }, () => {
    const order = points.slice();
    for (let i = order.length - 1; i > 0; i--) { seed = (seed * 1664525 + 1013904223) >>> 0; const j = seed % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    return model.expandCells(order, 10);
  }).sort((a, b) => model.metrics(a, 10, true).score - model.metrics(b, 10, true).score);
  const best = routes[0], middle = routes[50], worst = routes[99], second = model.expandCells(other, 10);
  assert.ok(model.metrics(worst, 10, true).score > model.metrics(middle, 10, true).score);
  assert.ok(model.metrics(middle, 10, true).score > model.metrics(best, 10, true).score);
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const load = async target => {
    await target.goto(pathToFileURL(path.join(root, "plan-paths.html")).href);
    await target.waitForFunction(() => !document.querySelector("main").inert);
    await target.locator("#patternJsonFile").setInputFiles({ name: "batch.pattern.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(pattern)) });
    await target.waitForFunction(() => loadedPattern?.project.name === "Test des phases automatiques");
  };
  const deliver = async route => { await page.evaluate(route => deliverBatch(route), route); };
  const phase = async mode => {
    await page.waitForFunction(mode => batchRuns.at(-1)?.mode === mode && pathAlgorithmRunning, mode);
    assert.equal(await page.locator("#batchOptimizeButton").isDisabled(), true);
    assert.equal(await page.locator("#currentColorOptimizeButton").isDisabled(), true);
  };
  try {
    await load(page); await installHarness(page);
    assert.deepEqual(await page.locator("#optimizedPathButton").evaluate(button =>
      [...button.parentElement.querySelectorAll("button")].map(item => item.id)),
      ["optimizedPathButton", "segmentsOptimizeButton", "pointsOptimizeButton", "sectionsOptimizeButton", "adaptiveOptimizeButton", "lnsOptimizeButton"]);
    assert.match(await page.locator("#deepOptimizeButton").textContent(), /Moteur 6.*1 h/);
    await page.evaluate(() => { batchPlan = PathBatchPlan.prepare({ pending: ["310", "321", "BLANC"], results: [] }, null); });
    await page.locator("#batchOptimizeButton").click(); await phase("normal");
    await deliver(worst); await phase("segments");
    assert.deepEqual(await page.evaluate(() => batchRuns.at(-1).message.initialPath), worst);
    assert.equal(await page.evaluate(() => batchRuns.at(-1).message.stopAfterInactivity), true);
    assert.equal(await page.evaluate(() => batchRuns.at(-1).message.totalLimitMs), undefined);
    await page.evaluate(route => deliverBatch(route, "progress"), middle);
    await page.locator("#stopPathAlgorithmButton").click();
    assert.equal(await page.evaluate(() => batchPlan.current.phase), "segments");
    assert.equal(await page.evaluate(() => batchPlan.results.length), 0);
    await page.evaluate(() => plannerSaveQueue); await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert);
    await page.locator('[data-step="paths"]').click();
    assert.deepEqual(await page.evaluate(() => currentPath()), middle);
    assert.ok(await page.evaluate(() => pathSearchStatsByDmc["310"].totals.segments.gain > 0), "Accepted gains survive stop and reload");
    assert.match(await page.locator("#batchStatus").textContent(), /Moteur 2.*en pause/);
    await installHarness(page);
    await page.locator("#batchOptimizeButton").click(); await phase("segments");
    assert.deepEqual(await page.evaluate(() => batchRuns.at(-1).message.initialPath), middle);
    await page.evaluate(() => batchRuns.at(-1).worker.dispatchEvent(new ErrorEvent("error", { message: "Test interruption" })));
    assert.equal(await page.evaluate(() => batchRunning), false);
    assert.equal(await page.evaluate(() => batchPlan.current.phase), "segments");
    await page.locator("#batchOptimizeButton").click(); await phase("segments");
    await deliver(worst); await phase("points");
    assert.deepEqual(await page.evaluate(() => batchRuns.at(-1).message.initialPath), middle, "A worse phase result is rejected");
    await deliver(middle); await phase("sections");
    await deliver(middle); await phase("adaptive");
    await deliver(middle); await phase("deep");
    assert.equal(await page.evaluate(() => batchRuns.at(-1).message.stopAfterInactivity), true);
    assert.equal(await page.evaluate(() => batchRuns.at(-1).message.totalLimitMs), undefined);
    assert.equal(await page.evaluate(() => activePathOptimizerDeadlineTimer), null);
    await deliver(middle); await phase("chains");
    assert.equal(await page.evaluate(() => batchRuns.at(-1).message.untilStable), true);
    assert.equal(await page.evaluate(() => batchRuns.at(-1).message.totalLimitMs), undefined);
    await page.evaluate(route => deliverBatch(route, "progress"), best);
    assert.ok(await page.evaluate(() => pathImprovement));
    assert.match(await page.locator("#batchStatus").textContent(), /Couleur 1 \/ 3.*cycle 1.*Boucle 1/);
    assert.match(await page.locator("#batchCycleGain").textContent(), /Gain du cycle : \+/);
    const gains = await page.evaluate(() => pathSearchStatsByDmc["310"]);
    assert.ok(Math.abs(gains.totals.segments.gain - (model.metrics(worst, 10, true).score - model.metrics(middle, 10, true).score)) < 1e-8);
    assert.ok(Math.abs(gains.totals.chains.gain - (model.metrics(middle, 10, true).score - model.metrics(best, 10, true).score)) < 1e-8);
    assert.equal(gains.totals.adaptive.gain, 0, "A no-gain engine is measured too");
    assert.equal(gains.totals.deep.gain, 0, "Automatic M6 contributes its own measurements");
    assert.equal(gains.totals.relay, undefined, "A not-yet-run loop stays distinct from a zero-gain loop");
    assert.equal(await page.locator('#pathGainRows [data-mode="adaptive"] td').first().textContent(), "0");
    assert.match(await page.locator('#pathGainRows [data-mode="segments"] th').textContent(), /M2.*raccordements/);
    assert.match(await page.locator('#pathGainRows [data-mode="adaptive"] th').textContent(), /M5.*adaptatif/);
    assert.match(await page.locator('#pathGainRows [data-mode="deep"] th').textContent(), /M6.*approfondie/);
    assert.equal(await page.locator('#pathGainRows [data-mode="relay"] td').first().textContent(), "-");
    assert.equal(await page.locator('#pathGainRows [data-mode="chains"]').evaluate(row => row.classList.contains("active")), true);
    assert.ok(await page.evaluate(() => {
      const data = pathScoreHistory.getContext("2d").getImageData(0, 0, pathScoreHistory.width, pathScoreHistory.height).data;
      return ["segments", "chains"].every(mode => {
        const rgb = PathSearchStats.modes[mode].color.match(/\w\w/g).map(value => parseInt(value, 16));
        for (let i = 0; i < data.length; i += 4) if (rgb.every((value, c) => Math.abs(data[i + c] - value) < 4) && data[i + 3] > 200) return true;
        return false;
      });
    }), "The actual curve contains each contributing engine's color");
    await page.locator("#pathScoreHistory").focus(); await page.keyboard.press("Home");
    assert.ok(await page.locator("#pathScoreReading").textContent());
    await page.keyboard.press("End");
    assert.match(await page.locator("#pathScoreReading").textContent(), /Boucle 1/);
    await page.screenshot({ path: path.join(output, "planner-batch-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(output, "planner-batch-mobile.png"), fullPage: true });
    await deliver(best); await phase("chains");
    assert.equal(await page.evaluate(() => batchPlan.current.pass), 2);
    await deliver(best); await phase("relay"); await deliver(best); await phase("chains");
    assert.equal(await page.evaluate(() => batchPlan.current.cycle), 1);
    assert.equal(await page.evaluate(() => batchPlan.current.loopRound), 2);
    assert.match(await page.locator("#batchStatus").textContent(), /cycle 1.*duo 2.*Boucle 1/);
    await deliver(best); await phase("relay"); await deliver(best); await phase("normal");
    assert.equal(await page.evaluate(() => batchPlan.current.cycle), 2);
    for (const next of ["segments", "points", "sections", "adaptive", "deep", "chains", "relay", "normal"]) {
      await deliver(best); await phase(next);
    }
    assert.equal(await page.evaluate(() => selectedDmc), "321");
    assert.equal(await page.locator('#pathGainRows [data-mode="adaptive"] td').first().textContent(), "-", "Color statistics never leak to the next color");
    assert.deepEqual(await page.evaluate(() => bestPathsByDmc["310"]), best);
    for (const next of ["segments", "points", "sections", "adaptive", "deep", "chains", "relay"]) {
      await deliver(second); await phase(next);
    }
    await deliver(second);
    await page.waitForFunction(() => !batchRunning && !pathAlgorithmRunning);
    assert.equal(await page.evaluate(() => batchPlan.results.length), 3, "An unused color does not block the batch");
    assert.deepEqual(errors, []);
    assert.match(await page.locator("#batchStatus").textContent(), /3 couleurs terminees/);
    assert.deepEqual(await page.evaluate(() => batchRuns.map(r => r.mode)),
      ["segments", "segments", "points", "sections", "adaptive", "deep", "chains", "chains", "relay",
        "chains", "relay",
        "normal", "segments", "points", "sections", "adaptive", "deep", "chains", "relay",
        "normal", "segments", "points", "sections", "adaptive", "deep", "chains", "relay"]);
    const completedStats = await page.evaluate(() => pathSearchStatsByDmc);
    await page.locator("#undoPathPointButton").click();
    assert.equal(await page.evaluate(() => batchPlan.current.phase), "relay");
    assert.equal(await page.evaluate(() => batchPlan.results.length), 2);
    await page.locator("#redoPathActionButton").click();
    assert.equal(await page.evaluate(() => batchPlan.results.length), 3);
    assert.deepEqual(await page.evaluate(() => pathSearchStatsByDmc), completedStats, "Undo/redo restores exact attribution, not double-counted gains");
    await page.evaluate(() => { batchPlan = PathBatchPlan.prepare({ pending: ["321"], results: [] }, 3); renderPathTool(); });
    await page.locator("#relayOptimizeButton").click(); await deliver(second);
    assert.equal(await page.evaluate(() => batchPlan.results.length), 0, "A manual engine cannot complete the batch");
    assert.deepEqual(await page.evaluate(() => batchPlan.pending), ["321"]);
    const otherBefore = await page.evaluate(() => pathsByDmc["310"]);
    await page.locator("#currentColorOptimizeButton").click(); await phase("normal");
    assert.equal(await page.evaluate(() => batchPlan.scope), "color");
    assert.deepEqual(await page.evaluate(() => batchPlan.pending), ["321"]);
    for (const next of ["segments", "points", "sections", "adaptive", "deep", "chains", "relay"]) {
      await deliver(second); await phase(next);
    }
    await deliver(second);
    await page.waitForFunction(() => !batchRunning && !pathAlgorithmRunning);
    assert.deepEqual(await page.evaluate(() => pathsByDmc["310"]), otherBefore);
    assert.equal(await page.evaluate(() => batchPlan.results.length), 1);
    assert.match(await page.locator("#batchStatus").textContent(), /1 couleur terminee.*cycle complet sans gain/);
    assert.deepEqual(errors, []);
    await page.locator('#pathColorLegend [data-dmc="310"]').click();
    const beforeSettings = await page.evaluate(() => pathSearchStatsByDmc);
    assert.ok(await page.locator('#pathGainRows [data-mode="chains"] td').first().textContent() !== "-");
    await page.evaluate(() => { beginPathEdit("Test sans modification"); finishPathEdit(); });
    assert.deepEqual(await page.evaluate(() => pathSearchStatsByDmc), beforeSettings, "An unchanged manual action does not erase the measurements");
    await page.locator("#cutThresholdInput").fill("8");
    await page.locator("#cutThresholdInput").dispatchEvent("change");
    assert.deepEqual(await page.evaluate(() => pathSearchStatsByDmc), {}, "A new objective cannot reuse gains measured with a different score");
    await page.locator("#undoPathPointButton").click();
    assert.deepEqual(await page.evaluate(() => pathSearchStatsByDmc), beforeSettings);
    page.once("dialog", dialog => dialog.accept());
    await page.locator("#clearPathButton").click();
    assert.equal(await page.evaluate(() => pathSearchStatsByDmc["310"]), undefined);
    await page.locator("#undoPathPointButton").click();
    assert.deepEqual(await page.evaluate(() => pathSearchStatsByDmc), beforeSettings);
    await page.evaluate(() => plannerSaveQueue); await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert);
    await page.locator('[data-step="paths"]').click();
    assert.deepEqual(await page.evaluate(() => pathSearchStatsByDmc), beforeSettings, "All color totals persist, including the finished ones");

    const realPage = await browser.newPage();
    realPage.on("pageerror", error => errors.push(error.message));
    await load(realPage); await installHarness(realPage, true);
    await realPage.locator("#batchOptimizeButton").click();
    await realPage.waitForFunction(() => !pathAlgorithmRunning && !batchRunning && batchPlan.results.length === 3);
    const realRuns = await realPage.evaluate(() => batchRuns.map(r => ({ mode: r.mode, dmc: r.dmc, message: r.message, reports: r.reports })));
    for (const [dmc, cells] of [["310", points], ["321", other]]) {
      const runs = realRuns.filter(r => r.dmc === dmc);
      assert.deepEqual(runs.slice(0, 7).map(r => r.mode), ["normal", "segments", "points", "sections", "adaptive", "deep", "chains"]);
      assert.ok(runs.filter(r => r.mode === "deep").every(r => r.message.stopAfterInactivity === true && r.message.totalLimitMs === undefined), "Automatic M6 uses inactivity, not the one-hour command");
      assert.equal(runs.at(-1).mode, "relay");
      let previous = Infinity;
      for (const r of runs) {
        const completed = r.reports.find(s => s.type === "complete");
        assert.ok(completed, `${r.mode} completed`);
        assert.equal(model.validateRoute(completed.path, cells), "");
        const score = model.metrics(completed.path, 10, true).score;
        assert.ok(score <= previous + 1e-8); previous = score;
      }
      assert.equal(model.validateRoute(await realPage.evaluate(dmc => pathsByDmc[dmc], dmc), cells), "");
    }
    assert.deepEqual(errors, []);
    console.log("batch planner passed: all eight phases, per-loop and paired-loop stabilization, full cycles, one/all colors, real workers, best protection, feedback, stop/reload, errors, undo/redo, manual isolation, unused colors");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
