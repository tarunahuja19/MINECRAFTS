#!/usr/bin/env python3
"""D1 (DATA-365 plan): build the real-anchored 365-day Adriyala district dataset.

Runs the session offline, hourly, for 365 days, with ground=district (the
real Adriyala LW1 fit plus its two synthetic panels, G1/G2) and the E1
environment attached, and NO FORGE events.

Output directory: simulation/datasets/adriyala_district_365/
Files written:
1. nodes_hourly.csv.gz: one row per (hour, node). Columns:
   t_hour, day, iso_time, node_id, tier, then every sensor channel the tick produces
   (read dynamically from tick output), then provenance ("LW1_fit" for ground tiers,
   "E1_environment" for pore pressure, "LW1_fit,E1_environment" for moisture/fault).
   A channel the tier has no sensor for is empty (null), never 0.
2. bowl_terms.npz: px = district.bowl_terms_px() (3x121), py = array of
   district.bowl_terms_py(day) for day 0..365 (366x3x121), face = district.face_positions(day)
   per day.
3. events.csv: t_hour, type, node_id, detail.
   Types: face_position, blast, fault, crack_open.
4. meta.json: seed, all district/ADRIYALA_FIT parameters (constants.py),
   sources (DOI 10.18311/jmmf/2022/32099), SHA-256 of each file above, the RMS
   of the model against the JMMF survey points, and a per-node table of first
   day reaching ADVISORY, WARNING, CRITICAL using sandbox.thresholds.classify.
5. README.md: what each file is, columns with units, how to rebuild, and that
   ground is real LW1 fit while LW0/LW2 are SYNTHETIC.

Make the output deterministic: fixed seed, sorted rows, gzip with mtime=0,
no timestamps from the wall clock. Two builds must give identical SHA-256.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import sys
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from sandbox import district, thresholds
from sandbox.constants import (
    DISTRICT_PANEL_X_M,
    DISTRICT_PROVENANCE,
    DISTRICT_START_DAY,
    FIT_A_SUBS,
    FIT_C_KNOTHE,
    FIT_FACE_ADVANCE_M_PER_DAY,
    FIT_FACE_START_Y_M,
    FIT_INFLECTION_OFFSET_M,
    FIT_M_SEAM_M,
    FIT_R_INFL,
    FIT_SOURCE_DOI,
    FIT_TAN_BETA,
    H_DEPTH_M,
    L_PANEL_M,
    W_PANEL_M,
)
from sandbox.session import SessionConfig, SimulationSession

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR_DEFAULT = Path(__file__).resolve().parent.parent / "datasets" / "adriyala_district_365"
_SURVEY_CSV = REPO_ROOT / "sih-26-finale" / "mine-sim" / "data" / "real" / "adriyala_lw1_profiles.csv"
_SURVEY_LINE_X_M = 258.0
_SURVEY_ORIGIN_OFFSET_M = 13.47

BASE_ISO = "2026-01-01T00:00:00Z"
LEVEL_RANK = {"NORMAL": 0, "ADVISORY": 1, "WARNING": 2, "CRITICAL": 3}
LEVELS_ABOVE_NORMAL = ("ADVISORY", "WARNING", "CRITICAL")


def get_provenance(tier: str) -> str:
    """Provenance tag per tier: LW1_fit for ground, E1_environment for pore/moisture."""
    if tier == "2B":
        return "E1_environment"
    elif tier == "1C":
        return "LW1_fit,E1_environment"
    else:
        return "LW1_fit"


def _format_cell(val: Any) -> str:
    """Format a cell value for CSV. None becomes empty string; floats formatted cleanly."""
    if val is None:
        return ""
    if isinstance(val, (float, np.floating)):
        return f"{val:.2f}"
    return str(val)


def _sha256(path: Path) -> str:
    """Deterministic SHA-256 of file bytes."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_survey_csv() -> list[tuple[float, float, float]]:
    rows = []
    with open(_SURVEY_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append((float(row["distance_m"]), float(row["epoch_days"]), float(row["subsidence_mm"])))
    return rows


def rms_against_survey() -> dict[str, float] | None:
    """RMS of LW1-alone against the digitised JMMF CSV at epochs 210/300 (G1).

    Same recipe as tests/test_district.py::test_rms_against_survey_csv.
    Returns None if the CSV is absent.
    """
    if not _SURVEY_CSV.is_file():
        return None
    rows = _load_survey_csv()
    sandbox_y_survey = _SURVEY_LINE_X_M + FIT_FACE_START_Y_M
    out: dict[str, float] = {}
    for epoch in (210.0, 300.0):
        sel = [r for r in rows if r[1] == epoch]
        if not sel:
            continue
        distance_m = np.array([r[0] for r in sel])
        measured_mm = np.array([r[2] for r in sel])
        sandbox_x = distance_m - _SURVEY_ORIGIN_OFFSET_M
        model_mm = district.subsidence_mm(
            sandbox_x,
            np.full_like(sandbox_x, sandbox_y_survey),
            epoch,
            y_offsets_m=(0.0,),
            start_day_offsets_d=(0.0,),
        )
        out[f"epoch_{int(epoch)}"] = round(float(np.sqrt(np.mean((-model_mm - measured_mm) ** 2))), 2)
    return out


def build_dataset(
    out_dir: Path,
    days: int = 365,
    seed: int = 42,
    verbose: bool = False,
) -> dict[str, Any]:
    """Build the complete dataset deterministically.

    Writes to `out_dir`:
    - nodes_hourly.csv.gz
    - bowl_terms.npz
    - events.csv
    - meta.json
    - README.md
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    num_hours = days * 24

    with tempfile.TemporaryDirectory() as tmp_dir:
        cfg = SessionConfig(
            ground="district",
            seed=seed,
            tick_duration_sim_s=3600.0,
            save_packet_json=False,
            out_dir=Path(tmp_dir),
            base_iso_time=BASE_ISO,
            enable_mqtt=False,
            enable_db=False,
            quiet=True,
            write_nodes_csv=False,
        )
        session = SimulationSession(cfg)
        session.start()

        # Step 1: Discover channel keys dynamically from tick output
        session.tick()
        first_readings = session.last_readings
        channel_keys = sorted({k for r in first_readings for k in r.channels.keys()})
        header = ["t_hour", "day", "iso_time", "node_id", "tier"] + channel_keys + ["provenance"]

        # Rewind session to start cleanly from hour 0
        session = SimulationSession(cfg)
        session.start()

        gz_path = out_dir / "nodes_hourly.csv.gz"
        first_crack_open: dict[int, tuple[int, float, int]] = {}
        first_advisory_day: dict[int, int] = {}
        first_warning_day: dict[int, int] = {}
        first_critical_day: dict[int, int] = {}

        # 7-day pore pressure baseline cache (hours 0..167)
        pore_pressure_7d: dict[int, list[float]] = {r.node_id: [] for r in first_readings}
        pore_baseline_7d: dict[int, float] = {}

        # Memory buffer for readings over each day to compute daily alarm classification
        day_readings_buffer: list[dict[int, Any]] = []

        with open(gz_path, "wb") as f_raw:
            with gzip.GzipFile(filename="", mode="wb", fileobj=f_raw, mtime=0.0) as gz:
                with io.TextIOWrapper(gz, encoding="utf-8", newline="") as f_out:
                    writer = csv.writer(f_out)
                    writer.writerow(header)

                    for h in range(num_hours):
                        session.tick()
                        readings = sorted(session.last_readings, key=lambda r: r.node_id)
                        day = h // 24
                        iso_time = session.get_iso_time(h * 3600.0)

                        r_map: dict[int, Any] = {}
                        for r in readings:
                            nid = r.node_id
                            r_map[nid] = r

                            # Check crack opening
                            fissure_val = r.channels.get("fissure_mm")
                            if fissure_val is not None and fissure_val > 0.0 and nid not in first_crack_open:
                                cat = thresholds.crack_category(float(fissure_val))
                                first_crack_open[nid] = (h, float(fissure_val), cat)

                            # Record pore pressure for baseline in first 168 hours
                            if h < 168:
                                pp = r.channels.get("pore_pressure_kpa")
                                if pp is not None:
                                    pore_pressure_7d[nid].append(float(pp))

                            # Write row
                            row = [h, day, iso_time, nid, r.tier]
                            for k in channel_keys:
                                row.append(_format_cell(r.channels.get(k)))
                            row.append(get_provenance(r.tier))
                            writer.writerow(row)

                        day_readings_buffer.append(r_map)

                        # End of day: classify worst condition per node for this day
                        if (h + 1) % 24 == 0 or h == num_hours - 1:
                            if not pore_baseline_7d and h >= min(167, num_hours - 1):
                                pore_baseline_7d = {
                                    nid: (float(np.mean(vals)) if vals else 0.0)
                                    for nid, vals in pore_pressure_7d.items()
                                }

                            for nid in r_map.keys():
                                worst_day_level = "NORMAL"
                                for hour_map in day_readings_buffer:
                                    node_r = hour_map[nid]

                                    # 1. Tilt change since install (mm/m)
                                    tx = node_r.channels.get("tilt_x_urad")
                                    ty = node_r.channels.get("tilt_y_urad")
                                    if tx is not None or ty is not None:
                                        tilt_mm_m = math.hypot(tx or 0.0, ty or 0.0) / 1000.0
                                        lvl = thresholds.classify("tilt_change", tilt_mm_m)
                                        if LEVEL_RANK[lvl] > LEVEL_RANK[worst_day_level]:
                                            worst_day_level = lvl

                                    # 2. Tensile and compressive strain (mm/m)
                                    str_ue = node_r.channels.get("strain_ue")
                                    if str_ue is not None:
                                        str_mm_m = float(str_ue) / 1000.0
                                        if str_mm_m >= 0:
                                            lvl = thresholds.classify("strain_tensile", str_mm_m)
                                        else:
                                            lvl = thresholds.classify("strain_compressive", -str_mm_m)
                                        if LEVEL_RANK[lvl] > LEVEL_RANK[worst_day_level]:
                                            worst_day_level = lvl

                                    # 3. Crack width (mm)
                                    fiss = node_r.channels.get("fissure_mm")
                                    if fiss is not None and fiss > 0.0:
                                        lvl = thresholds.classify("crack_width", float(fiss))
                                        if LEVEL_RANK[lvl] > LEVEL_RANK[worst_day_level]:
                                            worst_day_level = lvl

                                    # 4. Pore pressure rise over 7d baseline (kPa)
                                    pp = node_r.channels.get("pore_pressure_kpa")
                                    if pp is not None and pore_baseline_7d:
                                        rise = float(pp) - pore_baseline_7d.get(nid, 0.0)
                                        if rise > 0.0:
                                            lvl = thresholds.classify("pore_pressure_rise", rise)
                                            if LEVEL_RANK[lvl] > LEVEL_RANK[worst_day_level]:
                                                worst_day_level = lvl

                                # Record first crossing days
                                if LEVEL_RANK[worst_day_level] >= LEVEL_RANK["ADVISORY"] and nid not in first_advisory_day:
                                    first_advisory_day[nid] = day
                                if LEVEL_RANK[worst_day_level] >= LEVEL_RANK["WARNING"] and nid not in first_warning_day:
                                    first_warning_day[nid] = day
                                if LEVEL_RANK[worst_day_level] >= LEVEL_RANK["CRITICAL"] and nid not in first_critical_day:
                                    first_critical_day[nid] = day

                            day_readings_buffer.clear()

                        if verbose and (h + 1) % (24 * 30) == 0:
                            print(f"[D1] day {(h + 1) // 24}/{days}", file=sys.stderr)

        # Step 2: bowl_terms.npz
        px = np.array(district.bowl_terms_px(), dtype=np.float64)
        py = np.array([district.bowl_terms_py(float(d)) for d in range(days + 1)], dtype=np.float64)
        face = np.array([district.face_positions(float(d)) for d in range(days + 1)], dtype=np.float64)
        npz_path = out_dir / "bowl_terms.npz"
        np.savez_compressed(npz_path, px=px, py=py, face=face)

        # Step 3: events.csv
        events_path = out_dir / "events.csv"
        event_rows: list[dict[str, Any]] = []

        # (a) face_position daily (3 panels)
        for d in range(days):
            t_h = d * 24
            faces_d = district.face_positions(float(d))
            for p, face_y in enumerate(faces_d):
                event_rows.append({
                    "t_hour": t_h,
                    "type": "face_position",
                    "node_id": f"LW{p}",
                    "detail": f"panel=LW{p} face_y_m={face_y:.2f}",
                })

        # (b) blast (from environment)
        env = session._environment
        for b in env.blasts:
            if b.t_hour < num_hours:
                event_rows.append({
                    "t_hour": b.t_hour,
                    "type": "blast",
                    "node_id": "",
                    "detail": f"q_kg={b.q_kg:.1f} x_m={b.x_m:.1f} y_m={b.y_m:.1f} z_m={b.z_m:.1f}",
                })

        # (c) fault (battery_replaced, offline_start/end, gauge_stuck_start/end, gateway_outage_start/end)
        fault_type_map = {
            "battery_replaced": "battery_replaced",
            "node_offline": "offline_start",
            "node_restored": "offline_end",
            "sensor_stuck": "gauge_stuck_start",
            "sensor_unstuck": "gauge_stuck_end",
            "gateway_outage": "gateway_outage_start",
            "gateway_restored": "gateway_outage_end",
        }
        for ev in env.events:
            t_h = ev["t_hour"]
            if t_h < num_hours:
                raw_type = ev["type"]
                subtype = fault_type_map.get(raw_type, raw_type)
                event_rows.append({
                    "t_hour": t_h,
                    "type": "fault",
                    "node_id": str(ev.get("node_id", "") or ""),
                    "detail": f"{subtype}: {ev['detail']}",
                })

        # (d) crack_open
        for nid, (h_open, width_val, cat_val) in first_crack_open.items():
            if h_open < num_hours:
                event_rows.append({
                    "t_hour": h_open,
                    "type": "crack_open",
                    "node_id": str(nid),
                    "detail": f"width_mm={width_val:.3f} burland_category={cat_val}",
                })

        # Sort deterministically
        event_rows.sort(key=lambda r: (r["t_hour"], r["type"], r["node_id"], r["detail"]))

        with open(events_path, "w", newline="", encoding="utf-8") as f_ev:
            w_ev = csv.DictWriter(f_ev, fieldnames=["t_hour", "type", "node_id", "detail"])
            w_ev.writeheader()
            w_ev.writerows(event_rows)

        # Step 4: meta.json
        meta_path = out_dir / "meta.json"
        all_node_ids = sorted([r.node_id for r in first_readings])
        sensing_node_ids = [nid for nid in all_node_ids if nid != 31]

        node_table: dict[str, dict[str, int | None]] = {}
        for nid in all_node_ids:
            node_table[str(nid)] = {
                "ADVISORY": first_advisory_day.get(nid),
                "WARNING": first_warning_day.get(nid),
                "CRITICAL": first_critical_day.get(nid),
            }

        warning_nodes = sorted([nid for nid in sensing_node_ids if nid in first_warning_day])
        critical_nodes = sorted([nid for nid in sensing_node_ids if nid in first_critical_day])

        files_meta = {
            "nodes_hourly.csv.gz": {
                "sha256": _sha256(gz_path),
                "bytes": gz_path.stat().st_size,
            },
            "bowl_terms.npz": {
                "sha256": _sha256(npz_path),
                "bytes": npz_path.stat().st_size,
            },
            "events.csv": {
                "sha256": _sha256(events_path),
                "bytes": events_path.stat().st_size,
            },
        }

        rms = rms_against_survey()

        meta = {
            "dataset": "adriyala_district_365",
            "seed": seed,
            "days": days,
            "tick_duration_sim_s": 3600.0,
            "base_iso_time": BASE_ISO,
            "ground": "district",
            "sources": {
                "doi": FIT_SOURCE_DOI,
                "citation": "Ramalingeswarudu et al. (2022), JMMF, DOI 10.18311/jmmf/2022/32099",
                "note": "LW1 is pinned to 283 digitised survey points; LW0 and LW2 are SYNTHETIC.",
            },
            "parameters": {
                "fit_a_subs": FIT_A_SUBS,
                "fit_tan_beta": FIT_TAN_BETA,
                "fit_c_knothe": FIT_C_KNOTHE,
                "fit_m_seam_m": FIT_M_SEAM_M,
                "fit_inflection_offset_m": FIT_INFLECTION_OFFSET_M,
                "fit_face_advance_m_per_day": FIT_FACE_ADVANCE_M_PER_DAY,
                "fit_r_infl": FIT_R_INFL,
                "fit_face_start_y_m": FIT_FACE_START_Y_M,
                "h_depth_m": H_DEPTH_M,
                "w_panel_m": W_PANEL_M,
                "l_panel_m": L_PANEL_M,
                "district_panel_x_m": list(DISTRICT_PANEL_X_M),
                "district_start_day": list(DISTRICT_START_DAY),
                "district_provenance": list(DISTRICT_PROVENANCE),
            },
            "rms_against_survey_mm": rms,
            "files": files_meta,
            "node_first_alarm_day": node_table,
            "nodes_reaching_warning_or_above": warning_nodes,
            "nodes_reaching_critical": critical_nodes,
            "n_sensing_nodes": len(sensing_node_ids),
            "n_warning_or_above": len(warning_nodes),
            "n_critical": len(critical_nodes),
        }

        meta_path.write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n", encoding="utf-8")

        # Step 5: README.md
        readme_path = out_dir / "README.md"
        readme_content = f"""# Adriyala District 365-Day Dataset

Deterministic offline 365-day dataset (D1, DATA-365 plan) for the 31-node Adriyala
monitoring network, generated by `simulation/scripts/build_dataset_365.py`.

## Physical Provenance & Ground Model
- **Ground**: Real Adriyala LW1 fit pinned to 283 digitised survey points from
  Ramalingeswarudu et al. (2022), DOI {FIT_SOURCE_DOI} (RMS 56.9 mm at epoch 210,
  52.1 mm at epoch 300). Panels LW0 and LW2 are SYNTHETIC neighbours with identical
  geometry staggered across strike and time (`DISTRICT_PANEL_X_M = (-290, 0, 290)` m,
  `DISTRICT_START_DAY = (-120, 0, 120)` days).
- **Environment**: Seeded 365-day weather and hydrogeology model (`sandbox/environment.py`),
  seed {seed}.
- **Sensors**: Honest noise budgets, USBM vibration attenuation, principal strain,
  latched fissure opening, and environmental pore pressure / soil moisture.

## Files
1. `nodes_hourly.csv.gz`:
   - Hourly telemetry for all 31 nodes across {days} days ({num_hours * 31:,} rows).
   - Columns: `t_hour`, `day`, `iso_time`, `node_id`, `tier`, channel columns, `provenance`.
   - Channels:
     - `tilt_x_urad`, `tilt_y_urad` (urad): biaxial tilt change since install on day 0
     - `strain_ue` (microstrain, ue): principal surface strain
     - `fissure_mm` (mm): latched surface fissure opening
     - `accel_x_mg`, `accel_y_mg`, `accel_z_mg` (mg): triaxial MEMS acceleration
     - `gyro_x_mdps`, `gyro_y_mdps`, `gyro_z_mdps` (mdps): angular rate
     - `vib_rms_x100`, `vib_peak_x100` (0.01 mm/s): vibration RMS and peak
     - `vib_fdom_hz` (Hz): dominant vibration frequency
     - `pore_pressure_kpa` (kPa): piezometric pore pressure (Tier 2B only)
     - `moisture_pct` (%): volumetric soil moisture content (Tier 1C only)
     - `ext_delta_10um` (10 um): extensometer displacement (Tier 1C only)
     - `borehole_tilt_d1..d4` (urad): in-place inclinometer tilt (Tier 2B only)
     - `gps_dx_mm`, `gps_dy_mm`, `gps_dz_mm` (mm): GNSS displacements (Tier 3 gateway)
     - `die_temp_dc` (0.1 degC): sensor die temperature
   - Nulls: empty string `""` where a node tier carries no sensor for that channel. Never 0.
   - `provenance`: `"LW1_fit"` for ground tiers, `"E1_environment"` for pore pressure,
     `"LW1_fit,E1_environment"` for fault transect (1C).
2. `bowl_terms.npz`:
   - `px`: shape (3, 121), static across-strike terms for the 3 panels.
   - `py`: shape ({days + 1}, 3, 121), daily along-strike terms for day 0..{days}.
   - `face`: shape ({days + 1}, 3), daily face coordinates (y_m) for the 3 panels.
3. `events.csv`:
   - Operational and hazard event timeline: `t_hour`, `type`, `node_id`, `detail`.
   - Types:
     - `face_position`: daily advance of the 3 panel faces
     - `blast`: heading development blasts with charge weight and 3D hypocenter
     - `fault`: hardware incidents (`battery_replaced`, `offline_start/end`,
       `gauge_stuck_start/end`, `gateway_outage_start/end`)
     - `crack_open`: first hour a node detects surface crack opening with Burland damage category
4. `meta.json`:
   - Parameters, survey RMS, file SHA-256 hashes, and per-node first alarm crossing days.

## Alarm Coverage ({days} Days)
- Sensing nodes: {len(sensing_node_ids)} (nodes 1..30)
- Reaching >= WARNING: {len(warning_nodes)} / {len(sensing_node_ids)}
- Reaching CRITICAL: {len(critical_nodes)} ({critical_nodes})

## Rebuilding
```bash
cd simulation && .venv/bin/python scripts/build_dataset_365.py --days {days} --seed {seed}
```
Output is 100% deterministic: identical parameters produce identical SHA-256 hashes.
"""
        readme_path.write_text(readme_content, encoding="utf-8")

        total_bytes = sum(p.stat().st_size for p in out_dir.glob("*") if p.is_file())
        return {
            "out_dir": out_dir,
            "days": days,
            "seed": seed,
            "total_bytes": total_bytes,
            "meta": meta,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(OUT_DIR_DEFAULT), help="output directory")
    parser.add_argument("--days", type=int, default=365, help="number of days to simulate (default: 365)")
    parser.add_argument("--seed", type=int, default=42, help="simulation seed (default: 42)")
    parser.add_argument("--verbose", action="store_true", help="print progress during simulation")
    args = parser.parse_args()

    out_dir = Path(args.out)
    print(f"[D1] building {args.days} days ({args.days * 24} ticks), seed={args.seed} -> {out_dir}")
    result = build_dataset(out_dir, days=args.days, seed=args.seed, verbose=args.verbose)
    meta = result["meta"]
    print(f"[D1] completed. Total directory size: {result['total_bytes'] / 1e6:.2f} MB")
    print(f"[D1] sensing nodes reaching >= WARNING: {meta['n_warning_or_above']} / {meta['n_sensing_nodes']}")
    print(f"[D1] sensing nodes reaching CRITICAL: {meta['n_critical']} (nodes: {meta['nodes_reaching_critical']})")


if __name__ == "__main__":
    main()
