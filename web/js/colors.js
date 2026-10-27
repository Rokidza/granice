// Colours of the map: the segments in the chosen band of pair distances, the road categories and
// the Kritična područja marks.
//
// There is no colour scale: a segment is either in the band the planner picked (red, the same red
// as the circles around Kritična područja) or not coloured at all.
// Run `npm run check-colors` after changing anything here.

export const SURFACES = { light: "#fcfcfb", dark: "#1a1a19" };

// Thin neutral casing under the red band and the Nedovoljno podataka hatch, so they stand out
// from the map.
export const CASING = { light: "#3d3c39", dark: "#0d0d0d" };

// Road categories drawn like a road map: roads white with an outline, tracks brown, paths dashed.
export const ROAD_STYLES = {
  light: {
    cesta: { fill: "#ffffff", casing: "#85847d" },
    makadam: { fill: "#b5793a", casing: "#ffffff" },
    staza: { fill: "#7b4a1e", casing: "#ffffff" },
  },
  dark: {
    cesta: { fill: "#dedcd5", casing: "#0d0d0d" },
    makadam: { fill: "#e3a85c", casing: "#0d0d0d" },
    staza: { fill: "#f2d3a0", casing: "#0d0d0d" },
  },
};

// The Granična linija: dash-dot, neutral, drawn over a casing of the opposite lightness.
export const BORDER_COLORS = {
  light: { line: "#1f1f1e", casing: "#ffffff" },
  dark: { line: "#f4f2ec", casing: "#0d0d0d" },
};

// Segments in the band and the circles around Kritična područja.
export const DANGER = { light: "#c73751", dark: "#ff4d5e" };

// Riječna granica: the stretches of the border that run along a river, bright blue.
export const RIVER = { light: "#0a6cff", dark: "#3d9bff" };

export function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const encode = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const decode = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

export function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => decode(v / 255));
}

export function linearToHex(rgb) {
  const bytes = rgb.map((v) => Math.round(Math.min(1, Math.max(0, encode(v))) * 255));
  return "#" + bytes.map((v) => v.toString(16).padStart(2, "0")).join("");
}
