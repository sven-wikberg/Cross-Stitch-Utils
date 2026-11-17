(function (root) {
  "use strict";
  function createDiagonalOptimizer(model) {
    function optimizePath(options, report = () => {}) {
      const cells = options.points || [], threshold = options.cutThreshold || 10;
      const constraints = options.constraints || {}, prefix = constraints.lockedPrefix?.length
        ? constraints.lockedPrefix.map(model.copy) : constraints.start ? [model.copy(constraints.start)] : [];
      const cuts = new Set((constraints.forcedCuts || []).map(model.key));
      const fixedLength = prefix.length;
      const started = performance.now(), limit = Math.max(10, options.stagnationLimitMs || 60000);
      let lastImprovement = started, lastReport = 0, improvements = 0, restarts = 0, best, bestMetrics, initialMetrics;
      let changed = false, phase = "Construction des diagonales";
      const expired = () => performance.now() - lastImprovement >= limit;
      function emit(force = false) {
        const now = performance.now();
        if (!force && now - lastReport < 200) return;
        lastReport = now;
        report({ phase, ...(changed || force ? { path: best.map(model.copy) } : {}), metrics: bestMetrics,
          initialMetrics, elapsedMs: now - started, lastImprovementMs: now - lastImprovement,
          stagnationLimitMs: limit, progress: Math.min(99, (now - lastImprovement) / limit * 100), improvements, restarts });
        changed = false;
      }
      function consider(path) {
        if (model.validateRoute(path, cells) || !model.satisfiesConstraints(path, constraints)) return false;
        const metrics = model.metrics(path, threshold);
        if (!best || metrics.score < bestMetrics.score - 1e-8
            || (Math.abs(metrics.score - bestMetrics.score) < 1e-8 && metrics.distance < bestMetrics.distance - 1e-8)) {
          if (best) improvements++;
          best = path.map(model.copy); bestMetrics = metrics; initialMetrics ||= metrics;
          changed = true; lastImprovement = performance.now();
          emit(); return true;
        }
        return false;
      }
      const prefixIds = new Set(prefix.map(model.key));
      function makeSeed(order) {
        const sequence = [...prefix, ...order.flatMap(cell => ["lower", "upper"].map(diagonal => ({
          x: cell.x, y: cell.y, diagonal, direction: 1
        }))).filter(p => !prefixIds.has(model.key(p)))];
        return model.orient(sequence, threshold, constraints);
      }
      if (options.initialPath?.length) consider(options.initialPath);
      if (!best) consider(makeSeed(cells));
      if (!best) throw new Error("Impossible de construire un chemin respectant les contraintes.");
      emit(true);
      if (!cells.length) return { path: [], metrics: bestMetrics, initialMetrics };

      // Danish-style runs stitch lower legs first, then return along the upper legs.
      for (const axis of ["y", "x"]) {
        if (expired()) break;
        const other = axis === "y" ? "x" : "y", groups = new Map();
        for (const cell of cells) {
          if (!groups.has(cell[axis])) groups.set(cell[axis], []);
          groups.get(cell[axis]).push(cell);
        }
        const sequence = [...prefix];
        for (const [, group] of [...groups].sort((a, b) => a[0] - b[0])) {
          group.sort((a, b) => a[other] - b[other]);
          for (const diagonal of ["lower", "upper"]) {
            const order = diagonal === "lower" ? group : [...group].reverse();
            for (const cell of order) {
              const action = { x: cell.x, y: cell.y, diagonal, direction: 1 };
              if (!prefixIds.has(model.key(action))) sequence.push(action);
            }
          }
        }
        consider(model.orient(sequence, threshold, constraints));
      }

      const cellIndex = new Map(cells.map((p, i) => [model.cellKey(p), i]));
      function nearCells(x, y, radius = 3) {
        const found = [];
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
          const i = cellIndex.get(`${Math.floor(x) + dx},${Math.floor(y) + dy}`);
          if (i !== undefined) found.push(i);
        }
        return found;
      }
      function greedy() {
        const state = new Uint8Array(cells.length);
        const route = prefix.map(model.copy);
        for (const p of prefix) state[cellIndex.get(model.cellKey(p))] = p.diagonal === "lower" ? 1 : 2;
        let previous = route.at(-1);
        if (!previous) {
          const start = cells[(restarts * 7919) % cells.length];
          previous = { x: start.x, y: start.y, diagonal: "lower", direction: restarts % 2 ? -1 : 1 };
          if (cuts.has(model.key(previous))) previous.cutBefore = true;
          route.push(previous); state[cellIndex.get(model.cellKey(previous))] = 1;
        }
        while (route.length < cells.length * 2) {
          const end = model.holes(previous).end;
          let selected = null, selectedIndex = -1, selectedCost = Infinity;
          function visit(i) {
            if (state[i] === 2) return;
            const cell = cells[i], diagonal = state[i] ? "upper" : "lower";
            const candidate = { x: cell.x, y: cell.y, diagonal, direction: 1 };
            if (cuts.has(model.key(candidate))) candidate.cutBefore = true;
            for (const direction of [1, -1]) {
              candidate.direction = direction;
              const score = model.cost(previous, candidate, threshold);
              // Randomized ties give genuinely different, still legal, starting routes.
              const tie = restarts ? Math.random() * 0.18 : 0;
              if (score + tie < selectedCost) { selectedCost = score + tie; selected = model.copy(candidate); selectedIndex = i; }
            }
          }
          nearCells(end.x, end.y).forEach(visit);
          if (!selected) for (let i = 0; i < cells.length; i++) visit(i);
          if (!selected) throw new Error("Aucune transition de fil valide.");
          route.push(selected); state[selectedIndex]++; previous = selected;
          if (route.length % 512 === 0) { emit(); if (expired()) return null; }
        }
        return model.orient(route, threshold, constraints);
      }
      function improve(input) {
        let route = input.map(model.copy);
        const positions = new Map();
        const updatePositions = () => { for (let i = 0; i < route.length; i++) positions.set(model.key(route[i]), i); };
        updatePositions();
        let attempts = 0, accepted = 0;
        const maxAttempts = Math.max(2000, route.length * 20);
        while (attempts++ < maxAttempts && !expired()) {
          const i = fixedLength + Math.floor(Math.random() * (route.length - fixedLength));
          if (i >= route.length) break;
          const p = route[i], mate = positions.get(`${model.cellKey(p)}:${p.diagonal === "lower" ? "upper" : "lower"}`);
          const nearby = nearCells(p.x, p.y, 2);
          const targetCell = cells[nearby[Math.floor(Math.random() * nearby.length)]];
          let j = positions.get(`${model.cellKey(targetCell)}:${Math.random() < 0.5 ? "lower" : "upper"}`);
          if (Math.random() < 0.5) j--;
          if (attempts % 64 === 0) j = fixedLength - 1;
          if (j < fixedLength - 1 || j === i || j === i - 1
              || (p.diagonal === "lower" ? j >= mate : j < mate)) continue;
          const before = route[i - 1], after = route[i + 1], left = route[j], right = route[j + 1];
          const oldCost = model.cost(before, p, threshold) + model.cost(p, after, threshold) + model.cost(left, right, threshold);
          let chosen, delta = -1e-8;
          for (const direction of [1, -1]) {
            const candidate = { ...p, direction };
            const gain = model.cost(before, after, threshold) + model.cost(left, candidate, threshold)
              + model.cost(candidate, right, threshold) - oldCost;
            if (gain < delta) { delta = gain; chosen = candidate; }
          }
          if (chosen) {
            route.splice(i, 1); route.splice(j >= i ? j : j + 1, 0, chosen);
            updatePositions(); accepted++;
            if (accepted % 20 === 0 || performance.now() - lastReport > 200) consider(route);
          }
          if (attempts % 256 === 0) emit();
        }
        consider(route);
        if (!expired()) consider(model.orient(route, threshold, constraints));
      }
      phase = "Recherche des transitions au dos";
      while (!expired()) {
        const candidate = greedy();
        if (candidate) { consider(candidate); phase = "Optimisation des diagonales"; improve(candidate); }
        if (!expired()) improve(best);
        restarts++; phase = "Nouvelle recherche de chemin"; emit();
      }
      phase = "Recherche terminee"; emit(true);
      return { path: best, metrics: bestMetrics, initialMetrics, elapsedMs: performance.now() - started,
        lastImprovementMs: performance.now() - lastImprovement, stagnationLimitMs: limit, improvements, restarts, progress: 100, phase };
    }
    return { optimizePath, satisfiesConstraints: model.satisfiesConstraints };
  }
  function workerMain(createModel, createOptimizer) {
    self.onmessage = event => {
      const options = event.data;
      if (options.type !== "start") return;
      try {
        const result = createOptimizer(createModel()).optimizePath(options,
          snapshot => self.postMessage({ ...snapshot, type: "progress", runId: options.runId }));
        self.postMessage({ ...result, type: "complete", runId: options.runId });
      } catch (error) { self.postMessage({ type: "error", runId: options.runId, message: error.message }); }
    };
  }
  root.createPathOptimizerApi = () => createDiagonalOptimizer(root.StitchModel);
  root.createPathOptimizerWorker = () => {
    const source = `(${workerMain.toString()})(${root.createStitchModel.toString()},${createDiagonalOptimizer.toString()});`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url); URL.revokeObjectURL(url); return worker;
  };
  if (typeof module !== "undefined") module.exports = { createDiagonalOptimizer };
})(typeof window === "undefined" ? globalThis : window);
