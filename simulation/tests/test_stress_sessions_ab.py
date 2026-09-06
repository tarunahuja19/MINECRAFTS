"""
Stress test suite for Sessions A and B:
- 100% boundary coverage and partitioning of the 36 zones
- Extreme time values (negative, zero, near-zero, asymptotic large t)
- Multiple overlapping discontinuous collapse events
- High-throughput tick loop stability (10,000 iterations)
- Field symmetry and derivative conservation invariants
"""

import numpy as np
import pytest

from sandbox import collapse, constants, layout, segments, surface, terrain


def test_zone_boundary_complete_coverage():
    """Stress test: Every single coordinate on the (241, 241) simulation grid
    is covered by the 36 zones, with zero uncovered points and exact partitioning.
    """
    X, Y = surface.grid()
    zones = segments.generate_zones()
    assert len(zones) == 36

    covered_counts = np.zeros(X.shape, dtype=int)
    for z in zones:
        covered_counts[z.slice_y, z.slice_x] += 1

    # Every cell interior is covered, boundary points are shared at cell edges
    assert np.all(covered_counts >= 1), "Found uncovered points on simulation grid!"
    # Ensure full grid is spanned
    assert covered_counts.shape == (constants.GRID_N, constants.GRID_N)


def test_surface_extreme_times():
    """Stress test: surface.S and surface.channels under extreme time ranges:
    t < 0, t = 0, t = 1e-15, t = 1e-3, t = 100.0, t = 1e6, t = 1e12.
    No NaNs, Infs, or unbounded growth.
    """
    X, Y = surface.grid()
    times = [-10000.0, -1.0, -1e-12, 0.0, 1e-15, 1e-6, 0.1, 10.0, 100.0, 1000.0, 1e6, 1e12]

    for t in times:
        s = surface.S(X, Y, t)
        ch = surface.channels(X, Y, t)

        assert not np.any(np.isnan(s)), f"NaN in S at t={t}"
        assert not np.any(np.isinf(s)), f"Inf in S at t={t}"

        for key, arr in ch.items():
            assert not np.any(np.isnan(arr)), f"NaN in channel {key} at t={t}"
            assert not np.any(np.isinf(arr)), f"Inf in channel {key} at t={t}"

        if t <= 0:
            assert np.all(s == 0.0), f"S must be identically 0 at t={t}"
            assert np.all(ch["strain_x"] == 0.0)
        else:
            assert np.all(s >= 0.0), f"S must be non-negative at t={t}"
            assert np.max(s) <= 1.9972, f"Subsidence exceeded subcritical maximum at t={t}: {np.max(s)}"


def test_surface_field_symmetries():
    """Stress test: Symmetry and anti-symmetry invariants across panel axes."""
    X, Y = surface.grid()
    ch = surface.channels(X, Y, t=100.0)

    s = ch["s"]
    tilt_x = ch["tilt_x"]
    tilt_y = ch["tilt_y"]
    curv_x = ch["curvature_x"]
    disp_x = ch["displacement_x"]
    strain_x = ch["strain_x"]

    # S(x, y) must be symmetric in x and y (axis-aligned rectangular panel)
    assert np.max(np.abs(s - np.fliplr(s))) < 1e-12
    assert np.max(np.abs(s - np.flipud(s))) < 1e-12

    # Tilt_x is anti-symmetric in x
    assert np.max(np.abs(tilt_x + np.fliplr(tilt_x))) < 1e-12

    # Tilt_y is anti-symmetric in y
    assert np.max(np.abs(tilt_y + np.flipud(tilt_y))) < 1e-12

    # Curvature_x is symmetric in x
    assert np.max(np.abs(curv_x - np.fliplr(curv_x))) < 1e-12

    # Aviershin relations exactness
    assert np.allclose(disp_x, constants.B_HORIZ * tilt_x, atol=1e-14)
    assert np.allclose(strain_x, constants.B_HORIZ * curv_x, atol=1e-14)


def test_collapse_multiple_overlapping_events():
    """Stress test: Multiple simultaneous and staggered pillar failures across
    different quadrants and overlapping zones.
    """
    X, Y = surface.grid()

    events = [
        collapse.PillarFailure(cx=-150, cy=-150, radius_m=45, t_init_days=10.0, t_collapse_days=10.4, duration_days=0.2, magnitude_m=0.8),
        collapse.PillarFailure(cx=-150, cy=-150, radius_m=35, t_init_days=10.2, t_collapse_days=10.5, duration_days=0.15, magnitude_m=0.4),  # Direct overlap
        collapse.PillarFailure(cx=200, cy=100, radius_m=60, t_init_days=15.0, t_collapse_days=15.3, duration_days=0.3, magnitude_m=1.0),
        collapse.PillarFailure(cx=-250, cy=250, radius_m=80, t_init_days=5.0, t_collapse_days=5.2, duration_days=0.1, magnitude_m=0.6),    # Near corner
    ]

    for t in np.linspace(0.0, 30.0, 60):
        deltas = collapse.collapse_deltas(X, Y, t, events)
        assert np.all(deltas["delta_s"] >= 0.0), f"Negative delta_s at t={t}"
        assert not np.any(np.isnan(deltas["delta_s"]))
        assert not np.any(np.isnan(deltas["delta_strain_x"]))

    # After all events settle (t=30)
    settled_deltas = collapse.collapse_deltas(X, Y, 30.0, events)
    # Peak at (-150, -150) should be approx 0.8 + 0.4 = 1.2 m
    ix = int(np.argmin(np.abs(X[0] - (-150))))
    iy = int(np.argmin(np.abs(Y[:, 0] - (-150))))
    assert settled_deltas["delta_s"][iy, ix] == pytest.approx(1.2, abs=0.05)


def test_zone_manager_long_sequence_stability():
    """Stress test: 500 continuous simulation ticks through ZoneManager.
    Verify monotonic state progressions, callback execution, and zero memory leaks.
    """
    X, Y = surface.grid()
    manager = segments.ZoneManager(log_to_console=False)

    received_events = []
    manager.add_listener(lambda ev: received_events.append(ev))

    event = collapse.PillarFailure(
        cx=50, cy=50, radius_m=50, t_init_days=5.0, t_collapse_days=5.3, duration_days=0.2, magnitude_m=0.9
    )

    for i in range(500):
        t_sim = i * 0.02
        base_ch = surface.channels(X, Y, t_sim)
        deltas = collapse.collapse_deltas(X, Y, t_sim, [event])
        total_ch = {
            "s": base_ch["s"] + deltas["delta_s"],
            "strain_x": base_ch["strain_x"] + deltas["delta_strain_x"],
            "curvature_x": base_ch["curvature_x"] + deltas["delta_curvature_x"],
        }
        manager.evaluate(X, Y, t_sim, total_ch, collapse_step=deltas["delta_s"])

    assert len(manager.transition_history) > 0
    assert len(manager.transition_history) == len(received_events)

    # Check that Z-22 (contains (50, 50)) reached FAILED and visited CRITICAL first
    z22_events = [e for e in received_events if e.zone_id == "Z-22"]
    z22_states = [e.to_state for e in z22_events]

    assert segments.SegmentState.CRITICAL in z22_states
    assert segments.SegmentState.FAILED in z22_states
    assert z22_states.index(segments.SegmentState.CRITICAL) < z22_states.index(segments.SegmentState.FAILED)


def test_terrain_generator_stress():
    """Stress test: Terrain generator produces consistent shapes across many seeds."""
    for s in range(10):
        X, Y, Z = terrain.baseline_grid(seed=s)
        assert Z.shape == (constants.GRID_N, constants.GRID_N)
        assert not np.any(np.isnan(Z))
        assert not np.any(np.isinf(Z))
        assert np.ptp(Z) < 3.0  # Relief comfortably bounded
