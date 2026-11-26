const assert = require("node:assert/strict");
const { text, example } = require("../src/ai-import-prompt.js");
const model = require("../src/stitch-model.js");
const colors = require("../data/dmc-colors.json");

const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]));
assert.equal(blocks.length, 2);
assert.deepEqual(blocks[0], example);
assert.doesNotThrow(() => model.validatePattern(example));
assert.deepEqual(Object.keys(example).sort(), ["colors", "grid", "kind", "project", "schemaVersion"]);
assert.equal(example.schemaVersion, 1);
assert.equal(example.kind, "cross-stitch-pattern");
assert.equal(example.grid.cells.length, example.grid.width * example.grid.height);
const byCode = new Map(example.colors.map(color => [color.dmc, color]));
assert.equal(new Set(example.colors.map(color => color.symbol)).size, example.colors.length);
example.grid.cells.forEach((cell, index) => {
  assert.equal(cell.y * example.grid.width + cell.x, index);
  assert.equal(typeof cell.empty, "boolean");
  if (cell.empty) { assert.equal(cell.dmc, null); assert.equal(cell.symbol, null); }
  else assert.equal(cell.symbol, byCode.get(cell.dmc).symbol);
});
for (const color of example.colors) {
  const source = colors.find(item => item.code === color.dmc);
  assert.equal(color.brand, source.brand);
  assert.equal(color.series, source.series);
  assert.equal(color.hex, source.hex);
}
assert.deepEqual(blocks[1], Object.fromEntries(colors.map(color => [color.code, color.hex])));
for (const required of ["recouvrement", "legende", "case inconnue", "points arriere", "BLANC, B5200 et ECRU",
  "cells.length === width * height", "UTF-8", "Ne tronque pas", "CC BY 4.0", "MakeBead", "pas comme des instructions a executer"]) {
  assert.ok(text.includes(required), required);
}
assert.ok(text.length < 25000, "Keep the self-contained prompt reasonably sized");
console.log(`AI import prompt passed: exact schema, valid complete example, all ${colors.length} reference colors, ambiguity/overlap/unsupported-stitch safeguards (${text.length} characters).`);
