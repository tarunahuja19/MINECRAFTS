'use strict';

/**
 * sim-controls.js — SIM Tab PLAY/PAUSE and RESET Controller
 *
 * Drives #sim-play-btn and #sim-reset-btn in the SIM tab toolbar.
 * Communicates with the engine exclusively via POST :8080/api/simulation/control.
 * Button labels and states track actual engine status (via /api/simulation/status
 * and WebSocket simulation_status events).
 *
 * sim-tab.js (FORGE) never touches /control; only sim-controls.js controls the engine.
 */
var simControls = (function () {
  var inFlight = false;
  var currentEngineState = 'STOPPED';

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
    if (typeof window !== 'undefined' && window.API_BASE) {
      return window.API_BASE;
    }
    return typeof API_BASE !== 'undefined'
      ? API_BASE
      : 'http://' + getHost() + ':8080';
  }

  function updateButtons() {
    var playBtn = document.getElementById('sim-play-btn');
    var resetBtn = document.getElementById('sim-reset-btn');
    if (!playBtn || !resetBtn) return;

    playBtn.disabled = inFlight;
    resetBtn.disabled = inFlight;

    if (currentEngineState === 'RUNNING') {
      playBtn.textContent = '❚❚ PAUSE';
      playBtn.title = 'Pause simulation';
    } else {
      playBtn.textContent = '▶ PLAY';
      playBtn.title = (currentEngineState === 'PAUSED' ? 'Resume simulation' : 'Start simulation');
    }
  }

  function sendControl(action) {
    if (inFlight) return Promise.resolve(null);
    inFlight = true;
    updateButtons();

    var url = getApiBase() + '/api/simulation/control';
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json().catch(function () { return {}; });
      })
      .then(function (data) {
        if (data && data.state) {
          currentEngineState = data.state;
        }
        return data;
      })
      .catch(function (err) {
        console.warn('[sim-controls] Error sending action "' + action + '":', err.message);
      })
      .finally(function () {
        inFlight = false;
        updateButtons();
        // Immediately trigger status refresh
        if (typeof simLive !== 'undefined' && simLive.pollStatus) {
          simLive.pollStatus();
        }
      });
  }

  function handlePlayClick() {
    if (inFlight) return;
    if (currentEngineState === 'RUNNING') {
      sendControl('pause');
    } else if (currentEngineState === 'PAUSED') {
      sendControl('resume');
    } else {
      sendControl('start');
    }
  }

  function handleResetClick() {
    if (inFlight) return;
    var confirmed = true;
    if (typeof window.confirm === 'function') {
      confirmed = window.confirm('Reset the simulation to day 0 and delete all recorded data?');
    }
    if (!confirmed) return;

    sendControl('reset').then(function () {
      if (typeof bus !== 'undefined' && bus.emit) {
        bus.emit('system-reset', { action: 'reset' });
        bus.emit('alarms-loaded', []);
      }
    });
  }

  function onStatusChange(data) {
    if (!data) return;
    var isRunning = Boolean(data.is_running);
    var isPaused = Boolean(data.is_paused);
    currentEngineState = data.state || (isRunning ? (isPaused ? 'PAUSED' : 'RUNNING') : 'STOPPED');
    updateButtons();
  }

  function init() {
    var playBtn = document.getElementById('sim-play-btn');
    var resetBtn = document.getElementById('sim-reset-btn');

    if (playBtn) {
      playBtn.addEventListener('click', handlePlayClick);
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', handleResetClick);
    }

    if (typeof bus !== 'undefined' && bus.on) {
      bus.on('simulation-status', onStatusChange);
    }
    updateButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    init: init,
    sendControl: sendControl,
    onStatusChange: onStatusChange,
    getState: function () { return currentEngineState; }
  };
})();
