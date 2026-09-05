# Simulation Toolchain for the Mine Subsidence Early-Warning System
### Deep research: every tool worth considering, layer by layer, with honest pros/cons

---

## 0. The framing that makes this tractable

"Simulate the entire process" is not one simulation. It is **six separate simulations chained together**, and each one has a completely different tool ecosystem. If you go looking for a single tool that does all of it, you will waste two weeks and find nothing, because nothing exists.

Here is the chain:

```
LAYER 1: GROUND PHYSICS
   "The panel is mined out. What does the surface actually do, in mm, over 90 days?"
   OUTPUT: subsidence(x, y, t), tilt(x,y,t), strain(x,y,t)
                    |
                    v
LAYER 2: SENSOR PHYSICS
   "Node #7 sits at (x=340m, y=110m). What voltage/register value does its
    MPU9250 and strain gauge report — including thermal drift, ADC noise,
    blast spikes, truck vibration, battery sag?"
   OUTPUT: raw timeseries per node, per sensor
                    |
                    v
LAYER 3: FIRMWARE / MCU EMULATION
   "Does my ESP32 code correctly read that, filter it, compress it into a
    <60 byte packet, and hand it to the radio?"
   OUTPUT: verified firmware behaviour, no hardware
                    |
                    v
LAYER 4: RADIO + MESH NETWORK
   "50 nodes, IN865, SF9. An alarm cascade fires. Do packets arrive?
    What happens when 6 nodes die simultaneously? Duty cycle limits?"
   OUTPUT: latency, PDR, hop counts, collision stats
                    |
                    v
LAYER 5: BACKEND / DETECTION / INTEGRATION
   "Gateway ingests, buffers offline, syncs, runs detection, raises alarm."
   OUTPUT: working end-to-end pipeline
                    |
                    v
LAYER 6: GIS + ALERT DELIVERY + DEMO
   "Deformation map, risk zones, SMS actually sent, judges see something."
```

**The single most important strategic point:** Layers 1, 2, 5 and 6 need **zero hardware and zero exotic tooling** — they are Python. Layer 4 has exactly one correct answer that almost no other team will find. Layer 3 is the only genuinely awkward one, and it is also the least valuable to over-invest in.

---

# LAYER 1 — Ground physics / subsidence generation

This layer produces your **ground truth**. Everything downstream is judged against it. If a judge asks "how do you know your detection algorithm works?", this layer is the answer.

---

### 1.1 Knothe / Influence Function model in pure Python (NumPy + SciPy)

**What it is:** You implement the influence-function method yourself — roughly 150–300 lines. The panel is discretised into small elements; each element contributes a Gaussian-shaped "influence" to every surface point; you sum them. Knothe's time function `S(t) = S_max · (1 − e^(−c·t))` then spreads that final subsidence over time. Tilt is the first spatial derivative, curvature the second, horizontal strain the derivative of horizontal displacement. All of that is `numpy.gradient()`.

**Pros**
- Zero cost, zero install, runs on any laptop, runs in Colab.
- You *own* every parameter — subsidence factor, tanβ (angle of draw), edge effect offset, time factor `c`. That means you can sweep them, which is exactly what an ML training-data generator needs.
- Generates arbitrarily many synthetic scenarios in seconds: fast subsidence, slow subsidence, off-centre trough, two overlapping panels, no subsidence at all (critical for false-positive testing).
- It is the *same* method used by the industry-standard SDPS package — so "we implemented the influence function method" is a defensible, citable claim, not a toy.
- Directly outputs tilt and strain, which are literally your two sensor modalities. No conversion step.
- Trivially integrates into your ML pipeline — it's already a NumPy array.

**Cons**
- You must validate it, or it's just a pretty curve. Fix: reproduce a published subsidence profile from a paper (Jharia/Raniganj profiles exist in Indian literature) and show your RMSE against the published monument line.
- Purely empirical. It knows nothing about rock mechanics. It cannot model a sudden brittle collapse or a sinkhole — only the smooth trough. **You already flagged brittle failure as a limitation in your report; this tool cannot cover it.**
- A geotech-savvy judge may ask "why not FEM?" You need the answer ready: *empirical influence-function is the accepted industry method for subsidence prediction; FEM is used when you need stress state inside the rock mass, which we don't — we need surface deformation.*

**Verdict: THIS IS YOUR PRIMARY TOOL. Build it first, this week.** Everything else in Layer 1 is optional.

---

### 1.2 SDPS — Surface Deformation Prediction System (Virginia Tech / Carlson Software)

**What it is:** The actual industry-standard subsidence prediction package in the US. Widely used by the US mining industry and by state and federal regulators for subsidence planning, prediction and control; it implements the influence function method with a Gaussian bell-shaped influence function, and calculates subsidence profile, angle of draw, strain, slope and curvature. It was developed at Virginia Tech and Carlson Software is the sole distributor. Version 7 has been validated in recent academic work against real longwall monument data.

**Pros**
- Unimpeachable credibility. "We benchmarked our model against SDPS" is a strong slide.
- Handles irregular panel shapes, variable topography, dynamic (time-dependent) subsidence, edge-effect offset — all things your hand-rolled version will approximate.
- Free training course exists via the OSMRE TIPS Virtual Campus.

**Cons**
- **Access is the killer.** Distributed via Carlson Software / OSMRE TIPS, primarily to US government and industry users. Getting a license as an Indian undergrad team in a hackathon window is realistically not happening. Do not build a dependency on it.
- Windows-only desktop GUI. Not scriptable into an ML data generation loop.
- US-parameterised. Indian coalfield parameters differ.

**Verdict: CITE IT, DON'T USE IT.** Say "our model implements the same influence-function methodology used in SDPS, the package used by US mining regulators." You get 90% of the credibility for 0% of the access problem.

---

### 1.3 FLAC3D / UDEC / 3DEC (Itasca)

**What it is:** The gold-standard commercial numerical geomechanics codes. FLAC3D is finite-difference continuum; UDEC/3DEC are *discrete element* — they model the rock as discrete blocks that can separate and fall, which is the only way to properly simulate caving and brittle roof collapse.

**Pros**
- If you want to model the *mechanism* — caving, goaf compaction, bed separation, brittle failure — this is the real tool.
- UDEC in particular would let you model the sudden-failure case your report honestly admits you can't detect. That would be a very strong "we know exactly where our system is blind, and here's the simulation proving it" slide.

**Cons**
- **Extremely expensive.** Five-figure USD commercial licenses. Some universities have them; most Indian undergrad colleges do not.
- Steep learning curve — weeks, not days. FISH scripting language.
- Massively overkill. You need a surface deformation timeseries, not a stress tensor field.
- Runtime: a proper 3D caving model is hours per run. You need hundreds of runs for ML training data.

**Verdict: SKIP unless your college already has a license AND a mining-engineering faculty member who will hand-hold you.** If that's true, it's a genuine differentiator — but check availability before spending a single hour on it.

---

### 1.4 Rocscience RS2 / RS3

**What it is:** Commercial 2D/3D finite element geotechnical software, much friendlier than FLAC. RS2 (2D) is the workhorse for tunnel and excavation deformation.

**Pros**
- Far easier learning curve than FLAC — a competent student can produce a meaningful 2D excavation model in a couple of days.
- Rocscience offers educational/student licensing programs. **Worth an email — this is the most realistically obtainable serious geotech tool for your team.**
- Gives you a legitimate FEM cross-check on your empirical model, which pre-empts the "why not FEM?" question entirely.

**Cons**
- Student license terms/availability change; verify current terms before planning around it.
- 2D plane-strain is a real simplification of a 3D longwall panel.
- Windows GUI, not scriptable for bulk data generation.

**Verdict: BEST REALISTIC STRETCH GOAL for Layer 1.** One team member spends 2 days, produces ONE cross-validation figure ("our influence-function trough vs. RS2 FEM trough, same panel geometry"), and that single slide kills the FEM objection permanently.

---

### 1.5 Free / open-source FEM: OpenSees, Code_Aster (Salome-Meca), Kratos, FEniCS, Abaqus Student Edition

**What they are:** General-purpose finite element solvers. OpenSees is earthquake/structural-focused with soil elements; Code_Aster is EDF's industrial-grade free solver; FEniCS/Kratos are Python-friendly PDE frameworks; Abaqus Student Edition is free but node-limited.

**Pros**
- Free.
- FEniCS and Kratos are Python-native — they *could* slot into your data-generation loop.
- OpenSees has established soil/geotech element libraries.

**Cons**
- **None of these are mining subsidence tools.** They are general PDE solvers. You would be building a geomechanical model from scratch: constitutive law for the coal measures, goaf compaction behaviour, excavation staging, boundary conditions. That is a semester of work, not a hackathon task.
- Abaqus Student Edition node limits make a realistic panel-scale mesh impossible.
- Code_Aster's learning curve is legendary. Documentation is substantially in French.

**Verdict: SKIP.** This is the trap. It looks free and therefore attractive, and it will eat your timeline. Your report already lists OpenSees as a stretch goal — **downgrade it. RS2 is a better use of the same effort.**

---

### 1.6 Real InSAR data instead of simulation (QGIS + Sentinel-1 / SBAS)

**What it is:** Satellite radar interferometry measures real ground subsidence to millimetre precision. ESA's Sentinel-1 data is free. There is substantial published InSAR work on Indian coalfields, especially Jharia and Raniganj.

**Pros**
- **This is real data, not simulation.** "We validated our detection algorithm against actual measured subsidence over an Indian coalfield" is a dramatically stronger claim than any simulation.
- Free data. Processing tools (SNAP/StaMPS/MintPy) are free.
- Feeds directly into the GIS deformation-map requirement in the problem statement.
- Nobody else competing on this problem statement will do this.

**Cons**
- InSAR processing is its own specialist skill. SNAP/MintPy have a real learning curve — days to weeks.
- Temporal resolution is 6–12 days, spatial resolution tens of metres. Your system claims minute-scale, metre-scale detection. So it validates the *slow trend*, not the fast event.
- Easier path: skip the raw processing entirely and use **already-published subsidence measurements from Indian coalfield papers** as your validation dataset. Same credibility, a fraction of the effort.

**Verdict: HIGH-VALUE, MEDIUM-RISK.** Assign to your strongest software person as a **parallel** track, with a hard cutoff. If it works, it is your best single slide. Fallback (published profile digitisation) is cheap and gets you most of the way.

---

# LAYER 2 — Sensor physics / signal synthesis

This layer converts `subsidence(x,y,t)` into what a real MPU9250 and a real strain gauge on a real ESP32 would actually report. **This is where your "tilt is demoted because thermal drift exceeds signal" argument gets proven rather than asserted.** It is arguably the highest-value-per-hour layer in the whole project.

---

### 2.1 Custom Python noise/error model (NumPy, SciPy, pandas)

**What it is:** A function per sensor. Takes the true physical quantity, adds every error term you documented: thermal bias drift (as a function of a diurnal temperature curve), bias instability random walk, white noise, ADC quantisation, ESP32 ADC non-linearity, supply-voltage sag, blast impulse spikes, HEMM machinery vibration, wind loading.

**Pros**
- Total control. Every noise term is one line and one citation.
- **Directly produces your killer plot**: overlay "true subsidence tilt signal" against "MPU9250 thermal drift envelope" and let the picture make the argument. That single chart justifies your entire sensor-hierarchy decision.
- Lets you actually *measure* your false-positive rate — feed it 90 days of pure-noise, no-subsidence data and count how many alarms fire. NIOSH RI 9672 says false-alarm fatigue is the primary real-world failure mode; you can quantify yours where nobody else can.
- Free, fast, fully scriptable, unlimited scenarios.

**Cons**
- Garbage in, garbage out — your noise parameters must come from the actual MPU9250 datasheet and ADS1115 datasheet, not from imagination. Budget half a day for datasheet extraction and cite them.
- Doesn't capture correlated real-world weirdness (a specific board's quirks, moisture ingress).
- Needs at least a *sanity check* against real hardware eventually — even 24 hours of one real MPU9250 on a windowsill, logging temperature and tilt, validates the whole model.

**Verdict: MANDATORY. Second priority after Layer 1.** This is the technical heart of your differentiation.

---

### 2.2 MATLAB Sensor Fusion and Tracking Toolbox (`imuSensor`)

**What it is:** MATLAB has a built-in parameterised IMU model — accelerometer/gyro/magnetometer with configurable bias instability, random walk, temperature bias coefficients, axis misalignment. Also `gpsSensor`, and Allan variance analysis tools.

**Pros**
- Physically rigorous, pre-validated error models. You configure from datasheet numbers rather than inventing the model structure.
- Allan variance tooling lets you characterise a real sensor and match the model to it — that's the professional workflow.
- Many Indian colleges have campus MATLAB licenses. Check yours.

**Cons**
- Licensing. Toolbox is a paid add-on beyond base MATLAB; campus licenses vary in what's included.
- Splits your stack — your detection logic will be in Python. Exporting CSV between them is friction.
- Overkill given tilt is your *secondary* signal.

**Verdict: USE ONLY IF you already have a campus license including that toolbox.** Otherwise the Python route is fine and keeps one language.

---

### 2.3 gnss-ins-sim (open-source Python)

**What it is:** An open-source Python IMU/GNSS simulation framework with configurable sensor error models (bias, scale factor, random walk) and built-in profiles for low/mid/high-grade IMUs.

**Pros**
- Free, Python, and gives you a ready-made error-model structure so you're not designing one from first principles.
- Includes Allan-variance-based error parameterisation.

**Cons**
- Aimed at navigation/dead-reckoning, not static structural tilt monitoring. Much of it (trajectory generation, INS mechanisation) is irrelevant to you.
- Temperature-dependent drift — your single most important error term — is not its focus. You'd be adding that yourself anyway.

**Verdict: OPTIONAL. Read its error-model code for structure, then write your own leaner version.**

---

# LAYER 3 — Firmware / MCU emulation

**Read this section's verdict first: this layer is where teams sink time for the least return.** Do the minimum that de-risks your real hardware, then move on.

---

### 3.1 Wokwi

**What it is:** Browser-based simulator for ESP32, Arduino, Pi Pico, STM32. Simulates the actual chip (multiple ESP32 variants), plus peripherals — LEDs, buttons, sensors, displays, and notably MPU6050 and I2C/SPI devices. Supports custom chips written in C via a `.chip.c` / `.chip.json` pair.

**Pros**
- Zero install. Share a link and your teammate sees your circuit running. Excellent for a hackathon team where hardware hasn't arrived yet.
- **Your hardware people can start writing and testing sensor-reading firmware today, before any parts ship.** That alone justifies it.
- Wi-Fi is simulated on ESP32 — so you can test your gateway's MQTT/HTTP upload path in-browser.
- Supports custom firmware upload (compiled ELF/BIN), so PlatformIO builds can run in it.
- Free tier is generous; paid tier removes the simulation time limit.

**Cons**
- **No real LoRa.** There is no first-party SX1276/SX1278 model. Community "LoRa chip" projects exist on Wokwi, but they are stubs — they acknowledge the SPI transaction and print to serial; they do not model modulation, airtime, collisions, or range. Several public examples literally `#define` a simulation flag and *bypass* `LoRa.begin()`.
- No MPU9250 model (MPU6050 is close but not identical — different register map for the magnetometer).
- No analog realism — it will not reproduce ESP32 ADC non-linearity, which is one of your documented noise sources. Layer 2 handles that instead.
- Timing is not cycle-accurate. Don't trust it for tight timing.

**Verdict: USE IT, for sensor-side firmware and the gateway's network code. Do NOT use it for anything LoRa/mesh.**

---

### 3.2 QEMU (Espressif ESP32 fork)

**What it is:** Espressif maintains a QEMU fork targeting Xtensa ESP32 (and increasingly the RISC-V parts); recent ESP-IDF versions expose it via `idf.py qemu`, letting you boot a real ESP-IDF firmware image with no board.

**Pros**
- Runs your **actual** firmware binary, actual bootloader, actual FreeRTOS. Highest fidelity of any option here for CPU/memory behaviour.
- Scriptable, headless, CI-friendly. Automated firmware regression tests are a genuinely impressive engineering-practice slide.
- Free and open source.

**Cons**
- Peripheral coverage is the weak spot. Wi-Fi, and anything on SPI like a LoRa radio, is either missing or heavily stubbed. **You cannot simulate your LoRa link here either.**
- Setup friction is real — toolchain, flash image assembly, partition tables. Half a day minimum for someone who's never done it.
- Debugging the *simulator* is a real risk of eating a day.

**Verdict: MEDIUM PRIORITY.** Do it only if a team member is comfortable with build toolchains. The Meshtastic native build (3.5) gets you more, faster.

---

### 3.3 Renode

**What it is:** Antmicro's open-source multi-node embedded simulation framework. Designed for simulating *whole systems* — several MCUs plus the wireless medium connecting them. Supports Robot Framework test automation and CI. Has RESD (Renode Sensor Data format) for feeding time-coordinated synthetic sensor data into simulated sensor peripherals.

**Pros**
- **Multi-node is native.** This is the one MCU emulator built for "20 devices talking to each other," which is precisely your topology.
- The RESD sensor-data feature is a beautiful match for Layer 2 → Layer 3 handoff: your Python noise model writes RESD, Renode plays it into the virtual sensor, your real firmware reads it.
- Excellent CI/automated-testing story.

**Cons**
- **ESP32 support is community-contributed and partial** — improved via community contribution around the 1.14 release, but it is not a first-class, fully-modelled platform the way STM32 or nRF are. Expect gaps and expect to write platform description files.
- Steepest learning curve of the three (its own `.repl`/`.resc` description languages).
- Its wireless medium models cover 802.15.4-style radios well; **LoRa is not a supported radio model.** You'd be writing it.

**Verdict: SKIP for this hackathon.** It is the *architecturally* right tool and the *practically* wrong one given ESP32 support maturity and your timeline. Mention it in your "future work / productionisation" slide — that shows you know it exists and why you didn't use it, which is itself a mature answer.

---

### 3.4 Proteus VSM / SimulIDE / Tinkercad Circuits / Falstad

**What they are:** Circuit-level simulators. Proteus is the commercial one with MCU co-simulation; SimulIDE is the free lightweight one; Tinkercad is the browser toy; Falstad is pure analog.

**Pros**
- Proteus shows actual analog waveforms — genuinely useful for designing your strain-gauge Wheatstone bridge and its instrumentation amplifier, before you solder anything.
- SimulIDE and Falstad are free and fast for sanity-checking a bridge circuit or a voltage divider.
- Tinkercad is great for teaching your least-experienced teammate.

**Cons**
- Proteus is paid and its ESP32 support is poor-to-nonexistent (it's an 8-bit AVR/PIC world historically).
- SimulIDE has no ESP32.
- Tinkercad is Arduino Uno only. Useless for your actual target.
- None of these help with networking, mesh, or system integration.

**Verdict: USE Falstad or SimulIDE for 30 minutes to validate your Wheatstone bridge and ADC front-end. Nothing more.** Do not buy Proteus.

---

### 3.5 PlatformIO native builds + Unity/GoogleTest unit tests

**What it is:** Not a simulator — you compile your firmware's *logic* (filtering, thermal compensation, packet encoding, alarm state machine) for your **laptop's** CPU with the hardware calls stubbed, and unit-test it.

**Pros**
- **Fastest, most reliable, most professional option in this entire layer, and it is nearly free to set up.**
- Millisecond test cycles vs. minutes for emulation.
- Directly testable: feed your Layer 2 synthetic CSV into your real C++ filtering code, assert the output. That's a genuine hardware-in-the-loop-quality test with no hardware.
- This is exactly how the Meshtastic project itself builds its `native` target — which is what makes 4.1 below possible.
- "We have 40 unit tests on our firmware logic running in CI" is a rare and credible engineering claim in a student hackathon.

**Cons**
- Tests logic, not hardware interaction. Won't catch an I2C wiring bug or a timing race.
- Requires you to have written your firmware with a clean separation between logic and hardware access. If your code is one giant `loop()` with `analogRead()` sprinkled through it, you must refactor first — which is 2–4 hours of work and worth doing anyway.

**Verdict: HIGHEST PRIORITY IN LAYER 3. Do this before Wokwi, before QEMU, before anything.**

---

# LAYER 4 — Radio and mesh network simulation

**This layer contains the single most important finding in this document.**

Your open question was "does ns-3 or FLoRa map cleanly to Meshtastic's protocol behaviour?" The answer is **no, and you should not use either.** There is a purpose-built tool, maintained by the Meshtastic project itself.

---

### 4.1 Meshtasticator ⭐ THE ANSWER

**What it is:** The official Meshtastic simulator, in the `meshtastic` GitHub org. It has **two distinct modes**:

**(a) Discrete-event simulator** — mimics the radio section of the device software to evaluate scenario performance and protocol scalability. You place nodes on a plot (or let it randomise them), set each node's role, hop limit, elevation and antenna gain, pick a LoRa modem preset and a path-loss model, and it simulates. It plots node placement and the time schedule of overlapping messages. Their own documentation shows results from 100 simulations at varying hop limit and node count, measuring average nodes reached per message and "usefulness" — the fraction of received packets carrying a genuinely new message rather than a rebroadcast duplicate.

**(b) Interactive simulator** — runs the **actual Meshtastic firmware** as a Linux native binary, multiple instances, communicating over TCP as if via their LoRa chips, with the simulator forwarding messages based on simulated node positions and the path loss model. Runs via PlatformIO's `native` target or via Docker. Because it has an "oracle view" of the network, it visualises the exact route each message takes.

**Pros**
- **It is Meshtastic, not a LoRa approximation.** Real flooding-mesh rebroadcast behaviour, real hop limits, real roles (CLIENT/ROUTER), real duty-cycle behaviour. FLoRa and ns-3 cannot give you this.
- Mode (b) runs your **real firmware**, including your custom sensor module code. That means Layer 3 and Layer 4 collapse into one step — you test firmware *and* mesh together, with zero hardware.
- Pure Python + `pip install -r requirements.txt`. Setup is an afternoon, not a fortnight.
- Configurable path-loss models and node elevation — so you can model a mine site's terrain roughly, and model antenna mast height.
- **It directly answers your hardest design question.** Kill nodes 12–17 mid-simulation and watch what the mesh does. That is your correlated-failure argument, demonstrated rather than claimed. No other team on this problem statement will have this.
- Has unit tests; actively maintained (activity through 2026).
- Also validates your alarm-storm concern: 30 nodes all detecting the same event and all transmitting at once is exactly the scenario the discrete-event sim was built to measure.

**Cons**
- Path-loss modelling is explicitly a rough estimate of the physical environment and will not be fully accurate — it depends on many real-world factors. **Say this openly in your pitch; don't overclaim range numbers.**
- The discrete-event sim is documented as based on Meshtastic 2.1, so it may lag the newest firmware behaviour. Check the version before quoting exact protocol details.
- The interactive sim needs Linux (or Docker on Win/Mac) and launches a terminal per node — 50 nodes is heavy on a laptop. Practical ceiling is lower than the discrete-event sim's.
- Documentation is community-grade. Expect to read source.

**Verdict: THIS IS YOUR LAYER 4 TOOL. Full stop. Start with the discrete-event sim (easier), graduate to interactive.**

---

### 4.2 FLoRa (Framework for LoRa) on OMNeT++

**What it is:** A simulation framework for end-to-end LoRa network simulation, built on OMNeT++ and using INET components. Provides modules for LoRa nodes, gateway(s) and a network server, supports Adaptive Data Rate, and collects per-node energy consumption statistics.

**Pros**
- Academically respectable — appears in peer-reviewed comparisons alongside NS-3 and LoRaSim for LoRa/LoRaWAN simulation.
- Rigorous PHY modelling via INET. Good collision/interference modelling.
- Energy consumption statistics per node — relevant to your solar/battery budget.
- OMNeT++ produces genuinely beautiful visualisations for a pitch deck.

**Cons — and these are decisive**
- **It models LoRaWAN, not a LoRa mesh.** LoRaWAN is a *star* topology: nodes → gateway → network server, no node-to-node relaying. Meshtastic is a *flooding mesh* with node-to-node rebroadcast and hop limits. **The thing you most need to simulate — multi-hop relaying and survivability — is the exact thing FLoRa's architecture does not represent.**
- To make it model Meshtastic you would be writing a new routing module in C++ inside OMNeT++. That is a multi-week project on its own.
- OMNeT++ + INET + FLoRa version compatibility is a well-known source of pain. Getting all three to build together can eat days.
- C++/NED learning curve.

**Verdict: DO NOT USE. Your instinct to check this was right, and the check saves you a week.** If a judge asks why not FLoRa, the answer — "FLoRa models LoRaWAN star topology; our system is a flooding mesh, so we used the Meshtastic project's own discrete-event simulator" — is a *strong* answer that demonstrates you understood the protocol distinction. **That question is now a gift, not a threat.**

---

### 4.3 ns-3 with the `lorawan` module

**What it is:** ns-3 is the dominant academic network simulator; there is a well-known LoRaWAN module for it.

**Pros**
- Most credible network simulator in academia. Enormous documentation and community.
- Excellent PHY/interference modelling.
- Python bindings exist.

**Cons**
- **Same fatal flaw as FLoRa: LoRaWAN star topology, not mesh.**
- Heaviest learning curve of all the network simulators. Waf/CMake build, C++ throughout.
- Overkill for a system whose network is ~20–100 nodes sending short packets infrequently.

**Verdict: DO NOT USE.** Same reasoning as FLoRa.

---

### 4.4 LoRaSim / LoRaFREE

**What it is:** The original lightweight Python LoRa collision simulator from Bristol. Notably, **part of Meshtasticator's source is derived from this lineage** — so you get its core value automatically by using Meshtasticator.

**Pros**
- Tiny, readable, pure Python. You can understand it in one sitting.
- Good for pure "how many collisions at N nodes" questions.

**Cons**
- No mesh, no routing, no Meshtastic semantics.
- Old and largely superseded.

**Verdict: SKIP — you get its value through Meshtasticator.**

---

### 4.5 SPLAT! (+ SRTM terrain data)

**What it is:** A GPL-licensed terrestrial RF propagation tool using the Longley-Rice Irregular Terrain Model to predict link reliability and path loss, working from SRTM elevation tiles.

**Pros**
- **Real terrain.** This is the one tool here that answers "will node 7 actually reach node 12 across that ridge at this specific Indian coalfield?" using actual elevation data.
- Free, well-established, scriptable. Python wrappers exist.
- Produces coverage maps that look extremely professional in a deck.
- Perfect complement to Meshtasticator: SPLAT! tells you *which links exist*, Meshtasticator tells you *what the protocol does over those links*.

**Cons**
- Command-line, dated UX, fiddly input file formats.
- Requires downloading SRTM tiles for your area of interest.
- Longley-Rice is a statistical terrain model — it doesn't know about buildings, vegetation, or mine infrastructure.

**Verdict: HIGH-VALUE, LOW-COST ADD-ON.** One afternoon. Pick a real Indian coalfield (Jharia, Raniganj, Singrauli), pull SRTM, generate a coverage map, feed realistic link budgets into Meshtasticator. Site-specific realism for almost no effort.

---

# LAYER 5 — Backend, detection pipeline, and end-to-end integration

---

### 5.1 MQTT (Eclipse Mosquitto) + Python

**Pros**
- The de facto IoT messaging standard. Meshtastic itself speaks MQTT natively — so a Meshtastic gateway publishing to Mosquitto is the *actual* production architecture, not a mock.
- Free, trivial to run in Docker, one command.
- Lets you swap data sources freely: simulated nodes → MQTT → your backend today; real nodes → MQTT → the same backend later. **Your report already promises "swapping the data source, not rebuilding anything" — MQTT is what makes that literally true.**
- QoS levels and retained messages give you a real answer for message durability.

**Cons**
- Broker is a single point of failure unless clustered (fine for your scale; mention it).
- Not a database — you still need storage.

**Verdict: MANDATORY. This is your integration backbone.**

---

### 5.2 ThingsBoard (Community Edition)

**What it is:** Open-source IoT platform: device management, telemetry ingestion, a rule engine, alarm definitions, and drag-and-drop dashboards including map widgets.

**Pros**
- **It hands you five of your requirements for free**: telemetry storage, threshold/alarm rules, dashboards, map widgets, and email/SMS notification hooks.
- Built-in device simulator/emulator support.
- Rule chains give you a visual alarm-escalation pipeline — very demo-friendly on a projector.
- Self-hostable via Docker, works fully offline (matching your offline requirement).

**Cons**
- Heavy. Java + Postgres + Docker. Non-trivial resource footprint on a student laptop.
- Opinionated. Your custom detection logic (spatial bowl-shape correlation across nodes) will not fit its rule engine — you'll run that in Python alongside and push results in.
- Learning its data model costs a day.
- **Risk: it can make your project look like configuration rather than engineering.** Your differentiation is the detection algorithm, not the dashboard.

**Verdict: OPTIONAL, LEANING NO.** If your team is time-pressed on the dashboard, it's a huge shortcut. If you have a competent frontend person, a custom React/Leaflet dashboard is lighter and looks more like *your* work.

---

### 5.3 Node-RED

**Pros**
- Visual flow programming — outstanding for wiring MQTT → logic → SMS → dashboard in an hour.
- Live-demos beautifully: you can *show* the alarm flowing through the flow diagram on screen while it happens.
- Huge node library (MQTT, HTTP, Twilio, email, serial).
- Very lightweight compared to ThingsBoard.

**Cons**
- Gets messy fast for real logic. Your ML/detection code should not live here.
- "It's just Node-RED flows" is a weak engineering claim if it's your *whole* backend.

**Verdict: USE AS GLUE AND DEMO SURFACE, not as the system.** Excellent for the alert-delivery chain specifically (Layer 6).

---

### 5.4 Docker + docker-compose

**Pros**
- Lets you spin the entire stack — broker, database, backend, dashboard, N simulated nodes — with one command. **On demo day, "one command brings up a 30-node virtual mine" is a very strong moment.**
- Kills "works on my machine" across six teammates.
- Meshtasticator's interactive sim already supports Docker.

**Cons**
- One person must own it. Docker knowledge is uneven in student teams.
- Debugging networking between containers costs an evening the first time.

**Verdict: STRONGLY RECOMMENDED. Assign to one owner.**

---

### 5.5 Time-series storage + Grafana (InfluxDB / TimescaleDB / plain SQLite)

**Pros**
- Grafana dashboards look professional with near-zero effort and are excellent for showing 90 days of simulated node data scrolling.
- Time-series DBs handle downsampling and retention natively.
- **SQLite is the underrated answer**: your offline-buffering requirement (gateway writes locally, syncs when connectivity returns) is a 30-line SQLite implementation. Don't over-engineer this.

**Cons**
- Another service to run and learn.
- Grafana is analyst-facing, not operator-facing — it is not the right *alerting* UI for a mine safety officer.

**Verdict: USE SQLITE for gateway buffering (simple, matches the requirement exactly). Grafana optional for the "look at all this data" slide.**

---

### 5.6 Python ML stack (scikit-learn, PyTorch, River)

**Pros**
- Your Layer 1 + Layer 2 pipeline generates labelled training data on demand — you can produce 10,000 labelled subsidence/no-subsidence scenarios. That's more training data than most hackathon ML projects have.
- scikit-learn's `IsolationForest` / `OneClassSVM` fit the anomaly-detection framing directly and are explainable to judges.
- **River** is worth a specific look: online/streaming ML, designed for exactly your incremental, low-memory, edge-device situation.

**Cons**
- Training on synthetic data risks a model that learns your *simulator's* quirks, not real subsidence. **Be honest about this in the pitch and note the InSAR/published-data validation path (1.6) as the answer.**
- Deep learning is unjustifiable here and will invite the question "why?" Classical methods plus physics-informed thresholds are the more defensible choice, and they run on the gateway.

**Verdict: USE, but keep it classical and explainable.** Your differentiator is the physics reasoning, not model complexity.

---

# LAYER 6 — GIS, visualisation, and alert delivery

---

### 6.1 QGIS

**Pros**
- Free, industry-standard GIS. **Directly satisfies the problem statement's "GIS-based deformation maps and risk zones" clause** — not an approximation of it.
- Python-scriptable (PyQGIS) so your Layer 1 output can auto-generate deformation contour maps.
- Excellent for your confidence-coverage zoning idea: colour-code where the system is reliable vs. where brittle failure limits warning time. That honest-limitation map is one of your strongest trust-building slides.
- Reads SRTM, Sentinel/InSAR products, shapefiles — connects to 1.6 and 4.5.

**Cons**
- Desktop app; the outputs are static exports unless you also run a web map.
- Learning curve of a day for someone who's never touched GIS.

**Verdict: STRONGLY RECOMMENDED.** High requirement-coverage per hour spent.

---

### 6.2 Leaflet / Mapbox GL in the dashboard

**Pros**
- Live, interactive node map in the browser — nodes changing colour in real time during the demo is the visual that sells the project.
- Leaflet is free and tiny.
- Can overlay QGIS-exported risk zones as GeoJSON.

**Cons**
- Needs a frontend person.
- Real-time map updates over websockets add complexity.

**Verdict: YES for the live demo. QGIS for the static analytical maps; Leaflet for the live one.**

---

### 6.3 Alert-delivery testing (Twilio test credentials / MSG91 / SMTP mocks / MailHog)

**What it is:** You cannot repeatedly fire real SMS during development. Twilio provides test credentials that accept API calls without sending. MailHog is a fake SMTP server that catches emails in a web UI.

**Pros**
- Free, instant, and lets you test the full alert pipeline hundreds of times.
- MailHog in particular is one Docker command and gives you a visible inbox to demo.
- Lets you test the *escalation logic* (siren → GSM SMS → internet email) exhaustively, which is where the real bugs are.

**Cons**
- **Cannot simulate your GSM module's actual behaviour.** SIM800L failure modes (network registration failure, brownout under transmit current draw, 2G unavailability) are only discoverable on real hardware. This is one of the few things you genuinely must test physically — and it is cheap to do.
- Test credentials don't validate real deliverability or DLT registration (India requires DLT registration for transactional SMS — check this before claiming production readiness).

**Verdict: USE for pipeline logic. Budget one real SIM800L test with a real SIM — it is a ₹500 de-risking exercise for a claim central to your pitch.**

---

# MASTER COMPARISON TABLE

| # | Tool | Layer | Cost | Setup effort | Learning curve | Fidelity for YOUR use | Key strength | Killer weakness | **Verdict** |
|---|---|---|---|---|---|---|---|---|---|
| 1.1 | **Python Knothe / influence function** | 1 Ground | Free | Hours | Low | High (smooth trough) | You own every parameter; infinite scenarios; feeds ML directly | Can't model brittle/sudden failure | ⭐ **BUILD FIRST** |
| 1.2 | SDPS | 1 Ground | License via Carlson/OSMRE | N/A | Medium | Very high | Industry & regulator standard | Realistically inaccessible to you | 📄 **CITE, DON'T USE** |
| 1.3 | FLAC3D / UDEC (Itasca) | 1 Ground | ₹₹₹₹ | Days | Very high | Highest (true caving) | Only tool that models brittle collapse | Cost + weeks of learning | ❌ **SKIP** (unless college has it) |
| 1.4 | Rocscience RS2 / RS3 | 1 Ground | Student license — verify | Days | Medium | High | Realistic FEM cross-check; friendly UI | Licence uncertainty; 2D simplification | 🎯 **BEST STRETCH GOAL** |
| 1.5 | OpenSees / Code_Aster / FEniCS / Kratos / Abaqus SE | 1 Ground | Free | Weeks | Very high | Low (not subsidence tools) | Free and general | You'd build the geomechanics from scratch | ❌ **SKIP — this is the trap** |
| 1.6 | InSAR (Sentinel-1) + QGIS / MintPy | 1 Ground | Free | Days | High | **Real data, not simulation** | Strongest possible validation claim | Specialist skill; 6–12 day cadence | 🎯 **HIGH VALUE, PARALLEL TRACK** |
| 2.1 | **Custom Python noise model** | 2 Sensor | Free | Hours | Low | High if datasheet-driven | Proves the tilt-demotion argument; quantifies false-positive rate | Garbage in, garbage out | ⭐ **MANDATORY — 2nd priority** |
| 2.2 | MATLAB `imuSensor` | 2 Sensor | Campus licence | Hours | Medium | Very high | Rigorous pre-validated IMU error models | Licence + splits your stack | ⚪ **ONLY IF licence exists** |
| 2.3 | gnss-ins-sim | 2 Sensor | Free | Hours | Medium | Medium | Ready-made error model structure | Navigation-focused; no thermal focus | ⚪ **READ IT, DON'T DEPEND ON IT** |
| 3.1 | **Wokwi** | 3 Firmware | Free tier | Minutes | Very low | Medium | Start firmware before parts arrive; shareable links | **No real LoRa**; no MPU9250; no ADC realism | ✅ **USE (sensor + Wi-Fi code only)** |
| 3.2 | QEMU (Espressif) | 3 Firmware | Free | Half day+ | Medium-high | High for CPU, low for peripherals | Runs your real binary; CI-friendly | No LoRa/Wi-Fi peripherals; setup friction | ⚪ **MEDIUM PRIORITY** |
| 3.3 | Renode | 3 Firmware | Free | Days | High | Medium (ESP32 partial) | Native multi-node + RESD sensor injection | ESP32 support is community/partial; **no LoRa radio model** | ❌ **SKIP — mention as future work** |
| 3.4 | Proteus / SimulIDE / Tinkercad / Falstad | 3 Circuit | Free–₹₹ | Minutes–hours | Low | Low (analog only) | Validate the Wheatstone bridge before soldering | No ESP32 / no networking | ⚪ **30 MIN ON BRIDGE ONLY** |
| 3.5 | **PlatformIO native + unit tests** | 3 Firmware | Free | Hours | Low | High (logic) | Fastest, most professional; feeds Layer-2 CSV into real C++ | Doesn't test hardware interaction | ⭐ **DO THIS FIRST IN LAYER 3** |
| 4.1 | **Meshtasticator** | 4 Network | Free | Hours | Low-medium | **Highest — it IS Meshtastic** | Real firmware, real mesh, real flooding; kill nodes and watch recovery | Path loss is a rough estimate; DE sim based on FW 2.1 | ⭐⭐ **THE ANSWER FOR LAYER 4** |
| 4.2 | FLoRa (OMNeT++) | 4 Network | Free | Days | High | **Wrong topology** | Rigorous PHY; energy stats; pretty visuals | Models LoRaWAN **star**, not mesh — misses your core question | ❌ **DO NOT USE** |
| 4.3 | ns-3 `lorawan` | 4 Network | Free | Days | Very high | **Wrong topology** | Highest academic credibility | Same star-topology flaw; heaviest curve | ❌ **DO NOT USE** |
| 4.4 | LoRaSim / LoRaFREE | 4 Network | Free | Hours | Low | Low | Tiny and readable | No mesh; superseded (Meshtasticator descends from it) | ❌ **SKIP** |
| 4.5 | SPLAT! + SRTM | 4 Network | Free | Hours | Medium | High (terrain) | Real terrain link viability at a real Indian coalfield | CLI UX; no vegetation/buildings | 🎯 **HIGH-VALUE ADD-ON** |
| 5.1 | **MQTT / Mosquitto** | 5 Integration | Free | Minutes | Low | Production-accurate | Meshtastic speaks it natively; makes sim→real swap literal | Single point of failure at scale | ⭐ **MANDATORY** |
| 5.2 | ThingsBoard CE | 5 Integration | Free | Half day | Medium | High | Storage + rules + alarms + dashboards + maps, free | Heavy; risks looking like configuration not engineering | ⚪ **OPTIONAL, LEANING NO** |
| 5.3 | Node-RED | 5 Integration | Free | Minutes | Very low | Medium | Wires alert chain in an hour; demos beautifully | Weak as core logic | ✅ **USE AS GLUE + DEMO** |
| 5.4 | Docker Compose | 5 Integration | Free | Hours | Medium | N/A | One command = whole 30-node virtual mine | Needs one dedicated owner | ✅ **STRONGLY RECOMMENDED** |
| 5.5 | SQLite / InfluxDB + Grafana | 5 Storage | Free | Hours | Low–med | High | SQLite = your offline-sync requirement in 30 lines | Grafana is analyst-facing, not operator-facing | ✅ **SQLITE YES; GRAFANA OPTIONAL** |
| 5.6 | scikit-learn / River | 5 Detection | Free | Hours | Low-med | Medium-high | Explainable; River fits streaming/edge; unlimited synthetic training data | Risk of learning the simulator, not reality | ✅ **USE — KEEP IT CLASSICAL** |
| 6.1 | **QGIS** | 6 GIS | Free | Hours | Medium | High | Literally satisfies the PS's GIS/risk-zone clause | Desktop; static exports | ⭐ **STRONGLY RECOMMENDED** |
| 6.2 | Leaflet / Mapbox GL | 6 Viz | Free | Hours | Low-med | N/A | Live colour-changing node map — the money shot | Needs a frontend person | ✅ **YES FOR LIVE DEMO** |
| 6.3 | Twilio test creds / MailHog | 6 Alerts | Free | Minutes | Very low | Pipeline only | Test alert escalation hundreds of times, free | **Cannot simulate SIM800L failure modes** | ✅ **USE + 1 REAL SIM800L TEST** |

---

# THE RECOMMENDED STACK — what to actually do

**Tier 1 — non-negotiable, start now, no hardware needed**

1. `1.1` Python Knothe/influence-function ground truth model
2. `2.1` Python sensor noise + thermal drift model
3. `4.1` Meshtasticator (discrete-event mode first)
4. `5.1` Mosquitto MQTT as the spine
5. `3.5` PlatformIO native + unit tests

**Tier 2 — high value, start once Tier 1 runs**

6. `4.1` Meshtasticator interactive mode (real firmware, multi-node)
7. `6.1` QGIS deformation + confidence-zone maps
8. `5.4` Docker Compose for one-command demo
9. `4.5` SPLAT! terrain coverage at a named Indian coalfield
10. `6.2` Leaflet live map + `5.3` Node-RED alert chain

**Tier 3 — differentiators if time allows**

11. `1.6` InSAR / published Indian coalfield data validation
12. `1.4` RS2 FEM cross-check (one figure)
13. `6.3` One real SIM800L + SIM test

**Explicitly rejected, with the reason ready for judges**

- FLoRa / ns-3 → *they model LoRaWAN star topology; ours is a flooding mesh*
- Renode → *right architecture, but ESP32 support is partial and it has no LoRa radio model*
- OpenSees / FEniCS → *general PDE solvers, not subsidence tools; empirical influence-function is the accepted industry method*
- FLAC3D → *correct for caving mechanics, out of budget; we scope our claims to smooth trough subsidence and mark brittle-failure zones as low-confidence*

---

# TWO STRATEGIC POINTS

**1. The Meshtasticator find changes your build order.** Your report's plan had network simulation as a maybe ("or do the math by hand in a spreadsheet, which is a completely fine fallback"). With Meshtasticator's interactive mode running the actual firmware, network simulation moves from *fallback* to *your strongest demo*. Killing six nodes mid-run and showing the mesh reroute — with the real firmware, in front of judges — is far more convincing than any slide. **Promote this. Drop the spreadsheet fallback.**

**2. Every one of these tools should be framed as evidence, not tooling.** Judges do not award points for using OMNeT++. They award points for "we simulated 90 days of ground movement, injected datasheet-accurate sensor noise, ran it through our real firmware across a 30-node simulated mesh, killed the six nodes nearest the trough centre, and the system still raised the alarm in 4.2 minutes with zero false positives across 90 simulated days." **Every tool above is only there to let you say a sentence like that one.**

---

## Things to verify yourself before committing

- Rocscience student licence terms and eligibility for your institution (changes over time)
- Whether your college has a MATLAB campus licence *including* Sensor Fusion and Tracking Toolbox
- Meshtasticator's current firmware version alignment — the discrete-event sim is documented against Meshtastic 2.1
- India DLT registration requirements before claiming production SMS delivery
- Current 2G coverage at any real site you name, given ongoing 2G sunset
