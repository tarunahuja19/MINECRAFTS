"""Gate L4 (WP9 §8) — no magic numbers in lab/.

Every physical or chosen value must come from config/*.yaml with a source: string, so a scenario result
can always say where its numbers came from. The scan allows only unit conversions and array-shape
arithmetic. Adding a literal here is almost always the wrong fix: put the number in a yaml instead.
"""

import ast
from pathlib import Path

import pytest

from lab.config import CONFIG_DIR, load_event_spec, load_lab_config

LAB_DIR = Path(__file__).resolve().parents[2] / "lab"
# 0, 1, 2 and 0.5 are array indices, halves and squares; 1000 is m<->mm; 86400 is s/day. Nothing else.
ALLOWED = {0, 1, 2, 0.5, -1, 1000, 86400}


def _offending(path: Path):
    tree = ast.parse(path.read_text())
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) \
                and not isinstance(node.value, bool):
            if not any(node.value == a for a in ALLOWED):
                out.append((node.lineno, node.value))
    return out


@pytest.mark.parametrize("path", sorted(LAB_DIR.rglob("*.py")), ids=lambda p: str(p.name))
def test_no_magic_numbers(path):
    bad = _offending(path)
    assert not bad, f"{path.relative_to(LAB_DIR.parent)}: numeric literal(s) {bad} — move them to config/*.yaml"


def test_every_lab_config_value_is_used_from_yaml():
    """The config must load and be complete — a missing key raises rather than defaulting silently."""
    cfg = load_lab_config()
    assert cfg.id_hash_chars > 0 and cfg.min_effect_mm > 0


@pytest.mark.parametrize("name", ["sudden_sinking", "edge_collapse"])
def test_every_event_input_carries_a_source(name):
    spec = load_event_spec(name)
    assert spec["inputs"], f"{name} declares no inputs"
    for key, entry in spec["inputs"].items():
        assert entry["source"].strip(), f"{name}.{key} has an empty source"
        assert float(entry["min"]) <= float(entry["default"]) <= float(entry["max"])


def test_scenario_inputs_are_labelled_as_hypotheses():
    """Invariant 7: a scenario input is the user's hypothesis and must never read as a measurement."""
    for path in sorted((CONFIG_DIR / "events").glob("*.yaml")):
        spec = load_event_spec(path.stem)
        for key, entry in (spec.get("inputs") or {}).items():
            assert "scenario input" in entry["source"], \
                f"{path.name}:{key} source must say it is a scenario input, got {entry['source']!r}"
