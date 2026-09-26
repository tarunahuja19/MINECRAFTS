'use strict';

/**
 * Selection Store Module
 * Holds the current spatial selection for 2D/3D map components.
 */
var selectionStore = (function () {
  // Two independent channels: 'sim' feeds FORGE/sandbox, '3d' feeds the 3D
  // view only. A selection on one channel never appears on the other.
  var channels = { sim: null, '3d': null };

  function normChannel(channel) {
    return (channel === '3d' || channel === 'td3') ? '3d' : 'sim';
  }

  function get(channel) {
    return channels[normChannel(channel)];
  }

  function set(data, channel) {
    var ch = normChannel(channel);
    if (!data) {
      clear(ch);
      return null;
    }

    var currentSelection = {
      id: data.id || data.sectorId || 'CUSTOM',
      channel: ch,
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
    var handled = { id: true, channel: true, bounds: true, center: true, latRange: true, lngRange: true, xRange: true, yRange: true, nodes: true };

    for (var key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key) && !handled[key]) {
        currentSelection[key] = data[key];
      }
    }

    channels[ch] = currentSelection;

    if (typeof bus !== 'undefined' && typeof bus.emit === 'function') {
      bus.emit('selection-changed', currentSelection);
    }

    return currentSelection;
  }

  function clear(channel) {
    if (channel === undefined || channel === null) {
      channels.sim = null;
      channels['3d'] = null;
    } else {
      channels[normChannel(channel)] = null;
    }
    if (typeof bus !== 'undefined' && typeof bus.emit === 'function') {
      bus.emit('selection-changed', null);
    }
  }

  function has(channel) {
    var sel = channels[normChannel(channel)];
    return sel !== null && sel !== undefined;
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
