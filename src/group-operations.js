(function (root) {
  "use strict";
  function merge(groups, sourceId, targetId) {
    if (sourceId === targetId) throw new Error("Choisis un autre groupe.");
    const source = groups.find(group => group.id === sourceId);
    const target = groups.find(group => group.id === targetId);
    if (!source || !target) throw new Error("Groupe introuvable.");
    const keys = [...new Set([...target.cellKeys, ...source.cellKeys])];
    return groups.filter(group => group.id !== sourceId).map(group => group.id === targetId
      ? { ...group, cellKeys: keys, cellCount: keys.length } : group);
  }
  function split(groups, sourceId, selectedKeys) {
    const source = groups.find(group => group.id === sourceId);
    if (!source) throw new Error("Groupe introuvable.");
    const selected = new Set(selectedKeys);
    const extracted = source.cellKeys.filter(key => selected.has(key));
    if (!extracted.length || extracted.length === source.cellKeys.length) throw new Error("Selectionne une partie des cases du groupe.");
    const remaining = source.cellKeys.filter(key => !selected.has(key));
    let index = 1;
    while (groups.some(group => group.id === `group-${index}`)) index++;
    const newGroup = { ...source, id: `group-${index}`, cellKeys: extracted, cellCount: extracted.length,
      previewDataUrl: "", dmc: null, isEmpty: false, symbol: null };
    return groups.flatMap(group => group.id === sourceId
      ? [{ ...group, cellKeys: remaining, cellCount: remaining.length, previewDataUrl: "" }, newGroup] : [group]);
  }
  root.GroupOperations = { merge, split };
  if (typeof module !== "undefined") module.exports = root.GroupOperations;
})(typeof window !== "undefined" ? window : globalThis);
