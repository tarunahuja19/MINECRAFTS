# B2e TILT · B2f VIBRATION as FORGE timeline events (B2d CRACK still open)

Built by Claude on 27 Sep. Both events use only maths the engine already has.

## What the engine models (checked 27 Sep)

- **TILT:** the engine has no separate tilt physics. The standalone sim's TILT (`App.tsx handleTriggerEvent`) is an `apply_collapse` centred one radius off the target, so the target sits on the bowl's flank, where dS/dx is largest.
- **VIBRATION:** `Session.apply_vibration(magnitude_ppv, duration_s=60)` adds the PPV to every node's vibration RMS for `duration_s` (peak = 1.45 × RMS in `sensors.py`). It has no position, moves no ground and changes no node state.
- **CRACK:** nothing in `simulation/sandbox`. The only crack model is the 690-day lab on :8010, which FORGE must not call. **B2d needs a decision from Adarsh** (see the plan).

## What changed

- **`simulation/forge/server.py`**
  - `CaveInEvent` gains `kind: "cave_in" | "tilt"` plus descriptive `target_x/y`, `rate_mm_per_m` and `direction_deg`. The maths is still the cave-in.
  - New `VibrationEvent {type:"vibration", day, ppv_mm_s > 0, duration_s = 60}`. Events are a discriminated union, so `crack` and unknown types still get 422.
  - Frames carry `vib_mm_s`, and each node's `vib_rms` / `vib_peak` (× 1.45) while a vibration is in force. `/forge/range` ignores vibrations.
- **`sim-tab.js`**
  - FIRE TILT adds `{type:"cave_in", kind:"tilt"}`, centred `r` away from the target along the bearing (0° = N, 90° = E), with depth = rate × r / 1000.
  - FIRE VIBRATION adds a 60 s site-wide event with the PPV slider value.
  - The TILT preview ring sits on the offset bowl and follows the direction slider too.
  - PLAY also lands inside the 60 s vibration window.
  - The node card gains a Vibration row. Tilt bowls are tagged "T" on the mini map; vibrations appear only in the event list, since they have no position.
  - The old `fireForgeTrigger` (which called `triggerScenario` and made the slot draw its own bowl) is gone.
- **`index.html`:** the meaningless vibration RADIUS slider is replaced by a one-line note, and DIRECTION says "0° = N".
- **3D view** (`App.tsx`, `embed.ts`):
  - `forge-effect` accepts `tilt`: the same dust as a cave-in, with a tilt toast.
  - It accepts `vibration`: shake and ground ripple only, with no geomechanics call.

## Tests

### `node dashboard_electron/test/verify_forge_events.js`

```
[1] CRACK
  PASS  CRACK says "CRACK: NOT BUILT YET (B2d)" and adds no event

[2] TILT 5 mm/m toward 90° (east), r 100 m, at target (0, 0), day 20
  preview: {"x":100,"y":6.123233995736766e-15,"r":100}
  PASS  TILT preview ring sits on the offset bowl (100, 0), r 100
  [SCREENSHOT] forge-tilt-preview.png
  event: {"type":"cave_in","kind":"tilt","x":100,"y":6.123233995736766e-15,"radius_m":100,"depth_m":0.5,"day":20,"duration_h":4.8,"target_x":0,"target_y":0,"rate_mm_per_m":5,"direction_deg":90}
  rows: ["Day 20.0 · TILT 5 mm/m toward 90° at (0, 0), r 100 m"]
  PASS  TILT event = engine tilt: cave-in centred one radius off the target, depth = rate × r
  PASS  event list shows the TILT line
  PASS  forge-effect "tilt" played at the bowl
  END applied: {"event":"forge-frame-applied","t_days":120,"perturbations":1,"max_amp":0.5,"time_scalar":0.99177,"source":"r4-sim-viewport"} | max subsidence tilt/cave: 2.3183 2.3183
  PASS  max_amp at END ≈ 0.5 m: 0.5
  PASS  :8020 computes TILT exactly as the offset cave-in
  within 1.2R of the bowl: N05,N06,N17,N23,N24
  PASS  nodes within 1.2R of the tilt bowl are CRITICAL mid-collapse
  [SCREENSHOT] forge-tilt-during.png

[3] VIBRATION 20 mm/s on day 30
  PASS  VIBRATION shows no radius preview (site-wide)
  event: {"type":"vibration","x":0,"y":0,"day":30,"ppv_mm_s":20,"duration_s":60}
  PASS  VIBRATION event carries PPV 20 mm/s, 60 s (engine default), day 30
  PASS  event list shows the VIBRATION line
  PASS  forge-effect "vibration" (shake) reached the 3D view
  frames with vibration during PLAY at days: [30]
  PASS  PLAY landed inside the 60 s vibration window
  PASS  inside the window every node reads vib_rms 20 mm/s
  PASS  vibration moves no ground and changes no node state
  N01 card: NODE N01 | ACTIVE | Role / tier | SCOUT · 1A | x, y | -135 m, 135 m | lat, lng | 18.64471, 79.57122 | Subsidence | 706.0 mm | Tilt | 7.87 mm/m | Vibration | 20.0 mm/s RMS | Nearest event | no event yet | First alarm | none
  PASS  node card shows the vibration reading
  [SCREENSHOT] forge-vibration.png

[4] Isolation
  PASS  globalGeomechanics.triggerCollapse calls in the FORGE slot: 0
  PASS  MAP node states and ALARMS count unchanged
  page: {"control":0,"forbidden":[],"lab":0}
  PASS  zero :8010, /control and forbidden /api/simulation/* requests

=====================================================
ALL FORGE EVENT CHECKS PASSED
=====================================================
```

### Full set

```
verify_forge_isolation: ALL CHECKS PASSED
verify_forge_close: ALL 6 CHECKS PASSED
verify_forge_events: ALL FORGE EVENT CHECKS PASSED
verify_forge_b3: ALL FORGE B3 CHECKS PASSED
verify_forge_cavein: ALL FORGE CAVE-IN CHECKS PASSED
verify_forge_timeline: ALL FORGE TIMELINE VERIFICATION CHECKS PASSED
verify_sandbox: ✓ ALL SPECIFICATION CHECKS & VERIFICATIONS PASSED!
verify_sim_controls: ALL SIM CONTROLS VERIFICATION CHECKS PASSED
simulation/tests/test_forge.py: 14 passed (2 new: test_tilt_is_an_offset_cave_in, test_vibration_window)
simulation/tests (all but the 1000-trial stress test): 91 passed
simulation/frontend: npx tsc --noEmit -p tsconfig.app.json → no errors
```

Screenshots: `img/forge-tilt-preview.png`, `img/forge-tilt-during.png`, `img/forge-vibration.png`.
