# W5 — Scenario type 4 (blast)

**In plain words:** "What if" event: blast vibration and whether houses stay within the DGMS limit.

**Antigravity files owner:** AG-1 (one Antigravity chat for everything is fine; this only says whose files these are).

## 1 · Paste into Antigravity

New chat? Paste `steps/00-connect-antigravity.md` first and wait for `CONNECTED`.

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative inside mine-sim/), sih-26-finale-brain/RULES.md, your WP file, and the step below. For anything in scenario-lab/ or renderer/, sih-26-finale-brain/work-packages/WP9-scenario-lab.md is authoritative. Only edit the files your step lists. If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: physical and assumption values come from config with a source comment (unit conversions like 1000 and 86400 are fine; in scenario-lab/ gate L4 lists the exact allowed literals). Sign at every file/JSON boundary: negative = ground went down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Run tests from inside mine-sim/ (or scenario-lab/). Report the exact pytest count; never say "tests pass" without it.

STEP W5 · Scenario type 4 (blast)

WP9 §5 row 4 and §6 (DGMS). Files: scenario-lab/config/events/blast.yaml (charge_kg_per_delay, frequency_band input specs; K: null, b: null. First 20 minutes: look for one published USBM-form regression (K, b) from an Indian coal mine; if found, fill both with the full citation and verified: true; if not, leave them null so the event returns its "not set" reason. Never enter guessed values; min_distance_m, display_min_mm_s), scenario-lab/lab/events/blast.py, register it, scenario-lab/tests/test_blast.py. consequence.evaluate already handles PPV (T6); don't edit it. Tests (use test-only K, b injected in the test, not the yaml): PPV decreases with distance; formula checked at 3 points; null constants → not possible with the reason; doubling Q scales PPV by 2^(b/2); house over the DGMS limit for the chosen band → "over limit" sentence; ds_mm is None. Walkthrough step-17-lab-blast.

When done: write walkthroughs/step-w5-blast/WALKTHROUGH.md and test_results.txt (skip if the step names its own walkthrough folder), report the exact pytest counts, then STOP and wait for review.
```

## 2 · Paste into Claude (check)

```text
Check step W5
```

Claude answers **PASS** or writes a **fix prompt** into section 4 of this file. On PASS say `commit W5`.

## 3 · You check by hand

If the walkthrough says K and b are null, running Blast must say **"site constants not set"**. That is correct (D3), not a bug.

## 4 · Fix prompt (only if Claude's check found problems)

None yet.
