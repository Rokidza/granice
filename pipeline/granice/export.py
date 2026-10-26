"""Writes the precomputed layers the web page loads (the contract is in docs/ugovor-izlaza.md)."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pyproj import Transformer
from shapely.geometry import MultiLineString, mapping
from shapely.geometry.base import BaseGeometry
from shapely.ops import linemerge, transform

from granice.config import PILOT_BBOX, DisputedSection
from granice.prepare import Prepared
from granice.risk import Assessment, KriticnoPodrucje, Params, SegmentGranice

SCHEMA_VERSION = 1
COORD_DECIMALS = 5  # about 1 m


def segment_id(chain: int, order: int) -> str:
    return f"{chain}-{order}"


def write_layers(
    out_dir: Path,
    prepared: Prepared,
    assessment: Assessment,
    params: Params,
    osm_timestamp: str,
    disputed: list[DisputedSection],
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    to_wgs84 = prepared.to_wgs84
    risk_input = prepared.risk_input

    layers = {
        "staze": _staze(prepared, to_wgs84),
        "granica": _collection(
            _feature(to_wgs84, c, {"lanac": i}) for i, c in enumerate(risk_input.border)
        ),
        "segmenti": _collection(_segment(prepared, s) for s in assessment.segments),
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
            "pilot_bbox": asdict(PILOT_BBOX),
            "parametri": asdict(params),
            "sporne_zone": [d.name for d in disputed],
            "broj_segmenata_po_stanju": dict(Counter(s.state for s in assessment.segments)),
            "atribucija": "© OpenStreetMap contributors",
        },
    )


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


def _segment(prepared: Prepared, segment: SegmentGranice) -> dict[str, Any]:
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
    for prefix, way_id, category in (
        ("hr", segment.hr_way_id, segment.hr_category),
        ("bih", segment.bih_way_id, segment.bih_category),
    ):
        properties[f"{prefix}_staza_id"] = way_id
        properties[f"{prefix}_staza_naziv"] = tags.get(way_id or -1, {}).get("name")
        properties[f"{prefix}_staza_kategorija"] = category
    return _feature(prepared.to_wgs84, segment.geometry, properties)


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
        if "izravni_prelazak" in segment.flags:
            midpoint = segment.geometry.interpolate(0.5, normalized=True)
            features.append(
                _feature(
                    prepared.to_wgs84,
                    midpoint,
                    {
                        "tip": "izravni_prelazak",
                        "segment": segment_id(segment.chain, segment.order),
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
