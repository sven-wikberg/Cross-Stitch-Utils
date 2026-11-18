const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createRelaySearch } = require("../src/relay-search.js");
const builder = createOrthogonalPathBuilder(model), search = createRelaySearch(model, builder, () => 0);
const cell = (x, y) => ({ x, y });
const threshold = 1000000;

function makePath(cells, at = 2) {
  const path = model.expandCells(cells, threshold);
  path[at - 1].direction = 1; path[at].direction = 1;
  path[at].cutBefore = true; // Examine this link first, regardless of its geometric length.
  assert.equal(model.validateRoute(path, cells), "");
  return path;
}

function proposalsFor(path, at = 2, constraints = {}, api = search) {
  const proposals = [];
  for (const candidate of api.candidates({ path, cutThreshold: threshold, constraints })) {
    if (candidate.link !== at) break;
    proposals.push(candidate);
  }
  return proposals;
}

function bruteForce(path, at, constraints = {}) {
  const locked = Math.max(constraints.lockedPrefix?.length || 0, Number(Boolean(constraints.start)));
  const a = model.holes(path[at - 1]).end, b = model.holes(path[at]).start;
  const maximum = Math.max(2.5, model.distance(path[at - 1], path[at]) / 2);
  const sources = path.map((point, i) => {
    const holes = model.holes(point);
    return { i, distance: Math.min(search.segmentDistance(holes.start, a, b), search.segmentDistance(holes.end, a, b)) };
  }).filter(p => p.i >= locked && p.i !== at && p.i !== at - 1 && p.distance <= maximum)
    .sort((a, b) => a.distance - b.distance || a.i - b.i).slice(0, 64).map(p => p.i);
  const valid = order => {
    const positions = new Map(order.map((i, rank) => [model.key(path[i]), rank]));
    return path.every(p => p.diagonal !== "lower" || positions.get(model.key(p)) < positions.get(`${model.cellKey(p)}:upper`));
  };
  const expected = [];
  for (const from of sources) {
    const order = path.map((_, i) => i), moved = order.filter(i => i !== from);
    moved.splice(moved.indexOf(at), 0, from);
    if (at >= locked && valid(moved)) expected.push(`relocate:${from}:${at}`);
    for (const to of [at - 1, at]) {
      if (to < locked) continue;
      const swapped = order.slice(); [swapped[from], swapped[to]] = [swapped[to], swapped[from]];
      if (valid(swapped)) expected.push(`swap:${from}:${to}`);
    }
  }
  return { sources, expected: expected.sort() };
}

function compareQuery(path, at = 2, constraints = {}) {
  const original = JSON.stringify(path), proposals = proposalsFor(path, at, constraints), oracle = bruteForce(path, at, constraints);
  assert.deepEqual(proposals.map(p => `${p.kind}:${p.from}:${p.to}`).sort(), oracle.expected);
  assert.equal(JSON.stringify(path), original);
  assert.ok(new Set(proposals.map(p => p.from)).size <= 64);
  return { proposals, sources: oracle.sources };
}

test("sparse links expand beyond 2.5, cross spatial bins, and include the exact half-length boundary", () => {
  const path = makePath([cell(0, 10), cell(21, 10), cell(10, 14), cell(10, 18), cell(10, 21), cell(10, 22), cell(10, 8)]);
  assert.equal(model.distance(path[1], path[2]), 20);
  const { proposals } = compareQuery(path), selected = new Set(proposals.map(p => p.from));
  for (const i of [4, 6, 8, 12]) assert.ok(selected.has(i), `Missing lower diagonal ${i}`);
  assert.equal(selected.has(10), false, "The diagonal beyond radius 10 is excluded");
});

test("short links keep the minimum radius of 2.5 instead of shrinking to half their length", () => {
  const path = makePath([cell(0, 10), cell(5, 10), cell(2, 13), cell(2, 14)]);
  assert.equal(model.distance(path[1], path[2]), 4);
  const selected = new Set(compareQuery(path).proposals.map(p => p.from));
  assert.ok(selected.has(4)); assert.equal(selected.has(6), false);
});

test("dense neighborhoods keep the nearest 64 distinct diagonals, excluding locked points and link endpoints first", () => {
  const cells = [cell(2, 21), cell(3, 21), cell(0, 20), cell(81, 20),
    ...Array.from({ length: 40 }, (_, i) => cell(i + 1, 20)), cell(40, 25)];
  const path = makePath(cells, 6), constraints = { lockedPrefix: path.slice(0, 6) };
  const { sources } = compareQuery(path, 6, constraints);
  assert.equal(sources.length, 64);
  assert.ok(sources.every(i => i >= 7));
  assert.equal(sources.includes(path.length - 2), false, "No distant candidate displaces a nearer one");
});

test("oblique links, bin boundaries, and sparse distant coordinates match a full geometric scan", () => {
  let seed = 731;
  const random = n => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n);
  for (const [a, b] of [[cell(8, 8), cell(55, 40)], [cell(80, 80), cell(16, 4)], [cell(0, 0), cell(400, 200)]]) {
    const cells = [a, b], used = new Set(cells.map(model.cellKey));
    while (cells.length < 80) {
      const p = cell(random(100), random(100)), key = model.cellKey(p);
      if (!used.has(key)) { used.add(key); cells.push(p); }
    }
    compareQuery(makePath(cells));
  }
});

test("a dense initial corridor stops expansion before probing distant bins", () => {
  const cells = [cell(0, 20), cell(81, 20), ...Array.from({ length: 40 }, (_, i) => cell(i + 1, 20)), cell(40, 35)];
  const path = makePath(cells), probed = new Set();
  const observedModel = { ...model,
    holes: p => { probed.add(model.key(p)); return model.holes(p); },
    cost: (_a, b) => b.cutBefore ? threshold * 3 : 1 };
  const local = createRelaySearch(observedModel, builder, () => 0);
  const iterator = local.candidates({ path, cutThreshold: threshold });
  const count = bruteForce(path, 2).expected.length;
  for (let i = 0; i < count; i++) assert.equal(iterator.next().value.link, 2);
  iterator.return();
  assert.equal(probed.has(model.key(path.at(-2))), false);
  assert.equal(probed.has(model.key(path.at(-1))), false);
});

test("an expanded candidate beyond 2.5 can improve the full score after orientation and source repair", () => {
  const cells = [[23, 13], [24, 19], [3, 17], [12, 2], [11, 6], [8, 18], [8, 17], [23, 23]].map(([x, y]) => cell(x, y));
  const path = model.expandCells(cells), before = model.metrics(path, 10, true).score;
  const candidate = [...search.candidates({ path })].find(c => c.link === 4 && c.from === 14 && c.kind === "relocate");
  assert.ok(candidate);
  const a = model.holes(path[3]).end, b = model.holes(path[4]).start, holes = model.holes(path[14]);
  const distance = Math.min(search.segmentDistance(holes.start, a, b), search.segmentDistance(holes.end, a, b));
  assert.ok(distance > 2.5 && distance <= model.distance(path[3], path[4]) / 2);
  const result = candidate.materialize();
  assert.equal(model.validateRoute(result.path, cells), "");
  const after = model.metrics(result.path, 10, true).score;
  assert.ok(after < before - 1);
  assert.ok(Math.abs(after - candidate.score) < 1e-7);
});

test("expanded collection remains interruptible and does not publish partial neighborhood proposals", () => {
  const cells = [cell(0, 10), cell(201, 10), ...Array.from({ length: 100 }, (_, i) => cell(i + 1, 30))];
  const path = makePath(cells), reports = []; let calls = 0;
  const interrupted = createRelaySearch(model, builder, () => ++calls <= 3 ? 0 : 100);
  const proposals = [...interrupted.candidates({ path, cutThreshold: threshold, budgetMs: 50 }, p => reports.push(p))];
  assert.equal(proposals.length, 0);
  assert.equal(reports.at(-1).timedOut, true);
  assert.ok(reports.at(-1).examined < reports.at(-1).total);
});
