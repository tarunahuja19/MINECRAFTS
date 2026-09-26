# B0b · Remove Approved Buttons per BUTTON_AUDIT.md

## Overview
Adarsh approved the audit's REMOVE list, which consists of exactly ONE item: `btn-sim-freeze` (the hidden legacy FREEZE button in the FORGE left column).

## Changes Made
1. `dashboard_electron/renderer/index.html`:
   - Removed `<button id="btn-sim-freeze" class="sim-btn-freeze" style="display:none;">FREEZE</button>` and its surrounding comment.
2. `dashboard_electron/renderer/js/sim/sim-tab.js`:
   - Removed the click listener on `btn-sim-freeze` in `setupDomListeners`.
   - Grepped for any other callers of `freezeCurrentDay` across the codebase (0 callers found).
   - Removed the unused `freezeCurrentDay()` function implementation and its export from the `simTab` object.
3. `dashboard_electron/renderer/css/sim-tab.css`:
   - Removed `.sim-btn-freeze`, `.sim-btn-freeze:hover`, and `.sim-btn-freeze:active` CSS rule blocks.
4. `docs/BUTTON_AUDIT.md`:
   - Marked the `btn-sim-freeze` table row as `REMOVED in B0b (commit <sha>)`.
   - Updated the REMOVE candidates bullet list to reflect the removal.

## Verification & Checks

### Check a: No remaining references to btn-sim-freeze or sim-freeze
```
$ grep -rn "btn-sim-freeze\|sim-freeze" dashboard_electron/renderer dashboard_electron/test simulation/frontend/src
(exited with code 1, 0 hits)
```

### Check b: Full Dashboard Test Suite
1. `node dashboard_electron/test/verify_forge_isolation.js`:
```
=== 1. FORGE dashboard modules never address the live system ===
  PASS  sim-embed.js has no :8000 (engine) address
  PASS  sim-embed.js has no :8080 (backend) address
  PASS  sim-embed.js has no /control call
  PASS  sim-tab.js has no :8000 (engine) address
  PASS  sim-tab.js has no /control call
  PASS  sim-tab.js backend :8080 path is strictly /api/simulation/status
  PASS  sim-tab.js has no :8080 path other than /api/simulation/status
  PASS  sim-tab.js uses only GET toward :8080

=== 2. App.tsx guards every engine write on engineReadOnly ===
  PASS  engineReadOnly derives from isEngineReadOnly(embedParams)
  PASS  sendWsAction returns early for FORGE (covers start/pause/apply_*/reset/stop)
  PASS  on-connect set_speed is skipped for FORGE
  PASS  on-connect start re-arm is skipped for FORGE
  PASS  close-everything (engine stop + DB wipe) is a no-op for FORGE
  PASS  FORGE arms locally instead of auto-starting the engine

=== 3. No unguarded engine writes in App.tsx ===
  PASS  exactly 3 socket sends (set_speed, start re-arm, sendWsAction) — found 3
  PASS  exactly 1 POST /control (inside sendWsAction) — found 1

ALL CHECKS PASSED
```

2. `node dashboard_electron/test/verify_forge_close.js`:
```
=== FORGE SELECTION LIFECYCLE ===
  PASS  forge iframe URL carries slot=forge; sim carries slot=sim
  PASS  fresh state: FORGE ungated, RUN enabled on full terrain, SIM buttons removed
  PASS  0-node selection: falls back to full terrain domain
  PASS  N-node selection: scope displayed in readout
  PASS  session opens the dashboard, CLOSE releases everything to full domain
  PASS  App.tsx: packet SYNCHRONIZED toast removed per B0

ALL 6 CHECKS PASSED
```

3. `env -u ELECTRON_RUN_AS_NODE node dashboard_electron/test/verify_sandbox.js`:
Expected known failure at STEP 5 CAVE-IN:
```
[STEP 5] Running CAVE-IN...
❌ [TEST FAILURE] Error: CAVE-IN did not post a trigger to the FORGE slot!
    at runTest (/Users/adarshagarwala/Documents/sih26/dashboard_electron/test/verify_sandbox.js:422:13)
```

4. `env -u ELECTRON_RUN_AS_NODE node dashboard_electron/test/acceptance_s3.js`:
Expected known failure at CHECK 1 gate banner:
```
--- CHECK 1: GATE STATE (Empty selection & no session) ---
[CHECK 1 RESULT] {
  bannerVisible: false,
  bannerText: '⚠️\n                Select nodes on the MAP tab first (SIM box tool)',
  bannerInForge: true
}

❌ S3 ACCEPTANCE FAILED: Error: FAIL: #sim-gate-banner is not visible when gated!
    at runAcceptance (/Users/adarshagarwala/Documents/sih26/dashboard_electron/test/acceptance_s3.js:150:13)
```

### Check c: Headless Console Error Check
Opened every tab sequentially (`map`, `sim`, `forge`, `nodes`, `alarms`, `history`, `system`, `info`) in headless Electron:
```
[TEST] Dashboard loaded.
[TEST] Clicking tab: map
[TEST] Clicking tab: sim
[TEST] Clicking tab: forge
[TEST] Clicking tab: nodes
[TEST] Clicking tab: alarms
[TEST] Clicking tab: history
[TEST] Clicking tab: system
[TEST] Clicking tab: info
[TEST] All tabs opened.
[TEST] Total error count: 0
✓ PASS: Zero console errors across all tabs.
```
