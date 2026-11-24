(function (root) {
  "use strict";
  function createSegmentOptimizer(model, createBuilder, createRelay, clock = () => performance.now(), random = Math.random) {
    const transfers = createRelay(model, createBuilder(model, clock), clock).transfers, epsilon = 1e-8;
    const measure = (path, threshold) => model.metrics(path, threshold, true);
    function context(path, threshold = 10, constraints = {}) {
      const locked = Math.max(constraints.lockedPrefix?.length || 0, Number(Boolean(constraints.start)));
      const segments = [], owner = new Int32Array(path.length).fill(-1), links = [], bins = new Map();
      const byKey = new Map(path.map((p, i) => [model.key(p), i]));
      const mate = Int32Array.from(path, p => byKey.get(`${model.cellKey(p)}:${p.diagonal === "lower" ? "upper" : "lower"}`) ?? -1);
      for (let i = locked; i < path.length; i++) {
        if (i === locked || path[i].cutBefore || Math.abs(model.distance(path[i - 1], path[i]) - 1) > epsilon) {
          segments.push({ start: i, end: i + 1 });
        } else segments.at(-1).end = i + 1;
        owner[i] = segments.length - 1;
        const key = `${Math.floor(path[i].x / 8)},${Math.floor(path[i].y / 8)}`;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(i);
        if (i > 0) {
          const cost = model.cost(path[i - 1], path[i], threshold, true);
          if (cost > 1 + epsilon) links.push({ at: i, cost, length: model.distance(path[i - 1], path[i]) });
        }
      }
      links.sort((a, b) => b.cost - a.cost || a.at - b.at);
      return { path, threshold, constraints, locked, segments, owner, mate, links, bins,
        score: transfers(path, threshold, i => i < locked) };
    }
    function normalizeRanges(ranges, state) {
      const sorted = ranges.map(r => ({ start: Math.max(state.locked, r.start), end: Math.min(state.path.length, r.end) }))
        .filter(r => r.start < r.end).sort((a, b) => a.start - b.start || a.end - b.end), result = [];
      for (const range of sorted) {
        if (result.length && range.start < result.at(-1).end) result.at(-1).end = Math.max(result.at(-1).end, range.end);
        else result.push(range);
      }
      return result;
    }
    function nearby(state, link) {
      const a = model.holes(state.path[link.at - 1]).end, b = model.holes(state.path[link.at]).start;
      const dx = b.x - a.x, dy = b.y - a.y, square = dx * dx + dy * dy;
      const distance = p => {
        const t = square ? Math.max(0, Math.min(1, ((p.x + 0.5 - a.x) * dx + (p.y + 0.5 - a.y) * dy) / square)) : 0;
        return Math.hypot(p.x + 0.5 - a.x - t * dx, p.y + 0.5 - a.y - t * dy);
      };
      const radius = Math.max(3, Math.min(20, link.length / 2)), found = [];
      const minX = Math.floor((Math.min(a.x, b.x) - radius) / 8), maxX = Math.floor((Math.max(a.x, b.x) + radius) / 8);
      const minY = Math.floor((Math.min(a.y, b.y) - radius) / 8), maxY = Math.floor((Math.max(a.y, b.y) + radius) / 8);
      const scan = indices => { for (const i of indices || []) { const d = distance(state.path[i]); if (d <= radius) found.push({ i, d }); } };
      if ((maxX - minX + 1) * (maxY - minY + 1) > state.bins.size) {
        for (const indices of state.bins.values()) scan(indices);
      } else for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) scan(state.bins.get(`${x},${y}`));
      return found.sort((a, b) => a.d - b.d || a.i - b.i).slice(0, 128).map(item => item.i);
    }
    function selectRanges(state, link, kind = 0, round = 0, size = 8) {
      const selected = [], used = new Set(), pool = nearby(state, link), width = [1, 2, 4, 8, 16][round % 5];
      function add(i) {
        if (i < state.locked || i >= state.path.length || selected.length >= size) return;
        const segment = state.segments[state.owner[i]];
        const range = kind === 0 ? segment : {
          start: Math.max(segment.start, i - Math.floor((width - 1) / 2)), end: Math.min(segment.end, i + Math.ceil((width + 1) / 2))
        };
        const key = `${range.start}:${range.end}`;
        if (!used.has(key)) { used.add(key); selected.push(range); }
      }
      add(link.at - 1); add(link.at);
      if (kind === 2) { add(state.mate[link.at - 1]); add(state.mate[link.at]); }
      const offset = pool.length ? (round * 7) % pool.length : 0;
      for (let k = 0; k < pool.length && selected.length < size; k++) {
        const i = pool[(k + offset) % pool.length]; add(i);
        if (kind === 2) add(state.mate[i]);
      }
      // Include another costly junction when the spatial neighborhood contains too few independent pieces.
      for (let k = 0; k < state.links.length && selected.length < size; k++) {
        const other = state.links[(k + round) % state.links.length]; add(other.at - 1); add(other.at);
      }
      return normalizeRanges(selected, state);
    }
    function piecesFor(ranges, order, length) {
      const pieces = [[0, ranges[0].start]];
      order.forEach((id, slot) => {
        pieces.push([ranges[id].start, ranges[id].end], [ranges[slot].end, ranges[slot + 1]?.start ?? length]);
      });
      return pieces.filter(([a, b]) => a < b);
    }
    function materialize(state, pieces) {
      const sequence = [];
      for (const [a, b] of pieces) for (let i = a; i < b; i++) sequence.push(state.path[i]);
      try { return model.orient(sequence, state.threshold, state.constraints, true); } catch { return null; }
    }
    function repair(state, inputRanges, options = {}) {
      const ranges = normalizeRanges(inputRanges, state), n = ranges.length, deadline = options.deadline ?? Infinity;
      const failed = { pieces: null, score: Infinity, attempts: 0, exact: false };
      if (n < 2 || n > 10 || clock() >= deadline) return failed;
      const owner = new Int16Array(state.path.length).fill(-1), need = new Int32Array(n);
      const low = new Int16Array(n), high = new Int16Array(n).fill(n - 1);
      ranges.forEach((r, id) => { for (let i = r.start; i < r.end; i++) owner[i] = id; });
      // Dependencies may span distant segments or an untouched gap. Both must remain ordered.
      for (let id = 0; id < n; id++) for (let i = ranges[id].start; i < ranges[id].end; i++) {
        const mate = state.mate[i], other = owner[mate], upper = state.path[i].diagonal === "upper";
        if (mate < 0) return failed;
        if (other >= 0) { if (upper && other !== id) need[id] |= 1 << other; }
        else {
          let gap = 0; while (gap < n && ranges[gap].end <= mate) gap++;
          if (upper) low[id] = Math.max(low[id], gap);
          else high[id] = Math.min(high[id], gap - 1);
        }
      }
      const prefix = state.score.range(0, ranges[0].start);
      const summaries = ranges.map(r => state.score.range(r.start, r.end));
      const blocks = ranges.map((r, slot) => {
        const gap = state.score.range(r.end, ranges[slot + 1]?.start ?? state.path.length);
        return summaries.map(summary => state.score.join(summary, gap));
      });
      const masks = 1 << n, stride = n * 2, count = new Uint8Array(masks);
      const costs = new Float64Array(masks * stride).fill(Infinity), parents = new Int32Array(costs.length).fill(-1);
      const noise = options.noise || 0, edges = [];
      for (let slot = 1; slot < n; slot++) {
        edges[slot] = new Float64Array(n * n * 4);
        for (let from = 0; from < n; from++) for (let to = 0; to < n; to++) {
          const perturbation = noise * (random() - 0.5);
          for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
            edges[slot][(from * n + to) * 4 + a * 2 + b] =
              model.cost(blocks[slot - 1][from].last[a], blocks[slot][to].first[b], state.threshold, true) + perturbation;
          }
        }
      }
      for (let id = 0; id < n; id++) {
        if (need[id] || low[id] > 0 || high[id] < 0) continue;
        const first = state.score.join(prefix, blocks[0][id]);
        costs[(1 << id) * stride + id * 2] = Math.min(first.scores[0], first.scores[2]);
        costs[(1 << id) * stride + id * 2 + 1] = Math.min(first.scores[1], first.scores[3]);
      }
      let attempts = 0;
      for (let mask = 1; mask < masks; mask++) {
        const slot = count[mask] = count[mask >> 1] + (mask & 1);
        if (mask % 16 === 0) { options.pulse?.(); if (clock() >= deadline) return { ...failed, attempts }; }
        if (slot === n) continue;
        for (let to = 0; to < n; to++) {
          if ((mask & (1 << to)) || (mask & need[to]) !== need[to] || slot < low[to] || slot > high[to]) continue;
          const block = blocks[slot][to], destination = (mask | (1 << to)) * stride + to * 2;
          for (let from = 0; from < n; from++) if (mask & (1 << from)) {
            const base = mask * stride + from * 2, edge = (from * n + to) * 4;
            for (let end = 0; end < 2; end++) {
              const value0 = costs[base] + Math.min(edges[slot][edge] + block.scores[end], edges[slot][edge + 1] + block.scores[2 + end]);
              const value1 = costs[base + 1] + Math.min(edges[slot][edge + 2] + block.scores[end], edges[slot][edge + 3] + block.scores[2 + end]);
              const value = Math.min(value0, value1); attempts++;
              if (value < costs[destination + end]) {
                costs[destination + end] = value; parents[destination + end] = base + Number(value1 < value0);
              }
            }
          }
        }
      }
      if (clock() >= deadline) return { ...failed, attempts };
      let cursor = -1, best = Infinity;
      for (let i = (masks - 1) * stride; i < costs.length; i++) if (costs[i] < best) { cursor = i; best = costs[i]; }
      if (cursor < 0) return { ...failed, attempts };
      const order = [];
      while (cursor >= 0) { order.push(Math.floor((cursor % stride) / 2)); cursor = parents[cursor]; }
      order.reverse();
      const pieces = piecesFor(ranges, order, state.path.length);
      return { pieces, order, ranges, score: state.score(pieces), attempts, exact: noise === 0 };
    }
    function optimizePath(options, report = () => {}) {
      const points = options.points || [], threshold = options.cutThreshold || 10;
      const constraints = { ...(options.constraints || {}), forcedCuts: [
        ...(options.constraints?.forcedCuts || []), ...(options.initialPath || []).filter(p => p.cutBefore)
      ] };
      const valid = path => Array.isArray(path) && !model.validateRoute(path, points) && model.satisfiesConstraints(path, constraints);
      if (!valid(options.initialPath)) throw new Error("Le moteur 5 necessite un chemin complet et valide.");
      const started = clock(), stopAfterInactivity = options.stopAfterInactivity === true;
      const stagnationLimitMs = Math.max(1, Number(options.stagnationLimitMs) || 60000);
      const totalLimitMs = stopAfterInactivity ? null : Math.max(0, options.totalLimitMs ?? 3600000);
      const budgetMs = stopAfterInactivity ? stagnationLimitMs : totalLimitMs;
      let deadline = stopAfterInactivity ? Infinity : started + budgetMs, preparing = stopAfterInactivity, searchStarted = null;
      let best = options.initialPath.map(model.copy), metrics = measure(best, threshold), initialMetrics = metrics;
      let stage = "preparation", phase = "Preparation des segments", changed = true, lastReport = -Infinity, lastGain = 0, lastImproved = started;
      const stats = { repairs: 0, segments: 0, diagonals: 0, totalSegments: 0, rank: 0, total: 0, passes: 0, improvements: 0, diversifications: 0 };
      let attempts = 0, reason = stopAfterInactivity ? "inactivity" : "time-limit";
      function emit(force = false) {
        const now = clock(); if (!force && now - lastReport < 150) return;
        lastReport = now;
        report({ method: "segment-optimization", stage, phase, metrics, initialMetrics, totalLimitMs, elapsedMs: now - started,
          lastGain, attempts, improvements: stats.improvements, restarts: stats.diversifications,
          segmentSearch: { ...stats }, ...timing(now), reason,
          ...(changed ? { path: best.map(model.copy) } : {}) }); changed = false;
      }
      function timing(now) {
        return { stopAfterInactivity, preparing, preparationMs: (searchStarted ?? now) - started,
          stagnationLimitMs, lastImprovementMs: preparing ? 0 : now - lastImproved,
          remainingMs: preparing ? stagnationLimitMs : Math.max(0, deadline - now),
          progress: stage === "complete" || !budgetMs ? 100 : preparing ? 0 : Math.min(100, (now - (stopAfterInactivity ? lastImproved : started)) / budgetMs * 100) };
      }
      function keep(path) {
        if (!valid(path)) return false;
        const next = measure(path, threshold);
        if (next.score >= metrics.score - epsilon) return false;
        lastGain = metrics.score - next.score; best = path.map(model.copy); metrics = next;
        stats.improvements++; lastImproved = clock();
        if (stopAfterInactivity && !preparing) deadline = lastImproved + stagnationLimitMs;
        changed = true; emit(true); return true;
      }
      emit(true);
      try { keep(model.orient(best, threshold, constraints, true)); } catch { /* Preserve the valid incumbent. */ }
      let working = best, workScore = metrics.score, state = context(working, threshold, constraints), misses = 0, rank = 0, round = 0;
      stats.totalSegments = state.segments.length;
      const weights = [1, 1, 1], names = ["Segments entiers", "Portions de segments", "Segments et diagonales liees"];
      searchStarted = clock(); preparing = false;
      if (stopAfterInactivity) { lastImproved = searchStarted; deadline = searchStarted + stagnationLimitMs; }
      stage = "search"; phase = "Recherche des raccordements"; emit(true);
      while (true) {
        while (clock() < deadline) {
          if (metrics.score <= Math.max(0, best.length - 1) + epsilon) { reason = "lower-bound"; break; }
          if (!state) { state = context(working, threshold, constraints); stats.totalSegments = state.segments.length; }
          if (!state.links.length || working.length - state.locked < 2) { reason = "locked"; break; }
          if (rank >= state.links.length) { rank = 0; round++; }
          const link = state.links[rank++]; stats.rank = rank; stats.total = state.links.length; stats.passes = round + 1;
          const choice = random() * weights.reduce((a, b) => a + b, 0);
          let kind = 0, weight = weights[0]; while (kind < 2 && choice >= weight) weight += weights[++kind];
          const ranges = selectRanges(state, link, kind, round + Math.floor(misses / 20), 6 + 2 * (Math.floor(misses / 12) % 3));
          stats.segments = ranges.length; stats.diagonals = ranges.reduce((sum, r) => sum + r.end - r.start, 0);
          phase = `${names[kind]} : raccordement ${rank} / ${state.links.length}`; emit();
          const before = clock(), noisy = misses >= 8 && stats.repairs % 5 === 4;
          const proposal = repair(state, ranges, { deadline: Math.min(deadline, before + 1500), pulse: emit, noise: noisy ? 1.5 : 0 });
          attempts += proposal.attempts; stats.repairs++;
          let reward = 0.2, accepted = false;
          if (proposal.pieces && (proposal.score < workScore - epsilon || (noisy && proposal.score < workScore + 3))) {
            const path = materialize(state, proposal.pieces);
            if (valid(path)) {
              const value = measure(path, threshold), gain = workScore - value.score, improved = keep(path);
              const temperature = Math.max(0.1, 1 - (clock() - (stopAfterInactivity ? lastImproved : started)) / Math.max(1, budgetMs));
              accepted = improved || gain > epsilon || (noisy && gain < -epsilon && random() < Math.exp(gain / temperature));
              if (accepted) {
                if (gain < -epsilon) stats.diversifications++;
                working = path; workScore = value.score; state = null;
              }
              if (improved) { reward = 8 + Math.min(20, lastGain); misses = 0; rank = 0; }
              else misses++;
            } else misses++;
          } else misses++;
          weights[kind] = Math.max(0.3, 0.9 * weights[kind] + 0.1 * reward / Math.max(1, (clock() - before) / 100));
          if (misses > 0 && misses % 40 === 0 && working !== best) { working = best; workScore = metrics.score; state = null; }
          emit();
        }
        // Always orient globally at expiry; a strict gain starts another inactivity interval.
        let improved = false;
        try { improved = keep(model.orient(best, threshold, constraints, true)); } catch { /* Preserve the valid incumbent. */ }
        if (!stopAfterInactivity || !improved) break;
        working = best; workScore = metrics.score; state = null; misses = 0; rank = 0;
      }
      stage = "complete"; phase = reason === "lower-bound" ? "Borne minimale atteinte" : "Optimisation des raccordements terminee"; changed = true; emit(true);
      const finished = clock();
      return { method: "segment-optimization", stage, phase, path: best, metrics, initialMetrics, totalLimitMs, elapsedMs: finished - started,
        lastGain, attempts, improvements: stats.improvements, restarts: stats.diversifications, segmentSearch: { ...stats }, reason, ...timing(finished) };
    }
    return { context, selectRanges, normalizeRanges, repair, piecesFor, materialize, optimizePath };
  }
  function workerMain(createModel, createBuilder, createRelay, createOptimizer) {
    self.onmessage = event => {
      const options = event.data; if (options.type !== "start") return;
      try {
        const result = createOptimizer(createModel(), createBuilder, createRelay).optimizePath(options,
          snapshot => self.postMessage({ ...snapshot, type: "progress", runId: options.runId }));
        self.postMessage({ ...result, type: "complete", runId: options.runId });
      } catch (error) { self.postMessage({ type: "error", runId: options.runId, message: error.message }); }
    };
  }
  root.createSegmentOptimizer = createSegmentOptimizer;
  root.createSegmentOptimizerWorker = () => {
    const source = `(${workerMain.toString()})(${root.createStitchModel.toString()},${root.createOrthogonalPathBuilder.toString()},${root.createRelaySearch.toString()},${createSegmentOptimizer.toString()});`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url); URL.revokeObjectURL(url); return worker;
  };
  if (typeof module !== "undefined") module.exports = { createSegmentOptimizer };
})(typeof window === "undefined" ? globalThis : window);
