"""Bridge to the simulator's crack and damage model (P1, 17 Sep 2026). NOT a second model.

Decision D-S1, Adarsh session 26: "the maths and simulation, it's on you". The answer is one model,
and it is the one in `minesim.cracks`, because that is the one with the cross-derivative behind it
(physics.principal_strain), a sourced crack spacing, and partial closure.

WP9 section 6 had specified a separate lab-side crack model - axis-aligned strain, a 3.0 mm/m
threshold, width over one grid cell, and the Chinese I-IV damage table. Built as written it would
have disagreed with the simulator on the same ground: a different width by a factor of 8/5, a
different damage scale, and - because it used axis-aligned rather than principal strain - a different
answer at the panel corners, which is exactly where field crews record the worst cracking. WP9 is
amended; this file is what replaces it.

So every crack number in the lab comes from minesim.cracks, and every vibration limit from
minesim.vibration. This module adds exactly one thing of its own: the unit conversion.

UNITS - the one real hazard at this boundary
--------------------------------------------
minesim speaks MICROSTRAIN (ue). The lab and WP9 speak mm/m. 1 mm/m = 1000 ue.

A missing factor of 1000 here would not crash and would not look absurd: it would put every crack
either 1000x too wide or silently below threshold, i.e. "no cracks anywhere", which reads as good
news. So the conversion lives in exactly one pair of functions, and gate L8-2 round-trips it.

Gate L8-3 additionally asserts that the thresholds quoted here are the SAME OBJECT as the ones in
mine-sim/config/assumptions.yaml, so editing one config cannot leave the other stale.
"""

from __future__ import annotations

import numpy as np

from minesim.cracks import (           # noqa: F401  (re-exported on purpose - see the module docstring)
    NCB_EDGES_MM,
    NCB_GRADES,
    change_of_length_mm,
    damage_grade,
    damage_grade_field,
    exceeds_dgms_tensile_limit,
    opening_mm,
    width_sensitivity,
)

# 1 mm/m = 1000 microstrain. `1000` is on gate L4's allow-list as the metre<->millimetre conversion,
# which is the same factor for the same reason: strain is a length over a length.
MICROSTRAIN_PER_MM_PER_M = 1000


def to_microstrain(strain_mm_per_m):
    """mm/m -> microstrain, for handing a lab-derived strain field to minesim.cracks."""
    return np.asarray(strain_mm_per_m, dtype=np.float64) * MICROSTRAIN_PER_MM_PER_M


def to_mm_per_m(strain_ue):
    """microstrain -> mm/m, for reporting a minesim number in the lab's units."""
    return np.asarray(strain_ue, dtype=np.float64) / MICROSTRAIN_PER_MM_PER_M


def crack_threshold_ue(cfg) -> float:
    """The ground's cracking threshold, straight from the mine config. Never restated here."""
    return cfg.cracks.tensile_strain_threshold_ue


def crack_spacing_m(cfg) -> float:
    """Gauge length whose extension localises into one fissure, straight from the mine config."""
    return cfg.cracks.crack_spacing_m


def crack_width_mm(e1_mm_per_m, cfg):
    """Crack opening in mm from MAJOR PRINCIPAL tensile strain given in mm/m.

    Thin wrapper over minesim.cracks.opening_mm: it converts units and reads both constants from the
    mine config, so the lab cannot drift from the simulator by editing a number here.
    """
    return opening_mm(to_microstrain(e1_mm_per_m), crack_threshold_ue(cfg), crack_spacing_m(cfg))


def cracked_mask(e1_mm_per_m, cfg) -> np.ndarray:
    """Where the ground is over its cracking threshold, from principal tensile strain in mm/m.

    This is an instantaneous test. Cracks LATCH - once open they stay, narrowing by
    cracks.partial_closure_fraction rather than healing - so "cracks that are open at day T" is a
    different and larger set, and it comes from the run's exported baseline
    (out/cracks/crack_field_day*.npz), not from here. Comparing this mask before and after a scenario
    is what gives "new cracks"; it is not the whole crack state. P2 wires the baseline in.
    """
    return to_microstrain(e1_mm_per_m) > crack_threshold_ue(cfg)


def damage_grades(e1_mm_per_m, cfg) -> np.ndarray:
    """NCB damage grade index per cell, from principal strain in mm/m over the default frontage.

    Classified on CHANGE OF LENGTH (strain x frontage), not raw strain, because that is the NCB
    scale - a 10 m house and a 30 m shed in identical ground are not equally damaged.
    """
    return damage_grade_field(to_microstrain(e1_mm_per_m), cfg.damage.default_structure_length_m)
