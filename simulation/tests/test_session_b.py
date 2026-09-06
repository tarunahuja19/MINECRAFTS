"""
Session B pytest suite: Discontinuous events (collapse.py), zone segmentation state machine (segments.py),
and Gate T50 (was T37: warning window & step discontinuity).

Run from `simulation_making/`:
    uv run pytest tests/test_session_b.py -v
"""

import numpy as np
import pytest

from sandbox import gates, layout, surface
from sandbox.collapse import PillarFailure, collapse_deltas
from sandbox.constants import C_KNOTHE
from sandbox.segments import (
    SegmentState,
    ZoneManager,
    format_transition_line,
    generate_zones,
)


def test_t50_pillar_failure_warning_window():
    """Gate T50 (was T37): A scripted pillar failure produces a visible step
    discontinuity AND a curvature spike, and the affected zone transitions into
    CRITICAL before it reaches FAILED, providing a positive warning window.
    """
    X, Y = surface.grid()
    manager = ZoneManager(log_to_console=False)

    # Place a pillar failure in zone Z-15 (x in [-100, 0], y in [-100, 0])
    # Initiation at t=100.0d, collapse at t=100.5d, duration=0.2d (~4.8h), mag=0.75m
    failing_zone_id = "Z-15"
    target_zone = manager.zone_map[failing_zone_id]
    cx, cy = target_zone.cx, target_zone.cy

    event = PillarFailure(
        cx=cx,
        cy=cy,
        radius_m=50.0,
        t_init_days=100.0,
        t_collapse_days=100.5,
        duration_days=0.2,
        magnitude_m=0.75,
    )

    # Pre-evaluate base spatial channels at full settling to avoid repeated 2D convolutions in loop
    settled_ch = surface.channels(X, Y, 1e6)

    # Sample key timeline checkpoints before, during yield, during collapse, and after
    times = [
        0.0,
        50.0,
        99.0,
        100.0,   # t_init -> yield starts
        100.2,   # pre-collapse yield
        100.4,   # late yield -> CRITICAL
        100.5,   # t_collapse -> dynamic collapse starts
        100.6,   # collapse in progress
        100.75,  # dynamic collapse completed -> FAILED
        102.0,
    ]

    peak_step_seen = 0.0
    peak_curv_seen = 0.0

    for t in times:
        tf = float(1.0 - np.exp(-C_KNOTHE * t)) if t > 0 else 0.0
        base_ch = {k: v * tf for k, v in settled_ch.items()}
        deltas = collapse_deltas(X, Y, t, [event])

        # Combined fields
        total_channels = {
            "s": base_ch["s"] + deltas["delta_s"],
            "strain_x": base_ch["strain_x"] + deltas["delta_strain_x"],
            "strain_y": base_ch["strain_y"] + deltas["delta_strain_y"],
            "curvature_x": base_ch["curvature_x"] + deltas["delta_curvature_x"],
            "curvature_y": base_ch["curvature_y"] + deltas["delta_curvature_y"],
        }

        peak_step_seen = max(peak_step_seen, float(np.max(deltas["delta_s"])))
        curv_mag = np.maximum(
            np.abs(total_channels["curvature_x"]),
            np.abs(total_channels["curvature_y"]),
        )
        peak_curv_seen = max(peak_curv_seen, float(np.max(curv_mag)))

        manager.evaluate(
            X, Y, t, total_channels, collapse_step=deltas["delta_s"]
        )

    # Verify Gate T50 via gates helper
    assert gates.verify_pillar_failure_warning_gate(
        manager.transition_history,
        failing_zone_id=failing_zone_id,
        peak_step_magnitude=peak_step_seen,
        peak_curvature=peak_curv_seen,
    )


def test_collapse_additive_property():
    """Verify collapse displacement is strictly additive to Knothe subsidence."""
    X, Y = surface.grid()
    t = 100.8  # Past collapse completion (100.5 + 0.2 = 100.7)

    base_s = surface.S(X, Y, t)
    event = PillarFailure(
        cx=0.0,
        cy=0.0,
        radius_m=60.0,
        t_init_days=100.0,
        t_collapse_days=100.5,
        duration_days=0.2,
        magnitude_m=0.8,
    )

    deltas = collapse_deltas(X, Y, t, [event])
    total_s = base_s + deltas["delta_s"]

    assert np.all(total_s >= base_s), "Collapse subsidence must be >= base subsidence everywhere"
    assert np.max(deltas["delta_s"]) == pytest.approx(0.8, rel=0.05)


def test_collapse_timescale_hours_not_weeks():
    """Verify dynamic collapse completes over ~hours (duration_days = 0.2 days),
    unlike Knothe regional bowl which takes ~100+ days.
    """
    X, Y = surface.grid()
    event = PillarFailure(
        cx=0.0,
        cy=0.0,
        radius_m=50.0,
        t_init_days=50.0,
        t_collapse_days=50.2,
        duration_days=0.2,
        magnitude_m=1.0,
    )

    # At t=50.0 (t_init): step is minimal
    d_0 = collapse_deltas(X, Y, 50.0, [event])
    assert np.max(d_0["delta_s"]) < 0.05

    # At t=50.2 (t_collapse): dynamic collapse begins
    d_start = collapse_deltas(X, Y, 50.2, [event])
    assert np.max(d_start["delta_s"]) < 0.1

    # At t=50.4 (t_collapse + duration): dynamic collapse fully developed
    d_end = collapse_deltas(X, Y, 50.4, [event])
    assert np.max(d_end["delta_s"]) == pytest.approx(1.0, abs=0.01)


def test_zones_geometry():
    """Verify 36 zones exactly partition the 600x600 m window."""
    zones = generate_zones()
    assert len(zones) == 36
    assert zones[0].zone_id == "Z-01"
    assert zones[-1].zone_id == "Z-36"

    # Verify coverage
    all_x_min = min(z.x_min for z in zones)
    all_x_max = max(z.x_max for z in zones)
    all_y_min = min(z.y_min for z in zones)
    all_y_max = max(z.y_max for z in zones)

    assert all_x_min == -300.0
    assert all_x_max == 300.0
    assert all_y_min == -300.0
    assert all_y_max == 300.0


def test_format_transition_line():
    """Verify transition line formatting matches §5 Session B specification."""
    from sandbox.segments import TransitionEvent

    ev = TransitionEvent(
        t_days=112.0,
        zone_id="Z-14",
        from_state=SegmentState.SETTLING,
        to_state=SegmentState.TENSION,
        s_m=0.45,
        eps_mm_per_m=4.8,
        kappa_per_m=1.2e-4,
        message="⚠ approaching threshold",
    )
    line = format_transition_line(ev)
    assert "t=+ 112.0d" in line
    assert "Z-14" in line
    assert "TENSION" in line
    assert "ε=+4.8mm/m" in line
    assert "κ=1.2e-04" in line
    assert "⚠ approaching threshold" in line
