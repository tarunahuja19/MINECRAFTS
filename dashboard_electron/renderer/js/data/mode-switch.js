'use strict';

var modeSwitch = (function () {
  var currentMode = 'fixture';

  var modeIndicator = null;

  function init() {
    modeIndicator = document.getElementById('mode-indicator');

    // Automatically listen on liveProvider WebSocket in background
    liveProvider.start();

    // Auto-detect if live backend is running and default to LIVE mode
    fetch('http://localhost:8080/api/health')
      .then(function (res) {
        if (res.ok) {
          console.log('[mode-switch] Live backend detected on port 8080. Initializing in LIVE SIMULATION mode.');
          setMode('live');
        } else {
          setMode('fixture');
        }
      })
      .catch(function () {
        setMode('fixture');
      });

    bus.on('simulation-packet', function () {
      if (currentMode !== 'live') {
        console.log('[mode-switch] Real-time simulation packet received. Switching to LIVE mode.');
        setMode('live');
      }
    });
  }

  function setMode(mode) {
    currentMode = mode;

    if (mode === 'fixture') {
      fixtureProvider.stopReplay();
      updateModeDisplay('FIXTURE MODE — REPLAY', true);

      fixtureProvider.loadFixtures('../fixtures').then(function () {
        bus.emit('fixture-started', null);
        fixtureProvider.startLiveSimulation();
      });
    } else {
      fixtureProvider.stopReplay();
      liveProvider.start();
      updateModeDisplay('LIVE SIMULATION', false);

      // Load canonical nodes from live PostgreSQL backend
      fetch('http://localhost:8080/api/nodes')
        .then(function (r) { return r.json(); })
        .then(function (nodes) {
          bus.emit('nodes-loaded', nodes);
        })
        .catch(function (err) {
          console.warn('[mode-switch] Failed to fetch nodes from live backend:', err.message);
        });

      // Load initial alarms from live PostgreSQL backend
      fetch('http://localhost:8080/api/alarms')
        .then(function (r) { return r.json(); })
        .then(function (alarms) {
          if (Array.isArray(alarms)) {
            bus.emit('alarms-loaded', alarms);
          }
        })
        .catch(function (err) {
          console.warn('[mode-switch] Failed to fetch alarms from live backend:', err.message);
          bus.emit('alarms-loaded', []);
        });
    }
  }

  function updateModeDisplay(text, isFixture) {
    if (!modeIndicator) return;
    var val = modeIndicator.querySelector('.status-value');
    if (val) {
      val.textContent = text;
      if (isFixture) {
        val.className = 'status-value warning';
      } else {
        val.className = 'status-value connected';
      }
    }
  }

  function getMode() { return currentMode; }

  return { init: init, setMode: setMode, getMode: getMode };
})();
