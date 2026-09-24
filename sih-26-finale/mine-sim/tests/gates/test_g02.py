"""Gate G02 — node count is an output: size_network takes exactly one parameter."""

import inspect
import re

from minesim.sizing import size_network


def _violations(fn):
    params = list(inspect.signature(fn).parameters.values())
    problems = []
    if len(params) != 1:
        problems.append(f"expected 1 parameter, got {len(params)}")
    for p in params:
        if re.search(r"node|count|n_|num", p.name, re.IGNORECASE):
            problems.append(f"parameter name '{p.name}' looks like a node count")
    return problems


def test_g02_single_config_parameter():
    assert _violations(size_network) == []


def test_g02_negative_defaulted_count_fails():
    def bad(cfg, n_nodes=30):
        return None
    assert _violations(bad)


def test_g02_negative_renamed_parameter_fails():
    def bad(node_count):
        return None
    assert _violations(bad)
