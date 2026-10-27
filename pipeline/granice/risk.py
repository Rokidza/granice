"""Crossing-risk (Rizik prelaska) calculation: a pure function over input geometries.

All geometries are in a metric projected CRS. Domain terms follow GLOSSARY.md.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from enum import Enum

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import nearest_points, substring

CROSSING_TOLERANCE_M = (
    1.0  # pieces of one Staza this close to each other and the border form a crossing
)


class Strana(str, Enum):
    HR = "HR"
    BIH = "BiH"


@dataclass(frozen=True)
class Params:
    segment_length_m: float = 500.0
    near_distance_m: float = 100.0  # index is 1 at or below this distance
    far_distance_m: float = 1500.0  # index is 0 at or above this distance
    river_penalty: float = 0.25  # "one level" of risk, subtracted when a river separates the pair
    critical_distance_m: float = (
        500.0  # a segment is critical when its index reaches that of this distance
    )
    # Segments this close to a Službeni prijelaz are exempt. OSM often maps the border_control node
    # on the road a few hundred metres back from the border line.
    sluzbeni_prijelaz_radius_m: float = 500.0
    search_radius_m: float = 3000.0  # how far from a segment a Staza still counts as mapped
    # Only the part of a Staza at most this far from the border line takes part; the rest is cut
    # off, so neither end of a nearest pair can lie farther from the border than this.
    max_border_distance_m: float = 500.0


@dataclass(frozen=True)
class Staza:
    """A Staza (any walkable way) restricted to one Strana. A Staza that crosses the border is
    supplied as one piece per Strana, sharing `way_id`."""

    way_id: int
    category: str
    strana: Strana
    geometry: LineString


@dataclass(frozen=True)
class RiskInput:
    border: list[LineString]
    staze: list[Staza]
    sluzbeni_prijelazi: list[Point] = field(default_factory=list)
    water: list[BaseGeometry] = field(default_factory=list)  # river centre lines and water areas
    sporna_granica: list[BaseGeometry] = field(default_factory=list)  # disputed border sections


@dataclass(frozen=True)
class SegmentGranice:
    chain: int
    order: int
    geometry: LineString
    state: str
    risk_index: float | None = None
    nearest_distance_m: float | None = None
    flags: tuple[str, ...] = ()
    hr_way_id: int | None = None  # the nearest pair of Staze, one per Strana
    bih_way_id: int | None = None
    hr_category: str | None = None
    bih_category: str | None = None
    # How far from the border line the two ends of the nearest pair lie.
    hr_border_distance_m: float | None = None
    bih_border_distance_m: float | None = None


@dataclass(frozen=True)
class KriticnoPodrucje:
    """Adjacent segments of one border chain whose risk index is at or above the threshold."""

    chain: int
    first_order: int
    last_order: int
    length_m: float
    min_distance_m: float
    peak_risk_index: float


@dataclass(frozen=True)
class _SpatialIndexes:
    hr: _SideIndex
    bih: _SideIndex
    water: STRtree
    border: STRtree  # over the facets of the border line


@dataclass(frozen=True)
class Assessment:
    segments: list[SegmentGranice] = field(default_factory=list)
    kriticna_podrucja: list[KriticnoPodrucje] = field(default_factory=list)


def risk_index(distance_m: float, params: Params) -> float:
    """1 at `near_distance_m` or closer, 0 at `far_distance_m` or farther, linear in log-distance."""
    if distance_m <= params.near_distance_m:
        return 1.0
    if distance_m >= params.far_distance_m:
        return 0.0
    span = math.log(params.far_distance_m / params.near_distance_m)
    return 1.0 - math.log(distance_m / params.near_distance_m) / span


def _split_chain(chain: LineString, length_m: float) -> list[LineString]:
    parts = []
    start = 0.0
    while start < chain.length - 1e-9:
        end = min(start + length_m, chain.length)
        parts.append(substring(chain, start, end))
        start = end
    return parts


def border_corridor(border: list[LineString], distance_m: float) -> BaseGeometry:
    """The area at most `distance_m` from the border line."""
    return shapely.union_all(border).buffer(distance_m)


def clip_to_border(staze: list[Staza], border: list[LineString], distance_m: float) -> list[Staza]:
    """The parts of the Staze at most `distance_m` from the border line. A Staza that leaves the
    corridor and comes back becomes several pieces with the same `way_id`."""
    corridor = border_corridor(border, distance_m)
    shapely.prepare(corridor)
    geometries = np.array([s.geometry for s in staze], dtype=object)
    inside = shapely.covers(corridor, geometries)
    touching = shapely.intersects(corridor, geometries)
    clipped = []
    for staza, whole, near in zip(staze, inside, touching, strict=True):
        if whole:
            clipped.append(staza)
        elif near:
            clipped += [
                replace(staza, geometry=part)
                for part in shapely.get_parts(staza.geometry.intersection(corridor))
                if isinstance(part, LineString) and part.length > 0
            ]
    return clipped


def assess_crossing_risk(data: RiskInput, params: Params) -> Assessment:
    staze = clip_to_border(data.staze, data.border, params.max_border_distance_m)
    crossings = _crossing_points(staze)
    indexes = _SpatialIndexes(
        _SideIndex([s for s in staze if s.strana == Strana.HR]),
        _SideIndex([s for s in staze if s.strana == Strana.BIH]),
        STRtree(data.water),
        STRtree(_facets(data.border)[0]),
    )
    segments: list[SegmentGranice] = []
    for chain_no, chain in enumerate(data.border):
        parts = _split_chain(chain, params.segment_length_m)
        crossed = {
            min(int(chain.project(p) // params.segment_length_m), len(parts) - 1)
            for p in crossings
            if chain.distance(p) <= CROSSING_TOLERANCE_M
        }
        for order, line in enumerate(parts):
            if any(line.intersects(d) for d in data.sporna_granica):
                segments.append(SegmentGranice(chain_no, order, line, "sporna_granica"))
                continue
            if any(
                line.distance(p) <= params.sluzbeni_prijelaz_radius_m
                for p in data.sluzbeni_prijelazi
            ):
                segments.append(SegmentGranice(chain_no, order, line, "sluzbeni_prijelaz"))
                continue
            segment = _assess_segment(chain_no, order, line, indexes, params)
            if order in crossed:
                segment = replace(
                    segment,
                    state="procijenjen",
                    risk_index=1.0,
                    nearest_distance_m=0.0,
                    flags=segment.flags + ("izravni_prelazak",),
                )
            segments.append(segment)
    return Assessment(segments, _kriticna_podrucja(segments, params))


def _kriticna_podrucja(segments: list[SegmentGranice], params: Params) -> list[KriticnoPodrucje]:
    threshold = risk_index(params.critical_distance_m, params) - 1e-9
    runs: list[list[SegmentGranice]] = []
    previous: SegmentGranice | None = None
    for segment in segments:
        critical = segment.risk_index is not None and segment.risk_index >= threshold
        if not critical:
            previous = None
            continue
        if (
            previous is not None
            and previous.chain == segment.chain
            and previous.order + 1 == segment.order
        ):
            runs[-1].append(segment)
        else:
            runs.append([segment])
        previous = segment
    areas = [
        KriticnoPodrucje(
            chain=run[0].chain,
            first_order=run[0].order,
            last_order=run[-1].order,
            length_m=sum(s.geometry.length for s in run),
            min_distance_m=min(
                s.nearest_distance_m for s in run if s.nearest_distance_m is not None
            ),
            peak_risk_index=max(s.risk_index for s in run if s.risk_index is not None),
        )
        for run in runs
    ]
    return sorted(areas, key=lambda a: (-a.peak_risk_index, -a.length_m))


def _crossing_points(staze: list[Staza]) -> list[Point]:
    """Points where a Staza passes from one Strana to the other (pieces sharing a way_id)."""
    pieces: dict[int, tuple[list[Staza], list[Staza]]] = {}
    for staza in staze:
        hr, bih = pieces.setdefault(staza.way_id, ([], []))
        (hr if staza.strana == Strana.HR else bih).append(staza)
    points = []
    for hr, bih in pieces.values():
        for a in hr:
            for b in bih:
                if a.geometry.distance(b.geometry) <= CROSSING_TOLERANCE_M:
                    points.append(nearest_points(a.geometry, b.geometry)[0])
    return points


class _SideIndex:
    """Spatial index over the Staze of one Strana."""

    def __init__(self, staze: list[Staza]) -> None:
        self._staze = staze
        self._tree = STRtree([s.geometry for s in staze])

    def clip_to_zone(self, zone: Polygon) -> list[tuple[Staza, BaseGeometry]]:
        """The part of each Staza inside `zone`. Staze that merely touch the zone boundary
        (clipped to a point) do not count as mapped there."""
        hits = (self._staze[i] for i in self._tree.query(zone, predicate="intersects"))
        clips = [(s, s.geometry.intersection(zone)) for s in hits]
        return [(s, g) for s, g in clips if g.length > 0]


def _assess_segment(
    chain: int, order: int, line: LineString, indexes: _SpatialIndexes, params: Params
) -> SegmentGranice:
    zone = line.buffer(params.search_radius_m, cap_style="flat")
    hr_clips = indexes.hr.clip_to_zone(zone)
    bih_clips = indexes.bih.clip_to_zone(zone)
    if not hr_clips or not bih_clips:
        return SegmentGranice(chain, order, line, "nedovoljno_podataka")
    link, near_hr, near_bih = _nearest_pair(hr_clips, bih_clips)
    risk = risk_index(link.length, params)
    flags: tuple[str, ...] = ()
    if len(indexes.water.query(link, predicate="intersects")) > 0:
        risk = max(0.0, risk - params.river_penalty)
        flags = ("rijeka",)
    return SegmentGranice(
        chain,
        order,
        line,
        "procijenjen",
        risk,
        link.length,
        flags,
        near_hr.way_id,
        near_bih.way_id,
        near_hr.category,
        near_bih.category,
        _distance_to(Point(link.coords[0]), indexes.border),
        _distance_to(Point(link.coords[-1]), indexes.border),
    )


def _facets(geometries: list[BaseGeometry]) -> tuple[np.ndarray, np.ndarray]:
    """The straight two-point pieces of line geometries, and for each the index of the geometry it
    comes from. Points (a Staza clipped to where it touches the zone) have none."""
    parts, owner = shapely.get_parts(geometries, return_index=True)
    coords, part = shapely.get_coordinates(parts, return_index=True)
    same_part = part[1:] == part[:-1]
    facets = shapely.linestrings(np.stack([coords[:-1][same_part], coords[1:][same_part]], axis=1))
    return facets, owner[part[:-1][same_part]]


def _nearest_pair(
    hr_clips: list[tuple[Staza, BaseGeometry]], bih_clips: list[tuple[Staza, BaseGeometry]]
) -> tuple[LineString, Staza, Staza]:
    """The shortest link between the HR and the BiH Staze, and the Staza at each end.

    The BiH facets go into an STR-tree. If any HR facet intersects one, the distance is 0.
    Otherwise every HR facet looks up its nearest BiH facet by branch and bound (GEOS skips tree
    nodes whose bounding box is farther than the best so far), and the closest of those wins.
    About O((n + m) log m) for n HR and m BiH facets, and exact: the result equals the plain
    distance between the two geometries, only faster than comparing every pair of facets.
    """
    hr_facets, hr_owner = _facets([g for _, g in hr_clips])
    bih_facets, bih_owner = _facets([g for _, g in bih_clips])
    tree = STRtree(bih_facets)
    pairs = tree.query(hr_facets, predicate="intersects")
    if pairs.shape[1] == 0:
        pairs, distances = tree.query_nearest(hr_facets, return_distance=True, all_matches=False)
        pairs = pairs[:, [int(np.argmin(distances))]]
    i, j = pairs[:, 0]
    link = shapely.shortest_line(hr_facets[i], bih_facets[j])
    return link, hr_clips[hr_owner[i]][0], bih_clips[bih_owner[j]][0]


def _distance_to(point: Point, facets: STRtree) -> float:
    """Distance from `point` to the nearest of the facets in the tree (branch and bound)."""
    _, distance = facets.query_nearest(point, return_distance=True, all_matches=False)
    return float(distance[0])
