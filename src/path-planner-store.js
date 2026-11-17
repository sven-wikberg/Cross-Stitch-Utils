(function (root) {
  "use strict";
  async function transaction(mode, value) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("cross-stitch-path-planner-v2", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("draft");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction("draft", mode);
      const request = mode === "readonly" ? tx.objectStore("draft").get("active") : tx.objectStore("draft").put(value, "active");
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error("Sauvegarde interrompue")); };
    });
  }
  root.PathPlannerStore = { read: () => transaction("readonly"), write: value => transaction("readwrite", value) };
})(window);
