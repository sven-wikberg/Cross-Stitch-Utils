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

  const api = { DEFAULT_DIAGONALS_PER_STRAND, STRANDS_PER_PIECE, PIECES_PER_SKEIN, normalizeCapacity, estimate };
  root.ThreadEstimate = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
