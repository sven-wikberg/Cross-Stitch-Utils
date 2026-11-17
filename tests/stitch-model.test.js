const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const model = require("../src/stitch-model.js");
const { createDiagonalOptimizer } = require("../src/diagonal-optimizer-worker.js");
const optimizer = createDiagonalOptimizer(model);

function fixture(width = 4, height = 3) {
  const cells = Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), dmc: "310", empty: false }));
  const project = { name: "Diagonales" };
  return { kind: "cross-stitch-paths", schemaVersion: 1, project,
    pattern: { kind: "cross-stitch-pattern", schemaVersion: 1, project, colors: [{ dmc: "310", hex: "#111111", symbol: "A" }],
      grid: { width, height, cells } }, paths: [{ dmc: "310", points: cells.map(({ x, y }) => ({ x, y })) }] };
}

const old = fixture(), oldJson = JSON.stringify(old);
const upgraded = model.upgradePathsFile(old);
assert.equal(upgraded.schemaVersion, 2);
assert.equal(upgraded.paths[0].points.length, 24);
assert.equal(JSON.stringify(old), oldJson, "Never mutate a legacy file");
const route = upgraded.paths[0].points;
assert.equal(model.validateRoute(route, old.pattern.grid.cells), "");
assert.equal(model.validateRoute([{ x: 0, y: 0, diagonal: "upper", direction: 1 }]), "La diagonale / doit preceder la diagonale \\.");
const sameHole = [
  { x: 0, y: 0, diagonal: "lower", direction: 1 },
  { x: 1, y: 0, diagonal: "lower", direction: -1, cutBefore: true }
];
// Shared corner (1, 0), including with an explicit thread cut.
sameHole[1] = { x: 0, y: 0, diagonal: "upper", direction: -1, cutBefore: true };
assert.notEqual(model.distance(...sameHole), 0);
const forbidden = [{ x: 0, y: 0, diagonal: "lower", direction: 1 }, { x: 1, y: 0, diagonal: "upper", direction: 1, cutBefore: true }];
assert.equal(model.distance(...forbidden), 0);
assert.equal(model.cost(...forbidden), Infinity);
const prefix = [{ x: 1, y: 0, diagonal: "lower", direction: 1 }, ...forbidden];
assert.match(model.validateRoute(prefix), /meme trou/);

// Exhaustively compare orientation DP with all 2^N sewing direction assignments.
const sequence = model.expandCells([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
let minimum = Infinity;
for (let bits = 0; bits < 2 ** sequence.length; bits++) {
  const candidate = sequence.map((p, i) => ({ ...p, direction: bits & (1 << i) ? -1 : 1 }));
  minimum = Math.min(minimum, model.metrics(candidate).score);
}
assert.equal(model.metrics(model.orient(sequence)).score, minimum);

const legacySave = { kind: "cross-stitch-progress-save", schemaVersion: 1, pathsFile: old,
  stitchedByDmc: { "310": 5 }, selectedDmc: "310", zoom: 4, sessionMode: true,
  undoActions: [{ dmc: "310", before: 4, after: 5 }] };
const save = model.upgradeProgressSave(legacySave);
assert.equal(save.stitchedByDmc["310"], 10);
assert.equal(model.completion(save.pathsFile.paths[0].points, 10).complete, 5);
assert.equal(model.completion(save.pathsFile.paths[0].points, 11).partial, 1);
assert.deepEqual(save.undoActions[0], { dmc: "310", before: 8, after: 10 });
assert.equal(save.zoom, 4);
assert.deepEqual(model.upgradeProgressSave(save), save, "Migration is idempotent");
assert.throws(() => model.upgradeProgressSave({ ...save, stitchedByDmc: { "310": 25 } }));
assert.throws(() => model.upgradePathsFile({ ...upgraded, paths: [{ ...upgraded.paths[0], points: [...route].reverse() }] }));

for (let run = 0; run < 6; run++) {
  const cells = fixture(8, 6).pattern.grid.cells.filter((_, i) => run % 2 === 0 || i % 3 !== 0);
  const initial = model.expandCells(cells);
  initial[8].cutBefore = true;
  const constraints = run % 2 ? {} : { start: initial[0], lockedPrefix: initial.slice(0, 3), forcedCuts: [initial[8]] };
  let snapshots = 0, score = Infinity;
  const result = optimizer.optimizePath({ points: cells, initialPath: initial, constraints, stagnationLimitMs: 50 }, snapshot => {
    if (!snapshot.path) return;
    assert.equal(model.validateRoute(snapshot.path, cells), "");
    assert.ok(model.satisfiesConstraints(snapshot.path, constraints));
    assert.ok(snapshot.metrics.score <= score + 1e-7);
    score = snapshot.metrics.score; snapshots++;
  });
  assert.ok(snapshots > 0);
  assert.equal(model.validateRoute(result.path, cells), "");
  assert.ok(result.metrics.score <= result.initialMetrics.score + 1e-7);
}

// Check the user's immutable repository save, without writing to it.
const statePath = path.join(__dirname, "../data/progress-state.json");
if (fs.existsSync(statePath)) {
  const stateBytes = fs.readFileSync(statePath), state = JSON.parse(stateBytes);
  const patternPath = path.join(__dirname, `../data/patterns/${state.patternId}.json`);
  const patternBytes = fs.readFileSync(patternPath), paths = JSON.parse(patternBytes);
  const real = model.upgradeProgressSave({ ...state, kind: "cross-stitch-progress-save", schemaVersion: state.schemaVersion - 1, pathsFile: paths });
  for (const route of real.pathsFile.paths) {
    const count = real.stitchedByDmc[route.dmc] || 0;
    if (state.schemaVersion === 2) {
      assert.equal(count, (state.stitchedByDmc[route.dmc] || 0) * 2);
      const completed = [...model.completion(route.points, count).cells].filter(([, bits]) => bits === 3).map(([key]) => key).sort();
      const expected = paths.paths.find(p => p.dmc === route.dmc).points.slice(0, state.stitchedByDmc[route.dmc] || 0).map(model.cellKey).sort();
      assert.deepEqual(completed, expected);
    }
  }
  assert.equal(real.selectedDmc, state.selectedDmc);
  const largest = real.pathsFile.paths.reduce((best, p) => p.points.length > best.points.length ? p : best);
  const cells = real.pathsFile.pattern.grid.cells.filter(c => !c.empty && c.dmc === largest.dmc);
  const result = optimizer.optimizePath({ points: cells, initialPath: largest.points, stagnationLimitMs: 100 });
  assert.equal(model.validateRoute(result.path, cells), "");
  assert.deepEqual(fs.readFileSync(statePath), stateBytes);
  assert.deepEqual(fs.readFileSync(patternPath), patternBytes);
  console.log(`Real save preserved: ${cells.length} crosses / ${largest.points.length} diagonals in largest color; SHA256 ${crypto.createHash("sha256").update(stateBytes).digest("hex")}`);
}
console.log("stitch model tests passed: precedence, shared holes, directions, migration, optimizer snapshots");
