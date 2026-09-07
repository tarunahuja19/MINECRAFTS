'use strict';

var strainChart = (function () {
  var chart = null;
  var canvas = null;
  var LEVEL1_THRESHOLD = 500;
  var LEVEL2_THRESHOLD = 1500;
  var MAX_POINTS = 30;

  function init(containerId, nodeId, optTelemetry) {
    var container = document.getElementById(containerId);
    if (!container) return;

    destroy();

    var history = getSeedHistory(nodeId);
    if (history.labels.length === 0 && !optTelemetry) {
      container.innerHTML = '<div class="live-chart-empty-msg" style="display:flex;align-items:center;justify-content:center;height:100%;min-height:70px;font-family:Consolas,monospace;font-size:10px;color:#5A6E7C;letter-spacing:0.05em;">NO TELEMETRY RECORDED — NODE OFFLINE</div>';
      return;
    }

    container.innerHTML = '<canvas id="strain-canvas" style="width:100%;height:100%;display:block;"></canvas>';
    canvas = document.getElementById('strain-canvas');

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: history.labels,
        datasets: [
          {
            label: 'Strain (µε)',
            data: history.values,
            borderColor: '#00CC44',
            backgroundColor: 'rgba(0, 204, 68, 0.08)',
            borderWidth: 1.5,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0
          },
          {
            label: 'Warn (500)',
            data: history.labels.map(function () { return LEVEL1_THRESHOLD; }),
            borderColor: 'rgba(255, 165, 0, 0.65)',
            borderWidth: 1,
            borderDash: [4, 4],
            fill: false,
            pointRadius: 0,
            tension: 0
          },
          {
            label: 'Crit (1500)',
            data: history.labels.map(function () { return LEVEL2_THRESHOLD; }),
            borderColor: 'rgba(255, 34, 34, 0.75)',
            borderWidth: 1,
            borderDash: [3, 3],
            fill: false,
            pointRadius: 0,
            tension: 0
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
                return ' ' + ctx.dataset.label + ': ' + ctx.parsed.y + ' µε';
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
            suggestedMin: 0,
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

  function addPoint(t) {
    if (!t) return;
    if (!chart) {
      var container = document.getElementById('strain-chart-container');
      if (container) {
        init('strain-chart-container', t.node_id || t._node_id, t);
      }
      if (!chart) return;
    }

    var s = (t.strain_ustrain != null) ? t.strain_ustrain :
            (t.strain_ue != null) ? t.strain_ue :
            (t.strain != null) ? t.strain :
            (t.channels && t.channels.strain_ue != null) ? t.channels.strain_ue : null;

    // Zero-null guarantee: fallback to last dataset value or zero
    var lastVal = (chart.data.datasets[0].data.length > 0)
      ? chart.data.datasets[0].data[chart.data.datasets[0].data.length - 1]
      : 0;

    if (s == null) s = lastVal;
    s = Math.round(s);

    var label = formatTime(t.t_epoch_s);

    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(s);
    chart.data.datasets[1].data.push(LEVEL1_THRESHOLD);
    chart.data.datasets[2].data.push(LEVEL2_THRESHOLD);

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
    var values = [];

    var telemetry = (typeof fixtureProvider !== 'undefined' && fixtureProvider.getTelemetry)
      ? fixtureProvider.getTelemetry() : [];

    if (telemetry && telemetry.length > 0) {
      for (var i = 0; i < telemetry.length; i++) {
        var r = telemetry[i];
        if (r.node_id === nodeId) {
          var val = (r.strain_ustrain != null) ? r.strain_ustrain :
                    (r.strain_ue != null) ? r.strain_ue :
                    (r.strain != null) ? r.strain : null;
          if (val != null) {
            labels.push(formatTime(r.t_epoch_s));
            values.push(Math.round(val));
          }
        }
      }
    }

    if (labels.length > MAX_POINTS) {
      labels = labels.slice(-MAX_POINTS);
      values = values.slice(-MAX_POINTS);
    }

    return { labels: labels, values: values };
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

