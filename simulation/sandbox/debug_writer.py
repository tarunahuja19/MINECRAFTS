"""
Optional JSON debug packet writer (§Phase 4).

Writes completed packets to:
    simulation_packets/packet_{packet_id:06d}.json

Configurable via `enabled` flag (enabled in development, can be disabled in production).
"""

import json
from pathlib import Path
from typing import Any


class DebugPacketWriter:
    """Writes completed packets as formatted JSON files for inspection/debugging."""

    def __init__(self, output_dir: Path | str = "simulation_packets", enabled: bool = True):
        self.output_dir = Path(output_dir)
        self.enabled = enabled
        if self.enabled:
            self.output_dir.mkdir(parents=True, exist_ok=True)

    def write_packet(self, packet: dict[str, Any]) -> Path | None:
        """Write packet to JSON file if enabled."""
        if not self.enabled:
            return None

        try:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            packet_id = packet.get("packet_id", 0)
            file_path = self.output_dir / f"packet_{packet_id:06d}.json"
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(packet, f, indent=2)
            return file_path
        except Exception as e:
            print(f"[PACKET] Warning: failed to write debug packet JSON: {e}")
            return None
