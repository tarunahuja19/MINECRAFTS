#!/usr/bin/env python3
"""Scene exporter for Window 1 3D Consequence Renderer (WP8 / WP9).

Reads finished simulation run artefacts (npz, jsonl, nodes.csv, run_summary.json) and produces
renderer/scene/scene.json (static scene + frame index) and renderer/scene/frames/*.bin (one frame per
simulated day, frame_chunk_days per file) for Three.js rendering.

Safety & Contract Invariants:
- Invariant 1: World-state engine owns terrain truth.
- Invariant 4: No duplicate physics. Never import or call the longwall physics module here.
- Invariant 6: Provenance tags (real, pinned, synthetic) preserved on every node.
- Sign convention: negative = ground went down (negative_down).
"""

import argparse
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np
import yaml

from minesim.config import Config, load_config

SECONDS_PER_DAY = 86400.0


def load_renderer_config(config_path: Path) -> Dict[str, Any]:
    """Load configuration from renderer/config.yaml."""
    if not config_path.is_file():
        raise FileNotFoundError(f"renderer config not found: {config_path}")
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def read_snapshots_single_pass(
    run_dir: Path,
    target_epochs: Set[int],
    downsample_k: int = 2,
) -> Tuple[Dict[int, np.ndarray], Dict[int, np.ndarray], Dict[str, Any]]:
    """Read terrain_changes.jsonl ONCE, snapshotting full and downsampled grids at target epochs.

    Returns:
        (full_snapshots, downsampled_snapshots, metadata)
    """
    run_dir = Path(run_dir)
    npz_path = run_dir / "terrain_state.npz"
    if not npz_path.is_file():
        raise FileNotFoundError(f"Missing terrain_state.npz in {run_dir}")

    with np.load(npz_path) as s:
        z0 = s["z0_mm"].astype(np.int32).copy()
        metadata = {
            "origin_x_m": float(s["origin_x_m"]),
            "origin_y_m": float(s["origin_y_m"]),
            "cell_m": float(s["cell_m"]),
            "shape": [int(x) for x in s["shape"]],
        }

    full_snapshots: Dict[int, np.ndarray] = {}
    downsampled_snapshots: Dict[int, np.ndarray] = {}

    current_grid = z0.copy()

    # Day 0 / Epoch 0 snapshot before any deltas are applied
    if 0 in target_epochs:
        full_snapshots[0] = current_grid.copy()
        downsampled_snapshots[0] = current_grid[::downsample_k, ::downsample_k].copy()

    jsonl_path = run_dir / "terrain_changes.jsonl"
    if not jsonl_path.is_file():
        raise FileNotFoundError(f"Missing terrain_changes.jsonl in {run_dir}")

    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            record = json.loads(line)
            epoch = int(record["epoch"])
            cells = record.get("cells")
            if cells:
                ca = np.array(cells, dtype=np.int64)
                np.add.at(
                    current_grid,
                    (ca[:, 0], ca[:, 1]),
                    ca[:, 2].astype(np.int32),
                )
            if epoch in target_epochs:
                full_snapshots[epoch] = current_grid.copy()
                downsampled_snapshots[epoch] = current_grid[::downsample_k, ::downsample_k].copy()

    return full_snapshots, downsampled_snapshots, metadata


def _bilinear_cells(grid: np.ndarray, origin_x: float, origin_y: float, cell: float,
                    x: np.ndarray, y: np.ndarray, centred: bool) -> np.ndarray:
    """Bilinear sample of an (nx, ny) grid. centred=True: cell (i, j) centre is origin + (i + 0.5) * cell
    (world grid convention); False: sample (i, j) sits exactly at origin + i * cell (DEM convention)."""
    nx, ny = grid.shape
    shift = 0.5 if centred else 0.0
    fi = np.clip((np.asarray(x, dtype=float) - origin_x) / cell - shift, 0.0, nx - 1.0)
    fj = np.clip((np.asarray(y, dtype=float) - origin_y) / cell - shift, 0.0, ny - 1.0)
    i0 = np.minimum(np.floor(fi).astype(int), nx - 2)
    j0 = np.minimum(np.floor(fj).astype(int), ny - 2)
    wi, wj = fi - i0, fj - j0
    g = grid.astype(np.float64)
    return ((1 - wi) * (1 - wj) * g[i0, j0] + wi * (1 - wj) * g[i0 + 1, j0]
            + (1 - wi) * wj * g[i0, j0 + 1] + wi * wj * g[i0 + 1, j0 + 1])


def build_terrain_block(assumptions_file: Path, grid_meta: Dict[str, Any], downsample_k: int,
                        context_margin_m: float, extent: str = "full",
                        max_vertices: Optional[int] = None, cover_xy: Optional[np.ndarray] = None,
                        cover_pad_m: float = 0.0) -> Optional[Dict[str, Any]]:
    """Real ground elevation (DEM, metres AMSL) on the render grid, cell-aligned with the downsampled
    world grid so frame grids drop in by index. extent "full": every render cell inside the DEM;
    "margin": the world grid plus `context_margin_m` on every side (clipped to the DEM).
    Context only — the world grid still owns every change in Z.

    The margin is per side, not one symmetric number. `cover_xy` (planned node positions) widens only the
    sides that need it, so a node can never stand off the edge of the drawn ground: the gateway sits
    1097.9 m north, 423 m past the old symmetric 250 m margin, and floated in the void. Every other side
    still trims to context_margin_m. Widening is clipped to the DEM exactly as before, so this can never
    sample past real data."""
    if extent not in ("full", "margin"):
        raise ValueError(f"terrain_extent must be 'full' or 'margin', got {extent!r}")
    assumptions = yaml.safe_load(Path(assumptions_file).read_text())
    mine_yaml_path = Path(assumptions_file).parent / "mines" / f"{assumptions['mine']}.yaml"
    site = (yaml.safe_load(mine_yaml_path.read_text()) or {}).get("site") or {}
    if not site.get("dem_npz"):
        return None
    dem_path = Path(assumptions_file).parent.parent / site["dem_npz"]
    if not dem_path.is_file():
        return None
    with np.load(dem_path) as d:
        elev = d["elev_m"]
        dem_meta = json.loads(str(d["meta_json"]))
        dox, doy, dcell = float(d["origin_x_m"]), float(d["origin_y_m"]), float(d["cell_m"])
        dnx, dny = elev.shape
        dem_x_max, dem_y_max = dox + dcell * (dnx - 1), doy + dcell * (dny - 1)

    cell = grid_meta["cell_m"] * downsample_k
    first_x = grid_meta["origin_x_m"] + grid_meta["cell_m"] / 2.0    # centre of downsampled cell 0
    first_y = grid_meta["origin_y_m"] + grid_meta["cell_m"] / 2.0
    sim_nx = int(np.ceil(grid_meta["shape"][0] / downsample_k))
    sim_ny = int(np.ceil(grid_meta["shape"][1] / downsample_k))
    # cells that fit between the world grid and each DEM edge (never sample past the DEM)
    fit_x0 = int((first_x - dox) // cell)
    fit_x1 = int((dem_x_max - (first_x + (sim_nx - 1) * cell)) // cell)
    fit_y0 = int((first_y - doy) // cell)
    fit_y1 = int((dem_y_max - (first_y + (sim_ny - 1) * cell)) // cell)
    if extent == "margin":
        pad = int(np.ceil(context_margin_m / cell))
        want = [pad, pad, pad, pad]                      # x_low, x_high, y_low, y_high
        if cover_xy is not None and len(cover_xy):
            last_x, last_y = first_x + (sim_nx - 1) * cell, first_y + (sim_ny - 1) * cell
            need = (first_x - (cover_xy[:, 0].min() - cover_pad_m),
                    (cover_xy[:, 0].max() + cover_pad_m) - last_x,
                    first_y - (cover_xy[:, 1].min() - cover_pad_m),
                    (cover_xy[:, 1].max() + cover_pad_m) - last_y)
            want = [max(w, int(np.ceil(max(0.0, n) / cell))) for w, n in zip(want, need)]
        fit_x0, fit_x1, fit_y0, fit_y1 = (min(w, v) for w, v in zip(want, (fit_x0, fit_x1, fit_y0, fit_y1)))
    nx, ny = sim_nx + fit_x0 + fit_x1, sim_ny + fit_y0 + fit_y1
    if max_vertices is not None and nx * ny > max_vertices:
        # Not needed for the current DEM (see walkthrough F2); fail loudly rather than draw a mesh
        # the browser can't hold in one call.
        raise ValueError(f"terrain mesh {nx}x{ny} = {nx * ny} vertices exceeds terrain_max_vertices "
                         f"{max_vertices}; downsample the context area or use terrain_extent: margin")
    xs = first_x + (np.arange(nx) - fit_x0) * cell
    ys = first_y + (np.arange(ny) - fit_y0) * cell
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    z = _bilinear_cells(elev, dox, doy, dcell, X, Y, centred=False)
    return {
        "provenance": dem_meta.get("provenance", "real"),
        "source": dem_meta.get("source"),
        "source_url": dem_meta.get("source_url"),
        "fetched_utc": dem_meta.get("fetched_utc"),
        "site": {"lat_deg": site.get("panel_centre_lat_deg"), "lon_deg": site.get("panel_centre_lon_deg")},
        "extent": extent,
        "dem_extent_m": {"x_min": dox, "x_max": dem_x_max, "y_min": doy, "y_max": dem_y_max},
        "cell_m": cell,
        "first_x_m": round(float(xs[0]), 3),
        "first_y_m": round(float(ys[0]), 3),
        "shape": [nx, ny],
        "sim_offset": [fit_x0, fit_y0],        # frame grid cell (i, j) = terrain cell (i + pad_x, j + pad_y)
        "elev_dm": np.rint(z * 10.0).astype(np.int32).tolist(),
    }


PROV_CODES = {"none": 0, "real": 1, "pinned": 2, "synthetic": 3, "undelivered": 4}
INT16_MAX = 32767


# Every per-node channel the simulator writes to nodes.csv, in the order they are packed into
# telem_DDDD.bin. Subsidence keeps its own plane (readings/prov) because the ground colouring reads
# it every frame; these are the rest of the maths the inspector had been throwing away.
TELEMETRY_CHANNELS = ("tilt_x_urad", "tilt_y_urad", "strain_ustrain", "disp_mm", "battery_mv", "rssi_dbm")
NO_PARENT = 65535           # uint16 sentinel: the row had no parent_used (gateway, or blank cell)
FLAG_DELIVERED = 1          # bit 0
FLAG_VIA_EMERGENCY = 2      # bit 1


def read_daily_readings(run_dir: Path, day_of_epoch: Dict[int, int], plan_index: Dict[int, int],
                        n_days: int) -> Dict[str, np.ndarray]:
    """One pass over nodes.csv: every plan node's telemetry at each day's epoch.

    Returns the planes written to the frame files — `readings`/`prov` (subsidence and where it came
    from), `telem` (TELEMETRY_CHANNELS, NaN where the sensor wrote nothing), `link` (the parent the
    packet actually went through) and `flags` (delivered / emergency slot). Every value is the
    simulator's own output, copied as written; nothing here is recomputed or filled in."""
    n = len(plan_index)
    readings = np.full((n_days, n), np.nan, dtype=np.float32)
    prov = np.zeros((n_days, n), dtype=np.uint8)
    telem = np.full((n_days, n, len(TELEMETRY_CHANNELS)), np.nan, dtype=np.float32)
    link = np.full((n_days, n), NO_PARENT, dtype=np.uint16)
    flags = np.zeros((n_days, n), dtype=np.uint8)
    with open(Path(run_dir) / "nodes.csv", "r", encoding="utf-8") as f:
        header = f.readline().rstrip("\n").split(",")
        c_ep, c_id, c_sub, c_prov, c_del = (header.index(k) for k in
                                            ("epoch", "node_id", "subsidence_mm", "subsidence_prov", "delivered"))
        c_telem = [header.index(k) for k in TELEMETRY_CHANNELS]
        c_par, c_emg = header.index("parent_used"), header.index("via_emergency")
        for line in f:
            day = day_of_epoch.get(int(line[:line.index(",")]))
            if day is None:
                continue
            row = line.rstrip("\n").split(",")
            k = plan_index.get(int(row[c_id]))
            if k is None:
                continue
            if row[c_sub]:
                readings[day, k] = float(row[c_sub])
            delivered = row[c_del].strip().lower() == "true"
            prov[day, k] = PROV_CODES.get(row[c_prov], PROV_CODES["none"]) if delivered \
                else PROV_CODES["undelivered"]
            for q, c in enumerate(c_telem):
                if row[c]:
                    telem[day, k, q] = float(row[c])
            if row[c_par]:
                link[day, k] = int(float(row[c_par]))
            flags[day, k] = (FLAG_DELIVERED if delivered else 0) \
                | (FLAG_VIA_EMERGENCY if row[c_emg].strip().lower() == "true" else 0)
    return {"readings": readings, "prov": prov, "telem": telem, "link": link, "flags": flags}


def write_daily_frames(run_dir: Path, frames_dir: Path, n_days: int, epoch_of_day: List[int], k: int,
                       dtype: str, chunk_days: int, grid_meta: Dict[str, Any], plan_xy: Optional[np.ndarray],
                       planes: Dict[str, np.ndarray]) -> Dict[str, Any]:
    """Read terrain_changes.jsonl ONCE and write one frame per day, chunk_days days per file:
    grid_DDDD.bin (downsampled world grid, integer mm), nodes_DDDD.bin (live dZ at each plan node, float32),
    readings_DDDD.bin (float32), prov_DDDD.bin (uint8), telem_DDDD.bin (float32, TELEMETRY_CHANNELS
    interleaved per node), link_DDDD.bin (uint16 parent_used) and flags_DDDD.bin (uint8).
    DDDD = first day in the file."""
    frames_dir.mkdir(parents=True, exist_ok=True)
    for old in frames_dir.glob("*.bin"):
        old.unlink()
    with np.load(Path(run_dir) / "terrain_state.npz") as s:
        grid = s["z0_mm"].astype(np.int32).copy()
    nx_f, ny_f = grid.shape
    ox, oy, cell = grid_meta["origin_x_m"], grid_meta["origin_y_m"], grid_meta["cell_m"]
    n_nodes = 0 if plan_xy is None else len(plan_xy)
    if n_nodes:
        inside = ((plan_xy[:, 0] >= ox) & (plan_xy[:, 0] <= ox + nx_f * cell)
                  & (plan_xy[:, 1] >= oy) & (plan_xy[:, 1] <= oy + ny_f * cell))
    ds_shape = grid[::k, ::k].shape
    chunks: List[Dict[str, Any]] = []
    stats = {"max_one_day_cell_change_mm": 0, "max_one_day_node_change_mm": 0.0, "frames_bytes": 0}
    prev_full, prev_nodes = None, None
    buf_grid = np.empty((chunk_days,) + ds_shape, dtype=np.int32)
    buf_nodes = np.zeros((chunk_days, n_nodes), dtype=np.float32)

    def record(day: int) -> None:
        nonlocal prev_full, prev_nodes
        q = day % chunk_days
        buf_grid[q] = grid[::k, ::k]
        if n_nodes:
            dz = _bilinear_cells(grid, ox, oy, cell, plan_xy[:, 0], plan_xy[:, 1], centred=True)
            buf_nodes[q] = np.where(inside, dz, 0.0)
        if prev_full is not None:
            stats["max_one_day_cell_change_mm"] = max(stats["max_one_day_cell_change_mm"], int(np.abs(grid - prev_full).max()))
            if n_nodes:
                stats["max_one_day_node_change_mm"] = max(stats["max_one_day_node_change_mm"],
                                                          round(float(np.abs(buf_nodes[q] - prev_nodes).max()), 2))
        prev_full = grid.copy()
        prev_nodes = buf_nodes[q].copy()
        if q == chunk_days - 1 or day == n_days - 1:
            flush(day - q, q + 1)

    def flush(first: int, count: int) -> None:
        g = buf_grid[:count]
        if dtype == "int16":
            peak = int(np.abs(g).max()) if g.size else 0
            if peak > INT16_MAX:
                raise ValueError(f"grid value {peak} mm does not fit int16 (days {first}-{first + count - 1})")
        files = {
            "grid": (g.astype("<i2" if dtype == "int16" else "<i4"), f"grid_{first:04d}.bin"),
            "nodes": (buf_nodes[:count].astype("<f4"), f"nodes_{first:04d}.bin"),
            "readings": (planes["readings"][first:first + count].astype("<f4"), f"readings_{first:04d}.bin"),
            "prov": (planes["prov"][first:first + count].astype("u1"), f"prov_{first:04d}.bin"),
            "telem": (planes["telem"][first:first + count].astype("<f4"), f"telem_{first:04d}.bin"),
            "link": (planes["link"][first:first + count].astype("<u2"), f"link_{first:04d}.bin"),
            "flags": (planes["flags"][first:first + count].astype("u1"), f"flags_{first:04d}.bin"),
        }
        entry: Dict[str, Any] = {"first_day": first, "days": count}
        for key, (arr, name) in files.items():
            path = frames_dir / name
            path.write_bytes(np.ascontiguousarray(arr).tobytes())
            stats["frames_bytes"] += path.stat().st_size
            entry[key] = f"{frames_dir.name}/{name}"
        chunks.append(entry)

    day = 0
    if epoch_of_day[0] == 0:
        record(0)
        day = 1
    with open(Path(run_dir) / "terrain_changes.jsonl", "r", encoding="utf-8") as f:
        for line in f:
            if day >= n_days:
                break
            rec = json.loads(line)
            cells = rec.get("cells")
            if cells:
                ca = np.array(cells, dtype=np.int64)
                np.add.at(grid, (ca[:, 0], ca[:, 1]), ca[:, 2].astype(np.int32))
            while day < n_days and int(rec["epoch"]) == epoch_of_day[day]:
                record(day)
                day += 1
    if day != n_days:
        raise ValueError(f"terrain_changes.jsonl ended at day {day}, expected {n_days} daily frames")
    return {"chunks": chunks, "stats": stats, "shape": list(ds_shape)}


def export_scene(
    run_dir: Path,
    out_file: Optional[Path] = None,
    config_path: Optional[Path] = None,
    assumptions_path: Optional[Path] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Export scene.json (static: terrain, geometry, plan, frame index) and, when out_file is given,
    the daily binary frames next to it in frames/.

    Returns:
        (scene_data_dict, frames_stats) — frames_stats is empty when out_file is None (no frames written)
    """
    t_start = time.time()
    run_dir = Path(run_dir)
    config_path = config_path or Path("renderer/config.yaml")
    renderer_cfg = load_renderer_config(config_path)

    assumptions_file = assumptions_path or Path(renderer_cfg.get(
        "assumptions_path", "mine-sim/config/assumptions.yaml"
    ))
    cfg: Config = load_config(assumptions_file)

    day_step_days = int(renderer_cfg["day_step_days"])
    if day_step_days != 1:
        raise ValueError("day_step_days must be 1: frames are daily (F4)")
    chunk_days = int(renderer_cfg["frame_chunk_days"])
    downsample_k = int(renderer_cfg.get("downsample_cells", 2))
    vertical_exag = float(renderer_cfg.get("vertical_exaggeration", 10.0))
    context_margin_m = float(renderer_cfg["context_margin_m"])
    cover_planned_nodes = bool(renderer_cfg.get("cover_planned_nodes", True))
    node_ground_pad_m = float(renderer_cfg.get("node_ground_pad_m", 60.0))
    terrain_extent = str(renderer_cfg["terrain_extent"])
    terrain_max_vertices = int(renderer_cfg["terrain_max_vertices"])
    plan_path = Path(renderer_cfg.get("plan_path", "mine-sim/out/plan/node_plan.json"))

    summary_path = run_dir / "run_summary.json"
    if not summary_path.is_file():
        raise FileNotFoundError(f"Missing run_summary.json in {run_dir}")
    with open(summary_path, "r", encoding="utf-8") as f:
        summary = json.load(f)

    total_days = float(summary["days"])
    timestep_s = float(summary["timestep_s"])
    advance_rate = float(cfg.knothe.advance_m_per_day)
    panel_length = float(cfg.panel.length_m)
    panel_width = float(cfg.panel.width_m)

    n_days = int(np.floor(total_days)) + 1                       # days 0 .. floor(total)
    epoch_of_day = [int(round(d * SECONDS_PER_DAY / timestep_s)) for d in range(n_days)]
    with np.load(run_dir / "terrain_state.npz") as s:
        grid_meta = {"origin_x_m": float(s["origin_x_m"]), "origin_y_m": float(s["origin_y_m"]),
                     "cell_m": float(s["cell_m"]), "shape": [int(x) for x in s["shape"]]}
        z0_peak = int(np.abs(s["z0_mm"]).max()) if s["z0_mm"].size else 0
    # Grid values are z0 + accumulated dZ; the run summary bounds the dZ part.
    bound = z0_peak + abs(int(summary.get("peak_subsidence_mm", 0)))
    grid_dtype = "int16" if bound <= INT16_MAX else "int32"

    plan = json.loads(plan_path.read_text()) if plan_path.is_file() else None
    plan_xy = np.array([[n["x_m"], n["y_m"]] for n in plan["nodes"]]) if plan is not None else None

    downsampled_shape = [
        int(np.ceil(grid_meta["shape"][0] / downsample_k)),
        int(np.ceil(grid_meta["shape"][1] / downsample_k)),
    ]
    frames: Dict[str, Any] = {
        "day_step_days": 1,
        "n_days": n_days,
        "chunk_days": chunk_days,
        "max_chunks_in_memory": int(renderer_cfg["frame_max_chunks_in_memory"]),
        "epoch_of_day": epoch_of_day,
        "face_x_m": [round(min(advance_rate * d, panel_length), 2) for d in range(n_days)],
        "grid": {"dtype": grid_dtype, "shape": downsampled_shape,
                 "order": "little-endian, C order [day, i, j]: i along x, j along y; world-grid Z in integer mm "
                          "(negative = down), downsampled z[::k, ::k]"},
        "nodes": {"dtype": "float32", "count": 0 if plan is None else len(plan["nodes"]),
                  "order": "little-endian [day, plan node index]; live world-grid dZ at the node, mm, bilinear, 0 outside the grid"},
        "readings": {"dtype": "float32",
                     "order": "little-endian [day, plan node index]; nodes.csv subsidence_mm at the day's epoch (sensor reading), NaN if none"},
        "prov": {"dtype": "uint8", "order": "[day, plan node index]", "codes": {str(v): k for k, v in PROV_CODES.items()}},
        # The rest of what the simulator computed per node. The inspector reads these instead of
        # falling back to the planner's static peak values.
        "telemetry": {"dtype": "float32", "channels": list(TELEMETRY_CHANNELS),
                      "order": "little-endian [day, plan node index, channel]; nodes.csv value as written, "
                               "NaN where that node wrote no value that day"},
        "link": {"dtype": "uint16", "no_parent": NO_PARENT,
                 "order": "[day, plan node index]; nodes.csv parent_used — the parent the packet actually took"},
        "flags": {"dtype": "uint8", "bits": {"delivered": FLAG_DELIVERED, "via_emergency": FLAG_VIA_EMERGENCY},
                  "order": "[day, plan node index]"},
        "chunks": [],
    }
    frames_info: Dict[str, Any] = {}
    if out_file is not None:
        plan_index = {int(n["node_id"]): q for q, n in enumerate(plan["nodes"])} if plan is not None else {}
        planes = read_daily_readings(run_dir, {e: d for d, e in enumerate(epoch_of_day)}, plan_index, n_days)
        frames_info = write_daily_frames(run_dir, Path(out_file).parent / "frames", n_days, epoch_of_day,
                                         downsample_k, grid_dtype, chunk_days, grid_meta, plan_xy, planes)
        frames["chunks"] = frames_info["chunks"]
        frames["stats"] = frames_info["stats"]

    scene_data = {
        "schema_version": 2,
        "mode": "SIMULATED",
        "label": "SIMULATED",
        "data_label": "synthetic simulator output, not field measurements",
        "mine": summary.get("fit", {}).get("mine", "adriyala_lw1"),
        "vertical_exaggeration": vertical_exag,
        "run": {"days": total_days, "timestep_s": timestep_s, "scouts": summary.get("scouts"),
                "delivery_rate": summary.get("delivery_rate")},
        "grid": {
            "origin_x_m": grid_meta["origin_x_m"],
            "origin_y_m": grid_meta["origin_y_m"],
            "cell_m": round(grid_meta["cell_m"] * downsample_k, 3),
            "original_cell_m": grid_meta["cell_m"],
            "downsample_k": downsample_k,
            "shape": downsampled_shape,
        },
        "panel": {
            "length_m": panel_length,
            "width_m": panel_width,
            "advance_m_per_day": advance_rate,
        },
        "frames": frames,
    }

    scene_data["geometry"] = {
        "panel_length_m": panel_length,
        "panel_width_m": panel_width,
        "depth_m": float(cfg.panel.depth_m),
        "seam_thickness_m": float(cfg.panel.seam_thickness_m),
        "seam_inclination_deg": float(cfg.panel.seam_inclination_deg),
        "inflection_offset_m": float(cfg.panel.inflection_offset_m),
        "influence_radius_m": round(float(cfg.r), 2),
        "survey_line_x_m": cfg.survey_line_x_m,
        "advance_direction_deg": float(cfg.panel.advance_direction_deg),
        "detection_threshold_mm": float(cfg.sensing.detection_threshold_mm),
        "peak_subsidence_mm": float(summary.get("peak_subsidence_mm", 0.0)),
        "display_name": summary.get("fit", {}).get("mine", "adriyala_lw1"),
    }
    cover_xy = None
    if cover_planned_nodes and plan is not None and plan.get("nodes"):
        cover_xy = np.array([[float(n["x_m"]), float(n["y_m"])] for n in plan["nodes"]], dtype=float)
    terrain = build_terrain_block(assumptions_file, grid_meta, downsample_k, context_margin_m,
                                  terrain_extent, terrain_max_vertices, cover_xy, node_ground_pad_m)
    if terrain is not None:
        scene_data["terrain"] = terrain
    if plan is not None:
        scene_data["plan"] = plan

    node_models = dict(renderer_cfg.get("node_models", {}))
    node_models["antenna_height_m"] = {
        "scout": float(cfg.radio.antenna_height_m["scout"]),
        "anchor": float(cfg.radio.antenna_height_m["anchor"]),
        "gateway": float(cfg.radio.antenna_height_m["gateway"]),
    }
    node_models["strain_rod_baseline_m"] = float(cfg.sensing.strain_rod_baseline_m)
    node_models["extensometer_baseline_m"] = float(cfg.sensing.extensometer_baseline_m)
    scene_data["node_models"] = node_models

    scene_data["zoom"] = dict(renderer_cfg["zoom"])
    scene_data["playback"] = dict(renderer_cfg["playback"])

    display_cfg = dict(renderer_cfg.get("display", {}))
    if display_cfg:
        scene_data["display"] = display_cfg

    if out_file is not None:
        out_path = Path(out_file)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(scene_data, f, separators=(",", ":"))
        file_size_mb = out_path.stat().st_size / (1024 * 1024)
        elapsed_s = time.time() - t_start
        st = frames_info["stats"]
        print(f"Exported scene to {out_path} ({file_size_mb:.2f} MB) + {len(frames_info['chunks'])} chunk sets "
              f"({st['frames_bytes'] / 1048576:.1f} MB, {n_days} daily frames, grid {grid_dtype}) in {elapsed_s:.2f} s; "
              f"largest one-day change: cell {st['max_one_day_cell_change_mm']} mm, node {st['max_one_day_node_change_mm']} mm")

    return scene_data, frames_info


def main() -> None:
    parser = argparse.ArgumentParser(description="Export 3D consequence scene from simulation output.")
    parser.add_argument(
        "--run",
        type=str,
        default=None,
        help="Path to simulation run folder (e.g. mine-sim/out/v2-690d)",
    )
    parser.add_argument(
        "--out",
        type=str,
        default="renderer/scene/scene.json",
        help="Output path for scene.json (default: renderer/scene/scene.json)",
    )
    parser.add_argument(
        "--config",
        type=str,
        default="renderer/config.yaml",
        help="Path to renderer config (default: renderer/config.yaml)",
    )
    args = parser.parse_args()

    cfg_file = Path(args.config)
    renderer_cfg = load_renderer_config(cfg_file)
    run_dir = Path(args.run or renderer_cfg.get("run_dir", "mine-sim/out/v2-690d"))
    out_file = Path(args.out)

    export_scene(run_dir=run_dir, out_file=out_file, config_path=cfg_file)


if __name__ == "__main__":
    main()
