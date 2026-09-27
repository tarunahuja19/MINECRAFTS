"""Seeded, deterministic 365-day mine environment (plan step E1).

Generates an hourly, multi-hazard environmental context for the 31-node Adriyala
monitoring network over a full 365-day operational year (day 0 = 2026-01-01 UTC).

Pure numerical generation driven exclusively by `np.random.default_rng(seed)`.
No fabricated values; every constant is sourced or marked ASSUMED/VERIFY.

Components:
- Air temperature: Ramagundam monthly normals (IMD, VERIFY) + diurnal cycle (peak 08:30 UTC) + AR(1) noise.
- Rainfall: Southwest monsoon June-September from monthly normals (~1000 mm annual, VERIFY), stochastic wet/dry days.
- Pore pressure (Tier 2B only): 294 kPa hydrostatic base (ASSUMED) + linear reservoir (tau 10 d, 9.81 kPa/m) + 0.5 kPa noise.
- Moisture (Tier 1C only): 10% base (ASSUMED), tau 5 d linear recession, capped at 45%.
- Blasts: 1 per working day at 07:30 UTC (none on Sundays or 10 gazetted holidays), 20-60 kg, positioned relative to face.
- PPV helper: USBM vibration attenuation K=1140, beta=1.6 (USBM RI 8507, VERIFY); dominant frequency 10-40 Hz.
- Device state:
  - Battery voltage: 3.6 V draining to 3.30 over 120-200 d, replaced when < 3.32 V.
  - Comms/online: 1-3% packet loss per node, exactly one 5-day outage in August, one 6 h gateway outage.
  - Sensor stuck: one Tier 1B strain gauge stuck for 3 days.
- Events: chronological log of blasts and hardware incidents.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Sequence

import numpy as np

from sandbox import district, layout

# ---------------------------------------------------------------------------
# Calendar and Temporal Anchors (day 0 = 2026-01-01 UTC)
# ---------------------------------------------------------------------------
DAY_0_UTC_ISO = "2026-01-01T00:00:00Z"
HOURS_PER_DAY = 24
DAYS_IN_YEAR = 365
TOTAL_HOURS = DAYS_IN_YEAR * HOURS_PER_DAY  # 8760 hours in non-leap 2026

# Days per calendar month in 2026
MONTH_DAYS = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
MONTH_STARTS_D = np.cumsum([0] + list(MONTH_DAYS[:-1]))

# Indian mine gazetted / national holidays in 2026 (excluding Sundays) (ASSUMED)
# 1. Republic Day (Mon Jan 26, day 25)
# 2. Maha Shivratri (Tue Feb 17, day 47)
# 3. Holi (Wed Mar 4, day 62)
# 4. Good Friday (Fri Apr 3, day 92)
# 5. May Day (Fri May 1, day 120)
# 6. Bakrid / Eid al-Adha (Wed May 27, day 146)
# 7. Independence Day (Sat Aug 15, day 226)
# 8. Gandhi Jayanti (Fri Oct 2, day 274)
# 9. Dussehra (Tue Oct 20, day 292)
# 10. Christmas Day (Fri Dec 25, day 358)
MINE_HOLIDAYS_DAYS = frozenset({25, 47, 62, 92, 120, 146, 226, 274, 292, 358})

# ---------------------------------------------------------------------------
# Weather Normals (Ramagundam / Godavari Valley Coal Belt, Peddapalli district)
# ---------------------------------------------------------------------------
# Climatological monthly mean temperatures (deg C) (IMD 1981-2010 normals, VERIFY)
RAMAGUNDAM_TEMP_NORMALS_C = (
    22.8,  # Jan
    25.8,  # Feb
    29.8,  # Mar
    33.5,  # Apr
    36.2,  # May (hottest month)
    32.5,  # Jun (monsoon onset)
    28.0,  # Jul
    27.5,  # Aug
    28.0,  # Sep
    27.5,  # Oct
    24.5,  # Nov
    22.2,  # Dec
)

TEMP_DIURNAL_PEAK_UTC_HOUR = 8.5  # Diurnal maximum at 08:30 UTC = 14:00 IST (IMD, VERIFY)
TEMP_DIURNAL_AMPLITUDE_C = 6.0    # Half-amplitude of diurnal cycle, deg C (IMD, VERIFY)
TEMP_AR1_PHI = 0.92               # Hourly temperature persistence autoregressive coefficient (ASSUMED)
TEMP_AR1_SIGMA_C = 1.0            # Stationary std dev of weather anomaly, deg C (ASSUMED)

# Monthly rainfall normals (mm) centered for ~850 mm annual total (IMD, VERIFY)
# June-September accounts for > 85% of total precipitation.
RAMAGUNDAM_RAIN_NORMALS_MM = (
    5.0,    # Jan
    6.0,    # Feb
    9.0,    # Mar
    14.0,   # Apr
    18.0,   # May
    145.0,  # Jun
    260.0,  # Jul (peak monsoon)
    240.0,  # Aug (active monsoon)
    130.0,  # Sep (monsoon withdrawal)
    35.0,   # Oct
    10.0,   # Nov
    5.0,    # Dec
)

# Mean monthly wet days (IMD climatological normals, VERIFY)
RAIN_WET_DAYS_NORMAL = (1, 1, 1, 2, 3, 12, 17, 16, 11, 4, 1, 1)

# ---------------------------------------------------------------------------
# Hydrogeology & Pore Pressure
# ---------------------------------------------------------------------------
PORE_PRESSURE_BASE_KPA = 294.0            # Hydrostatic base at 30 m piezometer head: 30 m * 9.81 kPa/m = 294.3 kPa (ASSUMED)
PORE_PRESSURE_TAU_DAYS = 10.0             # Linear aquifer storage recession timescale (step E1 spec, ASSUMED)
WATER_UNIT_WEIGHT_KPA_PER_M = 9.81        # Hydrostatic gradient gamma_w = 9.81 kPa/m (standard geotech physics)
PORE_PRESSURE_NOISE_KPA = 0.5             # Vibrating wire piezometer observation noise std (step E1 spec, ASSUMED)
RAIN_TO_AQUIFER_HEAD_M_PER_MM = 0.045     # Aquifer recharge head rise per mm precipitation: infiltration / Sy (ASSUMED)

# Soil Moisture (Tier 1C only)
MOISTURE_BASE_PCT = 10.0                  # Dry-season background moisture percentage (step E1 spec, ASSUMED)
MOISTURE_TAU_DAYS = 5.0                   # Near-surface vadose zone drainage timescale (step E1 spec, ASSUMED)
MOISTURE_CAP_PCT = 45.0                   # Saturation capacity moisture ceiling (step E1 spec, ASSUMED)
RAIN_TO_MOISTURE_PCT_PER_MM = 0.50        # Soil moisture increment per mm rain (ASSUMED)

# ---------------------------------------------------------------------------
# Blasting & Ground Vibration (DGMS Circular 7/1997 & USBM RI 8507)
# ---------------------------------------------------------------------------
BLAST_CHARGE_DEPTH_M = 375.0              # Adriyala longwall seam production horizon depth (ASSUMED, step E1 spec)
BLAST_USBM_K = 1140.0                     # USBM vibration transmission coefficient K (USBM RI 8507, VERIFY)
BLAST_USBM_BETA = 1.6                     # USBM site attenuation exponent beta (USBM RI 8507, VERIFY)
BLAST_MASS_MIN_KG = 20.0                  # Heading development blast charge lower bound (step E1 spec, ASSUMED)
BLAST_MASS_MAX_KG = 60.0                  # Heading development blast charge upper bound (step E1 spec, ASSUMED)
BLAST_HOUR_UTC = 7                        # Blast scheduled hour (07:30 UTC falls in hour 7) (step E1 spec)
BLAST_TIME_UTC_HOURS = 7.5                # 07:30 UTC = 7.5 hours

# ---------------------------------------------------------------------------
# Device Lifecycles & Network Faults
# ---------------------------------------------------------------------------
BATTERY_V_INITIAL = 3.60                  # Fresh Li-SOCl2 primary cell nominal voltage (step E1 spec)
BATTERY_V_CUTOFF = 3.30                   # Nominal depleted cell voltage (step E1 spec)
BATTERY_V_REPLACE = 3.32                  # Maintenance service replacement trigger (step E1 spec)
BATTERY_DRAIN_DAYS_MIN = 120.0            # Minimum service lifespan to 3.30 V (step E1 spec)
BATTERY_DRAIN_DAYS_MAX = 200.0            # Maximum service lifespan to 3.30 V (step E1 spec)

PACKET_LOSS_MIN = 0.01                    # Mesh packet loss rate floor (step E1 spec)
PACKET_LOSS_MAX = 0.03                    # Mesh packet loss rate ceiling (step E1 spec)
AUGUST_OUTAGE_DAYS = 5                    # August transceiver outage duration (step E1 spec)
GATEWAY_OUTAGE_HOURS = 6                  # Sink gateway firmware/power outage duration (step E1 spec)
STRAIN_STUCK_DAYS = 3                     # Tier 1B strain gauge ADC stuck duration (step E1 spec)


# ---------------------------------------------------------------------------
# Dataclasses & Data Structures
# ---------------------------------------------------------------------------
class PPVValue(float):
    """Subclass of float that carries dominant frequency metadata while behaving as a float."""

    def __new__(cls, ppv: float, fdom_hz: float):
        obj = super().__new__(cls, ppv)
        obj.ppv = float(ppv)
        obj.fdom_hz = float(fdom_hz)
        obj.frequency_hz = float(fdom_hz)
        return obj


@dataclass(frozen=True)
class Blast:
    """A single underground blast record."""

    t_hour: int
    t_days: float
    day: int
    q_kg: float
    x_m: float
    y_m: float
    z_m: float = -BLAST_CHARGE_DEPTH_M

    def __getitem__(self, key: str) -> Any:
        return getattr(self, key)


@dataclass
class DeviceState:
    """Per-node, per-hour hardware and communication status arrays (shape: N_nodes x N_hours)."""

    battery_v: np.ndarray  # float64 (N, H), in Volts
    online: np.ndarray     # bool (N, H), True if telemetry received
    stuck: np.ndarray      # bool (N, H), True if sensor ADC reading is frozen

    def __getitem__(self, key: str) -> np.ndarray:
        return getattr(self, key)


@dataclass
class EnvironmentYear:
    """Complete 365-day hourly environmental and hardware ground truth."""

    air_temp_c: np.ndarray          # float64 (H,), Ambient temperature in deg C
    rain_mm: np.ndarray             # float64 (H,), Hourly precipitation in mm
    pore_pressure_kpa: np.ndarray   # float64 (N, H), Tier 2B boreholes only (NaN for others)
    moisture_pct: np.ndarray        # float64 (N, H), Tier 1C fault transect only (NaN for others)
    blasts: list[Blast]             # List of production development blasts over the year
    device: DeviceState             # DeviceState container
    battery_v: np.ndarray           # float64 (N, H), convenience mirror of device.battery_v
    online: np.ndarray              # bool (N, H), convenience mirror of device.online
    stuck: np.ndarray               # bool (N, H), convenience mirror of device.stuck
    events: list[dict[str, Any]]    # Chronologically sorted operational & incident event log
    seed: int
    days: int
    node_ids: np.ndarray
    node_xy: np.ndarray
    node_tiers: list[str]

    def ppv(self, distance_3d_m: float, q_kg: float) -> PPVValue:
        """Evaluate ground vibration PPV and dominant frequency."""
        return ppv(distance_3d_m, q_kg)


# ---------------------------------------------------------------------------
# Vibration Attenuation Helpers
# ---------------------------------------------------------------------------
def ppv(distance_3d_m: float, q_kg: float) -> PPVValue:
    """Calculate Peak Particle Velocity (mm/s) and dominant frequency (Hz).

    Uses the standard USBM scaled distance predictor:
        PPV = K * (D / sqrt(Q)) ** (-beta)
    where K = 1140, beta = 1.6 (USBM RI 8507, VERIFY).
    Charge depth is taken at 375 m depth, ensuring D >= 375 m at surface.

    Parameters
    ----------
    distance_3d_m : float
        Slant distance in 3D between explosive charge and surface transducer, in metres.
    q_kg : float
        Explosive charge mass per delay, in kilograms.

    Returns
    -------
    PPVValue
        A float (in mm/s) carrying `.fdom_hz` and `.frequency_hz` attributes.
    """
    d = max(1.0, float(distance_3d_m))
    q = max(0.01, float(q_kg))
    scaled_dist = d / math.sqrt(q)
    v_ppv = BLAST_USBM_K * (scaled_dist ** (-BLAST_USBM_BETA))

    # Frequency falls with travel distance due to high-frequency attenuation in rock mass
    # Dominant frequency spans 40 Hz down to 10 Hz (step E1 spec)
    f_dom = dominant_frequency(d)
    return PPVValue(v_ppv, f_dom)


def dominant_frequency(distance_3d_m: float) -> float:
    """Calculate dominant vibration frequency in Hz (10-40 Hz, falling with distance)."""
    d = max(BLAST_CHARGE_DEPTH_M, float(distance_3d_m))
    # Attenuates exponentially from 40 Hz at minimal 375 m depth towards 10 Hz at far range
    return 10.0 + 30.0 * math.exp(-(d - BLAST_CHARGE_DEPTH_M) / 500.0)


def blast_vibration(
    node_xy: Sequence[float] | np.ndarray,
    blast_xy: Sequence[float] | np.ndarray,
    q_kg: float,
    depth_m: float = BLAST_CHARGE_DEPTH_M,
) -> tuple[float, float]:
    """Calculate PPV (mm/s) and dominant frequency (Hz) for a surface coordinate."""
    dx = float(node_xy[0]) - float(blast_xy[0])
    dy = float(node_xy[1]) - float(blast_xy[1])
    dz = float(depth_m)
    d_3d = math.sqrt(dx * dx + dy * dy + dz * dz)
    res = ppv(d_3d, q_kg)
    return float(res), res.fdom_hz


# ---------------------------------------------------------------------------
# Core Year Builder
# ---------------------------------------------------------------------------
def build_year(
    seed: int,
    node_ids: Sequence[int] | np.ndarray | None = None,
    node_xy: np.ndarray | None = None,
    node_tiers: Sequence[str] | None = None,
    days: int = DAYS_IN_YEAR,
) -> EnvironmentYear:
    """Build a seeded, fully deterministic 365-day environmental dataset.

    Parameters
    ----------
    seed : int
        Pseudorandom generator seed. Uses `np.random.default_rng(seed)` strictly.
    node_ids : Sequence[int] | None
        1D array of stable node IDs. Defaults to `sandbox.layout.node_ids()`.
    node_xy : np.ndarray | None
        (N, 2) array of node coordinates. Defaults to `sandbox.layout.node_positions()`.
    node_tiers : Sequence[str] | None
        Sequence of tier names per node. Defaults to `sandbox.layout.node_tiers()`.
    days : int
        Simulation duration in days (default 365).

    Returns
    -------
    EnvironmentYear
        Dataclass containing hourly temperature, rainfall, pore pressure, moisture,
        blasts, device status (battery, online, stuck), and event log.
    """
    rng = np.random.default_rng(seed)

    if node_ids is None:
        node_ids = layout.node_ids()
    else:
        node_ids = np.asarray(node_ids, dtype=int)

    if node_xy is None:
        node_xy = layout.node_positions()
    else:
        node_xy = np.asarray(node_xy, dtype=float)

    if node_tiers is None:
        node_tiers = layout.node_tiers()
    else:
        node_tiers = list(node_tiers)

    num_nodes = len(node_ids)
    num_hours = days * HOURS_PER_DAY

    # Month index (0..11) for each day of the year
    day_to_month = np.zeros(days, dtype=int)
    for m, (s, l) in enumerate(zip(MONTH_STARTS_D, MONTH_DAYS)):
        if s < days:
            day_to_month[s : min(days, s + l)] = m

    # -----------------------------------------------------------------------
    # 1. Weather: Rainfall (Monsoon June-September, annual ~1000 mm, VERIFY)
    # -----------------------------------------------------------------------
    # Stochastic wet/dry days driven by seasonal monsoon dynamics
    daily_rain = np.zeros(days, dtype=np.float64)
    # Small interannual climate variation (~4% std) to reflect seasonal strength
    annual_monsoon_factor = float(rng.normal(1.0, 0.04))

    for m in range(12):
        if MONTH_STARTS_D[m] >= days:
            break
        n_days_in_m = min(MONTH_DAYS[m], days - MONTH_STARTS_D[m])
        m_factor = annual_monsoon_factor * float(rng.normal(1.0, 0.03))
        target_rain_m = max(0.0, RAMAGUNDAM_RAIN_NORMALS_MM[m] * m_factor)

        lam_wet = RAIN_WET_DAYS_NORMAL[m] * (target_rain_m / max(1.0, RAMAGUNDAM_RAIN_NORMALS_MM[m]))
        n_wet = int(np.clip(rng.poisson(lam_wet), 1 if RAMAGUNDAM_RAIN_NORMALS_MM[m] > 50 else 0, n_days_in_m))

        if n_wet > 0 and target_rain_m > 0.0:
            wet_day_indices = rng.choice(n_days_in_m, size=n_wet, replace=False)
            day_weights = rng.gamma(2.5, 1.0, size=n_wet)
            day_weights = day_weights / np.sum(day_weights)

            m_start = MONTH_STARTS_D[m]
            for w_idx, w_val in zip(wet_day_indices, day_weights):
                daily_rain[m_start + w_idx] = target_rain_m * w_val

    # Partition each wet day's rainfall into storm showers (2-5 hours duration)
    rain_mm = np.zeros(num_hours, dtype=np.float64)
    for d in range(days):
        r_day = daily_rain[d]
        if r_day > 0.0:
            dur = int(rng.integers(2, 6))
            start_h = int(rng.integers(0, 24 - dur + 1))
            w = rng.uniform(0.5, 1.5, size=dur)
            w = w / np.sum(w)
            rain_mm[d * 24 + start_h : d * 24 + start_h + dur] = r_day * w

    # -----------------------------------------------------------------------
    # 2. Weather: Air Temperature (Ramagundam normals + diurnal + AR(1) noise)
    # -----------------------------------------------------------------------
    # Monthly normals interpolated smoothly across days of year
    mid_days = MONTH_STARTS_D + np.array(MONTH_DAYS) / 2.0
    extended_days = np.concatenate([mid_days - 365, mid_days, mid_days + 365])
    extended_temps = np.tile(RAMAGUNDAM_TEMP_NORMALS_C, 3)
    day_indices = np.arange(days, dtype=float)
    daily_base_temp = np.interp(day_indices, extended_days, extended_temps)

    # Diurnal cycle: peaks at 08:30 UTC
    hour_of_day = np.arange(num_hours) % 24
    hour_to_day_idx = np.arange(num_hours) // 24
    diurnal_cycle = TEMP_DIURNAL_AMPLITUDE_C * np.cos(
        2.0 * np.pi * (hour_of_day - TEMP_DIURNAL_PEAK_UTC_HOUR) / 24.0
    )

    # Autoregressive AR(1) weather persistence noise
    sigma_innov = TEMP_AR1_SIGMA_C * math.sqrt(1.0 - TEMP_AR1_PHI * TEMP_AR1_PHI)
    ar1_noise = np.zeros(num_hours, dtype=np.float64)
    eps_innov = rng.normal(0.0, sigma_innov, size=num_hours)
    ar1_noise[0] = rng.normal(0.0, TEMP_AR1_SIGMA_C)
    for h in range(1, num_hours):
        ar1_noise[h] = TEMP_AR1_PHI * ar1_noise[h - 1] + eps_innov[h]

    air_temp_c = np.round(daily_base_temp[hour_to_day_idx] + diurnal_cycle + ar1_noise, 2)

    # -----------------------------------------------------------------------
    # 3. Hydrogeology: Pore Pressure (Tier 2B only) & Soil Moisture (Tier 1C only)
    # -----------------------------------------------------------------------
    # Linear reservoir: dh/dt = -h/tau + rain * K_head
    tau_h_hours = PORE_PRESSURE_TAU_DAYS * 24.0
    decay_pp = math.exp(-1.0 / tau_h_hours)
    res_head_m = np.zeros(num_hours, dtype=np.float64)
    h_acc = 0.0
    for h in range(num_hours):
        h_acc = h_acc * decay_pp + rain_mm[h] * RAIN_TO_AQUIFER_HEAD_M_PER_MM
        res_head_m[h] = h_acc

    pore_pressure_kpa = np.full((num_nodes, num_hours), np.nan, dtype=np.float64)
    for i, tier in enumerate(node_tiers):
        if tier == layout.TIER_2B:
            noise_pp = rng.normal(0.0, PORE_PRESSURE_NOISE_KPA, size=num_hours)
            pore_pressure_kpa[i, :] = np.round(
                PORE_PRESSURE_BASE_KPA + res_head_m * WATER_UNIT_WEIGHT_KPA_PER_M + noise_pp, 2
            )

    # Moisture: 10% base, tau 5 d, capped at 45% (Tier 1C only)
    tau_m_hours = MOISTURE_TAU_DAYS * 24.0
    decay_m = math.exp(-1.0 / tau_m_hours)
    res_moist = np.zeros(num_hours, dtype=np.float64)
    m_acc = 0.0
    for h in range(num_hours):
        m_acc = m_acc * decay_m + rain_mm[h] * RAIN_TO_MOISTURE_PCT_PER_MM
        res_moist[h] = m_acc

    moisture_pct = np.full((num_nodes, num_hours), np.nan, dtype=np.float64)
    for i, tier in enumerate(node_tiers):
        if tier == layout.TIER_1C:
            moisture_pct[i, :] = np.round(
                np.clip(MOISTURE_BASE_PCT + res_moist, MOISTURE_BASE_PCT, MOISTURE_CAP_PCT), 2
            )

    # -----------------------------------------------------------------------
    # 4. Mine Production Blasts & Event Schedule
    # -----------------------------------------------------------------------
    blasts: list[Blast] = []
    events: list[dict[str, Any]] = []

    for d in range(days):
        # Day 0 = Jan 1, 2026 (Thursday). Jan 4 is day 3 (Sunday).
        # Sundays satisfy (d - 3) % 7 == 0.
        is_sunday = (d - 3) % 7 == 0
        if is_sunday or (d in MINE_HOLIDAYS_DAYS):
            continue

        t_days_blast = d + BLAST_TIME_UTC_HOURS / 24.0
        t_hour_blast = d * 24 + BLAST_HOUR_UTC

        # Blast position: x = U(-100, 100), y = face_y_middle + U(20, 80)
        face_positions = district.face_positions(t_days_blast)
        face_y_mid = face_positions[1]
        if math.isnan(face_y_mid):
            face_y_mid = district.FIT_FACE_START_Y_M

        blast_x = float(rng.uniform(-100.0, 100.0))
        blast_y = float(face_y_mid + rng.uniform(20.0, 80.0))
        blast_q = float(rng.uniform(BLAST_MASS_MIN_KG, BLAST_MASS_MAX_KG))

        b = Blast(
            t_hour=t_hour_blast,
            t_days=t_days_blast,
            day=d,
            q_kg=round(blast_q, 2),
            x_m=round(blast_x, 2),
            y_m=round(blast_y, 2),
            z_m=-BLAST_CHARGE_DEPTH_M,
        )
        blasts.append(b)
        events.append({
            "t_hour": t_hour_blast,
            "type": "blast",
            "node_id": None,
            "detail": f"Development heading blast {blast_q:.1f} kg at ({blast_x:.1f}, {blast_y:.1f})",
        })

    # -----------------------------------------------------------------------
    # 5. Device Faults & Hardware States
    # -----------------------------------------------------------------------
    # A. Battery Voltage: 3.6 V draining to 3.30 over 120-200 d, replaced below 3.32 V
    drain_days = rng.uniform(BATTERY_DRAIN_DAYS_MIN, BATTERY_DRAIN_DAYS_MAX, size=num_nodes)
    dV_per_hour = (BATTERY_V_INITIAL - BATTERY_V_CUTOFF) / (drain_days * 24.0)
    cycle_hours = (BATTERY_V_INITIAL - BATTERY_V_REPLACE) / dV_per_hour
    hours_arr = np.arange(num_hours, dtype=np.float64)

    battery_v = np.zeros((num_nodes, num_hours), dtype=np.float64)
    for i in range(num_nodes):
        nid = int(node_ids[i])
        rate_i = dV_per_hour[i]
        c_hours = cycle_hours[i]
        h_in_cycle = hours_arr % c_hours
        v_node = BATTERY_V_INITIAL - rate_i * h_in_cycle
        battery_v[i, :] = np.round(v_node, 4)

        # Log battery replacement events
        num_cycles = int(num_hours // c_hours)
        for cyc in range(1, num_cycles + 1):
            rep_hour = int(round(cyc * c_hours))
            if rep_hour < num_hours:
                events.append({
                    "t_hour": rep_hour,
                    "type": "battery_replaced",
                    "node_id": nid,
                    "detail": f"Node {nid} battery replaced (< {BATTERY_V_REPLACE}V)",
                })

    # B. Online / Comms: 1-3% packet loss, 1 node offline 5d in August, 1 6h gateway outage
    online = np.ones((num_nodes, num_hours), dtype=bool)

    # Gateway outage: 6 hours (placed in spring/early summer days 60-180 to avoid August overlap)
    gw_indices = [i for i, t in enumerate(node_tiers) if t == layout.TIER_3]
    gw_idx = gw_indices[0] if gw_indices else num_nodes - 1
    gw_id = int(node_ids[gw_idx])
    gw_day = int(rng.integers(60, 180))
    gw_start_hour = gw_day * 24 + int(rng.integers(0, 18))
    online[:, gw_start_hour : gw_start_hour + GATEWAY_OUTAGE_HOURS] = False
    events.append({
        "t_hour": gw_start_hour,
        "type": "gateway_outage",
        "node_id": gw_id,
        "detail": "Gateway outage (6 h power / firmware reload)",
    })
    events.append({
        "t_hour": gw_start_hour + GATEWAY_OUTAGE_HOURS,
        "type": "gateway_restored",
        "node_id": gw_id,
        "detail": "Gateway reboot complete, network links restored",
    })

    # August 5-day outage: days 212 to 242 (pick days 215-235)
    sensing_indices = [i for i, t in enumerate(node_tiers) if t != layout.TIER_3]
    aug_node_idx = int(rng.choice(sensing_indices))
    aug_node_id = int(node_ids[aug_node_idx])
    aug_day = int(rng.integers(215, 235))
    aug_start_hour = aug_day * 24
    aug_dur_hours = AUGUST_OUTAGE_DAYS * 24  # 120 hours
    online[aug_node_idx, aug_start_hour : aug_start_hour + aug_dur_hours] = False
    events.append({
        "t_hour": aug_start_hour,
        "type": "node_offline",
        "node_id": aug_node_id,
        "detail": f"Node {aug_node_id} transceiver failure (5 days in August monsoon)",
    })
    events.append({
        "t_hour": aug_start_hour + aug_dur_hours,
        "type": "node_restored",
        "node_id": aug_node_id,
        "detail": f"Node {aug_node_id} transceiver repaired and back online",
    })

    # Guarded boundary hours around deterministic outages so random drops do not lengthen runs
    gw_guard = set(range(max(0, gw_start_hour - 2), min(num_hours, gw_start_hour + GATEWAY_OUTAGE_HOURS + 2)))
    aug_guard = set(range(max(0, aug_start_hour - 2), min(num_hours, aug_start_hour + aug_dur_hours + 2)))

    # Random background packet drops (mesh interference, target 1.5% to 2.5% per node)
    target_fracs = rng.uniform(0.015, 0.025, size=num_nodes)
    target_drops = np.round(target_fracs * num_hours).astype(int)
    cur_drops = np.sum(~online, axis=1)
    needed_drops = target_drops - cur_drops

    for i in range(num_nodes):
        avail_mask = online[i, :].copy()
        for g in gw_guard:
            avail_mask[g] = False
        if i == aug_node_idx:
            for a in aug_guard:
                avail_mask[a] = False
        avail_hours = np.where(avail_mask)[0]
        n_to_drop = max(0, int(needed_drops[i]))
        if n_to_drop > 0 and len(avail_hours) >= n_to_drop:
            drop_hours = rng.choice(avail_hours, size=n_to_drop, replace=False)
            online[i, drop_hours] = False

    # C. Stuck Strain Gauge: one 1B strain gauge stuck for 3 days
    stuck = np.zeros((num_nodes, num_hours), dtype=bool)
    tier_1b_indices = [i for i, t in enumerate(node_tiers) if t == layout.TIER_1B]
    if tier_1b_indices:
        stuck_idx = int(rng.choice(tier_1b_indices))
        stuck_node_id = int(node_ids[stuck_idx])
        stuck_day = int(rng.integers(50, 180))
        stuck_start_hour = stuck_day * 24
        stuck_dur_hours = STRAIN_STUCK_DAYS * 24  # 72 hours
        stuck[stuck_idx, stuck_start_hour : stuck_start_hour + stuck_dur_hours] = True
        events.append({
            "t_hour": stuck_start_hour,
            "type": "sensor_stuck",
            "node_id": stuck_node_id,
            "detail": f"Node {stuck_node_id} Tier 1B strain gauge ADC stuck (3 days)",
        })
        events.append({
            "t_hour": stuck_start_hour + stuck_dur_hours,
            "type": "sensor_unstuck",
            "node_id": stuck_node_id,
            "detail": f"Node {stuck_node_id} Tier 1B strain gauge ADC unstuck, normal telemetry resumed",
        })

    # Sort all events chronologically by t_hour
    events.sort(key=lambda ev: (ev["t_hour"], ev["type"]))

    device_state = DeviceState(
        battery_v=battery_v,
        online=online,
        stuck=stuck,
    )

    return EnvironmentYear(
        air_temp_c=air_temp_c,
        rain_mm=rain_mm,
        pore_pressure_kpa=pore_pressure_kpa,
        moisture_pct=moisture_pct,
        blasts=blasts,
        device=device_state,
        battery_v=battery_v,
        online=online,
        stuck=stuck,
        events=events,
        seed=seed,
        days=days,
        node_ids=node_ids,
        node_xy=node_xy,
        node_tiers=node_tiers,
    )
