---
title: Interface Contracts
slug: 11-interface-contracts
version: v1
created: 2026-09-13
status: authoritative — contracts win over prose everywhere else
part: Part 1 (simulation and synthetic data generation)
---

# 11 — Interface Contracts v1

## 0. Why this file exists

Four lanes build in parallel. They can only do that if every boundary between them is frozen before any of them starts.

**This file is the freeze.** Every signature, schema and field name below is binding. If a work package document or `10-build-order-v1.md` says something different, this file wins.

**Changing a contract mid-build is a team decision, not an agent decision.** If an agent finds a contract that cannot be implemented, it stops, writes down why, and escalates to Adarsh. It does not quietly change the shape and carry on — that breaks three other lanes silently.

Units are stated on every field and are not negotiable. Metres for position, **millimetres for vertical displacement**, microradians for tilt, microstrain for strain, seconds for time.

---

## 1. Configuration

### 1.1 `config/assumptions.yaml`

Every A-tag lives here. **No numeric constant from the assumption register may appear anywhere in `src/`.** G15 tests this.

```yaml
schema_version: 1

mine: adriyala_lw1          # selects config/mines/<name>.yaml

sensing:
  A8_strain_rod_baseline_m: 10.0
  A9_extensometer_baseline_m: 30.0
  A10_detection_threshold_mm: 10.0

layout:
  spacing_m: 50.0           # was 40.0; see 10-build-order §0
  max_children_per_anchor: 5          # amended 17 Sep 2026 (was 8) — Adarsh, session 22

radio:
  A11_band: IN865
  A11_bandwidth_khz: 125
  A12_scout_sf: 7
  A13_anchor_sf: 8
  A12_coding_rate: "4/5"
  A12_preamble_symbols: 8
  A12_explicit_header: true
  A12_crc: true
  A14_duty_cycle_ceiling_pct: 1.0     # self-imposed engineering ceiling, not law
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

Everything mine-specific. Swapping this file swaps mines with no code change — that is half of G15.

```yaml
schema_version: 1
name: adriyala_lw1
display_name: "Adriyala Longwall Project, Panel 1 (SCCL, Godavari Valley)"

geometry:
  A1_panel_width_m: 250.0            # SOURCED
  A1_panel_length_m: 2500.0          # SOURCED
  A2_depth_m: 375.0                  # SOURCED (410 m appears in one source; conflict noted)
  A3_seam_thickness_m: null          # BROKEN — repin from JMMF Table 1 in WP0
  seam_inclination_deg: 10.0         # informational; WP1 model is symmetric
  advance_direction_deg: 0.0

knothe:
  A4_subsidence_factor: null         # BROKEN — repin in WP0
  A5_tan_beta: 2.0
  A7_time_coefficient_per_day: 0.02
  A6_face_advance_m_per_day: 4.0     # SOURCED, measured range 2.7–4.8

pinning:
  source: "10.18311/jmmf/2022/32099"
  profiles_csv: data/real/adriyala_lw1_profiles.csv
  fitted_params: data/fitted/adriyala_lw1_params.json
```

`null` is deliberate. **Loading a mine file with a `null` in `geometry` or `knothe` raises `UnpinnedParameterError`.** It does not silently substitute a default. That is what stops anyone generating a year of training data off a broken subsidence factor.

### 1.3 `config.py` — WP1

```python
@dataclass(frozen=True)
class PanelGeometry:
    width_m: float
    length_m: float
    depth_m: float
    seam_thickness_m: float

@dataclass(frozen=True)
class KnotheParams:
    subsidence_factor: float      # a
    tan_beta: float
    time_coefficient: float        # c, per day
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
    provenance_source: str         # DOI or dataset id backing the pinned params

def load_config(path: Path = Path("config/assumptions.yaml")) -> Config: ...
class UnpinnedParameterError(ValueError): ...
```

### 1.4 Derived quantities

Computed once by `config.py`, never recomputed elsewhere. Values shown are for the current baseline.

| Quantity | Formula | Value |
|---|---|---|
| Influence radius `r` | `depth / tan_beta` | 187.5 m |
| Deformation extent | `width + 2r` | 625.0 m |
| `t63` | `1 / c` | 50 days |
| Settling tail | `3 · t63 · advance` | 600.0 m |
| Travelling window | `r + tail` | 787.5 m |

---

## 2. Physics — `physics.py`, WP1

**This module contains the only implementation of `S(x,y,t)` in the repository.** Every other module that needs subsidence, tilt, curvature, strain or displacement calls into here. Duplicating the formula is a build failure (G1).

Coordinate frame: origin at the panel's starting face centre. `+x` is the advance direction along the panel axis. `+y` is transverse, positive toward the tailgate. `z` is positive up. **`S` returns subsidence in millimetres, positive downward.**

```python
def subsidence(x, y, t_days, panel, params) -> float | np.ndarray:
    """Vertical subsidence in mm, positive down. Vectorised over x and y."""

def tilt(x, y, t_days, panel, params) -> tuple[float|np.ndarray, float|np.ndarray]:
    """(dS/dx, dS/dy) in microradians."""

def curvature(x, y, t_days, panel, params) -> tuple[...]:
    """(d2S/dx2, d2S/dy2) in 1/km."""

def strain(x, y, t_days, panel, params, baseline_m, axis) -> float|np.ndarray:
    """Horizontal strain in microstrain over `baseline_m`, axis in {'x','y'}.
    Computed as a finite difference across the baseline, NOT a point derivative —
    this is what a 10 m rod or 30 m wire physically measures."""

def displacement(x, y, t_days, panel, params) -> tuple[...]:
    """(ux, uy) horizontal displacement in mm."""

def face_position(t_days, params) -> float:
    """Face x-coordinate in m at time t."""
```

All derivatives are taken numerically from `subsidence`. Do not write a second closed form for tilt or curvature — that is exactly the duplication G1 exists to prevent.

### Reference values for WP1 unit tests

Under the pre-WP0 defaults (`a = 0.6`, `m = 3.0 m`), which exist only to let WP1 start before WP0 lands:

| Assertion | Value |
|---|---|
| `S_full = a · m` | 1800 mm |
| Peak subsidence at panel centre, `t → ∞` | 1630 mm (subcritical: 250 m < r) |
| `S` at the extent edge (`y = ±312.5 m`) | ≈ 0 mm |
| `S(x, y, 0)` everywhere | 0 mm |
| Transverse profile symmetry | `S(x, y) == S(x, -y)` to float tolerance |

After WP0, these change. The tests must read expected values from the config, not hardcode them.

---

## 3. Sizing — `sizing.py`, WP2

```python
@dataclass(frozen=True)
class Node:
    node_id: int
    x_m: float
    y_m: float
    z0_mm: float              # static t=0 reference baseline ONLY (G13)
    tier: Literal["1A", "1B", "1C", "anchor", "gateway"]
    parent_id: int | None
    backup_parent_id: int | None
    child_index: int | None   # 0..max_children_per_anchor-1 within parent — emergency sub-slot (G10)
    line: Literal["transverse", "longitudinal", "crossing", "backbone"]

@dataclass(frozen=True)
class CostBreakdown:
    per_tier: dict[str, tuple[int, int, int]]   # tier -> (qty, unit_inr, subtotal_inr)
    total_inr: int

@dataclass(frozen=True)
class Layout:
    nodes: tuple[Node, ...]
    cost: CostBreakdown
    spacing_m: float
    relaxation_steps: tuple[str, ...]   # audit trail of why spacing moved, if it did

def size_network(cfg: Config) -> Layout: ...
```

**`size_network` takes exactly one argument.** There is no `n_nodes`, no `node_count`, no `target_nodes`. G2 is a signature inspection test, so adding one with a default value still fails.

Expected output at the current baseline (50 m spacing, `max_children_per_anchor: 5`): 11 transverse incl. the shared crossing + 14 longitudinal = **25 Scouts**, 6 Anchors (loads 3/4/4/4/5/5), 1 Gateway. Total ₹72,800. Amended 17 Sep 2026 — the old line (30 Scouts, 5 Anchors at 6 children each) predates both the 50 m re-spacing and the cap amendment, and 6 children now exceeds the cap.

Node ID allocation (amended 17 Sep 2026, session 24): Gateway is 0, Anchors are 1..N contiguously, Scouts start at `max(100, 1 + N)`. **N is not bounded.** The old fixed 1–99 Anchor range was a ceiling on how many Anchors a mine could have; it is gone, and 100 survives only as the *floor* Scout IDs start at, so a mine needing fewer than 99 Anchors numbers its Scouts from 100 exactly as before. Never assume contiguity across tiers, and never derive behaviour from an ID's numeric value — that is the bug G10 exists to prevent. In particular, an ID is no longer a way to tell an Anchor from a Scout: read `node.tier`.

**Anchor count rule (amended 17 Sep 2026, session 24 — supersedes the session-23 rule below).** The anchor count is pure arithmetic: `ceil(scouts / (max_children_per_anchor - 1))`, floor 2 so every Scout has a distinct backup. **Nothing truncates it.** One spare child slot per Anchor — so an orphan whose Anchor dies has somewhere to fail over — is therefore guaranteed on every mine, not traded away. `max_children_per_anchor` remains the one hard limit, but it is the *divisor* in that expression (one Anchor's radio capacity), not a ceiling on the count. **There is no maximum mine size.** `node_plan.json` reports `checks.anchors_with_spare_slot` and `checks.nominal_children`.

> *Superseded (session 23):* the count was clamped to the 1–99 ID range, so a mine past the preferred count spread over the full 99 Anchors and let the mean load rise toward the cap, refusing only above `99 × max_children_per_anchor` = 495 scouts. `checks.headroom_clamped` reported that trade and no longer exists. `illinois_lw` was the mine that hit it: 421 scouts, clamped to 99 Anchors, now 106.

---

## 4. World state — `world.py`, WP3

Owns terrain truth. **Nothing else writes Z.** (Locked Decision 1, G13.)

```python
@dataclass(frozen=True)
class Delta:
    t_s: float
    epoch: int
    cells: tuple[tuple[int, int, int], ...]   # (i, j, dz_mm) — int mm, see below

class WorldState:
    def __init__(self, cfg: Config, layout: Layout) -> None: ...
    def step(self) -> Delta:
        """Advance one timestep, mutate the surface, return the delta."""
    def z_at(self, x_m: float, y_m: float) -> float:
        """Live surface Z in mm at an arbitrary point. Bilinear interpolation."""
    def snapshot(self) -> np.ndarray: ...
    @property
    def epoch(self) -> int: ...
```

### The replay rule (G6)

`dz_mm` is an **integer millimetre**. Deltas accumulate by integer addition, so replaying from t=0 to T reproduces the surface at T **bit-identically**, not approximately. Float accumulation drifts and will fail G6 on a 690-day run. Keep the internal grid in integer mm; convert to float only at the `z_at` interpolation boundary.

Cells with `dz_mm == 0` are omitted from the delta. A timestep where nothing moved emits a `Delta` with an empty `cells` tuple, not no delta at all — epoch numbering must stay dense.

---

## 5. Sensors and provenance — `sensors.py`, `provenance.py`, WP4

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
    subsidence: Value          # mm
    tilt_x: Value | None       # microradians, tier 1A only
    tilt_y: Value | None
    strain: Value | None       # microstrain, tiers 1B and 1C
    displacement: Value | None # mm, tier 1B only
    battery_mv: Value

def read_node(node: Node, world: WorldState, cfg: Config, rng) -> Reading: ...
```

### Provenance assignment rules

Binding. G4 and G5 test these.

| Tag | Assigned when |
|---|---|
| `real` | The value is a digitised field measurement, at a monument position and a monument epoch |
| `pinned` | The value comes from a model whose parameters were fitted to real measurements, evaluated at a point or time where real data exists |
| `synthetic` | Everything else — interpolated between monuments in space, between epochs in time, all derivatives, all sensor noise, all battery models |

There is no fourth tag and no `unknown`. A `Value` that cannot be assigned one of the three is a bug.

**Every tilt, strain and displacement value is `synthetic`**, always. No real strain or tilt time series exists for the Adriyala surface. They are derivatives of a fitted surface. Say this in the pitch rather than letting anyone assume otherwise.

### Sensor model

Each tier applies, in this order: ideal value from `physics` → resolution quantisation → bias → temperature drift → Gaussian noise. Every one of those steps is `synthetic`. Tilt carries the largest drift term by design — consumer MEMS tilt drifts with temperature by more than the subsidence signal is worth, which is why tilt is a **secondary signal and never primary**, and why common-mode rejection is applied *after* computing σ, not before.

---

## 6. Radio — `packet.py`, `radio.py`, WP5

```python
@dataclass(frozen=True)
class Packet:
    node_id: int
    epoch: int                 # from the network beacon — monotonic, survives reboot
    seq: int                   # diagnostic ONLY. Never a dedup key (G7)
    payload: bytes             # 23 B scout uplink
    sf: int
    channel: int

@dataclass(frozen=True)
class TxRecord:
    packet: Packet
    t_s: float
    slot_index: int
    parent_used: int           # anchor node_id that actually received it
    rssi_dbm: float
    delivered: bool
    airtime_ms: float
    via_emergency: bool

class Superframe:
    def __init__(self, cfg: Config, layout: Layout) -> None: ...
    def run(self, readings: Sequence[Reading], epoch: int, rng) -> list[TxRecord]: ...
    def duty_cycle(self, tier: str) -> float:
        """Fraction of the superframe period spent transmitting, 0..1."""
```

### Binding radio facts

Corrected airtimes under A11/A12 — BW125, CR 4/5, explicit header, CRC on, 8-symbol preamble. **The 90.4 ms figure from earlier documents is wrong and matches no valid configuration.**

| Payload | SF7 | SF8 | SF9 |
|---|---|---|---|
| 23 B scout uplink | **61.7 ms** | 113.2 ms | 205.8 ms |
| 98 B anchor bundle | 169.2 ms | **297.5 ms** | 533.5 ms |
| 6 B bitmap ACK | **36.1 ms** | 65.9 ms | 118.6 ms |
| 1 B minimum | 25.9 ms | 51.7 ms | 103.4 ms |

A "20 ms ACK" cannot exist — the preamble alone costs 12.5 ms at SF7.

**Dedup key is `(node_id, epoch)`.** Never `(node_id, seq)`: sequence numbers reset on reboot and silently merge distinct packets. G7.

**Emergency sub-slot is `node.child_index`, `0 .. max_children_per_anchor-1`** (0–4 at the current cap of 5; `radio.py` divides the emergency window by the cap, so the sub-slot count follows the config, not a literal). Never `node_id % 16`: the realistic failure is one Anchor dying and orphaning all its children at once, and under modulo, two children with IDs congruent mod 16 land in the same sub-slot and collide — precisely the scenario the mechanism exists to survive. G10, G11.

**Per-device ACKs do not exist.** One bitmap ACK per Anchor covers all its children in 36 ms. Six individual ACKs cost 155 ms and push the Anchor past its ceiling.

### Superframe schedule, 60 s period

| t | Event | Airtime |
|---|---|---|
| 0.0 s | Gateway beacon: time sync + bitmap ACK for Anchors | 82 ms, SF8 |
| 2.0 s | Scout uplink window opens — 30 Scouts over 4 channels, slot = 61.7 ms + 30 ms guard | |
| 11.5 s | Scout uplink window closes | |
| 12.0 s | Anchor broadcasts single bitmap ACK | 36 ms, SF7 |
| 13.0 s | Anchor → Gateway bundle, 2 backbone channels | 298 ms, SF8 |
| 15.5 s | Emergency window opens, 8 sub-slots × 92 ms = 736 ms | |
| 16.5 s | All tiers sleep | |

**Scout receive discipline is the power-critical rule.** A Scout transmits around t = 2.1 s but its ACK does not arrive until t = 12.0 s. It sleeps in between and wakes on a timer. Holding the radio in receive costs ~1.82 mA against ~0.04 mA for timer wake — a 45× difference that defeats the entire TDMA design. G9.

---

## 7. Output — `stream.py`, WP6

### 7.1 `out/nodes.csv`

One row per node per superframe. Column order is binding; Part 2 parses positionally.

```
epoch,t_s,node_id,tier,x_m,y_m,z0_mm,subsidence_mm,subsidence_prov,
tilt_x_urad,tilt_y_urad,tilt_prov,strain_ustrain,strain_prov,
disp_mm,disp_prov,battery_mv,rssi_dbm,parent_used,delivered,via_emergency
```

Empty string for sensor fields a tier does not carry. **Every value column has a paired `_prov` column** — that is G4, and it is why the provenance columns are not optional.

Rows are written for undelivered packets too, with `delivered=false`. Packet loss is a normal operating condition for Part 2, not an error case, and a missing row is indistinguishable from a node that never existed.

### 7.2 `out/terrain_state.npz`

Full surface at t = 0. Grid origin, cell size, shape, and int-mm elevation array.

### 7.3 `out/terrain_changes.jsonl`

One JSON object per line, one line per timestep, in order.

```json
{"epoch": 1, "t_s": 3600.0, "cells": [[120, 44, -3], [120, 45, -4]]}
```

Replaying every line from t=0 to T reconstructs the terrain at T exactly. This is the scrub mechanism for Part 3's 3D view and the reproducibility guarantee for Part 2's A/B tests.

### 7.4 WebSocket frame

FastAPI, endpoint `/ws/run`. One message per simulated superframe.

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

Control messages from the client: `{"type": "start", "from_day": 0}`, `{"type": "pause"}`, `{"type": "seek", "to_day": 120}`.

**There is no click-to-subside.** Deformation is driven by data and fitted parameters. The client can start, pause and seek; it cannot deform the ground.

---

## 8. Errors

```python
class UnpinnedParameterError(ValueError): ...      # null in a required config field
class ProvenanceError(ValueError): ...             # Value built without a valid tag
class ContractViolation(RuntimeError): ...         # a gate invariant broken at runtime
```

Raise loudly. Nothing in this system silently substitutes a default for a missing pinned parameter — the entire point of WP0 is that a wrong parameter is worse than a crash.
