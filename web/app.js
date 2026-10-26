// Granice: static map page. Loads the layers precomputed by the pipeline (docs/ugovor-izlaza.md).
// UI text is Croatian; code and comments are English. Domain terms follow GLOSSARY.md.

import CONFIG from "./config.js";
import { CASING, STAZA_COLORS, SURFACES, riskColor, riskStops } from "./js/colors.js";
import {
  areaBounds,
  areasToCsv,
  areasToGeoJson,
  kriticnaPodrucja,
  riskIndex,
} from "./js/critical.js";

const $ = (id) => document.getElementById(id);
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const currentTheme = () => (darkQuery.matches ? "dark" : "light");
const number = (digits) =>
  new Intl.NumberFormat("hr-HR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const ink = (theme) => (theme === "dark" ? "#f0efec" : "#0b0b0b");
const absolute = (path) => new URL(path, document.baseURI).href;

const CATEGORY_LABELS = { cesta: "cesta", makadam: "makadam / šumski put", staza: "staza / puteljak" };
const CATEGORY_STYLE = {
  cesta: { width: 3, dash: null },
  makadam: { width: 2, dash: null },
  staza: { width: 1.6, dash: [2, 1.5] },
};
const SEGMENT_LAYERS = [
  "segmenti-rizik",
  "segmenti-nedovoljno",
  "segmenti-sporna",
  "segmenti-prijelaz",
];

const state = {
  map: null,
  meta: null,
  segments: [],
  areas: [],
  selectedArea: null,
  hasBasemap: false,
  basemapIds: [],
};

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

function sluzbeniPrijelazCanvas() {
  return drawn(48, (g) => {
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
  return drawn(48, (g) => {
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

const ICON_SIZE = ["interpolate", ["linear"], ["zoom"], 8, 0.35, 12, 0.7, 15, 1];

function riskExpression(theme) {
  return ["interpolate", ["linear"], ["get", "rizik"], ...riskStops(theme).flat()];
}

/** Paint properties that depend on the colour theme, by layer id. */
function themedPaint(theme) {
  const paint = {
    background: { "background-color": SURFACES[theme] },
    granica: { "line-color": ink(theme) },
    "segmenti-casing": { "line-color": CASING[theme] },
    "segmenti-rizik": { "line-color": riskExpression(theme) },
    "segmenti-sporna": { "line-color": ink(theme) },
    "segmenti-prijelaz": { "line-color": "#898781" },
    "kriticno-halo": { "line-color": ink(theme) },
    "segmenti-odabir": { "line-color": theme === "dark" ? "#86b6ef" : "#184f95" },
    "odabrano-podrucje": { "line-color": theme === "dark" ? "#86b6ef" : "#184f95" },
  };
  for (const strana of ["HR", "BiH"]) {
    for (const kategorija of Object.keys(CATEGORY_STYLE)) {
      paint[stazeLayerId(strana, kategorija)] = { "line-color": STAZA_COLORS[theme][strana] };
    }
  }
  return paint;
}

const stazeLayerId = (strana, kategorija) => `staze-${strana}-${kategorija}`;

function dataLayers(theme) {
  const colors = themedPaint(theme);
  const layers = [];
  for (const strana of ["HR", "BiH"]) {
    for (const [kategorija, style] of Object.entries(CATEGORY_STYLE)) {
      const id = stazeLayerId(strana, kategorija);
      layers.push({
        id,
        type: "line",
        source: "staze",
        filter: ["all", ["==", ["get", "strana"], strana], ["==", ["get", "kategorija"], kategorija]],
        paint: {
          ...colors[id],
          "line-width": zoomScaled(style.width),
          ...(style.dash ? { "line-dasharray": style.dash } : {}),
          "line-opacity": 0.9,
        },
      });
    }
  }
  const critical = ["==", ["get", "kriticno"], true];
  const stanje = (...values) => ["in", ["get", "stanje"], ["literal", values]];
  layers.push(
    { id: "odabrano-podrucje", type: "line", source: "odabrano",
      layout: { "line-cap": "round" },
      paint: { ...colors["odabrano-podrucje"], "line-width": zoomScaled(22), "line-opacity": 0.35 } },
    { id: "kriticno-halo", type: "line", source: "segmenti",
      filter: ["all", critical, stanje("procijenjen")],
      layout: { "line-cap": "butt" },
      paint: { ...colors["kriticno-halo"], "line-width": zoomScaled(14), "line-opacity": 0.9 } },
    { id: "segmenti-casing", type: "line", source: "segmenti",
      filter: stanje("procijenjen", "nedovoljno_podataka"),
      layout: { "line-cap": "butt" },
      paint: { ...colors["segmenti-casing"], "line-width": zoomScaled(10) } },
    { id: "segmenti-rizik", type: "line", source: "segmenti", filter: stanje("procijenjen"),
      layout: { "line-cap": "butt" },
      paint: { ...colors["segmenti-rizik"], "line-width": zoomScaled(7) } },
    { id: "segmenti-nedovoljno", type: "line", source: "segmenti", filter: stanje("nedovoljno_podataka"),
      layout: { "line-cap": "butt" },
      paint: { "line-pattern": "hatch", "line-width": zoomScaled(7) } },
    { id: "segmenti-sporna", type: "line", source: "segmenti", filter: stanje("sporna_granica"),
      paint: { ...colors["segmenti-sporna"], "line-width": zoomScaled(3), "line-dasharray": [2, 2] } },
    { id: "segmenti-prijelaz", type: "line", source: "segmenti", filter: stanje("sluzbeni_prijelaz"),
      paint: { ...colors["segmenti-prijelaz"], "line-width": zoomScaled(4) } },
    { id: "segmenti-odabir", type: "line", source: "segmenti", filter: ["==", ["get", "id"], ""],
      paint: { ...colors["segmenti-odabir"], "line-width": zoomScaled(16), "line-opacity": 0.45 } },
    { id: "granica", type: "line", source: "granica",
      paint: { ...colors.granica, "line-width": 1, "line-opacity": 0.8 } },
    { id: "prijelazi-sluzbeni", type: "symbol", source: "prijelazi",
      filter: ["==", ["get", "tip"], "sluzbeni_prijelaz"],
      layout: { "icon-image": "ikona-prijelaz", "icon-allow-overlap": true,
        "icon-size": ICON_SIZE } },
    { id: "prijelazi-izravni", type: "symbol", source: "prijelazi",
      filter: ["==", ["get", "tip"], "izravni_prelazak"],
      layout: { "icon-image": "ikona-izravni", "icon-allow-overlap": true,
        "icon-size": ICON_SIZE } },
  );
  return layers;
}

const LAYER_GROUPS = [
  {
    id: "staze-hr", label: "Staze – HR Strana", swatch: "HR",
    layers: Object.keys(CATEGORY_STYLE).map((k) => stazeLayerId("HR", k)),
  },
  {
    id: "staze-bih", label: "Staze – BiH Strana", swatch: "BiH",
    layers: Object.keys(CATEGORY_STYLE).map((k) => stazeLayerId("BiH", k)),
  },
  { id: "granica", label: "Granična linija", layers: ["granica"] },
  {
    id: "rizik", label: "Rizik prelaska po segmentima",
    layers: [
      "kriticno-halo", "segmenti-casing", "segmenti-rizik", "segmenti-nedovoljno",
      "segmenti-sporna", "segmenti-prijelaz", "segmenti-odabir", "odabrano-podrucje",
      "prijelazi-izravni",
    ],
  },
  { id: "prijelazi", label: "Službeni prijelazi", layers: ["prijelazi-sluzbeni"] },
];

function applyTheme() {
  const theme = currentTheme();
  const { map } = state;
  for (const [layerId, paint] of Object.entries(themedPaint(theme))) {
    if (!map.getLayer(layerId)) continue;
    for (const [property, value] of Object.entries(paint)) map.setPaintProperty(layerId, property, value);
  }
  if (state.hasBasemap) addBasemapLayers(theme);
  renderLegend();
  renderAreaTable();
}

// ---------------------------------------------------------------------------------------------
// Basemap (optional Protomaps PMTiles extract, served from the same machine)

function addBasemapLayers(theme) {
  const { map } = state;
  for (const id of state.basemapIds) if (map.getLayer(id)) map.removeLayer(id);
  const flavor = globalThis.basemaps.namedFlavor(theme);
  let layers = globalThis.basemaps.layers("protomaps", flavor, { lang: "hr" });
  if (!state.hasGlyphs) layers = layers.filter((layer) => layer.type !== "symbol");
  state.basemapIds = layers.map((layer) => layer.id);
  const before = map.getLayer("staze-HR-cesta") ? "staze-HR-cesta" : undefined;
  for (const layer of layers) map.addLayer(layer, before);
}

function setBasemapVisibility(kind) {
  const { map } = state;
  for (const id of state.basemapIds) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", kind === "map" ? "visible" : "none");
  }
  if (map.getLayer("satellite")) {
    map.setLayoutProperty("satellite", "visibility", kind === "satellite" ? "visible" : "none");
  }
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
    });
    label.append(box);
    if (group.swatch) {
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.borderTopColor = STAZA_COLORS[currentTheme()][group.swatch];
      swatch.dataset.strana = group.swatch;
      label.append(swatch);
    }
    label.append(group.label);
    item.append(label);
    list.append(item);
  }
}

function refreshToggleSwatches() {
  for (const swatch of document.querySelectorAll(".swatch[data-strana]")) {
    swatch.style.borderTopColor = STAZA_COLORS[currentTheme()][swatch.dataset.strana];
  }
}

function legendRow(visual, text) {
  const row = document.createElement("div");
  row.className = "legend-row";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = text;
  row.append(visual, label);
  return row;
}

function imageElement(canvas, alt) {
  const image = new Image();
  image.src = canvas.toDataURL();
  image.alt = alt;
  image.className = "legend-icon";
  return image;
}

function lineSwatch(color, width, dashed) {
  const swatch = document.createElement("span");
  swatch.className = "swatch" + (dashed ? " dashed" : "");
  swatch.style.borderTopColor = color;
  swatch.style.borderTopWidth = width + "px";
  return swatch;
}

function renderLegend() {
  const { near_distance_m: near, far_distance_m: far } = state.meta.parametri;
  const theme = currentTheme();
  const legend = $("legend");
  legend.replaceChildren();

  const title = document.createElement("div");
  title.textContent = "Rizik prelaska: zračna udaljenost najbližeg para Staza HR–BiH u segmentu";
  title.className = "muted";
  legend.append(title);

  const ramp = document.createElement("div");
  ramp.className = "ramp";
  ramp.setAttribute("role", "img");
  ramp.setAttribute("aria-label", `Skala rizika od ${near} m (najviši) do ${far} m (najniži)`);
  const stops = riskStops(theme).map(([index, color]) => `${color} ${((1 - index) * 100).toFixed(1)}%`);
  ramp.style.background = `linear-gradient(to right, ${stops.reverse().join(", ")})`;
  for (const d of [250, 500, 1000]) {
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.style.left = (Math.log(d / near) / Math.log(far / near)) * 100 + "%";
    tick.textContent = `${d} m`;
    ramp.append(tick);
  }
  legend.append(ramp);
  const caption = document.createElement("div");
  caption.className = "ramp-caption";
  caption.append(
    ...[`viši rizik (≤ ${near} m)`, `niži rizik (≥ ${far} m)`].map((text) =>
      Object.assign(document.createElement("span"), { textContent: text }),
    ),
  );
  legend.append(caption);

  const hatch = document.createElement("span");
  hatch.className = "hatch-swatch";
  legend.append(
    legendRow(hatch, "Nedovoljno podataka: s barem jedne Strane nema mapiranih Staza (nije nizak rizik)"),
    legendRow(imageElement(izravniPrelazakCanvas(), ""), "Izravni prelazak: Staza presijeca granicu izvan Službenog prijelaza (najviši rizik)"),
    legendRow(imageElement(sluzbeniPrijelazCanvas(), ""), "Službeni prijelaz (susjedni segmenti izuzeti iz procjene)"),
    legendRow(lineSwatch(ink(theme), 2, true), "Sporna granica (rizik se ne računa)"),
    legendRow(lineSwatch(ink(theme), 6, false), "Obrub: Kritično područje"),
  );
  const note = document.createElement("div");
  note.className = "muted";
  note.textContent = "Oznaka „rijeka”: vodotok između najbližeg para Staza spušta rizik za jedan stupanj.";
  legend.append(note);

  const colors = STAZA_COLORS[theme];
  legend.append(
    legendRow(lineSwatch(colors.HR, 3, false), "Staze HR Strane"),
    legendRow(lineSwatch(colors.BiH, 3, false), "Staze BiH Strane"),
  );
  const kategorije = document.createElement("div");
  kategorije.className = "muted";
  kategorije.textContent = "Kategorije: cesta (debela crta), makadam / šumski put (srednja), staza / puteljak (isprekidana).";
  legend.append(kategorije);
  refreshToggleSwatches();
}

const kilometres = (metres) =>
  metres >= 1000 ? `${number(1).format(metres / 1000)} km` : `${number(0).format(metres)} m`;

function recomputeAreas() {
  const threshold = Number($("threshold").value);
  $("threshold-value").textContent = `${threshold} m`;
  state.areas = kriticnaPodrucja(state.segments, threshold, state.meta.parametri);
  state.selectedArea = null;

  const criticalIds = new Set(state.areas.flatMap((a) => a.segments.map((s) => s.properties.id)));
  const source = state.map.getSource("segmenti");
  source.setData({
    type: "FeatureCollection",
    features: state.segments.map((s) => ({
      ...s,
      properties: { ...s.properties, kriticno: criticalIds.has(s.properties.id) },
    })),
  });
  state.map.getSource("odabrano").setData({ type: "FeatureCollection", features: [] });
  renderAreaTable();
}

function renderAreaTable() {
  const body = document.querySelector("#areas tbody");
  body.replaceChildren();
  const topN = Math.max(1, Number($("top-n").value) || CONFIG.topN);
  const shown = state.areas.slice(0, topN);
  const total = state.areas.reduce((sum, a) => sum + a.lengthM, 0);
  $("areas-summary").textContent = state.areas.length
    ? `${state.areas.length} Kritičnih područja, ukupno ${kilometres(total)}. Prikazano prvih ${shown.length}.`
    : "Nema Kritičnih područja uz ovaj prag.";

  for (const area of shown) {
    const row = document.createElement("tr");
    row.tabIndex = 0;
    row.dataset.rang = String(area.rang);
    row.setAttribute("aria-label", `Kritično područje ${area.rang}, zumiraj na kartu`);
    if (state.selectedArea === area.rang) row.classList.add("selected");
    const chip = document.createElement("span");
    chip.className = "risk-chip";
    chip.style.background = riskColor(area.peakRisk, currentTheme());
    const first = document.createElement("td");
    first.append(chip, String(area.rang));
    row.append(first);
    for (const text of [
      kilometres(area.lengthM),
      `${number(0).format(area.minDistanceM)} m`,
      number(2).format(area.peakRisk),
    ]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    const select = () => selectArea(area);
    row.addEventListener("click", select);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
    body.append(row);
  }
}

function selectArea(area) {
  state.selectedArea = area.rang;
  state.map.getSource("odabrano").setData(areasToGeoJson([area]));
  state.map.fitBounds(areaBounds(area), { padding: 90, maxZoom: 14, duration: 600 });
  renderAreaTable();
}

function download(filename, type, text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function setupExport() {
  const threshold = () => Number($("threshold").value);
  $("export-csv").addEventListener("click", () =>
    download(`kriticna-podrucja-${threshold()}m.csv`, "text/csv", areasToCsv(state.areas)));
  $("export-geojson").addEventListener("click", () =>
    download(`kriticna-podrucja-${threshold()}m.geojson`, "application/geo+json",
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
    ["Najbliži par Staza", `${number(0).format(p.udaljenost_m)} m`],
    ["HR Staza", stazaDescription(p, "hr")],
    ["BiH Staza", stazaDescription(p, "bih")],
    ["Duljina segmenta", `${number(0).format(p.duljina_m)} m`],
  ];
  for (const [term, value] of rows) list.append(element("dt", term), element("dd", value));
  root.append(list);
  if (p.izravni_prelazak) root.append(element("span", "Izravni prelazak", "flag"));
  if (p.rijeka) root.append(element("span", "rijeka (rizik spušten za jedan stupanj)", "flag"));
  return root;
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
  const coords = features.flatMap((f) => f.geometry.coordinates);
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
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

  const params = data.meta.parametri;
  $("threshold").value = String(params.critical_distance_m);
  $("top-n").value = String(CONFIG.topN);
  $("osm-date").textContent = `OSM podaci od: ${new Date(data.meta.osm_podaci_od).toLocaleString("hr-HR", { dateStyle: "long", timeStyle: "short" })}`;

  state.hasBasemap = await exists(absolute(CONFIG.basemap));
  state.hasGlyphs = state.hasBasemap && await exists(absolute(CONFIG.glyphs).replace("{fontstack}", "Noto Sans Regular").replace("{range}", "0-255"));
  if (state.hasBasemap) {
    globalThis.maplibregl.addProtocol("pmtiles", new globalThis.pmtiles.Protocol().tile);
  }

  const theme = currentTheme();
  const map = new globalThis.maplibregl.Map({
    container: "map",
    attributionControl: false,
    bounds: boundsOf(data.granica.features),
    fitBoundsOptions: { padding: 40 },
    style: {
      version: 8,
      ...(state.hasGlyphs ? { glyphs: absolute(CONFIG.glyphs) } : {}),
      sources: {},
      layers: [{ id: "background", type: "background", paint: themedPaint(theme).background }],
    },
  });
  state.map = map;
  if (new URLSearchParams(location.search).has("debug")) globalThis.__map = map; // for manual checks
  map.addControl(new globalThis.maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new globalThis.maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
  map.addControl(new globalThis.maplibregl.AttributionControl({ customAttribution: "© OpenStreetMap contributors" }), "bottom-left");

  map.on("load", () => {
    map.addImage("hatch", imageData(hatchCanvas()), { pixelRatio: 2 });
    map.addImage("ikona-prijelaz", imageData(sluzbeniPrijelazCanvas()), { pixelRatio: 2 });
    map.addImage("ikona-izravni", imageData(izravniPrelazakCanvas()), { pixelRatio: 2 });
    const empty = { type: "FeatureCollection", features: [] };
    map.addSource("staze", { type: "geojson", data: data.staze });
    map.addSource("granica", { type: "geojson", data: data.granica });
    map.addSource("segmenti", { type: "geojson", data: data.segmenti });
    map.addSource("prijelazi", { type: "geojson", data: data.prijelazi });
    map.addSource("odabrano", { type: "geojson", data: empty });
    if (state.hasBasemap) {
      map.addSource("protomaps", { type: "vector", url: "pmtiles://" + absolute(CONFIG.basemap), attribution: "Protomaps © OpenStreetMap" });
    }
    if (CONFIG.satellite) {
      map.addSource("satellite", { type: "raster", tiles: [CONFIG.satellite], tileSize: 256, attribution: CONFIG.satelliteAttribution });
      map.addLayer({ id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } });
    }
    for (const layer of dataLayers(theme)) map.addLayer(layer);
    if (state.hasBasemap) addBasemapLayers(theme);

    renderToggles();
    setupBasemapChoice();
    setupClicks();
    setupExport();
    recomputeAreas();
    renderLegend();
  });

  $("threshold").addEventListener("input", () => {
    if (map.loaded()) recomputeAreas();
  });
  $("top-n").addEventListener("input", renderAreaTable);
  darkQuery.addEventListener("change", () => {
    map.setPaintProperty("background", "background-color", themedPaint(currentTheme()).background);
    applyTheme();
  });
}

function setupBasemapChoice() {
  if (!CONFIG.satellite) return;
  const fieldset = $("basemap-choice");
  fieldset.hidden = false;
  for (const [value, text] of [["map", "Karta"], ["satellite", "Satelit / topografska"]]) {
    const label = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "podloga";
    radio.value = value;
    radio.checked = value === "map";
    radio.addEventListener("change", () => setBasemapVisibility(value));
    label.append(radio, text);
    fieldset.append(label);
  }
}

start();
