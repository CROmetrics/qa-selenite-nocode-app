// qk-worker suite: the REAL background.js run end to end for the two kit modes (ITW Activation, Responsiveness), against a
// faked Chrome. The worker's qkw* section builds the `io` object the modes run on (plan §3.1); the mode suites
// (itw-activation.test.js, responsiveness.test.js) prove the logic on a FAKE io (tests/qk-fake-io.js), and this suite proves the
// real io honours the same contract: the fake and the real agree.
//
//   RUN:  cd extension/tests && jsc qk-worker.test.js
//
// DATA RULE. Public repo: hosts 127.0.0.1 only, experiment ids 7xxx, tickets QK-<n>. Nothing real.
//
// How the page is faked (and where it stops being true):
//   - chrome.debugger.sendCommand answers the CDP calls the worker makes: Page.navigate (a load event 5 virtual ms later,
//     frameId 'F1'), add/removeScriptToEvaluateOnNewDocument (tracked), Network.getCookies (always the same three names:
//     optimizelyEndUserId, qk_quiz_progress, session), Network.deleteCookies, Input.dispatchMouseEvent (recorded; a
//     mouseReleased at the coordinates the fake qkClickTargetFn returned applies the site's click), Page.captureScreenshot (a
//     distinct valid base64 per capture, recorded with the URL of the last Page.navigate and the width of the last
//     setDeviceMetricsOverride) and Emulation.* (recorded).
//   - chrome.scripting.executeScript answers by func.name from the S3 site models (QK_FAKE.sites.itw / resp), and resolves
//     {result:null} for a scenario's nullFns, as Chrome 154 does for a function that throws. Nothing here rejects for a throw.
//   - OffscreenCanvas / createImageBitmap / Blob are stubs that record what was drawn and, as Chrome does, keep a typed-array
//     or string Blob part as bytes and any other part (a plain array) as its String() text (A20). createImageBitmap rejects
//     unless the blob's bytes are exactly one capture's bytes, and the bitmap it returns is tagged with that capture.
//   - time is virtual (the harness clock); nothing sleeps for real.
//
// Every section runs inside T(), so a throw (a bug) is ONE failure and the next section still runs.

globalThis.URL = function URL(u) {
  var m = /^(https?:)\/\/([^\/?#]+)/.exec(String(u));
  if (!m) throw new TypeError('Invalid URL');
  this.protocol = m[1]; this.origin = m[1] + '//' + m[2];
};
load('queue-agent-harness.js');
var WORKER_SRC = readFile('../background.js');
var IMPORTS = [];
(function () {
  var m = /importScripts\(([^)]*)\)/.exec(WORKER_SRC);
  if (!m) throw new Error('importScripts line not found in background.js');
  IMPORTS = m[1].match(/'[^']+'/g).map(function (s) { return s.slice(1, -1); });
  IMPORTS.forEach(function (f) { load('../' + f); });
})();
load('qk-fake-io.js');

// The booted worker's internals are local to one `new Function`, so the boot source gets one extra line that hands the two
// functions this suite calls directly to the global (qkwCompose, buildTestAgentSummaryPrompt). Everything else is the file.
var rawReadFile = readFile;
readFile = function (p) {
  var s = rawReadFile.apply(this, arguments);
  return p === '../background.js' ? s + '\n;globalThis.__QKW = { qkwCompose: qkwCompose, buildTestAgentSummaryPrompt: buildTestAgentSummaryPrompt };\n' : s;
};

// ── harness ────────────────────────────────────────────────────────────────
var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 300) : ''));
}
function eq(name, actual, expected) { ok(name, actual === expected, { actual: actual, expected: expected }); }
function jeq(name, actual, expected) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(name, a === e, { actual: a, expected: e });
}
function section(t) { print('\n' + t); }
function T(title, fn) {
  section(title);
  var p0 = pass, f0 = fail;
  try { fn(); } catch (e) { fail++; failures.push(title + '  THREW ' + String(e && e.message ? e.message : e).slice(0, 300)); }
  print('  [' + (pass - p0) + ' passed, ' + (fail - f0) + ' failed]');
}
function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
function count(arr, pred) { return arr.filter(pred).length; }

var B = QK_FAKE.base;
var WK_FLAG = /optimizely_force_tracking|_conv_eforce/;
var CAP_URL_NAV = null;

// ── the canvas / blob / bitmap stubs (A20) ─────────────────────────────────
var CURRENT = null;          // the world whose captures createImageBitmap may decode
var CANVASES = [], BITMAPS = [];
function utf8(s) {
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
globalThis.Blob = function Blob(parts, o) {
  var bytes = [];
  (parts || []).forEach(function (p) {
    if (p instanceof ArrayBuffer) p = new Uint8Array(p);
    if (ArrayBuffer.isView(p)) { for (var i = 0; i < p.length; i++) bytes.push(p[i]); }
    else if (typeof p === 'string') bytes = bytes.concat(utf8(p));
    else bytes = bytes.concat(utf8(String(p)));        // a plain array becomes its text, "255,216,255"
  });
  this.bytes = bytes;
  this.type = (o && o.type) || '';
  this.size = bytes.length;
};
Blob.prototype.arrayBuffer = function () { return Promise.resolve(new Uint8Array(this.bytes).buffer); };
function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
globalThis.createImageBitmap = function (blob) {
  var caps = (CURRENT && CURRENT.caps) || [];
  var cap = null;
  for (var i = 0; i < caps.length; i++) if (sameBytes(caps[i].bytes, blob && blob.bytes)) { cap = caps[i]; break; }
  if (!cap) return Promise.reject(new Error('The source image could not be decoded.'));
  var bmp = { tag: cap, closed: false, close: function () { this.closed = true; } };
  BITMAPS.push(bmp);
  return Promise.resolve(bmp);
};
globalThis.OffscreenCanvas = function OffscreenCanvas(w, h) {
  var rec = { id: CANVASES.length, w: w, h: h, ops: [], quality: null, type: null };
  CANVASES.push(rec);
  this.rec = rec;
  var pts = [];
  var ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 0, font: '',
    fillRect: function (x, y, w2, h2) { rec.ops.push({ k: 'rect', x: x, y: y, w: w2, h: h2, fill: ctx.fillStyle }); },
    fillText: function (t, x, y) { rec.ops.push({ k: 'text', text: t, x: x, y: y, fill: ctx.fillStyle, font: ctx.font }); },
    drawImage: function () { var a = [].slice.call(arguments); rec.ops.push({ k: 'image', args: a, tag: a[0] && a[0].tag }); },
    beginPath: function () { pts = []; },
    moveTo: function (x, y) { pts.push([x, y]); },
    lineTo: function (x, y) { pts.push([x, y]); },
    stroke: function () { rec.ops.push({ k: 'line', pts: pts.slice(), stroke: ctx.strokeStyle, width: ctx.lineWidth }); },
  };
  this.getContext = function () { return ctx; };
  this.convertToBlob = function (o) {
    rec.quality = o && o.quality; rec.type = o && o.type;
    return Promise.resolve(new Blob([new Uint8Array([255, 216, 255, rec.id & 255, rec.id >> 8])], { type: rec.type }));
  };
};
function canvasOfImg(img) {
  var m = /^data:image\/jpeg;base64,(.+)$/.exec(String(img || ''));
  if (!m) return null;
  var b = qkBase64Decode(m[1]);
  if (!b || b.length !== 5 || b[0] !== 255 || b[1] !== 216 || b[2] !== 255) return null;
  return CANVASES[b[3] | (b[4] << 8)] || null;
}
function settleP(p) {
  var r = { done: false };
  p.then(function (v) { r.done = true; r.v = v; }, function (e) { r.done = true; r.e = e; });
  drainMicrotasks();
  return r;
}

// ── the worker world ───────────────────────────────────────────────────────
// sc: kind ('itw' | 'resp'), site (opts of QK_FAKE.sites.*), seed {local, session, cookies}, nullFns [func names],
//     onNavigate(n, url, w, st), failNavigateAt (the n-th Page.navigate rejects "not attached"), shotReject(st) -> true to reject a capture.
var SENDER = { url: 'chrome-extension://x/sidepanel.html' };
var COOKIES = ['optimizelyEndUserId', 'qk_quiz_progress', 'session'];
function mkWorld(sc) {
  sc = sc || {};
  var w = QA_HARNESS.makeWorld({ page: QA_HARNESS.makePage({ url: 'about:blank' }) });
  w.src = '../background.js';
  var site = sc.kind === 'resp' ? QK_FAKE.sites.resp(sc.site) : QK_FAKE.sites.itw(sc.site);
  var visit = { store: { local: {}, session: {}, cookies: {} } };
  [site.seed, sc.seed].forEach(function (sd) {
    if (!sd) return;
    ['local', 'session', 'cookies'].forEach(function (k) { Object.keys(sd[k] || {}).forEach(function (n) { visit.store[k][n] = String(sd[k][n]); }); });
  });
  var st = { site: site, visit: visit, pg: null, nav: [], cmds: [], evs: [], scripts: {}, nScripts: 0, tabsRemoved: 0, created: [], width: 1440,
    winCleared: [], caps: [], capN: 0, lastNavUrl: null, pending: null, applied: 0, execs: [], clickAnswers: [] };
  w.st = st;
  var onConnect = null, posted = [], msgFns = [];
  w.chrome.runtime.onConnect = { addListener: function (fn) { onConnect = fn; } };
  w.posted = posted;
  w.connectPanel = function (winId) {
    var port = { name: 'selenite-panel', sender: { url: 'chrome-extension://x/sidepanel.html' },
      postMessage: function (m) { posted.push(JSON.parse(JSON.stringify(m))); },
      onMessage: { addListener: function (fn) { msgFns.push(fn); } }, onDisconnect: { addListener: function () {} } };
    onConnect(port);
    msgFns.forEach(function (fn) { fn({ action: 'hello', winId: winId == null ? 1 : winId }); });
    w.settle(function () { return true; });
  };

  w.chrome.debugger.onEvent = {
    addListener: function (fn) { st.evs.push(fn); },
    removeListener: function (fn) { st.evs = st.evs.filter(function (f) { return f !== fn; }); },
  };
  var attach0 = w.chrome.debugger.attach, detach0 = w.chrome.debugger.detach;
  w.chrome.debugger.attach = function (t, v) { st.cmds.push({ m: 'attach', p: { target: t, version: v } }); return attach0(t, v); };
  w.chrome.debugger.detach = function (t) { st.cmds.push({ m: 'detach', p: { target: t } }); return detach0(t); };

  function hit(name, patterns) { return /^optimizely/i.test(name) || qkKeyMatches(name, patterns); }
  // What the hygiene shim does at document start, for the patterns it carries.
  function hygiene(patterns) {
    var out = [];
    ['local', 'session'].forEach(function (label) {
      var s = visit.store[label];
      Object.keys(s).forEach(function (k) { if (hit(k, patterns)) { delete s[k]; out.push(label + ':' + k); } });
    });
    return out;
  }
  // site.click both decides and acts. The target pick (qkClickTargetFn) must only decide: run it, then undo what it did.
  function dryClick(selector) {
    var nLog = site.log.length, beacons = clone(site.beacons), store = clone(visit.store), states = clone(st.pg.states);
    var r = site.click(st.pg, visit, selector);
    site.log.length = nLog; site.beacons = beacons; visit.store = store; st.pg.states = states;
    return r;
  }

  w.chrome.debugger.sendCommand = function (t, method, params) {
    var e = { m: method, p: params, id: null };
    st.cmds.push(e);
    switch (method) {
      case 'Page.navigate': {
        st.nav.push(params.url);
        st.lastNavUrl = params.url;
        if (sc.onNavigate) sc.onNavigate(st.nav.length, params.url, w, st);
        if (sc.failNavigateAt === st.nav.length) return Promise.reject(new Error('Debugger is not attached to the tab with id: 1.'));
        var cleared = [];
        Object.keys(st.scripts).forEach(function (id) {
          var m = /var A=(\[.*?\]),out=window\.__qkCleared/.exec(st.scripts[id]);
          if (m) cleared = cleared.concat(hygiene(JSON.parse(m[1])));
        });
        st.winCleared = cleared;
        st.pg = site.load(QK_FAKE.parse(params.url), visit);
        w.page.url = params.url;
        w.at(5, function () { st.evs.slice().forEach(function (f) { f({ tabId: 1 }, 'Page.loadEventFired', {}); }); });
        return Promise.resolve({ frameId: 'F1', loaderId: 'l' });
      }
      case 'Emulation.setDeviceMetricsOverride': st.width = params.width; return Promise.resolve({});
      case 'Page.addScriptToEvaluateOnNewDocument': e.id = 'S' + (++st.nScripts); st.scripts[e.id] = params.source; return Promise.resolve({ identifier: e.id });
      case 'Page.removeScriptToEvaluateOnNewDocument': delete st.scripts[params.identifier]; return Promise.resolve({});
      case 'Network.getCookies': return Promise.resolve({ cookies: COOKIES.map(function (n) { return { name: n, domain: '127.0.0.1', path: '/' }; }) });
      case 'Input.dispatchMouseEvent':
        if (params.type === 'mouseReleased' && st.pending && params.x === st.pending.x && params.y === st.pending.y && st.pg) {
          site.click(st.pg, visit, st.pending.selector);
          st.applied++;
        }
        return Promise.resolve({});
      case 'Page.captureScreenshot': {
        if (sc.shotReject && sc.shotReject(st)) return Promise.reject(new Error('Capture failed'));
        var n = ++st.capN, bytes = [n & 255, (n >> 8) & 255, 81];
        var cap = { n: n, data: qkBase64(bytes), bytes: bytes, url: st.lastNavUrl, width: st.width, format: params.format, quality: params.quality };
        st.caps.push(cap);
        return Promise.resolve({ data: cap.data });
      }
    }
    return Promise.resolve({});
  };

  var EXEC = {
    qkSettleFn: function () { return { stable: true, polls: 1, scrollHeight: 1200 }; },
    qkPageFactsFn: function () { return st.pg ? clone(st.pg.facts) : null; },
    qkClearedFn: function () { var n = st.winCleared; st.winCleared = []; return { names: n }; },
    qkExperimentStateFn: function (a) { return st.pg ? site.rawState(st.pg, a[0]) : null; },
    qkSnippetProbeFn: function () { return st.pg ? site.catalog() : null; },
    qkClickTargetFn: function (a) {
      if (!st.pg) return null;
      var r = dryClick(a[0]);
      st.clickAnswers.push(clone(r));
      if (r.ok) st.pending = { x: r.x, y: r.y, selector: String(a[0]) };
      return r;
    },
    qkStorageNamesFn: function (a) {
      var P = a[0] || [];
      var names = function (s) { return Object.keys(s).filter(function (k) { return hit(k, P); }); };
      return { local: names(visit.store.local), session: names(visit.store.session), cookies: names(visit.store.cookies) };
    },
    qkClipScanFn: function (a) { return st.pg ? site.scan(st.pg, st.width, a[0] && a[0].ignoreList) : null; },
    qkTileMarkFn: function (a) { return st.pg ? site.mark(st.pg, a[0], a[1], st.width) : null; },
  };
  w.chrome.scripting.executeScript = function (opts) {
    if (!opts.func) return Promise.resolve([]);
    var name = opts.func.name;
    st.execs.push({ name: name, world: opts.world || 'ISOLATED' });
    if ((sc.nullFns || []).indexOf(name) >= 0) return Promise.resolve([{ documentId: 'd', frameId: 0, result: null }]);
    var f = EXEC[name];
    var r = f ? f(opts.args || []) : null;
    return Promise.resolve([{ documentId: 'd', frameId: 0, result: r === undefined ? null : r }]);
  };
  w.chrome.tabs.create = function (props) { st.created.push(props); return Promise.resolve(w.tab); };
  w.chrome.tabs.remove = function () { st.tabsRemoved++; return Promise.resolve(); };
  w.boot();
  w.settle(function () { return true; });
  CURRENT = st;
  return w;
}
function start(w, action, input, winId, runId) {
  var out = { done: false, res: undefined };
  CURRENT = w.st;
  // The answer is sent before endTmRun hands the window back to the passive follow, which attaches to the user's own tab:
  // what the RUN did is everything up to the answer (RC).
  w.listeners[0]({ action: action, payload: { input: input, winId: winId == null ? 1 : winId, runId: runId || 'run-1' } }, SENDER, function (r) { out.done = true; out.res = r; w.st.cut = w.st.cmds.length; });
  return out;
}
function runWorld(w, action, input, winId) {
  var out = start(w, action, input, winId);
  w.settle(function () { return out.done; }, 200000);
  return out;
}
function sendStop(w) {
  var o = { done: false };
  w.listeners[0]({ action: 'stop' }, SENDER, function () { o.done = true; });
  return o;
}

// ── contexts and inputs ────────────────────────────────────────────────────
function itwCtx(over) {
  var c = {
    ticketKey: 'QK-1', experimentId: '7001', platform: 'Optimizely', reviewed: true,
    previewLinks: [{ id: 'v0', url: B + '/itw/?optimizely_x=7101&cro_mode=qa&optimizely_force_tracking=true' }, { id: 'v1', url: B + '/itw/?optimizely_x=7102&cro_mode=qa' }],
    itwLink: B + '/itw/?cro_mode=qa', activationType: 'trigger', triggerDescription: 'Clicking Start quiz', triggerSelector: '#start-quiz',
    subPages: ['/itw/help/'], stayActivePages: ['/itw/step2/'],
    specAudiences: [
      { name: 'QA param', role: 'inclusion', type: 'query', param: 'cro_mode', value: 'qa', description: '' },
      { name: 'No Meta', role: 'exclusion', type: 'query', param: 'utm_source', value: 'meta', description: '' },
      { name: 'No Impact', role: 'exclusion', type: 'query', param: 'utm_campaign', value: 'impact', description: '' },
      { name: 'Desktop Only', role: 'inclusion', type: 'device', param: null, value: 'desktop', description: '' }],
    storedStateKeys: ['qk_quiz_*'], returningVisitor: 'active', redirectDestination: B + '/landing-ok/',
  };
  Object.keys(over || {}).forEach(function (k) { c[k] = over[k]; });
  return c;
}
function itwInput(ctx, over) {
  var b = iaBuildInput(ctx, {});
  if (!b.ok) throw new Error('iaBuildInput: ' + b.error);
  Object.keys(over || {}).forEach(function (k) { b.input[k] = over[k]; });
  return b.input;
}
function respCtx(extra) {
  return Object.assign({
    ticketKey: 'QK-6', experimentId: '7201', platform: 'Optimizely', reviewed: true,
    previewLinks: [{ id: 'v0', url: B + '/resp/?optimizely_x=7301&cro_mode=qa' }, { id: 'v1', url: B + '/resp/?optimizely_x=7302&cro_mode=qa' }],
    itwLink: B + '/resp/?cro_mode=qa',
  }, extra || {});
}
function respInput(ctx, values) {
  var v = Object.assign({ widths: '320,375,1280', ignore: RS_IGNORE_DEFAULTS.join('\n') }, values || {});
  var b = rsBuildInput(ctx, v);
  if (!b.ok) throw new Error('rsBuildInput: ' + b.error);
  return b.input;
}
// The same input through the FAKE io, the way the mode suites run it (sanitize, record, run, derive).
function fakeRun(engine, input, kind, siteOpts, ioOpts) {
  var site = kind === 'resp' ? QK_FAKE.sites.resp(siteOpts) : QK_FAKE.sites.itw(siteOpts);
  var io = QK_FAKE.makeIo(site, ioOpts);
  var inp = engine.sanitize(input);
  var rec = engine.newRecord(inp, io.now());
  settleP((async function () {
    try { await engine.run(io, rec, inp); } catch (e) {
      if (qkIsHalt(e)) rec.halted = e.halted; else if (qkIsStop(e)) rec.stopped = true; else rec.error = String(e && e.message || e);
    }
  })());
  rec.finishedAt = io.now();
  rec.rows = engine.derive(rec);
  return rec;
}

// ── readers of what a run left behind ──────────────────────────────────────
function RC(w) { return w.st.cut == null ? w.st.cmds : w.st.cmds.slice(0, w.st.cut); }
function cmds(w, name) { return RC(w).filter(function (c) { return c.m === name; }); }
function navIdx(w) { var r = []; RC(w).forEach(function (c, i) { if (c.m === 'Page.navigate') r.push(i); }); return r; }
function lastNavAt(w) { var n = navIdx(w); return n.length ? n[n.length - 1] : -1; }
function afterLastNav(w, name) { return RC(w).slice(lastNavAt(w) + 1).filter(function (c) { return c.m === name; }); }
function consoleLines(w) { return (w.store.session['w1:browserConsoleLogs'] || []).filter(function (l) { return l.source === 'selenite-mode'; }); }
function feed(w) { return w.store.session['w1:qkDebug']; }
function row(rec, id) { for (var i = 0; i < rec.rows.length; i++) if (rec.rows[i].id === id) return rec.rows[i]; return null; }
function ids(rec) { return rec.rows.map(function (r) { return r.id; }); }
function stat(rec, id) { var x = row(rec, id); return x ? qkVerdictText(x) : '(no row)'; }
function idStat(rec) { return rec.rows.map(function (r) { return r.id + ':' + r.status; }); }
function allText(rec) { return rec.rows.map(function (x) { return [x.check, x.expected, x.observed, x.evidence].join('\n'); }).join('\n'); }
function mouse(w) { return cmds(w, 'Input.dispatchMouseEvent'); }
function paramsOf(list) { return list.map(function (c) { return c.p; }); }

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// itw: the main run (Appendix D.3 through runItwActivation)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
var ITW = {};
T('boot and the wiring of the worker world', function () {
  var w = mkWorld({ kind: 'itw' });
  ok('the world booted and the router listens', typeof w.listeners[0] === 'function');
  ok('the probe line exposed qkwCompose and buildTestAgentSummaryPrompt', typeof globalThis.__QKW === 'object' && typeof __QKW.qkwCompose === 'function' && typeof __QKW.buildTestAgentSummaryPrompt === 'function');
  ok('every importScripts file was loaded in its order', IMPORTS.length === 11 && IMPORTS.indexOf('qa-kit.js') < IMPORTS.indexOf('itw-activation.js') && IMPORTS.indexOf('itw-activation.js') < IMPORTS.indexOf('responsiveness.js') && IMPORTS.indexOf('responsiveness.js') < IMPORTS.indexOf('qa-pass.js'), IMPORTS);
  ok('the engines are globals the router can find', typeof IA_ENGINE === 'object' && typeof RS_ENGINE === 'object');
});

T('itw: the answer, the record and the fake/real agreement', function () {
  var w = mkWorld({ kind: 'itw' });
  w.connectPanel(1);
  var input = itwInput(itwCtx(), { storedKeys: ['qk_quiz_*', '*'] });
  eq('the raw payload carries the lone * (the hazard A9 guards)', input.storedKeys.indexOf('*') >= 0, true);
  var out = runWorld(w, 'runItwActivation', input);
  ITW.w = w; ITW.out = out;
  ok('the router answers', out.done && !!out.res);
  eq('answer ok:true', out.res && out.res.ok, true);
  var rec = out.res.record;
  ITW.rec = rec;
  eq('the record is Mode 1, version 1', rec.mode + '/' + rec.version, 'itwactivation/1');
  eq('the record has the 18 keys', Object.keys(rec).length, 18);
  jeq('the 18 key names', Object.keys(rec).sort(), ['activation', 'catalog', 'error', 'experimentId', 'experimentIdSource', 'finishedAt', 'halted', 'input', 'loads', 'mode', 'obs', 'refusedItw', 'rows', 'startedAt', 'stopped', 'ticketKey', 'ts', 'version']);
  eq('no error, not stopped, not halted', rec.error === null && rec.stopped === false && rec.halted === null, true);
  eq('the input is the 14 keys', Object.keys(rec.input).length, 14);
  eq('the lone * is gone from the stored record input', rec.input.storedKeys.indexOf('*'), -1);
  jeq('only the named pattern remains', rec.input.storedKeys, ['qk_quiz_*']);
  eq('startedAt is the worker clock', rec.startedAt, 1750000000000);
  ok('finishedAt follows startedAt', rec.finishedAt > rec.startedAt);
  ok('the answer carries the debug feed next to the record', out.res.debug && out.res.debug.runId === 'run-1' && out.res.debug.mode === 'itwactivation' && out.res.debug.storageError === null);
  var fk = fakeRun(IA_ENGINE, input, 'itw');
  jeq('the real io and the fake io give the same row ids and statuses', idStat(rec), idStat(fk));
  jeq('and the same load roles', rec.loads.map(function (L) { return L.role; }), fk.loads.map(function (L) { return L.role; }));
  jeq('and the same verdict texts', rec.rows.map(function (r) { return qkVerdictText(r); }), fk.rows.map(function (r) { return qkVerdictText(r); }));
});

T('itw: rows (Appendix D.3)', function () {
  var rec = ITW.rec;
  jeq('row ids in order', ids(rec), ['ia.1.baseline', 'ia.2.onload', 'ia.2.sub.1', 'ia.3.trigger', 'ia.3.stay.1', 'ia.4.returning', 'ia.5.1.without', 'ia.5.1.with', 'ia.5.2.excl', 'ia.5.2.comp', 'ia.5.3.excl', 'ia.5.3.comp', 'ia.6.desktop.desktop', 'ia.6.desktop.phone', 'ia.7.title', 'ia.7.canonical', 'ia.7.textLen', 'ia.7.height', 'ia.7.widgets', 'ia.7.textHash', 'ia.8.redirect']);
  ['ia.1.baseline', 'ia.2.onload', 'ia.2.sub.1', 'ia.3.trigger', 'ia.3.stay.1', 'ia.4.returning', 'ia.5.1.without', 'ia.5.1.with', 'ia.5.2.excl', 'ia.5.2.comp', 'ia.5.3.comp', 'ia.6.desktop.desktop', 'ia.7.title', 'ia.7.canonical', 'ia.7.textLen', 'ia.7.height', 'ia.7.widgets', 'ia.7.textHash', 'ia.8.redirect'].forEach(function (id) {
    eq('Pass ' + id, stat(rec, id), 'Pass');
  });
  eq('Fail ia.5.3.excl (the deliberate bug: utm_campaign is ignored)', stat(rec, 'ia.5.3.excl'), 'Fail');
  eq('Not Tested ia.6.desktop.phone', stat(rec, 'ia.6.desktop.phone'), 'Not Tested');
  eq('the phone evidence', row(rec, 'ia.6.desktop.phone').evidence, 'Out of scope: phone emulation, out of scope for now');
  eq('badge', qkBadge(rec.rows, false, false).label, 'ISSUES FOUND');
  eq('12 loads', rec.loads.length, 12);
  eq('9 fresh visitors', qkFreshCount(rec.loads), 9);
  jeq('load roles', rec.loads.map(function (L) { return L.role; }), ['itw', 'stay', 'returning', 'sub', 'audience', 'audience', 'audience', 'audience', 'audience', 'control', 'prod', 'redirect']);
  jeq('the keepState loads are the stay and returning ones', rec.loads.filter(function (L) { return L.keepState; }).map(function (L) { return L.role; }), ['stay', 'returning']);
  ok('every load reached ok', rec.loads.every(function (L) { return L.ok === true && L.loadError === null && L.blocked === null; }));
  ok('every load has its final path', rec.loads.every(function (L) { return typeof L.final === 'string' && L.final.indexOf(B) === 0 && L.final.indexOf('?') < 0; }), rec.loads.map(function (L) { return L.final; }));
  ok('every load has a 15-key record', rec.loads.every(function (L) { return Object.keys(L).length === 15; }));
  ok('every load was settled', rec.loads.every(function (L) { return L.settle && L.settle.stable === true; }));
  ok('every load has a width of 1440', rec.loads.every(function (L) { return L.width === 1440; }));
  var sub = rec.loads.filter(function (L) { return L.role === 'sub'; })[0];
  ok('the sub-page load cleared the stored quiz key by name', sub.cleared.indexOf('local:qk_quiz_progress') >= 0, sub.cleared);
  ok('and the stored bucket', sub.cleared.indexOf('local:optimizely_qk_bucket_7001') >= 0, sub.cleared);
  ok('and the Optimizely cookie by name, never its value', sub.cleared.indexOf('cookie:optimizelyEndUserId') >= 0 && sub.cleared.indexOf('cookie:qk_quiz_progress') >= 0, sub.cleared);
  ok('and never the session cookie', sub.cleared.indexOf('cookie:session') < 0);
  var keep = rec.loads.filter(function (L) { return L.keepState; });
  ok('a keepState load records no cleared names', keep.every(function (L) { return L.cleared === null; }));
  ok('the baseline row names the cleared names', /cookie:optimizelyEndUserId/.test(row(rec, 'ia.1.baseline').evidence), row(rec, 'ia.1.baseline').evidence);
  ok('every row has the D11 shape', rec.rows.every(function (x) { return Object.keys(x).join() === 'id,step,check,expected,observed,status,platform,evidence,emulated,loads,tile,extra'; }));
  ok('no row is emulated', rec.rows.every(function (x) { return x.emulated === false; }));
  ok('every row string is free of ASCII ? & =', !/[?&=]/.test(allText(rec)));
  ok('every not-tested or blocked evidence starts with a D10 prefix', rec.rows.every(function (x) { return (x.status !== 'not-tested' && x.status !== 'blocked') || QK_REASON_PREFIXES.some(function (p) { return x.evidence.indexOf(p) === 0; }); }));
  ok('the D18 regexes match no output', !/\b(edit|change|update|modify|adjust|align|make|copy)\b[^.]*\bcontrol\b[^.]*\b(match|like|same|mirror)\b/i.test(allText(rec)) && !/match(es)? the variation/i.test(allText(rec)));
  ok('the record holds no cookie value or raw query', !/[?&=]/.test(JSON.stringify(rec.loads.map(function (L) { return [L.url, L.path, L.final, L.cleared]; }))));
});

T('itw: the debugger lifecycle and the CDP contract', function () {
  var w = ITW.w;
  var life = RC(w).filter(function (c) { return c.m === 'attach' || c.m === 'detach'; }).map(function (c) { return c.m; });
  jeq('one attach and one detach, in that order', life, ['attach', 'detach']);
  eq('the detach is the very last debugger call of the run', RC(w)[RC(w).length - 1].m, 'detach');
  var post = w.st.cmds.slice(w.st.cut).map(function (c) { return c.m; });
  ok('after the answer only the passive follow runs (attach, Runtime.enable, Log.enable): RC hides no command of the run (A41)', post.every(function (m) { return m === 'attach' || m === 'Runtime.enable' || m === 'Log.enable'; }), post);
  eq('the attach comes before Page.enable', RC(w)[0].m + '>' + RC(w)[1].m, 'attach>Page.enable');
  eq('the run tab is removed once', w.st.tabsRemoved, 1);
  eq('exactly one run tab was created', w.st.created.length, 1);
  ok('and it was created active, in the run window', w.st.created[0].active === true && w.st.created[0].windowId === 1 && w.st.created[0].url === 'about:blank', w.st.created[0]);
  eq('12 navigations', w.st.nav.length, 12);
  eq('the metrics override is cleared once, after the last navigation', afterLastNav(w, 'Emulation.clearDeviceMetricsOverride').length, 1);
  eq('and the clear is the only Emulation call after it', RC(w).slice(lastNavAt(w) + 1).filter(function (c) { return /^Emulation\./.test(c.m); }).length, 1);
  eq('NO Emulation.setUserAgentOverride, ever', cmds(w, 'Emulation.setUserAgentOverride').length, 0);
  eq('NO Emulation.setTouchEmulationEnabled, ever', cmds(w, 'Emulation.setTouchEmulationEnabled').length, 0);
  var metrics = paramsOf(cmds(w, 'Emulation.setDeviceMetricsOverride'));
  ok('there is a metrics override per load', metrics.length === 12, metrics.length);
  ok('every override has mobile:false', metrics.every(function (p) { return p.mobile === false; }));
  ok('every override is scale 1 at 1440 wide', metrics.every(function (p) { return p.deviceScaleFactor === 1 && p.width === 1440 && p.screenWidth === 1440; }));
  ok('every override has a desktop height', metrics.every(function (p) { return p.height === 900 && p.screenHeight === 900; }));
  ok('Page.enable was sent once', cmds(w, 'Page.enable').length === 1);
  ok('no navigation carries a tracking flag', !w.st.nav.some(function (u) { return WK_FLAG.test(u); }), w.st.nav.filter(function (u) { return WK_FLAG.test(u); }));
  eq('the site never saw optimizely_force_tracking or _conv_eforce', w.st.site.log.filter(function (x) { return WK_FLAG.test(x.url); }).length, 0);
  ok('the Control link carried optimizely_force_tracking, so the strip is what kept it out', /optimizely_force_tracking=true/.test(itwCtx().previewLinks[0].url));
  ok('the Control URL was loaded with cro_mode=qa and its forced variation', w.st.nav.some(function (u) { return /optimizely_x=7101/.test(u) && /cro_mode=qa/.test(u); }));
  ok('the PROD navigation is the plain ITW page', w.st.nav.indexOf(B + '/itw/') >= 0);
  ok('every navigation is on 127.0.0.1', w.st.nav.every(function (u) { return u.indexOf(B) === 0; }));
  ok('the scripts are all removed by the end', Object.keys(w.st.scripts).length === 0);
});

T('itw: the document-start shim per load (A9, D6)', function () {
  var w = ITW.w, rec = ITW.rec;
  var adds = cmds(w, 'Page.addScriptToEvaluateOnNewDocument'), removes = cmds(w, 'Page.removeScriptToEvaluateOnNewDocument');
  eq('one shim per clean load: 10 of the 12', adds.length, 10);
  eq('and each removed', removes.length, 10);
  ok('every shim embeds only the cleaned pattern', adds.every(function (c) { return c.p.source.indexOf('var A=["qk_quiz_*"],') > 0; }));
  ok('no shim carries the lone *', adds.every(function (c) { return c.p.source.indexOf('"*"') < 0; }));
  ok('every shim is the kit shim', adds.every(function (c) { return c.p.source === qkHygieneShim(['qk_quiz_*']); }));
  var navs = navIdx(w);
  var okOrder = true, why = [];
  adds.forEach(function (a) {
    var ai = RC(w).indexOf(a);
    var ni = navs.filter(function (i) { return i > ai; })[0];
    var rm = RC(w)[ni + 1];
    if (!(ni > ai)) { okOrder = false; why.push('no navigation after ' + a.id); }
    else if (!(rm && rm.m === 'Page.removeScriptToEvaluateOnNewDocument' && rm.p.identifier === a.id)) { okOrder = false; why.push(a.id + ' not removed right after its load: ' + (rm && rm.m)); }
  });
  ok('each shim is added before its Page.navigate and removed before the next command after its load', okOrder, why);
  // keepState loads: nothing is added or deleted in the segment before their navigation
  var seg = [], prev = -1;
  navs.forEach(function (ni, k) {
    var inSeg = RC(w).slice(prev + 1, ni);
    seg.push(inSeg);
    prev = ni;
  });
  rec.loads.forEach(function (L, k) {
    var s = seg[k].map(function (c) { return c.m; });
    if (L.keepState) {
      ok(L.id + ' (' + L.role + ', keepState): no add-script before it', s.indexOf('Page.addScriptToEvaluateOnNewDocument') < 0, s);
      ok(L.id + ' (' + L.role + ', keepState): no Network.deleteCookies before it', s.indexOf('Network.deleteCookies') < 0 && s.indexOf('Network.getCookies') < 0, s);
    } else {
      ok(L.id + ' (' + L.role + '): a clean load reads the cookie names first', s.indexOf('Network.getCookies') >= 0 && s.indexOf('Network.getCookies') < s.indexOf('Page.addScriptToEvaluateOnNewDocument'), s);
    }
  });
  var del = paramsOf(cmds(w, 'Network.deleteCookies'));
  var names = {}; del.forEach(function (p) { names[p.name] = (names[p.name] || 0) + 1; });
  jeq('Network.deleteCookies named only optimizelyEndUserId and qk_quiz_progress', Object.keys(names).sort(), ['optimizelyEndUserId', 'qk_quiz_progress']);
  eq('once per clean load for each', names.optimizelyEndUserId + ',' + names.qk_quiz_progress, '10,10');
  ok('never the session cookie, though the payload carried *', !del.some(function (p) { return p.name === 'session'; }));
  ok('each delete names the domain and path it read', del.every(function (p) { return p.domain === '127.0.0.1' && p.path === '/'; }));
  eq('the cookie names were read for the page origin and path only (no query)', paramsOf(cmds(w, 'Network.getCookies'))[0].urls[0], B + '/itw/');
});

T('itw: clicks, beacons and the trusted-click order', function () {
  var w = ITW.w;
  var ev = paramsOf(mouse(w));
  eq('6 trusted triggers: 18 mouse events', ev.length, 18);
  var good = true;
  for (var i = 0; i < ev.length; i += 3) {
    var a = ev[i], b = ev[i + 1], c = ev[i + 2];
    if (!(a.type === 'mouseMoved' && b.type === 'mousePressed' && c.type === 'mouseReleased')) good = false;
    if (!(a.x === 440 && a.y === 420 && b.x === 440 && b.y === 420 && c.x === 440 && c.y === 420)) good = false;
    if (!(b.button === 'left' && b.clickCount === 1 && c.button === 'left' && c.clickCount === 1)) good = false;
  }
  ok('every click is moved, pressed, released at the coordinates the target pick returned', good, ev.slice(0, 3));
  eq('the fake target pick answered ok for each of the 6', w.st.clickAnswers.filter(function (a) { return a.ok; }).length, 6);
  eq('and each release applied the site click', w.st.applied, 6);
  eq('the site saw 6 trusted trigger beacons', w.st.site.beacons.trusted, 6);
  eq('0 untrusted beacons (never element.click())', w.st.site.beacons.untrusted, 0);
  eq('0 overlay beacons', w.st.site.beacons.overlay, 0);
  ok('the target pick ran in the isolated world, the experiment reads in MAIN', w.st.execs.filter(function (e) { return e.name === 'qkClickTargetFn'; }).every(function (e) { return e.world === 'ISOLATED'; }) && w.st.execs.filter(function (e) { return e.name === 'qkExperimentStateFn' || e.name === 'qkSnippetProbeFn' || e.name === 'qkClearedFn'; }).every(function (e) { return e.world === 'MAIN'; }));
  ok('the click target selector was the trigger', w.st.clickAnswers.length === 6 && w.st.pending.selector === '#start-quiz', w.st.pending);
});

T('itw: the Console tab lines and the Live debug feed (A3, A14, D25)', function () {
  var w = ITW.w, rec = ITW.rec;
  var cl = consoleLines(w);
  eq('exactly two selenite-mode Console lines', cl.length, 2);
  ok('the first is the start line, INFO', /^\[ITW Activation\] Run started · ticket QK-1 · /.test(cl[0].text) && cl[0].level === 'INFO', cl[0]);
  ok('the second is the end line, INFO (finished)', /^\[ITW Activation\] Run finished in \d+\.\ds · /.test(cl[1].text) && cl[1].level === 'INFO', cl[1]);
  eq('the label appears once in the start line', cl[0].text.split('[ITW Activation]').length - 1, 1);
  eq('the label appears once in the end line', cl[1].text.split('[ITW Activation]').length - 1, 1);
  ok('the end line carries the counts', /1 Fail · 19 Pass · 0 Needs PGM · 0 Needs Platform Access · 1 Not Tested$/.test(cl[1].text), cl[1].text);
  ok('no Console line holds a raw query character', cl.every(function (l) { return !/[?&=]/.test(l.text); }));
  var f = feed(w);
  ok('the session holds the debug feed', !!f && f.runId === 'run-1' && f.mode === 'itwactivation' && Array.isArray(f.lines), f && Object.keys(f));
  eq('the feed is only {runId, mode, lines}', Object.keys(f).sort().join(), 'lines,mode,runId');
  eq('its first line', f.lines[0].text, 'The worker started the ITW Activation run');
  ok('its last line closes the tab after 12 loads', /^Closed the run tab after 12 load\(s\) in \d+\.\ds · rows: 1 Fail · 19 Pass/.test(f.lines[f.lines.length - 1].text), f.lines[f.lines.length - 1].text);
  var res = f.lines.filter(function (l) { return /^L\d+ /.test(l.text); });
  eq('one result line per load', res.length, 12);
  jeq('and they name L1 to L12, once each', res.map(function (l) { return l.text.split(' ')[0]; }), ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10', 'L11', 'L12']);
  eq('and one start line per load', f.lines.filter(function (l) { return /^→ L\d+ /.test(l.text); }).length, 12);
  ok('no ASCII ? & = in any feed line', f.lines.every(function (l) { return !/[?&=]/.test(l.text); }), f.lines.filter(function (l) { return /[?&=]/.test(l.text); }).map(function (l) { return l.text; }));
  ok('every line is {t, src:worker, level, text}', f.lines.every(function (l) { return l.src === 'worker' && typeof l.t === 'number' && /^(info|warn|error)$/.test(l.level) && typeof l.text === 'string'; }));
  ok('the engine wrote lines of its own between them', f.lines.length > 30, f.lines.length);
  jeq('the answer carries the same lines as the session', ITW.out.res.debug.lines.map(function (l) { return l.text; }), f.lines.map(function (l) { return l.text; }));
  var msgs = w.posted.filter(function (m) { return m.action === 'qkDebug'; });
  ok('the feed went down the panel port more than once', msgs.length > 2, msgs.length);
  ok('each port message is {action, runId, mode, lines}', msgs.every(function (m) { return Object.keys(m).sort().join() === 'action,lines,mode,runId' && m.runId === 'run-1' && m.mode === 'itwactivation'; }));
  ok('each is a whole snapshot that only grows', msgs.every(function (m, i) { return i === 0 || m.lines.length >= msgs[i - 1].lines.length; }));
  eq('the last port message holds every line', msgs[msgs.length - 1].lines.length, f.lines.length);
  var prog = w.store.session['w1:qkProgress'];
  eq('qkProgress.running is false at the end', prog && prog.running, false);
  ok('qkProgress was written while running (the sets include it)', w.sets.filter(function (s) { return /session:.*w1:qkProgress/.test(s); }).length > 6, w.sets.filter(function (s) { return /qkProgress/.test(s); }).length);
  ok('the feed is no longer written after the run', (function () { var n = w.sets.filter(function (s) { return /qkDebug/.test(s); }).length; w.settle(function () { return true; }); return w.sets.filter(function (s) { return /qkDebug/.test(s); }).length === n; })());
  ok('the run window pointer was released', w.store.session._wins && w.store.session._wins.run === null, w.store.session._wins);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// covered, bot, stop, fatal, null page function, concurrent
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
T('covered (Appendix D.4 itw-covered): a covered trigger is never clicked', function () {
  var ctx = itwCtx({ ticketKey: 'QK-4', itwLink: B + '/itw-covered/?cro_mode=qa', subPages: [], stayActivePages: [], specAudiences: [itwCtx().specAudiences[3]], redirectDestination: null, previewLinks: [] });
  var input = itwInput(ctx);
  var w = mkWorld({ kind: 'itw' });
  var out = runWorld(w, 'runItwActivation', input);
  var rec = out.res.record;
  eq('the run finished ok', out.res.ok, true);
  eq('ZERO Input.dispatchMouseEvent', mouse(w).length, 0);
  eq('the target pick was asked once', w.st.clickAnswers.length, 1);
  eq('and answered covered', w.st.clickAnswers[0].reason, 'covered');
  eq('the site saw no beacon of any kind', w.st.site.beacons.trusted + w.st.site.beacons.untrusted + w.st.site.beacons.overlay, 0);
  eq('ia.1.baseline Pass', stat(rec, 'ia.1.baseline'), 'Pass');
  eq('ia.3.trigger Not Tested', stat(rec, 'ia.3.trigger'), 'Not Tested');
  eq('and blocked', row(rec, 'ia.3.trigger').status, 'blocked');
  eq('ia.3.trigger carries the D8 sentence', row(rec, 'ia.3.trigger').evidence, 'Blocked: the trigger is covered by div#cookie-wall at every point tried; nothing was clicked.');
  eq('ia.2.onload Needs PGM (D19)', stat(rec, 'ia.2.onload'), 'Needs PGM');
  eq('ia.4.returning Not Tested', stat(rec, 'ia.4.returning'), 'Not Tested');
  eq('ia.6.desktop.desktop Blocked on the trigger', row(rec, 'ia.6.desktop.desktop').evidence, 'Blocked: activation could not be exercised on desktop (ia.3.trigger)');
  eq('only the baseline was loaded', rec.loads.length, 1);
  jeq('the real and the fake io agree on every row', idStat(rec), idStat(fakeRun(IA_ENGINE, input, 'itw')));
  eq('the tab was still closed', w.st.tabsRemoved, 1);
});

T('bot (Appendix D.4, Mode 1 part): the run halts at the challenge', function () {
  var ctx = itwCtx({ ticketKey: 'QK-5', itwLink: B + '/blocked/?cro_mode=qa', subPages: [], stayActivePages: [], specAudiences: [], previewLinks: [], redirectDestination: null });
  var input = itwInput(ctx);
  var w = mkWorld({ kind: 'itw' });
  var out = runWorld(w, 'runItwActivation', input);
  var rec = out.res.record;
  eq('the answer is ok (a halt is a result, not an error)', out.res.ok, true);
  ok('rec.halted names the path and signal', !!rec.halted && /\/blocked\/$/.test(rec.halted.path) && rec.halted.signal === 'title: Just a moment...' && rec.halted.loadId === 'L1', rec.halted);
  eq('rec.halted has loadId, path, signal', Object.keys(rec.halted).sort().join(), 'loadId,path,signal');
  eq('exactly one navigation', w.st.nav.length, 1);
  eq('exactly one request reached the site', w.st.site.requestsTo('/blocked/').length, 1);
  eq('no error and not stopped', rec.error === null && rec.stopped === false, true);
  eq('the blocked load is in the record, blocked', rec.loads.length === 1 && rec.loads[0].blocked !== null && rec.loads[0].ok === false, true);
  eq('ia.1.baseline is Not Tested (Blocked: a bot check)', stat(rec, 'ia.1.baseline'), 'Not Tested');
  ok('ia.1.baseline names the check', /^Blocked: a bot check \(title: Just a moment\.\.\.\) on .*\/blocked\/ halted the run; it was never attempted\.$/.test(row(rec, 'ia.1.baseline').evidence), row(rec, 'ia.1.baseline').evidence);
  ok('no row passed or failed', rec.rows.every(function (r) { return r.status !== 'passed' && r.status !== 'failed'; }), idStat(rec));
  ok('every not-tested row starts with Blocked, Missing input or Out of scope (the halt wins over every other Blocked reason)', rec.rows.every(function (r) { return /^(Blocked: a bot check|Missing input: |Out of scope: )/.test(r.evidence); }), rec.rows.map(function (r) { return r.id + ' ' + r.evidence; }));
  ok('the badge is HALTED: BOT CHECK', qkBadge(rec.rows, false, true).label === 'HALTED: BOT CHECK');
  var cl = consoleLines(w);
  eq('two Console lines', cl.length, 2);
  eq('the end line is WARNING', cl[1].level, 'WARNING');
  ok('and says halted by a bot check on the path', /^\[ITW Activation\] Run halted by a bot check on .*\/blocked\/ in \d+\.\ds · /.test(cl[1].text), cl[1].text);
  eq('the debugger was detached', cmds(w, 'detach').length, 1);
  eq('the tab was closed', w.st.tabsRemoved, 1);
  ok('the feed notes the halt', feed(w).lines.some(function (l) { return l.level === 'warn' && /^Halted: a bot check/.test(l.text); }));
  eq('qkProgress.running false', w.store.session['w1:qkProgress'].running, false);
  eq('no click was dispatched', mouse(w).length, 0);
});

T('stop (Appendix D.6, Mode 1): the stop action after the third navigation', function () {
  var input = itwInput(itwCtx());
  var w = mkWorld({ kind: 'itw', onNavigate: function (n, url, w0) { if (n === 3) sendStop(w0); } });
  var out = runWorld(w, 'runItwActivation', input);
  var rec = out.res.record;
  eq('the answer is ok', out.res.ok, true);
  eq('rec.stopped', rec.stopped, true);
  eq('not halted, no error', rec.halted === null && rec.error === null, true);
  eq('no navigation after the stop: exactly 3', w.st.nav.length, 3);
  ok('the rows that did not run say Stopped', rec.rows.filter(function (r) { return r.status === 'not-tested'; }).length > 10 && rec.rows.filter(function (r) { return r.status === 'not-tested'; }).every(function (r) { return r.evidence === 'Stopped: by the tester before this ran.' || /^(Out of scope|Missing input|Blocked): /.test(r.evidence); }));
  ok('some rows are Stopped', count(rec.rows, function (r) { return /^Stopped: by the tester before this ran\.$/.test(r.evidence); }) >= 8, count(rec.rows, function (r) { return /^Stopped: /.test(r.evidence); }));
  eq('the detach and the tab close still happen', cmds(w, 'detach').length + ',' + w.st.tabsRemoved, '1,1');
  eq('the metrics override is cleared', afterLastNav(w, 'Emulation.clearDeviceMetricsOverride').length, 1);
  var cl = consoleLines(w);
  eq('the end line is WARNING', cl[1].level, 'WARNING');
  ok('and says the tester stopped it', /^\[ITW Activation\] Run stopped by the tester in /.test(cl[1].text), cl[1].text);
  eq('qkProgress.running false', w.store.session['w1:qkProgress'].running, false);
  ok('the feed notes the stop', feed(w).lines.some(function (l) { return l.text === 'Stopped on request'; }));
  eq('the next run is not refused: the worker was released', (function () { var o2 = runWorld(w, 'runItwActivation', itwInput(itwCtx({ itwLink: B + '/blocked/?cro_mode=qa' }))); return o2.res.ok; })(), true);
});

T('fatal: the debugger is lost on the 4th navigation', function () {
  var input = itwInput(itwCtx());
  var w = mkWorld({ kind: 'itw', failNavigateAt: 4 });
  var out = runWorld(w, 'runItwActivation', input);
  var rec = out.res.record;
  eq('the answer is ok with a record that carries the error', out.res.ok === true && !!rec, true);
  ok('rec.error names the detach', /The debugger was detached from the run tab/.test(rec.error), rec.error);
  ok('and the cause', /closed|DevTools|bar was cancelled/.test(rec.error));
  eq('3 loads were recorded before it', rec.loads.length, 3);
  eq('the fourth navigation was attempted once', w.st.nav.length, 4);
  eq('a detach was still attempted', cmds(w, 'detach').length, 1);
  eq('and the tab closed', w.st.tabsRemoved, 1);
  eq('the metrics override clear was still attempted', afterLastNav(w, 'Emulation.clearDeviceMetricsOverride').length, 1);
  var cl = consoleLines(w);
  eq('the end line is ERROR', cl[1].level, 'ERROR');
  ok('and says it ended on an error', /^\[ITW Activation\] Run ended on an error in /.test(cl[1].text), cl[1].text);
  ok('the unobserved rows say Not run with the error', count(rec.rows, function (r) { return /^Not run: the run ended on an error \(/.test(r.evidence); }) > 5);
  ok('the feed has an error line', feed(w).lines.some(function (l) { return l.level === 'error' && /^The run ended on an error: /.test(l.text); }));
  eq('rec.stopped is false', rec.stopped, false);
  eq('qkProgress.running false', w.store.session['w1:qkProgress'].running, false);
});

T('null page function: qkExperimentStateFn resolves {result:null} (Chrome 154)', function () {
  var input = itwInput(itwCtx());
  var w = mkWorld({ kind: 'itw', nullFns: ['qkExperimentStateFn'] });
  var out = runWorld(w, 'runItwActivation', input);
  var rec = out.res.record;
  eq('the run finishes ok', out.res.ok, true);
  eq('no error, not stopped, not halted', rec.error === null && !rec.stopped && rec.halted === null, true);
  eq('ia.1.baseline is Not Tested', stat(rec, 'ia.1.baseline'), 'Not Tested');
  ok('and says no result (the page script failed)', /Not run: .*no result \(the page script failed\)/.test(row(rec, 'ia.1.baseline').evidence), row(rec, 'ia.1.baseline').evidence);
  eq('and is status not-tested', row(rec, 'ia.1.baseline').status, 'not-tested');
  ok('the state reads were attempted (the function ran and answered null)', w.st.execs.filter(function (e) { return e.name === 'qkExperimentStateFn'; }).length >= 1);
  ok('no row passed on state it never read', rec.rows.filter(function (r) { return /^ia\.[1-6]\./.test(r.id) && r.id !== 'ia.6.desktop.phone'; }).every(function (r) { return r.status === 'not-tested' || r.status === 'blocked'; }), idStat(rec));
  eq('the detach and close still happen', cmds(w, 'detach').length + ',' + w.st.tabsRemoved, '1,1');
  eq('the end Console line is INFO (a mode that read nothing did not error)', consoleLines(w)[1].level, 'INFO');
  var fk = fakeRun(IA_ENGINE, input, 'itw', null, { nullState: true });
  jeq('the fake io (nullState) gives the same statuses', idStat(rec), idStat(fk));
});

T('concurrent: a second run while one runs is refused before beginTmRun', function () {
  var w = mkWorld({ kind: 'resp' });
  var first = start(w, 'runResponsiveness', respInput(respCtx()), 1, 'run-A');
  w.settle(function () { return w.st.nav.length >= 1; });
  ok('the first run is under way', w.st.nav.length >= 1 && !first.done);
  eq('_runWin is 1 (the first run owns the window)', w.store.session._wins.run, 1);
  var wins0 = w.sets.filter(function (s) { return /session:_wins/.test(s); }).length;
  var second = start(w, 'runResponsiveness', respInput(respCtx()), 2, 'run-B');
  drainMicrotasks();
  ok('the refusal is answered at once', second.done === true);
  eq('{ok:false}', second.res && second.res.ok, false);
  eq('with the already-going sentence', second.res.error, 'An ITW Activation or Responsiveness run is already going in this browser. Stop it first.');
  eq('beginTmRun was NOT called for it: _runWin is still 1', w.store.session._wins.run, 1);
  eq('and persistWins did not write again', w.sets.filter(function (s) { return /session:_wins/.test(s); }).length, wins0);
  var third = start(w, 'runItwActivation', itwInput(itwCtx()), 3, 'run-C');
  drainMicrotasks();
  ok('the other mode is refused as well', third.done && third.res.ok === false && /already going/.test(third.res.error));
  eq('and _runWin is unchanged', w.store.session._wins.run, 1);
  w.settle(function () { return first.done; }, 200000);
  eq('the first run completes ok', first.res.ok, true);
  eq('its record is the first one (run-A)', w.store.session['w1:qkDebug'].runId, 'run-A');
  eq('the refused runs created no tab', w.st.created.length, 1);
  var again = runWorld(w, 'runResponsiveness', respInput(respCtx(), { widths: '375' }), 1);
  eq('after it ends the worker accepts a new run', again.res.ok, true);
  eq('only the first and the later run opened tabs', w.st.created.length, 2);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// resp (Appendix D.5, D.6)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
var RESP = {};
T('resp: rows, tiles and the capture bookkeeping (Appendix D.5)', function () {
  var input = respInput(respCtx());
  var w = mkWorld({ kind: 'resp' });
  w.connectPanel(1);
  var out = runWorld(w, 'runResponsiveness', input);
  RESP.w = w; RESP.input = input; RESP.out = out;
  var rec = out.res.record;
  RESP.rec = rec;
  eq('answer ok', out.res.ok, true);
  eq('the record is Mode 5, version 1', rec.mode + '/' + rec.version, 'responsiveness/1');
  eq('16 keys', Object.keys(rec).length, 16);
  jeq('the 16 key names', Object.keys(rec).sort(), ['error', 'finishedAt', 'halted', 'input', 'loads', 'mode', 'plan', 'rows', 'startedAt', 'stopped', 'sweep', 'ticketKey', 'tiles', 'tilesCapped', 'ts', 'version']);
  eq('no error, not stopped, not halted', rec.error === null && rec.stopped === false && rec.halted === null, true);
  eq('input has 8 keys', Object.keys(rec.input).length, 8);
  var fk = fakeRun(RS_ENGINE, input, 'resp');
  jeq('the real and the fake io agree on every row id and status', idStat(rec), idStat(fk));
  jeq('and on the tile list (ids, targets, widths, gaps)', rec.tiles.map(function (t) { return [t.id, t.target, t.width, t.gapPx]; }), fk.tiles.map(function (t) { return [t.id, t.target, t.width, t.gapPx]; }));
  jeq('row ids', ids(rec), ['rs.v0.320.1', 'rs.v0.375', 'rs.v0.1280', 'rs.v1.320.1', 'rs.v1.320.2', 'rs.v1.375.1', 'rs.v1.1280', 'rs.prod']);
  eq('rs.v0.320.1 Fail, the legal line, gap -10, also on PROD yes', [stat(rec, 'rs.v0.320.1'), /LEGAL-LINE/.test(row(rec, 'rs.v0.320.1').check), row(rec, 'rs.v0.320.1').extra.gapPx, row(rec, 'rs.v0.320.1').extra.alsoOnProd].join(), 'Fail (emulated),true,-10,yes');
  eq('rs.v1.320.1 is the hero, -76, also on PROD no', [/CLIPPED-HERO/.test(row(rec, 'rs.v1.320.1').check), row(rec, 'rs.v1.320.1').extra.gapPx, row(rec, 'rs.v1.320.1').extra.alsoOnProd].join(), 'true,-76,no');
  eq('rs.v1.375.1 gap -21, high, regression', [row(rec, 'rs.v1.375.1').extra.gapPx, row(rec, 'rs.v1.375.1').extra.severity, /new in this variation \(regression\)/.test(row(rec, 'rs.v1.375.1').evidence)].join(), '-21,high,true');
  ['rs.v0.375', 'rs.v0.1280', 'rs.v1.1280'].forEach(function (id) { eq('Pass ' + id, row(rec, id).status, 'passed'); });
  eq('rs.prod Pass, reloaded once per width', row(rec, 'rs.prod').status + '|' + row(rec, 'rs.prod').observed, 'passed|3 widths, reloaded once per width');
  eq('rs.prod is not emulated', row(rec, 'rs.prod').emulated, false);
  ok('every sweep row is emulated', rec.rows.filter(function (r) { return r.id !== 'rs.prod'; }).every(function (r) { return r.emulated === true; }));
  ok('no row mentions CAROUSEL (the default ignore list holds)', !/CAROUSEL/.test(JSON.stringify(rec.rows)));
  ok('no output says pre-existing or not a regression', !/pre-?existing|not a regression/i.test(JSON.stringify(rec)));
  eq('4 Fail and 4 Pass', qkCounts(rec.rows).fail + ',' + qkCounts(rec.rows).pass, '4,4');
  eq('plan: severity-ordered widths', JSON.stringify(rec.plan.widths), '[375,1280,320]');
  eq('plan.prodMode reload', rec.plan.prodMode, 'reload');
  eq('9 loads: 6 variant and 3 PROD', rec.loads.length + ',' + count(rec.loads, function (L) { return L.role === 'variant'; }) + ',' + count(rec.loads, function (L) { return L.role === 'prod'; }), '9,6,3');
  eq('PROD reloads 3 times: three plain-PROD navigations', count(w.st.nav, function (u) { return u === B + '/resp/'; }), 3);
  eq('and 6 variant navigations carry optimizely_x', count(w.st.nav, function (u) { return /optimizely_x=73/.test(u); }), 6);
  ok('no navigation carries a tracking flag', !w.st.nav.some(function (u) { return WK_FLAG.test(u); }));
  var metricW = paramsOf(cmds(w, 'Emulation.setDeviceMetricsOverride')).map(function (p) { return p.width; });
  jeq('the viewport width of each load: variations then PROD, 375/1280/320 each time', metricW, [375, 1280, 320, 375, 1280, 320, 375, 1280, 320]);
  var m = paramsOf(cmds(w, 'Emulation.setDeviceMetricsOverride'));
  ok('every override: mobile false, scale 1, the width as screenWidth too', m.every(function (p) { return p.mobile === false && p.deviceScaleFactor === 1 && p.screenWidth === p.width; }));
  ok('heights follow the width (844 under 768)', m.every(function (p) { return p.height === (p.width <= 767 ? 844 : p.width < 1024 ? 1024 : 900); }));
  eq('no user agent and no touch override', cmds(w, 'Emulation.setUserAgentOverride').length + cmds(w, 'Emulation.setTouchEmulationEnabled').length, 0);
  eq('the override is cleared after the last navigation', afterLastNav(w, 'Emulation.clearDeviceMetricsOverride').length, 1);
  eq('9 shims added and removed (every load is a clean visitor)', cmds(w, 'Page.addScriptToEvaluateOnNewDocument').length + ',' + cmds(w, 'Page.removeScriptToEvaluateOnNewDocument').length, '9,9');
  eq('the run tab was closed once, one attach, one detach', w.st.tabsRemoved + ',' + cmds(w, 'attach').length + ',' + cmds(w, 'detach').length, '1,1,1');
  eq('the detach is last', RC(w)[RC(w).length - 1].m, 'detach');
  eq('no mouse event (Mode 5 never clicks)', mouse(w).length, 0);
  eq('qkProgress.running false', w.store.session['w1:qkProgress'].running, false);
  var cl = consoleLines(w);
  eq('two Console lines: start and finish, with the label once each', cl.length + ',' + (cl[0].text.split('[Responsiveness]').length - 1) + ',' + (cl[1].text.split('[Responsiveness]').length - 1), '2,1,1');
  var rf = feed(w);
  eq('the feed names mode responsiveness and starts with the worker line', rf.mode + '|' + rf.lines[0].text, 'responsiveness|The worker started the Responsiveness run');
  eq('Mode 5: one result line per load', rf.lines.filter(function (l) { return /^L\d+ /.test(l.text); }).length, 9);
  eq('Mode 5: one start line per load', rf.lines.filter(function (l) { return /^→ L\d+ /.test(l.text); }).length, 9);
  ok('Mode 5: the last line closes the tab after 9 loads', /^Closed the run tab after 9 load\(s\) in \d+\.\ds · rows: 4 Fail · 4 Pass/.test(rf.lines[rf.lines.length - 1].text), rf.lines[rf.lines.length - 1].text);
  ok('Mode 5: no ASCII ? & = in any feed line', rf.lines.every(function (l) { return !/[?&=]/.test(l.text); }));
  ok('the end line is INFO and finished', cl[1].level === 'INFO' && /^\[Responsiveness\] Run finished in \d+\.\ds · 4 Fail · 4 Pass/.test(cl[1].text), cl[1].text);
});

T('resp: tiles (D22) and the compose contract (A20)', function () {
  var w = RESP.w, rec = RESP.rec;
  eq('3 tiles', rec.tiles.length, 3);
  jeq('ids, targets and widths in sweep order', rec.tiles.map(function (t) { return t.id + ':' + t.target + '@' + t.width; }), ['T1:v0@320', 'T2:v1@375', 'T3:v1@320']);
  ok('each img is a data:image/jpeg;base64, URL', rec.tiles.every(function (t) { return /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(t.img); }));
  ok('each img decodes to the canvas the worker drew it on', rec.tiles.every(function (t) { return canvasOfImg(t.img) !== null; }));
  eq('the three canvases are distinct', rec.tiles.map(function (t) { return canvasOfImg(t.img).id; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).length, 3);
  var caps = w.st.caps;
  ok('captures are distinct, valid base64 (n & 255, n >> 8, 81)', caps.length >= 6 && caps.every(function (c, i) { return c.n === i + 1 && c.data === qkBase64([(i + 1) & 255, ((i + 1) >> 8) & 255, 81]); }), caps.length);
  ok('captures are JPEG at quality 70', caps.every(function (c) { return c.format === 'jpeg' && c.quality === 70; }));
  eq('distinct captures never repeat a data string', caps.map(function (c) { return c.data; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).length, caps.length);
  ok('each capture knows its URL and width', caps.every(function (c) { return typeof c.url === 'string' && typeof c.width === 'number'; }));
  rec.tiles.forEach(function (t) {
    var cv = canvasOfImg(t.img);
    var tag = t.id + ': ';
    var rects = cv.ops.filter(function (o) { return o.k === 'rect'; });
    var iProd = -1, iVar = -1;
    cv.ops.forEach(function (o, i) { if (o.k === 'rect' && o.fill === RS_TILE.prodBand && iProd < 0) iProd = i; if (o.k === 'rect' && o.fill === RS_TILE.varBand && iVar < 0) iVar = i; });
    ok(tag + 'the PROD band rect was drawn before the variant band rect', iProd >= 0 && iVar > iProd, [iProd, iVar]);
    var imgs = cv.ops.filter(function (o) { return o.k === 'image'; });
    eq(tag + 'two drawImage calls, one per captured half', imgs.length, 2);
    ok(tag + 'each with 9 arguments, the 8 numbers integers', imgs.every(function (o) { return o.args.length === 9 && o.args.slice(1).every(function (n) { return Number.isInteger(n); }); }), imgs.map(function (o) { return o.args.length; }));
    var prodImg = imgs[0], varImg = imgs[1];
    eq(tag + 'the first image is the PROD half (dy = band 22)', prodImg.args[6], 22);
    ok(tag + 'the PROD half is a capture of the PROD URL at the tile width', prodImg.tag.url === B + '/resp/' && prodImg.tag.width === t.width, [prodImg.tag.url, prodImg.tag.width, t.width]);
    var vq = QK_FAKE.parse(varImg.tag.url);
    var want = t.target === 'v0' ? '7301' : '7302';
    ok(tag + 'the variant half is a capture of that variation URL at that width', vq.query.optimizely_x === want && vq.path === '/resp/' && varImg.tag.width === t.width, [varImg.tag.url, varImg.tag.width]);
    ok(tag + 'the two halves are different captures', prodImg.tag.n !== varImg.tag.n);
    eq(tag + 'canvas size is the tile width by 646', cv.w + 'x' + cv.h, t.width + 'x646');
    eq(tag + 'JPEG quality 0.7', cv.quality, 0.7);
    eq(tag + 'type image/jpeg', cv.type, 'image/jpeg');
    ok(tag + 'every bitmap was closed', BITMAPS.filter(function (b) { return b.tag === prodImg.tag || b.tag === varImg.tag; }).every(function (b) { return b.closed; }));
    ok(tag + 'the variant band reads its label with the gap', cv.ops.some(function (o) { return o.k === 'text' && o.fill === RS_TILE.text && o.text.indexOf(t.target + ' · ' + t.width + ' px · gap ') === 0; }));
    ok(tag + 'the PROD band text', cv.ops.some(function (o) { return o.k === 'text' && o.text.indexOf('PROD · ' + t.width + ' px') === 0; }));
  });
  ok('T2 (v1@375): PROD did not show the hero, so its band says the text was not found', canvasOfImg(rec.tiles[1].img).ops.some(function (o) { return o.k === 'text' && /same text not found/.test(o.text); }));
  ok('T1 found the legal line on PROD', !canvasOfImg(rec.tiles[0].img).ops.some(function (o) { return o.k === 'text' && /same text not found/.test(o.text); }));
  ok('each tile has a boundary line in the mark colour (width 2)', rec.tiles.every(function (t) { return canvasOfImg(t.img).ops.some(function (o) { return o.k === 'line' && o.stroke === RS_TILE.mark && o.width === 2; }); }));
  ok('a tile id is referenced by its rows', row(rec, 'rs.v0.320.1').tile === 'T1' && row(rec, 'rs.v1.375.1').tile === 'T2' && row(rec, 'rs.v1.320.1').tile === 'T3' && row(rec, 'rs.v1.320.2').tile === 'T3');
  ok('every row tile id exists in the record', rec.rows.every(function (r) { return !r.tile || rec.tiles.some(function (t) { return t.id === r.tile; }); }));
  ok('the record holds the debug-safe tile fields', rec.tiles.every(function (t) { return typeof t.side === 'string' && typeof t.text === 'string' && typeof t.img === 'string'; }));
  eq('shots were taken after the scan, in the same load: every shot has a PROD or variant URL', caps.every(function (c) { return c.url === B + '/resp/' || /optimizely_x=73/.test(c.url); }), true);
  eq('no blob was ever built from a plain array (every bitmap decoded)', BITMAPS.filter(function (b) { return b.tag; }).length >= 6, true);
});

T('resp: the direct calls on qkwCompose (A20, A.8)', function () {
  CURRENT = RESP.w.st;
  function cap(n, url, width) {
    var bytes = [n & 255, (n >> 8) & 255, 81], c = { n: n, data: qkBase64(bytes), bytes: bytes, url: url, width: width };
    CURRENT.caps.push(c);
    return c.data;
  }
  var okLayout = rsTileLayout({ width: 375, target: 'v1', gapPx: -21, side: 'right', text: 'X', prod: { found: true, rect: { x: 0, y: 380, w: 300, h: 22 }, vw: 375, vh: 844 }, variant: { found: true, rect: { x: 0, y: 380, w: 396, h: 22 }, vw: 375, vh: 844 } });
  var pd = cap(901, B + '/resp/', 375), vd = cap(902, B + '/resp/?optimizely_x=7302', 375);
  var good = settleP(__QKW.qkwCompose(okLayout, { prod: pd, variant: vd }));
  ok('a good layout with both captures composes to a JPEG data URL', good.done && /^data:image\/jpeg;base64,/.test(good.v), good.e && String(good.e));
  var cv = canvasOfImg(good.v);
  ok('and drew two images from those two captures', cv && cv.ops.filter(function (o) { return o.k === 'image'; }).map(function (o) { return o.tag.n; }).join() === '901,902');
  var unknown = settleP(__QKW.qkwCompose({ w: 10, h: 10, quality: 0.7, ops: [{ op: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#fff' }, { op: 'blob', x: 1 }] }, { prod: null, variant: vd }));
  ok('an op of an unknown kind gives null', unknown.done && unknown.v === null, unknown.v);
  var legacy = settleP(__QKW.qkwCompose({ w: 10, h: 10, quality: 0.7, ops: [{ kind: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#fff' }] }, { prod: null, variant: vd }));
  ok('an op in another spelling (kind: instead of op:) gives null, not a guess', legacy.done && legacy.v === null);
  var noSrc = settleP(__QKW.qkwCompose({ w: 10, h: 10, quality: 0.7, ops: [{ op: 'image', src: 'prod', sx: 0, sy: 0, sw: 10, sh: 10, dx: 0, dy: 0, dw: 10, dh: 10 }] }, { prod: null, variant: vd }));
  ok('an image op whose src half is null in imgs gives null', noSrc.done && noSrc.v === null);
  var wrongHalf = settleP(__QKW.qkwCompose({ w: 10, h: 10, quality: 0.7, ops: [{ op: 'image', src: 'prod', sx: 0, sy: 0, sw: 10, sh: 10, dx: 0, dy: 0, dw: 10, dh: 10 }] }, { prod: null, variant: vd }));
  ok('the variant capture is never drawn in the PROD half', wrongHalf.v === null && !CANVASES[CANVASES.length - 1].ops.some(function (o) { return o.k === 'image'; }));
  var asObj = settleP(__QKW.qkwCompose({ w: 10, h: 10, quality: 0.7, ops: [{ op: 'image', src: 'prod', sx: 0, sy: 0, sw: 10, sh: 10, dx: 0, dy: 0, dw: 10, dh: 10 }] }, { prod: { data: pd }, variant: vd }));
  ok('imgs.prod given as {data} gives null', asObj.done && asObj.v === null);
  var badSrc = settleP(__QKW.qkwCompose({ w: 10, h: 10, quality: 0.7, ops: [{ op: 'image', src: 'other', sx: 0, sy: 0, sw: 10, sh: 10, dx: 0, dy: 0, dw: 10, dh: 10 }] }, { prod: pd, variant: vd }));
  ok('an image op with src other than prod or variant gives null', badSrc.done && badSrc.v === null);
  var notB64 = settleP(__QKW.qkwCompose(okLayout, { prod: '***', variant: vd }));
  ok('a capture that is not base64 gives null', notB64.done && notB64.v === null);
  var unknownBytes = settleP(__QKW.qkwCompose(okLayout, { prod: qkBase64([9, 9, 9]), variant: vd }));
  ok('bytes that are no capture fail createImageBitmap, and the tile is null', unknownBytes.done && unknownBytes.v === null);
  var noImgs = settleP(__QKW.qkwCompose(okLayout, null));
  ok('no imgs at all gives null for a layout that needs them', noImgs.done && noImgs.v === null);
  var noProdLayout = rsTileLayout({ width: 375, target: 'v1', gapPx: -21, side: 'right', text: 'X', prod: null, variant: { found: true, rect: { x: 0, y: 380, w: 396, h: 22 }, vw: 375, vh: 844 } });
  var np = settleP(__QKW.qkwCompose(noProdLayout, { prod: null, variant: vd }));
  ok('a layout with no PROD image op composes with only the variant capture', np.done && /^data:image\/jpeg;base64,/.test(np.v));
  var npc = canvasOfImg(np.v);
  eq('and drew one drawImage', npc.ops.filter(function (o) { return o.k === 'image'; }).length, 1);
  ok('plus the placeholder rect', npc.ops.some(function (o) { return o.k === 'rect' && o.fill === RS_TILE.placeholderFill; }));
  ok('and the placeholder label', npc.ops.some(function (o) { return o.k === 'text' && /^PROD was not captured at 375 px$/.test(o.text); }));
  // the stub is strict in the way Chrome is: this is what would catch the A20 bug
  var arrBlob = new Blob([[255, 216, 255]], { type: 'image/jpeg' });
  jeq('the Blob stub keeps a plain-array part as its TEXT (Chrome does)', arrBlob.bytes, [50, 53, 53, 44, 50, 49, 54, 44, 50, 53, 53]);
  var arrBmp = settleP(createImageBitmap(arrBlob));
  ok('and createImageBitmap rejects it', arrBmp.done && !!arrBmp.e);
  jeq('a Uint8Array part stays bytes', new Blob([new Uint8Array([1, 2, 3])]).bytes, [1, 2, 3]);
  jeq('an ArrayBuffer part stays bytes', new Blob([new Uint8Array([4, 5]).buffer]).bytes, [4, 5]);
  var good2 = settleP(createImageBitmap(new Blob([new Uint8Array([901 & 255, (901 >> 8) & 255, 81])])));
  ok('createImageBitmap decodes exactly a capture', good2.done && good2.v && good2.v.tag.n === 901);
  ok('every tile stays in the record unchanged by these calls', RESP.rec.tiles.length === 3);
});

T('resp: a tile whose PROD half was not captured (D22)', function () {
  var w = mkWorld({ kind: 'resp', shotReject: function (st) { return st.lastNavUrl === B + '/resp/'; } });
  var out = runWorld(w, 'runResponsiveness', respInput(respCtx()));
  var rec = out.res.record;
  eq('the run finishes ok', out.res.ok, true);
  eq('3 tiles still drawn', rec.tiles.length, 3);
  ok('every tile has an image', rec.tiles.every(function (t) { return /^data:image\/jpeg;base64,/.test(t.img); }));
  rec.tiles.forEach(function (t) {
    var cv = canvasOfImg(t.img);
    eq(t.id + ': one drawImage (the variant half only)', cv.ops.filter(function (o) { return o.k === 'image'; }).length, 1);
    ok(t.id + ': the one image is the variant capture of that variation', QK_FAKE.parse(cv.ops.filter(function (o) { return o.k === 'image'; })[0].tag.url).query.optimizely_x === (t.target === 'v0' ? '7301' : '7302'));
    ok(t.id + ': the placeholder rect is drawn', cv.ops.some(function (o) { return o.k === 'rect' && o.fill === RS_TILE.placeholderFill; }));
    ok(t.id + ': and its label', cv.ops.some(function (o) { return o.k === 'text' && o.text === 'PROD was not captured at ' + t.width + ' px'; }));
  });
  eq('only variant shots were captured', w.st.caps.every(function (c) { return /optimizely_x=73/.test(c.url); }), true);
  eq('rs.v0.320.1 says alsoOnProd yes (the scan, not the shot, decides)', row(rec, 'rs.v0.320.1').extra.alsoOnProd, 'yes');
  eq('and still references its tile', row(rec, 'rs.v0.320.1').tile, 'T1');
});

T('resp: a failed variant capture is not a tile, and the rows say so (A25)', function () {
  var w = mkWorld({ kind: 'resp', shotReject: function (st) { return /optimizely_x=7302/.test(st.lastNavUrl || ''); } });
  var out = runWorld(w, 'runResponsiveness', respInput(respCtx()));
  var rec = out.res.record;
  eq('the run finishes ok', out.res.ok, true);
  eq('only the v0 tile exists', rec.tiles.filter(function (t) { return t.img; }).map(function (t) { return t.target; }).join(), 'v0');
  ok('a v1 failing row names no tile and says it was not captured', row(rec, 'rs.v1.375.1').tile === null && /no tile \(not captured\)$/.test(row(rec, 'rs.v1.375.1').evidence), row(rec, 'rs.v1.375.1').evidence);
  ok('no row names a tile that has no image', rec.rows.every(function (r) { return !r.tile || rec.tiles.some(function (t) { return t.id === r.tile && t.img; }); }));
});

T('resp-live (Appendix D.6): one PROD navigation, then resized', function () {
  var ctx = { ticketKey: 'QK-7', experimentId: '7201', previewLinks: [{ id: 'v1', url: B + '/resp-live/?optimizely_x=7302&cro_mode=qa' }], itwLink: B + '/resp-live/?cro_mode=qa' };
  var input = respInput(ctx, { widths: '375,1280' });
  var w = mkWorld({ kind: 'resp' });
  var out = runWorld(w, 'runResponsiveness', input);
  var rec = out.res.record;
  eq('the run finishes ok', out.res.ok, true);
  eq('16 keys', Object.keys(rec).length, 16);
  eq('plan.prodMode is resize', rec.plan.prodMode, 'resize');
  jeq('plan.prodLiveIds holds 7202', rec.plan.prodLiveIds, ['7202']);
  eq('exactly one PROD navigation', count(w.st.nav, function (u) { return u === B + '/resp-live/'; }), 1);
  eq('two navigations in all (one variant per width... one PROD)', w.st.nav.length, 3);
  eq('rs.prod passes', row(rec, 'rs.prod').status, 'passed');
  ok('and names the resize and 7202', /resizing one load/.test(row(rec, 'rs.prod').observed) && /7202/.test(row(rec, 'rs.prod').observed), row(rec, 'rs.prod').observed);
  var widths = paramsOf(cmds(w, 'Emulation.setDeviceMetricsOverride')).map(function (p) { return p.width; });
  jeq('metrics: variant 375, variant 1280, PROD 375, then the PROD resize to 1280', widths, [375, 1280, 375, 1280]);
  var navAt = navIdx(w), cmdsAfterProd = RC(w).slice(navAt[navAt.length - 1] + 1).filter(function (c) { return c.m === 'Emulation.setDeviceMetricsOverride'; });
  eq('after the PROD navigation there is exactly one more override, for the other width', cmdsAfterProd.length + ':' + (cmdsAfterProd[0] && cmdsAfterProd[0].p.width), '1:1280');
  eq('only the PROD sweep entries share a load id', rec.sweep.filter(function (e) { return e.role === 'prod'; }).map(function (e) { return e.loadId; }).join(), 'L3,L3');
  eq('the PROD sweep mode is resize for both', rec.sweep.filter(function (e) { return e.role === 'prod'; }).map(function (e) { return e.mode; }).join(), 'resize,resize');
  eq('3 loads in all: two variant and one PROD', rec.loads.length, 3);
  eq('a shim on each of the three loads (all clean visitors)', cmds(w, 'Page.addScriptToEvaluateOnNewDocument').length, 3);
  ok('no navigation carries a tracking flag', !w.st.nav.some(function (u) { return WK_FLAG.test(u); }));
  ok('the override is still cleared at the end', afterLastNav(w, 'Emulation.clearDeviceMetricsOverride').length === 1);
  var fk = fakeRun(RS_ENGINE, input, 'resp');
  jeq('the fake io agrees on every row', idStat(rec), idStat(fk));
  eq('fresh visitors: the one PROD load', qkFreshCount(rec.loads), 1);
});

T('resp: bot check and stop (Appendix D.6)', function () {
  var ctxBot = { ticketKey: 'QK-8', previewLinks: [{ id: 'v0', url: B + '/blocked/?optimizely_x=7301' }] };
  var canvases0 = CANVASES.length;
  var w = mkWorld({ kind: 'resp' });
  var out = runWorld(w, 'runResponsiveness', respInput(ctxBot, { widths: '375,1280' }));
  var rec = out.res.record;
  ok('halted at the first load', !!rec.halted && /\/blocked\/$/.test(rec.halted.path), rec.halted);
  eq('exactly one navigation', w.st.nav.length, 1);
  jeq('every row listed: both widths and rs.prod', ids(rec), ['rs.v0.375', 'rs.v0.1280', 'rs.prod']);
  ok('every row Not Tested with the D23 sentence', rec.rows.every(function (r) { return r.status === 'blocked' && /^Blocked: a bot check \(title: Just a moment\.\.\.\) on .*\/blocked\/ halted the run; it was never attempted\.$/.test(r.evidence); }), rec.rows.map(function (r) { return r.evidence; }));
  eq('WARNING end line', consoleLines(w)[1].level, 'WARNING');
  ok('and it says halted', /Run halted by a bot check on /.test(consoleLines(w)[1].text));
  eq('the tab closed and the debugger detached', w.st.tabsRemoved + ',' + cmds(w, 'detach').length, '1,1');
  eq('no tile was drawn and no canvas was made', rec.tiles.length + ',' + (CANVASES.length - canvases0), '0,0');
  // stop
  var allW = QK_WIDTHS.join(',');
  var w2 = mkWorld({ kind: 'resp', onNavigate: function (n, url, w0) { if (n === 3) sendStop(w0); } });
  var out2 = runWorld(w2, 'runResponsiveness', respInput(respCtx(), { widths: allW }));
  var rec2 = out2.res.record;
  eq('stopped', rec2.stopped, true);
  eq('three navigations, none after the stop', w2.st.nav.length, 3);
  ok('the remaining rows say Stopped', count(rec2.rows, function (r) { return /^Stopped: by the tester before this ran\.$/.test(r.evidence); }) > 30);
  eq('WARNING and stopped by the tester', consoleLines(w2)[1].level + '|' + /Run stopped by the tester in /.test(consoleLines(w2)[1].text), 'WARNING|true');
  eq('the detach and tab close still happen', cmds(w2, 'detach').length + ',' + w2.st.tabsRemoved, '1,1');
  ok('no tile image after a stop', rec2.tiles.every(function (t) { return t.img === null; }));
  eq('no PROD navigation after the stop', count(w2.st.nav, function (u) { return u === B + '/resp/'; }), 0);
});

T('resp: ignore list reaches the page scan (D20)', function () {
  var input = respInput(respCtx(), { ignore: RS_IGNORE_DEFAULTS.concat(['.legal']).join('\n') });
  var w = mkWorld({ kind: 'resp' });
  var out = runWorld(w, 'runResponsiveness', input);
  var rec = out.res.record;
  eq('rs.v0.320 passes with .legal ignored', row(rec, 'rs.v0.320').status, 'passed');
  ok('no LEGAL-LINE row anywhere', !/LEGAL-LINE/.test(JSON.stringify(rec.rows)));
  eq('the hero still fails on v1 at 375', row(rec, 'rs.v1.375.1').status, 'failed');
  eq('the scans ran in the isolated world', w.st.execs.filter(function (e) { return e.name === 'qkClipScanFn'; }).every(function (e) { return e.world === 'ISOLATED'; }), true);
  eq('the stored record carries the list used', JSON.stringify(rec.input.ignore.slice(-1)), '[".legal"]');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// wiring
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
T('wiring: importScripts, the stop line, the router', function () {
  var first = WORKER_SRC.slice(WORKER_SRC.indexOf('importScripts('));
  eq('B imports the three modules in D3\'s order, before qa-pass.js', first.indexOf("importScripts('metric-match.js', 'pixelmatch.js', 'vd-config.js', 'vd-diff.js', 'figma.js', 'browserstack.js', 'qa-kit.js', 'itw-activation.js', 'responsiveness.js', 'qa-pass.js', 'email-check.js');"), 0);
  eq('and importScripts is the first statement (no executable line before it)', WORKER_SRC.split('\n').filter(function (l) { return l.trim() && !/^\s*\/\//.test(l); })[0].indexOf('importScripts('), 0);
  var lines = WORKER_SRC.split('\n');
  var ec = -1;
  lines.forEach(function (l, i) { if (/^\s*_ecStopRequested = true;/.test(l)) ec = i; });
  ok('the stop handler sets _ecStopRequested', ec > 0);
  ok('and the very next line sets _qkStopRequested', /^\s*_qkStopRequested = true;/.test(lines[ec + 1]), lines[ec + 1]);
  eq('_qkStopRequested = true appears once', count(lines, function (l) { return /^\s*_qkStopRequested = true;/.test(l); }), 1);
  ok('_qkStopRequested is reset to false at the start of a run', /_qkRunning = true;\s*\n\s*_qkStopRequested = false;/.test(WORKER_SRC));
  var a = WORKER_SRC.indexOf("msg.action === 'runItwActivation' || msg.action === 'runResponsiveness'");
  ok('the router branch exists', a > 0);
  var branch = WORKER_SRC.slice(a, WORKER_SRC.indexOf("msg.action === 'summarizeTestAgentResults'"));
  ok('the router checks _qkRunning before beginTmRun', branch.indexOf('_qkRunning') > 0 && branch.indexOf('_qkRunning') < branch.indexOf('beginTmRun'), branch.indexOf('_qkRunning') + ',' + branch.indexOf('beginTmRun'));
  ok('and answers the refusal before awaiting anything', branch.indexOf('already going') < branch.indexOf('await beginTmRun'));
  ok('endTmRun runs in finally', /finally \{\s*await endTmRun\(\);/.test(branch));
  ok('the router refuses when a module is not loaded', /This mode is not loaded in the service worker/.test(branch));
  ok('the branch sits after ecSheetApply', WORKER_SRC.indexOf("msg.action === 'ecSheetApply'") < a);
  eq('the worker accepts both actions only from an extension page', (function () {
    var w = mkWorld({ kind: 'resp' });
    var o = { done: false };
    w.listeners[0]({ action: 'runResponsiveness', payload: { input: respInput(respCtx()), winId: 1, runId: 'x' } }, { url: 'https://evil.example/page' }, function (r) { o.done = true; o.res = r; });
    return o.done && o.res.ok === false && /Not allowed from a web page/.test(o.res.error) && w.st.created.length === 0;
  })(), true);
});

T('wiring: the new section of B', function () {
  var h = WORKER_SRC.indexOf('// ── Shared kit modes (ITW Activation, Responsiveness): the worker side');
  var e = WORKER_SRC.indexOf("// ── QA Pass (Test Agent mode 'qapass')");
  ok('the section is found, before QA Pass', h > 0 && e > h);
  var sect = WORKER_SRC.slice(h, e);
  var names = [];
  sect.split('\n').forEach(function (l) {
    var m = /^(?:async )?function\s+([A-Za-z_$][\w$]*)/.exec(l) || /^(?:let|const|var)\s+([A-Za-z_$][\w$]*)/.exec(l);
    if (m) names.push(m[1]);
    var m2 = /^let\s+[\w$]+\s*=[^,;]*,\s*([\w$]+)\s*=/.exec(l);
    if (m2) names.push(m2[1]);
  });
  var want = ['_qkStopRequested', '_qkRunning', '_qkwDebug', '_qkwDebugLast', 'qkwStopError', 'qkwSleep', 'qkwDebug', 'qkwDebugFlush', 'qkwRead', 'qkwCdp', 'qkwWaitLoad', 'qkwNavigate', 'qkwViewport', 'qkwClearState', 'qkwLoad', 'qkwReadExperimentState', 'qkwFacts', 'qkwCatalog', 'qkwTrustedClick', 'qkwStorageNames', 'qkwScan', 'qkwShot', 'qkwCompose', 'qkwConsole', 'qkwIo', 'qkwRunMode'];
  jeq('the section defines exactly the names of S6, in order', names, want);
  ok('none of them is a qp* or ec* name', names.every(function (n) { return !/^(qp|ec)/.test(n); }));
  ok('every function has the qkw prefix', names.filter(function (n) { return n.charAt(0) !== '_'; }).every(function (n) { return /^qkw/.test(n); }));
  eq('the section sends no user-agent or touch emulation', /setUserAgentOverride|setTouchEmulationEnabled/.test(sect.replace(/\/\/.*$/gm, '')), false);
  eq('the only viewport call is mobile:false at scale 1', (sect.match(/Emulation\.setDeviceMetricsOverride/g) || []).length + ',' + /mobile: false/.test(sect) + ',' + /deviceScaleFactor: 1/.test(sect), '1,true,true');
  ok('the section has no fetch and no cookie writer of its own', !/\bfetch\(/.test(sect) && !/Network\.setCookie/.test(sect));
  var top = WORKER_SRC.split('\n').filter(function (l) { return /^(qk|QK_|ia|IA_|rs|RS_)[A-Za-z_]/.test(l); });
  eq('B has no top-level line starting qk, QK_, ia, IA_, rs or RS_', top.length, 0);
  var defs = WORKER_SRC.split('\n').filter(function (l) { return /^(?:async\s+)?(?:function|const|let|var)\s+(?:qk(?!w)|QK_|ia[A-Z_]|IA_|rs[A-Z_]|RS_)/.test(l); });
  eq('and defines no name of another file\'s prefix', defs.length, 0, defs);
});

T('wiring: the Test Agent summary reads the projections (D30)', function () {
  var w = mkWorld({ kind: 'resp' });
  var RAW = 'RAWDATA-MARKER';
  var tileImg = 'data:image/jpeg;base64,' + RAW + 'AAAA';
  var ia = clone(ITW.rec); ia.input.itwUrl = 'http://127.0.0.1:8777/' + RAW;
  var rs = clone(RESP.rec); rs.tiles[0].img = tileImg; rs.input.prodUrl = 'http://127.0.0.1:8777/' + RAW;
  var results = [
    { mode: 'itwactivation', name: 'ITW Activation', status: 'ran', data: ia },
    { mode: 'responsiveness', name: 'Responsiveness', status: 'ran', data: rs },
  ];
  var p = __QKW.buildTestAgentSummaryPrompt(results, null);
  ok('the prompt names both modes', /ITW Activation: ran/.test(p) && /Responsiveness: ran/.test(p));
  ok('no data: image reaches the prompt', p.indexOf('data:image') < 0);
  ok('and no raw record field does', p.indexOf(RAW) < 0);
  ok('the projection rows are there (verdict, check, observed)', /"verdict":"Fail \(emulated\)"/.test(p) && /"verdict":"Fail"/.test(p));
  ok('the counts are there', /"counts":\{"fail":4,"pgm":0,"platform":0,"notTested":0,"pass":4\}/.test(p) || /"counts":/.test(p));
  ok('no tile or load or sweep array is in the prompt', !/"tiles"|"sweep"|"loads"/.test(p));
  eq('the prompt equals the projection, for Mode 1', p.indexOf(JSON.stringify(iaSummaryProjection(ia)).slice(0, 200)) > 0, true);
  eq('and for Mode 5', p.indexOf(JSON.stringify(rsSummaryProjection(rs)).slice(0, 200)) > 0, true);
  // without the projection functions the entry falls back to its raw data (and the raw marker shows)
  var saved = { ia: globalThis.iaSummaryProjection, rs: globalThis.rsSummaryProjection };
  delete globalThis.iaSummaryProjection; delete globalThis.rsSummaryProjection;
  var p2 = '';
  try { p2 = __QKW.buildTestAgentSummaryPrompt(results, null); } finally { globalThis.iaSummaryProjection = saved.ia; globalThis.rsSummaryProjection = saved.rs; }
  ok('without the projections it falls back to the raw data', p2.indexOf('"mode":"itwactivation"') > 0 || p2.indexOf('"mode":"responsiveness"') > 0, p2.slice(0, 200));
  ok('and the fallback does not throw (the typeof guard)', p2.length > 0);
  ok('the projections are restored', typeof iaSummaryProjection === 'function' && typeof rsSummaryProjection === 'function');
  var p3 = __QKW.buildTestAgentSummaryPrompt([{ mode: 'itwactivation', name: 'ITW Activation', status: 'failed', reason: 'boom' }], null);
  ok('a failed mode says so and sends no data', /ITW Activation: failed \(boom\)/.test(p3));
  var p4 = __QKW.buildTestAgentSummaryPrompt([{ mode: 'qapass', name: 'QA Pass', status: 'ran', data: { checks: [] } }], null);
  ok('a mode with its own projection keeps working', /QA Pass: ran/.test(p4));
});

T('wiring: the worker boots with no qk / ia / rs global defined (no top-level reference)', function () {
  var saved = {};
  Object.keys(globalThis).forEach(function (k) {
    if (/^(qk|QK_|ia|IA_|rs|RS_)/.test(k)) { saved[k] = globalThis[k]; delete globalThis[k]; }
  });
  var n = Object.keys(saved).length;
  var err = null, w = null;
  try {
    w = QA_HARNESS.makeWorld({ page: QA_HARNESS.makePage({ url: 'about:blank' }) });
    w.src = '../background.js';
    w.boot();
  } catch (e) { err = e; }
  var routed = null;
  if (!err) {
    // with the modules missing, the router answers "not loaded" instead of throwing
    var o = { done: false };
    try { w.listeners[0]({ action: 'runItwActivation', payload: { input: {}, winId: 1 } }, SENDER, function (r) { o.done = true; o.res = r; }); drainMicrotasks(); routed = o; } catch (e2) { err = e2; }
  }
  Object.keys(saved).forEach(function (k) { globalThis[k] = saved[k]; });
  ok('a good number of globals were removed (qa-kit, ia, rs)', n > 150, n);
  ok('background.js boots without any of them', err === null && !!w, err && String(err));
  ok('and the router answers that the mode is not loaded', routed && routed.done && routed.res.ok === false && /not loaded in the service worker/.test(routed.res.error), routed && routed.res);
  ok('the globals are back for the tests after it', typeof qkNewLoad === 'function' && typeof IA_ENGINE === 'object' && typeof RS_ENGINE === 'object');
  ok('and a fresh world still runs a mode', (function () { var w2 = mkWorld({ kind: 'resp' }); var o2 = runWorld(w2, 'runResponsiveness', respInput(respCtx(), { widths: '375' })); return o2.res.ok === true; })());
});

T('hardening: the run input is re-sanitized in the worker (A9, A24)', function () {
  var w = mkWorld({ kind: 'itw' });
  var out = runWorld(w, 'runItwActivation', null);
  ok('a null payload input is handled (the sanitizer builds an empty input and the run ends, or answers a masked error)', out.done && out.res && (out.res.ok === true || out.res.ok === false));
  eq('and the worker is released afterwards', runWorld(mkWorld({ kind: 'resp' }), 'runResponsiveness', respInput(respCtx(), { widths: '375' })).res.ok, true);
  var w2 = mkWorld({ kind: 'resp' });
  var bad = respInput(respCtx(), { widths: '375' });
  bad.storedKeys = ['*', 'a*', 'ab*', 'qk_*'];
  var o2 = runWorld(w2, 'runResponsiveness', bad);
  jeq('Mode 5 drops the short and lone * patterns too', o2.res.record.input.storedKeys, ['qk_*']);
  ok('and no shim carries a lone * or a short prefix', cmds(w2, 'Page.addScriptToEvaluateOnNewDocument').every(function (c) { return c.p.source.indexOf('var A=["qk_*"],') > 0; }));
  ok('no cookie outside the names was deleted', paramsOf(cmds(w2, 'Network.deleteCookies')).every(function (p) { return p.name !== 'session'; }));
  var withFlag = itwInput(itwCtx({ itwLink: B + '/itw/?cro_mode=qa&optimizely_force_tracking=true', previewLinks: [] }));
  var w3 = mkWorld({ kind: 'itw' });
  runWorld(w3, 'runItwActivation', withFlag);
  ok('an ITW link carrying optimizely_force_tracking is loaded without it', w3.st.nav.length > 0 && !w3.st.nav.some(function (u) { return WK_FLAG.test(u); }), w3.st.nav.filter(function (u) { return WK_FLAG.test(u); }));
  var refused = itwInput(itwCtx({ itwLink: B + '/itw/?optimizely_x=7102&cro_mode=qa' }));
  var w4 = mkWorld({ kind: 'itw' });
  var o4 = runWorld(w4, 'runItwActivation', refused);
  ok('a forced ITW link is refused (D16): no navigation carries optimizely_x=7102', !w4.st.nav.some(function (u) { return /optimizely_x=7102/.test(u); }), w4.st.nav);
  eq('and the only plain /itw/ navigation is the PROD one with no query', count(w4.st.nav, function (u) { return u === B + '/itw/'; }), 1);
  eq('the refusal row is there', o4.res.record.rows[0].id, 'ia.itw.refused');
});

// ── report ─────────────────────────────────────────────────────────────────
print('');
if (failures.length) {
  print('FAILURES:');
  failures.forEach(function (f) { print('  - ' + f); });
}
print('=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
