---
title: Authoritative Interface Contracts
slug: interface-contracts
type: doc
module: governance
status: reviewed
tags: [contracts, authoritative, schemas, dataclasses, signatures, apis, freeze]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/11-interface-contracts-v1.md
---

# Authoritative Interface Contracts

**Status: Binding and Frozen.** Every signature, schema, dataclass, and wire protocol defined in this file represents the authoritative interface boundary for the four-lane simulator build. If any work package description, prompt, or baseline note contradicts this document, **this document wins**.

---

## 0. Coordinate & Unit Standards

Units are mandatory, uniform, and non-negotiable across all modules:

| Measurement | Standard Unit | Convention / Notes |
|---|---|---|
| Spatial Coordinates ($x, y$) | Metres ($\text{m}$) | Origin at panel starting face centre; $+x$ is face advance, $+y$ is toward tailgate. |
| Elevation / Live $Z$ / $z_0$ | Millimetres ($\text{mm}$) | Origin at pre-mining surface; positive upward. |
| Subsidence ($S$) | Millimetres ($\text{mm}$) | Positive downward; returned by `physics.subsidence`. |
| Surface Tilt ($T$) | Microradians ($\mu\text{rad}$) | $(\partial S / \partial x, \partial S / \partial y)$. |
| Surface Curvature ($K$) | Inverse kilometres ($1/\text{km}$) | $(\partial^2 S / \partial x^2, \partial^2 S / \partial y^2)$. |
| Horizontal Strain ($\epsilon$) | Microstrain ($\mu\epsilon$) | Finite difference over physical baseline ($10\text{ m}$ or $30\text{ m}$). |
| Horizontal Displacement ($U$) | Millimetres ($\text{mm}$) | Lateral movement toward subsidence trough centre. |
| Time | Seconds ($\text{s}$) or Days ($\text{days}$) | As indicated in function signatures. |

---

## 1. Configuration Schemas

### 1.1 `config/assumptions.yaml`
Every global assumption tag ($A$-tag) lives here. No numeric constant from the assumption register may appear as a literal in `src/` (enforced by [[gates/G15-config-driven-mine-independence|Gate G15]]).

```yaml
schema_version: 1
mine: adriyala_lw1          # selects config/mines/<name>.yaml

sensing:
  A8_strain_rod_baseline_m: 10.0
  A9_extensometer_baseline_m: 30.0
  A10_detection_threshold_mm: 10.0

layout:
  spacing_m: 50.0           # was 40.0; see docs/build-order
  max_children_per_anchor: 8

radio:
  A11_band: IN865
  A11_bandwidth_khz: 125
  A12_scout_sf: 7
  A13_anchor_sf: 8
  A12_coding_rate: "4/5"
  A12_preamble_symbols: 8
  A12_explicit_header: true
  A12_crc: true
  A14_duty_cycle_ceiling_pct: 1.0     # self-imposed engineering ceiling
  A16_superframe_period_s: 60.0
  A17_local_channels: 4
  A17_backbone_channels: 2
  A15_antenna_height_m:
    scout: 2.0
    anchor: 2.0
    gateway: 10.0

power:
  A18_scout_battery_mah: 6000
  A19_current_ma: {tx: 120.0, rx: 11.0, sense: 20.0, sleep: 0.02}
  A20_target_life_days: 365

cost:                        # informational only — A22 budget cap deleted
  A21_unit_inr: {tier_1a: 1200, tier_1b: 1800, tier_1c: 2600, anchor: 3500, gateway: 15000}

sim:
  timestep_s: 3600.0
  duration_days: 690
  grid_cell_m: 5.0
  rng_seed: 20260913
```

### 1.2 `config/mines/<name>.yaml`
Mine-specific geometry and physical parameters. Loading a mine configuration containing a `null` parameter raises `UnpinnedParameterError`.

```yaml
schema_version: 1
name: adriyala_lw1
display_name: "Adriyala Longwall Project, Panel 1 (SCCL, Godavari Valley)"

geometry:
  A1_panel_width_m: 250.0            # SOURCED
  A1_panel_length_m: 2500.0          # SOURCED
  A2_depth_m: 375.0                  # SOURCED
  A3_seam_thickness_m: null          # BROKEN — repin from JMMF Table 1 in WP0
  seam_inclination_deg: 10.0         # informational
  advance_direction_deg: 0.0

knothe:
  A4_subsidence_factor: null         # BROKEN — repin in WP0
  A5_tan_beta: 2.0
  A7_time_coefficient_per_day: 0.02
  A6_face_advance_m_per_day: 4.0     # SOURCED

pinning:
  source: "10.18311/jmmf/2022/32099"
  profiles_csv: data/real/adriyala_lw1_profiles.csv
  fitted_params: data/fitted/adriyala_lw1_params.json
```

### 1.3 `config.py` Dataclasses
```python
from dataclasses import dataclass
from pathlib import Path

@dataclass(frozen=True)
class PanelGeometry:
    width_m: float
    length_m: float
    depth_m: float
    seam_thickness_m: float

@dataclass(frozen=True)
class KnotheParams:
    subsidence_factor: float          # a
    tan_beta: float
    time_coefficient: float            # c, per day
    advance_m_per_day: float

@dataclass(frozen=True)
class Config:
    panel: PanelGeometry
    knothe: KnotheParams
    sensing: SensingConfig
    layout: LayoutConfig
    radio: RadioConfig
    power: PowerConfig
    cost: CostConfig
    sim: SimConfig
    provenance_source: str             # DOI or dataset id backing the pinned params

def load_config(path: Path = Path("config/assumptions.yaml")) -> Config: ...
```

---

## 2. Physics Interface (`physics.py` — WP1)

> [!IMPORTANT]
> **The Single-Implementation Rule:** This module contains the **only** implementation of $S(x,y,t)$ in the repository. Tilt, curvature, strain, and displacement are computed numerically. Duplicating the closed-form math elsewhere violates [[gates/G01-single-physics-implementation|Gate G01]].

```python
def subsidence(x, y, t_days, panel: PanelGeometry, params: KnotheParams) -> float | np.ndarray:
    """Vertical subsidence in mm, positive down. Vectorised over x and y."""

def tilt(x, y, t_days, panel: PanelGeometry, params: KnotheParams) -> tuple[float | np.ndarray, float | np.ndarray]:
    """(dS/dx, dS/dy) in microradians."""

def curvature(x, y, t_days, panel: PanelGeometry, params: KnotheParams) -> tuple[float | np.ndarray, float | np.ndarray]:
    """(d2S/dx2, d2S/dy2) in 1/km."""

def strain(x, y, t_days, panel: PanelGeometry, params: KnotheParams, baseline_m: float, axis: str) -> float | np.ndarray:
    """Horizontal strain in microstrain over baseline_m ('x' or 'y').
    Computed as a finite difference across baseline_m, NOT a point derivative."""

def displacement(x, y, t_days, panel: PanelGeometry, params: KnotheParams) -> tuple[float | np.ndarray, float | np.ndarray]:
    """(ux, uy) horizontal displacement in mm."""

def face_position(t_days: float, params: KnotheParams) -> float:
    """Face x-coordinate in m at time t."""
```

---

## 3. Sizing Interface (`sizing.py` — WP2)

```python
from typing import Literal

@dataclass(frozen=True)
class Node:
    node_id: int
    x_m: float
    y_m: float
    z0_mm: float                      # static t=0 reference baseline ONLY (G13)
    tier: Literal["1A", "1B", "1C", "anchor", "gateway"]
    parent_id: int | None
    backup_parent_id: int | None
    child_index: int | None           # 0..7 within parent — drives emergency sub-slot (G10)
    line: Literal["transverse", "longitudinal", "crossing", "backbone"]

@dataclass(frozen=True)
class CostBreakdown:
    per_tier: dict[str, tuple[int, int, int]]  # tier -> (qty, unit_inr, subtotal_inr)
    total_inr: int

@dataclass(frozen=True)
class Layout:
    nodes: tuple[Node, ...]
    cost: CostBreakdown
    spacing_m: float
    relaxation_steps: tuple[str, ...]

def size_network(cfg: Config) -> Layout: ...
```

> [!NOTE]
> `size_network` accepts **exactly one parameter** (`cfg`). Adding a `node_count` parameter violates [[gates/G02-no-node-count-parameter|Gate G02]].

---

## 4. World State Interface (`world.py` — WP3)

```python
@dataclass(frozen=True)
class Delta:
    t_s: float
    epoch: int
    cells: tuple[tuple[int, int, int], ...]   # (i, j, dz_mm) — strictly int32 mm (G6)

class WorldState:
    def __init__(self, cfg: Config, layout: Layout) -> None: ...
    def step(self) -> Delta:
        """Advance one timestep, mutate surface, return delta."""
    def z_at(self, x_m: float, y_m: float) -> float:
        """Live surface Z in mm at arbitrary point via bilinear interpolation."""
    def snapshot(self) -> np.ndarray: ...     # int32 array
    @property
    def epoch(self) -> int: ...
```

---

## 5. Sensors & Provenance Interface (`sensors.py`, `provenance.py` — WP4)

```python
Provenance = Literal["real", "pinned", "synthetic"]

@dataclass(frozen=True)
class Value:
    magnitude: float
    unit: str
    provenance: Provenance

@dataclass(frozen=True)
class Reading:
    node_id: int
    epoch: int
    t_s: float
    subsidence: Value                  # mm
    tilt_x: Value | None               # microradians, Tier 1A only
    tilt_y: Value | None
    strain: Value | None               # microstrain, Tiers 1B & 1C
    displacement: Value | None         # mm, Tier 1B only
    battery_mv: Value

def read_node(node: Node, world: WorldState, cfg: Config, rng) -> Reading: ...
```

---

## 6. Radio Interface (`packet.py`, `radio.py` — WP5)

```python
@dataclass(frozen=True)
class Packet:
    node_id: int
    epoch: int                         # Monotonic network epoch (dedup key with node_id)
    seq: int                           # Diagnostic only; never dedup key (G7)
    payload: bytes                     # 23 B scout uplink
    sf: int
    channel: int

@dataclass(frozen=True)
class TxRecord:
    packet: Packet
    t_s: float
    slot_index: int
    parent_used: int
    rssi_dbm: float
    delivered: bool
    airtime_ms: float
    via_emergency: bool

class Superframe:
    def __init__(self, cfg: Config, layout: Layout) -> None: ...
    def run(self, readings: Sequence[Reading], epoch: int, rng) -> list[TxRecord]: ...
    def duty_cycle(self, tier: str) -> float: ...
```

### Authoritative Airtime & Superframe Constants
- Scout 23 B uplink: **$61.7\text{ ms}$** (SF7)
- Anchor 98 B backbone bundle: **$297.5\text{ ms}$** (SF8)
- Anchor 6 B Bitmap ACK: **$36.1\text{ ms}$** (SF7)
- Slot Duration: **$91.7\text{ ms}$** ($61.7\text{ ms}$ airtime + $30.0\text{ ms}$ guard)
- Dedup key: `(node_id, epoch)` strictly (Gate [[gates/G07-dedup-by-node-and-epoch|G07]]).
- Emergency sub-slot: `node.child_index` ($0..7$) strictly (Gates [[gates/G10-emergency-slot-from-child-index|G10]], [[gates/G11-no-emergency-subslot-collisions|G11]]).

---

## 7. Stream & File Formats (`stream.py` — WP6)

### 7.1 `out/nodes.csv` Schema
Column sequence is binding and positional:
```csv
epoch,t_s,node_id,tier,x_m,y_m,z0_mm,subsidence_mm,subsidence_prov,tilt_x_urad,tilt_y_urad,tilt_prov,strain_ustrain,strain_prov,disp_mm,disp_prov,battery_mv,rssi_dbm,parent_used,delivered,via_emergency
```
Every measurement column has a mandatory paired `_prov` column (Gate [[gates/G04-provenance-tags-on-every-row|G04]]). Undelivered packets are written with `delivered=false`.

### 7.2 `out/terrain_changes.jsonl`
```json
{"epoch": 1, "t_s": 3600.0, "cells": [[120, 44, -3], [120, 45, -4]]}
```
Integer mm only. Zero movement logs empty cells: `{"epoch": 2, "t_s": 7200.0, "cells": []}`.

### 7.3 WebSocket Frame (`/ws/run`)
```json
{
  "type": "frame",
  "epoch": 1,
  "t_s": 3600.0,
  "sim_days": 0.042,
  "face_x_m": 4.0,
  "deltas": [[120, 44, -3]],
  "nodes": [
    {"node_id": 100, "subsidence_mm": -3.2, "prov": "pinned",
     "tilt_urad": [1.1, -0.4], "strain_ustrain": null,
     "delivered": true, "rssi_dbm": -37.0}
  ]
}
```

---

## 8. Exceptions
```python
class UnpinnedParameterError(ValueError): ...   # null in required config field
class ProvenanceError(ValueError): ...          # Value built without valid tag
class ContractViolation(RuntimeError): ...      # gate invariant broken at runtime
```
