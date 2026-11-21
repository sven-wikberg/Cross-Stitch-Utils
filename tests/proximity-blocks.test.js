const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createBlockOptimizer } = require("../src/block-optimizer-worker.js");
const { createDeepOptimizer, createLnsSearch } = require("../src/deep-optimizer-worker.js");
const { createRelaySearch } = require("../src/relay-search.js");
const { createRelayOptimizer } = require("../src/relay-optimizer-worker.js");
const builder = createOrthogonalPathBuilder(model);
const cell = (x, y = 0) => ({ x, y });
const rectangle = (w, h, x = 0, y = 0) => Array.from({ length: w * h }, (_, i) => cell(x + i % w, y + Math.floor(i / w)));
const engine = (tick = 0) => { let time = 0; return createBlockOptimizer(model, createOrthogonalPathBuilder, () => time += tick, () => 0.37); };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function valid(result, cells, constraints = {}, threshold = 10) {
  assert.equal(model.validateRoute(result.path, cells), "");
  assert.ok(model.satisfiesConstraints(result.path, constraints));
  if (result.unitLinks) {
    assert.equal(result.unitLinks.length, result.path.length);
    result.unitLinks.forEach((unit, i) => { assert.equal(typeof unit, "boolean"); if (unit) assert.equal(model.distance(result.path[i - 1], result.path[i]), 1); });
  }
  if (result.metrics) close(result.metrics.score, model.metrics(result.path, threshold, true).score);
}

test("wide blocks merge sides, corners and one empty orthogonal cell, transitively and without other gaps", () => {
  const offsets = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]];
  for (const [dx, dy] of offsets) {
    const points = [cell(3, 3), cell(3 + dx, 3 + dy)], problem = engine().prepareProblem({ points });
    assert.equal(builder.proximityComponents(points).length, 1);
    assert.equal(problem.blocks.length, 1);
    const result = engine().materialize(problem, [0]); valid(result, points);
    close(model.metrics(result.path, 10, true).score, 3);
  }
  for (const [dx, dy] of [[3, 0], [0, 3], [2, 1], [1, 2], [2, 2], [-2, -1]]) {
    assert.equal(builder.proximityComponents([cell(3, 3), cell(3 + dx, 3 + dy)]).length, 2);
  }
  const points = [cell(0), cell(1, 1), cell(3, 1), cell(3, 3), cell(9)], before = JSON.stringify(points);
  assert.deepEqual(builder.proximityComponents(points).map(group => group.length), [4, 1]);
  assert.equal(JSON.stringify(points), before);
});

test("all 3x3 masks construct complete wide-block routes, preserving every claimed unit transition", () => {
  const all = rectangle(3, 3);
  for (let mask = 1; mask < 512; mask++) {
    const points = all.filter((_, i) => mask & (1 << i));
    const result = builder.buildPath({ points, wideBlocks: true }); valid(result, points);
    assert.equal(result.blocks.length, builder.proximityComponents(points).length);
    for (const block of result.blocks) assert.equal(block.end - block.start, block.cells.length * 2);
  }
});

test("mixed-block entry and exit choices preserve the orthogonal backtracking pieces", () => {
  const points = [...rectangle(2, 2), cell(3, 2), ...rectangle(2, 2, 5, 2)];
  for (const [entry, exit] of [[points[0], points.at(-1)], [points.at(-1), points[0]], [points[0], points[3]], [points[4], points[4]]]) {
    const traversal = builder.blockTraversal(points, entry, exit);
    assert.ok(traversal);
    assert.equal(model.cellKey(traversal.sequence[0]), model.cellKey(entry));
    assert.equal(model.cellKey(traversal.sequence.at(-1)), model.cellKey(exit));
    const oriented = builder.orientUnitPath(traversal.sequence, traversal.units);
    assert.ok(oriented); valid({ path: oriented.path, unitLinks: traversal.units }, points);
    assert.ok(traversal.units.filter(Boolean).length >= 13, "most links inside orthogonal pieces remain exact unit links");
  }
});

test("mixed transfer matrices match exhaustive orientations, including forced cuts", () => {
  const points = [cell(0), cell(1, 1), cell(3, 1)], constraints = { forcedCuts: [{ ...cell(1, 1), diagonal: "lower", direction: 1 }] };
  const optimizer = engine(), problem = optimizer.prepareProblem({ points, constraints, cutThreshold: 2 }), block = problem.blocks[0];
  assert.equal(problem.blocks.length, 1); assert.ok(block.mixed);
  const minima = new Map();
  for (const config of block.configs) {
    const traversal = config.sequence ? { sequence: config.sequence, units: config.units } : builder.blockTraversal(block.cells, config.entry, config.exit, constraints, 2);
    for (let mask = 0; mask < 2 ** traversal.sequence.length; mask++) {
      const path = traversal.sequence.map((point, i) => ({ ...model.copy(point), direction: mask & (1 << i) ? -1 : 1,
        ...(problem.cuts.has(model.key(point)) ? { cutBefore: true } : {}) }));
      if (model.validateRoute(path, points) || !model.satisfiesConstraints(path, constraints)) continue;
      if (path.some((p, i) => i && traversal.units[i] && model.distance(path[i - 1], p) !== 1)) continue;
      const key = `${model.key(path[0])}:${path[0].direction}|${model.key(path.at(-1))}:${path.at(-1).direction}`;
      minima.set(key, Math.min(minima.get(key) ?? Infinity, model.metrics(path, 2, true).score));
    }
  }
  for (const transfer of block.transfers) {
    const a = block.entries[transfer.entry], b = block.exits[transfer.exit];
    close(transfer.score, minima.get(`${model.key(a)}:${a.direction}|${model.key(b)}:${b.direction}`));
  }
  valid(optimizer.materialize(problem, [0]), points, constraints, 2);
  close(optimizer.evaluateOrder(problem, [0]).score, Math.min(...minima.values()));
});

test("wide-block construction retains every locked prefix, half-cross and manual cut", () => {
  const points = [cell(0), cell(1), cell(2, 1), cell(4, 1), cell(4, 3), cell(10, 5)];
  const initialPath = model.expandCells(points, 3); initialPath[5].cutBefore = true;
  for (let length = 0; length <= initialPath.length; length++) {
    const constraints = { start: initialPath[0], lockedPrefix: initialPath.slice(0, length), forcedCuts: [initialPath[5]] };
    const reports = [], before = JSON.stringify({ points, initialPath, constraints });
    const result = engine(100).optimizePath({ points, constraints, initialPath, cutThreshold: 3, stagnationLimitMs: 1 }, s => reports.push(s));
    valid(result, points, constraints, 3);
    assert.deepEqual(result.path.slice(0, length), initialPath.slice(0, length));
    assert.ok(result.metrics.score <= model.metrics(initialPath, 3, true).score + 1e-8);
    let best = Infinity;
    for (const report of reports) if (report.path) { valid(report, points, constraints, 3); assert.ok(report.metrics.score <= best + 1e-8); best = report.metrics.score; }
    assert.equal(JSON.stringify({ points, initialPath, constraints }), before);
  }
  const open = model.orient([
    { ...points[0], diagonal: "lower", direction: 1 }, { ...points[2], diagonal: "lower", direction: 1 },
    ...[points[1], points[3], points[4], points[5]].flatMap(p => ["lower", "upper"].map(diagonal => ({ ...p, diagonal, direction: 1 }))),
    { ...points[2], diagonal: "upper", direction: 1 }, { ...points[0], diagonal: "upper", direction: 1 }
  ], 10, {}, true);
  for (const length of [2, 3, 5]) {
    const constraints = { lockedPrefix: open.slice(0, length) };
    valid(engine(100).optimizePath({ points, initialPath: open, constraints, stagnationLimitMs: 1 }), points, constraints);
  }
});

test("wider blocks keep old interleaved routes, relay improvements and deep LNS available", () => {
  const points = require("./fixtures/combined-search.js").cutAware, initialPath = model.expandCells(points, 3), reports = [];
  const result = engine().optimizePath({ points, initialPath, cutThreshold: 3, stagnationLimitMs: 1 }, s => reports.push(s));
  valid(result, points, {}, 3);
  assert.ok(result.blocks.total < builder.orthogonalComponents(points).length);
  assert.ok(reports.every(s => s.stage !== "relay"));
  const relayed = createRelayOptimizer(model, createOrthogonalPathBuilder, createRelaySearch).optimizePath({ points, initialPath: result.path, cutThreshold: 3 });
  assert.ok(relayed.relayPasses > 0 && relayed.relayImprovements > 0);
  assert.ok(relayed.metrics.score < result.metrics.score);
  const resumed = engine(1000).optimizePath({ points, initialPath: result.path, cutThreshold: 3, stagnationLimitMs: 1 });
  valid(resumed, points, {}, 3); assert.ok(resumed.metrics.score <= result.metrics.score + 1e-8);
  let now = 0;
  const deep = createDeepOptimizer(model, createOrthogonalPathBuilder, createBlockOptimizer, createRelaySearch, createLnsSearch, () => ++now, () => 0.37)
    .optimizePath({ points, initialPath: result.path, cutThreshold: 3, totalLimitMs: 5000 });
  valid(deep, points, {}, 3); assert.ok(deep.lns.iterations > 0 && deep.metrics.score <= result.metrics.score + 1e-8);
});

test("the 3259-cross pattern has nine wide blocks instead of 345 orthogonal pieces", { timeout: 30000 }, t => {
  const points = require("../data/examples/grands-ilots.pattern.json").grid.cells.filter(p => !p.empty), started = performance.now();
  const result = engine(500).optimizePath({ points, stagnationLimitMs: 1 }); valid(result, points);
  assert.equal(result.blocks.total, 9); assert.equal(result.blocks.prepared, 9);
  assert.equal(builder.orthogonalComponents(points).length, 345);
  assert.ok(result.metrics.score <= result.initialMetrics.score + 1e-8);
  t.diagnostic(`3259 crosses, 9 wide blocks: ${(performance.now() - started).toFixed(0)} ms`);
});
