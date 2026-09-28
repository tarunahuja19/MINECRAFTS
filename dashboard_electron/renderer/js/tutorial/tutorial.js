'use strict';

/**
 * Tutorial Engine for R4 Mine Subsidence Dashboard
 * Game-style onboarding walkthrough with spotlight cutouts and guided cards.
 */
var tutorial = (function () {
  var STORAGE_KEY = 'sih26.tutorial.v1';
  var steps = [];
  var currentIndex = -1;
  var navToken = 0;
  var active = false;
  var overlayEl = null;
  var spotlightEl = null;
  var cardEl = null;

  function isDone() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return false;
      return window.localStorage.getItem(STORAGE_KEY) === 'done';
    } catch (_) {
      return false;
    }
  }

  function markDone() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, 'done');
      }
    } catch (_) {}
  }

  function shouldAutoStart() {
    try {
      if (typeof window !== 'undefined') {
        var search = (window.location && window.location.search) || '';
        if (/[?&]tutorial=1\b/i.test(search)) return true;
        if (/[?&]tutorial=off\b/i.test(search)) return false;
        if (window.__TEST_BACKEND_PORT__) return false;
      }
      return !isDone();
    } catch (_) {
      return false;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildDOM() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'tutorial-overlay';
    overlayEl.className = 'tutorial-overlay';

    spotlightEl = document.createElement('div');
    spotlightEl.id = 'tutorial-spotlight';
    spotlightEl.className = 'tutorial-spotlight';
    spotlightEl.style.display = 'none';

    cardEl = document.createElement('div');
    cardEl.id = 'tutorial-card';
    cardEl.className = 'tutorial-card';
    cardEl.setAttribute('tabindex', '-1');

    overlayEl.appendChild(spotlightEl);
    overlayEl.appendChild(cardEl);

    // Block accidental click-through on backdrop/spotlight
    overlayEl.addEventListener('click', function (e) {
      if (cardEl && cardEl.contains(e.target)) return;
      e.stopPropagation();
    });

    document.body.appendChild(overlayEl);
  }

  function positionCard(step, targetEl) {
    if (!cardEl || !targetEl) return;

    var r = targetEl.getBoundingClientRect();
    var cardW = cardEl.offsetWidth || 320;
    var cardH = cardEl.offsetHeight || 160;
    var gap = 12;
    var screenPad = 16;
    var placement = step.placement || 'bottom';
    var top, left;

    var vpW = window.innerWidth || document.documentElement.clientWidth || 1920;
    var vpH = window.innerHeight || document.documentElement.clientHeight || 1080;

    if (placement === 'bottom') {
      top = r.bottom + gap;
      left = r.left + (r.width - cardW) / 2;
      if (top + cardH > vpH - screenPad) {
        if (r.top - cardH - gap >= screenPad) {
          top = r.top - cardH - gap;
        } else {
          top = Math.max(screenPad, r.top + gap + 10);
        }
      }
    } else if (placement === 'top') {
      top = r.top - cardH - gap;
      left = r.left + (r.width - cardW) / 2;
      if (top < screenPad) {
        if (r.bottom + cardH + gap <= vpH - screenPad) {
          top = r.bottom + gap;
        } else {
          top = Math.max(screenPad, r.top + gap + 10);
        }
      }
    } else if (placement === 'left') {
      left = r.left - cardW - gap;
      top = r.top + Math.min(40, (r.height - cardH) / 2);
      if (left < screenPad) {
        if (r.right + cardW + gap <= vpW - screenPad) {
          left = r.right + gap;
        }
      }
    } else if (placement === 'right') {
      left = r.right + gap;
      top = r.top + Math.min(40, (r.height - cardH) / 2);
      if (left + cardW > vpW - screenPad) {
        if (r.left - cardW - gap >= screenPad) {
          left = r.left - cardW - gap;
        }
      }
    } else {
      top = (vpH - cardH) / 2;
      left = (vpW - cardW) / 2;
    }

    left = Math.max(screenPad, Math.min(left, vpW - cardW - screenPad));
    top = Math.max(screenPad, Math.min(top, vpH - cardH - screenPad));

    cardEl.style.top = Math.round(top) + 'px';
    cardEl.style.left = Math.round(left) + 'px';
  }

  function renderCard(step, targetEl) {
    if (!cardEl) return;

    var isFirst = (currentIndex === 0);
    var isLast = (currentIndex === steps.length - 1);

    var counterText = isFirst
      ? 'WELCOME'
      : ('STEP ' + (currentIndex + 1) + ' OF ' + steps.length);

    var nextBtnText = isFirst
      ? 'Start tour'
      : (isLast ? 'Finish' : 'Next');

    var backBtnHtml = (!isFirst)
      ? '<button class="tutorial-btn tutorial-btn-back" id="tutorial-btn-back">Back</button>'
      : '';

    var skipBtnHtml = (!isLast)
      ? '<button class="tutorial-btn tutorial-btn-skip" id="tutorial-btn-skip">Skip</button>'
      : '<div></div>';

    cardEl.innerHTML =
      '<div class="tutorial-card-header">' +
        '<span class="tutorial-step-counter">' + counterText + '</span>' +
        '<button class="tutorial-close-btn" id="tutorial-btn-close" title="Skip tour" aria-label="Skip tour">×</button>' +
      '</div>' +
      '<div class="tutorial-card-body">' +
        '<h3 class="tutorial-card-title">' + escapeHtml(step.title) + '</h3>' +
        '<p class="tutorial-card-text">' + escapeHtml(step.body) + '</p>' +
      '</div>' +
      '<div class="tutorial-card-footer">' +
        skipBtnHtml +
        '<div class="tutorial-card-actions">' +
          backBtnHtml +
          '<button class="tutorial-btn tutorial-btn-primary" id="tutorial-btn-next">' + nextBtnText + '</button>' +
        '</div>' +
      '</div>';

    // Attach button listeners
    var btnClose = document.getElementById('tutorial-btn-close');
    if (btnClose) {
      btnClose.addEventListener('click', function (e) {
        e.preventDefault();
        skip();
      });
    }

    var btnSkip = document.getElementById('tutorial-btn-skip');
    if (btnSkip) {
      btnSkip.addEventListener('click', function (e) {
        e.preventDefault();
        skip();
      });
    }

    var btnBack = document.getElementById('tutorial-btn-back');
    if (btnBack) {
      btnBack.addEventListener('click', function (e) {
        e.preventDefault();
        goToStep(currentIndex - 1, -1);
      });
    }

    var btnNext = document.getElementById('tutorial-btn-next');
    if (btnNext) {
      btnNext.addEventListener('click', function (e) {
        e.preventDefault();
        if (isLast) {
          finish();
        } else {
          goToStep(currentIndex + 1, 1);
        }
      });
    }

    // Spotlight & positioning
    if (!targetEl) {
      spotlightEl.style.display = 'none';
      overlayEl.classList.add('tutorial-dimmed');
      cardEl.style.transform = 'translate(-50%, -50%)';
      cardEl.style.top = '50%';
      cardEl.style.left = '50%';
    } else {
      overlayEl.classList.remove('tutorial-dimmed');
      spotlightEl.style.display = 'block';
      cardEl.style.transform = 'none';

      var r = targetEl.getBoundingClientRect();
      var pad = 4;
      spotlightEl.style.top = Math.max(0, r.top - pad) + 'px';
      spotlightEl.style.left = Math.max(0, r.left - pad) + 'px';
      spotlightEl.style.width = (r.width + pad * 2) + 'px';
      spotlightEl.style.height = (r.height + pad * 2) + 'px';

      positionCard(step, targetEl);
    }

    try {
      cardEl.focus();
    } catch (_) {}
  }

  function goToStep(index, direction) {
    if (!active) return;
    if (typeof direction === 'undefined') direction = 1;

    if (index < 0) index = 0;
    if (index >= steps.length) {
      finish();
      return;
    }

    var step = steps[index];
    var token = ++navToken;

    // If step specifies a tab, switch to it
    if (step.tab) {
      var tabBtn = document.querySelector('.tab-btn[data-tab="' + step.tab + '"]');
      if (tabBtn && !tabBtn.classList.contains('active')) {
        tabBtn.click();
      }
    }

    // Allow CSS/tab transitions to complete before measuring target
    requestAnimationFrame(function () {
      setTimeout(function () {
        if (!active || token !== navToken) return;
        var targetEl = null;

        if (step.target) {
          targetEl = document.querySelector(step.target);
          if (!targetEl) {
            // Target not found: skip step silently
            goToStep(index + direction, direction);
            return;
          }
          var r = targetEl.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) {
            // Target has zero dimensions (hidden): skip silently
            goToStep(index + direction, direction);
            return;
          }
        }

        currentIndex = index;
        renderCard(step, targetEl);
      }, 50);
    });
  }

  function onKeyDown(e) {
    if (!active) return;
    var key = e.key;
    if (key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      skip();
    } else if (key === 'ArrowRight' || key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (currentIndex === steps.length - 1) {
        finish();
      } else {
        goToStep(currentIndex + 1, 1);
      }
    } else if (key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      if (currentIndex > 0) {
        goToStep(currentIndex - 1, -1);
      }
    }
  }

  function onResize() {
    if (!active || currentIndex < 0 || currentIndex >= steps.length) return;
    var step = steps[currentIndex];
    var targetEl = step.target ? document.querySelector(step.target) : null;
    if (targetEl) {
      var r = targetEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        var pad = 4;
        spotlightEl.style.top = Math.max(0, r.top - pad) + 'px';
        spotlightEl.style.left = Math.max(0, r.left - pad) + 'px';
        spotlightEl.style.width = (r.width + pad * 2) + 'px';
        spotlightEl.style.height = (r.height + pad * 2) + 'px';
        positionCard(step, targetEl);
      }
    }
  }

  function cleanup() {
    active = false;
    currentIndex = -1;
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKeyDown, true);

    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
    spotlightEl = null;
    cardEl = null;
  }

  function skip() {
    markDone();
    cleanup();
  }

  function finish() {
    markDone();
    cleanup();
  }

  function start(startIndex) {
    if (!steps || !steps.length) {
      if (typeof window !== 'undefined' && window.TUTORIAL_STEPS) {
        steps = window.TUTORIAL_STEPS;
      }
    }
    if (!steps || !steps.length) return;

    if (active) {
      cleanup();
    }

    active = true;
    buildDOM();
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKeyDown, true);
    goToStep(startIndex || 0, 1);
  }

  function init(customSteps) {
    if (customSteps && customSteps.length) {
      steps = customSteps;
    } else if (typeof window !== 'undefined' && window.TUTORIAL_STEPS) {
      steps = window.TUTORIAL_STEPS;
    }

    var helpBtn = document.getElementById('btn-tutorial-help');
    if (helpBtn) {
      helpBtn.addEventListener('click', function (e) {
        e.preventDefault();
        start();
      });
    }

    if (shouldAutoStart()) {
      setTimeout(function () {
        start();
      }, 800);
    }
  }

  return {
    init: init,
    start: start,
    skip: skip
  };
})();

if (typeof window !== 'undefined') {
  window.tutorial = tutorial;
}
