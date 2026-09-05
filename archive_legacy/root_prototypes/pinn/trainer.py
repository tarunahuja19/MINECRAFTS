"""Background PINN trainer thread running warm-started Adam steps and updating SurfaceBuffer.

Non-negotiable Invariants:
- I4: Only writes into SurfaceBuffer; never touches VTK actors.
- Measures retrain_ms precisely to answer Q1.
- Warm-starts weights between consecutive epochs for continuous deformation.
"""
import queue
import threading
import time
from typing import Any
import numpy as np
import torch
import torch.optim as optim

from pinn.losses import PINNLossEngine, PhysicsPrior
from pinn.model import SubsidencePINN
from scoring.score import SubsidenceScorer
from viz.buffer import SurfaceBuffer
from viz.controls import ControlState


class PINNTrainer(threading.Thread):
    """Worker thread that continuously pulls epochs, optimizes the PINN, and writes surfaces."""

    def __init__(
        self,
        config: dict[str, Any],
        epoch_queue: queue.Queue,
        surface_buffer: SurfaceBuffer,
        control_state: ControlState,
        lr: float = 1e-3,
    ):
        super().__init__(daemon=True, name="PINNTrainerThread")
        self.config = config
        self.epoch_queue = epoch_queue
        self.buffer = surface_buffer
        self.state = control_state
        self.lr = lr

        self.device = torch.device("cpu")
        self.model = SubsidencePINN().to(self.device)
        self.prior = PhysicsPrior().to(self.device)

        self.loss_engine = PINNLossEngine(config["panel"])
        self.scorer = SubsidenceScorer()

        self.optimizer = optim.Adam([
            {"params": self.model.parameters(), "lr": self.lr},
            {"params": self.prior.parameters(), "lr": 2e-2},
        ])

        # Precompute 64x64 evaluation grid
        grid_cfg = config["grid"]
        x_lin = np.linspace(grid_cfg["x_min"], grid_cfg["x_max"], grid_cfg["nx"], dtype=np.float32)
        y_lin = np.linspace(grid_cfg["y_min"], grid_cfg["y_max"], grid_cfg["ny"], dtype=np.float32)
        self.X_grid, self.Y_grid = np.meshgrid(x_lin, y_lin)

        self.x_eval_t = torch.tensor(self.X_grid.ravel(), dtype=torch.float32, device=self.device).unsqueeze(-1)
        self.y_eval_t = torch.tensor(self.Y_grid.ravel(), dtype=torch.float32, device=self.device).unsqueeze(-1)

        self.last_t_days: float = 0.0
        self.running: bool = True
        self.retrain_history_ms: list[float] = []

    def train_epoch(self, epoch_obj: dict[str, Any]) -> dict[str, Any]:
        """Perform warm-started Adam steps on a single epoch object."""
        t_days = float(epoch_obj["t_days"])
        steps = max(20, self.state.retrain_steps)
        w_phys = max(0.0, self.state.physics_weight)

        # Handle backward time seek: reset optimizer momentum buffers (Trap 8)
        if t_days < self.last_t_days:
            self.optimizer = optim.Adam([
                {"params": self.model.parameters(), "lr": self.lr},
                {"params": self.prior.parameters(), "lr": 2e-2},
            ])

        # Handle explicit PINN weight reset
        if self.state.clear_action("reset_pinn"):
            self.model._init_weights()
            self.prior = PhysicsPrior().to(self.device)
            self.optimizer = optim.Adam([
                {"params": self.model.parameters(), "lr": self.lr},
                {"params": self.prior.parameters(), "lr": 2e-2},
            ])
            print(">>> [TRAINER] PINN Weights and Optimizer Reinitialized")

        self.last_t_days = t_days

        t0 = time.perf_counter()

        # Training loop
        last_loss_dict = {}
        for step in range(steps):
            self.optimizer.zero_grad()
            total_loss, loss_dict = self.loss_engine.compute_losses(
                self.model, self.prior, epoch_obj, w_phys=w_phys
            )
            total_loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=5.0)
            self.optimizer.step()
            last_loss_dict = loss_dict

        # Forward pass on 64x64 grid
        t_eval_t = torch.full_like(self.x_eval_t, t_days)
        with torch.no_grad():
            s_pred_t = self.model(self.x_eval_t, self.y_eval_t, t_eval_t)
            s_pred_np = s_pred_t.cpu().numpy().reshape(self.X_grid.shape)

        retrain_ms = (time.perf_counter() - t0) * 1000.0
        self.retrain_history_ms.append(retrain_ms)

        # Evaluate honest score vs truth via SubsidenceScorer
        score_res = self.scorer.score_grid(s_pred_np, self.X_grid, self.Y_grid, t_days)

        # Extract node alive/alarming states from observations
        node_states = {}
        for obs in epoch_obj.get("observations", []):
            nid = obs.get("node_id") or obs.get("id")
            is_alive = obs.get("tilt") is not None
            strain = obs.get("strain") if obs.get("strain") is not None else 0.0
            alarming = abs(strain) > 0.0003
            node_states[nid] = {"alive": is_alive, "alarming": alarming, "strain": strain}

        meta = {
            "epoch_id": epoch_obj["epoch_id"],
            "t_days": t_days,
            "nodes_reporting": epoch_obj["quality"]["nodes_reporting"],
            "nodes_expected": epoch_obj["quality"]["nodes_expected"],
            "rmse_mm": score_res["rmse_mm"],
            "max_err_mm": score_res["max_err_mm"],
            "mae_mm": score_res["mae_mm"],
            "truth_z": score_res["truth_z"],
            "a_hat": float(self.prior.a_hat.detach().cpu().item()),
            "a_true": float(self.config["panel"].get("a", 0.65)),
            "c_hat": float(self.prior.c_hat.detach().cpu().item()),
            "c_true": float(self.config["panel"].get("c", 0.10)),
            "retrain_ms": retrain_ms,
            "queue_lag": self.epoch_queue.qsize(),
            "node_states": node_states,
            **last_loss_dict,
        }

        # Write into locked surface buffer
        self.buffer.write(s_pred_np, meta)
        return meta

    def run(self) -> None:
        """Main trainer loop continuously processing incoming epochs."""
        while self.running:
            try:
                epoch_obj = self.epoch_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            self.train_epoch(epoch_obj)
            self.epoch_queue.task_done()

    def stop(self) -> None:
        """Signal trainer thread to terminate."""
        self.running = False
