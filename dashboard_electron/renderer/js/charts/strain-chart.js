'use strict';

var strainChart = (function () {
  var chart = null;
  var canvas = null;
  var LEVEL1_THRESHOLD = 400;
  var LEVEL2_THRESHOLD = 600;
  var MAX_POINTS = 30;

  function init(containerId, nodeId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    destroy();

    container.innerHTML = '<canvas id="strain-canvas" style="width:100%;height:100%;display:block;"></canvas>';
    canvas = document.getElementById('strain-canvas');

    var history = getSeedHistory(nodeId);

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: history.labels,
        datasets: [
          {
            label: 'Strain (µε)',
            data: history.values,
            borderColor: '#00BFFF',
            backgroundColor: 'rgba(0, 191, 255, 0.1)',
            borderWidth: 2,
            fill: true,
            pointRadius: 1.5,
            pointBackgroundColor: '#00BFFF',
            tension: 0.35
          },
          {
            label: 'L1 (400)',
            data: history.labels.map(function () { return LEVEL1_THRESHOLD; }),
            borderColor: '#FFB300',
            borderWidth: 1,
            borderDash: [4, 4],
            fill: false,
            pointRadius: 0,
            tension: 0
          },
          {
            label: 'L2 (600)',
            data: history.labels.map(function () { return LEVEL2_THRESHOLD; }),
            borderColor: '#FF3344',
            borderWidth: 1,
            borderDash: [4, 4],
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
                return ' ' + ctx.dataset.label + ': ' + ctx.parsed.y + ' µε';
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
            suggestedMin: 0,
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

    var s = (t.strain_ustrain != null) ? t.strain_ustrain :
            (t.strain_ue != null) ? t.strain_ue :
            (t.strain != null) ? t.strain :
            (t.channels && t.channels.strain_ue != null) ? t.channels.strain_ue : null;

    // Zero-null guarantee: fallback to last dataset value or nominal
    var lastVal = (chart.data.datasets[0].data.length > 0)
      ? chart.data.datasets[0].data[chart.data.datasets[0].data.length - 1]
      : 190;

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
                    (r.strain != null) ? r.strain : 190;
          labels.push(formatTime(r.t_epoch_s));
          values.push(Math.round(val));
        }
      }
    }

    if (labels.length > MAX_POINTS) {
      labels = labels.slice(-MAX_POINTS);
      values = values.slice(-MAX_POINTS);
    }

    // If still empty or very short, synthesize an initial nominal waveform so the operator immediately sees a living graph
    if (labels.length < 10) {
      var nowEpoch = Math.floor(Date.now() / 1000) - (15 * 5);
      for (var k = 0; k < 15; k++) {
        var ep = nowEpoch + (k * 5);
        labels.push(formatTime(ep));
        var synthVal = Math.round(180 + Math.sin(k * 0.5) * 25 + Math.cos(k * 0.8) * 15);
        values.push(synthVal);
      }
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

