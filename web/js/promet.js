// Border traffic per road crossing (DZS, made by `python -m granice promet`): a tooltip on hover and the year's figures on click.

export const PROMET_SOURCE = "promet";
export const PROMET_LAYERS = ["promet-krugovi"];
const PROMET_COLOR = "#8b5cf6";
const MONTHS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const number = new Intl.NumberFormat("hr-HR");

/** An invisible circle on each crossing: only the target of the hover and the click. */
export function prometLayers() {
  return [
    {
      id: "promet-krugovi", type: "circle", source: PROMET_SOURCE,
      paint: { "circle-radius": 11, "circle-opacity": 0, "circle-stroke-width": 0 },
    },
  ];
}

const svg = (tag, attributes) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
};

/** Twelve bars, one per month of the year; the busiest is drawn in full colour. */
function monthlyBars(values) {
  const width = 12 * 17;
  const chart = svg("svg", { viewBox: `0 0 ${width} 56`, width, height: 56, role: "img", "aria-label": "Putnici po mjesecima" });
  const peak = Math.max(...values, 1);
  values.forEach((value, month) => {
    const height = Math.max(1, (value / peak) * 40);
    chart.append(svg("rect", {
      x: month * 17 + 2, y: 42 - height, width: 13, height, rx: 2,
      fill: PROMET_COLOR, "fill-opacity": value === peak ? 1 : 0.5,
    }));
    const label = svg("text", { x: month * 17 + 8.5, y: 53, "text-anchor": "middle", "font-size": 8, fill: "currentColor" });
    label.textContent = MONTHS[month];
    chart.append(label);
  });
  return chart;
}

/** What a circle says: the year's traffic of the crossing. `element(tag, text, className)` is the page's helper. */
export function prometPopup(feature, element, { compact = false } = {}) {
  const p = feature.properties;
  const root = element("div", undefined, "popup why");
  root.append(
    element("strong", `Prijelaz ${p.naziv}`),
    element("p", `${number.format(p.putnici_ukupno)} putnika u ${p.godina}.`, "muted"),
  );
  if (compact) return root;
  const rows = [
    ["Putnici", p.putnici_ulaz, p.putnici_izlaz],
    ["Osobna vozila", p.osobna_ulaz, p.osobna_izlaz],
    ["Autobusi", p.autobusi_ulaz, p.autobusi_izlaz],
    ["Teretna vozila", p.teretna_ulaz, p.teretna_izlaz],
  ];
  const table = element("table", undefined, "traffic-table");
  table.append(element("caption", "ulaz u Hrvatsku i izlaz iz nje"));
  for (const [label, entry, exit] of rows) {
    const row = element("tr");
    row.append(element("th", label), element("td", number.format(entry)), element("td", number.format(exit)));
    table.append(row);
  }
  // Features read back from the map carry array properties as JSON text.
  const monthly = typeof p.putnici_mjesecno === "string" ? JSON.parse(p.putnici_mjesecno) : p.putnici_mjesecno;
  root.append(table, element("p", "Putnici po mjesecima", "muted"), monthlyBars(monthly));
  root.append(element("p", "Izvor: DZS, Granični promet (Tab. 1–8). Položaj prijelaza: OpenStreetMap.", "muted"));
  return root;
}
