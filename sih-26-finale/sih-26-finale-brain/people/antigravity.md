---
title: Antigravity
slug: antigravity
type: person
module: governance
status: reviewed
tags: [agent, antigravity, lane-c, lane-d, world-state, sensors, radio, stream]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/10-build-order-v1.md
---

# Antigravity

| Field | Details |
|---|---|
| **Role** | Autonomous Coding Agent — Lanes C & D |
| **Lane Ownership** | **Lane C:** [[work-packages/WP3-world-state-engine\|WP3]], [[work-packages/WP4-sensor-models-provenance\|WP4]]<br/>**Lane D:** [[work-packages/WP5-radio-tdma\|WP5]], [[work-packages/WP6-stream-and-output\|WP6]] |
| **Files Owned** | `src/minesim/world.py`, `src/minesim/sensors.py`, `src/minesim/provenance.py`, `src/minesim/packet.py`, `src/minesim/radio.py`, `src/minesim/stream.py`, `src/minesim/run.py` |
| **Primary Gates Owned** | [[gates/G04-provenance-tags-on-every-row\|G04]], [[gates/G05-synthetic-grounded-in-observed-data\|G05]], [[gates/G06-bit-identical-terrain-replay\|G06]], [[gates/G07-dedup-by-node-and-epoch\|G07]], [[gates/G08-anchor-duty-cycle-under-one-percent\|G08]], [[gates/G09-scout-receive-under-half-second\|G09]], [[gates/G10-emergency-slot-from-child-index\|G10]], [[gates/G11-no-emergency-subslot-collisions\|G11]], [[gates/G13-live-z-owned-by-world-state\|G13]] |

---

## 1. Responsibilities

- **Lane C (World State & Sensors):**
  - Constructing the `np.int32` integer-millimetre surface deformation grid and append-only delta logger (`terrain_changes.jsonl`).
  - Implementing bilinear interpolation for `z_at(x, y)` to provide live node elevation.
  - Implementing sensor noise models, thermal drift, quantization, and immutable provenance tagging (`real`, `pinned`, `synthetic`).
- **Lane D (Radio Simulation & Streaming Output):**
  - Building the 60-second TDMA superframe, Semtech LoRa airtime calculator ($61.7\text{ ms}$ uplinks), and log-distance channel loss.
  - Preventing hash collisions in failover via `child_index` emergency slots.
  - Streaming outputs via `nodes.csv`, `terrain_state.npz`, and low-latency FastAPI WebSocket `/ws/run`.

---

## 2. Key Invariant Constraints

- Never use floating-point numbers in the accumulating terrain grid (violates Gate G06).
- Never use sequence number `seq` as a deduplication key (violates Gate G07).
- Never derive emergency transmission slots from `node_id % 16` (violates Gates G10, G11).
- Never emit a telemetry reading without a valid paired `_prov` tag (violates Gate G04).
- Never mutate `node.z0_mm` after initialization (violates Gate G13).

---

## 3. Related Links

- **Work Packages:** [[work-packages/WP3-world-state-engine]], [[work-packages/WP4-sensor-models-provenance]], [[work-packages/WP5-radio-tdma]], [[work-packages/WP6-stream-and-output]]
- **Peer Lanes:** [[people/adarsh-agarwala]] (Lane A), [[people/claude-code]] (Lane B)
