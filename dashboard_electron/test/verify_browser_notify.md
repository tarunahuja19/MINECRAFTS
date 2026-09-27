# Manual Verification Checklist: Browser & OS Alarm Notifications (ALERT-2)

This verification procedure tests browser/OS native desktop notifications triggered for Tier-2+ alarms (`level >= 2`), ensuring deduplication works and interaction links to the alarm detail panel.

## Pre-conditions

1. Backend running: `cd backend && npm start`
2. Launch operator dashboard in either Electron or desktop browser:
   - **Electron**: `npm start` from root or `dashboard_electron/`
   - **Desktop Browser**: Open `dashboard_electron/renderer/index.html` (or `http://127.0.0.1:8085/`)

---

## Verification Steps

### 1. Permission Prompt
- [ ] On initial page load, verify `Notification.requestPermission()` prompts the user (or confirm permission state is `'granted'`).
- [ ] Click **Allow** / grant notifications in the system prompt.

### 2. Tier-2+ Notification Trigger
- [ ] Trigger an alarm with level ≥ 2 via curl:
  ```bash
  curl -X POST http://localhost:8080/api/alarms \
    -H "Content-Type: application/json" \
    -d '{"alarm_id":"test-browser-1","level":3,"zone_id":"Z1","explanation":"Critical subsidence strain detected"}'
  ```
  *(Alternatively, trigger a test alarm using the blast injection button in Alert Config).*
- [ ] Confirm a native desktop OS notification appears with:
  - **Title**: `Alarm — Zone Z1`
  - **Body**: `Critical subsidence strain detected` (or `Level 3`)
- [ ] Confirm the existing in-app alarm banner still appears simultaneously without regression.

### 3. Notification Deduplication
- [ ] Re-send the exact same alarm payload (same `alarm_id` and same `level`):
  ```bash
  curl -X POST http://localhost:8080/api/alarms \
    -H "Content-Type: application/json" \
    -d '{"alarm_id":"test-browser-1","level":3,"zone_id":"Z1","explanation":"Critical subsidence strain detected"}'
  ```
- [ ] Confirm **no second notification stacks** (dedup prevents duplicate notifications, and `tag: alarm.alarm_id` replaces rather than stacks).

### 4. Click Navigation to Alarm Detail Panel
- [ ] Click on the native desktop notification banner.
- [ ] Confirm the dashboard window gains focus (`window.focus()`).
- [ ] Confirm the alarm detail panel opens displaying the alarm details for `test-browser-1` (via `bus.emit('alarm-selected', alarm)`).

### 5. Lower Severity Alarms (Level < 2)
- [ ] Post a Tier-1 alarm (`level: 1`):
  ```bash
  curl -X POST http://localhost:8080/api/alarms \
    -H "Content-Type: application/json" \
    -d '{"alarm_id":"test-browser-tier1","level":1,"zone_id":"Z2","explanation":"Minor sensor variance"}'
  ```
- [ ] Confirm **no desktop notification is displayed** (below Tier-2 threshold).
