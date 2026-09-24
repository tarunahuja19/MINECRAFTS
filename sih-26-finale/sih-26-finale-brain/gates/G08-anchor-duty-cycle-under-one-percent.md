---
title: "Gate G08 — Anchor Duty Cycle Under 1.0%"
slug: G08-anchor-duty-cycle-under-one-percent
type: gate
module: radio
status: reviewed
tags: [gate, g08, radio, lora, duty-cycle, anchor, lpwan-compliance]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP5-radio-tdma.md
---

# Gate G08 — Anchor Duty Cycle Under 1.0%

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP5-radio-tdma\|WP5]] |
| **Owner** | [[people/antigravity\|Antigravity]] |
| **Verification Target** | LPWAN RF regulatory & thermal compliance |
| **Test Script** | `tests/gates/test_g08.py` |

---

## 1. Assertion

The total transmission duty cycle of any Anchor node operating at SF8 must remain strictly $\le 1.0\%$ ($600\text{ ms}$ total transmission airtime per $60\text{ s}$ superframe) under normal operations and single-retransmit recovery.

---

## 2. Airtime Accounting

Under the authoritative timing model:
- 1 $\times$ 6 B Bitmap ACK @ SF7: $36.1\text{ ms}$
- 1 $\times$ 98 B Backbone Bundle @ SF8: $297.5\text{ ms}$
- Total Normal Airtime: $333.6\text{ ms}$
- **Duty Cycle:**
  $$\text{Duty Cycle} = \frac{333.6\text{ ms}}{60,000\text{ ms}} = 0.556\% \le 1.0\%$$

Even with one complete bundle retransmission ($+297.5\text{ ms}$), total airtime is $631.1\text{ ms}$ over 2 superframes, maintaining an average duty cycle of $0.53\%$.

---

## 3. Negative Case

Switching Anchor backbone transmissions to SF9 ($533.5\text{ ms}$ bundle airtime) pushes transmission to $569.6\text{ ms}$ ($0.95\%$), leaving zero margin for retransmissions and failing this gate during failover testing.
