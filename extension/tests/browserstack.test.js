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

// ── report ─────────────────────────────────────────────────────────────────
print('');
if (failures.length) {
  print('FAILURES:');
  failures.forEach(function (f) { print('  - ' + f); });
}
print('=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
