"""Writes the precomputed layers the web page loads (the contract is in docs/ugovor-izlaza.md)."""

from __future__ import annotations

import json
import shutil
from collections import Counter
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pyproj import Transformer
from shapely.geometry import MultiLineString, box, mapping
from shapely.geometry.base import BaseGeometry
from shapely.ops import linemerge, transform

from granice.config import AREAS, RISK_CATEGORIES, BBox, DisputedSection
from granice.prepare import Prepared
from granice.risk import (
    Assessment,
    KriticnoPodrucje,
    Params,
    SegmentGranice,
    border_corridor,
)
from granice.river_border import RiverStretch, river_segments

SCHEMA_VERSION = 8
COORD_DECIMALS = 5  # about 1 m

CHOICES_DIR = "pojasevi"  # one file per precomputed max_border_distance_m
FOG_MARGIN_M = 100_000  # how far around the border the fog outside the corridor reaches
FOG_SIMPLIFY_M = 10.0  # the fog is only drawn, so its edge may be this much off
# Properties of a segment that do not depend on max_border_distance_m (kept in segmenti.geojson).
_FIXED_SEGMENT_KEYS = ("lanac", "red", "duljina_m", "na_rijeci")


def segment_id(chain: int, order: int) -> str:
    return f"{chain}-{order}"


def write_layers(
    out_dir: Path,
    prepared: Prepared,
    assessment: Assessment,
    params: Params,
    osm_timestamp: str,
    area: BBox,
    disputed: list[DisputedSection],
    river_stretches: list[RiverStretch],
    corridor_choices: list[float],
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    to_wgs84 = prepared.to_wgs84
    risk_input = prepared.risk_input

    on_river = river_segments(assessment.segments, river_stretches)
    layers = {
        "staze": _staze(prepared, to_wgs84),
        "granica": _collection(
            _feature(to_wgs84, c, {"lanac": i}) for i, c in enumerate(risk_input.border)
        ),
        "segmenti": _collection(
            _segment(prepared, s, (s.chain, s.order) in on_river) for s in assessment.segments
        ),
        "rijecna_granica": _collection(
            _feature(
                to_wgs84, r.geometry, {"lanac": r.chain, "duljina_m": round(r.geometry.length, 1)}
            )
            for r in river_stretches
        ),
        "prijelazi": _prijelazi(prepared, assessment),
        "kriticna_podrucja": _collection(
            _area(to_wgs84, assessment, rank, area)
            for rank, area in enumerate(assessment.kriticna_podrucja, start=1)
        ),
    }
    for name, collection in layers.items():
        _write_json(out_dir / f"{name}.geojson", collection)

    _write_json(
        out_dir / "meta.json",
        {
            "schema": SCHEMA_VERSION,
            "osm_podaci_od": osm_timestamp,
            "generirano": datetime.now(UTC).isoformat(timespec="seconds"),
            "podrucje": next(name for name, bbox in AREAS.items() if bbox == area),
            "podrucje_bbox": asdict(area),
            "parametri": asdict(params),
            "kategorije_izracuna": list(RISK_CATEGORIES),
            "pojasevi_m": corridor_choices,
            "sporne_zone": [d.name for d in disputed],
            "broj_segmenata_po_stanju": dict(Counter(s.state for s in assessment.segments)),
            "atribucija": "© OpenStreetMap contributors",
        },
    )


def write_corridor_choices(
    out_dir: Path, prepared: Prepared, assessments: dict[float, Assessment]
) -> None:
    """One file per precomputed max_border_distance_m: the segment properties that depend on it,
    in the order of segmenti.geojson (null and false left out), and the fog outside the corridor."""
    choices_dir = out_dir / CHOICES_DIR
    shutil.rmtree(choices_dir, ignore_errors=True)  # no files left over from other choices
    choices_dir.mkdir(parents=True)
    for distance_m, assessment in assessments.items():
        rows = []
        for segment in assessment.segments:
            properties = _segment_properties(prepared, segment)
            rows.append(
                {
                    k: v
                    for k, v in properties.items()
                    if k not in _FIXED_SEGMENT_KEYS and v is not None and v is not False
                }
            )
        _write_json(
            choices_dir / f"{distance_m:g}.json",
            {
                "max_border_distance_m": distance_m,
                "broj_segmenata_po_stanju": dict(Counter(s.state for s in assessment.segments)),
                "segmenti": rows,
                "magla": _fog(prepared, distance_m),
            },
        )


def _fog(prepared: Prepared, distance_m: float) -> dict[str, Any]:
    """The area around the border farther than `distance_m` from it, as a GeoJSON geometry."""
    corridor = border_corridor(prepared.risk_input.border, distance_m)
    surroundings = box(*corridor.bounds).buffer(FOG_MARGIN_M, join_style="mitre")
    fog = surroundings.difference(corridor).simplify(FOG_SIMPLIFY_M)
    result: dict[str, Any] = _rounded(mapping(transform(prepared.to_wgs84.transform, fog)))
    return result


def _staze(prepared: Prepared, to_wgs84: Transformer) -> dict[str, Any]:
    features = []
    for staza in prepared.risk_input.staze:
        tags = prepared.way_tags.get(staza.way_id, {})
        features.append(
            _feature(
                to_wgs84,
                staza.geometry,
                {
                    "id": staza.way_id,
                    "strana": staza.strana.value,
                    "kategorija": staza.category,
                    "naziv": tags.get("name"),
                    "highway": tags.get("highway"),
                },
            )
        )
    return _collection(features)


def _segment(prepared: Prepared, segment: SegmentGranice, on_river: bool) -> dict[str, Any]:
    properties = {**_segment_properties(prepared, segment), "na_rijeci": on_river}
    return _feature(prepared.to_wgs84, segment.geometry, properties)


def _segment_properties(prepared: Prepared, segment: SegmentGranice) -> dict[str, Any]:
    tags = prepared.way_tags
    properties: dict[str, Any] = {
        "id": segment_id(segment.chain, segment.order),
        "lanac": segment.chain,
        "red": segment.order,
        "stanje": segment.state,
        "rizik": _round(segment.risk_index, 4),
        "udaljenost_m": _round(segment.nearest_distance_m, 1),
        "duljina_m": round(segment.geometry.length, 1),
        "rijeka": "rijeka" in segment.flags,
        "izravni_prelazak": "izravni_prelazak" in segment.flags,
    }
    for prefix, way_id, category, border_distance in (
        ("hr", segment.hr_way_id, segment.hr_category, segment.hr_border_distance_m),
        ("bih", segment.bih_way_id, segment.bih_category, segment.bih_border_distance_m),
    ):
        properties[f"{prefix}_staza_id"] = way_id
        properties[f"{prefix}_staza_naziv"] = tags.get(way_id or -1, {}).get("name")
        properties[f"{prefix}_staza_kategorija"] = category
        properties[f"{prefix}_od_granice_m"] = _round(border_distance, 1)
    properties["prelazak_staza_id"] = segment.crossing and segment.crossing.way_id
    properties["prelazak_kategorija"] = segment.crossing and segment.crossing.category
    link = segment.link and transform(prepared.to_wgs84.transform, segment.link)
    properties["hr_tocka"] = link and _rounded(list(link.coords[0]))
    properties["bih_tocka"] = link and _rounded(list(link.coords[-1]))
    return properties


def _prijelazi(prepared: Prepared, assessment: Assessment) -> dict[str, Any]:
    features = [
        {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [round(lon, COORD_DECIMALS), round(lat, COORD_DECIMALS)],
            },
            "properties": {"tip": "sluzbeni_prijelaz"},
        }
        for lon, lat in prepared.sluzbeni_prijelazi_wgs84
    ]
    for segment in assessment.segments:
        crossing = segment.crossing
        if "izravni_prelazak" in segment.flags and crossing is not None:
            tags = prepared.way_tags.get(crossing.way_id, {})
            features.append(
                _feature(
                    prepared.to_wgs84,
                    crossing.point,
                    {
                        "tip": "izravni_prelazak",
                        "segment": segment_id(segment.chain, segment.order),
                        "staza_id": crossing.way_id,
                        "kategorija": crossing.category,
                        "naziv": tags.get("name"),
                        "highway": tags.get("highway"),
                    },
                )
            )
    return _collection(features)


def _area(
    to_wgs84: Transformer, assessment: Assessment, rank: int, area: KriticnoPodrucje
) -> dict[str, Any]:
    lines = [
        s.geometry
        for s in assessment.segments
        if s.chain == area.chain and area.first_order <= s.order <= area.last_order
    ]
    return _feature(
        to_wgs84,
        linemerge(MultiLineString(lines)),
        {
            "rang": rank,
            "lanac": area.chain,
            "prvi_segment": segment_id(area.chain, area.first_order),
            "zadnji_segment": segment_id(area.chain, area.last_order),
            "broj_segmenata": area.last_order - area.first_order + 1,
            "duljina_m": round(area.length_m, 1),
            "najmanja_udaljenost_m": round(area.min_distance_m, 1),
            "vrh_rizika": round(area.peak_risk_index, 4),
        },
    )


def _feature(
    to_wgs84: Transformer, geometry: BaseGeometry, properties: dict[str, Any]
) -> dict[str, Any]:
    projected = transform(to_wgs84.transform, geometry)
    return {"type": "Feature", "geometry": _rounded(mapping(projected)), "properties": properties}


def _collection(features: Any) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": list(features)}


def _rounded(geometry: Any) -> Any:
    if isinstance(geometry, (list, tuple)):
        if geometry and isinstance(geometry[0], (int, float)):
            return [round(v, COORD_DECIMALS) for v in geometry]
        return [_rounded(g) for g in geometry]
    if isinstance(geometry, dict):
        return {k: _rounded(v) if k == "coordinates" else v for k, v in geometry.items()}
    return geometry


def _round(value: float | None, digits: int) -> float | None:
    return None if value is None else round(value, digits)


def _write_json(path: Path, content: Any) -> None:
    path.write_text(
        json.dumps(content, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
