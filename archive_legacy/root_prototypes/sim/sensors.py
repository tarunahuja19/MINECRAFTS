"""Physical sensor hardware simulation, noise models, and calibration undo.

Non-negotiable Invariant I7:
Every node's noise is driven by a per-node seed from config/nodes.json.
Two runs with the same config produce bit-identical readings.
"""
from dataclasses import dataclass, field
import struct
from typing import Any
import numpy as np
from ground.surface import GroundModel


@dataclass
class SensorReading:
    """Raw reading struct from node RAM (Level A) and 21-byte packet (Level B)."""
    node_id: int
    seq: int
    t_iso: str
    t_days: float
    # Raw uncompensated electrical / transmitted values
    tilt_x_urad: int
    tilt_y_urad: int
    strain_ue: int
    ext_delta_10um: int  # in units of 10 um (Level B packet)
    vib_rms_c: int  # mm/s * 100
    vib_peak_c: int  # mm/s * 100
    vib_fdom_hz: int
    temp_c10: int  # 0.1 deg C
    vbat_mv: int
    crack_bucket: int
    flags: int = 0


@dataclass
class NodeState:
    """State preserved across time steps for a single physical sensor node."""
    id: int
    xy: tuple[float, float]
    ext_to: tuple[float, float]
    seed: int
    crack_threshold_ue: float
    role: str = "field"
    # Bias walk cumulative states
    bias_tilt_x: float = 0.0
    bias_tilt_y: float = 0.0
    bias_strain: float = 0.0
    bias_ext: float = 0.0
    max_strain_seen: float = 0.0
    alive: bool = True
    dead_since: str | None = None
    rng: np.random.Generator = field(init=False)

    def __post_init__(self):
        # Invariant I7: Deterministic per-node RNG
        self.rng = np.random.default_rng(self.seed)

    def reset_rng(self):
        """Reset RNG to initial seed for identical replay."""
        self.rng = np.random.default_rng(self.seed)
        self.bias_tilt_x = 0.0
        self.bias_tilt_y = 0.0
        self.bias_strain = 0.0
        self.bias_ext = 0.0
        self.max_strain_seen = 0.0
        self.alive = True
        self.dead_since = None


class SensorFleet:
    """Manages the 30-sensor fleet and executes the 6-step physical damage chain."""

    # Physical sensor constants from part1-reference.md §2.3
    K_THERMAL_TILT = 520.0  # urad / deg C
    K_THERMAL_STRAIN = 4.0  # ue / deg C
    K_THERMAL_EXT_PER_M = 0.11  # um / deg C / m of wire
    TEMP_CALIBRATION = 25.0  # deg C
    VBAT_NOMINAL = 3700.0  # mV

    # Step noise sigmas
    SIGMA_BIAS_TILT = 3.0  # urad / step
    SIGMA_BIAS_STRAIN = 0.05  # ue / step
    SIGMA_BIAS_EXT = 0.5  # um / step

    SIGMA_WHITE_TILT = 200.0  # urad
    SIGMA_WHITE_STRAIN = 5.0  # ue
    SIGMA_WHITE_EXT = 50.0  # um
    SIGMA_WHITE_TEMP = 0.2  # deg C
    SIGMA_WHITE_VBAT = 8.0  # mV
    SIGMA_WHITE_VIB = 0.01  # mm/s

    # Quantisation steps
    STEP_TILT = 7.6  # urad
    STEP_STRAIN = 0.5  # ue
    STEP_EXT = 10.0  # um (packet resolution)

    def __init__(self, nodes_config: list[dict[str, Any]], ground_model: GroundModel):
        self.ground = ground_model
        self.nodes: dict[int, NodeState] = {}
        for cfg in nodes_config:
            node = NodeState(
                id=cfg["id"],
                xy=tuple(cfg["xy"]),
                ext_to=tuple(cfg.get("ext_to", (cfg["xy"][0], cfg["xy"][1] + 10.0))),
                seed=cfg["seed"],
                crack_threshold_ue=cfg.get("crack_threshold_ue", 6500.0),
                role=cfg.get("role", "field"),
            )
            self.nodes[node.id] = node

    def reset_all_seeds(self) -> None:
        """Reset all node RNGs for bit-identical reproducibility (Invariant I7)."""
        for node in self.nodes.values():
            node.reset_rng()

    def sample_fleet(
        self,
        t_days: float,
        seq: int,
        t_iso: str,
        blast_event: dict[str, Any] | None = None,
    ) -> list[SensorReading]:
        """Sample all alive nodes at time t_days and apply the 6-step damage chain in order."""
        readings = []
        hour = (t_days * 24.0) % 24.0

        for nid, node in self.nodes.items():
            if not node.alive:
                continue

            rng = node.rng
            xA, yA = node.xy
            xC, yC = node.ext_to

            # Ground truth values from GroundModel (Invariant I1)
            dS_dx, dS_dy = self.ground.grad_S(xA, yA, t_days)
            true_tilt_x_urad = float(dS_dx) * 1e6
            true_tilt_y_urad = float(dS_dy) * 1e6

            # Strain along y or extensometer axis
            dx = xC - xA
            dy = yC - yA
            L = np.hypot(dx, dy)
            e_hat = (dx / L, dy / L) if L > 0 else (0.0, 1.0)
            true_strain = float(self.ground.strain_along(xA, yA, t_days, e_hat=e_hat))
            true_strain_ue = true_strain * 1e6

            true_ext_m = float(self.ground.ext_delta(node.xy, node.ext_to, t_days))
            true_ext_um = true_ext_m * 1e6

            # Diurnal temperature cycle: temp = 22 + 13*sin(2*pi*(hour - 9)/24) + 0.4*N(0,1)
            # Enclosure warms in daylight
            sun_heating = max(0.0, 12.0 * np.sin(np.pi * (hour - 6.0) / 12.0)) if 6.0 <= hour <= 18.0 else 0.0
            temp_c = 22.0 + 13.0 * np.sin(2.0 * np.pi * (hour - 9.0) / 24.0) + sun_heating + rng.normal(0.0, self.SIGMA_WHITE_TEMP)

            # Battery voltage: 3700 - 300*(t/40) + solar charge
            vbat_mv = 3700.0 - 250.0 * (t_days / 40.0) + (80.0 if 8.0 <= hour <= 16.0 else -40.0) + rng.normal(0.0, self.SIGMA_WHITE_VBAT)
            vbat_mv = float(np.clip(vbat_mv, 3300.0, 4200.0))
            vbat_ratio = vbat_mv / self.VBAT_NOMINAL

            # ----------------- 6-STEP DAMAGE CHAIN -----------------
            # Step 1: Thermal drift
            temp_delta = temp_c - self.TEMP_CALIBRATION
            k_ext = self.K_THERMAL_EXT_PER_M * L

            d1_tilt_x = true_tilt_x_urad + self.K_THERMAL_TILT * temp_delta
            d1_tilt_y = true_tilt_y_urad + self.K_THERMAL_TILT * temp_delta
            d1_strain = true_strain_ue + self.K_THERMAL_STRAIN * temp_delta
            d1_ext = true_ext_um + k_ext * temp_delta

            # Step 2: Bias random walk (persists forever)
            node.bias_tilt_x += rng.normal(0.0, self.SIGMA_BIAS_TILT)
            node.bias_tilt_y += rng.normal(0.0, self.SIGMA_BIAS_TILT)
            node.bias_strain += rng.normal(0.0, self.SIGMA_BIAS_STRAIN)
            node.bias_ext += rng.normal(0.0, self.SIGMA_BIAS_EXT)

            d2_tilt_x = d1_tilt_x + node.bias_tilt_x
            d2_tilt_y = d1_tilt_y + node.bias_tilt_y
            d2_strain = d1_strain + node.bias_strain
            d2_ext = d1_ext + node.bias_ext

            # Step 3: White noise (datasheet sigma)
            d3_tilt_x = d2_tilt_x + rng.normal(0.0, self.SIGMA_WHITE_TILT)
            d3_tilt_y = d2_tilt_y + rng.normal(0.0, self.SIGMA_WHITE_TILT)
            d3_strain = d2_strain + rng.normal(0.0, self.SIGMA_WHITE_STRAIN)
            d3_ext = d2_ext + rng.normal(0.0, self.SIGMA_WHITE_EXT)

            # Step 4: Reference sag (scales analogue measurements)
            d4_tilt_x = d3_tilt_x * vbat_ratio
            d4_tilt_y = d3_tilt_y * vbat_ratio
            d4_strain = d3_strain * vbat_ratio
            d4_ext = d3_ext * vbat_ratio

            # Step 5: Quantisation (round to ADC step)
            d5_tilt_x = round(d4_tilt_x / self.STEP_TILT) * self.STEP_TILT
            d5_tilt_y = round(d4_tilt_y / self.STEP_TILT) * self.STEP_TILT
            d5_strain = round(d4_strain / self.STEP_STRAIN) * self.STEP_STRAIN
            d5_ext = round(d4_ext / self.STEP_EXT) * self.STEP_EXT

            # Step 6: Event transients (blast / truck)
            vib_rms = 0.02 + abs(rng.normal(0.0, self.SIGMA_WHITE_VIB))
            vib_peak = vib_rms * 1.5
            vib_fdom = 50 + int(rng.integers(-5, 5))

            if blast_event:
                # Blast attenuation with distance from blast center
                bx, by = blast_event.get("x", 310.0), blast_event.get("y", 95.0)
                dist_b = max(10.0, float(np.hypot(xA - bx, yA - by)))
                charge = blast_event.get("charge_kg", 120.0)
                # USBM vibration formula: PPV ~ k * (dist / sqrt(charge))^-1.6
                blast_ppv = min(40.0, 1500.0 * ((dist_b / np.sqrt(charge)) ** -1.6))
                vib_peak = max(vib_peak, blast_ppv)
                vib_rms = max(vib_rms, blast_ppv * 0.4)
                vib_fdom = 25  # Lower dominant frequency for blast shock

            # Crack continuity (one-way latch)
            node.max_strain_seen = max(node.max_strain_seen, abs(d5_strain))
            crack_bucket = min(3, int(node.max_strain_seen / (node.crack_threshold_ue / 3.0)))

            reading = SensorReading(
                node_id=nid,
                seq=seq,
                t_iso=t_iso,
                t_days=t_days,
                tilt_x_urad=int(round(d5_tilt_x)),
                tilt_y_urad=int(round(d5_tilt_y)),
                strain_ue=int(round(d5_strain)),
                ext_delta_10um=int(round(d5_ext / 10.0)),  # 10 um units per Level B packet spec
                vib_rms_c=int(round(vib_rms * 100.0)),
                vib_peak_c=int(round(vib_peak * 100.0)),
                vib_fdom_hz=int(vib_fdom),
                temp_c10=int(round(temp_c * 10.0)),
                vbat_mv=int(round(vbat_mv)),
                crack_bucket=int(crack_bucket),
            )
            readings.append(reading)

        return readings

    def uncompensate_and_convert(
        self,
        reading: SensorReading,
        node_cfg: dict[str, Any],
    ) -> dict[str, Any]:
        """Undo thermal drift and battery sag, convert to SI units, and compute observation sigma."""
        # 1. Reverse reference sag
        vbat_mv = reading.vbat_mv
        vbat_ratio = vbat_mv / self.VBAT_NOMINAL
        if vbat_ratio <= 0:
            vbat_ratio = 1.0

        tilt_x_urad = (reading.tilt_x_urad / vbat_ratio)
        tilt_y_urad = (reading.tilt_y_urad / vbat_ratio)
        strain_ue = (reading.strain_ue / vbat_ratio)
        ext_um = (reading.ext_delta_10um * 10.0 / vbat_ratio)

        # 2. Reverse thermal drift
        temp_c = reading.temp_c10 / 10.0
        temp_delta = temp_c - self.TEMP_CALIBRATION

        xyA = node_cfg["xy"]
        xyC = node_cfg.get("ext_to", [xyA[0], xyA[1] + 10.0])
        L = np.hypot(xyC[0] - xyA[0], xyC[1] - xyA[1])
        k_ext = self.K_THERMAL_EXT_PER_M * L

        tilt_x_corr_urad = tilt_x_urad - self.K_THERMAL_TILT * temp_delta
        tilt_y_corr_urad = tilt_y_urad - self.K_THERMAL_TILT * temp_delta
        strain_corr_ue = strain_ue - self.K_THERMAL_STRAIN * temp_delta
        ext_corr_um = ext_um - k_ext * temp_delta

        # 3. Convert to SI units: rad, dimensionless, metres
        tilt_si = [float(tilt_x_corr_urad * 1e-6), float(tilt_y_corr_urad * 1e-6)]
        strain_si = float(strain_corr_ue * 1e-6)
        ext_delta_m = float(ext_corr_um * 1e-6)

        # 4. Attach sigma per §4.2 Step 6
        # Sigma is larger when temp correction was large or battery is low
        temp_residual = abs(temp_delta) * 0.05
        batt_penalty = max(1.0, 3600.0 / max(vbat_mv, 3000.0))

        sigma_tilt = float(np.sqrt((self.SIGMA_WHITE_TILT * 1e-6) ** 2 + ((self.K_THERMAL_TILT * 0.2 * 1e-6) * batt_penalty) ** 2))
        sigma_strain = float(np.sqrt((self.SIGMA_WHITE_STRAIN * 1e-6) ** 2 + ((self.K_THERMAL_STRAIN * 0.2 * 1e-6) * batt_penalty) ** 2))
        sigma_ext = float(np.sqrt((self.SIGMA_WHITE_EXT * 1e-6) ** 2 + ((k_ext * 0.2 * 1e-6) * batt_penalty) ** 2))

        return {
            "tilt": tilt_si,
            "strain": strain_si,
            "ext_delta_m": ext_delta_m,
            "sigma": {
                "tilt": sigma_tilt,
                "strain": sigma_strain,
                "ext": sigma_ext,
            },
        }
