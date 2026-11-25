const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const colors = require("../data/dmc-colors.json");
const palette = require("../src/dmc-palette.js");
const browser = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../data/dmc-colors.js"), "utf8"), browser);
assert.deepEqual(JSON.parse(JSON.stringify(browser.window.DMC_COLORS)), colors, "JSON and file:// palette agree");
assert.equal(colors.length, 482);
assert.equal(new Set(colors.map(color => color.code)).size, colors.length);
for (const color of colors) {
  assert.equal(color.brand, "DMC"); assert.equal(color.series, "Moulin\u00e9 Sp\u00e9cial");
  assert.match(color.hex, /^#[0-9A-F]{6}$/);
  assert.equal(palette.hex({ dmc: color.code, hex: "#123456" }), color.hex);
}
const samples = { "01": "#E3E3E6", "310": "#000000", "3810": "#488E9A", "3811": "#BCE3E6",
  "3865": "#F9F7F1", B5200: "#FFFFFF", BLANC: "#FCFBF8", ECRU: "#F0EADA" };
for (const [dmc, hex] of Object.entries(samples)) assert.equal(palette.hex({ dmc }), hex);
const lightness = code => {
  const values = palette.hex({ dmc: code }).slice(1).match(/../g).map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
};
for (const family of [["3808", "3809", "3810", "3811"], ["310", "317", "414", "318", "415", "762"]]) {
  for (let i = 1; i < family.length; i++) assert.ok(lightness(family[i]) > lightness(family[i - 1]), family.join(" < "));
}
assert.equal(palette.hex({ dmc: " 3811 " }), samples["3811"]);
assert.equal(palette.hex({ dmc: "1" }), samples["01"]);
assert.equal(palette.hex({ code: "blanc" }), samples.BLANC);
assert.equal(palette.hex({ dmc: "White" }), samples.BLANC);
assert.equal(palette.hex({ dmc: "9999", hex: "#123456" }), "#123456");
assert.equal(palette.hex({ dmc: "3811", brand: "Anchor", hex: "#123456" }), "#123456");
assert.equal(palette.hex({ dmc: "3811", series: "Satin", hex: "#123456" }), "#123456");
assert.equal(palette.hex(null), "#d9dddd");
assert.equal(palette.hex({ dmc: "9999", hex: "invalid" }, "#222426"), "#222426");
const original = Object.freeze({ dmc: "3811", hex: "#2E6689", symbol: "A" });
assert.equal(palette.hex(original), samples["3811"]);
assert.equal(original.hex, "#2E6689", "Display lookup never rewrites an imported color");
console.log("DMC palette passed: 482 references, JSON/JS parity, known shades, lightness families, aliases, fallbacks and no mutation.");
