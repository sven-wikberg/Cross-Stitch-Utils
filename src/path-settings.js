(function (root) {
  "use strict";
  const validPoint = point => point && Number.isInteger(point.x) && Number.isInteger(point.y);
  const key = point => `${point.x},${point.y}`;
  function validate(data) {
    const threshold = data.settings?.cutThreshold;
    if (threshold !== undefined && (!Number.isInteger(threshold) || threshold < 1)) return "Distance de coupe invalide.";
    for (const path of data.paths || []) {
      const constraints = path.constraints || {};
      if (typeof constraints !== "object" || Array.isArray(constraints)) return "Contraintes invalides.";
      if (constraints.start && (!validPoint(constraints.start) || !path.points[0] || key(constraints.start) !== key(path.points[0]))) return "Depart impose incompatible avec le chemin.";
      const prefix = constraints.lockedPrefix || [];
      if (!Array.isArray(prefix) || prefix.some((point, i) => !validPoint(point) || !path.points[i] || key(point) !== key(path.points[i]))) return "Portion verrouillee incompatible avec le chemin.";
      const edges = new Set(path.points.slice(1).map((point, i) => [key(path.points[i]), key(point)].sort().join("|")));
      for (const cuts of [path.forcedCuts || [], constraints.forcedCuts || []]) {
        if (!Array.isArray(cuts) || cuts.some(edge => !validPoint(edge?.from) || !validPoint(edge?.to)
            || !edges.has([key(edge.from), key(edge.to)].sort().join("|")))) return "Coupe imposee incompatible avec le chemin.";
      }
    }
    return "";
  }
  root.PathSettings = { validate };
  if (typeof module !== "undefined") module.exports = root.PathSettings;
})(typeof window !== "undefined" ? window : globalThis);
