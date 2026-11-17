(function (root) {
  "use strict";
  const DB = "cross-stitch-progress-v2";
  let database;
  function open() {
    return database ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("records");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { database = null; reject(request.error); };
    });
  }
  async function read(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction("records").objectStore("records").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function write(key, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("records", "readwrite");
      tx.objectStore("records").put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Sauvegarde interrompue"));
    });
  }
  async function identify(pattern) {
    const bytes = new TextEncoder().encode(JSON.stringify(pattern));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  function fingerprint(state) {
    if (!state) return "";
    return JSON.stringify([state.patternId, Object.entries(state.stitchedByDmc || {}).sort(), state.selectedDmc]);
  }
  function unpack(state, pathsFile) {
    if (!state || state.kind !== "cross-stitch-progress-state" || ![2, 3].includes(state.schemaVersion)
        || !/^[a-f0-9]{64}$/.test(state.patternId)) throw new Error("Sauvegarde synchronisee invalide.");
    return { ...state, kind: "cross-stitch-progress-save", schemaVersion: state.schemaVersion - 1, pathsFile };
  }
  root.StitchProgressStore = { read, write, identify, fingerprint, unpack };
})(typeof window === "undefined" ? globalThis : window);
