---
title: "Changelog: Monday Build M1–M5 by Claude Code"
slug: 2026-09-14-claude-code-monday-build-m1-m5
type: changelog
module: integration
status: reviewed
tags: [changelog, audit-trail, physics, sizing, world-state, sensors, radio, stream]
created: 2026-09-14
updated: 2026-09-14
author: claude-code
last_agent_edit: claude-code
source_file: files/BUILD-PLAN.md, walkthroughs/step-01b-physics-sign-fix/, walkthroughs/step-06-wp6-writers-run/
---

# Changelog: Monday Build M1–M5 by Claude Code

## Agent: Claude Code
## Date: 2026-09-14
## Source: Adarsh asked Claude Code to build Monday's steps itself (multiple Antigravity windows were confusing); Antigravity starts Tuesday

### Files updated (vault)
- `projects/subsidence-simulator/decisions.md` — new §8: face-cliff physics finding and fix, provenance 100% synthetic until the survey line is located (OPEN), layout result 33/5/1 at ₹99,500, airtime table cells. → [[projects/subsidence-simulator/decisions]]

### Outside the vault (code, all committed)
- `mine-sim/src/minesim/physics.py` — displacement sign, horizontal strain, panel-end clamp, Knothe time lag in closed form (no cliff at the face). → [[work-packages/WP1-core-physics]]
- `config.py`, `assumptions.yaml` — sensors block, radio link keys, tier percentiles, `survey_line_x_m`, all OPEN guesses.
- `sizing.py` — travelling-cross layout, percentile tiers, anchors, cost; gates G02, G03, G12, G15. → [[work-packages/WP2-sizing-algorithm]]
- `world.py` — int32 mm grid, exact replay; gates G06, G13; 690-day world run 7.5 s. → [[work-packages/WP3-world-state-engine]]
- `sensors.py`, `provenance.py` — read_node pipeline and provenance rules; gate G04. → [[work-packages/WP4-sensor-models-provenance]]
- `packet.py`, `radio.py` — Semtech airtime, TDMA slots, loss, emergency retry via child_index, dedup on (node_id, epoch); gate G07. → [[work-packages/WP5-radio-tdma]]
- `stream.py`, `run.py` — nodes.csv / npz / jsonl / run_summary writers and CLI; 690-day run 58 s. → [[work-packages/WP6-stream-and-output]]
- WP0 Step 0 fixes R0-1, R0-2, R0-6 (G00 fit record honest; Illinois relabelled synthetic fixture). → [[gates/G00-data-pinning]]
- `handoff/v1-sample/` — 690-day sample (nodes.csv.gz, summary, t=0 terrain, README).
- Walkthroughs step-01b, 02, 03, 04, 05, 06; day files in `work-with-tools/` and `work-with-system/` updated.

### Decisions
- None made by Claude. Open for Adarsh: `survey_line_x_m` source; D1–D7 still pending.
