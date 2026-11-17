(function (root) {
  "use strict";
  function createStitchModel() {
    const cellKey = p => `${p.x},${p.y}`;
    const key = p => `${cellKey(p)}:${p.diagonal}`;
    const sameHole = (a, b) => a.x === b.x && a.y === b.y;
    const copy = p => ({ x: p.x, y: p.y, diagonal: p.diagonal, direction: p.direction,
      ...(p.cutBefore ? { cutBefore: true } : {}) });
    function holes(p) {
      const a = { x: p.x, y: p.y + (p.diagonal === "lower" ? 1 : 0) };
      const b = { x: p.x + 1, y: p.y + (p.diagonal === "lower" ? 0 : 1) };
      return p.direction === -1 ? { start: b, end: a } : { start: a, end: b };
    }
    function distance(a, b) {
      const end = holes(a).end, start = holes(b).start;
      return Math.hypot(end.x - start.x, end.y - start.y);
    }
    function cost(a, b, threshold = 10) {
      if (!a || !b) return 0;
      const d = distance(a, b);
      if (d === 0) return Infinity;
      return b.cutBefore || d > threshold ? threshold * 3 : d;
    }
    function metrics(path, threshold = 10) {
      let distanceTotal = 0, score = 0, cuts = 0;
      for (let i = 1; i < path.length; i++) {
        const d = distance(path[i - 1], path[i]);
        distanceTotal += d;
        if (path[i].cutBefore || d > threshold) cuts++;
        score += cost(path[i - 1], path[i], threshold);
      }
      return { distance: distanceTotal, score, realisticScore: score, cuts, frontDistance: path.length * Math.SQRT2 };
    }
    function validateRoute(path, cells, complete = true) {
      if (!Array.isArray(path)) return "Chemin absent.";
      const expected = cells ? new Set(cells.map(cellKey)) : null;
      const seen = new Set();
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.y < 0
            || !["lower", "upper"].includes(p.diagonal) || ![1, -1].includes(p.direction)
            || (p.cutBefore !== undefined && typeof p.cutBefore !== "boolean")) return "Diagonale invalide.";
        if (expected && !expected.has(cellKey(p))) return "Diagonale hors couleur.";
        if (seen.has(key(p))) return "Diagonale dupliquee.";
        if (p.diagonal === "upper" && !seen.has(`${cellKey(p)}:lower`)) return "La diagonale / doit preceder la diagonale \\.";
        if (i && sameHole(holes(path[i - 1]).end, holes(p).start)) return "Deux diagonales consecutives utilisent le meme trou de sortie et d'entree.";
        seen.add(key(p));
      }
      if (complete && expected && path.length !== expected.size * 2) return "Le chemin doit couvrir les deux diagonales de chaque case.";
      return "";
    }
    function satisfiesConstraints(path, constraints = {}) {
      if (validateRoute(path, null, false)) return false;
      const equal = (a, b) => a && b && key(a) === key(b) && a.direction === b.direction;
      if (constraints?.start && !equal(path[0], constraints.start)) return false;
      if ((constraints?.lockedPrefix || []).some((p, i) => !equal(p, path[i]))) return false;
      const cuts = new Set(path.filter(p => p.cutBefore).map(key));
      return (constraints?.forcedCuts || []).every(p => cuts.has(key(p)));
    }
    // For a fixed order, dynamic programming finds the best of both sewing directions.
    function orient(sequence, threshold = 10, constraints = {}) {
      if (!sequence.length) return [];
      const cutKeys = new Set((constraints.forcedCuts || []).map(key));
      const path = sequence.map(p => ({ ...copy(p), cutBefore: p.cutBefore || cutKeys.has(key(p)) || undefined }));
      const prefix = constraints.lockedPrefix || [];
      const parents = new Int8Array(path.length * 2);
      let previous = [0, 0];
      for (let i = 0; i < path.length; i++) {
        const current = [Infinity, Infinity];
        const fixed = prefix[i] || (i === 0 ? constraints.start : null);
        for (let d = 0; d < 2; d++) {
          const direction = d ? -1 : 1;
          if (fixed && (key(fixed) !== key(path[i]) || fixed.direction !== direction)) continue;
          if (!i) { current[d] = 0; continue; }
          for (let before = 0; before < 2; before++) {
            const score = previous[before] + cost({ ...path[i - 1], direction: before ? -1 : 1 }, { ...path[i], direction }, threshold);
            if (score < current[d]) { current[d] = score; parents[i * 2 + d] = before; }
          }
        }
        previous = current;
      }
      let direction = previous[0] <= previous[1] ? 0 : 1;
      if (!Number.isFinite(previous[direction])) throw new Error("Les directions imposees rendent le chemin impossible.");
      for (let i = path.length - 1; i >= 0; i--) {
        path[i].direction = direction ? -1 : 1;
        direction = parents[i * 2 + direction];
        if (!path[i].cutBefore) delete path[i].cutBefore;
      }
      return path;
    }
    function expandCells(cells, threshold = 10, oldConstraints = {}) {
      const cuts = new Set((oldConstraints.forcedCuts || []).map(edge => cellKey(edge.to)));
      return orient(cells.flatMap(p => [
        { x: p.x, y: p.y, diagonal: "lower", direction: 1, ...(cuts.has(cellKey(p)) ? { cutBefore: true } : {}) },
        { x: p.x, y: p.y, diagonal: "upper", direction: 1 }
      ]), threshold);
    }
    function validatePattern(pattern) {
      if (!pattern || pattern.kind !== "cross-stitch-pattern" || pattern.schemaVersion !== 1
          || !pattern.project?.name?.trim() || !Array.isArray(pattern.colors) || !pattern.colors.length) throw new Error("Pattern invalide.");
      const grid = pattern.grid;
      if (!grid || !Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 1 || grid.height < 1
          || !Array.isArray(grid.cells) || grid.cells.length !== grid.width * grid.height) throw new Error("Dimensions invalides.");
      const colors = new Set(pattern.colors.map(c => c.dmc));
      if (colors.size !== pattern.colors.length || [...colors].some(c => typeof c !== "string" || !c)) throw new Error("Palette invalide.");
      const seen = new Set();
      for (const cell of grid.cells) {
        if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 || cell.y < 0
            || cell.x >= grid.width || cell.y >= grid.height || seen.has(cellKey(cell))
            || (!cell.empty && !colors.has(cell.dmc))) throw new Error("Cellule invalide ou dupliquee.");
        seen.add(cellKey(cell));
      }
    }
    function upgradePathsFile(data) {
      if (!data || data.kind !== "cross-stitch-paths" || ![1, 2].includes(data.schemaVersion)) throw new Error("Fichier de chemins invalide.");
      validatePattern(data.pattern);
      if (!data.project?.name?.trim() || !Array.isArray(data.paths) || data.paths.length !== data.pattern.colors.length) throw new Error("Liste des chemins invalide.");
      const threshold = data.settings?.cutThreshold ?? 10;
      if (!Number.isFinite(threshold) || threshold < 1) throw new Error("Distance de coupe invalide.");
      const cellsByColor = new Map(data.pattern.colors.map(c => [c.dmc, []]));
      for (const cell of data.pattern.grid.cells) if (!cell.empty) cellsByColor.get(cell.dmc).push(cell);
      const seen = new Set();
      const paths = data.paths.map(path => {
        if (!path || seen.has(path.dmc) || !cellsByColor.has(path.dmc) || !Array.isArray(path.points)) throw new Error("Couleur de chemin invalide.");
        seen.add(path.dmc);
        let points = path.points, constraints = path.constraints || {};
        if (data.schemaVersion === 1) {
          const expected = new Set(cellsByColor.get(path.dmc).map(cellKey));
          if (points.length !== expected.size || points.some(p => !p || !Number.isInteger(p.x) || !Number.isInteger(p.y)
              || !expected.delete(cellKey(p)))) throw new Error("Ancien chemin incomplet ou duplique.");
          points = expandCells(points, threshold, { ...constraints, forcedCuts: path.forcedCuts || constraints.forcedCuts || [] });
          constraints = { ...(constraints.start && points.length ? { start: copy(points[0]) } : {}),
            lockedPrefix: points.slice(0, (constraints.lockedPrefix?.length || 0) * 2).map(copy),
            forcedCuts: points.filter(p => p.cutBefore).map(copy) };
        }
        const error = validateRoute(points, cellsByColor.get(path.dmc));
        if (error) throw new Error(error);
        if (!satisfiesConstraints(points, constraints)) throw new Error("Contraintes de chemin invalides.");
        if (data.schemaVersion === 2 && path.forcedCuts !== undefined) {
          const actualCuts = new Set(points.filter(p => p.cutBefore).map(key));
          if (!Array.isArray(path.forcedCuts) || path.forcedCuts.length !== actualCuts.size
              || path.forcedCuts.some(p => !p || !actualCuts.delete(key(p)))) throw new Error("Coupes imposees incoherentes.");
        }
        return { dmc: path.dmc, symbol: path.symbol || null, points: points.map(copy), constraints,
          forcedCuts: points.filter(p => p.cutBefore).map(copy) };
      });
      return { ...data, schemaVersion: 2, stitchUnit: "diagonal", paths };
    }
    function upgradeProgressSave(data) {
      if (!data || data.kind !== "cross-stitch-progress-save" || ![1, 2].includes(data.schemaVersion)
          || data.pathsFile?.schemaVersion !== data.schemaVersion) throw new Error("Version de sauvegarde invalide.");
      const pathsFile = upgradePathsFile(data.pathsFile);
      if (!data.stitchedByDmc || typeof data.stitchedByDmc !== "object" || Array.isArray(data.stitchedByDmc)) throw new Error("Progression absente.");
      const counts = {}, factor = data.schemaVersion === 1 ? 2 : 1;
      const limits = new Map(pathsFile.paths.map(p => [p.dmc, p.points.length]));
      for (const [dmc, count] of Object.entries(data.stitchedByDmc)) {
        if (!limits.has(dmc) || !Number.isInteger(count) || count < 0 || count * factor > limits.get(dmc)) throw new Error("Progression invalide.");
        counts[dmc] = count * factor;
      }
      const history = actions => (actions || []).filter(a => limits.has(a.dmc)
        && Number.isInteger(a.before) && Number.isInteger(a.after) && a.before >= 0 && a.after >= 0
        && a.before * factor <= limits.get(a.dmc) && a.after * factor <= limits.get(a.dmc))
        .map(a => ({ ...a, before: a.before * factor, after: a.after * factor }));
      return { ...data, schemaVersion: 2, stitchUnit: "diagonal", pathsFile, stitchedByDmc: counts,
        undoActions: history(data.undoActions), redoActions: history(data.redoActions) };
    }
    function completion(path, count) {
      const cells = new Map();
      for (let i = 0; i < Math.min(count, path.length); i++) {
        const p = path[i], k = cellKey(p);
        cells.set(k, (cells.get(k) || 0) | (p.diagonal === "lower" ? 1 : 2));
      }
      const complete = [...cells.values()].filter(bits => bits === 3).length;
      return { cells, complete, partial: cells.size - complete };
    }
    return { cellKey, key, copy, holes, sameHole, distance, cost, metrics, validateRoute, satisfiesConstraints,
      orient, expandCells, validatePattern, upgradePathsFile, upgradeProgressSave, completion };
  }
  root.createStitchModel = createStitchModel;
  root.StitchModel = createStitchModel();
  if (typeof module !== "undefined") module.exports = { createStitchModel, ...root.StitchModel };
})(typeof window === "undefined" ? globalThis : window);
