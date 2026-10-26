// Kritična područja computed in the browser, so the planner can change the threshold.
// Mirrors pipeline/granice/risk.py (_kriticna_podrucja); keep the two in step.

/** Risk index in [0, 1]: 1 at `near_distance_m` or closer, 0 at `far_distance_m` or farther. */
export function riskIndex(distanceM, params) {
  const { near_distance_m: near, far_distance_m: far } = params;
  if (distanceM <= near) return 1;
  if (distanceM >= far) return 0;
  return 1 - Math.log(distanceM / near) / Math.log(far / near);
}

/**
 * Runs of adjacent assessed segments whose risk index reaches that of `thresholdM`,
 * ranked by peak risk and then by length.
 * @param {object[]} segments GeoJSON features from segmenti.geojson
 */
export function kriticnaPodrucja(segments, thresholdM, params) {
  const threshold = riskIndex(thresholdM, params) - 1e-9;
  const ordered = [...segments].sort(
    (a, b) => a.properties.lanac - b.properties.lanac || a.properties.red - b.properties.red,
  );
  const runs = [];
  let previous = null;
  for (const segment of ordered) {
    const p = segment.properties;
    if (p.rizik === null || p.rizik < threshold) {
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
    peakRisk: Math.max(...run.map((s) => s.properties.rizik)),
    segments: run,
  }));
  areas.sort((a, b) => b.peakRisk - a.peakRisk || b.lengthM - a.lengthM);
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

const round = (value, digits) => Number(value.toFixed(digits));

export function areasToGeoJson(areas) {
  return {
    type: "FeatureCollection",
    features: areas.map((area) => ({
      type: "Feature",
      geometry: {
        type: "MultiLineString",
        coordinates: area.segments.map((s) => s.geometry.coordinates),
      },
      properties: {
        rang: area.rang,
        lanac: area.lanac,
        prvi_segment: area.firstSegment,
        zadnji_segment: area.lastSegment,
        broj_segmenata: area.segmentCount,
        duljina_m: round(area.lengthM, 1),
        najmanja_udaljenost_m: round(area.minDistanceM, 1),
        vrh_rizika: round(area.peakRisk, 4),
      },
    })),
  };
}

const CSV_COLUMNS = [
  "rang",
  "prvi_segment",
  "zadnji_segment",
  "broj_segmenata",
  "duljina_m",
  "najmanja_udaljenost_m",
  "vrh_rizika",
  "sredina_lat",
  "sredina_lon",
];

export function areasToCsv(areas) {
  const rows = areas.map((area) => {
    const [[west, south], [east, north]] = areaBounds(area);
    return [
      area.rang,
      area.firstSegment,
      area.lastSegment,
      area.segmentCount,
      round(area.lengthM, 1),
      round(area.minDistanceM, 1),
      round(area.peakRisk, 4),
      round((south + north) / 2, 5),
      round((west + east) / 2, 5),
    ];
  });
  return [CSV_COLUMNS, ...rows].map((row) => row.join(",")).join("\r\n") + "\r\n";
}
