const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");
const { createPointOrderSearch } = require("../src/point-order-search.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createSectionOptimizer } = require("../src/section-optimizer-worker.js");
const fixtures = require("./fixtures/combined-search.js");
const seeded = (seed = 31) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const engine = (clock = () => performance.now()) => createSectionOptimizer(model, createPointOrderSearch, createOrthogonalPathBuilder, clock, seeded());
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
    assert.ok(result.sectionSearch.completed > 0); assert.ok(result.sectionSearch.pointEvaluations > 0);
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
    assert.deepEqual(result.path, initialPath); assert.equal(result.sectionSearch.pointEvaluations, 0); assert.ok(result.elapsedMs < 100);
  }
  const points = Array.from({ length: 2000 }, (_, i) => cell(i % 50 * 2, Math.floor(i / 50) * 2));
  const initialPath = model.expandCells(points, 3), before = JSON.stringify(initialPath);
  assert.equal(search.decode(points, { deadline: 0 }), null);
  const result = search.optimizePath({ points, initialPath, cutThreshold: 3, totalLimitMs: 20 });
  assert.equal(model.validateRoute(result.path, points), ""); assert.ok(result.metrics.score <= score(initialPath));
  assert.ok(result.elapsedMs < 1500); assert.equal(JSON.stringify(initialPath), before);
});
