---
title: "Interface Draft — ML Forecast Output to Renderer and Alarm Detector"
slug: interface-ml-to-renderer
type: doc
module: integration
status: draft
tags: [interface, contract-draft, ml, forecast, renderer, units, proposed]
created: 2026-09-14
updated: 2026-09-14
author: claude-code
last_agent_edit: claude-code
source_file: files/RECOMMENDATIONS.md
---

# Interface Draft — ML Forecast Output to Renderer and Alarm Detector

> [!WARNING]
> **DRAFT, not frozen.** This is not part of [[docs/interface-contracts]] v1, which still wins wherever they overlap. It needs agreement from the ML owner and [[people/adarsh-agarwala|Adarsh]] (recommendation R3) before either side codes against it. Once agreed, it becomes a v1.1 contract addendum.

## 1. Units and Sign Convention (proposed, applies to every file below)

| Quantity | Unit | Sign |
|---|---|---|
| Vertical movement in any file crossing a team boundary | integer or float **mm** | **negative = ground moved down** (matches `terrain_changes.jsonl` `dz`, the real survey CSV, and the §7.4 frame example) |
| `physics.subsidence` internal return | mm | positive down, as contract §2. Internal only; converted at the output boundary |
| Tilt | µrad | `+` = surface rises toward `+x` / `+y` |
| Strain | µε | `+` = tensile |
| Time | `t_s` seconds since simulation/mining start; horizons in seconds | — |
| Coordinates | metres, contract §2 frame (origin at starting face centre, `+x` advance, `+y` tailgate) | — |

> [!IMPORTANT]
> **Resolved (DEC-8, 2026-09-14):** negative = down at every team boundary, as in the table above. Contract §2 `physics.subsidence` stays positive-down internally; WP4/WP6 convert once at the output boundary. This clarifies §7.1, which didn't state a sign, and matches the §7.4 example.

## 2. Forecast File — `forecast_<issued_t_s>.json`

```json
{
  "schema_version": 1,
  "kind": "forecast",
  "model_id": "part2-<name>-<git-sha>",
  "mine": "adriyala_lw1",
  "issued_t_s": 51840000.0,
  "input_last_epoch": 14400,
  "grid": {"origin_x_m": 0.0, "origin_y_m": -246.3, "cell_m": 25.0, "shape": [120, 20]},
  "horizons_s": [86400, 259200, 518400],
  "movement_mm": {
    "p10": [[[...]]],
    "p50": [[[...]]],
    "p90": [[[...]]]
  },
  "valid_mask": [[...]],
  "advisory_flags": [
    {"x_m": 1840.0, "y_m": 12.5, "severity": "watch", "confidence": 0.71, "reason": "rate anomaly"}
  ]
}
```

- `movement_mm.pXX` shape is `[len(horizons_s), shape[0], shape[1]]`, sign per §1.
- The forecast grid may be coarser than the terrain grid but **must state its own** origin, cell and shape. The renderer resamples; the ML side never assumes the terrain grid.
- **Missing regions:** `valid_mask` cell = 0, and the matching `movement_mm` entries are `null`. No NaN (invalid JSON), and no zero-fill (a zero would be read as "no movement").
- `p10 ≤ p50 ≤ p90` elementwise (more negative = more downward movement, so `p10` is the worse case). The renderer rejects a file that violates this.

## 2b. Per-Node Forecast File — `forecast_nodes_<issued_epoch>.json` (v2 input, proposed 2026-09-14)

The ML teammate's v1/v2 model predicts **per node**, not per grid cell. This is the form the Scenario Lab ([[work-packages/WP9-scenario-lab]] §7) reads. The grid form in §2 stays for later.

```json
{
  "schema_version": 1,
  "kind": "forecast_nodes",
  "model_id": "part2-<name>-<git-sha>",
  "mine": "adriyala_lw1",
  "issued_epoch": 7200,
  "issued_t_s": 25920000.0,
  "horizons_h": [24, 72],
  "sign": "negative_down",
  "nodes": [
    {"node_id": 100, "x_m": 600.0, "y_m": 0.0,
     "subsidence_mm": {"24": {"p10": -812.0, "p50": -790.0, "p90": -771.0},
                       "72": {"p10": -850.0, "p50": -815.0, "p90": -790.0}}}
  ],
  "advisory_flags": []
}
```

- `subsidence_mm` is **cumulative since t = 0**, exactly like `nodes.csv` `subsidence_mm`. Negative = ground went down.
- `p10 ≤ p50 ≤ p90` (p10 = worse case, more negative).
- Every horizon in `horizons_h` appears for every listed node, as a string key.
- `node_id` must exist in the run's `nodes.csv`, and `x_m`, `y_m` must match within 0.5 m.
- A node with no prediction is **left out**. No `null`, no NaN.
- `model_id` starting with `TEST-FIXTURE` marks a file built from simulator truth for pipeline testing. It is shown with a TEST INPUT banner and is never presented as a real forecast.

## 3. What the Forecast May and May Not Decide

| May | May not |
|---|---|
| Be drawn by the renderer under the `FORECAST (PREDICTED)` banner | Raise, promote or suppress an alarm (Invariant 3, [[docs/agents-invariants]]) |
| Emit `advisory_flags` shown as advisory only | Be written into `nodes.csv` or any provenance-tagged column |
| Be compared against later measurements | Carry a `real` / `pinned` / `synthetic` tag. It isn't simulator output; `kind: forecast` identifies it instead of inventing a fourth provenance tag (Invariant 6) |

The classical Knothe-fit detector stays the only alarm source ([[notes/safety-and-governance/no-pinn-safety-path-invariant]]).

## 4. Validation Data Rule

Forecast skill is reported in **mm** against the 283 real Adriyala monument points (`data/real/adriyala_lw1_profiles.csv`), never against simulator output (C5). See [[gates/G00-data-pinning]].

## 5. Related

- [[work-packages/WP8-consequence-renderer]] — the consumer
- [[work-packages/WP6-stream-and-output]] — the input stream the ML model trains on
