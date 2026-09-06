"""
Sensor corruption (spec 4.5).

Spec 4.5 is explicit and non-negotiable: do not output clean signals, because
clean signals do not transfer to real hardware. Every channel gets three
corruptions plus quantisation, applied in a FIXED order:

    1. temperature-dependent bias shift   v += k_T * (T_die - T_ref)
    2. slow bias drift (random walk)      v += b(t),  b a scaled Brownian path
    3. white Gaussian noise               v += sigma_w * xi
    4. quantisation to the wire format    v  = round(v / LSB) * LSB

Order matters. Temperature bias is a physical property of the die and exists
before the readout chain adds noise; quantisation happens last because it is
the ADC packing the already-corrupted analogue value into an integer. A chain
applied in a different order cannot be inverted downstream in the same way.

Stage 1 is the reason die_temp is carried on every MPU-6050 node even though
the sensor image does not list it separately: without the temperature that
produced the bias, the bias is uncorrectable.

Per-node personality (bias seeds, temperature coefficients, sigma scale) is
drawn ONCE per node and frozen, never re-drawn per timestep. Two runs from the
same seed therefore produce byte-identical data.
"""

from __future__ import annotations

import numpy as np

from . import constants as K

# The corruption stage order, frozen. Recorded in metadata so a silent
# reordering during a refactor is visible in the data itself.
STAGE_ORDER = ("temp_bias", "drift_bias", "white_noise", "quantise")


def random_walk(
    rng: np.random.Generator, n_nodes: int, n_steps: int, sigma_per_sqrt_day: float, dt_s: float
) -> np.ndarray:
    """
    Slow bias drift as a scaled random walk, shape (n_nodes, n_steps).

    sigma_per_sqrt_day is the standard deviation the bias accumulates over one
    day, which is how MEMS bias instability is normally quoted.
    """
    dt_days = dt_s / 86400.0
    step = sigma_per_sqrt_day * np.sqrt(dt_days)
    increments = rng.normal(0.0, step, size=(n_nodes, n_steps))
    return np.cumsum(increments, axis=1)


def corrupt(
    rng: np.random.Generator,
    clean: np.ndarray,
    die_temp: np.ndarray,
    channel: str,
    quant_key: str | None,
    sigma_scale: np.ndarray | None = None,
    dt_s: float = K.DT_SECONDS,
) -> np.ndarray:
    """
    Apply the full four-stage corruption chain to one channel.

    clean      (n_nodes, n_steps) physically-true values
    die_temp   (n_nodes, n_steps) degC, drives stage 1
    channel    key into K.NOISE
    quant_key  key into K.QUANT, or None to skip quantisation
    sigma_scale per-node multiplier on the white-noise floor (node personality)
    """
    sigma_w, sigma_drift, k_temp = K.NOISE[channel]
    n_nodes, n_steps = clean.shape
    v = np.array(clean, dtype=np.float64, copy=True)

    # -- stage 1: temperature-dependent bias -------------------------------
    # Each node gets its own temperature coefficient around the nominal, since
    # no two parts drift identically.
    k_node = k_temp * rng.normal(1.0, 0.25, size=(n_nodes, 1))
    v += k_node * (die_temp - K.TEMP_REF_C)

    # -- stage 2: slow bias drift ------------------------------------------
    v += random_walk(rng, n_nodes, n_steps, sigma_drift, dt_s)

    # -- stage 3: white noise ----------------------------------------------
    scale = np.ones((n_nodes, 1)) if sigma_scale is None else sigma_scale.reshape(-1, 1)
    v += rng.normal(0.0, 1.0, size=(n_nodes, n_steps)) * sigma_w * scale

    # -- stage 4: quantisation ---------------------------------------------
    if quant_key is not None:
        lsb = K.QUANT[quant_key]
        v = np.round(v / lsb) * lsb

    return v
