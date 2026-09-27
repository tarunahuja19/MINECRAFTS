"""
Sensor array sampling, physics-to-telemetry conversion, and corruption chain.

Transforms continuous ground truth fields at the node coordinates into the
degraded observation telemetry record for `nodes.csv`.

------------------------------------------------------------------------
Tiers carry different hardware (MESH_UPGRADE_BRIEF.md section 1)
------------------------------------------------------------------------
Every node is exactly one tier, and tier determines which channels exist:

    1A  Scout   tilt, accel, gyro, vib, die_temp
    1B  Scout   1A's set + fissure_mm, strain_ue
    1C  Scout   1A's set + moisture_pct, ext_delta_mm
    2A  Anchor  tilt, die_temp            (ADXL355 — ~40x quieter)
    2B  Anchor  pore_pressure, borehole_tilt_d1..d4, die_temp
    3   Gateway gps_dx/dy/dz, die_temp

**Critical read rule:** a channel a tier does not carry is NULL, never 0.
A null means "this hardware does not exist on this node", which is
categorically different from "this sensor read zero". `to_csv_row` emits
an empty field for a null, and nothing in this module fills one with a
default. Downstream readers must not `fillna(0)`.

2A is a separate tier for exactly one reason: it carries an ADXL355
instead of the MPU-6050, ~40x quieter in tilt (3.0 vs 120.0 µrad white
sigma). That gap is reproduced here — if it were collapsed to a single
noise figure the tier would be pointless.

There is no geophone. Vibration comes from the MPU-6050 sampled as a
400 Hz / 256-sample burst once per superframe, reduced on-node to
vib_rms / vib_peak / vib_fdom. Discriminate by vib_fdom: truck 8-20 Hz,
conveyor 50±0.5 Hz, blast 40-80 Hz, microseismic 100-250 Hz — the last
is the one that matters.

Corruption Chain Order:
1. True ground physical state (tilt, strain, displacement at node coordinate).
2. Transducer response & conversion to integer units (µrad, µε, 10µm).
3. Thermal drift and personality offset.
4. Battery voltage sag.
5. Gaussian sensor noise & 16-bit ADC quantisation / clamping.
6. Vibration transient channel (machinery baseline or blast disturbance).
7. Mesh link attributes (RSSI, SNR, hops, TX power) from the static DAG.
8. Liveness: Dead node emits a blank-reading row with alive=0 (Rule 2).
"""

from dataclasses import dataclass
import math
import numpy as np

from sandbox.constants import (
    CRACK_PARTIAL_CLOSURE_FRACTION,
    CRACK_SPACING_M,
    CRACK_TENSILE_THRESHOLD_UE,
    GRID_N,
    SIGMA_EXT_10UM,
    SIGMA_STRAIN_UE,
    SIGMA_TEMP_DC,
    SIGMA_VBAT_MV,
    THERMAL_TILT_DRIFT_URAD_PER_C,
    TICK_SIM_SECONDS,
    TILT_DRIFT_REFERENCE_C,
    VIBRATION_REFERENCE_DISTANCE_M,
    WANDER_PHI_PER_TICK,
    WINDOW_SIZE_M,
)
from sandbox.environment import BLAST_USBM_BETA, MOISTURE_BASE_PCT, PORE_PRESSURE_BASE_KPA
from sandbox.layout import (
    TIER_1A,
    TIER_1B,
    TIER_1C,
    TIER_2A,
    TIER_2B,
    TIER_3,
    node_ids,
    node_positions,
    node_tiers,
)
from sandbox.mesh import build_mesh

# ---------------------------------------------------------------------------
# Tilt noise is a property of the SILICON, not of the site.
# ---------------------------------------------------------------------------
#
# The brief pins these two figures as the reason 2A exists as a distinct
# tier. They replace the single site-wide SIGMA_TILT_URAD, which matched
# neither part.
SIGMA_TILT_MPU6050_URAD = 120.0   # 1A / 1B / 1C / 2B — the cheap IMU
SIGMA_TILT_ADXL355_URAD = 3.0     # 2A only — the quiet accelerometer

#: Which tiers carry which channels. The single source of truth for the
#: null rule: a channel absent from a tier's set is never written.
TIER_CHANNELS: dict[str, frozenset[str]] = {
    TIER_1A: frozenset(
        {
            "tilt_x_urad", "tilt_y_urad",
            "accel_x_mg", "accel_y_mg", "accel_z_mg",
            "gyro_x_mdps", "gyro_y_mdps", "gyro_z_mdps",
            "vib_rms_x100", "vib_peak_x100", "vib_fdom_hz",
            "die_temp_dc",
        }
    ),
    TIER_1B: frozenset(
        {
            "tilt_x_urad", "tilt_y_urad",
            "accel_x_mg", "accel_y_mg", "accel_z_mg",
            "gyro_x_mdps", "gyro_y_mdps", "gyro_z_mdps",
            "vib_rms_x100", "vib_peak_x100", "vib_fdom_hz",
            "die_temp_dc",
            "fissure_mm", "strain_ue",
        }
    ),
    TIER_1C: frozenset(
        {
            "tilt_x_urad", "tilt_y_urad",
            "accel_x_mg", "accel_y_mg", "accel_z_mg",
            "gyro_x_mdps", "gyro_y_mdps", "gyro_z_mdps",
            "vib_rms_x100", "vib_peak_x100", "vib_fdom_hz",
            "die_temp_dc",
            "moisture_pct", "ext_delta_10um",
        }
    ),
    TIER_2A: frozenset({"tilt_x_urad", "tilt_y_urad", "die_temp_dc"}),
    TIER_2B: frozenset(
        {
            "pore_pressure_kpa",
            "borehole_tilt_d1", "borehole_tilt_d2",
            "borehole_tilt_d3", "borehole_tilt_d4",
            "die_temp_dc",
        }
    ),
    TIER_3: frozenset({"gps_dx_mm", "gps_dy_mm", "gps_dz_mm", "die_temp_dc"}),
}

#: The measurement columns of `nodes.csv`, in order. Housekeeping columns
#: (t_iso, node_id, seq, vbat, link stats, alive) are carried by every
#: tier and sit outside this list.
CHANNEL_COLUMNS: tuple[str, ...] = (
    "tilt_x_urad", "tilt_y_urad",
    "accel_x_mg", "accel_y_mg", "accel_z_mg",
    "gyro_x_mdps", "gyro_y_mdps", "gyro_z_mdps",
    "vib_rms_x100", "vib_peak_x100", "vib_fdom_hz",
    "strain_ue", "fissure_mm",
    "moisture_pct", "ext_delta_10um",
    "pore_pressure_kpa",
    "borehole_tilt_d1", "borehole_tilt_d2",
    "borehole_tilt_d3", "borehole_tilt_d4",
    "gps_dx_mm", "gps_dy_mm", "gps_dz_mm",
    "die_temp_dc",
)

CSV_COLUMNS: tuple[str, ...] = (
    ("t_iso", "node_id", "tier", "seq")
    + CHANNEL_COLUMNS
    + ("vbat_mv", "crack_flags", "rssi_dbm", "snr_db", "hops", "tx_dbm", "alive")
)

# Vibration dominant-frequency bands (brief section 1). Microseismic is
# the band that matters — it is what precedes ground failure, and the old
# hardcoded 18/52 Hz pair could never produce it.
FDOM_TRUCK_HZ = (8, 20)
FDOM_CONVEYOR_HZ = (49, 51)
FDOM_BLAST_HZ = (40, 80)
FDOM_MICROSEISMIC_HZ = (100, 250)

# ---------------------------------------------------------------------------
# OU wander: a continuous-time correlation constant derived once from the
# historical phi=0.88-per-60s calibration (M2, DATA-365 plan), so a wander
# step can be re-discretized for any tick length dt_seconds and still reach
# the SAME stationary std regardless of how long a tick actually is.
# ---------------------------------------------------------------------------
_WANDER_TAU_S = -TICK_SIM_SECONDS / math.log(WANDER_PHI_PER_TICK)


def _ou_step(current: float, target_std: float, dt_seconds: float, draw: float) -> float:
    """One re-discretized Ornstein-Uhlenbeck step with stationary std `target_std`.

    `draw` is a standard-normal sample from the caller's own rng (kept
    external so every wander channel still draws from the same stream in
    the same order run to run, matching the rest of this module's
    reproducibility). `phi = exp(-dt/tau)` and `step_std =
    target_std*sqrt(1-phi^2)` are the discretization that keeps a
    zero-mean OU process's stationary variance equal to `target_std^2` for
    ANY dt — the previous fixed `0.88` per call silently assumed dt was
    always the interactive 60 s tick, so a scripted run's 3600 s ticks
    still only decayed by 0.88, overstating the wander's real-world
    persistence by 60x.
    """
    phi = math.exp(-dt_seconds / _WANDER_TAU_S)
    step_std = target_std * math.sqrt(max(0.0, 1.0 - phi * phi))
    return phi * current + step_std * draw


@dataclass
class NodePersonality:
    """Per-node hardware and environmental personality constants."""

    node_id: int
    tier: str
    x_m: float
    y_m: float
    grid_ix: int
    grid_iy: int
    array_idx: int
    temp_offset_c: float
    sigma_tilt_urad: float
    hops: int
    tx_dbm: int | None
    vbat_nominal_mv: float = 3600.0
    seq: int = 0
    base_rssi_dbm: float = -98.0
    base_snr_db: float = 12.0
    alive: int = 1
    crack_latched: int = 0
    max_fissure_mm: float = 0.0
    wander_strain: float = 0.0
    wander_tilt_x: float = 0.0
    wander_tilt_y: float = 0.0
    wander_vib_rms: float = 0.08
    wander_vbat: float = 0.0

    def carries(self, channel: str) -> bool:
        """Whether this node's hardware includes `channel` at all."""
        return channel in TIER_CHANNELS[self.tier]


@dataclass
class SensorNoiseConfig:
    """Noise budget configuration for the sensor array."""

    sigma_strain_ue: float = SIGMA_STRAIN_UE
    sigma_ext_10um: float = SIGMA_EXT_10UM
    sigma_temp_dc: float = SIGMA_TEMP_DC
    sigma_vbat_mv: float = SIGMA_VBAT_MV
    enable_noise: bool = True
    seed: int = 42


@dataclass
class SensorReading:
    """One node's telemetry for one tick — one row of `nodes.csv`.

    `channels` holds only the channels this node's tier actually carries.
    A channel absent from the dict is NULL, and is written as an empty CSV
    field. It is deliberately not possible to represent "missing" as 0.
    """

    t_iso: str
    node_id: int
    tier: str
    seq: int | None
    channels: dict[str, float | int]
    vbat_mv: int | None
    crack_flags: int | None
    rssi_dbm: int | None
    snr_db: float | None
    hops: int | None
    tx_dbm: int | None
    alive: int
    #: Authoritative health state for this node this tick, assigned by
    #: `SimulationSession.tick()` from the collapse-radius rule. This is the
    #: ONLY thing any UI may colour a node by - dashboards must not re-derive
    #: state from raw strain, or they drift out of step with the physics and
    #: paint nodes red during ordinary baseline subsidence.
    node_state: str = "ACTIVE"

    def get(self, channel: str) -> float | int | None:
        """This node's value for `channel`, or None if its tier lacks it."""
        return self.channels.get(channel)

    def to_csv_row(self) -> str:
        """Format as CSV matching `CSV_COLUMNS`.

        A channel the tier does not carry becomes an empty field, never a
        zero — that distinction is the whole point of the tier system.
        """
        if self.alive == 0:
            # Dead node: present row, every measurement blank, alive=0.
            blanks = "," * (len(CSV_COLUMNS) - 4)
            return f"{self.t_iso},{self.node_id},{self.tier}{blanks},0"

        def fmt(v: float | int | None) -> str:
            if v is None:
                return ""
            if isinstance(v, float):
                return f"{v:.2f}"
            return str(v)

        cells = [self.t_iso, str(self.node_id), self.tier, fmt(self.seq)]
        cells += [fmt(self.channels.get(c)) for c in CHANNEL_COLUMNS]
        cells += [
            fmt(self.vbat_mv),
            fmt(self.crack_flags),
            fmt(self.rssi_dbm),
            f"{self.snr_db:.1f}" if self.snr_db is not None else "",
            fmt(self.hops),
            fmt(self.tx_dbm),
            str(self.alive),
        ]
        return ",".join(cells)


def _coord_to_grid_index(coord_m: float) -> int:
    """Map a coordinate to the nearest 0..GRID_N-1 grid index.

    Unlike the old uniform layout, node positions no longer land exactly
    on grid points — irregular placement is the point — so this rounds to
    the nearest sample. At 2.5 m grid spacing the worst-case offset is
    1.25 m, far below the scale on which the subsidence field varies.

    A node outside the window (the gateway, by construction) clamps to the
    edge; it reads ~zero movement there anyway, which is exactly the
    stable reference it is placed to provide.
    """
    half = WINDOW_SIZE_M / 2.0
    dx = WINDOW_SIZE_M / (GRID_N - 1)
    idx = int(round((coord_m + half) / dx))
    return max(0, min(GRID_N - 1, idx))


class SensorArray:
    """Manages sampling and corruption for the tiered telemetry network."""

    def __init__(self, noise_config: SensorNoiseConfig | None = None):
        self.noise_config = noise_config or SensorNoiseConfig()
        self.rng = np.random.default_rng(self.noise_config.seed)

        positions = node_positions()
        ids = node_ids()
        tiers = node_tiers()

        # Link attributes come from the commissioned mesh DAG, not from a
        # distance-to-centre guess. `hops` used to be invented from radius,
        # which could disagree with the topology the network actually has.
        mesh_by_id = {l.node_id: l for l in build_mesh()}

        self.nodes: list[NodePersonality] = []
        for array_idx, (n_id, (x, y), tier) in enumerate(zip(ids, positions, tiers)):
            link = mesh_by_id[int(n_id)]

            # Frozen pseudo-random personality offset per node.
            node_rng = np.random.default_rng(int(n_id) * 1000 + 42)
            temp_offset = float(node_rng.normal(0.0, 1.2))
            base_rssi = float(node_rng.normal(-98.0, 4.0))

            self.nodes.append(
                NodePersonality(
                    node_id=int(n_id),
                    tier=tier,
                    x_m=float(x),
                    y_m=float(y),
                    grid_ix=_coord_to_grid_index(x),
                    array_idx=array_idx,
                    grid_iy=_coord_to_grid_index(y),
                    temp_offset_c=temp_offset,
                    sigma_tilt_urad=(
                        SIGMA_TILT_ADXL355_URAD
                        if tier == TIER_2A
                        else SIGMA_TILT_MPU6050_URAD
                    ),
                    hops=link.hop_count,
                    tx_dbm=link.tx_power_dbm_nominal,
                    base_rssi_dbm=base_rssi,
                    alive=1,
                    seq=0,
                )
            )

    def _vib_fdom(self, vibration_transient: float) -> int:
        """Dominant vibration frequency for this tick.

        Bands are the brief's: a blast dominates when one is firing;
        otherwise the ground is either quiet (site machinery — truck or
        conveyor) or emitting microseismic energy. Microseismic is the
        precursor band, so it must be reachable; the old implementation
        returned a hardcoded 18 or 52 Hz and could never produce it.
        """
        if vibration_transient > 0.5:
            return int(self.rng.integers(*FDOM_BLAST_HZ))
        roll = self.rng.random()
        if roll < 0.12:
            return int(self.rng.integers(*FDOM_MICROSEISMIC_HZ))
        if roll < 0.55:
            return int(self.rng.integers(*FDOM_CONVEYOR_HZ))
        return int(self.rng.integers(*FDOM_TRUCK_HZ))

    def sample_tick(
        self,
        t_sim_days: float,
        t_sim_seconds: float,
        iso_timestamp: str,
        truth_channels: dict[str, np.ndarray],
        vibration_transient: float = 0.0,
        dt_seconds: float = TICK_SIM_SECONDS,
        vibration_source_xy: tuple[float, float] = (0.0, 0.0),
        environment_channels: dict[str, np.ndarray] | None = None,
    ) -> list[SensorReading]:
        """Sample and corrupt telemetry for every node at the current tick.

        Each node emits only the channels its tier carries; the rest are
        absent from `SensorReading.channels` and serialise to empty CSV
        fields.

        Parameters
        ----------
        t_sim_days : float
            Sim-time in days (for physical diurnal temperature cycles).
        t_sim_seconds : float
            Sim-time in elapsed seconds (for battery discharge sag).
        iso_timestamp : str
            Formatted ISO UTC timestamp of packet arrival.
        truth_channels : dict[str, np.ndarray]
            Truth arrays: 'tilt_x', 'tilt_y', 'strain_x', 'strain_y',
            'displacement_x', 's'.
        vibration_transient : float
            PPV (mm/s) at VIBRATION_REFERENCE_DISTANCE_M from
            `vibration_source_xy` — the reference a live transient
            (`Session.apply_vibration`) is calibrated at. Each node's own
            reading then attenuates from this reference by its own distance
            (USBM exponent), rather than every node receiving the same
            value regardless of position.
        dt_seconds : float
            Real elapsed sim-time since the last call, for the OU wander's
            per-second discretization (M2). Defaults to the interactive
            tick length; callers on a different cadence (e.g. a 3600 s
            scripted tick) must pass their own.
        vibration_source_xy : tuple[float, float]
            (x, y) of the transient's source, panel-centre by default.
        environment_channels : dict[str, np.ndarray] | None
            This tick's per-node environment arrays, indexed in the same
            node order as `self.nodes`: 'pore_pressure_kpa', 'moisture_pct'
            (NaN off-tier, same convention as E1). `None` (a caller with no
            environment attached) falls back to each channel's E1 day-0
            baseline constant — never a function of ground movement S.

        Returns
        -------
        list of one SensorReading per node.
        """
        tilt_x_grid = truth_channels["tilt_x"]
        tilt_y_grid = truth_channels["tilt_y"]
        strain_x_grid = truth_channels["strain_x"]
        strain_y_grid = truth_channels.get("strain_y", np.zeros_like(strain_x_grid))

        readings: list[SensorReading] = []
        cfg = self.noise_config

        # Diurnal temperature cycle: ambient T = 28 + 10 * sin(2*pi*t_days) °C
        ambient_temp_c = 28.0 + 10.0 * np.sin(2.0 * np.pi * t_sim_days)

        # Battery sag: slight monotonic drop over months (~10 mV per 30 days)
        vbat_sag = (t_sim_seconds / 86400.0) * (10.0 / 30.0)

        for node in self.nodes:
            if node.alive == 0:
                readings.append(
                    SensorReading(
                        t_iso=iso_timestamp,
                        node_id=node.node_id,
                        tier=node.tier,
                        seq=None,
                        channels={},
                        vbat_mv=None,
                        crack_flags=None,
                        rssi_dbm=None,
                        snr_db=None,
                        hops=None,
                        tx_dbm=None,
                        alive=0,
                    )
                )
                continue

            node.seq += 1
            ix, iy = node.grid_ix, node.grid_iy

            # 1. True ground values at this node's coordinate. Principal
            # strain (M2) takes the more tensile of the two axis-aligned
            # components: this reduced engine has no shear cross-term, so
            # with the axes already aligned to district's along/across-
            # strike directions, the larger signed value IS the major
            # principal strain — ignoring strain_y silently missed every
            # node where the across-strike component was the tensile one.
            true_tilt_x = float(tilt_x_grid[iy, ix])
            true_tilt_y = float(tilt_y_grid[iy, ix])
            true_strain_x = float(strain_x_grid[iy, ix])
            true_strain_y = float(strain_y_grid[iy, ix])
            true_strain_p = max(true_strain_x, true_strain_y)
            temp_c = float(ambient_temp_c + node.temp_offset_c)

            def noise(sigma: float) -> float:
                return self.rng.normal(0.0, sigma) if cfg.enable_noise else 0.0

            # 2. Continuous mean-reverting physical baseline wander
            # (Ornstein-Uhlenbeck drift), re-discretized per dt_seconds
            # (M2) so its stationary std stays pinned to a named noise
            # budget regardless of tick length. Produces authentic live
            # variation on idle sensors so the UI ticks continuously.
            if cfg.enable_noise:
                node.wander_strain = _ou_step(
                    node.wander_strain, cfg.sigma_strain_ue, dt_seconds, self.rng.normal()
                )
                node.wander_tilt_x = _ou_step(
                    node.wander_tilt_x, node.sigma_tilt_urad, dt_seconds, self.rng.normal()
                )
                node.wander_tilt_y = _ou_step(
                    node.wander_tilt_y, node.sigma_tilt_urad, dt_seconds, self.rng.normal()
                )
                # Vibration and battery wander keep their own small,
                # ASSUMED budgets (no site-instrument spec for either) but
                # are still re-discretized the same way for dt-independence.
                node.wander_vib_rms = float(np.clip(
                    0.08 + _ou_step(node.wander_vib_rms - 0.08, 0.02, dt_seconds, self.rng.normal()),
                    0.05, 0.16
                ))
                node.wander_vbat = _ou_step(
                    node.wander_vbat, cfg.sigma_vbat_mv, dt_seconds, self.rng.normal()
                )

            ch: dict[str, float | int] = {}

            # 2-5. Per-channel conversion, noise and quantisation — each
            # written only if this node's tier actually carries it.
            if node.carries("tilt_x_urad"):
                # Thermal tilt drift (M2, VERIFY): a MEMS package's own
                # thermal expansion biases its zero point away from a
                # 25 degC calibration, independent of and additive to the
                # ground's own tilt. Applied equally to both axes — no
                # per-axis thermal model is specified.
                tilt_drift_urad = THERMAL_TILT_DRIFT_URAD_PER_C * (temp_c - TILT_DRIFT_REFERENCE_C)
                ch["tilt_x_urad"] = int(
                    np.clip(
                        round(
                            true_tilt_x * 1e6 + tilt_drift_urad
                            + node.wander_tilt_x + noise(node.sigma_tilt_urad)
                        ),
                        -32768,
                        32767,
                    )
                )
                ch["tilt_y_urad"] = int(
                    np.clip(
                        round(
                            true_tilt_y * 1e6 + tilt_drift_urad
                            + node.wander_tilt_y + noise(node.sigma_tilt_urad)
                        ),
                        -32768,
                        32767,
                    )
                )

            if node.carries("accel_x_mg"):
                # The MPU-6050 rests in gravity; the horizontal components
                # are what the surface tilt projects onto its axes.
                ch["accel_x_mg"] = int(np.clip(round(true_tilt_x * 1000.0 + noise(4.0)), -32768, 32767))
                ch["accel_y_mg"] = int(np.clip(round(true_tilt_y * 1000.0 + noise(4.0)), -32768, 32767))
                ch["accel_z_mg"] = int(np.clip(round(1000.0 + noise(4.0)), -32768, 32767))

            if node.carries("gyro_x_mdps"):
                # Ground creep is far slower than the gyro's noise floor,
                # so these read as noise about zero — which is itself the
                # honest measurement, not a missing channel.
                ch["gyro_x_mdps"] = int(np.clip(round(noise(35.0)), -32768, 32767))
                ch["gyro_y_mdps"] = int(np.clip(round(noise(35.0)), -32768, 32767))
                ch["gyro_z_mdps"] = int(np.clip(round(noise(35.0)), -32768, 32767))

            if node.carries("vib_rms_x100"):
                # PPV kept separate from RMS (M2): vibration_transient is a
                # transient PEAK velocity from a discrete event (a blast),
                # calibrated at VIBRATION_REFERENCE_DISTANCE_M and
                # attenuated to this node's own distance by the USBM
                # exponent — not added into the continuous baseline RMS,
                # which the old code did uniformly for every node
                # regardless of position. The baseline RMS is ambient
                # machinery noise only; a firing blast instead lifts the
                # PEAK channel, which is what it actually is.
                base_rms_mms = node.wander_vib_rms + 0.02 * self.rng.random()
                base_peak_mms = base_rms_mms * 1.45
                if vibration_transient > 0.0:
                    dist_m = max(1.0, float(np.hypot(
                        node.x_m - vibration_source_xy[0], node.y_m - vibration_source_xy[1]
                    )))
                    node_ppv_mms = vibration_transient * (
                        VIBRATION_REFERENCE_DISTANCE_M / dist_m
                    ) ** BLAST_USBM_BETA
                else:
                    node_ppv_mms = 0.0
                ch["vib_rms_x100"] = int(np.clip(round(base_rms_mms * 100.0), 0, 65535))
                ch["vib_peak_x100"] = int(
                    np.clip(round(max(base_peak_mms, node_ppv_mms) * 100.0), 0, 65535)
                )
                ch["vib_fdom_hz"] = self._vib_fdom(node_ppv_mms)

            if node.carries("strain_ue"):
                strain_p_ue = true_strain_p * 1e6 + node.wander_strain + noise(cfg.sigma_strain_ue)
                ch["strain_ue"] = int(np.clip(round(strain_p_ue), -32768, 32767))

            if node.carries("fissure_mm"):
                # Ground cracking (M2): the finale's own opening_mm relation
                # (principal tensile strain over a threshold, times a gauge
                # spacing) replaces this sandbox's undocumented bare
                # `* 1000.0 * 2.0` (an unstated 2 m spacing, no threshold).
                # A crack opens only in tension and does not fully close —
                # `max_fissure_mm` is the latch: once opened, width floors
                # at CRACK_PARTIAL_CLOSURE_FRACTION of its own recorded
                # maximum rather than returning to zero as the tensile zone
                # passes and the ground goes into compression behind it.
                strain_p_ue_true = true_strain_p * 1e6
                w_now = max(
                    0.0,
                    (strain_p_ue_true - CRACK_TENSILE_THRESHOLD_UE) * 1e-6 * CRACK_SPACING_M * 1000.0,
                )
                node.max_fissure_mm = max(node.max_fissure_mm, w_now)
                floor = (
                    CRACK_PARTIAL_CLOSURE_FRACTION * node.max_fissure_mm
                    if node.max_fissure_mm > 0.0
                    else 0.0
                )
                width = max(w_now, floor)
                ch["fissure_mm"] = round(float(max(0.0, width + noise(0.05))), 2)

            if node.carries("moisture_pct"):
                # From the E1 environment model (M2), not a fake linear
                # function of subsidence: real soil moisture responds to
                # rainfall infiltration, not to how deep the ground has
                # sunk. No environment attached (e.g. a bare-kernel test)
                # falls back to E1's own dry-season day-0 baseline, never
                # to a function of S.
                if environment_channels is not None:
                    base_moisture = float(environment_channels["moisture_pct"][node.array_idx])
                else:
                    base_moisture = MOISTURE_BASE_PCT
                ch["moisture_pct"] = round(
                    float(np.clip(base_moisture + noise(0.4), 0.0, 100.0)), 2
                )

            if node.carries("ext_delta_10um"):
                # 10 m anchor wire: principal strain * 10 m in 10 µm units.
                ch["ext_delta_10um"] = int(
                    np.clip(
                        round((true_strain_p * 10.0) / 1e-5 + noise(cfg.sigma_ext_10um)),
                        -32768,
                        32767,
                    )
                )

            if node.carries("pore_pressure_kpa"):
                # From the E1 environment model (M2), not a fake linear
                # function of subsidence: real piezometer pressure responds
                # to the aquifer's own recharge/drainage, not directly to
                # how deep the ground above it has sunk. Falls back to E1's
                # own hydrostatic day-0 baseline when no environment is
                # attached.
                if environment_channels is not None:
                    base_pp = float(environment_channels["pore_pressure_kpa"][node.array_idx])
                else:
                    base_pp = PORE_PRESSURE_BASE_KPA
                ch["pore_pressure_kpa"] = round(
                    float(max(0.0, base_pp + noise(1.5))), 2
                )

            if node.carries("borehole_tilt_d1"):
                # An inclinometer string reads tilt at four depths; the
                # deeper sensors see progressively less of the surface
                # movement as the borehole approaches bedrock.
                tilt_mag = float(np.hypot(true_tilt_x, true_tilt_y)) * 1e6
                for i, share in enumerate((1.0, 0.72, 0.45, 0.18), start=1):
                    ch[f"borehole_tilt_d{i}"] = int(
                        np.clip(
                            round(tilt_mag * share + noise(node.sigma_tilt_urad)),
                            -32768,
                            32767,
                        )
                    )

            if node.carries("gps_dx_mm"):
                # The gateway sits outside the angle of draw and BY
                # CONSTRUCTION cannot move. Anything it reports is
                # instrument drift, not ground movement — so these are
                # noise about zero and must stay that way.
                ch["gps_dx_mm"] = round(float(noise(6.0)), 2)
                ch["gps_dy_mm"] = round(float(noise(6.0)), 2)
                ch["gps_dz_mm"] = round(float(noise(9.0)), 2)

            # Die temperature — every tier carries it.
            temp_c = ambient_temp_c + node.temp_offset_c
            ch["die_temp_dc"] = int(
                np.clip(round(temp_c * 10.0 + noise(cfg.sigma_temp_dc)), -32768, 32767)
            )

            # Crack latch, on the tiers that can actually measure strain.
            strain_ue = ch.get("strain_ue")
            if strain_ue is not None:
                if strain_ue > 5300:
                    node.crack_latched = max(node.crack_latched, 2)
                elif strain_ue > 4000:
                    node.crack_latched = max(node.crack_latched, 1)

            vbat = node.vbat_nominal_mv - vbat_sag + node.wander_vbat + noise(cfg.sigma_vbat_mv)

            readings.append(
                SensorReading(
                    t_iso=iso_timestamp,
                    node_id=node.node_id,
                    tier=node.tier,
                    seq=node.seq,
                    channels=ch,
                    vbat_mv=int(np.clip(round(vbat), 2000, 4200)),
                    crack_flags=node.crack_latched,
                    rssi_dbm=int(
                        np.clip(round(node.base_rssi_dbm + self.rng.normal(0, 1.0)), -120, -40)
                    ),
                    snr_db=float(
                        np.clip(round(node.base_snr_db + self.rng.normal(0, 0.5), 1), 0.0, 30.0)
                    ),
                    hops=node.hops,
                    tx_dbm=node.tx_dbm,
                    alive=1,
                )
            )

        return readings
