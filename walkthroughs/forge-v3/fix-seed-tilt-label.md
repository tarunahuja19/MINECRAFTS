# Fix — `/forge/seed` mislabels a live tilt bowl as a cave-in

## The bug
`forge/server.py`'s `GET /forge/seed` reconstructs FORGE's event list from `:8000/interventions`. A failure that belongs to a scripted event is seeded from `script_events[owner]` (the real event dict, correct). Every *other* ("unowned", i.e. fired live rather than by a script) failure was unconditionally rebuilt as:
```python
events.append({"type": "cave_in", "x": pf["cx"], "y": pf["cy"], "radius_m": pf["radius_m"],
                "depth_m": pf["magnitude_m"], ...})
```
regardless of what the failure actually was. `collapse.PillarFailure` carries a `ring` field (`True` for a cave-in or one link of a crack chain, `False` for a tilt event's offset bowl — see `sandbox/collapse.py:50` and `sandbox/events.py`'s `to_failures`), but `/interventions` never sent it and `/forge/seed` never looked for it, so any unowned tilt bowl would have shown up in the FORGE event list, the timeline and the 3D zone rings labelled "CAVE-IN" — wrong shape, wrong radius semantics (a cave-in's `radius_m` is the pit, a tilt's is the offset distance to the target).

**Reachability today:** `:8000/control` (and its WebSocket twin) only ever create failures through `session.apply_collapse`, which is always a genuine cave-in, so no *live* tilt exists yet to trigger this — the bug was latent, not yet visible in the running demo. It is real code, though: the docstring on `/interventions` already anticipates "a tilt an offset bowl" and any future live tilt/crack trigger (or a bug elsewhere that creates one) would have silently mislabeled it.

## The fix
- `sandbox/server.py` `/interventions`: each failure dict now includes `"ring": pf.ring`.
- `sandbox/events.py`: new public `tilt_rate_mm_per_m(radius_m, depth_m)`, the inverse of the depth solved in `to_failures`'s `tilt` branch (wraps the existing `_tilt_per_metre_of_depth`).
- `forge/server.py` `/forge/seed`: branches on `pf.get("ring", True)` (missing field defaults to `True`, so an older engine payload still reads as a cave-in, unchanged). `ring=False` is rebuilt as a `{"type": "tilt", ...}` event instead: `x, y` from the failure's own centre (the true original target and bearing aren't recoverable from a bare `PillarFailure`, so the centre stands in as the target and the bearing as due north — a best-effort reconstruction, not exact), `radius_m` and `over_days` (from `duration_days`) exact, `rate_mm_per_m` recovered exactly via `tilt_rate_mm_per_m`.

## Files
`simulation/sandbox/server.py`, `simulation/sandbox/events.py`, `simulation/forge/server.py`, `simulation/tests/test_forge.py` (+1 test).

## Verify
```
cd simulation && .venv/bin/python -m pytest -q --ignore=tests/test_stress_1000_trials.py
```
169 passed (168 before this fix + 1 new). New test `test_forge_seed_labels_a_tilt_bowl_as_tilt_not_cave_in`: a mocked `:8000/interventions` payload with one unowned `ring: false` failure comes back from `/forge/seed` as `type: "tilt"` with the exact `x, y, radius_m, over_days` and a `rate_mm_per_m` matching `events.tilt_rate_mm_per_m` — not `"cave_in"` — and feeds straight back into `/forge/frame` as a valid `TiltEvent`.

```
node dashboard_electron/test/verify_forge_events.js     # PASS (unchanged — no live tilt path exercised)
node dashboard_electron/test/verify_forge_b3.js          # PASS
node dashboard_electron/test/verify_forge_isolation.js   # PASS
cd simulation/frontend && npx tsc --noEmit               # clean
```
No behavioural change for anything reachable today (every live failure still has `ring=True`); this only stops a currently-latent mislabel from reaching an operator once a live tilt/crack trigger exists outside a script.
