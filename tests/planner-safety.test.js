const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function run() {
  const root = path.resolve(__dirname, "..");
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const route = [0, 1, 2, 3].map(x => ({ x, y: 0 }));
  const pattern = { kind: "cross-stitch-pattern", schemaVersion: 1, project: { name: "Safety test" },
    colors: [{ dmc: "310", hex: "#111111", symbol: "A" }, { dmc: "321", hex: "#ff0000", symbol: "B" }],
    grid: { width: 5, height: 2, cells: Array.from({ length: 10 }, (_, i) => {
      const x = i % 5, y = Math.floor(i / 5), dmc = y === 0 && x < 4 ? "310" : y === 1 && x === 0 ? "321" : null;
      return { x, y, dmc, empty: !dmc, symbol: dmc === "310" ? "A" : dmc ? "B" : null };
    }) } };
  const data = { kind: "cross-stitch-paths", schemaVersion: 1, project: pattern.project, pattern,
    paths: [{ dmc: "310", points: route }, { dmc: "321", points: [{ x: 0, y: 1 }] }] };
  const clickConfirm = async (selector, accept) => {
    const dialogPromise = page.waitForEvent("dialog");
    const click = page.locator(selector).click();
    const dialog = await dialogPromise;
    assert.equal(dialog.type(), "confirm");
    await (accept ? dialog.accept() : dialog.dismiss());
    await click;
  };
  const settled = () => page.evaluate(() => plannerSaveQueue);
  const reload = async (openPaths = true) => {
    await settled(); await page.reload();
    await page.waitForFunction(() => !document.querySelector("main").inert);
    if (openPaths) await page.locator('[data-step="paths"]').click();
  };
  const state = () => page.evaluate(() => ({ paths: pathsByDmc, constraints: constraintsByDmc, best: bestPathsByDmc, threshold: cutThreshold }));
  try {
    await page.goto(pathToFileURL(path.join(root, "plan-paths.html")).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    assert.equal(await page.locator("#undoPathPointButton").isDisabled(), true);
    await page.locator("#patternJsonFile").setInputFiles({ name: "test.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(() => loadedPattern?.project.name === "Safety test");
    const initial = await state();
    await clickConfirm("#clearPathButton", false);
    assert.deepEqual(await state(), initial);
    assert.equal(await page.locator("#undoPathPointButton").isDisabled(), true);
    await clickConfirm("#resetPathToolButton", false);
    assert.deepEqual(await state(), initial);

    await clickConfirm("#clearPathButton", true);
    assert.equal(await page.evaluate(() => currentPath().length), 0);
    assert.deepEqual((await state()).best, initial.best);
    await reload();
    assert.equal(await page.locator("#restoreBestPathButton").isEnabled(), true);
    await page.locator("#undoPathPointButton").click();
    assert.deepEqual((await state()).paths, initial.paths);
    await page.locator("#redoPathActionButton").click();
    assert.equal(await page.evaluate(() => currentPath().length), 0);
    await page.locator("#restoreBestPathButton").click();
    assert.deepEqual((await state()).paths, initial.paths);
    await page.locator("#undoPathPointButton").click();
    assert.equal(await page.evaluate(() => currentPath().length), 0, "Restoration itself can be undone");
    await page.locator("#redoPathActionButton").click();

    await page.locator("#lockedPrefixCount").fill("2");
    await page.locator("#lockedPrefixCount").dispatchEvent("change");
    assert.equal(await page.evaluate(() => constraintsByDmc["310"].lockedPrefix.length), 2);
    await page.locator("#undoPathPointButton").click();
    assert.equal(await page.evaluate(() => constraintsByDmc["310"].lockedPrefix?.length || 0), 0);
    await page.locator("#redoPathActionButton").click();
    const lockedState = await state();
    await clickConfirm("#clearPathButton", true);
    await page.locator("#undoPathPointButton").click();
    assert.deepEqual(await state(), lockedState, "Clear undo restores locks and paths exactly");

    await page.locator("#cutThresholdInput").fill("8");
    await page.locator("#cutThresholdInput").dispatchEvent("change");
    await page.locator("#undoPathPointButton").click();
    assert.equal((await state()).threshold, initial.threshold);
    await page.locator("#redoPathActionButton").click();
    assert.equal((await state()).threshold, 8);

    await clickConfirm("#clearPathButton", true);
    await page.locator("#diagonalMode").selectOption("lower");
    const box = await page.locator("#patternCanvas").boundingBox();
    await page.mouse.move(box.x + 35, box.y + 35);
    await page.mouse.down();
    await page.mouse.move(box.x + 89, box.y + 35, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => currentPath().length), 4);
    await page.locator("#undoPathPointButton").click();
    assert.equal(await page.evaluate(() => currentPath().length), 0, "One undo removes the entire drag");
    await page.locator("#redoPathActionButton").click();
    assert.equal(await page.evaluate(() => currentPath().length), 4);
    await reload();
    await page.locator("#undoPathPointButton").click();
    assert.equal(await page.evaluate(() => currentPath().length), 0);
    // Restoring archived locks must be explicit, even after a reload.
    await clickConfirm("#restoreBestPathButton", true);
    assert.deepEqual((await state()).paths, initial.paths);

    const beforeReset = await state();
    await clickConfirm("#resetPathToolButton", true);
    assert.equal(await page.evaluate(() => loadedPattern), null);
    await reload(false);
    assert.equal(await page.locator("#undoPathPointButton").isEnabled(), true);
    await page.locator("#undoPathPointButton").click();
    assert.deepEqual(await state(), beforeReset);
    await page.locator("#redoPathActionButton").click();
    assert.equal(await page.evaluate(() => loadedPattern), null);
    await page.locator("#undoPathPointButton").click();

    // One worker run, including previews, is one operation; the best survives undo.
    await clickConfirm("#clearPathButton", true);
    await page.evaluate(() => {
      const original = createPathOptimizerWorker;
      window.createPathOptimizerWorker = () => {
        const worker = original(), send = worker.postMessage.bind(worker);
        worker.postMessage = message => send({ ...message, stagnationLimitMs: 20 });
        return worker;
      };
    });
    await page.locator("#optimizedPathButton").click();
    await page.waitForFunction(() => !pathAlgorithmRunning && currentPath().length === 8);
    const optimized = await page.evaluate(() => currentPath());
    await page.locator("#undoPathPointButton").click();
    assert.equal(await page.evaluate(() => currentPath().length), 0);
    assert.equal(await page.locator("#restoreBestPathButton").isEnabled(), true);
    await page.locator("#redoPathActionButton").click();
    assert.deepEqual(await page.evaluate(() => currentPath()), optimized);

    // Pending edits persisted during calculation/drawing are recoverable after interruption.
    await page.evaluate(() => {
      beginPathEdit("Interrupted trace");
      pathsByDmc[selectedDmc] = currentPath().slice(0, 2);
      savePathPlannerState();
    });
    await reload();
    await page.locator("#undoPathPointButton").click();
    assert.deepEqual(await page.evaluate(() => currentPath()), optimized);
    await page.locator('[data-dmc="321"]').click();
    await clickConfirm("#clearPathButton", true);
    await page.locator('[data-dmc="310"]').click();
    await page.locator("#undoPathPointButton").click();
    assert.equal(await page.evaluate(() => selectedDmc), "321", "Undo returns to the affected color");
    assert.deepEqual((await state()).paths["321"], initial.paths["321"]);

    await page.locator("#redoPathActionButton").focus();
    await page.keyboard.press("Control+Shift+Z");
    assert.equal(await page.evaluate(() => currentPath().length), 0);
    await page.keyboard.press("Control+Z");
    assert.deepEqual((await state()).paths["321"], initial.paths["321"]);
    await page.locator("#lockedPrefixCount").focus();
    await page.keyboard.press("Control+Z");
    assert.deepEqual((await state()).paths["321"], initial.paths["321"], "Editing inputs keeps native undo");

    await page.evaluate(() => {
      const write = PathPlannerStore.write;
      PathPlannerStore.write = async () => { PathPlannerStore.write = write; throw new Error("Test quota"); };
    });
    await clickConfirm("#clearPathButton", true);
    await settled();
    assert.equal(await page.evaluate(() => plannerSaveFailed), true);
    assert.match(await page.locator("#pathSaveStatus").innerText(), /impossible/i);
    await page.locator("#undoPathPointButton").click();
    await settled();
    assert.equal(await page.evaluate(() => plannerSaveFailed), false);
    assert.deepEqual((await state()).paths["321"], initial.paths["321"], "Undo remains usable after a storage failure");

    await fs.mkdir(path.join(root, "exports/verification"), { recursive: true });
    await page.screenshot({ path: path.join(root, "exports/verification/planner-history.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(root, "exports/verification/planner-history-mobile.png"), fullPage: true });
    assert.deepEqual(errors, []);
    console.log("planner safety passed: confirmations, drag undo, redo, constraints, settings, reset/reload, optimization and interrupted edits");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
