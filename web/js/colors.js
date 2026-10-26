// Colours of the map: the Rizik prelaska scale, the road categories and the Kritična područja marks.
//
// Risk is a warm heat scale, pale yellow (low) through orange to red (high), the same in both
// themes: yellow is pale on a light surface and bright on a dark one, red reads on both, and a
// thin dark casing keeps the pale end from vanishing on a light map.
// Run `npm run check-colors` after changing anything here.

// OKLCH anchors of the risk scale, low to high: [lightness, chroma, hue].
export const RISK_ANCHORS = [
  [0.94, 0.15, 100],
  [0.76, 0.17, 58],
  [0.52, 0.21, 25],
];

export const SURFACES = { light: "#fcfcfb", dark: "#1a1a19" };

// Thin neutral casing under the risk band, so each end of the scale stands out from the map.
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

// Kritična područja: red circles.
export const DANGER = { light: "#d7263d", dark: "#ff4d5e" };

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
export function riskColor(index) {
  const t = Math.min(1, Math.max(0, index)) * (RISK_ANCHORS.length - 1);
  const i = Math.min(Math.floor(t), RISK_ANCHORS.length - 2);
  const low = oklchToOklab(RISK_ANCHORS[i]);
  const high = oklchToOklab(RISK_ANCHORS[i + 1]);
  const lab = low.map((v, k) => v + (high[k] - v) * (t - i));
  return linearToHex(fitToGamut(lab));
}

/** `count` evenly spaced stops of the scale, as [index, colour] pairs. */
export function riskStops(count = 17) {
  return Array.from({ length: count }, (_, i) => {
    const index = i / (count - 1);
    return [index, riskColor(index)];
  });
}
