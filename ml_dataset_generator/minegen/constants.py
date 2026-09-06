"""
Single source of truth for every generator parameter range.

Nothing about how a mine is generated may be implicit (spec 7.2). Every value a
mine draws comes from a range defined in this file, and every drawn value is
written back into that mine's metadata.json.

Sources, in the authority order fixed for this project:
  1. WhatsApp sensor image  -> which sensors exist on which tier
  2. mesh-communication-mechanics.md -> tiers, roles, spacing, 60 s cadence
  3. mine_collapse_data_spec.md -> objective, labels, output structure

UNITS (fixed across the whole dataset)
  distance          metres (m)
  subsidence        metres, down-positive
  tilt              microradians (urad)
  acceleration      g (1 g = 9.80665 m/s^2)
  angular rate      degrees/second (deg/s)
  strain            microstrain (ue)
  fissure opening   millimetres (mm)
  extensometer      millimetres (mm)
  pore pressure     kilopascals (kPa)
  soil moisture     percent volumetric water content (%)
  temperature       degrees Celsius (degC)
  vibration rms/pk  millimetres/second (mm/s)
  dominant freq     hertz (Hz)
  time              seconds since mine t0; horizon expressed in days
"""

from __future__ import annotations

# ---------------------------------------------------------------- cadence ---
# mesh-communication-mechanics.md 5: the 60 s TDMA superframe. Every tier
# reports once per superframe, so the mine has one synchronised timestep grid.
DT_SECONDS = 60.0

# Horizon locked at 2-14 days (user decision, supersedes any earlier figure).
HORIZON_DAYS_RANGE = (2.0, 14.0)

# ---------------------------------------------------------------- geometry ---
# Mine extent locked at 400x200 m -> 1200x1000 m (user decision).
MINE_WIDTH_RANGE = (400.0, 1200.0)   # x extent, m
MINE_HEIGHT_RANGE = (200.0, 1000.0)  # y extent, m

# The extracted panel sits inside the mine extent. Fractions of the extent.
PANEL_WIDTH_FRAC_RANGE = (0.45, 0.75)
PANEL_HEIGHT_FRAC_RANGE = (0.35, 0.65)

DEPTH_H_RANGE = (60.0, 300.0)        # depth of workings, m
SEAM_THICKNESS_RANGE = (1.5, 6.0)    # m
TAN_BETA_RANGE = (1.6, 2.6)          # angle of draw; r = H / tan_beta
SUBSIDENCE_FACTOR_RANGE = (0.45, 0.85)  # a; S_max = a * seam thickness
# Horizontal-displacement coefficient B = B_FRAC * r, used for strain and for
# the horizontal component of peg/wire displacement.
B_FRAC_RANGE = (0.28, 0.38)

# ------------------------------------------------------------ time evolution ---
# Knothe time function g(t) = 1 - exp(-c t), t in days. c drawn so that a mine
# reaches a plausible fraction of final settlement within its own horizon.
KNOTHE_C_RANGE = (0.05, 0.60)        # per day

# ------------------------------------------------------------------ collapse ---
# Collapse propensity is NOT one fixed coin across the dataset. Each mine draws
# its own probability from Beta(3, 2), then flips that. Real sites differ in how
# prone they are to failure -- a fixed global rate would bake one base rate into
# the data and teach the model a prior it should not hold.
#
# Beta(3, 2): mean 0.60, 10th-90th percentile 0.32-0.86. Over a 100-mine batch
# the realised collapse share lands in roughly 43-73%, so the model always sees
# a healthy supply of both collapsing and stable ground (spec 5.2).
#
# The drawn probability is recorded per mine in metadata.json, so the base rate
# of any subset is recoverable after the fact.
COLLAPSE_PROB_BETA = (3.0, 2.0)
COLLAPSE_EVENTS_RANGE = (1, 3)       # inclusive, for a collapsing mine

# Precursor window: time between instability starting to build and the collapse.
# Spec 4.1 requires this to vary per event, drawn from a distribution.
# Clipped at runtime so it always fits inside that mine's horizon.
PRECURSOR_DAYS_RANGE = (0.3, 5.0)

# Severity is a unitless 0-1 score (spec 5.4 lets us define the scale).
SEVERITY_RANGE = (0.15, 1.0)

# Failure threshold: fraction of that mine's own peak curvature at which the
# ground is declared to have failed. Drawn per mine, recorded in metadata.
FAILURE_THRESHOLD_FRAC_RANGE = (0.55, 0.90)

# ------------------------------------------------------------- node placement ---
# mesh-communication-mechanics.md 2: geotechnical spacing, not radio spacing.
SCOUT_SPACING_RANGE = (15.0, 25.0)    # Tier 1A/1B/1C, m apart
ANCHOR_SPACING_RANGE = (100.0, 150.0) # Tier 2A/2B, m apart
GATEWAY_STANDOFF_RANGE = (500.0, 1000.0)  # Tier 3, m outside the angle of draw

# Placement jitter as a fraction of nominal spacing, so no mine is ever a grid
# (spec 3.3: node positions must NOT be on a regular grid).
PLACEMENT_JITTER_FRAC = 0.45

# Node counts per mine. Scouts dominate; anchors are sparse routers.
SCOUT_COUNT_RANGE = (18, 70)

# ---- cluster fan-out: how many Scouts one Anchor may parent ----------------
# mesh-communication-mechanics.md 3: an Anchor "listens to its 5 or 6 Scout
# children, bundles their packets into a single 138-byte payload".
#
# That 138 is not a soft target -- it is exactly 6 * 23 bytes, and 23 bytes is
# the hard postcard size from mesh doc 4. So SIX is the physical ceiling: a
# 7th child would need 161 bytes, overflowing the bundle the Anchor is
# specified to send. The TDMA window is NOT the binding constraint (t=2.0-11.5s
# at 250 ms slots offers 38 slots, and one scout needs 90.4 ms TX + 20 ms ACK
# = 110.4 ms, so timing alone would allow far more). The payload is what caps it.
#
# User decision (2026-09-05): settle on 5 children per Anchor as the nominal
# design point -- the lower of the doc's "5 or 6", leaving one slot of bundle
# headroom so an orphan failing over from a dead neighbour still fits.
CLUSTER_FANOUT_NOMINAL = 5   # scouts per anchor, design point
CLUSTER_FANOUT_MAX = 6       # hard ceiling: 6 * 23 B = the 138 B bundle

# Anchor counts are DERIVED from the scout count, not drawn independently.
# Drawing them independently is what produced the old 1.9-13.8 scouts/anchor
# spread, which silently violated the 6-child bundle limit in most mines.
#   n_anchors_needed = ceil(n_scouts / CLUSTER_FANOUT_NOMINAL)
# 2B (geotech borehole) count stays a small independent draw because those are
# sited for geology -- deep holes over the panel -- not for radio fan-out; 2A
# then makes up the remainder so total anchor capacity covers every scout.
ANCHOR_2B_COUNT_RANGE = (1, 3)
ANCHOR_2A_COUNT_MIN = 3      # floor: a mine always has a few plain routers
N_GATEWAYS = 1

# Share of scouts by tier. 1B sits on shear edges, 1C on fault/water zones,
# 1A maps the flat interior. Renormalised per mine after a Dirichlet draw.
SCOUT_TIER_MIX = {"1A": 0.45, "1B": 0.35, "1C": 0.20}
SCOUT_TIER_MIX_CONCENTRATION = 18.0   # Dirichlet concentration; higher = tighter

# 2B borehole inclinometer string: tilt is read at these depths below collar.
BOREHOLE_DEPTHS_M = (5.0, 15.0, 30.0, 50.0)

# ------------------------------------------------------------------ sensors ---
# Vibration: MPU-6050 sampled as a short high-rate burst once per superframe,
# reduced on-node to three numbers. Replaces the geophone, which does not exist
# in the final hardware (WhatsApp image).
VIB_BURST_RATE_HZ = 400.0
VIB_BURST_SAMPLES = 256

# Dominant-frequency neighbourhoods, Hz. Microseismic is the band that matters:
# it is rock actually cracking. The others are machinery to be discriminated out.
VIB_BANDS = {
    "truck": (8.0, 20.0),
    "conveyor": (49.5, 50.5),
    "blast": (40.0, 80.0),
    "microseismic": (100.0, 250.0),
}
# Poisson rate of microseismic events per hour at baseline; scales with local
# strain as the ground approaches failure.
MICROSEISMIC_BASE_RATE_PER_HOUR = 0.4
MICROSEISMIC_STRESS_GAIN = 25.0

# Soil moisture (Tier 1C capacitive sensor).
# Baseline + rain events + a rise near fault/water zones as failure approaches:
# water ingress is a genuine collapse precursor, so the sensor earns its place.
MOISTURE_BASE_RANGE = (18.0, 38.0)    # % VWC
MOISTURE_RAIN_RATE_PER_DAY = 0.55     # Poisson rate of rain events
MOISTURE_RAIN_JUMP_RANGE = (3.0, 14.0)  # % VWC added by one rain event
MOISTURE_DRY_TAU_DAYS = 1.6           # exponential drying time constant
MOISTURE_PRECURSOR_GAIN = 9.0         # % VWC rise at a collapse site at failure

# Pore pressure (Tier 2B piezometer). Rises as the failure zone loads up.
PORE_PRESSURE_BASE_RANGE = (80.0, 420.0)   # kPa
PORE_PRESSURE_PRECURSOR_GAIN = 120.0       # kPa rise at failure
PORE_PRESSURE_RAIN_COUPLING = 2.2          # kPa per % VWC of rain response

# --------------------------------------------------------------- weather ---
AIR_TEMP_MEAN_RANGE = (14.0, 32.0)    # degC
AIR_TEMP_DIURNAL_RANGE = (4.0, 12.0)  # degC amplitude
# Die temperature sits above air temperature by a per-node self-heating offset.
DIE_TEMP_SELF_HEAT_RANGE = (1.0, 4.5) # degC

# ------------------------------------------------------------------- noise ---
# Spec 4.5: no clean signals, ever. White noise + slow bias drift +
# temperature-dependent bias shift, applied in a fixed order (see noise.py).
#
# MPU-6050 is a low-cost consumer MEMS part. ADXL355 is a precision part and is
# the entire reason Tier 2A anchors exist -- roughly 40x quieter in tilt.
NOISE = {
    # channel: (white sigma, bias random-walk sigma per sqrt(day), temp coeff per degC)
    "mpu_tilt_urad":      (120.0,  90.0,   14.0),
    "adxl_tilt_urad":     (3.0,    2.2,    0.35),
    "accel_g":            (4.0e-3, 1.2e-3, 1.5e-4),
    "gyro_dps":           (0.06,   0.02,   0.004),
    "strain_ue":          (12.0,   9.0,    1.6),
    "fissure_mm":         (0.05,   0.035,  0.006),
    "ext_mm":             (0.08,   0.05,   0.009),
    "moisture_pct":       (0.45,   0.25,   0.02),
    "pore_kpa":           (1.2,    0.8,    0.05),
    "borehole_tilt_urad": (25.0,   18.0,   2.0),
    "vib_mm_s":           (0.02,   0.008,  0.0015),
    "die_temp_c":         (0.15,   0.05,   0.0),
    "gps_mm":             (2.5,    1.5,    0.08),
}

# Reference temperature at which temperature-dependent bias is defined as zero.
TEMP_REF_C = 25.0

# Quantisation step per channel, mimicking the wire format the node packs into.
QUANT = {
    "tilt_urad": 2.0,
    "accel_g": 1.0 / 16384.0,
    "gyro_dps": 1.0 / 131.0,
    "strain_ue": 1.0,
    "fissure_mm": 0.01,
    "ext_mm": 0.01,
    "moisture_pct": 0.1,
    "pore_kpa": 0.1,
    "vib_mm_s": 0.01,
    "vib_fdom_hz": 1.0,
    "die_temp_c": 0.1,
    "gps_mm": 0.1,
}

# ------------------------------------------------------------------ labels ---
# Spec 5.3: distance-based weighting, decay function is our choice but must be
# documented. Gaussian falloff, length scale proportional to the mine's r.
SPATIAL_WEIGHT_SIGMA_FRAC_OF_R = 1.25
SPATIAL_WEIGHT_FLOOR = 1.0e-4

# Time-to-collapse is reported in seconds. Censored rows carry NaN, never a
# sentinel that could be mistaken for a real duration.
GRAVITY_G = 9.80665

SCHEMA_VERSION = "2.0.0"
