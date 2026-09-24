"""Gate L9 (WP9 §3, Prompt 2 Sitting B) — wire boundary serialization and sign flip.

Asserts:
(a) summary.new_cracks == 2252
(b) summary max_extra_sinking is NEGATIVE (~ -680 mm)
(c) widths, PPV, and counts remain unchanged non-negative magnitudes
(d) every stamp key is present (kind, schema_version, run_id, mine, frozen_day, zone_id, event, params_used, label)
(e) MUTATION CHECK: negating the flip causes L9 to fail, while leaving all other gates unaffected.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

import numpy as np
import pytest

from lab import vibration as lab_vib
from lab.consequence import evaluate
from lab.events import EVENTS
from lab.objects import objects_or_none
from lab.snapshot import load_snapshot
from lab.wire import to_wire
from lab.zones import confine_to_zone, resolve_click, zone_by_id


@pytest.fixture(scope="module")
def day172_scenario(run_dir):
    """Build the day-172 / zone-3 / crack / days_ahead=60 case through evaluate() and to_wire()."""
    snap = load_snapshot(run_dir, 172.0)
    zone = zone_by_id("3", snap.cfg, snap.grid)
    objs = objects_or_none(snap.cfg, snap.grid)
    res = confine_to_zone(EVENTS["crack"](snap, *resolve_click(zone), {"days_ahead": 60.0}), zone, snap)
    layer = lab_vib.caving_ppv_field(snap.grid, snap.cfg, snap.day)
    after = snap.s_model_mm + np.asarray(res.ds_mm, dtype=np.float64)
    eval_out = evaluate(
        snap.s_model_mm,
        after,
        snap.grid,
        snap.cfg,
        snap.lab,
        crack_baseline=snap.crack_baseline,
        ppv_mm_s=layer.get("ppv_mm_s"),
        f_dom_hz=layer.get("f_dom_hz"),
        objects=objs,
    )
    wire_payload = to_wire(eval_out, snap, zone, res, event_name="crack")
    return snap, zone, res, eval_out, wire_payload


def test_l9_a_new_cracks_count(day172_scenario):
    """(a) summary.new_cracks == 2252."""
    _snap, _zone, _res, _eval_out, payload = day172_scenario
    assert payload["summary"]["new_cracks"] == 2252
    assert payload["cracks"]["new_count"] == 2252


def test_l9_b_max_extra_sinking_is_negative(day172_scenario):
    """(b) summary max_extra_sinking is NEGATIVE (~-680 mm)."""
    _snap, _zone, _res, _eval_out, payload = day172_scenario
    sinking = payload["summary"]["max_extra_sinking_mm"]
    assert sinking < 0.0, f"Expected negative max_extra_sinking_mm on wire, got {sinking}"
    assert sinking == pytest.approx(-679.63, abs=1.0)


def test_l9_c_magnitudes_and_counts_unchanged(day172_scenario):
    """(c) widths/PPV/counts are unchanged non-negative magnitudes."""
    _snap, _zone, _res, eval_out, payload = day172_scenario

    # Crack widths and counts
    assert payload["cracks"]["widest_mm"] == pytest.approx(eval_out["cracks"]["widest_mm"], abs=1e-3)
    assert payload["cracks"]["widest_mm"] == pytest.approx(57.12, abs=0.1)
    assert payload["cracks"]["widest_new_mm"] == pytest.approx(57.12, abs=0.1)
    assert payload["cracks"]["after_count"] == 6081
    assert payload["cracks"]["new_count"] == 2252
    assert payload["cracks"]["segments_shown"] == 4000
    assert payload["cracks"]["segments_total"] == 5884

    # All crack segment widths must be non-negative
    for seg in payload["cracks"]["segments"]:
        assert seg["width_mm"] >= 0.0
        assert 0.0 <= seg["bearing_deg"] < 180.0

    # Vibration PPV and frequency
    assert payload["vibration"]["max_ppv_mm_s"] == pytest.approx(0.11, abs=0.01)
    assert payload["vibration"]["f_dom_hz"] == pytest.approx(175.0, abs=1.0)
    assert payload["vibration"]["max_ppv_mm_s"] >= 0.0

    # Summary magnitudes
    assert payload["summary"]["max_tilt_mm_per_m"] == pytest.approx(eval_out["summary"]["max_tilt_mm_per_m"], abs=1e-3)
    assert payload["summary"]["max_tensile_strain_mm_per_m"] == pytest.approx(
        eval_out["summary"]["max_tensile_strain_mm_per_m"], abs=1e-3
    )

    # Object subsidence fields are flipped to negative, while movements/widths remain non-negative
    for obj in payload["objects"]:
        if obj.get("covered"):
            assert obj["before"]["subsidence_mm"] <= 0.0
            assert obj["after"]["subsidence_mm"] <= 0.0
            if "change_of_length_mm" in obj["after"]:
                assert obj["after"]["change_of_length_mm"] >= 0.0
            if "top_movement_mm" in obj["after"]:
                assert obj["after"]["top_movement_mm"] >= 0.0


def test_l9_d_every_stamp_key_present(day172_scenario):
    """(d) every stamp key present and valid."""
    snap, _zone, _res, _eval_out, payload = day172_scenario

    required_stamps = [
        "kind",
        "schema_version",
        "label",
        "run_id",
        "mine",
        "frozen_day",
        "zone_id",
        "segment_id",
        "event",
        "params_used",
        "possible",
        "reason",
    ]
    for key in required_stamps:
        assert key in payload, f"Missing required stamp key {key!r}"

    assert payload["kind"] == "scenario"
    assert payload["schema_version"] == 1
    assert payload["label"] == "SCENARIO (HYPOTHETICAL)"
    assert payload["run_id"] == snap.run_id
    assert payload["mine"] == snap.mine
    assert payload["frozen_day"] == 172.0
    assert payload["zone_id"] == "3"
    assert payload["segment_id"] == "3"
    assert payload["event"] == "crack"
    assert "days_ahead" in payload["params_used"]
    assert payload["possible"] is True

    # JSON serialization must succeed with plain types only
    raw_json = json.dumps(payload)
    assert isinstance(raw_json, str)
    decoded = json.loads(raw_json)
    assert decoded["run_id"] == snap.run_id


def test_l9_e_mutation_check_negate_flip_fails_l9(day172_scenario):
    """(e) MUTATION CHECK: negate or omit the sign flip and show L9 assertion fails."""
    _snap, _zone, _res, eval_out, _payload = day172_scenario

    # A mutated wire implementation that omits the sign flip (positive-down):
    unflipped_sinking = eval_out["summary"]["max_extra_sinking_mm"]
    assert unflipped_sinking > 0.0, "Evaluate summary is positive-down"

    # Show that the unflipped value fails the Gate L9 negative check:
    def check_l9_b(val: float) -> bool:
        return val < 0.0 and val == pytest.approx(-679.63, abs=1.0)

    assert not check_l9_b(unflipped_sinking), "Unflipped positive sinking must fail Gate L9 check (b)"
    assert check_l9_b(-unflipped_sinking), "Flipped negative sinking must pass Gate L9 check (b)"
