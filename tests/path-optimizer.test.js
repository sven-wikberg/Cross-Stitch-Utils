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

async function runWorker(options, inspect = () => {}) {
  const worker = new Worker(workerSource, { eval: true });
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
