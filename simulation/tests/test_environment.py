"""Tests for seeded mine-year environment (plan step E1).

Validates:
- Deterministic seeding (identical output on same seed, different on different seeds)
- Rainfall annual total in 600-1100 mm with >= 70% in monsoon (June-September)
- Air temperature seasonal cycle (May mean >= Jan mean + 8 C)
- Pore pressure (Tier 2B only, August mean >= April mean + 10 kPa)
- Moisture (Tier 1C only, 10% base, capped at 45%)
- Production blast schedule (300 +/- 20 blasts, none on Sundays/holidays, hour 7)
- PPV vibration attenuation (finite, falling with distance, 10-40 Hz)
- Device status (battery >= 3.3V, packet loss 1-3%, 1x 5d August outage, 1x 6h gateway outage, 1x 3d stuck strain gauge)
- Build time < 3 s
"""

import math
import time
import numpy as np
import pytest

from sandbox import layout
from sandbox.environment import (
    DAYS_IN_YEAR,
    MINE_HOLIDAYS_DAYS,
    TOTAL_HOURS,
    build_year,
    dominant_frequency,
    ppv,
)


@pytest.fixture(scope="module")
def env_default():
    """Shared default environment year for seed 42."""
    return build_year(42)


def test_seed_reproducibility():
    """Same seed gives identical output; different seed gives different output."""
    e1 = build_year(101)
    e2 = build_year(101)
    e_diff = build_year(202)

    # Identical on same seed
    np.testing.assert_array_equal(e1.air_temp_c, e2.air_temp_c)
    np.testing.assert_array_equal(e1.rain_mm, e2.rain_mm)
    np.testing.assert_allclose(e1.pore_pressure_kpa, e2.pore_pressure_kpa, equal_nan=True)
    np.testing.assert_allclose(e1.moisture_pct, e2.moisture_pct, equal_nan=True)
    np.testing.assert_array_equal(e1.battery_v, e2.battery_v)
    np.testing.assert_array_equal(e1.online, e2.online)
    np.testing.assert_array_equal(e1.stuck, e2.stuck)
    assert len(e1.blasts) == len(e2.blasts)
    assert e1.events == e2.events

    # Different on different seed
    assert not np.array_equal(e1.air_temp_c, e_diff.air_temp_c)
    assert not np.array_equal(e1.rain_mm, e_diff.rain_mm)
    assert not np.array_equal(e1.battery_v, e_diff.battery_v)
    assert not np.array_equal(e1.online, e_diff.online)


@pytest.mark.parametrize("seed", [42, 123, 777, 999])
def test_rain_total_and_monsoon_fraction(seed):
    """Rain total 600-1100 mm, with >= 70% in June-September."""
    env = build_year(seed)
    total_rain = float(np.sum(env.rain_mm))

    # June 1 = day 151 (hour 151 * 24 = 3624)
    # September 30 = day 272 ends at day 273 (hour 273 * 24 = 6552)
    jjas_hours = slice(151 * 24, 273 * 24)
    jjas_rain = float(np.sum(env.rain_mm[jjas_hours]))
    jjas_fraction = jjas_rain / total_rain

    assert 600.0 <= total_rain <= 1100.0, f"Rain total {total_rain:.1f} mm outside [600, 1100]"
    assert jjas_fraction >= 0.70, f"JJAS rain fraction {jjas_fraction:.3f} < 0.70"


def test_temperature_seasonal_swing(env_default):
    """May mean temperature >= Jan mean + 8 C."""
    # January: days 0..30 (hours 0..31*24)
    jan_mean = float(np.mean(env_default.air_temp_c[0 : 31 * 24]))
    # May: days 120..150 (hours 120*24..151*24)
    may_mean = float(np.mean(env_default.air_temp_c[120 * 24 : 151 * 24]))

    delta_t = may_mean - jan_mean
    assert delta_t >= 8.0, f"May-Jan temp delta {delta_t:.2f} C < 8.0 C (Jan={jan_mean:.1f}, May={may_mean:.1f})"


def test_pore_pressure_and_moisture_tiers(env_default):
    """Pore pressure on Tier 2B only; August mean >= April mean + 10 kPa. Moisture on Tier 1C only."""
    tiers = env_default.node_tiers
    num_nodes = len(tiers)

    # 1. Pore pressure checks
    tier_2b_indices = [i for i, t in enumerate(tiers) if t == layout.TIER_2B]
    assert len(tier_2b_indices) == 2, "Expected 2 Tier 2B borehole nodes"

    for i in range(num_nodes):
        if i in tier_2b_indices:
            # Must have valid non-NaN readings
            assert not np.isnan(env_default.pore_pressure_kpa[i]).any()
            # April: days 90..119 (hours 90*24..120*24)
            apr_mean = float(np.mean(env_default.pore_pressure_kpa[i, 90 * 24 : 120 * 24]))
            # August: days 212..242 (hours 212*24..243*24)
            aug_mean = float(np.mean(env_default.pore_pressure_kpa[i, 212 * 24 : 243 * 24]))
            delta_pp = aug_mean - apr_mean
            assert delta_pp >= 10.0, f"Node {env_default.node_ids[i]} Aug-Apr pore pressure delta {delta_pp:.2f} kPa < 10 kPa"
        else:
            # Must be NaN for all other tiers
            assert np.isnan(env_default.pore_pressure_kpa[i]).all()

    # 2. Moisture checks (Tier 1C only, 10% base, capped at 45%)
    tier_1c_indices = [i for i, t in enumerate(tiers) if t == layout.TIER_1C]
    assert len(tier_1c_indices) == 6, "Expected 6 Tier 1C fault transect nodes"

    for i in range(num_nodes):
        if i in tier_1c_indices:
            vals = env_default.moisture_pct[i]
            assert not np.isnan(vals).any()
            assert np.all(vals >= 10.0), f"Moisture dropped below 10%: min={vals.min()}"
            assert np.all(vals <= 45.0), f"Moisture exceeded 45% cap: max={vals.max()}"
        else:
            assert np.isnan(env_default.moisture_pct[i]).all()


def test_blasts_schedule_and_locations(env_default):
    """Blasts 300 +/- 20, none on Sundays, all at hour 7, Q in [20, 60] kg."""
    blasts = env_default.blasts
    n_blasts = len(blasts)
    assert 280 <= n_blasts <= 320, f"Blast count {n_blasts} outside 300 +/- 20"

    for b in blasts:
        # None on Sundays (day 3 is Sunday Jan 4, 2026; (day - 3) % 7 == 0)
        assert (b.day - 3) % 7 != 0, f"Blast on Sunday at day {b.day}"
        # None on the 10 gazetted mine holidays
        assert b.day not in MINE_HOLIDAYS_DAYS, f"Blast on holiday at day {b.day}"
        # All at hour 7 (07:30 UTC falls in hour 7)
        assert b.t_hour % 24 == 7, f"Blast at hour {b.t_hour % 24}, expected hour 7"
        # Charge in [20, 60] kg
        assert 20.0 <= b.q_kg <= 60.0
        # Depth 375 m
        assert b.z_m == -375.0


def test_ppv_vibration_attenuation(env_default):
    """PPV is finite and strictly falls with distance; dominant frequency is 10-40 Hz."""
    q = 40.0
    d_near = 375.0   # Directly above charge
    d_mid = 650.0
    d_far = 1400.0

    ppv_near = ppv(d_near, q)
    ppv_mid = ppv(d_mid, q)
    ppv_far = ppv(d_far, q)

    # Finite and positive
    assert math.isfinite(ppv_near) and math.isfinite(ppv_mid) and math.isfinite(ppv_far)
    assert ppv_near > 0.0 and ppv_mid > 0.0 and ppv_far > 0.0

    # Strictly falling with distance
    assert ppv_near > ppv_mid > ppv_far

    # Dominant frequency: 10-40 Hz, falling with distance
    f_near = dominant_frequency(d_near)
    f_mid = dominant_frequency(d_mid)
    f_far = dominant_frequency(d_far)

    assert 10.0 <= f_far < f_mid < f_near <= 40.0
    assert abs(ppv_near.fdom_hz - f_near) < 1e-4

    # Instance method forwarder on EnvironmentYear
    assert abs(env_default.ppv(d_near, q) - ppv_near) < 1e-6


def test_device_august_outage(env_default):
    """Exactly one 5-day offline node in August."""
    # August: days 212..242 (hours 212*24..243*24)
    aug_slice = slice(212 * 24, 243 * 24)
    online_aug = env_default.online[:, aug_slice]

    long_outage_nodes = []
    for i, nid in enumerate(env_default.node_ids):
        offline_mask = ~online_aug[i]
        # Find maximum consecutive offline hours
        max_consec = 0
        cur_consec = 0
        for is_off in offline_mask:
            if is_off:
                cur_consec += 1
                if cur_consec > max_consec:
                    max_consec = cur_consec
            else:
                cur_consec = 0
        if max_consec >= 120:  # 5 days = 120 hours
            long_outage_nodes.append((int(nid), max_consec))

    assert len(long_outage_nodes) == 1, f"Expected 1 node with 5-day August outage, found: {long_outage_nodes}"
    node_id, consec_h = long_outage_nodes[0]
    assert consec_h == 120, f"August outage duration {consec_h} h != 120 h"


def test_device_gateway_outage(env_default):
    """Gateway outage lasts exactly 6 h."""
    tiers = env_default.node_tiers
    gw_idx = [i for i, t in enumerate(tiers) if t == layout.TIER_3][0]

    # Find continuous offline periods for the gateway
    gw_offline = ~env_default.online[gw_idx]
    runs = []
    cur_start = None
    cur_len = 0
    for h, is_off in enumerate(gw_offline):
        if is_off:
            if cur_start is None:
                cur_start = h
            cur_len += 1
        else:
            if cur_len > 0:
                runs.append((cur_start, cur_len))
                cur_start = None
                cur_len = 0
    if cur_len > 0:
        runs.append((cur_start, cur_len))

    # Gateway has random packet drops (mostly 1h) and one multi-hour outage
    gw_outages = [r for r in runs if r[1] >= 4]
    assert len(gw_outages) == 1, f"Expected exactly 1 major gateway outage, got {gw_outages}"
    start_h, length_h = gw_outages[0]
    assert length_h == 6, f"Gateway outage lasted {length_h} h, expected 6 h"


def test_device_battery_voltage(env_default):
    """Battery >= 3.3 V for all nodes across all hours."""
    min_v = float(np.min(env_default.battery_v))
    max_v = float(np.max(env_default.battery_v))
    assert min_v >= 3.30, f"Battery voltage dropped below 3.30 V: min={min_v:.4f} V"
    assert max_v <= 3.60, f"Battery voltage exceeded 3.60 V: max={max_v:.4f} V"

    # Replacement events logged in event stream
    batt_events = [ev for ev in env_default.events if ev["type"] == "battery_replaced"]
    assert len(batt_events) >= len(env_default.node_ids), "Expected at least one battery replacement per node"


def test_device_packet_loss_rate(env_default):
    """Packet loss 1-3% per node and overall."""
    num_nodes = len(env_default.node_ids)
    loss_rates = np.mean(~env_default.online, axis=1)

    for i in range(num_nodes):
        rate = float(loss_rates[i])
        nid = env_default.node_ids[i]
        assert 0.01 <= rate <= 0.03, f"Node {nid} packet loss {rate*100:.2f}% outside [1%, 3%]"

    overall_loss = float(np.mean(~env_default.online))
    assert 0.01 <= overall_loss <= 0.03, f"Overall packet loss {overall_loss*100:.2f}% outside [1%, 3%]"


def test_device_strain_stuck(env_default):
    """One Tier 1B strain gauge stuck for exactly 3 days (72 hours)."""
    stuck_arr = env_default.stuck
    total_stuck_hours = int(np.sum(stuck_arr))
    assert total_stuck_hours == 72, f"Total stuck hours across all nodes = {total_stuck_hours}, expected 72"

    stuck_node_indices = np.where(np.any(stuck_arr, axis=1))[0]
    assert len(stuck_node_indices) == 1, f"Expected 1 node stuck, got {len(stuck_node_indices)}"

    stuck_idx = stuck_node_indices[0]
    assert env_default.node_tiers[stuck_idx] == layout.TIER_1B, "Stuck node must be Tier 1B"


def test_build_year_runtime():
    """Build year completes in under 3 seconds."""
    t0 = time.perf_counter()
    env = build_year(42)
    elapsed = time.perf_counter() - t0

    assert elapsed < 3.0, f"build_year took {elapsed:.2f} s, exceeds 3.0 s budget"
    assert env.air_temp_c.shape == (TOTAL_HOURS,)
    assert env.rain_mm.shape == (TOTAL_HOURS,)
    assert env.battery_v.shape == (31, TOTAL_HOURS)
