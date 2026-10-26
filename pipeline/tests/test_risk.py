"""Behaviour of the crossing-risk calculation, observed through its public interface only.

All geometries are in metres (a projected CRS); the border is a straight line along the x axis.
"""

import pytest
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry

from granice.risk import Params, RiskInput, Staza, Strana, assess_crossing_risk

BORDER = LineString([(0, 0), (1000, 0)])


def hr(way_id: int, y: float) -> Staza:
    return Staza(way_id, "cesta", Strana.HR, LineString([(0, y), (1000, y)]))


def bih(way_id: int, y: float) -> Staza:
    return Staza(way_id, "cesta", Strana.BIH, LineString([(0, y), (1000, y)]))


def test_parallel_staze_200_m_apart_give_high_but_not_highest_risk() -> None:
    result = assess_crossing_risk(
        RiskInput(border=[BORDER], staze=[hr(1, 100), bih(2, -100)]), Params()
    )

    assert len(result.segments) == 2
    for segment in result.segments:
        assert segment.state == "procijenjen"
        assert segment.nearest_distance_m == pytest.approx(200)
        assert segment.risk_index == pytest.approx(0.744, abs=0.001)


def test_staze_2_km_apart_give_zero_risk() -> None:
    result = assess_crossing_risk(
        RiskInput(border=[BORDER], staze=[hr(1, 1000), bih(2, -1000)]), Params()
    )

    assert [s.risk_index for s in result.segments] == [0.0, 0.0]


def test_side_without_staze_is_nedovoljno_podataka_not_low_risk() -> None:
    result = assess_crossing_risk(RiskInput(border=[BORDER], staze=[hr(1, 100)]), Params())

    for segment in result.segments:
        assert segment.state == "nedovoljno_podataka"
        assert segment.risk_index is None
        assert segment.nearest_distance_m is None


def test_staza_beyond_search_radius_does_not_count_as_mapped() -> None:
    far_away = bih(2, -5000)
    result = assess_crossing_risk(
        RiskInput(border=[BORDER], staze=[hr(1, 100), far_away]), Params()
    )

    assert {s.state for s in result.segments} == {"nedovoljno_podataka"}


def crossing_staze(way_id: int, x: float) -> list[Staza]:
    """One Staza running north-south across the border at `x`, split into one piece per Strana."""
    return [
        Staza(way_id, "makadam", Strana.HR, LineString([(x, 0), (x, 300)])),
        Staza(way_id, "makadam", Strana.BIH, LineString([(x, 0), (x, -300)])),
    ]


def test_staza_crossing_the_border_gives_izravni_prelazak_with_highest_risk() -> None:
    result = assess_crossing_risk(
        RiskInput(border=[BORDER], staze=crossing_staze(7, 250)), Params()
    )

    first, second = result.segments
    assert first.state == "procijenjen"
    assert first.risk_index == 1.0
    assert first.nearest_distance_m == 0
    assert "izravni_prelazak" in first.flags
    assert "izravni_prelazak" not in second.flags


def test_two_staze_that_merely_come_close_are_not_izravni_prelazak() -> None:
    result = assess_crossing_risk(
        RiskInput(border=[BORDER], staze=[hr(1, 100), bih(2, -100)]), Params()
    )

    assert all("izravni_prelazak" not in s.flags for s in result.segments)


def test_sluzbeni_prijelaz_exempts_its_segment_and_neighbours_but_not_izravni_prelazak() -> None:
    staze = [*pair(1, 0, 1500, 100), *crossing_staze(7, 100)]
    border = LineString([(0, 0), (1500, 0)])
    result = assess_crossing_risk(
        RiskInput(border=[border], staze=staze, sluzbeni_prijelazi=[Point(100, 0)]), Params()
    )

    first, neighbour, far = result.segments
    assert first.state == "sluzbeni_prijelaz"
    assert first.risk_index is None
    assert "izravni_prelazak" not in first.flags
    assert neighbour.state == "sluzbeni_prijelaz"  # 400 m away, within the 500 m exemption radius
    assert far.state == "procijenjen"  # 900 m away: assessed as usual
    assert far.nearest_distance_m == pytest.approx(200)


def test_sluzbeni_prijelaz_mapped_a_few_hundred_metres_from_the_border_still_exempts_its_segment() -> (
    None
):
    # OSM often places the border_control node on the road well back from the border line
    result = assess_crossing_risk(
        RiskInput(
            border=[BORDER],
            staze=[hr(1, 100), bih(2, -100), *crossing_staze(7, 100)],
            sluzbeni_prijelazi=[Point(100, 400)],
        ),
        Params(),
    )

    assert result.segments[0].state == "sluzbeni_prijelaz"


@pytest.mark.parametrize(
    "water",
    [
        LineString([(0, 0), (1000, 0)]),  # waterway=river centre line
        Polygon([(0, -50), (1000, -50), (1000, 50), (0, 50)]),  # natural=water
    ],
    ids=["river-line", "water-area"],
)
def test_river_between_nearest_pair_lowers_risk_one_level_and_is_tagged(
    water: BaseGeometry,
) -> None:
    result = assess_crossing_risk(
        RiskInput(border=[BORDER], staze=[hr(1, 100), bih(2, -100)], water=[water]), Params()
    )

    for segment in result.segments:
        assert "rijeka" in segment.flags
        assert segment.risk_index == pytest.approx(0.744 - 0.25, abs=0.001)
        assert segment.nearest_distance_m == pytest.approx(200)  # the distance itself is unchanged


def test_river_that_does_not_separate_the_nearest_pair_has_no_effect() -> None:
    elsewhere = LineString([(0, 800), (1000, 800)])
    result = assess_crossing_risk(
        RiskInput(border=[BORDER], staze=[hr(1, 100), bih(2, -100)], water=[elsewhere]), Params()
    )

    assert all("rijeka" not in s.flags for s in result.segments)
    assert result.segments[0].risk_index == pytest.approx(0.744, abs=0.001)


def test_sporna_granica_is_excluded_from_risk() -> None:
    disputed = Polygon(
        [(-10, -10), (400, -10), (400, 10), (-10, 10)]
    )  # overlaps the first segment only
    result = assess_crossing_risk(
        RiskInput(border=[BORDER], staze=[hr(1, 100), bih(2, -100)], sporna_granica=[disputed]),
        Params(),
    )

    first, second = result.segments
    assert first.state == "sporna_granica"
    assert first.risk_index is None
    assert second.state == "procijenjen"


def test_segment_reports_the_nearest_pair_of_staze() -> None:
    track = Staza(3, "makadam", Strana.BIH, LineString([(0, -400), (1000, -400)]))
    result = assess_crossing_risk(
        RiskInput(border=[BORDER], staze=[hr(1, 100), hr(4, 700), bih(2, -150), track]), Params()
    )

    for segment in result.segments:
        assert (segment.hr_way_id, segment.bih_way_id) == (1, 2)
        assert (segment.hr_category, segment.bih_category) == ("cesta", "cesta")
        assert segment.nearest_distance_m == pytest.approx(250)


def pair(first_way: int, x0: float, x1: float, half_gap: float) -> list[Staza]:
    """A HR and a BiH Staza running parallel from x0 to x1, 2 * half_gap apart."""
    return [
        Staza(first_way, "cesta", Strana.HR, LineString([(x0, half_gap), (x1, half_gap)])),
        Staza(first_way + 1, "cesta", Strana.BIH, LineString([(x0, -half_gap), (x1, -half_gap)])),
    ]


LONG_BORDER = LineString([(0, 0), (3000, 0)])  # six segments of 500 m


def test_adjacent_segments_within_threshold_form_one_kriticno_podrucje() -> None:
    staze = [*pair(1, 0, 3000, 1000), *pair(3, 500, 1500, 200), *pair(5, 2000, 2500, 200)]
    result = assess_crossing_risk(RiskInput(border=[LONG_BORDER], staze=staze), Params())

    areas = result.kriticna_podrucja
    assert [(a.first_order, a.last_order) for a in areas] == [(1, 2), (4, 4)]  # longest first
    assert areas[0].length_m == pytest.approx(1000)
    assert areas[0].min_distance_m == pytest.approx(400)
    assert areas[0].peak_risk_index == pytest.approx(0.488, abs=0.001)


def test_segment_without_data_splits_a_kriticno_podrucje() -> None:
    staze = [*pair(1, 0, 500, 200), *pair(3, 1000, 1500, 200)]
    border = LineString([(0, 0), (1500, 0)])
    result = assess_crossing_risk(RiskInput(border=[border], staze=staze), Params())

    assert [s.state for s in result.segments] == [
        "procijenjen",
        "nedovoljno_podataka",
        "procijenjen",
    ]
    assert [(a.first_order, a.last_order) for a in result.kriticna_podrucja] == [(0, 0), (2, 2)]


def test_threshold_parameter_controls_which_segments_are_critical() -> None:
    staze = [*pair(1, 0, 3000, 1000), *pair(3, 500, 1500, 200)]  # nearest pair 400 m apart
    strict = assess_crossing_risk(
        RiskInput(border=[LONG_BORDER], staze=staze), Params(critical_distance_m=300)
    )
    lenient = assess_crossing_risk(
        RiskInput(border=[LONG_BORDER], staze=staze), Params(critical_distance_m=600)
    )

    assert strict.kriticna_podrucja == []
    assert len(lenient.kriticna_podrucja) == 1


def test_segment_length_parameter_changes_segmentation() -> None:
    staze = pair(1, 0, 1000, 200)
    result = assess_crossing_risk(
        RiskInput(border=[BORDER], staze=staze), Params(segment_length_m=250)
    )

    assert [s.geometry.length for s in result.segments] == pytest.approx([250] * 4)


def test_distance_bounds_are_parameters() -> None:
    staze = pair(1, 0, 1000, 500)  # 1000 m apart
    result = assess_crossing_risk(
        RiskInput(border=[BORDER], staze=staze), Params(near_distance_m=500, far_distance_m=2000)
    )

    # 1 - ln(1000 / 500) / ln(2000 / 500)
    assert result.segments[0].risk_index == pytest.approx(0.5, abs=0.001)


def test_river_lowered_segment_can_drop_out_of_a_kriticno_podrucje() -> None:
    staze = [*pair(1, 0, 3000, 1000), *pair(3, 500, 1500, 150)]  # 300 m apart: index 0.594
    river = LineString([(0, 0), (3000, 0)])
    with_river = assess_crossing_risk(
        RiskInput(border=[LONG_BORDER], staze=staze, water=[river]), Params()
    )

    assert with_river.segments[1].risk_index == pytest.approx(0.594 - 0.25, abs=0.001)
    assert with_river.kriticna_podrucja == []  # 0.344 is below the index of the 500 m threshold
