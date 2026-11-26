const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const model = require("../src/stitch-model.js");

function fixture() {
  const project = { name: "Fil restant" }, colors = [{ dmc: "3810", hex: "#488E9A" }, { dmc: "3811", hex: "#BCE3E6" }];
  const groups = [Array.from({ length: 50 }, (_, i) => ({ x: i < 25 ? i : i + 15, y: 0 })),
    Array.from({ length: 4 }, (_, x) => ({ x, y: 2 }))];
  const paths = colors.map((color, i) => ({ dmc: color.dmc, points: model.expandCells(groups[i]) }));
  paths[0].points[3].cutBefore = true;
  paths[1].points[1].cutBefore = true;
  return model.upgradePathsFile({ kind: "cross-stitch-paths", schemaVersion: 2, stitchUnit: "diagonal", project,
    settings: { cutThreshold: 10 }, paths,
    pattern: { kind: "cross-stitch-pattern", schemaVersion: 1, project, colors,
      grid: { width: 65, height: 3, cells: Array.from({ length: 195 }, (_, i) => {
        const x = i % 65, y = Math.floor(i / 65), color = groups.findIndex(cells => cells.some(p => p.x === x && p.y === y));
        return { x, y, dmc: colors[color]?.dmc || null, empty: color < 0 };
      }) } } });
}

async function run() {
  const root = path.resolve(__dirname, ".."), output = path.join(root, "exports/verification");
  await fs.mkdir(output, { recursive: true });
  const files = ["data/progress-state.json", "data/builtin-progress.js"];
  const originalFiles = await Promise.all(files.map(file => fs.readFile(path.join(root, file))));
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || "msedge" });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    await page.route(/^https?:/, route => route.abort());
    await page.route("**/data/builtin-progress.js", route => route.fulfill({ body: "window.BUILTIN_STITCH_PROGRESS = null;", contentType: "text/javascript" }));
    await page.goto(pathToFileURL(path.join(root, "stitch-progress.html")).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    assert.equal(await page.locator("#remainingThreadEstimate").isVisible(), false);
    const data = fixture();
    await page.evaluate(() => localStorage.setItem("cross-stitch-path-thread-capacity", "7"));
    await page.locator("#pathsJsonFile").setInputFiles({ name: "remaining.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(() => activeProgressStep === "stitch");
    const counts = dmc => page.locator(`#remainingThreadRows [data-dmc="${dmc}"]`).evaluate(row =>
      Object.fromEntries([...row.querySelectorAll("[data-quantity]")].map(td => [td.dataset.quantity, Number(td.textContent.replace(/\s/g, ""))])));
    assert.equal(await page.locator("#remainingThreadCapacityInput").inputValue(), "45");
    assert.deepEqual(await page.locator("#remainingThreadRows tr").evaluateAll(rows => rows.map(row => row.dataset.dmc)), ["3811", "3810"]);
    assert.deepEqual(await counts("3810"), { diagonals: 100, cuts: 2, currentDiagonals: 0, strands: 5, pieces: 1 });
    assert.deepEqual(await counts("3811"), { diagonals: 8, cuts: 1, currentDiagonals: 0, strands: 2, pieces: 1 });
    assert.equal(await page.locator('#remainingThreadTotals [data-quantity="pieces"]').textContent(), "2");
    await page.locator('#stitchColorLegend [data-dmc="3811"]').click();
    await page.locator("#nextStitchButton").click();
    assert.deepEqual(await counts("3811"), { diagonals: 7, cuts: 1, currentDiagonals: 0, strands: 1, pieces: 1 });
    await page.locator("#changeThreadButton").click();
    await page.locator("#nextStitchButton").click();
    assert.deepEqual(await counts("3811"), { diagonals: 6, cuts: 0, currentDiagonals: 6, strands: 0, pieces: 0 });
    await page.locator("#changeThreadButton").click();
    assert.equal((await counts("3811")).strands, 1, "Finishing the current thread removes its credit");
    await page.locator("#undoActionButton").click();
    assert.equal((await counts("3811")).strands, 0);
    await page.locator("#redoActionButton").click();
    assert.equal((await counts("3811")).strands, 1);
    await page.locator("#undoActionButton").click();
    await page.evaluate(() => localSaveQueue);
    const beforeSettings = await page.evaluate(() => ({ paths: loadedPaths, stats: stitchStats, counts: stitchedByDmc, save: latestLocalState }));
    await page.locator("#remainingThreadCapacityInput").fill("1");
    assert.equal((await counts("3811")).strands, 6);
    assert.equal((await counts("3810")).pieces, 17);
    for (const invalid of ["0", "-1", "1.5", ""]) {
      await page.locator("#remainingThreadCapacityInput").fill(invalid);
      assert.equal(await page.locator("#remainingThreadCapacityError").isVisible(), true);
      assert.equal((await counts("3811")).strands, 6);
    }
    await page.locator("#remainingThreadCapacityInput").fill("47");
    assert.equal(await page.locator("#remainingThreadCapacityError").isVisible(), false);
    assert.deepEqual(await page.evaluate(() => ({ paths: loadedPaths, stats: stitchStats, counts: stitchedByDmc, save: latestLocalState })), beforeSettings);
    assert.equal(await page.evaluate(() => localStorage.getItem("cross-stitch-path-thread-capacity")), "7", "Tool 2 settings are independent");
    await page.evaluate(() => localSaveQueue);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert && activeProgressStep === "stitch");
    assert.equal(await page.locator("#remainingThreadCapacityInput").inputValue(), "47");
    assert.equal((await counts("3811")).currentDiagonals, 6);
    assert.deepEqual(await page.evaluate(() => loadedPaths), data);

    await page.evaluate(() => {
      changeStitchCount("3811", pathForDmc("3811").points.length);
      selectedDmc = "3810"; changeStitchCount("3810", 10);
    });
    assert.deepEqual(await counts("3811"), { diagonals: 0, cuts: 0, currentDiagonals: 0, strands: 0, pieces: 0 });
    assert.equal(await page.locator("#remainingThreadNote").isVisible(), true, "Unrecorded cut does not invent current capacity");
    await page.locator("#changeThreadButton").click();
    await page.locator("#nextStitchButton").click();
    assert.equal(await page.locator("#remainingThreadNote").isVisible(), false);
    assert.equal((await counts("3810")).currentDiagonals, 39);
    const estimator = await page.evaluate(() => {
      const original = remainingThreadCache.get(pathForDmc("3810").points).estimator;
      changeStitchCount("3810", 12);
      return original === remainingThreadCache.get(pathForDmc("3810").points).estimator;
    });
    assert.equal(estimator, true, "Advancing reuses the precomputed cut index");
    await page.locator("#remainingThreadEstimate").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "remaining-thread-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#remainingThreadEstimate").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "remaining-thread-mobile.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator("#remainingThreadEstimate .thread-estimate-scroll").evaluate(node => node.scrollWidth > node.clientWidth), true);
    const save = await page.evaluate(() => buildProgressSave());
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#downloadProgressSaveButton").click();
    const download = await downloadPromise;
    const saved = JSON.parse(await fs.readFile(await download.path(), "utf8"));
    for (const field of ["pathsFile", "stitchStats", "stitchedByDmc"]) assert.deepEqual(saved[field], save[field]);
    // Old saves without thread history remain usable and do not receive invented capacity.
    delete save.stitchStats;
    await page.locator('[data-step="load"]').click();
    await page.locator("#progressSaveFile").setInputFiles({ name: "old.progress.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(save)) });
    await page.waitForFunction(() => activeProgressStep === "stitch");
    assert.equal((await counts("3810")).currentDiagonals, 0);
    await page.locator("#nextStitchButton").click();
    assert.equal(await page.locator("#remainingThreadNote").isVisible(), true);
    assert.equal((await counts("3810")).currentDiagonals, 0);
    assert.deepEqual(errors, []);
    for (let i = 0; i < files.length; i++) assert.deepEqual(await fs.readFile(path.join(root, files[i])), originalFiles[i]);
    console.log("Remaining thread UI passed: progress/cuts/current threads, undo/redo, completed colors, settings/reload, old saves, indexed queries, unchanged paths/stats/saves, desktop/mobile.");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
