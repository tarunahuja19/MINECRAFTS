---
title: Adarsh Agarwala
slug: adarsh-agarwala
type: person
module: governance
status: reviewed
tags: [team-member, person, lead, architect, lane-a]
created: 2026-09-13
updated: 2026-09-14
author: adarsh
last_agent_edit: claude-code
source_file: files/10-build-order-v1.md
---

# Adarsh Agarwala

| Field | Details |
|---|---|
| **Role** | SIH Team Lead / System Architect |
| **Lane Ownership** | **Lane A:** [[work-packages/WP0-data-pinning\|WP0]] (Data Pinning) |
| **Governance Responsibility** | Author of `[[RULES]]`, ratifier of interface contract amendments |
| **Primary Gates Owned** | [[gates/G00-data-pinning\|Gate G00]] |

---

## 1. Focus Areas & Responsibilities

- **Master System Architecture:** Design of the end-to-end 4-lane parallel simulator pipeline and frozen interface boundaries (`[[docs/interface-contracts]]`).
- **Empirical Ground Truth Sourcing:** Sourcing and digitisation of the Adriyala Longwall Panel 1 survey paper (Ramalingeswarudu et al., 2022) to resolve parameter contradictions in seam height $m$ and subsidence factor $a$.
- **Model Invariant Enforcement:** Guardian of the eight system invariants, ensuring no neural networks or PINNs enter the safety-critical evacuation path.
- **Integration Management:** Leading Day 7 integration day, verifying 16 test gates, and managing dataset handoffs to Part 2 and Part 3.

---

## 2. Active Tasks & Verification Gates

- [x] Initialise SIH 26 Finale Obsidian Vault (`sih-26-finale-brain`) per `[[RULES]]`.
- [x] Complete [[work-packages/WP0-data-pinning|WP0]] digitisation of Figs 6 & 7 from JMMF paper (D1–D2).
- [x] Execute least-squares fitting script `fitting.py` and populate `data/fitted/adriyala_lw1_params.json` (D3).
- [x] Pass [[gates/G00-data-pinning|Gate G00]] (D4).
- [ ] Chair Day 7 Integration Day (D7) — now Day 3 of the compressed sprint, 2026-09-16.
- [ ] Decide DEC-1…DEC-4 on 2026-09-14 — see [[changelog/2026-09-13-claude-code-three-day-sprint-plan]].
- [ ] Decide DEC-5…DEC-10 and re-decide DEC-1 with the −27% peak evidence — see [[projects/subsidence-simulator/decisions]] §4.
- [ ] Verify or relabel the Illinois dataset (DEC-6) — [[gates/G00-data-pinning]] conflicting finding.
- [ ] Re-accept Step 0 after the rework (R0-1…R0-7).
- [ ] Own [[work-packages/WP8-consequence-renderer|WP8 Consequence Renderer]] (if DEC-5 = yes), respecting the R1 hard stop.
- [ ] Get the ML owner to agree [[docs/interface-ml-to-renderer]] this week (R3).

---

## 3. Related Links & Collaborators

- **Team Collaborators:** [[people/claude-code]], [[people/antigravity]], [[people/dnyanad]], [[people/jemin-morabiya]]
- **Master Contracts:** [[docs/interface-contracts]]
- **Project Overview:** [[projects/subsidence-simulator/overview]]
