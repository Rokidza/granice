// Validates the colour scales for both themes: lightness order and steps, single hue, contrast
// against the surface, and separation under colour-vision-deficiency simulation.
// Method after the dataviz checks: OKLab distance x100, Machado et al. 2009 at severity 1.0.
// Usage: npm run check-colors   (exit code 1 on any failure)

import {
  CASING,
  HUE,
  STAZA_COLORS,
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
const MIN_SURFACE_CONTRAST = 2.0; // faintest end vs surface (it is meant to recede, not vanish)
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
const hueOf = (hex) => {
  const [, a, b] = lab(hex);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
};

let failures = 0;
const report = (ok, name, detail) => {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}: ${detail}`);
  if (!ok) failures += 1;
};

for (const theme of ["light", "dark"]) {
  const surface = SURFACES[theme];
  const stops = Array.from({ length: SAMPLES }, (_, i) => riskColor(i / (SAMPLES - 1), theme));
  console.log(`\nRisk scale, ${theme} theme, surface ${surface}: ${stops.join(" ")}`);

  const lightness = stops.map((hex) => lab(hex)[0]);
  const direction = theme === "light" ? -1 : 1; // prominence rises with risk
  const steps = lightness.slice(1).map((l, i) => (l - lightness[i]) * direction);
  report(
    Math.min(...steps) >= MIN_STEP_DL,
    "lightness steps",
    `smallest step ${Math.min(...steps).toFixed(3)} (need >= ${MIN_STEP_DL}, monotone)`,
  );

  const hues = stops.map(hueOf);
  const spread = Math.max(...hues) - Math.min(...hues);
  report(spread <= 12, "single hue", `hue spread ${spread.toFixed(1)} degrees around ${HUE}`);

  const faint = stops[0];
  report(
    contrast(faint, surface) >= MIN_SURFACE_CONTRAST,
    "faintest end vs surface",
    `${contrast(faint, surface).toFixed(2)}:1 (need >= ${MIN_SURFACE_CONTRAST})`,
  );
  report(
    contrast(faint, CASING[theme]) >= 3 || contrast(faint, surface) >= 3,
    "faintest end vs casing",
    `${contrast(faint, CASING[theme]).toFixed(2)}:1 (need >= 3 against casing or surface)`,
  );
  const strong = stops[SAMPLES - 1];
  report(
    Math.max(contrast(strong, surface), contrast(strong, CASING[theme])) >= 3,
    "strongest end vs surface or casing",
    `${contrast(strong, surface).toFixed(2)}:1 / ${contrast(strong, CASING[theme]).toFixed(2)}:1 (need >= 3)`,
  );

  for (const [name, matrix] of Object.entries(CVD)) {
    const simulated = stops.map((hex) => simulate(hex, matrix));
    const worst = Math.min(...simulated.slice(1).map((hex, i) => deltaE(hex, simulated[i])));
    report(worst >= MIN_CVD_DELTA_E, `adjacent steps under ${name}`, `worst delta E ${worst.toFixed(1)} (need >= ${MIN_CVD_DELTA_E})`);
  }
}

// The two Strane must stay apart from each other under every vision type and against the surface.
for (const theme of ["light", "dark"]) {
  const { HR, BiH } = STAZA_COLORS[theme];
  console.log(`\nStaza colours, ${theme} theme: HR ${HR}, BiH ${BiH}`);
  report(deltaE(HR, BiH) >= 15, "HR vs BiH (normal vision)", deltaE(HR, BiH).toFixed(1));
  for (const [name, matrix] of Object.entries(CVD)) {
    const d = deltaE(simulate(HR, matrix), simulate(BiH, matrix));
    report(d >= 8, `HR vs BiH under ${name}`, d.toFixed(1));
  }
  for (const [side, hex] of Object.entries(STAZA_COLORS[theme])) {
    report(contrast(hex, SURFACES[theme]) >= 3, `${side} vs surface`, `${contrast(hex, SURFACES[theme]).toFixed(2)}:1`);
  }
}

console.log(failures === 0 ? "\nAll colour checks pass." : `\n${failures} colour check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
