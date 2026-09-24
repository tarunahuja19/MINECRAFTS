# T5 — Scenario Lab skeleton (after T1 passes)

> **BUILT by Claude, 17 Sep (session 22)** — not pasted into Antigravity. Adarsh asked why the "Freeze + create subsidence" button does nothing; this is the base under it. Results and verification in [`walkthroughs/step-t5-w1-scenario-lab/WALKTHROUGH.md`](../walkthroughs/step-t5-w1-scenario-lab/WALKTHROUGH.md). Built ahead of T1, which it nominally waits on.

**In plain words:** The base of the Scenario Lab: freeze the ground at any day so we can try "what if" events on a copy (never on the real run).

**Antigravity files owner:** AG-1 (one Antigravity chat for everything is fine; this only says whose files these are).

## 1 · Paste into Antigravity

New chat? Paste `steps/00-connect-antigravity.md` first and wait for `CONNECTED`.

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative inside mine-sim/), sih-26-finale-brain/RULES.md, your WP file, and the step below. For anything in scenario-lab/ or renderer/, sih-26-finale-brain/work-packages/WP9-scenario-lab.md is authoritative. Only edit the files your step lists. If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: physical and assumption values come from config with a source comment (unit conversions like 1000 and 86400 are fine; in scenario-lab/ gate L4 lists the exact allowed literals). Sign at every file/JSON boundary: negative = ground went down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Run tests from inside mine-sim/ (or scenario-lab/). Report the exact pytest count; never say "tests pass" without it.

STEP T5 · Scenario Lab skeleton (after T1 passes)

WP9 §2–§4, §8 (L4, L5). Files: scenario-lab/pyproject.toml, scenario-lab/config/lab.yaml, scenario-lab/lab/__init__.py, lab/config.py, lab/snapshot.py, lab/fields.py, lab/events/__init__.py, lab/events/base.py, scenario-lab/tests/test_snapshot.py, tests/test_fields.py, tests/gates/test_l4.py, tests/gates/test_l5.py, scenario-lab/.gitignore (ignore store/). Install with pip install -e scenario-lab. lab.yaml keys (each with a source: comment): settled_time_coefficient_per_day, min_effect_mm, world_model_tolerance_mm, display_cell_m, spread_min_weight, store_dir, port, id_hash_chars, test_forecast_band_fraction, test_forecast_band_min_mm. Implement Grid, Snapshot, load_snapshot, Fields, derive_fields, EventResult and an empty EVENTS registry exactly as WP9 §4 with the §3 conventions. load_snapshot replays npz + jsonl up to epoch = round(day · 86400 / timestep_s) and must array_equal the WP3 replay; it also fills s_model_mm from physics.subsidence and checks it against s_mm (WP9 §3 derivatives rule: fields never come from the int grid). Tests: snapshot equality on out/v2-690d (or an 80-day run made in the test; a 2-day run has no subsidence); s_model_mm within tolerance of s_mm; day beyond run → ValueError; L4 literal scan; L5 as written in WP9 §8 (float grid, int array → TypeError). Walkthrough walkthroughs/step-10-lab-skeleton/.

When done: write walkthroughs/step-t5-scenario-lab-base/WALKTHROUGH.md and test_results.txt (skip if the step names its own walkthrough folder), report the exact pytest counts, then STOP and wait for review.
```

## 2 · Paste into Claude (check)

```text
Check step T5
```

Claude answers **PASS** or writes a **fix prompt** into section 4 of this file. On PASS say `commit T5`.

## 3 · You check by hand

After it is committed:
```bash
/opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m pip install -e scenario-lab
/opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -c "import lab; print('lab ok')"
```
**You should see:** `lab ok`.

## 4 · Fix prompt (only if Claude's check found problems)

None yet.
