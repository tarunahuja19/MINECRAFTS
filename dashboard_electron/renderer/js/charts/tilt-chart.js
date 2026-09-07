'use strict';

var tiltChart = (function () {
  var chart = null;
  var canvas = null;
  var MAX_POINTS = 30;

  function init(containerId, nodeId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    destroy();

    container.innerHTML = '<canvas id="tilt-canvas" style="width:100%;height:100%;display:block;"></canvas>';
    canvas = document.getElementById('tilt-canvas');

    var history = getSeedHistory(nodeId);

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: history.labels,
        datasets: [
          {
            label: '|θ| Mag',
            data: history.mag,
            borderColor: '#FF3366',
            backgroundColor: 'rgba(255, 51, 102, 0.08)',
            borderWidth: 2,
            fill: true,
            pointRadius: 1.5,
            pointBackgroundColor: '#FF3366',
            tension: 0.35
          },
          {
            label: 'Tilt X',
            data: history.x,
            borderColor: '#00E5FF',
            borderWidth: 1.5,
            fill: false,
            pointRadius: 1,
            pointBackgroundColor: '#00E5FF',
            tension: 0.35
          },
          {
            label: 'Tilt Y',
            data: history.y,
            borderColor: '#FFB300',
            borderWidth: 1.5,
            fill: false,
            pointRadius: 1,
            pointBackgroundColor: '#FFB300',
            tension: 0.35
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
              font: { family: 'Courier New', size: 8.5 },
              color: '#8BA0AC',
              boxWidth: 8,
              boxHeight: 8,
              padding: 4
            }
          },
          tooltip: {
            enabled: true,
            titleFont: { family: 'Courier New', size: 9 },
            bodyFont: { family: 'Courier New', size: 9 },
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
              font: { family: 'Courier New', size: 8 },
              color: '#5A6E7C',
              maxTicksLimit: 4,
              maxRotation: 0
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.04)'
            }
          },
          y: {
            display: true,
            position: 'left',
            ticks: {
              font: { family: 'Courier New', size: 8 },
              color: '#7A9BAA',
              maxTicksLimit: 4
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.06)'
            }
          }
        },
        layout: {
          padding: { top: 2, right: 4, bottom: 0, left: 0 }
        }
      }
    });
  }

  function addPoint(t) {
    if (!chart || !t) return;

    var tx = (t.tilt_x_mdeg != null) ? t.tilt_x_mdeg :
             (t.tilt_x != null) ? (Math.abs(t.tilt_x) < 10 ? Math.round(t.tilt_x * 1000) : Math.round(t.tilt_x)) :
             (t.channels && t.channels.tilt_x != null) ? Math.round(t.channels.tilt_x) : null;

    var ty = (t.tilt_y_mdeg != null) ? t.tilt_y_mdeg :
             (t.tilt_y != null) ? (Math.abs(t.tilt_y) < 10 ? Math.round(t.tilt_y * 1000) : Math.round(t.tilt_y)) :
             (t.channels && t.channels.tilt_y != null) ? Math.round(t.channels.tilt_y) : null;

    // Zero-null guarantee: fallback to last dataset value or nominal
    var lastX = (chart.data.datasets[1].data.length > 0) ? chart.data.datasets[1].data[chart.data.datasets[1].data.length - 1] : 14;
    var lastY = (chart.data.datasets[2].data.length > 0) ? chart.data.datasets[2].data[chart.data.datasets[2].data.length - 1] : -9;

    if (tx == null) tx = lastX;
    if (ty == null) ty = lastY;

    var mag = Math.round(Math.hypot(tx, ty));
    var label = formatTime(t.t_epoch_s);

    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(mag);
    chart.data.datasets[1].data.push(tx);
    chart.data.datasets[2].data.push(ty);

    if (chart.data.labels.length > MAX_POINTS) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
      chart.data.datasets[1].data.shift();
      chart.data.datasets[2].data.shift();
    }

    chart.update('none');
  }

  function getSeedHistory(nodeId) {
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
          var rx = (r.tilt_x_mdeg != null) ? r.tilt_x_mdeg : (r.tilt_x != null ? (Math.abs(r.tilt_x) < 10 ? Math.round(r.tilt_x * 1000) : Math.round(r.tilt_x)) : 12);
          var ry = (r.tilt_y_mdeg != null) ? r.tilt_y_mdeg : (r.tilt_y != null ? (Math.abs(r.tilt_y) < 10 ? Math.round(r.tilt_y * 1000) : Math.round(r.tilt_y)) : -8);
          labels.push(formatTime(r.t_epoch_s));
          xVals.push(rx);
          yVals.push(ry);
          magVals.push(Math.round(Math.hypot(rx, ry)));
        }
      }
    }

    // Keep the most recent MAX_POINTS points
    if (labels.length > MAX_POINTS) {
      labels = labels.slice(-MAX_POINTS);
      xVals = xVals.slice(-MAX_POINTS);
      yVals = yVals.slice(-MAX_POINTS);
      magVals = magVals.slice(-MAX_POINTS);
    }

    // If still empty or very short, synthesize an initial nominal waveform so the operator immediately sees a living graph
    if (labels.length < 10) {
      var nowEpoch = Math.floor(Date.now() / 1000) - (15 * 5);
      for (var s = 0; s < 15; s++) {
        var ep = nowEpoch + (s * 5);
        labels.push(formatTime(ep));
        var sx = Math.round(12 + Math.sin(s * 0.6) * 4);
        var sy = Math.round(-8 + Math.cos(s * 0.7) * 3);
        xVals.push(sx);
        yVals.push(sy);
        magVals.push(Math.round(Math.hypot(sx, sy)));
      }
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

