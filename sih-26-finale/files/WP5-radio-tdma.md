# WP5 — TDMA Radio Simulation

| | |
|---|---|
| **Owner** | Antigravity (Lane D) |
| **Depends on** | WP-C stubs; readings from WP4, layout from WP2 |
| **Blocks** | WP6 |
| **Days** | D1–D4 |
| **Gates** | G7, G8, G9, G10, G11 |

## Goal

Simulate the LoRa mesh carrying readings from Scouts to Anchors to Gateway, on a real schedule, with real airtimes, real duty-cycle limits, real packet loss and real failover. Output is a per-packet record including the ones that never arrived.

Lane D can start on D1 against contract stubs: the radio simulation needs only the **shape** of `Layout` and `Reading`, not their contents.

## Files owned

```
src/minesim/packet.py
src/minesim/radio.py
tests/unit/test_radio.py
tests/gates/test_g07.py … test_g11.py
```

## Hardware analogy, for anyone who needs it

Think of the whole network as a village where everyone has a walkie-talkie but only one person may speak at a time, or all the voices mush together.

So the village agrees a timetable. A clock tower (the **Gateway**) rings a bell at the top of every minute. Each villager (**Scout**) has a personal ten-second window when they and nobody else may speak. They say one short sentence — about 62 milliseconds' worth — then **switch the walkie-talkie off entirely and go to sleep**, because holding it switched on listening is what drains the battery, not the talking.

A few villagers are **Anchors**: they stay awake through the whole window, listen to their six assigned neighbours, and later shout one combined summary up to the clock tower.

At a fixed moment the Anchor reads out a single list — "I heard 1, 2, 4, 5, 6" — instead of replying to each villager separately. Anyone who does not hear their own number knows their Anchor has gone deaf or died, and uses a reserved emergency minute to shout louder to a **backup** Anchor instead.

Everything below is that, with numbers.

## Binding radio facts

Under A11/A12 — BW125, CR 4/5, explicit header, CRC on, 8-symbol preamble. **The 90.4 ms airtime figure in earlier documents is wrong and matches no valid configuration.**

| Payload | SF7 | SF8 | SF9 |
|---|---|---|---|
| 23 B scout uplink | **61.7 ms** | 113.2 ms | 205.8 ms |
| 98 B anchor bundle (6 × 15 B + 8 B hdr) | 169.2 ms | **297.5 ms** | 533.5 ms |
| 6 B bitmap ACK | **36.1 ms** | 65.9 ms | 118.6 ms |
| 1 B minimum | 25.9 ms | 51.7 ms | 103.4 ms |

A "20 ms ACK" cannot exist — the preamble alone costs 12.5 ms at SF7. Compute airtime from the LoRa formula in code and **assert it against this table in a test**; do not hardcode the table as the implementation.

### Duty cycle, against the 600 ms / 60 s ceiling

**The Scout was never the constraint. The Anchor is.**

| Tier | Transmits per frame | Airtime | Duty |
|---|---|---|---|
| Scout | 1 × 23 B uplink | 61.7 ms | 0.10% |
| Scout with emergency retx | 2 × 23 B | 123.4 ms | 0.21% |
| Anchor | bitmap + bundle @ SF8 | 333.6 ms | **0.56%** |
| Anchor if backbone were SF9 | bitmap + bundle @ SF9 | 569.6 ms | 0.95% — no retry room |
| Gateway | 1 beacon | 82.4 ms | 0.14% |

The 1% ceiling is **self-imposed**, adopted from LPWAN practice. GSR 564(E) regulates power (1 W ERP) and bandwidth (200 kHz cap, which is why BW250 is non-compliant), **not** duty cycle. Do not write a comment claiming Indian law mandates 1%.

### Superframe schedule, 60 s period

| t | Event | Airtime |
|---|---|---|
| 0.0 s | Gateway beacon: time sync + bitmap ACK for Anchors | 82 ms, SF8 |
| 2.0 s | Scout uplink window opens — 30 Scouts / 4 channels, slot = 61.7 ms + 30 ms guard = 92 ms | |
| 11.5 s | Scout uplink window closes | |
| 12.0 s | Anchor broadcasts single bitmap ACK | 36 ms, SF7 |
| 13.0 s | Anchor → Gateway bundle, 2 backbone channels | 298 ms, SF8 |
| 15.5 s | Emergency window opens, 8 sub-slots × 92 ms = 736 ms | |
| 16.5 s | All tiers sleep until the next frame | |

Capacity is not a constraint — one SF7 channel fits 510 slots per frame, so the 4-channel plan has roughly 20× headroom at 30 nodes. Do not optimise it.

## The three bugs this package exists to not have

### 1. Dedup key is `(node_id, epoch)`

**Never `(node_id, seq)`.** Sequence numbers reset on node reboot, which silently merges two distinct packets into one and destroys valid data with no error anywhere. `epoch` comes from the network beacon and is monotonically stable across reboots.

`seq` stays in the packet as a diagnostic field. It must never appear in a dict key, a set membership test, or a dedup comparison. G7.

### 2. Emergency sub-slot is `child_index`, not `node_id % 16`

The realistic failure is **one Anchor dying and orphaning all six of its children simultaneously**. Under `node_id % 16`, two children with IDs congruent mod 16 — say 7 and 23 — land in the same sub-slot and collide, in precisely the scenario the mechanism exists to survive.

`child_index` is 0–7, unique within a parent by construction, needs no ID-assignment discipline, and is already in the layout. G10, G11.

### 3. Per-device ACKs do not exist

One bitmap ACK per Anchor covers every child at once, 6 bytes, 36 ms. Six individual ACKs cost 155 ms and pushed the Anchor to 1.15% at SF9. Do not reintroduce them as a "reliability improvement".

## Scout receive discipline — the power-critical rule

A Scout transmits around t = 2.1 s. Its ACK does not arrive until t = 12.0 s. **It sleeps in between and wakes on a timer.**

| Behaviour | Receive duty | Radio average current |
|---|---|---|
| Listens continuously until the beacon | 16.5% | ~1.82 mA |
| Sleeps, wakes only for the beacon | ~0.3% | ~0.04 mA |

45×. Continuous listening defeats the entire purpose of the TDMA design. The simulation must model and report receive duty so G9 can check it.

Related, for the record rather than for implementation: the Anchor **cannot run on battery alone** — it listens through the whole 9.5 s Scout window at 2.43 mA, giving 62 days at derate against a 365-day target. Anchors get a 1 W solar panel; the 18650 pack becomes a monsoon buffer. Scouts pass comfortably at 433 days.

## Loss model

Free-space path loss plus a margin check. The short hops are robust on raw margin, not range: 86 dB over SF7 sensitivity at 40 m, 74 dB at 150 m. At 865 MHz rain and dust are practically irrelevant — **vegetation and terrain are what matter**. No dust attenuation term.

Baseline loss: a per-packet Bernoulli drop with probability from config, plus deterministic drops when a link fails its margin check. Keep it simple; G8 and G9 are about the schedule, not about a sophisticated channel model.

Undelivered packets still produce a `TxRecord` with `delivered=False`. **Packet loss is a normal operating condition for Part 2, not an error case.**

## Tests

| Test | Assertion |
|---|---|
| Airtime | Computed airtimes match the table above to within 0.5 ms |
| No overlap | No two Scouts on the same channel occupy overlapping slots |
| Window fit | Worst channel occupancy fits inside the 9.5 s uplink window |
| Bundle size | 98 B bundle carries 6 × 15 B children plus an 8 B header |
| Bitmap ACK | 1-byte bitmap covers up to 8 children; every child's bit is correctly set |
| Failover | Killing an Anchor sends all its children to their backups via the emergency window |
| Emergency fit | 8 sub-slots × 92 ms = 736 ms, inside the 1 s window |
| Loss recorded | Undelivered packets appear as rows with `delivered=False` |

### Gate tests

- **G7** — grep-style AST check that `seq` never appears in a dict key, set element or dedup comparison; plus a runtime test where two packets share a `seq` after a simulated reboot and both survive dedup.
- **G8** — Anchor duty ≤ 1% at the configured backbone SF. Also assert SF9 **exceeds** the practical ceiling, proving the test has teeth.
- **G9** — Scout receive time < 0.5 s per superframe.
- **G10** — sub-slot assignment is a pure function of `child_index`; AST check that no `% 16` or `% max_children` appears on a `node_id`.
- **G11** — **exhaustive.** Generate many random `node_id` assignments, including deliberately adversarial ones congruent mod 16, and assert no two children of one Anchor ever share a sub-slot. This gate must be impossible to pass by luck.

## Definition of done

- [ ] All tests and G7–G11 pass
- [ ] Airtime computed from the LoRa formula, asserted against the table
- [ ] `TxRecord` emitted for every packet including undelivered
- [ ] Receive duty tracked and reported per tier
- [ ] No numeric constant from the assumption register in the file

## Do not

- Use `seq` in any key or comparison.
- Use `node_id % anything` for slot assignment.
- Reintroduce per-device ACKs.
- Model a Scout that holds the radio in receive.
- Add a dust or rain attenuation term.
- Claim in a comment that 1% duty cycle is legally mandated in India.
- Build a sophisticated channel model. Simplest version that passes the gates.
