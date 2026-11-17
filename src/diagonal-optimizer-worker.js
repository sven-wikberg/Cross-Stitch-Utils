(function (root) {
  "use strict";
  function createDiagonalOptimizer(model) {
    // Each summary keeps the best cost for all four endpoint-direction pairs.
    // A range tree reuses unchanged pieces when testing a new order.
    function createOrderEvaluator(chunks, threshold, constraints, zones) {
      const fixed = new Map((constraints.lockedPrefix || []).map(p => [model.key(p), p.direction]));
      if (constraints.start) fixed.set(model.key(constraints.start), constraints.start.direction);
      const cuts = new Set((constraints.forcedCuts || []).map(model.key));
      function join(a, b) {
        if (!a) return b;
        if (!b) return a;
        const c00 = model.cost(a.last[0], b.first[0], threshold, true);
        const c01 = model.cost(a.last[0], b.first[1], threshold, true);
        const c10 = model.cost(a.last[1], b.first[0], threshold, true);
        const c11 = model.cost(a.last[1], b.first[1], threshold, true);
        const t00 = Math.min(a.m[0] + c00, a.m[1] + c10);
        const t01 = Math.min(a.m[0] + c01, a.m[1] + c11);
        const t10 = Math.min(a.m[2] + c00, a.m[3] + c10);
        const t11 = Math.min(a.m[2] + c01, a.m[3] + c11);
        return { first: a.first, last: b.last,
          m: [Math.min(t00 + b.m[0], t01 + b.m[2]), Math.min(t00 + b.m[1], t01 + b.m[3]),
            Math.min(t10 + b.m[0], t11 + b.m[2]), Math.min(t10 + b.m[1], t11 + b.m[3])],
          firstZone: a.firstZone, lastZone: b.lastZone,
          visits: a.visits + b.visits - (a.lastZone === b.firstZone ? 1 : 0) };
      }
      function summarize(points) {
        let summary = null;
        for (const p of points) {
          const id = model.key(p), direction = fixed.get(id);
          const variants = [1, -1].map(d => ({ ...model.copy(p), direction: d,
            ...(cuts.has(id) ? { cutBefore: true } : {}) }));
          const zone = zones.byCell.get(model.cellKey(p));
          summary = join(summary, { first: variants, last: variants,
            m: [direction === -1 ? Infinity : 0, Infinity, Infinity, direction === 1 ? Infinity : 0],
            firstZone: zone, lastZone: zone, visits: 1 });
        }
        return summary;
      }
      const leaves = chunks.map(summarize), count = leaves.length;
      let size = 1;
      while (size < count) size *= 2;
      const tree = new Array(size * 2).fill(null);
      for (let i = 0; i < count; i++) tree[size + i] = leaves[i];
      for (let i = size - 1; i > 0; i--) tree[i] = join(tree[i * 2], tree[i * 2 + 1]);
      function range(start, end) {
        let left = null, right = null;
        for (start += size, end += size; start < end; start >>= 1, end >>= 1) {
          if (start & 1) left = join(left, tree[start++]);
          if (end & 1) right = join(tree[--end], right);
        }
        return join(left, right);
      }
      const measure = summary => ({ score: summary ? Math.min(...summary.m) : 0, zoneVisits: summary?.visits || 0 });
      function evaluateMove(i, j) {
        if (i === j || i === j + 1) return measure(tree[1]);
        const ranges = j < i ? [[0, j + 1], [i, i + 1], [j + 1, i], [i + 1, count]]
          : [[0, i], [i + 1, j + 1], [i, i + 1], [j + 1, count]];
        return measure(ranges.reduce((summary, [start, end]) => join(summary, range(start, end)), null));
      }
      function move(i, j) {
        const [leaf] = leaves.splice(i, 1);
        leaves.splice(j >= i ? j : j + 1, 0, leaf);
        refresh(Math.min(i, j + 1), Math.max(i, j) + 1);
      }
      function refresh(start, end) {
        start += size; end += size;
        for (let k = start; k < end; k++) tree[k] = leaves[k - size];
        while (start > 1) {
          start >>= 1; end = (end + 1) >> 1;
          for (let k = start; k < end; k++) tree[k] = join(tree[k * 2], tree[k * 2 + 1]);
        }
      }
      function replace(start, chunks) {
        chunks.forEach((chunk, i) => { leaves[start + i] = summarize(chunk); });
        refresh(start, start + chunks.length);
      }
      return { current: () => measure(tree[1]), evaluateMove, move, replace };
    }
    const improvesOrder = (candidate, current) => Number.isFinite(candidate.score)
      && (candidate.zoneVisits - current.zoneVisits || candidate.score - current.score) < -1e-8;
    function optimizePath(options, report = () => {}) {
      const cells = options.points || [], threshold = options.cutThreshold || 10;
      const originalConstraints = options.constraints || {};
      const forcedCuts = new Map([...(originalConstraints.forcedCuts || []),
        ...(options.initialPath || []).filter(p => p.cutBefore)].map(p => [model.key(p), model.copy(p)]));
      const constraints = { ...originalConstraints, forcedCuts: [...forcedCuts.values()] }, prefix = constraints.lockedPrefix?.length
        ? constraints.lockedPrefix.map(model.copy) : constraints.start ? [model.copy(constraints.start)] : [];
      const cuts = new Set((constraints.forcedCuts || []).map(model.key));
      const fixedLength = prefix.length;
      const zones = model.createZones(cells);
      const stepCost = (a, b) => model.cost(a, b, threshold, true);
      const orient = sequence => model.orient(sequence, threshold, constraints, true);
      const started = performance.now(), limit = Math.max(1, options.stagnationLimitMs || 60000);
      let lastImprovement = started, lastReport = 0, improvements = 0, restarts = 0, best, bestMetrics, initialMetrics;
      let changed = false, phase = "Construction des diagonales";
      let stage = "preparation", activeZone = null, completedZones = 0, zoneCount = 0;
      const expired = () => performance.now() - lastImprovement >= limit;
      function zoneScore(job) {
        let score = 0;
        for (const { start, end } of job.ranges) {
          for (let i = Math.max(1, start); i <= Math.min(end, best.length - 1); i++) score += stepCost(best[i - 1], best[i]);
        }
        return score;
      }
      function zoneSnapshot(now) {
        return { total: zoneCount, completed: completedZones, ...(activeZone ? {
          id: activeZone.id, index: activeZone.index, bounds: activeZone.bounds,
          initialScore: activeZone.initialScore, score: zoneScore(activeZone),
          elapsedMs: now - activeZone.started, lastImprovementMs: now - lastImprovement,
          status: activeZone.status
        } : { status: stage }) };
      }
      const progress = () => stage === "complete" ? 100 : stage === "orient" ? 99
        : stage === "links" ? 95 : zoneCount ? completedZones / zoneCount * 95 : 0;
      function emit(force = false, includePath = false) {
        const now = performance.now();
        if (!force && now - lastReport < 200) return;
        lastReport = now;
        report({ phase, stage, zone: zoneSnapshot(now), ...(changed || includePath ? { path: best.map(model.copy) } : {}), metrics: bestMetrics,
          initialMetrics, elapsedMs: now - started, lastImprovementMs: now - lastImprovement,
          stagnationLimitMs: limit, progress: progress(), improvements, restarts });
        changed = false;
      }
      function consider(path) {
        if (model.validateRoute(path, cells) || !model.satisfiesConstraints(path, constraints)) return false;
        const metrics = zones.measure(path, threshold);
        if (!best || model.compareZoneMetrics(metrics, bestMetrics) < -1e-8) {
          if (best) improvements++;
          best = path.map(model.copy); bestMetrics = metrics; initialMetrics ||= metrics;
          changed = true;
          if (stage !== "zones") lastImprovement = performance.now();
          emit(); return true;
        }
        return false;
      }
      const prefixIds = new Set(prefix.map(model.key));
      function makeSeed(order) {
        const sequence = [...prefix, ...order.flatMap(cell => ["lower", "upper"].map(diagonal => ({
          x: cell.x, y: cell.y, diagonal, direction: 1
        }))).filter(p => !prefixIds.has(model.key(p)))];
        return orient(sequence);
      }
      if (options.initialPath?.length) consider(options.initialPath);
      if (!best) consider(makeSeed(cells));
      if (!best) throw new Error("Impossible de construire un chemin respectant les contraintes.");
      emit(true, true);
      if (!cells.length) return { path: [], metrics: bestMetrics, initialMetrics };
      consider(orient(best));

      const cellIndex = new Map(cells.map((p, i) => [model.cellKey(p), i]));
      const indexedZones = zones.zones.map(zone => ({ ...zone, indices: zone.cells.map(p => cellIndex.get(model.cellKey(p))) }));
      function greedy() {
        const state = new Uint8Array(cells.length), route = prefix.map(model.copy);
        for (const p of prefix) state[cellIndex.get(model.cellKey(p))] = p.diagonal === "lower" ? 1 : 2;
        const pendingZones = new Set(indexedZones.filter(zone => zone.indices.some(i => state[i] !== 2)).map(zone => zone.id));
        let previous = route.at(-1), currentZone = previous ? zones.byCell.get(model.cellKey(previous)) : null;
        function candidateAt(i, geometric = false) {
          if (state[i] === 2) return null;
          const cell = cells[i], diagonal = state[i] ? "upper" : "lower";
          let chosen = null;
          for (const direction of [1, -1]) {
            const point = { x: cell.x, y: cell.y, diagonal, direction };
            if (cuts.has(model.key(point))) point.cutBefore = true;
            const distance = previous ? model.distance(previous, point) : 0;
            if (previous && distance === 0) continue;
            const value = geometric ? distance : stepCost(previous, point);
            if (!chosen || value < chosen.value) chosen = { point, i, value };
          }
          return chosen;
        }
        function nearestZone() {
          const end = previous ? model.holes(previous).end : null;
          let chosen = null;
          for (const id of pendingZones) {
            const zone = indexedZones[id];
            if (end && chosen) {
              const dx = Math.max(zone.minX - end.x, 0, end.x - zone.maxX);
              const dy = Math.max(zone.minY - end.y, 0, end.y - zone.maxY);
              if (dx * dx + dy * dy > chosen.value * chosen.value) continue;
            }
            for (const i of zone.indices) {
              const candidate = candidateAt(i, true);
              if (candidate && (!chosen || candidate.value < chosen.value)) chosen = { ...candidate, zoneId: id };
            }
          }
          return chosen;
        }
        function append(candidate) {
          route.push(candidate.point); state[candidate.i]++; previous = candidate.point;
        }
        if (!previous && cells.length) {
          const start = best[0] || cells[0];
          const i = cellIndex.get(model.cellKey(start));
          append(candidateAt(i)); currentZone = zones.byCell.get(model.cellKey(start));
        }
        while (pendingZones.size) {
          if (!pendingZones.has(currentZone)) {
            // The next zone is chosen by real hole distance, even when the thread is cut.
            const next = nearestZone();
            if (!next) throw new Error("Aucune zone accessible.");
            currentZone = next.zoneId; append(next);
          }
          const zone = indexedZones[currentZone];
          while (zone.indices.some(i => state[i] !== 2)) {
            let selected = null;
            for (const i of zone.indices) {
              const candidate = candidateAt(i);
              if (candidate && (!selected || candidate.value < selected.value)) selected = candidate;
            }
            if (!selected) throw new Error("Aucune transition de fil valide.");
            append(selected);
            if (route.length % 128 === 0) emit();
          }
          pendingZones.delete(currentZone);
          phase = `Preparation des zones : ${indexedZones.length - pendingZones.size} / ${indexedZones.length}`;
          emit();
        }
        return orient(route);
      }
      phase = "Regroupement des zones voisines";
      consider(greedy());
      emit(true);

      const zoneBins = new Map(), zoneNeighbors = new Map();
      for (const zone of indexedZones) {
        zone.center = { x: (zone.minX + zone.maxX) / 2, y: (zone.minY + zone.maxY) / 2 };
        const bin = `${Math.floor(zone.center.x / 10)},${Math.floor(zone.center.y / 10)}`;
        if (!zoneBins.has(bin)) zoneBins.set(bin, []);
        zoneBins.get(bin).push(zone.id);
      }
      function neighboringZoneIds(id) {
        if (zoneNeighbors.has(id)) return zoneNeighbors.get(id);
        const center = indexedZones[id].center, bx = Math.floor(center.x / 10), by = Math.floor(center.y / 10);
        const candidates = new Set();
        let stopAt = 7;
        for (let radius = 0; radius <= stopAt; radius++) {
          for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
            if (radius && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
            for (const other of zoneBins.get(`${bx + dx},${by + dy}`) || []) if (other !== id) candidates.add(other);
          }
          if (candidates.size >= 24) stopAt = Math.min(stopAt, radius + 1);
        }
        if (!candidates.size) for (const zone of indexedZones) if (zone.id !== id) candidates.add(zone.id);
        const distance = other => Math.hypot(indexedZones[other].center.x - center.x, indexedZones[other].center.y - center.y);
        const nearest = [...candidates].sort((a, b) => distance(a) - distance(b)).slice(0, 24);
        zoneNeighbors.set(id, nearest);
        return nearest;
      }
      function improveZoneOrder(input) {
        const blocks = [];
        input.forEach((point, index) => {
          const id = zones.byCell.get(model.cellKey(point));
          if (blocks.at(-1)?.id !== id) blocks.push({ id, points: [], locked: false });
          blocks.at(-1).points.push(point);
          if (index < fixedLength) blocks.at(-1).locked = true;
        });
        if (blocks.length < 3) return;
        const fixedBlocks = blocks.findLastIndex(block => block.locked) + 1;
        const positions = new Map();
        const updatePositions = () => blocks.forEach((block, index) => positions.set(block.id, index));
        updatePositions();
        const evaluator = createOrderEvaluator(blocks.map(block => block.points), threshold, constraints, zones);
        let current = evaluator.current();
        let accepted = 0;
        phase = "Optimisation des liaisons entre zones";
        for (let attempt = 0; attempt < Math.max(2000, blocks.length * 50) && !expired(); attempt++) {
          const i = fixedBlocks + Math.floor(Math.random() * (blocks.length - fixedBlocks));
          if (i >= blocks.length) break;
          const block = blocks[i], neighbors = neighboringZoneIds(block.id);
          if (!neighbors.length) break;
          let j = positions.get(neighbors[Math.floor(Math.random() * neighbors.length)]);
          if (Math.random() < 0.5) j--;
          if (attempt % 64 === 0) j = fixedBlocks - 1;
          if (j < fixedBlocks - 1 || j === i || j === i - 1) continue;
          const candidate = evaluator.evaluateMove(i, j);
          if (improvesOrder(candidate, current)) {
            evaluator.move(i, j); current = evaluator.current();
            blocks.splice(i, 1); blocks.splice(j >= i ? j : j + 1, 0, block);
            updatePositions(); accepted++;
            if (accepted % 20 === 0 || performance.now() - lastReport > 200) consider(orient(blocks.flatMap(b => b.points)));
          }
          if (attempt % 128 === 0) emit();
        }
        const route = blocks.flatMap(block => block.points);
        consider(orient(route));
      }

      function improveZones() {
        const route = best.map(model.copy), jobsById = new Map();
        for (let start = 0; start < route.length;) {
          const id = zones.byCell.get(model.cellKey(route[start]));
          let end = start + 1;
          while (end < route.length && zones.byCell.get(model.cellKey(route[end])) === id) end++;
          if (!jobsById.has(id)) jobsById.set(id, { id, ranges: [], freeRanges: [] });
          const job = jobsById.get(id);
          job.ranges.push({ start, end });
          if (end > fixedLength) job.freeRanges.push({ start: Math.max(start, fixedLength), end });
          start = end;
        }
        const jobs = [...jobsById.values()].filter(job => job.freeRanges.length);
        zoneCount = jobs.length;
        const positions = new Map();
        const updatePositions = (start = 0, end = route.length) => {
          for (let i = start; i < end; i++) positions.set(model.key(route[i]), i);
        };
        updatePositions();
        // Keep the whole-route context so both neighboring links influence each local move.
        const evaluator = createOrderEvaluator(route.map(point => [point]), threshold, constraints, zones);
        let current = evaluator.current();
        let bestOrder = current;
        function publish() {
          if (improvesOrder(current, bestOrder)) {
            if (consider(orient(route))) bestOrder = current;
          }
        }
        function replace(range, points) {
          route.splice(range.start, points.length, ...points);
          evaluator.replace(range.start, points.map(point => [point]));
          updatePositions(range.start, range.end); current = evaluator.current();
        }
        function restore(job) {
          for (const range of job.freeRanges) replace(range, best.slice(range.start, range.end));
        }
        function restart(range) {
          const pending = route.slice(range.start, range.end), ids = new Set(pending.map(model.key));
          const done = new Set(), sequence = [];
          let previous = route[range.start - 1];
          while (pending.length) {
            const candidates = [];
            for (let i = 0; i < pending.length; i++) {
              const point = pending[i], lower = `${model.cellKey(point)}:lower`;
              if (point.diagonal === "upper" && ids.has(lower) && !done.has(lower)) continue;
              for (const direction of [1, -1]) {
                const oriented = { ...point, direction }, value = stepCost(previous, oriented);
                if (Number.isFinite(value)) candidates.push({ i, point: oriented,
                  value: value + Math.random() * (restarts % 3 ? 0.3 : threshold * 0.5) });
              }
            }
            candidates.sort((a, b) => a.value - b.value);
            const chosen = candidates[0];
            if (!chosen) return;
            sequence.push(chosen.point); done.add(model.key(chosen.point));
            pending.splice(chosen.i, 1); previous = chosen.point;
          }
          replace(range, sequence);
        }
        stage = "zones";
        for (let index = 0; index < jobs.length; index++) {
          const job = jobs[index], zone = indexedZones[job.id];
          activeZone = { ...job, index: index + 1, started: performance.now(), status: "running",
            bounds: { minX: zone.minX, minY: zone.minY, maxX: zone.maxX, maxY: zone.maxY } };
          activeZone.initialScore = zoneScore(job);
          lastImprovement = activeZone.started;
          let zoneBestScore = bestOrder.score, attempts = 0, accepted = 0;
          phase = `Optimisation de la zone ${index + 1} / ${jobs.length}`;
          emit(true);
          while (!expired()) {
            const range = job.freeRanges[attempts % job.freeRanges.length], length = range.end - range.start;
            if (++attempts % Math.max(200, length * 20) === 0) {
              publish(); restore(job); restarts++; restart(range);
            }
            const i = range.start + Math.floor(Math.random() * length);
            const j = range.start - 1 + Math.floor(Math.random() * (length + 1));
            const p = route[i], mate = positions.get(`${model.cellKey(p)}:${p.diagonal === "lower" ? "upper" : "lower"}`);
            if (j !== i && j !== i - 1 && (p.diagonal === "lower" ? j < mate : j >= mate)) {
              const candidate = evaluator.evaluateMove(i, j);
              if (improvesOrder(candidate, current)) {
                evaluator.move(i, j); current = evaluator.current();
                route.splice(i, 1); route.splice(j >= i ? j : j + 1, 0, p);
                updatePositions(Math.min(i, j + 1), Math.max(i, j) + 1); accepted++;
              }
            }
            if (current.score < zoneBestScore - 1e-8) {
              zoneBestScore = current.score; lastImprovement = performance.now();
            }
            if (accepted >= 20 || performance.now() - lastReport >= 200) { publish(); accepted = 0; emit(); }
          }
          publish(); restore(job);
          completedZones++; activeZone.status = "complete"; emit(true);
        }
        activeZone = null;
      }
      improveZones();
      stage = "links"; lastImprovement = performance.now();
      phase = "Optimisation des liaisons entre zones"; emit(true);
      improveZoneOrder(best);
      stage = "orient"; phase = "Derniere optimisation des sens"; emit(true);
      consider(orient(best));
      stage = "complete"; phase = "Recherche terminee"; emit(true);
      return { path: best, metrics: bestMetrics, initialMetrics, stage, zone: zoneSnapshot(performance.now()), elapsedMs: performance.now() - started,
        lastImprovementMs: performance.now() - lastImprovement, stagnationLimitMs: limit, improvements, restarts, progress: 100, phase };
    }
    return { optimizePath, createOrderEvaluator, improvesOrder, satisfiesConstraints: model.satisfiesConstraints };
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
