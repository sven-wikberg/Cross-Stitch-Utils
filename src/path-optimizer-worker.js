(function (root) {
  "use strict";

  function createPathOptimizerApi() {
    const EPSILON = 0.0001;
    const CANDIDATE_COUNT = 32;
    const PROGRESS_INTERVAL = 180;

    function optimizePath(options) {
      const points = Array.isArray(options.points)
        ? options.points.map((point) => ({ x: point.x, y: point.y }))
        : [];
      const pointCount = points.length;
      const cutThreshold = Math.max(1, Number(options.cutThreshold) || 15);
      const cutPenalty = cutThreshold * 3;
      const timeLimitMs = Math.max(1000, Number(options.timeLimitMs) || 120000);
      const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
      const startedAt = now();
      const deadline = startedAt + timeLimitMs;
      const random = createRandom(hashPoints(points));
      let evaluations = 0;
      let restarts = 0;
      let improvements = 0;
      let passes = 0;
      let lastImprovementAt = startedAt;
      let lastProgressAt = 0;
      let bestRoute = [];
      let bestMetrics = emptyMetrics();
      let initialMetrics = emptyMetrics();

      if (pointCount <= 1) {
        const route = pointCount === 1 ? [0] : [];
        const metrics = metricsForRoute(route, null, pointCount, cutThreshold, cutPenalty);
        return {
          route,
          metrics,
          initialMetrics: metrics,
          evaluations,
          restarts,
          improvements,
          elapsedMs: now() - startedAt
        };
      }

      reportSetup("Calcul des distances", 1);
      const distances = buildDistanceMatrix(points, (row) => {
        if (row % 80 === 0) {
          reportSetup("Calcul des distances", 1 + (row / pointCount) * 8);
        }
      });
      const candidateLists = buildCandidateLists(points, distances, CANDIDATE_COUNT, (row) => {
        if (row % 80 === 0) {
          reportSetup("Voisinages", 9 + (row / pointCount) * 8);
        }
      });

      const edgeValues = (first, second) => {
        if (first === null || second === null || first === undefined || second === undefined) {
          return { score: 0, distance: 0, cuts: 0 };
        }

        const distance = distances[first * pointCount + second];
        const cut = distance > cutThreshold;
        return {
          score: cut ? cutPenalty : distance,
          distance,
          cuts: cut ? 1 : 0
        };
      };

      const routeMetrics = (route) => metricsForRoute(
        route,
        distances,
        pointCount,
        cutThreshold,
        cutPenalty
      );

      const seeds = buildSeedRoutes(points, candidateLists, distances, options.initialPath, random);
      const rankedSeeds = seeds
        .filter((route) => isCompleteRoute(route, pointCount))
        .map((route) => ({ route, metrics: routeMetrics(route) }))
        .sort((first, second) => compareMetrics(first.metrics, second.metrics));

      if (rankedSeeds.length === 0) {
        throw new Error("Aucun chemin initial valide n'a pu etre construit.");
      }

      bestRoute = rankedSeeds[0].route.slice();
      bestMetrics = rankedSeeds[0].metrics;
      initialMetrics = { ...bestMetrics };
      lastImprovementAt = now();
      emitProgress("Meilleur point de depart", true);

      const consider = (route, phase) => {
        if (!isCompleteRoute(route, pointCount)) {
          throw new Error(`Chemin invalide apres: ${phase}.`);
        }

        const metrics = routeMetrics(route);
        if (compareMetrics(metrics, bestMetrics) < 0) {
          bestRoute = route.slice();
          bestMetrics = metrics;
          improvements += 1;
          lastImprovementAt = now();
          emitProgress(phase, true);
          return true;
        }

        emitProgress(phase, false);
        return false;
      };

      const localSearch = (sourceRoute, phase, maxPasses = 12) => {
        let route = sourceRoute.slice();
        let routeChanged = true;
        let localPass = 0;

        const reconnected = reconnectCutChains(route, edgeValues, routeMetrics, random);
        if (compareMetrics(routeMetrics(reconnected), routeMetrics(route)) < 0) {
          route = reconnected;
          consider(route, `${phase} - chaines reconnectees`);
        }

        while (routeChanged && localPass < maxPasses && !expired()) {
          routeChanged = false;
          localPass += 1;
          passes += 1;

          if (improveEndpoints(route, edgeValues)) {
            routeChanged = true;
            consider(route, `${phase} - extremites`);
          }

          if (twoOptPass(route, candidateLists, edgeValues)) {
            routeChanged = true;
            consider(route, `${phase} - 2-opt`);
          }

          if (!expired() && relocatePass(route, candidateLists, edgeValues)) {
            routeChanged = true;
            consider(route, `${phase} - deplacements`);
          }

          if (!expired() && localPass % 3 === 0) {
            const chainCandidate = reconnectCutChains(route, edgeValues, routeMetrics, random);
            if (compareMetrics(routeMetrics(chainCandidate), routeMetrics(route)) < 0) {
              route = chainCandidate;
              routeChanged = true;
              consider(route, `${phase} - coupes`);
            }
          }

          emitProgress(`${phase} - passe ${localPass}`, false);
        }

        return route;
      };

      const firstSearch = localSearch(bestRoute, "Recherche locale", 18);
      consider(firstSearch, "Premier optimum local");

      let seedCursor = 1;
      while (!expired()) {
        restarts += 1;
        const baseRoute = restarts % 5 === 0 && rankedSeeds.length > 1
          ? rankedSeeds[seedCursor++ % rankedSeeds.length].route
          : bestRoute;
        const strength = 2 + (restarts % 5);
        const perturbed = perturbRoute(baseRoute, random, strength);
        const candidate = localSearch(perturbed, `Relance ${restarts}`, 8 + strength);
        consider(candidate, `Relance ${restarts} terminee`);
      }

      emitProgress("Recherche terminee", true, 100);
      return {
        route: bestRoute.slice(),
        metrics: { ...bestMetrics },
        initialMetrics: { ...initialMetrics },
        evaluations,
        restarts,
        improvements,
        passes,
        elapsedMs: now() - startedAt
      };

      function twoOptPass(route, lists, getEdgeValues) {
        const positions = buildPositions(route, pointCount);
        let changed = false;
        let accepted = 0;

        for (let firstEdge = 0; firstEdge < route.length - 2 && !expired(); firstEdge += 1) {
          const first = route[firstEdge];
          const second = route[firstEdge + 1];
          const candidates = lists[first];

          for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
            evaluations += 1;
            const candidatePoint = candidates[candidateIndex];
            const otherEdge = positions[candidatePoint];
            if (otherEdge < 0 || otherEdge >= route.length - 1 || Math.abs(otherEdge - firstEdge) <= 1) {
              continue;
            }

            const left = Math.min(firstEdge, otherEdge);
            const right = Math.max(firstEdge, otherEdge);
            const a = route[left];
            const b = route[left + 1];
            const c = route[right];
            const d = route[right + 1];
            const delta = replacementDelta(
              [getEdgeValues(a, b), getEdgeValues(c, d)],
              [getEdgeValues(a, c), getEdgeValues(b, d)]
            );

            if (!isImprovingDelta(delta)) {
              continue;
            }

            reverseRange(route, left + 1, right, positions);
            changed = true;
            accepted += 1;
            if (accepted >= route.length * 3) {
              return changed;
            }
          }
        }

        return changed;
      }

      function improveEndpoints(route, getEdgeValues) {
        let changed = false;
        let moves = 0;

        while (moves < 8 && !expired()) {
          let bestMove = null;

          for (let end = 1; end < route.length - 1; end += 1) {
            evaluations += 2;
            const prefixDelta = replacementDelta(
              [getEdgeValues(route[end], route[end + 1])],
              [getEdgeValues(route[0], route[end + 1])]
            );
            if (isImprovingDelta(prefixDelta) && (!bestMove || compareDelta(prefixDelta, bestMove.delta) < 0)) {
              bestMove = { type: "prefix", end, delta: prefixDelta };
            }

            const suffixDelta = replacementDelta(
              [getEdgeValues(route[end - 1], route[end])],
              [getEdgeValues(route[end - 1], route[route.length - 1])]
            );
            if (isImprovingDelta(suffixDelta) && (!bestMove || compareDelta(suffixDelta, bestMove.delta) < 0)) {
              bestMove = { type: "suffix", start: end, delta: suffixDelta };
            }
          }

          if (!bestMove) {
            break;
          }

          if (bestMove.type === "prefix") {
            reverseSimple(route, 0, bestMove.end);
          } else {
            reverseSimple(route, bestMove.start, route.length - 1);
          }
          changed = true;
          moves += 1;
        }

        return changed;
      }

      function relocatePass(route, lists, getEdgeValues) {
        let changed = false;
        let accepted = 0;

        while (accepted < 32 && !expired()) {
          const positions = buildPositions(route, pointCount);
          let bestMove = null;

          searchMoves:
          for (let blockLength = 1; blockLength <= 3; blockLength += 1) {
            for (let start = 0; start <= route.length - blockLength; start += 1) {
              const block = route.slice(start, start + blockLength);
              const blockSet = new Set(block);
              const previous = start > 0 ? route[start - 1] : null;
              const next = start + blockLength < route.length ? route[start + blockLength] : null;
              const targets = Array.from(new Set(lists[block[0]].concat(lists[block[block.length - 1]])));

              for (const target of targets) {
                const targetPosition = positions[target];
                for (const edgeIndex of [targetPosition - 1, targetPosition]) {
                  if (edgeIndex < -1 || edgeIndex >= route.length) {
                    continue;
                  }

                  const targetBefore = edgeIndex >= 0 ? route[edgeIndex] : null;
                  const targetAfter = edgeIndex + 1 < route.length ? route[edgeIndex + 1] : null;
                  if (blockSet.has(targetBefore) || blockSet.has(targetAfter)) {
                    continue;
                  }

                  const orientations = blockLength === 1 ? [false] : [false, true];
                  for (const reverse of orientations) {
                    evaluations += 1;
                    const newStart = reverse ? block[block.length - 1] : block[0];
                    const newEnd = reverse ? block[0] : block[block.length - 1];
                    const delta = replacementDelta(
                      [
                        getEdgeValues(previous, block[0]),
                        getEdgeValues(block[block.length - 1], next),
                        getEdgeValues(targetBefore, targetAfter)
                      ],
                      [
                        getEdgeValues(previous, next),
                        getEdgeValues(targetBefore, newStart),
                        getEdgeValues(newEnd, targetAfter)
                      ]
                    );
                    if (isImprovingDelta(delta)) {
                      bestMove = { block, blockSet, targetBefore, reverse };
                      break searchMoves;
                    }
                  }
                }
              }
            }
          }

          if (!bestMove) {
            break;
          }

          const updatedRoute = route.filter((point) => !bestMove.blockSet.has(point));
          const targetBeforeIndex = bestMove.targetBefore === null
            ? -1
            : updatedRoute.indexOf(bestMove.targetBefore);
          if (bestMove.targetBefore !== null && targetBeforeIndex < 0) {
            break;
          }
          const movedBlock = bestMove.reverse ? bestMove.block.slice().reverse() : bestMove.block.slice();
          updatedRoute.splice(targetBeforeIndex + 1, 0, ...movedBlock);
          route.splice(0, route.length, ...updatedRoute);
          changed = true;
          accepted += 1;
        }

        return changed;
      }

      function expired() {
        return now() >= deadline;
      }

      function reportSetup(phase, progress) {
        const current = now();
        if (current - lastProgressAt < PROGRESS_INTERVAL && progress < 100) {
          return;
        }

        lastProgressAt = current;
        onProgress({
          phase,
          progress: Math.max(0, Math.min(100, progress)),
          elapsedMs: current - startedAt,
          timeLimitMs,
          evaluations,
          restarts,
          improvements,
          passes,
          lastImprovementMs: current - lastImprovementAt,
          route: bestRoute.length ? bestRoute.slice() : null,
          metrics: bestRoute.length ? { ...bestMetrics } : null,
          initialMetrics: bestRoute.length ? { ...initialMetrics } : null
        });
      }

      function emitProgress(phase, force = false, forcedProgress = null) {
        const current = now();
        if (!force && current - lastProgressAt < PROGRESS_INTERVAL) {
          return;
        }

        lastProgressAt = current;
        const elapsedMs = current - startedAt;
        onProgress({
          phase,
          progress: forcedProgress === null ? Math.min(99, (elapsedMs / timeLimitMs) * 100) : forcedProgress,
          elapsedMs,
          timeLimitMs,
          evaluations,
          restarts,
          improvements,
          passes,
          lastImprovementMs: current - lastImprovementAt,
          route: bestRoute.slice(),
          metrics: { ...bestMetrics },
          initialMetrics: { ...initialMetrics }
        });
      }
    }

    function buildDistanceMatrix(points, onRow) {
      const count = points.length;
      const distances = new Float32Array(count * count);
      for (let first = 0; first < count; first += 1) {
        onRow(first);
        for (let second = first + 1; second < count; second += 1) {
          const distance = Math.hypot(
            points[first].x - points[second].x,
            points[first].y - points[second].y
          );
          distances[first * count + second] = distance;
          distances[second * count + first] = distance;
        }
      }
      return distances;
    }

    function buildCandidateLists(points, distances, limit, onRow) {
      const count = points.length;
      const coordinateIndex = new Map(points.map((point, index) => [`${point.x},${point.y}`, index]));
      const maxX = Math.max(...points.map((point) => point.x));
      const maxY = Math.max(...points.map((point) => point.y));
      const maxRadius = Math.max(maxX, maxY) + 1;
      const lists = new Array(count);

      for (let index = 0; index < count; index += 1) {
        onRow(index);
        const point = points[index];
        const nearby = [];
        let radius = 1;
        let farthestKept = Number.POSITIVE_INFINITY;

        while (radius <= maxRadius && (nearby.length < limit || radius <= farthestKept)) {
          for (let x = point.x - radius; x <= point.x + radius; x += 1) {
            addCoordinate(x, point.y - radius);
            addCoordinate(x, point.y + radius);
          }
          for (let y = point.y - radius + 1; y < point.y + radius; y += 1) {
            addCoordinate(point.x - radius, y);
            addCoordinate(point.x + radius, y);
          }

          if (nearby.length >= limit) {
            nearby.sort((first, second) => first.distance - second.distance || first.index - second.index);
            farthestKept = nearby[Math.min(limit, nearby.length) - 1].distance;
          }
          radius += 1;
        }

        lists[index] = nearby
          .sort((first, second) => first.distance - second.distance || first.index - second.index)
          .slice(0, limit)
          .map((entry) => entry.index);

        function addCoordinate(x, y) {
          const candidate = coordinateIndex.get(`${x},${y}`);
          if (candidate === undefined || candidate === index) {
            return;
          }
          nearby.push({ index: candidate, distance: distances[index * count + candidate] });
        }
      }

      return lists;
    }

    function buildSeedRoutes(points, candidateLists, distances, initialPath, random) {
      const count = points.length;
      const seeds = [];
      const coordinateIndex = new Map(points.map((point, index) => [`${point.x},${point.y}`, index]));
      const initialRoute = Array.isArray(initialPath)
        ? initialPath.map((point) => coordinateIndex.get(`${point.x},${point.y}`))
        : [];
      if (isCompleteRoute(initialRoute, count)) {
        seeds.push(initialRoute);
      }

      seeds.push(snakeSeed(points, false));
      seeds.push(snakeSeed(points, true));
      seeds.push(mortonSeed(points));
      seeds.push(componentSeed(points, candidateLists, distances));

      const starts = seedStartPoints(points, random);
      starts.forEach((start, index) => {
        seeds.push(nearestNeighborSeed(start, count, candidateLists, distances, random, index % 3 === 0 ? 3 : 1));
      });

      const unique = new Map();
      seeds.forEach((route) => {
        if (isCompleteRoute(route, count)) {
          unique.set(route.join(","), route);
        }
      });
      return Array.from(unique.values());
    }

    function snakeSeed(points, byColumn) {
      return points
        .map((point, index) => ({ ...point, index }))
        .sort((first, second) => {
          if (byColumn) {
            return first.x - second.x || (first.x % 2 === 0 ? first.y - second.y : second.y - first.y);
          }
          return first.y - second.y || (first.y % 2 === 0 ? first.x - second.x : second.x - first.x);
        })
        .map((point) => point.index);
    }

    function mortonSeed(points) {
      return points
        .map((point, index) => ({ index, value: mortonCode(point.x, point.y) }))
        .sort((first, second) => first.value - second.value || first.index - second.index)
        .map((entry) => entry.index);
    }

    function mortonCode(x, y) {
      let value = 0;
      for (let bit = 0; bit < 16; bit += 1) {
        value |= ((x >> bit) & 1) << (bit * 2);
        value |= ((y >> bit) & 1) << (bit * 2 + 1);
      }
      return value >>> 0;
    }

    function componentSeed(points, candidateLists, distances) {
      const coordinateIndex = new Map(points.map((point, index) => [`${point.x},${point.y}`, index]));
      const remaining = new Set(points.map((_, index) => index));
      const components = [];

      while (remaining.size > 0) {
        const start = remaining.values().next().value;
        const queue = [start];
        const component = [];
        remaining.delete(start);

        while (queue.length > 0) {
          const current = queue.shift();
          component.push(current);
          const point = points[current];
          for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
            for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
              if (offsetX === 0 && offsetY === 0) {
                continue;
              }
              const neighbor = coordinateIndex.get(`${point.x + offsetX},${point.y + offsetY}`);
              if (neighbor !== undefined && remaining.delete(neighbor)) {
                queue.push(neighbor);
              }
            }
          }
        }

        const allowed = new Set(component);
        const route = nearestNeighborSeed(component[0], points.length, candidateLists, distances, () => 0, 1, allowed);
        components.push(route);
      }

      components.sort((first, second) => second.length - first.length);
      let route = components.shift() || [];
      while (components.length > 0) {
        const end = route[route.length - 1];
        let best = null;
        components.forEach((component, index) => {
          const normalDistance = distances[end * points.length + component[0]];
          const reverseDistance = distances[end * points.length + component[component.length - 1]];
          const candidate = reverseDistance < normalDistance
            ? { index, reverse: true, distance: reverseDistance }
            : { index, reverse: false, distance: normalDistance };
          if (!best || candidate.distance < best.distance) {
            best = candidate;
          }
        });
        const next = components.splice(best.index, 1)[0];
        route = route.concat(best.reverse ? next.slice().reverse() : next);
      }
      return route;
    }

    function seedStartPoints(points, random) {
      const indexed = points.map((point, index) => ({ ...point, index }));
      const starts = [
        indexed.reduce((best, point) => point.x + point.y < best.x + best.y ? point : best),
        indexed.reduce((best, point) => point.x + point.y > best.x + best.y ? point : best),
        indexed.reduce((best, point) => point.x - point.y < best.x - best.y ? point : best),
        indexed.reduce((best, point) => point.x - point.y > best.x - best.y ? point : best)
      ].map((point) => point.index);

      while (starts.length < 10) {
        starts.push(Math.floor(random() * points.length));
      }
      return Array.from(new Set(starts));
    }

    function nearestNeighborSeed(start, count, candidateLists, distances, random, randomWidth = 1, allowed = null) {
      const remaining = new Uint8Array(count);
      let remainingCount = 0;
      for (let index = 0; index < count; index += 1) {
        if (!allowed || allowed.has(index)) {
          remaining[index] = 1;
          remainingCount += 1;
        }
      }

      if (!remaining[start]) {
        start = allowed ? allowed.values().next().value : 0;
      }
      const route = [];
      let current = start;

      while (remainingCount > 0) {
        route.push(current);
        remaining[current] = 0;
        remainingCount -= 1;
        if (remainingCount === 0) {
          break;
        }

        const nearby = candidateLists[current].filter((candidate) => remaining[candidate]);
        if (nearby.length > 0) {
          current = nearby[Math.floor(random() * Math.min(randomWidth, nearby.length))];
          continue;
        }

        const fallback = [];
        for (let candidate = 0; candidate < count; candidate += 1) {
          if (remaining[candidate]) {
            fallback.push({ candidate, distance: distances[current * count + candidate] });
          }
        }
        fallback.sort((first, second) => first.distance - second.distance || first.candidate - second.candidate);
        current = fallback[Math.floor(random() * Math.min(randomWidth, fallback.length))].candidate;
      }

      return route;
    }

    function reconnectCutChains(route, getEdgeValues, getMetrics, random) {
      const chains = [];
      let current = [route[0]];
      for (let index = 1; index < route.length; index += 1) {
        if (getEdgeValues(route[index - 1], route[index]).cuts > 0) {
          chains.push(current);
          current = [];
        }
        current.push(route[index]);
      }
      chains.push(current);

      if (chains.length <= 1) {
        return route.slice();
      }

      const startCandidates = chains
        .map((chain, index) => ({ index, length: chain.length }))
        .sort((first, second) => second.length - first.length)
        .slice(0, Math.min(8, chains.length));
      let bestRoute = route.slice();
      let bestMetrics = getMetrics(bestRoute);

      startCandidates.forEach(({ index: startIndex }) => {
        [false, true].forEach((reverseStart) => {
          const remaining = chains.map((chain) => chain.slice());
          let candidateRoute = remaining.splice(startIndex, 1)[0];
          if (reverseStart) {
            candidateRoute.reverse();
          }

          while (remaining.length > 0) {
            const end = candidateRoute[candidateRoute.length - 1];
            let bestConnection = null;
            remaining.forEach((chain, chainIndex) => {
              [false, true].forEach((reverse) => {
                const start = reverse ? chain[chain.length - 1] : chain[0];
                const values = getEdgeValues(end, start);
                const candidate = { chainIndex, reverse, values };
                if (!bestConnection || compareEdgeValues(values, bestConnection.values) < 0) {
                  bestConnection = candidate;
                }
              });
            });

            const next = remaining.splice(bestConnection.chainIndex, 1)[0];
            candidateRoute = candidateRoute.concat(bestConnection.reverse ? next.reverse() : next);
          }

          const metrics = getMetrics(candidateRoute);
          if (compareMetrics(metrics, bestMetrics) < 0) {
            bestRoute = candidateRoute;
            bestMetrics = metrics;
          }
        });
      });

      return bestRoute;
    }

    function perturbRoute(route, random, strength) {
      const result = route.slice();
      if (result.length < 6) {
        return result.reverse();
      }

      for (let move = 0; move < strength; move += 1) {
        if (random() < 0.55) {
          const first = 1 + Math.floor(random() * Math.max(1, result.length - 4));
          const second = first + 1 + Math.floor(random() * Math.max(1, result.length - first - 2));
          reverseSimple(result, first, Math.min(result.length - 2, second));
          continue;
        }

        const blockLength = 1 + Math.floor(random() * Math.min(12, result.length - 3));
        const start = Math.floor(random() * (result.length - blockLength));
        const block = result.splice(start, blockLength);
        if (random() < 0.5) {
          block.reverse();
        }
        const insertion = Math.floor(random() * (result.length + 1));
        result.splice(insertion, 0, ...block);
      }
      return result;
    }

    function metricsForRoute(route, distances, count, cutThreshold, cutPenalty) {
      let score = 0;
      let distance = 0;
      let cuts = 0;
      for (let index = 1; index < route.length; index += 1) {
        const jump = distances
          ? distances[route[index - 1] * count + route[index]]
          : 0;
        distance += jump;
        if (jump > cutThreshold) {
          cuts += 1;
          score += cutPenalty;
        } else {
          score += jump;
        }
      }
      return { score, distance, cuts };
    }

    function emptyMetrics() {
      return { score: Number.POSITIVE_INFINITY, distance: Number.POSITIVE_INFINITY, cuts: 0 };
    }

    function compareMetrics(first, second) {
      if (Math.abs(first.score - second.score) > EPSILON) {
        return first.score - second.score;
      }
      if (first.cuts !== second.cuts) {
        return first.cuts - second.cuts;
      }
      return first.distance - second.distance;
    }

    function compareEdgeValues(first, second) {
      if (Math.abs(first.score - second.score) > EPSILON) {
        return first.score - second.score;
      }
      if (first.cuts !== second.cuts) {
        return first.cuts - second.cuts;
      }
      return first.distance - second.distance;
    }

    function replacementDelta(removed, added) {
      const delta = { score: 0, distance: 0, cuts: 0 };
      removed.forEach((values) => {
        delta.score -= values.score;
        delta.distance -= values.distance;
        delta.cuts -= values.cuts;
      });
      added.forEach((values) => {
        delta.score += values.score;
        delta.distance += values.distance;
        delta.cuts += values.cuts;
      });
      return delta;
    }

    function isImprovingDelta(delta) {
      return delta.score < -EPSILON
        || (Math.abs(delta.score) <= EPSILON && (
          delta.cuts < 0
          || (delta.cuts === 0 && delta.distance < -EPSILON)
        ));
    }

    function compareDelta(first, second) {
      if (Math.abs(first.score - second.score) > EPSILON) {
        return first.score - second.score;
      }
      if (first.cuts !== second.cuts) {
        return first.cuts - second.cuts;
      }
      return first.distance - second.distance;
    }

    function buildPositions(route, pointCount) {
      const positions = new Int32Array(pointCount);
      positions.fill(-1);
      route.forEach((point, index) => {
        positions[point] = index;
      });
      return positions;
    }

    function reverseRange(route, start, end, positions) {
      while (start < end) {
        const value = route[start];
        route[start] = route[end];
        route[end] = value;
        positions[route[start]] = start;
        positions[route[end]] = end;
        start += 1;
        end -= 1;
      }
      if (start === end) {
        positions[route[start]] = start;
      }
    }

    function reverseSimple(route, start, end) {
      while (start < end) {
        const value = route[start];
        route[start] = route[end];
        route[end] = value;
        start += 1;
        end -= 1;
      }
    }

    function isCompleteRoute(route, pointCount) {
      return Array.isArray(route)
        && route.length === pointCount
        && new Set(route).size === pointCount
        && route.every((point) => Number.isInteger(point) && point >= 0 && point < pointCount);
    }

    function createRandom(seed) {
      let state = seed || 0x9e3779b9;
      return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 4294967296;
      };
    }

    function hashPoints(points) {
      let hash = 2166136261;
      points.forEach((point) => {
        hash ^= point.x + point.y * 257;
        hash = Math.imul(hash, 16777619);
      });
      return hash >>> 0;
    }

    function now() {
      return typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
    }

    return { optimizePath };
  }

  function pathOptimizerWorkerMain() {
    const optimizer = createPathOptimizerApi();
    self.onmessage = (event) => {
      if (!event.data || event.data.type !== "start") {
        return;
      }

      const { runId, points, initialPath, cutThreshold, timeLimitMs } = event.data;
      try {
        const result = optimizer.optimizePath({
          points,
          initialPath,
          cutThreshold,
          timeLimitMs,
          onProgress(snapshot) {
            self.postMessage({
              type: "progress",
              runId,
              ...snapshot,
              path: snapshot.route ? snapshot.route.map((index) => points[index]) : null
            });
          }
        });

        self.postMessage({
          type: "complete",
          runId,
          ...result,
          path: result.route.map((index) => points[index])
        });
      } catch (error) {
        self.postMessage({
          type: "error",
          runId,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    };
  }

  function createPathOptimizerWorker() {
    if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
      return null;
    }

    const source = createPathOptimizerWorkerSource();
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return worker;
  }

  function createPathOptimizerWorkerSource() {
    return `const createPathOptimizerApi = ${createPathOptimizerApi.toString()};\n(${pathOptimizerWorkerMain.toString()})();`;
  }

  root.createPathOptimizerWorker = createPathOptimizerWorker;
  root.createPathOptimizerApi = createPathOptimizerApi;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createPathOptimizerApi, createPathOptimizerWorkerSource };
  }
})(typeof window !== "undefined" ? window : globalThis);
