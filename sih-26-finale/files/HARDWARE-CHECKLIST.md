# HARDWARE TEAM CHECKLIST — PS 26025

**Owners:** the 2 hardware members
**Why this matters more than it looks:** the problem statement's Category is **Hardware**. A node that works on the table outranks every other deliverable in the project. If time runs short, everything else gets thinned before this does.

Short plain-language notes are included so the whole team can follow, not just the two of you.

---

## 0. The one-sentence job

Build a cheap box that sits on the ground above a coal panel, feels the ground move in four different ways, and shouts the numbers over radio to a base station — on battery/solar, outdoors, for months.

---

## H1 — Node hardware definition

| # | Item | Done when |
|---|---|---|
| H1.1 | MCU chosen and justified against "readily available" (ESP32 class) | Part number fixed, price per unit confirmed from an Indian supplier |
| H1.2 | Radio module chosen — SX1262 class, **IN865 band** | Confirmed the module supports IN865, not just EU868/US915 |
| H1.3 | Complete BOM per node, with Indian prices and lead times | One spreadsheet, unit cost and 40-unit cost both stated |
| H1.4 | Scout node vs Anchor node difference documented | Written down as a firmware + power difference, not two separate designs |
| H1.5 | Confirmed: relay role is **firmware only**, same board | No third board type exists in the BOM |

---

## H2 — The four sensing modalities (all four are named in the PS — none is optional)

> Plain version: the ground can move four ways that matter. It can *lean* (tilt), it can *stretch or squash* between two points (displacement), it can *split open* (crack), and it can *shake* (vibration). Each needs its own kind of part.

### H2.1 Tilt / inclination — PS sensor 1
- [ ] Part selected, resolution stated in **degrees or mm/m**, not "high precision"
- [ ] **Thermal drift measured**, not assumed — put the node through a full day/night cycle and plot the output with no ground movement
- [ ] Drift figure compared against the expected subsidence tilt signal. If drift exceeds signal, that is a finding, not a failure — document it
- [ ] Compensation approach decided (temperature sensor + correction curve, or differential/reference node)
- [ ] Mounting rigidity: a sensor that measures the tilt of its own loose bracket measures nothing

### H2.2 Displacement / stretch — PS sensor 3, and your primary signal
- [ ] Method chosen: draw-wire/string potentiometer, linear potentiometer, or strain gauge on a rod — pick one and justify
- [ ] **Baseline distance between nodes fixed** (this is an open item in the docs — close it)
- [ ] Resolution in mm confirmed by bench test against a known displacement
- [ ] Anchoring method into ground defined — depth, material, what stops it drifting with topsoil

### H2.3 Crack detection — PS sensor 4
- [ ] Method chosen. Cheapest credible options: a conductive trace or thin wire across the expected crack line that breaks; a potentiometric crack meter; a fixed-gap capacitive or resistive sensor
- [ ] Decide: binary (cracked / not cracked) or continuous (gap width in mm). Binary is acceptable and cheap — say so deliberately
- [ ] Placement rule: where on the panel do crack sensors go, and why there

### H2.4 Vibration — PS sensor 2
- [ ] Part selected: geophone, piezo element, or a high-sample-rate accelerometer
- [ ] Sample rate and frequency band defined — blasting and ground failure sit in different bands
- [ ] **Blast signature vs subsidence signature**: state how you tell them apart. This connects directly to the DGMS blast seismograph filter and is your strongest differentiator
- [ ] On-node data reduction defined — you cannot stream raw vibration over LoRa. Decide what the node computes locally and what it sends (peak, RMS, band energy, event flag)

### H2.5 Positioning module — PS sensor 5, explicitly **optional**
- [ ] Decide in or out, with one line of reasoning. Consumer GNSS gives metre-level accuracy against a millimetre-level signal — if it is in, it is for node identity and rough geolocation for the GIS layer, not for measuring subsidence. Say that explicitly

> ⚠️ All part numbers must be verified for price and availability from an Indian supplier before being committed to. Do not commit to a part you have only seen in a datasheet.

---

## H3 — Power

> Plain version: the box must not die. There is no plug on a coal field.

- [ ] Current draw measured per node in each state: deep sleep, sensing, transmitting, receiving
- [ ] Battery sizing calculated from measured numbers, target lifetime stated in months
- [ ] **Anchor nodes cannot run on battery alone** — receive-window current draw is too high. Solar panel sized and specified
- [ ] Solar + charge controller + battery chemistry chosen; temperature range checked against Telangana summer
- [ ] Duty cycle confirmed compliant with **GSR 564(E) / IN865** rules
- [ ] Brownout behaviour defined: what the node does as the battery falls, and what it reports before it dies

---

## H4 — Radio and mesh

- [ ] SF / BW / CR fixed and recorded (baseline SF7 / BW125 / CR4-5 → **61.7 ms** airtime)
- [ ] Link budget calculated; range tested in the field, not just on the bench
- [ ] Mesh topology implemented — the PS says *mesh*, so a pure star will be read as non-compliant. State how multi-hop works
- [ ] Packet format documented **and shared with the backend team** (this is an interface — see the readiness check)
- [ ] Dedup key uses **`epoch`, not `seq`** — `seq` resets on reboot and silently overwrites valid data
- [ ] Child index within Anchor used for addressing, not Node_ID modulo 16 (the failover collision fix)
- [ ] Node-loss behaviour tested: pull the power on one node mid-run and confirm the mesh and the dashboard both handle it

---

## H5 — Enclosure and field survival

- [ ] IP rating chosen for monsoon
- [ ] UV-stable material — a box that goes brittle in one summer is not deployable
- [ ] Ground coupling method: the enclosure must move *with* the ground, not sit loosely on it. This is the single most common failure in cheap geotechnical deployments
- [ ] Anti-theft / anti-tamper consideration. Named as a risk even if unsolved
- [ ] Installation time per node measured. "Easy to deploy" is a PS requirement — you should be able to say "one person, X minutes, no tools beyond Y"

---

## H6 — Calibration and evidence

> Plain version: a number nobody has checked against a ruler is a rumour.

- [ ] Each sensor bench-tested against a known physical reference; error figures recorded
- [ ] Noise floor measured for each modality, with the node completely still
- [ ] Calibration procedure written down so a second person can repeat it
- [ ] **Sensor spec sheet handed to Adarsh** — range, resolution, noise, drift, sample rate, per modality. The simulator's sensor models must match the real parts or the simulation is fiction

---

## H7 — Demo deliverables

- [ ] At least one node fully working, powered, transmitting, on the table
- [ ] Preferably three nodes: proves mesh multi-hop rather than point-to-point
- [ ] A physical way to make the ground "move" on the table — a tilting board, a screw jack, a movable block — so a judge can cause a reading and see it reach the dashboard
- [ ] Cost card: printed per-node cost and per-panel cost, ready to hand over
- [ ] One-line answer ready: "why this is low cost and why it can scale"

---

## H8 — Compliance

- [ ] GSR 564(E) / IN865 — band, power, duty cycle
- [ ] DGMS Circular 7/1997 referenced correctly for blast seismograph logs
- [ ] No ETSI or FCC references anywhere in the hardware documentation

---

## The four things most likely to go wrong

1. **Tilt drift swamps the signal.** Measure it in week one, not week three.
2. **Vibration data volume vs LoRa bandwidth.** Decide on-node reduction early; retrofitting it is painful.
3. **Ground coupling.** A perfectly calibrated sensor in a box that moves independently of the soil produces confident nonsense.
4. **The sensor spec never reaches the simulator.** Then Adarsh's models drift away from the real parts and nobody notices until integration.
