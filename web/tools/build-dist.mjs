// Assembles the folder that is deployed to Netlify (web/dist/): the static page, the vendored
// libraries and the layers computed by the pipeline, side by side. The layers are not in git
// (data/ is ignored), so this runs on a machine that has them. Usage: npm run build
// The folder is self-contained: drag it onto https://app.netlify.com/drop.
//
// Needs `python -m granice refresh|compute` (data/out/) and `npm run vendor` (web/vendor/) first.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(web, "dist");
const dataOut = join(web, "..", "data", "out");

const PAGE_FILES = ["index.html", "app.js", "style.css", "js/colors.js", "js/critical.js", "js/package.json"];
const VENDOR_FILES = ["maplibre-gl.js", "maplibre-gl.css", "pmtiles.js", "basemaps.js"];
const DATA_FILES = ["meta.json", "staze.geojson", "granica.geojson", "segmenti.geojson", "prijelazi.geojson"];

const missing = [
  ...VENDOR_FILES.map((f) => join(web, "vendor", f)),
  ...DATA_FILES.map((f) => join(dataOut, f)),
].filter((path) => !existsSync(path));
if (missing.length) {
  console.error("Missing inputs, run `python -m granice compute` and `npm run vendor` first:");
  for (const path of missing) console.error("  " + path);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "js"), { recursive: true });
mkdirSync(join(out, "vendor"), { recursive: true });
mkdirSync(join(out, "data"), { recursive: true });

for (const file of PAGE_FILES) cpSync(join(web, file), join(out, file));
for (const file of VENDOR_FILES) cpSync(join(web, "vendor", file), join(out, "vendor", file));
for (const file of DATA_FILES) cpSync(join(dataOut, file), join(out, "data", file));

// In the repo the page sits next to ../data/; in dist/ the data sits inside it.
const config = readFileSync(join(web, "config.js"), "utf8");
const deployed = config.replaceAll("../data/out/", "data/").replaceAll("../data/", "data/");
if (deployed.includes("../")) throw new Error("config.js still points outside dist/");
writeFileSync(join(out, "config.js"), deployed);

// Netlify applies this file to a drag-and-drop deploy as well as to a CLI one (netlify.toml only to the latter).
writeFileSync(
  join(out, "_headers"),
  [
    "/*",
    "  X-Robots-Tag: noindex, nofollow",
    "  Referrer-Policy: no-referrer",
    "  X-Content-Type-Options: nosniff",
    "  X-Frame-Options: DENY",
    "/data/*",
    "  Cache-Control: no-store",
    "",
  ].join("\n"),
);

console.log(`web/dist ready (${DATA_FILES.length} data files). Drop the folder on https://app.netlify.com/drop`);
