(function (root) {
  "use strict";
  function createPathEditHistory(saved = {}, limits = {}) {
    const maxEntries = limits.maxEntries || 50, maxBytes = limits.maxBytes || 16 * 1024 * 1024;
    const clone = value => structuredClone(value);
    const entry = value => ({ ...clone(value), bytes: JSON.stringify(value.before).length * 2 });
    let undo = (saved.version === 1 ? saved.undo || [] : []).map(entry);
    let redo = (saved.version === 1 ? saved.redo || [] : []).map(entry);
    let pending = saved.version === 1 && saved.pending ? entry(saved.pending) : null;
    function trim(stack) {
      let bytes = stack.reduce((sum, item) => sum + item.bytes, 0);
      while (stack.length > 1 && (stack.length > maxEntries || bytes > maxBytes)) bytes -= stack.shift().bytes;
    }
    trim(undo); trim(redo);
    function commit(after) {
      if (!pending) return false;
      const action = pending; pending = null;
      if (JSON.stringify(action.before) === JSON.stringify(after)) return false;
      undo.push(action); redo = []; trim(undo);
      return true;
    }
    function move(from, to, capture) {
      if (pending || !from.length) return null;
      const action = from.at(-1);
      const inverse = entry({ scope: action.scope, label: action.label, before: capture(action.scope) });
      from.pop(); to.push(inverse); trim(to);
      return clone(action);
    }
    return {
      begin(scope, label, before) {
        if (pending) throw new Error("Une operation est deja en cours.");
        pending = entry({ scope, label, before });
      },
      commit,
      cancel() { pending = null; },
      recover(capture) { if (pending) commit(capture(pending.scope)); },
      undo: capture => move(undo, redo, capture),
      redo: capture => move(redo, undo, capture),
      get pending() { return pending; },
      get undoLabel() { return undo.at(-1)?.label || ""; },
      get redoLabel() { return redo.at(-1)?.label || ""; },
      toJSON: () => ({ version: 1, undo, redo, pending })
    };
  }
  root.createPathEditHistory = createPathEditHistory;
  if (typeof module !== "undefined") module.exports = { createPathEditHistory };
})(typeof window === "undefined" ? globalThis : window);
