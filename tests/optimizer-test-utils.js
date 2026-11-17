const { createDiagonalOptimizer } = require("../src/diagonal-optimizer-worker.js");

function createFastOptimizer(model, tickMs = 250) {
  let time = 0;
  return createDiagonalOptimizer(model, () => { time += tickMs; return time; });
}

module.exports = { createFastOptimizer };
