---
title: "Changelog: G15 Repaired — Anchor Count Rule, Cap Stays 5, ID Range Stays Frozen"
slug: 2026-09-17-claude-code-g15-anchor-count-rule
type: changelog
module: sizing
status: reviewed
tags: [changelog, audit-trail, contract-amendment, anchors, g15, placement, mine-independence]
created: 2026-09-17
updated: 2026-09-17
author: claude-code
last_agent_edit: claude-code
source_file: project-updates/2026-09-17.md
---

# Changelog: G15 Repaired — Anchor Count Rule, Cap Stays 5, ID Range Stays Frozen

## Agent: Claude Code
## Date: 2026-09-17 (session 23)
## Source: Adarsh, 17 Sep — "max children per anchor should be 5, consider that and change the rest, and do G15, I want config to be mine-independent — you decide"

Follows [[changelog/2026-09-17-claude-code-children-per-anchor-5]], which recorded the 8 → 5 amendment
and the G15 breakage it caused. Branch: `fix/g15-mine-independence-cap5`.

### The decision Adarsh delegated

Three exits were on the table (`WHATS-LEFT.md` §2.1): restore the cap to 8, widen the anchor ID range,
or shrink the mine. **All three were refused, and a fourth was taken.** The cap of 5 is Adarsh's
standing decision and the ID range was already decided in session 21 (re-space tiers, do not unfreeze
the range). Shrinking the Illinois fixture would have made the gate prove nothing.

The fourth exit: **the spare child slot per anchor was never a hard limit — it was being enforced as
one.** `nominal = cap − 1` reserves one slot at every anchor so an orphan whose anchor dies can fail
over. That is a *preference*. The *hard* limits are `max_children_per_anchor` and the frozen ID range.
The planner was refusing to plan a mine because it could not have its preference.

### Change — `mine-sim/src/minesim/placement.py`

Anchor count is now: ask for `ceil(scouts / (cap − 1))`; if that does not fit 1–99, use the **whole**
99-anchor range and let mean load rise toward the cap. The full range is the largest anchor count
available, so it is also the lowest mean load and the most headroom the range can still buy.
`ContractViolation` is raised only at the true ceiling, `scouts > 99 × cap` = **495 scouts**.

`mine-sim/src/minesim/sizing.py` (v1 travelling cross) already chunked at the hard cap and had no
headroom to trade; only its error message changed, to name the real numbers instead of the literal
`1-99`.

### Result — measured, not asserted

| Mine | Scouts | Anchors | Anchors with a spare slot | Cost |
|---|---|---|---|---|
| `adriyala_lw1` | 327 | 82 | 44 / 82 | ₹1,029,000 |
| `illinois_lw` | 421 | 99 | 33 / 99 | ₹1,454,500 |

Adriyala — the demo mine — is **bit-identical** to before: it fits the preferred count, so nothing about
its plan moved. Illinois plans again for the first time since the cap amendment.

### [[gates/G15-config-driven-mine-independence]] — passing again

Both `xfail(strict=True)` markers removed: `tests/gates/test_g15.py::test_g15_second_mine_gives_valid_different_layout`
and `tests/unit/test_placement.py::test_mine_without_site_plans_on_flat_ground`. Invariant 8 is
evidenced again and may be quoted. Two new tests pin what must not regress:

- `test_g15_every_scout_respects_the_hard_cap_and_the_id_range` — the two hard limits, on both mines.
- `test_g15_headroom_is_traded_only_when_the_id_range_is_full` — Adriyala keeps its headroom; Illinois
  spreads over all 99 and still keeps some.

### Contract amendments — `files/11-interface-contracts-v1.md`

1. **§3, new paragraph:** the anchor count rule above, stated as binding, with the 495-scout ceiling
   and the `checks.headroom_clamped` / `checks.anchors_with_spare_slot` fields that report the trade.
2. **§3 `child_index`:** `0..7` → `0..max_children_per_anchor-1`. `0..7` was cap-8 arithmetic.
3. **§3 expected baseline output:** was "30 Scouts, 5 Anchors at 6 children each, ₹82,100" — stale on
   two counts (it predates the 50 m re-spacing, and 6 children now exceeds the cap of 5). Measured and
   replaced: 25 Scouts, 6 Anchors (loads 3/4/4/4/5/5), ₹72,800.
4. **§6 emergency sub-slot:** `0–7` → `0 .. max_children_per_anchor-1` (0–4 today). `radio.py` already
   divided the emergency window by the config value, so the contract prose was the only cap-8 leftover.

### Other files touched

- `mine-sim/config/mines/adriyala_lw1.yaml` — the district block's measured table cited cap-8 anchor
  counts. Rewritten against the 495-slot ceiling: 1 panel (327) fits, 2 panels (694) and 3 (972) do not.
- `steps/F8-district-respace-tiers.md` — its stop notice and its ≤650-scout target were computed against
  the old 396 ceiling. Target ceiling corrected to 495.

### What did NOT change

`layout.max_children_per_anchor` is still **5**. `FIRST_ANCHOR_ID` / `LAST_ANCHOR_ID` are still **1–99**.
No mine fixture was shrunk. F8 is still gated on re-spacing tiers, not on unfreezing anything —
its budget is just 495 scouts now instead of 396.
