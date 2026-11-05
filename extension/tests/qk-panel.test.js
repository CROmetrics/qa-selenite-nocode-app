// qk-panel suite — the panel engine (qkUi*) of the shared-kit modes ITW Activation and Responsiveness.
//
//   RUN:  cd extension/tests && jsc qk-panel.test.js
//
// What this pins: popup.js's block "Shared kit modes (ITW Activation, Responsiveness) — panel side" is sliced out and
// evaluated in a fake world (elements built from the REAL popup.html markup, a scripted chrome.runtime.sendMessage, a
// chrome.storage.local map, sessionNS, captured downloads). Registration, init chain, markup parity of both panels,
// placeholders, stored overrides and settings, the run wrapper's refusals and answers, the results, the Live debug box,
// restore after a reopen. SYNTHETIC DATA ONLY (127.0.0.1, ticket keys QK-n).

load('../metric-match.js');
load('../qa-kit.js');
load('../itw-activation.js');
load('../responsiveness.js');
load('qk-fake-io.js');

var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 300) : ''));
}
function eq(name, actual, expected) { ok(name, actual === expected, { actual: actual, expected: expected }); }
function jeq(name, actual, expected) { var a = JSON.stringify(actual), e = JSON.stringify(expected); ok(name, a === e, { actual: a, expected: e }); }
function section(t) { print('\n' + t); }
// A section that throws is ONE failure and the next section still runs.
function T(title, fn) {
  section(title);
  var p0 = pass, f0 = fail;
  try { fn(); } catch (e) { fail++; failures.push(title + '  THREW ' + String(e && e.message ? e.message : e).slice(0, 200)); }
  print('  [' + (pass - p0) + ' passed, ' + (fail - f0) + ' failed]');
}
function settle(p) {
  var o = { done: false, v: undefined, e: undefined };
  Promise.resolve(p).then(function (v) { o.done = true; o.v = v; }, function (e) { o.done = true; o.e = e; });
  drainMicrotasks();
  return o;
}
function withGlobals(stubs, fn) {
  var saved = {}, had = {};
  Object.keys(stubs).forEach(function (k) { had[k] = Object.prototype.hasOwnProperty.call(globalThis, k); saved[k] = globalThis[k]; globalThis[k] = stubs[k]; });
  try { return fn(); } finally { Object.keys(stubs).forEach(function (k) { if (had[k]) globalThis[k] = saved[k]; else delete globalThis[k]; }); }
}
function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
function count(hay, needle) { return hay.split(needle).length - 1; }

// ── sources ────────────────────────────────────────────────────────────────
var PU = readFile('../popup.js');
var HTML = { popup: readFile('../popup.html'), side: readFile('../sidepanel.html') };
var FROM = '// ── Shared kit modes (ITW Activation, Responsiveness) — panel side';
var TO = "// ── Email Check (Test Agent mode 'emailcheck') — panel side";
function slicePu(from, to) {
  var a = PU.indexOf(from), b = PU.indexOf(to, a + 1);
  if (a === -1 || b === -1) throw new Error('slice marker missing: ' + from);
  return PU.slice(a, b);
}
var BLOCK = slicePu(FROM, TO);
var ESC_SRC = slicePu('function esc(s) {', '\nfunction ');
var BLOCK_CODE = BLOCK.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');

// Top-level names the block declares.
var FN_NAMES = [], CONST_NAMES = [];
BLOCK.split('\n').forEach(function (l) {
  var m = /^(?:async )?function (\w+)/.exec(l);
  if (m) FN_NAMES.push(m[1]);
  var c = /^(?:const|let|var) (.+?);/.exec(l);
  if (c) c[1].split(/\s*,\s*(?=\w+ =)/).forEach(function (part) { var n = /^(\w+)/.exec(part); if (n) CONST_NAMES.push(n[1]); });
});
var ALL_NAMES = FN_NAMES.concat(CONST_NAMES);
function loadApi() {
  return new Function(ESC_SRC + '\n' + BLOCK + '\nreturn {' + FN_NAMES.join(',') + '};')();
}

// ── markup ─────────────────────────────────────────────────────────────────
function region(html, p) {
  var a = html.indexOf('<div class="card" id="' + p + '-body">');
  var b = html.indexOf('id="' + p + '-results"', a);
  if (a < 0 || b < 0) throw new Error('region missing: ' + p);
  return html.slice(a, html.indexOf('</div>', b) + 6);
}
function tagOf(html, id) {
  var m = new RegExp('<[a-z]+\\b[^>]*\\bid="' + id + '"[^>]*>').exec(html);
  return m ? m[0] : null;
}
var IA_IDS = ['ia-body', 'ia-ctx', 'ia-itw', 'ia-control', 'ia-exp', 'ia-activation', 'ia-trigger', 'ia-subpages', 'ia-stay', 'ia-audiences', 'ia-keys',
  'ia-returning', 'ia-redirect', 'btn-ia-clear-inputs', 'ia-visitor-note', 'ia-progress', 'ia-debug', 'ia-debug-out', 'btn-ia-debug-copy', 'ia-results'];
var RS_IDS = ['rs-body', 'rs-ctx', 'rs-targets', 'rs-prod', 'rs-exp', 'rs-keys', 'rs-widths', 'rs-ignore', 'rs-ignore-status', 'btn-rs-ignore-reset',
  'btn-rs-clear-inputs', 'rs-visitor-note', 'rs-progress', 'rs-debug', 'rs-debug-out', 'btn-rs-debug-copy', 'rs-results'];

// ── the fake world ─────────────────────────────────────────────────────────
function parseEls(reg) {
  var out = [], re = /<(input|textarea|select|div|button|label)\b([^>]*)>/g, m;
  while ((m = re.exec(reg))) {
    var id = /\bid="([^"]+)"/.exec(m[2]);
    if (!id) continue;
    var ph = /\bplaceholder="([^"]*)"/.exec(m[2]);
    var options = [];
    if (m[1] === 'select') {
      var rest = reg.slice(m.index, reg.indexOf('</select>', m.index));
      var ore = /<option[^>]*>([^<]*)<\/option>/g, om;
      while ((om = ore.exec(rest))) options.push({ textContent: om[1] });
    }
    out.push({ id: id[1], tag: m[1], attrs: ph ? { placeholder: ph[1] } : {}, options: options });
  }
  return out;
}
function mkWorld(o) {
  o = o || {};
  var E = { els: {}, sent: [], replies: {}, local: {}, sessionSets: [], sessionGets: {}, ctx: null, downloads: [], blobs: [], timeouts: [], intervals: [],
    cleared: 0, revoked: [], clip: [], progressLog: [], clock: 1760000000000, lastBlob: null, sessionUse: o.sessionUse || null };
  var html = o.html || HTML.popup;
  parseEls(region(html, 'ia')).concat(parseEls(region(html, 'rs'))).forEach(function (d) {
    var listeners = {};
    var el = { id: d.id, tag: d.tag, value: '', innerHTML: '', style: {}, attrs: d.attrs, options: d.options, listeners: listeners, scrollHeight: 0, scrollTop: 0, clientHeight: 0,
      setAttribute: function (n, v) { this.attrs[n] = String(v); }, getAttribute: function (n) { return n in this.attrs ? this.attrs[n] : null; },
      hasAttribute: function (n) { return n in this.attrs; }, addEventListener: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      closest: function () { return null; } };
    var text = '';
    Object.defineProperty(el, 'textContent', { get: function () { return text; }, set: function (v) { text = String(v); if (/-progress$/.test(d.id)) E.progressLog.push(text); }, enumerable: true });
    E.els[d.id] = el;
  });
  E.els['ta-status'] = { id: 'ta-status', textContent: '', style: {}, attrs: {} };
  E.fire = function (id, ev, evt) {
    var el = E.els[id];
    (el.listeners[ev] || []).forEach(function (fn) { fn(evt || { target: el, currentTarget: el }); });
  };
  function area(name) {
    return {
      get: function (keys) {
        var o2 = {};
        (typeof keys === 'string' ? [keys] : keys).forEach(function (k) { if (k in E.local) o2[k] = clone(E.local[k]); });
        return Promise.resolve(o2);
      },
      set: function (o2) { Object.assign(E.local, clone(o2)); return Promise.resolve(); },
    };
  }
  var FakeDate = function () {
    var a = [].slice.call(arguments);
    return a.length ? new (Function.prototype.bind.apply(Date_, [null].concat(a)))() : new Date_(E.clock);
  };
  var Date_ = Date;
  FakeDate.now = function () { return ++E.clock; };
  FakeDate.prototype = Date_.prototype;
  E.globals = function () {
    var chrome = { runtime: { sendMessage: function (msg) {
      E.sent.push(msg);
      var r = E.replies[msg.action];
      try { return Promise.resolve(typeof r === 'function' ? r(msg) : r); } catch (e) { return Promise.reject(e); }
    } }, storage: { local: area('local') } };
    if (E.sessionUse) chrome.storage.session = { getBytesInUse: function () { return Promise.resolve(E.sessionUse.used); }, QUOTA_BYTES: E.sessionUse.quota };
    return {
      Date: FakeDate,
      document: {
        getElementById: function (id) { return E.els[id] || null; },
        createElement: function () { return { click: function () { E.downloads.push({ href: this.href, download: this.download, blob: E.lastBlob }); } }; },
        createDocumentFragment: function () {
          return { querySelector: function (s) {
            if (count(s, '[') > count(s, ']') || count(s, '(') > count(s, ')')) throw new SyntaxError('not a valid selector: ' + s);
            return null;
          } };
        },
      },
      chrome: chrome,
      getActiveContext: function () { return Promise.resolve(E.ctx); },
      sessionNS: {
        get: function (k) { var o2 = {}; if (k in E.sessionGets) o2[k] = clone(E.sessionGets[k]); return Promise.resolve(o2); },
        set: function (o2) { E.sessionSets.push(clone(o2)); Object.assign(E.sessionGets, clone(o2)); return Promise.resolve(); },
      },
      WIN_ID: 7,
      setInterval: function (fn, ms) { E.intervals.push({ fn: fn, ms: ms }); return E.intervals.length; },
      clearInterval: function () { E.cleared++; },
      setTimeout: function (fn, ms) { E.timeouts.push({ fn: fn, ms: ms }); return E.timeouts.length; },
      Blob: function (parts, opts) { this.parts = parts; this.type = opts && opts.type; },
      URL: { createObjectURL: function (b) { E.lastBlob = b; return 'blob:qk' + E.downloads.length; }, revokeObjectURL: function (u) { E.revoked.push(u); } },
      navigator: { clipboard: { writeText: function (t) { E.clip.push(t); return Promise.resolve(); } } },
    };
  };
  E.run = function (fn) { return withGlobals(E.globals(), fn); };
  return E;
}
// Runs a panel function in the world and settles it.
function W(E, fn) { var r; E.run(function () { r = settle(fn()); }); return r; }

// ── records from the real engines on the fake sites ────────────────────────
var B = QK_FAKE.base;
function itwCtx(over) {
  var c = {
    ticketKey: 'QK-1', experimentId: '7001', platform: 'Optimizely', reviewed: true,
    previewLinks: [{ id: 'v0', url: B + '/itw/?optimizely_x=7101&cro_mode=qa&optimizely_force_tracking=true' }, { id: 'v1', url: B + '/itw/?optimizely_x=7102&cro_mode=qa' }],
    itwLink: B + '/itw/?cro_mode=qa', activationType: 'trigger', triggerDescription: 'Clicking Start quiz', triggerSelector: '#start-quiz',
    subPages: ['/itw/help/'], stayActivePages: ['/itw/step2/'],
    specAudiences: [
      { name: 'QA param', role: 'inclusion', type: 'query', param: 'cro_mode', value: 'qa', description: '' },
      { name: 'No Meta', role: 'exclusion', type: 'query', param: 'utm_source', value: 'meta', description: '' }],
    storedStateKeys: ['qk_quiz_*'], returningVisitor: 'active', redirectDestination: B + '/landing-ok/',
  };
  Object.keys(over || {}).forEach(function (k) { c[k] = over[k]; });
  return c;
}
function respCtx() {
  return { ticketKey: 'QK-6', experimentId: '7201', platform: 'Optimizely', reviewed: true,
    previewLinks: [{ id: 'v0', url: B + '/resp/?optimizely_x=7301&cro_mode=qa' }, { id: 'v1', url: B + '/resp/?optimizely_x=7302&cro_mode=qa' }],
    itwLink: B + '/resp/?cro_mode=qa' };
}
function mkRecord(engine, kind, input) {
  var site = QK_FAKE.sites[kind](), io = QK_FAKE.makeIo(site);
  var inp = engine.sanitize(input), rec = engine.newRecord(inp, io.now());
  settle(engine.run(io, rec, inp).then(function () {}, function (e) {
    if (qkIsHalt(e)) rec.halted = e.halted; else if (qkIsStop(e)) rec.stopped = true; else rec.error = qkMaskOutput(String(e && e.message || e));
  }));
  rec.finishedAt = io.now();
  rec.rows = engine.derive(rec);
  return rec;
}
var IA_INPUT = iaBuildInput(itwCtx(), {}).input;
var RS_INPUT = rsBuildInput(respCtx(), { widths: '320,375,1280', ignore: RS_IGNORE_DEFAULTS.join('\n') }).input;
var REC_IA = mkRecord(IA_ENGINE, 'itw', IA_INPUT);
var REC_RS = mkRecord(RS_ENGINE, 'resp', RS_INPUT);
function hasTileImg(rec) { return (rec.tiles || []).some(function (t) { return t && t.img; }); }

// A booted panel: fresh engine, the world, init + show for one mode.
function boot(cfg, ctx, o) {
  var E = (o && o.world) || mkWorld(o);
  E.ctx = ctx;
  var API = loadApi();
  W(E, function () { return API.qkUiInit(cfg); });
  W(E, function () { return API.qkUiOnShow(cfg); });
  return { E: E, API: API };
}
function ticketFields(cfg) { return cfg.fields.filter(function (f) { return f.scope === 'ticket'; }); }

// ═══════════════════════════════════════════════════════════════════════════
T('the block: anchors, names and pins', function () {
  ok('the block was sliced (starts at its header, is not empty)', BLOCK.indexOf(FROM) === 0 && BLOCK.length > 5000);
  jeq('the block declares exactly the two top-level const lines (S9b)', BLOCK.split('\n').filter(function (l) { return /^(const|let|var) /.test(l); }),
    ['const _qkUi = {};', 'const qkUiDebugSilentMs = 8000, qkUiDebugStallMs = 60000, qkUiMaxTickets = 30;']);
  var dups = ALL_NAMES.filter(function (n, i) { return ALL_NAMES.indexOf(n) !== i; });
  jeq('no name is defined twice', dups, []);
  ok('no top-level QK_* name (rule 0.2)', !ALL_NAMES.some(function (n) { return /^QK_/.test(n); }));
  ok('no qk* name outside qkUi*', ALL_NAMES.filter(function (n) { return /^qk/.test(n) && !/^qkUi/.test(n); }).length === 0, ALL_NAMES);
  jeq('the only names outside qkUi* are the five of rule 0.2', ALL_NAMES.filter(function (n) { return !/^qkUi/.test(n); }).sort(),
    ['_qkUi', 'initItwActivation', 'initResponsiveness', 'runItwActivationMode', 'runResponsivenessMode']);
  ok('the block has at least 25 functions (the slice is the engine)', FN_NAMES.length >= 25, FN_NAMES.length);
  ok('no qpw / ecw name in the block', !/\b(qpw|ecw)[A-Za-z]/.test(BLOCK_CODE));
  ok('no model id and no model call in the block', !/claude-|opus|sonnet|haiku|anthropic|callClaude/i.test(BLOCK_CODE));
  ok('no Jira route in the block', !/atlassian|jira|\/rest\/api/i.test(BLOCK_CODE));
  eq('no QK_UI_ constant is left anywhere in popup.js', count(PU, 'QK_UI_'), 0);
  eq('the field lookup never adds the prefix (A11)', count(PU, "qkUiEl(cfg.prefix + '-' + f.id)"), 0);
  eq('the two run wrappers are async (A19)', PU.split('\n').filter(function (l) { return /^async function run(ItwActivation|Responsiveness)Mode\(\) \{ return qkUiRunMode\((IA|RS)_PANEL\); \}$/.test(l); }).length, 2);
  eq('the two init wrappers are async', PU.split('\n').filter(function (l) { return /^async function init(ItwActivation|Responsiveness)\(\) \{ return qkUiInit\((IA|RS)_PANEL\); \}$/.test(l); }).length, 2);
  var portLine = "_panelPort.onMessage.addListener((msg) => { if (msg && msg.action === 'qkDebug' && typeof qkUiDebugTake === 'function') qkUiDebugTake(msg); });";
  eq('the port listener line exists once, typeof-guarded', count(PU, portLine), 1);
  ok('it sits after the QA Pass port listener', PU.indexOf(portLine) > PU.indexOf("msg.action === 'qpDebug'"));
  ok('the block reaches the worker by sendMessage with cfg.action and nothing else', count(BLOCK_CODE, 'chrome.runtime.sendMessage') === 1 && /action: cfg\.action/.test(BLOCK_CODE));
});

T('init chain: one try/catch each, after Email Check, before the Settings overlay', function () {
  var ec = PU.indexOf('await initEmailCheck();'), ia = PU.indexOf('await initItwActivation();'), rs = PU.indexOf('await initResponsiveness();'), so = PU.indexOf('// ── Settings overlay');
  eq('initItwActivation is awaited once', count(PU, 'await initItwActivation();'), 1);
  eq('initResponsiveness is awaited once', count(PU, 'await initResponsiveness();'), 1);
  ok('order: Email Check, ITW Activation, Responsiveness, Settings overlay', ec > 0 && ia > ec && rs > ia && so > rs, [ec, ia, rs, so]);
  ok('ITW Activation in its own try/catch with its message', /try \{\n\s*await initItwActivation\(\);\n\s*\} catch \(e\) \{\n\s*console\.error\('Selenite: ITW Activation failed to initialize —', e\);\n\s*\}/.test(PU));
  ok('Responsiveness in its own try/catch with its message', /try \{\n\s*await initResponsiveness\(\);\n\s*\} catch \(e\) \{\n\s*console\.error\('Selenite: Responsiveness failed to initialize —', e\);\n\s*\}/.test(PU));
  ok('the two calls are not in the same try', PU.slice(ia, rs).indexOf('} catch') > 0);
});

T('registration: TA_MODES entries', function () {
  var a = PU.indexOf("  'itwactivation': {"), b = PU.indexOf('\n};\nlet _taActiveBody');
  ok('the entries were found', a > 0 && b > a);
  var calls = [];
  var fn = new Function('runItwActivationMode', 'runResponsivenessMode', 'qkUiState', 'qkUiOnShow', 'IA_PANEL', 'RS_PANEL', 'return {' + PU.slice(a, b) + '};');
  var IAP = { tag: 'ia' }, RSP = { tag: 'rs' };
  var M = fn(function () { calls.push('ia'); return 'ia-run'; }, function () { calls.push('rs'); return 'rs-run'; },
    function (m) { return { last: 'last-of-' + m }; }, function (c) { calls.push('show:' + c.tag); return Promise.resolve(); }, IAP, RSP);
  jeq('exactly the two entries', Object.keys(M), ['itwactivation', 'responsiveness']);
  eq('ia label', M.itwactivation.label, 'ITW Activation');
  eq('ia body', M.itwactivation.bodyId, 'ia-body');
  eq('ia home', M.itwactivation.homeParentId, 'ta-mode-homes');
  eq('rs label', M.responsiveness.label, 'Responsiveness');
  eq('rs body', M.responsiveness.bodyId, 'rs-body');
  eq('rs home', M.responsiveness.homeParentId, 'ta-mode-homes');
  eq('ia standalone', M.itwactivation.standalone, true);
  eq('rs standalone', M.responsiveness.standalone, true);
  ok('neither is agenticLocked', !('agenticLocked' in M.itwactivation) && !('agenticLocked' in M.responsiveness));
  eq('ia isConfigured', M.itwactivation.isConfigured(), true);
  eq('rs isConfigured', M.responsiveness.isConfigured(), true);
  eq('ia run calls its wrapper', M.itwactivation.run(), 'ia-run');
  eq('rs run calls its wrapper', M.responsiveness.run(), 'rs-run');
  eq('ia getData is the state of its mode', M.itwactivation.getData(), 'last-of-itwactivation');
  eq('rs getData is the state of its mode', M.responsiveness.getData(), 'last-of-responsiveness');
  M.itwactivation.onShow(); M.responsiveness.onShow();
  jeq('onShow calls qkUiOnShow with the module config', calls.filter(function (c) { return /^show/.test(c); }), ['show:ia', 'show:rs']);
  ok('the keys follow the Email Check entry in the source', PU.indexOf("  'emailcheck': {") < a);
});

T('markup: both panels, byte parity, ids, options, scripts', function () {
  ['ia', 'rs'].forEach(function (p) {
    eq('#' + p + '-body region is byte-identical in popup.html and sidepanel.html', region(HTML.popup, p), region(HTML.side, p));
    ok('#' + p + '-body region is not empty', region(HTML.popup, p).length > 1500);
  });
  [['popup.html', HTML.popup], ['sidepanel.html', HTML.side]].forEach(function (pair) {
    var name = pair[0], h = pair[1];
    IA_IDS.concat(RS_IDS).forEach(function (id) { eq(name + ': id ' + id + ' exactly once', count(h, 'id="' + id + '"'), 1); });
    eq(name + ': the ITW Activation option once', count(h, '<option value="itwactivation">ITW Activation</option>'), 1);
    eq(name + ': the Responsiveness option once', count(h, '<option value="responsiveness">Responsiveness</option>'), 1);
    var tags = ['email-check.js', 'qa-kit.js', 'itw-activation.js', 'responsiveness.js', 'popup.js'].map(function (s) { return h.indexOf('<script src="' + s + '"></script>'); });
    ok(name + ': the script tags are in D3 order (email-check, qa-kit, itw-activation, responsiveness, popup)', tags[0] > 0 && tags[1] > tags[0] && tags[2] > tags[1] && tags[3] > tags[2] && tags[4] > tags[3], tags);
    ['qa-kit.js', 'itw-activation.js', 'responsiveness.js'].forEach(function (s) { eq(name + ': ' + s + ' once', count(h, '<script src="' + s + '"></script>'), 1); });
    ok(name + ': the options follow the Email Check one', h.indexOf('<option value="emailcheck">') < h.indexOf('<option value="itwactivation">') && h.indexOf('<option value="itwactivation">') < h.indexOf('<option value="responsiveness">'));
    eq(name + ': #rs-widths has no placeholder attribute', /\bplaceholder=/.test(tagOf(h, 'rs-widths')), false);
    eq(name + ': #rs-ignore has no placeholder attribute', /\bplaceholder=/.test(tagOf(h, 'rs-ignore')), false);
    ['rs-targets', 'rs-prod', 'rs-exp', 'rs-keys'].forEach(function (id) { ok(name + ': #' + id + ' carries "not on the ticket"', /placeholder="not on the ticket"/.test(tagOf(h, id))); });
  });
  var iaReg = region(HTML.popup, 'ia');
  ['ia-activation', 'ia-returning'].forEach(function (id) {
    var i = iaReg.indexOf('id="' + id + '"');
    ok(id + ' first option is the empty From the ticket', /<option value="" selected>From the ticket<\/option>/.test(iaReg.slice(i, iaReg.indexOf('</select>', i))));
  });
});

T('field configs against the markup (A11)', function () {
  [[IA_PANEL, 'ia'], [RS_PANEL, 'rs']].forEach(function (pair) {
    var cfg = pair[0], p = pair[1], seen = [];
    cfg.fields.forEach(function (f) {
      ok(p + ': ' + f.id + ' starts with ' + p + '-', f.id.indexOf(p + '-') === 0);
      eq(p + ': key of ' + f.id + ' is the id without the prefix', f.key, f.id.slice(p.length + 1));
      eq(p + ': ' + f.id + ' once in popup.html', count(HTML.popup, 'id="' + f.id + '"'), 1);
      eq(p + ': ' + f.id + ' once in sidepanel.html', count(HTML.side, 'id="' + f.id + '"'), 1);
      ok(p + ': ' + f.id + ' is listed once', seen.indexOf(f.id) < 0); seen.push(f.id);
    });
  });
  var E = mkWorld(), API = loadApi();
  E.els['ia-itw'].value = 'https://x.example/';
  E.run(function () {
    eq('a short id resolves to no element', API.qkUiField(IA_PANEL, { id: 'itw', key: 'itw' }), null);
    eq('the whole id resolves to its element', API.qkUiField(IA_PANEL, { id: 'ia-itw', key: 'itw' }), E.els['ia-itw']);
    jeq('a config with a short id reads an empty value, never the prefixed element', API.qkUiReadValues({ fields: [{ key: 'itw', id: 'itw' }] }), { itw: '' });
    jeq('the real config reads the typed value', API.qkUiReadValues(IA_PANEL).itw, 'https://x.example/');
  });
});

T('lazy state and prefix', function () {
  var API = loadApi(), s = API.qkUiState('x');
  jeq('exactly last, debug, loadedFor', Object.keys(s), ['last', 'debug', 'loadedFor']);
  jeq('the debug object keys', Object.keys(s.debug).sort(), ['done', 'lastWorkerAt', 'panel', 'runId', 'sentAt', 'sessionUse', 'silentWarned', 'stallWarnedAt', 'worker']);
  eq('done starts true', s.debug.done, true);
  eq('last starts null', s.last, null);
  eq('the same object comes back', API.qkUiState('x'), s);
  ok('no prefix before anything ran', !('prefix' in s));
  var E = mkWorld();
  E.run(function () { settle(API.qkUiInit(IA_PANEL)); });
  eq('prefix after qkUiInit', API.qkUiState('itwactivation').prefix, 'ia');
  var E2 = mkWorld(), A2 = loadApi();
  E2.run(function () { settle(A2.qkUiOnShow(RS_PANEL)); });
  eq('prefix after qkUiOnShow', A2.qkUiState('responsiveness').prefix, 'rs');
  var E3 = mkWorld(), A3 = loadApi();
  E3.run(function () { A3.qkUiDebugStart(IA_PANEL); });
  eq('prefix after qkUiDebugStart', A3.qkUiState('itwactivation').prefix, 'ia');
  eq('the other mode stays untouched', A3.qkUiState('responsiveness').prefix, undefined);
});

T('ticket key and selectors', function () {
  var API = loadApi();
  eq('ticket key', API.qkUiTicketKey({ ticketKey: ' QK-3 ' }), 'QK-3');
  eq('no context is _none', API.qkUiTicketKey(null), '_none');
  eq('an empty key is _none', API.qkUiTicketKey({ ticketKey: '  ' }), '_none');
  var E = mkWorld();
  E.run(function () {
    eq('the first invalid line is returned (D20, A13)', API.qkUiValidateSelectors(['div', 'a[', 'p']), 'a[');
    eq('all valid gives null', API.qkUiValidateSelectors(['div']), null);
    eq('an unbalanced parenthesis is invalid', API.qkUiValidateSelectors(['a:not(b']), 'a:not(b');
    eq('no lines gives null', API.qkUiValidateSelectors([]), null);
    var frag = document.createDocumentFragment();
    var threw = null;
    try { frag.querySelector('a['); } catch (e) { threw = e; }
    ok('the fake fragment throws a SyntaxError on a bracket', threw && threw.name === 'SyntaxError');
    eq('and returns null for a valid selector', frag.querySelector('div'), null);
  });
  eq('slim: tile images are deleted, the rest kept', JSON.stringify(API.qkUiSlim({ a: 1, tiles: [{ id: 'T1', img: 'data:image/jpeg;base64,AAAA' }] })), '{"a":1,"tiles":[{"id":"T1"}]}');
  var src = { tiles: [{ id: 'T1', img: 'x' }] }; API.qkUiSlim(src);
  eq('slim is a deep copy: the source keeps its image', src.tiles[0].img, 'x');
  eq('qkUiMb', API.qkUiMb(1048576 * 2.5), '2.5 MB');
});

T('placeholders and the context line (D14, A1, A12)', function () {
  var ctx = itwCtx();
  var P = boot(IA_PANEL, ctx), E = P.E;
  eq('the context line is the mode\'s ctxLine', E.els['ia-ctx'].textContent, iaCtxLine(ctx));
  ticketFields(IA_PANEL).filter(function (f) { return f.kind !== 'select'; }).forEach(function (f) {
    eq('ia placeholder of ' + f.id + ' = ph(ctx)', E.els[f.id].getAttribute('placeholder'), f.ph(ctx).trim() || 'not on the ticket');
  });
  eq('the select first option shows the ticket value (activation)', E.els['ia-activation'].options[0].textContent, 'From the ticket: On a trigger');
  eq('the select first option shows the ticket value (returning)', E.els['ia-returning'].options[0].textContent, 'From the ticket: Stays active');
  ok('multi-line placeholders join with a newline (audiences)', E.els['ia-audiences'].getAttribute('placeholder').indexOf('\n') > 0);
  // a ticket with none of it
  var S = boot(IA_PANEL, { ticketKey: 'QK-2', reviewed: true });
  ticketFields(IA_PANEL).filter(function (f) { return f.kind !== 'select'; }).forEach(function (f) {
    eq('ia placeholder of ' + f.id + ' with nothing on the ticket', S.E.els[f.id].getAttribute('placeholder'), 'not on the ticket');
  });
  eq('select default with nothing (activation)', S.E.els['ia-activation'].options[0].textContent, 'From the ticket: not stated');
  eq('select default with nothing (returning)', S.E.els['ia-returning'].options[0].textContent, 'From the ticket: not stated');
  // no context at all
  var N = boot(IA_PANEL, null);
  eq('no context: the ctx line', N.E.els['ia-ctx'].textContent, 'No active ticket context — use the Initialize tab, or fill in the inputs below');
  eq('no context: a text placeholder', N.E.els['ia-itw'].getAttribute('placeholder'), 'not on the ticket');
  eq('no context: a lines placeholder', N.E.els['ia-subpages'].getAttribute('placeholder'), 'not on the ticket');
  eq('no context: select default', N.E.els['ia-activation'].options[0].textContent, 'From the ticket: not stated');
  // Mode 5
  var rctx = respCtx(), R = boot(RS_PANEL, rctx);
  ticketFields(RS_PANEL).forEach(function (f) {
    eq('rs placeholder of ' + f.id + ' = ph(ctx)', R.E.els[f.id].getAttribute('placeholder'), f.ph(rctx).trim() || 'not on the ticket');
  });
  eq('rs: #rs-prod shows the derived PROD url', R.E.els['rs-prod'].getAttribute('placeholder'), B + '/resp/');
  eq('rs: #rs-widths still has no placeholder after init and show', R.E.els['rs-widths'].getAttribute('placeholder'), null);
  eq('rs: #rs-ignore still has no placeholder after init and show', R.E.els['rs-ignore'].getAttribute('placeholder'), null);
  var RN = boot(RS_PANEL, null);
  eq('rs: no context: #rs-targets', RN.E.els['rs-targets'].getAttribute('placeholder'), 'not on the ticket');
  eq('rs: no context: #rs-widths still none', RN.E.els['rs-widths'].getAttribute('placeholder'), null);
  eq('rs: no context: #rs-ignore still none', RN.E.els['rs-ignore'].getAttribute('placeholder'), null);
  eq('rs: no context: the ctx line', RN.E.els['rs-ctx'].textContent, 'No active ticket context — use the Initialize tab, or fill in the inputs below');
  var bad = boot(IA_PANEL, ctx, {}), badCfg = Object.assign({}, IA_PANEL, { ctxLine: function () { throw new Error('boom'); } });
  bad.E.run(function () { settle(bad.API.qkUiOnShow(badCfg)); });
  eq('a throwing ctxLine falls back to the no-context text', bad.E.els['ia-ctx'].textContent, 'No active ticket context — use the Initialize tab, or fill in the inputs below');
});

T('typed overrides: stored per ticket, never shown for another (D14, A16)', function () {
  var P = boot(IA_PANEL, itwCtx()), E = P.E;
  E.els['ia-itw'].value = 'https://shop.example/itw/';
  E.els['ia-subpages'].value = '/a/\n/b/';
  E.run(function () { E.fire('ia-body', 'input', { target: E.els['ia-itw'] }); drainMicrotasks(); });
  var ent = E.local.iaOverrides && E.local.iaOverrides['QK-1'];
  ok('the entry is stored under the ticket key', !!ent);
  eq('savedAt is a number', typeof ent.savedAt, 'number');
  jeq('values has exactly the ticket-scope keys', Object.keys(ent.values).sort(), ticketFields(IA_PANEL).map(function (f) { return f.key; }).sort());
  ok('every value is a string', Object.keys(ent.values).every(function (k) { return typeof ent.values[k] === 'string'; }));
  eq('the typed value is kept', ent.values.itw, 'https://shop.example/itw/');
  eq('a multi-line value is kept', ent.values.subpages, '/a/\n/b/');
  eq('the untouched fields are empty strings', ent.values.control, '');
  jeq('Mode 1 writes no settings key (only iaOverrides)', Object.keys(E.local), ['iaOverrides']);
  eq('IA_PANEL has no settings key', IA_PANEL.settingsKey, null);
  // the same tab shown again for another ticket
  E.ctx = { ticketKey: 'QK-2', reviewed: true };
  E.run(function () { settle(P.API.qkUiOnShow(IA_PANEL)); });
  eq('another ticket does not show the first one\'s typed value', E.els['ia-itw'].value, '');
  eq('nor its lines', E.els['ia-subpages'].value, '');
  E.ctx = itwCtx();
  E.run(function () { settle(P.API.qkUiOnShow(IA_PANEL)); });
  eq('back on the first ticket its typed value is restored', E.els['ia-itw'].value, 'https://shop.example/itw/');
  // an edit in progress survives a re-show
  E.els['ia-exp'].value = '7777';
  E.run(function () { settle(P.API.qkUiOnShow(IA_PANEL)); });
  eq('a re-show for the same ticket does not overwrite an edit in progress', E.els['ia-exp'].value, '7777');
  // Clear typed inputs
  E.run(function () { E.fire('btn-ia-clear-inputs', 'click'); drainMicrotasks(); });
  ticketFields(IA_PANEL).forEach(function (f) { if (E.els[f.id].value !== '') fail++, failures.push('clear left ' + f.id); });
  ok('Clear typed inputs empties every ticket-scope field', true);
  ok('and deletes that ticket\'s entry', !(E.local.iaOverrides && 'QK-1' in E.local.iaOverrides), E.local.iaOverrides);
  // emptying by hand reaches the same end state
  E.els['ia-itw'].value = 'x';
  E.run(function () { E.fire('ia-body', 'input', { target: E.els['ia-itw'] }); drainMicrotasks(); });
  ok('typing again stores an entry', !!E.local.iaOverrides['QK-1']);
  E.els['ia-itw'].value = '';
  E.run(function () { E.fire('ia-body', 'input', { target: E.els['ia-itw'] }); drainMicrotasks(); });
  ok('emptying every ticket-scope field deletes the entry', !('QK-1' in E.local.iaOverrides));
  // an input inside the results does not save
  E.els['ia-itw'].value = 'zzz';
  var before = JSON.stringify(E.local);
  E.local = {};
  E.run(function () { E.fire('ia-body', 'change', { target: { closest: function (s) { return s === '#ia-results' ? {} : null; } } }); drainMicrotasks(); });
  ok('an event from inside #ia-results saves nothing', Object.keys(E.local).length === 0, before);
  // no context: _none
  var N = boot(IA_PANEL, null);
  N.E.els['ia-exp'].value = '1';
  N.E.run(function () { N.E.fire('ia-body', 'input', { target: N.E.els['ia-exp'] }); drainMicrotasks(); });
  jeq('without a context the key is _none', Object.keys(N.E.local.iaOverrides), ['_none']);
  // 30 tickets
  var M = mkWorld(); M.ctx = { ticketKey: 'QK-NEW', reviewed: true };
  var seeded = {};
  for (var i = 1; i <= 30; i++) seeded['T' + i] = { savedAt: 1000 + i, values: { itw: 'v' + i } };
  seeded.T7.savedAt = 500;
  M.local.iaOverrides = seeded;
  var MA = loadApi();
  M.run(function () { settle(MA.qkUiInit(IA_PANEL)); settle(MA.qkUiOnShow(IA_PANEL)); });
  M.els['ia-itw'].value = 'new';
  M.run(function () { M.fire('ia-body', 'input', { target: M.els['ia-itw'] }); drainMicrotasks(); });
  var keys = Object.keys(M.local.iaOverrides);
  eq('a 31st ticket leaves 30 entries', keys.length, 30);
  ok('the entry with the oldest savedAt is the one dropped', keys.indexOf('T7') < 0 && keys.indexOf('QK-NEW') >= 0 && keys.indexOf('T1') >= 0, keys);
  // Mode 5 overrides hold the ticket-scope fields only
  var R = boot(RS_PANEL, respCtx());
  R.E.els['rs-prod'].value = 'https://shop.example/';
  R.E.run(function () { R.E.fire('rs-body', 'input', { target: R.E.els['rs-prod'] }); drainMicrotasks(); });
  jeq('rsOverrides values hold targets, prod, exp, keys only', Object.keys(R.E.local.rsOverrides['QK-6'].values).sort(), ['exp', 'keys', 'prod', 'targets']);
});

T('global settings: widths and ignore (D14, D20, A16, A17)', function () {
  var E0 = mkWorld(), A0 = loadApi();
  E0.run(function () { settle(A0.qkUiInit(RS_PANEL)); });
  eq('first start: the widths field holds the default list', E0.els['rs-widths'].value, RS_PANEL.fields[4].dflt);
  eq('first start: the ignore field holds RS_IGNORE_DEFAULTS', E0.els['rs-ignore'].value, RS_IGNORE_DEFAULTS.join('\n'));
  eq('first start: the ignore status is empty', E0.els['rs-ignore-status'].textContent, '');
  var P = boot(RS_PANEL, respCtx()), E = P.E;
  E.els['rs-widths'].value = '320, 375';
  E.els['rs-ignore'].value = 'div.x\n.y';
  E.run(function () { E.fire('rs-body', 'input', { target: E.els['rs-widths'] }); drainMicrotasks(); });
  jeq('rsSettings = {widths, ignore} raw text', E.local.rsSettings, { widths: '320, 375', ignore: 'div.x\n.y' });
  // a reopen
  var A2 = loadApi(), E2 = mkWorld(); E2.local = clone(E.local); E2.ctx = respCtx();
  E2.run(function () { settle(A2.qkUiInit(RS_PANEL)); });
  eq('widths persist across a reopen', E2.els['rs-widths'].value, '320, 375');
  eq('ignore persists across a reopen', E2.els['rs-ignore'].value, 'div.x\n.y');
  // invalid selector status
  E.els['rs-ignore'].value = 'div\na[\np';
  E.run(function () { E.fire('rs-body', 'input', { target: E.els['rs-ignore'] }); drainMicrotasks(); });
  eq('#rs-ignore-status names the bad line', E.els['rs-ignore-status'].textContent, 'Not a valid CSS selector: a[');
  E.els['rs-ignore'].value = 'div\np';
  E.run(function () { E.fire('rs-body', 'input', { target: E.els['rs-ignore'] }); drainMicrotasks(); });
  eq('and is empty once fixed', E.els['rs-ignore-status'].textContent, '');
  // reset
  E.els['rs-ignore'].value = 'custom';
  E.run(function () { E.fire('btn-rs-ignore-reset', 'click'); drainMicrotasks(); });
  eq('Reset restores RS_IGNORE_DEFAULTS in the field', E.els['rs-ignore'].value, RS_IGNORE_DEFAULTS.join('\n'));
  eq('and saves it', E.local.rsSettings.ignore, RS_IGNORE_DEFAULTS.join('\n'));
  eq('the widths setting is kept by a reset', E.local.rsSettings.widths, '320, 375');
  // a ticket change does not touch the globals
  E.ctx = { ticketKey: 'QK-9', reviewed: true };
  E.els['rs-widths'].value = '999';
  E.run(function () { settle(P.API.qkUiOnShow(RS_PANEL)); });
  eq('showing another ticket leaves the global widths alone', E.els['rs-widths'].value, '999');
  eq('Mode 5 clear-inputs leaves the global settings alone', (function () {
    E.run(function () { E.fire('btn-rs-clear-inputs', 'click'); drainMicrotasks(); });
    return E.els['rs-widths'].value;
  })(), '999');
});

// ── running ────────────────────────────────────────────────────────────────
function runWith(P, cfg, reply) {
  P.E.replies[cfg.action] = reply;
  var r;
  P.E.run(function () { r = settle(P.API.qkUiRunMode(cfg)); });
  return r;
}
var STALE = 'The service worker is older than this panel — reload Selenite in chrome://extensions and run again.';
var NOANS = 'The service worker did not answer the run: it is older than this panel, or Chrome stopped it mid-run. Reload Selenite in chrome://extensions and run again.';
function wl(P, text, level) { return qkDebugEntry('worker', level || 'info', text, P.E.clock = P.E.clock + 1); }

T('run: refusals send nothing', function () {
  var P = boot(RS_PANEL, respCtx());
  P.E.els['rs-ignore'].value = 'div\na[\np';
  var r = runWith(P, RS_PANEL, function () { return { ok: true, record: clone(REC_RS) }; });
  jeq('an invalid ignore selector refuses the run with the D20 message', r.v, { ok: false, error: 'Ignore list: not a valid CSS selector: a[' });
  eq('nothing was sent', P.E.sent.length, 0);
  ok('the message is shown in the results', P.E.els['rs-results'].innerHTML.indexOf('Ignore list: not a valid CSS selector: a[') > 0);
  eq('the box ends with the error line', P.API.qkUiDebugLines('responsiveness').slice(-1)[0].level, 'error');
  eq('no last run was set', P.API.qkUiState('responsiveness').last, null);
  var Q = boot(IA_PANEL, null);
  var r2 = runWith(Q, IA_PANEL, function () { return { ok: true, record: clone(REC_IA) }; });
  eq('buildInput refusal: ok false', r2.v.ok, false);
  eq('buildInput refusal: its sentence', r2.v.error, iaBuildInput(null, {}).error);
  eq('buildInput refusal: nothing sent', Q.E.sent.length, 0);
  ok('buildInput refusal: shown in the results', Q.E.els['ia-results'].innerHTML.indexOf('ITW Activation needs an ITW link') > 0);
  ok('the first debug line is the click line', Q.API.qkUiDebugLines('itwactivation')[0].text === 'Run clicked: reading the active ticket context');
  var bc = Object.assign({}, IA_PANEL, { buildInput: function () { throw new Error('kaboom'); } });
  var r3 = (function () { var x; Q.E.run(function () { x = settle(Q.API.qkUiRunMode(bc)); }); return x; })();
  jeq('a throwing buildInput is a refusal too', r3.v, { ok: false, error: 'kaboom' });
  var sent0 = Q.E.sent.length;
  eq('and sends nothing', sent0, 0);
  // A refusal echoes the tester's own line, so it is masked like every other output (? & = never ASCII).
  var M = boot(RS_PANEL, respCtx());
  M.E.els['rs-ignore'].value = 'a[href=x?y&z';
  var r4 = runWith(M, RS_PANEL, function () { return { ok: true, record: clone(REC_RS) }; });
  eq('a refused line with ? & = is masked in the answer', r4.v.error, qkMaskOutput('Ignore list: not a valid CSS selector: a[href=x?y&z'));
  ok('and the answer has no ASCII ? & =', !/[?&=]/.test(r4.v.error));
  var shown = M.E.els['rs-results'].innerHTML;
  ok('and the results show it masked', shown.indexOf('a[href＝x？y') > 0 && !/a\[href=/.test(shown));
  ok('and the debug box line is masked', !/[?&=]/.test(M.API.qkUiDebugLines('responsiveness').slice(-1)[0].text));
  var bw = Object.assign({}, IA_PANEL, { buildInput: function () { throw new Error('bad key a=b?c'); } });
  var r5 = (function () { var x; Q.E.run(function () { x = settle(Q.API.qkUiRunMode(bw)); }); return x; })();
  ok('a buildInput error with = and ? is masked too', r5.v.ok === false && !/[?&=]/.test(r5.v.error));
});

T('run: the worker\'s answers (A18, STALE_WORKER, NO_ANSWER)', function () {
  var P = boot(IA_PANEL, itwCtx());
  var r = runWith(P, IA_PANEL, function () { throw new Error('The message port closed before a response was received.'); });
  jeq('a closed port gives the NO_ANSWER sentence', r.v, { ok: false, error: NOANS });
  var P2 = boot(IA_PANEL, itwCtx());
  var r2 = runWith(P2, IA_PANEL, function () { throw new Error('Could not establish connection. Receiving end does not exist.'); });
  eq('no receiving end gives it too', r2.v.error, NOANS);
  var P3 = boot(IA_PANEL, itwCtx());
  var r3 = runWith(P3, IA_PANEL, function () { throw new Error('Quota exceeded somewhere'); });
  jeq('a rejection with another message returns that message', r3.v, { ok: false, error: 'Quota exceeded somewhere' });
  ok('and the box says the run message failed', P3.API.qkUiDebugLines('itwactivation').some(function (l) { return l.level === 'error' && /The run message failed: Quota exceeded/.test(l.text); }));
  var P4 = boot(IA_PANEL, itwCtx());
  var v2 = clone(REC_IA); v2.version = 2;
  var r4 = runWith(P4, IA_PANEL, function () { return { ok: true, record: v2 }; });
  jeq('a version-2 record gives the STALE_WORKER sentence', r4.v, { ok: false, error: STALE });
  eq('and sets no last run', P4.API.qkUiState('itwactivation').last, null);
  eq('and renders nothing', P4.E.els['ia-results'].innerHTML, '');
  var P5 = boot(IA_PANEL, itwCtx());
  var r5 = runWith(P5, IA_PANEL, function () { return { ok: false, error: 'No tab' }; });
  jeq('an {ok:false} answer is passed on', r5.v, { ok: false, error: 'No tab' });
  var r5b = runWith(boot(IA_PANEL, itwCtx()), IA_PANEL, function () { return undefined; });
  eq('an empty answer is a failure naming the mode', r5b.v.error, 'ITW Activation failed');
  // A18: error with no loads
  var errRec = clone(REC_IA); errRec.loads = []; errRec.error = 'fatal at http://127.0.0.1:8777/itw/?token=abc&b=1';
  var P6 = boot(IA_PANEL, itwCtx());
  var r6 = runWith(P6, IA_PANEL, function () { return { ok: true, record: errRec }; });
  jeq('a record with an error and no loads is {ok:false, masked error}', r6.v, { ok: false, error: qkMaskOutput(errRec.error) });
  ok('the masked error has no ASCII ? & =', !/[?&=]/.test(r6.v.error), r6.v.error);
  eq('last is unchanged', P6.API.qkUiState('itwactivation').last, null);
  eq('nothing from it is rendered', P6.E.els['ia-results'].innerHTML, '');
  var errRec2 = clone(REC_IA); errRec2.error = 'late failure at http://127.0.0.1:8777/x?a=b';
  var P7 = boot(IA_PANEL, itwCtx());
  var r7 = runWith(P7, IA_PANEL, function () { return { ok: true, record: errRec2 }; });
  eq('an error with loads is ok:true', r7.v.ok, true);
  ok('and rendered with the masked error line', P7.E.els['ia-results'].innerHTML.indexOf(esc_(qkMaskOutput(errRec2.error))) > 0);
  ok('with no ASCII ? in that line', P7.E.els['ia-results'].innerHTML.indexOf('/x?a=b') < 0);
});
function esc_(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

T('run: success, the sent message, the record, the results', function () {
  var P = boot(IA_PANEL, itwCtx()), E = P.E;
  var r = runWith(P, IA_PANEL, function () { return { ok: true, record: clone(REC_IA) }; });
  jeq('success is {ok:true}', r.v, { ok: true });
  var msg = E.sent[0];
  eq('the action', msg.action, 'runItwActivation');
  jeq('the payload input is what buildInput built', msg.payload.input, iaBuildInput(itwCtx(), E.run(function () { return P.API.qkUiReadValues(IA_PANEL); })).input);
  eq('the window id travels', msg.payload.winId, 7);
  ok('a run id travels', typeof msg.payload.runId === 'string' && msg.payload.runId.length > 3);
  var last = P.API.qkUiState('itwactivation').last;
  eq('record.ts is set', typeof last.ts, 'number');
  eq('last is the record (version 1)', last.version, 1);
  eq('session iaLastRun is set', typeof E.sessionGets.iaLastRun, 'object');
  eq('with the same ts', E.sessionGets.iaLastRun.ts, last.ts);
  ok('the session copy holds no data:image', JSON.stringify(E.sessionGets.iaLastRun).indexOf('data:image') < 0);
  var html = E.els['ia-results'].innerHTML;
  ['Check', 'Expected', 'Observed', 'Verdict', 'Evidence'].forEach(function (h) { ok('Mode 1 header ' + h, html.indexOf('<th>' + h + '</th>') > 0); });
  var firstHead = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
  eq('the first table has five headers', count(firstHead, '<th>'), 5);
  ok('the counts line', html.indexOf(esc_(qkCountsLine(qkCounts(last.rows)))) > 0);
  ok('the badge label', html.indexOf(qkBadge(last.rows, last.stopped, last.halted).label) > 0);
  ok('Download CSV is there', html.indexOf('<button class="btn sm" type="button" data-qk-csv>Download CSV</button>') > 0);
  ok('no tiles button for Mode 1', html.indexOf('data-qk-tiles') < 0);
  ok('a style block scopes the table to #ia-results', html.indexOf('#ia-results .qk-table') > 0);
  ok('non-Pass rows come first, passing rows folded', html.indexOf('<details><summary>Passing rows (') > 0 || qkCounts(last.rows).pass === 0);
  eq('the progress line is cleared at the end', E.els['ia-progress'].textContent, '');
  ok('the interval was cleared', E.cleared >= 1);
  eq('the tick runs every 800 ms', E.intervals[0].ms, 800);
  var lines = P.API.qkUiDebugLines('itwactivation');
  eq('first line', lines[0].text, 'Run clicked: reading the active ticket context');
  eq('last line', lines[lines.length - 1].text, 'Results shown below');
  ok('the ctx line, the inputs line and the sent line are in the box', lines.some(function (l) { return l.text === iaCtxLine(itwCtx()); }) && lines.some(function (l) { return /^Inputs: /.test(l.text); }) && lines.some(function (l) { return l.text === 'Sent the run to the service worker'; }));
  ok('with no worker step the box says the worker is older', lines.some(function (l) { return l.level === 'warn' && /sent no step of its own/.test(l.text); }));
  ok('the box is shown and holds the last line', E.els['ia-debug'].style.display === '' && E.els['ia-debug-out'].innerHTML.indexOf('Results shown below') > 0);
  eq('the debug box is persisted as iaDebugLast', E.sessionGets.iaDebugLast.length, lines.length);
  eq('the debug is done', P.API.qkUiState('itwactivation').debug.done, true);
  // the wrapper
  var W2 = boot(IA_PANEL, itwCtx());
  W2.E.replies.runItwActivation = { ok: true, record: clone(REC_IA) };
  var rr; W2.E.run(function () { rr = settle(W2.API.runItwActivationMode()); });
  jeq('runItwActivationMode runs the Mode 1 engine config', rr.v, { ok: true });
  eq('and sends runItwActivation', W2.E.sent[0].action, 'runItwActivation');
});
function qkUiVals(P) { return P.API.qkUiReadValues(IA_PANEL); }

T('run: downloads and masking', function () {
  var P = boot(IA_PANEL, itwCtx()), E = P.E;
  var rec = clone(REC_IA);
  rec.rows = rec.rows.concat([qkRow({ id: 'ia.x', step: 'x', check: '=SUM(A1) check', expected: 'e', observed: 'see http://127.0.0.1:8777/p?x=1&y=2#frag', status: 'passed', evidence: 'a=b & c?' })]);
  runWith(P, IA_PANEL, function () { return { ok: true, record: rec }; });
  var csvBtn = { hasAttribute: function (n) { return n === 'data-qk-csv'; } };
  E.run(function () { E.fire('ia-results', 'click', { target: { closest: function () { return csvBtn; } } }); });
  eq('one download', E.downloads.length, 1);
  var d = E.downloads[0], ts = P.API.qkUiState('itwactivation').last.ts, dt = new Date(ts);
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  eq('the CSV file name', d.download, 'itw-activation-QK-1-' + dt.getFullYear() + p2(dt.getMonth() + 1) + p2(dt.getDate()) + '-' + p2(dt.getHours()) + p2(dt.getMinutes()) + '.csv');
  ok('the file name matches the pattern', /^itw-activation-QK-1-\d{8}-\d{4}\.csv$/.test(d.download));
  eq('the Blob type is text/csv', d.blob.type, 'text/csv');
  var text = d.blob.parts[0];
  eq('the first line is the header', text.split('\r\n')[0], '"Check","Expected","Observed","Verdict","Evidence"');
  var body = text.split('\r\n').slice(1).join('\r\n');
  ok('the data cells hold no ASCII ? & =', !/[?&=]/.test(body), body.match(/.{0,30}[?&=].{0,30}/));
  ok('the =SUM cell cannot open as a formula (masked or guarded)', body.indexOf('SUM(A1)') > 0 && body.indexOf('"=SUM') < 0);
  eq('the CSV holds the header and every row (Pass included)', text.split('\r\n').length - 1, rec.rows.length + 1);
  ok('the revoke is scheduled after 1 s', E.timeouts.some(function (t) { return t.ms === 1000; }));
  E.run(function () { E.timeouts.forEach(function (t) { t.fn(); }); });
  eq('and revokes the object url', E.revoked.length, 1);
  ok('the href is the object url', /^blob:/.test(d.href));
  // a click that is not on a button does nothing
  E.run(function () { E.fire('ia-results', 'click', { target: { closest: function () { return null; } } }); });
  eq('a click elsewhere downloads nothing', E.downloads.length, 1);
  E.run(function () { E.fire('ia-results', 'click', { target: {} }); });
  eq('a target without closest downloads nothing', E.downloads.length, 1);
  // the halted banner
  var h = clone(REC_IA); h.halted = { loadId: 'L1', path: '/itw/', signal: 'challenge-page' };
  var PH = boot(IA_PANEL, itwCtx());
  runWith(PH, IA_PANEL, function () { return { ok: true, record: h }; });
  var hh = PH.E.els['ia-results'].innerHTML;
  ok('the halted banner text (D23)', hh.indexOf('A bot check (challenge-page) on /itw/ halted the run. Selenite never attempts these: open the page yourself in this Chrome, then run again once it loads normally.') > 0);
  ok('the banner is red', /color:var\(--err\)[^>]*>A bot check/.test(hh));
  ok('the box says halted by a bot check', PH.API.qkUiDebugLines('itwactivation').some(function (l) { return /halted by a bot check/.test(l.text); }));
  var nh = boot(IA_PANEL, itwCtx());
  runWith(nh, IA_PANEL, function () { return { ok: true, record: clone(REC_IA) }; });
  ok('no banner without a halt', nh.E.els['ia-results'].innerHTML.indexOf('A bot check') < 0);
});

T('Mode 5: twelve headers, tiles, slim session copy, the tiles file', function () {
  ok('the Mode 5 record has tiles with images', REC_RS.tiles.length >= 2 && hasTileImg(REC_RS), REC_RS.tiles.length);
  var P = boot(RS_PANEL, respCtx()), E = P.E;
  var r = runWith(P, RS_PANEL, function () { return { ok: true, record: clone(REC_RS) }; });
  jeq('success', r.v, { ok: true });
  eq('the action', E.sent[0].action, 'runResponsiveness');
  var html = E.els['rs-results'].innerHTML;
  RS_COLUMNS.forEach(function (c) { ok('Mode 5 header ' + c.label, html.indexOf('<th>' + c.label + '</th>') > 0); });
  eq('the first table has twelve headers', count(html.slice(html.indexOf('<thead>'), html.indexOf('</thead>')), '<th>'), 12);
  ok('Download CSV is there', html.indexOf('data-qk-csv') > 0);
  ok('Download tiles (HTML) appears when a tile has an image', html.indexOf('<button class="btn ghost sm" type="button" data-qk-tiles>Download tiles (HTML)</button>') > 0);
  var last = P.API.qkUiState('responsiveness').last;
  ok('last keeps the tile images', hasTileImg(last));
  ok('the session copy rsLastRun has no data:image', JSON.stringify(E.sessionGets.rsLastRun).indexOf('data:image') < 0);
  ok('but keeps the tile ids', E.sessionGets.rsLastRun.tiles.length === last.tiles.length && E.sessionGets.rsLastRun.tiles.every(function (t) { return !('img' in t); }));
  ok('the rendered table shows a tile image', html.indexOf('class="qk-tile"') > 0);
  var tilesBtn = { hasAttribute: function (n) { return n === 'data-qk-tiles'; } };
  E.run(function () { E.fire('rs-results', 'click', { target: { closest: function () { return tilesBtn; } } }); });
  eq('one tiles download', E.downloads.length, 1);
  var d = E.downloads[0];
  ok('its name', /^responsiveness-tiles-QK-6-\d{8}-\d{4}\.html$/.test(d.download), d.download);
  eq('its type is text/html', d.blob.type, 'text/html');
  var doc = d.blob.parts[0];
  ok('one self-contained document', doc.indexOf('<!doctype html>') === 0 && count(doc, '<html>') === 1);
  last.tiles.forEach(function (t) { ok('the tiles file holds ' + t.id, doc.indexOf('<figure id="' + t.id + '"') > 0 && doc.indexOf('alt="' + t.id + '"') > 0); });
  eq('as many figures as tiles', count(doc, '<figure '), last.tiles.length);
  ok('its title names the mode and the ticket', doc.indexOf('<title>Responsiveness tiles · QK-6</title>') > 0);
  // CSV
  var csvBtn = { hasAttribute: function (n) { return n === 'data-qk-csv'; } };
  E.run(function () { E.fire('rs-results', 'click', { target: { closest: function () { return csvBtn; } } }); });
  var csv = E.downloads[1];
  ok('the Mode 5 CSV name', /^responsiveness-QK-6-\d{8}-\d{4}\.csv$/.test(csv.download));
  var lines = csv.blob.parts[0].split('\r\n');
  eq('the Mode 5 CSV header has twelve columns', lines[0], RS_COLUMNS.map(function (c) { return '"' + c.label + '"'; }).join(','));
  ok('no ASCII ? & = in the data cells', !/[?&=]/.test(lines.slice(1).join('\r\n')));
  // no images: no tiles button
  var noImg = clone(REC_RS); noImg.tiles.forEach(function (t) { delete t.img; });
  var Q = boot(RS_PANEL, respCtx());
  runWith(Q, RS_PANEL, function () { return { ok: true, record: noImg }; });
  ok('with no tile image the tiles button is absent', Q.E.els['rs-results'].innerHTML.indexOf('data-qk-tiles') < 0);
  ok('the CSV button stays', Q.E.els['rs-results'].innerHTML.indexOf('data-qk-csv') > 0);
  // the tile LIST, never a map (A8)
  ok('the click passes record.tiles, the list', BLOCK.indexOf('rec.tiles || [], rec.rows || [])') > 0 && BLOCK.indexOf('qkTilesHtmlFile(') > 0);
});

T('the Live debug box: runs, modes, snapshots (D25, A14)', function () {
  var P = boot(IA_PANEL, itwCtx()), E = P.E, API = P.API;
  var r = runWith(P, IA_PANEL, function (msg) {
    var id = msg.payload.runId;
    API.qkUiDebugTake({ runId: 'an-old-run', mode: 'itwactivation', lines: [wl(P, 'OLD RUN LINE')] });
    API.qkUiDebugTake({ runId: id, mode: 'responsiveness', lines: [wl(P, 'OTHER MODE LINE')] });
    API.qkUiDebugTake({ runId: id, lines: [wl(P, 'NO MODE LINE')] });
    API.qkUiDebugTake(null);
    API.qkUiDebugTake({ runId: id, mode: 'itwactivation', lines: [] });
    API.qkUiDebugTake({ runId: id, mode: 'itwactivation', lines: [wl(P, 'The worker started the ITW Activation run'), wl(P, 'Closed the run tab after 3 load(s)')] });
    return { ok: true, record: clone(REC_IA), debug: { runId: id, mode: 'itwactivation', lines: [], storageError: null } };
  });
  eq('the run succeeded', r.v.ok, true);
  var texts = API.qkUiDebugLines('itwactivation').map(function (l) { return l.text; });
  ok('the current run\'s worker lines are in the box', texts.indexOf('The worker started the ITW Activation run') > 0 && texts.indexOf('Closed the run tab after 3 load(s)') > 0);
  ok('a feed for an old run id is ignored', texts.indexOf('OLD RUN LINE') < 0);
  ok('a feed for the other mode is ignored', texts.indexOf('OTHER MODE LINE') < 0);
  ok('a feed with no mode is ignored', texts.indexOf('NO MODE LINE') < 0);
  eq('the box starts with the click line', texts[0], 'Run clicked: reading the active ticket context');
  eq('and ends with the results line', texts[texts.length - 1], 'Results shown below');
  ok('worker lines carry src worker', API.qkUiDebugLines('itwactivation').filter(function (l) { return l.src === 'worker'; }).length === 2);
  ok('with a worker feed there is no "older code" warning', !texts.some(function (t) { return /sent no step of its own/.test(t); }));
  ok('lines are in time order', API.qkUiDebugLines('itwactivation').every(function (l, i, a) { return i === 0 || a[i - 1].t <= l.t; }));
  ok('no ASCII ? & = in any line', !texts.some(function (t) { return /[?&=]/.test(t); }), texts.filter(function (t) { return /[?&=]/.test(t); }));
  // snapshots
  var A2 = loadApi(), E2 = mkWorld();
  var id;
  E2.run(function () { id = A2.qkUiDebugStart(IA_PANEL); });
  var d = A2.qkUiState('itwactivation').debug;
  var l1 = qkDebugEntry('worker', 'info', 'one', 100), l2 = qkDebugEntry('worker', 'info', 'two', 200);
  E2.run(function () {
    A2.qkUiDebugTake({ runId: id, mode: 'itwactivation', lines: [l1] });
    eq('first snapshot taken', d.worker.length, 1);
    A2.qkUiDebugTake({ runId: id, mode: 'itwactivation', lines: [l1, l2] });
    eq('a newer snapshot of the current run replaces the worker lines', A2.qkUiState('itwactivation').debug.worker.length, 2);
    A2.qkUiDebugTake({ runId: id, mode: 'itwactivation', lines: [l1] });
    eq('a shorter older one does not', A2.qkUiState('itwactivation').debug.worker.length, 2);
    A2.qkUiDebugTake({ runId: id, mode: 'itwactivation', lines: [l1, qkDebugEntry('worker', 'info', 'rewritten', 300)] });
    eq('an equal-length snapshot with a newer last line replaces', A2.qkUiState('itwactivation').debug.worker[1].text, 'rewritten');
  });
  // the session pull
  var A3 = loadApi(), E3 = mkWorld(), id3;
  E3.run(function () { id3 = A3.qkUiDebugStart(IA_PANEL); });
  E3.sessionGets.qkDebug = { runId: id3, mode: 'responsiveness', lines: [qkDebugEntry('worker', 'info', 'for the other mode', 5)] };
  E3.run(function () { settle(A3.qkUiDebugPull(IA_PANEL)); });
  eq('a session qkDebug of the other mode is ignored', A3.qkUiState('itwactivation').debug.worker.length, 0);
  E3.sessionGets.qkDebug = { runId: id3, mode: 'itwactivation', lines: [qkDebugEntry('worker', 'info', 'mine', 5)] };
  E3.run(function () { settle(A3.qkUiDebugPull(IA_PANEL)); });
  eq('a session qkDebug of this mode is taken', A3.qkUiState('itwactivation').debug.worker.length, 1);
  // Copy
  var C = boot(IA_PANEL, itwCtx());
  runWith(C, IA_PANEL, function () { return { ok: true, record: clone(REC_IA) }; });
  var btn = C.E.els['btn-ia-debug-copy'];
  C.E.run(function () { C.E.fire('btn-ia-debug-copy', 'click', { currentTarget: btn }); drainMicrotasks(); });
  eq('Copy writes the box text', C.E.clip[0], qkDebugText(C.API.qkUiDebugLines('itwactivation')));
  eq('and the button says Copied', btn.textContent, 'Copied');
  C.E.run(function () { C.E.timeouts.forEach(function (t) { t.fn(); }); });
  eq('then goes back to Copy', btn.textContent, 'Copy');
  // storageError and the session-use lines
  var S = boot(IA_PANEL, itwCtx(), { sessionUse: { used: 1048576, quota: 10485760 } });
  runWith(S, IA_PANEL, function (msg) { return { ok: true, record: clone(REC_IA), debug: { runId: msg.payload.runId, mode: 'itwactivation', lines: [], storageError: 'QUOTA_BYTES quota exceeded' } }; });
  var st = S.API.qkUiDebugLines('itwactivation');
  ok('the session storage line', st.some(function (l) { return l.text === 'Session storage: 1.0 MB of 10.0 MB in use' && l.level === 'info'; }));
  ok('the worker storage error is a warning naming the error', st.some(function (l) { return l.level === 'warn' && /could not write to Chrome's session storage during the run \(QUOTA_BYTES quota exceeded\)/.test(l.text); }));
  var F = boot(IA_PANEL, itwCtx(), { sessionUse: { used: 9900000, quota: 10485760 } });
  runWith(F, IA_PANEL, function () { return { ok: true, record: clone(REC_IA) }; });
  ok('a nearly full session store is a warning', F.API.qkUiDebugLines('itwactivation').some(function (l) { return l.level === 'warn' && /Session storage: .* in use\. Nearly full/.test(l.text); }));
  // watch
  var Wc = loadApi(), WE = mkWorld(), wid;
  WE.run(function () { wid = Wc.qkUiDebugStart(IA_PANEL); });
  var wd = Wc.qkUiState('itwactivation').debug;
  wd.sentAt = 1000;
  WE.run(function () { Wc.qkUiDebugWatch(IA_PANEL, 5000); });
  eq('no warning before 8 s', wd.panel.length, 0);
  WE.run(function () { Wc.qkUiDebugWatch(IA_PANEL, 9500); });
  ok('a silent worker after 8 s is a warning with QA Pass\'s wording', wd.panel.length === 1 && wd.panel[0].level === 'warn' && /^No step from the worker 9 s after the run was sent\. A worker that runs older code than this panel writes none: reload Selenite in chrome:\/\/extensions and run again\./.test(wd.panel[0].text), wd.panel);
  WE.run(function () { Wc.qkUiDebugWatch(IA_PANEL, 20000); });
  eq('it is said once', wd.panel.length, 1);
  wd.worker = [qkDebugEntry('worker', 'info', 'last step', 1)]; wd.lastWorkerAt = 1000; wd.silentWarned = true;
  WE.run(function () { Wc.qkUiDebugWatch(IA_PANEL, 30000); });
  eq('under 60 s of quiet there is nothing new', wd.panel.length, 1);
  WE.run(function () { Wc.qkUiDebugWatch(IA_PANEL, 62000); });
  ok('a stall of 60 s names the last worker step', wd.panel.length === 2 && /^No new step from the worker for 61 s\. Its last: last step/.test(wd.panel[1].text), wd.panel);
  wd.done = true;
  WE.run(function () { Wc.qkUiDebugWatch(IA_PANEL, 200000); });
  eq('a finished run is not watched', wd.panel.length, 2);
  // the progress tick reads only its own mode
  var PT = boot(IA_PANEL, itwCtx());
  PT.E.replies.runItwActivation = function () {
    PT.E.sessionGets.qkProgress = { running: true, mode: 'responsiveness', phase: 'sweep', label: 'v1', width: 320, loads: 9 };
    PT.E.intervals[0].fn();
    drainMicrotasks();
    PT.E.sessionGets.qkProgress = { running: true, mode: 'itwactivation', phase: 'load', label: 'audience', width: 1440, loads: 3 };
    PT.E.intervals[0].fn();
    return { ok: true, record: clone(REC_IA) };
  };
  PT.E.run(function () { settle(PT.API.qkUiRunMode(IA_PANEL)); });
  ok('the progress of its own mode shows', PT.E.progressLog.indexOf('ITW Activation — load audience · 1440px (3 loads)') >= 0, PT.E.progressLog);
  ok('the progress of the other mode never shows', !PT.E.progressLog.some(function (t) { return /sweep|v1/.test(t); }));
  eq('the status line shows it too', PT.E.els['ta-status'].textContent, 'ITW Activation — load audience · 1440px (3 loads)');
});

T('restore after a panel reopen', function () {
  var P = boot(IA_PANEL, itwCtx()), E = P.E;
  runWith(P, IA_PANEL, function () { return { ok: true, record: clone(REC_IA) }; });
  var ran = P.API.qkUiState('itwactivation').last;
  var A2 = loadApi(), E2 = mkWorld(); E2.local = clone(E.local); E2.sessionGets = clone(E.sessionGets); E2.ctx = itwCtx();
  E2.run(function () { settle(A2.qkUiInit(IA_PANEL)); });
  var s2 = A2.qkUiState('itwactivation');
  ok('the last run is restored', s2.last && s2.last.ts === ran.ts && s2.last.version === 1);
  ok('and rendered (counts line)', E2.els['ia-results'].innerHTML.indexOf(esc_(qkCountsLine(qkCounts(ran.rows)))) > 0);
  ok('the debug box is restored', E2.els['ia-debug-out'].innerHTML.indexOf('Results shown below') > 0);
  eq('restored lines equal the stored ones', A2.qkUiDebugLines('itwactivation').length, E.sessionGets.iaDebugLast.length);
  eq('the restored box is shown', E2.els['ia-debug'].style.display, '');
  // a record of another version is not restored
  var E3 = mkWorld(); E3.sessionGets = clone(E.sessionGets); E3.sessionGets.iaLastRun.version = 99;
  var A3 = loadApi();
  E3.run(function () { settle(A3.qkUiInit(IA_PANEL)); });
  eq('a record of another version is not restored', A3.qkUiState('itwactivation').last, null);
  eq('and nothing is rendered', E3.els['ia-results'].innerHTML, '');
  // Mode 5: the slim copy renders without images and offers no tiles button
  var R = boot(RS_PANEL, respCtx());
  runWith(R, RS_PANEL, function () { return { ok: true, record: clone(REC_RS) }; });
  var A4 = loadApi(), E4 = mkWorld(); E4.sessionGets = clone(R.E.sessionGets); E4.local = clone(R.E.local);
  E4.run(function () { settle(A4.qkUiInit(RS_PANEL)); });
  ok('Mode 5 restores its last run', !!A4.qkUiState('responsiveness').last);
  ok('the restored slim copy has no tiles button (no image)', E4.els['rs-results'].innerHTML.indexOf('data-qk-tiles') < 0 && E4.els['rs-results'].innerHTML.indexOf('data-qk-csv') > 0);
  // init with no body does nothing
  var E5 = mkWorld(), A5 = loadApi(); delete E5.els['ia-body'];
  var r5 = (function () { var x; E5.run(function () { x = settle(A5.qkUiInit(IA_PANEL)); }); return x; })();
  ok('init without its body returns quietly', r5.done && r5.e === undefined);
  eq('and binds nothing', Object.keys(E5.els['ia-results'].listeners).length, 0);
  // init binds
  var B2 = boot(IA_PANEL, null);
  ok('init binds input and change on the body', B2.E.els['ia-body'].listeners.input.length === 1 && B2.E.els['ia-body'].listeners.change.length === 1);
  ok('init binds the results click', B2.E.els['ia-results'].listeners.click.length === 1);
  ok('init binds Clear typed inputs and Copy', B2.E.els['btn-ia-clear-inputs'].listeners.click.length === 1 && B2.E.els['btn-ia-debug-copy'].listeners.click.length === 1);
  ok('Mode 5 binds Reset', boot(RS_PANEL, null).E.els['btn-rs-ignore-reset'].listeners.click.length === 1);
  ok('Mode 1 has no ignore status binding to fail on (no #ia-ignore-status)', !B2.E.els['ia-ignore-status']);
});

T('async wrappers (A19)', function () {
  var API = loadApi(), E = mkWorld();
  var saved = globalThis.IA_PANEL, threw = false, p;
  try {
    delete globalThis.IA_PANEL;
    E.run(function () { try { p = API.runItwActivationMode(); } catch (e) { threw = true; } });
  } finally { globalThis.IA_PANEL = saved; }
  ok('with IA_PANEL missing runItwActivationMode does not throw synchronously', threw === false);
  ok('it returns a promise', p && typeof p.then === 'function');
  var s = settle(p);
  ok('which is rejected', s.done && s.e !== undefined, s);
  ok('with a ReferenceError', s.e && s.e.name === 'ReferenceError');
  var saved2 = globalThis.RS_PANEL, threw2 = false, p2;
  try {
    delete globalThis.RS_PANEL;
    E.run(function () { try { p2 = API.runResponsivenessMode(); } catch (e) { threw2 = true; } });
  } finally { globalThis.RS_PANEL = saved2; }
  ok('the same for runResponsivenessMode', threw2 === false && p2 && settle(p2).e !== undefined);
  var s3 = W(E, function () { return API.initItwActivation(); });
  ok('initItwActivation resolves in the world', s3.done && s3.e === undefined);
  ok('and bound the ITW body', E.els['ia-body'].listeners.input && E.els['ia-body'].listeners.input.length === 1);
  var s4 = W(E, function () { return API.initResponsiveness(); });
  ok('initResponsiveness resolves and bound the Responsiveness body', s4.done && E.els['rs-body'].listeners.input.length === 1);
  eq('the config still exists afterwards (restored)', typeof globalThis.IA_PANEL, 'object');
});

// ── report ─────────────────────────────────────────────────────────────────
print('\n' + (fail ? 'FAILURES:\n  - ' + failures.join('\n  - ') + '\n' : '') + '=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
