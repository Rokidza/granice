"""Turns raw OSM data into the geometries the risk calculation needs.

Staza preparation: assigns every Staza a category and splits it into pieces per Strana.
Border: merges the border ways into chains and clips them to the Pilot odsječak.
"""

from __future__ import annotations

from dataclasses import dataclass

import shapely
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box
from shapely.geometry.base import BaseGeometry
from shapely.ops import linemerge

from granice.config import CORRIDOR_M, PROJECTED_CRS, BBox, DisputedSection
from granice.osm import Coords, OsmData, OsmWay
from granice.risk import RiskInput, Staza, Strana

# Categories shown on the map (docs/DESIGN.md): cesta, makadam/šumski put, staza/puteljak.
CESTA, MAKADAM, STAZA = "cesta", "makadam", "staza"

_MAKADAM = {"track"}
_STAZA = {"path", "footway", "bridleway", "steps", "cycleway", "pedestrian", "corridor"}


def categorize(highway: str) -> str:
    if highway in _MAKADAM:
        return MAKADAM
    if highway in _STAZA:
        return STAZA
    return CESTA  # trunk .. residential, service, unclassified, *_link, road, living_street


@dataclass(frozen=True)
class Prepared:
    risk_input: RiskInput
    way_tags: dict[int, dict[str, str]]  # tags of the source ways, for the click-through details
    to_wgs84: Transformer
    sluzbeni_prijelazi_wgs84: list[tuple[float, float]]  # (lon, lat)


def prepare(
    data: OsmData,
    pilot: BBox,
    disputed: list[DisputedSection],
    manual_crossings: list[tuple[float, float]] | None = None,
) -> Prepared:
    """`manual_crossings` are extra Službeni prijelazi (lon, lat) from a hand-kept list."""
    to_m = Transformer.from_crs("EPSG:4326", PROJECTED_CRS, always_xy=True)
    to_wgs84 = Transformer.from_crs(PROJECTED_CRS, "EPSG:4326", always_xy=True)

    border_all = _merge([_line(c, to_m) for c in data.border])
    chains = _clip_chains(border_all, _bbox_polygon(pilot, to_m))

    staze: list[Staza] = []
    near_pilot = shapely.union_all(chains).buffer(CORRIDOR_M) if chains else Polygon()
    for way in data.paths:
        staze += [
            piece
            for piece in _split_by_strana(way, to_m, border_all)
            if piece.geometry.intersects(
                near_pilot
            )  # the fetch also covers border outside the pilot
        ]

    water: list[BaseGeometry] = [_line(c, to_m) for c in data.water_lines]

    crossings_wgs84 = _one_per_place([*data.border_controls, *(manual_crossings or [])], to_m)
    controls = [Point(*to_m.transform(lon, lat)) for lon, lat in crossings_wgs84]
    return Prepared(
        risk_input=RiskInput(
            border=chains,
            staze=staze,
            sluzbeni_prijelazi=controls,
            water=water,
            sporna_granica=[_bbox_polygon(d.bbox, to_m) for d in disputed],
        ),
        way_tags={w.id: w.tags for w in data.paths},
        to_wgs84=to_wgs84,
        sluzbeni_prijelazi_wgs84=crossings_wgs84,
    )


def _one_per_place(
    points: list[tuple[float, float]], to_m: Transformer, within_m: float = 100.0
) -> list[tuple[float, float]]:
    """Drops duplicates: OSM often maps one crossing as several nearby border_control nodes."""
    kept: list[tuple[float, float]] = []
    kept_m: list[Point] = []
    for lon, lat in points:
        point = Point(*to_m.transform(lon, lat))
        if all(point.distance(other) > within_m for other in kept_m):
            kept.append((lon, lat))
            kept_m.append(point)
    return kept


def _line(coords: Coords, to_m: Transformer) -> LineString:
    xs, ys = to_m.transform([c[0] for c in coords], [c[1] for c in coords])
    return LineString(zip(xs, ys, strict=True))


def _bbox_polygon(bbox: BBox, to_m: Transformer) -> Polygon:
    """A lon/lat box as a polygon in metres; edges are densified so they follow the projection."""
    ring = shapely.segmentize(box(bbox.west, bbox.south, bbox.east, bbox.north), 0.01)
    lons = [c[0] for c in ring.exterior.coords]
    lats = [c[1] for c in ring.exterior.coords]
    xs, ys = to_m.transform(lons, lats)
    return Polygon(zip(xs, ys, strict=True))


def _merge(lines: list[LineString]) -> BaseGeometry:
    return linemerge(MultiLineString(lines)) if lines else MultiLineString()


def _lines_of(geometry: BaseGeometry) -> list[LineString]:
    if isinstance(geometry, LineString):
        return [geometry] if geometry.length > 0 else []
    return [g for part in getattr(geometry, "geoms", []) for g in _lines_of(part)]


def _clip_chains(border: BaseGeometry, pilot: Polygon) -> list[LineString]:
    """Border chains inside the Pilot odsječak, in a stable order (north to south, west to east)."""
    clipped = _merge(_lines_of(border.intersection(pilot)))
    chains = _lines_of(clipped)
    return sorted(chains, key=lambda c: (-c.coords[0][1], c.coords[0][0]))


def _split_by_strana(way: OsmWay, to_m: Transformer, border: BaseGeometry) -> list[Staza]:
    """Pieces of a Staza, one per Strana. Where the way passes from one Strana to the other the
    edge is cut at the border (or at its middle if the border is not there)."""
    highway = way.tags["highway"]
    line = _line(way.coords, to_m)
    points: list[tuple[float, float]] = list(line.coords)
    sides: list[Strana | None] = list(way.sides)

    # Insert a vertex on the border into every edge whose ends lie on different Strane.
    expanded: list[tuple[float, float]] = [points[0]]
    expanded_sides: list[Strana | None] = [sides[0]]
    for i in range(len(points) - 1):
        a, b = sides[i], sides[i + 1]
        if a is not None and b is not None and a != b:
            expanded.append(_cut_point(LineString([points[i], points[i + 1]]), border))
            expanded_sides.append(None)
        expanded.append(points[i + 1])
        expanded_sides.append(b)

    pieces: list[Staza] = []
    current: list[tuple[float, float]] = []
    current_side: Strana | None = None
    for i in range(len(expanded) - 1):
        a, b = expanded_sides[i], expanded_sides[i + 1]
        edge_side = a or b  # None only when both ends lie on the border itself
        if edge_side is None or edge_side != current_side:
            if len(current) >= 2 and current_side is not None:
                pieces.append(_piece(way, highway, current_side, current))
            current = [expanded[i]] if edge_side is not None else []
            current_side = edge_side
        if edge_side is not None:
            current.append(expanded[i + 1])
    if len(current) >= 2 and current_side is not None:
        pieces.append(_piece(way, highway, current_side, current))
    return pieces


def _piece(way: OsmWay, highway: str, strana: Strana, coords: list[tuple[float, float]]) -> Staza:
    return Staza(way.id, categorize(highway), strana, LineString(coords))


def _cut_point(edge: LineString, border: BaseGeometry) -> tuple[float, float]:
    crossing = edge.intersection(border)
    if crossing.is_empty:
        point = edge.interpolate(0.5, normalized=True)
    else:
        first = crossing if isinstance(crossing, Point) else shapely.get_geometry(crossing, 0)
        point = first.representative_point()
    return (point.x, point.y)
