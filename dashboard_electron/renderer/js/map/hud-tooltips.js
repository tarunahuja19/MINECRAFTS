'use strict';

/**
 * hud-tooltips.js
 *
 * One small custom tooltip, shared across every HUD control on the 2D map
 * (AERIAL, TOPO, 3D, GRID, LABELS, SURFACE, the HEATMAP trigger, and its
 * dropdown items). Replaces the native `title` attribute, which is slow to
 * appear and styled by the OS, not the HUD theme — those controls now carry
 * `data-tip` instead so only one themed tooltip element ever needs to exist.
 */
(function () {
  var SHOW_DELAY_MS = 250;
  var tipEl = null;
  var showTimer = null;
  var activeTarget = null;

  function findTarget(el) {
    // el.closest is unavailable on plain text nodes, but mouseover/mouseout
    // targets are always Elements, so this is safe without a guard.
    return el.closest('[data-tip]');
  }

  function positionTip(target) {
    var container = tipEl.parentElement;
    if (!container) return;
    var containerRect = container.getBoundingClientRect();
    var targetRect = target.getBoundingClientRect();

    var top = targetRect.bottom - containerRect.top + 6;
    var left = targetRect.left - containerRect.left;

    // Keep the ~220px-wide tooltip from overflowing the right edge of the map.
    var maxLeft = containerRect.width - 220 - 4;
    if (left > maxLeft) left = Math.max(4, maxLeft);

    tipEl.style.top = top + 'px';
    tipEl.style.left = left + 'px';
  }

  function show(target) {
    var text = target.getAttribute('data-tip');
    if (!text) return;
    tipEl.textContent = text;
    tipEl.style.display = 'block';
    positionTip(target);
  }

  function hide() {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    activeTarget = null;
    if (tipEl) tipEl.style.display = 'none';
  }

  function handleMouseOver(e) {
    var target = findTarget(e.target);
    if (!target || target === activeTarget) return;
    hide();
    activeTarget = target;
    showTimer = setTimeout(function () {
      if (activeTarget === target) show(target);
    }, SHOW_DELAY_MS);
  }

  function handleMouseOut(e) {
    var target = findTarget(e.target);
    if (!target || target !== activeTarget) return;
    // Moving between a target's own children (e.g. the name/desc spans inside
    // a dropdown item) must not flicker the tooltip closed and reopen it.
    if (e.relatedTarget && target.contains(e.relatedTarget)) return;
    hide();
  }

  function init() {
    var container = document.getElementById('map-container');
    if (!container) return;

    tipEl = document.createElement('div');
    tipEl.className = 'hud-tooltip';
    tipEl.style.display = 'none';
    container.appendChild(tipEl);

    // Delegated from the container: covers the dropdown items and every HUD
    // button without attaching a listener per control.
    container.addEventListener('mouseover', handleMouseOver);
    container.addEventListener('mouseout', handleMouseOut);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
