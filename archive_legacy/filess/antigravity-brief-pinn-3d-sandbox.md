# Antigravity build brief — `pinn-sandbox`

A single-window 3D rig where a simulated mine surface sinks in real time, sensors
report from it, a PINN redraws it every epoch, and you can break things with
buttons and watch what happens.

**This is not the hackathon demo.** This is the instrument you use to find out
whether the hackathon demo is possible. It answers Q1 (demo clock) with a
measured number instead of a guess, and it lets you rehearse the *Kill Cluster*
moment two weeks before you need it on stage.

**Paste this whole file into Antigravity as the task brief. Do not summarise it.**

---

## 0. The one-paragraph version

A `StructuredGrid` of 64×64 points is drawn in a PyVista window. A background
thread advances simulated time, samples the analytic Knothe surface at 30 node
positions, ruins those readings the way real hardware would, drops some of them
on the radio, and pushes an epoch object into a queue. A second background
thread pulls the newest epoch, runs a few hundred warm-started Adam steps on a
13k-parameter MLP, and writes a fresh 64×64 height array into a shared buffer.
The render loop reads that buffer 20 times a second and moves the mesh points.
You watch a bowl form. Then you press *Kill Cluster* and watch six nodes go grey
and the hole heal itself over the next few retrains.

---

## 1. Non-negotiable invariants

The agent must not violate these. They are not preferences.

| # | Rule | Why |
|---|---|---|
| **I1** | There is **exactly one** implementation of `S(x, y, t)`, in `ground/surface.py`. Tilt, strain, extensometer and displacement are all derived from it by differentiation. No second formula, anywhere, ever. | Two generators disagree, and the disagreement looks exactly like a real anomaly. You will spend the demo detecting your own bug. |
| **I2** | `scoring/score.py` is the **only** file permitted to import from `truth/`. `pinn/` and `sim/` must not. `tests/test_physics_leak.py` enforces this by walking the import graph. | If the reconstruction can read the answer key it will score perfectly and you will not find out until a judge asks. |
| **I3** | Vertical exaggeration is a **render-only** multiplier. It never enters the model, the loss, the sensor sim, or any printed number. | Otherwise every metric on screen is silently 100× wrong. |
| **I4** | Only the main thread touches VTK actors. Worker threads write into locked numpy buffers; the render callback copies out. | VTK is not thread-safe. Violating this gives you segfaults that appear once every twenty minutes. |
| **I5** | The mesh object is created **once**. Frames update `mesh.points[:, 2]` and `mesh.point_data[...]` in place. Never `plotter.add_mesh` inside the loop. | Re-adding leaks actors, flickers, and drops you to 3 fps within a minute. |
| **I6** | `S` is defined **positive downward** (subsidence in metres, ≥ 0). The renderer draws `z = -S * exaggeration`. Every function docstring states its sign convention. | Sign bugs in derivative chains are the single most common way this class of project dies. |
| **I7** | Every node's noise is driven by a per-node seed from `config/nodes.json`. Two runs with the same config produce bit-identical readings. | Non-reproducible demos cannot be debugged. |

---

## 2. Tool choice — decided, do not re-litigate

| Concern | Choice | Rejected alternative |
|---|---|---|
| 3D rendering | **PyVista** (VTK) desktop window | Plotly `go.Surface` — rebuilds the whole figure per frame, dies above ~5 fps with a live update loop |
| Widgets | PyVista's built-in `add_slider_widget`, `add_checkbox_button_widget`, `add_text` | Dash/Streamlit — adds a web server and a serialisation hop for zero benefit in a single-user tool |
| Concurrency | `threading` + `queue.Queue` + `threading.Lock` | `multiprocessing` — you would have to pickle torch tensors across a pipe every epoch |
| ML | **PyTorch**, CPU only, `torch.set_num_threads(2)` | TensorFlow — second-derivative autograd is more awkward and you do not need the deployment story |

If the window fails to open (headless box, WSL without an X server), fall back to
`pv.Plotter(off_screen=True)` plus `pyvista.trame` served on `localhost:8080`.
Build this fallback behind a `--web` flag in Stage 0, not later.

```
python>=3.10
pyvista>=0.44
vtk>=9.3
torch>=2.2
numpy>=1.26
scipy>=1.11
```

---

## 3. The physics you are implementing

### 3.1 The surface

```
r      = depth_m / tan_beta                       # influence radius, 75 m
S_max  = subsidence_factor * seam_thickness_m     # 0.65 × 3.0 = 1.95 m
f(x)   = ½[ erf(√π (x − x1)/r) − erf(√π (x − x2)/r) ]
g(y)   = ½[ erf(√π (y − y1)/r) − erf(√π (y − y2)/r) ]
T(t)   = 1 − exp(−c t)                            # c from scenario, day⁻¹
S(x,y,t) = S_max · f(x) · g(y) · T(t)             # metres, POSITIVE DOWN
```

> Note for Adarsh: `part1-reference.md` §4.4 says *"`depth × factor` is your
> ceiling: 1.95 m"*. That is a typo — 150 × 0.65 is 97.5 m. The ceiling is
> `thickness × factor`. The number 1.95 was right, the sentence was not. Fix it
> in the source doc before a judge multiplies it out.

### 3.2 The one coupling constant

Everything else falls out of `S` and a single constant `B` (metres), the
horizontal-displacement coefficient. Put it in `nodes.json`. Default `B = 0.4 · r
= 30 m`.

```
horizontal displacement   U(x,y,t) = −B · ∇S            [m, vector]
tilt                      T(x,y,t) =  ∇S                [rad, vector]
strain along unit ê       ε        = −B · (êᵀ H ê)      [dimensionless]
extensometer A→C, ê       Δ        = (U(C) − U(A)) · ê  [m]
```

where `H` is the Hessian of `S`. The last two lines are the same statement:
`Δ = ∫_A^C ε ds` holds **exactly**, by construction, because both come from `U`.
That is what makes the claim in your Part 1 doc — *"the extensometer is the
integral of strain along its line"* — provable rather than asserted, and it is a
one-line answer when a judge asks why you trust two sensors that are not
independent.

`B` must be the **same symbol** in the generator and in the PINN's strain loss.
Import it from one place.

### 3.3 The damage chain (from `part1-reference.md` §2.3, unchanged)

```
true value from S
 → thermal drift   += k_thermal × (temp − temp_cal)
 → bias walk       += seeded random walk, persists for the whole run
 → white noise     += gaussian at datasheet σ
 → reference sag   ×= vbat / vbat_nominal
 → quantisation    =  round to ADC step
 → event transient += blast / truck / conveyor
```

Order is physical, not decorative. Do not reorder for convenience.

---

## 4. ⚠ The design decision that decides whether this is real

**Read this before writing `pinn/losses.py`.**

Your five-term loss has a physics term: *"at 2 000 random points, `S` must obey
the Knothe integral."* If that term is implemented as

```python
loss_phys = mse(S_net(xc, yc, tc), S_knothe(xc, yc, tc, **panel))   # ← WRONG
```

then the PINN is regressing directly onto the same closed form that generated the
truth. It will reconstruct the surface **perfectly with zero sensors connected**.
The demo will look flawless and the whole thing is circular. A judge who asks
*"what happens if I unplug every node?"* ends your presentation.

**The fix.** The physics term constrains the *family*; the data picks the
*member*. Panel corners and depth come from the mine plan and stay fixed. The
two numbers nobody knows in advance become learnable scalars:

```python
class PhysicsPrior(nn.Module):
    def __init__(self):
        self.log_a = nn.Parameter(torch.tensor(-0.7))   # subsidence factor, ~0.5
        self.log_c = nn.Parameter(torch.tensor(-2.3))   # time constant, ~0.1/day
```

`loss_phys = w · mse(S_net(collocation), S_family(collocation, a_hat, c_hat))`
with `w ≈ 0.1`. Now:

- with sensors, `a_hat` and `c_hat` converge to the truth and the surface is right
- with no sensors, the shape is right and the **magnitude is unconstrained** —
  which is honest, and is exactly what §4.4 of your doc already says about
  anchors ("nothing on any node measures depth")

**This gets a button.** *Kill ALL* nodes → RMSE must visibly degrade. If it does
not, your physics term is still leaking. `tests/test_physics_leak.py` asserts
`RMSE(no sensors) > 5 × RMSE(all sensors)` and must fail loudly if not.

---

## 5. Architecture — three loops, one lock

```
┌─ PRODUCER THREAD ──────────┐   Queue(maxsize=4)   ┌─ TRAINER THREAD ─────────┐
│ advance sim clock          │   drop-oldest        │ pull newest epoch        │
│ sample S at 30 nodes       │ ──────────────────►  │ warm-start from weights  │
│ apply 6-step damage        │                      │ N Adam steps             │
│ apply radio loss/death     │                      │ forward pass on 64×64    │
│ build epoch dict           │                      │ write into SurfaceBuffer │
└────────────────────────────┘                      └───────────┬──────────────┘
                                                                │ Lock
┌─ MAIN THREAD (VTK) ────────────────────────────────────────────▼─────────────┐
│ timer @ 50 ms: copy buffer → mesh.points[:,2] → update scalars → render()     │
│ widget callbacks: set flags on a shared ControlState object. Never train here.│
└──────────────────────────────────────────────────────────────────────────────┘
```

```python
class SurfaceBuffer:
    """Single-slot, last-write-wins. Trainer writes, renderer reads."""
    def __init__(self, nx, ny):
        self._z = np.zeros(nx * ny, dtype=np.float32)
        self._meta = {}
        self._lock = threading.Lock()
        self._dirty = False

    def write(self, z, meta):
        with self._lock:
            self._z[:] = z.ravel(); self._meta = meta; self._dirty = True

    def read_if_dirty(self):
        with self._lock:
            if not self._dirty: return None, None
            self._dirty = False
            return self._z.copy(), dict(self._meta)
```

The queue is **drop-oldest**, not blocking. If the trainer falls behind the
producer, you want the newest epoch, not a backlog. The gap between epoch
produced and epoch trained is itself a number worth displaying — it is exactly
the lag that Q1 is asking about.

---

## 6. The 3D scene

Camera starts at azimuth 45°, elevation 35°, looking at panel centre.

| Actor | Geometry | Appearance | Toggle |
|---|---|---|---|
| **Reconstruction** | `StructuredGrid` 64×64 over x∈[25,775], y∈[25,375] | opaque, colormap `turbo` on subsidence mm, scalar bar right | always on |
| **Truth ghost** | identical grid, analytic `S` | wireframe, grey, opacity 0.25 | `T` key, default ON |
| **Error sheet** | same grid, scalars = `abs(recon − truth)` in mm | replaces the reconstruction's colormap when active | `E` key, default OFF |
| **Panel box** | `pv.Box` at z = −depth, footprint x1..x2, y1..y2 | black wireframe, no fill | always on |
| **Draw-angle cone** | 4 lines from panel corners up-and-out at angle β | thin dashed grey | `D` key, default OFF |
| **Nodes** | 30 spheres, radius 6 m, sitting **on the reconstructed surface** | green alive / grey dead / amber alarming | always on |
| **Extensometer lines** | segment from each node's peg A to peg C, on the surface | thin white | `X` key, default ON |
| **Anchors** | 2 spheres at (860, 60) and (860, 340), z = 0 | blue, larger | always on |
| **Gateway** | 1 cone at (860, 200) | white | always on |

**Vertical exaggeration.** The footprint is 750 m × 350 m and the maximum
subsidence is 1.95 m — a 385:1 aspect ratio. Without exaggeration you are
looking at a flat sheet. Default multiplier **100×**, slider range 1–500. Put the
current value in the on-screen text so nobody misreads the shape as literal.

**The moment that must look good.** When six nodes die, the spheres go grey and
the reconstruction over that region should visibly *sag toward the physics prior*
over the next two or three retrains, rather than snapping. Warm-starting is what
makes that continuous. If it snaps, your warm start is broken.

---

## 7. Controls

Left-hand column of PyVista widgets, plus keyboard shortcuts.

| Control | Type | Effect |
|---|---|---|
| Sim day | slider 0–40 | seeks the producer clock; trainer resets warm start on a backwards seek |
| Speed | slider 0–2000× | producer wall-clock multiplier; 0 = pause |
| Vertical exaggeration | slider 1–500 | render only (**I3**) |
| Physics weight | slider 0–1 | live `w` on the physics term — drag it to 0 and watch the surface get noisy |
| Retrain steps | slider 50–1000 | Adam steps per epoch; this is the Q1 knob |
| **Kill Cluster** | button | marks 6 nodes near (300, 200) dead, permanently |
| **Kill ALL** | button | the falsification test from §4 |
| **Revive** | button | all nodes alive, bias walks preserved |
| **Inject Blast** | button | writes a blast event 120 kg at (310, 95); vib spikes, surface must not move |
| **Reset PINN** | button | reinitialise weights — shows you how much warm start is buying |
| Record GIF | key `G` | start/stop; writes `out/session.gif` |

### On-screen instrument panel (top-left, monospace)

```
epoch      1152   t = 8.60 d          ← if these two drift apart, the trainer is behind
nodes      28/30  (2 dead)
RMSE       11.4 mm   max 47.2 mm      ← vs truth; the only honest score
â          0.641  (true 0.650)        ← learnable physics params converging
ĉ          0.098  (true 0.100)
loss  tilt 0.0031  strain 0.0009
      ext  0.0014  anch  0.0000  phys 0.0122
retrain    847 ms                     ← THE NUMBER Q1 NEEDS
queue lag  1 epoch
fps        19.8
```

`retrain ms` is the reason this rig exists. Your §5.2 arithmetic assumed 1–3 s
per retrain and concluded Option D. Measure it here on your actual laptop with
your actual step count, then pick Q1 from data.

---

## 8. Build stages

Each stage has a gate. **Do not start stage N+1 until stage N's gate passes.**
Report the gate result before moving on.

### Stage 0 — skeleton and smoke test
Create the file tree, `requirements.txt`, and a `viz/app.py` that opens a PyVista
window showing a 64×64 sine surface with one slider that changes its amplitude,
updating in place via `mesh.points`.
**Gate:** window opens, slider is smooth, `--web` flag serves the same scene on
localhost. Report measured fps.

### Stage 1 — the ground engine
`ground/surface.py`: `S`, `grad_S`, `hess_S`, `displacement`, `strain_along`,
`ext_delta`. Vectorised numpy, plus a torch-compatible path for the loss.
`config/nodes.json` with the 31-radio layout from §8 of the system-flow doc.
**Gate:** `pytest tests/` green, specifically —
- analytic `∂S/∂x` vs central difference: max relative error < 0.1%
- analytic Hessian vs second-order central difference: < 0.1%
- `ext_delta(A,C)` vs numerically integrating `strain_along` over 500 sub-steps: < 0.1%
- `S(x, y, 0) == 0` everywhere; `S(centre, ∞) == S_max` to 4 decimals
- max tilt and max tensile strain occur **at the panel edge**, not the centre

That last one is your Test 4. Assert the position, not just the magnitude.

### Stage 2 — static scene
Everything in §6, rendered once at t = 40 days from analytic truth. No threads,
no PINN.
**Gate:** screenshot to `out/stage2.png` showing the bowl, the panel box below
it, 30 nodes sitting on the surface, and extensometer lines. Exaggeration slider
works. Camera can orbit at ≥ 30 fps.

### Stage 3 — the producer
`sim/sensors.py` (the six-step chain), `sim/radio.py` (loss by distance, dupes,
hop count, node death), `sim/producer.py` (thread, epoch dicts matching
`part1-reference.md` §4.3 **exactly** — same keys, same units, including `sigma`
and `dead_since`).
**Gate:** run headless for a full 40-day scenario; print epoch count and wall
time. Assert epoch object validates against a JSON schema derived from §4.3.
Assert two runs with the same seed produce identical output (**I7**). Report
sim-days per wall-second.

### Stage 4 — the PINN
`pinn/model.py` (3→64→64→64→64→1, tanh), `pinn/losses.py` (five terms, learnable
`a_hat`/`c_hat` per §4), `pinn/trainer.py` (thread, warm start, writes
`SurfaceBuffer`). Wire it into the scene.
**Gate:** run 40 sim-days live. RMSE vs truth must be < 30 mm from day 10
onward. Print median and p95 `retrain ms`. `tests/test_physics_leak.py` must pass
— kill all nodes and confirm RMSE degrades by > 5×.

### Stage 5 — interaction
All buttons from §7, including the surface heal-in after *Kill Cluster*.
**Gate:** record `out/kill_cluster.gif` — six nodes grey out, the dead zone
deforms toward the prior over 2–3 retrains without snapping, RMSE in that region
rises then partially recovers. If it snaps, fix the warm start.

### Stage 6 — instrument panel and README
The text block from §7, the GIF recorder, and a `README.md` with one screenshot,
the measured `retrain ms` distribution, and a three-line "what this proves".
**Gate:** a person who has not read this brief can clone, `pip install -r`, run
`python -m viz.app`, and understand what they are looking at within 30 seconds.

---

## 9. Traps

| Trap | Symptom | Fix |
|---|---|---|
| Rebuilding the mesh each frame | fps decays from 30 to 3 over a minute | **I5** — mutate `.points` in place |
| Torch on the render thread | UI freezes for 1 s every epoch | trainer thread only |
| VTK touched from a worker | random segfault every ~20 min | **I4** |
| `torch.set_num_threads` unset | trainer eats all cores, render stutters | set to 2 |
| Second derivatives | `RuntimeError: graph freed` | `torch.autograd.grad(..., create_graph=True)` on the first derivative |
| Slider callback fires per pixel | retrain storms while dragging | debounce: only act on value change > 1% or on release |
| Exaggeration in the loss | RMSE reads 1140 mm, looks catastrophic | **I3** |
| Warm start across a backwards time seek | surface refuses to un-sink | on backwards seek, reset optimiser state but keep weights |
| Anchors weighted too low | correctly shaped bowl at the wrong absolute depth | anchor weight fixed and high; it is the only absolute reference |
| `erf` in the torch path | you reach for `scipy` and break autograd | `torch.erf` is differentiable, use it |

---

## 10. What this rig buys you

1. **Q1 answered with a measurement.** `retrain ms` × retrains needed, on your
   hardware. Option D stops being a recommendation and becomes arithmetic.
2. **The circularity bug caught two weeks early** instead of on stage (§4).
3. **The *Kill Cluster* moment rehearsed** until it looks good, with a GIF you
   can drop straight into the deck if the live demo machine misbehaves.
4. **A defensible answer to "is this just interpolation?"** — drag the physics
   weight to zero in front of the judge and let them watch it fall apart.
5. **A validated `ground/surface.py`** that Part 2 imports unchanged. The
   sandbox is throwaway; the ground engine is not.

## 11. What this rig is not

Not the dashboard (Part 3, Leaflet, teammate-owned). Not the classical Knothe
detector — **no alarm logic goes in here**. Not a deliverable. If it starts
growing an alert panel, you are rebuilding Website 2 in the wrong framework.
Freeze it at Stage 6.
