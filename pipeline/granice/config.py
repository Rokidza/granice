"""Project-wide constants: the Pilot odsječak, OSM relation ids and disputed border sections."""

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

# How far from the border Staze are fetched. Must be at least the risk search radius.
CORRIDOR_M = 3500


@dataclass(frozen=True)
class DisputedSection:
    name: str
    bbox: BBox


# Disputed sections are marked "sporna granica" and excluded from the risk calculation. The boxes
# are rough approximations (docs/podaci-i-licence.md: status as of 2026 not verified) and must be
# reviewed by someone who knows the current situation. None of them lies inside the pilot.
DISPUTED_SECTIONS = [
    DisputedSection("Una kod Hrvatske Kostajnice", BBox(45.15, 16.40, 45.30, 16.65)),
    DisputedSection("Klek i Školji", BBox(42.88, 17.55, 42.94, 17.62)),
    DisputedSection("Neum i Sutorina", BBox(42.40, 17.60, 42.95, 18.55)),
]
