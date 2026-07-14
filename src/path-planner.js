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

let loadedPattern = loadStoredPattern();
let pathProgress = {
  load: Boolean(loadedPattern),
  paths: false,
  export: false
};
let activePathStep = "load";

function loadStoredPattern() {
  const stored = localStorage.getItem(PATH_PLANNER_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored);
    return validateFinalPattern(parsed).valid ? parsed : null;
  } catch {
    return null;
  }
}

function saveLoadedPattern() {
  if (!loadedPattern) {
    localStorage.removeItem(PATH_PLANNER_STORAGE_KEY);
    return;
  }

  localStorage.setItem(PATH_PLANNER_STORAGE_KEY, JSON.stringify(loadedPattern));
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
    pathProgress.load = true;
    pathProgress.paths = false;
    pathProgress.export = false;
    loadError.hidden = true;
    saveLoadedPattern();
    renderPathTool();
    showPathSavedStatus();
  } catch (error) {
    loadedPattern = null;
    pathProgress.load = false;
    pathProgress.paths = false;
    pathProgress.export = false;
    localStorage.removeItem(PATH_PLANNER_STORAGE_KEY);
    loadError.textContent = error.message;
    loadError.hidden = false;
    renderPathTool();
  }
});

pathStepButtons.forEach((button) => {
  button.addEventListener("click", () => {
    goToPathStep(button.dataset.step);
  });
});

resetPathToolButton.addEventListener("click", () => {
  loadedPattern = null;
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
