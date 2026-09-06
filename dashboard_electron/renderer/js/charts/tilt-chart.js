'use strict';

var tiltChart = (function () {
  var chart = null;
  var canvas = null;
  var MAX_POINTS = 288;

  function init(containerId, nodeId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<canvas id="tilt-canvas"></canvas>';
    canvas = document.getElementById('tilt-canvas');

    var historyX = getNodeHistory(nodeId, 'tilt_x_mdeg');
    var historyY = getNodeHistory(nodeId, 'tilt_y_mdeg');
    var historyTemp = getNodeHistory(nodeId, 'temp_c_x10');

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: historyX.labels,
        datasets: [
          {
            label: 'Tilt X (mdeg)',
            data: historyX.values,
            borderColor: getComputedStyle(document.documentElement).getPropertyValue('--chart-tilt-x').trim() || '#FF8C00',
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
            tension: 0.25
          },
          {
            label: 'Tilt Y (mdeg)',
            data: historyY.values,
            borderColor: getComputedStyle(document.documentElement).getPropertyValue('--chart-tilt-y').trim() || '#FFD700',
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
            tension: 0.25
          },
          {
            label: 'Temp drift',
            data: historyTemp.values.map(function (v) { return v / 10; }),
            borderColor: getComputedStyle(document.documentElement).getPropertyValue('--chart-projection').trim() || '#AAAAAA',
            borderWidth: 1,
            borderDash: [3, 3],
            fill: false,
            pointRadius: 0,
            tension: 0.25,
            yAxisID: 'y1'
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
            position: 'left',
            title: {
              display: true,
              text: 'mdeg',
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
          },
          y1: {
            display: true,
            position: 'right',
            title: {
              display: true,
              text: 'C',
              font: { family: 'Courier New', size: 9 },
              color: '#AAAAAA'
            },
            ticks: {
              font: { family: 'Courier New', size: 9 },
              color: '#AAAAAA'
            },
            grid: { display: false }
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
    // Chart.js renders null as a gap in the line, which is the honest
    // rendering for a channel this node's tier does not carry.
    chart.data.datasets[0].data.push(t.tilt_x_mdeg != null ? t.tilt_x_mdeg : null);
    chart.data.datasets[1].data.push(t.tilt_y_mdeg != null ? t.tilt_y_mdeg : null);
    chart.data.datasets[2].data.push(t.temp_c_x10 != null ? t.temp_c_x10 / 10 : null);
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
