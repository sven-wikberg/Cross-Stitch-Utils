const { test } = require("node:test");
const assert = require("node:assert/strict");
const stats = require("../src/stitch-stats.js");
require("../src/progress-store.js");

const monday = new Date(2026, 10, 16, 23, 59);
const tuesday = new Date(2026, 10, 17, 0, 1);
const paths = { paths: ["310", "321"].map(dmc => ({ dmc,
  points: Array.from({ length: 20 }, (_, i) => ({ x: Math.floor(i / 2), y: 0, diagonal: i % 2 ? "upper" : "lower" })) })) };

test("old progress is an undated baseline, never activity today", () => {
  const value = stats.load(undefined, paths, { "310": 12 }, monday);
  const summary = stats.summarize(value, paths, { "310": 12 }, monday);
  assert.equal(summary.undated, 12);
  assert.equal(summary.today.diagonals, 0);
  assert.equal(summary.activeDays, 0);
  assert.equal(summary.averagePerThread, null);
  assert.deepEqual(stats.load(value, paths, { "310": 12 }), value);
});

test("native repeated progress is merged, and local midnight starts another day", () => {
  const value = stats.create({}, monday);
  for (let i = 0; i < 5; i++) stats.record(value, "310", i, i + 1, monday);
  stats.record(value, "310", 5, 8, tuesday);
  assert.equal(value.colors["310"].runs.length, 2);
  assert.equal(value.colors["310"].threads.length, 1);
  const summary = stats.summarize(value, paths, { "310": 8 }, tuesday);
  assert.deepEqual(summary.today, { day: "2026-11-17", diagonals: 3, crosses: 2 });
  assert.equal(summary.week, 8);
  assert.equal(summary.activeDays, 2);
  assert.equal(summary.averagePerDay, 4);
  assert.equal(summary.recentDays.length, 7);
  assert.deepEqual(stats.load(value, paths, { "310": 8 }), value);
});

test("a cross completed today can have its first diagonal from before tracking", () => {
  const value = stats.create({ "310": 1 }, monday);
  stats.record(value, "310", 1, 2, tuesday);
  const summary = stats.summarize(value, paths, { "310": 2 }, tuesday);
  assert.equal(summary.today.crosses, 1);
  assert.equal(summary.today.diagonals, 1);
});

test("thread changes preserve path indices, ignore partial and unfinished pieces in the average", () => {
  const value = stats.create({ "310": 4 }, monday);
  stats.record(value, "310", 4, 7, monday);
  assert.ok(stats.currentThread(value, "310").partial);
  assert.ok(stats.finishThread(value, "310", 7, monday));
  assert.equal(stats.finishThread(value, "310", 7, monday), false);
  stats.record(value, "310", 7, 11, monday);
  stats.finishThread(value, "310", 11, monday);
  stats.record(value, "310", 11, 13, tuesday);
  const summary = stats.summarize(value, paths, { "310": 13 }, tuesday);
  assert.equal(summary.averagePerThread, 4);
  assert.equal(summary.completedThreads, 2);
  assert.equal(summary.measuredThreads, 1);
  assert.equal(stats.currentThread(value, "310").number, 3);
  assert.deepEqual(stats.load(value, paths, { "310": 13 }), value);
});

test("each color retains its own in-progress thread", () => {
  const value = stats.create({}, monday);
  stats.record(value, "310", 0, 2, monday);
  stats.record(value, "321", 0, 3, monday);
  stats.record(value, "310", 2, 5, tuesday);
  assert.equal(stats.currentThread(value, "310").start, 0);
  assert.equal(stats.currentThread(value, "321").start, 0);
  stats.finishThread(value, "310", 5, tuesday);
  assert.equal(stats.summarize(value, paths, { "310": 5, "321": 3 }, tuesday).averagePerThread, 5);
  assert.deepEqual(stats.load(value, paths, { "310": 5, "321": 3 }), value);
});

test("corrections trim original days, thread ends and baseline without negative days", () => {
  const value = stats.create({ "310": 2 }, monday);
  stats.record(value, "310", 2, 6, monday);
  stats.finishThread(value, "310", 6, monday);
  stats.record(value, "310", 6, 10, tuesday);
  stats.finishThread(value, "310", 10, tuesday);
  stats.record(value, "310", 10, 4, tuesday);
  const summary = stats.summarize(value, paths, { "310": 4 }, tuesday);
  assert.equal(summary.today.diagonals, 0);
  assert.equal(summary.total, 2);
  assert.equal(summary.completedThreads, 0);
  assert.equal(summary.threads.length, 1);
  assert.equal(stats.currentThread(value, "310").end, null);
  assert.deepEqual(stats.load(value, paths, { "310": 4 }), value);
  stats.record(value, "310", 4, 1, tuesday);
  assert.deepEqual(value.colors["310"], { baseline: 1, runs: [], threads: [] });
  assert.deepEqual(stats.load(value, paths, { "310": 1 }), value);
});

test("undo and redo restore dates and thread markers without counting the same work again", () => {
  const value = stats.create({}, monday);
  stats.record(value, "310", 0, 4, monday);
  const before = stats.snapshot(value, "310");
  stats.finishThread(value, "310", 4, monday);
  const after = stats.snapshot(value, "310");
  stats.restoreColor(value, "310", before);
  assert.ok(stats.currentThread(value, "310"));
  stats.restoreColor(value, "310", after);
  assert.equal(stats.currentThread(value, "310"), null);
  assert.equal(stats.summarize(value, paths, { "310": 4 }, tuesday).today.diagonals, 0);
  assert.equal(stats.summarize(value, paths, { "310": 4 }, tuesday).total, 4);
  stats.rebaseColor(value, "310", 2);
  assert.deepEqual(stats.load(value, paths, { "310": 2 }), value);
});

test("statistics-only edits are dirty for GitHub sync, timestamps and display settings are not", () => {
  const value = stats.create({}, monday);
  stats.record(value, "310", 0, 4, monday);
  const state = { patternId: "a".repeat(64), stitchedByDmc: { "310": 4 }, selectedDmc: "310", stitchStats: value };
  const before = StitchProgressStore.fingerprint(state);
  stats.finishThread(value, "310", 4, monday);
  const after = StitchProgressStore.fingerprint(state);
  assert.notEqual(before, after);
  assert.equal(after, StitchProgressStore.fingerprint({ ...state, savedAt: "later", showThreadMarkers: false }));
  const unpacked = StitchProgressStore.unpack({ ...state, kind: "cross-stitch-progress-state", schemaVersion: 3 }, paths);
  assert.deepEqual(unpacked.stitchStats, value);
});

test("malformed saved activity is rejected instead of silently changing a project's counts", () => {
  const value = stats.create({}, monday);
  stats.record(value, "310", 0, 4, monday);
  for (const mutate of [
    s => { s.version = 2; },
    s => { s.colors["310"].runs[0].to = 30; },
    s => { s.colors["310"].runs[0].day = "2026-02-30"; },
    s => { s.colors["310"].runs[0].thread = 3; },
    s => { s.colors["310"].threads[0].start = 2; },
    s => { s.colors["310"].baseline = -1; },
    s => { delete s.colors["310"]; }
  ]) {
    const broken = structuredClone(value); mutate(broken);
    assert.throws(() => stats.load(broken, paths, { "310": 4 }));
  }
  assert.deepEqual(stats.load(value, paths, { "310": 4 }), value);
});

test("random corrections and thread boundaries always round-trip with exact totals", () => {
  const value = stats.create({ "310": 3 }, monday), counts = { "310": 3, "321": 0 };
  let seed = 71;
  const random = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 1000; i++) {
    const dmc = random(3) ? "310" : "321", before = counts[dmc];
    if (random(4) === 0) stats.finishThread(value, dmc, before, i % 2 ? monday : tuesday);
    else { const after = random(21); stats.record(value, dmc, before, after, i % 2 ? monday : tuesday); counts[dmc] = after; }
    assert.deepEqual(stats.load(value, paths, counts), value);
    const summary = stats.summarize(value, paths, counts, tuesday);
    assert.equal(summary.total + summary.undated, counts["310"] + counts["321"]);
    assert.ok(summary.threads.every(thread => thread.diagonals > 0));
  }
});
