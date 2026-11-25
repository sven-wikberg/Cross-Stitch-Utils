(function (root) {
  "use strict";
  const colors = typeof module !== "undefined" && module.exports
    ? require("../data/dmc-colors.json") : root.DMC_COLORS || [];
  const byCode = new Map(colors.map(color => [color.code, color.hex]));

  function normalizeCode(code) {
    const value = String(code ?? "").trim().toUpperCase();
    if (/^\d+$/.test(value)) return String(Number(value)).padStart(2, "0");
    return value === "WHITE" ? "BLANC" : value;
  }

  function hex(color, fallback = "#d9dddd") {
    const brand = String(color?.brand || "DMC").trim().toUpperCase();
    const series = String(color?.series || "Mouline Special").normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    const reference = brand === "DMC" && series === "mouline special"
      ? byCode.get(normalizeCode(color?.dmc ?? color?.code)) : null;
    // Resolve only the display color; imported paths and their hashes stay unchanged.
    return reference || (/^#[\da-f]{6}$/i.test(color?.hex || "") ? color.hex : fallback);
  }

  const api = { hex };
  root.DmcPalette = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
