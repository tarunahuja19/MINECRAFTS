'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE_DIR = path.join(os.homedir(), '.r4-cache');
const STATE_FILE = path.join(CACHE_DIR, 'last-state.json');

class OfflineCache {
  constructor() {
    this.state = {};
    this._ensureDir();
  }

  _ensureDir() {
    try {
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }
    } catch (e) {
      console.error('[offline-cache] cannot create cache dir:', e.message);
    }
  }

  updateNode(nodeId, telemetry) {
    this.state[nodeId] = {
      node_id: nodeId,
      t_epoch_s: telemetry.t_epoch_s,
      tilt_x_mdeg: telemetry.tilt_x_mdeg,
      tilt_y_mdeg: telemetry.tilt_y_mdeg,
      strain_ustrain: telemetry.strain_ustrain,
      temp_c_x10: telemetry.temp_c_x10,
      vbat_mv: telemetry.vbat_mv,
      vib_rms_summary: telemetry.vib_rms_summary,
      flags: telemetry.flags,
      _updated: Date.now()
    };
  }

  flush() {
    try {
      const snapshot = {
        _saved: new Date().toISOString(),
        nodes: this.state
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
    } catch (e) {
      console.error('[offline-cache] write error:', e.message);
    }
  }

  load() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const snapshot = JSON.parse(raw);
        this.state = snapshot.nodes || {};
        return snapshot;
      }
    } catch (e) {
      console.error('[offline-cache] read error:', e.message);
    }
    return null;
  }

  getState() {
    return this.state;
  }

  clear() {
    this.state = {};
    try {
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    } catch (e) {
      // ignore
    }
  }
}

module.exports = OfflineCache;
