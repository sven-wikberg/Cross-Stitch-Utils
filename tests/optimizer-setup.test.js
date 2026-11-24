const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder: builder } = require("../src/orthogonal-path-worker.js");
const { createBlockOptimizer: blocks } = require("../src/block-optimizer-worker.js");
const { createRelaySearch: relay } = require("../src/relay-search.js");
const { createPointOrderSearch: points } = require("../src/point-order-search.js");
const { createAdaptiveOptimizer: adaptive } = require("../src/adaptive-optimizer-worker.js");
const { createPointsDiagonalOptimizer: diagonals } = require("../src/points-diagonals-worker.js");
const { createSectionOptimizer: sections } = require("../src/section-optimizer-worker.js");
const { createSegmentOptimizer: segments } = require("../src/segment-optimizer-worker.js");
const { createDeepOptimizer: deep, createLnsSearch: lns } = require("../src/deep-optimizer-worker.js");
const cells = require("./fixtures/combined-search.js").interleaved;
const seeded = () => { let s = 31; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); };
const factories = {
  M2: clock => segments(model, builder, relay, clock, seeded()),
  M3: clock => diagonals(model, points, builder, relay, adaptive, clock, seeded()),
  M4: clock => sections(model, builder, clock),
  M5: clock => adaptive(model, builder, relay, clock, seeded(), blocks),
  M6: clock => deep(model, builder, blocks, relay, lns, clock, seeded())
};

for (const [name, factory] of Object.entries(factories)) {
  test(`${name} finishes slow setup then receives the full inactivity interval`, () => {
    let now = 0, delayed = false; const reports = [], limit = 300;
    const initialPath = model.expandCells(cells, 3), before = JSON.stringify(initialPath);
    const result = factory(() => ++now).optimizePath({ points: cells, initialPath, cutThreshold: 3,
      stopAfterInactivity: true, stagnationLimitMs: limit, totalLimitMs: 1 }, snapshot => {
      reports.push(snapshot);
      if (snapshot.preparing && !delayed) { now += 10000; delayed = true; }
    });
    assert.ok(delayed);
    const ready = reports.find(s => !s.preparing);
    assert.ok(ready && ready.stage !== "complete", "The search starts instead of immediately switching engines");
    assert.ok(ready.preparationMs >= 10000);
    assert.ok(ready.lastImprovementMs < 3 && ready.remainingMs >= limit - 2);
    assert.ok(reports.filter(s => s.preparing).every(s => s.lastImprovementMs === 0 && s.remainingMs === limit));
    assert.ok(reports.filter(s => !s.preparing).every(s => s.preparationMs === ready.preparationMs), "Setup is excluded only once, not on every internal phase change");
    assert.ok(result.elapsedMs - result.preparationMs >= limit);
    assert.ok(result.attempts > 0); assert.equal(result.reason, "inactivity");
    assert.equal(model.validateRoute(result.path, cells), "");
    assert.ok(result.metrics.score <= model.metrics(initialPath, 3, true).score);
    assert.equal(JSON.stringify(initialPath), before);
  });
}

test("the point-order engine excludes distances, neighbors and seeds before calling onReady once", () => {
  const data = Array.from({ length: 120 }, (_, i) => ({ x: i % 12 * 3, y: Math.floor(i / 12) * 4 }));
  for (const excludeSetupTime of [false, true]) {
    let now = 0, ready = 0, offered = 0; const reports = [];
    const options = { points: data, totalLimitMs: 1, excludeSetupTime,
      onReady: () => { ready++; assert.ok(now > 1); },
      onCandidate: route => { offered++; assert.equal(ready, 1); assert.equal(new Set(route).size, data.length); },
      onProgress: snapshot => reports.push(snapshot) };
    const search = points(() => now += 250, seeded());
    if (!excludeSetupTime) {
      assert.throws(() => search.optimizePath(options), /POINT_SEARCH_TIMEOUT/); assert.equal(ready, 0);
    } else {
      const result = search.optimizePath(options);
      assert.equal(ready, 1); assert.ok(offered > 0);
      assert.equal(result.route.length, data.length);
      assert.ok(reports.some(s => s.preparing && s.phase === "Calcul des distances"));
      assert.ok(reports.some(s => s.preparing && s.phase === "Voisinages"));
      assert.ok(reports.filter(s => s.preparing).every(s => s.lastImprovementMs === 0));
    }
  }
});

test("M3 waits for point-order setup before arming its own deadline", () => {
  let now = 0, setupSeen = false; const reports = [];
  const slowPoints = () => ({ optimizePath(options) {
    assert.equal(options.excludeSetupTime, true); now += 20000;
    options.onProgress({ phase: "Voisinages", preparing: true, evaluations: 0, restarts: 0 });
    setupSeen = true; options.onReady();
    return { route: cells.map((_, i) => i) };
  } });
  const clock = () => ++now;
  const search = diagonals(model, slowPoints, builder, relay, adaptive, clock, seeded());
  const result = search.optimizePath({ points: cells, initialPath: model.expandCells(cells, 3), cutThreshold: 3,
    stopAfterInactivity: true, stagnationLimitMs: 300 }, s => reports.push(s));
  assert.ok(setupSeen);
  const neighbors = reports.find(s => s.phase === "Points : voisinages");
  assert.ok(neighbors.preparing); assert.equal(neighbors.lastImprovementMs, 0);
  const ready = reports.find(s => !s.preparing);
  assert.ok(ready.preparationMs >= 20000 && ready.lastImprovementMs < 3);
  assert.ok(result.elapsedMs - result.preparationMs >= 300);
  assert.ok(result.pointsSearch.refinements > 0);
});
