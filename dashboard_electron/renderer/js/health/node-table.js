'use strict';

var nodeTable = (function () {
  var containerIds = [];
  var nodeStats = {};
  var sortCol = 'node_id';
  var sortAsc = true;
  var simRunning = false;

  function init(targetId) {
    containerIds.push(targetId);

    if (containerIds.length > 1) return;

    bus.on('nodes-loaded', function (nodes) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        nodeStats[n.node_id] = {
          node_id: n.node_id,
          ring: n.ring,
          state: simRunning ? (n.state || 'active') : 'dead',
          lastSeen: null,
          rxCount: 0,
          missedCount: 0,
          rssi: null,
          snr: null
        };
      }
      render();
    });

    bus.on('simulation-status', function (data) {
      var isRunning = Boolean(data.is_running);
      var state = data.state || (isRunning ? 'RUNNING' : 'STOPPED');
      simRunning = (state === 'RUNNING');
      var ids = Object.keys(nodeStats);
      for (var k = 0; k < ids.length; k++) {
        if (!simRunning) {
          nodeStats[ids[k]].state = 'dead';
        } else if (nodeStats[ids[k]].state === 'dead') {
          nodeStats[ids[k]].state = 'active';
        }
      }
      render();
    });

    bus.on('system-reset', function () {
      simRunning = false;
      var ids = Object.keys(nodeStats);
      for (var k = 0; k < ids.length; k++) {
        nodeStats[ids[k]].state = 'dead';
        nodeStats[ids[k]].lastSeen = null;
        nodeStats[ids[k]].rxCount = 0;
      }
      render();
    });

    bus.on('telemetry', function (t) {
      if (!simRunning) return;
      var id = t._node_id || t.node_id;
      if (!id || !nodeStats[id]) return;
      nodeStats[id].lastSeen = Date.now();
      nodeStats[id].rxCount++;
      if (typeof t.rssi === 'number') nodeStats[id].rssi = t.rssi;
      if (typeof t.snr === 'number') nodeStats[id].snr = t.snr;
      if (nodeStats[id].state === 'dead') nodeStats[id].state = 'active';
    });

    bus.on('node-status-change', function (data) {
      if (nodeStats[data.node_id]) {
        nodeStats[data.node_id].state = data.state;
        if (data.state === 'dead') {
          nodeStats[data.node_id].missedCount++;
        }
      }
    });

    setInterval(function () {
      for (var i = 0; i < containerIds.length; i++) {
        var container = document.getElementById(containerIds[i]);
        if (container && container.offsetParent !== null) {
          render();
          return;
        }
      }
    }, 2000);
  }

  function render() {
    var rows = getSortedRows();

    var html =
      '<table class="data-table" id="node-health-table">' +
        '<thead><tr>' +
          '<th class="sortable" data-col="node_id">NODE</th>' +
          '<th class="sortable" data-col="state">STATUS</th>' +
          '<th class="sortable" data-col="ring">RING</th>' +
          '<th class="sortable" data-col="lastSeen">LAST SEEN</th>' +
          '<th class="sortable" data-col="rxCount">RX</th>' +
          '<th class="sortable" data-col="missedCount">MISSED</th>' +
          '<th class="sortable" data-col="rssi">RSSI</th>' +
          '<th class="sortable" data-col="snr">SNR</th>' +
        '</tr></thead>' +
        '<tbody>';

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var timeStr = r.lastSeen ? formatTime(r.lastSeen) : '--';
      var rssiStr = r.rssi !== null ? r.rssi + ' dBm' : '--';
      var snrStr = r.snr !== null ? r.snr.toFixed(1) + ' dB' : '--';

      html +=
        '<tr>' +
          '<td>' + r.node_id + '</td>' +
          '<td><span class="state-badge ' + r.state + '">' + r.state.toUpperCase() + '</span></td>' +
          '<td>' + r.ring.toUpperCase() + '</td>' +
          '<td class="mono">' + timeStr + '</td>' +
          '<td>' + r.rxCount + '</td>' +
          '<td>' + r.missedCount + '</td>' +
          '<td>' + rssiStr + '</td>' +
          '<td>' + snrStr + '</td>' +
        '</tr>';
    }

    html += '</tbody></table>';

    for (var c = 0; c < containerIds.length; c++) {
      var container = document.getElementById(containerIds[c]);
      if (container) container.innerHTML = html;
    }

    for (var c2 = 0; c2 < containerIds.length; c2++) {
      var cont = document.getElementById(containerIds[c2]);
      if (!cont) continue;
      var headers = cont.querySelectorAll('.sortable');
      for (var j = 0; j < headers.length; j++) {
        headers[j].addEventListener('click', function () {
          var col = this.dataset.col;
          if (sortCol === col) {
            sortAsc = !sortAsc;
          } else {
            sortCol = col;
            sortAsc = true;
          }
          render();
        });
      }
    }
  }

  function getSortedRows() {
    var ids = Object.keys(nodeStats);
    var rows = [];
    for (var i = 0; i < ids.length; i++) {
      rows.push(nodeStats[ids[i]]);
    }

    var stateOrder = { critical: 0, lastgasp: 1, warning: 2, dead: 3, active: 4 };

    rows.sort(function (a, b) {
      var va, vb;
      if (sortCol === 'state') {
        va = stateOrder[a.state] !== undefined ? stateOrder[a.state] : 5;
        vb = stateOrder[b.state] !== undefined ? stateOrder[b.state] : 5;
      } else if (sortCol === 'lastSeen') {
        va = a.lastSeen || 0;
        vb = b.lastSeen || 0;
      } else {
        va = a[sortCol];
        vb = b[sortCol];
      }
      if (va === null || va === undefined) va = '';
      if (vb === null || vb === undefined) vb = '';
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });

    return rows;
  }

  // ISO 8601 local time, date included. A bare HH:MM:SS is ambiguous the
  // moment a node was last heard from on a previous day - it reads as "seen
  // minutes ago" when it was actually yesterday. Local rather than UTC, and
  // with the offset spelled out, so an operator can compare it against a wall
  // clock without doing timezone arithmetic.
  function formatTime(ms) {
    return formatIsoLocal(new Date(ms));
  }

  function formatIsoLocal(d) {
    var pad = function (n, w) { return String(n).padStart(w || 2, '0'); };
    var offMin = -d.getTimezoneOffset();
    var sign = offMin >= 0 ? '+' : '-';
    var abs = Math.abs(offMin);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
           'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
           sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  }

  return { init: init, render: render };
})();
