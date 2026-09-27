# Scripted demo runbook

One fixed year of mine life that plays the same way every time: four events on known days, the same alarms on cue. Run it through the live pipeline (engine → MQTT/DB → backend → dashboard), then open FORGE mid-run to ask "what if?".

## 1. Start the stack

```
npm start          # broker, backend :8080, tiles :8085, engine :8000, Vite :5173, FORGE math :8020, Electron
```

The demo needs the engine on :8000 to be recent enough to have `POST /script/run`. If `npm run demo:scripted` says it has no `/script/run`, stop everything and run `npm start` again. Postgres must be up (`psql` on the PATH: the demo clears the database first).

## 2. Play the script

```
npm run demo:scripted                  # about 4 minutes for the 365 days
npm run demo:scripted -- --speed 0.5   # slower: 0.5 scripted days per second (12 min)
```

`--speed` is scripted days per wall second. The engine manages about 1.5 d/s flat out (a tick is 1 sim hour, 3–30 ms), so larger values just run at that ceiling.

What it does: clears readings, packets and alarms (the script's clock is fixed, so old rows would collide with the new ones and be dropped), resets the engine, loads `default_demo`, sets the speed, starts, and prints a timeline from the backend WebSocket. It exits when the year is over, or on Ctrl-C (which also stops the engine).

Same script, same numbers: `python -m sandbox.runner --script default_demo --out out/scripted/default_demo` (run in `simulation/`) writes `nodes.csv` and `events.csv` without any of the stack, byte-identical on every run.

## 3. What the judges should see, day by day

The clock starts at 2026-01-01 (day 0). The ground-truth bowl grows north from day 0 as the longwall face advances 5 m/day, so the SIM tab's terrain sags slowly all year.

| Day | Event | Live dashboard (SIM, MAP, ALARMS) | Timeline line |
|---|---|---|---|
| 0–59 | none | All 31 nodes green. Bowl growing. Zero alarms: ordinary settlement never reddens a node. | — |
| 60 | **Crack**, 188 m, 0.4 m throw, opens over 3 d, across the fault transect | N22 and N23 go CRITICAL the moment it starts; the crack lines open on the terrain; alarm banner and ALARMS row. Nodes return to green once the crack has finished opening (about day 63). | `day 60.0 crack → N22 CRITICAL, N23 CRITICAL` |
| 120 | **Tilt**, 5 mm/m toward the east, over 10 d, at (145, 0) | No pit, no dust. As the tilt develops, N06 (day 123.2), N24 (123.5) and N17 (123.8) go WARNING. | `day 123.2 tilt → N06 WARNING` … |
| 150 | **Vibration**, 45 mm/s for 60 s | A one-tick spike on every node's vibration channel. No node changes state. | — |
| 200 | **Cave-in**, 6 m deep, R 35 m, at (-200, 120) on the north-west rib | Hot-coloured pit with dust and shake; N11 CRITICAL at once. | `day 200.0 cave_in → N11 CRITICAL` |
| 201–365 | none | Quiet; the pit stays in the terrain, alarms stay in the history. | — |

The timeline also prints zone alarms (`zone Z.. WARNING`) that arrive with each event. The live engine only colours a node while the event is in progress; FORGE (below) keeps the damage on the board, so FORGE shows more coloured nodes than the live view.

## 4. Open FORGE mid-run

FORGE is an isolated sandbox on :8020. It reads the live run but never writes to it.

1. Click the **FORGE** tab any time after day 60. It seeds itself from the live engine: the FORGE day is the live day, and the events already fired appear in the event list marked `(live)`. The scripted crack shows as one crack, the tilt as one tilt. Press **↺ LIVE DAY** to re-seed.
2. Fire something of your own. Pick **CAVE-IN**, **CRACK**, **TILT** or **VIBRATION**, set the sliders, then either click the 3D terrain (or the mini map) for the target, or, for a crack, press **DRAW CRACK** and click two points. **FIRE**, then **PLAY** the FORGE timeline.
3. What to look at:
   - **3D view**: a white ring at 1.2 R and a red ring at 1.5 R around every cave-in and crack, hot colours where the ground has dropped, crack lines lying on the deformed ground.
   - **Health strip** (right column): node dots and counts coloured by the same rule as the rings: inside the white ring CRITICAL, inside the red ring WARNING, outside it only the event's own strain or tilt can make a node WARNING. Only a TILT event can turn a node CRITICAL by its tilt alone (10 mm/m).
   - **Mini map**: the MAP tab's satellite tiles with the same node icons, the zones and the crack lines.
4. Nothing FORGE does touches the live run: the live speed, the intervention list and the alarm count stay as they were (`node scripts/qa.js --scripted` checks this).

## 5. Troubleshooting

- *Every alarm missing after a re-run*: the database was not cleared. `npm run db:reset`, then run the demo again.
- *`409` from `/script/run`*: the engine is running. The demo resets it first; if you call the endpoint by hand, `POST :8000/control {"action":"reset"}` before it.
- *Speed stuck at 10x*: only unscripted runs drop to 10x when a zone goes CRITICAL. A scripted run keeps the speed you set.
