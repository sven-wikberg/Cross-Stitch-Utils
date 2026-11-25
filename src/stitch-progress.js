const STITCH_PROGRESS_STORAGE_KEY = "cross-stitch-progress-tool";

const pathsJsonFileInput = document.querySelector("#pathsJsonFile");
const progressSaveFileInput = document.querySelector("#progressSaveFile");
const loadBuiltinProgressButton = document.querySelector("#loadBuiltinProgressButton");
const builtinProgressStatus = document.querySelector("#builtinProgressStatus");
const progressLoadStatus = document.querySelector("#progressLoadStatus");
const progressProjectText = document.querySelector("#progressProjectText");
const progressDimensionsText = document.querySelector("#progressDimensionsText");
const progressPointsText = document.querySelector("#progressPointsText");
const progressLoadError = document.querySelector("#progressLoadError");
const progressSaveStatus = document.querySelector("#progressSaveStatus");
const resetProgressToolButton = document.querySelector("#resetProgressToolButton");
const stitchStatus = document.querySelector("#stitchStatus");
const stitchColorLabel = document.querySelector("#stitchColorLabel");
const zoomOutButton = document.querySelector("#zoomOutButton");
const zoomLevelText = document.querySelector("#zoomLevelText");
const zoomInButton = document.querySelector("#zoomInButton");
const followCurrentPointButton = document.querySelector("#followCurrentPointButton");
const stitchCanvas = document.querySelector("#stitchCanvas");
const stitchColorLegend = document.querySelector("#stitchColorLegend");
const stitchColorStatus = document.querySelector("#stitchColorStatus");
const undoStitchButton = document.querySelector("#undoStitchButton");
const resetColorProgressButton = document.querySelector("#resetColorProgressButton");
const nextStitchButton = document.querySelector("#nextStitchButton");
const downloadProgressSaveButton = document.querySelector("#downloadProgressSaveButton");
const writeBuiltinProgressButton = document.querySelector("#writeBuiltinProgressButton");
const writeBuiltinProgressStatus = document.querySelector("#writeBuiltinProgressStatus");
const toggleGithubSetupButton = document.querySelector("#toggleGithubSetupButton");
const githubSetupPanel = document.querySelector("#githubSetupPanel");
const githubTokenInput = document.querySelector("#githubTokenInput");
const saveGithubTokenButton = document.querySelector("#saveGithubTokenButton");
const clearGithubTokenButton = document.querySelector("#clearGithubTokenButton");
const completedColorList = document.querySelector("#completedColorList");
const globalProgressPanel = document.querySelector("#globalProgressPanel");
const globalProgressBar = document.querySelector("#globalProgressBar");
const globalProgressPoints = document.querySelector("#globalProgressPoints");
const globalProgressPercent = document.querySelector("#globalProgressPercent");
const globalProgressRemaining = document.querySelector("#globalProgressRemaining");
const globalProgressColors = document.querySelector("#globalProgressColors");
const selectedProgressPanel = document.querySelector("#selectedProgressPanel");
const selectedProgressBar = document.querySelector("#selectedProgressBar");
const selectedProgressColor = document.querySelector("#selectedProgressColor");
const selectedPathScore = document.querySelector("#selectedPathScore");
const selectedProgressPoints = document.querySelector("#selectedProgressPoints");
const selectedProgressPercent = document.querySelector("#selectedProgressPercent");
const selectedProgressRemaining = document.querySelector("#selectedProgressRemaining");
const zoomPanel = document.querySelector("#zoomPanel");
const progressStepEyebrow = document.querySelector("#progressStepEyebrow");
const progressStepTitle = document.querySelector("#progress-step-title");
const progressStepButtons = document.querySelectorAll("[data-step]");
const progressPanels = document.querySelectorAll("[data-panel]");

const progressStepLabels = {
  load: {
    eyebrow: "Etape 1",
    title: "Charger les chemins"
  },
  stitch: {
    eyebrow: "Etape 2",
    title: "Broder"
  }
};

const progressStepOrder = ["load", "stitch"];
const githubSync = window.CrossStitchGithubSync || null;
const GITHUB_TOKEN_STORAGE_KEY = "cross-stitch-utils-github-token";
let builtinProgressSave = window.BUILTIN_STITCH_PROGRESS || null;
const MAX_RESPONSIVE_CELL_SIZE = 18;
const GRID_RULER_SIZE = 26;
const DEFAULT_STITCH_ZOOM = 1;
const MIN_STITCH_ZOOM = 0.5;
const MAX_STITCH_ZOOM = 4;
const STITCH_ZOOM_STEP = 0.25;
const REALISTIC_JUMP_THRESHOLD = 10;
const STITCH_CONTEXT_ALPHA = [0.95, 0.72, 0.5, 0.3];
const STITCH_PREVIOUS_COLOR = "#ad600e";
const STITCH_NEXT_COLOR = "#087cb6";
const progressStore = window.StitchProgressStore;
const syncStateText = document.querySelector("#syncStateText");
const autoSyncToggle = document.querySelector("#autoSyncToggle");
const syncConflictPanel = document.querySelector("#syncConflictPanel");
const undoActionButton = document.querySelector("#undoActionButton");
const redoActionButton = document.querySelector("#redoActionButton");
const markUntilToggle = document.querySelector("#markUntilToggle");
const threadMarkersToggle = document.querySelector("#threadMarkersToggle");
const changeThreadButton = document.querySelector("#changeThreadButton");
const activityProgressPanel = document.querySelector("#activityProgressPanel");
let threadMarkerHits = [];
let stitchStatsRevision = 0;
let localSaveQueue = Promise.resolve();
let patternIds = new WeakMap();
let storedPatternIds = new Set();
let remoteSha = null;
let lastSyncedFingerprint = "";
let lastSyncedAt = null;
let latestLocalState = null;
let localSaveError = null;
let localSavePending = 0;
let conflictRemote = null;
let sessionMode = false;
let stitchView = { startX: 0, startY: 0, width: 0, height: 0, cellSize: 1 };
let centerAfterSession = false;
let undoActions = [];
let redoActions = [];
let viewPosition = { left: 0, top: 0 };
let restoringSession = false;
autoSyncToggle.checked = localStorage.getItem("cross-stitch-auto-sync") === "true";

const upgradedProgressSaves = new WeakMap();
const stitchPathScoreCache = new WeakMap();
let pendingLegacyBackup = null;
let storedProgressState = loadStoredProgressState();
let loadedPaths = storedProgressState.pathsFile;
let stitchedByDmc = storedProgressState.stitchedByDmc;
let stitchStats = StitchStats.load(storedProgressState.stitchStats, loadedPaths, stitchedByDmc);
threadMarkersToggle.checked = storedProgressState.showThreadMarkers !== false;
let selectedDmc = storedProgressState.selectedDmc || orderedStitchPaths()[0]?.dmc || null;
let stitchZoom = storedProgressState.zoom || DEFAULT_STITCH_ZOOM;
let followCurrentPoint = Boolean(storedProgressState.followCurrentPoint);
let githubSyncInProgress = false;
let builtinProgressMessage = "";
let stitchProgress = {
  load: Boolean(loadedPaths),
  stitch: Boolean(loadedPaths) && areAllColorsStitched(loadedPaths, storedProgressState.stitchedByDmc)
};
let activeProgressStep = "load";

function loadStoredProgressState() {
  const stored = localStorage.getItem(STITCH_PROGRESS_STORAGE_KEY);
  const empty = { pathsFile: null, stitchedByDmc: {}, selectedDmc: null };
  if (!stored) return empty;
  try {
    const parsed = JSON.parse(stored);
    pendingLegacyBackup = parsed;
    if (parsed.kind === "cross-stitch-paths") return { ...empty, pathsFile: StitchModel.upgradePathsFile(parsed) };
    return StitchModel.upgradeProgressSave(parsed.kind === "cross-stitch-progress-save" ? parsed
      : { ...parsed, kind: "cross-stitch-progress-save", schemaVersion: parsed.pathsFile?.schemaVersion || 1 });
  } catch { return empty; }
}

function saveProgressState() {
  localSavePending++;
  if (!loadedPaths) {
    latestLocalState = null;
    localStorage.removeItem(STITCH_PROGRESS_STORAGE_KEY);
    localSaveQueue = localSaveQueue.catch(() => {}).then(async () => {
      await progressStore.write("active", null);
      latestLocalState = null;
      localSaveError = null;
      renderSyncState();
    }).catch(error => { localSaveError = error.message; renderSyncState(); }).finally(() => { localSavePending--; });
    return;
  }
  const paths = loadedPaths;
  const snapshot = { kind: "cross-stitch-progress-state", schemaVersion: 3, stitchUnit: "diagonal", savedAt: new Date().toISOString(),
    stitchedByDmc: normalizeStitchedState(paths, stitchedByDmc), selectedDmc, zoom: stitchZoom, followCurrentPoint,
    sessionMode, viewPosition: { ...viewPosition }, undoActions: structuredClone(undoActions), redoActions: structuredClone(redoActions),
    stitchStats: structuredClone(stitchStats), showThreadMarkers: threadMarkersToggle.checked };
  localSaveQueue = localSaveQueue.catch(() => {}).then(async () => {
    if (pendingLegacyBackup) {
      await progressStore.write("migration-backup:legacy-storage", pendingLegacyBackup);
      pendingLegacyBackup = null;
    }
    let id = patternIds.get(paths);
    if (!id) { id = await progressStore.identify(paths); patternIds.set(paths, id); }
    if (!storedPatternIds.has(id)) { await progressStore.write(`pattern:${id}`, paths); storedPatternIds.add(id); }
    snapshot.patternId = id;
    await progressStore.write("active", { ...snapshot, remoteSha, lastSyncedFingerprint, lastSyncedAt });
    latestLocalState = snapshot;
    localSaveError = null;
    localStorage.removeItem(STITCH_PROGRESS_STORAGE_KEY);
    renderSyncState();
  }).catch(error => { localSaveError = error.message; renderSyncState(); throw error; }).finally(() => { localSavePending--; });
  localSaveQueue.catch(() => {});
}

function renderSyncState() {
  const dirty = progressStore.fingerprint(latestLocalState) !== lastSyncedFingerprint;
  syncStateText.textContent = localSaveError ? `Sauvegarde locale impossible : ${localSaveError}`
    : !navigator.onLine ? "Hors ligne, progression locale conservee"
    : githubSyncInProgress ? "Synchronisation en cours..."
    : !syncConflictPanel.classList.contains("hidden") ? "Deux versions a comparer"
    : dirty ? "Modifications locales a synchroniser"
    : lastSyncedAt ? `Synchronise le ${new Date(lastSyncedAt).toLocaleString("fr-CH")}` : "Sauvegarde locale";
}

function changeStitchCount(dmc, count) {
  const before = stitchedCountForDmc(dmc);
  const after = Math.min(pathForDmc(dmc)?.points.length || 0, Math.max(0, count));
  if (before === after) return;
  const statsBefore = StitchStats.snapshot(stitchStats, dmc);
  StitchStats.record(stitchStats, dmc, before, after);
  stitchStatsRevision++;
  undoActions.push({ dmc, before, after, statsBefore, statsAfter: StitchStats.snapshot(stitchStats, dmc) });
  undoActions = undoActions.slice(-100);
  redoActions = [];
  stitchedByDmc[dmc] = after;
  stitchProgress.stitch = areAllColorsStitched(loadedPaths, stitchedByDmc);
  saveProgressState();
  renderProgressTool();
}

function normalizeStitchZoom(value) {
  const zoom = Number(value);
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return null;
  }

  return Math.min(MAX_STITCH_ZOOM, Math.max(MIN_STITCH_ZOOM, Math.round(zoom / STITCH_ZOOM_STEP) * STITCH_ZOOM_STEP));
}

function renderProgressTool() {
  if (!canOpenProgressStep(activeProgressStep)) {
    activeProgressStep = firstOpenProgressStep();
  }

  const label = progressStepLabels[activeProgressStep];
  progressStepEyebrow.textContent = label.eyebrow;
  progressStepTitle.textContent = label.title;

  progressStepButtons.forEach((button) => {
    const step = button.dataset.step;
    const isComplete = isProgressStepComplete(step);
    const isLocked = !canOpenProgressStep(step);

    button.classList.toggle("active", step === activeProgressStep);
    button.classList.toggle("complete", isComplete);
    button.classList.toggle("locked", isLocked);
    button.disabled = isLocked;
  });

  progressPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.panel !== activeProgressStep);
  });

  const showProgressPanels = activeProgressStep === "stitch" && Boolean(loadedPaths);
  globalProgressPanel.classList.toggle("hidden", !showProgressPanels);
  selectedProgressPanel.classList.toggle("hidden", !showProgressPanels);
  zoomPanel.classList.toggle("hidden", !showProgressPanels);
  activityProgressPanel.classList.toggle("hidden", !showProgressPanels);

  document.body.classList.toggle("session-mode", sessionMode && activeProgressStep === "stitch");
  renderLoadedPaths();
  renderBuiltinProgressControls();
  renderGithubConnectionControls();
  renderStitchView();
  renderZoomControls();
  renderProgressMetrics();
  StitchStatsView.render(stitchStats, loadedPaths, stitchedByDmc, selectedDmc, stitchStatsRevision);
  document.querySelector("#sessionModeButton").textContent = sessionMode ? "Vue d'ensemble" : "Vue rapprochee";
  document.querySelector("#sessionModeButton").setAttribute("aria-pressed", String(sessionMode));
  undoActionButton.disabled = undoActions.length === 0;
  redoActionButton.disabled = redoActions.length === 0;
  renderCutNotice();
}

function renderLoadedPaths() {
  if (!loadedPaths) {
    progressLoadStatus.className = "coverage-status invalid";
    progressLoadStatus.textContent = "Aucun fichier charge.";
    progressProjectText.textContent = "-";
    progressDimensionsText.textContent = "0 x 0";
    progressPointsText.textContent = "0";
    return;
  }

  const pointCount = loadedPaths.paths.reduce((sum, path) => sum + path.points.length, 0);
  progressLoadStatus.className = "coverage-status valid";
  progressLoadStatus.textContent = "Fichier de chemins charge et format valide.";
  progressProjectText.textContent = loadedPaths.project.name;
  progressDimensionsText.textContent = `${loadedPaths.pattern.grid.width} x ${loadedPaths.pattern.grid.height}`;
  progressPointsText.textContent = String(pointCount);
}

function renderProgressMetrics() {
  const completions = loadedPaths?.paths.map(path => ({ dmc: path.dmc, ...StitchModel.completion(path.points, stitchedCountForDmc(path.dmc)) })) || [];
  const selectedCompletion = completions.find(c => c.dmc === selectedDmc);
  document.querySelector("#globalCompleteCrosses").textContent = String(completions.reduce((sum, c) => sum + c.complete, 0));
  document.querySelector("#globalPartialCrosses").textContent = String(completions.reduce((sum, c) => sum + c.partial, 0));
  document.querySelector("#selectedCompleteCrosses").textContent = String(selectedCompletion?.complete || 0);
  document.querySelector("#selectedPartialCrosses").textContent = String(selectedCompletion?.partial || 0);
  if (!loadedPaths) {
    globalProgressBar.value = 0;
    globalProgressPoints.textContent = "0 / 0";
    globalProgressPercent.textContent = "0%";
    globalProgressRemaining.textContent = "0";
    globalProgressColors.textContent = "0 / 0";
    selectedProgressBar.value = 0;
    selectedProgressColor.textContent = "-";
    selectedPathScore.textContent = "-";
    selectedProgressPoints.textContent = "0 / 0";
    selectedProgressPercent.textContent = "0%";
    selectedProgressRemaining.textContent = "0";
    return;
  }

  const totalPoints = loadedPaths.paths.reduce((sum, path) => sum + path.points.length, 0);
  const stitchedPoints = loadedPaths.paths.reduce((sum, path) => sum + stitchedCountForDmc(path.dmc), 0);
  const completedColors = loadedPaths.paths.filter((path) => stitchedCountForDmc(path.dmc) === path.points.length).length;
  const globalPercent = progressPercent(stitchedPoints, totalPoints);

  globalProgressBar.value = globalPercent;
  globalProgressPoints.textContent = `${stitchedPoints} / ${totalPoints}`;
  globalProgressPercent.textContent = formatPercent(globalPercent);
  globalProgressRemaining.textContent = String(Math.max(0, totalPoints - stitchedPoints));
  globalProgressColors.textContent = `${completedColors} / ${loadedPaths.paths.length}`;

  const selectedPath = pathForDmc(selectedDmc);
  if (!selectedPath) {
    selectedProgressBar.value = 0;
    selectedProgressColor.textContent = "-";
    selectedPathScore.textContent = "-";
    selectedProgressPoints.textContent = "0 / 0";
    selectedProgressPercent.textContent = "0%";
    selectedProgressRemaining.textContent = "0";
    return;
  }

  const selectedStitched = stitchedCountForDmc(selectedDmc);
  const selectedPercent = progressPercent(selectedStitched, selectedPath.points.length);
  selectedProgressBar.value = selectedPercent;
  selectedProgressColor.textContent = `DMC ${selectedDmc}`;
  const threshold = loadedPaths.settings?.cutThreshold ?? REALISTIC_JUMP_THRESHOLD;
  let score = stitchPathScoreCache.get(selectedPath);
  if (!score || score.threshold !== threshold) {
    score = { threshold, value: StitchModel.metrics(selectedPath.points, threshold, true).score };
    stitchPathScoreCache.set(selectedPath, score);
  }
  selectedPathScore.textContent = score.value.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  selectedProgressPoints.textContent = `${selectedStitched} / ${selectedPath.points.length}`;
  selectedProgressPercent.textContent = formatPercent(selectedPercent);
  selectedProgressRemaining.textContent = String(Math.max(0, selectedPath.points.length - selectedStitched));
}

function progressPercent(done, total) {
  return total > 0 ? (done / total) * 100 : 0;
}

function formatPercent(value) {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

function renderBuiltinProgressControls() {
  const validation = validateProgressSave(builtinProgressSave);
  loadBuiltinProgressButton.disabled = githubSyncInProgress || (!githubSync && !validation.valid);

  if (builtinProgressMessage) {
    builtinProgressStatus.textContent = builtinProgressMessage;
    return;
  }

  if (validation.valid) {
    const projectName = builtinProgressSave.pathsFile.project.name;
    builtinProgressStatus.textContent = `Sauvegarde disponible: ${projectName}. GitHub sera verifie au chargement.`;
    return;
  }

  builtinProgressStatus.textContent = "Clique pour rechercher la sauvegarde sur GitHub.";
}

function renderGithubConnectionControls() {
  const connected = Boolean(readGithubToken());
  toggleGithubSetupButton.textContent = connected ? "Connexion GitHub active" : "Connexion GitHub";
  clearGithubTokenButton.disabled = !connected;
}

function renderStitchView() {
  const context = stitchCanvas.getContext("2d");
  threadMarkerHits = [];

  if (!loadedPaths) {
    stitchCanvas.width = 1;
    stitchCanvas.height = 1;
    context.clearRect(0, 0, 1, 1);
    stitchColorLegend.innerHTML = "";
    completedColorList.innerHTML = '<p class="empty-message">Aucune couleur terminee.</p>';
    stitchColorLabel.textContent = "Aucune couleur selectionnee";
    stitchStatus.className = "coverage-status invalid";
    stitchStatus.textContent = "Charge un fichier pour commencer.";
    renderStitchControls();
    return;
  }

  if (!selectedDmc || !pathForDmc(selectedDmc)) {
    selectedDmc = orderedStitchPaths()[0]?.dmc || null;
  }

  const pattern = loadedPaths.pattern;
  const colorByDmc = new Map(pattern.colors.map((color) => [color.dmc, color]));
  const baseCellSize = gridCellSize(
    pattern.grid.width,
    pattern.grid.height,
    availableGridWidth(stitchCanvas) - GRID_RULER_SIZE
  );
  const cellSize = Math.max(2, Math.round((sessionMode ? Math.max(22, baseCellSize) : baseCellSize) * stitchZoom));
  stitchView = visibleStitchGrid(pattern.grid, cellSize);
  const selectedColor = colorByDmc.get(selectedDmc);
  stitchColorLabel.textContent = selectedColor
    ? `DMC ${selectedColor.dmc} - ${selectedColor.symbol || ""}`
    : "Aucune couleur selectionnee";

  stitchCanvas.width = GRID_RULER_SIZE + stitchView.width * cellSize;
  stitchCanvas.height = GRID_RULER_SIZE + stitchView.height * cellSize;
  context.clearRect(0, 0, stitchCanvas.width, stitchCanvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, stitchCanvas.width, stitchCanvas.height);

  const stitchedCellKeys = stitchedCellKeysForProgress();
  pattern.grid.cells.forEach((cell) => {
    if (cell.x < stitchView.startX || cell.x >= stitchView.startX + stitchView.width
        || cell.y < stitchView.startY || cell.y >= stitchView.startY + stitchView.height) return;
    const color = colorByDmc.get(cell.dmc);
    if (cell.empty) {
      context.fillStyle = "#ffffff";
    } else if (stitchedCellKeys.has(cellKey(cell))) {
      context.fillStyle = color?.hex || "#d9dddd";
    } else {
      context.fillStyle = mutedHex(color?.hex || "#d9dddd");
    }

    context.fillRect(
      GRID_RULER_SIZE + (cell.x - stitchView.startX) * cellSize,
      GRID_RULER_SIZE + (cell.y - stitchView.startY) * cellSize,
      cellSize,
      cellSize
    );
  });

  if (cellSize >= 6) {
    drawGridLines(context, stitchView.width, stitchView.height, cellSize);
  }

  context.save();
  context.beginPath();
  context.rect(GRID_RULER_SIZE, GRID_RULER_SIZE, stitchView.width * cellSize, stitchView.height * cellSize);
  context.clip();
  loadedPaths.paths.filter(path => path.dmc !== selectedDmc).forEach(path => {
    const partial = StitchModel.completion(path.points, stitchedCountForDmc(path.dmc));
    const color = colorByDmc.get(path.dmc);
    for (const point of path.points.slice(0, stitchedCountForDmc(path.dmc))) {
      if (partial.cells.get(cellKey(point)) === 3) continue;
      if (point.x < stitchView.startX || point.x >= stitchView.startX + stitchView.width
          || point.y < stitchView.startY || point.y >= stitchView.startY + stitchView.height) continue;
      const holes = StitchModel.holes(point), from = holePixel(holes.start, cellSize), to = holePixel(holes.end, cellSize);
      context.strokeStyle = color?.hex || "#222426"; context.lineWidth = Math.max(1.5, cellSize * 0.16);
      context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke();
    }
  });
  drawStitchProgress(context, cellSize);
  drawThreadMarkers(context, cellSize);
  const currentPoint = pathForDmc(selectedDmc)?.points[stitchedCountForDmc(selectedDmc)];
  if (currentPoint) drawCurrentStitchArrow(context, currentPoint, cellSize);
  context.restore();
  drawGridRulers(context, stitchView.width, stitchView.height, cellSize);
  renderStitchColorLegend();
  renderCompletedColorList();
  renderStitchControls();
  stitchStatus.className = "coverage-status valid";
  const action = pathForDmc(selectedDmc)?.points[stitchedCountForDmc(selectedDmc)];
  if (action) {
    const holes = StitchModel.holes(action);
    const corner = h => `${h.y === action.y ? "haut" : "bas"} ${h.x === action.x ? "gauche" : "droit"}`;
    stitchStatus.textContent = `Case ${action.x + 1}, ${action.y + 1} - ${action.diagonal === "lower" ? "/ Dessous" : "\\ Dessus"} - ${corner(holes.start)} vers ${corner(holes.end)}`;
  } else stitchStatus.textContent = `DMC ${selectedDmc} terminee.`;
  centerCurrentPointIfNeeded(cellSize);
}

function visibleStitchGrid(grid, cellSize) {
  if (!sessionMode) return { startX: 0, startY: 0, width: grid.width, height: grid.height, cellSize };
  const wrapper = stitchCanvas.parentElement;
  const availableWidth = availableGridWidth(stitchCanvas) - GRID_RULER_SIZE;
  const availableHeight = Math.max(160, Math.min(window.innerHeight - 150,
    window.innerHeight - wrapper.getBoundingClientRect().top - 100));
  const width = Math.min(grid.width, Math.max(1, Math.floor(availableWidth / cellSize)));
  const height = Math.min(grid.height, Math.max(1, Math.floor(availableHeight / cellSize)));
  const path = pathForDmc(selectedDmc);
  const point = path?.points[stitchedCountForDmc(selectedDmc)] || path?.points.at(-1) || { x: 0, y: 0 };
  return {
    startX: Math.max(0, Math.min(grid.width - width, point.x - Math.floor(width / 2))),
    startY: Math.max(0, Math.min(grid.height - height, point.y - Math.floor(height / 2))),
    width, height, cellSize
  };
}

function renderZoomControls() {
  zoomLevelText.textContent = `${Math.round(stitchZoom * 100)}%`;
  zoomOutButton.disabled = stitchZoom <= MIN_STITCH_ZOOM;
  zoomInButton.disabled = stitchZoom >= MAX_STITCH_ZOOM;
  followCurrentPointButton.classList.toggle("selected", followCurrentPoint || sessionMode);
  followCurrentPointButton.textContent = followCurrentPoint || sessionMode ? "Suivi actif" : "Suivre le point";
  followCurrentPointButton.disabled = sessionMode;
}

function centerCurrentPointIfNeeded(cellSize) {
  const path = pathForDmc(selectedDmc);
  if (sessionMode) {
    stitchCanvas.parentElement.scrollTo(0, 0);
    return;
  }
  if (restoringSession || (!followCurrentPoint && !centerAfterSession) || !path) {
    return;
  }
  centerAfterSession = false;

  const stitchedCount = stitchedCountForDmc(selectedDmc);
  const point = path.points[stitchedCount] || path.points[path.points.length - 1];
  if (!point) {
    return;
  }

  const wrapper = stitchCanvas.parentElement;
  if (!wrapper) {
    return;
  }

  window.requestAnimationFrame(() => {
    if (sessionMode) return;
    const centerX = stitchCanvas.offsetLeft - wrapper.offsetLeft + GRID_RULER_SIZE + (point.x + 0.5) * cellSize;
    const centerY = stitchCanvas.offsetTop - wrapper.offsetTop + GRID_RULER_SIZE + (point.y + 0.5) * cellSize;
    wrapper.scrollLeft = Math.max(0, centerX - wrapper.clientWidth / 2);
    wrapper.scrollTop = Math.max(0, centerY - wrapper.clientHeight / 2);
  });
}

function drawStitchProgress(context, cellSize) {
  const path = pathForDmc(selectedDmc);
  if (!path) return;
  const count = stitchedCountForDmc(selectedDmc);
  const selectedColor = loadedPaths.pattern.colors.find(c => c.dmc === selectedDmc);
  const rgb = parseHexColor(selectedColor?.hex || "#ffffff");
  const dark = rgb && (rgb.red * 0.299 + rgb.green * 0.587 + rgb.blue * 0.114) < 110;
  const completion = StitchModel.completion(path.points, count).cells;
  const hasCurrent = count < path.points.length;
  const radius = STITCH_CONTEXT_ALPHA.length;
  context.save(); context.lineCap = "round"; context.lineJoin = "round";
  path.points.forEach((point, index) => {
    // The recent incoming and upcoming outgoing links are drawn in the context overlay.
    if (index >= count || (hasCurrent && index > count - radius)) return;
    if (index) drawPathSegment(context, path.points[index - 1], point, cellSize, 0.7);
  });
  path.points.forEach((point, index) => {
    if (index >= count || (hasCurrent && count - index <= radius)) return;
    if (point.x < stitchView.startX || point.x >= stitchView.startX + stitchView.width
        || point.y < stitchView.startY || point.y >= stitchView.startY + stitchView.height) return;
    const holes = StitchModel.holes(point), from = holePixel(holes.start, cellSize), to = holePixel(holes.end, cellSize);
    const ink = dark && completion.get(cellKey(point)) === 3 ? "#ffffff" : "#222426";
    context.globalAlpha = 1;
    context.strokeStyle = ink;
    context.lineWidth = Math.max(1, cellSize * 0.085);
    context.setLineDash([]);
    context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke();
  });
  if (hasCurrent) drawStitchContext(context, path.points, count, cellSize);
  context.restore();
}

function drawStitchContext(context, points, count, cellSize) {
  if (!points[count]) return;
  const neighbors = [];
  for (let distance = STITCH_CONTEXT_ALPHA.length; distance >= 1; distance--) {
    const alpha = STITCH_CONTEXT_ALPHA[distance - 1];
    if (points[count - distance]) neighbors.push({ index: count - distance, link: count - distance + 1, color: STITCH_PREVIOUS_COLOR, alpha });
    if (points[count + distance]) neighbors.push({ index: count + distance, link: count + distance, color: STITCH_NEXT_COLOR, alpha });
  }
  // Distant links first, then front-side diagonals; the current arrow remains above everything.
  for (const item of neighbors) {
    drawPathSegment(context, points[item.link - 1], points[item.link], cellSize, item.alpha, item.color);
  }
  context.save(); context.setLineDash([]); context.lineCap = "round";
  const width = Math.max(1.8, Math.min(6, cellSize * 0.09));
  const halo = Math.max(1, Math.min(2.5, cellSize * 0.025));
  for (const item of neighbors) {
    const point = points[item.index];
    if (point.x < stitchView.startX || point.x >= stitchView.startX + stitchView.width
        || point.y < stitchView.startY || point.y >= stitchView.startY + stitchView.height) continue;
    const holes = StitchModel.holes(point), from = holePixel(holes.start, cellSize), to = holePixel(holes.end, cellSize);
    context.globalAlpha = item.alpha;
    context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y);
    context.strokeStyle = "#ffffff"; context.lineWidth = width + halo * 2; context.stroke();
    context.strokeStyle = item.color; context.lineWidth = width; context.stroke();
  }
  context.restore();
}

function drawCurrentStitchArrow(context, point, cellSize) {
  const holes = StitchModel.holes(point);
  const from = holePixel(holes.start, cellSize), to = holePixel(holes.end, cellSize);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const dx = (to.x - from.x) / length, dy = (to.y - from.y) / length;
  const headLength = Math.min(length * 0.36, Math.max(5, cellSize * 0.36));
  const headWidth = headLength * 0.55;
  const base = { x: to.x - dx * headLength, y: to.y - dy * headLength };
  const shaft = Math.max(1.5, cellSize * 0.055);
  const halo = Math.max(1, Math.min(3, cellSize * 0.035));
  const radius = Math.max(2, cellSize * 0.075);
  const shaftPath = new Path2D();
  shaftPath.moveTo(from.x, from.y); shaftPath.lineTo(base.x, base.y);
  const headPath = new Path2D();
  headPath.moveTo(to.x, to.y);
  headPath.lineTo(base.x - dy * headWidth, base.y + dx * headWidth);
  headPath.lineTo(base.x + dy * headWidth, base.y - dx * headWidth);
  headPath.closePath();
  context.save();
  context.globalAlpha = 1; context.setLineDash([]);
  context.lineCap = "round"; context.lineJoin = "round";
  // Draw last, above the path and thread badges, so the active direction stays clear.
  context.strokeStyle = "#ffffff"; context.lineWidth = shaft + halo * 2; context.stroke(shaftPath);
  context.lineWidth = halo * 2; context.stroke(headPath);
  context.strokeStyle = "#c63848"; context.lineWidth = shaft; context.stroke(shaftPath);
  context.fillStyle = "#c63848"; context.fill(headPath);
  context.beginPath(); context.arc(from.x, from.y, radius, 0, Math.PI * 2);
  context.fillStyle = "#ffffff"; context.fill();
  context.strokeStyle = "#ffffff"; context.lineWidth = shaft + halo * 2; context.stroke();
  context.strokeStyle = "#c63848"; context.lineWidth = Math.max(1.5, shaft * 0.7); context.stroke();
  context.restore();
}

function drawPathSegment(context, fromPoint, toPoint, cellSize, alpha = 1, highlightColor = null) {
  const from = holePixel(StitchModel.holes(fromPoint).end, cellSize), to = holePixel(StitchModel.holes(toPoint).start, cellSize);
  const isCut = isCutJump(fromPoint, toPoint);
  context.save(); context.globalAlpha = alpha;
  const color = isCut ? "#c63848" : highlightColor || "#56616a";
  const width = highlightColor && !isCut ? Math.max(1.2, Math.min(3, cellSize * 0.055))
    : Math.max(0.6, Math.min(2, cellSize * (isCut ? 0.035 : 0.05)));
  context.setLineDash(isCut ? [Math.max(2, cellSize * 0.4), Math.max(2, cellSize * 0.3)] : [2, 2]);
  context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y);
  if (highlightColor && !isCut) {
    context.strokeStyle = "#ffffff"; context.lineWidth = width + Math.max(1, Math.min(2, cellSize * 0.025)) * 2; context.stroke();
  }
  context.strokeStyle = color; context.lineWidth = width; context.stroke();
  context.restore();
}

function drawThreadMarkers(context, cellSize) {
  if (!threadMarkersToggle.checked) return;
  const path = pathForDmc(selectedDmc);
  if (!path) return;
  context.save();
  context.font = "bold 11px system-ui";
  context.textAlign = "center"; context.textBaseline = "middle";
  const occupied = [];
  const active = path.points[stitchedCountForDmc(selectedDmc)];
  const activeCorner = active && holePixel(active, cellSize);
  for (const thread of stitchStats.colors[selectedDmc]?.threads || []) {
    if (thread.end === null) continue;
    const point = path.points[thread.end - 1];
    if (!point || point.x < stitchView.startX || point.x >= stitchView.startX + stitchView.width
        || point.y < stitchView.startY || point.y >= stitchView.startY + stitchView.height) continue;
    const anchor = holePixel(StitchModel.holes(point).end, cellSize);
    const radius = Math.max(9, context.measureText(String(thread.number)).width / 2 + 4);
    const center = pointCenter(point, cellSize);
    center.x = Math.min(stitchCanvas.width - radius - 1, Math.max(GRID_RULER_SIZE + radius + 1, center.x));
    center.y = Math.min(stitchCanvas.height - radius - 1, Math.max(GRID_RULER_SIZE + radius + 1, center.y));
    // Keep badges away from the active stitch and each other; the leader retains the exact hole.
    for (let ring = 0; ring < 8; ring++) {
      const offset = ring * (radius * 2 + 3);
      const candidate = [[0, offset], [0, -offset], [offset, 0], [-offset, 0]]
        .map(([x, y]) => ({ x: center.x + x, y: center.y + y }))
        .find(p => p.x - radius > GRID_RULER_SIZE && p.x + radius < stitchCanvas.width
          && p.y - radius > GRID_RULER_SIZE && p.y + radius < stitchCanvas.height
          && !occupied.some(other => Math.hypot(other.x - p.x, other.y - p.y) < other.radius + radius + 2)
          && !(activeCorner && p.x + radius + 3 > activeCorner.x && p.x - radius - 3 < activeCorner.x + cellSize
            && p.y + radius + 3 > activeCorner.y && p.y - radius - 3 < activeCorner.y + cellSize));
      if (candidate) { Object.assign(center, candidate); break; }
    }
    context.strokeStyle = "#17679b"; context.lineWidth = 1.5; context.setLineDash([]);
    context.beginPath(); context.moveTo(anchor.x, anchor.y); context.lineTo(center.x, center.y); context.stroke();
    context.fillStyle = "#17679b";
    context.beginPath(); context.arc(center.x, center.y, radius, 0, Math.PI * 2); context.fill();
    context.strokeStyle = "#ffffff"; context.stroke();
    context.fillStyle = "#ffffff"; context.fillText(String(thread.number), center.x, center.y);
    const hit = { ...center, radius, title: `DMC ${selectedDmc} - bout ${thread.number} : ${thread.end - thread.start} diagonales${thread.partial ? " (partiel)" : ""}` };
    occupied.push(hit); threadMarkerHits.push(hit);
  }
  context.restore();
}

function holePixel(hole, cellSize) {
  return { x: GRID_RULER_SIZE + (hole.x - stitchView.startX) * cellSize,
    y: GRID_RULER_SIZE + (hole.y - stitchView.startY) * cellSize };
}

function pointCenter(point, cellSize) {
  return {
    x: GRID_RULER_SIZE + (point.x - stitchView.startX + 0.5) * cellSize,
    y: GRID_RULER_SIZE + (point.y - stitchView.startY + 0.5) * cellSize
  };
}

function isCutJump(fromPoint, toPoint) {
  return Boolean(toPoint.cutBefore) || threadDistance(fromPoint, toPoint) > (loadedPaths?.settings?.cutThreshold || REALISTIC_JUMP_THRESHOLD);
}

function renderCutNotice() {
  const path = pathForDmc(selectedDmc);
  const count = stitchedCountForDmc(selectedDmc);
  let next = -1;
  if (path) for (let i = Math.max(1, count); i < path.points.length; i++) {
    if (isCutJump(path.points[i - 1], path.points[i])) { next = i; break; }
  }
  document.querySelector("#nextCutText").textContent = !path ? "" : next === count && count > 0 ? "Couper le fil avant la prochaine diagonale"
    : next >= 0 ? `Prochaine coupe dans ${next - count} diagonale(s)` : "Aucune coupe restante";
}

function threadDistance(a, b) {
  return StitchModel.distance(a, b);
}

function stitchedCellKeysForProgress() {
  const keys = new Set();
  loadedPaths.paths.forEach(path => {
    for (const [key, bits] of StitchModel.completion(path.points, stitchedCountForDmc(path.dmc)).cells) if (bits === 3) keys.add(key);
  });
  return keys;
}

function drawCircle(context, point, cellSize, fill, stroke, alpha = 1) {
  const { x: centerX, y: centerY } = pointCenter(point, cellSize);
  const radius = Math.max(3, Math.floor(cellSize * 0.38));
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = fill;
  context.strokeStyle = stroke;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

function orderedStitchPaths() {
  return ColorOrder.byCount(loadedPaths?.paths || [], path => path.points.length);
}

function renderStitchColorLegend() {
  stitchColorLegend.innerHTML = "";
  const activePaths = orderedStitchPaths().filter((path) => stitchedCountForDmc(path.dmc) < path.points.length);

  if (activePaths.length === 0) {
    stitchColorLegend.innerHTML = '<p class="empty-message">Toutes les couleurs sont terminees.</p>';
    return;
  }

  activePaths.forEach((path) => {
    const color = loadedPaths.pattern.colors.find((candidate) => candidate.dmc === path.dmc);
    const stitched = stitchedCountForDmc(path.dmc);
    const item = document.createElement("button");
    item.className = "path-color-item";
    item.type = "button";
    item.dataset.dmc = path.dmc;
    item.classList.toggle("selected", path.dmc === selectedDmc);
    item.innerHTML = `
      <span class="color-swatch"></span>
      <span>DMC ${path.dmc}</span>
      <span class="stat-label">${stitched}/${path.points.length}</span>
    `;
    item.querySelector(".color-swatch").style.background = color?.hex || "#d9dddd";
    stitchColorLegend.appendChild(item);
  });
}

function renderCompletedColorList() {
  const completedPaths = orderedStitchPaths().filter((path) => stitchedCountForDmc(path.dmc) === path.points.length);
  completedColorList.innerHTML = "";

  if (completedPaths.length === 0) {
    completedColorList.innerHTML = '<p class="empty-message">Aucune couleur terminee.</p>';
    return;
  }

  completedPaths.forEach((path) => {
    const color = loadedPaths.pattern.colors.find((candidate) => candidate.dmc === path.dmc);
    const item = document.createElement("button");
    item.className = "completed-color-item";
    item.type = "button";
    item.dataset.dmc = path.dmc;
    item.innerHTML = `
      <span class="color-swatch"></span>
      <span>DMC ${path.dmc}</span>
      <span class="stat-label">${path.points.length}</span>
    `;
    item.querySelector(".color-swatch").style.background = color?.hex || "#d9dddd";
    completedColorList.appendChild(item);
  });
}

function renderStitchControls() {
  pathsJsonFileInput.disabled = githubSyncInProgress;
  progressSaveFileInput.disabled = githubSyncInProgress;
  resetProgressToolButton.disabled = githubSyncInProgress;
  loadBuiltinProgressButton.disabled = githubSyncInProgress;
  if (!loadedPaths || !selectedDmc) {
    stitchColorStatus.className = "coverage-status invalid";
    stitchColorStatus.textContent = "Selectionne une couleur.";
    undoStitchButton.disabled = true;
    resetColorProgressButton.disabled = true;
    nextStitchButton.disabled = true;
    downloadProgressSaveButton.disabled = true;
    writeBuiltinProgressButton.disabled = true;
    return;
  }

  const path = pathForDmc(selectedDmc);
  const stitched = stitchedCountForDmc(selectedDmc);
  const complete = path && stitched === path.points.length;
  stitchColorStatus.className = `coverage-status ${complete ? "valid" : "invalid"}`;
  stitchColorStatus.textContent = complete
    ? `Couleur terminee: ${stitched} / ${path.points.length} diagonales.`
    : `Progression: ${stitched} / ${path.points.length} diagonales.`;
  undoStitchButton.disabled = stitched === 0;
  resetColorProgressButton.disabled = stitched === 0;
  nextStitchButton.disabled = complete;
  downloadProgressSaveButton.disabled = false;
  writeBuiltinProgressButton.disabled = githubSyncInProgress;
}

function isProgressStepComplete(step) {
  if (step === "load") {
    return stitchProgress.load && Boolean(loadedPaths);
  }

  return Boolean(stitchProgress[step]);
}

function canOpenProgressStep(step) {
  const stepIndex = progressStepOrder.indexOf(step);
  if (stepIndex <= 0) {
    return true;
  }

  return progressStepOrder.slice(0, stepIndex).every(isProgressStepComplete);
}

function firstOpenProgressStep() {
  return progressStepOrder.find((step) => canOpenProgressStep(step)) || "load";
}

function goToProgressStep(step) {
  if (!canOpenProgressStep(step)) {
    return;
  }

  activeProgressStep = step;
  renderProgressTool();
}

async function readSelectedPaths(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const validation = validatePathsFile(parsed);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  return StitchModel.upgradePathsFile(parsed);
}

async function readSelectedProgressSave(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const validation = validateProgressSave(parsed);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  return parsed;
}

function applyProgressSave(progressSave) {
  const validation = validateProgressSave(progressSave);
  if (!validation.valid) throw new Error(validation.message);
  progressSave = upgradedProgressSaves.get(progressSave);
  undoActions = [];
  redoActions = [];
  loadedPaths = progressSave.pathsFile;
  stitchZoom = normalizeStitchZoom(progressSave.zoom) || DEFAULT_STITCH_ZOOM;
  followCurrentPoint = Boolean(progressSave.followCurrentPoint);
  sessionMode = Boolean(progressSave.sessionMode);
  viewPosition = progressSave.viewPosition || { left: 0, top: 0 };
  stitchedByDmc = normalizeStitchedState(loadedPaths, progressSave.stitchedByDmc);
  stitchStats = StitchStats.load(progressSave.stitchStats, loadedPaths, stitchedByDmc);
  stitchStatsRevision++;
  threadMarkersToggle.checked = progressSave.showThreadMarkers !== false;
  document.querySelector("#threadChangeStatus").textContent = "";
  selectedDmc = pathForDmc(progressSave.selectedDmc)
    ? progressSave.selectedDmc
    : orderedStitchPaths()[0]?.dmc || null;
  pathsJsonFileInput.value = "";
  progressSaveFileInput.value = "";
  stitchProgress.load = true;
  stitchProgress.stitch = areAllColorsStitched(loadedPaths, stitchedByDmc);
  progressLoadError.hidden = true;
  saveProgressState();
  goToProgressStep("stitch");
  showProgressSavedStatus();
}

function validatePathsFile(data) {
  try { StitchModel.upgradePathsFile(data); return { valid: true, message: "" }; }
  catch (error) { return { valid: false, message: error.message }; }
}

function validateProgressSave(data) {
  try {
    if (!upgradedProgressSaves.has(data)) {
      const upgraded = StitchModel.upgradeProgressSave(data);
      StitchStats.load(upgraded.stitchStats, upgraded.pathsFile, upgraded.stitchedByDmc);
      upgradedProgressSaves.set(data, upgraded);
    }
    return { valid: true, message: "" };
  } catch (error) { return { valid: false, message: error.message }; }
}

function validatePattern(pattern) {
  if (!pattern || pattern.kind !== "cross-stitch-pattern" || pattern.schemaVersion !== 1) {
    return { valid: false, message: "Le pattern integre n'est pas valide." };
  }

  if (!pattern.grid || !Number.isInteger(pattern.grid.width) || !Number.isInteger(pattern.grid.height)) {
    return { valid: false, message: "Dimensions de grille invalides." };
  }

  const expectedCells = pattern.grid.width * pattern.grid.height;
  if (!Array.isArray(pattern.grid.cells) || pattern.grid.cells.length !== expectedCells) {
    return { valid: false, message: "La grille ne contient pas le bon nombre de cellules." };
  }

  if (!Array.isArray(pattern.colors) || pattern.colors.length === 0) {
    return { valid: false, message: "Liste de couleurs manquante." };
  }

  return { valid: true, message: "" };
}

function pathForDmc(dmc) {
  return loadedPaths?.paths.find((path) => path.dmc === dmc) || null;
}

function normalizeStitchedState(pathsFile, stitchedState) {
  if (!pathsFile || !stitchedState || typeof stitchedState !== "object") {
    return {};
  }

  return pathsFile.paths.reduce((normalized, path) => {
    const value = stitchedState[path.dmc] || 0;
    normalized[path.dmc] = Math.min(Math.max(Number.isInteger(value) ? value : 0, 0), path.points.length);
    return normalized;
  }, {});
}

function stitchedCountForDmc(dmc) {
  const value = stitchedByDmc[dmc] || 0;
  const path = pathForDmc(dmc);
  if (!path) {
    return 0;
  }

  return Math.min(Math.max(value, 0), path.points.length);
}

function areAllColorsStitched(pathsFile, stitchedState) {
  if (!pathsFile) {
    return false;
  }

  return pathsFile.paths.every((path) => (stitchedState[path.dmc] || 0) >= path.points.length);
}

function gridCellSize(width, height, availableWidth = 0) {
  const largestSide = Math.max(width, height);
  let baseSize = 4;
  if (largestSide <= 80) {
    baseSize = 10;
  } else if (largestSide <= 160) {
    baseSize = 6;
  }

  if (!availableWidth || width <= 0) {
    return baseSize;
  }

  const fittedSize = Math.floor(availableWidth / width);
  return Math.max(baseSize, Math.min(MAX_RESPONSIVE_CELL_SIZE, fittedSize));
}

function availableGridWidth(canvas) {
  const wrapper = canvas.parentElement;
  if (!wrapper) {
    return 0;
  }

  const wrapperStyle = window.getComputedStyle(wrapper);
  const horizontalPadding =
    parseFloat(wrapperStyle.paddingLeft || "0") + parseFloat(wrapperStyle.paddingRight || "0");
  return Math.max(0, wrapper.clientWidth - horizontalPadding);
}

function drawGridLines(context, width, height, cellSize) {
  context.save();

  for (let x = 0; x <= width; x += 1) {
    const isMajorLine = (x + stitchView.startX) % 10 === 0;
    context.strokeStyle = isMajorLine ? "rgba(34, 36, 38, 0.34)" : "rgba(34, 36, 38, 0.18)";
    context.lineWidth = isMajorLine ? 1.5 : 1;
    context.beginPath();
    context.moveTo(GRID_RULER_SIZE + x * cellSize + 0.5, GRID_RULER_SIZE);
    context.lineTo(GRID_RULER_SIZE + x * cellSize + 0.5, GRID_RULER_SIZE + height * cellSize);
    context.stroke();
  }

  for (let y = 0; y <= height; y += 1) {
    const isMajorLine = (y + stitchView.startY) % 10 === 0;
    context.strokeStyle = isMajorLine ? "rgba(34, 36, 38, 0.34)" : "rgba(34, 36, 38, 0.18)";
    context.lineWidth = isMajorLine ? 1.5 : 1;
    context.beginPath();
    context.moveTo(GRID_RULER_SIZE, GRID_RULER_SIZE + y * cellSize + 0.5);
    context.lineTo(GRID_RULER_SIZE + width * cellSize, GRID_RULER_SIZE + y * cellSize + 0.5);
    context.stroke();
  }

  context.restore();
}

function drawGridRulers(context, width, height, cellSize) {
  context.save();
  context.fillStyle = "#f4f6f4";
  context.fillRect(GRID_RULER_SIZE, 0, width * cellSize, GRID_RULER_SIZE);
  context.fillRect(0, GRID_RULER_SIZE, GRID_RULER_SIZE, height * cellSize);
  context.fillStyle = "#5f6b69";
  context.strokeStyle = "rgba(34, 36, 38, 0.24)";
  context.lineWidth = 1;
  context.font = "10px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (let x = Math.max(10, Math.ceil(stitchView.startX / 10) * 10); x <= stitchView.startX + width; x += 10) {
    const position = GRID_RULER_SIZE + (x - stitchView.startX) * cellSize;
    context.beginPath();
    context.moveTo(position + 0.5, GRID_RULER_SIZE - 7);
    context.lineTo(position + 0.5, GRID_RULER_SIZE);
    context.stroke();
    context.fillText(String(x), position, Math.floor(GRID_RULER_SIZE / 2));
  }

  context.textAlign = "right";
  for (let y = Math.max(10, Math.ceil(stitchView.startY / 10) * 10); y <= stitchView.startY + height; y += 10) {
    const position = GRID_RULER_SIZE + (y - stitchView.startY) * cellSize;
    context.beginPath();
    context.moveTo(GRID_RULER_SIZE - 7, position + 0.5);
    context.lineTo(GRID_RULER_SIZE, position + 0.5);
    context.stroke();
    context.fillText(String(y), GRID_RULER_SIZE - 9, position);
  }

  context.strokeStyle = "rgba(34, 36, 38, 0.32)";
  context.beginPath();
  context.moveTo(GRID_RULER_SIZE + 0.5, 0);
  context.lineTo(GRID_RULER_SIZE + 0.5, GRID_RULER_SIZE + height * cellSize);
  context.moveTo(0, GRID_RULER_SIZE + 0.5);
  context.lineTo(GRID_RULER_SIZE + width * cellSize, GRID_RULER_SIZE + 0.5);
  context.stroke();
  context.restore();
}

function mutedHex(hex) {
  const parsed = parseHexColor(hex);
  if (!parsed) {
    return "#eeeeee";
  }

  const mix = 0.72;
  const red = Math.round(parsed.red + (255 - parsed.red) * mix);
  const green = Math.round(parsed.green + (255 - parsed.green) * mix);
  const blue = Math.round(parsed.blue + (255 - parsed.blue) * mix);
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function parseHexColor(hex) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) {
    return null;
  }

  return {
    red: parseInt(match[1], 16),
    green: parseInt(match[2], 16),
    blue: parseInt(match[3], 16)
  };
}

function toHex(value) {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function cellKey(point) {
  return `${point.x},${point.y}`;
}

function buildProgressSave() {
  return {
    kind: "cross-stitch-progress-save",
    schemaVersion: 2,
    stitchUnit: "diagonal",
    savedAt: new Date().toISOString(),
    pathsFile: loadedPaths,
    stitchedByDmc: normalizeStitchedState(loadedPaths, stitchedByDmc),
    selectedDmc, zoom: stitchZoom, followCurrentPoint, sessionMode, viewPosition,
    stitchStats: structuredClone(stitchStats), showThreadMarkers: threadMarkersToggle.checked
  };
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildBuiltinProgressFile(progressSave = buildProgressSave()) {
  return `window.BUILTIN_STITCH_PROGRESS = ${JSON.stringify(progressSave, null, 2)};\n`;
}

function parseBuiltinProgressFile(content) {
  const prefix = "window.BUILTIN_STITCH_PROGRESS =";
  const trimmed = String(content || "").trim();
  if (!trimmed.startsWith(prefix)) {
    throw new Error("Le fichier GitHub n'est pas une sauvegarde integree valide.");
  }

  const json = trimmed.slice(prefix.length).trim().replace(/;$/, "");
  const progressSave = JSON.parse(json);
  const validation = validateProgressSave(progressSave);
  if (!validation.valid) {
    throw new Error(validation.message);
  }
  return progressSave;
}

function readGithubToken() {
  return localStorage.getItem(GITHUB_TOKEN_STORAGE_KEY) || "";
}

async function loadBuiltinProgressFromGithub() {
  if (!githubSync) {
    throw new Error("La synchronisation GitHub n'est pas disponible.");
  }
  const token = readGithubToken();
  const remote = await githubSync.loadState(token);
  if (remote) {
    const paths = await githubSync.loadPattern(remote.data.patternId, token);
    if (await progressStore.identify(paths) !== remote.data.patternId) throw new Error("Le pattern distant a ete modifie.");
    const save = progressStore.unpack(remote.data, paths);
    const valid = validateProgressSave(save);
    if (!valid.valid) throw new Error(valid.message);
    remoteSha = remote.sha;
    lastSyncedFingerprint = progressStore.fingerprint(remote.data);
    lastSyncedAt = remote.data.savedAt;
    return save;
  }
  const content = await githubSync.loadFile(token);
  remoteSha = null;
  return parseBuiltinProgressFile(content);
}

async function saveBuiltinProgressToGithub() {
  if (!githubSync) {
    throw new Error("La synchronisation GitHub n'est pas disponible.");
  }

  const token = readGithubToken();
  if (!token) {
    githubSetupPanel.classList.remove("hidden");
    goToProgressStep("load");
    window.setTimeout(() => githubTokenInput.focus(), 0);
    throw new Error("Connecte GitHub avant de synchroniser.");
  }

  saveProgressState();
  await localSaveQueue;
  const snapshot = structuredClone(latestLocalState);
  delete snapshot.undoActions;
  delete snapshot.redoActions;
  const paths = loadedPaths;
  const saved = await githubSync.saveState(snapshot, paths, token, remoteSha);
  remoteSha = saved.sha;
  lastSyncedFingerprint = progressStore.fingerprint(snapshot);
  lastSyncedAt = snapshot.savedAt;
  builtinProgressSave = progressStore.unpack(snapshot, paths);
  saveProgressState();
}

function safeFilePart(value) {
  return String(value || "cross-stitch")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "cross-stitch";
}

function showProgressSavedStatus() {
  if (!progressSaveStatus) {
    return;
  }

  progressSaveStatus.textContent = "Enregistre";
  window.setTimeout(() => {
    progressSaveStatus.textContent = "Brouillon";
  }, 1400);
}

pathsJsonFileInput.addEventListener("change", async () => {
  const file = pathsJsonFileInput.files[0];
  if (!file) {
    return;
  }

  try {
    loadedPaths = await readSelectedPaths(file);
    undoActions = []; redoActions = []; sessionMode = false;
    viewPosition = { left: 0, top: 0 };
    stitchedByDmc = {};
    stitchStats = StitchStats.create(); stitchStatsRevision++;
    document.querySelector("#threadChangeStatus").textContent = "";
    selectedDmc = orderedStitchPaths()[0]?.dmc || null;
    progressSaveFileInput.value = "";
    stitchProgress.load = true;
    stitchProgress.stitch = false;
    progressLoadError.hidden = true;
    saveProgressState();
    goToProgressStep("stitch");
    showProgressSavedStatus();
  } catch (error) {
    progressLoadError.textContent = error.message;
    progressLoadError.hidden = false;
    renderProgressTool();
  }
});

progressSaveFileInput.addEventListener("change", async () => {
  const file = progressSaveFileInput.files[0];
  if (!file) {
    return;
  }

  try {
    const progressSave = await readSelectedProgressSave(file);
    applyProgressSave(progressSave);
  } catch (error) {
    progressLoadError.textContent = error.message;
    progressLoadError.hidden = false;
    renderProgressTool();
  }
});

loadBuiltinProgressButton.addEventListener("click", async () => {
  await localSaveQueue.catch(() => {});
  if (loadedPaths && (localSaveError || progressStore.fingerprint(latestLocalState) !== lastSyncedFingerprint)
      && !confirm("Remplacer la progression locale par la sauvegarde GitHub ?")) return;
  const bundledProgressSave = builtinProgressSave;
  githubSyncInProgress = true;
  builtinProgressMessage = "Chargement de la sauvegarde GitHub...";
  renderProgressTool();

  try {
    builtinProgressSave = await loadBuiltinProgressFromGithub();
    window.BUILTIN_STITCH_PROGRESS = builtinProgressSave;
    builtinProgressMessage = "Derniere sauvegarde GitHub chargee.";
    syncConflictPanel.classList.add("hidden");
    conflictRemote = null;
    githubSyncInProgress = false;
    applyProgressSave(builtinProgressSave);
  } catch (error) {
    const fallbackValidation = validateProgressSave(bundledProgressSave);
    githubSyncInProgress = false;
    if (!loadedPaths && fallbackValidation.valid && confirm(`GitHub est indisponible. Ouvrir l'ancienne sauvegarde incluse (${bundledProgressSave.savedAt || "date inconnue"}) ?`)) {
      builtinProgressSave = bundledProgressSave;
      builtinProgressMessage = `GitHub indisponible. Sauvegarde incluse chargee: ${error.message}`;
      applyProgressSave(bundledProgressSave);
      return;
    }

    builtinProgressMessage = error.message;
    progressLoadError.textContent = error.message;
    progressLoadError.hidden = false;
    renderProgressTool();
  }
});

stitchColorLegend.addEventListener("click", (event) => {
  const button = event.target.closest("[data-dmc]");
  if (!button) {
    return;
  }

  selectedDmc = button.dataset.dmc;
  saveProgressState();
  renderProgressTool();
});

completedColorList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-dmc]");
  if (!button) {
    return;
  }

  selectedDmc = button.dataset.dmc;
  saveProgressState();
  renderProgressTool();
});

nextStitchButton.addEventListener("click", () => {
  advanceSelectedColor();
});

downloadProgressSaveButton.addEventListener("click", () => {
  if (!loadedPaths) {
    return;
  }

  const filename = `${safeFilePart(loadedPaths.project.name)}-progress-save.json`;
  downloadJson(buildProgressSave(), filename);
  showProgressSavedStatus();
});

writeBuiltinProgressButton.addEventListener("click", async () => {
  if (!loadedPaths || githubSyncInProgress) {
    return;
  }

  githubSyncInProgress = true;
  writeBuiltinProgressStatus.textContent = "Synchronisation avec GitHub...";
  renderStitchControls();
  try {
    await saveBuiltinProgressToGithub();
    builtinProgressMessage = "Sauvegarde GitHub a jour.";
    writeBuiltinProgressStatus.textContent = "Progression synchronisee sur GitHub.";
    showProgressSavedStatus();
  } catch (error) {
    writeBuiltinProgressStatus.textContent = error.message;
    if (error.status === 409) {
      conflictRemote = error.remote || await githubSync.loadState(readGithubToken()).catch(() => null);
      syncConflictPanel.classList.remove("hidden");
      const total = counts => Object.values(counts || {}).reduce((sum, count) => sum + (Number(count) || 0), 0);
      const samePattern = conflictRemote?.data.patternId === latestLocalState?.patternId;
      document.querySelector("#syncConflictText").textContent = `Version GitHub : ${conflictRemote?.data.savedAt ? new Date(conflictRemote.data.savedAt).toLocaleString("fr-CH") : "modifiee"}. ${samePattern ? `GitHub : ${total(conflictRemote.data.stitchedByDmc)} points. Ce PC : ${total(stitchedByDmc)} points.` : "Les deux versions concernent des projets differents."} La progression locale est conservee.`;
    }
    if (activeProgressStep === "load") {
      builtinProgressMessage = error.message;
      renderBuiltinProgressControls();
    }
  } finally {
    githubSyncInProgress = false;
    renderStitchControls();
    renderSyncState();
  }
});

toggleGithubSetupButton.addEventListener("click", () => {
  githubSetupPanel.classList.toggle("hidden");
  if (!githubSetupPanel.classList.contains("hidden")) {
    githubTokenInput.focus();
  }
});

saveGithubTokenButton.addEventListener("click", async () => {
  const token = githubTokenInput.value.trim();
  if (!token) {
    writeBuiltinProgressStatus.textContent = "Entre un jeton GitHub.";
    githubTokenInput.focus();
    return;
  }

  saveGithubTokenButton.disabled = true;
  writeBuiltinProgressStatus.textContent = "Verification de la connexion GitHub...";
  try {
    if (!githubSync) {
      throw new Error("La synchronisation GitHub n'est pas disponible.");
    }
    await githubSync.getFileMetadata(token);
    localStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, token);
    githubTokenInput.value = "";
    githubSetupPanel.classList.add("hidden");
    builtinProgressMessage = "Connexion GitHub enregistree sur ce PC.";
    writeBuiltinProgressStatus.textContent = "Connexion GitHub enregistree sur ce PC.";
    renderGithubConnectionControls();
    renderBuiltinProgressControls();
  } catch (error) {
    writeBuiltinProgressStatus.textContent = error.message;
  } finally {
    saveGithubTokenButton.disabled = false;
  }
});

clearGithubTokenButton.addEventListener("click", () => {
  localStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
  githubTokenInput.value = "";
  builtinProgressMessage = "Connexion GitHub oubliee sur ce PC.";
  writeBuiltinProgressStatus.textContent = "Connexion GitHub oubliee sur ce PC.";
  renderGithubConnectionControls();
  renderBuiltinProgressControls();
});

undoStitchButton.addEventListener("click", () => {
  if (!loadedPaths || !selectedDmc) {
    return;
  }

  changeStitchCount(selectedDmc, stitchedCountForDmc(selectedDmc) - 1);
});

resetColorProgressButton.addEventListener("click", () => {
  if (!selectedDmc) {
    return;
  }

  if (confirm(`Remettre DMC ${selectedDmc} a zero ?`)) changeStitchCount(selectedDmc, 0);
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isTypingTarget = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
  if (isTypingTarget || target instanceof HTMLSelectElement || target.closest("button, a") || activeProgressStep !== "stitch" || event.code !== "Space") {
    return;
  }

  event.preventDefault();
  advanceSelectedColor();
});

zoomOutButton.addEventListener("click", () => {
  setStitchZoom(stitchZoom - STITCH_ZOOM_STEP);
});

zoomInButton.addEventListener("click", () => {
  setStitchZoom(stitchZoom + STITCH_ZOOM_STEP);
});

followCurrentPointButton.addEventListener("click", () => {
  followCurrentPoint = !followCurrentPoint;
  saveProgressState();
  renderProgressTool();
  showProgressSavedStatus();
});

function setStitchZoom(value) {
  stitchZoom = normalizeStitchZoom(value) || DEFAULT_STITCH_ZOOM;
  saveProgressState();
  renderProgressTool();
  showProgressSavedStatus();
}

function advanceSelectedColor() {
  const path = pathForDmc(selectedDmc);
  if (!loadedPaths || !path) {
    return;
  }

  const stitched = stitchedCountForDmc(selectedDmc);
  if (stitched >= path.points.length) {
    return;
  }

  changeStitchCount(selectedDmc, stitched + 1);
  showProgressSavedStatus();
}

progressStepButtons.forEach((button) => {
  button.addEventListener("click", () => {
    goToProgressStep(button.dataset.step);
  });
});

let resizeRenderFrame = null;
window.addEventListener("resize", () => {
  if (resizeRenderFrame) {
    cancelAnimationFrame(resizeRenderFrame);
  }

  resizeRenderFrame = requestAnimationFrame(() => {
    resizeRenderFrame = null;
    renderProgressTool();
  });
});

resetProgressToolButton.addEventListener("click", () => {
  if (loadedPaths && !confirm("Fermer le projet local ? La sauvegarde GitHub reste disponible.")) return;
  loadedPaths = null;
  selectedDmc = null;
  stitchedByDmc = {};
  stitchStats = StitchStats.create(); stitchStatsRevision++;
  stitchZoom = DEFAULT_STITCH_ZOOM;
  followCurrentPoint = false;
  stitchProgress = {
    load: false,
    stitch: false
  };
  pathsJsonFileInput.value = "";
  progressSaveFileInput.value = "";
  progressLoadError.hidden = true;
  localStorage.removeItem(STITCH_PROGRESS_STORAGE_KEY);
  undoActions = [];
  redoActions = [];
  saveProgressState();
  renderProgressTool();
});

undoActionButton.addEventListener("click", () => {
  const action = undoActions.pop();
  if (!action) return;
  redoActions.push(action); selectedDmc = action.dmc; stitchedByDmc[action.dmc] = action.before;
  if (action.statsBefore) StitchStats.restoreColor(stitchStats, action.dmc, action.statsBefore);
  else StitchStats.rebaseColor(stitchStats, action.dmc, action.before);
  stitchStatsRevision++;
  document.querySelector("#threadChangeStatus").textContent = "";
  stitchProgress.stitch = areAllColorsStitched(loadedPaths, stitchedByDmc);
  saveProgressState(); renderProgressTool();
});
redoActionButton.addEventListener("click", () => {
  const action = redoActions.pop();
  if (!action) return;
  undoActions.push(action); selectedDmc = action.dmc; stitchedByDmc[action.dmc] = action.after;
  if (action.statsAfter) StitchStats.restoreColor(stitchStats, action.dmc, action.statsAfter);
  else StitchStats.rebaseColor(stitchStats, action.dmc, action.after);
  stitchStatsRevision++;
  document.querySelector("#threadChangeStatus").textContent = "";
  stitchProgress.stitch = areAllColorsStitched(loadedPaths, stitchedByDmc);
  saveProgressState(); renderProgressTool();
});
changeThreadButton.addEventListener("click", () => {
  if (!loadedPaths || !selectedDmc) return;
  const count = stitchedCountForDmc(selectedDmc), statsBefore = StitchStats.snapshot(stitchStats, selectedDmc);
  if (!StitchStats.finishThread(stitchStats, selectedDmc, count)) return;
  undoActions.push({ dmc: selectedDmc, before: count, after: count, statsBefore,
    statsAfter: StitchStats.snapshot(stitchStats, selectedDmc) });
  undoActions = undoActions.slice(-100); redoActions = []; stitchStatsRevision++;
  const thread = stitchStats.colors[selectedDmc].threads.at(-1);
  document.querySelector("#threadChangeStatus").textContent = `DMC ${selectedDmc} : bout ${thread.number} termine, ${count - thread.start} diagonales.`;
  saveProgressState(); renderProgressTool();
});
threadMarkersToggle.addEventListener("change", () => { renderStitchView(); saveProgressState(); });
stitchCanvas.addEventListener("mousemove", event => {
  const rect = stitchCanvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * stitchCanvas.width / rect.width;
  const y = (event.clientY - rect.top) * stitchCanvas.height / rect.height;
  stitchCanvas.title = threadMarkerHits.find(marker => Math.hypot(marker.x - x, marker.y - y) <= marker.radius)?.title || "";
});
stitchCanvas.addEventListener("click", event => {
  if (!markUntilToggle.checked || !loadedPaths) return;
  const rect = stitchCanvas.getBoundingClientRect();
  const size = stitchView.cellSize;
  const localX = (event.clientX - rect.left) * stitchCanvas.width / rect.width - GRID_RULER_SIZE;
  const localY = (event.clientY - rect.top) * stitchCanvas.height / rect.height - GRID_RULER_SIZE;
  if (localX < 0 || localY < 0) return;
  const x = stitchView.startX + Math.floor(localX / size);
  const y = stitchView.startY + Math.floor(localY / size);
  const fx = localX / size - Math.floor(localX / size), fy = localY / size - Math.floor(localY / size);
  const diagonal = Math.abs(fx + fy - 1) < Math.abs(fy - fx) ? "lower" : "upper";
  const index = pathForDmc(selectedDmc)?.points.findIndex(p => p.x === x && p.y === y && p.diagonal === diagonal) ?? -1;
  if (index >= 0) changeStitchCount(selectedDmc, index + 1);
});
document.querySelector("#sessionModeButton").addEventListener("click", () => {
  sessionMode = !sessionMode;
  centerAfterSession = !sessionMode;
  renderProgressTool(); saveProgressState();
});
document.querySelector("#fullscreenButton").addEventListener("click", async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { syncStateText.textContent = "Le plein ecran n'est pas disponible dans ce navigateur."; }
});
let viewSaveTimer;
stitchCanvas.parentElement.addEventListener("scroll", () => {
  if (restoringSession) return;
  viewPosition = { left: stitchCanvas.parentElement.scrollLeft, top: stitchCanvas.parentElement.scrollTop };
  clearTimeout(viewSaveTimer); viewSaveTimer = setTimeout(saveProgressState, 400);
});
autoSyncToggle.addEventListener("change", () => localStorage.setItem("cross-stitch-auto-sync", String(autoSyncToggle.checked)));
setInterval(() => {
  if (autoSyncToggle.checked && navigator.onLine && loadedPaths && readGithubToken() && !githubSyncInProgress
      && syncConflictPanel.classList.contains("hidden") && progressStore.fingerprint(latestLocalState) !== lastSyncedFingerprint) writeBuiltinProgressButton.click();
}, 30000);
window.addEventListener("online", renderSyncState);
window.addEventListener("offline", renderSyncState);
// Refresh daily counters across midnight even when the project is left open.
setInterval(() => {
  if (loadedPaths && activeProgressStep === "stitch") StitchStatsView.render(stitchStats, loadedPaths, stitchedByDmc, selectedDmc, stitchStatsRevision);
}, 60000);
window.addEventListener("beforeunload", event => {
  if (localSavePending || localSaveError || (loadedPaths && readGithubToken() && progressStore.fingerprint(latestLocalState) !== lastSyncedFingerprint)) { event.preventDefault(); event.returnValue = ""; }
});
document.querySelector("#useRemoteButton").addEventListener("click", () => {
  syncConflictPanel.classList.add("hidden"); loadBuiltinProgressButton.click();
});
document.querySelector("#keepLocalButton").addEventListener("click", () => {
  if (!confirm("Remplacer la version GitHub par ta version locale ? L'ancienne version restera dans l'historique.")) return;
  remoteSha = conflictRemote?.sha || null; syncConflictPanel.classList.add("hidden"); writeBuiltinProgressButton.click();
});
document.querySelector("#historyButton").addEventListener("click", async () => {
  const panel = document.querySelector("#historyPanel");
  if (!panel.classList.contains("hidden")) { panel.classList.add("hidden"); return; }
  try {
    const entries = await githubSync.history(readGithubToken());
    const select = document.querySelector("#historySelect"); select.replaceChildren();
    entries.forEach(entry => { const option = document.createElement("option"); option.value = entry.sha;
      option.textContent = new Date(entry.commit.author.date).toLocaleString("fr-CH"); select.append(option); });
    panel.classList.remove("hidden");
    document.querySelector("#restoreHistoryButton").disabled = !entries.length;
  } catch (error) { syncStateText.textContent = error.message; }
});
document.querySelector("#restoreHistoryButton").addEventListener("click", async () => {
  if (!confirm("Restaurer cette progression ? Elle sera locale jusqu'a la prochaine synchronisation.")) return;
  try {
    const latest = await githubSync.loadState(readGithubToken());
    const old = await githubSync.loadState(readGithubToken(), document.querySelector("#historySelect").value);
    const paths = await githubSync.loadPattern(old.data.patternId, readGithubToken());
    if (await progressStore.identify(paths) !== old.data.patternId) throw new Error("Le pattern distant a ete modifie.");
    const save = progressStore.unpack(old.data, paths);
    const valid = validateProgressSave(save); if (!valid.valid) throw new Error(valid.message);
    remoteSha = latest?.sha || null;
    lastSyncedFingerprint = progressStore.fingerprint(latest?.data);
    lastSyncedAt = latest?.data.savedAt || null;
    applyProgressSave(save);
    document.querySelector("#historyPanel").classList.add("hidden");
  } catch (error) { syncStateText.textContent = error.message; }
});
async function restoreLocalSession() {
  document.querySelector("main").inert = true;
  try {
    const state = await progressStore.read("active");
    if (state) {
      const paths = await progressStore.read(`pattern:${state.patternId}`);
      if (await progressStore.identify(paths) !== state.patternId) throw new Error("Le pattern local a ete modifie.");
      const save = progressStore.unpack(state, paths);
      if (!validateProgressSave(save).valid) throw new Error("Sauvegarde locale invalide.");
      if (state.schemaVersion === 2 && !await progressStore.read(`migration-backup:${state.patternId}`)) {
        await progressStore.write(`migration-backup:${state.patternId}`, state);
      }
      storedPatternIds.add(state.patternId);
      remoteSha = state.remoteSha || null; lastSyncedFingerprint = state.lastSyncedFingerprint || ""; lastSyncedAt = state.lastSyncedAt;
      restoringSession = true;
      applyProgressSave(save);
      const upgraded = upgradedProgressSaves.get(save);
      undoActions = upgraded.undoActions || []; redoActions = upgraded.redoActions || [];
      saveProgressState();
      const savedView = state.viewPosition || { left: 0, top: 0 };
      requestAnimationFrame(() => { stitchCanvas.parentElement.scrollTo(sessionMode ? 0 : savedView.left, sessionMode ? 0 : savedView.top); restoringSession = false; });
    } else if (loadedPaths) { activeProgressStep = "stitch"; saveProgressState(); }
  } catch (error) { syncStateText.textContent = `Reprise locale: ${error.message}`; }
  finally { document.querySelector("main").inert = false; renderProgressTool(); }
}
renderProgressTool();
restoreLocalSession();
