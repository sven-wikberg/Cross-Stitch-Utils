const assert = require("node:assert/strict");
const { Worker } = require("node:worker_threads");
const {
  createPathOptimizerApi,
  createPathOptimizerWorkerSource
} = require("../src/path-optimizer-worker.js");

new Function(createPathOptimizerWorkerSource());

const points = [];
for (const offsetX of [0, 20]) {
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      points.push({ x: x + offsetX, y });
    }
  }
}

async function run() {
  const result = createPathOptimizerApi().optimizePath({
    points,
    cutThreshold: 5,
    timeLimitMs: 1000
  });

  assert.equal(result.route.length, points.length);
  assert.equal(new Set(result.route).size, points.length);
  assert.ok(result.metrics.score <= result.initialMetrics.score);
  assert.equal(result.metrics.cuts, 1);

  const workerSource = `
    const { parentPort } = require("node:worker_threads");
    global.self = {
      onmessage: null,
      postMessage(message) { parentPort.postMessage(message); }
    };
    ${createPathOptimizerWorkerSource()}
    parentPort.on("message", (data) => self.onmessage({ data }));
  `;
  const workerResult = await new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, { eval: true });
    worker.on("message", (message) => {
      if (message.type === "complete") {
        worker.terminate();
        resolve(message);
      } else if (message.type === "error") {
        worker.terminate();
        reject(new Error(message.message));
      }
    });
    worker.on("error", reject);
    worker.postMessage({
      type: "start",
      runId: "test",
      points,
      initialPath: [],
      cutThreshold: 5,
      timeLimitMs: 1000
    });
  });

  assert.equal(workerResult.path.length, points.length);
  assert.equal(new Set(workerResult.path.map((point) => `${point.x},${point.y}`)).size, points.length);
  console.log("path optimizer tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
