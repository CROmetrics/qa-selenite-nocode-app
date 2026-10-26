// A whole-worker harness: the REAL background.js, run as a service worker would run
// it, against a fake page and a scripted model. Loaded by queue-agent.test.js with
// jsc's load(), so it defines globals and nothing else.
//
// WHY WHOLE. The Function Queue's agent engine is mostly wiring: runQueue decides
// when to heal, crawlSegment decides how to end, the console mirror and the agent
// fight over one debugger session, and a Stop can land mid-heal. None of that is a
// pure function. Slicing out helpers tests the helpers; this tests the thing that
// breaks. Each makeWorld() is a fresh worker with its own module state (every
// top-level let/const is local to one `new Function` call), so calling it twice
// against the same storage simulates an MV3 restart.
//
// What is fake, and where it stops being true:
//   - the page is a small model: elements with rects, a z-order, click handlers, a
//     focus, typing, native <select>s, and the DOM surface the injected functions
//     actually touch. It has no layout engine, no real events, no iframes and no
//     shadow DOM, and querySelector understands only #id .class tag [name="v"].
//   - the model is a script of replies: it never "looks" at the screenshot, so a
//     test says what the agent does, and asserts what the worker did with it.
//   - the screenshot is 4 bytes and decodeDataUrl fails, so the worker falls back to
//     its own viewport numbers: a 1000x800 image of a 1000x800 viewport, scale 1.
//   - time is virtual: setTimeout, setInterval and Date are all one clock.

(function () {
  var g = (typeof globalThis === 'object') ? globalThis : this;

  // ── a chrome that answers anything ─────────────────────────────────────────
  // Any property is another proxy, any call returns one, and `then` is undefined so
  // awaiting one does not hang. Overlay real behaviour with deep(obj).
  function deep(base) {
    var target = base || function () {};
    return new Proxy(target, {
      get: function (t, k) {
        if (k === 'then') return undefined;
        if (k === Symbol.toPrimitive) return function () { return ''; };
        if (k in t) return t[k];
        if (typeof k === 'symbol') return undefined;
        var d = deep(); t[k] = d; return d;
      },
      apply: function () { return deep(); },
    });
  }

  // ── a page ─────────────────────────────────────────────────────────────────
  function matches(el, sel) {
    // #id  .cls  tag  tag.cls  tag#id  [name="v"]  tag[name="v"]
    var m = /^([a-zA-Z0-9]+)?(?:#([\w-]+))?((?:\.[\w-]+)*)(?:\[(\w+)="([^"]*)"\])?$/.exec(String(sel).trim());
    if (!m) return false;
    if (m[1] && el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
    if (m[2] && el.id !== m[2]) return false;
    if (m[3]) {
      var need = m[3].split('.').filter(Boolean);
      for (var i = 0; i < need.length; i++) if (el.classList.indexOf(need[i]) === -1) return false;
    }
    if (m[4] && String(el.getAttribute(m[4])) !== m[5]) return false;
    return !!(m[1] || m[2] || m[3] || m[4]);
  }

  var INTERACTIVE = ['a', 'button', 'input', 'select', 'textarea', 'label', 'summary'];

  function makePage(cfg) {
    var page = {
      url: cfg.url, title: cfg.title || 'Page', bodyText: cfg.bodyText || '',
      els: [], focus: null, observers: [], listeners: { click: [], input: [] }, log: [],
      viewport: cfg.viewport || { w: 1000, h: 800 },
    };
    var bodyEl = { tagName: 'BODY', nodeType: 1 };
    Object.defineProperty(bodyEl, 'innerText', { get: function () { return page.bodyText; } });
    page.body = bodyEl;

    function El(spec) {
      this.tagName = String(spec.tag || 'div').toUpperCase();
      this.id = spec.id || '';
      this.nodeType = 1;
      this.classList = (spec.cls || []).slice();
      this.name = spec.name || null;
      this.type = spec.type || null;
      this.disabled = !!spec.disabled;
      this.rect = spec.rect || { x: 0, y: 0, w: 10, h: 10 };
      this.text = spec.text || '';
      this.attrs = spec.attrs || {};
      this.onClick = spec.onClick || null;
      this.onEnter = spec.onEnter || null;
      this.parentElement = spec.parent || null;
      this.shadowRoot = null;
      this.contentDocument = {};
      this.isContentEditable = !!spec.editable;
      this.position = spec.position || 'static';
      this.options = spec.options || null;
      this.selectedIndex = spec.options ? (spec.selectedIndex || 0) : -1;
      this._value = spec.value == null ? '' : spec.value;
      this.selectedAll = false;
      this.rejects = !!spec.rejects;   // a field that swallows typed input
      this.multiple = false;
      this.events = [];
    }
    Object.defineProperty(El.prototype, 'value', {
      get: function () { return this.options ? (this.options[this.selectedIndex] || {}).value : this._value; },
      set: function (v) {
        if (this.options) { for (var i = 0; i < this.options.length; i++) if (this.options[i].value === v) { this.selectedIndex = i; return; } }
        else this._value = v;
      },
    });
    Object.defineProperty(El.prototype, 'innerText', { get: function () { return this.text; } });
    El.prototype.getAttribute = function (n) {
      if (n === 'name') return this.name;
      if (n === 'aria-disabled') return this.attrs['aria-disabled'] == null ? null : this.attrs['aria-disabled'];
      return this.attrs[n] == null ? null : this.attrs[n];
    };
    El.prototype.getBoundingClientRect = function () {
      var r = this.rect;
      return { left: r.x, top: r.y, width: r.w, height: r.h, right: r.x + r.w, bottom: r.y + r.h, x: r.x, y: r.y };
    };
    El.prototype.closest = function (q) {
      var parts = String(q).split(',').map(function (s) { return s.trim(); });
      for (var n = this; n; n = n.parentElement) {
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i];
          if (INTERACTIVE.indexOf(p) !== -1 ? n.tagName.toLowerCase() === p
              : p === '[aria-hidden="true"]' ? n.attrs['aria-hidden'] === 'true'
              : p === 'form' ? n.tagName === 'FORM'
              : /^\[/.test(p) ? false : matches(n, p)) return n;
        }
      }
      return null;
    };
    El.prototype.focus = function () { page.focus = this; };
    El.prototype.scrollIntoView = function () {};
    El.prototype.dispatchEvent = function (e) { this.events.push(e && e.type); return true; };
    El.prototype.click = function () { page.deliverClick(this); };
    El.prototype.select = function () { this.selectedAll = true; };

    page.add = function (spec) {
      var el = new El(spec);
      page.els.push(el);
      return el;
    };
    page.mutate = function (type) {
      page.observers.slice().forEach(function (o) { o.cb([{ type: type || 'childList' }]); });
    };
    // The element a click at (x,y) reaches: the last one added that covers it.
    page.stackAt = function (x, y) {
      return page.els.filter(function (e) {
        var r = e.rect; return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
      }).reverse();
    };
    page.deliverClick = function (el) {
      page.log.push('click:' + (el.id || el.tagName));
      page.listeners.click.slice().forEach(function (fn) { fn({ target: el }); });
      if (el.onClick) el.onClick(page, el);
    };
    // A navigation is a NEW DOCUMENT: the old one's listeners, observers, focus and the
    // probe state the worker stored on its window all go with it (measured in Chrome
    // 154: the post-action probe of a click that navigated reads delivered:null).
    page.navigate = function (url, title, text) {
      page.mutate('childList');   // the old document sees its own teardown...
      page.url = url; if (title != null) page.title = title; if (text != null) page.bodyText = text;
      page.log.push('navigate:' + url);
      page.listeners = { click: [], input: [] };
      page.observers = [];
      page.focus = null;
      page.window.__seleniteCrawlProbe = null;
      page.window.__seleniteCrawlProbeStop = null;
    };
    page.find = function (sel) {
      for (var i = 0; i < page.els.length; i++) if (matches(page.els[i], sel)) return page.els[i];
      return null;
    };

    page.window = {
      innerWidth: page.viewport.w, innerHeight: page.viewport.h,
      addEventListener: function (t, fn) { (page.listeners[t] = page.listeners[t] || []).push(fn); },
      removeEventListener: function (t, fn) { page.listeners[t] = (page.listeners[t] || []).filter(function (f) { return f !== fn; }); },
    };
    page.document = {
      body: bodyEl, documentElement: { nodeType: 1 },
      elementsFromPoint: function (x, y) { return page.stackAt(x, y); },
      elementFromPoint: function (x, y) { return page.stackAt(x, y)[0] || null; },
      querySelector: function (sel) { return page.find(sel); },
      getElementById: function (id) { return page.find('#' + id); },
    };
    Object.defineProperty(page.document, 'activeElement', { get: function () { return page.focus || bodyEl; } });
    Object.defineProperty(page.document, 'title', { get: function () { return page.title; } });
    page.location = {};
    Object.defineProperty(page.location, 'href', { get: function () { return page.url; } });

    // The CDP input path: a mouse press lands on the top element at the point; a
    // char goes to the focused field (replacing it if it was select()ed); a key
    // is Enter in the focused field.
    page.mouse = function (p) {
      if (p.type !== 'mousePressed') return;
      var top = page.stackAt(p.x, p.y)[0];
      page.log.push('mouse@' + p.x + ',' + p.y + '->' + (top ? (top.id || top.tagName) : 'nothing'));
      if (top) { page.deliverClick(top); if (/^(input|textarea)$/i.test(top.tagName)) page.focus = top; }
    };
    page.char = function (text) {
      var el = page.focus;
      if (!el || el.options) { page.log.push('char:nowhere'); return; }
      if (el.rejects) { page.log.push('char:rejected'); return; }   // a field that swallows input
      if (el.selectedAll) { el._value = ''; el.selectedAll = false; }
      el._value += text;
      page.listeners.input.slice().forEach(function (fn) { fn({ target: el }); });
    };
    page.key = function (p) {
      if (p.type === 'rawKeyDown' && p.key === 'Enter' && page.focus && page.focus.onEnter) page.focus.onEnter(page, page.focus);
    };

    // Run an injected function the way executeScript would: in the page, with the
    // page's globals. Only the synchronous part sees them.
    page.run = function (func, args) {
      var names = ['window', 'document', 'location', 'MutationObserver', 'getComputedStyle', 'HTMLSelectElement',
                   'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'KeyboardEvent', 'MouseEvent'];
      var had = {}; names.forEach(function (n) { had[n] = g[n]; });
      g.window = page.window; g.document = page.document; g.location = page.location;
      g.MutationObserver = function (cb) { this.cb = cb; this.observe = function () { page.observers.push(this); };
                                           this.disconnect = function () { page.observers = page.observers.filter(function (o) { return o !== this; }, this); }; };
      g.getComputedStyle = function (el) { return { position: el.position || 'static', pointerEvents: 'auto' }; };
      g.HTMLSelectElement = El; g.HTMLInputElement = El; g.HTMLTextAreaElement = El;
      g.Event = function (t) { this.type = t; }; g.KeyboardEvent = g.Event; g.MouseEvent = g.Event;
      try { return func.apply(null, args || []); }
      finally { names.forEach(function (n) { g[n] = had[n]; }); }
    };
    return page;
  }

  // ── a world: clock, storage, tabs, debugger, model, one worker ─────────────
  function makeWorld(cfg) {
    cfg = cfg || {};
    var w = {
      clock: { now: 1750000000000, timers: [], seq: 0 },
      store: cfg.store || { session: {}, local: {}, sync: cfg.apiKey === false ? {} : { anthropicApiKey: 'sk-test' } },
      held: {}, calls: [], requests: [], tabUpdates: [], replies: [], listeners: [], tabListeners: [], sets: [],
      page: cfg.page || makePage({ url: 'https://shop.example/' }),
      tab: { id: 1, windowId: 1, active: true, status: 'complete', url: null },
    };
    w.tab.url = w.page.url;
    Object.defineProperty(w.tab, 'url', { get: function () { return w.page.url; }, enumerable: true });

    var clock = w.clock;
    function setT(fn, ms) { var id = ++clock.seq; clock.timers.push({ id: id, at: clock.now + (ms || 0), fn: fn }); return id; }
    function clearT(id) { clock.timers = clock.timers.filter(function (t) { return t.id !== id; }); }
    function setI(fn, ms) {
      var id = ++clock.seq;
      var t = { id: id, at: clock.now + ms, fn: function () { t.at = clock.now + ms; clock.timers.push(t); fn(); } };
      clock.timers.push(t); return id;
    }
    var RealDate = Date;
    function VDate() {
      if (arguments.length) return new (Function.prototype.bind.apply(RealDate, [null].concat([].slice.call(arguments))))();
      return new RealDate(clock.now);
    }
    VDate.now = function () { return clock.now; };
    VDate.prototype = RealDate.prototype;
    w.at = function (ms, fn) { setT(fn, ms); };

    function pickKeys(obj, keys) {
      if (keys == null) return Object.assign({}, obj);
      var arr = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : null);
      var out = {};
      if (arr) arr.forEach(function (k) { if (k in obj) out[k] = obj[k]; });
      else Object.keys(keys).forEach(function (k) { out[k] = (k in obj) ? obj[k] : keys[k]; });
      return out;
    }
    function area(name) {
      var a = {
        get: function (keys, cb) { var r = pickKeys(w.store[name], keys); if (cb) { cb(r); return undefined; } return Promise.resolve(r); },
        set: function (o, cb) { w.sets.push(name + ':' + Object.keys(o).join(',') + (name === 'session' && 'w1:running' in o ? '=' + o['w1:running'] : '')); Object.assign(w.store[name], JSON.parse(JSON.stringify(o))); if (cb) { cb(); return undefined; } return Promise.resolve(); },
        remove: function (keys) { [].concat(keys).forEach(function (k) { delete w.store[name][k]; }); return Promise.resolve(); },
        onChanged: deep(),
      };
      return deep(a);
    }

    var chrome = deep({
      runtime: deep({
        onMessage: { addListener: function (fn) { w.listeners.push(fn); }, removeListener: function () {} },
        getPlatformInfo: function (cb) { w.calls.push(['getPlatformInfo']); if (cb) cb({}); return Promise.resolve({}); },
        getURL: function (p) { return 'chrome-extension://x/' + p; },
      }),
      storage: deep({ session: area('session'), local: area('local'), sync: area('sync') }),
      tabs: deep({
        onUpdated: { addListener: function (fn) { w.tabListeners.push(fn); }, removeListener: function (fn) { w.tabListeners = w.tabListeners.filter(function (f) { return f !== fn; }); } },
        get: function (id, cb) {
          var r = id === w.tab.id ? w.tab : null;
          if (cb) { cb(r); return undefined; }
          return r ? Promise.resolve(r) : Promise.reject(new Error('No tab with id: ' + id + '.'));
        },
        update: function (id, props) { w.tabUpdates.push(props); return Promise.resolve(w.tab); },
        query: function () { return Promise.resolve([w.tab]); },
        create: function () { return Promise.resolve(w.tab); },
        remove: function () { return Promise.resolve(); },
      }),
      scripting: deep({
        executeScript: function (opts) {
          if (!opts.func) return Promise.resolve([]);          // injectCapture(files)
          if (w.scriptFails && w.scriptFails(opts)) return Promise.reject(new Error(w.scriptFails(opts)));
          // REAL CHROME DOES NOT REJECT WHEN THE INJECTED FUNCTION THROWS. Measured in
          // Chrome 154 against this extension: a sync throw, an async throw, a rejected
          // promise, a thrown string and a ReferenceError all resolve as
          // [{documentId, frameId, result: null}], with no `error` key. This harness
          // used to reject, which is how every "not found" test passed for a step that
          // could never have failed in a browser.
          var r = null;
          try { r = w.page.run(opts.func, opts.args); }
          catch (e) { return Promise.resolve([{ documentId: 'd', frameId: 0, result: null }]); }
          if (r && typeof r.then === 'function') {
            return r.then(function (v) { return [{ documentId: 'd', frameId: 0, result: v === undefined ? null : v }]; },
                          function () { return [{ documentId: 'd', frameId: 0, result: null }]; });
          }
          return Promise.resolve([{ documentId: 'd', frameId: 0, result: r === undefined ? null : r }]);
        },
      }),
      debugger: deep({
        attach: function (t) {
          w.calls.push(['attach', t.tabId]);
          if (w.held[t.tabId]) return Promise.reject(new Error('Another debugger is already attached to the tab with id: ' + t.tabId + '.'));
          w.held[t.tabId] = true; return Promise.resolve();
        },
        detach: function (t) { w.calls.push(['detach', t.tabId]); delete w.held[t.tabId]; return Promise.resolve(); },
        sendCommand: function (t, method, params) {
          w.calls.push([method, t.tabId]);
          if (!w.held[t.tabId]) return Promise.reject(new Error('Debugger is not attached to the tab with id: ' + t.tabId + '.'));
          if (w.cdpFails && w.cdpFails(method)) return Promise.reject(new Error(w.cdpFails(method)));
          switch (method) {
            case 'Page.getLayoutMetrics': return Promise.resolve({ cssVisualViewport: { clientWidth: w.page.viewport.w, clientHeight: w.page.viewport.h } });
            case 'Page.captureScreenshot': return Promise.resolve({ data: 'AAAA' });
            case 'Input.dispatchMouseEvent': w.page.mouse(params); return Promise.resolve({});
            case 'Input.dispatchKeyEvent':
              if (params.type === 'char') w.page.char(params.text); else w.page.key(params);
              return Promise.resolve({});
            default: return Promise.resolve({});
          }
        },
      }),
    });
    w.chrome = chrome;

    // The model. Replies are consumed in order; a function reply gets the request.
    var fakeFetch = function (url, init) {
      if (!/api\.anthropic\.com/.test(String(url))) return Promise.reject(new Error('not a fetchable url: ' + String(url).slice(0, 20)));
      var body = JSON.parse(init.body);
      w.requests.push(body);
      if (w.onRequest) w.onRequest(body, w.requests.length);
      var r = w.replies.shift();
      if (r === undefined) return Promise.reject(new Error('the model script ran out at request ' + w.requests.length));
      if (typeof r === 'function') r = r(body);
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(r); } });
    };
    w.fetch = fakeFetch;

    // Reply builders.
    w.click = function (x, y, text) { return { stop_reason: 'tool_use', content: (text ? [{ type: 'text', text: text }] : []).concat([{ type: 'tool_use', id: 'tu' + (++clock.seq), name: 'computer', input: { action: 'left_click', coordinate: [x, y] } }]) }; };
    w.type = function (text) { return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu' + (++clock.seq), name: 'computer', input: { action: 'type', text: text } }] }; };
    w.report = function (status, summary, blocker) {
      return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu' + (++clock.seq), name: 'report_result', input: { status: status, summary: summary || 'done', blocker: blocker } }] };
    };
    w.say = function (text) { return { stop_reason: 'end_turn', content: [{ type: 'text', text: text }] }; };

    // ── booting the worker ──
    w.boot = function () {
      var had = { fetch: g.fetch, AC: g.AbortController };
      g.fetch = fakeFetch;
      g.AbortController = function () {
        this.signal = { aborted: false, addEventListener: function () {}, removeEventListener: function () {} };
        this.abort = function () { this.signal.aborted = true; };
      };
      w.restore = function () { g.fetch = had.fetch; g.AbortController = had.AC; };
      var self = deep({ addEventListener: function () {} });
      var fn = new Function('chrome', 'importScripts', 'self', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date', readFile(w.src || '../background.js'));
      fn(chrome, function () {}, self, setI, clearT, setT, clearT, VDate);
      drainMicrotasks();
      return w;
    };

    w.send = function (msg) {
      var out = { done: false, res: undefined, returned: undefined };
      // From the panel: the worker refuses run, stop and status from anything but an extension page.
      out.returned = w.listeners[0](msg, { url: 'chrome-extension://x/sidepanel.html', tab: { id: w.tab.id } }, function (r) { out.done = true; out.res = r; });
      return out;
    };

    // Advance the virtual clock until pred() holds (or nothing is left to wait for).
    w.settle = function (pred, maxTicks) {
      var n = 0, limit = maxTicks || 20000;
      while (n++ < limit) {
        drainMicrotasks();
        if (pred && pred()) return true;
        if (!clock.timers.length) { drainMicrotasks(); return pred ? !!pred() : true; }
        clock.timers.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
        var t = clock.timers.shift();
        clock.now = Math.max(clock.now, t.at);
        t.fn();
      }
      throw new Error('settle(): still going after ' + limit + ' timer ticks');
    };

    // The per-window keys the worker writes under ("w1:running").
    w.session = function (key) { return w.store.session['w1:' + key]; };
    w.finished = function () { return w.session('running') === false; };
    w.logs = function () { return (w.session('logs') || []).map(function (l) { return l.level + ' ' + l.text; }); };

    // One queue run, start to end.
    w.run = function (queue, extra) {
      var payload = Object.assign({ queue: queue, mode: 'close', targetTabId: 1, universalDelay: { enabled: false, seconds: '1' },
                                    winId: 1, trackMetricsForRun: false, engine: 'classic' }, extra || {});
      delete w.store.session['w1:running'];   // a second run in one world must not read the first's "done"
      var r = w.send({ action: 'run', payload: payload });
      w.settle(function () { return w.finished(); });
      return { response: r, record: w.session('queueRun') };
    };
    w.funnel = function (waypoints) {
      var r = w.send({ action: 'runFunnelCrawl', payload: { waypoints: waypoints, supplementalPrompt: '', winId: 1 } });
      w.settle(function () { return r.done; });
      return r.res;
    };
    return w;
  }

  g.QA_HARNESS = { makeWorld: makeWorld, makePage: makePage, deep: deep };
})();
