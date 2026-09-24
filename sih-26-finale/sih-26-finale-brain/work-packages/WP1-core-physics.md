---
title: "WP1 — Core Physics S(x,y,t)"
slug: WP1-core-physics
type: work-package
module: physics
status: reviewed
tags: [work-package, wp1, physics, knothe, error-function, derivatives, subcritical]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP1-core-physics.md
---

# WP1 — Core Physics `S(x,y,t)`

| Field | Details |
|---|---|
| **Owner** | [[people/claude-code\|Claude Code]] (Lane B) |
| **Depends on** | [[work-packages/WPC-contracts-and-skeleton\|WP-C]] |
| **Accepted against** | [[work-packages/WP0-data-pinning\|WP0]] (code proceeds on defaults; acceptance waits for repinned params) |
| **Blocks** | [[work-packages/WP2-sizing-algorithm\|WP2]], [[work-packages/WP3-world-state-engine\|WP3]] |
| **Days Scheduled** | D1–D2 |
| **Enforces Gate** | [[gates/G01-single-physics-implementation\|Gate G01]] |

---

## 1. Goal

Implement the sole mathematical engine for surface ground movement $S(x,y,t)$ and its spatial/temporal derivatives. All modules calling for subsidence, tilt, curvature, strain, or displacement MUST call into this module.

---

## 2. Files Owned

```
src/minesim/physics.py
tests/unit/test_physics.py
tests/gates/test_g01.py
```

---

## 3. Mathematical Formulation

### 3.1 Transverse Profile
Knothe influence theory integrating the Gaussian distribution over panel width $W = 250\text{ m}$:
$$S(y) = \frac{S_{max}}{2} \left[ \text{erf}\left(\frac{\sqrt{\pi}}{r} \left(y + \frac{W}{2}\right)\right) - \text{erf}\left(\frac{\sqrt{\pi}}{r} \left(y - \frac{W}{2}\right)\right) \right]$$
where $r = H / \tan \beta = 187.5\text{ m}$.

### 3.2 Longitudinal Profile & Advance
Models the travelling extraction front at $x_{face}(t) = v_{advance} \cdot t$:
$$S(x, t) = \frac{1}{2} \left[ 1 + \text{erf}\left(\frac{\sqrt{\pi}}{r} (x_{face}(t) - x)\right) \right]$$

### 3.3 Dynamic Time Settling Factor
$$f(t) = 1 - e^{-c \cdot t}$$
where $c = 0.02\text{ day}^{-1}$ ($t_{63} = 50\text{ days}$).

### 3.4 Subcritical Trough Correction
Because $W = 250\text{ m} < 2r = 375\text{ m}$, the panel is subcritical. Peak subsidence does not reach $a \cdot m$. The maximum subsidence must be calculated from geometry:
$$S_{max} = a \cdot m \cdot \text{erf}\left(\frac{\sqrt{\pi} \cdot W}{2r}\right)$$
Under pre-WP0 baseline defaults ($a=0.6, m=3.0\text{ m}$), $S_{max} = 1630\text{ mm}$ versus $1800\text{ mm}$ full.

---

## 4. Single-Implementation Invariant (Gate G01)

> [!IMPORTANT]
> **No Closed-Form Derivatives Allowed:** Tilt ($\partial S / \partial x, \partial S / \partial y$), curvature ($\partial^2 S / \partial x^2, \partial^2 S / \partial y^2$), strain ($\Delta S / \Delta L$), and displacement are computed **strictly numerically** from `subsidence()`. Hand-deriving closed forms creates formula drift that breaks [[gates/G01-single-physics-implementation|Gate G01]].

### Strain Finite Difference:
Strain is evaluated over physical gauge lengths ($10\text{ m}$ rod for Tier 1B, $30\text{ m}$ wire for Tier 1C):
$$\epsilon(x) = \frac{S(x + L/2) - S(x - L/2)}{L}$$

---

## 5. Performance Requirement

`subsidence(x, y, t)` must be fully vectorised over NumPy arrays. Evaluation of a $625 \times 800\text{ m}$ grid at $5\text{ m}$ cell resolution ($125 \times 160 = 20,000\text{ cells}$) must execute in **under 50 ms** on standard hardware, as [[work-packages/WP3-world-state-engine|WP3]] invokes this function thousands of times.
