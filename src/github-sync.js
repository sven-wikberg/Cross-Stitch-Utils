(function exposeGithubSync(global) {
  "use strict";

  const config = Object.freeze({
    owner: "sven-wikberg",
    repository: "Cross-Stitch-Utils",
    branch: "main",
    path: "data/builtin-progress.js",
    apiVersion: "2026-03-10"
  });

  class GithubSyncError extends Error {
    constructor(message, status = 0) {
      super(message);
      this.name = "GithubSyncError";
      this.status = status;
    }
  }

  function fileUrl() {
    const path = config.path.split("/").map(encodeURIComponent).join("/");
    return `https://api.github.com/repos/${config.owner}/${config.repository}/contents/${path}`;
  }

  function requestHeaders(token, raw = false) {
    const headers = {
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "X-GitHub-Api-Version": config.apiVersion
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  async function readErrorMessage(response) {
    let detail = "";
    try {
      const data = await response.json();
      detail = typeof data.message === "string" ? data.message : "";
    } catch {
      // GitHub did not return JSON.
    }

    if (response.status === 401) {
      return "Le jeton GitHub est invalide ou expire.";
    }
    if (response.status === 403) {
      return "GitHub refuse l'acces. Verifie la permission Contents du jeton.";
    }
    if (response.status === 404) {
      return "Le depot ou la sauvegarde GitHub est introuvable pour ce jeton.";
    }
    if (response.status === 409) {
      return "La sauvegarde a change sur GitHub. Reessaie la synchronisation.";
    }
    return detail ? `Erreur GitHub: ${detail}` : `Erreur GitHub (${response.status}).`;
  }

  async function assertOk(response) {
    if (!response.ok) {
      throw new GithubSyncError(await readErrorMessage(response), response.status);
    }
    return response;
  }

  async function loadFile(token = "") {
    const url = `${fileUrl()}?ref=${encodeURIComponent(config.branch)}`;
    const response = await global.fetch(url, {
      headers: requestHeaders(token, true),
      cache: "no-store"
    });
    await assertOk(response);
    return response.text();
  }

  async function getFileMetadata(token) {
    const url = `${fileUrl()}?ref=${encodeURIComponent(config.branch)}`;
    const response = await global.fetch(url, {
      headers: requestHeaders(token),
      cache: "no-store"
    });
    await assertOk(response);
    const data = await response.json();
    if (!data || typeof data.sha !== "string") {
      throw new GithubSyncError("GitHub n'a pas retourne la version du fichier.");
    }
    return data;
  }

  function utf8ToBase64(value) {
    const bytes = new TextEncoder().encode(value);
    const chunkSize = 0x8000;
    let binary = "";
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }

  async function putFile(content, token, sha) {
    const response = await global.fetch(fileUrl(), {
      method: "PUT",
      headers: {
        ...requestHeaders(token),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "Update builtin stitch progress",
        content: utf8ToBase64(content),
        sha,
        branch: config.branch
      })
    });
    await assertOk(response);
    return response.json();
  }

  async function saveFile(content, token) {
    if (!token) {
      throw new GithubSyncError("Connecte GitHub avant de synchroniser.");
    }

    const metadata = await getFileMetadata(token);
    return putFile(content, token, metadata.sha);
  }

  const statePath = "data/progress-state.json";
  const knownPatterns = new Set();
  function contentUrl(path, ref = config.branch) {
    return `https://api.github.com/repos/${config.owner}/${config.repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;
  }
  async function readJson(path, token, ref = config.branch) {
    const response = await global.fetch(contentUrl(path, ref), { headers: requestHeaders(token), cache: "no-store" });
    if (response.status === 404) return null;
    await assertOk(response);
    const file = await response.json();
    let text;
    if (file.content && file.encoding === "base64") {
      text = new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g, "")), c => c.charCodeAt(0)));
    } else {
      const raw = await global.fetch(contentUrl(path, ref), { headers: requestHeaders(token, true), cache: "no-store" });
      await assertOk(raw);
      text = await raw.text();
    }
    return { sha: file.sha, data: JSON.parse(text) };
  }
  async function writeJson(path, data, token, sha) {
    const response = await global.fetch(contentUrl(path).split("?")[0], {
      method: "PUT", headers: { ...requestHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ message: path === statePath ? "Save stitch progress" : "Store stitch pattern", branch: config.branch,
        content: utf8ToBase64(JSON.stringify(data)), ...(sha ? { sha } : {}) })
    });
    await assertOk(response);
    return response.json();
  }
  async function loadState(token, ref) { return readJson(statePath, token, ref); }
  async function loadPattern(id, token) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new GithubSyncError("Identifiant de pattern invalide.");
    const result = await readJson(`data/patterns/${id}.json`, token);
    if (!result) throw new GithubSyncError("Pattern synchronise introuvable.");
    knownPatterns.add(id);
    return result.data;
  }
  async function patternExists(path, token) {
    const response = await global.fetch(contentUrl(path), { headers: requestHeaders(token), cache: "no-store" });
    if (response.status === 404) return false;
    await assertOk(response);
    const file = await response.json();
    return typeof file.sha === "string";
  }
  async function saveState(state, pattern, token, expectedSha) {
    if (!token) throw new GithubSyncError("Connecte GitHub avant de synchroniser.");
    if (!/^[a-f0-9]{64}$/.test(state.patternId)) throw new GithubSyncError("Identifiant de pattern invalide.");
    const remote = await loadState(token);
    if ((remote?.sha || null) !== (expectedSha || null)) {
      const error = new GithubSyncError("Une autre version existe sur GitHub.", 409);
      error.remote = remote;
      throw error;
    }
    const patternPath = `data/patterns/${state.patternId}.json`;
    if (!knownPatterns.has(state.patternId) && !await patternExists(patternPath, token)) {
      try { await writeJson(patternPath, pattern, token, null); }
      catch (error) { if (![409, 422].includes(error.status) || !await patternExists(patternPath, token)) throw error; }
    }
    knownPatterns.add(state.patternId);
    try {
      const result = await writeJson(statePath, state, token, expectedSha);
      return { sha: result.content.sha, data: state };
    } catch (error) {
      if (error.status === 409 || error.status === 422) {
        const conflict = new GithubSyncError("La sauvegarde a change pendant la synchronisation.", 409);
        conflict.remote = await loadState(token);
        throw conflict;
      }
      throw error;
    }
  }
  async function history(token) {
    const response = await global.fetch(`https://api.github.com/repos/${config.owner}/${config.repository}/commits?path=${encodeURIComponent(statePath)}&per_page=15`,
      { headers: requestHeaders(token), cache: "no-store" });
    await assertOk(response);
    return response.json();
  }

  global.CrossStitchGithubSync = Object.freeze({
    config,
    GithubSyncError,
    loadFile,
    getFileMetadata,
    saveFile,
    loadState, loadPattern, saveState, history,
    utf8ToBase64
  });
})(typeof window === "undefined" ? globalThis : window);
