# WP7 — Gate Harness and Integration

| | |
|---|---|
| **Owner** | Claude Code (Lane B) |
| **Depends on** | WP-C |
| **Blocks** | release |
| **Days** | D5–D7, then D7 integration day |
| **Gates** | owns G14; runs all sixteen |

## Goal

Sixteen gates, each independently runnable, each pass/fail, none of them polite. Plus the D7 integration run where four lanes meet for the first time.

## Files owned

```
tests/gates/__init__.py
tests/gates/conftest.py
tests/gates/test_g14.py
tests/gates/helpers.py
scripts/run_gates.py
GATES.md
```

Gates G1–G13 and G15 are **written by their owning packages** — the package that builds the thing writes the test that proves it. WP7 owns the harness, the shared fixtures, G14, and the job of making every gate runnable in isolation.

## Harness rules

**Every gate runs alone.** `pytest tests/gates/test_g08.py` must work on a fresh checkout even if WP3 has not been written. If a gate needs an unbuilt package, stub it in `conftest.py`. A gate that only runs after everything else is finished is worthless — it tells you at the end of the project what you needed to know at the start.

**No gate uses a tolerance where exactness is the claim.** G6 asserts bit-identical replay, so it uses `np.array_equal`, not `allclose`. A tolerance there would pass while drifting.

**Every gate must be provably able to fail.** For each one, write the negative case: deliberately break the invariant and confirm the gate catches it. A gate nobody has seen fail is a gate nobody should trust. G11 is the model — exhaustive over adversarial ID assignments, impossible to pass by luck.

## The sixteen gates

| Gate | Assertion | Written by |
|---|---|---|
| G0 | Every BROKEN A-tag is repinned from real data; `data/fitted/*.json` records the residual | WP0 |
| G1 | Exactly one implementation of `S(x,y,t)` exists in the repository | WP1 |
| G2 | Sizing algorithm accepts no node-count input parameter | WP2 |
| G3 | Sizing algorithm emits a cost breakdown with every layout | WP2 |
| G4 | Every row in `nodes.csv` carries a provenance tag | WP4 |
| G5 | No `synthetic` value is generated from anything other than observed data behaviour | WP4 |
| G6 | Replaying `terrain_changes` from t=0 to T reproduces terrain at T bit-identically | WP3 |
| G7 | Dedup uses `(node_id, epoch)`; no use of `seq` as a key | WP5 |
| G8 | Anchor duty cycle ≤ 1% at the configured backbone SF | WP5 |
| G9 | Scout radio is in receive < 0.5 s per superframe | WP5 |
| G10 | Emergency sub-slot derives from child index, not node ID modulo | WP5 |
| G11 | No two children of one Anchor share an emergency sub-slot, under any ID assignment | WP5 |
| G12 | Sizing emits a total cost with every layout; never fails on cost | WP2 |
| G13 | `z0` is never written after t=0; live Z comes only from the world-state engine | WP3 |
| **G14** | **No PINN output feeds any alarm decision** | **WP7** |
| G15 | Changing any A-tag re-runs sizing without a code change; changing the mine file swaps mines | WP2 |

## G14 — the one WP7 owns

**Assertion:** no neural network output reaches any alarm decision, and no PINN exists in this build.

This is the project's central safety claim and the thing a judge is most likely to probe. It is also the easiest to violate by accident, because early documents 00–07 described a PINN and someone will eventually re-read one and reimplement it in good faith.

Implement as a repository-wide static check:

- No import of `torch`, `tensorflow`, `jax`, `keras` or `sklearn` anywhere in `src/`
- No module, class or function named `pinn`, `PINN`, `neural`, `model_predict` or similar
- `physics.py` contains no learned parameters — every constant traces to config or to `data/fitted/*.json`
- No alarm, threshold, classification or detection logic exists in Part 1 at all

That last point is worth stating plainly: **Part 1 does not raise alarms.** It generates data. The classical Knothe-fit detector is Part 2's, and it is the only thing in the whole system that raises an alarm. If any Part 1 module grows a `should_alarm()`, G14 fails and the architecture has drifted.

## D7 — integration day

Not optional, not movable. Four lanes that have never run together will not run together on the first attempt; find out on D7, not D9.

### Order

1. Merge all lanes into `main`. Resolve conflicts before running anything.
2. `pytest tests/unit` — all unit tests green.
3. `python scripts/run_gates.py` — all sixteen gates, report as a table.
4. Full run: 690 days, Adriyala config, artefacts to `out/`.
5. Verify the three artefacts exist and parse.
6. Replay check: reconstruct terrain at day 345 from the log, compare against a snapshot.
7. Connect a WebSocket test client, confirm frames arrive in order.
8. Read `run_summary.json` aloud to the team. Especially the provenance breakdown.

### Expected first-run failures

Write these down in advance so nobody panics:

- Contract drift between lanes — one lane's dataclass gained a field. Fix in the contract, not locally.
- Performance — the 690-day run exceeding 60 s. Likely a Python loop over grid cells where a vectorised `physics` call belongs.
- G6 failing by a few millimetres — someone used floats in the accumulating grid.
- G5 being hard to make meaningful. It is the hardest gate to write honestly. Budget time.
- Provenance `real` fraction being surprisingly low. That is the correct answer, not a bug.

## `GATES.md`

A living table in the repo root: gate, owner, status, last run, negative case written yes/no. Regenerated by `scripts/run_gates.py`. This is what gets shown to a judge who asks how the team knows the system works.

## Definition of done

- [ ] All sixteen gates runnable individually on a fresh checkout
- [ ] Every gate has a written negative case that has been observed to fail
- [ ] `scripts/run_gates.py` prints a pass/fail table
- [ ] `GATES.md` generated and current
- [ ] D7 integration run completed end to end
- [ ] G14 static check covers the whole of `src/`

## Do not

- Weaken a gate to make it pass. If a gate fails, the code is wrong, or the gate was wrong from the start and the team agrees to change it in writing.
- Use a tolerance where the claim is exactness.
- Write a gate that only runs after the whole system is built.
- Let any gate be marked passing without a negative case.
- Add alarm logic to Part 1 in order to test it. G14 forbids it existing at all.
