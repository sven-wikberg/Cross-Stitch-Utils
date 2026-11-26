const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const prompt = require("../src/ai-import-prompt.js");

async function run() {
  const root = path.resolve(__dirname, ".."), output = path.join(root, "exports/verification");
  await fs.mkdir(output, { recursive: true });
  const protectedFiles = ["data/progress-state.json", "data/builtin-progress.js"];
  const before = await Promise.all(protectedFiles.map(file => fs.readFile(path.join(root, file))));
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || "msedge" });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:/, route => route.abort());
    await page.goto(pathToFileURL(path.join(root, "import-pattern.html")).href);
    await page.waitForFunction(() => typeof pattern !== "undefined");
    const original = await page.evaluate(() => ({ pattern, progress, activeStep, storage: { ...localStorage } }));
    assert.equal(await page.locator("#aiImportPromptPanel").getAttribute("open"), null);
    await page.locator("#aiImportPromptPanel summary").click();
    assert.equal(await page.locator("#aiImportPrompt").inputValue(), prompt.text);
    assert.equal(await page.locator("#aiImportPrompt").getAttribute("readonly"), "");
    assert.equal(await page.locator("#aiImportPromptPanel img").evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async value => { window.copiedPrompt = value; }
    } }));
    await page.getByRole("button", { name: "Copier le prompt", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#aiImportPromptStatus").textContent === "Prompt copie.");
    assert.equal(await page.evaluate(() => window.copiedPrompt), prompt.text);
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => { throw new Error("Clipboard blocked"); };
      document.execCommand = command => {
        window.fallbackCopy = { command, value: document.activeElement.value }; return true;
      };
    });
    await page.locator("#copyAiImportPrompt").click();
    assert.deepEqual(await page.evaluate(() => window.fallbackCopy), { command: "copy", value: prompt.text });
    assert.equal(await page.locator("#copyAiImportPrompt").isDisabled(), false);
    await page.evaluate(() => { document.execCommand = () => false; });
    await page.locator("#copyAiImportPrompt").click();
    assert.match(await page.locator("#aiImportPromptStatus").innerText(), /Texte selectionne/);
    assert.equal(await page.locator("#aiImportPrompt").evaluate(field => field.selectionEnd - field.selectionStart), prompt.text.length);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
    await page.locator("#copyAiImportPrompt").click();
    assert.match(await page.locator("#aiImportPromptStatus").innerText(), /Copie automatique indisponible/);
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#downloadAiImportPrompt").click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "conversion-pdf-cross-stitch.txt");
    assert.equal(await fs.readFile(await download.path(), "utf8"), prompt.text);
    assert.deepEqual(await page.evaluate(() => ({ pattern, progress, activeStep, storage: { ...localStorage } })), original);
    await page.screenshot({ path: path.join(output, "ai-import-prompt-desktop.png"), fullPage: true });
    await page.locator("#projectName").fill("Import manuel conserve");
    await page.locator("#saveButton").click();
    assert.equal(await page.evaluate(() => activeStep), "colors");
    assert.equal(await page.locator("#aiImportPrompt").isVisible(), true, "Prompt remains available at every step");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#aiImportPromptPanel").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "ai-import-prompt-mobile.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator("#aiImportPrompt").evaluate(field => field.scrollWidth <= field.clientWidth), true);
    const planner = await browser.newPage();
    planner.on("pageerror", error => errors.push(error.message));
    await planner.route(/^https?:/, route => route.abort());
    await planner.goto(pathToFileURL(path.join(root, "plan-paths.html")).href);
    await planner.waitForFunction(() => !document.querySelector("main").inert);
    await planner.locator("#patternJsonFile").setInputFiles({ name: "example.cross-stitch.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(prompt.example)) });
    await planner.waitForFunction(() => activePathStep === "paths");
    assert.deepEqual(await planner.evaluate(() => loadedPattern), prompt.example);
    assert.deepEqual(errors, []);
    for (let i = 0; i < protectedFiles.length; i++) assert.deepEqual(await fs.readFile(path.join(root, protectedFiles[i])), before[i]);
    console.log("AI prompt UI passed: copy/fallback/denied clipboard, complete UTF-8 download, all-step access, icons, desktop/mobile, actual tool-2 import, unchanged drafts and saves.");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
