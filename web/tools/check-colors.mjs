// Validates the map colours for both themes: the risk scale (lightness order and steps, contrast
// against the surface or casing, separation under colour-vision-deficiency simulation), the road
// categories and the Kritična područja red.
// Method after the dataviz checks: OKLab distance x100, Machado et al. 2009 at severity 1.0.
// Usage: npm run check-colors   (exit code 1 on any failure)

import {
  CASING,
  DANGER,
  ROAD_STYLES,
  SURFACES,
  hexToLinear,
  linearToHex,
  linearToOklab,
  riskColor,
} from "../js/colors.js";

const CVD = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

const SAMPLES = 6; // discrete steps compared by eye; the scale itself is continuous
const MIN_STEP_DL = 0.06; // adjacent lightness step
const MIN_CVD_DELTA_E = 6;

const simulate = (hex, matrix) =>
  linearToHex(matrix.map((row) => row.reduce((sum, m, i) => sum + m * hexToLinear(hex)[i], 0)));
const lab = (hex) => linearToOklab(hexToLinear(hex));
const deltaE = (a, b) => 100 * Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
const luminance = (hex) => {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

let failures = 0;
const report = (ok, name, detail) => {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}: ${detail}`);
  if (!ok) failures += 1;
};

// The scale is the same in both themes; what differs is the surface and casing it sits on.
const stops = Array.from({ length: SAMPLES }, (_, i) => riskColor(i / (SAMPLES - 1)));
console.log(`
Risk scale: ${stops.join(" ")}`);
const lightness = stops.map((hex) => lab(hex)[0]);
const steps = lightness.slice(1).map((l, i) => lightness[i] - l); // darker = higher risk
report(
  Math.min(...steps) >= MIN_STEP_DL,
  "lightness steps",
  `smallest step ${Math.min(...steps).toFixed(3)} (need >= ${MIN_STEP_DL}, monotone)`,
);
for (const [name, matrix] of Object.entries(CVD)) {
  const simulated = stops.map((hex) => simulate(hex, matrix));
  const worst = Math.min(...simulated.slice(1).map((hex, i) => deltaE(hex, simulated[i])));
  report(worst >= MIN_CVD_DELTA_E, `adjacent steps under ${name}`, `worst delta E ${worst.toFixed(1)} (need >= ${MIN_CVD_DELTA_E})`);
}

for (const theme of ["light", "dark"]) {
  const surface = SURFACES[theme];
  console.log(`
${theme} theme, surface ${surface}, casing ${CASING[theme]}`);
  const faint = stops[0];
  const strong = stops[SAMPLES - 1];
  const seen = (hex) => Math.max(contrast(hex, surface), contrast(hex, CASING[theme]));
  report(seen(faint) >= 3, "faintest risk end vs surface or casing", `${seen(faint).toFixed(2)}:1 (need >= 3)`);
  report(seen(strong) >= 3, "strongest risk end vs surface or casing", `${seen(strong).toFixed(2)}:1 (need >= 3)`);

  const roads = ROAD_STYLES[theme];
  for (const [category, { fill, casing }] of Object.entries(roads)) {
    const visible = Math.max(contrast(fill, surface), contrast(fill, casing));
    report(visible >= 3, `${category} vs surface or its casing`, `${visible.toFixed(2)}:1 (need >= 3)`);
  }
  report(
    deltaE(roads.cesta.fill, roads.makadam.fill) >= 15 && deltaE(roads.makadam.fill, roads.staza.fill) >= 8,
    "road categories apart",
    `cesta/makadam ${deltaE(roads.cesta.fill, roads.makadam.fill).toFixed(1)}, makadam/staza ${deltaE(roads.makadam.fill, roads.staza.fill).toFixed(1)}`,
  );
  report(contrast(DANGER[theme], surface) >= 3, "Kritično područje red vs surface", `${contrast(DANGER[theme], surface).toFixed(2)}:1`);
}

console.log(failures === 0 ? "\nAll colour checks pass." : `\n${failures} colour check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
