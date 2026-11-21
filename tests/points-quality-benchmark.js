const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const model = require("../src/stitch-model.js");
const { createPointOrderSearch: pointSearch } = require("../src/point-order-search.js");
const { createOrthogonalPathBuilder: builder } = require("../src/orthogonal-path-worker.js");
const { createRelaySearch: relay } = require("../src/relay-search.js");
const { createBlockOptimizer: blocks } = require("../src/block-optimizer-worker.js");
const { createAdaptiveOptimizer: adaptive } = require("../src/adaptive-optimizer-worker.js");
const { createPointsDiagonalOptimizer: pointsEngine } = require("../src/points-diagonals-worker.js");
const fixtures = require("./fixtures/combined-search.js");
const budget = Number(process.env.BENCHMARK_MS) || 1000;
const seeds = (process.env.BENCHMARK_SEEDS || "31,73").split(",").map(Number);
const engines = (process.env.BENCHMARK_ENGINES || "adaptive,points").split(",");
const cases = ["timerRecovery", "interleaved", "bridge", "cutAware"].map(name => ({ name, points: fixtures[name], threshold: 3 }));
if (process.env.BENCHMARK_LARGE) {
  const saved = process.env.BENCHMARK_PATTERN_REF
    ? JSON.parse(require("node:child_process").execFileSync("git", ["show", process.env.BENCHMARK_PATTERN_REF], { encoding: "utf8", maxBuffer: 100000000 }))
    : require("../data/patterns/33bfcc0bf2848cf99a30abae5acd47b03b35046d3f22728961abb8120a1de627.json");
  const dmc = process.env.BENCHMARK_COLOR || "3810", points = saved.pattern.grid.cells.filter(p => !p.empty && p.dmc === dmc);
  cases.splice(0, cases.length, { name: `Marine Cryptids DMC ${dmc}`, points, threshold: 10, initialPath: saved.paths.find(p => p.dmc === dmc).points });
}
const rows = [];
for (const fixture of cases) for (const seed of seeds) {
  const initialPath = fixture.initialPath || model.expandCells(fixture.points, fixture.threshold), input = JSON.stringify(initialPath), results = {};
  for (const name of engines) {
    let randomState = seed, lastReport = 0;
    const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 2 ** 32), clock = () => performance.now();
    const search = name === "adaptive" ? adaptive(model, builder, relay, clock, random, blocks)
      : pointsEngine(model, pointSearch, builder, relay, adaptive, clock, random);
    let previous = model.metrics(initialPath, fixture.threshold, true).score;
    const started = performance.now(), result = search.optimizePath({ points: fixture.points, initialPath,
      cutThreshold: fixture.threshold, totalLimitMs: budget }, snapshot => {
      if (snapshot.path) {
        assert.equal(model.validateRoute(snapshot.path, fixture.points), "");
        const score = model.metrics(snapshot.path, fixture.threshold, true).score;
        assert.ok(score <= previous + 1e-7); assert.ok(Math.abs(score - snapshot.metrics.score) < 1e-7); previous = score;
      }
      if (snapshot.elapsedMs - lastReport > 10000) {
        lastReport = snapshot.elapsedMs;
        console.log(name, Math.round(snapshot.elapsedMs / 1000), snapshot.phase, snapshot.metrics?.score.toFixed(3));
      }
    });
    assert.equal(model.validateRoute(result.path, fixture.points), ""); assert.equal(JSON.stringify(initialPath), input);
    results[name] = { ...model.metrics(result.path, fixture.threshold, true), elapsedMs: performance.now() - started,
      improvements: result.improvements, attempts: result.attempts, pointsSearch: result.pointsSearch, lns: result.lns };
  }
  rows.push({ fixture: fixture.name, crosses: fixture.points.length, seed, budget,
    initial: model.metrics(initialPath, fixture.threshold, true).score, results });
  console.log(`${fixture.name}, seed ${seed}: ${Object.entries(results).map(([name, r]) => `${name}=${r.score.toFixed(3)} (${Math.round(r.elapsedMs)}ms)`).join("; ")}`);
}
const output = path.resolve(__dirname, `../exports/verification/points-benchmark-${budget}-${process.env.BENCHMARK_LARGE ? "large" : "small"}${process.env.BENCHMARK_PATTERN_REF ? "-saved" : ""}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ note: "Same input, real hole-to-hole score and wall-time budget. Randomized heuristics, no general optimality claim. Source pattern and progress remain unchanged.", rows }, null, 2));
console.log(output);
