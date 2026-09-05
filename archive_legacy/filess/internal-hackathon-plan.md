# Mine Subsidence Early-Warning System
## Internal Hackathon — Planning Document

**Stage:** planning only. Nothing here is a build instruction.
**Timeline:** 7 calendar days until the internal round.
**Deployment for internal round:** 100% simulated. Zero physical hardware.

---

# PART 1 — THE FLOW

## 1.1 The one-sentence version

We build a fake mine on a computer, let fake ground sink in a mathematically correct way, let fake sensors watch it and lie about it the way real sensors lie, send those lies through a fake radio network, and then prove our software can still tell the truth from the lies — and warn somebody in time.

## 1.2 The flow, stage by stage

```
STAGE 1   THE GROUND
          A mine panel is being dug out underground.
          The ground above it starts to sag into a bowl shape.
          We calculate that bowl with an equation. No randomness. Pure physics.
                              |
                              v
STAGE 2   THE SCENARIO
          We choose what "today" looks like:
             - a normal quiet day
             - a slow subsidence developing over 40 days
             - a legal blast at 14:30
             - a truck driving past node 12
             - six nodes near the trough centre getting crushed
          These are pre-written buttons, not random events.
                              |
                              v
STAGE 3   THE SENSORS
          30-40 nodes sit on a map above the panel.
          Each node "measures" the ground beneath it.
          But we do NOT hand it the true value.
          We first ruin the value the exact way a real chip would:
          heat drift, electrical noise, battery sag, blast spikes.
                              |
                              v
STAGE 4   THE RADIO
          Each node tries to send its reading to the gateway.
          Some packets are lost. Some take 3 hops. Some arrive late.
          Dead nodes send nothing at all.
                              |
                              v
STAGE 5   THE BRAIN — PART A (CLASSICAL)
          The backend receives whatever survived.
             - throws out spikes
             - cancels out shared heat drift
             - checks the blast log
             - tries to fit a bowl shape across neighbours
             - if the bowl fits: raise an alarm level
             - project forward: "reaches danger in ~6 days"
                              |
                              v
STAGE 6   THE BRAIN — PART B (THE PINN)
          We only have 30 dots. A map needs a full surface.
          The PINN takes the 30 noisy dots and reconstructs
          the entire continuous ground surface between them,
          including where the dead nodes used to be.
                              |
                              v
STAGE 7   THE FRONTEND
          A map with the panel outline, coloured nodes,
          the reconstructed sinking surface as a heat overlay,
          the alarm banner, and a plain-English reason.
                              |
                              v
STAGE 8   THE ALERT
          Siren fires -> SMS goes out -> email/app.
          (Simulated for the internal round — shown as a log panel.)
```

## 1.3 The two websites

| | **Website 1 — The Simulation Console** | **Website 2 — The Operator Dashboard** |
|---|---|---|
| Who it's for | Us, and the judges, to *drive* the demo | The mine safety officer |
| What's on it | Scenario buttons, speed slider, "kill node" button, node count, raw data stream | Map, nodes, alarm banner, explanation, alert log |
| What it represents | The mine itself + the physical world | The product |
| Honest framing to a judge | "This side is standing in for reality" | "This side is the actual deliverable" |

**Why two sites and not one:** because it makes the demo honest. We are not hiding the simulator inside the product. We are showing the judge exactly where reality ends and our system begins. A team that hides its simulator looks like it's faking. A team that puts the simulator on its own screen looks like it's testing.

## 1.4 The critical rule that makes this whole thing work

> **The Operator Dashboard must not know the simulator exists.**

Website 2 receives data from a pipe. It never asks who is filling the pipe. Today it's Website 1. Later it's a real Raspberry Pi with real LoRa nodes. Swapping them changes **zero lines** of dashboard or detection code.

This single rule is what turns "we made a simulation" into "we made a system, and tested it with a simulation." Those sound similar and are worth completely different scores.

---

# PART 2 — THE FEATURES

Each feature below has a **technical** description and then a **non-technical** description in ordinary words.

---

## GROUP A — THE SIMULATED WORLD (Website 1)

### A1. Ground physics engine
**Technical:** Knothe influence-function model over a rectangular longwall panel, producing subsidence `S(x,y,t)` on a grid, with tilt, curvature and horizontal strain derived analytically as first and second spatial derivatives. Time development via the Knothe time function.

**Non-technical:** A calculator that answers one question: *"if we dig out this rectangle underground, how much has the ground above sunk at any spot, on any day?"* Everything else in the project is downstream of this one calculator.

---

### A2. Scenario library
**Technical:** Parameterised, deterministic, replayable event definitions layered onto the ground truth timeline.

**Non-technical:** Pre-written "scripts" for what happens. Instead of hoping something interesting happens during the demo, we press a button and it happens. Six scripts: *Quiet Week*, *Slow Sag*, *Legal Blast*, *Truck Convoy*, *Cluster Collapse*, *Everything At Once*.

**Why this matters more than it looks:** a live demo where you can't control what happens is a live demo that can fail on stage. Scenario buttons mean you decide what the judge sees, and you can show off the hard cases on purpose.

---

### A3. Sensor lying engine
**Technical:** Per-sensor transduction and error models converting true physical quantities into raw register counts, injecting thermal drift, bias instability, white noise, quantisation, battery-induced reference drift, and event transients.

**Non-technical:** This is the most important feature in the entire project and it is easy to underrate.

Anyone can make a program that says "the ground sank 60mm, so the sensor reads 60mm." That proves nothing. A real sensor **never** reads the true value. It reads the true value plus heat error plus electrical fuzz plus battery drift plus whatever the truck outside did.

So this feature deliberately takes the true, perfect number and **damages it on purpose**, in exactly the ways the real chip's datasheet says it gets damaged. Then we hand the damaged number to our detection software and see if it can still find the truth.

**The sentence this earns you:** *"we didn't test our detector on clean data — we injected datasheet-accurate sensor error and it still worked."*

---

### A4. Radio and mesh model
**Technical:** Log-distance path-loss with log-normal shadowing, per-link packet delivery ratio, multi-hop routing, latency distribution, IN865 duty-cycle constraint under alarm cascade.

**Non-technical:** Nodes talk by radio, and radio is unreliable. Messages get lost, arrive late, or take a long route through three other nodes to get home. This models that. It also models the ugly moment when *all* the nodes panic at once and try to shout simultaneously — which is exactly when Indian radio law limits how often each one may transmit.

---

### A5. Node kill switch
**Technical:** Runtime node-state override with correlated spatial failure modes and last-gasp packet emission.

**Non-technical:** A button that destroys nodes on the map. Not one random node — a whole cluster of neighbours at once, because that's what a real collapse does. This is the demo moment: kill the six sensors closest to the danger, and show the alarm still gets out.

---

## GROUP B — THE BRAIN (Backend)

### B1. Signal cleaning
**Technical:** Hampel filter for outlier rejection, notch filter at machinery fundamental frequency, temperature compensation via the onboard thermometer.

**Non-technical:** Three cleanup jobs, in order:
- **Spike removal** — a reading that jumps wildly for one instant and comes straight back is a bump, not a landslide. Delete it.
- **Hum removal** — a conveyor motor makes one steady note forever, like a fridge. Mute that one note, leave everything else alone.
- **Heat correction** — the chip tells us its own temperature, so we subtract the amount of "fake tilt" that temperature is known to cause.

---

### B2. Neighbourhood common-mode rejection
**Technical:** Subtract the spatial mean of the surrounding node cluster from each node's reading before evaluating.

**Non-technical:** If *every* sensor in the area appears to tilt the same way at the same time, that is the sun heating all of them equally — not the ground moving. Real subsidence makes nearby sensors disagree with each other in a specific pattern. So we stop looking at what sensors say, and start looking at **how they differ from their neighbours.**

**Analogy:** in a room where everyone's watch is 5 minutes fast, don't ask "what time is it?" — ask "whose watch disagrees with everyone else's?"

---

### B3. Bowl-shape correlation — *the core detector*
**Technical:** Least-squares fit of the observed node deformation field against the theoretical Knothe trough profile; goodness-of-fit R² gates alarm escalation.

**Non-technical:** Real subsidence has a signature shape. It's a bowl — deepest in the middle, tapering off at the edges, smooth and symmetric. Nothing else on a mine site makes that shape across many sensors at once.

So the detector doesn't ask *"is this sensor reading high?"* It asks *"do these fifteen sensors together look like a bowl?"* and scores how good the bowl is out of 100. Below 70, ignore it. Above 90, that's subsidence.

**Analogy:** you can't tell a rainstorm from a leaky pipe by looking at one wet patch. But if the wet patches across the whole floor form a circle with the middle deepest, you know it came from above.

---

### B4. Blast-log cross-check — *our biggest differentiator*
**Technical:** Temporal correlation of detected vibration events against DGMS Circular 7/1997 mandated blast records; matched events are flagged and suppressed.

**Non-technical:** Indian coal mines are *legally required* to record every blast they set off, with the exact time. That file already exists at every mine in the country.

So when our system feels a shake, before panicking it checks: *"was there a legal blast logged at 14:30?"* If yes — that was them, ignore it.

This costs us nothing, uses equipment the mine already owns and already pays for, and directly attacks the number-one reason these systems fail in the real world: too many false alarms, until the safety officer switches the thing off.

---

### B5. Progression projection
**Technical:** Fit live readings to the Knothe time function and extrapolate forward to the next severity threshold crossing.

**Non-technical:** Instead of saying "this is a Level 2 alarm," say **"at the current rate, this reaches Level 3 in about 6 days."**

The difference is the difference between a smoke detector and a weather forecast. One tells you it's already happening. The other tells you when to act.

---

### B6. The PINN — field reconstruction and sensor fusion
**Technical:** A small neural network `f(x,y,t) → S`, trained with a composite loss: data mismatch on tilt (low weight), strain (high weight) and extensometer (high weight), plus a physics residual enforcing the Knothe time ODE. Automatic differentiation supplies tilt and strain from the network's own derivatives. Outputs a continuous field plus inferred rock parameters.

**Non-technical:** Here is the problem it solves.

We have 30 dots on a map. The problem statement asks for a **deformation map**. You cannot draw a map from 30 dots — you need the surface in between. And when a cluster of nodes dies, you need to fill in what they *would* have said.

So the network's job is: *"given 30 noisy dots, draw me the smooth surface that fits all of them — but only draw surfaces that obey the laws of mining physics."*

**Analogy:** imagine 30 people scattered around a dark field, each shouting a rough guess of how deep the ground is beneath them. Some are lying because they're cold. Some have gone silent. Your job is to draw the shape of the whole field.

A plain neural network would draw *any* surface that fits the shouts — including physically impossible ones with spikes and cliffs. The PINN is told an extra rule: **"whatever you draw must also be a shape the ground could actually make."** That rule throws out almost every wrong answer, which is why it works with so little data.

**The part that makes it legitimate rather than circular:** the tilt, strain and extensometer sensors are all *different views of the same one surface*. Tilt is the surface's slope. Strain is its curvature. Extensometer is its stretch. The PINN is forced to find one single surface that explains all three simultaneously. No individual sensor observes that surface. That is genuine multi-sensor fusion, not a classifier.

**It never decides alarms.** Alarms come from B3 and B4, which are explainable to a safety officer. The PINN only draws.

---

### B7. Classical interpolation fallback
**Technical:** Gaussian Process regression / RBF interpolation over the node field, exposing identical output schema to B6.

**Non-technical:** The safety net. It does a rougher version of the PINN's job in a couple of hours of work, and produces output in exactly the same shape — so the frontend cannot tell which one is running.

If the PINN is not converging by mid-week, flip a config flag. Nothing else breaks. Bonus: this method hands us uncertainty ranges for free, which feeds the confidence map.

---

### B8. Plain-language explanation generator
**Technical:** Template-driven natural-language synthesis of the alarm decision path, emitted as a field on the alarm event.

**Non-technical:** Every alarm carries a sentence a human can read:

> *"7 adjacent nodes show a bowl-shaped strain increase over 38 hours. No blast was logged in this window. Tilt agrees as a secondary check. Projected to reach Level 3 in 6.2 days."*

A safety officer who understands *why* the alarm fired will trust the system. One who gets a red light with no reason will eventually switch it off. This is a two-day feature that addresses the documented number-one cause of these systems failing in real deployments.

---

## GROUP C — THE FACE (Frontend)

### C1. Map with live nodes
Panel outline, node dots that change colour by state (green / amber / red / grey-dead).

### C2. Deformation heat overlay
The PINN's reconstructed surface drawn as a colour wash over the map. This is the picture that makes the whole project look finished.

### C3. Alarm banner + explanation panel
Level, affected nodes, the B8 sentence, and the projection.

### C4. Confidence zoning overlay
**Non-technical:** A shaded area on the map meaning *"in this zone the rock is brittle and can fail with almost no warning — we do not claim to catch that."*

Admitting where your system fails, on screen, unprompted, is the single most trust-building thing a safety product can do. It reads as maturity, not weakness.

### C5. Alert delivery log
A panel showing siren → SMS → email firing in sequence, with timestamps. Simulated for now, clearly labelled as such.

---

## GROUP D — CUT FOR THE INTERNAL ROUND

All physical hardware: ESP32 nodes, MPU9250, ADS1115, strain bridges, wire extensometer, thermal calibration rig, enclosures, solar, Raspberry Pi gateway, SIM800L, siren, real LoRa.

**How to present this:** one roadmap slide. *"Phase 2 is a 3-node physical prototype, costed at ₹8,000, with the bill of materials already sourced. The simulation validates the 30-node deployment that the prototype scales toward."*

Do not apologise for this. Building hardware in 7 days for a round that doesn't require it is how teams lose.

---

# PART 3 — HOW THE MATHS ACTUALLY WORKS

## 3.1 The one idea that collapses the whole problem

Most teams would build a separate generator for each sensor. That's wrong, and it will silently break your project.

**There is one surface. Every sensor is a different question asked about that same surface.**

Picture a flat bedsheet held tight. Now push down from underneath with your fist. The sheet forms a dip.

| Sensor | The question it asks about the sheet |
|---|---|
| Displacement | *How far down has this point moved?* |
| Tilt | *How steep is the sheet here?* |
| Strain | *How sharply is the sheet curving here?* |
| Extensometer | *How much further apart are these two points now?* |

You do not need four models of the bedsheet. You need **one** bedsheet, and then you ask it four questions.

In maths, those four questions are: the value, the first derivative, the second derivative, and the integral.

```
        S           = how deep      (displacement)
      dS/dx         = how steep     (tilt)
     d²S/dx²        = how curved    (strain)
    ∫ strain dx     = how stretched (extensometer)
```

**If you build these as four separate generators they will disagree with each other, your detector will look like it works, and it will be detecting your own bug.**

---

## 3.2 Where the bowl shape comes from

**The equation:** the Knothe influence function.

**The intuition:** imagine the underground panel is divided into thousands of tiny squares. When you remove one tiny square of coal, the ground directly above it sinks a lot, and the ground slightly to the side sinks a little less, and further out less again — spreading out in a soft bell shape.

Now do that for every tiny square you removed, and **add all the bell shapes together.** Where lots of bells overlap (the middle of the panel), you get deep sinking. At the edges, only a few overlap, so it tapers off. The result is the bowl.

**Analogy:** drop a hundred stones into sand in a rectangle. Each stone makes a small dent. Where the dents overlap, you get a big hollow. The shape of the hollow is the sum of all the small dents.

**One number matters most:** the **influence radius**, `r = H / tanβ`, where `H` is how deep the mine is. Deeper mine → wider, gentler, shallower bowl. Shallow mine → narrow, sharp, deep bowl. That single number decides whether your sensors are close enough together to see anything at all.

---

## 3.3 Where the *time* comes from

Ground doesn't sink instantly. It sinks fast at first, then slower and slower, approaching a final value it never quite reaches.

**The equation:** `S(t) = S_max × (1 − e^(−ct))`

**Analogy:** a cup of hot tea cooling in a room. It loses heat fast in the first minutes, then slower, then barely at all as it approaches room temperature. The ground does exactly this — it "cools" toward its final sunk position.

**Worked example.** Say final subsidence is 800mm and `c` gives a 30-day time constant:

| Day | Sunk so far | What we'd see |
|---|---|---|
| 5 | ~120 mm | Barely detectable |
| 15 | ~315 mm | Clearly a trend |
| 30 | ~505 mm | Alarm territory |
| 60 | ~690 mm | Approaching final |
| 90 | ~760 mm | Nearly settled |

**This same equation is what gives you "6 days to Level 3."** You fit the curve to the readings you have, then read forward off the curve. You are not predicting the future with AI. You are fitting a known physical curve and extending the line — which is far more defensible.

---

## 3.4 How we make the sensor lie

Take one node. On day 45 the true tilt is **310 microradians** (about 0.018 degrees — genuinely tiny).

Now we ruin it, step by step:

| Step | What happens | Running value |
|---|---|---|
| True physics | The ground really did tilt this much | 310 µrad |
| **+ Heat drift** | It's an Indian afternoon. The chip is at 48°C. Its internals expand and it reports tilt that isn't there | ~13,000 µrad of fake tilt |
| + Random jitter | Electronic fuzz, different every reading | ±200 µrad |
| + Battery sag | The battery weakened; the "ruler" it measures against stretched | +150 µrad |
| + Quantisation | The chip can only report whole steps, so it rounds | ±40 µrad |
| **What we hand the detector** | | ~13,700 µrad |

**Look at that heat number.** The fake tilt from sunshine is roughly **forty times bigger** than the real subsidence signal.

**This is the single most important number in your entire project.** It is the numerical proof of why you demoted tilt from primary sensor to secondary vote — and you have it *measured from a model*, not asserted from an opinion.

**Analogy:** you're trying to hear someone whisper across a room while a vacuum cleaner runs beside your ear. The whisper is real. It's just hopeless to rely on it alone.

**Which is exactly why strain sensors are your primary.** Strain measures curvature, not slope, and it does not suffer this problem at anything like the same scale.

---

## 3.5 How we cancel the lie

Two tricks, layered.

**Trick 1 — ask the chip its own temperature.**
The chip has a built-in thermometer. The datasheet tells us how much fake tilt each degree causes. So: `corrected = raw − (drift_coefficient × temperature_change)`. That removes most of it.

**Trick 2 — compare against neighbours.**
The sun heats every node in the area roughly equally. So if all 30 nodes suddenly "tilt" the same way at 2pm, that's the sun, not the ground.

**Analogy:** three friends all say the concert was too loud. Either the concert was loud, or all three have the same broken ear. But if *one* friend disagrees with the other two — now that's information.

Real subsidence makes nearby nodes disagree in a specific, bowl-shaped pattern. Heat makes them all agree. **Agreement is noise. Structured disagreement is signal.** That's the whole trick.

---

## 3.6 How we separate a blast from a collapse

Four things shake the ground. Each has a completely different mathematical fingerprint:

| Source | Fingerprint | Analogy |
|---|---|---|
| **Legal blast** | One huge spike, decaying away in under a second, at a time written in the mine's own log | A door slamming |
| **Truck** | Medium shake, builds and fades over a few seconds, only near 1–2 nodes | Someone walking past |
| **Conveyor motor** | One steady note, same frequency, forever | A fridge humming |
| **Rock cracking** | Random small crackles at unpredictable times | Ice cracking in a drink |

You don't need clever AI to tell these apart. You need: a clock (blast log), a map (how many nodes felt it), and a frequency filter (is it one steady note?). That's it.

**And blasts get an extra, free advantage:** the blast log tells you the answer before you even look at the data. That's the differentiator.

---

## 3.7 How the PINN learns without much data

**The problem:** a normal neural network needs thousands of examples. We have 30 dots.

**The insight:** a normal network is allowed to draw *any* shape that passes through the dots — including physically insane ones with spikes and cliffs. Most of what it's "learning" is ruling those out, and that's what needs all the data.

**The fix:** tell it the physics rule up front. *"Whatever surface you draw must also satisfy the ground-sinking equation."*

**Analogy.** Someone gives you 5 dots on graph paper and says "draw the line."

- Without a rule, infinite squiggles pass through all 5 dots. You'd need hundreds more dots to pin down the right one.
- Now they say *"it must be a straight line."* Suddenly **two dots are enough**, and the other three just make you more confident.

The physics rule is that constraint. It shrinks the space of possible answers from "anything" to "physically plausible things," and 30 noisy dots is plenty to pick the right one out of that much smaller set.

**Second analogy, for the fusion part.** Three witnesses describe a robber. One saw height, one saw the jacket, one saw the walk. None saw the whole person. The PINN's job is to construct the **one person** consistent with all three descriptions at once — not to pick the most reliable witness.

Tilt, strain and extensometer are those three witnesses. The surface is the person.

---

# PART 4 — WHAT'S UNIQUE, AND AGAINST WHOM

## 4.1 The competitive field, honestly

This problem is not unsolved. Pretending otherwise gets destroyed in Q&A. Here's who actually does this today.

### Competitor 1 — Satellite radar (InSAR)

**What it is:** satellites bounce radar off the ground repeatedly and measure how the return changes to detect millimetre-scale sinking.

**Its real record in India:** it works, and it's been done on your exact target sites. <cite index="13-1">Studies of the Raniganj coalfield — India's oldest coal mine — using Sentinel-1 InSAR data from 2017 to 2023 recorded a maximum subsidence rate of about 21 mm per year</cite>, and Jharia coalfield has been mapped the same way. Assume a judge knows this.

**Where it genuinely beats you:** coverage. It monitors entire coalfields for free. You'd need thousands of nodes to match that footprint.

**Where it cannot compete — and this is your opening:**
- **Speed.** <cite index="9-1">Sentinel-1 revisits the same spot roughly every 12 days.</cite> <cite index="11-1">That fixed revisit period makes high temporal resolution hard to achieve, which limits dynamic subsidence prediction.</cite> Your network samples continuously. A collapse developing over 48 hours is invisible to a 12-day satellite and obvious to you.
- **Vegetation.** Radar needs stable reflecting surfaces. Forest and farmland — the exact terrain above Indian coal panels — scatter the signal and degrade the measurement.
- **It's history, not warning.** InSAR tells you what happened over the last fortnight. It cannot fire a siren.

**Your one-line answer:** *"InSAR is the right tool for surveying a coalfield. It is the wrong tool for warning a village. Twelve-day revisit is not an early-warning system."*

---

### Competitor 2 — Commercial wireless geotechnical monitoring

Companies like Worldsensing and Senceive sell exactly this category of product. <cite index="1-1">Worldsensing's GNSS Meter is a wireless sensor targeting millimetric precision for slope stability, subsidence and structural movement, aimed at mining and construction, with integrated tiltmeter and environmental sensors</cite> and <cite index="1-1">quoted accuracy around 2mm horizontal and 3mm vertical over a 24-hour aggregate</cite>. <cite index="8-1">Senceive markets itself as the world's most widely used wireless remote monitoring solution for near real-time alerts on landslips and embankment failures.</cite>

**Where they beat you:** accuracy, ruggedness, decade-long battery life, actual field deployments, certification. Do not claim to beat them technically. You will lose.

**Where you compete:**
- **Cost per point.** Their equipment runs into lakhs per installation. Yours is ₹1,850–3,650 per node. For a mine that needs 100 monitoring points across a panel, that gap decides whether monitoring happens at all.
- **Their accuracy is achieved by making each sensor excellent. Yours is achieved by making sensors cheap enough to have many of them, and letting the maths recover accuracy from the crowd.** That is a genuinely different engineering philosophy, not a worse version of theirs.
- **None of them use the mine's blast log.** They are built as general geotechnical products, sold across rail, construction and mining. They are not India-coal-specific, so they have no reason to integrate a DGMS-mandated data source that only exists in Indian mines.

**Your one-line answer:** *"They sell a better sensor. We sell a better network. At a hundred points, the network wins."*

---

### Competitor 3 — Manual survey (the real incumbent)

Levelling surveys, total stations, a surveyor with instruments walking the panel monthly.

**This is what most Indian mines actually do**, and it's the thing you're really replacing. Accurate, trusted, and completely blind between visits. A collapse developing over three days between monthly surveys is simply not seen.

---

## 4.2 So what is genuinely ours

Ranked. The first three are real. The rest are supporting.

### #1 — Blast-log reuse as a false-positive filter
Every Indian coal mine is already legally required, under DGMS Circular 7/1997, to run blast-vibration monitoring. That data exists, is timestamped, and nobody in this space is using it as a detection input.

It simultaneously **reduces hardware cost** (you don't need to solve vibration classification from scratch) and **attacks the documented primary failure mode** of deployed warning systems (false-alarm fatigue leading to the system being switched off).

Cost to implement: reading a file. That asymmetry — near-zero cost, high impact, regulation-grounded — is what makes it the best idea in the project.

### #2 — Measured sensor demotion
Most teams will list a tilt sensor as their primary detector because it's the obvious choice. You modelled it, found thermal drift dwarfs the real signal by a large factor, and **demoted it** — promoting strain instead.

Judges see confident claims all day. They almost never see a team say *"we checked our own assumption and it was wrong, so we changed the design."* That is the mark of engineering rather than assembly.

### #3 — Correlated-failure-aware design
The standard mesh story is *"if one node dies, we route around it."* That's the easy case and every team will say it.

The honest case: real collapse destroys a **cluster** of adjacent nodes simultaneously — precisely the neighbours your common-mode rejection depends on, precisely when you need them. Your answer is the ring-fallback (compare against the next ring outward) and PINN reconstruction of the missing region.

Being the team that noticed the hard version of the failure is worth more than being the team with the prettiest dashboard.

### #4 — Physics-constrained multi-sensor fusion
One surface, three sensor types, enforced consistency. Not an off-the-shelf classifier.

### #5 — Progression, not just severity
*"6 days to Level 3"*, from a fitted physical curve, not a guess.

### #6 — Published uncertainty
The confidence-zoning overlay that shows where the system does **not** work.

---

## 4.3 The positioning statement

> **InSAR watches the whole coalfield every twelve days. Commercial sensors watch one point beautifully for a lakh. We watch one panel continuously, at a hundred points, for the price of one of theirs — and we're the only ones using the mine's own legally-mandated blast records to stop crying wolf.**

That is a claim no other team on this problem statement can make, because it comes from the specific decisions you made, not from the problem statement's title.

---

# PART 5 — HIGH-LEVEL DESIGN

## 5.1 The whole system on one page

```
╔══════════════════════════════════════════════════════════════════╗
║  WEBSITE 1 — SIMULATION CONSOLE            "standing in for       ║
║                                             the real world"       ║
║   ┌──────────────────────────────────────────────────────────┐   ║
║   │ GROUND MODEL     one bowl-shaped surface, evolving        │   ║
║   │                  in time (Knothe)                         │   ║
║   └──────────────────────────┬───────────────────────────────┘   ║
║                              v                                   ║
║   ┌──────────────────────────────────────────────────────────┐   ║
║   │ SENSOR MODEL     ask the surface 4 questions per node,    │   ║
║   │                  then damage every answer realistically   │   ║
║   └──────────────────────────┬───────────────────────────────┘   ║
║                              v                                   ║
║   ┌──────────────────────────────────────────────────────────┐   ║
║   │ RADIO MODEL      lose packets, add hops, add delay,       │   ║
║   │                  silence dead nodes                       │   ║
║   └──────────────────────────┬───────────────────────────────┘   ║
║                              │                                   ║
║   CONTROLS: [scenario] [speed] [kill nodes] [inject blast]       ║
╚══════════════════════════════╪═══════════════════════════════════╝
                               │
                    ═══════════▼═══════════
                      T H E   S E A M
                    (message pipe / MQTT)
              nothing below knows what's above
                    ═══════════▼═══════════
                               │
╔══════════════════════════════╪═══════════════════════════════════╗
║  BACKEND — THE BRAIN                        "the product"         ║
║                              v                                   ║
║   ┌──────────────────────────────────────────────────────────┐   ║
║   │ STORE            save every reading locally, flagged      │   ║
║   │                  unsent until uploaded  (= offline sync)  │   ║
║   └──────────────────────────┬───────────────────────────────┘   ║
║                              v                                   ║
║   ┌──────────────────────────────────────────────────────────┐   ║
║   │ CLEAN            kill spikes · mute hum · fix heat        │   ║
║   └──────────────────────────┬───────────────────────────────┘   ║
║                              v                                   ║
║   ┌──────────────────────────────────────────────────────────┐   ║
║   │ COMPARE          subtract the neighbourhood average       │   ║
║   └──────────────────────────┬───────────────────────────────┘   ║
║                              v                                   ║
║        ┌─────────────────────┴─────────────────────┐             ║
║        v                                           v             ║
║   ┌─────────────────────────┐        ┌────────────────────────┐  ║
║   │ DECIDE  (classical)     │        │ DRAW  (PINN / GP)      │  ║
║   │                         │        │                        │  ║
║   │ · fit the bowl → R²     │        │ · 30 dots in           │  ║
║   │ · check blast log       │        │ · full surface out     │  ║
║   │ · tilt = secondary vote │        │ · dead nodes filled    │  ║
║   │ · project days-to-next  │        │ · rock params inferred │  ║
║   │                         │        │                        │  ║
║   │ ► OWNS THE ALARM        │        │ ► NEVER DECIDES        │  ║
║   └───────────┬─────────────┘        └───────────┬────────────┘  ║
║               │                                  │               ║
║               └──────────────┬───────────────────┘               ║
║                              v                                   ║
║   ┌──────────────────────────────────────────────────────────┐   ║
║   │ EXPLAIN          write the alarm reason in plain English  │   ║
║   └──────────────────────────┬───────────────────────────────┘   ║
╚══════════════════════════════╪═══════════════════════════════════╝
                               │
        ┌──────────────────────┴──────────────────────┐
        v                                             v
╔═══════════════════════════════╗    ╔═══════════════════════════╗
║ WEBSITE 2 — OPERATOR DASHBOARD║    ║ ALERT CHAIN               ║
║                               ║    ║                           ║
║  · panel outline on map       ║    ║  1. siren    (no network) ║
║  · nodes coloured by state    ║    ║  2. SMS      (cell only)  ║
║  · deformation heat overlay   ║    ║  3. email/app(internet)   ║
║  · alarm banner + reason      ║    ║                           ║
║  · confidence zones           ║    ║  each layer needs less    ║
║  · alert log                  ║    ║  than the one before      ║
╚═══════════════════════════════╝    ╚═══════════════════════════╝
```

## 5.2 The three design rules

**Rule 1 — One surface, four questions.**
Never build separate models for tilt, strain and displacement. Build one ground surface and derive the rest. Breaking this rule causes silent, undetectable bugs.

**Rule 2 — The seam is sacred.**
Nothing below the seam may know whether the data came from the simulator or from real hardware. This is what makes the simulation a *test harness* rather than a *fake*, and it's what makes the eventual hardware swap an afternoon instead of a rebuild.

**Rule 3 — The AI draws; the physics decides.**
The PINN never raises an alarm. Alarms come from bowl-fitting and the blast log, both of which can be explained to a mine safety officer in one sentence. A safety system whose decisions cannot be explained will not be trusted, and an untrusted safety system gets switched off.

## 5.3 What "done" looks like for the internal round

A judge sits down. You press *Slow Sag* on Website 1. Website 2 shows nodes gradually turning amber and a bowl forming in the heat overlay. You press *Inject Blast* — a spike appears in the raw data, and the dashboard **does not** alarm, and the explanation panel says why. You press *Kill Cluster* — six nodes grey out, the reconstruction fills the hole, and the alarm still fires with a projection of days remaining.

That is the demo. Everything in this document exists so that those ninety seconds are true.
