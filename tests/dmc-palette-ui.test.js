const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const model = require("../src/stitch-model.js");
const palette = require("../src/dmc-palette.js");

function fixture() {
  const project = { name: "Nuancier DMC actualise" };
  const colors = ["3810", "3811", "B5200", "9999"].map((dmc, i) => ({ dmc, symbol: "ABCD"[i],
    hex: ["#539FAB", "#2E6689", "#878783", "#123456"][i] }));
  return model.upgradePathsFile({ kind: "cross-stitch-paths", schemaVersion: 1, project,
    pattern: { kind: "cross-stitch-pattern", schemaVersion: 1, project, colors,
      grid: { width: 8, height: 6, cells: Array.from({ length: 48 }, (_, i) => {
        const x = i % 8, y = Math.floor(i / 8), color = x >= 1 && x <= 4 ? colors[y - 1] : null;
        return { x, y, dmc: color?.dmc || null, empty: !color };
      }) } }, paths: colors.map((color, y) => ({ dmc: color.dmc,
      points: Array.from({ length: 4 }, (_, i) => ({ x: i + 1, y: y + 1 })) })) });
}

async function run() {
  const root = path.resolve(__dirname, ".."), output = path.join(root, "exports/verification");
  await fs.mkdir(output, { recursive: true });
  const saves = ["data/progress-state.json", "data/builtin-progress.js"];
  const before = await Promise.all(saves.map(file => fs.readFile(path.join(root, file))));
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || "msedge" });
  const errors = [], data = fixture();
  const expected = Object.fromEntries(data.pattern.colors.map(color => [color.dmc, palette.hex(color)]));
  const upload = { name: "old-colors.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) };
  const rgb = hex => `rgb(${hex.slice(1).match(/../g).map(value => parseInt(value, 16)).join(", ")})`;
  async function open(name) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    await page.route(/^https?:/, route => route.abort());
    await page.route("**/data/builtin-progress.js", route => route.fulfill({ body: "window.BUILTIN_STITCH_PROGRESS = null;", contentType: "text/javascript" }));
    await page.goto(pathToFileURL(path.join(root, name)).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    return page;
  }
  async function checkSwatches(page, selector) {
    const actual = await page.locator(selector).evaluateAll(items => Object.fromEntries(items.map(item => [item.dataset.dmc,
      getComputedStyle(item.querySelector(".color-swatch")).backgroundColor])));
    for (const [code, color] of Object.entries(actual)) assert.equal(color, rgb(expected[code]), code);
    return actual;
  }
  try {
    const importer = await open("import-pattern.html");
    await importer.evaluate(pattern => localStorage.setItem(STORAGE_KEY, JSON.stringify(pattern)), data.pattern);
    await importer.reload();
    await importer.waitForFunction(() => !document.querySelector("main").inert);
    await importer.evaluate(() => goToStep("colors"));
    assert.deepEqual(await importer.evaluate(() => Object.fromEntries(pattern.colors.map(color => [color.dmc, color.hex]))), expected);
    assert.deepEqual(await importer.evaluate(() => Object.fromEntries(buildFinalPattern().colors.map(color => [color.dmc, color.hex]))), expected);
    await importer.screenshot({ path: path.join(output, "dmc-palette-import.png"), fullPage: true });

    const planner = await open("plan-paths.html");
    await planner.locator("#patternJsonFile").setInputFiles(upload);
    await planner.waitForFunction(() => activePathStep === "paths");
    assert.equal(Object.keys(await checkSwatches(planner, "#pathColorLegend [data-dmc]")).length, 4);
    const originalExport = await planner.evaluate(() => buildPathExport());
    const plannerPixel = await planner.evaluate(() => {
      const scale = pathViewport.state.scale;
      const x = GRID_RULER_SIZE + (1.25 - pathViewport.state.x) * scale;
      const y = GRID_RULER_SIZE + (2.4 - pathViewport.state.y) * scale;
      return { pixel: [...patternCanvas.getContext("2d").getImageData(Math.floor(x), Math.floor(y), 1, 1).data],
        expected: mutedHex("#BCE3E6"), workColor };
    });
    assert.deepEqual(plannerPixel.pixel.slice(0, 3), plannerPixel.expected.slice(1).match(/../g).map(value => parseInt(value, 16)));
    await planner.evaluate(() => { renderPathTool(); savePathPlannerState(); return plannerSaveQueue; });
    await planner.reload(); await planner.waitForFunction(() => !document.querySelector("main").inert);
    assert.deepEqual(await planner.evaluate(() => buildPathExport()), originalExport, "The palette does not alter paths, best scores or exported source colors");
    assert.deepEqual(await planner.evaluate(() => loadedPattern.colors), data.pattern.colors);
    assert.equal(await planner.evaluate(() => workColor), plannerPixel.workColor);
    await planner.locator('[data-step="paths"]').click();
    await checkSwatches(planner, "#pathColorLegend [data-dmc]");
    await planner.screenshot({ path: path.join(output, "dmc-palette-planner.png"), fullPage: true });

    const progress = await open("stitch-progress.html");
    await progress.locator("#pathsJsonFile").setInputFiles(upload);
    await progress.waitForFunction(() => activeProgressStep === "stitch");
    await progress.evaluate(() => {
      for (const color of loadedPaths.pattern.colors) changeStitchCount(color.dmc, 2);
      selectedDmc = "3811"; renderProgressTool();
    });
    assert.equal(Object.keys(await checkSwatches(progress, "#stitchColorLegend [data-dmc]")).length, 4);
    const pixels = await progress.evaluate(() => loadedPaths.pattern.colors.map((color, i) => {
      const pixel = holePixel({ x: 1.25, y: i + 1.45 }, stitchView.cellSize);
      return { dmc: color.dmc, rgba: [...stitchCanvas.getContext("2d").getImageData(Math.floor(pixel.x), Math.floor(pixel.y), 1, 1).data] };
    }));
    for (const pixel of pixels) assert.deepEqual(pixel.rgba, [...expected[pixel.dmc].slice(1).match(/../g).map(value => parseInt(value, 16)), 255], `Completed cell ${pixel.dmc}`);
    await progress.evaluate(() => changeStitchCount("B5200", pathForDmc("B5200").points.length));
    assert.equal(Object.keys(await checkSwatches(progress, "#completedColorList [data-dmc]")).length, 1);
    const state = await progress.evaluate(() => ({ paths: loadedPaths, counts: stitchedByDmc, selectedDmc, stats: stitchStats,
      score: selectedPathScore.textContent }));
    assert.deepEqual(state.paths, data);
    await progress.evaluate(() => localSaveQueue);
    await progress.screenshot({ path: path.join(output, "dmc-palette-progress.png"), fullPage: true });
    await progress.reload();
    await progress.waitForFunction(() => !document.querySelector("main").inert && activeProgressStep === "stitch");
    assert.deepEqual(await progress.evaluate(() => ({ paths: loadedPaths, counts: stitchedByDmc, selectedDmc, stats: stitchStats,
      score: selectedPathScore.textContent })), state, "Reload preserves progress, hashes, paths and statistics");
    assert.deepEqual(await progress.evaluate(() => buildProgressSave().pathsFile), data);
    await checkSwatches(progress, "#stitchColorLegend [data-dmc]");
    await progress.setViewportSize({ width: 390, height: 844 });
    await progress.evaluate(() => { sessionMode = true; renderProgressTool(); });
    await progress.screenshot({ path: path.join(output, "dmc-palette-mobile.png"), fullPage: true });
    assert.deepEqual(errors, []);
    for (let i = 0; i < saves.length; i++) assert.deepEqual(await fs.readFile(path.join(root, saves[i])), before[i]);
    console.log("DMC palette UI passed: all three tools, legacy imports/drafts, swatches, canvas pixels, completed colors, unknown fallback, reload and unchanged paths/progress/saves.");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
