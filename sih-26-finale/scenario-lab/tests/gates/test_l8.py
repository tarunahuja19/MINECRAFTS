"""Gate L8 — the Scenario Lab and the simulator give the same answer about the same ground.

WHY THIS GATE EXISTS
--------------------
The lab and the simulator each know how to turn ground movement into cracks and damage. For a while
they knew it DIFFERENTLY: WP9 section 6 specified an axis-aligned strain model with a 3.0 mm/m
threshold, a one-cell crack width and the Chinese I-IV damage table, while F10 built a principal-
strain model with an 8 m crack spacing, NCB grades and partial closure. Both were tested. Both
passed. Neither test noticed the other existed, because nothing joined the two halves.

Decision D-S1 (Adarsh, session 26) settled it: one model, the simulator's. This gate is what keeps
it settled. It is cheap, it runs in seconds, and it fails the moment somebody edits one side only.

L8-1  the gridded principal strain matches the analytic one
L8-2  the microstrain <-> mm/m round-trip is exact
L8-3  the lab's thresholds ARE the simulator's, asserted by identity and not by a copied number
L8-4  a hard zone mask fakes a crack; the tapered zone weight does not
L8-5  zones tile the panel and 'full' covers the grid

L8's remaining assertion - a cell-for-cell comparison of a null scenario against the run's exported
out/cracks/ baseline - needs lab/consequence.py and the exported baseline, and lands in P2.
"""

import numpy as np
import pytest

from minesim import cracks as sim_cracks
from minesim import physics

from lab import cracks as lab_cracks
from lab.fields import derive_fields, principal_from_fields
from lab.zones import (
    boundary_fade_m,
    hard_zone_mask,
    load_zone_config,
    zone_by_id,
    zone_weight,
    zones_for,
)


# ---------------------------------------------------------------------------------------------
# L8-1 — one strain tensor, reached two ways
# ---------------------------------------------------------------------------------------------

def test_l8_1_gridded_principal_strain_matches_the_analytic_one(snap):
    """derive_fields + principal_from_fields on a sampled surface == physics.principal_strain.

    This is the assertion that stops the two crack models re-appearing. If someone changes how the
    lab differentiates a surface, or drops the cross-derivative again, the angles diverge here first.
    """
    X, Y = snap.grid.centres()
    s = np.asarray(physics.subsidence(X, Y, snap.day, snap.cfg.panel, snap.cfg.knothe), dtype=np.float64)

    f = derive_fields(s, snap.grid.cell_m, snap.cfg)
    e1_grid, e2_grid, theta_grid = principal_from_fields(f)
    e1_an, e2_an, theta_an = physics.principal_strain(X, Y, snap.day, snap.cfg.panel, snap.cfg.knothe)

    # Compare in the same units: the analytic route returns microstrain, the gridded one mm/m.
    e1_grid_ue = lab_cracks.to_microstrain(e1_grid)
    e2_grid_ue = lab_cracks.to_microstrain(e2_grid)

    # Where the signal is worth comparing at all. Finite differences on a 5 m grid cannot be held to
    # a tight tolerance where the strain is near zero, and near-zero strain cracks nothing.
    thr = sim_cracks_threshold(snap.cfg)
    strong = np.abs(e1_an) > 0.5 * thr
    assert strong.sum() > 0, "no cell has enough strain to compare - pick a day with a live trough"

    rel = np.abs(e1_grid_ue[strong] - e1_an[strong]) / np.abs(e1_an[strong])
    assert np.median(rel) < 0.05, f"major principal strain disagrees, median {np.median(rel):.3f}"
    assert np.percentile(rel, 95) < 0.15

    rel2 = np.abs(e2_grid_ue[strong] - e2_an[strong]) / np.maximum(np.abs(e2_an[strong]), thr)
    assert np.median(rel2) < 0.05

    # The angle is the whole reason the cross-derivative was added, so it is checked on its own.
    # Principal axes are defined modulo 180 degrees, so compare the doubled angle.
    d2 = np.angle(np.exp(2j * np.radians(theta_grid[strong] - theta_an[strong])))
    assert np.median(np.abs(np.degrees(d2))) < 5.0, "crack bearing disagrees between the two routes"


def sim_cracks_threshold(cfg) -> float:
    return cfg.cracks.tensile_strain_threshold_ue


def test_l8_1b_the_cross_derivative_is_not_zero_at_the_panel_corners(snap):
    """If strain_xy were dropped again, L8-1 could still pass on the centre-line. This is where it
    would not: at a panel corner the trough is doubly curved and the principal axes rotate."""
    cfg = snap.cfg
    corner_x = cfg.panel.length_m / 2
    corner_y = cfg.panel.width_m / 2
    _e1, _e2, theta = physics.principal_strain(
        np.array([corner_x]), np.array([corner_y]), snap.day, cfg.panel, cfg.knothe)
    _e1c, _e2c, theta_centre = physics.principal_strain(
        np.array([corner_x]), np.array([0.0]), snap.day, cfg.panel, cfg.knothe)
    rotation = abs(float(theta[0]) - float(theta_centre[0]))
    assert rotation > 1.0, "the principal axes should rotate away from the centre-line"


# ---------------------------------------------------------------------------------------------
# L8-1c — the same comparison, against what the simulator actually wrote to disk
# ---------------------------------------------------------------------------------------------

def _bilinear(values, xs, ys, X, Y):
    """Bilinear sample of `values` on the regular grid (xs, ys) at points (X, Y); NaN outside.

    Written out rather than pulled from scipy so the resampling method is stated in the open: the
    lab grid is 5 m and the exported crack field is 10 m on its own axes (hazard H6), and a
    nearest-cell lookup between them would move a crack edge by up to half a cell.
    """
    dx, dy = xs[1] - xs[0], ys[1] - ys[0]
    fx = (X - xs[0]) / dx
    fy = (Y - ys[0]) / dy
    i0 = np.floor(fx).astype(int)
    j0 = np.floor(fy).astype(int)
    good = (i0 >= 0) & (i0 < len(xs) - 1) & (j0 >= 0) & (j0 < len(ys) - 1)
    i0c, j0c = np.clip(i0, 0, len(xs) - 2), np.clip(j0, 0, len(ys) - 2)
    wx, wy = fx - i0c, fy - j0c
    out = ((1 - wx) * (1 - wy) * values[i0c, j0c]
           + wx * (1 - wy) * values[i0c + 1, j0c]
           + (1 - wx) * wy * values[i0c, j0c + 1]
           + wx * wy * values[i0c + 1, j0c + 1])
    return np.where(good, out, np.nan)


def test_l8_1c_lab_strain_matches_the_exported_crack_field(run_dir, snap_at_end):
    """The lab's strain, derived from a SURFACE on a 5 m grid, matches what scripts/export_cracks.py
    wrote from the ANALYTIC model on a 10 m grid. Two models, two grids, one answer.

    This is the assertion that would have caught the whole H1..H8 family at once, and it is the one
    that keeps catching it. Measured 17 Sep at day 690: median relative difference 0.58 %, p95 1.7 %,
    and the cracked/not-cracked call differs on 3 cells in 25,564 - all of them sitting on the
    threshold, where a 0.5 % difference is enough to flip the comparison.

    Skipped when out/cracks/ is absent, which it is after any full rebuild until S7 wires
    export_cracks.py in as step 9. That skip is a known gap, not an accepted one.
    """
    export = run_dir.parent / "cracks" / f"crack_field_day{int(snap_at_end.day):04d}.npz"
    if not export.is_file():
        pytest.skip(f"{export} not exported - run scripts/export_cracks.py (see step S7)")

    z = np.load(export)
    xs, ys, e1_exp = z["x_m"], z["y_m"], z["e1_ue"]

    g = snap_at_end.grid
    f = derive_fields(snap_at_end.s_model_mm, g.cell_m, snap_at_end.cfg)
    e1_lab_ue = lab_cracks.to_microstrain(principal_from_fields(f)[0])
    lx = g.origin_x_m + (np.arange(g.shape[0]) + 0.5) * g.cell_m
    ly = g.origin_y_m + (np.arange(g.shape[1]) + 0.5) * g.cell_m

    EX, EY = np.meshgrid(xs, ys, indexing="ij")
    e1_here = _bilinear(e1_lab_ue, lx, ly, EX, EY)

    thr = snap_at_end.cfg.cracks.tensile_strain_threshold_ue
    overlap = np.isfinite(e1_here)
    strong = overlap & (np.abs(e1_exp) > 0.5 * thr)
    assert strong.sum() > 0

    rel = np.abs(e1_here[strong] - e1_exp[strong]) / np.abs(e1_exp[strong])
    assert np.median(rel) < 0.02, f"median relative difference {np.median(rel):.4f}"
    assert np.percentile(rel, 95) < 0.05

    # The call that actually matters downstream: does this cell crack or not?
    disagree = (e1_exp[overlap] > thr) != (e1_here[overlap] > thr)
    assert np.mean(disagree) < 0.01, (
        f"{disagree.sum()} of {overlap.sum()} cells disagree on whether the ground has cracked")


# ---------------------------------------------------------------------------------------------
# L8-2 — units
# ---------------------------------------------------------------------------------------------

def test_l8_2_microstrain_round_trip_is_exact():
    """1 mm/m = 1000 ue. A dropped factor of 1000 reads as 'no cracks anywhere', which looks like
    good news rather than like a bug, so it gets its own assertion."""
    values = np.array([0.0, 1.0, 3.0, -2.5, 4.1])
    assert np.array_equal(lab_cracks.to_mm_per_m(lab_cracks.to_microstrain(values)), values)
    assert lab_cracks.to_microstrain(1.0) == pytest.approx(1000.0)
    assert lab_cracks.MICROSTRAIN_PER_MM_PER_M == 1000


def test_l8_2b_the_threshold_in_the_labs_units_is_the_expected_scale(snap):
    """3000 ue is 3.0 mm/m. Stated once, here, so a unit slip cannot hide behind a plausible number."""
    thr_mm_per_m = lab_cracks.to_mm_per_m(lab_cracks.crack_threshold_ue(snap.cfg))
    assert 1.0 < float(thr_mm_per_m) < 10.0, (
        f"crack threshold reads as {thr_mm_per_m} mm/m, which is not a credible cracking strain - "
        "suspect a units error rather than a config change")


# ---------------------------------------------------------------------------------------------
# L8-3 — one source per number
# ---------------------------------------------------------------------------------------------

def test_l8_3_lab_thresholds_are_the_simulators_by_identity(snap):
    """Asserted against the config object, never against a number copied into this file. Copying the
    value here would make the test pass while the two configs drifted - which is the failure mode."""
    cfg = snap.cfg
    assert lab_cracks.crack_threshold_ue(cfg) is cfg.cracks.tensile_strain_threshold_ue
    assert lab_cracks.crack_spacing_m(cfg) is cfg.cracks.crack_spacing_m


def test_l8_3b_the_lab_re_exports_the_simulators_functions_not_copies():
    """lab.cracks must be a bridge. If someone writes a second implementation behind these names,
    the identity check fails and they have to justify it."""
    for name in ("opening_mm", "damage_grade", "damage_grade_field", "change_of_length_mm"):
        assert getattr(lab_cracks, name) is getattr(sim_cracks, name), \
            f"lab.cracks.{name} is not minesim.cracks.{name} - D-S1 says there is one model"
    assert lab_cracks.NCB_GRADES is sim_cracks.NCB_GRADES
    assert lab_cracks.NCB_EDGES_MM is sim_cracks.NCB_EDGES_MM


def test_l8_3c_crack_width_goes_through_the_simulators_formula(snap):
    """The lab's convenience wrapper must give exactly what minesim gives for the same strain."""
    cfg = snap.cfg
    e1_mm_per_m = np.array([0.0, 2.0, 3.5, 6.0])
    direct = sim_cracks.opening_mm(e1_mm_per_m * 1000, cfg.cracks.tensile_strain_threshold_ue,
                                   cfg.cracks.crack_spacing_m)
    assert np.allclose(lab_cracks.crack_width_mm(e1_mm_per_m, cfg), direct)


# ---------------------------------------------------------------------------------------------
# L8-4 — the zone boundary must not invent a crack
# ---------------------------------------------------------------------------------------------

def test_l8_4_hard_zone_mask_would_fake_a_crack(snap):
    """A boolean zone mask draws a crack around the outline of whichever zone was picked.

    Evidence for the claim in lab/zones.py's docstring, and the reason a zone is a weight. The same
    extra subsidence is confined twice - once with a step, once with the raised cosine - and the
    strain each produces just outside the zone is compared against the ground's cracking threshold.
    """
    cfg, grid = snap.cfg, snap.grid
    zcfg = load_zone_config()
    zone = zone_by_id("5", cfg, grid, zcfg)
    fade = boundary_fade_m(cfg, zcfg)

    # A smooth, flat-topped blob of extra sinking, big enough to matter and with no structure of its
    # own near the zone edge - so anything that appears there comes from the confinement, not the ds.
    ds = np.full(grid.shape, 100.0)

    thr_mm_per_m = float(lab_cracks.to_mm_per_m(lab_cracks.crack_threshold_ue(cfg)))
    X, Y = grid.centres()
    from lab.zones import distance_to_zone_m
    d = distance_to_zone_m(zone, X, Y)
    rim = (d > 0) & (d < fade)
    assert rim.sum() > 0

    def peak_tensile_strain_on_the_rim(weighted):
        f = derive_fields(snap.s_model_mm + weighted, grid.cell_m, cfg)
        e1, _e2, _th = principal_from_fields(f)
        return float(np.max(e1[rim]))

    hard = peak_tensile_strain_on_the_rim(ds * hard_zone_mask(zone, grid))
    soft = peak_tensile_strain_on_the_rim(ds * zone_weight(zone, grid, fade))
    baseline = peak_tensile_strain_on_the_rim(np.zeros(grid.shape))

    # Measured 17 Sep on the 690-day run at day 300, zone 5: baseline 5.28, tapered 5.28,
    # boolean 95.95 mm/m - 18x the true value and 32x the 3.0 mm/m cracking threshold.
    #
    # Compared against the BASELINE, not against the threshold. The panel edges are genuinely over
    # the cracking threshold before any scenario (WP9 section 6 says to expect that, and the rim
    # baseline here is 5.28 mm/m against a 3.0 threshold), so "hard > threshold" would pass even if
    # the mask did nothing at all. The claim being tested is that the mask INVENTS strain.
    assert hard > 5 * baseline, (
        f"the boolean mask was expected to invent strain at the zone rim: it gave {hard:.2f} mm/m "
        f"against a true rim value of {baseline:.2f}. If this now passes, re-derive the claim in "
        "lab/zones.py before relaxing the zone weight.")
    assert hard > thr_mm_per_m
    assert soft < hard, "the tapered zone weight must produce less rim strain than the step"
    assert soft == pytest.approx(baseline, abs=0.5 * thr_mm_per_m), (
        f"the tapered zone weight itself moved rim strain from {baseline:.2f} to {soft:.2f} mm/m - "
        "the confinement is supposed to be invisible to the ground, not a second event")


# ---------------------------------------------------------------------------------------------
# L8-5 — zones lose no ground
# ---------------------------------------------------------------------------------------------

def test_l8_5_zones_tile_the_panel_and_full_covers_the_grid(snap):
    cfg, grid = snap.cfg, snap.grid
    zcfg = load_zone_config()
    zones = zones_for(cfg, grid, zcfg)
    numbered = [z for z in zones if not z.is_full]
    full = [z for z in zones if z.is_full]

    assert len(numbered) == zcfg.n_zones
    assert len(full) == 1
    covered = sum(z.x1_m - z.x0_m for z in numbered)
    assert covered == pytest.approx(cfg.panel.length_m), "the numbered zones must cover the panel"

    w_full = zone_weight(full[0], grid, boundary_fade_m(cfg, zcfg))
    assert np.all(w_full == 1.0), "'full' must cover every cell of the grid"


# ---------------------------------------------------------------------------------------------
# L8-6 — the null scenario: with ds = 0 the lab's answer IS the simulator's answer (P2)
# ---------------------------------------------------------------------------------------------

def test_l8_6_a_null_scenario_reproduces_the_exported_crack_field(run_dir, snap_at_end):
    """Change nothing, and every crack number must match what the simulator wrote to disk.

    This is the assertion S0 §S8 called "the important one". L8-1c compares the strain the two halves
    derive; this compares what the lab SAYS about it - cracked or not, and how wide - against the
    exported field, cell for cell on the overlap. It is cheap and it fails the moment one side is
    edited and not the other.

    Widths are compared where the export's own instantaneous opening is non-zero: the exported
    width_mm carries the LATCH (a crack that has partly closed keeps 35 % of its widest), so a cell
    whose strain has since fallen below the threshold legitimately has a width in the export and none
    in an instantaneous evaluation. That difference is the latch working, not a disagreement.
    """
    export = run_dir.parent / "cracks" / f"crack_field_day{int(snap_at_end.day):04d}.npz"
    if not export.is_file():
        pytest.skip(f"{export} not exported - run scripts/export_cracks.py (see step S7)")

    from lab.consequence import evaluate

    s = snap_at_end.s_model_mm
    out = evaluate(s, s, snap_at_end.grid, snap_at_end.cfg, snap_at_end.lab,
                   crack_baseline=snap_at_end.crack_baseline)
    assert out["summary"]["max_extra_sinking_mm"] == 0.0
    assert out["cracks"]["new_count"] == 0, "a null scenario cracked ground the run had not cracked"

    z = np.load(export)
    xs, ys = z["x_m"], z["y_m"]
    cfg = snap_at_end.cfg
    thr, spacing = cfg.cracks.tensile_strain_threshold_ue, cfg.cracks.crack_spacing_m
    # What the simulator's own numbers say, instantaneously, at this day - the like-for-like half.
    exp_width = sim_cracks.opening_mm(z["e1_ue"], thr, spacing)

    g = snap_at_end.grid
    f = derive_fields(s, g.cell_m, cfg)
    lab_width = lab_cracks.crack_width_mm(principal_from_fields(f)[0], cfg)
    lx = g.origin_x_m + (np.arange(g.shape[0]) + 0.5) * g.cell_m
    ly = g.origin_y_m + (np.arange(g.shape[1]) + 0.5) * g.cell_m
    EX, EY = np.meshgrid(xs, ys, indexing="ij")
    lab_here = _bilinear(lab_width, lx, ly, EX, EY)

    both = np.isfinite(lab_here) & (exp_width > 0) & (lab_here > 0)
    assert both.sum() > 0, "no cell is cracked in both - pick a day with a live trough"
    rel = np.abs(lab_here[both] - exp_width[both]) / exp_width[both]
    assert np.median(rel) < 0.05, f"crack widths disagree, median {np.median(rel):.4f}"

    # And the damage grade, which is what a person actually reads.
    frontage = cfg.damage.default_structure_length_m
    exp_grade = sim_cracks.damage_grade_field(z["e1_ue"], frontage)
    lab_grade = sim_cracks.damage_grade_field(
        lab_cracks.to_microstrain(_bilinear(principal_from_fields(f)[0], lx, ly, EX, EY)), frontage)
    overlap = np.isfinite(lab_here)
    differ = np.mean(exp_grade[overlap] != lab_grade[overlap])
    assert differ < 0.02, f"{differ:.3%} of cells get a different NCB grade from the two routes"


def test_l8_7_crack_lines_point_the_way_the_simulator_says(run_dir, snap_at_end):
    """A crack's bearing must be the simulator's too, not just its width.

    The bearing is the whole reason the cross-derivative was added in P1. If it inverts, the picture
    still looks busy and plausible - it is simply rotated 90 degrees from the ground truth - so it
    gets its own assertion against the exported theta rather than being trusted to the strain check.
    """
    export = run_dir.parent / "cracks" / f"crack_field_day{int(snap_at_end.day):04d}.npz"
    if not export.is_file():
        pytest.skip(f"{export} not exported - run scripts/export_cracks.py (see step S7)")

    from lab.consequence import evaluate

    z = np.load(export)
    xs, ys, theta_exp = z["x_m"], z["y_m"], z["theta_deg"]
    s = snap_at_end.s_model_mm
    out = evaluate(s, s, snap_at_end.grid, snap_at_end.cfg, snap_at_end.lab,
                   crack_baseline=snap_at_end.crack_baseline)
    segments = out["cracks"]["segments"]
    assert segments

    mid_x = np.array([(seg["x0_m"] + seg["x1_m"]) / 2 for seg in segments])
    mid_y = np.array([(seg["y0_m"] + seg["y1_m"]) / 2 for seg in segments])
    bearing = np.array([seg["bearing_deg"] for seg in segments])
    theta_here = _bilinear(theta_exp, xs, ys, mid_x, mid_y)
    good = np.isfinite(theta_here)
    assert good.sum() > 0

    # A crack opens across the pull: line bearing = theta + 90. Compared as a doubled angle, because
    # a line at 10 degrees and one at 190 are the same line.
    delta = np.degrees(np.angle(np.exp(2j * np.radians(bearing[good] - theta_here[good]))))
    assert np.median(np.abs(np.abs(delta) - 180.0)) < 5.0, (
        "crack lines do not run across the exported principal strain direction - suspect the "
        "quarter turn in consequence._crack_lines, or a sign flip in principal_from_fields")
