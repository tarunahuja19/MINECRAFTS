# R4 Dashboard — Browser-Tab Fallback

When Electron is unavailable, the dashboard can run in any modern browser.

## Fixture / Demo Mode (no server needed)

1. Serve the `renderer/` directory with any static file server:
   ```
   cd r4-dashboard/renderer
   python -m http.server 8080
   ```
2. Open `http://localhost:8080` in Chrome or Edge.
3. The app starts in **fixture mode** automatically — all 14 nodes, telemetry replay, and alarm scenarios work offline.
4. PDF export falls back to an HTML download (open & print-to-PDF from the browser).

## Live MQTT Mode

To receive real telemetry from Mosquitto:

1. Configure Mosquitto with a WebSocket listener (the Electron build uses raw TCP, but browsers need WebSocket):
   ```
   # Add to mosquitto.conf
   listener 8883
   protocol websockets
   ```
2. Restart Mosquitto: `mosquitto -c mosquitto.conf`
3. Update `js/data/live-provider.js` to connect via `ws://localhost:8883` instead of `mqtt://localhost:1883`.
4. The `window.r4.*` IPC bridge is unavailable in browser mode — features that depend on it (CSV export, printToPDF, main-process menu) degrade gracefully.

## Limitations vs. Electron

| Feature               | Electron | Browser Fallback |
|-----------------------|----------|------------------|
| MQTT (raw TCP)        | Yes      | No (WebSocket only) |
| PDF export            | Native printToPDF | HTML download |
| CSV export            | Native file dialog | Not available |
| Offline tile cache    | Bundled in asar | Must be served |
| System tray / menu    | Yes      | No |
| SQLite history API    | Yes      | Not available |
