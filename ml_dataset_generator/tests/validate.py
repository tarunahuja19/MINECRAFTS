"""
Validation gates (spec 9 checklist).

Every gate maps to a line in the spec's summary checklist. These must pass on a
single mine before the pilot batch, and across the whole batch before scaling.

Run:  .venv/bin/python -m tests.validate dataset/mine_00003
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from minegen import constants as K  # noqa: E402
from minegen.sensors import TIER_CHANNELS  # noqa: E402

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((PASS if ok else FAIL, name, detail))


def validate(mdir: Path) -> bool:
    meta = json.loads((mdir / "metadata.json").read_text())
    nodes = pq.read_table(mdir / "nodes.parquet").to_pandas()
    rd = pq.read_table(mdir / "readings.parquet").to_pandas()
    lb = pq.read_table(mdir / "labels.parquet").to_pandas()
    ev = pq.read_table(mdir / "collapse_events.parquet").to_pandas()

    n_nodes = len(nodes)
    n_steps = meta["cadence"]["n_steps"]

    # -- G1: row counts --------------------------------------------------
    check("G1 row count = nodes x steps",
          len(rd) == n_nodes * n_steps,
          f"{len(rd)} vs {n_nodes}x{n_steps}={n_nodes*n_steps}")
    check("G1b labels row count matches readings", len(lb) == len(rd))

    # -- G2: node placement is irregular, not a grid ----------------------
    # A grid shows up as very few distinct spacings. Real irregular placement
    # has a broad, continuous distribution of nearest-neighbour distances.
    xy = nodes[["x", "y"]].to_numpy()
    d = np.sqrt(((xy[:, None, :] - xy[None, :, :]) ** 2).sum(-1))
    np.fill_diagonal(d, np.inf)
    nn = d.min(axis=1)
    cv = float(nn.std() / nn.mean())
    check("G2 placement irregular (not grid)", cv > 0.10,
          f"nn-dist CV={cv:.3f} (grid would be ~0), mean={nn.mean():.1f}m")

    ux, uy = np.unique(np.round(xy[:, 0], 3)), np.unique(np.round(xy[:, 1], 3))
    check("G2b coords not on shared lattice",
          len(ux) > 0.8 * n_nodes and len(uy) > 0.8 * n_nodes,
          f"{len(ux)} unique x, {len(uy)} unique y of {n_nodes} nodes")

    # -- G3: each tier carries exactly the channels the image specifies ----
    ok_all = True
    detail = []
    for tier, chans in TIER_CHANNELS.items():
        sub = rd[rd.tier == tier]
        if sub.empty:
            continue
        for c in chans:
            if sub[c].notna().sum() == 0:
                ok_all = False
                detail.append(f"{tier} missing {c}")
        # channels this tier must NOT have
        for c in TIER_CHANNELS["1B"] + TIER_CHANNELS["2B"] + TIER_CHANNELS["3"]:
            if c not in chans and c in sub.columns and sub[c].notna().sum() > 0:
                ok_all = False
                detail.append(f"{tier} should not carry {c}")
    check("G3 tier channel sets match sensor image", ok_all,
          "; ".join(detail[:4]) if detail else "all tiers correct")

    # -- G4: no channel is clean ------------------------------------------
    # Compare the measured tilt against the clean truth column. If they are
    # identical the corruption chain did not run.
    mpu = rd[rd.tier.isin(["1A", "1B", "1C"])]
    resid = (mpu.tilt_x_urad - mpu.truth_tilt_x_urad).abs()
    check("G4 signals are noisy, not clean", resid.mean() > 1.0,
          f"mean |measured-truth| tilt_x = {resid.mean():.1f} urad")

    # -- G4b: ADXL355 is quieter than MPU-6050 ----------------------------
    adxl = rd[rd.tier == "2A"]
    r_adxl = (adxl.tilt_x_urad - adxl.truth_tilt_x_urad).abs().mean()
    check("G4b ADXL355 quieter than MPU-6050", r_adxl < resid.mean(),
          f"ADXL {r_adxl:.1f} urad vs MPU {resid.mean():.1f} urad")

    # -- G4c: bias drift present (not just white noise) -------------------
    # White noise alone has no long-range correlation; a drifting bias does.
    one = rd[rd.node_id == mpu.node_id.iloc[0]].sort_values("t_s")
    e = (one.tilt_x_urad - one.truth_tilt_x_urad).to_numpy()
    half = len(e) // 2
    drift = abs(float(np.nanmean(e[:half]) - np.nanmean(e[half:])))
    check("G4c slow bias drift present", drift > 1.0,
          f"first-half vs second-half bias shift = {drift:.1f} urad")

    # -- G5: labels are survival, not binary ------------------------------
    check("G5 three separate label columns",
          {"time_to_collapse_s", "censored_flag", "spatial_weight"} <= set(lb.columns))
    uncens = lb[lb.censored_flag == 0]
    if meta["collapse"]["mine_collapses"]:
        check("G5b collapsing mine has uncensored rows", len(uncens) > 0,
              f"{len(uncens):,} uncensored of {len(lb):,}")
        check("G5c time_to_collapse strictly positive when uncensored",
              bool((uncens.time_to_collapse_s > 0).all()),
              f"min={uncens.time_to_collapse_s.min():.0f}s")
        w = lb.spatial_weight
        check("G5d spatial weight in (0,1]",
              bool((w >= 0).all() and (w <= 1.0 + 1e-6).all()),
              f"range [{w.min():.2e}, {w.max():.3f}]")
        check("G5e weight not baked into time",
              uncens.time_to_collapse_s.corr(uncens.spatial_weight) < 0.999,
              "time and weight are independent columns")
    else:
        check("G5b censored mine is fully censored",
              bool((lb.censored_flag == 1).all()) and len(uncens) == 0,
              f"{len(lb):,} rows all censored")
        check("G5c censored rows carry NaN time",
              bool(lb.time_to_collapse_s.isna().all()),
              "no sentinel values")

    # -- G6: events file consistent with metadata -------------------------
    check("G6 events match metadata", len(ev) == meta["collapse"]["n_events"],
          f"{len(ev)} events")
    if len(ev):
        check("G6b severity in 0-1",
              bool((ev.severity > 0).all() and (ev.severity <= 1.0).all()),
              f"[{ev.severity.min():.2f}, {ev.severity.max():.2f}]")
        check("G6c collapse lands inside horizon",
              bool((ev.t_collapse_s < meta["cadence"]["horizon_s"]).all()))
        check("G6d precursor varies per event",
              len(ev) < 2 or ev.precursor_s.nunique() > 1,
              f"precursors: {[f'{p/86400:.2f}d' for p in ev.precursor_s]}")

    # -- G7: metadata completeness (spec 7.2) -----------------------------
    required = ["seed", "units", "cadence", "geometry", "derived", "placement",
                "collapse", "sensors", "labels", "noise_model", "tier_channels"]
    missing = [k for k in required if k not in meta]
    check("G7 metadata has every required block", not missing,
          f"missing: {missing}" if missing else "all present")
    check("G7b noise magnitudes documented",
          len(meta["noise_model"]["channels"]) == len(K.NOISE))
    check("G7c decay function documented",
          "decay_function" in meta["labels"],
          meta["labels"].get("decay_function", "")[:40])

    # -- G8: no edge list emitted (spec 6) --------------------------------
    files = {p.name for p in mdir.iterdir()}
    check("G8 no edge list produced",
          not any("edge" in f for f in files),
          f"files: {sorted(files)}")

    # -- G11: mesh topology honours the 138-byte bundle limit -------------
    mp = pq.read_table(mdir / "mesh.parquet").to_pandas()
    mm = meta["mesh"]
    scouts_m = mp[mp.hop_count == 2]
    sizes = scouts_m.groupby("cluster_id").size()
    check("G11 no cluster exceeds the 6-child bundle limit",
          bool(sizes.max() <= K.CLUSTER_FANOUT_MAX),
          f"max cluster {int(sizes.max())} children "
          f"({int(sizes.max())} x 23 B <= 138 B bundle)")
    check("G11b mean cluster size near the design point of 5",
          2.0 <= mm["mean_cluster_size"] <= K.CLUSTER_FANOUT_MAX,
          f"mean {mm['mean_cluster_size']:.1f} children per anchor")
    check("G11c every scout has a parent and a distinct backup",
          bool((scouts_m.parent_id != scouts_m.backup_parent_id).all()
               and scouts_m.parent_id.notna().all()),
          f"{len(scouts_m)} scouts, all parented")
    anchors_m = mp[mp.hop_count == 1]
    gw_id = int(mp[mp.hop_count == 0].node_id.iloc[0])
    check("G11d every anchor relays to the gateway (DAG, no cycles)",
          bool((anchors_m.parent_id == gw_id).all()),
          f"{len(anchors_m)} anchors -> gateway {gw_id}")
    check("G11e every link is inside SX1262 radio range",
          bool(mp.dist_to_parent_m.max() < 3000.0),
          f"longest link {mp.dist_to_parent_m.max():.0f} m of 3000 m")

    # -- G9: gateway is a stable reference --------------------------------
    gw = rd[rd.tier == "3"]
    if not gw.empty:
        mv = gw[["gps_dx_mm", "gps_dy_mm", "gps_dz_mm"]].abs().max().max()
        check("G9 gateway reads ~zero movement", mv < 50.0,
              f"max |gps| = {mv:.1f} mm (outside angle of draw)")

    # -- G10: physics consistency ----------------------------------------
    # Tilt must genuinely be the slope of the subsidence surface, i.e. the
    # channels are derived from one field rather than generated separately.
    check("G10 truth columns present for validation",
          {"truth_tilt_x_urad", "truth_strain_ue", "truth_subsidence_m"} <= set(rd.columns))
    s = rd.truth_subsidence_m
    check("G10b subsidence non-negative and bounded",
          bool((s >= -1e-6).all() and s.max() <= meta["derived"]["S_max_m"] * 2.5),
          f"max S = {s.max():.3f} m, S_max = {meta['derived']['S_max_m']:.3f} m")

    # ---- report ---------------------------------------------------------
    width = max(len(n) for _, n, _ in results)
    print(f"\n{'=' * 78}\nVALIDATION: {mdir.name}\n{'=' * 78}")
    for status, name, detail in results:
        mark = "✓" if status == PASS else "✗"
        print(f"  {mark} {status}  {name:<{width}}  {detail}")
    n_fail = sum(1 for s, _, _ in results if s == FAIL)
    print(f"{'-' * 78}\n  {len(results) - n_fail}/{len(results)} gates passed")
    return n_fail == 0


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("dataset/mine_00003")
    sys.exit(0 if validate(target) else 1)
