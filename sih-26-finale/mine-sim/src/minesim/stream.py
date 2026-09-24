"""Stream and output formatting - WP6 (file writers).

Artefacts (contract §7):
- nodes.csv              one row per Scout per epoch, delivered or not, header exactly §7.1
- terrain_state.npz      t = 0 surface: origin_x_m, origin_y_m, cell_m, shape, z0_mm (int32, (nx, ny))
- terrain_changes.jsonl  one line per step: {"epoch", "t_s", "cells": [[i, j, dz_mm], ...]}
- run_summary.json       handoff summary incl. the real / pinned / synthetic breakdown

Rows are flushed per epoch; nothing accumulates in memory. Values are written raw (no smoothing).
"""

import csv
import json
from collections import Counter
from pathlib import Path
from typing import Dict, Optional, Sequence, TextIO

import numpy as np

from minesim.provenance import TAGS, Value
from minesim.radio import TxRecord
from minesim.sensors import Reading
from minesim.sizing import Layout
from minesim.world import Delta, WorldState

NODES_CSV_HEADER = (
    "epoch", "t_s", "node_id", "tier", "x_m", "y_m", "z0_mm", "subsidence_mm", "subsidence_prov",
    "tilt_x_urad", "tilt_y_urad", "tilt_prov", "strain_ustrain", "strain_prov",
    "disp_mm", "disp_prov", "battery_mv", "rssi_dbm", "parent_used", "delivered", "via_emergency",
)
SIGN_CONVENTION = "negative_down"
DECIMALS = 3


def _num(v: Optional[Value]) -> str:
    return "" if v is None else repr(round(v.magnitude, DECIMALS))


def _prov(v: Optional[Value]) -> str:
    return "" if v is None else v.provenance


def _bool(b: bool) -> str:
    return "true" if b else "false"


class OutputWriter:
    """Writes one run's artefacts into `out_dir`, one epoch at a time."""

    def __init__(self, out_dir: Path, layout: Layout) -> None:
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self._nodes = {n.node_id: n for n in layout.nodes}
        self._csv_file: TextIO = open(self.out_dir / "nodes.csv", "w", newline="")
        self._csv = csv.writer(self._csv_file)
        self._csv.writerow(NODES_CSV_HEADER)
        self._jsonl: TextIO = open(self.out_dir / "terrain_changes.jsonl", "w")
        self.prov_counts: Counter = Counter()
        self.packets = 0
        self.delivered = 0
        self.via_emergency = 0
        self.epochs = 0

    def write_terrain_state(self, world: WorldState) -> None:
        np.savez_compressed(
            self.out_dir / "terrain_state.npz",
            origin_x_m=np.float64(world.origin_x_m), origin_y_m=np.float64(world.origin_y_m),
            cell_m=np.float64(world.cell_m), shape=np.array(world.shape, dtype=np.int64),
            z0_mm=world.z0_mm.astype(np.int32),
        )

    def write_epoch(self, delta: Delta, readings: Sequence[Reading], records: Sequence[TxRecord]) -> None:
        self._jsonl.write(json.dumps(
            {"epoch": delta.epoch, "t_s": delta.t_s, "cells": [list(c) for c in delta.cells]},
            separators=(",", ":"),
        ) + "\n")
        by_node: Dict[int, TxRecord] = {r.packet.node_id: r for r in records}
        for rd in readings:
            node = self._nodes[rd.node_id]
            tx = by_node[rd.node_id]
            tilt_prov = _prov(rd.tilt_x)
            self._csv.writerow((
                rd.epoch, repr(rd.t_s), rd.node_id, node.tier, repr(node.x_m), repr(node.y_m), repr(node.z0_mm),
                _num(rd.subsidence), _prov(rd.subsidence),
                _num(rd.tilt_x), _num(rd.tilt_y), tilt_prov,
                _num(rd.strain), _prov(rd.strain),
                _num(rd.displacement), _prov(rd.displacement),
                _num(rd.battery_mv), repr(round(tx.rssi_dbm, DECIMALS)), tx.parent_used,
                _bool(tx.delivered), _bool(tx.via_emergency),
            ))
            for v in (rd.subsidence, rd.tilt_x, rd.tilt_y, rd.strain, rd.displacement, rd.battery_mv):
                if v is not None:
                    self.prov_counts[v.provenance] += 1
            self.packets += 1
            self.delivered += tx.delivered
            self.via_emergency += tx.via_emergency
        self.epochs += 1
        self._csv_file.flush()
        self._jsonl.flush()

    def provenance_breakdown(self) -> Dict[str, Dict[str, float]]:
        total = sum(self.prov_counts.values())
        return {t: {"count": self.prov_counts[t],
                    "pct": round(100.0 * self.prov_counts[t] / total, 4) if total else 0.0} for t in TAGS}

    def write_summary(self, summary: dict) -> None:
        with open(self.out_dir / "run_summary.json", "w") as f:
            json.dump(summary, f, indent=2)
            f.write("\n")

    def close(self) -> None:
        self._csv_file.close()
        self._jsonl.close()


def replay_terrain(out_dir: Path, to_epoch: Optional[int] = None) -> np.ndarray:
    """Rebuild the int32 surface from terrain_state.npz + terrain_changes.jsonl up to `to_epoch`."""
    out_dir = Path(out_dir)
    with np.load(out_dir / "terrain_state.npz") as state:
        z = state["z0_mm"].astype(np.int32).copy()
    with open(out_dir / "terrain_changes.jsonl") as f:
        for line in f:
            d = json.loads(line)
            if to_epoch is not None and d["epoch"] > to_epoch:
                break
            if d["cells"]:
                cells = np.array(d["cells"], dtype=np.int64)
                np.add.at(z, (cells[:, 0], cells[:, 1]), cells[:, 2].astype(np.int32))
    return z
