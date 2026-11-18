(function (root) {
  "use strict";
  function createPathViewport(ruler = 26) {
    let width = 1, height = 1, columns = 1, rows = 1, scale = 1, x = 0, y = 0, fitted = true;
    const fitScale = () => Math.max(Number.EPSILON, Math.min(18, (width - ruler) / columns, (height - ruler) / rows));
    const clamp = () => {
      x = Math.max(0, Math.min(x, Math.max(0, columns - (width - ruler) / scale)));
      y = Math.max(0, Math.min(y, Math.max(0, rows - (height - ruler) / scale)));
    };
    const toWorld = point => ({ x: x + (point.x - ruler) / scale, y: y + (point.y - ruler) / scale });
    const toScreen = point => ({ x: ruler + (point.x - x) * scale, y: ruler + (point.y - y) * scale });
    const fit = () => { scale = fitScale(); x = 0; y = 0; fitted = true; };
    function resize(w, h) {
      const center = toWorld({ x: (width + ruler) / 2, y: (height + ruler) / 2 });
      width = Math.max(ruler + 1, w); height = Math.max(ruler + 1, h);
      if (fitted) fit();
      else { x = center.x - (width - ruler) / scale / 2; y = center.y - (height - ruler) / scale / 2; clamp(); }
    }
    function zoom(factor, anchor = { x: (width + ruler) / 2, y: (height + ruler) / 2 }) {
      const world = toWorld(anchor);
      scale = Math.max(fitScale(), Math.min(80, scale * factor));
      x = world.x - (anchor.x - ruler) / scale; y = world.y - (anchor.y - ruler) / scale;
      fitted = Math.abs(scale - fitScale()) < 1e-8; clamp();
    }
    function pan(dx, dy) { x -= dx / scale; y -= dy / scale; fitted = false; clamp(); }
    function center(point) {
      x = point.x - (width - ruler) / scale / 2; y = point.y - (height - ruler) / scale / 2;
      fitted = false; clamp();
    }
    function frame(bounds) {
      const w = Math.max(2, bounds.maxX - bounds.minX + 4), h = Math.max(2, bounds.maxY - bounds.minY + 4);
      scale = Math.max(fitScale(), Math.min(48, (width - ruler) / w, (height - ruler) / h));
      center({ x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 });
    }
    return { resize, fit, zoom, pan, center, frame, toWorld, toScreen,
      setGrid(w, h) { columns = Math.max(1, w); rows = Math.max(1, h); fit(); },
      get state() { return { width, height, columns, rows, scale, x, y, zoom: scale / fitScale(), fitted }; },
      get bounds() { return { minX: x, minY: y, maxX: Math.min(columns, x + (width - ruler) / scale),
        maxY: Math.min(rows, y + (height - ruler) / scale) }; }
    };
  }
  root.createPathViewport = createPathViewport;
  if (typeof module !== "undefined") module.exports = { createPathViewport };
})(typeof window === "undefined" ? globalThis : window);
