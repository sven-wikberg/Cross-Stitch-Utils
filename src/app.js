const STORAGE_KEY = "cross-stitch-pattern-draft";
const PROGRESS_STORAGE_KEY = "cross-stitch-import-progress";

const defaultPattern = {
  schemaVersion: 1,
  project: {
    name: ""
  },
  colors: [],
  partsExpected: 0,
  parts: [],
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
const partCountForm = document.querySelector("#partCountForm");
const partsExpectedInput = document.querySelector("#partsExpected");
const partCountError = document.querySelector("#partCountError");
const partForm = document.querySelector("#partForm");
const partImageInput = document.querySelector("#partImage");
const partStartXInput = document.querySelector("#partStartX");
const partStartYInput = document.querySelector("#partStartY");
const partWidthInput = document.querySelector("#partWidth");
const partHeightInput = document.querySelector("#partHeight");
const partError = document.querySelector("#partError");
const partsTableBody = document.querySelector("#partsTableBody");
const emptyPartsMessage = document.querySelector("#emptyPartsMessage");
const partsCoverageStatus = document.querySelector("#partsCoverageStatus");
const nextPartName = document.querySelector("#nextPartName");
const partProgressText = document.querySelector("#partProgressText");
const backToDimensionsButton = document.querySelector("#backToDimensionsButton");
const validatePartsButton = document.querySelector("#validatePartsButton");
const partsError = document.querySelector("#partsError");
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
  },
  parts: {
    eyebrow: "Etape 4",
    title: "Morceaux"
  }
};

const stepOrder = ["project", "colors", "dimensions", "parts"];

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
      partsExpected: Number.isInteger(parsed.partsExpected) ? parsed.partsExpected : 0,
      parts: Array.isArray(parsed.parts) ? parsed.parts : [],
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
        parts: false,
        ...JSON.parse(stored)
      };
    } catch {
      // Fall through to inferred progress.
    }
  }

  return {
    project: currentPattern.project.name.trim().length > 0,
    colors: currentPattern.colors.length > 0,
    dimensions: currentPattern.grid.width > 0 && currentPattern.grid.height > 0,
    parts: validatePartsCoverage(currentPattern).valid
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
  partsExpectedInput.value = pattern.partsExpected || "";
  jsonPreview.textContent = JSON.stringify(pattern, null, 2);
  renderStep();
  renderColors();
  renderParts();
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

  if (step === "parts") {
    return progress.parts && validatePartsCoverage(pattern).valid;
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

function renderParts() {
  partsTableBody.innerHTML = "";
  emptyPartsMessage.hidden = pattern.parts.length > 0;
  partForm.classList.toggle("hidden", pattern.partsExpected <= 0 || pattern.parts.length >= pattern.partsExpected);
  nextPartName.textContent = `Part ${pattern.parts.length + 1}`;
  partProgressText.textContent = pattern.partsExpected > 0
    ? `Morceau ${Math.min(pattern.parts.length + 1, pattern.partsExpected)} / ${pattern.partsExpected}`
    : "Definis d'abord le nombre de sous-parties.";

  pattern.parts.forEach((part, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td class="row-actions">
        <button class="danger-button" type="button" data-remove-part="${index}" title="Supprimer">
          X
        </button>
      </td>
    `;

    row.children[0].textContent = part.name;
    row.children[1].textContent = part.imageName;
    row.children[2].textContent = `${part.startX}, ${part.startY}`;
    row.children[3].textContent = `${part.width} x ${part.height}`;
    partsTableBody.appendChild(row);
  });

  renderPartsCoverage();
}

function renderPartsCoverage() {
  const coverage = validatePartsCoverage(pattern);
  partsCoverageStatus.className = `coverage-status ${coverage.valid ? "valid" : "invalid"}`;
  partsCoverageStatus.textContent = coverage.message;
}

function validatePartsCoverage(patternToValidate) {
  const gridWidth = patternToValidate.grid.width;
  const gridHeight = patternToValidate.grid.height;
  const parts = patternToValidate.parts || [];
  const partsExpected = patternToValidate.partsExpected || 0;

  if (!Number.isInteger(gridWidth) || !Number.isInteger(gridHeight) || gridWidth <= 0 || gridHeight <= 0) {
    return {
      valid: false,
      message: "Les dimensions globales doivent etre validees avant les morceaux."
    };
  }

  if (!Number.isInteger(partsExpected) || partsExpected <= 0) {
    return {
      valid: false,
      message: "Le nombre de sous-parties doit etre defini."
    };
  }

  if (parts.length === 0) {
    return {
      valid: false,
      message: `Morceaux: 0 / ${partsExpected}. Couverture: 0 / ${gridWidth * gridHeight} points.`
    };
  }

  if (parts.length !== partsExpected) {
    return {
      valid: false,
      message: `Morceaux: ${parts.length} / ${partsExpected}.`
    };
  }

  const occupiedCells = new Set();
  let declaredArea = 0;

  for (const part of parts) {
    const values = [part.startX, part.startY, part.width, part.height];
    if (!values.every(Number.isInteger) || part.startX < 0 || part.startY < 0 || part.width <= 0 || part.height <= 0) {
      return {
        valid: false,
        message: "Un morceau contient des dimensions invalides."
      };
    }

    if (part.startX + part.width > gridWidth || part.startY + part.height > gridHeight) {
      return {
        valid: false,
        message: `Le morceau "${part.name}" depasse les dimensions globales.`
      };
    }

    declaredArea += part.width * part.height;

    for (let y = part.startY; y < part.startY + part.height; y += 1) {
      for (let x = part.startX; x < part.startX + part.width; x += 1) {
        const key = `${x},${y}`;
        if (occupiedCells.has(key)) {
          return {
            valid: false,
            message: `Le morceau "${part.name}" chevauche un autre morceau.`
          };
        }
        occupiedCells.add(key);
      }
    }
  }

  const expectedArea = gridWidth * gridHeight;
  if (declaredArea !== expectedArea) {
    return {
      valid: false,
      message: `Somme des morceaux: ${declaredArea} / ${expectedArea} points.`
    };
  }

  if (occupiedCells.size !== expectedArea) {
    return {
      valid: false,
      message: `Couverture reelle: ${occupiedCells.size} / ${expectedArea} points.`
    };
  }

  return {
    valid: true,
    message: `Couverture complete: ${expectedArea} / ${expectedArea} points.`
  };
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
  progress.parts = false;
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
  progress.parts = false;

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
  progress.parts = false;
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
  progress.parts = false;
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
    pattern.parts = [];
    pattern.partsExpected = 0;
    progress.parts = false;
  }

  progress.dimensions = true;
  dimensionsError.hidden = true;
  savePattern();
  saveProgress();
  goToStep("parts");
  showSavedStatus();
});

gridWidthInput.addEventListener("input", () => {
  dimensionsError.hidden = true;
});

gridHeightInput.addEventListener("input", () => {
  dimensionsError.hidden = true;
});

backToDimensionsButton.addEventListener("click", () => {
  goToStep("dimensions");
});

partCountForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const expected = Number(partsExpectedInput.value);
  if (!Number.isInteger(expected) || expected <= 0) {
    partCountError.hidden = false;
    partsExpectedInput.focus();
    return;
  }

  if (expected !== pattern.partsExpected) {
    pattern.partsExpected = expected;
    pattern.parts = [];
    progress.parts = false;
  }

  partCountError.hidden = true;
  savePattern();
  saveProgress();
  render();
  showSavedStatus();
});

partsExpectedInput.addEventListener("input", () => {
  partCountError.hidden = true;
});

partForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = `Part ${pattern.parts.length + 1}`;
  const imageName = partImageInput.files[0]?.name || "";
  const startX = Number(partStartXInput.value);
  const startY = Number(partStartYInput.value);
  const width = Number(partWidthInput.value);
  const height = Number(partHeightInput.value);

  if (
    !name
    || !imageName
    || ![startX, startY, width, height].every(Number.isInteger)
    || startX < 0
    || startY < 0
    || width <= 0
    || height <= 0
  ) {
    partError.textContent = "Verifie les valeurs du morceau.";
    partError.hidden = false;
    return;
  }

  if (pattern.partsExpected <= 0) {
    partError.textContent = "Valide d'abord le nombre de sous-parties.";
    partError.hidden = false;
    return;
  }

  if (pattern.parts.length >= pattern.partsExpected) {
    partError.textContent = "Toutes les sous-parties prevues sont deja ajoutees.";
    partError.hidden = false;
    return;
  }

  if (startX + width > pattern.grid.width || startY + height > pattern.grid.height) {
    partError.textContent = "Ce morceau depasse les dimensions globales.";
    partError.hidden = false;
    return;
  }

  pattern.parts.push({
    id: `part-${Date.now()}`,
    name,
    imageName,
    startX,
    startY,
    width,
    height
  });

  progress.parts = false;
  savePattern();
  saveProgress();
  partForm.reset();
  partImageInput.focus();
  partError.hidden = true;
  partsError.hidden = true;
  render();
  showSavedStatus();
});

partsTableBody.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-part]");
  if (!removeButton) {
    return;
  }

  const index = Number(removeButton.dataset.removePart);
  pattern.parts.splice(index, 1);
  renumberParts();
  progress.parts = false;
  savePattern();
  saveProgress();
  render();
});

function renumberParts() {
  pattern.parts.forEach((part, index) => {
    part.name = `Part ${index + 1}`;
  });
}

validatePartsButton.addEventListener("click", () => {
  const coverage = validatePartsCoverage(pattern);
  if (!coverage.valid) {
    partsError.textContent = coverage.message;
    partsError.hidden = false;
    renderPartsCoverage();
    return;
  }

  progress.parts = true;
  partsError.hidden = true;
  saveProgress();
  render();
  showSavedStatus();
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
    dimensions: false,
    parts: false
  };
  render();
});

render();
