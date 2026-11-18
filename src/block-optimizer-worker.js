(function (root) {
  "use strict";
  function createBlockOptimizer(model, createBuilder, clock = () => performance.now(), random = Math.random,
    createRelay = typeof require === "function" ? require("./relay-search.js").createRelaySearch : globalThis.createRelaySearch) {
    const builder = createBuilder(model, clock), epsilon = 1e-8;
    const relaySearch = createRelay(model, builder, clock);
    const better = (score, cuts, otherScore, otherCuts) => Number.isFinite(score)
      && (score < otherScore - epsilon || (Math.abs(score - otherScore) <= epsilon && cuts < otherCuts));
    const compareMetrics = (a, b) => Math.abs(a.score - b.score) > epsilon ? a.score - b.score
      : a.cuts - b.cuts || a.distance - b.distance;
    const nodeKey = point => `${model.key(point)}:${point.direction}`;
    function boundsOf(cells) {
      const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const cell of cells) {
        bounds.minX = Math.min(bounds.minX, cell.x); bounds.minY = Math.min(bounds.minY, cell.y);
        bounds.maxX = Math.max(bounds.maxX, cell.x + 1); bounds.maxY = Math.max(bounds.maxY, cell.y + 1);
      }
      return bounds;
    }
    function normalized(point, cuts) {
      return { ...model.copy(point), ...(cuts.has(model.key(point)) ? { cutBefore: true } : {}) };
    }
    // A two-by-two transfer matrix retains every feasible first/last sewing direction.
    function summarize(sequence, units, constraints, threshold, cuts) {
      const fixed = new Map((constraints.lockedPrefix || []).map(p => [model.key(p), p.direction]));
      if (constraints.start) fixed.set(model.key(constraints.start), constraints.start.direction);
      const variants = p => [1, -1].map(direction => ({ ...normalized(p, cuts), direction }));
      const first = variants(sequence[0]);
      let previous = first, scores = [Infinity, Infinity, Infinity, Infinity], counts = [0, 0, 0, 0];
      for (let d = 0; d < 2; d++) if (!fixed.has(model.key(first[d])) || fixed.get(model.key(first[d])) === first[d].direction) scores[d * 3] = 0;
      for (let i = 1; i < sequence.length; i++) {
        const points = variants(sequence[i]), costs = new Array(4).fill(Infinity), extraCuts = new Array(4).fill(0);
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
          if (fixed.has(model.key(points[b])) && fixed.get(model.key(points[b])) !== points[b].direction) continue;
          const distance = model.distance(previous[a], points[b]);
          if (!distance || (units[i] && distance !== 1)) continue;
          extraCuts[a * 2 + b] = Number(points[b].cutBefore || distance > threshold);
          costs[a * 2 + b] = distance + extraCuts[a * 2 + b] * threshold * 3;
        }
        const nextScores = new Array(4).fill(Infinity), nextCounts = new Array(4).fill(0);
        for (let start = 0; start < 2; start++) for (let end = 0; end < 2; end++) for (let middle = 0; middle < 2; middle++) {
          const at = start * 2 + end, value = scores[start * 2 + middle] + costs[middle * 2 + end];
          const count = counts[start * 2 + middle] + extraCuts[middle * 2 + end];
          if (better(value, count, nextScores[at], nextCounts[at])) { nextScores[at] = value; nextCounts[at] = count; }
        }
        scores = nextScores; counts = nextCounts; previous = points;
      }
      return { first, last: previous, scores, counts };
    }
    function configSequence(block, config) {
      if (config.sequence) return config.sequence;
      const sequence = builder.buildSequence(block.cells, config.entry, config.exit);
      if (!sequence) throw new Error("Configuration de bloc devenue inaccessible.");
      return block.resume ? sequence.slice(1) : sequence;
    }
    const configUnits = (sequence, config) => config.units || sequence.map((_, i) => i > 0);
    function addConfig(problem, block, config, sequence = configSequence(block, config)) {
      if (!sequence?.length) return;
      const summary = summarize(sequence, configUnits(sequence, config), problem.constraints, problem.threshold, problem.cuts);
      if (!summary.scores.some(Number.isFinite)) return;
      block.configs.push(config);
      block.records.push({ ...summary, config: block.configs.length - 1 });
    }
    function finishBlock(block) {
      const entries = new Map(), exits = new Map();
      for (const record of block.records) {
        record.first.forEach(point => { if (!entries.has(nodeKey(point))) entries.set(nodeKey(point), point); });
        record.last.forEach(point => { if (!exits.has(nodeKey(point))) exits.set(nodeKey(point), point); });
      }
      block.entries = [...entries.values()]; block.exits = [...exits.values()];
      const entryIds = new Map(block.entries.map((point, i) => [nodeKey(point), i]));
      const exitIds = new Map(block.exits.map((point, i) => [nodeKey(point), i]));
      const size = block.entries.length * block.exits.length;
      block.transferByPair = new Map();
      for (const record of block.records) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        const entry = entryIds.get(nodeKey(record.first[a])), exit = exitIds.get(nodeKey(record.last[b]));
        const at = entry * block.exits.length + exit, old = block.transferByPair.get(at);
        if (better(record.scores[a * 2 + b], record.counts[a * 2 + b], old?.score ?? Infinity, old?.cuts ?? 0)) {
          block.transferByPair.set(at, { entry, exit, score: record.scores[a * 2 + b], cuts: record.counts[a * 2 + b], config: record.config });
        }
      }
      block.transfers = [...block.transferByPair.values()];
      // Large contact boundaries stay sparse; the DP visits only feasible transfers.
      if (size <= 262144) {
        block.costs = new Float64Array(size).fill(Infinity); block.cutCounts = new Int32Array(size);
        block.choices = new Int32Array(size).fill(-1);
        for (const [at, transfer] of block.transferByPair) {
          block.costs[at] = transfer.score; block.cutCounts[at] = transfer.cuts; block.choices[at] = transfer.config;
        }
      }
      delete block.records;
    }
    function findUnitContacts(blocks) {
      const byCell = new Map(), contacts = [];
      const portals = new Map(blocks.map(block => [block.id, new Map()]));
      for (const block of blocks) if (!block.anchor) for (const cell of block.cells) byCell.set(model.cellKey(cell), { block, cell });
      for (const block of blocks) if (!block.anchor) for (const cell of block.cells) {
        for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
          const other = byCell.get(`${cell.x + dx},${cell.y + dy}`);
          if (!other || other.block.id <= block.id) continue;
          contacts.push({ from: block.id, to: other.block.id, exit: cell, entry: other.cell });
          portals.get(block.id).set(model.cellKey(cell), cell);
          portals.get(other.block.id).set(model.cellKey(other.cell), other.cell);
        }
      }
      return { contacts, portals };
    }
    function findUnitNeighbors(problem) {
      const byHole = new Map(), neighbors = new Map(problem.blocks.map(block => [block.id, new Set()]));
      for (const block of problem.blocks) for (const entry of new Set(block.transfers.map(transfer => transfer.entry))) {
        const point = block.entries[entry];
        if (point.cutBefore) continue;
        const hole = model.holes(point).start, key = `${hole.x},${hole.y}`;
        if (!byHole.has(key)) byHole.set(key, new Set());
        byHole.get(key).add(block.id);
      }
      for (const block of problem.blocks) for (const exit of new Set(block.transfers.map(transfer => transfer.exit))) {
        const hole = model.holes(block.exits[exit]).end;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          for (const id of byHole.get(`${hole.x + dx},${hole.y + dy}`) || []) {
            if (id !== block.id) neighbors.get(block.id).add(id);
          }
        }
      }
      return new Map([...neighbors].map(([id, ids]) => [id, [...ids]]));
    }
    function unitPriorityOrder(problem, order) {
      const result = order.slice(0, problem.fixedCount), remaining = new Set(order.slice(problem.fixedCount));
      const rank = new Map(order.map((id, i) => [id, i]));
      while (remaining.size) {
        const previous = result.at(-1);
        const candidates = (problem.unitNeighbors.get(previous) || []).filter(id => remaining.has(id));
        candidates.sort((a, b) => rank.get(a) - rank.get(b));
        const next = candidates[0] ?? (problem.neighbors.get(previous) || []).find(id => remaining.has(id)) ?? remaining.values().next().value;
        result.push(next); remaining.delete(next);
      }
      return result;
    }
    function insertionContext(cells) {
      const owners = new Map(), contacts = new Map();
      const groups = builder.orthogonalComponents(cells);
      groups.forEach((group, id) => group.forEach(cell => owners.set(model.cellKey(cell), id)));
      const maxCrosses = 16;
      groups.forEach((group, source) => {
        if (group.length > maxCrosses) return;
        const nearby = new Set();
        for (const cell of group) for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
          const key = `${cell.x + dx},${cell.y + dy}`, id = owners.get(key);
          if (id !== undefined && groups[id].length > group.length) nearby.add(key);
        }
        if (nearby.size) contacts.set(source, [...nearby]);
      });
      return { owners, contacts, groups, maxCrosses };
    }
    function* blockInsertions(problem, route) {
      const { owners, contacts, groups } = problem.insertions;
      if (!contacts.size) return;
      const path = route.path, indices = new Map(), spans = new Map(), candidates = [];
      const locked = problem.constraints.lockedPrefix?.length || (problem.constraints.start ? 1 : 0);
      path.forEach((point, i) => {
        const key = model.cellKey(point);
        if (!indices.has(key)) indices.set(key, []);
        indices.get(key).push(i);
        const id = owners.get(key);
        if (!spans.has(id)) spans.set(id, { start: i, end: i, count: 0 });
        const span = spans.get(id); span.end = i + 1; span.count++;
      });
      for (const [id, nearby] of contacts) {
        const span = spans.get(id), crossCount = groups[id].length;
        if (!span || span.count !== crossCount * 2 || span.end - span.start !== span.count || span.start < locked) continue;
        const from = span.start, end = span.end;
        const gaps = new Set();
        for (const neighbor of nearby) for (const at of indices.get(neighbor) || []) {
          for (const to of [at, at + 1]) {
            if (to < locked || !to || to >= path.length || (to >= from && to <= end)) continue;
            const before = owners.get(model.cellKey(path[to - 1])), after = owners.get(model.cellKey(path[to]));
            if (before === after) gaps.add(to);
          }
        }
        for (const to of gaps) candidates.push({ from, end, to, crossCount });
      }
      if (!candidates.length) return;
      const fixed = new Map((problem.constraints.lockedPrefix || []).map(point => [model.key(point), point.direction]));
      if (problem.constraints.start) fixed.set(model.key(problem.constraints.start), problem.constraints.start.direction);
      const leaves = path.map((point, i) => {
        const variants = [1, -1].map(direction => ({ ...normalized(point, problem.cuts), direction }));
        const required = fixed.get(model.key(point));
        return { first: variants, last: variants, start: i, end: i + 1,
          scores: [required === -1 ? Infinity : 0, Infinity, Infinity, required === 1 ? Infinity : 0] };
      });
      function join(left, right) {
        if (!left || !right) return left || right;
        const unit = left.end === right.start && route.unitLinks[right.start];
        const edges = [0, 1, 2, 3].map(i => {
          const a = left.last[i >> 1], b = right.first[i & 1], distance = model.distance(a, b);
          return !distance || (unit && distance !== 1) ? Infinity
            : distance + Number(b.cutBefore || distance > problem.threshold) * problem.threshold * 3;
        });
        const scores = [Infinity, Infinity, Infinity, Infinity];
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
          for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) {
            scores[a * 2 + b] = Math.min(scores[a * 2 + b], left.scores[a * 2 + x] + edges[x * 2 + y] + right.scores[y * 2 + b]);
          }
        }
        return { first: left.first, last: right.last, start: left.start, end: right.end, scores };
      }
      // Range transfers let each relocation re-evaluate all sewing directions without rescanning the whole path.
      let size = 1;
      while (size < path.length) size *= 2;
      const tree = new Array(size * 2);
      leaves.forEach((leaf, i) => { tree[size + i] = leaf; });
      for (let i = size - 1; i > 0; i--) tree[i] = join(tree[i * 2], tree[i * 2 + 1]);
      function range(start, end) {
        let left = null, right = null;
        for (start += size, end += size; start < end; start >>= 1, end >>= 1) {
          if (start & 1) left = join(left, tree[start++]);
          if (end & 1) right = join(tree[--end], right);
        }
        return join(left, right);
      }
      // Nearby unit opportunities first; this is only an ordering, never an acceptance rule.
      for (const candidate of candidates) {
        const { from, end, to } = candidate, fragment = range(from, end);
        candidate.localScore = Math.min(...join(join(leaves[to - 1], fragment), leaves[to]).scores) - Math.min(...fragment.scores);
      }
      candidates.sort((a, b) => a.localScore - b.localScore);
      for (const { from, end, to, crossCount } of candidates) {
        const pieces = from < to
          ? [[0, from], [end, to], [from, end], [to, path.length]]
          : [[0, to], [from, end], [to, from], [end, path.length]];
        const summary = pieces.reduce((value, [a, b]) => join(value, range(a, b)), null);
        yield { from, end, to, crossCount, score: Math.min(...summary.scores), materialize() {
          const sequence = [], units = []; let previous = -2;
          for (const [a, b] of pieces) for (let i = a; i < b; i++) {
            sequence.push(path[i]); units.push(previous + 1 === i && Boolean(route.unitLinks[i])); previous = i;
          }
          const oriented = builder.orientUnitPath(sequence, units, problem.constraints, problem.threshold);
          return oriented ? { path: oriented.path, unitLinks: units } : null;
        } };
      }
    }
    function prepareProblem(options, report = () => {}) {
      const cells = options.points || [], threshold = Math.max(1, options.cutThreshold || 10);
      const constraints = { ...(options.constraints || {}), forcedCuts: [...new Map([
        ...(options.constraints?.forcedCuts || []), ...(options.initialPath || []).filter(p => p.cutBefore)
      ].map(p => [model.key(p), model.copy(p)])).values()] };
      const seed = builder.buildPath({ ...options, cutThreshold: threshold, constraints }, snapshot => report({ ...snapshot,
        method: "block-optimization", stage: "construction", progress: snapshot.progress * 0.1,
        ...(options.initialPath?.length ? { path: undefined } : {}) }));
      const cuts = new Set(constraints.forcedCuts.map(model.key)), blocks = [];
      if (seed.prefixLength) blocks.push({ anchor: true, cells: [], configs: [], records: [],
        seedSequence: seed.path.slice(0, seed.prefixLength), seedUnits: seed.unitLinks.slice(0, seed.prefixLength), incomingUnit: false });
      for (const group of seed.blocks) blocks.push({ ...group, configs: [], records: [], anchor: false,
        seedSequence: seed.path.slice(group.start, group.end), incomingUnit: group.resume,
        seedUnits: seed.unitLinks.slice(group.start, group.end).map((unit, i) => i > 0 && unit), bounds: boundsOf(group.cells) });
      blocks.forEach((block, id) => { block.id = id; });
      const fixedCount = Number(seed.prefixLength > 0) + Number(seed.blocks[0]?.resume || false);
      const problem = { cells, blocks, constraints, cuts, threshold, fixedCount, seed, insertions: insertionContext(cells),
        orders: [blocks.map(block => block.id)], neighbors: new Map(), transitionCache: new Map(), cacheElements: 0,
        incumbent: { path: seed.path, unitLinks: seed.unitLinks, order: blocks.map(block => block.id), metrics: seed.metrics } };
      for (const block of blocks) addConfig(problem, block, { sequence: block.seedSequence, units: block.seedUnits });

      // Keep a compatible historical route as a candidate, including its exact endpoint choices.
      const initial = (options.initialPath || []).map(point => normalized(point, cuts));
      if (initial.length && !model.validateRoute(initial, cells) && model.satisfiesConstraints(initial, constraints)) {
        const originalOwners = problem.insertions.owners;
        problem.historical = { path: initial, metrics: model.createZones(cells).measure(initial, threshold),
          unitLinks: initial.map((point, i) => i > 0 && i >= seed.prefixLength && model.distance(initial[i - 1], point) === 1
            && originalOwners.get(model.cellKey(initial[i - 1])) === originalOwners.get(model.cellKey(point))) };
        const owners = new Map();
        blocks.filter(block => !block.anchor).forEach(block => block.seedSequence.forEach(point => owners.set(model.key(point), block.id)));
        const parts = [], seen = new Set(); let compatible = true;
        for (let i = seed.prefixLength; i < initial.length; i++) {
          const id = owners.get(model.key(initial[i]));
          if (id === undefined) { compatible = false; break; }
          if (parts.at(-1)?.id !== id) {
            if (seen.has(id)) { compatible = false; break; }
            seen.add(id); parts.push({ id, points: [] });
          } else if (model.distance(initial[i - 1], initial[i]) !== 1) { compatible = false; break; }
          parts.at(-1).points.push(initial[i]);
        }
        const order = [...(seed.prefixLength ? [0] : []), ...parts.map(part => part.id)];
        compatible &&= order.length === blocks.length && order.slice(0, fixedCount).every((id, i) => id === i)
          && parts.every(part => part.points.length === blocks[part.id].seedSequence.length);
        if (compatible && seed.blocks[0]?.resume && model.distance(initial[seed.prefixLength - 1], initial[seed.prefixLength]) !== 1) compatible = false;
        if (compatible) {
          const units = initial.map((_, i) => i >= seed.prefixLength && i > 0 && (owners.get(model.key(initial[i - 1])) === owners.get(model.key(initial[i]))
            || (i === seed.prefixLength && seed.blocks[0]?.resume)));
          for (const part of parts) {
            blocks[part.id].initialSequence = part.points;
            addConfig(problem, blocks[part.id], { sequence: part.points });
          }
          problem.orders.push(order);
          const metrics = model.createZones(cells).measure(initial, threshold);
          if (compareMetrics(metrics, problem.incumbent.metrics) < 0) problem.incumbent = { path: initial, unitLinks: units, order, metrics };
        }
      }
      const visible = problem.historical && compareMetrics(problem.historical.metrics, problem.incumbent.metrics) < 0
        ? problem.historical : problem.incumbent;
      report({ stage: "configuration", phase: "Preparation des entrees et sorties", progress: 10,
        path: visible.path, unitLinks: visible.unitLinks, metrics: visible.metrics,
        initialMetrics: visible.metrics, blocks: { total: seed.blocks.length, prepared: 0 } });
      const freeBlocks = blocks.filter(block => !block.anchor);
      const unitContacts = findUnitContacts(blocks);
      problem.unitContacts = unitContacts.contacts;
      for (const block of freeBlocks) {
        const a = block.bounds;
        const nearby = freeBlocks.filter(other => other !== block).map(other => {
          const b = other.bounds;
          return { id: other.id, gap: Math.hypot(Math.max(a.minX - b.maxX, b.minX - a.maxX, 0), Math.max(a.minY - b.maxY, b.minY - a.maxY, 0)),
            center: Math.hypot(a.minX + a.maxX - b.minX - b.maxX, a.minY + a.maxY - b.minY - b.maxY) };
        }).sort((a, b) => a.gap - b.gap || a.center - b.center).slice(0, 16).map(item => item.id);
        problem.neighbors.set(block.id, nearby);
      }
      let prepared = 0, attempts = 0;
      for (const block of blocks) {
        if (!block.anchor && !block.partial && block.cells.length > 1) {
          const portals = [], keys = new Set(), add = point => {
            if (point && !keys.has(model.cellKey(point)) && portals.length < 8) {
              keys.add(model.cellKey(point)); portals.push({ x: point.x, y: point.y });
            }
          };
          add(block.resume ? block.root : block.seedSequence[0]); add(block.seedSequence.at(-1));
          if (block.initialSequence) { add(block.initialSequence[0]); add(block.initialSequence.at(-1)); }
          for (const id of problem.neighbors.get(block.id) || []) {
            const target = blocks[id].bounds; let chosen = null, bestGap = Infinity, bestCenter = Infinity;
            for (const cell of block.cells) {
              const x = cell.x + 0.5, y = cell.y + 0.5;
              const gap = Math.hypot(Math.max(target.minX - x, 0, x - target.maxX), Math.max(target.minY - y, 0, y - target.maxY));
              const center = Math.hypot(x * 2 - target.minX - target.maxX, y * 2 - target.minY - target.maxY);
              if (gap < bestGap || (gap === bestGap && center < bestCenter)) { chosen = cell; bestGap = gap; bestCenter = center; }
            }
            add(chosen);
          }
          for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            let chosen = block.cells[0];
            for (const cell of block.cells) if (cell.x * dx + cell.y * dy > chosen.x * dx + chosen.y * dy) chosen = cell;
            add(chosen);
          }
          const contacts = [...unitContacts.portals.get(block.id).values()], pairs = new Map();
          const addPair = (entry, exit) => {
            if (block.resume) entry = block.root;
            if ((entry.x + entry.y - exit.x - exit.y) % 2 !== 0) return;
            pairs.set(`${model.cellKey(entry)}:${model.cellKey(exit)}`, { entry, exit });
          };
          const allPortals = [...new Map([...contacts, ...portals].map(cell => [model.cellKey(cell), cell])).values()];
          // Every contact gets a same-cell entry/exit traversal. Mixed endpoints are exhaustive for small
          // pools and sampled for large boundaries, without a quadratic number of traversals.
          for (const contact of contacts) addPair(contact, contact);
          if (allPortals.length <= 16) {
            for (const entry of allPortals) for (const exit of allPortals) addPair(entry, exit);
          } else {
            for (const contact of contacts) {
              const compatible = portals.filter(portal => (portal.x + portal.y - contact.x - contact.y) % 2 === 0)
                .sort((a, b) => Math.hypot(a.x - contact.x, a.y - contact.y) - Math.hypot(b.x - contact.x, b.y - contact.y));
              for (const other of [...compatible.slice(0, 2), ...compatible.slice(-2)]) {
                addPair(contact, other); addPair(other, contact);
              }
            }
            for (const entry of portals) for (const exit of portals) addPair(entry, exit);
          }
          let done = 0;
          for (const { entry, exit } of pairs.values()) {
            attempts++;
            let sequence = builder.buildSequence(block.cells, entry, exit);
            if (sequence) {
              if (block.resume) sequence = sequence.slice(1);
              addConfig(problem, block, { entry, exit }, sequence);
            }
            done++;
            if (done % 16 === 0) report({ stage: "configuration", phase: `Bloc ${prepared + 1} / ${freeBlocks.length} : ${done} / ${pairs.size} configurations`,
              blocks: { total: freeBlocks.length, prepared }, attempts,
              progress: 10 + (prepared + done / pairs.size) / freeBlocks.length * 10 });
          }
        }
        finishBlock(block);
        if (!block.anchor) prepared++;
        report({ stage: "configuration", phase: `Entrees et sorties : ${prepared} / ${freeBlocks.length}`,
          blocks: { total: freeBlocks.length, prepared }, attempts, progress: 10 + (freeBlocks.length ? prepared / freeBlocks.length * 10 : 10) });
      }
      problem.unitNeighbors = findUnitNeighbors(problem);
      problem.unitEdges = [...problem.unitNeighbors].flatMap(([from, ids]) => ids
        .filter(to => from >= fixedCount - 1 && to >= fixedCount).map(to => ({ from, to })));
      problem.unitOrders = blocks.length - fixedCount > 7 && problem.unitEdges.length
        ? problem.orders.map(order => unitPriorityOrder(problem, order)) : [];
      return problem;
    }
    function transitions(problem, a, b) {
      const key = a.id * problem.blocks.length + b.id, cached = problem.transitionCache.get(key);
      if (cached) { problem.transitionCache.delete(key); problem.transitionCache.set(key, cached); return cached; }
      const size = a.exits.length * b.entries.length;
      if (size > 524288) return { costs: null, cuts: null };
      const costs = new Float64Array(size), cuts = new Int8Array(size);
      for (let x = 0; x < a.exits.length; x++) for (let y = 0; y < b.entries.length; y++) {
        const at = x * b.entries.length + y, distance = model.distance(a.exits[x], b.entries[y]);
        cuts[at] = Number(b.entries[y].cutBefore || distance > problem.threshold);
        costs[at] = !distance || (b.incomingUnit && distance !== 1) ? Infinity : distance + cuts[at] * problem.threshold * 3;
      }
      while (problem.cacheElements + size > 524288 && problem.transitionCache.size) {
        const first = problem.transitionCache.keys().next().value;
        problem.cacheElements -= problem.transitionCache.get(first).costs.length; problem.transitionCache.delete(first);
      }
      const value = { costs, cuts }; problem.transitionCache.set(key, value); problem.cacheElements += size;
      return value;
    }
    function evaluateOrder(problem, order, trace = false, validate = true) {
      if (validate && (order.length !== problem.blocks.length || new Set(order).size !== order.length
          || order.some(id => !Number.isInteger(id) || !problem.blocks[id])
          || order.slice(0, problem.fixedCount).some((id, i) => id !== i))) throw new Error("Ordre de blocs invalide.");
      let scores = null, counts = null, previous = null;
      const history = [];
      for (const id of order) {
        const block = problem.blocks[id], e = block.entries.length, q = block.exits.length;
        const entryScores = new Float64Array(e).fill(previous ? Infinity : 0), entryCuts = new Int32Array(e);
        const before = trace ? new Int32Array(e).fill(-1) : null;
        if (previous) {
          const links = transitions(problem, previous, block);
          for (let from = 0; from < scores.length; from++) for (let to = 0; to < e; to++) {
            const at = from * e + to;
            const distance = links.costs ? 0 : model.distance(previous.exits[from], block.entries[to]);
            const cut = links.cuts ? links.cuts[at] : Number(block.entries[to].cutBefore || distance > problem.threshold);
            const cost = links.costs ? links.costs[at]
              : !distance || (block.incomingUnit && distance !== 1) ? Infinity : distance + cut * problem.threshold * 3;
            const score = scores[from] + cost, cuts = counts[from] + cut;
            if (better(score, cuts, entryScores[to], entryCuts[to])) {
              entryScores[to] = score; entryCuts[to] = cuts; if (trace) before[to] = from;
            }
          }
        }
        const nextScores = new Float64Array(q).fill(Infinity), nextCuts = new Int32Array(q);
        const selected = trace ? new Int32Array(q).fill(-1) : null;
        for (const transfer of block.transfers) {
          const from = transfer.entry, to = transfer.exit;
          const score = entryScores[from] + transfer.score, cuts = entryCuts[from] + transfer.cuts;
          if (better(score, cuts, nextScores[to], nextCuts[to])) {
            nextScores[to] = score; nextCuts[to] = cuts; if (trace) selected[to] = from;
          }
        }
        if (trace) history.push({ selected, before });
        scores = nextScores; counts = nextCuts; previous = block;
      }
      let score = order.length ? Infinity : 0, cuts = 0, end = -1;
      for (let i = 0; i < (scores?.length || 0); i++) if (better(scores[i], counts[i], score, cuts)) { score = scores[i]; cuts = counts[i]; end = i; }
      return { score, cuts, ...(trace ? { trace: history, end } : {}) };
    }
    function materialize(problem, order, evaluation = evaluateOrder(problem, order, true)) {
      if (!evaluation.trace) evaluation = evaluateOrder(problem, order, true);
      if (!Number.isFinite(evaluation.score)) throw new Error("Aucune liaison valide entre ces blocs.");
      const selections = new Array(order.length); let end = evaluation.end;
      for (let i = order.length - 1; i >= 0; i--) {
        const entry = evaluation.trace[i].selected[end]; selections[i] = { entry, exit: end };
        end = evaluation.trace[i].before[entry];
      }
      const path = [], unitLinks = [];
      for (let i = 0; i < order.length; i++) {
        const block = problem.blocks[order[i]], choice = selections[i], at = choice.entry * block.exits.length + choice.exit;
        const config = block.configs[block.transferByPair.get(at).config], sequence = configSequence(block, config), units = configUnits(sequence, config);
        const oriented = builder.orientUnitPath(sequence, units, problem.constraints, problem.threshold, null, [],
          { first: block.entries[choice.entry].direction, last: block.exits[choice.exit].direction });
        if (!oriented) throw new Error("Sens de couture incompatibles avec la configuration choisie.");
        for (let j = 0; j < oriented.path.length; j++) { path.push(oriented.path[j]); unitLinks.push(j ? units[j] : Boolean(block.incomingUnit)); }
      }
      const error = model.validateRoute(path, problem.cells);
      if (error || !model.satisfiesConstraints(path, problem.constraints)) throw new Error(error || "Contraintes non respectees.");
      if (path.some((p, i) => unitLinks[i] && (!i || model.distance(path[i - 1], p) !== 1))) throw new Error("Une liaison interne n'est plus unitaire.");
      return { path, unitLinks };
    }
    function optimizePath(options, report = () => {}) {
      const started = clock(), initialLimit = Math.max(1, Number(options.stagnationLimitMs) || 60000);
      let limit = initialLimit;
      let lastReport = -Infinity, attempts = 0, improvements = 0, restarts = 0, unitAttempts = 0, lastImprovement = started;
      let insertionAttempts = 0, insertions = 0;
      let refinedOrders = 0, intermediateImprovements = 0, interleavedRestarts = 0;
      let relay = null, relayPasses = 0, relayImprovements = 0, relayAttempts = 0, relayChange = null;
      let lastRelayImprovement = null;
      let best = null, bestOrder, bestMetrics, initialMetrics, changed = false, phase = "Construction du parcours initial";
      let stage = "construction", blocks = { total: 0, prepared: 0 }, progress = 0;
      const problem = prepareProblem(options, snapshot => {
        const now = clock();
        if (snapshot.path && snapshot.stage === "configuration") {
          best = { path: snapshot.path, unitLinks: snapshot.unitLinks }; bestMetrics = snapshot.metrics; initialMetrics = snapshot.initialMetrics;
        }
        stage = snapshot.stage; phase = snapshot.phase; blocks = snapshot.blocks || blocks; progress = snapshot.progress;
        if (now - lastReport < 150 && !snapshot.initialMetrics) return;
        lastReport = now;
        report({ ...snapshot, method: "block-optimization", metrics: bestMetrics || snapshot.metrics, initialMetrics,
          ...(best ? { path: best.path, unitLinks: best.unitLinks } : {}), elapsedMs: now - started,
          lastImprovementMs: 0, stagnationLimitMs: limit, improvements, restarts, attempts: snapshot.attempts || 0, blocks });
      });
      const zones = model.createZones(problem.cells);
      best ||= { path: problem.incumbent.path, unitLinks: problem.incumbent.unitLinks };
      bestOrder = problem.incumbent.order.slice(); bestMetrics ||= problem.incumbent.metrics; initialMetrics ||= bestMetrics;
      const actionOwners = new Map(problem.blocks.flatMap(block => block.seedSequence.map(point => [model.key(point), block.id])));
      const fixedOrder = bestOrder.slice(0, problem.fixedCount), lowerBound = Math.max(0, best.path.length - 1);
      const elite = [], refined = new Set(), poolLimit = Math.max(2, Math.min(6, Math.floor(100000 / Math.max(1, best.path.length))));
      let rawBest = evaluateOrder(problem, bestOrder), refinementChecks = 0;
      function routeOrder(route) {
        const ids = new Set(fixedOrder);
        for (const point of route.path) ids.add(actionOwners.get(model.key(point)));
        return [...ids];
      }
      function remember(route, metrics) {
        if (!problem.insertions.contacts.size) return;
        const signature = route.path.map((point, i) => `${model.key(point)}:${Number(route.unitLinks[i])}`).join(";");
        if (elite.some(entry => entry.signature === signature)) return;
        let previous, segments = 0;
        for (const point of route.path) {
          const owner = actionOwners.get(model.key(point));
          if (owner !== previous) segments++;
          previous = owner;
        }
        elite.push({ route, metrics, signature, order: routeOrder(route), interleaved: segments > problem.blocks.length });
        elite.sort((a, b) => compareMetrics(a.metrics, b.metrics));
        if (elite.length > poolLimit) elite.pop();
      }
      function emit(force = false) {
        const now = clock();
        if (!force && now - lastReport < 150) return;
        lastReport = now;
        report({ method: "block-optimization", stage, phase, blocks, metrics: bestMetrics, initialMetrics,
          ...(changed || force ? { path: best.path.map(model.copy), unitLinks: best.unitLinks.slice() } : {}),
          elapsedMs: now - started, lastImprovementMs: Math.max(0, now - lastImprovement), stagnationLimitMs: limit,
          attempts, improvements, restarts, unitAttempts, unitConnections: problem.unitEdges.length, insertionAttempts, insertions,
          refinedOrders, intermediateImprovements, interleavedRestarts, relay, relayPasses, relayImprovements, relayAttempts, relayChange, lastRelayImprovement,
          progress: stage === "complete" ? 100 : stage === "search" ? Math.min(99, (now - lastImprovement) / limit * 100) : progress });
        changed = false;
      }
      function publish(route, metrics, order, insertion = false, intermediate = false, relayed = null) {
        if (compareMetrics(metrics, bestMetrics) >= -epsilon) return false;
        best = route; bestOrder = order ? order.slice() : routeOrder(route); bestMetrics = metrics;
        relayChange = relayed?.diagonals || null;
        if (relayed) {
          relayImprovements++;
          // Preserve shorter programmatic budgets; normal UI runs never fall below two seconds.
          limit = Math.max(Math.min(2000, initialLimit), limit * 0.9);
          lastRelayImprovement = { ...relayed.link, pass: relayPasses };
        } else limit = initialLimit;
        changed = true; improvements++; lastImprovement = clock();
        if (insertion) insertions++;
        if (intermediate) intermediateImprovements++;
        emit(); return true;
      }
      function consider(order, value) {
        if (better(value.score, value.cuts, rawBest.score, rawBest.cuts)) rawBest = value;
        if (!better(value.score, value.cuts, bestMetrics.score, bestMetrics.cuts)) return false;
        const route = materialize(problem, order), metrics = zones.measure(route.path, problem.threshold);
        return publish(route, metrics, order);
      }
      for (const order of [...problem.unitOrders, ...problem.orders]) consider(order, evaluateOrder(problem, order));
      // Even a tied incumbent is realized through the validated block transfer matrices.
      const realized = materialize(problem, bestOrder);
      if (compareMetrics(zones.measure(realized.path, problem.threshold), bestMetrics) <= epsilon) {
        best = realized; bestMetrics = zones.measure(best.path, problem.threshold);
      }
      stage = "search"; phase = "Optimisation des liaisons entre blocs"; lastImprovement = clock(); changed = true; emit(true);
      const freeCount = problem.blocks.length - problem.fixedCount;
      let reason = "inactivity";
      const expired = () => clock() - lastImprovement >= limit;
      // Local descent may improve an unpublished route; only publish() touches the global timer and preview.
      function refineRoute(route, metrics, exploratory = false) {
        if (!problem.insertions.contacts.size || bestMetrics.score <= lowerBound + epsilon) return { route, metrics };
        const previousPhase = phase, initialInsertions = insertions;
        let checks = 0, moves = 0, improved = true;
        const budget = exploratory ? 256 : Infinity;
        while (improved && checks < budget && (!exploratory || moves < 6) && !expired()) {
          improved = false;
          for (const candidate of blockInsertions(problem, route)) {
            if (checks >= budget || expired()) break;
            checks++; attempts++; insertionAttempts++;
            phase = `Insertion de petits blocs : ${insertionAttempts} essais, ${insertions} ameliorations`;
            if (candidate.score < metrics.score - epsilon) {
              const next = candidate.materialize();
              if (next && !model.validateRoute(next.path, problem.cells) && model.satisfiesConstraints(next.path, problem.constraints)) {
                const nextMetrics = zones.measure(next.path, problem.threshold);
                if (nextMetrics.score < metrics.score - epsilon) {
                  route = next; metrics = nextMetrics; improved = true; moves++;
                  publish(route, metrics, null, true, exploratory);
                  emit(); break;
                }
              }
            }
            emit();
          }
        }
        remember(route, metrics);
        if (insertions > initialInsertions && changed) emit(true);
        phase = previousPhase;
        return { route, metrics };
      }
      function tryOrder(order, value, promising = true) {
        const accepted = consider(order, value);
        if (accepted) refineRoute(best, bestMetrics);
        if (!problem.insertions.contacts.size || bestMetrics.score <= lowerBound + epsilon || expired()) return;
        refinementChecks++;
        if (!accepted && freeCount > 7 && !promising && refinementChecks % 24) return;
        const slack = Math.max(4, Math.min(problem.threshold * 2, (rawBest.score - lowerBound) * 0.5));
        if (value.score > rawBest.score + slack) return;
        const key = order.join(",");
        if (refined.has(key)) return;
        refined.add(key);
        if (refined.size > 128) refined.delete(refined.values().next().value);
        if (accepted) return;
        refinedOrders++;
        const route = materialize(problem, order), metrics = zones.measure(route.path, problem.threshold);
        refineRoute(route, metrics, true);
      }
      function searchRound() {
        stage = "search"; phase = "Optimisation des liaisons entre blocs"; relay = null; emit(true);
        remember(best, bestMetrics);
        refineRoute(best, bestMetrics);
        if (problem.insertions.contacts.size && bestMetrics.score > lowerBound + epsilon) {
          for (const order of [...problem.unitOrders, ...problem.orders]) {
            if (expired()) break;
            tryOrder(order, evaluateOrder(problem, order));
          }
        }
        if (freeCount <= 7) {
          reason = "exhaustive";
          const permutation = bestOrder.slice(problem.fixedCount), prefix = bestOrder.slice(0, problem.fixedCount);
          function visit(depth) {
            if (expired()) { reason = "inactivity"; return; }
            if (depth === permutation.length) {
              const order = prefix.concat(permutation); attempts++;
              tryOrder(order, evaluateOrder(problem, order, false, false));
              emit(); return;
            }
            const previous = depth ? permutation[depth - 1] : prefix.at(-1);
            const preferred = problem.unitNeighbors.get(previous) || [];
            const choices = Array.from({ length: permutation.length - depth }, (_, i) => i + depth)
              .sort((a, b) => Number(preferred.includes(permutation[b])) - Number(preferred.includes(permutation[a])));
            for (const i of choices) {
              [permutation[depth], permutation[i]] = [permutation[i], permutation[depth]]; visit(depth + 1);
              [permutation[depth], permutation[i]] = [permutation[i], permutation[depth]];
              if (reason === "inactivity") return;
            }
          }
          visit(0);
        } else {
          let working = bestOrder.slice(), value = evaluateOrder(problem, working), misses = 0;
          const rand = n => Math.min(n - 1, Math.floor(random() * n));
          function mutate(order, broad = false) {
            const result = order.slice(), i = problem.fixedCount + rand(freeCount);
            const neighbors = problem.neighbors.get(result[i]) || [];
            let j = broad || !neighbors.length || attempts % 16 === 0 ? problem.fixedCount + rand(freeCount)
              : result.indexOf(neighbors[rand(neighbors.length)]);
            if (j < problem.fixedCount) j = problem.fixedCount + rand(freeCount);
            const operation = rand(3);
            if (operation === 0) { const [id] = result.splice(i, 1); result.splice(j, 0, id); }
            else if (operation === 1) [result[i], result[j]] = [result[j], result[i]];
            else for (let a = Math.min(i, j), b = Math.max(i, j); a < b; a++, b--) [result[a], result[b]] = [result[b], result[a]];
            return result;
          }
          function restartInterleaved(entry) {
            if (!entry || bestMetrics.score <= lowerBound + epsilon || expired()) return entry;
            if (entry.interleaved) interleavedRestarts++;
            // A bounded uphill relocation keeps existing interleaving instead of flattening it into blocks.
            const choices = []; let checks = 0;
            for (const candidate of blockInsertions(problem, entry.route)) {
              if (expired()) break;
              attempts++; insertionAttempts++;
              checks++;
              if (Number.isFinite(candidate.score) && candidate.score <= entry.metrics.score + Math.max(4, problem.threshold * 2)) choices.push(candidate);
              if (choices.length >= 16 || checks >= 128) break;
            }
            if (!choices.length || expired()) return entry;
            const route = choices[rand(choices.length)].materialize();
            if (!route || model.validateRoute(route.path, problem.cells) || !model.satisfiesConstraints(route.path, problem.constraints)) return entry;
            const metrics = zones.measure(route.path, problem.threshold);
            publish(route, metrics, null, true, true);
            const result = refineRoute(route, metrics, true);
            return { ...result, order: routeOrder(result.route) };
          }
          while (!expired()) {
            let candidate = null;
            if (problem.unitEdges.length && attempts % 4 !== 3) {
              const edge = problem.unitEdges[unitAttempts % problem.unitEdges.length]; unitAttempts++;
              const from = working.indexOf(edge.from), to = working.indexOf(edge.to);
              if (from + 1 !== to) {
                candidate = working.slice();
                if (unitAttempts % 2 || from < problem.fixedCount) {
                  candidate.splice(to, 1); candidate.splice(candidate.indexOf(edge.from) + 1, 0, edge.to);
                } else {
                  candidate.splice(from, 1); candidate.splice(candidate.indexOf(edge.to), 0, edge.from);
                }
              }
            }
            candidate ||= mutate(working);
            const next = evaluateOrder(problem, candidate, false, false); attempts++;
            if (better(next.score, next.cuts, value.score, value.cuts)) {
              working = candidate; value = next; misses = 0;
              tryOrder(candidate, next);
            }
            else { misses++; tryOrder(candidate, next, false); }
            if (misses >= Math.max(100, freeCount)) {
              const entry = restartInterleaved(elite.length ? elite[restarts % elite.length] : null);
              working = (entry?.order || bestOrder).slice(); for (let i = 0; i < 4; i++) working = mutate(working, true);
              value = evaluateOrder(problem, working, false, false); misses = 0; restarts++;
            }
            emit();
          }
        }
      }
      while (true) {
        searchRound();
        if (bestMetrics.score <= lowerBound + epsilon) break;
        stage = "relay"; phase = "Recherche de relais"; relayPasses++;
        relay = { examined: 0, total: 0, attempts: 0, timedOut: false }; emit(true);
        let improved = false;
        const budgetMs = Math.min(15000, Math.max(250, initialLimit));
        for (const candidate of relaySearch.candidates({ path: best.path, constraints: problem.constraints,
          cutThreshold: problem.threshold, budgetMs }, progress => { relay = progress; emit(); })) {
          attempts++; relayAttempts++;
          if (candidate.score >= bestMetrics.score - epsilon) continue;
          const route = candidate.materialize();
          if (!route || model.validateRoute(route.path, problem.cells) || !model.satisfiesConstraints(route.path, problem.constraints)) continue;
          const metrics = zones.measure(route.path, problem.threshold);
          if (metrics.score >= bestMetrics.score - epsilon) continue;
          const changedDiagonals = candidate.moved.map(i => model.key(best.path[i]));
          if (!publish(route, metrics, null, false, false, { diagonals: changedDiagonals, link: candidate.relayLink })) continue;
          restarts++; improved = true; refined.clear();
          remember(best, bestMetrics); emit(true); break;
        }
        if (!improved) break;
      }
      stage = "complete"; phase = "Optimisation terminee : recherche et relais au plateau";
      const actualOrder = best.path.map(point => actionOwners.get(model.key(point))).filter((id, i, ids) => !i || id !== ids[i - 1]);
      const final = { method: "block-optimization", stage, phase, path: best.path, unitLinks: best.unitLinks, metrics: bestMetrics,
        initialMetrics, blocks, elapsedMs: clock() - started, lastImprovementMs: clock() - lastImprovement,
        stagnationLimitMs: limit, attempts, improvements, restarts, unitAttempts, unitConnections: problem.unitEdges.length, insertionAttempts, insertions,
        refinedOrders, intermediateImprovements, interleavedRestarts, relay, relayPasses, relayImprovements, relayAttempts, relayChange, lastRelayImprovement,
        progress: 100, reason, order: actualOrder };
      report(final); return final;
    }
    return { prepareProblem, evaluateOrder, materialize, blockInsertions, optimizePath, compareMetrics, satisfiesConstraints: model.satisfiesConstraints };
  }
  function workerMain(createModel, createBuilder, createOptimizer, createRelay) {
    self.onmessage = event => {
      const options = event.data;
      if (options.type !== "start") return;
      try {
        const result = createOptimizer(createModel(), createBuilder, undefined, undefined, createRelay).optimizePath(options,
          snapshot => self.postMessage({ ...snapshot, type: "progress", runId: options.runId }));
        self.postMessage({ ...result, type: "complete", runId: options.runId });
      } catch (error) { self.postMessage({ type: "error", runId: options.runId, message: error.message }); }
    };
  }
  root.createPathOptimizerApi = () => createBlockOptimizer(root.StitchModel, root.createOrthogonalPathBuilder);
  root.createPathOptimizerWorker = () => {
    const source = `(${workerMain.toString()})(${root.createStitchModel.toString()},${root.createOrthogonalPathBuilder.toString()},${createBlockOptimizer.toString()},${root.createRelaySearch.toString()});`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url); URL.revokeObjectURL(url); return worker;
  };
  if (typeof module !== "undefined") module.exports = { createBlockOptimizer };
})(typeof window === "undefined" ? globalThis : window);
