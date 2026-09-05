'use strict';

var bus = (function () {
  var listeners = {};

  function on(event, cb) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(cb);
  }

  function off(event, cb) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(function (fn) { return fn !== cb; });
  }

  function emit(event, data) {
    if (!listeners[event]) return;
    for (var i = 0; i < listeners[event].length; i++) {
      try { listeners[event][i](data); } catch (e) { console.error('[bus]', event, e); }
    }
  }

  return { on: on, off: off, emit: emit };
})();
