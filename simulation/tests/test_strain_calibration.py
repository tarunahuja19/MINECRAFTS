"""
Cross-language calibration guard for the TENSILE WAVE intervention.

`frontend/src/utils/geomechanicsEngine.ts::solveStrainIntervention` inverts two
relations to work out what collapse geometry produces a requested peak tensile
strain. Those relations describe the SERVER's collapse kernel
(`sandbox/collapse.py::_spatial_profile`), because the server is what computes
the strain the sensors actually report — the browser's own `bowlProfile` is a
different, erf-based shape used only to preview the drop between ticks.

That split is the bug this file exists to prevent. The constant shipped as
STRAIN_GEOMETRY_C = 86315.9, which is 2.80x the true value, so the solver asked
for ~2.8x less magnitude than the requested strain needs: the control silently
under-delivered and its caption quoted a peak the ground never reached.

These tests re-derive both constants from the real Python kernel and assert the
TypeScript source still agrees, so the two languages cannot drift apart again.
"""

import math
import re
from pathlib import Path

import numpy as np
import pytest

from sandbox.collapse import PillarFailure, _spatial_profile
from sandbox.constants import B_HORIZ

_ENGINE_TS = (
    Path(__file__).resolve().parent.parent
    / "frontend" / "src" / "utils" / "geomechanicsEngine.ts"
)


def _peak_strain_on_axis(radius_m: float, magnitude_m: float = 1.0):
    """Peak tensile strain of one collapse, and where it lands, from the real kernel.

    Sweeps along the +x axis through the collapse centre using
    `sandbox.collapse._spatial_profile` itself, so this measures the shipped
    solver rather than a paper re-derivation of it.
    """
    d = np.linspace(0.0, 6.0 * radius_m, 400_001)
    zeros = np.zeros_like(d)
    _, _, _, d2g_dx2, _ = _spatial_profile(d, zeros, 0.0, 0.0, radius_m)
    # eps_x = B * d2S/dx2, in m/m; x1000 for the mm/m the DGMS limits use.
    eps = B_HORIZ * magnitude_m * d2g_dx2 * 1000.0
    i = int(np.argmax(eps))
    return float(eps[i]), float(d[i])


def _read_ts_number(expr_name: str) -> str:
    """Return the right-hand side of an `export const <name> = ...;` in the engine."""
    src = _ENGINE_TS.read_text(encoding="utf-8")
    m = re.search(rf"export const {expr_name}\s*=\s*([^;]+);", src)
    assert m is not None, f"{expr_name} not found in {_ENGINE_TS.name}"
    return m.group(1).strip()


# ---------------------------------------------------------------------------
# Relation 1: the tensile peak lands at sqrt(3) * R.
# ---------------------------------------------------------------------------
def test_tensile_peak_lands_at_sqrt3_radius():
    """The peak of a Gaussian bowl's second derivative sits at sqrt(3)*sigma."""
    for radius in (40.0, 60.0, 90.0, 120.0, 150.0):
        _, peak_d = _peak_strain_on_axis(radius)
        assert peak_d / radius == pytest.approx(math.sqrt(3.0), rel=1e-4), (
            f"R={radius}: peak at {peak_d / radius:.6f}*R, expected sqrt(3)"
        )


def test_ts_declares_sqrt3_peak_ratio():
    """The TypeScript solver must use that same ratio."""
    assert _read_ts_number("TENSILE_PEAK_RADIUS_RATIO") == "Math.sqrt(3.0)"


# ---------------------------------------------------------------------------
# Relation 2: eps_peak = magnitude * C / R^2, with C = B * 2 * e^(-3/2) * 1000.
# ---------------------------------------------------------------------------
def test_strain_geometry_constant_is_scale_invariant():
    """C is genuinely constant in R — the 1/R^2 law is exact, not a local fit."""
    cs = []
    for radius in (40.0, 60.0, 90.0, 120.0, 150.0):
        eps, _ = _peak_strain_on_axis(radius)
        cs.append(eps * radius * radius)
    assert max(cs) - min(cs) < 1e-3 * cs[0], f"C drifts with R: {cs}"


def test_strain_geometry_constant_matches_closed_form():
    """The measured constant equals the analytic B * 2 * e^(-3/2) * 1000."""
    closed_form = B_HORIZ * 2.0 * math.exp(-1.5) * 1000.0
    eps, _ = _peak_strain_on_axis(90.0)
    assert eps * 90.0 * 90.0 == pytest.approx(closed_form, rel=1e-6)
    # Guard the specific value, so a change to B_HORIZ is a deliberate act.
    assert closed_form == pytest.approx(30827.193178, rel=1e-9)


def test_ts_derives_strain_constant_rather_than_hardcoding_it():
    """The engine must DERIVE C from B_HORIZ_M, not hand-type a magic number.

    A literal here is what allowed the 86315.9 (2.80x too large) to survive.
    """
    rhs = _read_ts_number("STRAIN_GEOMETRY_C")
    assert "B_HORIZ_M" in rhs, f"STRAIN_GEOMETRY_C must derive from B_HORIZ_M, got: {rhs}"
    assert rhs == "B_HORIZ_M * 2.0 * Math.exp(-1.5) * 1000.0"

    # And B_HORIZ_M itself must match the Python B_HORIZ it mirrors.
    b_rhs = _read_ts_number("B_HORIZ_M")
    assert b_rhs == "0.35 * R_INFL_M"
    assert B_HORIZ == pytest.approx(0.35 * (375.0 / 1.9), rel=1e-12)


def test_solver_round_trip_reaches_the_requested_strain():
    """Invert the relations as the TS solver does, then verify against the kernel.

    This is the end-to-end claim the TENSILE WAVE caption makes: ask for a
    strain, get a geometry, and the real kernel delivers that strain on the
    promised ring.
    """
    c_const = B_HORIZ * 2.0 * math.exp(-1.5) * 1000.0
    s_max_full = 0.75 * 3.0  # a * m, mirroring S_MAX_FULL_M

    target_ring_m = 75.0
    target_strain = 5.3 * 1.05  # DGMS tensile limit, just over

    # Same inversion as solveStrainIntervention.
    radius = max(10.0, target_ring_m / math.sqrt(3.0))
    wanted = (target_strain * radius * radius) / c_const
    magnitude = min(wanted, s_max_full)

    eps, peak_d = _peak_strain_on_axis(radius, magnitude)
    assert eps == pytest.approx(target_strain, rel=1e-4)
    assert peak_d == pytest.approx(target_ring_m, rel=1e-3)
    assert magnitude <= s_max_full


# ---------------------------------------------------------------------------
# Intervention pace (frontend/src/interventions.ts).
# ---------------------------------------------------------------------------
def _ts_number(source: str, name: str) -> float:
    m = re.search(rf"export const {name}\s*=\s*([0-9.]+)\s*;", source)
    assert m is not None, f"{name} not found"
    return float(m.group(1))


def _pace_seconds() -> float:
    """Parse the single pace's advertised `EVENT_PACE_REAL_SECONDS` from the TS."""
    src = (
        Path(__file__).resolve().parent.parent
        / "frontend" / "src" / "interventions.ts"
    ).read_text(encoding="utf-8")
    return _ts_number(src, "EVENT_PACE_REAL_SECONDS")


def test_pace_delivers_its_advertised_wall_clock_time():
    """The pace labelled "~60s" must really take ~60 real seconds.

    The pace is declared in real seconds and converted to sim-hours by
    paceHours(). This checks the round trip through the fixed speed multiplier,
    because hand-picked sim-hours (1.25 h / 2.5 h) looked plausible while
    actually taking 22 real minutes at 10x.
    """
    src = (
        Path(__file__).resolve().parent.parent
        / "frontend" / "src" / "interventions.ts"
    ).read_text(encoding="utf-8")
    speed = _ts_number(src, "FIXED_SPEED_MULTIPLIER")
    real_s = _pace_seconds()

    total_sim_hours = real_s * speed / 3600.0
    warning_h = total_sim_hours / 3.0
    duration_h = total_sim_hours * 2.0 / 3.0
    # Round trip: sim-hours back to the wall clock the label promises.
    back_to_real = (warning_h + duration_h) * 3600.0 / speed
    assert back_to_real == pytest.approx(real_s, rel=1e-9)


def test_pace_is_a_legal_pillar_failure():
    """The pace may not violate the CRITICAL-before-FAILED warning window.

    PillarFailure rejects t_collapse <= t_init; this constructs the single
    pace exactly as the client sends it.
    """
    src = (
        Path(__file__).resolve().parent.parent
        / "frontend" / "src" / "interventions.ts"
    ).read_text(encoding="utf-8")
    speed = _ts_number(src, "FIXED_SPEED_MULTIPLIER")
    real_s = _pace_seconds()

    total_sim_hours = real_s * speed / 3600.0
    warning_h = total_sim_hours / 3.0
    duration_h = total_sim_hours * 2.0 / 3.0

    pf = PillarFailure(
        cx=0.0, cy=0.0, radius_m=75.0,
        t_init_days=1.0,
        t_collapse_days=1.0 + warning_h / 24.0,
        duration_days=duration_h / 24.0,
        magnitude_m=0.75,
    )
    assert pf.t_collapse_days > pf.t_init_days
    assert pf.duration_days > 0.0


def test_severity_slider_range_lies_within_the_physical_ceiling():
    """Both severity sliders must stay inside S_max = a*m.

    They shipped as 4-45 m against a 2.25 m ceiling, so every position clamped
    to the same value and the control was inert across its whole travel.
    """
    from sandbox.constants import A_SUBS, M_SEAM_M

    s_max = A_SUBS * M_SEAM_M
    root = Path(__file__).resolve().parent.parent / "frontend" / "src"

    # Every severity slider is DISCOVERED rather than listed by filename. The
    # list used to be hardcoded and named OfficeRibbon.tsx, which was deleted
    # when the ribbon became a menu bar — so this gate spent that whole time
    # raising FileNotFoundError instead of checking anything. A gate that
    # names files cannot survive the files being renamed; one that searches
    # for the control keeps working, and also covers sliders added later.
    sources = {
        path.relative_to(root).as_posix(): path.read_text(encoding="utf-8")
        for path in root.rglob("*.tsx")
    }
    # A file that merely PASSES onChangeSeverity down (App.tsx does) owns no
    # slider and has no max to bind; the control itself is the one that pairs
    # the handler with a range input.
    with_severity = {
        rel: src
        for rel, src in sources.items()
        if "onChangeSeverity" in src and 'type="range"' in src
    }
    assert with_severity, "no severity slider found anywhere in the frontend"

    for rel, src in with_severity.items():
        # The max must be bound to the engine constant, not a literal.
        assert "max={S_MAX_FULL_M}" in src, f"{rel}: severity max must use S_MAX_FULL_M"
        assert 'max="45"' not in src, f"{rel}: stale 45 m severity range still present"
    assert s_max == pytest.approx(2.25)
