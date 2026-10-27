"""Project-wide constants: the covered areas, OSM relation ids and disputed border sections."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
OUT_DIR = DATA_DIR / "out"

PROJECTED_CRS = "EPSG:32633"  # UTM 33N covers the whole HR-BiH border well enough for metre maths

# OSM admin_level=2 relations of the two states (see docs/DESIGN.md).
HR_RELATION = 214885
BIH_RELATION = 2528142


@dataclass(frozen=True)
class BBox:
    south: float
    west: float
    north: float
    east: float

    def overpass(self) -> str:
        return f"{self.south},{self.west},{self.north},{self.east}"


# Pilot odsječak: from Dvor na Uni over Cetingrad, Slunj and Plitvice to Korenica, Donji Lapac and
# northern Lika. Includes the Bihać pocket and Lička Plješivica.
PILOT_BBOX = BBox(south=44.50, west=15.50, north=45.10, east=16.45)

# The whole HR-BiH border (about 1000 km, lat 42.56-45.28, lon 15.73-19.02), with a small margin.
BORDER_BBOX = BBox(south=42.50, west=15.65, north=45.35, east=19.10)

# `--podrucje` choices of the command line.
AREAS = {"cijela": BORDER_BBOX, "pilot": PILOT_BBOX}

# How far from the border Staze are fetched. Must be at least the risk search radius.
CORRIDOR_M = 3500

# Categories of Staze that take part in the risk calculation. The others are still drawn on the map.
RISK_CATEGORIES = ("cesta",)

# Values of max_border_distance_m computed in advance: on the web page the planner types in how far
# from the border roads count, and the page loads the nearest of these.
CORRIDOR_CHOICES_M = tuple(float(d) for d in range(50, 2001, 50))


@dataclass(frozen=True)
class DisputedSection:
    name: str
    bbox: BBox


# Disputed sections are marked "sporna granica" and excluded from the risk calculation. The boxes
# are rough approximations (docs/podaci-i-licence.md: status as of 2026 not verified) and must be
# reviewed by someone who knows the current situation. None of them lies inside the pilot.
# Una: the river border from just south of Hrvatska Kostajnica to the mouth at Jasenovac.
# Klek, Školji and Neum: the Neum corridor and the Klek peninsula; Sutorina is not on the HR-BiH
# border (it is BiH-Montenegro), so the stretch to Konavle is no longer blanketed.
DISPUTED_SECTIONS = [
    DisputedSection("Una kod Hrvatske Kostajnice", BBox(45.15, 16.40, 45.30, 16.95)),
    DisputedSection("Klek, Školji i Neum", BBox(42.86, 17.50, 43.00, 17.72)),
]
