#!/usr/bin/env python3
"""Export the surface crack field and a blast PPV map (F10).

Deliberately NOT written into out/nodes.csv. That file's column order is frozen by
files/11-interface-contracts-v1.md section 7.1 ("Column order is binding; Part 2 parses
positionally"), so adding fissure and vibration channels to it is a contract amendment and
Adarsh's call, not a side effect of this step. Until that call is made these are their own output.

Usage:
    python scripts/export_cracks.py [--day 690] [--out out/cracks]
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
WALK_STEP_DAYS = 5.0     # how often the latch is advanced while walking a run; a crack that opens and
                         # closes entirely inside 5 days of face advance (55 m) is not a thing.
sys.path.insert(0, str(ROOT / "src"))

from minesim import cracks, physics, vibration  # noqa: E402
from minesim.config import load_config  # noqa: E402


def build_many(days, out_dir: Path, blast_kg: float, blast_xy, cell: float = None):
    """Export the latched crack field for several days in ONE walk of the run.

    The latch cannot be evaluated at an instant - it has to be walked forward from day 0 - so asking
    for four days separately would repeat that walk four times. Walking once and writing as each
    requested day goes past costs the same as the longest of them.

    Several days rather than one because the Scenario Lab can freeze ANY day, and without a baseline
    for that day it refuses to count new cracks (which is right, and useless in a demo).
    """
    return [build(float(d), out_dir, blast_kg, blast_xy, cell, _state=state)
            for d, state in _walked(sorted(float(d) for d in days), cell)]


def build(day: float, out_dir: Path, blast_kg: float, blast_xy, cell: float = None, _state=None):
    cfg = load_config()
    # S7: the export grid is config (cracks.export_cell_m), not a literal here. The Scenario Lab has to
    # resample from this grid onto its own 5 m one, so a number it cannot read is a number it guesses.
    cell = float(cfg.cracks.export_cell_m if cell is None else cell)
    margin = 2.0 * cfg.r
    xs = np.arange(-margin, cfg.panel.length_m + margin + cell, cell)
    ys = np.arange(-(cfg.panel.district_half_width_m + margin),
                   cfg.panel.district_half_width_m + margin + cell, cell)
    X, Y = np.meshgrid(xs, ys, indexing="ij")

    # Latched crack state: walk the whole run, because a latch cannot be evaluated at one instant.
    if _state is not None:
        fld = _state
    else:
        fld = cracks.CrackField.empty(X.shape)
        for t in np.arange(0.0, day + 1.0, WALK_STEP_DAYS):
            fld.update(X, Y, float(t), cfg)

    e1, e2, theta = physics.principal_strain(X, Y, day, cfg.panel, cfg.knothe)
    grade_idx = cracks.damage_grade_field(e1, cfg.damage.default_structure_length_m)

    src = vibration.VibrationSource(kind="blast", x_m=blast_xy[0], y_m=blast_xy[1], charge_kg=blast_kg)
    ppv = vibration.ppv_mm_s(X, Y, src, cfg)
    f_dom = vibration.dominant_frequency_hz("blast", cfg)
    over_domestic = vibration.exceeds_limit(ppv, "domestic", f_dom, cfg)

    caving = vibration.caving_events(cfg, day)

    out_dir.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        out_dir / f"crack_field_day{int(day):04d}.npz",
        x_m=xs, y_m=ys, cracked=fld.cracked, width_mm=fld.width_mm,
        max_width_mm=fld.max_width_mm, azimuth_deg=fld.azimuth_deg,
        first_cracked_day=fld.first_cracked_day,
        e1_ue=e1, e2_ue=e2, theta_deg=theta, damage_grade_idx=grade_idx,
        ppv_mm_s=ppv, ppv_over_domestic_limit=over_domestic,
    )

    band = cracks.width_sensitivity(X, Y, day, cfg)
    n_cracked = int(fld.cracked.sum())
    summary = {
        "day": day,
        "cell_m": cell,
        "provenance": "SIMULATED — derived from the fitted Knothe field; crack and vibration "
                      "parameters are OPEN — VERIFY placeholders, not measurements",
        "cells": int(fld.cracked.size),
        "cracked_cells": n_cracked,
        "cracked_area_ha": round(n_cracked * cell * cell / 10000.0, 2),
        "max_crack_width_mm": round(float(fld.width_mm.max()), 2),
        "max_ever_crack_width_mm": round(float(fld.max_width_mm.max()), 2),
        "width_sensitivity_to_B_mm": {k: round(float(v.max()), 2) for k, v in band.items()},
        "damage_grade_cells": {g: int((grade_idx == i).sum()) for i, g in enumerate(cracks.NCB_GRADES)},
        "blast": {"x_m": blast_xy[0], "y_m": blast_xy[1], "charge_kg": blast_kg,
                  "f_dom_hz": f_dom,
                  "ppv_max_mm_s": round(float(ppv.max()), 3),
                  "ppv_min_mm_s": round(float(ppv.min()), 4),
                  "cells_over_domestic_limit": int(over_domestic.sum()),
                  "dgms_domestic_limit_mm_s": vibration.dgms_limit_mm_s("domestic", f_dom, cfg)},
        "caving_events": len(caving),
        "first_caving_day": round(caving[0].t_days, 2) if caving else None,
    }
    (out_dir / f"summary_day{int(day):04d}.json").write_text(json.dumps(summary, indent=2))
    return summary


def _walked(days, cell):
    """Yield (day, latched CrackField) for each day, advancing one shared walk from day 0."""
    cfg = load_config()
    cell = float(cfg.cracks.export_cell_m if cell is None else cell)
    margin = 2.0 * cfg.r
    xs = np.arange(-margin, cfg.panel.length_m + margin + cell, cell)
    ys = np.arange(-(cfg.panel.district_half_width_m + margin),
                   cfg.panel.district_half_width_m + margin + cell, cell)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    fld = cracks.CrackField.empty(X.shape)
    walked_to = 0.0
    for day in days:
        for t in np.arange(walked_to, day + 1.0, WALK_STEP_DAYS):
            fld.update(X, Y, float(t), cfg)
        walked_to = day
        yield day, fld


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", default="690",
                    help="day to export, or several separated by commas (one shared walk)")
    ap.add_argument("--out", default="out/cracks")
    ap.add_argument("--blast-kg", type=float, default=50.0)
    ap.add_argument("--blast-x", type=float, default=1250.0)
    ap.add_argument("--blast-y", type=float, default=700.0)
    ap.add_argument("--cell", type=float, default=None,
                    help="export grid cell in m (default: cracks.export_cell_m in config/assumptions.yaml)")
    a = ap.parse_args()
    days = [float(d) for d in str(a.day).split(",") if d.strip()]
    out = build_many(days, ROOT / a.out, a.blast_kg, (a.blast_x, a.blast_y), a.cell)
    print(json.dumps(out[-1] if len(out) == 1 else out, indent=2))


if __name__ == "__main__":
    main()
