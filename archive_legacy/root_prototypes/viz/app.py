"""Entry point for the 3D PINN Subsidence Sandbox.

Supports:
- Desktop PyVista interactive 3D window
- Web mode via PyVista Trame server (`--web`) on localhost:8080
- Stage 0 smoke test (`--stage0`)
- Stage 2 static scene render and snapshot (`--stage2`)
- Live 3-thread PINN simulation (default)
"""
import argparse
import json
import os
import sys
import time
import numpy as np
import pyvista as pv
import torch

from ground.surface import GroundModel, KnotheParameters
from scoring.score import SubsidenceScorer
from viz.buffer import SurfaceBuffer
from viz.controls import ControlState, SceneControls
from viz.hud import InstrumentHUD
from viz.scene import SubsidenceScene


def load_config(config_path: str = "config/nodes.json") -> dict:
    """Load mine configuration, panel dimensions, and node layout."""
    if not os.path.exists(config_path):
        # Fallback default
        return {
            "scenario": "slow_sag_40d",
            "panel": {"x1": 100.0, "y1": 100.0, "x2": 700.0, "y2": 300.0, "depth_m": 150.0, "thickness_m": 3.0, "tan_beta": 2.0, "a": 0.65, "c": 0.10, "B": 30.0},
            "grid": {"x_min": 25.0, "x_max": 775.0, "y_min": 25.0, "y_max": 375.0, "nx": 64, "ny": 64},
            "gateway": {"id": 200, "xy": [860.0, 200.0]},
            "anchors": [
                {"id": 31, "xy": [860.0, 60.0], "ext_to": [860.0, 70.0], "seed": 411902, "role": "anchor"},
                {"id": 32, "xy": [860.0, 340.0], "ext_to": [860.0, 350.0], "seed": 411903, "role": "anchor"},
            ],
            "nodes": [],
        }
    with open(config_path, "r") as f:
        return json.load(f)


def run_stage0_smoke_test(off_screen: bool = False, web: bool = False) -> None:
    """Stage 0 smoke test: 64x64 sine wave with in-place mutation and amplitude slider."""
    print("=== Stage 0: Skeleton and Smoke Test ===")
    nx, ny = 64, 64
    x = np.linspace(25, 775, nx, dtype=np.float32)
    y = np.linspace(25, 375, ny, dtype=np.float32)
    X, Y = np.meshgrid(x, y)

    plotter = pv.Plotter(off_screen=off_screen or web)
    plotter.set_background("#151820")

    grid = pv.StructuredGrid()
    z = np.sin(X / 50.0) * np.cos(Y / 50.0) * 10.0
    grid.points = np.column_stack((X.ravel(), Y.ravel(), z.ravel()))
    grid.dimensions = [nx, ny, 1]
    grid.point_data["elevation"] = z.ravel()

    actor = plotter.add_mesh(grid, scalars="elevation", cmap="viridis", show_edges=False)

    def on_amplitude_change(val: float):
        z_new = np.sin(X / 50.0) * np.cos(Y / 50.0) * float(val)
        grid.points[:, 2] = z_new.ravel()
        grid.point_data["elevation"] = z_new.ravel()

    plotter.add_slider_widget(
        callback=on_amplitude_change,
        rng=[0.0, 50.0],
        value=10.0,
        title="Sine Amplitude",
        pointa=(0.05, 0.90),
        pointb=(0.30, 0.90),
        style="modern",
    )

    plotter.camera_position = [(400.0, -400.0, 500.0), (400.0, 200.0, 0.0), (0.0, 0.0, 1.0)]

    # Benchmark FPS
    t0 = time.time()
    n_frames = 60
    for i in range(n_frames):
        amp = 10.0 + 5.0 * np.sin(i * 0.1)
        on_amplitude_change(amp)
        plotter.render()
    fps = n_frames / (time.time() - t0)
    print(f"Stage 0 Measured Render Performance: {fps:.1f} FPS")

    os.makedirs("out", exist_ok=True)
    plotter.screenshot("out/stage0.png")
    print("Stage 0 screenshot saved to out/stage0.png")

    if web:
        print("Serving Stage 0 on Trame http://localhost:8080...")
        from pyvista.trame.ui import get_viewer
        viewer = get_viewer(plotter)
        with viewer.make_layout(viewer.server) as layout:
            viewer.ui(default_server_rendering=True)
        viewer.server.start(port=8080, host="0.0.0.0", open_browser=False)
    elif not off_screen:
        plotter.show()


def run_stage2_static_scene(config: dict, off_screen: bool = False, web: bool = False) -> None:
    """Stage 2: Static 3D Scene rendered at t = 40 days from analytic truth."""
    print("=== Stage 2: Static 3D Scene Composition ===")
    p_cfg = config["panel"]
    params = KnotheParameters(
        x1=p_cfg["x1"], y1=p_cfg["y1"], x2=p_cfg["x2"], y2=p_cfg["y2"],
        depth_m=p_cfg["depth_m"], thickness_m=p_cfg["thickness_m"],
        tan_beta=p_cfg["tan_beta"], a=p_cfg["a"], c=p_cfg["c"], B=p_cfg["B"],
    )
    ground = GroundModel(params)

    plotter = pv.Plotter(off_screen=True)
    plotter.set_background("#0d1117")

    scene = SubsidenceScene(
        plotter=plotter,
        nx=config["grid"]["nx"],
        ny=config["grid"]["ny"],
        x_bounds=(config["grid"]["x_min"], config["grid"]["x_max"]),
        y_bounds=(config["grid"]["y_min"], config["grid"]["y_max"]),
        panel_config=config["panel"],
        nodes_config=config["nodes"],
        anchors_config=config["anchors"],
        gateway_config=config["gateway"],
    )

    hud = InstrumentHUD(plotter)
    control_state = ControlState()
    controls = SceneControls(plotter, scene, control_state)

    # Compute analytic truth at t = 40.0 days
    t_days = 40.0
    s_truth = ground.S(scene.X_grid, scene.Y_grid, t_days)

    # Node states
    node_states = {}
    for node in config["nodes"]:
        nid = node["id"]
        xy = node["xy"]
        eps = ground.strain_along(xy[0], xy[1], t_days, e_hat=(0.0, 1.0))
        alarming = abs(eps) > 0.0003  # > 300 microstrain
        node_states[nid] = {"alive": True, "alarming": alarming, "strain": eps}

    scene.update_surface(s_truth, s_truth, node_states)

    # Monospace HUD data
    hud_data = {
        "epoch_id": 1920,
        "t_days": 40.0,
        "nodes_reporting": len(config["nodes"]),
        "nodes_expected": len(config["nodes"]),
        "rmse_mm": 0.0,
        "max_err_mm": 0.0,
        "a_hat": 0.650,
        "a_true": 0.650,
        "c_hat": 0.100,
        "c_true": 0.100,
        "loss_tilt": 0.0000,
        "loss_strain": 0.0000,
        "loss_ext": 0.0000,
        "loss_anch": 0.0000,
        "loss_phys": 0.0000,
        "retrain_ms": 0.0,
        "queue_lag": 0,
        "fps": 60.0,
        "exaggeration": 100.0,
    }
    hud.update(hud_data)

    # Set camera per §6: azimuth 45, elevation 35 looking at panel centre (400, 200)
    plotter.camera_position = [(1100.0, -300.0, 600.0), (400.0, 200.0, -50.0), (0.0, 0.0, 1.0)]

    # Benchmark camera orbit FPS
    t0 = time.time()
    n_frames = 60
    for i in range(n_frames):
        plotter.camera.Azimuth(1.0)
        plotter.render()
    fps = n_frames / (time.time() - t0)
    print(f"Stage 2 Camera Orbit Performance: {fps:.1f} FPS")

    os.makedirs("out", exist_ok=True)
    out_img = "out/stage2.png"
    plotter.screenshot(out_img)
    print(f"Stage 2 screenshot successfully written to {out_img}")

    if web:
        print("Serving Stage 2 on Trame http://localhost:8080...")
        from pyvista.trame.ui import get_viewer
        viewer = get_viewer(plotter)
        with viewer.make_layout(viewer.server) as layout:
            viewer.ui(default_server_rendering=True)
        viewer.server.start(port=8080, host="0.0.0.0", open_browser=False)
    elif not off_screen:
        plotter.show()


def main():
    parser = argparse.ArgumentParser(description="PINN 3D Subsidence Sandbox")
    parser.add_argument("--stage0", action="store_true", help="Run Stage 0 sine wave smoke test")
    parser.add_argument("--stage2", action="store_true", help="Run Stage 2 static scene test and snapshot")
    parser.add_argument("--web", action="store_true", help="Serve interactive UI over Trame web on localhost:8080")
    parser.add_argument("--headless-test", action="store_true", help="Run offscreen test and export screenshot")
    parser.add_argument("--config", default="config/nodes.json", help="Path to nodes.json config")
    args = parser.parse_args()

    # Limit torch CPU threads per invariant / Trap 4
    torch.set_num_threads(2)

    config = load_config(args.config)

    if args.stage0:
        run_stage0_smoke_test(off_screen=args.headless_test, web=args.web)
        return

    if args.stage2:
        run_stage2_static_scene(config, off_screen=args.headless_test, web=args.web)
        return

    # If full live app requested, import sim and pinn and launch live app
    from viz.app_live import run_live_app
    run_live_app(config, off_screen=args.headless_test, web=args.web)


if __name__ == "__main__":
    main()
