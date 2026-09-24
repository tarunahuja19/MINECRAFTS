"""Zones: named slices of the district you can pick an event in (P1, 17 Sep 2026).

Adarsh's requirement, session 26: "first select the zone with 1 to 10 or full and then do it".
A zone is a menu entry, not a pixel, so a scenario can be re-run and quoted without anyone having to
remember a click coordinate.

WHY A ZONE IS A WEIGHT AND NOT A BOOLEAN
----------------------------------------
The obvious implementation is a rectangle test: extra subsidence inside the zone, zero outside. That
is wrong, and wrong in a way that looks convincing on screen.

Everything downstream of a scenario surface takes derivatives of it — tilt is the first, curvature
the second, and horizontal strain is B x curvature. A boolean mask leaves a vertical step at the zone
boundary, so those derivatives see a cliff:

    surface step  ->  tilt spike  ->  curvature spike (worse)  ->  strain far past 3000 ue

3000 ue is the ground's cracking threshold (minesim.cracks, assumptions.yaml cracks:). So a boolean
zone mask draws a crack around the outline of whichever zone you picked - a tidy rectangle of
cracking that is an artefact of the menu control and not of the ground at all.

So the zone is a raised-cosine weight in [0, 1]: 1 inside, fading to 0 over `boundary_fade_m` outside,
built from the same `taper` the events already use for the same reason. The default fade is the
influence radius r, the distance over which real subsidence effects die away anyway.

tests/gates/test_l8.py::test_hard_zone_mask_would_fake_a_crack builds both and measures the
difference, so this docstring is evidence rather than an assurance.

Nothing here writes to the snapshot, to the run directory, or to the world grid.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import yaml

from lab.config import CONFIG_DIR
from lab.events.base import taper


@dataclass(frozen=True)
class ZoneConfig:
    n_zones: int
    axis: str
    boundary_fade_m: Optional[float]   # None -> fall back to the mine's influence radius r
    full_zone_id: str


@dataclass(frozen=True)
class Zone:
    """One selectable area. `index` is 1..n for a numbered zone and None for the whole district."""
    id: str
    index: Optional[int]
    x0_m: float
    x1_m: float
    y0_m: float
    y1_m: float
    label: str

    @property
    def centre_m(self) -> Tuple[float, float]:
        return (0.5 * (self.x0_m + self.x1_m), 0.5 * (self.y0_m + self.y1_m))

    @property
    def is_full(self) -> bool:
        return self.index is None

    def as_dict(self) -> Dict[str, Any]:
        """Wire form for /api/zones — plain types only, metres, no numpy."""
        cx, cy = self.centre_m
        return {"id": self.id, "index": self.index, "label": self.label,
                "x0_m": self.x0_m, "x1_m": self.x1_m, "y0_m": self.y0_m, "y1_m": self.y1_m,
                "centre_x_m": cx, "centre_y_m": cy}


def load_zone_config(path: Optional[Path] = None) -> ZoneConfig:
    """Read config/zones.yaml. A missing or unknown key is an error, never a silent default."""
    path = Path(path) if path is not None else CONFIG_DIR / "zones.yaml"
    raw: Dict[str, Any] = yaml.safe_load(Path(path).read_text()) or {}
    raw.pop("schema_version", None)
    names = {"n_zones", "axis", "boundary_fade_m", "full_zone_id"}
    missing, extra = names - set(raw), set(raw) - names
    if missing:
        raise ValueError(f"{path}: missing key(s) {sorted(missing)}")
    if extra:
        raise ValueError(f"{path}: unknown key(s) {sorted(extra)}")
    if int(raw["n_zones"]) < 1:
        raise ValueError(f"{path}: n_zones must be at least 1, got {raw['n_zones']}")
    if raw["axis"] != "x":
        raise ValueError(
            f"{path}: axis {raw['axis']!r} is not supported. Zones slice along x, the face advance "
            "direction, because that is the axis along which the ground is at different stages of "
            "sinking. Slicing along y would put ground in the same state into different zones.")
    fade = raw["boundary_fade_m"]
    return ZoneConfig(n_zones=int(raw["n_zones"]), axis=str(raw["axis"]),
                      boundary_fade_m=None if fade is None else float(fade),
                      full_zone_id=str(raw["full_zone_id"]))


def boundary_fade_m(cfg, zcfg: ZoneConfig) -> float:
    """The distance the zone weight fades over. Defaults to the mine's influence radius r.

    Read from the mine config rather than repeated in zones.yaml, so changing tan_beta or depth moves
    the fade with it instead of leaving a stale number behind.
    """
    return cfg.r if zcfg.boundary_fade_m is None else zcfg.boundary_fade_m


def zones_for(cfg, grid, zcfg: Optional[ZoneConfig] = None) -> List[Zone]:
    """Every selectable zone: the numbered slices of the panel, then the whole district.

    Numbered zones slice the panel along x into `n_zones` equal lengths and span the full district
    width, so a district with several panels (y_offsets_m) needs no special case. The `full` zone is
    the whole grid, which is wider than the panel because the trough spreads past the ribs.
    """
    zcfg = zcfg or load_zone_config()
    length = cfg.panel.length_m
    step = length / zcfg.n_zones
    half_w = cfg.panel.district_half_width_m

    out: List[Zone] = []
    for k in range(1, zcfg.n_zones + 1):
        x0 = (k - 1) * step
        x1 = k * step
        out.append(Zone(
            id=str(k), index=k, x0_m=x0, x1_m=x1, y0_m=-half_w, y1_m=half_w,
            label=f"Zone {k} — {x0:.0f} to {x1:.0f} m along the panel"))

    nx, ny = grid.shape
    out.append(Zone(
        id=zcfg.full_zone_id, index=None,
        x0_m=grid.origin_x_m, x1_m=grid.origin_x_m + nx * grid.cell_m,
        y0_m=grid.origin_y_m, y1_m=grid.origin_y_m + ny * grid.cell_m,
        label="Full district"))
    return out


def zone_by_id(zone_id: str, cfg, grid, zcfg: Optional[ZoneConfig] = None) -> Zone:
    """Look a zone up by its id. An unknown id is refused with the list of valid ones."""
    zones = zones_for(cfg, grid, zcfg)
    wanted = str(zone_id)
    for z in zones:
        if z.id == wanted:
            return z
    raise ValueError(f"unknown zone {zone_id!r}; pick one of {[z.id for z in zones]}")


def distance_to_zone_m(zone: Zone, X: np.ndarray, Y: np.ndarray) -> np.ndarray:
    """Shortest distance from each cell centre to the zone rectangle; 0 for cells inside it."""
    dx = np.maximum(np.maximum(zone.x0_m - X, X - zone.x1_m), 0.0)
    dy = np.maximum(np.maximum(zone.y0_m - Y, Y - zone.y1_m), 0.0)
    return np.hypot(dx, dy)


def zone_weight(zone: Zone, grid, fade_m: float) -> np.ndarray:
    """Weight in [0, 1] over the grid: 1 inside the zone, raised cosine to 0 over `fade_m` outside.

    Multiply a scenario's `ds` by this to confine it to the selected zone. It is deliberately not a
    boolean - see the module docstring, and gate L8-4, which measures what a boolean would do.
    """
    X, Y = grid.centres()
    return taper(distance_to_zone_m(zone, X, Y), 0.0, fade_m)


def resolve_click(zone: Zone, x0_m: Optional[float] = None, y0_m: Optional[float] = None
                  ) -> Tuple[float, float]:
    """Where in the zone the event happens: the given click, or the zone centre when none is given.

    Adarsh's flow is "pick zone 1..10 or full, then do it", so a zone on its own has to be enough to
    run a scenario. A click is still allowed for a specific spot, and must be inside the zone it
    claims - a click outside is refused rather than snapped, because a snapped click would quietly
    answer a different question from the one asked.
    """
    if x0_m is None and y0_m is None:
        return zone.centre_m
    if x0_m is None or y0_m is None:
        raise ValueError("give both x_m and y_m, or neither (which uses the zone centre)")
    x, y = float(x0_m), float(y0_m)
    if not (zone.x0_m <= x <= zone.x1_m and zone.y0_m <= y <= zone.y1_m):
        raise ValueError(
            f"click ({x:.0f}, {y:.0f}) m is outside zone {zone.id} "
            f"(x {zone.x0_m:.0f}..{zone.x1_m:.0f}, y {zone.y0_m:.0f}..{zone.y1_m:.0f} m)")
    return x, y


def confine_to_zone(result, zone: Zone, snap, zcfg: Optional[ZoneConfig] = None):
    """Restrict an event's extra subsidence to `zone`, fading at its boundary. Returns a new result.

    One shared place, so every event gets the same behaviour and the taper cannot be forgotten in a
    new one. The full-district zone covers the whole grid, so its weight is all ones and this is a
    no-op for it.

    If confining leaves nothing above min_effect_mm, the event becomes "not possible" with a reason
    naming the zone - rather than returning a near-zero surface, which reads as "it happened, barely"
    when the truth is "not here".
    """
    if result.ds_mm is None or not result.possible:
        return dataclasses.replace(result, zone_id=zone.id)

    zcfg = zcfg or load_zone_config()
    w = zone_weight(zone, snap.grid, boundary_fade_m(snap.cfg, zcfg))
    ds = (np.asarray(result.ds_mm, dtype=np.float64) * w).astype(np.float32)

    peak = float(np.max(ds)) if ds.size else 0.0
    if peak < snap.lab.min_effect_mm:
        return dataclasses.replace(
            result, possible=False, ds_mm=None, zone_id=zone.id,
            reason=(f"nothing happens inside {zone.label.lower()}: the most this event moves the "
                    f"ground there is {peak:.1f} mm, below the {snap.lab.min_effect_mm:.0f} mm we "
                    f"can call a change"))
    return dataclasses.replace(result, ds_mm=ds, zone_id=zone.id)


def hard_zone_mask(zone: Zone, grid) -> np.ndarray:
    """The boolean mask a zone must NOT use, as a float field. Exists only so gate L8-4 can measure
    the fake cracking it causes; nothing in the scenario path may call it."""
    X, Y = grid.centres()
    return (distance_to_zone_m(zone, X, Y) <= 0).astype(np.float64)
