const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createSectionOptimizer } = require("../src/section-optimizer-worker.js");
const fixtures = require("./fixtures/combined-search.js");
const engine = (clock = () => performance.now()) => createSectionOptimizer(model, createOrthogonalPathBuilder, clock);
const cell = (x, y = 0) => ({ x, y });
const score = path => model.metrics(path, 3, true).score;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test("sections follow consecutive orthogonal steps, not geographical components, with optional boundaries", () => {
  const order = [cell(0), cell(1), cell(2, 1), cell(1, 1), cell(0, 1), cell(8, 8)], search = engine();
  assert.deepEqual(search.splitSections(order).sections.map(s => s.cells), [order.slice(0, 2), order.slice(2, 5), order.slice(5)]);
  assert.deepEqual(search.splitSections(order, {}, new Set([3])).sections.map(s => s.cells),
    [order.slice(0, 2), order.slice(2, 3), order.slice(3, 5), order.slice(5)]);
  assert.throws(() => search.splitSections([order[0], order[0]]), /duplique/);
});

test("orthogonal subsections reach the unit lower bound without forcing every cross to close immediately", () => {
  const search = engine(), cells = Array.from({ length: 120 }, (_, x) => cell(x)), decoded = search.decode(cells, { cutThreshold: 3 });
  assert.equal(decoded.sections.length, 1); assert.equal(model.validateRoute(decoded.path, cells), "");
  close(score(decoded.path), 239); close(decoded.score, score(decoded.path));
  assert.ok(decoded.path.findIndex(p => p.diagonal === "upper") > 1);
  const variants = search.sectionVariants(decoded.sections[0], { cutThreshold: 3 }).variants;
  assert.ok(new Set(variants.map(v => `${model.key(v.first)}:${v.first.direction}`)).size > 2);
});

test("layered endpoint selection matches exhaustive combinations and can beat greedy junctions", () => {
  const search = engine(); let foundGreedyLoss = false;
  for (let shift = 0; shift < 5; shift++) {
    const order = [cell(0), cell(1), cell(4, shift + 1), cell(5, shift + 1), cell(2, 6), cell(3, 6)];
    const constraints = { forcedCuts: [{ ...order[2], diagonal: "lower", direction: 1 }] };
    const { sections } = search.splitSections(order), layers = sections.map(s => search.sectionVariants(s, { cutThreshold: 3, constraints }).variants);
    let optimum = Infinity;
    function visit(at, path) {
      if (at === layers.length) { optimum = Math.min(optimum, score(path)); return; }
      for (const variant of layers[at]) visit(at + 1, path.concat(search.unpack(variant)));
    }
    visit(0, []);
    const result = search.combineSections(layers, [], 3);
    close(result.score, optimum); close(score(result.path), optimum);
    assert.equal(model.validateRoute(result.path, order), ""); assert.ok(model.satisfiesConstraints(result.path, constraints));
    let greedy = [];
    for (const variants of layers) {
      const best = variants.slice().sort((a, b) => a.score + model.cost(greedy.at(-1), a.first, 3, true)
        - b.score - model.cost(greedy.at(-1), b.first, 3, true))[0];
      greedy.push(...search.unpack(best));
    }
    if (score(greedy) > optimum + 1e-7) foundGreedyLoss = true;
  }
  assert.ok(foundGreedyLoss, "choosing interfaces jointly matters, not just choosing the cheapest next section");
});

test("decoding preserves open crosses, locked directions and forced cuts across section boundaries", () => {
  const search = engine(), points = fixtures.timerRecovery, original = model.expandCells(points, 3);
  const prefix = model.orient([original[0], original[2], original[1], original[4]], 3, {}, true);
  const constraints = { lockedPrefix: prefix, start: prefix[0], forcedCuts: [original[8]] }, before = JSON.stringify({ points, constraints });
  const result = search.decode(points, { cutThreshold: 3, constraints });
  assert.equal(model.validateRoute(result.path, points), ""); assert.ok(model.satisfiesConstraints(result.path, constraints));
  assert.deepEqual(result.path.slice(0, prefix.length), prefix); close(result.score, score(result.path));
  assert.equal(JSON.stringify({ points, constraints }), before);
});

test("fixed endpoint DP rejects zero-length junctions even when a cut is forced", () => {
  const search = engine(), a = { ...cell(0), diagonal: "lower", direction: 1 };
  const b = { ...cell(1), diagonal: "upper", direction: 1, cutBefore: true };
  assert.equal(model.distance(a, b), 0);
  const variant = { sequence: [b], directions: Int8Array.of(1), first: b, last: b, score: 0 };
  assert.equal(search.combineSections([[variant]], [a], 3), null);
});

test("construction without an existing full path retains a partial locked prefix and its open crosses", () => {
  const points = fixtures.timerRecovery, base = model.expandCells(points, 3);
  const prefix = model.orient([base[0], base[2], base[1], base[4]], 3, {}, true);
  const constraints = { lockedPrefix: prefix, start: prefix[0], forcedCuts: [base[10]] };
  const result = engine().optimizePath({ points, constraints, cutThreshold: 3, totalLimitMs: 120 });
  assert.equal(model.validateRoute(result.path, points), ""); assert.ok(model.satisfiesConstraints(result.path, constraints));
  assert.deepEqual(result.path.slice(0, prefix.length), prefix); assert.ok(result.sectionSearch.completed > 0);
});

test("engine publishes only complete real-score improvements and keeps an existing better route", () => {
  for (const points of [fixtures.timerRecovery, fixtures.interleaved]) {
    const initialPath = model.expandCells(points, 3); initialPath[10].cutBefore = true;
    const constraints = { lockedPrefix: initialPath.slice(0, 3), start: initialPath[0], forcedCuts: [initialPath[10]] };
    const before = JSON.stringify({ points, initialPath, constraints }), snapshots = [];
    const result = engine().optimizePath({ points, initialPath, constraints, cutThreshold: 3, totalLimitMs: 350 }, s => snapshots.push(s));
    let previous = score(initialPath);
    for (const s of snapshots.filter(s => s.path)) {
      assert.equal(model.validateRoute(s.path, points), ""); assert.ok(model.satisfiesConstraints(s.path, constraints));
      close(s.metrics.score, score(s.path)); assert.ok(s.metrics.score <= previous + 1e-8); previous = s.metrics.score;
      assert.deepEqual(s.path.slice(0, 3), initialPath.slice(0, 3));
    }
    assert.ok(result.sectionSearch.completed > 0); assert.ok(result.sectionSearch.windows > 0);
    assert.ok(result.sectionSearch.refinements > 0); assert.ok(result.sectionSearch.connections > 0);
    assert.equal(JSON.stringify({ points, initialPath, constraints }), before);
    assert.ok(result.elapsedMs < 1500);
    const again = engine().optimizePath({ points, initialPath: result.path, constraints, cutThreshold: 3, totalLimitMs: 1 });
    assert.ok(again.metrics.score <= result.metrics.score + 1e-8);
  }
});

test("empty, single-cross, locked and expired inputs never replace a complete route with partial work", () => {
  const search = engine();
  for (const points of [[], [cell(0)], [cell(0), cell(20, 20)]]) {
    const initialPath = model.expandCells(points, 3);
    const result = search.optimizePath({ points, initialPath, constraints: { lockedPrefix: initialPath }, cutThreshold: 3, totalLimitMs: 1000 });
    assert.deepEqual(result.path, initialPath); assert.equal(result.sectionSearch.windows, 0); assert.ok(result.elapsedMs < 100);
  }
  const points = Array.from({ length: 2000 }, (_, i) => cell(i % 50 * 2, Math.floor(i / 50) * 2));
  const initialPath = model.expandCells(points, 3), before = JSON.stringify(initialPath);
  assert.equal(search.decode(points, { deadline: 0 }), null);
  const result = search.optimizePath({ points, initialPath, cutThreshold: 3, totalLimitMs: 20 });
  assert.equal(model.validateRoute(result.path, points), ""); assert.ok(result.metrics.score <= score(initialPath));
  assert.ok(result.elapsedMs < 1500); assert.equal(JSON.stringify(initialPath), before);
});

test("inactivity follows only accepted global gains across local windows and passes", () => {
  for (const totalLimitMs of [undefined, 1]) {
    let now = 0; const orientations = [], snapshots = [], limit = 5000;
    const tracked = { ...model, orient(...args) { orientations.push(now); return model.orient(...args); } };
    const points = fixtures.interleaved, initialPath = model.expandCells(points, 3);
    initialPath[10].cutBefore = true;
    const constraints = { lockedPrefix: initialPath.slice(0, 3), start: initialPath[0], forcedCuts: [initialPath[10]] };
    const before = JSON.stringify({ initialPath, constraints });
    const search = createSectionOptimizer(tracked, createOrthogonalPathBuilder, () => ++now);
    const result = search.optimizePath({ points, initialPath, constraints, cutThreshold: 3, stopAfterInactivity: true,
      stagnationLimitMs: limit, ...(totalLimitMs === undefined ? {} : { totalLimitMs }) }, s => snapshots.push(s));
    let previousScore = score(initialPath), previousGain = 0, searchReady = false;
    for (const s of [...snapshots, result]) {
      assert.equal(s.stopAfterInactivity, true); assert.equal(s.totalLimitMs, null);
      assert.equal(s.stagnationLimitMs, limit);
      assert.equal(s.remainingMs, Math.max(0, limit - s.lastImprovementMs));
      assert.equal(s.progress, s.stage === "complete" ? 100 : Math.min(100, s.lastImprovementMs / limit * 100));
      const gainAt = s.elapsedMs - s.lastImprovementMs;
      if (s.preparing) assert.equal(s.lastImprovementMs, 0);
      else if (!searchReady) { assert.equal(gainAt, s.preparationMs); searchReady = true; }
      else if (s.metrics.score < previousScore - 1e-8) {
        assert.ok(gainAt > previousGain); assert.ok(s.lastImprovementMs <= 1); assert.ok(s.path);
      } else assert.equal(gainAt, previousGain, "point-score gains and ties must not reset inactivity");
      if (s.path) {
        assert.equal(model.validateRoute(s.path, points), ""); assert.ok(model.satisfiesConstraints(s.path, constraints));
        close(s.metrics.score, score(s.path)); assert.ok(s.metrics.score <= previousScore + 1e-8);
      }
      previousScore = s.metrics?.score ?? previousScore; previousGain = gainAt;
    }
    assert.ok(result.improvements > 0); assert.ok(result.sectionSearch.windows > 0);
    assert.ok(result.sectionSearch.refinements > 0); assert.ok(result.sectionSearch.passes > 0);
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
      return model.orient(...args);
    } };
    const noVariants = (...args) => ({ ...createOrthogonalPathBuilder(...args), orientUnitPath: () => null });
    const search = createSectionOptimizer(tracked, noVariants, clock);
    const result = search.optimizePath({ points, initialPath, cutThreshold: 3, stopAfterInactivity,
      stagnationLimitMs: limit, totalLimitMs: limit }, s => {
      snapshots.push(s);
      if (!s.preparing && !s.improvements) now = s.preparationMs + limit + 1;
      if (s.improvements) resumed = true;
    });
    const gain = snapshots.find(s => s.improvements);
    assert.ok(gain); assert.equal(gain.lastImprovementMs, 0);
    assert.equal(gain.remainingMs, stopAfterInactivity ? limit : 0);
    assert.equal(gain.progress, stopAfterInactivity ? 0 : 100);
    assert.equal(gain.sectionSearch.refinements, 0, "the first gain comes only from final orientation");
    assert.ok(result.metrics.score < score(initialPath)); assert.equal(result.stopAfterInactivity, stopAfterInactivity);
    if (stopAfterInactivity) {
      assert.ok(result.sectionSearch.refinements > 0, "main search resumes after the orientation gain");
      assert.ok(orientations > 1); assert.equal(result.reason, "inactivity");
      assert.ok(result.lastImprovementMs >= limit); assert.ok(result.elapsedMs >= 2 * limit);
      assert.equal(result.remainingMs, 0); assert.equal(snapshots.at(-1).remainingMs, 0);
    } else {
      assert.equal(result.sectionSearch.refinements, 0); assert.equal(orientations, 1);
      assert.equal(result.reason, "budget"); assert.ok(result.lastImprovementMs < limit);
    }
  }
});

test("stagnation options alone do not change the legacy total budget", () => {
  let now = 0;
  const points = fixtures.interleaved, initialPath = model.expandCells(points, 3);
  const result = engine(() => ++now).optimizePath({ points, initialPath, cutThreshold: 3, totalLimitMs: 1000, stagnationLimitMs: 1 });
  assert.equal(result.stopAfterInactivity, false); assert.equal(result.totalLimitMs, 1000);
  assert.equal(result.reason, "budget"); assert.equal(result.remainingMs, 0);
  assert.ok(result.elapsedMs >= 1000 && result.elapsedMs < 1030);
});

test("failed local windows keep the complete incumbent and retry until inactivity expires", () => {
  let now = 0;
  const points = fixtures.interleaved, initialPath = model.orient(model.expandCells(points, 3), 3, {}, true);
  const noVariants = (...args) => ({ ...createOrthogonalPathBuilder(...args), orientUnitPath: () => null });
  const search = createSectionOptimizer(model, noVariants, () => ++now);
  const result = search.optimizePath({ points, initialPath, cutThreshold: 3, stopAfterInactivity: true, stagnationLimitMs: 1000 });
  assert.equal(result.sectionSearch.completed, 0); assert.ok(result.sectionSearch.refinements > 0);
  assert.equal(result.improvements, 0); assert.deepEqual(result.path, initialPath);
  assert.ok(result.lastImprovementMs >= 1000 && result.lastImprovementMs < 1030);
  assert.equal(result.reason, "inactivity"); assert.equal(result.remainingMs, 0);
});

test("local decoding preserves the exact outside path, partial crosses, locks and cuts", () => {
  const search = engine(), points = fixtures.interleaved;
  const initial = search.decode(points, { cutThreshold: 3 }).path;
  initial[8].cutBefore = true; initial[20].cutBefore = true;
  const constraints = { lockedPrefix: initial.slice(0, 3), start: initial[0], forcedCuts: [initial[8]] };
  const before = JSON.stringify({ initial, constraints });
  let checked = 0, partial = false;
  for (const [from, to] of [[3, 12], [5, 20], [6, 29], [20, initial.length]]) for (const reverse of [false, true]) {
    const window = initial.slice(from, to), keys = window.map(model.key).sort();
    if (new Set(window.map(model.cellKey)).size * 2 > window.length) partial = true;
    const result = search.decodeWindow(initial, from, to, { constraints, cutThreshold: 3, reverse });
    if (!result) continue;
    checked++;
    assert.deepEqual(result.path.map(model.key).sort(), keys);
    const candidate = initial.slice(0, from).concat(result.path, initial.slice(to));
    assert.equal(model.validateRoute(candidate, points), "");
    assert.ok(model.satisfiesConstraints(candidate, constraints));
    assert.deepEqual(candidate.slice(0, from), initial.slice(0, from));
    assert.deepEqual(candidate.slice(to), initial.slice(to));
    assert.deepEqual(candidate.filter(p => p.cutBefore).map(model.key).sort(), initial.filter(p => p.cutBefore).map(model.key).sort());
    close(score(initial) - score(candidate), result.gain);
  }
  assert.ok(checked >= 4); assert.ok(partial);
  assert.equal(JSON.stringify({ initial, constraints }), before);
  assert.equal(search.decodeWindow(initial, 0, 12, { constraints }), null);
  assert.equal(search.decodeWindow(initial, 3, initial.length + 1), null);
  assert.equal(search.decodeWindow(initial, 5, 5), null);
  assert.equal(search.decodeWindow(initial, 5, 20, { deadline: 0 }), null);
});

test("local DP scores both fixed outside actions including an automatic or forced cut", () => {
  const search = engine(), cells = [cell(0), cell(1), cell(4, 2), cell(5, 2)];
  const previous = { ...cell(0, 5), diagonal: "lower", direction: -1 };
  const next = { ...cell(20, 8), diagonal: "upper", direction: 1, cutBefore: true };
  const layers = search.splitSections(cells).sections.map(s => search.sectionVariants(s, { cutThreshold: 3 }).variants);
  let optimum = Infinity;
  function visit(at, path) {
    if (at === layers.length) { optimum = Math.min(optimum, score([previous, ...path, next])); return; }
    for (const variant of layers[at]) visit(at + 1, path.concat(search.unpack(variant)));
  }
  visit(0, []);
  const result = search.combineSections(layers, [previous], 3, { next });
  close(result.score, optimum); close(score([...result.path, next]), optimum);
  assert.deepEqual(result.path[0], previous);
});

test("a zero-length outgoing junction is forbidden even with a forced cut", () => {
  const search = engine(), point = { ...cell(0), diagonal: "lower", direction: 1 };
  const next = { ...cell(1), diagonal: "upper", direction: 1, cutBefore: true };
  const variant = { sequence: [point], directions: Int8Array.of(1), first: point, last: point, score: 0 };
  assert.equal(model.distance(point, next), 0);
  assert.equal(search.combineSections([[variant]], [], 3, { next }), null);
});

test("a local splice can improve an already oriented path without rebuilding its other sections", () => {
  const search = engine(), points = fixtures.timerRecovery;
  const original = model.orient(model.expandCells(points, 3), 3, {}, true);
  let improved = false;
  for (let from = 1; from < original.length - 3 && !improved; from++) {
    const to = Math.min(original.length - 1, from + 16);
    for (const reverse of [false, true]) {
      const result = search.decodeWindow(original, from, to, { cutThreshold: 3, reverse });
      if (!result || result.gain <= 1e-8) continue;
      const candidate = original.slice(0, from).concat(result.path, original.slice(to));
      assert.equal(model.validateRoute(candidate, points), ""); assert.ok(score(candidate) < score(original));
      assert.deepEqual(candidate.slice(0, from), original.slice(0, from));
      assert.deepEqual(candidate.slice(to), original.slice(to)); improved = true;
    }
  }
  assert.ok(improved);
});

test("random local windows keep external half-crosses and their complete global cost", () => {
  let state = 73;
  const random = n => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) % n);
  const shuffle = values => {
    const result = values.slice();
    for (let i = result.length - 1; i > 0; i--) { const j = random(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  };
  const search = engine(); let checked = 0;
  for (let trial = 0; trial < 80; trial++) {
    const points = shuffle(Array.from({ length: 64 }, (_, i) => cell(i % 8, Math.floor(i / 8)))).slice(0, 12);
    const actions = shuffle(points).map(p => ({ ...p, diagonal: "lower", direction: 1 }))
      .concat(shuffle(points).map(p => ({ ...p, diagonal: "upper", direction: 1 })));
    actions[7].cutBefore = true; actions[16].cutBefore = true;
    const original = model.orient(actions, 3, {}, true);
    const constraints = { start: original[0], lockedPrefix: original.slice(0, 3), forcedCuts: [original[7]] };
    const before = JSON.stringify({ original, constraints });
    const from = 3 + random(original.length - 3), to = from + 1 + random(original.length - from);
    const result = search.decodeWindow(original, from, to, { cutThreshold: 3, constraints, reverse: Boolean(trial % 2) });
    if (!result) continue;
    const candidate = original.slice(0, from).concat(result.path, original.slice(to)); checked++;
    assert.equal(model.validateRoute(candidate, points), ""); assert.ok(model.satisfiesConstraints(candidate, constraints));
    assert.deepEqual(candidate.slice(0, from), original.slice(0, from)); assert.deepEqual(candidate.slice(to), original.slice(to));
    assert.deepEqual(candidate.filter(p => p.cutBefore).map(model.key).sort(), original.filter(p => p.cutBefore).map(model.key).sort());
    close(score(original) - score(candidate), result.gain);
    assert.equal(JSON.stringify({ original, constraints }), before);
  }
  assert.ok(checked >= 60);
});
