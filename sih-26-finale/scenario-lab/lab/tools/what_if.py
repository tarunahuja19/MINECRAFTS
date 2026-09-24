"""Print what a scenario does to the ground and to the village, in words (P2 hand check).

There is no window yet — that is P4. This is the same maths the window will call, printed, so the
numbers can be read and argued with before anything is drawn.

    python -m lab.tools.what_if --run ../mine-sim/out/v2-690d --day 300 --zone 5 --event crack

Nothing here writes anything. It freezes a finished run on a copy in memory and reads it.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from lab import vibration as lab_vib
from lab.consequence import evaluate
from lab.events import EVENTS
from lab.objects import objects_or_none
from lab.snapshot import load_snapshot
from lab.zones import confine_to_zone, resolve_click, zone_by_id

BANNER = "SCENARIO (HYPOTHETICAL) — not a forecast, not sent to the backend or to any model"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run", required=True, help="a finished run directory, e.g. mine-sim/out/v2-690d")
    ap.add_argument("--day", type=float, required=True, help="the day to freeze at")
    ap.add_argument("--zone", default="full", help="zone id: 1..10, or 'full'")
    ap.add_argument("--event", default="crack", choices=sorted(EVENTS), help="which event to run")
    ap.add_argument("--param", action="append", default=[], metavar="NAME=VALUE",
                    help="an event parameter, repeatable (e.g. --param days_ahead=45)")
    ap.add_argument("--no-vibration", action="store_true", help="leave out the shaking layer")
    args = ap.parse_args()

    params = dict(p.split("=", 1) for p in args.param)
    params = {k: float(v) for k, v in params.items()}

    snap = load_snapshot(Path(args.run), args.day)
    zone = zone_by_id(args.zone, snap.cfg, snap.grid)
    objects = objects_or_none(snap.cfg, snap.grid)

    print(f"\n{BANNER}")
    print(f"{snap.mine}  ·  run {snap.run_id}  ·  frozen at day {snap.day:.0f}  ·  "
          f"face at {snap.face_x_m:.0f} m")
    print(f"{zone.label}  ·  {args.event}  ·  {params or 'defaults'}")
    if snap.crack_baseline is None:
        print(f"\n  ⚠ {snap.crack_baseline_reason}")
    else:
        print(f"\n  crack history: {snap.crack_baseline.cracked_cells} cells already cracked at day "
              f"{snap.crack_baseline.day}")

    result = confine_to_zone(EVENTS[args.event](snap, *resolve_click(zone), params), zone, snap)
    print(f"\n  {'CAN HAPPEN' if result.possible else 'CANNOT HAPPEN'}: {result.reason}")
    if not result.possible:
        return 1

    layer = ({} if args.no_vibration
             else lab_vib.caving_ppv_field(snap.grid, snap.cfg, snap.day))
    after = snap.s_model_mm + np.asarray(result.ds_mm, dtype=np.float64)
    out = evaluate(snap.s_model_mm, after, snap.grid, snap.cfg, snap.lab,
                   crack_baseline=snap.crack_baseline, ppv_mm_s=layer.get("ppv_mm_s"),
                   f_dom_hz=layer.get("f_dom_hz"), objects=objects)

    print("\n  WHAT HAPPENS")
    for line in out["summary"]["plain"]:
        print(f"    · {line}")

    c = out["cracks"]
    print(f"\n  CRACKS  (threshold {c['threshold_mm_per_m']} mm/m, one fissure per "
          f"{c['spacing_m']:.0f} m of stretched ground)")
    print(f"    open after: {c['after_count']} cells · new: {c['new_count']} · "
          f"widest: {c['widest_mm']:.0f} mm · lines drawn: {c['segments_shown']} of "
          f"{c['segments_total']}")
    for seg in c["segments"][:snap.lab.preview_rows]:
        print(f"      {seg['width_mm']:5.0f} mm at ({seg['x0_m']:.0f}, {seg['y0_m']:.0f}) m, "
              f"running {seg['bearing_deg']:.0f}° {'— NEW' if seg['new'] else ''}")

    if out["vibration"]:
        v = out["vibration"]
        print(f"\n  SHAKING  peak {v['max_ppv_mm_s']} mm/s at {v['f_dom_hz']:.0f} Hz · "
              f"limits {v['limits_mm_s']} · over the domestic limit: {v['over_domestic_limit']}")

    print("\n  WHAT IS BUILT ON IT")
    for obj in out["objects"]:
        print(f"    · {obj['plain']}")
    if objects:
        print(f"\n  ({objects[0].layout_note})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
