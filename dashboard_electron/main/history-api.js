'use strict';

const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const R2_BASE = process.env.R2_API_URL || 'http://localhost:8080';
const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'telemetry-90d.json');
const ALARM_FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'alarms.json');

let fixtureCache = null;

function register() {
  ipcMain.handle('history:query', handleHistoryQuery);
  ipcMain.handle('export:node-csv', handleExportCSV);
}

function handleHistoryQuery(_event, query) {
  // The renderer asks this one channel for two different histories. Alarms live
  // at /api/alarms, not /api/telemetry — asking the telemetry endpoint for them
  // returned reading rows the alarm panel could not render, so it fell through
  // to the fixture even when the backend was up.
  if (query && query.type === 'alarms') {
    return r2Fetch('/api/alarms').catch(function () {
      return alarmFixtureFallback();
    });
  }
  return r2Fetch('/api/telemetry?' + buildQueryString(query))
    .catch(function () {
      return fixtureFallback(query);
    });
}

function alarmFixtureFallback() {
  try {
    return JSON.parse(fs.readFileSync(ALARM_FIXTURE_PATH, 'utf8'));
  } catch (e) {
    return [];
  }
}

function handleExportCSV(event, nodeId) {
  var win = require('electron').BrowserWindow.fromWebContents(event.sender);
  return dialog.showSaveDialog(win, {
    title: 'Export Node CSV',
    defaultPath: nodeId + '-telemetry.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  }).then(function (result) {
    if (result.canceled || !result.filePath) return { ok: false, reason: 'canceled' };
    return getNodeTelemetry(nodeId).then(function (rows) {
      var header = 'node_id,t_epoch_s,strain_ustrain,tilt_x_mdeg,tilt_y_mdeg,temp_c_x10,vbat_mv,vib_rms,flags\n';
      var csv = header;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        csv += [
          r.node_id, r.t_epoch_s, r.strain_ustrain,
          r.tilt_x_mdeg, r.tilt_y_mdeg, r.temp_c_x10,
          r.vbat_mv, r.vib_rms, r.flags
        ].join(',') + '\n';
      }
      fs.writeFileSync(result.filePath, csv, 'utf8');
      return { ok: true, path: result.filePath, rows: rows.length };
    });
  });
}

function getNodeTelemetry(nodeId) {
  return r2Fetch('/api/telemetry?node_id=' + encodeURIComponent(nodeId))
    .catch(function () {
      return fixtureFallback({ node_id: nodeId });
    });
}

function fixtureFallback(query) {
  if (!fixtureCache) {
    try {
      var raw = fs.readFileSync(FIXTURE_PATH, 'utf8');
      fixtureCache = JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }

  var rows = fixtureCache;
  if (query && query.node_id) {
    rows = rows.filter(function (r) { return r.node_id === query.node_id; });
  }
  if (query && query.from) {
    var from = Number(query.from);
    rows = rows.filter(function (r) { return r.t_epoch_s >= from; });
  }
  if (query && query.to) {
    var to = Number(query.to);
    rows = rows.filter(function (r) { return r.t_epoch_s <= to; });
  }
  if (query && query.limit) {
    rows = rows.slice(0, Number(query.limit));
  }
  return rows;
}

function buildQueryString(obj) {
  if (!obj) return '';
  var parts = [];
  for (var key in obj) {
    if (obj.hasOwnProperty(key) && obj[key] != null) {
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(obj[key]));
    }
  }
  return parts.join('&');
}

function r2Fetch(urlPath) {
  return new Promise(function (resolve, reject) {
    var url = R2_BASE + urlPath;
    http.get(url, { timeout: 3000 }, function (res) {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('R2 returned ' + res.statusCode));
      }
      var body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject)
      .on('timeout', function () { this.destroy(); reject(new Error('R2 timeout')); });
  });
}

module.exports = { register: register };
