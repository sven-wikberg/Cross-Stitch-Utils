const { test } = require("node:test");
const assert = require("node:assert/strict");
const stats = require("../src/path-search-stats.js");

test("accepted gains and active time accumulate by engine across repeated phases", () => {
  let record = stats.start(null, "normal", 100);
  stats.update(record, { score: 95, elapsedMs: 1000 });
  stats.update(record, { score: 95, elapsedMs: 2000 });
  stats.finish(record, 2500);
  record = stats.start(record, "relay", 95);
  stats.update(record, { score: 90, elapsedMs: 500 });
  stats.finish(record, 1000);
  record = stats.start(record, "normal", 90);
  stats.update(record, { score: 88, elapsedMs: 750 });
  assert.deepEqual(record.totals.normal, { gain: 7, elapsedMs: 3250, runs: 2 });
  assert.deepEqual(record.totals.relay, { gain: 5, elapsedMs: 1000, runs: 1 });
  assert.equal(record.elapsedMs, 4250); assert.equal(record.score, 88);
  assert.equal(Object.values(record.totals).reduce((sum, total) => sum + total.gain, 0), record.baseline - record.score);
  assert.ok(record.history.some(point => point.mode === "relay" && point.gain === 5));
  assert.ok(record.history.every((point, i, history) => !i || point.elapsed >= history[i - 1].elapsed));
});

test("no-gain phases remain visible and duplicate or worse scores never earn credit", () => {
  let record = stats.start(null, "adaptive", 100);
  for (const score of [100, 105, 100 - 1e-10, NaN, null]) stats.update(record, { score, elapsedMs: 1000 });
  stats.finish(record, 1500);
  assert.deepEqual(record.totals.adaptive, { gain: 0, elapsedMs: 1500, runs: 1 });
  record = stats.start(record, "chains", 100);
  stats.update(record, { score: 90, elapsedMs: 500 });
  stats.update(record, { score: 90, elapsedMs: 400 });
  assert.equal(record.totals.chains.gain, 10); assert.equal(record.elapsedMs, 2000);
  assert.equal(record.totals.normal, undefined);
});

test("construction has no artificial gain and uses a valid full-route baseline when available", () => {
  const record = stats.start(null, "normal", null);
  stats.update(record, { score: null, elapsedMs: 1000 });
  assert.equal(record.history.length, 0); assert.equal(record.baseline, null);
  stats.update(record, { score: 95, initialScore: 100, elapsedMs: 2000 });
  assert.equal(record.baseline, 100); assert.equal(record.totals.normal.gain, 5);
  const noBaseline = stats.start(null, "normal", null);
  stats.update(noBaseline, { score: 95, elapsedMs: 2000 });
  assert.equal(noBaseline.baseline, 95); assert.equal(noBaseline.totals.normal.gain, 0);
});

test("pause/reload retains all totals without counting paused time or mixing colors", () => {
  const red = stats.start(null, "chains", 100), blue = stats.start(null, "points", 200);
  stats.update(red, { score: 90, elapsedMs: 1000 });
  stats.update(blue, { score: 180, elapsedMs: 2000 });
  const restored = stats.normalizeAll(JSON.parse(JSON.stringify({ "321": red, "310": blue })));
  assert.equal(restored["321"].active, null);
  const resumed = stats.start(restored["321"], "chains", 90);
  stats.update(resumed, { score: 85, elapsedMs: 300 });
  assert.equal(resumed.totals.chains.gain, 15); assert.equal(resumed.elapsedMs, 1300);
  assert.equal(restored["310"].totals.points.gain, 20);
  assert.equal(restored["321"].totals.chains.gain, 10, "Starting a run does not mutate its saved snapshot");
});

test("changed routes start a new baseline rather than attributing manual work to a motor", () => {
  const record = stats.start(null, "normal", 100);
  stats.update(record, { score: 90, elapsedMs: 1000 });
  for (const score of [80, 110, null]) {
    const next = stats.start(record, "segments", score);
    assert.equal(next.baseline, score); assert.equal(next.totals.normal, undefined);
    assert.deepEqual(next.totals.segments, { gain: 0, elapsedMs: 0, runs: 1 });
  }
});

test("bounded curve history does not lose exact gain or time totals", () => {
  const record = stats.start(null, "sections", 10000);
  for (let i = 1; i <= 2000; i++) stats.update(record, { score: 10000 - i, elapsedMs: i * 1000 });
  assert.equal(record.history.length, stats.MAX_POINTS); assert.equal(record.truncated, true);
  assert.equal(record.totals.sections.gain, 2000); assert.equal(record.totals.sections.elapsedMs, 2000000);
  const flat = stats.start(null, "deep", 100);
  for (let i = 1; i <= 2000; i++) stats.update(flat, { score: 100, elapsedMs: i * 1000 });
  assert.equal(flat.history.length, 2); assert.equal(flat.truncated, false);
  assert.equal(stats.normalize(record).totals.sections.gain, 2000);
});

test("old and malformed drafts do not prevent loading a pattern", () => {
  assert.deepEqual(stats.normalizeAll(undefined), {});
  assert.equal(stats.normalize({ version: 1, elapsedMs: NaN }).baseline, null);
  const normalized = stats.normalize({ version: 1, elapsedMs: 1, history: [null, { score: NaN }],
    totals: { normal: { gain: -1, elapsedMs: 0, runs: 1 } } });
  assert.deepEqual(normalized.totals, {}); assert.deepEqual(normalized.history, []);
  assert.throws(() => stats.start(null, "other", 1), /inconnu/);
});

test("renumbering engines keeps historical gains and colors tied to the algorithm", () => {
  let record = stats.start(null, "adaptive", 100);
  stats.update(record, { score: 90, elapsedMs: 1000 }); stats.finish(record, 1000);
  record = stats.start(record, "segments", 90);
  stats.update(record, { score: 85, elapsedMs: 2000 }); stats.finish(record, 2000);
  const restored = stats.normalize(record);
  assert.equal(stats.modes.segments.short, "M2"); assert.equal(restored.totals.segments.gain, 5);
  assert.equal(stats.modes.adaptive.short, "M5"); assert.equal(restored.totals.adaptive.gain, 10);
  assert.equal(stats.modes.deep.short, "M6");
  assert.deepEqual(Object.values(stats.modes).map(mode => mode.short), ["M1", "M2", "M3", "M4", "M5", "M6", "B1", "B2"]);
  assert.equal(restored.history.find(point => point.gain === 10).mode, "adaptive");
});
