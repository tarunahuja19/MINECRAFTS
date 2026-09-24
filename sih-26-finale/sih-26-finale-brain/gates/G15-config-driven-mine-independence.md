---
title: "Gate G15 — Config-Driven Mine Independence"
slug: G15-config-driven-mine-independence
type: gate
module: sizing
status: reviewed
tags: [gate, g15, mine-independence, config-driven, no-magic-numbers, invariant]
created: 2026-09-13
updated: 2026-09-17
author: adarsh
last_agent_edit: claude-code
source_file: files/WP2-sizing-algorithm.md
---

# Gate G15 — Config-Driven Mine Independence

> [!SUCCESS]
> **UPDATED 17 Sep 2026 (session 24) — the anchor ID ceiling is gone.** Adarsh: *"if there is any cap
> throughout the system to the use of anchors, or amounts, remove it, it's purely arithmetic and
> algorithm."* `LAST_ANCHOR_ID = 99` is deleted. The anchor count is now
> `ceil(scouts / (max_children_per_anchor - 1))` with nothing truncating it, and Scout IDs start at
> `max(100, 1 + anchors)`. Adriyala LW1 is bit-identical (327 scouts, 82 anchors, scouts still from
> 100, ₹1,029,000); `illinois_lw` unclamps 99 → **106 anchors**, scouts from 107, and keeps the spare
> fail-over slot it used to trade away. `checks.headroom_clamped` is gone with the clamp that set it.
> Assertion 4 below is rewritten accordingly. See
> [[changelog/2026-09-17-claude-code-anchor-id-cap-removed]].
>
> **PASSING again since 17 Sep 2026 (session 23).** Both `illinois_lw` tests
> (`test_g15_second_mine_gives_valid_different_layout` and `test_mine_without_site_plans_on_flat_ground`)
> are back to ordinary asserts; the `xfail(strict=True)` markers are gone. Invariant 8 is evidenced again.
>
> **What was wrong.** `layout.max_children_per_anchor` was amended 8 → 5 on 17 Sep. The planner sized
> anchors at `ceil(scouts / (cap − 1))` unconditionally, so nominal fan-out fell 7 → 4 and any mine above
> `99 × 4 = 396` scouts raised `ContractViolation` against the frozen 1–99 anchor ID range. `illinois_lw`
> (421 scouts) could no longer be planned.
>
> **How it was fixed — without touching the cap or the ID range.** The one spare child slot per anchor is
> *fail-over headroom*, a preference; the *hard* limits are the cap and the ID range. The planner now asks
> for the preferred count, and when that does not fit 1–99 it spreads the scouts over the whole 99-anchor
> range (the largest count available, hence the lowest mean load and the most headroom still purchasable)
> instead of refusing. It raises `ContractViolation` only at the true ceiling,
> `scouts > 99 × max_children_per_anchor` = **495 scouts**. `illinois_lw` now plans at 99 anchors with 33
> of them still holding a spare slot. Adriyala LW1 is bit-identical (327 scouts → 82 anchors, ₹1,029,000).
>
> The cap stays 5 and the anchor ID range stays frozen at 1–99, so the gate still proves what it claims.
> Two new tests pin the hard limits and the trade rule so neither can regress silently.
> See [[changelog/2026-09-17-claude-code-g15-anchor-count-rule]] and
> [[changelog/2026-09-17-claude-code-children-per-anchor-5]].

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP2-sizing-algorithm\|WP2]] |
| **Owner** | [[people/claude-code\|Claude Code]] |
| **Verification Target** | Invariant 8 & No Magic Numbers |
| **Test Script** | `tests/gates/test_g15.py` |

---

## 1. Assertion

1. Changing any assumption value in `config/assumptions.yaml` automatically updates network sizing and derived constants without altering any Python code in `src/`.
2. Swapping the mine specification file (e.g. from `config/mines/adriyala_lw1.yaml` to `config/mines/illinois_lw.yaml`) reconfigures panel geometry, influence radius, and network layout cleanly without code modifications.
3. No hardcoded physical constants (e.g. `375`, `250`, `2500`, `61.7`, `0.6`, `187.5`) appear as numeric literals in `src/` outside `config.py` docstrings.
4. **(added 17 Sep 2026, rewritten session 24)** `layout.max_children_per_anchor` is the **only** hard limit, and it is one anchor's radio capacity — the divisor in the count, not a ceiling on it. On every mine: no anchor exceeds it; anchor IDs run contiguously up from `FIRST_ANCHOR_ID`; no Scout ID collides with an Anchor ID; and the anchor count equals the arithmetic with nothing truncating it, so every anchor keeps its spare fail-over slot on every mine. There is no maximum mine size. `node_plan.json` carries `checks.anchors_with_spare_slot` and `checks.nominal_children`.

   *Superseded (session 23):* a second hard limit — the frozen 1–99 anchor ID range — capped the count at 99 anchors / 495 scouts, and headroom was traded away when the preferred count did not fit. `checks.headroom_clamped` reported that trade.

---

## 2. Test Implementation

- AST scanner flags any numeric literals matching the forbidden constants list.
- Runs `size_network()` under two distinct mine configuration files and asserts that node counts, bounds, and coordinates adapt dynamically.
- `test_g15_every_scout_respects_the_hard_cap_and_the_id_range` — assertion 4's hard half, on both mines.
- `test_g15_headroom_is_traded_only_when_the_id_range_is_full` — Adriyala keeps a spare slot on every anchor; Illinois, which cannot, spreads over all 99 and still keeps some.
