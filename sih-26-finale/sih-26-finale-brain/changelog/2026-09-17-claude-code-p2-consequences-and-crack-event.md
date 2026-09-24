---
title: "Changelog: P2 — Consequences, Objects, the Crack Event, and the Crack Baseline in the Rebuild"
slug: 2026-09-17-claude-code-p2-consequences-and-crack-event
type: changelog
module: scenario-lab
status: reviewed
tags: [changelog, audit-trail, scenario-lab, cracks, vibration, damage, wp9, s7]
created: 2026-09-17
updated: 2026-09-17
author: claude-code
last_agent_edit: claude-code
source_file: steps/P2-consequence-and-events.md
---

# Changelog: P2 — Consequences, Objects, the Crack Event, and the Crack Baseline in the Rebuild

## Agent: Claude Code
## Date: 2026-09-17 (session 27)
## Source: Adarsh, 17 Sep — "go for p2"; decisions D-S1 / D-S3 / D-S4 / D-S5 as recorded in `steps/P1-zones-and-crack-bridge.md` §0

Branch `feat/p2-consequence-and-events`, off `feat/p1-zones-and-crack-bridge`. Part 2 of 6 (see
`steps/S0-terrain-events-plan.md` for the whole shape, `steps/CHECKLIST.md` for live progress).

### What was added (no formula of its own anywhere in it)

- `scenario-lab/lab/consequence.py` — the one `evaluate()` every scenario and, later, every forecast
  goes through. Turns before/after surfaces into crack lines, object answers and plain sentences.
- `scenario-lab/lab/objects.py` + `config/objects.yaml` — the illustrative village (8 houses, 2 roads,
  8 poles, 1 tower) declared in the **panel frame** and transformed once at load against
  `panel.y_offsets_m` (hazard H8). An object outside the grid is refused, never clamped (WP9 §6).
- `scenario-lab/lab/vibration.py` — the shaking layer, from **caving only**. Blast stays deferred
  (D-S4), so nothing reads the unverified `blast_k` / `blast_b`.
- `scenario-lab/lab/events/crack.py` + `config/events/crack.yaml` — "the ground keeps moving N more
  days", capped by the ground's own remaining capacity.
- `scenario-lab/lab/baseline.py` — the run's **latched** crack state, read from `out/cracks/` and
  resampled once, bilinearly, from the export's 10 m grid onto the world's 5 m grid (hazard H6).
- `scenario-lab/lab/sampling.py` — the one bilinear sampler, the polyline/footprint samplers, and a
  small marching-squares for contour **lines**.
- `scenario-lab/lab/tools/what_if.py` — prints the whole answer in words, for the hand check.

### Geometry, as Adarsh asked for it (session 26)

Cracks come back as **line segments**, one per cracked cell, through the cell centre, bearing =
principal-strain direction turned a quarter turn (a fissure opens across the pull). Vibration comes
back as **contour lines** at the levels in `lab.yaml`. Subsidence keeps the radius taper.

### S7 — the crack baseline now survives a rebuild (closes `WHATS-LEFT.md` §1.5)

- `run-simulation.sh` gains **step 9/9**, running `scripts/export_cracks.py` after the sensor run.
- The bare `cell = 10.0` in that script moved into config as `cracks.export_cell_m`
  (`mine-sim/config/assumptions.yaml`, new `CracksConfig` field). The lab resamples from it, so a
  number the lab cannot read is a number it guesses.
- The export now writes **four days in one walk** (`--day 172,345,517,690`), because the lab can
  freeze any day and refuses to count new cracks without a baseline for that day. One shared walk of
  the latch: 2.5 s for four days.

### Two defects the new gates caught in this session's own code

1. `consequence.evaluate` began with `np.asarray(s, dtype=np.float64)`, which **launders an int array
   into floats** and so defeated gate L5 at the one boundary where the int-mm world grid can reach
   the derivative path. It now refuses a non-float surface outright.
2. A crack bearing of exactly 180° could leave the wire after rounding (179.998 → 180.0), outside the
   `[0, 180)` range the payload promises for a line. Wrapped at the rounding step.

Gate L4 also refused two display literals (`corners[3]`, a preview row count); both became named
values, one in `lab.yaml`.

### Gate L8 extended — the cross-check now covers what the lab SAYS, not only what it derives

- **L8-6** null scenario: with `ds = 0` at the exported day, `evaluate` must reproduce the exported
  crack field cell for cell. Measured at day 690: crack widths agree to a **median 1.37 %** (p95
  6.24 %) over the 4,675 cells cracked in both, the NCB grade differs on **0.14 %** of the 25,564
  overlapping cells, and **0 new cracks** are reported.
- **L8-7** crack bearings must run across the exported principal-strain direction — measured median
  deviation from perpendicular **0.00°** over 4,000 lines. Mutation-checked: inverting the quarter
  turn in `consequence.py` fails this gate and nothing else.

### Verification

`scenario-lab` **125 passed** (was 70). `mine-sim` **198 passed, 1 skipped** — unchanged count with
the new `export_cell_m` key. Vault **PERFECT** (0 broken / 0 orphans / 0 frontmatter).

### Still open

- **D-S2** (crack/vibration columns in `out/nodes.csv`) — unchanged, still (b): their own file.
- **D-S4** (blast K, b) — deferred by Adarsh; no blast event exists, so nothing quotes them.
- Railway and pipe objects (`RL1`, `PP1`) remain **S6**, as planned; `objects.py` knows three types.

**Related:** [[work-packages/WP9-scenario-lab]] · [[docs/interface-contracts]] ·
[[gates/G14-no-pinn-in-alarm-path]] · [[notes/physics/subsidence-derivatives-and-curvature]]
