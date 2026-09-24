"""Gate G12 — cost is reported, never a constraint (the A22 budget cap is deleted)."""

import ast
from pathlib import Path

from minesim.config import load_config
from minesim.sizing import size_network
from tests.helpers import load_mutated_config

SIZING = Path(__file__).resolve().parents[2] / "src" / "minesim" / "sizing.py"


def test_g12_absurd_costs_still_give_a_valid_layout():
    base = size_network(load_config(Path("config/assumptions.yaml")))
    absurd = load_mutated_config(
        lambda d: d["cost"].__setitem__("A21_unit_inr", {k: v * 10**6 for k, v in d["cost"]["A21_unit_inr"].items()})
    )
    layout = size_network(absurd)
    assert [n.node_id for n in layout.nodes] == [n.node_id for n in base.nodes]
    assert layout.cost.total_inr == base.cost.total_inr * 10**6


def _cost_in_condition(source: str) -> bool:
    """True if any if/while/assert condition in `source` reads cost or a budget."""
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, (ast.If, ast.While, ast.Assert)):
            names = {n.id for n in ast.walk(node.test) if isinstance(n, ast.Name)}
            names |= {n.attr for n in ast.walk(node.test) if isinstance(n, ast.Attribute)}
            if any(k in name.lower() for name in names for k in ("cost", "budget", "cap", "inr")):
                return True
    return False


def test_g12_no_cost_branch_in_sizing():
    assert not _cost_in_condition(SIZING.read_text())


def test_g12_negative_budget_branch_detected():
    assert _cost_in_condition("if layout.cost.total_inr > budget_cap:\n    raise ValueError()\n")
