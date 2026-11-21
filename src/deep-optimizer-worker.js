(function (root) {
  "use strict";
  function createLnsSearch(model, clock = () => performance.now(), random = Math.random) {
    const epsilon = 1e-8, maximumSize = 14;
    const lockedLength = constraints => Math.max(constraints.lockedPrefix?.length || 0, Number(Boolean(constraints.start)));
    function context(path, constraints = {}, threshold = 10) {
      const locked = lockedLength(constraints), byKey = new Map(), byCell = new Map(), links = [];
      path.forEach((point, i) => {
        byKey.set(model.key(point), i);
        if (i < locked) return;
        const key = model.cellKey(point);
        if (!byCell.has(key)) byCell.set(key, { x: point.x, y: point.y, indices: [] });
        byCell.get(key).indices.push(i);
      });
      for (let i = Math.max(1, locked); i < path.length; i++) {
        const cost = model.cost(path[i - 1], path[i], threshold, true);
        if (cost > Math.SQRT2 + epsilon) links.push({ at: i, cost });
      }
      links.sort((a, b) => b.cost - a.cost || a.at - b.at);
      return { path, locked, byKey, byCell, cells: [...byCell.values()], links };
    }
    function selectNeighborhood(state, round, size) {
      const { path, locked, links, cells, byCell } = state;
      const count = Math.min(maximumSize, size, path.length - locked);
      if (!count) return { indices: [], kind: "Parcours verrouille" };
      const rand = n => Math.min(n - 1, Math.floor(random() * n));
      const link = links.length ? links[round % links.length].at : locked + rand(path.length - locked);
      const mode = round % 4;
      if (mode === 2) {
        const start = Math.max(locked, Math.min(path.length - count, link - Math.floor(count / 2)));
        return { indices: Array.from({ length: count }, (_, i) => start + i), kind: "Fragment du parcours" };
      }
      const chosen = new Set();
      function add(cell) {
        if (!cell) return;
        const fresh = cell.indices.filter(i => !chosen.has(i));
        if (chosen.size + fresh.length <= count) fresh.forEach(i => chosen.add(i));
      }
      let center;
      if (mode === 3) {
        const cell = cells[rand(cells.length)]; add(cell); center = cell;
      } else {
        const a = path[Math.max(locked, link - 1)], b = path[link];
        add(byCell.get(model.cellKey(a))); add(byCell.get(model.cellKey(b)));
        center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      // Keep a bounded local pool without sorting every cell of a large pattern.
      let nearby = [];
      for (const cell of cells) {
        nearby.push({ cell, distance: (cell.x - center.x) ** 2 + (cell.y - center.y) ** 2 });
        if (nearby.length >= 128) nearby = nearby.sort((a, b) => a.distance - b.distance).slice(0, 64);
      }
      nearby.sort((a, b) => a.distance - b.distance);
      if (mode === 1) {
        const pool = nearby.splice(0, Math.min(32, nearby.length));
        while (pool.length && chosen.size < count) add(pool.splice(rand(pool.length), 1)[0].cell);
      }
      for (const { cell } of nearby) { add(cell); if (chosen.size >= count) break; }
      return { indices: [...chosen].sort((a, b) => a - b), kind: mode === 0 ? "Liaisons couteuses" : "Voisinage spatial" };
    }
    function repairNeighborhood(path, indices, options = {}, report = () => {}) {
      const threshold = options.cutThreshold || 10, constraints = options.constraints || {};
      const positions = [...new Set(indices)].sort((a, b) => a - b), n = positions.length;
      const locked = lockedLength(constraints);
      if (!n || n > maximumSize || positions.some(i => !Number.isInteger(i) || i < locked || i >= path.length)) {
        throw new Error("Voisinage LNS invalide.");
      }
      const deadline = options.deadline ?? Infinity, expired = () => deadline !== Infinity && clock() >= deadline;
      const noise = Math.max(0, options.noise || 0), jitter = cost => cost + (Number.isFinite(cost) && noise ? random() * noise : 0);
      const byKey = options.context?.byKey || new Map(path.map((p, i) => [model.key(p), i]));
      const free = new Map(positions.map((at, j) => [at, j]));
      const variants = positions.map(at => [1, -1].map(direction => ({ ...model.copy(path[at]), direction })));
      const counterpart = positions.map(at => byKey.get(`${model.cellKey(path[at])}:${path[at].diagonal === "lower" ? "upper" : "lower"}`));
      const canPlace = (j, mask, slot) => {
        const other = counterpart[j], lower = path[positions[j]].diagonal === "lower";
        if (other === undefined) return false;
        if (free.has(other)) return lower ? !(mask & (1 << free.get(other))) : Boolean(mask & (1 << free.get(other)));
        return lower ? positions[slot] < other : positions[slot] > other;
      };
      const width = n * 2, count = 1 << n;
      const direct = new Float64Array(width * width);
      for (let a = 0; a < width; a++) for (let b = 0; b < width; b++) {
        direct[a * width + b] = jitter(model.cost(variants[a >> 1][a & 1], variants[b >> 1][b & 1], threshold, true));
      }
      const incoming = positions.map(at => Float64Array.from({ length: width }, (_, node) =>
        at ? jitter(model.cost(path[at - 1], variants[node >> 1][node & 1], threshold, true)) : 0));
      const outgoing = positions.map(at => Float64Array.from({ length: width }, (_, node) =>
        at + 1 < path.length ? jitter(model.cost(variants[node >> 1][node & 1], path[at + 1], threshold, true)) : 0));
      const scores = new Float64Array(count * width).fill(Infinity), parents = new Int16Array(count * width).fill(-1);
      const sizes = new Uint8Array(count);
      for (let mask = 1; mask < count; mask++) sizes[mask] = sizes[mask >> 1] + (mask & 1);
      for (let j = 0; j < n; j++) if (canPlace(j, 0, 0)) {
        for (let d = 0; d < 2; d++) scores[(1 << j) * width + j * 2 + d] = incoming[0][j * 2 + d];
      }
      let attempts = 0;
      // Held-Karp subset DP: rebuild all relaxed slots jointly, with precedence and both directions.
      // Untouched gaps keep their order AND directions; both boundary connections enter the objective.
      for (let mask = 1; mask < count - 1; mask++) {
        if ((mask & 31) === 1) {
          if (expired()) return { path: null, attempts, timedOut: true };
          if ((mask & 255) === 1) report({ attempts, processed: mask, total: count - 1 });
        }
        const slot = sizes[mask], adjacent = positions[slot] === positions[slot - 1] + 1;
        for (let last = 0; last < width; last++) {
          const value = scores[mask * width + last];
          if (!Number.isFinite(value)) continue;
          for (let j = 0; j < n; j++) if (!(mask & (1 << j)) && canPlace(j, mask, slot)) {
            for (let d = 0; d < 2; d++) {
              attempts++;
              const next = j * 2 + d, at = (mask | (1 << j)) * width + next;
              const candidate = value + (adjacent ? direct[last * width + next] : outgoing[slot - 1][last] + incoming[slot][next]);
              if (candidate < scores[at]) { scores[at] = candidate; parents[at] = last; }
            }
          }
        }
      }
      if (expired()) return { path: null, attempts, timedOut: true };
      let node = -1, score = Infinity;
      for (let last = 0; last < width; last++) {
        const value = scores[(count - 1) * width + last] + outgoing[n - 1][last];
        if (value < score) { score = value; node = last; }
      }
      if (node < 0) return { path: null, attempts, timedOut: false };
      const repaired = path.map(model.copy);
      for (let mask = count - 1, slot = n - 1; slot >= 0; slot--) {
        repaired[positions[slot]] = variants[node >> 1][node & 1];
        const previous = parents[mask * width + node];
        mask ^= 1 << (node >> 1); node = previous;
      }
      return { path: repaired, attempts, timedOut: false, metrics: model.metrics(repaired, threshold, true) };
    }
    return { context, selectNeighborhood, repairNeighborhood, maximumSize };
  }
  function createDeepOptimizer(model, createBuilder, createBlock, createRelay, createLns, clock = () => performance.now(), random = Math.random) {
    const epsilon = 1e-8, builder = createBuilder(model, clock), lns = createLns(model, clock, random);
    function optimizePath(options, report = () => {}) {
      const started = clock(), totalLimitMs = Math.min(3600000, Math.max(1, Number(options.totalLimitMs) || 3600000));
      const deadline = started + totalLimitMs, threshold = options.cutThreshold || 10, cells = options.points || [];
      const constraints = { ...(options.constraints || {}), forcedCuts: [
        ...(options.constraints?.forcedCuts || []), ...(options.initialPath || []).filter(p => p.cutBefore)
      ] };
      const zones = model.createZones(cells), measure = path => zones.measure(path, threshold);
      let best = options.initialPath?.length && !model.validateRoute(options.initialPath, cells)
        && model.satisfiesConstraints(options.initialPath, constraints) ? options.initialPath.map(model.copy) : null;
      let metrics = best ? measure(best) : null, initialMetrics = metrics;
      let partialPath = null, partialMetrics = null;
      let lastReport = -Infinity, lastImprovement = started, changed = Boolean(best), improvements = 0, attempts = 0;
      let warm = {}, stage = "preparation", phase = "Preparation du parcours", reason = "time-limit";
      const stats = { iterations: 0, repairs: 0, improvements: 0, diversifications: 0, size: 0, kind: "", attempts: 0 };
      function emit(force = false) {
        const now = clock();
        if (!force && now - lastReport < 250) return;
        lastReport = now;
        report({ ...warm, method: "deep-optimization", stage, phase, totalLimitMs, elapsedMs: now - started,
          lastImprovementMs: now - lastImprovement, metrics: metrics || partialMetrics, initialMetrics,
          ...(best && (force || changed) ? { path: best.map(model.copy) } : {}),
          ...(!best && partialPath && stage === "construction" ? { path: partialPath.map(model.copy) } : {}),
          relayChange: stage === "lns" || stage === "complete" ? null : warm.relayChange,
          improvements, attempts, lns: { ...stats }, progress: Math.min(100, (now - started) / totalLimitMs * 100), reason });
        changed = false;
      }
      emit(true);
      const warmup = Math.min(options.warmupMs ?? 60000, totalLimitMs * 0.1);
      if (!best || warmup > 0) {
        const result = createBlock(model, createBuilder, clock, random).optimizePath({ ...options, constraints,
          maxDurationMs: Math.max(1, Math.min(warmup, deadline - clock())) }, snapshot => {
          const { path, unitLinks, ...details } = snapshot; warm = details;
          stage = snapshot.stage === "complete" ? "lns" : snapshot.stage; phase = snapshot.phase;
          if (!best && path && stage === "construction" && !model.validateRoute(path, cells, false)) {
            partialPath = path; partialMetrics = snapshot.metrics;
          }
          if (path && !model.validateRoute(path, cells) && model.satisfiesConstraints(path, constraints)) {
            const value = measure(path);
            if (!best || value.score < metrics.score - epsilon) {
              best = path.map(model.copy); metrics = value; initialMetrics ||= snapshot.initialMetrics || value;
              partialPath = null; partialMetrics = null;
              changed = true; lastImprovement = clock();
            }
          }
          improvements = snapshot.improvements || 0; attempts = snapshot.attempts || 0;
          emit();
        });
        if (!best) { best = result.path.map(model.copy); metrics = measure(best); initialMetrics ||= metrics; changed = true; }
      }
      let working = best, state = lns.context(working, constraints, threshold), misses = 0, size = 6;
      const elite = [best], baseImprovements = improvements, baseAttempts = attempts;
      stage = "lns"; phase = "Reconstruction LNS"; emit(true);
      while (clock() < deadline) {
        if (metrics.score <= Math.max(0, best.length - 1) + epsilon) { reason = "lower-bound"; break; }
        if (working.length <= state.locked) { reason = "locked"; break; }
        const diversify = misses >= 8 && stats.iterations % 5 === 0;
        if (diversify) {
          working = elite[stats.diversifications % elite.length];
          state = lns.context(working, constraints, threshold); stats.diversifications++;
        }
        const neighborhood = lns.selectNeighborhood(state, stats.iterations, size);
        stats.iterations++; stats.size = neighborhood.indices.length; stats.kind = neighborhood.kind;
        phase = `LNS : ${neighborhood.kind.toLowerCase()} (${stats.size} diagonales)`; emit();
        if (!stats.size) { reason = "locked"; break; }
        const proposal = lns.repairNeighborhood(working, neighborhood.indices, {
          constraints, cutThreshold: threshold, context: state, deadline: Math.min(deadline, clock() + 3000),
          noise: diversify ? Math.max(0.5, threshold / 3) : 0
        }, partial => { attempts = baseAttempts + stats.attempts + partial.attempts; emit(); });
        stats.attempts += proposal.attempts; attempts = baseAttempts + stats.attempts;
        if (proposal.path) {
          stats.repairs++;
          if (!model.validateRoute(proposal.path, cells) && model.satisfiesConstraints(proposal.path, constraints)) {
            // Reorient the whole route after a promising reconstruction; the fixed prefix remains fixed.
            let candidate = proposal.path, value = proposal.metrics;
            if (value.score < metrics.score - epsilon) {
              const oriented = builder.orientUnitPath(candidate, [], constraints, threshold);
              if (oriented && !model.validateRoute(oriented.path, cells) && model.satisfiesConstraints(oriented.path, constraints)
                  && oriented.score <= value.score + epsilon) { candidate = oriented.path; value = measure(candidate); }
            }
            if (value.score < metrics.score - epsilon) {
              best = candidate; metrics = measure(best); stats.improvements++; improvements = baseImprovements + stats.improvements;
              lastImprovement = clock(); changed = true; misses = 0; size = Math.max(6, size - 2);
              elite.push(best); if (elite.length > 4) elite.shift();
              working = best; state = lns.context(working, constraints, threshold); emit(true); continue;
            }
            const workScore = model.metrics(working, threshold, true).score;
            if (value.score < workScore - epsilon || (diversify && value.score <= metrics.score + Math.max(4, threshold * 2))) {
              working = candidate; state = lns.context(working, constraints, threshold);
            }
          }
        }
        misses++;
        if (misses % 4 === 0) size = Math.min(lns.maximumSize, size + 2);
        emit();
      }
      stage = "complete"; phase = "Optimisation approfondie terminee"; changed = true;
      emit(true);
      return { ...warm, method: "deep-optimization", stage, phase, path: best, metrics, initialMetrics,
        totalLimitMs, elapsedMs: clock() - started, improvements, attempts, lns: { ...stats }, relayChange: null, reason, progress: 100 };
    }
    return { optimizePath };
  }
  function workerMain(createModel, createBuilder, createBlock, createRelay, createLns, createDeep) {
    self.onmessage = event => {
      const options = event.data;
      if (options.type !== "start") return;
      try {
        const result = createDeep(createModel(), createBuilder, createBlock, createRelay, createLns).optimizePath(options,
          snapshot => self.postMessage({ ...snapshot, type: "progress", runId: options.runId }));
        self.postMessage({ ...result, type: "complete", runId: options.runId });
      } catch (error) { self.postMessage({ type: "error", runId: options.runId, message: error.message }); }
    };
  }
  root.createDeepPathOptimizerWorker = () => {
    const source = `(${workerMain.toString()})(${root.createStitchModel.toString()},${root.createOrthogonalPathBuilder.toString()},${root.createBlockOptimizer.toString()},${root.createRelaySearch.toString()},${createLnsSearch.toString()},${createDeepOptimizer.toString()});`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url); URL.revokeObjectURL(url); return worker;
  };
  if (typeof module !== "undefined") module.exports = { createLnsSearch, createDeepOptimizer };
})(typeof window === "undefined" ? globalThis : window);
