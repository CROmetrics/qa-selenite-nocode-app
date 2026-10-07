// BrowserStack Live suite — the launch link, the device presets it opens, and
// the reading of BrowserStack Local's /status.
//
//   RUN:  cd extension/tests && jsc browserstack.test.js
//   (jsc ships with macOS at
//    /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
//    — add it to PATH or invoke by full path.)
//
// What these pin, and why each matters:
// - The link is the whole integration. Live matches os / os_version / device
//   by exact string, and the experiment's preview URL rides inside it as one
//   parameter, so an encoding slip either opens the wrong device or truncates
//   the forcing query at its first '&' — which opens the page UN-forced and
//   looks like the variant failing on that device.
// - force-local only means something through the tunnel, so it never goes out
//   without local.
// - /status also returns a session token and a user id. The status reader must
//   hand back nothing but its two booleans.
// - Functional Testing's Target opens the queue's start URL, which popup.js
//   builds (queueStartUrl) by the rules the worker's ACTIONS.open_url uses to
//   navigate. The worker's lines are sliced from background.js and run beside
//   it, so the two cannot drift apart silently.
// - A BrowserStack device's console reaches Browser Console through Live's
//   own DevTools frame. bs-live-tap.js and bs-live-bridge.js run for real
//   here, against a fake Live page whose frontend has the shapes measured on
//   real iOS and Android sessions (2026-10-06): SDK.ConsoleModel.instance(),
//   MessageAdded, UI.context.flavor(SDK.ExecutionContext).evaluate.

load('../browserstack.js');

// ── harness ────────────────────────────────────────────────────────────────
var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 300) : ''));
}
function eq(name, actual, expected) {
  ok(name, actual === expected, { actual: actual, expected: expected });
}
function section(t) { print('\n' + t); }

// Splits a Live link's hash into [key, decodedValue] pairs, decoding the way a
// form-encoded value is decoded ('+' is a space, then percent-decoding).
function hashPairs(link) {
  var h = link.slice(link.indexOf('#') + 1);
  return h.split('&').map(function (kv) {
    var i = kv.indexOf('=');
    return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '))];
  });
}
function param(link, key) {
  var p = hashPairs(link).filter(function (kv) { return kv[0] === key; });
  return p.length ? p[0][1] : undefined;
}
function keys(link) { return hashPairs(link).map(function (kv) { return kv[0]; }); }

var IPHONE = bsPresetById('iphone-18-pro');
var EDGE = bsPresetById('win-edge');

// ── the link, exactly ──────────────────────────────────────────────────────
section('link shape');
eq('mobile link, Local and force-local on',
  bsLiveUrl(IPHONE, 'https://example.com/', { local: true, forceLocal: true }),
  'https://live.browserstack.com/dashboard#os=ios&os_version=27.0&device=iPhone+18+Pro' +
  '&device_browser=safari&url=https%3A%2F%2Fexample.com%2F&start=true&local=true&force-local=true');
eq('desktop link, Local off',
  bsLiveUrl(EDGE, 'https://example.com/', { local: false }),
  'https://live.browserstack.com/dashboard#os=Windows&os_version=11&browser=edge' +
  '&browser_version=154.0&url=https%3A%2F%2Fexample.com%2F&start=true');
eq('macOS name with a space is form-encoded',
  param(bsLiveUrl(bsPresetById('mac-safari'), 'https://example.com/', {}), 'os_version'), 'Golden Gate');
ok('macOS link writes the space as +',
  bsLiveUrl(bsPresetById('mac-safari'), 'https://example.com/', {}).indexOf('os=OS+X&os_version=Golden+Gate&') > 0);
ok('parameters go after # (the dashboard reads the hash, not a query)',
  bsLiveUrl(IPHONE, 'https://example.com/', {}).indexOf('https://live.browserstack.com/dashboard#os=') === 0);
eq('every link starts the session', param(bsLiveUrl(EDGE, 'https://example.com/', {}), 'start'), 'true');

// ── the preview URL survives the trip ──────────────────────────────────────
section('preview URL encoding');
var PREVIEW = 'https://www.example.com/plans?optimizely_x=31415&optimizely_token=ab+cd%2F==' +
  '&optimizely_preview_layer_ids=9&cro_mode=qa#pricing';
var link = bsLiveUrl(IPHONE, PREVIEW, { local: true, forceLocal: true });
eq('the full preview URL round-trips, query and fragment included', param(link, 'url'), PREVIEW);
eq("the preview URL's & and # never split the hash",
  keys(link).join(','), 'os,os_version,device,device_browser,url,start,local,force-local');
eq('a space in the page URL round-trips',
  param(bsLiveUrl(EDGE, 'https://example.com/a b', {}), 'url'), 'https://example.com/a b');
eq('a literal + in the page URL is not turned into a space',
  param(bsLiveUrl(EDGE, 'https://example.com/?q=a+b', {}), 'url'), 'https://example.com/?q=a+b');
eq('non-ASCII text round-trips',
  param(bsLiveUrl(EDGE, 'https://example.com/café', {}), 'url'), 'https://example.com/café');

// ── Local and force-local ──────────────────────────────────────────────────
section('local / force-local');
function flags(opts) {
  var k = keys(bsLiveUrl(IPHONE, 'https://example.com/', opts));
  return (k.indexOf('local') > -1 ? 'L' : '-') + (k.indexOf('force-local') > -1 ? 'F' : '-');
}
eq('local + forceLocal -> both', flags({ local: true, forceLocal: true }), 'LF');
eq('local only -> local', flags({ local: true, forceLocal: false }), 'L-');
eq('forceLocal WITHOUT local -> neither (meaningless off the tunnel)', flags({ local: false, forceLocal: true }), '--');
eq('no options -> neither', flags(undefined), '--');
eq('local=true is the value Live requires', param(bsLiveUrl(IPHONE, 'https://example.com/', { local: true }), 'local'), 'true');

// ── page URL normalization (mirrors background.js normalizeUrl) ─────────────
section('page URL normalization');
eq('bare host gets https://', param(bsLiveUrl(EDGE, 'example.com/x', {}), 'url'), 'https://example.com/x');
eq('http:// is kept', param(bsLiveUrl(EDGE, 'http://example.com/', {}), 'url'), 'http://example.com/');
eq('scheme match is case-insensitive', param(bsLiveUrl(EDGE, 'HTTPS://Example.com/', {}), 'url'), 'HTTPS://Example.com/');
eq('surrounding whitespace is trimmed', param(bsLiveUrl(EDGE, '  https://example.com/  ', {}), 'url'), 'https://example.com/');
eq('empty URL -> no link', bsLiveUrl(EDGE, '', {}), '');
eq('blank URL -> no link', bsLiveUrl(EDGE, '   ', {}), '');
eq('null URL -> no link', bsLiveUrl(EDGE, null, {}), '');
eq('no preset -> no link', bsLiveUrl(null, 'https://example.com/', {}), '');
eq('a preset with neither device nor browser -> no link',
  bsLiveUrl({ os: 'Windows', os_version: '11' }, 'https://example.com/', {}), '');

// ── presets ────────────────────────────────────────────────────────────────
section('presets');
var seen = {};
BS_LIVE_PRESETS.forEach(function (p) {
  var mobile = p.kind === 'phone' || p.kind === 'tablet';
  ok(p.id + ': id unique', !seen[p.id]); seen[p.id] = true;
  ok(p.id + ': label and detail', !!p.label && !!p.detail);
  ok(p.id + ': kind known', ['phone', 'tablet', 'desktop'].indexOf(p.kind) > -1, p.kind);
  ok(p.id + ': os and os_version', !!p.os && !!p.os_version);
  if (mobile) {
    ok(p.id + ': mobile os is ios|android', p.os === 'ios' || p.os === 'android', p.os);
    ok(p.id + ': mobile has device + device_browser and no desktop browser',
      !!p.device && !!p.device_browser && !p.browser && !p.browser_version);
    ok(p.id + ': mobile os_version is a catalogue number like 27.0', /^\d+\.\d+$/.test(p.os_version), p.os_version);
  } else {
    ok(p.id + ': desktop os is OS X|Windows', p.os === 'OS X' || p.os === 'Windows', p.os);
    ok(p.id + ': desktop has browser + browser_version and no device',
      !!p.browser && !!p.browser_version && !p.device && !p.device_browser);
  }
  ok(p.id + ': builds a link', bsLiveUrl(p, 'https://example.com/', {}).length > 0);
});
var defaults = BS_LIVE_DEFAULT_DEVICES.map(bsPresetById);
ok('every default device exists', defaults.every(Boolean), BS_LIVE_DEFAULT_DEVICES);
['phone', 'tablet', 'desktop'].forEach(function (k) {
  ok('defaults include a ' + k, defaults.some(function (p) { return p && p.kind === k; }));
});
eq('unknown id -> null', bsPresetById('nope'), null);

section('selected presets');
eq('unknown ids dropped, preset order kept, duplicates once',
  bsSelectedPresets(['iphone-18-pro', 'gone-device', 'win-edge', 'iphone-18-pro']).map(function (p) { return p.id; }).join(','),
  'win-edge,iphone-18-pro');
eq('non-array -> none', bsSelectedPresets(undefined).length, 0);
eq('empty -> none', bsSelectedPresets([]).length, 0);

// ── Desktop / Mobile / Tablet groups ───────────────────────────────────────
// The checklist renders one block per BS_LIVE_KINDS entry, and the rows of
// buttons follow BS_LIVE_PRESETS order — so the presets must be listed group
// by group, in the same order, or the rows interleave kinds the checklist
// keeps apart.
section('groups');
eq('groups in display order', BS_LIVE_KINDS.map(function (k) { return k.label; }).join(','), 'Desktop,Mobile,Tablet');
var kindIndex = {};
BS_LIVE_KINDS.forEach(function (k, i) { kindIndex[k.kind] = i; });
ok('every preset belongs to a group', BS_LIVE_PRESETS.every(function (p) { return p.kind in kindIndex; }),
  BS_LIVE_PRESETS.filter(function (p) { return !(p.kind in kindIndex); }).map(function (p) { return p.id; }));
var order = BS_LIVE_PRESETS.map(function (p) { return kindIndex[p.kind]; });
ok('presets listed group by group, in group order',
  order.every(function (v, i) { return i === 0 || v >= order[i - 1]; }), order);
BS_LIVE_KINDS.forEach(function (k) {
  ok(k.label + ' group is not empty', BS_LIVE_PRESETS.some(function (p) { return p.kind === k.kind; }));
});
eq('selected presets come out grouped',
  bsSelectedPresets(['galaxy-tab-s11', 'iphone-18-pro', 'win-firefox', 'mac-safari']).map(function (p) { return p.kind; }).join(','),
  'desktop,desktop,phone,tablet');

// ── the queue's start URL (Functional Testing → Target) ────────────────────
section('start URL');
function sliceBetween(src, from, to, label) {
  var i = src.indexOf(from);
  if (i < 0) throw new Error('marker not found (' + label + '): ' + from);
  var j = src.indexOf(to, i + from.length);
  if (j < 0) throw new Error('end marker not found (' + label + '): ' + to);
  return src.slice(i, j);
}
var POPUP = readFile('../popup.js');
var WORKER = readFile('../background.js');
eval(sliceBetween(POPUP, 'function queueStartUrl(inputs) {', '\nfunction ', 'popup queueStartUrl'));
// The worker composes the URL inline inside ACTIONS.open_url, right before it
// navigates. Wrapped as a function here; its `if (!fullUrl) return;` reads as ''.
eval('function workerStartUrl(url, params, qa_mode) {\n' +
  sliceBetween(WORKER, "    let fullUrl = (url || '').trim();", '    await chrome.tabs.update(tabId, { url: normalizeUrl(fullUrl) });', 'worker open_url') +
  '  return fullUrl;\n}');

var START_CASES = [
  ['blank URL opens nothing',              { url: '', params: ['a=1'], qa_mode: true },                  ''],
  ['whitespace is trimmed',                { url: '  https://x.com/p  ', params: [], qa_mode: false },    'https://x.com/p'],
  ['params trimmed, blanks dropped',       { url: 'https://x.com/p', params: ['a=1', '  ', ' b=2 '] },    'https://x.com/p?a=1&b=2'],
  ['an existing query is extended with &', { url: 'https://x.com/p?z=9', params: ['a=1'] },               'https://x.com/p?z=9&a=1'],
  ['QA Mode replaces cro_mode=, last',     { url: 'https://x.com/', params: ['cro_mode=log', 'a=1'], qa_mode: true }, 'https://x.com/?a=1&cro_mode=qa'],
  ['the cro_mode= match ignores case',     { url: 'https://x.com/', params: ['CRO_MODE=x'], qa_mode: true }, 'https://x.com/?cro_mode=qa'],
  ['QA Mode with no params',               { url: 'https://x.com/', qa_mode: true },                      'https://x.com/?cro_mode=qa'],
  ['legacy newline-joined params',         { url: 'https://x.com/', params: 'a=1\n\nb=2' },                 'https://x.com/?a=1&b=2'],
  ['no params at all',                     { url: 'https://x.com/' },                                     'https://x.com/'],
  ['a bare host is left to bsLiveUrl',     { url: 'example.com/cart', params: ['promo=1'] },              'example.com/cart?promo=1'],
];
START_CASES.forEach(function (c) {
  var inputs = c[1];
  eq(c[0], queueStartUrl(inputs), c[2]);
  eq(c[0] + ' (the worker agrees)', workerStartUrl(inputs.url, inputs.params, inputs.qa_mode) || '', queueStartUrl(inputs));
});
eq('no inputs at all -> no URL', queueStartUrl(undefined), '');
eq('the Live link carries the start URL, https added',
  param(bsLiveUrl(bsPresetById('win-edge'), queueStartUrl({ url: 'example.com/cart', params: ['promo=1'], qa_mode: true }), {}), 'url'),
  'https://example.com/cart?promo=1&cro_mode=qa');

// ── BrowserStack Local /status ─────────────────────────────────────────────
section('Local status');
var TOKEN = 'tok-1f2e3d', USER = 'user-99';
var st = bsLocalStatusFrom({ status: true, token: TOKEN, userId: USER }, true);
eq('running and signed in', JSON.stringify(st), '{"running":true,"signedIn":true}');
eq('only the two booleans come back', Object.keys(st).sort().join(','), 'running,signedIn');
ok('the token never reaches the result', JSON.stringify(st).indexOf(TOKEN) === -1);
ok('the user id never reaches the result', JSON.stringify(st).indexOf(USER) === -1);
eq('console unreachable -> not running', JSON.stringify(bsLocalStatusFrom(null, false)), '{"running":false,"signedIn":false}');
eq('unreachable wins over a body', bsLocalStatusFrom({ status: true }, false).running, false);
eq('status:false -> running, not signed in', JSON.stringify(bsLocalStatusFrom({ status: false }, true)), '{"running":true,"signedIn":false}');
eq('unparseable body -> running, not signed in', bsLocalStatusFrom(null, true).signedIn, false);
eq('string "true" is not true', bsLocalStatusFrom({ status: 'true' }, true).signedIn, false);
eq('a non-object body is not signed in', bsLocalStatusFrom('garbage', true).signedIn, false);
eq('an array body is not signed in', bsLocalStatusFrom([true], true).signedIn, false);

// ── which tab counts as Selenite's Live tab ─────────────────────────────────
section('Live tab URL');
ok('the dashboard', bsIsLiveUrl('https://live.browserstack.com/dashboard#os=ios'));
ok('the bare host', bsIsLiveUrl('https://live.browserstack.com'));
ok('a look-alike host is not Live', !bsIsLiveUrl('https://live.browserstack.com.example.net/'));
ok('http is not Live', !bsIsLiveUrl('http://live.browserstack.com/dashboard'));
ok('the marketing site is not Live', !bsIsLiveUrl('https://www.browserstack.com/live'));
ok('empty is not Live', !bsIsLiveUrl(''));
ok('undefined is not Live', !bsIsLiveUrl(undefined));

// ── device console: which tab is a Live session ────────────────────────────
section('Live dashboard URL');
ok('a running session', bsIsLiveDashboardUrl('https://live.browserstack.com/dashboard#os=iOS&os_version=16.0&device_browser=safari'));
ok('the bare dashboard', bsIsLiveDashboardUrl('https://live.browserstack.com/dashboard'));
ok('a query', bsIsLiveDashboardUrl('https://live.browserstack.com/dashboard?x=1'));
ok('Live but not the dashboard', !bsIsLiveDashboardUrl('https://live.browserstack.com/'));
ok('a longer path that only starts the same', !bsIsLiveDashboardUrl('https://live.browserstack.com/dashboardx'));
ok('a look-alike host', !bsIsLiveDashboardUrl('https://live.browserstack.com.example.net/dashboard'));
ok('http', !bsIsLiveDashboardUrl('http://live.browserstack.com/dashboard'));
ok('empty', !bsIsLiveDashboardUrl(''));

// ── device console: lines into Browser Console entries ─────────────────────
// Fixtures are what bs-live-tap.js relays ({level, type, source, text}), with
// the field values Live's DevTools 91 gave on Will's sessions.
section('device entries');
var TAGS_ = ['[pjs]', '[cro]'];
var DEV = 'Samsung Galaxy S23 13.0';
function entry(line) { return bsDeviceEntry(line, DEV, TAGS_); }
var e1 = entry({ source: 'console-api', level: 'info', type: 'log', text: '[cro] test' });
eq('console.log -> BROWSER, as a local tab', e1.level, 'BROWSER');
eq('source is bs-device', e1.source, 'bs-device');
eq('labelled with the device', e1.device, DEV);
ok('a [cro] line is tagged, so the CRO toggle keeps it', e1.tagged === true);
ok('no objectId: device objects cannot be expanded', !('objectId' in e1) && !('expandable' in e1));
eq('console.info -> INFO', entry({ source: 'console-api', level: 'info', type: 'info', text: 'x' }).level, 'INFO');
eq('console.table -> INFO', entry({ source: 'console-api', level: 'info', type: 'table', text: 'x' }).level, 'INFO');
eq('console.warn -> WARNING', entry({ source: 'console-api', level: 'warning', type: 'warning', text: 'x' }).level, 'WARNING');
eq('console.error -> ERROR', entry({ source: 'console-api', level: 'error', type: 'error', text: 'x' }).level, 'ERROR');
eq('console.assert -> ERROR', entry({ source: 'console-api', level: 'error', type: 'assert', text: 'x' }).level, 'ERROR');
var ex = entry({ source: 'javascript', level: 'error', type: 'log', text: 'Uncaught TypeError: x is not a function' });
eq('an exception keeps its level', ex.level, 'ERROR');
eq('an exception keeps its own text', ex.text, 'Uncaught TypeError: x is not a function');
var net = entry({ source: 'network', level: 'error', type: 'log', text: 'Failed to load resource: 404' });
eq('a failed request is an ERROR', net.level, 'ERROR');
eq('and reads like a local Log entry', net.text, '[network] Failed to load resource: 404');
var vio = entry({ source: 'violation', level: 'verbose', type: 'log', text: "Long 'setTimeout' handler" });
eq('a verbose violation is BROWSER', vio.level, 'BROWSER');
eq('with its source prefix', vio.text, "[violation] Long 'setTimeout' handler");
eq('a warning-level non-console line is a WARNING', entry({ source: 'other', level: 'warning', type: 'log', text: 'x' }).level, 'WARNING');
eq("Live's own command echo is dropped", entry({ source: 'javascript', level: null, type: 'command', text: "console.log('[cro] test')" }), null);
eq("and its result echo", entry({ source: 'javascript', level: 'info', type: 'result', text: 'undefined' }), null);
eq('endGroup is dropped', entry({ source: 'console-api', type: 'endGroup', text: '' }), null);
eq('console.clear is dropped', entry({ source: 'console-api', type: 'clear', text: '' }), null);
ok('[PJS] is tagged, any case', entry({ source: 'console-api', type: 'log', text: 'x [PJS] fired' }).tagged === true);
ok('an untagged line is not', entry({ source: 'console-api', type: 'log', text: 'hello' }).tagged === false);
var big = entry({ source: 'console-api', type: 'log', text: new Array(5001).join('x') });
ok('a huge line is cut at 4000 characters and says so', big.text.length < 4100 && /… \(truncated\)$/.test(big.text), big.text.length);
eq('null is no entry', bsDeviceEntry(null, DEV, TAGS_), null);
eq('a string is no entry', bsDeviceEntry('x', DEV, TAGS_), null);

// ── device console: the real tap, against a fake Live page ─────────────────
section('the tap (bs-live-tap.js)');
var TAP_SRC = readFile('../bs-live-tap.js');
var BRIDGE_SRC = readFile('../bs-live-bridge.js');
var FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.fake.token';

function makeFrontend(opts) {
  opts = opts || {};
  var listeners = [];
  var msgs = (opts.messages || []).slice();
  var cm = {
    messages: function () { return msgs.slice(); },
    addEventListener: function (type, fn) { listeners.push({ type: type, fn: fn }); },
  };
  function ExecutionContext() {}
  var ctx = opts.ctx === undefined ? null : opts.ctx;
  var SDK = opts.noConsoleModel ? { ExecutionContext: ExecutionContext } : {
    ConsoleModel: { instance: function () { return cm; }, Events: { MessageAdded: 'MessageAdded', ConsoleCleared: 'ConsoleCleared' } },
    ExecutionContext: ExecutionContext,
  };
  var w = {
    location: { pathname: '/devtools/' + (opts.platform || 'realios') + '/91.0.4472.101/inspector.html' },
    SDK: SDK,
    UI: { context: { flavor: function (cls) { return cls === ExecutionContext ? ctx : null; } } },
  };
  return {
    w: w, listeners: listeners,
    fire: function (m) { listeners.forEach(function (l) { if (l.type === 'MessageAdded') l.fn({ data: m }); }); },
  };
}

function makeFrame(frontend, counters) {
  return {
    contentWindow: frontend.w,
    get src() { counters.src++; return 'https://live.browserstack.com/devtools/realios/91.0.4472.101/inspector.html?wss=' + FAKE_JWT; },
    getAttribute: function (n) { counters.attr.push(n); return n === 'src' ? this.src : null; },
  };
}

function makePage() {
  var page = { posted: [], frames: [], timers: [], intervals: [], counters: { src: 0, attr: [] } };
  page.win = { postMessage: function (m, origin) { page.posted.push({ m: JSON.parse(JSON.stringify(m)), origin: origin }); } };
  page.doc = { querySelectorAll: function (sel) { return sel === 'iframe.devtools-iframe' ? page.frames.slice() : []; } };
  page.loc = { origin: 'https://live.browserstack.com' };
  page.run = function () {
    new Function('window', 'document', 'location', 'setTimeout', 'setInterval', TAP_SRC)(
      page.win, page.doc, page.loc,
      function (fn) { page.timers.push(fn); return page.timers.length; },
      function (fn) { page.intervals.push(fn); return page.intervals.length; });
  };
  page.tick = function (n) { for (var i = 0; i < (n || 1); i++) page.intervals.forEach(function (f) { f(); }); };
  page.flush = function () { var t = page.timers.slice(); page.timers.length = 0; t.forEach(function (f) { f(); }); };
  page.states = function () { return page.posted.filter(function (p) { return p.m.kind === 'state'; }).map(function (p) { return p.m.state + (p.m.version ? ' ' + p.m.version : ''); }); };
  page.lines = function () {
    var out = [];
    page.posted.forEach(function (p) { if (p.m.kind === 'lines') out = out.concat(p.m.lines); });
    return out;
  };
  page.batches = function () { return page.posted.filter(function (p) { return p.m.kind === 'lines'; }).map(function (p) { return p.m.lines.length; }); };
  return page;
}
function msg(text, extra) {
  var m = { source: 'console-api', level: 'info', type: 'log', messageText: text, parameters: [{ type: 'string', value: text }] };
  for (var k in (extra || {})) m[k] = extra[k];
  return m;
}

var P = makePage();
P.run();
eq('no DevTools frame: reports closed', P.states().join(','), 'closed');
ok('everything is posted to its own origin, marked', P.posted.every(function (p) { return p.origin === 'https://live.browserstack.com' && p.m.__seleniteBsLive === 1; }));
var FE = makeFrontend({ messages: [msg('[cro] early'), { source: 'javascript', type: 'command', messageText: "console.log('[cro] early')" }] });
P.frames.push(makeFrame(FE, P.counters));
P.tick();
eq('DevTools opened: reports connected, with the frontend version', P.states().join(','), 'closed,connected realios 91.0.4472.101');
P.flush();
eq('what the device already logged is replayed once', P.lines().map(function (l) { return l.text; }).join('|'), "[cro] early|console.log('[cro] early')");
eq('a replayed line carries level, type and source', JSON.stringify(P.lines()[0]), '{"level":"info","type":"log","source":"console-api","text":"[cro] early"}');
FE.fire(msg('[cro] later'));
P.flush();
eq('a new message is relayed', P.lines().slice(-1)[0].text, '[cro] later');
P.tick(3);
eq('hooked once: no duplicate subscription or replay on later scans', FE.listeners.length + ':' + P.lines().length, '1:3');
eq('an unchanged state is not re-posted', P.states().length, 2);

FE.fire({ source: 'console-api', level: 'info', type: 'log', messageText: '%c[cro] styled', parameters: [{ type: 'string', value: '%c[cro] styled' }, { type: 'string', value: 'color:red' }, { type: 'number', value: 3 }] });
FE.fire({ source: 'console-api', level: 'info', type: 'log', messageText: '[cro] data', parameters: [{ type: 'string', value: '[cro] data' }, { type: 'object', description: 'Object' }, { type: 'undefined' }, { type: 'object', subtype: 'null' }] });
FE.fire({ source: 'network', level: 'error', type: 'log', messageText: 'Failed to load resource: 404', parameters: [] });
P.flush();
var last3 = P.lines().slice(-3).map(function (l) { return l.text; });
eq('%c styling and its CSS argument are dropped', last3[0], '[cro] styled 3');
eq('objects read as their description, undefined and null by name', last3[1], '[cro] data Object undefined null');
eq('a non-console message keeps its messageText', last3[2], 'Failed to load resource: 404');

var before = P.posted.length;
for (var i = 0; i < 120; i++) FE.fire(msg('m' + i));
eq('a burst is sent in batches of 50, as they fill', P.batches().slice(-2).join(','), '50,50');
P.flush();
eq('the rest go on the timer', P.batches().slice(-1)[0], 20);

P.frames.length = 0;
P.tick();
eq('DevTools closed: reports closed', P.states().slice(-1)[0], 'closed');
var FE2 = makeFrontend({ platform: 'realdroid', messages: [msg('[cro] android')] });
P.frames.push(makeFrame(FE2, P.counters));
P.tick();
P.flush();
eq('reopened (a new frame): connected again, Android version', P.states().slice(-1)[0], 'connected realdroid 91.0.4472.101');
eq("and that frame's messages are replayed", P.lines().slice(-1)[0].text, '[cro] android');

P.run();
eq('injected again (a re-follow): the current state is announced again', P.states().slice(-1)[0], 'connected realdroid 91.0.4472.101');
eq('without a second hook', FE2.listeners.length, 1);
eq("the iframe's src (wss token) is never read", P.counters.src + ':' + P.counters.attr.length, '0:0');
ok('the token appears in nothing posted', JSON.stringify(P.posted).indexOf(FAKE_JWT) === -1);

var many = [];
for (var j = 0; j < 250; j++) many.push(msg('old' + j));
var P2 = makePage();
P2.frames.push(makeFrame(makeFrontend({ messages: many }), P2.counters));
P2.run();
P2.flush();
eq('replay is capped at the last 200', P2.lines().length + ':' + P2.lines()[0].text, '200:old50');

var P3 = makePage();
P3.frames.push(makeFrame(makeFrontend({ noConsoleModel: true }), P3.counters));
P3.run();
P3.tick(28);
eq('a frontend without the console model is not reported early', P3.states().length, 0);
P3.tick(2);
eq('after about 30 s it is reported unsupported, with its version', P3.states().join(','), 'unsupported realios 91.0.4472.101');

// ── the tap runs commands on the device ────────────────────────────────────
section('the tap: commands on the device');
function evalResult(page, expr) {
  var out = null;
  page.win.__seleniteBsTap.eval(expr).then(function (r) { out = r; });
  drainMicrotasks();
  return out;
}
var calls = [];
function ctxReturning(r) {
  return { evaluate: function (options, userGesture, awaitPromise) { calls.push({ options: options, userGesture: userGesture, awaitPromise: awaitPromise }); return Promise.resolve(r); } };
}
var P4 = makePage();
P4.run();
eq('no DevTools: says to open it', evalResult(P4, '1').error, 'Open DevTools in the Live session first. Selenite runs commands through it.');
P4.frames.push(makeFrame(makeFrontend({ ctx: null }), P4.counters));
ok('no script context: says so', /no script context yet/.test(evalResult(P4, '1').error));
P4.frames.length = 0;
P4.frames.push(makeFrame(makeFrontend({ ctx: ctxReturning({ object: { type: 'number', value: 42, release: function () { calls.push('released'); } } }) }), P4.counters));
eq('a number comes back as text', JSON.stringify(evalResult(P4, '6*7')), '{"ok":true,"text":"42"}');
var c0 = calls[0];
ok('evaluated in the selected context, with the console API, awaiting promises',
  c0.options.expression === '6*7' && c0.options.includeCommandLineAPI === true && c0.options.objectGroup === 'selenite' &&
  c0.options.silent === false && c0.userGesture === true && c0.awaitPromise === true, c0);
ok('the result object is released', calls.indexOf('released') > -1);
function evalWith(r) {
  var P5 = makePage();
  P5.frames.push(makeFrame(makeFrontend({ ctx: ctxReturning(r) }), P5.counters));
  P5.run();
  return evalResult(P5, 'x');
}
eq('a string is quoted, as locally', evalWith({ object: { type: 'string', value: 'hi' } }).text, '"hi"');
eq('undefined', evalWith({ object: { type: 'undefined' } }).text, 'undefined');
eq('an object with a preview', evalWith({ object: { type: 'object', className: 'Object', preview: { properties: [{ name: 'a', type: 'number', value: '1' }, { name: 'b', type: 'string', value: 'x' }], overflow: true } } }).text, 'Object {a: 1, b: x, …}');
eq('an array with a preview', evalWith({ object: { type: 'object', subtype: 'array', preview: { properties: [{ name: '0', type: 'number', value: '1' }] } } }).text, '[0: 1]');
eq('a function', evalWith({ object: { type: 'function', description: 'function getVariationMap() { … }' } }).text, 'ƒ getVariationMap()');
var exr = evalWith({ exceptionDetails: { text: 'Uncaught' }, object: { type: 'object', subtype: 'error', description: 'ReferenceError: optimizely is not defined\n    at <anonymous>:1:1' } });
eq('an exception: ran, flagged, first line only', JSON.stringify(exr), '{"ok":true,"exception":true,"text":"ReferenceError: optimizely is not defined"}');
eq('a frontend error', JSON.stringify(evalWith({ error: 'Execution context was destroyed.' })), '{"ok":false,"error":"Execution context was destroyed."}');

// ── the bridge ─────────────────────────────────────────────────────────────
section('the bridge (bs-live-bridge.js)');
var sent = [];
var bwin = { listeners: [], addEventListener: function (t, fn) { if (t === 'message') this.listeners.push(fn); } };
var bchrome = { runtime: { sendMessage: function (m) { sent.push(m); return Promise.resolve(); } } };
new Function('window', 'chrome', BRIDGE_SRC)(bwin, bchrome);
new Function('window', 'chrome', BRIDGE_SRC)(bwin, bchrome);
eq('injected twice, listens once', bwin.listeners.length, 1);
function deliver(data, source) { bwin.listeners.forEach(function (fn) { fn({ source: source === undefined ? bwin : source, data: data }); }); }
deliver({ __seleniteBsLive: 1, kind: 'lines', lines: [{ text: 'a' }] }, {});
deliver({ __selenite: true, level: 'BROWSER', text: 'x' });
deliver({ __seleniteBsLive: 1, kind: 'state', state: 'bogus' });
eq('other windows, other markers and unknown states are ignored', sent.length, 0);
var lots = [];
for (var k = 0; k < 250; k++) lots.push({ text: 'l' + k });
deliver({ __seleniteBsLive: 1, kind: 'lines', lines: lots });
deliver({ __seleniteBsLive: 1, kind: 'state', state: 'connected', version: 'realios 91.0.4472.101' });
eq('lines are forwarded, at most 200 per message', sent[0].action + ':' + sent[0].lines.length, 'bsDeviceLog:200');
eq('state is forwarded', JSON.stringify(sent[1]), '{"action":"bsDeviceState","state":"connected","version":"realios 91.0.4472.101"}');

// ── the panel's reading of the device state ────────────────────────────────
section('panel: device state (bcDeviceState)');
eval(sliceBetween(POPUP, 'function bcDeviceState(captureStatus, bsDeviceStatus, captureEnabled) {', '\nasync function syncBcStatus', 'popup bcDeviceState'));
var LIVE_CS = { tabId: 11, title: 'iPhone 14 16.3', url: 'https://live.browserstack.com/dashboard#os=iOS', capturable: true, bsLive: true };
eq('an ordinary tab is not a device', bcDeviceState({ tabId: 3, url: 'https://example.com/', capturable: true, bsLive: false }, null, undefined), null);
eq('nothing captured', bcDeviceState(null, null, undefined), null);
eq('capture paused: not a device mirror', bcDeviceState(LIVE_CS, { state: 'connected', tabId: 11 }, false), null);
eq('a non-capturable record is not a device mirror', bcDeviceState({ tabId: 11, url: LIVE_CS.url, capturable: false }, null, undefined), null);
eq('connected, for this tab', bcDeviceState(LIVE_CS, { state: 'connected', tabId: 11 }, undefined), 'connected');
eq('a status for another tab reads as waiting', bcDeviceState(LIVE_CS, { state: 'connected', tabId: 12 }, undefined), 'waiting');
eq('no status yet, from a new worker: waiting', bcDeviceState(LIVE_CS, undefined, undefined), 'waiting');
var oldCs = { tabId: 11, title: 'iPhone 14 16.3', url: LIVE_CS.url, capturable: true };
eq('no bsLive key at all: a worker that predates device mirroring', bcDeviceState(oldCs, undefined, undefined), 'old-worker');
eq('unsupported passes through', bcDeviceState(LIVE_CS, { state: 'unsupported', tabId: 11, version: 'realios 99' }, undefined), 'unsupported');

// ── report ─────────────────────────────────────────────────────────────────
print('');
if (failures.length) {
  print('FAILURES:');
  failures.forEach(function (f) { print('  - ' + f); });
}
print('=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
