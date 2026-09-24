---
title: Mesh Routing, Clustering & Relay Topology
slug: mesh-routing-and-relay-topology
type: concept
module: radio
status: reviewed
tags: [radio, mesh, routing, anchors, scouts, gateway, fresnel-zone, clustering]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP2-sizing-algorithm.md
---

# Mesh Routing, Clustering & Relay Topology

Architectural overview of the 3-tier hierarchical star-of-stars LoRa network topology deployed over the active longwall mining panel.

---

## 1. Network Hierarchy & Role Separation

```mermaid
flowchart TD
    GW["Gateway (Node 0)<br/>10m Mast, Concentrator, Mains Power"]
    A1["Anchor 1 (Node 1)<br/>SF8 Backbone"]
    A2["Anchor 2 (Node 2)<br/>SF8 Backbone"]
    A3["Anchor 3 (Node 3)<br/>SF8 Backbone"]

    S1["Scout 101 (1A)"]
    S2["Scout 102 (1B)"]
    S3["Scout 103 (1C)"]
    S4["Scout 104 (1A)"]

    GW === A1
    GW === A2
    GW === A3

    A1 --- S1
    A1 --- S2
    A2 --- S3
    A3 --- S4

    S1 -. Backup Hop .-> A2
```

- **Scout Nodes (Tier 1):** Low-cost, battery-powered surface sensors. Transmit directly to assigned Anchor at SF7.
- **Anchor Nodes (Tier 2):** Intermediate aggregation relays. Receive up to 8 Scout uplinks, issue bitmap ACK, assemble 98 B backbone bundle, and transmit to Gateway at SF8.
- **Gateway (Base Station):** Central receiver with LTE/SCADA backhaul, broadcasts master time synchronization beacons at $t=0.0\text{ s}$.

---

## 2. Clustering & Child Index Discipline

During sizing execution in `src/minesim/sizing.py` ([[work-packages/WP2-sizing-algorithm|WP2]]):
- Scouts are assigned to the geographically nearest Anchor satisfying line-of-sight and Fresnel clearance.
- **Max Children per Anchor:** $\le 8$ nodes (Assumption `layout.max_children_per_anchor`).
- **`node.child_index`:** Index ($0..7$) within the parent cluster. Drives collision-free emergency retransmission slots ([[gates/G10-emergency-slot-from-child-index|Gate G10]]).
- **`node.backup_parent_id`:** Secondary Anchor assigned to receive emergency transmissions if primary Anchor fails.

---

## 3. Fresnel Zone & RF Obstruction Verification

Between every node pair $(i, j)$, sizing calculates first Fresnel zone radius $F_1$:
$$F_1 = 17.32 \sqrt{\frac{d_{km}}{4 \cdot f_{GHz}}} \approx 8.66 \sqrt{\frac{d_{km}}{0.865}} \text{ metres}$$
Where the ground surface deforms dynamically, antenna heights ($2.0\text{ m}$ for Scout/Anchor, $10.0\text{ m}$ for Gateway) guarantee $60\%$ clearance above maximum expected subsidence trough slopes.

---

## 4. Cross-References

- **Sizing Algorithm:** [[work-packages/WP2-sizing-algorithm]]
- **Superframe Timing:** [[notes/mesh-and-radio/lora-tdma-superframe-and-timing]]
- **Failover & Emergency:** [[notes/mesh-and-radio/emergency-alert-and-dedup]]
