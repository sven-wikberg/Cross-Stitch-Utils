const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function run() {
  const root = path.resolve(__dirname, ".."), output = path.join(root, "exports/verification");
  await fs.mkdir(output, { recursive: true });
  const saves = ["data/progress-state.json", "data/builtin-progress.js"];
  const beforeSaves = [];
  for (const file of saves) beforeSaves.push(await fs.readFile(path.join(root, file)));
  const colors = ["310", "321", "500", "700", "BLANC"].map((dmc, i) => ({ dmc, symbol: String.fromCharCode(65 + i), hex: ["#111111", "#cf2444", "#265b52", "#22a044", "#ffffff"][i] }));
  const counts = [1, 6, 3, 6, 0];
  const paths = colors.map((color, y) => ({ dmc: color.dmc, points: Array.from({ length: counts[y] }, (_, x) => ({ x, y })) }));
  const pattern = { kind: "cross-stitch-pattern", schemaVersion: 1, project: { name: "Tri des couleurs" }, colors,
    grid: { width: 6, height: 5, cells: Array.from({ length: 30 }, (_, i) => {
      const x = i % 6, y = Math.floor(i / 6), color = x < counts[y] ? colors[y] : null;
      return { x, y, empty: !color, dmc: color?.dmc || null, symbol: color?.symbol || null };
    }) } };
  const data = { kind: "cross-stitch-paths", schemaVersion: 1, project: pattern.project, pattern, paths };
  const expected = ["BLANC", "310", "500", "321", "700"];
  const browser = await chromium.launch({ headless: true, channel: "msedge" }), errors = [];
  const open = async name => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, name)).href);
    await page.waitForFunction(() => !document.querySelector("main").inert);
    return page;
  };
  const codes = (page, selector) => page.locator(selector).evaluateAll(items => items.map(item => item.dataset.dmc));
  try {
    const importer = await open("import-pattern.html");
    await importer.evaluate(data => {
      pattern = { ...structuredClone(defaultPattern), ...data, pendingAssignmentCellKeys: [],
        symbolGroups: data.colors.filter(c => c.dmc !== "BLANC").map((c, i) => {
          const cells = data.grid.cells.filter(cell => cell.dmc === c.dmc);
          return { id: `group-${i}`, dmc: c.dmc, isEmpty: false, cellKeys: cells.map(reviewCellKey), cellCount: cells.length };
        }) };
      assignmentGroupIndex = 0;
      renderColors(); renderAssignments(); renderReviewColorCounts(buildFinalPattern(), true);
    }, pattern);
    const source = await importer.evaluate(() => buildFinalPattern());
    assert.deepEqual(await importer.locator("#colorsTableBody tr").evaluateAll(rows => rows.map(row => row.children[1].textContent)), expected);
    assert.deepEqual(await codes(importer, "#assignmentChoices [data-dmc]"), expected);
    assert.deepEqual(await importer.locator("[data-review-dmc]").evaluateAll(rows => rows.map(row => row.dataset.reviewDmc)), expected);
    assert.deepEqual(await importer.evaluate(() => buildFinalPattern()), source, "Display sorting does not reassign symbols or reorder exports");
    await importer.evaluate(() => {
      const group = pattern.symbolGroups.find(g => g.dmc === "321");
      group.dmc = "500"; pattern.pendingAssignmentCellKeys = group.cellKeys.slice();
      renderAssignments();
    });
    assert.deepEqual(await codes(importer, "#assignmentChoices [data-dmc]"), ["321", "BLANC", "310", "700", "500"], "Counts include pending group assignments without double counting");
    assert.deepEqual(await importer.evaluate(() => buildFinalPattern()), source, "Counting pending changes does not apply them to cells");
    await importer.evaluate(() => { pattern.symbolGroups[1].dmc = null; renderAssignments(); });
    assert.deepEqual(await codes(importer, "#assignmentChoices [data-dmc]"), ["321", "BLANC", "310", "500", "700"], "An unassigned pending group does not retain its old color count");
    await importer.evaluate(() => {
      pattern.symbolGroups[1].dmc = "500";
      renderColors(); document.querySelector("#colorsTableBody tr button").click();
    });
    assert.deepEqual(await importer.evaluate(() => pattern.colors.map(c => c.dmc)), ["310", "500", "700", "BLANC"], "Deleting a sorted row removes its source color, not its display index");

    const planner = await open("plan-paths.html");
    await planner.locator("#patternJsonFile").setInputFiles({ name: "order.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    await planner.waitForFunction(() => loadedPattern?.project.name === "Tri des couleurs");
    assert.deepEqual(await codes(planner, "#pathColorLegend [data-dmc]"), expected);
    assert.equal(await planner.evaluate(() => selectedDmc), "BLANC");
    const exportBefore = await planner.evaluate(() => buildPathExport());
    await planner.locator('#pathColorLegend [data-dmc="310"]').click();
    await planner.evaluate(() => { renderPathTool(); savePathPlannerState(); return plannerSaveQueue; });
    await planner.reload(); await planner.waitForFunction(() => !document.querySelector("main").inert);
    assert.equal(await planner.evaluate(() => selectedDmc), "310", "Reload preserves the selected color even when it is not first");
    assert.deepEqual(await planner.evaluate(() => buildPathExport()), exportBefore);
    await planner.locator('[data-step="paths"]').click();
    await planner.evaluate(() => {
      selectedDmc = "310"; pathsByDmc["700"] = []; pathsByDmc["500"] = [];
      selectNextIncompleteColor(); renderPathTool();
    });
    assert.equal(await planner.evaluate(() => selectedDmc), "500", "Next color follows ascending count");
    await planner.evaluate(() => { window.createPathOptimizerWorker = () => Object.assign(new EventTarget(), { postMessage() {}, terminate() {} }); });
    await planner.locator("#batchOptimizeButton").click();
    assert.deepEqual(await planner.evaluate(() => batchPlan.pending), expected.slice(1), "The unused color is skipped before optimizing the smallest nonempty color");
    await planner.locator("#stopPathAlgorithmButton").click();
    await planner.evaluate(() => {
      batchPlan = PathBatchPlan.prepare({ pending: ["310", "500", "321", "700"], results: [] }, null);
      renderPathTool();
    });
    await planner.locator("#batchOptimizeButton").click();
    assert.deepEqual(await planner.evaluate(() => batchPlan.pending), ["310", "500", "321", "700"], "Resume finishes the interrupted color before the newly sorted remaining queue");
    await planner.locator("#stopPathAlgorithmButton").click();
    await planner.screenshot({ path: path.join(output, "color-order-planner.png"), fullPage: true });

    const progress = await open("stitch-progress.html");
    await progress.locator("#pathsJsonFile").setInputFiles({ name: "order.paths.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
    await progress.waitForFunction(() => activeProgressStep === "stitch");
    assert.equal(await progress.evaluate(() => selectedDmc), "BLANC");
    const originalPaths = await progress.evaluate(() => loadedPaths);
    assert.deepEqual(await codes(progress, "#stitchColorLegend [data-dmc]"), expected.slice(1));
    await progress.evaluate(() => { changeStitchCount("321", 11); });
    assert.deepEqual(await codes(progress, "#stitchColorLegend [data-dmc]"), expected.slice(1), "Counts are total stitches, not remaining stitches");
    await progress.locator('#stitchColorLegend [data-dmc="310"]').click();
    await progress.locator("#nextStitchButton").click();
    await progress.evaluate(() => { changeStitchCount("500", 6); changeStitchCount("700", 12); });
    assert.deepEqual(await codes(progress, "#stitchColorLegend [data-dmc]"), ["310", "321"]);
    assert.deepEqual(await codes(progress, "#completedColorList [data-dmc]"), ["BLANC", "500", "700"]);
    const saved = await progress.evaluate(() => ({ selectedDmc, stitchedByDmc: normalizeStitchedState(loadedPaths, stitchedByDmc), action: pathForDmc(selectedDmc).points[stitchedCountForDmc(selectedDmc)] }));
    assert.deepEqual(await progress.evaluate(() => loadedPaths), originalPaths, "Rendering and progress leave every path order untouched");
    await progress.evaluate(() => localSaveQueue); await progress.reload();
    await progress.waitForFunction(() => !document.querySelector("main").inert && activeProgressStep === "stitch");
    assert.deepEqual(await progress.evaluate(() => ({ selectedDmc, stitchedByDmc, action: pathForDmc(selectedDmc).points[stitchedCountForDmc(selectedDmc)] })), saved);
    await progress.screenshot({ path: path.join(output, "color-order-progress.png"), fullPage: true });
    assert.deepEqual(errors, []);
    for (let i = 0; i < saves.length; i++) assert.deepEqual(await fs.readFile(path.join(root, saves[i])), beforeSaves[i]);
    console.log("color ordering passed in all tools: counts, ties, pending assignments, deletion, next/batch order, completed colors, selection/progress/export/save preservation");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
