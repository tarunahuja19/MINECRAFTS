---
title: Agent Charter & The Eight Invariants
slug: agents-invariants
type: doc
module: governance
status: reviewed
tags: [charter, invariants, working-rules, traps, guidelines, compliance]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: AGENTS.md
---

# Agent Charter & The Eight Invariants

Binding operational charter for every agent (Claude Code, Antigravity, or human) contributing to the SIH 2025/26 Mine Subsidence Simulator codebase.

---

## 1. The Eight System Invariants

Do not reverse or bypass these under any circumstances. If a work package appears to require altering an invariant, **stop and escalate to Adarsh**:

1. **The World-State Engine Owns Terrain Truth:** Including the live $Z$ elevation of every node and grid cell. Nothing else writes $Z$.
2. **There is No PINN in This Build:** Every reference to Physics-Informed Neural Networks in early documents (00–07) is superseded.
3. **No Neural Network in the Safety Path:** The classical Knothe-fit detector is the only component that raises a safety alarm.
4. **Exactly One Implementation of $S(x,y,t)$ Exists in the Repository:** Located strictly at `src/minesim/physics.py`. All derivatives (tilt, curvature, strain, displacement) are derived numerically.
5. **Node Count is an Output, Never an Input:** `size_network(cfg)` takes exactly one argument: the configuration. No `node_count` or target parameter is permitted.
6. **Every Emitted Value Carries a Provenance Tag:** Tagged strictly as `real`, `pinned`, or `synthetic`. No fourth option, no `unknown`.
7. **Synthetic Values are Generated Only From the Behaviour of Data That Exists:** No freeform or ungrounded synthetic generation.
8. **The System is Mine-Independent:** Adriyala is one example dataset. Swapping `config/mines/*.yaml` swaps mines with no code change.

---

## 2. Working Rules for Parallel Agents

- **Stay in Your Package:** Each work package lists its owned files. Never edit files owned by another package. Cross-package edits cause silent merge conflicts.
- **Contracts are Frozen:** If a signature or dataclass in `[[docs/interface-contracts]]` cannot be implemented, stop and explain why. Never quietly alter contract shapes.
- **No Magic Numbers:** Every physical, radio, and cost parameter lives in `config/assumptions.yaml` or `config/mines/*.yaml`. Any hardcoded literal in `src/` (e.g. `375`, `0.6`, `61.7`) violates [[gates/G15-config-driven-mine-independence|Gate G15]].
- **Fail Loudly:** Missing pinned parameters must raise `UnpinnedParameterError`. Never substitute a default for an empirical parameter.
- **Integer Millimetres for Terrain:** Surface accumulation uses `int32` millimetres so replay is bit-identical (enforced by [[gates/G06-bit-identical-terrain-replay|Gate G06]]).
- **Simplest Version That Works:** Implement the minimal code that passes all gates. Upgrades belong in future tracks.
- **Tests are Gates:** Each gate is an independent test file (`tests/gates/test_gNN.py`). Stub unbuilt dependencies in fixtures rather than making gates dependent on full-system completion.

---

## 3. Scope Boundaries (Not Our Problem)

Do not implement or drift into:
- Machine learning architectures, loss functions, PINN training (owned by Part 2).
- Alarm thresholds and detector tuning (owned by Part 2).
- React dashboard, Three.js 3D rendering, camera orbit controls (owned by Part 3).
- Firmware, PCB layout, hardware procurement (post-hackathon).
- Operator interventions (blast injection, manual cave-in trigger) — deferred to v2.
- Environmental variables (rainfall, barometric pressure) — deferred to v2.

---

## 4. Known Traps & Historical Contradictions

- **Seam Thickness & Subsidence Factor are Unpinned:** Measured $S_{max} / m = 0.195$ at Adriyala LW1 contradicts early assumptions ($m=3.0\text{ m}, a=0.6 \implies S_{max}/m = 0.54$). Both must be repinned in [[work-packages/WP0-data-pinning|WP0]].
- **Panel Geometry is $250\text{ m} \times 2500\text{ m}$:** Discard the early $750 \times 350\text{ m}$ board-and-pillar figure permanently.
- **Peak Subsidence is Not $a \cdot m$:** The panel is subcritical ($W = 250\text{ m} < 2r = 375\text{ m}$), so the trough never reaches full depth ($1630\text{ mm}$ peak vs $1800\text{ mm}$ full).
- **LoRa Airtime at SF7/BW125/CR4-5 is $61.7\text{ ms}$:** The $90.4\text{ ms}$ figure in older notes matches no valid LoRaWAN configuration.
- **Dedup Key is `(node_id, epoch)`:** Sequence number `seq` resets on node reboot, causing silent packet drops if used for deduplication.
- **Emergency Sub-Slot is `child_index` ($0..7$):** Using `node_id % 16` causes sibling nodes to collide when an Anchor fails.
- **The 1% Duty Cycle is Self-Imposed:** GSR 564(E) regulates power (1 W ERP) and bandwidth (200 kHz), NOT duty cycle. 1% is an engineering best practice.
- **Symmetric Model Residual on Inclined Seam:** The real Adriyala seam dips ~10° toward the tailgate. Expect a systematic residual on one flank; report it honestly in WP0 rather than tuning it away.
