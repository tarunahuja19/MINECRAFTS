---
title: "Gate G09 — Scout Receive Discipline Under 0.5s"
slug: G09-scout-receive-under-half-second
type: gate
module: radio
status: reviewed
tags: [gate, g09, radio, power, sleep-discipline, scout, battery-life]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP5-radio-tdma.md
---

# Gate G09 — Scout Receive Discipline Under 0.5s

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP5-radio-tdma\|WP5]] |
| **Owner** | [[people/antigravity\|Antigravity]] |
| **Verification Target** | Power consumption and 365-day battery autonomy |
| **Test Script** | `tests/gates/test_g09.py` |

---

## 1. Assertion

A Scout node must remain in radio receive state ($RX$) for strictly less than $0.5\text{ seconds}$ per $60\text{ s}$ superframe.

---

## 2. Technical Mechanism

- At $t = 0.0\text{ s}$, Scout wakes for Gateway Beacon ($82.4\text{ ms} + 20\text{ ms}$ guard).
- At assigned slot $t \approx 2.1\text{ s}$, Scout transmits its 23 B uplink ($61.7\text{ ms}$).
- **Sleep Discipline:** Scout immediately enters deep sleep from $t = 2.2\text{ s}$ until $t = 11.95\text{ s}$.
- At $t = 12.0\text{ s}$, Scout wakes on timer to receive Anchor Bitmap ACK ($36.1\text{ ms} + 20\text{ ms}$ guard).
- Total active RX time: $\approx 82.4 + 20 + 36.1 + 20 = 158.5\text{ ms} < 500\text{ ms}$.

---

## 3. Negative Case

A naive implementation that holds the Scout radio listening from transmission ($t=2.1\text{ s}$) until the ACK window ($t=12.0\text{ s}$) consumes $9.9\text{ s}$ of RX current ($11\text{ mA}$), depleting the battery in under 3 weeks and failing Gate G09.
