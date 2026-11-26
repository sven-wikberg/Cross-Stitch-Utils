const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const model = require("../src/stitch-model.js");

function fixture() {
  const colors = [{ dmc: "3810", hex: "#488E9A" }, { dmc: "3811", hex: "#BCE3E6" }, { dmc: "BLANC", hex: "#FCFBF8" }];
  const cellsByColor = [Array.from({ length: 50 }, (_, i) => ({ x: i < 25 ? i : i + 15, y: 0 })),
    Array.from({ length: 4 }, (_, x) => ({ x, y: 2 })), []];
  const paths = colors.map((color, i) => ({ dmc: color.dmc, points: model.expandCells(cellsByColor[i]) }));
  paths[0].points[3].cutBefore = true;
  paths[1].points[1].cutBefore = true;
  const project = { name: "Estimation de fil" };
  return { kind: "cross-stitch-paths", schemaVersion: 2, stitchUnit: "diagonal", project, settings: { cutThreshold: 10 }, paths,
    pattern: { kind: "cross-stitch-pattern", schemaVersion: 1, project, colors,
      grid: { width: 65, height: 3, cells: Array.from({ length: 195 }, (_, i) => {
        const x = i % 65, y = Math.floor(i / 65), index = cellsByColor.findIndex(cells => cells.some(p => p.x === x && p.y === y));
        return { x, y, dmc: index < 0 ? null : colors[index].dmc, empty: index < 0 };
      }) } } };
}

async function run() {
  const root = path.resolve(__dirname, ".."), output = path.join(root, "exports/verification");
  await fs.mkdir(output, { recursive: true });
  const protectedFiles = ["data/progress-state.json", "data/builtin-progress.js"];
  const beforeFiles = await Promise.all(protectedFiles.map(file => fs.readFile(path.join(root, file))));
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || "msedge" });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:/, route => route.abort());
    await page.goto(pathToFileURL(path.join(root, "plan-paths.html")).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    assert.equal(await page.locator("#threadEstimate").isVisible(), false);
    const data = fixture();
    model.upgradePathsFile(data);
    await page.locator("#patternJsonFile").setInputFiles({ name: "estimate.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(() => activePathStep === "paths");
    assert.equal(await page.locator("#threadEstimate").isVisible(), false);
    const original = await page.evaluate(() => ({ exported: buildPathExport(), best: bestPathsByDmc, constraints: constraintsByDmc }));
    await page.locator('[data-step="export"]').click();
    const counts = () => page.locator("#threadEstimateRows tr").evaluateAll(rows => rows.map(row => ({ dmc: row.dataset.dmc,
      ...Object.fromEntries([...row.querySelectorAll("[data-quantity]")].map(td => [td.dataset.quantity, Number(td.textContent.replace(/\s/g, ""))])) })));
    assert.equal(await page.locator("#threadCapacityInput").inputValue(), "45");
    assert.deepEqual(await counts(), [
      { dmc: "BLANC", diagonals: 0, cuts: 0, strands: 0, pieces: 0, skeins: 0 },
      { dmc: "3811", diagonals: 8, cuts: 1, strands: 2, pieces: 1, skeins: 1 },
      { dmc: "3810", diagonals: 100, cuts: 2, strands: 5, pieces: 1, skeins: 1 }
    ]);
    assert.equal(await page.locator('#threadEstimateTotals [data-quantity="skeins"]').textContent(), "2", "Different colors cannot share a skein");
    await page.screenshot({ path: path.join(output, "thread-estimate-desktop.png"), fullPage: true });
    await page.locator("#threadCapacityInput").fill("1");
    assert.deepEqual((await counts()).at(-1), { dmc: "3810", diagonals: 100, cuts: 2, strands: 100, pieces: 17, skeins: 2 });
    assert.equal(await page.locator('#threadEstimateTotals [data-quantity="pieces"]').textContent(), "19");
    await page.locator("#threadCapacityInput").fill("47");
    assert.equal((await counts()).at(-1).strands, 4);
    for (const invalid of ["0", "-1", "1.5", ""]) {
      await page.locator("#threadCapacityInput").fill(invalid);
      assert.equal(await page.locator("#threadCapacityError").isVisible(), true);
      assert.equal((await counts()).at(-1).strands, 4);
    }
    await page.locator("#threadCapacityInput").fill("47");
    assert.equal(await page.locator("#threadCapacityError").isVisible(), false);
    assert.deepEqual(await page.evaluate(() => ({ exported: buildPathExport(), best: bestPathsByDmc, constraints: constraintsByDmc })), original);
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#downloadPathJsonButton").click();
    const download = await downloadPromise;
    assert.deepEqual(JSON.parse(await fs.readFile(await download.path(), "utf8")), original.exported);
    await page.evaluate(() => plannerSaveQueue);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert);
    await page.locator('[data-step="export"]').click();
    assert.equal(await page.locator("#threadCapacityInput").inputValue(), "47");
    assert.equal((await counts()).at(-1).strands, 4);
    await page.locator("#threadCapacityInput").fill("45");
    await page.locator("#backToPathsButton").click();
    await page.locator("#cutThresholdInput").fill("100");
    await page.locator("#cutThresholdInput").dispatchEvent("change");
    await page.locator('[data-step="export"]').click();
    assert.deepEqual((await counts()).at(-1), { dmc: "3810", diagonals: 100, cuts: 1, strands: 4, pieces: 1, skeins: 1 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, "thread-estimate-mobile.png"), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No horizontal page overflow");
    const scroll = page.locator(".thread-estimate-scroll");
    assert.equal(await scroll.evaluate(node => node.scrollWidth > node.clientWidth), true, "Mobile table remains scrollable");
    assert.deepEqual(errors, []);
    for (let i = 0; i < protectedFiles.length; i++) assert.deepEqual(await fs.readFile(path.join(root, protectedFiles[i])), beforeFiles[i]);
    console.log("Thread estimate UI passed: step 3, ascending colors, counts and totals, settings, validation, reload, threshold changes, unchanged export/best paths/saves, desktop/mobile.");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
