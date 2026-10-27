"""Riječna granica: the stretches of the border line that run along a river or other water.

All geometries are in a metric projected CRS.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString
from shapely.geometry.base import BaseGeometry
from shapely.ops import substring


@dataclass(frozen=True)
class RiverParams:
    # The border counts as on the river where water is at most this far. Measured on the whole
    # HR-BiH border: 451 km lie within 50 m of water, 468 km within 75 m, and widening further
    # barely adds any (480 km at 150 m), so 75 m catches a border drawn on an old river course.
    tolerance_m: float = 75.0
    step_m: float = 25.0  # spacing of the points sampled along the border
    # Shorter interruptions (a bridge, a gap in the water data) are bridged.
    max_gap_m: float = 150.0
    # Shorter stretches are a river crossing the border, not following it.
    min_length_m: float = 300.0


@dataclass(frozen=True)
class RiverStretch:
    chain: int
    geometry: LineString


DEFAULT_PARAMS = RiverParams()


def river_border(
    border: list[LineString], water: list[BaseGeometry], params: RiverParams = DEFAULT_PARAMS
) -> list[RiverStretch]:
    if not water:
        return []
    tree = STRtree(water)
    stretches = []
    for chain_no, chain in enumerate(border):
        positions = np.arange(0.0, chain.length, params.step_m)
        points = [chain.interpolate(d) for d in positions]
        _, distances = tree.query_nearest(points, return_distance=True, all_matches=False)
        for start, end in _runs(positions[distances <= params.tolerance_m], params):
            stretches.append(RiverStretch(chain_no, substring(chain, start, end)))
    return stretches


def _runs(positions: np.ndarray, params: RiverParams) -> list[tuple[float, float]]:
    """Consecutive positions joined into (start, end) runs across gaps up to `max_gap_m`."""
    runs: list[list[float]] = []
    for d in positions:
        if runs and d - runs[-1][1] <= params.max_gap_m:
            runs[-1][1] = d
        else:
            runs.append([d, d])
    return [(s, e) for s, e in runs if e - s >= params.min_length_m]
