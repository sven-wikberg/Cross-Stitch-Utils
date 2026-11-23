(function (root) {
  "use strict";
  function countCells(cells, colorOf = cell => cell.empty ? null : cell.dmc) {
    const counts = new Map();
    for (const cell of cells || []) {
      const dmc = colorOf(cell);
      if (dmc) counts.set(dmc, (counts.get(dmc) || 0) + 1);
    }
    return counts;
  }

  function byCount(items, countOf) {
    return items.map((item, index) => ({ item, index, count: countOf(item) || 0 }))
      .sort((a, b) => a.count - b.count || a.index - b.index)
      .map(entry => entry.item);
  }

  const api = { countCells, byCount };
  root.ColorOrder = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
