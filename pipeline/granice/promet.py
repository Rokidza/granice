"""Border traffic per road crossing HR-BiH, from DZS (Državni zavod za statistiku, PX-Web API).

The crossings of DZS have names only; `prijelazi_dzs.csv` gives each the position of the OSM node
of that crossing (docs/datasetovi-datathon.md). Crossings without a row there are left out.
"""

from __future__ import annotations

import csv
import json
import logging
import time
import unicodedata
from pathlib import Path
from typing import Any

import requests

log = logging.getLogger("granice.promet")

API = "https://web.dzs.hr/PXWeb/api/v1/hr/Transport%20i%20komunikacije/Granični%20promet/"
YEAR = 2025  # the latest complete year
BORDER_LABEL = "bosanskohercegovačke"  # in the label of the group of crossings
COORDINATES = Path(__file__).with_name("prijelazi_dzs.csv")
PAUSE_S = 3.0  # the API answers 429 after about 30 requests in 10 s

# DZS table -> (kind of traffic, direction)
TABLES = {
    "T1.px": ("putnici", "ulaz"),
    "T2.px": ("putnici", "izlaz"),
    "T3.px": ("osobna", "ulaz"),
    "T4.px": ("osobna", "izlaz"),
    "T5.px": ("autobusi", "ulaz"),
    "T6.px": ("autobusi", "izlaz"),
    "T7.px": ("teretna", "ulaz"),
    "T8.px": ("teretna", "izlaz"),
}


def _plain(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn"
    )


def _fetch(table: str, cache: Path) -> dict[str, Any]:
    """One table for YEAR: every crossing, every month, the total of domestic and foreign."""
    path = cache / f"{table}.{YEAR}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    meta = requests.get(API + table, timeout=60).json()
    time.sleep(PAUSE_S)
    year = next(v for v in meta["variables"] if v["code"] == "Godina")
    months = next(v for v in meta["variables"] if v["code"] == "Mjesec")
    kinds = next(v for v in meta["variables"] if v["code"] == "Varijabla")
    body = {
        "query": [
            {"code": "Prijelazi", "selection": {"filter": "all", "values": ["*"]}},
            {
                "code": "Godina",
                "selection": {"filter": "item", "values": [year["values"][year["valueTexts"].index(str(YEAR))]]},
            },
            {"code": "Mjesec", "selection": {"filter": "all", "values": ["*"]}},
            {
                "code": "Varijabla",
                "selection": {"filter": "item", "values": [kinds["values"][kinds["valueTexts"].index("ukupno")]]},
            },
        ],
        "response": {"format": "json-stat2"},
    }
    response = requests.post(API + table, json=body, timeout=60)
    response.raise_for_status()
    data = response.json()
    time.sleep(PAUSE_S)
    crossings = list(data["dimension"]["Prijelazi"]["category"]["label"].values())
    month_labels = months["valueTexts"]
    values = data["value"]
    per_month = len(month_labels)
    result = {"crossings": crossings, "months": month_labels, "values": values, "per_month": per_month}
    cache.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result


def _bih_series(table: dict[str, Any]) -> dict[str, list[float]]:
    """name -> the 12 monthly values + the year total (None where DZS has no figure)."""
    labels = table["crossings"]
    start = next(i for i, label in enumerate(labels) if BORDER_LABEL in label.lower())
    width = table["per_month"]
    series = {}
    for i in range(start + 1, len(labels)):
        if not labels[i].startswith("    "):
            break
        row = table["values"][i * width : (i + 1) * width]
        series[labels[i].strip()] = [v if isinstance(v, (int, float)) else 0 for v in row]
    return series


def write_promet(out_dir: Path, cache: Path) -> None:
    """data/out/promet_prijelaza.geojson: one Point per crossing with its traffic in YEAR."""
    tables = {name: _bih_series(_fetch(name, cache)) for name in TABLES}
    with COORDINATES.open(encoding="utf-8", newline="") as handle:
        positions = {_plain(r["naziv"]): r for r in csv.DictReader(handle)}
    features = []
    missing = []
    for name in tables["T1.px"]:
        row = positions.get(_plain(name))
        if row is None:
            missing.append(name)
            continue
        properties: dict[str, Any] = {"naziv": name.title(), "godina": YEAR}
        for table, (kind, direction) in TABLES.items():
            properties[f"{kind}_{direction}"] = int(tables[table].get(name, [0])[-1])
        # months I-XII are the first twelve values, the last is the year total
        properties["putnici_mjesecno"] = [
            int(tables["T1.px"][name][m] + tables["T2.px"].get(name, [0] * 13)[m]) for m in range(12)
        ]
        properties["putnici_ukupno"] = properties["putnici_ulaz"] + properties["putnici_izlaz"]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [float(row["lon"]), float(row["lat"])]},
                "properties": properties,
            }
        )
    features.sort(key=lambda f: -f["properties"]["putnici_ukupno"])
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "promet_prijelaza.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False),
        encoding="utf-8",
    )
    log.info("%d crossings written; without a position: %s", len(features), ", ".join(missing))
