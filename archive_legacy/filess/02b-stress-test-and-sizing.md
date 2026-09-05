# 02b — Stress Test of 02, and the Node-Count Maths

> **This file owns:** every fault found in `02-mesh-network.md`, its fix, and the general formula for sizing a node network at *any* site.
>
> **It does not replace 02.** It is the errata + the sizing engine. Apply §2–§4 as edits to 02; §6–§8 is new material 02 does not have.

---

## 0. Verdict in one table

| # | Fault | Severity | Effect if unfixed |
|---|---|---|---|
| **A1** | **BW250 is illegal in India** — GSR 564(E) caps carrier bandwidth at 200 kHz | 🔴 fatal | Every airtime number in 02 is half what it should be |
| **A2** | **Gateway duty cycle is never computed anywhere.** It is ~1.5% | 🔴 fatal | The one node you cannot move is the one breaking the limit |
| **A3** | **ACK airtime is unbudgeted** — relays ACK 5 children/cycle, gateway ACKs 8 | 🔴 fatal | 1.5 s/cycle of unaccounted air; worst-node duty wrong |
| **A4** | **§3.1 and §8.2 contradict each other** — "half the field can't reach the gateway", yet all relay-death recovery routes orphans direct to the gateway | 🔴 fatal | The failover story runs on links the document says don't exist |
| **A5** | **Link model (§7.1) and range constants (§10) disagree by ~5×** | 🔴 fatal | Two sources of truth for range. 02 admits it calibrated them to agree. They don't |
| B1 | F3 and F4 are indistinguishable — a relay death fires the Class-A ground-collapse alert | 🟠 | Guaranteed false Class-A on stage |
| B2 | Escalation plane duty budget is wrong; 20 s is undeliverable for C1/C2 | 🟠 | Illegal, or silently doesn't happen |
| B3 | Static-slot fallback collides after ~85 min of beacon loss | 🟠 | Fallback degrades into mutual jamming |
| B4 | Relay must stay RX through the contention window → energy is ~15×, not 3.5× | 🟠 | Rotation goes back to mandatory |
| B5 | Contention window is 100% oversubscribed | 🟠 | Retries, map pulls and replay have nowhere to go |
| B6 | `epoch` as uint16 wraps at 45.5 days | 🟠 | Silent data corruption on day 46 |
| B7 | Missing F9 (backhaul dead, radio alive) and F10 (lightning) | 🟠 | Data dies at the gateway; lightning fires F3 |
| B8 | "We remain inside Meshtastic" is false, and it makes the Meshtasticator validation plan circular | 🟠 | Your validation tool cannot see your protocol |
| B9 | Alert storm (20 nodes trip at once) unmodelled | 🟡 | Event plane collapses exactly when used |
| B10 | Spare slots are global (21–23); re-homing needs a spare **inside** the target cluster's block | 🟡 | Cross-cluster re-homing breaks contiguity |
| **C** | **Node count 31 gives a 358 m blind spot** — computed, not estimated | 🔴 | See §6. This is the answer to "why 30 nodes" |

**Everything is fixable. Nothing here requires abandoning the architecture.** Total cost of all fixes: one bandwidth change, one spreading-factor change, two ACK changes, and ~8 more nodes.

---

## 1. What survived the stress test

Say these out loud; they are load-bearing and they are right.

- **The airtime table (§1.1) is arithmetically correct.** I recomputed every cell from the Semtech formula. SF7/250 37 B = 45.2 ms, SF9/250 121 B = 344.6 ms, SF11/250 37 B = 518.2 ms. Exact.
- **The node accounting is internally consistent.** 13 transverse + 10 longitudinal + 5 off-axis + 2 anchors + 1 gateway = 31, and every relay/child assignment in §3.3 maps onto a real node from §2.3 with none double-counted. I checked all 31.
- **`(node_id, epoch)` over `(node_id, seq)` is correct**, and the reason given (epoch comes from the network, seq from node state) is the right reason.
- **"Silence is data" (§9.1) is the single best idea in the document.** Keep it, but see B1 — it needs a discriminator or it will fire wrongly.
- **Anchors as a common-mode reference** is correct and cheap.
- **Contiguous cluster slots** as the energy optimisation is correct.

---

## 2. Fault A1 — BW250 is illegal in India

### What the law actually says

I read the gazette text. GSR 564(E), 30 July 2008, amending the 2005 rules: <cite index="16-1">no licence is required to operate low-power wireless devices in the 865–867 MHz band on a non-interference, non-protection, non-exclusive basis, with maximum 1 W transmitter power, 4 W effective radiated power, and 200 kHz carrier bandwidth</cite>.

Three corrections fall out:

| 02 says | Actually |
|---|---|
| "1 W ERP" | **1 W transmitter output, 4 W ERP (36 dBm).** 02's `erp_dbm: 30` is the conducted figure mislabelled |
| BW250 everywhere | **200 kHz is the cap. BW250 is non-compliant.** Use BW125 |
| "1% duty cycle. Not a guideline. **It binds before the physics does.**" | The Indian notification **does not specify a duty cycle.** The 1% comes from LoRaWAN IN865 regional parameters and ETSI convention — <cite index="1-1">India's WPC rules for 865–867 MHz are widely described as specifying 1% duty cycle per channel, similar to ETSI</cite>, but <cite index="7-1">the notification itself contains no explicit duty-cycle limit, unlike the EU's 1%</cite> |

### How to say the duty-cycle thing on stage

Do **not** say "it's the law." Say:

> "The Indian delicensing notification specifies power and bandwidth but not duty cycle. We designed to the ETSI/LoRaWAN 1% convention anyway, because we share the band with UHF RFID and because self-imposed duty limits are what make a mesh scale. We treat it as a binding design constraint even though it isn't a binding legal one."

That answer is stronger than the original claim, and it survives a judge who has read the notification.

### The cost of BW125

Every airtime doubles. At the design as written, that is fatal:

| | BW250 (02) | BW125 (legal) |
|---|---|---|
| Leaf 37 B @ SF7 | 45 ms | **90 ms** |
| Relay 142 B @ SF9 | 386 ms | **771 ms** |
| Worst-node duty | 0.67% claimed | **1.39%** ❌ |
| Channel utilisation | 5.49% claimed | **10.1%** |

### The fix: drop the relay trunk from SF9 to SF8

The trunk does not need SF9. Once the link model is fixed (§5), SF8 to a masted gateway reaches ~2.8 km against a longest trunk hop of 685 m.

| | BW125 + SF9 | **BW125 + SF8** |
|---|---|---|
| Relay 142 B | 771 ms | **427 ms** |
| Relay 121 B | 689 ms | **375 ms** |
| Worst-node duty | 1.39% ❌ | **0.81%** ✅ |
| Channel utilisation | 10.1% | **7.4%** |

**One character change in `nodes.json` — `MEDIUM_FAST` → `MEDIUM_SLOW`-equivalent at BW125 — restores legality.** Update the presets to name SF and BW explicitly rather than Meshtastic preset names, because the preset names bundle a bandwidth you are not allowed to use.

```jsonc
"preset_leaf":  { "sf": 7, "bw_khz": 125 },   // 90 ms for 37 B
"preset_relay": { "sf": 8, "bw_khz": 125 },   // 427 ms for 142 B
"preset_event": { "sf": 7, "bw_khz": 125 },   // 70 ms for 24 B
"erp_dbm": 36,                                 // 4 W ERP, per GSR 564(E)
"tx_conducted_dbm": 30,                        // 1 W, per GSR 564(E)
"carrier_bw_limit_khz": 200,                   // THE LAW
"duty_cycle_limit": 0.01,                      // convention, not law — say so
```

---

## 3. Faults A2 + A3 — the ACKs nobody counted

### A2: the gateway is the worst node in the network

02 computes duty cycle for leaves and relays. It never computes it for the gateway. The gateway must ACK 5 relay aggregates + 3 direct leaves, or those nodes cannot know whether to buffer — and §3.6 / §8.2 both depend on them knowing.

```
8 ACKs × 16 B @ SF8/125 = 8 × 109 ms = 872 ms
beacon                                 =  49 ms
                              TOTAL    = 921 ms / 60 s = 1.54%  ❌ ILLEGAL
```

### A3: relay ACKs are also uncounted

§3.4 says relays send ACKs. §6.1 does not budget them.

```
relay C4 ACKs 5 children × 60 ms @ SF7/125 = 300 ms
network-wide: 24 ACKs × 60 ms              = 1.44 s per cycle unbudgeted
```

### The fix — one idea, two applications

> **ACK by bitmap, not by packet.**

**Gateway → nodes:** the beacon already transmits every cycle. Add one byte: a bitmap of which relays and direct leaves were heard last cycle. Beacon goes 12 B → 13 B; **airtime is unchanged at 49 ms** because the payload-symbol count doesn't cross a boundary. ACK latency becomes one cycle, which is free because relays buffer anyway.

**Relay → children:** one bitmap ACK per cluster, transmitted at the end of the cluster's contiguous slot block. 16 B @ SF7/125 = 60 ms, replacing 5 × 60 ms.

| | Before | After |
|---|---|---|
| Gateway duty | 1.54% ❌ | **0.08%** ✅ |
| Relay C4 ACK cost | 300 ms | **60 ms** |
| Network ACK airtime | 2.31 s/cycle | **0.35 s/cycle** |

**Cost: zero.** The gateway was already beaconing; the relay was already awake at the end of its block.

Leaves must now stay awake ~60 ms past the end of their cluster's block to hear the bitmap. That is 60 ms of RX added to a node that sleeps 99% of the time.

---

## 4. Faults A4 + A5 — the range contradiction

This is the most serious structural fault, because two sections of 02 assume opposite facts.

**§3.1:** *"Roughly half the field physically cannot reach the gateway. That is the justification for relays."*

**§8.2, cycle N+3:** *"leaf transmits on its `backup_slot`, **direct to gateway**"*

**§5.3:** *"a node with no beacon for 10 cycles reverts to [its static slot] and keeps transmitting"* — to a gateway it allegedly cannot reach.

**§8.1:** *"Any node that still lacks the map by N+3 falls back to its static slot and **reports direct to the gateway**"*

**Every recovery path in the document routes through a link the document says does not exist.** If §3.1 is true, F4 recovery is fiction. If the recovery paths are real, §3.1's relay justification is wrong.

### A5 — and the link model says §3.1 is wrong

02's own §7.1 model, evaluated at its own constants:

```
PL(d) = 71.2 + 40·log₁₀(d/100) + X_σ + L_clutter
M     = ERP − PL − sensitivity(SF)
PDR   = 1/(1 + exp(−(M−3)/2))   →   PDR = 0.99 at M = 12.2 dB
```

Ground-to-ground, SF7, `L_clutter = 15 dB`, sensitivity −123 dBm:

```
M(d) = 30 − 71.2 − 40·log₁₀(d/100) − 15 + 123 = 66.8 − 40·log₁₀(d/100)
M = 12.2  →  d = 2360 m
```

**The model predicts 2.4 km. §10 asserts 400 m.** They disagree by 6×. To force the model to give 400 m you would need `L_clutter = 42 dB` or `n = 8.6` — both physically absurd.

02 says the constants are *"set so the model reproduces the design assumption of PDR ≥ 0.99 at 400 m."* They were not. Nobody checked.

### The fix — apply your own law to the radio

You already have this law for the ground: **one surface, four questions.** Apply it to the radio.

> **One link model. `reliable_range_*` are outputs, never inputs.**

Delete `reliable_range_m` and `reliable_range_masted_m` as independent constants. Derive them:

```
d_reliable(SF, L_clutter) = 100 · 10^[ (ERP − Sens(SF) − 71.2 − L_clutter − M_req − z·σ) / (10n) ]

  M_req = 12.2 dB      PDR = 0.99
  z     = 1.28         90th-percentile shadowing, so a bad draw doesn't kill the link
  σ     = 6 dB
```

With defensible conservative constants — `n = 4.0`, `L_ground = 25 dB`, `L_masted = 10 dB`:

| Link | SF | Derived reliable range | Longest actual hop | Margin |
|---|---|---|---|---|
| leaf → relay, ground↔ground | 7 | **724 m** | 150 m | 4.8× |
| leaf → masted gateway (fallback) | 7 | **1985 m** | 835 m | 2.4× |
| relay → masted gateway | 8 | **2803 m** | 685 m | 4.1× |

### What this means for the architecture

**Every leaf can reach the masted gateway directly.** So:

- §3.1's table is wrong and should be deleted. Half the field is *not* unreachable.
- All four recovery paths (§5.3, §8.1, §8.2, `backup_slot`) are **real**. Good.
- **Relays are an airtime-and-redundancy construct, not a range construct.** v1 was right; 02's "correction" overcorrected.

### Do not weaken the mast argument — strengthen it

The mast is still the highest-leverage hardware decision, for a better reason:

> **The mast is what makes "talk directly to the gateway" a working fallback for every single node.** Without it, relays are mandatory single points of failure with no backstop. With it, relays are an optimisation you can lose. That is the difference between a network with redundancy and a network with a story about redundancy.

Rewrite §3.2's table accordingly. Keep the Fresnel-zone explanation, keep the "the trough degrades the links it creates" point — both are excellent and both still hold.

---

## 5. Tier-2 faults, with fixes

### B1 — F3 and F4 are the same signature

F3 (correlated ground loss, Class-A alert to a human) fires when *"≥3 nodes whose pairwise separation is < 100 m, all transitioning to `alive=0` within one 10-minute window."*

C3's children are (400,25) (400,75) (400,125) (400,150). **Pairwise separation ≤ 125 m, mostly under 100 m.** When the C3 relay dies, all four go silent inside 3 minutes.

**A relay battery failure fires the ground-collapse alarm.** Guaranteed false Class-A, and it will happen during a 40-day demo.

**Fix — two discriminators, both free:**

1. **Backup-slot check.** Orphans appear on their `backup_slot` by cycle N+3 (§8.2). So:
   ```
   F4 (relay dead):  children silent on primary, PRESENT on backup slot
   F3 (ground event): children silent on primary AND backup slot, 3 consecutive cycles
   ```
   F3 detection latency becomes 6 cycles (6 min) instead of 3. State that honestly — it is still ten times faster than a human notices.

2. **Precursor check.** A subsidence event violent enough to destroy four nodes leaves a signature on the survivors around it. Check the last 30 min of z-scores on the 5 nearest surviving neighbours.
   > **Silence with a precursor is an event. Silence without a precursor is a fault.**

That line is worth putting on a slide.

### B2 — the escalation plane is unaffordable where it matters

§6.4 budgets escalation at 107 ms per 20 s, which is the **SF7** airtime for a 121 B aggregate. But C1's relay is 685 m from the gateway and runs the SF8 trunk: 375 ms. Three times per minute = 1125 ms = **1.88% duty**. Illegal.

And C1/C2 sit over the panel start-up edge — the clusters most likely to escalate first.

**The deeper problem: 20 s is not derived from anything.** Subsidence time constants are hours to days. Nothing physical requires 20 s.

**Fix — escalate by shrinking the payload, not by raising the rate.**

Keep the 60 s aggregate. Add **one** extra frame at t+30 s carrying only the escalating members as 8 B deltas:

```
routine aggregate  142 B @ SF8/125   = 427 ms
escalation delta    40 B @ SF8/125   = 170 ms   (3 escalating nodes)
                             TOTAL   = 597 ms / 60 s = 0.99%
```

Marginal. Cap escalating members at 2 → 32 B = 145 ms → total 572 ms = **0.95%** ✅, and it works for **every** cluster including C1, which the rate-based scheme never could.

Effective escalation cadence: 30 s on the channels that matter. Better than 02 claims, and legal.

**Also fix the cap policy.** §6.4 caps escalation at 30 min/hour "enforced in firmware." That silently degrades you at the worst possible moment. Instead:

> When the cap is reached, **trade routine for urgent**: drop that cluster's routine cadence to 180 s to buy escalation headroom, and surface the trade in the row and on the dashboard. Never cap the urgent plane silently.

### B3 — static-slot fallback collides after 85 minutes

§5.4's 170× margin is per-cycle. Extended beacon loss is not covered.

```
relative drift between two nodes = ±40 ppm
guard band                        = 205 ms
time to exhaust guard = 205e-3 / 40e-6 = 5125 s = 85 minutes
```

After ~85 minutes of beacon loss, two nodes on adjacent static slots can overlap. The fallback that was supposed to keep the network alive turns it into mutual jamming.

**Fix:** after 10 missed beacons, a node performs a **CAD check immediately before its slot transmission** and backs off one slot-width if the channel is busy. Costs ~1 ms per cycle, only in fallback mode, and makes the static tier survive indefinitely. One `if` statement.

### B4 — relay energy is 15×, not 3.5×

§3.4 computes relay RX as *"own cluster's contiguous slots + beacon"* ≈ 1.4 s. But a child's retry lands in the **8 s contention window**, so the relay must listen through it — or retries have no receiver.

```
claimed RX   1.4 s   →   actual RX  9.4 s   →   energy ratio ~15×, not 3.5×
```

That resurrects mandatory monthly rotation, which 02 correctly demoted.

**Fix — per-cluster retry sub-slot.** Append a 200 ms retry window to each cluster's contiguous block. The relay stays awake 200 ms longer instead of 8 s.

```
relay RX = 1.25 s (children) + 0.20 s (retry) + 0.06 s (its own ACK TX) + 0.05 s (beacon) = 1.56 s
energy ratio ≈ 3.9×   ✅ the 3.5× claim survives, roughly
```

Bonus: retries become deterministic. No CSMA needed for the common case.

### B5 — the contention window is 100% oversubscribed

§5.2 allocates 40 backup slots in an 8 s window. A backup transmission is a leaf going direct to the gateway — SF7/125, 37 B = 90 ms, plus guard = 150 ms slot.

```
40 slots × 150 ms = 6.0 s of an 8 s window
```

...leaving 2 s for retries **and** map pulls **and** buffer replay, all of which §5.1 says happen there. And 02 calls the window both "contention" (CSMA) and "pre-reserved slots" (TDMA). Pick one.

**Fix:**

| Block | Was | Now |
|---|---|---|
| Backup slots (TDMA-reserved) | 40 × 200 ms = 8.0 s | **16 × 150 ms = 2.4 s** |
| Genuine CSMA (retries moved to §B4 sub-slots; this is map pulls + orphan joins) | shared | **2.6 s** |
| Buffer replay | in contention | **moved to the quiet block**, low priority, CAD-gated, deferred whenever `escalation_mask ≠ 0` |
| Quiet / event reserve | 38 s | **41 s** |

16 backup slots covers two simultaneous relay deaths (10–11 orphans) with margin. Replay belongs in the quiet block anyway — it is the only traffic in the system with no latency requirement at all.

### B6 — `epoch` wraps at day 45.5

`epoch` is the 60 s sample index and the identity key.

```
uint16 max = 65535 epochs = 45.5 days
```

Your scenario is 40 days. You are 5.5 days from silent overwrite, and the failure is exactly the class you correctly identified as worst: *no error, no gap, wrong numbers*.

**Fix: `epoch` is uint32.** Two extra bytes on the wire, 194 years of headroom. This is the same bug class as the `ext_delta` int16 and `temp` int8 issues you already found — add it to that list so the pattern is visible.

`seq` may stay uint16; it only measures loss and wrap is handled modulo.

### B7 — two missing failure classes

**F9 — backhaul dead, radio alive.** F5 assumes gateway death looks like total silence. But if the LoRa side is healthy and only the internet uplink dies, nodes see normal beacons, never buffer, and the data dies at the gateway. Response: the gateway buffers to local storage (31 × 21 B × 1440/day = 938 KB/day; 72 h = 2.8 MB — nothing), and the dashboard shows *stale*, not *healthy*.

**F10 — lightning.** Thirty poles with antennas in an Indian coalfield during monsoon. This is the number one field-failure cause for outdoor sensor networks and 02 contains zero words on it. Worse: **a strike takes out several nodes in one area at once — which is precisely the F3 signature.**

**Fix, and it strengthens your best differentiator:** cross-check F3 against a lightning-strike record the same way you cross-check vibration against the DGMS blast register. Blitzortung and IMD both publish strike data free.

That makes a **pattern**, and the pattern is stronger than any single instance:

| External record | Already exists because | Vetoes |
|---|---|---|
| DGMS Circular 7/1997 blast register | legally mandated at every Indian coal mine | vibration false positives |
| Lightning strike feed (Blitzortung / IMD) | free public data | correlated-silence false positives |
| DGMS periodic subsidence survey | legally mandated | anchor drift, absolute datum |

> **We do not add sensors to remove false positives. We add records that already exist and that somebody else is already required to keep.**

Say that sentence on stage.

Also add a **tamper bit**: the accelerometer is already on the board. A node being picked up, stolen, or hit by cattle shows a 1 g transient that no subsidence produces. Free discriminator, zero hardware.

### B8 — "we remain inside Meshtastic" is false, and it breaks your validation plan

§3.7 says choosing `NextHopRouter` is *"configuration, not a departure from the stack."* True for routing. **Not true for anything else in the document.** Meshtastic has no superframe, no beacon, no TDMA slot scheduler, no `epoch` counter, no cluster aggregation. All of that is yours.

Then §11.4 says validate with Meshtasticator, which runs real Meshtastic firmware — **so it cannot see your TDMA, because your TDMA is not in the firmware.** The validation plan is circular.

**Fix — say the true thing, which is also the better thing:**

> "Meshtastic gives us PHY configuration, packet framing, encryption, and a battle-tested flood router. The TDMA superframe is a Meshtastic module we wrote. We validate the two planes with different tools because they have different failure modes."

| Plane | Tool | Why |
|---|---|---|
| Event plane (managed flood) | **Meshtasticator** | genuinely stock behaviour; R and latency are emergent and must be measured |
| Telemetry plane (our TDMA) | **our own discrete-event sim** | deterministic schedule → collisions are impossible by construction; the only thing left to validate is link PDR, which is the link model |

> **TDMA is easier to validate than flooding, precisely because it is deterministic.** Flooding needs a simulator to tell you what it will do. A timetable does not.

### B9 — alert storm

A real event trips many nodes at once. 20 simultaneous alerts × ~25 rebroadcasts × 70 ms = **35 s of airtime in a burst**, colliding with itself, on the one plane that must not fail.

**Fix — origination suppression.** A node that hears any alert from its own cluster for the same epoch suppresses its own origination for 60 s and simply rebroadcasts. The alert is a *request for attention*, not data (02 says this correctly in §4.1) — so one is exactly as useful as five.

Keeps §9.3's D2 copy-counting metric intact.

### B10 — spare slots are in the wrong place

Slots 21–23 are three global spares. But contiguity is the whole optimisation, and re-homing a leaf to a different cluster requires a free slot **inside that cluster's contiguous block**. A global spare at slot 22 is useless to cluster C1, which owns 0–3.

**Fix:** give each cluster a 6-slot block (5 children + 1 in-block spare). 5 × 6 = 30 slots × 250 ms = 7.5 s. Fits easily in a 41 s quiet block.

Also note the resulting limit honestly: **fast failover supports intra-cluster relay promotion, not cross-cluster re-homing.** Cross-cluster moves need a `map_version` bump and the 3-cycle planned protocol. That is fine — if an entire cluster including all promotion candidates is dead, you are in F3 territory anyway and a human is already involved.

---

## 6. The rebuilt budget

All fixes applied: BW125, SF8 trunk, bitmap ACKs, SF7 direct leaves, per-cluster retry sub-slots.

### 6.1 Airtime per 60 s cycle

```
21 clustered leaves × 90 ms   (SF7/125, 37 B)      = 1890 ms
 5 cluster ACK bitmaps × 60 ms (SF7/125, 16 B)     =  300 ms
 3 direct leaves × 90 ms      (SF7/125, 37 B)      =  270 ms
 4 relays × 375 ms (121 B) + 1 × 427 ms (142 B)    = 1927 ms
 beacon (13 B, now carrying the ACK bitmap)        =   49 ms
                                            TOTAL  = 4436 ms
```

### 6.2 Verdict

| Metric | 02 claimed | **Corrected** | Limit |
|---|---|---|---|
| Carrier bandwidth | 250 kHz ❌ | **125 kHz** ✅ | 200 kHz (GSR 564(E)) |
| Channel utilisation | 5.49% | **7.4%** | 18% (ALOHA collapse) |
| Worst-node duty (relay C4) | 0.67% | **0.81%** | 1.00% (convention) |
| **Gateway duty** | **never computed** | **0.08%** | 1.00% |
| Leaf duty | 0.075% | **0.15%** | 1.00% |
| Escalation headroom | claimed 0.53% | **0.14% = one 32 B delta per 30 s** | — |
| Routine cadence | 60 s | **60 s** ✅ | — |
| Alarm latency | < 1 s | **< 1.4 s** (BW125) | — |

**The design survives the legality fix.** It loses most of its duty-cycle headroom, which is why the escalation plane had to change from rate-based to payload-based. That is the honest cost of compliance and it is worth stating as such.

### 6.3 Cadence sensitivity, corrected

| Cadence | Channel | Worst-node duty | Verdict |
|---|---|---|---|
| 120 s | 3.7% | 0.41% | conservative; this is the failover cadence |
| **60 s** | **7.4%** | **0.81%** | ✅ legal, 1.23× headroom |
| 45 s | 9.9% | 1.08% | ❌ over |
| 30 s | 14.8% | 1.62% | ❌ over |

**60 s is now the legal floor with only 23% margin, not 50%.** Even more reason it is a derived constraint rather than a preference.

---

## 7. The node-count maths

02 derives the *monitoring rectangle* from geometry and then picks 31 nodes from survey practice. That is defensible but not general — it does not tell you what to do at a different mine. Here is the general engine.

### 7.1 The inputs

| Symbol | Meaning | Source |
|---|---|---|
| `H` | working depth (m) | mine plan |
| `tanβ` | tangent of the limit angle | site subsidence data; 1.6–2.6 for Indian coalfields |
| `L`, `W` | panel length, width (m) | mine plan |
| `d_c` | **committed minimum detectable feature diameter** (m) | **your decision — and the number you publish** |
| `R_leaf`, `R_trunk` | reliable ranges | **derived** from §4's link model, never assumed |

`d_c` is the only free parameter. Everything else comes from the site. **Choosing `d_c` is the design decision; the node count is its consequence.**

### 7.2 Step 1 — geometry

```
r   = H / tanβ                       influence radius
L_m = L + 2r      W_m = W + 2r       monitoring rectangle
A   = L_m · W_m
```

### 7.3 Step 2 — the sampling scale, derived from the profile

Semi-infinite Knothe edge at x = 0:

```
S(x)  = (S_max/2)·erfc(√π·x/r)
T(x)  = dS/dx   = −(S_max/r)·e^(−πx²/r²)                    tilt, Gaussian
K(x)  = d²S/dx² = (2π·S_max·x/r³)·e^(−πx²/r²)               curvature
```

Curvature is the hard feature (02 says this and is right). Its extrema sit at `x = ±r/√(2π) = ±0.399r`. Its spatial spectrum is

```
|K̂(f)| ∝ f·e^(−π r² f²)
```

which peaks at `f = 0.399/r` and falls to 1% of peak at `f_max = 1.43/r`. Nyquist:

```
Δ_edge ≤ 1/(2·f_max) = r/2.86        →        Δ_edge = r/3
```

For `r = 75`: **Δ_edge = 25 m**. That is exactly the spacing 02 already uses in the edge zones — **now derived instead of asserted.** Use this; it is a much better answer than "three points minimum to resolve a sign change."

Flat zone (inside the panel, full subsidence, `K ≈ 0`): only `S` matters → `Δ_flat = r`.

Steep-band width: `|K| > 10%` of peak for `|x| < 1.1r`, so the steep band is **~2r wide, centred on each panel edge**.

### 7.4 Step 3 — line counts

```
N_trans = 2·(2r/Δ_edge + 1) + max(0, W/r − 3)      = 14 + max(0, W/r − 3)
N_long  = 2·(2r/Δ_edge + 1) + max(0, L/(2r) − 2)   = 14 + max(0, L/(2r) − 2)
N_lines = N_trans + N_long − 1                      (shared crossing node)
```

Check against 02's site (`r = 75`, `L = 600`, `W = 200`):

```
N_trans = 14 + max(0, 2.67 − 3)  = 14      (02 has 13 — agrees)
N_long  = 14 + max(0, 4.00 − 2)  = 16      (02 has 10 — UNDER-SAMPLED)
```

**Finding: 02's longitudinal line is ~6 nodes short of Nyquist and does not say why.**

There is a legitimate argument for relaxing it, and 02 should make it rather than leave the gap silent:

> Along the advance axis the trough edge **moves**. At a 3 m/day face advance and 60 s sampling, the moving edge is sampled in time far more finely than any spatial grid could manage. Temporal sampling substitutes for spatial sampling on the advance axis. Only the two **static** edges — start-up and stop-off — need full `Δ_edge` density.

With that argument you can defend ~12 rather than 16. You cannot defend 10 with no argument at all. **Add 2 nodes and write the sweep argument down.**

**A nice result to quote:** `N_trans` has a floor of 14 **regardless of depth**, because the trough is self-similar in units of `r` — a deeper panel has a wider trough sampled at proportionally wider spacing. Node count on the transverse line is depth-invariant. Only panel *width in units of r* increases it.

### 7.5 Step 4 — areal coverage, and the part 02 gets wrong

Lines resolve the trough. **They detect nothing off the lines.**

And this is where the PINN argument has a hole that a good judge will find:

> §2.4 claims the physics prior is *"worth 800 sensors."* It is — **for the component of the field the physics explains.** A localised anomaly (an old working collapsing, a sinkhole over a shallow gallery) is by definition the *residual* from the Knothe model. The prior buys you nothing there. Worse: with no data over the anomaly, the PINN will confidently draw a smooth Knothe surface across it and report a **low** residual.

**A physics prior compresses what it predicts. It cannot compress a surprise.**

So sampling density off the lines is set by **the smallest anomaly you commit to detecting**, not by the trough.

**The metric: largest empty circle (LEC).** Compute the Delaunay triangulation of the node set plus the rectangle boundary; the LEC is the biggest circle you can fit containing no node. Its **diameter is the largest feature you can miss entirely.**

```
d_detected = 2 · ρ_LEC
```

**I computed this for 02's actual 28-node layout:**

```
ρ_LEC = 178.9 m,  centred near (63, 25)
d_detected = 358 m
```

**02's network cannot guarantee detection of any localised feature smaller than 358 metres across.** That is the honest number, and it is nowhere in the document.

This is not a reason to panic. It is the single best thing you can put on a slide, because every other team will answer "what if something opens between your nodes?" with hand-waving, and you will answer with a computed number and a mitigation.

Inverse form, for sizing from a spec. Optimal (triangular-lattice) coverage gives:

```
N_areal ≤ 1.54 · A / d_c²
```

In practice run the greedy fill, which reuses line nodes and needs far fewer. **Measured for 02's site:**

| Target `d_c` | Extra areal nodes | Field total | Grand total (+2 anchors +1 GW) |
|---|---|---|---|
| 358 m (status quo) | 0 | 28 | **31** |
| 250 m | **+8** | 36 | **39** |
| 200 m | +15 | 43 | 46 |
| 150 m | +23 | 51 | 54 |

### 7.6 Steps 5–7 — anchors, relays, gateway

**Anchors:** `N_anchor = 2`, placed `≥ r` beyond the rectangle boundary **and** outside any mapped old workings. Two, not one, so "the anchor is broken" is distinguishable from "everything is drifting."

> **Scaling trap:** `r` grows with depth, so at `H = 400 m` the anchor must sit 200 m beyond a rectangle that is itself larger. Gate it: `R_trunk ≥ dist(gateway, anchor)`. At deep sites the anchor may need its own relay hop.

**Relays** are promoted field nodes, not extra hardware. The count is a constrained k-centre problem:

```
minimise k  s.t.  every leaf within R_leaf of some relay
                  every relay within R_trunk of the gateway
                  every relay's membership ≤ k_max
```

with `k_max` the tighter of two caps:

```
payload cap:  k ≤ (255 − 16)/21 = 11        LoRa max payload
duty cap:     T_agg(k) + T_ack ≤ 0.01 × T_super = 600 ms
              at SF8/125:  k = 6 → 427 + 60 = 487 ms ✅
                           k = 8 → 550 + 60 = 610 ms ❌
```

**`k_max = 6`, and it is duty-limited, not payload-limited.** Good number to have derived rather than chosen. 02's 5 relays for 24 leaves gives comfortable headroom.

**Gateway:** 1, at the site with mains power and a climbable structure, antenna as high as available.

### 7.7 The whole thing

```
r        = H / tanβ
A        = (L + 2r)(W + 2r)

N_lines  = 27 + max(0, W/r − 3) + max(0, L/(2r) − 2)          [floor 27]
N_areal  = greedy_fill(lines, rect, target = d_c/2)            [≤ 1.54·A/d_c²]
N_relay  = 0 additional — promoted from N_lines, count = ⌈N_leaf/6⌉

N_total  = N_lines + N_areal + 2 + 1
```

> **The line count is nearly site-invariant. The only things that make a site need more nodes are the area you must cover and the size of the smallest hole you promise to see.**

That sentence is the answer to "why thirty nodes?" — and it is a much better answer than "we chose thirty."

### 7.8 Sizing table — plug in any site

`tanβ = 2.0`, `d_c = 250 m` throughout.

| Site | H | L × W | r | Rectangle | A (ha) | N_lines | N_areal | Relays | **N_total** |
|---|---|---|---|---|---|---|---|---|---|
| Shallow, small | 100 | 400 × 150 | 50 | 500 × 250 | 12.5 | 29 | 5 | 5 | **37** |
| **02's site** | 150 | 600 × 200 | 75 | 750 × 350 | 26.3 | 29 | 8 | 5 | **39** |
| Deep, long | 300 | 1000 × 250 | 150 | 1300 × 550 | 71.5 | 29 | 19 | 8 | **51** |
| Very deep, wide | 400 | 800 × 400 | 200 | 1200 × 800 | 96.0 | 27 | 26 | 9 | **56** |

Note the shape of it: `N_lines` barely moves across a 4× depth range and an 8× area range. **All the growth is in the areal term**, i.e. in the promise you make about small features.

### 7.9 The 15-line implementation

```python
import numpy as np
from itertools import count

def size_network(H, tanb, L, W, d_c, grid=2.0):
    r = H/tanb
    x0, x1 = -r, L+r
    y0, y1 = -r, W+r

    d_edge = r/3
    trans = [(L/2, y) for y in np.arange(y0, y1+d_edge, d_edge)]
    lon   = [(x, W/2) for x in np.arange(x0, x1+d_edge, d_edge)]
    pts   = np.array(sorted(set(map(tuple, np.round(trans+lon, 1)))))

    X, Y = np.meshgrid(np.arange(x0, x1, grid), np.arange(y0, y1, grid))
    G = np.c_[X.ravel(), Y.ravel()]

    for _ in count():
        d = np.min(np.linalg.norm(G[:, None] - pts[None], axis=2), axis=1)
        i = np.argmax(d)
        if 2*d[i] <= d_c:
            break
        pts = np.vstack([pts, G[i]])          # place at the worst hole

    return dict(r=r, n_field=len(pts),
                n_relay=int(np.ceil(len(pts)/6)),
                n_total=len(pts)+3,           # +2 anchors +1 gateway
                d_detected=2*d[i], layout=pts)
```

Run it once at build time, write the output into `nodes.json`, and put `d_detected` on the dashboard. **Publishing your own blind-spot diameter is the most credible thing in the whole submission.**

---

## 8. New gates

Add to the gate table in 02 §14.

| Test | Asserts |
|---|---|
| **T18** | Carrier bandwidth ≤ 200 kHz on every configured preset. *Regulatory, non-negotiable* |
| **T19** | **Gateway** measured duty cycle < 1.0% over the full run — the node 02 never tested |
| **T20** | `largest_empty_circle(nodes) × 2 ≤ d_committed`, and `d_committed` appears in the dashboard header |
| **T21** | Every `(node, parent)` **and** `(node, backup_parent)` pair has margin ≥ 10 dB at the 90th shadowing percentile — not just "in range" |
| **T22** | `relay_kill` injection produces an **F4**, never an F3. *The false-Class-A test* |
| **T23** | `epoch` is uint32 everywhere; a 100-day synthetic run produces no upsert collision |
| **T24** | Simulated 3 h beacon outage: static-slot fallback produces zero slot collisions (proves the CAD fix) |
| **T25** | 20 simultaneous node trips produce ≤ 3 originated alerts (proves suppression) |
| **T26** | Measured relay RX duty ≤ 4× leaf RX duty (proves the retry sub-slot, not the assumption) |

---

## 9. Edit list for 02

**Delete:**
- §3.1's reachability table and the sentence *"roughly half the field physically cannot reach the gateway"*
- `reliable_range_m` and `reliable_range_masted_m` as independent constants
- The claim that 1% duty cycle is Indian law

**Change:**
- All presets to explicit `{sf, bw_khz}` at BW125; relay trunk SF9 → SF8; direct leaves SF9 → SF7
- `erp_dbm: 30` → `erp_dbm: 36` with `tx_conducted_dbm: 30`
- `epoch` to uint32
- Escalation from rate-based to payload-based
- Cluster blocks to 6 slots each; contention window to 16 backup slots; replay to the quiet block
- Failure classes from eight to ten

**Add:**
- Bitmap ACK, both directions
- Per-cluster retry sub-slot
- CAD-before-slot in beacon-loss fallback
- F3 backup-slot + precursor discriminators
- Alert origination suppression
- `d_committed` and `d_detected` to `nodes.json` and the dashboard
- The derivation in §7 as the answer to "why this many nodes"

**Reframe (same facts, better argument):**
- Relays exist for **airtime and redundancy**; the mast is what makes the direct fallback real for every node
- Meshtastic supplies PHY, framing, encryption and the flood router; the TDMA plane is yours, and it is *easier* to validate because it is deterministic
