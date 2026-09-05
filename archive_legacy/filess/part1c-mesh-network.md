# Part 1C — The Mesh Network: Node Count, Cadence, and Surviving Failure (v1)

**Scope.** How many nodes, arranged how, talking how often, over what radio, and what happens
when pieces of it die. This is Layer 4 of the generator (`sim/C4 mesh radio`) and simultaneously
the deployment plan for real hardware. No ground physics (that is `part1-maths-spec.md`), no file
schemas beyond what changes (that is `part1-data-and-files-v3.md`), no PINN.

**One sentence:** the network runs three planes over one radio — slow bulk telemetry at 60 s, a
cluster escalation mode at 15–20 s, and an 8-byte alarm plane that reaches the gateway in under a
second — and every one of the 31 nodes is derived from the trough geometry, not guessed.

**Why this document exists.** The 10-minute cadence in v3 was chosen defensively, from an airtime
figure that was correct but attached to the wrong architecture. Re-derived below, the current
design is over budget at 10 minutes and the corrected design is under budget at 60 seconds. That
inversion is worth a slide on its own.

---

## 0. The three-plane idea, before anything else

Read this section and you can stop. Everything after it is proof.

"How fast is the system" is not one number. It is three, and they cost wildly different amounts.

| Plane | What moves | Who talks | Cadence | Airtime cost | Gateway latency |
|---|---|---|---|---|---|
| **P1 Routine** | full 21-byte telemetry, all nodes | everyone | **60 s** | 0.57% duty (worst node) | ~5 s |
| **P2 Escalation** | same telemetry, faster, ShortFast preset | one cluster (5–6 nodes) | **15–20 s** | 0.53% duty | ~2 s |
| **P3 Event** | 8-byte alert: node, epoch, channel, magnitude | the tripping node, flooded | **immediate** | 0.21% duty at 20 alerts/hr | **<1 s** |

**The insight.** Nobody is harmed because a tilt reading arrived nine minutes late. They are
harmed because an *alarm* arrived nine minutes late. Those are different payloads with different
sizes and different urgencies, and the previous design forced them to share one cadence — which
meant the expensive one set the price for the cheap one.

An 8-byte alert at ShortFast is **35 ms of airtime**. A full telemetry packet at LongFast is
**518 ms**. The alarm is fifteen times cheaper than the thing that was throttling it.

**Analogy.** A hospital ward. The routine plane is the nurse writing every patient's vitals on a
chart once an hour — thorough, slow, nobody sprints. The event plane is the crash button on the
wall: one bit of information, no detail, instantly everywhere. You do not make the ward safer by
asking the nurse to write charts every minute. You make it safer by putting in a crash button.
The old design had no crash button, so it kept arguing about how fast the nurse could write.

**The headline claim this buys you:** *routine telemetry 10× faster than the baseline, alarm path
600× faster, and the whole thing sits inside India's 1% legal duty cycle with room to spare.*

**And it is the same argument as your DGMS differentiator.** A fast alarm plane is only useful if
it does not cry wolf. The thing that stops it crying wolf is the blast log cross-check. You can
afford a sub-second alarm plane *because* you already have legally-mandated blast records to veto
it against. Speed and the blast log are one story, not two.

---

## 1. Radio physics you actually need — ELI5 first

Skip if you already know LoRa. Four ideas, no maths.

**1. Spreading factor is how slowly you speak.** LoRa lets you trade speed for range. SF7 is
talking normally — fast, but the listener must be close. SF12 is shouting one syllable at a time —
painfully slow, but audible from far away. Every step up (SF7→SF8→…) roughly *doubles* how long a
message takes to send, and buys about 2.5 dB of range.

**2. Airtime is the only currency.** The radio is one shared room. Only one node can speak at a
time. "Airtime" is how many seconds of the room a message occupies. Everything in this document
is an argument about who gets to speak and for how long.

**3. Duty cycle is the law.** India's licence-free LoRa band is 865–867 MHz, capped at 1 W ERP and
a **1% duty cycle** — each transmitter may occupy the air for at most 36 seconds in any hour. This
is not a guideline you can engineer around. It is the hard ceiling, and it binds before the
physics does.

**4. Flooding is expensive.** Meshtastic's default routing is *managed flood*: when a node hears a
message it has not seen, it repeats it. That makes the network self-healing with zero
configuration — and it means one message sent costs you a dozen transmissions. Great for hikers.
Ruinous for 31 nodes on a schedule.

**Analogy for flooding.** Thirty-one people in a field. One shouts "node 17 tilt is 42." Everyone
who heard it shouts it again so the far side hears. Then everyone who heard *that* shouts it
again. One sentence, thirty shouts. Now have all thirty-one people do that at once, every minute.

### 1.1 The airtime table

Computed from the standard LoRa airtime formula: coding rate 4/5, 16 preamble symbols, explicit
header, CRC on, low-data-rate optimise auto. Payload sizes are **on-air bytes** = Meshtastic
header (~16 B) + application payload.

| Meshtastic preset | 24 B (alert) | 37 B (one node's telemetry) | 121 B (aggregated ×4) |
|---|---|---|---|
| LongSlow (SF12/125) | 1745 ms | 2236 ms | 5022 ms |
| **LongFast (SF11/250)** — *current default* | 436 ms | **518 ms** | 1133 ms |
| MediumSlow (SF10/250) | 218 ms | 280 ms | 628 ms |
| **MediumFast (SF9/250)** — *proposed routine* | 119 ms | **150 ms** | **345 ms** |
| ShortSlow (SF8/250) | 65 ms | 80 ms | 188 ms |
| **ShortFast (SF7/250)** — *proposed event/escalation* | **35 ms** | 45 ms | 107 ms |

Memorise two numbers: **518 ms** is what a packet costs today. **35 ms** is what an alarm costs
under the new design. Everything else is bookkeeping.

---

## 2. Proof that the current design is already broken

Not "tight." Over budget by 2×, today, at ten minutes.

**Load model.** N = 31 nodes. Each sends one 37-byte packet per cycle. Managed flooding causes
each packet to be rebroadcast by R neighbours before the hop limit stops it. In a dense field
where most nodes hear most others, R is somewhere between 8 and 30.

Total airtime per cycle = `N × (1 + R) × 518 ms`.

| Rebroadcasts R | Airtime / cycle | Channel use @ 600 s | Channel use @ 60 s |
|---|---|---|---|
| 8 (optimistic) | 144.6 s | **24.1%** | 240.9% |
| 12 (realistic, hop_limit 3) | 208.8 s | **34.8%** | 348.0% |
| 16 | 273.1 s | **45.5%** | 455.1% |
| 30 (worst case) | 497.9 s | **83.0%** | 829.9% |

**The threshold is ~18%.** Above that, unslotted LoRa (pure ALOHA) enters collision collapse —
retries generate more traffic, which generates more collisions. Throughput does not degrade
gracefully; it falls off a cliff.

**So: the v3 design at 10 minutes sits at 24–45% and is on the wrong side of the cliff.** The
493% figure already in your notes was correct arithmetic. It was measuring `R ≈ 16` at a 60 s
cycle (my number: 455%), and the conclusion drawn from it — "therefore 60 s is impossible" —
was the wrong conclusion. The right one is "therefore *flooding at SF11* is impossible."

> **Slide line.** *"Every team will say they built a mesh. We are the team that computed its
> airtime budget, found our own first design over the legal limit, and fixed it."* That is a
> stronger claim than a working demo, because it proves engineering rather than assembly.

---

## 3. How many nodes — derived, not assumed

Your `nodes.json` says 28 field + 2 anchor + 1 gateway. That number is **right**, and here is the
derivation that makes it defensible under questioning.

### 3.1 The monitoring rectangle falls out of the geometry

From `panel` in `nodes.json`: extracted panel 600 m × 200 m (x 100–700, y 100–300), depth
H = 150 m, tan β = 2.0.

Radius of influence: `r = H / tan β = 150 / 2.0 = **75 m**`.

Subsidence extends r beyond the panel edge in every direction. Monitoring rectangle =
`(600 + 2×75) × (200 + 2×75)` = **750 m × 350 m**. Which is exactly your existing
`grid: x 25–775, y 25–375`. The grid was already derived correctly; this just writes down why.

### 3.2 Uniform sampling is unaffordable — and that is the point

The feature you must resolve is not subsidence depth (smooth, easy) but **curvature**, which
changes sign across the trough edge over a span of roughly `r/2 ≈ 37 m`. Three points minimum to
resolve a sign change → node spacing ≤ ~18 m.

A uniform 18 m grid over 750 × 350 m = **42 × 20 = 840 nodes.**

At any plausible cost per node that is a non-starter. So one of two things has to give: the
sampling density, or the assumption that sampling must be uniform.

### 3.3 Lines, not grids — which is also real survey practice

Conventional subsidence monitoring does not use grids. It uses **survey lines**: one transverse
line across the panel through its centre, one longitudinal line along the panel axis. Dense where
the gradient is steep, sparse where the surface is flat. That is a century of mine-surveying
practice, and it is exactly the right shape for 31 nodes.

**The 31, laid out:**

| Group | Count | Placement | Job |
|---|---|---|---|
| Transverse line | 13 | x = 400, y ∈ {25, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 375} | resolves the steep trough edges; 25 m spacing in the edge zones, 50 m in the flat centre and far field |
| Longitudinal line | 10 | y = 200, x ∈ {25, 100, 175, 250, 325, 475, 550, 625, 700, 775} | resolves advance of the trough along the panel; shares the centre node (400, 200) with the transverse line |
| Off-axis constraint | 5 | ~(250,150), (550,150), (250,250), (550,250), (400,300) | two crossed lines only constrain two cross-sections; these break the degeneracy and give the PINN genuine 2D information |
| **Anchors** | 2 | (860, 200), (860, 340) | 160 m beyond the panel edge, i.e. **> r outside the influence zone.** Stable datum. Also the common-mode reference that lets you subtract shared thermal drift |
| **Gateway** | 1 | (860, 200) co-sited with anchor | backhaul, time beacon, slot master |
| **Total** | **31** | | |

### 3.4 The 27× gap is closed by the PINN — say this out loud

840 nodes for uniform Nyquist. 28 field nodes on lines. The factor of 27 is not absorbed by
cleverness in the layout; it is absorbed by the **physics prior**. The PINN is not free to
interpolate any surface it likes — it is constrained to surfaces that a Knothe influence function
can produce. That constraint is worth 800 sensors.

> **This is your network-level justification for the PINN, and it is stronger than the ML one.**
> "We used a neural network because it's accurate" is a weak claim. "We used a physics-informed
> network because it is the only thing that lets 28 sensors do the job of 840" is a costed
> engineering argument.

### 3.5 A note on where the anchors sit

The anchors are the single most under-appreciated nodes in the design. They sit outside the
influence zone, so by construction they must read **zero subsidence, forever**. Which means:

- If an anchor reports movement, your sensors are drifting, not the ground. Instant drift
  detection with no ground truth required.
- Subtracting the anchor's temperature-driven tilt from every field node removes the shared
  seasonal component. Per `part1-maths-spec.md`, thermal drift can reach 0.76° against a 0.17°–1°
  signal — common-mode rejection against the anchors is the cheapest SNR gain in the system.
- Two anchors, not one, so you can tell "the anchor is broken" from "everything is drifting."

---

## 4. Topology and roles

### 4.1 Everyone can hear everyone — and you must not rely on it

Max node separation across the field is ~750 m. At 1 W ERP, SF9/250, receiver sensitivity
~−123 dBm, the raw link budget clears 750 m easily on paper. **Do not design to that number.**

**Why not (ELI5).** Radio between two points does not travel in a line, it travels in a fat cigar
shape around the line — the Fresnel zone. At 866 MHz over 750 m the cigar is **8.0 m fat at its
middle**. Your antennas are 1.5 m off the ground. So the bottom 80% of that cigar is buried in
soil. Long ground-level links at 866 MHz are far worse than the free-space maths suggests.

**Worse: the thing you are measuring degrades your radio.** A developing subsidence trough lowers
and tilts the nodes sitting in it, changing the terrain profile between them. Links get worse
precisely when the event you care about is happening.

**Design rule.** Assume a **reliable link (PDR ≥ 0.99) out to 400 m**, and require every field
node to have **≥ 3 neighbours at ≥ 10 dB link margin.** With 25–75 m spacing on the lines and
400 m reach, typical node degree is 12–20. Redundancy is essentially free; the mesh is
over-connected by an order of magnitude. Nominal path length is 1–2 hops; `hop_limit = 3` is
ample.

**Therefore: the relay tier below is a scheduling construct, not a range construct.** Be honest
about that. Its job is to compress 24 packets into 6, not to extend reach.

### 4.2 Roles

| Role | Count | Radio behaviour | Notes |
|---|---|---|---|
| `leaf` | 24 | wakes in its slot, sends 21 B to its parent, sleeps | lowest power; identical hardware to relay |
| `relay` | 4–6 | receives 4 children, concatenates, sends one 105 B frame to gateway | rotates monthly by battery state — role is firmware config, not hardware |
| `anchor` | 2 | leaf behaviour + drift reference | outside influence zone |
| `gateway` | 1 | RX mostly; emits time beacon and slot map; holds backhaul | 4G/Wi-Fi to the surface hut, mains or large solar |

**Relay assignment is by geometry**: each relay takes the four nearest leaves that are not already
parented. Assignment is computed once, written into `nodes.json`, and re-elected only on failure
(§7, F4).

---

## 5. The three planes in detail

### 5.1 P1 — Routine, 60 s

- Preset **MediumFast (SF9/250)**.
- Routing: **NextHopRouter** (routed unicast along a known parent chain), *not* managed flood.
- Node samples all seven sensors every **60 s** — unchanged from v3, this was always right.
- Node transmits every **60 s**: 21 bytes carrying that epoch's values, not a 10-minute summary.
- Relay concatenates 4 children + itself = 105 B payload → 121 B on air → one transmission.
- Gateway de-duplicates, orders by `(node_id, seq)`, writes rows.

**Why 60 s and not 30 s:** see §6. 30 s puts the relay at 1.15% duty cycle — over the legal limit.
**60 s is not a preference; it is the legal floor for sustained routine telemetry.** That is a
clean, quotable constraint and it is the reason the escalation plane exists.

### 5.2 P2 — Escalation, 15–20 s, cluster-local

Triggered when any node's on-board detector crosses a **warn** threshold (below alarm). Then:

- The gateway commands **that relay's cluster only** — 5–6 nodes, never all 31 — to switch to
  **ShortFast (SF7/250)** and a **20 s** cadence.
- Range drops at SF7, but the cluster is talking to a relay tens of metres away. Range is not the
  binding constraint here; airtime is.
- Escalation is **duration-capped at 30 minutes**, then auto-reverts unless re-triggered. This is
  what keeps the *hourly-averaged* duty cycle legal, since the 1% limit is measured per hour.

Relay duty during escalation: 107 ms every 20 s = **0.53%**. Still under 1%, even sustained.

### 5.3 P3 — Event, immediate

- Payload: 8 bytes — `node_id | epoch | channel_id | magnitude | confidence | crc`. On air ~24 B.
- Preset **ShortFast**, **managed flood** (this is the one place flooding is correct — you want
  every path tried at once), **highest priority**, preempts the slot schedule after a CAD check.
- Airtime: **35 ms** per transmission, ~384 ms to flood the whole network at R = 10.
- Latency: 3 hops × (35 ms + ~200 ms CAD/backoff) ≈ **0.7 s to the gateway.**
- Budget: 20 alerts per hour = **0.21% duty cycle.** Effectively free.

**What triggers it.** A tiny on-board detector, no ML, no model: a threshold on
`|value − rolling_baseline|` plus a threshold on `d/dt`. Two comparisons and a subtraction. It
runs on the node, so it fires without waiting for a network round trip.

**What it does not do.** It does not raise an alarm. It is a *request for attention*. The alarm
is still owned entirely by the gateway-side classical bowl fit plus blast-log cross-check, per the
system-wide rule. The event plane changes *when* the gateway gets to look, not *who decides*.

### 5.4 The state machine, in one block

```
  QUIET ──── node-local warn threshold ────────► ESCALATED (cluster only)
    ▲                                                 │
    │◄──── 30 min elapsed, no re-trigger ─────────────┘
    │
    └──────────────────────────────────────────────────
                        ▲
                        │  any state, any time
   ┌────────────────────┴────────────────────┐
   │  EVENT  8-byte flood, preempts, <1 s    │
   │  → gateway runs bowl fit + blast veto   │
   └─────────────────────────────────────────┘
```

---

## 6. The budget — the proof

All figures computed from the airtime table in §1.1. **Cycle = 60 s. 24 leaves @ 37 B, 6 relays
@ 121 B, SF9/250, routed unicast.**

Airtime per cycle = `24 × 150 ms + 6 × 345 ms` = **5.67 s**

| Cadence | Channel utilisation | Relay duty cycle | Leaf duty cycle | Verdict |
|---|---|---|---|---|
| 600 s | 0.94% | 0.06% | 0.03% | wildly over-conservative |
| **60 s** | **9.45%** | **0.57%** | **0.25%** | **✅ legal, under ALOHA threshold, 2× headroom** |
| 30 s | 18.89% | 1.15% | 0.50% | ❌ over 1% duty cycle limit |
| 15 s | 37.79% | 2.30% | 1.00% | ❌ illegal and past collision collapse |

Escalation and event planes, layered on top:

| Plane | Preset | Airtime | Worst-node duty | Verdict |
|---|---|---|---|---|
| P2 escalation, cluster of 6 @ 20 s | SF7 | 107 ms / 20 s | 0.53% | ✅ legal even sustained |
| P3 event, 20 alerts/hr | SF7 | 384 ms / alert | 0.21% | ✅ negligible |
| **P1 + P2 + P3 worst case, one hour** | | | **~1.3%** | ⚠️ see below |

**On the last row.** If a cluster escalates for the full hour *and* fires 20 alerts *and* runs
routine, the worst relay touches ~1.3%. That is why escalation is **capped at 30 min/hour** — it
brings the worst case to ~0.9%. Write the cap into firmware, not into a slide. Design constraints
you enforce in code are the ones judges believe.

### 6.1 Before / after, in one line

| | v3 design | this design |
|---|---|---|
| Routine cadence | 600 s | **60 s** (10× faster) |
| Alarm latency | 600 s worst case | **<1 s** (600× faster) |
| Channel utilisation | 24–45% (past collapse) | **9.4%** |
| Worst-node duty cycle | 29% (29× illegal) | **0.57%** (legal) |
| Preset | LongFast SF11 | MediumFast SF9 + ShortFast SF7 |
| Routing | managed flood | routed unicast + flood *only* for alerts |

---

## 7. Concurrency — the slot schedule

**The problem.** Thirty-one nodes with independent 60 s timers will eventually collide, and LoRa
has no collision detection. Two overlapping packets are usually both lost.

**The fix.** The nodes are static, powered, and time-synchronised. That is the exact condition
where **TDMA beats CSMA**. Give every node a slot. Collisions become structurally impossible for
routine traffic, and the channel-utilisation ceiling stops mattering — 9.4% of a *slotted* channel
is 9.4% used and 90.6% idle, with no contention at all.

### 7.1 The 60-second superframe

```
 t=0     t=2                                    t=38          t=50      t=58  t=60
 ├───────┼──────────────────────────────────────┼─────────────┼─────────┼─────┤
 │beacon │  24 leaf slots × 1.5 s               │ 6 relay     │ contention│guard│
 │ 2 s   │  (150 ms tx + 1.35 s guard)          │ slots × 2 s │ window 8s │ 2 s │
 └───────┴──────────────────────────────────────┴─────────────┴─────────┴─────┘
```

- **Beacon (2 s):** gateway broadcasts UTC epoch, slot map, config version, and any escalation
  commands. This is the only downlink in a normal cycle.
- **Leaf slots (36 s):** each leaf transmits once in its assigned 1.5 s window.
- **Relay slots (12 s):** relays have heard all their children by t=38 and forward aggregates.
- **Contention window (8 s):** retries, late joins, escalation overflow. Standard CSMA with CAD
  and jittered backoff. Anything that could not fit lands here.
- **Guard (2 s):** absorbs drift and slow wake-ups.

**Event packets ignore this entirely.** They CAD-check and transmit whenever they fire.

### 7.2 Time sync without GPS

**The question:** do the nodes need GPS to hold their slots? **No.** Here is the arithmetic.

- A commodity crystal drifts at ±20 ppm.
- Beacon interval is 60 s → accumulated drift between beacons = **1.2 ms**.
- Guard band per leaf slot = **1.35 s**.
- Margin = **1125×**.
- Even after missing **ten consecutive beacons** (10 min of silence), drift is 12 ms — still 100×
  inside the guard.

**Therefore no GPS on field nodes.** That is a real cost saving (~₹400/node and a power budget
line) and a good answer to "how do you synchronise?" — because "we did the drift arithmetic and
found we didn't need to" is a better answer than "GPS."

Nodes discipline off beacon arrival time, correcting for their own known propagation delay
(≤ 2.5 µs at 750 m — negligible, ignore it).

---

## 8. Failure handling — eight classes

You asked what happens when a node dies, when there is duplication, when there is concurrency.
Here is the complete table. Every row has a detection rule and a response, because "the mesh
self-heals" is not an engineering answer.

| # | Failure | What it looks like in `nodes.csv` | Detection rule | Response |
|---|---|---|---|---|
| **F1** | Single node silent | `alive=0`, `seq` gap for one `node_id` | 3 consecutive missed slots | mark `stale`; PINN masks that node; alarm quorum recomputed on survivors; maintenance ticket |
| **F2** | Link degrading | `rssi_dbm` trending down, `hops` increasing | 24 h rolling RSSI slope < −3 dB/day | re-elect parent via NextHopRouter; **maintenance alert, never a subsidence alarm** |
| **F3** | **Correlated cluster loss** | ≥3 nodes within 100 m go `alive=0` in the same 10-min window | spatial clustering on `alive=0` | **Class-A escalation to a human.** This is either mass hardware failure or ground failure, and you cannot tell which from the radio. See §8.1 |
| **F4** | Relay death | a relay's 4 children all go silent together | relay silent AND children silent | children auto-promote to their **pre-assigned backup direct slot** in the contention window; gateway re-elects a relay next beacon |
| **F5** | Gateway death | nothing arrives at all | backhaul watchdog, 3 missed cycles | nodes fall back to **store-and-forward**; buffer and replay on recovery. See §8.2 |
| **F6** | Duplicate packets | same `(node_id, epoch)` arrives twice | dedup key | **idempotent upsert on `(node_id, epoch)`** — duplicates are structurally harmless by construction, not by luck. See §13.4: the key is `epoch`, *not* `seq`, because `seq` resets on reboot |
| **F7** | Out-of-order arrival | `epoch` 3400 arrives before 3390 | `epoch` is monotonic per node | order by `(node_id, epoch)`, never by `t_iso`. `t_iso` is provenance only, and the gap measures mesh latency |
| **F8** | Byzantine node (lying, not dead) | one node's values diverge from every neighbour | median absolute deviation vs 5 nearest neighbours, per channel | quarantine **that channel on that node**, not the whole node — a node can have good tilt and garbage strain |

### 8.1 Silence is data — F3 deserves its own paragraph

This is the strongest technical claim in the network design, so do not bury it.

A naive mesh treats missing nodes as missing data and interpolates over them. But **the failure
mode you are trying to detect destroys sensors.** A subsidence event severe enough to matter will
crack, tilt, bury, or sever the nodes sitting on top of it. So the moment your system most needs
data is exactly the moment it stops arriving — and a system that silently interpolates over that
gap will interpolate over a collapse.

**Rule: a spatially clustered silence is an event, not an absence.**

Detection: ≥3 nodes whose pairwise separation is < 100 m, all transitioning to `alive=0` within
one 10-minute window, with no `radio_blackout` event logged and no corresponding blast in the DGMS
log. Response: Class-A alert to a human operator, phrased honestly — *"four nodes in the
north-east quadrant stopped reporting simultaneously; cause unknown; investigate."*

Never auto-resolve this. The system does not know whether it lost four boxes or four hectares.

### 8.2 Store-and-forward — 72 hours of outage, zero data loss

Every node keeps a ring buffer of unacknowledged frames in flash.

- Frame size: 21 bytes.
- At 60 s cadence: 21 × 60 × 72 = **90.7 KB for 72 hours.**
- A full week: 21 × 60 × 24 × 7 = **212 KB.**

Any ESP32-class board has megabytes of flash. **The entire outage-survival story costs a
rounding error of storage**, and it converts "the gateway went down and we lost a day of data"
into "the gateway went down and the data arrived late." Replay happens in the contention window
at low priority so it never delays live traffic.

### 8.3 Redundancy targets — the numbers to quote

| Property | Target | Basis |
|---|---|---|
| RF neighbour degree | ≥ 3 at ≥ 10 dB margin | actual degree 12–20; redundancy is free at this density |
| Alarm quorum | ≥ 5 nodes, Knothe fit R² ≥ 0.85 | one node cannot alarm alone; F8 Byzantine nodes are structurally unable to trigger |
| Single node loss | reconstruction RMSE degrades < 5% | 1 of 28 on a well-sampled line |
| 4-node cluster loss | local RMSE degrades ~30% | must be **surfaced**, never silently absorbed — F3 |
| Gateway outage survivable | **72 h** with zero loss | 90.7 KB buffer |
| Time sync margin | **1125×** | 1.2 ms drift vs 1.35 s guard |

---

## 9. What this changes in the four files

The four-file model holds. No fifth file. Changes are additive.

### 9.1 `nodes.json` — gains a `mesh` block and per-node radio fields

```jsonc
"mesh": {
  "band": "IN865",
  "erp_dbm": 30,
  "duty_cycle_limit": 0.01,
  "preset_routine": "MEDIUM_FAST",     // SF9 / BW250
  "preset_event": "SHORT_FAST",        // SF7 / BW250
  "router": "next_hop",
  "hop_limit": 3,
  "superframe_s": 60,
  "beacon_s": 60,
  "leaf_slot_s": 1.5,
  "relay_slot_s": 2.0,
  "contention_s": 8,
  "escalation_cadence_s": 20,
  "escalation_cap_s": 1800,
  "buffer_frames": 4320                // 72 h at 60 s
}
```

Per node, added to each `nodes[]` entry:

| Field | Kind | Stands for | Example |
|---|---|---|---|
| `radio_role` | Identity | `leaf` / `relay` / `gateway` | `"leaf"` |
| `parent` | Identity | which relay this node reports to | `7` |
| `slot` | Schedule | index into the superframe | `12` |
| `backup_slot` | Schedule | direct-to-gateway slot used on F4 relay death | `26` |
| `antenna_h_m` | Geometry | antenna height above ground | `1.5` |

Note `radio_role` is **separate from** the existing `role` field. `role` is what the node is for
(`field`/`anchor`/`gateway`); `radio_role` is how it behaves on air. An anchor can be a relay.

### 9.2 `sim.transmit_s`: 600 → 60, with a caveat

**File size problem.** 40 days × 31 nodes at 60 s = **1.79 M rows ≈ 200 MB.** Too big to hand
around, too big to load into a browser.

**Recommended: hybrid cadence, which is also what the real product does.**

- Baseline **600 s** while the ground is quiet.
- **60 s** inside "hot windows" — the 6 hours surrounding each scripted event.
- Row count: 178,560 + 66,960 = **245,520 rows ≈ 27 MB.** Manageable.

This is not a simulator cheat. It is the adaptive-cadence behaviour of the real system, faithfully
simulated. The sim's variable cadence *is* the product's variable cadence — say that.

### 9.3 `events.csv` — four new event types

| Event | Meaning | Exercises |
|---|---|---|
| `node_kill` | one node dies permanently at time t | F1 |
| `cluster_kill` | N nodes within radius R die together | **F3 — the important one** |
| `relay_kill` | a relay dies, orphaning 4 children | F4 |
| `gateway_down` | backhaul lost for a window | F5, store-and-forward replay |

`radio_blackout` already exists in v3 and stays — it is the *distinguishable* case, the one where
you can prove "no data" ≠ "no movement."

### 9.4 `nodes.csv` — one new column

`parent_id` (uint8) and `epoch` (uint32, the dedup key — see §13.4). `rssi_dbm`, `snr_db`, `hops`, `alive`, `seq` already exist and already carry
everything else F1–F8 need. The wire format was designed well; do not disturb it.

---

## 10. Layer 4 simulator spec

Layer 4 is the only part of the generator that genuinely loops, because routing depends on
per-packet state. Everything upstream stays vectorised.

### 10.1 Link model

Log-distance path loss with log-normal shadowing:

```
PL(d) = PL(d0) + 10·n·log10(d/d0) + X_σ + L_clutter
  PL(100 m) @ 866 MHz = 71.2 dB   (free space)
  n         = 4.0                 (near-ground, obstructed)
  σ         = 6 dB                (shadowing, per-link, frozen per node pair)
  L_clutter = 15 dB               (ground-level, sub-Fresnel)
```

Link margin `M = ERP − PL − sensitivity(SF)`. Packet delivery ratio:

```
PDR = 1 / (1 + exp(−(M − 3) / 2))
```

**Be honest in the document and on stage:** `n` and `L_clutter` are *calibrated*, not derived.
They are set so that the model reproduces the design assumption of **PDR ≥ 0.99 at 400 m with
1.5 m antennas**. Validate against Meshtasticator (§11) and report the disagreement rather than
hiding it.

### 10.2 Loop structure

```
for each superframe (60 s):
    emit beacon; every node updates its clock model (±20 ppm drift)
    for each leaf slot:
        if node alive and not buffered-out:
            compute M to parent → draw PDR → deliver or buffer
    for each relay slot:
        concatenate delivered children + own frame → one packet → gateway
        on failure, entire aggregate buffers (this is the aggregation risk — model it)
    contention window:
        retries + buffered replays, CSMA with CAD and jittered backoff
    apply any active event: node_kill / cluster_kill / relay_kill / gateway_down
    gateway: dedup on (node_id, seq) → append rows
```

**The aggregation risk is real and must be modelled, not assumed away:** one lost relay packet
loses five nodes' data, not one. That is the price of the airtime saving. Mitigate with a relay-
level retry in the contention window, and *measure* the resulting loss distribution rather than
asserting it is fine.

### 10.3 What to instrument

Every run should emit a one-page radio report, because this is what makes the network story
credible on stage:

- channel utilisation, measured not asserted
- per-node duty cycle, worst and mean, against the 1% line
- PDR distribution across nodes
- hop count distribution
- event-plane latency histogram
- rows lost vs rows delayed vs rows recovered from buffer

---

## 11. Validation

**Meshtasticator, not ns-3 or FLoRa.** ns-3 and FLoRa model LoRaWAN star topology, which is not
what you are building. Meshtasticator runs actual Meshtastic firmware as native Linux binaries,
so it models the real flooding/routing behaviour including the parts nobody documents.

Three things to validate, in priority order:

1. **The rebroadcast count R** under your node density and hop limit. Everything in §2 hangs off
   this number, and it is the one figure I estimated rather than derived. If R is really 6, the
   old design was merely bad rather than broken. If it is 20, the case is stronger. Measure it.
2. **NextHopRouter behaviour under relay death** — does it re-elect within one beacon, or does it
   thrash? F4 depends on the answer.
3. **Event-plane preemption latency** with the routine plane running underneath. The claimed
   <1 s assumes CAD finds a clear channel quickly at 9.4% utilisation. Confirm.

If Meshtasticator proves too slow to learn in the time available, the fallback stated in the
report — hand arithmetic in a spreadsheet — is legitimate, and the arithmetic in §1.1, §2 and §6
is that spreadsheet. Say which one you did.

---

## 12. What is settled and what is parked

**Settled by this document:**

- Node count is 31, derived from trough geometry rather than chosen.
- Routine cadence is 60 s. Not 30 s — the duty cycle limit forbids it.
- Alarm latency is <1 s via a separate 8-byte event plane.
- Routing is NextHopRouter for telemetry, managed flood for alerts only.
- Presets: MediumFast routine, ShortFast event and escalation.
- No GPS on field nodes; beacon-disciplined TDMA with 1125× drift margin.
- Duplicates are handled by idempotent upsert on `(node_id, epoch)`, not by hoping. `seq` measures loss; `epoch` establishes identity.
- Clustered silence is a Class-A event, never interpolated over.
- 72-hour outage survivability for 90.7 KB of flash.

**Parked, deliberately:**

- Whether to add a second gateway at the anchor site. Cheap insurance, but it is a hardware-phase
  decision and the internal round is software-only.
- Multi-panel scale-out. Rule 4 of `nodes.json` (`panel` as an array, `panel_id` per node) already
  leaves the door open at zero cost. Leave it open, do not walk through it yet.

---

## 13. Low-level design — slots, relays, duplicates

Sections 7–8 said *what* the network guarantees. This section says *how*, at the level of
"what does the firmware actually do at 14:32:07." Read it as the implementation contract.

### 13.1 How a node knows its slot

**The wrong mental model:** nodes pass a token, or listen for "you're next," or wait their turn
by watching the channel. None of that happens. Any of it would cost airtime and would break the
moment one node went deaf.

**The right mental model:** every node owns a printed timetable and a watch. The beacon sets the
watch. The timetable does the rest.

```
my_slot_start = beacon_arrival_time
              + beacon_window (2 s)
              + (my_slot_index × slot_duration)
```

A node computes that once per cycle, sets a hardware timer, and sleeps. It wakes, transmits for
150 ms, and sleeps again. **It does not listen at all during other nodes' slots.** That is where
the power saving comes from, and it is also why the design has no contention.

**Analogy.** A school assembly where each class walks on stage in turn. The wrong design is a
teacher calling names — needs a working PA system, and stops dead if the PA fails. The right
design is a printed running order plus one bell at the start. Everyone counts from the bell.

#### Where `my_slot_index` comes from — two tiers

| Tier | Source | When used | Failure behaviour |
|---|---|---|---|
| **Static** | `slot` field in `nodes.json`, written at deployment | always, as the floor | a node with no beacon for 10 cycles reverts to this and keeps transmitting |
| **Dynamic** | slot map broadcast by the gateway | whenever a fresh map is held | supersedes static; used for relay rotation and orphan re-homing |

**The static tier is the safety net and it must never be removed.** A node that has lost the
gateway entirely still transmits on its factory slot. It may be transmitting into a void, but it
is never silent for a reason the operator cannot diagnose, and the instant the gateway returns
its data is already flowing.

#### The beacon is 12 bytes, not a slot table

Broadcasting the full 31-node slot map every cycle would waste airtime on data that changes maybe
once a month. Instead the beacon carries a **version number** and the map is pulled on demand.

| Field | Bytes | Meaning |
|---|---|---|
| `epoch` | 4 | 60 s sample index since scenario start — the network's clock |
| `map_version` | 2 | increments whenever slot assignment changes |
| `escalation_mask` | 2 | which relay clusters are currently in P2 escalation |
| `config_version` | 1 | thresholds, cadence, preset |
| `flags` | 1 | maintenance mode, gateway health |
| `crc` | 2 | integrity |
| **total** | **12 B** | ~28 B on air, 119 ms at SF9 |

A node compares `map_version` against its stored copy. If they match — which is the case in
essentially every cycle — it does nothing. If they differ, it requests the full 31-byte map in
the contention window and applies it. **Steady-state cost of the whole slot-management system:
119 ms per minute, which is the beacon you were sending anyway.**

#### Slot allocation

| Range | Count | Assigned to |
|---|---|---|
| 0–23 | 24 | leaves, in order of `node_id` |
| 24–29 | 6 | relays |
| 30–69 | 40 | contention-window backup slots — one reserved per node, used on relay death |

Backup slots are pre-allocated at deployment so two orphaned leaves can never collide. Forty
slots in an 8 s contention window at 200 ms each is enough for **two simultaneous relay deaths**
plus retries plus buffer replay.

#### Clock drift, settled

- Crystal tolerance: ±20 ppm.
- Beacon interval: 60 s → drift between beacons = **1.2 ms**.
- Guard band per slot: **1.35 s**.
- Margin: **1125×**.
- After ten consecutive missed beacons: 12 ms drift, still 112× inside the guard.

**Conclusion: no GPS on field nodes.** Propagation delay across the field is ≤ 2.5 µs at 750 m —
three orders of magnitude below the guard band. Ignore it entirely.

### 13.2 What a relay actually is

Same board. Same firmware binary. One config byte. Everything below is a difference in the
runtime loop, not in the hardware.

| | Leaf | Relay |
|---|---|---|
| Radio, per cycle | TX 150 ms, RX only during the 2 s beacon | TX 345 ms, **RX across its 4 children's slots (~6 s)** |
| Sleeping | ~99.5% of the cycle | ~80% of the cycle |
| RAM held | one 21 B frame | 4 child frames + a 64-entry dedup ring (~340 B) |
| Slots occupied | 1 leaf slot | 1 relay slot, plus listening across 4 leaf slots |
| Failure blast radius | 1 node | **5 nodes** |

**The relay's job in three lines:**

1. Wake for each of its four children's slots, receive, ACK, drop anything already in the dedup
   ring.
2. At its own relay slot, concatenate the frames it holds plus its own into one 105 B payload.
3. Transmit once to the gateway.

**Why relays must rotate.** A relay spends roughly **40× more time with its receiver on** than a
leaf. Receiver-on is the dominant power draw in a LoRa node — far more than transmitting. If
relay assignment is static, six nodes flatten their batteries months ahead of the other 24, and
they are exactly the six whose failure costs five nodes each.

**Rotation policy:** monthly, or immediately when a relay's `vbat_mv` drops more than 15% below
its cluster median. The gateway already receives `vbat_mv` in every row of `nodes.csv`, so this
needs no new telemetry.

### 13.3 Switching relays — the two protocols

#### Planned rotation (three cycles of lead time)

```
cycle N     gateway decides new assignment
            beacon carries map_version = v+1, effective_at = N+3
cycle N     nodes with stale version request the full map in the contention window
cycle N+1   same, for anyone who missed it
cycle N+2   same — three chances
cycle N+3   everyone switches at the beacon, simultaneously
            old relay drops to leaf; new relay comes up
```

Any node that still has not received the map by N+3 falls back to its **static slot** and reports
direct to the gateway. Degraded — it costs its own 150 ms instead of sharing a relay's 345 ms —
but never silent, and it self-corrects at the next beacon it hears.

**Lead time plus static fallback is what makes this safe.** Without lead time, one lost beacon
splits the cluster into nodes using the old map and nodes using the new one, and they collide.

#### Unplanned relay death (F4)

```
cycle N     leaf transmits in its slot → no ACK
            leaf retries once in the contention window → no ACK
            leaf buffers the frame, does NOT give up
cycle N+1   same
cycle N+2   same → 3 consecutive failures → parent declared dead
cycle N+3   leaf transmits on its backup_slot, direct to gateway
            replays its 3 buffered frames at low priority
cycle N+3   gateway sees 4 nodes on backup slots + relay silent → confirms F4
            elects new relay: highest vbat_mv, lowest hop count to gateway
            bumps map_version
cycle N+6   cluster back to normal aggregation
```

**Why three cycles and not one.** At PDR 0.99, a single missed ACK happens to some node roughly
once every 25 cycles across the network — completely normal. Three consecutive misses from the
same parent is a one-in-a-million event if the losses were independent, so it is almost certainly
a real death. One-cycle triggering would have the network re-electing relays constantly.

**Total cost of a relay dying: about 6 minutes of degraded aggregation and zero lost data.** The
leaves buffer through the detection window and replay once they are on backup slots. Relay death
costs latency, not data — that distinction is worth saying out loud, because it is the difference
between a mesh that survives and one that merely reroutes.

### 13.4 Duplicates — where they come from and the three defences

#### The five real sources

Under TDMA plus routed unicast, routine telemetry should not duplicate at all: collisions are
structurally impossible and nothing floods. Duplicates come from exactly five places.

| # | Source | Frequency | Deliberate? |
|---|---|---|---|
| D1 | Relay received the frame, its ACK was lost, leaf retried | ~1 in 100 frames | no |
| D2 | Event-plane flood — gateway hears one alert via 3 paths | every alert | **yes, by design** |
| D3 | Store-and-forward replay of frames that did in fact land | after every outage | no |
| D4 | Leaf briefly reporting to two parents during re-election | rare, bounded to 3 cycles | no |
| D5 | Node reboots, `seq` resets to zero | rare | no |

#### The identity key — corrected

The key is **`(node_id, epoch)`**, not `(node_id, seq)`.

- `epoch` is the 60 s sample index carried in the beacon. It is monotonic by construction, is the
  same on the original and on every retry, and **survives a reboot** because it is sourced from
  the network rather than from node state.
- `seq` resets to zero on reboot, so D5 would make a rebooted node's frame 5 collide with its
  pre-reboot frame 5, and the upsert would silently overwrite good data with unrelated good data.
  That is the worst class of bug: no error, no gap, wrong numbers.

**The rule that follows:** `seq` measures loss, `epoch` establishes identity. Keep both — gaps in
`seq` are still how you compute packet loss per node, and that number is on your results slide.
Just never key on it.

**Corollary, and the most important line in this section:** `seq` increments **once per frame
produced**, never per transmission. Retransmitting frame 1152 sends frame 1152 again, bit for
bit. A retry is not a new frame. Get this wrong and every layer below stops working.

#### Layer 1 — node: reuse the seq

Buffer the frame with its `(epoch, seq)` intact. On retry, resend the identical bytes. The frame
is immutable from the moment it is produced. Cost: nothing.

#### Layer 2 — relay: a 64-entry dedup ring

The relay keeps the last 64 `(node_id, epoch)` pairs it has accepted — 64 × 5 bytes = **320 bytes
of RAM**. Anything already in the ring is ACKed (so the child stops retrying) but **not**
aggregated.

This layer does not protect correctness — layer 3 does that. It protects **airtime**: without it
a duplicate would ride into the 105 B aggregate and consume real transmit time. 64 entries covers
16 cycles of history for four children, comfortably longer than the 3-cycle re-election window
that produces D4.

#### Layer 3 — gateway: idempotent upsert

```sql
INSERT INTO readings (node_id, epoch, ...) VALUES (...)
ON CONFLICT (node_id, epoch) DO UPDATE SET ...
```

The primary key is `(node_id, epoch)`. A duplicate arriving is a no-op write. **You cannot
corrupt the dataset by receiving a packet twice, no matter how many times it arrives, from how
many paths, in what order.** Duplicates are harmless by construction rather than by vigilance —
which is the only kind of harmless worth relying on.

#### D2 is different — count it, don't just drop it

Event-plane alerts flood deliberately, so the gateway will hear the same alert several times. Key
those on `(node_id, epoch, alert_id)`, keep the **first arrival time** as the latency measurement,
and **count the copies**.

That count is real diagnostic data. Three copies means three independent paths carried the alert
— the mesh is healthy. One copy means the alert reached you by a single route and you nearly
missed it. It is a free measurement of network redundancy, taken exactly when it matters most.

#### Out-of-order arrival is not duplication

Replayed buffer frames arrive after live ones, so `epoch` 3400 can land before `epoch` 3390.
**Order by `(node_id, epoch)`, never by `t_iso`.** `t_iso` is arrival time — it is provenance
only, and the gap between it and `epoch` is the mesh latency measurement.

### 13.5 What the simulator must implement

Layer 4 of the generator has to model all of the above, not assume it away. Minimum:

1. Per-node clock with ±20 ppm drift, disciplined on beacon arrival.
2. Slot scheduler with static fallback after 10 missed beacons.
3. Relay dedup ring, 64 entries — and it must be **possible** for it to overflow, so you can prove
   it doesn't.
4. ACK loss modelled independently of frame loss — D1 exists precisely because these are
   different events.
5. Three-cycle parent-death detection with buffering, then backup-slot replay.
6. Reboot events that reset `seq` but not `epoch` — this is the only way to prove the key fix in
   §13.4 actually matters.

**Test to run first:** inject a `relay_kill`, and assert that the four orphaned nodes lose **zero
rows** — only delayed ones. If any row is missing, the buffer or the backup slot is wrong. That
single assertion validates most of this section.

---

## Appendix A — the numbers, on one card

Print this. It is what you need under questioning.

| Quantity | Value |
|---|---|
| Band / power / duty cycle | IN865 (865–867 MHz) / 1 W ERP / **1%** |
| Airtime, 37 B @ SF11 (old) | **518 ms** |
| Airtime, 37 B @ SF9 (new) | **150 ms** |
| Airtime, 24 B alert @ SF7 | **35 ms** |
| Old design, channel use @ 600 s | **24–45%** (collapse threshold 18%) |
| New design, channel use @ 60 s | **9.4%** |
| New design, worst-node duty cycle | **0.57%** (limit 1%) |
| Alarm latency | **<1 s** (was 600 s) |
| Radius of influence r | **75 m** (H/tan β = 150/2.0) |
| Uniform-Nyquist node count | **840** |
| Actual node count | **31** — the 27× is bought by the PINN's physics prior |
| Fresnel radius @ 866 MHz, 750 m | **8.0 m** (antennas at 1.5 m → sub-Fresnel) |
| Clock drift per beacon interval | **1.2 ms** vs 1.35 s guard = **1125× margin** |
| Store-and-forward, 72 h | **90.7 KB** |
