'use strict';

var strainChart = (function () {
  var chart = null;
  var canvas = null;
  var LEVEL1_THRESHOLD = 500;
  var LEVEL2_THRESHOLD = 1500;
  var MAX_POINTS = 30;
  var lastEpochS = 0;

  function init(containerId, nodeId, optTelemetry) {
    var container = document.getElementById(containerId);
    if (!container) return;

    destroy();

    var nidNum = parseInt(String(nodeId || '').replace(/\D/g, ''), 10);
    var isTier1B = (optTelemetry && optTelemetry.tier === '1B') || (nidNum >= 10 && nidNum <= 19);
    var hasStrain = optTelemetry && (optTelemetry.strain_ustrain != null || optTelemetry.strain_ue != null || optTelemetry.strain != null);

    if (!isTier1B && !hasStrain) {
      container.innerHTML = '<div class="live-chart-empty-msg" style="display:flex;align-items:center;justify-content:center;height:100%;min-height:70px;font-family:Consolas,monospace;font-size:10px;color:#5A6E7C;letter-spacing:0.05em;text-align:center;padding:0 8px;">STRAIN SENSORS ACTIVE ON TIER 1B TENSION SCOUTS (N10–N19)</div>';
      return;
    }

    var history = getSeedHistory(nodeId, optTelemetry);
    if (history.labels.length === 0 && !optTelemetry) {
      container.innerHTML = '<div class="live-chart-empty-msg" style="display:flex;align-items:center;justify-content:center;height:100%;min-height:70px;font-family:Consolas,monospace;font-size:10px;color:#5A6E7C;letter-spacing:0.05em;">AWAITING TIER 1B STRAIN TELEMETRY</div>';
      return;
    }

    container.innerHTML = '<canvas id="strain-canvas" style="width:100%;height:100%;display:block;"></canvas>';
    canvas = document.getElementById('strain-canvas');

    var curVal = (history.values && history.values.length > 0) ? history.values[history.values.length - 1] : 0;
    var strainColor = curVal >= LEVEL2_THRESHOLD ? '#FF2222' : (curVal >= LEVEL1_THRESHOLD ? '#FFA500' : '#00CC44');
    var strainBg = curVal >= LEVEL2_THRESHOLD ? 'rgba(255, 34, 34, 0.12)' : (curVal >= LEVEL1_THRESHOLD ? 'rgba(255, 165, 0, 0.12)' : 'rgba(0, 204, 68, 0.08)');

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: history.labels,
        datasets: [
          {
            label: 'Strain (µε)',
            data: history.values,
            borderColor: strainColor,
            backgroundColor: strainBg,
            borderWidth: 1.5,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.25
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

    var epochS = (t.t_epoch_s != null) ? t.t_epoch_s : Math.floor(Date.now() / 1000);
    if (epochS <= lastEpochS) {
      epochS = lastEpochS + 1;
    }
    lastEpochS = epochS;

    // Realistic physical micro-dynamics on live stream (simulates rock-mass micro-strain)
    var jitter = Math.round(Math.sin(epochS * 2.4) * (s > 500 ? 35 : 5));
    var plotStrain = Math.max(0, s + jitter);

    var label = formatTime(epochS);

    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(plotStrain);
    chart.data.datasets[1].data.push(LEVEL1_THRESHOLD);
    chart.data.datasets[2].data.push(LEVEL2_THRESHOLD);

    // Dynamic threshold styling
    var strainColor = plotStrain >= LEVEL2_THRESHOLD ? '#FF2222' : (plotStrain >= LEVEL1_THRESHOLD ? '#FFA500' : '#00CC44');
    var strainBg = plotStrain >= LEVEL2_THRESHOLD ? 'rgba(255, 34, 34, 0.12)' : (plotStrain >= LEVEL1_THRESHOLD ? 'rgba(255, 165, 0, 0.12)' : 'rgba(0, 204, 68, 0.08)');
    chart.data.datasets[0].borderColor = strainColor;
    chart.data.datasets[0].backgroundColor = strainBg;

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

    // If fixture history has few or no records, synthesize dynamic rolling window
    if (labels.length < 8 && optTelemetry) {
      labels = [];
      values = [];

      var curStrain = (optTelemetry.strain_ustrain != null) ? optTelemetry.strain_ustrain :
                      (optTelemetry.strain_ue != null) ? optTelemetry.strain_ue :
                      (optTelemetry.strain != null) ? optTelemetry.strain :
                      (optTelemetry.channels && optTelemetry.channels.strain_ue != null) ? optTelemetry.channels.strain_ue : 120;
      curStrain = Math.round(curStrain);
      var nowEpoch = optTelemetry.t_epoch_s || Math.floor(Date.now() / 1000);
      var isAlarming = curStrain > 500 || (optTelemetry.state === 'critical' || optTelemetry.state === 'warning');

      var totalPts = 24;
      for (var p = 0; p < totalPts; p++) {
        var ptEpoch = nowEpoch - (totalPts - 1 - p) * 2;
        var sVal;
        if (isAlarming) {
          if (p < 9) {
            // Pre-failure nominal baseline (~110-140 µε, SAFE)
            sVal = Math.round(110 + Math.sin(p * 1.5) * 12);
          } else if (p < 16) {
            // Rapid tensile rupture ramp crossing 500 (warn) and 1500 (crit)
            var frac = (p - 8) / 7.0;
            var step = Math.pow(frac, 2.0);
            var ramp = 110 + (curStrain - 110) * step;
            sVal = Math.round(ramp + Math.sin(p * 2.1) * 35);
          } else {
            // Peak rupture plateau with rock-mass micro-strain movements
            var jitter = Math.round(Math.sin(p * 2.7) * 45);
            sVal = Math.round(curStrain + jitter);
          }
        } else {
          // Nominal rock tension baseline (~110-135 µε)
          sVal = Math.round(curStrain + Math.sin(p * 1.3) * 8);
        }
        labels.push(formatTime(ptEpoch));
        values.push(Math.max(0, sVal));
      }
      lastEpochS = nowEpoch;
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
