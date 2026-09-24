"""What is built on the ground: loading it, placing it, and asking the grid about it (P2, WP9 §6).

A scenario answered in strain is unreadable. "House H1: slight -> severe" is the answer people can
check, argue with, and act on, and this module is what turns one into the other.

Two rules here are not style:

  * COORDINATES ARE IN THE PANEL FRAME and transformed once, at load, against the current mine config
    (hazard H8). objects.yaml was written for a single panel; the simulator now superposes several
    (panel.y_offsets_m), so a village pinned to world coordinates would sit over the wrong panel the
    moment a district gains one.
  * AN OBJECT OUTSIDE THE GRID IS AN ERROR, never clamped to the edge (WP9 §6). A clamped house
    quietly answers a question about ground the user did not ask about, and it answers it with a
    damage grade, which is exactly the kind of wrong number that gets believed.

Nothing here reads or writes the run. It reads config/objects.yaml and a Grid, and that is all.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import yaml

from lab.config import CONFIG_DIR
from lab.sampling import footprint_points, grid_bounds_m, polyline_points

POINT_TYPES = ("house", "pole")
LINE_TYPES = ("road",)


@dataclass(frozen=True)
class MineObject:
    """One thing on the surface, already transformed into world coordinates."""
    id: str
    type: str
    label: str
    x_m: Optional[float]                       # point objects (house, pole)
    y_m: Optional[float]
    line: Optional[Tuple[Tuple[float, float], ...]]   # line objects (road)
    width_m: Optional[float]                   # house frontage / road width - the NCB gauge length
    depth_m: Optional[float]
    height_m: Optional[float]                  # poles and towers
    material: Optional[str]
    structure_class: str                       # DGMS limit class: domestic | industrial
    layout_note: str                           # the "illustrative" label, carried into every answer

    def as_dict(self) -> Dict[str, Any]:
        """Wire form for /api/objects — plain types only, metres, no numpy."""
        out: Dict[str, Any] = {"id": self.id, "type": self.type, "label": self.label,
                               "structure_class": self.structure_class, "layout": self.layout_note}
        if self.x_m is not None:
            out["x_m"], out["y_m"] = self.x_m, self.y_m
        if self.line is not None:
            out["line"] = [[x, y] for x, y in self.line]
        for name in ("width_m", "depth_m", "height_m", "material"):
            value = getattr(self, name)
            if value is not None:
                out[name] = value
        return out

    def sample_points(self, spacing_m: float) -> Tuple[np.ndarray, np.ndarray]:
        """Where on the ground this object is asked about: its footprint, or along its line."""
        if self.line is not None:
            return polyline_points(self.line, spacing_m)
        return footprint_points(self.x_m, self.y_m, self.width_m or spacing_m,
                                self.depth_m or spacing_m, spacing_m)


def _panel_y_offset_m(cfg, panel_index: int, object_id: str) -> float:
    """The y shift of panel `panel_index` (1-based) in the current mine config."""
    offsets = tuple(cfg.panel.y_offsets_m)
    if panel_index < 1 or panel_index > len(offsets):
        raise ValueError(
            f"object {object_id!r} says panel {panel_index}, but this mine has {len(offsets)} "
            f"panel(s). Objects are declared in the panel frame; re-check objects.yaml after any "
            f"change to n_panels or y_offsets_m.")
    return float(offsets[panel_index - 1])


def load_objects(cfg, grid, path: Optional[Path] = None) -> List[MineObject]:
    """Read config/objects.yaml, transform into world coordinates, and check every one is on the grid."""
    path = Path(path) if path is not None else CONFIG_DIR / "objects.yaml"
    raw: Dict[str, Any] = yaml.safe_load(Path(path).read_text()) or {}
    layout = str(raw.get("layout") or "")
    if not layout:
        raise ValueError(f"{path}: needs a `layout:` line saying whether this is a real surveyed "
                         "layout — every sentence the lab prints about an object inherits it")
    defaults = raw.get("defaults") or {}
    entries = raw.get("objects") or []
    if not entries:
        raise ValueError(f"{path}: declares no objects")

    x_min, x_max, y_min, y_max = grid_bounds_m(grid)
    out: List[MineObject] = []
    seen = set()
    for entry in entries:
        obj_id = str(entry["id"])
        if obj_id in seen:
            raise ValueError(f"{path}: object id {obj_id!r} appears twice")
        seen.add(obj_id)
        kind = str(entry["type"])
        if kind not in POINT_TYPES + LINE_TYPES:
            raise ValueError(f"{path}: object {obj_id!r} has unknown type {kind!r}; "
                             f"known: {sorted(POINT_TYPES + LINE_TYPES)}")
        d = dict(defaults.get(kind) or {})
        d.update({k: v for k, v in entry.items() if k not in ("id", "type", "panel")})
        dy = _panel_y_offset_m(cfg, int(entry.get("panel", 1)), obj_id)

        line = d.pop("line", None)
        if (kind in LINE_TYPES) != (line is not None):
            raise ValueError(f"{path}: object {obj_id!r} of type {kind!r} "
                             f"{'needs' if kind in LINE_TYPES else 'must not have'} a `line:`")
        obj = MineObject(
            id=obj_id, type=kind,
            label=str(d.pop("label", None) or f"{kind.capitalize()} {obj_id}"),
            x_m=None if line is not None else float(d["x_m"]),
            y_m=None if line is not None else float(d["y_m"]) + dy,
            line=None if line is None else tuple((float(x), float(y) + dy) for x, y in line),
            width_m=None if d.get("width_m") is None else float(d["width_m"]),
            depth_m=None if d.get("depth_m") is None else float(d["depth_m"]),
            height_m=None if d.get("height_m") is None else float(d["height_m"]),
            material=None if d.get("material") is None else str(d["material"]),
            structure_class=str(d.get("structure_class") or "domestic"),
            layout_note=layout)

        xs, ys = obj.sample_points(grid.cell_m)
        off = (xs < x_min) | (xs > x_max) | (ys < y_min) | (ys > y_max)
        if bool(np.any(off)):
            raise ValueError(
                f"{path}: object {obj_id!r} falls outside the run's grid "
                f"(x {x_min:.0f}..{x_max:.0f} m, y {y_min:.0f}..{y_max:.0f} m). WP9 §6: this is an "
                f"error, not something to clamp — move the object inside the grid, or run a mine "
                f"whose grid covers it, and record which you did.")
        out.append(obj)
    return out


def objects_or_none(cfg, grid, path: Optional[Path] = None) -> List[MineObject]:
    """load_objects, but an empty list when there is no objects.yaml at all.

    A mine with nothing built on it is a legitimate answer ("nothing up there to damage"); a broken
    objects.yaml is not, and still raises.
    """
    path = Path(path) if path is not None else CONFIG_DIR / "objects.yaml"
    return load_objects(cfg, grid, path) if Path(path).is_file() else []
