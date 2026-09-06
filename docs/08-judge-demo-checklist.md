# Judge Demo Checklist — R4 Mine Subsidence System

Branch: `preview-branch`. Everything below was verified on this branch.

---

## PART 1 — Before you walk in (do this the night before)

- [ ] `git checkout preview-branch && git pull`
- [ ] `npm run checklist:audit` → must end with **"pristine demo-ready condition"**
- [ ] Confirm Postgres is running: `pg_isready`
- [ ] Confirm 31 nodes in DB (the audit checks this — it must say `31 / 31`)
- [ ] Confirm tiles cached (audit says `1343 cached map tiles`) — **you can demo with no internet**
- [ ] Charge laptop + bring charger. Disable sleep, notifications, auto-updates.
- [ ] Close Slack/Discord/email. One browser window only.

### Kill anything already running on the demo ports
```bash
for p in 1883 8080 8000 5173 8085; do lsof -ti:$p | xargs kill 2>/dev/null; done
```

### The one command that starts everything
```bash
npm start
```
Ports: **1883** MQTT broker · **8080** backend · **8000** simulation · **5173** 3D UI

### Prove the pipeline is actually alive (run this, don't assume)
```bash
node scripts/verify_data_loop.js
```
Must end with **"RESULT: data loop PROVEN end to end"**. This is your safety net —
if this passes, sim → Postgres → dashboard is genuinely working.

---

## PART 2 — Demo run order (rehearse this exact sequence 3×)

1. **Open on the MAP tab.** Let them see 31 nodes on real terrain first. Don't talk yet.
2. **Start the simulation.** Point out nodes going live — telemetry is flowing.
3. **Click one node** → Node Detail panel on the right.
   - Say: *"This is real hardware metadata from Postgres, not a mockup."*
   - Point at: sensor name, tier description, channel list, X/Y/Z + lat/lon.
4. **Let an alarm fire.** Show the bowl overlay + R² fit on the map.
5. **Open the INFO tab.** This is your credibility close — see Part 4.
6. **Close with the 3D terrain view** if time allows.

**Timing:** if you only get 5 minutes → steps 1, 3, 5. Node Detail and INFO tab
are the two things that make it look like a real product rather than a hackathon UI.

---

## PART 3 — The tech, so you never fumble a question

### The array: 31 nodes, six tiers
| Tier | Count | Role | Hardware |
|---|---|---|---|
| 1A | 9 | Baseline, flat interior bowl | MPU-6050 6-DoF IMU + vibration |
| 1B | 10 | Tension/shear band (5 West, 5 East ribs) | MPU-6050 + foil strain gauge + crackmeter |
| 1C | 6 | Fault/water corridor, 28° lineament | MPU-6050 + multipoint extensometer + moisture |
| 2A | 3 | Mesh router anchors, perimeter triangle | ADXL355 ultra-low-noise inclinometer |
| 2B | 2 | Geotech boreholes, centre subsidence axis | Vibrating-wire piezometer + borehole IPI |
| 3  | 1 | Master sink gateway | GNSS / RTK receiver |

**9+10+6+3+2+1 = 31.**

### Numbers judges may probe
- **Panel:** 250 m wide × 2500 m long
- **Radius of influence R_INFL:** ≈ 197.4 m (`H_DEPTH / tan β`)
- **Tensile limit:** 5.3 mm/m (Kamptee coalfield, Central India)
- **Tensile band:** ~57 m wide, crosses ±5.3 mm/m at x = ±177.5 m and ±232.5 m, peaks +6.06 mm/m at x = ±204 m
- **Gateway standoff:** 650 m outside the angle of draw — it *cannot* move, so any movement it reports is instrument drift. That's what makes it the reference.
- **Bundle math:** 138 B bundle ÷ 23 B packet = 6 exactly → fan-out 5 nominal, 6 hard ceiling (one slot spare for an orphan failing over)

### Why the layout is NOT a grid — expect this question
> *"A GNN trained on a grid memorises the grid."* A lattice is a degenerate input
> for a spatiotemporal model — it learns the lattice's periodicity as a shortcut
> and stops reading the physics. Placement here is deterministic and
> geology-weighted: **Tier 1B sits inside the tensile band by construction**, so
> the band is sampled because that's where 1B lives, not because a lattice
> happened to land near it.

### The 7-stage detector pipeline (INFO tab section 06)
1. Staleness Gate → 2. Quorum Gate → 3. Knothe Bowl Fit → 4. DGMS Blast Veto →
5. Machine Veto → 6. Cluster Silence → 7. Persistence Gate

**Criteria to fire:** 3 cycles OR crack latched.
**R² < 0.85 → treated as sensor noise, not ground movement.** Know this number.

### Why one event lights up so much of the map
Physics, not a bug: the panel is 250 m wide and the Knothe influence zone reaches
~197 m past *each* edge, so the trough spans ~645 m — wider than the window.

---

## PART 4 — The INFO tab (your credibility close)

Two-column SCADA reference manual, 8 sections, with a jump-link sidebar,
scroll-spy, and live search. Sections:

1. Sensor Nodes & Network Topology
2. The Seven Sensors On Each Node
3. Ground Zones & Map Overlays
4. Subsidence Basin Mechanics & Physics
5. Alarm Dispatch Matrix & Escalation
6. 7-Stage Gateway Detector Pipeline
7. 90-Day Replay Controller & Forensics
8. Status Bar LEDs & Workspace Tabs

**Demo move:** type a word into the search box (e.g. `knothe`) — sections filter
live. Then click a sidebar jump link and let it smooth-scroll. It takes 10
seconds and it reads as a finished product.

**Line to use:** *"Every overlay, threshold and LED on this dashboard is
documented in-app — an operator doesn't need us in the room."*

---

## PART 5 — If something breaks mid-demo

| Symptom | Do this |
|---|---|
| Dashboard shows no data | Check ports 8080 + 8000 are up. `node scripts/verify_data_loop.js` tells you which hop died. |
| Nodes grey / "SIMULATION: STOPPED" | Simulation isn't started — that's correct behaviour, not a bug. Start it. |
| Strain shows `--` | Correct for an idle node. It means "no reading", not an error. **Say so confidently.** |
| Map tiles blank | Cached tiles are in `dashboard_electron/tiles/`. Offline is fine; don't panic about wifi. |
| Everything wedged | `for p in 1883 8080 8000 5173; do lsof -ti:$p \| xargs kill; done` then `npm start` |
| DB looks polluted | `npm run db:reset` |

**Golden rule:** if a number looks wrong on screen, say *"that's the idle state"*
and move on. Do not debug live in front of judges.

---

## PART 6 — Honest answers to hard questions

- **"Is this real data?"** — It's a physics simulation (Knothe subsidence model)
  driving a real pipeline: real MQTT broker, real Postgres, real WebSocket
  fan-out. The *transport and storage are genuine*; the ground movement is modelled.
  Say this plainly — the pipeline being real is the strong claim.
- **"Have you deployed on a real mine?"** — No. Site is modelled on SCCL Adriyala
  longwall, Kamptee coalfield constants. Don't overclaim.
- **"What's the ML?"** — The layout is built to be a valid GNN input (see the
  no-grid argument above). The current detector is deterministic/classical —
  7-stage gated, DGMS Tech-04 aligned. **That's a strength: it's auditable.**
  Don't pretend there's a trained model in the loop if there isn't.

---

## PART 7 — Final 60 seconds before you present

- [ ] `npm start` — all 4 services up
- [ ] `node scripts/verify_data_loop.js` — says PROVEN
- [ ] Dashboard open on MAP tab, window maximised
- [ ] Simulation **stopped** (so you can start it live — it's a better beat)
- [ ] Terminal hidden
- [ ] Water. Breathe. You know this system.
