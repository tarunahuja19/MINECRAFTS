"""Physics-Informed Neural Network (PINN) loss engine and non-circular physics prior.

Non-negotiable Invariant:
Physics prior uses learnable scalars (a_hat, c_hat) so the PINN does not circularly regress
on the exact answer key when sensors are disconnected (§4).
"""
from typing import Any
import numpy as np
import torch
import torch.nn as nn
from ground.surface import knothe_surface_torch


class PhysicsPrior(nn.Module):
    """Learnable physics parameters for the Knothe solution family.

    Constrains the family while data picks the member.
    """

    def __init__(self):
        super().__init__()
        # Parameterized in unconstrained space, mapped smoothly to physical ranges:
        # a_hat in [0.10, 1.20] (true 0.65)
        # c_hat in [0.01, 0.35] (true 0.10)
        # Initialized away from ground truth per anti-circularity spec
        self.theta_a = nn.Parameter(torch.tensor(-0.7, dtype=torch.float32))  # a_hat ~ 0.46
        self.theta_c = nn.Parameter(torch.tensor(-0.5, dtype=torch.float32))  # c_hat ~ 0.14

    @property
    def a_hat(self) -> torch.Tensor:
        """Learnable subsidence factor a_hat in [0.10, 1.20]."""
        return 0.10 + 1.10 * torch.sigmoid(self.theta_a)

    @property
    def c_hat(self) -> torch.Tensor:
        """Learnable time constant c_hat in [0.01, 0.35] day^-1."""
        return 0.01 + 0.34 * torch.sigmoid(self.theta_c)


class PINNLossEngine:
    """Computes the 5-term physics and sensor loss."""

    def __init__(
        self,
        panel_config: dict[str, Any],
        w_anch: float = 100.0,
        n_collocation: int = 2000,
        domain_bounds: tuple[float, float, float, float] = (25.0, 775.0, 25.0, 375.0),
    ):
        self.panel_config = panel_config
        self.w_anch = w_anch
        self.n_collocation = n_collocation
        self.x_min, self.x_max, self.y_min, self.y_max = domain_bounds
        self.B = float(panel_config.get("B", 30.0))

    def sample_collocation_points(self, t_current: float, device: torch.device) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Sample collocation points (x, y, t) across the physical space-time domain."""
        xc = torch.empty(self.n_collocation, 1, device=device).uniform_(self.x_min, self.x_max)
        yc = torch.empty(self.n_collocation, 1, device=device).uniform_(self.y_min, self.y_max)
        tc = torch.empty(self.n_collocation, 1, device=device).uniform_(0.0, 40.0)
        return xc, yc, tc

    def compute_losses(
        self,
        model: nn.Module,
        prior: PhysicsPrior,
        epoch_obj: dict[str, Any],
        w_phys: float = 1.0,
    ) -> tuple[torch.Tensor, dict[str, float]]:
        """Compute the 5 loss terms and total weighted loss."""
        p = self.panel_config
        t_days = float(epoch_obj["t_days"])
        device = next(model.parameters()).device

        # ---------------- 1. OBSERVATIONS (Data Terms) ----------------
        valid_obs = [obs for obs in epoch_obj["observations"] if obs.get("tilt") is not None]

        loss_tilt = torch.tensor(0.0, device=device)
        loss_strain = torch.tensor(0.0, device=device)
        loss_ext = torch.tensor(0.0, device=device)

        if valid_obs:
            xA_list, yA_list = [], []
            xC_list, yC_list = [], []
            tilt_list, strain_list, ext_list = [], [], []
            e_hat_list = []

            for obs in valid_obs:
                xA, yA = obs["xy"]
                xC, yC = obs["ext_line"][1]
                dx, dy = xC - xA, yC - yA
                L = np.hypot(dx, dy)
                ex, ey = (dx / L, dy / L) if L > 0 else (0.0, 1.0)

                xA_list.append(xA)
                yA_list.append(yA)
                xC_list.append(xC)
                yC_list.append(yC)
                tilt_list.append(obs["tilt"])
                strain_list.append(obs["strain"])
                ext_list.append(obs["ext_delta_m"])
                e_hat_list.append([ex, ey])

            x_t = torch.tensor(xA_list, dtype=torch.float32, device=device).unsqueeze(-1).requires_grad_(True)
            y_t = torch.tensor(yA_list, dtype=torch.float32, device=device).unsqueeze(-1).requires_grad_(True)
            t_t = torch.full_like(x_t, t_days)

            # Forward pass at Peg A
            S_A = model(x_t, y_t, t_t)

            # Autograd First Derivatives: grad_S = [dS/dx, dS/dy]
            grad_x = torch.autograd.grad(S_A.sum(), x_t, create_graph=True)[0]
            grad_y = torch.autograd.grad(S_A.sum(), y_t, create_graph=True)[0]

            # Autograd Second Derivatives: Hessian
            H_xx = torch.autograd.grad(grad_x.sum(), x_t, create_graph=True)[0]
            H_yy = torch.autograd.grad(grad_y.sum(), y_t, create_graph=True)[0]
            H_xy = torch.autograd.grad(grad_x.sum(), y_t, create_graph=True)[0]

            # Tilt Loss
            tilt_target = torch.tensor(tilt_list, dtype=torch.float32, device=device)
            grad_pred = torch.cat([grad_x, grad_y], dim=-1)
            loss_tilt = torch.mean((grad_pred - tilt_target) ** 2) * 5e3

            # Strain Loss: eps = -B * (e^T H e)
            e_hat = torch.tensor(e_hat_list, dtype=torch.float32, device=device)
            ex = e_hat[:, 0:1]
            ey = e_hat[:, 1:2]
            curvature = ex * ex * H_xx + 2.0 * ex * ey * H_xy + ey * ey * H_yy
            strain_pred = -self.B * curvature

            strain_target = torch.tensor(strain_list, dtype=torch.float32, device=device).unsqueeze(-1)
            loss_strain = torch.mean((strain_pred - strain_target) ** 2) * 5e5

            # Extensometer Loss: Delta = (U(C) - U(A)) . e_hat, where U = -B * grad_S
            xC_t = torch.tensor(xC_list, dtype=torch.float32, device=device).unsqueeze(-1).requires_grad_(True)
            yC_t = torch.tensor(yC_list, dtype=torch.float32, device=device).unsqueeze(-1).requires_grad_(True)
            S_C = model(xC_t, yC_t, t_t)
            grad_xC = torch.autograd.grad(S_C.sum(), xC_t, create_graph=True)[0]
            grad_yC = torch.autograd.grad(S_C.sum(), yC_t, create_graph=True)[0]

            Ux_A, Uy_A = -self.B * grad_x, -self.B * grad_y
            Ux_C, Uy_C = -self.B * grad_xC, -self.B * grad_yC
            ext_pred = (Ux_C - Ux_A) * ex + (Uy_C - Uy_A) * ey

            ext_target = torch.tensor(ext_list, dtype=torch.float32, device=device).unsqueeze(-1)
            loss_ext = torch.mean((ext_pred - ext_target) ** 2) * 5e3

        # ---------------- 2. ANCHOR LOSS ----------------
        anchors = epoch_obj.get("anchors", [])
        if anchors:
            x_anc = torch.tensor([a["xy"][0] for a in anchors], dtype=torch.float32, device=device).unsqueeze(-1)
            y_anc = torch.tensor([a["xy"][1] for a in anchors], dtype=torch.float32, device=device).unsqueeze(-1)
            t_anc = torch.full_like(x_anc, t_days)
            S_anc = model(x_anc, y_anc, t_anc)
            loss_anch = torch.mean(S_anc ** 2) * self.w_anch
        else:
            loss_anch = torch.tensor(0.0, device=device)

        # ---------------- 3. PHYSICS PRIOR COLLOCATION LOSS ----------------
        xc, yc, tc = self.sample_collocation_points(t_days, device)
        S_pred_colloc = model(xc, yc, tc)

        thickness_m = float(p.get("thickness_m") or p.get("seam_thickness_m", 3.0))
        depth_m = float(p.get("depth_m", 150.0))
        tan_beta = float(p.get("tan_beta", 2.0))
        x1 = float(p.get("x1", 100.0))
        y1 = float(p.get("y1", 100.0))
        x2 = float(p.get("x2", 700.0))
        y2 = float(p.get("y2", 300.0))

        S_prior_colloc = knothe_surface_torch(
            x=xc,
            y=yc,
            t=tc,
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            depth_m=depth_m,
            thickness_m=thickness_m,
            tan_beta=tan_beta,
            a=prior.a_hat,
            c=prior.c_hat,
        )
        loss_phys = torch.mean((S_pred_colloc - S_prior_colloc) ** 2) * 10.0

        # Total combined loss
        total_loss = (
            loss_tilt
            + loss_strain
            + loss_ext
            + loss_anch
            + w_phys * loss_phys
        )

        loss_dict = {
            "loss_total": float(total_loss.detach().cpu().item()),
            "loss_tilt": float(loss_tilt.detach().cpu().item()),
            "loss_strain": float(loss_strain.detach().cpu().item()),
            "loss_ext": float(loss_ext.detach().cpu().item()),
            "loss_anch": float(loss_anch.detach().cpu().item()),
            "loss_phys": float(loss_phys.detach().cpu().item()),
        }

        return total_loss, loss_dict
