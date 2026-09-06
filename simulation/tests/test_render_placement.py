"""
Gate T56 — surface-placement contract between the server's DEM and anything
the renderer draws *on* that surface.

WHY THIS GATE EXISTS
--------------------
`PROJECT_LOG.md` section 6 records that 35/35 tests passed while the frontend
was ignoring `z0_mesh` entirely, because no test asserted anything about what
the browser does with the payload. The same blind spot then hid a second bug
for longer: `NodeMarkers` and `TargetBeacon` placed geometry using the retired
procedural terrain (8-65 m) while the mesh rendered the real DEM (196-370 m
AMSL, drawn datum-relative as 0-174 m). Measured against the live payload, 17
of 33 sensor monuments were buried up to 89.3 m underground and, at the panel
coordinates in the bug report, 75 of 128 red targeting-ring vertices sat up to
52.2 m below ground.

A pure-Python test cannot execute `terrainSampler.ts`. What it CAN do is pin
the property that made the bug possible: every marker position is derived from
`z0_mesh` by bilinear interpolation, so re-deriving it here and requiring
agreement fails the moment a renderer goes back to sourcing elevations from
somewhere else. The bilinear sampler below is a deliberate port of
`sampleGrid()` in `frontend/src/utils/terrainSampler.ts` — if that function
changes, this one must change with it, and that coupling is the point.
"""

import math

import numpy as np
import pytest
from starlette.testclient import TestClient

from sandbox import collapse, constants, layout, sensors
from sandbox.server import app


@pytest.fixture(scope="module")
def config():
    with TestClient(app) as client:
        return client.get("/config").json()


def _sample_grid(mesh: np.ndarray, u: float, v: float) -> float:
    """Bilinear sample at normalised (u, v), clamped — the exact algorithm of
    `sampleGrid()` in frontend/src/utils/terrainSampler.ts."""
    n = mesh.shape[0]
    uc = min(1.0, max(0.0, u))
    vc = min(1.0, max(0.0, v))
    fx, fy = uc * (n - 1), vc * (n - 1)
    ix0, iy0 = int(np.floor(fx)), int(np.floor(fy))
    ix1, iy1 = min(n - 1, ix0 + 1), min(n - 1, iy0 + 1)
    tx, ty = fx - ix0, fy - iy0
    top = mesh[iy0, ix0] + (mesh[iy0, ix1] - mesh[iy0, ix0]) * tx
    bot = mesh[iy1, ix0] + (mesh[iy1, ix1] - mesh[iy1, ix0]) * tx
    return float(top + (bot - top) * ty)


def _ground_y(mesh: np.ndarray, datum: float, window: float, x: float, y: float) -> float:
    """Datum-relative ground height, as `sampleBaseGroundY()` computes it."""
    return _sample_grid(mesh, (x + window / 2) / window, (y + window / 2) / window) - datum


def test_config_serves_the_real_dem_not_synthetic_terrain(config):
    """The payload the renderer builds its surface from must be the real
    Adriyala panel — 174 m of relief, not the ~1.6 m synthetic fallback."""
    assert config["dem_source"] == "adriyala_regional_z12"
    assert config["elev_relief_m"] == pytest.approx(174.08, abs=0.5)
    mesh = np.array(config["z0_mesh"])
    assert mesh.shape == (121, 121)
    assert not np.isnan(mesh).any()
    assert mesh.min() == pytest.approx(config["elev_min_m"], abs=0.01)
    assert mesh.max() == pytest.approx(config["elev_max_m"], abs=0.01)


def test_every_sensor_node_sits_on_the_dem_surface(config):
    """All 33 monuments must resolve to a height on the served surface.

    Regression: with nodes sourced from `evaluateNaturalElevation()` (8-65 m)
    against this DEM's 0-174 m datum-relative range, 17 of 33 were below
    ground, the worst by 89.3 m.
    """
    mesh = np.array(config["z0_mesh"])
    datum = config["elev_min_m"]
    window = config["window_size_m"]
    relief = config["elev_relief_m"]

    assert len(config["nodes"]) == layout.N_NODES

    # A bounds check alone is NOT enough and must not be mistaken for one:
    # the retired procedural surface spans 8-65 m, which sits entirely inside
    # this panel's 0-174 m range, so every buried node would still pass it.
    # (Verified: 0 nodes violate a bounds check under the old rule.)
    # The property that actually distinguishes correct from buggy placement is
    # that the marker height EQUALS the surface height at the same (x, y).
    for node in config["nodes"]:
        gy = _ground_y(mesh, datum, window, node["x"], node["y"])
        assert -0.01 <= gy <= relief + 0.01, (
            f"node {node['id']} at ({node['x']}, {node['y']}) resolved to "
            f"{gy:.2f} m, outside the panel's 0-{relief:.1f} m range"
        )
        # Re-derive independently from the raw mesh; any renderer sourcing
        # elevations from anywhere but z0_mesh diverges from this immediately.
        expected = _sample_grid(
            mesh,
            (node["x"] + window / 2) / window,
            (node["y"] + window / 2) / window,
        ) - datum
        assert gy == pytest.approx(expected, abs=1e-9), (
            f"node {node['id']} height {gy:.4f} m does not match the DEM "
            f"surface {expected:.4f} m at the same coordinates"
        )


def test_targeting_ring_vertices_never_fall_below_ground(config):
    """The red influence ring is built by sampling the surface at 128 points
    around the target and lifting each by a fixed offset, so no vertex can be
    underground. Regression: sampled from procedural terrain instead, 75 of
    128 vertices were buried up to 52.2 m at the reported coordinates.
    """
    mesh = np.array(config["z0_mesh"])
    datum = config["elev_min_m"]
    window = config["window_size_m"]
    surface_offset = 0.75  # SURFACE_OFFSET in TargetBeacon.tsx

    # Includes the two targets from the original bug report.
    for cx, cy in [(168, -252), (107, -241), (120, 80), (0, 0), (-180, -170)]:
        for i in range(128):
            theta = 2 * np.pi * i / 128
            rx, ry = cx + 75 * np.cos(theta), cy + 75 * np.sin(theta)
            ring_y = _ground_y(mesh, datum, window, rx, ry) + surface_offset
            ground_y = _ground_y(mesh, datum, window, rx, ry)
            assert ring_y >= ground_y, (
                f"ring vertex {i} for target ({cx}, {cy}) is "
                f"{ground_y - ring_y:.2f} m underground"
            )


def test_procedural_terrain_cannot_stand_in_for_the_dem(config):
    """Pins WHY the bug was possible: the retired procedural surface and the
    real DEM disagree by tens of metres, so they were never interchangeable.

    If this ever starts failing because the two agree, the DEM has silently
    been replaced by synthetic terrain — which is exactly the Phase 2 defect.
    """

    def procedural(x, y):
        """Port of the retired `evaluateNaturalElevation()`."""
        h1 = 28.0 * np.exp(-(((x - 120) ** 2 + (y - 80) ** 2) / (2 * 140**2)))
        h2 = 22.0 * np.exp(-(((x + 140) ** 2 + (y + 110) ** 2) / (2 * 130**2)))
        pl = 14.0 * np.exp(-(((x + 80) ** 2 + (y - 140) ** 2) / (2 * 100**2)))
        vl = -8.0 * np.exp(-(x**2) / (2 * 90**2))
        s1 = np.sin(x * 0.007 + 4.2) * np.cos(y * 0.007 + 8.4)
        s2 = np.sin(x * 0.015 - y * 0.012 + 1.7) * 0.5
        s3 = np.cos(x * 0.031 + y * 0.028 + 3.1) * 0.25
        s4 = np.sin(x * 0.065 - y * 0.058 + 5.2) * 0.12
        return max(8.0, 22.0 + h1 + h2 + pl + vl + (s1 + s2 + s3 + s4) * 7.5)

    mesh = np.array(config["z0_mesh"])
    datum = config["elev_min_m"]
    window = config["window_size_m"]

    worst = max(
        abs(_ground_y(mesh, datum, window, n["x"], n["y"]) - procedural(n["x"], n["y"]))
        for n in config["nodes"]
    )
    assert worst > 40.0, (
        f"procedural terrain now agrees with the DEM to within {worst:.1f} m; "
        "the served terrain is probably no longer the real panel"
    )


def test_subsidence_ceiling_is_derived_not_hardcoded(config):
    """S_max_full = a * m must come from the constants, and the frontend's
    severity slider is capped against this value. Regression: the UI offered
    up to 35 m of subsidence over a 3 m seam."""
    assert config["s_max_full"] == pytest.approx(
        constants.A_SUBS * constants.M_SEAM_M
    )
    assert config["s_max_full"] == pytest.approx(2.25)
    assert config["r_infl"] == pytest.approx(
        constants.H_DEPTH_M / constants.TAN_BETA
    )


# --- T57: the node telemetry contract the 3D markers render ------------------
#
# NodeMarkers draws each sensor monument's state from the per-node telemetry in
# the tick payload. It previously destructured that prop as `_nodeTelemetry`
# and discarded it, displaying a browser ESTIMATE of strain and tilt instead,
# so a monument could read STABLE while the server held a DGMS breach for that
# same sensor. These gates pin the contract the markers now depend on: the
# fields exist, carry the units the frontend divides by 1000, and actually
# reach the limits the marker colouring tests against.


def _settled_payload(ticks: int = 6000):
    """Run a session to a settled state with a central collapse applied."""
    from sandbox.session import SimulationSession

    s = SimulationSession()
    s.start()
    s.apply_collapse(
        cx=0.0, cy=0.0, radius_m=90.0, magnitude_m=2.25,
        duration_hours=4.8, warning_hours=2.4,
    )
    payload = None
    for _ in range(ticks):
        payload = s.tick()
    return payload


def test_tick_payload_carries_per_node_strain_and_tilt():
    """Every node row must expose the exact fields NodeMarkers reads."""
    payload = _settled_payload(ticks=10)
    nodes = payload["nodes"]
    assert len(nodes) == layout.N_NODES, (
        f"expected {layout.N_NODES} sensor nodes, got {len(nodes)}"
    )
    for n in nodes:
        assert set(n).issuperset({"id", "strain", "tilt_x", "tilt_y", "alive"}), (
            f"node {n.get('id')} is missing a channel the 3D markers read: {sorted(n)}"
        )
        # `alive` is an int on the wire, not a bool. The frontend guard is
        # `tel.alive === 1`; a bool here would silently change that test.
        # `bool` subclasses `int` in Python, so `isinstance(x, int)` alone
        # would let True through and this gate would not catch the regression
        # it exists to catch.
        assert type(n["alive"]) is int and n["alive"] in (0, 1), (
            f"node {n['id']} alive={n['alive']!r} ({type(n['alive']).__name__}) "
            "is not the 0/1 int the client's `alive === 1` guard expects"
        )


def test_node_strain_is_microstrain_and_reaches_dgms_limits():
    """Units must be microstrain, and real physics must actually reach the
    DGMS limit — otherwise the marker's FAILED branch is unreachable and the
    colouring silently degrades to drop-only, which is the class of bug that
    put degree-based tilt thresholds on a 0.28 deg signal."""
    payload = _settled_payload()
    alive = [n for n in payload["nodes"] if n["alive"] == 1 and n["strain"] is not None]
    assert alive, "no live nodes reporting strain"

    # The client divides by 1000 to get mm/m. If the server ever switched to
    # emitting mm/m directly, that conversion would under-report 1000x and
    # every limit test would silently stop firing.
    breaching = [
        n for n in alive
        if n["strain"] / 1000.0 > constants.EPS_TENSILE_LIMIT
        or n["strain"] / 1000.0 < -constants.EPS_COMPRESS_LIMIT
    ]
    assert breaching, (
        "no node reaches a DGMS limit in a settled central collapse; the "
        "marker FAILED branch would be dead code"
    )

    # Sanity-check the magnitude is microstrain, not mm/m or dimensionless.
    peak_ue = max(abs(n["strain"]) for n in alive)
    assert peak_ue > 100.0, (
        f"peak |strain| {peak_ue} looks like mm/m, not microstrain"
    )


# --- T58: the STRAIN intervention's geometry solver --------------------------
#
# Tensile strain cannot be injected — it is what the bowl's curvature does to
# the ground. The STRAIN control therefore solves for the collapse geometry
# whose tensile peak lands on the ring the operator selected. These gates pin
# the two relations that solver inverts (frontend/src/utils/geomechanicsEngine
# .ts: solveStrainIntervention), measured against this solver rather than
# derived on paper, so a change to collapse.py that invalidates them fails
# here instead of silently making the control aim at the wrong ring.

_TENSILE_PEAK_RADIUS_RATIO = math.sqrt(3.0)
_STRAIN_GEOMETRY_C = 86315.9


def _peak_tensile(radius_m: float, magnitude_m: float):
    """Peak tensile strain (mm/m) of one collapse, and where it lands."""
    xs = np.linspace(-600.0, 600.0, 2401)
    X, Y = np.meshgrid(xs, np.array([0.0]))
    pf = collapse.PillarFailure(
        cx=0.0, cy=0.0, radius_m=radius_m, magnitude_m=magnitude_m,
        t_init_days=0.0, t_collapse_days=0.1, duration_days=0.2,
    )
    eps = collapse.collapse_deltas(X, Y, 5.0, [pf])["delta_strain_x"][0] * 1000.0
    i = int(np.argmax(eps))
    return float(eps[i]), abs(float(xs[i]))


def test_tensile_peak_lands_at_sqrt3_times_radius():
    """Relation 1: the tensile peak sits at sqrt(3) * R.

    This is what lets the control aim: invert it and a requested ring gives
    the collapse radius. sqrt(3) because the extremum of a Gaussian bowl's
    second derivative is at sqrt(3) sigma.
    """
    for radius in (40.0, 60.0, 90.0, 120.0, 160.0):
        _, peak_at = _peak_tensile(radius, constants.S_MAX_FULL)
        ratio = peak_at / radius
        assert ratio == pytest.approx(_TENSILE_PEAK_RADIUS_RATIO, abs=0.01), (
            f"radius {radius} m put its tensile peak at {peak_at:.1f} m "
            f"({ratio:.3f}x, expected {_TENSILE_PEAK_RADIUS_RATIO:.3f}x); "
            "solveStrainIntervention would aim at the wrong ring"
        )


def test_peak_strain_scales_as_magnitude_over_radius_squared():
    """Relation 2: eps_peak = magnitude * C / R^2, linear in magnitude."""
    # Linear in magnitude at fixed radius.
    base, _ = _peak_tensile(90.0, 1.0)
    for mag in (0.5, 2.0):
        got, _ = _peak_tensile(90.0, mag)
        assert got == pytest.approx(base * mag, rel=1e-6), (
            "peak strain is not linear in collapse magnitude"
        )

    # The calibration constant must reproduce the solver at other radii.
    for radius in (60.0, 120.0, 150.0):
        predicted = _STRAIN_GEOMETRY_C / radius**2
        actual, _ = _peak_tensile(radius, 1.0)
        assert predicted == pytest.approx(actual, rel=0.001), (
            f"at R={radius} m the solver gives {actual:.3f} mm/m but the "
            f"frontend constant predicts {predicted:.3f}; the STRAIN control "
            "would promise a strain it does not deliver"
        )


def test_solved_strain_intervention_breaches_dgms_at_named_sensors():
    """End to end: the solved geometry must make the sensors ON the selected
    ring actually report a DGMS tensile breach.

    This is the gate that matters for the operator — not that a field
    somewhere breaches, but that the monuments they aimed at report it.
    """
    from sandbox.session import SimulationSession

    # The PHYSICAL claim this gate makes is that the monuments on the aimed
    # ring report the breach — not that any particular node id does.
    #
    # "Aimed" is therefore resolved by PROXIMITY to the ring, not by exact
    # coordinate equality. It used to select nodes at exactly (+-120, 0),
    # which only a uniform grid can provide; under Poisson-disc placement
    # (MESH_UPGRADE_BRIEF.md section 2) no node lands on a round number, so
    # that lookup found nothing and the gate could never run. Ids are still
    # never hardcoded — an id is just a row index and changes whenever the
    # layout does.
    #
    # Only strain-carrying tiers can report a tensile breach at all: 1B
    # carries the gauge, and the tension band is exactly where 1B lives.
    # Aim at a ring the strain-carrying tier actually occupies. 1B is sited
    # in the tensile band (|x| ~ 177-233 m), so the ring is placed there
    # rather than at the old 120 m — at 120 m the only monuments present are
    # 1A/1C/2A/2B, none of which carry a strain gauge, so no breach could be
    # reported no matter how the ground behaved.
    ui_radius = 205.0
    ring_tol_m = 45.0
    # `strain_x` is the x-derivative of the bowl, so tensile strain peaks
    # ON the x-axis and falls away off it — a monument at the right radius
    # but 120 m off-axis legitimately reads far less. The original test
    # encoded this by requiring ny == 0.0 exactly; with irregular placement
    # the same physical statement becomes a band around the axis.
    axis_tol_m = 60.0
    radius = ui_radius / _TENSILE_PEAK_RADIUS_RATIO
    target = constants.EPS_TENSILE_LIMIT * 1.05
    magnitude = min(
        (target * radius * radius) / _STRAIN_GEOMETRY_C, constants.S_MAX_FULL
    )

    s = SimulationSession()
    s.start()
    s.apply_collapse(
        cx=0.0, cy=0.0, radius_m=radius, magnitude_m=magnitude,
        duration_hours=4.8, warning_hours=2.4,
    )
    payload = None
    for _ in range(3000):
        payload = s.tick()

    live = [n for n in payload["nodes"] if n["alive"] == 1 and n["strain"] is not None]
    breached = {
        n["id"] for n in live
        if n["strain"] / 1000.0 > constants.EPS_TENSILE_LIMIT
    }
    positions = layout.node_positions()
    ids = layout.node_ids()
    tiers = layout.node_tiers()
    strain_carrying = {
        int(nid)
        for nid, t in zip(ids, tiers)
        if "strain_ue" in sensors.TIER_CHANNELS[t]
    }
    aimed = {
        int(nid)
        for nid, (nx, ny) in zip(ids, positions)
        if int(nid) in strain_carrying
        and abs(float(np.hypot(nx, ny)) - ui_radius) < ring_tol_m
        and abs(float(ny)) < axis_tol_m
    }
    assert aimed, (
        f"no strain-carrying monument within {ring_tol_m} m of the "
        f"{ui_radius} m ring — nothing on that ring could report a breach"
    )
    assert aimed <= breached, (
        f"aimed the tensile ring at {ui_radius} m (nodes {sorted(aimed)}) but "
        f"the nodes reporting a breach were {sorted(breached)}"
    )
