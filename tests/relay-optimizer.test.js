const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createRelaySearch } = require("../src/relay-search.js");
const { createRelayOptimizer } = require("../src/relay-optimizer-worker.js");
const fixtures = require("./fixtures/combined-search.js");
const engine = (clock = () => performance.now()) => createRelayOptimizer(model, createOrthogonalPathBuilder, createRelaySearch, clock);
const score = path => model.metrics(path, 3, true).score;

test("standalone relays choose the best move per link and stop only after a complete no-gain pass", () => {
  const points = fixtures.cutAware, initialPath = model.expandCells(points, 3), snapshots = [];
  const result = engine().optimizePath({ points, initialPath, cutThreshold: 3 }, s => snapshots.push(s));
  assert.ok(result.improvements > 0); assert.equal(result.reason, "exhausted");
  assert.equal(result.relay.examined, result.relay.total); assert.equal(result.relay.timedOut, false);
  let previous = initialPath;
  for (const s of snapshots.filter(s => s.path)) {
    assert.equal(model.validateRoute(s.path, points), "");
    assert.ok(s.metrics.score <= score(previous) + 1e-8);
    if (s.metrics.score < score(previous) - 1e-8) {
      const proposals = [...createRelaySearch(model, createOrthogonalPathBuilder(model)).candidates({ path: previous, cutThreshold: 3 })];
      const candidates = proposals.filter(c => c.relayLink.rank === s.lastRelayImprovement.rank);
      assert.ok(Math.abs(s.metrics.score - Math.min(...candidates.map(c => c.score))) < 1e-7);
      assert.ok(s.relayChange.length > 0);
    }
    previous = s.path;
  }
  assert.ok(snapshots.every(s => ["relay", "complete"].includes(s.stage)), "no block/point/LNS optimization is run");
  const remaining = [...createRelaySearch(model, createOrthogonalPathBuilder(model)).bestCandidates({ path: result.path, cutThreshold: 3 })];
  assert.ok(remaining.every(c => c.score >= result.metrics.score - 1e-8));
});

test("relay-only optimization preserves locks, imposed cuts, inputs and a better incumbent", () => {
  const points = fixtures.interleaved, initialPath = model.expandCells(points, 3);
  initialPath[10].cutBefore = true;
  const constraints = { lockedPrefix: initialPath.slice(0, 3), start: initialPath[0], forcedCuts: [initialPath[10]] };
  const before = JSON.stringify({ points, initialPath, constraints });
  const result = engine().optimizePath({ points, initialPath, constraints, cutThreshold: 3 });
  assert.equal(model.validateRoute(result.path, points), ""); assert.ok(model.satisfiesConstraints(result.path, constraints));
  assert.deepEqual(result.path.slice(0, 3), initialPath.slice(0, 3));
  assert.ok(result.metrics.score <= score(initialPath)); assert.equal(JSON.stringify({ points, initialPath, constraints }), before);
  const again = engine().optimizePath({ points, initialPath: result.path, constraints, cutThreshold: 3 });
  assert.deepEqual(again.path, result.path); assert.equal(again.improvements, 0);
});

test("empty, locked and short routes finish; incomplete paths are rejected; interrupted work retains the best", () => {
  const points = fixtures.timerRecovery, initialPath = model.expandCells(points, 3);
  assert.throws(() => engine().optimizePath({ points, initialPath: initialPath.slice(0, -1) }), /complet/);
  for (const path of [[], initialPath]) {
    const result = engine().optimizePath({ points: path.length ? points : [], initialPath: path, constraints: { lockedPrefix: path } });
    assert.deepEqual(result.path, path); assert.equal(result.improvements, 0);
  }
  let time = 0;
  const stopped = engine(() => time += 10).optimizePath({ points, initialPath, cutThreshold: 3, maxDurationMs: 50 });
  assert.equal(stopped.reason, "time-limit"); assert.deepEqual(stopped.path, initialPath);
});
