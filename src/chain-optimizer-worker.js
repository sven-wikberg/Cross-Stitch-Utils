(function (root) {
  "use strict";
  function createChainOptimizer(model, createBuilder, createRelay, createSegments, clock = () => performance.now()) {
    const engine = createSegments(model, createBuilder, createRelay, clock), epsilon = 1e-8;
    function context(path, threshold = 10, constraints = {}) {
      const state = engine.context(path, threshold, constraints);
      state.cuts = state.links.filter(link => path[link.at].cutBefore || link.length > threshold).map(link => link.at).sort((a, b) => a - b);
      return state;
    }
    function bounds(state, a, b) {
      let lo = state.locked, hi = state.path.length;
      // Only counterparts outside the moving chain constrain its insertion position.
      for (let i = a; i < b; i++) {
        const mate = state.mate[i];
        if (state.path[i].diagonal === "upper" && mate < a) lo = Math.max(lo, mate + 1);
        if (state.path[i].diagonal === "lower" && mate >= b) hi = Math.min(hi, mate);
      }
      return { lo, hi };
    }
    function pieces(length, a, b, destination) {
      return (destination < a ? [[0, destination], [a, b], [destination, a], [b, length]]
        : [[0, a], [b, destination], [a, b], [destination, length]]).filter(([lo, hi]) => lo < hi);
    }
    function closedRange(state, a, b, maxSize = 4096) {
      let cursor = a;
      while (cursor < b && b - a <= maxSize) {
        const mate = state.mate[cursor++];
        if (mate < a) return null;
        b = Math.max(b, mate + 1);
      }
      return b - a <= maxSize ? [a, b] : null;
    }
    function ranges(state, at) {
      const result = [], seen = new Set(), length = state.path.length;
      function add(a, b) {
        a = Math.max(state.locked, a); b = Math.min(length, b);
        const key = `${a}:${b}`;
        if (a < b && !seen.has(key)) { seen.add(key); result.push([a, b]); }
      }
      const nextCut = state.cuts.find(index => index > at) ?? length;
      if (nextCut - at <= 4096) add(at, nextCut);
      const closed = closedRange(state, at, at + 1); if (closed) add(...closed);
      for (const size of [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]) {
        add(at, at + size); add(at - size, at);
      }
      const left = state.segments[state.owner[at - 1]], right = state.segments[state.owner[at]];
      if (left) add(left.start, left.end); if (right) add(right.start, right.end);
      return result;
    }
    function destinations(state, a, b, deadline = Infinity) {
      const ends = [state.path[a], state.path[b - 1]], near = new Map(), { lo, hi } = bounds(state, a, b);
      let scanned = 0;
      for (const p of ends) {
        const bx = Math.floor(p.x / 8), by = Math.floor(p.y / 8);
        for (let y = by - 2; y <= by + 2; y++) for (let x = bx - 2; x <= bx + 2; x++) {
          for (const i of state.bins.get(`${x},${y}`) || []) {
            if (++scanned % 256 === 0 && clock() >= deadline) return null;
            // Discard impossible neighbors before applying the geometric candidate cap.
            if ((i >= a && i < b) || i + 1 < lo || i > hi) continue;
            const q = state.path[i], distance = Math.hypot(p.x - q.x, p.y - q.y);
            if (distance < (near.get(i) ?? Infinity)) near.set(i, distance);
          }
        }
      }
      const result = new Set([state.locked, state.path.length, lo, hi, ...state.cuts]);
      for (const [i] of [...near].sort((a, b) => a[1] - b[1]).slice(0, 128)) { result.add(i); result.add(i + 1); }
      return [...result].filter(t => t >= lo && t <= hi && (t < a || t > b));
    }
    function optimizePath(options, report = () => {}) {
      const points = options.points || [], threshold = options.cutThreshold || 10;
      const constraints = { ...(options.constraints || {}), forcedCuts: [
        ...(options.constraints?.forcedCuts || []), ...(options.initialPath || []).filter(p => p.cutBefore)
      ] };
      const valid = path => Array.isArray(path) && !model.validateRoute(path, points) && model.satisfiesConstraints(path, constraints);
      if (!valid(options.initialPath)) throw new Error("Le moteur 6 necessite un chemin complet et valide.");
      const started = clock(), totalLimitMs = Math.max(0, options.totalLimitMs ?? 3600000), deadline = started + totalLimitMs;
      let best = options.initialPath.map(model.copy), metrics = model.metrics(best, threshold, true);
      const initialMetrics = metrics, stats = { scans: 0, chains: 0, size: 0, rank: 0, total: 0, tested: 0, destinations: 0, moves: 0 };
      let stage = "preparation", phase = "Preparation des chaines", changed = true, lastReport = -Infinity;
      let attempts = 0, improvements = 0, lastGain = 0, lastImproved = started, lastChainImprovement = null, resumeRank = 0, reason = "time-limit";
      function emit(force = false) {
        const now = clock(); if (!force && now - lastReport < 150) return;
        lastReport = now;
        report({ method: "chain-reinsertion", stage, phase, metrics, initialMetrics, totalLimitMs, elapsedMs: now - started,
          attempts, improvements, restarts: 0, lastGain, lastImprovementMs: now - lastImproved,
          chainSearch: { ...stats }, lastChainImprovement,
          ...(changed ? { path: best.map(model.copy) } : {}), progress: totalLimitMs ? Math.min(100, 100 * (now - started) / totalLimitMs) : 100 });
        changed = false;
      }
      function keep(path, chain = null) {
        if (!valid(path)) return false;
        const next = model.metrics(path, threshold, true);
        if (next.score >= metrics.score - epsilon) return false;
        lastGain = metrics.score - next.score; best = path.map(model.copy); metrics = next;
        improvements++; lastImproved = clock(); changed = true;
        if (chain) { stats.moves++; lastChainImprovement = { ...chain, gain: lastGain }; }
        emit(true); return true;
      }
      emit(true);
      try { keep(model.orient(best, threshold, constraints, true)); } catch { /* Keep the valid incumbent. */ }
      stage = "search";
      while (clock() < deadline) {
        if (metrics.score <= Math.max(0, best.length - 1) + epsilon) { reason = "lower-bound"; break; }
        const state = context(best, threshold, constraints); stats.scans++;
        if (state.locked >= best.length) { reason = "locked"; break; }
        let improved = false, interrupted = false;
        stats.total = state.links.length;
        for (let offset = 0; offset < state.links.length && !interrupted; offset++) {
          if (clock() >= deadline) { interrupted = true; break; }
          const rank = (resumeRank + offset) % state.links.length, link = state.links[rank]; stats.rank = rank + 1;
          for (const [a, b] of ranges(state, link.at)) {
            if (clock() >= deadline) { interrupted = true; break; }
            stats.size = b - a; stats.tested = 0; stats.destinations = 0;
            phase = `Reinsertion : chaine de ${stats.size} diagonales`; emit();
            const targets = destinations(state, a, b, deadline);
            if (!targets) { interrupted = true; break; }
            stats.destinations = targets.length; let winner = null;
            for (const destination of targets) {
              if (clock() >= deadline) { interrupted = true; break; }
              attempts++; stats.tested++;
              const proposal = pieces(best.length, a, b, destination), score = state.score(proposal);
              if (score < (winner?.score ?? metrics.score) - epsilon) winner = { score, pieces: proposal, destination };
              if (stats.tested % 32 === 0) emit();
            }
            // Never commit the provisional best of an interrupted candidate list.
            if (interrupted || clock() >= deadline) { interrupted = true; break; }
            stats.chains++;
            if (winner) {
              const path = engine.materialize(state, winner.pieces);
              if (!valid(path)) throw new Error("Reinsertion incompatible avec les regles de couture.");
              const score = model.metrics(path, threshold, true).score;
              if (Math.abs(score - winner.score) > 1e-6) throw new Error("Score de reinsertion incoherent.");
              improved = keep(path, { size: b - a, rank: rank + 1, total: state.links.length, from: a, to: winner.destination });
              if (improved) { resumeRank = lastGain > 5 ? 0 : Math.max(0, rank - 6); break; }
            }
            emit();
          }
          if (improved) break;
        }
        if (interrupted) break;
        if (!improved) { reason = "exhausted"; break; }
      }
      // The final global orientation pass is independent of the search deadline.
      try { keep(model.orient(best, threshold, constraints, true)); } catch { /* Keep the valid incumbent. */ }
      stage = "complete";
      phase = reason === "lower-bound" ? "Borne minimale atteinte" : reason === "time-limit"
        ? "Budget termine, meilleur parcours conserve" : "Reinsertion des chaines terminee";
      changed = true; emit(true);
      return { method: "chain-reinsertion", stage, phase, path: best, metrics, initialMetrics, totalLimitMs, elapsedMs: clock() - started,
        attempts, improvements, restarts: 0, lastGain, chainSearch: { ...stats }, lastChainImprovement, reason, progress: 100 };
    }
    return { context, bounds, pieces, closedRange, ranges, destinations, optimizePath };
  }
  function workerMain(createModel, createBuilder, createRelay, createSegments, createOptimizer) {
    self.onmessage = event => {
      const options = event.data; if (options.type !== "start") return;
      try {
        const result = createOptimizer(createModel(), createBuilder, createRelay, createSegments).optimizePath(options,
          snapshot => self.postMessage({ ...snapshot, type: "progress", runId: options.runId }));
        self.postMessage({ ...result, type: "complete", runId: options.runId });
      } catch (error) { self.postMessage({ type: "error", runId: options.runId, message: error.message }); }
    };
  }
  root.createChainOptimizerWorker = () => {
    const source = `(${workerMain.toString()})(${root.createStitchModel.toString()},${root.createOrthogonalPathBuilder.toString()},${root.createRelaySearch.toString()},${root.createSegmentOptimizer.toString()},${createChainOptimizer.toString()});`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url); URL.revokeObjectURL(url); return worker;
  };
  if (typeof module !== "undefined") module.exports = { createChainOptimizer };
})(typeof window === "undefined" ? globalThis : window);
