"""Riječna granica, observed through `river_border` only. The border runs along the x axis.

A stretch reaches up to the tolerance (75 m) past the end of the water, hence the loose bounds."""

import pytest
from shapely.geometry import LineString

from granice.river_border import river_border

BORDER = LineString([(0, 0), (5000, 0)])


def test_river_along_part_of_the_border_marks_that_part() -> None:
    river = LineString([(1000, 30), (3000, 30)])

    [stretch] = river_border([BORDER], [river])

    assert stretch.chain == 0
    assert stretch.geometry.length == pytest.approx(2000, abs=150)
    assert stretch.geometry.coords[0][0] == pytest.approx(1000, abs=75)


def test_river_crossing_the_border_is_not_a_river_border() -> None:
    river = LineString([(2500, -2000), (2500, 2000)])

    assert river_border([BORDER], [river]) == []


def test_short_gap_in_the_water_is_bridged() -> None:
    water = [LineString([(0, 20), (2000, 20)]), LineString([(2100, 20), (4000, 20)])]

    [stretch] = river_border([BORDER], water)

    assert stretch.geometry.length == pytest.approx(4000, abs=150)


def test_water_far_from_the_border_is_ignored() -> None:
    assert river_border([BORDER], [LineString([(0, 500), (5000, 500)])]) == []
