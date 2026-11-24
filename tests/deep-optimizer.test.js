const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createBlockOptimizer } = require("../src/block-optimizer-worker.js");
const { createRelaySearch } = require("../src/relay-search.js");
const { createRelayOptimizer } = require("../src/relay-optimizer-worker.js");
const { createLnsSearch, createDeepOptimizer } = require("../src/deep-optimizer-worker.js");
const { createPathVisuals } = require("../src/path-visuals.js");
const seeded = () => { let s = 31; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); };
const engine = (clock, random = seeded()) => createDeepOptimizer(model, createOrthogonalPathBuilder,
  createBlockOptimizer, createRelaySearch, createLnsSearch, clock, random);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

function oracle(path, indices, threshold, constraints) {
  let best = Infinity;
  const candidate = path.map(model.copy), remaining = indices.map(i => path[i]);
  function visit(slot) {
    if (slot === indices.length) {
      if (!model.validateRoute(candidate, null) && model.satisfiesConstraints(candidate, constraints)) {
        best = Math.min(best, model.metrics(candidate, threshold, true).score);
      }
      return;
    }
    for (let i = slot; i < remaining.length; i++) {
      [remaining[slot], remaining[i]] = [remaining[i], remaining[slot]];
      for (const direction of [1, -1]) { candidate[indices[slot]] = { ...remaining[slot], direction }; visit(slot + 1); }
      [remaining[slot], remaining[i]] = [remaining[i], remaining[slot]];
    }
  }
  visit(0); return best;
}

test("LNS subset repair matches exhaustive order/direction choices including all fixed-gap boundaries", () => {
  const points = [{ x: 0, y: 0 }, { x: 5, y: 2 }, { x: 2, y: 4 }, { x: 7, y: 0 }];
  const search = createLnsSearch(model, () => 0, seeded());
  for (const threshold of [2, 10]) for (const indices of [[0, 1, 2, 3, 4, 5], [1, 3, 4, 6], [2, 3, 5], [7]]) {
    const path = model.expandCells(points, threshold); path[4].cutBefore = true;
    const constraints = { forcedCuts: [path[4]], ...(indices[0] ? { start: path[0], lockedPrefix: path.slice(0, 1) } : {}) };
    const before = JSON.stringify(path), result = search.repairNeighborhood(path, indices, { cutThreshold: threshold, constraints });
    assert.ok(result.path);
    assert.equal(model.validateRoute(result.path, points), "");
    assert.ok(model.satisfiesConstraints(result.path, constraints));
    close(result.metrics.score, oracle(path, indices, threshold, constraints));
    close(result.metrics.score, model.metrics(result.path, threshold, true).score);
    for (let i = 0; i < path.length; i++) if (!indices.includes(i)) assert.deepEqual(result.path[i], path[i]);
    assert.equal(JSON.stringify(path), before);
    assert.ok(result.metrics.score <= model.metrics(path, threshold, true).score + 1e-8);
  }
});

test("neighborhoods include complete crosses, route fragments and diverse spatial choices without locked actions", () => {
  const points = require("./fixtures/combined-search.js").interleaved, path = model.expandCells(points);
  const search = createLnsSearch(model, () => 0, seeded()), constraints = { lockedPrefix: path.slice(0, 3), start: path[0] };
  const state = search.context(path, constraints), kinds = new Set();
  for (let round = 0; round < 12; round++) {
    const { indices, kind } = search.selectNeighborhood(state, round, 10); kinds.add(kind);
    assert.ok(indices.length > 0 && indices.length <= 10);
    assert.equal(new Set(indices).size, indices.length);
    assert.ok(indices.every(i => i >= 3 && i < path.length));
    if (round % 4 !== 2) for (const i of indices) {
      const other = state.byKey.get(`${model.cellKey(path[i])}:${path[i].diagonal === "lower" ? "upper" : "lower"}`);
      assert.ok(other < 3 || indices.includes(other));
    }
  }
  assert.equal(kinds.size, 3);
  assert.deepEqual(search.selectNeighborhood(search.context(path, { lockedPrefix: path }), 0, 14).indices, []);
  assert.throws(() => search.repairNeighborhood(path, [0, 1], { constraints }), /invalide/);
  assert.throws(() => search.repairNeighborhood(path, Array.from({ length: 15 }, (_, i) => i)), /invalide/);
});

test("LNS repairs interleaved half-crosses without violating counterparts outside the neighborhood", () => {
  const points = [{ x: 0, y: 0 }, { x: 4, y: 1 }, { x: 1, y: 4 }, { x: 5, y: 5 }];
  const sequence = ["lower", "upper"].flatMap(diagonal => points.map(p => ({ ...p, diagonal, direction: 1 })));
  const path = model.orient(sequence, 3, {}, true), search = createLnsSearch(model, () => 0, seeded());
  const constraints = { start: path[0], lockedPrefix: path.slice(0, 2) };
  for (const indices of [[2, 3, 4, 5, 6, 7], [2, 4, 5], [3, 4, 7], [6, 7]]) {
    const result = search.repairNeighborhood(path, indices, { constraints, cutThreshold: 3 });
    assert.equal(model.validateRoute(result.path, points), "");
    assert.ok(model.satisfiesConstraints(result.path, constraints));
    close(result.metrics.score, oracle(path, indices, 3, constraints));
    for (let i = 0; i < path.length; i++) if (!indices.includes(i)) assert.deepEqual(result.path[i], path[i]);
  }
});

test("an interrupted repair never returns an incomplete route or mutates the incumbent", () => {
  const path = model.expandCells(Array.from({ length: 7 }, (_, i) => ({ x: i * 3, y: i % 2 })));
  const before = JSON.stringify(path); let now = 0;
  const result = createLnsSearch(model, () => now += 10).repairNeighborhood(path, path.map((_, i) => i), { deadline: 20 });
  assert.equal(result.timedOut, true); assert.equal(result.path, null);
  assert.equal(JSON.stringify(path), before);
  assert.ok(now <= 30);
});

test("deep search uses one total deadline, preserves constraints, and publishes only complete global best routes", () => {
  const points = require("./fixtures/combined-search.js").timerRecovery;
  const initialPath = model.expandCells(points, 3); initialPath[6].cutBefore = true;
  const constraints = { start: initialPath[0], lockedPrefix: initialPath.slice(0, 3), forcedCuts: [initialPath[6]] };
  const before = JSON.stringify({ initialPath, constraints }), reports = []; let now = 0;
  const result = engine(() => ++now).optimizePath({ points, initialPath, constraints, cutThreshold: 3, warmupMs: 0, totalLimitMs: 3000 }, s => reports.push(s));
  let previous = model.metrics(initialPath, 3, true).score;
  for (const snapshot of reports) {
    assert.equal(snapshot.method, "deep-optimization"); assert.equal(snapshot.totalLimitMs, 3000);
    if (!snapshot.path) continue;
    assert.equal(model.validateRoute(snapshot.path, points), "");
    assert.ok(model.satisfiesConstraints(snapshot.path, constraints));
    close(snapshot.metrics.score, model.metrics(snapshot.path, 3, true).score);
    assert.ok(snapshot.metrics.score <= previous + 1e-8); previous = snapshot.metrics.score;
  }
  assert.ok(result.lns.iterations > 2 && result.lns.repairs > 0 && result.lns.improvements > 0);
  assert.ok(result.elapsedMs >= 3000 && result.elapsedMs < 3100, "gains do not reset the total deadline");
  assert.equal(result.reason, "time-limit");
  assert.equal(JSON.stringify({ initialPath, constraints }), before);
  assert.ok(result.metrics.score < model.metrics(initialPath, 3, true).score);
  assert.equal(result.relayChange, null, "old relay highlights are not reused for LNS gains");
});

test("warmup is bounded and existing best routes survive the transition to LNS", () => {
  const points = require("./fixtures/combined-search.js").timerRecovery, reports = [];
  const initialPath = model.expandCells(points, 3); let now = 0;
  const result = engine(() => ++now).optimizePath({ points, initialPath, cutThreshold: 3, totalLimitMs: 5000 }, s => reports.push(s));
  const firstLns = reports.find(s => s.stage === "lns");
  assert.ok(firstLns && result.lns.iterations > 0);
  assert.ok(firstLns.elapsedMs < 2500, "warmup cannot keep resetting its time budget on gains");
  assert.ok(result.metrics.score <= firstLns.metrics.score);
  assert.equal(model.validateRoute(result.path, points), "");
});

test("deep search builds missing routes and can finish early for locked or proven lower-bound paths", () => {
  const points = [{ x: 0, y: 0 }, { x: 7, y: 3 }], reports = []; let now = 0;
  const built = engine(() => now += 100).optimizePath({ points, totalLimitMs: 10000 }, s => reports.push(s));
  assert.ok(reports.some(s => s.stage === "construction" && Array.isArray(s.path)), "construction is visible when no complete path exists");
  for (const s of reports) if (s.path) assert.equal(model.validateRoute(s.path, points, s.stage !== "construction"), "");
  assert.equal(model.validateRoute(built.path, points), "");
  const locked = engine(() => ++now).optimizePath({ points, initialPath: built.path,
    constraints: { lockedPrefix: built.path }, warmupMs: 0, totalLimitMs: 1000 });
  assert.equal(locked.reason, "locked"); assert.deepEqual(locked.path, built.path);
  const singleton = [{ x: 0, y: 0 }], path = model.expandCells(singleton);
  const optimal = engine(() => ++now).optimizePath({ points: singleton, initialPath: path, warmupMs: 0 });
  assert.equal(optimal.totalLimitMs, 3600000); assert.equal(optimal.reason, "lower-bound");
});

test("deep progress counts elapsed budget rather than inactivity and remains separate from normal mode", () => {
  const visuals = createPathVisuals(model, createOrthogonalPathBuilder(model));
  for (const stage of ["preparation", "search", "relay", "lns"]) {
    const view = visuals.searchPresentation({ method: "deep-optimization", stage, totalLimitMs: 3600000,
      elapsedMs: 120000, lastImprovementMs: 0, stagnationLimitMs: 2000 }, true);
    assert.ok(view.timed && view.active && !view.searching);
    assert.equal(view.max, 3600000); assert.equal(view.value, 120000); assert.equal(view.label, "Temps restant");
  }
  assert.equal(visuals.searchPresentation({ method: "deep-optimization", stage: "lns" }, false).active, false);
});

test("coordinated LNS repair improves a real block-and-relay plateau", () => {
  const points = require("./fixtures/combined-search.js").timerRecovery;
  const base = createBlockOptimizer(model, createOrthogonalPathBuilder, () => 0, seeded()).optimizePath(
    { points, cutThreshold: 3, stagnationLimitMs: 1 });
  const plateau = createRelayOptimizer(model, createOrthogonalPathBuilder, createRelaySearch).optimizePath({ points, initialPath: base.path, cutThreshold: 3 });
  let now = 0;
  const result = engine(() => ++now).optimizePath({ points, initialPath: plateau.path, cutThreshold: 3,
    totalLimitMs: 30000, warmupMs: 0 });
  assert.ok(result.metrics.score < plateau.metrics.score - 1);
  assert.ok(result.lns.improvements >= 1 && result.lns.diversifications > 0);
  assert.equal(model.validateRoute(result.path, points), "");
});

test("M6 inactivity restarts only for accepted global gains, not repairs or diversifications", () => {
  const points = require("./fixtures/combined-search.js").timerRecovery;
  const initialPath = model.expandCells(points, 3), reports = []; let now = 0;
  const result = engine(() => ++now).optimizePath({ points, initialPath, cutThreshold: 3, warmupMs: 0,
    stopAfterInactivity: true, stagnationLimitMs: 1000, totalLimitMs: 1 }, s => reports.push(s));
  let score = model.metrics(initialPath, 3, true).score, lastGainAt = 0, gains = 0, searchReady = false;
  for (const s of reports) {
    assert.equal(s.stopAfterInactivity, true); assert.equal(s.totalLimitMs, null);
    assert.equal(s.stagnationLimitMs, 1000);
    const gainAt = s.elapsedMs - s.lastImprovementMs;
    if (s.preparing) assert.equal(s.lastImprovementMs, 0);
    else if (!searchReady) { assert.equal(gainAt, s.preparationMs); searchReady = true; }
    else if (s.metrics.score < score - 1e-8) {
      assert.ok(gainAt > lastGainAt); assert.ok(s.lastImprovementMs < 10); gains++;
    } else assert.equal(gainAt, lastGainAt, "No reset without a strict improvement in the published best");
    lastGainAt = gainAt; score = s.metrics.score;
    if (s.path) assert.equal(model.validateRoute(s.path, points), "");
  }
  assert.ok(gains > 1 && result.lns.diversifications > 0);
  assert.ok(result.elapsedMs > 1000 && result.lastImprovementMs >= 1000);
  assert.equal(result.reason, "inactivity"); assert.equal(result.progress, 100);
  assert.ok(result.elapsedMs - lastGainAt < 1020);
});

test("M6 always checks directions at inactivity expiry and resumes when that final pass improves", () => {
  const points = [{ x: 0, y: 0 }, { x: 7, y: 3 }], optimal = model.expandCells(points, 10);
  const optimalScore = model.metrics(optimal, 10, true).score;
  const initialPath = optimal.map((_, index) => optimal.map((action, i) => ({ ...action,
    direction: i === index ? -action.direction : action.direction })))
    .find(path => !model.validateRoute(path, points) && model.metrics(path, 10, true).score > optimalScore + 1e-8);
  assert.ok(initialPath);
  let now = 0, orientationCalls = 0; const reports = [];
  const builder = m => {
    const real = createOrthogonalPathBuilder(m);
    return { ...real, orientUnitPath(...args) { orientationCalls++; return real.orientUnitPath(...args); } };
  };
  const idleLns = () => ({ maximumSize: 14, context: () => ({ locked: 0 }),
    selectNeighborhood: () => ({ indices: [0], kind: "Test" }), repairNeighborhood: () => ({ attempts: 0 }) });
  const result = createDeepOptimizer(model, builder, createBlockOptimizer, createRelaySearch, idleLns, () => ++now)
    .optimizePath({ points, initialPath, warmupMs: 0, stopAfterInactivity: true, stagnationLimitMs: 100 }, s => reports.push(s));
  assert.equal(orientationCalls, 2, "Expiry checks directions again after the resumed search");
  assert.ok(result.elapsedMs >= 200); assert.ok(result.lastImprovementMs >= 100);
  close(result.metrics.score, optimalScore);
  assert.equal(model.validateRoute(result.path, points), "");
  assert.ok(reports.some(s => s.phase === "Derniere passe sur les sens" && s.lastImprovementMs < 10));
});

test("M6 inactivity feedback uses the shared timer instead of the one-hour countdown", () => {
  const visuals = createPathVisuals(model, createOrthogonalPathBuilder(model));
  const view = visuals.searchPresentation({ method: "deep-optimization", stage: "lns", stopAfterInactivity: true,
    totalLimitMs: null, elapsedMs: 120000, lastImprovementMs: 20000, stagnationLimitMs: 60000 }, true);
  assert.ok(view.searching && view.active && !view.timed);
  assert.equal(view.max, 60000); assert.equal(view.value, 20000);
});
