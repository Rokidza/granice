"""OSM data acquisition behind one interface.

`OsmSource.load()` is all the rest of the pipeline knows about where data comes from, so the
Overpass implementation can be replaced by Geofabrik extracts (pyosmium) for the whole border
without touching the calculation.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import requests

from granice.config import BIH_RELATION, CORRIDOR_M, HR_RELATION, BBox
from granice.risk import Strana

log = logging.getLogger(__name__)

Coords = list[tuple[float, float]]  # (lon, lat)

# Water only matters between a pair of Staze, which are at most `far_distance_m` apart.
WATER_CORRIDOR_M = 1600

# highway values that are not walkable infrastructure (or do not exist yet); see docs/DESIGN.md
EXCLUDED_HIGHWAYS = ("motorway", "motorway_link", "construction", "proposed", "raceway")


@dataclass(frozen=True)
class OsmWay:
    id: int
    tags: dict[str, str]
    coords: Coords
    # Strana of each vertex as labelled by the source; None for a vertex on the border itself.
    sides: list[Strana | None]


@dataclass(frozen=True)
class OsmData:
    timestamp: str  # when the OSM data was current ("OSM podaci od: ...")
    border: list[Coords]  # border ways shared by the two admin_level=2 relations
    paths: list[OsmWay]  # candidate Staze, vertices labelled by Strana
    # Rivers (waterway=river centre lines) and the outlines of water areas (natural=water, also the
    # member ways of multipolygons). "A river lies between two Staze" only needs the line crossing.
    water_lines: list[Coords] = field(default_factory=list)
    border_controls: list[tuple[float, float]] = field(default_factory=list)  # (lon, lat)


class OsmSource(Protocol):
    def load(self) -> OsmData: ...


class OverpassSource:
    """Fetches the Pilot odsječak from the public Overpass API, caching each raw response."""

    URL = "https://overpass-api.de/api/interpreter"
    USER_AGENT = "granice-pilot/0.1 (analysis tool)"

    def __init__(self, bbox: BBox, cache_dir: Path, refresh: bool = False) -> None:
        self._bbox = bbox
        self._cache_dir = cache_dir
        self._refresh = refresh

    def load(self) -> OsmData:
        border = self._query("border", self._border_query())
        paths = self._query("paths", self._paths_query())
        hr_nodes = self._node_ids("nodes-hr", HR_RELATION)
        bih_nodes = self._node_ids("nodes-bih", BIH_RELATION)
        water = self._query("water", self._water_query())
        controls = self._query("border-controls", self._border_controls_query())
        return OsmData(
            timestamp=paths["osm3s"]["timestamp_osm_base"],
            border=[_coords(e["geometry"]) for e in border["elements"] if e["type"] == "way"],
            paths=[_path(e, hr_nodes, bih_nodes) for e in paths["elements"] if e["type"] == "way"],
            water_lines=[_coords(e["geometry"]) for e in water["elements"] if e["type"] == "way"],
            border_controls=[_center(e) for e in controls["elements"]],
        )

    # --- queries -------------------------------------------------------------------------

    def _prelude(self) -> str:
        b = self._bbox.overpass()
        return (
            "[out:json][timeout:300];\n"
            f"rel({HR_RELATION})->.hr; rel({BIH_RELATION})->.ba;\n"
            f"way(r.hr)({b})->.a; way(r.ba)({b})->.b; way.a.b->.border;\n"
        )

    def _border_query(self) -> str:
        return self._prelude() + ".border out geom;"

    def _paths_set(self) -> str:
        excluded = "|".join(EXCLUDED_HIGHWAYS)
        return f'way[highway]["highway"!~"^({excluded})$"](around.border:{CORRIDOR_M})->.paths;\n'

    def _paths_query(self) -> str:
        return self._prelude() + self._paths_set() + ".paths out body geom;"

    def _node_ids(self, name: str, relation: int) -> set[int]:
        query = (
            self._prelude()
            + self._paths_set()
            + f"node(w.paths)(area:{3600000000 + relation}); out ids;"
        )
        return {e["id"] for e in self._query(name, query)["elements"]}

    def _water_query(self) -> str:
        around = f"(around.border:{WATER_CORRIDOR_M})"
        return (
            self._prelude()
            + f"(way[waterway=river]{around}; way[natural=water]{around};);\n"
            + "out geom;\n"
            + f"relation[natural=water][type=multipolygon]{around};\n"
            + f"way(r)(around.border:{WATER_CORRIDOR_M});\n"
            + "out geom;"
        )

    def _border_controls_query(self) -> str:
        around = "(around.border:1000)"
        return (
            self._prelude()
            + f"(node[barrier=border_control]{around}; way[barrier=border_control]{around};);\n"
            + "out center;"
        )

    # --- transport -----------------------------------------------------------------------

    def _query(self, name: str, query: str) -> dict[str, Any]:
        digest = hashlib.sha256(query.encode()).hexdigest()[:8]
        cache = self._cache_dir / f"overpass-{name}-{digest}.json"
        if cache.exists() and not self._refresh:
            log.info("using cached %s", cache.name)
            cached: dict[str, Any] = json.loads(cache.read_text(encoding="utf-8"))
            return cached
        log.info("querying Overpass: %s", name)
        result = _post_with_backoff(self.URL, query, self.USER_AGENT)
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(result), encoding="utf-8")
        return result


def _post_with_backoff(url: str, query: str, user_agent: str, attempts: int = 6) -> dict[str, Any]:
    wait = 10.0
    for attempt in range(attempts):
        try:
            response = requests.post(
                url, data={"data": query}, headers={"User-Agent": user_agent}, timeout=400
            )
        except requests.Timeout:
            if attempt == attempts - 1:
                raise
            log.warning("Overpass timed out, retrying in %.0f s", wait)
            time.sleep(wait)
            wait *= 2
            continue
        if response.status_code == 200:
            parsed: dict[str, Any] = response.json()
            return parsed
        if response.status_code not in (429, 502, 503, 504) or attempt == attempts - 1:
            response.raise_for_status()
        log.warning("Overpass busy (%s), retrying in %.0f s", response.status_code, wait)
        time.sleep(wait)
        wait *= 2
    raise RuntimeError("unreachable")


# --- parsing of Overpass JSON ---------------------------------------------------------------


def _coords(geometry: list[dict[str, float]]) -> Coords:
    return [(p["lon"], p["lat"]) for p in geometry]


def _center(element: dict[str, Any]) -> tuple[float, float]:
    point = element["center"] if element["type"] == "way" else element
    return (point["lon"], point["lat"])


def _path(element: dict[str, Any], hr_nodes: set[int], bih_nodes: set[int]) -> OsmWay:
    sides: list[Strana | None] = []
    for node_id in element["nodes"]:
        in_hr, in_bih = node_id in hr_nodes, node_id in bih_nodes
        if in_hr and not in_bih:
            sides.append(Strana.HR)
        elif in_bih and not in_hr:
            sides.append(Strana.BIH)
        else:
            sides.append(None)  # on the border itself (or in neither state)
    return OsmWay(element["id"], element.get("tags", {}), _coords(element["geometry"]), sides)
