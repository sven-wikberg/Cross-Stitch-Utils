const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");
const { createPathVisuals } = require("../src/path-visuals.js");
const builder = createOrthogonalPathBuilder(model);
const visuals = createPathVisuals(model, builder);
const cell = (x, y = 0) => ({ x, y });

test("visual blocks use side adjacency only and do not change the cells", () => {
  const cells = [cell(0), cell(1), cell(2, 1), cell(8)], before = structuredClone(cells);
  const index = visuals.blockIndex(cells);
  assert.ok(visuals.sameBlock(cells[0], cells[1], index));
  assert.equal(visuals.sameBlock(cells[1], cells[2], index), false);
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

test("internal strokes are thicker without thickening cuts or changing route data", () => {
  for (const size of [3, 6, 10, 18]) {
    const normal = visuals.strokeWidths(size), internal = visuals.strokeWidths(size, false, true);
    const cut = visuals.strokeWidths(size, true, true);
    assert.ok(internal.back > normal.back);
    assert.ok(internal.front > Math.max(1, size * 0.14));
    assert.equal(cut.back, Math.max(0.6, size * 0.045));
  }
  const cells = Object.freeze([Object.freeze(cell(0)), Object.freeze(cell(4))]);
  const route = Object.freeze(model.expandCells(cells).map(Object.freeze));
  const before = structuredClone(route);
  visuals.diffConnections(route, route, visuals.blockIndex(cells), 10);
  assert.deepEqual(route, before);
});
