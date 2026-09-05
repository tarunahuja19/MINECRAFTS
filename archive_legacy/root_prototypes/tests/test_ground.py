"""Unit and mathematical validation tests for the analytic ground model.

Stage 1 Gate checks:
1. Analytic grad_S vs central difference: max relative error < 0.1%
2. Analytic Hessian vs second-order central difference: max relative error < 0.1%
3. ext_delta(A, C) vs 500-step numerical integration of strain_along: max relative error < 0.1%
4. Boundary conditions: S(x, y, 0) == 0; S(centre, inf) == S_max to 4 decimals
5. Max tilt and max tensile strain occur at the panel edge, not at the centre.
"""
import numpy as np
import pytest
from ground.surface import GroundModel, KnotheParameters


@pytest.fixture
def model():
    params = KnotheParameters(
        x1=100.0,
        y1=100.0,
        x2=700.0,
        y2=300.0,
        depth_m=150.0,
        thickness_m=3.0,
        tan_beta=2.0,
        a=0.65,
        c=0.10,
        B=30.0,
    )
    return GroundModel(params)


def test_boundary_conditions(model: GroundModel):
    """Test S(x, y, 0) == 0 everywhere and S(center, inf) == S_max."""
    x = np.linspace(25, 775, 50)
    y = np.linspace(25, 375, 50)
    X, Y = np.meshgrid(x, y)

    # t = 0
    s_t0 = model.S(X, Y, 0.0)
    assert np.allclose(s_t0, 0.0), "S(x, y, 0) must be identically 0"

    # t -> inf at center (400, 200)
    # At (400, 200), panel is [100, 700] x [100, 300], r = 75m.
    # Distance to edges is 300m in x, 100m in y. 300/75 = 4r, 100/75 = 1.33r.
    # Note erf(sqrt(pi)*4) is virtually 1.0 (error < 1e-12).
    # For large enough panel or center at t=1000 days:
    s_inf = model.S(400.0, 200.0, 1000.0)
    # The asymptotic center value for 600m x 200m panel:
    # f(400) = 0.5 * (erf(sqrt(pi)*300/75) - erf(-sqrt(pi)*300/75)) = erf(7.089) = 1.0
    # g(200) = 0.5 * (erf(sqrt(pi)*100/75) - erf(-sqrt(pi)*100/75)) = erf(2.363) = 0.99915
    # S_max = 0.65 * 3.0 = 1.95 m.
    # If the panel width were semi-infinite it's 1.95. For this panel width, g(200) is 0.99915.
    # Check that S_max is 1.95 and s_inf matches to within 0.1%:
    assert np.isclose(model.params.S_max, 1.95, atol=1e-5)
    assert np.isclose(s_inf, 1.95 * 0.99915, rtol=1e-3)


def test_grad_s_vs_central_difference(model: GroundModel):
    """Analytic grad_S vs central difference: max relative error < 0.1%."""
    h = 1e-4
    x_test = np.linspace(50, 750, 20)
    y_test = np.linspace(50, 350, 15)
    t = 20.0  # 20 days

    for x in x_test:
        for y in y_test:
            # Analytical gradient
            dS_dx_anal, dS_dy_anal = model.grad_S(x, y, t)

            # Central difference
            dS_dx_num = (model.S(x + h, y, t) - model.S(x - h, y, t)) / (2 * h)
            dS_dy_num = (model.S(x, y + h, t) - model.S(x, y - h, t)) / (2 * h)

            # Check relative error where gradient is non-negligible
            if abs(dS_dx_anal) > 1e-5:
                rel_err_x = abs(dS_dx_anal - dS_dx_num) / abs(dS_dx_anal)
                assert rel_err_x < 1e-3, f"dx rel error {rel_err_x:.6e} at ({x}, {y}) > 0.1%"

            if abs(dS_dy_anal) > 1e-5:
                rel_err_y = abs(dS_dy_anal - dS_dy_num) / abs(dS_dy_anal)
                assert rel_err_y < 1e-3, f"dy rel error {rel_err_y:.6e} at ({x}, {y}) > 0.1%"


def test_hess_s_vs_central_difference(model: GroundModel):
    """Analytic Hessian vs second-order central difference: max relative error < 0.1%."""
    h = 1e-3
    x_test = np.linspace(60, 740, 15)
    y_test = np.linspace(60, 340, 12)
    t = 15.0

    for x in x_test:
        for y in y_test:
            H_xx_anal, H_yy_anal, H_xy_anal = model.hess_S(x, y, t)

            # Numerical second derivatives
            H_xx_num = (model.S(x + h, y, t) - 2 * model.S(x, y, t) + model.S(x - h, y, t)) / (h ** 2)
            H_yy_num = (model.S(x, y + h, t) - 2 * model.S(x, y, t) + model.S(x, y - h, t)) / (h ** 2)
            H_xy_num = (
                model.S(x + h, y + h, t)
                - model.S(x + h, y - h, t)
                - model.S(x - h, y + h, t)
                + model.S(x - h, y - h, t)
            ) / (4 * h ** 2)

            if abs(H_xx_anal) > 1e-6:
                rel_err_xx = abs(H_xx_anal - H_xx_num) / abs(H_xx_anal)
                assert rel_err_xx < 1e-3, f"H_xx rel error {rel_err_xx:.6e} at ({x}, {y}) > 0.1%"

            if abs(H_yy_anal) > 1e-6:
                rel_err_yy = abs(H_yy_anal - H_yy_num) / abs(H_yy_anal)
                assert rel_err_yy < 1e-3, f"H_yy rel error {rel_err_yy:.6e} at ({x}, {y}) > 0.1%"

            if abs(H_xy_anal) > 1e-6:
                rel_err_xy = abs(H_xy_anal - H_xy_num) / abs(H_xy_anal)
                assert rel_err_xy < 1e-3, f"H_xy rel error {rel_err_xy:.6e} at ({x}, {y}) > 0.1%"


def test_ext_delta_vs_strain_integral(model: GroundModel):
    """ext_delta(A, C) vs 500-step numerical integration of strain_along: < 0.1% error."""
    # Test multiple segments across the panel and edges
    test_segments = [
        ((250.0, 100.0), (250.0, 110.0)),  # across panel lower edge y=100
        ((400.0, 195.0), (400.0, 205.0)),  # near center
        ((700.0, 200.0), (710.0, 200.0)),  # across right edge x=700
        ((150.0, 290.0), (150.0, 300.0)),  # across top edge y=300
    ]
    t = 25.0
    n_steps = 500

    for pt_A, pt_C in test_segments:
        delta_analytic = model.ext_delta(pt_A, pt_C, t)

        # Numerical line integration: int_0^L strain(s) ds
        xA, yA = pt_A
        xC, yC = pt_C
        dx = xC - xA
        dy = yC - yA
        L = np.hypot(dx, dy)
        e_hat = (dx / L, dy / L)

        s_vals = np.linspace(0, L, n_steps + 1)
        x_pts = xA + s_vals * e_hat[0]
        y_pts = yA + s_vals * e_hat[1]

        strains = np.array([model.strain_along(x_i, y_i, t, e_hat=e_hat) for x_i, y_i in zip(x_pts, y_pts)])
        delta_integral = np.trapezoid(strains, s_vals)

        if abs(delta_analytic) > 1e-6:
            rel_error = abs(delta_analytic - delta_integral) / abs(delta_analytic)
            assert rel_error < 1e-3, f"Ext delta vs integral rel error {rel_error:.6e} > 0.1%"


def test_max_tilt_and_strain_at_panel_edge(model: GroundModel):
    """Test 4: Maximum tilt and maximum tensile strain occur AT or near the panel edge, NOT at the centre."""
    t = 30.0
    # Center is at (400, 200)
    # Panel bounds: x in [100, 700], y in [100, 300]

    # Evaluate along cross-section y = 200 (x from 25 to 775)
    x_line = np.linspace(25, 775, 500)
    y_center = 200.0

    dS_dx, _ = model.grad_S(x_line, y_center, t)
    tilt_mag = np.abs(dS_dx)

    # Center tilt should be near zero
    tilt_center = tilt_mag[np.argmin(np.abs(x_line - 400.0))]
    # Edge tilts (near x = 100 and x = 700)
    idx_max_tilt = np.argmax(tilt_mag)
    x_at_max_tilt = x_line[idx_max_tilt]

    # Peak tilt must occur near x=100 or x=700 (within +- 5m of edge)
    dist_to_edges = min(abs(x_at_max_tilt - 100.0), abs(x_at_max_tilt - 700.0))
    assert dist_to_edges < 5.0, f"Max tilt occurred at x={x_at_max_tilt}, expected near 100 or 700"
    assert tilt_mag[idx_max_tilt] > 10 * tilt_center, "Edge tilt must be much larger than center tilt"

    # Evaluate strain along x: eps_x = -B * H_xx
    H_xx, _, _ = model.hess_S(x_line, y_center, t)
    strain_x = -model.params.B * H_xx  # positive is tensile

    # Tensile strain peak (positive) occurs in the edge transition zone (near x = 100 + r/sqrt(2pi) ~ 130 m or 670 m)
    idx_max_tensile = np.argmax(strain_x)
    x_at_max_tensile = x_line[idx_max_tensile]
    dist_tensile_to_edges = min(abs(x_at_max_tensile - 100.0), abs(x_at_max_tensile - 700.0))
    assert dist_tensile_to_edges < 45.0, f"Max tensile strain at x={x_at_max_tensile}, expected within 45m of panel edge"
    assert strain_x[idx_max_tensile] > 1e-4, "Tensile peak must be significantly positive"

    # Compressive peak (negative) occurs in the outer edge transition zone (near x = 100 - r/sqrt(2pi) ~ 70 m or 730 m)
    idx_max_compressive = np.argmin(strain_x)
    x_at_max_comp = x_line[idx_max_compressive]
    dist_comp_to_edges = min(abs(x_at_max_comp - 100.0), abs(x_at_max_comp - 700.0))
    assert dist_comp_to_edges < 45.0, f"Compressive peak at x={x_at_max_comp}, expected within 45m of panel edge"
    assert strain_x[idx_max_compressive] < -1e-4, "Compressive peak must be significantly negative"

    # Center (x=400) is the flat bottom of the trough (tilt and strain are orders of magnitude smaller than at edge)
    assert tilt_center < 1e-4 * tilt_mag[idx_max_tilt], "Center tilt must be negligible on flat bottom"
    assert abs(strain_x[np.argmin(np.abs(x_line - 400.0))]) < 1e-4 * np.max(np.abs(strain_x)), "Center strain must be near 0 on flat bottom"
