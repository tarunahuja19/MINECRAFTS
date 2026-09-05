"""Radio mesh networking, path loss, hops, packet drop, and node failure management."""
from typing import Any
import numpy as np
from sim.sensors import SensorReading


class RadioMesh:
    """Simulates wireless multi-hop radio transmission to the gateway."""

    def __init__(
        self,
        gateway_xy: tuple[float, float] = (860.0, 200.0),
        base_drop_rate: float = 0.02,
    ):
        self.gateway_xy = gateway_xy
        self.base_drop_rate = base_drop_rate
        self.dead_nodes: set[int] = set()
        self.dead_timestamps: dict[int, str] = {}

    def kill_nodes(self, node_ids: list[int] | set[int], timestamp_iso: str) -> None:
        """Mark nodes as dead permanently."""
        for nid in node_ids:
            self.dead_nodes.add(nid)
            if nid not in self.dead_timestamps:
                self.dead_timestamps[nid] = timestamp_iso

    def kill_cluster_near(self, center_xy: tuple[float, float], radius_m: float, nodes_config: list[dict], timestamp_iso: str) -> list[int]:
        """Kill nodes located within radius_m of center_xy (e.g. near 300, 200)."""
        killed = []
        cx, cy = center_xy
        for n in nodes_config:
            xy = n["xy"]
            if np.hypot(xy[0] - cx, xy[1] - cy) <= radius_m:
                killed.append(n["id"])
        self.kill_nodes(killed, timestamp_iso)
        return killed

    def kill_all_nodes(self, nodes_config: list[dict], timestamp_iso: str) -> list[int]:
        """Kill all nodes for the falsification test."""
        all_ids = [n["id"] for n in nodes_config]
        self.kill_nodes(all_ids, timestamp_iso)
        return all_ids

    def revive_all_nodes(self) -> None:
        """Revive all nodes (restores communication; bias walks are preserved)."""
        self.dead_nodes.clear()
        self.dead_timestamps.clear()

    def transmit(
        self,
        readings: list[SensorReading],
        nodes_config_map: dict[int, dict],
        rng: np.random.Generator,
    ) -> list[dict[str, Any]]:
        """Simulate packet propagation through multi-hop mesh to gateway."""
        received_messages = []
        gw_x, gw_y = self.gateway_xy

        for r in readings:
            nid = r.node_id
            if nid in self.dead_nodes:
                continue

            node_cfg = nodes_config_map.get(nid, {})
            nx, ny = node_cfg.get("xy", (0.0, 0.0))

            # Distance to gateway
            dist_to_gw = float(np.hypot(nx - gw_x, ny - gw_y))
            # Hops: ~1 hop per 250m
            hops = max(1, int(np.ceil(dist_to_gw / 250.0)))

            # Log-distance path loss RSSI model
            # RSSI ~ -50 - 10 * n * log10(d)
            rssi = -45.0 - 25.0 * np.log10(max(10.0, dist_to_gw)) + rng.normal(0.0, 3.0)
            rssi = float(np.clip(rssi, -120.0, -50.0))
            snr = float(np.clip(15.0 - (dist_to_gw / 60.0) + rng.normal(0.0, 1.5), -5.0, 15.0))

            # Drop probability increases with hops & poor SNR
            drop_prob = self.base_drop_rate * hops + (0.05 if snr < 0.0 else 0.0)
            if rng.random() < drop_prob:
                # Dropped on the radio
                continue

            received_messages.append({
                "reading": r,
                "hops": hops,
                "rssi": round(rssi, 1),
                "snr": round(snr, 1),
            })

        return received_messages
