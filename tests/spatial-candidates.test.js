const assert = require("node:assert/strict");
const model = require("../src/stitch-model.js");
const { createDiagonalOptimizer } = require("../src/diagonal-optimizer-worker.js");
const optimizer = createDiagonalOptimizer(model);
const points = Array.from({ length: 700 }, (_, i) => ({ x: i % 35 * 3, y: Math.floor(i / 35) * 2,
  diagonal: i % 2 ? "upper" : "lower", direction: 1, ...(i % 17 === 0 ? { cutBefore: true } : {}) }));
points.push({ x: 100000, y: 100000, diagonal: "lower", direction: 1 });
const indices = points.map((_, i) => i), active = new Set(indices);
const index = optimizer.createSpatialCandidates(indices, i => points[i]);
for (let run = 0; run < 100; run++) {
  const previous = run === 0 ? null : { x: run % 20 * 7, y: run % 30 * 3,
    diagonal: run % 2 ? "lower" : "upper", direction: run % 3 ? 1 : -1 };
  const candidateAt = i => {
    if (i % 7 === run % 7) return null;
    let best = null;
    for (const direction of [1, -1]) {
      const point = { ...points[i], direction }, value = model.cost(previous, point, 10, true);
      if (Number.isFinite(value) && (!best || value < best.value)) best = { i, point, value };
    }
    return best;
  };
  const found = index.nearest(previous, candidateAt);
  const expected = [...active].map(candidateAt).filter(Boolean).sort((a, b) => a.value - b.value)[0];
  assert.equal(found.value, expected.value, "Indexed search matches a full scan, including forced cuts and forbidden holes");
  index.remove(found.i); active.delete(found.i);
  assert.equal(index.remaining, active.size);
}
for (const i of active) if (i !== points.length - 1) index.remove(i);
assert.equal(index.nearest(points[0], i => ({ i, point: points[i], value: model.distance(points[0], points[i]) })).i, points.length - 1,
  "Sparse distant points remain reachable without scanning every empty coordinate");
index.remove(points.length - 1);
assert.equal(index.remaining, 0);
assert.equal(index.nearest(points[0], () => { throw new Error("Empty index"); }), null);

const dense = Array.from({ length: 20000 }, (_, i) => ({ x: i % 200, y: Math.floor(i / 200), diagonal: "lower", direction: 1 }));
const fast = optimizer.createSpatialCandidates(dense.map((_, i) => i), i => dense[i]);
let evaluations = 0;
fast.nearest(dense[10050], i => {
  evaluations++;
  const value = model.cost(dense[10050], dense[i], 10, true);
  return Number.isFinite(value) ? { i, point: dense[i], value } : null;
});
assert.ok(evaluations < 1000, `A local query should not scan all ${dense.length} cells (${evaluations} evaluated)`);
console.log(`spatial candidates passed: exact queries, removals, sparse fallback, ${evaluations} / ${dense.length} local evaluations`);
