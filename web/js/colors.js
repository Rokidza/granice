// Sequential colour scale for Rizik prelaska: one hue, interpolated in OKLab.
//
// Light theme: pale and faint (low risk) to dark and saturated (high risk).
// Dark theme: the dark end would vanish into the surface, so the same idea flips its anchor:
// faint and dim (low risk) to bright and saturated (high risk). Prominence always means risk.
// Run `npm run check-colors` after changing anything here.

export const HUE = 330; // magenta-purple: stays clear of the blue (HR) and orange (BiH) Staze

// OKLCH anchors of the two ends of the scale: [lightness, chroma].
export const ANCHORS = {
  light: { low: [0.76, 0.08], high: [0.3, 0.15] },
  dark: { low: [0.46, 0.08], high: [0.8, 0.19] },
};

export const SURFACES = { light: "#fcfcfb", dark: "#1a1a19" };

// Thin neutral casing under the risk lines, so each end of the scale stands out from the map.
export const CASING = { light: "#52514e", dark: "#c3c2b7" };

const toRad = (deg) => (deg * Math.PI) / 180;

function oklchToOklab([l, c, h]) {
  return [l, c * Math.cos(toRad(h)), c * Math.sin(toRad(h))];
}

export function oklabToLinear([l, a, b]) {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const [x, y, z] = [l_ ** 3, m_ ** 3, s_ ** 3];
  return [
    4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
    -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
    -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z,
  ];
}

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
const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

export function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => decode(v / 255));
}

export function linearToHex(rgb) {
  const bytes = rgb.map((v) => Math.round(Math.min(1, Math.max(0, encode(v))) * 255));
  return "#" + bytes.map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Reduces chroma (keeping lightness and hue) until the colour fits in sRGB.
function fitToGamut([l, a, b]) {
  let scale = 1;
  for (let i = 0; i < 40; i++) {
    const rgb = oklabToLinear([l, a * scale, b * scale]);
    if (inGamut(rgb)) return rgb;
    scale *= 0.95;
  }
  return oklabToLinear([l, 0, 0]);
}

/** Colour for a risk index in [0, 1] (1 = highest risk) as "#rrggbb". */
export function riskColor(index, theme) {
  const t = Math.min(1, Math.max(0, index));
  const low = oklchToOklab([...ANCHORS[theme].low, HUE]);
  const high = oklchToOklab([...ANCHORS[theme].high, HUE]);
  const lab = low.map((v, i) => v + (high[i] - v) * t);
  return linearToHex(fitToGamut(lab));
}

/** `count` evenly spaced stops of the scale, as [index, colour] pairs. */
export function riskStops(theme, count = 17) {
  return Array.from({ length: count }, (_, i) => {
    const index = i / (count - 1);
    return [index, riskColor(index, theme)];
  });
}

export const STAZA_COLORS = {
  light: { HR: "#2a78d6", BiH: "#eb6834" },
  dark: { HR: "#3987e5", BiH: "#d95926" },
};
