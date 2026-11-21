(function (root) {
  "use strict";
  function createRelayOptimizer(model, createBuilder, createRelay, clock = () => performance.now()) {
    const search = createRelay(model, createBuilder(model, clock), clock), epsilon = 1e-8;
    function optimizePath(options, report = () => {}) {
      const points = options.points || [], threshold = options.cutThreshold || 10;
      const constraints = { ...(options.constraints || {}), forcedCuts: [
        ...(options.constraints?.forcedCuts || []), ...(options.initialPath || []).filter(p => p.cutBefore)
      ] };
      const valid = path => Array.isArray(path) && !model.validateRoute(path, points) && model.satisfiesConstraints(path, constraints);
      if (!valid(options.initialPath)) throw new Error("Les relais necessitent un chemin complet et valide.");
      const started = clock(), budget = options.maxDurationMs ?? Infinity;
      const deadline = started + Math.max(0, budget);
      let best = options.initialPath.map(model.copy), metrics = model.metrics(best, threshold, true);
      const initialMetrics = metrics;
      let stage = "relay", phase = "Preparation des relais", relay = null, relayPasses = 0, relayAttempts = 0, improvements = 0;
      let lastReport = -Infinity, changed = true, relayChange = null, lastRelayImprovement = null, reason = "exhausted";
      function emit(force = false) {
        const now = clock(); if (!force && now - lastReport < 150) return;
        lastReport = now;
        report({ method: "relay-optimization", stage, phase, metrics, initialMetrics, elapsedMs: now - started,
          attempts: relayAttempts, improvements, restarts: 0, relay, relayPasses, relayAttempts,
          relayImprovements: improvements, relayChange, lastRelayImprovement,
          progress: stage === "complete" ? 100 : relay?.total ? 100 * relay.examined / relay.total : 0,
          ...(changed ? { path: best.map(model.copy) } : {}) });
        changed = false;
      }
      emit(true);
      while (clock() < deadline) {
        relayPasses++; relay = { examined: 0, total: 0, attempts: 0, candidateCount: 0, candidatesExamined: 0 };
        phase = `Recherche de relais : passe ${relayPasses}`; emit(true);
        let improved = false;
        const attemptsBefore = relayAttempts;
        for (const candidate of search.bestCandidates({ path: best, constraints, cutThreshold: threshold,
          budgetMs: deadline === Infinity ? Infinity : Math.max(1, deadline - clock()) }, progress => {
          relay = progress; relayAttempts = attemptsBefore + progress.attempts; emit();
        })) {
          if (clock() >= deadline) { reason = "time-limit"; break; }
          if (candidate.score >= metrics.score - epsilon) continue;
          const route = candidate.materialize();
          if (!route || !valid(route.path)) continue;
          const next = model.metrics(route.path, threshold, true);
          if (next.score >= metrics.score - epsilon) continue;
          relayChange = candidate.moved.map(i => model.key(best[i]));
          lastRelayImprovement = { ...candidate.relayLink, pass: relayPasses };
          best = route.path.map(model.copy); metrics = next; improvements++; improved = true; changed = true; emit(true);
          // Rebuild neighbors and scores against the accepted route, never against stale indices.
          break;
        }
        if (!improved) { if (relay?.timedOut) reason = "time-limit"; break; }
      }
      if (clock() >= deadline) reason = "time-limit";
      stage = "complete"; phase = reason === "time-limit" ? "Relais interrompus, meilleur parcours conserve" : "Relais termines : aucune amelioration restante";
      changed = true; emit(true);
      return { method: "relay-optimization", stage, phase, path: best, metrics, initialMetrics, elapsedMs: clock() - started,
        attempts: relayAttempts, improvements, restarts: 0, relay, relayPasses, relayAttempts,
        relayImprovements: improvements, relayChange, lastRelayImprovement, reason, progress: 100 };
    }
    return { optimizePath };
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
  root.createRelayOptimizerWorker = () => {
    const source = `(${workerMain.toString()})(${root.createStitchModel.toString()},${root.createOrthogonalPathBuilder.toString()},${root.createRelaySearch.toString()},${createRelayOptimizer.toString()});`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url); URL.revokeObjectURL(url); return worker;
  };
  if (typeof module !== "undefined") module.exports = { createRelayOptimizer };
})(typeof window === "undefined" ? globalThis : window);
