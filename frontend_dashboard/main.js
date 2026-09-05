const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');

// KNOWN ISSUE - 3D terrain renders flat (handed off, not fixed here).
//
// The 3D window shows correct satellite imagery but no elevation relief.
// What was verified working, so nobody re-checks it:
//   - DEM tiles decode to real elevations (81-193 m over the tile).
//   - The tile proxy serves them byte-identical to upstream as image/png.
//   - The DEM source loads: sourceCache present, tiles reach state with .dem set.
//   - maplibre-gl.js is the unmodified upstream 4.7.1 build, terrain code intact.
//   - The GPU is genuinely fine: app.getGPUInfo() reports
//     "ANGLE Metal Renderer: Apple M4", gpu_compositing and webgl both enabled.
//
// The actual symptom: map.setTerrain() returns without throwing and
// map.getTerrain() echoes the config back, but map.style.terrain and
// map.painter.terrain both stay ABSENT - MapLibre never builds the mesh, with
// no error emitted. queryTerrainElevation() then returns constant nonsense
// (e.g. -471.6 m everywhere), which is the signature of terrain not attached.
//
// Note: in the renderer, gl.getParameter(gl.RENDERER) reads "WebKit" and
// getExtension('OES_element_index_uint') reads MISSING. That is Chromium's
// privacy masking of WebGL, NOT software rendering - do not chase it.
//
// The switches below force the hardware path. They did NOT fix the issue and
// are kept only because they are harmless; the real cause is still open.
// Diagnostics helper: realTerrain3D.getMap() exposes the live MapLibre map.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('disable-software-rasterizer');
const fs = require('fs');
const MqttClient = require('./main/mqtt-client');
const OfflineCache = require('./main/offline-cache');
const historyApi = require('./main/history-api');

let mainWindow = null;
let mqttClient = null;
let offlineCache = null;
let cacheFlushTimer = null;
let tileServer = null;

// Map tiles are served by the local proxy in serve.js, which caches them to
// disk so imagery is downloaded once rather than on every launch, and keeps the
// map and 3D terrain window working with no network once warm.
//
// scripts/start_all.sh already starts that server, but Electron must not depend
// on being launched that way: if nothing is listening on 8085 we start the
// server in-process, so `electron .` on its own still renders terrain.
function ensureTileServer() {
  const net = require('net');
  return new Promise((resolve) => {
    const probe = net
      .connect(8085, '127.0.0.1')
      .on('connect', () => {
        probe.end();
        console.log('[main] Tile server already running on 8085');
        resolve();
      })
      .on('error', () => {
        try {
          tileServer = require('./serve.js');
          console.log('[main] Started tile server on 8085');
        } catch (e) {
          // Non-fatal: the map falls back to whatever is already cached, and
          // the renderer surfaces tile failures rather than dying.
          console.warn('[main] Could not start tile server:', e.message);
        }
        resolve();
      });
  });
}

const BROKER_URL = process.env.R4_BROKER_URL || 'mqtt://localhost:1883';
const CACHE_FLUSH_INTERVAL_MS = 10000;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1440,
    minHeight: 900,
    backgroundColor: '#1E2830',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    const snapshot = offlineCache.load();
    if (snapshot && snapshot.nodes) {
      const nodes = snapshot.nodes;
      Object.keys(nodes).forEach((nodeId) => {
        mainWindow.webContents.send('mqtt:telemetry', nodes[nodeId]);
      });
      console.log('[main] Restored', Object.keys(nodes).length, 'cached nodes from', snapshot._saved || 'unknown');
    }
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log('[RENDERER]', level, message, sourceId, line);
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Export Report', accelerator: 'CmdOrCtrl+E', click: () => mainWindow.webContents.send('menu:export-report') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About R4 Dashboard',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About R4 Dashboard',
              message: 'R4 Mine Subsidence Early-Warning Dashboard',
              detail: 'Version 0.1.0\nSIH Smart India Hackathon\n\nMine subsidence monitoring and alarm system.'
            });
          }
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);

  offlineCache = new OfflineCache();

  mqttClient = new MqttClient(mainWindow, {
    brokerUrl: BROKER_URL,
    onTelemetry: function (data) {
      var nodeId = data._node_id || data.node_id;
      if (nodeId) offlineCache.updateNode(nodeId, data);
    }
  });

  mqttClient.connect();

  cacheFlushTimer = setInterval(function () {
    if (offlineCache) offlineCache.flush();
  }, CACHE_FLUSH_INTERVAL_MS);

  mainWindow.on('closed', () => {
    if (mqttClient) mqttClient.disconnect();
    if (cacheFlushTimer) clearInterval(cacheFlushTimer);
    if (offlineCache) offlineCache.flush();
    mainWindow = null;
  });

  if (process.env.SCREENSHOT_PATH) {
    setTimeout(async () => {
      try {
        if (process.env.SCREENSHOT_ACTION) {
          await mainWindow.webContents.executeJavaScript(process.env.SCREENSHOT_ACTION);
          await new Promise(r => setTimeout(r, 600));
        }
        const img = await mainWindow.webContents.capturePage();
        const fs = require('fs');
        fs.writeFileSync(process.env.SCREENSHOT_PATH, img.toPNG());
        console.log('SCREENSHOT_SAVED');
      } catch (e) {
        console.error(e);
      }
      app.quit();
    }, parseInt(process.env.SCREENSHOT_DELAY || '3500'));
  }
}

historyApi.register();

ipcMain.handle('export:report', async (_event, html) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Report as PDF',
    defaultPath: 'R4-Subsidence-Report.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { success: false, reason: 'cancelled' };

  const reportWin = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  await reportWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const pdfData = await reportWin.webContents.printToPDF({
    marginsType: 0,
    printBackground: true,
    pageSize: 'A4',
    landscape: true
  });
  fs.writeFileSync(filePath, pdfData);
  reportWin.close();
  return { success: true, path: filePath };
});

ipcMain.handle('window:open-3d', async (_event, sectorData) => {
  const sectorId = (sectorData && sectorData.id) ? sectorData.id : 'E5';
  const win3d = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    title: `3D Terrain Workstation — Sector ${sectorId}`,
    backgroundColor: '#070D12',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win3d.loadFile(path.join(__dirname, 'renderer', '3d-window.html'), { query: { sector: sectorId } });
  return { success: true };
});

app.whenReady().then(ensureTileServer).then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
