'use strict';

var knotheChart = (function () {
  var chart = null;
  var canvas = null;

  function init(containerId, alarm) {
    var container = document.getElementById(containerId);
    if (!container || !alarm) return;

    container.innerHTML = '<canvas id="knothe-canvas"></canvas>';
    canvas = document.getElementById('knothe-canvas');

    var projection = alarm.projection || {};
    var daysToL3 = projection.days_to_level_3 || 0;
    var confidence = projection.confidence || 0;

    var histDays = 30;
    var totalDays = histDays + Math.max(daysToL3, 5);
    var labels = [];
    var strainData = [];
    var projData = [];
    var todayIdx = histDays;

    var L1 = 400;
    var L2 = 600;
    var L3 = 800;

    var currentStrain = alarm.level === 1 ? 450 : alarm.level === 2 ? 700 : 850;

    for (var i = 0; i <= totalDays; i++) {
      var dayLabel = i - histDays;
      labels.push(dayLabel <= 0 ? 'D' + dayLabel : '+' + dayLabel);

      if (i <= histDays) {
        var t = i / histDays;
        var val = 200 + (currentStrain - 200) * (t * t);
        strainData.push(Math.round(val));
        projData.push(null);
      } else {
        strainData.push(null);
        var projT = (i - histDays) / Math.max(daysToL3, 1);
        var projVal = currentStrain + (L3 - currentStrain) * Math.min(projT, 1.5);
        projData.push(Math.round(projVal));
      }
    }

    var thresholdData = labels.map(function () { return L3; });
    var todayData = labels.map(function (l, idx) { return idx === todayIdx ? L3 + 100 : null; });

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Strain',
            data: strainData,
            borderColor: '#00BFFF',
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
            tension: 0,
            spanGaps: false
          },
          {
            label: 'Projection',
            data: projData,
            borderColor: '#AAAAAA',
            borderWidth: 1.5,
            borderDash: [4, 3],
            fill: false,
            pointRadius: 0,
            tension: 0,
            spanGaps: false
          },
          {
            label: 'L3 ' + L3,
            data: thresholdData,
            borderColor: '#FF2222',
            borderWidth: 1,
            borderDash: [4, 4],
            fill: false,
            pointRadius: 0,
            tension: 0
          },
          {
            label: 'TODAY',
            data: todayData,
            borderColor: '#FFD700',
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
            tension: 0,
            showLine: true,
            segment: {
              borderDash: [2, 2]
            }
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
              font: { family: 'Courier New', size: 8 },
              color: '#7A9BAA',
              boxWidth: 10,
              padding: 4
            }
          }
        },
        scales: {
          x: {
            display: true,
            ticks: {
              font: { family: 'Courier New', size: 8 },
              color: '#7A9BAA',
              maxTicksLimit: 6,
              maxRotation: 0
            },
            grid: { color: '#1E3040' }
          },
          y: {
            display: true,
            title: {
              display: true,
              text: 'ustrain',
              font: { family: 'Courier New', size: 8 },
              color: '#7A9BAA'
            },
            ticks: {
              font: { family: 'Courier New', size: 8 },
              color: '#7A9BAA'
            },
            grid: { color: '#1E3040' }
          }
        },
        layout: {
          padding: { top: 2, right: 2, bottom: 0, left: 0 }
        }
      }
    });
  }

  function destroy() {
    if (chart) { chart.destroy(); chart = null; }
  }

  return {
    init: init,
    destroy: destroy
  };
})();
