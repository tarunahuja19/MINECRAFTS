"""
Single loader/classifier for `config/alarm-thresholds.json`, the one table
every alarm consumer in this repo is meant to read (see DATA-365 plan,
Segment T). `backend/alarm/thresholds.js` implements the identical API in
CommonJS; the two are asserted against the same vector file,
`config/threshold_vectors.json`, so a change to one language's rounding or
boundary handling that disagrees with the other shows up as a test failure.

This module does not decide *which* copy of a threshold constant is the
canonical one elsewhere in the codebase (`constants.py`, `sensors.py`,
`segments.py` still carry their own numbers) -- that rewiring is later
DATA-365 steps. This module only has to exist, load the shared file, and
classify correctly against it.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Optional, Union

# simulation/sandbox/thresholds.py -> parent (sandbox) -> parent (simulation)
# -> parent (repo root) -> config/alarm-thresholds.json.
_DEFAULT_PATH = Path(__file__).resolve().parent.parent.parent / "config" / "alarm-thresholds.json"

LEVELS = ("NORMAL", "ADVISORY", "WARNING", "CRITICAL")

# comms_stale and sensor_flatline are data-quality flags raised from packet
# cadence / flatline detection, not from a number compared against a limit.
# classify() has nothing to compare, so it raises rather than guessing a
# level -- documented here and kept identical in backend/alarm/thresholds.js.
_NON_VALUE_CONDITIONS = frozenset({"comms_stale", "sensor_flatline"})


@lru_cache(maxsize=None)
def _load_cached(path_str: str) -> dict:
    with open(path_str, "r", encoding="utf-8") as f:
        return json.load(f)


def load(path: Optional[Union[str, Path]] = None) -> dict:
    """Load and cache the shared alarm-threshold table.

    The default path resolves to `config/alarm-thresholds.json` at the
    repo root, relative to this file. Repeated calls with the same (or
    default) path return the cached dict; a different path gets its own
    cache entry, which is how tests point at fixture files.
    """
    resolved = str(Path(path).resolve()) if path is not None else str(_DEFAULT_PATH)
    return _load_cached(resolved)


def _classify_numeric(
    direction: str,
    value: float,
    advisory: Optional[float],
    warning: Optional[float],
    critical: Optional[float],
) -> str:
    """Compare `value` against the three rungs in the given `direction`.

    A rung of None is skipped (some conditions, e.g. tilt_rate, have no
    CRITICAL rung at all). Reaching a threshold exactly counts as having
    crossed it -- `value == limit` returns that limit's level.
    """
    rungs = ((critical, "CRITICAL"), (warning, "WARNING"), (advisory, "ADVISORY"))
    if direction == "above":
        for limit, level in rungs:
            if limit is not None and value >= limit:
                return level
        return "NORMAL"
    if direction == "below":
        for limit, level in rungs:
            if limit is not None and value <= limit:
                return level
        return "NORMAL"
    raise ValueError(f"unknown direction: {direction!r}")


def _ppv_band(spec: dict, freq_hz: Optional[float]) -> dict:
    """Pick the DGMS frequency band for `freq_hz`.

    `None` (dominant frequency not measured) uses the lowest-frequency
    band, which is also the strictest (lowest mm/s limit) -- the safe
    default when we don't know any better. A band's `max_hz` is exclusive
    (`freq_hz < max_hz`), matching the DGMS table's own "< 8 Hz" / "> 25 Hz"
    wording -- a reading of exactly 8 Hz falls in the 8-25 Hz band, not the
    < 8 Hz one.
    """
    bands = spec["limits_by_band"]
    if freq_hz is None:
        return bands[0]
    for band in bands:
        if band["max_hz"] is None or freq_hz < band["max_hz"]:
            return band
    return bands[-1]


def classify(condition: str, value: Optional[float], *, freq_hz: Optional[float] = None) -> str:
    """Classify `value` for `condition` into NORMAL/ADVISORY/WARNING/CRITICAL.

    `value` of `None` or NaN is always NORMAL -- a missing reading is a
    comms/sensor-fault concern, not itself an alarm value. `freq_hz` only
    matters for `ppv`, which is banded by dominant vibration frequency
    (see `_ppv_band`); it is ignored for every other condition.

    Raises `ValueError` for an unknown condition, and for `comms_stale`/
    `sensor_flatline` (see `_NON_VALUE_CONDITIONS`).
    """
    table = load()
    conditions = table["conditions"]
    if condition not in conditions:
        raise ValueError(f"unknown alarm condition: {condition!r}")
    if condition in _NON_VALUE_CONDITIONS:
        raise ValueError(
            f"{condition!r} is not classified by value; it is raised from packet "
            "cadence / flatline detection, not compared against a number"
        )

    if value is None or math.isnan(value):
        return "NORMAL"

    spec = conditions[condition]

    if condition == "ppv":
        band = _ppv_band(spec, freq_hz)
        limit = band["limit"]
        fractions = spec["fractions"]
        return _classify_numeric(
            "above",
            value,
            fractions["advisory"] * limit,
            fractions["warning"] * limit,
            fractions["critical"] * limit,
        )

    return _classify_numeric(spec["direction"], value, spec["advisory"], spec["warning"], spec["critical"])


def crack_category(width_mm: float) -> int:
    """Burland/BRE Digest 251 damage category (0..5) for a crack width in mm.

    Categories are ordered by ascending `min_mm`; the returned category is
    the highest one whose `min_mm` the width has reached (>=), matching
    the same "boundary counts as reached" rule `classify` uses.
    """
    categories = load()["conditions"]["crack_width"]["categories"]
    best = categories[0]["cat"]
    for cat in categories:
        if cat["min_mm"] is not None and width_mm >= cat["min_mm"]:
            best = cat["cat"]
    return best
