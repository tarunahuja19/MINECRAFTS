# T5 + W1 — Scenario Lab base, and the two sinking events

**Status:** built by Claude, 17 Sep (session 22). Branch `feat/viz-darker-ground-bigger-nodes`.
**Why now:** Adarsh asked why the header button "❄ Freeze + create subsidence" does nothing. It is a
hard-coded `disabled` placeholder (`renderer/index.html:136`) and everything behind it was unbuilt. This
step builds the base (T5) and the two events that drop the surface (W1). The button stays disabled,
because the server (W3) and the Window 2 page (W4) are still not built — the lab runs headlessly for now.

---

## 1 · The boundary, which is the whole point

Contract §7.4 says **"there is no click-to-subside."** That stays true. `scenario-lab/` is a separate
package that:

- reads a **finished** run's artefacts read-only (`terrain_state.npz`, `terrain_changes.jsonl`,
  `run_summary.json`);
- builds a frozen snapshot **in memory** at day T;
- computes the scenario on that copy;
- never imports `minesim.world` or `minesim.stream`, never writes under `mine-sim/`.

`test_nothing_is_written_to_the_run` asserts the mtimes of every file in the run directory are unchanged
across a snapshot load. Gate L1 (the full sha256 sweep) arrives with W3.

The delta replay is **re-implemented** in `lab/snapshot.py` rather than imported, because gate L3 forbids
importing `minesim.stream` from `lab/`. Two implementations of one thing is a standing risk, so
`test_replay_matches_the_simulator_own_replay` asserts they agree cell for cell (`np.array_equal`) at
day 0, mid-run and the last day, instead of assuming it.

---

## 2 · The rule that shapes the whole package: fields never come from the int grid

WP9 §3, from the 14 Sep stress test: rounding S to whole millimetres on 5 m cells produces strain errors
up to **4.9 mm/m** against a true peak of **4.5 mm/m** — the rounding noise is larger than the signal.

So `derive_fields` **raises TypeError** on an integer array rather than returning a plausible-looking
wrong answer. The int grid `s_mm` is for display and before/after surface numbers only; every derivative
comes from the float `s_model_mm` plus the float `ds`.

`Snapshot` also refuses to exist if the two disagree: `max |s_model_mm − s_mm|` must be within
`world_model_tolerance_mm` (2.0 mm), else `ValueError`. Measured on the 120-day run: **0.5 mm**.

---

## 3 · Gate L5 — the lab's fields are the simulator's fields

Not a style check. It stops the lab quietly inventing its own ground mechanics.

| comparison | result |
|---|---|
| `tilt` vs `−physics.tilt` (above 0.5 mm/m) | worst **< 3 %** |
| `curv` vs `−physics.curvature` (above a tenth of peak) | worst **2.0 %**, median **0.5 %** |
| `strain_y` sign | trough floor **compression**, beyond the rib **tension** |
| `derive_fields` on an int array | **TypeError** |

The curvature mask is a tenth of peak on purpose. A *relative* tolerance is meaningless at a zero
crossing, and the trough has two: over the whole grid the worst relative error is 13 %, and every one of
those cells sits on a zero crossing where |want| → 0. Above the mask it is 2 %.

---

## 4 · The two events (W1)

Both call **`physics.subsidence` and nothing else** — Invariant 4 / gate G01: the trough formula exists
once in this repository. Neither writes a second one.

**`sudden_sinking`** — ground over already-extracted coal drops now by what it still had left.
`U = max(0, S_settled − S_now)`, `ds = U · taper(d, R, r)`. `U` is what makes the event honest: it can
bring future subsidence forward, never invent new subsidence. `test_never_exceeds_the_remaining_capacity`
asserts `ds ≤ U` even at a 400 m radius.

**`edge_collapse`** — the chain pillar on one rib crushes, so the ground behaves as if the panel were
wider on that side. Built as the difference of two calls to the same formula, one on a panel widened by
the failed pillar and shifted by half of it so the **far** rib does not move.

The taper is a raised cosine, not a step, so the ground never gains a vertical cliff — a cliff would give
a fake infinite tilt and strain at the rim and light up every consequence downstream.

### Refusals are the feature

An event that cannot happen says so in plain words. A silent array of zeros reads as "nothing much
happened", which is a different claim.

| click | verdict |
|---|---|
| 10 m behind the face | possible |
| 300 m ahead of the face | "no extracted coal under this spot, nothing to collapse into" |
| settled ground at the end of the run | "ground here has already settled (N mm left)" |
| `y0 = 0` for an edge collapse | "click nearer one panel edge: this event needs a side to fail on" |
| `collapse_radius_m` out of its yaml range | `ValueError` — refused, never clamped |

---

## 5 · No magic numbers (gate L4)

Every physical or chosen value is in `scenario-lab/config/lab.yaml` or `config/events/*.yaml` with a
`source:` string. `tests/gates/test_l4.py` walks the AST of every file in `lab/` and allows only
`{0, 1, 2, 0.5, −1, 1000, 86400}` — indices, halves, squares, m↔mm and s/day.

Two extra checks on top of the spec: every event input must carry a non-empty `source`, and that source
must contain the words **"scenario input"** — Invariant 7, so a user's hypothesis can never be read back
as a measurement at this mine.

---

## 6 · Hand check

```bash
/opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m pip install -e scenario-lab
/opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -c "import lab; print('lab ok', sorted(lab.EVENTS))"
cd scenario-lab && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m pytest -q
```

Expect `lab ok ['edge_collapse', 'sudden_sinking']`.

`LAB_TEST_RUN=<dir>` points the suite at another finished run. Without it the suite uses
`mine-sim/out/v2-690d`, and builds an 80-day run only if that is missing.

---

## 7 · What is NOT built

- **W3** the server, **W4** the Window 2 page — so the header button stays `disabled`.
- **W2** crack, **W5** blast, **W6** sinkhole events; **T6** damage grades and objects; **T7** forecast.
- Gates **L1, L2, L3, L6, L7** — they belong to W3/T7. Only **L4** and **L5** exist.
