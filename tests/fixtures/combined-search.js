const line = (length, x, y) => Array.from({ length }, (_, i) => ({ x: x + i, y }));
const cells = pairs => pairs.map(([x, y]) => ({ x, y }));

module.exports = {
  intermediate: [...line(8, 2, 3), ...cells([[8, 0], [13, 2], [9, 5], [3, 1], [13, 4], [4, 0]])],
  cutAware: [...line(6, 2, 3), ...line(3, 4, 7), ...cells([[10, 2], [11, 6], [6, 9], [0, 3]])],
  interleaved: [...line(10, 2, 4), ...line(4, 6, 9),
    ...cells([[2, 8], [10, 2], [15, 1], [2, 11], [16, 5], [15, 7], [8, 11], [2, 2], [12, 0]])],
  bridge: [...line(9, 0, 2), ...cells([[0, 0], [4, 0], [8, 0]])],
  smallBlocks: [...line(18, 0, 2), ...[0, 7, 14].flatMap(x => line(4, x, 0))]
};
