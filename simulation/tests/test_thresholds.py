"""
Loads the shared vector file (`config/threshold_vectors.json`) and asserts
`sandbox.thresholds.classify` / `crack_category` agree with it exactly. The
same vectors drive `backend/alarm/thresholds.test.js`, so a change in
either language's classify() that disagrees with the other shows up as a
failure in one language's suite without needing to run both side by side.
"""

import json
import math
from pathlib import Path

import pytest

from sandbox import thresholds

_VECTORS_PATH = Path(__file__).resolve().parent.parent.parent / "config" / "threshold_vectors.json"


def _load_vectors() -> dict:
    with open(_VECTORS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


_VECTORS = _load_vectors()


def _case_id(case: dict) -> str:
    freq = case.get("freq_hz")
    suffix = f"@{freq}Hz" if freq is not None else ""
    return f"{case['condition']}={case['value']}{suffix}"


@pytest.mark.parametrize("case", _VECTORS["cases"], ids=[_case_id(c) for c in _VECTORS["cases"]])
def test_classify_vector(case):
    result = thresholds.classify(case["condition"], case["value"], freq_hz=case.get("freq_hz"))
    assert result == case["expected"]


@pytest.mark.parametrize(
    "case",
    _VECTORS["crack_category_cases"],
    ids=[f"width={c['width_mm']}" for c in _VECTORS["crack_category_cases"]],
)
def test_crack_category_vector(case):
    assert thresholds.crack_category(case["width_mm"]) == case["expected"]


def test_nan_value_is_normal():
    assert thresholds.classify("tilt_change", math.nan) == "NORMAL"


@pytest.mark.parametrize("condition", sorted(thresholds.load()["conditions"].keys()))
def test_condition_has_basis_and_description(condition):
    spec = thresholds.load()["conditions"][condition]
    assert spec.get("basis"), f"{condition} has no basis"
    assert spec.get("description"), f"{condition} has no description"


@pytest.mark.parametrize(
    "case",
    _VECTORS["error_cases"],
    ids=[c["condition"] for c in _VECTORS["error_cases"]],
)
def test_non_value_conditions_raise(case):
    with pytest.raises(ValueError):
        thresholds.classify(case["condition"], 1.0)


def test_unknown_condition_raises():
    with pytest.raises(ValueError):
        thresholds.classify("not_a_real_condition", 1.0)
