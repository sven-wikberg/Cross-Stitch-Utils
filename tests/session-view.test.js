const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function run() {
  const root = path.resolve(__dirname, "..");
  const raw = (await fs.readFile(path.join(root, "data/builtin-progress.js"), "utf8")).trim();
  const save = JSON.parse(raw.slice(raw.indexOf("=") + 1).trim().replace(/;$/, ""));
  const longest = save.pathsFile.paths.reduce((a, b) => a.points.length > b.points.length ? a : b);
  const initialCount = Math.floor(longest.points.length / 2);
  Object.assign(save, { selectedDmc: longest.dmc, stitchedByDmc: { [longest.dmc]: initialCount }, zoom: 4, sessionMode: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || "msedge" });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  await context.route("https://api.github.com/**", route => route.abort());
  try {
    await page.goto(pathToFileURL(path.join(root, "stitch-progress.html")).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    await page.locator("#progressSaveFile").setInputFiles({ name: "session-test.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(save)) });
    await page.waitForFunction(() => activeProgressStep === "stitch" && sessionMode);

    async function checkCanvas() {
      const state = await page.evaluate(() => {
        const point = pathForDmc(selectedDmc).points[stitchedCountForDmc(selectedDmc)];
        const center = pointCenter(point, stitchView.cellSize);
        const radius = Math.max(3, Math.floor(stitchView.cellSize * 0.38));
        const ring = [...stitchCanvas.getContext("2d").getImageData(Math.round(center.x + radius), Math.round(center.y), 1, 1).data];
        return { width: stitchCanvas.width, height: stitchCanvas.height, viewportWidth: innerWidth, viewportHeight: innerHeight,
          view: stitchView, center, ring, count: stitchedCountForDmc(selectedDmc) };
      });
      assert.ok(state.width <= state.viewportWidth && state.height <= state.viewportHeight, "The close view canvas stays viewport-sized, even at 400% zoom");
      assert.ok(state.center.x > 26 && state.center.x < state.width && state.center.y > 26 && state.center.y < state.height);
      assert.ok(Math.abs(state.ring[0] - 180) < 20 && Math.abs(state.ring[1] - 75) < 20 && Math.abs(state.ring[2] - 87) < 20 && state.ring[3] === 255,
        `The current stitch marker must actually render, got ${state.ring}`);
      return state;
    }

    const initial = await checkCanvas();
    assert.ok(initial.view.startX > 0 && initial.view.startY > 0, "Exercise a cropped view away from the grid origin");
    for (let i = 0; i < 8; i++) {
      await page.locator("#nextStitchButton").click();
      assert.equal((await checkCanvas()).count, initialCount + i + 1);
    }
    await page.locator("#markUntilToggle").check();
    const position = await page.evaluate(() => {
      const center = pointCenter(pathForDmc(selectedDmc).points[stitchedCountForDmc(selectedDmc)], stitchView.cellSize);
      return { x: center.x, y: center.y };
    });
    await page.locator("#stitchCanvas").click({ position });
    assert.equal((await checkCanvas()).count, initialCount + 9, "Click correction uses the cropped grid's global coordinates");
    await page.evaluate(() => localSaveQueue);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert && sessionMode && activeProgressStep === "stitch");
    assert.equal((await checkCanvas()).count, initialCount + 9);
    await fs.mkdir(path.join(root, "exports/verification"), { recursive: true });
    await page.screenshot({ path: path.join(root, "exports/verification/session-large.png"), fullPage: true });
    while (await page.evaluate(() => stitchZoom > 1)) await page.locator("#zoomOutButton").click();
    await checkCanvas();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => stitchCanvas.width <= innerWidth);
    await checkCanvas();
    await page.screenshot({ path: path.join(root, "exports/verification/session-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.locator("#sessionModeButton").click();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const overview = await page.evaluate(() => {
      const point = pathForDmc(selectedDmc).points[stitchedCountForDmc(selectedDmc)];
      const center = pointCenter(point, stitchView.cellSize);
      const rect = stitchCanvas.getBoundingClientRect();
      const wrapper = stitchCanvas.parentElement.getBoundingClientRect();
      return { visible: rect.x + center.x > wrapper.left && rect.x + center.x < wrapper.right
        && rect.y + center.y > wrapper.top && rect.y + center.y < wrapper.bottom,
        mode: sessionMode, count: stitchedCountForDmc(selectedDmc), view: stitchView };
    });
    assert.equal(overview.mode, false);
    assert.equal(overview.visible, true, "Returning to overview keeps the current stitch visible");
    assert.equal(overview.count, initialCount + 9);
    assert.equal(overview.view.startX, 0);
    assert.deepEqual(errors, []);
    console.log("session view tests passed: real large pattern, 400% zoom, visible marker, following, click correction, reload, mobile, overview");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
