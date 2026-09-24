---
title: "Gate G07 — Deduplication Uses (node_id, epoch)"
slug: G07-dedup-by-node-and-epoch
type: gate
module: radio
status: reviewed
tags: [gate, g07, radio, dedup, packet, reboot-safe, epoch]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP5-radio-tdma.md
---

# Gate G07 — Deduplication Uses (node_id, epoch)

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP5-radio-tdma\|WP5]] |
| **Owner** | [[people/antigravity\|Antigravity]] |
| **Verification Target** | Mesh deduplication reliability across node reboots |
| **Test Script** | `tests/gates/test_g07.py` |

---

## 1. Assertion

All packet deduplication logic in the radio simulation and gateway buffers uses strictly the composite key `(node_id, epoch)`. The packet sequence number `seq` must never appear as a deduplication key, dictionary index, or set element.

---

## 2. Technical Rationale

Nodes in open-cast or underground coal mines experience frequent brownouts and watchdog resets. Upon reboot, `seq` resets to $0$. If deduplication is keyed on `(node_id, seq)`, post-reboot packets collide with pre-reboot history, resulting in silent data loss. Network `epoch` is synchronized via the Gateway beacon and increments monotonically across the entire deployment.

---

## 3. Negative Case

Injecting two consecutive packets with identical `seq=0` but distinct epochs `epoch=10` and `epoch=11` must result in both packets being accepted. If the second packet is dropped as a duplicate, Gate G07 fails.
