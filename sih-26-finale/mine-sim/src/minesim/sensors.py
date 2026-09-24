"""Sensor models and synthetic telemetry - WP4.

Pipeline per channel (contract §5): ideal -> quantise -> bias -> temperature drift -> noise.
Output signs at the boundary: subsidence_mm <= 0 is ground going down (before noise);
tilt + = surface rises toward +x/+y (i.e. -physics.tilt); strain + = tension.
No smoothing, no filtering, no alarm logic (Invariant 3). All parameters from cfg.sensors.
"""

from dataclasses import dataclass
import math
from typing import Any, Optional

from minesim import physics
from minesim.config import Config, SensorModel
from minesim.packet import airtime_ms
from minesim.provenance import Value, load_monuments, measured_at, monument_at
from minesim.sizing import Node
from minesim.world import WorldState

SECONDS_PER_DAY = 86400.0
SECONDS_PER_HOUR = 3600.0
SCOUT_UPLINK_BYTES = 23       # contract §6
BITMAP_ACK_BYTES = 6          # contract §6
SCOUT_TIERS = ("1A", "1B", "1C")


@dataclass(frozen=True)
class Reading:
    node_id: int
    epoch: int
    t_s: float
    subsidence: Value          # mm
    tilt_x: Optional[Value]    # microradians, tier 1A only
    tilt_y: Optional[Value]
    strain: Optional[Value]    # microstrain, tiers 1B and 1C
    displacement: Optional[Value] # mm, tier 1B only
    battery_mv: Value


def temperature_offset_c(t_days: float, cfg: Config) -> float:
    """Day/night temperature swing relative to the calibration temperature."""
    s = cfg.sensors
    return s.temperature_amplitude_c * math.sin(2.0 * math.pi * t_days / s.temperature_period_days)


def apply_sensor(ideal: float, model: SensorModel, d_temp_c: float, rng: Any) -> float:
    quantised = round(ideal / model.resolution) * model.resolution
    return quantised + model.bias + model.temp_drift_per_c * d_temp_c + rng.normal(0.0, model.noise_sigma)


def strain_axis(node: Node) -> str:
    """Rods and wires lie along their survey line: transverse line measures y, longitudinal x."""
    return "x" if node.line == "longitudinal" else "y"


def battery_mv(t_s: float, cfg: Config, rng: Any) -> float:
    """Linear state of charge from average current: one uplink + one bitmap ACK per superframe."""
    r, p = cfg.radio, cfg.power
    period_s = r.superframe_period_s
    tx_s = airtime_ms(SCOUT_UPLINK_BYTES, r.scout_sf, r) / 1000.0
    rx_s = airtime_ms(BITMAP_ACK_BYTES, r.scout_sf, r) / 1000.0
    avg_ma = (p.current_ma["tx"] * tx_s + p.current_ma["rx"] * rx_s) / period_s + p.current_ma["sleep"]
    used_mah = avg_ma * t_s / SECONDS_PER_HOUR
    soc = min(max(1.0 - used_mah / p.scout_battery_mah, 0.0), 1.0)
    b = cfg.sensors.battery
    return b.empty_mv + (b.full_mv - b.empty_mv) * soc + rng.normal(0.0, b.noise_sigma)


def read_node(node: Node, world: WorldState, cfg: Config, rng: Any) -> Reading:
    """Read a simulated Scout on the current terrain."""
    if node.tier not in SCOUT_TIERS:
        raise ValueError(f"read_node is for Scouts (1A/1B/1C), got tier {node.tier!r}")
    t_s, t_days = world.t_s, world.t_days
    d_temp = temperature_offset_c(t_days, cfg)
    s = cfg.sensors

    # Subsidence: real at a monument on a monument epoch, pinned at a monument otherwise.
    mon = load_monuments(str(cfg.profiles_csv), cfg.survey_line_x_m, cfg.survey_origin_offset_m)
    tol = s.monument_position_tolerance_m
    epoch_tol_days = cfg.sim.timestep_s / SECONDS_PER_DAY / 2.0
    measured = measured_at(mon, node.x_m, node.y_m, t_days, tol, epoch_tol_days)
    ideal_subsidence = world.z_at(node.x_m, node.y_m) - node.z0_mm
    if measured is not None:
        subsidence = Value(measured, "mm", "real")
    else:
        tag = "pinned" if monument_at(mon, node.x_m, node.y_m, tol) is not None else "synthetic"
        subsidence = Value(apply_sensor(ideal_subsidence, s.subsidence, d_temp, rng), "mm", tag)

    tilt_x = tilt_y = strain = displacement = None
    if node.tier == "1A":
        tx, ty = physics.tilt(node.x_m, node.y_m, t_days, cfg.panel, cfg.knothe)
        tilt_x = Value(apply_sensor(-tx, s.tilt_1a, d_temp, rng), "urad", "synthetic")
        tilt_y = Value(apply_sensor(-ty, s.tilt_1a, d_temp, rng), "urad", "synthetic")
    elif node.tier == "1B":
        axis = strain_axis(node)
        e = physics.strain(node.x_m, node.y_m, t_days, cfg.panel, cfg.knothe,
                           cfg.sensing.strain_rod_baseline_m, axis)
        ux, uy = physics.displacement(node.x_m, node.y_m, t_days, cfg.panel, cfg.knothe)
        strain = Value(apply_sensor(e, s.strain_1b, d_temp, rng), "ustrain", "synthetic")
        displacement = Value(apply_sensor(ux if axis == "x" else uy, s.displacement_1b, d_temp, rng),
                             "mm", "synthetic")
    else:  # 1C
        e = physics.strain(node.x_m, node.y_m, t_days, cfg.panel, cfg.knothe,
                           cfg.sensing.extensometer_baseline_m, strain_axis(node))
        strain = Value(apply_sensor(e, s.strain_1c, d_temp, rng), "ustrain", "synthetic")

    return Reading(
        node_id=node.node_id, epoch=world.epoch, t_s=t_s,
        subsidence=subsidence, tilt_x=tilt_x, tilt_y=tilt_y, strain=strain,
        displacement=displacement, battery_mv=Value(battery_mv(t_s, cfg, rng), "mV", "synthetic"),
    )
