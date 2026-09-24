"""Print what one zone's ground is doing on a frozen day (P1).

There is no window yet - that is P4 - so this is how the zone maths gets checked by eye before a
page exists to draw it. Read-only: it opens a finished run, freezes a day, and prints numbers.

    python -m lab.tools.show_zone --run ../mine-sim/out/v2-690d --day 300 --zone 5
    python -m lab.tools.show_zone --run ../mine-sim/out/v2-690d --day 300 --zone full
    python -m lab.tools.show_zone --run ../mine-sim/out/v2-690d --day 300 --all

Every crack and damage number printed here comes from minesim.cracks through lab.cracks - there is
no second model (decision D-S1). Gate L8 is what proves that claim.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from lab import cracks as lab_cracks
from lab.fields import derive_fields, principal_from_fields
from lab.snapshot import load_snapshot
from lab.zones import boundary_fade_m, load_zone_config, zone_by_id, zones_for

# Definitions, not chosen values, so gate L4 has nothing to object to: a principal axis is defined
# modulo half a turn, and a crack opens a quarter turn away from the strain that opens it.
HALF_TURN_DEG = np.degrees(np.pi)
QUARTER_TURN_DEG = HALF_TURN_DEG / 2
M2_PER_KM2 = 1000 * 1000


def describe(snap, zone, zcfg) -> str:
    cfg, grid = snap.cfg, snap.grid
    fade = boundary_fade_m(cfg, zcfg)

    fields = derive_fields(snap.s_model_mm, grid.cell_m, cfg)
    e1_mm_per_m, _e2, theta_deg = principal_from_fields(fields)

    X, Y = grid.centres()
    inside = ((X >= zone.x0_m) & (X <= zone.x1_m) & (Y >= zone.y0_m) & (Y <= zone.y1_m))
    n = int(inside.sum())
    if n == 0:
        return f"{zone.label}: no grid cells inside it"

    e1 = e1_mm_per_m[inside]
    cracked = lab_cracks.cracked_mask(e1, cfg)
    width = lab_cracks.crack_width_mm(e1, cfg)
    grades = lab_cracks.damage_grades(e1, cfg)
    sink = snap.s_mm[inside]
    tilt = fields.tilt_mag_mm_per_m[inside]

    lines = [
        f"{zone.label}",
        f"  bounds            x {zone.x0_m:8.0f} .. {zone.x1_m:8.0f} m"
        f"   y {zone.y0_m:8.0f} .. {zone.y1_m:8.0f} m",
        f"  centre            ({zone.centre_m[0]:.0f}, {zone.centre_m[1]:.0f}) m"
        f"     boundary fade {fade:.0f} m",
        f"  cells             {n}  ({n * grid.cell_m * grid.cell_m / M2_PER_KM2:.3f} km2 "
        f"at {grid.cell_m:.0f} m)",
        f"  sinking           max {int(sink.max())} mm   mean {sink.mean():.0f} mm  (positive = down)",
        f"  tilt              max {tilt.max():.2f} mm/m",
        f"  principal strain  max {e1.max():+.2f} mm/m tension   min {e1.min():+.2f} mm/m",
        f"  cracked now       {int(cracked.sum())} of {n} cells "
        f"({cracked.mean():.1%}), threshold "
        f"{float(lab_cracks.to_mm_per_m(lab_cracks.crack_threshold_ue(cfg))):.1f} mm/m",
    ]
    if cracked.any():
        bearing = (theta_deg[inside][cracked] + QUARTER_TURN_DEG) % HALF_TURN_DEG
        lines += [
            f"  widest crack      {width.max():.1f} mm "
            f"(spacing {lab_cracks.crack_spacing_m(cfg):.0f} m)",
            f"  crack bearing     {np.median(bearing):.0f} deg median, "
            f"{bearing.min():.0f} .. {bearing.max():.0f} deg spread",
        ]
    else:
        lines.append("  widest crack      none - strain stays below the threshold in this zone")

    spread = {g: int((grades == i).sum()) for i, g in enumerate(lab_cracks.NCB_GRADES)}
    worst = [g for g in lab_cracks.NCB_GRADES if spread[g]]
    lines.append(f"  NCB damage        {', '.join(f'{g}: {spread[g]}' for g in worst)}")
    lines.append(f"  worst grade       {worst[-1] if worst else 'none'} "
                 f"(over a {cfg.damage.default_structure_length_m:.0f} m frontage)")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--run", required=True, type=Path, help="a finished run directory")
    ap.add_argument("--day", required=True, type=float)
    ap.add_argument("--zone", default=None, help="zone id: 1..n or the full-district id")
    ap.add_argument("--all", action="store_true", help="every zone in turn")
    a = ap.parse_args()
    if not a.all and a.zone is None:
        ap.error("give --zone or --all")

    snap = load_snapshot(a.run, a.day)
    zcfg = load_zone_config()
    print(f"run {snap.run_id}  mine {snap.mine}  day {snap.day:.0f}  "
          f"face at x = {snap.face_x_m:.0f} m  grid {snap.grid.shape} at {snap.grid.cell_m:.0f} m\n")

    wanted = zones_for(snap.cfg, snap.grid, zcfg) if a.all else [
        zone_by_id(a.zone, snap.cfg, snap.grid, zcfg)]
    for z in wanted:
        print(describe(snap, z, zcfg))
        print()


if __name__ == "__main__":
    main()
