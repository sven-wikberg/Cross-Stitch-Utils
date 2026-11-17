const assert = require("node:assert/strict");
const model = require("../src/stitch-model.js");
const { createFastOptimizer } = require("./optimizer-test-utils.js");
const optimizer = createFastOptimizer(model, 500);

for (const [crosses, expected] of [[1, 5000], [40, 5000], [42, 5040], [100, 12000],
  [500, 60000], [1000, 120000], [3186, 382320], [5000, 600000], [10000, 600000]]) {
  assert.equal(optimizer.zoneStagnationLimit(crosses * 2), expected, `${crosses} crosses`);
}
assert.equal(optimizer.zoneStagnationLimit(799), 47940, "A single unlocked diagonal counts as half a cross");
assert.equal(optimizer.zoneStagnationLimit(1000, 120000), 120000, "The reference setting applies to 500 crosses");
assert.equal(optimizer.zoneStagnationLimit(1, 30000), 5000, "The floor is fixed independently of the reference");
assert.equal(optimizer.zoneStagnationLimit(100000, 30000), 600000, "The cap is fixed independently of the reference");

const block = (count, offset) => Array.from({ length: count }, (_, i) => ({ x: offset + i % 20, y: Math.floor(i / 20) }));
const cells = [...block(100, 0), ...block(500, 30), ...block(600, 60)];
const starts = new Map(), ends = [];
optimizer.optimizePath({ points: cells }, snapshot => {
  const zone = snapshot.zone;
  if (snapshot.stage !== "zones") return;
  if (!starts.has(zone.id)) starts.set(zone.id, { crosses: zone.unlockedCrosses, limit: zone.stagnationLimitMs });
  if (zone.status === "complete") {
    assert.ok(zone.lastImprovementMs >= zone.stagnationLimitMs);
    ends.push(zone.id);
  }
});
assert.deepEqual([...starts.values()].sort((a, b) => a.crosses - b.crosses),
  [{ crosses: 100, limit: 12000 }, { crosses: 500, limit: 60000 }, { crosses: 600, limit: 72000 }]);
assert.equal(ends.length, 3);

const lockedCells = block(500, 0), path = model.expandCells(lockedCells), lockedPrefix = path.slice(0, 201);
let checked = false;
const result = optimizer.optimizePath({ points: lockedCells, initialPath: path, constraints: { lockedPrefix } }, snapshot => {
  if (snapshot.stage !== "zones") return;
  assert.equal(snapshot.zone.crossCount, 500);
  assert.equal(snapshot.zone.unlockedDiagonals, 799);
  assert.equal(snapshot.zone.unlockedCrosses, 399.5);
  assert.equal(snapshot.zone.stagnationLimitMs, 47940);
  checked = true;
});
assert.ok(checked);
assert.deepEqual(result.path.slice(0, 201), lockedPrefix);
assert.equal(model.validateRoute(result.path, lockedCells), "");
const allLocked = optimizer.optimizePath({ points: lockedCells, initialPath: path, constraints: { lockedPrefix: path } });
assert.equal(allLocked.zone.total, 0, "Fully locked zones consume no optimization budget");
console.log("zone timing passed: 1 min / 500 crosses, 5 s floor, 10 min cap, per-zone deadlines, partial and fully locked zones");
