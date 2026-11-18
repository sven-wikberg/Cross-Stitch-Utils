const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPathViewport } = require("../src/path-viewport.js");
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test("fit covers the entire grid, caps default cell size, and maps pointer coordinates both ways", () => {
  const view = createPathViewport(); view.resize(826, 626); view.setGrid(400, 200);
  assert.equal(view.state.scale, 2); assert.equal(view.state.zoom, 1);
  assert.deepEqual(view.bounds, { minX: 0, minY: 0, maxX: 400, maxY: 200 });
  for (const world of [{ x: 0, y: 0 }, { x: 123.5, y: 90.5 }, { x: 400, y: 200 }]) {
    const actual = view.toWorld(view.toScreen(world)); close(actual.x, world.x); close(actual.y, world.y);
  }
  view.setGrid(3, 2); assert.equal(view.state.scale, 18);
});

test("zoom keeps the pointed hole fixed and pan is bounded without changing scale", () => {
  const view = createPathViewport(); view.resize(826, 626); view.setGrid(400, 400);
  const anchor = { x: 300, y: 250 }, before = view.toWorld(anchor);
  view.zoom(4, anchor); close(view.toWorld(anchor).x, before.x); close(view.toWorld(anchor).y, before.y);
  const scale = view.state.scale;
  view.pan(-100000, -100000); close(view.bounds.maxX, 400); close(view.bounds.maxY, 400);
  view.pan(100000, 100000); assert.equal(view.state.x, 0); assert.equal(view.state.y, 0); assert.equal(view.state.scale, scale);
  view.zoom(10000); assert.equal(view.state.scale, 80);
  view.zoom(0.000001); assert.equal(view.state.zoom, 1);
});

test("resize preserves an inspected center and fit mode adapts to the viewport", () => {
  const view = createPathViewport(); view.resize(826, 626); view.setGrid(400, 400); view.zoom(5); view.center({ x: 200, y: 200 });
  const scale = view.state.scale;
  view.resize(426, 326); assert.equal(view.state.scale, scale);
  const center = view.toWorld({ x: 226, y: 176 }); close(center.x, 200); close(center.y, 200);
  view.fit(); view.resize(826, 826); assert.equal(view.state.scale, 2); assert.equal(view.state.zoom, 1);
});

test("explicit framing includes every changed connection and never changes grid coordinates", () => {
  const view = createPathViewport(); view.resize(826, 626); view.setGrid(400, 400);
  view.frame({ minX: 160, minY: 240, maxX: 175, maxY: 250 });
  assert.ok(view.bounds.minX <= 160 && view.bounds.maxX >= 175);
  assert.ok(view.bounds.minY <= 240 && view.bounds.maxY >= 250);
  view.fit(); assert.deepEqual(view.bounds, { minX: 0, minY: 0, maxX: 400, maxY: 400 });
});
