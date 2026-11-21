const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createRelaySearch } = require("../src/relay-search.js");
const { createBlockOptimizer } = require("../src/block-optimizer-worker.js");
const { createOrthogonalFixtureBuilder } = require("./fixtures/orthogonal-builder.js");
const { createPathVisuals } = require("../src/path-visuals.js");
const builder = createOrthogonalPathBuilder(model), search = createRelaySearch(model, builder, () => 0);
const score = (path, threshold = 10) => model.metrics(path, threshold, true).score;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const seeded = () => { let s = 31; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); };

test("relay transfers match every orientation, including source repair, cuts and locked prefix directions", () => {
  const cells = [0, 6, 2, 4].map(x => ({ x, y: 1 }));
  for (const threshold of [2, 10]) for (const prefixLength of [0, 2]) {
    const path = model.expandCells(cells, threshold); path[5].cutBefore = true;
    const before = JSON.stringify(path), constraints = { start: path[0], lockedPrefix: path.slice(0, prefixLength), forcedCuts: [path[5]] };
    const candidates = [...search.candidates({ path, constraints, cutThreshold: threshold })];
    const locked = Math.max(1, prefixLength);
    const links = path.slice(1).map((p, i) => ({ at: i + 1, length: model.distance(path[i], p), cost: model.cost(path[i], p, threshold, true) }))
      .filter(link => link.length > Math.SQRT2 + 1e-8 && link.at >= locked)
      .sort((a, b) => b.cost - a.cost || b.length - a.length || a.at - b.at);
    assert.ok(candidates.some(c => c.kind === "relocate") && candidates.some(c => c.kind === "swap"));
    for (const candidate of candidates) {
      const rank = links.findIndex(link => link.at === candidate.link) + 1;
      assert.deepEqual(candidate.relayLink, { rank, total: links.length, length: links[rank - 1].length });
      const route = candidate.materialize();
      if (!route) { assert.equal(candidate.score, Infinity); continue; }
      assert.equal(model.validateRoute(route.path, cells), "");
      assert.ok(model.satisfiesConstraints(route.path, constraints));
      let oracle = Infinity;
      for (let mask = 0; mask < 2 ** path.length; mask++) {
        const variant = route.path.map((p, i) => ({ ...p, direction: mask & (1 << i) ? -1 : 1 }));
        if (model.validateRoute(variant, cells) || !model.satisfiesConstraints(variant, constraints)) continue;
        oracle = Math.min(oracle, score(variant, threshold));
      }
      close(candidate.score, oracle); close(candidate.score, score(route.path, threshold));
    }
    assert.equal(JSON.stringify(path), before);
    assert.ok(candidates.some(c => c.score >= score(path, threshold)), "nearby relays are not automatically improvements");
  }
});

test("best-per-link evaluates the entire neighborhood instead of accepting its first gain", () => {
  const points = require("./fixtures/combined-search.js").cutAware, path = model.expandCells(points, 3);
  const all = [...search.candidates({ path, cutThreshold: 3 })], best = [...search.bestCandidates({ path, cutThreshold: 3 })];
  let firstIsWorse = false;
  for (const candidate of best) {
    const group = all.filter(c => c.link === candidate.link);
    close(candidate.score, Math.min(...group.map(c => c.score)));
    const firstGain = group.find(c => c.score < score(path, 3) - 1e-8);
    if (firstGain && firstGain.score > candidate.score + 1e-8) firstIsWorse = true;
    const route = candidate.materialize();
    if (route) { assert.equal(model.validateRoute(route.path, points), ""); close(score(route.path, 3), candidate.score); }
  }
  assert.ok(firstIsWorse, "exercise a neighborhood where the first improving move is not its best move");
  assert.equal(new Set(best.map(c => c.link)).size, best.length);
});

test("an interrupted neighborhood never publishes its partially evaluated best candidate", () => {
  const points = require("./fixtures/combined-search.js").cutAware, path = model.expandCells(points, 3);
  let now = 0; const reports = [];
  const best = [...createRelaySearch(model, builder, () => now).bestCandidates({ path, cutThreshold: 3, budgetMs: 50 }, s => {
    reports.push(s);
    if (s.candidatesExamined === 1) now = 100;
  })];
  assert.equal(best.length, 0); assert.equal(reports.at(-1).timedOut, true);
  assert.equal(reports.at(-1).examined, 0);
  assert.ok(reports.at(-1).candidateCount > 1);
});

test("relay scans respect locks and deadlines and expose actual link and candidate counts", () => {
  const points = Array.from({ length: 30 }, (_, i) => ({ x: (i * 7) % 31, y: i % 4 })), path = model.expandCells(points);
  assert.equal([...search.bestCandidates({ path, constraints: { lockedPrefix: path } })].length, 0);
  let time = 0; const reports = [];
  [...createRelaySearch(model, builder, () => time += 10).bestCandidates({ path, budgetMs: 30 }, p => reports.push(p))];
  assert.equal(reports.at(-1).timedOut, true);
  assert.ok(reports.at(-1).examined < reports.at(-1).total);
  const full = [];
  [...search.bestCandidates({ path }, s => full.push(s))];
  assert.equal(full.at(-1).examined, full.at(-1).total);
  assert.ok(full.every(s => s.candidatesExamined <= s.candidateCount && s.candidateCount <= 64));
  const view = createPathVisuals(model, builder).searchPresentation({ stage: "relay", relay: { examined: 4, total: 12 } }, true);
  assert.equal(view.phase, "Recherche de relais"); assert.equal(view.label, "Liaisons examinees");
  assert.equal(view.value, 4); assert.equal(view.max, 12); assert.ok(view.active && !view.searching);
});

test("base block search stops without automatically running relays or changing its selected delay", () => {
  const points = require("./fixtures/combined-search.js").cutAware;
  for (const stagnationLimitMs of [1, 2100, 10000]) {
    const reports = [];
    const result = createBlockOptimizer(model, createOrthogonalFixtureBuilder, () => 0, seeded()).optimizePath(
      { points, cutThreshold: 3, stagnationLimitMs }, s => reports.push(s));
    close(result.metrics.score, 49.38905042258274);
    assert.ok(reports.every(s => s.stage !== "relay" && s.stagnationLimitMs === stagnationLimitMs));
    assert.equal(model.validateRoute(result.path, points), "");
  }
});
