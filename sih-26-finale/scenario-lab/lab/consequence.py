"""From "the ground moved like this" to "this is what it did" — one place, for every scenario (P2).

This is the module that makes the Scenario Lab worth having. Everything before it produces fields:
subsidence, tilt, curvature, strain. Nobody can act on a field. What people can act on is "House H1:
slight -> severe", "the road opens a 40 mm crack", "the tower's top moves 63 mm sideways" — and the
whole point of routing every scenario, and later every forecast, through ONE evaluate() is that those
sentences are produced the same way every time, from the same thresholds, whoever asked.

THE FOUR THINGS IT IS CAREFUL ABOUT
-----------------------------------
1. CRACKS ARE LINES, NOT CELLS (Adarsh, session 26: "line for crack"). A crack opens perpendicular to
   the major principal tensile strain, so each one gets a bearing from the strain tensor rather than
   being drawn as a coloured square. Squares would also imply the whole cell is cracked, when what the
   model says is that one fissure runs through it.

2. NEW CRACKS ARE COUNTED AGAINST THE LATCHED STATE, never against an instantaneous "before"
   (hazard H5, see lab/baseline.py). Without the exported baseline the count is NOT PRINTED and the
   reason is, because a plausible wrong count is worse than a missing one.

3. DERIVATIVES COME FROM THE FLOAT SURFACE. derive_fields refuses an int array outright (gate L5):
   rounding to whole millimetres on 5 m cells produces strain errors larger than the true peak.

4. EVERY THRESHOLD IS THE SIMULATOR'S. Crack threshold, spacing, NCB edges, DGMS limits — all read
   through lab/cracks.py and lab/vibration.py from mine-sim's config. Gate L8-3 asserts they are the
   same objects, not copies that agree today.

Signature note: S0 §S1 wrote this as evaluate(before, after, grid, cfg, crack_baseline, ppv, band).
It also takes the LAB config, because the display choices (how many crack lines to draw, how near a
road a crack counts as being in it) are lab numbers and gate L4 forbids them being literals here.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np

from lab import cracks as lab_cracks
from lab.fields import derive_fields, principal_from_fields
from lab.objects import MineObject
from lab.sampling import distance_to_polyline_m, sample
from lab.vibration import dgms_limits

NO_FORECAST = "No forecast covers this object"
NCB_SOURCE = ("NCB Subsidence Engineers' Handbook change-of-length grades, "
              "mine-sim/config/assumptions.yaml damage: (OPEN — VERIFY)")
CRACK_SOURCE = ("tensile strain threshold and crack spacing, "
                "mine-sim/config/assumptions.yaml cracks: (OPEN — VERIFY)")
DGMS_SOURCE = "DGMS (Tech) Circular 7 of 1997 PPV limits, mine-sim/config/assumptions.yaml vibration:"
HALF_TURN_DEG = np.degrees(np.pi)      # a crack is a line, so its bearing lives in [0, 180)


def evaluate(before_s_float_mm, after_s_float_mm, grid, cfg, lab, crack_baseline=None,
             ppv_mm_s=None, f_dom_hz: Optional[float] = None, mask=None,
             objects: Optional[List[MineObject]] = None) -> Dict[str, Any]:
    """The consequences of going from `before` to `after` (both mm, POSITIVE DOWN, float, full grid).

    `mask` marks cells where there IS an answer (used by the forecast view, where a cell too far from
    any node has no prediction). `ppv_mm_s` is the vibration layer, if there is one; it never changes
    the ground.

    Returns the `cracks`, `objects`, `vibration` and `summary` parts of the WP9 §7 result. Arrays stay
    positive-down here — the sign flip to negative-down happens once, at the JSON boundary, in P3.
    """
    # Convert only AFTER the float check below, never before it: np.asarray(int_array, float64)
    # succeeds silently, and doing it here would launder the int-mm world grid into something
    # derive_fields accepts, defeating gate L5 at the one boundary the int grid can reach.
    before = _float_surface(before_s_float_mm, "before")
    after = _float_surface(after_s_float_mm, "after")
    fb = derive_fields(before, grid.cell_m, cfg)
    fa = derive_fields(after, grid.cell_m, cfg)
    e1b, e2b, _theta_b = principal_from_fields(fb)
    e1a, e2a, theta_a = principal_from_fields(fa)

    crack_part = _cracks(e1a, e1b, theta_a, grid, cfg, lab, crack_baseline)
    vib_part = _vibration(ppv_mm_s, cfg, f_dom_hz)
    obj_part = [_object_answer(obj, grid, lab, cfg, before, after, fb, fa, e1b, e2b, e1a, e2a,
                              crack_part["width_mm_after"], crack_part["width_mm_before"],
                              ppv_mm_s, f_dom_hz, mask)
                for obj in (objects or [])]

    ds = after - before
    summary = {
        "max_extra_sinking_mm": _round(float(np.max(ds)) if ds.size else 0.0),
        "max_tilt_mm_per_m": _round(float(np.max(fa.tilt_mag_mm_per_m)) if ds.size else 0.0),
        "max_tensile_strain_mm_per_m": _round(float(np.max(e1a)) if ds.size else 0.0),
        "new_cracks": crack_part["new_count"],
        "widest_crack_mm": crack_part["widest_mm"],
        "objects_worse": sum(1 for o in obj_part if o.get("worse")),
        "plain": [],
    }
    summary["plain"] = _summary_sentences(summary, crack_part, vib_part, obj_part)
    out = {"cracks": {k: v for k, v in crack_part.items() if not k.startswith("width_mm_")},
           "objects": obj_part, "vibration": vib_part, "summary": summary}
    return out


# -------------------------------------------------------------------------------------------------
# cracks
# -------------------------------------------------------------------------------------------------

def _cracks(e1a, e1b, theta_a, grid, cfg, lab, baseline) -> Dict[str, Any]:
    """Crack lines after the change, and how many of them are new against the latched baseline."""
    width_after = lab_cracks.crack_width_mm(e1a, cfg)
    width_before = lab_cracks.crack_width_mm(e1b, cfg)
    open_after = lab_cracks.cracked_mask(e1a, cfg)
    open_before = lab_cracks.cracked_mask(e1b, cfg)

    if baseline is None:
        was_cracked = None
        basis = None
        note = ("counted against nothing: the run's latched crack history was not available, so no "
                "crack here is called new — see lab/baseline.py")
    else:
        # Union: the export's latched state at day T, plus anything the frozen surface has open now.
        # They should agree (the baseline was built from the same run at the same day); the union
        # means a disagreement can only ever shrink the "new" count, never inflate it.
        was_cracked = baseline.cracked | open_before
        basis = f"latched crack state exported for day {baseline.day} ({baseline.path.name})"
        note = None

    new_mask = open_after & ~was_cracked if was_cracked is not None else None
    segments, shown, total = _crack_lines(open_after, new_mask, width_after, theta_a, grid, lab)

    widest = float(np.max(width_after)) if width_after.size else 0.0
    widest_new = float(np.max(width_after[new_mask])) if new_mask is not None and new_mask.any() else 0.0
    return {
        "threshold_mm_per_m": lab_cracks.to_mm_per_m(lab_cracks.crack_threshold_ue(cfg)).item(),
        "spacing_m": lab_cracks.crack_spacing_m(cfg),
        "baseline": basis,
        "baseline_note": note,
        "before_count": None if was_cracked is None else int(np.count_nonzero(was_cracked)),
        "after_count": int(np.count_nonzero(open_after)),
        "new_count": None if new_mask is None else int(np.count_nonzero(new_mask)),
        "widest_mm": _round(widest),
        "widest_new_mm": _round(widest_new),
        "segments": segments,
        "segments_shown": shown,
        "segments_total": total,
        "source": CRACK_SOURCE,
        "width_mm_after": width_after,
        "width_mm_before": width_before,
    }


def _crack_lines(open_after, new_mask, width_mm, theta_deg, grid, lab):
    """One line segment per cracked cell: through the cell centre, across the pull.

    A crack opens PERPENDICULAR to the major principal tensile strain, so its own bearing is
    theta + 90 — the same convention minesim.cracks.CrackField uses for azimuth_deg, so a lab line
    and an exported azimuth mean the same thing. The segment is one cell long, so a run of cracked
    cells draws as a continuous trace without any of them claiming to be longer than the ground the
    model actually looked at.

    Too many to draw is normal at day 690, so the widest are kept and the count of dropped ones is
    returned with them: a thinned picture must never read as a complete one.
    """
    drawable = open_after & (width_mm >= lab.crack_segment_min_width_mm)
    idx = np.argwhere(drawable)
    total = int(idx.shape[0])
    if total == 0:
        return [], 0, 0
    widths = width_mm[drawable]
    order = np.argsort(-widths)[:lab.max_crack_segments]
    idx = idx[order]

    i, j = idx[:, 0], idx[:, 1]
    cx = grid.origin_x_m + (i + 0.5) * grid.cell_m
    cy = grid.origin_y_m + (j + 0.5) * grid.cell_m
    # The crack runs across the pull: theta is the direction of e1, so the crack line's own direction
    # is theta turned by a quarter turn, i.e. the unit vector (-sin theta, cos theta). Written as a
    # rotation rather than "theta + 90" because gate L4 allows no bare 90 in lab/, and a quarter turn
    # is not a number anyone should be free to tune.
    theta_rad = np.radians(theta_deg[i, j])
    tx, ty = -np.sin(theta_rad), np.cos(theta_rad)
    bearing = np.degrees(np.arctan2(ty, tx)) % HALF_TURN_DEG        # a line has no head, so mod 180
    half = 0.5 * grid.cell_m
    dx, dy = half * tx, half * ty
    is_new = new_mask[i, j] if new_mask is not None else np.zeros(i.shape, dtype=bool)

    segments = [{"x0_m": _round(cx[k] - dx[k]), "y0_m": _round(cy[k] - dy[k]),
                 "x1_m": _round(cx[k] + dx[k]), "y1_m": _round(cy[k] + dy[k]),
                 "bearing_deg": _bearing_deg(float(bearing[k])),
                 "width_mm": _round(float(width_mm[i[k], j[k]])),
                 "new": bool(is_new[k])}
                for k in range(len(i))]
    return segments, len(segments), total


# -------------------------------------------------------------------------------------------------
# vibration
# -------------------------------------------------------------------------------------------------

def _vibration(ppv, cfg, f_dom_hz) -> Optional[Dict[str, Any]]:
    """The shaking summary, or None when this scenario has no vibration layer."""
    if ppv is None:
        return None
    if f_dom_hz is None:
        raise ValueError("a PPV field needs its dominant frequency: the DGMS limit is banded by "
                         "frequency, so the same PPV is compliant at 40 Hz and over the limit at 6 Hz")
    limits = dgms_limits(cfg, f_dom_hz)
    peak = float(np.max(np.asarray(ppv, dtype=np.float64)))
    return {"max_ppv_mm_s": _round(peak), "f_dom_hz": _round(float(f_dom_hz)),
            "limits_mm_s": {k: _round(v) for k, v in limits.items()},
            "over_domestic_limit": bool(peak > limits["domestic"]),
            "source": DGMS_SOURCE}


# -------------------------------------------------------------------------------------------------
# objects
# -------------------------------------------------------------------------------------------------

def _object_answer(obj: MineObject, grid, lab, cfg, before, after, fb, fa, e1b, e2b, e1a, e2a,
                   width_after, width_before, ppv, f_dom_hz, mask) -> Dict[str, Any]:
    """What this one object is in for, before and after, and one plain sentence about it."""
    xs, ys = obj.sample_points(grid.cell_m)
    answer: Dict[str, Any] = {"id": obj.id, "type": obj.type, "label": obj.label,
                              "layout": obj.layout_note}

    if mask is not None and not bool(np.all(_at(mask.astype(np.float64), grid, xs, ys) > 0.5)):
        answer.update({"plain": NO_FORECAST, "covered": False, "worse": False})
        return answer
    answer["covered"] = True

    tilt_b = float(np.nanmax(_at(fb.tilt_mag_mm_per_m, grid, xs, ys)))
    tilt_a = float(np.nanmax(_at(fa.tilt_mag_mm_per_m, grid, xs, ys)))
    sink_b = float(np.nanmax(_at(before, grid, xs, ys)))
    sink_a = float(np.nanmax(_at(after, grid, xs, ys)))
    strain_b = _worst_strain(e1b, e2b, grid, xs, ys)
    strain_a = _worst_strain(e1a, e2a, grid, xs, ys)

    b: Dict[str, Any] = {"max_tilt_mm_per_m": _round(tilt_b),
                         "worst_strain_mm_per_m": _round(strain_b),
                         "subsidence_mm": _round(sink_b)}
    a: Dict[str, Any] = {"max_tilt_mm_per_m": _round(tilt_a),
                         "worst_strain_mm_per_m": _round(strain_a),
                         "subsidence_mm": _round(sink_a)}

    if obj.type == "house":
        frontage = obj.width_m
        grade_b = lab_cracks.damage_grade(lab_cracks.to_microstrain(strain_b).item(), frontage)
        grade_a = lab_cracks.damage_grade(lab_cracks.to_microstrain(strain_a).item(), frontage)
        dl_a = abs(strain_a * frontage)
        b["grade"], a["grade"] = grade_b, grade_a
        a["change_of_length_mm"] = _round(dl_a)
        answer["limit_source"] = NCB_SOURCE
        made = "" if not obj.material else f" ({obj.material})"
        if grade_a == grade_b:
            answer["plain"] = (f"{obj.label}{made}: damage stays {grade_a} — walls change length by "
                               f"{dl_a:.0f} mm over a {frontage:.0f} m frontage")
        else:
            answer["plain"] = (f"{obj.label}{made}: {grade_b} → {grade_a} — walls change length by "
                               f"{dl_a:.0f} mm over a {frontage:.0f} m frontage")
        answer["worse"] = lab_cracks.NCB_GRADES.index(grade_a) > lab_cracks.NCB_GRADES.index(grade_b)

    elif obj.type == "road":
        near = distance_to_polyline_m(obj.line, *grid.centres()) <= lab.road_crack_search_m
        crack_b = float(np.max(width_before[near])) if near.any() else 0.0
        crack_a = float(np.max(width_after[near])) if near.any() else 0.0
        b["crack_width_mm"], a["crack_width_mm"] = _round(crack_b), _round(crack_a)
        answer["limit_source"] = CRACK_SOURCE
        answer["plain"] = (f"{obj.label}: widest crack in the road {crack_a:.0f} mm "
                           f"(was {crack_b:.0f} mm); the road tilts {tilt_a:.1f} mm/m")
        answer["worse"] = crack_a > crack_b

    elif obj.type == "pole":
        height = obj.height_m
        lean_b, lean_a = tilt_b * height, tilt_a * height
        b["top_movement_mm"], a["top_movement_mm"] = _round(lean_b), _round(lean_a)
        b["height_m"] = a["height_m"] = height
        answer["plain"] = (f"{obj.label}: top moves {lean_a:.0f} mm sideways (was {lean_b:.0f} mm) "
                           f"on a {height:.0f} m pole")
        answer["worse"] = lean_a > lean_b

    if ppv is not None:
        here = float(np.nanmax(_at(np.asarray(ppv, dtype=np.float64), grid, xs, ys)))
        limit = dgms_limits(cfg, f_dom_hz)[obj.structure_class]
        a["ppv_mm_s"] = _round(here)
        a["ppv_limit_mm_s"] = _round(limit)
        over = here > limit
        a["over_ppv_limit"] = bool(over)
        answer["plain"] += (f". Shaking here reaches {here:.2f} mm/s, "
                            f"{'OVER' if over else 'under'} the {limit:.0f} mm/s "
                            f"{obj.structure_class} limit at {f_dom_hz:.0f} Hz")

    answer["before"], answer["after"] = b, a
    return answer


def _at(field, grid, xs, ys):
    """Sample a field at an object's points, and refuse silently-empty answers."""
    values = sample(field, grid, xs, ys)
    if not bool(np.any(np.isfinite(values))):
        raise ValueError("object sampled entirely outside the grid — load_objects should have "
                         "refused it at load time")
    return values


def _worst_strain(e1, e2, grid, xs, ys) -> float:
    """The strain that damages the structure: the largest CHANGE of length, stretch or squeeze.

    Compression cracks masonry too, which is why the NCB scale classifies the magnitude of the change
    of length and not the tension alone. Sign is kept so the sentence can still say which it was.
    """
    tension = np.nanmax(_at(e1, grid, xs, ys))
    squeeze = np.nanmin(_at(e2, grid, xs, ys))
    return float(tension if abs(tension) >= abs(squeeze) else squeeze)


# -------------------------------------------------------------------------------------------------

def _summary_sentences(summary, crack_part, vib_part, obj_part) -> List[str]:
    out = [f"the ground sinks up to {summary['max_extra_sinking_mm']:.0f} mm more, "
           f"tilting up to {summary['max_tilt_mm_per_m']:.1f} mm/m"]
    if crack_part["new_count"] is None:
        out.append(crack_part["baseline_note"])
    elif crack_part["new_count"] == 0:
        out.append(f"no new cracks: the widest anywhere is {crack_part['widest_mm']:.0f} mm and it "
                   f"was already open")
    else:
        out.append(f"{crack_part['new_count']} cells crack that were not cracked before, "
                   f"the widest of them {crack_part['widest_new_mm']:.0f} mm")
    if crack_part["segments_total"] > crack_part["segments_shown"]:
        out.append(f"{crack_part['segments_shown']} of {crack_part['segments_total']} crack lines are "
                   f"drawn — the widest ones")
    worse = [o for o in obj_part if o.get("worse")]
    if obj_part:
        out.append(f"{len(worse)} of {len(obj_part)} things on the surface are worse off"
                   if worse else f"none of the {len(obj_part)} things on the surface is worse off")
    if vib_part is not None:
        out.append(f"shaking peaks at {vib_part['max_ppv_mm_s']:.2f} mm/s against a "
                   f"{vib_part['limits_mm_s']['domestic']:.0f} mm/s limit for houses")
    return out


def _bearing_deg(value: float) -> float:
    """A crack line's bearing, rounded for the wire and kept inside [0, 180).

    Rounding is what makes this necessary: 179.998 degrees rounds to 180, and 180 is the same
    direction as 0 for a line but would be outside the range the payload promises.
    """
    rounded = _round(value)
    return 0.0 if rounded >= HALF_TURN_DEG else rounded


def _float_surface(s_mm, which: str) -> np.ndarray:
    """The surface as float64, refusing an integer array outright (gate L5, WP9 §3).

    Rounding S to whole millimetres on 5 m cells produces strain errors up to 4.9 mm/m against a true
    peak of 4.5 - the noise is bigger than the signal, and every consequence here is a derivative.
    """
    arr = np.asarray(s_mm)
    if not np.issubdtype(arr.dtype, np.floating):
        raise TypeError(
            f"the {which} surface is {arr.dtype}, not float. Consequences are derivatives of the "
            "surface and the int-mm grid cannot carry them (gate L5): pass s_model_mm + ds.")
    return arr.astype(np.float64)


def _round(value) -> float:
    """One place after the millimetre, so a JSON result is stable and readable. Never the maths."""
    return float(np.round(float(value), 2))
