"""On-screen 2D HUD instrument panel (top-left monospace overlay)."""
from typing import Any
import pyvista as pv


class InstrumentHUD:
    """Manages the top-left monospace telemetry and metrics text overlay."""

    def __init__(self, plotter: pv.Plotter):
        self.plotter = plotter
        self.text_actor = self.plotter.add_text(
            self._format_hud_text({}),
            position="upper_left",
            font_size=10,
            font="courier",
            color="white",
            shadow=False,
            name="hud_instrument_panel",
        )

    def _format_hud_text(self, data: dict[str, Any]) -> str:
        epoch = data.get("epoch_id", 0)
        t_days = data.get("t_days", 0.0)
        nodes_rep = data.get("nodes_reporting", 30)
        nodes_exp = data.get("nodes_expected", 30)
        dead = nodes_exp - nodes_rep

        rmse_mm = data.get("rmse_mm", 0.0)
        max_err_mm = data.get("max_err_mm", 0.0)
        a_hat = data.get("a_hat", 0.650)
        a_true = data.get("a_true", 0.650)
        c_hat = data.get("c_hat", 0.100)
        c_true = data.get("c_true", 0.100)

        l_tilt = data.get("loss_tilt", 0.0)
        l_strain = data.get("loss_strain", 0.0)
        l_ext = data.get("loss_ext", 0.0)
        l_anch = data.get("loss_anch", 0.0)
        l_phys = data.get("loss_phys", 0.0)

        retrain_ms = data.get("retrain_ms", 0.0)
        queue_lag = data.get("queue_lag", 0)
        fps = data.get("fps", 0.0)
        exag = data.get("exaggeration", 100.0)

        lines = [
            f"=== PINN 3D SUBSIDENCE SANDBOX ===",
            f"epoch      {epoch:<6d} t = {t_days:6.2f} d",
            f"nodes      {nodes_rep:2d}/{nodes_exp:2d}  ({dead} dead)",
            f"RMSE       {rmse_mm:5.1f} mm  max {max_err_mm:5.1f} mm",
            f"a_hat      {a_hat:5.3f}  (true {a_true:5.3f})",
            f"c_hat      {c_hat:5.3f}  (true {c_true:5.3f})",
            f"loss  tilt {l_tilt:6.4f}  strain {l_strain:6.4f}",
            f"      ext  {l_ext:6.4f}  anch   {l_anch:6.4f}  phys {l_phys:6.4f}",
            f"retrain    {retrain_ms:5.0f} ms  [Q1 METRIC]",
            f"queue lag  {queue_lag:1d} epoch",
            f"fps        {fps:4.1f}  | exag {exag:3.0f}x",
            f"----------------------------------",
            f"Keys: [T]ruth Ghost [E]rror Sheet",
            f"      [D]raw Cones  [X] Ext Lines",
            f"      [M] Terrain Theme [G] GIF",
        ]
        return "\n".join(lines)

    def update(self, data: dict[str, Any]) -> None:
        """Update HUD text overlay in place."""
        text = self._format_hud_text(data)
        if hasattr(self.text_actor, "set_text"):
            self.text_actor.set_text(2, text)
        elif hasattr(self.text_actor, "SetInput"):
            self.text_actor.SetInput(text)
