// Granice: static map page. Loads the layers precomputed by the pipeline (docs/ugovor-izlaza.md).
// UI text is Croatian; code and comments are English. Domain terms follow GLOSSARY.md.

import CONFIG from "./config.js";
import {
  BORDER_COLORS,
  CASING,
  DANGER,
  RIVER,
  ROAD_STYLES,
  SELECTED,
  SURFACES,
} from "./js/colors.js";
import {
  areaBounds,
  crossingLinks,
  inBand,
  includedStaze,
  kriticnaPodrucja,
} from "./js/critical.js";
import { geodesicDistance } from "./js/geodesy.js";

const $ = (id) => document.getElementById(id);
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const currentTheme = () => (darkQuery.matches ? "dark" : "light");
// Colour theme of what is drawn on the map: a light-only (relief) or dark-only (satellite)
// basemap forces its own palette, otherwise it follows the OS theme.
const mapTheme = () => {
  const palette = state.basemap?.palette ?? "system";
  return palette === "system" ? currentTheme() : palette;
};
const number = (digits) =>
  new Intl.NumberFormat("hr-HR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const ink = (theme) => (theme === "dark" ? "#f0efec" : "#0b0b0b");
const absolute = (path) => new URL(path, document.baseURI).href;

// What kind of road an unnamed Staza of a nearest pair is, from its OSM highway tag.
const HIGHWAY_LABELS = {
  trunk: "brza cesta", trunk_link: "brza cesta",
  primary: "glavna cesta", primary_link: "glavna cesta",
  secondary: "regionalna cesta", secondary_link: "regionalna cesta",
  tertiary: "lokalna cesta", tertiary_link: "lokalna cesta",
  unclassified: "nerazvrstana cesta",
  residential: "ulica u naselju", living_street: "ulica u naselju",
  service: "pristupna cesta",
};
// Drawn bottom to top, so roads cross over tracks and paths. `casing` is the extra width of the
// outline under the line.
const CATEGORIES = ["staza", "makadam", "cesta"];
const CATEGORY_STYLE = {
  cesta: { width: 2.8, casing: 1.8, casingOpacity: 1, dash: null },
  makadam: { width: 2, casing: 1.4, casingOpacity: 0.85, dash: null },
  staza: { width: 1.5, casing: 1.2, casingOpacity: 0.7, dash: [2.2, 1.6] },
};
const FIRST_DATA_LAYER = "staze-ukljucene"; // basemap layers go below this one
const BASEMAP_STORAGE_KEY = "granice.podloga";
const SKIP_RIVER_STORAGE_KEY = "granice.bez-rijeke";
const SEGMENT_LAYERS = [
  "segmenti-raspon",
  "segmenti-izvan",
  "segmenti-nedovoljno",
  "segmenti-sporna",
  "segmenti-prijelaz",
];
const METRES_PER_DEGREE = 111320;
const WALKING_M_PER_MINUTE = 4000 / 60; // about 4 km/h off-road, so the minutes are a lower bound
const NO_ID = ["==", ["get", "id"], -1];
const NO_SELECTION = ["==", ["get", "id"], ""];

const state = {
  map: null,
  meta: null,
  segments: [],
  corridorM: null, // roads up to this far from the border count (max_border_distance_m)
  corridorFiles: new Map(), // pojasevi/<m>.json requests by value
  corridorRequest: 0, // bumped per choice, so a slow file cannot land after a newer choice
  measure: { active: false, points: [], label: null }, // the measuring tool: up to two [lon, lat]
  skipRiver: false, // red segments on Riječna granica left out of the band (na_rijeci)
  areas: [],
  band: { ...CONFIG.band }, // nearest-pair distances (m) drawn red and grouped into Kritična područja
  included: { HR: new Map(), BiH: new Map() }, // Staze of those nearest pairs (includedStaze)
  linkBySegment: new Map(), // segment id → its walking link (crossingLinks), for red segments
  stazaById: new Map(), // "<strana>:<OSM way id>" → properties of the Staza, for names of the pairs
  pairSegment: null, // id of the red segment whose pair is highlighted (hovered or of the chosen area)
  selectedPair: null, // the segment of the chosen Kritično područje whose pair stays highlighted
  pairLabels: [], // markers naming the two roads and the gap of the highlighted pair
  hasLocalBasemap: false,
  hasGlyphs: false,
  basemaps: [],
  basemap: null, // the chosen entry of `basemaps`
  basemapIds: [], // layers and sources currently added for it
  basemapSources: [],
  basemapRequest: 0, // bumped per switch, so a slow style fetch cannot land after a newer choice
};
const styleCache = new Map();

// ---------------------------------------------------------------------------------------------
// Data

async function loadJson(name) {
  const response = await fetch(CONFIG.dataDir + name);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return response.json();
}

async function exists(url) {
  try {
    return (await fetch(url, { method: "HEAD" })).ok;
  } catch {
    return false;
  }
}

async function loadAll() {
  const names = ["meta", "staze", "granica", "segmenti", "prijelazi", "rijecna_granica"];
  const files = await Promise.all(names.map((n) => loadJson(n + (n === "meta" ? ".json" : ".geojson"))));
  return Object.fromEntries(names.map((n, i) => [n, files[i]]));
}

// ---------------------------------------------------------------------------------------------
// Images (drawn at runtime so the page needs no asset files)

function drawn(size, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d"), size);
  return canvas;
}

function hatchCanvas() {
  // Neutral grey with darker diagonal stripes: reads as texture, not as a colour on the scale.
  return drawn(16, (g, s) => {
    g.fillStyle = "#bdbcb4";
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "#4a4945";
    g.lineWidth = 3;
    for (const shift of [-s, 0, s]) {
      g.beginPath();
      g.moveTo(shift, s);
      g.lineTo(shift + s, 0);
      g.stroke();
    }
  });
}

// Map icons are drawn on a 48-unit grid at twice that size, so they stay sharp when shown large.
const ICON_PX = 96;

function sluzbeniPrijelazCanvas() {
  return drawn(ICON_PX, (g) => {
    g.scale(ICON_PX / 48, ICON_PX / 48);
    g.fillStyle = "#ffffff";
    g.strokeStyle = "#0b0b0b";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(24, 24, 20, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = "#0b0b0b"; // a barrier: two posts and a bar
    g.fillRect(11, 16, 4, 18);
    g.fillRect(33, 16, 4, 18);
    g.fillRect(11, 21, 26, 5);
  });
}

function izravniPrelazakCanvas() {
  return drawn(ICON_PX, (g) => {
    g.scale(ICON_PX / 48, ICON_PX / 48);
    g.fillStyle = "#0b0b0b";
    g.strokeStyle = "#ffffff";
    g.lineWidth = 3;
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(24, 5);
    g.lineTo(44, 41);
    g.lineTo(4, 41);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "#ffffff"; // exclamation mark
    g.fillRect(22, 16, 4, 14);
    g.fillRect(22, 33, 4, 4);
  });
}

const imageData = (canvas) =>
  canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);

// ---------------------------------------------------------------------------------------------
// Map styling

const zoomScaled = (width) => [
  "interpolate", ["linear"], ["zoom"], 8, width * 0.8, 12, width * 1.2, 15, width * 2,
];

// Roads thin out faster than the risk band when zooming out, so the band stays the main figure.
const roadScaled = (width) => [
  "interpolate", ["linear"], ["zoom"], 8, width * 0.45, 12, width, 15, width * 2,
];

// Icons are 48 px at size 1 (96 px canvas at pixel ratio 2): about 22 px with the whole border in
// view, 36 px at street level.
const ICON_SIZE = ["interpolate", ["linear"], ["zoom"], 7, 0.45, 10, 0.6, 13, 0.75, 15, 0.85];

const stanjeIs = (value) => ["==", ["get", "stanje"], value];

/** Filters of the segment layers for a band; the band test is `inBand` in js/critical.js. */
function bandFilters({ minM, maxM, skipRiver }) {
  const inside = [
    "all", stanjeIs("procijenjen"),
    [">=", ["get", "udaljenost_m"], minM], ["<=", ["get", "udaljenost_m"], maxM],
    ...(skipRiver ? [["!", ["coalesce", ["get", "na_rijeci"], false]]] : []),
  ];
  return {
    "segmenti-casing": ["any", inside, stanjeIs("nedovoljno_podataka")],
    "segmenti-raspon": inside,
    "segmenti-izvan": ["all", stanjeIs("procijenjen"), ["!", inside]],
  };
}

// Fog over everything farther from the border than the corridor: roads there take no part.
const FOG_OPACITY = 0.6;

/** Filter of the halo under the Staze of the nearest pairs within the band. */
function includedFilter(included) {
  return ["any", ...Object.entries(included).map(([strana, ids]) => [
    "all", ["==", ["get", "strana"], strana], ["in", ["get", "id"], ["literal", [...ids.keys()]]],
  ])];
}

/** Paint properties that depend on the colour theme, by layer id. */
function themedPaint(theme) {
  const border = BORDER_COLORS[theme];
  const paint = {
    background: { "background-color": SURFACES[theme] },
    "granica-casing": { "line-color": border.casing },
    granica: { "line-color": border.line },
    "staze-ukljucene": { "line-color": DANGER[theme] },
    "staze-par": { "line-color": DANGER[theme] },
    "par-odabir": { "line-color": DANGER[theme] },
    "parovi-casing": { "line-color": SURFACES[theme] },
    "parovi-linija": { "line-color": DANGER[theme] },
    "parovi-tocke": { "circle-color": DANGER[theme], "circle-stroke-color": SURFACES[theme] },
    "par-veza": { "line-color": ink(theme) },
    "segmenti-casing": { "line-color": CASING[theme] },
    "segmenti-raspon": { "line-color": DANGER[theme] },
    "rijecna-granica": { "line-color": RIVER[theme] },
    "pojas-magla": { "fill-color": SURFACES[theme] },
    "mjerenje-casing": { "line-color": SURFACES[theme] },
    "mjerenje-linija": { "line-color": ink(theme) },
    "mjerenje-tocke": { "circle-color": ink(theme), "circle-stroke-color": SURFACES[theme] },
    "segmenti-sporna": { "line-color": ink(theme) },
    "segmenti-prijelaz": { "line-color": "#898781" },
    "segmenti-odabir-casing": { "line-color": CASING[theme] },
    "segmenti-odabir": { "line-color": SELECTED[theme] },
  };
  for (const category of CATEGORIES) {
    const { fill, casing } = ROAD_STYLES[theme][category];
    paint[`staze-${category}`] = { "line-color": fill };
    paint[`staze-${category}-casing`] = { "line-color": casing };
  }
  return paint;
}

function dataLayers(theme) {
  const colors = themedPaint(theme);
  const bands = bandFilters(state.band);
  const layers = [
    // A light red halo under the Staze the red segments were measured from.
    { id: "staze-ukljucene", type: "line", source: "staze", filter: includedFilter(state.included),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { ...colors["staze-ukljucene"], "line-width": roadScaled(13), "line-opacity": 0.35 } },
    // The two Staze of the pair of the red segment under the mouse, a stronger red.
    { id: "staze-par", type: "line", source: "staze", filter: NO_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { ...colors["staze-par"], "line-width": roadScaled(15), "line-opacity": 0.7 } },
  ];
  for (const category of CATEGORIES) {
    const style = CATEGORY_STYLE[category];
    const filter = ["==", ["get", "kategorija"], category];
    layers.push(
      {
        id: `staze-${category}-casing`, type: "line", source: "staze", filter,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          ...colors[`staze-${category}-casing`],
          "line-width": roadScaled(style.width + style.casing),
          "line-opacity": style.casingOpacity,
        },
      },
      {
        id: `staze-${category}`, type: "line", source: "staze", filter,
        layout: { "line-cap": style.dash ? "butt" : "round", "line-join": "round" },
        paint: {
          ...colors[`staze-${category}`],
          "line-width": roadScaled(style.width),
          ...(style.dash ? { "line-dasharray": style.dash } : {}),
        },
      },
    );
  }
  layers.push(
    { id: "pojas-magla", type: "fill", source: "magla",
      paint: { ...colors["pojas-magla"], "fill-opacity": FOG_OPACITY } },
    // Riječna granica: a wide blue band under the segments, so a red segment on a river keeps its
    // red and is edged in blue.
    { id: "rijecna-granica", type: "line", source: "rijecna_granica",
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { ...colors["rijecna-granica"], "line-width": zoomScaled(14), "line-opacity": 0.9 } },
    { id: "segmenti-casing", type: "line", source: "segmenti", filter: bands["segmenti-casing"],
      layout: { "line-cap": "butt" },
      paint: { ...colors["segmenti-casing"], "line-width": zoomScaled(9) } },
    { id: "segmenti-raspon", type: "line", source: "segmenti", filter: bands["segmenti-raspon"],
      layout: { "line-cap": "butt" },
      paint: { ...colors["segmenti-raspon"], "line-width": zoomScaled(6) } },
    // Assessed segments outside the band are not drawn, only kept clickable.
    { id: "segmenti-izvan", type: "line", source: "segmenti", filter: bands["segmenti-izvan"],
      paint: { "line-color": "#000000", "line-opacity": 0, "line-width": zoomScaled(6) } },
    { id: "segmenti-nedovoljno", type: "line", source: "segmenti", filter: stanjeIs("nedovoljno_podataka"),
      layout: { "line-cap": "butt" },
      paint: { "line-pattern": "hatch", "line-width": zoomScaled(6) } },
    { id: "segmenti-sporna", type: "line", source: "segmenti", filter: stanjeIs("sporna_granica"),
      paint: { ...colors["segmenti-sporna"], "line-width": zoomScaled(3), "line-dasharray": [2, 2] } },
    { id: "segmenti-prijelaz", type: "line", source: "segmenti", filter: stanjeIs("sluzbeni_prijelaz"),
      paint: { ...colors["segmenti-prijelaz"], "line-width": zoomScaled(4) } },
    { id: "granica-casing", type: "line", source: "granica",
      paint: { ...colors["granica-casing"], "line-width": 3.4, "line-opacity": 0.85 } },
    { id: "granica", type: "line", source: "granica",
      paint: { ...colors.granica, "line-width": 1.6, "line-dasharray": [5, 2, 1.2, 2] } },
    // The selected segments, bright yellow over the Granična linija so there is no doubt which.
    { id: "segmenti-odabir-casing", type: "line", source: "segmenti", filter: NO_SELECTION,
      layout: { "line-cap": "round" }, paint: { ...colors["segmenti-odabir-casing"], "line-width": zoomScaled(12) } },
    { id: "segmenti-odabir", type: "line", source: "segmenti", filter: NO_SELECTION,
      layout: { "line-cap": "round" }, paint: { ...colors["segmenti-odabir"], "line-width": zoomScaled(8) } },
    { id: "prijelazi-sluzbeni", type: "symbol", source: "prijelazi",
      filter: ["==", ["get", "tip"], "sluzbeni_prijelaz"],
      minzoom: 9,
      layout: { "icon-image": "ikona-prijelaz", "icon-allow-overlap": true,
        "icon-size": ICON_SIZE } },
    { id: "prijelazi-izravni", type: "symbol", source: "prijelazi",
      filter: ["==", ["get", "tip"], "izravni_prelazak"],
      minzoom: 11,
      layout: { "icon-image": "ikona-izravni", "icon-allow-overlap": true,
        "icon-size": ICON_SIZE } },
    // Walking links of the nearest pairs: from the BiH road across the border to the HR road. The
    // one of the hovered red segment is underlaid in red and tied to the segment by a dotted line.
    { id: "par-odabir", type: "line", source: "par-hover", filter: ["==", ["get", "vrsta"], "par"],
      layout: { "line-cap": "round" },
      paint: { ...colors["par-odabir"], "line-width": zoomScaled(12), "line-opacity": 0.35 } },
    { id: "parovi-casing", type: "line", source: "parovi", filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round" }, paint: { ...colors["parovi-casing"], "line-width": zoomScaled(4.5) } },
    { id: "parovi-linija", type: "line", source: "parovi", filter: ["==", ["geometry-type"], "LineString"],
      paint: { ...colors["parovi-linija"], "line-width": zoomScaled(2.2), "line-dasharray": [2, 1.5] } },
    { id: "parovi-tocke", type: "circle", source: "parovi", filter: ["==", ["geometry-type"], "Point"],
      paint: { ...colors["parovi-tocke"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 14, 6],
        "circle-stroke-width": 1.5 } },
    { id: "par-veza", type: "line", source: "par-hover", filter: ["==", ["get", "vrsta"], "veza"],
      layout: { "line-cap": "round" },
      paint: { ...colors["par-veza"], "line-width": 1.6, "line-dasharray": [0.5, 2.5] } },
    // The measuring tool, above everything.
    { id: "mjerenje-casing", type: "line", source: "mjerenje", filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round" }, paint: { ...colors["mjerenje-casing"], "line-width": 6 } },
    { id: "mjerenje-linija", type: "line", source: "mjerenje", filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round" }, paint: { ...colors["mjerenje-linija"], "line-width": 2.5 } },
    { id: "mjerenje-tocke", type: "circle", source: "mjerenje", filter: ["==", ["geometry-type"], "Point"],
      paint: { ...colors["mjerenje-tocke"], "circle-radius": 5, "circle-stroke-width": 2 } },
  );
  return layers;
}

// `label` is the chip text, `hint` the tooltip.
const LAYER_GROUPS = [
  { id: "segmenti", label: "Rizik na granici", hint: "Segmenti granice u rasponu i njihova stanja",
    layers: [
      "segmenti-casing", "segmenti-raspon", "segmenti-izvan", "segmenti-nedovoljno", "segmenti-sporna",
      "segmenti-prijelaz", "segmenti-odabir-casing", "segmenti-odabir", "prijelazi-izravni",
    ] },
  { id: "parovi", label: "Pješački prijelazi", hint: "Najkraći put pješice između cesta najbližih parova (crtkano)",
    layers: ["par-odabir", "parovi-casing", "parovi-linija", "parovi-tocke", "par-veza"],
    onChange: (visible) => $("map").classList.toggle("hide-pair-labels", !visible) },
  { id: "ukljucene", label: "Ceste u izračunu", hint: "Ceste uključene u izračun (crveni obrub)", layers: ["staze-ukljucene", "staze-par"] },
  { id: "prijelazi", label: "Službeni prijelazi", hint: "Službeni granični prijelazi", layers: ["prijelazi-sluzbeni"] },
  { id: "granica", label: "Granična linija", hint: "Granična linija", layers: ["granica-casing", "granica"] },
  { id: "rijeka", label: "Rijeka", hint: "Granica na rijeci (plavo)", layers: ["rijecna-granica"] },
  { id: "cesta", label: "Ceste", hint: "Ceste", layers: ["staze-cesta-casing", "staze-cesta"] },
  { id: "makadam", label: "Makadami", hint: "Makadami i šumski putovi", layers: ["staze-makadam-casing", "staze-makadam"] },
  { id: "staza", label: "Staze", hint: "Staze i puteljci", layers: ["staze-staza-casing", "staze-staza"] },
  { id: "magla", label: "Magla", hint: "Magla izvan pojasa cesta", layers: ["pojas-magla"] },
];

// One-click views: the layer groups that stay on.
const LAYER_PRESETS = [
  { label: "Sve", on: null },
  { label: "Samo rizik", on: ["segmenti", "parovi", "ukljucene", "prijelazi", "granica", "rijeka"] },
  { label: "Čista karta", on: ["granica"] },
];

/** Re-colours the data layers and legend for the current palette. */
function applyTheme() {
  const theme = mapTheme();
  const { map } = state;
  for (const [layerId, paint] of Object.entries(themedPaint(theme))) {
    if (!map.getLayer(layerId)) continue;
    for (const [property, value] of Object.entries(paint)) map.setPaintProperty(layerId, property, value);
  }
  $("map").style.setProperty("--danger", DANGER[theme]);
  paintOverview(theme);
  renderLegend();
}

// ---------------------------------------------------------------------------------------------
// Basemaps (docs/adr/0002-online-podloge.md). Each one is a set of sources and layers that is
// added below the data layers, and removed again when another is chosen.

async function fetchStyle(url) {
  if (!styleCache.has(url)) {
    styleCache.set(url, fetch(url).then((response) => {
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return response.json();
    }));
  }
  try {
    return await styleCache.get(url);
  } catch (error) {
    styleCache.delete(url);
    throw error;
  }
}

/** The sources, layers and glyphs/sprite of a basemap, ready to add to the map. */
async function basemapParts(def, theme) {
  if (def.kind === "none") return { sources: {}, layers: [] };
  if (def.kind === "raster") {
    const id = `bm-${def.id}`;
    return {
      sources: {
        [id]: {
          type: "raster", tiles: def.tiles, tileSize: def.tileSize, maxzoom: def.maxzoom,
          attribution: def.attribution,
        },
      },
      layers: [{ id, type: "raster", source: id }],
    };
  }
  if (def.kind === "pmtiles") {
    const flavor = globalThis.basemaps.namedFlavor(theme);
    let layers = globalThis.basemaps.layers("protomaps", flavor, { lang: "hr" });
    if (!state.hasGlyphs) layers = layers.filter((layer) => layer.type !== "symbol");
    return {
      sources: {
        protomaps: {
          type: "vector", url: "pmtiles://" + absolute(CONFIG.basemap),
          attribution: "Protomaps © OpenStreetMap",
        },
      },
      layers,
      glyphs: state.hasGlyphs ? absolute(CONFIG.glyphs) : undefined,
    };
  }
  // kind "style": take its sources and layers under a "bm-" prefix, so ids cannot clash with ours.
  const style = await fetchStyle(def.style[theme]);
  const sources = Object.fromEntries(Object.entries(style.sources).map(([name, source]) => [`bm-${name}`, source]));
  const layers = style.layers
    .filter((layer) => layer.type !== "background")
    .map((layer) => ({ ...layer, id: `bm-${layer.id}`, source: `bm-${layer.source}` }));
  return { sources, layers, glyphs: style.glyphs, sprite: style.sprite };
}

function removeBasemap() {
  const { map } = state;
  for (const id of state.basemapIds) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of state.basemapSources) if (map.getSource(id)) map.removeSource(id);
  state.basemapIds = [];
  state.basemapSources = [];
}

function setBasemapStatus(message) {
  $("basemap-status").textContent = message;
}

/** Makes `def` the visible basemap (or re-adds it, e.g. for the other colour theme). */
async function showBasemap(def) {
  const { map } = state;
  const request = ++state.basemapRequest;
  state.basemap = def;
  setBasemapStatus("");
  try {
    localStorage.setItem(BASEMAP_STORAGE_KEY, def.id);
  } catch { /* storage unavailable: the choice just is not remembered */ }
  applyTheme(); // the palette of the data layers depends on the basemap, so this does not wait

  let parts;
  try {
    parts = await basemapParts(def, mapTheme());
  } catch {
    if (request !== state.basemapRequest) return;
    removeBasemap();
    setBasemapStatus("Podloga nije učitana (nema internetske veze?). Prikazana je obična pozadina.");
    return;
  }
  if (request !== state.basemapRequest) return;

  removeBasemap();
  if (parts.glyphs) map.setGlyphs(parts.glyphs);
  if (parts.sprite) map.setSprite(parts.sprite);
  for (const [id, source] of Object.entries(parts.sources)) {
    map.addSource(id, source);
    state.basemapSources.push(id);
  }
  const before = map.getLayer(FIRST_DATA_LAYER) ? FIRST_DATA_LAYER : undefined;
  for (const layer of parts.layers) {
    map.addLayer(layer, before);
    state.basemapIds.push(layer.id);
  }
}

function setupBasemapChoice() {
  const group = $("basemap-choice");
  group.replaceChildren();
  for (const def of state.basemaps) {
    const label = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "podloga";
    radio.value = def.id;
    radio.checked = def.id === state.basemap.id;
    radio.addEventListener("change", () => showBasemap(def));
    label.title = def.label;
    label.append(radio, element("span", def.short ?? def.label));
    group.append(label);
  }
  // Tile servers fail silently otherwise: a blank map would look like a bug in the app.
  state.map.on("error", (event) => {
    if (event.sourceId?.startsWith("bm-") || event.sourceId === "protomaps") {
      setBasemapStatus("Dio podloge nije učitan (nema internetske veze ili je servis nedostupan).");
    }
  });
}

function initialBasemap() {
  let saved = null;
  try {
    saved = localStorage.getItem(BASEMAP_STORAGE_KEY);
  } catch { /* ignore */ }
  const wanted = state.basemaps.find((def) => def.id === saved);
  if (wanted) return wanted;
  const fallback = state.hasLocalBasemap ? "karta-lokalno" : CONFIG.defaultBasemap;
  return state.basemaps.find((def) => def.id === fallback) ?? state.basemaps[0];
}

// ---------------------------------------------------------------------------------------------
// Sidebar: layer toggles, legend, Kritična područja

const LAYERS_STORAGE_KEY = "granice.slojevi";
const hiddenGroups = new Set();

function setGroupVisible(group, visible) {
  if (visible) hiddenGroups.delete(group.id);
  else hiddenGroups.add(group.id);
  for (const id of group.layers) {
    state.map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
  group.onChange?.(visible);
}

function syncLayerControls() {
  for (const chip of $("layer-toggles").children) {
    chip.setAttribute("aria-pressed", String(!hiddenGroups.has(chip.dataset.group)));
  }
  for (const button of $("layer-presets").children) {
    const preset = LAYER_PRESETS[Number(button.dataset.preset)];
    const wanted = (group) => !preset.on || preset.on.includes(group.id);
    button.setAttribute("aria-pressed", String(LAYER_GROUPS.every((g) => wanted(g) === !hiddenGroups.has(g.id))));
  }
  try {
    localStorage.setItem(LAYERS_STORAGE_KEY, JSON.stringify([...hiddenGroups]));
  } catch { /* storage unavailable: the choice just is not remembered */ }
}

/** One pill per layer group, one click each; the presets switch several at once. */
function renderToggles() {
  const list = $("layer-toggles");
  const presets = $("layer-presets");
  list.replaceChildren();
  presets.replaceChildren();
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(LAYERS_STORAGE_KEY) ?? "[]");
  } catch { /* ignore */ }
  for (const group of LAYER_GROUPS) {
    const chip = element("button", group.label, "chip");
    chip.type = "button";
    chip.dataset.group = group.id;
    chip.title = group.hint;
    chip.addEventListener("click", () => {
      setGroupVisible(group, hiddenGroups.has(group.id));
      syncLayerControls();
    });
    list.append(chip);
    if (saved.includes(group.id)) setGroupVisible(group, false);
  }
  LAYER_PRESETS.forEach((preset, index) => {
    const button = element("button", preset.label, "preset");
    button.type = "button";
    button.dataset.preset = String(index);
    button.addEventListener("click", () => {
      for (const group of LAYER_GROUPS) setGroupVisible(group, !preset.on || preset.on.includes(group.id));
      syncLayerControls();
    });
    presets.append(button);
  });
  syncLayerControls();
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(tag, attributes) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

/** A small drawing of a map symbol, on the map's own surface colour so it reads like the map. */
function sample(draw) {
  const svg = svgElement("svg", { width: 34, height: 18, viewBox: "0 0 34 18" });
  draw(svg);
  const box = element("span", undefined, "sample");
  box.style.background = SURFACES[mapTheme()];
  box.append(svg);
  return box;
}

function sampleLine(svg, color, width, { dash, opacity = 1 } = {}) {
  svg.append(svgElement("line", {
    x1: 2, y1: 9, x2: 32, y2: 9, stroke: color, "stroke-width": width,
    "stroke-opacity": opacity, ...(dash ? { "stroke-dasharray": dash } : {}),
  }));
}

function roadSample(category, theme) {
  const { fill, casing } = ROAD_STYLES[theme][category];
  const { width, casing: extra, casingOpacity, dash } = CATEGORY_STYLE[category];
  return sample((svg) => {
    sampleLine(svg, casing, (width + extra) * 1.5, { opacity: casingOpacity });
    sampleLine(svg, fill, width * 1.5, { dash: dash?.map((d) => d * 3).join(" ") });
  });
}

function legendRow(visual, text, detail) {
  const row = element("div", undefined, "legend-row");
  visual.title = detail ? `${text}: ${detail}` : text; // the name on hover over the symbol
  const label = element("span", text, "label");
  if (detail) label.append(element("small", detail));
  row.append(visual, label);
  return row;
}

function imageElement(canvas, alt) {
  const image = new Image();
  image.src = canvas.toDataURL();
  image.alt = alt;
  image.className = "legend-icon";
  const box = element("span", undefined, "sample");
  box.append(image);
  return box;
}

function legendGroup(title, ...rows) {
  const group = element("div", undefined, "legend-group");
  if (title) group.append(element("div", title, "legend-title"));
  group.append(...rows);
  return group;
}

function renderLegend() {
  const theme = mapTheme();
  const legend = $("legend");
  legend.replaceChildren();

  const hatch = element("span", undefined, "hatch-swatch");
  const hatchBox = element("span", undefined, "sample");
  hatchBox.append(hatch);
  legend.append(
    legendGroup(
      "Segmenti granice: zračna udaljenost najbližeg para cesta HR–BiH",
      legendRow(
        sample((svg) => {
          sampleLine(svg, CASING[theme], 9);
          sampleLine(svg, DANGER[theme], 6);
        }),
        `Najbliži par od ${bandText(state.band)}`,
        "Odabrani raspon. Ostali procijenjeni segmenti nisu obojeni.",
      ),
      legendRow(
        sample((svg) => {
          sampleLine(svg, DANGER[theme], 13, { opacity: 0.35 });
          const { fill, casing } = ROAD_STYLES[theme].cesta;
          sampleLine(svg, casing, 6.9);
          sampleLine(svg, fill, 4.2);
        }),
        "Cesta uključena u izračun",
        "Cesta iz najbližeg para crvenog segmenta. Prijeđite mišem preko nje za udaljenost od granice.",
      ),
      legendRow(
        sample((svg) => {
          sampleLine(svg, SURFACES[theme], 4.5);
          sampleLine(svg, DANGER[theme], 2.2, { dash: "4 3" });
          for (const cx of [4, 30]) {
            svg.append(svgElement("circle", { cx, cy: 9, r: 3.5, fill: DANGER[theme], stroke: SURFACES[theme], "stroke-width": 1.5 }));
          }
        }),
        "Pješački prijelaz",
        "Najkraći put pješice od BiH ceste do HR ceste: zbog njega je segment crven. Prijeđite mišem preko crvenog segmenta za objašnjenje.",
      ),
      legendRow(
        sample((svg) => {
          sampleLine(svg, RIVER[theme], 12, { opacity: 0.9 });
          sampleLine(svg, BORDER_COLORS[theme].line, 2.2, { dash: "7 3 2 3" });
        }),
        "Granica na rijeci",
        "Granica teče rijekom ili uz vodu (do 75 m od nje).",
      ),
      legendRow(hatchBox, "Nedovoljno podataka", `S barem jedne Strane nema ceste unutar ${corridorText()} od granice. To nije nizak rizik.`),
      legendRow(imageElement(izravniPrelazakCanvas(), ""), "Izravni prelazak", "Staza presijeca granicu izvan Službenog prijelaza (najviši rizik)."),
      legendRow(imageElement(sluzbeniPrijelazCanvas(), ""), "Službeni prijelaz", "Susjedni segmenti izuzeti su iz procjene."),
      legendRow(sample((svg) => sampleLine(svg, ink(theme), 2.4, { dash: "5 4" })), "Sporna granica", "Rizik se ne računa."),
    ),
    legendGroup(
      "Staze i granica",
      legendRow(roadSample("cesta", theme), "Cesta"),
      legendRow(roadSample("makadam", theme), "Makadam / šumski put"),
      legendRow(roadSample("staza", theme), "Staza / puteljak"),
      legendRow(
        sample((svg) => {
          const { fill, casing } = ROAD_STYLES[theme].cesta;
          sampleLine(svg, casing, 6.9);
          sampleLine(svg, fill, 4.2);
          svg.append(svgElement("rect", { x: 0, y: 0, width: 34, height: 18, fill: SURFACES[theme], "fill-opacity": FOG_OPACITY }));
        }),
        `Dalje od ${corridorText()} od granice (zamagljeno)`,
        "Taj dio ceste ne ulazi u izračun. Udaljenost se bira u izborniku „Ceste do … od granice”.",
      ),
      legendRow(
        sample((svg) => {
          sampleLine(svg, BORDER_COLORS[theme].casing, 5, { opacity: 0.85 });
          sampleLine(svg, BORDER_COLORS[theme].line, 2.2, { dash: "7 3 2 3" });
        }),
        "Granična linija",
      ),
    ),
  );
  const note = element("p", `U izračun ulaze samo dijelovi cesta do ${corridorText()} od granice; makadami, šumski putovi i staze prikazani su, ali se ne računaju. Udaljenost para je najmanje zbroj udaljenosti obiju cesta od granice, pa raspon iznad ${metres(2 * state.corridorM)} hvata samo parove razmaknute uzduž granice. Raspon gleda samo udaljenost: segment s vodotokom između para cesta (oznaka „rijeka” u opisu segmenta) također je crven ako je u rasponu.`, "legend-title");
  legend.append(note);
}

const kilometres = (metres) =>
  metres >= 1000 ? `${number(1).format(metres / 1000)} km` : `${number(0).format(metres)} m`;

const metres = (value) => `${number(0).format(value)} m`;
const bandText = ({ minM, maxM }) => `${number(0).format(minM)} do ${metres(maxM)}`;

/** Reads the band from its two sliders. Moving one past the other drags the other along. */
function readBand(moved) {
  const min = $("band-min");
  const max = $("band-max");
  if (Number(min.value) > Number(max.value)) {
    if (moved === min) max.value = min.value;
    else min.value = max.value;
  }
  return { minM: Number(min.value), maxM: Number(max.value) };
}

// ---------------------------------------------------------------------------------------------
// Corridor: how far from the border roads count (max_border_distance_m). The pipeline computes
// the segments for a list of values (meta.pojasevi_m, docs/ugovor-izlaza.md); the planner types
// one from a dropdown and the page loads its file.

const corridorText = () => metres(state.corridorM);
const fogData = (choice) => ({ type: "Feature", geometry: choice.magla, properties: {} });

function loadCorridor(distanceM) {
  if (!state.corridorFiles.has(distanceM)) {
    const request = loadJson(`pojasevi/${distanceM}.json`);
    request.catch(() => state.corridorFiles.delete(distanceM)); // a failed file is fetched again next time
    state.corridorFiles.set(distanceM, request);
  }
  return state.corridorFiles.get(distanceM);
}

/** Puts the results for one corridor on the map: segment properties, fog, legend, Kritična područja. */
function applyCorridor(choice) {
  const rows = new Map(choice.segmenti.map((row) => [row.id, row]));
  state.segments = state.segments.map((feature) => {
    const { id, lanac, red, duljina_m, na_rijeci } = feature.properties;
    return { ...feature, properties: { ...rows.get(id), id, lanac, red, duljina_m, na_rijeci } };
  });
  state.corridorM = choice.max_border_distance_m;
  state.map.getSource("segmenti").setData({ type: "FeatureCollection", features: state.segments });
  state.map.getSource("magla").setData(fogData(choice));
  setBandLimits();
  recomputeAreas();
}

/** Loads and shows one of the precomputed corridors. */
async function chooseCorridor(choice) {
  const request = ++state.corridorRequest;
  const status = $("corridor-status");
  status.textContent = `Učitavam podatke za ${metres(choice)}…`;
  try {
    const data = await loadCorridor(choice);
    if (request !== state.corridorRequest) return;
    applyCorridor(data);
    status.textContent = "";
  } catch (error) {
    if (request !== state.corridorRequest) return;
    $("corridor").value = String(state.corridorM); // back to what the map shows
    status.textContent = `Podaci za ${metres(choice)} nisu učitani (${error.message}).`;
  }
}

/** The dropdown lists the corridors the pipeline computed (meta.pojasevi_m). */
function setupCorridorChoice(available) {
  const select = $("corridor");
  const choices = available ? state.meta.pojasevi_m ?? [] : [];
  select.replaceChildren(...(choices.length ? choices : [state.corridorM]).map((d) => {
    const option = element("option", metres(d));
    option.value = String(d);
    return option;
  }));
  select.value = String(state.corridorM);
  if (choices.length < 2) {
    select.disabled = true;
    $("corridor-status").textContent = "Druge udaljenosti nisu izračunate (pokrenite python -m granice compute).";
    return;
  }
  select.addEventListener("change", () => chooseCorridor(Number(select.value)));
}

/** The sliders reach the farthest pair in the data, rounded up to 500 m. */
function setBandLimits() {
  const farthest = Math.max(0, ...state.segments.map((s) => s.properties.udaljenost_m ?? 0));
  for (const id of ["band-min", "band-max"]) {
    $(id).max = String(Math.max(Math.ceil(farthest / 500) * 500, state.band.maxM));
  }
}

// ---------------------------------------------------------------------------------------------
// Ignoring red segments on Riječna granica (na_rijeci): a river makes the crossing harder, so the
// planner can leave those out of the band and the Kritična područja.

function readSkipRiver() {
  try {
    return localStorage.getItem(SKIP_RIVER_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function renderSkipRiver() {
  const button = $("skip-river");
  const detail = $("skip-river-detail");
  // applyCorridor copies na_rijeci even when the data has none, so test for a real value.
  button.disabled = !state.segments.some((s) => typeof s.properties.na_rijeci === "boolean");
  if (button.disabled) {
    detail.textContent = "Podaci nemaju oznaku rijeke: pokrenite python -m granice compute.";
    return;
  }
  button.setAttribute("aria-pressed", String(state.skipRiver));
  const onRiver = state.segments.filter((s) => s.properties.na_rijeci && inBand(s.properties, { ...state.band, skipRiver: false })).length;
  const few = onRiver % 10 >= 2 && onRiver % 10 <= 4 && (onRiver % 100 < 12 || onRiver % 100 > 14);
  const noun = onRiver % 10 === 1 && onRiver % 100 !== 11 ? "crveni segment" : few ? "crvena segmenta" : "crvenih segmenata";
  detail.textContent = state.skipRiver
    ? `Uključeno: skriveno ${onRiver} ${noun} na rijeci.`
    : `Isključeno: ${onRiver} ${noun} u rasponu ${few ? "leže" : "leži"} na rijeci.`;
}

function setupSkipRiver() {
  $("skip-river").addEventListener("click", () => {
    state.skipRiver = !state.skipRiver;
    try {
      localStorage.setItem(SKIP_RIVER_STORAGE_KEY, state.skipRiver ? "1" : "0");
    } catch { /* storage unavailable: the choice just is not remembered */ }
    recomputeAreas();
  });
}

function recomputeAreas(moved) {
  state.band = { ...readBand(moved), skipRiver: state.skipRiver };
  $("band-value").textContent = bandText(state.band);
  for (const [layerId, filter] of Object.entries(bandFilters(state.band))) state.map.setFilter(layerId, filter);
  state.included = includedStaze(state.segments, state.band);
  state.map.setFilter("staze-ukljucene", includedFilter(state.included));
  state.selectedPair = null; // the list of areas is rebuilt, so nothing is chosen
  renderLinks();
  state.areas = kriticnaPodrucja(state.segments, state.band);
  renderLegend();
  renderAreasSummary();
  renderAreaList();
  renderSkipRiver();
}

/** The walking links of the red segments, each with a dot on its BiH and its HR end. */
function renderLinks() {
  const links = crossingLinks(state.segments, state.band);
  state.linkBySegment = new Map(links.flatMap((link) => link.segmentIds.map((id) => [id, link])));
  state.map.getSource("parovi").setData({
    type: "FeatureCollection",
    features: links.flatMap((link) => [
      { type: "Feature", geometry: { type: "LineString", coordinates: [link.bih, link.hr] }, properties: { udaljenost_m: link.distanceM } },
      { type: "Feature", geometry: { type: "Point", coordinates: link.bih }, properties: { strana: "BiH" } },
      { type: "Feature", geometry: { type: "Point", coordinates: link.hr }, properties: { strana: "HR" } },
    ]),
  });
  highlightPair(null);
}

/** The point of a line nearest to `target`, in a flat projection around it (fine over a few km). */
function nearestOnLine(coords, target) {
  const kx = METRES_PER_DEGREE * Math.cos((target[1] * Math.PI) / 180);
  const ky = METRES_PER_DEGREE;
  let best = coords[0];
  let bestDistance = Infinity;
  for (let i = 0; i + 1 < coords.length; i++) {
    const [ax, ay] = [(coords[i][0] - target[0]) * kx, (coords[i][1] - target[1]) * ky];
    const [dx, dy] = [(coords[i + 1][0] - coords[i][0]) * kx, (coords[i + 1][1] - coords[i][1]) * ky];
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    const distance = Math.hypot(ax + t * dx, ay + t * dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = [coords[i][0] + (t * dx) / kx, coords[i][1] + (t * dy) / ky];
    }
  }
  return best;
}

/** Where a red segment's walking link lies relative to the segment: its middle, the nearest point
 * of the segment to it and the distance between the two. */
function linkPlacement(segment, link) {
  const middle = [(link.hr[0] + link.bih[0]) / 2, (link.hr[1] + link.bih[1]) / 2];
  const onSegment = nearestOnLine(segment.geometry.coordinates, middle);
  return { middle, onSegment, distanceM: geodesicDistance(onSegment, middle) };
}

// A link closer than this to its segment needs no dotted line or mention of where it lies.
const LINK_NEARBY_M = 300;

// Where a label at one end of a pair goes relative to its point, by the anchor MapLibre places there.
const LABEL_OFFSETS = { right: [-9, 0], left: [9, 0], bottom: [0, -9], top: [0, 9] };

/** Labels on the map for a highlighted pair: "BiH cesta" and "HR cesta" at the two ends, each on the
 * far side from the other end so it does not cover the link, and the gap over the middle. */
function drawPairLabels(segment, link) {
  for (const marker of state.pairLabels) marker.remove();
  state.pairLabels = [];
  if (!link) return;
  const p = segment.properties;
  const lat = (link.hr[1] + link.bih[1]) / 2;
  const dx = (link.hr[0] - link.bih[0]) * Math.cos((lat * Math.PI) / 180);
  const dy = link.bih[1] - link.hr[1]; // screen y grows downwards
  const [bihAnchor, hrAnchor] = Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? ["right", "left"] : ["left", "right"])
    : (dy > 0 ? ["bottom", "top"] : ["top", "bottom"]);
  const end = (strana, prefix, at, anchor) => {
    const label = element("div", undefined, "pair-label");
    label.append(element("strong", `${strana} cesta`), element("small", `${metres(p[`${prefix}_od_granice_m`])} od granice`));
    return new globalThis.maplibregl.Marker({ element: label, anchor, offset: LABEL_OFFSETS[anchor] }).setLngLat(at);
  };
  const middle = [(link.hr[0] + link.bih[0]) / 2, (link.hr[1] + link.bih[1]) / 2];
  state.pairLabels = [
    end("BiH", "bih", link.bih, bihAnchor),
    end("HR", "hr", link.hr, hrAnchor),
    new globalThis.maplibregl.Marker({ element: element("div", metres(p.udaljenost_m), "pair-label pair-gap"), anchor: "center" })
      .setLngLat(middle),
  ];
  for (const marker of state.pairLabels) marker.addTo(state.map);
}

/** Highlights the pair of a red segment: its two roads, its walking link, labels naming both ends
 * and a dotted line from the segment to the link. `null` goes back to the pair of the chosen
 * Kritično područje, or clears it when none is chosen. */
function highlightPair(hovered) {
  const segment = hovered ?? state.selectedPair;
  const id = segment?.properties.id ?? null;
  if (id === state.pairSegment) return;
  state.pairSegment = id;
  const { map } = state;
  const link = segment && state.linkBySegment.get(id);
  drawPairLabels(segment, link);
  const features = [];
  if (link) {
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [link.bih, link.hr] }, properties: { vrsta: "par" } });
    const { middle, onSegment, distanceM } = linkPlacement(segment, link);
    if (distanceM >= LINK_NEARBY_M) {
      features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [onSegment, middle] }, properties: { vrsta: "veza" } });
    }
  }
  map.getSource("par-hover").setData({ type: "FeatureCollection", features });
  const p = segment?.properties;
  map.setFilter("staze-par", p?.hr_staza_id == null ? NO_ID : ["any",
    ["all", ["==", ["get", "strana"], "HR"], ["==", ["get", "id"], p.hr_staza_id]],
    ["all", ["==", ["get", "strana"], "BiH"], ["==", ["get", "id"], p.bih_staza_id]],
  ]);
}

/** How many Kritična područja the band gives and how long they are in total. */
function renderAreasSummary() {
  const total = state.areas.reduce((sum, a) => sum + a.lengthM, 0);
  const summary = $("areas-summary");
  summary.replaceChildren();
  if (state.areas.length) {
    const n = state.areas.length;
    summary.append(
      element("strong", String(n)), ` ${n % 10 === 1 && n % 100 !== 11 ? "područje" : "područja"} · `,
      element("strong", kilometres(total)), " ukupno.",
    );
  } else {
    summary.textContent = "Nema Kritičnih područja u ovom rasponu.";
  }
}

/** The segment of an area with the closest pair: the pair named in the list and kept highlighted. */
const closestPairSegment = (area) =>
  area.segments.reduce((best, s) => (s.properties.udaljenost_m < best.properties.udaljenost_m ? s : best));

/** One button per Kritično područje, longest first, naming the pair of roads that makes it red:
 * a click flies the map to it. */
function renderAreaList() {
  const list = $("areas");
  list.replaceChildren();
  state.map.setFilter("segmenti-odabir", ["==", ["get", "id"], ""]);
  for (const area of state.areas) {
    const button = element("button", undefined, "area-button");
    button.type = "button";
    const p = closestPairSegment(area).properties;
    const others = crossingLinks(area.segments, state.band).length - 1;
    const roads = p.izravni_prelazak
      ? "cesta prelazi granicu"
      : `BiH ${roadName(p, "bih")} ↔ HR ${roadName(p, "hr")}${others > 0 ? ` (+${others} ${others === 1 ? "par" : "para"})` : ""}`;
    const text = element("span", undefined, "area-text");
    const head = element("span", undefined, "area-head");
    head.append(element("strong", `par cesta ${metres(p.udaljenost_m)}`), element("span", ` · ${kilometres(area.lengthM)} granice`));
    text.append(head, element("small", roads));
    button.append(element("span", String(area.rang), "area-rank"), text);
    button.setAttribute("aria-label", `Područje ${area.rang}: par cesta na ${metres(p.udaljenost_m)}, ${roads}, ${kilometres(area.lengthM)} granice. Prikaži na karti.`);
    button.addEventListener("click", () => showArea(area, button));
    const item = element("li");
    item.append(button);
    list.append(item);
  }
}

/** Flies the map to a Kritično područje, framing its segments together with both ends of their
 * pairs, outlines the segments and keeps the closest pair highlighted until another choice. */
function showArea(area, button) {
  const { map } = state;
  for (const other of document.querySelectorAll(".area-button[aria-current]")) other.removeAttribute("aria-current");
  button.setAttribute("aria-current", "true");
  const ids = area.segments.map((s) => s.properties.id);
  map.setFilter("segmenti-odabir", ["in", ["get", "id"], ["literal", ids]]);
  state.selectedPair = closestPairSegment(area);
  highlightPair(null);
  // Room for the labels at the ends of the pair and the controls in the map's corners.
  const { width, height } = map.getContainer().getBoundingClientRect();
  const side = Math.min(150, width * 0.2);
  const padding = { top: Math.min(110, height * 0.2), bottom: Math.min(80, height * 0.15), left: side, right: side };
  // Not linear: MapLibre flies out and back in, so a far area is reached with a sense of where it is.
  map.fitBounds(areaBounds(area, { withPairs: true }), { padding, maxZoom: 15, speed: 1.4, maxDuration: 2500 });
}

// ---------------------------------------------------------------------------------------------
// Click details

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function segmentPopup(p) {
  const root = element("div", undefined, "popup");
  const lead = {
    nedovoljno_podataka: "Nedovoljno podataka s barem jedne Strane. To nije nizak rizik.",
    sluzbeni_prijelaz: "Uz Službeni prijelaz, izuzeto iz procjene.",
    sporna_granica: "Sporna granica, rizik se ne računa.",
  }[p.stanje];
  if (lead) {
    root.append(element("p", lead));
    return root;
  }
  if (p.izravni_prelazak) {
    root.append(element("strong", "Izravni prelazak"), element("p", "Cesta prelazi granicu izvan prijelaza.", "muted"));
  } else {
    root.append(
      element("strong", `Rizik ${number(2).format(p.rizik)}`),
      element("p", `Najbliži par cesta: ${metres(p.udaljenost_m)}${p.rijeka ? " · rijeka" : ""}`, "muted"),
    );
  }
  const more = element("details", undefined, "more");
  more.append(element("summary", "Detalji"));
  const list = element("dl");
  for (const [term, value] of [
    ["HR cesta", `${roadName(p, "hr")}, ${metres(p.hr_od_granice_m)} od granice`],
    ["BiH cesta", `${roadName(p, "bih")}, ${metres(p.bih_od_granice_m)} od granice`],
    ["Duljina", metres(p.duljina_m)],
    ["Segment", String(p.id)],
  ]) list.append(element("dt", term), element("dd", value));
  more.append(list);
  root.append(more);
  return root;
}

/** "Od granice udaljena …" for a Staza of a nearest pair; a range when it serves several segments. */
function borderDistanceText(distances) {
  const low = Math.min(...distances);
  const high = Math.max(...distances);
  return Math.round(low) === Math.round(high)
    ? `Od granice udaljena ${metres(low)}`
    : `Od granice udaljena ${number(0).format(low)}–${metres(high)}`;
}

/** The tooltip on the Staze of the nearest pairs: how far from the border the pair was measured. */
function includedTooltip(p) {
  const distances = state.included[p.strana]?.get(p.id);
  if (!distances) return null;
  const root = element("div", undefined, "popup");
  root.append(element("strong", borderDistanceText(distances)));
  const name = p.naziv || "cesta bez naziva";
  const n = distances.length;
  const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
  const segments = `${n} ${n % 10 === 1 && n % 100 !== 11 ? "crveni segment" : few ? "crvena segmenta" : "crvenih segmenata"}`;
  root.append(element("p", `${name} · ${p.strana} · najbliža cesta za ${segments}`));
  return root;
}

/** Name of a Staza of a nearest pair: its OSM name, else the kind of road it is. The Staze layer is
 * the source, because the per-corridor files (pojasevi/) carry no names. */
function roadName(p, prefix) {
  const staza = state.stazaById.get(`${prefix === "hr" ? "HR" : "BiH"}:${p[`${prefix}_staza_id`]}`);
  const name = staza?.naziv ?? p[`${prefix}_staza_naziv`];
  if (name) return `„${name}”`;
  return `${HIGHWAY_LABELS[staza?.highway] ?? "cesta"} bez naziva`;
}

/** The tooltip on a red segment: the pair of roads that makes it red, one per Strana, and how far
 * apart they are, matching the labels at the two ends of the pair on the map. */
function whyRedTooltip(segment) {
  const p = segment.properties;
  const root = element("div", undefined, "popup why");
  if (p.izravni_prelazak) {
    root.append(
      element("strong", "Cesta ovdje prelazi granicu"),
      element("p", "Izvan Službenog prijelaza: granica se prelazi bez silaska s ceste, vozilom ili pješice. Najviši rizik."),
    );
    return root;
  }
  const minutes = Math.max(1, Math.round(p.udaljenost_m / WALKING_M_PER_MINUTE));
  root.append(
    element("strong", `Crveno zbog para cesta udaljenih ${metres(p.udaljenost_m)}`),
    element("p", `To je u odabranom rasponu ${bandText(state.band)}.`, "muted"),
  );
  const pair = element("dl", undefined, "pair");
  for (const [strana, prefix] of [["BiH", "bih"], ["HR", "hr"]]) {
    pair.append(
      element("dt", `${strana} cesta`),
      element("dd", `${roadName(p, prefix)}, ${metres(p[`${prefix}_od_granice_m`])} od granice`),
    );
  }
  root.append(pair, element("p", `Crtkano na karti: pješice od jedne do druge ceste, ${metres(p.udaljenost_m)} zračne linije, najmanje oko ${minutes} min hoda.`));
  const link = state.linkBySegment.get(p.id);
  if (link) {
    const { distanceM } = linkPlacement(segment, link);
    if (distanceM >= LINK_NEARBY_M) {
      root.append(element("p", `Par je ${kilometres(distanceM)} od ovog dijela granice: prati točkastu crtu.`));
    }
    const n = link.segmentIds.length;
    if (n > 1) {
      const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
      root.append(element("p", `Isti par cesta boji ${n} ${n % 10 === 1 && n % 100 !== 11 ? "crveni segment" : few ? "crvena segmenta" : "crvenih segmenata"}.`, "muted"));
    }
  }
  if (p.rijeka) root.append(element("p", "Između cesta je vodotok, pa je prelazak teži."));
  return root;
}

function riverTooltip() {
  const root = element("div", undefined, "popup");
  root.append(element("strong", "Granica na rijeci"));
  return root;
}

/** Tooltips that follow the mouse, one at a time: a red segment first, then a road of a nearest
 * pair, then Riječna granica. Over a red segment its pair is highlighted too. */
function setupHover() {
  const { map } = state;
  const tooltip = new globalThis.maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "300px" });
  const hit = (point, layer) => map.getLayoutProperty(layer, "visibility") !== "none"
    && map.queryRenderedFeatures(point, { layers: [layer] })[0];
  map.on("mousemove", (event) => {
    // A few pixels of slack: the red line is only about 5 px wide with the whole border in view.
    const { x, y } = event.point;
    const red = hit([[x - 4, y - 4], [x + 4, y + 4]], "segmenti-raspon");
    const segment = red ? state.segments.find((s) => s.properties.id === red.properties.id) : null;
    highlightPair(segment);
    let content = segment ? whyRedTooltip(segment) : null;
    if (!content) {
      const road = hit(event.point, "staze-ukljucene");
      content = road ? includedTooltip(road.properties) : null;
    }
    if (!content && hit(event.point, "rijecna-granica")) content = riverTooltip();
    if (content) tooltip.setLngLat(event.lngLat).setDOMContent(content).addTo(map);
    else tooltip.remove();
  });
  map.getCanvas().addEventListener("mouseleave", () => {
    tooltip.remove();
    highlightPair(null);
  });
}

// ---------------------------------------------------------------------------------------------
// Measuring tool: click two points, the air distance between them is written above the line.

const measureText = (metresApart) => metresApart >= 1000
  ? `${metres(metresApart)} (${number(2).format(metresApart / 1000)} km)`
  : metres(metresApart);

/** Draws the points, the line and its distance label. `points` may end with the mouse position. */
function drawMeasure(points) {
  const { map, measure } = state;
  const features = points.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} }));
  measure.label?.remove();
  measure.label = null;
  if (points.length === 2) {
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: points }, properties: {} });
    const label = element("div", measureText(geodesicDistance(points[0], points[1])), "measure-label");
    const middle = [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
    measure.label = new globalThis.maplibregl.Marker({ element: label, anchor: "bottom", offset: [0, -8] })
      .setLngLat(middle)
      .addTo(map);
  }
  map.getSource("mjerenje")?.setData({ type: "FeatureCollection", features });
}

function measureHint() {
  const { active, points } = state.measure;
  if (!active) return "";
  if (points.length === 1) return "Kliknite drugu točku.";
  if (points.length === 2) return "Klik na kartu započinje novo mjerenje. Esc ili gumb Mjerenje za kraj.";
  return "Kliknite prvu točku.";
}

function setMeasuring(active) {
  const { map, measure } = state;
  measure.active = active;
  measure.points = [];
  drawMeasure([]);
  const button = $("measure-toggle");
  button.setAttribute("aria-pressed", String(active));
  $("measure-hint").textContent = measureHint();
  map.getCanvas().style.cursor = active ? "crosshair" : "";
  // A quick second click would zoom in instead of setting the second point.
  if (active) map.doubleClickZoom.disable();
  else map.doubleClickZoom.enable();
}

function setupMeasure() {
  const { map, measure } = state;
  $("measure-toggle").addEventListener("click", () => setMeasuring(!measure.active));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && measure.active) setMeasuring(false);
  });
  map.on("click", (event) => {
    if (!measure.active) return;
    const point = [event.lngLat.lng, event.lngLat.lat];
    measure.points = measure.points.length === 1 ? [measure.points[0], point] : [point];
    drawMeasure(measure.points);
    $("measure-hint").textContent = measureHint();
  });
  // Between the two clicks the line follows the mouse with its distance.
  map.on("mousemove", (event) => {
    if (measure.active && measure.points.length === 1) {
      drawMeasure([measure.points[0], [event.lngLat.lng, event.lngLat.lat]]);
    }
  });
}

/** A small map of the whole border in a corner, with the current view outlined, so one knows where
 * a deep zoom is. A click on it moves the main map there. */
function paintOverview(theme) {
  const { overview } = state;
  if (!overview?.getLayer("pregled-linija")) return;
  overview.setPaintProperty("background", "background-color", SURFACES[theme]);
  overview.setPaintProperty("pregled-linija", "line-color", BORDER_COLORS[theme].line);
  overview.setPaintProperty("pregled-okvir", "line-color", DANGER[theme]);
  overview.setPaintProperty("pregled-ispuna", "fill-color", DANGER[theme]);
}

function setupOverview(granica, bounds) {
  const { map } = state;
  const overview = new globalThis.maplibregl.Map({
    container: "overview", interactive: false, attributionControl: false, bounds, fitBoundsOptions: { padding: 10 },
    style: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": SURFACES[mapTheme()] } }] },
  });
  state.overview = overview;
  const frame = () => {
    const b = map.getBounds();
    const [w, s, e, n] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    return { type: "Feature", geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, properties: {} };
  };
  overview.on("load", () => {
    overview.addSource("granica", { type: "geojson", data: granica });
    overview.addSource("okvir", { type: "geojson", data: frame() });
    overview.addLayer({ id: "pregled-linija", type: "line", source: "granica", paint: { "line-color": "#000", "line-width": 1.6 } });
    overview.addLayer({ id: "pregled-ispuna", type: "fill", source: "okvir", paint: { "fill-color": "#c73751", "fill-opacity": 0.18 } });
    overview.addLayer({ id: "pregled-okvir", type: "line", source: "okvir", paint: { "line-color": "#c73751", "line-width": 2 } });
    paintOverview(mapTheme());
    map.on("move", () => overview.getSource("okvir").setData(frame()));
  });
  $("overview").addEventListener("click", (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = overview.unproject([event.clientX - box.left, event.clientY - box.top]);
    map.easeTo({ center: at });
  });
}

/** The side panel floats over the map and can be hidden, so the map can fill the screen. */
function setupPanelToggle() {
  const layout = document.querySelector(".layout");
  const set = (closed) => {
    layout.classList.toggle("panel-closed", closed);
    $("panel-open").hidden = !closed;
  };
  $("panel-close").addEventListener("click", () => set(true));
  $("panel-open").addEventListener("click", () => set(false));
  if (window.matchMedia("(max-width: 760px)").matches) set(true);
}

/** A press that stays in place for a moment shows the coordinates of the point with a Google Maps link. */
let coordsPopup = null;
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 6;

function setupLongPress(closeOther) {
  const { map } = state;
  let timer = null;
  let start = null;
  const cancel = () => {
    clearTimeout(timer);
    start = null;
  };
  const press = (event) => {
    coordsPopup?.remove();
    state.longPressed = false;
    cancel();
    if (state.measure.active || event.originalEvent?.button > 0) return;
    start = event.point;
    const { lngLat } = event;
    timer = setTimeout(() => {
      state.longPressed = true;
      closeOther();
      coordsPopup = new globalThis.maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "coords-popup" })
        .setLngLat(lngLat).setDOMContent(coordinatesRow(lngLat)).addTo(map);
    }, LONG_PRESS_MS);
  };
  const move = (event) => {
    if (start && Math.hypot(event.point.x - start.x, event.point.y - start.y) > LONG_PRESS_SLOP_PX) cancel();
  };
  map.on("mousedown", press);
  map.on("touchstart", press);
  map.on("mousemove", move);
  map.on("touchmove", move);
  map.on("mouseup", cancel);
  map.on("touchend", cancel);
  map.on("dragstart", cancel);
  map.on("zoomstart", cancel);
}

/** The point as "lat, lon" with a link that searches it on Google Maps. */
function coordinatesRow(lngLat) {
  const text = `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`;
  const row = element("div", undefined, "coords");
  const link = element("a", undefined, "coords-link");
  link.href = `https://www.google.com/maps/search/?api=1&query=${lngLat.lat.toFixed(6)},${lngLat.lng.toFixed(6)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = "Otvori ove koordinate na Google Mapsu";
  link.setAttribute("aria-label", `Otvori ${text} na Google Mapsu`);
  link.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 .8a5.2 5.2 0 0 0-5.2 5.2c0 3.7 5.2 9.2 5.2 9.2s5.2-5.5 5.2-9.2A5.2 5.2 0 0 0 8 .8z" fill="#ea4335"/><circle cx="8" cy="6" r="2.1" fill="#ffffff"/></svg>';
  row.append(element("span", text, "coords-text"), link);
  return row;
}

function setupClicks() {
  const { map } = state;
  let popup = null;
  const open = (lngLat, content) => {
    popup?.remove();
    popup = new globalThis.maplibregl.Popup({ maxWidth: "340px" }).setLngLat(lngLat).setDOMContent(content).addTo(map);
  };
  setupLongPress(() => popup?.remove());
  map.on("click", (event) => {
    if (state.measure.active) return; // clicks set measuring points instead
    if (state.longPressed) { // the click that ends a long press only shows the coordinates
      state.longPressed = false;
      return;
    }
    coordsPopup?.remove();
    const box = [[event.point.x - 7, event.point.y - 7], [event.point.x + 7, event.point.y + 7]];
    const icons = map.queryRenderedFeatures(box, { layers: ["prijelazi-sluzbeni"] });
    if (icons.length) {
      const root = element("div", undefined, "popup");
      root.append(element("h3", "Službeni prijelaz"), element("p", "Službeni prijelaz (OSM barrier=border_control). Susjedni segmenti izuzeti su iz procjene rizika."));
      open(icons[0].geometry.coordinates, root);
      return;
    }
    const hits = map.queryRenderedFeatures(box, { layers: SEGMENT_LAYERS });
    if (!hits.length) {
      map.setFilter("segmenti-odabir", ["==", ["get", "id"], ""]);
      // Leaves the chosen Kritično područje too, with the highlight of its pair.
      for (const button of document.querySelectorAll(".area-button[aria-current]")) button.removeAttribute("aria-current");
      state.selectedPair = null;
      highlightPair(null);
      return;
    }
    const { properties } = hits[0];
    map.setFilter("segmenti-odabir", ["==", ["get", "id"], properties.id]);
    open(event.lngLat, segmentPopup(properties));
  });
  // Live coordinates of the mouse, small, in the top right corner.
  const live = $("cursor-coords");
  map.on("mousemove", (event) => {
    live.textContent = `${event.lngLat.lat.toFixed(5)}, ${event.lngLat.lng.toFixed(5)}`;
    live.hidden = false;
  });
  map.getCanvas().addEventListener("mouseleave", () => {
    live.hidden = true;
  });
}

// ---------------------------------------------------------------------------------------------
// Start

function showError(message) {
  const box = $("error");
  box.textContent = message;
  box.hidden = false;
}

function boundsOf(features) {
  const bounds = [[Infinity, Infinity], [-Infinity, -Infinity]];
  for (const feature of features) {
    for (const [lon, lat] of feature.geometry.coordinates) {
      bounds[0][0] = Math.min(bounds[0][0], lon);
      bounds[0][1] = Math.min(bounds[0][1], lat);
      bounds[1][0] = Math.max(bounds[1][0], lon);
      bounds[1][1] = Math.max(bounds[1][1], lat);
    }
  }
  return bounds;
}

async function start() {
  let data;
  try {
    data = await loadAll();
  } catch (error) {
    showError(`Podaci nisu učitani (${error.message}). Pokrenite izračun: python -m granice refresh, a stranicu otvorite preko python -m granice serve.`);
    return;
  }
  state.meta = data.meta;
  state.segments = data.segmenti.features;
  state.stazaById = new Map(data.staze.features.map(({ properties: p }) => [`${p.strana}:${p.id}`, p]));
  state.corridorM = data.meta.parametri.max_border_distance_m; // segmenti.geojson is computed for it
  state.skipRiver = readSkipRiver();
  let firstCorridor = null;
  try {
    firstCorridor = await loadCorridor(state.corridorM);
  } catch { /* data from before the corridor choices: no fog, the field is disabled */ }

  setBandLimits();
  $("band-min").value = String(state.band.minM);
  $("band-max").value = String(state.band.maxM);
  for (const [name, file] of [["segmenti", "segmenti.geojson"], ["staze", "staze.geojson"], ["granica", "granica.geojson"], ["prijelazi", "prijelazi.geojson"]]) {
    const link = element("a", name);
    link.href = CONFIG.dataDir + file;
    link.download = file;
    $("data-links").append(link, " ");
  }
  $("osm-date").textContent = `OSM podaci od: ${new Date(data.meta.osm_podaci_od).toLocaleString("hr-HR", { dateStyle: "long", timeStyle: "short" })}`;

  state.hasLocalBasemap = await exists(absolute(CONFIG.basemap));
  state.hasGlyphs = state.hasLocalBasemap && await exists(absolute(CONFIG.glyphs).replace("{fontstack}", "Noto Sans Regular").replace("{range}", "0-255"));
  state.basemaps = [...CONFIG.basemaps];
  if (state.hasLocalBasemap) {
    globalThis.maplibregl.addProtocol("pmtiles", new globalThis.pmtiles.Protocol().tile);
    state.basemaps.unshift({ id: "karta-lokalno", label: "Karta (lokalno, bez interneta)", short: "Lokalno", kind: "pmtiles", palette: "system" });
  }
  state.basemap = initialBasemap();

  const theme = mapTheme();
  const bounds = boundsOf(data.granica.features);
  const map = new globalThis.maplibregl.Map({
    container: "map",
    attributionControl: false,
    bounds,
    fitBoundsOptions: { padding: 40 },
    style: {
      version: 8,
      sources: {},
      layers: [{ id: "background", type: "background", paint: themedPaint(theme).background }],
    },
  });
  state.map = map;
  if (new URLSearchParams(location.search).has("debug")) globalThis.__map = map; // for manual checks
  map.addControl(new globalThis.maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new globalThis.maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
  map.addControl(new globalThis.maplibregl.AttributionControl({ customAttribution: "Staze i granica: © OpenStreetMap contributors" }), "bottom-left");

  map.on("load", () => {
    map.addImage("hatch", imageData(hatchCanvas()), { pixelRatio: 2 });
    map.addImage("ikona-prijelaz", imageData(sluzbeniPrijelazCanvas()), { pixelRatio: 2 });
    map.addImage("ikona-izravni", imageData(izravniPrelazakCanvas()), { pixelRatio: 2 });
    const empty = { type: "FeatureCollection", features: [] };
    map.addSource("staze", { type: "geojson", data: data.staze });
    map.addSource("granica", { type: "geojson", data: data.granica });
    map.addSource("segmenti", { type: "geojson", data: data.segmenti });
    map.addSource("rijecna_granica", { type: "geojson", data: data.rijecna_granica });
    map.addSource("magla", { type: "geojson", data: firstCorridor ? fogData(firstCorridor) : empty });
    map.addSource("prijelazi", { type: "geojson", data: data.prijelazi });
    map.addSource("parovi", { type: "geojson", data: empty });
    map.addSource("par-hover", { type: "geojson", data: empty });
    map.addSource("mjerenje", { type: "geojson", data: empty });
    for (const layer of dataLayers(theme)) map.addLayer(layer);

    renderToggles();
    setupBasemapChoice();
    showBasemap(state.basemap);
    setupClicks();
    setupHover();
    setupMeasure();
    setupCorridorChoice(firstCorridor !== null);
    setupSkipRiver();
    setupPanelToggle();
    setupOverview(data.granica, bounds);
    recomputeAreas();
  });

  for (const id of ["band-min", "band-max"]) {
    $(id).addEventListener("input", (event) => {
      if (map.getLayer("segmenti-raspon")) recomputeAreas(event.target); // once the layers are added
    });
  }
  darkQuery.addEventListener("change", () => {
    showBasemap(state.basemap); // "Karta" has a style per theme; this applies the palette too
  });
}

start();
