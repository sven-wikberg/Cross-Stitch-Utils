const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Worker } = require("node:worker_threads");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createRegionOptimizer } = require("../src/region-optimizer-worker.js");
function engine(tick = 1) {
  let time = 0, seed = 31;
  return createRegionOptimizer(model, createOrthogonalPathBuilder, () => time += tick,
    () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32));
}
const rect = { minX: 2, minY: 1, maxX: 6, maxY: 5 };
const cells = [{ x: 0, y: 2 }, { x: 5, y: 2 }, { x: 2, y: 2 }, { x: 8, y: 2 }];
const score = (route, threshold = 10) => model.metrics(route, threshold, true).score;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function* permutations(values) {
  if (!values.length) { yield []; return; }
  for (let i = 0; i < values.length; i++) for (const rest of permutations(values.filter((_, j) => i !== j))) yield [values[i], ...rest];
}
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test("rectangles snap in either drag direction, clamp to the grid and exclude the far boundary", () => {
  const api = engine();
  assert.deepEqual(api.rectangle({ x: 5.9, y: 7.2 }, { x: 2.1, y: 3 }, 10, 10), { minX: 2, minY: 3, maxX: 6, maxY: 8 });
  assert.deepEqual(api.rectangle({ x: -10, y: -3 }, { x: 100, y: 40 }, 10, 8), { minX: 0, minY: 0, maxX: 10, maxY: 8 });
  assert.ok(api.contains(rect, { x: 2, y: 1 }));
  assert.equal(api.contains(rect, { x: 6, y: 1 }), false);
});

test("local optimization matches an exhaustive boundary-aware oracle and keeps outside actions byte-identical", () => {
  for (const threshold of [2, 10]) {
    const initialPath = model.expandCells(cells, threshold);
    initialPath.at(-1).cutBefore = true;
    initialPath[0].note = "outside metadata";
    const api = engine(), constraints = { start: initialPath[0], forcedCuts: [initialPath.at(-1)] };
    const options = freeze({ points: cells, initialPath, constraints, cutThreshold: threshold, region: rect, stagnationLimitMs: 100000 });
    const original = JSON.stringify(options), span = api.selection(initialPath, rect, constraints).runs[0];
    let oracle = Infinity;
    for (const order of permutations(initialPath.slice(span.start, span.end))) {
      for (let mask = 0; mask < 2 ** order.length; mask++) {
        const route = initialPath.slice();
        order.forEach((p, i) => { route[span.start + i] = { ...p, direction: mask & (1 << i) ? -1 : 1 }; });
        if (!model.validateRoute(route, cells) && model.satisfiesConstraints(route, constraints)) oracle = Math.min(oracle, score(route, threshold));
      }
    }
    let previous = initialPath, previousScore = score(initialPath, threshold), reports = 0;
    const result = api.optimizePath(options, snapshot => {
      if (!snapshot.path) return;
      assert.equal(model.validateRoute(snapshot.path, cells), "");
      assert.ok(model.satisfiesConstraints(snapshot.path, constraints));
      assert.ok(api.preservesOutside(initialPath, snapshot.path, rect, constraints));
      close(snapshot.metrics.score, score(snapshot.path, threshold));
      if (JSON.stringify(previous) !== JSON.stringify(snapshot.path)) assert.ok(snapshot.metrics.score < previousScore - 1e-8);
      previous = snapshot.path; previousScore = snapshot.metrics.score; reports++;
    });
    close(result.metrics.score, oracle);
    assert.ok(result.metrics.score < score(initialPath, threshold), "fixture includes a genuine global gain");
    assert.ok(reports >= 2);
    assert.equal(JSON.stringify(options), original);
  }
});

test("multiple visits can exchange selected actions while outside slots, prefix locks and cuts remain fixed", () => {
  const points = [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 10, y: 2 }, { x: 4, y: 3 }];
  const a = (i, diagonal) => ({ ...points[i], diagonal, direction: 1 });
  const sequence = [a(0, "lower"), a(0, "upper"), a(1, "lower"), a(2, "lower"),
    a(3, "lower"), a(3, "upper"), a(2, "upper"), a(4, "lower"), a(4, "upper"), a(1, "upper")];
  const initialPath = model.orient(sequence, 3, {}, true);
  initialPath[7].cutBefore = true;
  const constraints = { lockedPrefix: initialPath.slice(0, 3), start: initialPath[0], forcedCuts: [initialPath[7]] };
  const api = engine(), selected = api.selection(initialPath, rect, constraints);
  assert.equal(selected.runs.length, 2);
  const result = api.optimizePath({ points, initialPath, constraints, cutThreshold: 3, region: rect, stagnationLimitMs: 100000 });
  assert.ok(api.preservesOutside(initialPath, result.path, rect, constraints));
  assert.deepEqual(result.path.slice(0, 3), initialPath.slice(0, 3));
  assert.ok(model.satisfiesConstraints(result.path, constraints));
  assert.equal(model.validateRoute(result.path, points), "");
  assert.ok(result.metrics.score <= score(initialPath, 3));
  const bad = result.path.map(p => ({ ...p })); bad[4].direction *= -1;
  assert.equal(api.preservesOutside(initialPath, bad, rect, constraints), false);
  const swapped = result.path.slice(); [swapped[3], swapped[6]] = [swapped[6], swapped[3]];
  assert.equal(api.preservesOutside(initialPath, swapped, rect, constraints), true);
});

test("a rectangle cutting through one orthogonal block does not expand the selection", () => {
  const points = Array.from({ length: 12 }, (_, i) => ({ x: i % 6, y: Math.floor(i / 6) }));
  const region = { minX: 2, minY: 0, maxX: 4, maxY: 2 }, initialPath = model.expandCells(points);
  const api = engine();
  assert.equal(createOrthogonalPathBuilder(model).orthogonalComponents(points).length, 1);
  const result = api.optimizePath({ points, initialPath, region, stagnationLimitMs: 1000 });
  assert.equal(result.region.crosses, 4);
  assert.ok(api.preservesOutside(initialPath, result.path, region));
  assert.equal(model.validateRoute(result.path, points), "");
});

test("a free route start may eliminate the cost, but not the marker, of a forced cut", () => {
  const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }], initialPath = model.expandCells(points);
  initialPath[2].cutBefore = true;
  const constraints = { forcedCuts: [initialPath[2]] }, region = { minX: 0, minY: 0, maxX: 2, maxY: 1 };
  const result = engine().optimizePath({ points, initialPath, constraints, region, stagnationLimitMs: 100000 });
  close(result.metrics.score, 3);
  assert.ok(result.path[0].cutBefore);
  assert.ok(model.satisfiesConstraints(result.path, constraints));
});

test("seeded larger searches stop on inactivity, reset only on improvements and retain the best full score", () => {
  const points = Array.from({ length: 18 }, (_, i) => ({ x: 2 + i % 6 * 2, y: 2 + Math.floor(i / 6) * 2 }));
  const initialPath = model.expandCells(points), region = { minX: 2, minY: 2, maxX: 13, maxY: 7 };
  const api = engine(10), limit = 1000; let previous = null;
  const result = api.optimizePath({ points, initialPath, region, stagnationLimitMs: limit }, snapshot => {
    if (previous && previous.improvements === snapshot.improvements) assert.ok(snapshot.lastImprovementMs >= previous.lastImprovementMs);
    if (snapshot.path) assert.ok(api.preservesOutside(initialPath, snapshot.path, region));
    previous = snapshot;
  });
  assert.ok(result.lastImprovementMs >= limit || result.metrics.score <= initialPath.length - 1 + 1e-8);
  assert.ok(result.attempts > 0 && result.attempts < 10000);
  assert.equal(model.validateRoute(result.path, points), "");
  assert.ok(result.metrics.score <= score(initialPath));
});

test("empty, invalid, incomplete and fully locked selections fail without mutating the original", () => {
  const api = engine(), initialPath = model.expandCells(cells), original = JSON.stringify(initialPath);
  const options = { points: cells, initialPath, region: rect };
  assert.throws(() => api.optimizePath({ ...options, region: { ...rect, maxX: 2 } }), /Selection invalide/);
  assert.throws(() => api.optimizePath({ ...options, initialPath: initialPath.slice(0, 2) }), /deux diagonales/);
  assert.throws(() => api.optimizePath({ ...options, constraints: { lockedPrefix: initialPath } }), /Aucune diagonale/);
  assert.throws(() => api.optimizePath({ ...options, region: { minX: 100, minY: 100, maxX: 110, maxY: 110 } }), /Aucune diagonale/);
  assert.equal(JSON.stringify(initialPath), original);
});

test("seeded rectangles retain every outside slot across varied paths, cut thresholds and prefix lengths", () => {
  let seed = 73;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let run = 0; run < 30; run++) {
    const points = Array.from({ length: 25 }, (_, i) => ({ x: i % 5, y: Math.floor(i / 5) })).filter(() => random() > 0.2);
    for (let i = points.length - 1; i; i--) { const j = Math.floor(random() * (i + 1)); [points[i], points[j]] = [points[j], points[i]]; }
    const threshold = run % 2 ? 2 : 10, initialPath = model.expandCells(points, threshold), api = engine();
    initialPath[Math.min(5, initialPath.length - 1)].cutBefore = true;
    const constraints = { lockedPrefix: initialPath.slice(0, run % 5), forcedCuts: initialPath.filter(p => p.cutBefore) };
    const region = api.rectangle({ x: random() * 4, y: random() * 4 }, { x: 1 + random() * 4, y: 1 + random() * 4 }, 5, 5);
    if (!api.selection(initialPath, region, constraints).diagonals) continue;
    let previous = score(initialPath, threshold);
    const result = api.optimizePath({ points, initialPath, constraints, cutThreshold: threshold, region, stagnationLimitMs: 500 }, snapshot => {
      if (!snapshot.path) return;
      assert.ok(api.preservesOutside(initialPath, snapshot.path, region, constraints));
      assert.equal(model.validateRoute(snapshot.path, points), "");
      assert.ok(model.satisfiesConstraints(snapshot.path, constraints));
      assert.ok(snapshot.metrics.score <= previous + 1e-8);
      previous = snapshot.metrics.score;
    });
    close(result.metrics.score, score(result.path, threshold));
  }
});

test("the actual regional browser worker returns a full valid path and preserves its run id", async () => {
  const context = vm.createContext({ Blob: class { constructor(parts) { this.source = parts.join(""); } },
    URL: { createObjectURL: value => value, revokeObjectURL() {} }, Worker: class { constructor(blob) { this.source = blob.source; } } });
  for (const file of ["stitch-model.js", "orthogonal-path-worker.js", "relay-search.js", "region-optimizer-worker.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), context);
  }
  const source = context.createRegionOptimizerWorker().source;
  const worker = new Worker('const {parentPort}=require("node:worker_threads"); global.self={postMessage:m=>parentPort.postMessage(m)};'
    + source + ';parentPort.on("message", data=>self.onmessage({data}));', { eval: true });
  let timeout;
  try {
    const initialPath = model.expandCells(cells);
    const result = await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("regional worker timeout")), 10000);
      worker.on("error", reject);
      worker.on("message", message => {
        if (message.type === "error") reject(new Error(message.message));
        if (message.type === "complete") resolve(message);
      });
      worker.postMessage({ type: "start", runId: "region-test", points: cells, initialPath, region: rect, stagnationLimitMs: 100 });
    });
    assert.equal(result.runId, "region-test");
    assert.equal(result.method, "region-optimization");
    assert.ok(engine().preservesOutside(initialPath, result.path, rect));
    assert.equal(model.validateRoute(result.path, cells), "");
  } finally { clearTimeout(timeout); await worker.terminate(); }
});
