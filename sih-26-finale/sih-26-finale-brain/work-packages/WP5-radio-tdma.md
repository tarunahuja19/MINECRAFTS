---
title: "WP5 — TDMA Radio Simulation"
slug: WP5-radio-tdma
type: work-package
module: radio
status: reviewed
tags: [work-package, wp5, lora, tdma, superframe, airtime, duty-cycle, dedup, failover]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP5-radio-tdma.md
---

# WP5 — TDMA Radio Simulation

| Field | Details |
|---|---|
| **Owner** | [[people/antigravity\|Antigravity]] (Lane D) |
| **Depends on** | [[work-packages/WPC-contracts-and-skeleton\|WP-C]] stubs; consumes `Layout` ([[work-packages/WP2-sizing-algorithm\|WP2]]) and `Reading` ([[work-packages/WP4-sensor-models-provenance\|WP4]]) |
| **Blocks** | [[work-packages/WP6-stream-and-output\|WP6]] |
| **Days Scheduled** | D1–D4 |
| **Enforces Gates** | [[gates/G07-dedup-by-node-and-epoch\|G07]], [[gates/G08-anchor-duty-cycle-under-one-percent\|G08]], [[gates/G09-scout-receive-under-half-second\|G09]], [[gates/G10-emergency-slot-from-child-index\|G10]], [[gates/G11-no-emergency-subslot-collisions\|G11]] |

---

## 1. Goal

Simulate the transmission of sensor readings over a hierarchical LoRa TDMA mesh network (Scouts $\to$ Anchors $\to$ Gateway) under real PHY airtimes, a 60-second superframe schedule, duty cycle constraints, log-distance path loss, packet collisions, and multi-tier failover.

---

## 2. Files Owned

```
src/minesim/packet.py
src/minesim/radio.py
tests/unit/test_radio.py
tests/gates/test_g07.py
tests/gates/test_g08.py
tests/gates/test_g09.py
tests/gates/test_g10.py
tests/gates/test_g11.py
```

---

## 3. LoRa PHY Constants & Corrected Airtimes

Calculated for IN865 band (125 kHz BW, CR 4/5, explicit header, CRC on, 8-symbol preamble):

| Packet Type | Size | SF7 Airtime | SF8 Airtime | Notes |
|---|---|---|---|---|
| Scout Uplink | 23 B | **$61.7\text{ ms}$** | $113.2\text{ ms}$ | $90.4\text{ ms}$ figure in older notes is invalid. |
| Anchor Bundle | 98 B | $169.2\text{ ms}$ | **$297.5\text{ ms}$** | 6 child payloads + 8 B header. |
| Bitmap ACK | 6 B | **$36.1\text{ ms}$** | $65.9\text{ ms}$ | Single ACK covers all 8 children. |
| Gateway Beacon | 16 B | $51.7\text{ ms}$ | **$82.4\text{ ms}$** | Master network time reference. |

---

## 4. Superframe Schedule (60 s Cadence)

```
0.0s          2.0s                     11.5s 12.0s  13.0s                15.5s    16.5s              60.0s
|-- Beacon ---|--- Scout Uplink Window ---|--|-- ACK --|-- Anchor Backbone --|-- Emerg --|---- Deep Sleep ----|
   82.4ms         4 channels, 92ms slots        36.1ms      297.5ms (SF8)        736ms         All Tiers
```

### Scout Receiver Sleep Discipline (Gate G09)
A Scout transmits around $t = 2.1\text{ s}$ but the Anchor's bitmap ACK is not broadcast until $t = 12.0\text{ s}$. The Scout **must sleep immediately after transmission** and wake on a low-power timer. Remaining awake in receive drains $1.82\text{ mA}$ versus $0.04\text{ mA}$ for timer sleep (a $45\times$ power penalty that destroys battery life).

---

## 5. Three Critical Bugs WP5 Exists to Prevent

### 1. Dedup Key is `(node_id, epoch)` (Gate G07)
Never use packet sequence number `seq` as a deduplication key. Sequence numbers reset when a node reboots, silently dropping valid new data. Network `epoch` is monotonic and immune to local resets.

### 2. Emergency Sub-Slot is `child_index` (Gates G10, G11)
When an Anchor fails, all its children simultaneously attempt failover to a backup Anchor. If slots are assigned via `node_id % 16`, congruent IDs collide and corrupt the emergency window. `child_index` ($0..7$) is guaranteed unique per cluster by construction.

### 3. Bitmap ACKs (Gate G08)
Anchors broadcast a single 6-byte bitmap ACK ($36.1\text{ ms}$) covering all children. Individual per-device ACKs would require $6 \times 36.1 = 216.6\text{ ms}$, breaching the $1.0\%$ duty cycle ceiling.
