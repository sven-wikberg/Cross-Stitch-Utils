(function (root) {
  "use strict";
  function createOrthogonalPathBuilder(model, clock = () => performance.now()) {
    const sides = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    const proximity = [...sides, ...corners, [2, 0], [-2, 0], [0, 2], [0, -2]];
    const action = (cell, diagonal) => ({ x: cell.x, y: cell.y, diagonal, direction: 1 });
    function components(cells, offsets) {
      const remaining = new Map(cells.map(cell => [model.cellKey(cell), cell])), groups = [];
      for (const start of cells) {
        if (!remaining.delete(model.cellKey(start))) continue;
        const group = [], stack = [start];
        while (stack.length) {
          const cell = stack.pop(); group.push(cell);
          for (const [dx, dy] of offsets) {
            const key = `${cell.x + dx},${cell.y + dy}`, next = remaining.get(key);
            if (next) { remaining.delete(key); stack.push(next); }
          }
        }
        groups.push(group);
      }
      return groups;
    }
    const orthogonalComponents = cells => components(cells, sides);
    const proximityComponents = cells => components(cells, proximity);
    const blockContexts = new WeakMap();
    function blockContext(cells) {
      if (blockContexts.has(cells)) return blockContexts.get(cells);
      const groups = orthogonalComponents(cells), owners = new Map(), neighbors = groups.map(() => new Map());
      groups.forEach((group, id) => group.forEach(cell => owners.set(model.cellKey(cell), id)));
      for (let id = 0; id < groups.length; id++) for (const cell of groups[id]) for (const [dx, dy] of proximity) {
        const other = { x: cell.x + dx, y: cell.y + dy }, to = owners.get(model.cellKey(other));
        if (to === undefined || to === id) continue;
        if (!neighbors[id].has(to)) neighbors[id].set(to, []);
        neighbors[id].get(to).push({ from: cell, to: other });
      }
      const result = { groups, owners, neighbors };
      blockContexts.set(cells, result); return result;
    }
    function buildSequence(cells, entry, exit = entry) {
      const available = new Map(cells.map(cell => [model.cellKey(cell), cell]));
      const entryKey = model.cellKey(entry), exitKey = model.cellKey(exit);
      if (!available.has(entryKey) || !available.has(exitKey)) return null;
      const parents = new Map([[entryKey, null]]), queue = [entry];
      for (let i = 0; i < queue.length && !parents.has(exitKey); i++) {
        const cell = queue[i];
        for (const [dx, dy] of corners) {
          const key = `${cell.x + dx},${cell.y + dy}`;
          if (available.has(key) && !parents.has(key)) {
            parents.set(key, model.cellKey(cell)); queue.push(available.get(key));
          }
        }
      }
      if (!parents.has(exitKey)) return null;
      const spine = [];
      for (let key = exitKey; key !== null; key = parents.get(key)) spine.push(available.get(key));
      spine.reverse();
      const route = [];
      for (const cell of spine.slice(0, -1)) {
        route.push(action(cell, "lower"), action(cell, "upper"));
        available.delete(model.cellKey(cell));
      }
      // A frame stays open until every child has returned; no recursive JS call stack.
      const visited = new Set([exitKey]), stack = [{ cell: exit, side: 0 }];
      route.push(action(exit, "lower"));
      while (stack.length) {
        const frame = stack.at(-1);
        if (frame.side === sides.length) {
          route.push(action(frame.cell, "upper")); stack.pop(); continue;
        }
        const [dx, dy] = sides[frame.side++], key = `${frame.cell.x + dx},${frame.cell.y + dy}`;
        const child = available.get(key);
        if (!child || visited.has(key)) continue;
        visited.add(key); route.push(action(child, "lower")); stack.push({ cell: child, side: 0 });
      }
      return visited.size === available.size ? route : null;
    }
    function blockTraversal(cells, entry, exit = entry, constraints = {}, threshold = 10) {
      const { groups, owners, neighbors } = blockContext(cells);
      const first = owners.get(model.cellKey(entry)), last = owners.get(model.cellKey(exit));
      if (first === undefined || last === undefined) return null;
      if (groups.length === 1) {
        const sequence = buildSequence(cells, entry, exit);
        return sequence ? { sequence, units: sequence.map((_, i) => i > 0) } : null;
      }
      // Visit neighboring orthogonal pieces first. The requested exit piece stays last.
      const pending = new Set(groups.map((_, i) => i).filter(i => i !== first && i !== last)), order = [first];
      const walk = seed => {
        const stack = [{ id: seed, neighbors: [...neighbors[seed].keys()], at: 0 }];
        while (stack.length) {
          const frame = stack.at(-1);
          if (frame.at === frame.neighbors.length) { stack.pop(); continue; }
          const id = frame.neighbors[frame.at++];
          if (!pending.delete(id)) continue;
          order.push(id); stack.push({ id, neighbors: [...neighbors[id].keys()], at: 0 });
        }
      };
      walk(first);
      while (pending.size) { const id = pending.values().next().value; pending.delete(id); order.push(id); walk(id); }
      if (last !== first) order.push(last);
      const sequence = [], units = [], cutKeys = new Set((constraints.forcedCuts || []).map(model.key));
      const variant = (cell, diagonal, direction) => ({ ...action(cell, diagonal), direction,
        ...(cutKeys.has(`${model.cellKey(cell)}:${diagonal}`) ? { cutBefore: true } : {}) });
      const rank = (pool, score) => [...new Map(pool.map(cell => [model.cellKey(cell), cell])).values()]
        .map(cell => ({ cell, score: score(cell) })).sort((a, b) => a.score - b.score).slice(0, 3).map(item => item.cell);
      let deferred = null;
      for (let at = 0; at < order.length; at++) {
        const id = order[at], previous = sequence.at(-1), nextId = order[at + 1];
        const inContacts = neighbors[id].get(order[at - 1]), outContacts = neighbors[id].get(nextId);
        const nextCells = outContacts?.map(link => link.to) || (nextId !== undefined ? groups[nextId] : []);
        const targets = rank(nextCells, cell => Math.hypot(cell.x - exit.x, cell.y - exit.y))
          .flatMap(cell => [1, -1].map(direction => variant(cell, "lower", direction)));
        const incoming = cell => Math.min(...[1, -1].map(direction => model.cost(previous, variant(cell, "lower", direction), threshold, true)));
        const outgoing = cell => targets.length ? Math.min(...[1, -1].flatMap(direction => targets.map(target =>
          model.cost(variant(cell, "upper", direction), target, threshold, true)))) : 0;
        const entries = at === 0 ? [entry] : rank(inContacts?.map(link => link.from) || groups[id], incoming);
        const fixedExit = id === last;
        if (fixedExit && at > 0 && !entries.some(cell => model.cellKey(cell) === model.cellKey(exit))) entries.push(exit);
        const exits = fixedExit ? [exit] : rank(outContacts?.map(link => link.from) || groups[id], outgoing);
        let best = null;
        for (const from of entries) for (const to of fixedExit ? exits : [...exits, from]) {
          const part = buildSequence(groups[id], from, to);
          if (!part) continue;
          const mask = part.map((_, i) => i > 0);
          const candidate = orientUnitPath(part, mask, constraints, threshold, previous, targets);
          if (candidate && (!best || candidate.score < best.score - 1e-8)) best = { ...candidate, units: mask };
        }
        if (!best) return null;
        // When both endpoints belong to the first piece, keep its final upper diagonal for the return.
        // This preserves precedence without pretending that the return from another piece is unit length.
        if (at === 0 && first === last) { deferred = best.path.pop(); best.units.pop(); }
        for (let i = 0; i < best.path.length; i++) { sequence.push(best.path[i]); units.push(best.units[i]); }
      }
      if (deferred) { sequence.push(deferred); units.push(false); }
      return { sequence, units };
    }
    function orientUnitPath(sequence, unitLinks, constraints = {}, threshold = 10, previous = null, next = [], endpoints = {}) {
      if (!sequence.length) return { path: [], score: 0 };
      const fixed = new Map((constraints.lockedPrefix || []).map(p => [model.key(p), p.direction]));
      if (constraints.start) fixed.set(model.key(constraints.start), constraints.start.direction);
      const cuts = new Set((constraints.forcedCuts || []).map(model.key));
      const variants = sequence.map(p => [1, -1].map(direction => ({ ...model.copy(p), direction,
        ...(cuts.has(model.key(p)) ? { cutBefore: true } : {}) })));
      const parents = new Int8Array(sequence.length * 2);
      let scores = [0, 0];
      for (let i = 0; i < sequence.length; i++) {
        const current = [Infinity, Infinity];
        for (let d = 0; d < 2; d++) {
          const point = variants[i][d], required = fixed.get(model.key(point));
          if (required && required !== point.direction) continue;
          if ((!i && endpoints.first && endpoints.first !== point.direction)
              || (i === sequence.length - 1 && endpoints.last && endpoints.last !== point.direction)) continue;
          if (!i) {
            if (previous && unitLinks[0] && model.distance(previous, point) !== 1) continue;
            current[d] = model.cost(previous, point, threshold, true); continue;
          }
          for (let before = 0; before < 2; before++) {
            if (unitLinks[i] && model.distance(variants[i - 1][before], point) !== 1) continue;
            const value = scores[before] + model.cost(variants[i - 1][before], point, threshold, true);
            if (value < current[d]) { current[d] = value; parents[i * 2 + d] = before; }
          }
        }
        scores = current;
      }
      if (next.length) scores = scores.map((score, d) => score + Math.min(...next.map(p => model.cost(variants.at(-1)[d], p, threshold, true))));
      let direction = scores[0] <= scores[1] ? 0 : 1;
      const score = scores[direction];
      if (!Number.isFinite(score)) return null;
      const path = new Array(sequence.length);
      for (let i = sequence.length - 1; i >= 0; i--) {
        path[i] = variants[i][direction]; direction = parents[i * 2 + direction];
      }
      return { path, score };
    }
    function spatialIndex(cells, pointVariants) {
      const bins = new Map(), indexBins = new Map();
      cells.forEach((cell, i) => {
        const x = Math.floor(cell.x / 8), y = Math.floor(cell.y / 8), key = `${x},${y}`;
        if (!bins.has(key)) bins.set(key, { indices: new Set(), minX: x * 8, minY: y * 8, maxX: (x + 1) * 8, maxY: (y + 1) * 8 });
        bins.get(key).indices.add(i); indexBins.set(i, key);
      });
      function remove(i) {
        const key = indexBins.get(i), bin = bins.get(key);
        if (!bin) return;
        bin.indices.delete(i); indexBins.delete(i);
        if (!bin.indices.size) bins.delete(key);
      }
      function nearest(previous, accept, threshold) {
        const end = previous && model.holes(previous).end;
        const ranked = [...bins.values()].map(bin => ({ bin, bound: end ? Math.hypot(
          Math.max(bin.minX - end.x, 0, end.x - bin.maxX), Math.max(bin.minY - end.y, 0, end.y - bin.maxY)) : 0 }))
          .sort((a, b) => a.bound - b.bound);
        let best = null;
        for (const { bin, bound } of ranked) {
          if (best && bound > best.score) break;
          for (const i of bin.indices) {
            if (!accept(i)) continue;
            for (const point of pointVariants(i)) {
              const score = model.cost(previous, point, threshold, true);
              if (Number.isFinite(score) && (!best || score < best.score)) best = { i, point, score };
            }
          }
        }
        return best;
      }
      return { remove, nearest };
    }
    function buildPath(options, report = () => {}) {
      const cells = options.points || [], threshold = options.cutThreshold || 10;
      const constraints = { ...(options.constraints || {}), forcedCuts: [
        ...(options.constraints?.forcedCuts || []), ...(options.initialPath || []).filter(p => p.cutBefore)
      ] };
      const cuts = new Set(constraints.forcedCuts.map(model.key));
      const prefix = (constraints.lockedPrefix?.length ? constraints.lockedPrefix
        : constraints.start ? [constraints.start] : []).map(p => ({ ...model.copy(p),
          ...(cuts.has(model.key(p)) ? { cutBefore: true } : {}) }));
      const prefixError = model.validateRoute(prefix, cells, false);
      if (prefixError || !model.satisfiesConstraints(prefix, { ...constraints, forcedCuts: [] })) {
        throw new Error(prefixError || "Depart et prefixe incompatibles.");
      }
      const prefixLength = prefix.length;
      const cellIndex = new Map(cells.map((cell, i) => [model.cellKey(cell), i]));
      if (cellIndex.size !== cells.length) throw new Error("Cases dupliquees.");
      const state = new Uint8Array(cells.length);
      for (const p of prefix) state[cellIndex.get(model.cellKey(p))] = p.diagonal === "lower" ? 1 : 2;
      const open = [...state.keys()].filter(i => state[i] === 1);
      const resumeIndex = open.length === 1 && prefix.at(-1)?.diagonal === "lower"
        && cellIndex.get(model.cellKey(prefix.at(-1))) === open[0] ? open[0] : -1;
      const wide = Boolean(options.wideBlocks), zones = model.createZones(cells);
      const groups = (wide ? proximityComponents : orthogonalComponents)(cells.filter((_, i) => state[i] === 0 || i === resumeIndex))
        .map(group => ({ cells: group, partial: false, resume: group.some(cell => cellIndex.get(model.cellKey(cell)) === resumeIndex) }));
      cells.forEach((cell, i) => { if (state[i] === 1 && i !== resumeIndex) groups.push({ cells: [cell], partial: true }); });
      const groupByCell = new Map(), pendingByZone = new Map();
      const zoneFor = i => wide ? groupByCell.get(i) : zones.byCell.get(model.cellKey(cells[i]));
      groups.forEach((group, id) => {
        group.id = id; group.zoneId = wide ? id : zones.byCell.get(model.cellKey(group.cells[0]));
        group.mixed = wide && blockContext(group.cells).groups.length > 1;
        group.indices = group.cells.map(cell => cellIndex.get(model.cellKey(cell)));
        group.indices.forEach(i => groupByCell.set(i, id));
        pendingByZone.set(group.zoneId, (pendingByZone.get(group.zoneId) || 0) + group.cells.length);
      });
      const variants = i => [1, -1].map(direction => {
        const point = { ...action(cells[i], state[i] ? "upper" : "lower"), direction };
        if (cuts.has(model.key(point))) point.cutBefore = true;
        return point;
      });
      const index = spatialIndex(cells, variants);
      cells.forEach((_, i) => { if (state[i] === 2) index.remove(i); });
      const pending = new Set(groups.map(group => group.id)), unitLinks = prefix.map(() => false), blocks = [];
      let route = prefix, currentZone = prefix.length ? zoneFor(cellIndex.get(model.cellKey(prefix.at(-1)))) : null;
      let completed = 0, active = null, attempts = 0, lastReport = -Infinity, phase = wide ? "Preparation des blocs de proximite" : "Preparation des groupes orthogonaux";
      const started = clock(), diagnostics = { groups: groups.length, entryExitChanges: 0, diagonalLinks: 0, rejectedPrefixes: 0 };
      let initialMetrics = options.initialPath?.length && !model.validateRoute(options.initialPath, cells)
        ? zones.measure(options.initialPath, threshold) : undefined;
      function snapshot(includePath = true) {
        return { method: "orthogonal-backtracking", phase, stage: completed === groups.length ? "complete" : "zones",
          ...(includePath ? { path: route.map(model.copy) } : {}), metrics: zones.measure(route, threshold), initialMetrics,
          zone: { total: groups.length, completed, ...(active ? { id: active.id, index: completed + (active.status === "complete" ? 0 : 1),
            crossCount: active.cells.length,
            unlockedCrosses: active.partial ? 0.5 : active.cells.length - (active.resume ? 0.5 : 0),
            status: active.status } : {}) },
          elapsedMs: clock() - started, progress: groups.length ? completed / groups.length * 100 : 100,
          restarts: attempts, diagnostics: { ...diagnostics } };
      }
      function emit(force = false) {
        const now = clock();
        if (force || now - lastReport >= 150) { lastReport = now; report(snapshot()); }
      }
      emit(true);
      while (pending.size) {
        const sameZone = pendingByZone.get(currentZone) > 0;
        const chosen = completed === 0 && resumeIndex !== -1 ? { i: resumeIndex }
          : index.nearest(route.at(-1), i => !sameZone || zoneFor(i) === currentZone, threshold);
        if (!chosen) throw new Error("Aucun groupe accessible depuis le trou courant.");
        const group = groups[groupByCell.get(chosen.i)];
        currentZone = group.zoneId;
        active = { ...group, status: "running" };
        phase = `Parcours par retours : groupe ${completed + 1} / ${groups.length}`;
        emit();
        group.indices.forEach(i => index.remove(i));
        pendingByZone.set(currentZone, pendingByZone.get(currentZone) - group.cells.length);
        const nearbyOnly = pendingByZone.get(currentZone) > 0;
        const acceptNext = i => !nearbyOnly || zoneFor(i) === currentZone;
        const previous = route.at(-1);
        let best = null;
        if (group.partial) {
          best = orientUnitPath([action(group.cells[0], "upper")], [false], constraints, threshold, previous);
          if (best) best.units = [false];
        } else {
          const incoming = cell => group.resume ? 0 : Math.min(...[1, -1].map(direction => model.cost(previous,
            { ...action(cell, "lower"), direction, ...(cuts.has(`${model.cellKey(cell)}:lower`) ? { cutBefore: true } : {}) }, threshold, true)));
          const exits = group.cells.map(cell => {
            const next = [1, -1].map(direction => index.nearest({ ...action(cell, "upper"), direction }, acceptNext, threshold)).filter(Boolean);
            return { cell, next: next.map(candidate => candidate.point), score: next.length ? Math.min(...next.map(candidate => candidate.score)) : 0 };
          }).sort((a, b) => a.score - b.score || incoming(a.cell) - incoming(b.cell));
          const entries = group.resume ? [cells[resumeIndex]] : [...group.cells].sort((a, b) => incoming(a) - incoming(b)).slice(0, 4);
          if (!group.resume) for (const { cell } of exits.slice(0, 4)) if (!entries.some(p => model.cellKey(p) === model.cellKey(cell))) entries.push(cell);
          const exitByKey = new Map(exits.map(exit => [model.cellKey(exit.cell), exit]));
          const pairs = [];
          for (const entry of entries) {
            const destinations = [exitByKey.get(model.cellKey(entry)), ...exits.slice(0, 4).filter(exit => model.cellKey(exit.cell) !== model.cellKey(entry))];
            for (const exit of destinations) pairs.push({ entry, exit, bound: incoming(entry) + exit.score });
          }
          pairs.sort((a, b) => a.bound - b.bound);
          for (const { entry, exit } of pairs) {
            attempts++;
            const traversal = wide ? blockTraversal(group.cells, entry, exit.cell, constraints, threshold) : null;
            let sequence = wide ? traversal?.sequence : buildSequence(group.cells, entry, exit.cell);
            if (!sequence) { diagnostics.rejectedPrefixes++; continue; }
            let mask = wide ? traversal.units : sequence.map((_, i) => i > 0);
            if (group.resume) { sequence = sequence.slice(1); mask = mask.slice(1); }
            const candidate = orientUnitPath(sequence, mask, constraints, threshold, previous, exit.next);
            if (candidate && (!best || candidate.score < best.score - 1e-8)) {
              best = { ...candidate, units: mask, entry, exit: exit.cell };
            }
            emit();
            // Unit internal links have their absolute lower bound; no random search is needed.
            if (best && !cuts.size && best.score <= pairs[0].bound + sequence.length - 1 + 1e-8) break;
          }
        }
        if (!best) throw new Error("Aucun parcours interne ne respecte les contraintes de ce groupe.");
        if (best.entry && model.cellKey(best.entry) !== model.cellKey(best.exit)) diagnostics.entryExitChanges++;
        if (previous && Math.abs(previous.x - best.path[0].x) === 1 && Math.abs(previous.y - best.path[0].y) === 1) diagnostics.diagonalLinks++;
        blocks.push({ cells: group.cells.map(cell => ({ x: cell.x, y: cell.y })), partial: group.partial, mixed: group.mixed,
          resume: Boolean(group.resume), start: route.length, end: route.length + best.path.length,
          ...(group.resume ? { root: { x: cells[resumeIndex].x, y: cells[resumeIndex].y } } : {}) });
        for (let i = 0; i < best.path.length; i++) { route.push(best.path[i]); unitLinks.push(best.units[i]); }
        group.indices.forEach(i => { state[i] = 2; });
        pending.delete(group.id); completed++; active.status = "complete";
        emit();
      }
      phase = "Choix des sens et verification finale"; emit(true);
      const final = orientUnitPath(route, unitLinks, constraints, threshold);
      if (!final) throw new Error("Impossible de relier les groupes en conservant les retours a distance 1.");
      route = final.path;
      const error = model.validateRoute(route, cells);
      if (error || !model.satisfiesConstraints(route, constraints)) throw new Error(error || "Contraintes de chemin non respectees.");
      if (route.some((point, i) => unitLinks[i] && model.distance(route[i - 1], point) !== 1)) throw new Error("Retour non unitaire.");
      initialMetrics ||= zones.measure(route, threshold);
      phase = "Parcours par retours termine";
      const result = { ...snapshot(), unitLinks, blocks, prefixLength };
      report(result); return result;
    }
    return { buildPath, orthogonalComponents, proximityComponents, buildSequence, blockTraversal, orientUnitPath, spatialIndex, satisfiesConstraints: model.satisfiesConstraints };
  }
  root.createOrthogonalPathBuilder = createOrthogonalPathBuilder;
  if (typeof module !== "undefined") module.exports = { createOrthogonalPathBuilder };
})(typeof window === "undefined" ? globalThis : window);
