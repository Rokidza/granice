"""Which grid tiles are fetched along the border."""

from granice.config import BBox
from granice.osm import tiles_along

AREA = BBox(south=42.0, west=15.0, north=46.0, east=20.0)


def test_a_border_inside_one_cell_gives_that_cell() -> None:
    tiles = tiles_along([[(15.1, 44.1), (15.2, 44.2)]], AREA)

    assert tiles == [BBox(south=44.0, west=15.0, north=44.5, east=15.5)]


def test_a_long_straight_edge_gives_every_cell_it_passes_through() -> None:
    # Two vertices 1.4 degrees apart: the cells between them have no vertex of their own.
    tiles = tiles_along([[(15.1, 44.1), (16.5, 44.1)]], AREA)

    assert [t.west for t in tiles] == [15.0, 15.5, 16.0, 16.5]


def test_cells_outside_the_area_are_left_out_and_order_is_north_to_south() -> None:
    area = BBox(south=44.0, west=15.0, north=45.0, east=16.0)
    border = [[(15.2, 44.2), (15.2, 44.8), (15.2, 46.0), (14.0, 44.2)]]

    tiles = tiles_along(border, area)

    assert [(t.south, t.west) for t in tiles] == [(44.5, 15.0), (44.0, 15.0)]
