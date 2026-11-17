const assert = require("node:assert/strict");
const model = require("../src/stitch-model.js");
const { createDiagonalOptimizer } = require("../src/diagonal-optimizer-worker.js");
const optimizer = createDiagonalOptimizer(model);
const close = (actual, expected) => assert.ok(actual === expected || Math.abs(actual - expected) < 1e-7,
  `Expected ${expected}, received ${actual}`);
const relocate = (chunks, i, j) => {
  const copy = [...chunks], [chunk] = copy.splice(i, 1);
  copy.splice(j >= i ? j : j + 1, 0, chunk);
  return copy;
};
const score = (sequence, threshold, constraints) => {
  try { return model.metrics(model.orient(sequence, threshold, constraints, true), threshold, true).score; }
  catch { return Infinity; }
};
const cells = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 20, y: 0 }, { x: 21, y: 0 }];
const zones = model.createZones(cells);
let checked = 0;
for (const threshold of [1, 10]) for (const grouped of [false, true]) for (const locked of [false, true]) {
  const route = model.expandCells(cells, threshold);
  route[7].cutBefore = true;
  const constraints = { forcedCuts: [route[5]], ...(locked ? { lockedPrefix: route.slice(0, 2), start: route[0] } : {}) };
  let chunks = grouped ? cells.map((_, i) => route.slice(i * 2, i * 2 + 2)) : route.map(p => [p]);
  const fixed = locked ? (grouped ? 1 : 2) : 0;
  const evaluator = optimizer.createOrderEvaluator(chunks, threshold, constraints, zones);
  for (let round = 0; round < 4; round++) {
    close(evaluator.current().score, score(chunks.flat(), threshold, constraints));
    for (let i = fixed; i < chunks.length; i++) for (let j = fixed - 1; j < chunks.length; j++) {
      const moved = relocate(chunks, i, j).flat(), result = evaluator.evaluateMove(i, j);
      close(result.score, score(moved, threshold, constraints));
      assert.equal(result.zoneVisits, zones.measure(moved).zoneReturns + zones.zones.length);
      checked++;
    }
    const i = chunks.length - 1 - round % 2, j = fixed - 1;
    evaluator.move(i, j); chunks = relocate(chunks, i, j);
  }
}

// Find a legal order that fixed directions would reject, but reorientation improves.
const nearby = Array.from({ length: 6 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) }));
const localZones = model.createZones(nearby);
let regression = null;
for (const order of [[0, 3, 1, 4, 2, 5], [0, 5, 1, 4, 2, 3], [0, 1, 2, 3, 4, 5]]) {
  const route = model.orient(model.expandCells(order.map(i => nearby[i])), 10, {}, true);
  const current = model.metrics(route, 10, true).score;
  const evaluator = optimizer.createOrderEvaluator(route.map(p => [p]), 10, {}, localZones);
  for (let i = 0; i < route.length && !regression; i++) for (let j = -1; j < route.length; j++) {
    if (j === i || j === i - 1) continue;
    const moved = relocate(route, i, j), oriented = model.orient(moved, 10, {}, true);
    if (model.validateRoute(oriented, nearby)) continue;
    const fixedScore = Math.min(...[1, -1].map(direction => model.metrics(moved.map(p =>
      model.key(p) === model.key(route[i]) ? { ...p, direction } : p), 10, true).score));
    const candidate = evaluator.evaluateMove(i, j);
    if (fixedScore >= current && candidate.score < current - 1e-7) {
      assert.ok(optimizer.improvesOrder(candidate, evaluator.current()), "Accept improvements hidden by old directions");
      regression = { before: current, fixedScore, optimized: candidate.score };
      break;
    }
  }
}
assert.ok(regression, "Fixture must cover a missed improvement, even after flipping only the moved diagonal");

// End-of-budget finalization must run even if the clock expires during the search.
let phase = "", finalCalls = 0, expiredFinalizations = 0;
const trackedModel = { ...model, orient(...args) {
  if (phase === "Derniere optimisation des sens") finalCalls++;
  return model.orient(...args);
} };
const initial = model.expandCells(nearby);
const constraints = { lockedPrefix: initial.slice(0, 2), forcedCuts: [initial[6]] };
const result = createDiagonalOptimizer(trackedModel).optimizePath({ points: nearby, initialPath: initial,
  constraints, stagnationLimitMs: 10 }, snapshot => {
  phase = snapshot.phase;
  if (phase === "Derniere optimisation des sens" && snapshot.lastImprovementMs >= snapshot.stagnationLimitMs) expiredFinalizations++;
  if (snapshot.path) {
    assert.equal(model.validateRoute(snapshot.path, nearby), "");
    assert.ok(model.satisfiesConstraints(snapshot.path, constraints));
  }
});
assert.equal(finalCalls, 1, "Exactly one mandatory final orientation pass");
assert.equal(expiredFinalizations, 1, "Finalization is not skipped when the stagnation deadline expires");
close(result.metrics.score, score(result.path, 10, constraints));
assert.deepEqual(result.path.slice(0, 2), initial.slice(0, 2));
assert.ok(result.path.find(p => model.key(p) === model.key(initial[6])).cutBefore);
console.log(`orientation tests passed: ${checked} cached/full comparisons, hidden gain ${JSON.stringify(regression)}, mandatory final pass`);
