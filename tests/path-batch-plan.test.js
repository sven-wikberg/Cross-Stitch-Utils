const { test } = require("node:test");
const assert = require("node:assert/strict");
const batch = require("../src/path-batch-plan.js");
const done = (plan, score) => batch.complete(plan, { ...plan.current }, { score, cuts: 1, initial: 150 });
const engines = ["normal", "adaptive", "points", "sections", "segments"];
function runEngines(plan, scores) {
  engines.forEach((phase, i) => { assert.equal(plan.current.phase, phase); plan = done(plan, scores[i]); });
  assert.equal(plan.current.phase, "chains");
  return plan;
}

test("all five engines run in order and each loop repeats until a no-gain pass", () => {
  let plan = batch.prepare({ pending: ["310", "321"], results: [] }, 160);
  assert.equal(plan.current.cycle, 1);
  plan = runEngines(plan, [150, 140, 130, 120, 110]);
  assert.equal(plan.current.cycleStartScore, 160);
  plan = done(plan, 100);
  assert.equal(plan.current.phase, "chains"); assert.equal(plan.current.pass, 2);
  plan = done(plan, 100); assert.equal(plan.current.phase, "relay"); assert.equal(plan.current.pass, 1);
  plan = done(plan, 90); assert.equal(plan.current.phase, "relay"); assert.equal(plan.current.pass, 2);
  plan = done(plan, 90);
  assert.equal(plan.current.phase, "normal"); assert.equal(plan.current.cycle, 2);
  assert.equal(plan.current.cycleStartScore, 90);
  plan = runEngines(plan, [90, 90, 90, 90, 90]);
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

test("a loop that already completed its final no-gain scan is not scanned again unnecessarily", () => {
  let plan = runEngines(batch.prepare({ pending: ["310"] }, 100), [100, 100, 100, 100, 100]);
  plan = batch.complete(plan, plan.current, { score: 90, stable: true });
  assert.equal(plan.current.phase, "relay");
  plan = batch.complete(plan, plan.current, { score: 80, stable: true });
  assert.equal(plan.current.phase, "normal"); assert.equal(plan.current.cycle, 2);
  assert.equal(plan.current.cycleStartScore, 80, "Loop gains still restart all engines");
});

test("one-color and all-color plans share exactly the same phase transitions", () => {
  let single = batch.prepare({ scope: "color", pending: ["310"] }, 100);
  let all = batch.prepare({ pending: ["310", "321"] }, 100);
  for (const score of [99, 98, 97, 96, 95, 94, 94, 93, 93, 93, 93, 93, 93, 93, 93, 93]) {
    assert.deepEqual(single.current, all.current);
    single = done(single, score); all = done(all, score);
  }
  assert.equal(single.pending.length, 0); assert.deepEqual(all.pending, ["321"]);
  assert.deepEqual(single.results, all.results);
});

test("pause/reload retains phase, loop pass and full-cycle baseline", () => {
  let plan = batch.prepare({ pending: ["310"] }, 150);
  plan = runEngines(plan, [140, 130, 120, 110, 100]);
  plan = done(plan, 90);
  const reloaded = batch.prepare(JSON.parse(JSON.stringify(plan)), 80);
  assert.deepEqual(reloaded, plan);
  assert.equal(reloaded.current.pass, 2);
  assert.equal(reloaded.current.cycleStartScore, 150);
  assert.match(batch.status(reloaded, true), /Couleur 1 \/ 1.*DMC 310.*cycle 1.*Boucle 1.*passe 2/);
  assert.match(batch.status(reloaded, false), /en pause/);
});

test("manual, stale and invalid completions cannot advance the plan or mutate undo snapshots", () => {
  const plan = batch.prepare({ pending: ["310"] }, 100), before = structuredClone(plan);
  for (const job of [null, { ...plan.current, dmc: "321" }, { ...plan.current, phase: "chains" },
    { ...plan.current, cycle: 3 }, { ...plan.current, pass: 2 }]) {
    assert.deepEqual(batch.complete(plan, job, { score: 90 }), plan);
  }
  assert.deepEqual(done(plan, NaN), plan);
  done(plan, 90);
  assert.deepEqual(plan, before);
});

test("float noise is not a gain and a complete no-gain cycle stops", () => {
  let plan = batch.prepare({ pending: ["310"] }, 100);
  plan = runEngines(plan, [100, 100, 100, 100, 100]);
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
