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
const jsonPreview = document.querySelector("#jsonPreview");
const saveStatus = document.querySelector("#saveStatus");
const resetButton = document.querySelector("#resetButton");

let pattern = loadPattern();

function loadPattern() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return structuredClone(defaultPattern);
  }

  try {
    return { ...structuredClone(defaultPattern), ...JSON.parse(stored) };
  } catch {
    return structuredClone(defaultPattern);
  }
}

function savePattern() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pattern, null, 2));
}

function render() {
  projectNameInput.value = pattern.project.name;
  jsonPreview.textContent = JSON.stringify(pattern, null, 2);
}

function showSavedStatus() {
  saveStatus.textContent = "Enregistre";
  window.setTimeout(() => {
    saveStatus.textContent = "Brouillon";
  }, 1400);
}

projectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  pattern.project.name = projectNameInput.value.trim();
  savePattern();
  render();
  showSavedStatus();
});

projectNameInput.addEventListener("input", () => {
  pattern.project.name = projectNameInput.value;
  render();
});

resetButton.addEventListener("click", () => {
  pattern = structuredClone(defaultPattern);
  localStorage.removeItem(STORAGE_KEY);
  render();
});

render();
