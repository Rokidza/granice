// Granice: static map page. Loads the layers precomputed by the pipeline (docs/ugovor-izlaza.md).
// UI text is Croatian; code and comments are English. Domain terms follow GLOSSARY.md.

import CONFIG from "./config.js";
import {
  BORDER_COLORS,
  DANGER,
  PINS,
  RIVER,
  ROAD_STYLES,
  SURFACES,
} from "./js/colors.js";
import {
  areaBounds,
  CATEGORIES as AREA_CATEGORIES,
  crossingLinks,
  inReach,
  kriticnaPodrucja,
} from "./js/critical.js";
import { geodesicDistance } from "./js/geodesy.js";
import { placeAt, placeShort, placeText } from "./js/places.js";

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

// What kind of way an unnamed Staza is, from its OSM highway tag.
const HIGHWAY_LABELS = {
  trunk: "brza cesta", trunk_link: "brza cesta",
  primary: "glavna cesta", primary_link: "glavna cesta",
  secondary: "regionalna cesta", secondary_link: "regionalna cesta",
  tertiary: "lokalna cesta", tertiary_link: "lokalna cesta",
  unclassified: "nerazvrstana cesta",
  residential: "ulica u naselju", living_street: "ulica u naselju",
  service: "pristupna cesta",
  track: "makadam", path: "staza", footway: "pješačka staza", bridleway: "konjička staza",
  steps: "stepenice", cycleway: "biciklistička staza", pedestrian: "pješačka zona", corridor: "prolaz",
};
const CATEGORY_LABELS = { cesta: "cesta", makadam: "makadam", staza: "staza" };
// Drawn bottom to top, so roads cross over tracks and paths. `casing` is the extra width of the
// outline under the line. Thin and a little see-through, so the basemap stays readable.
const CATEGORIES = ["staza", "makadam", "cesta"];
const CATEGORY_STYLE = {
  cesta: { width: 2, casing: 1.2, casingOpacity: 0.7, opacity: 0.85, dash: null },
  makadam: { width: 1.4, casing: 1, casingOpacity: 0.5, opacity: 0.75, dash: null },
  staza: { width: 1.1, casing: 0.8, casingOpacity: 0.4, opacity: 0.65, dash: [2.2, 1.6] },
};
const FIRST_DATA_LAYER = "staze-par"; // basemap layers go below this one
const BASEMAP_STORAGE_KEY = "granice.podloga";
const SKIP_RIVER_STORAGE_KEY = "granice.bez-rijeke";
// Camera moves to a chosen place: a steady glide in and out of the zoom, not a fly-out-and-back jump.
const GLIDE = { linear: true, duration: 1800, essential: true };
const AREA_PIN_LAYERS = { kopno: "podrucja-kopno", rijeka: "podrucja-rijeka" };
const AREA_TITLES = { kopno: "Blizu granice", rijeka: "Preko rijeke" };
const METRES_PER_DEGREE = 111320;
const WALKING_M_PER_MINUTE = 4000 / 60; // about 4 km/h off-road, so the minutes are a lower bound
const NO_ID = ["==", ["get", "id"], -1];

const state = {
  map: null,
  meta: null,
  segments: [],
  corridorM: null, // roads up to this far from the border count (max_border_distance_m)
  corridorFiles: new Map(), // pojasevi/<m>.json requests by value
  corridorRequest: 0, // bumped per choice, so a slow file cannot land after a newer choice
  measure: { active: false, points: [], label: null }, // the measuring tool: up to two [lon, lat]
  skipRiver: false, // segments on Riječna granica left out of the Kritična područja (na_rijeci)
  areas: { kopno: [], rijeka: [] }, // Kritična područja per category (kriticnaPodrucja)
  areaById: new Map(), // "<kategorija>-<rang>" → area
  crossings: [], // Izravni prelasci: the point features of prijelazi.geojson, in list order
  band: { ...CONFIG.band }, // limit (m) on the nearest-pair distance of a Kritično područje
  linkBySegment: new Map(), // segment id → its walking link (crossingLinks), for segments in reach
  stazaById: new Map(), // "<strana>:<OSM way id>" → properties of the Staza, for names of the pairs
  pairSegment: null, // id of the segment whose pair is highlighted (that of the chosen area)
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

/** A small drop pin, its tip at the bottom centre, for a Kritično područje of one category. */
function pinCanvas(color) {
  return drawn(ICON_PX, (g) => {
    g.scale(ICON_PX / 48, ICON_PX / 48);
    g.fillStyle = color;
    g.strokeStyle = "#ffffff";
    g.lineWidth = 3;
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(24, 46);
    g.bezierCurveTo(24, 46, 8, 30, 8, 18);
    g.arc(24, 18, 16, Math.PI, 0);
    g.bezierCurveTo(40, 30, 24, 46, 24, 46);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(24, 18, 5, 0, Math.PI * 2);
    g.fill();
  });
}

const imageData = (canvas) =>
  canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);

// ---------------------------------------------------------------------------------------------
// Map styling

const zoomScaled = (width) => [
  "interpolate", ["linear"], ["zoom"], 8, width * 0.8, 12, width * 1.2, 15, width * 2,
];

// Roads thin out when zooming out, so the pins stay the main figure.
const roadScaled = (width) => [
  "interpolate", ["linear"], ["zoom"], 8, width * 0.45, 12, width, 15, width * 2,
];

// Icons are 48 px at size 1 (96 px canvas at pixel ratio 2). The official crossings are small,
// about 14 px with the whole border in view and 29 px at street level; the pins a little larger.
const ICON_SIZE = ["interpolate", ["linear"], ["zoom"], 7, 0.3, 10, 0.4, 13, 0.5, 15, 0.6];
const PIN_SIZE = ["interpolate", ["linear"], ["zoom"], 7, 0.36, 10, 0.46, 13, 0.58, 15, 0.7];

const stanjeIs = (value) => ["==", ["get", "stanje"], value];

// A soft light band along the border, as wide as the corridor: roads beyond it take no part.
const FOG_OPACITY = 0.35;

// Pixels across a band of `metres` each side of the border, by zoom (about 45 degrees north).
const corridorWidth = (metres) => ["interpolate", ["exponential", 2], ["zoom"],
  8, (2 * metres * 2 ** 8) / 110700, 18, (2 * metres * 2 ** 18) / 110700];

/** Paint properties that depend on the colour theme, by layer id. */
function themedPaint(theme) {
  const border = BORDER_COLORS[theme];
  const paint = {
    background: { "background-color": SURFACES[theme] },
    "granica-casing": { "line-color": border.casing },
    granica: { "line-color": border.line },
    "staze-par": { "line-color": DANGER[theme] },
    "staze-zona": { "line-color": DANGER[theme] },
    "parovi-tocke": { "circle-color": DANGER[theme], "circle-stroke-color": SURFACES[theme] },
    "par-veza": { "line-color": ink(theme) },
    "segmenti-nedovoljno": { "line-color": ink(theme) },
    "rijecna-granica": { "line-color": RIVER[theme] },
    "mjerenje-casing": { "line-color": SURFACES[theme] },
    "mjerenje-linija": { "line-color": ink(theme) },
    "mjerenje-tocke": { "circle-color": ink(theme), "circle-stroke-color": SURFACES[theme] },
    "segmenti-sporna": { "line-color": ink(theme) },
    "segmenti-prijelaz": { "line-color": "#898781" },
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
  const layers = [
    { id: "pojas-magla", type: "line", source: "granica",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-opacity": FOG_OPACITY, "line-blur": 12,
        "line-width": corridorWidth(state.corridorM ?? 0) } },
    // The two Staze of the pair of the chosen Kritično područje, a soft red under the roads.
    { id: "staze-par", type: "line", source: "staze", filter: NO_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { ...colors["staze-par"], "line-width": roadScaled(8), "line-opacity": 0.4 } },
    // The Staze of every pair within the limit, a faint red under the roads that fades in when
    // zoomed close, so the way a person would walk shows without anything being chosen.
    { id: "staze-zona", type: "line", source: "staze", filter: NO_ID,
      minzoom: 11.5, layout: { "line-cap": "round", "line-join": "round" },
      paint: { ...colors["staze-zona"], "line-width": roadScaled(4.5),
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 11.5, 0, 13.5, 0.45] } },
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
          "line-opacity": style.opacity,
          "line-width": roadScaled(style.width),
          ...(style.dash ? { "line-dasharray": style.dash } : {}),
        },
      },
    );
  }
  layers.push(
    // Riječna granica: a narrow, pale blue band under the border line.
    { id: "rijecna-granica", type: "line", source: "rijecna_granica",
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { ...colors["rijecna-granica"], "line-width": zoomScaled(6), "line-opacity": 0.35 } },
    // Assessed segments are not drawn, only kept clickable.
    { id: "segmenti-klik", type: "line", source: "segmenti", filter: stanjeIs("procijenjen"),
      paint: { "line-color": "#000000", "line-opacity": 0, "line-width": zoomScaled(6) } },
    // Segments without data: a thin dotted line, so a gap reads as "unknown" without shouting.
    { id: "segmenti-nedovoljno", type: "line", source: "segmenti", filter: stanjeIs("nedovoljno_podataka"),
      layout: { "line-cap": "round" },
      paint: { ...colors["segmenti-nedovoljno"], "line-width": zoomScaled(1.6), "line-opacity": 0.45, "line-dasharray": [0.1, 2.4] } },
    { id: "segmenti-sporna", type: "line", source: "segmenti", filter: stanjeIs("sporna_granica"),
      paint: { ...colors["segmenti-sporna"], "line-width": zoomScaled(1.4), "line-opacity": 0.6, "line-dasharray": [2, 2] } },
    { id: "segmenti-prijelaz", type: "line", source: "segmenti", filter: stanjeIs("sluzbeni_prijelaz"),
      paint: { ...colors["segmenti-prijelaz"], "line-width": zoomScaled(2), "line-opacity": 0.6 } },
    { id: "granica-casing", type: "line", source: "granica",
      paint: { ...colors["granica-casing"], "line-width": 4.4, "line-opacity": 0.75 } },
    { id: "granica", type: "line", source: "granica",
      paint: { ...colors.granica, "line-width": 2.4, "line-dasharray": [5, 2, 1.2, 2] } },
    { id: "prijelazi-sluzbeni", type: "symbol", source: "prijelazi",
      filter: ["==", ["get", "tip"], "sluzbeni_prijelaz"],
      minzoom: 9,
      layout: { "icon-image": "ikona-prijelaz", "icon-allow-overlap": true,
        "icon-size": ICON_SIZE } },
    // Izravni prelasci: like the pins, left out where they would overlap (the pins are placed first).
    { id: "prijelazi-izravni", type: "symbol", source: "prijelazi",
      filter: ["==", ["get", "tip"], "izravni_prelazak"],
      layout: { "icon-image": "ikona-izravni", "icon-size": PIN_SIZE } },
    // One pin per Kritično područje, on the border in the middle of it. Pins that would overlap
    // are left out, the longer area first, so zoomed out only the largest are shown.
    ...["kopno", "rijeka"].map((kategorija) => ({
      id: AREA_PIN_LAYERS[kategorija], type: "symbol", source: "podrucja",
      filter: ["==", ["get", "kategorija"], kategorija],
      layout: { "icon-image": `pin-${kategorija}`, "icon-anchor": "bottom", "icon-size": PIN_SIZE,
        "symbol-sort-key": ["-", 0, ["get", "duljina_m"]] },
    })),
    // Walking links of the nearest pairs of the chosen Kritično područje: from the BiH road across
    // the border to the HR road, tied to the border by a dotted line when they lie farther away.
    // The shortest link between two Staze, before anything is chosen: a thin dashed white line over
    // a dark casing with a dot at each end, a measuring line that does not cover the imagery.
    { id: "zona-veze-casing", type: "line", source: "zona-veze", filter: ["==", ["geometry-type"], "LineString"],
      minzoom: 12.5, layout: { "line-cap": "round" },
      paint: { "line-color": "#141413", "line-width": zoomScaled(3.4),
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 12.5, 0, 14, 0.55] } },
    { id: "zona-veze", type: "line", source: "zona-veze", filter: ["==", ["geometry-type"], "LineString"],
      minzoom: 12.5, layout: { "line-cap": "butt" },
      paint: { "line-color": "#ffffff", "line-width": zoomScaled(1.6), "line-dasharray": [2, 1.5],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 12.5, 0, 14, 1] } },
    { id: "zona-veze-tocke", type: "circle", source: "zona-veze", filter: ["==", ["geometry-type"], "Point"],
      minzoom: 12.5, paint: { "circle-color": "#ffffff", "circle-radius": ["interpolate", ["linear"], ["zoom"], 12.5, 1.5, 16, 3.2],
        "circle-stroke-color": "#141413", "circle-stroke-width": 1,
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 12.5, 0, 14, 1],
        "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 12.5, 0, 14, 0.8] } },
    { id: "par-odabir", type: "line", source: "par-hover", filter: ["==", ["get", "vrsta"], "par"],
      layout: { "line-cap": "round" },
      paint: { "line-color": "#ffffff", "line-width": zoomScaled(12), "line-opacity": 0.65 } },
    { id: "parovi-casing", type: "line", source: "parovi", filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": zoomScaled(9), "line-opacity": 0.55 } },
    { id: "parovi-linija", type: "line", source: "parovi", filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round" },
      paint: { "line-color": "#2b2a28", "line-width": zoomScaled(1.6), "line-dasharray": [2, 1.5] } },
    { id: "parovi-tocke", type: "circle", source: "parovi", filter: ["==", ["geometry-type"], "Point"],
      paint: { ...colors["parovi-tocke"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2, 14, 4.5],
        "circle-stroke-width": 1.2 } },
    { id: "par-veza", type: "line", source: "par-hover", filter: ["==", ["get", "vrsta"], "veza"],
      layout: { "line-cap": "round" },
      paint: { ...colors["par-veza"], "line-width": 1.4, "line-dasharray": [0.5, 2.5] } },
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
  { id: "izravni", label: "Izravni prelasci", hint: "Staze koje presijecaju granicu izvan službenog prijelaza", layers: ["prijelazi-izravni"] },
  { id: "kopno", label: "Blizu granice", hint: "Kritična područja: putovi s obje strane granice blizu su jedan drugome", layers: ["podrucja-kopno"] },
  { id: "preko-rijeke", label: "Preko rijeke", hint: "Kritična područja gdje se mora prijeći rijeku", layers: ["podrucja-rijeka"] },
  { id: "zona", label: "Zona područja", hint: "Putovi najbližih parova, vidljivi tek pri većem zumu",
    layers: ["staze-zona", "zona-veze-casing", "zona-veze", "zona-veze-tocke"] },
  { id: "odabir", label: "Odabrano područje", hint: "Najbliži par staza i pješački prijelaz odabranog područja",
    layers: [
      "staze-par", "par-odabir", "parovi-casing", "parovi-linija",
      "parovi-tocke", "par-veza",
    ],
    onChange: (visible) => $("map").classList.toggle("hide-pair-labels", !visible) },
  { id: "segmenti", label: "Stanje granice", hint: "Granica bez podataka, sporna granica i granica uz službeni prijelaz",
    layers: ["segmenti-klik", "segmenti-nedovoljno", "segmenti-sporna", "segmenti-prijelaz"] },
  { id: "prijelazi", label: "Službeni prijelazi", hint: "Službeni granični prijelazi", layers: ["prijelazi-sluzbeni"] },
  { id: "granica", label: "Granična linija", hint: "Granična linija", layers: ["granica-casing", "granica"] },
  { id: "rijeka", label: "Rijeka", hint: "Granica na rijeci (plavo)", layers: ["rijecna-granica"] },
  { id: "cesta", label: "Ceste", hint: "Ceste", layers: ["staze-cesta-casing", "staze-cesta"] },
  { id: "makadam", label: "Makadami", hint: "Makadami i šumski putovi", layers: ["staze-makadam-casing", "staze-makadam"] },
  { id: "staza", label: "Staze", hint: "Staze i puteljci", layers: ["staze-staza-casing", "staze-staza"] },
  { id: "magla", label: "Magla", hint: "Svjetliji pojas uz granicu u kojem putovi ulaze u izračun", layers: ["pojas-magla"] },
];

// One-click views: the layer groups that stay on.
const LAYER_PRESETS = [
  { label: "Sve", on: null },
  { label: "Samo oznake", on: ["izravni", "kopno", "preko-rijeke", "odabir", "prijelazi", "granica"] },
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
    // The imagery itself, then transparent label layers (`overlays`) drawn over it.
    const sources = {};
    const layers = [];
    [def, ...(def.overlays ?? [])].forEach((part, index) => {
      const id = index ? `bm-${def.id}-${index}` : `bm-${def.id}`;
      sources[id] = {
        type: "raster", tiles: part.tiles, tileSize: part.tileSize ?? def.tileSize, maxzoom: part.maxzoom ?? def.maxzoom,
        attribution: part.attribution,
      };
      layers.push({ id, type: "raster", source: id });
    });
    if (!def.labels) return { sources, layers };
    // Place names and boundaries from a vector style, over the imagery.
    const style = await fetchStyle(def.labels.style);
    for (const [name, source] of Object.entries(style.sources)) sources[`bm-lab-${name}`] = source;
    const [a, b] = def.labels.omitBorderBetween;
    const notThatBorder = ["all", ["!=", ["get", "maritime"], 1], ["!", ["all", ["in", ["get", "adm0_l"], ["literal", [a, b]]], ["in", ["get", "adm0_r"], ["literal", [a, b]]]]]];
    for (const layer of style.layers) {
      if (!["place", "water_name", "boundary"].includes(layer["source-layer"])) continue;
      const copy = { ...layer, id: `bm-lab-${layer.id}`, source: `bm-lab-${layer.source}` };
      if (layer.type === "symbol") {
        // The style's grey names are made for its dark map: light text with a dark halo on imagery.
        copy.paint = { ...layer.paint, "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.85)", "text-halo-width": 1.6, "text-halo-blur": 0.5 };
      }
      if (layer["source-layer"] === "boundary") {
        copy.filter = layer.filter ? ["all", layer.filter, notThatBorder] : notThatBorder;
        // The style's grey lines are made for a map, not for imagery: thin and light instead.
        copy.paint = { ...layer.paint, "line-color": "#ffffff", "line-opacity": 0.6, "line-width": 1.2, "line-blur": 0 };
      }
      layers.push(copy);
    }
    return { sources, layers, glyphs: style.glyphs };
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

  legend.append(
    legendGroup(
      "Oznake na karti",
      legendRow(imageElement(izravniPrelazakCanvas(), ""), "Izravni prelazak", "Staza presijeca granicu izvan službenog prijelaza. Popis je u izborniku."),
      legendRow(imageElement(pinCanvas(PINS.kopno), ""), "Kritično područje: blizu granice", `Staze s obje strane granice na najviše ${metres(state.band.maxM)} jedna od druge, bez rijeke između.`),
      legendRow(imageElement(pinCanvas(PINS.rijeka), ""), "Kritično područje: preko rijeke", "Isto, ali između staza leži vodotok koji treba prijeći."),
      legendRow(imageElement(sluzbeniPrijelazCanvas(), ""), "Službeni prijelaz", "Susjedni segmenti izuzeti su iz procjene."),
    ),
    legendGroup(
      "Granica",
      legendRow(
        sample((svg) => {
          sampleLine(svg, BORDER_COLORS[theme].casing, 4, { opacity: 0.5 });
          sampleLine(svg, BORDER_COLORS[theme].line, 1.6, { dash: "7 3 2 3" });
        }),
        "Granična linija",
      ),
      legendRow(
        sample((svg) => {
          sampleLine(svg, RIVER[theme], 6, { opacity: 0.35 });
          sampleLine(svg, BORDER_COLORS[theme].line, 1.6, { dash: "7 3 2 3" });
        }),
        "Granica na rijeci",
        "Granica teče rijekom ili uz vodu (do 75 m od nje).",
      ),
      legendRow(
        sample((svg) => sampleLine(svg, ink(theme), 1.6, { dash: "0.1 4", opacity: 0.45 })),
        "Nedovoljno podataka",
        `S barem jedne Strane nema staze unutar ${corridorText()} od granice. To nije nizak rizik.`,
      ),
      legendRow(sample((svg) => sampleLine(svg, ink(theme), 1.6, { dash: "5 4", opacity: 0.6 })), "Sporna granica", "Rizik se ne računa."),
    ),
    legendGroup(
      "Staze",
      legendRow(roadSample("cesta", theme), "Cesta"),
      legendRow(roadSample("makadam", theme), "Makadam / šumski put"),
      legendRow(roadSample("staza", theme), "Staza / puteljak"),
      legendRow(
        sample((svg) => {
          const { fill, casing } = ROAD_STYLES[theme].cesta;
          sampleLine(svg, casing, 4.8);
          sampleLine(svg, fill, 3);
          svg.append(svgElement("rect", { x: 0, y: 0, width: 34, height: 18, fill: "#ffffff", "fill-opacity": FOG_OPACITY }));
        }),
        `Do ${corridorText()} od granice (svjetliji pojas)`,
        "Samo taj dio staza ulazi u izračun. Udaljenost se bira u izborniku „Napredno”.",
      ),
    ),
  );
  const note = element("p", `U izračun ulaze ceste, makadami i staze, i to samo njihovi dijelovi do ${corridorText()} od granice. Udaljenost para staza je najmanje zbroj njihovih udaljenosti od granice, pa prag iznad ${metres(2 * state.corridorM)} hvata samo parove razmaknute uzduž granice. Odabirom područja u izborniku vidi se par staza koji ga čini kritičnim i put pješice između njih.`, "legend-title");
  legend.append(note);
}

const kilometres = (metres) =>
  metres >= 1000 ? `${number(1).format(metres / 1000)} km` : `${number(0).format(metres)} m`;

const metres = (value) => `${number(0).format(value)} m`;
const bandText = ({ maxM }) => `do ${metres(maxM)}`;

/** Croatian plural of a count: 1 područje, 2 područja, 5 područja. */
const plural = (n, one, few, many) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;

// ---------------------------------------------------------------------------------------------
// Corridor: how far from the border roads count (max_border_distance_m). The pipeline computes
// the segments for a list of values (meta.pojasevi_m, docs/ugovor-izlaza.md); the planner types
// one from a dropdown and the page loads its file.

const corridorText = () => metres(state.corridorM);

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
  state.map.setPaintProperty("pojas-magla", "line-width", corridorWidth(state.corridorM));
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
  $("band-max").max = String(Math.max(Math.ceil(farthest / 500) * 500, state.band.maxM));
}

// ---------------------------------------------------------------------------------------------
// Ignoring segments on Riječna granica (na_rijeci): a river makes the crossing harder, so the
// planner can leave those out of the Kritična područja.

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
  const onRiver = state.segments.filter((s) => s.properties.na_rijeci && inReach(s.properties, { ...state.band, skipRiver: false })).length;
  const noun = plural(onRiver, "segment", "segmenta", "segmenata");
  detail.textContent = state.skipRiver
    ? `Uključeno: izostavljeno ${onRiver} ${noun} na rijeci.`
    : `Isključeno: ${onRiver} ${noun} unutar praga ${plural(onRiver, "leži", "leže", "leži")} na rijeci.`;
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

const emptyCollection = () => ({ type: "FeatureCollection", features: [] });

function recomputeAreas() {
  state.band = { maxM: Number($("band-max").value), skipRiver: state.skipRiver };
  $("band-value").textContent = bandText(state.band);
  // A pair made of a Staza that crosses the border is that Izravni prelazak, not a Kritično područje.
  const crossingWays = new Set(state.crossings.map((f) => f.properties.staza_id));
  for (const feature of state.segments) {
    const q = feature.properties;
    q.par_prelazi = crossingWays.has(q.hr_staza_id) || crossingWays.has(q.bih_staza_id);
  }
  state.areas = kriticnaPodrucja(state.segments, state.band);
  state.areaById = new Map(AREA_CATEGORIES.flatMap((kategorija) => state.areas[kategorija].map((area) => [area.id, area])));
  state.map.getSource("podrucja").setData(pinsData());
  const links = crossingLinks(state.segments, state.band);
  state.linkBySegment = new Map(links.flatMap((link) => link.segmentIds.map((id) => [id, link])));
  drawZone(links);
  clearSelection(); // the lists are rebuilt, so nothing stays chosen
  renderLegend();
  renderAreaLists();
  renderSkipRiver();
}

/** The faint detail of all Kritična područja: glow on their border segments, their pairs of Staze
 * and the links between them. MapLibre draws only what is in view, and only when zoomed in. */
function drawZone(links) {
  const { map } = state;
  const members = AREA_CATEGORIES.flatMap((k) => state.areas[k].flatMap((a) => a.segments.map((s) => s.properties)));
  const ids = members.map((p) => p.id);
  const hr = new Set(members.map((p) => p.hr_staza_id));
  const bih = new Set(members.map((p) => p.bih_staza_id));
  map.setFilter("staze-zona", ids.length ? ["any",
    ["all", ["==", ["get", "strana"], "HR"], ["in", ["get", "id"], ["literal", [...hr]]]],
    ["all", ["==", ["get", "strana"], "BiH"], ["in", ["get", "id"], ["literal", [...bih]]]],
  ] : NO_ID);
  map.getSource("zona-veze").setData(linksData(links));
}

/** One pin per Kritično područje, on the border in the middle of it. */
function pinsData() {
  const features = AREA_CATEGORIES.flatMap((kategorija) => state.areas[kategorija].map((area) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: area.marker },
    properties: { id: area.id, kategorija, duljina_m: area.lengthM },
  })));
  return { type: "FeatureCollection", features };
}

/** The walking links of the nearest pairs, each with a dot on its BiH and its HR end. */
function linksData(links) {
  return {
    type: "FeatureCollection",
    features: links.flatMap((link) => [
      { type: "Feature", geometry: { type: "LineString", coordinates: [link.bih, link.hr] }, properties: { udaljenost_m: link.distanceM } },
      { type: "Feature", geometry: { type: "Point", coordinates: link.bih }, properties: { strana: "BiH" } },
      { type: "Feature", geometry: { type: "Point", coordinates: link.hr }, properties: { strana: "HR" } },
    ]),
  };
}

/** Nothing chosen: no marked segments, no highlighted pair, no links. */
function clearSelection() {
  const { map } = state;
  map.getSource("parovi").setData(emptyCollection());
  for (const button of document.querySelectorAll(".area-button[aria-current]")) button.removeAttribute("aria-current");
  state.selectedPair = null;
  highlightPair();
}

/** Clears the previous choice; for a Kritično područje also shows its pairs of Staze and the links
 * between them, and the pair of the closest one stays highlighted with its labels. */
function select({ area = null }) {
  clearSelection();
  if (!area) return;
  state.selectedPair = closestPairSegment(area);
  state.map.getSource("parovi").setData(linksData(crossingLinks(area.segments, state.band)));
  highlightPair();
}

/** Marks the list entry of a chosen area or crossing, opening its list and scrolling to it. */
function markListEntry(id) {
  for (const button of document.querySelectorAll(".area-button[aria-current]")) button.removeAttribute("aria-current");
  const button = document.querySelector(`.area-button[data-id="${id}"]`);
  if (!button) return;
  button.setAttribute("aria-current", "true");
  showTab(button.closest(".pane")?.dataset.pane);
  const section = button.closest("details");
  if (section) section.open = true;
  button.scrollIntoView({ block: "nearest" });
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

/** Labels on the map for a highlighted pair: "BiH staza" and "HR staza" at the two ends, each on the
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
    label.append(element("strong", `${strana} staza`), element("small", `${metres(p[`${prefix}_od_granice_m`])} od granice`));
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

/** Highlights the pair of the chosen Kritično područje: its two Staze, its walking link, labels
 * naming both ends and a dotted line from the segment to the link. Clears it when none is chosen. */
function highlightPair() {
  const segment = state.selectedPair;
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

/** The segment of an area with the closest pair: the pair named in the list and kept highlighted. */
const closestPairSegment = (area) =>
  area.segments.reduce((best, s) => (s.properties.udaljenost_m < best.properties.udaljenost_m ? s : best));

/** How many Kritična područja a category has and how long they are in total. */
function renderAreasSummary(kategorija) {
  const areas = state.areas[kategorija];
  const total = areas.reduce((sum, a) => sum + a.lengthM, 0);
  const summary = $(`areas-summary-${kategorija}`);
  summary.replaceChildren();
  $(`areas-count-${kategorija}`).textContent = String(areas.length);
  if (areas.length) {
    const n = areas.length;
    summary.append(
      element("strong", String(n)), ` ${plural(n, "područje", "područja", "područja")} · `,
      element("strong", kilometres(total)), " granice.",
    );
  } else {
    summary.textContent = "Nema područja unutar ovog praga.";
  }
}

/** One button per Kritično područje, longest first, naming the pair of Staza that makes it: a click
 * flies the map to it. */
function renderAreaList(kategorija) {
  const list = $(`areas-${kategorija}`);
  list.replaceChildren();
  for (const area of state.areas[kategorija]) {
    const button = element("button", undefined, `area-button cat-${kategorija}`);
    button.type = "button";
    button.dataset.id = area.id;
    const p = closestPairSegment(area).properties;
    const text = element("span", undefined, "area-text");
    const head = element("span", undefined, "area-head");
    head.append(element("strong", `par staza ${metres(p.udaljenost_m)}`), element("span", ` · ${kilometres(area.lengthM)} granice`));
    const where = element("small", undefined, "area-place");
    text.append(head, where);
    fillPlaceWhenSeen(where, button, areaPoint(area));
    button.append(element("span", String(area.rang), "area-rank"), text);
    button.setAttribute("aria-label", `Područje ${area.rang}: par staza na ${metres(p.udaljenost_m)}, ${kilometres(area.lengthM)} granice. Prikaži na karti.`);
    button.addEventListener("click", () => showArea(area, { fly: true }));
    const item = element("li");
    item.append(button);
    list.append(item);
  }
}

function renderAreaLists() {
  for (const kategorija of AREA_CATEGORIES) {
    renderAreasSummary(kategorija);
    renderAreaList(kategorija);
  }
}

/** What kind of way an Izravni prelazak is: its OSM name, else the kind of way it is. */
function crossingName(p) {
  if (p.naziv) return `„${p.naziv}”`;
  return HIGHWAY_LABELS[p.highway] ?? CATEGORY_LABELS[p.kategorija] ?? "staza";
}

const capitalized = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const coordinatesText = ([lon, lat]) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

/** A point in the middle of the closest pair of an area, to name the place it lies at. */
function areaPoint(area) {
  const line = closestPairSegment(area).geometry.coordinates;
  return line[Math.floor(line.length / 2)];
}

/** A line saying where a point is (settlement, municipality, county), filled in once it is known. */
function placeLine(coordinates, className = "muted") {
  const line = element("p", "Tražim mjesto…", className);
  placeAt(coordinates).then((place) => {
    if (place) line.textContent = placeText(place);
    else line.remove();
  });
  return line;
}

// Lists name the place of each entry when it scrolls into view, one lookup a second at most.
const placeObserver = "IntersectionObserver" in globalThis
  ? new IntersectionObserver((entries) => {
    for (const { isIntersecting, target } of entries) {
      if (!isIntersecting) continue;
      placeObserver.unobserve(target);
      target.placeFill?.();
    }
  }, { rootMargin: "120px" })
  : null;

/** Puts "place · county" into `node` once the list entry holding it is on screen. */
function fillPlaceWhenSeen(node, button, coordinates, suffix = "") {
  button.placeFill = () => placeAt(coordinates).then((place) => {
    const text = placeShort(place);
    if (text) node.textContent = text + suffix;
  });
  placeObserver?.observe(button);
}

/** One button per Izravni prelazak: roads first, then tracks and paths, along the border. */
function renderCrossingList() {
  const list = $("izravni");
  list.replaceChildren();
  $("izravni-count").textContent = String(state.crossings.length);
  $("izravni-summary").replaceChildren();
  const n = state.crossings.length;
  if (n) {
    $("izravni-summary").append(
      element("strong", String(n)), ` ${plural(n, "prelazak", "prelaska", "prelazaka")} izvan službenih prijelaza.`,
    );
  } else {
    $("izravni-summary").textContent = "Nijedna staza ne presijeca granicu izvan službenog prijelaza.";
  }
  state.crossings.forEach((feature, i) => {
    const p = feature.properties;
    const button = element("button", undefined, "area-button cat-izravni");
    button.type = "button";
    button.dataset.id = `izravni-${p.segment}`;
    const text = element("span", undefined, "area-text");
    const head = element("span", undefined, "area-head");
    head.append(element("strong", capitalized(crossingName(p))));
    const where = element("small");
    text.append(head, where);
    fillPlaceWhenSeen(where, button, feature.geometry.coordinates);
    button.append(element("span", String(i + 1), "area-rank"), text);
    button.setAttribute("aria-label", `Izravni prelazak ${i + 1}: ${crossingName(p)}. Prikaži na karti.`);
    button.addEventListener("click", () => showCrossing(feature));
    const item = element("li");
    item.append(button);
    list.append(item);
  });
}

/** The Izravni prelasci from prijelazi.geojson: roads first, then tracks and paths, each in the
 * order along the border. */
function crossingsFrom(prijelazi) {
  const rank = (p) => Object.keys(CATEGORY_LABELS).indexOf(p.kategorija);
  const [lanac, red] = [(p) => Number(p.segment.split("-")[0]), (p) => Number(p.segment.split("-")[1])];
  return prijelazi.features
    .filter((f) => f.properties.tip === "izravni_prelazak")
    .sort((a, b) => rank(a.properties) - rank(b.properties)
      || lanac(a.properties) - lanac(b.properties) || red(a.properties) - red(b.properties));
}

/** Frames the map on a Kritično područje (with both ends of its pairs) or flies to a point, with
 * room for the labels at the ends of the pair and the controls in the map's corners. */
function fitArea(area) {
  const { map } = state;
  const { width, height } = map.getContainer().getBoundingClientRect();
  const side = Math.min(150, width * 0.2);
  const padding = { top: Math.min(110, height * 0.2), bottom: Math.min(80, height * 0.15), left: side, right: side };
  map.fitBounds(areaBounds(area, { withPairs: true }), { padding, maxZoom: 15, ...GLIDE });
}

/** Chooses a Kritično područje: its segments are marked, the closest pair stays highlighted until
 * another choice. From the list the map flies to it, from a pin it stays where it is. */
function showArea(area, { fly }) {
  select({ area });
  markListEntry(area.id);
  if (fly) {
    fitArea(area);
    return;
  }
  // From a pin only the shortest pair shows, with its distances: frame it if it lies off screen.
  const link = state.linkBySegment.get(state.selectedPair.properties.id);
  if (!link) return;
  const { map } = state;
  const pad = Math.min(120, map.getContainer().clientWidth * 0.2);
  map.fitBounds([link.hr, link.bih].reduce(
    (b, c) => b.extend(c), new globalThis.maplibregl.LngLatBounds(link.hr, link.hr)),
  { padding: pad, maxZoom: 16, ...GLIDE });
}

/** Chooses an Izravni prelazak and flies to it. */
function showCrossing(feature) {
  const p = feature.properties;
  select({});
  markListEntry(`izravni-${p.segment}`);
  const { map } = state;
  map.flyTo({ center: feature.geometry.coordinates, zoom: Math.max(map.getZoom(), 15), ...GLIDE });
  state.openPopup?.(feature.geometry.coordinates, crossingPopup(feature));
}

// ---------------------------------------------------------------------------------------------
// Click details

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/** Name of a Staza of a nearest pair: its OSM name, else the kind of way it is. The Staze layer is
 * the source, because the per-corridor files (pojasevi/) carry no names. */
function roadName(p, prefix) {
  const staza = state.stazaById.get(`${prefix === "hr" ? "HR" : "BiH"}:${p[`${prefix}_staza_id`]}`);
  const name = staza?.naziv ?? p[`${prefix}_staza_naziv`];
  if (name) return `„${name}”`;
  return `${HIGHWAY_LABELS[staza?.highway] ?? "staza"} bez naziva`;
}

/** What a pin or list entry of a Kritično područje says: its kind, the closest pair of Staze and how
 * far apart they are, matching the labels at the two ends of the pair once it is chosen. */
function areaPopup(area, { compact = false } = {}) {
  const segment = closestPairSegment(area);
  const p = segment.properties;
  const root = element("div", undefined, "popup why");
  root.append(
    element("strong", `Kritično područje · ${AREA_TITLES[area.kategorija].toLowerCase()}`),
    element("p", `Najbliži par staza ${metres(p.udaljenost_m)} · ${kilometres(area.lengthM)} granice`, "muted"),
  );
  if (compact) return root;
  root.append(placeLine(areaPoint(area)));
  const pair = element("dl", undefined, "pair");
  for (const [strana, prefix] of [["BiH", "bih"], ["HR", "hr"]]) {
    pair.append(
      element("dt", `${strana} staza`),
      element("dd", `${roadName(p, prefix)}, ${metres(p[`${prefix}_od_granice_m`])} od granice`),
    );
  }
  const minutes = Math.max(1, Math.round(p.udaljenost_m / WALKING_M_PER_MINUTE));
  root.append(pair, element("p", `Pješice od jedne do druge staze ${metres(p.udaljenost_m)} zračne linije, najmanje oko ${minutes} min hoda.`));
  if (area.kategorija === "rijeka") root.append(element("p", "Između staza je vodotok koji treba prijeći."));
  const link = state.linkBySegment.get(p.id);
  if (link) {
    const { distanceM } = linkPlacement(segment, link);
    if (distanceM >= LINK_NEARBY_M) {
      root.append(element("p", `Par je ${kilometres(distanceM)} od ovog dijela granice: prati točkastu crtu.`));
    }
  }
  return root;
}

/** What a pin or list entry of an Izravni prelazak says. */
function crossingPopup(feature, { compact = false } = {}) {
  const p = feature.properties;
  const root = element("div", undefined, "popup why");
  root.append(
    element("strong", "Izravni prelazak"),
    element("p", capitalized(crossingName(p)), "muted"),
  );
  if (compact) return root;
  root.append(
    placeLine(feature.geometry.coordinates, "place"),
    element("p", "Staza prelazi granicu izvan službenog prijelaza."),
    element("p", coordinatesText(feature.geometry.coordinates), "muted"),
  );
  return root;
}

function riverTooltip() {
  const root = element("div", undefined, "popup");
  root.append(element("strong", "Granica na rijeci"));
  return root;
}

/** Tooltips that follow the mouse, one at a time: a pin of a Kritično područje, an Izravni prelazak,
 * then Riječna granica. */
function setupHover() {
  const { map } = state;
  const tooltip = new globalThis.maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "300px", offset: 12 });
  const hit = (point, layer) => map.getLayoutProperty(layer, "visibility") !== "none"
    && map.queryRenderedFeatures(point, { layers: [layer] })[0];
  map.on("mousemove", (event) => {
    if (state.popupOpen) {
      tooltip.remove();
      return;
    }
    // A few pixels of slack: the pins are small with the whole border in view.
    const { x, y } = event.point;
    const near = [[x - 8, y - 8], [x + 8, y + 8]];
    let content = null;
    for (const kategorija of AREA_CATEGORIES) {
      const pin = hit(near, AREA_PIN_LAYERS[kategorija]);
      if (pin) {
        content = areaPopup(state.areaById.get(pin.properties.id), { compact: true });
        break;
      }
    }
    if (!content) {
      const crossing = hit(near, "prijelazi-izravni");
      if (crossing) content = crossingPopup(crossing, { compact: true });
    }
    map.getCanvas().style.cursor = content ? "pointer" : state.measure.active ? "crosshair" : "";
    if (!content && hit(event.point, "rijecna-granica")) content = riverTooltip();
    if (content) tooltip.setLngLat(event.lngLat).setDOMContent(content).addTo(map);
    else tooltip.remove();
  });
  map.getCanvas().addEventListener("mouseleave", () => tooltip.remove());
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

/** A small map of the whole border in a corner, shown once zoomed in, with the current view
 * outlined so one knows where a deep zoom is. The frame can be dragged to move the main map. */
const OVERVIEW_MIN_ZOOM = 9;
const OVERVIEW_MIN_FRAME_DEG = 0.05; // half-size, so the frame stays visible and grabbable
const OVERVIEW_FOLLOW = 0.18; // share of the remaining distance the map covers per frame: smooths the drag

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
  const box = $("overview");
  const satellite = state.basemaps.find((def) => def.id === "satelit");
  const overview = new globalThis.maplibregl.Map({
    container: "overview", interactive: false, attributionControl: false, bounds, fitBoundsOptions: { padding: 10 },
    style: {
      version: 8,
      sources: satellite ? { satelit: { type: "raster", tiles: satellite.tiles, tileSize: satellite.tileSize, maxzoom: 8 } } : {},
      layers: [
        { id: "background", type: "background", paint: { "background-color": SURFACES[mapTheme()] } },
        ...(satellite ? [{ id: "satelit", type: "raster", source: "satelit" }] : []),
      ],
    },
  });
  state.overview = overview;
  // The view of the main map, grown to a minimum size.
  const frameBounds = () => {
    const b = map.getBounds();
    const c = map.getCenter();
    const grow = (low, high, mid) => [Math.min(low, mid - OVERVIEW_MIN_FRAME_DEG), Math.max(high, mid + OVERVIEW_MIN_FRAME_DEG)];
    const [w, e] = grow(b.getWest(), b.getEast(), c.lng);
    const [s, n] = grow(b.getSouth(), b.getNorth(), c.lat);
    return { w, s, e, n };
  };
  const frame = () => {
    const { w, s, e, n } = frameBounds();
    return { type: "Feature", geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, properties: {} };
  };
  const update = () => {
    box.classList.toggle("hidden", map.getZoom() < OVERVIEW_MIN_ZOOM);
    overview.getSource("okvir")?.setData(frame());
  };
  overview.on("load", () => {
    overview.addSource("granica", { type: "geojson", data: granica });
    overview.addSource("okvir", { type: "geojson", data: frame() });
    overview.addLayer({ id: "pregled-linija", type: "line", source: "granica", paint: { "line-color": "#000", "line-width": 1.6 } });
    overview.addLayer({ id: "pregled-ispuna", type: "fill", source: "okvir", paint: { "fill-color": "#c73751", "fill-opacity": 0.18 } });
    overview.addLayer({ id: "pregled-okvir", type: "line", source: "okvir", paint: { "line-color": "#c73751", "line-width": 2 } });
    paintOverview(mapTheme());
    map.on("move", update);
    update();
  });

  // Dragging: the pointer sets a target and the main map glides towards it, so a shaky hand or a
  // coarse overview does not make the view jump about.
  const lngLatAt = (event) => {
    const rect = box.getBoundingClientRect();
    return overview.unproject([event.clientX - rect.left, event.clientY - rect.top]);
  };
  let grab = null; // [dLng, dLat] from the pointer to the map centre while dragging
  let target = null;
  let frameRequest = 0;
  const glide = () => {
    frameRequest = 0;
    if (!target) return;
    const centre = map.getCenter();
    const [from, to] = [map.project(centre), map.project(target)];
    const remaining = Math.hypot(to.x - from.x, to.y - from.y);
    if (remaining < 0.5) {
      map.jumpTo({ center: target });
      return;
    }
    map.jumpTo({ center: [centre.lng + (target[0] - centre.lng) * OVERVIEW_FOLLOW, centre.lat + (target[1] - centre.lat) * OVERVIEW_FOLLOW] });
    frameRequest = requestAnimationFrame(glide);
  };
  const aim = (event) => {
    const at = lngLatAt(event);
    target = [at.lng + grab[0], at.lat + grab[1]];
    if (!frameRequest) frameRequest = requestAnimationFrame(glide);
  };
  box.addEventListener("pointerdown", (event) => {
    const at = lngLatAt(event);
    const { w, s, e, n } = frameBounds();
    const inside = at.lng >= w && at.lng <= e && at.lat >= s && at.lat <= n;
    const centre = map.getCenter();
    grab = inside ? [centre.lng - at.lng, centre.lat - at.lat] : [0, 0];
    try { box.setPointerCapture(event.pointerId); } catch { /* synthetic pointer: no capture */ }
    box.classList.add("dragging");
    aim(event);
  });
  box.addEventListener("pointermove", (event) => {
    if (grab) aim(event);
  });
  const release = () => {
    grab = null;
    box.classList.remove("dragging");
  };
  box.addEventListener("pointerup", release);
  box.addEventListener("pointercancel", release);
}

/** The card has three tabs (Prelasci, Područja, Slojevi); only the chosen one is shown. */
function showTab(name) {
  if (!name) return;
  for (const tab of document.querySelectorAll(".tabs [role=tab]")) {
    const on = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  for (const pane of document.querySelectorAll(".pane")) pane.hidden = pane.dataset.pane !== name;
}

function setupTabs() {
  const tabs = [...document.querySelectorAll(".tabs [role=tab]")];
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => showTab(tab.dataset.tab));
    tab.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      const next = tabs[(i + step + tabs.length) % tabs.length];
      showTab(next.dataset.tab);
      next.focus();
    });
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
    coordsPopup?.remove();
    popup = new globalThis.maplibregl.Popup({ maxWidth: "340px", offset: 14 }).setLngLat(lngLat).setDOMContent(content).addTo(map);
    popup.on("close", () => { state.popupOpen = false; });
    state.popupOpen = true; // the hover tooltips wait while it is open
  };
  state.openPopup = open;
  setupLongPress(() => popup?.remove());
  map.on("click", (event) => {
    if (state.measure.active) return; // clicks set measuring points instead
    if (state.longPressed) { // the click that ends a long press only shows the coordinates
      state.longPressed = false;
      return;
    }
    const box = [[event.point.x - 8, event.point.y - 8], [event.point.x + 8, event.point.y + 8]];
    const visible = (layer) => map.getLayoutProperty(layer, "visibility") !== "none";
    const crossing = visible("prijelazi-izravni") && map.queryRenderedFeatures(box, { layers: ["prijelazi-izravni"] })[0];
    if (crossing) {
      showCrossing(state.crossings.find((f) => f.properties.segment === crossing.properties.segment) ?? crossing);
      return;
    }
    for (const kategorija of AREA_CATEGORIES) {
      const pin = visible(AREA_PIN_LAYERS[kategorija]) && map.queryRenderedFeatures(box, { layers: [AREA_PIN_LAYERS[kategorija]] })[0];
      if (pin) {
        showArea(state.areaById.get(pin.properties.id), { fly: false });
        return;
      }
    }
    const icons = map.queryRenderedFeatures(box, { layers: ["prijelazi-sluzbeni"] });
    if (icons.length) {
      const root = element("div", undefined, "popup");
      root.append(element("h3", "Službeni prijelaz"), element("p", "Službeni prijelaz (OSM barrier=border_control). Susjedni segmenti izuzeti su iz procjene rizika."));
      open(icons[0].geometry.coordinates, root);
      return;
    }
    // A click on the border itself does nothing: first closes only the text box, then also the chosen area.
    if (state.popupOpen || coordsPopup?.isOpen()) {
      popup?.remove();
      coordsPopup?.remove();
    } else {
      clearSelection();
    }
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

/** Padding for the first view: the floating panel covers the left, so the border is centred in what is free. */
function initialPadding() {
  const wide = !window.matchMedia("(max-width: 760px)").matches;
  return { top: 70, bottom: 50, right: 70, left: wide ? 390 : 40 };
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
    fitBoundsOptions: { padding: initialPadding() },
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
    map.addImage("pin-kopno", imageData(pinCanvas(PINS.kopno)), { pixelRatio: 2 });
    map.addImage("pin-rijeka", imageData(pinCanvas(PINS.rijeka)), { pixelRatio: 2 });
    map.addImage("ikona-prijelaz", imageData(sluzbeniPrijelazCanvas()), { pixelRatio: 2 });
    map.addImage("ikona-izravni", imageData(izravniPrelazakCanvas()), { pixelRatio: 2 });
    const empty = { type: "FeatureCollection", features: [] };
    map.addSource("staze", { type: "geojson", data: data.staze });
    map.addSource("granica", { type: "geojson", data: data.granica });
    map.addSource("segmenti", { type: "geojson", data: data.segmenti });
    map.addSource("rijecna_granica", { type: "geojson", data: data.rijecna_granica });
    map.addSource("prijelazi", { type: "geojson", data: data.prijelazi });
    map.addSource("podrucja", { type: "geojson", data: empty });
    map.addSource("parovi", { type: "geojson", data: empty });
    map.addSource("zona-veze", { type: "geojson", data: empty });
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
    setupTabs();
    setupPanelToggle();
    setupOverview(data.granica, bounds);
    state.crossings = crossingsFrom(data.prijelazi);
    renderCrossingList();
    recomputeAreas();
  });

  $("band-max").addEventListener("input", () => {
    if (map.getLayer("podrucja-kopno")) recomputeAreas(); // once the layers are added
  });
  darkQuery.addEventListener("change", () => {
    showBasemap(state.basemap); // "Karta" has a style per theme; this applies the palette too
  });
}

start();
