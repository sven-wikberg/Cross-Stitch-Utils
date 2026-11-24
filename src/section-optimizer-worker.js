(function (root) {
  "use strict";
  function createSectionOptimizer(model, createBuilder, clock = () => performance.now()) {
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
        // A local window may contain only one half of a cross. Never recreate the other half.
        if (options.allowedActions) {
          sequence = sequence.filter(p => options.allowedActions.has(model.key(p)))
            .map(p => model.copy(options.allowedActions.get(model.key(p))));
          unit = false;
        }
        if (!sequence.length) return;
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
      if (options.next) scores = scores.map((score, i) => score + model.cost(previous[i].last, options.next, threshold, true));
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
    function decodeWindow(path, from, to, options = {}, pulse = () => {}) {
      const locked = prefixFor(options.constraints || {}).length;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < locked || to > path.length || from >= to) return null;
      const original = path.slice(from, to), allowedActions = new Map(original.map(p => [model.key(p), p]));
      const seen = new Set(), order = [];
      for (const p of original) if (!seen.has(model.cellKey(p))) { seen.add(model.cellKey(p)); order.push(p); }
      if (options.reverse) order.reverse();
      const { sections } = splitSections(order), layers = [], deadline = options.deadline ?? Infinity;
      const threshold = options.cutThreshold || 10, prefix = from ? [path[from - 1]] : [], next = path[to];
      let tested = 0, variants = 0;
      for (let i = 0; i < sections.length; i++) {
        if (clock() >= deadline) return null;
        const nearby = section => section ? [section.cells[0], section.cells.at(-1)] : [];
        const result = sectionVariants(sections[i], { ...options, allowedActions,
          previous: i ? nearby(sections[i - 1]) : prefix, next: i + 1 < sections.length ? nearby(sections[i + 1]) : next ? [next] : [] });
        if (!result.complete || !result.variants.length) return null;
        layers.push(result.variants); tested += result.tested; variants += result.variants.length;
        pulse({ prepared: i + 1, total: sections.length, tested, variants, connections: 0 });
      }
      // Both outside actions keep their exact directions and cut flags.
      const result = combineSections(layers, prefix, threshold, { deadline, next,
        pulse: s => pulse({ ...s, tested, variants }) });
      if (!result || clock() >= deadline) return null;
      const oldScore = measure(path.slice(Math.max(0, from - 1), Math.min(path.length, to + 1)), threshold).score;
      return { ...result, path: result.path.slice(prefix.length), from, to, oldScore, gain: oldScore - result.score,
        sections: sections.length, tested, variants };
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
      const lowerBound = Math.max(0, cells.length * 2 - 1);
      const stats = { completed: 0, sections: 0, prepared: 0, variants: 0, connections: 0, trials: 0,
        refinements: 0, windows: 0, windowSize: 0, from: 0, to: 0, linkIndex: 0, linkTotal: 0, passes: 0, accepted: 0 };
      let best = null, metrics = null, initialMetrics = null, improvements = 0, changed = false;
      let stage = "prepare", phase = "Retouches locales : preparation", lastReport = -Infinity, reason = stopAfterInactivity ? "inactivity" : "budget";
      const valid = path => path && path.length === cells.length * 2 && !model.validateRoute(path, cells) && model.satisfiesConstraints(path, constraints);
      function emit(force = false) {
        const now = clock(); if (!force && now - lastReport < 250) return;
        lastReport = now;
        report({ method: "point-sections", stage, phase, elapsedMs: now - started, totalLimitMs, metrics, initialMetrics,
          improvements, attempts: stats.trials + stats.connections, restarts: Math.max(0, stats.passes - 1),
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
        stage = "sections"; phase = "Retouches locales : recherche"; emit(true);
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
      emit(true);
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
      const editable = prefix.length < best.length;
      function rankLinks() {
        const links = [];
        for (let at = Math.max(1, prefix.length); at < best.length; at++) {
          const cost = model.cost(best[at - 1], best[at], threshold, true);
          if (cost > 1 + epsilon) links.push({ at, cost });
        }
        return links.sort((a, b) => b.cost - a.cost || a.at - b.at);
      }
      let links = rankLinks();
      beginSearch();
      while (true) {
        while (clock() < deadline && metrics.score > lowerBound + epsilon && editable && links.length) {
          const round = stats.passes++;
          stats.linkTotal = links.length;
          for (const size of [16, 32, 64, 128]) {
            const visited = new Set();
            for (let link = 0; link < links.length && clock() < deadline && metrics.score > lowerBound + epsilon; link++) {
              const offset = [0.5, 1 / 3, 2 / 3][round % 3];
              const from = Math.max(prefix.length, links[link].at - Math.floor(size * offset));
              const to = Math.min(best.length, from + size), key = `${from}:${to}`;
              if (visited.has(key)) continue;
              visited.add(key); stats.linkIndex = link + 1;
              stats.windowSize = to - from; stats.from = from; stats.to = to;
              for (const reverse of [false, true]) {
                if (clock() >= deadline || metrics.score <= lowerBound + epsilon) break;
                stats.windows++; stats.refinements++; stats.sections = 0; stats.prepared = 0;
                stage = "sections";
                phase = `Retouches locales : liaison ${link + 1} / ${links.length} - ${to - from} diagonales`;
                const trialsBefore = stats.trials, connectionsBefore = stats.connections;
                const result = decodeWindow(best, from, to, { constraints, cutThreshold: threshold, deadline,
                  reverse, round: Math.floor(round / 3), breadth: round ? 4 : 3 }, s => {
                  stats.sections = s.total; stats.prepared = s.prepared; stats.variants = s.variants;
                  stats.trials = trialsBefore + s.tested; stats.connections = connectionsBefore + s.connections;
                  emit();
                });
                if (result) {
                  stats.completed++;
                  if (result.gain > epsilon) {
                    const candidate = best.slice(0, from).concat(result.path, best.slice(to));
                    if (keep(candidate)) stats.accepted++;
                  }
                }
                emit();
              }
            }
          }
          links = rankLinks();
        }
        // Preserve the common final direction pass and restart inactivity only for a real global gain.
        phase = "Verification finale des sens"; emit();
        const improved = keep(model.orient(best, threshold, constraints, true));
        if (!stopAfterInactivity || !improved) break;
        links = rankLinks();
      }
      if (metrics.score <= lowerBound + epsilon) reason = "lower-bound";
      else if (!editable) reason = "locked";
      else if (!links.length) reason = "no-links";
      stage = "complete"; phase = reason === "lower-bound" ? "Borne minimale atteinte" : "Retouches locales : recherche terminee";
      changed = true; emit(true);
      const finished = clock();
      return { method: "point-sections", stage, phase, path: best, metrics, initialMetrics, improvements,
        attempts: stats.trials + stats.connections, restarts: Math.max(0, stats.passes - 1),
        sectionSearch: { ...stats }, elapsedMs: finished - started, totalLimitMs, reason, ...timing(finished) };
    }
    return { splitSections, sectionVariants, combineSections, decode, decodeWindow, optimizePath, unpack };
  }
  function workerMain(createModel, createBuilder, createOptimizer) {
    self.onmessage = event => {
      const options = event.data; if (options.type !== "start") return;
      try {
        const result = createOptimizer(createModel(), createBuilder).optimizePath(options,
          snapshot => self.postMessage({ ...snapshot, type: "progress", runId: options.runId }));
        self.postMessage({ ...result, type: "complete", runId: options.runId });
      } catch (error) { self.postMessage({ type: "error", runId: options.runId, message: error.message }); }
    };
  }
  root.createSectionOptimizerWorker = () => {
    const source = `(${workerMain.toString()})(${root.createStitchModel.toString()},${root.createOrthogonalPathBuilder.toString()},${createSectionOptimizer.toString()});`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url); URL.revokeObjectURL(url); return worker;
  };
  if (typeof module !== "undefined") module.exports = { createSectionOptimizer };
})(typeof window === "undefined" ? globalThis : window);
