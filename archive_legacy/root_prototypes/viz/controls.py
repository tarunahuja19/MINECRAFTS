"""Interactive UI controls, sliders, buttons, and keyboard handlers.

Non-negotiable Invariant:
Widget callbacks set flags on a shared ControlState object. Never train or touch VTK from callbacks.
"""
import dataclasses
import os
import threading
from typing import Any, Callable
import imageio
import numpy as np
import pyvista as pv


@dataclasses.dataclass
class ControlState:
    """Shared state read by producer, trainer, and renderer."""
    sim_day: float = 0.0
    seek_requested: bool = False
    speed_multiplier: float = 50.0  # Wall-clock acceleration (0 = pause, up to 2000x)
    vertical_exaggeration: float = 100.0
    physics_weight: float = 0.50
    retrain_steps: int = 200
    kill_cluster_requested: bool = False
    kill_all_requested: bool = False
    revive_requested: bool = False
    inject_blast_requested: bool = False
    reset_pinn_requested: bool = False
    is_recording_gif: bool = False
    gif_frames: list[np.ndarray] = dataclasses.field(default_factory=list)
    out_dir: str = "out"
    _lock: threading.Lock = dataclasses.field(default_factory=threading.Lock)

    def update_slider(self, key: str, value: float) -> None:
        with self._lock:
            setattr(self, key, value)

    def request_action(self, action: str) -> None:
        with self._lock:
            setattr(self, f"{action}_requested", True)

    def clear_action(self, action: str) -> bool:
        with self._lock:
            flag = getattr(self, f"{action}_requested", False)
            setattr(self, f"{action}_requested", False)
            return flag

    def get_state_snapshot(self) -> dict:
        with self._lock:
            return {
                "sim_day": self.sim_day,
                "speed_multiplier": self.speed_multiplier,
                "vertical_exaggeration": self.vertical_exaggeration,
                "physics_weight": self.physics_weight,
                "retrain_steps": self.retrain_steps,
            }


class SceneControls:
    """Installs PyVista slider and button widgets and keybindings."""

    def __init__(
        self,
        plotter: pv.Plotter,
        scene: Any,
        control_state: ControlState,
        on_gif_saved: Callable[[str], None] | None = None,
    ):
        self.plotter = plotter
        self.scene = scene
        self.state = control_state
        self.on_gif_saved = on_gif_saved

        self._setup_sliders()
        self._setup_buttons()
        self._setup_keybindings()

    def _setup_sliders(self) -> None:
        """Add sliders on the left column with clean non-overlapping positioning."""
        # 1. Sim Day slider
        self.plotter.add_slider_widget(
            callback=self._on_sim_day_change,
            rng=[0.0, 40.0],
            value=0.0,
            title="Sim Day",
            pointa=(0.02, 0.50),
            pointb=(0.15, 0.50),
            style="modern",
            title_height=0.025,
        )

        # 2. Speed slider
        self.plotter.add_slider_widget(
            callback=self._on_speed_change,
            rng=[0.0, 2000.0],
            value=50.0,
            title="Speed (x)",
            pointa=(0.02, 0.40),
            pointb=(0.15, 0.40),
            style="modern",
            title_height=0.025,
        )

        # 3. Exaggeration slider
        self.plotter.add_slider_widget(
            callback=self._on_exag_change,
            rng=[1.0, 500.0],
            value=100.0,
            title="Vert Exag",
            pointa=(0.02, 0.30),
            pointb=(0.15, 0.30),
            style="modern",
            title_height=0.025,
        )

        # 4. Physics weight slider
        self.plotter.add_slider_widget(
            callback=self._on_phys_weight_change,
            rng=[0.0, 1.0],
            value=0.10,
            title="Phys Weight",
            pointa=(0.02, 0.20),
            pointb=(0.15, 0.20),
            style="modern",
            title_height=0.025,
        )

        # 5. Retrain steps slider
        self.plotter.add_slider_widget(
            callback=self._on_steps_change,
            rng=[50.0, 1000.0],
            value=200.0,
            title="Retrain Steps",
            pointa=(0.02, 0.10),
            pointb=(0.15, 0.10),
            style="modern",
            title_height=0.025,
        )

    def _setup_buttons(self) -> None:
        """Add control buttons along the bottom row horizontally."""
        # Button: Kill Cluster
        self.plotter.add_checkbox_button_widget(
            self._on_kill_cluster_btn,
            value=False,
            position=(20, 15),
            size=18,
            color_on="red",
            color_off="grey",
        )
        self.plotter.add_text("Kill Cluster", position=(44, 17), font_size=8, color="white", name="btn_lbl_kill_c")

        # Button: Kill ALL
        self.plotter.add_checkbox_button_widget(
            self._on_kill_all_btn,
            value=False,
            position=(140, 15),
            size=18,
            color_on="darkred",
            color_off="grey",
        )
        self.plotter.add_text("Kill ALL", position=(164, 17), font_size=8, color="white", name="btn_lbl_kill_all")

        # Button: Revive
        self.plotter.add_checkbox_button_widget(
            self._on_revive_btn,
            value=False,
            position=(240, 15),
            size=18,
            color_on="limegreen",
            color_off="grey",
        )
        self.plotter.add_text("Revive Fleet", position=(264, 17), font_size=8, color="white", name="btn_lbl_revive")

        # Button: Inject Blast
        self.plotter.add_checkbox_button_widget(
            self._on_blast_btn,
            value=False,
            position=(360, 15),
            size=18,
            color_on="orange",
            color_off="grey",
        )
        self.plotter.add_text("Inject Blast", position=(384, 17), font_size=8, color="white", name="btn_lbl_blast")

        # Button: Reset PINN
        self.plotter.add_checkbox_button_widget(
            self._on_reset_btn,
            value=False,
            position=(480, 15),
            size=18,
            color_on="cyan",
            color_off="grey",
        )
        self.plotter.add_text("Reset PINN", position=(504, 17), font_size=8, color="white", name="btn_lbl_reset")

    def _setup_keybindings(self) -> None:
        """Register keyboard shortcut handlers."""
        self.plotter.add_key_event("t", self.scene.toggle_truth_ghost)
        self.plotter.add_key_event("T", self.scene.toggle_truth_ghost)
        self.plotter.add_key_event("e", self.scene.toggle_error_sheet)
        self.plotter.add_key_event("E", self.scene.toggle_error_sheet)
        self.plotter.add_key_event("d", self.scene.toggle_draw_cones)
        self.plotter.add_key_event("D", self.scene.toggle_draw_cones)
        self.plotter.add_key_event("x", self.scene.toggle_ext_lines)
        self.plotter.add_key_event("X", self.scene.toggle_ext_lines)
        self.plotter.add_key_event("g", self.toggle_gif_recording)
        self.plotter.add_key_event("G", self.toggle_gif_recording)
        self.plotter.add_key_event("m", self.scene.cycle_terrain_style)
        self.plotter.add_key_event("M", self.scene.cycle_terrain_style)

    def _on_sim_day_change(self, val: float) -> None:
        self.state.sim_day = float(val)
        self.state.seek_requested = True

    def _on_speed_change(self, val: float) -> None:
        self.state.speed_multiplier = float(val)

    def _on_exag_change(self, val: float) -> None:
        self.state.vertical_exaggeration = float(val)
        self.scene.set_exaggeration(val)

    def _on_phys_weight_change(self, val: float) -> None:
        self.state.physics_weight = float(val)

    def _on_steps_change(self, val: float) -> None:
        self.state.retrain_steps = int(val)

    def _on_kill_cluster_btn(self, state: bool) -> None:
        self.state.request_action("kill_cluster")

    def _on_kill_all_btn(self, state: bool) -> None:
        self.state.request_action("kill_all")

    def _on_revive_btn(self, state: bool) -> None:
        self.state.request_action("revive")

    def _on_blast_btn(self, state: bool) -> None:
        self.state.request_action("inject_blast")

    def _on_reset_btn(self, state: bool) -> None:
        self.state.request_action("reset_pinn")

    def toggle_gif_recording(self) -> None:
        """Toggle GIF recording start/stop."""
        if not self.state.is_recording_gif:
            self.state.is_recording_gif = True
            self.state.gif_frames = []
            print(">>> [GIF] Recording STARTED")
        else:
            self.state.is_recording_gif = False
            frames = list(self.state.gif_frames)
            self.state.gif_frames = []
            if frames:
                os.makedirs(self.state.out_dir, exist_ok=True)
                gif_path = os.path.join(self.state.out_dir, "session.gif")
                imageio.mimsave(gif_path, frames, fps=15, loop=0)
                print(f">>> [GIF] Recording SAVED to {gif_path} ({len(frames)} frames)")
                if self.on_gif_saved:
                    self.on_gif_saved(gif_path)
