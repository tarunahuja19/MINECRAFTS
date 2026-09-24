# WP-C — Contracts and Repo Skeleton

| | |
|---|---|
| **Owner** | Claude (chat) + Adarsh |
| **Agent** | any — this is scaffolding, not logic |
| **Depends on** | nothing |
| **Blocks** | everything |
| **Day** | D0 |
| **Gates** | none directly; enables G1, G2, G15 |

## Goal

Land the repository skeleton, the config files, and every dataclass and function stub from `11-interface-contracts-v1.md` — so that four lanes can start on D1 and import each other's types without waiting for each other's logic.

Nothing in this package implements behaviour. Every function body is `raise NotImplementedError`. That is correct and intentional.

## Files owned

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

## Work

1. **Skeleton.** Create the tree above. `pyproject.toml` with `numpy`, `scipy`, `pyyaml`, `fastapi`, `uvicorn`, `pytest`. Python 3.11+.

2. **Config, fully implemented.** `config.py` is the one module in this package with real logic:
   - Load `assumptions.yaml`, resolve `mine:` to `config/mines/<name>.yaml`, merge.
   - Build the frozen dataclasses exactly as specified in contracts §1.3.
   - Compute the derived quantities in contracts §1.4 once, expose as properties.
   - **Raise `UnpinnedParameterError` on any `null` in `geometry` or `knothe`.** No defaults, no warnings, no fallbacks. This is the guard that stops the team generating a year of data off a broken subsidence factor.

3. **Stubs.** Every signature from contracts §2–§7, with full type annotations and docstrings copied from the contract. Bodies raise `NotImplementedError`. Type annotations must be complete — Lane C and Lane D type-check against these before any logic exists.

4. **`config/mines/illinois_lw.yaml`.** Second mine, all geometry `null`, filled by WP0 on D8. Its existence at D0 is what keeps mine-independence honest: if the code only ever sees one mine file, it will grow Adriyala-shaped assumptions.

5. **`AGENTS.md`** into the repo root, verbatim from the build plan folder.

## Definition of done

- [ ] `pip install -e .` succeeds
- [ ] `from minesim import config, physics, sizing, world, sensors, radio, stream` succeeds
- [ ] `load_config()` on the Adriyala file raises `UnpinnedParameterError` (A3/A4 are `null` until WP0)
- [ ] Temporarily filling A3/A4 with any number makes `load_config()` return a valid `Config` with correct derived quantities: r = 187.5 m, extent = 625.0 m, window = 787.5 m
- [ ] `pytest` collects without import errors
- [ ] Every stub has a complete type annotation
- [ ] `grep -rnE '\b(375|250|2500|61\.7|0\.6|187\.5)\b' src/` returns nothing outside `config.py` docstrings

## Do not

- Implement any physics, sizing, world, sensor, radio or stream logic. Other lanes own those and will overwrite you.
- Add a `node_count` parameter anywhere, even as a convenience.
- Give any config field a default value that substitutes for a pinned parameter.
- Add dependencies beyond the list above without asking.
