"""Background simulation producer thread emitting telemetry epoch objects.

Non-negotiable Invariants:
- Queue is drop-oldest, not blocking.
- Epoch dict matches part1-reference.md §4.3 strictly.
- Invariant I7: Seeds drive reproducible readings.
"""
from datetime import datetime, timedelta, timezone
import queue
import threading
import time
from typing import Any
import numpy as np

from ground.surface import GroundModel, KnotheParameters
from sim.radio import RadioMesh
from sim.sensors import SensorFleet
from viz.controls import ControlState


class SimulationProducer(threading.Thread):
    """Producer thread running the forward simulation clock and generating epochs."""

    EPOCH_INTERVAL_MIN = 30.0  # 30-minute epoch cadence
    BASE_DATE = datetime(2026, 3, 6, 0, 0, 0, tzinfo=timezone.utc)

    def __init__(
        self,
        config: dict[str, Any],
        epoch_queue: queue.Queue,
        control_state: ControlState,
        ground_model: GroundModel | None = None,
        base_seed: int = 42,
    ):
        super().__init__(daemon=True, name="SimProducerThread")
        self.config = config
        self.epoch_queue = epoch_queue
        self.state = control_state
        self.ground = ground_model or GroundModel(KnotheParameters(**config.get("panel", {})))

        self.fleet = SensorFleet(config["nodes"], self.ground)
        self.radio = RadioMesh(gateway_xy=tuple(config["gateway"]["xy"]))
        self.nodes_map = {n["id"]: n for n in config["nodes"]}
        self.anchors_config = config.get("anchors", [])

        self.rng = np.random.default_rng(base_seed)
        self.t_days: float = 0.0
        self.seq: int = 0
        self.epoch_id: int = 0
        self.running: bool = True

    def build_epoch_object(
        self,
        t_days: float,
        epoch_id: int,
        readings_map: dict[int, Any],
    ) -> dict[str, Any]:
        """Construct the exact Level D epoch dictionary defined in §4.3."""
        current_time = self.BASE_DATE + timedelta(days=t_days)
        t_iso = current_time.strftime("%Y-%m-%dT%H:%M:%SZ")

        p = self.config["panel"]
        r = p["depth_m"] / p["tan_beta"]

        observations = []
        reporting_count = 0
        max_age_s = 0

        # Field nodes
        for node in self.config["nodes"]:
            nid = node["id"]
            xyA = node["xy"]
            xyC = node.get("ext_to", [xyA[0], xyA[1] + 10.0])
            ext_line = [xyA, xyC]

            if nid in self.radio.dead_nodes:
                dead_since = self.radio.dead_timestamps.get(nid, t_iso)
                obs = {
                    "node_id": nid,
                    "xy": [float(xyA[0]), float(xyA[1])],
                    "tilt": None,
                    "strain": None,
                    "ext_delta_m": None,
                    "ext_line": ext_line,
                    "sigma": None,
                    "age_s": None,
                    "dead_since": dead_since,
                }
            elif nid in readings_map:
                # Reported successfully
                reporting_count += 1
                r_item = readings_map[nid]
                reading = r_item["reading"]
                conv = self.fleet.uncompensate_and_convert(reading, node)
                age_s = int(self.rng.integers(10, 180))
                max_age_s = max(max_age_s, age_s)

                obs = {
                    "node_id": nid,
                    "xy": [float(xyA[0]), float(xyA[1])],
                    "tilt": conv["tilt"],
                    "strain": conv["strain"],
                    "ext_delta_m": conv["ext_delta_m"],
                    "ext_line": ext_line,
                    "sigma": conv["sigma"],
                    "age_s": age_s,
                }
            else:
                # Dropped on radio
                obs = {
                    "node_id": nid,
                    "xy": [float(xyA[0]), float(xyA[1])],
                    "tilt": None,
                    "strain": None,
                    "ext_delta_m": None,
                    "ext_line": ext_line,
                    "sigma": None,
                    "age_s": None,
                }
            observations.append(obs)

        # Anchors (outside the draw angle)
        anchors = []
        for a in self.anchors_config:
            anchors.append({
                "node_id": a["id"],
                "xy": [float(a["xy"][0]), float(a["xy"][1])],
                "S_m": 0.0,
            })

        epoch_dict = {
            "epoch_id": epoch_id,
            "t_iso": t_iso,
            "t_days": round(float(t_days), 4),
            "panel": {
                "x1": float(p["x1"]),
                "y1": float(p["y1"]),
                "x2": float(p["x2"]),
                "y2": float(p["y2"]),
                "depth_m": float(p["depth_m"]),
                "seam_thickness_m": float(p["thickness_m"]),
                "tan_beta": float(p["tan_beta"]),
                "influence_radius_m": round(float(r), 2),
                "subsidence_factor": float(p["a"]),
            },
            "observations": observations,
            "anchors": anchors,
            "quality": {
                "nodes_expected": len(self.config["nodes"]),
                "nodes_reporting": reporting_count,
                "max_age_s": max_age_s if reporting_count > 0 else None,
            },
        }
        return epoch_dict

    def step_epoch(self, blast_event: dict[str, Any] | None = None) -> dict[str, Any]:
        """Advance time by one epoch, sample fleet, simulate radio, and construct epoch dict."""
        current_time = self.BASE_DATE + timedelta(days=self.t_days)
        t_iso = current_time.strftime("%Y-%m-%dT%H:%M:%SZ")

        # Process UI control actions if requested
        if self.state.clear_action("kill_cluster"):
            killed = self.radio.kill_cluster_near((300.0, 200.0), 160.0, self.config["nodes"], t_iso)
            print(f">>> [PRODUCER] Kill Cluster near (300, 200): {len(killed)} nodes dead ({killed})")

        if self.state.clear_action("kill_all"):
            killed = self.radio.kill_all_nodes(self.config["nodes"], t_iso)
            print(f">>> [PRODUCER] Kill ALL: {len(killed)} nodes dead (Falsification Test)")

        if self.state.clear_action("revive"):
            self.radio.revive_all_nodes()
            print(">>> [PRODUCER] Fleet Revived (all nodes alive)")

        if self.state.clear_action("inject_blast"):
            blast_event = {"charge_kg": 120.0, "x": 310.0, "y": 95.0}
            print(">>> [PRODUCER] Blast Injected: 120kg at (310, 95)")

        if self.state.seek_requested:
            self.state.seek_requested = False
            self.t_days = max(0.0, self.state.sim_day)
            print(f">>> [PRODUCER] Sim Clock Seek to Day {self.t_days:.2f}")

        # 1. Sample physical fleet (6-step damage chain)
        self.seq += 1
        readings = self.fleet.sample_fleet(self.t_days, self.seq, t_iso, blast_event=blast_event)

        # 2. Radio transmission
        received = self.radio.transmit(readings, self.nodes_map, self.rng)
        readings_map = {item["reading"].node_id: item for item in received}

        # 3. Epoch assembly
        self.epoch_id += 1
        epoch_obj = self.build_epoch_object(self.t_days, self.epoch_id, readings_map)

        # Advance sim clock
        dt_days = self.EPOCH_INTERVAL_MIN / (24.0 * 60.0)  # 0.020833 days (30 min)
        self.t_days += dt_days
        self.state.sim_day = self.t_days

        return epoch_obj

    def push_drop_oldest(self, epoch_obj: dict[str, Any]) -> None:
        """Push epoch into drop-oldest queue."""
        while self.epoch_queue.full():
            try:
                self.epoch_queue.get_nowait()
            except queue.Empty:
                break
        self.epoch_queue.put(epoch_obj)

    def run(self) -> None:
        """Main producer background loop."""
        while self.running:
            # Handle interactive UI control actions
            current_time = self.BASE_DATE + timedelta(days=self.t_days)
            t_iso = current_time.strftime("%Y-%m-%dT%H:%M:%SZ")

            if self.state.clear_action("kill_cluster"):
                killed = self.radio.kill_cluster_near((300.0, 200.0), 120.0, self.config["nodes"], t_iso)
                print(f">>> [PRODUCER] Kill Cluster near (300, 200): {len(killed)} nodes dead ({killed})")

            if self.state.clear_action("kill_all"):
                killed = self.radio.kill_all_nodes(self.config["nodes"], t_iso)
                print(f">>> [PRODUCER] Kill ALL: {len(killed)} nodes dead (Falsification Test)")

            if self.state.clear_action("revive"):
                self.radio.revive_all_nodes()
                print(">>> [PRODUCER] Fleet Revived (all nodes alive)")

            blast_event = None
            if self.state.clear_action("inject_blast"):
                blast_event = {"charge_kg": 120.0, "x": 310.0, "y": 95.0}
                print(">>> [PRODUCER] Blast Injected: 120kg at (310, 95)")

            if self.state.seek_requested:
                self.state.seek_requested = False
                self.t_days = max(0.0, self.state.sim_day)
                print(f">>> [PRODUCER] Sim Clock Seek to Day {self.t_days:.2f}")

            # Check speed multiplier (0 = paused)
            speed = self.state.speed_multiplier
            if speed <= 0:
                time.sleep(0.05)
                continue

            # Produce epoch
            epoch_obj = self.step_epoch(blast_event=blast_event)
            self.push_drop_oldest(epoch_obj)

            # Sleep proportional to wall clock speed
            # Base epoch = 30 min (1800 s) in sim time.
            # At speed = 100x, 1 epoch takes 1800 / 100 = 18 s.
            # For interactive sandbox responsiveness, clamp sleep interval
            wall_sleep = max(0.01, (self.EPOCH_INTERVAL_MIN * 60.0) / (speed * 60.0))
            time.sleep(min(wall_sleep, 0.1))

    def stop(self) -> None:
        """Signal producer thread to terminate."""
        self.running = False
