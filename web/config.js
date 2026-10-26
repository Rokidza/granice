// Where the page finds its data and optional extras. All paths are relative to index.html.
export default {
  // Output of `python -m granice refresh`.
  dataDir: "../data/out/",
  // Optional offline basemap: a Protomaps PMTiles extract of the HR-BiH corridor. If the file is
  // missing the page still works, on a plain background. See README.md for how to create it.
  basemap: "../data/basemap.pmtiles",
  // Optional glyphs (fonts) for basemap labels, a folder laid out as {fontstack}/{range}.pbf.
  // Without it the basemap is drawn without place names.
  glyphs: "../data/fonts/{fontstack}/{range}.pbf",
  // Optional satellite/topographic raster tiles, e.g. a DGU orthophoto WMTS template. Leave null
  // until its licence is confirmed (docs/podaci-i-licence.md).
  satellite: null,
  satelliteAttribution: "",
  // Number of Kritična područja listed by default.
  topN: 10,
};
