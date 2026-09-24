# F8 — Turn the 8-panel district on by re-spacing the tiers

> # 🛑 THE CONSTRAINT THIS STEP EXISTS FOR IS GONE (17 Sep, session 24) — ADARSH'S CALL NEEDED
>
> This whole step is a plan to squeeze 1676 scouts down to a **495-scout ceiling** by widening tier
> spacing. That ceiling came from the fixed 1–99 anchor ID range. **Adarsh removed the ID range this
> session**, so the anchor count is now `ceil(scouts / (cap - 1))` with nothing truncating it and
> there is no maximum mine size. 1676 scouts would plan at 419 anchors and be refused by nothing. See
> the changelog entry `2026-09-17-claude-code-anchor-id-cap-removed` in the vault.
>
> Everything below — the ×1.84 respacing factor, the ≤ 495 / ≤ 99 targets in §C and §D.2, the
> "do not move 1C off 25 m" guard, and the HARD CONSTRAINT line at §62 forbidding exactly the change
> that was just made — was written against that ceiling and is **superseded**, kept for the record.
>
> **Two ways forward, Adarsh's choice:**
> 1. **Drop F8.** Turn `n_panels: 8` on at the sourced tier spacing. Costs hardware and TDMA airtime
>    (419 anchors, ~1676 scouts) — check the uplink window before committing.
> 2. **Keep F8, new reason.** Re-space anyway, because 1676 scouts is too expensive or will not fit
>    the 60 s superframe. That is a cost/airtime argument, not an addressing one, and it needs a new
>    target number from you rather than 495.
>
> ---
>
> # ⚠️ REVISED — UNBLOCKED, BUT THE BUDGET IS TIGHTER (17 Sep, session 23) — SUPERSEDED, SEE ABOVE
>
> The session-21 stop notice said F8 was arithmetically impossible. That is **no longer true**, and the
> reason it was true has been removed. See [[changelog/2026-09-17-claude-code-g15-anchor-count-rule]].
>
> **What changed.** `layout.max_children_per_anchor` stays **5** and the anchor ID range stays frozen at
> **1–99** — neither escape was taken. What moved is the *anchor count rule*: the one spare child slot
> per anchor is fail-over headroom, a preference, not a hard limit. A mine that cannot have one spare
> slot per anchor now spreads over all 99 anchors instead of refusing to plan. The real ceiling for any
> one mine is therefore `99 × cap` = **495 scouts**, not 396. G15 passes again.
>
> | | scouts | fits in 99 anchors at cap 5? |
> |---|---|---|
> | Adriyala, single panel (today) | 327 | ✅ 82 anchors, 44 with a spare slot |
> | `illinois_lw` (the G15 second mine) | 421 | ✅ 99 anchors, 33 with a spare slot |
> | **F8's target after re-spacing** | **≤ 495** | ✅ at the ceiling — was ≤ 650, now corrected |
> | 8 panels as they stand | 1676 | ⛔ needs a 3.4× reduction by re-spacing |
>
> **Corrections to the rest of this step, which was written against the old 396 / ≤650 numbers:**
> - §C target: **≤ 495 scouts and ≤ 99 anchors** (was ≤ 650 / ≤ 93).
> - §D.2 test bounds: **≤ 495 scouts, ≤ 99 anchors** (was 650 / 93).
> - The hard constraint in §1 still stands verbatim: do not widen the ID range, do not raise the cap.
> - 1676 → 495 is a harder squeeze than the 1676 → 650 this step was budgeted for. If re-spacing cannot
>   reach it without moving 1C off its sourced 25 m, **STOP and report the counts reached** — exactly as
>   §C already instructs. Fewer than 8 panels may be the honest answer.
>
> Both `illinois_lw` `xfail(strict=True)` markers are gone; mine independence and flat-ground planning
> are evidenced again.

**In plain words:** A real mine works a group of parallel panels, not one strip. F6 Phase B already built that and switched it off, because 8 panels need 240 anchors and the frozen contract only allows 99. We are not unfreezing the contract. We are spreading the sensors out — which is what a real deployment does anyway — until 8 panels fit inside 99 anchors.

**Plan:** Adarsh's decision, 17 Sep (session 20), answering the escalation in [F6 §4b](F6-district-shell-graphics.md). Needs a full re-run and a re-export.

## Why re-space rather than unfreeze

`files/11-interface-contracts-v1.md` §6 freezes the anchor ID range at 1–99, and it wins over everything (CLAUDE.md, AGENTS.md invariant 8). Widening it touches every consumer of a node ID — backend, frontend, the wire format — for a visual gain. Re-spacing costs nothing outside `placement`, and is the more defensible engineering: **you do not instrument a settled goaf at the same density as an active face.** Today we do, which is why 8 panels blow the budget.

## The budget, measured

`placement.py:451`: `n_anchors = ceil(n_scouts / nominal)` with `nominal = layout.max_children_per_anchor`. Measured 327 scouts → 47 anchors, so `nominal ≈ 7`.

| `n_panels` | scouts | anchors | vs. cap 99 |
|---|---|---|---|
| 1 (today) | 327 | 47 | OK |
| 2 | 694 | 100 | ✗ over by 1 |
| 3 | 972 | 139 | ✗ |
| 8 | 1676 | 240 | ✗ |

**Ceiling (corrected 17 Sep, session 23): 99 anchors × cap 5 = 495 scouts.** The table above and the ×1.61 figure below were computed at the old cap of 8 (`nominal ≈ 7`); they are kept for the record, not as targets. Target **≤ 495 scouts / ≤ 99 anchors**.

8 panels must therefore drop from 1676 to ≤ 495 scouts — a factor of **3.39**. Uniformly that is spacing × √3.39 ≈ **× 1.84**, i.e. 1C 25→46 m, 1B 50→92 m, 1A 100→184 m.

**Do not do it uniformly.** 1C at 40 m breaks its source: `geotechnical-grid-spacing-vs-radio-range-v2` §2.1 says scouts sit at **15–25 m where ground fails**. Keep 1C at 25 m and shrink the *1C band* instead, so the sourced density survives where it is justified, and the savings come from the low-strain ground that does not need it.

## 1 · Paste into Antigravity

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (§6 especially), sih-26-finale-brain/RULES.md, steps/F6-district-shell-graphics.md (all of §4 and §4b), sih-26-finale-brain note geotechnical-grid-spacing-vs-radio-range-v2, and this step. Branch feat/viz-darker-ground-bigger-nodes, do not commit. Only edit the files listed. If the spec can't be implemented as written, STOP and tell me why. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Report exact pytest counts.

HARD CONSTRAINT, DO NOT WORK AROUND: the anchor ID range stays 1-99. FIRST_ANCHOR_ID and LAST_ANCHOR_ID are frozen by contract §6. Do not widen them, do not add a second range, do not raise max_children_per_anchor to dodge the count. If the target cannot be hit inside the frozen range, STOP and report the numbers you reached.

STEP F8 · 8-panel district inside the frozen anchor budget

Files you may edit: mine-sim/config/mines/adriyala_lw1.yaml, mine-sim/config/assumptions.yaml (placement.spacing_by_tier_m and the tier band thresholds ONLY), mine-sim/src/minesim/placement.py, mine-sim/tests/unit/test_district.py, mine-sim/tests/*, walkthroughs/step-f8-district/*.

A. Re-space, keeping 1C honest
1. Leave placement.spacing_by_tier_m["1C"] at 25.0. It is sourced (scouts 15-25 m where ground fails) and must not move. Say so in a comment.
2. Raise 1B and 1A. Start from 1B 50->90, 1A 100->200 and tune from there. Every value you land on keeps its "# OPEN — design choice" marker and gains "; widened for the 8-panel district (F8), budget in steps/F8" .
3. Narrow the 1C band so 1C covers only ground that actually earns it: the active face region and the rib / chain-pillar lines between panels, where strain is highest. The band thresholds are natural breaks over peak strain (placement.py) — tighten the top break rather than hand-listing regions, so a different mine file still works. This is where most of the saving must come from.
4. Settled bowl floors (low peak strain, far behind the face) fall to 1A at the new wide spacing. That is the intended outcome, not a regression.

B. Switch the district on
1. mine-sim/config/mines/adriyala_lw1.yaml district.n_panels: 1 -> 8. Replace the "BLOCKED / DECISION NEEDED" comment block with the resolution: decided 17 Sep, re-spacing not contract change, and the measured table from this run.
2. chain_pillar_width_m 40.0 and start_stagger_days 80.0 stay as they are, still marked OPEN.
3. The PROVENANCE comment already in that file stays and must stay accurate: only the centre panel is LW1 from 10.18311/jmmf/2022/32099; panels 2-8 are LW1's geometry repeated on a plausible pitch, SYNTHETIC. Carry the same wording into run_summary.json and scene.json per invariant 7. A viewer must be able to tell which panel is the real one.

C. Targets
Land on <= 495 scouts and <= 99 anchors at n_panels: 8 (corrected 17 Sep session 23; was 650/93). Report the achieved counts. If you cannot reach it without moving 1C off 25 m, STOP and report the best you reached and what it cost — do not move 1C silently.

D. Tests
1. The F6 B7 gate test must still pass untouched: n_panels 1 / y_offsets_m (0.0,) reproduces the fitted single-panel result bit-for-bit. If your spacing change breaks it, your change is in the wrong place — spacing must not alter the physics. Fix that before anything else.
2. Add to mine-sim/tests/unit/test_district.py: at n_panels 8, anchors <= 99 and scouts <= 495; every anchor ID is within 1-99; every scout has a primary and a distinct backup parent; spacing_by_tier_m["1C"] == 25.0 (a guard, so a later tuning pass cannot quietly break the sourced value).
3. Do not edit an existing failing test to make it pass. List any failure by name and STOP.

E. Re-run and re-export
1. Re-run the 690-day simulation on the district. Report wall-clock, delivery rate, scouts, anchors.
2. Re-export the renderer scene (renderer/export_scene.py). Report scene.json size and total frames size — the world grid is now ~8 panels wide, so both will grow; if scene.json passes 30 MB, raise downsample_cells rather than cropping the district, and say what you raised it to.
3. Run mine-sim/scripts/stress_test.py and report its sections.

Report: the spacing values you landed on and why; achieved scouts/anchors at n_panels 1 AND 8 as a table; mine-sim pytest count (baseline 157 passed, 1 skipped); stress test; scene.json and frames sizes; run wall-clock and delivery rate. Screenshots: whole district at day 345 and at day 690, top view, so the stagger is visible — settled, active and untouched panels in one frame. Write the walkthrough. STOP.
```

## 2 · Paste into Claude (check)

```text
Check step F8
```

Claude checks: `FIRST_ANCHOR_ID` / `LAST_ANCHOR_ID` untouched and `max_children_per_anchor` unchanged; the single-panel gate test still passes bit-for-bit, proving spacing did not move the physics; 1C is still 25 m; the synthetic-panels provenance survived into `run_summary.json` and `scene.json`; achieved counts are inside 495/99; the re-export really regenerated (timestamps, not a stale scene).

## 3 · You check by hand

| # | Do | You should see |
|---|---|---|
| 1 | Open the view, zoom all the way out | Eight parallel troughs across the real terrain, not one strip |
| 2 | Play from day 0 to 690 | Panels start one after another ~80 days apart; the first is settled while the last is still moving |
| 3 | Look at the gaps between panels | Unsunk chain pillars — ribs of higher ground between the bowls |
| 4 | Look at the dot density (after F7) | Dense along the active face and the ribs; sparse over settled bowl floors |
| 5 | Find the label | Something on screen says which panel is the real LW1 and that the other seven are synthetic |

## 4 · Fix prompt (only if Claude's check found problems)

_Empty until Claude's check._
