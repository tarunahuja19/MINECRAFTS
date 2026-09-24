"""Single serialization boundary for Scenario Lab (WP9 §3, Prompt 2 Sitting B).

Everything the lab ever sends out (REST today, files tomorrow) passes through wire.py.
It takes the raw dict from lab.consequence.evaluate() plus the Snapshot/Zone/EventResult
context, and returns PLAIN JSON-safe types only (no numpy scalars, arrays become lists).

- Flip signed vertical-displacement fields from positive-down (lab convention) to
  NEGATIVE-DOWN (wire convention) EXACTLY ONCE.
- Stamp every payload: kind ("scenario"), schema_version, run_id, mine, frozen_day,
  zone/segment id, event name, params_used, and label "SCENARIO (HYPOTHETICAL)".
- Crack segments keep the shape consequence.py already emits
  (x0_m/y0_m/x1_m/y1_m/bearing_deg/width_mm/new); wire only converts types and flips
  the sign of signed fields — it never recomputes.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Union

import numpy as np

KIND = "scenario"
SCHEMA_VERSION = 1
LABEL = "SCENARIO (HYPOTHETICAL)"


def _sanitize(val: Any) -> Any:
    """Convert numpy types, tuples, etc. to plain JSON-serializable Python types."""
    if isinstance(val, (np.floating, float)):
        return float(val)
    if isinstance(val, (np.integer, int)):
        return int(val)
    if isinstance(val, (np.bool_, bool)):
        return bool(val)
    if isinstance(val, np.ndarray):
        return [_sanitize(x) for x in val.tolist()]
    if isinstance(val, dict):
        return {str(k): _sanitize(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)):
        return [_sanitize(x) for x in val]
    return val


def _flip_sign(val: Any) -> Any:
    """Flip positive-down (lab convention) to negative-down (wire convention)."""
    if val is None:
        return None
    f = float(val)
    return 0.0 if f == 0 else -f


def to_wire(
    eval_dict: Optional[Dict[str, Any]],
    snap: Any,
    zone: Any,
    result: Any,
    event_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Serialize evaluate() output and context into plain JSON types with negative-down signs."""
    # Extract zone identifier
    if hasattr(zone, "id"):
        zone_id = str(zone.id)
    else:
        zone_id = str(zone)

    # Extract event name
    ev_name = event_name or getattr(result, "event_name", None) or "scenario"

    # Extract params_used
    params_used = getattr(result, "params_used", {}) or {}

    # Copy and sanitize evaluate output
    eval_clean: Dict[str, Any] = _sanitize(eval_dict) if eval_dict else {}

    cracks = eval_clean.get("cracks", {})
    objects = eval_clean.get("objects", [])
    vibration = eval_clean.get("vibration")
    summary = eval_clean.get("summary", {})

    # Flip signed vertical displacement fields
    # 1. summary
    if "max_extra_sinking_mm" in summary:
        summary["max_extra_sinking_mm"] = _flip_sign(summary["max_extra_sinking_mm"])
    if "subsidence_mm" in summary:
        summary["subsidence_mm"] = _flip_sign(summary["subsidence_mm"])

    # 2. objects
    if isinstance(objects, list):
        for obj in objects:
            if isinstance(obj, dict):
                b = obj.get("before")
                if isinstance(b, dict) and "subsidence_mm" in b:
                    b["subsidence_mm"] = _flip_sign(b["subsidence_mm"])
                a = obj.get("after")
                if isinstance(a, dict) and "subsidence_mm" in a:
                    a["subsidence_mm"] = _flip_sign(a["subsidence_mm"])

    out: Dict[str, Any] = {
        "kind": KIND,
        "schema_version": SCHEMA_VERSION,
        "label": LABEL,
        "run_id": str(getattr(snap, "run_id", "")),
        "mine": str(getattr(snap, "mine", "")),
        "frozen_day": float(getattr(snap, "day", 0.0)),
        "zone_id": zone_id,
        "segment_id": zone_id,
        "event": ev_name,
        "event_name": ev_name,
        "params_used": _sanitize(params_used),
        "possible": bool(getattr(result, "possible", True)),
        "reason": str(getattr(result, "reason", "")),
        "cracks": cracks,
        "objects": objects,
        "vibration": vibration,
        "summary": summary,
    }
    return out


# Alias so callers can use either wire(...) or to_wire(...)
wire = to_wire


def to_json(payload: Dict[str, Any]) -> str:
    """Format wire payload as JSON string."""
    return json.dumps(payload)
