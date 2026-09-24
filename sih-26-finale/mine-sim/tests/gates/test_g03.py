"""Gate G03 — every Layout carries a non-empty CostBreakdown."""

from pathlib import Path

from minesim.config import load_config
from minesim.sizing import CostBreakdown, Layout, size_network


def _cost_ok(layout: Layout) -> bool:
    c = layout.cost
    return isinstance(c, CostBreakdown) and bool(c.per_tier) and c.total_inr > 0


def test_g03_cost_present():
    assert _cost_ok(size_network(load_config(Path("config/assumptions.yaml"))))


def test_g03_negative_empty_breakdown_fails():
    good = size_network(load_config(Path("config/assumptions.yaml")))
    bad = Layout(nodes=good.nodes, cost=CostBreakdown(per_tier={}, total_inr=0),
                 spacing_m=good.spacing_m, relaxation_steps=good.relaxation_steps)
    assert not _cost_ok(bad)
