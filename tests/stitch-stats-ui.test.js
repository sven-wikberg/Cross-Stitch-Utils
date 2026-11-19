const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");

function fixture() {
  const colors = [{ dmc: "310", hex: "#265b52", symbol: "A" }, { dmc: "321", hex: "#c63848", symbol: "B" }];
  const points = Array.from({ length: 60 }, (_, i) => ({ x: i % 10 + 3, y: Math.floor(i / 10) + 3 }));
  const red = [{ x: 15, y: 5 }, { x: 16, y: 5 }, { x: 15, y: 6 }, { x: 16, y: 6 }];
  const paths = [{ dmc: "310", points }, { dmc: "321", points: red }];
  const cells = Array.from({ length: 22 * 15 }, (_, i) => {
    const x = i % 22, y = Math.floor(i / 22);
    const dmc = paths.find(route => route.points.some(point => point.x === x && point.y === y))?.dmc || null;
    return { x, y, dmc, empty: !dmc };
  });
  const project = { name: "Journal de broderie - verification" };
  return { kind: "cross-stitch-paths", schemaVersion: 1, project,
    pattern: { kind: "cross-stitch-pattern", schemaVersion: 1, project, colors, grid: { width: 22, height: 15, cells } }, paths };
}

async function run() {
  const output = path.join(root, "exports", "verification");
  await fs.mkdir(output, { recursive: true });
  const saveNames = ["data/progress-state.json", "data/builtin-progress.js"];
  const originalSaves = await Promise.all(saveNames.map(name => fs.readFile(path.join(root, name))));
  const server = http.createServer(async (req, res) => {
    try {
      const filename = path.resolve(root, `.${decodeURIComponent(new URL(req.url, "http://localhost").pathname)}`);
      if (!filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
      if (filename.endsWith("builtin-progress.js")) { res.end("window.BUILTIN_STITCH_PROGRESS = null;"); return; }
      res.setHeader("Content-Type", filename.endsWith(".html") ? "text/html" : filename.endsWith(".js") ? "text/javascript"
        : filename.endsWith(".svg") ? "image/svg+xml" : "text/css");
      res.end(await fs.readFile(filename));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/stitch-progress.html`;
  let browser;
  const errors = [], remote = new Map();
  let version = 0;
  const github = async route => {
    const request = route.request(), key = new URL(request.url()).pathname.split("/contents/")[1];
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const file = remote.get(key);
    if (request.method() === "PUT") {
      const body = request.postDataJSON();
      if ((file?.sha || null) !== (body.sha || null)) return reply(409, {});
      const saved = { sha: `stats-${++version}`, data: JSON.parse(Buffer.from(body.content, "base64").toString("utf8")) };
      remote.set(key, saved); return reply(200, { content: { sha: saved.sha } });
    }
    return file ? reply(200, { sha: file.sha, encoding: "base64", content: Buffer.from(JSON.stringify(file.data)).toString("base64") }) : reply(404, {});
  };
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || "msedge" });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, timezoneId: "Europe/Zurich" });
    await context.route("https://api.github.com/**", github);
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    await page.goto(url);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    assert.equal(await page.locator("#activityProgressPanel").isVisible(), false);
    await page.locator("#pathsJsonFile").setInputFiles({ name: "stats.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture())) });
    await page.waitForFunction(() => activeProgressStep === "stitch");
    const advance = async count => { for (let i = 0; i < count; i++) await page.locator("#nextStitchButton").click(); };
    await advance(2);
    await page.locator("body").click({ position: { x: 1595, y: 5 } });
    for (let i = 0; i < 3; i++) await page.keyboard.down("Space");
    await page.keyboard.up("Space");
    assert.equal(await page.locator("#todayDiagonals").innerText(), "5");
    await page.locator("#changeThreadButton").click();
    assert.equal(await page.locator("#changeThreadButton").isDisabled(), true);
    assert.equal(await page.locator("#threadDiagonalAverage").innerText(), "5");
    const marker = await page.evaluate(() => {
      const hit = threadMarkerHits[0];
      const pixel = [...stitchCanvas.getContext("2d").getImageData(Math.round(hit.x + 5), Math.round(hit.y + 4), 1, 1).data];
      const current = pathForDmc(selectedDmc).points[stitchedCountForDmc(selectedDmc)];
      const corner = holePixel(current, stitchView.cellSize);
      const overlapsCurrent = hit.x + hit.radius > corner.x && hit.x - hit.radius < corner.x + stitchView.cellSize
        && hit.y + hit.radius > corner.y && hit.y - hit.radius < corner.y + stitchView.cellSize;
      return { count: threadMarkerHits.length, pixel, overlapsCurrent };
    });
    assert.equal(marker.count, 1);
    assert.equal(marker.overlapsCurrent, false, "Thread badges leave the current diagonal unobstructed");
    assert.deepEqual(marker.pixel, [23, 103, 155, 255], "Thread marker is actually rendered in the canvas");
    await page.locator("#threadMarkersToggle").uncheck();
    assert.equal(await page.evaluate(() => threadMarkerHits.length), 0);
    await page.locator("#threadMarkersToggle").check();
    await page.locator("#undoActionButton").click();
    assert.equal(await page.evaluate(() => threadMarkerHits.length), 0);
    assert.equal(await page.locator("#todayDiagonals").innerText(), "5");
    await page.evaluate(() => localSaveQueue);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert && activeProgressStep === "stitch");
    await page.locator("#redoActionButton").click();
    assert.equal(await page.evaluate(() => threadMarkerHits.length), 1, "Thread undo history survives reload");
    await advance(3);
    assert.match(await page.locator("#currentThreadLabel").innerText(), /2/);
    assert.equal(await page.locator("#currentThreadDiagonals").innerText(), "3 diag.");
    await page.locator('#stitchColorLegend [data-dmc="321"]').click();
    await advance(2);
    await page.locator("#changeThreadButton").click();
    assert.equal(await page.locator("#threadDiagonalAverage").innerText(), "3,5");
    await page.locator('#stitchColorLegend [data-dmc="310"]').click();
    assert.equal(await page.locator("#currentThreadDiagonals").innerText(), "3 diag.");
    await page.locator("#changeThreadButton").click();
    const saved = await page.evaluate(() => buildProgressSave());
    assert.equal(saved.stitchStats.colors["310"].threads.length, 2);
    assert.equal(await page.locator("#threadHistory tr").count(), 3);
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#downloadProgressSaveButton").click();
    const download = await downloadPromise;
    const downloaded = JSON.parse(await fs.readFile(await download.path(), "utf8"));
    assert.deepEqual(downloaded.stitchStats, saved.stitchStats);

    await page.evaluate(() => localStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, "test-stats-token"));
    await page.locator("#writeBuiltinProgressButton").click();
    await page.waitForFunction(() => !githubSyncInProgress);
    assert.match(await page.locator("#syncStateText").innerText(), /Synchronise le/);
    assert.deepEqual(remote.get("data/progress-state.json").data.stitchStats, saved.stitchStats);
    assert.equal(remote.get("data/progress-state.json").data.undoActions, undefined);
    const otherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await otherContext.route("https://api.github.com/**", github);
    const other = await otherContext.newPage();
    other.on("pageerror", error => errors.push(error.message));
    other.on("dialog", dialog => dialog.accept());
    await other.goto(url); await other.waitForFunction(() => !document.querySelector("main").inert);
    await other.locator("#loadBuiltinProgressButton").click();
    await other.waitForFunction(() => activeProgressStep === "stitch" && !githubSyncInProgress);
    assert.deepEqual(await other.evaluate(() => stitchStats), saved.stitchStats);
    assert.equal(await other.evaluate(() => threadMarkerHits.length), 2);

    await advance(1);
    await page.locator("#writeBuiltinProgressButton").click();
    await page.waitForFunction(() => !githubSyncInProgress);
    const beforeThreadSync = version;
    const beforeThreadCounts = await page.evaluate(() => ({ ...stitchedByDmc }));
    await page.locator("#changeThreadButton").click();
    await page.evaluate(() => localSaveQueue);
    assert.match(await page.locator("#syncStateText").innerText(), /Modifications locales/);
    await page.locator("#writeBuiltinProgressButton").click();
    await page.waitForFunction(() => !githubSyncInProgress);
    assert.equal(version, beforeThreadSync + 1, "A thread-only change syncs even without new diagonals");
    assert.deepEqual(await page.evaluate(() => stitchedByDmc), beforeThreadCounts);
    assert.equal(remote.get("data/progress-state.json").data.stitchStats.colors["310"].threads.length, 3);

    // The date history is data, so import it through the same save path as a real PC.
    const historic = structuredClone(saved);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const day = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    historic.stitchStats.colors["310"].runs[0].day = day;
    await page.evaluate(save => applyProgressSave(save), historic);
    assert.equal(await page.locator("#todayDiagonals").innerText(), "5");
    await page.screenshot({ path: path.join(output, "stitch-stats-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "No horizontal page overflow on mobile");
    assert.equal(await page.locator("#changeThreadButton").isVisible(), true);
    await page.screenshot({ path: path.join(output, "stitch-stats-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.locator("#sessionModeButton").click();
    assert.equal(await page.evaluate(() => threadMarkerHits.length), 2);
    await page.screenshot({ path: path.join(output, "stitch-stats-session.png"), fullPage: true });

    const broken = structuredClone(historic); broken.stitchStats.colors["310"].runs[0].to = 999;
    const beforeInvalid = await page.evaluate(() => JSON.stringify([stitchedByDmc, stitchStats]));
    assert.equal(await page.evaluate(save => validateProgressSave(save).valid, broken), false);
    assert.equal(await page.evaluate(() => JSON.stringify([stitchedByDmc, stitchStats])), beforeInvalid);

    const legacy = { ...saved }; delete legacy.stitchStats;
    await page.evaluate(save => applyProgressSave(save), legacy);
    assert.equal(await page.locator("#todayDiagonals").innerText(), "0");
    assert.equal(await page.evaluate(() => stitchedByDmc["310"]), 8);
    assert.match(await page.locator("#stitchStatsSince").innerText(), /10 diagonales anterieures/);
    await advance(2); await page.locator("#changeThreadButton").click();
    assert.equal(await page.locator("#threadDiagonalAverage").innerText(), "-");
    assert.match(await page.locator("#threadHistory").innerText(), /partiel/);
    await page.locator("#resetColorProgressButton").click();
    assert.equal(await page.locator("#todayDiagonals").innerText(), "0");
    await page.locator("#undoActionButton").click();
    assert.equal(await page.locator("#todayDiagonals").innerText(), "2");
    assert.equal(await page.evaluate(() => threadMarkerHits.length), 1);
    assert.equal(await page.evaluate(() => validateProgressSave(buildProgressSave()).valid), true);
    await page.evaluate(() => localSaveQueue);
    await page.reload(); await page.waitForFunction(() => !document.querySelector("main").inert && activeProgressStep === "stitch");
    assert.equal(await page.locator("#todayDiagonals").innerText(), "2");
    assert.deepEqual(errors, []);
    for (const [i, name] of saveNames.entries()) assert.deepEqual(await fs.readFile(path.join(root, name)), originalSaves[i]);
    console.log("Stitch stats UI passed: daily counts, thread markers, undo/redo/reload, JSON export, two-PC mock sync, old saves, desktop/mobile/session.");
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
