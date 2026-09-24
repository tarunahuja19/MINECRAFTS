---
title: "Changelog: Anchor ID Ceiling Removed — Node Counts Are Now Pure Arithmetic"
slug: 2026-09-17-claude-code-anchor-id-cap-removed
type: changelog
module: sizing
status: reviewed
tags: [changelog, audit-trail, contract-amendment, anchors, g15, placement, mine-independence, renderer]
created: 2026-09-17
updated: 2026-09-17
author: claude-code
last_agent_edit: claude-code
source_file: project-updates/2026-09-17.md
---

# Changelog: Anchor ID Ceiling Removed — Node Counts Are Now Pure Arithmetic

## Agent: Claude Code
## Date: 2026-09-17 (session 24)
## Source: Adarsh, 17 Sep — "if there is any cap throughout the system to the use of anchors, or amounts, remove it, its purely arithmetic and algorithm"

Supersedes the anchor-count rule set one session earlier in
[[changelog/2026-09-17-claude-code-g15-anchor-count-rule]], which kept the 1–99 ID range frozen and
traded fail-over headroom away to fit inside it. Branch: `fix/g15-mine-independence-cap5`.

### The decision Adarsh made

Session 23 refused three exits and took a fourth: keep the range frozen, spread a too-big mine over
all 99 anchors, and accept a 495-scout ceiling. Adarsh has now overruled the premise itself. The
range was never physics — it was a fixed-width ID field standing in for a count that the algorithm
already computes. It is gone.

Asked first, because it contradicted Adarsh's own standing instruction in
`steps/F8-district-respace-tiers.md` ("HARD CONSTRAINT, DO NOT WORK AROUND: the anchor ID range stays
1-99"). Adarsh confirmed removal.

### What changed

| Before | After |
|---|---|
| `LAST_ANCHOR_ID = 99` | deleted |
| `anchors = min(ceil(scouts / nominal), 99)` | `anchors = max(2, ceil(scouts / nominal))`, no clamp |
| `FIRST_SCOUT_ID = 100` (works only while anchors ≤ 99) | `first_scout_id(n) = max(100, 1 + n)` — 100 is a floor, not a boundary |
| `ContractViolation` above `99 × cap` = 495 scouts | no ceiling; no maximum mine size |
| `checks.headroom_clamped` | removed — there is no clamp left to report |

`max_children_per_anchor` (5) is **kept**. It is one Anchor's radio capacity and the divisor in the
count above, not a cap on how many nodes exist. Removing it too would leave the anchor count
undefined and strip `radio.py` of its emergency sub-slot divisor (G10, G11); Adarsh chose not to.

### Effect on the two mines

| Mine | Scouts | Anchors before | Anchors after | First Scout ID |
|---|---|---|---|---|
| `adriyala_lw1` | 327 | 82 | **82 (unchanged)** | 100 (unchanged) |
| `illinois_lw` | 421 | 99 (clamped) | **106** | 107 |

Adriyala LW1's plan is **bit-identical** — `node_plan.json` `nodes` compares equal before and after,
₹1,029,000, 82 anchors. Illinois stops trading its fail-over headroom: every anchor on both mines now
holds a spare child slot.

### Consequence for step F8 — flagged, not acted on

`steps/F8-district-respace-tiers.md` exists **only** to squeeze a district from 1676 scouts down to
the 495-scout ceiling by re-spacing tiers. That ceiling no longer exists, so F8's blocking constraint
is gone and the step needs Adarsh's call: re-space anyway for cost/airtime reasons, or drop it.
Nothing in F8 was rewritten here beyond a banner saying so.

### Files touched

- `mine-sim/src/minesim/sizing.py` — `LAST_ANCHOR_ID` deleted, `first_scout_id()` added, ID-range `ContractViolation` removed.
- `mine-sim/src/minesim/placement.py` — clamp, `headroom_clamped` and the range refusal removed; scout IDs start after the anchors.
- `mine-sim/tests/gates/test_g15.py` — assertion 4 rewritten: contiguity + no ID collision replace "inside 1–99"; `99` dropped from `ALLOWED_LITERALS`.
- `mine-sim/tests/unit/test_placement.py` — same substitution.
- `files/11-interface-contracts-v1.md` — §3 anchor count rule and §6 ID allocation amended, old rule kept as a superseded block (RULES.md §0.3).
- `mine-sim/config/mines/adriyala_lw1.yaml` — district comment no longer claims a hard ceiling.
- `[[gates/G15-config-driven-mine-independence]]` — assertion 4 rewritten.

### Verification

- `python3 sync_vault.py --check` → 0 broken / 0 orphans / 0 frontmatter issues.
- `pytest -q` in `mine-sim/` → **198 passed, 1 skipped** — identical to the pre-change baseline.
- `scripts/stress_test.py` → **60 pass, 0 warn, 0 fail**; Adriyala 327 scouts / 82 anchors / ₹1,029,000.
- `node_plan.json` `nodes` byte-compared before/after: identical.

### Shipped in the same session

The renderer inspector now reads every per-node channel the simulator computes, instead of falling
back to the planner's static peaks. See [[changelog/2026-09-17-claude-code-node-telemetry-inspector]].
