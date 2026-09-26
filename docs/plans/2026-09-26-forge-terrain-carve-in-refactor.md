# FORGE Terrain & Carve-In Refactor Plan

> **Goal:** Remove legacy 690-day sliders, remove the map HUD SIM button, keep the full terrain permanently accessible in FORGE without gating, fix the dark "lights-out" terrain lighting, convert event inputs (tilt, cave-in, etc.) to min/max sliders, and ensure 3D terrain carve-in works reliably.

---

## 1. Problem Diagnosis & Architecture

1. **690-Day Sliders:**
   - The simulation generates subsidence and strain dynamically using continuum geomechanics math (`geomechanicsEngine.ts`, Knothe time law, and `:8010` scenario models) rather than relying on a hardcoded 690-day timeline.
   - The 690-day sliders (`#sim-day-slider`, `#sim-timeline-slider`) in FORGE and SIM tabs add visual clutter and create confusion. They must be removed.

2. **SIM Button on Map & FORGE Terrain Isolation:**
   - Currently, a "SIM" marquee tool button (`#btn-sim-select`) exists on the 2D Map HUD. Users had to draw a bounding box on the map to unlock FORGE.
   - Without that selection, FORGE displayed a large yellow gate banner ("Select nodes on the MAP tab first") and disabled all scenario injection buttons.
   - When a selection was made, FORGE clipped the 3D mesh down to a small bounding box instead of showing the entire mine terrain.
   - **Fix:** Remove the SIM button from the map HUD, eliminate the gate banner, and keep the full 600m district terrain active in FORGE so users can directly experiment on the whole terrain.

3. **Black / Dark Terrain ("Lights Out"):**
   - The 3D scene in `MineViewport.tsx` relied on a single directional light with `castShadow` and low ambient light (0.7).
   - In `TerrainMesh.tsx`, hillshade was being multiplied into vertex color on line 401 and multiplied again on line 555 (`tempColor.multiplyScalar(relief)`), compounding shadow darkness on slopes facing away from the single light source.
   - Slopes facing away from the light plummeted below 0.1 brightness, appearing pitch black as if "lights are out".
   - **Fix:** Add a vibrant hemisphere light (`args={["#ffffff", "#556677", 1.4]}`) plus multiple directional fill lights, soften shadows, and eliminate compounding hillshade multipliers so all terrain aspects are clearly illuminated.

4. **Carve-In Functionality:**
   - Currently, in `App.tsx`, `handleTriggerEvent` refuses triggers if `!isRunning` (`"SIMULATION STOPPED — press START to arm interventions"`). In embed mode, the iframe has no start button, causing scenario triggers from FORGE to fail silently if the live websocket isn't streaming.
   - In `sim-tab.js`, `fireForgeTrigger` was gated behind `data.possible` and had fallback depth values that were too shallow.
   - **Fix:** Make embed/FORGE triggers execute `globalGeomechanics.triggerCollapse` unconditionally, allow clicking anywhere on the 3D terrain in FORGE to pick target coordinates, and ensure cave-in/carve-in deforms the mesh into a visible, contoured depression with depth hypsometry.

5. **Sliders for Tilt, Carve-In & Event Parameters:**
   - Event parameters currently use raw `<input type="number">` fields.
   - **Fix:** Convert all parameters (Tilt rate, tilt direction, tilt radius, cave-in depth, cave-in radius, crack radius, etc.) to interactive range sliders with min/max bounds and live numeric badges.

---

## 2. Multi-Step Implementation Plan

### Step 1: Remove 690-Day Sliders & Legacy Timeline Controls
- **Files to modify:**
  - `dashboard_electron/renderer/index.html` (lines 746–760, lines 635–655)
  - `dashboard_electron/renderer/js/sim/sim-tab.js`
- **Actions:**
  - Remove `#sim-day-slider` and the "TEMPORAL DRIFT CONTROL" 690-day block in FORGE tab.
  - Remove `#sim-timeline-slider` and references to 690 days.
  - Retain simple live day telemetry badges where needed.
- **Verification:**
  - Verify DOM elements are removed cleanly without JavaScript console errors.

### Step 2: Remove SIM Button from Map HUD & Open Full Terrain in FORGE
- **Files to modify:**
  - `dashboard_electron/renderer/index.html` (lines 339–346)
  - `dashboard_electron/renderer/js/sim/sim-tab.js` (lines 451–503, 1684–1700)
  - `dashboard_electron/renderer/js/sim/sim-embed.js` (lines 150–178)
- **Actions:**
  - Remove `#btn-sim-select` and `#btn-send-to-sim` from the Map HUD.
  - Remove the gate banner `#sim-gate-banner` in FORGE.
  - Enable CRACK, TILT, VIBRATION, and CAVE-IN buttons by default without requiring prior map selection.
  - Set default experiment bounds to the entire mine domain when no specific region is selected.
  - Configure `simEmbed` FORGE slot to display the full 600m terrain mesh by default.
- **Verification:**
  - Run headless Electron screenshot test to confirm FORGE tab opens with full terrain and active controls without gating.

### Step 3: Fix Terrain Lighting ("Lights Out" Fix)
- **Files to modify:**
  - `simulation/frontend/src/components/MineViewport.tsx` (lines 300–315)
  - `simulation/frontend/src/components/TerrainMesh.tsx` (lines 400–405, 550–558)
- **Actions:**
  - In `MineViewport.tsx`, add `<hemisphereLight args={["#ffffff", "#556677", 1.4]} />`.
  - Add complementary fill directional light from `[-300, 300, -200]` with intensity `0.8`.
  - In `TerrainMesh.tsx`, calibrate hillshade floor to minimum `0.65` so relief is visible without crushing back-slopes to pitch black.
- **Verification:**
  - Capture screenshot of 3D viewport from multiple camera angles to verify terrain is bright and clear across all slopes.

### Step 4: Fix 3D Terrain Carve-In & Click-to-Target
- **Files to modify:**
  - `simulation/frontend/src/App.tsx` (lines 565–649, 705–728, 800–815)
  - `dashboard_electron/renderer/js/sim/sim-tab.js` (lines 2090–2130)
- **Actions:**
  - In `App.tsx`, bypass `!isRunning` check for embed triggers and local sandbox interventions.
  - Ensure `triggerCollapse` is called with user-specified carve depth (magnitude in meters) and radius.
  - Forward terrain clicks in FORGE embed to update target location and position beacon.
  - Ensure `fireForgeTrigger` in `sim-tab.js` passes configured carve-in parameters directly into `simEmbed.triggerScenario`.
- **Verification:**
  - Trigger a CAVE-IN in FORGE and verify that the 3D terrain visibly drops, shows contour rings, and recolors with depth hypsometry.

### Step 5: Convert Event Parameters to Sliders with Min/Max Ranges
- **Files to modify:**
  - `dashboard_electron/renderer/index.html` (lines 783–832)
  - `dashboard_electron/renderer/js/sim/sim-tab.js` (lines 250–270, 1710–1745)
  - `dashboard_electron/renderer/css/sim-tab.css`
- **Actions:**
  - Replace `<input type="number">` with styled range sliders and live value displays:
    - **TILT**: Rate (`0.5`–`30.0` mm/m), Direction (`0°`–`360°`), Radius (`10`–`500` m).
    - **CAVE-IN (Carve-In)**: Carve Depth (`0.5`–`25.0` m), Radius (`10`–`300` m).
    - **CRACK**: Days Ahead (`1`–`90` d), Radius (`10`–`500` m).
    - **VIBRATION**: PPV (`1`–`100` mm/s).
  - Add dynamic input event listeners that update badge numbers as the user slides.
- **Verification:**
  - Test slider interaction, value binding, and parameter passing to the simulation engine.
