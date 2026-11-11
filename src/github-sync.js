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

    let metadata = await getFileMetadata(token);
    try {
      return await putFile(content, token, metadata.sha);
    } catch (error) {
      if (!(error instanceof GithubSyncError) || error.status !== 409) {
        throw error;
      }
      metadata = await getFileMetadata(token);
      return putFile(content, token, metadata.sha);
    }
  }

  global.CrossStitchGithubSync = Object.freeze({
    config,
    GithubSyncError,
    loadFile,
    getFileMetadata,
    saveFile,
    utf8ToBase64
  });
})(typeof window === "undefined" ? globalThis : window);
