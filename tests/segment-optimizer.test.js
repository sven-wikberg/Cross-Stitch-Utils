const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder: builder } = require("../src/orthogonal-path-worker.js");
const { createRelaySearch: relay } = require("../src/relay-search.js");
const { createSegmentOptimizer } = require("../src/segment-optimizer-worker.js");
const fixtures = require("./fixtures/combined-search.js");
const make = (clock, random) => createSegmentOptimizer(model, builder, relay, clock, random);
const score = path => model.metrics(path, 3, true).score;
function* permutations(ids) {
  if (!ids.length) { yield []; return; }
  for (const id of ids) for (const rest of permutations(ids.filter(i => i !== id))) yield [id, ...rest];
}
function oracle(search, state, ranges, cells) {
  let best = Infinity;
  for (const order of permutations(ranges.map((_, i) => i))) {
    const route = search.materialize(state, search.piecesFor(ranges, order, state.path.length));
    if (route && !model.validateRoute(route, cells) && model.satisfiesConstraints(route, state.constraints)) best = Math.min(best, score(route));
  }
  return best;
}
test("unit segments cover the movable suffix without crossing a cut or a locked prefix", () => {
  const cells = fixtures.timerRecovery, path = model.expandCells(cells, 3);
  path[5].cutBefore = true;
  const search = make(), state = search.context(path, 3, { lockedPrefix: path.slice(0, 3) });
  assert.equal(state.segments[0].start, 3);
  assert.ok(state.segments.some(s => s.start === 5));
  assert.equal(state.segments.reduce((sum, s) => sum + s.end - s.start, 0), path.length - 3);
  for (const s of state.segments) for (let i = s.start + 1; i < s.end; i++) assert.equal(model.distance(path[i - 1], path[i]), 1);
  assert.equal(state.owner[2], -1);
  assert.ok(state.links.every((link, i) => !i || link.cost <= state.links[i - 1].cost));
});
test("joint permutations and all directions equal an exhaustive oracle with unequal segments and fixed gaps", () => {
  const cells = fixtures.timerRecovery, search = make(), path = model.expandCells(cells, 3), state = search.context(path, 3);
  for (const ranges of [
    [{ start: 0, end: 2 }, { start: 4, end: 8 }, { start: 12, end: 18 }, { start: 20, end: 24 }],
    [{ start: 2, end: 5 }, { start: 6, end: 10 }, { start: 13, end: 15 }, { start: 17, end: 20 }]
  ]) {
    const result = search.repair(state, ranges);
    assert.ok(result.exact);
    assert.ok(Math.abs(result.score - oracle(search, state, ranges, cells)) < 1e-8);
    const route = search.materialize(state, result.pieces);
    assert.equal(model.validateRoute(route, cells), "");
    assert.ok(Math.abs(score(route) - result.score) < 1e-8);
  }
});
test("half-cross precedence survives selected segments, untouched gaps, imposed cuts and open locked crosses", () => {
  const cells = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }];
  const sequence = cells.map(p => ({ ...p, diagonal: "lower", direction: 1 }))
    .concat(cells.toReversed().map(p => ({ ...p, diagonal: "upper", direction: 1 })));
  const path = model.orient(sequence, 3, {}, true); path[8].cutBefore = true;
  const constraints = { lockedPrefix: path.slice(0, 1), forcedCuts: [path[8]] }, search = make(), state = search.context(path, 3, constraints);
  const ranges = [{ start: 1, end: 3 }, { start: 4, end: 5 }, { start: 5, end: 7 }, { start: 8, end: 9 }];
  const result = search.repair(state, ranges), route = search.materialize(state, result.pieces);
  assert.ok(Math.abs(result.score - oracle(search, state, ranges, cells)) < 1e-8);
  assert.equal(model.validateRoute(route, cells), ""); assert.ok(model.satisfiesConstraints(route, constraints));
  assert.deepEqual(route[0], path[0]);
  assert.ok(route.slice(1).every((p, i) => model.distance(route[i], p) > 0));
});
test("joint repair can accept a coordinated permutation without committing its intermediate moves", () => {
  const cells = [[1, 11], [4, 5], [5, 1], [8, 1], [12, 2], [13, 12], [10, 13]].map(([x, y]) => ({ x, y }));
  const route = order => model.orient(order.flatMap(p => ["lower", "upper"].map(diagonal => ({ ...p, diagonal, direction: 1 }))), 3, {}, true);
  const path = route(cells), search = make(), state = search.context(path, 3);
  for (let i = 0; i < cells.length; i++) for (let j = 0; j < cells.length; j++) {
    const candidate = cells.slice(), [moved] = candidate.splice(i, 1); candidate.splice(j, 0, moved);
    assert.ok(score(route(candidate)) >= score(path) - 1e-8, "Every single-segment relocation is stuck");
  }
  const ranges = cells.map((_, i) => ({ start: i * 2, end: i * 2 + 2 }));
  const result = search.repair(state, ranges);
  assert.ok(result.order.filter((id, slot) => id !== slot).length >= 2);
  assert.ok(result.score < score(path) - 1e-8);
  assert.equal(model.validateRoute(search.materialize(state, result.pieces), cells), "");
});
test("random interleaved routes match exhaustive repairs across noncontiguous slots", () => {
  let seed = 241; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const search = make();
  for (let sample = 0; sample < 40; sample++) {
    const cells = Array.from({ length: 6 }, (_, x) => ({ x: x * 2, y: Math.floor(random() * 6) }));
    const remaining = cells.map(p => ({ ...p, diagonal: "lower", direction: 1 })), sequence = [];
    while (remaining.length) {
      const [p] = remaining.splice(Math.floor(random() * remaining.length), 1); sequence.push(p);
      if (p.diagonal === "lower") remaining.push({ ...p, diagonal: "upper" });
    }
    const path = model.orient(sequence, 3, {}, true), locked = sample % 3;
    const constraints = { lockedPrefix: path.slice(0, locked) }, state = search.context(path, 3, constraints);
    const ranges = [{ start: 3, end: 4 }, { start: 4, end: 6 }, { start: 7, end: 9 }, { start: 10, end: 12 }];
    const result = search.repair(state, ranges);
    assert.ok(result.exact); assert.ok(Math.abs(result.score - oracle(search, state, ranges, cells)) < 1e-8);
    assert.equal(model.validateRoute(search.materialize(state, result.pieces), cells), "");
  }
});
test("neighborhood selection reopens long runs and includes linked diagonals without overlapping ranges", () => {
  const search = make(), state = search.context(model.expandCells(fixtures.interleaved, 3), 3);
  for (const kind of [0, 1, 2]) for (let round = 0; round < 5; round++) {
    const ranges = search.selectRanges(state, state.links[0], kind, round, 10);
    assert.ok(ranges.length <= 10);
    assert.ok(ranges.every((r, i) => r.start >= state.locked && r.end <= state.path.length && r.end > r.start && (!i || ranges[i - 1].end <= r.start)));
    if (kind) assert.ok(ranges.reduce((sum, r) => sum + r.end - r.start, 0) <= 10 * 16);
  }
});
test("deadline does not publish a partially solved neighborhood", () => {
  let time = 0; const search = make(() => time++), state = search.context(model.expandCells(fixtures.timerRecovery, 3), 3);
  const ranges = Array.from({ length: 8 }, (_, i) => ({ start: i * 3, end: i * 3 + 3 }));
  const result = search.repair(state, ranges, { deadline: 2 });
  assert.equal(result.pieces, null); assert.equal(result.exact, false);
});
test("full engine preserves input, valid monotone best snapshots and all constraints", () => {
  const cells = fixtures.interleaved, path = model.expandCells(cells, 3); path[8].cutBefore = true;
  const constraints = { lockedPrefix: path.slice(0, 3), forcedCuts: [path[8]] }, before = JSON.stringify(path);
  let randomState = 47, previous = score(path);
  const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const result = make(undefined, random).optimizePath({ points: cells, initialPath: path, constraints, cutThreshold: 3, totalLimitMs: 250 }, s => {
    if (!s.path) return;
    assert.equal(model.validateRoute(s.path, cells), ""); assert.ok(model.satisfiesConstraints(s.path, constraints));
    assert.ok(s.metrics.score <= previous + 1e-8); assert.ok(Math.abs(s.metrics.score - score(s.path)) < 1e-8); previous = s.metrics.score;
  });
  assert.equal(JSON.stringify(path), before); assert.ok(result.segmentSearch.repairs > 0);
  assert.ok(result.elapsedMs < 2000); assert.ok(result.metrics.score <= score(path));
});
test("empty, fully locked, zero budget and invalid routes are handled without rebuilding a saved path", () => {
  const search = make(), cells = fixtures.timerRecovery, path = model.expandCells(cells, 3);
  assert.equal(search.optimizePath({ points: [], initialPath: [], totalLimitMs: 5 }).metrics.score, 0);
  const locked = search.optimizePath({ points: cells, initialPath: path, constraints: { lockedPrefix: path }, totalLimitMs: 50 });
  assert.deepEqual(locked.path, path);
  const zero = search.optimizePath({ points: cells, initialPath: path, totalLimitMs: 0, cutThreshold: 3 });
  assert.ok(zero.metrics.score <= score(path)); assert.equal(zero.segmentSearch.repairs, 0);
  assert.throws(() => search.optimizePath({ points: cells, initialPath: path.slice(1) }), /complet/);
});

test("inactivity follows only accepted global gains, not diversification, with no total cap", () => {
  for (const totalLimitMs of [undefined, 1]) {
    let now = 0, seed = 3; const orientations = [], snapshots = [], limit = 2000;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const tracked = { ...model, orient(...args) { orientations.push(now); return model.orient(...args); } };
    const points = fixtures.interleaved, initialPath = model.expandCells(points, 3);
    initialPath[10].cutBefore = true;
    const constraints = { lockedPrefix: initialPath.slice(0, 3), start: initialPath[0], forcedCuts: [initialPath[10]] };
    const before = JSON.stringify({ initialPath, constraints });
    const search = createSegmentOptimizer(tracked, builder, relay, () => ++now, random);
    const result = search.optimizePath({ points, initialPath, constraints, cutThreshold: 3, stopAfterInactivity: true,
      stagnationLimitMs: limit, ...(totalLimitMs === undefined ? {} : { totalLimitMs }) }, s => snapshots.push(s));
    let previousScore = score(initialPath), previousGain = 0;
    for (const s of [...snapshots, result]) {
      assert.equal(s.stopAfterInactivity, true); assert.equal(s.totalLimitMs, null);
      assert.equal(s.stagnationLimitMs, limit);
      assert.equal(s.remainingMs, Math.max(0, limit - s.lastImprovementMs));
      assert.equal(s.progress, s.stage === "complete" ? 100 : Math.min(100, s.lastImprovementMs / limit * 100));
      const gainAt = s.elapsedMs - s.lastImprovementMs;
      if (s.metrics.score < previousScore - 1e-8) {
        assert.ok(gainAt > previousGain); assert.ok(s.lastImprovementMs <= 1); assert.ok(s.path);
      } else assert.equal(gainAt, previousGain, "ties and working-route changes must not reset inactivity");
      if (s.path) {
        assert.equal(model.validateRoute(s.path, points), ""); assert.ok(model.satisfiesConstraints(s.path, constraints));
        assert.ok(Math.abs(s.metrics.score - score(s.path)) < 1e-7); assert.ok(s.metrics.score <= previousScore + 1e-8);
      }
      previousScore = s.metrics.score; previousGain = gainAt;
    }
    assert.ok(result.improvements > 0); assert.ok(result.segmentSearch.diversifications > 0);
    assert.ok(result.elapsedMs > limit); assert.ok(result.lastImprovementMs >= limit);
    assert.ok(result.lastImprovementMs < limit + 30); assert.equal(result.reason, "inactivity");
    assert.ok(orientations.at(-1) - 1 >= previousGain + limit, "global orientation still runs after expiry");
    assert.equal(JSON.stringify({ initialPath, constraints }), before);
  }
});

test("a final orientation gain resumes inactivity search but legacy mode finishes once", () => {
  for (const stopAfterInactivity of [false, true]) {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }];
    const initialPath = points.flatMap(p => ["lower", "upper"].map(diagonal => ({ ...p, diagonal, direction: 1 })));
    initialPath[1].direction = -1;
    let now = 0, orientations = 0, resumed = false; const snapshots = [], limit = 100;
    const clock = () => resumed ? ++now : now;
    const tracked = { ...model, orient(...args) {
      orientations++;
      return orientations === 1 ? args[0].map(model.copy) : model.orient(...args);
    } };
    const search = createSegmentOptimizer(tracked, builder, relay, clock, () => 0.25);
    const result = search.optimizePath({ points, initialPath, cutThreshold: 3, stopAfterInactivity,
      stagnationLimitMs: limit, totalLimitMs: limit }, s => {
      snapshots.push(s);
      if (s.path && !s.improvements) now = limit + 1;
      if (s.improvements) resumed = true;
    });
    const gain = snapshots.find(s => s.improvements);
    assert.ok(gain); assert.equal(gain.lastImprovementMs, 0);
    assert.equal(gain.remainingMs, stopAfterInactivity ? limit : 0);
    assert.equal(gain.progress, stopAfterInactivity ? 0 : 100);
    assert.equal(gain.segmentSearch.repairs, 0, "the first gain comes only from final orientation");
    assert.ok(result.metrics.score < score(initialPath)); assert.equal(result.stopAfterInactivity, stopAfterInactivity);
    if (stopAfterInactivity) {
      assert.ok(result.segmentSearch.repairs > 0, "main search resumes after the orientation gain");
      assert.ok(orientations > 2); assert.equal(result.reason, "inactivity");
      assert.ok(result.lastImprovementMs >= limit); assert.ok(result.elapsedMs >= 2 * limit);
      assert.equal(result.remainingMs, 0); assert.equal(snapshots.at(-1).remainingMs, 0);
    } else {
      assert.equal(result.segmentSearch.repairs, 0); assert.equal(orientations, 2);
      assert.equal(result.reason, "time-limit"); assert.ok(result.lastImprovementMs < limit);
    }
  }
});

test("stagnation options alone do not change the legacy total budget", () => {
  let now = 0, seed = 31;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const points = fixtures.interleaved, initialPath = model.expandCells(points, 3);
  const result = make(() => ++now, random).optimizePath({ points, initialPath, cutThreshold: 3, totalLimitMs: 1000, stagnationLimitMs: 1 });
  assert.equal(result.stopAfterInactivity, false); assert.equal(result.totalLimitMs, 1000);
  assert.equal(result.reason, "time-limit"); assert.equal(result.remainingMs, 0);
  assert.ok(result.elapsedMs >= 1000 && result.elapsedMs < 1030);
});
