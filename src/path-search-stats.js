(function (root) {
  "use strict";
  const EPSILON = 1e-8, MAX_POINTS = 400;
  const modes = {
    normal: { short: "M1", label: "Moteur 1 : blocs", color: "#167d9a" },
    segments: { short: "M2", label: "Moteur 2 : raccordements", color: "#3465bd" },
    points: { short: "M3", label: "Moteur 3 : points", color: "#607d24" },
    sections: { short: "M4", label: "Moteur 4 : retouches locales", color: "#975299" },
    adaptive: { short: "M5", label: "Moteur 5 : adaptatif", color: "#ba4c22" },
    deep: { short: "M6", label: "Moteur 6 : approfondie", color: "#776328" },
    chains: { short: "B1", label: "Boucle 1 : chaines", color: "#b42f60" },
    relay: { short: "B2", label: "Boucle 2 : relais", color: "#008565" }
  };
  const finite = value => Number.isFinite(value) && value >= 0;
  const empty = () => ({ version: 1, baseline: null, score: null, elapsedMs: 0, totals: {}, history: [], truncated: false, active: null });

  function normalize(saved) {
    if (saved?.version !== 1 || !finite(saved.elapsedMs)) return empty();
    const result = empty();
    result.baseline = finite(saved.baseline) ? saved.baseline : null;
    result.score = finite(saved.score) ? saved.score : null;
    result.elapsedMs = saved.elapsedMs;
    for (const mode of Object.keys(modes)) {
      const total = saved.totals?.[mode];
      if (total && finite(total.gain) && finite(total.elapsedMs) && Number.isInteger(total.runs) && total.runs > 0)
        result.totals[mode] = { gain: total.gain, elapsedMs: total.elapsedMs, runs: total.runs };
    }
    const history = (Array.isArray(saved.history) ? saved.history : []).filter(point => point && finite(point.score)
      && finite(point.elapsed) && finite(point.gain) && (point.mode === null || Object.hasOwn(modes, point.mode)));
    result.history = history.slice(-MAX_POINTS).map(point => ({ elapsed: point.elapsed, score: point.score,
      gain: point.gain, mode: point.mode, boundary: Boolean(point.boundary) }));
    result.truncated = Boolean(saved.truncated || history.length > MAX_POINTS);
    return result;
  }

  function normalizeAll(saved) {
    return Object.fromEntries(Object.entries(saved || {}).filter(([, value]) => value?.version === 1)
      .map(([dmc, value]) => [dmc, normalize(value)]));
  }

  function addPoint(record, point) {
    const last = record.history.at(-1);
    if (last && !point.boundary && !last.boundary && !point.gain && !last.gain
      && last.mode === point.mode && Math.abs(last.score - point.score) <= EPSILON) record.history[record.history.length - 1] = point;
    else record.history.push(point);
    if (record.history.length > MAX_POINTS) { record.history.shift(); record.truncated = true; }
  }

  function start(saved, mode, score) {
    if (!Object.hasOwn(modes, mode)) throw new Error("Moteur inconnu");
    let record = normalize(saved);
    // A changed route or objective starts a new comparison, without crediting that change to a motor.
    if (record.score !== null && (!finite(score) || Math.abs(record.score - score) > EPSILON)) record = empty();
    if (finite(score) && record.score === null) record.baseline = record.score = score;
    record.totals[mode] ||= { gain: 0, elapsedMs: 0, runs: 0 };
    record.totals[mode].runs++;
    record.active = { mode, elapsedMs: 0 };
    if (record.score !== null) addPoint(record, { elapsed: record.elapsedMs, score: record.score, gain: 0, mode, boundary: true });
    return record;
  }

  function update(record, { score, elapsedMs, initialScore }) {
    if (!record?.active) return;
    const active = record.active, total = record.totals[active.mode];
    const elapsed = finite(elapsedMs) ? Math.max(active.elapsedMs, elapsedMs) : active.elapsedMs;
    const delta = elapsed - active.elapsedMs;
    record.elapsedMs += delta; total.elapsedMs += delta; active.elapsedMs = elapsed;
    if (!finite(score)) return;
    if (record.score === null) {
      record.baseline = record.score = finite(initialScore) && initialScore >= score ? initialScore : score;
      addPoint(record, { elapsed: record.elapsedMs, score: record.score, gain: 0, mode: active.mode, boundary: true });
    }
    const gain = record.score - score > EPSILON ? record.score - score : 0;
    if (gain) { total.gain += gain; record.score = score; }
    addPoint(record, { elapsed: record.elapsedMs, score: record.score, gain, mode: active.mode, boundary: false });
  }

  function finish(record, elapsedMs) {
    if (!record?.active) return;
    update(record, { score: record.score, elapsedMs });
    record.active = null;
  }

  const api = { modes, normalize, normalizeAll, start, update, finish, MAX_POINTS };
  root.PathSearchStats = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
