const assert = require("node:assert/strict");
const model = require("../src/stitch-model.js");
const { createFastOptimizer } = require("./optimizer-test-utils.js");
const optimizer = createFastOptimizer(model);
const cells = [{ x: 0, y: 0 }, ...Array.from({ length: 9 }, (_, i) => ({ x: 20 + i % 3, y: Math.floor(i / 3) })),
  ...Array.from({ length: 5 }, (_, i) => ({ x: 40 + i, y: 0 }))];
const zones = model.createZones(cells), referenceLimit = 60000;
const initial = model.expandCells(cells);
let latest = initial, previousMetrics, previousProgress = 0;
const started = [], completed = [], phases = new Set();
const result = optimizer.optimizePath({ points: cells, initialPath: initial, stagnationLimitMs: referenceLimit }, snapshot => {
  phases.add(snapshot.stage);
  assert.ok(snapshot.progress >= previousProgress);
  previousProgress = snapshot.progress;
  if (snapshot.path) {
    latest = snapshot.path;
    assert.equal(model.validateRoute(latest, cells), "");
    if (previousMetrics) assert.ok(model.compareZoneMetrics(snapshot.metrics, previousMetrics) <= 1e-7);
    previousMetrics = snapshot.metrics;
  }
  if (snapshot.stage !== "zones") return;
  const zone = snapshot.zone;
  assert.equal(zone.total, 3);
  const limit = optimizer.zoneStagnationLimit(zone.unlockedDiagonals, referenceLimit);
  assert.equal(snapshot.stagnationLimitMs, limit);
  assert.equal(zone.stagnationLimitMs, limit);
  assert.equal(zone.unlockedCrosses, zone.unlockedDiagonals / 2);
  assert.equal(snapshot.referenceStagnationLimitMs, referenceLimit);
  if (zone.status === "running" && !started.includes(zone.id)) {
    started.push(zone.id);
    assert.equal(zone.index, started.length);
    assert.equal(zone.completed, started.length - 1);
    assert.ok(zone.lastImprovementMs < limit, "Each zone receives a fresh timer");
  }
  let withNeighbors = 0;
  for (let i = 1; i < latest.length; i++) {
    if ([latest[i - 1], latest[i]].some(p => zones.byCell.get(model.cellKey(p)) === zone.id)) {
      withNeighbors += model.cost(latest[i - 1], latest[i], 10, true);
    }
  }
  assert.ok(Math.abs(zone.score - withNeighbors) < 1e-7, "Displayed zone score includes both boundary links");
  if (zone.status === "complete") {
    completed.push(zone.id);
    assert.ok(zone.lastImprovementMs >= limit, "The current zone's computed inactivity limit is enforced");
    assert.ok(zone.elapsedMs >= limit);
  }
});
assert.deepEqual(completed, started);
assert.equal(completed.length, 3);
assert.equal(result.zone.completed, 3);
assert.equal(result.progress, 100);
assert.ok(phases.has("links") && phases.has("orient") && phases.has("complete"));

const lockedPrefix = initial.slice(0, 2);
const locked = optimizer.optimizePath({ points: cells, initialPath: initial, stagnationLimitMs: 5,
  constraints: { lockedPrefix, start: lockedPrefix[0], forcedCuts: [initial[5]] } });
assert.equal(locked.zone.total, 2, "Fully locked zones are not scheduled");
assert.deepEqual(locked.path.slice(0, 2), lockedPrefix);
assert.ok(locked.path.find(p => model.key(p) === model.key(initial[5])).cutBefore);
assert.equal(model.validateRoute(locked.path, cells), "");

// A local saving must not win if it makes the links to neighboring zones worse.
const inside = Array.from({ length: 6 }, (_, i) => ({ x: 10 + i % 3, y: Math.floor(i / 3) }));
const surrounding = [{ x: 0, y: 0 }, ...inside, { x: 20, y: 5 }];
const allZones = model.createZones(surrounding);
let boundaryRegression = false;
for (const order of [[0, 3, 1, 4, 2, 5], [0, 5, 1, 4, 2, 3], [0, 1, 2, 3, 4, 5]]) {
  const full = model.expandCells([surrounding[0], ...order.map(i => inside[i]), surrounding.at(-1)]);
  const middle = full.slice(2, -2);
  const local = optimizer.createOrderEvaluator(middle.map(p => [p]), 10, {}, allZones);
  const global = optimizer.createOrderEvaluator(full.map(p => [p]), 10, {}, allZones);
  for (let i = 0; i < middle.length && !boundaryRegression; i++) for (let j = -1; j < middle.length; j++) {
    const p = middle[i], mate = middle.findIndex(q => model.cellKey(p) === model.cellKey(q) && p.diagonal !== q.diagonal);
    if (i === j || i === j + 1 || (p.diagonal === "lower" ? j >= mate : j < mate)) continue;
    if (optimizer.improvesOrder(local.evaluateMove(i, j), local.current())
        && global.evaluateMove(i + 2, j + 2).score > global.current().score + 1e-7) {
      assert.equal(optimizer.improvesOrder(global.evaluateMove(i + 2, j + 2), global.current()), false);
      boundaryRegression = true; break;
    }
  }
}
assert.ok(boundaryRegression, "Fixture demonstrates the cost of ignoring neighboring zones");
const connected = Array.from({ length: 600 }, (_, i) => ({ x: i % 30, y: Math.floor(i / 30) }));
const oneIsland = optimizer.optimizePath({ points: connected, stagnationLimitMs: 1 });
assert.equal(oneIsland.zone.total, 1, "A large connected island receives one timer, not a timer per spatial bucket");
assert.equal(oneIsland.zone.completed, 1);
assert.equal(model.validateRoute(oneIsland.path, connected), "");
console.log("zone optimization passed: sequential zones, proportional timers, boundary costs, progress, locked prefix, final orientation");
