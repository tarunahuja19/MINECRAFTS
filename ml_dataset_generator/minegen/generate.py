"""
Whole-mine generator (spec 3.2, 7.1, 7.2).

Produces one mine at a time from a random seed plus the parameter ranges in
constants.py, so mine count is a resumable batch process rather than a fixed
one-time target.

Every randomly drawn value is written into that mine's metadata.json. Spec 7.2:
nothing about how a mine was generated may be implicit. Anyone reading only the
metadata should be able to explain why the data looks the way it does, and
re-running the same seed reproduces the mine byte-for-byte.

OUTPUT PER MINE
    mine_XXXXX/
      metadata.json            every drawn parameter + seed
      nodes.parquet            node_id, tier, node_type, x, y, z
      readings.parquet         every sensor channel, every node, every timestep
      labels.parquet           time_to_collapse_s, censored_flag, spatial_weight
      collapse_events.parquet  mine-level event list
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from . import constants as K
from . import sensors
from .field import CollapseEvent, GroundField
from .labels import build_labels
from .layout import build_layout
from .mesh import build_mesh


def _draw_geometry(rng: np.random.Generator) -> dict:
    """Mine extent, panel rectangle and ground physics constants."""
    W = rng.uniform(*K.MINE_WIDTH_RANGE)
    Hgt = rng.uniform(*K.MINE_HEIGHT_RANGE)

    pw = W * rng.uniform(*K.PANEL_WIDTH_FRAC_RANGE)
    ph = Hgt * rng.uniform(*K.PANEL_HEIGHT_FRAC_RANGE)
    x1 = rng.uniform(0.12, 0.88) * (W - pw)
    y1 = rng.uniform(0.12, 0.88) * (Hgt - ph)

    H = rng.uniform(*K.DEPTH_H_RANGE)
    tan_beta = rng.uniform(*K.TAN_BETA_RANGE)

    return {
        "mine_width": W,
        "mine_height": Hgt,
        "panel_x1": x1,
        "panel_y1": y1,
        "panel_x2": x1 + pw,
        "panel_y2": y1 + ph,
        "H": H,
        "tan_beta": tan_beta,
        "r": H / tan_beta,
        "seam_thickness": rng.uniform(*K.SEAM_THICKNESS_RANGE),
        "a": rng.uniform(*K.SUBSIDENCE_FACTOR_RANGE),
        "c": rng.uniform(*K.KNOTHE_C_RANGE),
        "B_frac": rng.uniform(*K.B_FRAC_RANGE),
    }


def _draw_events(
    rng: np.random.Generator, geom: dict, horizon_s: float, gf: GroundField
) -> tuple[list[CollapseEvent], dict]:
    """
    Decide whether this mine collapses, and if so where, when and how hard.

    Each mine draws its OWN collapse probability from Beta(3, 2) and then flips
    that, rather than sharing one fixed rate across the dataset. Real sites
    differ in how failure-prone they are, and a single global rate would bake
    one base rate into the data. Mean is 0.60, so stable fully-censored mines
    remain plentiful (spec 5.2).

    Collapse sites are biased toward the panel edges, where the smooth bowl
    already puts the ground under the most curvature.
    """
    p_collapse = float(rng.beta(*K.COLLAPSE_PROB_BETA))
    collapses = bool(rng.random() < p_collapse)
    threshold_frac = rng.uniform(*K.FAILURE_THRESHOLD_FRAC_RANGE)
    peak_k = gf.peak_curvature()

    info = {
        "mine_collapses": collapses,
        "collapse_probability_drawn": p_collapse,
        "collapse_probability_prior": f"Beta{K.COLLAPSE_PROB_BETA}",
        "failure_threshold_frac_of_peak_curvature": threshold_frac,
        "peak_settled_curvature": peak_k,
        "failure_threshold_curvature": threshold_frac * peak_k,
    }
    if not collapses:
        info["n_events"] = 0
        return [], info

    n_ev = int(rng.integers(K.COLLAPSE_EVENTS_RANGE[0], K.COLLAPSE_EVENTS_RANGE[1] + 1))
    x1, y1 = geom["panel_x1"], geom["panel_y1"]
    x2, y2 = geom["panel_x2"], geom["panel_y2"]
    r = geom["r"]

    events: list[CollapseEvent] = []
    for i in range(n_ev):
        # bias toward an edge: pick an edge, then sit near it
        edge = rng.integers(0, 4)
        if edge == 0:
            ex, ey = x1 + rng.normal(0, 0.25 * r), rng.uniform(y1, y2)
        elif edge == 1:
            ex, ey = x2 + rng.normal(0, 0.25 * r), rng.uniform(y1, y2)
        elif edge == 2:
            ex, ey = rng.uniform(x1, x2), y1 + rng.normal(0, 0.25 * r)
        else:
            ex, ey = rng.uniform(x1, x2), y2 + rng.normal(0, 0.25 * r)

        severity = rng.uniform(*K.SEVERITY_RANGE)

        # Precursor must fit inside the horizon, and the collapse must land
        # late enough that there is precursor to observe but early enough that
        # the failure itself falls inside the run.
        precursor_days = rng.uniform(*K.PRECURSOR_DAYS_RANGE)
        precursor_s = min(precursor_days * 86400.0, 0.7 * horizon_s)
        t_collapse = rng.uniform(0.45 * horizon_s, 0.97 * horizon_s)
        t_collapse = max(t_collapse, precursor_s * 1.05)

        radius = rng.uniform(0.25, 0.75) * r
        extra = severity * rng.uniform(0.15, 0.55) * gf.S_max

        events.append(
            CollapseEvent(
                event_id=i,
                x=float(ex),
                y=float(ey),
                z=0.0,
                t_collapse_s=float(t_collapse),
                precursor_s=float(precursor_s),
                severity=float(severity),
                radius_m=float(radius),
                extra_subsidence_m=float(extra),
            )
        )

    info["n_events"] = len(events)
    return events, info


def generate_mine(seed: int, out_dir: Path, mine_id: str | None = None) -> dict:
    """Generate one complete mine and write its folder. Returns a summary dict."""
    rng = np.random.default_rng(seed)
    mine_id = mine_id or f"mine_{seed:05d}"
    mdir = out_dir / mine_id
    mdir.mkdir(parents=True, exist_ok=True)

    # ---- geometry and horizon -------------------------------------------
    geom = _draw_geometry(rng)
    horizon_days = rng.uniform(*K.HORIZON_DAYS_RANGE)
    horizon_s = horizon_days * 86400.0
    n_steps = int(round(horizon_s / K.DT_SECONDS))
    t_s = np.arange(n_steps, dtype=np.float64) * K.DT_SECONDS

    # ---- latent field, then events, then rebuild field with events -------
    gf = GroundField(
        x1=geom["panel_x1"], y1=geom["panel_y1"],
        x2=geom["panel_x2"], y2=geom["panel_y2"],
        H=geom["H"], tan_beta=geom["tan_beta"],
        seam_thickness=geom["seam_thickness"], a=geom["a"],
        c=geom["c"], B_frac=geom["B_frac"],
    )
    events, ev_info = _draw_events(rng, geom, horizon_s, gf)
    gf.events = events

    # ---- node placement --------------------------------------------------
    nodes, placement = build_layout(rng, geom)

    # ---- mesh topology (static DAG; no loss/death -- see deferred) -------
    links, mesh_meta = build_mesh(nodes)

    # ---- sensors ---------------------------------------------------------
    channels, sensor_meta = sensors.generate_readings(rng, nodes, gf, t_s, horizon_s)

    # ---- labels ----------------------------------------------------------
    label_arrays, label_meta = build_labels(nodes, gf, t_s, horizon_s)

    # ---- write nodes.parquet --------------------------------------------
    pq.write_table(
        pa.table({
            "node_id": pa.array([n.node_id for n in nodes], pa.int32()),
            "tier": pa.array([n.tier for n in nodes]),
            "node_type": pa.array([n.node_type for n in nodes]),
            "x": pa.array([n.x for n in nodes], pa.float64()),
            "y": pa.array([n.y for n in nodes], pa.float64()),
            "z": pa.array([n.z for n in nodes], pa.float64()),
        }),
        mdir / "nodes.parquet",
        compression="zstd",
    )

    # ---- write mesh.parquet (static topology, one row per node) ----------
    pq.write_table(
        pa.table({
            "node_id": pa.array([l.node_id for l in links], pa.int32()),
            "parent_id": pa.array([l.parent_id for l in links], pa.int32()),
            "backup_parent_id": pa.array([l.backup_parent_id for l in links], pa.int32()),
            "cluster_id": pa.array([l.cluster_id for l in links], pa.int32()),
            "hop_count": pa.array([l.hop_count for l in links], pa.int8()),
            "dist_to_parent_m": pa.array([l.dist_to_parent_m for l in links], pa.float64()),
            "dist_to_backup_m": pa.array([l.dist_to_backup_m for l in links], pa.float64()),
            "tx_power_dbm_nominal": pa.array(
                [l.tx_power_dbm_nominal for l in links], pa.float64()),
        }),
        mdir / "mesh.parquet",
        compression="zstd",
    )

    # ---- write readings.parquet (long format: one row per node-timestep) --
    n_nodes = len(nodes)
    node_ids = np.repeat(np.array([n.node_id for n in nodes], dtype=np.int32), n_steps)
    tiers_col = np.repeat(np.array([n.tier for n in nodes]), n_steps)
    ts_col = np.tile(t_s, n_nodes)

    cols: dict[str, pa.Array] = {
        "node_id": pa.array(node_ids, pa.int32()),
        "tier": pa.array(tiers_col),
        "t_s": pa.array(ts_col, pa.float64()),
    }
    for name in sensors.ALL_CHANNELS:
        cols[name] = pa.array(channels[name].ravel(), pa.float32())
    for name in ("truth_tilt_x_urad", "truth_tilt_y_urad",
                 "truth_strain_ue", "truth_subsidence_m"):
        cols[name] = pa.array(channels[name].ravel(), pa.float32())

    pq.write_table(pa.table(cols), mdir / "readings.parquet", compression="zstd")

    # ---- write labels.parquet -------------------------------------------
    pq.write_table(
        pa.table({
            "node_id": pa.array(node_ids, pa.int32()),
            "t_s": pa.array(ts_col, pa.float64()),
            "time_to_collapse_s": pa.array(
                label_arrays["time_to_collapse_s"].ravel(), pa.float32()),
            "censored_flag": pa.array(
                label_arrays["censored_flag"].ravel(), pa.int8()),
            "spatial_weight": pa.array(
                label_arrays["spatial_weight"].ravel(), pa.float32()),
        }),
        mdir / "labels.parquet",
        compression="zstd",
    )

    # ---- write collapse_events.parquet ----------------------------------
    pq.write_table(
        pa.table({
            "event_id": pa.array([e.event_id for e in events], pa.int32()),
            "x": pa.array([e.x for e in events], pa.float64()),
            "y": pa.array([e.y for e in events], pa.float64()),
            "z": pa.array([e.z for e in events], pa.float64()),
            "t_collapse_s": pa.array([e.t_collapse_s for e in events], pa.float64()),
            "precursor_s": pa.array([e.precursor_s for e in events], pa.float64()),
            "severity": pa.array([e.severity for e in events], pa.float64()),
            "radius_m": pa.array([e.radius_m for e in events], pa.float64()),
            "extra_subsidence_m": pa.array(
                [e.extra_subsidence_m for e in events], pa.float64()),
        }),
        mdir / "collapse_events.parquet",
        compression="zstd",
    )

    # ---- write metadata.json (spec 7.2: nothing implicit) ---------------
    metadata = {
        "schema_version": K.SCHEMA_VERSION,
        "mine_id": mine_id,
        "seed": int(seed),
        "units": {
            "distance": "m", "subsidence": "m (down positive)",
            "tilt": "urad", "acceleration": "g", "angular_rate": "deg/s",
            "strain": "ue", "fissure": "mm", "extensometer": "mm",
            "pore_pressure": "kPa", "moisture": "% VWC",
            "temperature": "degC", "vibration": "mm/s",
            "frequency": "Hz", "time": "s since mine t0",
        },
        "cadence": {
            "dt_s": K.DT_SECONDS,
            "horizon_days": horizon_days,
            "horizon_s": horizon_s,
            "n_steps": n_steps,
        },
        "geometry": geom,
        "derived": {
            "r_influence_m": gf.r,
            "S_max_m": gf.S_max,
            "B_m": gf.B,
        },
        "placement": placement,
        "collapse": ev_info,
        "events": [
            {
                "event_id": e.event_id, "x": e.x, "y": e.y, "z": e.z,
                "t_collapse_s": e.t_collapse_s, "precursor_s": e.precursor_s,
                "severity": e.severity, "radius_m": e.radius_m,
                "extra_subsidence_m": e.extra_subsidence_m,
            }
            for e in events
        ],
        "sensors": sensor_meta,
        "labels": label_meta,
        "noise_model": {
            "stage_order": list(sensors.N.STAGE_ORDER),
            "channels": {k: {"white_sigma": v[0], "drift_sigma_per_sqrt_day": v[1],
                             "temp_coeff_per_degC": v[2]}
                         for k, v in K.NOISE.items()},
            "quantisation_lsb": dict(K.QUANT),
            "temp_ref_c": K.TEMP_REF_C,
        },
        "tier_channels": {k: list(v) for k, v in sensors.TIER_CHANNELS.items()},
        "mesh": mesh_meta,
        "deferred": {
            "mesh_packet_loss": "Not simulated. Every node reports every 60 s, so "
                                "readings.parquet is a dense n_nodes x n_steps "
                                "rectangle. Deferred by decision to keep the "
                                "dataset simple; real deployments drop packets.",
            "node_death_at_collapse": "Not simulated. Nodes report through the "
                                      "collapse instead of being destroyed or "
                                      "orphaned. Deferred by decision; see "
                                      "MESH_UPGRADE_BRIEF.md 3.3 for the design "
                                      "if this is added later.",
        },
    }
    (mdir / "metadata.json").write_text(json.dumps(metadata, indent=2))

    return {
        "mine_id": mine_id,
        "seed": seed,
        "n_nodes": len(nodes),
        "n_steps": n_steps,
        "n_rows": len(nodes) * n_steps,
        "horizon_days": horizon_days,
        "collapses": ev_info["mine_collapses"],
        "n_events": ev_info["n_events"],
        "counts_by_tier": placement["counts_by_tier"],
        "n_clusters": mesh_meta["n_clusters"],
        "max_cluster_size": mesh_meta["max_cluster_size"],
        "dir": str(mdir),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate synthetic mine-collapse data.")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--n-mines", type=int, default=1)
    ap.add_argument("--out", type=Path, default=Path("dataset"))
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    for i in range(args.n_mines):
        summary = generate_mine(args.seed + i, args.out)
        print(json.dumps(summary))


if __name__ == "__main__":
    main()
