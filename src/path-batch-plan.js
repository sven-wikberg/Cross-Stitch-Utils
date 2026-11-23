(function (root) {
  "use strict";
  const phases = { normal: "Moteur 1 : blocs", adaptive: "Moteur 2 : recherche adaptative",
    points: "Moteur 3 : points puis diagonales", sections: "Moteur 4 : sous-sections",
    segments: "Moteur 5 : raccordements", chains: "Boucle 1 : chaines", relay: "Boucle 2 : relais" };
  const order = Object.keys(phases);
  const EPSILON = 1e-8;

  function normalize(saved = {}) {
    const pending = [...new Set((Array.isArray(saved?.pending) ? saved.pending : []).filter(dmc => typeof dmc === "string"))];
    const results = (Array.isArray(saved?.results) ? saved.results : []).filter(result => result && typeof result.dmc === "string" && !pending.includes(result.dmc));
    const current = saved?.current;
    const valid = saved?.version === 2 && current && current.dmc === pending[0] && Object.hasOwn(phases, current.phase)
      && Number.isInteger(current.cycle) && current.cycle > 0 && Number.isInteger(current.pass) && current.pass > 0
      && [current.initial, current.cycleStartScore, current.phaseStartScore].every(score => score === null || Number.isFinite(score));
    return { version: 2, scope: saved?.scope === "color" ? "color" : "all", pending, results, current: valid ? { ...current } : null };
  }

  function prepare(saved, score) {
    const plan = normalize(saved);
    if (!plan.pending.length) return plan;
    if (!plan.current) plan.current = {
      dmc: plan.pending[0], phase: "normal", cycle: 1, pass: 1,
      initial: Number.isFinite(score) ? score : null,
      cycleStartScore: Number.isFinite(score) ? score : null, phaseStartScore: Number.isFinite(score) ? score : null
    };
    return plan;
  }

  function matches(plan, job) {
    return Boolean(job && plan.current && plan.pending[0] === job.dmc
      && plan.current.dmc === job.dmc && plan.current.phase === job.phase && plan.current.cycle === job.cycle
      && plan.current.pass === job.pass);
  }

  function complete(saved, job, metrics) {
    const plan = normalize(saved);
    if (!matches(plan, job) || !Number.isFinite(metrics.score)) return plan;
    const current = plan.current;
    if (!Number.isFinite(current.initial)) current.initial = Number.isFinite(metrics.initial) ? metrics.initial : metrics.score;
    if (!Number.isFinite(current.cycleStartScore)) current.cycleStartScore = current.initial;
    if (!Number.isFinite(current.phaseStartScore)) current.phaseStartScore = current.initial;
    const isLoop = current.phase === "chains" || current.phase === "relay";
    if (!metrics.empty && isLoop && !metrics.stable && current.phaseStartScore - metrics.score > EPSILON) {
      current.pass++;
      current.phaseStartScore = metrics.score;
    } else if (!metrics.empty && current.phase !== "relay") {
      current.phase = order[order.indexOf(current.phase) + 1];
      current.pass = 1;
      current.phaseStartScore = metrics.score;
    } else if (!metrics.empty && current.cycleStartScore - metrics.score > EPSILON) {
      current.phase = "normal"; current.cycle++; current.pass = 1;
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
    const phase = current ? `cycle ${current.cycle} - ${phases[current.phase]}${current.phase === "chains" || current.phase === "relay" ? ` - passe ${current.pass}` : ""}` : phases.normal;
    return `${plan.scope === "color" ? "" : `Couleur ${plan.results.length + 1} / ${total} - `}DMC ${plan.pending[0]} - ${phase}${running ? "" : " - en pause"}`;
  }

  const api = { normalize, prepare, matches, complete, status };
  root.PathBatchPlan = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
