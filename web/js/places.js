// Names a point on the map: the nearest settlement and the county (županija) or canton it lies in.
// Asked of OpenStreetMap's Nominatim one place at a time (its policy: at most one request a second)
// and remembered in this browser, so each place is asked for once.

const ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const STORAGE_KEY = "granice.mjesta";
const SPACING_MS = 1100;
const memory = new Map();
let last = Promise.resolve();

try {
  for (const [key, value] of Object.entries(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"))) memory.set(key, value);
} catch { /* storage unavailable: places are asked for again next time */ }

function remember() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(memory)));
  } catch { /* storage full or unavailable */ }
}

const key = ([lon, lat]) => `${lat.toFixed(3)},${lon.toFixed(3)}`; // about 100 m

/** What Nominatim's address says, in the words of a planner: settlement, municipality, county, country. */
function describe(address = {}) {
  const place = address.hamlet ?? address.village ?? address.suburb ?? address.town ?? address.city ?? address.locality ?? null;
  const municipality = address.municipality ?? address.city ?? address.town ?? address.county ?? null;
  const region = address.state ?? address.province ?? address.region ?? address.county ?? null;
  return {
    place,
    municipality: municipality && municipality !== place ? municipality : null,
    region: region && region !== municipality && region !== place ? region : null,
    country: address.country_code === "hr" ? "Hrvatska" : address.country_code === "ba" ? "BiH" : address.country ?? null,
  };
}

/** Where a point is, or null when it cannot be told (offline, service busy). */
export function placeAt(coordinates) {
  const id = key(coordinates);
  if (memory.has(id)) return Promise.resolve(memory.get(id));
  const result = last.then(async () => {
    if (memory.has(id)) return memory.get(id);
    const [lon, lat] = coordinates;
    const url = `${ENDPOINT}?format=jsonv2&zoom=14&addressdetails=1&accept-language=hr&lat=${lat}&lon=${lon}`;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const place = describe((await response.json()).address);
      memory.set(id, place);
      remember();
      return place;
    } catch {
      return null;
    }
  });
  last = result.then(() => new Promise((resolve) => setTimeout(resolve, SPACING_MS)));
  return result;
}

/** "Šamac, Općina Šamac · Posavski kanton · BiH", whatever of it is known. */
export function placeText(place) {
  if (!place) return "";
  return [place.place, place.municipality, place.region, place.country].filter(Boolean).join(" · ");
}

/** The short form for lists: "Šamac · Posavski kanton". */
export function placeShort(place) {
  if (!place) return "";
  return [place.place ?? place.municipality, place.region].filter(Boolean).join(" · ");
}
