'use strict';

/**
 * Selection Store Module
 * Holds the current spatial selection for 2D/3D map components.
 */
var selectionStore = (function () {
  var currentSelection = null;

  function get() {
    return currentSelection;
  }

  function set(data) {
    if (!data) {
      clear();
      return null;
    }

    currentSelection = {
      id: data.id || 'CUSTOM',
      bounds: data.bounds || null,
      center: data.center || null,
      latRange: data.latRange || null,
      lngRange: data.lngRange || null,
      xRange: data.xRange || null,
      yRange: data.yRange || null,
      nodes: Array.isArray(data.nodes) ? data.nodes.slice() : []
    };

    // Keys already normalized above — the generic copy below must not
    // clobber them with shared references (notably `nodes`).
    var handled = { id: true, bounds: true, center: true, latRange: true, lngRange: true, xRange: true, yRange: true, nodes: true };

    for (var key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key) && !handled[key]) {
        currentSelection[key] = data[key];
      }
    }

    if (typeof bus !== 'undefined' && typeof bus.emit === 'function') {
      bus.emit('selection-changed', currentSelection);
    }

    return currentSelection;
  }

  function clear() {
    currentSelection = null;
    if (typeof bus !== 'undefined' && typeof bus.emit === 'function') {
      bus.emit('selection-changed', null);
    }
  }

  function has() {
    return currentSelection !== null && currentSelection !== undefined;
  }

  if (typeof bus !== 'undefined' && typeof bus.on === 'function') {
    bus.on('system-reset', function () {
      clear();
    });
    bus.on('grid-selected', function (cellData) {
      if (cellData && cellData.bounds) {
        set(cellData);
      }
    });
  }

  return {
    get: get,
    set: set,
    clear: clear,
    has: has
  };
})();

if (typeof window !== 'undefined') {
  window.selectionStore = selectionStore;
}
