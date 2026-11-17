const PATH_PLANNER_STORAGE_KEY = "cross-stitch-path-planner";

const patternJsonFileInput = document.querySelector("#patternJsonFile");
const loadStatus = document.querySelector("#loadStatus");
const loadedProjectText = document.querySelector("#loadedProjectText");
const loadedDimensionsText = document.querySelector("#loadedDimensionsText");
const loadedColorsText = document.querySelector("#loadedColorsText");
const loadError = document.querySelector("#loadError");
const pathSaveStatus = document.querySelector("#pathSaveStatus");
const resetPathToolButton = document.querySelector("#resetPathToolButton");
const pathGridStatus = document.querySelector("#pathGridStatus");
const selectedColorLabel = document.querySelector("#selectedColorLabel");
const patternCanvas = document.querySelector("#patternCanvas");
const pathColorLegend = document.querySelector("#pathColorLegend");
const pathBuildStatus = document.querySelector("#pathBuildStatus");
const optimizedPathButton = document.querySelector("#optimizedPathButton");
const stopPathAlgorithmButton = document.querySelector("#stopPathAlgorithmButton");
const pathStagnationLimit = document.querySelector("#pathStagnationLimit");
const pathAlgorithmFeedback = document.querySelector("#pathAlgorithmFeedback");
const pathAlgorithmProgress = document.querySelector("#pathAlgorithmProgress");
const pathAlgorithmDistance = document.querySelector("#pathAlgorithmDistance");
const pathAlgorithmElapsed = document.querySelector("#pathAlgorithmElapsed");
const pathAlgorithmRestarts = document.querySelector("#pathAlgorithmRestarts");
const pathAlgorithmImprovements = document.querySelector("#pathAlgorithmImprovements");
const pathAlgorithmLastImprovement = document.querySelector("#pathAlgorithmLastImprovement");
const pathAlgorithmClockLabel = document.querySelector("#pathAlgorithmClockLabel");
const pathAlgorithmZone = document.querySelector("#pathAlgorithmZone");
const pathAlgorithmTotalScore = document.querySelector("#pathAlgorithmTotalScore");
const pathAlgorithmZonesDone = document.querySelector("#pathAlgorithmZonesDone");
const pathAlgorithmZoneInitial = document.querySelector("#pathAlgorithmZoneInitial");
const pathAlgorithmZoneScore = document.querySelector("#pathAlgorithmZoneScore");
const cutThresholdInput = document.querySelector("#cutThresholdInput");
const undoPathPointButton = document.querySelector("#undoPathPointButton");
const clearPathButton = document.querySelector("#clearPathButton");
const savePathAndNextButton = document.querySelector("#savePathAndNextButton");
const pathExportStatus = document.querySelector("#pathExportStatus");
const pathExportColorsText = document.querySelector("#pathExportColorsText");
const pathExportPathsText = document.querySelector("#pathExportPathsText");
const pathExportPointsText = document.querySelector("#pathExportPointsText");
const backToPathsButton = document.querySelector("#backToPathsButton");
const downloadPathJsonButton = document.querySelector("#downloadPathJsonButton");
const pathPerformancePanel = document.querySelector("#pathPerformancePanel");
const metricColor = document.querySelector("#metricColor");
const metricPoints = document.querySelector("#metricPoints");
const metricDistance = document.querySelector("#metricDistance");
const metricRealisticScore = document.querySelector("#metricRealisticScore");
const metricInitialScore = document.querySelector("#metricInitialScore");
const metricScoreGain = document.querySelector("#metricScoreGain");
const metricCuts = document.querySelector("#metricCuts");
const metricZoneReturns = document.querySelector("#metricZoneReturns");
const metricCutTravel = document.querySelector("#metricCutTravel");
const pathStepEyebrow = document.querySelector("#pathStepEyebrow");
const pathStepTitle = document.querySelector("#path-step-title");
const pathStepButtons = document.querySelectorAll("[data-step]");
const pathPanels = document.querySelectorAll("[data-panel]");

const pathStepLabels = {
  load: {
    eyebrow: "Etape 1",
    title: "Charger le pattern"
  },
  paths: {
    eyebrow: "Etape 2",
    title: "Chemins par couleur"
  },
  export: {
    eyebrow: "Etape 3",
    title: "Export"
  }
};

const pathStepOrder = ["load", "paths", "export"];
const ISLAND_GAP_TOLERANCE = 3;
const BACKTRACK_ISLAND_GAP_TOLERANCE = 1;
const BACKTRACK_MAX_STEP_DISTANCE = 1;
const BACKTRACK_MAX_VISITS = 45000;
const MAX_RESPONSIVE_CELL_SIZE = 18;
const GRID_RULER_SIZE = 26;
const COMPACT_PATH_CELL_SIZE = 6;
const PATH_OPTIMIZATION_TIME_LIMIT = 45000;
const DEFAULT_CUT_THRESHOLD = 10;
const DEFAULT_PATH_STAGNATION_LIMIT = 60000;
const PATH_OBJECTIVE_VERSION = 1;
const pathZoneCache = new WeakMap();

let storedState = migratePlannerState(loadStoredState());
let loadedPattern = storedState.pattern;
let pathsByDmc = storedState.pathsByDmc;
let bestPathsByDmc = storedState.bestPathsByDmc;
let pathProgress = {
  load: Boolean(loadedPattern),
  paths: Boolean(loadedPattern) && areAllColorPathsComplete(loadedPattern, storedState.pathsByDmc),
  export: false
};
let activePathStep = "load";
let selectedDmc = storedState.selectedDmc || loadedPattern?.colors[0]?.dmc || null;
let isDrawingPath = false;
let lastDrawnCellKey = null;
let lastPointerCell = null;
let pathAlgorithmRunning = false;
let pathOptimizationBaselinesByDmc = {};
let cutThreshold = storedState.cutThreshold || DEFAULT_CUT_THRESHOLD;
let pathStagnationLimitMs = storedState.pathStagnationLimitMs || DEFAULT_PATH_STAGNATION_LIMIT;
let activePathOptimizerWorker = null;
let activePathOptimizerRunId = null;
let activePathOptimizerDmc = null;
let activePathOptimizerLastSavedAt = 0;
let activePathOptimizerSnapshot = null;
let optimizerGridFrame = null;
let optimizerSnapshotFrame = null;
let pendingOptimizerSnapshot = null;
let constraintsByDmc = storedState.constraintsByDmc || {};
let batchPlan = storedState.batchPlan || { pending: [], results: [] };
let batchRunning = false;
let plannerSaveQueue = Promise.resolve();
let plannerSaveFailed = false;
let plannerSavePending = 0;
const constraintApi = window.createPathOptimizerApi();
const batchOptimizeButton = document.querySelector("#batchOptimizeButton");
const pathEditMode = document.querySelector("#pathEditMode");
const lockedPrefixCount = document.querySelector("#lockedPrefixCount");

function migratePlannerState(state) {
  if (state?.pattern && state.pathObjectiveVersion !== PATH_OBJECTIVE_VERSION) {
    state = { ...state, pathOptimizationBaselinesByDmc: {}, batchPlan: { pending: [], results: [] } };
  }
  if (!state?.pattern || state.pathSchemaVersion === 2) return state;
  const threshold = state.cutThreshold || 10, oldConstraints = state.constraintsByDmc || {};
  const convert = paths => Object.fromEntries(Object.entries(paths || {}).map(([dmc, points]) =>
    [dmc, StitchModel.expandCells(points, threshold, oldConstraints[dmc] || {})]));
  const paths = convert(state.pathsByDmc);
  const constraints = Object.fromEntries(Object.entries(paths).map(([dmc, points]) => [dmc, {
    ...(oldConstraints[dmc]?.start && points.length ? { start: copyPoint(points[0]) } : {}),
    lockedPrefix: points.slice(0, (oldConstraints[dmc]?.lockedPrefix?.length || 0) * 2).map(copyPoint),
    forcedCuts: points.filter(p => p.cutBefore).map(copyPoint)
  }]));
  return { ...state, pathSchemaVersion: 2, pathsByDmc: paths, bestPathsByDmc: convert(state.bestPathsByDmc),
    constraintsByDmc: constraints, pathOptimizationBaselinesByDmc: {}, batchPlan: { pending: [], results: [] } };
}

function loadStoredState() {
  const stored = localStorage.getItem(PATH_PLANNER_STORAGE_KEY);
  if (!stored) {
    return { pattern: null, pathsByDmc: {}, bestPathsByDmc: {} };
  }

  try {
    const parsed = JSON.parse(stored);
    if (validateFinalPattern(parsed).valid) {
      return { pattern: parsed, pathsByDmc: {}, bestPathsByDmc: {} };
    }

    if (validateFinalPattern(parsed.pattern).valid) {
      return {
        pathSchemaVersion: parsed.pathSchemaVersion,
        pathObjectiveVersion: parsed.pathObjectiveVersion,
        pattern: parsed.pattern,
        pathsByDmc: parsed.pathsByDmc && typeof parsed.pathsByDmc === "object" ? parsed.pathsByDmc : {},
        bestPathsByDmc: parsed.bestPathsByDmc && typeof parsed.bestPathsByDmc === "object" ? parsed.bestPathsByDmc : {},
        selectedDmc: typeof parsed.selectedDmc === "string" ? parsed.selectedDmc : null,
        cutThreshold: normalizeCutThreshold(parsed.cutThreshold),
        pathStagnationLimitMs: normalizePathStagnationLimit(parsed.pathStagnationLimitMs),
        constraintsByDmc: parsed.constraintsByDmc || {},
        batchPlan: parsed.batchPlan
      };
    }

    return { pattern: null, pathsByDmc: {}, bestPathsByDmc: {} };
  } catch {
    return { pattern: null, pathsByDmc: {}, bestPathsByDmc: {} };
  }
}

function savePathPlannerState() {
  const snapshot = loadedPattern ? structuredClone({
    pathSchemaVersion: 2,
    pathObjectiveVersion: PATH_OBJECTIVE_VERSION,
    pattern: loadedPattern,
    pathsByDmc,
    bestPathsByDmc,
    selectedDmc,
    cutThreshold,
    pathStagnationLimitMs,
    constraintsByDmc,
    batchPlan,
    pathOptimizationBaselinesByDmc
  }) : null;
  plannerSavePending++;
  plannerSaveQueue = plannerSaveQueue.catch(() => {}).then(async () => {
    await window.PathPlannerStore.write(snapshot);
    localStorage.removeItem(PATH_PLANNER_STORAGE_KEY);
    plannerSaveFailed = false;
    pathSaveStatus.textContent = "Enregistre localement";
  }).catch(error => {
    plannerSaveFailed = true;
    pathSaveStatus.textContent = "Sauvegarde impossible";
    pathSaveStatus.title = error.message;
  }).finally(() => { plannerSavePending--; });
  return plannerSaveQueue;
}

function normalizeCutThreshold(value) {
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return null;
  }

  return Math.max(1, Math.round(threshold));
}

function normalizePathStagnationLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit < 10000 || limit > 3600000) {
    return null;
  }

  return Math.round(limit);
}

function realisticCutPenalty() {
  return cutThreshold * 3;
}

function renderPathTool() {
  if (!canOpenPathStep(activePathStep)) {
    activePathStep = firstOpenPathStep();
  }

  const label = pathStepLabels[activePathStep];
  pathStepEyebrow.textContent = label.eyebrow;
  pathStepTitle.textContent = label.title;
  resetPathToolButton.disabled = pathAlgorithmRunning;
  cutThresholdInput.value = String(cutThreshold);
  pathStagnationLimit.value = String(pathStagnationLimitMs);

  pathStepButtons.forEach((button) => {
    const step = button.dataset.step;
    const isComplete = isPathStepComplete(step);
    const isLocked = !canOpenPathStep(step);

    button.classList.toggle("active", step === activePathStep);
    button.classList.toggle("complete", isComplete);
    button.classList.toggle("locked", isLocked);
    button.disabled = isLocked;
  });

  pathPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.panel !== activePathStep);
  });
  pathPerformancePanel.classList.toggle("hidden", activePathStep !== "paths");

  renderLoadedPattern();
  renderPatternGrid();
  renderPathExport();
  renderPathMetrics();
  renderPlanningOptions();
}

function renderLoadedPattern() {
  if (!loadedPattern) {
    loadStatus.className = "coverage-status invalid";
    loadStatus.textContent = "Aucun fichier charge.";
    loadedProjectText.textContent = "-";
    loadedDimensionsText.textContent = "0 x 0";
    loadedColorsText.textContent = "0";
    return;
  }

  const loadedPathCount = loadedPattern.colors.filter((color) => (
    isCompletePathForColor(loadedPattern, pathsByDmc, color.dmc)
  )).length;
  loadStatus.className = "coverage-status valid";
  loadStatus.textContent = loadedPathCount > 0
    ? `Pattern et ${loadedPathCount} chemin${loadedPathCount > 1 ? "s" : ""} charges.`
    : "Pattern charge et format valide.";
  loadedProjectText.textContent = loadedPattern.project.name;
  loadedDimensionsText.textContent = `${loadedPattern.grid.width} x ${loadedPattern.grid.height}`;
  loadedColorsText.textContent = String(loadedPattern.colors.length);
}

function renderPatternGrid() {
  const context = patternCanvas.getContext("2d");

  if (!loadedPattern) {
    patternCanvas.width = 1;
    patternCanvas.height = 1;
    context.clearRect(0, 0, 1, 1);
    pathColorLegend.innerHTML = "";
    selectedColorLabel.textContent = "Aucune couleur selectionnee";
    pathGridStatus.className = "coverage-status invalid";
    pathGridStatus.textContent = "Charge un pattern pour afficher la grille.";
    return;
  }

  const colorByDmc = new Map(loadedPattern.colors.map((color) => [color.dmc, color]));
  if (!selectedDmc || !colorByDmc.has(selectedDmc)) {
    selectedDmc = loadedPattern.colors[0]?.dmc || null;
  }

  const cellSize = gridCellSize(
    loadedPattern.grid.width,
    loadedPattern.grid.height,
    availableGridWidth(patternCanvas) - GRID_RULER_SIZE
  );
  const selectedColor = colorByDmc.get(selectedDmc);
  selectedColorLabel.textContent = selectedColor
    ? `DMC ${selectedColor.dmc} - ${selectedColor.symbol || ""}`
    : "Aucune couleur selectionnee";
  patternCanvas.width = GRID_RULER_SIZE + loadedPattern.grid.width * cellSize;
  patternCanvas.height = GRID_RULER_SIZE + loadedPattern.grid.height * cellSize;
  context.clearRect(0, 0, patternCanvas.width, patternCanvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, patternCanvas.width, patternCanvas.height);

  loadedPattern.grid.cells.forEach((cell) => {
    const color = colorByDmc.get(cell.dmc);
    if (cell.empty) {
      context.fillStyle = "#ffffff";
    } else if (cell.dmc === selectedDmc) {
      context.fillStyle = color?.hex || "#d9dddd";
    } else {
      context.fillStyle = mutedHex(color?.hex || "#d9dddd");
    }

    context.fillRect(
      GRID_RULER_SIZE + cell.x * cellSize,
      GRID_RULER_SIZE + cell.y * cellSize,
      cellSize,
      cellSize
    );
  });

  if (cellSize >= 6) {
    drawGridLines(context, loadedPattern.grid.width, loadedPattern.grid.height, cellSize);
  }

  drawGridRulers(context, loadedPattern.grid.width, loadedPattern.grid.height, cellSize);
  drawSelectedPath(context, cellSize);
  const zone = pathAlgorithmRunning && activePathOptimizerSnapshot?.zone;
  if (zone?.status === "running" && zone.bounds) {
    const { minX, minY, maxX, maxY } = zone.bounds;
    const x = GRID_RULER_SIZE + minX * cellSize, y = GRID_RULER_SIZE + minY * cellSize;
    context.save();
    context.strokeStyle = "#ffffff"; context.lineWidth = 5;
    context.strokeRect(x, y, (maxX - minX) * cellSize, (maxY - minY) * cellSize);
    context.strokeStyle = "#007ea8"; context.lineWidth = 2;
    context.strokeRect(x, y, (maxX - minX) * cellSize, (maxY - minY) * cellSize);
    context.restore();
  }

  renderPathColorLegend();
  renderPathBuilder();
  pathGridStatus.className = "coverage-status valid";
  renderPathGridStatus();
}

function renderPathGridStatus(metrics = activePathOptimizerSnapshot?.metrics) {
  const snapshot = pathAlgorithmRunning && activePathOptimizerSnapshot;
  pathGridStatus.textContent = snapshot && Number.isFinite(metrics?.score)
    ? `${snapshot.phase} - DMC ${selectedDmc} - score total ${formatMetric(metrics.score)}`
    : `Couleur selectionnee: DMC ${selectedDmc}.`;
}

function drawSelectedPath(context, cellSize) {
  const path = currentPath(), colors = selectedPathDrawingColors();
  context.save(); context.lineCap = "round";
  const pixel = hole => ({ x: GRID_RULER_SIZE + hole.x * cellSize, y: GRID_RULER_SIZE + hole.y * cellSize });
  path.forEach((point, index) => {
    if (index) drawPathSegment(context, path[index - 1], point, cellSize, colors);
  });
  path.forEach((point, index) => {
    const holes = StitchModel.holes(point), from = pixel(holes.start), to = pixel(holes.end);
    context.strokeStyle = colors.line; context.lineWidth = Math.max(1, cellSize * 0.14);
    context.setLineDash([]);
    context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke();
    if (index === path.length - 1) {
      context.fillStyle = "#c63848";
      context.beginPath(); context.arc(to.x, to.y, Math.max(2, cellSize * 0.16), 0, Math.PI * 2); context.fill();
      context.strokeStyle = "#c63848"; context.strokeRect(from.x - 2, from.y - 2, 4, 4);
    }
  });
  context.restore();
}

function selectedPathDrawingColors() {
  const selectedColor = loadedPattern?.colors.find((color) => color.dmc === selectedDmc);
  const parsed = parseHexColor(selectedColor?.hex || "");
  const isDark = parsed ? colorLuminance(parsed) < 105 : false;

  if (isDark) {
    return {
      line: "#ffffff",
      cutLine: "#ffb3bd",
      pointFill: "#ffffff",
      pointStroke: "#111517",
      currentPointFill: "#ffedf0"
    };
  }

  return {
    line: "#222426",
    cutLine: "#b44b57",
    pointFill: "#222426",
    pointStroke: "#222426",
    currentPointFill: "#ffffff"
  };
}

function pathPointStyle(cellSize) {
  if (cellSize <= COMPACT_PATH_CELL_SIZE) {
    const size = Math.max(1.4, cellSize * 0.46);
    return {
      shape: "square",
      size,
      strokeWidth: Math.max(0.6, cellSize * 0.12)
    };
  }

  return {
    shape: "circle",
    radius: Math.max(1.6, cellSize * 0.3),
    strokeWidth: Math.max(1, cellSize * 0.13)
  };
}

function drawPathSegment(context, fromPoint, toPoint, cellSize, colors) {
  const from = StitchModel.holes(fromPoint).end, to = StitchModel.holes(toPoint).start;
  const isCut = isCutJump(fromPoint, toPoint);
  context.strokeStyle = isCut ? "#c63848" : colors.line;
  context.lineWidth = Math.max(0.6, cellSize * (isCut ? 0.045 : 0.065));
  context.setLineDash(isCut ? pathCutDash(cellSize) : [Math.max(1, cellSize * 0.15), Math.max(1, cellSize * 0.15)]);
  context.beginPath();
  context.moveTo(GRID_RULER_SIZE + from.x * cellSize, GRID_RULER_SIZE + from.y * cellSize);
  context.lineTo(GRID_RULER_SIZE + to.x * cellSize, GRID_RULER_SIZE + to.y * cellSize);
  context.stroke(); context.setLineDash([]);
}

function pathSegmentWidth(cellSize, isCut) {
  const scale = isCut ? 0.13 : 0.18;
  return Math.max(0.6, Math.min(cellSize * scale, cellSize - 1));
}

function pathCutDash(cellSize) {
  return [
    Math.max(1.5, cellSize * 0.55),
    Math.max(1.2, cellSize * 0.42)
  ];
}

function pointCenter(point, cellSize) {
  return {
    x: GRID_RULER_SIZE + (point.x + 0.5) * cellSize,
    y: GRID_RULER_SIZE + (point.y + 0.5) * cellSize
  };
}

function renderPathBuilder() {
  stopPathAlgorithmButton.classList.toggle("hidden", !activePathOptimizerWorker);
  stopPathAlgorithmButton.disabled = !activePathOptimizerWorker;
  pathStagnationLimit.disabled = pathAlgorithmRunning;
  cutThresholdInput.disabled = pathAlgorithmRunning;

  if (!loadedPattern || !selectedDmc) {
    pathBuildStatus.className = "coverage-status invalid";
    pathBuildStatus.textContent = "Selectionne une couleur pour construire son chemin.";
    optimizedPathButton.disabled = true;
    undoPathPointButton.disabled = true;
    clearPathButton.disabled = true;
    savePathAndNextButton.disabled = true;
    return;
  }

  const path = currentPath();
  const expected = cellsForSelectedColor().length * 2;
  const complete = isPathComplete(selectedDmc);
  pathBuildStatus.className = `coverage-status ${complete ? "valid" : "invalid"}`;
  pathBuildStatus.textContent = complete
    ? `Chemin complet: ${path.length} / ${expected} diagonales.`
    : `Chemin en cours: ${path.length} / ${expected} diagonales.`;
  optimizedPathButton.disabled = expected === 0 || pathAlgorithmRunning;
  undoPathPointButton.disabled = path.length === 0 || pathAlgorithmRunning;
  clearPathButton.disabled = path.length === 0 || pathAlgorithmRunning;
  savePathAndNextButton.disabled = !complete || pathAlgorithmRunning;

  if (!pathAlgorithmRunning) {
    renderPathDistanceFeedback();
  }
}

function renderPathDistanceFeedback() {
  resetAlgorithmLiveMetrics();
  const path = currentPath();
  if (path.length === 0) {
    const bestPath = Array.isArray(bestPathsByDmc[selectedDmc]) ? bestPathsByDmc[selectedDmc] : null;
    if (bestPath?.length) {
      showAlgorithmFeedback("Meilleur en memoire", 100, pathRealisticScore(bestPath), null, pathPerformanceMetrics(bestPath));
      return;
    }

    showAlgorithmFeedback(`DMC ${selectedDmc}: aucun chemin teste`, 0, null);
    return;
  }

  const bestPath = Array.isArray(bestPathsByDmc[selectedDmc]) ? bestPathsByDmc[selectedDmc] : null;
  const currentScore = pathRealisticScore(path);
  const bestScore = bestPath ? pathRealisticScore(bestPath) : currentScore;
  showAlgorithmFeedback("Chemin actuel", 100, bestScore, currentScore, pathPerformanceMetrics(path));
}

function renderPathMetrics() {
  if (!loadedPattern || !selectedDmc) {
    metricColor.textContent = "-";
    metricPoints.textContent = "0 / 0";
    metricDistance.textContent = "-";
    metricRealisticScore.textContent = "-";
    metricInitialScore.textContent = "-";
    metricScoreGain.textContent = "-";
    metricCuts.textContent = "-";
    metricZoneReturns.textContent = "-";
    metricCutTravel.textContent = "-";
    return;
  }

  const path = currentPath();
  const expected = cellsForSelectedColor().length * 2;
  const metrics = pathPerformanceMetrics(path);

  metricColor.textContent = `DMC ${selectedDmc}`;
  metricPoints.textContent = `${path.length} / ${expected}`;
  metricDistance.textContent = path.length > 1 ? formatMetric(metrics.distance) : "-";
  metricRealisticScore.textContent = path.length > 1 ? formatMetric(metrics.realisticScore) : "-";
  const baselineScore = pathOptimizationBaselinesByDmc[selectedDmc];
  if (path.length > 1 && baselineScore !== undefined) {
    metricInitialScore.textContent = formatMetric(baselineScore);
    metricScoreGain.textContent = formatSignedMetric(baselineScore - metrics.realisticScore);
  } else {
    metricInitialScore.textContent = "-";
    metricScoreGain.textContent = "-";
  }
  metricCuts.textContent = path.length > 1 ? String(metrics.cuts) : "-";
  metricZoneReturns.textContent = String(metrics.zoneReturns);
  metricCutTravel.textContent = path.length > 1 ? formatMetric(metrics.cutTravel) : "-";
}

function pathPerformanceMetrics(path, dmc = selectedDmc) {
  if (!loadedPattern) return { ...StitchModel.metrics(path, cutThreshold, true), zoneReturns: 0, zoneCount: 0 };
  if (!pathZoneCache.has(loadedPattern)) pathZoneCache.set(loadedPattern, new Map());
  const cache = pathZoneCache.get(loadedPattern);
  if (!cache.has(dmc)) cache.set(dmc, StitchModel.createZones(cellsForColor(dmc)));
  return cache.get(dmc).measure(path, cutThreshold);
}

function formatMetric(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatSignedMetric(value) {
  if (value === 0) {
    return "0";
  }

  return `${value > 0 ? "+" : ""}${formatMetric(value)}`;
}

function renderPathExport() {
  const ready = Boolean(loadedPattern) && areAllColorPathsComplete(loadedPattern, pathsByDmc);
  const exportData = loadedPattern ? buildPathExport() : null;
  const pathCount = exportData?.paths.length || 0;
  const pointCount = exportData?.paths.reduce((sum, path) => sum + path.points.length, 0) || 0;

  pathExportColorsText.textContent = String(loadedPattern?.colors.length || 0);
  pathExportPathsText.textContent = String(pathCount);
  pathExportPointsText.textContent = String(pointCount);
  pathExportStatus.className = `coverage-status ${ready ? "valid" : "invalid"}`;
  pathExportStatus.textContent = ready
    ? "JSON des chemins pret."
    : "Complete tous les chemins avant l'export.";
  downloadPathJsonButton.disabled = !ready;
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

function colorLuminance(color) {
  return color.red * 0.2126 + color.green * 0.7152 + color.blue * 0.0722;
}

function toHex(value) {
  return value.toString(16).padStart(2, "0").toUpperCase();
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
    const isMajorLine = x % 10 === 0;
    context.strokeStyle = isMajorLine ? "rgba(34, 36, 38, 0.34)" : "rgba(34, 36, 38, 0.18)";
    context.lineWidth = isMajorLine ? 1.5 : 1;
    context.beginPath();
    context.moveTo(GRID_RULER_SIZE + x * cellSize + 0.5, GRID_RULER_SIZE);
    context.lineTo(GRID_RULER_SIZE + x * cellSize + 0.5, GRID_RULER_SIZE + height * cellSize);
    context.stroke();
  }

  for (let y = 0; y <= height; y += 1) {
    const isMajorLine = y % 10 === 0;
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

  for (let x = 10; x <= width; x += 10) {
    const position = GRID_RULER_SIZE + x * cellSize;
    context.beginPath();
    context.moveTo(position + 0.5, GRID_RULER_SIZE - 7);
    context.lineTo(position + 0.5, GRID_RULER_SIZE);
    context.stroke();
    context.fillText(String(x), position, Math.floor(GRID_RULER_SIZE / 2));
  }

  context.textAlign = "right";
  for (let y = 10; y <= height; y += 10) {
    const position = GRID_RULER_SIZE + y * cellSize;
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

function renderPathColorLegend() {
  pathColorLegend.innerHTML = "";

  loadedPattern.colors.forEach((color) => {
    const path = pathsByDmc[color.dmc] || [];
    const expected = cellsForColor(color.dmc).length * 2;
    const complete = expected > 0 && path.length === expected;
    const item = document.createElement("button");
    item.className = "path-color-item";
    item.type = "button";
    item.dataset.dmc = color.dmc;
    item.classList.toggle("selected", color.dmc === selectedDmc);
    item.classList.toggle("complete", complete);
    item.innerHTML = `
      <span class="color-swatch"></span>
      <span>DMC ${color.dmc}</span>
      <span class="stat-label">${path.length}/${expected}</span>
    `;
    item.querySelector(".color-swatch").style.background = color.hex;
    pathColorLegend.appendChild(item);
  });
}

function currentPath() {
  if (!selectedDmc) {
    return [];
  }

  if (!Array.isArray(pathsByDmc[selectedDmc])) {
    pathsByDmc[selectedDmc] = [];
  }

  return pathsByDmc[selectedDmc];
}

function cellsForSelectedColor() {
  return cellsForColor(selectedDmc);
}

function cellsForColor(dmc) {
  if (!loadedPattern || !dmc) {
    return [];
  }

  return loadedPattern.grid.cells.filter((cell) => !cell.empty && cell.dmc === dmc);
}

function snakePathForCells(cells) {
  const rows = new Map();
  cells.forEach((cell) => {
    if (!rows.has(cell.y)) {
      rows.set(cell.y, []);
    }

    rows.get(cell.y).push(cell);
  });

  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([y, rowCells]) => {
      const sorted = rowCells
        .slice()
        .sort((a, b) => a.x - b.x);
      return y % 2 === 0 ? sorted : sorted.reverse();
    })
    .map((cell) => ({ x: cell.x, y: cell.y }));
}

function islandSnakePathForColor(dmc) {
  const islands = islandsForCells(cellsForColor(dmc));
  const islandPaths = islands.map((island) => snakePathForCells(island));
  return orderIslandPaths(islandPaths).flat();
}

function backtrackIslandPathForColor(dmc) {
  const islands = islandsForCells(cellsForColor(dmc), BACKTRACK_ISLAND_GAP_TOLERANCE);
  const islandPaths = islands.map((island) => backtrackedPathForIsland(island));
  return orderIslandPaths(islandPaths).flat();
}

function progressiveIslandPathForColor(dmc) {
  const islands = strictIslandsForCells(cellsForColor(dmc))
    .map((island) => pathCluster(internalIslandPath(island)));
  return mergeClustersByGrowingDistance(islands).flatMap((cluster) => cluster.path);
}

async function optimizedPathForColor(dmc, reportProgress) {
  const cells = cellsForColor(dmc);
  if (cells.length <= 2) {
    return cells.map((cell) => ({ x: cell.x, y: cell.y }));
  }

  const candidates = [
    progressiveIslandPathForColor(dmc),
    snakePathForCells(cells)
  ];
  const cellsByKey = new Map(cells.map((cell) => [cellKey(cell), cell]));
  pathOptimizationStartPoints(cells).forEach((start) => {
    candidates.push(nearestNeighborPath(start, cellsByKey));
  });

  let bestPath = candidates
    .filter((path) => path.length === cells.length)
    .sort((a, b) => comparePathPerformance(a, b))[0] || progressiveIslandPathForColor(dmc);
  let bestScore = pathPerformanceMetrics(bestPath).realisticScore;
  const startedAt = performance.now();

  await reportProgress({
    phase: "Point de depart",
    path: bestPath,
    distance: bestScore,
    progress: 5
  });

  let improved = true;
  let pass = 0;
  while (improved && performance.now() - startedAt < PATH_OPTIMIZATION_TIME_LIMIT) {
    improved = false;
    pass += 1;

    for (let start = 1; start < bestPath.length - 2; start += 1) {
      for (let end = start + 1; end < bestPath.length - 1; end += 1) {
        const currentBridge = realisticStepCost(bestPath[start - 1], bestPath[start])
          + realisticStepCost(bestPath[end], bestPath[end + 1]);
        const candidateBridge = realisticStepCost(bestPath[start - 1], bestPath[end])
          + realisticStepCost(bestPath[start], bestPath[end + 1]);

        if (candidateBridge < currentBridge) {
          bestPath = reversePathSegment(bestPath, start, end);
          bestScore += candidateBridge - currentBridge;
          improved = true;
        }

        if ((start + end) % 250 === 0) {
          const elapsed = performance.now() - startedAt;
          await reportProgress({
            phase: `Passe ${pass}`,
            path: bestPath,
            distance: bestScore,
            progress: Math.min(98, 5 + (elapsed / PATH_OPTIMIZATION_TIME_LIMIT) * 93)
          });

          if (elapsed >= PATH_OPTIMIZATION_TIME_LIMIT) {
            return bestPath;
          }
        }
      }
    }
  }

  await reportProgress({
    phase: "Termine",
    path: bestPath,
    distance: bestScore,
    progress: 100
  });
  return bestPath;
}

function pathOptimizationStartPoints(cells) {
  const sorted = cells
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const candidates = [
    sorted[0],
    sorted[Math.floor(sorted.length / 2)],
    sorted[sorted.length - 1],
    sorted.reduce((best, cell) => (cell.x < best.x || (cell.x === best.x && cell.y < best.y) ? cell : best), sorted[0]),
    sorted.reduce((best, cell) => (cell.x > best.x || (cell.x === best.x && cell.y < best.y) ? cell : best), sorted[0]),
    sorted.reduce((best, cell) => (cell.y > best.y || (cell.y === best.y && cell.x < best.x) ? cell : best), sorted[0]),
    sorted.reduce((best, cell) => (cell.y > best.y || (cell.y === best.y && cell.x > best.x) ? cell : best), sorted[0])
  ];

  return uniquePathPoints(candidates.concat(sorted.filter((_, index) => index % Math.max(1, Math.floor(sorted.length / 8)) === 0)));
}

function uniquePathPoints(points) {
  const seen = new Set();
  return points.filter((point) => {
    if (!point || seen.has(cellKey(point))) {
      return false;
    }

    seen.add(cellKey(point));
    return true;
  }).slice(0, 14);
}

function reversePathSegment(path, start, end) {
  return path
    .slice(0, start)
    .concat(path.slice(start, end + 1).reverse())
    .concat(path.slice(end + 1));
}

function pathDistance(path) {
  return path.reduce((distance, point, index) => {
    if (index === 0) {
      return distance;
    }

    return distance + threadDistance(path[index - 1], point);
  }, 0);
}

function pathRealisticScore(path) {
  return pathPerformanceMetrics(path).realisticScore;
}

function comparePathPerformance(a, b, dmc = selectedDmc) {
  return StitchModel.compareZoneMetrics(pathPerformanceMetrics(a, dmc), pathPerformanceMetrics(b, dmc));
}

function realisticStepCost(fromPoint, toPoint) {
  const jump = threadDistance(fromPoint, toPoint);
  return isCutDistance(jump) ? realisticCutPenalty() : jump;
}

function isCutJump(fromPoint, toPoint) {
  return Boolean(toPoint.cutBefore) || isCutDistance(threadDistance(fromPoint, toPoint));
}

function isCutDistance(distance) {
  return distance > cutThreshold;
}

function rememberBestPath(dmc, candidatePath) {
  if (!Array.isArray(candidatePath) || candidatePath.length === 0) {
    return {
      path: candidatePath || [],
      candidateDistance: 0,
      bestDistance: 0,
      improved: false
    };
  }

  const candidateDistance = pathRealisticScore(candidatePath);
  const currentBest = Array.isArray(bestPathsByDmc[dmc]) && constraintApi.satisfiesConstraints(bestPathsByDmc[dmc], constraintsByDmc[dmc]) ? bestPathsByDmc[dmc] : null;
  const bestDistance = currentBest ? pathRealisticScore(currentBest) : Number.POSITIVE_INFINITY;
  const improved = !currentBest || comparePathPerformance(candidatePath, currentBest, dmc) < 0;

  if (improved) {
    bestPathsByDmc[dmc] = candidatePath.map(copyPoint);
  }

  const bestPath = improved ? bestPathsByDmc[dmc] : currentBest || candidatePath;
  return {
    path: bestPath.map(copyPoint),
    candidateDistance,
    bestDistance: improved ? candidateDistance : bestDistance,
    improved
  };
}

function copyPoint(point) {
  return point.diagonal ? StitchModel.copy(point) : { x: point.x, y: point.y };
}

function strictIslandsForCells(cells) {
  const remaining = new Map(cells.map((cell) => [cellKey(cell), cell]));
  const islands = [];

  while (remaining.size > 0) {
    const start = remaining.values().next().value;
    const island = [];
    const queue = [start];
    remaining.delete(cellKey(start));

    while (queue.length > 0) {
      const current = queue.shift();
      island.push(current);

      Array.from(remaining.values()).forEach((candidate) => {
        if (chebyshevDistance(current, candidate) <= 1) {
          remaining.delete(cellKey(candidate));
          queue.push(candidate);
        }
      });
    }

    islands.push(island);
  }

  return islands.sort((a, b) => islandSortValue(a).y - islandSortValue(b).y || islandSortValue(a).x - islandSortValue(b).x);
}

function internalIslandPath(island) {
  const cellsByKey = new Map(island.map((cell) => [cellKey(cell), cell]));
  const starts = island
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x);
  let bestPath = null;
  let bestScore = null;

  starts.forEach((start) => {
    const path = nearestNeighborPath(start, cellsByKey);
    const score = progressivePathScore(path);
    if (!bestScore || isBetterProgressiveScore(score, bestScore)) {
      bestPath = path;
      bestScore = score;
    }
  });

  return bestPath || snakePathForCells(island);
}

function nearestNeighborPath(start, cellsByKey) {
  const remaining = new Map(cellsByKey);
  const path = [];
  let current = start;

  while (current) {
    path.push({ x: current.x, y: current.y });
    remaining.delete(cellKey(current));
    current = nearestCell(current, Array.from(remaining.values()));
  }

  return path;
}

function nearestCell(point, cells) {
  return cells.reduce((best, cell) => {
    const distance = chebyshevDistance(point, cell);
    if (!best || distance < best.distance || (
      distance === best.distance && (cell.y < best.cell.y || (cell.y === best.cell.y && cell.x < best.cell.x))
    )) {
      return { cell, distance };
    }

    return best;
  }, null)?.cell || null;
}

function pathCluster(path) {
  return {
    path,
    cells: path.map((point) => ({ x: point.x, y: point.y }))
  };
}

function mergeClustersByGrowingDistance(clusters) {
  const remaining = clusters.filter((cluster) => cluster.path.length > 0);
  if (remaining.length <= 1) {
    return remaining;
  }

  let distance = 2;
  while (remaining.length > 1) {
    const merge = closestClusterMerge(remaining, distance);
    if (!merge) {
      distance += 1;
      continue;
    }

    const first = remaining[merge.firstIndex];
    const second = remaining[merge.secondIndex];
    const merged = mergeClusters(first, second, merge.reverseFirst, merge.reverseSecond);
    remaining.splice(merge.secondIndex, 1);
    remaining.splice(merge.firstIndex, 1, merged);
    distance = 2;
  }

  return remaining;
}

function closestClusterMerge(clusters, maxDistance) {
  let best = null;

  for (let firstIndex = 0; firstIndex < clusters.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < clusters.length; secondIndex += 1) {
      const candidate = bestConnectionBetweenClusters(clusters[firstIndex], clusters[secondIndex]);
      if (candidate.distance > maxDistance) {
        continue;
      }

      if (!best || candidate.distance < best.distance) {
        best = { firstIndex, secondIndex, ...candidate };
      }
    }
  }

  return best;
}

function bestConnectionBetweenClusters(first, second) {
  const firstStart = first.path[0];
  const firstEnd = first.path[first.path.length - 1];
  const secondStart = second.path[0];
  const secondEnd = second.path[second.path.length - 1];
  const candidates = [
    { reverseFirst: false, reverseSecond: false, distance: chebyshevDistance(firstEnd, secondStart) },
    { reverseFirst: false, reverseSecond: true, distance: chebyshevDistance(firstEnd, secondEnd) },
    { reverseFirst: true, reverseSecond: false, distance: chebyshevDistance(firstStart, secondStart) },
    { reverseFirst: true, reverseSecond: true, distance: chebyshevDistance(firstStart, secondEnd) }
  ];

  return candidates.sort((a, b) => a.distance - b.distance)[0];
}

function mergeClusters(first, second, reverseFirst, reverseSecond) {
  const firstPath = reverseFirst ? first.path.slice().reverse() : first.path.slice();
  const secondPath = reverseSecond ? second.path.slice().reverse() : second.path.slice();
  return pathCluster(firstPath.concat(secondPath));
}

function backtrackedPathForIsland(island) {
  if (island.length <= 2) {
    return snakePathForCells(island);
  }

  const basePath = snakePathForCells(island);
  if (maxStepDistance(basePath) <= BACKTRACK_MAX_STEP_DISTANCE) {
    return basePath;
  }

  const starts = candidateStartPoints(island);
  let bestPath = basePath;
  let bestScore = pathJumpScore(basePath);
  let visits = 0;

  for (const start of starts) {
    const result = searchIslandPath(island, start, () => {
      visits += 1;
      return visits <= BACKTRACK_MAX_VISITS;
    });

    if (result.path && isBetterPathScore(result.score, bestScore)) {
      bestPath = result.path;
      bestScore = result.score;
    }

    if (bestScore.largeJumps === 0) {
      break;
    }
  }

  return bestPath;
}

function candidateStartPoints(island) {
  return island
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, 10);
}

function searchIslandPath(island, start, shouldContinue) {
  const cellsByKey = new Map(island.map((cell) => [cellKey(cell), cell]));
  const visited = new Set([cellKey(start)]);
  const path = [{ x: start.x, y: start.y }];
  let bestPath = path.slice();
  let bestScore = pathJumpScore(bestPath);

  function visit(current) {
    if (!shouldContinue()) {
      return false;
    }

    const score = pathJumpScore(path);
    if (score.largeJumps < bestScore.largeJumps || (score.largeJumps === bestScore.largeJumps && path.length > bestPath.length)) {
      bestPath = path.slice();
      bestScore = score;
    }

    if (path.length === island.length) {
      bestPath = path.slice();
      bestScore = pathJumpScore(path);
      return bestScore.largeJumps === 0;
    }

    const candidates = backtrackCandidates(current, cellsByKey, visited);
    for (const candidate of candidates) {
      visited.add(cellKey(candidate));
      path.push({ x: candidate.x, y: candidate.y });

      if (visit(candidate)) {
        return true;
      }

      path.pop();
      visited.delete(cellKey(candidate));
    }

    return false;
  }

  visit(start);
  const completedPath = completePathWithNearestRemainder(bestPath, island);
  return { path: completedPath, score: pathJumpScore(completedPath) };
}

function backtrackCandidates(current, cellsByKey, visited) {
  return Array.from(cellsByKey.values())
    .filter((cell) => !visited.has(cellKey(cell)))
    .map((cell) => ({
      cell,
      distance: pointDistance(current, cell),
      onward: onwardCandidateCount(cell, cellsByKey, visited)
    }))
    .filter((entry) => entry.distance <= BACKTRACK_MAX_STEP_DISTANCE)
    .sort((a, b) => a.onward - b.onward || a.distance - b.distance || a.cell.y - b.cell.y || a.cell.x - b.cell.x)
    .map((entry) => entry.cell);
}

function onwardCandidateCount(cell, cellsByKey, visited) {
  return Array.from(cellsByKey.values()).filter((candidate) => (
    !visited.has(cellKey(candidate)) && cellKey(candidate) !== cellKey(cell) && pointDistance(cell, candidate) <= BACKTRACK_MAX_STEP_DISTANCE
  )).length;
}

function completePathWithNearestRemainder(path, island) {
  const used = new Set(path.map(cellKey));
  const remaining = island
    .filter((cell) => !used.has(cellKey(cell)))
    .map((cell) => ({ x: cell.x, y: cell.y }));
  const completed = path.slice();

  while (remaining.length > 0) {
    const last = completed[completed.length - 1];
    const nextIndex = remaining.reduce((bestIndex, point, index) => {
      const bestPoint = remaining[bestIndex];
      return pointDistance(last, point) < pointDistance(last, bestPoint) ? index : bestIndex;
    }, 0);
    completed.push(remaining.splice(nextIndex, 1)[0]);
  }

  return completed;
}

function maxStepDistance(path) {
  return path.reduce((maxDistance, point, index) => {
    if (index === 0) {
      return maxDistance;
    }

    return Math.max(maxDistance, pointDistance(path[index - 1], point));
  }, 0);
}

function pathJumpScore(path) {
  let largeJumps = 0;
  let totalDistance = 0;

  path.forEach((point, index) => {
    if (index === 0) {
      return;
    }

    const distance = pointDistance(path[index - 1], point);
    totalDistance += distance;
    if (distance > BACKTRACK_MAX_STEP_DISTANCE) {
      largeJumps += 1;
    }
  });

  return { largeJumps, totalDistance };
}

function isBetterPathScore(candidate, current) {
  return candidate.largeJumps < current.largeJumps
    || (candidate.largeJumps === current.largeJumps && candidate.totalDistance < current.totalDistance);
}

function islandsForCells(cells, gapTolerance = ISLAND_GAP_TOLERANCE) {
  const remaining = new Map(cells.map((cell) => [cellKey(cell), cell]));
  const islands = [];

  while (remaining.size > 0) {
    const start = remaining.values().next().value;
    const island = [];
    const queue = [start];
    remaining.delete(cellKey(start));

    while (queue.length > 0) {
      const current = queue.shift();
      island.push(current);

      Array.from(remaining.values()).forEach((candidate) => {
        if (belongsToSameIsland(current, candidate, gapTolerance)) {
          remaining.delete(cellKey(candidate));
          queue.push(candidate);
        }
      });
    }

    islands.push(island);
  }

  return islands.sort((a, b) => islandSortValue(a).y - islandSortValue(b).y || islandSortValue(a).x - islandSortValue(b).x);
}

function belongsToSameIsland(a, b, gapTolerance) {
  const horizontalGap = Math.max(Math.abs(a.x - b.x) - 1, 0);
  const verticalGap = Math.max(Math.abs(a.y - b.y) - 1, 0);
  return Math.max(horizontalGap, verticalGap) <= gapTolerance;
}

function islandSortValue(island) {
  return island.reduce((topLeft, cell) => {
    if (cell.y < topLeft.y || (cell.y === topLeft.y && cell.x < topLeft.x)) {
      return cell;
    }

    return topLeft;
  }, island[0]);
}

function orderIslandPaths(paths) {
  const remaining = paths.filter((path) => path.length > 0);
  const ordered = [];
  let lastPoint = null;

  while (remaining.length > 0) {
    const next = nearestIslandPath(remaining, lastPoint);
    remaining.splice(next.index, 1);
    ordered.push(next.path);
    lastPoint = next.path[next.path.length - 1];
  }

  return ordered;
}

function nearestIslandPath(paths, lastPoint) {
  if (!lastPoint) {
    return { index: 0, path: paths[0] };
  }

  return paths.reduce((best, path, index) => {
    const normalDistance = pointDistance(lastPoint, path[0]);
    const reversedDistance = pointDistance(lastPoint, path[path.length - 1]);
    const shouldReverse = reversedDistance < normalDistance;
    const distance = shouldReverse ? reversedDistance : normalDistance;

    if (!best || distance < best.distance) {
      return {
        index,
        distance,
        path: shouldReverse ? path.slice().reverse() : path
      };
    }

    return best;
  }, null);
}

function pointDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function threadDistance(a, b) {
  return a.diagonal && b.diagonal ? StitchModel.distance(a, b) : Math.hypot(a.x - b.x, a.y - b.y);
}

function progressivePathScore(path) {
  let maxDistance = 0;
  let totalDistance = 0;

  path.forEach((point, index) => {
    if (index === 0) {
      return;
    }

    const distance = chebyshevDistance(path[index - 1], point);
    maxDistance = Math.max(maxDistance, distance);
    totalDistance += distance;
  });

  return { maxDistance, totalDistance };
}

function isBetterProgressiveScore(candidate, current) {
  return candidate.maxDistance < current.maxDistance
    || (candidate.maxDistance === current.maxDistance && candidate.totalDistance < current.totalDistance);
}

function cellKey(point) {
  return `${point.x},${point.y}`;
}

function findCellAt(x, y) {
  if (!loadedPattern) {
    return null;
  }

  return loadedPattern.grid.cells.find((cell) => cell.x === x && cell.y === y) || null;
}

function cellFromCanvasEvent(event) {
  if (!loadedPattern) {
    return null;
  }

  const cellSize = (patternCanvas.width - GRID_RULER_SIZE) / loadedPattern.grid.width;
  const rect = patternCanvas.getBoundingClientRect();
  const scaleX = patternCanvas.width / rect.width;
  const scaleY = patternCanvas.height / rect.height;
  const canvasX = (event.clientX - rect.left) * scaleX - GRID_RULER_SIZE;
  const canvasY = (event.clientY - rect.top) * scaleY - GRID_RULER_SIZE;
  const x = Math.floor(canvasX / cellSize);
  const y = Math.floor(canvasY / cellSize);
  return findCellAt(x, y);
}

function addCellToCurrentPath(cell) {
  if (!loadedPattern || !selectedDmc || !cell || cell.empty || cell.dmc !== selectedDmc) return false;
  const key = cellKey(cell);
  if (key === lastDrawnCellKey) return false;
  lastDrawnCellKey = key;
  const path = currentPath(), existing = new Set(path.filter(p => cellKey(p) === key).map(p => p.diagonal));
  const mode = document.querySelector("#diagonalMode").value;
  const diagonal = mode === "auto" ? (existing.has("lower") ? "upper" : "lower") : mode;
  if (existing.has(diagonal)) return false;
  if (diagonal === "upper" && !existing.has("lower")) {
    pathGridStatus.textContent = "La diagonale / de cette case doit etre ajoutee d'abord.";
    return false;
  }
  const chosenDirection = document.querySelector("#diagonalDirection").value;
  const candidate = { x: cell.x, y: cell.y, diagonal, direction: chosenDirection === "-1" ? -1 : 1 };
  if (path.length && StitchModel.distance(path.at(-1), candidate) === 0) {
    if (chosenDirection !== "auto") {
      pathGridStatus.textContent = "Transition impossible : sortie et entree dans le meme trou.";
      return false;
    }
    candidate.direction *= -1;
  }
  path.push(candidate);
  return true;
}

function addCellsToCurrentPath(cells) {
  let changed = false;
  cells.forEach((cell) => {
    changed = addCellToCurrentPath(cell) || changed;
  });

  if (!changed) {
    return false;
  }
  invalidateBatchResult(selectedDmc);

  pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
  pathProgress.export = false;
  savePathPlannerState();
  renderPathTool();
  showPathSavedStatus();
  return true;
}

function cellsBetween(startCell, endCell) {
  if (!startCell || !endCell) {
    return endCell ? [endCell] : [];
  }

  const cells = [];
  let x = startCell.x;
  let y = startCell.y;
  const dx = Math.abs(endCell.x - startCell.x);
  const dy = Math.abs(endCell.y - startCell.y);
  const stepX = startCell.x < endCell.x ? 1 : -1;
  const stepY = startCell.y < endCell.y ? 1 : -1;
  let error = dx - dy;

  while (true) {
    const cell = findCellAt(x, y);
    if (cell) {
      cells.push(cell);
    }

    if (x === endCell.x && y === endCell.y) {
      break;
    }

    const doubledError = error * 2;
    if (doubledError > -dy) {
      error -= dy;
      x += stepX;
    }

    if (doubledError < dx) {
      error += dx;
      y += stepY;
    }
  }

  return cells;
}

function isPathComplete(dmc) {
  return isCompletePathForColor(loadedPattern, pathsByDmc, dmc);
}

function areAllColorPathsComplete(pattern, paths) {
  if (!pattern) {
    return false;
  }

  return pattern.colors.every((color) => isCompletePathForColor(pattern, paths, color.dmc));
}

function isCompletePathForColor(pattern, paths, dmc) {
  if (!pattern || !dmc) return false;
  return !StitchModel.validateRoute(paths[dmc] || [], pattern.grid.cells.filter(cell => !cell.empty && cell.dmc === dmc));
}

function selectNextIncompleteColor() {
  if (!loadedPattern) {
    return;
  }

  const currentIndex = loadedPattern.colors.findIndex((color) => color.dmc === selectedDmc);
  const nextColor = loadedPattern.colors.find((color, index) => index > currentIndex && !isPathComplete(color.dmc))
    || loadedPattern.colors.find((color) => !isPathComplete(color.dmc))
    || loadedPattern.colors[Math.min(currentIndex + 1, loadedPattern.colors.length - 1)];

  selectedDmc = nextColor?.dmc || selectedDmc;
}

function buildPathExport() {
  return {
    schemaVersion: 2, stitchUnit: "diagonal", kind: "cross-stitch-paths",
    project: { name: loadedPattern.project.name }, pattern: loadedPattern, settings: { cutThreshold },
    paths: loadedPattern.colors.map(color => ({
      dmc: color.dmc, symbol: color.symbol || null, constraints: constraintsByDmc[color.dmc] || {},
      forcedCuts: (pathsByDmc[color.dmc] || []).filter(p => p.cutBefore).map(copyPoint),
      points: (pathsByDmc[color.dmc] || []).map(copyPoint)
    }))
  };
}

function slugify(value) {
  return (value || "cross-stitch-paths")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "cross-stitch-paths";
}

function isPathStepComplete(step) {
  if (step === "load") {
    return pathProgress.load && Boolean(loadedPattern);
  }

  return Boolean(pathProgress[step]);
}

function canOpenPathStep(step) {
  const stepIndex = pathStepOrder.indexOf(step);
  if (stepIndex <= 0) {
    return true;
  }

  return pathStepOrder.slice(0, stepIndex).every(isPathStepComplete);
}

function firstOpenPathStep() {
  return pathStepOrder.find((step) => canOpenPathStep(step)) || "load";
}

function goToPathStep(step) {
  if (!canOpenPathStep(step)) {
    return;
  }

  activePathStep = step;
  renderPathTool();
}

async function readSelectedPathInput(file) {
  const parsed = JSON.parse(await file.text());
  if (parsed?.kind === "cross-stitch-pattern") {
    StitchModel.validatePattern(parsed);
    return { pattern: parsed, pathsByDmc: {} };
  }
  const paths = StitchModel.upgradePathsFile(parsed);
  return {
    pattern: paths.pattern, cutThreshold: normalizeCutThreshold(paths.settings?.cutThreshold),
    constraintsByDmc: Object.fromEntries(paths.paths.map(p => [p.dmc, p.constraints || {}])),
    pathsByDmc: Object.fromEntries(paths.paths.map(p => [p.dmc, p.points.map(copyPoint)]))
  };
}

function validateFinalPattern(pattern) {
  try { StitchModel.validatePattern(pattern); return { valid: true, message: "" }; }
  catch (error) { return { valid: false, message: error.message }; }
}

function validatePathsFile(data) {
  try { StitchModel.upgradePathsFile(data); return { valid: true, message: "" }; }
  catch (error) { return { valid: false, message: error.message }; }
}

function clonePaths(paths) {
  return Object.fromEntries(Object.entries(paths).map(([dmc, points]) => [dmc, points.map(copyPoint)]));
}

function showPathSavedStatus() {
  if (!plannerSaveFailed) pathSaveStatus.textContent = plannerSavePending ? "Enregistrement..." : "Enregistre localement";
}

function renderPlanningOptions() {
  batchOptimizeButton.disabled = !loadedPattern || pathAlgorithmRunning;
  batchOptimizeButton.textContent = batchPlan.pending.length ? "Reprendre les couleurs restantes" : "Optimiser toutes les couleurs";
  document.querySelector("#batchStatus").textContent = batchPlan.pending.length || batchPlan.results.length
    ? `${batchPlan.results.length} terminees - ${batchPlan.pending.length} restantes${batchRunning ? " - calcul en cours" : ""}` : "";
  const results = document.querySelector("#batchResults");
  results.replaceChildren();
  batchPlan.results.forEach((result) => {
    const row = document.createElement("p");
    row.textContent = `DMC ${result.dmc} : ${Number.isFinite(result.initial) ? formatMetric(result.initial) : "-"} > ${formatMetric(result.score)} (${result.cuts} coupes, ${result.zoneReturns ?? "-"} retours)`;
    results.appendChild(row);
  });
  document.querySelector("#pathConstraints").disabled = pathAlgorithmRunning;
  const constraints = constraintsByDmc[selectedDmc] || {};
  lockedPrefixCount.max = String(currentPath().length);
  lockedPrefixCount.value = String(constraints.lockedPrefix?.length || 0);
  document.querySelector("#constraintsStatus").textContent = `${constraints.start ? `Depart : ${constraints.start.x + 1}, ${constraints.start.y + 1}` : "Depart libre"} - ${constraints.forcedCuts?.length || 0} coupes imposees`;
}

function runNextBatchColor() {
  if (!batchRunning || pathAlgorithmRunning || !batchPlan.pending.length) return;
  selectedDmc = batchPlan.pending[0];
  activePathStep = "paths";
  renderPathTool();
  startAdvancedPathSearch();
  if (!pathAlgorithmRunning) {
    batchRunning = false;
    renderPlanningOptions();
  }
}

batchOptimizeButton.addEventListener("click", () => {
  if (!loadedPattern || pathAlgorithmRunning) return;
  if (!batchPlan.pending.length) batchPlan = { pending: loadedPattern.colors.map((color) => color.dmc), results: [] };
  batchRunning = true;
  savePathPlannerState();
  runNextBatchColor();
});

function updateConstraints(constraints) {
  constraintsByDmc[selectedDmc] = constraints;
  delete bestPathsByDmc[selectedDmc];
  delete pathOptimizationBaselinesByDmc[selectedDmc];
  invalidateBatchResult(selectedDmc);
  pathProgress.export = false;
  savePathPlannerState();
  renderPathTool();
}

function invalidateBatchResult(dmc) {
  if (!batchPlan.results.some(result => result.dmc === dmc)) return;
  batchPlan.results = batchPlan.results.filter(result => result.dmc !== dmc);
  if (!batchPlan.pending.includes(dmc)) batchPlan.pending.push(dmc);
}

function editPathConstraint(cell) {
  if (!cell || cell.empty || cell.dmc !== selectedDmc) return;
  const constraints = structuredClone(constraintsByDmc[selectedDmc] || {}), path = currentPath();
  const diagonal = document.querySelector("#diagonalMode").value === "upper" ? "upper" : "lower";
  const index = path.findIndex(p => cellKey(p) === cellKey(cell) && p.diagonal === diagonal);
  if (pathEditMode.value === "start") {
    if (diagonal !== "lower") { alert("Le depart doit etre une diagonale /, sous la croix."); return; }
    const start = { x: cell.x, y: cell.y, diagonal: "lower",
      direction: document.querySelector("#diagonalDirection").value === "-1" ? -1 : 1 };
    const next = { ...constraints, start, lockedPrefix: [] };
    const sequence = [start, ...path.filter(p => StitchModel.key(p) !== StitchModel.key(start))];
    try {
      pathsByDmc[selectedDmc] = StitchModel.orient(sequence, cutThreshold, next);
      updateConstraints(next);
    } catch (error) { alert(error.message); }
  } else if (index >= 0) {
    path[index].cutBefore = !path[index].cutBefore;
    constraints.forcedCuts = path.filter(p => p.cutBefore).map(copyPoint);
    updateConstraints(constraints);
  }
}

lockedPrefixCount.addEventListener("change", () => {
  const count = Math.min(currentPath().length, Math.max(0, Math.floor(Number(lockedPrefixCount.value) || 0)));
  const constraints = constraintsByDmc[selectedDmc] || {};
  updateConstraints({ ...constraints, lockedPrefix: currentPath().slice(0, count).map(copyPoint), start: count ? copyPoint(currentPath()[0]) : constraints.start });
});

document.querySelector("#clearConstraintsButton").addEventListener("click", () => {
  currentPath().forEach(p => delete p.cutBefore);
  updateConstraints({});
});

function trimConstraints() {
  const constraints = constraintsByDmc[selectedDmc];
  if (!constraints) return;
  const path = currentPath();
  constraints.lockedPrefix = (constraints.lockedPrefix || []).slice(0, path.length);
  constraints.forcedCuts = path.filter(p => p.cutBefore).map(copyPoint);
  if (!path.length) delete constraints.start;
}

patternJsonFileInput.addEventListener("change", async () => {
  if (activePathOptimizerWorker) {
    stopAdvancedPathSearch();
  }

  const file = patternJsonFileInput.files[0];
  if (!file) {
    return;
  }

  try {
    const imported = await readSelectedPathInput(file);
    loadedPattern = imported.pattern;
    pathsByDmc = imported.pathsByDmc;
    constraintsByDmc = imported.constraintsByDmc || {};
    cutThreshold = imported.cutThreshold || DEFAULT_CUT_THRESHOLD;
    batchPlan = { pending: [], results: [] };
    batchRunning = false;
    bestPathsByDmc = clonePaths(pathsByDmc);
    selectedDmc = loadedPattern.colors[0]?.dmc || null;
    pathOptimizationBaselinesByDmc = {};
    pathProgress.load = true;
    pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
    pathProgress.export = false;
    loadError.hidden = true;
    savePathPlannerState();
    goToPathStep("paths");
    showPathSavedStatus();
  } catch (error) {
    loadError.textContent = error.message;
    loadError.hidden = false;
    renderPathTool();
  }
});

patternCanvas.addEventListener("pointerdown", (event) => {
  if (!loadedPattern || !selectedDmc || pathAlgorithmRunning) {
    return;
  }

  if (pathEditMode.value !== "draw") {
    editPathConstraint(cellFromCanvasEvent(event));
    return;
  }

  event.preventDefault();
  isDrawingPath = true;
  lastDrawnCellKey = null;
  lastPointerCell = cellFromCanvasEvent(event);
  patternCanvas.setPointerCapture(event.pointerId);
  addCellsToCurrentPath([lastPointerCell]);
});

patternCanvas.addEventListener("pointermove", (event) => {
  if (!isDrawingPath) {
    return;
  }

  event.preventDefault();
  const currentCell = cellFromCanvasEvent(event);
  if (!currentCell) {
    return;
  }

  addCellsToCurrentPath(cellsBetween(lastPointerCell, currentCell));
  lastPointerCell = currentCell;
});

patternCanvas.addEventListener("pointerup", (event) => {
  isDrawingPath = false;
  lastDrawnCellKey = null;
  lastPointerCell = null;
  if (patternCanvas.hasPointerCapture(event.pointerId)) {
    patternCanvas.releasePointerCapture(event.pointerId);
  }
});

patternCanvas.addEventListener("pointercancel", () => {
  isDrawingPath = false;
  lastDrawnCellKey = null;
  lastPointerCell = null;
});

pathColorLegend.addEventListener("click", (event) => {
  if (pathAlgorithmRunning) {
    return;
  }

  const button = event.target.closest("[data-dmc]");
  if (!button) {
    return;
  }

  selectedDmc = button.dataset.dmc;
  savePathPlannerState();
  renderPathTool();
});

async function applyAsyncPathAlgorithm(buildPath, label = "Recherche 2-opt") {
  if (!loadedPattern || !selectedDmc || pathAlgorithmRunning) {
    return;
  }

  const baselinePath = currentPath();
  if (pathOptimizationBaselinesByDmc[selectedDmc] === undefined && baselinePath.length > 1) {
    pathOptimizationBaselinesByDmc[selectedDmc] = pathRealisticScore(baselinePath);
  }
  pathAlgorithmRunning = true;
  resetAlgorithmLiveMetrics();
  showAlgorithmFeedback("Preparation", 0, null);
  renderPathTool();

  try {
    const dmc = selectedDmc;
    const path = await buildPath(dmc, async ({ phase, path: candidatePath, distance, progress }) => {
      if (candidatePath?.length) {
        if (pathOptimizationBaselinesByDmc[dmc] === undefined && candidatePath.length > 1) {
          pathOptimizationBaselinesByDmc[dmc] = pathRealisticScore(candidatePath);
        }

        pathsByDmc[dmc] = candidatePath;
        pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
        pathProgress.export = false;
        renderPathTool();
      }

      showAlgorithmFeedback(phase, progress, distance);
      await nextFrame();
    });

    const result = rememberBestPath(dmc, path);
    pathsByDmc[dmc] = result.path;
    pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
    pathProgress.export = false;
    savePathPlannerState();
    renderPathTool();
    showAlgorithmFeedback(
      result.improved ? `${label}: nouveau meilleur` : `${label}: meilleur conserve`,
      100,
      result.bestDistance,
      result.candidateDistance,
      pathPerformanceMetrics(result.path)
    );
    showPathSavedStatus();
  } finally {
    pathAlgorithmRunning = false;
    renderPathTool();
  }
}

function startAdvancedPathSearch() {
  if (!loadedPattern || !selectedDmc || pathAlgorithmRunning) {
    return;
  }

  let worker = null;
  try {
    worker = window.createPathOptimizerWorker?.();
  } catch (error) {
    showAlgorithmFeedback(`Impossible de demarrer le moteur: ${error.message}`, 0, null);
    return;
  }
  if (!worker) {
    showAlgorithmFeedback("Le calcul en arriere-plan n'est pas disponible dans ce navigateur.", 0, null);
    return;
  }

  const dmc = selectedDmc;
  const startingPath = bestCompletePathForColor(dmc);
  if (pathOptimizationBaselinesByDmc[dmc] === undefined && startingPath.length > 1) {
    pathOptimizationBaselinesByDmc[dmc] = pathRealisticScore(startingPath);
  }

  activePathOptimizerWorker = worker;
  activePathOptimizerRunId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  activePathOptimizerDmc = dmc;
  activePathOptimizerLastSavedAt = 0;
  activePathOptimizerSnapshot = null;
  pathAlgorithmRunning = true;
  resetAlgorithmLiveMetrics();
  showAlgorithmFeedback("Preparation de la recherche approfondie", 0, null);
  renderPathTool();

  worker.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.runId !== activePathOptimizerRunId) {
      return;
    }

    if (message.type === "error") {
      flushAdvancedPathSnapshot();
      finishAdvancedPathSearch(`Erreur: ${message.message}`, message, false);
      return;
    }

    if (message.type === "progress") {
      // Timer-only updates must not discard a better path waiting to be rendered.
      pendingOptimizerSnapshot = !message.path && pendingOptimizerSnapshot?.path
        ? { ...message, path: pendingOptimizerSnapshot.path } : message;
      if (optimizerSnapshotFrame === null) optimizerSnapshotFrame = requestAnimationFrame(flushAdvancedPathSnapshot);
      return;
    }

    if (message.type === "complete") {
      clearPendingOptimizerSnapshot();
      applyAdvancedPathSnapshot(dmc, message);
      finishAdvancedPathSearch("Recherche approfondie terminee", message, true);
    }
  });

  worker.addEventListener("error", (event) => {
    flushAdvancedPathSnapshot();
    finishAdvancedPathSearch(`Erreur du moteur: ${event.message || "calcul interrompu"}`, null, false);
  });

  worker.postMessage({
    type: "start",
    runId: activePathOptimizerRunId,
    points: cellsForColor(dmc).map(copyPoint),
    initialPath: startingPath.map(copyPoint),
    cutThreshold,
    stagnationLimitMs: pathStagnationLimitMs,
    constraints: constraintsByDmc[dmc] || {}
  });
}

function clearPendingOptimizerSnapshot() {
  if (optimizerSnapshotFrame !== null) cancelAnimationFrame(optimizerSnapshotFrame);
  optimizerSnapshotFrame = null;
  pendingOptimizerSnapshot = null;
}

function flushAdvancedPathSnapshot() {
  const snapshot = pendingOptimizerSnapshot;
  clearPendingOptimizerSnapshot();
  if (snapshot && activePathOptimizerDmc) applyAdvancedPathSnapshot(activePathOptimizerDmc, snapshot);
}

function bestCompletePathForColor(dmc) {
  const candidates = [
    Array.isArray(pathsByDmc[dmc]) ? pathsByDmc[dmc] : [],
    Array.isArray(bestPathsByDmc[dmc]) ? bestPathsByDmc[dmc] : []
  ].filter((path) => isCompletePathForColor(loadedPattern, { [dmc]: path }, dmc)
    && constraintApi.satisfiesConstraints(path, constraintsByDmc[dmc]));

  if (candidates.length === 0) {
    return [];
  }

  return candidates.sort(comparePathPerformance)[0].map(copyPoint);
}

function applyAdvancedPathSnapshot(dmc, snapshot) {
  const previousZone = activePathOptimizerSnapshot?.zone;
  activePathOptimizerSnapshot = snapshot;
  if (pathOptimizationBaselinesByDmc[dmc] === undefined && Number.isFinite(snapshot.initialMetrics?.score)) {
    pathOptimizationBaselinesByDmc[dmc] = snapshot.initialMetrics.score;
  }

  let pathChanged = false;
  if (Array.isArray(snapshot.path) && isCompletePathForColor(loadedPattern, { [dmc]: snapshot.path }, dmc)) {
    const result = rememberBestPath(dmc, snapshot.path);
    pathsByDmc[dmc] = result.path;
    pathChanged = result.improved;
    pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
  }

  pathProgress.export = false;

  if (pathChanged) {
    renderPathTool();
    if (snapshot.elapsedMs - activePathOptimizerLastSavedAt >= 3000) {
      activePathOptimizerLastSavedAt = snapshot.elapsedMs;
      savePathPlannerState();
    }
  } else if (previousZone?.id !== snapshot.zone?.id || previousZone?.status !== snapshot.zone?.status) {
    if (optimizerGridFrame === null) optimizerGridFrame = requestAnimationFrame(() => {
      optimizerGridFrame = null;
      renderPatternGrid();
    });
  }

  showAdvancedPathFeedback(snapshot);
}

function finishAdvancedPathSearch(label, snapshot, completed) {
  clearPendingOptimizerSnapshot();
  const finishedDmc = activePathOptimizerDmc;
  const finalSnapshot = snapshot || activePathOptimizerSnapshot;
  if (optimizerGridFrame !== null) {
    cancelAnimationFrame(optimizerGridFrame);
    optimizerGridFrame = null;
  }
  if (activePathOptimizerWorker) {
    activePathOptimizerWorker.terminate();
  }

  activePathOptimizerWorker = null;
  activePathOptimizerRunId = null;
  activePathOptimizerDmc = null;
  pathAlgorithmRunning = false;
  pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
  pathProgress.export = false;
  savePathPlannerState();
  renderPathTool();

  const path = currentPath();
  const metrics = pathPerformanceMetrics(path);
  const progress = completed ? 100 : Math.min(99, finalSnapshot?.progress || 0);
  showAlgorithmFeedback(
    label,
    progress,
    path.length > 1 ? metrics.realisticScore : null,
    null,
    path.length > 1 ? metrics : null
  );
  updateAlgorithmLiveMetrics(finalSnapshot);
  activePathOptimizerSnapshot = null;
  if (batchRunning) {
    if (completed) {
      batchPlan.pending = batchPlan.pending.filter((dmc) => dmc !== finishedDmc);
      batchPlan.results.push({ dmc: finishedDmc, initial: finalSnapshot?.initialMetrics?.score, score: metrics.realisticScore, cuts: metrics.cuts, zoneReturns: metrics.zoneReturns });
      if (batchPlan.pending.length) setTimeout(runNextBatchColor, 50);
      else batchRunning = false;
    } else {
      batchRunning = false;
    }
    savePathPlannerState();
    renderPlanningOptions();
  }
  showPathSavedStatus();
}

function stopAdvancedPathSearch() {
  if (!activePathOptimizerWorker) {
    return;
  }

  activePathOptimizerWorker.terminate();
  flushAdvancedPathSnapshot();
  const dmc = activePathOptimizerDmc;
  const path = bestCompletePathForColor(dmc);
  if (path.length) {
    try {
      const oriented = StitchModel.orient(path, cutThreshold, constraintsByDmc[dmc] || {}, true);
      applyAdvancedPathSnapshot(dmc, { ...activePathOptimizerSnapshot, path: oriented,
        metrics: pathPerformanceMetrics(oriented, dmc), phase: "Derniere optimisation des sens" });
    } catch (error) {
      finishAdvancedPathSearch(`Recherche arretee, meilleur chemin conserve. Verification des sens: ${error.message}`, null, false);
      return;
    }
  }
  finishAdvancedPathSearch("Recherche arretee, meilleur chemin conserve", null, false);
}

function showAdvancedPathFeedback(snapshot) {
  const path = activePathOptimizerDmc ? pathsByDmc[activePathOptimizerDmc] || [] : [];
  const metrics = snapshot.metrics || pathPerformanceMetrics(path);
  renderPathGridStatus(metrics);
  showAlgorithmFeedback(
    snapshot.phase || "Recherche approfondie",
    snapshot.progress || 0,
    path.length > 1 ? metrics.realisticScore : snapshot.metrics?.score,
    null,
    path.length > 1 ? metrics : null
  );
  updateAlgorithmLiveMetrics(snapshot);
}

function updateAlgorithmLiveMetrics(snapshot) {
  const zone = snapshot?.zone;
  pathAlgorithmZone.textContent = zone?.index
    ? `${zone.index} / ${zone.total}${!pathAlgorithmRunning && zone.status === "running" ? " (arretee)" : ""}` : "-";
  pathAlgorithmZonesDone.textContent = zone ? `${zone.completed} / ${zone.total}` : "-";
  pathAlgorithmTotalScore.textContent = Number.isFinite(snapshot?.metrics?.score) ? formatMetric(snapshot.metrics.score) : "-";
  pathAlgorithmZoneInitial.textContent = Number.isFinite(zone?.initialScore) ? formatMetric(zone.initialScore) : "-";
  pathAlgorithmZoneScore.textContent = Number.isFinite(zone?.score) ? formatMetric(zone.score) : "-";
  pathAlgorithmClockLabel.textContent = snapshot?.stage === "links" ? "Sans gain (liaisons)"
    : !snapshot || snapshot.stage === "zones" ? "Sans gain (zone)" : "Sans gain";
  if (!snapshot) {
    pathAlgorithmElapsed.textContent = "-";
    pathAlgorithmRestarts.textContent = "-";
    pathAlgorithmImprovements.textContent = "-";
    pathAlgorithmLastImprovement.textContent = "-";
    return;
  }

  pathAlgorithmElapsed.textContent = formatAlgorithmTime(snapshot.elapsedMs);
  pathAlgorithmRestarts.textContent = String(snapshot.restarts ?? 0);
  pathAlgorithmImprovements.textContent = String(snapshot.improvements ?? 0);
  pathAlgorithmLastImprovement.textContent = `${formatAlgorithmTime(snapshot.lastImprovementMs || 0)} / ${formatAlgorithmTime(snapshot.stagnationLimitMs || pathStagnationLimitMs)}`;
}

function resetAlgorithmLiveMetrics() {
  updateAlgorithmLiveMetrics(null);
}

function formatAlgorithmTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.round((Number(milliseconds) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function showAlgorithmFeedback(phase, progress, distance, candidateDistance = null, metrics = null) {
  pathAlgorithmFeedback.classList.remove("hidden");
  pathAlgorithmProgress.value = Math.max(0, Math.min(100, Math.round(progress || 0)));
  pathAlgorithmTotalScore.textContent = Number.isFinite(distance) ? formatMetric(distance) : "-";
  if (distance === null || distance === undefined) {
    pathAlgorithmDistance.textContent = phase;
    return;
  }

  const bestText = `score ${formatMetric(distance)}`;
  const candidateText = candidateDistance !== null && candidateDistance !== undefined && formatMetric(candidateDistance) !== formatMetric(distance)
    ? ` - test ${formatMetric(candidateDistance)}`
    : "";
  const realisticText = metrics
    ? ` - distance ${formatMetric(metrics.distance)} - coupes ${metrics.cuts} - retours de zone ${metrics.zoneReturns ?? 0}`
    : "";
  pathAlgorithmDistance.textContent = `${phase} - ${bestText}${candidateText}${realisticText} - ${pathAlgorithmProgress.value}%`;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

optimizedPathButton.addEventListener("click", () => {
  batchRunning = false;
  startAdvancedPathSearch();
});

stopPathAlgorithmButton.addEventListener("click", () => {
  stopAdvancedPathSearch();
});

pathStagnationLimit.addEventListener("change", () => {
  pathStagnationLimitMs = normalizePathStagnationLimit(pathStagnationLimit.value) || DEFAULT_PATH_STAGNATION_LIMIT;
  pathStagnationLimit.value = String(pathStagnationLimitMs);
  savePathPlannerState();
  showPathSavedStatus();
});

cutThresholdInput.addEventListener("change", () => {
  const normalized = normalizeCutThreshold(cutThresholdInput.value) || DEFAULT_CUT_THRESHOLD;
  cutThreshold = normalized;
  pathOptimizationBaselinesByDmc = {};
  batchPlan = { pending: [], results: [] };
  cutThresholdInput.value = String(cutThreshold);
  savePathPlannerState();
  renderPathTool();
  showPathSavedStatus();
});

undoPathPointButton.addEventListener("click", () => {
  invalidateBatchResult(selectedDmc);
  currentPath().pop();
  trimConstraints();
  pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
  pathProgress.export = false;
  savePathPlannerState();
  renderPathTool();
});

clearPathButton.addEventListener("click", () => {
  invalidateBatchResult(selectedDmc);
  delete constraintsByDmc[selectedDmc];
  pathsByDmc[selectedDmc] = [];
  delete bestPathsByDmc[selectedDmc];
  pathProgress.paths = false;
  pathProgress.export = false;
  savePathPlannerState();
  renderPathTool();
});

savePathAndNextButton.addEventListener("click", () => {
  if (!isPathComplete(selectedDmc)) {
    return;
  }

  pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
  pathProgress.export = false;
  savePathPlannerState();
  if (pathProgress.paths) {
    goToPathStep("export");
  } else {
    selectNextIncompleteColor();
    renderPathTool();
  }
  showPathSavedStatus();
});

backToPathsButton.addEventListener("click", () => {
  goToPathStep("paths");
});

downloadPathJsonButton.addEventListener("click", () => {
  if (!loadedPattern || !areAllColorPathsComplete(loadedPattern, pathsByDmc)) {
    return;
  }

  const json = JSON.stringify(buildPathExport(), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(loadedPattern.project.name)}.paths.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

pathStepButtons.forEach((button) => {
  button.addEventListener("click", () => {
    goToPathStep(button.dataset.step);
  });
});

let resizeRenderFrame = null;
window.addEventListener("resize", () => {
  if (resizeRenderFrame) {
    cancelAnimationFrame(resizeRenderFrame);
  }

  resizeRenderFrame = requestAnimationFrame(() => {
    resizeRenderFrame = null;
    renderPathTool();
  });
});

resetPathToolButton.addEventListener("click", () => {
  if (activePathOptimizerWorker) {
    activePathOptimizerWorker.terminate();
    activePathOptimizerWorker = null;
    activePathOptimizerRunId = null;
    activePathOptimizerDmc = null;
    activePathOptimizerSnapshot = null;
    pathAlgorithmRunning = false;
  }
  loadedPattern = null;
  selectedDmc = null;
  pathsByDmc = {};
  bestPathsByDmc = {};
  constraintsByDmc = {};
  batchPlan = { pending: [], results: [] };
  batchRunning = false;
  cutThreshold = DEFAULT_CUT_THRESHOLD;
  pathStagnationLimitMs = DEFAULT_PATH_STAGNATION_LIMIT;
  pathOptimizationBaselinesByDmc = {};
  pathProgress = {
    load: false,
    paths: false,
    export: false
  };
  patternJsonFileInput.value = "";
  loadError.hidden = true;
  localStorage.removeItem(PATH_PLANNER_STORAGE_KEY);
  savePathPlannerState();
  renderPathTool();
});

renderPathTool();
async function restorePlannerDraft() {
  document.querySelector("main").inert = true;
  try {
    const state = migratePlannerState(await window.PathPlannerStore.read());
    if (state) {
      if (!validateFinalPattern(state.pattern).valid) throw new Error("Brouillon de chemins invalide.");
      loadedPattern = state.pattern;
      pathsByDmc = state.pathsByDmc || {};
      bestPathsByDmc = state.bestPathsByDmc || {};
      selectedDmc = state.selectedDmc || loadedPattern.colors[0]?.dmc;
      cutThreshold = normalizeCutThreshold(state.cutThreshold) || DEFAULT_CUT_THRESHOLD;
      pathStagnationLimitMs = normalizePathStagnationLimit(state.pathStagnationLimitMs) || DEFAULT_PATH_STAGNATION_LIMIT;
      constraintsByDmc = state.constraintsByDmc || {};
      batchPlan = state.batchPlan || { pending: [], results: [] };
      pathOptimizationBaselinesByDmc = state.pathOptimizationBaselinesByDmc || {};
      pathProgress = { load: true, paths: areAllColorPathsComplete(loadedPattern, pathsByDmc), export: false };
    } else if (loadedPattern) savePathPlannerState();
  } catch (error) { pathSaveStatus.textContent = error.message; }
  finally { document.querySelector("main").inert = false; renderPathTool(); }
}
window.addEventListener("beforeunload", event => {
  if (plannerSavePending || plannerSaveFailed) { event.preventDefault(); event.returnValue = ""; }
});
restorePlannerDraft();
