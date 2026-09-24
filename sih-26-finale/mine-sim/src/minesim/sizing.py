"""Sizing algorithm and network layout - WP2 (v1 cut).

Node count is an OUTPUT of this module (Invariant 5). `size_network` takes exactly one
argument, the config. Every number comes from config or from derived quantities.

Layout (travelling cross, v1):
- The cross sits on the survey line (pinning.survey_line_x_m) when the mine has one, so
  Scouts stand on survey monuments and can carry real / pinned values; otherwise it is
  centred on the panel mid-length. Either way the face passes under it inside a standard run.
- With a survey line, each transverse Scout moves to its nearest monument when that monument
  is within half the monument pitch.
- Transverse line: along y, spanning the deformation extent (width + 2r).
- Longitudinal line: along x, spanning the travelling window (r + settling tail).
- Both lines use `layout.spacing_m` and are laid out symmetrically from the crossing,
  so the crossing node is shared and counted once.

v1 cut: no Fresnel link check / relaxation loop (flat terrain passes trivially).
"""

from dataclasses import dataclass
import math
from typing import Dict, List, Literal, Optional, Tuple

import numpy as np

from minesim import physics
from minesim.config import SECONDS_PER_DAY, Config
from minesim.errors import ContractViolation
from minesim.provenance import load_monuments

GATEWAY_ID = 0
FIRST_ANCHOR_ID = 1
FIRST_SCOUT_ID = 100        # the floor scout IDs start at, not a ceiling on the anchors below it


def first_scout_id(anchor_count: int) -> int:
    """Where the Scout IDs begin, given how many Anchors the arithmetic asked for.

    Anchors occupy FIRST_ANCHOR_ID .. FIRST_ANCHOR_ID + anchor_count - 1, so Scouts start after
    them. FIRST_SCOUT_ID is a floor, kept so a mine that needs fewer than 99 Anchors numbers its
    Scouts from 100 exactly as before; a mine that needs more simply pushes the Scouts up. There is
    no upper bound on anchor_count: the count is whatever ceil(scouts / fan-out) comes to."""
    return max(FIRST_SCOUT_ID, FIRST_ANCHOR_ID + anchor_count)

TIER_ORDER = ("1A", "1B", "1C")     # low -> high strain band
COST_KEYS = {"1A": "tier_1a", "1B": "tier_1b", "1C": "tier_1c", "anchor": "anchor", "gateway": "gateway"}


@dataclass(frozen=True)
class Node:
    node_id: int
    x_m: float
    y_m: float
    z0_mm: float              # static t=0 reference baseline ONLY (G13)
    tier: Literal["1A", "1B", "1C", "anchor", "gateway"]
    parent_id: Optional[int]
    backup_parent_id: Optional[int]
    child_index: Optional[int]   # 0..7 within parent — drives emergency sub-slot (G10)
    line: Literal["transverse", "longitudinal", "crossing", "backbone"]


@dataclass(frozen=True)
class CostBreakdown:
    per_tier: Dict[str, Tuple[int, int, int]]   # tier -> (qty, unit_inr, subtotal_inr)
    total_inr: int


@dataclass(frozen=True)
class Layout:
    nodes: Tuple[Node, ...]
    cost: CostBreakdown
    spacing_m: float
    relaxation_steps: Tuple[str, ...]   # audit trail of why spacing moved, if it did


def _line_offsets(length_m: float, spacing_m: float) -> np.ndarray:
    """Offsets from the crossing, symmetric, covering at least `length_m` in total."""
    half_count = math.ceil((length_m / 2.0) / spacing_m)
    return np.arange(-half_count, half_count + 1) * spacing_m


def _cross_x(cfg: Config) -> float:
    return cfg.survey_line_x_m if cfg.survey_line_x_m is not None else cfg.panel.length_m / 2.0


def _snap_to_monument(cfg: Config, y: float) -> float:
    """Nearest survey monument within half the monument pitch, else y unchanged."""
    if cfg.survey_line_x_m is None:
        return y
    offsets = load_monuments(str(cfg.profiles_csv), cfg.survey_line_x_m, cfg.survey_origin_offset_m).offsets_y_m
    if len(offsets) < 2:
        return y
    pitch = float(np.median(np.diff(offsets)))
    nearest = min(offsets, key=lambda d: abs(d - y))
    return nearest if abs(nearest - y) <= pitch / 2.0 else y


def _scout_positions(cfg: Config) -> List[Tuple[float, float, str]]:
    x_c = _cross_x(cfg)
    y_c = _snap_to_monument(cfg, 0.0)
    positions: List[Tuple[float, float, str]] = []
    for dy in _line_offsets(cfg.extent, cfg.layout.spacing_m):
        y = y_c if dy == 0 else _snap_to_monument(cfg, float(dy))
        positions.append((x_c, y, "crossing" if dy == 0 else "transverse"))
    for dx in _line_offsets(cfg.window, cfg.layout.spacing_m):
        if dx != 0:
            positions.append((x_c + float(dx), y_c, "longitudinal"))
    return positions


def _peak_gradients(cfg: Config, xs: np.ndarray, ys: np.ndarray,
                    along_x: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Peak |horizontal strain| (over A8) along each position's rod axis, and peak |tilt|, over the run.

    A rod or wire measures along its survey line only (longitudinal -> x, transverse -> y), so the
    tier decision uses that axis; the other axis is a strain no sensor at that node would see."""
    days = np.arange(0.0, cfg.sim.duration_days + 1.0)
    peak_strain = np.zeros_like(xs)
    peak_tilt = np.zeros_like(xs)
    b = cfg.sensing.strain_rod_baseline_m
    for t in days:
        ex = physics.strain(xs, ys, t, cfg.panel, cfg.knothe, b, "x")
        ey = physics.strain(xs, ys, t, cfg.panel, cfg.knothe, b, "y")
        tx, ty = physics.tilt(xs, ys, t, cfg.panel, cfg.knothe)
        peak_strain = np.maximum(peak_strain, np.abs(np.where(along_x, ex, ey)))
        peak_tilt = np.maximum(peak_tilt, np.hypot(tx, ty))
    return peak_strain, peak_tilt


def _natural_breaks(values: np.ndarray, classes: int) -> np.ndarray:
    """Class per value (0 = lowest) from the optimal 1-D split (Fisher-Jenks: least within-class
    squared deviation). Breaks fall in the widest natural gaps and only between distinct values,
    so nodes whose peaks are (near-)identical are never split across a class boundary."""
    order = np.argsort(values, kind="stable")
    v = np.asarray(values, dtype=float)[order]
    n = len(v)
    k = min(classes, len(np.unique(v)))
    csum = np.concatenate(([0.0], np.cumsum(v)))
    csq = np.concatenate(([0.0], np.cumsum(v * v)))

    def sse(i: int, j: int) -> float:
        return csq[j] - csq[i] - (csum[j] - csum[i]) ** 2 / (j - i)

    cuts = [i for i in range(1, n) if v[i] != v[i - 1]]
    best = {(1, j): (sse(0, j), 0) for j in range(1, n + 1)}
    for c in range(2, k + 1):
        for j in range(c, n + 1):
            options = [(best[(c - 1, i)][0] + sse(i, j), i) for i in cuts if i < j and (c - 1, i) in best]
            if options:
                best[(c, j)] = min(options)
    labels_sorted = np.zeros(n, dtype=int)
    j, c = n, k
    while c > 1:
        i = best[(c, j)][1]
        labels_sorted[i:j] = c - 1
        j, c = i, c - 1
    labels = np.empty(n, dtype=int)
    labels[order] = labels_sorted
    return labels


def _tilt_detectable(cfg: Config, peak_tilt: float) -> bool:
    """Can a tilt-only node see this tilt? The temperature term is a full-period sine, so it cancels
    in a mean over one temperature period; what is left is noise / sqrt(readings per period)."""
    s = cfg.sensors
    readings = max(1.0, s.temperature_period_days * SECONDS_PER_DAY / cfg.sim.timestep_s)
    floor = s.tilt_1a.noise_sigma / math.sqrt(readings)
    return peak_tilt >= cfg.layout.tilt_detection_snr * floor


def _assign_tiers(cfg: Config, peak_strain: np.ndarray, peak_tilt: np.ndarray) -> List[str]:
    """Three natural strain bands: highest -> 1C (extensometer), middle -> 1B (rod + pot),
    lowest -> 1A (tilt only) where that tilt is detectable, else 1B (the rod still sees strain)."""
    band = _natural_breaks(peak_strain, len(TIER_ORDER))
    top = band.max()
    tiers = []
    for i, b in enumerate(band):
        if b == top:
            tiers.append("1C")
        elif b == 0 and top > 1 and _tilt_detectable(cfg, peak_tilt[i]):
            tiers.append("1A")
        else:
            tiers.append("1B")
    return tiers


def size_network(cfg: Config) -> Layout:
    """Size the sensor network from config. Node count is whatever this returns.

    layout.source == "plan" (F4): the Layout is the v3 planned network (minesim.placement) — same
    tiers, IDs, parents, backups, child_index and positions as node_plan.json. "v1": the travelling cross.
    """
    if cfg.layout.source == "plan":
        return _layout_from_plan(cfg)
    spacing = cfg.layout.spacing_m
    max_children = cfg.layout.max_children_per_anchor
    positions = _scout_positions(cfg)
    xs = np.array([p[0] for p in positions])
    ys = np.array([p[1] for p in positions])
    along_x = np.array([p[2] == "longitudinal" for p in positions])
    peak_strain, peak_tilt = _peak_gradients(cfg, xs, ys, along_x)
    tiers = _assign_tiers(cfg, peak_strain, peak_tilt)

    # Group scouts per line (transverse incl. crossing, longitudinal) in order along the line,
    # then split each group into the fewest chunks that respect max_children.
    transverse = sorted([i for i, p in enumerate(positions) if p[2] != "longitudinal"], key=lambda i: ys[i])
    longitudinal = sorted([i for i, p in enumerate(positions) if p[2] == "longitudinal"], key=lambda i: xs[i])
    chunks: List[List[int]] = []
    for group in (transverse, longitudinal):
        if group:
            n = math.ceil(len(group) / max_children)
            chunks.extend([list(c) for c in np.array_split(group, n)])
    if len(chunks) < 2:  # every Scout needs a backup parent different from its primary
        chunks = [list(c) for c in np.array_split(transverse + longitudinal, 2)]
    anchor_count = len(chunks)
    # No ceiling on anchor_count: it is ceil(scouts / max_children) and nothing truncates it. The IDs
    # follow the count rather than the count being cut to fit a fixed range.

    anchor_xy: List[Tuple[float, float]] = []
    for c in chunks:
        if c:
            anchor_xy.append((float(np.mean(xs[c])), float(np.mean(ys[c]))))
        else:  # empty backup chunk: sit beside the crossing
            anchor_xy.append((_cross_x(cfg) + spacing, spacing))
    anchor_ids = [FIRST_ANCHOR_ID + k for k in range(anchor_count)]

    nodes: List[Node] = []
    gateway_y = cfg.extent / 2.0 + spacing  # outside the deformation extent, so it does not sink
    nodes.append(Node(GATEWAY_ID, _cross_x(cfg), gateway_y, 0.0, "gateway", None, None, None, "backbone"))
    for k, (ax, ay) in enumerate(anchor_xy):
        nodes.append(Node(anchor_ids[k], ax, ay, 0.0, "anchor", GATEWAY_ID, None, None, "backbone"))

    next_scout = first_scout_id(anchor_count)
    scout_nodes: Dict[int, Node] = {}
    for k, c in enumerate(chunks):
        for child_index, i in enumerate(c):
            others = [j for j in range(anchor_count) if j != k]
            backup_k = min(others, key=lambda j: (math.dist((xs[i], ys[i]), anchor_xy[j]), j))
            scout_nodes[i] = Node(
                node_id=0, x_m=float(xs[i]), y_m=float(ys[i]), z0_mm=0.0, tier=tiers[i],
                parent_id=anchor_ids[k], backup_parent_id=anchor_ids[backup_k],
                child_index=child_index, line=positions[i][2],
            )
    for i in transverse + longitudinal:  # stable IDs: transverse by y, then longitudinal by x
        n = scout_nodes[i]
        nodes.append(Node(next_scout, n.x_m, n.y_m, n.z0_mm, n.tier, n.parent_id,
                          n.backup_parent_id, n.child_index, n.line))
        next_scout += 1

    per_tier: Dict[str, Tuple[int, int, int]] = {}
    for tier in ("gateway", "anchor", "1A", "1B", "1C"):
        qty = sum(1 for n in nodes if n.tier == tier)
        if qty:
            unit = int(cfg.cost.unit_inr[COST_KEYS[tier]])
            per_tier[tier] = (qty, unit, qty * unit)
    cost = CostBreakdown(per_tier=per_tier, total_inr=sum(v[2] for v in per_tier.values()))

    return Layout(
        nodes=tuple(nodes),
        cost=cost,
        spacing_m=spacing,
        relaxation_steps=(),  # v3: Fresnel relaxation
    )


_PLAN_CACHE: Dict[str, "Layout"] = {}


def _layout_from_plan(cfg: Config) -> Layout:
    from minesim.placement import plan_config_from, plan_network   # placement imports sizing
    if cfg.layout.placement is None:
        raise ContractViolation("layout.source is plan but the config has no placement section")
    # plan_network is deterministic in the config and the DEM file, so one plan per distinct input.
    dem = (cfg.layout.site or {}).get("dem_npz")
    dem_stamp = (lambda st: (st.st_size, st.st_mtime_ns))(dem.stat()) if dem is not None and dem.is_file() else None
    key = repr((cfg, dem_stamp))
    if key in _PLAN_CACHE:
        return _PLAN_CACHE[key]
    plan = plan_network(cfg, plan_config_from(cfg.layout.placement, cfg.layout.site))
    nodes = tuple(
        Node(node_id=n.node_id, x_m=n.x_m, y_m=n.y_m, z0_mm=0.0, tier=n.tier, parent_id=n.parent_id,
             backup_parent_id=n.backup_parent_id, child_index=n.child_index,
             line="backbone" if n.tier in ("anchor", "gateway") else ("crossing" if n.zone == "survey_line" else "transverse"))
        for n in plan.nodes
    )
    per_tier = {t: tuple(v) for t, v in plan.cost_inr["per_tier"].items()}
    layout = Layout(
        nodes=nodes,
        cost=CostBreakdown(per_tier=per_tier, total_inr=int(plan.cost_inr["total"])),
        spacing_m=float(cfg.layout.placement["min_node_spacing_m"]),
        relaxation_steps=("layout from placement.plan_network (layout.source: plan)",),
    )
    _PLAN_CACHE[key] = layout
    return layout
