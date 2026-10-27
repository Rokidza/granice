// Kritična područja computed in the browser from the band of pair distances the planner picks
// (e.g. 1000–1200 m). The pipeline's kriticna_podrucja.geojson (risk.py, _kriticna_podrucja) still
// uses its index threshold and is meant for other tools; the page does not read it.

/**
 * Whether a segment is assessed and its nearest pair of Staze lies within the band, both ends
 * included. With `skipRiver` a segment on Riječna granica (`na_rijeci`) never is. `bandFilter` in app.js is the same test as a map expression; keep the two in step.
 * @param {{minM: number, maxM: number, skipRiver?: boolean}} band
 */
export function inBand(p, band) {
  return p.stanje === "procijenjen" && p.udaljenost_m >= band.minM && p.udaljenost_m <= band.maxM
    && !(band.skipRiver && p.na_rijeci);
}

/**
 * The Staze of the nearest pairs of segments within the band, per Strana: OSM way id → how far
 * from the border its end of the pair lies, one value per segment it is the nearest Staza of.
 * @returns {{HR: Map<number, number[]>, BiH: Map<number, number[]>}}
 */
export function includedStaze(segments, band) {
  const included = { HR: new Map(), BiH: new Map() };
  for (const { properties: p } of segments) {
    if (!inBand(p, band)) continue;
    for (const [strana, prefix] of [["HR", "hr"], ["BiH", "bih"]]) {
      const id = p[`${prefix}_staza_id`];
      const distances = included[strana].get(id) ?? [];
      distances.push(p[`${prefix}_od_granice_m`]);
      included[strana].set(id, distances);
    }
  }
  return included;
}

/**
 * Runs of adjacent segments within the band, longest first and then by the closest pair.
 * @param {object[]} segments GeoJSON features from segmenti.geojson
 */
export function kriticnaPodrucja(segments, band) {
  const ordered = [...segments].sort(
    (a, b) => a.properties.lanac - b.properties.lanac || a.properties.red - b.properties.red,
  );
  const runs = [];
  let previous = null;
  for (const segment of ordered) {
    const p = segment.properties;
    if (!inBand(p, band)) {
      previous = null;
      continue;
    }
    if (previous && previous.lanac === p.lanac && previous.red + 1 === p.red) {
      runs[runs.length - 1].push(segment);
    } else {
      runs.push([segment]);
    }
    previous = p;
  }
  const areas = runs.map((run) => ({
    lanac: run[0].properties.lanac,
    firstSegment: run[0].properties.id,
    lastSegment: run[run.length - 1].properties.id,
    segmentCount: run.length,
    lengthM: run.reduce((sum, s) => sum + s.properties.duljina_m, 0),
    minDistanceM: Math.min(...run.map((s) => s.properties.udaljenost_m)),
    maxDistanceM: Math.max(...run.map((s) => s.properties.udaljenost_m)),
    segments: run,
  }));
  areas.sort((a, b) => b.lengthM - a.lengthM || a.minDistanceM - b.minDistanceM);
  return areas.map((area, i) => ({ rang: i + 1, ...area }));
}

/** Bounding box [[west, south], [east, north]] of an area. */
export function areaBounds(area) {
  const coords = area.segments.flatMap((s) => s.geometry.coordinates);
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

const METRES_PER_DEGREE = 111320;

/** Circle around an area, for marking it on the map: centre in degrees, radius in metres. */
export function areaCircle(area) {
  const [[west, south], [east, north]] = areaBounds(area);
  const lat = (south + north) / 2;
  const dx = ((east - west) / 2) * METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
  const dy = ((north - south) / 2) * METRES_PER_DEGREE;
  return { lon: (west + east) / 2, lat, radiusM: Math.max(350, Math.hypot(dx, dy) * 1.15 + 150) };
}
