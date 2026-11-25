const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const model = require("../src/stitch-model.js");

function fixture() {
  const colors = ["310", "321", "BLANC"].map((dmc, i) => ({ dmc, symbol: "ABC"[i], hex: ["#222222", "#bd344b", "#ffffff"][i] }));
  const paths = [{ dmc: "310", points: [0, 1, 12, 13].map(x => ({ x, y: 0 })) },
    { dmc: "321", points: [0, 1, 2].map(x => ({ x, y: 2 })) }, { dmc: "BLANC", points: [] }];
  const cells = Array.from({ length: 16 * 3 }, (_, i) => {
    const x = i % 16, y = Math.floor(i / 16);
    const dmc = paths.find(p => p.points.some(p => p.x === x && p.y === y))?.dmc || null;
    return { x, y, dmc, empty: !dmc };
  });
  const project = { name: "Score du chemin" };
  const data = model.upgradePathsFile({ kind: "cross-stitch-paths", schemaVersion: 1, project, settings: { cutThreshold: 3 },
    pattern: { kind: "cross-stitch-pattern", schemaVersion: 1, project, colors, grid: { width: 16, height: 3, cells } }, paths });
  const route = data.paths[0];
  route.points[1].cutBefore = true;
  route.forcedCuts = [model.copy(route.points[1])];
  route.constraints.forcedCuts = route.forcedCuts;
  return data;
}

async function run() {
  const root = path.resolve(__dirname, ".."), output = path.join(root, "exports/verification");
  await fs.mkdir(output, { recursive: true });
  const saveNames = ["data/progress-state.json", "data/builtin-progress.js"];
  const saves = await Promise.all(saveNames.map(file => fs.readFile(path.join(root, file))));
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || "msedge" });
  const errors = [], data = fixture();
  const expected = (file, dmc) => model.metrics(file.paths.find(p => p.dmc === dmc).points, file.settings.cutThreshold, true).score
    .toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    page.on("pageerror", e => errors.push(e.message));
    page.on("dialog", dialog => dialog.accept());
    await page.route("**/data/builtin-progress.js", route => route.fulfill({ body: "window.BUILTIN_STITCH_PROGRESS = null;", contentType: "text/javascript" }));
    await page.goto(pathToFileURL(path.join(root, "stitch-progress.html")).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    assert.equal(await page.locator("#selectedPathScore").textContent(), "-");
    assert.equal(await page.locator("#selectedProgressPanel").isVisible(), false);
    await page.evaluate(() => {
      const original = StitchModel.metrics;
      window.scoreCalculations = 0;
      StitchModel.metrics = (...args) => { window.scoreCalculations++; return original(...args); };
    });
    const load = async file => {
      await page.locator("#pathsJsonFile").setInputFiles({ name: "score.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
      await page.waitForFunction(() => activeProgressStep === "stitch");
    };
    await load(data);
    assert.equal(await page.locator("#selectedPathScore").textContent(), expected(data, "BLANC"));
    await page.locator('#stitchColorLegend [data-dmc="310"]').click();
    assert.equal(await page.locator("#selectedPathScore").textContent(), expected(data, "310"));
    const calculations = await page.evaluate(() => scoreCalculations);
    await page.locator("#nextStitchButton").click();
    await page.locator("#nextStitchButton").click();
    assert.equal(await page.locator("#selectedPathScore").textContent(), expected(data, "310"), "Score is for the entire route, not the remaining work");
    assert.equal(await page.evaluate(() => scoreCalculations), calculations, "Progress does not rescan a potentially large route");
    await page.locator('#stitchColorLegend [data-dmc="321"]').click();
    assert.equal(await page.locator("#selectedPathScore").textContent(), expected(data, "321"));
    await page.locator('#stitchColorLegend [data-dmc="310"]').click();
    assert.equal(await page.locator("#selectedPathScore").textContent(), expected(data, "310"));
    assert.equal(await page.evaluate(() => scoreCalculations), calculations + 1, "Returning to a color uses its cached score");
    await page.evaluate(() => changeStitchCount("310", pathForDmc("310").points.length));
    assert.equal(await page.locator("#selectedPathScore").textContent(), expected(data, "310"), "Completed colors keep their route score");
    await page.evaluate(() => localSaveQueue);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert && activeProgressStep === "stitch");
    assert.equal(await page.locator("#selectedPathScore").textContent(), expected(data, "310"));
    assert.deepEqual(await page.evaluate(() => loadedPaths), model.upgradePathsFile(data), "Displaying a score does not change paths or exports");
    const changed = structuredClone(data);
    changed.settings.cutThreshold = 20;
    await load(changed);
    await page.locator('#stitchColorLegend [data-dmc="310"]').click();
    assert.notEqual(expected(changed, "310"), expected(data, "310"));
    assert.equal(await page.locator("#selectedPathScore").textContent(), expected(changed, "310"), "New files and their cut threshold replace old cached scores");
    await page.screenshot({ path: path.join(output, "stitch-path-score-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const fits = await page.locator("#selectedPathScore").evaluate(el => el.scrollWidth <= el.clientWidth);
    assert.ok(fits, "The score fits in its metric row");
    await page.screenshot({ path: path.join(output, "stitch-path-score-mobile.png"), fullPage: true });
    await page.locator("#resetProgressToolButton").click();
    assert.equal(await page.locator("#selectedPathScore").textContent(), "-");
    assert.equal(await page.locator("#selectedProgressPanel").isVisible(), false);
    assert.deepEqual(errors, []);
    for (let i = 0; i < saveNames.length; i++) assert.deepEqual(await fs.readFile(path.join(root, saveNames[i])), saves[i]);
    console.log("Stitch path score passed: exact shared score, natural/forced cuts, color changes, empty/completed paths, cache, reload, replacement, reset, desktop/mobile and untouched saves.");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
