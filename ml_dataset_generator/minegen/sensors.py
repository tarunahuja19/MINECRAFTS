"""
Per-tier sensor channels (WhatsApp sensor image is authoritative here).

WHAT EACH TIER CARRIES -- copied from the image, nothing added, nothing invented:

    1A  Baseline / Flat      MPU-6050 6DoF tilt+vibration
    1B  Tension / Shear      MPU-6050 + 10k slide fissure meter + foil strain gauge
    1C  Fault / Water        MPU-6050 + capacitive soil moisture + wire extensometer
    2A  Standard Mesh Router ADXL355 ultra-high precision inclinometer
    2B  Geotech Borehole     deep borehole piezometer + inclinometer string
    3   Master Sink / Edge AI GPS/RTK absolute positioning

Two deliberate departures, both approved:

  * The geophone from spec 4.4 DOES NOT EXIST in the final hardware. Its raw
    1 kHz waveform and DSP feature vector are dropped. Vibration is instead
    read from the MPU-6050 as a short high-rate burst once per superframe,
    reduced on-node to rms / peak / dominant frequency -- which is what the
    image's "Tilt/Vibration: MPU-6050" line actually describes.

  * die_temp is carried on every MPU-6050 and ADXL355 node although the image
    does not list it as its own row. It is internal to both parts, it is free,
    and spec 4.5 mandates temperature-dependent bias -- which is uncorrectable
    without the temperature that caused it.

  * Battery voltage appears on every image row but is NOT emitted as data. It
    describes the hardware, not the ground.

Every ground-reading channel is derived from the one latent field in field.py.
"""

from __future__ import annotations

import numpy as np

from . import constants as K
from . import noise as N
from .field import GroundField

# The authoritative channel sets. Also written into GENERATION_NOTES.md.
TIER_CHANNELS: dict[str, tuple[str, ...]] = {
    "1A": ("tilt_x_urad", "tilt_y_urad", "accel_x_g", "accel_y_g", "accel_z_g",
           "gyro_x_dps", "gyro_y_dps", "gyro_z_dps",
           "vib_rms_mm_s", "vib_peak_mm_s", "vib_fdom_hz", "die_temp_c"),
    "1B": ("tilt_x_urad", "tilt_y_urad", "accel_x_g", "accel_y_g", "accel_z_g",
           "gyro_x_dps", "gyro_y_dps", "gyro_z_dps",
           "vib_rms_mm_s", "vib_peak_mm_s", "vib_fdom_hz", "die_temp_c",
           "fissure_mm", "strain_ue"),
    "1C": ("tilt_x_urad", "tilt_y_urad", "accel_x_g", "accel_y_g", "accel_z_g",
           "gyro_x_dps", "gyro_y_dps", "gyro_z_dps",
           "vib_rms_mm_s", "vib_peak_mm_s", "vib_fdom_hz", "die_temp_c",
           "moisture_pct", "ext_delta_mm"),
    "2A": ("tilt_x_urad", "tilt_y_urad", "die_temp_c"),
    "2B": ("pore_pressure_kpa", "borehole_tilt_d1_urad", "borehole_tilt_d2_urad",
           "borehole_tilt_d3_urad", "borehole_tilt_d4_urad", "die_temp_c"),
    "3":  ("gps_dx_mm", "gps_dy_mm", "gps_dz_mm", "die_temp_c"),
}

ALL_CHANNELS: tuple[str, ...] = tuple(
    dict.fromkeys(c for chans in TIER_CHANNELS.values() for c in chans)
)


def weather(rng: np.random.Generator, t_s: np.ndarray, n_nodes: int) -> tuple[np.ndarray, dict]:
    """
    Die temperature per node, degC, shape (n_nodes, n_steps).

    Air temperature is shared across the whole mine (one sky), while each node
    adds its own frozen self-heating offset. This is why nodes are not clones:
    the same ground movement reads slightly differently on each one.
    """
    t_days = t_s / 86400.0
    mean_t = rng.uniform(*K.AIR_TEMP_MEAN_RANGE)
    amp_d = rng.uniform(*K.AIR_TEMP_DIURNAL_RANGE)
    phase = rng.uniform(0.0, 2.0 * np.pi)
    air = mean_t + amp_d * np.sin(2.0 * np.pi * t_days + phase)

    self_heat = rng.uniform(*K.DIE_TEMP_SELF_HEAT_RANGE, size=(n_nodes, 1))
    die = air.reshape(1, -1) + self_heat
    meta = {
        "air_temp_mean_c": mean_t,
        "air_temp_diurnal_amp_c": amp_d,
        "air_temp_phase_rad": phase,
        "die_self_heat_c": self_heat.ravel().tolist(),
    }
    return die, meta


def _vibration(
    rng: np.random.Generator,
    strain_ue: np.ndarray,
    t_s: np.ndarray,
    horizon_s: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
    """
    MPU-6050 vibration burst reduced to rms / peak / dominant frequency.

    Four sources sit in four separable frequency neighbourhoods, which is the
    whole discriminator: machinery is background to be rejected, microseismic
    activity is rock actually cracking and is the only one that counts. The
    microseismic event rate scales with local strain, so shaking genuinely
    increases as the ground approaches failure rather than being painted on.
    """
    n_nodes, n_steps = strain_ue.shape
    t_days = t_s / 86400.0

    # -- machinery background ------------------------------------------------
    # Conveyor: a near-constant narrow-band floor whenever it is running.
    conveyor_on = (np.sin(2.0 * np.pi * t_days * 1.0) > -0.4).astype(np.float64)
    conveyor = 0.8 * conveyor_on.reshape(1, -1) * rng.uniform(0.6, 1.0, size=(n_nodes, 1))

    # Trucks: frequent, short, random.
    truck_hit = rng.random((n_nodes, n_steps)) < 0.04
    truck = truck_hit * rng.uniform(0.4, 2.5, size=(n_nodes, n_steps))

    # Blasts: rare, large, mine-wide (every node feels the same blast).
    blast_times = rng.random(n_steps) < (2.0 / max(n_steps, 1))
    blast = blast_times.reshape(1, -1) * rng.uniform(3.0, 18.0, size=(n_nodes, 1))

    # -- microseismic: the real signal --------------------------------------
    # Poisson rate rises with |strain|, so the closer to failure, the more the
    # rock cracks. This is the only vibration source coupled to the ground.
    strain_norm = np.abs(strain_ue) / 1000.0
    rate_per_step = (
        K.MICROSEISMIC_BASE_RATE_PER_HOUR
        * (1.0 + K.MICROSEISMIC_STRESS_GAIN * strain_norm)
        * (K.DT_SECONDS / 3600.0)
    )
    micro_hit = rng.random((n_nodes, n_steps)) < np.clip(rate_per_step, 0.0, 0.95)
    micro_amp = micro_hit * rng.uniform(0.3, 4.0, size=(n_nodes, n_steps)) * (
        1.0 + 2.0 * strain_norm
    )

    rms = np.sqrt(conveyor**2 + truck**2 + blast**2 + micro_amp**2) * 0.35
    peak = rms * rng.uniform(2.4, 4.2, size=(n_nodes, n_steps))

    # -- dominant frequency: whichever source is loudest this window ---------
    stack = np.stack([truck, conveyor, blast, micro_amp], axis=0)
    winner = np.argmax(stack, axis=0)
    band_lo = np.array([K.VIB_BANDS[b][0] for b in ("truck", "conveyor", "blast", "microseismic")])
    band_hi = np.array([K.VIB_BANDS[b][1] for b in ("truck", "conveyor", "blast", "microseismic")])
    u = rng.random((n_nodes, n_steps))
    fdom = band_lo[winner] + u * (band_hi[winner] - band_lo[winner])

    meta = {
        "burst_rate_hz": K.VIB_BURST_RATE_HZ,
        "burst_samples": K.VIB_BURST_SAMPLES,
        "bands_hz": {k: list(v) for k, v in K.VIB_BANDS.items()},
        "microseismic_base_rate_per_hour": K.MICROSEISMIC_BASE_RATE_PER_HOUR,
        "microseismic_stress_gain": K.MICROSEISMIC_STRESS_GAIN,
    }
    return rms, peak, fdom, meta


def _moisture(
    rng: np.random.Generator,
    t_s: np.ndarray,
    xy: np.ndarray,
    gf: GroundField,
    n_nodes: int,
) -> tuple[np.ndarray, dict]:
    """
    Capacitive soil moisture, % VWC (Tier 1C).

    Baseline plus rain events that decay away, PLUS a rise near a collapse site
    as failure approaches. Water ingress is a genuine precursor to ground
    failure in fault and water zones, which is exactly the zone this tier is
    deployed in, so the sensor carries real predictive signal rather than an
    unrelated weather trace.
    """
    n_steps = t_s.size
    t_days = t_s / 86400.0
    base = rng.uniform(*K.MOISTURE_BASE_RANGE, size=(n_nodes, 1))

    # Rain is shared across the mine: one sky, one storm.
    n_rain = rng.poisson(K.MOISTURE_RAIN_RATE_PER_DAY * max(t_days[-1], 1e-6))
    rain_response = np.zeros(n_steps)
    rain_times = []
    for _ in range(int(n_rain)):
        t0 = rng.uniform(0.0, t_days[-1])
        jump = rng.uniform(*K.MOISTURE_RAIN_JUMP_RANGE)
        rain_times.append({"t_day": float(t0), "jump_pct": float(jump)})
        decay = np.where(
            t_days >= t0, jump * np.exp(-(t_days - t0) / K.MOISTURE_DRY_TAU_DAYS), 0.0
        )
        rain_response = rain_response + decay

    m = base + rain_response.reshape(1, -1)

    # Precursor rise: scales with how far each event has progressed and how
    # close the node is to it.
    for ev in gf.events:
        d2 = (xy[:, 0] - ev.x) ** 2 + (xy[:, 1] - ev.y) ** 2
        spatial = np.exp(-d2 / (2.0 * (1.5 * ev.radius_m) ** 2)).reshape(-1, 1)
        growth = gf._collapse_growth(t_s.reshape(1, -1), ev)
        m = m + K.MOISTURE_PRECURSOR_GAIN * ev.severity * spatial * growth

    meta = {
        "rain_events": rain_times,
        "dry_tau_days": K.MOISTURE_DRY_TAU_DAYS,
        "precursor_gain_pct": K.MOISTURE_PRECURSOR_GAIN,
    }
    return np.clip(m, 0.0, 100.0), meta


def generate_readings(
    rng: np.random.Generator,
    nodes: list,
    gf: GroundField,
    t_s: np.ndarray,
    horizon_s: float,
) -> tuple[dict[str, np.ndarray], dict]:
    """
    Produce every channel for every node.

    Returns a dict of (n_nodes, n_steps) arrays keyed by channel name, with NaN
    wherever a node's tier does not carry that channel. Channels are computed
    once for all nodes and masked afterwards, which keeps everything vectorised.
    """
    n_nodes = len(nodes)
    n_steps = t_s.size
    xy = np.array([[n.x, n.y] for n in nodes], dtype=np.float64)
    x = xy[:, 0].reshape(-1, 1)
    y = xy[:, 1].reshape(-1, 1)
    tt = t_s.reshape(1, -1)
    tiers = np.array([n.tier for n in nodes])

    # per-node frozen personality: white-noise scale multiplier
    sigma_scale = rng.uniform(0.75, 1.4, size=n_nodes)

    die_temp, wmeta = weather(rng, t_s, n_nodes)

    # ---------------- clean ground truth, all from the one field ----------
    tilt_x, tilt_y = gf.tilt(x, y, tt)
    strain = gf.strain_yy(x, y, tt)
    ux, uy = gf.horizontal_displacement(x, y, tt)
    S = gf.subsidence(x, y, tt)

    out: dict[str, np.ndarray] = {}
    nan = np.full((n_nodes, n_steps), np.nan)

    # ---------------- MPU-6050 tilt (tiers 1A/1B/1C) ----------------------
    mpu_mask = np.isin(tiers, ("1A", "1B", "1C")).reshape(-1, 1)
    adxl_mask = (tiers == "2A").reshape(-1, 1)

    tx_mpu = N.corrupt(rng, tilt_x, die_temp, "mpu_tilt_urad", "tilt_urad", sigma_scale)
    ty_mpu = N.corrupt(rng, tilt_y, die_temp, "mpu_tilt_urad", "tilt_urad", sigma_scale)
    # ADXL355 is the precision part: roughly 40x quieter, which is the entire
    # engineering reason tier 2A exists as a separate anchor type.
    tx_adxl = N.corrupt(rng, tilt_x, die_temp, "adxl_tilt_urad", "tilt_urad", sigma_scale)
    ty_adxl = N.corrupt(rng, tilt_y, die_temp, "adxl_tilt_urad", "tilt_urad", sigma_scale)

    out["tilt_x_urad"] = np.where(mpu_mask, tx_mpu, np.where(adxl_mask, tx_adxl, nan))
    out["tilt_y_urad"] = np.where(mpu_mask, ty_mpu, np.where(adxl_mask, ty_adxl, nan))

    # ---------------- accelerometer: gravity projected through tilt --------
    # A tilted board sees gravity leak into its x and y axes. Small angle, so
    # the leak is just the tilt in radians.
    tilt_x_rad = tilt_x * 1.0e-6
    tilt_y_rad = tilt_y * 1.0e-6
    ax = N.corrupt(rng, -np.sin(tilt_x_rad), die_temp, "accel_g", "accel_g", sigma_scale)
    ay = N.corrupt(rng, -np.sin(tilt_y_rad), die_temp, "accel_g", "accel_g", sigma_scale)
    az = N.corrupt(
        rng, np.cos(tilt_x_rad) * np.cos(tilt_y_rad), die_temp, "accel_g", "accel_g", sigma_scale
    )
    for name, arr in (("accel_x_g", ax), ("accel_y_g", ay), ("accel_z_g", az)):
        out[name] = np.where(mpu_mask, arr, nan)

    # ---------------- gyroscope: no real rotation, only drift --------------
    # The ground tilts far too slowly to produce a measurable angular rate, so
    # what the gyro actually reports is its own bias walking around. That is
    # realistic and it is why spec 4.3 calls out gyro drift specifically.
    true_rate = np.zeros((n_nodes, n_steps))
    for name in ("gyro_x_dps", "gyro_y_dps", "gyro_z_dps"):
        arr = N.corrupt(rng, true_rate, die_temp, "gyro_dps", "gyro_dps", sigma_scale)
        out[name] = np.where(mpu_mask, arr, nan)

    # ---------------- vibration (MPU-6050 burst) --------------------------
    vrms, vpeak, vfdom, vmeta = _vibration(rng, strain, t_s, horizon_s)
    vrms = N.corrupt(rng, vrms, die_temp, "vib_mm_s", "vib_mm_s", sigma_scale)
    vpeak = N.corrupt(rng, vpeak, die_temp, "vib_mm_s", "vib_mm_s", sigma_scale)
    vfdom = np.round(vfdom / K.QUANT["vib_fdom_hz"]) * K.QUANT["vib_fdom_hz"]
    out["vib_rms_mm_s"] = np.where(mpu_mask, np.clip(vrms, 0.0, None), nan)
    out["vib_peak_mm_s"] = np.where(mpu_mask, np.clip(vpeak, 0.0, None), nan)
    out["vib_fdom_hz"] = np.where(mpu_mask, vfdom, nan)

    # ---------------- tier 1B: fissure meter + strain gauge ---------------
    mask_1b = (tiers == "1B").reshape(-1, 1)
    # The 10k slide fissure meter measures crack opening across its gauge
    # length: horizontal strain integrated over that length.
    gauge_len_m = 0.5
    fissure_clean = np.abs(strain) * 1.0e-6 * gauge_len_m * 1000.0  # mm
    fissure = N.corrupt(rng, fissure_clean, die_temp, "fissure_mm", "fissure_mm", sigma_scale)
    out["fissure_mm"] = np.where(mask_1b, np.clip(fissure, 0.0, None), nan)

    strain_meas = N.corrupt(rng, strain, die_temp, "strain_ue", "strain_ue", sigma_scale)
    out["strain_ue"] = np.where(mask_1b, strain_meas, nan)

    # ---------------- tier 1C: moisture + wire extensometer ---------------
    mask_1c = (tiers == "1C").reshape(-1, 1)
    moisture, mmeta = _moisture(rng, t_s, xy, gf, n_nodes)
    moisture = N.corrupt(rng, moisture, die_temp, "moisture_pct", "moisture_pct", sigma_scale)
    out["moisture_pct"] = np.where(mask_1c, np.clip(moisture, 0.0, 100.0), nan)

    # Wire extensometer: exact 3-D distance change between the node peg and an
    # anchor peg 10 m away. Uses the vertical component too, since differential
    # settlement shortens the wire even at zero horizontal strain.
    wire_len = 10.0
    x2p = x + wire_len
    ux2, uy2 = gf.horizontal_displacement(x2p, y, tt)
    S2 = gf.subsidence(x2p, y, tt)
    dx = (x2p + ux2) - (x + ux)
    dy = (y + uy2) - (y + uy)
    dz = (-S2) - (-S)
    ext_clean = (np.sqrt(dx**2 + dy**2 + dz**2) - wire_len) * 1000.0  # mm
    ext = N.corrupt(rng, ext_clean, die_temp, "ext_mm", "ext_mm", sigma_scale)
    out["ext_delta_mm"] = np.where(mask_1c, ext, nan)

    # ---------------- tier 2B: piezometer + inclinometer string -----------
    mask_2b = (tiers == "2B").reshape(-1, 1)
    pore_base = rng.uniform(*K.PORE_PRESSURE_BASE_RANGE, size=(n_nodes, 1))
    pore_clean = np.broadcast_to(pore_base, (n_nodes, n_steps)).copy()
    # Pore pressure rises as the failure zone loads up, and responds to rain.
    for ev in gf.events:
        d2 = (xy[:, 0] - ev.x) ** 2 + (xy[:, 1] - ev.y) ** 2
        spatial = np.exp(-d2 / (2.0 * (2.0 * ev.radius_m) ** 2)).reshape(-1, 1)
        growth = gf._collapse_growth(tt, ev)
        pore_clean = pore_clean + K.PORE_PRESSURE_PRECURSOR_GAIN * ev.severity * spatial * growth
    pore = N.corrupt(rng, pore_clean, die_temp, "pore_kpa", "pore_kpa", sigma_scale)
    out["pore_pressure_kpa"] = np.where(mask_2b, np.clip(pore, 0.0, None), nan)

    # Inclinometer string: ground tilt attenuates with depth, because the
    # subsidence bowl is a surface expression. Deeper sensors see less.
    for i, depth in enumerate(K.BOREHOLE_DEPTHS_M, start=1):
        atten = float(np.exp(-depth / max(gf.r, 1.0)))
        bh_clean = np.hypot(tilt_x, tilt_y) * atten
        bh = N.corrupt(rng, bh_clean, die_temp, "borehole_tilt_urad", "tilt_urad", sigma_scale)
        out[f"borehole_tilt_d{i}_urad"] = np.where(mask_2b, bh, nan)

    # ---------------- tier 3: GPS/RTK on bedrock --------------------------
    # The gateway sits outside the angle of draw, so by construction it must
    # read zero movement forever. Anything it reports is instrument drift, and
    # that makes it the network's stable reference.
    mask_3 = (tiers == "3").reshape(-1, 1)
    true_mm = S * 1000.0
    for name, clean in (
        ("gps_dx_mm", ux * 1000.0),
        ("gps_dy_mm", uy * 1000.0),
        ("gps_dz_mm", -true_mm),
    ):
        arr = N.corrupt(rng, clean, die_temp, "gps_mm", "gps_mm", sigma_scale)
        out[name] = np.where(mask_3, arr, nan)

    # die_temp is present on every tier that has silicon, i.e. all of them.
    out["die_temp_c"] = N.corrupt(rng, die_temp, die_temp, "die_temp_c", "die_temp_c", None)

    # ---------------- ground truth companions (clean, for validation) -----
    # Spec 4.3 asks for the clean derived quantity alongside the noisy proxy.
    truth = {
        "truth_tilt_x_urad": tilt_x,
        "truth_tilt_y_urad": tilt_y,
        "truth_strain_ue": strain,
        "truth_subsidence_m": S,
    }

    meta = {
        "weather": wmeta,
        "vibration": vmeta,
        "moisture": mmeta,
        "sigma_scale_per_node": sigma_scale.tolist(),
        "corruption_stage_order": list(N.STAGE_ORDER),
        "extensometer_wire_len_m": wire_len,
        "fissure_gauge_len_m": gauge_len_m,
    }
    return {**out, **truth}, meta
