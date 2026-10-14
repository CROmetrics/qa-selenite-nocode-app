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
// start:false is the "pick the device yourself" link: Live loads the dashboard
// with the page and Local in place and waits. It is the one route that gets
// Local on an account whose dashboard starts the session before it finds the app.
var NOSTART = bsLiveUrl(IPHONE, 'https://example.com/', { local: true, forceLocal: true, start: false });
eq('start:false leaves start=true out, everything else as before',
  NOSTART, 'https://live.browserstack.com/dashboard#os=ios&os_version=27.0&device=iPhone+18+Pro' +
  '&device_browser=safari&url=https%3A%2F%2Fexample.com%2F&local=true&force-local=true');
ok('start:false carries no start parameter at all', keys(NOSTART).indexOf('start') === -1);
eq('start:true and the default are the same', bsLiveUrl(IPHONE, 'https://example.com/', { start: true }), bsLiveUrl(IPHONE, 'https://example.com/', {}));
eq('only start:false (not 0 or null) leaves it out', keys(bsLiveUrl(IPHONE, 'https://example.com/', { start: 0 })).indexOf('start') > -1, true);

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

// iPhone 17 at 26.1 is in BrowserStack's catalogue and was refused by the real
// dashboard every time ("Device is temporarily disabled"); 26.0, which is how
// the dashboard's own list names it, starts (the tab read "iPhone 17 v26.5").
eq('iPhone 17 uses the 26.0 bucket Live starts', bsPresetById('iphone-17').os_version, '26.0');
eq('and says so', bsPresetById('iphone-17').detail, 'iOS 26 · Safari');

section('DevTools support');
eq('iOS 27 has no DevTools in Live', bsDevtoolsSupport(bsPresetById('iphone-18-pro')).mirror, false);
ok('and says why', /iOS 27/.test(bsDevtoolsSupport(bsPresetById('iphone-18-pro')).why));
eq('iPad on iOS 27 has none either', bsDevtoolsSupport(bsPresetById('ipad-pro-13')).mirror, false);
eq('iOS 26 is not marked', bsDevtoolsSupport(bsPresetById('iphone-17')).mirror, true);
eq('Android is not marked', bsDevtoolsSupport(bsPresetById('galaxy-s26')).mirror, true);
eq('a desktop browser session has none: all four presets are marked', ['mac-safari', 'win-edge', 'win-chrome', 'win-firefox'].map(function (id) { return bsDevtoolsSupport(bsPresetById(id)).mirror; }).join(','), 'false,false,false,false');
ok('and the reason says why', /desktop browser sessions/.test(bsDevtoolsSupport(bsPresetById('win-chrome')).why));
eq('Android is not marked up front: it varies by device and is read at run time', ['galaxy-s26', 'pixel-10', 'galaxy-tab-s11'].map(function (id) { return bsDevtoolsSupport(bsPresetById(id)).mirror; }).join(','), 'true,true,true');
eq('a made-up iOS 27.1 is', bsDevtoolsSupport({ os: 'ios', os_version: '27.1' }).mirror, false);
eq('iOS 9.3 is not (27 is a number, not a prefix)', bsDevtoolsSupport({ os: 'ios', os_version: '9.3' }).mirror, true);
eq('no preset is not marked', bsDevtoolsSupport(null).mirror, true);

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

// ── BrowserStack Local: the answer Live itself looks for ───────────────────
// The Local binary answers GET http://127.0.0.1:45691/?_=<ts> with JSONP; the
// dashboard polls it every two seconds. The body names a tunnel identifier and
// a version (the access key arrives masked), none of which Selenite needs.
section('Local: the binary answer');
var JSONP = "commandLineTunnel('xxxxxxxxxxxxxxxxxxxxxx-nativeapp:B578BA58-FA44-5D24-8C96-CCAEFEC33C5D', ['http://*:*'],0, 'node', 8.9, true,'App-appVersion:3.7.8-binVersion:8.9', 'B578BA58-FA44-5D24-8C96-CCAEFEC33C5D:12adf3e6-c083-48fd-b0b2-42194d71d202', 10993107 );";
var ans = bsLocalBinaryAnswer(JSONP);
eq('the real answer is up', ans.up, true);
eq('and carries nothing else', Object.keys(ans).join(','), 'up');
ok('the tunnel identifier never reaches the result', JSON.stringify(ans).indexOf('nativeapp') === -1 && JSON.stringify(ans).indexOf('B578BA58') === -1);
eq('leading whitespace is fine', bsLocalBinaryAnswer('\n  ' + JSONP).up, true);
eq('an empty body is not up', bsLocalBinaryAnswer('').up, false);
eq('an HTML error page is not up', bsLocalBinaryAnswer('<!DOCTYPE html><html>Cannot GET /</html>').up, false);
eq('JSON of the console is not up', bsLocalBinaryAnswer('{"status":true}').up, false);
eq('a different callback is not up', bsLocalBinaryAnswer("otherCallback('x')").up, false);
eq('the name has to start the body', bsLocalBinaryAnswer('x commandLineTunnel(1)').up, false);
eq('null is not up', bsLocalBinaryAnswer(null).up, false);
eq('a number is not up', bsLocalBinaryAnswer(5).up, false);
eq('the port Live checks', BS_LOCAL_BINARY, 'http://127.0.0.1:45691');

section('Local: ready or not');
var CON_OK = { running: true, signedIn: true }, CON_IN = { running: true, signedIn: false }, CON_NO = { running: false, signedIn: false };
eq('the binary answers: ready', JSON.stringify(bsLocalReadiness(true, CON_OK)), '{"ready":true,"state":"ready"}');
eq('the binary answers even if the console does not: ready', bsLocalReadiness(true, CON_NO).ready, true);
eq('console signed in, binary silent: NOT ready (the case /status alone passed)', JSON.stringify(bsLocalReadiness(false, CON_OK)), '{"ready":false,"state":"not-connected"}');
eq('console up but not signed in', bsLocalReadiness(false, CON_IN).state, 'not-signed-in');
eq('nothing answers: not running', bsLocalReadiness(false, CON_NO).state, 'not-running');
eq('no console reading at all: not running', bsLocalReadiness(false, undefined).state, 'not-running');
eq('not ready is never ready', [CON_OK, CON_IN, CON_NO].every(function (c) { return bsLocalReadiness(false, c).ready === false; }), true);

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
  // The selected page context. A working device has one (a Galaxy S26: 0.2 s
  // after it attaches, measured 2026-10-13), so that is the default; ctx: null
  // is a device with no page to run in (an iPhone 17 on iOS 26.5/26.6).
  var ctx = opts.ctx === undefined ? { evaluate: function () { return Promise.resolve({ object: { type: 'undefined' } }); } } : opts.ctx;
  var SDK = opts.noConsoleModel ? { ExecutionContext: ExecutionContext } : {
    ConsoleModel: { instance: function () { return cm; }, Events: { MessageAdded: 'MessageAdded', ConsoleCleared: 'ConsoleCleared' } },
    ExecutionContext: ExecutionContext,
  };
  // The target's runtime agent answers location.href without a selected
  // context: "about:blank" on the iPhone 17, the page's URL on the Galaxy S26
  // ({result:{type:'string',value}}, plus wasThrown on iOS). opts.href is what
  // it answers: a string, a function of the call number, or one returning a promise.
  var probeCalls = [];
  function agent() {
    return { invoke_evaluate: function (params) {
      probeCalls.push(params);
      var h = typeof opts.href === 'function' ? opts.href(probeCalls.length) : opts.href;
      if (h && typeof h.then === 'function') return h;
      return Promise.resolve({ result: { type: 'string', value: h }, wasThrown: false });
    } };
  }
  // The real frontend has SDK.targetManager, and its targets() is empty while
  // the frame is up but the DevTools websocket has not attached to the device
  // (measured on real sessions 2026-10-08). One target by default: attached.
  var targetList = opts.targets === undefined ? [opts.href === undefined ? { name: 'page' } : { name: 'page', runtimeAgent: agent }] : opts.targets;
  if (!opts.noTargetManager) SDK.targetManager = { targets: function () { return opts.throwingTargets ? (function () { throw new Error('boom'); })() : targetList; } };
  var w = {
    location: { pathname: '/devtools/' + (opts.platform || 'realios') + '/91.0.4472.101/inspector.html' },
    SDK: SDK,
    UI: opts.noUI ? undefined : { context: { flavor: function (cls) { return cls === ExecutionContext ? ctx : null; } } },
  };
  return {
    w: w, listeners: listeners, probeCalls: probeCalls,
    setTargets: function (list) { targetList = list; },
    setCtx: function (c) { ctx = c; },
    agent: agent,
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
  // nodes: selector -> node, for the few single elements the tap reads off the
  // dashboard page itself (the toolbar's DevTools item and its messages).
  page.nodes = {};
  page.doc = {
    body: null,
    querySelectorAll: function (sel) { return sel === 'iframe.devtools-iframe' ? page.frames.slice() : []; },
    querySelector: function (sel) { return page.nodes[sel] || null; },
  };
  page.setBody = function (text) { page.doc.body = text == null ? null : { innerText: text }; };
  page.loc = { origin: 'https://live.browserstack.com' };
  page.run = function () {
    new Function('window', 'document', 'location', 'setTimeout', 'setInterval', TAP_SRC)(
      page.win, page.doc, page.loc,
      function (fn) { page.timers.push(fn); return page.timers.length; },
      function (fn) { page.intervals.push(fn); return page.intervals.length; });
  };
  page.tick = function (n) { for (var i = 0; i < (n || 1); i++) page.intervals.forEach(function (f) { f(); }); };
  page.flush = function () { var t = page.timers.slice(); page.timers.length = 0; t.forEach(function (f) { f(); }); };
  page.states = function () {
    return page.posted.filter(function (p) { return p.m.kind === 'state'; }).map(function (p) {
      return p.m.state + (p.m.version ? ' ' + p.m.version : '') + (p.m.reason ? ' <' + p.m.reason + '>' : '') + (p.m.late ? ' late' : '');
    });
  };
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
ok('no script context: says so, and what to do (it can be reloaded on the device)', /no script context yet\. Wait for it to load, or reload it on the device, then try again\./.test(evalResult(P4, '1').error), evalResult(P4, '1').error);
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


// ── the tap: what DevTools is doing ────────────────────────────────────────
// Measured on real sessions 2026-10-08: on iOS 27 Live disables the toolbar's
// DevTools item (li.switchDevtools-menu-wrapper, aria-disabled="true") and
// #devtools_message says why; on a working session the same item reads
// aria-disabled="false". And a frame can be on screen with ZERO targets (the
// DevTools websocket never attached), which is not "connected".
section('the tap: DevTools states');
// Live's own sentence, character for character, including the missing space after
// "devices."; Selenite shows it with the space.
var IOS27_RAW = 'Developer tools are disabled because of multiple browser tabs on iOS 27.0 devices.Please close all other tabs to enable.';
var IOS27_MSG = IOS27_RAW.replace('devices.Please', 'devices. Please');
var IOS27_TIP = 'Currently DevTools is unavailable for iOS 27.0 Safari';
var VER = 'realios 91.0.4472.101';
function toolbarItem(disabled) { return { getAttribute: function (n) { return n === 'aria-disabled' ? (disabled ? 'true' : 'false') : null; } }; }
function lastState(page) { var a = page.states(); return a[a.length - 1]; }

var T1 = makePage();
T1.nodes['li.switchDevtools-menu-wrapper'] = toolbarItem(true);
T1.nodes['#devtools_message'] = { textContent: IOS27_RAW };
T1.nodes['#tooltip-switchDevtools'] = { textContent: IOS27_TIP };
T1.run();
eq('no frame, Live disabled its DevTools item: unavailable, in Live\'s own words', T1.states().join('|'), 'unavailable <' + IOS27_MSG + '>');
delete T1.nodes['#devtools_message'];
T1.tick();
eq('once the message is gone the tooltip says it', lastState(T1), 'unavailable <' + IOS27_TIP + '>');
delete T1.nodes['#tooltip-switchDevtools'];
T1.tick();
eq('with neither, a generic reason', lastState(T1), "unavailable <Live's DevTools is unavailable for this device>");
T1.tick(3);
eq('an unchanged state is not re-posted', T1.states().length, 3);
T1.nodes['li.switchDevtools-menu-wrapper'] = toolbarItem(false);
T1.tick();
eq('the item enabled again (aria-disabled="false"): just closed', lastState(T1), 'closed');
T1.nodes['li.switchDevtools-menu-wrapper'] = toolbarItem(true);
T1.nodes['#devtools_message'] = { textContent: new Array(400).join('x') };
T1.tick();
ok('a reason is cut to 200 characters', lastState(T1).length < 230 && /…>$/.test(lastState(T1)), lastState(T1).length);
var T1b = makePage();
T1b.nodes['li.switchDevtools-menu-wrapper'] = toolbarItem(true);
T1b.frames.push(makeFrame(makeFrontend({}), T1b.counters));
T1b.run();
eq('a frame that is open wins over a disabled item', T1b.states().join('|'), 'connected ' + VER);
// A desktop browser session: a toolbar with eleven items and none for DevTools.
var NO_ITEM_REASON = 'its toolbar has no DevTools item (desktop browser sessions have none).';
var T1d = makePage();
T1d.nodes['li.toolbar-list-item'] = toolbarItem(false);
T1d.run();
eq("a toolbar with no DevTools item, seen once, is not believed (a phone's can be part-way through rendering)", T1d.states().join('|'), 'closed');
T1d.tick();
eq('seen on a second scan in a row: unavailable, saying only what was seen', T1d.states().join('|'), 'closed|unavailable <' + NO_ITEM_REASON + '>');
T1d.tick(5);
eq('and said once', T1d.states().length, 2);
var T1e = makePage();
T1e.run();
eq('no toolbar yet (the session is still coming up): not called unavailable', T1e.states().join('|'), 'closed');
T1e.nodes['li.toolbar-list-item'] = toolbarItem(false);
T1e.tick();
eq('a toolbar that has just appeared without the item is not believed on first sight', lastState(T1e), 'closed');
T1e.tick();
eq('and is on the second', lastState(T1e), 'unavailable <' + NO_ITEM_REASON + '>');
// A phone's toolbar renders its items one at a time: the DevTools item arrives after the others.
var T1g = makePage();
T1g.nodes['li.toolbar-list-item'] = toolbarItem(false);
T1g.run();
T1g.nodes['li.switchDevtools-menu-wrapper'] = toolbarItem(false);
T1g.tick(6);
eq('a toolbar whose DevTools item arrives on the next scan is never called unavailable', T1g.states().join('|'), 'closed');
// ...and a toolbar that gains the item, then loses it again in a re-render, starts the count from nothing.
var T1j = makePage();
T1j.nodes['li.toolbar-list-item'] = toolbarItem(false);
T1j.run();
T1j.nodes['li.switchDevtools-menu-wrapper'] = toolbarItem(false);
T1j.tick();
delete T1j.nodes['li.switchDevtools-menu-wrapper'];
T1j.tick();
eq('item-less, item, item-less: the item in between ends the run, so this is one scan, not two', T1j.states().join('|'), 'closed');
T1j.tick();
eq('and the scan after is the second in a row', lastState(T1j), 'unavailable <' + NO_ITEM_REASON + '>');
// Two scans that are not in a row do not add up: a re-render in between starts the count again.
var T1h = makePage();
T1h.nodes['li.toolbar-list-item'] = toolbarItem(false);
T1h.run();
delete T1h.nodes['li.toolbar-list-item'];
T1h.tick();
T1h.nodes['li.toolbar-list-item'] = toolbarItem(false);
T1h.tick();
eq('item-less, gone, item-less: not two in a row', T1h.states().join('|'), 'closed');
T1h.tick();
eq('the next scan makes two in a row', lastState(T1h), 'unavailable <' + NO_ITEM_REASON + '>');
// A disabled item in between also ends the run (it is a different finding).
var T1i = makePage();
T1i.nodes['li.toolbar-list-item'] = toolbarItem(false);
T1i.run();
T1i.nodes['li.switchDevtools-menu-wrapper'] = toolbarItem(true);
T1i.tick();
T1i.tick();
ok('a disabled item is read as that (Live\'s own reason), not as a missing one', /unavailable <Live's DevTools is unavailable for this device>$/.test(lastState(T1i)), T1i.states());
var T1f = makePage();
T1f.nodes['li.toolbar-list-item'] = toolbarItem(false);
T1f.nodes['li.switchDevtools-menu-wrapper'] = toolbarItem(false);
T1f.run();
eq('a toolbar WITH an enabled DevTools item (a phone) is just closed until it is opened', T1f.states().join('|'), 'closed');
// Live renders the session toolbar, takes it away for about 4 s and puts it back, early in a session
// (iOS 27 and desktop, measured 2026-10-08). The mirror line must not flip to "open DevTools" and back.
var TH_HELD = 'unavailable <' + IOS27_MSG + '>';
function iosToolbar(page) {
  page.nodes['li.toolbar-list-item'] = toolbarItem(false);
  page.nodes['li.switchDevtools-menu-wrapper'] = toolbarItem(true);
  page.nodes['#devtools_message'] = { textContent: IOS27_RAW };
}
function noToolbar(page) { delete page.nodes['li.toolbar-list-item']; delete page.nodes['li.switchDevtools-menu-wrapper']; }
var TH = makePage();
iosToolbar(TH);
TH.run();
eq('iOS 27 with its toolbar up: unavailable', TH.states().join('|'), TH_HELD);
noToolbar(TH);
TH.tick(8);
eq('the whole toolbar goes away for 8 scans: what it said is kept, and nothing is re-posted', TH.states().join('|'), TH_HELD);
TH.tick();
eq('away for a ninth scan: it is not remembered for ever', TH.states().join('|'), TH_HELD + '|closed');
var TH2 = makePage();
iosToolbar(TH2);
TH2.run();
noToolbar(TH2);
TH2.tick(5);
iosToolbar(TH2);
TH2.tick(2);
noToolbar(TH2);
TH2.tick(8);
eq('a toolbar that comes back starts the count again: away 5, back 2, away 8 is still unavailable', TH2.states().join('|'), TH_HELD);
var TH3 = makePage();
iosToolbar(TH3);
TH3.run();
noToolbar(TH3);
TH3.tick(2);
TH3.nodes['li.toolbar-list-item'] = toolbarItem(false);
TH3.nodes['li.switchDevtools-menu-wrapper'] = toolbarItem(false);
TH3.tick();
eq('back with the DevTools item enabled: closed at once (nothing held against what Live now says)', lastState(TH3), 'closed');
var TH4 = makePage();
TH4.nodes['li.toolbar-list-item'] = toolbarItem(false);
TH4.nodes['li.switchDevtools-menu-wrapper'] = toolbarItem(false);
TH4.run();
noToolbar(TH4);
TH4.tick(3);
eq('nothing was unavailable, so nothing is held: closed throughout', TH4.states().join('|'), 'closed');
// desktop: item-less toolbar on two scans, away for 4, back item-less
var TH5 = makePage();
TH5.nodes['li.toolbar-list-item'] = toolbarItem(false);
TH5.run();
TH5.tick();
var TH5_OFF = 'unavailable <its toolbar has no DevTools item (desktop browser sessions have none).>';
eq('a desktop toolbar with no DevTools item on two scans: unavailable', lastState(TH5), TH5_OFF);
noToolbar(TH5);
TH5.tick(4);
TH5.nodes['li.toolbar-list-item'] = toolbarItem(false);
TH5.tick();
eq('away for 4 scans and back item-less: unavailable throughout, not "closed" for the scan it takes to be believed again', TH5.states().join('|'), 'closed|' + TH5_OFF);
// the hold starts again whichever kind of toolbar comes back
var TH6 = makePage();
TH6.nodes['li.toolbar-list-item'] = toolbarItem(false);
TH6.run();
TH6.tick();
noToolbar(TH6);
TH6.tick(5);
TH6.nodes['li.toolbar-list-item'] = toolbarItem(false);
TH6.tick();
noToolbar(TH6);
TH6.tick(8);
eq('desktop: away 5, back item-less, away 8: still unavailable (the count started again when the toolbar came back)', TH6.states().join('|'), 'closed|' + TH5_OFF);
// what Live last said is what is held: an enabled item is not "unavailable" again once the toolbar goes
var TH7 = makePage();
iosToolbar(TH7);
TH7.run();
TH7.nodes['li.switchDevtools-menu-wrapper'] = toolbarItem(false);
TH7.tick();
eq('the item is enabled: closed', lastState(TH7), 'closed');
noToolbar(TH7);
TH7.tick(3);
eq('and the toolbar then going away does not bring the earlier "unavailable" back', TH7.states().join('|'), TH_HELD + '|closed');
var T1c = makePage();
T1c.nodes['li.switchDevtools-menu-wrapper'] = { getAttribute: function () { throw new Error('boom'); } };
T1c.run();
eq('a page that throws on the toolbar item reads as closed, not a crash', T1c.states().join('|'), 'closed');

// A frame with no device behind it.
var T2 = makePage();
var FE_A = makeFrontend({ targets: [], messages: [msg('[cro] early')] });
T2.frames.push(makeFrame(FE_A, T2.counters));
T2.run();
eq('frame up, no device: attaching, NOT connected', T2.states().join('|'), 'attaching ' + VER);
T2.flush();
eq('it is hooked all the same: what the device logged is replayed', T2.lines().map(function (l) { return l.text; }).join('|'), '[cro] early');
T2.tick(13);
eq('not late at 14 scans', T2.states().length, 1);
T2.tick();
eq('late at 15 scans', T2.states().join('|'), 'attaching ' + VER + '|attaching ' + VER + ' late');
T2.tick(5);
eq('and says so once', T2.states().length, 2);
FE_A.setTargets([{ name: 'page' }]);
T2.tick();
eq('the device attaches: connected', lastState(T2), 'connected ' + VER);
FE_A.fire(msg('[cro] after'));
T2.flush();
eq('and its console is relayed', T2.lines().slice(-1)[0].text, '[cro] after');
FE_A.setTargets([]);
T2.tick();
eq('the device detaches: attaching again, and not late at once', lastState(T2), 'attaching ' + VER);

var T3 = makePage();
T3.frames.push(makeFrame(makeFrontend({ noTargetManager: true }), T3.counters));
T3.run();
eq('a frontend that cannot be asked about targets is assumed attached', T3.states().join('|'), 'connected ' + VER);
var T3b = makePage();
T3b.frames.push(makeFrame(makeFrontend({ throwingTargets: true }), T3b.counters));
T3b.run();
eq('one whose targets() throws is assumed attached too', T3b.states().join('|'), 'connected ' + VER);

// Commands on a frame with no device.
var T6 = makePage();
T6.frames.push(makeFrame(makeFrontend({ targets: [] }), T6.counters));
T6.run();
ok('commands say the frame has not attached, and how to fix it', /hasn't attached to the device\. Close and reopen it/.test(evalResult(T6, '1').error), evalResult(T6, '1'));

// Live's own failure notice.
var FAILED_TEXT = 'Developer tools have experienced an unexpected issue. Please try a new session.';
var T4 = makePage();
T4.setBody('Skip to main content  ' + FAILED_TEXT + '  Schedule UI monitoring');
T4.run();
eq('no frame and Live says DevTools broke: failed, with its sentence', T4.states().join('|'), 'failed <' + FAILED_TEXT + '>');
var T4b = makePage();
T4b.frames.push(makeFrame(makeFrontend({ targets: [] }), T4b.counters));
T4b.setBody(FAILED_TEXT);
T4b.run();
eq('a frame with no device and that notice: failed, with the version', T4b.states().join('|'), 'failed ' + VER + ' <' + FAILED_TEXT + '>');
var T4c = makePage();
T4c.frames.push(makeFrame(makeFrontend({}), T4c.counters));
T4c.setBody(FAILED_TEXT);
T4c.run();
eq('a frame that is attached is connected whatever the page says', T4c.states().join('|'), 'connected ' + VER);
var T4d = makePage();
T4d.setBody('A page about developer tools in general. Nothing broke.');
T4d.run();
eq('other text about developer tools is not a failure', T4d.states().join('|'), 'closed');
var T4e = makePage();
T4e.run();
eq('a page with no body at all is just closed', T4e.states().join('|'), 'closed');

// A device, and no page to run in. Measured on real sessions 2026-10-13,
// sampled every 100 ms after DevTools opened:
//   Galaxy S26: target at 0.4 s with no context and no URL; context and URL at
//     0.6 s. A reload: context gone for 0.1 s, URL kept.
//   iPhone 17 (iOS 26.6, and 26.5 the same): target 0.2 s after "Chrome
//     DevTools" was chosen, then 40 s with no context and no URL;
//     runtimeAgent().invoke_evaluate location.href answered "about:blank".
// Scans are 1 s apart, so the Galaxy's gaps are at most one scan.
section('the tap: a device with no page to run in');
function nopageStates(page) { return page.posted.filter(function (p) { return p.m.kind === 'state'; }).map(function (p) { return p.m.state + (p.m.page ? ' ' + p.m.page : ''); }); }

// Galaxy S26: one scan catches the device before its context.
var G1fe = makeFrontend({ ctx: null, href: 'https://example.com/?measure=android' });
var G1 = makePage();
G1.frames.push(makeFrame(G1fe, G1.counters));
G1.run();
eq('Android, a device with no context yet: attaching, not connected', nopageStates(G1).join('|'), 'attaching');
G1fe.setCtx({ evaluate: function () { return Promise.resolve({ object: { type: 'undefined' } }); } });
G1.tick();
eq('its context comes up a scan later: connected', nopageStates(G1).join('|'), 'attaching|connected');
eq('and the page was never read: no probe on a working device', G1fe.probeCalls.length, 0);
// A reload: the context is gone for one scan.
G1fe.setCtx(null);
G1.tick();
G1fe.setCtx({ evaluate: function () { return Promise.resolve({ object: { type: 'undefined' } }); } });
G1.tick();
eq('a reload (context gone for one scan) posts nothing: still connected', nopageStates(G1).join('|'), 'attaching|connected');
// Gone for PAGE_GRACE scans: still connected; the next one starts the read.
G1fe.setCtx(null);
G1.tick(3);
eq('three scans without a context: still connected', nopageStates(G1).join('|'), 'attaching|connected');
eq('and not yet read', G1fe.probeCalls.length, 0);
G1.tick();
eq('the fourth reads the page', G1fe.probeCalls.length, 1);
eq('with nothing posted until the answer is in', nopageStates(G1).join('|'), 'attaching|connected');
drainMicrotasks();
G1.tick();
eq('a real page with no context, past the grace: nopage, other', nopageStates(G1).slice(-1)[0], 'nopage other');

// iPhone 17: a device, never a context, on about:blank.
var I1fe = makeFrontend({ ctx: null, href: 'about:blank' });
var I1 = makePage();
I1.frames.push(makeFrame(I1fe, I1.counters));
I1.run();
I1.tick(2);
eq('iOS 26: attaching through the grace, said once', nopageStates(I1).join('|'), 'attaching');
ok('never late meanwhile', I1.posted.every(function (p) { return !p.m.late; }));
I1.tick();
eq('the page is read once the grace is over', I1fe.probeCalls.length, 1);
eq('reading location.href, by value', JSON.stringify(I1fe.probeCalls[0]), '{"expression":"location.href","returnByValue":true}');
drainMicrotasks();
I1.tick();
eq('iOS 26: nopage, on an empty tab', nopageStates(I1).join('|'), 'attaching|nopage blank');
eq('with the frontend version', I1.states().slice(-1)[0], 'nopage ' + VER);
I1.tick(8);
eq('it is not re-read before PROBE_EVERY scans', I1fe.probeCalls.length, 1);
for (var s30 = 0; s30 < 30; s30++) { I1.tick(); drainMicrotasks(); }
eq('but is re-read every 10 scans, in case the tab is navigated', I1fe.probeCalls.length, 4);
eq('and an unchanged answer posts nothing', nopageStates(I1).join('|'), 'attaching|nopage blank');
ok('commands say the tab is empty, not to wait or reload', /attached to an empty tab \(about:blank\), not the page under test/.test(evalResult(I1, '1').error), evalResult(I1, '1'));
I1fe.setCtx({ evaluate: function () { return Promise.resolve({ object: { type: 'number', value: 2 } }); } });
I1.tick();
eq('a context arriving later: connected', nopageStates(I1).slice(-1)[0], 'connected');
eq('and commands run', evalResult(I1, '1+1').text, '2');
I1fe.setCtx(null);
I1.tick(3);
var before4 = I1fe.probeCalls.length;
I1.tick();
eq('losing it again starts a fresh read, not the old answer', I1fe.probeCalls.length, before4 + 1);
I1fe.setTargets([]);
I1.tick();
eq('the device detaching is attaching, as before', nopageStates(I1).slice(-1)[0], 'attaching');

// The tab navigates to a page while DevTools still has no context.
var I2fe = makeFrontend({ ctx: null, href: function (n) { return n === 1 ? 'about:blank' : 'https://example.com/'; } });
var I2 = makePage();
I2.frames.push(makeFrame(I2fe, I2.counters));
I2.run(); I2.tick(3); drainMicrotasks(); I2.tick();
I2.tick(10); drainMicrotasks(); I2.tick();
eq('a re-read that finds a page changes blank to other', nopageStates(I2).join('|'), 'attaching|nopage blank|nopage other');

// Reads that fail.
function nopageAfter(href) {
  var fe = makeFrontend({ ctx: null, href: href });
  var pg = makePage();
  pg.frames.push(makeFrame(fe, pg.counters));
  pg.run(); pg.tick(3); drainMicrotasks(); pg.tick();
  return { page: pg, fe: fe };
}
eq('a read that is refused: nopage, page unknown', nopageStates(nopageAfter(function () { return Promise.reject(new Error('no')); }).page).join('|'), 'attaching|nopage');
eq('a read that throws: nopage, page unknown', nopageStates(nopageAfter(function () { return { then: function () { throw new Error('boom'); } }; }).page).join('|'), 'attaching|nopage');
eq('a read that throws in the page (WebKit: wasThrown, the thrown value as the result) is unknown, not a page', nopageStates(nopageAfter(function () { return Promise.resolve({ result: { type: 'string', value: 'SecurityError' }, wasThrown: true }); }).page).join('|'), 'attaching|nopage');
eq('likewise with CDP exceptionDetails', nopageStates(nopageAfter(function () { return Promise.resolve({ result: { type: 'string', value: 'x' }, exceptionDetails: { text: 'Uncaught' } }); }).page).join('|'), 'attaching|nopage');
eq('an empty href is blank', nopageStates(nopageAfter('').page).join('|'), 'attaching|nopage blank');
eq('about:srcdoc is blank too', nopageStates(nopageAfter('about:srcdoc').page).join('|'), 'attaching|nopage blank');
var hang = nopageAfter(function () { return new Promise(function () {}); });
eq('a read that never answers posts nothing yet', nopageStates(hang.page).join('|'), 'attaching');
hang.page.flush();
hang.page.tick();
eq('after PROBE_MS it is nopage, page unknown', nopageStates(hang.page).join('|'), 'attaching|nopage');
ok('and a command does not claim the tab is empty', /no script context yet/.test(evalResult(hang.page, '1').error), evalResult(hang.page, '1'));
var keep = nopageAfter(function (n) { return n === 1 ? Promise.resolve({ result: { type: 'string', value: 'about:blank' } }) : Promise.reject(new Error('gone')); });
keep.page.tick(10); drainMicrotasks(); keep.page.tick();
eq('a later read that fails keeps the last answer', nopageStates(keep.page).join('|'), 'attaching|nopage blank');
var noAgentFe = makeFrontend({ ctx: null });
var NA = makePage();
NA.frames.push(makeFrame(noAgentFe, NA.counters));
NA.run(); NA.tick(3);
eq('a target with no runtime agent: nopage at once after the grace, page unknown', nopageStates(NA).join('|'), 'attaching|nopage');

var NU = makePage();
NU.frames.push(makeFrame(makeFrontend({ ctx: null, noUI: true }), NU.counters));
NU.run();
eq('a frontend that cannot be asked about contexts is assumed to have a page', NU.states().join('|'), 'connected ' + VER);
eq('the token is never read by any of this', I1.counters.src + G1.counters.src + I2.counters.src, 0);

// Live's DevTools broken, its frame unreadable. Measured 2026-10-13 on a Galaxy
// S26 launched with Local that Live started without it (the phone was on Live's
// "Unable to connect" page): DevTools opened to "Developer tools have experienced
// an unexpected issue. Please try a new session.", drawn on the dashboard (it is
// in document.body.innerText, split over two lines), while iframe.devtools-iframe
// had a same-origin src path and a cross-origin document: reading anything in it
// threw SecurityError. 0.7.12 said "Open DevTools…" for 30 s, then "Can't read this
// version of Live's DevTools (unknown version)"; a command said "no script context yet".
section('the tap: Live\'s DevTools broken, its frame unreadable');
var LIVE_FAIL_BODY = 'Samsung Galaxy S26 v16.0\nStop Session\nDeveloper tools have experienced an unexpected issue.\nPlease try a new session.\nSchedule UI monitoring';
var LIVE_FAIL_TEXT = 'Developer tools have experienced an unexpected issue. Please try a new session.';
function crossOriginFrame(counters) {
  var deny = function () { throw new Error("SecurityError: Failed to read a named property 'SDK' from 'Window': Blocked a frame with origin \"https://live.browserstack.com\" from accessing a cross-origin frame."); };
  var w = {};
  ['SDK', 'UI', 'location', 'document'].forEach(function (k) { Object.defineProperty(w, k, { get: deny }); });
  return {
    contentWindow: w,
    get src() { counters.src++; return '/devtools/realios/91.0.4472.101/inspector.html?wss=' + FAKE_JWT; },
    getAttribute: function (n) { counters.attr.push(n); return n === 'src' ? this.src : null; },
  };
}
var X1 = makePage();
X1.frames.push(crossOriginFrame(X1.counters));
X1.setBody(LIVE_FAIL_BODY);
X1.run();
eq('an unreadable frame and Live\'s notice: failed at once, in Live\'s words', X1.states().join('|'), 'failed <' + LIVE_FAIL_TEXT + '>');
X1.tick(40);
eq('and it stays failed: never "unsupported" (it is not a version problem)', X1.states().join('|'), 'failed <' + LIVE_FAIL_TEXT + '>');
eq('a command gets Live\'s reason, not "no script context yet"', evalResult(X1, '1').error, "Live's DevTools failed: " + LIVE_FAIL_TEXT);
eq('nothing in the frame was read, the token included', X1.counters.src + ':' + X1.counters.attr.length, '0:0');

var X2 = makePage();
X2.frames.push(crossOriginFrame(X2.counters));
X2.run();
eq('an unreadable frame with no notice: nothing said early (it may still be opening)', X2.states().length, 0);
eq('and a command meanwhile says it is still opening', evalResult(X2, '1').error, "Live's DevTools is still opening. Try again in a moment.");
X2.tick(3);
X2.setBody(LIVE_FAIL_BODY);
X2.tick();
eq('the notice appearing later: failed then', X2.states().join('|'), 'failed <' + LIVE_FAIL_TEXT + '>');

var X3 = makePage();
X3.frames.push(crossOriginFrame(X3.counters));
X3.run();
X3.tick(29);
eq('an unreadable frame and no notice for 30 scans: still unsupported, as before', X3.states().join('|'), 'unsupported');
eq('and a command then says the frontend cannot be read', evalResult(X3, '1').error, "Selenite can't read this version of Live's DevTools, so commands can't run through it.");

// A device attached with no page context while Live says DevTools broke.
var X4fe = makeFrontend({ ctx: null, href: 'about:blank' });
var X4 = makePage();
X4.frames.push(makeFrame(X4fe, X4.counters));
X4.setBody(LIVE_FAIL_BODY);
X4.run();
X4.tick(5); drainMicrotasks(); X4.tick();
eq('a device with no page and Live\'s notice: failed, not attaching or nopage', X4.states().join('|'), 'failed ' + VER + ' <' + LIVE_FAIL_TEXT + '>');
eq('and the page is not read', X4fe.probeCalls.length, 0);
eq('a command gets Live\'s reason', evalResult(X4, '1').error, "Live's DevTools failed: " + LIVE_FAIL_TEXT);
var X5 = makePage();
X5.frames.push(makeFrame(makeFrontend({}), X5.counters));
X5.setBody(LIVE_FAIL_BODY);
X5.run();
eq('a device with a page is connected whatever the notice says (a stale notice cannot hide a working mirror)', X5.states().join('|'), 'connected ' + VER);

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

deliver({ __seleniteBsLive: 1, kind: 'state', state: 'unavailable', version: null, reason: IOS27_TIP });
deliver({ __seleniteBsLive: 1, kind: 'state', state: 'attaching', version: 'realios 91.0.4472.101', late: true });
deliver({ __seleniteBsLive: 1, kind: 'state', state: 'failed', reason: 'Developer tools have experienced an unexpected issue.' });
eq('unavailable is forwarded with Live\'s reason', JSON.stringify(sent[2]), '{"action":"bsDeviceState","state":"unavailable","version":null,"reason":"' + IOS27_TIP + '"}');
eq('attaching is forwarded, late', JSON.stringify(sent[3]), '{"action":"bsDeviceState","state":"attaching","version":"realios 91.0.4472.101","late":true}');
eq('failed is forwarded with its reason', sent[4].state + ':' + sent[4].reason, 'failed:Developer tools have experienced an unexpected issue.');
deliver({ __seleniteBsLive: 1, kind: 'state', state: 'unavailable', reason: new Array(500).join('y') });
eq('a reason is capped at 200 characters', sent[5].reason.length, 200);
deliver({ __seleniteBsLive: 1, kind: 'state', state: 'unavailable', reason: { evil: true }, late: 'yes' });
ok('a reason that is not a string and a late that is not true are dropped', !('reason' in sent[6]) && !('late' in sent[6]), sent[6]);
deliver({ __seleniteBsLive: 1, kind: 'state', state: 'nopage', version: 'realios 91.0.4472.101', page: 'blank' });
eq('nopage is forwarded, with what the page is', JSON.stringify(sent[7]), '{"action":"bsDeviceState","state":"nopage","version":"realios 91.0.4472.101","page":"blank"}');
deliver({ __seleniteBsLive: 1, kind: 'state', state: 'nopage', page: 'other' });
eq('other passes too', sent[8] && sent[8].page, 'other');
deliver({ __seleniteBsLive: 1, kind: 'state', state: 'nopage', page: 'https://example.com/?secret=1' });
ok('a page that is not blank/other (a URL) is not forwarded', !!sent[9] && sent[9].state === 'nopage' && !('page' in sent[9]), sent[9]);

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


// ── the panel's wording for the device state ───────────────────────────────
section('panel: device status line (bcDeviceLine)');
eval(sliceBetween(POPUP, 'function bcDeviceLine(devState, status, device) {', '\nasync function syncBcStatus', 'popup bcDeviceLine'));
var DEVN = 'iPhone 18 Pro v27.0';
eq('connected', bcDeviceLine('connected', {}, DEVN).text, "● Live — mirroring iPhone 18 Pro v27.0 through BrowserStack Live's DevTools");
eq('connected is the brand colour', bcDeviceLine('connected', {}, DEVN).color, 'var(--brand)');
eq('unavailable says Live has none, and why', bcDeviceLine('unavailable', { reason: IOS27_TIP }, DEVN).text, '○ Live has no DevTools for iPhone 18 Pro v27.0: ' + IOS27_TIP);
eq('unavailable is a warning, not an error', bcDeviceLine('unavailable', { reason: 'x' }, DEVN).color, 'var(--warn)');
eq('unavailable with no reason still reads', bcDeviceLine('unavailable', {}, DEVN).text, '○ Live has no DevTools for iPhone 18 Pro v27.0: unavailable');
eq('attaching, not late: waiting', bcDeviceLine('attaching', {}, DEVN).text, '○ DevTools is open in Live; waiting for it to attach to iPhone 18 Pro v27.0…');
eq('attaching, late: says what to do', bcDeviceLine('attaching', { late: true }, DEVN).text, '○ DevTools is open in Live but hasn\'t attached to iPhone 18 Pro v27.0 after 15 s. Close and reopen it in Live, or start a new session.');
eq('attaching, late, is a warning', bcDeviceLine('attaching', { late: true }, DEVN).color, 'var(--warn)');
eq('attaching, not late, is quiet', bcDeviceLine('attaching', {}, DEVN).color, 'var(--fg3)');
eq("failed uses Live's words and does not repeat the advice", bcDeviceLine('failed', { reason: FAILED_TEXT }, DEVN).text, "○ Live's DevTools failed on iPhone 18 Pro v27.0: " + FAILED_TEXT);
ok('failed adds the advice when Live gave none', /Start a new session\.$/.test(bcDeviceLine('failed', { reason: 'It broke.' }, DEVN).text));
eq('failed is an error', bcDeviceLine('failed', {}, DEVN).color, 'var(--err)');
eq('unsupported names the frontend version', bcDeviceLine('unsupported', { version: 'realios 99' }, DEVN).text, "○ Can't read this version of Live's DevTools (realios 99)");
eq('old worker says to reload', bcDeviceLine('old-worker', {}, DEVN).text, '○ Reload Selenite in chrome://extensions to mirror BrowserStack devices');
eq('closed on an iPhone: open DevTools, and which of its two menu items', bcDeviceLine('closed', {}, DEVN).text, "○ Open DevTools in the Live session to mirror iPhone 18 Pro v27.0's console (choose Chrome DevTools, not Safari Web Inspector)");
eq('waiting reads the same as closed', bcDeviceLine('waiting', null, DEVN).text, bcDeviceLine('closed', {}, DEVN).text);
eq('an iPad gets the same hint', /choose Chrome DevTools/.test(bcDeviceLine('closed', {}, 'iPad Pro 13 2024 v18.0').text), true);
eq('an Android phone has no such menu, so no hint', bcDeviceLine('closed', {}, 'Samsung Galaxy S26 v16.0').text, "○ Open DevTools in the Live session to mirror Samsung Galaxy S26 v16.0's console");
eq('nor does a session that has no name', bcDeviceLine('closed', {}, 'this session').text, "○ Open DevTools in the Live session to mirror this session's console");
var IP17 = 'iPhone 17 v26.6';
eq('nopage on an empty tab: says so, and that it is not the page under test', bcDeviceLine('nopage', { page: 'blank' }, IP17).text, "○ Live's DevTools on iPhone 17 v26.6 is attached to an empty tab (about:blank), not the page under test, so there's nothing to mirror and commands can't run.");
eq('nopage on some other page: claims only what is known', bcDeviceLine('nopage', { page: 'other' }, IP17).text, "○ Live's DevTools is attached to iPhone 17 v26.6 but gives Selenite no page to run commands in.");
eq('nopage, page unknown: the same', bcDeviceLine('nopage', {}, IP17).text, bcDeviceLine('nopage', { page: 'other' }, IP17).text);
ok('nopage never claims to be mirroring', !/mirroring/.test(bcDeviceLine('nopage', { page: 'blank' }, IP17).text) && !/mirroring/.test(bcDeviceLine('nopage', {}, IP17).text));
eq('nopage is a warning', bcDeviceLine('nopage', { page: 'blank' }, IP17).color + bcDeviceLine('nopage', {}, IP17).color, 'var(--warn)var(--warn)');
eq('nopage passes through bcDeviceState from the worker', bcDeviceState(LIVE_CS, { state: 'nopage', tabId: 11, page: 'blank' }, undefined), 'nopage');
eval(sliceBetween(POPUP, 'function bcDeviceName(title) {', '\n}\n', 'popup bcDeviceName') + '\n}');
eq('a phone is named by its tab', bcDeviceName('iPhone 18 Pro v27.0'), 'iPhone 18 Pro v27.0');
eq('a desktop session keeps the title "Dashboard", which names nothing', bcDeviceName('Dashboard'), 'this session');
eq('no title at all', bcDeviceName(''), 'this session');
eq('whitespace is not a name', bcDeviceName('   '), 'this session');
eq('undefined', bcDeviceName(undefined), 'this session');
eq("Live's idle countdown is not a device name", bcDeviceName('37 seconds to session timeout'), 'this session');
eq('nor is a loading tab\'s own address (measured: "mirror live.browserstack.com\'s console")', bcDeviceName('live.browserstack.com') + ' / ' + bcDeviceName('live.browserstack.com/dashboard#os=android&os_version=16.0'), 'this session / this session');
eq('so a desktop line reads naturally', bcDeviceLine('unavailable', { reason: 'its toolbar has no DevTools item (desktop browser sessions have none).' }, bcDeviceName('Dashboard')).text, "○ Live has no DevTools for this session: its toolbar has no DevTools item (desktop browser sessions have none).");
eq('the new states pass through bcDeviceState from the worker', ['unavailable', 'attaching', 'failed'].map(function (st) {
  return bcDeviceState(LIVE_CS, { state: st, tabId: 11 }, undefined);
}).join(','), 'unavailable,attaching,failed');

// ── what the Live tab says about a launch ──────────────────────────────────
// bsLiveReadOutcome runs INSIDE the page via executeScript, so it must stand
// alone: it is rebuilt here from its own source, with document and window as
// the only things it can see, exactly as the page would run it.
section('the page reader (bsLiveReadOutcome)');
function readPage(page) {
  var doc = {
    title: page.title === undefined ? '' : page.title,
    querySelectorAll: function (sel) {
      return sel === '.notification-message-banner--error' ? (page.banners || []).map(function (t) { return { textContent: t }; }) : [];
    },
    querySelector: function (sel) {
      if (sel === '[aria-label="Stop Session"]') return page.session ? { getAttribute: function () { return 'Stop Session'; } } : null;
      if (sel === '#device-search-field') {
        if (page.pickerBroken) return { getBoundingClientRect: function () { throw new Error('boom'); } };
        if (page.pickerHidden) return { getBoundingClientRect: function () { return { width: 0, height: 0 }; } };
        if (page.pickerFlat) return { getBoundingClientRect: function () { return { width: 101, height: 0 }; } };
        if (page.pickerThin) return { getBoundingClientRect: function () { return { width: 0, height: 24 }; } };
        return page.picker ? { getBoundingClientRect: function () { return { width: 101, height: 24 }; } } : null;
      }
      if (sel === 'li.switchDevtools-menu-wrapper') return page.li === undefined ? null : toolbarItem(page.li);
      if (sel === '#devtools_message') return page.msg == null ? null : { textContent: page.msg };
      if (sel === '#tooltip-switchDevtools') return page.tip == null ? null : { textContent: page.tip };
      return null;
    },
  };
  var win = page.reactor === undefined ? {} : { Reactor: { localTesting: {
    getLocalStatusAtStart: function () { return page.reactor.local; },
    getIsForceLocalEnable: function () { return page.reactor.force; },
  } } };
  return new Function('document', 'window', 'return (' + bsLiveReadOutcome.toString() + ')();')(doc, win);
}
var BANNER_DISABLED = 'Device is temporarily disabled. Please try again in some time.';
var BANNER_DROPPED = 'Connection to the remote device failed. Please try again.';
// The pages, as measured:
var PG_PICKER = { title: 'Dashboard', picker: true };           // the device picker: at the start, and again once a session has ended
var PG_BOOT = { title: 'Samsung Galaxy S26', li: undefined };   // the boot screen: no picker, no toolbar, no version in the title
var PG_ANDROID_NO_LOCAL = { title: 'Samsung Galaxy S26 v16.0', session: true, li: false, reactor: { local: false, force: false } };
var PG_ANDROID_LOCAL = { title: 'Samsung Galaxy S26 v16.0', session: true, li: false, reactor: { local: true, force: false } };
var PG_IOS27 = { title: 'iPhone 18 Pro v27.0', session: true, li: true, msg: IOS27_RAW, tip: IOS27_TIP, reactor: { local: false, force: false } };
// A phone's tab says "running" 5 to 10 s before its toolbar exists, and the dashboard's
// Local-at-start record reads false until the toolbar renders (measured, iPhone 18 Pro):
// the title with no toolbar yet, and the same session once the toolbar is up and Local is true.
var PG_PHONE_EARLY = { title: 'iPhone 18 Pro v27.0', reactor: { local: false, force: false } };
var PG_PHONE_UP = { title: 'iPhone 18 Pro v27.0', session: true, li: false, reactor: { local: true, force: false } };
// A desktop session's toolbar is rendered, goes away for about 4 s, and comes back (measured,
// Windows Chrome and iOS 27): while it is away the page has no picker, no toolbar and the title "Dashboard".
var PG_DESKTOP_UP = { title: 'Dashboard', session: true, reactor: { local: true, force: false } };
var PG_TOOLBAR_AWAY = { title: 'Dashboard' };
// A desktop browser session, as measured on Mac Safari: the tab stays "Dashboard"
// and no DevTools toolbar item exists, but the Stop Session control does.
var PG_DESKTOP = { title: 'Dashboard', session: true, reactor: { local: false, force: false } };
// Live puts the picker back as it raises the banner, for a refusal and for a drop alike.
var PG_REFUSED = { title: 'Dashboard', picker: true, banners: [BANNER_DISABLED] };
var PG_DROPPED = { title: 'Dashboard', picker: true, banners: [BANNER_DROPPED] };

var R1 = readPage(PG_IOS27);
eq('iOS 27: the tab title', R1.title, 'iPhone 18 Pro v27.0');
eq('iOS 27: the DevTools item is present and disabled', R1.devtools.present + ':' + R1.devtools.disabled, 'true:true');
eq("iOS 27: Live's message is the reason (it names the tabs), as written", R1.devtools.reason, IOS27_RAW);
eq('iOS 27: no banner', R1.errors.length, 0);
eq('iOS 27: Local was not on at start, force-local off', R1.local + ':' + R1.forceLocal, 'false:false');
eq('the tooltip is the reason when there is no message', readPage({ title: 'x v1.0', li: true, tip: IOS27_TIP }).devtools.reason, IOS27_TIP);
var R2 = readPage(PG_ANDROID_LOCAL);
eq('Android: the item is present and enabled, with no reason', R2.devtools.present + ':' + R2.devtools.disabled + ':' + R2.devtools.reason, 'true:false:');
eq('Android: Local was on at start', R2.local, true);
eq('a session is read off the Stop Session control', readPage(PG_DESKTOP).session + ':' + readPage(PG_PICKER).session + ':' + readPage(PG_ANDROID_LOCAL).session, 'true:false:true');
eq("the picker is read off its search box, when it has a size", readPage(PG_PICKER).picker + ':' + readPage(PG_ANDROID_LOCAL).picker + ':' + readPage(PG_DESKTOP).picker, 'true:false:false');
eq('a search box with no size (hidden, or about to go) is not the picker', readPage({ title: 'Dashboard', pickerHidden: true }).picker, false);
eq('one with a width and no height is not, nor one with a height and no width', readPage({ title: 'Dashboard', pickerFlat: true }).picker + ':' + readPage({ title: 'Dashboard', pickerThin: true }).picker, 'false:false');
eq('a search box that throws when measured is not the picker either, and does not break the rest', readPage({ title: 'x v1.0', pickerBroken: true, banners: ['b'] }).picker + ':' + readPage({ title: 'x v1.0', pickerBroken: true, banners: ['b'] }).errors.length, 'false:1');
eq('a desktop session has no DevTools item and says nothing about it', JSON.stringify(readPage(PG_DESKTOP).devtools), '{"present":false,"disabled":null,"reason":""}');
eq('a refused launch is read off the banner', JSON.stringify(readPage(PG_REFUSED).errors), JSON.stringify([BANNER_DISABLED]));
eq('a dropped session likewise', readPage(PG_DROPPED).errors[0], BANNER_DROPPED);
eq('no toolbar yet (the picker): not present, nothing claimed', JSON.stringify(readPage(PG_PICKER).devtools), '{"present":false,"disabled":null,"reason":""}');
eq('no dashboard state yet: Local and force-local unknown, not false', readPage(PG_PICKER).local + ':' + readPage(PG_PICKER).forceLocal, 'null:null');
eq('banner text is whitespace-collapsed', readPage({ banners: ['  Device is\n   temporarily   disabled.  '] }).errors[0], 'Device is temporarily disabled.');
eq('the same banner twice is read once', readPage({ banners: [BANNER_DISABLED, BANNER_DISABLED] }).errors.length, 1);
eq('at most three banners', readPage({ banners: ['a', 'b', 'c', 'd', 'e'] }).errors.length, 3);
ok('a long banner is cut at 200', readPage({ banners: [new Array(400).join('z')] }).errors[0].length === 200);
var boom = function () { throw new Error('boom'); };
var broken = new Function('document', 'window', 'return (' + bsLiveReadOutcome.toString() + ')();')(
  { get title() { boom(); }, querySelectorAll: boom, querySelector: boom }, { get Reactor() { boom(); } });
eq('a page that throws on every read still gives an object, never a throw', JSON.stringify(broken),
  '{"title":"","session":false,"picker":false,"errors":[],"local":null,"forceLocal":null,"devtools":{"present":false,"disabled":null,"reason":""}}');
eq('a Local state that is not a boolean is null, never false', readPage({ title: 'x v1.0', reactor: { local: undefined, force: 'yes' } }).local + ':' + readPage({ title: 'x v1.0', reactor: { local: undefined, force: 'yes' } }).forceLocal, 'null:null');
eq('a Local state of 0 or "false" is not read as false either', readPage({ title: 'x v1.0', reactor: { local: 0, force: 'false' } }).local, null);
eq('and so the status line then makes no claim about Local', bsLaunchLine(bsLaunchVerdict(readPage({ title: 'x v1.0', session: true, reactor: { local: undefined } }), {}), { what: 'X', wantLocal: true }).offerManual, false);

section('launch verdict (bsLaunchVerdict)');
function verdict(page, opts) { return bsLaunchVerdict(page == null ? null : readPage(page), opts); }
eq('nothing read yet: starting', verdict(null, { elapsedMs: 0 }).state, 'starting');
eq('the picker is starting', verdict(PG_PICKER, { elapsedMs: 5000 }).state, 'starting');
eq('the boot screen (a device name, no version) is starting', verdict(PG_BOOT, { elapsedMs: 5000 }).state, 'starting');
eq('a tab named for a session is started', verdict(PG_ANDROID_NO_LOCAL, {}).state, 'started');
eq('"iPhone 18 Pro 27.0" (no v, as the title reads on the tab overview) is started too', verdict({ title: 'iPhone 18 Pro 27.0' }, {}).state, 'started');
eq('a title that only ends in a word is not', verdict({ title: 'BrowserStack Live' }, {}).state, 'starting');
eq('a desktop session (title "Dashboard", Stop Session present) is started', verdict(PG_DESKTOP, {}).state, 'started');
eq('and it is not timed out at 75 s', verdict(PG_DESKTOP, { elapsedMs: 80000 }).state, 'started');
eq('a desktop session has nothing to say about DevTools', verdict(PG_DESKTOP, {}).devtoolsOff + ':' + verdict(PG_DESKTOP, {}).devtoolsPresent, ':false');
eq('the same page without Stop Session is still the picker', verdict({ title: 'Dashboard', session: false }, { elapsedMs: 5000 }).state, 'starting');
eq('a refused device', verdict(PG_REFUSED, {}).state, 'refused');
eq('and Live\'s words are kept', verdict(PG_REFUSED, {}).error, BANNER_DISABLED);
eq('a session that drops later is refused, with its banner', verdict(PG_DROPPED, { wasStarted: true }).state + ':' + verdict(PG_DROPPED, { wasStarted: true }).error, 'refused:' + BANNER_DROPPED);
eq('a banner while the title says a session is running is not a refusal: it started', verdict({ title: 'iPhone 17 v26.5', banners: [BANNER_DROPPED] }, {}).state, 'started');
eq('nor beside a desktop session\'s Stop Session control', verdict({ title: 'Dashboard', session: true, banners: [BANNER_DROPPED] }, {}).state, 'started');
eq('and it still carries the session\'s Local state, whatever the toast said', verdict({ title: 'x v1.0', session: true, banners: ['Unable to start the recording.'], reactor: { local: true, force: false } }, {}).local, true);
eq('a banner on the picker is a refusal, whether or not the session had started', verdict(PG_DROPPED, {}).state + ':' + verdict(PG_DROPPED, { wasStarted: true }).state, 'refused:refused');
eq('before it started a banner needs nothing else (the boot screen has no picker)', verdict({ title: 'Samsung Galaxy S26', banners: [BANNER_DISABLED] }, {}).state, 'refused');
eq('after it started a banner with no picker is not a drop: a desktop session shows nothing else of itself while its toolbar is away', verdict({ title: 'Dashboard', banners: [BANNER_DROPPED] }, { wasStarted: true }).state, 'started');
eq('it says whether the session had started when it went', verdict(PG_DROPPED, { wasStarted: true }).afterStart + ':' + verdict(PG_REFUSED, {}).afterStart + ':' + verdict(PG_REFUSED, { wasStarted: false }).afterStart, 'true:false:false');

// Local, force-local and DevTools are the toolbar's to say. A phone's title says "running" 5 to 10 s
// before the toolbar exists, and the dashboard's Local-at-start record reads false until the toolbar
// renders (measured on iOS 27: false at the title, true when the toolbar came up).
var VE = verdict(PG_PHONE_EARLY, {});
eq('a title that says running, with no toolbar yet: started, and Local is not judged (the dashboard has not recorded it)', VE.state + ':' + VE.local + ':' + VE.forceLocal + ':' + VE.toolbar, 'started:null:null:false');
var VU = verdict(PG_PHONE_UP, {});
eq('the same session with its toolbar up: Local is what the dashboard then says', VU.state + ':' + VU.local + ':' + VU.toolbar, 'started:true:true');
eq('the line for the early reading makes no claim about Local and offers no manual route', bsLaunchLine(VE, { what: 'x', wantLocal: true, wantForceLocal: true }).text + '|' + bsLaunchLine(VE, { what: 'x', wantLocal: true }).offerManual, 'x is running in BrowserStack Live.|false');
eq('and the one with the toolbar up says Local was on', bsLaunchLine(VU, { what: 'x', wantLocal: true }).text, 'x is running in BrowserStack Live. Local was on when it started.');
eq('an iOS 27 session read before its toolbar says nothing of DevTools yet', verdict({ title: 'iPhone 18 Pro v27.0', li: true, msg: IOS27_RAW }, {}).devtoolsOff + ':' + verdict({ title: 'iPhone 18 Pro v27.0', li: true, msg: IOS27_RAW }, {}).devtoolsPresent, ':false');
// The toolbar goes away for about 4 s early in a session (iOS 27 and desktop). What it said stands.
var VD1 = verdict(PG_DESKTOP_UP, {});
eq('a desktop session with its toolbar up: started, Local true', VD1.state + ':' + VD1.local + ':' + VD1.toolbar, 'started:true:true');
var VD2 = verdict(PG_TOOLBAR_AWAY, { wasStarted: true, seen: VD1 });
eq('the toolbar away (no picker, title "Dashboard"): still started, and what it said stands', VD2.state + ':' + VD2.local + ':' + VD2.toolbar, 'started:true:true');
eq('it carries force-local and DevTools too', JSON.stringify([VD2.forceLocal, VD2.devtoolsOff, VD2.devtoolsPresent]), JSON.stringify([false, '', false]));
var VI = bsLaunchVerdict(readPage(PG_IOS27), {});
var VI2 = verdict({ title: 'iPhone 18 Pro v27.0' }, { wasStarted: true, seen: VI });
eq('a phone whose toolbar went: its title still says running, and the iOS 27 reason stands', VI2.state + ':' + (VI2.devtoolsOff === VI.devtoolsOff && VI.devtoolsOff !== '') + ':' + VI2.devtoolsPresent, 'started:true:true');
eq('with nothing seen yet, the toolbar away is started with nothing known', JSON.stringify([verdict(PG_TOOLBAR_AWAY, { wasStarted: true }).state, verdict(PG_TOOLBAR_AWAY, { wasStarted: true }).local, verdict(PG_TOOLBAR_AWAY, { wasStarted: true }).toolbar]), JSON.stringify(['started', null, false]));
eq('a verdict made without the toolbar is not "seen" (it knows nothing to carry)', verdict(PG_TOOLBAR_AWAY, { wasStarted: true, seen: VE }).local + ':' + verdict(PG_TOOLBAR_AWAY, { wasStarted: true, seen: VE }).toolbar, 'null:false');
eq('whatever it holds: only a verdict that had the toolbar is carried from', verdict(PG_TOOLBAR_AWAY, { wasStarted: true, seen: { state: 'started', toolbar: false, local: false, forceLocal: false, devtoolsOff: 'x', devtoolsPresent: true } }).local + ':' + verdict(PG_TOOLBAR_AWAY, { wasStarted: true, seen: { state: 'started', toolbar: false, local: false, forceLocal: false, devtoolsOff: 'x', devtoolsPresent: true } }).devtoolsOff, 'null:');
eq('a fresh toolbar reading replaces what was seen', verdict(PG_ANDROID_NO_LOCAL, { wasStarted: true, seen: VD1 }).local, false);
// Ended is the picker coming back, and only that.
eq('back at the picker with no banner: ended', verdict(PG_PICKER, { wasStarted: true }).state, 'ended');
eq('nothing recognisable on the page (no picker, no toolbar): not ended', verdict(PG_TOOLBAR_AWAY, { wasStarted: true }).state, 'started');
eq('the picker before it ever started is just the start of the launch', verdict(PG_PICKER, {}).state, 'starting');
eq('a banner and the picker after it started: dropped, not ended', verdict(PG_DROPPED, { wasStarted: true }).state, 'refused');
eq('an iPhone 17 / Pixel title with a trailing version is running, and one without is not', verdict({ title: 'Google Pixel 10 v16.0' }, {}).state + ':' + verdict({ title: 'Google Pixel 10' }, {}).state, 'started:starting');
eq('was running, now back at the picker with no banner: ended', verdict(PG_PICKER, { wasStarted: true }).state, 'ended');
eq('was running and the page cannot be read: still started, not ended', bsLaunchVerdict(null, { wasStarted: true }).state, 'started');
eq('still the picker at 74 s: starting', verdict(PG_PICKER, { elapsedMs: 74999 }).state, 'starting');
eq('still the picker at 75 s: timeout', verdict(PG_PICKER, { elapsedMs: 75000 }).state, 'timeout');
eq('a started session never times out', verdict(PG_ANDROID_NO_LOCAL, { elapsedMs: 600000 }).state, 'started');
eq('Local at start is carried', verdict(PG_ANDROID_LOCAL, {}).local, true);
eq('Local missing at start is carried', verdict(PG_ANDROID_NO_LOCAL, {}).local, false);
eq('Local unknown stays null', verdict({ title: 'x v1.0' }, {}).local, null);
eq('DevTools off is carried with its reason', verdict(PG_IOS27, {}).devtoolsOff, IOS27_MSG);
eq('DevTools on is empty', verdict(PG_ANDROID_LOCAL, {}).devtoolsOff, '');
eq('a toolbar that has rendered is noted', verdict(PG_ANDROID_LOCAL, {}).devtoolsPresent, true);
eq('and one that has not', verdict({ title: 'x v1.0' }, {}).devtoolsPresent, false);
eq('a disabled item with no words still has a reason', verdict({ title: 'x v1.0', session: true, li: true }, {}).devtoolsOff, "Live's DevTools is unavailable for this device.");
eq('give-up time is 75 s', BS_LAUNCH_GIVE_UP_MS, 75000);
eq('the missing space after "devices." is put back in what the user sees', verdict(PG_IOS27, {}).devtoolsOff.indexOf('devices. Please close'), IOS27_MSG.indexOf('devices. Please close'));
eq('but a URL or a version is left alone', verdict({ title: 'x v1.0', session: true, li: true, msg: 'See live.browserstack.com/x or v27.0 now.' }, {}).devtoolsOff, 'See live.browserstack.com/x or v27.0 now.');

section('launch status line (bsLaunchLine)');
var WHAT = 'Control on Galaxy S26';
function line(page, ctx, opts) { return bsLaunchLine(verdict(page, opts), ctx); }
eq('starting', line(PG_PICKER, { what: WHAT }).text, 'Opened Control on Galaxy S26 in BrowserStack Live. Waiting for Live to start the session…');
eq('starting is informational', line(PG_PICKER, { what: WHAT }).tone, 'info');
eq('refused: what Live said, in its words', line(PG_REFUSED, { what: 'Control on iPhone 17' }).text, "Control on iPhone 17 didn't start. Live says: " + BANNER_DISABLED);
eq('refused is an error and offers nothing', line(PG_REFUSED, {}).tone + ':' + line(PG_REFUSED, {}).offerManual, 'err:false');
eq('a banner before it ever started reads the same way', line(PG_DROPPED, { what: WHAT }).text, "Control on Galaxy S26 didn't start. Live says: " + BANNER_DROPPED);
eq('but one after it had started does not claim it never started', line(PG_DROPPED, { what: WHAT }, { wasStarted: true }).text, 'Live dropped the session on Control on Galaxy S26. Live says: ' + BANNER_DROPPED);
eq('a dropped session is an error and offers nothing', line(PG_DROPPED, { what: WHAT }, { wasStarted: true }).tone + ':' + line(PG_DROPPED, { what: WHAT }, { wasStarted: true }).offerManual, 'err:false');
eq('closed before it started', bsLaunchLine({ state: 'closed', wasStarted: false }, { what: WHAT }).text, 'The Live tab for Control on Galaxy S26 was closed before it started.');
eq('closed after it started', bsLaunchLine({ state: 'closed', wasStarted: true }, { what: WHAT }).text, 'The Live tab for Control on Galaxy S26 was closed.');
eq('closed is information, not an alarm', bsLaunchLine({ state: 'closed' }, {}).tone, 'info');
eq('lost: Selenite stopped watching', bsLaunchLine({ state: 'lost' }, { what: WHAT }).text, 'Selenite stopped watching this launch. Look at the Live tab.');
eq('lost is a warning', bsLaunchLine({ state: 'lost' }, {}).tone, 'warn');
eq('left (Live sent the tab to sign in): where, what to do, and that the line follows', bsLaunchLine({ state: 'left', host: 'www.browserstack.com' }, { what: WHAT }).text, 'The Live tab went to www.browserstack.com instead of the dashboard. If that is a sign-in page, sign in to BrowserStack there; if Live then starts the device, this line follows it. If not, open Control on Galaxy S26 again.');
eq("Chrome's own error page is not named as a site", bsLaunchLine({ state: 'left', host: 'chrome-error' }, { what: WHAT }).text, "The Live tab couldn't load (Chrome showed an error page). Check your connection, then open Control on Galaxy S26 again.");
eq('left is a warning with no manual button', bsLaunchLine({ state: 'left', host: 'x' }, {}).tone + ':' + bsLaunchLine({ state: 'left', host: 'x' }, {}).offerManual, 'warn:false');
eq('left with no host still reads', /went to another page instead/.test(bsLaunchLine({ state: 'left' }, {}).text), true);
eq('bsLaunchLeft keeps only the host', JSON.stringify(bsLaunchLeft('https://www.browserstack.com:8443/users/sign_in?token=x#y')), '{"state":"left","host":"www.browserstack.com:8443"}');
eq('and copes with nothing', JSON.stringify(bsLaunchLeft('')), '{"state":"left","host":""}');
eq('credentials in front of the host are dropped', JSON.stringify(bsLaunchLeft('https://user:hunter2@www.browserstack.com/x')), '{"state":"left","host":"www.browserstack.com"}');
eq('an @ in the path or query is not a credential separator', bsLaunchLeft('https://a.example/p?x=b@c').host + ':' + bsLaunchLeft('https://a.example/p@q').host, 'a.example:a.example');
eq("Chrome's error page is named as that", JSON.stringify(bsLaunchLeft('chrome-error://chromewebdata/')), '{"state":"left","host":"chrome-error"}');
eq('a very long host is cut at 80', bsLaunchLeft('https://' + new Array(200).join('h') + '.example/').host.length, 80);
eq('a non-URL gives an empty host, not a throw', bsLaunchLeft('not a url').host, '');
eq('timeout', line(PG_PICKER, { what: WHAT }, { elapsedMs: 80000 }).text, 'Control on Galaxy S26 hasn\'t started after 75 s. Look at the Live tab.');
eq('ended', line(PG_PICKER, { what: WHAT }, { wasStarted: true }).text, 'Live ended the session on Control on Galaxy S26.');
eq('desktop, Local not wanted: running', line(PG_DESKTOP, { what: 'Control on Mac Safari', wantLocal: false }).text, 'Control on Mac Safari is running in BrowserStack Live.');
eq('desktop with Local missed: says so', line(PG_DESKTOP, { what: 'Control on Mac Safari', wantLocal: true }).offerManual, true);
eq('started, Local not wanted: just running', line(PG_ANDROID_NO_LOCAL, { what: WHAT, wantLocal: false }).text, 'Control on Galaxy S26 is running in BrowserStack Live.');
eq('started, Local not wanted, is ok', line(PG_ANDROID_NO_LOCAL, { what: WHAT }).tone, 'ok');
eq('started with Local on: says so', line(PG_ANDROID_LOCAL, { what: WHAT, wantLocal: true }).text, 'Control on Galaxy S26 is running in BrowserStack Live. Local was on when it started.');
var UNCONF = line(PG_ANDROID_NO_LOCAL, { what: WHAT, wantLocal: true, unconfirmed: true });
eq('"Open anyway" and Local missing: says Local was not connected, and does not offer the manual route', UNCONF.text + '|' + UNCONF.tone + '|' + UNCONF.offerManual,
  "Control on Galaxy S26 is running in BrowserStack Live. BrowserStack Local wasn't connected when you opened it, so pages on localhost, staging or a VPN won't load.|warn|false");
eq('"Open anyway" and Local present anyway: just says so', line(PG_ANDROID_LOCAL, { what: WHAT, wantLocal: true, unconfirmed: true }).text, 'Control on Galaxy S26 is running in BrowserStack Live. Local was on when it started.');
var MISSED = line(PG_ANDROID_NO_LOCAL, { what: WHAT, wantLocal: true, wantForceLocal: true });
eq("started WITHOUT Local: says Live started it first, and what that breaks", MISSED.text,
  "Control on Galaxy S26 is running in BrowserStack Live. Live started it before it found your BrowserStack Local app, so pages on localhost, staging or a VPN won't load.");
eq('and warns and offers the manual route', MISSED.tone + ':' + MISSED.offerManual, 'warn:true');
ok('it does not also claim anything about force-local', MISSED.text.indexOf('all traffic') === -1);
eq('Local on at start but force-local ignored: says so', line(PG_ANDROID_LOCAL, { what: WHAT, wantLocal: true, wantForceLocal: true }).text,
  'Control on Galaxy S26 is running in BrowserStack Live. Local was on when it started. Live ignored "all traffic through this Mac"; switch it on in the session\'s Local panel (that reconnects the session).');
eq('that is a warning without the manual button', line(PG_ANDROID_LOCAL, { wantLocal: true, wantForceLocal: true }).tone + ':' + line(PG_ANDROID_LOCAL, { wantLocal: true, wantForceLocal: true }).offerManual, 'warn:false');
eq('force-local not wanted: not mentioned', line(PG_ANDROID_LOCAL, { what: WHAT, wantLocal: true, wantForceLocal: false }).text.indexOf('all traffic'), -1);
eq('Local unknown (could not read): no claim either way', line({ title: 'x v1.0' }, { what: WHAT, wantLocal: true }).text, 'Control on Galaxy S26 is running in BrowserStack Live.');
var IOSL = line(PG_IOS27, { what: 'Control on iPhone 18 Pro', wantLocal: false });
eq('iOS 27: running, and the console mirror is explained in Live\'s words', IOSL.text, "Control on iPhone 18 Pro is running in BrowserStack Live. The console mirror can't run on it: " + IOS27_MSG);
eq('no what: a default', bsLaunchLine({ state: 'refused', error: 'x' }, {}).text, "The device didn't start. Live says: x");
eq('no verdict at all reads as starting', bsLaunchLine(null, { what: WHAT }).text, 'Opened Control on Galaxy S26 in BrowserStack Live. Waiting for Live to start the session…');


// ── the worker watches the launch (background.js bsWatchLaunch) ────────────
// The real function, sliced out of background.js, against a fake chrome and a
// virtual clock. A scripted list of page readings stands in for the Live tab.
section('worker: bsWatchLaunch');
var WATCH_SRC = sliceBetween(WORKER, 'const bsLaunchWatchers = new Map();', 'chrome.debugger.onEvent.addListener((source, method, params) => {', 'worker bsWatchLaunch');
var LIVE = 'https://live.browserstack.com/dashboard#os=android&os_version=16.0';
function makeWorld(script) {
  // script: { tab: {url,title,status}|null, reads: [page|null|'throw', ...] (the last one repeats) }
  var w = { clock: 1700000000000, timers: [], writes: [], nsCalls: [], execCalls: 0, store: {}, tab: script.tab === undefined ? { url: LIVE, title: 'Dashboard', status: 'complete' } : script.tab, reads: script.reads.slice() };
  w.chrome = {
    tabs: { get: function (id) { return w.tab ? Promise.resolve(w.tab) : Promise.reject(new Error('No tab with id: ' + id)); } },
    scripting: { executeScript: function (o) {
      w.execCalls++;
      if (o.func !== bsLiveReadOutcome || o.world !== 'MAIN' || !o.target || o.target.tabId == null) return Promise.reject(new Error('wrong executeScript call'));
      var r = w.reads.length > 1 ? w.reads.shift() : w.reads[0];
      if (r === 'throw') return Promise.reject(new Error('Cannot access contents of the page'));
      return Promise.resolve([{ result: r == null ? null : readPage(r) }]);
    } },
  };
  w.ns = function (winId) {
    w.nsCalls.push(winId);
    return {
      get: function (k) { var o = {}; o[k] = w.store[k]; return Promise.resolve(o); },
      set: function (o) { for (var k in o) { w.store[k] = o[k]; w.writes.push(o[k]); } return Promise.resolve(); },
    };
  };
  w.Date = { now: function () { return w.clock; } };
  w.setTimeout = function (fn, ms) { w.timers.push({ fn: fn, at: w.clock + ms }); return w.timers.length; };
  var api = new Function('chrome', 'ns', 'bsIsLiveDashboardUrl', 'bsLiveReadOutcome', 'bsLaunchVerdict', 'bsLaunchLeft', 'Date', 'setTimeout',
    WATCH_SRC + '\nreturn { bsWatchLaunch: bsWatchLaunch, watchers: bsLaunchWatchers, POLL: BS_LAUNCH_POLL_MS, SETTLE: BS_LAUNCH_SETTLE_MS, storeKey: bsLaunchStoreKey };')(
    w.chrome, w.ns, bsIsLiveDashboardUrl, bsLiveReadOutcome, bsLaunchVerdict, bsLaunchLeft, w.Date, w.setTimeout);
  w.api = api;
  // Runs every timer that is due, draining promises between them, until none are.
  w.advance = function (ms) {
    var until = w.clock + ms;
    drainMicrotasks();
    for (;;) {
      var due = w.timers.filter(function (t) { return t.at <= until; }).sort(function (a, b) { return a.at - b.at; })[0];
      if (!due) break;
      w.timers.splice(w.timers.indexOf(due), 1);
      w.clock = Math.max(w.clock, due.at);
      due.fn();
      drainMicrotasks();
    }
    w.clock = until;
    drainMicrotasks();
  };
  w.watch = function (winId, tabId, ctx) {
    w.done = false;
    w.api.bsWatchLaunch(winId, tabId, ctx || {}).then(function () { w.done = true; });
    drainMicrotasks();
  };
  w.states = function () { return w.writes.map(function (r) { return r.verdict.state; }).join(','); };
  return w;
}
var CTX = { key: 'ab', what: 'Control on Galaxy S26', presetId: 'galaxy-s26', pageUrl: 'https://x.com/?a=1', wantLocal: true, wantForceLocal: true };
var TOAST_WHILE_RUNNING = { title: 'Samsung Galaxy S26 v16.0', session: true, li: false, banners: ['Unable to start the recording. Please try again.'], reactor: { local: false, force: false } };

// Started without Local: the run the real account gave, 6 of 6 times.
var W1 = makeWorld({ reads: [PG_PICKER, PG_BOOT, PG_ANDROID_NO_LOCAL] });
W1.watch(5, 42, CTX);
W1.advance(50000);
eq('picker, boot screen, then started without Local, one write per change', W1.states(), 'starting,started');
eq('the started write says Local was missing', W1.writes[1].verdict.local, false);
ok('the context rides along on every write', W1.writes.every(function (r) {
  return r.tabId === 42 && r.key === 'ab' && r.what === 'Control on Galaxy S26' && r.presetId === 'galaxy-s26' && r.pageUrl === 'https://x.com/?a=1' && r.wantLocal === true && r.wantForceLocal === true && typeof r.at === 'number';
}));
eq("it writes under the window's own namespace", W1.nsCalls.filter(function (x, i, a) { return a.indexOf(x) === i; }).join(','), '5');
eq("and in this place's own record, bsLaunch_ab", Object.keys(W1.store).join(','), 'bsLaunch_ab');
eq('once settled it keeps watching the running session, and keeps the tab', W1.done + ':' + W1.api.watchers.size, 'false:1');
eq('one reading a second until 40 s after it started (the third reading, at 2 s), then one every 5 s', W1.execCalls, 44);
eq('and nothing changes while it runs', W1.states(), 'starting,started');
// The tester stops the session in Live long after it settled: the line must not go on saying "running".
W1.reads = [PG_PICKER];
W1.advance(3500);   // the next slow reading is at 52 s; the picker there is checked again at 53 s
eq('the first reading of the picker after the 40 s is checked again a second later, not five', W1.execCalls + ':' + W1.states(), '46:starting,started,ended');
eq('ended is reported, and the watch lets go of the tab', W1.done + ':' + W1.api.watchers.size, 'true:0');
// A drop long after it started.
var WL = makeWorld({ reads: [PG_ANDROID_LOCAL] });
WL.watch(5, 7, CTX);
WL.advance(120000);
WL.reads = [PG_DROPPED];
WL.advance(7000);
eq('a session that drops two minutes in is reported dropped, with the banner', WL.states() + ':' + WL.writes[WL.writes.length - 1].verdict.afterStart + ':' + WL.done, 'started,refused:true:true');
var WC = makeWorld({ reads: [PG_ANDROID_LOCAL] });
WC.watch(5, 7, CTX);
WC.advance(120000);
WC.tab = null;
WC.advance(6000);
eq('a tab closed two minutes in is reported closed', WC.states() + ':' + WC.writes[WC.writes.length - 1].verdict.wasStarted + ':' + WC.done, 'started,closed:true:true');
var WB = makeWorld({ reads: [PG_ANDROID_LOCAL] });
WB.watch(5, 7, CTX);
WB.advance(120000);
WB.reads = [PG_TOOLBAR_AWAY, PG_ANDROID_LOCAL];
WB.advance(20000);
eq('one odd reading after the 40 s (the toolbar away) changes nothing', WB.states() + ':' + WB.done, 'started:false');
// A session left running for hours: the watch stops at its cap, leaving the line as it was.
var WM = makeWorld({ reads: [PG_ANDROID_LOCAL] });
WM.watch(5, 7, CTX);
WM.advance(4 * 3600 * 1000 - 10000);
eq('still watching just under four hours in', WM.done, false);
WM.advance(20000);
eq('and stopped at four hours, with the line still saying started', WM.done + ':' + WM.api.watchers.size + ':' + WM.states(), 'true:0:started');

// One record per place: a launch from Functional Testing never overwrites the A/B one.
var W1b = makeWorld({ reads: [PG_ANDROID_LOCAL] });
W1b.watch(5, 43, { key: 'ft', what: 'x' });
W1b.advance(30000);
eq("a launch from Functional Testing writes bsLaunch_ft", Object.keys(W1b.store).join(','), 'bsLaunch_ft');
eq('the record key is made of letters only, and never empty', W1b.api.storeKey({ key: '../x' }) + '|' + W1b.api.storeKey({ key: '' }) + '|' + W1b.api.storeKey({}) + '|' + W1b.api.storeKey({ key: 'a b/cdefghijklmnop' }), 'bsLaunch_x|bsLaunch_ab|bsLaunch_ab|bsLaunch_abcdefghij');

// A refused device: believed on the second reading in a row, not the first.
var W2 = makeWorld({ reads: [PG_REFUSED] });
W2.watch(5, 7, CTX);
eq('one reading of a banner is not believed: the record says "starting", and the watch goes on', W2.states() + ':' + W2.done + ':' + W2.execCalls, 'starting:false:1');
W2.advance(1000);
eq('the second in a row makes it refused, written once, and the watch ends', W2.states() + ':' + W2.done + ':' + W2.execCalls, 'starting,refused:true:2');
eq("with Live's words, and not as a drop after starting", W2.writes[1].verdict.error + '|' + W2.writes[1].verdict.afterStart, BANNER_DISABLED + '|false');
var W2b = makeWorld({ reads: [PG_BOOT, PG_REFUSED, PG_ANDROID_NO_LOCAL] });
W2b.watch(5, 7, CTX);
W2b.advance(40000);
eq('a banner seen once and then gone (a toast that cleared) never becomes "refused"', W2b.states(), 'starting,started');
var W2c = makeWorld({ reads: [PG_BOOT, TOAST_WHILE_RUNNING] });
W2c.watch(5, 7, CTX);
W2c.advance(40000);
eq('an error toast while a session is running is some other business: it stays started', W2c.states(), 'starting,started');
ok('and the launch is not reported refused at any point', W2c.writes.every(function (r) { return r.verdict.state !== 'refused'; }));

// The iPhone 17 case: it starts, then the dashboard drops it ten seconds in.
var W3 = makeWorld({ reads: [PG_BOOT, PG_ANDROID_LOCAL, PG_ANDROID_LOCAL, PG_ANDROID_LOCAL, PG_DROPPED] });
W3.watch(5, 7, CTX);
W3.advance(30000);
eq('a session that starts and then drops ends as refused, with the banner', W3.states(), 'starting,started,refused');
eq('and says it had started (so it can say "dropped", not "didn\'t start")', W3.writes[2].verdict.afterStart, true);
eq('and the watch is over', W3.done, true);

// "Ended" is believed on the second reading too.
var W3b = makeWorld({ reads: [PG_BOOT, PG_ANDROID_LOCAL, PG_PICKER, PG_ANDROID_LOCAL] });
W3b.watch(5, 7, CTX);
W3b.advance(40000);
eq('one reading of the picker after it started (a re-render) is not the session ending', W3b.states(), 'starting,started');
var W3d = makeWorld({ reads: [PG_ANDROID_LOCAL, PG_PICKER, PG_ANDROID_LOCAL, PG_PICKER, PG_ANDROID_LOCAL] });
W3d.watch(5, 7, CTX);
W3d.advance(40000);
eq('a re-render that comes and goes (picker, session, picker, session) is never the session ending: the count starts again each time', W3d.states(), 'started');
var W3e = makeWorld({ reads: [PG_ANDROID_LOCAL, PG_DROPPED, PG_PICKER, PG_ANDROID_LOCAL] });
W3e.watch(5, 7, CTX);
W3e.advance(40000);
eq('two different findings in a row (a banner, then the picker) do not add up to either', W3e.states(), 'started');
// The real timelines, one reading a second (measured 2026-10-08, sampled every 100 ms in Live).
// Windows Chrome: picker, boot screen, the toolbar for 1 s, gone for 4 s, back. Judged only by its
// Stop Session control, this was reported as "Live ended the session" two seconds into a healthy session.
function rep_(page, n) { var a = []; for (var i = 0; i < n; i++) a.push(page); return a; }
var WD = makeWorld({ reads: [PG_PICKER].concat(rep_(PG_TOOLBAR_AWAY, 6), [PG_DESKTOP_UP], rep_(PG_TOOLBAR_AWAY, 4), [PG_DESKTOP_UP]) });
WD.watch(5, 7, CTX);
WD.advance(60000);
eq('a desktop session whose toolbar goes away for 4 s is never reported ended; it starts once, with the Local the toolbar said', WD.states() + ':' + WD.writes[1].verdict.local, 'starting,started:true');
eq('and it is still watching the session, slowly', WD.done + ':' + WD.api.watchers.size, 'false:1');
var WD2 = makeWorld({ reads: [PG_PICKER].concat(rep_(PG_TOOLBAR_AWAY, 6), [PG_DESKTOP_UP], rep_(PG_TOOLBAR_AWAY, 12), [PG_DESKTOP_UP]) });
WD2.watch(5, 7, CTX);
WD2.advance(60000);
eq('nor when it stays away for 12 s: with no picker on the page the session is not over', WD2.states(), 'starting,started');
var WD3 = makeWorld({ reads: [PG_PICKER].concat(rep_(PG_TOOLBAR_AWAY, 6), [PG_DESKTOP_UP], rep_(PG_TOOLBAR_AWAY, 3), rep_(PG_PICKER, 2)) });
WD3.watch(5, 7, CTX);
WD3.advance(30000);
eq('but the picker coming back is: two readings of it, and the watch ends', WD3.states() + ':' + WD3.done, 'starting,started,ended:true');
// iPhone 18 Pro on iOS 27: the title says running 10 s before the toolbar; Local reads false until the toolbar is up.
var PG_IOS27_UP = { title: 'iPhone 18 Pro v27.0', session: true, li: true, msg: IOS27_RAW, tip: IOS27_TIP, reactor: { local: true, force: false } };
var PG_PHONE_TITLE = { title: 'iPhone 18 Pro v27.0' };
var WP = makeWorld({ reads: [PG_PICKER, PG_BOOT, PG_BOOT].concat(rep_(PG_PHONE_EARLY, 10), [PG_IOS27_UP], rep_(PG_PHONE_TITLE, 4), [PG_IOS27_UP]) });
WP.watch(5, 7, CTX);
WP.advance(60000);
eq('a phone: starting, running with nothing claimed about Local, then running with what the toolbar said', WP.states(), 'starting,started,started');
eq('Local is never reported missing on the way (it read false at the title, true at the toolbar)', JSON.stringify(WP.writes.map(function (r) { return r.verdict.local; })), '[null,null,true]');
eq('the early record has no toolbar, the later one has it and the iOS 27 reason', WP.writes[1].verdict.toolbar + ':' + WP.writes[2].verdict.toolbar + ':' + (WP.writes[2].verdict.devtoolsOff.indexOf('iOS 27.0') > -1), 'false:true:true');
eq('the toolbar going away for 4 s changes nothing (no further write)', WP.writes.length, 3);
eq('the early line says nothing about Local and offers no manual route; the later one is clean too', bsLaunchLine(WP.writes[1].verdict, CTX).offerManual + ':' + bsLaunchLine(WP.writes[2].verdict, CTX).offerManual + ':' + /Local was on when it started/.test(bsLaunchLine(WP.writes[2].verdict, CTX).text), 'false:false:true');
// A drop after it started is a drop only once the picker is back, with Live's banner.
var PG_BANNER_ONLY = { title: 'Dashboard', banners: [BANNER_DROPPED] };
var WDR = makeWorld({ reads: [PG_ANDROID_LOCAL].concat(rep_(PG_BANNER_ONLY, 3), [PG_DROPPED]) });
WDR.watch(5, 7, CTX);
WDR.advance(30000);
eq('a banner with no picker on the page after it started is not yet a drop; with the picker back it is, in two readings', WDR.states() + ':' + WDR.done + ':' + WDR.execCalls, 'started,refused:true:6');
var W3c = makeWorld({ reads: [PG_BOOT, PG_ANDROID_LOCAL, PG_PICKER] });
W3c.watch(5, 7, CTX);
W3c.advance(3000);
eq('two in a row are, and the watch ends there and then (it does not poll on for the settle time)', W3c.states() + ':' + W3c.done + ':' + W3c.execCalls, 'starting,started,ended:true:4');

// Closing the tab says so; a line must not go on saying "waiting" for a tab that is gone.
var W4 = makeWorld({ reads: [PG_PICKER] });
W4.watch(5, 7, CTX);
W4.advance(3000);
W4.tab = null;
W4.advance(5000);
eq('the tab is closed before it started: closed, and the watch ends', W4.states() + ':' + W4.done + ':' + W4.api.watchers.size, 'starting,closed:true:0');
eq('and says it had not started', W4.writes[W4.writes.length - 1].verdict.wasStarted, false);
var W4b = makeWorld({ reads: [PG_BOOT, PG_ANDROID_LOCAL] });
W4b.watch(5, 7, CTX);
W4b.advance(4000);
W4b.tab = null;
W4b.advance(3000);
eq('closed after it started says it had started', W4b.states() + ':' + W4b.writes[W4b.writes.length - 1].verdict.wasStarted, 'starting,started,closed:true');

// A newer launch from the same place has taken the record: this watch is history.
var W4c = makeWorld({ reads: [PG_PICKER, PG_PICKER, PG_ANDROID_LOCAL] });
W4c.watch(5, 7, CTX);
W4c.advance(1500);
W4c.store.bsLaunch_ab = { tabId: 8, key: 'ab', at: W4c.clock + 10, verdict: { state: 'starting' } };
W4c.advance(1000);
eq("the older watch does not write over the newer launch's record, and ends when it next has something to write", W4c.done + ':' + W4c.store.bsLaunch_ab.tabId + ':' + W4c.store.bsLaunch_ab.verdict.state, 'true:8:starting');
var W4d = makeWorld({ reads: [PG_PICKER] });
W4d.store.bsLaunch_ab = { tabId: 3, key: 'ab', at: W4d.clock - 5000, verdict: { state: 'started' } };
W4d.watch(5, 7, CTX);
W4d.advance(1500);
eq('a record from an EARLIER launch is replaced, not mistaken for a newer one', W4d.store.bsLaunch_ab.tabId, 7);
var W4e = makeWorld({ reads: [PG_PICKER, PG_PICKER, PG_ANDROID_LOCAL] });
W4e.watch(5, 7, CTX);
W4e.advance(1500);
W4e.store.bsLaunch_ft = { tabId: 99, key: 'ft', at: W4e.clock + 10, verdict: { state: 'started' } };
W4e.advance(1000);
eq("a newer record from the OTHER place is none of this watch's business: it still writes its own", W4e.store.bsLaunch_ab.verdict.state + ':' + W4e.store.bsLaunch_ab.tabId + ':' + W4e.store.bsLaunch_ft.tabId, 'started:7:99');

var W4f = makeWorld({ reads: [PG_PICKER] });
W4f.watch(5, 7, CTX);
W4f.advance(1500);
W4f.store.bsLaunch_ab = { tabId: 8, key: 'ab', at: W4f.clock + 10, verdict: { state: 'starting' } };
W4f.tab = { url: 'https://www.browserstack.com/users/sign_in', title: 'Sign in', status: 'complete' };
W4f.advance(2000);
eq('a superseded watch that finds its tab elsewhere does not write "left" over the newer launch either, and ends', W4f.done + ':' + W4f.store.bsLaunch_ab.tabId + ':' + W4f.store.bsLaunch_ab.verdict.state, 'true:8:starting');

// The tab goes somewhere else. Before it started, Live may have sent a signed-out
// tester to sign in; they may come back and the session start.
var W5 = makeWorld({ reads: [PG_PICKER, PG_PICKER, PG_ANDROID_LOCAL] });
W5.watch(5, 7, CTX);
W5.advance(1500);
W5.tab = { url: 'https://example.com/', title: 'Example', status: 'complete' };
W5.advance(3000);
eq('before it started, the tab left the dashboard: say where, and keep watching', W5.states() + ':' + W5.done, 'starting,left:false');
eq('where it went, not what it was told', JSON.stringify(W5.writes[W5.writes.length - 1].verdict), '{"state":"left","host":"example.com"}');
W5.tab = { url: LIVE, title: 'Samsung Galaxy S26 v16.0', status: 'complete' };
W5.advance(5000);
eq('and when it comes back and the session starts, that is reported', W5.writes[W5.writes.length - 1].verdict.state, 'started');
var W5a = makeWorld({ reads: [PG_PICKER] });
W5a.watch(5, 7, CTX);
W5a.advance(1500);
W5a.tab = { url: 'https://www.browserstack.com/users/sign_in', title: 'Sign in', status: 'complete' };
W5a.advance(80000);
eq('left for good: the watch ends at its own deadline, with "left" as the last word', W5a.done + ':' + W5a.writes[W5a.writes.length - 1].verdict.state, 'true:left');
var W5b = makeWorld({ reads: [PG_BOOT, PG_ANDROID_NO_LOCAL] });
W5b.watch(5, 7, CTX);
W5b.advance(4000);
W5b.tab = { url: 'https://example.com/', title: 'Example', status: 'complete' };
W5b.advance(3000);
eq('a session that had started, then the tab went elsewhere: that session is over, and it says so', W5b.states() + ':' + W5b.done, 'starting,started,ended:true');
var W5c = makeWorld({ reads: [PG_PICKER], tab: { url: 'chrome-error://chromewebdata/', title: 'x', status: 'complete' } });
W5c.watch(5, 7, CTX);
W5c.advance(2000);
eq("Chrome's own error page is reported as that, not as a site", JSON.stringify(W5c.writes[0].verdict), '{"state":"left","host":"chrome-error"}');

// A tab that has only just been created: no url yet, only the one it is loading.
// Judging it by url alone ended the watch before it began (found by the real-Chrome gate).
var W9 = makeWorld({ reads: [PG_PICKER, PG_BOOT, PG_ANDROID_LOCAL], tab: { url: '', pendingUrl: LIVE, title: '', status: 'loading' } });
W9.watch(5, 7, CTX);
W9.advance(2000);
eq('a tab still loading its Live url is watched, not abandoned', W9.done + ':' + W9.execCalls, 'false:3');
W9.tab = { url: LIVE, pendingUrl: '', title: 'Samsung Galaxy S26 v16.0', status: 'complete' };
W9.advance(40000);
eq('and goes on to see the session start', W9.states(), 'starting,started');
var W9b = makeWorld({ reads: [PG_PICKER], tab: { url: '', pendingUrl: '', title: '', status: 'loading' } });
W9b.watch(5, 7, CTX);
W9b.advance(3000);
eq('a tab that has not even a pending url yet is waited for', W9b.done + ':' + W9b.writes.length, 'false:1');
var W9c = makeWorld({ reads: [PG_PICKER], tab: { url: 'about:blank', pendingUrl: LIVE, title: '', status: 'loading' } });
W9c.watch(5, 7, CTX);
W9c.advance(3000);
eq('about:blank on the way to Live is not "somewhere else"', W9c.done, false);
var W9d = makeWorld({ reads: [PG_PICKER], tab: { url: 'about:blank', pendingUrl: '', title: '', status: 'complete' } });
W9d.watch(5, 7, CTX);
W9d.advance(3000);
eq('a finished about:blank is not taken for a page the tester chose: no "left", and the page is still read', W9d.done + ':' + W9d.states() + ':' + (W9d.execCalls > 0), 'false:starting:true');
var W9e = makeWorld({ reads: [PG_PICKER], tab: { url: LIVE, pendingUrl: 'https://www.browserstack.com/users/sign_in', title: '', status: 'loading' } });
W9e.watch(5, 7, CTX);
W9e.advance(3000);
eq('a tab still LOADING somewhere else (a redirect on its way) is given until it finishes', W9e.done + ':' + W9e.states(), 'false:starting');
W9e.tab = { url: 'https://www.browserstack.com/users/sign_in', pendingUrl: '', title: 'Sign in', status: 'complete' };
W9e.advance(3000);
eq('and once it has, it is reported, and still watched', W9e.done + ':' + W9e.states(), 'false:starting,left');

// Signed out: the sign-in page's host is kept, and nothing else of its URL.
var W10 = makeWorld({ reads: [PG_PICKER], tab: { url: 'https://user:hunter2@www.browserstack.com/users/sign_in?token=SECRET#frag', title: 'Sign in', status: 'complete' } });
W10.watch(5, 7, CTX);
W10.advance(3000);
eq('a sign-in page: "left", with the host only, and the watch goes on', W10.states() + ':' + W10.done, 'left:false');
eq('the host, without the credentials in front of it', JSON.stringify(W10.writes[0].verdict), '{"state":"left","host":"www.browserstack.com"}');
ok('the rest of that URL (credentials, a token, the path) is never stored', ['hunter2', 'SECRET', 'sign_in', 'user:'].every(function (x) { return JSON.stringify(W10.writes).indexOf(x) === -1; }));
eq('and the page was never read while it was elsewhere', W10.execCalls, 0);

// A reading that fails says nothing.
var W7 = makeWorld({ reads: [PG_BOOT, PG_ANDROID_NO_LOCAL, 'throw', 'throw', null, PG_ANDROID_NO_LOCAL] });
W7.watch(5, 7, CTX);
W7.advance(40000);
eq('failed and empty readings after it started do not read as the session ending', W7.states(), 'starting,started');
var W7b = makeWorld({ reads: ['throw', 'throw', PG_ANDROID_LOCAL] });
W7b.watch(5, 7, CTX);
W7b.advance(40000);
eq('failed readings before it started are just starting', W7b.states(), 'starting,started');

// Nothing ever happens.
var W6 = makeWorld({ reads: [PG_PICKER] });
W6.watch(5, 7, CTX);
W6.advance(74000);
eq('still starting at 74 s', W6.states() + ':' + W6.done, 'starting:false');
W6.advance(3000);
eq('timeout at 75 s, and the watch ends', W6.states() + ':' + W6.done, 'starting,timeout:true');

// A page that can never be read must not keep the watch "starting" for ever.
var W7c = makeWorld({ reads: ['throw'] });
W7c.watch(5, 7, CTX);
W7c.advance(74000);
eq('unreadable for 74 s: still starting', W7c.states() + ':' + W7c.done, 'starting:false');
W7c.advance(3000);
eq('unreadable for 75 s: it times out and the watch ends, instead of polling until the tab closes', W7c.states() + ':' + W7c.done + ':' + W7c.api.watchers.size, 'starting,timeout:true:0');

// A new launch on the same tab id replaces the old watch.
var W8 = makeWorld({ reads: [PG_PICKER] });
var firstEnded = false;
W8.api.bsWatchLaunch(5, 7, CTX).then(function () { firstEnded = true; });
drainMicrotasks();
W8.advance(2000);
W8.api.bsWatchLaunch(5, 7, { key: 'ft' });
drainMicrotasks();
var execBefore = W8.execCalls;
W8.advance(5000);
eq('the older watch ends at its next turn', firstEnded, true);
eq('the newer one carries on, alone: one reading a second, not two', W8.execCalls - execBefore <= 6, true);
eq('and it still holds the tab (the old one did not let go of it)', W8.api.watchers.size + ':' + W8.store.bsLaunch_ft.key, '1:ft');

// What the panel asks for is cleaned before it is used.
section('worker: the bsWatchLaunch message');
var HANDLER_SRC = sliceBetween(WORKER, "  } else if (msg.action === 'bsWatchLaunch') {", "\n\n  } else if (msg.action === 'bcEval') {", 'worker bsWatchLaunch message').split('\n').slice(1).join('\n');
function ask(msg) {
  var got = { calls: [], resp: undefined };
  new Function('msg', 'sendResponse', 'bsWatchLaunch', HANDLER_SRC)(msg, function (r) { got.resp = r; }, function (winId, tabId, ctx) { got.calls.push({ winId: winId, tabId: tabId, ctx: ctx }); return Promise.resolve(); });
  return got;
}
var A1 = ask({ action: 'bsWatchLaunch', winId: 9, tabId: 42, key: 'ft', what: 'x', presetId: 'iphone-17', pageUrl: 'https://p/', wantLocal: 1, wantForceLocal: 0, unconfirmed: 1 });
eq('a good request starts a watch for that window and tab', A1.calls.length + ':' + A1.calls[0].winId + ':' + A1.calls[0].tabId + ':' + A1.resp.ok, '1:9:42:true');
eq('flags become booleans', A1.calls[0].ctx.wantLocal + ':' + A1.calls[0].ctx.wantForceLocal + ':' + A1.calls[0].ctx.unconfirmed, 'true:false:true');
eq('a tab id that is not an integer starts nothing and says so', (function () { var a = ask({ action: 'bsWatchLaunch', tabId: 'abc' }); return a.calls.length + ':' + a.resp.ok; })(), '0:false');
eq('a missing tab id likewise', (function () { var a = ask({ action: 'bsWatchLaunch' }); return a.calls.length + ':' + a.resp.ok; })(), '0:false');
eq('no window id is null, not undefined', ask({ action: 'bsWatchLaunch', tabId: 1 }).calls[0].winId, null);
var A2 = ask({ action: 'bsWatchLaunch', tabId: 1, key: new Array(60).join('k'), what: new Array(400).join('w'), pageUrl: new Array(4000).join('u'), presetId: new Array(90).join('p') });
eq('the labels are capped', [A2.calls[0].ctx.key.length, A2.calls[0].ctx.what.length, A2.calls[0].ctx.presetId.length].join(','), '20,160,40');
eq('a page URL that fits is kept whole', ask({ action: 'bsWatchLaunch', tabId: 1, pageUrl: new Array(8001).join('u') }).calls[0].ctx.pageUrl.length, 8000);
eq('one that does not is dropped, not cut short (a cut-off URL would reopen a different page)', ask({ action: 'bsWatchLaunch', tabId: 1, pageUrl: new Array(8002).join('u') }).calls[0].ctx.pageUrl, '');

// ── the panel: the Local check ─────────────────────────────────────────────
// popup.js bsLocalStatus asks two things on this Mac, at once: the binary port
// Live itself checks, and the app's console. Only the binary decides.
section('panel: the Local check (bsLocalStatus)');
var LOCAL_SRC = sliceBetween(POPUP, 'async function bsLocalStatus() {', '\nasync function checkBsLocal', 'popup Local check');
function settle(p) {
  var out = { done: false };
  p.then(function (v) { out.done = true; out.value = v; }, function (e) { out.done = true; out.error = e; });
  drainMicrotasks();
  return out;
}
function makeLocalCheck(handler) {
  var h = { calls: [], statuses: [] };
  var fakeFetch = function (url, opts) { h.calls.push({ url: url, opts: opts }); return handler(url); };
  function res(ok, body) { return Promise.resolve({ ok: ok, text: function () { return Promise.resolve(body); }, json: function () { try { return Promise.resolve(JSON.parse(body)); } catch (e) { return Promise.reject(e); } } }); }
  h.res = res;
  var api = new Function('fetch', 'AbortController', 'setTimeout', 'clearTimeout', 'BS_LOCAL_BINARY', 'BS_LOCAL_CONSOLE', 'BS_LOCAL_DOWNLOAD',
    'bsLocalBinaryAnswer', 'bsLocalStatusFrom', 'bsLocalReadiness', 'setBsLiveStatus',
    LOCAL_SRC + '\nreturn { bsLocalStatus: bsLocalStatus, showBsLocalStatus: showBsLocalStatus };')(
    fakeFetch, function () { this.signal = {}; this.abort = function () {}; }, function () { return 1; }, function () {},
    BS_LOCAL_BINARY, BS_LOCAL_CONSOLE, BS_LOCAL_DOWNLOAD, bsLocalBinaryAnswer, bsLocalStatusFrom, bsLocalReadiness,
    function (key, html, color) { h.statuses.push({ key: key, html: html, color: color }); });
  h.api = api;
  return h;
}
function localWorld(binary, consoleRes) {
  // binary / consoleRes: 'up' | 'reject' | 'html' | '500' | 'signedout'
  var h = makeLocalCheck(function (url) {
    if (url.indexOf(BS_LOCAL_BINARY) === 0) {
      if (binary === 'reject') return Promise.reject(new Error('Failed to fetch'));
      if (binary === '500') return h.res(false, '');
      if (binary === 'html') return h.res(true, '<!DOCTYPE html><html>Cannot GET /</html>');
      return h.res(true, JSONP);
    }
    if (consoleRes === 'reject') return Promise.reject(new Error('Failed to fetch'));
    if (consoleRes === 'signedout') return h.res(true, JSON.stringify({ status: false, token: TOKEN, userId: USER }));
    return h.res(true, JSON.stringify({ status: true, token: TOKEN, userId: USER }));
  });
  return h;
}
var LW = localWorld('up', 'up');
var LP = LW.api.bsLocalStatus();
eq('both questions are asked before either is answered', LW.calls.length, 2);
var LR = settle(LP);
eq('the binary answers: ready', JSON.stringify(LR.value), '{"ready":true,"state":"ready"}');
ok('it asked the port Live checks, with a cache-buster', LW.calls[0].url.indexOf(BS_LOCAL_BINARY + '/?_=') === 0, LW.calls[0].url);
eq('and the console on 45454', LW.calls[1].url, BS_LOCAL_CONSOLE + '/status');
ok('neither sends cookies, and neither is cached', LW.calls.every(function (c) { return c.opts.credentials === 'omit' && c.opts.cache === 'no-store'; }));
ok('the token, the user id and the tunnel identifier go nowhere', JSON.stringify(LR.value).indexOf(TOKEN) === -1 && JSON.stringify(LR.value).indexOf(USER) === -1 && JSON.stringify(LR.value).indexOf('nativeapp') === -1);
eq('console signed in but the binary refuses: not connected (what /status alone called running)', settle(localWorld('reject', 'up').api.bsLocalStatus()).value.state, 'not-connected');
eq('the binary answers HTML: not up', settle(localWorld('html', 'up').api.bsLocalStatus()).value.state, 'not-connected');
eq('the binary answers 500: not up', settle(localWorld('500', 'up').api.bsLocalStatus()).value.state, 'not-connected');
eq('the console says signed out and the binary is silent', settle(localWorld('reject', 'signedout').api.bsLocalStatus()).value.state, 'not-signed-in');
eq('neither answers: not running', settle(localWorld('reject', 'reject').api.bsLocalStatus()).value.state, 'not-running');
eq('the binary alone is enough', settle(localWorld('up', 'reject').api.bsLocalStatus()).value.ready, true);
var LW2 = localWorld('reject', 'up');
settle(LW2.api.bsLocalStatus());
LW2.api.showBsLocalStatus('ab', { ready: true, state: 'ready' });
LW2.api.showBsLocalStatus('ab', { ready: false, state: 'not-connected' });
LW2.api.showBsLocalStatus('ab', { ready: false, state: 'not-signed-in' });
LW2.api.showBsLocalStatus('ab', { ready: false, state: 'not-running' });
eq('ready is green and names the port', LW2.statuses[0].color + ':' + /127\.0\.0\.1:45691/.test(LW2.statuses[0].html), 'var(--ok):true');
eq('ready promises nothing about the session', /Selenite reports whether Live actually started it with Local/.test(LW2.statuses[0].html), true);
eq('not connected is a warning that names the port and what to do', LW2.statuses[1].color + ':' + /nothing answers on the port Live checks \(127\.0\.0\.1:45691\)/.test(LW2.statuses[1].html) + ':' + /make sure it is connected/.test(LW2.statuses[1].html), 'var(--warn):true:true');
eq('not signed in is a warning', LW2.statuses[2].color + ':' + /not signed in/.test(LW2.statuses[2].html), 'var(--warn):true');
eq('not running is an error with the download link', LW2.statuses[3].color + ':' + (LW2.statuses[3].html.indexOf(BS_LOCAL_DOWNLOAD) > -1), 'var(--err):true');

// ── the panel: launching, and following what Live did ──────────────────────
// The real openBsLive / launchBsLiveTab / renderBsLaunch / bsCheckLaunchLost /
// openBsLiveManual, sliced out of popup.js and run against a fake chrome.
section('panel: openBsLive / launchBsLiveTab / renderBsLaunch / openBsLiveManual');
eval(sliceBetween(POPUP, 'function esc(s) {', '\n}\n', 'popup esc') + '\n}');
var GLUE_SRC = sliceBetween(POPUP, 'async function openBsLive(', '\nlet _abProgressPoller', 'popup launch glue');
var LIVE_TAB = function (id, extra) { var t = { id: id, url: 'https://live.browserstack.com/dashboard#os=android' }; for (var k in (extra || {})) t[k] = extra[k]; return t; };
function makeGlue(o) {
  o = o || {};
  var g = { statuses: [], appended: [], removed: [], created: [], sent: [], timers: [], localAsked: 0, localShown: [], store: {}, order: [] };
  g.store.bsLiveTabId = o.oldTab === undefined ? 3 : o.oldTab;
  for (var sk in (o.store || {})) g.store[sk] = o.store[sk];
  g.tabs = o.tabs || {};
  if (!o.tabs) {
    // The tab a launch will find open: the old one (id 3) unless a test says otherwise.
    var oid = g.store.bsLiveTabId;
    if (oid != null && !o.tabGone) g.tabs[oid] = LIVE_TAB(oid);
  }
  var nextId = 99;
  var chromeStub = {
    tabs: {
      get: function (id) { return g.tabs[id] ? Promise.resolve(g.tabs[id]) : Promise.reject(new Error('No tab')); },
      remove: function (id) { g.removed.push(id); g.order.push('remove:' + id); delete g.tabs[id]; return Promise.resolve(); },
      create: function (opts) {
        g.created.push(opts);
        g.order.push('create');
        if (o.createThrows) return Promise.reject(new Error('Tabs cannot be edited right now'));
        var id = nextId++;
        // A tab opened a moment ago has no url yet, only the one it is loading.
        g.tabs[id] = { id: id, url: '', pendingUrl: opts.url, status: 'loading' };
        return o.slowCreate ? new Promise(function (r) { g.finishCreate = function () { r({ id: id }); }; }) : Promise.resolve({ id: id });
      },
    },
    runtime: { sendMessage: function (m) { g.sent.push(m); return o.noAck ? Promise.resolve(undefined) : Promise.resolve({ ok: true }); } },
  };
  var sessionStub = {
    get: function (k) { var out = {}; (Array.isArray(k) ? k : [k]).forEach(function (n) { out[n] = g.store[n]; }); return Promise.resolve(out); },
    set: function (obj) { for (var n in obj) g.store[n] = obj[n]; return Promise.resolve(); },
  };
  var role = { insertAdjacentHTML: function (where, html) { g.appended.push({ where: where, html: html }); } };
  g.prefs = o.prefs || { devices: [], local: true, forceLocal: true };
  var surfaces = { ab: { targets: function () { return [{ key: 'control', label: 'Control', url: 'https://x.com/', noUrl: 'No URL.' }, { key: 'none', label: 'Nothing', url: '', noUrl: 'Enter a URL first.' }]; } } };
  g.pending = {};
  g.localStatus = o.localStatus || { ready: true, state: 'ready' };
  g.api = new Function('chrome', 'sessionNS', 'WIN_ID', 'bsLive', 'bsIsLiveUrl', 'setBsLiveStatus', 'esc', 'bsLaunchLine', 'bsRole', 'bsPresetById', 'bsLiveUrl',
    'BS_LIVE_SURFACES', 'bsLocalStatus', 'showBsLocalStatus', '_bsLivePending', 'setTimeout', 'BS_LAUNCH_GIVE_UP_MS', 'BS_LAUNCH_REPORT_MAX_AGE_MS',
    GLUE_SRC + '\nreturn { openBsLive: openBsLive, launchBsLiveTab: launchBsLiveTab, renderBsLaunch: renderBsLaunch, openBsLiveManual: openBsLiveManual, bsCheckLaunchLost: bsCheckLaunchLost };')(
    chromeStub, sessionStub, o.winId === undefined ? 5 : o.winId, g.prefs, bsIsLiveUrl,
    function (key, html, color) { if (o.statusThrows > 0) { o.statusThrows--; throw new Error('the status line is gone'); } g.statuses.push({ key: key, html: html, color: color }); }, esc, bsLaunchLine,
    function (key, r) { return r === 'status' ? role : null; }, bsPresetById, bsLiveUrl,
    surfaces,
    function () { g.localAsked++; return o.localCheck ? o.localCheck(g) : Promise.resolve(g.localStatus); },
    function (key, st) { g.localShown.push(st); },
    g.pending,
    function (fn, ms) { g.timers.push({ fn: fn, ms: ms }); return g.timers.length; },
    BS_LAUNCH_GIVE_UP_MS, BS_LAUNCH_REPORT_MAX_AGE_MS);
  return g;
}
var G_URL = 'https://live.browserstack.com/dashboard#os=android&os_version=16.0&device=Samsung+Galaxy+S26&device_browser=chrome&url=https%3A%2F%2Fx.com%2F&start=true&local=true&force-local=true';
var G1 = makeGlue();
settle(G1.api.launchBsLiveTab('ab', G_URL, 'Control on Galaxy S26', { presetId: 'galaxy-s26', pageUrl: 'https://x.com/' }));
eq('the Live tab opened last, still on Live, is closed first', G1.removed.join(','), '3');
eq("and it is closed before the new one opens (Live runs one session at a time)", G1.order.join(','), 'remove:3,create');
eq('the new tab opens active, in this panel\'s window', JSON.stringify(G1.created), JSON.stringify([{ url: G_URL, active: true, windowId: 5 }]));
eq('its id is remembered for the next launch', G1.store.bsLiveTabId, 99);
eq('the status line says it is waiting, not that it worked', G1.statuses[0].html + '|' + G1.statuses[0].color, 'Opened Control on Galaxy S26 in BrowserStack Live. Waiting for Live to start the session…|var(--fg3)');
eq('the worker is asked to watch that tab', JSON.stringify(G1.sent), JSON.stringify([{ action: 'bsWatchLaunch', winId: 5, tabId: 99, key: 'ab', what: 'Control on Galaxy S26', presetId: 'galaxy-s26', pageUrl: 'https://x.com/', wantLocal: false, wantForceLocal: false, unconfirmed: false }]));
eq('and the status stays what the watcher will say next (no premature success)', G1.statuses.length, 1);
eq('one timer is armed to notice a watch that died, past the watch\'s own deadline', G1.timers.length + ':' + G1.timers[0].ms, '1:' + (BS_LAUNCH_GIVE_UP_MS + 20000));
var G2 = makeGlue({ tabs: { 3: { id: 3, url: 'https://example.com/' } } });
settle(G2.api.launchBsLiveTab('ab', G_URL, 'x', {}));
eq("a tab the tester took elsewhere is left alone", G2.removed.length, 0);
var G2b = makeGlue({ oldTab: null });
settle(G2b.api.launchBsLiveTab('ab', G_URL, 'x', {}));
eq('no earlier Live tab: nothing is closed', G2b.removed.length + ':' + G2b.created.length, '0:1');
var G2c = makeGlue({ oldTab: 3, tabGone: true });
settle(G2c.api.launchBsLiveTab('ab', G_URL, 'x', {}));
eq('an earlier tab that no longer exists is not closed, and does not stop the launch', G2c.removed.length + ':' + G2c.created.length, '0:1');
eq('Local and force-local are passed on exactly as the caller judged them', (function () {
  var g = makeGlue(); settle(g.api.launchBsLiveTab('ft', G_URL, 'x', { wantLocal: true, wantForceLocal: false })); return g.sent[0].wantLocal + ':' + g.sent[0].wantForceLocal;
})(), 'true:false');
var G4 = makeGlue();
settle(G4.api.launchBsLiveTab('ab', G_URL, 'x', { unconfirmed: true, wantLocal: true }));
eq('"Open anyway" is marked unconfirmed for the watcher, which then says what it could not know', G4.sent[0].unconfirmed + ':' + G4.sent[0].wantLocal, 'true:true');
var G5 = makeGlue();
settle(G5.api.launchBsLiveTab('ab', bsLiveUrl(bsPresetById('galaxy-s26'), 'https://x.com/', { local: true, start: false }), 'Control on Galaxy S26', { manual: true }));
eq('the manual route opens the tab and watches nothing', G5.created.length + ':' + G5.sent.length + ':' + G5.timers.length, '1:0:0');
ok('and tells the tester what to do, without promising Local (a device picked by hand has started without it)', /When Live's Local Testing panel shows Local connected, pick the device in its list, then check that the page loads on it/.test(G5.statuses[0].html) && !/starts with Local/.test(G5.statuses[0].html) && G5.statuses[0].color === 'var(--ok)', G5.statuses[0]);
ok('its link has no start parameter', G5.created[0].url.indexOf('start=') === -1, G5.created[0].url);
var G6 = makeGlue({ noAck: true });
settle(G6.api.launchBsLiveTab('ab', G_URL, 'x', {}));
eq('a worker that does not answer (an old one): says to reload Selenite', /Reload Selenite in chrome:\/\/extensions/.test(G6.statuses[G6.statuses.length - 1].html) && G6.statuses[G6.statuses.length - 1].color === 'var(--warn)', true);
eq('and arms no timer for a watch that does not exist', G6.timers.length, 0);
var G7 = makeGlue({ createThrows: true });
settle(G7.api.launchBsLiveTab('ab', G_URL, 'x', {}));
eq('a tab that cannot be opened is an error', /Could not open BrowserStack Live: Tabs cannot be edited right now/.test(G7.statuses[0].html) && G7.statuses[0].color === 'var(--err)', true);
var G8 = makeGlue();
settle(G8.api.launchBsLiveTab('ab', G_URL, 'A <b>&</b> B', {}));
ok('the device name is escaped in the status line', G8.statuses[0].html.indexOf('<b>') === -1 && /A &lt;b&gt;&amp;&lt;\/b&gt; B/.test(G8.statuses[0].html), G8.statuses[0].html);

// Two quick launches run one after the other: the second closes the first's tab, even
// while that tab has no url yet (only the one it is loading). Racing them left two
// dashboards fighting over the session.
var GS = makeGlue({ slowCreate: true });
var gs1 = settle(GS.api.launchBsLiveTab('ab', G_URL, 'first', {}));
var gs2 = settle(GS.api.launchBsLiveTab('ab', G_URL, 'second', {}));
eq('the second launch waits for the first to finish opening its tab', GS.created.length, 1);
GS.finishCreate();
drainMicrotasks();
eq('then the second closes the first\'s tab, which has only a pendingUrl', GS.removed.join(',') + ':' + GS.created.length, '3,99:2');
eq('and the order was: close the old one, open the first, close the first, open the second', GS.order.join(','), 'remove:3,create,remove:99,create');
GS.finishCreate();
drainMicrotasks();
eq('both launches finish, and the tab remembered is the later one', gs1.done + ':' + gs2.done + ':' + GS.store.bsLiveTabId, 'true:true:100');
var GS3 = makeGlue({ statusThrows: 2 });
var gsa = settle(GS3.api.launchBsLiveTab('ab', G_URL, 'first', {}));
var gsc = settle(GS3.api.launchBsLiveTab('ab', G_URL, 'second', {}));
eq('a launch that fails with its status line unwritable does not stop the next one', (gsa.error ? 'rejected' : 'resolved') + ':' + gsc.done + ':' + GS3.created.length, 'rejected:true:2');
var GS2 = makeGlue({ createThrows: true });
settle(GS2.api.launchBsLiveTab('ab', G_URL, 'first', {}));
GS2.created.length = 0;
var gsb = settle(GS2.api.launchBsLiveTab('ab', G_URL, 'second', {}));
eq('a launch that failed does not stop the next one', gsb.done + ':' + GS2.created.length, 'true:1');

// openBsLive: what Local and force-local mean when the link is built.
section('panel: openBsLive');
var GO = makeGlue();
settle(GO.api.openBsLive('ab', 'galaxy-s26', 'control'));
eq('Local on and ready: one Local check, then the launch', GO.localAsked + ':' + GO.created.length + ':' + GO.sent.length, '1:1:1');
ok('the link asks for Local and force-local', /local=true/.test(GO.created[0].url) && /force-local=true/.test(GO.created[0].url), GO.created[0].url);
eq('the watcher is told what was asked for', GO.sent[0].wantLocal + ':' + GO.sent[0].wantForceLocal + ':' + GO.sent[0].unconfirmed + ':' + GO.sent[0].presetId + ':' + GO.sent[0].pageUrl, 'true:true:false:galaxy-s26:https://x.com/');
eq('and the device and page it is about', GO.sent[0].what, 'Control on Galaxy S26');
var GO2 = makeGlue({ prefs: { devices: [], local: false, forceLocal: true } });
settle(GO2.api.openBsLive('ab', 'galaxy-s26', 'control'));
eq('Local off: no Local check, a link with neither, and nothing asked of the watcher', GO2.localAsked + ':' + /local=/.test(GO2.created[0].url) + ':' + GO2.sent[0].wantLocal + ':' + GO2.sent[0].wantForceLocal, '0:false:false:false');
var GO3 = makeGlue({ prefs: { devices: [], local: true, forceLocal: false } });
settle(GO3.api.openBsLive('ab', 'galaxy-s26', 'control'));
eq('force-local off stays off, in the link and in what is asked of the watcher', /force-local/.test(GO3.created[0].url) + ':' + GO3.sent[0].wantLocal + ':' + GO3.sent[0].wantForceLocal, 'false:true:false');
// The toggles can change while the Local check is out; what is judged afterwards is what was launched.
var GO4 = makeGlue({ localCheck: function (g) { g.prefs.local = false; g.prefs.forceLocal = false; return Promise.resolve({ ready: true, state: 'ready' }); } });
settle(GO4.api.openBsLive('ab', 'galaxy-s26', 'control'));
eq('toggles flipped during the check: the link and the judgement still agree (both read once, before it)', /local=true/.test(GO4.created[0].url) + ':' + GO4.sent[0].wantLocal + ':' + GO4.sent[0].wantForceLocal, 'true:true:true');
// Not ready: nothing opens, and "Open anyway" remembers exactly what was asked.
var GN = makeGlue({ localStatus: { ready: false, state: 'not-connected' } });
settle(GN.api.openBsLive('ab', 'galaxy-s26', 'control'));
eq('Local not ready: nothing opens, the reason is shown, and Open anyway is offered', GN.created.length + ':' + GN.localShown.length + ':' + GN.appended.length + ':' + /data-bs-open-anyway/.test(GN.appended[0].html), '0:1:1:true');
eq('what Open anyway will open is remembered, with the Local choices as they were', GN.pending.ab.local + ':' + GN.pending.ab.forceLocal + ':' + GN.pending.ab.presetId + ':' + GN.pending.ab.pageUrl + ':' + GN.pending.ab.what, 'true:true:galaxy-s26:https://x.com/:Control on Galaxy S26');
ok('and the link it will open', GN.pending.ab.url.indexOf('device=Samsung+Galaxy+S26') > -1 && /local=true/.test(GN.pending.ab.url), GN.pending.ab.url);
var GN5 = makeGlue({ prefs: { devices: [], local: true, forceLocal: false }, localStatus: { ready: false, state: 'not-running' } });
settle(GN5.api.openBsLive('ab', 'galaxy-s26', 'control'));
eq('Open anyway remembers force-local as it was set, not as it usually is', GN5.pending.ab.local + ':' + GN5.pending.ab.forceLocal + ':' + /force-local/.test(GN5.pending.ab.url), 'true:false:false');
var GN2 = makeGlue({ localStatus: { ready: false, state: 'not-running' } });
GN2.pending.ab = { url: 'stale' };
settle(GN2.api.openBsLive('ab', 'galaxy-s26', 'control'));
GN2.api.openBsLive('ab', 'galaxy-s26', 'none');
drainMicrotasks();
eq('a new click discards the earlier pending launch', GN2.pending.ab && GN2.pending.ab.url === 'stale', false);
var GN6 = makeGlue({ localStatus: { ready: false, state: 'not-running' } });
settle(GN6.api.openBsLive('ab', 'galaxy-s26', 'control'));
GN6.localStatus = { ready: true, state: 'ready' };
settle(GN6.api.openBsLive('ab', 'galaxy-s26', 'control'));
eq('a click that goes on to launch clears the pending "Open anyway" of the click before', GN6.created.length + ':' + (GN6.pending.ab === undefined), '1:true');
var GN3 = makeGlue();
settle(GN3.api.openBsLive('ab', 'galaxy-s26', 'none'));
eq('a target with no URL says so and opens nothing', GN3.created.length + ':' + GN3.statuses[GN3.statuses.length - 1].html + ':' + GN3.statuses[GN3.statuses.length - 1].color, '0:Enter a URL first.:var(--err)');
var GN4 = makeGlue();
settle(GN4.api.openBsLive('ab', 'no-such-device', 'control'));
settle(GN4.api.openBsLive('ab', 'galaxy-s26', 'no-such-target'));
settle(GN4.api.openBsLive('zz', 'galaxy-s26', 'control'));
eq('an unknown device, target or place does nothing', GN4.created.length + ':' + GN4.statuses.length + ':' + GN4.localAsked, '0:0:0');

// The worker's report becomes the status line.
section('panel: renderBsLaunch');
function rec(page, extra, opts) {
  var r = { tabId: 99, key: 'ab', what: 'Control on Galaxy S26', presetId: 'galaxy-s26', pageUrl: 'https://x.com/', wantLocal: true, wantForceLocal: true, verdict: verdict(page, opts), at: Date.now() };
  for (var k in (extra || {})) r[k] = extra[k];
  return r;
}
function recV(v, extra) { var r = rec(PG_PICKER, extra); r.verdict = v; return r; }
// A glue whose latest launch is tab 99, still open: the state right after a launch.
function liveGlue(o) {
  o = o || {};
  var tabs = {}; tabs[99] = LIVE_TAB(99);
  var g = makeGlue({ oldTab: 99, tabs: tabs, prefs: o.prefs, store: o.store });
  settle(g.api.launchBsLiveTab('ab', G_URL, 'Control on Galaxy S26', {}));
  // that launch closed tab 99 and opened 100; put the world back to "99 is the one"
  g.statuses.length = 0; g.appended.length = 0; g.tabs = tabs; g.store.bsLiveTabId = 99;
  return g;
}
var GR = makeGlue({ oldTab: 99 });
settle(GR.api.renderBsLaunch(rec(PG_ANDROID_NO_LOCAL)));
eq('started without Local: a warning with Live\'s words and the manual button', GR.statuses[0].color + ':' + /before it found your BrowserStack Local app/.test(GR.statuses[0].html) + ':' + GR.appended.length + ':' + /data-bs-open-manual/.test(GR.appended[0].html), 'var(--warn):true:1:true');
ok('the button carries what it opens (preset, page, device)', /data-bs-preset="galaxy-s26"/.test(GR.appended[0].html) && /data-bs-page="https:\/\/x\.com\/"/.test(GR.appended[0].html) && /data-bs-what="Control on Galaxy S26"/.test(GR.appended[0].html), GR.appended[0].html);
var GR2 = makeGlue({ oldTab: 99 });
settle(GR2.api.renderBsLaunch(rec(PG_ANDROID_NO_LOCAL, { pageUrl: '' })));
eq('no page URL to rebuild the link from: no manual button', GR2.appended.length, 0);
var GR3 = makeGlue({ oldTab: 99 });
settle(GR3.api.renderBsLaunch(rec(PG_REFUSED)));
eq('refused is red and has no manual button', GR3.statuses[0].color + ':' + GR3.appended.length, 'var(--err):0');
var GR4 = makeGlue({ oldTab: 99 });
settle(GR4.api.renderBsLaunch(rec({ title: 'Dashboard', banners: ['<img src=x onerror=alert(1)> broke'] })));
ok("Live's own text is escaped before it goes into the line", GR4.statuses[0].html.indexOf('<img') === -1 && /&lt;img src=x onerror=alert\(1\)&gt;/.test(GR4.statuses[0].html), GR4.statuses[0].html);
var GR4b = makeGlue({ oldTab: 99 });
settle(GR4b.api.renderBsLaunch(rec(PG_ANDROID_NO_LOCAL, { what: 'A"><script>x</script>', presetId: 'p"q', pageUrl: 'https://x.com/?a="b"' })));
ok('and so is everything the manual button carries (a quote cannot end its attribute)', GR4b.appended.length === 1 && GR4b.appended[0].html.indexOf('<script>') === -1 && !/data-bs-page="[^"]*"[^ >]*"/.test(GR4b.appended[0].html) && GR4b.appended[0].html.indexOf('data-bs-preset="p&quot;q"') > -1, GR4b.appended[0].html);
var GR5 = makeGlue({ oldTab: 99 });
settle(GR5.api.renderBsLaunch(rec(PG_ANDROID_LOCAL, { wantForceLocal: false })));
eq('started with Local: green, no button', GR5.statuses[0].color + ':' + GR5.appended.length, 'var(--ok):0');
var GR6 = makeGlue({ oldTab: 99 });
settle(GR6.api.renderBsLaunch(rec(PG_PICKER)));
eq('still starting: quiet', GR6.statuses[0].color, 'var(--fg3)');
var GR6b = makeGlue({ oldTab: 99 });
settle(GR6b.api.renderBsLaunch(rec(PG_ANDROID_NO_LOCAL, { unconfirmed: true, wantLocal: true })));
eq('"Open anyway" without Local: says Local was not confirmed, and does not offer the route again', /wasn't connected when you opened it/.test(GR6b.statuses[0].html) + ':' + GR6b.appended.length, 'true:0');
// What a report says about a tab that has gone.
var GR9 = makeGlue({ oldTab: 99 });
settle(GR9.api.renderBsLaunch(recV({ state: 'closed', wasStarted: false })));
eq('the Live tab was closed before it started: said so', GR9.statuses[0].html + '|' + GR9.statuses[0].color, 'The Live tab for Control on Galaxy S26 was closed before it started.|var(--fg3)');
var GR9b = makeGlue({ oldTab: 99, tabGone: true });
settle(GR9b.api.renderBsLaunch(recV({ state: 'closed', wasStarted: true })));
eq('closed is shown though its tab no longer exists (that is the report)', GR9b.statuses.length + ':' + GR9b.statuses[0].html, '1:The Live tab for Control on Galaxy S26 was closed.');
var GR9c = makeGlue({ oldTab: 99 });
settle(GR9c.api.renderBsLaunch(recV({ state: 'ended' })));
settle(GR9c.api.renderBsLaunch(recV({ state: 'left', host: 'www.browserstack.com' }, { at: Date.now() + 1 })));
eq('ended and left are both shown', GR9c.statuses.length, 2);
var GR9d = makeGlue({ oldTab: 99 });
settle(GR9d.api.renderBsLaunch(rec(PG_DROPPED, {}, { wasStarted: true })));
eq('a session that started and was then dropped says "dropped", not "didn\'t start"', /Live dropped the session on Control on Galaxy S26/.test(GR9d.statuses[0].html) + ':' + /didn't start/.test(GR9d.statuses[0].html), 'true:false');
// Only the launch on screen has a say.
// Both tabs exist, so only "is it the Live tab opened last" can turn this report away.
var GR7 = makeGlue({ oldTab: 100, tabs: { 99: LIVE_TAB(99), 100: LIVE_TAB(100) } });
settle(GR7.api.renderBsLaunch(rec(PG_REFUSED)));
eq('a report about a Live tab that is no longer the one opened last is ignored, though that tab still exists', GR7.statuses.length, 0);
var GR7a = makeGlue({ oldTab: 99, tabs: { 99: LIVE_TAB(99), 100: LIVE_TAB(100) } });
settle(GR7a.api.renderBsLaunch(rec(PG_REFUSED)));
eq('and the same report for the tab opened last is shown (the guard is not simply off)', GR7a.statuses.length, 1);
var GR7b = makeGlue({ oldTab: 99, tabGone: true });
settle(GR7b.api.renderBsLaunch(rec(PG_REFUSED)));
eq('a report about a Live tab the tester has since closed (and was not told so) is history: not shown', GR7b.statuses.length, 0);
var GR8 = makeGlue({ oldTab: 99 });
settle(GR8.api.renderBsLaunch(null));
settle(GR8.api.renderBsLaunch({ verdict: { state: 'refused' } }));
settle(GR8.api.renderBsLaunch({ key: 'zz', verdict: { state: 'refused' }, at: Date.now() }));
eq('a report with no place to show is ignored', GR8.statuses.length, 0);
// A reopened panel reads the last report back; an old one is history.
var GA = makeGlue({ oldTab: 99 });
settle(GA.api.renderBsLaunch(rec(PG_REFUSED, { at: Date.now() - BS_LAUNCH_REPORT_MAX_AGE_MS - 1000 })));
eq('a report older than ten minutes is not what is on screen', GA.statuses.length, 0);
var GA2 = makeGlue({ oldTab: 99 });
settle(GA2.api.renderBsLaunch(rec(PG_REFUSED, { at: Date.now() - BS_LAUNCH_REPORT_MAX_AGE_MS + 60000 })));
eq('one just inside it is', GA2.statuses.length, 1);
var GA3 = makeGlue({ oldTab: 99 });
settle(GA3.api.renderBsLaunch(rec(PG_REFUSED, { at: undefined })));
settle(GA3.api.renderBsLaunch(rec(PG_REFUSED, { at: 'yesterday' })));
eq('a report with no usable time is not shown', GA3.statuses.length, 0);
// This panel's own latest launch outranks a stored report of an earlier one.
var GL = makeGlue({ oldTab: 3 });
settle(GL.api.launchBsLiveTab('ab', G_URL, 'x', {}));
GL.statuses.length = 0;
var oldRec = rec(PG_ANDROID_NO_LOCAL, { tabId: 3 });
settle(GL.api.renderBsLaunch(oldRec));
eq('a report about an earlier launch from this place is ignored once a newer one has opened', GL.statuses.length, 0);
settle(GL.api.renderBsLaunch(recV({ state: 'closed', wasStarted: true }, { tabId: 3 })));
eq('so is its "closed" (the old watcher sees the tab go in the instant the relaunch closes it)', GL.statuses.length, 0);
settle(GL.api.renderBsLaunch(rec(PG_ANDROID_NO_LOCAL, { tabId: 99 })));
eq('the new launch\'s report is shown', GL.statuses.length, 1);
// Reports can arrive in the wrong order: the later one stays.
var GO5 = makeGlue({ oldTab: 99 });
var tNow = Date.now();
settle(GO5.api.renderBsLaunch(rec(PG_ANDROID_NO_LOCAL, { at: tNow + 5 })));
settle(GO5.api.renderBsLaunch(rec(PG_PICKER, { at: tNow + 1 })));
eq('an older report arriving after a newer one does not replace it', GO5.statuses.length + ':' + /before it found/.test(GO5.statuses[0].html), '1:true');
// Another place's report never lands on this place's line.
var GP = makeGlue({ oldTab: 99 });
settle(GP.api.launchBsLiveTab('ab', G_URL, 'x', {}));
GP.statuses.length = 0;
settle(GP.api.renderBsLaunch(rec(PG_ANDROID_LOCAL, { key: 'ft', tabId: 99 })));
eq('a report for place "ft" is rendered for "ft", whatever "ab" last launched', GP.statuses.length + ':' + GP.statuses[0].key, '1:ft');

// bsCheckLaunchLost: the watch died.
section('panel: bsCheckLaunchLost');
var GX = makeGlue();
settle(GX.api.launchBsLiveTab('ab', G_URL, 'Control on Galaxy S26', {}));
GX.statuses.length = 0;
settle(GX.timers[0].fn());
eq('past the deadline, still "starting" and no report: the line says Selenite stopped watching', /stopped watching this launch/.test(GX.statuses[0].html) + ':' + GX.statuses[0].color, 'true:var(--warn)');
var GX2 = makeGlue();
settle(GX2.api.launchBsLiveTab('ab', G_URL, 'x', {}));
GX2.statuses.length = 0;
GX2.store.bsLaunch_ab = { tabId: 99, verdict: { state: 'started' } };
settle(GX2.timers[0].fn());
eq('if it reported something, there is nothing to correct', GX2.statuses.length, 0);
var GX3 = makeGlue();
settle(GX3.api.launchBsLiveTab('ab', G_URL, 'x', {}));
GX3.statuses.length = 0;
GX3.store.bsLaunch_ab = { tabId: 99, verdict: { state: 'starting' } };
settle(GX3.timers[0].fn());
eq('a report that still says "starting" is a watch that died', GX3.statuses.length, 1);
var GX4 = makeGlue();
settle(GX4.api.launchBsLiveTab('ab', G_URL, 'first', {}));
var firstTimer = GX4.timers[0];
settle(GX4.api.launchBsLiveTab('ab', G_URL, 'second', {}));
GX4.statuses.length = 0;
settle(firstTimer.fn());
eq('the first launch\'s timer does nothing once a second has opened (it has its own line)', GX4.statuses.length, 0);
var GX5 = makeGlue();
settle(GX5.api.launchBsLiveTab('ab', G_URL, 'x', {}));
GX5.statuses.length = 0;
GX5.store.bsLaunch_ab = { tabId: 42, verdict: { state: 'started' } };
settle(GX5.timers[0].fn());
eq('a stored report about a different tab does not count as this launch having reported', GX5.statuses.length, 1);

// "Open Live and pick the device myself".
section('panel: openBsLiveManual');
var MAN = { bsPreset: 'galaxy-s26', bsPage: 'https://x.com/', bsWhat: 'Control on Galaxy S26' };
var GM = makeGlue({ oldTab: 99 });
settle(GM.api.openBsLiveManual('ab', MAN));
eq('it opens Live with the page and Local, without start=true, and without watching', GM.created.length + ':' + GM.sent.length, '1:0');
eq('the link is the manual one, force-local following the preference', GM.created[0].url, bsLiveUrl(bsPresetById('galaxy-s26'), 'https://x.com/', { local: true, forceLocal: true, start: false }));
var GM2 = makeGlue({ oldTab: 99, prefs: { devices: [], local: true, forceLocal: false } });
settle(GM2.api.openBsLiveManual('ab', MAN));
ok('force-local off in the preferences stays off', GM2.created[0].url.indexOf('force-local') === -1, GM2.created[0].url);
var GM3 = makeGlue({ oldTab: 99 });
settle(GM3.api.openBsLiveManual('ab', {}));
settle(GM3.api.openBsLiveManual('ab', undefined));
eq('with nothing on the button it does nothing', GM3.created.length, 0);
var GM4 = makeGlue({ oldTab: 99 });
settle(GM4.api.openBsLiveManual('ab', { bsPreset: 'gone-device', bsPage: 'https://x.com/', bsWhat: 'x' }));
eq('with a device that no longer exists it does nothing', GM4.created.length, 0);
var GM5 = makeGlue({ oldTab: 99 });
settle(GM5.api.openBsLiveManual('ab', { bsPreset: 'galaxy-s26', bsPage: '', bsWhat: 'x' }));
eq('with no page it does nothing', GM5.created.length, 0);
// The button opens what it carries, not whatever is latest on record.
var GM6 = makeGlue({ oldTab: 99, store: { bsLaunch_ab: rec(PG_ANDROID_NO_LOCAL, { presetId: 'iphone-18-pro', pageUrl: 'https://other.example/' }) } });
settle(GM6.api.openBsLiveManual('ab', MAN));
eq('the link is built from the button, not from the stored report of some other launch', param(GM6.created[0].url, 'device') + '|' + param(GM6.created[0].url, 'url'), 'Samsung Galaxy S26|https://x.com/');
var GM7 = makeGlue({ oldTab: 99 });
settle(GM7.api.openBsLiveManual('ab', { bsPreset: 'galaxy-s26', bsPage: 'https://x.com/' }));
ok('with no name on the button the device label stands in', /Galaxy S26/.test(GM7.statuses[0].html), GM7.statuses[0].html);


// The delegated click on a status line (initBsLive): the two buttons renderBsLaunch and
// openBsLive put there.
section('panel: the status-line buttons');
var CLICK_SRC = sliceBetween(POPUP, "      const manual = e.target.closest('[data-bs-open-manual]');", "\n    });\n  }\n  renderBsLiveAll();", 'popup status click');
function clickWorld(pending) {
  var w = { manual: [], launched: [], pending: pending || {} };
  var fn = new Function('e', 'key', 'openBsLiveManual', '_bsLivePending', 'launchBsLiveTab', CLICK_SRC);
  w.click = function (matches, dataset) {
    var target = { closest: function (sel) { return matches.indexOf(sel) > -1 ? { dataset: dataset || {} } : null; } };
    fn({ target: target }, 'ab',
      function (k, d) { w.manual.push({ k: k, d: d }); },
      w.pending,
      function (k, u, what, opts) { w.launched.push({ k: k, u: u, what: what, opts: opts }); });
  };
  return w;
}
var CK = clickWorld({ ab: { url: 'https://live/x', what: 'Control on Galaxy S26', presetId: 'galaxy-s26', pageUrl: 'https://x.com/', local: true, forceLocal: true } });
CK.click(['[data-bs-open-manual]'], { bsPreset: 'galaxy-s26', bsPage: 'https://x.com/', bsWhat: 'w' });
eq('the manual button hands its own data to openBsLiveManual, and launches nothing itself', CK.manual.length + ':' + CK.manual[0].k + ':' + CK.manual[0].d.bsPreset + ':' + CK.launched.length, '1:ab:galaxy-s26:0');
eq('and leaves a pending "Open anyway" alone', !!CK.pending.ab, true);
CK.click(['[data-bs-open-anyway]']);
eq('"Open anyway" launches what was pending', CK.launched.length + ':' + CK.launched[0].u + ':' + CK.launched[0].what, '1:https://live/x:Control on Galaxy S26');
eq('marked unconfirmed, still asking the watcher about Local, with what to open by hand', JSON.stringify(CK.launched[0].opts), JSON.stringify({ unconfirmed: true, presetId: 'galaxy-s26', pageUrl: 'https://x.com/', wantLocal: true, wantForceLocal: true }));
eq('and it is spent: a second click does nothing', (function () { CK.click(['[data-bs-open-anyway]']); return CK.launched.length + ':' + !!CK.pending.ab; })(), '1:false');
var CK2 = clickWorld({ ab: { url: 'u', what: 'w', presetId: 'p', pageUrl: 'g', local: true, forceLocal: false } });
CK2.click(['[data-bs-open-anyway]']);
eq('force-local off stays off', CK2.launched[0].opts.wantLocal + ':' + CK2.launched[0].opts.wantForceLocal, 'true:false');
var CK3 = clickWorld({ ab: { url: 'u', what: 'w', presetId: 'p', pageUrl: 'g', local: false, forceLocal: true } });
CK3.click(['[data-bs-open-anyway]']);
eq('force-local never goes out without Local', CK3.launched[0].opts.wantLocal + ':' + CK3.launched[0].opts.wantForceLocal, 'false:false');
var CK4 = clickWorld({});
CK4.click(['[data-bs-open-anyway]']);
CK4.click([]);
eq('with nothing pending, or a click on something else, nothing happens', CK4.launched.length + ':' + CK4.manual.length, '0:0');
var CK5 = clickWorld({ ft: { url: 'u', what: 'w', presetId: 'p', pageUrl: 'g', local: true, forceLocal: true } });
CK5.click(['[data-bs-open-anyway]']);
eq("another place's pending launch is not this place's to open", CK5.launched.length + ':' + !!CK5.pending.ft, '0:true');

// The worker writes bsLaunch_<place> to this window's session storage; the panel renders it.
section('panel: following the worker\'s reports');
var FOLLOW_SRC2 = sliceBetween(POPUP, "  chrome.storage.onChanged.addListener((changes, area) => {\n    if (area !== 'session') return;\n    for (const k of bsLiveKeys())", "\n}\n\n// Every place shows the same selection", 'popup report listener');
function followReports(o) {
  o = o || {};
  var w = { rendered: [], listeners: [], store: o.store || {} };
  var chromeStub = { storage: { onChanged: { addListener: function (fn) { w.listeners.push(fn); } } } };
  var nsKey = function (k) { return 'w5:' + k; };
  var places = o.places || ['ab', 'ft'];
  var sessionNS = { get: function (k) { if (o.getRejects) return Promise.reject(new Error('gone')); var out = {}; out[k] = w.store[nsKey(k)]; return Promise.resolve(out); } };
  new Function('chrome', 'nsKey', 'bsLiveKeys', 'renderBsLaunch', 'sessionNS', 'keys', FOLLOW_SRC2)(
    chromeStub, nsKey, function () { return places.slice(); }, function (r) { w.rendered.push(r); }, sessionNS, places);
  drainMicrotasks();
  return w;
}
var FR = followReports({ store: { 'w5:bsLaunch_ab': { tabId: 1, key: 'ab' } } });
eq('a panel opened after the launch reads the last report once, for the place that has one', FR.rendered.length + ':' + FR.rendered[0].key, '1:ab');
eq('and listens for more', FR.listeners.length, 1);
FR.listeners[0]({ 'w5:bsLaunch_ab': { newValue: { tabId: 2, key: 'ab' } } }, 'session');
eq('a new report for this window is rendered', FR.rendered.length + ':' + FR.rendered[1].tabId, '2:2');
FR.listeners[0]({ 'w5:bsLaunch_ft': { newValue: { tabId: 3, key: 'ft' } } }, 'session');
eq('one for the other place is rendered too', FR.rendered[2].key, 'ft');
FR.listeners[0]({ 'w6:bsLaunch_ab': { newValue: { tabId: 4, key: 'ab' } } }, 'session');
eq("another window's report is none of this panel's business", FR.rendered.length, 3);
FR.listeners[0]({ 'w5:bsLaunch_ab': { newValue: { tabId: 5, key: 'ab' } } }, 'local');
eq('storage.local changes are ignored', FR.rendered.length, 3);
FR.listeners[0]({ 'w5:bsLaunch_ab': { oldValue: { tabId: 2 } } }, 'session');
eq('a removed report is ignored', FR.rendered.length, 3);
FR.listeners[0]({ 'w5:somethingElse': { newValue: { x: 1 } } }, 'session');
eq('unrelated keys are ignored', FR.rendered.length, 3);
var FR2 = followReports({ getRejects: true });
eq('a storage read that fails is swallowed', FR2.rendered.length, 0);
var FR3 = followReports({ places: ['ab'] });
FR3.listeners[0]({ 'w5:bsLaunch_ft': { newValue: { tabId: 3, key: 'ft' } } }, 'session');
eq('a place that is not on this panel is not rendered', FR3.rendered.length, 0);


// ── Live renames its tab after the session starts ──────────────────────────
// captureStatus.title is what the panel names the device by. It was taken when the
// page finished loading, and Live changes the title seconds later, so it read
// "Dashboard" (found by the real-Chrome gate).
section('worker: a captured Live tab is renamed');
var TITLE_SRC = sliceBetween(WORKER, '  if (info.title !== undefined) {', "  if (info.url && info.status !== 'complete') {", 'worker title branch');
function renameWorld(over) {
  over = over || {};
  var st = { writes: [], store: { captureStatus: over.captureStatus === undefined ? { tabId: 11, title: 'Dashboard', url: 'https://live.browserstack.com/dashboard#os=android', capturable: true, bsLive: true } : over.captureStatus } };
  var asyncFn = new Function('tabId', 'info', 'restoreFollowState', 'bsLiveWinFor', 'ns',
    'return (async () => {\n' + TITLE_SRC + '\n})();');
  st.run = function (tabId, info) {
    var p = asyncFn(tabId, info, function () { return Promise.resolve(); },
      function (id) { return over.noLiveWin ? null : (id === 11 ? 5 : null); },
      function (win) { return {
        get: function (k) { var o = {}; o[k] = st.store[k]; return Promise.resolve(o); },
        set: function (obj) { for (var n in obj) st.store[n] = obj[n]; st.writes.push({ win: win, obj: obj }); return Promise.resolve(); },
      }; });
    return settle(p);
  };
  return st;
}
var RW = renameWorld();
RW.run(11, { title: 'iPhone 18 Pro v27.0' });
eq('the captured Live tab is renamed: captureStatus follows', RW.store.captureStatus.title + ':' + RW.writes.length, 'iPhone 18 Pro v27.0:1');
eq('everything else in captureStatus is kept', RW.store.captureStatus.tabId + ':' + RW.store.captureStatus.bsLive + ':' + RW.store.captureStatus.capturable, '11:true:true');
eq('written under that window', RW.writes[0].win, 5);
RW.run(11, { title: 'iPhone 18 Pro v27.0' });
eq('the same title again writes nothing', RW.writes.length, 1);
var RW2 = renameWorld();
RW2.run(99, { title: 'Some other tab' });
eq('a tab that is not captured is nobody\'s business', RW2.writes.length, 0);
var RW3 = renameWorld({ captureStatus: { tabId: 12, title: 'x' } });
RW3.run(11, { title: 'y' });
eq('a captureStatus for a different tab is left alone', RW3.writes.length, 0);
var RW4 = renameWorld({ captureStatus: undefined });
RW4.store.captureStatus = undefined;
RW4.run(11, { title: 'y' });
eq('no captureStatus at all is not a crash', RW4.writes.length, 0);
var RW5 = renameWorld();
RW5.run(11, { status: 'loading' });
eq('an update with no title change does nothing here', RW5.writes.length, 0);

// Live's idle countdown. Measured 2026-10-14 on a Galaxy S26 left untouched:
// ~9 minutes after the last input the tab was retitled "60 seconds to session
// timeout", then "59 …" down to "1 seconds to session timeout" (Live's
// spelling), one a second, then "Dashboard" when Live closed the session. In
// 0.7.15 the console line followed it: "○ Open DevTools in the Live session to
// mirror 37 seconds to session timeout's console", sixty times.
section('Live\'s idle countdown title (bsIsCountdownTitle)');
var COUNTDOWN = [];
for (var cd = 60; cd >= 1; cd--) COUNTDOWN.push(cd + ' seconds to session timeout');
ok('every title of the measured countdown is recognised', COUNTDOWN.every(bsIsCountdownTitle), COUNTDOWN.filter(function (t) { return !bsIsCountdownTitle(t); }));
ok('so is a singular "second", and spacing or case', bsIsCountdownTitle('1 second to session timeout') && bsIsCountdownTitle('  9 Seconds To Session Timeout '));
ok('a device name, Dashboard, nothing and longer text are not',
  ['Samsung Galaxy S26 v16.0', 'iPhone 17 v26.6', 'Dashboard', '', null, undefined, 'seconds to session timeout', '60 seconds to session timeout (paused)', 'Session timeout in 60 seconds']
    .every(function (t) { return !bsIsCountdownTitle(t); }));

var RW6 = renameWorld({ captureStatus: { tabId: 11, title: 'Samsung Galaxy S26 v16.0', url: 'https://live.browserstack.com/dashboard#os=android', capturable: true, bsLive: true } });
COUNTDOWN.forEach(function (t) { RW6.run(11, { title: t }); });
eq('the worker keeps the device\'s name through the whole countdown', RW6.store.captureStatus.title + ':' + RW6.writes.length, 'Samsung Galaxy S26 v16.0:0');
RW6.run(11, { title: 'Dashboard' });
eq('and follows the tab again once Live has closed the session', RW6.store.captureStatus.title + ':' + RW6.writes.length, 'Dashboard:1');

// The same rule where a follow or a refresh copies the tab's title in.
eval(sliceBetween(WORKER, 'function captureTitle(tab, prev) {', '\n// Whether the tab a window captures', 'worker captureTitle'));
eq('a device title is taken as it is', captureTitle({ id: 11, title: 'Samsung Galaxy S26 v16.0' }, { tabId: 11, title: 'Dashboard' }), 'Samsung Galaxy S26 v16.0');
eq('a countdown keeps the name this tab had', captureTitle({ id: 11, title: '12 seconds to session timeout' }, { tabId: 11, title: 'Samsung Galaxy S26 v16.0' }), 'Samsung Galaxy S26 v16.0');
eq('a countdown on a tab not seen before names nothing', captureTitle({ id: 12, title: '12 seconds to session timeout' }, { tabId: 11, title: 'Samsung Galaxy S26 v16.0' }), '');
eq('  nor with no earlier status at all', captureTitle({ id: 12, title: '12 seconds to session timeout' }, undefined), '');
eq('a tab with no title is empty, as before', captureTitle({ id: 11 }, null), '');

// The other title that names nothing: a Live tab's own address, before the page
// has set a title. Measured 2026-10-14: chrome.tabs.get read
// "live.browserstack.com/dashboard#os=android…" between "" and "Dashboard" in 1
// of 4 loads, and a Mac Safari launch's console line read "mirror
// live.browserstack.com's console" for about 3 s (0.7.16).
var LIVE_ADDR = 'live.browserstack.com/dashboard#os=android&os_version=16.0&device=Samsung+Galaxy+S26&device_browser=chrome&url=https%3A%2F%2Fexample.com%2F%3Ftitleprobe%3D2';
ok('a Live tab\'s address, its host, or either with a scheme names nothing',
  [LIVE_ADDR, 'live.browserstack.com', 'https://live.browserstack.com/dashboard', 'LIVE.BrowserStack.com/dashboard'].every(bsTitleNamesNothing));
ok('the countdown still names nothing', COUNTDOWN.every(bsTitleNamesNothing));
ok('device names, Dashboard and other hosts are names (or not this rule\'s business)',
  ['Samsung Galaxy S26 v16.0', 'iPhone 17 v26.6', 'Google Pixel 10 v16.0', 'Dashboard', 'live.browserstack.community', 'www.browserstack.com/users/sign_in', 'Live — browserstack.com'].every(function (t) { return !bsTitleNamesNothing(t); }));
eq('captureTitle keeps the tab\'s name over its own address', captureTitle({ id: 11, title: LIVE_ADDR }, { tabId: 11, title: 'Samsung Galaxy S26 v16.0' }), 'Samsung Galaxy S26 v16.0');
eq('  and names nothing for a tab first seen loading', captureTitle({ id: 11, title: 'live.browserstack.com' }, { tabId: 9, title: 'Some other page' }), '');
var RW7 = renameWorld({ captureStatus: { tabId: 11, title: 'Dashboard', url: 'https://live.browserstack.com/dashboard#os=OS+X', capturable: true, bsLive: true } });
RW7.run(11, { title: 'live.browserstack.com' });
RW7.run(11, { title: LIVE_ADDR });
eq('the title-follow skips the address too', RW7.store.captureStatus.title + ':' + RW7.writes.length, 'Dashboard:0');

// refreshBsLive, the real one, run for the Live tab mid-countdown (it runs after
// every follow and every load of the captured tab).
(function () {
  var store = { captureStatus: { tabId: 11, title: 'Samsung Galaxy S26 v16.0', url: 'https://live.browserstack.com/dashboard#os=android', capturable: true, bsLive: true } };
  var winFollow = new Map([[5, { tabId: 11, capturable: true }]]);
  var chrome = { tabs: { get: function () { return Promise.resolve({ id: 11, title: '37 seconds to session timeout', url: 'https://live.browserstack.com/dashboard#os=android' }); } } };
  var ns = function () { return {
    get: function (k) { var o = {}; o[k] = store[k]; return Promise.resolve(o); },
    set: function (o) { for (var n in o) store[n] = o[n]; return Promise.resolve(); },
  }; };
  var persistWins = function () { return Promise.resolve(); };
  var injectBsLiveTap = function () { return Promise.resolve(); };
  eval(sliceBetween(WORKER, 'async function refreshBsLive(winId, tabId, tab) {', '\n// The window whose Browser Console mirrors this Live tab', 'worker refreshBsLive'));
  refreshBsLive(5, 11, null);
  drainMicrotasks();
  eq('refreshBsLive mid-countdown keeps the device\'s name', store.captureStatus.title + ':' + store.captureStatus.bsLive, 'Samsung Galaxy S26 v16.0:true');
})();


// ── a tab that is still loading when Selenite first looks at it ─────────────
// The follow runs 250 ms after a tab is activated; for a slow site tab.url is ''
// until the navigation commits (only pendingUrl is set), so the tab was recorded
// as not capturable, and nothing looked at it again when its page loaded: a Live
// tab Selenite opened never got its console mirror (found by the real-Chrome gate
// once the fake Live answered slowly, as the real one does).
section('worker: followedWinFor');
var FOLLOW_SRC = sliceBetween(WORKER, 'function followedWinFor(tabId) {', '\n}\n', 'worker followedWinFor') + '\n}';
function followWorld(mapped, records) {
  var tabToWin = new Map(mapped), winFollow = new Map(records);
  return new Function('tabToWin', 'winFollow', FOLLOW_SRC + '\nreturn followedWinFor;')(tabToWin, winFollow);
}
eq('a tab the debugger is attached to maps to its window', followWorld([[7, 5]], [[5, { tabId: 7, capturable: true, attached: true }]])(7), 5);
eq('a tab that was not capturable when first seen is found through the window that follows it', followWorld([], [[5, { tabId: 7, capturable: false, attached: false }]])(7), 5);
eq('one that is capturable but failed to attach is the attach\'s business, not this', followWorld([], [[5, { tabId: 7, capturable: true, attached: false }]])(7), null);
eq('a tab no window follows is nobody\'s', followWorld([], [[5, { tabId: 8, capturable: false }]])(7), null);
eq('with several windows only the one that follows the tab', followWorld([], [[5, { tabId: 8, capturable: false }], [6, { tabId: 7, capturable: false }]])(7), 6);
eq('the attached mapping wins when both exist', followWorld([[7, 5]], [[6, { tabId: 7, capturable: false }]])(7), 5);
eq('no records at all', followWorld([], [])(7), null);
// The handler that uses it is too big to run here; the real-Chrome gate (mirror-slow)
// is the behavioural test. This pins that the 'complete' branch still asks the helper.
ok("the 'complete' branch of tabs.onUpdated looks the window up through followedWinFor",
  /await restoreFollowState\(\);\n  const winId = followedWinFor\(tabId\);\n  \/\/ Re-runs capturability/.test(WORKER));

// ── worker: the bsDeviceState message ──────────────────────────────────────
// The real bsDeviceLog branch: device lines are labelled with the device, not
// with Live's idle countdown that has taken over the tab's title.
section('worker: the bsDeviceLog message during Live\'s idle countdown');
var DEVLOG_SRC = sliceBetween(WORKER, "  } else if (msg.action === 'bsDeviceLog') {", "  } else if (msg.action === 'bsDeviceState') {", 'worker bsDeviceLog branch');
function devLog(tabTitle, captureStatus, tabId) {
  var added = [];
  var fn = new Function('msg', 'sender', 'sendResponse', 'restoreFollowState', 'bsLiveWinFor', 'ns', 'bsDeviceEntry', 'TAGS', 'addBrowserConsoleLogs', 'if (false) {\n' + DEVLOG_SRC + '}');
  fn({ action: 'bsDeviceLog', lines: [{ source: 'console-api', level: 'info', type: 'log', text: '[cro] hello' }] },
    { tab: { id: tabId === undefined ? 11 : tabId, title: tabTitle } }, function () {}, function () { return Promise.resolve(); },
    function (id) { return id === 11 || id === 12 ? 5 : null; },
    function () { return { get: function () { return Promise.resolve({ captureStatus: captureStatus }); } }; },
    bsDeviceEntry, TAGS_,
    function (win, entries) { added = added.concat(entries); return Promise.resolve(); });
  drainMicrotasks();
  return added.map(function (e) { return e.device; }).join(',');
}
var S26 = { tabId: 11, title: 'Samsung Galaxy S26 v16.0' };
eq('a line is labelled with the tab\'s device title', devLog('Samsung Galaxy S26 v16.0', S26), 'Samsung Galaxy S26 v16.0');
eq('during the countdown, with the name the panel has for it', devLog('37 seconds to session timeout', S26), 'Samsung Galaxy S26 v16.0');
eq('with nothing to go on, the generic label', devLog('37 seconds to session timeout', undefined), 'BrowserStack device');
eq('  and not another tab\'s name', devLog('37 seconds to session timeout', S26, 12), 'BrowserStack device');
eq('a tab with no title, as before', devLog('', S26), 'BrowserStack device');
eq('a line from a tab whose title is its own address gets the stored name', devLog('live.browserstack.com/dashboard#os=android', S26), 'Samsung Galaxy S26 v16.0');

// The real branch of background.js's onMessage, sliced out: what the bridge
// forwards is stored as the window's bsDeviceStatus only for known states.
section('worker: the bsDeviceState message');
var DEVSTATE_SRC = sliceBetween(WORKER, "  } else if (msg.action === 'bsDeviceState') {", "  } else if (msg.action === 'bsWatchLaunch') {", 'worker bsDeviceState branch');
function devState(msg, tabId) {
  var store = {};
  var fn = new Function('msg', 'sender', 'sendResponse', 'restoreFollowState', 'bsLiveWinFor', 'ns', 'if (false) {\n' + DEVSTATE_SRC + '}');
  var done = false;
  fn(msg, { tab: { id: tabId === undefined ? 11 : tabId } }, function () { done = true; }, function () { return Promise.resolve(); },
    function (id) { return id === 11 ? 5 : null; },
    function () { return { set: function (o) { for (var k in o) store[k] = o[k]; return Promise.resolve(); } }; });
  drainMicrotasks();
  return { status: store.bsDeviceStatus, done: done };
}
eq('nopage is stored, with its page', JSON.stringify(devState({ action: 'bsDeviceState', state: 'nopage', version: 'realios 91.0.4472.101', page: 'blank' }).status), '{"state":"nopage","version":"realios 91.0.4472.101","tabId":11,"page":"blank"}');
eq('other is kept too', (devState({ action: 'bsDeviceState', state: 'nopage', page: 'other' }).status || {}).page, 'other');
ok('a page that is neither (a URL) is not stored', (function () { var st = devState({ action: 'bsDeviceState', state: 'nopage', page: 'https://x/?q=1' }).status; return !!st && !('page' in st); })());
eq('the earlier states still pass', ['connected', 'closed', 'unsupported', 'attaching', 'unavailable', 'failed'].map(function (s) { var r = devState({ action: 'bsDeviceState', state: s }); return r.status && r.status.state; }).join(','), 'connected,closed,unsupported,attaching,unavailable,failed');
eq('an unknown state is not stored', devState({ action: 'bsDeviceState', state: 'bogus' }).status, undefined);
eq('nor one from a tab that is not a followed Live tab', devState({ action: 'bsDeviceState', state: 'nopage', page: 'blank' }, 99).status, undefined);
ok('and it always answers', devState({ action: 'bsDeviceState', state: 'bogus' }).done);

// ── report ─────────────────────────────────────────────────────────────────
print('');
if (failures.length) {
  print('FAILURES:');
  failures.forEach(function (f) { print('  - ' + f); });
}
print('=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
