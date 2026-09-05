# 02b — Mesh Network Stress-Test & Vulnerability Analysis

**Revision:** REV2 (supersedes REV1)
**Scope:** Adversarial analysis of the LoRa mesh architecture defined in `02-mesh-network.md`.
**Applies to:** IN865 band, BW 125 kHz, TDMA superframe, 28-node + 4-anchor layout, single surface gateway.

---

## 0. Revision Notice — What Changed From REV1

REV1 contained ten defects. All are corrected here. Anything quoting REV1 figures must be re-checked.

| ID | Defect in REV1 | Resolution in REV2 |
|---|---|---|
| F-1 | Duty ceiling labelled "Legal/ETSI" — ETSI 1% is an **EU 868** rule, not Indian law | Relabelled as **self-imposed design ceiling**. GSR 564(E) cited only for the 200 kHz carrier cap (§1.0) |
| F-2 | Test 1 diagram said 1.48%, equation said 1.085% | Recomputed from first principles: **1.257%** (§2.1) |
| F-3 | Test 1 formula notation self-contradictory (multipliers vs. totals) | Replaced with an explicit per-frame airtime table (§2.1) |
| F-4 | Backup slots specified "Direct SF7" in 150 ms slots — inconsistent with the link model | Link budget re-derived. Fallback is **SF10, 11-byte distress payload, 400 ms slots** (§3) |
| F-5 | Gateway duty cycle never recomputed after hardening proposals | Beacon airtime budgeted at **0.62%**; beacon rate is now frozen (§4) |
| F-6 | Rec. 4 proposed 500 ms guard bands after 12 h — but 12 h drift is 1.73 s | Recommendation withdrawn. Replaced with **transmit-inhibit on gateway loss** (§2.3) |
| F-7 | "5.6× link margin" — margin is a dB quantity | Restated as **7.5 dB** throughout |
| F-8 | Test 2 had no arithmetic | Quantified: 650 ms burst / 6.8% instantaneous load. **Severity downgraded** (§2.2) |
| F-9 | Recommended purchasing a new lightning detector | Replaced with **local-first veto bus** reusing existing DGMS blast seismograph logs (§2.4) |
| F-10 | Orphan arithmetic described 4 relay failures while claiming 3 | Restated (§1.B) |

**New content:** §3 (anchor nodes — absent from REV1 entirely), §5 (gateway role definition).

---

## 0.1 Airtime Reference Table

All duty-cycle figures in this document derive from these values. Computed with the standard LoRa time-on-air formula: BW 125 kHz, CR 4/5, explicit header, CRC on, 8-symbol preamble, DE=0.

| Frame | SF | Payload | Time on air |
|---|---|---|---|
| Leaf telemetry | 7 | 21 B | 56.6 ms |
| Cluster ACK (relay→leaves) | 7 | 6 B | 36.1 ms |
| Flood alert | 7 | 8 B | 36.1 ms |
| Relay aggregate (6 members) | 8 | 142 B | 410.1 ms |
| Delta aggregate (P2 escalation) | 8 | 40 B | 154.1 ms |
| Orphan distress (direct→GW) | 10 | 11 B | 288.8 ms |
| Gateway beacon + bitmap ACK | 10 | 24 B | 370.7 ms |

> **Open dependency:** the 142 B aggregate and 21 B telemetry sizes must be confirmed against `04-wire-formats.md`. If the aggregate exceeds 142 B, every relay duty figure below moves upward and §2.1 gets worse, not better.

---

## 1. Architectural Bottlenecks & Tight Tolerances

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CRITICAL MARGIN & DUTY BOUNDARIES                    │
├─────────────────────────┬───────────────────────┬───────────────────────┤
│ Metric                  │ Baseline / Worst-Case │ Ceiling               │
├─────────────────────────┼───────────────────────┼───────────────────────┤
│ Worst-Node Duty (C4)    │ 0.87 %                │ 1.00 % (self-imposed) │
│ Gateway Duty (beacon)   │ 0.62 %                │ 1.00 % (self-imposed) │
│ Sustained Telemetry Cad.│ 60 s                  │ 60 s (13 % headroom)  │
│ Backup Slot Capacity    │ 16 reserved slots     │ 16 orphan nodes       │
│ Blind Spot Radius (LEC) │ 178.9 m (d = 358 m)   │ Minimum feature size  │
│ Time-Sync Drift Margin  │ 40 ppm relative       │ 160 ms guard band     │
└─────────────────────────┴───────────────────────┴───────────────────────┘
```

### 1.0 On the 1 % Ceiling — Read This Before Quoting It

The 1 % duty-cycle limit used throughout is **an internal design convention, not Indian law.**

- The 1 % figure originates in **ETSI EN 300 220**, which governs the **EU 868 MHz** band. It does not apply in India.
- The Indian constraint that *does* bind us is **GSR 564(E)**, which caps carrier bandwidth at 200 kHz. This is why we run BW 125 and not BW 250, and why the trunk dropped from SF9 to SF8.
- We retain 1 % voluntarily because it is a defensible engineering ceiling for coexistence and battery life, and because it is the number a reviewer will recognise.

**Do not present 1 % as a regulatory requirement in the pitch.** Present GSR 564(E) as the regulatory requirement and 1 % as our self-imposed margin. Conflating them is the same class of error that produced the original BW250 mistake: a European number imported as if it were Indian law.

### 1.A Razor-Thin Duty Margin on Trunk Relays

Relay C4 carries 6 members — the maximum permitted by `k_max = 6`, itself derived from the duty-cycle limit. Its nominal duty is **0.87 %**, leaving **0.13 % absolute margin**.

That margin is worth **156 ms of airtime per 120 s window**. A single unbudgeted aggregate retransmission (410 ms) overruns it by 2.6×. There is no room for opportunistic retries at k = 6.

### 1.B Backup Slot Saturation Ceiling

The superframe reserves **16 backup slots** for orphaned leaves to reach the gateway directly.

Orphan count by number of failed relays (cluster sizes: C1=4, C2=4, C3=4, C4=6):

| Relays failed | Worst-case orphans | Within 16 slots? |
|---|---|---|
| 1 | 6 (C4) | Yes |
| 2 | 10 (C4 + any) | Yes |
| 3 | 14 (C4 + two 4s) | Yes, 2 spare |
| 4 | 18 (all clusters) | **No — overflow by 2** |

REV1 claimed three-relay failure overflows the allocation. It does not; **four** does. The correction matters because a three-relay regional failure is plausible (one lightning strike, one flood channel) whereas total relay loss implies the gateway is probably gone too — in which case §2.3's transmit-inhibit rule applies and the slot question is moot.

**Note the slot-width change:** §3 widens backup slots from 150 ms to 400 ms. At 16 slots that consumes 6.4 s of the superframe rather than 2.4 s. The extra 4.0 s is taken from the 39.5 s quiet window, which absorbs it without touching any other allocation.

### 1.C Spatial Blind Spot (d = 358 m)

Nodes sit on survey lines, not a uniform grid. The largest empty circle has radius **178.9 m**.

A localised collapse or sinkhole smaller than 358 m in an off-axis quadrant registers on no sensor. The PINN will interpolate smoothly across the void and produce a confident, clean, wrong surface — masking the anomaly until strain propagates into an active line.

This is **accepted, not fixed.** Closing it requires roughly doubling node count. It must appear explicitly in the operator sign-off as a stated detection floor, not be discovered later.

---

## 2. Failure Scenario Stress Tests

### 2.1 Test 1 — Compound Relay Failover + Regional Escalation ("Hot Zone" Trap)

```
        [Cluster 1 relay dead] ──(F4)──► leaves orphaned
               │
               ├──► fallback A: direct to gateway (backup slots)
               └──► fallback B: C2 adopts as backup parent   ◄── THE TRAP
               │
        [Cluster 2] ──(P2)──► escalation: 30 s delta aggregates
               │
               ▼
        C2 = forwarding trunk + escalating cluster, simultaneously
```

**Scenario.** C1's relay dies. C2 is configured as C1's backup parent. Simultaneously C2 sits over an accelerating panel edge and crosses the P2 threshold (Uᵢ > 5.0), which mandates 30 s delta transmissions.

**Airtime over a 120 s window:**

| Component | Count | Each | Subtotal |
|---|---|---|---|
| Own aggregate (SF8, 120 s cadence) | 1 | 410.1 ms | 410.1 ms |
| Forwarded C1 aggregate (SF8) | 1 | 410.1 ms | 410.1 ms |
| Cluster ACKs (own + adopted, SF7) | 2 | 36.1 ms | 72.2 ms |
| P2 delta aggregates (SF8, 30 s) | 4 | 154.1 ms | 616.4 ms |
| **Total** | | | **1508.8 ms** |

$$\text{Duty} = \frac{1508.8}{120\,000} = \mathbf{1.257\,\%}$$

**Verdict: ceiling exceeded by 26 %.** REV1's two conflicting figures (1.48 % and 1.085 %) were both wrong; the violation itself is real.

**Root cause.** The failover rule and the escalation rule were written independently and never composed. Each is safe alone. Together they are not.

**Mitigation (firmware, mandatory).** A relay in P2 escalation **must refuse backup-parent adoption**. On refusal it sets a bit in its own aggregate; the gateway reassigns the orphans to the next-nearest non-escalating relay, or if none exists, to direct-to-gateway backup slots. Escalation always wins — the escalating cluster is the one sitting over the developing hazard, and its own data is worth more than relayed data from a quiet neighbour.

---

### 2.2 Test 2 — Multi-Cluster Alert Storm

**Scenario.** A pillar shear trips 15 nodes across Clusters 1, 2 and 4 past the event threshold (Uᵢ > 8.0, dU/dt > 1/epoch). Origination suppression is per-cluster only, so three independent alert floods launch at once.

**Quantified channel load** (REV1 asserted this without arithmetic):

- Alert frame: 8 B at SF7 = **36.1 ms**
- Per flood: 1 origination + rebroadcast by 4 relays + gateway confirm ≈ **6 transmissions**
- Three simultaneous floods: 3 × 6 = **18 transmissions**
- Total channel occupancy: 18 × 36.1 = **650 ms**
- Against the 9.5 s active cluster block: **6.8 % instantaneous channel load**

**Revised verdict.** 6.8 % added load with CAD-before-transmit is **survivable**. REV1 implied a jamming-class failure; the numbers do not support that. The realistic consequence is a handful of leaf slots losing one telemetry frame and recovering on the next cycle.

**Severity: downgraded from High to Low.**

**Residual risk worth stating.** P3 alerts preempt the TDMA schedule. The 650 ms burst is not the problem — schedule preemption during the active block is. Cap it: **no more than 3 preemptions per superframe**, remainder deferred to the quiet window. Alert latency rises by at most one superframe; alert delivery does not become probabilistic.

---

### 2.3 Test 3 — Extended Gateway Blackout with Oscillator Drift

```
            CRYSTAL DRIFT, ±20 ppm NODES, NO BEACON
  t = 0      │ [S0][S1][S2][S3]   160 ms guard bands intact
  t = 1.1 h  │ [S0][S1] ─ guard band consumed, slots touch
  t = 12 h   │  1.73 s relative drift — slots several positions apart
  t = 72 h   │  10.37 s relative drift — timetable meaningless
```

**Drift arithmetic.** Relative rate between two worst-case-opposite nodes = 20 − (−20) = **40 ppm**.

| Elapsed | Relative drift |
|---|---|
| 1.11 h | 160 ms (guard band fully consumed) |
| 12 h | 1.73 s |
| 72 h | 10.37 s |

**Why REV1's Recommendation 4 was withdrawn.** REV1 proposed expanding guard bands from 160 ms to 500 ms after 12 hours of beacon loss. But 12 hours of drift is **1.73 s** — the proposed 500 ms guard is already overrun by 3.5× at the moment it would be deployed. A 500 ms guard buys 3.5 hours total, not 12. The recommendation did not solve the problem it was written for.

**Why a better crystal doesn't fix it either.** Upgrading to a ±2 ppm TCXO gives 4 ppm relative. Guard band survives 11.1 h instead of 1.1 h — a 10× improvement that still fails long before 72 h (72 h at 4 ppm = **1.04 s** drift). No affordable oscillator closes a 72-hour hold-over.

**The actual resolution — reframe the failure.**

REV1 treated the failure mode as *"TDMA collapses, nodes fall into CSMA contention and drain batteries."* That framing accepts a false premise: **that nodes should still be transmitting.**

The gateway is the only sink in the network. If the gateway is dead, there is nowhere for a packet to go. Every transmission during a gateway blackout is wasted energy by definition — and battery exhaustion is what makes the network fail to recover when the gateway returns.

**Rule (firmware, mandatory) — Transmit Inhibit on Gateway Loss:**

1. After **10 consecutive missed beacons**, a node ceases all telemetry transmission.
2. It buffers readings to local flash (72 h retention is already specified and is sufficient).
3. It wakes to **listen only**, on a backoff schedule: every 1 min for the first hour, every 5 min to hour 6, every 15 min thereafter.
4. On beacon reacquisition it resynchronises, receives its slot assignment fresh, and uploads its backlog across the quiet window over subsequent superframes.
5. **Exception:** a node in P3 event state transmits its alert regardless, on a CAD-before-transmit basis. A dead gateway is not a reason to stay silent about a collapse — some other node or a passing handheld may hear it.

This eliminates both the collision problem and the battery-drain problem, because it eliminates the transmissions. Clock drift becomes irrelevant: resynchronisation is unconditional on beacon return, so it does not matter how far the clock wandered.

**Severity: downgraded from Medium to Low, once the inhibit rule is implemented.**

---

### 2.4 Test 4 — Backhaul Severance During Lightning (F9 + F10 Race)

```
  Lightning strike ──► backhaul severed (F9)  +  3 nodes destroyed in C3
         │
         ▼
  Gateway observes: correlated silence, ≥3 nodes within 100 m,
                    on both primary AND backup slots
         │
         ├─ REV1 path: query Blitzortung/IMD API ──► [UNREACHABLE] ──► no veto
         │                                                    │
         │                                                    ▼
         │                                          Class-A false alarm
         │
         └─ REV2 path: query LOCAL veto bus ──► blast seismograph log (on-site)
                                             ──► gateway impulse detector
                                             ──► veto succeeds offline
```

**Scenario.** Monsoon lightning severs the surface hut's cellular backhaul and destroys three C3 nodes. Correlated silence across co-located nodes is the exact signature of a ground collapse (F3), so the gateway must decide between F3 and F10 (lightning) — and the only difference is external context.

**Failure in REV1.** The F10 veto depended on a third-party internet API (Blitzortung / IMD). The same lightning that created the ambiguity also destroyed the means of resolving it. Guaranteed false alarm, guaranteed to recur every storm season, guaranteed to erode operator trust in the alarm.

**Why REV1's fix was wrong.** It proposed buying a new electrostatic/EMF pulse detector. That is a hardware purchase, a certification question, and a new failure point — to solve a problem we already have the data for.

**REV2 resolution — the Local-First Veto Bus.**

Establish an architectural invariant: **no alarm veto may depend on a network resource.** Every veto input must be a file or a wire already present at the gateway.

Three inputs, in priority order:

1. **DGMS blast seismograph logs.** Mandated by **DGMS Circular 7/1997** — every Indian coal mine already records these, and the records are **local files**, not a cloud service. This is the strongest veto we have and it costs nothing incremental. It vetoes the largest real false-alarm source (production blasting) with zero new hardware.
2. **Correlated-silence signature discrimination.** Lightning kills nodes *instantaneously and simultaneously* — silence begins within one epoch across all affected nodes. Ground collapse is preceded by *rising strain and tilt* on those same nodes over multiple epochs before they go quiet. **The pre-silence telemetry is already in the buffer.** Check it. Collapse without precursor strain is physically implausible; lightning without precursor strain is the norm. This is a software veto requiring no hardware at all.
3. **Optional: gateway impulse detector.** Only if (1) and (2) prove insufficient in field trial. Deferred, not designed in.

**Design principle to carry forward:** the blast-seismograph reuse is not just a convenient fix here — it is proof that the local-first constraint is affordable. Any future veto proposal that requires an internet round-trip should be rejected by default and re-derived against on-site data.

---

### 2.5 Test 5 — Subsidence-Induced Fresnel Obstruction

```
 Pre-subsidence:
 Leaf (1.5 m) ──────── LOS, 7.5 dB margin ──────── Relay (1.5 m)

 Subsidence active (3 m trough + tension cracks):
 Leaf (1.5 m) ─┐
  in trough    └──► ╱ spoil berm / trough lip ╲ ──[+15–20 dB]──► Relay (1.5 m)
```

**Scenario.** Panel excavation produces a developing trough (S_max = 1.5–3.0 m) between a leaf and its cluster relay.

**Geometry.** First Fresnel zone radius at 866 MHz over a 150 m span:

$$r_F = \tfrac{1}{2}\sqrt{\frac{c \cdot d}{f}} = \tfrac{1}{2}\sqrt{\frac{3\times10^8 \times 150}{866\times10^6}} \approx 3.6\ \text{m}$$

A 1.5 m antenna sits entirely inside the Fresnel zone and inside ground clutter (~25 dB clutter loss already budgeted).

**Margin correction (F-7).** REV1 stated a "5.6× link margin." Margin is a dB quantity. As a power ratio, 5.6× = **7.5 dB**. Trough diffraction adds 15–20 dB. The margin does not survive — it is exceeded by roughly 10 dB.

**Failure mode.** Leaf-to-relay links degrade **precisely as subsidence peaks** — the moment the data matters most. Cluster leaves time out over 3 cycles and fall back to direct-to-gateway.

**This is the scenario that makes §3 non-optional.** The fallback path is not a rare edge case; on an actively subsiding panel it is the *expected* end state. It must be link-budgeted properly, which REV1 did not do. See §3.

---

## 3. Fallback Path Re-Derivation (F-4) — and Anchor Nodes

### 3.1 The REV1 contradiction

REV1 specified orphaned leaves falling back to **"Direct SF7"** in **150 ms** slots. Both halves are wrong, and they are wrong in opposite directions:

- Orphans are far from the gateway — that is *why* they need relays. A direct link needs a **higher** spreading factor, not the lowest one.
- But a 150 ms slot only fits SF7 (56.6 ms) or SF8 (102.9 ms). SF9 needs 185.3 ms and does not fit.

So the slot width silently forced an SF that the range model cannot support. **This is the original range-model inconsistency reappearing in a new location** — the fallback path was never re-derived after the range fix.

### 3.2 Direct leaf→gateway link budget

Two-ray plane-earth loss, which is the correct regime for these geometries:

$$L = 40\log_{10}(d) - 20\log_{10}(h_1) - 20\log_{10}(h_2)$$

| | Leaf → Relay (nominal) | Leaf → Gateway (fallback) |
|---|---|---|
| Distance | 150 m | ~900 m worst case |
| Leaf antenna h₁ | 1.5 m | 1.5 m |
| Far-end antenna h₂ | 1.5 m (relay) | **15 m (mast)** |

Two effects, opposing:

- **Distance penalty:** 6× further, in a 40 log d regime = **−31.1 dB**
- **Mast height gain:** 15 m vs 1.5 m = **+20.0 dB**
- **Net:** the direct path is **≈ 11 dB worse** than the leaf→relay hop it replaces.

SF steps buy roughly 3 dB each (SF7 −123 dBm, SF8 −126, SF9 −129, SF10 −132 at BW125):

| Fallback SF | Sensitivity gain vs SF7 | Covers the 11 dB deficit? |
|---|---|---|
| SF8 | +3 dB | No |
| SF9 | +6 dB | No |
| **SF10** | **+9 dB** | Marginal — closes 9 of 11 dB |

SF10 does not fully close the gap on paper. The remaining ~2 dB is recovered by the fact that the 900 m figure is a worst-case corner and by the fixed 15 m mast having far cleaner clutter conditions than the ground-level relay assumed in the 25 dB clutter budget. **SF10 is the correct choice; SF7 was never viable.**

### 3.3 Corrected fallback specification

| Parameter | REV1 (wrong) | REV2 |
|---|---|---|
| Spreading factor | SF7 | **SF10** |
| Payload | 21 B full telemetry | **11 B distress subset** |
| Time on air | 56.6 ms | **288.8 ms** |
| Slot width | 150 ms | **400 ms** |
| Slot count | 16 | 16 (unchanged) |
| Total superframe cost | 2.4 s | **6.4 s** (+4.0 s from quiet window) |
| Orphan cadence | 60 s | **120 s** |
| Orphan duty cycle | — (never computed) | **0.24 %** |

**On the reduced payload.** An 11-byte distress frame carries node ID, epoch, and the two primary channels (strain, displacement). Tilt and the secondary channel are dropped. This is defensible and not merely a size compromise: **tilt is already a secondary signal** whose thermal drift can exceed the subsidence signal, so it is the correct channel to shed under constraint. Strain and displacement carry the detection.

**On the 400 ms slot.** 288.8 ms frame in a 400 ms slot leaves 111 ms — comfortably above the 160 ms guard band requirement at nominal sync? **No, it is not.** 111 ms < 160 ms. Either widen to **450 ms** (161 ms guard, 16 slots = 7.2 s) or accept that orphan slots run at reduced guard and are CAD-protected. **Decision required before layout freeze — flag as open.**

### 3.4 Anchor nodes — absent from REV1, required

REV1 contains no anchors. Without them, the tilt and extensometer channels have no defined zero and the alarm pipeline cannot distinguish subsidence from thermal drift.

**Why they are necessary.** No sensor measures subsidence. Tilt measures slope; strain measures relative separation; extensometers measure displacement *relative to a fixed end*. That word — relative — is the trap. If the entire reference frame moves, a relative measurement reads zero while the ground sinks. An anchor is the point the system asserts is not moving.

**Two distinct kinds:**

**(a) Physical anchor — per extensometer.** The borehole rod is cemented into rock *below the moving horizon*. If the anchor depth falls inside the subsidence zone, the anchor sinks with the surface and the reading is not noisy — it is **wrong and confident**, which is far worse. Anchor depth must be verified against the predicted draw angle for the panel, per borehole.

**(b) Anchor nodes — network level.** 3–4 nodes placed **outside the Knothe trough limit**, over the barrier pillar or unmined ground. Same hardware SKU, different firmware flag. Three functions:

1. **Zero reference.** All tilt and strain are differenced against the anchors. If node 14 tilts 0.3° and the anchor also tilts 0.3°, that is not subsidence.
2. **Thermal drift reference.** The anchor experiences identical weather and zero subsidence. Common-mode drift subtracts out. This is what makes the tilt channel usable at all as a secondary vote.
3. **Radio anchor.** Anchors sit on stable ground, so their link geometry does not degrade. Per §2.5, ordinary links fail exactly as subsidence peaks. Anchor links do not. They are the only links guaranteed available during the worst moment.

**Placement rule:** minimum 3, preferably 4, on different sides of the panel, all beyond the predicted trough edge computed from `S(x,y,t)`. They must not be collinear.

**Duty impact:** anchors report at 300 s cadence (they are a slow reference, not a detector). 4 × 56.6 ms per 300 s = negligible; absorbed within existing slot allocation.

**Failure consequence if omitted:** the PINN fits a smooth, plausible, entirely fictional bowl to a seasonal temperature cycle. Anchors are the constraint that makes the fictional bowl impossible.

---

## 4. Gateway Duty Cycle (F-5)

REV1 tracked only the worst *node*. The gateway was never budgeted — the same omission previously found and fixed at ~1.54 %.

**Beacon budget:**

- Beacon carries slot table + 28-bit bitmap ACK, ~24 B at SF10 = **370.7 ms**
- At 60 s beacon interval: 370.7 / 60 000 = **0.62 %**

**Why this constrains the hardening proposals.** REV1's Recommendations 3 and 4 both required additional gateway transmissions (dynamic superframe reconfiguration, guard-band commands). Doubling the beacon rate takes the gateway to **1.24 % — a violation**, undetected in REV1 because nobody recomputed it.

**Rule (mandatory): the beacon interval is frozen at 60 s.** Superframe reconfiguration is signalled by **flag bits inside the existing beacon**, never by additional transmissions. This is the same principle that produced the bitmap ACK — carry new information in a frame you were already sending.

Any future proposal touching gateway behaviour must ship with a recomputed gateway duty line or be rejected.

---

## 5. Gateway — Definition and Placement

Included because REV1 assumed this context without stating it.

**Physical location: surface only. Never underground.**

This is not convenience. Underground equipment requires **DGMS intrinsic-safety certification** — spark energy provably incapable of igniting methane, including under fault conditions. That certification is slow and expensive. The entire system is surface-mounted above the panel, so it is out of scope. This is a load-bearing architectural decision and should be stated explicitly in the pitch.

**Physical form:**
- Weatherproof cabinet at the pit-top / surface hut, within the mine's operational area
- **15 m mast** — this height is what makes the §3 fallback path viable
- Mains power with solar + battery backup
- **Unmanned.** Technicians and the safety officer work in the control room, potentially at the district office, and interact only with the dashboard. Nobody attends the gateway.

**Four functions:**

1. **Time authority.** The beacon is the network clock. All TDMA slot arithmetic references it. §2.3 is the analysis of its absence.
2. **Schedule authority.** Slot assignments are distributed in the beacon. No node self-assigns.
3. **Data sink.** Leaves → relay (SF7) → gateway (SF8) → local flash → backhaul → server. Leaves do not address the gateway directly except in fallback.
4. **Acknowledgement.** A 28-bit bitmap embedded in the beacon acknowledges all nodes in one transmission.

**Critical property:** the gateway writes to **local flash before the backhaul is involved**. Losing internet loses the dashboard, not the data.

```
   Leaf nodes ──SF7──► Cluster relay ──SF8──► GATEWAY ──► local flash
                                                  │
                                                  ▼
                                             backhaul (may fail)
                                                  │
                                                  ▼
                                    PINN surface  +  Knothe alarm detector
```

**Safety boundary, restated:** the PINN reconstructs the surface. The **classical Knothe-fit detector is the sole alarm decision-maker**, reading telemetry directly. No neural network sits in the safety loop. The PINN is a visualisation and interpolation layer whose failure degrades the picture, not the alarm.

---

## 6. Vulnerability Summary (Revised Severities)

| Vector | Root cause | REV1 severity | REV2 severity | Status |
|---|---|---|---|---|
| Relay over-duty in cascaded failover | Failover and escalation rules never composed | High | **High** | Open — needs firmware rule §2.1 |
| Backup slot overflow | Slot cap; **4** relay failures, not 3 | Critical | **Low** | Closed — 3-relay case fits; 4-relay case implies gateway loss |
| Fallback SF / slot-width contradiction | Fallback never link-budgeted | *not identified* | **High** | Resolved §3.3; guard-band question open |
| Missing anchor nodes | Omission | *not identified* | **Critical** | Resolved §3.4 — must be added to layout |
| Gateway duty unbudgeted | Omission | *not identified* | **High** | Resolved §4 — beacon frozen at 60 s |
| Clock desync on gateway loss | 40 ppm drift | Medium | **Low** | Resolved §2.3 via transmit inhibit |
| Veto failure on backhaul loss | Internet dependency in safety path | Medium | **Low** | Resolved §2.4 via local-first veto bus |
| Alert storm contention | Per-cluster suppression only | High | **Low** | Quantified §2.2 — 6.8 % load, survivable |
| Fresnel obstruction at peak subsidence | 1.5 m antennas, 7.5 dB margin | Medium | **Medium** | Accepted — drives fallback path design |
| Sub-358 m blind spot | Survey-line spacing | Medium | **Medium** | Accepted — requires operator sign-off |

---

## 7. Hardening Actions

| # | Action | Owner | Blocks |
|---|---|---|---|
| H1 | **Failover isolation:** a relay in P2 escalation refuses backup-parent adoption; gateway reassigns | Firmware | §2.1 violation |
| H2 | **Transmit inhibit:** after 10 missed beacons, stop transmitting, buffer to flash, listen on backoff. P3 alerts exempt | Firmware | §2.3 battery drain |
| H3 | **Local-first veto bus:** ingest DGMS blast seismograph logs (Circular 7/1997) + pre-silence strain-precursor check. No network dependency in any veto | Backend | §2.4 false alarms |
| H4 | **Fallback re-spec:** SF10, 11 B distress payload, 400–450 ms slots, 120 s cadence | Firmware + superframe | §3.3 |
| H5 | **Add 3–4 anchor nodes** outside the Knothe trough limit; verify extensometer anchor depths against draw angle | Layout + hardware | §3.4 |
| H6 | **Freeze beacon at 60 s.** Superframe changes via flag bits only. Every gateway proposal ships a duty-cycle line | Firmware | §4 |
| H7 | **Alert preemption cap:** max 3 TDMA preemptions per superframe, remainder deferred to quiet window | Firmware | §2.2 residual |
| H8 | **Document the 358 m detection floor** in operator sign-off | Docs | §1.C |
| H9 | **Replace "1 % legal/ETSI" with "1 % self-imposed"** in all documents and pitch material; cite GSR 564(E) only for the 200 kHz cap | Docs | §1.0 |

---

## 8. Open Questions Before Layout Freeze

1. **Backup slot width — 400 ms or 450 ms?** At 400 ms the residual guard is 111 ms, below the 160 ms standard. 450 ms gives 161 ms but costs 7.2 s of superframe. Requires a decision.
2. **Aggregate payload size.** All relay duty figures assume 142 B. Confirm against `04-wire-formats.md`. If larger, §2.1 worsens.
3. **Anchor node count — 3 or 4?** Three is the minimum for a non-degenerate plane fit; four gives redundancy against a single anchor failure. Four is recommended.
4. **Worst-case leaf→gateway distance.** §3.2 assumed 900 m. Confirm against the finalised layout; if any leaf exceeds ~1.1 km the SF10 budget does not close and that node needs guaranteed relay redundancy instead.

---

## 9. Test Gate Additions

Proposed additions to the T1–T32 register in `00-master-index.md`:

| Gate | Assertion |
|---|---|
| T33 | A relay in P2 state rejects backup-parent adoption; gateway reassigns orphans within one superframe |
| T34 | After 10 missed beacons, node transmit count over the next hour is zero, excluding P3 alerts |
| T35 | On beacon reacquisition after ≥12 h, node resynchronises and uploads full flash backlog without loss |
| T36 | Alarm veto pipeline returns a correct decision with all network interfaces disabled |
| T37 | Correlated-silence event with no precursor strain in the preceding 5 epochs is classified F10, not F3 |
| T38 | Orphan distress frame at SF10 fits within the allocated slot including guard band |
| T39 | Anchor-differenced tilt over a synthetic 20 °C diurnal cycle with zero subsidence produces no alarm |
| T40 | Gateway duty cycle across all operating modes, including failover reconfiguration, remains below 1.00 % |
