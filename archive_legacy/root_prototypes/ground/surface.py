"""Analytic Knothe ground subsidence model and derivative kinematics.

Non-negotiable Invariant I1:
There is EXACTLY ONE implementation of S(x, y, t) in this file.
Tilt, strain, extensometer, and displacement are all derived from it analytically.
No second formula, anywhere, ever.

Sign convention (Invariant I6):
- Subsidence S is defined POSITIVE DOWNWARD (metres, >= 0).
- In the 3D renderer, z = -S * exaggeration.
- Tilt T = grad(S) (rad, vector pointing in direction of increasing subsidence).
- Horizontal displacement U = -B * grad(S) (metres, vector pulling inward toward bowl).
- Strain epsilon = -B * (e^T H e) (dimensionless; positive = tensile, negative = compressive).
- Extensometer delta = (U(C) - U(A)) . e (metres; positive = elongation, negative = shortening).
"""
from dataclasses import dataclass
import numpy as np
from scipy.special import erf as sp_erf
import torch


@dataclass(frozen=True)
class KnotheParameters:
    """Parameters for the Knothe subsidence calculation."""
    x1: float = 100.0  # Panel left boundary (m)
    y1: float = 100.0  # Panel bottom boundary (m)
    x2: float = 700.0  # Panel right boundary (m)
    y2: float = 300.0  # Panel top boundary (m)
    depth_m: float = 150.0  # Seam depth (m)
    thickness_m: float = 3.0  # Seam thickness mined (m)
    tan_beta: float = 2.0  # Rock transmission factor tan(beta)
    a: float = 0.65  # Subsidence factor
    c: float = 0.10  # Time rate constant (day^-1)
    B: float = 30.0  # Horizontal displacement coefficient B (m)

    @property
    def r(self) -> float:
        """Influence radius r = depth / tan(beta) (m)."""
        return self.depth_m / self.tan_beta

    @property
    def S_max(self) -> float:
        """Maximum asymptotic subsidence S_max = a * thickness (m)."""
        return self.a * self.thickness_m


class GroundModel:
    """The single ground truth calculation engine for subsidence and derived sensors."""

    def __init__(self, params: KnotheParameters | None = None):
        self.params = params or KnotheParameters()

    def S(self, x: np.ndarray | float, y: np.ndarray | float, t: np.ndarray | float) -> np.ndarray | float:
        """Compute subsidence S(x, y, t) in metres, POSITIVE DOWNWARD.

        Formula:
            r = depth / tan_beta
            S_max = a * thickness
            f(x) = 0.5 * [erf(sqrt(pi)*(x - x1)/r) - erf(sqrt(pi)*(x - x2)/r)]
            g(y) = 0.5 * [erf(sqrt(pi)*(y - y1)/r) - erf(sqrt(pi)*(y - y2)/r)]
            T(t) = 1 - exp(-c * t)  (for t >= 0, 0 otherwise)
            S(x, y, t) = S_max * f(x) * g(y) * T(t)
        """
        p = self.params
        r = p.r
        sqrt_pi = np.sqrt(np.pi)

        # Time factor T(t)
        t_arr = np.asarray(t, dtype=np.float64)
        T_val = np.where(t_arr > 0, 1.0 - np.exp(-p.c * t_arr), 0.0)

        # Spatial factors f(x) and g(y)
        u1_x = sqrt_pi * (x - p.x1) / r
        u2_x = sqrt_pi * (x - p.x2) / r
        f_x = 0.5 * (sp_erf(u1_x) - sp_erf(u2_x))

        u1_y = sqrt_pi * (y - p.y1) / r
        u2_y = sqrt_pi * (y - p.y2) / r
        g_y = 0.5 * (sp_erf(u1_y) - sp_erf(u2_y))

        s = p.S_max * f_x * g_y * T_val
        return s

    def grad_S(self, x: np.ndarray | float, y: np.ndarray | float, t: np.ndarray | float) -> tuple[np.ndarray, np.ndarray]:
        """Compute spatial gradient [dS/dx, dS/dy] of subsidence (rad, vector).

        Sign convention: Positive in direction of increasing subsidence (inward toward bowl).
        """
        p = self.params
        r = p.r
        sqrt_pi = np.sqrt(np.pi)

        t_arr = np.asarray(t, dtype=np.float64)
        T_val = np.where(t_arr > 0, 1.0 - np.exp(-p.c * t_arr), 0.0)

        # f(x) and f'(x)
        u1_x = sqrt_pi * (x - p.x1) / r
        u2_x = sqrt_pi * (x - p.x2) / r
        f_x = 0.5 * (sp_erf(u1_x) - sp_erf(u2_x))
        df_dx = (1.0 / r) * (np.exp(-np.pi * ((x - p.x1) / r) ** 2) - np.exp(-np.pi * ((x - p.x2) / r) ** 2))

        # g(y) and g'(y)
        u1_y = sqrt_pi * (y - p.y1) / r
        u2_y = sqrt_pi * (y - p.y2) / r
        g_y = 0.5 * (sp_erf(u1_y) - sp_erf(u2_y))
        dg_dy = (1.0 / r) * (np.exp(-np.pi * ((y - p.y1) / r) ** 2) - np.exp(-np.pi * ((y - p.y2) / r) ** 2))

        dS_dx = p.S_max * df_dx * g_y * T_val
        dS_dy = p.S_max * f_x * dg_dy * T_val
        return dS_dx, dS_dy

    def hess_S(self, x: np.ndarray | float, y: np.ndarray | float, t: np.ndarray | float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Compute Hessian components (d2S/dx2, d2S/dy2, d2S/dxdy).

        Returns:
            (H_xx, H_yy, H_xy)
        """
        p = self.params
        r = p.r
        sqrt_pi = np.sqrt(np.pi)

        t_arr = np.asarray(t, dtype=np.float64)
        T_val = np.where(t_arr > 0, 1.0 - np.exp(-p.c * t_arr), 0.0)

        u1_x = sqrt_pi * (x - p.x1) / r
        u2_x = sqrt_pi * (x - p.x2) / r
        f_x = 0.5 * (sp_erf(u1_x) - sp_erf(u2_x))
        df_dx = (1.0 / r) * (np.exp(-np.pi * ((x - p.x1) / r) ** 2) - np.exp(-np.pi * ((x - p.x2) / r) ** 2))
        d2f_dx2 = (-2.0 * np.pi / (r ** 3)) * (
            (x - p.x1) * np.exp(-np.pi * ((x - p.x1) / r) ** 2)
            - (x - p.x2) * np.exp(-np.pi * ((x - p.x2) / r) ** 2)
        )

        u1_y = sqrt_pi * (y - p.y1) / r
        u2_y = sqrt_pi * (y - p.y2) / r
        g_y = 0.5 * (sp_erf(u1_y) - sp_erf(u2_y))
        dg_dy = (1.0 / r) * (np.exp(-np.pi * ((y - p.y1) / r) ** 2) - np.exp(-np.pi * ((y - p.y2) / r) ** 2))
        d2g_dy2 = (-2.0 * np.pi / (r ** 3)) * (
            (y - p.y1) * np.exp(-np.pi * ((y - p.y1) / r) ** 2)
            - (y - p.y2) * np.exp(-np.pi * ((y - p.y2) / r) ** 2)
        )

        H_xx = p.S_max * d2f_dx2 * g_y * T_val
        H_yy = p.S_max * f_x * d2g_dy2 * T_val
        H_xy = p.S_max * df_dx * dg_dy * T_val
        return H_xx, H_yy, H_xy

    def displacement(self, x: np.ndarray | float, y: np.ndarray | float, t: np.ndarray | float) -> tuple[np.ndarray, np.ndarray]:
        """Compute horizontal displacement vector U = -B * grad(S) (m)."""
        dS_dx, dS_dy = self.grad_S(x, y, t)
        Ux = -self.params.B * dS_dx
        Uy = -self.params.B * dS_dy
        return Ux, Uy

    def tilt(self, x: np.ndarray | float, y: np.ndarray | float, t: np.ndarray | float) -> tuple[np.ndarray, np.ndarray]:
        """Compute tilt vector T = grad(S) (rad)."""
        return self.grad_S(x, y, t)

    def strain_along(self, x: np.ndarray | float, y: np.ndarray | float, t: np.ndarray | float, e_hat: tuple[float, float] = (0.0, 1.0)) -> np.ndarray | float:
        """Compute ground strain along unit vector e_hat: eps = -B * (e^T H e) (dimensionless).

        Sign convention: Positive = tensile (extension), Negative = compressive (squeezing).
        """
        ex, ey = e_hat
        norm = np.hypot(ex, ey)
        if norm > 0:
            ex /= norm
            ey /= norm
        H_xx, H_yy, H_xy = self.hess_S(x, y, t)
        curvature = ex * ex * H_xx + 2.0 * ex * ey * H_xy + ey * ey * H_yy
        eps = -self.params.B * curvature
        return eps

    def ext_delta(self, pt_A: tuple[float, float], pt_C: tuple[float, float], t: np.ndarray | float) -> np.ndarray | float:
        """Compute extensometer change in length between peg A and peg C (m).

        Delta = (U(C) - U(A)) . e_hat
        Exact equality with line integral of strain: Delta = int_A^C eps(s) ds.
        """
        xA, yA = pt_A
        xC, yC = pt_C
        dx = xC - xA
        dy = yC - yA
        L = np.hypot(dx, dy)
        if L == 0:
            return 0.0
        ex = dx / L
        ey = dy / L

        Ux_A, Uy_A = self.displacement(xA, yA, t)
        Ux_C, Uy_C = self.displacement(xC, yC, t)

        delta = (Ux_C - Ux_A) * ex + (Uy_C - Uy_A) * ey
        return delta


# PyTorch / differentiable path for PINN loss physics prior
def knothe_surface_torch(
    x: torch.Tensor,
    y: torch.Tensor,
    t: torch.Tensor,
    x1: float = 100.0,
    y1: float = 100.0,
    x2: float = 700.0,
    y2: float = 300.0,
    depth_m: float = 150.0,
    thickness_m: float = 3.0,
    tan_beta: float = 2.0,
    a: torch.Tensor | float = 0.65,
    c: torch.Tensor | float = 0.10,
) -> torch.Tensor:
    """Differentiable PyTorch Knothe subsidence surface for physics prior."""
    r = depth_m / tan_beta
    sqrt_pi = np.sqrt(np.pi)

    if isinstance(a, torch.Tensor):
        S_max = a * thickness_m
    else:
        S_max = torch.tensor(a * thickness_m, dtype=x.dtype, device=x.device)

    # Time factor T(t) = 1 - exp(-c * t)
    T_val = torch.clamp(1.0 - torch.exp(-c * t), min=0.0)

    # Spatial factors f(x) and g(y) using torch.erf
    u1_x = sqrt_pi * (x - x1) / r
    u2_x = sqrt_pi * (x - x2) / r
    f_x = 0.5 * (torch.erf(u1_x) - torch.erf(u2_x))

    u1_y = sqrt_pi * (y - y1) / r
    u2_y = sqrt_pi * (y - y2) / r
    g_y = 0.5 * (torch.erf(u1_y) - torch.erf(u2_y))

    return S_max * f_x * g_y * T_val
