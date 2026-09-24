"""Ground vibration - WP4 extension (F10).

INVARIANT: vibration is a telemetry channel. Nothing in this module writes S(x, y, t), the world
grid, or node Z. Blasting does not cause subsidence and must never be wired up as though it does.
The old sandbox got this right (`session.py:610`, "without affecting ground subsidence") and it is
restated here because it is the easiest thing for a later change to get wrong.

Three sources, each with its own frequency signature:

  * BLAST. A longwall face is mechanised - a shearer, not explosives - so a blast near this panel
    comes from a development heading or a neighbouring opencast, never from the longwall face
    itself. Do not "fix" this model by attaching blasts to the face position.
  * CAVING / PERIODIC WEIGHTING. Microseismic, 100-250 Hz, generated as the roof behind the
    supports falls into the goaf. The first main fall comes after a few tens of metres of face
    advance and periodic weighting follows at a regular advance interval thereafter. This is the
    one source driven by the simulation we already have, and the one that matters for early
    warning, so it is an event train computed from face advance rather than a button someone presses.
  * MACHINERY. A steady floor from the shearer and the conveyor. No event structure.

What the old sandbox got wrong, and this module fixes: `apply_vibration` set ONE PPV value that
every node in the mine then reported, with no dependence on where the node stood relative to the
source. That makes the channel useless for locating anything - and locating things is the entire
reason there are 375 nodes in the ground.
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np

from minesim.config import Config


@dataclass(frozen=True)
class VibrationSource:
    """One vibration event. `charge_kg` is the maximum charge per delay, and is required for a
    blast because the scaled-distance law is undefined without it."""
    kind: str                     # "blast" | "caving" | "machinery"
    x_m: float
    y_m: float
    depth_m: float = 0.0          # below surface; caving events sit at seam depth
    charge_kg: Optional[float] = None
    t_days: Optional[float] = None


def slant_distance_m(x, y, source: VibrationSource):
    """3-D distance from a surface point to the source. Depth matters: a caving event at 375 m is
    never closer than 375 m to anything on the surface, which caps the PPV it can produce."""
    dx = np.asarray(x, dtype=np.float64) - source.x_m
    dy = np.asarray(y, dtype=np.float64) - source.y_m
    return np.sqrt(dx * dx + dy * dy + source.depth_m ** 2)


def ppv_mm_s(x, y, source: VibrationSource, cfg: Config):
    """Peak particle velocity in mm/s at surface points (x, y), for one source.

    Blast: the standard scaled-distance attenuation law

        PPV = K * (D / sqrt(W)) ** (-B)

    with D the slant distance in m and W the maximum charge per delay in kg. K and B are site
    constants (cfg.vibration.blast_k / blast_b), pinned by a trial blast in practice.

    Caving: the same inverse-power form, normalised to a measured PPV at a 100 m reference
    distance, because a caving event has no charge weight to scale by.

    Machinery: a distance-independent floor.
    """
    v = cfg.vibration
    if source.kind == "machinery":
        return np.full(np.shape(np.asarray(x, dtype=np.float64) + np.asarray(y, dtype=np.float64)),
                       v.machinery_floor_mm_s, dtype=np.float64)

    d = np.maximum(slant_distance_m(x, y, source), 1.0)   # 1 m floor: the law diverges at D -> 0
    if source.kind == "blast":
        if not source.charge_kg or source.charge_kg <= 0.0:
            raise ValueError("a blast source needs charge_kg > 0: the scaled-distance law is "
                             "undefined without the maximum charge per delay")
        scaled = d / np.sqrt(source.charge_kg)
        return v.blast_k * scaled ** (-v.blast_b)
    if source.kind == "caving":
        return v.caving_ppv_at_100m_mm_s * (d / 100.0) ** (-v.blast_b)
    raise ValueError(f"unknown vibration source kind {source.kind!r}")


def caving_events(cfg: Config, t_days: float) -> List[VibrationSource]:
    """The caving events that have occurred by day `t_days`, at the face position of each.

    First main fall at `first_fall_advance_m` of advance, then one event every
    `periodic_weighting_interval_m` thereafter. The source sits at the face, at seam depth.
    """
    v, k, p = cfg.vibration, cfg.knothe, cfg.panel
    face_now = min(k.advance_m_per_day * max(0.0, t_days), p.length_m)
    out: List[VibrationSource] = []
    adv = v.first_fall_advance_m
    while adv <= face_now:
        out.append(VibrationSource(kind="caving", x_m=adv, y_m=0.0, depth_m=p.depth_m,
                                   t_days=adv / k.advance_m_per_day))
        adv += v.periodic_weighting_interval_m
    return out


def dominant_frequency_hz(kind: str, cfg: Config, rng=None) -> float:
    """A dominant frequency drawn from the source's band. Discriminating the source by frequency is
    the point of carrying the channel: microseismic (100-250 Hz) is the one that matters."""
    band = {"blast": "blast", "caving": "microseismic", "machinery": "conveyor"}.get(kind, kind)
    lo, hi = cfg.vibration.bands_hz[band]
    if rng is None:
        return 0.5 * (lo + hi)
    return float(rng.uniform(lo, hi))


def _band_key(f_dom_hz: float) -> str:
    if f_dom_hz < 8.0:
        return "below_8hz"
    if f_dom_hz <= 25.0:
        return "8_to_25hz"
    return "above_25hz"


def dgms_limit_mm_s(structure_class: str, f_dom_hz: float, cfg: Config) -> float:
    """The DGMS statutory PPV limit for a structure class at this dominant frequency.

    The limits are banded by frequency, which is why dominant_frequency_hz has to exist before this
    can be answered: the same PPV is compliant at 40 Hz and over the limit at 6 Hz.
    """
    limits = cfg.vibration.dgms_limits_mm_s.get(structure_class)
    if limits is None:
        raise ValueError(f"unknown structure class {structure_class!r}; "
                         f"known: {sorted(cfg.vibration.dgms_limits_mm_s)}")
    return limits[_band_key(f_dom_hz)]


def exceeds_limit(ppv, structure_class: str, f_dom_hz: float, cfg: Config):
    """Whether PPV is over the statutory limit. This RETURNS a boolean for a consumer to act on.
    It does not gate, suppress or rewrite a reading - alarm logic does not live in minesim
    (Invariant 3)."""
    return np.asarray(ppv, dtype=np.float64) > dgms_limit_mm_s(structure_class, f_dom_hz, cfg)


def crack_trigger(e1_ue, ppv, source_kind: str, cfg: Config):
    """Where a vibration event may tip already-strained ground into cracking early.

    The ONE coupling between vibration and cracks, kept deliberately narrow because the field
    evidence only supports this much: shaking can extend a crack in ground that is already close to
    its tensile limit, but it does not crack sound ground, and it does not move the subsidence
    bowl. Returns a boolean mask; the caller decides what to do with it.

    Ground must already be above `trigger_fraction` of the cracking threshold AND the event must be
    felt above the most permissive DGMS limit at its own dominant frequency.
    """
    v, c = cfg.vibration, cfg.cracks
    f = dominant_frequency_hz(source_kind, cfg)
    near_failure = np.asarray(e1_ue, dtype=np.float64) >= v.trigger_fraction * c.tensile_strain_threshold_ue
    felt = np.asarray(ppv, dtype=np.float64) > dgms_limit_mm_s("industrial", f, cfg)
    return near_failure & felt
