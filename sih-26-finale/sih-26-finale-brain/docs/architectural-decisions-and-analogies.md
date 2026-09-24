---
title: "Architectural Decisions & Real-World Analogies"
slug: architectural-decisions-and-analogies
type: doc
module: governance
status: reviewed
tags: [decisions, trade-offs, analogies, rationale, safety-invariants]
created: 2026-09-14
updated: 2026-09-14
author: adarsh
last_agent_edit: antigravity
source_file: explainers/02_architectural_decisions_and_analogies.md (source folder removed 2026-09-14; this note is the canonical copy)
---

# Architectural Decisions & Real-World Analogies

This document records the major architectural, mathematical, and engineering decisions made in the simulator. For each decision, we explain:
1. **What was decided.**
2. **Why it was decided (the engineering reason).**
3. **What alternative was rejected.**
4. **A real-world analogy to make it simple and intuitive.**

See also [[projects/subsidence-simulator/decisions|Locked Decisions Log]].

---

## Decision Index

1. [[#Decision 1: No Neural Networks in the Safety Alarm Path|No Neural Networks in the Safety Alarm Path (Gate G14)]]
2. [[#Decision 2: Integer Millimeter Grid (`int32`) Instead of Floats|Integer Millimeter Terrain Grid (Gate G06)]]
3. [[#Decision 3: Dedup by `(node_id, epoch)`, NEVER `seq`|LoRa Dedup Key is (node_id, epoch) (Gate G07)]]
4. [[#Decision 4: Emergency Sub-Slots from `child_index`|Emergency Radio Sub-slots from child_index (Gates G10/G11)]]
5. [[#Decision 5: Physics-Driven Network Sizing|Physics-Driven Sizing & Deleting Budget Cap A22 (Gate G12)]]
6. [[#Decision 6: Mandatory 3-Tier Provenance Tagging|Mandatory 3-Tier Provenance Tagging (Gate G04)]]
7. [[#Decision 7: Frozen Interface Contracts Over Prose|Frozen Interface Contracts Over Prose]]

---

### Decision 1: No Neural Networks in the Safety Alarm Path

- **What was decided:** Ground collapse warnings and emergency sirens are triggered **strictly by classical, deterministic least-squares curve fitting of Knothe equations**, verified by static AST analysis in [[gates/G14-no-pinn-in-alarm-path|Gate G14]]. Physics-Informed Neural Networks (PINNs) and deep learning models are strictly forbidden from the safety-critical alarm loop. See [[notes/safety-and-governance/no-pinn-safety-path-invariant|No PINN Invariant]].
- **Why:** Deep neural networks are statistical black boxes. They suffer from out-of-distribution drift, non-convex local minima, and hallucinations. If an unusual seismic shift occurs that wasn't in the training set, a neural network can silently fail to predict a collapse, leading to miner fatalities. Classical physics with bounded residuals guarantees transparent, mathematically auditable safety thresholds.
- **Rejected Alternative:** An end-to-end LSTM or PINN that directly ingests raw sensor telemetry and outputs collapse probabilities.
- **Analogy:**  
  > In a modern commercial airplane, the emergency oxygen masks and mechanical rudder controls are operated by rugged, deterministic physical levers and certified mechanical valves — **not by an experimental AI voice chatbot**. You do not let a probabilistic black box decide whether the emergency brakes engage.

---

### Decision 2: Integer Millimeter Grid (`int32`) Instead of Floats

- **What was decided:** The world-state terrain grid stores and accumulates elevation changes over the 690-day simulation using 32-bit signed integers representing exact millimeters (`np.int32`), rather than floating-point numbers (`float32` or `float64`). See [[notes/world-state/integer-millimeter-terrain-grid|Integer Millimeter Terrain Grid]].
- **Why:** The simulation runs for 690 days at 1-hour timesteps — that is **16,560 consecutive additions** for every single cell on the grid! In computer science, floating-point numbers are approximations ($0.1 + 0.2 = 0.30000000000000004$). Over 16,560 additions, tiny fractional rounding errors accumulate. Furthermore, different CPU chips (Intel x86 vs Apple Silicon ARM) round floating-point math slightly differently. That means running the same simulation on two computers would produce diverging terrains, failing our bit-identical replay test ([[gates/G06-bit-identical-terrain-replay|Gate G06]]). Exact integer addition never drifts and is bit-for-bit identical across all computers.
- **Rejected Alternative:** Standard `float64` elevation coordinates in meters.
- **Analogy:**  
  > Financial institutions and banks never store your bank balance in floating-point dollars like `$1245.333333333`, because fractional cents get rounded away and lost over millions of transactions. Banks store balances in **exact whole integer cents** (`124533 cents`). We do the exact same thing: our terrain is measured in whole millimeters.

---

### Decision 3: Dedup by `(node_id, epoch)`, NEVER `seq`

- **What was decided:** When the radio gateway receives incoming sensor packets, it filters out duplicate transmissions using the composite key `(node_id, epoch_timestamp)`. It is strictly forbidden from deduplicating using the packet sequence counter `seq` ([[gates/G07-dedup-by-node-and-epoch|Gate G07]]). See [[notes/mesh-and-radio/emergency-alert-and-dedup|Emergency Alert & Dedup]].
- **Why:** IoT sensor nodes in remote coal mines run on small solar panels and lithium batteries. During monsoon clouds or cold winter nights, nodes frequently experience "brownouts" (temporary voltage dips) and reboot. When a microcontroller reboots, its internal software sequence counter resets back to `seq = 0`. If our gateway deduplicated by `seq`, it would look at the rebooted node's packets and say: *"I already saw packet seq=0 three days ago, discard it!"* That would cause the gateway to throw away life-critical emergency alarm packets!
- **Rejected Alternative:** Deduplicating by `(node_id, seq)`.
- **Analogy:**  
  > Imagine an office security turnstile. If the guard tracks visitors by "how many times you entered today" (a counter that resets to 1 whenever you reboot your phone), but you forget and tell the guard "this is visit 1", the guard blocks you. But if the guard checks your **Employee ID Badge + Today's Calendar Date & Hour**, you are recognized instantly regardless of how many times your phone died.

---

### Decision 4: Emergency Sub-Slots from `child_index`

- **What was decided:** When an Anchor relay node dies, its 8 child Scout nodes detect the loss of signal and switch to emergency uplink slots. The specific sub-slot a node transmits in is derived strictly from its assigned `child_index` ($0, 1, 2, \dots, 7$), and **never** by hashing its global node ID (like `node_id % 16`). See [[gates/G10-emergency-slot-from-child-index|Gate G10]] and [[gates/G11-no-emergency-subslot-collisions|Gate G11]].
- **Why:** If you derive emergency radio slots using a modulo hash on `node_id` (e.g. `node_id % 16`), two child nodes under the same Anchor might happen to have IDs like `node_17` and `node_33`. Both evaluate to slot $1$ ($17 \pmod{16} = 1$ and $33 \pmod{16} = 1$). During a catastrophic anchor failure, both nodes would transmit their emergency alerts at the exact same microsecond, destroying each other's radio packets through RF collision! By using `child_index` ($0..7$), all 8 children under any Anchor are mathematically guaranteed to have completely orthogonal, collision-free time slots.
- **Rejected Alternative:** `node_id % 16` or random backoff transmission.
- **Analogy:**  
  > In an airplane row with 6 seats, assigning emergency life jackets by seat position (`Window Left, Middle Left, Aisle Left...`) guarantees everyone grabs their own jacket. If you instead assigned jackets by taking the passenger's birth year modulo 6, three passengers in the same row would physically fight over the exact same life jacket during a crash.

---

### Decision 5: Physics-Driven Network Sizing

- **What was decided:** Network sizing (how many sensor nodes we deploy and where they are placed) is determined **strictly by ground strain physics and LoRa Fresnel zone radio clearance**, while Assumption A22 (the arbitrary \$15,000 budget cap) was completely deleted ([[gates/G12-cost-reporting-without-budget-cap|Gate G12]], [[gates/G02-no-node-count-parameter|Gate G02]]). Cost calculation is kept purely as an informational output.
- **Why:** The earth's geology does not care about an arbitrary budget number. The Nyquist sampling theorem for the Knothe subsidence trough proves that sensor nodes must be spaced at $\le 50\text{ meters}$ to detect the peak tensile strain zone before ground fracture occurs. If you enforce an arbitrary budget cap, the algorithm would be forced to remove nodes, creating fatal blind spots where ground cracking occurs completely undetected.
- **Rejected Alternative:** Artificially capping the number of nodes to meet an arbitrary dollar limit.
- **Analogy:**  
  > You do not determine how many lifeboats to install on an ocean liner by saying *"we only have \$5,000 left in our budget."* You calculate the exact number of people on board and the lifeboats needed so that nobody drowns, install that exact number, and then write down the invoice.

---

### Decision 6: Mandatory 3-Tier Provenance Tagging

- **What was decided:** Every single measurement column in `nodes.csv` must have a corresponding provenance column (`disp_z` has `disp_z_prov`, `tilt_x` has `tilt_x_prov`, etc.) with one of three strict values ([[gates/G04-provenance-tags-on-every-row|Gate G04]], [[notes/sensors/sensor-provenance-and-tagging|Sensor Provenance & Tagging]]):
  - `real`: Directly measured by a human surveyor monument on the real earth.
  - `pinned`: Generated by our Knothe model after being calibrated and fitted to real survey data.
  - `synthetic`: Purely mathematical calculation (such as numerical strain derivatives or simulated noise).
- **Why:** In AI and data science, engineers frequently mix simulated numbers with real-world sensor logs. Downstream researchers mistakenly train neural networks on fake data believing it was real ground truth. Provenance tagging creates an unbreakable chain of scientific integrity.
- **Rejected Alternative:** A single combined CSV with no origin tags.
- **Analogy:**  
  > Food safety labeling regulations require juices to clearly state whether an ingredient is "100% Squeezed Fruit", "Concentrate Calibrated with Water", or "Synthetic Artificial Flavor". You cannot pour chemicals into a bottle and label the entire drink "Natural Spring Juice".

---

### Decision 7: Frozen Interface Contracts Over Prose

- **What was decided:** [[docs/interface-contracts|Interface Contracts]] is the supreme law of the repository. If any prose document, work package description, or developer note disagrees with the dataclasses and signatures in the contract file, **the contract wins automatically**.
- **Why:** In multi-agent parallel development (4 lanes building simultaneously), prose descriptions can be interpreted ambiguously. One developer might name a variable `time_step_days` while another names it `t_days`. When all 4 lanes try to merge on Day 7, the code breaks in hundreds of places. Freezing the exact function signatures, dataclass field names, and binary byte layouts on Day 0 ensures every lane snaps together like LEGO bricks.
- **Rejected Alternative:** Allowing each lane to invent or tweak function signatures as they go.
- **Analogy:**  
  > Before independent factories in different countries start manufacturing chargers, power banks, and smartphones, everyone agrees on the exact microscopic pin layout and dimensions of the **USB-C connector**. If one factory decided to make their plug 1 millimeter wider because it felt convenient, millions of phones wouldn't be able to charge.
