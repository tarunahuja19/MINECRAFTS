"""Unit tests for minesim.sizing (WP2, v1 cut)."""

import math
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pytest

from minesim.config import load_config
from minesim.sizing import FIRST_SCOUT_ID, GATEWAY_ID, size_network
from tests.helpers import load_mutated_config

SCOUT_TIERS = ("1A", "1B", "1C")
pytestmark = pytest.mark.usefixtures("layout_v1")   # F4: this module tests the v1 travelling cross


@pytest.fixture(scope="module")
def cfg():
    return load_config(Path("config/assumptions.yaml"))


@pytest.fixture(scope="module")
def layout(cfg):
    return size_network(cfg)


def _scouts(layout):
    return [n for n in layout.nodes if n.tier in SCOUT_TIERS]


def _with_spacing(spacing):
    return load_mutated_config(lambda d: d["layout"].__setitem__("spacing_m", spacing))


def test_counts_follow_geometry(cfg, layout):
    """Scouts = transverse + longitudinal − 1 shared crossing, from extent, window and spacing."""
    d = cfg.layout.spacing_m
    transverse = 2 * math.ceil((cfg.extent / 2.0) / d) + 1
    longitudinal = 2 * math.ceil((cfg.window / 2.0) / d) + 1
    tiers = Counter(n.tier for n in layout.nodes)
    assert len(_scouts(layout)) == transverse + longitudinal - 1
    assert tiers["gateway"] == 1
    assert tiers["anchor"] >= 2
    assert Counter(n.line for n in layout.nodes)["crossing"] == 1


def test_spacing_sensitivity():
    counts = {s: len(_scouts(size_network(_with_spacing(s)))) for s in (40.0, 50.0, 60.0)}
    assert counts[40.0] > counts[50.0] > counts[60.0]


def test_transverse_covers_extent(cfg, layout):
    ys = [n.y_m for n in layout.nodes if n.line in ("transverse", "crossing")]
    assert max(ys) - min(ys) >= cfg.extent


def test_longitudinal_covers_window(cfg, layout):
    xs = [n.x_m for n in layout.nodes if n.line in ("longitudinal", "crossing")]
    assert max(xs) - min(xs) >= cfg.window


def test_child_index_unique_and_in_range(cfg, layout):
    by_parent = defaultdict(list)
    for n in _scouts(layout):
        by_parent[n.parent_id].append(n.child_index)
    for parent, idx in by_parent.items():
        assert len(idx) <= cfg.layout.max_children_per_anchor
        assert len(set(idx)) == len(idx), f"duplicate child_index under anchor {parent}"
        assert all(0 <= i < cfg.layout.max_children_per_anchor for i in idx)


def test_backup_parent_differs(layout):
    anchor_ids = {n.node_id for n in layout.nodes if n.tier == "anchor"}
    for n in _scouts(layout):
        assert n.parent_id in anchor_ids
        assert n.backup_parent_id in anchor_ids
        assert n.backup_parent_id != n.parent_id


def test_id_ranges(layout):
    for n in layout.nodes:
        if n.tier == "gateway":
            assert n.node_id == GATEWAY_ID
        elif n.tier == "anchor":
            assert 1 <= n.node_id <= 99 and n.parent_id == GATEWAY_ID
        else:
            assert n.node_id >= FIRST_SCOUT_ID
    assert len({n.node_id for n in layout.nodes}) == len(layout.nodes)


def test_tier_1c_nearer_the_strain_peak_than_1a(cfg, layout):
    """On the transverse line, 1C sits nearer the inflection point (rib minus offset d) than 1A does."""
    rib = cfg.panel.width_m / 2.0 - cfg.panel.inflection_offset_m
    line = [n for n in layout.nodes if n.line in ("transverse", "crossing")]
    dist = lambda tier: [abs(abs(n.y_m) - rib) for n in line if n.tier == tier]
    assert dist("1C") and dist("1A")
    assert sum(dist("1C")) / len(dist("1C")) < sum(dist("1A")) / len(dist("1A"))


def test_every_scout_tier_present(layout):
    assert {n.tier for n in _scouts(layout)} == set(SCOUT_TIERS)


def test_cost_breakdown_sums(layout):
    per = layout.cost.per_tier
    assert sum(v[2] for v in per.values()) == layout.cost.total_inr
    for tier, (qty, unit, sub) in per.items():
        assert qty * unit == sub
    assert set(per) == {n.tier for n in layout.nodes}
    for tier, count in Counter(n.tier for n in layout.nodes).items():
        assert per[tier][0] == count


def test_z0_is_static_baseline(layout):
    assert all(n.z0_mm == 0.0 for n in layout.nodes)


def test_deterministic(cfg, layout):
    assert size_network(cfg) == layout


def test_relaxation_steps_empty_in_v1(layout):
    assert layout.relaxation_steps == ()
    assert layout.spacing_m == 50.0


def test_natural_breaks_never_split_near_ties():
    """W2: a cluster of near-identical peaks lands in one band, whatever its size."""
    from minesim.sizing import _natural_breaks
    values = np.array([10.0, 12.0] + [1400.0 + k for k in range(20)] + [3500.0, 3600.0, 3550.0])
    labels = _natural_breaks(values, 3)
    assert len(set(labels[2:22])) == 1
    assert labels[0] == labels[1] == 0 and set(labels[22:]) == {2}


def test_identical_longitudinal_positions_share_a_tier(cfg):
    """W2 on Illinois: identical along-panel nodes all get the same tier."""
    il = size_network(load_mutated_config(lambda d: d.__setitem__("mine", "illinois_lw")))
    far = [n.tier for n in il.nodes if n.line == "longitudinal"]
    assert len(set(far)) == 1


def test_every_1a_node_can_see_its_tilt(cfg, layout):
    """W3: a tilt-only node is placed only where its per-period tilt noise floor x SNR is below the signal."""
    from minesim import physics
    from minesim.sizing import _tilt_detectable
    for n in layout.nodes:
        if n.tier == "1A":
            peak = max(np.hypot(*physics.tilt(n.x_m, n.y_m, float(t), cfg.panel, cfg.knothe))
                       for t in range(0, cfg.sim.duration_days + 1, 2))
            assert _tilt_detectable(cfg, peak)
