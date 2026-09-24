"""Lab configuration (WP9 §3): every number comes from config/*.yaml with a source: string.

Gate L4 scans lab/**/*.py and allows only the literals 0, 1, 2, 0.5, -1, 1000 (m<->mm) and 86400
(s/day). Anything physical or chosen belongs in a yaml file next to a source, not in the code.
"""

from __future__ import annotations

from dataclasses import dataclass, fields as dataclass_fields
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import yaml

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
EVENTS_DIR = CONFIG_DIR / "events"


@dataclass(frozen=True)
class LabConfig:
    settled_time_coefficient_per_day: float
    min_effect_mm: float
    world_model_tolerance_mm: float
    display_cell_m: float
    spread_min_weight: float
    store_dir: str
    port: int
    id_hash_chars: int
    test_forecast_band_fraction: float
    test_forecast_band_min_mm: float
    road_crack_search_m: float
    max_crack_segments: int
    crack_segment_min_width_mm: float
    ppv_contour_levels_mm_s: Tuple[float, ...]
    preview_rows: int
    m_per_deg_lat: float


def load_lab_config(path: Optional[Path] = None) -> LabConfig:
    """Read config/lab.yaml. A missing or extra key is an error, not a silent default."""
    path = Path(path) if path is not None else CONFIG_DIR / "lab.yaml"
    raw: Dict[str, Any] = yaml.safe_load(Path(path).read_text()) or {}
    raw.pop("schema_version", None)
    names = {f.name for f in dataclass_fields(LabConfig)}
    missing, extra = names - set(raw), set(raw) - names
    if missing:
        raise ValueError(f"{path}: missing key(s) {sorted(missing)}")
    if extra:
        raise ValueError(f"{path}: unknown key(s) {sorted(extra)}")
    types = {f.name: f.type for f in dataclass_fields(LabConfig)}
    cast = {"float": float, "int": int, "str": str,
            "Tuple[float, ...]": lambda v: tuple(float(x) for x in v)}
    return LabConfig(**{k: cast[types[k]](v) for k, v in raw.items()})


def load_event_spec(name: str, path: Optional[Path] = None) -> Dict[str, Any]:
    """Read one config/events/<name>.yaml.

    Shape: `inputs` maps a user parameter to {default, min, max, unit, source}; any other top-level key
    is a fixed model constant and must also carry a source. Both are checked here so a missing source
    fails at load time rather than turning up in a scenario result that claims to be traceable.
    """
    path = Path(path) if path is not None else EVENTS_DIR / f"{name}.yaml"
    spec: Dict[str, Any] = yaml.safe_load(Path(path).read_text()) or {}
    for key, entry in (spec.get("inputs") or {}).items():
        for field in ("default", "min", "max", "unit", "source"):
            if field not in entry:
                raise ValueError(f"{path}: input {key!r} has no {field!r}")
    for key, entry in (spec.get("constants") or {}).items():
        if not isinstance(entry, dict) or "value" not in entry or "source" not in entry:
            raise ValueError(f"{path}: constant {key!r} needs a value and a source")
    return spec


def constant(spec: Dict[str, Any], name: str) -> Any:
    return spec["constants"][name]["value"]


def used(spec: Dict[str, Any], name: str, value: Any) -> Dict[str, Any]:
    """One entry for EventResult.params_used: what was used, its unit and where it came from."""
    entry = (spec.get("inputs") or {}).get(name) or spec["constants"][name]
    return {"value": value, "unit": entry.get("unit"), "source": entry["source"]}


def resolve_inputs(spec: Dict[str, Any], params: Dict[str, Any]) -> Dict[str, float]:
    """Fill defaults, reject unknown names, and range-check. Out of range is refused, not clamped."""
    inputs = spec.get("inputs") or {}
    unknown = set(params) - set(inputs)
    if unknown:
        raise ValueError(f"unknown parameter(s) {sorted(unknown)}; expected {sorted(inputs)}")
    out = {}
    for name, entry in inputs.items():
        value = float(params.get(name, entry["default"]))
        if value < float(entry["min"]) or value > float(entry["max"]):
            raise ValueError(
                f"{name} = {value} {entry['unit']} is outside {entry['min']}..{entry['max']} {entry['unit']}")
        out[name] = value
    return out
