const STITCH_PROGRESS_STORAGE_KEY = "cross-stitch-progress-tool";

const pathsJsonFileInput = document.querySelector("#pathsJsonFile");
const progressLoadStatus = document.querySelector("#progressLoadStatus");
const progressProjectText = document.querySelector("#progressProjectText");
const progressDimensionsText = document.querySelector("#progressDimensionsText");
const progressPointsText = document.querySelector("#progressPointsText");
const progressLoadError = document.querySelector("#progressLoadError");
const progressJsonPreview = document.querySelector("#progressJsonPreview");
const progressSaveStatus = document.querySelector("#progressSaveStatus");
const resetProgressToolButton = document.querySelector("#resetProgressToolButton");
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
  },
  export: {
    eyebrow: "Etape 3",
    title: "Sauvegarde"
  }
};

const progressStepOrder = ["load", "stitch", "export"];

let loadedPaths = loadStoredPaths();
let stitchProgress = {
  load: Boolean(loadedPaths),
  stitch: false,
  export: false
};
let activeProgressStep = "load";

function loadStoredPaths() {
  const stored = localStorage.getItem(STITCH_PROGRESS_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored);
    return validatePathsFile(parsed).valid ? parsed : null;
  } catch {
    return null;
  }
}

function saveLoadedPaths() {
  if (!loadedPaths) {
    localStorage.removeItem(STITCH_PROGRESS_STORAGE_KEY);
    return;
  }

  localStorage.setItem(STITCH_PROGRESS_STORAGE_KEY, JSON.stringify(loadedPaths));
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
}

function renderLoadedPaths() {
  if (!loadedPaths) {
    progressLoadStatus.className = "coverage-status invalid";
    progressLoadStatus.textContent = "Aucun fichier charge.";
    progressProjectText.textContent = "-";
    progressDimensionsText.textContent = "0 x 0";
    progressPointsText.textContent = "0";
    progressJsonPreview.textContent = "";
    return;
  }

  const pointCount = loadedPaths.paths.reduce((sum, path) => sum + path.points.length, 0);
  progressLoadStatus.className = "coverage-status valid";
  progressLoadStatus.textContent = "Fichier de chemins charge et format valide.";
  progressProjectText.textContent = loadedPaths.project.name;
  progressDimensionsText.textContent = `${loadedPaths.pattern.grid.width} x ${loadedPaths.pattern.grid.height}`;
  progressPointsText.textContent = String(pointCount);
  progressJsonPreview.textContent = JSON.stringify(loadedPaths, null, 2);
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

function cellKey(point) {
  return `${point.x},${point.y}`;
}

function showProgressSavedStatus() {
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
    stitchProgress.load = true;
    stitchProgress.stitch = false;
    stitchProgress.export = false;
    progressLoadError.hidden = true;
    saveLoadedPaths();
    renderProgressTool();
    showProgressSavedStatus();
  } catch (error) {
    loadedPaths = null;
    stitchProgress.load = false;
    stitchProgress.stitch = false;
    stitchProgress.export = false;
    localStorage.removeItem(STITCH_PROGRESS_STORAGE_KEY);
    progressLoadError.textContent = error.message;
    progressLoadError.hidden = false;
    renderProgressTool();
  }
});

progressStepButtons.forEach((button) => {
  button.addEventListener("click", () => {
    goToProgressStep(button.dataset.step);
  });
});

resetProgressToolButton.addEventListener("click", () => {
  loadedPaths = null;
  stitchProgress = {
    load: false,
    stitch: false,
    export: false
  };
  pathsJsonFileInput.value = "";
  progressLoadError.hidden = true;
  localStorage.removeItem(STITCH_PROGRESS_STORAGE_KEY);
  renderProgressTool();
});

renderProgressTool();
