"""
Scenario scripts: a fixed, replayable list of operator events.

A script is a JSON file in ``simulation/scenarios/``::

    {
      "name": "default_demo",
      "seed": 20260927,
      "base_iso_time": "2026-01-01T00:00:00Z",
      "duration_days": 365,
      "tick_seconds": 3600,
      "events": [ {"type": "crack", "day": 60, ...}, ... ]
    }

Events use exactly the shapes ``sandbox.events.to_failures`` takes (the FORGE
event dicts), each with a ``day``:

- ``cave_in``   x, y, radius_m, depth_m, [duration_h = 4.8], [warning_hours = 8]
- ``tilt``      x, y, radius_m, rate_mm_per_m, direction_deg, over_days
- ``crack``     x0, y0, x1, y1, throw_m, width_m, open_days
- ``vibration`` ppv_mm_s, [duration_s = 60], [x = 0], [y = 0]

``tick_seconds`` is how much simulated time one tick (and one packet) covers.
The live engine's 60 s would make a 365-day script 525,600 ticks, so a script
picks its own; an event is still applied on the first tick at or after its day.

Ranges are the FORGE sliders' (``dashboard_electron/renderer/index.html``).
Positions must lie inside the +-300 m monitoring window. `load_script` sorts
events by day and fills in the defaults, so what it returns can be handed to
``to_failures`` as it is. Every error names the event index and the field.
"""

import json
import math
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from sandbox import constants

SCENARIO_DIR = Path(__file__).resolve().parent.parent / "scenarios"

_HALF_WINDOW_M = constants.WINDOW_SIZE_M / 2.0
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

DEFAULT_TICK_SECONDS = 3600.0
DEFAULT_PLAY_SECONDS = 240.0
MIN_TICK_SECONDS = 60.0
MAX_TICK_SECONDS = 86400.0
MAX_DURATION_DAYS = 3650.0

_COORD = (-_HALF_WINDOW_M, _HALF_WINDOW_M)

# field -> (min, max, default). A default of None means the field is required.
_EVENT_FIELDS: dict[str, dict[str, tuple[float, float, float | None]]] = {
    "cave_in": {
        "x": (*_COORD, None),
        "y": (*_COORD, None),
        "radius_m": (10.0, 300.0, None),
        "depth_m": (0.5, 25.0, None),
        "duration_h": (0.5, 48.0, 4.8),
        "warning_hours": (0.5, 48.0, 8.0),
    },
    "tilt": {
        "x": (*_COORD, None),
        "y": (*_COORD, None),
        "radius_m": (10.0, 500.0, None),
        "rate_mm_per_m": (0.5, 30.0, None),
        "direction_deg": (0.0, 360.0, None),
        "over_days": (1.0, 30.0, None),
    },
    "crack": {
        "x0": (*_COORD, None),
        "y0": (*_COORD, None),
        "x1": (*_COORD, None),
        "y1": (*_COORD, None),
        "throw_m": (0.05, 2.0, None),
        "width_m": (2.0, 30.0, None),
        "open_days": (0.5, 30.0, None),
    },
    "vibration": {
        "ppv_mm_s": (1.0, 100.0, None),
        "duration_s": (1.0, 3600.0, 60.0),
        "x": (*_COORD, 0.0),
        "y": (*_COORD, 0.0),
    },
}


class ScriptError(ValueError):
    """A scenario script that cannot be loaded. The message names the field."""


@dataclass(frozen=True)
class Script:
    name: str
    seed: int
    base_iso_time: str
    duration_days: float
    tick_seconds: float
    events: tuple[dict[str, Any], ...]

    @property
    def n_ticks(self) -> int:
        return int(math.ceil(self.duration_days * 86400.0 / self.tick_seconds))

    @property
    def default_speed(self) -> float:
        """Sim seconds per wall second that plays the whole script in about four minutes."""
        return self.duration_days * 86400.0 / DEFAULT_PLAY_SECONDS


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _number(where: str, v: Any, lo: float, hi: float) -> float:
    if not _is_number(v):
        raise ScriptError(f"{where}: expected a number, got {v!r}")
    if v < lo:
        raise ScriptError(f"{where}: {v} is below the minimum {lo:g}")
    if v > hi:
        raise ScriptError(f"{where}: {v} is above the maximum {hi:g}")
    return float(v)


def _event(index: int, raw: Any, duration_days: float) -> dict[str, Any]:
    at = f"events[{index}]"
    if not isinstance(raw, dict):
        raise ScriptError(f"{at}: expected an object, got {type(raw).__name__}")
    kind = raw.get("type")
    if kind not in _EVENT_FIELDS:
        raise ScriptError(
            f"{at}.type: {kind!r} is not one of {', '.join(sorted(_EVENT_FIELDS))}"
        )
    spec = _EVENT_FIELDS[kind]
    for key in raw:
        if key not in spec and key not in ("type", "day"):
            raise ScriptError(f"{at}.{key}: unknown field for a {kind} event")

    if "day" not in raw:
        raise ScriptError(f"{at}.day: missing")
    ev: dict[str, Any] = {"type": kind}
    ev["day"] = _number(f"{at}.day", raw["day"], 0.0, duration_days)
    for key, (lo, hi, default) in spec.items():
        if key in raw:
            ev[key] = _number(f"{at}.{key}", raw[key], lo, hi)
        elif default is None:
            raise ScriptError(f"{at}.{key}: missing (required for a {kind} event)")
        else:
            ev[key] = default

    if kind == "crack" and (ev["x0"], ev["y0"]) == (ev["x1"], ev["y1"]):
        raise ScriptError(f"{at}.x1: a crack needs two different end points")
    return ev


def parse_script(raw: Any) -> Script:
    """Validate a decoded script and return it with its events sorted by day."""
    if not isinstance(raw, dict):
        raise ScriptError(f"script: expected an object, got {type(raw).__name__}")
    for key in raw:
        if key not in ("name", "seed", "base_iso_time", "duration_days", "tick_seconds", "events"):
            raise ScriptError(f"{key}: unknown field")

    name = raw.get("name")
    if not isinstance(name, str) or not _NAME_RE.match(name):
        raise ScriptError(f"name: {name!r} must be lowercase letters, digits, '_' or '-'")

    seed = raw.get("seed")
    if not isinstance(seed, int) or isinstance(seed, bool):
        raise ScriptError(f"seed: expected an integer, got {seed!r}")

    base = raw.get("base_iso_time")
    if not isinstance(base, str):
        raise ScriptError(f"base_iso_time: expected an ISO-8601 string, got {base!r}")
    try:
        parsed = datetime.fromisoformat(base.replace("Z", "+00:00"))
    except ValueError:
        raise ScriptError(f"base_iso_time: {base!r} is not an ISO-8601 time") from None
    if parsed.tzinfo is None:
        raise ScriptError(f"base_iso_time: {base!r} needs a time zone (use a trailing Z)")

    duration = _number("duration_days", raw.get("duration_days"), 1.0, MAX_DURATION_DAYS)
    tick = _number(
        "tick_seconds", raw.get("tick_seconds", DEFAULT_TICK_SECONDS),
        MIN_TICK_SECONDS, MAX_TICK_SECONDS,
    )

    events_raw = raw.get("events")
    if not isinstance(events_raw, list):
        raise ScriptError(f"events: expected a list, got {events_raw!r}")
    events = [_event(i, e, duration) for i, e in enumerate(events_raw)]
    events.sort(key=lambda e: e["day"])  # stable: equal days keep file order

    return Script(name, seed, base, duration, tick, tuple(events))


def available_scripts() -> list[str]:
    """Names of the scripts in the scenarios directory."""
    return sorted(p.stem for p in SCENARIO_DIR.glob("*.json"))


def load_script(name_or_path: str | Path) -> Script:
    """Load a script by scenario name (``default_demo``) or by path to a .json file."""
    text = str(name_or_path)
    if _NAME_RE.match(text):
        path = SCENARIO_DIR / f"{text}.json"
    else:
        path = Path(text)
    if not path.is_file():
        raise ScriptError(
            f"script {text!r} not found (scenarios: {', '.join(available_scripts()) or 'none'})"
        )
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ScriptError(f"{path.name}: not valid JSON ({e})") from None
    return parse_script(raw)
