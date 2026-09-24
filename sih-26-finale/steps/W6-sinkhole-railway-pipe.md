# W6 — Scenario type 5 (sinkhole) + railway + pipe

**In plain words:** "What if" event: a sinkhole; adds railway and pipe to the objects.

**Antigravity files owner:** AG-2 (one Antigravity chat for everything is fine; this only says whose files these are).

## 1 · Paste into Antigravity

New chat? Paste `steps/00-connect-antigravity.md` first and wait for `CONNECTED`.

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative inside mine-sim/), sih-26-finale-brain/RULES.md, your WP file, and the step below. For anything in scenario-lab/ or renderer/, sih-26-finale-brain/work-packages/WP9-scenario-lab.md is authoritative. Only edit the files your step lists. If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: physical and assumption values come from config with a source comment (unit conversions like 1000 and 86400 are fine; in scenario-lab/ gate L4 lists the exact allowed literals). Sign at every file/JSON boundary: negative = ground went down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Run tests from inside mine-sim/ (or scenario-lab/). Report the exact pytest count; never say "tests pass" without it.

STEP W6 · Scenario type 5 (sinkhole) + railway + pipe

WP9 §5 row 5 and §6 (railway, pipe, RL1, PP1). Files: scenario-lab/config/events/sinkhole.yaml (all five inputs with defaults/ranges and source: "scenario input — typical Indian bord & pillar, not this mine"; indian_max_cover_ratio with the ResearchGate source), scenario-lab/lab/events/sinkhole.py, register it, scenario-lab/config/objects.yaml (add RL1, PP1), lab/objects.py + lab/consequence.py (railway and pipe metrics), scenario-lab/tests/test_sinkhole.py, tests/test_consequence.py (extend). Tests: k = 1.5, m_g = 3, h_c = 10 → not possible, reason gives H = 6 m and includes the erosion note (10 ≤ 35 × 3); h_c = 120 → not possible and no erosion note; h_c = 5 → depth 500 mm at the click and the reason says "upper bound"; railway Δs over the base; pipe strain projection at α = 0 equals εx and at α = 90° equals εy. Walkthrough step-18-lab-sinkhole.

When done: write walkthroughs/step-w6-sinkhole-railway-pipe/WALKTHROUGH.md and test_results.txt (skip if the step names its own walkthrough folder), report the exact pytest counts, then STOP and wait for review.
```

## 2 · Paste into Claude (check)

```text
Check step W6
```

Claude answers **PASS** or writes a **fix prompt** into section 4 of this file. On PASS say `commit W6`.

## 3 · You check by hand

Sinkhole with defaults: reason shows H in metres; a depth result says **"upper bound"**. Railway and pipe are drawn and each gets a sentence.

## 4 · Fix prompt (only if Claude's check found problems)

None yet.
