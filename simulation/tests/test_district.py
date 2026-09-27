"""The real-anchored district (sandbox/district.py, plan step G1).

Cross-checks the vendored Knothe closed form against its source (sih-26-finale/mine-sim), against
the 283 digitised Adriyala LW1 survey points, and against the separable bowl-term decomposition and
per-node tilt margins the rest of the plan (G2 onward) depends on.
"""

import csv
import sys
from pathlib import Path

import numpy as np
import pytest

from sandbox import district, layout, surface, thresholds
from sandbox.constants import (
    DISTRICT_PANEL_X_M,
    DISTRICT_START_DAY,
    FIT_FACE_START_Y_M,
)

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_FINALE_SRC = _REPO_ROOT / "sih-26-finale" / "mine-sim" / "src"
_FINALE_ASSUMPTIONS = _REPO_ROOT / "sih-26-finale" / "mine-sim" / "config" / "assumptions.yaml"
_SURVEY_CSV = _REPO_ROOT / "sih-26-finale" / "mine-sim" / "data" / "real" / "adriyala_lw1_profiles.csv"

X_GRID, Y_GRID = surface.grid()


def _load_finale():
    """Import finale's physics/config modules, skipping the whole test if the finale tree (or its
    dependencies, e.g. scipy) is unavailable -- it is a sibling tree this sandbox does not depend on
    at runtime (district.py's own module docstring), only these cross-checks do."""
    if not _FINALE_SRC.is_dir():
        pytest.skip(f"finale tree not found at {_FINALE_SRC}")
    sys.path.insert(0, str(_FINALE_SRC))
    try:
        from minesim import physics
        from minesim.config import load_config
    except Exception as exc:  # pragma: no cover - environment-dependent
        pytest.skip(f"finale import failed: {exc}")
    cfg = load_config(_FINALE_ASSUMPTIONS)
    return physics, cfg


def test_lw1_matches_finale_physics_subsidence():
    """(a) LW1 alone (one panel, centre 0, start day 0) matches finale physics.subsidence bit-close:
    within 0.5 mm over a grid of along/across points and four days."""
    physics, cfg = _load_finale()
    finale_x = np.linspace(0.0, 1000.0, 11)     # along panel, from the starting face
    finale_y = np.linspace(-300.0, 300.0, 13)   # across strike
    FX, FY = np.meshgrid(finale_x, finale_y)
    # sandbox_y = finale_x + FIT_FACE_START_Y_M ; sandbox_x = finale_y (inverse of district.py's map)
    sandbox_y = FX + FIT_FACE_START_Y_M
    sandbox_x = FY

    max_diff = 0.0
    for t in (30.0, 120.0, 210.0, 300.0):
        ref_mm = physics.subsidence(FX, FY, t, cfg.panel, cfg.knothe)
        mine_mm = district.subsidence_mm(
            sandbox_x, sandbox_y, t, y_offsets_m=(0.0,), start_day_offsets_d=(0.0,)
        )
        max_diff = max(max_diff, float(np.max(np.abs(ref_mm - mine_mm))))
    assert max_diff <= 0.5, f"max |district - finale| = {max_diff:.4f} mm"


def test_lw1_district_matches_finale_at_sensing_nodes():
    """The FULL 3-panel district also matches finale physics.subsidence bit-close, evaluated at
    every sensing-node coordinate across several days -- the same superposition, not just the
    single-panel case above."""
    physics, cfg = _load_finale()
    import dataclasses

    panel3 = dataclasses.replace(
        cfg.panel, y_offsets_m=DISTRICT_PANEL_X_M, start_day_offsets_d=DISTRICT_START_DAY
    )
    pos = layout.node_positions()
    Xn, Yn = pos[:, 0], pos[:, 1]
    finale_x = Yn - FIT_FACE_START_Y_M
    finale_y = Xn

    max_diff = 0.0
    for t in (0.0, 90.0, 200.0, 365.0):
        ref_mm = physics.subsidence(finale_x, finale_y, t, panel3, cfg.knothe)
        mine_mm = district.subsidence_mm(Xn, Yn, t)
        max_diff = max(max_diff, float(np.max(np.abs(ref_mm - mine_mm))))
    assert max_diff <= 0.5, f"max |district - finale| = {max_diff:.4f} mm"


def _load_survey_csv():
    rows = []
    with open(_SURVEY_CSV, newline="") as f:
        for row in csv.DictReader(f):
            rows.append(
                (float(row["distance_m"]), float(row["epoch_days"]), float(row["subsidence_mm"]))
            )
    return rows


# Fitted pinning parameters (adriyala_lw1_params.json / config/mines/adriyala_lw1.yaml pinning
# block): the transverse survey line sits at finale x = 258.0 m along the panel, and the CSV's
# distance_m is finale y (across strike) plus this offset -- the CSV origin is the trough minimum.
_SURVEY_LINE_X_M = 258.0
_SURVEY_ORIGIN_OFFSET_M = 13.47


def test_rms_against_survey_csv():
    """(b) RMS of LW1-alone against the measured CSV at epochs 210 and 300 is <= 60 mm. CSV
    subsidence_mm is NEGATIVE for sinking; district.subsidence_mm is positive down, so compare
    against its negation (the same sign convention minesim.fitting._knothe_prediction uses)."""
    if not _SURVEY_CSV.is_file():
        pytest.skip(f"survey CSV not found at {_SURVEY_CSV}")
    rows = _load_survey_csv()
    sandbox_y_survey = _SURVEY_LINE_X_M + FIT_FACE_START_Y_M

    for epoch in (210.0, 300.0):
        sel = [r for r in rows if r[1] == epoch]
        assert sel, f"no CSV rows at epoch {epoch}"
        distance_m = np.array([r[0] for r in sel])
        measured_mm = np.array([r[2] for r in sel])  # negative (sinking)
        sandbox_x = distance_m - _SURVEY_ORIGIN_OFFSET_M
        model_mm = district.subsidence_mm(
            sandbox_x,
            np.full_like(sandbox_x, sandbox_y_survey),
            epoch,
            y_offsets_m=(0.0,),
            start_day_offsets_d=(0.0,),
        )
        rms = float(np.sqrt(np.mean((-model_mm - measured_mm) ** 2)))
        assert rms <= 60.0, f"epoch {epoch}: RMS {rms:.2f} mm > 60 mm"


def test_bowl_terms_sum_to_channels_s():
    """(c) Sum over panels of bowl_terms_px x bowl_terms_py equals channels()['s'] downsampled x2,
    within 0.5 mm, at three days spanning the year."""
    px = district.bowl_terms_px()
    assert len(px) == 3 and all(len(row) == 121 for row in px)
    for t in (50.0, 200.0, 365.0):
        py = district.bowl_terms_py(t)
        assert len(py) == 3 and all(len(row) == 121 for row in py)
        rebuilt_m = sum(np.outer(py[k], px[k]) for k in range(3))
        truth_m = district.channels(X_GRID, Y_GRID, t)["s"][::2, ::2]
        max_diff_mm = float(np.max(np.abs(rebuilt_m - truth_m))) * 1000.0
        assert max_diff_mm <= 0.5, f"day {t}: max |sum(px*py) - s| = {max_diff_mm:.4f} mm"


def test_every_sensing_node_tilt_changes_by_advisory_and_27_reach_warning():
    """(d) Every sensing node (all layout tiers except '3', the gateway) sees its tilt vector move
    at least the ADVISORY line (1.5 mm/m) from its day-0 (install) reading at some point in days
    0..365 -- the same zeroing G2 gives real instruments -- and at least 27 of the 30 sensing nodes
    reach the WARNING line (3.0 mm/m).

    Planner decision (27 Sep, after this test first flagged 3 nodes short of 3.0 mm/m): keep
    DISTRICT_START_DAY=(-120,0,120) and layout.py unchanged. Re-staggering was measured and never
    gets all 30 nodes to 3.0 mm/m (best min 2.55) -- the plan's Context §3 ballpark was absolute
    tilt, not since-install tilt, and since-install tilt is genuinely lower for nodes over the
    early-starting panel (already part-settled by day 0) and for nodes between two bowls (their
    slopes partly cancel -- real physics, not a modelling artefact). D1 decides final per-node alarm
    coverage from all conditions together (e.g. node 14 is tier 1B and carries a strain gauge), not
    tilt alone -- see walkthroughs/data-365/G1.md's "Planner decision" section.

    Thresholds come from config/alarm-thresholds.json via sandbox.thresholds.load(), not
    hard-coded, so this test tracks Segment T's table if it changes.
    """
    tilt_change = thresholds.load()["conditions"]["tilt_change"]
    advisory_mm_m = float(tilt_change["advisory"])
    warning_mm_m = float(tilt_change["warning"])

    pos = layout.node_positions()
    tiers = layout.node_tiers()
    keep = [i for i, t in enumerate(tiers) if t != layout.TIER_3]
    Xn = pos[keep, 0]
    Yn = pos[keep, 1]
    node_ids = [i + 1 for i in keep]

    ch0 = district.channels(Xn, Yn, 0.0)
    tilt0_x, tilt0_y = ch0["tilt_x"] * 1000.0, ch0["tilt_y"] * 1000.0

    max_delta_mm_m = np.zeros(Xn.shape)
    for t in range(0, 366, 2):
        ch = district.channels(Xn, Yn, float(t))
        dx = ch["tilt_x"] * 1000.0 - tilt0_x
        dy = ch["tilt_y"] * 1000.0 - tilt0_y
        mag = np.sqrt(dx * dx + dy * dy)
        max_delta_mm_m = np.maximum(max_delta_mm_m, mag)

    advisory_margins = max_delta_mm_m - advisory_mm_m
    order = np.argsort(advisory_margins)
    report = "\n".join(
        f"  node {node_ids[i]:2d} ({tiers[keep[i]]}) max|dtilt|={max_delta_mm_m[i]:.3f} mm/m "
        f"advisory_margin={advisory_margins[i]:+.3f} mm/m"
        for i in order
    )
    assert np.all(advisory_margins >= 0.0), (
        f"sensing node(s) never reach the {advisory_mm_m} mm/m ADVISORY tilt change from day 0 "
        f"within the year (worst first):\n{report}"
    )

    n_warning = int(np.sum(max_delta_mm_m >= warning_mm_m))
    assert n_warning >= 27, (
        f"only {n_warning}/{len(node_ids)} sensing nodes reach the {warning_mm_m} mm/m WARNING "
        f"tilt change from day 0 (need >= 27); (worst first):\n{report}"
    )


def test_channels_finite_and_s_nonnegative():
    """(e) channels() is finite everywhere and s >= 0, on the full grid across the year."""
    for t in (0.0, 50.0, 200.0, 365.0):
        ch = district.channels(X_GRID, Y_GRID, t)
        for name, field in ch.items():
            assert np.all(np.isfinite(field)), f"day {t}: {name} has non-finite values"
        assert np.all(ch["s"] >= 0.0), f"day {t}: s has negative values"
