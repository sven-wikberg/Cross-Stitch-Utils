const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createBlockOptimizer } = require("../src/block-optimizer-worker.js");
const fixtures = require("./fixtures/combined-search.js");

const root = path.resolve(__dirname, ".."), baselineRevision = "ffe7428";
const baseline = { exports: {} };
const source = execFileSync("git", ["show", `${baselineRevision}:src/block-optimizer-worker.js`], { cwd: root, encoding: "utf8" });
// Same V8 context for both engines: avoid cross-context overhead in the wall-time comparison.
vm.runInThisContext(`(function(module, globalThis) { ${source}\n})`, { filename: "baseline-block-optimizer.js" })(baseline, {});
const cases = [
  { name: "intermediate-order", points: fixtures.intermediate, budget: 1200 },
  { name: "combined-cut", points: fixtures.cutAware, threshold: 3, budget: 20000 },
  { name: "interleaved-restarts", points: fixtures.interleaved, budget: 8000 },
  { name: "unit-optimal-bridge", points: fixtures.bridge, budget: 1200 },
  { name: "small-blocks", points: fixtures.smallBlocks, budget: 1200 },
  { name: "large-islands", points: require("../data/examples/grands-ilots.pattern.json").grid.cells.filter(cell => !cell.empty), budget: 1200 }
];
const seeds = [31, 73, 101];
const wallLimit = Number(process.env.BENCHMARK_WALL_MS) || 0;

function run(factory, fixture, seed) {
  let logicalTime = 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const clock = wallLimit ? () => performance.now() : () => ++logicalTime;
  const started = performance.now();
  let previous = null;
  const result = factory(model, createOrthogonalPathBuilder, clock, random).optimizePath({
    points: fixture.points, cutThreshold: fixture.threshold || 10, stagnationLimitMs: wallLimit || fixture.budget
  }, snapshot => {
    if (snapshot.stage !== "search" && snapshot.stage !== "complete") return;
    if (previous) assert.ok(snapshot.metrics.score <= previous.score + 1e-7, "published scores are monotonic");
    previous = snapshot.metrics;
  });
  const wallMs = performance.now() - started;
  assert.equal(model.validateRoute(result.path, fixture.points), "");
  for (let i = 1; i < result.path.length; i++) if (result.unitLinks[i]) assert.equal(model.distance(result.path[i - 1], result.path[i]), 1);
  const measured = model.createZones(fixture.points).measure(result.path, fixture.threshold || 10);
  assert.ok(Math.abs(measured.score - result.metrics.score) < 1e-7);
  return { score: measured.score, cuts: measured.cuts, distance: measured.distance,
    wallMs: Math.round(wallMs * 10) / 10, attempts: result.attempts,
    refinedOrders: result.refinedOrders || 0, intermediateImprovements: result.intermediateImprovements || 0,
    interleavedRestarts: result.interleavedRestarts || 0 };
}

// Warm both implementations with the same fixture before measuring.
run(baseline.exports.createBlockOptimizer, cases[3], 31);
run(createBlockOptimizer, cases[3], 31);
const rows = [];
for (const fixture of cases) for (const seed of seeds) {
  const before = run(baseline.exports.createBlockOptimizer, fixture, seed);
  const after = run(createBlockOptimizer, fixture, seed);
  const row = { fixture: fixture.name, crosses: fixture.points.length, cutThreshold: fixture.threshold || 10, seed, budget: wallLimit || fixture.budget,
    before, after, gain: before.score - after.score };
  rows.push(row);
  console.log(`${row.fixture} seed=${seed}: ${before.score.toFixed(3)} -> ${after.score.toFixed(3)}; cuts ${before.cuts} -> ${after.cuts}; ${before.wallMs} -> ${after.wallMs} ms`);
}
const output = path.join(root, "exports", "verification", wallLimit ? "path-quality-wall.json" : "path-quality.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ baselineRevision, mode: wallLimit ? "wall-clock-inactivity" : "deterministic-clock-calls",
  note: "Logical budgets ensure reproducible results, not equal CPU work. Wall times are separate, include preparation and vary by machine. Regression fixtures target known combined-search opportunities; no global optimality claim.", rows }, null, 2));
console.log(`Report: ${output}`);
