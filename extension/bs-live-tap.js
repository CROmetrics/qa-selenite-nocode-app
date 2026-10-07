// bs-live-tap.js — injected into the MAIN world of a BrowserStack Live
// dashboard tab while Selenite captures it (background.js injectBsLiveTap).
//
// Live's DevTools, the panel its toolbar opens for iOS Safari and Android
// Chrome, is a same-origin iframe holding a pinned Chrome DevTools frontend
// (/devtools/realios/91.0.4472.101/inspector.html, and realdroid for Android,
// measured 2026-10-06). Its console model is where the device's console
// arrives. This file:
//   - relays that model's messages, the device's console, to
//     bs-live-bridge.js (ISOLATED world), which forwards them to the worker;
//   - reports whether DevTools is open, so the status line can say so;
//   - runs the command input's expressions on the device through the same
//     frontend (__seleniteBsTap.eval), for background.js bsDeviceEval.
//
// It only listens and evaluates. It never reads the iframe's src, whose wss=
// parameter carries a session token: the version shown in the status line
// comes from the frame's own location.pathname.
(function () {
  'use strict';
  if (window.__seleniteBsTap) { window.__seleniteBsTap.announce(); return; }

  var MARK = '__seleniteBsLive';
  var REPLAY_MAX = 200;   // a frame's existing messages, replayed once when it is hooked
  var BATCH_MAX = 50;
  var BATCH_MS = 200;
  var SCAN_MS = 1000;     // DevTools can be opened and closed at any time, each time a new iframe
  var HOOK_TRIES = 30;    // about 30 s for a frame's frontend to come up before it is "unsupported"

  var hooked = new WeakSet();
  var tries = new WeakMap();
  var queue = [];
  var timer = null;
  var lastState = null;

  function post(msg) {
    msg[MARK] = 1;
    window.postMessage(msg, location.origin);
  }

  function flush() {
    timer = null;
    if (!queue.length) return;
    var lines = queue;
    queue = [];
    post({ kind: 'lines', lines: lines });
  }

  function emit(line) {
    queue.push(line);
    if (queue.length >= BATCH_MAX) flush();
    else if (!timer) timer = setTimeout(flush, BATCH_MS);
  }

  // Posted only when it changes; announce() clears the memory so a re-follow
  // of this tab, which resets the worker's status to "waiting", hears it again.
  function state(s, version) {
    var key = s + '|' + (version || '');
    if (key === lastState) return;
    lastState = key;
    post({ kind: 'state', state: s, version: version || null });
  }

  function frames() {
    return Array.prototype.slice.call(document.querySelectorAll('iframe.devtools-iframe'));
  }

  function frontendOf(f) {
    try {
      var w = f.contentWindow;
      return w && w.SDK ? w : null;
    } catch (_) {
      return null;
    }
  }

  // "realios 91.0.4472.101", from the frame's own path, never its query.
  function versionOf(f) {
    try {
      var m = /\/devtools\/([^/]+)\/([^/]+)\//.exec(f.contentWindow.location.pathname);
      return m ? m[1] + ' ' + m[2] : null;
    } catch (_) {
      return null;
    }
  }

  function consoleModel(w) {
    var CM = w && w.SDK && w.SDK.ConsoleModel;
    if (!CM || typeof CM.instance !== 'function' || !CM.Events || !CM.Events.MessageAdded) return null;
    var cm = CM.instance();
    return cm && typeof cm.addEventListener === 'function' && typeof cm.messages === 'function' ? cm : null;
  }

  function unserializable(o) {
    try {
      return typeof o.unserializableValue === 'function' ? o.unserializableValue() : o.unserializableValue;
    } catch (_) {
      return null;
    }
  }

  // One console argument, as the worker's formatRemoteArg reads a local one.
  // The frontend's RemoteObjects expose value/description as getters, so
  // `'value' in o` is always true here: go by type instead.
  function argText(o) {
    if (o == null) return '';
    if (typeof o !== 'object') return String(o);
    var u = unserializable(o);
    if (u) return String(u);
    if (o.type === 'string') return String(o.value);
    if (o.type === 'undefined') return 'undefined';
    if (o.subtype === 'null') return 'null';
    if (o.type === 'number' || o.type === 'boolean' || o.type === 'bigint') {
      return String(o.value !== undefined ? o.value : o.description);
    }
    return String(o.description || o.type || '');
  }

  // An evaluation result, as the worker's formatEvalResult reads a local one.
  function resultText(o) {
    if (!o || o.type === 'undefined') return 'undefined';
    if (o.subtype === 'null') return 'null';
    var u = unserializable(o);
    if (u) return String(u);
    if (o.type === 'function') {
      var m = String(o.description || '').match(/^(?:function\s*\*?\s*|get\s+|set\s+|class\s+|async\s+)*([\w$]*)/);
      return 'ƒ ' + ((m && m[1]) || '') + '()';
    }
    if (o.type === 'string') return JSON.stringify(o.value);
    if (o.type === 'number' || o.type === 'boolean' || o.type === 'bigint' || o.type === 'symbol') {
      return String(o.value !== undefined ? o.value : o.description);
    }
    var pv = o.preview;
    if (pv && Array.isArray(pv.properties)) {
      var props = pv.properties.map(function (p) {
        return p.name + ': ' + (p.value !== undefined && p.value !== null ? p.value : p.type);
      }).join(', ');
      var more = pv.overflow ? ', …' : '';
      return o.subtype === 'array' ? '[' + props + more + ']' : (o.className || o.subtype || o.type) + ' {' + props + more + '}';
    }
    return String(o.description || o.type || 'undefined');
  }

  // console.log's arguments joined, with %c styling dropped together with
  // the CSS arguments it consumes, as the worker does for a local tab.
  // Anything that is not a console call (an exception, a failed request)
  // carries its text in messageText.
  function textOf(m) {
    var params = Array.isArray(m.parameters) ? m.parameters : null;
    if (m.source === 'console-api' && params && params.length) {
      var first = params[0];
      var firstText = first && typeof first === 'object' ? (first.type === 'string' ? String(first.value) : null) : (typeof first === 'string' ? first : null);
      if (firstText != null && firstText.indexOf('%c') > -1) {
        var css = (firstText.match(/%c/g) || []).length;
        return [firstText.replace(/%c/g, '').trim()].concat(params.slice(1 + css).map(argText)).join(' ').trim();
      }
      return params.map(argText).join(' ');
    }
    return String(m.messageText == null ? '' : m.messageText);
  }

  function lineOf(m) {
    return {
      level: m.level || null,
      type: m.type || null,
      source: m.source || null,
      text: textOf(m),
    };
  }

  function hook(f) {
    if (hooked.has(f)) return;
    var w = frontendOf(f);
    var cm = consoleModel(w);
    if (!cm) {
      tries.set(f, (tries.get(f) || 0) + 1);
      return;
    }
    hooked.add(f);
    var existing = [];
    try { existing = cm.messages() || []; } catch (_) {}
    existing.slice(-REPLAY_MAX).forEach(function (m) { emit(lineOf(m)); });
    cm.addEventListener(w.SDK.ConsoleModel.Events.MessageAdded, function (e) {
      try { emit(lineOf(e.data)); } catch (_) {}
    });
  }

  // Every scan states where things are; state() posts only changes.
  function scan() {
    var fs = frames();
    if (!fs.length) { state('closed'); return; }
    fs.forEach(hook);
    var live = fs.filter(function (f) { return hooked.has(f); })[0];
    if (live) { state('connected', versionOf(live)); return; }
    var stuck = fs.filter(function (f) { return (tries.get(f) || 0) >= HOOK_TRIES; })[0];
    if (stuck) state('unsupported', versionOf(stuck));
    // Otherwise a frame is still coming up: the worker's "waiting" stands.
  }

  // The selected execution context in Live's DevTools is the page under test
  // (the default top frame unless the user picked another in Live's own
  // console), the same place a command typed there would run.
  function evaluate(expr) {
    var f = frames()[0];
    if (!f) return Promise.resolve({ ok: false, error: 'Open DevTools in the Live session first. Selenite runs commands through it.' });
    var w = frontendOf(f);
    var EC = w && (w.SDK.ExecutionContext || (w.SDK.RuntimeModel && w.SDK.RuntimeModel.ExecutionContext));
    var ctx = null;
    try { ctx = EC && w.UI && w.UI.context && w.UI.context.flavor(EC); } catch (_) {}
    if (!ctx || typeof ctx.evaluate !== 'function') {
      return Promise.resolve({ ok: false, error: 'The device page has no script context yet. Wait for it to load, then try again.' });
    }
    var options = {
      expression: String(expr), objectGroup: 'selenite', includeCommandLineAPI: true,
      silent: false, returnByValue: false, generatePreview: true,
    };
    return Promise.resolve(ctx.evaluate(options, true, true)).then(function (r) {
      if (!r || r.error) return { ok: false, error: String((r && r.error) || 'The device did not answer.') };
      if (r.exceptionDetails) {
        var d = r.exceptionDetails;
        var text = (r.object && r.object.description) || (d.exception && d.exception.description) || d.text || 'Error';
        return { ok: true, exception: true, text: String(text).split('\n')[0] };
      }
      var out = { ok: true, text: resultText(r.object) };
      try { if (r.object && typeof r.object.release === 'function') r.object.release(); } catch (_) {}
      return out;
    }, function (e) {
      return { ok: false, error: String((e && e.message) || e) };
    });
  }

  window.__seleniteBsTap = {
    announce: function () { lastState = null; scan(); },
    scan: scan,
    eval: evaluate,
  };
  setInterval(scan, SCAN_MS);
  scan();
})();
