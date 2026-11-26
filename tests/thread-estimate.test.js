const assert = require("node:assert/strict");
const model = require("../src/stitch-model.js");
const { estimate, normalizeCapacity } = require("../src/thread-estimate.js");

function route(length) {
  return model.expandCells(Array.from({ length: Math.ceil(length / 2) }, (_, x) => ({ x, y: 0 }))).slice(0, length);
}

assert.deepEqual(estimate([]), { diagonals: 0, cuts: 0, strands: 0, pieces: 0, skeins: 0 });
for (const [length, strands] of [[1, 1], [44, 1], [45, 1], [46, 2], [90, 2], [91, 3]]) {
  const actual = estimate(route(length));
  assert.equal(actual.strands, strands, `${length} diagonals`);
  assert.equal(actual.cuts, 0);
}
const split = route(53);
split[3].cutBefore = true;
const before = structuredClone(split);
assert.deepEqual(estimate(split), { diagonals: 53, cuts: 1, strands: 3, pieces: 1, skeins: 1 });
assert.deepEqual(split, before, "Estimation must not alter the route");
assert.equal(estimate(split, 50).strands, 2);

const boundary = route(90);
boundary[0].cutBefore = true;
boundary[45].cutBefore = true;
assert.equal(estimate(boundary).strands, 2, "No extra strand for the initial or exact-capacity cut");
assert.equal(estimate(boundary).cuts, 1);

const pair = [
  { x: 0, y: 0, diagonal: "lower", direction: 1 },
  { x: 11, y: 0, diagonal: "upper", direction: 1 }
];
assert.equal(model.distance(...pair), 10);
assert.equal(estimate(pair).cuts, 0, "Distance equal to the threshold is not a cut");
pair[1].y = 1;
assert.equal(estimate(pair).cuts, 1, "Distance is measured between holes, with decimals");
assert.equal(estimate(pair).strands, 2);
pair[1].cutBefore = true;
assert.equal(estimate(pair).cuts, 1, "A forced long jump counts only once");
assert.equal(estimate(pair, 45, 20).cuts, 1, "Forced cuts also apply below the threshold");
delete pair[1].cutBefore;
assert.equal(estimate(pair, 45, 20).cuts, 0);

for (const [length, pieces, skeins] of [[6, 1, 1], [7, 2, 1], [96, 16, 1], [97, 17, 2]]) {
  const path = route(length).map(point => ({ ...point, cutBefore: true }));
  assert.deepEqual(estimate(path), { diagonals: length, cuts: length - 1, strands: length, pieces, skeins });
}
assert.equal(estimate(route(40000)).strands, 889);
assert.equal(estimate(route(97), 1).skeins, 2);
for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "", null]) {
  assert.equal(normalizeCapacity(bad), null);
  assert.throws(() => estimate([], bad), RangeError);
}
assert.equal(normalizeCapacity("47"), 47);
assert.throws(() => estimate([], 45, 0), RangeError);
console.log("Thread estimates passed: capacity, cuts, hole distances, rounding, empty and large routes, validation, no mutation.");
