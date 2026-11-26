(function (root) {
  "use strict";
  const model = typeof module !== "undefined" ? require("./stitch-model.js") : root.StitchModel;
  const DEFAULT_DIAGONALS_PER_STRAND = 45;
  const STRANDS_PER_PIECE = 6;
  const PIECES_PER_SKEIN = 16;

  function normalizeCapacity(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function estimate(path, capacity = DEFAULT_DIAGONALS_PER_STRAND, cutThreshold = 10) {
    if (!normalizeCapacity(capacity)) throw new RangeError("Invalid diagonals per strand");
    if (!Number.isFinite(cutThreshold) || cutThreshold <= 0) throw new RangeError("Invalid cut threshold");
    let segmentLength = 0, strands = 0, cuts = 0;
    for (let i = 0; i < path.length; i++) {
      if (i > 0 && (path[i].cutBefore || model.distance(path[i - 1], path[i]) > cutThreshold)) {
        // A cut discards any remaining capacity, including within an unfinished cross.
        strands += Math.ceil(segmentLength / capacity);
        segmentLength = 0;
        cuts++;
      }
      segmentLength++;
    }
    strands += Math.ceil(segmentLength / capacity);
    const pieces = Math.ceil(strands / STRANDS_PER_PIECE);
    return { diagonals: path.length, cuts, strands, pieces, skeins: Math.ceil(pieces / PIECES_PER_SKEIN) };
  }

  function createRemainingEstimator(path, capacity = DEFAULT_DIAGONALS_PER_STRAND, cutThreshold = 10) {
    if (!normalizeCapacity(capacity)) throw new RangeError("Invalid diagonals per strand");
    if (!Number.isFinite(cutThreshold) || cutThreshold <= 0) throw new RangeError("Invalid cut threshold");
    const starts = [0];
    for (let i = 1; i < path.length; i++) {
      if (path[i].cutBefore || model.distance(path[i - 1], path[i]) > cutThreshold) starts.push(i);
    }
    const ends = [...starts.slice(1), path.length];
    const suffixStrands = new Array(starts.length + 1).fill(0);
    // Index the cuts once, so advancing a diagonal does not rescan a large pattern.
    for (let i = starts.length - 1; i >= 0; i--) {
      suffixStrands[i] = suffixStrands[i + 1] + Math.ceil((ends[i] - starts[i]) / capacity);
    }
    function at(stitched, currentThread = null) {
      if (!Number.isSafeInteger(stitched) || stitched < 0 || stitched > path.length) throw new RangeError("Invalid progress");
      if (stitched === path.length) return { diagonals: 0, cuts: 0, currentDiagonals: 0, strands: 0, pieces: 0, uncertainCurrent: false };
      let low = 0, high = starts.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (starts[middle] <= stitched) low = middle + 1;
        else high = middle;
      }
      const segment = low - 1, firstLength = ends[segment] - stitched;
      const cutNow = stitched > 0 && starts[segment] === stitched;
      const hasCurrent = currentThread?.end === null && Number.isSafeInteger(currentThread.start)
        && currentThread.start >= 0 && currentThread.start < stitched;
      const uncertainCurrent = Boolean(hasCurrent && !cutNow
        && (currentThread.partial || currentThread.start < starts[segment]));
      const currentDiagonals = hasCurrent && !cutNow && !uncertainCurrent
        ? Math.min(firstLength, Math.max(0, capacity - (stitched - currentThread.start))) : 0;
      const strands = Math.ceil((firstLength - currentDiagonals) / capacity) + suffixStrands[segment + 1];
      return { diagonals: path.length - stitched, cuts: starts.length - segment - 1 + Number(cutNow),
        currentDiagonals, strands, pieces: Math.ceil(strands / STRANDS_PER_PIECE), uncertainCurrent };
    }
    return { at };
  }

  const api = { DEFAULT_DIAGONALS_PER_STRAND, STRANDS_PER_PIECE, PIECES_PER_SKEIN, normalizeCapacity, estimate, createRemainingEstimator };
  root.ThreadEstimate = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
