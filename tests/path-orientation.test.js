const assert = require("node:assert/strict");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createFastOptimizer } = require("./optimizer-test-utils.js");
const builder = createOrthogonalPathBuilder(model);
const close = (actual, expected) => assert.ok(actual === expected || Math.abs(actual - expected) < 1e-7,
  "Expected " + expected + ", received " + actual);
const relocate = (chunks, i, j) => {
  const copy = [...chunks], [chunk] = copy.splice(i, 1);
  copy.splice(j >= i ? j : j + 1, 0, chunk);
  return copy;
};
const score = (sequence, threshold, constraints) => {
  try { return model.metrics(model.orient(sequence, threshold, constraints, true), threshold, true).score; }
  catch { return Infinity; }
};
const orient = (sequence, threshold, constraints = {}) =>
  builder.orientUnitPath(sequence, Array(sequence.length).fill(false), constraints, threshold);
const cells = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 20, y: 0 }, { x: 21, y: 0 }];
let checked = 0;
for (const threshold of [1, 10]) for (const grouped of [false, true]) for (const locked of [false, true]) {
  const route = model.expandCells(cells, threshold);
  route[7].cutBefore = true;
  const constraints = { forcedCuts: [route[5]], ...(locked ? { lockedPrefix: route.slice(0, 2), start: route[0] } : {}) };
  let chunks = grouped ? cells.map((_, i) => route.slice(i * 2, i * 2 + 2)) : route.map(p => [p]);
  const fixed = locked ? (grouped ? 1 : 2) : 0;
  for (let round = 0; round < 4; round++) {
    close(orient(chunks.flat(), threshold, constraints)?.score ?? Infinity, score(chunks.flat(), threshold, constraints));
    for (let i = fixed; i < chunks.length; i++) for (let j = fixed - 1; j < chunks.length; j++) {
      const moved = relocate(chunks, i, j).flat();
      close(orient(moved, threshold, constraints)?.score ?? Infinity, score(moved, threshold, constraints));
      checked++;
    }
    chunks = relocate(chunks, chunks.length - 1 - round % 2, fixed - 1);
    chunks.splice(fixed, chunks.length - fixed, ...chunks.slice(fixed).reverse());
  }
}

// Reorienting all diagonals can reveal a gain that flipping only the moved one misses.
const nearby = Array.from({ length: 6 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) }));
let regression = null;
for (const order of [[0, 3, 1, 4, 2, 5], [0, 5, 1, 4, 2, 3], [0, 1, 2, 3, 4, 5]]) {
  const route = model.orient(model.expandCells(order.map(i => nearby[i])), 10, {}, true);
  const current = model.metrics(route, 10, true).score;
  for (let i = 0; i < route.length && !regression; i++) for (let j = -1; j < route.length; j++) {
    if (j === i || j === i - 1) continue;
    const moved = relocate(route, i, j), candidate = orient(moved, 10);
    if (!candidate || model.validateRoute(candidate.path, nearby)) continue;
    const fixedScore = Math.min(...[1, -1].map(direction => model.metrics(moved.map(p =>
      model.key(p) === model.key(route[i]) ? { ...p, direction } : p), 10, true).score));
    if (fixedScore >= current && candidate.score < current - 1e-7) {
      regression = { before: current, fixedScore, optimized: candidate.score };
      break;
    }
  }
}
assert.ok(regression, "Fixture must cover a gain hidden by fixed sewing directions");

// Even an expired budget returns a fully oriented, valid route with its locks and cuts.
const initial = model.expandCells(nearby);
const constraints = { lockedPrefix: initial.slice(0, 2), forcedCuts: [initial[6]] };
const result = createFastOptimizer(model).optimizePath({ points: nearby, initialPath: initial,
  constraints, stagnationLimitMs: 1 }, snapshot => {
  if (snapshot.path) {
    assert.equal(model.validateRoute(snapshot.path, nearby), "");
    assert.ok(model.satisfiesConstraints(snapshot.path, constraints));
  }
});
const final = builder.orientUnitPath(result.path, result.unitLinks, constraints, 10);
close(result.metrics.score, final.score);
assert.deepEqual(result.path.slice(0, 2), initial.slice(0, 2));
assert.ok(result.path.find(p => model.key(p) === model.key(initial[6])).cutBefore);
assert.ok(result.metrics.score <= result.initialMetrics.score);
console.log("orientation tests passed: " + checked + " orientation comparisons, hidden gain " + JSON.stringify(regression) + ", expired-budget validity");
