(function (root) {
  "use strict";
  function createRegionOptimizer(model, createBuilder, clock = () => performance.now(), random = Math.random) {
    const builder = createBuilder(model, clock), epsilon = 1e-8;
    const contains = (rect, p) => Boolean(rect) && p.x >= rect.minX && p.x < rect.maxX && p.y >= rect.minY && p.y < rect.maxY;
    function rectangle(a, b, width, height) {
      const x = value => Math.max(0, Math.min(width - 1, Math.floor(value)));
      const y = value => Math.max(0, Math.min(height - 1, Math.floor(value)));
      return { minX: Math.min(x(a.x), x(b.x)), minY: Math.min(y(a.y), y(b.y)),
        maxX: Math.max(x(a.x), x(b.x)) + 1, maxY: Math.max(y(a.y), y(b.y)) + 1 };
    }
    function selection(path, rect, constraints = {}) {
      const locked = Math.max(constraints.lockedPrefix?.length || 0, Number(Boolean(constraints.start)));
      const runs = [], crosses = new Set(); let run = null, diagonals = 0;
      path.forEach((point, i) => {
        if (contains(rect, point)) crosses.add(model.cellKey(point));
        if (i >= locked && contains(rect, point)) {
          if (!run) { run = { start: i, end: i }; runs.push(run); }
          run.end = i + 1; diagonals++;
        } else run = null;
      });
      return { runs, crosses: crosses.size, diagonals, locked };
    }
    function preservesOutside(before, after, rect, constraints = {}) {
      if (!Array.isArray(after) || before.length !== after.length) return false;
      const selected = selection(before, rect, constraints);
      for (let i = 0; i < before.length; i++) {
        if ((i < selected.locked || !contains(rect, before[i])) && JSON.stringify(before[i]) !== JSON.stringify(after[i])) return false;
      }
      for (const run of selected.runs) {
        const keys = new Set(before.slice(run.start, run.end).map(model.key));
        for (let i = run.start; i < run.end; i++) if (!after[i] || !keys.delete(model.key(after[i]))) return false;
        if (keys.size) return false;
      }
      return true;
    }
    function optimizePath(options, report = () => {}) {
      const rect = options.region, initial = options.initialPath || [], cells = options.points || [];
      if (!rect || ![rect.minX, rect.minY, rect.maxX, rect.maxY].every(Number.isInteger)
          || rect.minX < 0 || rect.minY < 0 || rect.maxX <= rect.minX || rect.maxY <= rect.minY) throw new Error("Selection invalide.");
      const error = model.validateRoute(initial, cells), constraints = options.constraints || {};
      if (error || !model.satisfiesConstraints(initial, constraints)) throw new Error(error || "Contraintes incompatibles avec le parcours.");
      const selected = selection(initial, rect, constraints);
      if (!selected.diagonals) throw new Error("Aucune diagonale modifiable dans cette selection.");
      const threshold = Math.max(1, Number(options.cutThreshold) || 10), limit = Math.max(1, Number(options.stagnationLimitMs) || 60000);
      const zones = model.createZones(cells), initialMetrics = zones.measure(initial, threshold);
      let best = initial.map(p => ({ ...p })), metrics = initialMetrics, attempts = 0, improvements = 0, restarts = 0;
      const started = clock(); let lastImprovement = started, lastReport = -Infinity, changed = true, activeVisit = 0;
      const rand = n => Math.min(n - 1, Math.floor(random() * n));
      const expired = () => clock() - lastImprovement >= limit;
      function emit(force = false, done = false) {
        const now = clock();
        if (!force && now - lastReport < 150) return;
        lastReport = now;
        const snapshot = { method: "region-optimization", stage: done ? "complete" : "search",
          phase: done ? "Optimisation de la selection terminee" : "Optimisation de la selection", metrics, initialMetrics,
          region: { ...rect, crosses: selected.crosses, diagonals: selected.diagonals, visits: selected.runs.length, activeVisit },
          elapsedMs: now - started, lastImprovementMs: now - lastImprovement, stagnationLimitMs: limit,
          attempts, improvements, restarts, progress: done ? 100 : Math.min(99, (now - lastImprovement) / limit * 100),
          ...(changed || force ? { path: best.map(p => ({ ...p })) } : {}) };
        changed = false; report(snapshot); return snapshot;
      }
      // Outside actions (including sewing directions) bound each independent visit to the selection.
      const runs = selected.runs.map(run => {
        const sequence = initial.slice(run.start, run.end), previous = initial[run.start - 1], next = initial[run.end];
        const originals = new Map(sequence.map(p => [model.key(p), p]));
        const lowerKeys = new Set(sequence.filter(p => p.diagonal === "lower").map(model.cellKey));
        const score = route => {
          let value = previous ? model.cost(previous, route[0], threshold, true) : 0;
          for (let i = 1; i < route.length; i++) value += model.cost(route[i - 1], route[i], threshold, true);
          return value + (next ? model.cost(route.at(-1), next, threshold, true) : 0);
        };
        const legal = route => {
          const seen = new Set();
          for (const p of route) {
            const key = model.cellKey(p);
            if (p.diagonal === "upper" && lowerKeys.has(key) && !seen.has(key)) return false;
            if (p.diagonal === "lower") seen.add(key);
          }
          return true;
        };
        const orient = route => {
          if (!legal(route)) return null;
          const result = builder.orientUnitPath(route, [], {}, threshold, previous, next ? [next] : []);
          if (!result) return null;
          return { path: result.path.map(p => ({ ...originals.get(model.key(p)), direction: p.direction })), score: result.score };
        };
        const countByCell = new Map();
        for (const p of sequence) countByCell.set(model.cellKey(p), (countByCell.get(model.cellKey(p)) || 0) + 1);
        const complete = sequence.filter(p => p.diagonal === "lower" && countByCell.get(model.cellKey(p)) === 2);
        const groups = builder.orthogonalComponents(complete);
        const partial = sequence.filter(p => countByCell.get(model.cellKey(p)) === 1).map(p => [p]);
        const seed = () => {
          const chunks = groups.map(group => builder.buildSequence(group, group[rand(group.length)])
            .map(p => originals.get(model.key(p)))).concat(partial);
          const ordered = []; let last = previous;
          while (chunks.length) {
            let at = rand(chunks.length);
            if (last && random() < 0.8) {
              let gap = Infinity;
              chunks.forEach((chunk, i) => {
                const distance = Math.hypot(last.x - chunk[0].x, last.y - chunk[0].y);
                if (distance < gap) { gap = distance; at = i; }
              });
            }
            const chunk = chunks.splice(at, 1)[0]; for (const p of chunk) ordered.push(p); last = chunk.at(-1);
          }
          return ordered;
        };
        let requiredCuts = sequence.filter(p => p.cutBefore).length + Number(Boolean(next?.cutBefore));
        if (!previous && sequence.some(p => p.diagonal === "lower" && p.cutBefore)) requiredCuts--;
        const minimum = Math.max(0, sequence.length - 1) + Number(Boolean(previous)) + Number(Boolean(next)) + requiredCuts * threshold * 3;
        return { ...run, previous, next, originals, orient, seed, legal, minimum, best: sequence,
          score: score(sequence), working: sequence, workingScore: score(sequence), misses: 0, proposals: 0,
          exact: sequence.length <= 6 ? permutations(sequence) : null, exhausted: false };
      });
      function* permutations(points, prefix = []) {
        if (!points.length) { yield prefix; return; }
        for (let i = 0; i < points.length; i++) yield* permutations(points.filter((_, j) => i !== j), [...prefix, points[i]]);
      }
      function consider(run, sequence) {
        attempts++;
        const candidate = run.orient(sequence);
        if (!candidate) { run.misses++; return; }
        if (candidate.score < run.workingScore - epsilon) {
          run.working = candidate.path; run.workingScore = candidate.score; run.misses = 0;
        } else run.misses++;
        if (candidate.score >= run.score - epsilon) return;
        const path = best.slice();
        candidate.path.forEach((p, i) => { path[run.start + i] = p; });
        const measured = zones.measure(path, threshold);
        if (measured.score >= metrics.score - epsilon || model.validateRoute(path, cells)
            || !model.satisfiesConstraints(path, constraints) || !preservesOutside(initial, path, rect, constraints)) return;
        run.best = candidate.path; run.score = candidate.score;
        best = path; metrics = measured; improvements++; changed = true; lastImprovement = clock();
        emit();
      }
      function mutate(sequence) {
        const result = sequence.slice(), i = rand(result.length), j = rand(result.length), operation = rand(4);
        if (operation === 0) { const [point] = result.splice(i, 1); result.splice(j, 0, point); }
        else if (operation === 1) [result[i], result[j]] = [result[j], result[i]];
        else if (operation === 2) {
          for (let a = Math.min(i, j), b = Math.max(i, j); a < b; a++, b--) [result[a], result[b]] = [result[b], result[a]];
        } else {
          const count = Math.min(1 + rand(8), result.length - i), fragment = result.splice(i, count);
          result.splice(Math.min(j, result.length), 0, ...fragment);
        }
        return result;
      }
      lastImprovement = clock(); emit(true);
      for (const [i, run] of runs.entries()) {
        if (expired()) break;
        activeVisit = i + 1; consider(run, run.best);
      }
      let cursor = 0;
      while (!expired()) {
        const available = runs.filter(run => !run.exhausted && run.score > run.minimum + epsilon);
        if (!available.length) break;
        const run = available[cursor++ % available.length]; activeVisit = runs.indexOf(run) + 1;
        if (run.exact) {
          const next = run.exact.next();
          if (next.done) run.exhausted = true;
          else consider(run, next.value);
        } else {
          const seed = run.proposals++ % 64 === 0;
          consider(run, seed ? run.seed() : mutate(run.working));
          if (run.misses >= Math.max(32, Math.min(256, run.best.length))) {
            const candidate = run.orient(run.seed());
            run.working = candidate?.path || run.best;
            run.workingScore = candidate?.score ?? run.score;
            run.misses = 0; restarts++;
          }
        }
        emit();
      }
      return emit(true, true);
    }
    return { rectangle, contains, selection, preservesOutside, optimizePath };
  }
  function workerMain(createModel, createBuilder, createOptimizer) {
    self.onmessage = event => {
      const options = event.data;
      if (options.type !== "start") return;
      try {
        const result = createOptimizer(createModel(), createBuilder).optimizePath(options,
          snapshot => self.postMessage({ ...snapshot, type: "progress", runId: options.runId }));
        self.postMessage({ ...result, type: "complete", runId: options.runId });
      } catch (error) { self.postMessage({ type: "error", runId: options.runId, message: error.message }); }
    };
  }
  root.createRegionOptimizer = createRegionOptimizer;
  root.createRegionOptimizerWorker = () => {
    const source = `(${workerMain.toString()})(${root.createStitchModel.toString()},${root.createOrthogonalPathBuilder.toString()},${createRegionOptimizer.toString()});`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url); URL.revokeObjectURL(url); return worker;
  };
  if (typeof module !== "undefined") module.exports = { createRegionOptimizer };
})(typeof window === "undefined" ? globalThis : window);
