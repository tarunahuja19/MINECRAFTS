# W8 — Forecast view

**In plain words:** The forecast page: ML prediction drawn on the ground, always with its range and a FORECAST label.

**Antigravity files owner:** AG-4 (one Antigravity chat for everything is fine; this only says whose files these are).

## 1 · Paste into Antigravity

New chat? Paste `steps/00-connect-antigravity.md` first and wait for `CONNECTED`.

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative inside mine-sim/), sih-26-finale-brain/RULES.md, your WP file, and the step below. For anything in scenario-lab/ or renderer/, sih-26-finale-brain/work-packages/WP9-scenario-lab.md is authoritative. Only edit the files your step lists. If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: physical and assumption values come from config with a source comment (unit conversions like 1000 and 86400 are fine; in scenario-lab/ gate L4 lists the exact allowed literals). Sign at every file/JSON boundary: negative = ground went down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Run tests from inside mine-sim/ (or scenario-lab/). Report the exact pytest count; never say "tests pass" without it.

STEP W8 · Forecast view

WP9 §9 (Forecast row). Files: renderer/forecast.html, renderer/js/forecast.js, renderer/tests/test_pages.py (extend). File picker from /api/forecasts + upload; FORECAST banner; a red TEST INPUT banner when test_input; issued day and horizon always visible; 24/72 h switch; p10/p50/p90 switch (default p50) and a "range" view showing p10 and p90 side by side; masked cells hatched grey with "no prediction here"; objects + plain sentences; node markers. A link from Window 1. Screenshots into walkthroughs/step-20-forecast-view/.

When done: write walkthroughs/step-w8-forecast-page/WALKTHROUGH.md and test_results.txt (skip if the step names its own walkthrough folder), report the exact pytest counts, then STOP and wait for review.
```

## 2 · Paste into Claude (check)

```text
Check step W8
```

Claude answers **PASS** or writes a **fix prompt** into section 4 of this file. On PASS say `commit W8`.

## 3 · You check by hand

From Window 1 open the forecast view → pick `test_forecast_day300.json` → FORECAST banner + red TEST INPUT banner; 24 h ↔ 72 h changes the surface; p10 sinks most, p90 least; far cells grey "no prediction here".

## 4 · Fix prompt (only if Claude's check found problems)

None yet.
