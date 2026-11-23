(function (root) {
  "use strict";
  function createAdaptiveOptimizer(model, createBuilder, createRelay, clock = () => performance.now(), random = Math.random, createBlock) {
    const builder = createBuilder(model, clock), relay = createRelay(model, builder, clock), epsilon = 1e-8;
    const names = ["Liaisons couteuses", "Voisinage spatial", "Fragment du parcours", "Dispersion"];
    const lockedCount = constraints => Math.max(constraints.lockedPrefix?.length || 0, Number(Boolean(constraints.start)));
    const otherKey = p => `${model.cellKey(p)}:${p.diagonal === "lower" ? "upper" : "lower"}`;
    const measure = (path, threshold) => model.metrics(path, threshold, true);
    function context(path, threshold, constraints = {}) {
      const locked = lockedCount(constraints), byKey = new Map(path.map((p, i) => [model.key(p), i]));
      return { path, threshold, constraints, locked, byKey,
        score: relay.transfers(path, threshold, i => i < locked),
        links: path.map((p, i) => ({ i, cost: i ? model.cost(path[i - 1], p, threshold, true) : 0 }))
          .filter(item => item.i >= locked).sort((a, b) => b.cost - a.cost) };
    }
    function materialize(state, pieces) {
      const sequence = pieces.flatMap(([a, b]) => state.path.slice(a, b));
      try { return model.orient(sequence, state.threshold, state.constraints, true); } catch { return null; }
    }
    function piecesWithout(length, removed) {
      const pieces = []; let start = 0;
      for (const i of [...removed].sort((a, b) => a - b)) {
        if (start < i) pieces.push([start, i]); start = i + 1;
      }
      if (start < length) pieces.push([start, length]);
      return pieces;
    }
    function rankOf(pieces, index) {
      let offset = 0;
      for (const [a, b] of pieces) {
        if (a <= index && index < b) return offset + index - a;
        offset += b - a;
      }
      return -1;
    }
    function insert(pieces, index, rank) {
      const result = []; let offset = 0, done = false;
      for (const [a, b] of pieces) {
        if (!done && rank <= offset + b - a) {
          const split = a + rank - offset;
          if (a < split) result.push([a, split]);
          result.push([index, index + 1]);
          if (split < b) result.push([split, b]);
          done = true;
        } else result.push([a, b]);
        offset += b - a;
      }
      if (!done) result.push([index, index + 1]);
      return result;
    }
    // Exact subset DP inside a small window. Prefix/suffix orders stay fixed, not their directions.
    function exactRepair(state, start, size, deadline = Infinity, pulse = () => {}) {
      start = Math.max(state.locked, start); size = Math.min(12, size, state.path.length - start);
      if (size < 2) return { path: null, attempts: 0, exact: false };
      const end = start + size, points = state.path.slice(start, end), variants = points.flatMap(p => [1, -1].map(direction => ({ ...p, direction })));
      const prefix = state.score.range(0, start), suffix = state.score.range(end, state.path.length);
      const n = variants.length, masks = 1 << size, dp = new Float64Array(masks * n).fill(Infinity);
      const parents = new Int8Array(masks * n).fill(-1), required = points.map(p => {
        const mate = state.byKey.get(otherKey(p)) - start;
        return p.diagonal === "upper" && mate >= 0 && mate < size ? 1 << mate : 0;
      });
      const incoming = variants.map(p => prefix ? Math.min(...prefix.scores.map((s, i) => s + model.cost(prefix.last[i % 2], p, state.threshold, true))) : 0);
      const outgoing = variants.map(p => suffix ? Math.min(...suffix.scores.map((s, i) => s + model.cost(p, suffix.first[i >> 1], state.threshold, true))) : 0);
      const edges = variants.map(a => variants.map(b => model.cost(a, b, state.threshold, true)));
      for (let i = 0; i < n; i++) if (!required[i >> 1]) dp[(1 << (i >> 1)) * n + i] = incoming[i];
      let attempts = 0;
      for (let mask = 1; mask < masks; mask++) {
        if (!(mask % 16)) { pulse(); if (clock() >= deadline) return { path: null, attempts, exact: false }; }
        for (let last = 0; last < n; last++) {
          const value = dp[mask * n + last]; if (!Number.isFinite(value)) continue;
          for (let next = 0; next < n; next++) {
            const bit = 1 << (next >> 1);
            if ((mask & bit) || (required[next >> 1] & mask) !== required[next >> 1]) continue;
            attempts++;
            const at = (mask | bit) * n + next, cost = value + edges[last][next];
            if (cost < dp[at]) { dp[at] = cost; parents[at] = last; }
          }
        }
      }
      let last = -1, score = Infinity, mask = masks - 1;
      for (let i = 0; i < n; i++) if (dp[mask * n + i] + outgoing[i] < score) { score = dp[mask * n + i] + outgoing[i]; last = i; }
      if (last < 0) return { path: null, attempts, exact: true };
      const order = [];
      while (mask) { order.push(start + (last >> 1)); const before = parents[mask * n + last]; mask ^= 1 << (last >> 1); last = before; }
      order.reverse();
      const pieces = [[0, start], ...order.map(i => [i, i + 1]), [end, state.path.length]].filter(([a, b]) => a < b);
      return { path: materialize(state, pieces), attempts, exact: true, score };
    }
    function select(state, kind, size) {
      const { path, locked } = state, count = path.length - locked;
      size = Math.min(size, count);
      if (!size) return [];
      const expensive = state.links[Math.floor(random() * Math.min(12, state.links.length))]?.i ?? locked;
      const center = kind === 0 ? expensive : locked + Math.floor(random() * count), selected = new Set();
      if (kind === 1) {
        const p = path[center];
        path.map((q, i) => ({ i, d: Math.hypot(p.x - q.x, p.y - q.y) }))
          .filter(q => q.i >= locked).sort((a, b) => a.d - b.d).slice(0, size).forEach(q => selected.add(q.i));
      } else if (kind === 2) {
        const start = Math.max(locked, Math.min(path.length - size, center - Math.floor(size / 2)));
        for (let i = start; i < start + size; i++) selected.add(i);
      } else if (kind === 0) {
        for (const link of state.links.slice(0, size)) {
          for (const i of [link.i, link.i - 1]) if (i >= locked && selected.size < size) selected.add(i);
        }
      }
      while (selected.size < size) selected.add(locked + Math.floor(random() * count));
      return [...selected];
    }
    // Removed diagonals may reappear anywhere, including outside their old neighborhood.
    function freeRepair(state, removed, options = {}) {
      const deadline = options.deadline ?? Infinity, pulse = options.pulse || (() => {});
      const pending = new Set(removed.filter(i => i >= state.locked)), threshold = state.threshold;
      let pieces = piecesWithout(state.path.length, pending), attempts = 0;
      const near = new Map(), rangeCache = new Map();
      const score = candidate => {
        let summary = null;
        for (const [a, b] of candidate) {
          const key = `${a}:${b}`;
          if (!rangeCache.has(key)) rangeCache.set(key, state.score.range(a, b));
          summary = state.score.join(summary, rangeCache.get(key));
        }
        return summary ? Math.min(...summary.scores) : 0;
      };
      while (pending.size) {
        pulse(); if (clock() >= deadline) return { path: null, attempts };
        const length = state.path.length - pending.size;
        const ready = [...pending].filter(i => state.path[i].diagonal === "lower" || !pending.has(state.byKey.get(otherKey(state.path[i]))));
        if (!ready.length) return { path: null, attempts };
        const tasks = options.regret ? ready.slice(0, 6) : [ready[Math.floor(random() * ready.length)]];
        let chosen = null;
        for (const index of tasks) {
          const point = state.path[index], mate = rankOf(pieces, state.byKey.get(otherKey(point)));
          const lo = point.diagonal === "upper" ? Math.max(state.locked, mate + 1) : state.locked;
          const hi = point.diagonal === "lower" && mate >= 0 ? mate : length;
          if (hi < lo) continue;
          if (!near.has(index)) {
            const nearest = [];
            for (let i = 0; i < state.path.length; i++) {
              if (i === index) continue;
              const q = state.path[i], d = (point.x - q.x) ** 2 + (point.y - q.y) ** 2;
              if (nearest.length < 24 || d < nearest.at(-1).d) {
                nearest.push({ i, d }); nearest.sort((a, b) => a.d - b.d); if (nearest.length > 24) nearest.pop();
              }
            }
            near.set(index, nearest.map(q => q.i));
          }
          const ranks = new Set([lo, hi]);
          for (const i of [...near.get(index), index - 1, index + 1]) {
            const rank = rankOf(pieces, i); if (rank >= 0) { ranks.add(rank); ranks.add(rank + 1); }
          }
          for (let i = 0; i < 4; i++) ranks.add(lo + Math.floor(random() * (hi - lo + 1)));
          let best = null, second = Infinity;
          for (const rank of ranks) {
            if (rank < lo || rank > hi) continue;
            if (++attempts % 32 === 0) { pulse(); if (clock() >= deadline) return { path: null, attempts }; }
            const candidate = insert(pieces, index, rank), value = score(candidate);
            if (!best || value < best.value) { second = best?.value ?? Infinity; best = { index, pieces: candidate, value }; }
            else second = Math.min(second, value);
          }
          if (best && Number.isFinite(best.value)) {
            best.regret = Number.isFinite(second) ? second - best.value : 1e6;
            if (!chosen || best.regret > chosen.regret) chosen = best;
          }
        }
        if (!chosen) return { path: null, attempts };
        pieces = chosen.pieces; pending.delete(chosen.index);
      }
      return { path: materialize(state, pieces), attempts, threshold };
    }
    function choose(weights) {
      let value = random() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < weights.length; i++) { value -= weights[i]; if (value <= 0) return i; }
      return weights.length - 1;
    }
    function optimizePath(options, report = () => {}) {
      const cells = options.points, constraints = options.constraints || {}, threshold = options.cutThreshold || 10;
      const started = clock(), stopAfterInactivity = options.stopAfterInactivity === true;
      const stagnationLimitMs = Math.max(1, Number(options.stagnationLimitMs) || 60000);
      const totalLimitMs = stopAfterInactivity ? null : Math.max(1, options.totalLimitMs || 3600000);
      const budgetMs = stopAfterInactivity ? stagnationLimitMs : totalLimitMs;
      let lastImproved = started, deadline = started + budgetMs;
      const lowerBound = Math.max(0, cells.length * 2 - 1), weights = [1, 1, 1, 1], repairs = [1, 1, 1];
      const stats = { iterations: 0, repairs: 0, improvements: 0, diversifications: 0, size: 0, seeds: 0, exactRepairs: 0 };
      let best = null, metrics = null, initialMetrics = null, changed = false, attempts = 0, lastReport = -Infinity;
      let stage = "preparation", phase = "Constructions initiales", reason = stopAfterInactivity ? "inactivity" : "budget", lastGain = 0;
      const valid = path => path && path.length === cells.length * 2
        && !model.validateRoute(path, cells) && model.satisfiesConstraints(path, constraints);
      function emit(force = false) {
        const now = clock(); if (!force && now - lastReport < 250) return;
        lastReport = now;
        report({ method: "adaptive-optimization", stage, phase, elapsedMs: now - started, totalLimitMs,
          metrics, initialMetrics, improvements: stats.improvements, attempts, lns: { ...stats },
          adaptive: { lowerBound, gap: metrics ? Math.max(0, metrics.score - lowerBound) : null, lastGain,
            weights: weights.slice(), repairWeights: repairs.slice() },
          ...(best && changed ? { path: best.map(model.copy) } : {}), ...timing(now), reason });
        changed = false;
      }
      function timing(now) {
        return { stopAfterInactivity, stagnationLimitMs, lastImprovementMs: now - lastImproved,
          remainingMs: Math.max(0, deadline - now),
          progress: stage === "complete" ? 100 : Math.min(100, (now - (stopAfterInactivity ? lastImproved : started)) / budgetMs * 100) };
      }
      function keep(path) {
        if (!valid(path)) return false;
        const value = measure(path, threshold);
        initialMetrics ||= value;
        if (!best || value.score < metrics.score - epsilon) {
          lastGain = best ? metrics.score - value.score : 0;
          if (best) {
            stats.improvements++; lastImproved = clock();
            if (stopAfterInactivity) deadline = lastImproved + stagnationLimitMs;
          }
          best = path.map(model.copy); metrics = value; changed = true; emit(true); return true;
        }
        return false;
      }
      emit(true);
      if (valid(options.initialPath)) {
        keep(options.initialPath);
        try { keep(model.orient(options.initialPath, threshold, constraints, true)); } catch { /* Keep the valid incumbent. */ }
      }
      const prefix = (constraints.lockedPrefix?.length ? constraints.lockedPrefix : constraints.start ? [constraints.start] : []).map(model.copy);
      const prefixKeys = new Set(prefix.map(model.key));
      const seed = sequence => {
        stats.seeds++;
        try { keep(model.orient([...prefix, ...sequence.filter(p => !prefixKeys.has(model.key(p)))], threshold, constraints, true)); }
        catch { /* An imposed prefix may rule out this construction. */ }
      };
      const groups = builder.orthogonalComponents(cells);
      for (let variant = 0; variant < 4; variant++) {
        if (best && (clock() >= deadline || metrics.score <= lowerBound + epsilon)) break;
        const axis = variant % 2 ? "x" : "y", other = axis === "x" ? "y" : "x";
        const ordered = groups.slice().sort((a, b) => a[0][axis] - b[0][axis] || a[0][other] - b[0][other]);
        if (variant >= 2) ordered.reverse();
        seed(ordered.flatMap(group => builder.buildSequence(group, group[variant % group.length])));
        emit();
      }
      if (!best) throw new Error("Aucun parcours initial compatible avec les contraintes.");
      // A bounded run of the established constructor is another seed, never a structural restriction.
      const warmup = Math.min(options.warmupMs ?? Math.min(5000, budgetMs * 0.1), deadline - clock());
      if (createBlock && warmup > 0 && metrics.score > lowerBound + epsilon) {
        phase = "Construction initiale par blocs"; emit(true);
        try {
          const candidate = createBlock(model, createBuilder, clock, random).optimizePath({
            ...options, initialPath: best, constraints, maxDurationMs: warmup
          }, snapshot => {
            if (snapshot.path) keep(snapshot.path);
            emit();
            if (clock() >= deadline) throw new Error("Seed budget completed");
          });
          keep(candidate.path);
        } catch { /* The complete incumbent survives an interrupted seed construction. */ }
        stats.seeds++;
      }
      let working = best, workScore = metrics.score, state = context(working, threshold, constraints), misses = 0;
      const elite = [best];
      stage = "lns";
      while (true) {
        while (clock() < deadline) {
          if (metrics.score <= lowerBound + epsilon) { reason = "lower-bound"; break; }
          if (working.length - state.locked < 2) { reason = "locked"; break; }
          const kind = choose(weights), repair = choose(repairs), size = Math.min(40, 6 + 2 * Math.floor(misses / 3));
          stats.iterations++; stats.size = Math.min(size, working.length - state.locked);
          stats.kind = names[kind]; stats.repair = ["Insertion libre", "Regret-2", "Reparation exacte"][repair];
          phase = `${stats.kind} : ${stats.repair.toLowerCase()}`;
          emit();
          const before = clock(), localDeadline = Math.min(deadline, before + (repair === 2 ? 1000 : 2000));
          const selected = select(state, kind, stats.size);
          let proposal;
          if (repair === 2) {
            const center = selected[Math.floor(random() * selected.length)], exactSize = Math.min(12, stats.size);
            const start = Math.max(state.locked, Math.min(working.length - exactSize, center - Math.floor(exactSize / 2)));
            stats.size = Math.min(exactSize, working.length - start);
            proposal = exactRepair(state, start, stats.size, localDeadline, emit);
            if (proposal.exact) stats.exactRepairs++;
          } else proposal = freeRepair(state, selected, { deadline: localDeadline, regret: repair === 1, pulse: emit });
          attempts += proposal.attempts;
          let reward = 0.2, accepted = false;
          if (valid(proposal.path)) {
            stats.repairs++;
            const value = measure(proposal.path, threshold), gain = workScore - value.score;
            const improved = keep(proposal.path);
            if (improved) { elite.push(best); if (elite.length > 4) elite.shift(); reward = 8 + Math.min(20, lastGain); misses = 0; }
            else { misses++; reward = gain > epsilon ? 3 : 0.4; }
            const elapsed = Math.min(1, (clock() - (stopAfterInactivity ? lastImproved : started)) / budgetMs);
            const temperature = Math.max(0.15, threshold * 0.3 * (1 - elapsed));
            accepted = improved || gain >= -epsilon || random() < Math.exp(gain / temperature);
            if (accepted) {
              if (gain < -epsilon) stats.diversifications++;
              working = proposal.path; workScore = value.score;
            }
          } else misses++;
          const efficiency = reward / Math.max(1, (clock() - before) / 100);
          weights[kind] = Math.max(0.25, weights[kind] * 0.85 + efficiency * 0.15);
          repairs[repair] = Math.max(0.25, repairs[repair] * 0.85 + efficiency * 0.15);
          if (misses > 0 && misses % 20 === 0) {
            working = elite[Math.floor(random() * elite.length)]; workScore = measure(working, threshold).score; accepted = true;
          }
          if (accepted) state = context(working, threshold, constraints);
          emit();
        }
        // Always orient globally at expiry; a strict gain starts another inactivity interval.
        let improved = false;
        try { improved = keep(model.orient(best, threshold, constraints, true)); } catch { /* Never lose a valid best route. */ }
        if (!stopAfterInactivity || !improved) break;
        working = best; workScore = metrics.score; state = context(working, threshold, constraints); misses = 0;
        elite.push(best); if (elite.length > 4) elite.shift();
      }
      stage = "complete"; phase = reason === "lower-bound" ? "Borne minimale atteinte" : "Recherche adaptative terminee"; changed = true;
      emit(true);
      const finished = clock();
      return { method: "adaptive-optimization", stage, phase, path: best, metrics, initialMetrics,
        totalLimitMs, elapsedMs: finished - started, improvements: stats.improvements, attempts, lns: { ...stats },
        adaptive: { lowerBound, gap: Math.max(0, metrics.score - lowerBound), lastGain, weights, repairWeights: repairs }, reason, ...timing(finished) };
    }
    return { optimizePath, context, exactRepair, freeRepair, select, piecesWithout, insert, rankOf };
  }
  function workerMain(createModel, createBuilder, createRelay, createBlock, createAdaptive) {
    self.onmessage = event => {
      const options = event.data; if (options.type !== "start") return;
      try {
        const result = createAdaptive(createModel(), createBuilder, createRelay, undefined, undefined, createBlock).optimizePath(options,
          snapshot => self.postMessage({ ...snapshot, type: "progress", runId: options.runId }));
        self.postMessage({ ...result, type: "complete", runId: options.runId });
      } catch (error) { self.postMessage({ type: "error", runId: options.runId, message: error.message }); }
    };
  }
  root.createAdaptiveOptimizer = createAdaptiveOptimizer;
  root.createAdaptivePathOptimizerWorker = () => {
    const source = `(${workerMain.toString()})(${root.createStitchModel.toString()},${root.createOrthogonalPathBuilder.toString()},${root.createRelaySearch.toString()},${root.createBlockOptimizer.toString()},${createAdaptiveOptimizer.toString()});`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url); URL.revokeObjectURL(url); return worker;
  };
  if (typeof module !== "undefined") module.exports = { createAdaptiveOptimizer };
})(typeof window === "undefined" ? globalThis : window);
