const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createRelaySearch } = require("../src/relay-search.js");
const { createBlockOptimizer } = require("../src/block-optimizer-worker.js");
const { createAdaptiveOptimizer } = require("../src/adaptive-optimizer-worker.js");
const seeded = (seed = 31) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const engine = (clock = () => performance.now(), seed) => createAdaptiveOptimizer(model, createOrthogonalPathBuilder, createRelaySearch, clock, seeded(seed));
const score = path => model.metrics(path, 3, true).score;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

function oracle(path, start, size, constraints) {
  const remaining = path.slice(start, start + size), candidate = path.map(model.copy);
  let best = Infinity;
  function visit(at) {
    if (at === size) {
      try {
        const oriented = model.orient(candidate, 3, constraints, true);
        if (!model.validateRoute(oriented, null) && model.satisfiesConstraints(oriented, constraints)) best = Math.min(best, score(oriented));
      } catch { /* Infeasible direction assignment. */ }
      return;
    }
    for (let i = at; i < size; i++) {
      [remaining[at], remaining[i]] = [remaining[i], remaining[at]];
      candidate[start + at] = remaining[at]; visit(at + 1);
      [remaining[at], remaining[i]] = [remaining[i], remaining[at]];
    }
  }
  visit(0); return best;
}

test("exact repairs match exhaustive ordering with globally free directions and fixed prefix", () => {
  const cells = [{ x: 0, y: 0 }, { x: 5, y: 2 }, { x: 2, y: 4 }, { x: 7, y: 0 }];
  const search = engine(() => 0);
  for (const [start, size] of [[0, 6], [1, 6], [2, 4], [4, 4]]) {
    const path = model.expandCells(cells, 3); path[4].cutBefore = true;
    const constraints = { forcedCuts: [path[4]], ...(start ? { lockedPrefix: path.slice(0, 1), start: path[0] } : {}) };
    const before = JSON.stringify(path), result = search.exactRepair(search.context(path, 3, constraints), start, size);
    assert.equal(result.exact, true); assert.ok(result.path);
    assert.equal(model.validateRoute(result.path, cells), "");
    assert.ok(model.satisfiesConstraints(result.path, constraints));
    close(score(result.path), oracle(path, start, size, constraints)); close(result.score, score(result.path));
    assert.equal(JSON.stringify(path), before);
  }
});

test("free insertion moves a single diagonal outside its old slot while keeping every constraint", () => {
  const cells = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 1, y: 0 }, { x: 9, y: 0 }, { x: 2, y: 0 }];
  const path = model.expandCells(cells, 3), search = engine(() => 0);
  const constraints = { start: path[0], lockedPrefix: path.slice(0, 1), forcedCuts: [path[6]] };
  path[6].cutBefore = true;
  const before = JSON.stringify(path), state = search.context(path, 3, constraints);
  let moved = false, gained = false;
  for (const indices of [[2], [3], [4], [2, 3], [2, 4, 6], [1, 3, 5, 7]]) {
    for (const regret of [false, true]) {
      const result = search.freeRepair(state, indices, { regret });
      assert.ok(result.path); assert.equal(model.validateRoute(result.path, cells), "");
      assert.ok(model.satisfiesConstraints(result.path, constraints));
      moved ||= indices.some(i => model.key(result.path[i]) !== model.key(path[i]));
      gained ||= score(result.path) < score(path) - 1e-8;
    }
  }
  assert.ok(moved); assert.ok(gained); assert.equal(JSON.stringify(path), before);
});

test("all neighborhoods protect locked diagonals; interrupted repairs never publish partial work", () => {
  const path = model.expandCells(Array.from({ length: 12 }, (_, i) => ({ x: i % 4 * 2, y: Math.floor(i / 4) * 2 })));
  let now = 0; const search = engine(() => now += 10), constraints = { lockedPrefix: path.slice(0, 4) };
  const state = search.context(path, 3, constraints);
  for (let kind = 0; kind < 4; kind++) {
    const selected = search.select(state, kind, 10);
    assert.equal(selected.length, 10); assert.equal(new Set(selected).size, 10);
    assert.ok(selected.every(i => i >= 4));
  }
  assert.equal(search.exactRepair(state, 4, 12, 1).path, null);
  assert.equal(search.freeRepair(state, [4, 5, 6], { deadline: 1 }).path, null);
});

test("orthogonal construction attains the proven unit-link lower bound", () => {
  const points = Array.from({ length: 25 }, (_, i) => ({ x: i % 5, y: Math.floor(i / 5) }));
  const result = engine().optimizePath({ points, totalLimitMs: 100 });
  assert.equal(model.validateRoute(result.path, points), "");
  close(result.metrics.score, 49); assert.equal(result.reason, "lower-bound");
});

test("search publishes only valid non-worsening incumbents, adapts weights and respects its budget", () => {
  const points = require("./fixtures/combined-search.js").timerRecovery;
  const initialPath = model.expandCells(points, 3), before = JSON.stringify(initialPath), snapshots = [];
  const constraints = { lockedPrefix: initialPath.slice(0, 2), start: initialPath[0], forcedCuts: [initialPath[10]] };
  initialPath[10].cutBefore = true;
  const result = engine().optimizePath({ points, initialPath, cutThreshold: 3, constraints, totalLimitMs: 700 }, s => snapshots.push(s));
  let previous = score(initialPath);
  for (const s of snapshots.filter(s => s.path)) {
    assert.equal(model.validateRoute(s.path, points), ""); assert.ok(model.satisfiesConstraints(s.path, constraints));
    close(s.metrics.score, score(s.path)); assert.ok(s.metrics.score <= previous + 1e-8); previous = s.metrics.score;
  }
  assert.ok(result.lns.iterations > 0); assert.ok(result.attempts > 0);
  assert.ok(result.adaptive.weights.some(w => w !== 1)); assert.ok(result.adaptive.weights.every(w => w >= 0.25));
  assert.ok(result.elapsedMs < 1500); assert.ok(result.metrics.score <= score(initialPath));
  delete initialPath[10].cutBefore; assert.equal(JSON.stringify(initialPath), before);
});

test("large routes remain valid and keep their incumbent even with a tiny budget", () => {
  const points = Array.from({ length: 2000 }, (_, i) => ({ x: i % 50 * 2, y: Math.floor(i / 50) * 2 }));
  const initialPath = model.expandCells(points, 3), before = JSON.stringify(initialPath);
  const result = engine().optimizePath({ points, initialPath, cutThreshold: 3, totalLimitMs: 40 });
  assert.equal(model.validateRoute(result.path, points), ""); assert.ok(result.metrics.score <= score(initialPath) + 1e-8);
  assert.equal(JSON.stringify(initialPath), before); assert.ok(result.elapsedMs < 2000);
});

test("the optional block seed preserves the best route and still hands over to adaptive search", () => {
  const points = require("./fixtures/combined-search.js").interleaved, initialPath = model.expandCells(points, 3);
  const search = createAdaptiveOptimizer(model, createOrthogonalPathBuilder, createRelaySearch, () => performance.now(), seeded(73), createBlockOptimizer);
  const result = search.optimizePath({ points, initialPath, cutThreshold: 3, totalLimitMs: 500 });
  assert.equal(model.validateRoute(result.path, points), ""); assert.ok(result.metrics.score <= score(initialPath));
  assert.equal(result.lns.seeds, 5); assert.ok(result.lns.iterations > 0);
});

test("construction from an unfinished locked prefix preserves open crosses and imposed cuts", () => {
  const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 2 }, { x: 4, y: 2 }];
  const prefix = model.orient(points.slice(0, 2).map(p => ({ ...p, diagonal: "lower", direction: 1 })), 3, {}, true);
  const constraints = { lockedPrefix: prefix, start: prefix[0], forcedCuts: [{ ...points[2], diagonal: "upper", direction: 1 }] };
  const result = engine().optimizePath({ points, constraints, cutThreshold: 3, totalLimitMs: 100 });
  assert.equal(model.validateRoute(result.path, points), ""); assert.ok(model.satisfiesConstraints(result.path, constraints));
  assert.deepEqual(result.path.slice(0, prefix.length), prefix);
});

test("inactivity follows only accepted global gains, not diversification, with no total cap", () => {
  for (const totalLimitMs of [undefined, 1]) {
    let now = 0; const orientations = [], snapshots = [], limit = 1000;
    const tracked = { ...model, orient(...args) { orientations.push(now); return model.orient(...args); } };
    const points = require("./fixtures/combined-search.js").interleaved, initialPath = model.expandCells(points, 3);
    initialPath[10].cutBefore = true;
    const constraints = { lockedPrefix: initialPath.slice(0, 3), start: initialPath[0], forcedCuts: [initialPath[10]] };
    const before = JSON.stringify({ initialPath, constraints });
    const search = createAdaptiveOptimizer(tracked, createOrthogonalPathBuilder, createRelaySearch, () => ++now, seeded());
    const result = search.optimizePath({ points, initialPath, constraints, cutThreshold: 3, stopAfterInactivity: true,
      stagnationLimitMs: limit, ...(totalLimitMs === undefined ? {} : { totalLimitMs }) }, s => snapshots.push(s));
    let previousScore = score(initialPath), previousGain = 0;
    for (const s of [...snapshots, result]) {
      assert.equal(s.stopAfterInactivity, true); assert.equal(s.totalLimitMs, null);
      assert.equal(s.stagnationLimitMs, limit);
      assert.equal(s.remainingMs, Math.max(0, limit - s.lastImprovementMs));
      assert.equal(s.progress, s.stage === "complete" ? 100 : Math.min(100, s.lastImprovementMs / limit * 100));
      const gainAt = s.elapsedMs - s.lastImprovementMs;
      if (s.metrics && s.metrics.score < previousScore - 1e-8) {
        assert.ok(gainAt > previousGain); assert.ok(s.lastImprovementMs <= 1); assert.ok(s.path);
      } else assert.equal(gainAt, previousGain, "ties and working-route changes must not reset inactivity");
      if (s.path) {
        assert.equal(model.validateRoute(s.path, points), ""); assert.ok(model.satisfiesConstraints(s.path, constraints));
        close(s.metrics.score, score(s.path)); assert.ok(s.metrics.score <= previousScore + 1e-8);
      }
      previousScore = s.metrics?.score ?? previousScore; previousGain = gainAt;
    }
    assert.ok(result.improvements > 0); assert.ok(result.lns.diversifications > 0);
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
    const search = createAdaptiveOptimizer(tracked, createOrthogonalPathBuilder, createRelaySearch, clock, seeded());
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
    assert.equal(gain.lns.iterations, 0, "the first gain comes only from final orientation");
    assert.ok(result.metrics.score < score(initialPath)); assert.equal(result.stopAfterInactivity, stopAfterInactivity);
    if (stopAfterInactivity) {
      assert.ok(result.lns.iterations > 0, "main search resumes after the orientation gain");
      assert.ok(orientations > 2); assert.equal(result.reason, "inactivity");
      assert.ok(result.lastImprovementMs >= limit); assert.ok(result.elapsedMs >= 2 * limit);
      assert.equal(result.remainingMs, 0); assert.equal(snapshots.at(-1).remainingMs, 0);
    } else {
      assert.equal(result.lns.iterations, 0); assert.equal(orientations, 2);
      assert.equal(result.reason, "budget"); assert.ok(result.lastImprovementMs < limit);
    }
  }
});

test("stagnation options alone do not change the legacy total budget", () => {
  let now = 0;
  const points = require("./fixtures/combined-search.js").interleaved, initialPath = model.expandCells(points, 3);
  const result = engine(() => ++now).optimizePath({ points, initialPath, cutThreshold: 3, totalLimitMs: 1000, stagnationLimitMs: 1 });
  assert.equal(result.stopAfterInactivity, false); assert.equal(result.totalLimitMs, 1000);
  assert.equal(result.reason, "budget"); assert.equal(result.remainingMs, 0);
  assert.ok(result.elapsedMs >= 1000 && result.elapsedMs < 1030);
});
