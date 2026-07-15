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
const stitchCanvas = document.querySelector("#stitchCanvas");
const stitchColorLegend = document.querySelector("#stitchColorLegend");
const stitchColorStatus = document.querySelector("#stitchColorStatus");
const undoStitchButton = document.querySelector("#undoStitchButton");
const resetColorProgressButton = document.querySelector("#resetColorProgressButton");
const nextStitchButton = document.querySelector("#nextStitchButton");
const downloadProgressSaveButton = document.querySelector("#downloadProgressSaveButton");
const writeBuiltinProgressButton = document.querySelector("#writeBuiltinProgressButton");
const writeBuiltinProgressStatus = document.querySelector("#writeBuiltinProgressStatus");
const completedColorList = document.querySelector("#completedColorList");
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
const builtinProgressSave = window.BUILTIN_STITCH_PROGRESS || null;
const MAX_RESPONSIVE_CELL_SIZE = 18;
const GRID_RULER_SIZE = 26;
const REALISTIC_JUMP_THRESHOLD = 15;
const BUILTIN_PROGRESS_DIRECTORY_DB = "cross-stitch-utils-directory";
const BUILTIN_PROGRESS_DIRECTORY_STORE = "handles";
const BUILTIN_PROGRESS_DIRECTORY_KEY = "project-root";

let storedProgressState = loadStoredProgressState();
let loadedPaths = storedProgressState.pathsFile;
let stitchedByDmc = storedProgressState.stitchedByDmc;
let selectedDmc = storedProgressState.selectedDmc || loadedPaths?.paths[0]?.dmc || null;
let stitchProgress = {
  load: Boolean(loadedPaths),
  stitch: Boolean(loadedPaths) && areAllColorsStitched(loadedPaths, storedProgressState.stitchedByDmc)
};
let activeProgressStep = "load";

function loadStoredProgressState() {
  const stored = localStorage.getItem(STITCH_PROGRESS_STORAGE_KEY);
  if (!stored) {
    return { pathsFile: null, stitchedByDmc: {}, selectedDmc: null };
  }

  try {
    const parsed = JSON.parse(stored);
    if (validatePathsFile(parsed).valid) {
      return { pathsFile: parsed, stitchedByDmc: {}, selectedDmc: null };
    }

    if (validateProgressSave(parsed).valid) {
      return {
        pathsFile: parsed.pathsFile,
        stitchedByDmc: normalizeStitchedState(parsed.pathsFile, parsed.stitchedByDmc),
        selectedDmc: typeof parsed.selectedDmc === "string" ? parsed.selectedDmc : null
      };
    }

    if (validatePathsFile(parsed.pathsFile).valid) {
      return {
        pathsFile: parsed.pathsFile,
        stitchedByDmc: normalizeStitchedState(parsed.pathsFile, parsed.stitchedByDmc),
        selectedDmc: typeof parsed.selectedDmc === "string" ? parsed.selectedDmc : null
      };
    }

    return { pathsFile: null, stitchedByDmc: {}, selectedDmc: null };
  } catch {
    return { pathsFile: null, stitchedByDmc: {}, selectedDmc: null };
  }
}

function saveProgressState() {
  if (!loadedPaths) {
    localStorage.removeItem(STITCH_PROGRESS_STORAGE_KEY);
    return;
  }

  localStorage.setItem(STITCH_PROGRESS_STORAGE_KEY, JSON.stringify({
    pathsFile: loadedPaths,
    stitchedByDmc,
    selectedDmc
  }));
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

  renderLoadedPaths();
  renderBuiltinProgressControls();
  renderStitchView();
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

function renderBuiltinProgressControls() {
  const validation = validateProgressSave(builtinProgressSave);
  loadBuiltinProgressButton.disabled = !validation.valid;

  if (validation.valid) {
    const projectName = builtinProgressSave.pathsFile.project.name;
    builtinProgressStatus.textContent = `Sauvegarde integree disponible: ${projectName}.`;
    return;
  }

  builtinProgressStatus.textContent = "Aucune sauvegarde integree dans le repo.";
}

function renderStitchView() {
  const context = stitchCanvas.getContext("2d");

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
    selectedDmc = loadedPaths.paths[0]?.dmc || null;
  }

  const pattern = loadedPaths.pattern;
  const colorByDmc = new Map(pattern.colors.map((color) => [color.dmc, color]));
  const cellSize = gridCellSize(
    pattern.grid.width,
    pattern.grid.height,
    availableGridWidth(stitchCanvas) - GRID_RULER_SIZE
  );
  const selectedColor = colorByDmc.get(selectedDmc);
  stitchColorLabel.textContent = selectedColor
    ? `DMC ${selectedColor.dmc} - ${selectedColor.symbol || ""}`
    : "Aucune couleur selectionnee";

  stitchCanvas.width = GRID_RULER_SIZE + pattern.grid.width * cellSize;
  stitchCanvas.height = GRID_RULER_SIZE + pattern.grid.height * cellSize;
  context.clearRect(0, 0, stitchCanvas.width, stitchCanvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, stitchCanvas.width, stitchCanvas.height);

  pattern.grid.cells.forEach((cell) => {
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
    drawGridLines(context, pattern.grid.width, pattern.grid.height, cellSize);
  }

  drawGridRulers(context, pattern.grid.width, pattern.grid.height, cellSize);
  drawStitchProgress(context, cellSize);
  renderStitchColorLegend();
  renderCompletedColorList();
  renderStitchControls();
  stitchStatus.className = "coverage-status valid";
  stitchStatus.textContent = `Appuie sur Espace pour avancer dans DMC ${selectedDmc}.`;
}

function drawStitchProgress(context, cellSize) {
  const path = pathForDmc(selectedDmc);
  if (!path) {
    return;
  }

  const stitchedCount = stitchedCountForDmc(selectedDmc);
  const stitchedPoints = path.points.slice(0, stitchedCount);
  const currentPoint = path.points[stitchedCount] || null;

  context.save();
  context.strokeStyle = "#222426";
  context.lineWidth = Math.max(2, Math.floor(cellSize / 3));
  context.lineJoin = "round";
  context.lineCap = "round";

  drawOtherStitchedPoints(context, cellSize);

  if (path.points.length > 1) {
    path.points.forEach((point, index) => {
      if (index === 0) {
        return;
      }

      const segmentAlpha = index > stitchedCount ? 0.32 : 1;
      drawPathSegment(context, path.points[index - 1], point, cellSize, segmentAlpha);
    });
  }

  path.points.forEach((point, index) => {
    if (index >= stitchedCount) {
      drawCircle(context, point, cellSize, "#ffffff", "#222426", 0.32);
    }
  });

  stitchedPoints.forEach((point) => {
    drawCircle(context, point, cellSize, "#222426", "#222426");
  });

  if (currentPoint) {
    drawCircle(context, currentPoint, cellSize, "#ffffff", "#b44b57");
  }

  context.restore();
}

function drawPathSegment(context, fromPoint, toPoint, cellSize, alpha = 1) {
  const from = pointCenter(fromPoint, cellSize);
  const to = pointCenter(toPoint, cellSize);
  const isCut = isCutJump(fromPoint, toPoint);

  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = isCut ? "#b44b57" : "#222426";
  context.lineWidth = isCut ? Math.max(1, Math.floor(cellSize / 5)) : Math.max(2, Math.floor(cellSize / 3));
  context.setLineDash(isCut ? [Math.max(3, cellSize * 0.55), Math.max(3, cellSize * 0.45)] : []);
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.setLineDash([]);
  context.restore();
}

function pointCenter(point, cellSize) {
  return {
    x: GRID_RULER_SIZE + (point.x + 0.5) * cellSize,
    y: GRID_RULER_SIZE + (point.y + 0.5) * cellSize
  };
}

function isCutJump(fromPoint, toPoint) {
  return threadDistance(fromPoint, toPoint) > REALISTIC_JUMP_THRESHOLD;
}

function threadDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function drawOtherStitchedPoints(context, cellSize) {
  loadedPaths.paths.forEach((path) => {
    if (path.dmc === selectedDmc) {
      return;
    }

    const stitchedPoints = path.points.slice(0, stitchedCountForDmc(path.dmc));
    stitchedPoints.forEach((point) => {
      drawCircle(context, point, cellSize, "#222426", "#222426");
    });
  });
}

function drawCircle(context, point, cellSize, fill, stroke, alpha = 1) {
  const centerX = GRID_RULER_SIZE + (point.x + 0.5) * cellSize;
  const centerY = GRID_RULER_SIZE + (point.y + 0.5) * cellSize;
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

function renderStitchColorLegend() {
  stitchColorLegend.innerHTML = "";
  const activePaths = loadedPaths.paths.filter((path) => stitchedCountForDmc(path.dmc) < path.points.length);

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
  const completedPaths = loadedPaths.paths.filter((path) => stitchedCountForDmc(path.dmc) === path.points.length);
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
    ? `Couleur terminee: ${stitched} / ${path.points.length} points.`
    : `Progression: ${stitched} / ${path.points.length} points.`;
  undoStitchButton.disabled = stitched === 0;
  resetColorProgressButton.disabled = stitched === 0;
  nextStitchButton.disabled = complete;
  downloadProgressSaveButton.disabled = false;
  writeBuiltinProgressButton.disabled = false;
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

  return parsed;
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
  loadedPaths = progressSave.pathsFile;
  stitchedByDmc = normalizeStitchedState(loadedPaths, progressSave.stitchedByDmc);
  selectedDmc = pathForDmc(progressSave.selectedDmc)
    ? progressSave.selectedDmc
    : loadedPaths.paths[0]?.dmc || null;
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
  if (!data || data.kind !== "cross-stitch-paths" || data.schemaVersion !== 1) {
    return { valid: false, message: "Ce fichier n'est pas un export de chemins de l'outil 2." };
  }

  if (!data.project || typeof data.project.name !== "string" || data.project.name.trim().length === 0) {
    return { valid: false, message: "Nom de projet manquant." };
  }

  const patternValidation = validatePattern(data.pattern);
  if (!patternValidation.valid) {
    return patternValidation;
  }

  if (!Array.isArray(data.paths) || data.paths.length !== data.pattern.colors.length) {
    return { valid: false, message: "La liste des chemins ne correspond pas aux couleurs." };
  }

  const colorCodes = new Set(data.pattern.colors.map((color) => color.dmc));
  for (const path of data.paths) {
    if (!colorCodes.has(path.dmc) || !Array.isArray(path.points)) {
      return { valid: false, message: "Un chemin utilise une couleur invalide." };
    }

    const expectedKeys = new Set(
      data.pattern.grid.cells
        .filter((cell) => !cell.empty && cell.dmc === path.dmc)
        .map(cellKey)
    );
    const pointKeys = new Set(path.points.map(cellKey));
    if (expectedKeys.size !== path.points.length || pointKeys.size !== path.points.length) {
      return { valid: false, message: "Un chemin ne couvre pas exactement sa couleur." };
    }

    const everyPointMatches = path.points.every((point) => expectedKeys.has(cellKey(point)));
    if (!everyPointMatches) {
      return { valid: false, message: "Un chemin contient une case hors couleur." };
    }
  }

  return { valid: true, message: "" };
}

function validateProgressSave(data) {
  if (!data || data.kind !== "cross-stitch-progress-save" || data.schemaVersion !== 1) {
    return { valid: false, message: "Ce fichier n'est pas une sauvegarde de progression." };
  }

  const pathsValidation = validatePathsFile(data.pathsFile);
  if (!pathsValidation.valid) {
    return pathsValidation;
  }

  if (!data.stitchedByDmc || typeof data.stitchedByDmc !== "object" || Array.isArray(data.stitchedByDmc)) {
    return { valid: false, message: "Progression manquante dans la sauvegarde." };
  }

  const pathByDmc = new Map(data.pathsFile.paths.map((path) => [path.dmc, path]));
  const everyCountValid = Object.entries(data.stitchedByDmc).every(([dmc, count]) => (
    pathByDmc.has(dmc) && Number.isInteger(count) && count >= 0 && count <= pathByDmc.get(dmc).points.length
  ));
  if (!everyCountValid) {
    return { valid: false, message: "La sauvegarde contient une progression invalide." };
  }

  return { valid: true, message: "" };
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
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    pathsFile: loadedPaths,
    stitchedByDmc: normalizeStitchedState(loadedPaths, stitchedByDmc),
    selectedDmc
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

function buildBuiltinProgressFile() {
  return `window.BUILTIN_STITCH_PROGRESS = ${JSON.stringify(buildProgressSave(), null, 2)};\n`;
}

function downloadText(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function writeBuiltinProgressFile(content) {
  if (window.showDirectoryPicker && window.indexedDB) {
    const wroteToProject = await writeBuiltinProgressToProjectDirectory(content);
    if (wroteToProject) {
      writeBuiltinProgressStatus.textContent = "data/builtin-progress.js mis a jour. Il reste a commit le fichier.";
      return;
    }
  }

  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: "builtin-progress.js",
      types: [{
        description: "JavaScript",
        accept: { "text/javascript": [".js"] }
      }]
    });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    writeBuiltinProgressStatus.textContent = "Fichier sauvegarde. Il reste a commit data/builtin-progress.js.";
    return;
  }

  downloadText(content, "builtin-progress.js", "text/javascript");
  writeBuiltinProgressStatus.textContent = "Fichier telecharge. Remplace data/builtin-progress.js puis commit le fichier.";
}

async function writeBuiltinProgressToProjectDirectory(content) {
  const rootHandle = await getProjectDirectoryHandle();
  if (!rootHandle) {
    return false;
  }

  try {
    const dataHandle = await rootHandle.getDirectoryHandle("data");
    const fileHandle = await dataHandle.getFileHandle("builtin-progress.js", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  } catch {
    await clearProjectDirectoryHandle();
    writeBuiltinProgressStatus.textContent = "Dossier invalide. Selectionne le dossier racine Cross Stitch Utils.";
    return false;
  }
}

async function getProjectDirectoryHandle() {
  const storedHandle = await readProjectDirectoryHandle();
  if (storedHandle && await requestDirectoryPermission(storedHandle)) {
    return storedHandle;
  }

  const selectedHandle = await window.showDirectoryPicker({
    id: "cross-stitch-utils-root",
    mode: "readwrite"
  });

  if (!await requestDirectoryPermission(selectedHandle)) {
    return null;
  }

  await saveProjectDirectoryHandle(selectedHandle);
  return selectedHandle;
}

async function requestDirectoryPermission(handle) {
  const options = { mode: "readwrite" };
  if (await handle.queryPermission(options) === "granted") {
    return true;
  }

  return await handle.requestPermission(options) === "granted";
}

function openProjectDirectoryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BUILTIN_PROGRESS_DIRECTORY_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(BUILTIN_PROGRESS_DIRECTORY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readProjectDirectoryHandle() {
  try {
    const db = await openProjectDirectoryDb();
    return await directoryDbRequest(db, "readonly", (store) => store.get(BUILTIN_PROGRESS_DIRECTORY_KEY));
  } catch {
    return null;
  }
}

async function saveProjectDirectoryHandle(handle) {
  const db = await openProjectDirectoryDb();
  await directoryDbRequest(db, "readwrite", (store) => store.put(handle, BUILTIN_PROGRESS_DIRECTORY_KEY));
}

async function clearProjectDirectoryHandle() {
  try {
    const db = await openProjectDirectoryDb();
    await directoryDbRequest(db, "readwrite", (store) => store.delete(BUILTIN_PROGRESS_DIRECTORY_KEY));
  } catch {
    // Nothing to clear.
  }
}

function directoryDbRequest(db, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(BUILTIN_PROGRESS_DIRECTORY_STORE, mode);
    const request = operation(transaction.objectStore(BUILTIN_PROGRESS_DIRECTORY_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
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
    stitchedByDmc = {};
    selectedDmc = loadedPaths.paths[0]?.dmc || null;
    progressSaveFileInput.value = "";
    stitchProgress.load = true;
    stitchProgress.stitch = false;
    progressLoadError.hidden = true;
    saveProgressState();
    goToProgressStep("stitch");
    showProgressSavedStatus();
  } catch (error) {
    loadedPaths = null;
    stitchedByDmc = {};
    selectedDmc = null;
    stitchProgress.load = false;
    stitchProgress.stitch = false;
    localStorage.removeItem(STITCH_PROGRESS_STORAGE_KEY);
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
    loadedPaths = null;
    stitchedByDmc = {};
    selectedDmc = null;
    stitchProgress.load = false;
    stitchProgress.stitch = false;
    localStorage.removeItem(STITCH_PROGRESS_STORAGE_KEY);
    progressLoadError.textContent = error.message;
    progressLoadError.hidden = false;
    renderProgressTool();
  }
});

loadBuiltinProgressButton.addEventListener("click", () => {
  const validation = validateProgressSave(builtinProgressSave);
  if (!validation.valid) {
    progressLoadError.textContent = validation.message;
    progressLoadError.hidden = false;
    return;
  }

  applyProgressSave(builtinProgressSave);
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
  if (!loadedPaths) {
    return;
  }

  try {
    await writeBuiltinProgressFile(buildBuiltinProgressFile());
  } catch (error) {
    if (error.name === "AbortError") {
      writeBuiltinProgressStatus.textContent = "Sauvegarde integree annulee.";
      return;
    }

    downloadText(buildBuiltinProgressFile(), "builtin-progress.js", "text/javascript");
    writeBuiltinProgressStatus.textContent = "Ecriture directe impossible. Fichier telecharge a la place.";
  }
});

undoStitchButton.addEventListener("click", () => {
  if (!loadedPaths || !selectedDmc) {
    return;
  }

  stitchedByDmc[selectedDmc] = Math.max(stitchedCountForDmc(selectedDmc) - 1, 0);
  stitchProgress.stitch = areAllColorsStitched(loadedPaths, stitchedByDmc);
  saveProgressState();
  renderProgressTool();
});

resetColorProgressButton.addEventListener("click", () => {
  if (!selectedDmc) {
    return;
  }

  stitchedByDmc[selectedDmc] = 0;
  stitchProgress.stitch = false;
  saveProgressState();
  renderProgressTool();
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isTypingTarget = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  if (isTypingTarget || activeProgressStep !== "stitch" || event.code !== "Space") {
    return;
  }

  event.preventDefault();
  advanceSelectedColor();
});

function advanceSelectedColor() {
  const path = pathForDmc(selectedDmc);
  if (!loadedPaths || !path) {
    return;
  }

  const stitched = stitchedCountForDmc(selectedDmc);
  if (stitched >= path.points.length) {
    return;
  }

  stitchedByDmc[selectedDmc] = stitched + 1;
  stitchProgress.stitch = areAllColorsStitched(loadedPaths, stitchedByDmc);
  saveProgressState();
  renderProgressTool();
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
  loadedPaths = null;
  selectedDmc = null;
  stitchedByDmc = {};
  stitchProgress = {
    load: false,
    stitch: false
  };
  pathsJsonFileInput.value = "";
  progressSaveFileInput.value = "";
  progressLoadError.hidden = true;
  localStorage.removeItem(STITCH_PROGRESS_STORAGE_KEY);
  renderProgressTool();
});

renderProgressTool();
