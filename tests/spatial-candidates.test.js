const assert = require("node:assert/strict");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const builder = createOrthogonalPathBuilder(model);
const points = Array.from({ length: 700 }, (_, i) => ({ x: i % 35 * 3, y: Math.floor(i / 35) * 2,
  diagonal: i % 2 ? "upper" : "lower", direction: 1, ...(i % 17 === 0 ? { cutBefore: true } : {}) }));
points.push({ x: 100000, y: 100000, diagonal: "lower", direction: 1 });
const variants = i => [1, -1].map(direction => ({ ...points[i], direction }));
const active = new Set(points.map((_, i) => i));
const index = builder.spatialIndex(points, variants);
for (let run = 0; run < 100; run++) {
  const previous = run === 0 ? null : { x: run % 20 * 7, y: run % 30 * 3,
    diagonal: run % 2 ? "lower" : "upper", direction: run % 3 ? 1 : -1 };
  const accept = i => i % 7 !== run % 7;
  const found = index.nearest(previous, accept, 10);
  let expected = Infinity;
  for (const i of active) if (accept(i)) {
    for (const point of variants(i)) expected = Math.min(expected, model.cost(previous, point, 10, true));
  }
  assert.equal(found.score, expected, "Indexed search matches a full scan, including cuts and forbidden holes");
  assert.ok(active.has(found.i) && accept(found.i));
  assert.equal(model.cost(previous, found.point, 10, true), expected);
  index.remove(found.i); active.delete(found.i);
}
for (const i of active) if (i !== points.length - 1) index.remove(i);
assert.equal(index.nearest(points[0], () => true, 10).i, points.length - 1,
  "Sparse distant points remain reachable without scanning every empty coordinate");
index.remove(points.length - 1);
assert.equal(index.nearest(points[0], () => { throw new Error("Empty index"); }, 10), null);

const dense = Array.from({ length: 20000 }, (_, i) => ({ x: i % 200, y: Math.floor(i / 200), diagonal: "lower", direction: 1 }));
let evaluations = 0;
const fast = builder.spatialIndex(dense, i => { evaluations++; return [dense[i]]; });
fast.nearest(dense[10050], () => true, 10);
assert.ok(evaluations < 1000, "A local query must not scan all cells: " + evaluations);
console.log("spatial candidates passed: exact queries, removals, sparse fallback, " + evaluations + " / " + dense.length + " local evaluations");
