const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");
const { createPointOrderSearch } = require("../src/point-order-search.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createRelaySearch } = require("../src/relay-search.js");
const { createAdaptiveOptimizer } = require("../src/adaptive-optimizer-worker.js");
const { createPointsDiagonalOptimizer } = require("../src/points-diagonals-worker.js");
const seeded = (seed = 31) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const engine = (clock = () => performance.now()) => createPointsDiagonalOptimizer(model, createPointOrderSearch,
  createOrthogonalPathBuilder, createRelaySearch, createAdaptiveOptimizer, clock, seeded());
const score = path => model.metrics(path, 3, true).score;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

function nestedOracle(cells, constraints = {}) {
  const prefix = constraints.lockedPrefix || (constraints.start ? [constraints.start] : []);
  const lower = new Set(prefix.filter(p => p.diagonal === "lower").map(model.cellKey));
  const upper = new Set(prefix.filter(p => p.diagonal === "upper").map(model.cellKey));
  const pending = prefix.filter(p => p.diagonal === "lower" && !upper.has(model.cellKey(p)));
  const remaining = cells.filter(p => !lower.has(model.cellKey(p)));
  let best = Infinity;
  function visit(next, opened, sequence) {
    if (next === remaining.length && !opened.length) {
      const path = model.orient(sequence, 3, constraints, true);
      if (!model.validateRoute(path, cells) && model.satisfiesConstraints(path, constraints)) best = Math.min(best, score(path));
      return;
    }
    if (next < remaining.length) {
      const cell = remaining[next];
      visit(next + 1, opened.concat(cell), sequence.concat({ ...cell, diagonal: "lower", direction: 1 }));
    }
    if (opened.length) visit(next, opened.slice(0, -1), sequence.concat({ ...opened.at(-1), diagonal: "upper", direction: 1 }));
  }
  visit(0, pending, prefix); return best;
}

test("wide beam matches the exhaustive nested-order oracle with directions, cuts and prefix boundaries", () => {
  const search = engine(), random = seeded(73);
  for (let trial = 0; trial < 20; trial++) {
    const cells = [{ x: 0, y: 0 }, { x: 1 + Math.floor(random() * 5), y: 1 }, { x: 2, y: 3 + Math.floor(random() * 4) }];
    const prefix = trial % 2 ? model.orient(cells.slice(0, 2).map(p => ({ ...p, diagonal: "lower", direction: 1 })), 3) : [];
    const constraints = { lockedPrefix: prefix, ...(prefix.length ? { start: prefix[0] } : {}), forcedCuts: [{ ...cells[2], diagonal: "upper", direction: 1 }] };
    const path = search.beamDecode(cells, { cutThreshold: 3, constraints, beamWidth: 64 });
    assert.equal(model.validateRoute(path, cells), ""); assert.ok(model.satisfiesConstraints(path, constraints));
    close(score(path), nestedOracle(cells, constraints));
  }
});

test("conversion permits long open runs and returns instead of forcing consecutive complete crosses", () => {
  const cells = Array.from({ length: 120 }, (_, x) => ({ x, y: 0 })), search = engine();
  const path = search.beamDecode(cells, { cutThreshold: 3 });
  assert.equal(model.validateRoute(path, cells), ""); close(score(path), 239);
  assert.ok(path.findIndex(p => p.diagonal === "upper") > 1);
  assert.ok(score(search.simpleDecode(cells, 3, {}, false)) > score(path));
});

test("decoders preserve arbitrary open prefixes, manual cuts and immutable inputs", () => {
  const cells = require("./fixtures/combined-search.js").timerRecovery;
  const original = model.expandCells(cells, 3), prefix = model.orient([
    original[0], original[2], original[1], original[4]
  ], 3, {}, true);
  const constraints = { lockedPrefix: prefix, start: prefix[0], forcedCuts: [original[8]] };
  const before = JSON.stringify({ cells, constraints }), search = engine();
  for (const path of [search.simpleDecode(cells, 3, constraints), search.simpleDecode(cells, 3, constraints, false),
    search.beamDecode(cells, { cutThreshold: 3, constraints })]) {
    assert.equal(model.validateRoute(path, cells), ""); assert.ok(model.satisfiesConstraints(path, constraints));
    assert.deepEqual(path.slice(0, prefix.length), prefix);
  }
  assert.equal(JSON.stringify({ cells, constraints }), before);
});

test("legacy point search retains permutations, reports candidates, and counts distance after cuts", () => {
  let now = 0; const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 20, y: 20 }, { x: 21, y: 20 }], candidates = [];
  const result = createPointOrderSearch(() => now += 0.01, seeded()).optimizePath({ points, cutThreshold: 3,
    totalLimitMs: 20, onCandidate: route => candidates.push(route) });
  assert.ok(candidates.length > 0);
  for (const route of [...candidates, result.route]) assert.deepEqual(route.slice().sort((a, b) => a - b), [0, 1, 2, 3]);
  let expected = 0;
  for (let i = 1; i < result.route.length; i++) {
    const a = points[result.route[i - 1]], b = points[result.route[i]], distance = Math.hypot(a.x - b.x, a.y - b.y);
    expected += distance + (distance > 3 ? 9 : 0);
  }
  close(result.metrics.score, expected);
});

test("the whole engine publishes only real-score improvements and leaves its input untouched", () => {
  const points = require("./fixtures/combined-search.js").interleaved, initialPath = model.expandCells(points, 3);
  initialPath[10].cutBefore = true;
  const constraints = { lockedPrefix: initialPath.slice(0, 3), start: initialPath[0], forcedCuts: [initialPath[10]] };
  const before = JSON.stringify({ initialPath, constraints }), snapshots = [];
  const result = engine().optimizePath({ points, initialPath, constraints, cutThreshold: 3, totalLimitMs: 700 }, s => snapshots.push(s));
  let previous = score(initialPath);
  for (const s of snapshots.filter(s => s.path)) {
    assert.equal(model.validateRoute(s.path, points), ""); assert.ok(model.satisfiesConstraints(s.path, constraints));
    close(score(s.path), s.metrics.score); assert.ok(s.metrics.score <= previous + 1e-8); previous = s.metrics.score;
  }
  assert.ok(result.pointsSearch.conversions > 0); assert.ok(result.pointsSearch.pointEvaluations > 0);
  assert.ok(result.pointsSearch.refinements > 0); assert.ok(result.metrics.score <= score(initialPath));
  assert.ok(result.elapsedMs < 1500); assert.equal(JSON.stringify({ initialPath, constraints }), before);
});

test("expired conversions return no partial route, and small budgets keep a complete incumbent", () => {
  const cells = Array.from({ length: 2000 }, (_, i) => ({ x: i % 50 * 2, y: Math.floor(i / 50) * 2 }));
  const initialPath = model.expandCells(cells, 3), before = JSON.stringify(initialPath);
  const search = engine();
  assert.equal(search.beamDecode(cells, { deadline: 0 }), null);
  const result = search.optimizePath({ points: cells, initialPath, cutThreshold: 3, totalLimitMs: 20 });
  assert.equal(model.validateRoute(result.path, cells), ""); assert.ok(result.metrics.score <= score(initialPath));
  assert.ok(result.elapsedMs < 2000); assert.equal(JSON.stringify(initialPath), before);
});

test("empty, single-cross and fully locked routes finish without changing locked actions", () => {
  const search = engine();
  for (const points of [[], [{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 20, y: 20 }]]) {
    const path = model.expandCells(points, 3);
    const result = search.optimizePath({ points, initialPath: path, constraints: { lockedPrefix: path }, cutThreshold: 3, totalLimitMs: 1000 });
    assert.deepEqual(result.path, path); assert.equal(result.pointsSearch.pointEvaluations, 0); assert.ok(result.elapsedMs < 100);
  }
});
