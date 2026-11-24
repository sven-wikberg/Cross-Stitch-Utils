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
const pathImprovementCanvas = document.querySelector("#pathImprovementCanvas");
const pathImprovementGain = document.querySelector("#pathImprovementGain");
const pathCanvasStage = document.querySelector("#pathCanvasStage");
const pathOverview = document.querySelector("#pathOverview");
const pathInspection = document.querySelector("#pathInspection");
const pathComparisonScore = document.querySelector("#pathComparisonScore");
const pathViewBefore = document.querySelector("#pathViewBefore");
const pathViewAfter = document.querySelector("#pathViewAfter");
const pathFollowGains = document.querySelector("#pathFollowGains");
let viewportPattern = null, inspectionMode = "draw", comparisonMode = "after", viewFrame = null, panGesture = null;
const comparisonPaths = new Map(), viewPointers = new Map();
let overviewCache = null, inspectionLinks = null;
const pathScoreHistory = document.querySelector("#pathScoreHistory");
const pathGainRows = document.querySelector("#pathGainRows");
const pathScoreReading = document.querySelector("#pathScoreReading");
const pathWorkColor = document.querySelector("#pathWorkColor");
const pathColorLegend = document.querySelector("#pathColorLegend");
const pathBuildStatus = document.querySelector("#pathBuildStatus");
const optimizedPathButton = document.querySelector("#optimizedPathButton");
const deepOptimizeButton = document.querySelector("#deepOptimizeButton");
const lnsOptimizeButton = document.querySelector("#lnsOptimizeButton");
const adaptiveOptimizeButton = document.querySelector("#adaptiveOptimizeButton");
const pointsOptimizeButton = document.querySelector("#pointsOptimizeButton");
const sectionsOptimizeButton = document.querySelector("#sectionsOptimizeButton");
const segmentsOptimizeButton = document.querySelector("#segmentsOptimizeButton");
const chainsOptimizeButton = document.querySelector("#chainsOptimizeButton");
const pathChainsMetrics = document.querySelector("#pathChainsMetrics");
const pathChainLink = document.querySelector("#pathChainLink");
const pathChainSize = document.querySelector("#pathChainSize");
const pathChainDestinations = document.querySelector("#pathChainDestinations");
const pathChainMoves = document.querySelector("#pathChainMoves");
const pathSegmentsMetrics = document.querySelector("#pathSegmentsMetrics");
const pathSegmentLink = document.querySelector("#pathSegmentLink");
const pathSegmentCount = document.querySelector("#pathSegmentCount");
const pathSegmentDiagonals = document.querySelector("#pathSegmentDiagonals");
const pathSegmentRepairs = document.querySelector("#pathSegmentRepairs");
const relayOptimizeButton = document.querySelector("#relayOptimizeButton");
const pathRelayMetrics = document.querySelector("#pathRelayMetrics");
const pathRelayPass = document.querySelector("#pathRelayPass");
const pathRelayCandidates = document.querySelector("#pathRelayCandidates");
const pathSectionsMetrics = document.querySelector("#pathSectionsMetrics");
const pathSectionOrders = document.querySelector("#pathSectionOrders");
const pathSectionProgress = document.querySelector("#pathSectionProgress");
const pathSectionWindow = document.querySelector("#pathSectionWindow");
const pathSectionVariants = document.querySelector("#pathSectionVariants");
const pathSectionConnections = document.querySelector("#pathSectionConnections");
const pathPointsMetrics = document.querySelector("#pathPointsMetrics");
const pathPointOrders = document.querySelector("#pathPointOrders");
const pathPointConversions = document.querySelector("#pathPointConversions");
const pathPointTrials = document.querySelector("#pathPointTrials");
const pathPointRepairs = document.querySelector("#pathPointRepairs");
const pathAdaptiveMetrics = document.querySelector("#pathAdaptiveMetrics");
const pathAdaptiveSeeds = document.querySelector("#pathAdaptiveSeeds");
const pathAdaptiveExact = document.querySelector("#pathAdaptiveExact");
const pathAdaptiveBound = document.querySelector("#pathAdaptiveBound");
const pathAdaptiveGap = document.querySelector("#pathAdaptiveGap");
const pathLnsMetrics = document.querySelector("#pathLnsMetrics");
const pathLnsIterations = document.querySelector("#pathLnsIterations");
const pathLnsSize = document.querySelector("#pathLnsSize");
const pathLnsImprovements = document.querySelector("#pathLnsImprovements");
const pathLnsDiversifications = document.querySelector("#pathLnsDiversifications");
const stopPathAlgorithmButton = document.querySelector("#stopPathAlgorithmButton");
const pathStagnationLimit = document.querySelector("#pathStagnationLimit");
const pathAlgorithmFeedback = document.querySelector("#pathAlgorithmFeedback");
const pathAlgorithmProgress = document.querySelector("#pathAlgorithmProgress");
const pathAlgorithmProgressArea = document.querySelector("#pathAlgorithmProgressArea");
const pathPreparationCount = document.querySelector("#pathPreparationCount");
const pathConstructionMetrics = document.querySelector("#pathConstructionMetrics");
const pathAlgorithmDistance = document.querySelector("#pathAlgorithmDistance");
const pathAlgorithmElapsed = document.querySelector("#pathAlgorithmElapsed");
const pathAlgorithmAttempts = document.querySelector("#pathAlgorithmAttempts");
const pathAlgorithmRestarts = document.querySelector("#pathAlgorithmRestarts");
const pathAlgorithmImprovements = document.querySelector("#pathAlgorithmImprovements");
const pathRelayImprovements = document.querySelector("#pathRelayImprovements");
const pathLastRelay = document.querySelector("#pathLastRelay");
const pathLastRelayPosition = document.querySelector("#pathLastRelayPosition");
const pathLastRelayLength = document.querySelector("#pathLastRelayLength");
const pathAlgorithmLastImprovement = document.querySelector("#pathAlgorithmLastImprovement");
const pathAlgorithmClockLabel = document.querySelector("#pathAlgorithmClockLabel");
const pathAlgorithmZone = document.querySelector("#pathAlgorithmZone");
const pathAlgorithmZonesDone = document.querySelector("#pathAlgorithmZonesDone");
const pathAlgorithmZoneCrosses = document.querySelector("#pathAlgorithmZoneCrosses");
const cutThresholdInput = document.querySelector("#cutThresholdInput");
const undoPathPointButton = document.querySelector("#undoPathPointButton");
const redoPathActionButton = document.querySelector("#redoPathActionButton");
const clearPathButton = document.querySelector("#clearPathButton");
const restoreBestPathButton = document.querySelector("#restoreBestPathButton");
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
const GRID_RULER_SIZE = 26;
const pathViewport = createPathViewport(GRID_RULER_SIZE);
const DEFAULT_CUT_THRESHOLD = 10;
const DEFAULT_PATH_STAGNATION_LIMIT = 60000;
const PATH_OBJECTIVE_VERSION = 3;
const PATH_TIMING_VERSION = 1;
const pathZoneCache = new WeakMap();
const pathBlockCache = new WeakMap();
const pathColorCountsCache = new WeakMap();
const OPTIMIZER_PREVIEW_INTERVAL_MS = 750;
const WORK_COLOR_STORAGE_KEY = "cross-stitch-path-work-color";
const FOLLOW_GAINS_STORAGE_KEY = "cross-stitch-path-follow-gains";
let followPathGains = localStorage.getItem(FOLLOW_GAINS_STORAGE_KEY) === "true", followedPathImprovement = null;
pathFollowGains.checked = followPathGains;
let workColor = PathVisuals.workPalette(localStorage.getItem(WORK_COLOR_STORAGE_KEY)).color;
let scoreHistory = [], scoreChartPoints = [], scoreChartHover = null, scoreChartDmc = null;
pathWorkColor.value = workColor;

let storedState = migratePlannerState(loadStoredState());
let pathSearchStatsByDmc = PathSearchStats.normalizeAll(storedState.pathSearchStatsByDmc);
let loadedPattern = storedState.pattern;
let pathsByDmc = storedState.pathsByDmc;
let bestPathsByDmc = storedState.bestPathsByDmc;
let bestPathConstraintsByDmc = storedState.bestPathConstraintsByDmc || {};
let pathEditHistory = createPathEditHistory(storedState.editHistory);
let pathEditPreservesSearchStats = false;
let pathProgress = {
  load: Boolean(loadedPattern),
  paths: Boolean(loadedPattern) && areAllColorPathsComplete(loadedPattern, storedState.pathsByDmc),
  export: false
};
let activePathStep = "load";
let selectedDmc = storedState.selectedDmc || orderedPathColors()[0]?.dmc || null;
let isDrawingPath = false;
let lastDrawnCellKey = null;
let lastPointerCell = null;
let pathAlgorithmRunning = false;
let pathOptimizationBaselinesByDmc = storedState.pathOptimizationBaselinesByDmc || {};
let cutThreshold = storedState.cutThreshold || DEFAULT_CUT_THRESHOLD;
let pathStagnationLimitMs = storedState.pathStagnationLimitMs || DEFAULT_PATH_STAGNATION_LIMIT;
let activePathOptimizerWorker = null;
let activePathOptimizerDeadlineTimer = null;
let activePathOptimizerRunId = null;
let activePathOptimizerDmc = null;
let activePathOptimizerBatchJob = null;
let activeSearchStartedAt = 0;
let activePathOptimizerLastSavedAt = 0;
let activePathOptimizerNeedsSave = false;
let activePathOptimizerSnapshot = null;
let activePathOptimizerBestPath = [];
let pathConstructionSummaries = {};
let optimizerSnapshotFrame = null;
let optimizerSnapshotTimer = null;
let optimizerLastRenderedAt = -Infinity;
let pendingOptimizerSnapshot = null;
let pathImprovement = null;
let constraintsByDmc = storedState.constraintsByDmc || {};
let batchPlan = PathBatchPlan.normalize(storedState.batchPlan);
let batchRunning = false;
let plannerSaveQueue = Promise.resolve();
let plannerSaveFailed = false;
let plannerSavePending = 0;
const constraintApi = window.createPathOptimizerApi();
const batchOptimizeButton = document.querySelector("#batchOptimizeButton");
const currentColorOptimizeButton = document.querySelector("#currentColorOptimizeButton");
const pathEditMode = document.querySelector("#pathEditMode");
const lockedPrefixCount = document.querySelector("#lockedPrefixCount");

function migratePlannerState(state) {
  if (state?.pattern && state.pathTimingVersion !== PATH_TIMING_VERSION) {
    state = { ...state, pathTimingVersion: PATH_TIMING_VERSION, pathStagnationLimitMs: DEFAULT_PATH_STAGNATION_LIMIT };
  }
  if (state?.pattern && state.pathObjectiveVersion !== PATH_OBJECTIVE_VERSION) {
    state = { ...state, pathObjectiveVersion: PATH_OBJECTIVE_VERSION,
      editHistory: undefined, pathOptimizationBaselinesByDmc: {}, pathSearchStatsByDmc: {}, batchPlan: { pending: [], results: [] } };
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
    editHistory: undefined, bestPathConstraintsByDmc: {}, constraintsByDmc: constraints,
    pathOptimizationBaselinesByDmc: {}, pathSearchStatsByDmc: {}, batchPlan: { pending: [], results: [] } };
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
        pathTimingVersion: parsed.pathTimingVersion,
        pattern: parsed.pattern,
        pathsByDmc: parsed.pathsByDmc && typeof parsed.pathsByDmc === "object" ? parsed.pathsByDmc : {},
        bestPathsByDmc: parsed.bestPathsByDmc && typeof parsed.bestPathsByDmc === "object" ? parsed.bestPathsByDmc : {},
        bestPathConstraintsByDmc: parsed.bestPathConstraintsByDmc || {},
        editHistory: parsed.editHistory,
        selectedDmc: typeof parsed.selectedDmc === "string" ? parsed.selectedDmc : null,
        cutThreshold: normalizeCutThreshold(parsed.cutThreshold),
        pathStagnationLimitMs: normalizePathStagnationLimit(parsed.pathStagnationLimitMs),
        constraintsByDmc: parsed.constraintsByDmc || {},
        pathOptimizationBaselinesByDmc: parsed.pathOptimizationBaselinesByDmc || {},
        pathSearchStatsByDmc: parsed.pathSearchStatsByDmc,
        batchPlan: parsed.batchPlan
      };
    }

    return { pattern: null, pathsByDmc: {}, bestPathsByDmc: {} };
  } catch {
    return { pattern: null, pathsByDmc: {}, bestPathsByDmc: {} };
  }
}

function plannerDraft() {
  return {
    pathSchemaVersion: 2,
    pathObjectiveVersion: PATH_OBJECTIVE_VERSION,
    pathTimingVersion: PATH_TIMING_VERSION,
    pattern: loadedPattern,
    pathsByDmc,
    bestPathsByDmc,
    bestPathConstraintsByDmc,
    selectedDmc,
    cutThreshold,
    pathStagnationLimitMs,
    constraintsByDmc,
    batchPlan,
    pathSearchStatsByDmc,
    pathOptimizationBaselinesByDmc
  };
}

function savePathPlannerState() {
  const snapshot = structuredClone({ ...plannerDraft(), editHistory: pathEditHistory.toJSON() });
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

function capturePathEdit(scope) {
  if (scope.type === "project") return plannerDraft();
  if (scope.type === "settings") return { cutThreshold, pathOptimizationBaselinesByDmc, pathSearchStatsByDmc, batchPlan };
  return { path: pathsByDmc[scope.dmc] || [], constraints: constraintsByDmc[scope.dmc] || {},
    baseline: pathOptimizationBaselinesByDmc[scope.dmc], searchStats: pathSearchStatsByDmc[scope.dmc], batchPlan };
}

function beginPathEdit(label, scope = { type: "color", dmc: selectedDmc }, preserveSearchStats = false) {
  inspectionLinks = null; pathInspection.textContent = "";
  if (scope.type === "color") comparisonPaths.delete(scope.dmc);
  else comparisonPaths.clear();
  comparisonMode = "after";
  pathEditHistory.begin(scope, label, capturePathEdit(scope));
  pathEditPreservesSearchStats = preserveSearchStats;
}

function finishPathEdit() {
  const { scope, before } = pathEditHistory.pending || {};
  if (!scope) return;
  if (!pathEditPreservesSearchStats) {
    if (scope.type === "settings" && before.cutThreshold !== cutThreshold) pathSearchStatsByDmc = {};
    if (scope.type === "color" && (JSON.stringify(before.path) !== JSON.stringify(pathsByDmc[scope.dmc] || [])
      || JSON.stringify(before.constraints) !== JSON.stringify(constraintsByDmc[scope.dmc] || {}))) delete pathSearchStatsByDmc[scope.dmc];
  }
  if (scope.type === "color") rememberBestPath(scope.dmc, pathsByDmc[scope.dmc]);
  pathEditHistory.commit(capturePathEdit(scope));
}

function renderPathHistory() {
  for (const [button, name, label] of [[undoPathPointButton, "Annuler", pathEditHistory.undoLabel],
    [redoPathActionButton, "Retablir", pathEditHistory.redoLabel]]) {
    button.disabled = pathAlgorithmRunning || isDrawingPath || !label;
    button.title = label ? `${name} : ${label}` : name;
    button.setAttribute("aria-label", button.title);
  }
}

function applyPlannerDraft(state) {
  loadedPattern = state.pattern;
  pathsByDmc = state.pathsByDmc || {};
  bestPathsByDmc = state.bestPathsByDmc || {};
  bestPathConstraintsByDmc = state.bestPathConstraintsByDmc || {};
  selectedDmc = state.selectedDmc || orderedPathColors()[0]?.dmc || null;
  cutThreshold = normalizeCutThreshold(state.cutThreshold) || DEFAULT_CUT_THRESHOLD;
  pathStagnationLimitMs = normalizePathStagnationLimit(state.pathStagnationLimitMs) || DEFAULT_PATH_STAGNATION_LIMIT;
  constraintsByDmc = state.constraintsByDmc || {};
  batchPlan = PathBatchPlan.normalize(state.batchPlan);
  pathOptimizationBaselinesByDmc = state.pathOptimizationBaselinesByDmc || {};
  pathSearchStatsByDmc = PathSearchStats.normalizeAll(state.pathSearchStatsByDmc);
}

function travelPathHistory(direction) {
  if (pathAlgorithmRunning || isDrawingPath) return;
  const action = pathEditHistory[direction](capturePathEdit);
  if (!action) return;
  const { scope, before } = action;
  if (scope.type === "project") applyPlannerDraft(before);
  else if (scope.type === "settings") {
    cutThreshold = before.cutThreshold;
    pathOptimizationBaselinesByDmc = before.pathOptimizationBaselinesByDmc;
    pathSearchStatsByDmc = PathSearchStats.normalizeAll(before.pathSearchStatsByDmc);
    batchPlan = before.batchPlan;
  } else {
    selectedDmc = scope.dmc;
    pathsByDmc[selectedDmc] = before.path;
    constraintsByDmc[selectedDmc] = before.constraints;
    if (before.baseline === undefined) delete pathOptimizationBaselinesByDmc[selectedDmc];
    else pathOptimizationBaselinesByDmc[selectedDmc] = before.baseline;
    if (before.searchStats) pathSearchStatsByDmc[selectedDmc] = PathSearchStats.normalize(before.searchStats);
    else delete pathSearchStatsByDmc[selectedDmc];
    batchPlan = before.batchPlan;
  }
  batchRunning = false;
  pathProgress = { load: Boolean(loadedPattern), paths: Boolean(loadedPattern) && areAllColorPathsComplete(loadedPattern, pathsByDmc), export: false };
  activePathStep = loadedPattern ? "paths" : "load";
  pathConstructionSummaries = {};
  comparisonPaths.clear(); comparisonMode = "after";
  clearPathImprovement();
  savePathPlannerState();
  renderPathTool();
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

function renderPathTool() {
  if (!canOpenPathStep(activePathStep)) {
    activePathStep = firstOpenPathStep();
  }

  const label = pathStepLabels[activePathStep];
  pathStepEyebrow.textContent = label.eyebrow;
  pathStepTitle.textContent = label.title;
  resetPathToolButton.disabled = pathAlgorithmRunning;
  renderPathHistory();
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
    clearPathImprovement();
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

function renderPatternGrid(canvasOnly = false) {
  const context = patternCanvas.getContext("2d");
  pathGridStatus.classList.add("hidden");

  if (!loadedPattern) {
    patternCanvas.width = 1;
    patternCanvas.height = 1;
    context.clearRect(0, 0, 1, 1);
    pathColorLegend.innerHTML = "";
    selectedColorLabel.textContent = "Aucune couleur selectionnee";
    viewportPattern = null; comparisonPaths.clear(); comparisonMode = "after";
    renderSearchVisuals();
    return;
  }

  if (activePathStep !== "paths") return;
  if (viewportPattern !== loadedPattern) {
    viewportPattern = loadedPattern; comparisonPaths.clear(); comparisonMode = "after"; overviewCache = null;
    pathViewport.setGrid(loadedPattern.grid.width, loadedPattern.grid.height);
  }
  const width = Math.max(120, Math.floor(pathCanvasStage.clientWidth)), height = Math.max(200, Math.floor(pathCanvasStage.clientHeight));
  if (pathViewport.state.width !== width || pathViewport.state.height !== height) pathViewport.resize(width, height);

  const colorByDmc = new Map(loadedPattern.colors.map((color) => [color.dmc, color]));
  if (!selectedDmc || !colorByDmc.has(selectedDmc)) {
    selectedDmc = orderedPathColors()[0]?.dmc || null;
  }

  if (followPathGains && followedPathImprovement !== pathImprovement && comparisonMode === "after"
      && !panGesture && !isDrawingPath && framePathImprovement()) followedPathImprovement = pathImprovement;
  const cellSize = pathViewport.state.scale, bounds = pathViewport.bounds;
  const selectedColor = colorByDmc.get(selectedDmc);
  const workPalette = PathVisuals.workPalette(workColor);
  const mutedColors = new Map(loadedPattern.colors.map(color => [color.dmc, mutedHex(color.hex || "#d9dddd")]));
  selectedColorLabel.textContent = selectedColor
    ? `DMC ${selectedColor.dmc} - ${selectedColor.symbol || ""}`
    : "Aucune couleur selectionnee";
  selectedColorLabel.style.color = workPalette.line;
  selectedColorLabel.style.backgroundColor = workPalette.fill;
  if (patternCanvas.width !== width) patternCanvas.width = width;
  if (patternCanvas.height !== height) patternCanvas.height = height;
  context.clearRect(0, 0, patternCanvas.width, patternCanvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, patternCanvas.width, patternCanvas.height);
  beginViewportDrawing(context);

  loadedPattern.grid.cells.forEach((cell) => {
    if (cell.x + 1 < bounds.minX || cell.y + 1 < bounds.minY || cell.x > bounds.maxX || cell.y > bounds.maxY) return;
    if (cell.empty) {
      context.fillStyle = "#ffffff";
    } else if (cell.dmc === selectedDmc) {
      context.fillStyle = workPalette.fill;
    } else {
      context.fillStyle = mutedColors.get(cell.dmc) || "#eeeeee";
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

  drawSelectedPath(context, cellSize);
  context.restore();
  drawGridRulers(context, loadedPattern.grid.width, loadedPattern.grid.height, cellSize);
  renderPathImprovement(cellSize);
  renderSearchVisuals();
  renderInspectionControls();
  renderOverview();

  if (!canvasOnly) { renderPathColorLegend(); renderPathBuilder(); }
}

function beginViewportDrawing(context) {
  const view = pathViewport.state;
  context.save(); context.beginPath();
  context.rect(GRID_RULER_SIZE, GRID_RULER_SIZE, view.width - GRID_RULER_SIZE, view.height - GRID_RULER_SIZE); context.clip();
  context.translate(-view.x * view.scale, -view.y * view.scale);
}

function displayedPath() {
  return comparisonMode === "before" && comparisonPaths.has(selectedDmc) ? comparisonPaths.get(selectedDmc).path : currentPath();
}

function queueViewportRender() {
  if (viewFrame !== null) return;
  viewFrame = requestAnimationFrame(() => { viewFrame = null; renderPatternGrid(true); });
}

function showPathGridError(message) {
  pathGridStatus.textContent = message;
  pathGridStatus.classList.remove("hidden");
}

function drawSelectedPath(context, cellSize) {
  const path = displayedPath(), colors = selectedPathDrawingColors(), bounds = pathViewport.bounds;
  const blocks = blocksForColor(selectedDmc);
  context.save(); context.lineCap = "round";
  const pixel = hole => ({ x: GRID_RULER_SIZE + hole.x * cellSize, y: GRID_RULER_SIZE + hole.y * cellSize });
  path.forEach((point, index) => {
    if (index) drawPathSegment(context, path[index - 1], point, cellSize, colors,
      PathVisuals.sameBlock(path[index - 1], point, blocks));
  });
  path.forEach((point, index) => {
    if (point.x + 1 < bounds.minX || point.y + 1 < bounds.minY || point.x > bounds.maxX || point.y > bounds.maxY) return;
    const holes = StitchModel.holes(point), from = pixel(holes.start), to = pixel(holes.end);
    context.strokeStyle = colors.line; context.lineWidth = PathVisuals.strokeWidths(cellSize).front;
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

function blocksForColor(dmc) {
  if (!loadedPattern) return new Map();
  if (!pathBlockCache.has(loadedPattern)) pathBlockCache.set(loadedPattern, new Map());
  const cache = pathBlockCache.get(loadedPattern);
  if (!cache.has(dmc)) cache.set(dmc, PathVisuals.blockIndex(cellsForColor(dmc)));
  return cache.get(dmc);
}

function clearPathImprovement() {
  pathImprovement = null;
  followedPathImprovement = null;
  pathImprovementCanvas.classList.remove("active");
  pathImprovementCanvas.width = 1;
  pathImprovementCanvas.height = 1;
  pathImprovementGain.textContent = "";
}

function recordPathImprovement(dmc, before, after, relayChange = null) {
  if (!before.length || before.length !== after.length) return;
  const previous = pathPerformanceMetrics(before, dmc), next = pathPerformanceMetrics(after, dmc);
  if (constraintApi.compareMetrics(next, previous) >= 0) return;
  const scoreGain = Math.max(0, previous.score - next.score), cutsDelta = previous.cuts - next.cuts;
  if (scoreGain < 1e-8 && cutsDelta <= 0) return;
  pathImprovement = { ...PathVisuals.diffConnections(before, after, blocksForColor(dmc), cutThreshold),
    pattern: loadedPattern, dmc, route: after, count: after.length,
    relayDiagonals: relayChange ? after.filter(p => relayChange.includes(StitchModel.key(p))) : [] };
  const amount = scoreGain > 0 && scoreGain < 0.01 ? "< 0,01"
    : scoreGain.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  const cuts = Math.abs(cutsDelta);
  pathImprovementGain.textContent = `Dernier gain : ${amount}${cuts
    ? ` | ${cuts} coupe${cuts > 1 ? "s" : ""} en ${cutsDelta > 0 ? "moins" : "plus"}` : ""}`;
  // Keep the latest change visible until it is replaced, without an animation loop.
  pathImprovementCanvas.classList.add("active");
}

function renderPathImprovement(cellSize) {
  if (!pathImprovement) return;
  if (pathImprovement.pattern !== loadedPattern || pathImprovement.dmc !== selectedDmc
      || pathImprovement.route !== currentPath() || pathImprovement.count !== currentPath().length || activePathStep !== "paths") {
    clearPathImprovement(); return;
  }
  pathImprovementCanvas.classList.toggle("active", comparisonMode === "after");
  if (comparisonMode === "before") return;
  if (pathImprovementCanvas.width !== patternCanvas.width) pathImprovementCanvas.width = patternCanvas.width;
  if (pathImprovementCanvas.height !== patternCanvas.height) pathImprovementCanvas.height = patternCanvas.height;
  const context = pathImprovementCanvas.getContext("2d");
  context.clearRect(0, 0, pathImprovementCanvas.width, pathImprovementCanvas.height);
  beginViewportDrawing(context); context.lineCap = "round";
  const draw = (link, color, width, dash) => {
    context.strokeStyle = color; context.lineWidth = width; context.setLineDash(dash);
    context.beginPath();
    context.moveTo(GRID_RULER_SIZE + link.from.x * cellSize, GRID_RULER_SIZE + link.from.y * cellSize);
    context.lineTo(GRID_RULER_SIZE + link.to.x * cellSize, GRID_RULER_SIZE + link.to.y * cellSize);
    context.stroke();
  };
  const width = Math.max(2, Math.min(4, cellSize * 0.2));
  pathImprovement.removed.forEach(link => draw(link, "#687580", Math.max(1.2, width * 0.65), [2, 4]));
  pathImprovement.added.forEach(link => {
    draw(link, "rgba(255,255,255,0.95)", width + 2, []);
    draw(link, "#008be2", width, link.isCut ? pathCutDash(cellSize) : []);
    if (link.isCut) draw(link, "#c63848", Math.max(1, width * 0.5), pathCutDash(cellSize));
  });
  pathImprovement.relayDiagonals.forEach(point => {
    const holes = StitchModel.holes(point), link = { from: holes.start, to: holes.end };
    draw(link, "#ffffff", width + 2, []); draw(link, "#008be2", width, []);
  });
  context.restore();
}

function selectedPathDrawingColors() {
  const palette = PathVisuals.workPalette(workColor);
  return {
    line: palette.line,
    cutLine: "#b44b57",
    pointFill: palette.line,
    pointStroke: palette.line,
    currentPointFill: "#ffffff"
  };
}

function trackSearchScore(snapshot) {
  const record = pathSearchStatsByDmc[activePathOptimizerDmc];
  if (!record?.active) return;
  const previousScore = record.score;
  PathSearchStats.update(record, {
    score: activePathOptimizerBestPath.length ? snapshot.metrics?.score : null,
    initialScore: comparisonPaths.get(activePathOptimizerDmc)?.metrics.score,
    elapsedMs: Math.max(snapshot.elapsedMs || 0, performance.now() - activeSearchStartedAt)
  });
  if (record.score !== previousScore) activePathOptimizerNeedsSave = true;
}

function formatSearchGain(gain) {
  if (!gain) return "0";
  return gain < 0.01 ? "<0,01" : `+${gain.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}`;
}

function renderScoreHistory() {
  const record = pathSearchStatsByDmc[selectedDmc];
  scoreHistory = record?.history || [];
  if (scoreChartDmc !== selectedDmc) { scoreChartHover = null; scoreChartDmc = selectedDmc; }
  const width = Math.max(120, Math.round(pathScoreHistory.getBoundingClientRect().width)), height = 170;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  if (pathScoreHistory.width !== Math.round(width * scale) || pathScoreHistory.height !== Math.round(height * scale)) {
    pathScoreHistory.width = Math.round(width * scale); pathScoreHistory.height = Math.round(height * scale);
  }
  const context = pathScoreHistory.getContext("2d");
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  const history = scoreHistory;
  scoreChartPoints = [];
  document.querySelector("#pathScoreChartLabel").textContent = record?.truncated ? "Evolution recente du score" : "Evolution du score";
  context.strokeStyle = "#dce5e3"; context.lineWidth = 1;
  const left = 55, right = width - 8, top = 12, bottom = height - 24;
  context.beginPath(); context.moveTo(left, top); context.lineTo(left, bottom); context.lineTo(right, bottom); context.stroke();
  pathScoreHistory.setAttribute("aria-label", "Evolution du meilleur score");
  if (!history.length) { pathScoreReading.textContent = record?.active ? "Construction du premier parcours" : "Aucune recherche pour cette couleur"; return; }
  const max = history[0].score, min = history.at(-1).score, span = Math.max(max - min, 1e-8);
  const elapsed = Math.max(1, history.at(-1).elapsed - history[0].elapsed);
  scoreChartPoints = history.map(p => ({ x: left + (right - left) * (p.elapsed - history[0].elapsed) / elapsed,
    y: max === min ? (top + bottom) / 2 : top + (bottom - top) * (max - p.score) / span }));
  context.font = "11px system-ui"; context.fillStyle = "#677573"; context.textAlign = "right";
  context.fillText(formatMetric(max), left - 7, top + 4);
  if (max !== min) context.fillText(formatMetric(min), left - 7, bottom + 3);
  context.textAlign = "left"; context.fillText(formatAlgorithmTime(history[0].elapsed), left, height - 5);
  context.textAlign = "right"; context.fillText(formatAlgorithmTime(history.at(-1).elapsed), right, height - 5);
  context.lineWidth = 2.5; context.lineJoin = "round";
  scoreChartPoints.forEach((point, index) => {
    if (!index) return;
    const previous = scoreChartPoints[index - 1];
    context.strokeStyle = PathSearchStats.modes[history[index].mode]?.color || "#677573";
    context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(point.x, point.y); context.stroke();
  });
  const index = scoreChartHover === null ? history.length - 1 : Math.min(scoreChartHover, history.length - 1);
  const point = scoreChartPoints[index], entry = history[index], mode = PathSearchStats.modes[entry.mode];
  context.fillStyle = mode?.color || "#677573";
  if (scoreChartHover !== null) {
    context.strokeStyle = "#acb9b6"; context.lineWidth = 1; context.setLineDash([3, 3]);
    context.beginPath(); context.moveTo(point.x, top); context.lineTo(point.x, bottom); context.stroke(); context.setLineDash([]);
  }
  context.beginPath(); context.arc(point.x, point.y, 3.5, 0, Math.PI * 2); context.fill();
  pathScoreReading.textContent = `${mode?.label || "Debut"} - ${formatAlgorithmTime(entry.elapsed)} - score ${formatMetric(entry.score)}${entry.gain > 0 ? ` - gain ${formatSearchGain(entry.gain)}` : ""}`;
  pathScoreHistory.setAttribute("aria-label", `Meilleur score : ${formatMetric(max)} vers ${formatMetric(min)}`);
}

function renderSearchGains() {
  const record = pathSearchStatsByDmc[selectedDmc];
  const gain = Object.values(record?.totals || {}).reduce((sum, total) => sum + total.gain, 0);
  document.querySelector("#pathGainTotal").textContent = record ? `${formatSearchGain(gain)} au total` : "";
  if (!pathGainRows.children.length) {
    for (const [mode, definition] of Object.entries(PathSearchStats.modes)) {
      const row = document.createElement("tr"); row.dataset.mode = mode;
      const label = document.createElement("th"); label.scope = "row";
      const key = document.createElement("span"); key.className = "path-gain-key";
      key.style.setProperty("--engine-color", definition.color); key.textContent = definition.short;
      label.append(key, document.createTextNode(definition.label.replace(/^Moteur \d : |^Boucle \d : /, "").replace("Optimisation ", "")));
      row.append(label, document.createElement("td"), document.createElement("td")); pathGainRows.append(row);
    }
  }
  for (const row of pathGainRows.children) {
    const mode = row.dataset.mode, total = record?.totals[mode], active = record?.active?.mode === mode && pathAlgorithmRunning;
    row.classList.toggle("active", active); row.classList.toggle("unused", !total);
    row.title = `${PathSearchStats.modes[mode].label} - ${total ? `${total.runs} passage(s)${active ? " - en cours" : ""}` : "Non lance"}`;
    row.cells[1].textContent = total ? formatSearchGain(total.gain) : "-";
    row.cells[2].textContent = total ? formatAlgorithmTime(total.elapsedMs) : "-";
  }
}

pathScoreHistory.addEventListener("pointermove", event => {
  if (!scoreChartPoints.length) return;
  const x = event.clientX - pathScoreHistory.getBoundingClientRect().left;
  scoreChartHover = scoreChartPoints.reduce((best, point, index) =>
    Math.abs(point.x - x) < Math.abs(scoreChartPoints[best].x - x) ? index : best, 0);
  renderScoreHistory();
});
pathScoreHistory.addEventListener("pointerleave", () => { scoreChartHover = null; renderScoreHistory(); });
pathScoreHistory.addEventListener("keydown", event => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !scoreChartPoints.length) return;
  event.preventDefault();
  const last = scoreChartPoints.length - 1;
  scoreChartHover = event.key === "Home" ? 0 : event.key === "End" ? last
    : Math.max(0, Math.min(last, (scoreChartHover ?? last) + (event.key === "ArrowLeft" ? -1 : 1)));
  renderScoreHistory();
});
document.querySelector("#pathGainDetails").addEventListener("toggle", renderScoreHistory);

function renderSearchVisuals() {
  renderScoreHistory();
  renderSearchGains();
}

function captureComparison(dmc, path) {
  if (comparisonPaths.has(dmc) || !path.length || StitchModel.validateRoute(path, cellsForColor(dmc))
      || !constraintApi.satisfiesConstraints(path, constraintsByDmc[dmc])) return;
  const metrics = pathPerformanceMetrics(path, dmc);
  comparisonPaths.set(dmc, { path: path.map(copyPoint), metrics });
}

let comparisonMetricCache = null;
function renderInspectionControls() {
  const before = comparisonPaths.get(selectedDmc), path = currentPath();
  if (!before) comparisonMode = "after";
  pathViewBefore.disabled = !before;
  pathViewBefore.title = before ? "Parcours au debut de cette recherche" : "Disponible apres la construction d'un parcours complet";
  pathViewBefore.setAttribute("aria-pressed", String(comparisonMode === "before"));
  pathViewAfter.setAttribute("aria-pressed", String(comparisonMode === "after"));
  if (before) {
    if (comparisonMetricCache?.path !== path || comparisonMetricCache.length !== path.length || comparisonMetricCache.threshold !== cutThreshold) {
      comparisonMetricCache = { path, length: path.length, threshold: cutThreshold, metrics: pathPerformanceMetrics(path) };
    }
    pathComparisonScore.textContent = `Avant : ${formatMetric(before.metrics.score)} | Apres : ${formatMetric(comparisonMetricCache.metrics.score)}`;
  } else pathComparisonScore.textContent = "";
  document.querySelector("#pathZoomLevel").textContent = `${Math.round(pathViewport.state.zoom * 100)} %`;
  document.querySelector("#pathZoomOut").disabled = pathViewport.state.zoom <= 1 + 1e-8;
  document.querySelector("#pathZoomIn").disabled = pathViewport.state.scale >= 80;
  document.querySelector("#pathDrawMode").disabled = pathAlgorithmRunning || comparisonMode === "before";
  document.querySelector("#pathConstraints").disabled = pathAlgorithmRunning || comparisonMode === "before";
  const pan = inspectionMode === "pan" || pathAlgorithmRunning || comparisonMode === "before";
  document.querySelector("#pathDrawMode").setAttribute("aria-pressed", String(!pan && inspectionMode === "draw"));
  document.querySelector("#pathPanMode").setAttribute("aria-pressed", String(pan));
  patternCanvas.classList.toggle("is-pan", pan);
  document.querySelector("#pathFocusGain").disabled = !pathImprovement || pathImprovement.dmc !== selectedDmc;
  pathFollowGains.checked = followPathGains;
  pathFollowGains.parentElement.title = comparisonMode === "before"
    ? "Suivi en pause dans la vue Avant" : "Cadrer automatiquement les dernieres ameliorations";
}

function renderOverview() {
  const width = pathOverview.width, height = pathOverview.height;
  const scale = Math.min((width - 8) / loadedPattern.grid.width, (height - 8) / loadedPattern.grid.height);
  const offsetX = (width - loadedPattern.grid.width * scale) / 2, offsetY = (height - loadedPattern.grid.height * scale) / 2;
  if (overviewCache?.pattern !== loadedPattern || overviewCache.dmc !== selectedDmc || overviewCache.color !== workColor) {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d"), colors = new Map(loadedPattern.colors.map(color => [color.dmc, color.hex]));
    context.fillStyle = "#f4f6f4"; context.fillRect(0, 0, width, height);
    loadedPattern.grid.cells.forEach(cell => {
      if (cell.empty) return;
      context.fillStyle = cell.dmc === selectedDmc ? workColor : mutedHex(colors.get(cell.dmc));
      context.fillRect(offsetX + cell.x * scale, offsetY + cell.y * scale, Math.max(1, scale), Math.max(1, scale));
    });
    overviewCache = { pattern: loadedPattern, dmc: selectedDmc, color: workColor, canvas };
  }
  const context = pathOverview.getContext("2d"), bounds = pathViewport.bounds;
  context.clearRect(0, 0, width, height); context.drawImage(overviewCache.canvas, 0, 0);
  const x = offsetX + bounds.minX * scale, y = offsetY + bounds.minY * scale;
  const w = (bounds.maxX - bounds.minX) * scale, h = (bounds.maxY - bounds.minY) * scale;
  context.strokeStyle = "#ffffff"; context.lineWidth = 4; context.strokeRect(x, y, w, h);
  context.strokeStyle = "#007fa3"; context.lineWidth = 2; context.strokeRect(x, y, w, h);
}

function inspectConnection(point) {
  const route = displayedPath();
  if (inspectionLinks?.route !== route || inspectionLinks.length !== route.length || inspectionLinks.threshold !== cutThreshold) {
    inspectionLinks = { route, length: route.length, threshold: cutThreshold, links: route.slice(1).map((next, i) => {
      const from = StitchModel.holes(route[i]).end, to = StitchModel.holes(next).start;
      return { from, to, distance: StitchModel.distance(route[i], next), cut: isCutJump(route[i], next), index: i + 1 };
    }) };
  }
  const world = pathViewport.toWorld(point); let nearest = null, gap = 8 / pathViewport.state.scale;
  for (const link of inspectionLinks.links) {
    const dx = link.to.x - link.from.x, dy = link.to.y - link.from.y;
    const t = Math.max(0, Math.min(1, ((world.x - link.from.x) * dx + (world.y - link.from.y) * dy) / (dx * dx + dy * dy || 1)));
    const distance = Math.hypot(world.x - link.from.x - t * dx, world.y - link.from.y - t * dy);
    if (distance < gap) { gap = distance; nearest = link; }
  }
  pathInspection.textContent = nearest ? `${nearest.cut ? "Coupe" : "Dos"} ${nearest.index} : ${nearest.distance.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} cases | (${nearest.from.x}, ${nearest.from.y}) vers (${nearest.to.x}, ${nearest.to.y})` : "";
}

function drawPathSegment(context, fromPoint, toPoint, cellSize, colors, internal = false) {
  const from = StitchModel.holes(fromPoint).end, to = StitchModel.holes(toPoint).start;
  const bounds = pathViewport.bounds;
  if (Math.max(from.x, to.x) < bounds.minX || Math.max(from.y, to.y) < bounds.minY
      || Math.min(from.x, to.x) > bounds.maxX || Math.min(from.y, to.y) > bounds.maxY) return;
  const isCut = isCutJump(fromPoint, toPoint);
  const width = PathVisuals.strokeWidths(cellSize, isCut, internal).back;
  context.setLineDash(isCut ? pathCutDash(cellSize) : internal
    ? [Math.max(1, cellSize * 0.15), Math.max(1, cellSize * 0.15)]
    : [Math.max(3, cellSize * 0.3), Math.max(2.4, cellSize * 0.22)]);
  context.beginPath();
  context.moveTo(GRID_RULER_SIZE + from.x * cellSize, GRID_RULER_SIZE + from.y * cellSize);
  context.lineTo(GRID_RULER_SIZE + to.x * cellSize, GRID_RULER_SIZE + to.y * cellSize);
  if (!isCut && !internal) {
    context.strokeStyle = "#ffffff"; context.lineWidth = width + 1.5; context.stroke();
  }
  context.strokeStyle = isCut ? "#c63848" : internal ? colors.line : "#3f4b55";
  context.lineWidth = width;
  context.stroke(); context.setLineDash([]);
}

function pathCutDash(cellSize) {
  return [
    Math.max(1.5, cellSize * 0.55),
    Math.max(1.2, cellSize * 0.42)
  ];
}

function renderPathBuilder() {
  restoreBestPathButton.disabled = pathAlgorithmRunning || !recoverableBestPath(selectedDmc);
  stopPathAlgorithmButton.classList.toggle("hidden", !activePathOptimizerWorker);
  stopPathAlgorithmButton.disabled = !activePathOptimizerWorker;
  pathStagnationLimit.disabled = pathAlgorithmRunning;
  cutThresholdInput.disabled = pathAlgorithmRunning;

  if (!loadedPattern || !selectedDmc) {
    pathBuildStatus.className = "coverage-status invalid";
    pathBuildStatus.textContent = "Selectionne une couleur pour construire son chemin.";
    optimizedPathButton.disabled = true;
    deepOptimizeButton.disabled = true;
    lnsOptimizeButton.disabled = true;
    adaptiveOptimizeButton.disabled = true;
    pointsOptimizeButton.disabled = true;
    sectionsOptimizeButton.disabled = true;
    segmentsOptimizeButton.disabled = true;
    chainsOptimizeButton.disabled = true;
    relayOptimizeButton.disabled = true;
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
  deepOptimizeButton.disabled = expected === 0 || pathAlgorithmRunning;
  lnsOptimizeButton.disabled = expected === 0 || pathAlgorithmRunning;
  adaptiveOptimizeButton.disabled = expected === 0 || pathAlgorithmRunning;
  pointsOptimizeButton.disabled = expected === 0 || pathAlgorithmRunning;
  sectionsOptimizeButton.disabled = expected === 0 || pathAlgorithmRunning;
  segmentsOptimizeButton.disabled = expected === 0 || pathAlgorithmRunning || !complete;
  segmentsOptimizeButton.title = complete ? "" : "Un chemin complet est necessaire";
  chainsOptimizeButton.disabled = expected === 0 || pathAlgorithmRunning || !complete;
  chainsOptimizeButton.title = complete ? "" : "Un chemin complet est necessaire";
  relayOptimizeButton.disabled = expected === 0 || pathAlgorithmRunning || !complete;
  relayOptimizeButton.title = complete ? "" : "Un chemin complet est necessaire";
  clearPathButton.disabled = path.length === 0 || pathAlgorithmRunning;
  savePathAndNextButton.disabled = !complete || pathAlgorithmRunning;

  if (!pathAlgorithmRunning) {
    renderPathDistanceFeedback();
  }
}

function renderPathDistanceFeedback() {
  resetAlgorithmLiveMetrics();
  const path = currentPath();
  const summary = pathConstructionSummaries[selectedDmc];
  if (summary?.route === path && summary.count === path.length) {
    showAlgorithmFeedback(summary.label);
    updateAlgorithmLiveMetrics(summary.snapshot);
    return;
  }
  pathAlgorithmFeedback.classList.add("hidden");
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

function toHex(value) {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function drawGridLines(context, width, height, cellSize) {
  context.save();
  const bounds = pathViewport.bounds;

  for (let x = Math.ceil(bounds.minX); x <= bounds.maxX; x += 1) {
    const isMajorLine = x % 10 === 0;
    context.strokeStyle = isMajorLine ? "rgba(34, 36, 38, 0.34)" : "rgba(34, 36, 38, 0.18)";
    context.lineWidth = isMajorLine ? 1.5 : 1;
    context.beginPath();
    context.moveTo(GRID_RULER_SIZE + x * cellSize + 0.5, GRID_RULER_SIZE);
    context.lineTo(GRID_RULER_SIZE + x * cellSize + 0.5, GRID_RULER_SIZE + height * cellSize);
    context.stroke();
  }

  for (let y = Math.ceil(bounds.minY); y <= bounds.maxY; y += 1) {
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
  const view = pathViewport.state, bounds = pathViewport.bounds;
  context.fillStyle = "#f4f6f4";
  context.fillRect(0, 0, view.width, GRID_RULER_SIZE);
  context.fillRect(0, 0, GRID_RULER_SIZE, view.height);
  context.fillStyle = "#5f6b69";
  context.strokeStyle = "rgba(34, 36, 38, 0.24)";
  context.lineWidth = 1;
  context.font = "10px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";

  const step = Math.max(10, Math.ceil(35 / cellSize / 10) * 10);
  for (let x = Math.max(step, Math.ceil(bounds.minX / step) * step); x <= bounds.maxX; x += step) {
    const position = GRID_RULER_SIZE + (x - view.x) * cellSize;
    context.beginPath();
    context.moveTo(position + 0.5, GRID_RULER_SIZE - 7);
    context.lineTo(position + 0.5, GRID_RULER_SIZE);
    context.stroke();
    context.fillText(String(x), position, Math.floor(GRID_RULER_SIZE / 2));
  }

  context.textAlign = "right";
  for (let y = Math.max(step, Math.ceil(bounds.minY / step) * step); y <= bounds.maxY; y += step) {
    const position = GRID_RULER_SIZE + (y - view.y) * cellSize;
    context.beginPath();
    context.moveTo(GRID_RULER_SIZE - 7, position + 0.5);
    context.lineTo(GRID_RULER_SIZE, position + 0.5);
    context.stroke();
    context.fillText(String(y), GRID_RULER_SIZE - 9, position);
  }

  context.strokeStyle = "rgba(34, 36, 38, 0.32)";
  context.beginPath();
  context.moveTo(GRID_RULER_SIZE + 0.5, 0);
  context.lineTo(GRID_RULER_SIZE + 0.5, view.height);
  context.moveTo(0, GRID_RULER_SIZE + 0.5);
  context.lineTo(view.width, GRID_RULER_SIZE + 0.5);
  context.stroke();
  context.restore();
}

function pathColorCounts() {
  if (!loadedPattern) return new Map();
  if (!pathColorCountsCache.has(loadedPattern)) {
    pathColorCountsCache.set(loadedPattern, ColorOrder.countCells(loadedPattern.grid.cells));
  }
  return pathColorCountsCache.get(loadedPattern);
}

function orderedPathColors() {
  const counts = pathColorCounts();
  return ColorOrder.byCount(loadedPattern?.colors || [], color => counts.get(color.dmc));
}

function renderPathColorLegend() {
  pathColorLegend.innerHTML = "";

  orderedPathColors().forEach((color) => {
    const path = pathsByDmc[color.dmc] || [];
    const expected = (pathColorCounts().get(color.dmc) || 0) * 2;
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

function comparePathPerformance(a, b, dmc = selectedDmc) {
  const left = pathPerformanceMetrics(a, dmc), right = pathPerformanceMetrics(b, dmc);
  return constraintApi.compareMetrics(left, right);
}

function isCutJump(fromPoint, toPoint) {
  return Boolean(toPoint.cutBefore) || isCutDistance(threadDistance(fromPoint, toPoint));
}

function isCutDistance(distance) {
  return distance > cutThreshold;
}

function rememberBestPath(dmc, candidatePath) {
  if (!Array.isArray(candidatePath) || !isCompletePathForColor(loadedPattern, { [dmc]: candidatePath }, dmc)
      || !constraintApi.satisfiesConstraints(candidatePath, constraintsByDmc[dmc])) {
    return {
      path: candidatePath || [],
      candidateDistance: 0,
      bestDistance: 0,
      improved: false
    };
  }

  const candidateDistance = pathPerformanceMetrics(candidatePath, dmc).score;
  const currentBest = isCompletePathForColor(loadedPattern, bestPathsByDmc, dmc)
    && constraintApi.satisfiesConstraints(bestPathsByDmc[dmc], constraintsByDmc[dmc]) ? bestPathsByDmc[dmc] : null;
  const bestDistance = currentBest ? pathPerformanceMetrics(currentBest, dmc).score : Number.POSITIVE_INFINITY;
  const improved = !currentBest || comparePathPerformance(candidatePath, currentBest, dmc) < 0;

  if (improved) {
    bestPathsByDmc[dmc] = candidatePath.map(copyPoint);
  }
  bestPathConstraintsByDmc[dmc] = structuredClone(constraintsByDmc[dmc] || {});

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

function threadDistance(a, b) {
  return a.diagonal && b.diagonal ? StitchModel.distance(a, b) : Math.hypot(a.x - b.x, a.y - b.y);
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

  const pixel = canvasEventPoint(event);
  if (pixel.x < GRID_RULER_SIZE || pixel.y < GRID_RULER_SIZE) return null;
  const point = pathViewport.toWorld(pixel);
  return findCellAt(Math.floor(point.x), Math.floor(point.y));
}

function canvasEventPoint(event) {
  const rect = patternCanvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * patternCanvas.width / rect.width,
    y: (event.clientY - rect.top) * patternCanvas.height / rect.height };
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
    showPathGridError("La diagonale / de cette case doit etre ajoutee d'abord.");
    return false;
  }
  const chosenDirection = document.querySelector("#diagonalDirection").value;
  const candidate = { x: cell.x, y: cell.y, diagonal, direction: chosenDirection === "-1" ? -1 : 1 };
  if (path.length && StitchModel.distance(path.at(-1), candidate) === 0) {
    if (chosenDirection !== "auto") {
      showPathGridError("Transition impossible : sortie et entree dans le meme trou.");
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

  const colors = orderedPathColors();
  const currentIndex = colors.findIndex((color) => color.dmc === selectedDmc);
  const nextColor = colors.find((color, index) => index > currentIndex && !isPathComplete(color.dmc))
    || colors.find((color) => !isPathComplete(color.dmc))
    || colors[Math.min(currentIndex + 1, colors.length - 1)];

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
  currentColorOptimizeButton.disabled = !loadedPattern || !selectedDmc || !cellsForColor(selectedDmc).length || pathAlgorithmRunning;
  batchOptimizeButton.textContent = batchRunning && batchPlan.scope === "all" ? "Optimisation des couleurs en cours"
    : batchPlan.scope === "all" && batchPlan.pending.length ? "Reprendre les couleurs restantes" : "Optimiser toutes les couleurs";
  currentColorOptimizeButton.textContent = batchRunning && batchPlan.scope === "color" ? "Optimisation de la couleur en cours"
    : batchPlan.scope === "color" && batchPlan.pending[0] === selectedDmc ? "Reprendre la couleur actuelle" : "Optimiser la couleur actuelle";
  renderBatchStatus();
  const results = document.querySelector("#batchResults");
  document.querySelector("#batchStatus").classList.toggle("hidden", !batchPlan.pending.length && !batchPlan.results.length);
  document.querySelector("#batchResultDetails").classList.toggle("hidden", !batchPlan.results.length);
  results.replaceChildren();
  ColorOrder.byCount(batchPlan.results, result => pathColorCounts().get(result.dmc)).forEach((result) => {
    const row = document.createElement("p");
    row.textContent = `DMC ${result.dmc} : ${Number.isFinite(result.initial) ? formatMetric(result.initial) : "-"} > ${formatMetric(result.score)} (${result.cuts} coupes)`;
    results.appendChild(row);
  });
  document.querySelector("#pathConstraints").disabled = pathAlgorithmRunning || comparisonMode === "before";
  const constraints = constraintsByDmc[selectedDmc] || {};
  lockedPrefixCount.max = String(currentPath().length);
  lockedPrefixCount.value = String(constraints.lockedPrefix?.length || 0);
  const settings = [];
  if (pathEditMode.value !== "draw") settings.push(pathEditMode.value === "start" ? "Mode depart" : "Mode coupe");
  if (constraints.start) settings.push(`Depart : ${constraints.start.x + 1}, ${constraints.start.y + 1}`);
  if (constraints.lockedPrefix?.length) settings.push(`${constraints.lockedPrefix.length} verrouillees`);
  if (constraints.forcedCuts?.length) settings.push(`${constraints.forcedCuts.length} coupes imposees`);
  const diagonal = document.querySelector("#diagonalMode").value, direction = document.querySelector("#diagonalDirection").value;
  if (diagonal !== "auto") settings.push(diagonal === "lower" ? "Diagonale /" : "Diagonale \\");
  if (direction !== "auto") settings.push(direction === "1" ? "Sens droite" : "Sens gauche");
  document.querySelector("#constraintsStatus").textContent = settings.join(" - ");
}

function renderBatchStatus(metrics = null) {
  document.querySelector("#batchStatus").textContent = PathBatchPlan.status(batchPlan, batchRunning);
  const gain = document.querySelector("#batchCycleGain"), current = batchPlan.current;
  const visible = current?.dmc === selectedDmc && Number.isFinite(current.cycleStartScore);
  gain.classList.toggle("hidden", !visible);
  if (visible) {
    const score = (metrics || pathPerformanceMetrics(currentPath(), selectedDmc)).score;
    gain.textContent = `Gain du cycle : ${formatSignedMetric(current.cycleStartScore - score)}`;
  }
}

for (const control of [pathEditMode, document.querySelector("#diagonalMode"), document.querySelector("#diagonalDirection")]) {
  control.addEventListener("change", renderPlanningOptions);
}

function runNextBatchColor() {
  if (!batchRunning || pathAlgorithmRunning || !batchPlan.pending.length) return;
  selectedDmc = batchPlan.pending[0];
  activePathStep = "paths";
  const best = batchPlan.current ? [] : bestCompletePathForColor(selectedDmc);
  batchPlan = PathBatchPlan.prepare(batchPlan, best.length ? pathPerformanceMetrics(best, selectedDmc).score : null);
  if (!cellsForColor(selectedDmc).length) {
    batchPlan = PathBatchPlan.complete(batchPlan, batchPlan.current, { score: 0, cuts: 0, empty: true });
    batchRunning = Boolean(batchPlan.pending.length);
    savePathPlannerState();
    renderPathTool();
    if (batchRunning) queueMicrotask(runNextBatchColor);
    return;
  }
  renderPathTool();
  startAdvancedPathSearch(batchPlan.current.phase, { ...batchPlan.current });
  if (!pathAlgorithmRunning) {
    batchRunning = false;
    savePathPlannerState();
    renderPlanningOptions();
  }
}

function startColorOptimization(scope) {
  if (!loadedPattern || pathAlgorithmRunning) return;
  if (scope === "color" && (!selectedDmc || !cellsForColor(selectedDmc).length)) return;
  const colors = scope === "color" ? [selectedDmc] : orderedPathColors().map(color => color.dmc);
  batchPlan = PathBatchPlan.normalize(batchPlan);
  if (batchPlan.scope !== scope || !batchPlan.pending.length || (scope === "color" && batchPlan.pending[0] !== selectedDmc)) {
    const current = colors.includes(batchPlan.current?.dmc) ? batchPlan.current : null;
    batchPlan = PathBatchPlan.normalize({ version: batchPlan.version, scope, current, results: [],
      pending: current ? [current.dmc, ...colors.filter(dmc => dmc !== current.dmc)] : colors });
  } else {
    const current = batchPlan.current?.dmc;
    const remaining = colors.filter(dmc => batchPlan.pending.includes(dmc) && dmc !== current);
    batchPlan.pending = current && batchPlan.pending.includes(current) ? [current, ...remaining] : remaining;
  }
  batchRunning = true;
  savePathPlannerState();
  runNextBatchColor();
}

batchOptimizeButton.addEventListener("click", () => startColorOptimization("all"));
currentColorOptimizeButton.addEventListener("click", () => startColorOptimization("color"));

function updateConstraints(constraints) {
  constraintsByDmc[selectedDmc] = constraints;
  delete pathOptimizationBaselinesByDmc[selectedDmc];
  invalidateBatchResult(selectedDmc);
  pathProgress.export = false;
  finishPathEdit();
  savePathPlannerState();
  renderPathTool();
}

function invalidateBatchResult(dmc) {
  if (!pathAlgorithmRunning && pathImprovement?.dmc === dmc) clearPathImprovement();
  delete pathConstructionSummaries[dmc];
  if (!batchRunning && batchPlan.current?.dmc === dmc) batchPlan.current = null;
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
      const oriented = StitchModel.orient(sequence, cutThreshold, next);
      beginPathEdit(`Depart DMC ${selectedDmc}`);
      pathsByDmc[selectedDmc] = oriented;
      updateConstraints(next);
    } catch (error) { alert(error.message); }
  } else if (index >= 0) {
    beginPathEdit(`Coupe DMC ${selectedDmc}`);
    path[index].cutBefore = !path[index].cutBefore;
    constraints.forcedCuts = path.filter(p => p.cutBefore).map(copyPoint);
    updateConstraints(constraints);
  }
}

lockedPrefixCount.addEventListener("change", () => {
  if (pathAlgorithmRunning || !selectedDmc) return;
  beginPathEdit(`Verrouillage DMC ${selectedDmc}`);
  const count = Math.min(currentPath().length, Math.max(0, Math.floor(Number(lockedPrefixCount.value) || 0)));
  const constraints = constraintsByDmc[selectedDmc] || {};
  updateConstraints({ ...constraints, lockedPrefix: currentPath().slice(0, count).map(copyPoint), start: count ? copyPoint(currentPath()[0]) : constraints.start });
});

document.querySelector("#clearConstraintsButton").addEventListener("click", () => {
  if (pathAlgorithmRunning || !selectedDmc) return;
  beginPathEdit(`Contraintes DMC ${selectedDmc}`);
  currentPath().forEach(p => delete p.cutBefore);
  updateConstraints({});
});

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
    pathSearchStatsByDmc = {};
    loadedPattern = imported.pattern;
    pathsByDmc = imported.pathsByDmc;
    constraintsByDmc = imported.constraintsByDmc || {};
    cutThreshold = imported.cutThreshold || DEFAULT_CUT_THRESHOLD;
    batchPlan = { pending: [], results: [] };
    batchRunning = false;
    bestPathsByDmc = clonePaths(pathsByDmc);
    bestPathConstraintsByDmc = structuredClone(constraintsByDmc);
    pathEditHistory = createPathEditHistory();
    pathConstructionSummaries = {};
    selectedDmc = orderedPathColors()[0]?.dmc || null;
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
  if (loadedPattern && !isDrawingPath && (event.button === 0 || event.button === 1)
      && (inspectionMode === "pan" || pathAlgorithmRunning || comparisonMode === "before" || event.button === 1 || event.altKey)) {
    event.preventDefault(); patternCanvas.focus({ preventScroll: true });
    viewPointers.set(event.pointerId, canvasEventPoint(event));
    panGesture = pointerGesture(); patternCanvas.setPointerCapture(event.pointerId);
    patternCanvas.classList.add("is-panning"); return;
  }
  if (!loadedPattern || !selectedDmc || pathAlgorithmRunning || isDrawingPath || event.button !== 0) {
    return;
  }

  if (pathEditMode.value !== "draw") {
    editPathConstraint(cellFromCanvasEvent(event));
    return;
  }

  event.preventDefault();
  beginPathEdit(`Trace DMC ${selectedDmc}`);
  isDrawingPath = true;
  lastDrawnCellKey = null;
  lastPointerCell = cellFromCanvasEvent(event);
  patternCanvas.setPointerCapture(event.pointerId);
  addCellsToCurrentPath([lastPointerCell]);
});

patternCanvas.addEventListener("pointermove", (event) => {
  if (viewPointers.has(event.pointerId)) {
    event.preventDefault(); viewPointers.set(event.pointerId, canvasEventPoint(event));
    const next = pointerGesture();
    if (panGesture) {
      if (next.count > 1 && panGesture.count > 1 && panGesture.distance > 0) pathViewport.zoom(next.distance / panGesture.distance, panGesture.center);
      pathViewport.pan(next.center.x - panGesture.center.x, next.center.y - panGesture.center.y);
    }
    panGesture = next; queueViewportRender(); return;
  }
  if (!isDrawingPath) {
    queueConnectionInspection(canvasEventPoint(event));
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
  finishViewportPointer(event);
  if (isDrawingPath) {
    finishPathEdit();
    savePathPlannerState();
  }
  isDrawingPath = false;
  lastDrawnCellKey = null;
  lastPointerCell = null;
  if (patternCanvas.hasPointerCapture(event.pointerId)) {
    patternCanvas.releasePointerCapture(event.pointerId);
  }
  renderPathHistory();
  renderPathBuilder();
});

function finishInterruptedPathDrawing() {
  if (isDrawingPath) {
    finishPathEdit();
    savePathPlannerState();
  }
  isDrawingPath = false;
  lastDrawnCellKey = null;
  lastPointerCell = null;
  renderPathHistory();
  renderPathBuilder();
}
for (const name of ["pointercancel", "lostpointercapture"]) patternCanvas.addEventListener(name, event => {
  finishViewportPointer(event); finishInterruptedPathDrawing();
});

function pointerGesture() {
  const points = [...viewPointers.values()].slice(0, 2);
  if (!points.length) return null;
  return { count: points.length, center: points.length === 1 ? points[0]
    : { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
    distance: points.length === 1 ? 0 : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) };
}
function finishViewportPointer(event) {
  viewPointers.delete(event.pointerId); panGesture = pointerGesture();
  patternCanvas.classList.toggle("is-panning", Boolean(panGesture));
  if (!panGesture && followPathGains && followedPathImprovement !== pathImprovement) queueViewportRender();
}
let inspectFrame = null, pendingInspection = null;
function queueConnectionInspection(point) {
  pendingInspection = point;
  if (inspectFrame !== null) return;
  inspectFrame = requestAnimationFrame(() => { inspectFrame = null; if (loadedPattern && !panGesture && !isDrawingPath) inspectConnection(pendingInspection); });
}
patternCanvas.addEventListener("wheel", event => {
  if (!loadedPattern || isDrawingPath || panGesture) return;
  event.preventDefault();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? patternCanvas.height : 1);
  pathViewport.zoom(Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.003), canvasEventPoint(event));
  queueViewportRender();
}, { passive: false });
patternCanvas.addEventListener("keydown", event => {
  if (!loadedPattern || isDrawingPath || event.ctrlKey || event.metaKey || event.altKey) return;
  if (["+", "="].includes(event.key)) pathViewport.zoom(1.4);
  else if (event.key === "-") pathViewport.zoom(1 / 1.4);
  else if (event.key === "Home") pathViewport.fit();
  else if (event.key.startsWith("Arrow")) {
    const delta = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] }[event.key];
    pathViewport.pan(...delta);
  } else return;
  event.preventDefault(); queueViewportRender();
});
document.querySelector("#pathZoomIn").addEventListener("click", () => { pathViewport.zoom(1.4); queueViewportRender(); });
document.querySelector("#pathZoomOut").addEventListener("click", () => { pathViewport.zoom(1 / 1.4); queueViewportRender(); });
document.querySelector("#pathFitView").addEventListener("click", () => { pathViewport.fit(); queueViewportRender(); });
document.querySelector("#pathPanMode").addEventListener("click", () => { inspectionMode = "pan"; renderInspectionControls(); });
document.querySelector("#pathDrawMode").addEventListener("click", () => { inspectionMode = "draw"; renderInspectionControls(); });
for (const [button, mode] of [[pathViewBefore, "before"], [pathViewAfter, "after"]]) button.addEventListener("click", () => {
  if (isDrawingPath || panGesture) return;
  comparisonMode = mode; pathInspection.textContent = ""; queueViewportRender();
});
function framePathImprovement() {
  if (!pathImprovement || pathImprovement.pattern !== loadedPattern || pathImprovement.dmc !== selectedDmc
      || pathImprovement.route !== currentPath() || activePathStep !== "paths") return false;
  const links = [...pathImprovement.added, ...pathImprovement.removed,
    ...pathImprovement.relayDiagonals.map(point => { const holes = StitchModel.holes(point); return { from: holes.start, to: holes.end }; })];
  if (!links.length) return false;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const link of links) for (const point of [link.from, link.to]) {
    bounds.minX = Math.min(bounds.minX, point.x); bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x); bounds.maxY = Math.max(bounds.maxY, point.y);
  }
  pathViewport.frame(bounds);
  return true;
}
document.querySelector("#pathFocusGain").addEventListener("click", () => {
  if (framePathImprovement()) queueViewportRender();
});
pathFollowGains.addEventListener("change", () => {
  followPathGains = pathFollowGains.checked;
  followedPathImprovement = null;
  try { localStorage.setItem(FOLLOW_GAINS_STORAGE_KEY, String(followPathGains)); } catch {}
  queueViewportRender();
});
pathOverview.addEventListener("pointerdown", event => {
  if (!loadedPattern) return;
  event.preventDefault();
  const rect = pathOverview.getBoundingClientRect(), width = pathOverview.width, height = pathOverview.height;
  const scale = Math.min((width - 8) / loadedPattern.grid.width, (height - 8) / loadedPattern.grid.height);
  pathViewport.center({ x: ((event.clientX - rect.left) * width / rect.width - (width - loadedPattern.grid.width * scale) / 2) / scale,
    y: ((event.clientY - rect.top) * height / rect.height - (height - loadedPattern.grid.height * scale) / 2) / scale });
  queueViewportRender();
});
pathOverview.addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pathViewport.fit(); queueViewportRender(); }
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
  pathInspection.textContent = "";
  savePathPlannerState();
  renderPathTool();
});

function startAdvancedPathSearch(mode = "normal", batchJob = null, searchOptions = {}) {
  if (!loadedPattern || !selectedDmc || pathAlgorithmRunning) {
    return;
  }

  let worker = null;
  const deep = mode === "deep";
  const adaptive = mode === "adaptive";
  const points = mode === "points";
  const sections = mode === "sections";
  const segments = mode === "segments";
  const chains = mode === "chains";
  const relayOnly = mode === "relay";
  if ((relayOnly || segments || chains) && !bestCompletePathForColor(selectedDmc).length) {
    showAlgorithmFeedback("Ce moteur necessite un chemin complet et valide.");
    return;
  }
  const deepTimed = deep && !batchJob && searchOptions.stopAfterInactivity !== true;
  const inactivityEngine = !deepTimed && !chains && !relayOnly;
  const budget = 3600000;
  try {
    worker = chains ? window.createChainOptimizerWorker?.() : segments ? window.createSegmentOptimizerWorker?.() : relayOnly ? window.createRelayOptimizerWorker?.() : sections ? window.createSectionOptimizerWorker?.() : points ? window.createPointsDiagonalWorker?.() : adaptive ? window.createAdaptivePathOptimizerWorker?.()
      : deep ? window.createDeepPathOptimizerWorker?.() : window.createPathOptimizerWorker?.();
  } catch (error) {
    showAlgorithmFeedback(`Impossible de demarrer le moteur: ${error.message}`);
    return;
  }
  if (!worker) {
    showAlgorithmFeedback("Le calcul en arriere-plan n'est pas disponible dans ce navigateur.");
    return;
  }

  const dmc = selectedDmc;
  beginPathEdit(`Optimisation${chains ? " par reinsertion de chaines" : segments ? " des raccordements" : relayOnly ? " des relais" : sections ? " par retouches locales" : points ? " points puis diagonales" : adaptive ? " adaptative" : deep ? " approfondie" : ""} DMC ${dmc}`, undefined, true);
  if (!batchJob && batchPlan.current?.dmc === dmc) batchPlan.current = null;
  clearPathImprovement();
  optimizerLastRenderedAt = -Infinity;
  delete pathConstructionSummaries[dmc];
  const currentComplete = isCompletePathForColor(loadedPattern, pathsByDmc, dmc)
    && constraintApi.satisfiesConstraints(pathsByDmc[dmc], constraintsByDmc[dmc]);
  if (currentComplete) {
    captureComparison(dmc, pathsByDmc[dmc]);
    if (pathOptimizationBaselinesByDmc[dmc] === undefined) {
      pathOptimizationBaselinesByDmc[dmc] = pathPerformanceMetrics(pathsByDmc[dmc], dmc).score;
    }
    rememberBestPath(dmc, pathsByDmc[dmc]);
  }
  const startingPath = bestCompletePathForColor(dmc);
  captureComparison(dmc, startingPath);
  pathSearchStatsByDmc[dmc] = PathSearchStats.start(pathSearchStatsByDmc[dmc], mode,
    startingPath.length ? pathPerformanceMetrics(startingPath, dmc).score : null);
  scoreChartHover = null;
  if (pathOptimizationBaselinesByDmc[dmc] === undefined && startingPath.length > 1) {
    pathOptimizationBaselinesByDmc[dmc] = pathPerformanceMetrics(startingPath, dmc).score;
  }
  if (startingPath.length && (!currentComplete || comparePathPerformance(startingPath, pathsByDmc[dmc], dmc) < 0)) {
    invalidateBatchResult(dmc);
    pathsByDmc[dmc] = startingPath.map(copyPoint);
    pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
    pathProgress.export = false;
  }

  activePathOptimizerWorker = worker;
  activePathOptimizerRunId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  activePathOptimizerDmc = dmc;
  activeSearchStartedAt = performance.now();
  activePathOptimizerBatchJob = batchJob;
  activePathOptimizerLastSavedAt = 0;
  activePathOptimizerNeedsSave = true;
  activePathOptimizerSnapshot = null;
  activePathOptimizerBestPath = startingPath;
  pathAlgorithmRunning = true;
  savePathPlannerState();
  resetAlgorithmLiveMetrics();
  showAlgorithmFeedback("Preparation de la recherche");
  renderPathTool();

  worker.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.runId !== activePathOptimizerRunId) {
      return;
    }

    if (message.path && !comparisonPaths.has(dmc) && message.stage !== "construction") captureComparison(dmc, message.path);

    if (message.type === "error") {
      flushAdvancedPathSnapshot();
      finishAdvancedPathSearch(`Erreur: ${message.message}`, message, false);
      return;
    }

    if (message.type === "progress") {
      // Timer-only updates must not discard a better path waiting to be rendered.
      pendingOptimizerSnapshot = !message.path && pendingOptimizerSnapshot?.path
        ? { ...message, path: pendingOptimizerSnapshot.path } : message;
      if (optimizerSnapshotFrame === null && optimizerSnapshotTimer === null) {
        const delay = Math.max(0, OPTIMIZER_PREVIEW_INTERVAL_MS - (performance.now() - optimizerLastRenderedAt));
        optimizerSnapshotTimer = setTimeout(() => {
          optimizerSnapshotTimer = null;
          optimizerSnapshotFrame = requestAnimationFrame(flushAdvancedPathSnapshot);
        }, delay);
      }
      return;
    }

    if (message.type === "complete") {
      flushAdvancedPathSnapshot();
      if (worker !== activePathOptimizerWorker) return;
      applyAdvancedPathSnapshot(dmc, message);
      if (worker !== activePathOptimizerWorker) return;
      finishAdvancedPathSearch(relayOnly || chains || inactivityEngine ? message.phase : deep ? "Optimisation approfondie terminee" : "Optimisation des blocs terminee", null, true);
    }
  });

  worker.addEventListener("error", (event) => {
    if (worker !== activePathOptimizerWorker) return;
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
    ...(deepTimed ? { totalLimitMs: budget } : {}),
    ...(inactivityEngine ? { stopAfterInactivity: true } : {}),
    ...(chains ? { untilStable: true } : {}),
    constraints: constraintsByDmc[dmc] || {}
  });
  if (deepTimed) {
    activePathOptimizerDeadlineTimer = setTimeout(() => {
      if (worker !== activePathOptimizerWorker) return;
      flushAdvancedPathSnapshot();
      finishAdvancedPathSearch("Budget termine, meilleur parcours conserve", null, true);
    }, budget + 2000);
  }
}

function clearPendingOptimizerSnapshot() {
  clearTimeout(optimizerSnapshotTimer);
  optimizerSnapshotTimer = null;
  if (optimizerSnapshotFrame !== null) cancelAnimationFrame(optimizerSnapshotFrame);
  optimizerSnapshotFrame = null;
  pendingOptimizerSnapshot = null;
}

function flushAdvancedPathSnapshot() {
  const snapshot = pendingOptimizerSnapshot;
  clearPendingOptimizerSnapshot();
  if (snapshot && activePathOptimizerDmc) {
    optimizerLastRenderedAt = performance.now();
    applyAdvancedPathSnapshot(activePathOptimizerDmc, snapshot);
  }
}

function bestCompletePathForColor(dmc) {
  if (!loadedPattern || !dmc) return [];
  const candidates = [
    Array.isArray(pathsByDmc[dmc]) ? pathsByDmc[dmc] : [],
    Array.isArray(bestPathsByDmc[dmc]) ? bestPathsByDmc[dmc] : []
  ].filter((path) => isCompletePathForColor(loadedPattern, { [dmc]: path }, dmc)
    && constraintApi.satisfiesConstraints(path, constraintsByDmc[dmc]));

  if (candidates.length === 0) {
    return [];
  }

  return candidates.sort((a, b) => comparePathPerformance(a, b, dmc))[0].map(copyPoint);
}

function recoverableBestPath(dmc) {
  if (!loadedPattern || !dmc || !Array.isArray(bestPathsByDmc[dmc]) || !isCompletePathForColor(loadedPattern, bestPathsByDmc, dmc)) return null;
  const path = bestPathsByDmc[dmc];
  const constraints = bestPathConstraintsByDmc[dmc] || (constraintApi.satisfiesConstraints(path, constraintsByDmc[dmc])
    ? constraintsByDmc[dmc] || {} : { forcedCuts: path.filter(p => p.cutBefore).map(copyPoint) });
  if (!constraintApi.satisfiesConstraints(path, constraints)) return null;
  return { path, constraints };
}

function applyAdvancedPathSnapshot(dmc, snapshot) {
  const previousSnapshot = activePathOptimizerSnapshot;
  const baselineChanged = pathOptimizationBaselinesByDmc[dmc] === undefined && Number.isFinite(snapshot.initialMetrics?.score);
  if (baselineChanged) {
    pathOptimizationBaselinesByDmc[dmc] = snapshot.initialMetrics.score;
    activePathOptimizerNeedsSave = true;
  }
  if (PathBatchPlan.matches(batchPlan, activePathOptimizerBatchJob) && Number.isFinite(snapshot.initialMetrics?.score)) {
    for (const key of ["initial", "cycleStartScore", "phaseStartScore"]) {
      if (!Number.isFinite(batchPlan.current[key])) batchPlan.current[key] = snapshot.initialMetrics.score;
    }
  }

  let pathChanged = false;
  if (Array.isArray(snapshot.path) && !StitchModel.validateRoute(snapshot.path, cellsForColor(dmc), false)) {
    const complete = isCompletePathForColor(loadedPattern, { [dmc]: snapshot.path }, dmc);
    const acceptComplete = complete && constraintApi.satisfiesConstraints(snapshot.path, constraintsByDmc[dmc])
      && (!activePathOptimizerBestPath.length || comparePathPerformance(snapshot.path, activePathOptimizerBestPath, dmc) <= 0);
    const acceptPartial = !complete && snapshot.stage === "construction" && !activePathOptimizerBestPath.length;
    const unchanged = snapshot.path.length === (pathsByDmc[dmc]?.length || 0) && snapshot.path.every((point, i) => {
      const current = pathsByDmc[dmc][i];
      return point.x === current.x && point.y === current.y && point.diagonal === current.diagonal
        && point.direction === current.direction && Boolean(point.cutBefore) === Boolean(current.cutBefore);
    });
    if (acceptComplete || acceptPartial) invalidateBatchResult(dmc);
    if ((acceptComplete || acceptPartial) && !unchanged) {
      pathsByDmc[dmc] = snapshot.path.map(copyPoint);
      if (acceptComplete) {
        recordPathImprovement(dmc, activePathOptimizerBestPath.length ? activePathOptimizerBestPath : comparisonPaths.get(dmc)?.path || [],
          pathsByDmc[dmc], snapshot.relayChange);
        activePathOptimizerBestPath = pathsByDmc[dmc];
        rememberBestPath(dmc, activePathOptimizerBestPath);
      }
      pathChanged = true;
      activePathOptimizerNeedsSave = true;
      pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
    }
  }

  // Feedback describes the visible incumbent, including when a preview is rejected.
  activePathOptimizerSnapshot = { ...snapshot,
    initialMetrics: snapshot.initialMetrics || previousSnapshot?.initialMetrics,
    metrics: pathChanged || !previousSnapshot ? pathPerformanceMetrics(pathsByDmc[dmc] || [], dmc) : previousSnapshot.metrics };
  trackSearchScore(activePathOptimizerSnapshot);
  pathProgress.export = false;

  if (pathChanged) {
    renderPathTool();
  }
  if (baselineChanged && !pathChanged) renderPathMetrics();
  if (!pathChanged) renderSearchVisuals();
  const elapsedMs = pathSearchStatsByDmc[dmc]?.active?.elapsedMs || snapshot.elapsedMs || 0;
  // Clock-only updates need a sparse checkpoint, not a full project write on every preview.
  if ((activePathOptimizerNeedsSave || elapsedMs - activePathOptimizerLastSavedAt >= 60000)
      && elapsedMs - activePathOptimizerLastSavedAt >= 3000) {
    activePathOptimizerLastSavedAt = elapsedMs;
    activePathOptimizerNeedsSave = false;
    savePathPlannerState();
  }

  showAdvancedPathFeedback(activePathOptimizerSnapshot);
  renderBatchStatus(activePathOptimizerSnapshot.metrics);
}

function finishAdvancedPathSearch(label, snapshot, completed) {
  clearTimeout(activePathOptimizerDeadlineTimer);
  activePathOptimizerDeadlineTimer = null;
  clearPendingOptimizerSnapshot();
  const finishedDmc = activePathOptimizerDmc;
  const batchJob = activePathOptimizerBatchJob;
  const finalSnapshot = activePathOptimizerSnapshot || snapshot;
  if (completed && (!isCompletePathForColor(loadedPattern, pathsByDmc, finishedDmc)
      || !constraintApi.satisfiesConstraints(pathsByDmc[finishedDmc], constraintsByDmc[finishedDmc]))) {
    completed = false;
    label = "Optimisation interrompue : aucun parcours complet valide";
  }
  const progress = completed ? 100 : finalSnapshot?.progress || 0;
  PathSearchStats.finish(pathSearchStatsByDmc[finishedDmc], Math.max(finalSnapshot?.elapsedMs || 0, performance.now() - activeSearchStartedAt));
  if (activePathOptimizerWorker) {
    activePathOptimizerWorker.terminate();
  }

  activePathOptimizerWorker = null;
  activePathOptimizerRunId = null;
  activePathOptimizerDmc = null;
  activePathOptimizerBatchJob = null;
  activePathOptimizerBestPath = [];
  activePathOptimizerNeedsSave = false;
  pathAlgorithmRunning = false;
  pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
  pathProgress.export = false;
  if (finishedDmc && finalSnapshot) {
    const saved = { ...finalSnapshot, progress, path: undefined, unitLinks: undefined,
      metrics: pathPerformanceMetrics(pathsByDmc[finishedDmc] || [], finishedDmc) };
    pathConstructionSummaries[finishedDmc] = { route: pathsByDmc[finishedDmc], count: pathsByDmc[finishedDmc]?.length || 0,
      label, snapshot: saved };
  }
  if (batchJob && PathBatchPlan.matches(batchPlan, batchJob)) {
    if (completed) {
      const metrics = pathPerformanceMetrics(pathsByDmc[finishedDmc], finishedDmc);
      batchPlan = PathBatchPlan.complete(batchPlan, batchJob, {
        ...metrics, initial: pathOptimizationBaselinesByDmc[finishedDmc],
        stable: ["exhausted", "lower-bound", "locked"].includes(finalSnapshot?.reason)
      });
      batchRunning = batchRunning && Boolean(batchPlan.pending.length);
    } else batchRunning = false;
  }
  finishPathEdit();
  savePathPlannerState();
  renderPathTool();

  showAlgorithmFeedback(label);
  updateAlgorithmLiveMetrics(finalSnapshot);
  activePathOptimizerSnapshot = null;
  if (batchJob && batchRunning) queueMicrotask(runNextBatchColor);
  showPathSavedStatus();
}

function stopAdvancedPathSearch() {
  if (!activePathOptimizerWorker) {
    return;
  }

  activePathOptimizerWorker.terminate();
  flushAdvancedPathSnapshot();
  finishAdvancedPathSearch(activePathOptimizerBestPath.length
    ? "Optimisation arretee, meilleur parcours conserve" : "Construction arretee, parcours partiel conserve", null, false);
}

function optimizerPhaseLabel(snapshot) {
  if (snapshot?.method === "chain-reinsertion") return snapshot.phase || "Reinsertion de chaines";
  if (snapshot?.method === "segment-optimization") return snapshot.phase || "Optimisation des raccordements";
  if (snapshot?.method === "relay-optimization") return snapshot.phase || "Recherche de relais";
  if (snapshot?.method === "point-sections") return snapshot.phase || "Retouches locales";
  if (snapshot?.method === "points-diagonals") return snapshot.phase || "Points puis diagonales";
  if (snapshot?.method === "adaptive-optimization") return snapshot.phase || "Recherche adaptative";
  if (snapshot?.method === "deep-optimization") {
    if (snapshot.stage === "lns") return snapshot.phase || "Reconstruction LNS";
    if (snapshot.stage === "complete") return "Optimisation approfondie terminee";
    if (snapshot.stage === "search") return "Base : optimisation des blocs";
    if (snapshot.stage === "relay") return "Base : recherche de relais";
  }
  if (snapshot?.stage === "relay" && pathAlgorithmRunning) return `Recherche de relais : passe ${snapshot.relayPasses || 1}`;
  return PathVisuals.searchPresentation(snapshot, pathAlgorithmRunning).phase;
}

function showAdvancedPathFeedback(snapshot) {
  showAlgorithmFeedback(optimizerPhaseLabel(snapshot));
  updateAlgorithmLiveMetrics(snapshot);
}

function updateAlgorithmLiveMetrics(snapshot) {
  const view = PathVisuals.searchPresentation(snapshot, pathAlgorithmRunning);
  pathLnsMetrics.classList.toggle("hidden", !["deep-optimization", "adaptive-optimization"].includes(snapshot?.method));
  pathAdaptiveMetrics.classList.toggle("hidden", snapshot?.method !== "adaptive-optimization");
  pathPointsMetrics.classList.toggle("hidden", snapshot?.method !== "points-diagonals");
  pathSectionsMetrics.classList.toggle("hidden", snapshot?.method !== "point-sections");
  pathSegmentsMetrics.classList.toggle("hidden", snapshot?.method !== "segment-optimization");
  pathChainsMetrics.classList.toggle("hidden", snapshot?.method !== "chain-reinsertion");
  pathChainLink.textContent = snapshot?.chainSearch?.total ? `${snapshot.chainSearch.rank} / ${snapshot.chainSearch.total}` : "-";
  pathChainSize.textContent = String(snapshot?.chainSearch?.size || 0);
  pathChainDestinations.textContent = snapshot?.chainSearch?.destinations ? `${snapshot.chainSearch.tested} / ${snapshot.chainSearch.destinations}` : "-";
  pathChainMoves.textContent = String(snapshot?.chainSearch?.moves || 0);
  pathSegmentLink.textContent = snapshot?.segmentSearch?.total ? `${snapshot.segmentSearch.rank} / ${snapshot.segmentSearch.total}` : "-";
  pathSegmentCount.textContent = String(snapshot?.segmentSearch?.segments || 0);
  pathSegmentDiagonals.textContent = String(snapshot?.segmentSearch?.diagonals || 0);
  pathSegmentRepairs.textContent = String(snapshot?.segmentSearch?.repairs || 0);
  pathRelayMetrics.classList.toggle("hidden", snapshot?.method !== "relay-optimization");
  pathRelayPass.textContent = String(snapshot?.relayPasses || 0);
  pathRelayCandidates.textContent = snapshot?.relay?.candidateCount
    ? `${snapshot.relay.candidatesExamined} / ${snapshot.relay.candidateCount}` : "-";
  pathSectionOrders.textContent = String(snapshot?.sectionSearch?.completed || 0);
  pathSectionProgress.textContent = snapshot?.sectionSearch?.linkTotal
    ? `${snapshot.sectionSearch.linkIndex} / ${snapshot.sectionSearch.linkTotal}` : "-";
  pathSectionWindow.textContent = snapshot?.sectionSearch?.windowSize
    ? `${snapshot.sectionSearch.windowSize} diagonales` : "-";
  pathSectionVariants.textContent = String(snapshot?.sectionSearch?.variants || 0);
  pathSectionConnections.textContent = String(snapshot?.sectionSearch?.connections || 0);
  pathPointOrders.textContent = String(snapshot?.pointsSearch?.orders || 0);
  pathPointConversions.textContent = String(snapshot?.pointsSearch?.conversions || 0);
  pathPointTrials.textContent = String(snapshot?.pointsSearch?.diagonalTrials || 0);
  pathPointRepairs.textContent = String(snapshot?.pointsSearch?.refinements || 0);
  pathAdaptiveSeeds.textContent = String(snapshot?.lns?.seeds || 0);
  pathAdaptiveExact.textContent = String(snapshot?.lns?.exactRepairs || 0);
  pathAdaptiveBound.textContent = Number.isFinite(snapshot?.adaptive?.lowerBound) ? formatMetric(snapshot.adaptive.lowerBound) : "-";
  pathAdaptiveGap.textContent = Number.isFinite(snapshot?.adaptive?.gap) ? formatMetric(snapshot.adaptive.gap) : "-";
  pathLnsIterations.textContent = String(snapshot?.lns?.iterations || 0);
  pathLnsSize.textContent = snapshot?.lns?.size ? String(snapshot.lns.size) : "-";
  pathLnsImprovements.textContent = String(snapshot?.lns?.improvements || 0);
  pathLnsDiversifications.textContent = String(snapshot?.lns?.diversifications || 0);
  pathRelayImprovements.textContent = snapshot ? String(snapshot.relayImprovements || 0) : "-";
  const lastRelay = snapshot?.lastRelayImprovement;
  pathLastRelay.classList.toggle("hidden", !lastRelay);
  pathLastRelayPosition.textContent = lastRelay ? `${lastRelay.rank} / ${lastRelay.total}` : "-";
  pathLastRelayLength.textContent = lastRelay ? `${formatMetric(lastRelay.length)} cases avant` : "";
  pathLastRelay.title = lastRelay ? `Passe ${lastRelay.pass}, rang par cout decroissant au moment du gain` : "";
  pathAlgorithmFeedback.classList.toggle("is-running", pathAlgorithmRunning);
  pathAlgorithmProgressArea.classList.toggle("hidden", !view.active);
  pathAlgorithmProgressArea.classList.toggle("stagnation", view.searching);
  pathConstructionMetrics.classList.toggle("hidden", !view.showConstruction);
  pathPreparationCount.classList.toggle("hidden", view.searching || view.timed);
  pathPreparationCount.textContent = view.count;
  pathAlgorithmLastImprovement.classList.toggle("hidden", !view.searching && !view.timed);
  pathAlgorithmClockLabel.textContent = view.label;
  pathAlgorithmProgress.setAttribute("aria-label", view.label);
  pathAlgorithmProgress.max = view.max;
  pathAlgorithmProgress.setAttribute("aria-valuetext", view.count || "Preparation en cours");
  if (view.value === null) pathAlgorithmProgress.removeAttribute("value");
  else pathAlgorithmProgress.value = view.value;
  const zone = snapshot?.stage === "construction" ? snapshot.zone : null;
  pathAlgorithmZone.textContent = zone?.index
    ? `${zone.index} / ${zone.total}${!pathAlgorithmRunning && zone.status === "running" ? " (arretee)" : ""}` : "-";
  pathAlgorithmZonesDone.textContent = snapshot?.blocks ? `${snapshot.blocks.prepared} / ${snapshot.blocks.total}` : "-";
  pathAlgorithmZoneCrosses.textContent = Number.isFinite(zone?.unlockedCrosses) ? formatMetric(zone.unlockedCrosses) : "-";
  if (!snapshot) {
    pathAlgorithmElapsed.textContent = "-";
    pathAlgorithmAttempts.textContent = "-";
    pathAlgorithmRestarts.textContent = "-";
    pathAlgorithmImprovements.textContent = "-";
    pathAlgorithmLastImprovement.textContent = "-";
    return;
  }

  pathAlgorithmElapsed.textContent = formatAlgorithmTime(snapshot.elapsedMs);
  pathAlgorithmAttempts.textContent = String(snapshot.attempts ?? 0);
  pathAlgorithmRestarts.textContent = String(snapshot.restarts ?? 0);
  pathAlgorithmImprovements.textContent = String(snapshot.improvements ?? 0);
  pathAlgorithmLastImprovement.textContent = view.timed
    ? formatAlgorithmTime(Math.max(0, (snapshot.totalLimitMs || 3600000) - (snapshot.elapsedMs || 0)))
    : `${formatAlgorithmTime(snapshot.lastImprovementMs || 0)} / ${formatAlgorithmTime(snapshot.stagnationLimitMs ?? pathStagnationLimitMs, true)}`;
  pathAlgorithmProgress.setAttribute("aria-valuetext", view.timed ? `${pathAlgorithmLastImprovement.textContent} restant`
    : view.searching ? pathAlgorithmLastImprovement.textContent : view.count || "Preparation en cours");
}

function resetAlgorithmLiveMetrics() {
  updateAlgorithmLiveMetrics(null);
}

function formatAlgorithmTime(milliseconds, precise = false) {
  const ticks = Math.max(0, Math.round((Number(milliseconds) || 0) / (precise ? 100 : 1000)));
  const totalSeconds = precise ? Math.floor(ticks / 10) : ticks;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const fraction = precise && ticks % 10 ? `,${ticks % 10}` : "";
  return `${minutes}:${seconds}${fraction}`;
}

function showAlgorithmFeedback(phase) {
  pathAlgorithmFeedback.classList.remove("hidden");
  pathAlgorithmDistance.textContent = phase;
}

optimizedPathButton.addEventListener("click", () => {
  batchRunning = false;
  startAdvancedPathSearch();
});

deepOptimizeButton.addEventListener("click", () => {
  batchRunning = false;
  startAdvancedPathSearch("deep");
});
lnsOptimizeButton.addEventListener("click", () => {
  batchRunning = false;
  startAdvancedPathSearch("deep", null, { stopAfterInactivity: true });
});
adaptiveOptimizeButton.addEventListener("click", () => {
  batchRunning = false;
  startAdvancedPathSearch("adaptive");
});
pointsOptimizeButton.addEventListener("click", () => {
  batchRunning = false;
  startAdvancedPathSearch("points");
});
sectionsOptimizeButton.addEventListener("click", () => {
  batchRunning = false;
  startAdvancedPathSearch("sections");
});
segmentsOptimizeButton.addEventListener("click", () => {
  batchRunning = false;
  startAdvancedPathSearch("segments");
});
chainsOptimizeButton.addEventListener("click", () => {
  batchRunning = false;
  startAdvancedPathSearch("chains");
});
relayOptimizeButton.addEventListener("click", () => {
  batchRunning = false;
  startAdvancedPathSearch("relay");
});

stopPathAlgorithmButton.addEventListener("click", () => {
  stopAdvancedPathSearch();
});

restoreBestPathButton.addEventListener("click", () => {
  if (pathAlgorithmRunning || !selectedDmc) return;
  const saved = recoverableBestPath(selectedDmc);
  if (!saved) return;
  const constraintSignature = value => JSON.stringify({ start: value?.start || null,
    lockedPrefix: value?.lockedPrefix || [], forcedCuts: value?.forcedCuts || [] });
  if (constraintSignature(saved.constraints) !== constraintSignature(constraintsByDmc[selectedDmc])
      && !confirm(`Restaurer le meilleur chemin DMC ${selectedDmc} avec ses contraintes enregistrees ? Les contraintes actuelles seront remplacees.`)) return;
  beginPathEdit(`Restauration DMC ${selectedDmc}`);
  invalidateBatchResult(selectedDmc);
  pathsByDmc[selectedDmc] = saved.path.map(copyPoint);
  constraintsByDmc[selectedDmc] = structuredClone(saved.constraints);
  pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
  pathProgress.export = false;
  finishPathEdit();
  savePathPlannerState();
  renderPathTool();
});

pathStagnationLimit.addEventListener("change", () => {
  pathStagnationLimitMs = normalizePathStagnationLimit(pathStagnationLimit.value) || DEFAULT_PATH_STAGNATION_LIMIT;
  pathStagnationLimit.value = String(pathStagnationLimitMs);
  savePathPlannerState();
  showPathSavedStatus();
});

pathWorkColor.addEventListener("input", () => {
  workColor = PathVisuals.workPalette(pathWorkColor.value).color;
  try { localStorage.setItem(WORK_COLOR_STORAGE_KEY, workColor); } catch { /* Display preferences must not block path editing. */ }
  renderPatternGrid();
});

cutThresholdInput.addEventListener("change", () => {
  if (pathAlgorithmRunning) return;
  beginPathEdit("Distance de coupe", { type: "settings" });
  clearPathImprovement();
  const normalized = normalizeCutThreshold(cutThresholdInput.value) || DEFAULT_CUT_THRESHOLD;
  cutThreshold = normalized;
  pathConstructionSummaries = {};
  pathOptimizationBaselinesByDmc = {};
  batchPlan = { pending: [], results: [] };
  cutThresholdInput.value = String(cutThreshold);
  finishPathEdit();
  savePathPlannerState();
  renderPathTool();
  showPathSavedStatus();
});

undoPathPointButton.addEventListener("click", () => travelPathHistory("undo"));
redoPathActionButton.addEventListener("click", () => travelPathHistory("redo"));
document.addEventListener("keydown", event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.target.closest("input, textarea, select, [contenteditable=true]")) return;
  const key = event.key.toLowerCase();
  if (key !== "z" && key !== "y") return;
  event.preventDefault();
  travelPathHistory(key === "y" || event.shiftKey ? "redo" : "undo");
});

clearPathButton.addEventListener("click", () => {
  if (pathAlgorithmRunning || !selectedDmc || !currentPath().length) return;
  if (!confirm(`Vider le chemin DMC ${selectedDmc} et ses contraintes ? Le meilleur chemin restera disponible et cette action pourra etre annulee.`)) return;
  beginPathEdit(`Vider DMC ${selectedDmc}`);
  rememberBestPath(selectedDmc, currentPath());
  invalidateBatchResult(selectedDmc);
  delete constraintsByDmc[selectedDmc];
  pathsByDmc[selectedDmc] = [];
  pathProgress.paths = false;
  pathProgress.export = false;
  finishPathEdit();
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
  if (pathAlgorithmRunning || !loadedPattern) return;
  if (!confirm("Reinitialiser l'outil 2 et fermer le projet actuel ? Cette action pourra etre annulee. Les fichiers exportes et la progression de l'outil 3 ne seront pas touches.")) return;
  beginPathEdit("Reinitialiser le projet", { type: "project" });
  pathSearchStatsByDmc = {};
  clearPendingOptimizerSnapshot();
  clearPathImprovement();
  if (activePathOptimizerWorker) {
    activePathOptimizerWorker.terminate();
    activePathOptimizerWorker = null;
    activePathOptimizerRunId = null;
    activePathOptimizerDmc = null;
    activePathOptimizerSnapshot = null;
    activePathOptimizerBestPath = [];
    pathAlgorithmRunning = false;
  }
  loadedPattern = null;
  selectedDmc = null;
  pathsByDmc = {};
  bestPathsByDmc = {};
  bestPathConstraintsByDmc = {};
  pathConstructionSummaries = {};
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
  finishPathEdit();
  savePathPlannerState();
  renderPathTool();
});

renderPathTool();
async function restorePlannerDraft() {
  document.querySelector("main").inert = true;
  try {
    const savedState = await window.PathPlannerStore.read();
    const state = migratePlannerState(savedState);
    if (state) {
      if (state.pattern && !validateFinalPattern(state.pattern).valid) throw new Error("Brouillon de chemins invalide.");
      applyPlannerDraft(state);
      pathEditHistory = createPathEditHistory(state.editHistory);
      const interrupted = Boolean(pathEditHistory.pending);
      pathEditHistory.recover(capturePathEdit);
      pathProgress = { load: Boolean(loadedPattern), paths: Boolean(loadedPattern) && areAllColorPathsComplete(loadedPattern, pathsByDmc), export: false };
      if (state !== savedState || interrupted) await savePathPlannerState();
    } else if (loadedPattern) savePathPlannerState();
  } catch (error) { pathSaveStatus.textContent = error.message; }
  finally { document.querySelector("main").inert = false; renderPathTool(); }
}
window.addEventListener("beforeunload", event => {
  if (plannerSavePending || plannerSaveFailed) { event.preventDefault(); event.returnValue = ""; }
});
restorePlannerDraft();
