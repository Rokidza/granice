// Colours of the map: the segments in the chosen band of pair distances and the road categories.
//
// There is no colour scale: a segment is either in the band the planner picked (red) or not
// coloured at all.
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

// The Granična linija: dash-dot in a colour no road has (roads are white, grey and yellow-brown),
// drawn over a dark casing.
export const BORDER_COLORS = {
  light: { line: "#c0149a", casing: "#ffffff" },
  dark: { line: "#ff3fd8", casing: "#1a0716" },
};

// Kritično područje blizu granice and the highlighted pair of Staze of a chosen area.
export const DANGER = { light: "#c73751", dark: "#ff4d5e" };

// The pins on the map (drawn once, with a white outline, so one colour serves both themes): a
// Kritično područje without water between the pair, one with a river between, an Izravni prelazak.
export const PINS = { kopno: "#c73751", rijeka: "#0a6cff", izravni: "#161615" };

// Riječna granica: the stretches of the border that run along a river, bright blue.
export const RIVER = { light: "#0a6cff", dark: "#3d9bff" };

// The selected segment and its details box: bright yellow, a colour nothing else on the map uses,
// drawn over the CASING so it shows on a light basemap too.
export const SELECTED = { light: "#ffd400", dark: "#ffe600" };

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
