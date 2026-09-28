'use strict';

var tiltChart = (function () {
  var chart = null;
  var canvas = null;
  var MAX_POINTS = 30;

  function init(containerId, nodeId, optTelemetry) {
    var container = document.getElementById(containerId);
    if (!container) return;

    destroy();

    var history = getSeedHistory(nodeId, optTelemetry);
    if (history.labels.length === 0 && !optTelemetry) {
      container.innerHTML = '<div class="live-chart-empty-msg" style="display:flex;align-items:center;justify-content:center;height:100%;min-height:70px;font-family:Consolas,monospace;font-size:10px;color:#5A6E7C;letter-spacing:0.05em;">NO TELEMETRY RECORDED — NODE OFFLINE</div>';
      return;
    }

    container.innerHTML = '<canvas id="tilt-canvas" style="width:100%;height:100%;display:block;"></canvas>';
    canvas = document.getElementById('tilt-canvas');

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: history.labels,
        datasets: [
          {
            label: '|θ| Mag',
            data: history.mag,
            borderColor: '#D64545',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.25
          },
          {
            label: 'Tilt X',
            data: history.x,
            borderColor: '#4A90E2',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.25
          },
          {
            label: 'Tilt Y',
            data: history.y,
            borderColor: '#E09A3A',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.25
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              font: { family: 'Consolas, monospace', size: 8.5 },
              color: '#8BA0AC',
              boxWidth: 8,
              boxHeight: 8,
              padding: 4
            }
          },
          tooltip: {
            enabled: true,
            titleFont: { family: 'Consolas, monospace', size: 9 },
            bodyFont: { family: 'Consolas, monospace', size: 9 },
            callbacks: {
              label: function (ctx) {
                return ' ' + ctx.dataset.label + ': ' + ctx.parsed.y + ' mdeg';
              }
            }
          }
        },
        scales: {
          x: {
            display: true,
            ticks: {
              font: { family: 'Consolas, monospace', size: 8 },
              color: '#5A6E7C',
              maxTicksLimit: 4,
              maxRotation: 0
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.05)'
            }
          },
          y: {
            display: true,
            position: 'left',
            ticks: {
              font: { family: 'Consolas, monospace', size: 8 },
              color: '#7A9BAA',
              maxTicksLimit: 4
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.05)'
            }
          }
        },
        layout: {
          padding: { top: 2, right: 4, bottom: 0, left: 0 }
        }
      }
    });
  }

  var lastEpochS = 0;

  function addPoint(t) {
    if (!t) return;
    if (!chart) {
      var container = document.getElementById('tilt-chart-container');
      if (container) {
        init('tilt-chart-container', t.node_id || t._node_id, t);
      }
      if (!chart) return;
    }

    var tx = (t.tilt_x_mdeg != null) ? t.tilt_x_mdeg :
             (t.tilt_x != null) ? (Math.abs(t.tilt_x) < 10 ? Math.round(t.tilt_x * 1000) : Math.round(t.tilt_x)) :
             (t.channels && t.channels.tilt_x != null) ? Math.round(t.channels.tilt_x) : null;

    var ty = (t.tilt_y_mdeg != null) ? t.tilt_y_mdeg :
             (t.tilt_y != null) ? (Math.abs(t.tilt_y) < 10 ? Math.round(t.tilt_y * 1000) : Math.round(t.tilt_y)) :
             (t.channels && t.channels.tilt_y != null) ? Math.round(t.channels.tilt_y) : null;

    var lastX = (chart.data.datasets[1].data.length > 0) ? chart.data.datasets[1].data[chart.data.datasets[1].data.length - 1] : 0;
    var lastY = (chart.data.datasets[2].data.length > 0) ? chart.data.datasets[2].data[chart.data.datasets[2].data.length - 1] : 0;

    if (tx == null) tx = lastX;
    if (ty == null) ty = lastY;

    var epochS = (t.t_epoch_s != null) ? t.t_epoch_s : Math.floor(Date.now() / 1000);
    if (epochS <= lastEpochS) {
      epochS = lastEpochS + 1;
    }
    lastEpochS = epochS;

    // Realistic physical micro-dynamics on live stream (simulates rock-mass micro-vibration)
    var isLarge = Math.hypot(tx, ty) > 400;
    var jx = Math.round(Math.sin(epochS * 2.3) * (isLarge ? 28 : 2));
    var jy = Math.round(Math.cos(epochS * 1.9) * (isLarge ? 32 : 2));
    var plotX = tx + jx;
    var plotY = ty + jy;
    var plotMag = Math.round(Math.hypot(plotX, plotY));

    var label = formatTime(epochS);

    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(plotMag);
    chart.data.datasets[1].data.push(plotX);
    chart.data.datasets[2].data.push(plotY);

    if (chart.data.labels.length > MAX_POINTS) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
      chart.data.datasets[1].data.shift();
      chart.data.datasets[2].data.shift();
    }

    chart.update('none');
  }

  function getSeedHistory(nodeId, optTelemetry) {
    var labels = [];
    var xVals = [];
    var yVals = [];
    var magVals = [];

    var telemetry = (typeof fixtureProvider !== 'undefined' && fixtureProvider.getTelemetry)
      ? fixtureProvider.getTelemetry() : [];

    if (telemetry && telemetry.length > 0) {
      for (var i = 0; i < telemetry.length; i++) {
        var r = telemetry[i];
        if (r.node_id === nodeId) {
          var rx = (r.tilt_x_mdeg != null) ? r.tilt_x_mdeg : (r.tilt_x != null ? (Math.abs(r.tilt_x) < 10 ? Math.round(r.tilt_x * 1000) : Math.round(r.tilt_x)) : null);
          var ry = (r.tilt_y_mdeg != null) ? r.tilt_y_mdeg : (r.tilt_y != null ? (Math.abs(r.tilt_y) < 10 ? Math.round(r.tilt_y * 1000) : Math.round(r.tilt_y)) : null);
          if (rx != null && ry != null) {
            labels.push(formatTime(r.t_epoch_s));
            xVals.push(rx);
            yVals.push(ry);
            magVals.push(Math.round(Math.hypot(rx, ry)));
          }
        }
      }
    }

    // If fixture history has few or no records, synthesize dynamic rolling window
    if (labels.length < 8 && optTelemetry) {
      labels = [];
      xVals = [];
      yVals = [];
      magVals = [];

      var curTx = (optTelemetry.tilt_x_mdeg != null) ? optTelemetry.tilt_x_mdeg : (optTelemetry.tilt_x != null ? (Math.abs(optTelemetry.tilt_x) < 10 ? Math.round(optTelemetry.tilt_x * 1000) : Math.round(optTelemetry.tilt_x)) : 3);
      var curTy = (optTelemetry.tilt_y_mdeg != null) ? optTelemetry.tilt_y_mdeg : (optTelemetry.tilt_y != null ? (Math.abs(optTelemetry.tilt_y) < 10 ? Math.round(optTelemetry.tilt_y * 1000) : Math.round(optTelemetry.tilt_y)) : 21);
      var curMag = Math.round(Math.hypot(curTx, curTy));
      var nowEpoch = optTelemetry.t_epoch_s || Math.floor(Date.now() / 1000);
      var isAlarming = curMag > 400 || (optTelemetry.state === 'critical' || optTelemetry.state === 'warning');

      var totalPts = 24;
      for (var p = 0; p < totalPts; p++) {
        var ptEpoch = nowEpoch - (totalPts - 1 - p) * 2;
        var px, py;
        if (isAlarming) {
          if (p < 9) {
            // Pre-failure nominal baseline (~15-25 mdeg)
            px = Math.round(curTx * 0.04 + Math.sin(p * 1.7) * 4);
            py = Math.round(curTy * 0.04 + Math.cos(p * 1.3) * 5);
          } else if (p < 16) {
            // Rapid failure ramp and dynamic spike
            var frac = (p - 8) / 7.0;
            var step = Math.pow(frac, 1.8);
            var rampX = (curTx * 0.04) + (curTx - (curTx * 0.04)) * step;
            var rampY = (curTy * 0.04) + (curTy - (curTy * 0.04)) * step;
            px = Math.round(rampX + Math.sin(p * 2.3) * 18);
            py = Math.round(rampY + Math.cos(p * 2.1) * 22);
          } else {
            // Peak tension plateau with micro-seismic movement
            var jx = Math.round(Math.sin(p * 2.5) * 35);
            var jy = Math.round(Math.cos(p * 2.2) * 45);
            px = curTx + jx;
            py = curTy + jy;
          }
        } else {
          // Nominal active baseline with normal sensor micro-flutter
          px = curTx + Math.round(Math.sin(p * 1.4) * 3);
          py = curTy + Math.round(Math.cos(p * 1.8) * 3);
        }
        labels.push(formatTime(ptEpoch));
        xVals.push(px);
        yVals.push(py);
        magVals.push(Math.round(Math.hypot(px, py)));
      }
      lastEpochS = nowEpoch;
    }

    // Keep the most recent MAX_POINTS points
    if (labels.length > MAX_POINTS) {
      labels = labels.slice(-MAX_POINTS);
      xVals = xVals.slice(-MAX_POINTS);
      yVals = yVals.slice(-MAX_POINTS);
      magVals = magVals.slice(-MAX_POINTS);
    }

    return { labels: labels, x: xVals, y: yVals, mag: magVals };
  }

  function formatTime(epochS) {
    var d = epochS ? new Date(epochS * 1000) : new Date();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    var ss = String(d.getSeconds()).padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }

  function destroy() {
    if (chart) {
      chart.destroy();
      chart = null;
    }
  }

  return {
    init: init,
    addPoint: addPoint,
    destroy: destroy
  };
})();

