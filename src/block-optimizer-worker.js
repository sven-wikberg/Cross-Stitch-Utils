(function (root) {
  "use strict";
  function createBlockOptimizer(model, createBuilder, clock = () => performance.now(), random = Math.random) {
    const builder = createBuilder(model, clock), epsilon = 1e-8;
    const better = (score, cuts, otherScore, otherCuts) => Number.isFinite(score)
      && (score < otherScore - epsilon || (Math.abs(score - otherScore) <= epsilon && cuts < otherCuts));
    const compareMetrics = (a, b) => Math.abs(a.score - b.score) > epsilon ? a.score - b.score
      : a.cuts - b.cuts || a.distance - b.distance;
    const nodeKey = point => `${model.key(point)}:${point.direction}`;
    function boundsOf(cells) {
      const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const cell of cells) {
        bounds.minX = Math.min(bounds.minX, cell.x); bounds.minY = Math.min(bounds.minY, cell.y);
        bounds.maxX = Math.max(bounds.maxX, cell.x + 1); bounds.maxY = Math.max(bounds.maxY, cell.y + 1);
      }
      return bounds;
    }
    function normalized(point, cuts) {
      return { ...model.copy(point), ...(cuts.has(model.key(point)) ? { cutBefore: true } : {}) };
    }
    // A two-by-two transfer matrix retains every feasible first/last sewing direction.
    function summarize(sequence, units, constraints, threshold, cuts) {
      const fixed = new Map((constraints.lockedPrefix || []).map(p => [model.key(p), p.direction]));
      if (constraints.start) fixed.set(model.key(constraints.start), constraints.start.direction);
      const variants = p => [1, -1].map(direction => ({ ...normalized(p, cuts), direction }));
      const first = variants(sequence[0]);
      let previous = first, scores = [Infinity, Infinity, Infinity, Infinity], counts = [0, 0, 0, 0];
      for (let d = 0; d < 2; d++) if (!fixed.has(model.key(first[d])) || fixed.get(model.key(first[d])) === first[d].direction) scores[d * 3] = 0;
      for (let i = 1; i < sequence.length; i++) {
        const points = variants(sequence[i]), costs = new Array(4).fill(Infinity), extraCuts = new Array(4).fill(0);
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
          if (fixed.has(model.key(points[b])) && fixed.get(model.key(points[b])) !== points[b].direction) continue;
          const distance = model.distance(previous[a], points[b]);
          if (!distance || (units[i] && distance !== 1)) continue;
          extraCuts[a * 2 + b] = Number(points[b].cutBefore || distance > threshold);
          costs[a * 2 + b] = distance + extraCuts[a * 2 + b] * threshold * 3;
        }
        const nextScores = new Array(4).fill(Infinity), nextCounts = new Array(4).fill(0);
        for (let start = 0; start < 2; start++) for (let end = 0; end < 2; end++) for (let middle = 0; middle < 2; middle++) {
          const at = start * 2 + end, value = scores[start * 2 + middle] + costs[middle * 2 + end];
          const count = counts[start * 2 + middle] + extraCuts[middle * 2 + end];
          if (better(value, count, nextScores[at], nextCounts[at])) { nextScores[at] = value; nextCounts[at] = count; }
        }
        scores = nextScores; counts = nextCounts; previous = points;
      }
      return { first, last: previous, scores, counts };
    }
    function configSequence(block, config) {
      if (config.sequence) return config.sequence;
      const sequence = builder.buildSequence(block.cells, config.entry, config.exit);
      if (!sequence) throw new Error("Configuration de bloc devenue inaccessible.");
      return block.resume ? sequence.slice(1) : sequence;
    }
    const configUnits = (sequence, config) => config.units || sequence.map((_, i) => i > 0);
    function addConfig(problem, block, config, sequence = configSequence(block, config)) {
      if (!sequence?.length) return;
      block.configs.push(config);
      block.records.push({ ...summarize(sequence, configUnits(sequence, config), problem.constraints, problem.threshold, problem.cuts),
        config: block.configs.length - 1 });
    }
    function finishBlock(block) {
      const entries = new Map(), exits = new Map();
      for (const record of block.records) {
        record.first.forEach(point => { if (!entries.has(nodeKey(point))) entries.set(nodeKey(point), point); });
        record.last.forEach(point => { if (!exits.has(nodeKey(point))) exits.set(nodeKey(point), point); });
      }
      block.entries = [...entries.values()]; block.exits = [...exits.values()];
      const entryIds = new Map(block.entries.map((point, i) => [nodeKey(point), i]));
      const exitIds = new Map(block.exits.map((point, i) => [nodeKey(point), i]));
      const size = block.entries.length * block.exits.length;
      block.costs = new Float64Array(size).fill(Infinity); block.cutCounts = new Int32Array(size);
      block.choices = new Int32Array(size).fill(-1);
      for (const record of block.records) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        const at = entryIds.get(nodeKey(record.first[a])) * block.exits.length + exitIds.get(nodeKey(record.last[b]));
        if (better(record.scores[a * 2 + b], record.counts[a * 2 + b], block.costs[at], block.cutCounts[at])) {
          block.costs[at] = record.scores[a * 2 + b]; block.cutCounts[at] = record.counts[a * 2 + b]; block.choices[at] = record.config;
        }
      }
      delete block.records;
    }
    function prepareProblem(options, report = () => {}) {
      const cells = options.points || [], threshold = Math.max(1, options.cutThreshold || 10);
      const constraints = { ...(options.constraints || {}), forcedCuts: [...new Map([
        ...(options.constraints?.forcedCuts || []), ...(options.initialPath || []).filter(p => p.cutBefore)
      ].map(p => [model.key(p), model.copy(p)])).values()] };
      const seed = builder.buildPath({ ...options, cutThreshold: threshold, constraints }, snapshot => report({ ...snapshot,
        method: "block-optimization", stage: "construction", progress: snapshot.progress * 0.1,
        ...(options.initialPath?.length ? { path: undefined } : {}) }));
      const cuts = new Set(constraints.forcedCuts.map(model.key)), blocks = [];
      if (seed.prefixLength) blocks.push({ anchor: true, cells: [], configs: [], records: [],
        seedSequence: seed.path.slice(0, seed.prefixLength), seedUnits: seed.unitLinks.slice(0, seed.prefixLength), incomingUnit: false });
      for (const group of seed.blocks) blocks.push({ ...group, configs: [], records: [], anchor: false,
        seedSequence: seed.path.slice(group.start, group.end), incomingUnit: group.resume,
        seedUnits: seed.unitLinks.slice(group.start, group.end).map((unit, i) => i > 0 && unit), bounds: boundsOf(group.cells) });
      blocks.forEach((block, id) => { block.id = id; });
      const fixedCount = Number(seed.prefixLength > 0) + Number(seed.blocks[0]?.resume || false);
      const problem = { cells, blocks, constraints, cuts, threshold, fixedCount, seed,
        orders: [blocks.map(block => block.id)], neighbors: new Map(), transitionCache: new Map(), cacheElements: 0,
        incumbent: { path: seed.path, unitLinks: seed.unitLinks, order: blocks.map(block => block.id), metrics: seed.metrics } };
      for (const block of blocks) addConfig(problem, block, { sequence: block.seedSequence, units: block.seedUnits });

      // Keep a compatible historical route as a candidate, including its exact endpoint choices.
      const initial = (options.initialPath || []).map(point => normalized(point, cuts));
      if (initial.length && !model.validateRoute(initial, cells) && model.satisfiesConstraints(initial, constraints)) {
        const owners = new Map();
        blocks.filter(block => !block.anchor).forEach(block => block.seedSequence.forEach(point => owners.set(model.key(point), block.id)));
        const parts = [], seen = new Set(); let compatible = true;
        for (let i = seed.prefixLength; i < initial.length; i++) {
          const id = owners.get(model.key(initial[i]));
          if (id === undefined) { compatible = false; break; }
          if (parts.at(-1)?.id !== id) {
            if (seen.has(id)) { compatible = false; break; }
            seen.add(id); parts.push({ id, points: [] });
          } else if (model.distance(initial[i - 1], initial[i]) !== 1) { compatible = false; break; }
          parts.at(-1).points.push(initial[i]);
        }
        const order = [...(seed.prefixLength ? [0] : []), ...parts.map(part => part.id)];
        compatible &&= order.length === blocks.length && order.slice(0, fixedCount).every((id, i) => id === i)
          && parts.every(part => part.points.length === blocks[part.id].seedSequence.length);
        if (compatible && seed.blocks[0]?.resume && model.distance(initial[seed.prefixLength - 1], initial[seed.prefixLength]) !== 1) compatible = false;
        if (compatible) {
          const units = initial.map((_, i) => i >= seed.prefixLength && i > 0 && (owners.get(model.key(initial[i - 1])) === owners.get(model.key(initial[i]))
            || (i === seed.prefixLength && seed.blocks[0]?.resume)));
          for (const part of parts) {
            blocks[part.id].initialSequence = part.points;
            addConfig(problem, blocks[part.id], { sequence: part.points });
          }
          problem.orders.push(order);
          const metrics = model.createZones(cells).measure(initial, threshold);
          if (compareMetrics(metrics, problem.incumbent.metrics) < 0) problem.incumbent = { path: initial, unitLinks: units, order, metrics };
        }
      }
      report({ stage: "configuration", phase: "Preparation des entrees et sorties", progress: 10,
        path: problem.incumbent.path, unitLinks: problem.incumbent.unitLinks, metrics: problem.incumbent.metrics,
        initialMetrics: problem.incumbent.metrics, blocks: { total: seed.blocks.length, prepared: 0 } });
      const freeBlocks = blocks.filter(block => !block.anchor);
      for (const block of freeBlocks) {
        const a = block.bounds;
        const nearby = freeBlocks.filter(other => other !== block).map(other => {
          const b = other.bounds;
          return { id: other.id, gap: Math.hypot(Math.max(a.minX - b.maxX, b.minX - a.maxX, 0), Math.max(a.minY - b.maxY, b.minY - a.maxY, 0)),
            center: Math.hypot(a.minX + a.maxX - b.minX - b.maxX, a.minY + a.maxY - b.minY - b.maxY) };
        }).sort((a, b) => a.gap - b.gap || a.center - b.center).slice(0, 16).map(item => item.id);
        problem.neighbors.set(block.id, nearby);
      }
      let prepared = 0, attempts = 0;
      for (const block of blocks) {
        if (!block.anchor && !block.partial && block.cells.length > 1) {
          const portals = [], keys = new Set(), add = point => {
            if (point && !keys.has(model.cellKey(point)) && portals.length < 8) {
              keys.add(model.cellKey(point)); portals.push({ x: point.x, y: point.y });
            }
          };
          add(block.resume ? block.root : block.seedSequence[0]); add(block.seedSequence.at(-1));
          if (block.initialSequence) { add(block.initialSequence[0]); add(block.initialSequence.at(-1)); }
          for (const id of problem.neighbors.get(block.id) || []) {
            const target = blocks[id].bounds; let chosen = null, bestGap = Infinity, bestCenter = Infinity;
            for (const cell of block.cells) {
              const x = cell.x + 0.5, y = cell.y + 0.5;
              const gap = Math.hypot(Math.max(target.minX - x, 0, x - target.maxX), Math.max(target.minY - y, 0, y - target.maxY));
              const center = Math.hypot(x * 2 - target.minX - target.maxX, y * 2 - target.minY - target.maxY);
              if (gap < bestGap || (gap === bestGap && center < bestCenter)) { chosen = cell; bestGap = gap; bestCenter = center; }
            }
            add(chosen);
          }
          for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            let chosen = block.cells[0];
            for (const cell of block.cells) if (cell.x * dx + cell.y * dy > chosen.x * dx + chosen.y * dy) chosen = cell;
            add(chosen);
          }
          for (const entry of block.resume ? [block.root] : portals) for (const exit of portals) {
            attempts++;
            let sequence = builder.buildSequence(block.cells, entry, exit);
            if (!sequence) continue;
            if (block.resume) sequence = sequence.slice(1);
            addConfig(problem, block, { entry, exit }, sequence);
          }
        }
        finishBlock(block);
        if (!block.anchor) prepared++;
        report({ stage: "configuration", phase: `Entrees et sorties : ${prepared} / ${freeBlocks.length}`,
          blocks: { total: freeBlocks.length, prepared }, attempts, progress: 10 + (freeBlocks.length ? prepared / freeBlocks.length * 10 : 10) });
      }
      return problem;
    }
    function transitions(problem, a, b) {
      const key = a.id * problem.blocks.length + b.id, cached = problem.transitionCache.get(key);
      if (cached) { problem.transitionCache.delete(key); problem.transitionCache.set(key, cached); return cached; }
      const size = a.exits.length * b.entries.length, costs = new Float64Array(size), cuts = new Int8Array(size);
      for (let x = 0; x < a.exits.length; x++) for (let y = 0; y < b.entries.length; y++) {
        const at = x * b.entries.length + y, distance = model.distance(a.exits[x], b.entries[y]);
        cuts[at] = Number(b.entries[y].cutBefore || distance > problem.threshold);
        costs[at] = !distance || (b.incomingUnit && distance !== 1) ? Infinity : distance + cuts[at] * problem.threshold * 3;
      }
      while (problem.cacheElements + size > 524288 && problem.transitionCache.size) {
        const first = problem.transitionCache.keys().next().value;
        problem.cacheElements -= problem.transitionCache.get(first).costs.length; problem.transitionCache.delete(first);
      }
      const value = { costs, cuts }; problem.transitionCache.set(key, value); problem.cacheElements += size;
      return value;
    }
    function evaluateOrder(problem, order, trace = false, validate = true) {
      if (validate && (order.length !== problem.blocks.length || new Set(order).size !== order.length
          || order.some(id => !Number.isInteger(id) || !problem.blocks[id])
          || order.slice(0, problem.fixedCount).some((id, i) => id !== i))) throw new Error("Ordre de blocs invalide.");
      let scores = null, counts = null, previous = null;
      const history = [];
      for (const id of order) {
        const block = problem.blocks[id], e = block.entries.length, q = block.exits.length;
        const entryScores = new Float64Array(e).fill(previous ? Infinity : 0), entryCuts = new Int32Array(e);
        const before = trace ? new Int32Array(e).fill(-1) : null;
        if (previous) {
          const links = transitions(problem, previous, block);
          for (let from = 0; from < scores.length; from++) for (let to = 0; to < e; to++) {
            const at = from * e + to, score = scores[from] + links.costs[at], cuts = counts[from] + links.cuts[at];
            if (better(score, cuts, entryScores[to], entryCuts[to])) {
              entryScores[to] = score; entryCuts[to] = cuts; if (trace) before[to] = from;
            }
          }
        }
        const nextScores = new Float64Array(q).fill(Infinity), nextCuts = new Int32Array(q);
        const selected = trace ? new Int32Array(q).fill(-1) : null;
        for (let from = 0; from < e; from++) for (let to = 0; to < q; to++) {
          const at = from * q + to, score = entryScores[from] + block.costs[at], cuts = entryCuts[from] + block.cutCounts[at];
          if (better(score, cuts, nextScores[to], nextCuts[to])) {
            nextScores[to] = score; nextCuts[to] = cuts; if (trace) selected[to] = from;
          }
        }
        if (trace) history.push({ selected, before });
        scores = nextScores; counts = nextCuts; previous = block;
      }
      let score = order.length ? Infinity : 0, cuts = 0, end = -1;
      for (let i = 0; i < (scores?.length || 0); i++) if (better(scores[i], counts[i], score, cuts)) { score = scores[i]; cuts = counts[i]; end = i; }
      return { score, cuts, ...(trace ? { trace: history, end } : {}) };
    }
    function materialize(problem, order, evaluation = evaluateOrder(problem, order, true)) {
      if (!evaluation.trace) evaluation = evaluateOrder(problem, order, true);
      if (!Number.isFinite(evaluation.score)) throw new Error("Aucune liaison valide entre ces blocs.");
      const selections = new Array(order.length); let end = evaluation.end;
      for (let i = order.length - 1; i >= 0; i--) {
        const entry = evaluation.trace[i].selected[end]; selections[i] = { entry, exit: end };
        end = evaluation.trace[i].before[entry];
      }
      const path = [], unitLinks = [];
      for (let i = 0; i < order.length; i++) {
        const block = problem.blocks[order[i]], choice = selections[i], at = choice.entry * block.exits.length + choice.exit;
        const config = block.configs[block.choices[at]], sequence = configSequence(block, config), units = configUnits(sequence, config);
        const oriented = builder.orientUnitPath(sequence, units, problem.constraints, problem.threshold, null, [],
          { first: block.entries[choice.entry].direction, last: block.exits[choice.exit].direction });
        if (!oriented) throw new Error("Sens de couture incompatibles avec la configuration choisie.");
        for (let j = 0; j < oriented.path.length; j++) { path.push(oriented.path[j]); unitLinks.push(j ? units[j] : Boolean(block.incomingUnit)); }
      }
      const error = model.validateRoute(path, problem.cells);
      if (error || !model.satisfiesConstraints(path, problem.constraints)) throw new Error(error || "Contraintes non respectees.");
      if (path.some((p, i) => unitLinks[i] && (!i || model.distance(path[i - 1], p) !== 1))) throw new Error("Une liaison interne n'est plus unitaire.");
      return { path, unitLinks };
    }
    function optimizePath(options, report = () => {}) {
      const started = clock(), limit = Math.max(1, Number(options.stagnationLimitMs) || 60000);
      let lastReport = -Infinity, attempts = 0, improvements = 0, restarts = 0, lastImprovement = started;
      let best = null, bestOrder, bestMetrics, initialMetrics, changed = false, phase = "Construction du parcours initial";
      let stage = "construction", blocks = { total: 0, prepared: 0 }, progress = 0;
      const problem = prepareProblem(options, snapshot => {
        const now = clock();
        if (snapshot.path && snapshot.stage === "configuration") {
          best = { path: snapshot.path, unitLinks: snapshot.unitLinks }; bestMetrics = snapshot.metrics; initialMetrics = snapshot.initialMetrics;
        }
        stage = snapshot.stage; phase = snapshot.phase; blocks = snapshot.blocks || blocks; progress = snapshot.progress;
        if (now - lastReport < 150 && !snapshot.initialMetrics) return;
        lastReport = now;
        report({ ...snapshot, method: "block-optimization", metrics: bestMetrics || snapshot.metrics, initialMetrics,
          ...(best ? { path: best.path, unitLinks: best.unitLinks } : {}), elapsedMs: now - started,
          lastImprovementMs: 0, stagnationLimitMs: limit, improvements, restarts, attempts: snapshot.attempts || 0, blocks });
      });
      const zones = model.createZones(problem.cells);
      best ||= { path: problem.incumbent.path, unitLinks: problem.incumbent.unitLinks };
      bestOrder = problem.incumbent.order.slice(); bestMetrics ||= problem.incumbent.metrics; initialMetrics ||= bestMetrics;
      function emit(force = false) {
        const now = clock();
        if (!force && now - lastReport < 150) return;
        lastReport = now;
        report({ method: "block-optimization", stage, phase, blocks, metrics: bestMetrics, initialMetrics,
          ...(changed || force ? { path: best.path.map(model.copy), unitLinks: best.unitLinks.slice() } : {}),
          elapsedMs: now - started, lastImprovementMs: Math.max(0, now - lastImprovement), stagnationLimitMs: limit,
          attempts, improvements, restarts, progress: stage === "complete" ? 100 : stage === "search" ? Math.min(99, (now - lastImprovement) / limit * 100) : progress });
        changed = false;
      }
      function consider(order, value) {
        if (!better(value.score, value.cuts, bestMetrics.score, bestMetrics.cuts)) return false;
        const route = materialize(problem, order), metrics = zones.measure(route.path, problem.threshold);
        if (compareMetrics(metrics, bestMetrics) >= -epsilon) return false;
        best = route; bestOrder = order.slice(); bestMetrics = metrics; changed = true; improvements++; lastImprovement = clock();
        emit(); return true;
      }
      for (const order of problem.orders) consider(order, evaluateOrder(problem, order));
      // Even a tied incumbent is realized through the validated block transfer matrices.
      const realized = materialize(problem, bestOrder);
      if (compareMetrics(zones.measure(realized.path, problem.threshold), bestMetrics) <= epsilon) {
        best = realized; bestMetrics = zones.measure(best.path, problem.threshold);
      }
      stage = "search"; phase = "Optimisation des liaisons entre blocs"; lastImprovement = clock(); changed = true; emit(true);
      const freeCount = problem.blocks.length - problem.fixedCount;
      let reason = "inactivity";
      const expired = () => clock() - lastImprovement >= limit;
      if (freeCount <= 7) {
        reason = "exhaustive";
        const permutation = bestOrder.slice(problem.fixedCount), prefix = bestOrder.slice(0, problem.fixedCount);
        function visit(depth) {
          if (expired()) { reason = "inactivity"; return; }
          if (depth === permutation.length) {
            const order = prefix.concat(permutation); attempts++; consider(order, evaluateOrder(problem, order, false, false)); emit(); return;
          }
          for (let i = depth; i < permutation.length; i++) {
            [permutation[depth], permutation[i]] = [permutation[i], permutation[depth]]; visit(depth + 1);
            [permutation[depth], permutation[i]] = [permutation[i], permutation[depth]];
            if (reason === "inactivity") return;
          }
        }
        visit(0);
      } else {
        let working = bestOrder.slice(), value = evaluateOrder(problem, working), misses = 0;
        const rand = n => Math.min(n - 1, Math.floor(random() * n));
        function mutate(order, broad = false) {
          const result = order.slice(), i = problem.fixedCount + rand(freeCount);
          const neighbors = problem.neighbors.get(result[i]) || [];
          let j = broad || !neighbors.length || attempts % 16 === 0 ? problem.fixedCount + rand(freeCount)
            : result.indexOf(neighbors[rand(neighbors.length)]);
          if (j < problem.fixedCount) j = problem.fixedCount + rand(freeCount);
          const operation = rand(3);
          if (operation === 0) { const [id] = result.splice(i, 1); result.splice(j, 0, id); }
          else if (operation === 1) [result[i], result[j]] = [result[j], result[i]];
          else for (let a = Math.min(i, j), b = Math.max(i, j); a < b; a++, b--) [result[a], result[b]] = [result[b], result[a]];
          return result;
        }
        while (!expired()) {
          const candidate = mutate(working), next = evaluateOrder(problem, candidate, false, false); attempts++;
          if (better(next.score, next.cuts, value.score, value.cuts)) { working = candidate; value = next; misses = 0; consider(candidate, next); }
          else misses++;
          if (misses >= Math.max(100, freeCount)) {
            working = bestOrder.slice(); for (let i = 0; i < 4; i++) working = mutate(working, true);
            value = evaluateOrder(problem, working, false, false); misses = 0; restarts++;
          }
          emit();
        }
      }
      stage = "complete"; phase = reason === "exhaustive" ? "Liaisons optimisees : tous les ordres testes" : "Optimisation terminee : delai sans amelioration atteint";
      const final = { method: "block-optimization", stage, phase, path: best.path, unitLinks: best.unitLinks, metrics: bestMetrics,
        initialMetrics, blocks, elapsedMs: clock() - started, lastImprovementMs: clock() - lastImprovement,
        stagnationLimitMs: limit, attempts, improvements, restarts, progress: 100, reason, order: bestOrder };
      report(final); return final;
    }
    return { prepareProblem, evaluateOrder, materialize, optimizePath, compareMetrics, satisfiesConstraints: model.satisfiesConstraints };
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
  root.createPathOptimizerApi = () => createBlockOptimizer(root.StitchModel, root.createOrthogonalPathBuilder);
  root.createPathOptimizerWorker = () => {
    const source = `(${workerMain.toString()})(${root.createStitchModel.toString()},${root.createOrthogonalPathBuilder.toString()},${createBlockOptimizer.toString()});`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url); URL.revokeObjectURL(url); return worker;
  };
  if (typeof module !== "undefined") module.exports = { createBlockOptimizer };
})(typeof window === "undefined" ? globalThis : window);
