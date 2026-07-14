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
const islandPathButton = document.querySelector("#islandPathButton");
const backtrackIslandPathButton = document.querySelector("#backtrackIslandPathButton");
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
const ISLAND_GAP_TOLERANCE = 3;
const BACKTRACK_ISLAND_GAP_TOLERANCE = 1;
const BACKTRACK_MAX_STEP_DISTANCE = 1;
const BACKTRACK_MAX_VISITS = 45000;
const MAX_RESPONSIVE_CELL_SIZE = 18;
const GRID_RULER_SIZE = 26;

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
let isDrawingPath = false;
let lastDrawnCellKey = null;
let lastPointerCell = null;

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

  const cellSize = gridCellSize(
    loadedPattern.grid.width,
    loadedPattern.grid.height,
    availableGridWidth(patternCanvas) - GRID_RULER_SIZE
  );
  const selectedColor = colorByDmc.get(selectedDmc);
  selectedColorLabel.textContent = selectedColor
    ? `DMC ${selectedColor.dmc} - ${selectedColor.symbol || ""}`
    : "Aucune couleur selectionnee";
  patternCanvas.width = GRID_RULER_SIZE + loadedPattern.grid.width * cellSize;
  patternCanvas.height = GRID_RULER_SIZE + loadedPattern.grid.height * cellSize;
  context.clearRect(0, 0, patternCanvas.width, patternCanvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, patternCanvas.width, patternCanvas.height);

  loadedPattern.grid.cells.forEach((cell) => {
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
    drawGridLines(context, loadedPattern.grid.width, loadedPattern.grid.height, cellSize);
  }

  drawGridRulers(context, loadedPattern.grid.width, loadedPattern.grid.height, cellSize);
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
      const centerX = GRID_RULER_SIZE + (point.x + 0.5) * cellSize;
      const centerY = GRID_RULER_SIZE + (point.y + 0.5) * cellSize;
      if (index === 0) {
        context.moveTo(centerX, centerY);
      } else {
        context.lineTo(centerX, centerY);
      }
    });
    context.stroke();
  }

  path.forEach((point, index) => {
    const centerX = GRID_RULER_SIZE + (point.x + 0.5) * cellSize;
    const centerY = GRID_RULER_SIZE + (point.y + 0.5) * cellSize;
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
    islandPathButton.disabled = true;
    backtrackIslandPathButton.disabled = true;
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
  islandPathButton.disabled = expected === 0;
  backtrackIslandPathButton.disabled = expected === 0;
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
  return snakePathForCells(cellsForColor(dmc));
}

function snakePathForCells(cells) {
  const rows = new Map();
  cells.forEach((cell) => {
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

function islandSnakePathForColor(dmc) {
  const islands = islandsForCells(cellsForColor(dmc));
  const islandPaths = islands.map((island) => snakePathForCells(island));
  return orderIslandPaths(islandPaths).flat();
}

function backtrackIslandPathForColor(dmc) {
  const islands = islandsForCells(cellsForColor(dmc), BACKTRACK_ISLAND_GAP_TOLERANCE);
  const islandPaths = islands.map((island) => backtrackedPathForIsland(island));
  return orderIslandPaths(islandPaths).flat();
}

function backtrackedPathForIsland(island) {
  if (island.length <= 2) {
    return snakePathForCells(island);
  }

  const basePath = snakePathForCells(island);
  if (maxStepDistance(basePath) <= BACKTRACK_MAX_STEP_DISTANCE) {
    return basePath;
  }

  const starts = candidateStartPoints(island);
  let bestPath = basePath;
  let bestScore = pathJumpScore(basePath);
  let visits = 0;

  for (const start of starts) {
    const result = searchIslandPath(island, start, () => {
      visits += 1;
      return visits <= BACKTRACK_MAX_VISITS;
    });

    if (result.path && isBetterPathScore(result.score, bestScore)) {
      bestPath = result.path;
      bestScore = result.score;
    }

    if (bestScore.largeJumps === 0) {
      break;
    }
  }

  return bestPath;
}

function candidateStartPoints(island) {
  return island
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, 10);
}

function searchIslandPath(island, start, shouldContinue) {
  const cellsByKey = new Map(island.map((cell) => [cellKey(cell), cell]));
  const visited = new Set([cellKey(start)]);
  const path = [{ x: start.x, y: start.y }];
  let bestPath = path.slice();
  let bestScore = pathJumpScore(bestPath);

  function visit(current) {
    if (!shouldContinue()) {
      return false;
    }

    const score = pathJumpScore(path);
    if (score.largeJumps < bestScore.largeJumps || (score.largeJumps === bestScore.largeJumps && path.length > bestPath.length)) {
      bestPath = path.slice();
      bestScore = score;
    }

    if (path.length === island.length) {
      bestPath = path.slice();
      bestScore = pathJumpScore(path);
      return bestScore.largeJumps === 0;
    }

    const candidates = backtrackCandidates(current, cellsByKey, visited);
    for (const candidate of candidates) {
      visited.add(cellKey(candidate));
      path.push({ x: candidate.x, y: candidate.y });

      if (visit(candidate)) {
        return true;
      }

      path.pop();
      visited.delete(cellKey(candidate));
    }

    return false;
  }

  visit(start);
  const completedPath = completePathWithNearestRemainder(bestPath, island);
  return { path: completedPath, score: pathJumpScore(completedPath) };
}

function backtrackCandidates(current, cellsByKey, visited) {
  return Array.from(cellsByKey.values())
    .filter((cell) => !visited.has(cellKey(cell)))
    .map((cell) => ({
      cell,
      distance: pointDistance(current, cell),
      onward: onwardCandidateCount(cell, cellsByKey, visited)
    }))
    .filter((entry) => entry.distance <= BACKTRACK_MAX_STEP_DISTANCE)
    .sort((a, b) => a.onward - b.onward || a.distance - b.distance || a.cell.y - b.cell.y || a.cell.x - b.cell.x)
    .map((entry) => entry.cell);
}

function onwardCandidateCount(cell, cellsByKey, visited) {
  return Array.from(cellsByKey.values()).filter((candidate) => (
    !visited.has(cellKey(candidate)) && cellKey(candidate) !== cellKey(cell) && pointDistance(cell, candidate) <= BACKTRACK_MAX_STEP_DISTANCE
  )).length;
}

function completePathWithNearestRemainder(path, island) {
  const used = new Set(path.map(cellKey));
  const remaining = island
    .filter((cell) => !used.has(cellKey(cell)))
    .map((cell) => ({ x: cell.x, y: cell.y }));
  const completed = path.slice();

  while (remaining.length > 0) {
    const last = completed[completed.length - 1];
    const nextIndex = remaining.reduce((bestIndex, point, index) => {
      const bestPoint = remaining[bestIndex];
      return pointDistance(last, point) < pointDistance(last, bestPoint) ? index : bestIndex;
    }, 0);
    completed.push(remaining.splice(nextIndex, 1)[0]);
  }

  return completed;
}

function maxStepDistance(path) {
  return path.reduce((maxDistance, point, index) => {
    if (index === 0) {
      return maxDistance;
    }

    return Math.max(maxDistance, pointDistance(path[index - 1], point));
  }, 0);
}

function pathJumpScore(path) {
  let largeJumps = 0;
  let totalDistance = 0;

  path.forEach((point, index) => {
    if (index === 0) {
      return;
    }

    const distance = pointDistance(path[index - 1], point);
    totalDistance += distance;
    if (distance > BACKTRACK_MAX_STEP_DISTANCE) {
      largeJumps += 1;
    }
  });

  return { largeJumps, totalDistance };
}

function isBetterPathScore(candidate, current) {
  return candidate.largeJumps < current.largeJumps
    || (candidate.largeJumps === current.largeJumps && candidate.totalDistance < current.totalDistance);
}

function islandsForCells(cells, gapTolerance = ISLAND_GAP_TOLERANCE) {
  const remaining = new Map(cells.map((cell) => [cellKey(cell), cell]));
  const islands = [];

  while (remaining.size > 0) {
    const start = remaining.values().next().value;
    const island = [];
    const queue = [start];
    remaining.delete(cellKey(start));

    while (queue.length > 0) {
      const current = queue.shift();
      island.push(current);

      Array.from(remaining.values()).forEach((candidate) => {
        if (belongsToSameIsland(current, candidate, gapTolerance)) {
          remaining.delete(cellKey(candidate));
          queue.push(candidate);
        }
      });
    }

    islands.push(island);
  }

  return islands.sort((a, b) => islandSortValue(a).y - islandSortValue(b).y || islandSortValue(a).x - islandSortValue(b).x);
}

function belongsToSameIsland(a, b, gapTolerance) {
  const horizontalGap = Math.max(Math.abs(a.x - b.x) - 1, 0);
  const verticalGap = Math.max(Math.abs(a.y - b.y) - 1, 0);
  return Math.max(horizontalGap, verticalGap) <= gapTolerance;
}

function islandSortValue(island) {
  return island.reduce((topLeft, cell) => {
    if (cell.y < topLeft.y || (cell.y === topLeft.y && cell.x < topLeft.x)) {
      return cell;
    }

    return topLeft;
  }, island[0]);
}

function orderIslandPaths(paths) {
  const remaining = paths.filter((path) => path.length > 0);
  const ordered = [];
  let lastPoint = null;

  while (remaining.length > 0) {
    const next = nearestIslandPath(remaining, lastPoint);
    remaining.splice(next.index, 1);
    ordered.push(next.path);
    lastPoint = next.path[next.path.length - 1];
  }

  return ordered;
}

function nearestIslandPath(paths, lastPoint) {
  if (!lastPoint) {
    return { index: 0, path: paths[0] };
  }

  return paths.reduce((best, path, index) => {
    const normalDistance = pointDistance(lastPoint, path[0]);
    const reversedDistance = pointDistance(lastPoint, path[path.length - 1]);
    const shouldReverse = reversedDistance < normalDistance;
    const distance = shouldReverse ? reversedDistance : normalDistance;

    if (!best || distance < best.distance) {
      return {
        index,
        distance,
        path: shouldReverse ? path.slice().reverse() : path
      };
    }

    return best;
  }, null);
}

function pointDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
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

  const cellSize = (patternCanvas.width - GRID_RULER_SIZE) / loadedPattern.grid.width;
  const rect = patternCanvas.getBoundingClientRect();
  const scaleX = patternCanvas.width / rect.width;
  const scaleY = patternCanvas.height / rect.height;
  const canvasX = (event.clientX - rect.left) * scaleX - GRID_RULER_SIZE;
  const canvasY = (event.clientY - rect.top) * scaleY - GRID_RULER_SIZE;
  const x = Math.floor(canvasX / cellSize);
  const y = Math.floor(canvasY / cellSize);
  return findCellAt(x, y);
}

function addCellToCurrentPath(cell) {
  if (!loadedPattern || !selectedDmc || !cell || cell.empty || cell.dmc !== selectedDmc) {
    return false;
  }

  const key = cellKey(cell);
  if (key === lastDrawnCellKey) {
    return false;
  }

  const path = currentPath();
  const alreadySelected = path.some((point) => cellKey(point) === key);
  if (alreadySelected) {
    lastDrawnCellKey = key;
    return false;
  }

  path.push({ x: cell.x, y: cell.y });
  lastDrawnCellKey = key;
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

patternCanvas.addEventListener("pointerdown", (event) => {
  if (!loadedPattern || !selectedDmc) {
    return;
  }

  event.preventDefault();
  isDrawingPath = true;
  lastDrawnCellKey = null;
  lastPointerCell = cellFromCanvasEvent(event);
  patternCanvas.setPointerCapture(event.pointerId);
  addCellsToCurrentPath([lastPointerCell]);
});

patternCanvas.addEventListener("pointermove", (event) => {
  if (!isDrawingPath) {
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
  isDrawingPath = false;
  lastDrawnCellKey = null;
  lastPointerCell = null;
  if (patternCanvas.hasPointerCapture(event.pointerId)) {
    patternCanvas.releasePointerCapture(event.pointerId);
  }
});

patternCanvas.addEventListener("pointercancel", () => {
  isDrawingPath = false;
  lastDrawnCellKey = null;
  lastPointerCell = null;
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

islandPathButton.addEventListener("click", () => {
  if (!loadedPattern || !selectedDmc) {
    return;
  }

  pathsByDmc[selectedDmc] = islandSnakePathForColor(selectedDmc);
  pathProgress.paths = areAllColorPathsComplete(loadedPattern, pathsByDmc);
  pathProgress.export = false;
  savePathPlannerState();
  renderPathTool();
  showPathSavedStatus();
});

backtrackIslandPathButton.addEventListener("click", () => {
  if (!loadedPattern || !selectedDmc) {
    return;
  }

  pathsByDmc[selectedDmc] = backtrackIslandPathForColor(selectedDmc);
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
