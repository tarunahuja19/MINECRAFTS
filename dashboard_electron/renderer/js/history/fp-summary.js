'use strict';

var fpSummary = (function () {
  var container = null;

  function init(containerId) {
    container = document.getElementById(containerId);
    if (!container) return;

    bus.on('alarms-loaded', function () { render(); });
    render();
  }

  function render() {
    var alarms = fixtureProvider.getAlarms() || [];
    if (!container) return;

    var totalAlarms = alarms.length;
    var blastCorrelated = 0;
    var truePositives = 0;
    var falsePositives = 0;

    for (var i = 0; i < alarms.length; i++) {
      var a = alarms[i];
      if (a.blast_correlated) {
        blastCorrelated++;
        falsePositives++;
      } else {
        truePositives++;
      }
    }

    var fpRate = totalAlarms > 0 ? ((falsePositives / totalAlarms) * 100).toFixed(1) : '0.0';
    var tpRate = totalAlarms > 0 ? ((truePositives / totalAlarms) * 100).toFixed(1) : '0.0';

    container.innerHTML =
      '<table class="data-table fp-summary-table">' +
        '<thead><tr>' +
          '<th>METRIC</th>' +
          '<th>COUNT</th>' +
          '<th>RATE</th>' +
        '</tr></thead>' +
        '<tbody>' +
          '<tr>' +
            '<td>TOTAL ALARMS (90-DAY)</td>' +
            '<td class="mono">' + totalAlarms + '</td>' +
            '<td class="mono">--</td>' +
          '</tr>' +
          '<tr>' +
            '<td>BLAST-CORRELATED</td>' +
            '<td class="mono">' + blastCorrelated + '</td>' +
            '<td class="mono">' + (totalAlarms > 0 ? ((blastCorrelated / totalAlarms) * 100).toFixed(1) : '0.0') + '%</td>' +
          '</tr>' +
          '<tr class="fp-row-good">' +
            '<td>TRUE POSITIVES</td>' +
            '<td class="mono">' + truePositives + '</td>' +
            '<td class="mono">' + tpRate + '%</td>' +
          '</tr>' +
          '<tr class="fp-row-bad">' +
            '<td>FALSE POSITIVES (BLAST)</td>' +
            '<td class="mono">' + falsePositives + '</td>' +
            '<td class="mono">' + fpRate + '%</td>' +
          '</tr>' +
        '</tbody>' +
      '</table>' +
      '<div class="fp-verdict">' +
        (falsePositives === 0
          ? '<span class="fp-good">SYSTEM ACCURACY: ' + tpRate + '% TRUE POSITIVE RATE — NO FALSE POSITIVES DETECTED</span>'
          : '<span class="fp-warn">FALSE POSITIVE RATE: ' + fpRate + '% — ' + falsePositives + ' BLAST-CORRELATED ALARM(S) FILTERED</span>'
        ) +
      '</div>';
  }

  return { init: init };
})();
