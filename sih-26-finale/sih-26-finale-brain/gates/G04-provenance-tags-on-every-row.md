---
title: "Gate G04 — Provenance Tags on Every CSV Row"
slug: G04-provenance-tags-on-every-row
type: gate
module: sensors
status: reviewed
tags: [gate, g04, provenance, nodes-csv, telemetry, data-integrity]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP4-sensor-models-provenance.md
---

# Gate G04 — Provenance Tags on Every CSV Row

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP4-sensor-models-provenance\|WP4]] |
| **Owner** | [[people/antigravity\|Antigravity]] |
| **Verification Target** | Invariant 6 compliance |
| **Test Script** | `tests/gates/test_g04.py` |

---

## 1. Assertion

Every row in `out/nodes.csv` over a full simulated run must carry paired `_prov` columns (`subsidence_prov`, `tilt_prov`, `strain_prov`, `disp_prov`). Every populated provenance cell must contain strictly one of the three allowed values: `'real'`, `'pinned'`, or `'synthetic'`. No cell may be empty if its value column is populated, and no `unknown` tag is permitted.

---

## 2. Test Implementation

Reads `out/nodes.csv` with `pandas` or `csv.DictReader`:
- Asserts that all paired `_prov` columns exist in exact schema sequence.
- Iterates over all rows: asserts that `val is not None` implies `prov in {'real', 'pinned', 'synthetic'}`.
- Asserts that 100% of tilt, strain, and displacement values are tagged `'synthetic'`.

---

## 3. Negative Case

Injecting an unprovenanced number or an `'unknown'` tag causes immediate gate failure.
