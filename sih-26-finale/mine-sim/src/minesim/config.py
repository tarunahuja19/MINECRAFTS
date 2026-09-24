"""Configuration models and loader for the minesim simulator.

Loads config/assumptions.yaml and merges with config/mines/<name>.yaml.
Raises UnpinnedParameterError on null parameters in geometry or knothe.
Derived quantities (influence radius r, deformation extent, t63, settling tail,
travelling window) are calculated dynamically from configuration values.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
import yaml

from minesim.errors import UnpinnedParameterError

SECONDS_PER_DAY = 86400.0


def _district_layout(
    geom: Dict[str, Any], width_m: float
) -> Tuple[Tuple[float, ...], Tuple[float, ...]]:
    """Panel centres and start days for a `geometry.district:` block.

    No block, or one panel, gives ((0.0,), (0.0,)) — the single-panel case, unchanged. The panels are
    laid out symmetrically about y = 0 on a pitch of panel width + chain pillar width, and their faces
    start on a stagger, because a district is mined a few faces at a time, not all at once.

    Mine-independent (invariant 8): everything here comes from config/mines/<name>.yaml.
    """
    d = geom.get("district")
    if not d:
        return (0.0,), (0.0,)
    n = int(d["n_panels"])
    if n < 1:
        raise ValueError(f"geometry.district.n_panels must be >= 1; got {n}")
    if n == 1:
        return (0.0,), (0.0,)
    pillar = float(d["chain_pillar_width_m"])
    if pillar < 0.0:
        raise ValueError(f"geometry.district.chain_pillar_width_m must be >= 0; got {pillar}")
    stagger = float(d.get("start_stagger_days", 0.0))
    pitch = width_m + pillar
    centre = (n - 1) / 2.0
    y_offsets = tuple((k - centre) * pitch for k in range(n))
    start_days = tuple(k * stagger for k in range(n))
    return y_offsets, start_days


@dataclass(frozen=True)
class PanelGeometry:
    width_m: float
    length_m: float
    depth_m: float
    seam_thickness_m: float
    seam_inclination_deg: float = 0.0
    advance_direction_deg: float = 0.0
    inflection_offset_m: float = 0.0    # trough edge sits this far inside every panel edge (Knothe d)
    # A mine district: one entry per panel. y_offsets_m is each panel's transverse centre,
    # start_day_offsets_d the day its face starts moving. The defaults below are exactly one panel on
    # the axis starting at t = 0 — i.e. the single-panel behaviour, unchanged.
    y_offsets_m: Tuple[float, ...] = (0.0,)
    start_day_offsets_d: Tuple[float, ...] = (0.0,)

    @property
    def n_panels(self) -> int:
        return len(self.y_offsets_m)

    @property
    def district_half_width_m(self) -> float:
        """Half-width of the whole district: outermost panel centre plus half a panel."""
        return max(abs(o) for o in self.y_offsets_m) + self.width_m / 2.0


@dataclass(frozen=True)
class KnotheParams:
    subsidence_factor: float      # a
    tan_beta: float
    time_coefficient: float        # c, per day
    advance_m_per_day: float       # v


@dataclass(frozen=True)
class SensingConfig:
    strain_rod_baseline_m: float
    extensometer_baseline_m: float
    detection_threshold_mm: float


@dataclass(frozen=True)
class LayoutConfig:
    spacing_m: float
    max_children_per_anchor: int
    tilt_detection_snr: float              # tilt-only (1A) node needs peak tilt >= this x its per-period noise floor
    source: str = "v1"                     # "v1" = travelling cross (sizing.py); "plan" = placement.plan_network
    placement: Optional[Dict[str, Any]] = None   # assumptions.yaml placement section (read when source == plan)
    site: Optional[Dict[str, Any]] = None        # mine site block, dem_npz resolved to a path


@dataclass(frozen=True)
class RadioConfig:
    band: str
    bandwidth_khz: float
    scout_sf: int
    anchor_sf: int
    coding_rate: str
    preamble_symbols: int
    explicit_header: bool
    crc: bool
    duty_cycle_ceiling_pct: float
    superframe_period_s: float
    local_channels: int
    backbone_channels: int
    antenna_height_m: Dict[str, float]
    frequency_mhz: float
    tx_power_dbm: float
    sensitivity_dbm: Dict[int, float]      # keyed by spreading factor
    link_margin_db_min: float
    bernoulli_loss_prob: float


@dataclass(frozen=True)
class SensorModel:
    """One measurement channel: ideal -> quantise -> bias -> temperature drift -> noise."""
    resolution: float
    bias: float
    temp_drift_per_c: float
    noise_sigma: float


@dataclass(frozen=True)
class BatteryModel:
    full_mv: float
    empty_mv: float
    noise_sigma: float


@dataclass(frozen=True)
class SensorsConfig:
    subsidence: SensorModel                # all tiers, mm
    tilt_1a: SensorModel                   # microradians
    strain_1b: SensorModel                 # microstrain over A8
    displacement_1b: SensorModel           # mm
    strain_1c: SensorModel                 # microstrain over A9
    battery: BatteryModel
    temperature_amplitude_c: float
    temperature_period_days: float
    monument_position_tolerance_m: float


@dataclass(frozen=True)
class PowerConfig:
    scout_battery_mah: float
    current_ma: Dict[str, float]
    target_life_days: float


@dataclass(frozen=True)
class CostConfig:
    unit_inr: Dict[str, int]


@dataclass(frozen=True)
class SimConfig:
    timestep_s: float
    duration_days: int
    grid_cell_m: float
    rng_seed: int


@dataclass(frozen=True)
class CracksConfig:
    """Surface cracking (F10). Every value here is a placeholder with a rationale, not a
    measurement - see the OPEN - VERIFY comments in config/assumptions.yaml."""
    tensile_strain_threshold_ue: float
    crack_spacing_m: float
    partial_closure_fraction: float
    dgms_tensile_strain_limit_ue: float
    export_cell_m: float


@dataclass(frozen=True)
class DamageConfig:
    """NCB change-of-length damage classification (F10)."""
    ncb_edges_mm: Tuple[float, ...]
    default_structure_length_m: float


@dataclass(frozen=True)
class VibrationConfig:
    """Ground vibration (F10). Blast attenuation, caving cycle, and DGMS limits.

    Vibration is telemetry only: nothing here may write to S(x, y, t), the world grid or node Z.
    """
    blast_k: float
    blast_b: float
    first_fall_advance_m: float
    periodic_weighting_interval_m: float
    caving_ppv_at_100m_mm_s: float
    machinery_floor_mm_s: float
    trigger_fraction: float
    bands_hz: Dict[str, Tuple[float, float]]
    dgms_limits_mm_s: Dict[str, Dict[str, float]]


@dataclass(frozen=True)
class Config:
    panel: PanelGeometry
    knothe: KnotheParams
    sensing: SensingConfig
    layout: LayoutConfig
    radio: RadioConfig
    power: PowerConfig
    cost: CostConfig
    sim: SimConfig
    provenance_source: str
    sensors: SensorsConfig
    profiles_csv: Path                     # real survey profiles backing provenance (resolved path)
    cracks: CracksConfig
    damage: DamageConfig
    vibration: VibrationConfig
    survey_line_x_m: Optional[float]       # along-panel x of the transverse survey line; None = not sourced
    survey_origin_offset_m: float = 0.0    # CSV distance_m = panel-axis y + this offset

    @property
    def r(self) -> float:
        """Influence radius r = depth / tan_beta in metres."""
        return self.panel.depth_m / self.knothe.tan_beta

    @property
    def influence_radius_m(self) -> float:
        return self.r

    @property
    def extent(self) -> float:
        """Deformation extent = effective width (W - 2d) + 2 * r in metres; W + 2r when d = 0."""
        return self.panel.width_m - 2.0 * self.panel.inflection_offset_m + 2.0 * self.r

    @property
    def deformation_extent_m(self) -> float:
        return self.extent

    @property
    def t63(self) -> float:
        """Knothe time-lag characteristic period t63 = 1 / c in days."""
        return 1.0 / self.knothe.time_coefficient

    @property
    def t63_days(self) -> float:
        return self.t63

    @property
    def tail(self) -> float:
        """Active settling tail = 3 * t63 * advance in metres."""
        return 3.0 * self.t63 * self.knothe.advance_m_per_day

    @property
    def settling_tail_m(self) -> float:
        return self.tail

    @property
    def window(self) -> float:
        """Travelling monitoring window = r + tail in metres."""
        return self.r + self.tail

    @property
    def travelling_window_m(self) -> float:
        return self.window


def _require(section: Dict[str, Any], key: str, where: str) -> Any:
    """Return section[key]; a missing or null value raises UnpinnedParameterError."""
    if section is None or section.get(key) is None:
        raise UnpinnedParameterError(f"Required parameter '{where}.{key}' is null or missing")
    return section[key]


def _sensor_model(section: Dict[str, Any], where: str) -> SensorModel:
    if section is None:
        raise UnpinnedParameterError(f"Required sensor block '{where}' is null or missing")
    return SensorModel(
        resolution=float(_require(section, "resolution", where)),
        bias=float(_require(section, "bias", where)),
        temp_drift_per_c=float(_require(section, "temp_drift_per_c", where)),
        noise_sigma=float(_require(section, "noise_sigma", where)),
    )


def load_config(path: Path = Path("config/assumptions.yaml")) -> Config:
    """Load assumptions and mine config, merging them into frozen Config.

    Raises UnpinnedParameterError if any required field in geometry or knothe is null.
    """
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"Config file not found: {path}")

    with open(path, "r") as f:
        assumptions = yaml.safe_load(f)

    mine_name = assumptions.get("mine")
    if not mine_name:
        raise UnpinnedParameterError("Assumption config missing 'mine' entry.")

    # Locate mine config relative to assumptions.yaml or current working directory
    mine_path = path.parent / "mines" / f"{mine_name}.yaml"
    if not mine_path.is_file():
        mine_path = Path("config/mines") / f"{mine_name}.yaml"
    if not mine_path.is_file():
        raise FileNotFoundError(f"Mine config file not found: {mine_path}")

    with open(mine_path, "r") as f:
        mine_data = yaml.safe_load(f)

    # Validate geometry parameters
    geom = mine_data.get("geometry", {})
    required_geom = ["A1_panel_width_m", "A1_panel_length_m", "A2_depth_m", "A3_seam_thickness_m"]
    for k in required_geom:
        val = geom.get(k)
        if val is None:
            raise UnpinnedParameterError(f"Required geometry parameter '{k}' is null in {mine_path}")

    # Validate knothe parameters
    knothe = mine_data.get("knothe", {})
    required_knothe = ["A4_subsidence_factor", "A5_tan_beta", "A7_time_coefficient_per_day", "A6_face_advance_m_per_day"]
    for k in required_knothe:
        val = knothe.get(k)
        if val is None:
            raise UnpinnedParameterError(f"Required knothe parameter '{k}' is null in {mine_path}")

    y_offsets, start_days = _district_layout(geom, float(geom["A1_panel_width_m"]))
    panel_geom = PanelGeometry(
        width_m=float(geom["A1_panel_width_m"]),
        length_m=float(geom["A1_panel_length_m"]),
        depth_m=float(geom["A2_depth_m"]),
        seam_thickness_m=float(geom["A3_seam_thickness_m"]),
        seam_inclination_deg=float(geom.get("seam_inclination_deg", 0.0)),
        advance_direction_deg=float(geom.get("advance_direction_deg", 0.0)),
        inflection_offset_m=float(_require(geom, "A1b_inflection_offset_m", "geometry")),
        y_offsets_m=y_offsets,
        start_day_offsets_d=start_days,
    )
    if not 0.0 <= panel_geom.inflection_offset_m < min(panel_geom.width_m, panel_geom.length_m) / 2.0:
        raise ValueError(f"geometry.A1b_inflection_offset_m must be in [0, W/2); got {panel_geom.inflection_offset_m}")

    knothe_params = KnotheParams(
        subsidence_factor=float(knothe["A4_subsidence_factor"]),
        tan_beta=float(knothe["A5_tan_beta"]),
        time_coefficient=float(knothe["A7_time_coefficient_per_day"]),
        advance_m_per_day=float(knothe["A6_face_advance_m_per_day"]),
    )

    sensing_raw = assumptions.get("sensing", {})
    sensing = SensingConfig(
        strain_rod_baseline_m=float(sensing_raw["A8_strain_rod_baseline_m"]),
        extensometer_baseline_m=float(sensing_raw["A9_extensometer_baseline_m"]),
        detection_threshold_mm=float(sensing_raw["A10_detection_threshold_mm"]),
    )

    layout_raw = assumptions.get("layout", {})
    layout_source = str(layout_raw.get("source", "v1"))
    if layout_source not in ("v1", "plan"):
        raise ValueError(f"layout.source must be v1 or plan, got {layout_source!r}")
    site = dict(mine_data.get("site") or {})
    if site.get("dem_npz"):
        dem_rel = str(site["dem_npz"])
        dem_path = path.parent.parent / dem_rel          # mine-sim root, like profiles_csv below
        site["dem_npz"] = dem_path if dem_path.is_file() else Path(dem_rel)
    layout = LayoutConfig(
        spacing_m=float(layout_raw["spacing_m"]),
        max_children_per_anchor=int(layout_raw["max_children_per_anchor"]),
        tilt_detection_snr=float(_require(layout_raw, "tilt_detection_snr", "layout")),
        source=layout_source,
        placement=assumptions.get("placement"),
        site=site,
    )

    radio_raw = assumptions.get("radio", {})
    radio = RadioConfig(
        band=str(radio_raw["A11_band"]),
        bandwidth_khz=float(radio_raw["A11_bandwidth_khz"]),
        scout_sf=int(radio_raw["A12_scout_sf"]),
        anchor_sf=int(radio_raw["A13_anchor_sf"]),
        coding_rate=str(radio_raw["A12_coding_rate"]),
        preamble_symbols=int(radio_raw["A12_preamble_symbols"]),
        explicit_header=bool(radio_raw["A12_explicit_header"]),
        crc=bool(radio_raw["A12_crc"]),
        duty_cycle_ceiling_pct=float(radio_raw["A14_duty_cycle_ceiling_pct"]),
        superframe_period_s=float(radio_raw["A16_superframe_period_s"]),
        local_channels=int(radio_raw["A17_local_channels"]),
        backbone_channels=int(radio_raw["A17_backbone_channels"]),
        antenna_height_m={k: float(v) for k, v in radio_raw["A15_antenna_height_m"].items()},
        frequency_mhz=float(_require(radio_raw, "A11_frequency_mhz", "radio")),
        tx_power_dbm=float(_require(radio_raw, "tx_power_dbm", "radio")),
        sensitivity_dbm={
            int(sf): float(_require(_require(radio_raw, "sensitivity_dbm", "radio"), sf, "radio.sensitivity_dbm"))
            for sf in _require(radio_raw, "sensitivity_dbm", "radio")
        },
        link_margin_db_min=float(_require(radio_raw, "link_margin_db_min", "radio")),
        bernoulli_loss_prob=float(_require(radio_raw, "bernoulli_loss_prob", "radio")),
    )

    power_raw = assumptions.get("power", {})
    power = PowerConfig(
        scout_battery_mah=float(power_raw["A18_scout_battery_mah"]),
        current_ma={k: float(v) for k, v in power_raw["A19_current_ma"].items()},
        target_life_days=float(power_raw["A20_target_life_days"]),
    )

    cost_raw = assumptions.get("cost", {})
    cost = CostConfig(
        unit_inr={k: int(v) for k, v in cost_raw["A21_unit_inr"].items()},
    )

    sim_raw = assumptions.get("sim", {})
    sim = SimConfig(
        timestep_s=float(sim_raw["timestep_s"]),
        duration_days=int(sim_raw["duration_days"]),
        grid_cell_m=float(sim_raw["grid_cell_m"]),
        rng_seed=int(sim_raw["rng_seed"]),
    )

    sensors_raw = _require(assumptions, "sensors", "assumptions")
    battery_raw = _require(sensors_raw, "battery", "sensors")
    sensors = SensorsConfig(
        subsidence=_sensor_model(sensors_raw.get("subsidence"), "sensors.subsidence"),
        tilt_1a=_sensor_model(_require(sensors_raw, "tier_1a", "sensors").get("tilt"), "sensors.tier_1a.tilt"),
        strain_1b=_sensor_model(_require(sensors_raw, "tier_1b", "sensors").get("strain"), "sensors.tier_1b.strain"),
        displacement_1b=_sensor_model(sensors_raw["tier_1b"].get("displacement"), "sensors.tier_1b.displacement"),
        strain_1c=_sensor_model(_require(sensors_raw, "tier_1c", "sensors").get("strain"), "sensors.tier_1c.strain"),
        battery=BatteryModel(
            full_mv=float(_require(battery_raw, "full_mv", "sensors.battery")),
            empty_mv=float(_require(battery_raw, "empty_mv", "sensors.battery")),
            noise_sigma=float(_require(battery_raw, "noise_sigma", "sensors.battery")),
        ),
        temperature_amplitude_c=float(_require(sensors_raw, "temperature_amplitude_c", "sensors")),
        temperature_period_days=float(_require(sensors_raw, "temperature_period_days", "sensors")),
        monument_position_tolerance_m=float(_require(sensors_raw, "monument_position_tolerance_m", "sensors")),
    )

    pinning = mine_data.get("pinning", {})
    prov_source = str(pinning.get("source", "unspecified"))
    # Survey CSV paths in mine files are relative to the mine-sim root (config/..)
    profiles_rel = str(_require(pinning, "profiles_csv", "pinning"))
    profiles_csv = path.parent.parent / profiles_rel
    if not profiles_csv.is_file():
        profiles_csv = Path(profiles_rel)

    cracks_raw = _require(assumptions, "cracks", "assumptions.yaml")
    cracks = CracksConfig(
        tensile_strain_threshold_ue=float(_require(cracks_raw, "tensile_strain_threshold_ue", "cracks")),
        crack_spacing_m=float(_require(cracks_raw, "crack_spacing_m", "cracks")),
        partial_closure_fraction=float(_require(cracks_raw, "partial_closure_fraction", "cracks")),
        dgms_tensile_strain_limit_ue=float(_require(cracks_raw, "dgms_tensile_strain_limit_ue", "cracks")),
        export_cell_m=float(_require(cracks_raw, "export_cell_m", "cracks")),
    )
    damage_raw = _require(assumptions, "damage", "assumptions.yaml")
    damage = DamageConfig(
        ncb_edges_mm=tuple(float(v) for v in _require(damage_raw, "ncb_edges_mm", "damage")),
        default_structure_length_m=float(_require(damage_raw, "default_structure_length_m", "damage")),
    )
    vib_raw = _require(assumptions, "vibration", "assumptions.yaml")
    vibration = VibrationConfig(
        blast_k=float(_require(vib_raw, "blast_k", "vibration")),
        blast_b=float(_require(vib_raw, "blast_b", "vibration")),
        first_fall_advance_m=float(_require(vib_raw, "first_fall_advance_m", "vibration")),
        periodic_weighting_interval_m=float(_require(vib_raw, "periodic_weighting_interval_m", "vibration")),
        caving_ppv_at_100m_mm_s=float(_require(vib_raw, "caving_ppv_at_100m_mm_s", "vibration")),
        machinery_floor_mm_s=float(_require(vib_raw, "machinery_floor_mm_s", "vibration")),
        trigger_fraction=float(_require(vib_raw, "trigger_fraction", "vibration")),
        bands_hz={k: (float(v[0]), float(v[1])) for k, v in _require(vib_raw, "bands_hz", "vibration").items()},
        dgms_limits_mm_s={k: {kk: float(vv) for kk, vv in v.items()}
                          for k, v in _require(vib_raw, "dgms_limits_mm_s", "vibration").items()},
    )

    return Config(
        panel=panel_geom,
        knothe=knothe_params,
        sensing=sensing,
        layout=layout,
        radio=radio,
        power=power,
        cost=cost,
        sim=sim,
        provenance_source=prov_source,
        sensors=sensors,
        profiles_csv=profiles_csv,
        cracks=cracks,
        damage=damage,
        vibration=vibration,
        survey_line_x_m=None if pinning.get("survey_line_x_m") is None else float(pinning["survey_line_x_m"]),
        survey_origin_offset_m=float(pinning.get("survey_origin_offset_m", 0.0)),
    )
