const test = require("node:test");
const assert = require("node:assert/strict");
const { createPathEditHistory } = require("../src/path-edit-history.js");

test("history stores whole operations, supports redo and never aliases live state", () => {
  const history = createPathEditHistory(), scope = { type: "color", dmc: "310" };
  let current = { path: [1], constraints: { lockedPrefix: [1] } };
  history.begin(scope, "Trace", current);
  current.path.push(2, 3, 4);
  assert.equal(history.commit(current), true);
  current = history.undo(() => current).before;
  assert.deepEqual(current.path, [1]);
  current.path.push(9);
  current = history.redo(() => current).before;
  assert.deepEqual(current.path, [1, 2, 3, 4]);
  assert.deepEqual(current.constraints, { lockedPrefix: [1] });
  assert.equal(history.undoLabel, "Trace");
});

test("no-ops preserve redo, real new operations replace the future", () => {
  const history = createPathEditHistory();
  history.begin({}, "Clear", [1]); history.commit([]);
  history.undo(() => []);
  history.begin({}, "No-op", [1]); assert.equal(history.commit([1]), false);
  assert.equal(history.redoLabel, "Clear");
  history.begin({}, "Draw", [1]); history.commit([1, 2]);
  assert.equal(history.redoLabel, "");
});

test("pending edits survive reload and recover as one undoable operation", () => {
  let history = createPathEditHistory();
  history.begin({ type: "color", dmc: "321" }, "Optimisation", [1]);
  history = createPathEditHistory(JSON.parse(JSON.stringify(history.toJSON())));
  history.recover(() => [2, 3]);
  assert.equal(history.pending, null);
  assert.deepEqual(history.undo(() => [2, 3]).before, [1]);
  assert.deepEqual(history.redo(() => [1]).before, [2, 3]);
});

test("history is bounded, always retains the latest operation and keeps inputs immutable", () => {
  const history = createPathEditHistory({}, { maxEntries: 2, maxBytes: 100 });
  for (let i = 0; i < 4; i++) { history.begin({}, String(i), [i]); history.commit([i + 1]); }
  assert.equal(history.toJSON().undo.length, 2);
  const large = Object.freeze({ path: Object.freeze(Array(100).fill(1)) });
  history.begin({}, "Reset", large); history.commit(null);
  assert.equal(history.toJSON().undo.length, 1);
  assert.deepEqual(history.undo(() => null).before, large);
});
