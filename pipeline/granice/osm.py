"""OSM data acquisition behind one interface.

`OsmSource.load()` is all the rest of the pipeline knows about where data comes from, so the
Overpass implementation can be replaced by Geofabrik extracts (pyosmium) without touching the
calculation. The Overpass implementation fetches the border in one query and everything around it
in grid tiles, so that no single query is too big for the public server.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import logging
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import requests
import shapely
from shapely.geometry import LineString

from granice.config import BIH_RELATION, CORRIDOR_M, HR_RELATION, BBox
from granice.risk import Strana

log = logging.getLogger(__name__)

Coords = list[tuple[float, float]]  # (lon, lat)

# Water only matters between a pair of Staze, which are at most `far_distance_m` apart.
WATER_CORRIDOR_M = 1600

# Border controls farther from the border than this are not Službeni prijelazi of this border.
BORDER_CONTROL_M = 1000

# Side of the grid tiles (degrees) in which the surroundings of the border are fetched. Half a
# degree is about the size of the Pilot odsječak query that Overpass served without trouble.
TILE_DEG = 0.5

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


@dataclass(frozen=True)
class _TileData:
    timestamp: str
    paths: dict[int, dict[str, Any]]
    water: dict[int, Coords]
    controls: list[tuple[float, float]]
    hr_nodes: set[int]
    bih_nodes: set[int]


class _RoundRobin:
    """Hands out the servers in turn; safe to share between threads."""

    def __init__(self, urls: tuple[str, ...]) -> None:
        self.urls = urls
        self._counter = itertools.count()
        self._lock = threading.Lock()

    def next(self) -> str:
        with self._lock:
            return self.urls[next(self._counter) % len(self.urls)]


class OsmSource(Protocol):
    def load(self) -> OsmData: ...


class OverpassSource:
    """Fetches the border and its surroundings inside `area` from the public Overpass API,
    caching each raw response."""

    SERVERS = (
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
    )
    USER_AGENT = "granice-pilot/0.1 (analysis tool)"

    def __init__(self, area: BBox, cache_dir: Path, refresh: bool = False) -> None:
        self._area = area
        self._cache_dir = cache_dir
        self._refresh = refresh
        self._servers = _RoundRobin(self.SERVERS)

    def load(self) -> OsmData:
        border = self._query("border", self._border_query())
        border_lines = [_coords(e["geometry"]) for e in border["elements"] if e["type"] == "way"]
        tiles = tiles_along(border_lines, self._area)
        log.info("%d tiles of %.1f degrees along the border", len(tiles), TILE_DEG)

        # One tile per worker, each request going to the next server: three public servers share
        # the load and a busy one costs a retry elsewhere instead of minutes of waiting.
        with ThreadPoolExecutor(max_workers=len(self.SERVERS)) as pool:
            results = list(pool.map(self._load_tile, tiles))

        timestamps = [border["osm3s"]["timestamp_osm_base"]]
        raw_paths: dict[int, dict[str, Any]] = {}
        water: dict[int, Coords] = {}
        controls: list[tuple[float, float]] = []
        hr_nodes: set[int] = set()
        bih_nodes: set[int] = set()
        for tile_data in results:
            timestamps.append(tile_data.timestamp)
            raw_paths.update(tile_data.paths)
            water.update(tile_data.water)
            controls += tile_data.controls
            hr_nodes |= tile_data.hr_nodes
            bih_nodes |= tile_data.bih_nodes
        return OsmData(
            timestamp=min(timestamps),
            border=border_lines,
            paths=[_path(e, hr_nodes, bih_nodes) for e in raw_paths.values()],
            water_lines=list(water.values()),
            border_controls=controls,
        )

    def _load_tile(self, tile: BBox) -> _TileData:
        log.info("tile %s", tile.overpass())
        paths = self._query("paths", self._paths_query(tile))
        water = self._query("water", self._water_query(tile))
        controls = self._query("border-controls", self._border_controls_query(tile))
        return _TileData(
            timestamp=paths["osm3s"]["timestamp_osm_base"],
            paths={e["id"]: e for e in paths["elements"] if e["type"] == "way"},
            water={
                e["id"]: _coords(e["geometry"]) for e in water["elements"] if e["type"] == "way"
            },
            controls=[_center(e) for e in controls["elements"]],
            hr_nodes=self._node_ids("nodes-hr", tile, HR_RELATION),
            bih_nodes=self._node_ids("nodes-bih", tile, BIH_RELATION),
        )

    # --- queries -------------------------------------------------------------------------

    def _border_query(self) -> str:
        """Every way shared by the two admin_level=2 relations (not limited to the area: the
        chains are clipped to it later)."""
        return (
            "[out:json][timeout:300];\n"
            f"rel({HR_RELATION})->.hr; rel({BIH_RELATION})->.ba;\n"
            "way(r.hr)->.a; way(r.ba)->.b; way.a.b->.border;\n"
            ".border out geom;"
        )

    def _prelude(self, tile: BBox) -> str:
        b = tile.overpass()
        return (
            "[out:json][timeout:300];\n"
            f"rel({HR_RELATION})->.hr; rel({BIH_RELATION})->.ba;\n"
            f"way(r.hr)({b})->.a; way(r.ba)({b})->.b; way.a.b->.border;\n"
        )

    def _paths_set(self, tile: BBox) -> str:
        excluded = "|".join(EXCLUDED_HIGHWAYS)
        return (
            self._prelude(tile)
            + f'way[highway]["highway"!~"^({excluded})$"](around.border:{CORRIDOR_M})->.paths;\n'
        )

    def _paths_query(self, tile: BBox) -> str:
        return self._paths_set(tile) + ".paths out body geom;"

    def _node_ids(self, name: str, tile: BBox, relation: int) -> set[int]:
        query = self._paths_set(tile) + f"node(w.paths)(area:{3600000000 + relation}); out ids;"
        return {e["id"] for e in self._query(name, query)["elements"]}

    def _water_query(self, tile: BBox) -> str:
        around = f"(around.border:{WATER_CORRIDOR_M})"
        return (
            self._prelude(tile)
            + f"(way[waterway=river]{around}; way[natural=water]{around};);\n"
            + "out geom;\n"
            + f"relation[natural=water][type=multipolygon]{around};\n"
            + f"way(r)(around.border:{WATER_CORRIDOR_M});\n"
            + "out geom;"
        )

    def _border_controls_query(self, tile: BBox) -> str:
        around = f"(around.border:{BORDER_CONTROL_M})"
        return (
            self._prelude(tile)
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
        result = _post_with_backoff(self._servers, query, self.USER_AGENT)
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(result), encoding="utf-8")
        return result


def _post_with_backoff(
    servers: _RoundRobin, query: str, user_agent: str, rounds: int = 4
) -> dict[str, Any]:
    """Tries the servers in turn; waits (10 s, 20 s, ...) only after every server has failed."""
    wait = 10.0
    for round_no in range(rounds):
        for _ in servers.urls:
            url = servers.next()
            try:
                response = requests.post(
                    url, data={"data": query}, headers={"User-Agent": user_agent}, timeout=400
                )
            except requests.RequestException as error:
                log.warning("%s failed (%s), trying the next server", url, type(error).__name__)
                continue
            if response.status_code == 200:
                try:
                    parsed: dict[str, Any] = response.json()
                except ValueError:  # a mirror answered with an error page
                    log.warning("%s sent invalid JSON, trying the next server", url)
                    continue
                return parsed
            if response.status_code not in (429, 500, 502, 503, 504):
                response.raise_for_status()
            log.warning("%s busy (%s), trying the next server", url, response.status_code)
        if round_no < rounds - 1:
            log.warning("all servers busy, retrying in %.0f s", wait)
            time.sleep(wait)
            wait *= 2
    raise RuntimeError("no Overpass server answered; try again later")


def tiles_along(border: list[Coords], area: BBox, step: float = TILE_DEG) -> list[BBox]:
    """Grid cells (aligned to multiples of `step` degrees) that the border passes through inside
    `area`, in a stable order from north to south and west to east."""
    cells: set[tuple[int, int]] = set()
    for line in border:
        if len(line) < 2:
            continue
        for lon, lat in shapely.segmentize(LineString(line), step / 10).coords:
            if area.west <= lon <= area.east and area.south <= lat <= area.north:
                cells.add((math.floor(lat / step), math.floor(lon / step)))
    return [
        BBox(south=row * step, west=column * step, north=(row + 1) * step, east=(column + 1) * step)
        for row, column in sorted(cells, key=lambda c: (-c[0], c[1]))
    ]


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
