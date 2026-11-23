const { test } = require("node:test");
const assert = require("node:assert/strict");
const batch = require("../src/path-batch-plan.js");
const done = (plan, score) => batch.complete(plan, { ...plan.current }, { score, cuts: 1, initial: 150 });

test("blocks, sections, chains and relays repeat only after a full cycle with a score gain", () => {
  let plan = batch.prepare({ pending: ["310", "321"], results: [] }, 160);
  assert.equal(plan.current.phase, "normal");
  plan = done(plan, 140); assert.equal(plan.current.phase, "sections");
  plan = done(plan, 120); assert.equal(plan.current.phase, "chains");
  assert.equal(plan.current.cycleStartScore, 120);
  plan = done(plan, 110); assert.equal(plan.current.phase, "relay");
  plan = done(plan, 110); assert.equal(plan.current.cycle, 2, "A chains-only gain also warrants another cycle");
  plan = done(plan, 110); plan = done(plan, 105);
  assert.equal(plan.current.cycle, 3, "A relay-only gain restarts chains");
  plan = done(plan, 105); plan = done(plan, 105);
  assert.equal(plan.current, null);
  assert.deepEqual(plan.pending, ["321"]);
  assert.deepEqual(plan.results, [{ dmc: "310", initial: 160, score: 105, cuts: 1, cycles: 3 }]);
  plan = batch.prepare(plan, null);
  assert.equal(plan.current.dmc, "321"); assert.equal(plan.current.phase, "normal");
  plan = done(plan, 130); assert.equal(plan.current.initial, 150, "Fresh routes use the construction baseline");
});

test("pause/reload retains the phase and cycle baseline, not just the latest score", () => {
  let plan = batch.prepare({ pending: ["310"], results: [] }, 150);
  plan = done(done(plan, 140), 130);
  const reloaded = batch.prepare(JSON.parse(JSON.stringify(plan)), 120);
  assert.deepEqual(reloaded, plan);
  plan = done(done(reloaded, 120), 120);
  assert.equal(plan.current.cycle, 2);
  assert.equal(plan.current.cycleStartScore, 120);
});

test("manual, stale and invalid completions cannot advance the batch", () => {
  const plan = batch.prepare({ pending: ["310"], results: [] }, 100);
  for (const job of [null, { ...plan.current, dmc: "321" }, { ...plan.current, phase: "chains" }, { ...plan.current, cycle: 3 }]) {
    assert.deepEqual(batch.complete(plan, job, { score: 90 }), plan);
  }
  assert.deepEqual(done(plan, NaN), plan);
  assert.equal(plan.current.phase, "normal", "Transitions do not mutate saved/undo snapshots");
});

test("float noise does not cause an endless cycle and status identifies the active phase", () => {
  let plan = batch.prepare({ pending: ["310"], results: [] }, 110);
  plan = done(done(plan, 105), 100);
  assert.match(batch.status(plan, true), /Couleur 1 \/ 1.*DMC 310.*Moteur 6.*cycle 1/);
  assert.match(batch.status(plan, false), /en pause/);
  plan = done(done(plan, 100), 100 - 1e-10);
  assert.equal(plan.pending.length, 0);
  assert.match(batch.status(plan, false), /sans gain/);
});

test("legacy drafts resume at blocks and unused colors can complete without a worker", () => {
  const legacy = { pending: ["310", "310"], results: [{ dmc: "321", score: 50 }] };
  let plan = batch.prepare(legacy, null);
  assert.deepEqual(plan.pending, ["310"]); assert.equal(plan.current.phase, "normal");
  plan = batch.complete(plan, plan.current, { score: 0, cuts: 0, empty: true });
  assert.equal(plan.pending.length, 0); assert.equal(plan.results.length, 2);
  assert.equal(batch.normalize({ ...legacy, current: { dmc: "321", phase: "relay" } }).current, null);
});
