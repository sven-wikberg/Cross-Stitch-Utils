const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const model = require("../src/stitch-model.js");

function fixture() {
  const project = { name: "Diagonales voisines" };
  const row = Array.from({ length: 11 }, (_, x) => ({ x: x + 1, y: 2 }));
  const data = model.upgradePathsFile({ kind: "cross-stitch-paths", schemaVersion: 1, project, settings: { cutThreshold: 10 },
    pattern: { kind: "cross-stitch-pattern", schemaVersion: 1, project,
      colors: [{ dmc: "310", hex: "#303030", symbol: "A" }, { dmc: "321", hex: "#b82b39", symbol: "B" }],
      grid: { width: 14, height: 6, cells: Array.from({ length: 84 }, (_, i) => {
        const x = i % 14, y = Math.floor(i / 14), dmc = y === 2 && x >= 1 && x <= 11 ? "310" : x === 1 && y === 4 ? "321" : null;
        return { x, y, dmc, empty: !dmc };
      }) } }, paths: [{ dmc: "310", points: row }, { dmc: "321", points: [{ x: 1, y: 4 }] }] });
  data.paths[0].points = [...row.map(p => ({ ...p, diagonal: "lower", direction: 1 })),
    ...row.toReversed().map(p => ({ ...p, diagonal: "upper", direction: 1 }))];
  return model.upgradePathsFile(data);
}

async function run() {
  const root = path.resolve(__dirname, ".."), output = path.join(root, "exports/verification");
  await fs.mkdir(output, { recursive: true });
  const saveFiles = ["data/progress-state.json", "data/builtin-progress.js"];
  const originalSaves = await Promise.all(saveFiles.map(file => fs.readFile(path.join(root, file))));
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || "msedge" });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    await page.route(/^https?:/, route => route.abort());
    await page.route("**/data/builtin-progress.js", route => route.fulfill({ body: "window.BUILTIN_STITCH_PROGRESS = null;", contentType: "text/javascript" }));
    await page.goto(pathToFileURL(path.join(root, "stitch-progress.html")).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    const data = fixture();
    await page.locator("#pathsJsonFile").setInputFiles({ name: "context.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(() => activeProgressStep === "stitch");
    await page.locator('#stitchColorLegend [data-dmc="310"]').click();
    await page.evaluate(() => changeStitchCount("310", 5));
    const checks = await page.evaluate(() => {
      const before = JSON.stringify({ loadedPaths, stitchedByDmc, stitchStats });
      const originalView = stitchView;
      stitchView = { startX: 0, startY: 0, width: 14, height: 6, cellSize: 44 };
      const canvas = document.createElement("canvas"); canvas.width = 700; canvas.height = 300;
      const ctx = canvas.getContext("2d"), strokes = [];
      const nativeStroke = ctx.stroke.bind(ctx);
      ctx.stroke = function (...args) {
        strokes.push({ color: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth, dash: this.getLineDash() });
        nativeStroke(...args);
      };
      const points = pathForDmc("310").points;
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawStitchContext(ctx, points, 5, 44);
      const highlighted = strokes.filter(s => [STITCH_PREVIOUS_COLOR, STITCH_NEXT_COLOR].includes(s.color));
      const contrasts = side => [1, 2, 3, 4].map(distance => {
        const point = points[5 + side * distance], center = pointCenter(point, 44);
        const pixel = ctx.getImageData(Math.floor(center.x), Math.floor(center.y), 1, 1).data;
        return Math.hypot(255 - pixel[0], 255 - pixel[1], 255 - pixel[2]);
      });
      const pixels = { previous: contrasts(-1), next: contrasts(1) };
      const cases = [0, 1, points.length - 1, points.length].map(count => {
        strokes.length = 0; drawStitchContext(ctx, points, count, 44);
        return { count, previous: strokes.filter(s => s.color === STITCH_PREVIOUS_COLOR && !s.dash.length).length,
          next: strokes.filter(s => s.color === STITCH_NEXT_COLOR && !s.dash.length).length };
      });
      strokes.length = 0;
      const forced = points.map(p => ({ ...p })); forced[7].cutBefore = true;
      drawStitchContext(ctx, forced, 5, 44);
      const cut = strokes.filter(s => s.color === "#c63848");
      const futureLinks = strokes.filter(s => s.color === STITCH_NEXT_COLOR && s.dash.length);
      const alphaRestored = ctx.globalAlpha === 1;
      const originalMode = sessionMode;
      const renderChecks = [false, true].map(mode => {
        sessionMode = mode;
        strokes.length = 0;
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        drawStitchProgress(ctx, 44);
        const whiteAt = (x, y) => [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data].every(value => value === 255);
        const future = pointCenter(points[10], 44), past = pointCenter(points[0], 44);
        const upper = holePixel({ x: points.at(-1).x + 0.25, y: 2.25 }, 44);
        const link = holePixel({ x: points[10].x, y: 2.25 }, 44);
        return { mode, noFadedBase: strokes.every(s => s.alpha !== 0.2),
          futureHidden: whiteAt(future.x, future.y), upperHidden: whiteAt(upper.x, upper.y),
          futureLinkHidden: whiteAt(link.x, link.y), pastVisible: !whiteAt(past.x, past.y) };
      });
      sessionMode = originalMode;
      stitchView = originalView;
      return { highlighted, pixels, cases, cut, futureLinks, alphaRestored, renderChecks,
        unchanged: JSON.stringify({ loadedPaths, stitchedByDmc, stitchStats }) === before };
    });
    assert.equal(checks.highlighted.filter(s => !s.dash.length).length, 8, "Four diagonals on each side");
    assert.equal(checks.highlighted.filter(s => s.dash.length).length, 8, "Four connecting back-side links on each side");
    for (const color of ["#ad600e", "#087cb6"]) {
      for (const dashed of [false, true]) assert.deepEqual(checks.highlighted.filter(s => s.color === color && Boolean(s.dash.length) === dashed)
        .map(s => s.alpha), [0.3, 0.5, 0.72, 0.95], "Nearest is strongest and drawn last");
    }
    for (const values of Object.values(checks.pixels)) assert.ok(values.every((value, i) => !i || value < values[i - 1]), "Actual canvas pixels fade with distance");
    assert.deepEqual(checks.cases.map(({ previous, next }) => [previous, next]), [[0, 4], [1, 4], [4, 0], [0, 0]]);
    assert.equal(checks.cut.length, 1); assert.equal(checks.cut[0].alpha, 0.72);
    assert.ok(checks.cut[0].dash[0] > 2); assert.equal(checks.futureLinks.length, 3, "Cuts stay red, not blue thread links");
    assert.ok(checks.alphaRestored && checks.unchanged);
    for (const check of checks.renderChecks) {
      assert.ok(check.noFadedBase && check.futureHidden && check.upperHidden && check.futureLinkHidden,
        `No residual future diagonals or back-side links: ${JSON.stringify(check)}`);
      assert.ok(check.pastVisible, "Already stitched diagonals remain visible");
    }

    await page.evaluate(() => {
      window.contextFrames = [];
      const original = drawStitchContext;
      drawStitchContext = (...args) => { contextFrames.push({ dmc: selectedDmc, count: args[2] }); return original(...args); };
      stitchZoom = 2; renderProgressTool();
    });
    await page.screenshot({ path: path.join(output, "stitch-context-desktop.png"), fullPage: true });
    await page.locator("#nextStitchButton").click();
    assert.equal(await page.evaluate(() => contextFrames.at(-1).count), 6);
    await page.locator("#undoStitchButton").click();
    assert.equal(await page.evaluate(() => contextFrames.at(-1).count), 5);
    await page.locator("#sessionModeButton").click();
    assert.equal(await page.evaluate(() => contextFrames.at(-1).count), 5);
    await page.locator('#stitchColorLegend [data-dmc="321"]').click();
    assert.deepEqual(await page.evaluate(() => contextFrames.at(-1)), { dmc: "321", count: 0 });
    await page.locator('#stitchColorLegend [data-dmc="310"]').click();
    await page.evaluate(() => localSaveQueue);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert && activeProgressStep === "stitch");
    assert.equal(await page.evaluate(() => stitchedCountForDmc("310")), 5);
    assert.deepEqual(await page.evaluate(() => loadedPaths), data, "Rendering never rewrites paths");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => stitchCanvas.width <= innerWidth);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, "stitch-context-mobile.png"), fullPage: true });
    assert.deepEqual(errors, []);
    for (let i = 0; i < saveFiles.length; i++) assert.deepEqual(await fs.readFile(path.join(root, saveFiles[i])), originalSaves[i]);
    console.log("Stitch context passed: 4 previous/next diagonals and links, no residual future path, fading pixels, red cuts, boundaries, advance/back, color changes, zoom/session/mobile, reload and untouched saves.");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
