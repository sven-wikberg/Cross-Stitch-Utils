const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createRelaySearch } = require("../src/relay-search.js");
const { createBlockOptimizer } = require("../src/block-optimizer-worker.js");
const { createRegionOptimizer } = require("../src/region-optimizer-worker.js");
const { createPathVisuals } = require("../src/path-visuals.js");
const builder = createOrthogonalPathBuilder(model), search = createRelaySearch(model, builder, () => 0);
const score = (path, threshold = 10) => model.metrics(path, threshold, true).score;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const seeded = () => { let s = 31; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); };

test("relay transfers match every orientation, including source repair, cuts and fixed outside directions", () => {
  const cells = [0, 6, 2, 4].map(x => ({ x, y: 1 }));
  for (const threshold of [2, 10]) for (const region of [null, { minX: 2, minY: 0, maxX: 7, maxY: 3 }]) {
    const path = model.expandCells(cells, threshold); path[5].cutBefore = true;
    const before = JSON.stringify(path), constraints = { start: path[0], forcedCuts: [path[5]] };
    const candidates = [...search.candidates({ path, constraints, cutThreshold: threshold, region })];
    assert.ok(candidates.some(c => c.kind === "relocate") && candidates.some(c => c.kind === "swap"));
    for (const candidate of candidates) {
      const route = candidate.materialize();
      if (!route) { assert.equal(candidate.score, Infinity); continue; }
      assert.equal(model.validateRoute(route.path, cells), "");
      assert.ok(model.satisfiesConstraints(route.path, constraints));
      let oracle = Infinity;
      for (let mask = 0; mask < 2 ** path.length; mask++) {
        const variant = route.path.map((p, i) => ({ ...p, direction: mask & (1 << i) ? -1 : 1 }));
        if (model.validateRoute(variant, cells) || !model.satisfiesConstraints(variant, constraints)) continue;
        if (region && path.some((p, i) => p.x < 2 && JSON.stringify(p) !== JSON.stringify(variant[i]))) continue;
        oracle = Math.min(oracle, score(variant, threshold));
      }
      close(candidate.score, oracle); close(candidate.score, score(route.path, threshold));
    }
    assert.equal(JSON.stringify(path), before);
    assert.ok(candidates.some(c => c.score >= score(path, threshold)), "nearby relays are not automatically improvements");
  }
});

test("a one-diagonal relay breaks a block-search plateau, then ordinary optimization resumes", () => {
  const points = require("./fixtures/combined-search.js").cutAware, reports = [];
  const result = createBlockOptimizer(model, createOrthogonalPathBuilder, () => 0, seeded()).optimizePath(
    { points, cutThreshold: 3, stagnationLimitMs: 1 }, s => reports.push(s));
  const firstPlateau = reports.find(s => s.stage === "relay");
  close(firstPlateau.metrics.score, 49.38905042258274);
  assert.ok(result.metrics.score < firstPlateau.metrics.score - 8);
  assert.ok(result.relayImprovements >= 2 && result.relayPasses > result.relayImprovements);
  assert.equal(result.metrics.cuts, 1);
  assert.ok(reports.some(s => s.relayChange?.length === 1), "one half-cross is enough to unlock the improvement");
  for (let i = 1; i < reports.length; i++) {
    const a = reports[i - 1], b = reports[i];
    if (a.metrics && b.metrics && a.stage !== "construction") assert.ok(b.metrics.score <= a.metrics.score + 1e-8);
    if (b.relayImprovements > (a.relayImprovements || 0)) {
      assert.ok(reports.slice(i + 1).some(s => s.stage === "search" && s.relayImprovements >= b.relayImprovements));
      assert.ok(b.lastImprovementMs <= 1);
    }
    if (b.path && b.stage !== "construction") assert.equal(model.validateRoute(b.path, points), "");
  }
});

test("rectangular relays can swap between visits without moving or reorienting any outside action", () => {
  const points = [[6, 1], [3, 5], [0, 0], [8, 3], [2, 2], [4, 3]].map(([x, y]) => ({ x, y }));
  const initialPath = model.expandCells(points), original = JSON.stringify(initialPath);
  const region = { minX: 2, minY: 1, maxX: 7, maxY: 6 };
  let time = 0;
  const api = createRegionOptimizer(model, createOrthogonalPathBuilder, () => ++time, seeded());
  const runs = api.selection(initialPath, region).runs;
  assert.equal(runs.length, 2);
  const result = api.optimizePath({ points, initialPath, region, stagnationLimitMs: 300 }, snapshot => {
    if (!snapshot.path) return;
    assert.ok(api.preservesOutside(initialPath, snapshot.path, region));
    assert.equal(model.validateRoute(snapshot.path, points), "");
  });
  assert.ok(result.relayImprovements > 0);
  assert.ok(runs.some(run => initialPath.slice(run.start, run.end).map(model.key).sort().join()
    !== result.path.slice(run.start, run.end).map(model.key).sort().join()));
  assert.equal(JSON.stringify(initialPath), original);
});

test("relay scans respect locks and a separate deadline, and report actual examined links", () => {
  const points = Array.from({ length: 30 }, (_, i) => ({ x: (i * 7) % 31, y: i % 4 })), path = model.expandCells(points);
  assert.equal([...search.candidates({ path, constraints: { lockedPrefix: path } })].length, 0);
  let time = 0; const reports = [];
  [...createRelaySearch(model, builder, () => time += 10).candidates({ path, budgetMs: 30 }, p => reports.push(p))];
  assert.equal(reports.at(-1).timedOut, true);
  assert.ok(reports.at(-1).examined < reports.at(-1).total);
  const view = createPathVisuals(model, builder).searchPresentation({ stage: "relay", relay: { examined: 4, total: 12 } }, true);
  assert.equal(view.phase, "Recherche de relais"); assert.equal(view.label, "Liaisons examinees");
  assert.equal(view.value, 4); assert.equal(view.max, 12); assert.ok(view.active && !view.searching);
  assert.equal(createPathVisuals(model, builder).searchPresentation({ stage: "relay" }, false).active, false);
});
