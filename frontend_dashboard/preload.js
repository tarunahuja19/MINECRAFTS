const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('r4', {
  onTelemetry: (cb) => ipcRenderer.on('mqtt:telemetry', (_e, data) => cb(data)),
  onAlarm: (cb) => ipcRenderer.on('mqtt:alarm', (_e, data) => cb(data)),
  onStatus: (cb) => ipcRenderer.on('mqtt:status', (_e, data) => cb(data)),
  onMqttStatus: (cb) => ipcRenderer.on('mqtt:connection', (_e, status) => cb(status)),
  onGatewayHealth: (cb) => ipcRenderer.on('mqtt:gateway-health', (_e, data) => cb(data)),
  getHistory: (query) => ipcRenderer.invoke('history:query', query),
  sendCommand: (cmd) => ipcRenderer.invoke('command:send', cmd),
  exportNodeCSV: (nodeId) => ipcRenderer.invoke('export:node-csv', nodeId),
  exportReport: (html) => ipcRenderer.invoke('export:report', html),
  open3DWindow: (sectorData) => ipcRenderer.invoke('window:open-3d', sectorData),
  onMenuExportReport: (cb) => ipcRenderer.on('menu:export-report', () => cb())
});
