(function (root) {
  "use strict";
  function createPointsDiagonalOptimizer(model, createPoints, createBuilder, createRelay, createAdaptive,
    clock = () => performance.now(), random = Math.random) {
    const epsilon = 1e-8;
    const repairs = createAdaptive(model, createBuilder, createRelay, clock, random);
    const measure = (path, threshold) => model.metrics(path, threshold, true);
    function decoderContext(order, constraints = {}) {
      const byKey = new Map(order.map((cell, i) => [model.cellKey(cell), i]));
      if (byKey.size !== order.length) throw new Error("Ordre de cases duplique.");
      const prefix = (constraints.lockedPrefix?.length ? constraints.lockedPrefix : constraints.start ? [constraints.start] : []).map(model.copy);
      const error = model.validateRoute(prefix, order, false);
      if (error || !model.satisfiesConstraints(prefix, { ...constraints, forcedCuts: [] })) throw new Error(error || "Prefixe incompatible.");
      const lower = new Set(), upper = new Set();
      prefix.forEach(p => (p.diagonal === "lower" ? lower : upper).add(model.cellKey(p)));
      const opened = prefix.filter(p => p.diagonal === "lower" && !upper.has(model.cellKey(p))).map(p => byKey.get(model.cellKey(p)));
      const remaining = order.map((_, i) => i).filter(i => !lower.has(model.cellKey(order[i])));
      const cutKeys = new Set([...(constraints.forcedCuts || []), ...prefix.filter(p => p.cutBefore)].map(model.key));
      const action = (id, diagonal, direction = 1) => ({ x: order[id].x, y: order[id].y, diagonal, direction,
        ...(cutKeys.has(`${model.cellKey(order[id])}:${diagonal}`) ? { cutBefore: true } : {}) });
      return { prefix, opened, remaining, action };
    }
    function simpleDecode(order, threshold = 10, constraints = {}, returns = true) {
      const { prefix, opened, remaining, action } = decoderContext(order, constraints), path = prefix.slice(), stack = opened.slice();
      const orthogonal = (a, b) => Math.abs(order[a].x - order[b].x) + Math.abs(order[a].y - order[b].y) === 1;
      const diagonal = (a, b) => Math.abs(order[a].x - order[b].x) === 1 && Math.abs(order[a].y - order[b].y) === 1;
      for (const id of remaining) {
        while (stack.length && (!returns || !orthogonal(stack.at(-1), id))) {
          const closed = stack.pop(); path.push(action(closed, "upper"));
          if (returns && diagonal(closed, id)) break;
        }
        path.push(action(id, "lower")); stack.push(id);
      }
      while (stack.length) path.push(action(stack.pop(), "upper"));
      return model.orient(path, threshold, constraints, true);
    }
    // Beam decoding chooses between opening the next cross and returning to an open cross.
    // Persistent stacks/history avoid copying an ever-growing path at every diagonal.
    function beamDecode(order, options = {}, pulse = () => {}) {
      const threshold = options.cutThreshold || 10, constraints = options.constraints || {};
      const deadline = options.deadline ?? Infinity, width = Math.max(1, Math.min(64, options.beamWidth || 8));
      const { prefix, opened, remaining, action } = decoderContext(order, constraints);
      let nextStackId = 1;
      const stacks = new Map(), empty = { id: 0, count: 0 };
      const push = (stack, cell) => {
        const key = `${stack.id}:${cell}`;
        if (!stacks.has(key)) stacks.set(key, { id: nextStackId++, count: stack.count + 1, cell, parent: stack });
        return stacks.get(key);
      };
      let stack = empty;
      opened.forEach(id => { stack = push(stack, id); });
      let states = [{ next: 0, stack, cost: measure(prefix, threshold).score, last: prefix.at(-1), history: null }];
      const count = order.length * 2 - prefix.length;
      for (let step = 0; step < count; step++) {
        if (step % 64 === 0) { pulse(step, count); if (clock() >= deadline) return null; }
        const candidates = new Map();
        for (const state of states) {
          const choices = [];
          if (state.next < remaining.length) {
            const id = remaining[state.next];
            choices.push({ id, diagonal: "lower", next: state.next + 1, stack: push(state.stack, id) });
          }
          if (state.stack.count) choices.push({ id: state.stack.cell, diagonal: "upper", next: state.next, stack: state.stack.parent });
          for (const choice of choices) for (const direction of [1, -1]) {
            const point = action(choice.id, choice.diagonal, direction), cost = state.cost + model.cost(state.last, point, threshold, true);
            if (!Number.isFinite(cost)) continue;
            const key = `${choice.next}:${choice.stack.id}:${choice.id}:${choice.diagonal}:${direction}`;
            const previous = candidates.get(key);
            if (!previous || cost < previous.cost) candidates.set(key, { next: choice.next, stack: choice.stack, cost,
              last: point, history: state.history });
          }
        }
        states = [...candidates.values()].sort((a, b) => a.cost - b.cost || b.next - a.next).slice(0, width);
        if (!states.length) return null;
        states.forEach(state => { state.history = { point: state.last, previous: state.history }; });
      }
      const suffix = [];
      for (let node = states[0].history; node; node = node.previous) suffix.push(node.point);
      suffix.reverse();
      return model.orient(prefix.concat(suffix), threshold, constraints, true);
    }
    function optimizePath(options, report = () => {}) {
      const cells = options.points || [], threshold = options.cutThreshold || 10;
      const constraints = { ...(options.constraints || {}), forcedCuts: [
        ...(options.constraints?.forcedCuts || []), ...(options.initialPath || []).filter(p => p.cutBefore)
      ] };
      const started = clock(), totalLimitMs = Math.max(1, options.totalLimitMs || 3600000), deadline = started + totalLimitMs;
      const pointDeadline = started + totalLimitMs * 0.65, lowerBound = Math.max(0, cells.length * 2 - 1);
      const editable = cells.length * 2 > Math.max(constraints.lockedPrefix?.length || 0, Number(Boolean(constraints.start))) + 1;
      const stats = { orders: 0, conversions: 0, diagonalTrials: 0, refinements: 0, restarts: 0, pointEvaluations: 0, refinementAttempts: 0 };
      let best = null, metrics = null, initialMetrics = null, improvements = 0, changed = false, lastReport = -Infinity;
      let stage = "points", phase = "Points : preparation", reason = "budget", relayChange = null;
      function valid(path) { return path && path.length === cells.length * 2 && !model.validateRoute(path, cells) && model.satisfiesConstraints(path, constraints); }
      function emit(force = false) {
        const now = clock(); if (!force && now - lastReport < 250) return;
        lastReport = now;
        report({ method: "points-diagonals", stage, phase, elapsedMs: now - started, totalLimitMs, metrics, initialMetrics,
          improvements, attempts: stats.pointEvaluations + stats.refinementAttempts, restarts: stats.restarts,
          pointsSearch: { ...stats }, relayChange, progress: Math.min(100, (now - started) / totalLimitMs * 100), reason,
          ...(best && changed ? { path: best.map(model.copy) } : {}) });
        changed = false;
      }
      function keep(path, change = null) {
        if (!valid(path)) return false;
        const value = measure(path, threshold); initialMetrics ||= value;
        if (best && value.score >= metrics.score - epsilon) return false;
        if (best) improvements++;
        best = path.map(model.copy); metrics = value; changed = true; relayChange = change; emit(true); return true;
      }
      const byKey = new Map(cells.map((p, i) => [model.cellKey(p), i])), seen = new Set();
      if (byKey.size !== cells.length) throw new Error("Cases dupliquees.");
      const initialOrder = [];
      for (const p of options.initialPath || []) {
        const id = byKey.get(model.cellKey(p));
        if (id !== undefined && !seen.has(id)) { seen.add(id); initialOrder.push(id); }
      }
      cells.forEach((_, id) => { if (!seen.has(id)) initialOrder.push(id); });
      emit(true);
      if (valid(options.initialPath)) keep(options.initialPath);
      if (!best) keep(simpleDecode(initialOrder.map(i => cells[i]), threshold, constraints));
      if (!best) throw new Error("Impossible de construire un parcours compatible.");
      const converted = new Set(); let lastConversion = -Infinity, pending = null;
      function convert(route, force = false) {
        pending = route.slice(); stats.orders++;
        if (!editable || metrics.score <= lowerBound + epsilon || clock() >= deadline) return;
        if (!force && clock() - lastConversion < Math.max(200, cells.length / 10)) return;
        const key = route.join(",");
        if (converted.has(key)) return;
        if (route.length !== cells.length || new Set(route).size !== cells.length || route.some(i => !Number.isInteger(i) || !cells[i])) throw new Error("Ordre de cases invalide.");
        converted.add(key); if (converted.size > 16) converted.delete(converted.values().next().value);
        const order = route.map(i => cells[i]), previousPhase = phase; phase = "Conversion : demi-croix et retours"; stats.conversions++; emit();
        for (const returns of [true, false]) {
          if (clock() >= deadline) break;
          stats.diagonalTrials++; keep(simpleDecode(order, threshold, constraints, returns));
        }
        const decoderDeadline = Math.min(deadline, clock() + Math.max(250, Math.min(5000, totalLimitMs * 0.1)));
        const path = beamDecode(order, { cutThreshold: threshold, constraints, deadline: decoderDeadline, beamWidth: 8 }, () => emit());
        if (path) { stats.diagonalTrials++; keep(path); }
        lastConversion = clock(); phase = previousPhase; emit();
      }
      convert(initialOrder, true);
      if (editable && clock() < pointDeadline && metrics.score > lowerBound + epsilon) {
        try {
          const result = createPoints(clock, random).optimizePath({ points: cells, initialPath: initialOrder.map(i => cells[i]), cutThreshold: threshold,
            totalLimitMs: Math.max(1, pointDeadline - clock()), stagnationLimitMs: totalLimitMs,
            shouldStop: () => metrics.score <= lowerBound + epsilon,
            onCandidate: route => convert(route),
            onProgress: snapshot => {
              stats.pointEvaluations = snapshot.evaluations; stats.restarts = snapshot.restarts;
              phase = `Points : ${snapshot.phase.toLowerCase()}`; emit();
            } });
          pending = result.route;
        } catch (error) { if (error.message !== "POINT_SEARCH_TIMEOUT") throw error; }
      }
      if (pending && clock() < deadline) convert(pending, true);
      stage = "diagonals"; phase = "Diagonales : reinsertion libre"; emit(true);
      let iteration = 0, state = null;
      while (clock() < deadline && metrics.score > lowerBound + epsilon && best.length > Math.max(constraints.lockedPrefix?.length || 0, Number(Boolean(constraints.start))) + 1) {
        iteration++;
        if (clock() >= deadline || metrics.score <= lowerBound + epsilon) break;
        if (!state || state.path !== best) state = repairs.context(best, threshold, constraints);
        const size = Math.min(24, 6 + iteration % 10 * 2), selected = repairs.select(state, iteration % 4, size);
        if (!selected.length) break;
        phase = iteration % 3 ? "Diagonales : reinsertion libre" : "Diagonales : reparation exacte";
        stats.refinements++; emit();
        const localDeadline = Math.min(deadline, clock() + 1000);
        const proposal = iteration % 3 ? repairs.freeRepair(state, selected, { deadline: localDeadline, regret: true, pulse: emit })
          : repairs.exactRepair(state, Math.max(state.locked, Math.min(best.length - 12, selected[0] - 6)), 12, localDeadline, emit);
        stats.refinementAttempts += proposal.attempts;
        if (proposal.path) keep(proposal.path);
      }
      keep(model.orient(best, threshold, constraints, true));
      if (metrics.score <= lowerBound + epsilon) reason = "lower-bound";
      else if (best.length <= Math.max(constraints.lockedPrefix?.length || 0, Number(Boolean(constraints.start))) + 1) reason = "locked";
      stage = "complete"; phase = reason === "lower-bound" ? "Borne minimale atteinte" : "Points puis diagonales : recherche terminee"; changed = true; emit(true);
      return { method: "points-diagonals", stage, phase, path: best, metrics, initialMetrics, improvements,
        attempts: stats.pointEvaluations + stats.refinementAttempts, restarts: stats.restarts, pointsSearch: { ...stats }, relayChange,
        elapsedMs: clock() - started, totalLimitMs, reason, progress: 100 };
    }
    return { optimizePath, simpleDecode, beamDecode };
  }
  function workerMain(createModel, createPoints, createBuilder, createRelay, createAdaptive, createOptimizer) {
    self.onmessage = event => {
      const options = event.data; if (options.type !== "start") return;
      try {
        const result = createOptimizer(createModel(), createPoints, createBuilder, createRelay, createAdaptive).optimizePath(options,
          snapshot => self.postMessage({ ...snapshot, type: "progress", runId: options.runId }));
        self.postMessage({ ...result, type: "complete", runId: options.runId });
      } catch (error) { self.postMessage({ type: "error", runId: options.runId, message: error.message }); }
    };
  }
  root.createPointsDiagonalWorker = () => {
    const source = `(${workerMain.toString()})(${root.createStitchModel.toString()},${root.createPointOrderSearch.toString()},${root.createOrthogonalPathBuilder.toString()},${root.createRelaySearch.toString()},${root.createAdaptiveOptimizer.toString()},${createPointsDiagonalOptimizer.toString()});`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url); URL.revokeObjectURL(url); return worker;
  };
  if (typeof module !== "undefined") module.exports = { createPointsDiagonalOptimizer };
})(typeof window === "undefined" ? globalThis : window);
