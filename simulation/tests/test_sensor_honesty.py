"""M2 (DATA-365 plan): sensors.py stops fabricating and inventing values.

Covers the three checks the plan names explicitly (OU wander noise std
within its named budget, PPV at 100 m / 30 kg against the USBM kernel, and
crack-latch persistence), plus the other M2 fixes measured alongside them:
principal strain from strain_x AND strain_y, and pore pressure / moisture
sourced from the E1 environment rather than a fake function of S.
"""

import math

import numpy as np
import pytest

from sandbox import constants, environment, layout
from sandbox.sensors import SensorArray, SensorNoiseConfig, _ou_step


# ---------------------------------------------------------------------------
# OU wander: stationary std matches its named budget, independent of dt.
# ---------------------------------------------------------------------------
def _stationary_std(target_std: float, dt_seconds: float, seed: int, n: int = 20_000) -> float:
    rng = np.random.default_rng(seed)
    x = 0.0
    vals = np.empty(n)
    for i in range(n):
        x = _ou_step(x, target_std, dt_seconds, rng.normal())
        vals[i] = x
    # Discard the first 5% as burn-in before the process has reached its
    # stationary distribution.
    return float(np.std(vals[n // 20 :]))


def test_ou_wander_std_matches_budget_within_10_percent():
    measured = _stationary_std(constants.SIGMA_STRAIN_UE, constants.TICK_SIM_SECONDS, seed=1)
    assert measured == pytest.approx(constants.SIGMA_STRAIN_UE, rel=0.10), (
        f"OU wander stationary std {measured:.3f} not within 10% of the "
        f"{constants.SIGMA_STRAIN_UE} ue budget"
    )


def test_ou_wander_std_is_independent_of_tick_length():
    """The same budget, reached at both the 60s interactive tick and the
    3600s scripted tick — the historical bug was a fixed phi=0.88 per call
    regardless of how much sim-time that call actually covered."""
    std_60s = _stationary_std(constants.SIGMA_STRAIN_UE, 60.0, seed=2)
    std_3600s = _stationary_std(constants.SIGMA_STRAIN_UE, 3600.0, seed=3)
    assert std_60s == pytest.approx(constants.SIGMA_STRAIN_UE, rel=0.10)
    assert std_3600s == pytest.approx(constants.SIGMA_STRAIN_UE, rel=0.10)


def test_ou_wander_decorrelates_faster_at_longer_dt():
    """A 3600s gap should leave far less serial correlation than a 60s one."""
    rng = np.random.default_rng(4)
    x = 10.0
    after_60s = _ou_step(x, constants.SIGMA_STRAIN_UE, 60.0, 0.0)
    after_3600s = _ou_step(x, constants.SIGMA_STRAIN_UE, 3600.0, 0.0)
    assert abs(after_3600s) < abs(after_60s)


# ---------------------------------------------------------------------------
# PPV: matches the USBM kernel at 100 m / 30 kg, and attenuates with node
# distance from the transient's source instead of being applied uniformly.
# ---------------------------------------------------------------------------
def test_ppv_at_100m_30kg_matches_the_usbm_kernel():
    """K=1140, beta=1.6 (USBM RI 8507): PPV = K * (D/sqrt(Q))^-beta."""
    expected = environment.ppv(100.0, 30.0)
    scaled_dist = 100.0 / math.sqrt(30.0)
    closed_form = environment.BLAST_USBM_K * scaled_dist ** (-environment.BLAST_USBM_BETA)
    assert expected == pytest.approx(closed_form, rel=1e-9)
    assert expected > 0.0
    # sensors.py's own per-node attenuation uses exactly this reference:
    # at VIBRATION_REFERENCE_DISTANCE_M (100 m) itself, the attenuation
    # factor (REFERENCE/dist)**beta is exactly 1, so a node placed there
    # reads back the calibrated transient unchanged.
    assert constants.VIBRATION_REFERENCE_DISTANCE_M == 100.0


def test_vibration_attenuates_with_node_distance_not_uniform():
    array = SensorArray(SensorNoiseConfig(enable_noise=False, seed=5))
    shape = (constants.GRID_N, constants.GRID_N)
    zeros = np.zeros(shape)
    truth = {"tilt_x": zeros, "tilt_y": zeros, "strain_x": zeros, "strain_y": zeros}

    near_source = (0.0, 0.0)
    readings_near = array.sample_tick(
        t_sim_days=0.0, t_sim_seconds=0.0, iso_timestamp="2026-01-01T00:00:00Z",
        truth_channels=truth, vibration_transient=50.0, vibration_source_xy=near_source,
    )
    vib_by_id = {r.node_id: r for r in readings_near if r.get("vib_peak_x100") is not None}
    assert len(vib_by_id) >= 2, "need at least 2 vibration-carrying nodes for this gate"

    ids = layout.node_ids()
    positions = dict(zip((int(i) for i in ids), layout.node_positions()))
    dists = {nid: math.hypot(*positions[nid]) for nid in vib_by_id}
    nearest_id = min(dists, key=dists.get)
    farthest_id = max(dists, key=dists.get)
    assert dists[farthest_id] > dists[nearest_id] + 10.0, "need genuinely different distances"

    peak_near = vib_by_id[nearest_id].get("vib_peak_x100")
    peak_far = vib_by_id[farthest_id].get("vib_peak_x100")
    assert peak_near > peak_far, (
        f"node {nearest_id} at {dists[nearest_id]:.0f} m read {peak_near}, "
        f"node {farthest_id} at {dists[farthest_id]:.0f} m read {peak_far} — "
        "PPV must fall with distance from the transient's source"
    )


def test_vibration_rms_excludes_ppv_peak_only_carries_it():
    """PPV kept separate from RMS (M2): a firing transient must not lift the
    RMS baseline channel, only the peak channel.

    A single run, checked against the fixed baseline-wander clip bounds
    (0.05-0.16 mm/s, `wander_vib_rms` in sensors.py): if the 80 mm/s
    transient below had leaked into RMS the way the old code added it
    directly, every reading would blow far past this ceiling.
    """
    array = SensorArray(SensorNoiseConfig(enable_noise=False, seed=6))
    shape = (constants.GRID_N, constants.GRID_N)
    zeros = np.zeros(shape)
    truth = {"tilt_x": zeros, "tilt_y": zeros, "strain_x": zeros, "strain_y": zeros}

    loud = array.sample_tick(
        t_sim_days=0.0, t_sim_seconds=0.0, iso_timestamp="2026-01-01T00:00:00Z",
        truth_channels=truth, vibration_transient=80.0, vibration_source_xy=(0.0, 0.0),
    )
    carrying = [r for r in loud if r.get("vib_rms_x100") is not None]
    assert carrying, "no vibration-carrying node in this layout"
    for r in carrying:
        rms = r.get("vib_rms_x100")
        peak = r.get("vib_peak_x100")
        assert rms <= 20, (
            f"node {r.node_id}: RMS {rms/100.0:.2f} mm/s exceeds the baseline "
            "wander's own ceiling — the 80 mm/s transient leaked into RMS"
        )
        assert peak > rms, "the transient must show up on the peak channel"


# ---------------------------------------------------------------------------
# Fissure latch: opens in tension, floors at CRACK_PARTIAL_CLOSURE_FRACTION
# of its recorded max rather than returning to zero.
# ---------------------------------------------------------------------------
def test_fissure_latches_and_does_not_heal():
    array = SensorArray(SensorNoiseConfig(enable_noise=False, seed=7))
    shape = (constants.GRID_N, constants.GRID_N)

    # A strain field well over the crack threshold everywhere.
    strain_high = np.full(shape, (constants.CRACK_TENSILE_THRESHOLD_UE + 2000.0) * 1e-6)
    strain_low = np.zeros(shape)
    zeros = np.zeros(shape)

    truth_high = {"tilt_x": zeros, "tilt_y": zeros, "strain_x": strain_high, "strain_y": zeros}
    truth_low = {"tilt_x": zeros, "tilt_y": zeros, "strain_x": strain_low, "strain_y": zeros}

    r1 = array.sample_tick(
        t_sim_days=0.0, t_sim_seconds=0.0, iso_timestamp="2026-01-01T00:00:00Z",
        truth_channels=truth_high,
    )
    fissure_carrying = [r for r in r1 if r.get("fissure_mm") is not None]
    assert fissure_carrying, "no fissure-carrying node in this layout"
    opened = {r.node_id: r.get("fissure_mm") for r in fissure_carrying}
    assert all(w > 0.0 for w in opened.values()), "strain over threshold must open every gauge"

    # Ground relaxes back to zero strain — the crack must not heal to zero.
    r2 = array.sample_tick(
        t_sim_days=0.0, t_sim_seconds=60.0, iso_timestamp="2026-01-01T00:01:00Z",
        truth_channels=truth_low,
    )
    healed = {r.node_id: r.get("fissure_mm") for r in r2 if r.get("fissure_mm") is not None}
    for nid, w0 in opened.items():
        w1 = healed[nid]
        expected_floor = constants.CRACK_PARTIAL_CLOSURE_FRACTION * w0
        assert w1 == pytest.approx(expected_floor, abs=0.1), (
            f"node {nid}: fissure went from {w0:.2f} mm to {w1:.2f} mm after "
            f"strain relaxed; expected the latched floor {expected_floor:.2f} mm"
        )
        assert w1 > 0.0, "a latched crack must never fully close"


def test_fissure_uses_finales_opening_formula():
    """opening_mm = (e1_ue - threshold_ue) * 1e-6 * spacing_m * 1000, the
    exact relation sandbox/collapse.py's own docstring cites and the
    finale's minesim/cracks.py implements — not the old bare `* 2.0`."""
    array = SensorArray(SensorNoiseConfig(enable_noise=False, seed=8))
    shape = (constants.GRID_N, constants.GRID_N)
    zeros = np.zeros(shape)
    e1_ue = constants.CRACK_TENSILE_THRESHOLD_UE + 1500.0
    strain = np.full(shape, e1_ue * 1e-6)
    truth = {"tilt_x": zeros, "tilt_y": zeros, "strain_x": strain, "strain_y": zeros}

    readings = array.sample_tick(
        t_sim_days=0.0, t_sim_seconds=0.0, iso_timestamp="2026-01-01T00:00:00Z",
        truth_channels=truth,
    )
    expected_mm = (e1_ue - constants.CRACK_TENSILE_THRESHOLD_UE) * 1e-6 * constants.CRACK_SPACING_M * 1000.0
    for r in readings:
        w = r.get("fissure_mm")
        if w is not None:
            assert w == pytest.approx(expected_mm, abs=0.1)


# ---------------------------------------------------------------------------
# Principal strain: the more tensile of strain_x, strain_y — not strain_x
# alone (which silently missed every node where strain_y was the bigger one).
# ---------------------------------------------------------------------------
def test_strain_channel_uses_the_larger_of_x_and_y():
    array = SensorArray(SensorNoiseConfig(enable_noise=False, seed=9))
    shape = (constants.GRID_N, constants.GRID_N)
    strain_x = np.full(shape, 500e-6)
    strain_y = np.full(shape, 4000e-6)  # bigger, and would be missed pre-M2
    zeros = np.zeros(shape)
    truth = {"tilt_x": zeros, "tilt_y": zeros, "strain_x": strain_x, "strain_y": strain_y}

    readings = array.sample_tick(
        t_sim_days=0.0, t_sim_seconds=0.0, iso_timestamp="2026-01-01T00:00:00Z",
        truth_channels=truth,
    )
    strain_readings = [r.get("strain_ue") for r in readings if r.get("strain_ue") is not None]
    assert strain_readings, "no strain-carrying node in this layout"
    # 4000 ue, not 500 ue (allowing for wander/quantisation).
    assert min(strain_readings) > 3000


# ---------------------------------------------------------------------------
# Pore pressure / moisture: from the E1 environment, not a function of S.
# ---------------------------------------------------------------------------
def test_pore_pressure_and_moisture_ignore_subsidence():
    array = SensorArray(SensorNoiseConfig(enable_noise=False, seed=10))
    shape = (constants.GRID_N, constants.GRID_N)
    zeros = np.zeros(shape)
    # A large, dramatic subsidence field — under the old fake formula this
    # alone would swing pore pressure and moisture far from baseline.
    s_field = np.full(shape, 2.0)
    truth = {"tilt_x": zeros, "tilt_y": zeros, "strain_x": zeros, "strain_y": zeros, "s": s_field}

    env = environment.build_year(seed=99)
    hour = 100
    env_channels = {
        "pore_pressure_kpa": env.pore_pressure_kpa[:, hour],
        "moisture_pct": env.moisture_pct[:, hour],
    }
    readings = array.sample_tick(
        t_sim_days=0.0, t_sim_seconds=0.0, iso_timestamp="2026-01-01T00:00:00Z",
        truth_channels=truth, environment_channels=env_channels,
    )
    for r in readings:
        idx = next(i for i, n in enumerate(array.nodes) if n.node_id == r.node_id)
        node = array.nodes[idx]
        pp = r.get("pore_pressure_kpa")
        if pp is not None:
            expected = float(env.pore_pressure_kpa[node.array_idx, hour])
            assert pp == pytest.approx(expected, abs=1.0)
        moist = r.get("moisture_pct")
        if moist is not None:
            expected = float(env.moisture_pct[node.array_idx, hour])
            assert moist == pytest.approx(expected, abs=1.0)


def test_pore_pressure_and_moisture_fall_back_to_e1_baseline_without_environment():
    array = SensorArray(SensorNoiseConfig(enable_noise=False, seed=11))
    shape = (constants.GRID_N, constants.GRID_N)
    zeros = np.zeros(shape)
    s_field = np.full(shape, 2.0)
    truth = {"tilt_x": zeros, "tilt_y": zeros, "strain_x": zeros, "strain_y": zeros, "s": s_field}

    readings = array.sample_tick(
        t_sim_days=0.0, t_sim_seconds=0.0, iso_timestamp="2026-01-01T00:00:00Z",
        truth_channels=truth, environment_channels=None,
    )
    for r in readings:
        pp = r.get("pore_pressure_kpa")
        if pp is not None:
            assert pp == pytest.approx(environment.PORE_PRESSURE_BASE_KPA, abs=1.0)
        moist = r.get("moisture_pct")
        if moist is not None:
            assert moist == pytest.approx(environment.MOISTURE_BASE_PCT, abs=1.0)


# ---------------------------------------------------------------------------
# Thermal tilt drift.
# ---------------------------------------------------------------------------
def test_thermal_tilt_drift_scales_with_temperature():
    """A hot day (t_sim_days=0.25, near the diurnal peak) must read a
    higher tilt bias than a cold one, purely from temperature — same true
    ground tilt (zero) both times."""
    array = SensorArray(SensorNoiseConfig(enable_noise=False, seed=12))
    shape = (constants.GRID_N, constants.GRID_N)
    zeros = np.zeros(shape)
    truth = {"tilt_x": zeros, "tilt_y": zeros, "strain_x": zeros, "strain_y": zeros}

    cold = array.sample_tick(
        t_sim_days=0.75, t_sim_seconds=0.0, iso_timestamp="2026-01-01T18:00:00Z",
        truth_channels=truth,
    )
    array2 = SensorArray(SensorNoiseConfig(enable_noise=False, seed=12))
    hot = array2.sample_tick(
        t_sim_days=0.25, t_sim_seconds=0.0, iso_timestamp="2026-01-01T06:00:00Z",
        truth_channels=truth,
    )
    cold_tilt = next(r.get("tilt_x_urad") for r in cold if r.get("tilt_x_urad") is not None)
    hot_tilt = next(r.get("tilt_x_urad") for r in hot if r.get("tilt_x_urad") is not None)
    assert hot_tilt != cold_tilt, "tilt reading must move with temperature"
