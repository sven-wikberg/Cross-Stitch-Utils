(function (root) {
  "use strict";
  function createSectionOptimizer(model, createPoints, createBuilder, clock = () => performance.now(), random = Math.random) {
    const builder = createBuilder(model, clock), epsilon = 1e-8;
    const orthogonal = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
    const measure = (path, threshold) => model.metrics(path, threshold, true);
    const prefixFor = constraints => (constraints.lockedPrefix?.length ? constraints.lockedPrefix
      : constraints.start ? [constraints.start] : []).map(model.copy);
    function splitSections(order, constraints = {}, boundaries = new Set()) {
      if (new Set(order.map(model.cellKey)).size !== order.length) throw new Error("Ordre de cases duplique.");
      const prefix = prefixFor(constraints), error = model.validateRoute(prefix, order, false);
      if (error) throw new Error(error);
      const lower = new Set(prefix.filter(p => p.diagonal === "lower").map(model.cellKey));
      const upper = new Set(prefix.filter(p => p.diagonal === "upper").map(model.cellKey));
      const sections = []; let current = null;
      order.forEach((cell, index) => {
        const key = model.cellKey(cell);
        if (upper.has(key)) { current = null; return; }
        if (lower.has(key)) {
          sections.push({ cells: [cell], upperOnly: true, start: index, end: index + 1 }); current = null; return;
        }
        if (!current || boundaries.has(index) || !orthogonal(current.cells.at(-1), cell)) {
          current = { cells: [], upperOnly: false, start: index, end: index + 1 }; sections.push(current);
        }
        current.cells.push(cell); current.end = index + 1;
      });
      return { prefix, sections };
    }
    function endpointPool(cells, targets, preferred, breadth, round) {
      const chosen = [], seen = new Set();
      const add = p => { if (p && !seen.has(model.cellKey(p))) { chosen.push(p); seen.add(model.cellKey(p)); } };
      add(preferred);
      if (targets.length) {
        const ranked = cells.map(p => ({ p, distance: Math.min(...targets.map(t => Math.hypot(p.x - t.x, p.y - t.y))) }))
          .sort((a, b) => a.distance - b.distance);
        add(ranked[0]?.p);
        add(ranked[Math.min(ranked.length - 1, round % Math.min(8, ranked.length))]?.p);
      }
      add(cells[(Math.floor(cells.length / 2) + round) % cells.length]);
      add(cells[0]); add(cells.at(-1));
      return chosen.slice(0, breadth);
    }
    function sectionVariants(section, options = {}) {
      const threshold = options.cutThreshold || 10, deadline = options.deadline ?? Infinity;
      const breadth = Math.max(1, Math.min(4, options.breadth || 3)), round = options.round || 0;
      const cuts = new Set((options.constraints?.forcedCuts || []).map(model.key));
      const cells = section.cells, sequences = new Set(), bestByEnds = new Map();
      let tested = 0;
      const action = (cell, diagonal) => ({ x: cell.x, y: cell.y, diagonal, direction: 1,
        ...(cuts.has(`${model.cellKey(cell)}:${diagonal}`) ? { cutBefore: true } : {}) });
      function add(sequence, unit) {
        if (!sequence || clock() >= deadline) return;
        const signature = sequence.map(model.key).join(";") + Number(unit);
        if (sequences.has(signature)) return;
        sequences.add(signature);
        const mask = sequence.map((_, i) => unit && i > 0);
        // Keep every feasible endpoint orientation; an internally cheaper choice can have a worse junction.
        for (const first of [1, -1]) for (const last of [1, -1]) {
          if (clock() >= deadline) return;
          const value = builder.orientUnitPath(sequence, mask, options.constraints || {}, threshold, null, [], { first, last });
          tested++;
          if (!value) continue;
          const from = value.path[0], to = value.path.at(-1);
          const key = `${model.key(from)}:${from.direction}>${model.key(to)}:${to.direction}`;
          const old = bestByEnds.get(key);
          if (!old || value.score < old.score - epsilon) bestByEnds.set(key, {
            sequence, directions: Int8Array.from(value.path, p => p.direction), first: from, last: to, score: value.score
          });
        }
        options.pulse?.({ tested, variants: bestByEnds.size });
      }
      if (section.upperOnly) add([action(cells[0], "upper")], false);
      else {
        add(cells.flatMap(cell => [action(cell, "lower"), action(cell, "upper")]), false);
        add(cells.map(cell => action(cell, "lower")).concat(cells.toReversed().map(cell => action(cell, "upper"))), true);
        const entries = endpointPool(cells, options.previous || [], cells[0], breadth, round);
        const exits = endpointPool(cells, options.next || [], cells.at(-1), breadth, round);
        for (const entry of entries) {
          if (clock() >= deadline) break;
          add(builder.buildSequence(cells, entry, entry)?.map(p => action(p, p.diagonal)), true);
          for (const exit of exits) {
            if (clock() >= deadline) break;
            add(builder.buildSequence(cells, entry, exit)?.map(p => action(p, p.diagonal)), true);
          }
        }
      }
      return { variants: [...bestByEnds.values()], tested, complete: clock() < deadline };
    }
    const unpack = variant => variant.sequence.map((p, i) => ({ ...model.copy(p), direction: variant.directions[i] }));
    function combineSections(layers, prefix = [], threshold = 10, options = {}) {
      const deadline = options.deadline ?? Infinity, parents = [];
      let previous = [], scores = [], connections = 0;
      for (let layer = 0; layer < layers.length; layer++) {
        if (clock() >= deadline) return null;
        const current = layers[layer], nextScores = new Float64Array(current.length).fill(Infinity);
        const chosen = new Int32Array(current.length).fill(-1);
        for (let to = 0; to < current.length; to++) {
          if (clock() >= deadline) return null;
          if (!layer) nextScores[to] = current[to].score + model.cost(prefix.at(-1), current[to].first, threshold, true);
          else for (let from = 0; from < previous.length; from++) {
            const value = scores[from] + current[to].score + model.cost(previous[from].last, current[to].first, threshold, true);
            connections++;
            if (value < nextScores[to]) { nextScores[to] = value; chosen[to] = from; }
          }
        }
        parents.push(chosen); previous = current; scores = nextScores;
        options.pulse?.({ prepared: layer + 1, total: layers.length, connections });
      }
      if (!layers.length) return { path: prefix.map(model.copy), score: measure(prefix, threshold).score, connections: 0, selected: [] };
      let last = -1;
      for (let i = 0; i < scores.length; i++) if (last < 0 || scores[i] < scores[last]) last = i;
      if (last < 0 || !Number.isFinite(scores[last])) return null;
      const score = measure(prefix, threshold).score + scores[last], selected = new Array(layers.length);
      for (let i = layers.length - 1; i >= 0; i--) { selected[i] = last; last = parents[i][last]; }
      const path = prefix.map(model.copy);
      for (let i = 0; i < layers.length; i++) for (const point of unpack(layers[i][selected[i]])) path.push(point);
      return { path, score, connections, selected };
    }
    function decode(order, options = {}, pulse = () => {}) {
      const { prefix, sections } = splitSections(order, options.constraints, options.boundaries);
      const deadline = options.deadline ?? Infinity, layers = []; let tested = 0, variants = 0;
      for (let i = 0; i < sections.length; i++) {
        if (clock() >= deadline) return null;
        const nearby = section => section ? [section.cells[0], section.cells.at(-1)] : [];
        const value = sectionVariants(sections[i], { ...options, previous: i ? nearby(sections[i - 1]) : prefix.slice(-1),
          next: nearby(sections[i + 1]), pulse: s => pulse({ phase: "sections", total: sections.length, prepared: i,
            crosses: sections[i].cells.length, tested: tested + s.tested, variants: variants + s.variants }) });
        if (!value.complete || !value.variants.length) return null;
        layers.push(value.variants); tested += value.tested; variants += value.variants.length;
        pulse({ phase: "sections", total: sections.length, prepared: i + 1, crosses: sections[i].cells.length, tested, variants });
      }
      const result = combineSections(layers, prefix, options.cutThreshold || 10, { deadline,
        pulse: s => pulse({ ...s, phase: "junctions", tested, variants }) });
      if (!result || clock() >= deadline) return null;
      return { ...result, sections, tested, variants };
    }
    function optimizePath(options, report = () => {}) {
      const cells = options.points || [], threshold = options.cutThreshold || 10;
      const constraints = { ...(options.constraints || {}), forcedCuts: [
        ...(options.constraints?.forcedCuts || []), ...(options.initialPath || []).filter(p => p.cutBefore)
      ] };
      const started = clock(), stopAfterInactivity = options.stopAfterInactivity === true;
      const stagnationLimitMs = Math.max(1, Number(options.stagnationLimitMs) || 60000);
      const totalLimitMs = stopAfterInactivity ? null : Math.max(1, options.totalLimitMs || 3600000);
      const budgetMs = stopAfterInactivity ? stagnationLimitMs : totalLimitMs;
      let lastImproved = started, deadline = stopAfterInactivity ? Infinity : started + budgetMs;
      let preparing = stopAfterInactivity, searchStarted = null;
      const pointDeadline = started + budgetMs * 0.65, lowerBound = Math.max(0, cells.length * 2 - 1);
      const stats = { orders: 0, conversions: 0, completed: 0, bestConversionScore: null, sections: 0, prepared: 0, crosses: 0, variants: 0,
        connections: 0, trials: 0, refinements: 0, pointEvaluations: 0, restarts: 0 };
      let best = null, metrics = null, initialMetrics = null, improvements = 0, changed = false;
      let stage = "points", phase = "Points : preparation", lastReport = -Infinity, reason = stopAfterInactivity ? "inactivity" : "budget";
      const valid = path => path && path.length === cells.length * 2 && !model.validateRoute(path, cells) && model.satisfiesConstraints(path, constraints);
      function emit(force = false) {
        const now = clock(); if (!force && now - lastReport < 250) return;
        lastReport = now;
        report({ method: "point-sections", stage, phase, elapsedMs: now - started, totalLimitMs, metrics, initialMetrics,
          improvements, attempts: stats.pointEvaluations + stats.trials + stats.connections, restarts: stats.restarts,
          sectionSearch: { ...stats }, ...timing(now), reason,
          ...(best && changed ? { path: best.map(model.copy) } : {}) });
        changed = false;
      }
      function timing(now) {
        return { stopAfterInactivity, preparing, preparationMs: (searchStarted ?? now) - started,
          stagnationLimitMs, lastImprovementMs: preparing ? 0 : now - lastImproved,
          remainingMs: preparing ? stagnationLimitMs : Math.max(0, deadline - now),
          progress: stage === "complete" ? 100 : preparing ? 0 : Math.min(100, (now - (stopAfterInactivity ? lastImproved : started)) / budgetMs * 100) };
      }
      function beginSearch() {
        if (searchStarted !== null) return;
        searchStarted = clock(); preparing = false;
        if (stopAfterInactivity) { lastImproved = searchStarted; deadline = searchStarted + stagnationLimitMs; }
        phase = "Points : recherche"; emit(true);
      }
      function keep(path) {
        if (!valid(path)) return false;
        const value = measure(path, threshold); initialMetrics ||= value;
        if (best && value.score >= metrics.score - epsilon) return false;
        if (best) {
          improvements++; lastImproved = clock();
          if (stopAfterInactivity && !preparing) deadline = lastImproved + stagnationLimitMs;
        }
        best = path.map(model.copy); metrics = value; changed = true; emit(true); return true;
      }
      const ids = new Map(cells.map((p, i) => [model.cellKey(p), i])), seen = new Set(), initialOrder = [];
      if (ids.size !== cells.length) throw new Error("Cases dupliquees.");
      for (const point of options.initialPath || []) {
        const id = ids.get(model.cellKey(point));
        if (id !== undefined && !seen.has(id)) { seen.add(id); initialOrder.push(id); }
      }
      cells.forEach((_, id) => { if (!seen.has(id)) initialOrder.push(id); });
      const prefix = prefixFor(constraints), prefixKeys = new Set(prefix.map(model.key));
      if (valid(options.initialPath)) keep(options.initialPath);
      if (!best) {
        const sequence = prefix.concat(initialOrder.flatMap(id => ["lower", "upper"].map(diagonal => ({
          x: cells[id].x, y: cells[id].y, diagonal, direction: 1
        })).filter(p => !prefixKeys.has(model.key(p)))));
        keep(model.orient(sequence, threshold, constraints, true));
      }
      if (!best) throw new Error("Impossible de construire un parcours compatible.");
      const editable = prefix.length < cells.length * 2 - 1, elite = [], converted = new Set();
      let pending = initialOrder, lastConversion = -Infinity;
      function convert(route, force = false, round = 0, boundaries = new Set()) {
        if (!editable || clock() >= deadline || metrics.score <= lowerBound + epsilon) return null;
        if (!force && clock() - lastConversion < Math.max(500, cells.length / 2)) return null;
        const key = route.join(","), signature = `${key}|${round}|${[...boundaries].join(",")}`;
        if (converted.has(signature)) return null;
        if (route.length !== cells.length || new Set(route).size !== cells.length || route.some(i => !Number.isInteger(i) || !cells[i])) throw new Error("Ordre de cases invalide.");
        converted.add(signature); if (converted.size > 24) converted.delete(converted.values().next().value);
        const previousStage = stage, previousPhase = phase; stage = "sections";
        stats.conversions++; stats.sections = 0; stats.prepared = 0;
        const trialsBefore = stats.trials, connectionsBefore = stats.connections;
        const result = decode(route.map(i => cells[i]), { constraints, cutThreshold: threshold, round, boundaries,
          breadth: round ? 4 : 3, deadline: preparing ? Infinity : Math.min(deadline, clock() + Math.max(1000, Math.min(15000, budgetMs * 0.15))) }, s => {
          stage = s.phase; stats.sections = s.total;
          stats.prepared = s.phase === "sections" ? s.prepared : s.total; stats.crosses = s.crosses || 0;
          stats.variants = s.variants; stats.trials = trialsBefore + s.tested;
          stats.connections = connectionsBefore + (s.connections || 0);
          phase = s.phase === "sections" ? `Sous-sections : ${Math.min(s.total, s.prepared + 1)} / ${s.total}`
            : `Raccordements : ${s.prepared} / ${s.total}`;
          emit();
        });
        lastConversion = clock();
        if (result) {
          stats.completed++;
          stats.bestConversionScore = Math.min(stats.bestConversionScore ?? Infinity, result.score);
          keep(result.path);
          const previous = elite.findIndex(e => e.key === key);
          if (previous < 0 || result.score < elite[previous].score) {
            if (previous >= 0) elite.splice(previous, 1);
            elite.push({ key, route: route.slice(), score: result.score, sections: result.sections, boundaries: new Set(boundaries) });
            elite.sort((a, b) => a.score - b.score); if (elite.length > 4) elite.pop();
          }
        }
        stage = previousStage; phase = previousPhase; emit(); return result;
      }
      stats.orders++; convert(initialOrder, true);
      if (editable && metrics.score > lowerBound + epsilon && (stopAfterInactivity || clock() < pointDeadline)) {
        try {
          const result = createPoints(clock, random).optimizePath({ points: cells, initialPath: initialOrder.map(id => cells[id]),
            cutThreshold: threshold, totalLimitMs: stopAfterInactivity ? budgetMs * 0.65 : Math.max(1, pointDeadline - clock()),
            excludeSetupTime: stopAfterInactivity, onReady: beginSearch,
            stagnationLimitMs: stopAfterInactivity ? Infinity : totalLimitMs,
            shouldStop: () => metrics.score <= lowerBound + epsilon || (stopAfterInactivity && clock() >= deadline),
            onCandidate: route => { pending = route.slice(); stats.orders++; convert(route); },
            onProgress: s => { stats.pointEvaluations = s.evaluations; stats.restarts = s.restarts;
              phase = `Points : ${s.phase.toLowerCase()}`; emit(); } });
          pending = result.route;
        } catch (error) { if (error.message !== "POINT_SEARCH_TIMEOUT") throw error; }
      }
      beginSearch();
      convert(pending, true);
      // Refine the section interfaces without returning to unrestricted diagonal permutations.
      let round = 0;
      while (true) {
        while ((elite.length || stopAfterInactivity) && clock() < deadline && metrics.score > lowerBound + epsilon && editable) {
          const entry = elite[round % elite.length] || { route: pending, boundaries: [], sections: [] }, boundaries = new Set(entry.boundaries);
          if (round % 2) {
            const splittable = entry.sections.filter(s => !s.upperOnly && s.cells.length > 1).sort((a, b) => b.cells.length - a.cells.length);
            const section = splittable[Math.floor(round / 2) % Math.max(1, splittable.length)];
            if (section) boundaries.add(section.start + Math.floor(section.cells.length / 2));
          }
          stats.refinements++; stage = "sections"; phase = "Affinement des entrees et sorties";
          convert(entry.route, true, ++round, boundaries);
        }
        // A final orientation gain must receive a full new inactivity interval.
        const improved = keep(model.orient(best, threshold, constraints, true));
        if (!stopAfterInactivity || !improved) break;
      }
      if (metrics.score <= lowerBound + epsilon) reason = "lower-bound";
      else if (!editable) reason = "locked";
      stage = "complete"; phase = reason === "lower-bound" ? "Borne minimale atteinte" : "Sous-sections : recherche terminee";
      changed = true; emit(true);
      const finished = clock();
      return { method: "point-sections", stage, phase, path: best, metrics, initialMetrics, improvements,
        attempts: stats.pointEvaluations + stats.trials + stats.connections, restarts: stats.restarts,
        sectionSearch: { ...stats }, elapsedMs: finished - started, totalLimitMs, reason, ...timing(finished) };
    }
    return { splitSections, sectionVariants, combineSections, decode, optimizePath, unpack };
  }
  function workerMain(createModel, createPoints, createBuilder, createOptimizer) {
    self.onmessage = event => {
      const options = event.data; if (options.type !== "start") return;
      try {
        const result = createOptimizer(createModel(), createPoints, createBuilder).optimizePath(options,
          snapshot => self.postMessage({ ...snapshot, type: "progress", runId: options.runId }));
        self.postMessage({ ...result, type: "complete", runId: options.runId });
      } catch (error) { self.postMessage({ type: "error", runId: options.runId, message: error.message }); }
    };
  }
  root.createSectionOptimizerWorker = () => {
    const source = `(${workerMain.toString()})(${root.createStitchModel.toString()},${root.createPointOrderSearch.toString()},${root.createOrthogonalPathBuilder.toString()},${createSectionOptimizer.toString()});`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url); URL.revokeObjectURL(url); return worker;
  };
  if (typeof module !== "undefined") module.exports = { createSectionOptimizer };
})(typeof window === "undefined" ? globalThis : window);
