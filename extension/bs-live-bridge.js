// bs-live-bridge.js — ISOLATED-world relay for bs-live-tap.js, injected
// beside it into a BrowserStack Live dashboard tab (background.js
// injectBsLiveTap, bridge first so the tap's first batch has a listener).
// Forwards the device-console lines and the DevTools state the tap posts to
// the worker. Its marker, __seleniteBsLive, differs from console-bridge.js's
// __selenite so neither bridge forwards the other's messages, and only
// messages this window posted to itself are accepted.
(function () {
  if (window.__seleniteBsBridge) return;
  window.__seleniteBsBridge = true;

  var STATES = { connected: true, closed: true, unsupported: true, attaching: true, unavailable: true, failed: true };

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__seleniteBsLive !== 1) return;
    var d = e.data;
    try {
      if (d.kind === 'lines' && Array.isArray(d.lines)) {
        chrome.runtime.sendMessage({ action: 'bsDeviceLog', lines: d.lines.slice(0, 200) }).catch(function () {});
      } else if (d.kind === 'state' && STATES[d.state]) {
        var m = { action: 'bsDeviceState', state: d.state, version: d.version ? String(d.version) : null };
        // Live's own words (why there is no DevTools), capped; and whether a
        // frame has waited for a device longer than it should.
        if (typeof d.reason === 'string' && d.reason) m.reason = d.reason.slice(0, 200);
        if (d.late === true) m.late = true;
        chrome.runtime.sendMessage(m).catch(function () {});
      }
    } catch (_) {
      // The extension was reloaded: this copy is orphaned and has nowhere to send.
    }
  });
})();
