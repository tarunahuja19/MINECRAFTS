"""Live 3-Thread PINN Simulation & 3D Interactive Visualization App.

Threading Architecture (Invariant I4):
- Thread 1 (SimulationProducer): Emits synthetic telemetry at variable speed to Queue.
- Thread 2 (PINNTrainer): Ingests telemetry, updates PINN and learnable prior, publishes to SurfaceBuffer.
- Thread 3 (Main Thread): PyVista VTK renderer, HUD updater, slider/button event loop.
"""
import os
import queue
import threading
import time
from typing import Any
import imageio
import numpy as np
import pyvista as pv
import torch

from pinn.trainer import PINNTrainer
from sim.producer import SimulationProducer
from viz.buffer import SurfaceBuffer
from viz.controls import ControlState, SceneControls
from viz.hud import InstrumentHUD
from viz.scene import SubsidenceScene


class LiveApp:
    """Manages the lifecycle of producer, trainer, and interactive PyVista renderer."""

    def __init__(
        self,
        config: dict[str, Any],
        off_screen: bool = False,
        web: bool = False,
        record_gif_path: str | None = None,
    ):
        self.config = config
        self.off_screen = off_screen
        self.web = web
        self.record_gif_path = record_gif_path

        # Thread synchronization
        self.epoch_queue = queue.Queue(maxsize=4)
        self.surface_buffer = SurfaceBuffer()
        self.control_state = ControlState()

        # Threads
        self.producer = SimulationProducer(self.config, self.epoch_queue, self.control_state, base_seed=42)
        self.trainer = PINNTrainer(self.config, self.epoch_queue, self.surface_buffer, self.control_state, lr=3e-3)

        self.producer_thread = threading.Thread(target=self.producer.run, daemon=True, name="SimProducerThread")
        self.trainer_thread = threading.Thread(target=self.trainer.run, daemon=True, name="PINNTrainerThread")

        # PyVista Plotter (off_screen=True when in web or headless mode)
        self.plotter = pv.Plotter(off_screen=off_screen or web)
        self.plotter.set_background("#12151c")

        # Scene components
        self.scene = SubsidenceScene(
            plotter=self.plotter,
            nx=config["grid"]["nx"],
            ny=config["grid"]["ny"],
            x_bounds=(config["grid"]["x_min"], config["grid"]["x_max"]),
            y_bounds=(config["grid"]["y_min"], config["grid"]["y_max"]),
            panel_config=config["panel"],
            nodes_config=config["nodes"],
            anchors_config=config["anchors"],
            gateway_config=config["gateway"],
        )

        self.hud = InstrumentHUD(self.plotter)
        self.controls = SceneControls(self.plotter, self.scene, self.control_state)

        # Telemetry tracking
        self.last_render_time = time.time()
        self.fps_smoothed = 60.0
        self.frame_count = 0
        self.recorded_frames: list[np.ndarray] = []
        self.running = True

        # Camera positioning
        self.plotter.camera_position = [(1100.0, -300.0, 600.0), (400.0, 200.0, -50.0), (0.0, 0.0, 1.0)]

    def start_threads(self) -> None:
        """Start producer and trainer background threads."""
        self.producer_thread.start()
        self.trainer_thread.start()
        print(">>> [APP] Simulation Producer and PINN Trainer threads started.")

    def stop_threads(self) -> None:
        """Signal background threads to terminate."""
        self.running = False
        self.producer.stop()
        self.trainer.stop()

    def update_frame(self) -> None:
        """Main thread render tick callback (Invariant I4)."""
        now = time.time()
        dt = max(1e-4, now - self.last_render_time)
        self.last_render_time = now
        instant_fps = 1.0 / dt
        self.fps_smoothed = 0.9 * self.fps_smoothed + 0.1 * instant_fps
        self.frame_count += 1

        # 1. Fetch latest prediction surface from SurfaceBuffer
        snapshot = self.surface_buffer.get_snapshot()
        if snapshot is not None:
            s_pinn, s_truth, meta = snapshot

            # Format node states
            node_states = meta.get("node_states", {})

            # Update 3D PyVista actors
            self.scene.update_surface(s_pinn, s_truth, node_states)

            # Update 2D Monospace HUD
            hud_data = {
                "epoch_id": meta.get("epoch_id", 0),
                "t_days": meta.get("t_days", 0.0),
                "nodes_reporting": meta.get("nodes_reporting", 0),
                "nodes_expected": meta.get("nodes_expected", 28),
                "rmse_mm": meta.get("rmse_mm", 0.0),
                "max_err_mm": meta.get("max_err_mm", 0.0),
                "a_hat": meta.get("a_hat", 0.0),
                "a_true": meta.get("a_true", 0.650),
                "c_hat": meta.get("c_hat", 0.0),
                "c_true": meta.get("c_true", 0.100),
                "loss_tilt": meta.get("loss_tilt", 0.0),
                "loss_strain": meta.get("loss_strain", 0.0),
                "loss_ext": meta.get("loss_ext", 0.0),
                "loss_anch": meta.get("loss_anch", 0.0),
                "loss_phys": meta.get("loss_phys", 0.0),
                "retrain_ms": meta.get("retrain_ms", 0.0),
                "queue_lag": meta.get("queue_lag", 0),
                "fps": self.fps_smoothed,
                "exaggeration": self.control_state.vertical_exaggeration,
            }
            self.hud.update(hud_data)

        # 2. Record GIF frame if active
        if self.control_state.is_recording_gif or self.record_gif_path is not None:
            frame = self.plotter.screenshot(return_img=True)
            if self.control_state.is_recording_gif:
                self.control_state.gif_frames.append(frame)
            if self.record_gif_path is not None:
                self.recorded_frames.append(frame)

    def run(self) -> None:
        """Run the interactive PyVista window or Web Trame server."""
        self.start_threads()

        try:
            if self.web:
                print(">>> [APP] Serving Web UI on Trame http://localhost:8080...")
                import asyncio
                from pyvista.trame.ui import get_viewer
                viewer = get_viewer(self.plotter)

                # Initialize Trame Vuetify layout and VTK view
                with viewer.make_layout(viewer.server) as layout:
                    viewer.ui(default_server_rendering=True)

                async def run_async_server():
                    server_coro = viewer.server.start(
                        port=8080,
                        host="0.0.0.0",
                        open_browser=False,
                        exec_mode="coroutine",
                    )
                    server_task = asyncio.create_task(server_coro)

                    try:
                        while self.running:
                            self.update_frame()
                            try:
                                viewer.update()
                            except Exception:
                                pass
                            await asyncio.sleep(0.033)
                    finally:
                        server_task.cancel()

                asyncio.run(run_async_server())
            elif not self.off_screen:
                # Install timer callback for 30-60 FPS render updates
                def timer_callback(step: int):
                    self.update_frame()

                self.plotter.add_timer_event(max_steps=1_000_000, duration=33, callback=timer_callback)
                self.plotter.show(auto_close=False)
            else:
                # Headless simulation loop
                for _ in range(100):
                    self.update_frame()
                    time.sleep(0.05)
        finally:
            self.stop_threads()
            if self.record_gif_path and self.recorded_frames:
                os.makedirs(os.path.dirname(self.record_gif_path) or ".", exist_ok=True)
                imageio.mimsave(self.record_gif_path, self.recorded_frames, duration=66, loop=0)
                print(f">>> [APP] GIF saved to {self.record_gif_path}")


def run_live_app(config: dict[str, Any], off_screen: bool = False, web: bool = False) -> None:
    """Launch live 3D application."""
    app = LiveApp(config, off_screen=off_screen, web=web)
    app.run()
