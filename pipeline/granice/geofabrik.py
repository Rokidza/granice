"""OSM data from Geofabrik country extracts, read with pyosmium: the offline alternative to Overpass.

Same result as `OverpassSource` (the rest of the pipeline cannot tell them apart), but the whole
border takes a couple of minutes instead of an hour and does not depend on a busy public server.

Differences from Overpass that matter:
- The border is the set of ways that are members of both admin_level=2 relations, as there; each
  relation is read from its own country's extract.
- Overpass labels a Staza's vertices with the state "area" they lie in. Here the state polygons are
  built from the members of the two relations and the vertices are tested against them.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import osmium
import requests
import shapely
from osmium.osm import NODE, RELATION, WAY
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, box
from shapely.geometry.base import BaseGeometry
from shapely.ops import polygonize, transform, unary_union

from granice.config import BIH_RELATION, CORRIDOR_M, HR_RELATION, PROJECTED_CRS, BBox
from granice.osm import (
    BORDER_CONTROL_M,
    EXCLUDED_HIGHWAYS,
    WATER_CORRIDOR_M,
    Coords,
    OsmData,
    OsmWay,
)
from granice.risk import Strana

log = logging.getLogger(__name__)

BASE_URL = "https://download.geofabrik.de/europe/"
HR_EXTRACT = "croatia-latest.osm.pbf"
BIH_EXTRACT = "bosnia-herzegovina-latest.osm.pbf"

# Keys that mark everything we read in the main pass; the filter skips all other ways in C++.
_KEYS = ("highway", "waterway", "natural", "barrier")


@dataclass(frozen=True)
class _Way:
    id: int
    tags: dict[str, str]
    refs: list[int]
    coords: Coords


class GeofabrikSource:
    """Reads the two Geofabrik extracts (downloaded to `cache_dir/geofabrik/`) inside `area`."""

    def __init__(self, area: BBox, cache_dir: Path, refresh: bool = False) -> None:
        self._area = area
        self._dir = cache_dir / "geofabrik"
        self._refresh = refresh

    def load(self) -> OsmData:
        hr_file = self._download(HR_EXTRACT)
        bih_file = self._download(BIH_EXTRACT)

        hr_members, hr_water = _relation_ways(hr_file, HR_RELATION)
        bih_members, bih_water = _relation_ways(bih_file, BIH_RELATION)
        hr_ways = _ways_by_id(hr_file, hr_members)
        bih_ways = _ways_by_id(bih_file, bih_members)
        shared = sorted(hr_members & bih_members)
        missing = [i for i in shared if i not in hr_ways]
        if missing:
            log.warning("%d shared border ways are missing from the Croatian extract", len(missing))
        border = [hr_ways[i] for i in shared if i in hr_ways]
        log.info("%d border ways shared by the two relations", len(border))

        hr_state = _state_polygon(hr_ways.values())
        bih_state = _state_polygon(bih_ways.values())
        border_nodes = {ref for way in border for ref in way.refs}

        near_border = _corridor(border, self._area, CORRIDOR_M)
        near_crossing = _corridor(border, self._area, BORDER_CONTROL_M)
        near_water = _corridor(border, self._area, WATER_CORRIDOR_M)

        paths: dict[int, OsmWay] = {}
        water: dict[int, Coords] = {}
        controls: list[tuple[float, float]] = []
        timestamps = []
        for path, water_members in ((hr_file, hr_water), (bih_file, bih_water)):
            timestamps.append(_timestamp(path))
            for way in _ways_by_id(path, water_members).values():
                if _touches(near_water, way.coords):
                    water[way.id] = way.coords
            for item in _main_pass(path):
                if isinstance(item, tuple):
                    if shapely.contains_xy(near_crossing, *item):
                        controls.append(item)
                    continue
                tags = item.tags
                highway = tags.get("highway")
                is_path = highway is not None and highway not in EXCLUDED_HIGHWAYS
                if is_path and item.id not in paths and _touches(near_border, item.coords):
                    paths[item.id] = _osm_way(item, hr_state, bih_state, border_nodes)
                is_water = tags.get("waterway") == "river" or tags.get("natural") == "water"
                if is_water and _touches(near_water, item.coords):
                    water[item.id] = item.coords
                is_control = tags.get("barrier") == "border_control"
                if is_control and _touches(near_crossing, item.coords):
                    controls.append(item.coords[len(item.coords) // 2])
            log.info("%s: %d Staze so far, %d water lines", path.name, len(paths), len(water))

        return OsmData(
            timestamp=min(timestamps),
            border=[way.coords for way in border],
            paths=list(paths.values()),
            water_lines=list(water.values()),
            border_controls=controls,
        )

    def _download(self, name: str) -> Path:
        target = self._dir / name
        if target.exists() and not self._refresh:
            log.info("using %s", target.name)
            return target
        self._dir.mkdir(parents=True, exist_ok=True)
        log.info("downloading %s", name)
        partial = target.with_suffix(".part")
        with requests.get(BASE_URL + name, stream=True, timeout=120) as response:
            response.raise_for_status()
            with partial.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=1 << 20):
                    handle.write(chunk)
        os.replace(partial, target)
        return target


# --- reading the extracts ----------------------------------------------------------------------


def _relation_ways(path: Path, relation_id: int) -> tuple[set[int], set[int]]:
    """Ids of the outer member ways of a state's boundary relation, and of the member ways of all
    natural=water multipolygons (their outlines are what the water layer needs)."""
    boundary: set[int] = set()
    water: set[int] = set()
    for relation in osmium.FileProcessor(str(path), RELATION):
        if not isinstance(relation, osmium.osm.Relation):
            continue
        if relation.id == relation_id:
            boundary = {m.ref for m in relation.members if m.type == "w" and m.role == "outer"}
        elif (
            relation.tags.get("natural") == "water" and relation.tags.get("type") == "multipolygon"
        ):
            water |= {m.ref for m in relation.members if m.type == "w"}
    if not boundary:
        raise SystemExit(f"relation {relation_id} not found in {path.name}")
    return boundary, water


def _ways_by_id(path: Path, ids: set[int]) -> dict[int, _Way]:
    processor = (
        osmium.FileProcessor(str(path), NODE | WAY)
        .with_locations()
        .with_filter(osmium.filter.IdFilter(sorted(ids)))
    )
    ways = (_read_way(obj) for obj in processor if isinstance(obj, osmium.osm.Way))
    return {way.id: way for way in ways}


def _main_pass(path: Path) -> Iterator[_Way | tuple[float, float]]:
    """Every way with one of `_KEYS` (as `_Way`) and every barrier=border_control node (as a
    (lon, lat) tuple)."""
    processor = (
        osmium.FileProcessor(str(path), NODE | WAY)
        .with_locations()
        .with_filter(osmium.filter.KeyFilter(*_KEYS))
    )
    for obj in processor:
        if isinstance(obj, osmium.osm.Way):
            yield _read_way(obj)
        elif isinstance(obj, osmium.osm.Node) and obj.tags.get("barrier") == "border_control":
            yield (obj.location.lon, obj.location.lat)


def _read_way(obj: osmium.osm.Way) -> _Way:
    nodes = list(obj.nodes)
    return _Way(
        obj.id,
        {tag.k: tag.v for tag in obj.tags},
        [n.ref for n in nodes],
        [(n.lon, n.lat) for n in nodes],
    )


def _timestamp(path: Path) -> str:
    stamp = osmium.io.Reader(str(path)).header().get("osmosis_replication_timestamp")
    return stamp or datetime.fromtimestamp(path.stat().st_mtime, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# --- geometry ----------------------------------------------------------------------------------


def _state_polygon(ways: Iterable[_Way]) -> BaseGeometry:
    """The territory enclosed by a state's boundary ways, prepared for point-in-polygon tests."""
    lines = [LineString(way.coords) for way in ways if len(way.coords) >= 2]
    faces = list(polygonize(unary_union(lines)))
    if not faces:
        raise SystemExit("could not build a state polygon from the boundary relation")
    polygon = unary_union(faces)
    shapely.prepare(polygon)
    return polygon


def _corridor(border: list[_Way], area: BBox, distance_m: float) -> BaseGeometry:
    """Everything within `distance_m` of the part of the border inside `area`, in lon/lat."""
    to_m = Transformer.from_crs("EPSG:4326", PROJECTED_CRS, always_xy=True)
    to_deg = Transformer.from_crs(PROJECTED_CRS, "EPSG:4326", always_xy=True)
    inside = box(area.west, area.south, area.east, area.north)
    lines = MultiLineString([LineString(w.coords) for w in border if len(w.coords) >= 2])
    clipped = lines.intersection(inside)
    corridor = transform(to_m.transform, clipped).simplify(25).buffer(distance_m)
    result = transform(to_deg.transform, corridor)
    shapely.prepare(result)
    return result


def _touches(corridor: BaseGeometry, coords: Coords) -> bool:
    return len(coords) >= 2 and bool(corridor.intersects(LineString(coords)))


def _osm_way(
    way: _Way, hr_state: BaseGeometry, bih_state: BaseGeometry, border_nodes: set[int]
) -> OsmWay:
    xs = np.array([c[0] for c in way.coords])
    ys = np.array([c[1] for c in way.coords])
    in_hr = shapely.contains_xy(hr_state, xs, ys)
    in_bih = shapely.contains_xy(bih_state, xs, ys)
    sides: list[Strana | None] = []
    for ref, hr, bih in zip(way.refs, in_hr, in_bih, strict=True):
        if ref in border_nodes or hr == bih:  # on the border itself, or in neither/both states
            sides.append(None)
        else:
            sides.append(Strana.HR if hr else Strana.BIH)
    return OsmWay(way.id, way.tags, way.coords, sides)
