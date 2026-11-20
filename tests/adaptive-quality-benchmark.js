const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder: builder } = require("../src/orthogonal-path-worker.js");
const { createRelaySearch: relay } = require("../src/relay-search.js");
const { createBlockOptimizer: blocks } = require("../src/block-optimizer-worker.js");
const { createDeepOptimizer: deep, createLnsSearch: lns } = require("../src/deep-optimizer-worker.js");
const { createAdaptiveOptimizer: adaptive } = require("../src/adaptive-optimizer-worker.js");
const fixtures = require("./fixtures/combined-search.js");
const budget = Number(process.env.BENCHMARK_MS) || 1000;
const seeds = (process.env.BENCHMARK_SEEDS || "31,73,101").split(",").map(Number);
const cases = ["timerRecovery", "interleaved", "bridge", "cutAware"].map(name => ({ name, points: fixtures[name], threshold: 3 }));
if (process.env.BENCHMARK_LARGE) {
  const saved = require("../data/patterns/33bfcc0bf2848cf99a30abae5acd47b03b35046d3f22728961abb8120a1de627.json");
  const points = saved.pattern.grid.cells.filter(p => !p.empty && p.dmc === "3688");
  cases.push({ name: "Marine Cryptids DMC 3688", points, threshold: 10,
    initialPath: saved.paths.find(p => p.dmc === "3688").points });
}
if (process.env.BENCHMARK_ONLY_LARGE) cases.splice(0, 4);
const rows = [];
for (const fixture of cases) for (const seed of seeds) {
  const initialPath = fixture.initialPath || model.expandCells(fixture.points, fixture.threshold);
  const results = {};
  for (const name of ["blocks", "deep", "adaptive"]) {
    let state = seed;
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32), clock = () => performance.now();
    const search = name === "blocks" ? blocks(model, builder, clock, random, relay)
      : name === "deep" ? deep(model, builder, blocks, relay, lns, clock, random) : adaptive(model, builder, relay, clock, random, blocks);
    const start = performance.now(); let previous = model.metrics(initialPath, fixture.threshold, true).score;
    const result = search.optimizePath({ points: fixture.points, initialPath, cutThreshold: fixture.threshold,
      totalLimitMs: budget, maxDurationMs: budget, stagnationLimitMs: budget, warmupMs: budget / 10 }, s => {
      if (!s.path || model.validateRoute(s.path, fixture.points)) return;
      const score = model.metrics(s.path, fixture.threshold, true).score;
      assert.ok(score <= previous + 1e-7); previous = score;
    });
    assert.equal(model.validateRoute(result.path, fixture.points), "");
    const metrics = model.metrics(result.path, fixture.threshold, true);
    assert.ok(metrics.score <= model.metrics(initialPath, fixture.threshold, true).score + 1e-7);
    results[name] = { score: metrics.score, cuts: metrics.cuts, elapsedMs: performance.now() - start, attempts: result.attempts };
  }
  rows.push({ fixture: fixture.name, crosses: fixture.points.length, seed, budget, initial: model.metrics(initialPath, fixture.threshold, true).score, results });
  console.log(`${fixture.name} (${fixture.points.length}) seed ${seed}: ${Object.entries(results).map(([k, v]) => `${k}=${v.score.toFixed(3)} (${Math.round(v.elapsedMs)}ms)`).join("; ")}`);
}
const output = path.resolve(__dirname, `../exports/verification/adaptive-benchmark-${budget}${process.env.BENCHMARK_ONLY_LARGE ? "-large" : ""}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ note: "Same starting route, objective and wall-clock budget; elapsed time includes setup/finalization. Fixed random seeds do not make time-limited results deterministic. No global optimality claim.", rows }, null, 2));
console.log(output);
