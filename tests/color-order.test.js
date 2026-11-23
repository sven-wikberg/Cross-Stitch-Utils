const { test } = require("node:test");
const assert = require("node:assert/strict");
const order = require("../src/color-order.js");

test("colors sort by total count descending, keeping ties stable and the source untouched", () => {
  const colors = Object.freeze(["small", "large", "medium", "tied", "unused"].map(dmc => Object.freeze({ dmc })));
  const counts = new Map([["small", 1], ["large", 6], ["medium", 3], ["tied", 6]]);
  assert.deepEqual(order.byCount(colors, color => counts.get(color.dmc)).map(c => c.dmc), ["large", "tied", "medium", "small", "unused"]);
  assert.deepEqual(colors.map(c => c.dmc), ["small", "large", "medium", "tied", "unused"]);
  assert.deepEqual(order.byCount(colors, () => 0), colors);
});

test("only assigned, nonempty grid cells count; pending assignments can override without mutation", () => {
  const cells = Object.freeze([{ dmc: "310", empty: false }, { dmc: "310", empty: false },
    { dmc: "321", empty: true }, { dmc: null, empty: false }].map(Object.freeze));
  assert.deepEqual([...order.countCells(cells)], [["310", 2]]);
  assert.deepEqual([...order.countCells(cells, cell => cell === cells[0] ? "321" : cell.empty ? null : cell.dmc)], [["321", 1], ["310", 1]]);
  assert.deepEqual([...order.countCells()], []);
});
