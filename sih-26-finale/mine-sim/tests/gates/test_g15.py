"""Gate G15 — config-driven: spacing and mine swaps change the layout with no src/ change."""

import ast
import math
from pathlib import Path

import pytest

from minesim.config import load_config
from minesim.sizing import FIRST_ANCHOR_ID, FIRST_SCOUT_ID, first_scout_id, size_network
from tests.helpers import load_mutated_config

SIZING = Path(__file__).resolve().parents[2] / "src" / "minesim" / "sizing.py"
# Structural literals allowed in sizing.py: the two ID origins (contract §3), halves, pairs.
# 99 is gone: no ceiling on the anchor count survives in sizing.py.
ALLOWED_LITERALS = {0, 1, 2, 0.0, 0.5, 2.0, 100}


def _scouts(layout):
    return sum(1 for n in layout.nodes if n.tier in ("1A", "1B", "1C"))


@pytest.mark.usefixtures("layout_v1_test")   # F4: layout.spacing_m drives the v1 travelling cross
def test_g15_spacing_change_changes_count():
    base = size_network(load_config(Path("config/assumptions.yaml")))
    wider = size_network(load_mutated_config(lambda d: d["layout"].__setitem__("spacing_m", 75.0)))
    assert _scouts(wider) != _scouts(base)


def test_g15_second_mine_gives_valid_different_layout():
    base = size_network(load_config(Path("config/assumptions.yaml")))
    il = size_network(load_mutated_config(lambda d: d.__setitem__("mine", "illinois_lw")))
    assert _scouts(il) > 0
    assert [(n.x_m, n.y_m) for n in il.nodes] != [(n.x_m, n.y_m) for n in base.nodes]
    for n in il.nodes:
        if n.tier in ("1A", "1B", "1C"):
            assert n.backup_parent_id != n.parent_id


def _bad_literals(source: str):
    out = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) \
                and not isinstance(node.value, bool) and node.value not in ALLOWED_LITERALS:
            out.append((node.lineno, node.value))
    return out


def test_g15_no_assumption_literals_in_sizing():
    assert _bad_literals(SIZING.read_text()) == []


def test_g15_negative_literal_detected():
    assert _bad_literals("spacing = 50.0\n") == [(1, 50.0)]


# --------------------------------------------------- anchor-count rule (contract §3, 17 Sep 2026)

def _by_parent(layout):
    counts = {n.node_id: 0 for n in layout.nodes if n.tier == "anchor"}
    for n in layout.nodes:
        if n.tier in ("1A", "1B", "1C"):
            counts[n.parent_id] += 1
    return counts


def test_g15_the_one_hard_limit_holds_and_ids_never_collide():
    """`max_children_per_anchor` is the only hard limit left: it is one anchor's radio capacity.

    The anchor COUNT is not limited — it is ceil(scouts / fan-out) and nothing truncates it — so what
    has to hold instead is that the IDs still partition cleanly: anchors run contiguously up from
    FIRST_ANCHOR_ID, and no scout ID lands on one of them."""
    for mutate in (lambda d: d, lambda d: d.__setitem__("mine", "illinois_lw")):
        cfg = load_mutated_config(mutate)
        layout = size_network(cfg)
        counts = _by_parent(layout)
        assert counts, "a planned mine has anchors"
        assert max(counts.values()) <= cfg.layout.max_children_per_anchor
        assert sorted(counts) == list(range(FIRST_ANCHOR_ID, FIRST_ANCHOR_ID + len(counts)))
        scout_ids = [n.node_id for n in layout.nodes if n.tier in ("1A", "1B", "1C")]
        assert min(scout_ids) >= first_scout_id(len(counts))
        assert not set(scout_ids) & set(counts)


def test_g15_the_anchor_count_is_arithmetic_with_no_ceiling():
    """The anchor count is whatever the division comes to, on a mine of any size.

    Before 17 Sep 2026 (session 24) it was clamped to the 1-99 ID range, so Illinois was forced down
    to 99 anchors. `size_network` is the v1 cross, which chunks at the hard cap (the spare-slot
    headroom rule belongs to the v3 planner in placement.py), so what this pins is the division
    itself: count = ceil(scouts / cap), never truncated."""
    cfg = load_config(Path("config/assumptions.yaml"))
    cap = cfg.layout.max_children_per_anchor
    adriyala = _by_parent(size_network(cfg))
    illinois = _by_parent(size_network(load_mutated_config(lambda d: d.__setitem__("mine", "illinois_lw"))))

    assert sum(illinois.values()) > sum(adriyala.values())      # Illinois really is the bigger mine
    assert len(illinois) > 99                                   # the old ID-range clamp is gone
    for counts in (adriyala, illinois):
        assert len(counts) >= math.ceil(sum(counts.values()) / cap)
