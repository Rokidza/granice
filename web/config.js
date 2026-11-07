// Where the page finds its data and optional extras. All paths are relative to index.html.
export default {
  // Output of `python -m granice refresh`.
  dataDir: "../data/out/",
  // Vector tiles of the Staze (the layer is 18 MB as GeoJSON). Made by `npm run build` into web/dist/;
  // null here, where the page then reads data/out/staze.geojson whole.
  stazeTiles: null,
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
      id: "satelit", label: "Karta (satelitska snimka)", short: "Karta", kind: "raster", palette: "dark",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256, maxzoom: 18,
      attribution: "Esri, Maxar, Earthstar Geographics i GIS User Community",
      // Shown where imagery has not loaded yet (while the map glides to a place): a coarse copy of the
      // imagery up to this zoom, kept loaded, and over it a background of the imagery's average colour.
      lowZoom: 7, background: "#27301f",
      // Place names and the boundaries of other countries and entities over the imagery, drawn from
      // the vector tiles of this style. Unlike the Esri overlay (which has its own HR-BiH line next to
      // ours, baked into its image) it can leave that one border out.
      labels: { style: "https://tiles.openfreemap.org/styles/dark", omitBorderBetween: ["HR", "BA"] },
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
  ],
  defaultBasemap: "satelit",
  // Default range of the nearest-pair distance in metres: segments within it are grouped into
  // Kritična područja. The planner changes it in the sidebar.
  band: { minM: 500, maxM: 600 },
};
