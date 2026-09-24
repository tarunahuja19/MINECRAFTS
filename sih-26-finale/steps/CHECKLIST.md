# CHECKLIST — the "Freeze + create subsidence" window, P1 → P6

**For:** Adarsh. **One page, plain words, no jargon.** Claude updates this file at the end of every
session. If this file and any other file disagree about what is done, **this file is the one to trust
about progress** (the other files are still the ones to trust about the maths).

**Last updated:** 18 Sep 2026, session 28 · **Now working on:** P3 — now **designed**, see
`~/.claude/plans/lexical-tickling-sunrise.md` (sitting C). P2 still waiting on your eye check.

**Tick meanings:** ⬜ not started · 🟡 being built right now · ✅ built and its own tests pass ·
👁️ Adarsh has looked at it with his own eyes.

---

## The big picture — six parts

The goal is one new window: **freeze a finished run at a day, pick a zone, say what happens, and see
what it does to the ground and to the village.** That is too big for one go, so it is six parts, each
on its own branch, each checked before the next starts.

| Part | In one line | What you can *see* when it lands | State |
|---|---|---|---|
| **P1** | Zones, and one crack model shared with the simulator | pick zone 1–10, print its crack numbers in the terminal | ✅ done, `3580475` |
| **P2** | Consequences: cracks as lines, houses/roads/poles graded, the crack event, the shaking layer | print "House H1: negligible → very slight" for a frozen day, in the terminal | ✅ done, this session |
| **P3** | The server the window talks to | `http://localhost:8010/api/...` answers, and the safety gates prove it changed nothing | ✅ done, this sitting |
| **P4** | **The window itself** | 👉 **the button lights up.** Pick a zone, run it, see before / after / difference | 🟡 next |
| **P5** | The schemas pinned down | the shape of every message is frozen so the teammates can build against it | ⬜ **designed** — sitting A |
| **P6** | Front end + back end wired end to end | the whole thing works from click to picture | ⬜ **designed** — sittings B–E |

**P4 is the demo milestone.** P1–P3 are the things that have to be true underneath it for the picture
not to be a lie.

---

## P1 — zones and the crack bridge ✅ (branch `feat/p1-zones-and-crack-bridge`, commit `3580475`)

| # | What it is | In plain words | State |
|---|---|---|---|
| 1.1 | `config/zones.yaml` + `lab/zones.py` | zones 1–10 along the panel, plus "full district" | ✅ |
| 1.2 | zone = soft edge, not a rectangle | **the flag** — a hard rectangle would have drawn fake cracks around whatever zone you picked (18× the real stretch). Now measured at the true value | ✅ |
| 1.3 | `strain_xy` + `principal_from_fields` | the lab can now work out which *direction* the ground is being pulled, from a surface — which is what gives a crack its bearing | ✅ |
| 1.4 | `lab/cracks.py` | the lab **borrows** the simulator's crack maths instead of keeping its own second copy | ✅ |
| 1.5 | Gate L8 (10 checks) | the two halves are compared against each other, and they agree to 0.58% | ✅ |
| 1.6 | `show_zone` tool | prints a zone's crack numbers so you can read them yourself | ✅ |
| 1.7 | Adarsh looks at it | `python3.11 -m lab.tools.show_zone --run ../mine-sim/out/v2-690d --day 300 --zone 5` | ⬜ 👁️ |

**Numbers when it landed:** scenario-lab 70 passed (was 42) · mine-sim untouched · vault PERFECT.

---

## P2 — consequences and events ✅ (branch `feat/p2-consequence-and-events`)

*What P2 is for: P1 can say "this ground is stretched." P2 says* **"…so this house cracks, this road
opens 40 mm, and the crack runs this way."**

| # | What it is | In plain words | State |
|---|---|---|---|
| 2.1 | `config/objects.yaml` | the example village: 8 houses, 2 roads, 8 poles, 1 tower. Labelled **illustrative, not the real Adriyala surface** | ✅ |
| 2.2 | `lab/objects.py` | put those objects on the map, and refuse (not quietly move) one that falls off the grid | ✅ |
| 2.3 | `lab/consequence.py` | the one place that turns "the ground moved like this" into "this is what it did" | ✅ |
| 2.4 | cracks as **line segments** | as you asked — not coloured squares. Each crack is a line with a compass bearing, set by the direction the ground is pulled | ✅ |
| 2.5 | `lab/vibration.py` | the shaking layer, from roof caving (our own face advance drives it). **No blast** — you deferred that | ✅ |
| 2.6 | the crack event | "what if the ground keeps moving N more days" — capped by what the ground actually has left to sink | ✅ |
| 2.7 | crack baseline read in | cracks **latch**: once open they stay. So "new crack" only means anything against the run's real history, not one instant | ✅ |
| 2.8 | **S7** — `export_cracks.py` wired into the rebuild | today a full rebuild deletes the crack history and never recreates it. This fixes that | ✅ |
| 2.9 | Gate L8 extended | the null check: "change nothing" must give exactly the simulator's own answer, cell for cell | ✅ |
| 2.10 | Adarsh looks at it | `python3.11 -m lab.tools.what_if --run ../mine-sim/out/v2-690d --day 172 --zone 3 --param days_ahead=60` — and §7 of [the walkthrough](../walkthroughs/step-p2-consequences/WALKTHROUGH.md) | ⬜ 👁️ |

---

## P3 — the lab server ✅ (branch `feat/p3-lab-server`)

| # | What it is | In plain words | State |
|---|---|---|---|
| 3.1 | `lab/server.py` + `lab/store.py` | the thing the window talks to; every answer saved so it can be re-opened | ✅ |
| 3.2 | `/api/events` built from the yaml files | so adding a new event type later does **not** mean touching the page | ✅ |
| 3.3 | Gate **L1** | hash every file of the run before and after — proves a scenario **cannot** change the real run. This is the gate that makes the whole feature allowed to exist | ✅ |
| 3.4 | Gates L2, L3, L7 | same question twice → same answer · the lab talks to no network and writes nowhere else · every result is stamped **SCENARIO (HYPOTHETICAL)** | ✅ |

---

## P4 — the window ⬜ (branch `feat/p4-window-2`) 👉 **this is the one you are waiting for**

| # | What it is | In plain words | State |
|---|---|---|---|
| 4.1 | a **separate** page | your call (D-S5). Window 1 is not touched | ⬜ |
| 4.2 | the button stops being greyed out | "Freeze + create subsidence" works | ⬜ |
| 4.3 | pick zone → pick event → run | no hunting for a pixel | ⬜ |
| 4.4 | before / after / difference toggle | see exactly what changed and nothing else | ⬜ |
| 4.5 | the banner that never goes away | `SCENARIO (HYPOTHETICAL) · frozen at day T · not sent to backend or ML` | ⬜ |
| 4.6 | same ground as Window 1 | it reuses Window 1's terrain code, so the mine cannot look like two different mines | ⬜ |

---

## P5 / P6 — designed 18 Sep (session 28), built with Adarsh from 19 Sep ⬜

Full design, with evidence for every claim: **`~/.claude/plans/lexical-tickling-sunrise.md`**.
The other repo is not a bare frontend — it is a complete running system whose Python engine ours
replaces. Treated as a reference, not a source of truth: the frontend/backend team owns their side.

**The one rule everything hangs off — three kinds of data, and they never mix.** What the sensors
*measured* can go to the backend and can raise an alarm. What a *what-if* says, and what the *ML
predicts*, are labelled guesses: they never enter the measurement tables and can never raise an alarm.

**Good news first:** the mine is already cut into 10 segments of 250 m in *both* the viewer and the
lab, independently, and the viewer already accepts `?seg=3&day=172`. So one number, 1–10, is the whole
selection contract, and the "3D view" button already has a working target.

| # | Sitting | In plain words | State |
|---|---|---|---|
| A | the contract, written down | one frozen file so future sessions get this right unprompted | ⬜ |
| B | the sign-flipper + the map-maker | inside, "sank" is positive; outside it is negative — nothing flips it yet. And their map points the mine the wrong way | ⬜ |
| C | the server (P3) | the thing the window talks to, on port 8010 — plus the four safety tests that prove a what-if **cannot change the real run** | ✅ |
| D | Postgres + the live feed | one run is 5.4 M rows, so two tables: a full one to calculate on, a daily one (226 k) for the map | ⬜ |
| E | Window 2 (P4) + the ML slot | the button lights up, and the forecast runs through the *same* maths as a what-if | ⬜ |

**Five things that would have broken silently** (all measured, all in the plan): the mine drawn
rotated 90°; their freehand selection reporting ±150 m every time; port 8000 already taken by their
dashboard's health poll; their database quietly rejecting 83 of our 410 nodes while loading 327; and
every scenario number arriving with the wrong sign.

---

## Decisions you already made (session 26) — nothing here is waiting on you

| Decision | Your answer | What it settled |
|---|---|---|
| D-S1 — one crack model or two? | *"the maths and simulation, it's on you"* → **one** | the lab borrows the simulator's. No second copy |
| D-S3 — which damage scale? | **NCB** (negligible → very severe) | one scale on screen, not two |
| D-S4 — blast constants | **deferred** — *"blast keep it for afterwards"* | no blast event in P1–P4 |
| D-S5 — where does it live? | **a new, separate window** | Window 1 untouched |
| zones | *"first select the zone with 1 to 10 or full"* | zones exist at all |
| geometry | *"radius for subsidence, line for crack and vibration"* | cracks are line segments, not squares |

## Decisions still open (not blocking anything below P4)

| # | Question | Bites at |
|---|---|---|
| D-S2 | do the crack/shaking columns get appended to `out/nodes.csv`, or stay in their own file? | only if Part 2 (the teammates' side) asks for them |
| D-S4 | blast constants K and b — use the unverified 800 / 1.5 with a visible warning, or refuse until someone finds the circular? | whenever you want blast in the demo |

---

## How to check any of it yourself

```bash
# the ground, the cracks, the tests
cd mine-sim && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m pytest -q
cd scenario-lab && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m pytest -q
python3 sync_vault.py --check        # must say 0 broken / 0 orphans / 0 frontmatter
```

**Latest numbers:** mine-sim **198 passed, 1 skipped** · scenario-lab **125 passed** · renderer **19 passed** · vault **PERFECT**.

**Related:** [S0 — the whole plan](S0-terrain-events-plan.md) · [P1](P1-zones-and-crack-bridge.md) · [P2](P2-consequence-and-events.md) ·
[STATUS](STATUS.md) · [WHATS-LEFT](../WHATS-LEFT.md)
