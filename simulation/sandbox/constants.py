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

