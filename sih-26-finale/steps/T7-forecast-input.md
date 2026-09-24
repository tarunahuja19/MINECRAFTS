# T7 — Forecast input pipe (after T3 finishes)

**In plain words:** Reads the ML teammate's forecast file and checks it follows the agreed format; makes a clearly-labelled test file until the real one arrives.

**Antigravity files owner:** AG-3 (one Antigravity chat for everything is fine; this only says whose files these are).

## 1 · Paste into Antigravity

New chat? Paste `steps/00-connect-antigravity.md` first and wait for `CONNECTED`.

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative inside mine-sim/), sih-26-finale-brain/RULES.md, your WP file, and the step below. For anything in scenario-lab/ or renderer/, sih-26-finale-brain/work-packages/WP9-scenario-lab.md is authoritative. Only edit the files your step lists. If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: physical and assumption values come from config with a source comment (unit conversions like 1000 and 86400 are fine; in scenario-lab/ gate L4 lists the exact allowed literals). Sign at every file/JSON boundary: negative = ground went down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Run tests from inside mine-sim/ (or scenario-lab/). Report the exact pytest count; never say "tests pass" without it.

STEP T7 · Forecast input pipe (after T3 finishes)

WP9 §7 (Forecast input, Spread) and sih-26-finale-brain/docs/interface-ml-to-renderer.md §2b. Files: scenario-lab/lab/forecast.py, lab/spread.py, lab/tools/__init__.py, lab/tools/make_test_forecast.py, scenario-lab/fixtures/, scenario-lab/tests/test_forecast.py, tests/test_spread.py, tests/gates/test_l6.py. forecast.load_forecast(path, run_dir) -> ForecastNodes validates every §2b rule and raises ContractViolation-style ValueErrors with plain messages. make_test_forecast --run DIR --issued-day D --out FILE: p50 = the run's true cumulative subsidence at each Scout at +24 h / +72 h (terrain replay at the node position); p10/p90 = p50 ∓ band, band = test_forecast_band_fraction · |p50 − current| + test_forecast_band_min_mm; model_id: "TEST-FIXTURE-simulator-truth-not-ML". spread.spread(forecast, snapshot, horizon, pct) -> (after_s_mm, mask) per WP9 §7. Tests: L6 negative cases (5); the test fixture validates; spread equals Δ at an isolated node; far cells masked. Commit fixtures/test_forecast_day300.json made from out/v2-690d (or the longest run). Walkthrough step-12-lab-forecast-input.

When done: write walkthroughs/step-t7-forecast-input/WALKTHROUGH.md and test_results.txt (skip if the step names its own walkthrough folder), report the exact pytest counts, then STOP and wait for review.
```

## 2 · Paste into Claude (check)

```text
Check step T7
```

Claude answers **PASS** or writes a **fix prompt** into section 4 of this file. On PASS say `commit T7`.

## 3 · You check by hand

Nothing to click yet. Claude's check covers it.

## 4 · Fix prompt (only if Claude's check found problems)

None yet.
