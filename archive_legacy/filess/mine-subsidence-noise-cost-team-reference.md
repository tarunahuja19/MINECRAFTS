# Mine Subsidence Monitoring — Noise, Cost, Build & Feasibility Master Reference

---

## 1. Deployment Model — Read This First

The PS text (from the clause-by-clause mapping) specifies: **"localized wireless surface mesh sensor network deployed above underground mine panels."** That means nodes sit on the surface — above ground, above the workings — not inside the tunnels. That's the default assumed everywhere below.

**If nodes stay on the surface** (recommended, matches the PS as written):
- Sun exposure is real, thermal drift is real, the fix (temperature compensation + neighbourhood-median differencing) stands as designed.
- Standard consumer electronics (ESP32, no special certification) are legally fine to deploy — you're in open air, not a gassy underground atmosphere.

**If some/all nodes move underground** (into the galleries, near active panels):
- **No solar cycling — correct, that part changes.** But thermal drift doesn't disappear, it changes *cause*: underground ambient temperature rises with depth (geothermal gradient, roughly 1°C per ~30–40 m of depth in Indian coalfields), plus heat from machinery (conveyors, cutters, ventilation fans) and generally poor airflow in dead-end headings. The MPU9250's temperature coefficient doesn't care *why* it's hot — the same compensation fix still applies, just against a different, slower, machinery-and-depth-driven curve instead of a 24-hour solar one.
- **The serious new problem: explosion-proofing.** Indian coal mines are frequently gassy (methane). DGMS regulations require electrical equipment used underground in such mines to be intrinsically safe (IS) or flameproof (Ex-rated) certified. A standard ESP32 dev board is **not** certified for this — deploying it in an active gassy underground panel would not be legally permitted, independent of how good the sensing logic is. This is a hard regulatory wall, not a design nuance.
- **Recommendation:** keep the hackathon build and demo scoped to the surface deployment exactly as the PS specifies. If you want an underground component in the pitch, frame it explicitly as a **Phase 2 / production consideration**, scoped to non-gassy (degree-I) mines or already-ventilated travelling roadways, using certified IS/flameproof enclosures — and say plainly that this adds cost and certification time you're not claiming to have solved now. Naming the constraint openly is a stronger answer than an unscoped claim a judge can puncture in one question.

Everything below is written for the surface deployment. Underground-specific items are called out separately in Section 2 and Section 4, in case you want that Phase 2 slide.

---

## 2. Complete Noise & Issue Register

### A. Sensor / electrical noise (present regardless of surface or underground)

| Source | Cause | Countermeasure |
|---|---|---|
| Thermal drift (tilt) | Sensor's internal mechanical element expands/contracts with temperature | On-chip temp sensor + correction formula; neighbourhood-median differencing across nearby nodes |
| Sensor self-noise (random jitter) | Inherent electronic noise in any MEMS chip, even sitting still | Time-averaging (10 Hz sampling, 10-min average → ~77× noise reduction) |
| Battery voltage sag | Reading is measured relative to supply voltage; weak battery shifts the reference | Dedicated voltage regulator chip feeding the ADC reference (~₹20–50) |
| ESP32 internal ADC nonlinearity | Built-in ADC not designed for precision measurement, worse near range edges | External precision ADC (ADS1115, 16-bit, ~₹150) for the strain-gauge line |
| Digital noise coupling into analog readings | Processor's digital switching leaks into nearby analog circuitry | Separate, filtered power rail for the analog sensing section |
| Electrical interference (EMI) from mine wiring/motors | Nearby power cables/motors radiate noise into sensor wiring | Twisted-pair signal wires, shielded cable, physical separation from power lines; Wheatstone bridge wiring for strain gauge (cancels common-mode noise at the sensor itself) |

### B. Environmental noise (surface-specific unless noted)

| Source | Cause | Countermeasure |
|---|---|---|
| Diurnal solar heating | Direct sun on surface-mounted enclosure | Covered above (temp comp + differencing) |
| Rain / humidity | Resistive elements drift slightly with moisture | Conformal waterproof coating; periodic re-zero against the mine's existing total-station survey |
| Monsoon ground saturation | Shifts the ground's own baseline, not just the sensor | Scheduled baseline recalibration windows (concept-drift handling) |
| Dust ingress (surface: wind-blown; underground: coal dust) | Clogs vents, degrades contacts over time | Sealed IP65/67-rated enclosure |

### C. Event/vehicle noise

| Source | Cause | Countermeasure |
|---|---|---|
| Scheduled blasts | Deliberate large vibration | Correlate against DGMS-mandated seismograph logs (already legally recorded) — suppress at logged timestamps |
| Haul truck / vehicle traffic | Localized ground shake near roads | Spatial coherence test already filters this — a truck shakes 1–2 nodes, real subsidence shakes many in a bowl shape. No extra fix needed |
| Conveyor / drill motor hum | Continuous, fixed-frequency vibration from steady-speed machinery | Notch filter tuned to the machine's known RPM/frequency |
| Physical knock (animal, worker, falling debris) | Sharp transient that reverts within seconds | Outlier rejection — discard spikes that bounce back to baseline immediately |

### D. Network / physical robustness

| Source | Cause | Countermeasure |
|---|---|---|
| Single node destroyed | Localized ground failure | Mesh reroutes through surviving neighbours; node death treated as positive evidence, not just data loss |
| **Correlated multi-node destruction near the epicentre** | Subsidence damages a spatial cluster of nodes together, not independently | Reference anchors placed outside the predicted trough (using angle-of-draw geometry); expanding-ring differencing (fall back to 2nd/3rd ring if 1st ring is dead); degraded-confidence mode instead of silence |
| Alarm storm | Many nodes go critical simultaneously, congesting the shared LoRa channel right when it matters most | Priority queuing / staggered backoff, validated in ns-3 or FLoRa simulation (or by-hand duty-cycle math if time-short) |
| Node about to be destroyed | No warning captured before total loss | Last-gasp transmission: accelerometer detects a sudden free-fall/impact signature and fires one final reading + a "destroyed" flag before going silent |

### E. Underground-specific (only relevant if Phase 2 underground scope is pursued)

| Source | Cause | Countermeasure |
|---|---|---|
| Explosion-proofing requirement | DGMS mandates IS/flameproof-certified electronics in gassy underground atmospheres | Scope to non-gassy sections, or budget certified enclosures (Section 4) — not solvable with a standard ESP32 dev board |
| RF range collapse | Rock/coal severely attenuates LoRa compared to open air; tunnels don't behave like open terrain | Much closer node spacing along the roadway axis, or a leaky-feeder cable backbone (standard in real underground mine comms) instead of open flood-routing |
| No GPS underground | Satellite signal doesn't penetrate rock | Use fixed, pre-surveyed coordinates entered at install time (the mine already has surveyed panel maps) instead of a live GPS chip |
| Closer blast proximity | Underground nodes sit much nearer active faces than surface nodes sit from surface blasts | Separate near-field vibration threshold — the DGMS surface PPV limit (5 mm/s) isn't the right reference for underground sensor survival |
| Water seepage / dripping | Common in active underground galleries | Same waterproof treatment as humidity, rated to a higher IP standard (IP67) |

---

## 3. How We Actually Separate Signal From Noise — the Pipeline

Four stages, in order. Build and test each on synthetic data (Section 5, Phase 0) before it ever touches real hardware.

1. **Hardware conditioning (fixes noise before it's even digitized).** Wheatstone bridge for the strain gauge, external precision ADC, shielded/twisted wiring, separated analog power rail, voltage regulator. This layer is free — it's wiring and component choice, not code — and it removes several noise sources entirely rather than filtering them out later.

2. **Per-node digital signal processing.** Median filter kills single-sample spikes. Temperature-compensation formula corrects drift using the sensor's own built-in thermometer. Notch filter mutes any known fixed-frequency machinery hum. FFT band-splitting on the vibration channel separates rock micro-fracture (broadband, irregular) from blast (sharp, logged) from traffic/machinery (narrowband, steady).

3. **Feature extraction (forced by the radio, and it helps you for free).** LoRa's tiny payload (51–222 bytes under 1% duty cycle) makes raw waveform transmission physically impossible, so each node sends RMS/peak/FFT-bin summary features instead. That constraint happens to be a noise filter in its own right — a windowed feature is inherently more robust to single-sample noise than the raw signal.

4. **Network-level correlation (only possible because it's a mesh, not a single sensor).** Neighbourhood-median differencing removes anything shared across many nodes at once (sun, regional EMI) while keeping anything localized (real ground movement). Blast-log gating removes anything time-stamped against a known non-geological event. Spatial coherence testing checks whether the surviving signal forms the expected bowl-shape — real subsidence, and nothing else, produces that pattern across many nodes simultaneously.

5. **Decision layer.** Cleaned, correlated features feed the autoencoder (trained only on normal data, flags deviation) and the physics rule-set (angle-of-draw geometry, escalation ladder: log → caution → alarm → evacuate).

---

## 4. Cost Breakdown

### Per-node BOM (surface deployment)

| Component | Cost (₹) | Notes |
|---|---|---|
| ESP32-S3 + SX1262 LoRa module | 600–900 | Core compute + radio |
| MPU9250 (tilt, secondary signal) | 170–450 | |
| Strain gauge / string potentiometer | 100–300 | Primary signal |
| Conductive-trace crack sensor (DIY) | 20–50 | Cheapest, most unambiguous signal |
| External ADS1115 precision ADC | ~150 | Fixes ESP32's internal ADC nonlinearity |
| Voltage regulator | 20–50 | Kills battery-sag drift |
| Waterproof enclosure (IP65/67) | 100–300 | |
| Battery + basic solar trickle panel | 300–600 | Solar doubles as power source, not just a noise problem |
| Misc (wiring, connectors, mounting) | 150–300 | |
| **Total per node (surface)** | **~₹1,850–3,600** | Consistent with the corrected BOM in the existing docs |

### System-level cost (surface deployment)

| Scale | Node count | Approx. cost |
|---|---|---|
| Hackathon demo | 3 nodes + 1–2 reference anchors + 1 gateway | ₹8,000–14,000 |
| Small pilot (one panel) | ~20–30 nodes | ₹60,000–110,000 |
| Full mine-scale | ~100 nodes | ₹2–4 lakh |

For comparison, commercial geotechnical monitoring points typically run into lakhs *per point* — this is the economic argument, and it holds only for the surface deployment.

### If underground/IS-rated is pursued (Phase 2, not for the hackathon budget)

Certified intrinsically-safe or flameproof enclosures alone typically run ₹8,000–25,000+ per unit, before the electronics inside — driven by certification testing and enclosure hardware, not component cost. At hackathon scale and budget this is not realistic; keep it as a named future-work line, not a claimed capability.

---

## 5. Team Build Plan — Mapped to Your Actual Skillset Split

Composition: 3 software-strong, 3 hardware-strong, 1 hybrid (both), 1 still-learning/generalist.

| Phase | What happens | Owner(s) | Time |
|---|---|---|---|
| **0 — Pure simulation** | Knothe-curve ground truth generator, sensor-realism injection, spatial coherence algorithm (your core IP), false-positive stress test, node-count-vs-reliability curve | The 3 software people. This is where Innovation (30%) and Technical Excellence live — front-load it | ~2 weeks, can start day one, needs zero hardware |
| **1 — Firmware in emulation** | Run compiled firmware in Renode/ESP32 QEMU, check it fits and runs fast enough | Hybrid person, filler work if hardware is delayed | Low priority, skip if time-short |
| **2 — Network simulation** | ns-3/FLoRa alarm-storm test, or spreadsheet duty-cycle math as fallback | One software person peels off here once Phase 0 stabilizes | 3–5 days |
| **3 — Hardware build** | Wire sensors, flash Meshtastic, per-node thermal calibration rig, enclosure/waterproofing, BOM sourcing | The 3 hardware people | ~2 weeks once parts arrive |
| **3b — Custom Meshtastic Module (the one real embedded C++ task)** | Bridges sensor reads to mesh transmission | The hybrid person — this is exactly the bridging role they're suited for | ~1 week |
| **4 — Integration** | Real gateway data flows into the same pipeline built in Phase 0; dashboard (CesiumJS or Leaflet fallback) | Hybrid person integrates; one software person builds dashboard; the learner supports and observes here — good low-stakes onboarding task | ~1–1.5 weeks |
| **Ongoing — "Quiet calibration week" data collection, per-role cheat sheets, demo script prep** | Operational, not deeply technical, but genuinely valuable | The learner — real ownership, appropriate entry point, frees the technical members | Throughout |
| **5 — Demo** | Kill-a-node-on-stage, backup video, venue RF test morning-of | Whole team | Final days |

This split means the software trio never touches a soldering iron and the hardware trio never touches the Knothe-curve math — each phase has a clear, matched owner, and the hybrid person is the deliberate bridge between the two halves rather than a bottleneck.

---

## 6. Feasibility Verdict

**GO, for the surface deployment, with this team composition, in a 6–8 week window.**

- The team-onboarding risk flagged earlier is resolved by this actual composition — it's balanced, not a single point of failure.
- The hardest single technical task (spatial coherence algorithm) sits with the software trio, who have the most runway (can start immediately, Phase 0).
- The hardest single hardware task (Custom Meshtastic Module) sits with the one person suited to own a bridging role, not spread thin across everyone.
- Underground deployment, if pursued, is **not feasible at hackathon scope** due to explosion-proofing certification — keep it as a stated Phase 2 direction, not a built claim.

---

## 7. Making It Technically Stronger — Product-Grade Upgrades

- **Confidence-coverage zoning on the dashboard.** Tag areas by rock type as high-confidence (progressive deformation, system sees it coming) vs. known-blind-spot (brittle, low precursor) — turns a physics limitation into a stated, honest product feature, the way real earthquake early-warning systems are marketed.
- **Last-gasp transmission.** A node about to be destroyed fires one final reading plus a "destroyed" flag the instant its accelerometer detects a free-fall/impact signature — you get data from the failure event itself instead of silence.
- **Synced clocks across nodes (cheap GPS or RTC chip).** Adds a timing dimension to the existing spatial-differencing trick — a truck's shake propagates node-to-node with a delay matching truck speed; real subsidence evolves together over hours. Cheap, and a second independent way to separate signal from noise.
- **Quiet calibration week before real deployment.** Record all machinery, traffic, and weather patterns at the actual site with nothing dangerous happening, to build a site-specific "normal" baseline instead of a generic one — sharpens the autoencoder significantly.
- **Solar trickle charging.** Turns your biggest surface noise source (the sun) into your power source at the same time.
