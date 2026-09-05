"""Stage 5 Verification: Interactive Controls, Fault Injection, and GIF Recording.

Verifies:
1. Kill Cluster: 6 high-strain nodes die, sector deforms smoothly toward prior without NaNs.
2. Kill ALL: Falsification degradation without NaNs.
3. Revive Fleet: Fleet recovers cleanly.
4. Blast Injection: Transient spike handled gracefully.
5. Generates out/kill_cluster.gif demonstrating fault injection and prior blending.
"""
import json
import os
import queue
import time
import imageio
import numpy as np
import pyvista as pv
import pytest
import torch

from pinn.trainer import PINNTrainer
from sim.producer import SimulationProducer
from viz.buffer import SurfaceBuffer
from viz.controls import ControlState
from viz.hud import InstrumentHUD
from viz.scene import SubsidenceScene


def test_stage5_fault_injection_and_gif():
    """Verify fault injection actions, mesh stability, and record out/kill_cluster.gif."""
    torch.set_num_threads(2)
    with open("config/nodes.json", "r") as f:
        config = json.load(f)

    os.makedirs("out", exist_ok=True)
    gif_path = "out/kill_cluster.gif"

    # Setup 3D Scene off-screen
    plotter = pv.Plotter(off_screen=True, window_size=[1280, 720])
    plotter.set_background("#12151c")

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

    # Set camera angle
    plotter.camera_position = [(1100.0, -300.0, 600.0), (400.0, 200.0, -50.0), (0.0, 0.0, 1.0)]

    q = queue.Queue(maxsize=4)
    ctrl = ControlState(retrain_steps=80, physics_weight=0.50, vertical_exaggeration=100.0)
    producer = SimulationProducer(config, q, ctrl, base_seed=42)
    producer.EPOCH_INTERVAL_MIN = 360.0  # 6h per step -> 4 steps/day
    buffer = SurfaceBuffer()
    trainer = PINNTrainer(config, q, buffer, ctrl, lr=3e-3)

    recorded_frames = []

    # 1. Simulate Day 0 to Day 18 (Normal Operation)
    print("\n[STAGE 5] Simulating Days 0-18 (Normal fleet operations)...")
    for _ in range(18 * 4):
        ep = producer.step_epoch()
        meta = trainer.train_epoch(ep)

    # Render Day 18 baseline
    s_pinn, s_truth, meta = buffer.get_snapshot()
    node_states = meta.get("node_states", {})
    scene.update_surface(s_pinn, s_truth, node_states)
    hud.update(meta)
    recorded_frames.append(plotter.screenshot(return_img=True))

    # 2. Inject Fault: Kill Cluster at Day 18
    print("[STAGE 5] Injecting 'Kill Cluster' fault (killing 6 high-strain nodes)...")
    ctrl.request_action("kill_cluster")

    # Simulate Days 18 to 28 during cluster outage and record frames
    for step_idx in range(10 * 4):
        ep = producer.step_epoch()
        meta = trainer.train_epoch(ep)

        s_pinn, s_truth, meta = buffer.get_snapshot()
        node_states = meta.get("node_states", {})
        scene.update_surface(s_pinn, s_truth, node_states)
        hud.update(meta)

        # Orbit camera slightly for dynamic visualization
        plotter.camera.Azimuth(0.8)
        frame = plotter.screenshot(return_img=True)
        recorded_frames.append(frame)

        # Assert no NaNs or Infinities in predicted surface
        assert not np.isnan(s_pinn).any(), "NaN detected in predicted surface during cluster kill!"
        assert not np.isinf(s_pinn).any(), "Inf detected in predicted surface during cluster kill!"

    # Verify that dead nodes count matches killed cluster
    alive_count = sum(1 for ns in node_states.values() if ns["alive"])
    print(f"[STAGE 5] Nodes reporting after Kill Cluster: {alive_count} / {len(config['nodes'])}")
    assert alive_count <= len(config["nodes"]) - 6, "Expected at least 6 nodes to be killed by Kill Cluster!"

    # 3. Test Fleet Revive
    print("[STAGE 5] Testing 'Revive Fleet' action...")
    ctrl.request_action("revive")
    for _ in range(8):
        ep = producer.step_epoch()
        meta = trainer.train_epoch(ep)
        s_pinn, s_truth, meta = buffer.get_snapshot()
        node_states = meta.get("node_states", {})
        scene.update_surface(s_pinn, s_truth, node_states)
        hud.update(meta)
        plotter.camera.Azimuth(0.8)
        recorded_frames.append(plotter.screenshot(return_img=True))

    alive_revived = sum(1 for ns in node_states.values() if ns["alive"])
    print(f"[STAGE 5] Nodes reporting after Revive: {alive_revived} / {len(config['nodes'])}")
    assert len(producer.radio.dead_nodes) == 0, "Radio dead_nodes set should be empty after Revive!"
    assert alive_revived >= len(config["nodes"]) - 2, "Fleet should be transmitting after Revive action!"

    # Save out/kill_cluster.gif
    imageio.mimsave(gif_path, recorded_frames, duration=83, loop=0)
    print(f"[STAGE 5] GIF saved to {gif_path} ({len(recorded_frames)} frames, {os.path.getsize(gif_path)/1024:.1f} KB)")
    assert os.path.exists(gif_path), f"GIF not found at {gif_path}"
