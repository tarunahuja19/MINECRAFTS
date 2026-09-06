"""
Session A pytest suite: gates T47/T48/T49, the frozen node layout, and the
terrain/surface modules' own correctness properties.

Run from `simulation_making/`:
    .venv/bin/python -m pytest tests/ -v

Gate ID mapping (see `sandbox/gates.py`'s module docstring for the full
renumbering rationale): T47 <- was T33, T48 <- was T34, T49 <- was T35.
"""

from pathlib import Path

import numpy as np
import pytest

from sandbox import constants as c
from sandbox import gates
from sandbox import layout
from sandbox import sensors
from sandbox.surface import S, channels, grid
from sandbox.terrain import baseline_grid

_SANDBOX_ROOT = Path(__file__).resolve().parent.parent / "sandbox"


# ---------------------------------------------------------------------------
# T47 (was T33): subcritical peak subsidence emerges from the convolution.
# ---------------------------------------------------------------------------


def test_t47_subcritical_peak():
    """Peak S at t=1e6 (fully settled) is below S_MAX_FULL (subcritical,
    since W_PANEL_M is narrower than a few R_INFL) and matches the
    independently-computed target of 1.9971 m to within 0.01 m."""
    X, Y = grid()
    peak = float(np.max(S(X, Y, t=1e6)))
    assert peak < c.S_MAX_FULL, f"T47 FAIL: reached full subsidence ({peak} >= {c.S_MAX_FULL})"
    assert abs(peak - 1.9971) < 0.01, f"T47 FAIL: expected 1.9971 m, got {peak:.4f}"


def test_t47_no_manual_reduction_factor():
    """S(t=0) is exactly zero everywhere (no baked-in offset), and the
    settled peak divides S_MAX_FULL to give ~0.887608 -- the across-strike
    erf profile factor -- confirming the subcritical reduction emerges
    from the mask/kernel convolution geometry, not a hardcoded multiplier
    applied on top of a would-be full-subsidence value."""
    X, Y = grid()
    s_at_zero = S(X, Y, t=0.0)
    assert np.all(s_at_zero == 0.0), "T47 FAIL: S(t=0) is not exactly zero everywhere"

    peak = float(np.max(S(X, Y, t=1e6)))
    ratio = peak / c.S_MAX_FULL
    assert abs(ratio - 0.887608) < 1e-3, (
        f"T47 FAIL: settled peak / S_MAX_FULL = {ratio:.6f}, expected ~0.887608 "
        "(the erf profile factor) -- a manual reduction factor would not "
        "reproduce this value to this precision"
    )


# ---------------------------------------------------------------------------
# T48 (was T34): SNR detectability margin.
# ---------------------------------------------------------------------------

# Frozen strain noise budget (../final/00-README-index.md:229), combined in
# quadrature: sigma_w=1.2, sigma_b=0.5, quantisation LSB=1 -> LSB/sqrt(12).
_SIGMA_UE = np.sqrt(1.2**2 + 0.5**2 + (1.0 / np.sqrt(12)) ** 2)

# Frozen Knothe rate constant (../final/00-README-index.md:87), and this
# sandbox's own measured compressive strain peak (see surface.py), used
# together as delta_signal = c * strain_peak * n -- see gates.snr_margin's
# docstring for the full derivation and why it lands close to, but not
# bit-exact with, the source plan's own rounded 2.41 / 6.81 figures.
_C_FROZEN = 0.01414
_STRAIN_PEAK_MM_PER_M = 9.006


def _delta_signal(n: int) -> float:
    return _C_FROZEN * _STRAIN_PEAK_MM_PER_M * n


def test_t48_snr_margin_n40_passes():
    """At n=40 (the widened window -- see gates.snr_margin's docstring for
    why n=20 cannot pass), the margin against the frozen noise budget
    clears the 3.0 refusal threshold with real headroom (~6.8)."""
    n = 40
    margin = gates.snr_margin(_SIGMA_UE, _delta_signal(n), n)
    assert margin >= gates.MARGIN_THRESHOLD
    assert margin == pytest.approx(6.81, rel=0.05)


def test_t48_snr_margin_n20_would_refuse():
    """Documents WHY the window was widened from the source plan's n=20 to
    n=40: at the SAME noise budget, n=20 gives a margin below the 3.0
    threshold, so the gate as originally specified would refuse to boot
    the simulator, always. This test asserts that failure, not to exercise
    a code path that runs anywhere, but so nobody "fixes" this test file
    later by reverting to n=20 without re-deriving why it can't work."""
    n = 20
    margin = gates.snr_margin(_SIGMA_UE, _delta_signal(n), n)
    assert margin < gates.MARGIN_THRESHOLD
    assert margin == pytest.approx(2.41, rel=0.05)


def test_t48_refuses_inflated_noise():
    """A deliberately inflated sigma (well past what n=40 can tolerate)
    drives the margin below 3.0, and boot_check reports failure -- the
    gate's whole purpose is to refuse a session whose noise budget makes
    its own reference signal undetectable."""
    n = 40
    inflated_sigma = _SIGMA_UE * 20.0
    margin = gates.snr_margin(inflated_sigma, _delta_signal(n), n)
    assert margin < gates.MARGIN_THRESHOLD
    assert gates.boot_check(inflated_sigma, _delta_signal(n), n) is False
    # and the real, un-inflated budget still passes at the same n:
    assert gates.boot_check(_SIGMA_UE, _delta_signal(n), n) is True


# ---------------------------------------------------------------------------
# T49 (was T35): exactly one implementation of S(x, y, t) in the sandbox.
# ---------------------------------------------------------------------------


def test_t49_single_implementation():
    """Exactly one `def S(...)` under simulation_making/sandbox/. Scoped
    deliberately to the sandbox tree -- see gates.check_single_implementation's
    docstring for why a repo-wide search would fail on day one against the
    parent project's own, separate, legitimate S() at ../ground/surface.py."""
    count = gates.check_single_implementation(_SANDBOX_ROOT)
    assert count == 1


def test_t49_fires_on_class_method_definition(tmp_path):
    """Regression test for a real defect: the gate's regex was originally
    anchored to column 0 (`^def S\\s*\\(`), so it only matched module-level
    functions and silently missed `S` defined as an INDENTED class method
    -- exactly how the parent project's own ../ground/surface.py structures
    its S() (`class GroundModel: def S(self, x, y, t): ...`). A second S()
    added to the sandbox as a class method would have passed T49 while the
    single-implementation invariant was actually broken.

    This builds two throwaway .py files in pytest's tmp_path (never inside
    the repo, and never pointed at the parent tree): one module-level
    `def S(x, y, t):` and one class method `def S(self, x, y, t):`, and
    asserts the gate counts both and refuses to pass, proving the regex
    now catches indented definitions rather than only column-0 ones."""
    (tmp_path / "module_level.py").write_text(
        "def S(x, y, t):\n    return x + y + t\n"
    )
    (tmp_path / "as_class_method.py").write_text(
        "class GroundModel:\n"
        "    def S(self, x, y, t):\n"
        "        return x + y + t\n"
    )

    with pytest.raises(AssertionError, match=r"found 2"):
        gates.check_single_implementation(tmp_path)


# ---------------------------------------------------------------------------
# Frozen node layout.
# ---------------------------------------------------------------------------


def _strain_seen_by_array(axis, strain_x_mm):
    """The strain values the array actually observes, one per in-window node.

    Nodes no longer land exactly on `surface.grid()` points — irregular
    Poisson-disc placement is the point (MESH_UPGRADE_BRIEF.md section 2) —
    so each is read at the NEAREST grid sample, the same rounding
    `sensors._coord_to_grid_index` performs. At 2.5 m grid spacing the
    worst-case offset is 1.25 m, far below the scale on which the field
    varies.

    The gateway is excluded: it sits outside the window by construction and
    would clamp to an edge sample that is not a real reading.
    """
    seen = []
    for (x, y), tier in zip(layout.node_positions(), layout.node_tiers()):
        if tier == layout.TIER_3:
            continue
        ix = int(np.argmin(np.abs(axis - x)))
        iy = int(np.argmin(np.abs(axis - y)))
        seen.append(strain_x_mm[iy, ix])
    return seen



def test_layout_shape():
    """node_positions(), node_ids() and node_tiers() agree on one layout."""
    positions = layout.node_positions()
    assert positions.shape == (layout.N_NODES, 2)
    assert layout.node_ids().shape == (layout.N_NODES,)
    assert layout.node_ids().min() == 1
    assert layout.node_ids().max() == layout.N_NODES
    assert len(layout.node_tiers()) == layout.N_NODES

    # Every node carries a tier the sensor layer knows how to instrument.
    assert set(layout.node_tiers()) <= set(sensors.TIER_CHANNELS)

    # Scouts and anchors live in the monitoring window; the gateway is the
    # one node deliberately OUTSIDE it, 500-1000 m beyond the angle of draw
    # (MESH_UPGRADE_BRIEF.md section 1). Its immobility is what makes it the
    # network's stable reference, so a gateway inside the window would be a
    # real defect, not a cosmetic one.
    half = c.WINDOW_SIZE_M / 2.0
    for (x, y), tier in zip(positions, layout.node_tiers()):
        if tier == layout.TIER_3:
            assert np.hypot(x, y) > half + c.R_INFL, (
                "gateway must sit outside the angle of draw"
            )
        else:
            assert -half <= x <= half and -half <= y <= half


def test_layout_is_not_a_grid():
    """Placement must be irregular — a GNN trained on a grid memorises it.

    A uniform lattice has a nearest-neighbour distance distribution with
    essentially zero spread. Poisson-disc placement does not, so a low
    coefficient of variation here means the lattice has crept back in.
    """
    positions = layout.node_positions()
    d = np.hypot(
        positions[:, None, 0] - positions[None, :, 0],
        positions[:, None, 1] - positions[None, :, 1],
    )
    np.fill_diagonal(d, np.inf)
    nn = d.min(axis=1)
    cv = float(nn.std() / nn.mean())
    assert cv > 0.25, f"nearest-neighbour CV {cv:.3f} — layout looks like a grid"


def test_scouts_per_anchor_respects_the_bundle_ceiling():
    """Node counts are arithmetic, not preference (brief section 3).

    An Anchor bundles its children into a single 138-byte payload and a
    Scout packet is 23 bytes, so 6 children is a hard physical ceiling. The
    old dataset shipped anchors with 13 children — a network that cannot
    exist. The ratio must sit at or under the 5:1 design point.
    """
    ratio = layout.N_SCOUTS / layout.N_ANCHORS
    assert ratio <= layout.CLUSTER_FANOUT_NOMINAL, (
        f"{ratio:.2f} scouts per anchor exceeds the "
        f"{layout.CLUSTER_FANOUT_NOMINAL}:1 design point"
    )


def test_layout_detects_tensile_band():
    """The frozen 77-node layout, sampled against surface.channels' strain_x
    at the settled state, sees a peak tensile strain >= EPS_TENSILE_LIMIT
    (5.3 mm/m). The tensile peak itself sits at x=+-204 m, which is NOT a
    node position (nodes are on the 60 m grid); the nearest nodes are at
    +-180 and +-240 m. The measured worst case is 5.45 mm/m at x=+-180 m,
    which still clears the threshold -- unlike every uniform layout the
    source plan's section 2.3 tables (see layout.py's module docstring)."""
    X, Y = grid()
    axis = X[0]  # 1-D axis shared by both X rows and Y columns (square grid)
    ch = channels(X, Y, t=1e6)
    strain_x_mm = ch["strain_x"] * 1000.0  # fraction -> mm/m

    seen = _strain_seen_by_array(axis, strain_x_mm)
    worst_case_tensile = max(seen)
    assert worst_case_tensile >= c.EPS_TENSILE_LIMIT
    # The irregular layout does BETTER than the grid it replaced: 1B is
    # sited in the tensile band by construction, so the array now sees the
    # true global peak (6.06 mm/m) rather than the grid's nearest-sample
    # 5.45 mm/m.
    assert worst_case_tensile == pytest.approx(6.06, abs=0.05)


def test_layout_sees_compressive_peak():
    """The frozen layout sees a compressive strain <= -EPS_COMPRESS_LIMIT
    (-6.6 mm/m). Unlike the tensile band, the compressive peak sits at
    x=0, which IS a node position, so this layout sees it exactly
    (-9.006 mm/m, the true global minimum)."""
    X, Y = grid()
    axis = X[0]
    ch = channels(X, Y, t=1e6)
    strain_x_mm = ch["strain_x"] * 1000.0

    seen = _strain_seen_by_array(axis, strain_x_mm)
    worst_case_compressive = min(seen)
    assert worst_case_compressive <= -c.EPS_COMPRESS_LIMIT


# ---------------------------------------------------------------------------
# Terrain determinism.
# ---------------------------------------------------------------------------


def test_terrain_deterministic():
    """Same seed reproduces a bit-identical Z0; a different seed does not."""
    _, _, z1 = baseline_grid(seed=42)
    _, _, z2 = baseline_grid(seed=42)
    assert np.array_equal(z1, z2)

    _, _, z3 = baseline_grid(seed=43)
    assert not np.array_equal(z1, z3)


# ---------------------------------------------------------------------------
# Analytic derivative vs. finite-difference oracle.
# ---------------------------------------------------------------------------


def test_analytic_derivatives_match_finite_difference():
    """A central finite difference of the settled S grid, evaluated at the
    point of peak |tilt_x|, agrees with the analytic tilt_x channel to
    < 0.1% relative. This is a TEST-ONLY check: surface.py itself never
    uses finite differences (see its module docstring on why -- FD error
    would mimic the strain signal the detector exists to find), so FD is
    used here purely as an independent oracle to catch a wrong analytic
    kernel, not as part of the implementation under test."""
    X, Y = grid()
    dx = float(X[0, 1] - X[0, 0])
    ch = channels(X, Y, t=1e6)
    s = ch["s"]
    tilt_x = ch["tilt_x"]

    iy, ix = np.unravel_index(np.argmax(np.abs(tilt_x)), tilt_x.shape)
    fd = (s[iy, ix + 1] - s[iy, ix - 1]) / (2.0 * dx)
    analytic = tilt_x[iy, ix]

    rel_err = abs(fd - analytic) / abs(analytic)
    assert rel_err < 1e-3, f"FD vs analytic tilt_x mismatch: rel_err={rel_err:.6f}"
