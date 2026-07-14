const PATH_PLANNER_STORAGE_KEY = "cross-stitch-path-planner";

const patternJsonFileInput = document.querySelector("#patternJsonFile");
const loadStatus = document.querySelector("#loadStatus");
const loadedProjectText = document.querySelector("#loadedProjectText");
const loadedDimensionsText = document.querySelector("#loadedDimensionsText");
const loadedColorsText = document.querySelector("#loadedColorsText");
const loadError = document.querySelector("#loadError");
const loadedJsonPreview = document.querySelector("#loadedJsonPreview");
const pathSaveStatus = document.querySelector("#pathSaveStatus");
const resetPathToolButton = document.querySelector("#resetPathToolButton");
const pathGridStatus = document.querySelector("#pathGridStatus");
const selectedColorLabel = document.querySelector("#selectedColorLabel");
const patternCanvas = document.querySelector("#patternCanvas");
const pathColorLegend = document.querySelector("#pathColorLegend");
const pathBuildStatus = document.querySelector("#pathBuildStatus");
const autoPathButton = document.querySelector("#autoPathButton");
const undoPathPointButton = document.querySelector("#undoPathPointButton");
const clearPathButton = document.querySelector("#clearPathButton");
const savePathAndNextButton = document.querySelector("#savePathAndNextButton");
const pathExportStatus = document.querySelector("#pathExportStatus");
const pathExportColorsText = document.querySelector("#pathExportColorsText");
const pathExportPathsText = document.querySelector("#pathExportPathsText");
const pathExportPointsText = document.querySelector("#pathExportPointsText");
const backToPathsButton = document.querySelector("#backToPathsButton");
const downloadPathJsonButton = document.querySelector("#downloadPathJsonButton");
const pathExportPreview = document.querySelector("#pathExportPreview");
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

let storedState = loadStoredState();
let loadedPattern = storedState.pattern;
let pathsByDmc = storedState.pathsByDmc;
let pathProgress = {
  load: Boolean(loadedPattern),
  paths: Boolean(loadedPattern) && areAllColorPathsComplete(loadedPattern, storedState.pathsByDmc),
  export: false
};
let activePathStep = "load";
let selectedDmc = storedState.selectedDmc || loadedPattern?.colors[0]?.dmc || null;

function loadStoredState() {
  const stored = localStorage.getItem(PATH_PLANNER_STORAGE_KEY);
  if (!stored) {
    return { pattern: null, pathsByDmc: {} };
  }

  try {
    const parsed = JSON.parse(stored);
    if (validateFinalPattern(parsed).valid) {
      return { pattern: parsed, pathsByDmc: {} };
    }

    if (validateFinalPattern(parsed.pattern).valid) {
      return {
        pattern: parsed.pattern,
        pathsByDmc: parsed.pathsByDmc && typeof parsed.pathsByDmc === "object" ? parsed.pathsByDmc : {},
        selectedDmc: typeof parsed.selectedDmc === "string" ? parsed.selectedDmc : null
      };
    }

    return { pattern: null, pathsByDmc: {} };
  } catch {
    return { pattern: null, pathsByDmc: {} };
  }
}

function savePathPlannerState() {
  if (!loadedPattern) {
    localStorage.removeItem(PATH_PLANNER_STORAGE_KEY);
    return;
  }

  localStorage.setItem(PATH_PLANNER_STORAGE_KEY, JSON.stringify({
    pattern: loadedPattern,
    pathsByDmc,
    selectedDmc
  }));
}

function renderPathTool() {
  if (!canOpenPathStep(activePathStep)) {
    activePathStep = firstOpenPathStep();
  }

  const label = pathStepLabels[activePathStep];
  pathStepEyebrow.textContent = label.eyebrow;
  pathStepTitle.textContent = label.title;

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

  renderLoadedPattern();
  renderPatternGrid();
  renderPathExport();
}

function renderLoadedPattern() {
  if (!loadedPattern) {
    loadStatus.className = "coverage-status invalid";
    loadStatus.textContent = "Aucun fichier charge.";
    loadedProjectText.textContent = "-";
    loadedDimensionsText.textContent = "0 x 0";
    loadedColorsText.textContent = "0";
    loadedJsonPreview.textContent = "";
    return;
  }

  loadStatus.className = "coverage-status valid";
  loadStatus.textContent = "Pattern charge et format valide.";
  loadedProjectText.textContent = loadedPattern.project.name;
  loadedDimensionsText.textContent = `${loadedPattern.grid.width} x ${loadedPattern.grid.height}`;
  loadedColorsText.textContent = String(loadedPattern.colors.length);
  loadedJsonPreview.textContent = JSON.stringify(loadedPattern, null, 2);
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

  const cellSize = gridCellSize(loadedPattern.grid.width, loadedPattern.grid.height);
  const selectedColor = colorByDmc.get(selectedDmc);
  selectedColorLabel.textContent = selectedColor
    ? `DMC ${selectedColor.dmc} - ${selectedColor.symbol || ""}`
    : "Aucune couleur selectionnee";
  patternCanvas.width = loadedPattern.grid.width * cellSize;
  patternCanvas.height = loadedPattern.grid.height * cellSize;
  context.clearRect(0, 0, patternCanvas.width, patternCanvas.height);

  loadedPattern.grid.cells.forEach((cell) => {
    const color = colorByDmc.get(cell.dmc);
    if (cell.empty) {
      context.fillStyle = "#ffffff";
    } else if (cell.dmc === selectedDmc) {
      context.fillStyle = color?.hex || "#d9dddd";
    } else {
      context.fillStyle = mutedHex(color?.hex || "#d9dddd");
    }

    context.fillRect(cell.x * cellSize, cell.y * cellSize, cellSize, cellSize);
  });

  if (cellSize >= 6) {
    drawGridLines(context, loadedPattern.grid.width, loadedPattern.grid.height, cellSize);
  }

  drawSelectedPath(context, cellSize);

  renderPathColorLegend();
  renderPathBuilder();
  pathGridStatus.className = "coverage-status valid";
  pathGridStatus.textContent = `Couleur selectionnee: DMC ${selectedDmc}.`;
}

function drawSelectedPath(context, cellSize) {
  const path = currentPath();
  if (path.length === 0) {
    return;
  }

  context.save();
  context.strokeStyle = "#222426";
  context.lineWidth = Math.max(2, Math.floor(cellSize / 3));
  context.lineJoin = "round";
  context.lineCap = "round";

  if (path.length > 1) {
    context.beginPath();
    path.forEach((point, index) => {
      const centerX = (point.x + 0.5) * cellSize;
      const centerY = (point.y + 0.5) * cellSize;
      if (index === 0) {
        context.moveTo(centerX, centerY);
      } else {
        context.lineTo(centerX, centerY);
      }
    });
    context.stroke();
  }

  path.forEach((point, index) => {
    const centerX = (point.x + 0.5) * cellSize;
    const centerY = (point.y + 0.5) * cellSize;
    const radius = Math.max(3, Math.floor(cellSize * 0.38));
    context.fillStyle = index === path.length - 1 ? "#ffffff" : "#222426";
    context.strokeStyle = "#222426";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });

  context.restore();
}

function renderPathBuilder() {
  if (!loadedPattern || !selectedDmc) {
    pathBuildStatus.className = "coverage-status invalid";
    pathBuildStatus.textContent = "Selectionne une couleur pour construire son chemin.";
    autoPathButton.disabled = true;
    undoPathPointButton.disabled = true;
    clearPathButton.disabled = true;
    savePathAndNextButton.disabled = true;
    return;
  }

  const path = currentPath();
  const expected = cellsForSelectedColor().length;
  const complete = isPathComplete(selectedDmc);
  pathBuildStatus.className = `coverage-status ${complete ? "valid" : "invalid"}`;
  pathBuildStatus.textContent = complete
    ? `Chemin complet: ${path.length} / ${expected} cases.`
    : `Chemin en cours: ${path.length} / ${expected} cases.`;
  autoPathButton.disabled = expected === 0;
  undoPathPointButton.disabled = path.length === 0;
  clearPathButton.disabled = path.length === 0;
  savePathAndNextButton.disabled = !complete;
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
  pathExportPreview.textContent = exportData ? JSON.stringify(exportData, null, 2) : "";
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

function gridCellSize(width, height) {
  const largestSide = Math.max(width, height);
  if (largestSide <= 80) {
    return 10;
  }

  if (largestSide <= 160) {
    return 6;
  }

  return 4;
}

function drawGridLines(context, width, height, cellSize) {
  context.strokeStyle = "rgba(34, 36, 38, 0.18)";
  context.lineWidth = 1;

  for (let x = 0; x <= width; x += 1) {
    context.beginPath();
    context.moveTo(x * cellSize + 0.5, 0);
    context.lineTo(x * cellSize + 0.5, height * cellSize);
    context.stroke();
  }

  for (let y = 0; y <= height; y += 1) {
    context.beginPath();
    context.moveTo(0, y * cellSize + 0.5);
    context.lineTo(width * cellSize, y * cellSize + 0.5);
    context.stroke();
  }
}

function renderPathColorLegend() {
  pathColorLegend.innerHTML = "";

  loadedPattern.colors.forEach((color) => {
    const path = pathsByDmc[color.dmc] || [];
    const expected = cellsForColor(color.dmc).length;
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

function automaticPathForColor(dmc) {
  const rows = new Map();
  cellsForColor(dmc).forEach((cell) => {
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

function cellKey(point) {
  return `${point.x},${point.y}`;
}

function findCellAt(x, y) {
  if (!loadedPattern) {
    return null;
  }

  return loadedPattern.grid.cells.find((cell) => cell.x === x && cell.y === y) || null;
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
  if (!pattern || !dmc) {
    return false;
  }

  const expectedKeys = new Set(
    pattern.grid.cells
      .filter((cell) => !cell.empty && cell.dmc === dmc)
      .map(cellKey)
  );
  const path = Array.isArray(paths[dmc]) ? paths[dmc] : [];
  const pathKeys = new Set(path.map(cellKey));

  if (expectedKeys.size === 0 || path.length !== expectedKeys.size || pathKeys.size !== path.length) {
    return false;
  }

  return path.every((point) => expectedKeys.has(cellKey(point)));
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
    schemaVersion: 1,
    kind: "cross-stitch-paths",
    project: {
      name: loadedPattern.project.name
    },
    pattern: loadedPattern,
    paths: loadedPattern.colors.map((color) => ({
      dmc: color.dmc,
      symbol: color.symbol || null,
      points: (pathsByDmc[color.dmc] || []).map((point, index) => ({
        order: index + 1,
        x: point.x,
        y: point.y
      }))
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

async function readSelectedPattern(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const validation = validateFinalPattern(parsed);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  return parsed;
}

function validateFinalPattern(pattern) {
  if (!pattern || pattern.kind !== "cross-stitch-pattern" || pattern.schemaVersion !== 1) {
    return { valid: false, message: "Ce fichier n'est pas un pattern exporte par l'outil 1." };
  }

  if (!pattern.project || typeof pattern.project.name !== "string" || pattern.project.name.trim().length === 0) {
    return { valid: false, message: "Nom de projet manquant." };
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

  const colorCodes = new Set(pattern.colors.map((color) => color.dmc));
  for (const cell of pattern.grid.cells) {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
      return { valid: false, message: "Une cellule a des coordonnees invalides." };
    }

    if (cell.empty === true) {
      continue;
    }

    if (!colorCodes.has(cell.dmc)) {
      return { valid: false, message: "Une cellule utilise une couleur absente de la palette." };
    }
  }

  return { valid: true, message: "" };
}

function showPathSavedStatus() {
  pathSaveStatus.textContent = "Enregistre";
  window.setTimeout(() => {
    pathSaveStatus.textContent = "Brouillon";
  }, 1400);
}

patternJsonFileInput.addEventListener("change", async () => {
  const file = patternJsonFileInput.files[0];
  if (!file) {
    return;
  }

  try {
    loadedPattern = await readSelectedPattern(file);
    pathsByDmc = {};
    selectedDmc = loadedPattern.colors[0]?.dmc || null;
    pathProgress.load = true;
    pathProgress.paths = false;
    pathProgress.export = false;
    loadError.hidden = true;
    savePathPlannerState();
    goToPathStep("paths");
    showPathSavedStatus();
  } catch (error) {
    loadedPattern = null;
    selectedDmc = null;
    pathsByDmc = {};
    pathProgress.load = false;
    pathProgress.paths = false;
    pathProgress.export = false;
    localStorage.removeItem(PATH_PLANNER_STORAGE_KEY);
    loadError.textContent = error.message;
    loadError.hidden = false;
    renderPathTool();
  }
});

patternCanvas.addEventListener("click", (event) => {
  if (!loadedPattern || !selectedDmc) {
    return;
  }

  const cellSize = gridCellSize(loadedPattern.grid.width, loadedPattern.grid.height);
  const rect = patternCanvas.getBoundingClientRect();
  const scaleX = patternCanvas.width / rect.width;
  const scaleY = patternCanvas.height / rect.height;
  const x = Math.floor(((event.clientX - rect.left) * scaleX) / cellSize);
  const y = Math.floor(((event.clientY - rect.top) * scaleY) / cellSize);
  const cell = findCellAt(x, y);

  if (!cell || cell.empty || cell.dmc !== selectedDmc) {
    return;
  }

  const path = currentPath();
  const key = cellKey(cell);
  const alreadySelected = path.some((point) => cellKey(point) === key);
  if (alreadySelected) {
    return;
  }

  path.push({ x: cell.x, y: cell.y });
  pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
  pathProgress.export = false;
  savePathPlannerState();
  renderPathTool();
  showPathSavedStatus();
});

pathColorLegend.addEventListener("click", (event) => {
  const button = event.target.closest("[data-dmc]");
  if (!button) {
    return;
  }

  selectedDmc = button.dataset.dmc;
  savePathPlannerState();
  renderPathTool();
});

autoPathButton.addEventListener("click", () => {
  if (!loadedPattern || !selectedDmc) {
    return;
  }

  pathsByDmc[selectedDmc] = automaticPathForColor(selectedDmc);
  pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
  pathProgress.export = false;
  savePathPlannerState();
  renderPathTool();
  showPathSavedStatus();
});

undoPathPointButton.addEventListener("click", () => {
  currentPath().pop();
  pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
  pathProgress.export = false;
  savePathPlannerState();
  renderPathTool();
});

clearPathButton.addEventListener("click", () => {
  pathsByDmc[selectedDmc] = [];
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

resetPathToolButton.addEventListener("click", () => {
  loadedPattern = null;
  selectedDmc = null;
  pathsByDmc = {};
  pathProgress = {
    load: false,
    paths: false,
    export: false
  };
  patternJsonFileInput.value = "";
  loadError.hidden = true;
  localStorage.removeItem(PATH_PLANNER_STORAGE_KEY);
  renderPathTool();
});

renderPathTool();
