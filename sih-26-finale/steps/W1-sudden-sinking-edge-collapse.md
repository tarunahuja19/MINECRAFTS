# W1 — Scenario types 1 and 3

> **BUILT by Claude, 17 Sep (session 22)** — not pasted into Antigravity. Both events implemented and tested on the 690-day run; see [`walkthroughs/step-t5-w1-scenario-lab/WALKTHROUGH.md`](../walkthroughs/step-t5-w1-scenario-lab/WALKTHROUGH.md). The Window 2 page (W4) and the server (W3) are still unbuilt, so the header button stays disabled.

**In plain words:** Two "what if" events: the ground suddenly sinks at a point, and a panel edge collapses.

**Antigravity files owner:** AG-1 (one Antigravity chat for everything is fine; this only says whose files these are).

⚠️ **Don't paste yet:** the reference numbers (≈524 mm, ≈147 mm) were worked out before the 14 Sep refit. Claude rechecks them first.

## 1 · Paste into Antigravity

New chat? Paste `steps/00-connect-antigravity.md` first and wait for `CONNECTED`.

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative inside mine-sim/), sih-26-finale-brain/RULES.md, your WP file, and the step below. For anything in scenario-lab/ or renderer/, sih-26-finale-brain/work-packages/WP9-scenario-lab.md is authoritative. Only edit the files your step lists. If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: physical and assumption values come from config with a source comment (unit conversions like 1000 and 86400 are fine; in scenario-lab/ gate L4 lists the exact allowed literals). Sign at every file/JSON boundary: negative = ground went down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Run tests from inside mine-sim/ (or scenario-lab/). Report the exact pytest count; never say "tests pass" without it.

STEP W1 · Scenario types 1 and 3

WP9 §5 rows 1 and 3. Files: scenario-lab/config/events/sudden_sinking.yaml, config/events/edge_collapse.yaml, scenario-lab/lab/events/sudden_sinking.py, lab/events/edge_collapse.py, lab/events/__init__.py (register both), scenario-lab/tests/test_sudden_sinking.py, tests/test_edge_collapse.py. Each yaml lists every input with default, min, max, unit, source: "scenario input — not measured at this mine". Call physics.subsidence only; never write a second trough formula. Tests on out/v2-690d: (a) sudden sinking 10 m behind the face at day 300 → possible, max(ds) > 0 at the click; (b) at (100, 0) on day 690 → not possible, reason says "already settled"; (c) at (1500, 0) on day 300 (300 m ahead of the face) → not possible, reason says "no extracted coal"; (d) ds ≥ 0 everywhere and ds == 0 beyond R + r; (e) edge collapse at (600, +150) on day 300 with pillar_width_m = 20 → ds ≈ 147 mm at (600, 150) (± 5%), ds < min_effect at (600, −150), max tilt near the +y rib increases; (f) y0 = 0 → not possible; (g) same inputs → identical arrays. Walkthrough step-13-lab-sinking-edge. Report max(ds) and the reason text for each test. Reference values (Claude, 14 Sep): sudden sinking capacity U at (1190, 0), day 300 ≈ 524 mm; at (100, 0), day 690 ≈ 0.15 mm.

When done: write walkthroughs/step-w1-sudden-sinking-edge-collapse/WALKTHROUGH.md and test_results.txt (skip if the step names its own walkthrough folder), report the exact pytest counts, then STOP and wait for review.
```

## 2 · Paste into Claude (check)

```text
Check step W1
```

Claude answers **PASS** or writes a **fix prompt** into section 4 of this file. On PASS say `commit W1`.

## 3 · You check by hand

In Window 2 (after W3 + W4): day 300 sudden sinking at x ≈ 1190, y = 0 → visible dip. Day 690 at x = 100, y = 0 → "Not possible … already settled". Day 300 at x = 1500, y = 0 → "Not possible … no extracted coal". Edge collapse day 300 at x = 600, y = +150, pillar 20 → change near the +y edge only.

## 4 · Fix prompt (only if Claude's check found problems)

None yet.
