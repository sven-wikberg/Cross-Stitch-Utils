const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Worker } = require("node:worker_threads");
const { test } = require("node:test");
const model = require("../src/stitch-model.js");

// Capture the exact browser worker source, not a second test-only implementation.
let revoked = false;
const context = vm.createContext({
  Blob: class { constructor(parts) { this.source = parts.join(""); } },
  URL: { createObjectURL(blob) { return blob; }, revokeObjectURL() { revoked = true; } },
  Worker: class { constructor(blob) { this.source = blob.source; } }
});
for (const file of ["stitch-model.js", "orthogonal-path-worker.js", "relay-search.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), context);
}
assert.equal(context.createPathOptimizerWorker, undefined, "The builder must not install an obsolete worker entry point");
vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/block-optimizer-worker.js"), "utf8"), context);
const source = context.createPathOptimizerWorker().source;
assert.ok(revoked, "Release the temporary worker URL");
new Function(source);
const workerSource = [
  'const { parentPort } = require("node:worker_threads");',
  'global.self = { postMessage(message) { parentPort.postMessage(message); } };',
  source,
  'parentPort.on("message", data => self.onmessage({ data }));'
].join("\n");

async function runWorker(options, inspect = () => {}, source = workerSource) {
  const worker = new Worker(source, { eval: true });
  let timeout;
  try {
    return await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Optimizer worker timed out")), 10000);
      worker.on("error", reject);
      worker.on("message", message => {
        try {
          assert.equal(message.runId, options.runId);
          inspect(message);
          if (message.type === "complete" || message.type === "error") resolve(message);
        } catch (error) { reject(error); }
      });
      worker.postMessage({ type: "start", ...options });
    });
  } finally {
    clearTimeout(timeout);
    await worker.terminate();
  }
}

test("the active worker publishes valid improving routes and preserves constraints", async () => {
  const points = [0, 20].flatMap(offset => Array.from({ length: 9 }, (_, i) => ({ x: offset + i % 3, y: Math.floor(i / 3) })));
  const initialPath = model.expandCells(points, 5);
  const constraints = { start: initialPath[0], lockedPrefix: initialPath.slice(0, 3), forcedCuts: [initialPath[8]] };
  initialPath[8].cutBefore = true;
  let reports = 0, previous = Infinity;
  const result = await runWorker({ runId: "active-engine", points, initialPath, constraints,
    cutThreshold: 5, stagnationLimitMs: 20 }, snapshot => {
    if (!snapshot.path) return;
    reports++;
    assert.equal(model.validateRoute(snapshot.path, points), "");
    assert.ok(model.satisfiesConstraints(snapshot.path, constraints));
    const metrics = model.metrics(snapshot.path, 5, true);
    assert.ok(Math.abs(metrics.score - snapshot.metrics.score) < 1e-7);
    assert.ok(metrics.score <= previous + 1e-7);
    previous = metrics.score;
  });
  assert.equal(result.type, "complete");
  assert.equal(result.method, "block-optimization");
  assert.ok(reports > 1);
  assert.equal(result.path.length, points.length * 2);
  assert.ok(result.metrics.score <= result.initialMetrics.score + 1e-7);
  assert.equal(result.stagnationLimitMs, 20);
});

test("the active worker reports invalid inputs with the original run id", async () => {
  const result = await runWorker({ runId: "invalid-engine-input", points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] });
  assert.equal(result.type, "error");
  assert.match(result.message, /dupliqu/i);
});

test("the deep browser worker is self-contained and streams monotonic LNS gains until its total deadline", async () => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/deep-optimizer-worker.js"), "utf8"), context);
  const deepSource = context.createDeepPathOptimizerWorker().source;
  const source = workerSource.replace(context.createPathOptimizerWorker().source, deepSource);
  new Function(deepSource);
  const points = require("./fixtures/combined-search.js").timerRecovery, initialPath = model.expandCells(points, 3);
  let previous = model.metrics(initialPath, 3, true).score, lnsSeen = false, gains = 0;
  const result = await runWorker({ runId: "deep-engine", points, initialPath, cutThreshold: 3, totalLimitMs: 400, warmupMs: 0 }, snapshot => {
    assert.notEqual(snapshot.type, "error", snapshot.message);
    lnsSeen ||= snapshot.stage === "lns";
    if (!snapshot.path) return;
    assert.equal(model.validateRoute(snapshot.path, points), "");
    assert.ok(snapshot.metrics.score <= previous + 1e-8);
    if (snapshot.metrics.score < previous - 1e-8) gains++;
    previous = snapshot.metrics.score;
  }, source);
  assert.equal(result.method, "deep-optimization"); assert.ok(lnsSeen && gains > 0);
  assert.equal(result.totalLimitMs, 400); assert.ok(result.elapsedMs >= 400 && result.elapsedMs < 1500);
  assert.ok(result.lns.iterations > 0); assert.equal(result.reason, "time-limit");
});
