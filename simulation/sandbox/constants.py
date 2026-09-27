"""
Single source of truth for the Adriyala longwall subsidence parameter set.

This sandbox (`simulation_making/`) is deliberately isolated from the parent
`sih26` project. The parent tree's simulator/backend use a different, much
shallower parameter set (H=150 m, r=75 m) via `sim/`, `pinn/` and
`config/nodes.json`; this module does not feed that tree and is not fed by
it. Do not import parent-tree constants here, and do not let parent-tree
code import this module expecting the H=150 numbers — the two parameter
sets describe two different mines and must never be blended.

The parent project's own spec (`../final/00-README-index.md:210`) mandates
exactly one constants module shared by every consumer, on the grounds that
two copies of the same numbers will eventually drift and the drift will
look like an unrelated bug. That module was never created there — as a
direct result, `../sim/sensors.py:74-90` and `../config/nodes.json` now
hold three mutually inconsistent copies of what should have been one set
of numbers. This module exists so `simulation_making/` does not repeat
that mistake: every value below is declared exactly once, and every
downstream module in this sandbox imports it from here rather than
re-typing it.

Derived quantities (R_INFL, B_HORIZ, S_MAX_FULL, W_OVER_H, ...) are written
as arithmetic expressions on the primary parameters, never as hand-entered
numbers, so that changing a primary parameter automatically propagates.
"""

# ---------------------------------------------------------------------------
# Primary parameters — Adriyala Longwall Project, SCCL, Telangana.
# Provenance comments are load-bearing (they are what makes the model
# defensible) and must be preserved verbatim if these lines are ever touched.
# ---------------------------------------------------------------------------

H_DEPTH_M = 375.0        # Adriyala, high-capacity powered support deployed at 375 m
W_PANEL_M = 250.0        # two completed panels at 250 m width
L_PANEL_M = 2500.0       # 2500 m panel length
M_SEAM_M  = 3.0          # ASSUMED - not found in open literature. Flag to SCCL/CIL.
A_SUBS    = 0.75         # subsidence factor, caving; literature range 0.7-0.9
TAN_BETA  = 1.9          # 1.82 fitted at Barapukuria, same Gondwana strata
C_KNOTHE  = 0.04         # per day; matched to measured curves via SDPS
EPS_TENSILE_LIMIT  = 5.3 # mm/m, Kamptee coalfield, Central India
EPS_COMPRESS_LIMIT = 6.6 # mm/m, same
# ASSUMED building-damage style limits on the tilt an event adds to a node's ground.
TILT_WARNING_MM_M  = 3.0  # mm/m
TILT_CRITICAL_MM_M = 10.0 # mm/m

# ---------------------------------------------------------------------------
# Derived parameters — computed, never hand-typed (source plan Section 1.1:
# "Derived — do not hand-enter these"). A hand-typed literal here would
# silently stop tracking the primary parameters above.
# ---------------------------------------------------------------------------

R_INFL     = H_DEPTH_M / TAN_BETA      # radius of major influence, m
B_HORIZ    = 0.35 * R_INFL             # horizontal displacement coefficient, m
S_MAX_FULL = A_SUBS * M_SEAM_M         # full/supercritical subsidence, m
W_OVER_H   = W_PANEL_M / H_DEPTH_M     # < ~1.2 means the panel is SUBCRITICAL

# NOTE on B_HORIZ: 0.35*R_INFL here deliberately DIVERGES from the parent
# project's `../final/01-sensors-and-formulas.md:92`, which specifies
# B = 0.32*r. That is not a mistake to reconcile — the source build plan
# for this sandbox specifies 0.35, and this sandbox is isolated from the
# parent project's formula set, so 0.35 is the intended coefficient here.
# If someone later notices the mismatch against the parent doc, this is
# why: leave it as 0.35, do not "fix" it to 0.32.

# ---------------------------------------------------------------------------
# Localized event (FORGE collapse/cave-in/tilt) geometry — distinct from the
# panel-scale Knothe constants above. A collapse pit's own radius sets both
# its Gaussian footprint and its local horizontal-displacement coefficient;
# using the panel-scale B_HORIZ (69 m) on a small pit's sharp curvature
# produced strain in the hundreds of mm/m (M1, DATA-365 plan).
# ---------------------------------------------------------------------------
EVENT_SIGMA_FRAC = 0.5  # ASSUMED. Gaussian sigma = EVENT_SIGMA_FRAC * radius_m,
                         # so radius_m stays the event's visible edge (the ring
                         # drawn in the UI) rather than the Gaussian's own sigma.
B_EVENT_COEFF = 0.4     # ASSUMED. b_event = B_EVENT_COEFF * radius_m: a local
                         # pit's own horizontal-displacement coefficient.

# NOTE on subcriticality: W_OVER_H = 0.6667 (< ~1.2), so this panel is
# SUBCRITICAL and the peak subsidence produced by the convolution in
# surface.py must come out BELOW S_MAX_FULL = 2.25 m — the target is
# 1.9971 m. That reduction must emerge purely from the convolution
# geometry (panel width vs. radius of influence). If anyone ever adds a
# hand-applied "subcritical correction factor" anywhere downstream, the
# convolution itself is wrong and should be fixed instead — a manual
# factor bolted on top would be masking a bug, not modelling the mine.
# This is the condition gate T47 checks.

# ---------------------------------------------------------------------------
# Simulation window — the domain over which S(x,y,t) and its derivatives are
# evaluated, centred on the panel centre (x=0, y=0 is the panel centre; x
# and y each range from -WINDOW_SIZE_M/2 to +WINDOW_SIZE_M/2).
# ---------------------------------------------------------------------------

WINDOW_SIZE_M = 600.0    # metres, both axes

# NOTE on window size: 600 m is a hard lower bound here, not a round-number
# choice. The subsidence bowl spans W_PANEL_M + 2*R_INFL = 250 + 2*197.368
# = 644.7 m across strike, so any window narrower than ~645 m truncates the
# bowl and clips real signal at the edges. A 400x400 m window (as the
# source plan's Section 2.3 "option B" recommends) is too small to contain
# the bowl and must not be used, despite that recommendation.

GRID_N = 241              # grid points per axis -> spacing = 600/(241-1) = 2.5 m

# ---------------------------------------------------------------------------
# Travelling longwall face — the panel is mined progressively along strike (y),
# not all on day 0. The face starts one radius of influence south of the
# window's southern edge (the setup room), so that at day 0 nothing inside the
# window has been undermined, and advances north at a constant rate until it
# reaches the far end of the panel at +L_PANEL_M/2.
# ---------------------------------------------------------------------------

FACE_START_Y_M = -(WINDOW_SIZE_M / 2.0 + R_INFL)  # ~ -497 m, ASSUMED - flag to SCCL
FACE_ADVANCE_M_PER_DAY = 5.0                      # ASSUMED - flag to SCCL/CIL

# ---------------------------------------------------------------------------
# Session C & telemetry parameters
# ---------------------------------------------------------------------------

TICK_SIM_SECONDS = 60.0                 # 1 tick = 60 simulated seconds (§2.1)

# 1 real second = 10 simulated seconds. This must stay equal to the frontend's
# FIXED_SPEED_MULTIPLIER (frontend/src/interventions.ts), which is the operator-
# facing statement of the same fact. It used to default to 2000x here, so any
# window in which the session ran before the client's `set_speed` landed --
# a REST /control start, a reconnect, or simply the gap between "start" and
# "set_speed" -- streamed 200x too fast, emitting ~2570 telemetry rows per real
# second instead of ~13. The two constants disagreeing is the bug; keep them
# equal.
DEFAULT_SPEED_MULTIPLIER = 10.0         # 10x: 1 real second = 10 sim seconds
COLLAPSE_SNAP_SPEED_MULTIPLIER = 10.0   # 10x snap during collapse events

# Frozen sensor noise budget (combined in quadrature)
SIGMA_STRAIN_UE = 1.332                 # microstrain (µε)
SIGMA_EXT_10UM = 1.0                    # 10 µm units
SIGMA_TEMP_DC = 2.0                     # 0.1 °C units
SIGMA_VBAT_MV = 5.0                     # mV

# ---------------------------------------------------------------------------
# Sensor honesty (M2, DATA-365 plan) — physically sourced sensor-model
# parameters, replacing invented linear-in-S formulas and an unbudgeted
# noise-wander magnitude in sandbox/sensors.py.
# ---------------------------------------------------------------------------
# Ground cracking: reused verbatim from the finale's own crack model
# (sih-26-finale/mine-sim/config/assumptions.yaml `cracks:` block), which
# replaced this sandbox's own undocumented `* 1000.0 * 2.0` (a bare 2 m
# spacing, no threshold at all).
CRACK_TENSILE_THRESHOLD_UE = 3000.0     # OPEN — VERIFY (finale assumptions.yaml)
CRACK_SPACING_M = 8.0                   # OPEN — VERIFY (finale assumptions.yaml)
CRACK_PARTIAL_CLOSURE_FRACTION = 0.35   # OPEN — VERIFY (finale assumptions.yaml)

THERMAL_TILT_DRIFT_URAD_PER_C = 5.0     # VERIFY, per DATA-365 plan M2 spec
TILT_DRIFT_REFERENCE_C = 25.0           # ASSUMED: typical MEMS calibration temperature

# `Session.apply_vibration(magnitude_ppv=...)` is calibrated as the PPV at
# this reference distance from the (optional) source location; every node's
# own PPV then attenuates from it via the USBM exponent (BLAST_USBM_BETA,
# sandbox/environment.py), instead of the same value being added to every
# node regardless of distance.
VIBRATION_REFERENCE_DISTANCE_M = 100.0  # ASSUMED

# OU wander (sandbox/sensors.py) historically decayed at a fixed phi=0.88
# per call, silently assuming every call is TICK_SIM_SECONDS (60 s) apart —
# wrong for the 3600 s/tick scripted runs. WANDER_PHI_PER_TICK anchors the
# same phi at that same 60 s reference; sensors.py derives a continuous-time
# correlation constant from it and re-discretizes for the tick's own
# dt_seconds, so the stationary std stops depending on tick length.
WANDER_PHI_PER_TICK = 0.88

# ---------------------------------------------------------------------------
# ADRIYALA_FIT — the team's own fit to 283 digitised Adriyala LW1 survey
# points (Ramalingeswarudu et al. 2022, DOI 10.18311/jmmf/2022/32099; RMS
# 52.1 mm, R^2 0.985, peak 1201.7 mm vs measured 1267 mm --
# sih-26-finale/mine-sim/data/fitted/adriyala_lw1_params.json), consumed by
# sandbox/district.py (plan step G1, docs/plans/2026-09-27-data-365.md).
# Geometry (depth/width/length) is shared with the primary block above --
# H_DEPTH_M, W_PANEL_M, L_PANEL_M already equal the paper's 375 m / 250 m /
# 2500 m -- only the Knothe/seam numbers below are refit; the primary block
# and surface.py stay exactly as they were (additions only).
# ---------------------------------------------------------------------------

FIT_A_SUBS = 0.45                      # fitted subsidence factor (smallest a within 5% of best RMS)
FIT_TAN_BETA = 2.5676                   # fitted (r = 375 / 2.5676 = 146.05 m)
FIT_C_KNOTHE = 0.02358                  # per day, fitted jointly with survey_line_x_m
FIT_M_SEAM_M = 3.6                      # extraction height, JMMF Table 1
FIT_INFLECTION_OFFSET_M = 58.96         # fitted trough-edge inset (Knothe d)
FIT_FACE_ADVANCE_M_PER_DAY = 4.0        # mine config A6_face_advance_m_per_day
FIT_SOURCE_DOI = "10.18311/jmmf/2022/32099"  # Ramalingeswarudu et al. (2022), JMMF

# Derived, never hand-typed (same rule as R_INFL/B_HORIZ above).
FIT_R_INFL = H_DEPTH_M / FIT_TAN_BETA               # ~146.05 m, radius of influence for the fit
FIT_FACE_START_Y_M = -(WINDOW_SIZE_M / 2.0 + FIT_R_INFL)  # ~ -446.05 m, same convention as FACE_START_Y_M

# A 3-panel district on the fitted LW1 geometry: LW1 itself (the centre
# panel, provenance "pinned") plus two neighbours repeating its geometry
# (provenance "SYNTHETIC" -- not from the paper). One real panel alone
# leaves half the 31-node layout quiet (docs/plans/2026-09-27-data-365.md
# Context §3); three panels put every sensing node at >= 50 mm and
# >= 3 mm/m of tilt across the year.
DISTRICT_PANEL_X_M = (-290.0, 0.0, 290.0)    # 250 m panel + 40 m chain pillar (OPEN -- guess; the
                                              # finale's own adriyala_lw1.yaml district block flags
                                              # chain_pillar_width_m 40.0 the same way)
DISTRICT_START_DAY = (-120.0, 0.0, 120.0)    # ASSUMED stagger, so all three panel ages appear in one year
DISTRICT_PROVENANCE = ("synthetic", "pinned", "synthetic")  # same order as DISTRICT_PANEL_X_M

