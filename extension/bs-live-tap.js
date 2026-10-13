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
//   - reports what DevTools is doing, so the status line can say so: closed,
//     connected (a device and a page to run in behind the frame), attaching
//     (a frame and no device yet, late after ~15 s; or a device whose page
//     context has not come up yet), nopage (a device but, for more than a few
//     scans, no page context: on iOS 26 Live attaches to an empty tab),
//     unavailable (Live has none for this device, with its reason), failed
//     (Live says it broke), unsupported (a frontend this doesn't know);
//   - runs the command input's expressions on the device through the same
//     frontend (__seleniteBsTap.eval), for background.js bsDeviceEval.
//
// It only listens and evaluates; the one thing it evaluates of its own accord is
// location.href, to tell an empty tab from a page (probePage). It never reads
// the iframe's src, whose wss= parameter carries a session token: the version
// shown in the status line comes from the frame's own location.pathname.
(function () {
  'use strict';
  if (window.__seleniteBsTap) { window.__seleniteBsTap.announce(); return; }

  var MARK = '__seleniteBsLive';
  var REPLAY_MAX = 200;   // a frame's existing messages, replayed once when it is hooked
  var BATCH_MAX = 50;
  var BATCH_MS = 200;
  var SCAN_MS = 1000;     // DevTools can be opened and closed at any time, each time a new iframe
  var HOOK_TRIES = 30;    // about 30 s for a frame's frontend to come up before it is "unsupported"
  var ATTACH_LATE = 15;   // scans a frame can sit without a device before "attaching" is called late
  var NO_ITEM_SCANS = 2;  // scans in a row a rendered toolbar must lack the DevTools item before that is believed
  var HOLD_SCANS = 8;     // scans an "unavailable" is kept while the whole toolbar is away (Live re-renders it, early in a session)
  var PAGE_GRACE = 3;     // scans a device may have no page context before that is believed (Android: 0.2 s after attaching, 0.1 s in a reload)
  var PROBE_EVERY = 10;   // scans between reads of which page a device with no page context is on
  var PROBE_MS = 5000;    // how long that read may take before it counts as unanswered
  var REASON_MAX = 200;

  var hooked = new WeakSet();
  var tries = new WeakMap();
  var waiting = new WeakMap();
  var noPage = new WeakMap();   // frame -> scans in a row with a device and no page context
  var probes = new WeakMap();   // frame -> what probePage last found
  var noItem = 0;
  var away = 0;
  var lastOff = null;
  var queue = [];
  var timer = null;
  var lastState = null;
  var lastName = null;

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

  function clip(s) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return s.length > REASON_MAX ? s.slice(0, REASON_MAX - 1) + '…' : s;
  }

  // Posted only when it changes; announce() clears the memory so a re-follow
  // of this tab, which resets the worker's status to "waiting", hears it again.
  // reason is Live's own words for why there is no DevTools (or why it broke);
  // late is "attaching" for longer than a device normally takes; page is what
  // probePage found for "nopage" ('blank' or 'other').
  function state(s, version, reason, late, page) {
    var key = s + '|' + (version || '') + '|' + (reason || '') + '|' + (late ? 1 : 0) + '|' + (page || '');
    lastName = s;
    if (key === lastState) return;
    lastState = key;
    var m = { kind: 'state', state: s, version: version || null };
    if (reason) m.reason = reason;
    if (late) m.late = true;
    if (page) m.page = page;
    post(m);
  }

  // Live's toolbar has a DevTools item in every phone and tablet session; for some
  // devices it is disabled (iOS 27: "Currently DevTools is unavailable for iOS 27.0 Safari",
  // and #devtools_message says why). Read from the dashboard page itself, not
  // the frame, because there is no frame to read when DevTools cannot open.
  // Measured on real sessions 2026-10-08: li.switchDevtools-menu-wrapper carries
  // aria-disabled="true" and the class toolbar-list-item--disabled when it is off,
  // aria-disabled="false" on Android.
  //
  // The toolbar does not sit still early in a session. Sampled every 100 ms on
  // iOS 27 and on Windows Chrome it was rendered, gone for about 4 s, and then
  // back for good. So what a reading says is kept while the toolbar is away
  // (HOLD_SCANS), and, until a toolbar with no DevTools item has been seen twice
  // in a row, the last verdict stands rather than flipping.
  function devtoolsOff() {
    try {
      var li = document.querySelector('li.switchDevtools-menu-wrapper');
      if (!li) {
        // A toolbar that has rendered with no DevTools item at all. Mac Safari and
        // Windows Chrome, Edge and Firefox all had eleven items and none for
        // DevTools (measured 2026-10-08), but this says only what was seen: a
        // phone's or tablet's toolbar that is part-way through rendering looks the
        // same for a moment, so it has to be seen on consecutive scans.
        if (document.querySelector('li.toolbar-list-item')) {
          away = 0;
          noItem++;
          if (noItem < NO_ITEM_SCANS) return lastOff;
          return (lastOff = { reason: 'its toolbar has no DevTools item (desktop browser sessions have none).' });
        }
        noItem = 0;
        if (lastOff && ++away <= HOLD_SCANS) return lastOff;
        lastOff = null;
        return null;
      }
      noItem = 0;
      away = 0;
      if (li.getAttribute('aria-disabled') !== 'true') { lastOff = null; return null; }
      var msg = document.querySelector('#devtools_message');
      var tip = document.querySelector('#tooltip-switchDevtools');
      // Live's own sentence, with the space it leaves out after "devices."
      return (lastOff = { reason: clip((msg && msg.textContent) || (tip && tip.textContent) || "Live's DevTools is unavailable for this device").replace(/([a-z0-9])\.([A-Z])/g, '$1. $2') });
    } catch (_) {
      return null;
    }
  }

  // Live's own notice when DevTools breaks after it opened (seen once, after
  // switching "Resolve all URLs through my network" mid-session). Matched on the
  // visible text, since where it is drawn was not measured.
  var FAILED_RE = /Developer tools have experienced an unexpected issue[^.]*\.(?:\s*Please[^.]*\.)?/i;
  function devtoolsFailed() {
    try {
      var t = document.body && document.body.innerText;
      var m = t && FAILED_RE.exec(t);
      return m ? clip(m[0]) : null;
    } catch (_) {
      return null;
    }
  }

  // Whether a frame's frontend has a device to talk to. Live's frame can be on
  // screen with its console model up and no target at all (the DevTools
  // websocket never attached: 2 of 5 real Android sessions, 2026-10-08), and then there
  // is nothing to read and nothing to run commands on. A frontend that gives no
  // way to ask is assumed attached.
  function attachedTo(w) {
    try {
      var tm = w && w.SDK && w.SDK.targetManager;
      if (tm && typeof tm.targets === 'function') return tm.targets().length > 0;
    } catch (_) {}
    return true;
  }

  // The script context commands run in: the one Live's DevTools has selected,
  // the page's. null when it has none, undefined when the frontend gives no way
  // to ask (then, as in attachedTo, a page is assumed). Measured on real sessions
  // 2026-10-13: on a Galaxy S26 the context is selected 0.2 s after the device
  // attaches and is gone for 0.1 s during a reload; on an iPhone 17 (iOS 26.5 and
  // 26.6) Chrome DevTools attaches to the device and never gets one, because the
  // tab it is on is about:blank, Safari's empty Start Page.
  function contextOf(w) {
    try {
      var EC = w.SDK.ExecutionContext || (w.SDK.RuntimeModel && w.SDK.RuntimeModel.ExecutionContext);
      if (!EC || !w.UI || !w.UI.context || typeof w.UI.context.flavor !== 'function') return undefined;
      return w.UI.context.flavor(EC) || null;
    } catch (_) {
      return undefined;
    }
  }

  // Which page a device with no page context is on: location.href, read through
  // the target's runtime agent, which answers without a selected context (it
  // returned "about:blank" on the iPhone 17 and the page's URL on the Galaxy S26).
  // 'blank' for about:blank or nothing, 'other' for a real page, null if it could
  // not be read. Read once the context has been missing for PAGE_GRACE scans and
  // every PROBE_EVERY scans after that, in case the tab is navigated; an answer
  // that does not come leaves the last one standing.
  function probePage(f, w, n) {
    var p = probes.get(f);
    if (p && (p.pending || n - p.at < PROBE_EVERY)) return p;
    if (!p) { p = { pending: false, done: false, page: null, at: n }; probes.set(f, p); }
    p.at = n;
    var agent = null;
    try {
      var t = w.SDK.targetManager.targets()[0];
      agent = t && typeof t.runtimeAgent === 'function' ? t.runtimeAgent() : null;
    } catch (_) {}
    if (!agent || typeof agent.invoke_evaluate !== 'function') { p.done = true; return p; }
    p.pending = true;
    var settled = false;
    function finish(page) {
      if (settled) return;
      settled = true;
      p.pending = false;
      if (page || !p.done) p.page = page;
      p.done = true;
    }
    setTimeout(function () { finish(null); }, PROBE_MS);
    try {
      Promise.resolve(agent.invoke_evaluate({ expression: 'location.href', returnByValue: true })).then(function (r) {
        var v = r && !r.wasThrown && !r.exceptionDetails && r.result && r.result.type === 'string' ? r.result.value : null;
        finish(v == null ? null : (v === '' || /^about:/i.test(v) ? 'blank' : 'other'));
      }, function () { finish(null); });
    } catch (_) {
      finish(null);
    }
    return p;
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
    if (!fs.length) {
      var off = devtoolsOff();
      var failed = !off && devtoolsFailed();
      if (off) state('unavailable', null, off.reason);
      else if (failed) state('failed', null, failed);
      else state('closed');
      return;
    }
    fs.forEach(hook);
    var live = fs.filter(function (f) { return hooked.has(f); })[0];
    if (live) {
      var w = frontendOf(live);
      if (attachedTo(w)) {
        waiting.delete(live);
        if (contextOf(w) !== null) { noPage.delete(live); probes.delete(live); state('connected', versionOf(live)); return; }
        // A device, and no page to run in. Briefly that is a device still
        // attaching or a page reloading, so a session already connected stays
        // so; past PAGE_GRACE it is believed, and said once the page is read.
        var k = (noPage.get(live) || 0) + 1;
        noPage.set(live, k);
        if (k <= PAGE_GRACE) {
          if (lastName !== 'connected') state('attaching', versionOf(live));
          return;
        }
        var p = probePage(live, w, k);
        if (p.done) state('nopage', versionOf(live), '', false, p.page);
        return;
      }
      noPage.delete(live);
      probes.delete(live);
      // Hooked, so the replay and the subscription are in place for whenever a
      // device does attach, but until then there is nothing to mirror.
      var n = (waiting.get(live) || 0) + 1;
      waiting.set(live, n);
      var broke = devtoolsFailed();
      if (broke) state('failed', versionOf(live), broke);
      else state('attaching', versionOf(live), '', n >= ATTACH_LATE);
      return;
    }
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
    if (w && !attachedTo(w)) {
      return Promise.resolve({ ok: false, error: "Live's DevTools is open but hasn't attached to the device. Close and reopen it in Live, then try again." });
    }
    var ctx = w ? contextOf(w) : null;
    if (!ctx || typeof ctx.evaluate !== 'function') {
      var p = probes.get(f);
      if (p && p.page === 'blank') {
        return Promise.resolve({ ok: false, error: "Live's DevTools is attached to an empty tab (about:blank), not the page under test, so there is nothing to run this on." });
      }
      return Promise.resolve({ ok: false, error: 'The device page has no script context yet. Wait for it to load, or reload it on the device, then try again.' });
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
