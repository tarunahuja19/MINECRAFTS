---
title: "WP6 — Stream and Output Layer"
slug: WP6-stream-and-output
type: work-package
module: stream
status: reviewed
tags: [work-package, wp6, stream, output, csv, npz, jsonl, websocket, fast-api]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP6-stream-and-output.md
---

# WP6 — Stream and Output Layer

| Field | Details |
|---|---|
| **Owner** | [[people/antigravity\|Antigravity]] (Lane D) |
| **Depends on** | [[work-packages/WP5-radio-tdma\|WP5]] |
| **Blocks** | Handoff to Part 2 (Forecasting ML) and Part 3 (React 3D Dashboard) |
| **Days Scheduled** | D5–D6 |
| **Supports Gates** | [[gates/G04-provenance-tags-on-every-row\|G04]], [[gates/G06-bit-identical-terrain-replay\|G06]] |

---

## 1. Goal

Generate the three permanent data artefacts (`nodes.csv`, `terrain_state.npz`, `terrain_changes.jsonl`) required for replay and ML training, and provide a low-latency FastAPI WebSocket stream (`/ws/run`) for live 3D dashboard visualization.

---

## 2. Files Owned

```
src/minesim/stream.py
src/minesim/run.py
tests/unit/test_stream.py
```

---

## 3. The Three Storage Artefacts

| Artefact | Schema & Format | Role in System |
|---|---|---|
| `out/nodes.csv` | Positional CSV with paired `_prov` columns. | Training dataset for Part 2 forecasting model. |
| `out/terrain_state.npz` | Compressed NumPy array of $t=0$ integer-mm elevations + grid metadata. | Pre-mining baseline state. |
| `out/terrain_changes.jsonl` | Append-only log of non-zero integer-mm surface deltas per epoch. | Replay engine for 3D timeline scrub (supports [[gates/G06-bit-identical-terrain-replay\|Gate G06]]). |

### Mandatory `nodes.csv` Sequence
```csv
epoch,t_s,node_id,tier,x_m,y_m,z0_mm,subsidence_mm,subsidence_prov,tilt_x_urad,tilt_y_urad,tilt_prov,strain_ustrain,strain_prov,disp_mm,disp_prov,battery_mv,rssi_dbm,parent_used,delivered,via_emergency
```

> [!IMPORTANT]
> **Explicit Undelivered Records:** When a packet is lost in [[work-packages/WP5-radio-tdma|WP5]], a row is still written with `delivered=false`. A dropped row is indistinguishable from a node that never existed.

---

## 4. FastAPI Live WebSocket Stream (`/ws/run`)

Broadcasts one JSON frame per simulated superframe to connected 3D dashboards:
```json
{
  "type": "frame",
  "epoch": 1,
  "t_s": 3600.0,
  "sim_days": 0.042,
  "face_x_m": 4.0,
  "deltas": [[120, 44, -3]],
  "nodes": [
    {
      "node_id": 100,
      "subsidence_mm": -3.2,
      "prov": "pinned",
      "tilt_urad": [1.1, -0.4],
      "strain_ustrain": null,
      "delivered": true,
      "rssi_dbm": -37.0
    }
  ]
}
```

### Client Control Protocol
- Start / Resume: `{"type": "start", "from_day": 0}`
- Pause: `{"type": "pause"}`
- Seek to Timeline Day: `{"type": "seek", "to_day": 120}`

> [!CAUTION]
> **No Manual Deformation:** The client can control playback timing, but cannot deform the ground or trigger seismic events. Deformation is governed strictly by ground truth physics.
