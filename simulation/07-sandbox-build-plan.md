# 07 — Interactive Mine Sandbox: Build Plan

**Status:** Draft v1
**Owner:** Adarsh (Part 1)
**Supersedes:** nothing. Extends 01 (`S(x,y,t)`), 04 (`nodes.csv`), 06 (alarm pipeline).
**Audience:** internal team only. Not a judge artifact.

---

## 0. Scope

### 0.1 What this is

An interactive, deterministic, physics-driven mine sandbox. A 3D terrain with node
markers on it. The operator selects a region and applies an intervention. The ground
responds according to closed-form subsidence mathematics. While it runs, it writes
`nodes.csv` every 60 simulated seconds.

Its purpose is to be the **integration surface** for Parts 2 and 3 — the thing their
code runs against while the real system is still being designed.

### 0.2 What this is NOT — and why

| Not building | Reason |
|---|---|
| Any neural network | The simulator *computes* `S(x,y,t)` in closed form. Approximating a function you already possess exactly is strictly worse than evaluating it — slower, less accurate, and it converges back toward its own input. This is the circularity trap in its purest form. **DROPPED.** |
| Training data pipeline | Consequence of the above. The CSV is integration data, not a training set. |
| Bulk parquet sink | `nodes.csv` is the sole output. **DROPPED.** |
| Pre-recorded replay | Stream comes live off the running simulation. |
| Alarm logic | Belongs to Part 2 (file 06). The sandbox emits *readings* and, separately, *truth*. It does not decide. |
| Hardware abstraction | Sensor set is treated as fixed. Additions arrive as extra hardware and extra columns; handled later. **DROPPED as a concern.** |
| Judge demo polish | Later, larger effort. This is a workbench. |

### 0.3 The second network — parked, not dead

The interpretation/fusion network (the one that reads every channel and infers *what
happened*) is out of scope here but **this document constrains it**, see §2.3.

One flag for later: file 06 locks the classical Knothe-fit detector as the sole alarm
decision-maker. If the second network becomes the alarm source, that decision is being
reversed and needs an explicit entry in the decision log. Not resolving that here —
just noting that two documents currently disagree.

---

## 1. Baseline Mine

Real Indian mine, published geometry, citable.

**Adriyala Longwall Project (ALP), SCCL, Godavari Valley, Telangana.**

| Parameter | Symbol | Value | Provenance |
|---|---|---|---|
| Panel width | `W` | 250 m | Two completed panels at 250 m width, 2500 m length; wider than the Indian norm of 100–150 m |
| Panel length | `L` | 2500 m | same |
| Depth of cover | `H` | 375 m | High-capacity powered support deployed at 375 m depth |
| Seam thickness | `m` | **3.0 m — ASSUMED** | ⚠ Not found in open literature. Placeholder. Flag to CIL/SCCL contact. |
| Face advance | `v` | 2.7–4.8 m/day | Measured at Adriyala panel 1 |
| Subsidence factor | `a` | 0.75 (supercritical) | Caving; literature range 0.7–0.9 |
| Influence angle | `tan β` | 1.9 | 1.82 fitted at Barapukuria, same Gondwana strata |
| Time factor | `c` | 0.04 day⁻¹ | Matched measured curves via SDPS |
| Tensile strain limit | `ε_t` | 5.3 mm/m | Kamptee coalfield, Central India |
| Compressive strain limit | `ε_c` | 6.6 mm/m | same |

### 1.1 Derived — do not hand-enter these

```
r = H / tan β = 375 / 1.9 = 197.4 m          radius of major influence
W/H = 250 / 375 = 0.67                        → SUBCRITICAL panel
```

**The panel is subcritical.** `W/H = 0.67` is well below the ~1.2 threshold for full
subsidence. Peak subsidence will therefore be substantially less than `a·m = 2.25 m`.

Do **not** hand-correct for this. The Knothe convolution produces the subcritical
reduction automatically — that is what the convolution is *for*. If you find yourself
applying a manual reduction factor, the convolution is wrong. This is test gate **T33**.

---

## 2. Three Constraints That Shape Everything

### 2.1 Time compression — LOCKED

One tick = **60 simulated seconds**. Sim-time runs faster than wall-time under an
operator speed slider.

At 1:1 the ground moves ~0.4 mm across a ten-minute session. Nothing renders, nothing
logs meaningfully, Parts 2 and 3 receive a flat line. Accelerated, a two-minute session
covers weeks of subsidence and produces a file with structure in it.

- All timestamps in `nodes.csv` are **sim-time**.
- Default speed: 2000×.
- Collapse events auto-snap to 10× so they are visible.
- Ticks, not wall-seconds, are the unit of everything downstream.

### 2.2 The SNR contract — the most important section in this document

The stated detection target: a channel drifting from **9.0 → 9.4 over 20 minutes**.

At 60 s/tick, 20 minutes is **20 samples**, and the signal is **0.4 units**.

This is a hard constraint on the corruption chain, in both directions:

- **Noise too high** → the trend is buried, Part 2's detector cannot possibly work, and
  they will waste weeks tuning against an impossible problem.
- **Noise too low** → the detector looks brilliant in the sandbox and fails in the field.

So the simulator must **prove its own detectability** at startup. Given noise σ, the
standard error of a 20-sample linear trend fit is approximately:

```
SE_slope ≈ σ · sqrt(12 / (n · (n² − 1)))      n = 20
margin   = Δsignal / (SE_slope · n)
```

The sim prints this margin on boot and **refuses to start below 3.0**. If the noise
budget makes the reference signal undetectable, that is a bug in the noise budget, and
it must fail loudly rather than silently hand Part 2 an unsolvable dataset.

Test gate **T34**.

### 2.3 Node coverage — an unresolved finding

From 02b: detection threshold `Δ_edge = r/3`. With `r = 197 m`, required spacing is
**66 m**.

Full-panel coverage including draw margin (≈175 m each side at a 25° angle of draw)
means a footprint of roughly 600 m × 2850 m. At 66 m spacing that is **~390 nodes.**

The layout in 02b has 28.

**This is not a fixable arithmetic error. It is an architectural finding:** a fixed array
cannot cover a 2.5 km longwall panel at Knothe resolution. The array must be a **travelling
window that follows the face.**

| Option | Window | Spacing | vs. `r/3 = 66 m` |
|---|---|---|---|
| A | 600 × 600 m | 113 m | 1.7× under-sampled |
| B | 400 × 400 m | 76 m | 1.15× — acceptable |
| C | 600 × 600 m, 100 nodes | 66 m | exact, but 3.6× the node budget |

**Recommend B** for the sandbox. It is honest, it fits 28 nodes, and "the array travels
with the face" is a genuinely stronger engineering story than "we blanket the panel" —
it is also how real longwall instrumentation is actually deployed.

Decision required before Session A completes.

---

## 3. Architecture

Physics lives in Python. The browser renders and controls. Nothing else.

The alternative — physics in TypeScript — would be faster to stand up and would create a
second implementation of `S(x,y,t)`. That is the banned outcome from file 03. Not
revisiting it.

```
┌─ BROWSER ── Vite + TS + React + @react-three/fiber ─────────────┐
│  terrain mesh · node markers · region select · 4 buttons        │
│  speed slider · vertical-exaggeration badge (×1 snap)           │
│  RENDERS ONLY. Holds no physics.                                │
└──────────────────────── WebSocket ──────────────────────────────┘
                              ↕
┌─ PYTHON ── FastAPI ─────────────────────────────────────────────┐
│                                                                  │
│  terrain.py    Z₀(x,y)     static baseline                      │
│  surface.py    S(x,y,t)    ★ THE single implementation           │
│  collapse.py               discontinuous events                  │
│  segments.py               zone state machine → console          │
│  sensors.py                sampling + corruption                 │
│  session.py                tick loop, CSV writer                 │
│                                                                  │
└──────────────────────────── writes ─────────────────────────────┘
                              ↓
                    nodes.csv   (per 60 sim-seconds)
                    events.csv  (on state transition)
```

### 3.1 Quarantine

Unchanged from file 05, restated because it is load-bearing:

- `truth/` contains `surface.py`, `collapse.py`, `segments.py`.
- `truth/` has **no `__init__.py`**. There is no import path from `sensors.py` or from
  anything the backend touches.
- Exactly one implementation of `S(x,y,t)` exists in the repository. Test gate **T35**
  greps for a second one and fails the build if found.

### 3.2 Wire protocol

Browser → Python:
```json
{"action": "collapse", "region": [x0, y0, x1, y1], "magnitude": 0.6}
{"action": "set_speed", "multiplier": 2000}
```

Python → Browser, per tick:
```json
{"t_sim": 86400,
 "time_scalar": 0.031,
 "perturbations": [{"cx": 340, "cy": 1200, "amp": -0.42, "sigma": 88}],
 "nodes": [{"id": 14, "tilt_x": 0.21, "strain": 4.8, ...}],
 "segments": [{"id": "Z-14", "state": "TENSION", "eps": 4.8}]}
```

**Bandwidth:** the base bowl is sent **once** on connect. Per tick, only the time scalar
and the active perturbation list travel. Browser reconstructs. ~2 KB/tick instead of
~64 KB — and it structurally prevents the browser from drawing anything the maths did not
produce.

---

## 4. The Four Interventions

### 4.1 The rule

Buttons write to the **ground model**, never to the sensor array.

❌ Puppet: button sets node 14's reading to 5 mm/m.
✅ Simulator: button lowers pillar factor-of-safety in region R → `collapse.py`
recomputes → surface deforms → every node within `r = 197 m` changes *because of where
it sits*.

Only the second is defensible, and it is also what makes it look real: click one region,
and nodes 200 m away twitch later, by the right amount, without anyone authoring that.

### 4.2 The set

| Button | Writes to ground model | Response | Timescale |
|---|---|---|---|
| **Stress** | ↑ extraction ratio in region | local bowl deepens | days |
| **Tension** | force edge-effect tensile zone | fissures where ε > 5.3 mm/m | days |
| **Collapse** | pillar FoS → <1, void propagates | step discontinuity, curvature spike | hours |
| **Vibration** | **nothing** — transient on accel channel only | surface unchanged, 0 mm | seconds |

**Vibration is deliberately the odd one out.** A blast shakes every node hard and moves
the ground zero millimetres. If a detector fires on it, that detector is broken. This
button is the test rig for the DGMS blast-log false-alarm filter — the strongest
differentiator in the project. Test gate **T36**: vibration produces zero change in
`S(x,y,t)` and non-zero change in the accelerometer channel.

---

## 5. Session Prompts

Six sequential Antigravity sessions. Each has a gate. Do not proceed past a red gate.

---

### SESSION A — Physics core, headless

> Build `terrain.py` and `surface.py` for a mine subsidence simulator. No UI, no server,
> no sensors — pure NumPy.
>
> `terrain.py` generates a static baseline elevation `Z₀(x,y)` over a 600 × 600 m window,
> parametric (gentle slope + low-amplitude noise), seeded and deterministic.
>
> `surface.py` implements exactly one function `S(x, y, t)` using the Knothe influence
> method:
> - Kernel `k(x) = (1/r)·exp(−π·x²/r²)` with `r = H/tanβ`
> - Bowl = `a·m · (A ⊛ k)` where `A` is the extraction footprint mask
> - Time function `s(t) = 1 − exp(−c·t)`
>
> **Critical implementation requirement:** compute derivatives by convolving with the
> *analytic derivative of the kernel*, never by finite-differencing the output grid.
> `∂S/∂x = A ⊛ (∂k/∂x)`. The kernel is Gaussian so `∂k/∂x` is closed form and the
> convolution is separable. Finite differencing injects error that mimics the signal.
>
> Expose four channels via Aviershin's relation:
> `tilt = ∂S/∂x` · `curvature = ∂²S/∂x²` · `displacement = B·∂S/∂x` ·
> `strain = B·∂²S/∂x²`, with `B ≈ 0.35r`.
>
> Parameters from §1. Plot the bowl and a strike-line profile with matplotlib.

**Gate T33:** peak subsidence must come out **below** `a·m = 2.25 m` without any manual
correction factor, because `W/H = 0.67` is subcritical. If it hits 2.25 m the convolution
is wrong. If you had to apply a reduction factor by hand, the convolution is wrong.

**Also resolve here:** the §2.3 coverage decision (A/B/C). Freeze the node layout.

---

### SESSION B — Discontinuous events and segmentation

> Add `collapse.py` and `segments.py`.
>
> `collapse.py` handles what Knothe cannot: sudden failure. Knothe is a smooth
> convolution, so every event it produces is a slow trough. Model pillar failure as a
> local factor-of-safety field; when FoS drops below 1 in a region, propagate a void
> upward and superimpose a localised step on the surface over hours, not weeks. This is
> additive to the Knothe bowl, not a replacement.
>
> `segments.py` divides the window into a zone grid and runs a per-zone state machine
> each tick, reading **truth only, never sensors**:
> `STABLE → SETTLING → TENSION → CRITICAL → FAILED`
> Transitions driven by strain and curvature against the §1 thresholds
> (5.3 mm/m tensile, 6.6 mm/m compressive).
>
> Emit a console line on every transition:
> ```
> t=+112d  Z-14  TENSION    ε=+4.8mm/m  κ=1.2e-4  ⚠ approaching threshold
> t=+118d  Z-14  CRITICAL   ε=+5.6mm/m  ← fissure predicted
> t=+119d  Z-15  SETTLING   S=0.31m
> ```

**Gate T37:** a scripted pillar failure produces a visible step discontinuity **and** a
curvature spike, and the affected zone reaches `CRITICAL` before it reaches `FAILED`.
If it jumps straight to `FAILED`, there is no warning window and the whole product
thesis is dead.

---

### SESSION C — Session loop, server, CSV

> Add `session.py` and a FastAPI WebSocket server.
>
> Tick loop: one tick = 60 simulated seconds. Speed multiplier controls ticks per
> wall-second. Logging starts when the session starts and stops when it stops — no
> unbounded accumulation.
>
> Write `nodes.csv` per the schema in file 04, timestamps in sim-time. Write `events.csv`
> on every segment state transition, with the `duration_s` column.
>
> Implement the §2.2 SNR self-check. On boot, compute the 20-sample trend detectability
> margin for the 9.0 → 9.4 reference signal against the configured noise budget. Print
> it. **Refuse to start if the margin is below 3.0.**
>
> Wire protocol per §3.2. Base bowl sent once on connect; per-tick messages carry only
> the time scalar and active perturbations.

**Gate T34:** boot refuses when noise is inflated past the detectability limit.
**Gate T38:** a 2000× session runs 10 wall-minutes without sim-time drift, and the CSV
row count equals the tick count exactly.

---

### SESSION D — 3D scene

> Vite + TypeScript + React + `@react-three/fiber`. Renderer only — no physics in the
> browser.
>
> Terrain mesh from `Z₀` with the live subsidence delta applied. Node markers coloured by
> segment state. Orbit controls.
>
> **Non-negotiable:** a vertical-exaggeration badge, always visible, with a hard snap to
> ×1. Peak subsidence here is sub-metre over a 600 m window — at true scale it is
> invisible, so exaggeration is mandatory, which makes an un-labelled view actively
> misleading. Default ×20, snap available at ×1.
>
> Reconstruct the surface from the base bowl plus perturbation list. Never request a full
> grid.

**Gate T39:** surface visibly deforms live; ×1 snap shows a near-flat plane, proving the
exaggeration is a display transform and not baked into the physics.

---

### SESSION E — Interaction

> Region select (drag a rectangle on the terrain) plus the four buttons from §4.
>
> Every button writes to the ground model. None writes to the sensor array.
> Speed slider with auto-snap to 10× on collapse events.

**Gate T40:** apply Stress to one region; nodes ~200 m away must respond, with a lag,
at an amplitude consistent with `r = 197 m`. If only nodes inside the selection move,
the buttons are puppeting the sensors and Session E has failed.

**Gate T36:** Vibration changes the accelerometer channel and leaves `S(x,y,t)` at
exactly zero delta.

---

### SESSION F — Handoff

> Freeze the `nodes.csv` / `events.csv` schemas against file 04. Write a one-page README
> for Parts 2 and 3: how to start a session, what the columns mean, what the units are,
> what the corruption chain does and in what order (so the C7 corrector can invert it —
> battery sag undone **before** thermal drift, per file 06).
>
> Ship three canned scenarios: quiet baseline, slow tension build, sudden collapse.

**Gate T41:** a teammate who has not seen this repository can start a session and load the
output without asking you a question.

---

## 6. Sequencing Note

A → B → C are yours alone and block nobody.

**F is what Parts 2 and 3 are waiting on.** Once Session A passes its gate, consider
stubbing F early with a single canned scenario, so your two teammates can start building
against correctly-shaped files while you are still on D and E. A week of them coding
against a stub beats a week of them blocked.

---

## 7. New Test Gates

| ID | Gate | Session |
|---|---|---|
| T33 | Subcritical reduction emerges from convolution, no manual factor | A |
| T34 | SNR margin ≥ 3.0 enforced at boot; refuses otherwise | C |
| T35 | Exactly one `S(x,y,t)` in repo; build fails on a second | A |
| T36 | Vibration → zero surface delta, non-zero accel delta | E |
| T37 | Pillar failure reaches CRITICAL before FAILED | B |
| T38 | 2000× session: no drift, rows == ticks | C |
| T39 | ×1 exaggeration snap proves display-only transform | D |
| T40 | Intervention propagates to nodes outside the selection | E |
| T41 | Cold-start handoff with no verbal explanation | F |

---

## 8. Open Items

1. **Seam thickness `m`** — assumed 3.0 m. Needs a real number from SCCL/CIL.
2. **§2.3 coverage decision** — A, B, or C. Blocks Session A completion.
3. **Alarm ownership** — file 06 says classical detector; §0.3 second network implies
   otherwise. Two documents disagree. Not blocking this build, but log it.
