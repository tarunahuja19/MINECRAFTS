"""Physics-Informed Neural Network (PINN) model architecture for ground subsidence.

Shape:
(x, y, t) -> [64] (tanh) -> [64] (tanh) -> [64] (tanh) -> [64] (tanh) -> S (m)
Parameter count: ~12,800 parameters (~13k).
"""
import torch
import torch.nn as nn


class SubsidencePINN(nn.Module):
    """13k-parameter fully-connected MLP mapping (x, y, t) to ground subsidence S(x, y, t)."""

    def __init__(
        self,
        x_center: float = 400.0,
        x_scale: float = 375.0,
        y_center: float = 200.0,
        y_scale: float = 175.0,
        t_scale: float = 40.0,
    ):
        super().__init__()
        self.x_center = x_center
        self.x_scale = x_scale
        self.y_center = y_center
        self.y_scale = y_scale
        self.t_scale = t_scale

        self.net = nn.Sequential(
            nn.Linear(3, 64),
            nn.Tanh(),
            nn.Linear(64, 64),
            nn.Tanh(),
            nn.Linear(64, 64),
            nn.Tanh(),
            nn.Linear(64, 64),
            nn.Tanh(),
            nn.Linear(64, 1),
        )

        self._init_weights()

    def _init_weights(self):
        """Xavier normal initialization tailored for tanh activations."""
        for m in self.net.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_normal_(m.weight, gain=1.0)
                nn.init.constant_(m.bias, 0.0)

    def forward(self, x: torch.Tensor, y: torch.Tensor, t: torch.Tensor) -> torch.Tensor:
        """Forward pass predicting subsidence S in metres (positive downward).

        Args:
            x: Tensor of x coordinates (m)
            y: Tensor of y coordinates (m)
            t: Tensor of time (days)
        Returns:
            Tensor of S (m)
        """
        x_n = (x - self.x_center) / self.x_scale
        y_n = (y - self.y_center) / self.y_scale
        t_n = t / self.t_scale

        inp = torch.cat([x_n, y_n, t_n], dim=-1)
        s_out = self.net(inp)
        return s_out
