# W4 — Window 2 (scenario page) + Window 3 placeholder

**In plain words:** Window 2: the page where you freeze a day, click a spot, pick an event and see before / after / difference. Plus a Window 3 placeholder.

**Antigravity files owner:** AG-4 (one Antigravity chat for everything is fine; this only says whose files these are).

## 1 · Paste into Antigravity

New chat? Paste `steps/00-connect-antigravity.md` first and wait for `CONNECTED`.

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative inside mine-sim/), sih-26-finale-brain/RULES.md, your WP file, and the step below. For anything in scenario-lab/ or renderer/, sih-26-finale-brain/work-packages/WP9-scenario-lab.md is authoritative. Only edit the files your step lists. If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: physical and assumption values come from config with a source comment (unit conversions like 1000 and 86400 are fine; in scenario-lab/ gate L4 lists the exact allowed literals). Sign at every file/JSON boundary: negative = ground went down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Run tests from inside mine-sim/ (or scenario-lab/). Report the exact pytest count; never say "tests pass" without it.

STEP W4 · Window 2 (scenario page) + Window 3 placeholder

WP9 §7 (JSON), §9 (Windows 2 and 3). Files: renderer/scenario.html, renderer/js/scenario.js, renderer/after.html, renderer/tests/test_pages.py, renderer/fixtures/scenario_example.json (hand-written from WP9 §7 so you aren't blocked on W3). Reuse js/terrain.js. Page: SCENARIO banner "SCENARIO (HYPOTHETICAL) · frozen at day T · not sent to backend or ML", always visible; frozen surface from /api/snapshot?day=T; objects drawn (house = box, road/railway/pipe = line, pole = cylinder); click → marker + x, y + current subsidence; form built from /api/events; Run → POST /api/scenario; Before / After / Difference toggle; tilt and strain colour layers with legends and units; cracks as short red segments; PPV layer when present; objects coloured by grade (I green → IV red, "no limit" grey) + the plain sentences list; summary box on top; when possible is false, the reason appears in large text and the surface doesn't change; saved scenarios list from /api/scenarios. after.html: banner + "Window 3 — sensor data after the event — planned for v3" + a link back. test_pages.py: banner strings present in every page; JS fetches only /api/... paths; no element changes Window 1. Screenshots into walkthroughs/step-16-window2/: before, after sudden sinking, a not-possible case, a crack case.

When done: write walkthroughs/step-w4-scenario-page/WALKTHROUGH.md and test_results.txt (skip if the step names its own walkthrough folder), report the exact pytest counts, then STOP and wait for review.
```

## 2 · Paste into Claude (check)

```text
Check step W4
```

Claude answers **PASS** or writes a **fix prompt** into section 4 of this file. On PASS say `commit W4`.

## 3 · You check by hand

Start the lab server (command in W3's walkthrough), open it, slider to day 300 → **Freeze + create subsidence** → banner "SCENARIO (HYPOTHETICAL) · frozen at day 300 · not sent to backend or ML". Houses, roads, poles drawn; every house shows a grade and a sentence; Before / After / Difference buttons toggle.

## 4 · Fix prompt (only if Claude's check found problems)

None yet.
