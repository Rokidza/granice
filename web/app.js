// Granice: static map page. Loads the layers precomputed by the pipeline (docs/ugovor-izlaza.md).
// UI text is Croatian; code and comments are English. Domain terms follow GLOSSARY.md.

import CONFIG from "./config.js";
import {
  BORDER_COLORS,
  CASING,
  DANGER,
  ROAD_STYLES,
  SURFACES,
} from "./js/colors.js";
import {
  areaBounds,
  areaCircle,
  areasToCsv,
  areasToGeoJson,
  includedStaze,
  kriticnaPodrucja,
} from "./js/critical.js";

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

const CATEGORY_LABELS = { cesta: "cesta", makadam: "makadam / šumski put", staza: "staza / puteljak" };
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
const SEGMENT_LAYERS = [
  "segmenti-raspon",
  "segmenti-izvan",
  "segmenti-nedovoljno",
  "segmenti-sporna",
  "segmenti-prijelaz",
];
const METRES_PER_DEGREE = 111320;

const state = {
  map: null,
  meta: null,
  segments: [],
  areas: [],
  selectedArea: null,
  band: { ...CONFIG.band }, // nearest-pair distances (m) drawn red and grouped into Kritična područja
  included: { HR: new Map(), BiH: new Map() }, // Staze of those nearest pairs (includedStaze)
  hasLocalBasemap: false,
  hasGlyphs: false,
  basemaps: [],
  basemap: null, // the chosen entry of `basemaps`
  basemapIds: [], // layers and sources currently added for it
  basemapSources: [],
  basemapRequest: 0, // bumped per switch, so a slow style fetch cannot land after a newer choice
  markers: [], // numbered badges of the Kritična područja on the map
  showAreaMarks: true,
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
  const names = ["meta", "staze", "granica", "segmenti", "prijelazi"];
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
function bandFilters({ minM, maxM }) {
  const inside = [
    "all", stanjeIs("procijenjen"),
    [">=", ["get", "udaljenost_m"], minM], ["<=", ["get", "udaljenost_m"], maxM],
  ];
  return {
    "segmenti-casing": ["any", inside, stanjeIs("nedovoljno_podataka")],
    "segmenti-raspon": inside,
    "segmenti-izvan": ["all", stanjeIs("procijenjen"), ["!", inside]],
  };
}

/** Filter of the halo under the Staze of the nearest pairs within the band. */
function includedFilter(included) {
  return ["any", ...Object.entries(included).map(([strana, ids]) => [
    "all", ["==", ["get", "strana"], strana], ["in", ["get", "id"], ["literal", [...ids.keys()]]],
  ])];
}

/**
 * Circle radius in pixels for a radius in metres (property `radius_m`), so a circle keeps its
 * size on the ground while zooming. Exponential base 2 between two zooms is exact for that.
 */
function circleRadius(latitude) {
  // MapLibre's world is 512 px wide at zoom 0.
  const metresPerPixelAtZoom0 = 78271.51696 * Math.cos((latitude * Math.PI) / 180);
  const atZoom = (zoom) => ["max", 12, ["*", ["get", "radius_m"], 2 ** zoom / metresPerPixelAtZoom0]];
  return ["interpolate", ["exponential", 2], ["zoom"], 8, atZoom(8), 16, atZoom(16)];
}

/** Paint properties that depend on the colour theme, by layer id. */
function themedPaint(theme) {
  const border = BORDER_COLORS[theme];
  const paint = {
    background: { "background-color": SURFACES[theme] },
    "granica-casing": { "line-color": border.casing },
    granica: { "line-color": border.line },
    "staze-ukljucene": { "line-color": DANGER[theme] },
    "segmenti-casing": { "line-color": CASING[theme] },
    "segmenti-raspon": { "line-color": DANGER[theme] },
    "segmenti-sporna": { "line-color": ink(theme) },
    "segmenti-prijelaz": { "line-color": "#898781" },
    "segmenti-odabir": { "line-color": theme === "dark" ? "#86b6ef" : "#184f95" },
    "podrucja-halo": { "circle-stroke-color": SURFACES[theme] },
    "podrucja-krug": { "circle-color": DANGER[theme], "circle-stroke-color": DANGER[theme] },
  };
  for (const category of CATEGORIES) {
    const { fill, casing } = ROAD_STYLES[theme][category];
    paint[`staze-${category}`] = { "line-color": fill };
    paint[`staze-${category}-casing`] = { "line-color": casing };
  }
  return paint;
}

function dataLayers(theme, latitude) {
  const colors = themedPaint(theme);
  const bands = bandFilters(state.band);
  const layers = [
    // A light red halo under the Staze the red segments were measured from.
    { id: "staze-ukljucene", type: "line", source: "staze", filter: includedFilter(state.included),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { ...colors["staze-ukljucene"], "line-width": roadScaled(13), "line-opacity": 0.35 } },
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
    { id: "segmenti-odabir", type: "line", source: "segmenti", filter: ["==", ["get", "id"], ""],
      paint: { ...colors["segmenti-odabir"], "line-width": zoomScaled(16), "line-opacity": 0.45 } },
    { id: "granica-casing", type: "line", source: "granica",
      paint: { ...colors["granica-casing"], "line-width": 3.4, "line-opacity": 0.85 } },
    { id: "granica", type: "line", source: "granica",
      paint: { ...colors.granica, "line-width": 1.6, "line-dasharray": [5, 2, 1.2, 2] } },
    { id: "prijelazi-sluzbeni", type: "symbol", source: "prijelazi",
      filter: ["==", ["get", "tip"], "sluzbeni_prijelaz"],
      layout: { "icon-image": "ikona-prijelaz", "icon-allow-overlap": true,
        "icon-size": ICON_SIZE } },
    { id: "prijelazi-izravni", type: "symbol", source: "prijelazi",
      filter: ["==", ["get", "tip"], "izravni_prelazak"],
      layout: { "icon-image": "ikona-izravni", "icon-allow-overlap": true,
        "icon-size": ICON_SIZE } },
    // Kritična područja: a red circle around each, on top of everything else.
    { id: "podrucja-halo", type: "circle", source: "podrucja",
      paint: { ...colors["podrucja-halo"], "circle-radius": circleRadius(latitude), "circle-opacity": 0,
        "circle-stroke-width": 7, "circle-stroke-opacity": 0.8, "circle-pitch-alignment": "map" } },
    { id: "podrucja-krug", type: "circle", source: "podrucja",
      paint: { ...colors["podrucja-krug"], "circle-radius": circleRadius(latitude),
        "circle-opacity": ["case", ["get", "odabrano"], 0.12, 0.04],
        "circle-stroke-width": 3, "circle-stroke-opacity": 1, "circle-pitch-alignment": "map" } },
  );
  return layers;
}

const LAYER_GROUPS = [
  { id: "cesta", label: "Ceste", layers: ["staze-cesta-casing", "staze-cesta"] },
  { id: "makadam", label: "Makadami i šumski putovi", layers: ["staze-makadam-casing", "staze-makadam"] },
  { id: "staza", label: "Staze i puteljci", layers: ["staze-staza-casing", "staze-staza"] },
  { id: "ukljucene", label: "Ceste uključene u izračun (crveni obrub)", layers: ["staze-ukljucene"] },
  { id: "granica", label: "Granična linija", layers: ["granica-casing", "granica"] },
  {
    id: "segmenti", label: "Segmenti granice u rasponu i stanja",
    layers: [
      "segmenti-casing", "segmenti-raspon", "segmenti-izvan", "segmenti-nedovoljno", "segmenti-sporna",
      "segmenti-prijelaz", "segmenti-odabir", "prijelazi-izravni",
    ],
  },
  { id: "prijelazi", label: "Službeni prijelazi", layers: ["prijelazi-sluzbeni"] },
  {
    id: "podrucja", label: "Kritična područja (krugovi)", layers: ["podrucja-halo", "podrucja-krug"],
    onChange: (visible) => {
      state.showAreaMarks = visible;
      for (const marker of state.markers) marker.getElement().style.display = visible ? "" : "none";
    },
  },
];

/** Re-colours the data layers, legend and Kritična područja for the current palette. */
function applyTheme() {
  const theme = mapTheme();
  const { map } = state;
  for (const [layerId, paint] of Object.entries(themedPaint(theme))) {
    if (!map.getLayer(layerId)) continue;
    for (const [property, value] of Object.entries(paint)) map.setPaintProperty(layerId, property, value);
  }
  $("map").style.setProperty("--danger", DANGER[theme]);
  renderLegend();
  renderAreas();
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

function renderToggles() {
  const list = $("layer-toggles");
  list.replaceChildren();
  for (const group of LAYER_GROUPS) {
    const item = document.createElement("li");
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.addEventListener("change", () => {
      for (const id of group.layers) {
        state.map.setLayoutProperty(id, "visibility", box.checked ? "visible" : "none");
      }
      group.onChange?.(box.checked);
    });
    label.append(box, group.label);
    item.append(label);
    list.append(item);
  }
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
      legendRow(hatchBox, "Nedovoljno podataka", "S barem jedne Strane nema mapiranih cesta. To nije nizak rizik."),
      legendRow(imageElement(izravniPrelazakCanvas(), ""), "Izravni prelazak", "Staza presijeca granicu izvan Službenog prijelaza (najviši rizik)."),
      legendRow(imageElement(sluzbeniPrijelazCanvas(), ""), "Službeni prijelaz", "Susjedni segmenti izuzeti su iz procjene."),
      legendRow(sample((svg) => sampleLine(svg, ink(theme), 2.4, { dash: "5 4" })), "Sporna granica", "Rizik se ne računa."),
    ),
    legendGroup(
      "Kritična područja",
      legendRow(
        sample((svg) => {
          svg.append(svgElement("circle", { cx: 17, cy: 10, r: 7.5, fill: DANGER[theme], "fill-opacity": 0.12, stroke: DANGER[theme], "stroke-width": 2.4 }));
          svg.append(svgElement("circle", { cx: 17, cy: 2.5, r: 3, fill: DANGER[theme], stroke: "#fff", "stroke-width": 1 }));
        }),
        "Kritično područje",
        "Niz susjednih segmenata u odabranom rasponu. Broj je rang (najdulji prvi).",
      ),
    ),
    legendGroup(
      "Staze i granica",
      legendRow(roadSample("cesta", theme), "Cesta"),
      legendRow(roadSample("makadam", theme), "Makadam / šumski put"),
      legendRow(roadSample("staza", theme), "Staza / puteljak"),
      legendRow(
        sample((svg) => {
          sampleLine(svg, BORDER_COLORS[theme].casing, 5, { opacity: 0.85 });
          sampleLine(svg, BORDER_COLORS[theme].line, 2.2, { dash: "7 3 2 3" });
        }),
        "Granična linija",
      ),
    ),
  );
  const note = element("p", "U izračun ulaze samo ceste; makadami, šumski putovi i staze prikazani su, ali se ne računaju. Raspon gleda samo udaljenost: segment s vodotokom između para cesta (oznaka „rijeka” u opisu segmenta) također je crven ako je u rasponu.", "legend-title");
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

function recomputeAreas(moved) {
  state.band = readBand(moved);
  $("band-value").textContent = bandText(state.band);
  for (const [layerId, filter] of Object.entries(bandFilters(state.band))) state.map.setFilter(layerId, filter);
  state.included = includedStaze(state.segments, state.band);
  state.map.setFilter("staze-ukljucene", includedFilter(state.included));
  state.areas = kriticnaPodrucja(state.segments, state.band);
  state.selectedArea = null;
  renderLegend();
  renderAreas();
}

const shownAreas = () => {
  const topN = Math.max(1, Number($("top-n").value) || CONFIG.topN);
  return state.areas.slice(0, topN);
};

/** The list in the sidebar and the circles with numbered badges on the map. */
function renderAreas() {
  const shown = shownAreas();
  const total = state.areas.reduce((sum, a) => sum + a.lengthM, 0);
  const summary = $("areas-summary");
  summary.replaceChildren();
  if (state.areas.length) {
    const n = state.areas.length;
    summary.append(
      element("strong", String(n)), ` ${n % 10 === 1 && n % 100 !== 11 ? "područje" : "područja"} · `,
      element("strong", kilometres(total)), ` ukupno. Prikazano prvih ${shown.length}.`,
    );
  } else {
    summary.textContent = "Nema Kritičnih područja u ovom rasponu.";
  }

  const list = $("areas");
  list.replaceChildren();
  for (const area of shown) {
    const item = element("li", undefined, "area" + (state.selectedArea === area.rang ? " selected" : ""));
    item.tabIndex = 0;
    item.dataset.rang = String(area.rang);
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", `Kritično područje ${area.rang}, zumiraj na kartu`);
    const main = element("div", undefined, "area-main");
    const pair = area.minDistanceM === area.maxDistanceM
      ? metres(area.minDistanceM)
      : `${number(0).format(area.minDistanceM)}–${metres(area.maxDistanceM)}`;
    main.append(element("strong", kilometres(area.lengthM)), element("span", `najbliži par ${pair}`));
    item.append(element("span", String(area.rang), "badge"), main);
    const select = () => selectArea(area);
    item.addEventListener("click", select);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
    list.append(item);
  }
  renderAreaMarks(shown);
}

function renderAreaMarks(shown) {
  const { map } = state;
  const circles = shown.map((area) => ({ area, ...areaCircle(area) }));
  map.getSource("podrucja")?.setData({
    type: "FeatureCollection",
    features: circles.map(({ area, lon, lat, radiusM }) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { rang: area.rang, radius_m: radiusM, odabrano: area.rang === state.selectedArea },
    })),
  });
  for (const marker of state.markers) marker.remove();
  state.markers = circles.map(({ area, lon, lat, radiusM }) => {
    const badge = element("button", String(area.rang), "area-badge" + (area.rang === state.selectedArea ? " selected" : ""));
    badge.type = "button";
    badge.setAttribute("aria-label", `Kritično područje ${area.rang}`);
    badge.addEventListener("click", () => selectArea(area));
    if (!state.showAreaMarks) badge.style.display = "none";
    // On the top edge of the circle, so the badge does not cover the Staze inside it.
    return new globalThis.maplibregl.Marker({ element: badge })
      .setLngLat([lon, lat + radiusM / METRES_PER_DEGREE])
      .addTo(map);
  });
}

function selectArea(area) {
  state.selectedArea = area.rang;
  state.map.fitBounds(areaBounds(area), { padding: 140, maxZoom: 14, duration: 600 });
  renderAreas();
  document.querySelector(`.area[data-rang="${area.rang}"]`)?.scrollIntoView({ block: "nearest" });
}

function download(filename, type, text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function setupExport() {
  const band = () => `${state.band.minM}-${state.band.maxM}m`;
  $("export-csv").addEventListener("click", () =>
    download(`kriticna-podrucja-${band()}.csv`, "text/csv", areasToCsv(state.areas)));
  $("export-geojson").addEventListener("click", () =>
    download(`kriticna-podrucja-${band()}.geojson`, "application/geo+json",
      JSON.stringify(areasToGeoJson(state.areas), null, 1)));
}

// ---------------------------------------------------------------------------------------------
// Click details

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function stazaDescription(p, prefix) {
  const id = p[`${prefix}_staza_id`];
  if (id === null || id === undefined) return "–";
  const name = p[`${prefix}_staza_naziv`] || "bez naziva";
  const category = CATEGORY_LABELS[p[`${prefix}_staza_kategorija`]] || "";
  return `${name} · ${category} · OSM way ${id}`;
}

function segmentPopup(p) {
  const root = element("div", undefined, "popup");
  root.append(element("h3", `Segment granice ${p.id}`));
  const lead = {
    nedovoljno_podataka: "Nedovoljno podataka: s barem jedne Strane nema mapiranih Staza. Rizik se ne procjenjuje, a to nije isto što i nizak rizik.",
    sluzbeni_prijelaz: "Uz Službeni prijelaz. Segment je izuzet iz procjene rizika.",
    sporna_granica: "Sporna granica. Za ovaj segment rizik se ne računa.",
  }[p.stanje];
  if (lead) {
    root.append(element("p", lead));
    return root;
  }
  const list = element("dl");
  const rows = [
    ["Rizik prelaska", `${number(2).format(p.rizik)} (od 0 do 1)`],
    ["Najbliži par cesta", `${number(0).format(p.udaljenost_m)} m`],
    ["HR cesta", stazaDescription(p, "hr")],
    ["HR cesta od granice", metres(p.hr_od_granice_m)],
    ["BiH cesta", stazaDescription(p, "bih")],
    ["BiH cesta od granice", metres(p.bih_od_granice_m)],
    ["Duljina segmenta", `${number(0).format(p.duljina_m)} m`],
  ];
  for (const [term, value] of rows) list.append(element("dt", term), element("dd", value));
  root.append(list);
  if (p.izravni_prelazak) root.append(element("span", "Izravni prelazak", "flag"));
  if (p.rijeka) root.append(element("span", "rijeka (rizik spušten za jedan stupanj)", "flag"));
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

/** A tooltip on the Staze of the nearest pairs: how far from the border the pair was measured. */
function setupIncludedHover() {
  const { map } = state;
  const tooltip = new globalThis.maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "280px" });
  map.on("mousemove", "staze-ukljucene", (event) => {
    const p = event.features[0].properties;
    const distances = state.included[p.strana]?.get(p.id);
    if (!distances) return;
    const root = element("div", undefined, "popup");
    root.append(element("strong", borderDistanceText(distances)));
    const name = p.naziv || "cesta bez naziva";
    const n = distances.length;
    const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
    const segments = `${n} ${n % 10 === 1 && n % 100 !== 11 ? "crveni segment" : few ? "crvena segmenta" : "crvenih segmenata"}`;
    root.append(element("p", `${name} · ${p.strana} · najbliža cesta za ${segments}`));
    tooltip.setLngLat(event.lngLat).setDOMContent(root).addTo(map);
  });
  map.on("mouseleave", "staze-ukljucene", () => tooltip.remove());
}

function setupClicks() {
  const { map } = state;
  let popup = null;
  const open = (lngLat, content) => {
    popup?.remove();
    popup = new globalThis.maplibregl.Popup({ maxWidth: "340px" }).setLngLat(lngLat).setDOMContent(content).addTo(map);
  };
  map.on("click", (event) => {
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
      popup?.remove();
      map.setFilter("segmenti-odabir", ["==", ["get", "id"], ""]);
      return;
    }
    const { properties } = hits[0];
    map.setFilter("segmenti-odabir", ["==", ["get", "id"], properties.id]);
    open(event.lngLat, segmentPopup(properties));
  });
  map.on("mousemove", (event) => {
    const box = [[event.point.x - 6, event.point.y - 6], [event.point.x + 6, event.point.y + 6]];
    const layers = [...SEGMENT_LAYERS, "prijelazi-sluzbeni"].filter((id) => map.getLayoutProperty(id, "visibility") !== "none");
    map.getCanvas().style.cursor = map.queryRenderedFeatures(box, { layers }).length ? "pointer" : "";
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

  // The sliders reach the farthest pair in the data, rounded up to 500 m.
  const farthest = Math.max(0, ...state.segments.map((s) => s.properties.udaljenost_m ?? 0));
  for (const [id, value] of [["band-min", state.band.minM], ["band-max", state.band.maxM]]) {
    $(id).max = String(Math.max(Math.ceil(farthest / 500) * 500, state.band.maxM));
    $(id).value = String(value);
  }
  $("top-n").value = String(CONFIG.topN);
  for (const [name, file] of [["segmenti", "segmenti.geojson"], ["staze", "staze.geojson"], ["granica", "granica.geojson"], ["prijelazi", "prijelazi.geojson"]]) {
    const link = element("a", name);
    link.href = CONFIG.dataDir + file;
    link.download = file;
    $("data-links").append(link, " ");
  }
  $("area-tag").textContent = data.meta.podrucje === "pilot" ? "pilot odsječak" : "cijela granica";
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
  const latitude = (bounds[0][1] + bounds[1][1]) / 2;
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
    map.addSource("prijelazi", { type: "geojson", data: data.prijelazi });
    map.addSource("podrucja", { type: "geojson", data: empty });
    for (const layer of dataLayers(theme, latitude)) map.addLayer(layer);

    renderToggles();
    setupBasemapChoice();
    showBasemap(state.basemap);
    setupClicks();
    setupIncludedHover();
    setupExport();
    recomputeAreas();
  });

  for (const id of ["band-min", "band-max"]) {
    $(id).addEventListener("input", (event) => {
      if (map.getLayer("segmenti-raspon")) recomputeAreas(event.target); // once the layers are added
    });
  }
  $("top-n").addEventListener("input", renderAreas);
  darkQuery.addEventListener("change", () => {
    showBasemap(state.basemap); // "Karta" has a style per theme; this applies the palette too
  });
}

start();
