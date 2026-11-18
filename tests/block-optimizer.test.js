const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createBlockOptimizer } = require("../src/block-optimizer-worker.js");

const builder = createOrthogonalPathBuilder(model);
const action = (cell, diagonal = "lower", direction = 1) => ({ ...cell, diagonal, direction });
const rectangle = (width, height, x = 0, y = 0) => Array.from({ length: width * height }, (_, i) =>
  ({ x: x + i % width, y: y + Math.floor(i / width) }));
const close = (actual, expected, label) => assert.ok(Number.isFinite(actual)
  && Math.abs(actual - expected) < 1e-7, `${label}: expected ${expected}, received ${actual}`);
const compare = (a, b) => Math.abs(a.score - b.score) > 1e-8 ? a.score - b.score
  : a.cuts - b.cuts || a.distance - b.distance;

function seededRandom(seed = 31) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function optimizer(tickMs = 0, random = seededRandom()) {
  let time = 0;
  return createBlockOptimizer(model, createOrthogonalPathBuilder, () => { time += tickMs; return time; }, random);
}

function* permutations(values) {
  if (!values.length) { yield []; return; }
  for (let i = 0; i < values.length; i++) {
    for (const rest of permutations(values.filter((_, j) => i !== j))) yield [values[i], ...rest];
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function hole(point, start) {
  const first = { x: point.x, y: point.y + (point.diagonal === "lower" ? 1 : 0) };
  const second = { x: point.x + 1, y: point.y + (point.diagonal === "upper" ? 1 : 0) };
  return start === (point.direction === 1) ? first : second;
}

function distance(a, b) {
  const end = hole(a, false), start = hole(b, true);
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function measure(path, threshold) {
  let score = 0, cuts = 0, total = 0;
  for (let i = 1; i < path.length; i++) {
    const d = distance(path[i - 1], path[i]);
    if (!d) return { score: Infinity, cuts: 0, distance: Infinity };
    const cut = Number(Boolean(path[i].cutBefore) || d > threshold);
    total += d; cuts += cut; score += d + cut * threshold * 3;
  }
  return { score, cuts, distance: total };
}

function assertPath(result, cells, constraints = {}, threshold = 10) {
  assert.equal(model.validateRoute(result.path, cells), "", "complete, distinct, lower-before-upper actions");
  assert.ok(model.satisfiesConstraints(result.path, constraints), "route constraints are retained");
  assert.equal(result.unitLinks.length, result.path.length);
  assert.ok(result.unitLinks.every(flag => typeof flag === "boolean"));
  assert.equal(result.unitLinks[0] || false, false);
  for (let i = 1; i < result.path.length; i++) {
    const d = distance(result.path[i - 1], result.path[i]);
    assert.ok(d > 0, `nonzero hole-to-hole link ${i}`);
    if (result.unitLinks[i]) assert.equal(d, 1, `exact unit link ${i}`);
  }
  if (result.metrics) {
    const expected = model.createZones(cells).measure(result.path, threshold);
    for (const [key, value] of Object.entries(expected)) close(result.metrics[key], value, `metric ${key}`);
  }
}

function assertBlockUnits(problem, order, result) {
  let offset = 0;
  for (const id of order) {
    const block = problem.blocks[id];
    for (let j = 0; j < block.seedSequence.length; j++) {
      const expected = j === 0 ? Boolean(block.incomingUnit) : block.anchor ? block.seedUnits[j] : true;
      assert.equal(result.unitLinks[offset + j], expected, `block ${id}, link ${j}`);
    }
    offset += block.seedSequence.length;
  }
  assert.equal(offset, result.path.length);
}

// Enumerate sewing directions directly; do not use either worker's orientation DP.
function configVariants(problem, block) {
  const fixed = new Map((problem.constraints.lockedPrefix || []).map(p => [model.key(p), p.direction]));
  if (problem.constraints.start) fixed.set(model.key(problem.constraints.start), problem.constraints.start.direction);
  const variants = new Map();
  for (const config of block.configs) {
    let sequence = config.sequence;
    if (!sequence) {
      sequence = builder.buildSequence(block.cells, config.entry, config.exit);
      assert.ok(sequence, "a retained entry/exit pair has a valid sequence");
      if (block.resume) sequence = sequence.slice(1);
    }
    assert.ok(sequence.length <= 8, "keep the exhaustive orientation oracle bounded");
    const units = config.units || sequence.map((_, i) => i > 0);
    for (let mask = 0; mask < 2 ** sequence.length; mask++) {
      const path = sequence.map((point, i) => ({ ...point, direction: mask & (1 << i) ? -1 : 1,
        ...(problem.cuts.has(model.key(point)) ? { cutBefore: true } : {}) }));
      if (path.some(p => fixed.has(model.key(p)) && fixed.get(model.key(p)) !== p.direction)) continue;
      if (path.some((point, i) => i > 0 && (!distance(path[i - 1], point)
          || (units[i] && distance(path[i - 1], point) !== 1)))) continue;
      const metrics = measure(path, problem.threshold);
      const signature = path.map(p => `${model.key(p)}:${p.direction}:${Boolean(p.cutBefore)}`).join(";");
      variants.set(signature, { path, ...metrics });
    }
  }
  return [...variants.values()];
}

function bruteOrder(problem, order, variants) {
  let best = { score: Infinity, cuts: Infinity, distance: Infinity }, visited = 0, rejectedZero = 0;
  function visit(index, previous, metrics) {
    if (index === order.length) {
      visited++;
      if (compare(metrics, best) < 0) best = metrics;
      return;
    }
    const id = order[index], block = problem.blocks[id];
    for (const variant of variants[id]) {
      const d = previous ? distance(previous, variant.path[0]) : 0;
      if (previous && !d) { rejectedZero++; continue; }
      if (previous && block.incomingUnit && d !== 1) continue;
      const cut = previous ? Number(Boolean(variant.path[0].cutBefore) || d > problem.threshold) : 0;
      visit(index + 1, variant.path.at(-1), {
        score: metrics.score + variant.score + d + cut * problem.threshold * 3,
        cuts: metrics.cuts + variant.cuts + cut,
        distance: metrics.distance + variant.distance + d
      });
    }
  }
  visit(0, null, { score: 0, cuts: 0, distance: 0 });
  return { ...best, visited, rejectedZero };
}

function checkDP(engine, problem, orders) {
  const variants = problem.blocks.map(block => configVariants(problem, block));
  let rejectedZero = 0;
  for (const block of problem.blocks) {
    assert.ok(block.costs instanceof Float64Array);
    assert.ok(block.cutCounts instanceof Int32Array);
    assert.equal(block.costs.length, block.entries.length * block.exits.length);
    assert.equal(block.cutCounts.length, block.costs.length);
    assert.equal(block.choices.length, block.costs.length);
    for (let entry = 0; entry < block.entries.length; entry++) for (let exit = 0; exit < block.exits.length; exit++) {
      const same = (a, b) => model.key(a) === model.key(b) && a.direction === b.direction;
      const candidates = variants[block.id].filter(v => same(v.path[0], block.entries[entry])
        && same(v.path.at(-1), block.exits[exit])).sort(compare);
      const at = entry * block.exits.length + exit;
      if (!candidates.length) {
        assert.equal(block.costs[at], Infinity, "infeasible port pair remains infeasible");
        assert.equal(block.choices[at], -1);
      } else {
        close(block.costs[at], candidates[0].score, "prepared internal cost");
        assert.equal(block.cutCounts[at], candidates[0].cuts);
        assert.ok(block.choices[at] >= 0 && block.choices[at] < block.configs.length);
      }
    }
  }
  for (const order of orders) {
    const expected = bruteOrder(problem, order, variants);
    rejectedZero += expected.rejectedZero;
    assert.ok(expected.visited > 0, "the exhaustive oracle finds feasible combinations");
    const original = order.slice(), value = engine.evaluateOrder(problem, Object.freeze(order), true);
    close(value.score, expected.score, `DP score for ${order}`);
    assert.equal(value.cuts, expected.cuts, `DP cuts for ${order}`);
    assert.equal(value.trace.length, order.length);
    const route = engine.materialize(problem, order, value);
    assertPath(route, problem.cells, problem.constraints, problem.threshold);
    assertBlockUnits(problem, order, route);
    close(measure(route.path, problem.threshold).score, expected.score, "materialized optimum");
    assert.equal(measure(route.path, problem.threshold).cuts, expected.cuts);
    assert.deepEqual(order, original, "evaluation and materialization do not reorder their input");
    assert.deepEqual(engine.materialize(problem, order, engine.evaluateOrder(problem, order)), route,
      "materialization also accepts an evaluation without trace");
  }
  return { variants, rejectedZero };
}

test("prepared block matrices and route DP match exhaustive configuration/direction choices", () => {
  const engine = optimizer();
  const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 4, y: 1 }];
  let rejectedZero = 0;
  for (const threshold of [1, 2, 10]) {
    const constraints = { forcedCuts: [action(points[1]), action(points[2], "upper")] };
    const problem = engine.prepareProblem({ points, constraints, cutThreshold: threshold });
    assert.equal(problem.blocks.length, 3);
    rejectedZero += checkDP(engine, problem, [...permutations(problem.orders[0])]).rejectedZero;
  }
  const openCells = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  const partial = engine.prepareProblem({ points: openCells, constraints: {
    lockedPrefix: [action(openCells[1]), action(openCells[0])],
    forcedCuts: [action(openCells[1], "upper")]
  } });
  assert.equal(partial.fixedCount, 1);
  const partialOrders = [...permutations(partial.orders[0].slice(1))].map(order => [0, ...order]);
  rejectedZero += checkDP(engine, partial, partialOrders).rejectedZero;
  assert.ok(rejectedZero > 0, "zero-length boundary choices are rejected, even with forced cuts");
  const pair = engine.prepareProblem({ points: [...rectangle(2, 2), ...rectangle(2, 2, 4, 1)] });
  assert.equal(pair.blocks.length, 2);
  checkDP(engine, pair, [...permutations(pair.orders[0])]);
});

test("entry and exit choices are coupled: independent edge minima are unattainable", () => {
  const engine = optimizer();
  const points = [{ x: 0, y: 3 }, ...rectangle(2, 2, 3, 3), { x: 7, y: 3 }];
  const problem = engine.prepareProblem({ points });
  const order = [0, 3, 7].map(x => problem.blocks.find(block => block.cells.some(cell => cell.x === x)).id);
  const { variants } = checkDP(engine, problem, [order]);
  let independent = order.reduce((sum, id) => sum + Math.min(...variants[id].map(v => v.score)), 0);
  for (let i = 1; i < order.length; i++) {
    const edges = variants[order[i - 1]].flatMap(a => variants[order[i]].map(b => {
      const d = distance(a.path.at(-1), b.path[0]);
      return d ? d + Number(Boolean(b.path[0].cutBefore) || d > problem.threshold) * problem.threshold * 3 : Infinity;
    }));
    independent += Math.min(...edges);
  }
  close(independent, 13, "relaxed independent-edge bound");
  close(engine.evaluateOrder(problem, order).score, 13.23606797749979, "coupled optimum");
  assert.ok(engine.evaluateOrder(problem, order).score > independent + 0.2);
});

const zoneReturnCells = [{ x: 3, y: 6 }, { x: 0, y: 6 }, { x: 0, y: 2 },
  { x: 5, y: 3 }, { x: 2, y: 5 }, { x: 6, y: 5 }];
const zoneReturnConstraints = { start: action(zoneReturnCells[0]) };

test("exhaustive search may return to an old eight-connected zone when score improves", () => {
  const engine = optimizer();
  const problem = engine.prepareProblem({ points: zoneReturnCells, constraints: zoneReturnConstraints });
  assert.equal(problem.seed.metrics.zoneReturns, 0);
  assert.equal(problem.fixedCount, 2, "start anchor and resumed upper are fixed");
  const orders = [...permutations(problem.orders[0].slice(2))].map(order => [0, 1, ...order]);
  let best = Infinity, contiguous = Infinity;
  for (const order of orders) {
    const route = engine.materialize(problem, order);
    const metrics = model.createZones(zoneReturnCells).measure(route.path, 10);
    best = Math.min(best, metrics.score);
    if (!metrics.zoneReturns) contiguous = Math.min(contiguous, metrics.score);
  }
  assert.ok(best < contiguous - 0.05, "this fixture requires a zone return for its optimum");
  const result = engine.optimizePath({ points: zoneReturnCells, constraints: zoneReturnConstraints, stagnationLimitMs: 1 });
  assertPath(result, zoneReturnCells, zoneReturnConstraints);
  close(result.metrics.score, best, "exhaustive block-order optimum");
  assert.equal(result.metrics.zoneReturns, 1);
  assert.equal(result.reason, "exhaustive");
  assert.equal(result.attempts - result.relayAttempts, 120);
  assert.equal(result.lastImprovementMs, 0, "exhaustion need not consume the inactivity budget");
  assert.equal(result.method, "block-optimization");
  assert.equal(engine.compareMetrics({ score: 9, cuts: 1, distance: 6, zoneReturns: 99 },
    { score: 10, cuts: 0, distance: 4, zoneReturns: 0 }), -1);
  assert.ok(engine.compareMetrics({ score: 10, cuts: 1, distance: 8 }, { score: 10, cuts: 2, distance: 1 }) < 0);
  assert.ok(engine.compareMetrics({ score: 10, cuts: 1, distance: 7 }, { score: 10, cuts: 1, distance: 8 }) < 0);
});

test("reversing blocks never reverses the diagonals within those blocks", () => {
  const engine = optimizer();
  const points = [...rectangle(2, 2), ...rectangle(2, 1, 8, 0), { x: 15, y: 2 }];
  const problem = engine.prepareProblem({ points });
  const order = problem.orders[0].slice().reverse();
  const route = engine.materialize(problem, order);
  assertPath(route, points);
  assertBlockUnits(problem, order, route);
  const owners = new Map(problem.blocks.flatMap(block => block.cells.map(cell => [model.cellKey(cell), block.id])));
  const realizedOrder = route.path.map(point => owners.get(model.cellKey(point))).filter((id, i, ids) => !i || id !== ids[i - 1]);
  assert.deepEqual(realizedOrder, order);
  assert.notEqual(model.validateRoute(problem.seed.path.slice().reverse(), points), "",
    "the fixture distinguishes block reversal from invalid raw-action reversal");
});

test("an eligible initial route beating the fresh seed is retained before search", () => {
  const initialPath = [0, 5, 3, 4, 1, 2].flatMap((index, i) => {
    const directions = [[1, 1], [1, -1], [1, -1], [-1, -1], [-1, -1], [1, 1]][i];
    return [action(zoneReturnCells[index], "lower", directions[0]), action(zoneReturnCells[index], "upper", directions[1])];
  });
  const options = { points: zoneReturnCells, constraints: zoneReturnConstraints, initialPath, stagnationLimitMs: 1 };
  const engine = optimizer(500), problem = engine.prepareProblem(options);
  assert.equal(problem.orders.length, 2);
  assert.ok(problem.incumbent.metrics.score < problem.seed.metrics.score - 0.05);
  assert.deepEqual(problem.incumbent.path, initialPath);
  const reports = [];
  const result = engine.optimizePath(options, snapshot => { if (snapshot.path) reports.push(snapshot); });
  assert.ok(reports.length > 0);
  for (const snapshot of reports) {
    assert.equal(snapshot.path.length, initialPath.length, "never replace the eligible initial route with a partial preview");
    assert.ok(snapshot.metrics.score <= problem.incumbent.metrics.score + 1e-7);
  }
  assertPath(result, zoneReturnCells, zoneReturnConstraints);
  close(result.initialMetrics.score, problem.incumbent.metrics.score, "initial incumbent metrics");
  assert.ok(result.metrics.score <= problem.incumbent.metrics.score + 1e-7);
});

test("historical prefixes, starts, resumed groups and forced cuts remain fixed", () => {
  const points = [...rectangle(2, 2), ...rectangle(2, 2, 8, 3), { x: 20, y: 1 }];
  const initialPath = model.orient([action(points[0]), action(points[4]), action(points[1]),
    action(points[0], "upper"), action(points[8]), action(points[4], "upper"),
    action(points[1], "upper"), action(points[8], "upper"),
    ...[points[2], points[3], points[5], points[6]].flatMap(cell => [action(cell), action(cell, "upper")])], 10, {}, true);
  initialPath[6].cutBefore = true;
  for (const prefixLength of [0, 1, 2, 3, 5, 8, initialPath.length - 1, initialPath.length]) {
    const constraints = { lockedPrefix: initialPath.slice(0, prefixLength).map(model.copy), start: model.copy(initialPath[0]),
      forcedCuts: [model.copy(initialPath[1]), model.copy(initialPath.at(-1))] };
    const engine = optimizer(500), problem = engine.prepareProblem({ points, initialPath, constraints });
    const order = [...problem.orders[0].slice(0, problem.fixedCount), ...problem.orders[0].slice(problem.fixedCount).reverse()];
    const route = engine.materialize(problem, order);
    assertPath(route, points, constraints);
    assertBlockUnits(problem, order, route);
    assert.deepEqual(route.path.slice(0, prefixLength).map(p => [model.key(p), p.direction]),
      constraints.lockedPrefix.map(p => [model.key(p), p.direction]));
    assert.equal(route.path.find(p => model.key(p) === model.key(initialPath[6])).cutBefore, true,
      "cuts carried only by initialPath are preserved");
    if (problem.fixedCount && problem.blocks.length > 1) {
      const invalid = problem.orders[0].slice();
      [invalid[0], invalid[1]] = [invalid[1], invalid[0]];
      assert.throws(() => engine.evaluateOrder(problem, invalid), /Ordre/);
    }
    const result = engine.optimizePath({ points, initialPath, constraints, stagnationLimitMs: 1 });
    assertPath(result, points, constraints);
  }
  for (const direction of [1, -1]) {
    const constraints = { start: action(points[2], "lower", direction), forcedCuts: [action(points[5], "upper")] };
    const result = optimizer(500).optimizePath({ points, constraints, stagnationLimitMs: 1 });
    assertPath(result, points, constraints);
  }
});

test("search reports only global improvements and resets its timer only for those improvements", () => {
  const engine = optimizer(500), reports = [];
  const result = engine.optimizePath({ points: zoneReturnCells, constraints: zoneReturnConstraints, stagnationLimitMs: 1000000 },
    snapshot => { if (snapshot.stage === "search") reports.push(snapshot); });
  let observed = 0;
  for (let i = 1; i < reports.length; i++) {
    const previous = reports[i - 1], current = reports[i];
    assert.ok(compare(current.metrics, previous.metrics) <= 0, "reported best metrics are monotonic");
    const previousOrigin = previous.elapsedMs - previous.lastImprovementMs;
    const currentOrigin = current.elapsedMs - current.lastImprovementMs;
    if (current.improvements === previous.improvements) {
      assert.equal(currentOrigin, previousOrigin, "no improvement means no timer reset");
      assert.ok(current.lastImprovementMs >= previous.lastImprovementMs);
    } else {
      observed++;
      assert.ok(current.improvements > previous.improvements);
      assert.ok(compare(current.metrics, previous.metrics) < 0);
      assert.ok(currentOrigin > previousOrigin, "a new global best resets inactivity");
      assert.ok(current.path, "the improved best path accompanies its metrics");
      assertPath(current, zoneReturnCells, zoneReturnConstraints);
    }
  }
  assert.ok(reports.length > 2 && observed > 0, "exercise both steady search and actual improvement");
  assert.equal(result.reason, "exhaustive");
  assertPath(result, zoneReturnCells, zoneReturnConstraints);
});

test("restarts and preparation do not consume or reset the global search inactivity budget", () => {
  const points = Array.from({ length: 9 }, (_, i) => ({ x: i * 4, y: i % 2 * 3 }));
  const reports = [], relayReports = [], limit = 130000;
  const result = optimizer(500).optimizePath({ points, stagnationLimitMs: limit }, snapshot => {
    if (snapshot.stage === "search") reports.push(snapshot);
    if (snapshot.stage === "relay") relayReports.push(snapshot);
  });
  assert.ok(reports.length > 100 && result.restarts > 0, "exercise a restart with the injected clock");
  assert.equal(result.improvements, 0, "this seed is already the best found");
  const origin = reports[0].elapsedMs - reports[0].lastImprovementMs;
  assert.ok(origin > 10000, "preparation takes logical time before the search timer starts");
  for (const snapshot of reports) {
    assert.equal(snapshot.elapsedMs - snapshot.lastImprovementMs, origin, "restart never resets the global timer");
    assert.equal(snapshot.stagnationLimitMs, limit);
    close(snapshot.metrics.score, result.metrics.score, "steady global best");
  }
  assert.equal(result.reason, "inactivity");
  assert.ok(relayReports[0].lastImprovementMs >= limit && relayReports[0].lastImprovementMs <= limit + 2000);
  assert.ok(result.lastImprovementMs >= limit && result.lastImprovementMs <= limit + 20000, "relay scan has a separate budget, with coarse-clock reporting overhead");
  const searchAttempts = result.attempts - result.relayAttempts;
  assert.ok(searchAttempts > 100 && searchAttempts < 140, "deadline bounds search despite restarting");
  assertPath(result, points);
});

test("public operations do not mutate frozen options, actions, constraints or orders", () => {
  const points = [...rectangle(2, 2), ...rectangle(2, 2, 8, 3)].map((cell, i) => ({ ...cell, annotation: { index: i } }));
  const initialPath = model.expandCells(points), constraints = {
    lockedPrefix: initialPath.slice(0, 3), start: initialPath[0], forcedCuts: [initialPath[5]]
  };
  const options = deepFreeze({ points, initialPath, constraints, cutThreshold: 3, stagnationLimitMs: 1 });
  const original = structuredClone(options), engine = optimizer(500), problem = engine.prepareProblem(options);
  for (const order of problem.orders.map(order => deepFreeze(order.slice()))) {
    const before = order.slice();
    const evaluation = engine.evaluateOrder(problem, order, true);
    assertPath(engine.materialize(problem, order, evaluation), points, constraints, 3);
    assert.deepEqual(order, before);
  }
  assertPath(engine.optimizePath(options), points, constraints, 3);
  assert.deepEqual(options, original);
});

test("empty routes and malformed block orders are handled explicitly", () => {
  const engine = optimizer(), empty = engine.prepareProblem({ points: [] });
  assert.deepEqual(engine.evaluateOrder(empty, []), { score: 0, cuts: 0 });
  assert.deepEqual(engine.materialize(empty, []), { path: [], unitLinks: [] });
  const result = engine.optimizePath({ points: [], stagnationLimitMs: 1 });
  assertPath(result, []);
  assert.deepEqual(result.blocks, { total: 0, prepared: 0 });
  assert.equal(result.reason, "exhaustive");
  const problem = engine.prepareProblem({ points: [{ x: 0, y: 0 }, { x: 4, y: 4 }] });
  for (const order of [[], [0], [0, 0], [0, 2], [0, -1], [0, 0.5]]) {
    assert.throws(() => engine.evaluateOrder(problem, order), /Ordre/);
  }
});

test("3259-cross benchmark preserves all 345 blocks and exact internal unit links", { timeout: 30000 }, t => {
  const fixture = require("../data/examples/grands-ilots.pattern.json");
  const points = fixture.grid.cells.filter(cell => !cell.empty), before = structuredClone(points);
  const started = performance.now(), reports = [];
  const result = optimizer(500).optimizePath({ points, stagnationLimitMs: 2000 }, snapshot => {
    if (snapshot.stage === "search") reports.push(snapshot);
  });
  t.diagnostic(`3259 crosses, 345 blocks: ${(performance.now() - started).toFixed(0)} ms wall time, ${result.attempts} search attempts`);
  assert.equal(points.length, 3259);
  assertPath(result, points);
  assert.equal(result.path.length, 6518);
  assert.deepEqual(result.blocks, { total: 345, prepared: 345 });
  assert.equal(result.metrics.zoneCount, 9);
  assert.equal(result.unitLinks.filter(Boolean).length, 6173);
  assert.ok(result.metrics.score <= result.initialMetrics.score + 1e-7);
  assert.equal(result.reason, "inactivity");
  assert.ok(result.attempts > 0 && result.lastImprovementMs >= 2000);
  assert.ok(reports.length > 0);
  for (let i = 1; i < reports.length; i++) assert.ok(compare(reports[i].metrics, reports[i - 1].metrics) <= 0);
  assert.deepEqual(points, before);
});

test("diagonal contacts and one-empty-cell orthogonal gaps expose true unit hole connections", () => {
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
    const cells = [{ x: 3, y: 3 }, { x: 3 + dx, y: 3 + dy }], engine = optimizer();
    const problem = engine.prepareProblem({ points: cells });
    assert.equal(problem.unitContacts.length, 1);
    for (const order of [[0, 1], [1, 0]]) {
      assert.ok(problem.unitNeighbors.get(order[0]).includes(order[1]));
      const route = engine.materialize(problem, order);
      assertPath(route, cells);
      assert.equal(distance(route.path[1], route.path[2]), 1);
      close(engine.evaluateOrder(problem, order).score, 3, "two crosses joined at unit distance");
    }
  }
  for (const cells of [[{ x: 0, y: 0 }, { x: 3, y: 0 }], rectangle(3, 1)]) {
    const problem = optimizer().prepareProblem({ points: cells });
    assert.equal(problem.unitContacts.length, 0, "long gaps and contacts inside a block are not inter-block unit contacts");
    assert.equal(problem.unitEdges.length, 0);
  }
});

test("forced cuts and fixed sewing directions cannot masquerade as usable unit neighbors", () => {
  const cells = [{ x: 3, y: 3 }, { x: 4, y: 4 }], engine = optimizer();
  const cut = { forcedCuts: [action(cells[1])] }, problem = engine.prepareProblem({ points: cells, constraints: cut });
  const a = problem.blocks.find(block => block.cells.some(cell => cell.x === 3)).id;
  const b = problem.blocks.find(block => block.cells.some(cell => cell.x === 4)).id;
  assert.equal(problem.unitContacts.length, 1);
  assert.equal(problem.unitNeighbors.get(a).includes(b), false, "a forced cut is not a continuous unit connection");
  const route = engine.materialize(problem, [a, b]);
  assertPath(route, cells, cut);
  close(engine.evaluateOrder(problem, [a, b]).score, 33, "forced cut penalty remains in the global score");
  const locked = { lockedPrefix: [action(cells[0]), action(cells[0], "upper", -1)] };
  const fixed = engine.prepareProblem({ points: cells, constraints: locked });
  assert.equal(fixed.unitNeighbors.get(0).includes(1), false, "this locked exit hole cannot reach the next block in one unit");
  assertPath(engine.materialize(fixed, fixed.orders[0]), cells, locked);
});

test("contact portals are retained beyond the old eight-portal cap", () => {
  const line = rectangle(30, 1), neighbors = Array.from({ length: 14 }, (_, i) => ({ x: (i + 1) * 2, y: 2 }));
  const cells = [...line, ...neighbors], engine = optimizer(), problem = engine.prepareProblem({ points: cells });
  const block = problem.blocks.find(item => item.cells.length === 30);
  const entries = new Set(block.transfers.map(transfer => model.cellKey(block.entries[transfer.entry])));
  const exits = new Set(block.transfers.map(transfer => model.cellKey(block.exits[transfer.exit])));
  for (const neighbor of neighbors) {
    const portal = `${neighbor.x},0`;
    assert.ok(entries.has(portal) && exits.has(portal), `contact ${portal} is a feasible entry and exit`);
    const other = problem.blocks.find(item => item.cells.some(cell => model.cellKey(cell) === model.cellKey(neighbor)));
    assert.ok(problem.unitNeighbors.get(block.id).includes(other.id));
  }
  assert.ok(entries.size > 8);
  assertPath(engine.materialize(problem, problem.orders[0]), cells);
});

test("separate unit entry and exit contacts can be combined through an orthogonal block", () => {
  const cells = [{ x: 1, y: 3 }, ...rectangle(2, 2, 3, 3), { x: 6, y: 4 }], engine = optimizer();
  const problem = engine.prepareProblem({ points: cells });
  const order = [1, 3, 6].map(x => problem.blocks.find(block => block.cells.some(cell => cell.x === x)).id);
  const route = engine.materialize(problem, order);
  assertPath(route, cells);
  assertBlockUnits(problem, order, route);
  assert.equal(distance(route.path[1], route.path[2]), 1);
  assert.equal(distance(route.path[9], route.path[10]), 1);
  assert.notEqual(model.cellKey(route.path[2]), model.cellKey(route.path[9]));
  close(engine.evaluateOrder(problem, order).score, 11, "all eleven backside transitions are unit length");
});

test("unit-priority proposals never replace a globally better incumbent", () => {
  const cells = [{ x: 6, y: 7 }, { x: 7, y: 8 }, { x: 6, y: 3 }, { x: 3, y: 1 },
    { x: 5, y: 5 }, { x: 2, y: 12 }, { x: 8, y: 9 }, { x: 9, y: 4 }, { x: 0, y: 11 }];
  const engine = optimizer(500), problem = engine.prepareProblem({ points: cells });
  assert.ok(problem.unitOrders.length > 0 && problem.unitEdges.length > 0);
  const baseline = engine.evaluateOrder(problem, problem.orders[0]), priority = engine.evaluateOrder(problem, problem.unitOrders[0]);
  assert.ok(priority.score > baseline.score + 2, "the tempting unit-priority order is globally worse in this fixture");
  const result = engine.optimizePath({ points: cells, stagnationLimitMs: 1 });
  assertPath(result, cells);
  assert.ok(result.metrics.score <= baseline.score + 1e-7 && result.metrics.score < priority.score);
});

test("search tries unit adjacency proposals while preserving the best total score", () => {
  const cells = Array.from({ length: 9 }, (_, i) => ({ x: i * 2, y: 0 })), reports = [];
  const result = optimizer(500).optimizePath({ points: cells, stagnationLimitMs: 12000 }, snapshot => {
    if (snapshot.stage === "search") reports.push(snapshot);
  });
  assert.equal(result.unitConnections, 16);
  assert.ok(result.unitAttempts > 0 && result.attempts > result.unitAttempts, "ordinary global moves remain available too");
  assertPath(result, cells);
  close(result.metrics.score, 17, "all-unit incumbent is not sacrificed to the search heuristic");
  for (const report of reports) close(report.metrics.score, 17, "visible best remains optimal for this chain");
  const constraints = { lockedPrefix: model.expandCells(cells).slice(0, 2), forcedCuts: [action(cells[4])] };
  const constrained = optimizer(500).optimizePath({ points: cells, constraints, stagnationLimitMs: 12000 });
  assert.ok(constrained.unitAttempts > 0, "unit-priority relocation is also exercised after a fixed prefix");
  assertPath(constrained, cells, constraints);
});

test("long contact boundaries use sparse internal transfers without dropping contact endpoints", { timeout: 30000 }, () => {
  const cells = [...rectangle(270, 1), ...rectangle(270, 1, 0, 2)], engine = optimizer();
  const problem = engine.prepareProblem({ points: cells });
  assert.equal(problem.unitContacts.length, 270);
  for (const block of problem.blocks) {
    assert.equal(new Set(block.entries.map(model.cellKey)).size, 270);
    assert.equal(block.costs, undefined, "large sparse matrices do not allocate a quadratic dense backing array");
    assert.ok(block.transfers.length < 270 * 8);
  }
  const route = engine.materialize(problem, problem.orders[0]);
  assertPath(route, cells);
  close(engine.evaluateOrder(problem, problem.orders[0]).score, cells.length * 2 - 1, "unit contacts retained along the whole boundary");
});

test("oversized inter-block matrices are evaluated exactly without exceeding the cache budget", () => {
  const count = 730;
  const exits = Array.from({ length: count }, (_, i) => action({ x: i * 3, y: 0 }, "upper"));
  const entries = Array.from({ length: count }, (_, i) => action({ x: i * 3 + 1, y: 1 }));
  const problem = { fixedCount: 0, threshold: 10, transitionCache: new Map(), cacheElements: 0, blocks: [
    { id: 0, entries: [action({ x: 0, y: 0 })], exits,
      transfers: exits.map((_, i) => ({ entry: 0, exit: i, score: i * 0.01, cuts: 0 })) },
    { id: 1, entries, exits: [action({ x: 0, y: 1 }, "upper")],
      transfers: entries.map((_, i) => ({ entry: i, exit: 0, score: i * 0.02, cuts: 0 })) }
  ] };
  const result = optimizer().evaluateOrder(problem, [0, 1]);
  close(result.score, 1, "exact uncached transfer minimum");
  assert.equal(result.cuts, 0);
  assert.equal(problem.cacheElements, 0);
  assert.equal(problem.transitionCache.size, 0);
});

const bridgeCells = [...rectangle(9, 1, 0, 2), ...[0, 4, 8].map(x => ({ x, y: 0 }))];

test("isolated crosses interrupt a large block only when the complete route improves", () => {
  const engine = optimizer(100), reports = [];
  const result = engine.optimizePath({ points: bridgeCells, stagnationLimitMs: 1000000 }, snapshot => {
    if (snapshot.stage === "search") reports.push(snapshot);
  });
  assertPath(result, bridgeCells);
  close(result.initialMetrics.score, 27, "original contiguous-block score");
  close(result.metrics.score, 23, "insertion reaches the absolute unit-distance lower bound");
  assert.equal(result.insertions, 2);
  assert.ok(result.insertionAttempts > result.insertions);
  assert.ok(new Set(result.order).size < result.order.length, "the large block is now visited in several pieces");
  assert.ok(result.path.some((point, i, path) => point.y === 0 && i > 0 && i + 2 < path.length
    && path[i - 1].y === 2 && path[i + 2].y === 2), "a complete isolated cross sits inside the central route");
  assert.deepEqual(result.path.filter(point => point.y === 2).map(model.key),
    engine.prepareProblem({ points: bridgeCells }).seed.path.filter(point => point.y === 2).map(model.key),
    "insertion preserves the internal diagonal order instead of sewing any diagonal twice");
  const improved = reports.filter(snapshot => snapshot.insertions > 0 && snapshot.path);
  assert.ok(improved.length > 0 && improved.some(snapshot => /Insertion de petits blocs/.test(snapshot.phase)),
    "the existing live preview receives the new best route and the insertion phase");
  for (let i = 1; i < reports.length; i++) {
    assert.ok(reports[i].metrics.score <= reports[i - 1].metrics.score + 1e-8);
    if (reports[i].insertions > reports[i - 1].insertions) assert.ok(reports[i].metrics.score < reports[i - 1].metrics.score - 1e-8);
  }
});

test("range-transfer insertion scores equal exhaustive sewing-direction scores", () => {
  const fixtures = [
    [...rectangle(2, 1, 1, 2), { x: 0, y: 1 }, { x: 3, y: 1 }, { x: 1, y: 4 }],
    [...rectangle(3, 1, 1, 2), ...rectangle(2, 1, 1, 0), { x: 7, y: 1 }]
  ];
  let checked = 0, earlier = 0, later = 0, multiCell = 0;
  for (const cells of fixtures) for (const reverse of [false, true]) for (const constrained of [false, true]) {
    const engine = optimizer(), base = engine.prepareProblem({ points: cells });
    const seed = engine.materialize(base, reverse ? base.orders[0].slice().reverse() : base.orders[0]);
    const constraints = constrained ? { lockedPrefix: seed.path.slice(0, 1), start: seed.path[0], forcedCuts: [seed.path.at(-1)] } : {};
    const problem = engine.prepareProblem({ points: cells, initialPath: seed.path, constraints, cutThreshold: 1 });
    const route = { path: seed.path.map(p => ({ ...p, ...(constraints.forcedCuts?.some(c => model.key(c) === model.key(p)) ? { cutBefore: true } : {}) })),
      unitLinks: seed.unitLinks };
    const before = structuredClone(route);
    for (const candidate of engine.blockInsertions(problem, route)) {
      const moved = candidate.materialize();
      if (!moved) { assert.equal(candidate.score, Infinity); continue; }
      assertPath(moved, cells, constraints, 1);
      let oracle = Infinity;
      for (let mask = 0; mask < 2 ** moved.path.length; mask++) {
        const path = moved.path.map((point, i) => ({ ...point, direction: mask & (1 << i) ? -1 : 1 }));
        if (!model.satisfiesConstraints(path, constraints) || path.some((point, i) => moved.unitLinks[i] && distance(path[i - 1], point) !== 1)) continue;
        oracle = Math.min(oracle, measure(path, 1).score);
      }
      close(candidate.score, oracle, "exact relocation score including old-location reconnection and cuts");
      close(measure(moved.path, 1).score, oracle, "materialized directions");
      checked++; if (candidate.from < candidate.to) later++; else earlier++;
      if (candidate.crossCount > 1) multiCell++;
    }
    assert.deepEqual(route, before, "candidate evaluation never edits its incumbent");
  }
  assert.ok(checked >= 12 && earlier && later, "exercise both move directions and endpoint removals");
  assert.ok(multiCell > 0, "also exhaustively verify variable-length block moves");
});

test("insertions respect completed and half-completed locked crosses, starts and manual cuts", () => {
  const engine = optimizer(1);
  const initial = engine.optimizePath({ points: bridgeCells, stagnationLimitMs: 100000 }).path;
  const firstSatellite = initial.findIndex(point => point.y === 0);
  for (const prefixLength of [0, 1, firstSatellite + 1, firstSatellite + 2, initial.length - 1, initial.length]) {
    const constraints = { lockedPrefix: initial.slice(0, prefixLength), start: initial[0], forcedCuts: [initial[firstSatellite + 1]] };
    const options = { points: bridgeCells, initialPath: initial, constraints, cutThreshold: 2, stagnationLimitMs: 10000 };
    const result = optimizer(1).optimizePath(options);
    assertPath(result, bridgeCells, constraints, 2);
    assert.ok(result.metrics.score <= result.initialMetrics.score + 1e-8);
    assert.deepEqual(result.path.slice(0, prefixLength).map(p => [model.key(p), p.direction]),
      initial.slice(0, prefixLength).map(p => [model.key(p), p.direction]));
    const problem = engine.prepareProblem(options);
    for (const candidate of engine.blockInsertions(problem, { path: result.path, unitLinks: result.unitLinks })) {
      assert.ok(candidate.from >= Math.max(prefixLength, 1) && candidate.to >= Math.max(prefixLength, 1));
    }
  }
});

test("interleaved historical routes survive relaunch and an immediately expired search budget", () => {
  const first = optimizer(1).optimizePath({ points: bridgeCells, stagnationLimitMs: 100000 });
  const options = deepFreeze({ points: bridgeCells, initialPath: first.path, stagnationLimitMs: 1 });
  const reports = [], second = optimizer(500).optimizePath(options, snapshot => {
    if (snapshot.path) reports.push(snapshot);
  });
  assertPath(second, bridgeCells);
  close(second.initialMetrics.score, first.metrics.score, "retained interleaved baseline");
  assert.deepEqual(second.path, first.path);
  for (const report of reports) {
    assert.equal(report.path.length, first.path.length);
    assert.ok(report.metrics.score <= first.metrics.score + 1e-8, "neither preparation nor termination regresses the preview");
  }
  assert.ok(new Set(second.order).size < second.order.length);
});

test("insertions require distinct blocks and a larger host, and tied moves are not accepted", () => {
  for (const cells of [rectangle(4, 2), [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    [...rectangle(4, 1), ...rectangle(4, 1, 0, 2)]]) {
    const engine = optimizer(), problem = engine.prepareProblem({ points: cells });
    assert.deepEqual([...engine.blockInsertions(problem, engine.materialize(problem, problem.orders[0]))], []);
  }
  const cells = [...rectangle(5, 1, 0, 2), ...[0, 2, 4].map(x => ({ x, y: 0 }))];
  const result = optimizer(1).optimizePath({ points: cells, stagnationLimitMs: 100000 });
  assertPath(result, cells);
  assert.equal(result.insertionAttempts, 0, "skip insertion search at the absolute unit-distance lower bound");
  assert.equal(result.insertions, 0, "equal-score moves cannot oscillate or reset inactivity");
  close(result.metrics.score, result.initialMetrics.score, "already unit-optimal route");
});

test("intermediate block orders can beat the incumbent after refinement without publishing local regressions", () => {
  const points = require("./fixtures/combined-search.js").intermediate, reports = [];
  const result = optimizer(1).optimizePath({ points, stagnationLimitMs: 1200 }, snapshot => {
    if (snapshot.stage === "search") reports.push(snapshot);
  });
  assertPath(result, points);
  assert.ok(result.refinedOrders > 1 && result.intermediateImprovements > 0);
  close(result.metrics.score, 32.47213595499958, "combined search regression fixture");
  for (let i = 1; i < reports.length; i++) {
    const a = reports[i - 1], b = reports[i];
    assert.ok(compare(b.metrics, a.metrics) <= 0, "unpublished local paths never regress the global preview");
    if (b.improvements === a.improvements) {
      assert.equal(b.elapsedMs - b.lastImprovementMs, a.elapsedMs - a.lastImprovementMs,
        "intermediate improvements alone do not restart inactivity");
    } else assert.ok(compare(b.metrics, a.metrics) < 0);
    if (b.path) assertPath(b, points);
  }
  const replay = optimizer(1).optimizePath({ points, stagnationLimitMs: 1200 });
  assert.deepEqual(replay.path, result.path, "fixed seed and logical budget reproduce the route");
  assert.equal(replay.attempts, result.attempts);
});

test("restarts reuse interleaved routes and retain constraints on unpublished candidates", () => {
  const points = require("./fixtures/combined-search.js").interleaved;
  const first = optimizer(1).optimizePath({ points, stagnationLimitMs: 8000 });
  assertPath(first, points);
  assert.ok(first.interleavedRestarts > 0 && first.intermediateImprovements > 0);
  assert.ok(new Set(first.order).size < first.order.length, "the retained route is interleaved");
  assert.ok(first.metrics.score <= 59.84800554704864 + 1e-7, "restarts and relays must not regress the previous fixture score");
  const constraints = { lockedPrefix: first.path.slice(0, 3), start: first.path[0],
    forcedCuts: [first.path.at(-1)] };
  const initialPath = first.path.map(model.copy);
  initialPath.at(-1).cutBefore = true;
  const before = structuredClone(initialPath), reports = [];
  const second = optimizer(1).optimizePath({ points, initialPath, constraints, stagnationLimitMs: 8000 }, snapshot => {
    if (snapshot.stage === "search" && snapshot.path) reports.push(snapshot);
  });
  assertPath(second, points, constraints);
  assert.ok(second.interleavedRestarts > 0);
  assert.ok(second.metrics.score <= measure(initialPath, 10).score + 1e-8);
  for (const snapshot of reports) assertPath(snapshot, points, constraints);
  assert.deepEqual(initialPath, before);
  assert.deepEqual(second.path.slice(0, 3).map(p => [model.key(p), p.direction]),
    constraints.lockedPrefix.map(p => [model.key(p), p.direction]));
  assert.equal(second.path.find(p => model.key(p) === model.key(initialPath.at(-1))).cutBefore, true);
});

test("combined order and insertion search can eliminate a cut after all block orders have been tested", () => {
  const points = require("./fixtures/combined-search.js").cutAware;
  const result = optimizer().optimizePath({ points, cutThreshold: 3, stagnationLimitMs: 1 });
  assertPath(result, points, {}, 3);
  assert.equal(result.reason, "exhaustive");
  assert.ok(result.intermediateImprovements > 0);
  assert.ok(result.metrics.cuts <= 2);
  assert.ok(result.metrics.score <= 49.38905042258274 + 1e-7, "relay refinement cannot regress combined search");
  assert.ok(result.metrics.score < 61.819131909660754, "previous incumbent-only refinement retained three cuts");
});

function smallBlockBridge(size) {
  return [...rectangle(size * 3 + 6, 1, 0, 2), ...[0, size + 3, size * 2 + 6].flatMap(x => rectangle(size, 1, x, 0))];
}

test("small complete blocks are inserted intact with strict gains, up to the sixteen-cross limit", () => {
  for (const size of [2, 3, 4, 8, 16]) {
    const cells = smallBlockBridge(size), engine = optimizer(1);
    const problem = engine.prepareProblem({ points: cells }), base = engine.materialize(problem, problem.orders[0]);
    const candidates = [...engine.blockInsertions(problem, base)];
    assert.ok(candidates.length > 0 && candidates.every(candidate => candidate.crossCount === size));
    for (const candidate of candidates) {
      assert.equal(candidate.end - candidate.from, size * 2);
      const moved = candidate.materialize();
      if (!moved) { assert.equal(candidate.score, Infinity); continue; }
      assertPath(moved, cells);
      close(candidate.score, measure(moved.path, 10).score, "full variable-length relocation score");
      const original = base.path.slice(candidate.from, candidate.end).map(model.key);
      const newStart = moved.path.findIndex(point => model.key(point) === original[0]);
      assert.deepEqual(moved.path.slice(newStart, newStart + original.length).map(model.key), original,
        "the complete small-block sequence is moved without reversal or missing diagonals");
      assert.deepEqual(moved.unitLinks.slice(newStart + 1, newStart + original.length),
        base.unitLinks.slice(candidate.from + 1, candidate.end), "internal unit constraints travel with the block");
    }
    const result = engine.optimizePath({ points: cells, stagnationLimitMs: 100000 });
    assertPath(result, cells);
    assert.ok(result.insertions >= 2 && result.metrics.score < result.initialMetrics.score);
    close(result.metrics.score, cells.length * 2 - 1, "all-unit optimum for this bridge fixture");
    const next = optimizer(500).optimizePath({ points: cells, initialPath: result.path, stagnationLimitMs: 1 });
    assertPath(next, cells);
    assert.deepEqual(next.path, result.path, "relaunch preserves inserted multi-cell blocks");
  }
});

test("large, split and partially locked blocks are never moved as complete small blocks", () => {
  const engine = optimizer();
  for (const size of [16, 17]) {
    const cells = [...rectangle(20, 1, 0, 2), ...rectangle(size, 1)];
    const problem = engine.prepareProblem({ points: cells });
    const candidates = [...engine.blockInsertions(problem, engine.materialize(problem, problem.orders[0]))];
    assert.equal(candidates.length > 0, size === 16);
    assert.equal(problem.insertions.maxCrosses, 16);
  }
  const host = rectangle(5, 1, 0, 2), small = rectangle(2, 1), cells = [...host, ...small];
  const initialPath = model.orient([...small.slice(0, 1), ...host, ...small.slice(1)].flatMap(cell =>
    [action(cell), action(cell, "upper")]), 10, {}, true);
  const split = engine.prepareProblem({ points: cells, initialPath });
  const splitRoute = { path: initialPath, unitLinks: initialPath.map(() => false) };
  assert.deepEqual([...engine.blockInsertions(split, splitRoute)], [], "a block interrupted by another is not treated as contiguous");
  const base = engine.prepareProblem({ points: cells });
  const smallId = base.blocks.find(block => block.cells.length === 2).id;
  const route = engine.materialize(base, [smallId, ...base.orders[0].filter(id => id !== smallId)]);
  for (const prefixLength of [1, 2, 3, 4]) {
    const constraints = { lockedPrefix: route.path.slice(0, prefixLength), start: route.path[0] };
    const problem = engine.prepareProblem({ points: cells, initialPath: route.path, constraints });
    assert.deepEqual([...engine.blockInsertions(problem, route)], [], "even one locked diagonal protects the whole source block");
  }
});

test("multi-cell insertions preserve starts, locked host diagonals, manual cuts and immutable inputs", () => {
  const cells = smallBlockBridge(3), engine = optimizer(100);
  const original = engine.prepareProblem({ points: cells }).seed.path;
  const constraints = { lockedPrefix: original.slice(0, 2), start: original[0],
    forcedCuts: [original.find(point => point.y === 0 && point.diagonal === "upper")] };
  const options = deepFreeze({ points: cells, initialPath: original, constraints, cutThreshold: 2, stagnationLimitMs: 100000 });
  const before = structuredClone(options), reports = [];
  const result = engine.optimizePath(options, snapshot => {
    if (snapshot.stage === "search") reports.push(snapshot);
  });
  assertPath(result, cells, constraints, 2);
  assert.ok(result.insertions > 0);
  assert.deepEqual(result.path.slice(0, 2).map(p => [model.key(p), p.direction]),
    original.slice(0, 2).map(p => [model.key(p), p.direction]));
  for (let i = 1; i < reports.length; i++) {
    assert.ok(reports[i].metrics.score <= reports[i - 1].metrics.score + 1e-8);
    if (reports[i].insertions > reports[i - 1].insertions) assert.ok(reports[i].metrics.score < reports[i - 1].metrics.score - 1e-8);
  }
  assert.deepEqual(options, before);
});

test("bent and solid small blocks retain all internal diagonals during insertion", () => {
  for (const small of [[{ x: 4, y: 0 }, { x: 5, y: 0 }, { x: 4, y: 1 }], rectangle(2, 2, 4, 0)]) {
    const cells = [...rectangle(9, 2, 0, 3), ...small], engine = optimizer();
    const problem = engine.prepareProblem({ points: cells }), base = engine.materialize(problem, problem.orders[0]);
    const candidates = [...engine.blockInsertions(problem, base)];
    assert.ok(candidates.length > 0);
    let valid = 0;
    for (const candidate of candidates) {
      assert.equal(candidate.crossCount, small.length);
      const moved = candidate.materialize();
      if (!moved) { assert.equal(candidate.score, Infinity); continue; }
      assertPath(moved, cells);
      close(candidate.score, measure(moved.path, 10).score, "two-dimensional block score");
      const sequence = base.path.slice(candidate.from, candidate.end).map(model.key);
      const at = moved.path.findIndex(point => model.key(point) === sequence[0]);
      assert.deepEqual(moved.path.slice(at, at + sequence.length).map(model.key), sequence);
      valid++;
    }
    assert.ok(valid > 0);
  }
});

test("search no longer computes or transports orange focus regions", () => {
  const reports = [], cells = smallBlockBridge(3), engine = optimizer(100);
  const result = engine.optimizePath({ points: cells, stagnationLimitMs: 1000000 }, snapshot => reports.push(snapshot));
  assert.ok(reports.length > 2);
  assert.ok(reports.every(snapshot => snapshot.activity === undefined && snapshot.zone?.bounds === undefined));
  assertPath(result, cells);
  close(result.metrics.score, cells.length * 2 - 1, "visual reporting preserves the known optimum");
});
