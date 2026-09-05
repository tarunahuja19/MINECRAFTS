"""Tests ensuring strict physics isolation and anti-circularity (Invariant I2).

Non-negotiable Invariant I2:
scoring/score.py is the ONLY file permitted to import from truth/.
pinn/ and sim/ must not.
tests/test_physics_leak.py enforces this by walking the AST import graph,
and asserts RMSE(no sensors) > 5 * RMSE(all sensors).
"""
import ast
import json
import os
import queue
import glob
import pytest
import torch

from pinn.trainer import PINNTrainer
from sim.producer import SimulationProducer
from viz.buffer import SurfaceBuffer
from viz.controls import ControlState


def test_ast_import_graph_isolation():
    """Walk the AST of all files in pinn/ and sim/ to assert zero imports from truth/."""
    forbidden_modules = {"truth", "truth.truth"}

    dirs_to_check = ["pinn", "sim", "ground"]
    for dir_name in dirs_to_check:
        py_files = glob.glob(os.path.join(dir_name, "**", "*.py"), recursive=True)
        for filepath in py_files:
            with open(filepath, "r") as f:
                tree = ast.parse(f.read(), filename=filepath)

            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        for forbidden in forbidden_modules:
                            assert not alias.name.startswith(forbidden), (
                                f"Invariant I2 Violation in {filepath}: imports forbidden module '{alias.name}'"
                            )
                elif isinstance(node, ast.ImportFrom):
                    mod = node.module or ""
                    for forbidden in forbidden_modules:
                        assert not mod.startswith(forbidden), (
                            f"Invariant I2 Violation in {filepath}: imports forbidden module '{mod}'"
                        )


def test_falsification_no_sensors_degradation():
    """Stage 4 Gate: Assert RMSE(no sensors) > 5 * RMSE(all sensors).

    Demonstrates that without sensors, magnitude is unconstrained (non-circular).
    """
    torch.set_num_threads(2)
    with open("config/nodes.json", "r") as f:
        config = json.load(f)

    # 1. Run with ALL sensors alive for 30 days (60 epochs of 12 hours)
    q_all = queue.Queue(maxsize=4)
    ctrl_all = ControlState(retrain_steps=120, physics_weight=0.50)
    prod_all = SimulationProducer(config, q_all, ctrl_all, base_seed=42)
    prod_all.EPOCH_INTERVAL_MIN = 720.0  # 12 hr per epoch -> 30 days in 60 epochs
    buf_all = SurfaceBuffer()
    trainer_all = PINNTrainer(config, q_all, buf_all, ctrl_all, lr=3e-3)

    # Step for 30 sim-days
    last_meta_all = None
    for _ in range(60):
        ep = prod_all.step_epoch()
        last_meta_all = trainer_all.train_epoch(ep)

    rmse_all_sensors = last_meta_all["rmse_mm"]
    print(f"\n[FALSIFICATION] Day 30 RMSE with ALL sensors: {rmse_all_sensors:.2f} mm (a_hat={last_meta_all['a_hat']:.3f})")

    # 2. Run with NO sensors (Kill ALL from day 0)
    q_none = queue.Queue(maxsize=4)
    ctrl_none = ControlState(retrain_steps=120, physics_weight=0.50)
    prod_none = SimulationProducer(config, q_none, ctrl_none, base_seed=42)
    prod_none.EPOCH_INTERVAL_MIN = 720.0
    # Kill all nodes
    prod_none.radio.kill_all_nodes(config["nodes"], "2026-03-06T00:00:00Z")

    buf_none = SurfaceBuffer()
    trainer_none = PINNTrainer(config, q_none, buf_none, ctrl_none, lr=3e-3)

    last_meta_none = None
    for _ in range(60):
        ep = prod_none.step_epoch()
        last_meta_none = trainer_none.train_epoch(ep)

    rmse_no_sensors = last_meta_none["rmse_mm"]
    ratio = rmse_no_sensors / max(1e-3, rmse_all_sensors)
    print(f"[FALSIFICATION] Day 30 RMSE with NO sensors: {rmse_no_sensors:.2f} mm (a_hat={last_meta_none['a_hat']:.3f})")
    print(f"[FALSIFICATION] Error ratio (no sensors / all sensors): {ratio:.2f}x")

    # Assert > 5x degradation per §4 and Stage 4 Gate
    assert ratio > 5.0, (
        f"Falsification test failed! RMSE ratio {ratio:.2f} <= 5.0x. Physics prior is leaking!"
    )
