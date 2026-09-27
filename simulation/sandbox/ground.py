"""Ground-source resolver and shared wire-payload helpers (plan step G2).

`session.py` and `forge/server.py` each pick their S(x, y, t) implementation
by name, from the same table, so the two engines can never resolve the same
name to different code:
  - "district": the real Adriyala fit, 3-panel superposition (G1, `district.py`).
    The default -- the plan's whole point is that the engine runs on the
    team's own fitted ground, not the ASSUMED one.
  - "surface": the ASSUMED single-panel ground (`surface.py`), kept only so
    tests that pin old numbers computed against it still have something to
    ask for by name. Never the default for a live session or FORGE.

`district` and `surface` disagree on their wire-payload shape (one panel's
`bowl_px`/`bowl_py`/`face_y` vs. three panels' `bowl_terms_px`/`bowl_terms_py`/
`face_positions`), so the two functions below are the one place that
difference is resolved -- session.py's tick payload and forge/server.py's
`/forge/frame` response both call through here rather than each growing
their own copy of this branch.
"""

import math

import numpy as np

from sandbox import district, surface
from sandbox.constants import FIT_FACE_START_Y_M

GROUNDS = {"district": district, "surface": surface}

# Precompute static base bowl meshes at module import so /config and WS init
# are instantaneous.
_X, _Y = surface.grid()
_DISTRICT_BASE_S = np.round(district.channels(_X, _Y, 365.0)["s"][::2, ::2], 4).tolist()
_DISTRICT_BOWL_TERMS_PX = district.bowl_terms_px()
_SURFACE_BASE_S = np.round(surface._BASE_S[::2, ::2], 4).tolist()
_SURFACE_BOWL_PX = surface.bowl_px_wire()


def resolve(name: str):
    """Return the ground module named `name`. Raises on anything else -- a
    typo in a test's `ground=` (or a future third ground) must fail loudly,
    never silently fall back to the default."""
    try:
        return GROUNDS[name]
    except KeyError:
        raise ValueError(f"unknown ground {name!r}; expected one of {sorted(GROUNDS)}")


def wire_fields(mod, t_days: float) -> dict:
    """Per-tick bowl/face fields for a tick or `/forge/frame` payload.

    Exactly one of (`bowl_py`, `bowl_terms_py`) is non-null, matching which
    ground produced it: the frontend sums `bowl_terms_py` against
    `bowl_terms_px` when present and otherwise falls back to the single
    `bowl_px * bowl_py` path (G2's frontend change keeps both live).

    `district.face_positions` returns NaN for a panel that has not started
    yet (JSON has no NaN literal the browser can parse), so those become
    `None`; `face_y_m` -- the one face the legacy 3D view always draws --
    falls back to the fitted resting position `FIT_FACE_START_Y_M`, the
    district analogue of how `surface.face_y(t <= 0)` itself resolves to
    `FACE_START_Y_M` rather than NaN.
    """
    if mod is district:
        faces = district.face_positions(t_days)
        centre = faces[1]
        return {
            "bowl_py": None,
            "face_y_m": round(FIT_FACE_START_Y_M if math.isnan(centre) else centre, 1),
            "bowl_terms_py": district.bowl_terms_py(t_days),
            "face_positions": [None if math.isnan(f) else round(f, 1) for f in faces],
        }
    return {
        "bowl_py": surface.bowl_py_wire(t_days),
        "face_y_m": round(surface.face_y(t_days), 1),
        "bowl_terms_py": None,
        "face_positions": None,
    }


def static_bowl_fields(mod) -> dict:
    """The static bowl fields for `/config` and the WS init frame.

    `district` has no closed-form t -> infinity limit the way
    `surface._BASE_S` does (its neighbour panels start on their own offset
    days rather than all at t=0), so its "settled" mesh is evaluated at day
    365 -- the dataset year's own horizon -- instead. `bowl_px` (single-panel
    legacy profile) and `bowl_terms_px` (3-panel district profile) are
    mutually exclusive, matching `wire_fields` above.
    """
    if mod is district:
        return {
            "base_bowl_mesh": _DISTRICT_BASE_S,
            "bowl_px": None,
            "bowl_terms_px": _DISTRICT_BOWL_TERMS_PX,
        }
    return {
        "base_bowl_mesh": _SURFACE_BASE_S,
        "bowl_px": _SURFACE_BOWL_PX,
        "bowl_terms_px": None,
    }
