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

test("a one-diagonal relay breaks a block-search plateau, then ordinary optimization resumes", () => {
  const points = require("./fixtures/combined-search.js").cutAware, reports = [];
  const result = createBlockOptimizer(model, createOrthogonalFixtureBuilder, () => 0, seeded()).optimizePath(
    { points, cutThreshold: 3, stagnationLimitMs: 1 }, s => reports.push(s));
  const firstPlateau = reports.find(s => s.stage === "relay");
  close(firstPlateau.metrics.score, 49.38905042258274);
  assert.ok(result.metrics.score < firstPlateau.metrics.score - 8);
  assert.ok(result.relayImprovements >= 2 && result.relayPasses > result.relayImprovements);
  assert.ok(result.lastRelayImprovement.pass < result.relayPasses, "A later unsuccessful pass retains the last accepted relay");
  assert.equal(result.metrics.cuts, 1);
  assert.ok(reports.some(s => s.relayChange?.length === 1), "one half-cross is enough to unlock the improvement");
  for (let i = 1; i < reports.length; i++) {
    const a = reports[i - 1], b = reports[i];
    if (a.metrics && b.metrics && a.stage !== "construction") assert.ok(b.metrics.score <= a.metrics.score + 1e-8);
    if (b.relayImprovements > (a.relayImprovements || 0)) {
      assert.equal(b.lastRelayImprovement.pass, b.relayPasses);
      assert.ok(b.lastRelayImprovement.rank >= 1 && b.lastRelayImprovement.rank <= b.lastRelayImprovement.total);
      assert.ok(b.lastRelayImprovement.length > Math.SQRT2);
      assert.ok(reports.slice(i + 1).some(s => s.stage === "search" && s.relayImprovements >= b.relayImprovements));
      assert.ok(b.lastImprovementMs <= 1);
    } else assert.deepEqual(b.lastRelayImprovement || null, a.lastRelayImprovement || null,
      "Scanning, ordinary improvements and restarts cannot overwrite the last accepted relay");
    if (b.path && b.stage !== "construction") assert.equal(model.validateRoute(b.path, points), "");
  }
  assert.deepEqual(result.lastRelayImprovement, reports.at(-1).lastRelayImprovement);
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

test("accepted relays shorten block inactivity by ten percent down to zero, with fresh runs", () => {
  const points = require("./fixtures/combined-search.js").cutAware, budgets = [];
  const engine = createBlockOptimizer(model, createOrthogonalPathBuilder, () => 0, seeded(), (...args) => {
    const relaySearch = createRelaySearch(...args);
    return { candidates(options, report) {
      budgets.push(options.budgetMs);
      return relaySearch.candidates(options, report);
    } };
  });
  for (const initialLimit of [10000, 10000, 2100, 1]) {
    const reports = [], firstBudget = budgets.length;
    const result = engine.optimizePath({ points, cutThreshold: 3, stagnationLimitMs: initialLimit }, s => reports.push(s));
    assert.equal(reports[0].stagnationLimitMs, initialLimit, "each run starts with the full selected delay");
    assert.equal(reports.find(s => s.stage === "relay").stagnationLimitMs, initialLimit);
    assert.ok(result.relayImprovements >= 2, "exercise consecutive accepted relays");
    let ordinaryGain = false, expected = initialLimit;
    for (let i = 0; i < reports.length; i++) {
      const current = reports[i], previous = reports[i - 1];
      const relayGains = (current.relayImprovements || 0) - (previous?.relayImprovements || 0);
      const normalGains = current.improvements - (previous?.improvements || 0) - relayGains;
      if (normalGains > 0) ordinaryGain = true;
      for (let n = 0; n < relayGains; n++) expected = Math.max(0, Math.floor(expected * 0.9));
      close(current.stagnationLimitMs, expected);
      assert.ok(Number.isFinite(current.progress), "zero delay never produces invalid progress");
      if (previous) {
        assert.ok(current.stagnationLimitMs <= previous.stagnationLimitMs, "the delay never increases within a run");
        if (!relayGains) assert.equal(current.stagnationLimitMs, previous.stagnationLimitMs, "ordinary gains and attempts keep the reduced delay");
      }
    }
    assert.ok(ordinaryGain);
    assert.equal(budgets.length - firstBudget, result.relayPasses);
    assert.ok(budgets.slice(firstBudget).every(budget => budget === Math.min(15000, Math.max(250, initialLimit))),
      "relay scans keep the initial budget even after successful relays");
    if (initialLimit === 2100) assert.ok(result.stagnationLimitMs < 2000);
    if (initialLimit === 1) {
      assert.equal(result.stagnationLimitMs, 0);
      assert.ok(result.relayImprovements >= 2, "relay search continues after the delay reaches zero");
    }
    assert.equal(model.validateRoute(result.path, points), "");
  }
});

test("a normal global gain resets inactivity but keeps the reduced limit for subsequent relays", () => {
  const points = require("./fixtures/combined-search.js").timerRecovery;
  for (const initialLimit of [10000, 2100]) {
    const reports = [];
    const result = createBlockOptimizer(model, createOrthogonalFixtureBuilder, () => 0, seeded()).optimizePath(
      { points, cutThreshold: 3, stagnationLimitMs: initialLimit }, s => reports.push(s));
    let normalGain = false, decayedAgain = false;
    for (let i = 1; i < reports.length; i++) {
      const previous = reports[i - 1], current = reports[i];
      const relayGains = (current.relayImprovements || 0) - (previous.relayImprovements || 0);
      if (!relayGains && current.improvements > previous.improvements && previous.stagnationLimitMs < initialLimit) {
        assert.ok(current.metrics.score < previous.metrics.score);
        assert.equal(current.stagnationLimitMs, previous.stagnationLimitMs);
        assert.equal(current.lastImprovementMs, 0);
        assert.equal(current.relayImprovements, 2, "total relay history is retained");
        assert.deepEqual(current.lastRelayImprovement, previous.lastRelayImprovement);
        if (initialLimit === 2100) assert.ok(current.stagnationLimitMs < 2000, "a normal gain keeps the delay below the former floor");
        normalGain = true;
      } else if (normalGain && relayGains) {
        assert.equal(relayGains, 1);
        close(current.stagnationLimitMs, Math.floor(previous.stagnationLimitMs * 0.9));
        assert.equal(current.relayImprovements, 3);
        decayedAgain = true;
      }
      assert.ok(current.stagnationLimitMs <= previous.stagnationLimitMs);
    }
    assert.ok(normalGain && decayedAgain, "exercise relay, normal gain, then another relay with the real optimizer");
    assert.equal(model.validateRoute(result.path, points), "");
  }
});
