# SOFTWARE TEAM CHECKLIST — PS 26025

**Owners:** 2 backend, 1 ML. Dashboard/GIS ownership currently defaults to the backend pair — confirm or reassign.
**Scope rule:** every item below traces to a named clause in the official PS text. Nothing here is an enhancement; it is the floor.

---

## PART A — BACKEND (2 people)

### A1 — Ingest
- [ ] Packet format agreed **with the hardware team in writing** before either side codes. Field names, types, units, rate
- [ ] Dedup on `epoch` + node ID, never `seq`
- [ ] Out-of-order and late-arriving packets handled
- [ ] Every stored value carries a provenance tag: `real` / `pinned` / `synthetic` (C2)
- [ ] Node health tracked separately from measurements: last-seen, battery, RSSI, dropped packets

### A2 — Storage
- [ ] Time-series store for measurements; the schema survives adding a fifth sensor modality without a migration
- [ ] Raw readings retained alongside processed values — you must be able to defend a number back to its source
- [ ] Retention policy stated

### A3 — Alarm detector — the classical, deterministic one (S11, C1)
- [ ] Written as an explicit formula with named thresholds and units, in a document, before implementation
- [ ] Severity tiers defined, each with a threshold and an action
- [ ] **DGMS blast seismograph cross-check** wired in as the false-alarm filter. This is the differentiator — do not leave it as a slide claim
- [ ] Every alarm decision logged with the inputs that produced it. If a regulator asks "why did it fire", the answer is a record, not a guess
- [ ] Explicit: ML advisory flags do **not** auto-promote to a confirmed alarm (C1)

### A4 — Alert delivery (S13) — named in the PS, absent from the old plan
- [ ] SMS delivery working
- [ ] Email delivery working
- [ ] Mobile push or in-app notification working
- [ ] Per-role routing: who gets what severity
- [ ] Retry and delivery-failure handling — an undelivered alert is not an alert
- [ ] Rate limiting so a flapping node cannot send 400 SMS

### A5 — Offline + cloud sync (S15) — named in the PS, absent from the old plan
- [ ] Local-first operation: the system keeps working with no internet at the mine
- [ ] Local queue with periodic sync when connectivity returns
- [ ] Conflict and ordering rules on sync defined
- [ ] Demoable: pull the network cable, show it still running, plug it back in, show it catching up. This is a 20-second demo moment and judges like it

### A6 — API
- [ ] Endpoints/socket events documented and shared with whoever builds the dashboard
- [ ] Live stream for real-time view; query interface for history
- [ ] Auth with role distinction (operator / planner / regulator)

---

## PART B — ML (1 person)

### B1 — Anomaly detection (S9)
- [ ] Defines what "abnormal deformation pattern" means numerically, before modelling
- [ ] Trained and evaluated on data that is not purely self-generated (C5)
- [ ] Outputs are **advisory flags with confidence**, not commands (C1)
- [ ] Handles missing nodes and gaps — nodes will drop

### B2 — Prediction (S10)
- [ ] Predicts subsidence zones — a spatial output, not a single number
- [ ] Estimates severity and progression — how bad, how fast
- [ ] Forecast horizon stated and justified
- [ ] Uncertainty reported alongside every prediction. A forecast with no error bar cannot be acted on responsibly
- [ ] Output format agreed with the simulator team — it feeds the consequence renderer (see recommendations file)

### B3 — Validation
- [ ] **At least one external real subsidence series** obtained and used to pin parameters. Nobody can close this by writing more documentation
- [ ] Evaluation does not use the same synthetic generator that produced the training input (C5)
- [ ] Error metrics stated in physical units (mm), not just loss values. "MAE 0.03" means nothing to a mine manager

---

## PART C — DASHBOARD, GIS, MOBILE (owner unconfirmed)

### C1 — GIS visualization (S12) — named in the PS, absent from the old plan
- [ ] Live deformation map over real mine geography
- [ ] Risk zones rendered as zones, not points
- [ ] Node positions on the map with live health status
- [ ] Panel outline as static context geometry (allowed; no live underground state — X1)

### C2 — Three roles (S14) — named in the PS, absent from the old plan
| Role | Needs |
|---|---|
| Operator | Live state, active alarms, node health, what to do now |
| Planner | Forecasts, trend over weeks, projected risk zones, scenario view |
| Regulator | Audit trail, alarm history with justification, compliance evidence |

- [ ] Three views exist. They can share components; they must not be the same screen with a different title

### C3 — Web and mobile (S16)
- [ ] Responsive web, or a mobile view that actually works on a phone
- [ ] Alerts reachable on a phone in the field

---

## THE FLOOR — if everything goes wrong, these must still exist

Ordered. Cut from the bottom.

1. Ingest from a real node → stored → visible live on a screen
2. Classical alarm fires from real sensor data, visibly, with a logged reason
3. One alert leaves the system to a real phone (SMS or push)
4. ML produces an anomaly flag and a prediction on the panel
5. Map view with risk zones
6. Offline → reconnect → sync, demonstrated
7. Three role views
8. Full mobile surface

Items 1–3 are the difference between a working system and a slide deck. Build them first, even ugly.

---

## INTERFACES YOU MUST WRITE DOWN BEFORE CODING

With four sub-teams, the expensive failure is two people building against different assumptions for three days.

| Interface | Between | Status |
|---|---|---|
| Radio packet + frame format | hardware ↔ backend | ☐ |
| Sensor spec: range, resolution, noise, drift, rate | hardware → simulator | ☐ |
| Stream schema: fields, types, **units**, rate | simulator ↔ backend | ☐ |
| ML input format + missing-data representation | backend → ML | ☐ |
| ML output format + what it may and may not decide | ML → alarm detector, ML → simulator | ☐ |
| API surface | backend → dashboard | ☐ |
| Alert payload + routing rules | backend → delivery | ☐ |
| Offline queue + sync protocol | local ↔ cloud | ☐ |

**One shared units convention, written once, referenced everywhere.** Millimetres or metres. Seconds or days. Degrees or radians. Pick, write it down, and make everyone cite it. Unit mismatches between two teams are the most common way a working demo produces a wrong number in front of judges.
