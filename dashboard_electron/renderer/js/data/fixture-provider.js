'use strict';

var fixtureProvider = (function () {
  var nodes = null;
  var telemetry = null;
  var alarms = null;
  var replayTimer = null;
  var replayIndex = 0;
  var replaySpeed = 1;

  var API_BASE = 'http://localhost:8080/api';

  function fetchWithTimeout(url, options, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('Request timed out: ' + url));
      }, timeoutMs || 2000);

      fetch(url, options).then(function (res) {
        clearTimeout(timer);
        if (!res.ok) reject(new Error('HTTP error ' + res.status));
        else resolve(res);
      }).catch(function (err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function loadFixtures(basePath) {
    // 1. Try loading directly from live PostgreSQL backend
    return Promise.all([
      fetchWithTimeout(API_BASE + '/nodes').then(function (r) { return r.json(); }),
      fetchWithTimeout(API_BASE + '/telemetry?limit=10000').then(function (r) { return r.json(); }),
      fetchWithTimeout(API_BASE + '/alarms').then(function (r) { return r.json(); }).catch(function () {
        return fetch(basePath + '/alarms.json').then(function (r) { return r.json(); });
      })
    ]).then(function (results) {
      console.log('[data-provider] Successfully connected to live PostgreSQL backend (' + API_BASE + ')');
      nodes = results[0];
      telemetry = results[1];
      alarms = results[2];

      bus.emit('backend-connected', { url: API_BASE, nodes: nodes.length, readings: telemetry.length });
      bus.emit('nodes-loaded', nodes);
      bus.emit('alarms-loaded', alarms);

      return { nodes: nodes, telemetry: telemetry, alarms: alarms, source: 'postgresql' };
    }).catch(function (err) {
      console.warn('[data-provider] Live backend unavailable (' + err.message + '). Falling back to static fixtures.');
      return Promise.all([
        fetch(basePath + '/nodes.json').then(function (r) { return r.json(); }),
        fetch(basePath + '/telemetry-90d.json').then(function (r) { return r.json(); }),
        fetch(basePath + '/alarms.json').then(function (r) { return r.json(); })
      ]).then(function (results) {
        nodes = results[0];
        telemetry = results[1];
        alarms = results[2];

        bus.emit('nodes-loaded', nodes);
        bus.emit('alarms-loaded', alarms);

        return { nodes: nodes, telemetry: telemetry, alarms: alarms, source: 'fixtures' };
      });
    });
  }

  function startReplay(speed) {
    if (!telemetry || telemetry.length === 0) return;
    replaySpeed = speed || 1;
    replayIndex = 0;
    stopReplay();

    // Reset alarm emitted status
    if (alarms) {
      for (var a = 0; a < alarms.length; a++) {
        alarms[a]._emitted = false;
      }
    }

    var batchSize = (nodes && nodes.length) ? nodes.length : 60;
    var intervalMs = Math.max(16, 1000 / replaySpeed);

    replayTimer = setInterval(function () {
      for (var i = 0; i < batchSize && replayIndex < telemetry.length; i++, replayIndex++) {
        bus.emit('telemetry', telemetry[replayIndex]);
      }

      checkAlarms();

      if (replayIndex >= telemetry.length) {
        stopReplay();
        bus.emit('replay-complete', null);
      }
    }, intervalMs);

    bus.emit('replay-started', { total: telemetry.length, speed: replaySpeed });
  }

  var liveSimTimer = null;
  var lastKnownNodeTelemetry = {};

  function startLiveSimulation() {
    if (liveSimTimer) clearInterval(liveSimTimer);
    if (!telemetry || telemetry.length === 0) return;

    // Cache the LATEST reading for each node (the current active mine state)
    for (var i = 0; i < telemetry.length; i++) {
      lastKnownNodeTelemetry[telemetry[i].node_id] = Object.assign({}, telemetry[i]);
    }

    // Continue streaming ambient telemetry around current state until replay is started
    liveSimTimer = setInterval(function () {
      var nodeIds = Object.keys(lastKnownNodeTelemetry);
      for (var j = 0; j < nodeIds.length; j++) {
        var base = lastKnownNodeTelemetry[nodeIds[j]];
        if (!base) continue;

        base.t_epoch_s = (base.t_epoch_s || Math.floor(Date.now() / 1000)) + 2;
        // Realistic micro-fluctuations around current state
        base.strain_ustrain = Math.max(0, Math.round(base.strain_ustrain + (Math.random() - 0.5) * 1.5));
        base.tilt_x_mdeg = Math.round((base.tilt_x_mdeg + (Math.random() - 0.5) * 0.4) * 10) / 10;
        base.tilt_y_mdeg = Math.round((base.tilt_y_mdeg + (Math.random() - 0.5) * 0.4) * 10) / 10;
        base.vib_rms = Math.max(1, Math.round(base.vib_rms + (Math.random() - 0.5) * 0.5));

        bus.emit('telemetry', Object.assign({}, base));
      }
    }, 1500);
  }

  function checkAlarms() {
    if (!alarms || !telemetry) return;
    var currentT = telemetry[Math.min(replayIndex, telemetry.length - 1)].t_epoch_s;
    for (var i = 0; i < alarms.length; i++) {
      var alarmT = Math.floor(new Date(alarms[i].t_utc).getTime() / 1000);
      if (currentT >= alarmT && !alarms[i]._emitted) {
        alarms[i]._emitted = true;
        bus.emit('alarm', alarms[i]);
      }
    }
  }

  function stopReplay() {
    if (replayTimer) {
      clearInterval(replayTimer);
      replayTimer = null;
    }
    if (liveSimTimer) {
      clearInterval(liveSimTimer);
      liveSimTimer = null;
    }
  }

  if (typeof bus !== 'undefined' && bus.on) {
    bus.on('system-reset', function () {
      stopReplay();
      replayIndex = 0;
      alarms = [];
      lastKnownNodeTelemetry = {};
    });
  }

  function getNodes() { return nodes; }
  function getTelemetry() { return telemetry; }
  function getAlarms() { return alarms; }

  return {
    loadFixtures: loadFixtures,
    startReplay: startReplay,
    stopReplay: stopReplay,
    getNodes: getNodes,
    getTelemetry: getTelemetry,
    getAlarms: getAlarms,
    startLiveSimulation: startLiveSimulation
  };
})();
