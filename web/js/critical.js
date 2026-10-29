// The three groups the page shows, computed in the browser from the segments of the corridor the
// planner picked (pojasevi/<m>.json) and one limit on the distance of the nearest pair of Staze:
//   izravni  Izravni prelazak: a Staza crosses the border outside a Službeni prijelaz. Listed from
//            prijelazi.geojson, independent of the limit.
//   kopno    Kritično područje: Staze on both sides come within the limit, no water between them.
//   rijeka   Kritično područje where a river (rijeka flag of the segment) lies between the pair.
// The pipeline's kriticna_podrucja.geojson (risk.py, _kriticna_podrucja) still uses its index
// threshold and is meant for other tools; the page does not read it.

export const CATEGORIES = ["kopno", "rijeka"];

/**
 * Whether a segment is assessed, is no Izravni prelazak and its nearest pair of Staze lies within
 * the limit. With `skipRiver` a segment on Riječna granica (`na_rijeci`) never is.
 * @param {{maxM: number, skipRiver?: boolean}} band
 */
export function inReach(p, band) {
  return p.stanje === "procijenjen" && !p.izravni_prelazak && p.udaljenost_m >= TOUCHING_M
    && p.udaljenost_m <= band.maxM && !(band.skipRiver && p.na_rijeci);
}

// A pair closer than this touches: one Staza crosses the border, and the crossing lies in the
// neighbouring segment (the Izravni prelazak), so it is no Kritično područje of its own.
const TOUCHING_M = 1;

/** "rijeka" when the nearest pair has water between it, else "kopno". */
export const categoryOf = (p) => (p.rijeka ? "rijeka" : "kopno");

/**
 * The walking links of the nearest pairs within the limit: where one would cross the border on foot
 * from the BiH road to the HR road. Adjacent segments often share a pair, so each link comes once,
 * with the ids of the segments it belongs to.
 * @returns {{hr: number[], bih: number[], distanceM: number, segmentIds: string[]}[]}
 */
export function crossingLinks(segments, band) {
  const links = new Map();
  for (const { properties: p } of segments) {
    if (!inReach(p, band) || !p.hr_tocka || !p.bih_tocka) continue;
    const key = `${p.hr_tocka}|${p.bih_tocka}`;
    const link = links.get(key) ?? { hr: p.hr_tocka, bih: p.bih_tocka, distanceM: p.udaljenost_m, segmentIds: [] };
    link.segmentIds.push(p.id);
    links.set(key, link);
  }
  return [...links.values()];
}

/**
 * Runs of adjacent segments within the limit, per category, longest first and then by the closest
 * pair. A run ends where the category changes.
 * @param {object[]} segments GeoJSON features from segmenti.geojson
 * @returns {{kopno: object[], rijeka: object[]}}
 */
export function kriticnaPodrucja(segments, band) {
  const ordered = [...segments].sort(
    (a, b) => a.properties.lanac - b.properties.lanac || a.properties.red - b.properties.red,
  );
  const runs = [];
  let previous = null;
  for (const segment of ordered) {
    const p = segment.properties;
    if (!inReach(p, band)) {
      previous = null;
      continue;
    }
    if (previous && previous.lanac === p.lanac && previous.red + 1 === p.red
      && categoryOf(previous) === categoryOf(p)) {
      runs[runs.length - 1].push(segment);
    } else {
      runs.push([segment]);
    }
    previous = p;
  }
  const areas = { kopno: [], rijeka: [] };
  for (const run of runs) {
    const closest = run.reduce((best, s) => (s.properties.udaljenost_m < best.properties.udaljenost_m ? s : best));
    const { hr_tocka: hr, bih_tocka: bih } = closest.properties;
    const middle = run[Math.floor((run.length - 1) / 2)].geometry.coordinates;
    areas[categoryOf(run[0].properties)].push({
      lanac: run[0].properties.lanac,
      firstSegment: run[0].properties.id,
      lastSegment: run[run.length - 1].properties.id,
      segmentCount: run.length,
      lengthM: run.reduce((sum, s) => sum + s.properties.duljina_m, 0),
      minDistanceM: Math.min(...run.map((s) => s.properties.udaljenost_m)),
      maxDistanceM: Math.max(...run.map((s) => s.properties.udaljenost_m)),
      // Where the closest pair crosses the border, which is where a click on the pin flies to; the
      // middle of the area when that pair has no points.
      marker: hr && bih ? [(hr[0] + bih[0]) / 2, (hr[1] + bih[1]) / 2] : middle[Math.floor(middle.length / 2)],
      segments: run,
    });
  }
  for (const [kategorija, list] of Object.entries(areas)) {
    list.sort((a, b) => b.lengthM - a.lengthM || a.minDistanceM - b.minDistanceM);
    list.forEach((area, i) => Object.assign(area, { kategorija, rang: i + 1, id: `${kategorija}-${i + 1}` }));
  }
  return areas;
}

/**
 * Bounding box [[west, south], [east, north]] of an area. With `withPairs` it also holds both ends
 * of the nearest pair of each segment, which can lie a few km along the border from the segment.
 */
export function areaBounds(area, { withPairs = false } = {}) {
  const coords = area.segments.flatMap((s) => [
    ...s.geometry.coordinates,
    ...(withPairs ? [s.properties.hr_tocka, s.properties.bih_tocka].filter(Boolean) : []),
  ]);
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}
