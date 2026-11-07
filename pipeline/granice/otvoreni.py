"""Two more open datasets from data.gov.hr, next to OSM and DZS border traffic.

- Zaštićena područja RH and Ekološka mreža Natura 2000 (INSPIRE WFS of HAOP/bioportal, listed on
  data.gov.hr): the polygons within PROTECTED_CORRIDOR_M of the border, for the map layer
  `zasticena_podrucja.geojson`. Where a way crosses such an area is a hint about terrain and about
  who else is on the ground (rangers), not part of the risk index.
- Popis stanovništva 2011, stanovništvo po naseljima (DZS, XLS): added to `mjesta.json` as the last
  column `stanovnika_2011` for the Croatian settlements (BiH has no row).

Run: `python -m granice zasticena`, `python -m granice stanovnistvo` (after `mjesta`).
"""

from __future__ import annotations

import json
import logging
import unicodedata
from pathlib import Path
from typing import Any

import requests
import shapely
from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform

from granice.config import PROJECTED_CRS

log = logging.getLogger("granice.otvoreni")

PROTECTED_CORRIDOR_M = 5_000
SIMPLIFY_M = 25
WFS = "https://services.bioportal.hr/inspire/{host}/ps/wfs"
# (host, feature type, kind shown on the page, data.gov.hr dataset)
PROTECTED_SOURCES = (
    ("geos1", "ps1:ProtectedSite", "zasticeno", "zatiena-podruja-republike-hrvatske-inspire"),
    ("geos2", "ps2:ProtectedSite", "natura2000", "ekoloka-mrea-natura-2000-republike-hrvatske-inspire"),
)
CENSUS_URL = "https://web.dzs.hr/Hrv/censuses/census2011/results/xls/Nas_01_HR.xls"


def _plain(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", text.lower().strip()) if unicodedata.category(c) != "Mn"
    )


def _site_name(properties: dict[str, Any]) -> str:
    def find(node: Any) -> str | None:
        if isinstance(node, dict):
            text = node.get("text")
            if isinstance(text, str):
                return text
            return next((t for v in node.values() if (t := find(v))), None)
        if isinstance(node, list):
            return next((t for v in node if (t := find(v))), None)
        return None

    text = find(properties.get("siteName"))
    if text is None:
        return "Bez naziva"
    return text.strip().capitalize() if text.isupper() else text.strip()


def _fetch_sites(host: str, feature_type: str, cache: Path) -> dict[str, Any]:
    path = cache / f"{host}.json"
    if path.exists():
        return dict(json.loads(path.read_text(encoding="utf-8")))
    response = requests.get(
        WFS.format(host=host),
        params={
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": feature_type,
            "outputFormat": "application/json",
            "srsName": "EPSG:4326",
        },
        timeout=300,
    )
    response.raise_for_status()
    data: dict[str, Any] = dict(response.json())
    cache.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def write_zasticena(out_dir: Path, cache: Path) -> None:
    """data/out/zasticena_podrucja.geojson: protected areas and Natura 2000 near the border."""
    granica = json.loads((out_dir / "granica.geojson").read_text(encoding="utf-8"))
    border = shapely.union_all([shape(f["geometry"]) for f in granica["features"]])
    project = Transformer.from_crs("EPSG:4326", PROJECTED_CRS, always_xy=True).transform
    back = Transformer.from_crs(PROJECTED_CRS, "EPSG:4326", always_xy=True).transform
    corridor = transform(project, border).buffer(PROTECTED_CORRIDOR_M)
    prepared = shapely.prepared.prep(corridor)

    features = []
    for host, feature_type, kind, _dataset in PROTECTED_SOURCES:
        data = _fetch_sites(host, feature_type, cache)
        kept = 0
        for feature in data["features"]:
            geometry = feature.get("geometry")
            if not geometry:
                continue
            projected = transform(project, shape(geometry))
            if not prepared.intersects(projected):
                continue
            simple = shapely.make_valid(projected.simplify(SIMPLIFY_M))
            if simple.is_empty:
                continue
            features.append(
                {
                    "type": "Feature",
                    "geometry": mapping(
                        shapely.set_precision(transform(back, simple), 0.00001)
                    ),
                    "properties": {
                        "naziv": _site_name(feature["properties"]),
                        "vrsta": kind,
                    },
                }
            )
            kept += 1
        log.info("%s: %d of %d areas near the border", host, kept, len(data["features"]))
    target = out_dir / "zasticena_podrucja.geojson"
    target.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False),
        encoding="utf-8",
    )
    log.info("Wrote %s (%d areas)", target, len(features))


def _census(cache: Path) -> dict[tuple[str, str], int]:
    """(municipality, settlement) -> residents 2011, from the DZS XLS (needs `xlrd`)."""
    import xlrd

    path = cache / "Nas_01_HR.xls"
    if not path.exists():
        response = requests.get(CENSUS_URL, timeout=300)
        response.raise_for_status()
        cache.mkdir(parents=True, exist_ok=True)
        path.write_bytes(response.content)
    sheet = xlrd.open_workbook(str(path)).sheet_by_index(0)
    rows: dict[tuple[str, str], int] = {}
    for r in range(sheet.nrows):
        _county, _kind, municipality, settlement, sex, total = sheet.row_values(r)[:6]
        if sex == "sv." and settlement and settlement != "UKUPNO" and isinstance(total, float):
            rows[(_plain(municipality), _plain(settlement))] = int(total)
    return rows


def write_stanovnistvo(out_dir: Path, cache: Path) -> None:
    """Add `stanovnika_2011` (last column) to the Croatian settlements of mjesta.json."""
    census = _census(cache)
    by_name: dict[str, list[int]] = {}
    for (_municipality, settlement), population in census.items():
        by_name.setdefault(settlement, []).append(population)

    path = out_dir / "mjesta.json"
    content = json.loads(path.read_text(encoding="utf-8"))
    fields = [f for f in content["polja"] if f != "stanovnika_2011"]
    matched = 0
    rows = []
    for original in content["mjesta"]:
        row = original[:6]
        residents: int | None = None
        if row[5] == "Hrvatska":
            settlement = _plain(row[2])
            municipality = _plain(row[3] or "")
            for prefix in ("grad ", "opcina "):
                municipality = municipality.removeprefix(prefix)
            residents = census.get((municipality, settlement))
            if residents is None and len(by_name.get(settlement, [])) == 1:
                residents = by_name[settlement][0]
        matched += residents is not None
        rows.append([*row, residents])
    content["polja"] = [*fields, "stanovnika_2011"]
    content["mjesta"] = rows
    content["izvori"] = "Stanovništvo: DZS, Popis stanovništva 2011. (data.gov.hr)"
    path.write_text(json.dumps(content, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("Population added to %d of %d settlements", matched, len(rows))
