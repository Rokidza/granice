// Copies the browser bundles of the dependencies into web/vendor/, so the page runs with no
// internet access and no build step. Run after `npm install`: npm run vendor

import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  ["maplibre-gl/dist/maplibre-gl.js", "maplibre-gl.js"],
  ["maplibre-gl/dist/maplibre-gl.css", "maplibre-gl.css"],
  ["pmtiles/dist/pmtiles.js", "pmtiles.js"],
  ["@protomaps/basemaps/dist/basemaps.js", "basemaps.js"],
];

mkdirSync(join(web, "vendor"), { recursive: true });
for (const [from, to] of files) {
  cpSync(join(web, "node_modules", from), join(web, "vendor", to));
  console.log(`vendor/${to}`);
}
