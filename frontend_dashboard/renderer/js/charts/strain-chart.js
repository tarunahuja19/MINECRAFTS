'use strict';

var strainChart = (function () {
  var chart = null;
  var canvas = null;
  var LEVEL1_THRESHOLD = 400;
  var LEVEL2_THRESHOLD = 600;
  var MAX_POINTS = 288;

  function init(containerId, nodeId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<canvas id="strain-canvas"></canvas>';
    canvas = document.getElementById('strain-canvas');

    var history = getNodeHistory(nodeId, 'strain_ustrain');

    var l1Data = history.labels.map(function () { return LEVEL1_THRESHOLD; });
    var l2Data = history.labels.map(function () { return LEVEL2_THRESHOLD; });

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: history.labels,
        datasets: [
          {
            label: 'Strain (ustrain)',
            data: history.values,
            borderColor: getComputedStyle(document.documentElement).getPropertyValue('--chart-strain').trim() || '#00BFFF',
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
            tension: 0.25
          },
          {
            label: 'L1 ' + LEVEL1_THRESHOLD,
            data: l1Data,
            borderColor: getComputedStyle(document.documentElement).getPropertyValue('--alarm-level1').trim() || '#FFB300',
            borderWidth: 1,
            borderDash: [4, 4],
            fill: false,
            pointRadius: 0,
            tension: 0
          },
          {
            label: 'L2 ' + LEVEL2_THRESHOLD,
            data: l2Data,
            borderColor: getComputedStyle(document.documentElement).getPropertyValue('--alarm-level2').trim() || '#FF6600',
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
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              font: { family: 'Courier New', size: 9 },
              color: '#7A9BAA',
              boxWidth: 12,
              padding: 6
            }
          }
        },
        scales: {
          x: {
            display: true,
            ticks: {
              font: { family: 'Courier New', size: 9 },
              color: '#7A9BAA',
              maxTicksLimit: 6,
              maxRotation: 0
            },
            grid: {
              color: getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim() || '#1E3040'
            }
          },
          y: {
            display: true,
            suggestedMin: 0,
            title: {
              display: true,
              text: 'ustrain',
              font: { family: 'Courier New', size: 9 },
              color: '#7A9BAA'
            },
            ticks: {
              font: { family: 'Courier New', size: 9 },
              color: '#7A9BAA'
            },
            grid: {
              color: getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim() || '#1E3040'
            }
          }
        },
        layout: {
          padding: { top: 4, right: 4, bottom: 0, left: 0 }
        }
      }
    });
  }

  function addPoint(t) {
    if (!chart) return;
    var label = formatTime(t.t_epoch_s);
    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(t.strain_ustrain);
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

  function getNodeHistory(nodeId, field) {
    var labels = [];
    var values = [];
    var telemetry = fixtureProvider.getTelemetry();
    if (!telemetry) return { labels: labels, values: values };

    var now = telemetry.length > 0 ? telemetry[telemetry.length - 1].t_epoch_s : 0;
    var cutoff = now - 86400;

    for (var i = 0; i < telemetry.length; i++) {
      var r = telemetry[i];
      if (r.node_id === nodeId && r.t_epoch_s >= cutoff) {
        labels.push(formatTime(r.t_epoch_s));
        values.push(r[field]);
      }
    }
    return { labels: labels, values: values };
  }

  function formatTime(epochS) {
    var d = new Date(epochS * 1000);
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  }

  function destroy() {
    if (chart) { chart.destroy(); chart = null; }
  }

  return {
    init: init,
    addPoint: addPoint,
    destroy: destroy
  };
})();
