'use strict';

const mqtt = require('mqtt');

const TOPICS = [
  'mine/+/node/+/telemetry',
  'mine/+/node/+/status',
  'mine/+/alarm',
  'mine/+/gateway/health',
  'mine/+/simulation/status'
];

class MqttClient {
  constructor(mainWindow, opts) {
    this.mainWindow = mainWindow;
    this.brokerUrl = opts.brokerUrl || 'mqtt://localhost:1883';
    this.client = null;
    this.connected = false;
    this.onTelemetry = opts.onTelemetry || null;
  }

  connect() {
    this.client = mqtt.connect(this.brokerUrl, {
      clientId: 'r4-dashboard-' + Date.now(),
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10000
    });

    this.client.on('connect', () => {
      this.connected = true;
      this._sendStatus('connected');
      this.client.subscribe(TOPICS, { qos: 0 }, (err) => {
        if (err) console.error('[mqtt-client] subscribe error:', err.message);
      });
    });

    this.client.on('reconnect', () => {
      this._sendStatus('reconnecting');
    });

    this.client.on('close', () => {
      if (this.connected) {
        this.connected = false;
        this._sendStatus('disconnected');
      }
    });

    this.client.on('error', (err) => {
      console.error('[mqtt-client] error:', err.message);
    });

    this.client.on('message', (topic, payload) => {
      this._handleMessage(topic, payload);
    });
  }

  _sendStatus(status) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('mqtt:connection', status);
    }
  }

  _handleMessage(topic, payload) {
    if (this.mainWindow && this.mainWindow.isDestroyed()) return;

    let data;
    try {
      data = JSON.parse(payload.toString());
    } catch (e) {
      console.warn('[mqtt-client] bad JSON on', topic);
      return;
    }

    const parts = topic.split('/');
    // mine/<panel_id>/node/<node_id>/telemetry
    // mine/<panel_id>/node/<node_id>/status
    // mine/<panel_id>/alarm
    // mine/<panel_id>/gateway/health

    const wc = this.mainWindow.webContents;

    if (parts.length === 5 && parts[4] === 'telemetry') {
      data._panel_id = parts[1];
      data._node_id = parts[3];
      wc.send('mqtt:telemetry', data);
      if (this.onTelemetry) this.onTelemetry(data);
    } else if (parts.length === 5 && parts[4] === 'status') {
      data._panel_id = parts[1];
      data._node_id = parts[3];
      wc.send('mqtt:status', data);
    } else if (parts.length === 3 && parts[2] === 'alarm') {
      data._panel_id = parts[1];
      wc.send('mqtt:alarm', data);
    } else if (parts.length === 4 && parts[2] === 'gateway' && parts[3] === 'health') {
      data._panel_id = parts[1];
      wc.send('mqtt:gateway-health', data);
    } else if (parts.length === 4 && parts[2] === 'simulation' && parts[3] === 'status') {
      data._panel_id = parts[1];
      wc.send('mqtt:simulation-status', data);
    }
  }

  disconnect() {
    if (this.client) {
      this.client.end(true);
      this.client = null;
      this.connected = false;
    }
  }

  isConnected() {
    return this.connected;
  }
}

module.exports = MqttClient;
