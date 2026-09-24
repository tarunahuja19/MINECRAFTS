"""Node planner v3 — place the sensor network over the REAL terrain (geology first, then radio).

Keeps the v1 contract (sizing.py): tiers 1A/1B/1C/anchor/gateway, ID ranges (gateway 0, anchors
1-99, scouts 100+), capacitated parents with a distinct backup, node count is an output (Invariant 5).
What changes is WHERE nodes go:

1. Peak ground response over the run, on a planning raster over the monitoring sector (v3 default
   `full`: the whole footprint that moves during the run, -2r .. L+2r): subsidence,
   horizontal strain over the rod baseline (worst of x/y), tilt — all from physics.py (Invariant 4).
2. Monitorable ground = moves more than the detection threshold AND the real terrain is gentle
   enough to install on (DEM slope <= max_install_slope_deg). Pit walls and dump faces are excluded.
3. Tier zones = natural breaks of peak strain (same rule as v1): highest band 1C, middle 1B,
   lowest 1A where its tilt is detectable (else 1B).
4. Survey monuments on the real survey line are placed first (they carry real / pinned values),
   min_node_spacing_m apart. Then variable-radius dart-throwing (Poisson-disc, not a grid), tier by
   tier 1C -> 1B -> 1A in strain-weighted random order: each dart is jittered inside its raster cell,
   its OWN peak response decides its tier and whether it moves at all, and two scouts a, b stay
   max(spacing_by_tier[a], spacing_by_tier[b]) apart. A gap pass then gives a scout to every
   installable moving cell farther than its own band spacing from every scout.
5. Anchors: count = ceil(scouts / nominal fan-out), nominal = max_children - 1 (one slot of
   headroom for an orphan failing over). Nothing clamps that count — however many anchors the
   arithmetic asks for is how many are planned, and the Scout IDs start after them. Every anchor
   therefore keeps its spare slot on every mine.
   Balanced capacitated k-means on the scouts; cluster centres
   closer than min_anchor_spacing_m are merged and re-split once (a check, not a target). Each
   anchor is sited within min_node_spacing_m of its centre, preferring a terrain-clear Fresnel path
   to the gateway, then the lowest peak tilt. Final parents: greedy by distance with the hard
   max_children cap; backup = nearest other anchor.
6. Gateway: on ground that never moves (peak subsidence < detection threshold), gateway_standoff_m
   beyond the moving footprint, installable slope; chosen to maximise anchors with a terrain-clear
   first-Fresnel-zone line of sight, then total link margin, then elevation. Anchors and gateway are
   sited twice (anchors -> gateway -> anchors -> gateway) so each sees the other's final position.

The DEM is context only: it never feeds S(x,y,t) and never writes Z (Invariant 1).
"""

from dataclasses import dataclass, asdict
import argparse
import json
import math
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import yaml
from scipy.ndimage import distance_transform_edt

from minesim import physics
from minesim.config import Config, load_config
from minesim.errors import ContractViolation
from minesim.provenance import load_monuments
from minesim.radio import FSPL_CONSTANT_DB, SPEED_OF_LIGHT_M_S
from minesim.sizing import (COST_KEYS, FIRST_ANCHOR_ID, GATEWAY_ID, first_scout_id,
                            TIER_ORDER, _natural_breaks, _tilt_detectable)

MAX_BREAK_SAMPLES = 400        # natural breaks are O(n^2); quantiles of the zone keep the band edges
KMEANS_ITERATIONS = 20
LOS_SAMPLES = 48               # terrain samples along each radio link
GATEWAY_CANDIDATE_STRIDE = 3   # DEM cells between gateway candidates


@dataclass(frozen=True)
class PlanConfig:
    min_node_spacing_m: float
    spacing_by_tier_m: Dict[str, float]
    min_anchor_spacing_m: float
    max_anchor_offset_m: float
    sector: str
    plan_cell_m: float
    plan_every_days: float
    max_install_slope_deg: float
    gateway_standoff_m: Tuple[float, float]
    fresnel_clearance: float
    dem_npz: Optional[Path]
    panel_centre_lat_deg: Optional[float]
    panel_centre_lon_deg: Optional[float]


def load_plan_config(config_path: Path) -> PlanConfig:
    config_path = Path(config_path)
    assumptions = yaml.safe_load(config_path.read_text())
    mine_yaml = yaml.safe_load((config_path.parent / "mines" / f"{assumptions['mine']}.yaml").read_text())
    site = dict(mine_yaml.get("site") or {})
    if site.get("dem_npz"):
        site["dem_npz"] = config_path.parent.parent / site["dem_npz"]
    return plan_config_from(assumptions["placement"], site)


def plan_config_from(p: Dict, site: Optional[Dict]) -> PlanConfig:
    """PlanConfig from the placement section and a site block whose dem_npz is already a path (or absent)."""
    site = site or {}
    dem = site.get("dem_npz")
    if dem is not None and not Path(dem).is_file():
        raise FileNotFoundError(f"site.dem_npz not found: {dem} (run scripts/fetch_dem.py)")
    return PlanConfig(
        min_node_spacing_m=float(p["min_node_spacing_m"]),
        spacing_by_tier_m={t: float(p["spacing_by_tier_m"][t]) for t in TIER_ORDER},
        min_anchor_spacing_m=float(p["min_anchor_spacing_m"]),
        max_anchor_offset_m=float(p["max_anchor_offset_m"]),
        sector=str(p["sector"]),
        plan_cell_m=float(p["plan_cell_m"]),
        plan_every_days=float(p["plan_every_days"]),
        max_install_slope_deg=float(p["max_install_slope_deg"]),
        gateway_standoff_m=(float(p["gateway_standoff_m"][0]), float(p["gateway_standoff_m"][1])),
        fresnel_clearance=float(p["fresnel_clearance"]),
        dem_npz=Path(dem) if dem else None,
        panel_centre_lat_deg=site.get("panel_centre_lat_deg"),
        panel_centre_lon_deg=site.get("panel_centre_lon_deg"),
    )


# --------------------------------------------------------------------------- terrain


class Terrain:
    """Real ground elevation in panel coordinates (bilinear). Flat zero ground when no DEM is configured."""

    def __init__(self, npz: Optional[Path]) -> None:
        self.meta: Dict = {"provenance": "none", "source": "flat ground — no DEM configured for this mine"}
        self.elev = None
        if npz is not None:
            with np.load(npz) as d:
                self.elev = d["elev_m"].astype(np.float64)
                self.lat = d["lat_deg"].astype(np.float64)
                self.lon = d["lon_deg"].astype(np.float64)
                self.origin_x = float(d["origin_x_m"])
                self.origin_y = float(d["origin_y_m"])
                self.cell = float(d["cell_m"])
                self.meta = json.loads(str(d["meta_json"]))
            gx, gy = np.gradient(self.elev, self.cell)
            self.slope = np.degrees(np.arctan(np.hypot(gx, gy)))

    @property
    def available(self) -> bool:
        return self.elev is not None

    def _sample(self, grid: np.ndarray, x, y):
        nx, ny = grid.shape
        fi = np.clip((np.asarray(x, dtype=float) - self.origin_x) / self.cell, 0.0, nx - 1.0)
        fj = np.clip((np.asarray(y, dtype=float) - self.origin_y) / self.cell, 0.0, ny - 1.0)
        i0 = np.minimum(np.floor(fi).astype(int), nx - 2)
        j0 = np.minimum(np.floor(fj).astype(int), ny - 2)
        wi, wj = fi - i0, fj - j0
        return ((1 - wi) * (1 - wj) * grid[i0, j0] + wi * (1 - wj) * grid[i0 + 1, j0]
                + (1 - wi) * wj * grid[i0, j0 + 1] + wi * wj * grid[i0 + 1, j0 + 1])

    def elev_at(self, x, y):
        return self._sample(self.elev, x, y) if self.available else np.zeros(np.broadcast(x, y).shape)

    def slope_at(self, x, y):
        return self._sample(self.slope, x, y) if self.available else np.zeros(np.broadcast(x, y).shape)

    def latlon_at(self, x, y) -> Tuple[Optional[float], Optional[float]]:
        if not self.available:
            return None, None
        return float(self._sample(self.lat, x, y)), float(self._sample(self.lon, x, y))


# --------------------------------------------------------------------------- output types


@dataclass(frozen=True)
class PlanNode:
    node_id: int
    tier: str
    x_m: float
    y_m: float
    lat_deg: Optional[float]
    lon_deg: Optional[float]
    ground_m: float                 # real terrain elevation (DEM), metres AMSL; static context
    slope_deg: float
    zone: str
    reason: str
    peak_subsidence_mm: float
    peak_strain_ue: float
    peak_tilt_urad: float
    parent_id: Optional[int]
    backup_parent_id: Optional[int]
    child_index: Optional[int]
    link_m: Optional[float]
    link_margin_db: Optional[float]
    link_clear: Optional[bool]      # terrain-clear first Fresnel zone to the parent


@dataclass(frozen=True)
class NodePlan:
    nodes: Tuple[PlanNode, ...]
    sector: Dict[str, float]
    strain_band_edges_ue: Tuple[float, ...]
    counts: Dict[str, int]
    cost_inr: Dict
    checks: Dict
    terrain: Dict

    def to_json(self) -> Dict:
        return {
            "schema_version": 1,
            "data_label": "planned layout over real terrain; ground response from the fitted Knothe model",
            "sector": self.sector,
            "strain_band_edges_ue": list(self.strain_band_edges_ue),
            "counts": self.counts,
            "cost_inr": self.cost_inr,
            "checks": self.checks,
            "terrain": self.terrain,
            "nodes": [asdict(n) for n in self.nodes],
        }


# --------------------------------------------------------------------------- steps


def _sector_bounds(cfg: Config, pc: PlanConfig) -> Tuple[float, float, float, float]:
    x_lo, x_hi = -2.0 * cfg.r, cfg.panel.length_m + 2.0 * cfg.r
    # The sector spans the whole district; with one panel this is width/2 + 2r, as before (F6 B).
    y_half = cfg.panel.district_half_width_m + 2.0 * cfg.r
    if pc.sector == "survey_window":
        x_c = cfg.survey_line_x_m if cfg.survey_line_x_m is not None else cfg.panel.length_m / 2.0
        x_lo, x_hi = max(x_lo, x_c - cfg.window / 2.0), min(x_hi, x_c + cfg.window / 2.0)
    elif pc.sector != "full":
        raise ValueError(f"placement.sector must be survey_window or full, got {pc.sector!r}")
    return x_lo, x_hi, -y_half, y_half


def _peak_fields(cfg: Config, xs: np.ndarray, ys: np.ndarray, every_days: float):
    """Peak subsidence (mm), |strain| over the rod baseline (worst axis, ue) and |tilt| (urad) over the run."""
    days = np.append(np.arange(0.0, cfg.sim.duration_days, every_days), float(cfg.sim.duration_days))
    s_pk = np.zeros_like(xs)
    e_pk = np.zeros_like(xs)
    t_pk = np.zeros_like(xs)
    b = cfg.sensing.strain_rod_baseline_m
    for t in days:
        s_pk = np.maximum(s_pk, physics.subsidence(xs, ys, t, cfg.panel, cfg.knothe))
        ex = physics.strain(xs, ys, t, cfg.panel, cfg.knothe, b, "x")
        ey = physics.strain(xs, ys, t, cfg.panel, cfg.knothe, b, "y")
        e_pk = np.maximum(e_pk, np.maximum(np.abs(ex), np.abs(ey)))
        tx, ty = physics.tilt(xs, ys, t, cfg.panel, cfg.knothe)
        t_pk = np.maximum(t_pk, np.hypot(tx, ty))
    return s_pk, e_pk, t_pk


def _band_edges(values: np.ndarray) -> Tuple[float, ...]:
    """Lower edge of every natural-break class above the lowest, from quantiles of the zone."""
    qs = np.quantile(values, np.linspace(0.0, 1.0, min(MAX_BREAK_SAMPLES, len(values))))
    labels = _natural_breaks(qs, len(TIER_ORDER))
    return tuple(float(qs[labels == c].min()) for c in range(1, labels.max() + 1))


class _SpatialHash:
    """Points with a keep-out radius each. clear_of(x, y, r) is true when every stored point p is at
    least max(r, r_p) away, i.e. the larger of the two spacings applies."""

    def __init__(self, cell: float) -> None:
        self.cell = cell
        self.buckets: Dict[Tuple[int, int], List[Tuple[float, float, float]]] = {}

    def add(self, x: float, y: float, r: float = 0.0) -> None:
        self.buckets.setdefault((int(x // self.cell), int(y // self.cell)), []).append((x, y, r))

    def nearest(self, x: float, y: float, reach_m: float) -> float:
        best = math.inf
        ci, cj = int(x // self.cell), int(y // self.cell)
        reach = int(math.ceil(reach_m / self.cell))
        for i in range(ci - reach, ci + reach + 1):
            for j in range(cj - reach, cj + reach + 1):
                for px, py, _ in self.buckets.get((i, j), ()):
                    best = min(best, math.hypot(px - x, py - y))
        return best

    def clear_of(self, x: float, y: float, dist: float, max_r: float = 0.0) -> bool:
        ci, cj = int(x // self.cell), int(y // self.cell)
        reach = int(math.ceil(max(dist, max_r) / self.cell))
        for i in range(ci - reach, ci + reach + 1):
            for j in range(cj - reach, cj + reach + 1):
                for px, py, pr in self.buckets.get((i, j), ()):
                    need = max(dist, pr)
                    if (px - x) ** 2 + (py - y) ** 2 < need ** 2:
                        return False
        return True


def _fresnel_clear(terrain: Terrain, a_xy, a_h, b_xy, b_h, wavelength_m, clearance) -> bool:
    if not terrain.available:
        return True
    d = math.dist(a_xy, b_xy)
    if d <= terrain.cell:
        return True
    f = np.linspace(0.0, 1.0, LOS_SAMPLES)[1:-1]
    px = a_xy[0] + f * (b_xy[0] - a_xy[0])
    py = a_xy[1] + f * (b_xy[1] - a_xy[1])
    ground = terrain.elev_at(px, py)
    za = float(terrain.elev_at(*a_xy)) + a_h
    zb = float(terrain.elev_at(*b_xy)) + b_h
    line = za + f * (zb - za)
    r1 = np.sqrt(wavelength_m * (f * d) * ((1.0 - f) * d) / d)
    return bool(np.all(line - ground >= clearance * r1))


def _fresnel_clear_many(terrain: Terrain, a_xy, a_h, b_xy: np.ndarray, b_h, wavelength_m, clearance) -> np.ndarray:
    """_fresnel_clear from one point a to every row of b_xy (N x 2) at once."""
    b_xy = np.asarray(b_xy, dtype=float).reshape(-1, 2)
    if not terrain.available or len(b_xy) == 0:
        return np.ones(len(b_xy), dtype=bool)
    d = np.hypot(b_xy[:, 0] - a_xy[0], b_xy[:, 1] - a_xy[1])
    f = np.linspace(0.0, 1.0, LOS_SAMPLES)[1:-1][None, :]
    px = a_xy[0] + f * (b_xy[:, :1] - a_xy[0])
    py = a_xy[1] + f * (b_xy[:, 1:] - a_xy[1])
    ground = terrain.elev_at(px, py)
    za = float(terrain.elev_at(*a_xy)) + a_h
    zb = terrain.elev_at(b_xy[:, 0], b_xy[:, 1]) + b_h
    line = za + f * (zb[:, None] - za)
    r1 = np.sqrt(wavelength_m * f * (1.0 - f) * d[:, None])
    ok = np.all(line - ground >= clearance * r1, axis=1)
    return ok | (d <= terrain.cell)


def _margin_db(cfg: Config, d_m: float, sf: int) -> float:
    r = cfg.radio
    wavelength = SPEED_OF_LIGHT_M_S / (r.frequency_mhz * 1e6)
    fspl = 20.0 * math.log10(max(d_m, wavelength) / 1000.0) + 20.0 * math.log10(r.frequency_mhz) + FSPL_CONSTANT_DB
    return r.tx_power_dbm - fspl - r.sensitivity_dbm[sf]


def _capacitated(points: np.ndarray, centres: np.ndarray, cap: int) -> np.ndarray:
    """Greedy by ascending distance, skipping full centres. Returns the centre index per point."""
    d = np.hypot(points[:, None, 0] - centres[None, :, 0], points[:, None, 1] - centres[None, :, 1])
    order = np.argsort(d, axis=None, kind="stable")
    owner = np.full(len(points), -1)
    load = np.zeros(len(centres), dtype=int)
    for flat in order:
        p, c = divmod(int(flat), len(centres))
        if owner[p] < 0 and load[c] < cap:
            owner[p] = c
            load[c] += 1
    if (owner < 0).any():
        raise ContractViolation(f"{int((owner < 0).sum())} scouts left without a parent (capacity {cap} x {len(centres)})")
    return owner


def plan_network(cfg: Config, pc: PlanConfig) -> NodePlan:
    terrain = Terrain(pc.dem_npz)
    rng = np.random.default_rng(cfg.sim.rng_seed)
    wavelength = SPEED_OF_LIGHT_M_S / (cfg.radio.frequency_mhz * 1e6)
    ant = cfg.radio.antenna_height_m
    cap = cfg.layout.max_children_per_anchor
    nominal = cap - 1
    if nominal < 1:
        raise ContractViolation(f"max_children_per_anchor {cap}: the planner needs >= 2 (one slot of fail-over headroom)")

    # 1. peak ground response on the planning raster
    x_lo, x_hi, y_lo, y_hi = _sector_bounds(cfg, pc)
    cell = pc.plan_cell_m
    gx = np.arange(x_lo + cell / 2.0, x_hi, cell)
    gy = np.arange(y_lo + cell / 2.0, y_hi, cell)
    X, Y = np.meshgrid(gx, gy, indexing="ij")
    s_pk, e_pk, t_pk = _peak_fields(cfg, X, Y, pc.plan_every_days)

    # 2. monitorable ground
    moving = s_pk >= cfg.sensing.detection_threshold_mm
    steep = terrain.slope_at(X, Y) > pc.max_install_slope_deg
    ok = moving & ~steep
    if not ok.any():
        raise ContractViolation("no installable moving ground in the sector")

    # 3. tier zones
    edges = _band_edges(e_pk[ok])
    band = np.searchsorted(np.asarray(edges), e_pk, side="right")
    top = len(edges)

    def tier_for(b: int, tilt: float) -> str:
        if b == top:
            return "1C"
        if b == 0 and top > 1 and _tilt_detectable(cfg, tilt):
            return "1A"
        return "1B"

    zone_tier = np.empty(X.shape, dtype=object)
    for idx in np.ndindex(X.shape):
        zone_tier[idx] = tier_for(int(band[idx]), float(t_pk[idx])) if ok[idx] else None

    def point_response(x: float, y: float):
        s, e, t = _peak_fields(cfg, np.array([x]), np.array([y]), pc.plan_every_days)
        return float(s[0]), float(e[0]), float(t[0])

    def tier_at(e: float, t: float) -> str:
        return tier_for(int(np.searchsorted(np.asarray(edges), e, side="right")), t)

    # 4. scouts: survey monuments first, then variable-radius Poisson-disc, then the gap pass
    spacing = pc.spacing_by_tier_m
    max_sp = max(spacing.values())
    thr = cfg.sensing.detection_threshold_mm
    scouts: List[Dict] = []
    placed = _SpatialHash(max_sp)

    def installable(x: float, y: float) -> bool:
        return (x_lo <= x <= x_hi and y_lo <= y <= y_hi
                and float(terrain.slope_at(x, y)) <= pc.max_install_slope_deg)

    if cfg.survey_line_x_m is not None and x_lo <= cfg.survey_line_x_m <= x_hi:
        offsets = load_monuments(str(cfg.profiles_csv), cfg.survey_line_x_m, cfg.survey_origin_offset_m).offsets_y_m
        for y in offsets:
            x = cfg.survey_line_x_m
            if not installable(x, y) or not placed.clear_of(x, y, pc.min_node_spacing_m):
                continue
            s_, e, t = point_response(x, y)
            if s_ < thr:
                continue
            scouts.append(dict(x=x, y=y, tier=tier_at(e, t), zone="survey_line",
                               reason="real survey monument on line S (carries real / pinned values)"))
            placed.add(x, y, pc.min_node_spacing_m)

    zone_reason = {
        "1C": "highest peak-strain band (tension / compression edge)",
        "1B": "middle peak-strain band",
        "1A": "lowest strain band, tilt detectable (bowl floor)",
    }
    # Darts: one jittered point per installable moving cell; its own response decides tier and motion.
    cells = np.argwhere(ok)
    jitter = rng.uniform(-cell / 2.0, cell / 2.0, size=(len(cells), 2))
    dx = gx[cells[:, 0]] + jitter[:, 0]
    dy = gy[cells[:, 1]] + jitter[:, 1]
    ds, de, dt = _peak_fields(cfg, dx, dy, pc.plan_every_days)
    dtier = np.array([tier_at(float(e), float(t)) for e, t in zip(de, dt)], dtype=object)
    for tier in ("1C", "1B", "1A"):
        pick = np.flatnonzero((dtier == tier) & (ds >= thr))
        if len(pick) == 0:
            continue
        weight = de[pick] if tier != "1A" else np.ones(len(pick))
        weight = np.maximum(weight, np.finfo(float).tiny)
        order = pick[np.argsort(-np.log(rng.random(len(pick))) / weight, kind="stable")]   # weighted random order
        for k in order:
            x, y = float(dx[k]), float(dy[k])
            if not installable(x, y) or not placed.clear_of(x, y, spacing[tier], max_sp):
                continue
            scouts.append(dict(x=x, y=y, tier=tier, zone=tier, reason=zone_reason[tier]))
            placed.add(x, y, spacing[tier])

    # Gap pass: an installable moving cell farther than its own band spacing from every scout gets one
    # (at the cell centre, which moves by definition of `ok`).
    gap_added = 0
    cell_tier = np.array([zone_tier[i, j] for i, j in cells], dtype=object)
    gap_order = cells[np.argsort(-np.log(rng.random(len(cells))) / np.maximum(e_pk[cells[:, 0], cells[:, 1]], np.finfo(float).tiny), kind="stable")] if len(cells) else cells
    tier_of_cell = {(int(i), int(j)): t for (i, j), t in zip(cells, cell_tier)}
    for i, j in gap_order:
        tier = tier_of_cell[(int(i), int(j))]
        x, y = float(gx[i]), float(gy[j])
        if placed.nearest(x, y, spacing[tier]) <= spacing[tier]:
            continue
        if not installable(x, y) or not placed.clear_of(x, y, pc.min_node_spacing_m):
            continue
        scouts.append(dict(x=x, y=y, tier=tier, zone=tier,
                           reason=zone_reason[tier] + "; gap pass (no scout within its band spacing)"))
        placed.add(x, y, pc.min_node_spacing_m)
        gap_added += 1

    n_scouts = len(scouts)
    # Anchors: one per `nominal` scouts, so every anchor keeps a spare slot for an orphan failing
    # over. The count is pure arithmetic — nothing rounds it down to fit an ID range, so the spare
    # slot is never traded away and a bigger mine simply plans more anchors (contract §3, amended
    # 17 Sep 2026 session 24). `max_children_per_anchor` is the divisor here, not a ceiling on the
    # count: it is what one anchor's radio can physically hold.
    n_anchors = max(2, math.ceil(n_scouts / nominal))      # >= 2 so every scout has a distinct backup
    pts = np.array([[s["x"], s["y"]] for s in scouts])

    # 5. anchors: balanced capacitated k-means, then the quietest installable ground near the centre
    centres = pts[rng.choice(n_scouts, size=1)]
    while len(centres) < n_anchors:                          # k-means++ seeding
        d2 = np.min(((pts[:, None, :] - centres[None, :, :]) ** 2).sum(-1), axis=1)
        centres = np.vstack([centres, pts[rng.choice(n_scouts, p=d2 / d2.sum())]])
    for _ in range(KMEANS_ITERATIONS):
        owner = _capacitated(pts, centres, nominal)
        centres = np.array([pts[owner == c].mean(axis=0) if (owner == c).any() else centres[c]
                            for c in range(n_anchors)])
    # Check, not a target: cluster centres closer than min_anchor_spacing_m are merged and re-split
    # once into two clusters seeded at the merged group's two farthest-apart scouts.
    close_pairs = [(i, j) for i in range(n_anchors) for j in range(i + 1, n_anchors)
                   if math.dist(centres[i], centres[j]) < pc.min_anchor_spacing_m]
    merged, used = 0, set()
    cap_fit = nominal          # n_anchors * nominal >= n_scouts by construction now
    for i, j in close_pairs:
        if i in used or j in used:
            continue
        members = np.flatnonzero((owner == i) | (owner == j))
        if len(members) < 2:
            continue
        sub = pts[members]
        dd = np.hypot(sub[:, None, 0] - sub[None, :, 0], sub[:, None, 1] - sub[None, :, 1])
        a_, b_ = np.unravel_index(int(np.argmax(dd)), dd.shape)
        seeds = sub[[a_, b_]]
        for _ in range(KMEANS_ITERATIONS):
            split = _capacitated(sub, seeds, max(cap_fit, math.ceil(len(sub) / 2)))
            seeds = np.array([sub[split == c].mean(axis=0) if (split == c).any() else seeds[c] for c in range(2)])
        owner[members] = np.where(split == 0, i, j)
        centres[i], centres[j] = seeds[0], seeds[1]
        used.update((i, j))
        merged += 1

    def site_anchors(gw_xy):
        """Ground for each anchor: terrain-clear to the gateway first, then lowest tilt, and never closer than
        min_anchor_spacing_m to an anchor already sited in this pass.

        Sited greedily in centre order (fixed, so this is deterministic). The search ring starts at
        min_node_spacing_m around the centre and widens in the same step up to max_anchor_offset_m until it
        holds a cell that clears the spacing. Before session 22 the ring was pinned at min_node_spacing_m and
        each centre was sited in ignorance of the others, so two centres the merge pass had just pushed to
        80 m apart could each drift 20 m toward the other and land ~40 m apart while the CHECK on centre
        spacing still read 80 — the session-19 defect (measured anchor_spacing_min_m 42.4 m, required 80.0).
        A ring that small cannot step out of a neighbour's way; widening it can.

        If even the widest ring holds nothing that clears the spacing, the candidate FARTHEST from its nearest
        sited neighbour is taken rather than failing the plan. The check reports the true minimum either way,
        so a residual violation stays visible instead of being asserted away."""
        out = []
        span = max(x_hi - x_lo, y_hi - y_lo)
        for cx, cy in centres:
            dist = np.hypot(X - cx, Y - cy)
            radius, chosen, fallback = pc.min_node_spacing_m, None, None
            while chosen is None:
                cand = np.argwhere((dist <= radius) & ~steep)
                if len(cand):
                    cxy = np.column_stack([gx[cand[:, 0]], gy[cand[:, 1]]])
                    if out:
                        prev = np.asarray(out, dtype=float)
                        d_near = np.min(np.hypot(cxy[:, None, 0] - prev[None, :, 0],
                                                 cxy[:, None, 1] - prev[None, :, 1]), axis=1)
                        keep = d_near >= pc.min_anchor_spacing_m
                        far = int(np.argmax(d_near))
                        if fallback is None or d_near[far] > fallback[0]:
                            fallback = (float(d_near[far]), cand[far])
                    else:
                        keep = np.ones(len(cand), dtype=bool)
                    if keep.any():
                        cand, cxy = cand[keep], cxy[keep]
                        tilt = t_pk[cand[:, 0], cand[:, 1]]
                        if gw_xy is not None:
                            clear = _fresnel_clear_many(terrain, gw_xy, ant["gateway"], cxy, ant["anchor"],
                                                        wavelength, pc.fresnel_clearance)
                            chosen = cand[np.lexsort((tilt, ~clear))[0]]
                        else:
                            chosen = cand[np.argmin(tilt)]
                        break
                # widen: past max_anchor_offset_m only while NO installable ground has been found at all
                # (the original steep-centre escape hatch, which must still never raise on a steep site).
                exhausted = radius >= pc.max_anchor_offset_m and (len(cand) > 0 or radius >= span)
                if exhausted:
                    if fallback is None:
                        raise ContractViolation("no installable ground for an anchor in the sector")
                    chosen = fallback[1]
                    break
                radius += pc.min_node_spacing_m
            out.append((float(gx[chosen[0]]), float(gy[chosen[1]])))
        return out

    def blocked_counts(anchors, gw_xy):
        own = _capacitated(pts, np.array(anchors), cap)
        scout_blocked = sum(not _fresnel_clear(terrain, tuple(pts[q]), ant["scout"], anchors[own[q]], ant["anchor"],
                                               wavelength, pc.fresnel_clearance) for q in range(n_scouts))
        anchor_blocked = int((~_fresnel_clear_many(terrain, gw_xy, ant["gateway"], np.array(anchors), ant["anchor"],
                                                   wavelength, pc.fresnel_clearance)).sum())
        return {"scout_links_blocked": int(scout_blocked), "anchor_links_blocked": anchor_blocked}

    # 6. gateway, iterated once with the anchors
    anchor_xy = site_anchors(None)
    gateway_xy, _ = _site_gateway(cfg, pc, terrain, anchor_xy, wavelength)
    blocked_before = blocked_counts(anchor_xy, gateway_xy)          # v2 rule: tilt-only anchor siting
    anchor_xy = site_anchors(gateway_xy)
    gateway_xy, gw_clear = _site_gateway(cfg, pc, terrain, anchor_xy, wavelength)
    anchor_xy = site_anchors(gateway_xy)
    gw_clear = int(_fresnel_clear_many(terrain, gateway_xy, ant["gateway"], np.array(anchor_xy), ant["anchor"],
                                       wavelength, pc.fresnel_clearance).sum())
    owner = _capacitated(pts, np.array(anchor_xy), cap)

    # assemble nodes (IDs: gateway 0, anchors 1.., scouts 100.. ordered by x then y)
    nodes: List[PlanNode] = []

    all_xy = np.array([gateway_xy] + anchor_xy + [(scouts[i]["x"], scouts[i]["y"]) for i in range(n_scouts)])
    resp = dict(zip(map(tuple, all_xy), zip(*_peak_fields(cfg, all_xy[:, 0], all_xy[:, 1], pc.plan_every_days))))

    def mk(node_id, tier, x, y, zone, reason, parent, backup, child_index, a_h, p_xy, p_h, sf):
        lat, lon = terrain.latlon_at(x, y)
        s, e, t = (float(v) for v in resp[(x, y)])
        link = margin = clear = None
        if p_xy is not None:
            link = round(math.dist((x, y), p_xy), 2)
            margin = round(_margin_db(cfg, link, sf), 2)
            clear = _fresnel_clear(terrain, (x, y), a_h, p_xy, p_h, wavelength, pc.fresnel_clearance)
        return PlanNode(node_id, tier, round(x, 2), round(y, 2), lat, lon, round(float(terrain.elev_at(x, y)), 2),
                        round(float(terrain.slope_at(x, y)), 2), zone, reason, round(s, 1), round(e, 1), round(t, 1),
                        parent, backup, child_index, link, margin, clear)

    nodes.append(mk(GATEWAY_ID, "gateway", *gateway_xy, "stable_ground",
                    f"never moves (peak S < {cfg.sensing.detection_threshold_mm:g} mm), terrain-clear sight to "
                    f"{gw_clear}/{n_anchors} anchors", None, None, None, ant["gateway"], None, None, None))
    for k, (ax, ay) in enumerate(anchor_xy):
        nodes.append(mk(FIRST_ANCHOR_ID + k, "anchor", ax, ay, "cluster_head",
                        f"quietest installable ground near the centre of its {int((owner == k).sum())} scouts",
                        GATEWAY_ID, None, None, ant["anchor"], gateway_xy, ant["gateway"], cfg.radio.anchor_sf))
    order = sorted(range(n_scouts), key=lambda i: (round(pts[i, 0], 2), round(pts[i, 1], 2)))
    child_counter = {k: 0 for k in range(n_anchors)}
    for sid, i in enumerate(order, start=first_scout_id(n_anchors)):
        s = scouts[i]
        k = int(owner[i])
        others = [c for c in range(n_anchors) if c != k]
        backup = min(others, key=lambda c: (math.dist(pts[i], anchor_xy[c]), c))
        tier = s["tier"]        # decided from the node's own peak response when it was placed
        nodes.append(mk(sid, tier, s["x"], s["y"], s["zone"], s["reason"], FIRST_ANCHOR_ID + k,
                        FIRST_ANCHOR_ID + backup, child_counter[k], ant["scout"], anchor_xy[k], ant["anchor"],
                        cfg.radio.scout_sf))
        child_counter[k] += 1

    # checks and summary
    scout_nodes = [n for n in nodes if n.tier in TIER_ORDER]
    sizes = [child_counter[k] for k in range(n_anchors)]
    nn = []
    for n in scout_nodes:
        d = [math.dist((n.x_m, n.y_m), (m.x_m, m.y_m)) for m in scout_nodes if m is not n]
        nn.append(min(d) if d else 0.0)
    nn_arr = np.array(nn)
    anchor_d = [math.dist(a, b) for i, a in enumerate(anchor_xy) for b in anchor_xy[i + 1:]]
    checks = {
        "max_children": int(max(sizes)), "mean_children": round(float(np.mean(sizes)), 2), "cap": cap,
        # Fail-over headroom: anchors still holding a free child slot. With the anchor count now
        # unclamped this is every anchor on every mine, but it stays reported so a reader can see it
        # rather than take it on trust.
        "nominal_children": nominal, "anchors_with_spare_slot": int(sum(1 for s in sizes if s < cap)),
        "backup_differs": all(n.backup_parent_id != n.parent_id for n in scout_nodes),
        "scout_nn_min_m": round(float(nn_arr.min()), 2), "scout_nn_median_m": round(float(np.median(nn_arr)), 2),
        "scout_nn_cv": round(float(nn_arr.std() / nn_arr.mean()), 3),
        "anchor_spacing_min_m": round(min(anchor_d), 1) if anchor_d else None,
        "max_node_slope_deg": round(max(n.slope_deg for n in nodes if n.tier != "gateway"), 2),
        "scout_links_clear": sum(1 for n in scout_nodes if n.link_clear),
        "anchor_links_clear": sum(1 for n in nodes if n.tier == "anchor" and n.link_clear),
        "min_link_margin_db": round(min(n.link_margin_db for n in nodes if n.link_margin_db is not None), 2),
        "link_margin_required_db": cfg.radio.link_margin_db_min,
        "sector_cells": int(X.size), "moving_cells": int(moving.sum()), "steep_moving_cells_excluded": int((moving & steep).sum()),
    }
    checks.update(_v3_checks(pc, scout_nodes, cells, gx, gy, zone_tier, moving, X, anchor_xy, nodes))
    checks["gap_pass_added"] = gap_added
    checks["anchor_pairs_merged"] = merged
    checks["anchor_pairs_closer_than_min_before_merge"] = len(close_pairs)
    checks["min_anchor_spacing_m"] = pc.min_anchor_spacing_m
    checks["links_blocked_before_iteration"] = blocked_before
    checks["links_blocked"] = {
        "scout_links_blocked": sum(1 for n in scout_nodes if not n.link_clear),
        "anchor_links_blocked": sum(1 for n in nodes if n.tier == "anchor" and not n.link_clear),
    }
    counts = {t: sum(1 for n in nodes if n.tier == t) for t in ("gateway", "anchor", "1A", "1B", "1C")}
    per_tier = {t: [q, int(cfg.cost.unit_inr[COST_KEYS[t]]), q * int(cfg.cost.unit_inr[COST_KEYS[t]])]
                for t, q in counts.items() if q}
    return NodePlan(
        nodes=tuple(nodes),
        sector={"sector": pc.sector, "x_min_m": x_lo, "x_max_m": x_hi, "y_min_m": y_lo, "y_max_m": y_hi},
        strain_band_edges_ue=tuple(round(e, 1) for e in edges),
        counts=counts,
        cost_inr={"per_tier": per_tier, "total": sum(v[2] for v in per_tier.values())},
        checks=checks,
        terrain=terrain.meta,
    )


def _v3_checks(pc: PlanConfig, scout_nodes, cells, gx, gy, zone_tier, moving, X, anchor_xy, nodes) -> Dict:
    """Per-tier spacing, coverage of installable moving ground, x-extent vs the moving footprint."""
    out: Dict = {"nn_by_tier_m": {}}
    for t in TIER_ORDER:
        xy = np.array([[n.x_m, n.y_m] for n in scout_nodes if n.tier == t and n.zone != "survey_line"])
        if len(xy) > 1:
            d = np.hypot(xy[:, None, 0] - xy[None, :, 0], xy[:, None, 1] - xy[None, :, 1])
            np.fill_diagonal(d, np.inf)
            nn = d.min(axis=1)
            out["nn_by_tier_m"][t] = {"min": round(float(nn.min()), 2), "median": round(float(np.median(nn)), 2),
                                      "spacing": pc.spacing_by_tier_m[t]}
    sxy = np.array([[n.x_m, n.y_m] for n in scout_nodes])
    covered = 0
    for i, j in cells:
        r = pc.spacing_by_tier_m[zone_tier[i, j]]
        if np.min(np.hypot(sxy[:, 0] - gx[i], sxy[:, 1] - gy[j])) <= r:
            covered += 1
    out["coverage_fraction"] = round(covered / len(cells), 4) if len(cells) else 0.0
    mx = X[moving]
    out["moving_footprint_x_m"] = [round(float(mx.min()), 1), round(float(mx.max()), 1)]
    out["scouts_x_m"] = [round(float(sxy[:, 0].min()), 1), round(float(sxy[:, 0].max()), 1)]
    out["scout_x_span_fraction"] = round(float((sxy[:, 0].max() - sxy[:, 0].min()) / (mx.max() - mx.min())), 3)
    return out


def _site_gateway(cfg: Config, pc: PlanConfig, terrain: Terrain, anchor_xy, wavelength) -> Tuple[Tuple[float, float], int]:
    ant = cfg.radio.antenna_height_m
    if terrain.available:
        nx, ny = terrain.elev.shape
        xs = terrain.origin_x + np.arange(nx) * terrain.cell
        ys = terrain.origin_y + np.arange(ny) * terrain.cell
    else:   # flat ground: a grid spanning the footprint plus the largest standoff
        reach = 2.0 * cfg.r + pc.gateway_standoff_m[1]
        step = pc.plan_cell_m * GATEWAY_CANDIDATE_STRIDE
        xs = np.arange(-reach, cfg.panel.length_m + reach, step)
        ys = np.arange(-cfg.panel.width_m / 2.0 - reach, cfg.panel.width_m / 2.0 + reach, step)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    s_end = physics.subsidence(X, Y, float(cfg.sim.duration_days), cfg.panel, cfg.knothe)
    moving = s_end >= cfg.sensing.detection_threshold_mm
    spacing = float(xs[1] - xs[0])
    dist = distance_transform_edt(~moving) * spacing
    lo, hi = pc.gateway_standoff_m
    cand = (~moving) & (dist >= lo) & (dist <= hi) & (terrain.slope_at(X, Y) <= pc.max_install_slope_deg)
    stride = GATEWAY_CANDIDATE_STRIDE if terrain.available else 1
    idx = np.argwhere(cand)[::stride]
    if len(idx) == 0:
        raise ContractViolation("no stable, installable gateway site inside the standoff ring")
    best, best_key = None, None
    for i, j in idx:
        g = (float(xs[i]), float(ys[j]))
        clear = int(_fresnel_clear_many(terrain, g, ant["gateway"], np.array(anchor_xy), ant["anchor"],
                                        wavelength, pc.fresnel_clearance).sum())
        margin = sum(min(_margin_db(cfg, math.dist(g, a), cfg.radio.anchor_sf), 0.0) for a in anchor_xy)
        key = (clear, margin, float(terrain.elev_at(*g)))
        if best_key is None or key > best_key:
            best, best_key = g, key
    return best, int(best_key[0])


def main() -> None:
    ap = argparse.ArgumentParser(description="Plan the sensor network over the real terrain.")
    ap.add_argument("--config", default="config/assumptions.yaml")
    ap.add_argument("--out", default="out/plan/node_plan.json")
    args = ap.parse_args()
    cfg = load_config(Path(args.config))
    plan = plan_network(cfg, load_plan_config(Path(args.config)))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(plan.to_json(), indent=1))
    print(f"wrote {out}: {plan.counts}  total INR {plan.cost_inr['total']:,}")
    print(f"strain band edges (ue): {plan.strain_band_edges_ue}")
    print("checks: " + json.dumps(plan.checks))


if __name__ == "__main__":
    main()
