const assert = require("node:assert/strict");
const model = require("../src/stitch-model.js");
const { createFastOptimizer } = require("./optimizer-test-utils.js");
const optimizer = createFastOptimizer(model);
const block = (x, y) => [0, 1, 2, 3].map(i => ({ x: x + i % 2, y: y + Math.floor(i / 2) }));
const cells = [...block(0, 0), ...block(20, 0), ...block(40, 0)];
const zones = model.createZones(cells);
assert.equal(zones.zones.length, 3);
assert.deepEqual([...zones.byCell], [...model.createZones([...cells].reverse()).byCell]);

const mixed = model.expandCells([0, 4, 8, 1, 5, 9, 2, 6, 10, 3, 7, 11].map(i => cells[i]));
assert.ok(zones.measure(mixed).zoneReturns > 0);
assert.ok(optimizer.compareMetrics({ zoneReturns: 1, score: 1 }, { zoneReturns: 0, score: 1000 }) < 0,
  "The real score takes priority over zone returns");
let bestMetrics;
const result = optimizer.optimizePath({ points: cells, initialPath: mixed, stagnationLimitMs: 80 }, snapshot => {
  if (!snapshot.path) return;
  assert.equal(model.validateRoute(snapshot.path, cells), "");
  assert.deepEqual(zones.measure(snapshot.path), snapshot.metrics);
  if (bestMetrics) assert.ok(optimizer.compareMetrics(snapshot.metrics, bestMetrics) <= 1e-7);
  bestMetrics = snapshot.metrics;
});
assert.equal(result.metrics.zoneReturns, 0);
assert.equal(result.metrics.visitedZones, 3);
assert.ok(optimizer.compareMetrics(result.metrics, zones.measure(mixed)) < 0);
assert.ok(optimizer.compareMetrics(result.metrics, result.initialMetrics) <= 0);

// Every jump is a cut: distance must still distinguish the nearest next zone.
const separated = [0, 15, 30, 100].map(x => ({ x, y: 0 }));
const farFirst = model.expandCells([separated[0], separated[3], separated[1], separated[2]], 2);
const near = optimizer.optimizePath({ points: separated, initialPath: farFirst, cutThreshold: 2,
  constraints: { start: farFirst[0] }, stagnationLimitMs: 80 });
assert.deepEqual(near.path.filter(p => p.diagonal === "lower").map(p => p.x), [0, 15, 30, 100]);
assert.equal(near.metrics.zoneReturns, 0);
assert.equal(near.metrics.cuts, 3);
assert.ok(near.metrics.cutTravel < model.metrics(farFirst, 2, true).cutTravel);
assert.ok(Math.abs(near.metrics.score - near.metrics.distance - near.metrics.cuts * 6) < 1e-7);
const source = { x: 0, y: 0, diagonal: "lower", direction: 1 };
const close = { x: 15, y: 0, diagonal: "lower", direction: 1, cutBefore: true };
const far = { ...close, x: 100 };
assert.equal(model.cost(source, close, 2), model.cost(source, far, 2), "Legacy score stays compatible");
assert.ok(model.cost(source, close, 2, true) < model.cost(source, far, 2, true));

// A locked historical prefix may already revisit zones; never rewrite it.
const orderedPrefix = model.orient([
  { ...cells[0], diagonal: "lower", direction: 1 },
  { ...cells[4], diagonal: "lower", direction: 1 },
  { ...cells[0], diagonal: "upper", direction: 1 }
]);
const cut = { ...cells[5], diagonal: "lower", direction: 1 };
const constraints = { lockedPrefix: orderedPrefix, start: orderedPrefix[0], forcedCuts: [cut] };
const locked = optimizer.optimizePath({ points: cells, constraints, stagnationLimitMs: 80 });
assert.deepEqual(locked.path.slice(0, orderedPrefix.length), orderedPrefix);
assert.ok(model.satisfiesConstraints(locked.path, constraints));
assert.equal(model.validateRoute(locked.path, cells), "");
assert.deepEqual(locked.metrics, zones.measure(locked.path));
assert.ok(optimizer.compareMetrics(locked.metrics, locked.initialMetrics) <= 1e-7);

const connected = Array.from({ length: 30 * 20 }, (_, i) => ({ x: i % 30, y: Math.floor(i / 30) }));
const natural = model.createZones(connected);
assert.equal(natural.zones.length, 1, "One connected shape is not split at ten-cell boundaries");
assert.equal(natural.zones[0].cells.length, 600);
assert.equal(natural.zones[0].maxX, 30);
assert.equal(natural.zones[0].maxY, 20);
const diagonal = model.createZones(Array.from({ length: 35 }, (_, i) => ({ x: i, y: i })));
assert.equal(diagonal.zones.length, 1, "Corner contacts connect an island across every ten-cell boundary");
const split = model.createZones([{ x: 0, y: 0 }, { x: 5, y: 5 }]);
assert.equal(split.zones.length, 2, "Nearby disconnected patches stay separate even below the cut threshold");
assert.equal(model.createZones([{ x: 9, y: 9 }, { x: 10, y: 10 }, { x: 12, y: 10 }]).zones.length, 2);
console.log("zone tests passed: natural islands, no size limit, side/corner adjacency, no gap merging, locked prefix, cut distance");
