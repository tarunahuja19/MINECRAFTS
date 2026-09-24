---
title: "WP-C — Contracts and Repo Skeleton"
slug: WPC-contracts-and-skeleton
type: work-package
module: governance
status: reviewed
tags: [work-package, wpc, scaffolding, contracts, stubs, d0]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WPC-contracts-and-skeleton.md
---

# WP-C — Contracts and Repo Skeleton

| Field | Details |
|---|---|
| **Owner** | [[people/claude-code\|Claude Chat]] + [[people/adarsh-agarwala\|Adarsh]] |
| **Agent Role** | Any agent — scaffolding, dataclasses, and loader |
| **Depends on** | None |
| **Blocks** | Everything (D1 parallel lanes) |
| **Day Scheduled** | D0 |
| **Enables Gates** | [[gates/G01-single-physics-implementation\|G01]], [[gates/G02-no-node-count-parameter\|G02]], [[gates/G15-config-driven-mine-independence\|G15]] |

---

## 1. Goal

Establish the repository skeleton, configuration parser, and complete dataclass and function signatures from `[[docs/interface-contracts]]` so that all four development lanes can start concurrently on D1 without awaiting peer logic.

> [!NOTE]
> Every stubbed function body must raise `NotImplementedError`. No behavior is implemented in WP-C except for `config.py` loading and validation.

---

## 2. Files Owned

```
AGENTS.md
pyproject.toml
config/assumptions.yaml
config/mines/adriyala_lw1.yaml
config/mines/illinois_lw.yaml
src/minesim/__init__.py
src/minesim/config.py          (dataclasses + loader, real implementation)
src/minesim/errors.py
src/minesim/physics.py         (stubs)
src/minesim/sizing.py          (stubs)
src/minesim/world.py           (stubs)
src/minesim/sensors.py         (stubs)
src/minesim/provenance.py      (stubs)
src/minesim/packet.py          (stubs)
src/minesim/radio.py           (stubs)
src/minesim/stream.py          (stubs)
src/minesim/run.py             (stubs)
tests/conftest.py
```

---

## 3. Work Description

1. **Repository Skeleton:** Setup tree with `pyproject.toml` targeting Python 3.11+, with dependencies: `numpy`, `scipy`, `pyyaml`, `fastapi`, `uvicorn`, `pytest`.
2. **Config Implementation (`config.py`):**
   - Load `assumptions.yaml`, resolve `mine:` key to `config/mines/<name>.yaml`, and merge.
   - Instantiate frozen dataclasses adhering strictly to `[[docs/interface-contracts]]` §1.3.
   - Calculate derived constants ($r = 187.5\text{ m}, W_{ext} = 625.0\text{ m}, L_{window} = 787.5\text{ m}$) as cached properties.
   - **Raise `UnpinnedParameterError` on any `null` in `geometry` or `knothe`.** No fallback defaults allowed.
3. **Stubs:** Construct every signature with complete type hints and contract docstrings, raising `NotImplementedError`.
4. **Second Mine Configuration (`config/mines/illinois_lw.yaml`):** Secondary mine with `null` fields to guarantee mine-independence from Day 0.
5. **Agent Governance:** Place `[[docs/agents-invariants|AGENTS.md]]` in repo root.

---

## 4. Definition of Done

- [ ] `pip install -e .` succeeds in clean environment.
- [ ] `from minesim import config, physics, sizing, world, sensors, radio, stream` succeeds without import error.
- [ ] `load_config()` on Adriyala raises `UnpinnedParameterError` due to unpinned A3/A4 parameters.
- [ ] Temporarily filling A3/A4 returns valid `Config` with derived values ($r=187.5\text{ m}$, extent $=625.0\text{ m}$, window $=787.5\text{ m}$).
- [ ] `pytest` collects all stubs without syntax or import errors.
- [ ] `grep -rnE '\b(375|250|2500|61\.7|0\.6|187\.5)\b' src/` returns zero occurrences outside `config.py` docstrings.

---

## 5. Absolute Prohibitions

- Do not implement any physics, sizing, world, sensor, radio, or streaming logic.
- Do not introduce default parameters that bypass unpinned empirical values.
- Do not introduce `node_count` into any signature.
