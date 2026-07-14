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
  symbolGroups: [],
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
const clipboardDropZone = document.querySelector("#clipboardDropZone");
const clipboardImageStatus = document.querySelector("#clipboardImageStatus");
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
const gridStatus = document.querySelector("#gridStatus");
const gridDimensionsText = document.querySelector("#gridDimensionsText");
const gridExpectedCellsText = document.querySelector("#gridExpectedCellsText");
const gridGeneratedCellsText = document.querySelector("#gridGeneratedCellsText");
const backToPartsButton = document.querySelector("#backToPartsButton");
const generateGridButton = document.querySelector("#generateGridButton");
const gridError = document.querySelector("#gridError");
const analysisStatus = document.querySelector("#analysisStatus");
const analysisPartsText = document.querySelector("#analysisPartsText");
const analysisCellsText = document.querySelector("#analysisCellsText");
const analysisSignaturesText = document.querySelector("#analysisSignaturesText");
const backToGridButton = document.querySelector("#backToGridButton");
const sliceImagesButton = document.querySelector("#sliceImagesButton");
const analysisError = document.querySelector("#analysisError");
const groupsStatus = document.querySelector("#groupsStatus");
const groupsCellsText = document.querySelector("#groupsCellsText");
const groupsCountText = document.querySelector("#groupsCountText");
const largestGroupText = document.querySelector("#largestGroupText");
const groupsTableBody = document.querySelector("#groupsTableBody");
const emptyGroupsMessage = document.querySelector("#emptyGroupsMessage");
const backToAnalysisButton = document.querySelector("#backToAnalysisButton");
const generateGroupsButton = document.querySelector("#generateGroupsButton");
const groupsError = document.querySelector("#groupsError");
const assignmentsStatus = document.querySelector("#assignmentsStatus");
const assignmentsGroupsText = document.querySelector("#assignmentsGroupsText");
const assignmentsReadyText = document.querySelector("#assignmentsReadyText");
const assignmentsCellsText = document.querySelector("#assignmentsCellsText");
const assignmentReview = document.querySelector("#assignmentReview");
const assignmentPositionText = document.querySelector("#assignmentPositionText");
const assignmentGroupName = document.querySelector("#assignmentGroupName");
const assignmentCellCountText = document.querySelector("#assignmentCellCountText");
const assignmentCurrentState = document.querySelector("#assignmentCurrentState");
const assignmentPreviewWrap = document.querySelector("#assignmentPreviewWrap");
const assignmentChoices = document.querySelector("#assignmentChoices");
const emptyAssignmentsMessage = document.querySelector("#emptyAssignmentsMessage");
const backToGroupsButton = document.querySelector("#backToGroupsButton");
const previousAssignmentButton = document.querySelector("#previousAssignmentButton");
const assignEmptyButton = document.querySelector("#assignEmptyButton");
const nextAssignmentButton = document.querySelector("#nextAssignmentButton");
const applyAssignmentsButton = document.querySelector("#applyAssignmentsButton");
const assignmentsError = document.querySelector("#assignmentsError");
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
let pastedPartImage = null;
let assignmentGroupIndex = 0;

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
  },
  grid: {
    eyebrow: "Etape 5",
    title: "Grille vide"
  },
  analysis: {
    eyebrow: "Etape 6",
    title: "Decoupage"
  },
  groups: {
    eyebrow: "Etape 7",
    title: "Groupes"
  },
  assignments: {
    eyebrow: "Etape 8",
    title: "Associations"
  }
};

const stepOrder = ["project", "colors", "dimensions", "parts", "grid", "analysis", "groups", "assignments"];

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
      symbolGroups: Array.isArray(parsed.symbolGroups) ? parsed.symbolGroups : [],
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
        grid: false,
        analysis: false,
        groups: false,
        assignments: false,
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
    parts: validatePartsCoverage(currentPattern).valid,
    grid: isGridGenerated(currentPattern),
    analysis: isImageAnalysisComplete(currentPattern),
    groups: areSymbolGroupsGenerated(currentPattern),
    assignments: areAssignmentsApplied(currentPattern)
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
  renderGrid();
  renderAnalysis();
  renderGroups();
  renderAssignments();
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

  if (step === "grid") {
    return progress.grid && isGridGenerated(pattern);
  }

  if (step === "analysis") {
    return progress.analysis && isImageAnalysisComplete(pattern);
  }

  if (step === "groups") {
    return progress.groups && areSymbolGroupsGenerated(pattern);
  }

  if (step === "assignments") {
    return progress.assignments && areAssignmentsApplied(pattern);
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
  clipboardImageStatus.textContent = pastedPartImage
    ? pastedPartImage.name
    : "Aucune image collee";
  clipboardDropZone.classList.toggle("has-image", Boolean(pastedPartImage));

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

function renderGrid() {
  const expectedCells = pattern.grid.width * pattern.grid.height;
  const generatedCells = pattern.grid.cells.length;
  const generated = isGridGenerated(pattern);

  gridDimensionsText.textContent = `${pattern.grid.width || 0} x ${pattern.grid.height || 0}`;
  gridExpectedCellsText.textContent = String(expectedCells || 0);
  gridGeneratedCellsText.textContent = String(generatedCells);
  gridStatus.className = `coverage-status ${generated ? "valid" : "invalid"}`;
  gridStatus.textContent = generated
    ? `Grille generee: ${generatedCells} cases.`
    : `Grille non generee: ${generatedCells} / ${expectedCells || 0} cases.`;
}

function renderAnalysis() {
  const totalCells = pattern.grid.cells.length;
  const signedCells = pattern.grid.cells.filter((cell) => cell.sampleSignature).length;
  const complete = isImageAnalysisComplete(pattern);

  analysisPartsText.textContent = String(pattern.parts.length);
  analysisCellsText.textContent = String(totalCells);
  analysisSignaturesText.textContent = String(signedCells);
  analysisStatus.className = `coverage-status ${complete ? "valid" : "invalid"}`;
  analysisStatus.textContent = complete
    ? `Decoupage termine: ${signedCells} signatures.`
    : `Decoupage incomplet: ${signedCells} / ${totalCells} signatures.`;
}

function renderGroups() {
  const cells = pattern.grid.cells || [];
  const groups = pattern.symbolGroups || [];
  const generated = areSymbolGroupsGenerated(pattern);
  const largestGroupSize = groups.reduce((largest, group) => Math.max(largest, group.cellCount), 0);

  groupsCellsText.textContent = String(cells.length);
  groupsCountText.textContent = String(groups.length);
  largestGroupText.textContent = String(largestGroupSize);
  groupsStatus.className = `coverage-status ${generated ? "valid" : "invalid"}`;
  groupsStatus.textContent = generated
    ? `Groupes generes: ${groups.length}.`
    : "Groupes non generes.";

  groupsTableBody.innerHTML = "";
  emptyGroupsMessage.hidden = groups.length > 0;

  groups.slice(0, 50).forEach((group) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td></td>
      <td></td>
      <td><code></code></td>
      <td><span class="color-swatch"></span></td>
    `;

    row.children[0].textContent = group.id;
    row.children[1].textContent = group.cellCount;
    row.querySelector("code").textContent = group.signature;
    const swatch = row.querySelector(".color-swatch");
    swatch.style.background = group.sampleMean || "#ffffff";
    swatch.title = group.sampleMean || "";
    groupsTableBody.appendChild(row);
  });
}

function renderAssignments() {
  const groups = pattern.symbolGroups || [];
  const hasGroups = groups.length > 0;
  emptyAssignmentsMessage.hidden = hasGroups;
  assignmentReview.classList.toggle("empty", !hasGroups);
  applyAssignmentsButton.disabled = !hasGroups;

  if (!hasGroups) {
    assignmentChoices.innerHTML = "";
    assignmentPreviewWrap.innerHTML = '<span class="symbol-preview-empty">A regenerer</span>';
    assignmentPositionText.textContent = "Groupe 0 / 0";
    assignmentGroupName.textContent = "Groupe";
    assignmentCellCountText.textContent = "0 cellule";
    updateAssignmentCurrentState(null);
    renderAssignmentsStatus();
    return;
  }

  assignmentGroupIndex = Math.min(Math.max(assignmentGroupIndex, 0), groups.length - 1);
  const group = groups[assignmentGroupIndex];

  assignmentPositionText.textContent = `Groupe ${assignmentGroupIndex + 1} / ${groups.length}`;
  assignmentGroupName.textContent = group.id;
  assignmentCellCountText.textContent = `${group.cellCount} ${group.cellCount > 1 ? "cellules" : "cellule"}`;
  updateAssignmentCurrentState(group);
  assignmentPreviewWrap.innerHTML = "";

  if (group.previewDataUrl) {
    const preview = document.createElement("img");
    preview.className = "symbol-preview large";
    preview.src = group.previewDataUrl;
    preview.alt = `Apercu ${group.id}`;
    assignmentPreviewWrap.appendChild(preview);
  } else {
    assignmentPreviewWrap.innerHTML = '<span class="symbol-preview-empty">A regenerer</span>';
  }

  assignmentChoices.innerHTML = "";
  pattern.colors.forEach((color) => {
    const button = document.createElement("button");
    button.className = "assignment-choice-button";
    button.type = "button";
    button.dataset.dmc = color.dmc;
    button.classList.toggle("selected", !group.isEmpty && group.dmc === color.dmc);
    button.innerHTML = `
      <span class="color-swatch"></span>
      <span>DMC ${color.dmc}</span>
    `;
    button.querySelector(".color-swatch").style.background = color.hex;
    assignmentChoices.appendChild(button);
  });

  assignEmptyButton.classList.toggle("selected", Boolean(group.isEmpty));
  previousAssignmentButton.disabled = assignmentGroupIndex === 0;
  nextAssignmentButton.disabled = assignmentGroupIndex === groups.length - 1;

  renderAssignmentsStatus();
}

function updateAssignmentCurrentState(group) {
  assignmentCurrentState.classList.remove("ready", "empty", "unready");

  if (!group || !isGroupAssignmentReady(group)) {
    assignmentCurrentState.textContent = "Non classe";
    assignmentCurrentState.classList.add("unready");
    return;
  }

  if (group.isEmpty) {
    assignmentCurrentState.textContent = "Classe vide";
    assignmentCurrentState.classList.add("empty");
    return;
  }

  assignmentCurrentState.textContent = `Classe DMC ${group.dmc}`;
  assignmentCurrentState.classList.add("ready");
}

function renderAssignmentsStatus() {
  const groups = pattern.symbolGroups || [];
  const readyGroups = groups.filter(isGroupAssignmentReady);
  const readyCells = readyGroups.reduce((sum, group) => sum + group.cellCount, 0);
  const applied = areAssignmentsApplied(pattern);

  assignmentsGroupsText.textContent = String(groups.length);
  assignmentsReadyText.textContent = `${readyGroups.length} / ${groups.length}`;
  assignmentsCellsText.textContent = `${readyCells} / ${pattern.grid.cells.length}`;
  assignmentsStatus.className = `coverage-status ${applied ? "valid" : "invalid"}`;

  if (applied) {
    assignmentsStatus.textContent = "Associations appliquees a la grille.";
  } else if (groups.length === 0) {
    assignmentsStatus.textContent = "Genere d'abord les groupes de symboles.";
  } else {
    assignmentsStatus.textContent = `Associations a terminer: ${readyGroups.length} / ${groups.length} groupes prets.`;
  }
}

function areSymbolGroupsGenerated(patternToValidate) {
  const groups = patternToValidate.symbolGroups || [];
  if (!isImageAnalysisComplete(patternToValidate) || groups.length === 0) {
    return false;
  }

  const groupedCellCount = groups.reduce((sum, group) => sum + group.cellCount, 0);
  return groupedCellCount === patternToValidate.grid.cells.length;
}

function isGroupAssignmentReady(group) {
  if (group.isEmpty) {
    return true;
  }

  return Boolean(group.dmc);
}

function areAssignmentsApplied(patternToValidate) {
  const groups = patternToValidate.symbolGroups || [];
  const cells = patternToValidate.grid.cells || [];
  if (!areSymbolGroupsGenerated(patternToValidate) || groups.length === 0) {
    return false;
  }

  if (!groups.every(isGroupAssignmentReady)) {
    return false;
  }

  const cellsByKey = new Map(cells.map((cell) => [`${cell.x},${cell.y}`, cell]));
  return groups.every((group) => group.cellKeys.every((key) => {
    const cell = cellsByKey.get(key);
    if (!cell) {
      return false;
    }

    if (group.isEmpty) {
      return cell.empty === true && cell.symbol === null && cell.dmc === null;
    }

    return cell.empty !== true
      && cell.symbol === null
      && cell.dmc === group.dmc;
  }));
}

function isImageAnalysisComplete(patternToValidate) {
  if (!isGridGenerated(patternToValidate)) {
    return false;
  }

  return patternToValidate.grid.cells.every((cell) => Boolean(cell.sampleSignature));
}

function isGridGenerated(patternToValidate) {
  const expectedCells = patternToValidate.grid.width * patternToValidate.grid.height;
  if (!Number.isInteger(expectedCells) || expectedCells <= 0) {
    return false;
  }

  const cells = patternToValidate.grid.cells || [];
  if (cells.length !== expectedCells) {
    return false;
  }

  const cellKeys = new Set();
  for (const cell of cells) {
    if (
      !Number.isInteger(cell.x)
      || !Number.isInteger(cell.y)
      || cell.x < 0
      || cell.y < 0
      || cell.x >= patternToValidate.grid.width
      || cell.y >= patternToValidate.grid.height
      || !cell.partId
    ) {
      return false;
    }

    const key = `${cell.x},${cell.y}`;
    if (cellKeys.has(key)) {
      return false;
    }
    cellKeys.add(key);
  }

  return cellKeys.size === expectedCells;
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function readImageFromClipboardEvent(event) {
  const items = [...event.clipboardData?.items || []];
  const imageItem = items.find((item) => item.type.startsWith("image/"));
  if (!imageItem) {
    return false;
  }

  const file = imageItem.getAsFile();
  if (!file) {
    return false;
  }

  event.preventDefault();
  const partNumber = pattern.parts.length + 1;
  const extension = file.type.split("/")[1] || "png";
  pastedPartImage = {
    source: "clipboard",
    name: `clipboard-part-${partNumber}.${extension}`,
    type: file.type,
    dataUrl: await fileToDataUrl(file)
  };
  partImageInput.value = "";
  partError.hidden = true;
  render();
  return true;
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
  progress.grid = false;
  progress.analysis = false;
  progress.groups = false;
  progress.assignments = false;
  pattern.symbolGroups = [];
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
  progress.grid = false;
  progress.analysis = false;
  progress.groups = false;
  progress.assignments = false;
  pattern.symbolGroups = [];

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
  progress.grid = false;
  progress.analysis = false;
  progress.groups = false;
  progress.assignments = false;
  pattern.symbolGroups = [];
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
  progress.grid = false;
  progress.analysis = false;
  progress.groups = false;
  progress.assignments = false;
  pattern.symbolGroups = [];
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
    progress.grid = false;
    progress.analysis = false;
    progress.groups = false;
    progress.assignments = false;
    pattern.symbolGroups = [];
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
    pattern.grid.cells = [];
    progress.parts = false;
    progress.grid = false;
    progress.analysis = false;
    progress.groups = false;
    progress.assignments = false;
    pattern.symbolGroups = [];
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
  addPartFromForm();
});

async function addPartFromForm() {
  const name = `Part ${pattern.parts.length + 1}`;
  const selectedFile = partImageInput.files[0] || null;
  const imageName = pastedPartImage?.name || selectedFile?.name || "";
  const imageSource = pastedPartImage?.source || (selectedFile ? "file" : "");
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

  let imageDataUrl = pastedPartImage?.dataUrl || "";
  if (!imageDataUrl && selectedFile) {
    imageDataUrl = await fileToDataUrl(selectedFile);
  }

  pattern.parts.push({
    id: `part-${Date.now()}`,
    name,
    imageName,
    imageSource,
    imageDataUrl,
    startX,
    startY,
    width,
    height
  });

  pattern.grid.cells = [];
  progress.parts = false;
  progress.grid = false;
  progress.analysis = false;
  progress.groups = false;
  progress.assignments = false;
  pattern.symbolGroups = [];
  savePattern();
  saveProgress();
  partForm.reset();
  pastedPartImage = null;
  partImageInput.focus();
  partError.hidden = true;
  partsError.hidden = true;
  render();
  showSavedStatus();
}

partImageInput.addEventListener("change", () => {
  if (partImageInput.files.length > 0) {
    pastedPartImage = null;
  }
  partError.hidden = true;
  render();
});

clipboardDropZone.addEventListener("paste", (event) => {
  readImageFromClipboardEvent(event);
});

document.addEventListener("paste", (event) => {
  const target = event.target;
  const isTypingTarget = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  const canPastePartImage = activeStep === "parts"
    && pattern.partsExpected > 0
    && pattern.parts.length < pattern.partsExpected;

  if (!isTypingTarget && canPastePartImage) {
    readImageFromClipboardEvent(event);
  }
});

partsTableBody.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-part]");
  if (!removeButton) {
    return;
  }

  const index = Number(removeButton.dataset.removePart);
  pattern.parts.splice(index, 1);
  renumberParts();
  pattern.grid.cells = [];
  progress.parts = false;
  progress.grid = false;
  progress.analysis = false;
  progress.groups = false;
  progress.assignments = false;
  pattern.symbolGroups = [];
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
  progress.grid = false;
  progress.analysis = false;
  progress.groups = false;
  progress.assignments = false;
  pattern.symbolGroups = [];
  partsError.hidden = true;
  savePattern();
  saveProgress();
  goToStep("grid");
  showSavedStatus();
});

backToPartsButton.addEventListener("click", () => {
  goToStep("parts");
});

generateGridButton.addEventListener("click", () => {
  const coverage = validatePartsCoverage(pattern);
  if (!progress.parts || !coverage.valid) {
    gridError.textContent = coverage.message;
    gridError.hidden = false;
    return;
  }

  pattern.grid.cells = generateGridCells(pattern);
  progress.grid = true;
  progress.analysis = false;
  progress.groups = false;
  progress.assignments = false;
  pattern.symbolGroups = [];
  gridError.hidden = true;
  savePattern();
  saveProgress();
  goToStep("analysis");
  showSavedStatus();
});

backToGridButton.addEventListener("click", () => {
  goToStep("grid");
});

sliceImagesButton.addEventListener("click", async () => {
  if (!progress.grid || !isGridGenerated(pattern)) {
    analysisError.textContent = "La grille doit etre generee avant le decoupage.";
    analysisError.hidden = false;
    return;
  }

  const partsWithoutImage = pattern.parts.filter((part) => !part.imageDataUrl);
  if (partsWithoutImage.length > 0) {
    analysisError.textContent = `Image manquante pour ${partsWithoutImage[0].name}.`;
    analysisError.hidden = false;
    return;
  }

  try {
    await slicePartImagesIntoCells();
    progress.analysis = true;
    progress.groups = false;
    progress.assignments = false;
    pattern.symbolGroups = [];
    analysisError.hidden = true;
    savePattern();
    saveProgress();
    render();
    showSavedStatus();
  } catch (error) {
    analysisError.textContent = error.message;
    analysisError.hidden = false;
  }
});

backToAnalysisButton.addEventListener("click", () => {
  goToStep("analysis");
});

generateGroupsButton.addEventListener("click", () => {
  if (!progress.analysis || !isImageAnalysisComplete(pattern)) {
    groupsError.textContent = "Le decoupage doit etre termine avant de generer les groupes.";
    groupsError.hidden = false;
    return;
  }

  pattern.symbolGroups = generateSymbolGroups(pattern);
  progress.groups = true;
  progress.assignments = false;
  assignmentGroupIndex = 0;
  groupsError.hidden = true;
  savePattern();
  saveProgress();
  goToStep("assignments");
  showSavedStatus();
});

backToGroupsButton.addEventListener("click", () => {
  goToStep("groups");
});

assignmentChoices.addEventListener("click", (event) => {
  const button = event.target.closest("[data-dmc]");
  if (!button) {
    return;
  }

  classifyCurrentGroup({ dmc: button.dataset.dmc, isEmpty: false });
});

assignEmptyButton.addEventListener("click", () => {
  classifyCurrentGroup({ dmc: null, isEmpty: true });
});

previousAssignmentButton.addEventListener("click", () => {
  assignmentGroupIndex = Math.max(assignmentGroupIndex - 1, 0);
  renderAssignments();
});

nextAssignmentButton.addEventListener("click", () => {
  const groups = pattern.symbolGroups || [];
  assignmentGroupIndex = Math.min(assignmentGroupIndex + 1, groups.length - 1);
  renderAssignments();
});

applyAssignmentsButton.addEventListener("click", () => {
  if (!progress.groups || !areSymbolGroupsGenerated(pattern)) {
    assignmentsError.textContent = "Genere d'abord les groupes de symboles.";
    assignmentsError.hidden = false;
    return;
  }

  const missingGroup = pattern.symbolGroups.find((group) => !isGroupAssignmentReady(group));
  if (missingGroup) {
    assignmentsError.textContent = `${missingGroup.id} doit avoir une couleur DMC, ou etre marque comme vide.`;
    assignmentsError.hidden = false;
    return;
  }

  applyGroupAssignmentsToCells();
  progress.assignments = true;
  assignmentsError.hidden = true;
  savePattern();
  saveProgress();
  render();
  showSavedStatus();
});

function classifyCurrentGroup({ dmc, isEmpty }) {
  const groups = pattern.symbolGroups || [];
  const group = groups[assignmentGroupIndex];
  if (!group) {
    return;
  }

  group.dmc = dmc;
  group.isEmpty = isEmpty;
  group.symbol = null;
  progress.assignments = false;
  assignmentsError.hidden = true;
  savePattern();
  saveProgress();
  advanceToNextAssignment();
  renderAssignments();
  jsonPreview.textContent = JSON.stringify(pattern, null, 2);
  showSavedStatus();
}

function advanceToNextAssignment() {
  const groups = pattern.symbolGroups || [];
  const nextUnreadyIndex = groups.findIndex((group, index) => (
    index > assignmentGroupIndex && !isGroupAssignmentReady(group)
  ));

  if (nextUnreadyIndex >= 0) {
    assignmentGroupIndex = nextUnreadyIndex;
    return;
  }

  assignmentGroupIndex = Math.min(assignmentGroupIndex + 1, groups.length - 1);
}

function generateSymbolGroups(patternToGroup) {
  const groupsBySignature = new Map();

  patternToGroup.grid.cells.forEach((cell) => {
    const signature = cell.sampleSignature;
    if (!groupsBySignature.has(signature)) {
      groupsBySignature.set(signature, {
        signature,
        sampleMean: cell.sampleMean || "",
        previewDataUrl: cell.samplePreviewDataUrl || "",
        cellKeys: []
      });
    }

    if (!groupsBySignature.get(signature).previewDataUrl && cell.samplePreviewDataUrl) {
      groupsBySignature.get(signature).previewDataUrl = cell.samplePreviewDataUrl;
    }

    groupsBySignature.get(signature).cellKeys.push(`${cell.x},${cell.y}`);
  });

  return [...groupsBySignature.values()]
    .sort((a, b) => b.cellKeys.length - a.cellKeys.length || a.signature.localeCompare(b.signature))
    .map((group, index) => ({
      id: `group-${index + 1}`,
      signature: group.signature,
      sampleMean: group.sampleMean,
      previewDataUrl: group.previewDataUrl,
      cellCount: group.cellKeys.length,
      cellKeys: group.cellKeys,
      symbol: null,
      dmc: null,
      isEmpty: false
    }));
}

function findGroupById(groupId) {
  return (pattern.symbolGroups || []).find((group) => group.id === groupId);
}

function applyGroupAssignmentsToCells() {
  const cellsByKey = new Map(pattern.grid.cells.map((cell) => [`${cell.x},${cell.y}`, cell]));

  pattern.symbolGroups.forEach((group) => {
    group.cellKeys.forEach((key) => {
      const cell = cellsByKey.get(key);
      if (!cell) {
        return;
      }

      if (group.isEmpty) {
        cell.symbol = null;
        cell.dmc = null;
        cell.empty = true;
        return;
      }

      group.symbol = null;
      cell.symbol = group.symbol;
      cell.dmc = group.dmc;
      cell.empty = false;
    });
  });
}

async function slicePartImagesIntoCells() {
  const cellByKey = new Map(pattern.grid.cells.map((cell) => [`${cell.x},${cell.y}`, cell]));
  const previewBySignature = new Map();

  for (const part of pattern.parts) {
    const image = await loadImage(part.imageDataUrl);
    const cellWidth = image.naturalWidth / part.width;
    const cellHeight = image.naturalHeight / part.height;

    if (!Number.isFinite(cellWidth) || !Number.isFinite(cellHeight) || cellWidth <= 0 || cellHeight <= 0) {
      throw new Error(`Impossible de decouper ${part.name}.`);
    }

    for (let localY = 0; localY < part.height; localY += 1) {
      for (let localX = 0; localX < part.width; localX += 1) {
        const x = part.startX + localX;
        const y = part.startY + localY;
        const cell = cellByKey.get(`${x},${y}`);
        if (!cell) {
          throw new Error(`Cellule introuvable pour ${part.name} (${x}, ${y}).`);
        }

        const sample = sampleCellImage(
          image,
          localX * cellWidth,
          localY * cellHeight,
          cellWidth,
          cellHeight
        );

        cell.sampleSignature = sample.signature;
        cell.sampleMean = sample.mean;
        cell.sampleSource = "image-slice";

        if (!previewBySignature.has(sample.signature)) {
          previewBySignature.set(sample.signature, sample.previewDataUrl);
          cell.samplePreviewDataUrl = sample.previewDataUrl;
        } else {
          delete cell.samplePreviewDataUrl;
        }
      }
    }
  }
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Impossible de charger une image de morceau.")));
    image.src = dataUrl;
  });
}

function sampleCellImage(image, sx, sy, sw, sh) {
  const size = 8;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, sx, sy, sw, sh, 0, 0, size, size);
  const data = context.getImageData(0, 0, size, size).data;
  const grays = [];
  let red = 0;
  let green = 0;
  let blue = 0;

  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    red += r;
    green += g;
    blue += b;
    grays.push(Math.round((r * 0.299) + (g * 0.587) + (b * 0.114)));
  }

  const averageGray = grays.reduce((sum, value) => sum + value, 0) / grays.length;
  let bits = "";
  grays.forEach((gray) => {
    bits += gray >= averageGray ? "1" : "0";
  });

  let signature = "";
  for (let index = 0; index < bits.length; index += 4) {
    signature += parseInt(bits.slice(index, index + 4), 2).toString(16);
  }

  const pixelCount = grays.length;
  const mean = `#${toHex(red / pixelCount)}${toHex(green / pixelCount)}${toHex(blue / pixelCount)}`;
  return {
    signature,
    mean,
    previewDataUrl: createCellPreview(image, sx, sy, sw, sh)
  };
}

function toHex(value) {
  return Math.round(value).toString(16).padStart(2, "0").toUpperCase();
}

function createCellPreview(image, sx, sy, sw, sh) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.imageSmoothingEnabled = false;
  context.drawImage(image, sx, sy, sw, sh, 0, 0, size, size);
  return canvas.toDataURL("image/png");
}

function generateGridCells(patternToGenerate) {
  const cells = [];

  patternToGenerate.parts.forEach((part) => {
    for (let y = part.startY; y < part.startY + part.height; y += 1) {
      for (let x = part.startX; x < part.startX + part.width; x += 1) {
        cells.push({
          x,
          y,
          partId: part.id,
          symbol: null,
          dmc: null
        });
      }
    }
  });

  return cells.sort((a, b) => a.y - b.y || a.x - b.x);
}

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
    parts: false,
    grid: false,
    analysis: false,
    groups: false,
    assignments: false
  };
  assignmentGroupIndex = 0;
  render();
});

render();
