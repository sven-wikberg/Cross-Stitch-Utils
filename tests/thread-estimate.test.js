const assert = require("node:assert/strict");
const model = require("../src/stitch-model.js");
const { estimate, normalizeCapacity, createRemainingEstimator } = require("../src/thread-estimate.js");

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
const current = (start, partial = false) => ({ start, end: null, partial });
const remainingPath = route(100);
remainingPath[30].cutBefore = true;
const remainingBefore = structuredClone(remainingPath), index = createRemainingEstimator(remainingPath);
assert.deepEqual(index.at(10, current(0)), { diagonals: 90, cuts: 1, currentDiagonals: 20, strands: 2, pieces: 1, uncertainCurrent: false });
assert.deepEqual(index.at(30, current(0)), { diagonals: 70, cuts: 1, currentDiagonals: 0, strands: 2, pieces: 1, uncertainCurrent: false });
assert.deepEqual(index.at(31, current(30)), { diagonals: 69, cuts: 0, currentDiagonals: 44, strands: 1, pieces: 1, uncertainCurrent: false });
assert.deepEqual(index.at(31, current(0)), { diagonals: 69, cuts: 0, currentDiagonals: 0, strands: 2, pieces: 1, uncertainCurrent: true });
assert.equal(index.at(31, current(30, true)).currentDiagonals, 0, "Unknown starting length is never credited");
assert.equal(index.at(31, current(30, true)).uncertainCurrent, true);
assert.equal(index.at(31, { start: 30, end: 31, partial: false }).currentDiagonals, 0, "A finished thread is not reused");
assert.equal(index.at(80, current(30)).currentDiagonals, 0, "An exhausted thread is not reused");
assert.equal(index.at(95, current(90)).currentDiagonals, 5, "Useful capacity is capped by remaining diagonals");
assert.equal(index.at(95, current(90)).strands, 0);
assert.deepEqual(index.at(100, current(90)), { diagonals: 0, cuts: 0, currentDiagonals: 0, strands: 0, pieces: 0, uncertainCurrent: false });
assert.deepEqual(createRemainingEstimator([]).at(0), index.at(100));
assert.deepEqual(remainingPath, remainingBefore);
for (const bad of [-1, 101, 0.5, NaN]) assert.throws(() => index.at(bad), RangeError);
assert.throws(() => createRemainingEstimator([], 0), RangeError);
assert.throws(() => createRemainingEstimator([], 45, 0), RangeError);

for (const capacity of [1, 6, 45, 47, 100]) {
  const indexed = createRemainingEstimator(remainingPath, capacity);
  for (let count = 0; count <= remainingPath.length; count++) {
    const expected = estimate(remainingPath.slice(count), capacity), actual = indexed.at(count);
    for (const field of ["diagonals", "strands", "pieces"]) assert.equal(actual[field], expected[field]);
    assert.equal(actual.cuts, expected.cuts + Number(count === 30), "Include a cut immediately before the next diagonal");
  }
}
const largeIndex = createRemainingEstimator(route(40000));
const originalDistance = model.distance;
try {
  model.distance = () => { throw new Error("Query should not rescan path distances"); };
  for (let count = 0; count <= 40000; count++) assert.equal(largeIndex.at(count).diagonals, 40000 - count);
} finally { model.distance = originalDistance; }
console.log("Thread estimates passed: capacity, cuts, hole distances, rounding, progress, current/partial/exhausted threads, indexed large routes, validation, no mutation.");
