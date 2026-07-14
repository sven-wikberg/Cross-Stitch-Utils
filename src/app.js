const STORAGE_KEY = "cross-stitch-pattern-draft";

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
const colorSymbolInput = document.querySelector("#colorSymbol");
const dmcCodeInput = document.querySelector("#dmcCode");
const dmcNameInput = document.querySelector("#dmcName");
const colorsTableBody = document.querySelector("#colorsTableBody");
const emptyColorsMessage = document.querySelector("#emptyColorsMessage");
const colorsError = document.querySelector("#colorsError");
const backToProjectButton = document.querySelector("#backToProjectButton");
const validateColorsButton = document.querySelector("#validateColorsButton");
const stepButtons = document.querySelectorAll("[data-step]");
const panels = document.querySelectorAll("[data-panel]");
const stepEyebrow = document.querySelector("#stepEyebrow");
const stepTitle = document.querySelector("#step-title");
const jsonPreview = document.querySelector("#jsonPreview");
const saveStatus = document.querySelector("#saveStatus");
const resetButton = document.querySelector("#resetButton");

let pattern = loadPattern();
let activeStep = "project";

const stepLabels = {
  project: {
    eyebrow: "Etape 1",
    title: "Nom du projet"
  },
  colors: {
    eyebrow: "Etape 2",
    title: "Couleurs DMC"
  }
};

const stepOrder = ["project", "colors"];

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
      colors: Array.isArray(parsed.colors) ? parsed.colors : []
    };
  } catch {
    return structuredClone(defaultPattern);
  }
}

function savePattern() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pattern, null, 2));
}

function render() {
  if (!canOpenStep(activeStep)) {
    activeStep = firstOpenStep();
  }

  projectNameInput.value = pattern.project.name;
  jsonPreview.textContent = JSON.stringify(pattern, null, 2);
  renderStep();
  renderColors();
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
    return pattern.project.name.trim().length > 0;
  }

  if (step === "colors") {
    return pattern.colors.length > 0;
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
      <td><span class="symbol-cell"></span></td>
      <td></td>
      <td></td>
      <td class="row-actions">
        <button class="danger-button" type="button" data-remove-color="${index}" title="Supprimer">
          X
        </button>
      </td>
    `;

    row.querySelector(".symbol-cell").textContent = color.symbol;
    row.children[1].textContent = color.dmc;
    row.children[2].textContent = color.name || "-";
    colorsTableBody.appendChild(row);
  });
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
  savePattern();
  goToStep("colors");
  showSavedStatus();
});

projectNameInput.addEventListener("input", () => {
  pattern.project.name = projectNameInput.value;
  projectError.hidden = true;
  render();
});

colorForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const symbol = colorSymbolInput.value.trim();
  const dmc = dmcCodeInput.value.trim();
  const name = dmcNameInput.value.trim();

  if (!symbol || !dmc) {
    return;
  }

  pattern.colors.push({
    id: `dmc-${dmc}`,
    symbol,
    dmc,
    name
  });

  savePattern();
  colorsError.hidden = true;
  colorForm.reset();
  colorSymbolInput.focus();
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
  savePattern();
  render();
});

backToProjectButton.addEventListener("click", () => {
  goToStep("project");
});

validateColorsButton.addEventListener("click", () => {
  if (pattern.colors.length === 0) {
    colorsError.hidden = false;
    colorSymbolInput.focus();
    return;
  }

  colorsError.hidden = true;
  savePattern();
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
  render();
});

render();
