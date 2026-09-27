"""
P1: the collapse tilt/curvature boost applies only while the pillar is yielding.

After the step completes, delta tilt must be the true slope of delta_s. The
Gaussian sigma is EVENT_SIGMA_FRAC (0.5) * radius_m (M1, DATA-365 plan), so a
0.5 m / 100 m Gaussian pit's sigma is 50 m and it peaks at
0.5 * exp(-0.5) / 50 = 6.07 mm/m.
"""

import numpy as np

from sandbox import surface
from sandbox.collapse import PillarFailure, collapse_deltas

T_INIT, T_COLLAPSE, DURATION = 10.0, 10.5, 0.2


def _event() -> PillarFailure:
    return PillarFailure(
        cx=0.0,
        cy=0.0,
        radius_m=100.0,
        magnitude_m=0.5,
        t_init_days=T_INIT,
        t_collapse_days=T_COLLAPSE,
        duration_days=DURATION,
    )


def _centre_row(t: float):
    X, Y = surface.grid()
    d = collapse_deltas(X, Y, t, [_event()])
    iy = int(np.argmin(np.abs(Y[:, 0])))
    grad = np.gradient(d["delta_s"], 2.5, axis=1)[iy]
    return d, d["delta_tilt_x"][iy], grad


def test_settled_tilt_matches_gradient():
    _, tilt, grad = _centre_row(T_COLLAPSE + DURATION + 1.0)
    mask = np.abs(tilt) > 0.1 * np.abs(tilt).max()
    rel = np.abs(tilt[mask] - grad[mask]) / np.abs(grad[mask])
    assert rel.max() < 0.02


def test_settled_peak_slope():
    d, _, _ = _centre_row(T_COLLAPSE + DURATION + 1.0)
    peak = np.hypot(d["delta_tilt_x"], d["delta_tilt_y"]).max() * 1000.0
    assert abs(peak - 0.5 * np.exp(-0.5) / 50.0 * 1000.0) < 0.05
    assert abs(peak - 6.07) < 0.05


def test_yielding_tilt_still_boosted():
    _, tilt, grad = _centre_row(0.5 * (T_INIT + T_COLLAPSE))
    i = int(np.argmax(np.abs(grad)))
    assert abs(tilt[i]) > 1.5 * abs(grad[i])


# --- M1 (DATA-365 plan): the event shape fix's own two checks -------------

def test_default_apply_collapse_stays_under_30mm_per_m_strain():
    """The session's own default intervention (`apply_collapse`'s radius_m=60,
    magnitude_m=0.75) must produce a plausible strain field, not the hundreds
    of mm/m the panel-scale B_HORIZ produced on a small pit before M1."""
    pf = PillarFailure(
        cx=0.0, cy=0.0, radius_m=60.0, magnitude_m=0.75,
        t_init_days=0.0, t_collapse_days=0.2, duration_days=0.2,
    )
    xs = np.linspace(-600.0, 600.0, 2401)
    X, Y = np.meshgrid(xs, xs)
    d = collapse_deltas(X, Y, 5.0, [pf])
    peak_strain = float(np.hypot(d["delta_strain_x"], d["delta_strain_y"]).max() * 1000.0)
    assert peak_strain <= 30.0, f"default cave-in peak strain {peak_strain:.1f} mm/m"


def test_100m_10m_cave_in_flags_at_most_12_of_31_nodes():
    """A 100 m radius / 10 m deep FORGE cave-in used to flag 21 of 31 nodes
    non-normal (6 CRITICAL, 15 WARNING) because the panel-scale B_HORIZ and
    sigma=R Gaussian tail still gave > 3 mm/m of slope at 2.5R. After M1,
    measured: 8 of 31 (5 CRITICAL, 3 WARNING)."""
    from collections import Counter

    from forge import states
    from sandbox import surface
    from sandbox.events import to_failures
    from sandbox.sensors import SensorArray, SensorNoiseConfig

    ev = {
        "type": "cave_in", "x": 0.0, "y": 0.0, "radius_m": 100.0,
        "depth_m": 10.0, "day": 10.0, "duration_h": 4.8, "warning_hours": 2.4,
    }
    events = [ev]
    by_event = [to_failures(ev)]
    X, Y = surface.grid()
    t_settled = ev["day"] + ev["duration_h"] / 24.0 + 1.0
    delta = collapse_deltas(X, Y, t_settled, by_event[0])
    nodes = SensorArray(SensorNoiseConfig(enable_noise=False)).nodes
    node_states = states.forge_node_states(nodes, events, by_event, t_settled, delta)
    counts = Counter(node_states.values())
    non_normal = sum(v for k, v in counts.items() if k != "ACTIVE")
    assert non_normal <= 12, f"100m/10m cave-in flagged {non_normal}/31 nodes: {counts}"
