'use strict';

var blastTest = (function () {
  var containerId = null;
  var cooldown = false;

  function init(targetId) {
    containerId = targetId;
    render();
  }

  function render() {
    var container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML =
      '<button class="btn btn-blast-test" id="blast-test-btn">' +
        'TEST — BLAST INJECTION' +
      '</button>' +
      '<span class="blast-test-result mono" id="blast-test-result"></span>';

    document.getElementById('blast-test-btn').addEventListener('click', function () {
      if (cooldown) return;
      fireTest();
    });
  }

  function fireTest() {
    var btn = document.getElementById('blast-test-btn');
    var result = document.getElementById('blast-test-result');
    if (!btn || !result) return;

    cooldown = true;
    btn.disabled = true;
    result.textContent = 'SENDING...';
    result.className = 'blast-test-result mono warning';

    setTimeout(function () {
      result.textContent = 'RESULT: SUPPRESSED (test mode)';
      result.className = 'blast-test-result mono';

      bus.emit('dispatch-event', {
        t: Date.now(),
        tier: 1,
        outcome: 'SUPPRESSED'
      });

      setTimeout(function () {
        cooldown = false;
        btn.disabled = false;
        result.textContent = '';
        result.className = 'blast-test-result mono';
      }, 3000);
    }, 1500);
  }

  return { init: init };
})();
