# W2 — Scenario type 2 (crack)

**In plain words:** "What if" event: cracks open as the ground keeps moving for N more days.

**Antigravity files owner:** AG-2 (one Antigravity chat for everything is fine; this only says whose files these are).

## 1 · Paste into Antigravity

New chat? Paste `steps/00-connect-antigravity.md` first and wait for `CONNECTED`.

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative inside mine-sim/), sih-26-finale-brain/RULES.md, your WP file, and the step below. For anything in scenario-lab/ or renderer/, sih-26-finale-brain/work-packages/WP9-scenario-lab.md is authoritative. Only edit the files your step lists. If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: physical and assumption values come from config with a source comment (unit conversions like 1000 and 86400 are fine; in scenario-lab/ gate L4 lists the exact allowed literals). Sign at every file/JSON boundary: negative = ground went down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Run tests from inside mine-sim/ (or scenario-lab/). Report the exact pytest count; never say "tests pass" without it.

STEP W2 · Scenario type 2 (crack)

WP9 §5 row 2 and §6 cracks. Files: scenario-lab/config/events/crack.yaml (days_ahead input spec; nearby_radius_m, min_rate_mm_per_day, rate_window_days with sources), scenario-lab/lab/events/crack.py, scenario-lab/tests/test_crack_event.py. Tests: days_ahead = 0 → ds == 0; a huge days_ahead never makes ds exceed U (the cap); a point where the 24 h rate is 0 → not possible, reason "not moving now"; near the face at day 300 with days_ahead = 30 → possible, and consequence.evaluate reports new cracks > 0 or the "strain stays below threshold" reason with the numbers; deterministic. Walkthrough step-14-lab-crack.

When done: write walkthroughs/step-w2-crack-scenario/WALKTHROUGH.md and test_results.txt (skip if the step names its own walkthrough folder), report the exact pytest counts, then STOP and wait for review.
```

## 2 · Paste into Claude (check)

```text
Check step W2
```

Claude answers **PASS** or writes a **fix prompt** into section 4 of this file. On PASS say `commit W2`.

## 3 · You check by hand

In Window 2: day 300, x ≈ 1190, y = 0, days ahead 30 → red crack lines outside the panel edge (or a reason with numbers). Days ahead 0 → nothing changes.

## 4 · Fix prompt (only if Claude's check found problems)

None yet.
