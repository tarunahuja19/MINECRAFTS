"""Node planner v3 (minesim.placement): contract, geology, terrain and radio rules."""

import dataclasses
import math
from pathlib import Path

import numpy as np
import pytest

from minesim import physics
from minesim.config import load_config
from minesim.placement import Terrain, load_plan_config, plan_network
from minesim.sizing import FIRST_ANCHOR_ID, GATEWAY_ID, first_scout_id
from tests.helpers import load_mutated_config

CONFIG = Path("config/assumptions.yaml")
SCOUTS = ("1A", "1B", "1C")
FAST_DAYS = 60.0   # coarser peak sampling keeps the test quick; the rules do not depend on it


def _fast(pc):
    return dataclasses.replace(pc, plan_every_days=FAST_DAYS)


@pytest.fixture(scope="module")
def adriyala():
    cfg = load_config(CONFIG)
    pc = _fast(load_plan_config(CONFIG))
    return cfg, pc, plan_network(cfg, pc)


def test_dem_is_real_and_georeferenced():
    pc = load_plan_config(CONFIG)
    t = Terrain(pc.dem_npz)
    assert t.available and t.meta["provenance"] == "real"
    lat, lon = t.latlon_at(load_config(CONFIG).panel.length_m / 2.0, 0.0)   # site = panel centre
    assert lat == pytest.approx(pc.panel_centre_lat_deg, abs=1e-4)
    assert lon == pytest.approx(pc.panel_centre_lon_deg, abs=1e-4)


def test_contract_ids_parents_and_capacity(adriyala):
    cfg, _, plan = adriyala
    nodes = plan.nodes
    ids = [n.node_id for n in nodes]
    assert len(ids) == len(set(ids))
    gw = [n for n in nodes if n.tier == "gateway"]
    anchors = [n for n in nodes if n.tier == "anchor"]
    scouts = [n for n in nodes if n.tier in SCOUTS]
    assert len(gw) == 1 and gw[0].node_id == GATEWAY_ID and gw[0].parent_id is None
    # Anchors run contiguously up from FIRST_ANCHOR_ID — however many the arithmetic asked for — and
    # the scouts start above the last of them, so the two ID blocks cannot overlap.
    assert sorted(a.node_id for a in anchors) == list(range(FIRST_ANCHOR_ID, FIRST_ANCHOR_ID + len(anchors)))
    assert all(a.parent_id == GATEWAY_ID for a in anchors)
    assert all(s.node_id >= first_scout_id(len(anchors)) for s in scouts)
    anchor_ids = {a.node_id for a in anchors}
    cap = cfg.layout.max_children_per_anchor
    for a in anchor_ids:
        kids = [s for s in scouts if s.parent_id == a]
        assert len(kids) <= cap
        assert sorted(s.child_index for s in kids) == list(range(len(kids)))   # G10 sub-slots unique
    for s in scouts:
        assert s.parent_id in anchor_ids and s.backup_parent_id in anchor_ids
        assert s.backup_parent_id != s.parent_id
    # anchor count is derived from fan-out (nominal = cap - 1)
    assert len(anchors) == max(2, math.ceil(len(scouts) / (cap - 1)))


def test_scouts_are_spaced_and_not_on_a_grid(adriyala):
    _, pc, plan = adriyala
    scouts = [n for n in plan.nodes if n.tier in SCOUTS]
    xy = np.array([[n.x_m, n.y_m] for n in scouts])
    d = np.hypot(xy[:, None, 0] - xy[None, :, 0], xy[:, None, 1] - xy[None, :, 1])
    np.fill_diagonal(d, np.inf)
    assert d.min() >= pc.min_node_spacing_m - 1e-6
    tilt = np.array([[n.x_m, n.y_m] for n in scouts if n.tier == "1A" and n.zone != "survey_line"])
    if len(tilt) > 1:
        dt = np.hypot(tilt[:, None, 0] - tilt[None, :, 0], tilt[:, None, 1] - tilt[None, :, 1])
        np.fill_diagonal(dt, np.inf)
        assert dt.min() >= pc.spacing_by_tier_m["1A"] - 1e-6
    assert plan.checks["scout_nn_cv"] > 0.1        # a regular grid has NN CV ~ 0


def test_nodes_avoid_steep_terrain_and_sit_on_moving_ground(adriyala):
    cfg, pc, plan = adriyala
    for n in plan.nodes:
        if n.tier == "gateway":
            continue
        assert n.slope_deg <= pc.max_install_slope_deg + 1e-6
        if n.tier in SCOUTS:
            assert n.peak_subsidence_mm >= cfg.sensing.detection_threshold_mm
    assert plan.checks["steep_moving_cells_excluded"] > 0   # the real pit / dump faces do exclude ground


def test_tiers_follow_strain_bands(adriyala):
    _, _, plan = adriyala
    lo, hi = plan.strain_band_edges_ue[0], plan.strain_band_edges_ue[-1]
    for n in plan.nodes:
        if n.tier == "1C":
            assert n.peak_strain_ue >= hi
        if n.tier == "1A":
            assert n.peak_strain_ue < lo


def test_gateway_is_on_stable_ground_outside_the_footprint(adriyala):
    cfg, pc, plan = adriyala
    gw = next(n for n in plan.nodes if n.tier == "gateway")
    s_end = physics.subsidence(np.array([gw.x_m]), np.array([gw.y_m]), float(cfg.sim.duration_days), cfg.panel, cfg.knothe)
    assert float(s_end[0]) < cfg.sensing.detection_threshold_mm
    assert gw.slope_deg <= pc.max_install_slope_deg
    nearest_scout = min(math.dist((gw.x_m, gw.y_m), (n.x_m, n.y_m)) for n in plan.nodes if n.tier in SCOUTS)
    assert nearest_scout >= pc.gateway_standoff_m[0]


def test_node_count_is_an_output_of_spacing():
    cfg = load_config(CONFIG)
    pc = _fast(load_plan_config(CONFIG))
    base = plan_network(cfg, pc)
    wider = plan_network(cfg, dataclasses.replace(pc, spacing_by_tier_m={t: v * 1.5 for t, v in pc.spacing_by_tier_m.items()}))
    n = lambda p: sum(p.counts[t] for t in SCOUTS)
    assert n(wider) < n(base)


def test_deterministic(adriyala):
    cfg, pc, plan = adriyala
    again = plan_network(cfg, pc)
    assert again.to_json() == plan.to_json()


def test_mine_without_site_plans_on_flat_ground():
    cfg = load_mutated_config(lambda d: d.__setitem__("mine", "illinois_lw"))
    pc = dataclasses.replace(_fast(load_plan_config(CONFIG)), dem_npz=None)
    plan = plan_network(cfg, pc)
    assert plan.terrain["provenance"] == "none"
    assert sum(plan.counts[t] for t in SCOUTS) > 0 and plan.counts["gateway"] == 1


# --------------------------------------------------------------------------- v3 (F3)

def test_sector_is_the_full_moving_footprint(adriyala):
    cfg, pc, plan = adriyala
    assert pc.sector == "full" and plan.sector["sector"] == "full"
    assert plan.sector["x_min_m"] == pytest.approx(-2.0 * cfg.r)
    assert plan.sector["x_max_m"] == pytest.approx(cfg.panel.length_m + 2.0 * cfg.r)


def test_scouts_span_the_moving_footprint_along_x(adriyala):
    _, _, plan = adriyala
    lo, hi = plan.checks["moving_footprint_x_m"]
    xs = [n.x_m for n in plan.nodes if n.tier in SCOUTS]
    assert (max(xs) - min(xs)) / (hi - lo) >= 0.90


def test_nn_spacing_per_tier_at_least_its_band_spacing(adriyala):
    _, pc, plan = adriyala
    for t in SCOUTS:
        xy = np.array([[n.x_m, n.y_m] for n in plan.nodes if n.tier == t and n.zone != "survey_line"])
        if len(xy) < 2:
            continue
        d = np.hypot(xy[:, None, 0] - xy[None, :, 0], xy[:, None, 1] - xy[None, :, 1])
        np.fill_diagonal(d, np.inf)
        assert d.min() >= pc.spacing_by_tier_m[t] - 1e-6, t


def test_anchor_ids_contiguous_parents_backups_and_cap(adriyala):
    cfg, _, plan = adriyala
    anchors = {n.node_id for n in plan.nodes if n.tier == "anchor"}
    assert anchors and sorted(anchors) == list(range(FIRST_ANCHOR_ID, FIRST_ANCHOR_ID + len(anchors)))
    scouts = [n for n in plan.nodes if n.tier in SCOUTS]
    assert all(s.parent_id in anchors and s.backup_parent_id in anchors and s.backup_parent_id != s.parent_id for s in scouts)
    assert plan.checks["max_children"] <= cfg.layout.max_children_per_anchor


def test_sited_anchors_honour_min_anchor_spacing(adriyala):
    """No two anchors stand closer than min_anchor_spacing_m.

    Session-19 defect, closed 17 Sep: the merge pass enforced the spacing on cluster CENTRES, but
    site_anchors then picked each anchor's ground independently within min_node_spacing_m of its own
    centre. Two centres exactly 80 m apart could each drift 20 m toward the other, so the anchors landed
    ~40 m apart (measured 42.4 m) while checks["min_anchor_spacing_m"] still advertised 80. Assert the
    SITED positions, not the centres, because the sited positions are what gets installed.
    """
    _, pc, plan = adriyala
    xy = np.array([[n.x_m, n.y_m] for n in plan.nodes if n.tier == "anchor"])
    assert len(xy) >= 2
    d = np.hypot(xy[:, None, 0] - xy[None, :, 0], xy[:, None, 1] - xy[None, :, 1])
    np.fill_diagonal(d, np.inf)
    assert d.min() >= pc.min_anchor_spacing_m - 1e-6, f"closest anchors {d.min():.1f} m < {pc.min_anchor_spacing_m} m"
    # and the reported check must not disagree with the geometry it claims to describe
    assert plan.checks["anchor_spacing_min_m"] >= plan.checks["min_anchor_spacing_m"] - 1e-6


def test_coverage_of_installable_moving_ground(adriyala):
    _, _, plan = adriyala
    assert plan.checks["coverage_fraction"] >= 0.95


def test_every_scout_moves_by_its_own_response(adriyala):
    cfg, pc, plan = adriyala
    scouts = [n for n in plan.nodes if n.tier in SCOUTS]
    xy = np.array([[n.x_m, n.y_m] for n in scouts])
    from minesim.placement import _peak_fields
    s_pk, _, _ = _peak_fields(cfg, xy[:, 0], xy[:, 1], pc.plan_every_days)
    assert np.all(s_pk >= cfg.sensing.detection_threshold_mm)


def test_v3_checks_present(adriyala):
    _, _, plan = adriyala
    c = plan.checks
    for key in ("nn_by_tier_m", "coverage_fraction", "scouts_x_m", "moving_footprint_x_m", "scout_x_span_fraction",
                "anchor_spacing_min_m", "links_blocked", "links_blocked_before_iteration", "gap_pass_added",
                "anchor_pairs_merged", "scout_nn_min_m", "scout_links_clear", "anchor_links_clear"):
        assert key in c, key


def test_deterministic_json_bytes(adriyala):
    import json
    cfg, pc, plan = adriyala
    assert json.dumps(plan_network(cfg, pc).to_json(), sort_keys=True) == json.dumps(plan.to_json(), sort_keys=True)


def test_survey_window_option_is_static(adriyala):
    cfg, pc, _ = adriyala
    win = plan_network(cfg, dataclasses.replace(pc, sector="survey_window"))
    assert win.sector["sector"] == "survey_window"
    xs = [n.x_m for n in win.nodes if n.tier in SCOUTS]
    assert min(xs) >= win.sector["x_min_m"] and max(xs) <= win.sector["x_max_m"]
