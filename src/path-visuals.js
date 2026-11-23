(function (root) {
  "use strict";
  function createPathVisuals(model, builder) {
    function searchPresentation(snapshot, running) {
      const stage = snapshot?.stage || "preparation";
      const timed = running && ["deep-optimization", "adaptive-optimization", "points-diagonals", "point-sections", "segment-optimization", "chain-reinsertion"].includes(snapshot?.method);
      const searching = running && stage === "search" && !timed;
      const relaying = running && stage === "relay";
      const constructing = running && stage === "construction";
      const preparing = running && ["preparation", "construction", "configuration"].includes(stage);
      const total = relaying ? snapshot.relay?.total : constructing ? snapshot.zone?.total : snapshot?.blocks?.total;
      const done = relaying ? snapshot.relay?.examined : constructing ? snapshot.zone?.completed : snapshot?.blocks?.prepared;
      const knownCount = Number.isFinite(total) && total > 0 && Number.isFinite(done);
      const max = timed ? snapshot.totalLimitMs || 3600000 : searching ? Math.max(1, snapshot.stagnationLimitMs ?? 60000) : knownCount ? total : 1;
      const value = timed ? snapshot.elapsedMs || 0 : searching ? (snapshot.stagnationLimitMs === 0 ? max : snapshot.lastImprovementMs || 0) : knownCount ? done : null;
      return {
        phase: { preparation: "Preparation de la recherche", construction: "Construction des blocs",
          configuration: "Preparation des entrees et sorties", search: "Recherche en cours", relay: "Recherche de relais", complete: "Recherche terminee" }[stage] || "Recherche en cours",
        active: timed || preparing || searching || relaying, searching, timed,
        showConstruction: constructing && snapshot.zone?.status === "running",
        label: timed ? "Temps restant" : relaying ? "Liaisons examinees" : searching ? "Sans amelioration (blocs)" : constructing ? "Blocs construits" : "Blocs prepares",
        count: knownCount ? `${Math.min(total, Math.max(0, done))} / ${total}` : "",
        max, value: value === null ? null : Math.max(0, Math.min(max, value))
      };
    }
    function workPalette(value) {
      const color = /^#[0-9a-f]{6}$/i.test(value || "") ? value.toLowerCase() : "#157f83";
      const channels = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
      const mix = (target, amount) => "#" + channels.map(c => Math.round(c * (1 - amount) + target * amount).toString(16).padStart(2, "0")).join("");
      return { color, fill: mix(255, 0.72), line: mix(0, 0.5) };
    }
    function blockIndex(cells) {
      const index = new Map();
      builder.proximityComponents(cells).forEach((block, id) => {
        block.forEach(cell => index.set(model.cellKey(cell), id));
      });
      return index;
    }
    function sameBlock(a, b, index) {
      const id = index.get(model.cellKey(a));
      return id !== undefined && id === index.get(model.cellKey(b));
    }
    function connections(path, index, threshold) {
      const result = new Map();
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], distance = model.distance(a, b);
        const isCut = Boolean(b.cutBefore) || distance > threshold;
        if (!isCut && sameBlock(a, b, index) && distance === 1) continue;
        const from = model.holes(a).end, to = model.holes(b).start;
        const ends = [`${from.x},${from.y}`, `${to.x},${to.y}`].sort();
        // Reversing an unchanged physical connection should not flash it again.
        const key = `${ends[0]}:${ends[1]}:${Number(isCut)}`;
        result.set(key, { from, to, isCut });
      }
      return result;
    }
    function diffConnections(before, after, index, threshold) {
      const oldLinks = connections(before, index, threshold), newLinks = connections(after, index, threshold);
      return {
        added: [...newLinks].filter(([key]) => !oldLinks.has(key)).map(([, link]) => link),
        removed: [...oldLinks].filter(([key]) => !newLinks.has(key)).map(([, link]) => link)
      };
    }
    function strokeWidths(cellSize, isCut = false, internal = false) {
      return {
        front: Math.max(1.2, cellSize * 0.2),
        back: Math.max(isCut ? 0.6 : internal ? 1 : 1.4, cellSize * (isCut ? 0.045 : internal ? 0.12 : 0.16))
      };
    }
    return { searchPresentation, workPalette, blockIndex, sameBlock, connections, diffConnections, strokeWidths };
  }
  if (root.StitchModel && root.createOrthogonalPathBuilder) {
    root.PathVisuals = createPathVisuals(root.StitchModel, root.createOrthogonalPathBuilder(root.StitchModel));
  }
  if (typeof module !== "undefined") module.exports = { createPathVisuals };
})(typeof window === "undefined" ? globalThis : window);
