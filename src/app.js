const STORAGE_KEY = "cross-stitch-pattern-draft";
const PROGRESS_STORAGE_KEY = "cross-stitch-import-progress";

const defaultPattern = {
  schemaVersion: 1,
  project: {
    name: ""
  },
  colors: [],
  grid: {
    width: 0,
    height: 0,
    cells: []
  }
};

const projectForm = document.querySelector("#projectForm");
const projectNameInput = document.querySelector("#projectName");
const projectError = document.querySelector("#projectError");
const colorForm = document.querySelector("#colorForm");
const dmcCodeInput = document.querySelector("#dmcCode");
const dmcCodeOptions = document.querySelector("#dmcCodeOptions");
const colorsTableBody = document.querySelector("#colorsTableBody");
const emptyColorsMessage = document.querySelector("#emptyColorsMessage");
const colorsError = document.querySelector("#colorsError");
const backToProjectButton = document.querySelector("#backToProjectButton");
const validateColorsButton = document.querySelector("#validateColorsButton");
const dimensionsForm = document.querySelector("#dimensionsForm");
const gridWidthInput = document.querySelector("#gridWidth");
const gridHeightInput = document.querySelector("#gridHeight");
const dimensionsError = document.querySelector("#dimensionsError");
const backToColorsButton = document.querySelector("#backToColorsButton");
const stepButtons = document.querySelectorAll("[data-step]");
const panels = document.querySelectorAll("[data-panel]");
const stepEyebrow = document.querySelector("#stepEyebrow");
const stepTitle = document.querySelector("#step-title");
const jsonPreview = document.querySelector("#jsonPreview");
const saveStatus = document.querySelector("#saveStatus");
const resetButton = document.querySelector("#resetButton");

const dmcReference = Array.isArray(window.DMC_COLORS) ? window.DMC_COLORS : [];
const dmcReferenceByCode = new Map(dmcReference.map((color) => [normalizeDmcCode(color.code), color]));
let pattern = loadPattern();
let progress = loadProgress(pattern);
let activeStep = "project";

const stepLabels = {
  project: {
    eyebrow: "Etape 1",
    title: "Nom du projet"
  },
  colors: {
    eyebrow: "Etape 2",
    title: "Couleurs DMC"
  },
  dimensions: {
    eyebrow: "Etape 3",
    title: "Dimensions"
  }
};

const stepOrder = ["project", "colors", "dimensions"];

function loadPattern() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return structuredClone(defaultPattern);
  }

  try {
    const parsed = JSON.parse(stored);
    return {
      ...structuredClone(defaultPattern),
      ...parsed,
      project: {
        ...structuredClone(defaultPattern.project),
        ...parsed.project
      },
      grid: {
        ...structuredClone(defaultPattern.grid),
        ...parsed.grid
      },
      colors: Array.isArray(parsed.colors) ? hydrateStoredColors(parsed.colors) : []
    };
  } catch {
    return structuredClone(defaultPattern);
  }
}

function loadProgress(currentPattern) {
  const stored = localStorage.getItem(PROGRESS_STORAGE_KEY);
  if (stored) {
    try {
      return {
        project: false,
        colors: false,
        dimensions: false,
        ...JSON.parse(stored)
      };
    } catch {
      // Fall through to inferred progress.
    }
  }

  return {
    project: currentPattern.project.name.trim().length > 0,
    colors: currentPattern.colors.length > 0,
    dimensions: currentPattern.grid.width > 0 && currentPattern.grid.height > 0
  };
}

function normalizeDmcCode(code) {
  return code.trim().toUpperCase();
}

function hydrateStoredColors(colors) {
  return colors.map((color) => {
    const referenceColor = dmcReferenceByCode.get(normalizeDmcCode(color.dmc || color.code || ""));
    if (!referenceColor) {
      return color;
    }

    return colorFromReference(referenceColor);
  });
}

function colorFromReference(referenceColor) {
  return {
    id: `dmc-${referenceColor.code}`,
    brand: referenceColor.brand,
    series: referenceColor.series,
    dmc: referenceColor.code,
    hex: referenceColor.hex
  };
}

function savePattern() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pattern, null, 2));
}

function saveProgress() {
  localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
}

function render() {
  if (!canOpenStep(activeStep)) {
    activeStep = firstOpenStep();
  }

  projectNameInput.value = pattern.project.name;
  gridWidthInput.value = pattern.grid.width || "";
  gridHeightInput.value = pattern.grid.height || "";
  jsonPreview.textContent = JSON.stringify(pattern, null, 2);
  renderStep();
  renderColors();
  renderDmcOptions();
}

function renderStep() {
  stepEyebrow.textContent = stepLabels[activeStep].eyebrow;
  stepTitle.textContent = stepLabels[activeStep].title;

  stepButtons.forEach((button) => {
    const step = button.dataset.step;
    const isComplete = isStepComplete(step);
    const isLocked = !canOpenStep(step);

    button.classList.toggle("active", button.dataset.step === activeStep);
    button.classList.toggle("complete", isComplete);
    button.classList.toggle("locked", isLocked);
    button.disabled = isLocked;
  });

  panels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.panel !== activeStep);
  });
}

function isStepComplete(step) {
  if (step === "project") {
    return progress.project && pattern.project.name.trim().length > 0;
  }

  if (step === "colors") {
    return progress.colors && pattern.colors.length > 0;
  }

  if (step === "dimensions") {
    return progress.dimensions
      && Number.isInteger(pattern.grid.width)
      && Number.isInteger(pattern.grid.height)
      && pattern.grid.width > 0
      && pattern.grid.height > 0;
  }

  return false;
}

function canOpenStep(step) {
  const stepIndex = stepOrder.indexOf(step);
  if (stepIndex <= 0) {
    return true;
  }

  return stepOrder.slice(0, stepIndex).every(isStepComplete);
}

function firstOpenStep() {
  return stepOrder.find((step) => canOpenStep(step)) || "project";
}

function goToStep(step) {
  if (!canOpenStep(step)) {
    return;
  }

  activeStep = step;
  render();
}

function renderColors() {
  colorsTableBody.innerHTML = "";
  emptyColorsMessage.hidden = pattern.colors.length > 0;

  pattern.colors.forEach((color, index) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td><span class="color-swatch"></span></td>
      <td></td>
      <td class="row-actions">
        <button class="danger-button" type="button" data-remove-color="${index}" title="Supprimer">
          X
        </button>
      </td>
    `;

    const swatch = row.querySelector(".color-swatch");
    swatch.style.background = color.hex || "#ffffff";
    swatch.title = color.hex || "";
    row.children[1].textContent = color.dmc;
    colorsTableBody.appendChild(row);
  });
}

function renderDmcOptions() {
  if (dmcCodeOptions.childElementCount > 0) {
    return;
  }

  const fragment = document.createDocumentFragment();
  dmcReference.forEach((color) => {
    const option = document.createElement("option");
    option.value = color.code;
    option.label = `${color.code} ${color.hex}`;
    fragment.appendChild(option);
  });
  dmcCodeOptions.appendChild(fragment);
}

function showSavedStatus() {
  saveStatus.textContent = "Enregistre";
  window.setTimeout(() => {
    saveStatus.textContent = "Brouillon";
  }, 1400);
}

projectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = projectNameInput.value.trim();

  if (!name) {
    projectError.hidden = false;
    projectNameInput.focus();
    return;
  }

  projectError.hidden = true;
  pattern.project.name = name;
  progress.project = true;
  savePattern();
  saveProgress();
  goToStep("colors");
  showSavedStatus();
});

projectNameInput.addEventListener("input", () => {
  pattern.project.name = projectNameInput.value;
  progress.project = false;
  progress.colors = false;
  progress.dimensions = false;
  saveProgress();
  projectError.hidden = true;
  render();
});

colorForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const dmc = normalizeDmcCode(dmcCodeInput.value);

  if (!dmc) {
    return;
  }

  const referenceColor = dmcReferenceByCode.get(dmc);
  if (!referenceColor) {
    colorsError.textContent = "Ce code DMC n'est pas dans la reference.";
    colorsError.hidden = false;
    dmcCodeInput.focus();
    return;
  }

  const alreadyAdded = pattern.colors.some((color) => normalizeDmcCode(color.dmc) === dmc);
  if (alreadyAdded) {
    colorsError.textContent = "Ce code DMC est deja dans la liste.";
    colorsError.hidden = false;
    dmcCodeInput.focus();
    return;
  }

  pattern.colors.push(colorFromReference(referenceColor));
  progress.colors = false;
  progress.dimensions = false;

  savePattern();
  saveProgress();
  colorsError.hidden = true;
  colorForm.reset();
  dmcCodeInput.focus();
  render();
  showSavedStatus();
});

colorsTableBody.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-color]");
  if (!removeButton) {
    return;
  }

  const index = Number(removeButton.dataset.removeColor);
  pattern.colors.splice(index, 1);
  progress.colors = false;
  progress.dimensions = false;
  savePattern();
  saveProgress();
  render();
});

backToProjectButton.addEventListener("click", () => {
  goToStep("project");
});

validateColorsButton.addEventListener("click", () => {
  if (pattern.colors.length === 0) {
    colorsError.textContent = "Ajoute au moins un code DMC pour valider cette etape.";
    colorsError.hidden = false;
    dmcCodeInput.focus();
    return;
  }

  colorsError.hidden = true;
  progress.colors = true;
  progress.dimensions = false;
  savePattern();
  saveProgress();
  goToStep("dimensions");
  showSavedStatus();
});

backToColorsButton.addEventListener("click", () => {
  goToStep("colors");
});

dimensionsForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const width = Number(gridWidthInput.value);
  const height = Number(gridHeightInput.value);

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    dimensionsError.hidden = false;
    return;
  }

  const dimensionsChanged = pattern.grid.width !== width || pattern.grid.height !== height;
  pattern.grid.width = width;
  pattern.grid.height = height;

  if (dimensionsChanged) {
    pattern.grid.cells = [];
  }

  progress.dimensions = true;
  dimensionsError.hidden = true;
  savePattern();
  saveProgress();
  render();
  showSavedStatus();
});

gridWidthInput.addEventListener("input", () => {
  dimensionsError.hidden = true;
});

gridHeightInput.addEventListener("input", () => {
  dimensionsError.hidden = true;
});

stepButtons.forEach((button) => {
  button.addEventListener("click", () => {
    goToStep(button.dataset.step);
  });
});

resetButton.addEventListener("click", () => {
  pattern = structuredClone(defaultPattern);
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(PROGRESS_STORAGE_KEY);
  progress = {
    project: false,
    colors: false,
    dimensions: false
  };
  render();
});

render();
