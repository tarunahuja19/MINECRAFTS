"""
Layer 0: the latent ground-truth state (spec 4.1).

This is the hidden physical reality the sensors only partially observe. It is
one subsidence surface, and every ground-reading channel in the dataset is a
derivative of it:

    tilt        = first derivative of S
    strain      = second derivative of S, scaled by B
    fissure     = strain integrated across the sensor's gauge length
    extensometer= exact 3-D distance change between two pegs displaced by S

They are never generated independently. Generating them independently would
make them trivially consistent and teach a downstream model nothing about the
physical coupling that is the whole point of a multi-sensor network.

THE SURFACE
    r        = H / tan_beta                     radius of influence
    S_max    = a * seam_thickness               fully-settled peak
    P(x)     = 0.5[erf(sqrt(pi)(x-x1)/r) - erf(sqrt(pi)(x-x2)/r)]
    Q(y)     = same form in y
    S_final  = S_max * P(x) * Q(y)              fully-settled bowl
    g(t)     = 1 - exp(-c t)                    Knothe time function, t in days

    S(x, y, t) = S_final(x, y) * g(t)

Space and time are separable, so a whole mine's ground truth is one image times
one scalar per timestep. That is what keeps the dataset generatable at scale.

COLLAPSE
A collapse is a localised failure superimposed on the smooth bowl. Where a
collapse occurs, an extra Gaussian-shaped subsidence bulb grows over that
event's precursor window and accelerates into the failure time. The failure
threshold is expressed as a fraction of the mine's own peak curvature; when the
local curvature crosses it, the ground has failed there.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dc_field

import numpy as np
from scipy.special import erf

SQRT_PI = np.sqrt(np.pi)


@dataclass
class CollapseEvent:
    """One localised failure inside a mine."""

    event_id: int
    x: float
    y: float
    z: float
    t_collapse_s: float
    precursor_s: float
    severity: float
    radius_m: float
    extra_subsidence_m: float


@dataclass
class GroundField:
    """The latent state of one mine. Everything sensor-facing reads from here."""

    # panel corners, m
    x1: float
    y1: float
    x2: float
    y2: float
    # physics
    H: float
    tan_beta: float
    seam_thickness: float
    a: float
    c: float
    B_frac: float
    datum_z: float = 0.0
    events: list[CollapseEvent] = dc_field(default_factory=list)

    def __post_init__(self) -> None:
        self.r = self.H / self.tan_beta
        self.S_max = self.a * self.seam_thickness
        self.B = self.B_frac * self.r

    # ------------------------------------------------------------ profiles ---
    def _P(self, x: np.ndarray) -> np.ndarray:
        return 0.5 * (
            erf(SQRT_PI * (x - self.x1) / self.r)
            - erf(SQRT_PI * (x - self.x2) / self.r)
        )

    def _Q(self, y: np.ndarray) -> np.ndarray:
        return 0.5 * (
            erf(SQRT_PI * (y - self.y1) / self.r)
            - erf(SQRT_PI * (y - self.y2) / self.r)
        )

    def _dP(self, x: np.ndarray) -> np.ndarray:
        return (1.0 / self.r) * (
            np.exp(-np.pi * (x - self.x1) ** 2 / self.r**2)
            - np.exp(-np.pi * (x - self.x2) ** 2 / self.r**2)
        )

    def _dQ(self, y: np.ndarray) -> np.ndarray:
        return (1.0 / self.r) * (
            np.exp(-np.pi * (y - self.y1) ** 2 / self.r**2)
            - np.exp(-np.pi * (y - self.y2) ** 2 / self.r**2)
        )

    def _d2Q(self, y: np.ndarray) -> np.ndarray:
        k = -2.0 * np.pi / self.r**3
        return k * (
            (y - self.y1) * np.exp(-np.pi * (y - self.y1) ** 2 / self.r**2)
            - (y - self.y2) * np.exp(-np.pi * (y - self.y2) ** 2 / self.r**2)
        )

    def _d2P(self, x: np.ndarray) -> np.ndarray:
        k = -2.0 * np.pi / self.r**3
        return k * (
            (x - self.x1) * np.exp(-np.pi * (x - self.x1) ** 2 / self.r**2)
            - (x - self.x2) * np.exp(-np.pi * (x - self.x2) ** 2 / self.r**2)
        )

    # ------------------------------------------------------- time function ---
    def g(self, t_s: np.ndarray) -> np.ndarray:
        """Knothe time function. t in seconds, converted to days internally."""
        t_days = np.asarray(t_s, dtype=np.float64) / 86400.0
        return 1.0 - np.exp(-self.c * t_days)

    # ------------------------------------------------- collapse contribution ---
    def _collapse_growth(self, t_s: np.ndarray, ev: CollapseEvent) -> np.ndarray:
        """
        Temporal shape of one collapse, in [0, 1].

        Zero before the precursor window opens, rising with an accelerating
        (cubic) ramp through the window, and saturating just after failure. The
        acceleration is what makes the precursor detectable: the signal is not
        merely large near failure, it is *curving upward*.
        """
        t = np.asarray(t_s, dtype=np.float64)
        start = ev.t_collapse_s - ev.precursor_s
        frac = (t - start) / max(ev.precursor_s, 1.0)
        frac = np.clip(frac, 0.0, None)
        ramp = np.where(frac <= 1.0, frac**3, 1.0)
        # after failure the bulb keeps settling, but slowly
        after = np.clip(frac - 1.0, 0.0, None)
        return np.clip(ramp + 0.15 * (1.0 - np.exp(-after * 2.0)), 0.0, 1.15)

    def _collapse_spatial(self, x: np.ndarray, y: np.ndarray, ev: CollapseEvent) -> np.ndarray:
        d2 = (x - ev.x) ** 2 + (y - ev.y) ** 2
        return np.exp(-d2 / (2.0 * ev.radius_m**2))

    # ------------------------------------------------------------- surface ---
    def subsidence(self, x: np.ndarray, y: np.ndarray, t_s: np.ndarray) -> np.ndarray:
        """
        S(x, y, t) in metres, down-positive.

        x, y broadcast as (n_nodes, 1); t as (1, n_steps). Returns (n_nodes, n_steps).
        """
        base = self.S_max * self._P(x) * self._Q(y) * self.g(t_s)
        for ev in self.events:
            base = base + (
                ev.extra_subsidence_m
                * self._collapse_spatial(x, y, ev)
                * self._collapse_growth(t_s, ev)
            )
        return base

    def tilt(self, x: np.ndarray, y: np.ndarray, t_s: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """
        Ground slope in microradians: (tilt_x, tilt_y) = (dS/dx, dS/dy).

        Small-angle, so radians == slope. Multiplied by 1e6 for urad.
        """
        gt = self.g(t_s)
        tx = self.S_max * self._dP(x) * self._Q(y) * gt
        ty = self.S_max * self._P(x) * self._dQ(y) * gt

        for ev in self.events:
            sp = self._collapse_spatial(x, y, ev)
            gr = self._collapse_growth(t_s, ev)
            amp = ev.extra_subsidence_m * gr
            # d/dx of a Gaussian bulb
            tx = tx + amp * sp * (-(x - ev.x) / ev.radius_m**2)
            ty = ty + amp * sp * (-(y - ev.y) / ev.radius_m**2)

        return tx * 1.0e6, ty * 1.0e6

    def strain_yy(self, x: np.ndarray, y: np.ndarray, t_s: np.ndarray) -> np.ndarray:
        """Horizontal strain in microstrain: eps_yy = B * d2S/dy2."""
        gt = self.g(t_s)
        e = self.B * self.S_max * self._P(x) * self._d2Q(y) * gt

        for ev in self.events:
            sp = self._collapse_spatial(x, y, ev)
            gr = self._collapse_growth(t_s, ev)
            amp = ev.extra_subsidence_m * gr
            dy = y - ev.y
            d2 = (dy**2 / ev.radius_m**4) - (1.0 / ev.radius_m**2)
            e = e + self.B * amp * sp * d2

        return e * 1.0e6

    def curvature_magnitude(self, x: np.ndarray, y: np.ndarray, t_s: np.ndarray) -> np.ndarray:
        """
        |d2S/dx2| + |d2S/dy2|, the scalar the failure threshold is defined on.

        Used to decide where and when the ground has actually failed.
        """
        gt = self.g(t_s)
        kxx = self.S_max * self._d2P(x) * self._Q(y) * gt
        kyy = self.S_max * self._P(x) * self._d2Q(y) * gt

        for ev in self.events:
            sp = self._collapse_spatial(x, y, ev)
            gr = self._collapse_growth(t_s, ev)
            amp = ev.extra_subsidence_m * gr
            dx, dy = x - ev.x, y - ev.y
            kxx = kxx + amp * sp * ((dx**2 / ev.radius_m**4) - (1.0 / ev.radius_m**2))
            kyy = kyy + amp * sp * ((dy**2 / ev.radius_m**4) - (1.0 / ev.radius_m**2))

        return np.abs(kxx) + np.abs(kyy)

    def horizontal_displacement(
        self, x: np.ndarray, y: np.ndarray, t_s: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        Horizontal ground movement (u_x, u_y) in metres, u = B * grad(S).

        This is what physically opens a fissure and shortens an extensometer
        wire, so both of those channels are derived from it rather than invented.
        """
        tx, ty = self.tilt(x, y, t_s)
        return self.B * tx * 1.0e-6, self.B * ty * 1.0e-6

    # ------------------------------------------------------------ diagnostics ---
    def peak_curvature(self, n: int = 241) -> float:
        """Peak fully-settled curvature over the influence rectangle."""
        gx = np.linspace(self.x1 - self.r, self.x2 + self.r, n).reshape(-1, 1)
        gy = np.linspace(self.y1 - self.r, self.y2 + self.r, n).reshape(-1, 1)
        xx, yy = np.meshgrid(gx.ravel(), gy.ravel(), indexing="ij")
        # evaluate at a large t so g(t) -> 1, with collapse bulbs excluded
        bare = GroundField(
            self.x1, self.y1, self.x2, self.y2, self.H, self.tan_beta,
            self.seam_thickness, self.a, self.c, self.B_frac, self.datum_z, [],
        )
        t = np.array([[1.0e9]])
        k = bare.curvature_magnitude(xx.reshape(-1, 1), yy.reshape(-1, 1), t)
        return float(np.max(k))
