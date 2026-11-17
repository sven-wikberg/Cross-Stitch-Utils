const assert = require("node:assert/strict");
const { createPathOptimizerApi } = require("../src/path-optimizer-worker.js");
const groups = require("../src/group-operations.js");
const pathSettings = require("../src/path-settings.js");
require("../src/progress-store.js");
require("../src/github-sync.js");

async function run() {
  const original = [
    { id: "group-1", cellKeys: ["0,0", "1,0", "2,0"], cellCount: 3, dmc: "310", isEmpty: false },
    { id: "group-2", cellKeys: ["3,0"], cellCount: 1, dmc: "321", isEmpty: false }
  ];
  const split = groups.split(original, "group-1", ["1,0"]);
  assert.equal(split.length, 3);
  assert.equal(split[0].dmc, "310");
  assert.equal(split[1].dmc, null);
  assert.equal(split[2], original[1]);
  assert.equal(new Set(split.flatMap(group => group.cellKeys)).size, 4);
  const merged = groups.merge(split, split[1].id, "group-2");
  assert.equal(merged[1].dmc, "321");
  assert.equal(merged[1].cellCount, 2);
  assert.deepEqual(original[0].cellKeys, ["0,0", "1,0", "2,0"]);
  assert.throws(() => groups.split(original, "group-1", original[0].cellKeys));

  const optimizer = createPathOptimizerApi();
  const points = Array.from({ length: 18 }, (_, i) => ({ x: i % 6, y: Math.floor(i / 6) }));
  const constraints = { start: points[0], lockedPrefix: points.slice(0, 3), forcedCuts: [{ from: points[5], to: points[6] }] };
  let snapshots = 0;
  const result = optimizer.optimizePath({ points, initialPath: points, constraints, cutThreshold: 10, stagnationLimitMs: 1000,
    onProgress(snapshot) {
      if (!snapshot.route) return;
      assert.ok(optimizer.satisfiesConstraints(snapshot.route.map(index => points[index]), constraints));
      snapshots++;
    } });
  assert.ok(snapshots > 0);
  assert.ok(optimizer.satisfiesConstraints(result.route.map(index => points[index]), constraints));
  assert.equal(result.metrics.cuts, 1);
  assert.ok(result.metrics.score <= result.initialMetrics.score);
  const partial = optimizer.optimizePath({ points, initialPath: points.slice(0, 7), constraints, cutThreshold: 10, stagnationLimitMs: 1000 });
  assert.ok(optimizer.satisfiesConstraints(partial.route.map(index => points[index]), constraints));
  assert.equal(pathSettings.validate({ settings: { cutThreshold: 12 }, paths: [{ points, constraints, forcedCuts: constraints.forcedCuts }] }), "");
  assert.ok(pathSettings.validate({ paths: [{ points, forcedCuts: [{ from: null }] }] }));
  assert.ok(pathSettings.validate({ settings: { cutThreshold: -1 }, paths: [] }));

  const store = global.StitchProgressStore;
  const pattern = { project: { name: "Broderie ete" }, paths: points };
  const id = await store.identify(pattern);
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.equal(await store.identify(JSON.parse(JSON.stringify(pattern))), id);
  const state = { kind: "cross-stitch-progress-state", schemaVersion: 2, patternId: id, stitchedByDmc: { "310": 3 }, selectedDmc: "310" };
  assert.equal(store.unpack(state, pattern).pathsFile, pattern);
  assert.equal(store.fingerprint(state), store.fingerprint({ ...state, savedAt: "tomorrow" }));
  assert.notEqual(store.fingerprint(state), store.fingerprint({ ...state, stitchedByDmc: { "310": 4 } }));
  assert.throws(() => store.unpack({ ...state, patternId: "../bad" }, pattern));

  const sync = global.CrossStitchGithubSync;
  const files = new Map();
  const calls = [];
  let sequence = 0;
  let race = false;
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const key = new URL(url).pathname.split("/contents/")[1];
    if (options.method === "PUT") {
      const body = JSON.parse(options.body);
      const old = files.get(key);
      if (race && key.endsWith("progress-state.json")) return Response.json({ message: "Conflict" }, { status: 409 });
      if ((old?.sha || null) !== (body.sha || null)) return Response.json({}, { status: 409 });
      const sha = `version-${++sequence}`;
      files.set(key, { sha, data: JSON.parse(Buffer.from(body.content, "base64").toString("utf8")) });
      return Response.json({ content: { sha } });
    }
    const file = files.get(key);
    if (!file) return Response.json({}, { status: 404 });
    return Response.json({ sha: file.sha, encoding: "base64", content: Buffer.from(JSON.stringify(file.data)).toString("base64") });
  };
  const first = await sync.saveState(state, pattern, "test-only-token", null);
  assert.equal(calls.filter(call => call.options.method === "PUT").length, 2);
  calls.length = 0;
  const second = await sync.saveState({ ...state, stitchedByDmc: { "310": 4 } }, pattern, "test-only-token", first.sha);
  assert.equal(calls.filter(call => call.options.method === "PUT").length, 1);
  assert.ok(!calls.some(call => call.url.includes("patterns/")));
  calls.length = 0;
  await assert.rejects(sync.saveState(state, pattern, "test-only-token", first.sha), error => error.status === 409 && Boolean(error.remote));
  assert.equal(calls.filter(call => call.options.method === "PUT").length, 0);
  race = true;
  await assert.rejects(sync.saveState(state, pattern, "test-only-token", second.sha), error => error.status === 409);
  assert.equal(calls.filter(call => call.options.method === "PUT").length, 1, "Never silently retry a conflict");
  console.log("upgrade tests passed: constraints, groups, compact saves, sync conflicts");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
