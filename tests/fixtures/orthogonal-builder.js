const { createOrthogonalPathBuilder } = require("../../src/orthogonal-path-worker.js");

// Pin the partition in tests of transfer matrices, insertion and timer behavior.
// Production workers and proximity-blocks.test.js exercise the wider partition.
function createOrthogonalFixtureBuilder(model, clock) {
  const builder = createOrthogonalPathBuilder(model, clock);
  return { ...builder, buildPath: (options, report) => builder.buildPath({ ...options, wideBlocks: false }, report) };
}

module.exports = { createOrthogonalFixtureBuilder };
