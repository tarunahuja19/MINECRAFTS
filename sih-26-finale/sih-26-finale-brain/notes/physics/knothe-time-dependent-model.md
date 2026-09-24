---
title: Knothe Time-Dependent Influence Theory
slug: knothe-time-dependent-model
type: concept
module: physics
status: reviewed
tags: [physics, knothe, error-function, influence-theory, subcritical, equations]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP1-core-physics.md
---

# Knothe Time-Dependent Influence Theory

Deep-dive mathematical formulation of the Knothe Gaussian influence function governing the physical ground deformation in `src/minesim/physics.py` ([[work-packages/WP1-core-physics|WP1]]).

---

## 1. Classical Influence Integral

Knothe (1957) models underground extraction as an infinite collection of infinitesimal extraction elements causing Gaussian-distributed surface settlements. For an element extracted at underground coordinates $(\xi, \eta)$, the surface subsidence increment $dS(x, y)$ is:

$$dS(x, y) = \frac{S_{max}}{r^2} \exp\left(-\pi \frac{(x - \xi)^2 + (y - \eta)^2}{r^2}\right) d\xi d\eta$$

where:
- $r$ is the **radius of principal influence**:
  $$r = \frac{H}{\tan \beta}$$
- $H$ is the mining depth ($375.0\text{ m}$ for Adriyala LW1).
- $\beta$ is the angle of major influence ($\tan \beta = 2.0$, so $r = 187.5\text{ m}$).

---

## 2. Closed-Form Solution for Rectangular Longwall Panel

Integrating over a rectangular panel bounded transversely by $y \in [-W/2, +W/2]$ and longitudinally along the panel extraction axis yields the closed-form error function formulation:

$$S(y) = \frac{S_{max}}{2} \left[ \text{erf}\left(\frac{\sqrt{\pi}}{r} \left(y + \frac{W}{2}\right)\right) - \text{erf}\left(\frac{\sqrt{\pi}}{r} \left(y - \frac{W}{2}\right)\right) \right]$$

where $\text{erf}(z) = \frac{2}{\sqrt{\pi}} \int_0^z e^{-u^2} du$.

---

## 3. Subcritical Trough Formulation

A longwall panel is **supercritical** only if its width $W \ge 2r$.
For Adriyala Panel 1:
$$W = 250\text{ m} < 2r = 375\text{ m}$$
Because $W < 2r$, the panel is **subcritical**. The two inflection curves overlap before the trough can reach the full theoretical depth $a \cdot m$. Peak subsidence at the centreline ($y=0$) is:

$$S_{max\_subcritical} = a \cdot m \cdot \text{erf}\left(\frac{\sqrt{\pi} \cdot W}{2r}\right)$$

Evaluating at baseline defaults ($a=0.6, m=3.0\text{ m}$):
$$\text{erf}\left(\frac{\sqrt{\pi} \cdot 250}{2 \cdot 187.5}\right) = \text{erf}(1.1816) \approx 0.9056$$
$$S_{max} = 1800\text{ mm} \times 0.9056 = 1630.1\text{ mm}$$

---

## 4. Time Factor & Settling Tail

Subsidence does not occur instantaneously as the shearer passes. Settling follows Knothe's time-lag differential equation:
$$\frac{dS(t)}{dt} = c \cdot (S_{final} - S(t)) \implies f(t) = 1 - e^{-c \cdot t}$$

For Adriyala, $c = 0.02\text{ day}^{-1}$, giving a characteristic settling half-life:
$$t_{63} = \frac{1}{c} = 50.0\text{ days}$$
At an advance speed of $v_{advance} = 4.0\text{ m/day}$, the active settling tail behind the retreating face extends across:
$$L_{tail} = 3 \cdot t_{63} \cdot v_{advance} = 3 \cdot 50 \cdot 4.0 = 600.0\text{ m}$$

---

## 5. Related Notes & References

- **Implementation Package:** [[work-packages/WP1-core-physics]]
- **Derivatives & Curvature:** [[notes/physics/subsidence-derivatives-and-curvature]]
- **Empirical Field Grounding:** [[work-packages/WP0-data-pinning]]
- **Verification Gate:** [[gates/G01-single-physics-implementation]]
