"""Provenance tracking and assignment - WP4.

Three tags, no fourth (contract §5):
- real:      the value IS a digitised field measurement (monument position AND monument epoch)
- pinned:    fitted-model output at a monument position, off a monument epoch
- synthetic: everything else, and every derivative, noise, drift and battery value

A monument position needs the survey line's along-panel position (`pinning.survey_line_x_m`
in the mine file). The Adriyala CSV records distance across the panel only, so until that
position is sourced every value is `synthetic` — the honest answer.
"""

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Dict, Literal, Optional, Tuple

from minesim.errors import ProvenanceError

Provenance = Literal["real", "pinned", "synthetic"]
TAGS = ("real", "pinned", "synthetic")


@dataclass(frozen=True)
class Value:
    magnitude: float
    unit: str
    provenance: Provenance

    def __post_init__(self) -> None:
        if self.provenance not in TAGS:
            raise ProvenanceError(f"invalid provenance tag {self.provenance!r}; must be one of {TAGS}")


@dataclass(frozen=True)
class Monuments:
    """Transverse survey monuments: (offset_y_m, epoch_day) -> measured subsidence_mm (negative down)."""
    line_x_m: Optional[float]
    offsets_y_m: Tuple[float, ...]
    measured: Dict[Tuple[float, int], float]


@lru_cache(maxsize=8)
def load_monuments(profiles_csv: str, line_x_m: Optional[float], origin_offset_m: float = 0.0) -> Monuments:
    """Monument offsets in the panel frame: y = CSV distance_m - origin_offset_m."""
    measured: Dict[Tuple[float, int], float] = {}
    with open(profiles_csv, newline="") as f:
        for row in csv.DictReader(f):
            if row["path_type"] != "transverse":
                continue
            key = (float(row["distance_m"]) - origin_offset_m, int(float(row["epoch_days"])))
            measured[key] = float(row["subsidence_mm"])
    offsets = tuple(sorted({k[0] for k in measured}))
    return Monuments(line_x_m=line_x_m, offsets_y_m=offsets, measured=measured)


def monument_at(mon: Monuments, x_m: float, y_m: float, tolerance_m: float) -> Optional[float]:
    """Nearest monument offset within tolerance of (x, y), or None."""
    if mon.line_x_m is None or abs(x_m - mon.line_x_m) > tolerance_m:
        return None
    nearest = min(mon.offsets_y_m, key=lambda d: abs(d - y_m), default=None)
    if nearest is None or abs(nearest - y_m) > tolerance_m:
        return None
    return nearest


def measured_at(mon: Monuments, x_m: float, y_m: float, t_days: float, tolerance_m: float,
                epoch_tolerance_days: float) -> Optional[float]:
    """The digitised measurement for this position and time, if one exists."""
    if monument_at(mon, x_m, y_m, tolerance_m) is None:
        return None
    for (d, day), value in mon.measured.items():
        if abs(d - y_m) <= tolerance_m and abs(day - t_days) <= epoch_tolerance_days:
            return value
    return None
