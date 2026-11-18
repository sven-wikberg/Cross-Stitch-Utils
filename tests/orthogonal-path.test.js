const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");

const builder = createOrthogonalPathBuilder(model);
const cellKey = p => `${p.x},${p.y}`;
const actionKey = p => `${cellKey(p)}:${p.diagonal}`;
const action = (cell, diagonal = "lower", direction = 1) => ({ ...cell, diagonal, direction });
const rectangle = (width, height, x = 0, y = 0) => Array.from({ length: width * height }, (_, i) =>
  ({ x: x + i % width, y: y + Math.floor(i / width) }));
const unitLinks = sequence => sequence.map((_, i) => i > 0);
const close = (actual, expected, message) => assert.ok(Number.isFinite(actual)
  && Math.abs(actual - expected) < 1e-7, `${message}: expected ${expected}, received ${actual}`);

function components(cells) {
  const remaining = new Map(cells.map(cell => [cellKey(cell), cell]));
  const groups = [];
  for (const seed of cells) {
    if (!remaining.delete(cellKey(seed))) continue;
    const pending = [seed], group = [];
    while (pending.length) {
      const cell = pending.pop();
      group.push(cell);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${cell.x + dx},${cell.y + dy}`, neighbor = remaining.get(key);
        if (neighbor) { remaining.delete(key); pending.push(neighbor); }
      }
    }
    groups.push(group);
  }
  return groups;
}

function canonicalGroups(groups) {
  return groups.map(group => group.map(cellKey).sort().join(";")).sort();
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

function assertCoverage(path, cells, label, complete = true) {
  assert.ok(Array.isArray(path), `${label}: action array`);
  const expected = new Set(cells.map(cellKey)), seen = new Set();
  for (const point of path) {
    assert.ok(expected.has(cellKey(point)), `${label}: action belongs to input`);
    assert.ok(["lower", "upper"].includes(point.diagonal), `${label}: diagonal`);
    assert.ok([1, -1].includes(point.direction), `${label}: direction`);
    assert.ok(!seen.has(actionKey(point)), `${label}: no repeated diagonal`);
    if (point.diagonal === "upper") {
      assert.ok(seen.has(`${cellKey(point)}:lower`), `${label}: lower before upper`);
    }
    seen.add(actionKey(point));
  }
  if (complete) assert.equal(seen.size, expected.size * 2, `${label}: both diagonals of every cell`);
}

function assertPhysicalPath(path, cells, links, label, complete = true) {
  assertCoverage(path, cells, label, complete);
  assert.equal(model.validateRoute(path, cells, complete), "", label);
  if (links !== undefined) {
    assert.ok(Array.isArray(links), `${label}: unitLinks array`);
    assert.equal(links.length, path.length, `${label}: one unit flag per action`);
    assert.ok(links.every(flag => typeof flag === "boolean"), `${label}: boolean unit flags`);
  }
  for (let i = 1; i < path.length; i++) {
    assert.ok(distance(path[i - 1], path[i]) > 0, `${label}: nonzero link ${i}`);
    if (links?.[i]) assert.equal(distance(path[i - 1], path[i]), 1, `${label}: exact unit link ${i}`);
  }
}

function assertMetrics(metrics, path, threshold, label) {
  const expected = model.metrics(path, threshold, true);
  for (const [key, value] of Object.entries(expected)) close(metrics[key], value, `${label}: ${key}`);
}

function assertResult(result, cells, constraints = {}, threshold = 10) {
  assert.ok(result && typeof result.then !== "function", "buildPath returns synchronously");
  assert.equal(result.method, "orthogonal-backtracking");
  assertPhysicalPath(result.path, cells, result.unitLinks, "built path");
  assert.ok(Array.isArray(result.unitLinks), "buildPath exposes its unit-link guarantees");
  assert.ok(model.satisfiesConstraints(result.path, constraints), "all route constraints are satisfied");
  assert.deepEqual(result.path.slice(0, constraints.lockedPrefix?.length || 0), constraints.lockedPrefix || []);
  assertMetrics(result.metrics, result.path, threshold, "result metrics");
  const zoneMetrics = model.createZones(cells).measure(result.path, threshold);
  for (const key of ["zoneCount", "visitedZones", "zoneReturns"]) assert.equal(result.metrics[key], zoneMetrics[key]);
  assert.ok(Number.isInteger(result.zone.total) && result.zone.total >= 0);
  assert.equal(result.zone.completed, result.zone.total);
  assert.ok(Number.isInteger(result.diagnostics.groups) && result.diagnostics.groups >= 0);
  assert.ok(Number.isInteger(result.diagnostics.entryExitChanges) && result.diagnostics.entryExitChanges >= 0);
}

function assertSequence(sequence, cells, entry, exit = entry) {
  assertCoverage(sequence, cells, "sequence");
  assert.ok(sequence.every(point => point.direction === 1), "sequence uses direction-1 placeholders");
  assert.equal(actionKey(sequence[0]), actionKey(action(entry)));
  assert.equal(actionKey(sequence.at(-1)), actionKey(action(exit, "upper")));
  const oriented = builder.orientUnitPath(sequence, unitLinks(sequence));
  assert.ok(oriented, `sequence from ${cellKey(entry)} to ${cellKey(exit)} has a unit orientation`);
  assertPhysicalPath(oriented.path, cells, unitLinks(sequence), "oriented sequence");
  close(oriented.score, sequence.length - 1, "unit-only score");
  return oriented.path;
}

// Exhaustive direction enumeration is independent of the worker's dynamic program.
function bruteOrientation(sequence, links, constraints = {}, threshold = 10, previous = null, next = []) {
  const cuts = new Set((constraints.forcedCuts || []).map(actionKey));
  let best = Infinity;
  for (let mask = 0; mask < 2 ** sequence.length; mask++) {
    const path = sequence.map((point, i) => ({ ...point, direction: mask & (1 << i) ? -1 : 1,
      ...(cuts.has(actionKey(point)) ? { cutBefore: true } : {}) }));
    if (!model.satisfiesConstraints(path, constraints)) continue;
    let score = 0, valid = true;
    for (let i = 0; i < path.length; i++) {
      const before = i ? path[i - 1] : previous;
      if (!before) continue;
      const d = distance(before, path[i]);
      if (!d || (links[i] && d !== 1)) { valid = false; break; }
      score += d + (path[i].cutBefore || d > threshold ? threshold * 3 : 0);
    }
    if (valid && next.length) {
      score += Math.min(...next.map(point => {
        const d = distance(path.at(-1), point);
        return d ? d + (point.cutBefore || d > threshold ? threshold * 3 : 0) : Infinity;
      }));
    }
    if (valid) best = Math.min(best, score);
  }
  return best;
}

function compareOrientation(sequence, links, constraints = {}, threshold = 10, previous = null, next = []) {
  const expected = bruteOrientation(sequence, links, constraints, threshold, previous, next);
  const actual = builder.orientUnitPath(sequence, links, constraints, threshold, previous, next);
  if (!Number.isFinite(expected)) {
    assert.equal(actual, null, "infeasible unit directions return null, not a relaxed route");
    return false;
  }
  assert.ok(actual, "a feasible orientation is not rejected");
  assert.deepEqual(actual.path.map(actionKey), sequence.map(actionKey), "orientation keeps action order");
  assert.ok(model.satisfiesConstraints(actual.path, constraints));
  close(actual.score, expected, "exhaustive minimum orientation score");
  const scoredPath = previous ? [previous, ...actual.path] : actual.path;
  const exitScore = next.length ? Math.min(...next.map(point => model.cost(actual.path.at(-1), point, threshold, true))) : 0;
  close(model.metrics(scoredPath, threshold, true).score + exitScore, actual.score, "returned path realizes score");
  for (let i = 0; i < actual.path.length; i++) {
    const before = i ? actual.path[i - 1] : previous;
    if (before) {
      assert.ok(distance(before, actual.path[i]) > 0);
      if (links[i]) assert.equal(distance(before, actual.path[i]), 1);
    }
  }
  return true;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test("orthogonalComponents partitions every 3x3 mask by side contacts only", () => {
  const grid = rectangle(3, 3);
  for (let mask = 0; mask < 1 << grid.length; mask++) {
    const cells = grid.filter((_, i) => mask & (1 << i));
    const expected = canonicalGroups(components(cells));
    assert.deepEqual(canonicalGroups(builder.orthogonalComponents(cells)), expected, `mask ${mask}`);
    assert.deepEqual(canonicalGroups(builder.orthogonalComponents([...cells].reverse())), expected,
      `reversed mask ${mask}`);
  }
});

test("every root of every connected 3x3 mask has complete exact-unit DFS coverage", () => {
  const grid = rectangle(3, 3);
  let masks = 0, roots = 0;
  for (let mask = 1; mask < 1 << grid.length; mask++) {
    const cells = grid.filter((_, i) => mask & (1 << i));
    if (components(cells).length !== 1) continue;
    masks++;
    for (const entry of cells) {
      roots++;
      try {
        assertSequence(builder.buildSequence(cells, entry), cells, entry);
      } catch (error) {
        error.message = `mask ${mask}, root ${cellKey(entry)}: ${error.message}`;
        throw error;
      }
    }
    const result = builder.buildPath({ points: cells, cutThreshold: 10 });
    assertResult(result, cells);
    assert.equal(result.zone.total, 1);
    assert.equal(result.diagnostics.groups, 1);
    assert.ok(result.unitLinks.slice(1).every(Boolean), `mask ${mask}: retain all internal unit guarantees`);
  }
  assert.equal(masks, 218, "all connected nonempty masks were exercised");
  assert.ok(roots > 1000, "exercise every possible DFS root, not only corners");
});

test("star orientations match exhaustive search for every root, start direction, and fixed-prefix length", () => {
  const cells = [{ x: 1, y: 1 }, { x: 0, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 2 }];
  for (const root of cells) {
    const sequence = builder.buildSequence(cells, root), links = unitLinks(sequence);
    assertSequence(sequence, cells, root);
    for (const startDirection of [1, -1]) {
      const oriented = builder.orientUnitPath(sequence, links, { start: { ...sequence[0], direction: startDirection } });
      compareOrientation(sequence, links, { start: { ...sequence[0], direction: startDirection } });
      if (!oriented) continue;
      for (let length = 1; length <= sequence.length; length++) for (const endDirection of [1, -1]) {
        const prefix = oriented.path.slice(0, length).map(point => ({ ...point }));
        prefix[prefix.length - 1].direction = endDirection;
        if (model.validateRoute(prefix, cells, false)) continue;
        compareOrientation(sequence, links, { lockedPrefix: prefix, start: prefix[0] });
      }
    }
  }
});

test("orientation handles mixed link guarantees, cuts, thresholds, and previous-action boundaries", () => {
  const cells = rectangle(2, 2);
  const sequence = builder.buildSequence(cells, cells[0]);
  let feasible = 0, infeasible = 0;
  for (const threshold of [1, 10]) for (const direction of [1, -1]) {
    for (const links of [unitLinks(sequence), sequence.map(() => true),
      sequence.map(() => false), sequence.map((_, i) => i % 2 === 1)]) {
      const constraints = { start: { ...sequence[0], direction }, forcedCuts: [sequence[3]] };
      for (const previous of [null, action({ x: 0, y: 0 }, "upper", 1), action({ x: 20, y: 20 }, "upper", -1)]) {
        const result = compareOrientation(sequence, links, constraints, threshold, previous);
        if (result) feasible++; else infeasible++;
      }
    }
  }
  const impossible = [action({ x: 0, y: 0 }), action({ x: 10, y: 0 })];
  assert.equal(builder.orientUnitPath(impossible, [false, true]), null, "a long link cannot satisfy a unit flag");
  const zero = [action({ x: 0, y: 0 }), action({ x: 1, y: 0 }, "upper")];
  assert.equal(distance(zero[0], zero[1]), 0);
  assert.equal(builder.orientUnitPath(zero, [false, false], { lockedPrefix: zero, forcedCuts: [zero[1]] }), null,
    "a forced cut cannot legalize a zero-length connection");
  assert.ok(feasible > 0 && infeasible > 0, "the oracle covers both feasible and rejected cases");
});

test("orientation scores alternative next actions and enforces the first unit link against previous", () => {
  const sequence = [action({ x: 1, y: 0 }), action({ x: 1, y: 0 }, "upper")];
  const previous = action({ x: 0, y: 0 });
  const far = action({ x: 20, y: 10 });
  const nearby = [action({ x: 2, y: 0 }), action({ x: 2, y: 0 }, "lower", -1)];
  for (const direction of [1, -1]) for (const threshold of [1, 10]) {
    for (const next of [[], [far], nearby, [far, ...nearby], [nearby[0], { ...nearby[1], cutBefore: true }]]) {
      compareOrientation(sequence, [true, true], {}, threshold, { ...previous, direction }, next);
    }
  }
  assert.ok(builder.orientUnitPath(sequence, [false, true], {}, 10, far), "an unmarked incoming long link is allowed");
  assert.equal(builder.orientUnitPath(sequence, [true, true], {}, 10, far), null, "unitLinks[0] constrains the previous boundary");
  for (const startDirection of [1, -1]) for (const exitDirection of [1, -1]) {
    const one = [action({ x: 1, y: 1 })];
    const next = [action({ x: 2, y: 1 }, "upper", exitDirection)];
    compareOrientation(one, [false], { start: { ...one[0], direction: startDirection } }, 10, null, next);
  }
});

test("4x4 rectangle permits distinct diagonal entry and exit with exact unit links", () => {
  const cells = rectangle(4, 4);
  const entry = { x: 0, y: 0 }, exit = { x: 3, y: 3 };
  assertSequence(builder.buildSequence(cells, entry, exit), cells, entry, exit);
  assertSequence(builder.buildSequence([...cells].reverse(), exit, entry), cells, exit, entry);
});

test("buildSequence rejects wrong parity, inaccessible diagonal prefixes, and disconnected residuals", () => {
  const square = rectangle(2, 2);
  assert.equal(builder.buildSequence(square, square[0], square[1]), null, "opposite endpoint parity");
  const chain = rectangle(3, 1);
  assert.equal(builder.buildSequence(chain, chain[0], chain[2]), null, "same parity but no diagonal prefix to exit");
  const branched = [{ x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 },
    { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }];
  assert.equal(components(branched).length, 1, "fixture starts orthogonally connected");
  assert.ok(components(branched.slice(1)).length > 1, "consuming the entry disconnects the residual");
  assert.equal(builder.buildSequence(branched, branched[0], branched.at(-1)), null,
    "a reachable diagonal exit is insufficient when prefix removal disconnects the remaining cells");
  assert.equal(builder.buildSequence(square, { x: 9, y: 9 }, square[0]), null, "entry must belong to the group");
  assert.equal(builder.buildSequence(square, square[0], { x: 9, y: 9 }), null, "exit must belong to the group");
  assert.equal(builder.buildSequence([{ x: 0, y: 0 }, { x: 2, y: 0 }], { x: 0, y: 0 }), null,
    "an ordinary DFS cannot cover a disconnected input");
});

test("rectangle plus neighboring zone reports entry/exit changes consistently", () => {
  const block = rectangle(4, 4), neighbor = { x: 5, y: 3 }, cells = [...block, neighbor];
  const result = builder.buildPath({ points: cells, cutThreshold: 10 });
  assertResult(result, cells);
  assert.equal(result.zone.total, 2);
  assert.equal(result.diagnostics.groups, 2);
  const blockPath = result.path.filter(point => point.x < 4);
  const changed = cellKey(blockPath[0]) !== cellKey(blockPath.at(-1));
  assert.equal(changed, true, "use a distinct exit to shorten the link to the neighboring zone");
  assert.equal(result.diagnostics.entryExitChanges, Number(changed), "diagnostics describe the realized group endpoints");
  for (let i = 1; i < result.path.length; i++) {
    if (result.path[i - 1].x < 4 && result.path[i].x < 4) assert.equal(result.unitLinks[i], true);
  }
});

test("arbitrary historical prefixes, starts, and forced cuts survive with or without initialPath", () => {
  const cells = [...rectangle(2, 2), ...rectangle(2, 2, 12, 3), { x: 25, y: 1 }];
  const order = [action(cells[0]), action(cells[4]), action(cells[1]), action(cells[0], "upper"),
    action(cells[8]), action(cells[4], "upper"), action(cells[1], "upper"), action(cells[8], "upper"),
    ...[cells[2], cells[3], cells[5], cells[6], cells[7]].flatMap(cell => [action(cell), action(cell, "upper")])];
  const initial = model.orient(order, 10, {}, true);
  initial[2].cutBefore = true;
  initial[6].cutBefore = true;
  assertPhysicalPath(initial, cells, undefined, "historical fixture");
  for (const prefixLength of [0, 1, 2, 3, 5, 8, initial.length - 1, initial.length]) {
    for (const withInitial of [false, true]) {
      const constraints = { lockedPrefix: initial.slice(0, prefixLength).map(model.copy), start: model.copy(initial[0]),
        forcedCuts: [model.copy(initial[2]), model.copy(initial.at(-1))] };
      if (prefixLength === initial.length) constraints.lockedPrefix.at(-1).cutBefore = true;
      const options = { points: cells, constraints, cutThreshold: 10,
        ...(withInitial ? { initialPath: initial } : {}) };
      const before = structuredClone(options);
      const result = builder.buildPath(options);
      assertResult(result, cells, constraints);
      assert.deepEqual(options, before, `prefix ${prefixLength}, initialPath ${withInitial}: input unchanged`);
      for (const cut of constraints.forcedCuts) assert.equal(result.path.find(p => actionKey(p) === actionKey(cut)).cutBefore, true);
      if (withInitial) assert.equal(result.path.find(p => actionKey(p) === actionKey(initial[6])).cutBefore, true,
        "a cut carried only by initialPath is preserved too");
    }
  }
  for (const startCell of cells) for (const direction of [1, -1]) {
    const constraints = { start: action(startCell, "lower", direction) };
    assertResult(builder.buildPath({ points: cells, constraints }), cells, constraints);
  }
});

test("a single open lower resumes its DFS root for both start-only and historical-prefix constraints", () => {
  const star = [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 2 }, { x: 3, y: 4 }];
  const completed = { x: 12, y: 12 };
  for (const root of star) for (const direction of [1, -1]) for (const historical of [false, true]) {
    const start = action(root, "lower", direction);
    const prefix = historical ? model.orient([action(completed), action(completed, "upper"), start], 10,
      { lockedPrefix: [action(completed), action(completed, "upper"), start] }, true) : [start];
    const cells = historical ? [...star, completed] : star;
    const constraints = historical ? { lockedPrefix: prefix, start: prefix[0] } : { start };
    const result = builder.buildPath({ points: cells, constraints });
    assertResult(result, cells, constraints);
    assert.equal(result.diagnostics.groups, 1, "the open lower remains in its connected DFS group");
    assert.equal(actionKey(result.path.at(-1)), actionKey(action(root, "upper")), "the root closes after its descendants");
    assert.ok(result.unitLinks.slice(prefix.length).every(Boolean), "including the resumed first link, all remaining links are unit");
    assert.equal(distance(result.path[prefix.length - 1], result.path[prefix.length]), 1);
  }
});

test("singleton, diagonal chains, and checkerboards remain complete and physically valid", () => {
  const fixtures = [[{ x: 4, y: 7 }], Array.from({ length: 18 }, (_, i) => ({ x: i, y: i })),
    rectangle(9, 9).filter(cell => (cell.x + cell.y) % 2 === 0)];
  for (const cells of fixtures) {
    const result = builder.buildPath({ points: cells });
    assertResult(result, cells);
    assert.equal(result.metrics.zoneCount, 1, "corner-touching cells share one eight-connected zone");
    assert.equal(result.zone.total, cells.length, "progress schedules each orthogonal group separately");
    assert.equal(result.diagnostics.groups, cells.length, "corner contacts never merge orthogonal groups");
    assert.equal(builder.orthogonalComponents(cells).length, cells.length);
    if (cells.length === 1) {
      assert.deepEqual(result.path.map(point => point.diagonal), ["lower", "upper"]);
      assert.equal(distance(...result.path), 1);
      assert.equal(result.unitLinks[1], true);
    }
  }
});

test("all public helpers leave deeply frozen inputs unchanged", () => {
  const cells = rectangle(3, 3).map((cell, i) => ({ ...cell, dmc: "310", annotation: { index: i } }));
  const initialPath = model.expandCells(cells);
  const constraints = { lockedPrefix: initialPath.slice(0, 3), start: initialPath[0], forcedCuts: [initialPath[8]] };
  const options = deepFreeze({ points: cells, initialPath, constraints, cutThreshold: 10 });
  const original = structuredClone(options);
  builder.orthogonalComponents(cells);
  const sequence = deepFreeze(builder.buildSequence(cells, cells[0]));
  const links = deepFreeze(unitLinks(sequence));
  const orientationConstraints = deepFreeze({ start: { ...sequence[0], direction: 1 }, forcedCuts: [sequence[3]] });
  const previous = deepFreeze(action({ x: 30, y: 30 }, "upper", -1));
  const next = deepFreeze([action({ x: 20, y: 20 }), action({ x: 20, y: 20 }, "lower", -1)]);
  const orientationInput = structuredClone({ sequence, links, orientationConstraints, previous, next });
  builder.orientUnitPath(sequence, links, orientationConstraints, 10, previous, next);
  assert.deepEqual({ sequence, links, orientationConstraints, previous, next }, orientationInput);
  assertResult(builder.buildPath(options), cells, constraints);
  assert.deepEqual(options, original);
});

test("3259-cross fixture has nine eight-connected zones, 345 orthogonal groups, and valid monotonic reports", () => {
  const fixture = require("../data/examples/grands-ilots.pattern.json");
  const cells = fixture.grid.cells.filter(cell => !cell.empty);
  const before = structuredClone(cells);
  assert.equal(cells.length, 3259);
  assert.equal(model.createZones(cells).zones.length, 9);
  const expectedGroups = components(cells);
  assert.equal(expectedGroups.length, 345);
  assert.deepEqual(canonicalGroups(builder.orthogonalComponents(cells)), canonicalGroups(expectedGroups));
  let previousProgress = -1, previousCompleted = 0, reports = 0, pathReports = 0;
  const result = builder.buildPath({ points: cells, cutThreshold: 10 }, snapshot => {
    reports++;
    assert.ok(Number.isFinite(snapshot.progress) && snapshot.progress >= 0 && snapshot.progress <= 100);
    assert.ok(snapshot.progress >= previousProgress, "reported progress never goes backwards");
    previousProgress = snapshot.progress;
    assert.equal(snapshot.zone.total, 345, "progress counts scheduled orthogonal groups");
    assert.equal(snapshot.metrics.zoneCount, 9, "metrics retain the eight-connected zone count");
    assert.ok(Number.isInteger(snapshot.zone.completed) && snapshot.zone.completed >= previousCompleted
      && snapshot.zone.completed <= 345, "completed groups are monotonic and bounded");
    previousCompleted = snapshot.zone.completed;
    if (snapshot.path) {
      pathReports++;
      assertPhysicalPath(snapshot.path, cells, snapshot.unitLinks, "reported partial path", false);
      if (snapshot.metrics) assertMetrics(snapshot.metrics, snapshot.path, 10, "partial metrics");
    }
  });
  assertResult(result, cells);
  assert.equal(result.zone.total, 345);
  assert.equal(result.diagnostics.groups, 345);
  assert.equal(result.path.length, 6518);
  assert.equal(result.unitLinks.filter(Boolean).length, 6173, "every internal group link keeps its exact-unit guarantee");
  assert.ok(result.diagnostics.entryExitChanges > 0, "real fixture exercises changed group endpoints");
  assert.ok(reports > 1 && pathReports > 0, "report the construction and final result");
  assert.equal(previousProgress, 100);
  assert.equal(previousCompleted, 345);
  assert.deepEqual(cells, before, "real fixture is not mutated");
});

test("throttled reports expose valid partial paths and monotonic progress independently of machine speed", () => {
  let now = 0;
  const reportingBuilder = createOrthogonalPathBuilder(model, () => { now += 200; return now; });
  const cells = [...rectangle(3, 2), ...rectangle(2, 2, 10, 3), { x: 11, y: 5 }, { x: 12, y: 6 }];
  let progress = -1, completed = 0, partials = 0;
  const total = components(cells).length;
  const result = reportingBuilder.buildPath({ points: cells }, snapshot => {
    assert.ok(snapshot.progress >= progress && snapshot.progress <= 100);
    assert.equal(snapshot.zone.total, total);
    assert.ok(snapshot.zone.completed >= completed && snapshot.zone.completed <= total);
    progress = snapshot.progress;
    completed = snapshot.zone.completed;
    if (!snapshot.path) return;
    assertPhysicalPath(snapshot.path, cells, snapshot.unitLinks, "timed partial report", false);
    assertMetrics(snapshot.metrics, snapshot.path, 10, "timed partial metrics");
    if (snapshot.path.length > 0 && snapshot.path.length < cells.length * 2) partials++;
  });
  assertResult(result, cells);
  assert.ok(partials > 0, "a consumer receives a valid unfinished route");
  assert.equal(progress, 100);
  assert.equal(completed, total);
});

test("empty input completes synchronously without fabricated groups or stitches", () => {
  const result = builder.buildPath({ points: [] });
  assertResult(result, []);
  assert.deepEqual(result.path, []);
  assert.deepEqual(result.unitLinks, []);
  assert.equal(result.zone.total, 0);
  assert.equal(result.diagnostics.groups, 0);
  assert.deepEqual(builder.orientUnitPath([], []), { path: [], score: 0 });
});

test("the first stoppable preview already applies forced cuts inside its locked prefix", () => {
  const cells = rectangle(3, 2), initial = model.expandCells(cells);
  const constraints = { lockedPrefix: initial.slice(0, 2), forcedCuts: [initial[1]] };
  let first;
  builder.buildPath({ points: cells, constraints }, snapshot => { first ||= snapshot; });
  assert.equal(first.path.length, 2);
  assert.equal(first.path[1].cutBefore, true);
  assert.ok(model.satisfiesConstraints(first.path, constraints));
  assert.equal(constraints.lockedPrefix[1].cutBefore, undefined, "the user's prefix is not mutated");
});

test("a 160000-cell group's bounds do not exceed the JavaScript argument limit", () => {
  const cells = rectangle(400, 400), stop = new Error("stop after group bounds");
  let ticks = 0, bounds;
  const engine = createOrthogonalPathBuilder(model, () => { ticks += 200; return ticks; });
  assert.throws(() => engine.buildPath({ points: cells }, snapshot => {
    if (snapshot.zone.status === "running") { bounds = snapshot.zone.bounds; throw stop; }
  }), error => error === stop);
  assert.deepEqual(bounds, { minX: 0, minY: 0, maxX: 400, maxY: 400 });
});

test("a 12000-cell chain does not overflow the component, DFS, orientation, or build stacks", () => {
  const cells = rectangle(12000, 1);
  const groups = builder.orthogonalComponents(cells);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, cells.length);
  const sequence = builder.buildSequence(cells, cells[0]);
  assertSequence(sequence, cells, cells[0]);
  const result = builder.buildPath({ points: cells });
  assertResult(result, cells);
  assert.equal(result.diagnostics.groups, 1);
  assert.ok(result.unitLinks.slice(1).every(Boolean));
});
