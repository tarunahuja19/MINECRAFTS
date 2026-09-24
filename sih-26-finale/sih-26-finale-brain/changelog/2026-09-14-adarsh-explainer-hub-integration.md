---
title: "Explainer Hub & Decision Analogies Integration"
slug: 2026-09-14-adarsh-explainer-hub-integration
type: changelog
module: governance
status: reviewed
tags: [changelog, explainers, wp0, analogies, vault-sync]
created: 2026-09-14
updated: 2026-09-14
author: adarsh
last_agent_edit: antigravity
source_file: explainers/
---

# Ingestion & Update Log: Explainer Hub Integration

- **Date:** 2026-09-14
- **Author:** [[people/adarsh-agarwala|Adarsh Agarwala]]
- **Agent:** [[people/antigravity|Antigravity]]
- **Scope:** Integration of plain-English explainer guides and decision analogies into `sih-26-finale-brain`.

---

## 1. Notes Created

1. **[[docs/master-process-explainer|Master Process Explainer]]:**
   - High-level 30,000-foot view of the real-world coal mining subsidence challenge.
   - The 4-stage simulator pipeline (Physics $\to$ World State $\to$ Sensors $\to$ Radio Mesh).
   - The 4-lane parallel development system with dependencies and owner assignments.
   - Complete file-by-file roadmap with intuitive real-world analogies.

2. **[[docs/wp0-data-pinning-guide|WP0 Field Data Guide]]:**
   - Detailed breakdown of why WP0 exists and the danger of the "self-deception / closed validation loop".
   - Empirical analysis of the 3x error discovered at Adriyala Longwall Panel 1 ($S_{max}/m = 0.195$ vs baseline $0.54$).
   - Digitisation procedures for Ramalingeswarudu et al. (2022) using WebPlotDigitizer.
   - Step-by-step curve fitting with `src/minesim/fitting.py` and [[gates/G00-data-pinning|Gate G00]] residual thresholds.

3. **[[docs/architectural-decisions-and-analogies|Architectural Decisions & Real-World Analogies]]:**
   - Comprehensive documentation of all locked design choices (No PINNs in alarm path, integer mm terrain grid, dedup key, child index slots, physics-driven sizing, mandatory provenance tags).
   - Explicit "Why It Was Decided", "Rejected Alternative", and real-world analogies (aircraft mechanical controls, bank integer cents, employee ID badges, airplane seat jackets, ship lifeboats, food labeling).

---

## 2. Notes Updated

- **[[docs/start-here|Start Here]]:** Added top-level callout linking to the three new explainer guides.
- **[[work-packages/WP0-data-pinning|WP0 Work Package]]:** Added pointer to the [[docs/wp0-data-pinning-guide|WP0 Field Data Guide]].
- **[[projects/subsidence-simulator/decisions|Locked Decisions Log]]:** Added pointer to the [[docs/architectural-decisions-and-analogies|Architectural Decisions & Real-World Analogies]].

---

## 3. Verification & Graph Integrity

Executed `python3 sync_vault.py`:
- 100% compliant frontmatter schema across all notes.
- Zero broken wikilinks.
- Zero disconnected orphan notes.
- Complete bidirectional navigation between documentation, work packages, gates, and explainers.
