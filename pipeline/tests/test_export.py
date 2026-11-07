"""Cutting the Staze at the corridor edges, so the page can mark those within the chosen one."""

from shapely.geometry import LineString

from granice.export import split_by_corridor

BORDER = [LineString([(0, 0), (1000, 0)])]


def test_a_line_leaving_the_border_is_cut_at_each_corridor() -> None:
    road = LineString([(500, 10), (500, 300)])

    pieces = split_by_corridor([road], BORDER, [50.0, 100.0, 200.0])

    assert [(round(g.length), d) for g, d in pieces[0]] == [(40, 50.0), (50, 100.0), (100, 200.0), (100, None)]


def test_a_line_within_one_band_stays_whole() -> None:
    road = LineString([(100, 60), (900, 60)])

    pieces = split_by_corridor([road], BORDER, [50.0, 100.0])

    assert pieces == [[(road, 100.0)]]
