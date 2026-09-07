'use strict';

/**
 * Replay Controller
 *
 * Replays the recorded telemetry in the Postgres `readings` table from the
 * first row to now. There is no date picker: the operator asked for "replay
 * what the system has", not "replay one particular day", and a fixed date
 * range was the reason the old control only ever played back a single day.
 *
 * Three states, not two: STOPPED -> PLAYING <-> PAUSED. PAUSE freezes the
 * cursor and leaves the loaded records in memory; RESUME picks up at the same
 * index. STOP tears the replay down and hands the dashboard back to live.
 *
 * While a replay is running the live feed is suspended (see suspendLive /
 * resumeLive). Without that, WebSocket frames arriving from the simulation
 * keep emitting `telemetry` and `alarm` on the same bus the replay is using,
 * so the map, charts and alarm list end up interleaving historical records
 * with present-time ones - nodes appear to jump between past and now, and a
 * new alarm lands in the middle of the replayed timeline. Replay is a
 * forensic view: for as long as it is on screen it is the only writer.
 */
var replayController = (function () {
  var containerIds = [];
  var replayTimer = null;
  var replayData = [];
  var replayIndex = 0;
  var replaySpeed = 10;
  var batchSize = 60;
  var replayAlarms = [];
  var replayDbAlarms = [];
  var emittedAlarms = {};

  // 'stopped' | 'loading' | 'playing' | 'paused'
  var state = 'stopped';

  // Whether we were the one who suspended the live feed, so we only resume
  // what we actually paused.
  var liveSuspended = false;

  var API_BASE = 'http://' + (window.location.hostname || 'localhost') + ':8080';

  function init(target) {
    if (Array.isArray(target)) {
      containerIds = target;
    } else if (target) {
      containerIds = [target];
    }
    render();
    fetchDbRowCount();

    bus.on('backend-connected', function () {
      fetchDbRowCount();
    });
    bus.on('fixture-started', function () {
      fetchDbRowCount();
    });
    bus.on('system-reset', function () {
      teardown();
      replayData = [];
      replayIndex = 0;
      replayAlarms = [];
      emittedAlarms = {};
      setProgress(0, 0);
      setStatus('IDLE (RESET)');
      fetchDbRowCount();
    });
  }

  // ---------------------------------------------------------------------
  // Live-feed isolation
  // ---------------------------------------------------------------------

  function suspendLive() {
    if (liveSuspended) return;
    liveSuspended = true;

    // Stop the fixture loop (fixture mode) and close the WebSocket / clear the
    // heartbeat timers (live mode). Both emit on the shared bus; neither may
    // run while the replay owns the timeline.
    if (typeof fixtureProvider !== 'undefined' && fixtureProvider.stopReplay) {
      fixtureProvider.stopReplay();
    }
    if (typeof liveProvider !== 'undefined' && liveProvider.stop) {
      liveProvider.stop();
    }
    bus.emit('replay-live-suspended', null);
  }

  function resumeLive() {
    if (!liveSuspended) return;
    liveSuspended = false;

    var mode = (typeof modeSwitch !== 'undefined' && modeSwitch.getMode)
      ? modeSwitch.getMode() : 'fixture';

    if (mode === 'live') {
      if (typeof liveProvider !== 'undefined' && liveProvider.start) {
        liveProvider.start();
      }
    } else if (typeof fixtureProvider !== 'undefined' && fixtureProvider.startLiveSimulation) {
      fixtureProvider.startLiveSimulation();
    }
    bus.emit('replay-live-resumed', null);
  }

  // ---------------------------------------------------------------------
  // Row count / readiness
  // ---------------------------------------------------------------------

  function fetchDbRowCount() {
    if (state !== 'stopped') return;

    fetch(API_BASE + '/api/health')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.counts && typeof data.counts.readings === 'number') {
          var count = data.counts.readings;
          setProgress(0, count);
          setStatus(count > 0
            ? 'READY — ' + count + ' DB ROWS'
            : 'READY — NO RECORDED ROWS YET');
          setSource('● DB (ROW 1 → NOW)');
        }
      })
      .catch(function () {
        var allT = (typeof fixtureProvider !== 'undefined' && fixtureProvider.getTelemetry)
          ? fixtureProvider.getTelemetry() : [];
        if (allT && allT.length) {
          setProgress(0, allT.length);
          setStatus('READY — ' + allT.length + ' FIXTURE ROWS');
          setSource('● FIXTURE (BACKEND OFFLINE)');
        } else {
          setStatus('BACKEND UNREACHABLE');
          setSource('● NO SOURCE');
        }
      });
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  function render() {
    var html =
      '<div class="replay-controls">' +
        '<div class="replay-row">' +
          '<button class="btn replay-btn replay-btn-play">PLAY</button>' +
          '<button class="btn replay-btn replay-btn-pause" disabled>PAUSE</button>' +
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
        '<div class="replay-row replay-row-status">' +
          '<span class="replay-status">DATABASE REPLAY READY</span>' +
          '<span class="replay-db-source">● DB (ROW 1 → NOW)</span>' +
        '</div>' +
      '</div>';

    containerIds.forEach(function (cId) {
      var container = document.getElementById(cId);
      if (!container) return;

      container.innerHTML = html;

      var playBtn = container.querySelector('.replay-btn-play');
      var pauseBtn = container.querySelector('.replay-btn-pause');
      var stopBtn = container.querySelector('.replay-btn-stop');

      if (!document.getElementById('replay-play')) playBtn.id = 'replay-play';
      if (!document.getElementById('replay-pause')) pauseBtn.id = 'replay-pause';
      if (!document.getElementById('replay-stop')) stopBtn.id = 'replay-stop';

      playBtn.addEventListener('click', onPlayClick);
      pauseBtn.addEventListener('click', onPauseClick);
      stopBtn.addEventListener('click', function () { stopReplay(true); });

      container.querySelectorAll('.replay-speed-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var spd = parseInt(this.dataset.speed, 10);
          replaySpeed = spd;
          document.querySelectorAll('.replay-speed-btn').forEach(function (b) {
            b.classList.toggle('active', parseInt(b.dataset.speed, 10) === spd);
          });
          // Re-arm the interval at the new cadence only if actually running;
          // a paused replay picks the new speed up when it resumes.
          if (state === 'playing') {
            clearTimer();
            startTimer();
          }
        });
      });
    });

    syncButtons();
  }

  // ---------------------------------------------------------------------
  // Button handlers
  // ---------------------------------------------------------------------

  function onPlayClick() {
    if (state === 'paused') {
      resumeReplay();
    } else if (state === 'stopped') {
      startReplay();
    }
  }

  function onPauseClick() {
    if (state === 'playing') pauseReplay();
    else if (state === 'paused') resumeReplay();
  }

  // ---------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------

  function startReplay() {
    state = 'loading';
    syncButtons();
    setStatus('FETCHING DATABASE RECORDS (ROW 1 → NOW)...');

    var readingsFetch = fetch(API_BASE + '/api/readings?order=asc&limit=all')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      });

    var alarmsFetch = fetch(API_BASE + '/api/alarms')
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .catch(function () {
        return [];
      });

    Promise.all([readingsFetch, alarmsFetch])
      .then(function (results) {
        var data = results[0];
        var alarms = results[1];
        if (Array.isArray(alarms) && alarms.length > 0) {
          replayDbAlarms = alarms;
        } else {
          replayDbAlarms = [];
        }
        if (Array.isArray(data) && data.length > 0) {
          replayData = data;
          setSource('● DB (' + data.length + ' ROWS)');
          finishDataLoadAndPlay();
        } else {
          fallbackHistoryQuery();
        }
      })
      .catch(function (err) {
        console.warn('[replay-controller] /api/readings fetch failed, trying IPC fallback:', err.message);
        fallbackHistoryQuery();
      });
  }

  function fallbackHistoryQuery() {
    if (window.r4 && window.r4.getHistory) {
      window.r4.getHistory({ order: 'asc', limit: 'all' })
        .then(function (data) {
          if (Array.isArray(data) && data.length > 0) {
            replayData = data;
            setSource('● DB VIA IPC (' + data.length + ' ROWS)');
            finishDataLoadAndPlay();
          } else {
            fallbackToFixture();
          }
        })
        .catch(function () {
          fallbackToFixture();
        });
    } else {
      fallbackToFixture();
    }
  }

  function fallbackToFixture() {
    var allT = (typeof fixtureProvider !== 'undefined' && fixtureProvider.getTelemetry)
      ? fixtureProvider.getTelemetry() : [];
    if (allT && allT.length) {
      replayData = allT.slice();
      setSource('● FIXTURE (' + allT.length + ' ROWS)');
      finishDataLoadAndPlay();
    } else {
      state = 'stopped';
      syncButtons();
      setStatus('NO DATA AVAILABLE');
      setSource('● NO SOURCE');
    }
  }

  function finishDataLoadAndPlay() {
    replayData.sort(function (a, b) {
      if (a.t_epoch_s !== b.t_epoch_s) return a.t_epoch_s - b.t_epoch_s;
      return (a.node_id || '').localeCompare(b.node_id || '');
    });
    beginPlayback();
  }

  // ---------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------

  function beginPlayback() {
    if (replayData.length === 0) {
      state = 'stopped';
      syncButtons();
      setStatus('NO RECORDS TO REPLAY');
      return;
    }

    replayIndex = 0;
    emittedAlarms = {};

    var rawAlarms = (replayDbAlarms && replayDbAlarms.length > 0) ? replayDbAlarms : [];
    if (rawAlarms.length === 0 && typeof fixtureProvider !== 'undefined' && fixtureProvider.getAlarms) {
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

    // Take the bus before the first historical frame goes out.
    suspendLive();

    state = 'playing';
    syncButtons();
    setStatus('REPLAYING ' + replayData.length + ' RECORDS @ ' + replaySpeed + 'x');
    updateModeIndicator();

    bus.emit('replay-started', { total: replayData.length, speed: replaySpeed });

    var mapBtn = document.querySelector('.tab-btn[data-tab="map"]');
    if (mapBtn) mapBtn.click();

    startTimer();
  }

  function pauseReplay() {
    if (state !== 'playing') return;
    clearTimer();
    state = 'paused';
    syncButtons();
    updateModeIndicator();

    var pct = replayData.length ? Math.round((replayIndex / replayData.length) * 100) : 0;
    setStatus('PAUSED @ ' + replayIndex + ' / ' + replayData.length + ' (' + pct + '%)');
    bus.emit('replay-paused', { index: replayIndex, total: replayData.length });
  }

  function resumeReplay() {
    if (state !== 'paused') return;

    // The live feed may have been restored (or never suspended) while paused;
    // re-take it before emitting historical frames again.
    suspendLive();

    state = 'playing';
    syncButtons();
    updateModeIndicator();
    setStatus('REPLAYING @ ' + replaySpeed + 'x — RESUMED');
    bus.emit('replay-resumed', { index: replayIndex, total: replayData.length });
    startTimer();
  }

  function startTimer() {
    var intervalMs = Math.max(16, 1000 / replaySpeed);
    replayTimer = setInterval(function () {
      // Guard: a stale tick must never emit after a pause/stop.
      if (state !== 'playing') return;

      var currentRecord = null;
      for (var i = 0; i < batchSize && replayIndex < replayData.length; i++, replayIndex++) {
        currentRecord = replayData[replayIndex];
        bus.emit('telemetry', currentRecord);
      }

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
        var total = replayData.length;
        stopReplay(false);
        setStatus('COMPLETE — ' + total + ' RECORDS REPLAYED');
        bus.emit('replay-complete', null);
      }
    }, intervalMs);
  }

  function clearTimer() {
    if (replayTimer) {
      clearInterval(replayTimer);
      replayTimer = null;
    }
  }

  // Tear the timer down and drop back to STOPPED without touching the live
  // feed - used by system-reset, where the caller owns provider lifecycle.
  function teardown() {
    clearTimer();
    state = 'stopped';
    liveSuspended = false;
    syncButtons();
    updateModeIndicator();
  }

  function stopReplay(announce) {
    clearTimer();
    state = 'stopped';
    syncButtons();

    resumeLive();
    updateModeIndicator();

    if (announce) {
      setStatus('STOPPED — LIVE FEED RESUMED');
      bus.emit('replay-stopped', { index: replayIndex, total: replayData.length });
    }
  }

  // ---------------------------------------------------------------------
  // UI sync
  // ---------------------------------------------------------------------

  function syncButtons() {
    var isPlaying = state === 'playing';
    var isPaused = state === 'paused';
    var isLoading = state === 'loading';

    document.querySelectorAll('.replay-btn-play').forEach(function (btn) {
      btn.disabled = isPlaying || isLoading;
      btn.textContent = isPaused ? 'RESUME' : 'PLAY';
    });
    document.querySelectorAll('.replay-btn-pause').forEach(function (btn) {
      btn.disabled = !isPlaying;
      btn.textContent = isPaused ? 'PAUSED' : 'PAUSE';
      btn.classList.toggle('is-paused', isPaused);
    });
    document.querySelectorAll('.replay-btn-stop').forEach(function (btn) {
      btn.disabled = !(isPlaying || isPaused);
    });
  }

  function setProgress(index, total) {
    var pct = total > 0 ? Math.round((index / total) * 100) : 0;
    document.querySelectorAll('.replay-progress-bar').forEach(function (bar) {
      bar.style.width = pct + '%';
    });
    document.querySelectorAll('.replay-counter').forEach(function (counter) {
      counter.textContent = index + ' / ' + total;
    });
  }

  function updateProgress() {
    setProgress(replayIndex, replayData.length);

    if (state === 'playing' && replayIndex > 0 && replayIndex <= replayData.length) {
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

  function setSource(text) {
    document.querySelectorAll('.replay-db-source').forEach(function (el) {
      el.textContent = text;
    });
  }

  function updateModeIndicator() {
    var indicator = document.getElementById('mode-indicator');
    if (!indicator) return;

    if (state === 'playing') {
      indicator.innerHTML = '<span class="status-value warning">REPLAY MODE</span>';
      return;
    }
    if (state === 'paused') {
      indicator.innerHTML = '<span class="status-value warning">REPLAY PAUSED</span>';
      return;
    }

    var mode = (typeof modeSwitch !== 'undefined' && modeSwitch.getMode)
      ? modeSwitch.getMode() : 'fixture';
    if (mode === 'fixture') {
      indicator.innerHTML = '<span class="status-value warning">FIXTURE MODE</span>';
    } else {
      indicator.innerHTML = '<span class="status-value">LIVE</span>';
    }
  }

  return {
    init: init,
    stop: function () { stopReplay(true); },
    // Halt the replay WITHOUT handing the bus back to the live feed. The
    // shutdown path uses this: it is about to stop the providers anyway, and
    // stop() would briefly restart the fixture loop on the way out.
    teardown: teardown,
    pause: pauseReplay,
    resume: resumeReplay,
    isPlaying: function () { return state === 'playing'; },
    isPaused: function () { return state === 'paused'; },
    getState: function () { return state; }
  };
})();
