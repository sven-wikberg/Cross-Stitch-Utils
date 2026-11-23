(function (root) {
  "use strict";
  const phases = { normal: "Blocs", sections: "Moteur 4 : sous-sections", chains: "Moteur 6 : chaines", relay: "Relais" };
  const EPSILON = 1e-8;

  function normalize(saved = {}) {
    const pending = [...new Set((Array.isArray(saved?.pending) ? saved.pending : []).filter(dmc => typeof dmc === "string"))];
    const results = (Array.isArray(saved?.results) ? saved.results : []).filter(result => result && typeof result.dmc === "string" && !pending.includes(result.dmc));
    const current = saved?.current;
    const valid = current && current.dmc === pending[0] && Object.hasOwn(phases, current.phase)
      && (!(current.phase === "chains" || current.phase === "relay")
        || (Number.isInteger(current.cycle) && current.cycle > 0 && Number.isFinite(current.cycleStartScore)));
    return { pending, results, current: valid ? { ...current } : null };
  }

  function prepare(saved, score) {
    const plan = normalize(saved);
    if (!plan.pending.length) return plan;
    if (!plan.current) plan.current = {
      dmc: plan.pending[0], phase: "normal", cycle: 0,
      initial: Number.isFinite(score) ? score : null, cycleStartScore: null
    };
    return plan;
  }

  function matches(plan, job) {
    return Boolean(job && plan.current && plan.pending[0] === job.dmc
      && plan.current.dmc === job.dmc && plan.current.phase === job.phase && plan.current.cycle === job.cycle);
  }

  function complete(saved, job, metrics) {
    const plan = normalize(saved);
    if (!matches(plan, job) || !Number.isFinite(metrics.score)) return plan;
    const current = plan.current;
    if (!Number.isFinite(current.initial)) current.initial = Number.isFinite(metrics.initial) ? metrics.initial : metrics.score;
    if (!metrics.empty && current.phase === "normal") current.phase = "sections";
    else if (!metrics.empty && current.phase === "sections") {
      current.phase = "chains"; current.cycle = 1; current.cycleStartScore = metrics.score;
    } else if (!metrics.empty && current.phase === "chains") current.phase = "relay";
    else if (!metrics.empty && current.cycleStartScore - metrics.score > EPSILON) {
      current.phase = "chains"; current.cycle++; current.cycleStartScore = metrics.score;
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
    if (!plan.pending.length) return `${total} couleurs terminees${plan.results.every(result => Number.isInteger(result.cycles)) ? " - cycle moteur 6 + relais sans gain" : ""}`;
    const current = plan.current;
    const phase = current ? `${phases[current.phase]}${current.cycle ? ` - cycle ${current.cycle}` : ""}` : "Blocs";
    return `Couleur ${plan.results.length + 1} / ${total} - DMC ${plan.pending[0]} - ${phase}${running ? "" : " - en pause"}`;
  }

  const api = { normalize, prepare, matches, complete, status };
  root.PathBatchPlan = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
