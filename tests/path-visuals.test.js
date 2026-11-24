const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createPathVisuals } = require("../src/path-visuals.js");
const builder = createOrthogonalPathBuilder(model);
const visuals = createPathVisuals(model, builder);
const cell = (x, y = 0) => ({ x, y });

test("search presentation distinguishes preparation counts from inactivity, never solution quality", () => {
  const construction = { stage: "construction", progress: 3, zone: { total: 10, completed: 3, status: "running" } };
  const config = { stage: "configuration", progress: 12.5, blocks: { total: 20, prepared: 5 } };
  const search = { stage: "search", progress: 99, lastImprovementMs: 12000, stagnationLimitMs: 60000 };
  const before = structuredClone([construction, config, search]);
  const a = visuals.searchPresentation(construction, true), b = visuals.searchPresentation(config, true);
  assert.equal(a.showConstruction, true); assert.equal(a.count, "3 / 10");
  assert.equal(a.value, 3); assert.equal(a.max, 10); assert.equal(a.searching, false);
  assert.equal(b.showConstruction, false); assert.equal(b.count, "5 / 20");
  assert.equal(b.value, 5); assert.equal(b.max, 20);
  const c = visuals.searchPresentation(search, true);
  assert.equal(c.label, "Sans amelioration"); assert.equal(c.value, 12000); assert.equal(c.max, 60000);
  const shortened = visuals.searchPresentation({ ...search, stagnationLimitMs: 8100 }, true);
  assert.equal(shortened.max, 8100); assert.equal(shortened.value, 8100);
  const immediate = visuals.searchPresentation({ ...search, stagnationLimitMs: 0, lastImprovementMs: 0 }, true);
  assert.equal(immediate.max, 1); assert.equal(immediate.value, 1);
  assert.equal(visuals.searchPresentation({ ...search, lastImprovementMs: 0 }, true).value, 0);
  assert.equal(visuals.searchPresentation({ ...search, lastImprovementMs: 70000 }, true).value, 60000);
  for (const snapshot of [null, construction, config, search, { stage: "complete" }]) {
    const view = visuals.searchPresentation(snapshot, false);
    assert.equal(view.active, false); assert.equal(Boolean(view.showConstruction), false);
  }
  assert.equal(visuals.searchPresentation(null, true).value, null);
  const sections = visuals.searchPresentation({ method: "point-sections", stage: "sections", totalLimitMs: 60000, elapsedMs: 2300 }, true);
  assert.equal(sections.timed, true); assert.equal(sections.label, "Temps restant");
  assert.equal(sections.max, 60000); assert.equal(sections.value, 2300);
  const segments = visuals.searchPresentation({ method: "segment-optimization", stage: "search", totalLimitMs: 600000, elapsedMs: 12300 }, true);
  assert.equal(segments.timed, true); assert.equal(segments.searching, false);
  assert.equal(segments.max, 600000); assert.equal(segments.value, 12300);
  const chains = visuals.searchPresentation({ method: "chain-reinsertion", stage: "search", totalLimitMs: 60000, elapsedMs: 8900 }, true);
  assert.equal(chains.timed, true); assert.equal(chains.searching, false);
  assert.equal(chains.max, 60000); assert.equal(chains.value, 8900);
  assert.deepEqual([construction, config, search], before);
});

test("inactivity engines and exhaustive loops show the right progress instead of a total budget", () => {
  for (const method of ["adaptive-optimization", "points-diagonals", "point-sections", "segment-optimization"]) {
    const view = visuals.searchPresentation({ method, stage: "sections", stopAfterInactivity: true,
      stagnationLimitMs: 60000, lastImprovementMs: 2300, elapsedMs: 400000 }, true);
    assert.equal(view.timed, false); assert.equal(view.searching, true);
    assert.equal(view.value, 2300); assert.equal(view.max, 60000); assert.equal(view.label, "Sans amelioration");
  }
  const loop = visuals.searchPresentation({ method: "chain-reinsertion", untilStable: true, stage: "search",
    chainSearch: { total: 50, rank: 17 } }, true);
  assert.equal(loop.timed, false); assert.equal(loop.searching, false);
  assert.equal(loop.label, "Liaisons examinees"); assert.equal(loop.count, "17 / 50");
  assert.equal(loop.value, 17); assert.equal(loop.max, 50);
});

test("initial setup shows preparation, not an expiring inactivity timer, in every engine", () => {
  for (const method of ["block-optimization", "segment-optimization", "points-diagonals", "point-sections", "adaptive-optimization", "deep-optimization"]) {
    for (const stage of ["preparation", "points", "sections", "lns", "configuration"]) {
      const snapshot = { method, stage, preparing: true, stopAfterInactivity: true,
        elapsedMs: 120000, lastImprovementMs: 0, stagnationLimitMs: 10000 };
      const view = visuals.searchPresentation(snapshot, true);
      assert.ok(view.active && view.preparing && !view.searching && !view.timed);
      assert.equal(view.label, "Preparation"); assert.equal(view.value, null);
      assert.equal(visuals.searchPresentation(snapshot, false).active, false);
      const ready = visuals.searchPresentation({ ...snapshot, preparing: false, stage: "search" }, true);
      assert.equal(ready.searching, true); assert.equal(ready.value, 0); assert.equal(ready.max, 10000);
    }
  }
  const timed = visuals.searchPresentation({ method: "deep-optimization", stage: "preparation", totalLimitMs: 3600000, elapsedMs: 120000 }, true);
  assert.equal(timed.timed, true); assert.equal(timed.value, 120000);
});

test("a work palette is independent of DMC colors and keeps light fills with dark thread strokes", () => {
  assert.equal(visuals.workPalette("invalid").color, "#157f83");
  assert.equal(visuals.workPalette("#AABBCC").color, "#aabbcc");
  for (const color of ["#ffffff", "#000000", "#ff0000", "#00ff00", "#0000ff", "#157f83"]) {
    const palette = visuals.workPalette(color);
    for (const key of ["fill", "line"]) assert.match(palette[key], /^#[0-9a-f]{6}$/);
    for (const start of [1, 3, 5]) assert.ok(parseInt(palette.fill.slice(start, start + 2), 16)
      > parseInt(palette.line.slice(start, start + 2), 16));
  }
});

test("visual blocks use the same diagonal and one-empty-cell connections as the optimizer", () => {
  const cells = [cell(0), cell(1), cell(2, 1), cell(4, 1), cell(8)], before = structuredClone(cells);
  const index = visuals.blockIndex(cells);
  assert.ok(visuals.sameBlock(cells[0], cells[1], index));
  assert.ok(visuals.sameBlock(cells[1], cells[2], index));
  assert.ok(visuals.sameBlock(cells[2], cells[3], index));
  assert.equal(visuals.sameBlock(cells[3], cells[4], index), false);
  assert.equal(visuals.sameBlock(cell(99), cell(98), index), false);
  assert.deepEqual(cells, before);
});

test("feedback isolates changed physical connections instead of every internal diagonal", () => {
  const cells = [cell(0), cell(1), cell(7), cell(8), cell(3, 4)];
  const index = visuals.blockIndex(cells);
  const before = model.expandCells([cells[0], cells[2], cells[1], cells[3], cells[4]], 100);
  const after = model.expandCells([cells[0], cells[1], cells[4], cells[2], cells[3]], 100);
  const oldLinks = visuals.connections(before, index, 100), newLinks = visuals.connections(after, index, 100);
  const diff = visuals.diffConnections(before, after, index, 100);
  assert.ok(diff.added.length && diff.removed.length);
  assert.deepEqual(diff.added, [...newLinks].filter(([key]) => !oldLinks.has(key)).map(([, link]) => link));
  assert.deepEqual(diff.removed, [...oldLinks].filter(([key]) => !newLinks.has(key)).map(([, link]) => link));
  assert.deepEqual(visuals.diffConnections(before, structuredClone(before), index, 100), { added: [], removed: [] });
  for (const link of [...diff.added, ...diff.removed]) {
    for (const hole of [link.from, link.to]) assert.ok(Number.isInteger(hole.x) && Number.isInteger(hole.y));
  }
});

test("reversing the traversal of unchanged hole-to-hole connections does not flash them", () => {
  const cells = [cell(0), cell(4, 2), cell(8)], index = visuals.blockIndex(cells);
  const path = model.expandCells(cells, 100);
  const reversed = path.toReversed().map(point => ({ ...point, direction: -point.direction }));
  assert.deepEqual(visuals.diffConnections(path, reversed, index, 100), { added: [], removed: [] });
});

test("a cut added at the same geometry is distinguished and remains marked as a cut", () => {
  const cells = [cell(0), cell(4)], index = visuals.blockIndex(cells);
  const path = model.expandCells(cells, 100), cutPath = structuredClone(path);
  cutPath[2].cutBefore = true;
  const diff = visuals.diffConnections(path, cutPath, index, 100);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.added[0].isCut, true);
  assert.equal(diff.removed[0].isCut, false);
  assert.deepEqual(diff.added[0].from, diff.removed[0].from);
  assert.deepEqual(diff.added[0].to, diff.removed[0].to);
});

test("unit internal links are excluded but internal forced cuts and long historical jumps remain visible", () => {
  const cells = [cell(0), cell(1), cell(2), cell(3)], index = visuals.blockIndex(cells);
  const route = builder.buildPath({ points: cells }).path;
  assert.equal(visuals.connections(route, index, 10).size, 0);
  const cut = structuredClone(route); cut[2].cutBefore = true;
  assert.equal(visuals.connections(cut, index, 10).size, 1);
  const jumping = model.expandCells([cells[0], cells[3], cells[1], cells[2]], 100);
  assert.ok(visuals.connections(jumping, index, 100).size > 0);
});

test("inter-block strokes stand out while cuts stay thin and route data stays unchanged", () => {
  for (const size of [3, 6, 10, 18]) {
    const normal = visuals.strokeWidths(size), internal = visuals.strokeWidths(size, false, true);
    const cut = visuals.strokeWidths(size, true, true);
    assert.ok(normal.back > internal.back && internal.back > cut.back);
    assert.ok(normal.back > Math.max(0.6, size * 0.065));
    assert.ok(internal.front > Math.max(1, size * 0.14));
    assert.equal(cut.back, Math.max(0.6, size * 0.045));
  }
  const cells = Object.freeze([Object.freeze(cell(0)), Object.freeze(cell(4))]);
  const route = Object.freeze(model.expandCells(cells).map(Object.freeze));
  const before = structuredClone(route);
  visuals.diffConnections(route, route, visuals.blockIndex(cells), 10);
  assert.deepEqual(route, before);
});
