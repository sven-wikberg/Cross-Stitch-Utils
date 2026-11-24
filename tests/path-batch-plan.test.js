const { test } = require("node:test");
const assert = require("node:assert/strict");
const batch = require("../src/path-batch-plan.js");
const done = (plan, score) => batch.complete(plan, { ...plan.current }, { score, cuts: 1, initial: 150 });
const engines = ["normal", "segments", "points", "sections", "adaptive", "deep"];
function runEngines(plan, scores) {
  engines.forEach((phase, i) => { assert.equal(plan.current.phase, phase); plan = done(plan, scores[i]); });
  assert.equal(plan.current.phase, "chains");
  return plan;
}

test("engines run in order, each loop stabilizes, then the pair repeats before engines restart", () => {
  let plan = batch.prepare({ pending: ["310", "321"], results: [] }, 160);
  assert.equal(plan.current.cycle, 1);
  plan = runEngines(plan, [150, 140, 130, 120, 115, 110]);
  assert.equal(plan.current.cycleStartScore, 160);
  assert.equal(plan.current.loopStartScore, 110);
  plan = done(plan, 100);
  assert.equal(plan.current.phase, "chains"); assert.equal(plan.current.pass, 2);
  plan = done(plan, 100); assert.equal(plan.current.phase, "relay"); assert.equal(plan.current.pass, 1);
  plan = done(plan, 90); assert.equal(plan.current.phase, "relay"); assert.equal(plan.current.pass, 2);
  plan = done(plan, 90);
  assert.equal(plan.current.phase, "chains"); assert.equal(plan.current.loopRound, 2);
  assert.equal(plan.current.pass, 1); assert.equal(plan.current.cycle, 1);
  assert.equal(plan.current.loopStartScore, 90); assert.equal(plan.current.cycleStartScore, 160);
  plan = done(done(plan, 90), 90);
  assert.equal(plan.current.phase, "normal"); assert.equal(plan.current.cycle, 2);
  assert.equal(plan.current.cycleStartScore, 90);
  assert.equal(plan.current.loopRound, 0); assert.equal(plan.current.loopStartScore, null);
  plan = runEngines(plan, engines.map(() => 90));
  plan = done(done(plan, 90), 90);
  assert.equal(plan.current, null);
  assert.deepEqual(plan.pending, ["321"]);
  assert.deepEqual(plan.results, [{ dmc: "310", initial: 160, score: 90, cuts: 1, cycles: 2 }]);
  plan = batch.prepare(plan, null);
  assert.equal(plan.current.dmc, "321"); assert.equal(plan.current.phase, "normal");
  plan = done(plan, 130);
  assert.equal(plan.current.initial, 150, "A new path uses its construction baseline");
  assert.equal(plan.current.cycleStartScore, 150);
});

test("a gain in any engine restarts the entire cycle, not only chains and relays", () => {
  for (let winner = 0; winner < engines.length; winner++) {
    let plan = batch.prepare({ pending: ["310"] }, 100);
    plan = runEngines(plan, engines.map((_, i) => i < winner ? 100 : 95));
    plan = done(done(plan, 95), 95);
    assert.equal(plan.current.phase, "normal"); assert.equal(plan.current.cycle, 2);
    assert.equal(plan.results.length, 0);
  }
});

test("a stable worker skips its own extra scan but still repeats the improved pair", () => {
  let plan = runEngines(batch.prepare({ pending: ["310"] }, 100), engines.map(() => 100));
  plan = batch.complete(plan, plan.current, { score: 90, stable: true });
  assert.equal(plan.current.phase, "relay");
  plan = batch.complete(plan, plan.current, { score: 80, stable: true });
  assert.equal(plan.current.phase, "chains"); assert.equal(plan.current.loopRound, 2);
  assert.equal(plan.current.cycle, 1); assert.equal(plan.current.cycleStartScore, 100);
  plan = batch.complete(plan, plan.current, { score: 80, stable: true });
  plan = batch.complete(plan, plan.current, { score: 80, stable: true });
  assert.equal(plan.current.phase, "normal"); assert.equal(plan.current.cycle, 2);
  assert.equal(plan.current.cycleStartScore, 80, "Only a stable pair can restart all engines");
});

test("a gain in either loop restarts the pair, including gains in later pairs", () => {
  for (const winner of ["chains", "relay"]) {
    let plan = runEngines(batch.prepare({ pending: ["310"] }, 100), engines.map(() => 100));
    const stable = score => { plan = batch.complete(plan, plan.current, { score, stable: true }); };
    for (let round = 1; round <= 3; round++) {
      assert.equal(plan.current.phase, "chains"); assert.equal(plan.current.loopRound, round);
      assert.equal(plan.current.cycle, 1);
      const before = 110 - round * 10, after = before - 10;
      stable(winner === "chains" ? after : before);
      assert.equal(plan.current.phase, "relay");
      stable(after);
    }
    assert.equal(plan.current.loopRound, 4); assert.equal(plan.current.loopStartScore, 70);
    stable(70); stable(70);
    assert.equal(plan.current.phase, "normal"); assert.equal(plan.current.cycle, 2);
    assert.equal(plan.current.cycleStartScore, 70);
  }
});

test("one-color and all-color plans share exactly the same phase transitions", () => {
  let single = batch.prepare({ scope: "color", pending: ["310"] }, 100);
  let all = batch.prepare({ pending: ["310", "321"] }, 100);
  for (const score of [99, 98, 97, 96, 95, 95, 94, 94, 93, 93, 93, 93, 93, 93, 93, 93, 93, 93, 93, 93]) {
    assert.deepEqual(single.current, all.current);
    single = done(single, score); all = done(all, score);
  }
  assert.equal(single.pending.length, 0); assert.deepEqual(all.pending, ["321"]);
  assert.deepEqual(single.results, all.results);
});

test("pause/reload retains phase, loop pass, pair round and both baselines", () => {
  let plan = batch.prepare({ pending: ["310"] }, 150);
  plan = runEngines(plan, [140, 130, 120, 110, 105, 100]);
  plan = done(plan, 90);
  const reloaded = batch.prepare(JSON.parse(JSON.stringify(plan)), 80);
  assert.deepEqual(reloaded, plan);
  assert.equal(reloaded.current.pass, 2);
  assert.equal(reloaded.current.cycleStartScore, 150);
  assert.equal(reloaded.current.loopStartScore, 100);
  assert.match(batch.status(reloaded, true), /Couleur 1 \/ 1.*DMC 310.*cycle 1.*duo 1.*Boucle 1.*passe 2/);
  assert.match(batch.status(reloaded, false), /en pause/);
  plan = done(done(reloaded, 90), 90);
  plan = done(plan, 85);
  const secondPair = batch.prepare(JSON.parse(JSON.stringify(plan)), 80);
  assert.deepEqual(secondPair, plan);
  assert.equal(secondPair.current.loopRound, 2); assert.equal(secondPair.current.pass, 2);
  assert.equal(secondPair.current.loopStartScore, 90); assert.equal(secondPair.current.cycleStartScore, 150);
});

test("manual, stale and invalid completions cannot advance the plan or mutate undo snapshots", () => {
  const plan = batch.prepare({ pending: ["310"] }, 100), before = structuredClone(plan);
  for (const job of [null, { ...plan.current, dmc: "321" }, { ...plan.current, phase: "chains" },
    { ...plan.current, cycle: 3 }, { ...plan.current, pass: 2 }, { ...plan.current, loopRound: 1 }]) {
    assert.deepEqual(batch.complete(plan, job, { score: 90 }), plan);
  }
  assert.deepEqual(done(plan, NaN), plan);
  done(plan, 90);
  assert.deepEqual(plan, before);
});

test("late completions from the same phase in an earlier pair cannot advance the plan", () => {
  let plan = runEngines(batch.prepare({ pending: ["310"] }, 100), engines.map(() => 100));
  const oldChains = { ...plan.current };
  plan = batch.complete(plan, plan.current, { score: 90, stable: true });
  const oldRelay = { ...plan.current };
  plan = done(plan, 90);
  assert.deepEqual(batch.complete(plan, oldChains, { score: 90 }), plan);
  plan = done(plan, 90);
  assert.deepEqual(batch.complete(plan, oldRelay, { score: 90 }), plan);
});

test("float noise is not a gain and a complete no-gain cycle stops", () => {
  let plan = batch.prepare({ pending: ["310"] }, 100);
  plan = runEngines(plan, engines.map(() => 100));
  plan = done(done(plan, 100), 100 - 1e-10);
  assert.equal(plan.pending.length, 0);
  assert.match(batch.status(plan, false), /cycle complet sans gain/);
});

test("legacy scheduling restarts at engine 1 without losing queued colors or results", () => {
  const legacy = { pending: ["310", "310"], results: [{ dmc: "321", score: 50 }],
    current: { dmc: "310", phase: "chains", cycle: 2, cycleStartScore: 80, initial: 100 } };
  let plan = batch.prepare(legacy, 70);
  assert.deepEqual(plan.pending, ["310"]); assert.equal(plan.current.phase, "normal");
  assert.equal(plan.current.initial, 70); assert.equal(plan.results.length, 1);
  plan = batch.complete(plan, plan.current, { score: 0, cuts: 0, empty: true });
  assert.equal(plan.pending.length, 0); assert.equal(plan.results.length, 2);
  assert.equal(batch.normalize(null).current, null);
  assert.equal(batch.normalize({ ...plan, pending: ["310"], current: { dmc: "321", phase: "relay" } }).current, null);
});

test("version 2 plans restart reordered engines or insert M6 before loops without losing the baseline", () => {
  for (const phase of [...engines, "chains", "relay"]) {
    const old = { version: 2, scope: "color", pending: ["310"], results: [{ dmc: "321", score: 50 }],
      current: { dmc: "310", phase, cycle: 3, pass: 2, initial: 150, cycleStartScore: 100, phaseStartScore: 90 } };
    const before = structuredClone(old), plan = batch.prepare(old, 80);
    const loop = phase === "chains" || phase === "relay";
    assert.equal(plan.version, 5); assert.equal(plan.scope, "color");
    assert.equal(plan.current.phase, loop ? "deep" : "normal");
    assert.equal(plan.current.pass, 1);
    assert.equal(plan.current.loopRound, 0);
    assert.equal(plan.current.loopStartScore, null);
    assert.equal(plan.current.cycle, 3); assert.equal(plan.current.cycleStartScore, 100);
    assert.deepEqual(plan.results, old.results); assert.deepEqual(old, before);
    assert.deepEqual(batch.normalize(plan), plan, "Migration is only applied once");
    assert.equal(batch.normalize({ ...plan, current: { ...plan.current, loopRound: -1 } }).current, null);
  }
});

test("version 3 cannot skip reordered engines or the added M6", () => {
  for (const phase of [...engines, "chains", "relay"]) {
    const loop = phase === "chains" || phase === "relay";
    const old = { version: 3, pending: ["310"], results: [], current: { dmc: "310", phase,
      cycle: 2, pass: loop ? 3 : 1, initial: 150, cycleStartScore: 100, phaseStartScore: 90,
      loopRound: loop ? 2 : 0, loopStartScore: loop ? 95 : null } };
    const before = structuredClone(old), plan = batch.prepare(old, 85);
    assert.equal(plan.version, 5); assert.equal(plan.current.phase, loop ? "deep" : "normal");
    assert.equal(plan.current.cycleStartScore, 100); assert.equal(plan.current.initial, 150);
    assert.equal(plan.current.phaseStartScore, loop ? 90 : 100);
    assert.equal(plan.current.pass, 1); assert.equal(plan.current.loopRound, 0);
    assert.equal(plan.current.loopStartScore, null);
    assert.deepEqual(old, before);
    assert.deepEqual(batch.normalize(plan), plan);
  }
});

test("version 4 resumes engines and inserts M6 once before paused loops, preserving all results", () => {
  for (const phase of [...engines, "chains", "relay"]) {
    const loop = phase === "chains" || phase === "relay";
    const old = { version: 4, pending: ["310", "321"], results: [{ dmc: "500", score: 50 }],
      current: { dmc: "310", phase, cycle: 3, pass: loop ? 2 : 1, initial: 150,
        cycleStartScore: 100, phaseStartScore: 90, loopRound: loop ? 3 : 0, loopStartScore: loop ? 95 : null } };
    const before = structuredClone(old), plan = batch.prepare(old, 85);
    assert.equal(plan.version, 5); assert.equal(plan.current.phase, loop ? "deep" : phase);
    assert.deepEqual(plan.pending, old.pending); assert.deepEqual(plan.results, old.results);
    assert.equal(plan.current.cycleStartScore, 100); assert.equal(plan.current.initial, 150);
    if (loop) {
      assert.equal(plan.current.pass, 1); assert.equal(plan.current.loopRound, 0);
      assert.equal(plan.current.loopStartScore, null);
      const next = done(plan, 80);
      assert.equal(next.current.phase, "chains"); assert.equal(next.current.loopStartScore, 80);
    } else assert.deepEqual(plan.current, old.current);
    assert.deepEqual(old, before); assert.deepEqual(batch.normalize(plan), plan);
  }
});
