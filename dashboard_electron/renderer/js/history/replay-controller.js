'use strict';

var replayController = (function () {
  var containerIds = [];
  var replayTimer = null;
  var replayData = [];
  var replayIndex = 0;
  var replaySpeed = 10;
  var playing = false;
  var batchSize = 60;
  var replayAlarms = [];
  var emittedAlarms = {};

  function init(target) {
    if (Array.isArray(target)) {
      containerIds = target;
    } else if (target) {
      containerIds = [target];
    }
    render();

    bus.on('fixture-started', function () {
      setDateRangeFromData();
    });
    bus.on('backend-connected', function () {
      setDateRangeFromData();
    });
  }

  function setDateRangeFromData() {
    var telemetry = fixtureProvider.getTelemetry();
    if (!telemetry || telemetry.length === 0) return;

    var minT = telemetry[0].t_epoch_s;
    var maxT = telemetry[telemetry.length - 1].t_epoch_s;
    for (var i = 0; i < telemetry.length; i++) {
      if (telemetry[i].t_epoch_s < minT) minT = telemetry[i].t_epoch_s;
      if (telemetry[i].t_epoch_s > maxT) maxT = telemetry[i].t_epoch_s;
    }

    var fromVal = epochToLocal(minT);
    var toVal = epochToLocal(maxT);

    document.querySelectorAll('.replay-input-from').forEach(function (el) { el.value = fromVal; });
    document.querySelectorAll('.replay-input-to').forEach(function (el) { el.value = toVal; });
    document.querySelectorAll('.replay-counter').forEach(function (el) { el.textContent = '0 / ' + telemetry.length; });
  }

  function epochToLocal(epoch) {
    var d = new Date(epoch * 1000);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var h = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    return y + '-' + m + '-' + day + 'T' + h + ':' + min;
  }

  function render() {
    var now = new Date();
    var thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

    function fmt(d) {
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      var h = String(d.getHours()).padStart(2, '0');
      var min = String(d.getMinutes()).padStart(2, '0');
      return y + '-' + m + '-' + day + 'T' + h + ':' + min;
    }

    var html =
      '<div class="replay-controls">' +
        '<div class="replay-row">' +
          '<label class="replay-label">FROM</label>' +
          '<input type="datetime-local" class="replay-input replay-input-from" value="' + fmt(thirtyDaysAgo) + '">' +
          '<label class="replay-label">TO</label>' +
          '<input type="datetime-local" class="replay-input replay-input-to" value="' + fmt(now) + '">' +
        '</div>' +
        '<div class="replay-row">' +
          '<button class="btn replay-btn replay-btn-play">PLAY</button>' +
          '<button class="btn replay-btn replay-btn-stop" disabled>STOP</button>' +
          '<span class="replay-label">SPEED:</span>' +
          '<button class="btn replay-speed-btn active" data-speed="10">10x</button>' +
          '<button class="btn replay-speed-btn" data-speed="50">50x</button>' +
          '<button class="btn replay-speed-btn" data-speed="100">100x</button>' +
        '</div>' +
        '<div class="replay-row">' +
          '<div class="replay-progress-track">' +
            '<div class="replay-progress-bar" style="width:0%"></div>' +
          '</div>' +
          '<span class="replay-counter">0 / 0</span>' +
        '</div>' +
        '<div class="replay-row">' +
          '<span class="replay-status">IDLE</span>' +
        '</div>' +
      '</div>';

    containerIds.forEach(function (cId) {
      var container = document.getElementById(cId);
      if (!container) return;

      container.innerHTML = html;

      // Forward ID references for first container or existing elements
      var playBtn = container.querySelector('.replay-btn-play');
      var stopBtn = container.querySelector('.replay-btn-stop');
      var fromInput = container.querySelector('.replay-input-from');
      var toInput = container.querySelector('.replay-input-to');

      if (!document.getElementById('replay-play')) playBtn.id = 'replay-play';
      if (!document.getElementById('replay-stop')) stopBtn.id = 'replay-stop';
      if (!document.getElementById('replay-from')) fromInput.id = 'replay-from';
      if (!document.getElementById('replay-to')) toInput.id = 'replay-to';

      playBtn.addEventListener('click', startReplay);
      stopBtn.addEventListener('click', stopReplay);

      fromInput.addEventListener('change', function () {
        var v = this.value;
        document.querySelectorAll('.replay-input-from').forEach(function (el) { el.value = v; });
      });
      toInput.addEventListener('change', function () {
        var v = this.value;
        document.querySelectorAll('.replay-input-to').forEach(function (el) { el.value = v; });
      });

      container.querySelectorAll('.replay-speed-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var spd = parseInt(this.dataset.speed, 10);
          replaySpeed = spd;
          document.querySelectorAll('.replay-speed-btn').forEach(function (b) {
            b.classList.toggle('active', parseInt(b.dataset.speed, 10) === spd);
          });
          if (playing) {
            clearInterval(replayTimer);
            startTimer();
          }
        });
      });
    });
  }

  function updateTimeInputsFromTelemetry() {
    var allTelemetry = (typeof fixtureProvider !== 'undefined' && fixtureProvider.getTelemetry)
      ? fixtureProvider.getTelemetry() : [];
    if (!allTelemetry || allTelemetry.length === 0) return;

    var minT = allTelemetry[0].t_epoch_s;
    var maxT = allTelemetry[allTelemetry.length - 1].t_epoch_s;
    for (var i = 0; i < allTelemetry.length; i++) {
      if (allTelemetry[i].t_epoch_s < minT) minT = allTelemetry[i].t_epoch_s;
      if (allTelemetry[i].t_epoch_s > maxT) maxT = allTelemetry[i].t_epoch_s;
    }

    var fromStr = fmt(new Date(minT * 1000));
    var toStr = fmt(new Date(maxT * 1000));
    document.querySelectorAll('.replay-input-from').forEach(function (el) { el.value = fromStr; });
    document.querySelectorAll('.replay-input-to').forEach(function (el) { el.value = toStr; });
  }

  function startReplay() {
    var fromInput = document.querySelector('.replay-input-from');
    var toInput = document.querySelector('.replay-input-to');
    if (!fromInput || !toInput) return;

    var fromTs = Math.floor(new Date(fromInput.value).getTime() / 1000);
    var toTs = Math.floor(new Date(toInput.value).getTime() / 1000);

    var mode = (typeof modeSwitch !== 'undefined') ? modeSwitch.getMode() : 'fixture';

    if (mode === 'fixture') {
      var allTelemetry = fixtureProvider.getTelemetry();
      if (!allTelemetry || allTelemetry.length === 0) {
        setStatus('NO DATA');
        return;
      }
      replayData = allTelemetry.filter(function (t) {
        return t.t_epoch_s >= fromTs && t.t_epoch_s <= toTs;
      });

      // If date inputs don't cover the data or were empty, use the full 60s dataset
      if (replayData.length === 0) {
        replayData = allTelemetry.slice();
      }

      // Strictly ensure chronological ordering from timestep 0 to final timestep
      replayData.sort(function (a, b) {
        if (a.t_epoch_s !== b.t_epoch_s) return a.t_epoch_s - b.t_epoch_s;
        return a.node_id.localeCompare(b.node_id);
      });

      beginPlayback();
    } else {
      if (window.r4 && window.r4.getHistory) {
        window.r4.getHistory({ from: fromTs, to: toTs }).then(function (data) {
          replayData = data || [];
          if (replayData.length === 0 && fixtureProvider.getTelemetry) {
            replayData = fixtureProvider.getTelemetry().slice();
          }
          replayData.sort(function (a, b) { return a.t_epoch_s - b.t_epoch_s; });
          beginPlayback();
        }).catch(function () {
          setStatus('FETCH ERROR');
        });
      } else {
        setStatus('IPC UNAVAILABLE');
      }
    }
  }

  function beginPlayback() {
    if (replayData.length === 0) {
      setStatus('NO RECORDS IN RANGE');
      return;
    }

    replayIndex = 0;
    playing = true;
    emittedAlarms = {};

    var rawAlarms = [];
    if (typeof fixtureProvider !== 'undefined' && fixtureProvider.getAlarms) {
      rawAlarms = fixtureProvider.getAlarms() || [];
    }
    replayAlarms = rawAlarms.map(function (a) {
      return {
        alarm: a,
        t_epoch: Math.floor(new Date(a.t_utc).getTime() / 1000)
      };
    }).sort(function (a, b) {
      return a.t_epoch - b.t_epoch;
    });

    fixtureProvider.stopReplay();

    document.querySelectorAll('.replay-btn-play').forEach(function (btn) { btn.disabled = true; });
    document.querySelectorAll('.replay-btn-stop').forEach(function (btn) { btn.disabled = false; });
    setStatus('REPLAYING ' + replayData.length + ' RECORDS @ ' + replaySpeed + 'x');
    updateModeIndicator(true);

    bus.emit('replay-started', { total: replayData.length, speed: replaySpeed });

    var mapBtn = document.querySelector('.tab-btn[data-tab="map"]');
    if (mapBtn) mapBtn.click();

    startTimer();
  }

  function startTimer() {
    var intervalMs = Math.max(16, 1000 / replaySpeed);
    replayTimer = setInterval(function () {
      var currentRecord = null;
      for (var i = 0; i < batchSize && replayIndex < replayData.length; i++, replayIndex++) {
        currentRecord = replayData[replayIndex];
        bus.emit('telemetry', currentRecord);
      }

      // Dynamically trigger subsidence alarm and hemispherical bowl when simulated time reaches event
      if (currentRecord && currentRecord.t_epoch_s) {
        var currentT = currentRecord.t_epoch_s;
        for (var a = 0; a < replayAlarms.length; a++) {
          var item = replayAlarms[a];
          if (currentT >= item.t_epoch && !emittedAlarms[item.alarm.alarm_id]) {
            emittedAlarms[item.alarm.alarm_id] = true;
            bus.emit('alarm', item.alarm);
          }
        }
      }

      updateProgress();

      if (replayIndex >= replayData.length) {
        stopReplay();
        setStatus('COMPLETE — ' + replayData.length + ' RECORDS REPLAYED');
        bus.emit('replay-complete', null);
      }
    }, intervalMs);
  }

  function stopReplay() {
    if (replayTimer) {
      clearInterval(replayTimer);
      replayTimer = null;
    }
    playing = false;

    document.querySelectorAll('.replay-btn-play').forEach(function (btn) { btn.disabled = false; });
    document.querySelectorAll('.replay-btn-stop').forEach(function (btn) { btn.disabled = true; });
    updateModeIndicator(false);

    fixtureProvider.startLiveSimulation();
  }

  function updateProgress() {
    var pct = replayData.length > 0 ? Math.round((replayIndex / replayData.length) * 100) : 0;

    document.querySelectorAll('.replay-progress-bar').forEach(function (bar) {
      bar.style.width = pct + '%';
    });
    document.querySelectorAll('.replay-counter').forEach(function (counter) {
      counter.textContent = replayIndex + ' / ' + replayData.length;
    });

    if (playing && replayIndex > 0 && replayIndex <= replayData.length) {
      var current = replayData[replayIndex - 1];
      if (current && current.t_epoch_s) {
        var d = new Date(current.t_epoch_s * 1000);
        var ts = d.toISOString().replace('T', ' ').substring(0, 19) + 'Z';
        setStatus('REPLAYING @ ' + replaySpeed + 'x — ' + ts);
      }
    }
  }

  function setStatus(text) {
    document.querySelectorAll('.replay-status').forEach(function (el) {
      el.textContent = text;
    });
  }

  function updateModeIndicator(replaying) {
    var indicator = document.getElementById('mode-indicator');
    if (!indicator) return;
    if (replaying) {
      indicator.innerHTML = '<span class="status-value warning">REPLAY MODE</span>';
    } else {
      var mode = (typeof modeSwitch !== 'undefined') ? modeSwitch.getMode() : 'fixture';
      if (mode === 'fixture') {
        indicator.innerHTML = '<span class="status-value warning">FIXTURE MODE</span>';
      } else {
        indicator.innerHTML = '<span class="status-value">LIVE</span>';
      }
    }
  }

  return { init: init, stop: stopReplay };
})();
