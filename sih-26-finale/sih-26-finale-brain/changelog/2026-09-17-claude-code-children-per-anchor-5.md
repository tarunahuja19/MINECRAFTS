---
title: "Changelog: Contract Amended — max_children_per_anchor 8 to 5, G15 Knowingly Broken"
slug: 2026-09-17-claude-code-children-per-anchor-5
type: changelog
module: sizing
status: reviewed
tags: [changelog, audit-trail, contract-amendment, anchors, g15, placement]
created: 2026-09-17
updated: 2026-09-17
author: claude-code
last_agent_edit: claude-code
source_file: project-updates/2026-09-17.md
---

# Changelog: Contract Amended — max_children_per_anchor 8 to 5, G15 Knowingly Broken

## Agent: Claude Code
## Date: 2026-09-17 (session 22)
## Source: Adarsh, 17 Sep — "nodes per anchor is 5, that is children node"

> [!NOTE]
> **Superseded in part on the same day (session 23).** The cap of 5 stands, but the G15 breakage this
> entry accepted was repaired without touching the cap or the anchor ID range — see
> [[changelog/2026-09-17-claude-code-g15-anchor-count-rule]]. The "only honest fix is restoring the cap
> to 8" conclusion below turned out to be wrong: the fail-over headroom, not the cap, was the thing
> being over-enforced.

### Contract amendment (RULES.md §0.6 — the contract normally wins, so this needed Adarsh's word)
- `files/11-interface-contracts-v1.md` §assumptions `layout.max_children_per_anchor`: **8 → 5**.
- `mine-sim/config/assumptions.yaml` matched, with the amendment date and this changelog named in the comment.
- Adarsh was shown the cost before deciding: nominal fan-out is `cap - 1`, so 327 scouts now need
  `ceil(327/4) = 82` anchors instead of 47. Hardware cost ₹906,500 → **₹1,029,000** (+₹122,500).

### Consequence accepted with eyes open: G15 is now failing
- [[gates/G15-config-driven-mine-independence]] assertion 2 (swap the mine, layout reconfigures cleanly)
  **no longer holds**. At fan-out 4 no mine above `99 × 4 = 396` scouts fits the frozen 1–99 anchor ID
  range. `illinois_lw` needs 421 scouts → 106 anchors and raises `ContractViolation`.
- Adriyala LW1 (327 scouts → 82 anchors) is unaffected, so the demo mine still plans.
- `tests/gates/test_g15.py::test_g15_second_mine_gives_valid_different_layout` and
  `tests/unit/test_placement.py::test_mine_without_site_plans_on_flat_ground` are marked
  `xfail(strict=True)` with the reason and the way back written into the marker. **strict** so that if the
  cap or the ID range ever moves, the suite fails loudly instead of quietly going green.
- **While G15 is xfail the mine-independence claim is not evidenced.** Do not make it pass by shrinking the
  Illinois fixture or widening `FIRST_ANCHOR_ID`/`LAST_ANCHOR_ID`; either makes the gate prove nothing. The
  only honest fix is restoring the cap to 8.
- The cap is a **radio** constant, not a mine one (it sizes the TDMA superframe and the emergency window,
  `tests/unit/test_radio.py`), so making it per-mine was rejected as physically wrong.

### Second change in the same re-run: the session-19 anchor spacing defect, closed
- `min_anchor_spacing_m` (80 m) was enforced on cluster **centres**, but `placement.site_anchors` then chose
  each anchor's ground independently within `min_node_spacing_m` (20 m) of its own centre. Two centres at
  exactly 80 m could each drift 20 m toward the other, so anchors were installed **42.4 m** apart while the
  reported check still advertised 80.
- `site_anchors` is now greedy in centre order and rejects any candidate cell closer than
  `min_anchor_spacing_m` to an anchor already sited. The search ring widens from `min_node_spacing_m` up to
  the new `placement.max_anchor_offset_m` so an anchor can step out of a neighbour's way.
- New config key `max_anchor_offset_m: 120.0`, measured not guessed: 20 m → 41.2 m worst pair, 80 m → 72.1 m,
  **120 m → 80.0 m (clean)**. Cost is path length only — max scout link 150 m, median 36 m, against 43.7 dB
  of margin.
- New regression test `test_sited_anchors_honour_min_anchor_spacing` asserts the **sited** positions, not the
  centres, and that the reported check agrees with the geometry it describes.

### Decisions
- **Adarsh, 17 Sep:** amend the contract to 5 and re-run (asked with the anchor/cost/F8 consequences stated).
- **Adarsh, 17 Sep:** keep 5 and accept that Illinois fails, rather than reverting or bending the fixture.
- F8's 8-panel district is now permanently out of reach at this cap (it was already 2.58× over the 99-anchor
  budget at cap 8; at cap 5 it is ~4.5× over). See [[work-packages/WP2-sizing-algorithm]].
