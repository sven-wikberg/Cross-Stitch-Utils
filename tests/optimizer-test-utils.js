const { createBlockOptimizer } = require("../src/block-optimizer-worker.js");
const { createOrthogonalPathBuilder } = require("../src/orthogonal-path-worker.js");

function createFastOptimizer(model, tickMs = 250, seed = 31) {
  let time = 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  return createBlockOptimizer(model, createOrthogonalPathBuilder, () => { time += tickMs; return time; }, random);
}

module.exports = { createFastOptimizer };
