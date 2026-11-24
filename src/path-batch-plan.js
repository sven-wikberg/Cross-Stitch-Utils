(function (root) {
  "use strict";
  const phases = { normal: "Moteur 1 : blocs", segments: "Moteur 2 : raccordements",
    points: "Moteur 3 : points puis diagonales", sections: "Moteur 4 : sous-sections",
    adaptive: "Moteur 5 : recherche adaptative", chains: "Boucle 1 : chaines", relay: "Boucle 2 : relais" };
  const order = Object.keys(phases);
  const EPSILON = 1e-8;
  const isLoop = phase => phase === "chains" || phase === "relay";

  function normalize(saved = {}) {
    const pending = [...new Set((Array.isArray(saved?.pending) ? saved.pending : []).filter(dmc => typeof dmc === "string"))];
    const results = (Array.isArray(saved?.results) ? saved.results : []).filter(result => result && typeof result.dmc === "string" && !pending.includes(result.dmc));
    const current = saved?.current;
    const valid = current && current.dmc === pending[0] && Object.hasOwn(phases, current.phase)
      && Number.isInteger(current.cycle) && current.cycle > 0 && Number.isInteger(current.pass) && current.pass > 0
      && [current.initial, current.cycleStartScore, current.phaseStartScore].every(score => score === null || Number.isFinite(score));
    let normalizedCurrent = null;
    if (valid && [2, 3, 4].includes(saved.version)) {
      const candidate = { ...current };
      if (saved.version === 2) {
        candidate.loopRound = isLoop(candidate.phase) ? 1 : 0;
        candidate.loopStartScore = isLoop(candidate.phase) ? candidate.phaseStartScore : null;
        // Old plans did not track the pair baseline; resume them with a full pair.
        if (isLoop(candidate.phase)) { candidate.phase = "chains"; candidate.pass = 1; }
      }
      // Resume an old engine sequence from the best path without skipping reordered engines.
      if (saved.version < 4 && !isLoop(candidate.phase)) {
        candidate.phase = "normal"; candidate.pass = 1;
        candidate.loopRound = 0; candidate.loopStartScore = null;
        candidate.phaseStartScore = candidate.cycleStartScore;
      }
      if (isLoop(candidate.phase)
        ? Number.isInteger(candidate.loopRound) && candidate.loopRound > 0
          && (candidate.loopStartScore === null || Number.isFinite(candidate.loopStartScore))
        : candidate.loopRound === 0 && candidate.loopStartScore === null) normalizedCurrent = candidate;
    }
    return { version: 4, scope: saved?.scope === "color" ? "color" : "all", pending, results, current: normalizedCurrent };
  }

  function prepare(saved, score) {
    const plan = normalize(saved);
    if (!plan.pending.length) return plan;
    if (!plan.current) plan.current = {
      dmc: plan.pending[0], phase: "normal", cycle: 1, pass: 1, loopRound: 0, loopStartScore: null,
      initial: Number.isFinite(score) ? score : null,
      cycleStartScore: Number.isFinite(score) ? score : null, phaseStartScore: Number.isFinite(score) ? score : null
    };
    return plan;
  }

  function matches(plan, job) {
    return Boolean(job && plan.current && plan.pending[0] === job.dmc
      && plan.current.dmc === job.dmc && plan.current.phase === job.phase && plan.current.cycle === job.cycle
      && plan.current.pass === job.pass && plan.current.loopRound === job.loopRound);
  }

  function complete(saved, job, metrics) {
    const plan = normalize(saved);
    if (!matches(plan, job) || !Number.isFinite(metrics.score)) return plan;
    const current = plan.current;
    if (!Number.isFinite(current.initial)) current.initial = Number.isFinite(metrics.initial) ? metrics.initial : metrics.score;
    if (!Number.isFinite(current.cycleStartScore)) current.cycleStartScore = current.initial;
    if (!Number.isFinite(current.phaseStartScore)) current.phaseStartScore = current.initial;
    if (isLoop(current.phase) && !Number.isFinite(current.loopStartScore)) current.loopStartScore = current.phaseStartScore;
    if (!metrics.empty && isLoop(current.phase) && !metrics.stable && current.phaseStartScore - metrics.score > EPSILON) {
      current.pass++;
      current.phaseStartScore = metrics.score;
    } else if (!metrics.empty && current.phase !== "relay") {
      current.phase = order[order.indexOf(current.phase) + 1];
      current.pass = 1;
      current.phaseStartScore = metrics.score;
      if (current.phase === "chains") { current.loopRound = 1; current.loopStartScore = metrics.score; }
    } else if (!metrics.empty && current.loopStartScore - metrics.score > EPSILON) {
      current.phase = "chains"; current.loopRound++; current.pass = 1;
      current.loopStartScore = metrics.score; current.phaseStartScore = metrics.score;
    } else if (!metrics.empty && current.cycleStartScore - metrics.score > EPSILON) {
      current.phase = "normal"; current.cycle++; current.pass = 1;
      current.loopRound = 0; current.loopStartScore = null;
      current.cycleStartScore = metrics.score; current.phaseStartScore = metrics.score;
    } else {
      plan.pending.shift();
      plan.results = plan.results.filter(result => result.dmc !== current.dmc);
      plan.results.push({ dmc: current.dmc, initial: current.initial, score: metrics.score,
        cuts: metrics.cuts, cycles: current.cycle });
      plan.current = null;
    }
    return plan;
  }

  function status(saved, running) {
    const plan = normalize(saved), total = plan.pending.length + plan.results.length;
    if (!total) return "";
    if (!plan.pending.length) return `${total === 1 ? "1 couleur terminee" : `${total} couleurs terminees`}${plan.results.every(result => Number.isInteger(result.cycles)) ? " - cycle complet sans gain" : ""}`;
    const current = plan.current;
    const phase = current ? `cycle ${current.cycle} - ${isLoop(current.phase) ? `duo ${current.loopRound} - ` : ""}${phases[current.phase]}${isLoop(current.phase) ? ` - passe ${current.pass}` : ""}` : phases.normal;
    return `${plan.scope === "color" ? "" : `Couleur ${plan.results.length + 1} / ${total} - `}DMC ${plan.pending[0]} - ${phase}${running ? "" : " - en pause"}`;
  }

  const api = { normalize, prepare, matches, complete, status };
  root.PathBatchPlan = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
