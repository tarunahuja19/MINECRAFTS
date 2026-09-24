---
title: "Master Process Explainer: System Architecture & Workflow"
slug: master-process-explainer
type: doc
module: governance
status: reviewed
tags: [explainer, architecture, workflow, file-map, parallel-lanes, analogies]
created: 2026-09-14
updated: 2026-09-14
author: adarsh
last_agent_edit: antigravity
source_file: explainers/00_master_process_explainer.md (source folder removed 2026-09-14; this note is the canonical copy)
---

# Master Process Explainer: What We Are Building & How

---

## 1. What Is This Project? (The Real-World Problem)

When coal companies mine underground using **Longwall Mining**, a massive shearing machine cuts out giant slabs of coal 200 to 400 meters below the surface. As the machine moves forward, the roof behind it is deliberately allowed to collapse into the void (called the *goaf*).

Over the course of weeks and months, that underground collapse ripples upward through hundreds of meters of rock until the actual ground on the surface begins to sink. This ground sinking is called **subsidence**.

```
  Surface Ground Level  ─────┬─────────────┬─────────────
                             │  (Sensors)  │
                             ▼             ▼
  Overburden Rock Layers    [ Sagging & Fracturing ]
                             │             │
                             ▼             ▼
  Underground Coal Seam    [ Extracted Void / Caved Goaf ] (300m deep)
```

If roads, railway tracks, pipelines, or houses sit above this area, the ground stretching (tensile strain) or tilting can crack foundations, derail trains, or cause sudden catastrophic collapses.

### Our Solution
We are building a **production-grade Mine Subsidence Simulator & IoT Early-Warning Network (`minesim`)**. 
Our software does three things:
1. **Accurately predicts how the ground moves** over 600+ days using real mining physics ([[notes/physics/knothe-time-dependent-model|Knothe time-dependent model]]).
2. **Simulates smart wireless sensors (Scout & Anchor nodes)** scattered across the surface terrain, measuring ground tilt, stretch, and elevation.
3. **Simulates a rugged LoRa wireless mesh network** that transmits telemetry through bad weather, packet loss, and battery brownouts to trigger life-saving early warnings before the ground gives way.

See also the [[docs/wp0-data-pinning-guide|WP0 Field Data Guide]] and [[docs/architectural-decisions-and-analogies|Architectural Decisions & Analogies]].

---

## 2. The 4-Stage Simulator Pipeline

To keep the system modular and testable, our simulation flows in a strict 4-stage assembly line:

```
[ Stage 1: Physics Engine ]
  Calculates true theoretical ground subsidence S(x, y, t), slope, and tensile strain.
            │
            ▼
[ Stage 2: World State Engine ]
  Maintains the accumulating ground elevation on a grid in exact integer millimeters (int32).
            │
            ▼
[ Stage 3: Sensor Hardware Models ]
  Places virtual sensors on the terrain. Adds real-world sensor imperfections:
  thermal drift, mounting misalignment, battery noise, and quantization.
            │
            ▼
[ Stage 4: Wireless LoRa Mesh & Stream ]
  Packs sensor readings into compact 12-byte binary packets. Simulates a 60-second
  TDMA radio superframe, packet collisions, relay failover, and streams live telemetry.
```

---

## 3. How We Build It: The 4-Lane Parallel System

Instead of one developer writing everything linearly and getting stuck, the build is divided into **4 parallel lanes** with strictly frozen contracts defined in [[docs/interface-contracts|Interface Contracts]]:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Day 0: WP-C Scaffolding                         │
│       Create frozen contracts, config loader, dataclasses, and stubs   │
└────────────┬───────────────┬────────────────┬─────────────────┬────────┘
             │               │                │                 │
             ▼               ▼                ▼                 ▼
        [ Lane A ]      [ Lane B ]       [ Lane C ]        [ Lane D ]
     [[people/adarsh-agarwala|Adarsh]]   [[people/claude-code|Claude Code]]   [[people/antigravity|Antigravity]]   [[people/antigravity|Antigravity]]
      ────────────    ─────────────    ─────────────     ─────────────
          [[work-packages/WP0-data-pinning|WP0]]              [[work-packages/WP1-core-physics|WP1]]              [[work-packages/WP3-world-state-engine|WP3]]               [[work-packages/WP5-radio-tdma|WP5]]
     (Real Data       (Knothe Core      (World State      (LoRa Radio
      Pinning)          Physics)          Engine)           Mesh)
                           │                │                 │
                           ▼                ▼                 ▼
                          [[work-packages/WP2-sizing-algorithm|WP2]]              [[work-packages/WP4-sensor-models-provenance|WP4]]               [[work-packages/WP6-stream-and-output|WP6]]
                      (Auto-Sizing      (Sensors &        (Telemetry
                        Layout)        Provenance)         Stream)
                           │
                           ▼
                          [[work-packages/WP7-gate-harness|WP7]] (16 Verification Gates)
             │               │                │                 │
             └───────────────┴────────────────┴─────────────────┘
                                     │
                                     ▼
                      Day 7: Full Integration Day
                                     │
                                     ▼
                      Day 9: Final Freeze & Package
```

### Why this works without conflicts:
Every lane has its own dedicated files. For example, Lane C imports `physics.py` from Lane B, but **never edits it**. Because the function signatures and dataclasses are frozen in [[docs/interface-contracts|Interface Contracts]] on Day 0, everyone can write tests and code simultaneously against stubs. Read [[notes/safety-and-governance/four-lane-parallel-build-system|Four-Lane Parallel System]] for detailed protocols.

---

## 4. File-by-File Guide: What Every File Does

Here is the blueprint of every file in the project, what it does, and who owns it:

### Configuration (`config/`)
- `config/assumptions.yaml`: Holds every physical constant, default sensor precision, and radio frequency. See [[docs/assumption-register|Assumption Register]].
- `config/mines/adriyala_lw1.yaml`: Specific parameters for the Adriyala Longwall mine (depth, panel width, extraction speed). Parameters like seam height and subsidence factor start as `null` and are filled by [[work-packages/WP0-data-pinning|WP0]] fitting.
- `config/mines/illinois_lw.yaml`: Secondary test mine from the US NIOSH study. Enforces [[gates/G15-config-driven-mine-independence|Gate G15]].

### Source Code (`src/minesim/`)

| File | What It Does | Analogy | Owner |
|---|---|---|---|
| `config.py` | Loads YAML configs, validates types, and crashes immediately if any required real parameter is `null`. | The **Security Guard** checking IDs before anyone enters the building. | Lane A / Shared |
| `physics.py` | Contains the single, authoritative `subsidence(x, y, t)` function using the Knothe Gaussian curve formula, plus numerical derivatives for tilt and strain. Enforced by [[gates/G01-single-physics-implementation|Gate G01]]. | The **Laws of Nature** calculating how rock deforms under gravity. | Lane B |
| `sizing.py` | Takes mine dimensions and computes optimal 30-node sensor layout with 50m spacing and RF Fresnel line-of-sight. Enforced by [[gates/G02-no-node-count-parameter|Gate G02]]. | The **Architect** deciding where to place fire alarms in a building. | Lane B |
| `world.py` | Tracks the entire surface grid over 690 days. Uses integer millimeters (`int32`) to prevent floating-point rounding drift. Enforced by [[gates/G06-bit-identical-terrain-replay|Gate G06]]. | The **Ledger** recording exact ground elevation day by day. | Lane C |
| `sensors.py` | Simulates tiltmeters, wire extensometers, and GNSS receivers. Adds temperature drift, mounting tilt, and sensor noise. | The **Camera Lens** that captures the world, but with realistic glare and blur. | Lane C |
| `provenance.py` | Tags every single data point as `real`, `pinned`, or `synthetic`. Enforced by [[gates/G04-provenance-tags-on-every-row|Gate G04]]. | The **Nutrition Label** stating whether ingredients are natural or artificial. | Lane C |
| `packet.py` | Encodes sensor readings into tiny, efficient 12-byte binary radio packets for LoRa transmission. | Packing a suitcase into an **airline carry-on** that fits exact size limits. | Lane D |
| `radio.py` | Simulates the 60-second LoRa TDMA superframe, airtime physics (SF7/SF8), relay links, collisions, and anchor failovers. Enforces [[gates/G07-dedup-by-node-and-epoch|Gate G07]], [[gates/G08-anchor-duty-cycle-under-one-percent|G08]], [[gates/G10-emergency-slot-from-child-index|G10]], [[gates/G11-no-emergency-subslot-collisions|G11]]. | The **Air Traffic Controller** assigning time slots so radio signals don't crash. | Lane D |
| `stream.py` | Writes `nodes.csv` output and powers a live WebSocket server streaming real-time terrain updates. | The **Broadcaster** streaming live sports footage to TVs. | Lane D |
| `run.py` | The main CLI entry point. Runs the full 690-day simulation from start to finish with one command. | The **Ignition Key** that starts the entire car. | Shared |

### Data (`data/`)
- `data/real/adriyala_lw1_profiles.csv`: Real surface subsidence monument readings digitised from the Adriyala research paper.
- `data/fitted/adriyala_lw1_params.json`: Output of the curve fitting script with calculated subsidence factors and mathematical fit residuals.

### Verification Harness (`tests/`)
- `tests/test_gates.py`: Contains the [[docs/gates-registry|16 non-negotiable Gates (G00–G15)]]. Every gate tests an invariant (e.g. bit-identical replay, zero neural networks in safety alarms, collision-free emergency slots).

---

## 5. Master 10-Day Timeline

```
Day 0: Project Scaffolding ([[work-packages/WPC-contracts-and-skeleton|WP-C]])
       ├── pyproject.toml and virtual environment setup
       ├── config/ YAML files created with nulls for unpinned parameters
       └── src/minesim/ module stubs with complete type annotations

Days 1–4: Parallel Lane Development
       ├── Lane A: [[work-packages/WP0-data-pinning|WP0]] Data extraction, digitisation, and least-squares fitting
       ├── Lane B: [[work-packages/WP1-core-physics|WP1]] Core physics S(x,y,t) and [[work-packages/WP2-sizing-algorithm|WP2]] 30-node sizing layout
       ├── Lane C: [[work-packages/WP3-world-state-engine|WP3]] World state int32 grid and [[work-packages/WP4-sensor-models-provenance|WP4]] sensor noise models
       └── Lane D: [[work-packages/WP5-radio-tdma|WP5]] LoRa TDMA radio simulator and [[work-packages/WP6-stream-and-output|WP6]] streaming telemetry

Day 4 Checkpoint: [[gates/G00-data-pinning|Gate G00]] Data-Pinning Verdict
       └── Parameter fit residual verified (<50mm = proceed; >150mm = escalate)

Days 5–6: Sizing & Live Output
       ├── Lane B completes sizing relaxation and cost breakdown ([[gates/G03-cost-breakdown-emitted|Gate G03]], [[gates/G12-cost-reporting-without-budget-cap|Gate G12]])
       └── Lane D completes nodes.csv and live WebSocket server

Day 7: Integration Merge & 16-Gate Gauntlet ([[work-packages/WP7-gate-harness|WP7]])
       └── All 4 lanes merge into main branch; tests must pass 100%

Days 8–9: Multi-Mine Generalisation & Final Freeze
       └── Verify simulator runs on secondary mine (Illinois) without changing code ([[gates/G15-config-driven-mine-independence|Gate G15]])
```

---

## 6. The Core Philosophies of This Project

1. **Honesty Over Optimism:** If a parameter is unknown, we leave it `null` and crash rather than making up a plausible-looking guess.
2. **Physics Over Black Boxes:** Safety alarms are triggered by transparent, classical physics equations, never by unpredictable neural networks ([[notes/safety-and-governance/no-pinn-safety-path-invariant|No PINN Invariant]]).
3. **Reproducibility:** If you run the 690-day simulation twice with the same seed, the terrain output must match to the exact bit ([[notes/world-state/integer-millimeter-terrain-grid|Integer Millimeter Grid]]).
