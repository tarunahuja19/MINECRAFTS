"""The shaking layer: ground vibration over the grid, as contour lines (P2). NOT a second model.

Same arrangement as lab/cracks.py and for the same reason (decision D-S1): every vibration number
comes from minesim.vibration, and this module only puts it on the lab's grid and turns it into lines.

WHAT IS IN THE LAYER, AND WHAT IS NOT
-------------------------------------
BLAST is deferred. Adarsh, session 26: "blast keep it for afterwards" - and it is the honest call,
because the site constants K and b in assumptions.yaml are marked OPEN - VERIFY and a PPV computed
from constants nobody has measured is a number that cannot survive a question. Decision D-S4 stays
open; nothing here reads blast_k except through minesim, and no event produces a blast.

CAVING is in, because it is the one vibration source our own simulation drives: the roof behind the
supports falls into the goaf as the face advances, and minesim.vibration.caving_events computes when
and where from the face position we already have. So this layer needs no user input and no unverified
constant of its own - it is a consequence of the run, like the trough is.

A caving event sits at SEAM DEPTH, 375 m down. It is therefore never closer than 375 m to anything on
the surface, which caps the PPV it can produce - the numbers here are small, and they are small for a
physical reason rather than because something is switched off.

Vibration does not sink the ground. There is no path from this module to S(x, y, t), to ds, or to the
world grid, and there must never be one: minesim.vibration's own docstring says so, and it is the
easiest thing in this whole feature for a later change to get wrong.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np

from minesim.vibration import (        # noqa: F401  (re-exported on purpose — one model, not two)
    VibrationSource,
    caving_events,
    dgms_limit_mm_s,
    dominant_frequency_hz,
    exceeds_limit,
    ppv_mm_s,
    slant_distance_m,
)

CAVING = "caving"


def caving_ppv_field(grid, cfg, day: float) -> Dict[str, Any]:
    """Peak particle velocity over the grid from roof caving up to `day`, in mm/s.

    The value in a cell is the LARGEST SINGLE EVENT felt there, not a sum and not a dose: PPV is a
    peak, and peaks of separate events at separate times do not add. `n_events` is reported beside it
    so "0.9 mm/s, from 112 falls" cannot be read as "0.9 mm/s once".

    Returns {} with no field when no roof fall has happened yet — early in a run the face has not
    advanced far enough for the first main fall, and "no events yet" is a different statement from
    "zero everywhere".
    """
    events = caving_events(cfg, day)
    f_dom_hz = dominant_frequency_hz(CAVING, cfg)
    if not events:
        return {"ppv_mm_s": None, "f_dom_hz": f_dom_hz, "n_events": 0,
                "plain": (f"no roof fall yet at day {day:.0f}: the face has not advanced the "
                          f"{cfg.vibration.first_fall_advance_m:.0f} m to the first main fall")}

    X, Y = grid.centres()
    worst = np.zeros(X.shape, dtype=np.float64)
    for source in events:
        np.maximum(worst, np.asarray(ppv_mm_s(X, Y, source, cfg), dtype=np.float64), out=worst)

    limits = dgms_limits(cfg, f_dom_hz)
    return {
        "ppv_mm_s": worst,
        "f_dom_hz": f_dom_hz,
        "n_events": len(events),
        "first_event_day": float(events[0].t_days),
        "limits_mm_s": limits,
        "plain": (f"{len(events)} roof falls up to day {day:.0f}; the strongest shaking felt at the "
                  f"surface is {float(worst.max()):.2f} mm/s at about {f_dom_hz:.0f} Hz, against a "
                  f"{limits['domestic']:.0f} mm/s limit for houses"),
    }


def dgms_limits(cfg, f_dom_hz: float) -> Dict[str, float]:
    """The statutory PPV limit for every structure class at this dominant frequency, from minesim.

    Banded by frequency: the same PPV is compliant at 40 Hz and over the limit at 6 Hz, which is why
    the frequency has to travel with the number everywhere it is reported.
    """
    return {name: dgms_limit_mm_s(name, f_dom_hz, cfg) for name in sorted(cfg.vibration.dgms_limits_mm_s)}


def ppv_contours(ppv: Optional[np.ndarray], grid, lab) -> List[Dict[str, Any]]:
    """The vibration layer as LINES: one entry per level in lab.ppv_contour_levels_mm_s.

    Adarsh asked for lines rather than a coloured field for both cracks and vibration (session 26).
    A level with no crossings is still returned, with an empty segment list, so the page can show
    "5 mm/s: nowhere" instead of silently dropping the line it was told to draw.
    """
    from lab.sampling import iso_segments
    if ppv is None:
        return []
    out: List[Dict[str, Any]] = []
    for level in lab.ppv_contour_levels_mm_s:
        segments = iso_segments(ppv, grid, float(level))
        out.append({"level_mm_s": float(level),
                    "segments": [[round(v, 1) for v in seg] for seg in segments],
                    "count": len(segments)})
    return out
