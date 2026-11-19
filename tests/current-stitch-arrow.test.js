const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function run() {
  const root = path.resolve(__dirname, "..");
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || "msedge" });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://api.github.com/**", route => route.abort());
    await page.goto(pathToFileURL(path.join(root, "stitch-progress.html")).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    const checks = await page.evaluate(() => {
      const gallery = document.createElement("canvas"); gallery.id = "arrowGallery";
      gallery.width = 1000; gallery.height = 760;
      const output = gallery.getContext("2d");
      output.fillStyle = "#ffffff"; output.fillRect(0, 0, gallery.width, gallery.height);
      const originalView = stitchView;
      stitchView = { startX: 0, startY: 0 };
      const results = [];
      const cases = [
        { diagonal: "lower", direction: 1 }, { diagonal: "lower", direction: -1 },
        { diagonal: "upper", direction: 1 }, { diagonal: "upper", direction: -1 }
      ];
      const backgrounds = ["#ffffff", "#212121", "#c63848", "#368f60"];
      for (const [row, size] of [8, 18, 44, 88].entries()) {
        for (const [column, data] of cases.entries()) {
          const sample = document.createElement("canvas"); sample.width = 180; sample.height = 180;
          const context = sample.getContext("2d");
          context.fillStyle = backgrounds[column]; context.fillRect(0, 0, 180, 180);
          const point = { x: 0, y: 0, ...data };
          drawCurrentStitchArrow(context, point, size);
          const holes = StitchModel.holes(point);
          const from = holePixel(holes.start, size), to = holePixel(holes.end, size);
          const length = Math.hypot(to.x - from.x, to.y - from.y);
          const dx = (to.x - from.x) / length, dy = (to.y - from.y) / length;
          const pixel = (x, y) => [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
          const red = value => Math.abs(value[0] - 198) < 20 && Math.abs(value[1] - 56) < 20 && Math.abs(value[2] - 72) < 20;
          const white = value => value.slice(0, 3).every(channel => channel > 235);
          const near = (x, y, predicate) => [-1, 0, 1].some(a => [-1, 0, 1].some(b => predicate(pixel(x + a, y + b))));
          const center = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
          const wideHead = pixel(to.x - dx * size * 0.25 - dy * size * 0.08,
            to.y - dy * size * 0.25 + dx * size * 0.08);
          // At a strong zoom, the filled head must cover a visible triangle, not a small dot.
          results.push({ size, ...data, shaft: near(center.x, center.y, red),
            start: white(pixel(from.x, from.y)), head: size < 44 || red(wideHead),
            halo: size < 44 || near(center.x - dy * (size * 0.0275 + 1.2), center.y + dx * (size * 0.0275 + 1.2), white),
            restoredAlpha: context.globalAlpha === 1 });
          const x = column * 250, y = row * 190;
          output.drawImage(sample, x + 10, y + 10);
          output.fillStyle = "#222426"; output.font = "14px system-ui";
          output.fillText(`${size}px / ${data.diagonal} / ${data.direction}`, x + 10, y + 185);
        }
      }
      stitchView = originalView;
      document.body.replaceChildren(gallery);
      return results;
    });
    await fs.mkdir(path.join(root, "exports/verification"), { recursive: true });
    await page.locator("#arrowGallery").screenshot({ path: path.join(root, "exports/verification/current-stitch-arrows.png") });
    for (const check of checks) {
      const label = JSON.stringify(check);
      assert.ok(check.shaft, `Visible red shaft: ${label}`);
      assert.ok(check.start, `Hollow white departure hole: ${label}`);
      assert.ok(check.head, `Proportional filled directional head: ${label}`);
      assert.ok(check.halo, `Contrasting halo: ${label}`);
      assert.ok(check.restoredAlpha, label);
    }
    assert.deepEqual(errors, []);
    console.log("Current stitch arrows passed: four directions, four scales, light/dark/red/green backgrounds, filled heads and hollow starts.");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
