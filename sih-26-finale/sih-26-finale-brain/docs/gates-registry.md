---
title: Master Verification Gates Registry (G00–G15)
slug: gates-registry
type: doc
module: governance
status: reviewed
tags: [gates, tests, verification, test-driven-development, harness, integration]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP7-gate-harness.md
---

# Master Verification Gates Registry (G00–G15)

Sixteen unyielding verification gates governing system acceptance. Each gate represents an independently executable test file (`tests/gates/test_gNN.py`), has an explicit negative test case, and refuses soft tolerances where mathematical or structural exactness is claimed.

---

## 1. Master Gate Index

| Gate Note | Target Assertion | Owning Package | Test Script |
|---|---|---|---|
| [[gates/G00-data-pinning\|Gate G00]] | Every BROKEN A-tag ($m, a$) is repinned from real field data; residuals logged in `data/fitted/*.json`. | [[work-packages/WP0-data-pinning\|WP0]] | `scripts/verify_pinning.py` |
| [[gates/G01-single-physics-implementation\|Gate G01]] | Exactly one implementation of $S(x,y,t)$ exists in `src/minesim/physics.py`. Tilt, curvature, strain are numerical. | [[work-packages/WP1-core-physics\|WP1]] | `tests/gates/test_g01.py` |
| [[gates/G02-no-node-count-parameter\|Gate G02]] | Sizing algorithm accepts no node-count input parameter; `size_network(cfg)` takes only `Config`. | [[work-packages/WP2-sizing-algorithm\|WP2]] | `tests/gates/test_g02.py` |
| [[gates/G03-cost-breakdown-emitted\|Gate G03]] | Sizing algorithm emits itemized `CostBreakdown` with every generated layout. | [[work-packages/WP2-sizing-algorithm\|WP2]] | `tests/gates/test_g03.py` |
| [[gates/G04-provenance-tags-on-every-row\|Gate G04]] | Every row in `nodes.csv` carries paired `_prov` columns containing only `real`, `pinned`, or `synthetic`. | [[work-packages/WP4-sensor-models-provenance\|WP4]] | `tests/gates/test_g04.py` |
| [[gates/G05-synthetic-grounded-in-observed-data\|Gate G05]] | No `synthetic` value is generated from ungrounded random math or arbitrary distributions. | [[work-packages/WP4-sensor-models-provenance\|WP4]] | `tests/gates/test_g05.py` |
| [[gates/G06-bit-identical-terrain-replay\|Gate G06]] | Replaying `terrain_changes.jsonl` from $t=0$ to $T$ reproduces terrain snapshot bit-identically (`np.array_equal`). | [[work-packages/WP3-world-state-engine\|WP3]] | `tests/gates/test_g06.py` |
| [[gates/G07-dedup-by-node-and-epoch\|Gate G07]] | Dedup uses strictly `(node_id, epoch)`; packet `seq` is diagnostic only. | [[work-packages/WP5-radio-tdma\|WP5]] | `tests/gates/test_g07.py` |
| [[gates/G08-anchor-duty-cycle-under-one-percent\|Gate G08]] | Anchor transmission duty cycle $\le 1.0\%$ across all superframe operations at SF8. | [[work-packages/WP5-radio-tdma\|WP5]] | `tests/gates/test_g08.py` |
| [[gates/G09-scout-receive-under-half-second\|Gate G09]] | Scout radio is awake in receive $< 0.5\text{ s}$ per 60 s superframe (sleeps between TX and ACK). | [[work-packages/WP5-radio-tdma\|WP5]] | `tests/gates/test_g09.py` |
| [[gates/G10-emergency-slot-from-child-index\|Gate G10]] | Emergency sub-slot derives from `node.child_index` ($0..7$), never node ID modulo. | [[work-packages/WP5-radio-tdma\|WP5]] | `tests/gates/test_g10.py` |
| [[gates/G11-no-emergency-subslot-collisions\|Gate G11]] | No two children of an Anchor collide in emergency sub-slots under any adversarial ID assignment. | [[work-packages/WP5-radio-tdma\|WP5]] | `tests/gates/test_g11.py` |
| [[gates/G12-cost-reporting-without-budget-cap\|Gate G12]] | Sizing emits total cost with every layout; never compares against a budget cap and never fails on cost. | [[work-packages/WP2-sizing-algorithm\|WP2]] | `tests/gates/test_g12.py` |
| [[gates/G13-live-z-owned-by-world-state\|Gate G13]] | Node $z_0$ is written only at $t=0$; live $Z$ elevation comes only from `WorldState.z_at()`. | [[work-packages/WP3-world-state-engine\|WP3]] | `tests/gates/test_g13.py` |
| [[gates/G14-no-pinn-in-alarm-path\|Gate G14]] | Zero neural network, deep learning, or PINN code in Part 1 simulator or safety alarm path. | [[work-packages/WP7-gate-harness\|WP7]] | `tests/gates/test_g14.py` |
| [[gates/G15-config-driven-mine-independence\|Gate G15]] | Modifying `assumptions.yaml` re-sizes without code change; swapping mine YAML swaps mines cleanly. | [[work-packages/WP2-sizing-algorithm\|WP2]] | `tests/gates/test_g15.py` |

---

## 2. Gate Harness Architecture (`WP7`)

Managed by `scripts/run_gates.py` and documented live in `GATES.md`:
- **Isolation Rule:** Each gate must execute stand-alone via `pytest tests/gates/test_gNN.py`. Unfinished packages are stubbed in `conftest.py`.
- **Negative Case Requirement:** Every gate must possess a corresponding negative test proving that violating the constraint raises an explicit assertion or error.
