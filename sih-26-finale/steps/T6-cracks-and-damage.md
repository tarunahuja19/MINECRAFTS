# T6 — Cracks + objects + damage limits (after T2 passes)

**In plain words:** Works out cracks in the ground and damage grades for houses, roads and poles, using published limits.

**Antigravity files owner:** AG-2 (one Antigravity chat for everything is fine; this only says whose files these are).

⚠️ **Don't paste yet:** the expected grades (H1 = III, H2 = II, H5 = I) were worked out before the 14 Sep refit. Claude rechecks them first.

## 1 · Paste into Antigravity

New chat? Paste `steps/00-connect-antigravity.md` first and wait for `CONNECTED`.

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative inside mine-sim/), sih-26-finale-brain/RULES.md, your WP file, and the step below. For anything in scenario-lab/ or renderer/, sih-26-finale-brain/work-packages/WP9-scenario-lab.md is authoritative. Only edit the files your step lists. If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: physical and assumption values come from config with a source comment (unit conversions like 1000 and 86400 are fine; in scenario-lab/ gate L4 lists the exact allowed literals). Sign at every file/JSON boundary: negative = ground went down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Run tests from inside mine-sim/ (or scenario-lab/). Report the exact pytest count; never say "tests pass" without it.

STEP T6 · Cracks + objects + damage limits (after T2 passes)

WP9 §6. Files: scenario-lab/config/damage_limits.yaml, scenario-lab/config/objects.yaml, scenario-lab/lab/cracks.py, lab/objects.py, lab/consequence.py, scenario-lab/tests/test_cracks.py, tests/test_consequence.py. If T5 isn't merged, code against the WP9 §4 dataclasses with hand-built arrays. damage_limits.yaml: house grades I–IV exactly as WP9 §6 (verified flags as stated, source strings), DGMS PPV table for domestic houses (5/10/15), crack.threshold_mm_per_m: 3.0 with the WP9 §6 source and width_model_sourced: false. objects.yaml: first-batch objects exactly as WP9 §6 (H1–H8, R1, R2, P1–P8, T1) with layout: illustrative, not the real Adriyala surface. consequence.evaluate(before_s_float_mm, after_s_float_mm, grid, cfg, ppv_mm_s=None, frequency_band=None) -> dict (when ppv_mm_s is given, each house also gets the DGMS check for frequency_band) returns the cracks, objects and summary parts of the WP9 §7 JSON (negative-down numbers), with one plain sentence per object. Tests: grade boundaries at exactly 2.0 / 3.0 / 0.2 and just above; worst-of-three rule; pole lean = tilt × height; road crack found only within search distance; objects outside the grid → error; identical before/after → no new cracks and grades unchanged; on the float day-300 surface H1 = III, H2 = II, H5 = I (values checked by Claude on 14 Sep); an object in a masked cell → "No forecast covers this object"; a PPV array above the DGMS limit gives the "over limit" sentence. Walkthrough step-11-lab-consequence.

When done: write walkthroughs/step-t6-cracks-and-damage/WALKTHROUGH.md and test_results.txt (skip if the step names its own walkthrough folder), report the exact pytest counts, then STOP and wait for review.
```

## 2 · Paste into Claude (check)

```text
Check step T6
```

Claude answers **PASS** or writes a **fix prompt** into section 4 of this file. On PASS say `commit T6`.

## 3 · You check by hand

Nothing to click yet. Claude's check covers it.

## 4 · Fix prompt (only if Claude's check found problems)

None yet.
