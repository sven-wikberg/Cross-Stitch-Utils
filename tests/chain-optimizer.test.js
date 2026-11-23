const test = require("node:test"), assert = require("node:assert/strict");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder: builder } = require("../src/orthogonal-path-worker.js");
const { createRelaySearch: relay } = require("../src/relay-search.js");
const { createSegmentOptimizer: segments } = require("../src/segment-optimizer-worker.js");
const { createChainOptimizer } = require("../src/chain-optimizer-worker.js");
const fixtures = require("./fixtures/combined-search.js");
const make = (clock, segmentFactory = segments, stitchModel = model) => createChainOptimizer(stitchModel, builder, relay, segmentFactory, clock);
const transfers = segments(model, builder, relay), score = path => model.metrics(path, 3, true).score;
test("chain insertion bounds match complete validation across every small interval and destination", () => {
  let seed = 143; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const search = make();
  for (let sample = 0; sample < 30; sample++) {
    const cells = Array.from({ length: 6 }, (_, x) => ({ x: x * 2, y: Math.floor(random() * 5) }));
    const todo = cells.map(p => ({ ...p, diagonal: "lower", direction: 1 })), sequence = [];
    while (todo.length) {
      const [p] = todo.splice(Math.floor(random() * todo.length), 1); sequence.push(p);
      if (p.diagonal === "lower") todo.push({ ...p, diagonal: "upper" });
    }
    const path = model.orient(sequence, 3, {}, true); path[8].cutBefore = true;
    const constraints = { lockedPrefix: path.slice(0, sample % 3), forcedCuts: [path[8]] }, state = search.context(path, 3, constraints);
    for (let a = state.locked; a < path.length; a++) for (let b = a + 1; b <= path.length; b++) {
      const bound = search.bounds(state, a, b);
      for (let t = state.locked; t <= path.length; t++) {
        if (t >= a && t <= b) continue;
        const pieces = search.pieces(path.length, a, b, t), candidate = transfers.materialize(state, pieces);
        const valid = candidate && !model.validateRoute(candidate, cells) && model.satisfiesConstraints(candidate, constraints);
        assert.equal(Boolean(valid), t >= bound.lo && t <= bound.hi);
        if (valid) assert.ok(Math.abs(score(candidate) - state.score(pieces)) < 1e-8);
      }
    }
  }
});
test("candidate limits are applied after precedence filtering and include legal boundaries and cuts", () => {
  const pivot = { x: 10, y: 10 }, nearby = { x: 26, y: 10 };
  const cells = Array.from({ length: 400 }, (_, i) => ({ x: i % 20, y: Math.floor(i / 20) }))
    .filter(p => model.cellKey(p) !== model.cellKey(pivot));
  const actions = (p, diagonal) => ({ ...p, diagonal, direction: 1 });
  const sequence = cells.flatMap(p => [actions(p, "lower"), actions(p, "upper")]);
  sequence.push(actions(pivot, "lower"), actions(nearby, "lower"), actions(nearby, "upper"),
    actions({ x: 40, y: 40 }, "lower"), actions({ x: 40, y: 40 }, "upper"), actions(pivot, "upper"));
  const path = model.orient(sequence, 10, {}, true), search = make();
  path[800].cutBefore = true;
  const state = search.context(path, 10), a = path.length - 1, bounds = search.bounds(state, a, a + 1);
  const targets = search.destinations(state, a, a + 1);
  assert.ok(targets.includes(800), "Valid neighbors must not be crowded out by hundreds of impossible earlier neighbors");
  assert.ok(targets.includes(bounds.lo)); assert.ok(state.cuts.includes(800));
  assert.ok(targets.every(t => t >= bounds.lo && t <= bounds.hi && (t < a || t > a + 1)));
  assert.deepEqual(search.ranges(state, 799)[0], [799, 800], "Manual cuts also delimit chain proposals");
});
test("range proposals include long tails, whole closed crosses, unit runs and protected suffixes", () => {
  const points = Array.from({ length: 90 }, (_, x) => ({ x: x * 2, y: 0 })), path = model.expandCells(points, 3);
  const search = make(), state = search.context(path, 1000, { lockedPrefix: path.slice(0, 3) });
  assert.deepEqual(search.closedRange(state, 4, 5), [4, 6]);
  assert.equal(search.closedRange(state, 5, 6), null);
  assert.ok(search.ranges(state, 28).some(([a, b]) => a === 28 && b === 180));
  assert.ok(search.ranges(state, 4).every(([a, b]) => a >= 3 && b <= path.length && a < b));
});
test("real search emits only global gains, preserves open prefixes and cuts, and ends after a no-gain scan", () => {
  const points = fixtures.interleaved, initialPath = model.expandCells(points, 3); initialPath[10].cutBefore = true;
  const constraints = { start: initialPath[0], lockedPrefix: initialPath.slice(0, 3), forcedCuts: [initialPath[10]] };
  const before = JSON.stringify({ initialPath, points, constraints }), search = make();
  let previous = score(initialPath), gains = 0;
  const result = search.optimizePath({ points, initialPath, constraints, cutThreshold: 3, totalLimitMs: 2000 }, snapshot => {
    assert.equal(snapshot.method, "chain-reinsertion"); assert.equal(snapshot.relay, undefined);
    if (!snapshot.path) return;
    assert.equal(model.validateRoute(snapshot.path, points), ""); assert.ok(model.satisfiesConstraints(snapshot.path, constraints));
    assert.ok(snapshot.metrics.score <= previous + 1e-8); assert.ok(Math.abs(score(snapshot.path) - snapshot.metrics.score) < 1e-8);
    if (snapshot.metrics.score < previous - 1e-8) gains++;
    previous = snapshot.metrics.score;
  });
  assert.equal(JSON.stringify({ initialPath, points, constraints }), before);
  assert.ok(gains > 0); assert.ok(result.chainSearch.moves > 0); assert.equal(result.reason, "exhausted");
  assert.ok(result.lastChainImprovement.size > 0);
  const again = search.optimizePath({ points, initialPath: result.path, constraints, cutThreshold: 3, totalLimitMs: 2000 });
  assert.equal(again.improvements, 0); assert.deepEqual(again.path, result.path);
});
test("an interrupted chain never commits its provisional winner and still performs final orientation", () => {
  let time = 0, orientations = 0, materializations = 0;
  const wrappedModel = { ...model, orient(...args) { orientations++; return model.orient(...args); } };
  const fakeSegments = (...args) => {
    const engine = segments(...args);
    return { ...engine, context(...args) { const state = engine.context(...args); state.score = () => { time = 100; return 0; }; return state; },
      materialize(...args) { materializations++; return engine.materialize(...args); } };
  };
  const points = fixtures.timerRecovery, initialPath = model.orient(model.expandCells(points, 3), 3, {}, true);
  const result = make(() => time, fakeSegments, wrappedModel).optimizePath({ points, initialPath, cutThreshold: 3, totalLimitMs: 100 });
  assert.equal(result.reason, "time-limit"); assert.equal(materializations, 0); assert.equal(orientations, 2);
  assert.equal(result.chainSearch.moves, 0); assert.deepEqual(result.path, initialPath);
});
test("candidate collection can be interrupted without returning a truncated neighbor set", () => {
  const points = Array.from({ length: 400 }, (_, i) => ({ x: i % 20, y: Math.floor(i / 20) }));
  const search = make(() => 10), state = search.context(model.expandCells(points, 10), 10);
  assert.equal(search.destinations(state, 400, 402, 1), null);
});

test("exhaustive chain mode ignores the old time budget and ends on a full no-gain scan", () => {
  let time = 0;
  const search = make(() => time++), points = fixtures.timerRecovery, initialPath = model.expandCells(points, 3);
  const result = search.optimizePath({ points, initialPath, cutThreshold: 3, untilStable: true, totalLimitMs: 1 }, snapshot => {
    assert.equal(snapshot.untilStable, true); assert.equal(snapshot.totalLimitMs, null);
    assert.ok(Number.isFinite(snapshot.progress));
  });
  assert.ok(["exhausted", "lower-bound"].includes(result.reason));
  assert.ok(result.elapsedMs > 1); assert.ok(result.attempts > 0);
  const again = search.optimizePath({ points, initialPath: result.path, cutThreshold: 3, untilStable: true });
  assert.equal(again.improvements, 0); assert.equal(model.validateRoute(result.path, points), "");
});
test("empty, locked, minimum-score, zero-budget and incomplete routes are handled safely", () => {
  const search = make(), points = fixtures.timerRecovery, path = model.expandCells(points, 3);
  assert.equal(search.optimizePath({ points: [], initialPath: [], totalLimitMs: 1 }).metrics.score, 0);
  const locked = search.optimizePath({ points, initialPath: path, constraints: { lockedPrefix: path }, totalLimitMs: 50 });
  assert.deepEqual(locked.path, path); assert.equal(locked.reason, "locked");
  const single = model.expandCells([{ x: 0, y: 0 }]);
  assert.equal(search.optimizePath({ points: [{ x: 0, y: 0 }], initialPath: single, totalLimitMs: 50 }).reason, "lower-bound");
  const zero = search.optimizePath({ points, initialPath: path, cutThreshold: 3, totalLimitMs: 0 });
  assert.ok(zero.metrics.score <= score(path)); assert.equal(zero.attempts, 0);
  assert.throws(() => search.optimizePath({ points, initialPath: path.slice(1) }), /complet/);
});
