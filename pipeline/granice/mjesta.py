"""Named settlements along the border, for the web page to name a point without asking a server.

Read from the Geofabrik extracts (see geofabrik.py): every OSM place node of a settlement within
PLACE_CORRIDOR_M of the border line, with the municipality, county or canton and state it lies in
(OSM admin boundaries). The page takes the nearest of them, at once; before this it asked
Nominatim, one point a second.

admin_level in the two extracts: 2 state; HR 4 županija, BiH 4 entitet, 5 kanton; 7 grad/općina,
in BiH also 6 for a grad.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import osmium
import shapely
from osmium.osm import AREA, NODE
from pyproj import Transformer
from shapely.geometry import Point, shape
from shapely.ops import transform

from granice.config import PROJECTED_CRS, BBox
from granice.geofabrik import BIH_EXTRACT, HR_EXTRACT

log = logging.getLogger("granice.mjesta")

PLACE_CORRIDOR_M = 15_000
# Settlements, in the order Nominatim names an address by (smallest first); not locality, which in
# OSM is as often a hill or a field as a place people live.
PLACE_KINDS = ("hamlet", "village", "suburb", "town", "city")
ADMIN_LEVELS = {"2", "4", "5", "6", "7"}
COUNTRIES = {"HR": "Hrvatska", "BA": "BiH"}
_CYRILLIC = re.compile("[\u0400-\u04ff]")


def _latin(tags: osmium.osm.TagList) -> str | None:
    """The name in Latin script: "Општина Нови Град / Opština Novi Grad" -> "Opština Novi Grad"."""
    name = tags.get("name")
    if not name or not _CYRILLIC.search(name):
        return name
    latin = [part.strip() for part in name.split("/") if not _CYRILLIC.search(part)]
    return (
        latin[0]
        if latin
        else tags.get("name:sr-Latn") or tags.get("name:hr") or tags.get("name:bs") or name
    )


def _admin_areas(extract: Path, bbox: BBox) -> dict[int, tuple[str, str, shapely.Geometry]]:
    """Admin areas (by relation id) that reach into bbox: (admin_level, name or country, polygon)."""
    window = shapely.box(bbox.west, bbox.south, bbox.east, bbox.north)
    wkb = osmium.geom.WKBFactory()
    areas: dict[int, tuple[str, str, shapely.Geometry]] = {}
    processor = (
        osmium.FileProcessor(str(extract))
        .with_areas(osmium.filter.TagFilter(("boundary", "administrative")))
        .with_filter(osmium.filter.EntityFilter(AREA))
    )
    for area in processor:
        if not isinstance(area, osmium.osm.Area) or area.from_way():
            continue
        level = area.tags.get("admin_level")
        if level not in ADMIN_LEVELS:
            continue
        name = area.tags.get("ISO3166-1") if level == "2" else _latin(area.tags)
        if not name:
            continue
        try:
            polygon = shapely.from_wkb(wkb.create_multipolygon(area))
        except RuntimeError:
            continue  # a broken ring somewhere in the relation
        if polygon.intersects(window):
            areas[area.orig_id()] = (level, name, polygon)
    return areas


def _places(extract: Path) -> dict[int, tuple[float, float, str]]:
    places = {}
    for node in osmium.FileProcessor(str(extract), NODE).with_filter(
        osmium.filter.KeyFilter("place")
    ):
        if not isinstance(node, osmium.osm.Node):
            continue
        name = _latin(node.tags)
        if name and node.tags.get("place") in PLACE_KINDS:
            places[node.id] = (round(node.location.lon, 5), round(node.location.lat, 5), name)
    return places


def write_mjesta(out_dir: Path, raw_dir: Path, bbox: BBox) -> None:
    extracts = [raw_dir / "geofabrik" / name for name in (HR_EXTRACT, BIH_EXTRACT)]
    for path in extracts:
        if not path.exists():
            raise SystemExit(f"{path} is missing: run `python -m granice refresh` first")

    granica = json.loads((out_dir / "granica.geojson").read_text(encoding="utf-8"))
    border = shapely.union_all([shape(feature["geometry"]) for feature in granica["features"]])
    project = Transformer.from_crs("EPSG:4326", PROJECTED_CRS, always_xy=True).transform
    corridor = shapely.prepared.prep(transform(project, border).buffer(PLACE_CORRIDOR_M))

    places: dict[int, tuple[float, float, str]] = {}
    areas: dict[int, tuple[str, str, shapely.Geometry]] = {}
    for path in extracts:
        log.info("Reading places and admin areas from %s", path.name)
        places.update(_places(path))
        areas.update(_admin_areas(path, bbox))
    near = [p for p in places.values() if corridor.contains(Point(project(p[0], p[1])))]
    log.info(
        "%d settlements within %d km of the border, %d admin areas",
        len(near),
        PLACE_CORRIDOR_M // 1000,
        len(areas),
    )

    by_level: dict[str, list[tuple[str, shapely.Geometry]]] = {}
    for level, name, polygon in areas.values():
        shapely.prepare(polygon)
        by_level.setdefault(level, []).append((name, polygon))

    def within(level: str, point: Point) -> str | None:
        return next(
            (name for name, polygon in by_level.get(level, []) if polygon.contains(point)), None
        )

    rows = []
    for lon, lat, name in sorted(near):
        point = Point(lon, lat)
        country = COUNTRIES.get(within("2", point) or "")
        if not country:
            continue  # Serbia or Montenegro, at the ends of the extracts
        municipality = within("7", point) or (within("6", point) if country == "BiH" else None)
        region = within("5", point) or within("4", point)
        rows.append([lon, lat, name, municipality, region, country])

    content = {
        "atribucija": "© OpenStreetMap contributors",
        "polja": ["lon", "lat", "naselje", "opcina", "regija", "drzava"],
        "mjesta": rows,
    }
    target = out_dir / "mjesta.json"
    target.write_text(
        json.dumps(content, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    log.info("Wrote %s (%d settlements)", target, len(rows))
