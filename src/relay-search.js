(function (root) {
  "use strict";
  function createRelaySearch(model, builder, clock = () => performance.now()) {
    const epsilon = 1e-8;
    function segmentDistance(point, a, b) {
      const dx = b.x - a.x, dy = b.y - a.y, square = dx * dx + dy * dy;
      const t = square ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / square)) : 0;
      return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
    }
    // Range matrices evaluate every sewing direction, including the gap left by a moved diagonal.
    function transfers(path, threshold, fixed) {
      const leaves = path.map((point, i) => {
        const variants = [1, -1].map(direction => ({ ...point, direction }));
        return { first: variants, last: variants,
          scores: [fixed(i) && point.direction === -1 ? Infinity : 0, Infinity, Infinity,
            fixed(i) && point.direction === 1 ? Infinity : 0] };
      });
      function join(a, b) {
        if (!a || !b) return a || b;
        const edges = [0, 1, 2, 3].map(i => model.cost(a.last[i >> 1], b.first[i & 1], threshold, true));
        const scores = [Infinity, Infinity, Infinity, Infinity];
        for (let start = 0; start < 2; start++) for (let end = 0; end < 2; end++) {
          for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) {
            scores[start * 2 + end] = Math.min(scores[start * 2 + end], a.scores[start * 2 + x] + edges[x * 2 + y] + b.scores[y * 2 + end]);
          }
        }
        return { first: a.first, last: b.last, scores };
      }
      let size = 1;
      while (size < path.length) size *= 2;
      const tree = new Array(size * 2);
      leaves.forEach((leaf, i) => { tree[size + i] = leaf; });
      for (let i = size - 1; i > 0; i--) tree[i] = join(tree[i * 2], tree[i * 2 + 1]);
      function range(start, end) {
        let a = null, b = null;
        for (start += size, end += size; start < end; start >>= 1, end >>= 1) {
          if (start & 1) a = join(a, tree[start++]);
          if (end & 1) b = join(tree[--end], b);
        }
        return join(a, b);
      }
      return pieces => Math.min(...pieces.reduce((value, [a, b]) => join(value, range(a, b)), null).scores);
    }
    function* candidates(options, report = () => {}) {
      const { path, constraints = {} } = options, threshold = options.cutThreshold || 10;
      const locked = Math.max(constraints.lockedPrefix?.length || 0, Number(Boolean(constraints.start)));
      const fixed = i => i < locked;
      const started = clock(), budget = Math.max(1, options.budgetMs || 15000), expired = () => clock() - started >= budget;
      const links = [];
      for (let i = 1; i < path.length; i++) {
        const length = model.distance(path[i - 1], path[i]);
        if (length > Math.SQRT2 + epsilon && (!fixed(i - 1) || !fixed(i))) {
          links.push({ at: i, length, cost: model.cost(path[i - 1], path[i], threshold, true) });
        }
      }
      links.sort((a, b) => b.cost - a.cost || b.length - a.length || a.at - b.at);
      let examined = 0, attempts = 0, timedOut = false;
      const notify = () => report({ examined, total: links.length, attempts, timedOut });
      notify();
      if (!links.length) return;
      const score = transfers(path, threshold, fixed), byKey = new Map(path.map((p, i) => [model.key(p), i]));
      const fixedPoints = path.filter((_, i) => fixed(i));
      const bins = new Map(), binSize = 8;
      path.forEach((p, i) => {
        if (fixed(i)) return;
        const x = Math.floor(p.x / binSize), y = Math.floor(p.y / binSize), key = `${x},${y}`;
        if (!bins.has(key)) bins.set(key, { x, y, indices: [] });
        bins.get(key).indices.push(i);
      });
      function nearby(a, b, link) {
        const maximum = Math.max(2.5, link.length / 2), visited = new Set(), measured = [];
        let radius = 2.5, work = 0;
        const interrupted = () => {
          if (++work % 64 === 0 && expired()) timedOut = true;
          return timedOut;
        };
        while (true) {
          if (expired()) { timedOut = true; return []; }
          const minX = Math.floor((Math.min(a.x, b.x) - radius - 1) / binSize);
          const maxX = Math.floor((Math.max(a.x, b.x) + radius) / binSize);
          const minY = Math.floor((Math.min(a.y, b.y) - radius - 1) / binSize);
          const maxY = Math.floor((Math.max(a.y, b.y) + radius) / binSize);
          function scan(bin) {
            if (!bin || visited.has(bin) || bin.x < minX || bin.x > maxX || bin.y < minY || bin.y > maxY) return;
            // Every hole in this bin lies inside its circumscribed circle.
            const center = { x: (bin.x + 0.5) * binSize, y: (bin.y + 0.5) * binSize };
            if (segmentDistance(center, a, b) > radius + binSize * Math.SQRT1_2 + epsilon) return;
            visited.add(bin);
            for (const i of bin.indices) {
              if (interrupted()) return;
              if (i === link.at || i === link.at - 1) continue;
              const holes = model.holes(path[i]);
              const distance = Math.min(segmentDistance(holes.start, a, b), segmentDistance(holes.end, a, b));
              measured.push({ i, distance });
            }
          }
          const area = (maxX - minX + 1) * (maxY - minY + 1);
          if (area > bins.size) {
            for (const bin of bins.values()) { if (interrupted()) break; scan(bin); }
          } else {
            for (let y = minY; y <= maxY && !timedOut; y++) for (let x = minX; x <= maxX; x++) {
              if (interrupted()) break;
              scan(bins.get(`${x},${y}`));
            }
          }
          if (timedOut) return [];
          const found = measured.filter(item => item.distance <= radius);
          if (found.length >= 64 || radius >= maximum) {
            return found.sort((a, b) => a.distance - b.distance || a.i - b.i).slice(0, 64).map(item => item.i);
          }
          radius = Math.min(maximum, radius * 2);
        }
      }
      function legal(moved, rank) {
        return moved.every(i => {
          const p = path[i], other = byKey.get(`${model.cellKey(p)}:${p.diagonal === "lower" ? "upper" : "lower"}`);
          return other !== undefined && (p.diagonal === "lower" ? rank(i) < rank(other) : rank(i) > rank(other));
        });
      }
      function proposal(pieces, moved, rank, link, kind) {
        if (!legal(moved, rank)) return null;
        attempts++;
        const value = score(pieces);
        return { score: value, kind, moved, from: moved[0], to: moved[1] ?? link.at, link: link.at,
          relayLink: { rank: examined + 1, total: links.length, length: link.length },
          materialize() {
            const sequence = [];
            for (const [a, b] of pieces) for (let i = a; i < b; i++) sequence.push(path[i]);
            // orientUnitPath uses this list as fixed directions; route-order constraints are checked by the caller.
            const oriented = builder.orientUnitPath(sequence, [], { ...constraints, lockedPrefix: fixedPoints }, threshold);
            if (!oriented) return null;
            const originals = new Map(path.map(p => [model.key(p), p]));
            return { path: oriented.path.map(p => ({ ...originals.get(model.key(p)), direction: p.direction })),
              unitLinks: oriented.path.map((p, i) => i > 0 && model.distance(oriented.path[i - 1], p) === 1) };
          } };
      }
      for (const link of links) {
        if (expired()) { timedOut = true; break; }
        const to = link.at, a = model.holes(path[to - 1]).end, b = model.holes(path[to]).start;
        for (const from of nearby(a, b, link)) {
          if (expired()) { timedOut = true; break; }
          if (to >= locked) {
            const pieces = from < to ? [[0, from], [from + 1, to], [from, from + 1], [to, path.length]]
              : [[0, to], [from, from + 1], [to, from], [from + 1, path.length]];
            const rank = i => i === from ? (from < to ? to - 1 : to)
              : from < to && i > from && i < to ? i - 1 : from > to && i >= to && i < from ? i + 1 : i;
            const candidate = proposal(pieces, [from], rank, link, "relocate");
            if (candidate) yield candidate;
          }
          for (const target of [to - 1, to]) {
            if (fixed(target) || target === from) continue;
            const [i, j] = [Math.min(from, target), Math.max(from, target)];
            const pieces = [[0, i], [j, j + 1], [i + 1, j], [i, i + 1], [j + 1, path.length]];
            const candidate = proposal(pieces, [from, target], k => k === from ? target : k === target ? from : k, link, "swap");
            if (candidate) yield candidate;
          }
        }
        examined++; notify();
        if (timedOut) break;
      }
      notify();
    }
    return { candidates, segmentDistance, transfers };
  }
  root.createRelaySearch = createRelaySearch;
  if (typeof module !== "undefined") module.exports = { createRelaySearch };
})(typeof window === "undefined" ? globalThis : window);
