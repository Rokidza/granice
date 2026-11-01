// Cuts data/out/staze.geojson into static vector tiles (z/x/y.pbf, layer "staze") for the page to
// read instead of the 18 MB layer: the map then fetches only the tiles in view, simplified for the
// zoom. Used by build-dist.mjs. Tiles stop at MAX_ZOOM and are overzoomed beyond it.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";

export const MAX_ZOOM = 12;
const MIN_ZOOM_STAZA = 9; // footpaths are left out of tiles below this zoom: too thin to see zoomed out

/** Writes the tiles under `dir`; returns how many. */
export function buildTiles(staze, dir) {
  const index = geojsonvt(staze, { maxZoom: MAX_ZOOM, indexMaxZoom: MAX_ZOOM, tolerance: 3, extent: 4096, buffer: 64 });
  const [west, south, east, north] = staze.features.reduce(
    ([w, s, e, n], { geometry }) => geometry.coordinates.reduce(
      ([w, s, e, n], [lon, lat]) => [Math.min(w, lon), Math.min(s, lat), Math.max(e, lon), Math.max(n, lat)], [w, s, e, n]),
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  const tileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const tileY = (lat, z) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  };
  let count = 0;
  for (let z = 0; z <= MAX_ZOOM; z++) {
    for (let x = tileX(west, z); x <= tileX(east, z); x++) {
      for (let y = tileY(north, z); y <= tileY(south, z); y++) {
        const tile = index.getTile(z, x, y);
        if (!tile) continue;
        const features = z < MIN_ZOOM_STAZA ? tile.features.filter((f) => f.tags.kategorija !== "staza") : tile.features;
        if (!features.length) continue;
        mkdirSync(join(dir, String(z), String(x)), { recursive: true });
        writeFileSync(join(dir, String(z), String(x), `${y}.pbf`), vtpbf.fromGeojsonVt({ staze: { ...tile, features } }, { version: 2 }));
        count++;
      }
    }
  }
  return count;
}
