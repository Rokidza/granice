// Where the page finds its data and optional extras. All paths are relative to index.html.
export default {
  // Output of `python -m granice refresh`.
  dataDir: "../data/out/",
  // Optional offline basemap: a Protomaps PMTiles extract of the HR-BiH corridor. If the file exists
  // it is offered as "Karta (lokalno)" and chosen by default; nothing then leaves this machine.
  // See README.md for how to create it.
  basemap: "../data/basemap.pmtiles",
  // Optional glyphs (fonts) for the local basemap's labels, a folder laid out as
  // {fontstack}/{range}.pbf. Without it the local basemap is drawn without place names.
  glyphs: "../data/fonts/{fontstack}/{range}.pbf",
  // Basemaps offered in the sidebar. These are third-party servers: their operators see which
  // tiles (so which part of the border) are viewed. See docs/adr/0002-online-podloge.md.
  //   kind "style":  a MapLibre style JSON, one per colour theme (vector tiles).
  //   kind "raster": XYZ tile URLs.
  //   kind "none":   the plain background.
  // `palette` is the colour theme of the data layers drawn on top: "light" or "dark" for a basemap
  // that is always light or dark (relief, satellite), "system" to follow the OS theme.
  basemaps: [
    {
      id: "karta", label: "Karta", short: "Karta", kind: "style", palette: "system",
      style: {
        light: "https://tiles.openfreemap.org/styles/positron",
        dark: "https://tiles.openfreemap.org/styles/dark",
      },
    },
    {
      id: "reljef", label: "Reljef (topografska, izohipse)", short: "Reljef", kind: "raster", palette: "light",
      tiles: [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256, maxzoom: 17,
      attribution:
        'Kartografija © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, SRTM',
    },
    {
      id: "satelit", label: "Satelitska snimka", short: "Satelit", kind: "raster", palette: "dark",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256, maxzoom: 18,
      attribution: "Esri, Maxar, Earthstar Geographics i GIS User Community",
    },
    { id: "nema", label: "Bez podloge", short: "Prazno", kind: "none", palette: "system" },
  ],
  defaultBasemap: "karta",
  // Number of Kritična područja listed by default.
  topN: 10,
};
