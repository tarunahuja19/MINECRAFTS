'use strict';

/**
 * sim-live.js — Live Simulation Status Controller
 * Polls GET /simulation/status on :8080 every 5 seconds,
 * listens to WebSocket simulation_status and packet_available events,
 * and drives existing #sim-status-hud, #sim-status, and #sim-led.
 * If backend is down, falls back to fixture mode and updates the fixture banner.
 */
var simLive = (function () {
  var pollIntervalMs = 5000;
  var pollTimer = null;
  var currentSimState = 'STOPPED';

  var ws = null;
  var reconnectTimer = null;

  function getHost() {
    return window.location.hostname || 'localhost';
  }

  function getApiBase() {
    if (typeof window !== 'undefined' && window.__TEST_BACKEND_URL__) {
      return window.__TEST_BACKEND_URL__;
    }
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      var match = window.location.search.match(/[?&]backend_port=(\d+)/);
      if (match) return 'http://' + getHost() + ':' + match[1];
    }
    return 'http://' + getHost() + ':8080';
  }

  function connectWs() {
    if (typeof WebSocket === 'undefined') return;
    if (ws && (ws.readyState === 1 || ws.readyState === 0)) {
      return;
    }
    var port = '8080';
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      var match = window.location.search.match(/[?&]backend_port=(\d+)/);
      if (match) port = match[1];
    }
    var wsUrl = 'ws://' + getHost() + ':' + port + '/ws';
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      console.log('[sim-live] Connected to backend /ws');
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = function (event) {
      try {
        var msg = JSON.parse(event.data);
        if (!msg) return;
        if (msg.type === 'simulation_status' || msg.event === 'simulation_status') {
          applyStatus(msg.data || msg);
        } else if (msg.type === 'packet_available') {
          if (!window.__SIM_PLAYING__) return;
          updateLedBlink();
          if (currentSimState !== 'RUNNING') {
            applyStatus({ is_running: true, is_paused: false, state: 'RUNNING' });
          }
        }
      } catch (e) {
        // non-json frame
      }
    };

    ws.onclose = function () {
      scheduleReconnect();
    };

    ws.onerror = function () {
      if (ws) {
        try { ws.close(); } catch (_) {}
      }
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      reconnect();
    }, 3000);
  }

  function reconnect() {
    connectWs();
  }

  function init() {
    // 1. Initial display state: STOPPED
    updateHud('STOPPED');
    updateStatusBar('STOPPED');

    // 2. Connect WebSocket
    connectWs();

    // 3. Start recurring 5s timer
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollStatus, pollIntervalMs);

    // 4. Listen to bus events emitted by liveProvider (WebSocket & system)
    if (typeof bus !== 'undefined' && bus.on) {
      bus.on('simulation-play', function () {
        applyStatus({ is_running: true, is_paused: false, state: 'RUNNING' });
      });

      bus.on('simulation-stop', function () {
        applyStatus({ is_running: false, is_paused: true, state: 'PAUSED' });
      });

      bus.on('simulation-status', function (data) {
        if (!data) return;
        applyStatus(data);
      });

      bus.on('packet_available', function (msg) {
        // A new packet is available from the running simulation
        if (!window.__SIM_PLAYING__) return;
        updateLedBlink();
        if (currentSimState !== 'RUNNING') {
          applyStatus({ is_running: true, is_paused: false, state: 'RUNNING' });
        }
      });

      bus.on('system-reset', function () {
        applyStatus({ is_running: false, is_paused: false, state: 'STOPPED' });
      });
    }

    // 5. Hook into tab bar clicks to update chip visibility
    var tabBar = document.getElementById('tab-bar');
    if (tabBar) {
      tabBar.addEventListener('click', function () {
        setTimeout(updateChipVisibility, 30);
      });
    }
  }

  function updateChipVisibility() {
    var chip = document.getElementById('sim-paused-chip');
    if (!chip) return;
    var ungreyed = ['forge', 'history', 'system', 'info'];
    var onUngreyed = ungreyed.some(function (id) {
      var el = document.getElementById('tab-' + id);
      return el && el.style.display !== 'none';
    });
    if (onUngreyed || !document.body || !document.body.classList.contains('sim-paused')) {
      chip.style.display = 'none';
    } else {
      chip.style.display = 'block';
    }
  }

  function pollStatus() {
    var url = getApiBase() + '/simulation/status';
    fetch(url)
      .then(function (res) {
        if (!res.ok) {
          throw new Error('HTTP ' + res.status);
        }
        return res.json();
      })
      .then(function (data) {
        applyStatus(data);
      })
      .catch(function (err) {
        // Backend down or unreachable -> reflect STOPPED / OFFLINE and ensure fixture mode
        handleBackendDown();
      });
  }

  function applyStatus(data) {
    if (!data) return;
    var isRunning = Boolean(data.is_running);
    var isPaused = Boolean(data.is_paused);
    var rawState = (data.state || (isRunning ? (isPaused ? 'PAUSED' : 'RUNNING') : 'STOPPED')).toUpperCase();
    var state = rawState;
    currentSimState = state;
    window.__SIM_PLAYING__ = (state === 'RUNNING');

    // Update body.sim-paused class
    var isPausedOrStopped = (state === 'PAUSED' || state === 'STOPPED');
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('sim-paused', isPausedOrStopped);
    }

    // Update paused chip
    var chip = typeof document !== 'undefined' ? document.getElementById('sim-paused-chip') : null;
    if (chip) {
      if (state === 'PAUSED') {
        var tSec = data.t_sim_seconds || 0;
        var day = (tSec / 86400).toFixed(1);
        chip.textContent = 'PAUSED · Day ' + day;
      } else if (state === 'STOPPED') {
        chip.textContent = 'STOPPED · press PLAY';
      }
    }
    updateChipVisibility();

    updateHud(state);
    updateStatusBar(state);
  }

  function updateHud(state) {
    var hud = document.getElementById('sim-status-hud');
    var textEl = document.getElementById('sim-hud-text');
    if (!hud || !textEl) return;

    hud.classList.remove('status-running', 'status-paused', 'status-stopped');

    if (state === 'RUNNING') {
      hud.classList.add('status-running');
      textEl.textContent = 'SIMULATION: RUNNING';
    } else if (state === 'PAUSED') {
      hud.classList.add('status-paused');
      textEl.textContent = 'SIMULATION: PAUSED';
    } else {
      hud.classList.add('status-stopped');
      textEl.textContent = 'SIMULATION: STOPPED';
    }
  }

  function updateStatusBar(state) {
    var led = document.getElementById('sim-led');
    var val = document.getElementById('sim-status');
    if (!val) return;

    val.classList.remove('active', 'warning', 'disconnected', 'connected');

    if (led) {
      led.classList.remove('led-active', 'led-warning', 'led-critical', 'led-dead');
    }

    if (state === 'RUNNING') {
      val.textContent = 'RUNNING';
      val.classList.add('connected');
      if (led) led.classList.add('led-active');
    } else if (state === 'PAUSED') {
      val.textContent = 'PAUSED';
      val.classList.add('warning');
      if (led) led.classList.add('led-warning');
    } else {
      val.textContent = 'STOPPED';
      val.classList.add('disconnected');
      if (led) led.classList.add('led-dead');
    }
  }

  function updateLedBlink() {
    var led = document.getElementById('sim-led');
    if (led) {
      led.style.filter = 'brightness(2.2)';
      setTimeout(function () {
        led.style.filter = '';
      }, 300);
    }
  }

  function handleBackendDown() {
    currentSimState = 'STOPPED';
    window.__SIM_PLAYING__ = false;
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('sim-paused', true);
    }
    var chip = typeof document !== 'undefined' ? document.getElementById('sim-paused-chip') : null;
    if (chip) {
      chip.textContent = 'STOPPED · press PLAY';
    }
    updateHud('STOPPED');
    updateStatusBar('STOPPED');

    // If backend is down, switch to fixture mode and display fixture banner
    if (typeof modeSwitch !== 'undefined' && modeSwitch.getMode && modeSwitch.getMode() !== 'fixture') {
      console.warn('[sim-live] Backend unreachable on :8080. Fallback to fixture mode.');
      modeSwitch.setMode('fixture');
    }
  }

  return {
    init: init,
    pollStatus: pollStatus,
    getState: function () { return currentSimState; }
  };
})();
