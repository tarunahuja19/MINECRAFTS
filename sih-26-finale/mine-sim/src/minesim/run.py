"""Simulation orchestrator - WP6 run loop.

    python -m minesim.run --days 30 --out out/v1-30d [--config config/assumptions.yaml]

Loop per step: world.step() -> write delta -> read_node per Scout -> radio superframe -> write rows.
"""

import argparse
import hashlib
import json
import time
from collections import Counter
from pathlib import Path
from typing import Optional

import numpy as np

from minesim.config import Config, load_config
from minesim.radio import Superframe
from minesim.sensors import SCOUT_TIERS, read_node
from minesim.sizing import size_network
from minesim.stream import SIGN_CONVENTION, OutputWriter
from minesim.world import WorldState

SECONDS_PER_DAY = 86400.0


def _config_hash(config_path: Path, cfg: Config) -> str:
    h = hashlib.sha256(Path(config_path).read_bytes())
    mine_file = Path(config_path).parent / "mines"
    for p in sorted(mine_file.glob("*.yaml")) if mine_file.is_dir() else []:
        h.update(p.read_bytes())
    return h.hexdigest()[:16]


def _fit_record(config_path: Path) -> dict:
    import yaml
    assumptions = yaml.safe_load(Path(config_path).read_text())
    mine = yaml.safe_load((Path(config_path).parent / "mines" / f"{assumptions['mine']}.yaml").read_text())
    fitted = Path(config_path).parent.parent / mine["pinning"]["fitted_params"]
    if not fitted.is_file():
        return {"mine": assumptions["mine"]}
    data = json.loads(fitted.read_text())
    return {"mine": data.get("mine"), "source_doi": data.get("source_doi"),
            "rms_residual_mm": data["fit"].get("rms_residual_mm"),
            "knothe_r_squared": data["fit"].get("r_squared")}


def run_sim(cfg: Config, days: float, out_dir: Path, config_path: Path = Path("config/assumptions.yaml"),
            seed: Optional[int] = None) -> dict:
    """Run `days` of simulation and write all artefacts to `out_dir`. Returns the summary dict."""
    started = time.time()
    seed = cfg.sim.rng_seed if seed is None else seed
    rng = np.random.default_rng(seed)
    layout = size_network(cfg)
    world = WorldState(cfg, layout)
    radio = Superframe(cfg, layout)
    scouts = [n for n in layout.nodes if n.tier in SCOUT_TIERS]
    writer = OutputWriter(out_dir, layout)
    writer.write_terrain_state(world)
    steps = int(round(days * SECONDS_PER_DAY / cfg.sim.timestep_s))
    try:
        for _ in range(steps):
            delta = world.step()
            readings = [read_node(n, world, cfg, rng) for n in scouts]
            records = radio.run(readings, world.epoch, rng)
            writer.write_epoch(delta, readings, records)
    finally:
        writer.close()

    tiers = Counter(n.tier for n in layout.nodes)
    summary = {
        "sign_convention": SIGN_CONVENTION,
        "data_label": "synthetic simulator output, not field measurements",
        "config_hash": _config_hash(config_path, cfg),
        "rng_seed": seed,
        "fit": _fit_record(config_path),
        "provenance_source": cfg.provenance_source,
        "days": days,
        "epochs": writer.epochs,
        "timestep_s": cfg.sim.timestep_s,
        "nodes_per_tier": dict(tiers),
        "scouts": len(scouts),
        "cost_inr": {"per_tier": {k: list(v) for k, v in layout.cost.per_tier.items()},
                     "total": layout.cost.total_inr},
        "packets": writer.packets,
        "delivered": writer.delivered,
        "delivery_rate": round(writer.delivered / writer.packets, 6) if writer.packets else None,
        "via_emergency": writer.via_emergency,
        "duty_cycle_pct": {t: round(100.0 * radio.duty_cycle(t), 4) for t in ("scout", "anchor", "gateway")},
        "provenance": writer.provenance_breakdown(),
        "peak_subsidence_mm": int(-world.snapshot().min()),
        "grid": {"shape": list(world.shape), "cell_m": world.cell_m,
                 "origin_x_m": world.origin_x_m, "origin_y_m": world.origin_y_m},
        "wall_time_s": round(time.time() - started, 2),
    }
    writer.write_summary(summary)
    return summary


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description="Run the mine subsidence simulator.")
    parser.add_argument("--days", type=float, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=Path("config/assumptions.yaml"))
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args(argv)
    cfg = load_config(args.config)
    summary = run_sim(cfg, args.days, args.out, args.config, args.seed)
    print(json.dumps({k: summary[k] for k in ("epochs", "scouts", "packets", "delivery_rate",
                                              "peak_subsidence_mm", "provenance", "wall_time_s")}, indent=2))


if __name__ == "__main__":
    main()
