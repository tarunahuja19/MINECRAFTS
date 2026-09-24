---
title: Assumption Register (A1–A22) Traceability
slug: assumption-register
type: doc
module: governance
status: reviewed
tags: [assumptions, parameters, traceability, ground-truth, constants]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/10-build-order-v1.md
---

# Assumption Register (A1–A22) Traceability

Authoritative register of all physical, mechanical, electronic, and financial assumptions governing the Part 1 mine subsidence simulation. Every value lives in `config/assumptions.yaml` or `config/mines/*.yaml` (enforced by [[gates/G15-config-driven-mine-independence|Gate G15]]).

---

## 1. Traceability Table

| Tag | Parameter Description | Baseline Value | Units | Status | Empirical Source & Rationale |
|---|---|---|---|---|---|
| **A1** | Panel Width & Length | $250.0 \times 2500.0$ | $\text{m}$ | **SOURCED** | SCCL Adriyala LW1 actual longwall panel dimensions. Discard $750 \times 350\text{ m}$. |
| **A2** | Overburden Mining Depth ($H$) | $375.0$ | $\text{m}$ | **SOURCED** | Ramagundam strata control documentation. (410 m depth conflict noted). |
| **A3** | Seam Extraction Height ($m$) | `null` | $\text{m}$ | **BROKEN** | Inconsistent with measured $1.267\text{ m}$ ($19.5\%$). Repinned in [[work-packages/WP0-data-pinning\|WP0]]. |
| **A4** | Subsidence Factor ($a$) | `null` | — | **BROKEN** | Inconsistent with field profile. Repinned via least-squares in [[work-packages/WP0-data-pinning\|WP0]]. |
| **A5** | Tangent Beta ($\tan \beta$) | $2.0$ | — | **SOURCED** | JMMF Table 3 profile parameter ($\beta = 63.4^\circ$). Yields $r = 187.5\text{ m}$. |
| **A6** | Face Advance Rate | $4.0$ | $\text{m/day}$ | **SOURCED** | Measured daily advance at Adriyala: range $2.7$ to $4.8\text{ m/day}$. |
| **A7** | Time Coefficient ($c$) | $0.02$ | $\text{day}^{-1}$ | **SOURCED** | Knothe settling tail time constant ($t_{63} = 50\text{ days}$). |
| **A8** | Strain Rod Baseline | $10.0$ | $\text{m}$ | OPEN | Physical gauge separation for Tier 1B invar rod assembly. |
| **A9** | Extensometer Baseline | $30.0$ | $\text{m}$ | OPEN | Wire extensometer gauge anchor distance for Tier 1C. |
| **A10** | Detection Threshold | $10.0$ | $\text{mm}$ | **SOURCED** | Classical Knothe-fit alarm detection threshold. |
| **A11** | LoRa Frequency Band | IN865, $125\text{ kHz}$ | — | **SOURCED** | GSR 564(E) compliant sub-GHz spectrum in India. |
| **A12** | Scout Uplink Modulation | SF7, CR 4/5, BW125 | — | **SOURCED** | Uplink airtime: $61.7\text{ ms}$ for 23-byte payload. |
| **A13** | Anchor Backbone Modulation | SF8, CR 4/5, BW125 | — | **SOURCED** | Backbone bundle airtime: $297.5\text{ ms}$ for 98-byte payload. |
| **A14** | Duty Cycle Ceiling | $1.0\%$ | $\%$ | **SOURCED** | Self-imposed engineering limit from LPWAN practice. |
| **A15** | Antenna Mast Heights | Scout: 2m, Anchor: 2m, GW: 10m | $\text{m}$ | **SOURCED** | Minimum line-of-sight and Fresnel clearance specifications. |
| **A16** | Superframe Period | $60.0$ | $\text{s}$ | **SOURCED** | TDMA repetition cadence. |
| **A17** | Channel Allocation | 4 local, 2 backbone | — | **SOURCED** | Orthogonal carrier frequencies across IN865 channels. |
| **A18** | Scout Battery Capacity | $6000$ | $\text{mAh}$ | **SOURCED** | Dual 18650 LiFePO4 cells with safety board. |
| **A19** | Tier Operating Currents | TX: 120, RX: 11, Sense: 20, Sleep: 0.02 | $\text{mA}$ | **SOURCED** | SX1262 LoRa transceiver + low-power MCU datasheet figures. |
| **A20** | Target Autonomy Lifespan | $365$ | $\text{days}$ | **SOURCED** | Target maintenance-free operational lifecycle. |
| **A21** | Unit Hardware Costs | 1A: ₹1200, 1B: ₹1800, 1C: ₹2600, Anc: ₹3500, GW: ₹15000 | $\text{INR}$ | **SOURCED** | BOM estimates for informational costing output. |
| **A22** | Sizing Budget Ceiling | — | $\text{INR}$ | **DELETED** | Deleted 2026-09-13. Sizing is driven purely by physics and RF. |

---

## 2. Derived Geometric & Kinematic Quantities

Computed once by `config.py` properties, never duplicated or hardcoded:

- **Influence Radius ($r$):**
  $$r = \frac{H}{\tan \beta} = \frac{375.0}{2.0} = 187.5\text{ m}$$
- **Total Surface Deformation Extent ($W_{ext}$):**
  $$W_{ext} = W + 2r = 250.0 + 2(187.5) = 625.0\text{ m}$$
- **Knothe Characteristic Time ($t_{63}$):**
  $$t_{63} = \frac{1}{c} = \frac{1}{0.02} = 50.0\text{ days}$$
- **Settling Tail Distance ($L_{tail}$):**
  $$L_{tail} = 3 \cdot t_{63} \cdot v_{advance} = 3 \cdot 50 \cdot 4.0 = 600.0\text{ m}$$
- **Travelling Window Length ($L_{window}$):**
  $$L_{window} = r + L_{tail} = 187.5 + 600.0 = 787.5\text{ m}$$
