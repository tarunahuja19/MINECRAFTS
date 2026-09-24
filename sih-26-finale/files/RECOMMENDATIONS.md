# RECOMMENDATIONS — simulation as a product feature, and changes to the plan

---

## PART 1 — THE SIMULATION FEATURE, WRITTEN DOWN PROPERLY

### 1.1 What it is

Name it. Suggested: **Consequence Renderer** — or in the deck, *predictive digital twin of the panel surface*.

It is not a test harness. It is a user-facing capability with three jobs:

| # | Job | Why it earns its place |
|---|---|---|
| J1 | **Scale demonstration** | You cannot instrument a 250 × 2500 m panel for a hackathon. The renderer shows the 35-node mesh operating across a full panel so scale is shown, not asserted |
| J2 | **Consequence rendering** | The ML emits numbers — 380 mm at a coordinate in six days, tilt 4 mm/m. A mine manager cannot act on that. The renderer turns the forecast into a picture of the ground: this stretch dips like this, that structure leans like this, a crack opens here |
| J3 | **Scenario testing** | Operators push historical or hypothetical parameters — face advance rate, panel depth, extraction height — and see the projected surface outcome, using data they already hold |

J2 is the one that wins the room. Every other team will show a chart going up. You show what the chart *means* on the ground. That is a different category of answer.

### 1.2 The data flow — keep this clean

```
live sensor data ──► backend ──► ML prediction
                                   │  (subsidence field, severity, horizon,
                                   │   uncertainty — spatial, not scalar)
                                   ▼
                        CONSEQUENCE RENDERER
                                   │
                                   ▼
              rendered surface + visible impact at panel scale
                    (clearly labelled PREDICTED, not MEASURED)
```

**The renderer consumes predictions. It does not produce them, and it has no path to the alarm.** Same principle as C1: it draws, it never decides.

### 1.3 The risk you must design against

A rendered prediction that looks like a photograph of reality will be mistaken for reality. By a judge, and later by an operator. That is a safety problem, not a cosmetic one.

**Required, not optional:**

- [ ] Provenance (C2) extends to the visual layer. Measured geometry and predicted geometry must be **visually distinguishable at a glance** — different rendering treatment, not a legend in the corner
- [ ] A persistent on-screen label stating which mode is showing: `LIVE (MEASURED)` / `FORECAST (PREDICTED)` / `SCENARIO (HYPOTHETICAL)`
- [ ] Forecast views render the uncertainty band, not just the central estimate. A single confident surface implies precision the model does not have
- [ ] The forecast timestamp and horizon visible on screen at all times
- [ ] Never animate a predicted collapse in a way that looks like footage

Say this out loud in the pitch. "We deliberately made our prediction look like a prediction" is a mature answer that separates you from teams whose demo is a pretty lie.

### 1.4 Build order for the renderer

1. Static surface from the existing `S(x,y,t)` — no ML, no live data. Proves the geometry pipeline
2. Time evolution — the surface changes over the panel's life
3. Node overlay — the mesh on the surface, with live health
4. Ingest a real ML prediction and render it, labelled as forecast
5. Scenario inputs — change face advance rate, re-render
6. Consequence layer — reference objects on the surface (a road line, a structure footprint) that visibly deform, so the magnitude is legible to a non-specialist

Stop after 4 if time runs short. Items 5 and 6 are what make it memorable, but 1–4 are what make it true.

### 1.5 Reference objects — the cheap trick that carries J2

A 380 mm dip across 200 m is invisible to the eye at panel scale, and that is exactly why the numbers fail to communicate. Put known objects on the rendered surface — a road centreline, a rectangular building footprint, a line of poles — and let them deform with it. The viewer reads the tilt off the object, not off the terrain. This is a small amount of work for most of the demo's impact.

---

## PART 2 — RECOMMENDED CHANGES TO THE PLAN

### R1 — Do not let the simulator become the project

Category is **Hardware**. The renderer is your best demo asset and your biggest scope risk simultaneously. You are one person on it with a natural pull toward polish. Set a hard stop: once items 1–4 above work, you switch to helping the hardware pair until the node is solid. Write the stop condition down now, while it is easy to agree to.

### R2 — Assign S12–S16 today

GIS, alert delivery, three roles, offline sync, mobile. Five named PS deliverables with no owner. The backend pair is already carrying ingest, storage, the alarm detector and the API. Either the hardware pair absorbs alert delivery and offline sync once the node is stable, or the dashboard scope is explicitly thinned to demo depth and you say so deliberately. Both are fine. Drifting into day four undecided is not.

### R3 — The ML output format is an interface, and it is yours too

The renderer consumes ML predictions. That makes ML → simulator an interface on the same footing as backend → ML. Agree it in writing this week: spatial format, units, horizon, uncertainty representation, how missing regions are expressed. If you get this wrong you will be reformatting arrays at 2am.

### R4 — The external dataset is still the one unclosable gap

Nobody can resolve it by writing documentation. One Sentinel-1 InSAR series over an Indian coalfield, or one published longwall survey profile. Without it, the simulator generates the data and then grades itself on it, and any judge who asks "how do you know your model is right" gets an answer that collapses. Assign it to a named person with a date. It blocks validation, not construction, so the build can proceed in parallel.

### R5 — Write the tilt decision down before someone asks

Tilt is listed first in the PS. Your docs demote it for sound physical reasons — thermal drift can exceed the subsidence signal. That reasoning is correct and it is good engineering. But unwritten, it reads as a skipped requirement. Have the hardware team produce the measured drift curve and put it in the deck. "We implemented tilt as required, measured its drift at X mm/m over a diurnal cycle against a subsidence signal of Y, and therefore treat it as corroborating rather than primary" is a strong answer. Silence is not.

### R6 — Your differentiators, ranked

The wireless surface mesh is now in the PS text itself. It is table stakes. What is left:

1. **DGMS Circular 7/1997 blast seismograph reuse** — mandated logs already on site, reused as a false-alarm filter. Zero hardware cost, removes the largest false-positive source. Almost certainly unique to you
2. **The consequence renderer** — turning a forecast into a visible physical outcome
3. **Two-tier alert architecture** — ML advisory, classical confirmed, auditable to a regulator
4. **Physics-grounded sizing** — node count derived from Knothe curvature sampling error, so "why 35 nodes" has a number behind it

Lead with 1 and 2.

### R7 — One thing to drop

Operator interventions in the simulator — node kill, blast injection, manual collapse triggers. Already deferred to v2, correctly. Keep them there even when they start looking tempting for the demo, because they add scenario surface without adding evidence that the system works.
