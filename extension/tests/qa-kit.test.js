// qa-kit suite — part A of extension/qa-kit.js, the pure layer shared by the Test Agent modes that run on a live page
// (ITW Activation, Responsiveness): constants, URL helpers, masking, the analysis copies, rows, CSV and tables, the
// debug feed, run helpers.
//
//   RUN:  cd extension/tests && jsc qa-kit.test.js
//
// What these pin, and why each matters:
// - Every function that is a copy of a QA Pass original is byte-identical to it after the rename (parity), so a drift
//   of either side is loud.
// - qkBuildUrl strips optimizely_force_tracking and _conv_eforce whatever the case: either one registers a real
//   exposure on a live site.
// - qkMaskOutput leaves no query string, fragment, forcing flag or secret value in anything a mode writes out.
// - A table never renders a cell unescaped, and an image only when it is a JPEG data URL.

load('../metric-match.js');
load('../qa-pass.js');
load('../email-check.js');
var KIT_BEFORE = Object.keys(globalThis);
load('../qa-kit.js');
var KIT_NAMES = Object.keys(globalThis).filter(function (k) { return KIT_BEFORE.indexOf(k) === -1 && /^(qk|QK_)/.test(k); });

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

// ── exports ────────────────────────────────────────────────────────────────
section('exports');
var EXPECTED = [
  'QK_WIDTHS', 'QK_PHASE_WIDTH', 'QK_LOAD_TIMEOUT_MS', 'QK_SETTLE', 'QK_CLIP_MIN_PX', 'QK_TRACKING_PARAMS', 'QK_COMPANION_VALUE',
  'QK_QA_PARAM', 'QK_MAX_AUDIENCE_TESTS', 'QK_MAX_LOADS_KEPT', 'QK_ACTIVATION_POLLS', 'QK_ACTIVATION_POLL_MS',
  'QK_CLICK_NAV_WAIT_MS', 'QK_DEBUG_MAX_LINES', 'QK_CONDITIONAL_ACTIVATION', 'QK_MINUS', 'QK_STATUSES', 'QK_VERDICT_LABELS',
  'QK_REASON_PREFIXES', 'QK_COLUMNS', 'QK_SENSITIVE_KEY_RE', 'QK_VERDICT_COLORS',
  'qkDecode', 'qkKeyOf', 'qkSplitUrl', 'qkJoinUrl', 'qkIsTrackingKey', 'qkTrackingFlags', 'qkProdUrl', 'qkOptimizelyXIds',
  'qkForcedIds', 'qkPathOnly', 'qkAbsUrl', 'qkParseWidths', 'qkControlId', 'qkControlLink', 'qkEsc',
  'qkBuildUrl', 'qkIsPreviewUrl', 'qkOriginOf', 'qkResolve', 'qkCarryParams', 'qkLines',
  'qkMaskOutput', 'qkMaskDeep', 'qkCookieNames', 'qkKeyMatches', 'qkCleanPatterns',
  'qkNul', 'qkEscRe', 'qkCondLeaves', 'qkIsDecisive', 'qkDecisiveLeaves', 'qkExperimentList', 'qkExperimentById',
  'qkAudienceTests', 'qkExperimentActivation', 'qkAllocation', 'qkCompareFacts', 'qkStripQuery', 'qkHeightFor',
  'qkSeverity', 'qkSeverityRank', 'qkWidthOrder', 'qkOffenderKey', 'qkMinus', 'qkCut', 'qkUniq',
  'qkRow', 'qkVerdictLabel', 'qkVerdictText', 'qkCounts', 'qkCountsLine', 'qkBadge', 'qkSortRows',
  'qkCsvField', 'qkCellValue', 'qkCsv', 'qkFileName', 'qkTableHtml', 'qkResultsHtml', 'qkTilesHtmlFile',
  'qkDebugEntry', 'qkDebugPush', 'qkDebugMerge', 'qkDebugPad', 'qkDebugLineText', 'qkDebugText', 'qkDebugHtml', 'qkDebugSecs',
  'qkDebugLoadName', 'qkDebugLoadResult', 'qkDebugStateLine',
  'qkBase64', 'qkBase64Decode',
  'qkNewLoad', 'qkHaltError', 'qkIsHalt', 'qkIsStop', 'qkIsFatal', 'qkLoadInto', 'qkHaltIfBlocked', 'qkStateSummary',
  'qkFreshCount', 'qkFreshText', 'qkConsoleStart', 'qkConsoleEnd',
  'qkPageFactsFn', 'qkSettleFn', 'qkSnippetProbeFn', 'qkClipScanFn', 'qkTileMarkFn', 'qkExperimentStateFn', 'qkClickTargetFn',
  'qkClearedFn', 'qkStorageNamesFn', 'qkHygieneShim', 'QK_IGNORE_DEFAULTS',
];
jeq('the export list is exactly the expected list', KIT_NAMES.slice().sort(), EXPECTED.slice().sort());
EXPECTED.forEach(function (n) { ok('exported: ' + n, KIT_NAMES.indexOf(n) >= 0); });
ok('no export is a qp or ec name', KIT_NAMES.every(function (n) { return !/^(qp|QP_|ec|EC_)/.test(n); }));

// ── parity ─────────────────────────────────────────────────────────────────
section('parity with qa-pass.js');
function renamed(src) {
  return src.replace(/\bqp([A-Z])/g, 'qk$1').replace(/\bQP_/g, 'QK_');
}
// The source text of a top-level function of a file (two-space indent): from the word `function` to its closing line.
// Several of the originals are not exported by qa-pass.js, so they are read from the file.
function sourceOf(text, name) {
  var lines = text.split('\n'), i, start = -1;
  for (i = 0; i < lines.length; i++) { if (lines[i].indexOf('  function ' + name + '(') === 0) { start = i; break; } }
  if (start < 0) return null;
  var end = start;
  if (/\{$/.test(lines[start])) { end = start + 1; while (lines[end] !== '  }') end++; }
  return lines.slice(start, end + 1).join('\n').replace(/^ {2}/, '');
}
var QP_SRC = readFile('../qa-pass.js'), EC_SRC = readFile('../email-check.js');
var PARITY = ['Decode', 'KeyOf', 'SplitUrl', 'JoinUrl', 'IsTrackingKey', 'TrackingFlags', 'ProdUrl', 'OptimizelyXIds', 'ForcedIds',
  'PathOnly', 'AbsUrl', 'ParseWidths', 'ControlId', 'ControlLink', 'Esc',
  'Nul', 'EscRe', 'CondLeaves', 'IsDecisive', 'DecisiveLeaves', 'ExperimentList', 'ExperimentById', 'AudienceTests',
  'ExperimentActivation', 'Allocation', 'CompareFacts', 'StripQuery', 'HeightFor', 'Severity', 'SeverityRank', 'WidthOrder',
  'OffenderKey', 'Minus', 'Cut', 'Uniq',
  'DebugPush', 'DebugMerge', 'DebugPad', 'DebugLineText', 'DebugText', 'DebugHtml', 'DebugSecs'];
PARITY.forEach(function (n) {
  var q = sourceOf(QP_SRC, 'qp' + n), k = globalThis['qk' + n];
  ok('qp' + n + ' is found in qa-pass.js', typeof q === 'string');
  ok('qk' + n + ' exists', typeof k === 'function');
  if (typeof k === 'function' && typeof q === 'string') {
    ok('qk' + n + ' is qp' + n + ' renamed, byte for byte', k.toString() === renamed(q), { k: k.toString().slice(0, 120) });
  }
});
ok('qkDebugEntry is qpDebugEntry with qkMaskOutput in place of qpScrubUrls',
  qkDebugEntry.toString() === renamed(sourceOf(QP_SRC, 'qpDebugEntry').replace(/qpScrubUrls/g, 'qkMaskOutput')));
ok('qkBase64 is ecBase64 renamed', qkBase64.toString() === sourceOf(EC_SRC, 'ecBase64').replace(/\bec([A-Z])/g, 'qk$1'));
ok('qkBase64Decode is ecBase64Decode renamed', qkBase64Decode.toString() === sourceOf(EC_SRC, 'ecBase64Decode').replace(/\bec([A-Z])/g, 'qk$1'));
jeq('QK_WIDTHS = QP_WIDTHS', QK_WIDTHS, QP_WIDTHS);
eq('QK_PHASE_WIDTH', QK_PHASE_WIDTH, QP_PHASE_WIDTH);
eq('QK_LOAD_TIMEOUT_MS', QK_LOAD_TIMEOUT_MS, QP_LOAD_TIMEOUT_MS);
jeq('QK_SETTLE', QK_SETTLE, QP_SETTLE);
eq('QK_CLIP_MIN_PX', QK_CLIP_MIN_PX, QP_CLIP_MIN_PX);
jeq('QK_TRACKING_PARAMS', QK_TRACKING_PARAMS, QP_TRACKING_PARAMS);
eq('QK_COMPANION_VALUE', QK_COMPANION_VALUE, QP_COMPANION_VALUE);
eq('QK_MAX_AUDIENCE_TESTS', QK_MAX_AUDIENCE_TESTS, QP_MAX_AUDIENCE_TESTS);
eq('QK_DEBUG_MAX_LINES', QK_DEBUG_MAX_LINES, QP_DEBUG_MAX_LINES);

section('constants');
eq('18 widths', QK_WIDTHS.length, 18);
jeq('settle', QK_SETTLE, { firstWaitMs: 1200, pollMs: 250, maxPolls: 12, scrollWaitMs: 400, resizeWaitMs: 400 });
jeq('QA param', QK_QA_PARAM, ['cro_mode', 'qa']);
eq('loads kept 200', QK_MAX_LOADS_KEPT, 200);
eq('activation polls 10', QK_ACTIVATION_POLLS, 10);
eq('activation poll ms 500', QK_ACTIVATION_POLL_MS, 500);
eq('click nav wait 1200', QK_CLICK_NAV_WAIT_MS, 1200);
jeq('conditional activation types', QK_CONDITIONAL_ACTIVATION, ['callback', 'polling', 'manual', 'dom_changed', 'url_changed']);
eq('minus is U+2212', QK_MINUS, '−');
jeq('the five statuses', QK_STATUSES, ['passed', 'failed', 'in-progress', 'blocked', 'not-tested']);
jeq('verdict labels in sort order', QK_VERDICT_LABELS, ['Fail', 'Needs PGM', 'Needs Platform Access', 'Not Tested', 'Pass']);
eq('six reason prefixes', QK_REASON_PREFIXES.length, 6);
ok('every reason prefix ends in ": "', QK_REASON_PREFIXES.every(function (p) { return /: $/.test(p); }));
jeq('five columns', QK_COLUMNS.map(function (c) { return c.key; }), ['check', 'expected', 'observed', 'verdict', 'evidence']);
jeq('column labels', QK_COLUMNS.map(function (c) { return c.label; }), ['Check', 'Expected', 'Observed', 'Verdict', 'Evidence']);
ok('sensitive key regex hits token', QK_SENSITIVE_KEY_RE.test('access_token'));
ok('sensitive key regex misses cro_mode', !QK_SENSITIVE_KEY_RE.test('cro_mode'));
eq('five verdict colours', Object.keys(QK_VERDICT_COLORS).length, 5);
eq('Fail is red', QK_VERDICT_COLORS['Fail'], '#c62828');

// ── qkBuildUrl ─────────────────────────────────────────────────────────────
section('qkBuildUrl');
var bu = qkBuildUrl('https://a.com/p?optimizely_x=1&optimizely_force_tracking=true&_conv_eforce=1.2&cro_mode=qa', [['utm_source', 'meta']]);
ok('strips optimizely_force_tracking', bu.indexOf('optimizely_force_tracking') < 0, bu);
ok('strips _conv_eforce', bu.indexOf('_conv_eforce') < 0, bu);
ok('keeps cro_mode=qa', bu.indexOf('cro_mode=qa') >= 0, bu);
ok('keeps optimizely_x=1', bu.indexOf('optimizely_x=1') >= 0, bu);
ok('appends the set pair', /utm_source=meta$/.test(bu), bu);
eq('strips both in any case', qkBuildUrl('https://a.com/?OPTIMIZELY_FORCE_TRACKING=true&_CONV_EFORCE=1.2&q=1', []), 'https://a.com/?q=1');
eq('sets in place', qkBuildUrl('https://a.com/p?cro_mode=x&q=1', [['cro_mode', 'qa']]), 'https://a.com/p?cro_mode=qa&q=1');
eq('replaces case-insensitively without duplicating', qkBuildUrl('https://a.com/p?CRO_MODE=x&b=2', [['cro_mode', 'qa']]), 'https://a.com/p?CRO_MODE=qa&b=2');
eq('drop removes a key', qkBuildUrl('https://a.com/p?a=1&b=2', [], ['a']), 'https://a.com/p?b=2');
eq('drop is case-insensitive', qkBuildUrl('https://a.com/p?A=1&b=2&a=3', [], ['a']), 'https://a.com/p?b=2');
eq('drop runs before set', qkBuildUrl('https://a.com/p?a=1', [['a', '2']], ['a']), 'https://a.com/p?a=2');
eq('drop of an absent key changes nothing', qkBuildUrl('https://a.com/p?a=1', [], ['zzz']), 'https://a.com/p?a=1');
eq('an empty drop list changes nothing', qkBuildUrl('https://a.com/p?a=1', [], []), 'https://a.com/p?a=1');
eq('a non-http base builds nothing', qkBuildUrl('javascript:alert(1)', [['q', '1']]), '');
eq('a bare path builds nothing', qkBuildUrl('/shop', []), '');
eq('values are percent-encoded', qkBuildUrl('https://a.com/p', [['q', 'a b&c']]), 'https://a.com/p?q=a%20b%26c');
eq('the hash survives', qkBuildUrl('https://a.com/p#r', [['q', '1']]), 'https://a.com/p?q=1#r');
ok('no input smuggles a tracking flag',
  qkBuildUrl('https://a.com/?optimizely_force_tracking=true', [['q', '1']]).toLowerCase().indexOf('force') < 0
  && qkBuildUrl('https://a.com/?_conv_eforce=1.2', [['q', '1']]).toLowerCase().indexOf('eforce') < 0);

// ── new URL helpers ────────────────────────────────────────────────────────
section('qkIsPreviewUrl / qkOriginOf / qkResolve / qkCarryParams / qkLines');
eq('optimizely_x is a preview', qkIsPreviewUrl('https://a.com/p?optimizely_x=1'), true);
eq('optimizely_x1234 is a preview', qkIsPreviewUrl('https://a.com/p?optimizely_x1234=1'), true);
eq('optimizely_token is a preview', qkIsPreviewUrl('https://a.com/p?optimizely_token=abc'), true);
eq('_conv_eforce is a preview', qkIsPreviewUrl('https://a.com/p?_conv_eforce=1.2'), true);
eq('optimizely_force_tracking is a preview', qkIsPreviewUrl('https://a.com/p?optimizely_force_tracking=true'), true);
eq('a case-changed key is a preview', qkIsPreviewUrl('https://a.com/p?OPTIMIZELY_X=1'), true);
eq('a percent-encoded key is a preview', qkIsPreviewUrl('https://a.com/p?optimizely%5Fx=1'), true);
eq('cro_mode=qa is not', qkIsPreviewUrl('https://a.com/p?cro_mode=qa'), false);
eq('utm_source=x is not', qkIsPreviewUrl('https://a.com/p?utm_source=x'), false);
eq('a plain link is not', qkIsPreviewUrl('https://a.com/p'), false);
eq('junk is not', qkIsPreviewUrl('nonsense'), false);
eq('origin of a link', qkOriginOf('https://a.com:8080/p?x=1#h'), 'https://a.com:8080');
eq('origin of http', qkOriginOf('http://127.0.0.1:9000/x'), 'http://127.0.0.1:9000');
eq('origin of a path is empty', qkOriginOf('/p'), '');
eq('origin of null is empty', qkOriginOf(null), '');
eq('an http(s) address resolves as it is', qkResolve('https://b.example.org/x?y=1', 'https://a.com/'), 'https://b.example.org/x?y=1');
eq('a path resolves against the base origin', qkResolve('/shop/cart', 'https://a.com/p?q=1'), 'https://a.com/shop/cart');
eq('a relative word resolves to nothing', qkResolve('shop', 'https://a.com/'), '');
eq('a path with no usable base resolves to nothing', qkResolve('/x', 'nonsense'), '');
eq('empty resolves to nothing', qkResolve('', 'https://a.com/'), '');
eq('a path gets cro_mode=qa from the ITW', qkCarryParams('https://a.com/shop', 'https://a.com/?cro_mode=qa'), 'https://a.com/shop?cro_mode=qa');
eq('a carried link never gets optimizely_x', qkCarryParams('https://a.com/shop', 'https://a.com/?optimizely_x=5&cro_mode=qa'), 'https://a.com/shop?cro_mode=qa');
eq('nor optimizely_x1234 nor the token', qkCarryParams('https://a.com/s', 'https://a.com/?optimizely_x12=5&optimizely_token=t&k=v'), 'https://a.com/s?k=v');
eq('nor a tracking flag', qkCarryParams('https://a.com/s', 'https://a.com/?_conv_eforce=1.2&optimizely_force_tracking=true'), 'https://a.com/s');
eq('a key the link already has is not carried', qkCarryParams('https://a.com/s?CRO_MODE=x', 'https://a.com/?cro_mode=qa'), 'https://a.com/s?CRO_MODE=x');
eq('a link that is not http is returned as it is', qkCarryParams('nonsense', 'https://a.com/?k=v'), 'nonsense');
eq('a source that is not http carries nothing', qkCarryParams('https://a.com/s', 'nonsense'), 'https://a.com/s');
jeq('lines are trimmed, deduped, empties dropped', qkLines('  a \n\nb\na\n  \nc\r\n'), ['a', 'b', 'c']);
eq('at most 50 lines', qkLines(Array.apply(null, Array(80)).map(function (_, i) { return 'l' + i; }).join('\n')).length, 50);
eq('a line is cut at 500 characters', qkLines(new Array(700).join('x'))[0].length, 500);
jeq('null gives no lines', qkLines(null), []);

// ── masking ────────────────────────────────────────────────────────────────
section('qkMaskOutput / qkMaskDeep');
eq('null is empty', qkMaskOutput(null), '');
eq('undefined is empty', qkMaskOutput(undefined), '');
eq('a number is read as text', qkMaskOutput(12), '12');
eq('? & = are made fullwidth', qkMaskOutput('https://a.com/p?q=1&r=2'), 'https://a.com/p？q＝1＆r＝2');
eq('the fragment goes', qkMaskOutput('https://a.com/p#frag'), 'https://a.com/p');
eq('the fragment goes with a query', qkMaskOutput('https://a.com/p?q=1#frag'), 'https://a.com/p？q＝1');
eq('optimizely_force_tracking goes from a URL', qkMaskOutput('https://a.com/p?optimizely_force_tracking=true&q=1'), 'https://a.com/p？q＝1');
eq('_conv_eforce goes from a URL', qkMaskOutput('https://a.com/p?_conv_eforce=1.2'), 'https://a.com/p');
ok('a bare forcing pair goes', qkMaskOutput('saw optimizely_force_tracking=true here').indexOf('force') < 0);
ok('a bare _conv_eforce pair goes', qkMaskOutput('x _conv_eforce=1.2 y').indexOf('eforce') < 0);
eq('a sensitive value becomes …', qkMaskOutput('https://a.com/p?token=abc'), 'https://a.com/p？token＝…');
ok('password is masked', qkMaskOutput('https://a.com/p?password=hunter2').indexOf('hunter2') < 0);
ok('email is masked', qkMaskOutput('https://a.com/p?email=a@b.co').indexOf('a@b.co') < 0);
ok('session is masked', qkMaskOutput('https://a.com/p?sessionid=zz9').indexOf('zz9') < 0);
ok('a plain value is kept', qkMaskOutput('https://a.com/p?cro_mode=qa').indexOf('qa') >= 0);
eq('trailing punctuation stays', qkMaskOutput('see https://a.com/p?x=1.'), 'see https://a.com/p？x＝1.');
eq('a bare ? & = outside a URL is made fullwidth', qkMaskOutput('a=b&c?d'), 'a＝b＆c？d');
eq('plain text is unchanged', qkMaskOutput('The page loaded.'), 'The page loaded.');
var idem = [
  'https://a.com/p?q=1&token=abc#frag', 'x optimizely_force_tracking=true y', 'a=b&c=d', 'https://a.com/?_conv_eforce=1.2.',
  'plain', '', 'https://a.com/p?optimizely_x=1&optimizely_force_tracking=true&cro_mode=qa', '?&=', 'http://127.0.0.1:1/x?k=v)',
  'two https://a.com/a?x=1 and https://b.org/b?y=2#z', 'quote "https://a.com/p?x=1" end', 'https://a.com/p?sid=1&key=2&sig=3',
  'Chrome: Cannot access contents of url "https://a.com/p?optimizely_x=9&optimizely_force_tracking=true"', 'a?b', 'a&b', 'a=b',
  'https://a.com/p?=x&&y', 'https://a.com/p#a?b=c', 'token=abc', 'https://a.com/p?email=a%40b.co&phone=555', '…',
];
idem.forEach(function (s, i) { var once = qkMaskOutput(s); eq('idempotent on input ' + i, qkMaskOutput(once), once); });
ok('no masked output keeps an ASCII ? & =', idem.every(function (s) { return !/[?&=]/.test(qkMaskOutput(s)); }));
var deep = qkMaskDeep({ a: 'https://a.com/p?q=1', b: ['x=1', { c: 'y?z' }], n: 5, f: true, u: undefined, z: null });
eq('deep: a nested string is masked', deep.a, 'https://a.com/p？q＝1');
eq('deep: an array item is masked', deep.b[0], 'x＝1');
eq('deep: an object in an array is masked', deep.b[1].c, 'y？z');
eq('deep: a number is kept', deep.n, 5);
eq('deep: a boolean is kept', deep.f, true);
eq('deep: null is kept', deep.z, null);
ok('deep: undefined is left out', !('u' in deep));
var orig = { s: 'a=b' };
qkMaskDeep(orig);
eq('deep: the input is not changed', orig.s, 'a=b');
jeq('cookie names only, unique', qkCookieNames([{ name: 'a', value: 'secret' }, { name: 'a', value: 'x' }, 'b=val', { name: ' ' }, null]), ['a', 'b']);
ok('cookie names carry no value', JSON.stringify(qkCookieNames([{ name: 'a', value: 'secret' }])).indexOf('secret') < 0);
eq('cookie names are capped at 50', qkCookieNames(Array.apply(null, Array(80)).map(function (_, i) { return 'c' + i; })).length, 50);
jeq('cookie names of a non-list', qkCookieNames(null), []);
eq('a pattern matches exactly', qkKeyMatches('app_state', ['app_state']), true);
eq('an exact pattern is not a prefix', qkKeyMatches('app_state2', ['app_state']), false);
eq('a trailing * is a prefix', qkKeyMatches('app_state2', ['app_*']), true);
eq('no pattern matches', qkKeyMatches('other', ['app_*', 'x']), false);
eq('optimizely is not matched without a pattern', qkKeyMatches('optimizelyEndUserId', ['app_*']), false);
eq('an empty pattern matches nothing', qkKeyMatches('x', ['']), false);
eq('no patterns match nothing', qkKeyMatches('x', null), false);
jeq('an inner * is dropped, the last kept', qkCleanPatterns(['qk*_quiz*']), ['qk_quiz*']);
jeq('patterns are trimmed and empties dropped', qkCleanPatterns(['  k  ', '', '   ']), ['k']);
eq('25 patterns become 20', qkCleanPatterns(Array.apply(null, Array(25)).map(function (_, i) { return 'p' + i; })).length, 20);
eq('a pattern is cut at 100 characters', qkCleanPatterns([new Array(200).join('x')])[0].length, 100);
jeq('a non-list gives none', qkCleanPatterns('x'), []);
jeq('a lone * is dropped', qkCleanPatterns(['*']), []);
jeq('stars only are dropped', qkCleanPatterns(['**', ' * ']), []);
jeq('a prefix of 2 characters is dropped', qkCleanPatterns(['ab*', 'a*b*']), []);
jeq('a prefix of 3 characters is kept', qkCleanPatterns(['abc*']), ['abc*']);
jeq('a short exact name is kept', qkCleanPatterns(['ab']), ['ab']);
jeq('only the broad pattern goes', qkCleanPatterns(['*', 'qk_*']), ['qk_*']);
eq('a lone * matches nothing', qkKeyMatches('anything', ['*']), false);
eq('a 2-character prefix matches nothing', qkKeyMatches('ab_x', ['ab*']), false);
eq('a 3-character prefix matches', qkKeyMatches('qk_quiz_progress', ['qk_*']), true);

// ── rows ───────────────────────────────────────────────────────────────────
section('qkRow / verdict / counts / badge / sort');
var r1 = qkRow({ id: 'ia.1', step: 1, check: 'c', expected: 'e', observed: 'o', status: 'passed', evidence: 'ev', loads: ['L1'], extra: { w: 360 } });
jeq('the row has the twelve keys', Object.keys(r1), ['id', 'step', 'check', 'expected', 'observed', 'status', 'platform', 'evidence', 'emulated', 'loads', 'tile', 'extra']);
eq('a valid status is kept', r1.status, 'passed');
eq('platform defaults false', r1.platform, false);
eq('emulated defaults false', r1.emulated, false);
eq('tile defaults null', r1.tile, null);
jeq('extra is kept', r1.extra, { w: 360 });
jeq('loads are kept', r1.loads, ['L1']);
var r2 = qkRow({ id: 'x', check: new Array(400).join('c'), expected: new Array(400).join('e'), observed: new Array(800).join('o'), evidence: new Array(1500).join('v'), status: 'failed' });
eq('check capped at 160', r2.check.length, 160);
eq('expected capped at 240', r2.expected.length, 240);
eq('observed capped at 400', r2.observed.length, 400);
eq('evidence capped at 700', r2.evidence.length, 700);
var r3 = qkRow({ id: 'x', check: 'https://a.com/p?optimizely_force_tracking=true&q=1', observed: 'a=b', evidence: 'token', status: 'failed', extra: { u: 'https://a.com/?k=1' } });
ok('check is masked', r3.check.indexOf('force') < 0 && !/[?&=]/.test(r3.check));
ok('observed is masked', !/[?&=]/.test(r3.observed));
ok('extra is masked', !/[?&=]/.test(r3.extra.u));
var r4 = qkRow({ id: 'x', status: 'weird', evidence: 'something' });
eq('an unknown status becomes not-tested', r4.status, 'not-tested');
eq('and says why', r4.evidence, 'Not run: invalid status');
eq('a missing status becomes not-tested', qkRow({ id: 'x' }).status, 'not-tested');
eq('platform true is kept', qkRow({ id: 'x', status: 'not-tested', platform: true }).platform, true);
eq('a truthy non-true platform is not kept', qkRow({ id: 'x', status: 'not-tested', platform: 'yes' }).platform, false);
eq('a tile id is kept', qkRow({ id: 'x', status: 'failed', tile: 'T2' }).tile, 'T2');
eq('qkRow of nothing does not throw', qkRow().status, 'not-tested');
eq('passed is Pass', qkVerdictLabel({ status: 'passed' }), 'Pass');
eq('failed is Fail', qkVerdictLabel({ status: 'failed' }), 'Fail');
eq('in-progress is Needs PGM', qkVerdictLabel({ status: 'in-progress' }), 'Needs PGM');
eq('not-tested is Not Tested', qkVerdictLabel({ status: 'not-tested' }), 'Not Tested');
eq('not-tested with platform is Needs Platform Access', qkVerdictLabel({ status: 'not-tested', platform: true }), 'Needs Platform Access');
eq('blocked is Not Tested', qkVerdictLabel({ status: 'blocked' }), 'Not Tested');
eq('blocked with platform is still Not Tested', qkVerdictLabel({ status: 'blocked', platform: true }), 'Not Tested');
eq('passed with platform is still Pass', qkVerdictLabel({ status: 'passed', platform: true }), 'Pass');
eq('failed with platform is still Fail', qkVerdictLabel({ status: 'failed', platform: true }), 'Fail');
eq('in-progress with platform is still Needs PGM', qkVerdictLabel({ status: 'in-progress', platform: true }), 'Needs PGM');
eq('verdict text plain', qkVerdictText({ status: 'passed' }), 'Pass');
eq('verdict text emulated', qkVerdictText({ status: 'failed', emulated: true }), 'Fail (emulated)');
var mix = [{ status: 'passed' }, { status: 'failed' }, { status: 'in-progress' }, { status: 'not-tested', platform: true }, { status: 'not-tested' }, { status: 'blocked' }, { status: 'passed' }];
jeq('counts', qkCounts(mix), { fail: 1, pgm: 1, platform: 1, notTested: 2, pass: 2 });
jeq('counts of nothing', qkCounts(null), { fail: 0, pgm: 0, platform: 0, notTested: 0, pass: 0 });
eq('counts line', qkCountsLine({ fail: 1, pgm: 2, platform: 3, notTested: 4, pass: 5 }), '1 Fail · 5 Pass · 2 Needs PGM · 3 Needs Platform Access · 4 Not Tested');
jeq('a fail wins', qkBadge(mix, true, true), { kind: 'fail', label: 'ISSUES FOUND' });
jeq('halted comes next', qkBadge([{ status: 'passed' }], true, true), { kind: 'issues', label: 'HALTED: BOT CHECK' });
jeq('then stopped', qkBadge([{ status: 'passed' }], true, false), { kind: 'issues', label: 'INCOMPLETE' });
jeq('needs PGM is a review', qkBadge([{ status: 'passed' }, { status: 'in-progress' }], false, false), { kind: 'issues', label: 'NEEDS REVIEW' });
jeq('needs platform access is a review', qkBadge([{ status: 'not-tested', platform: true }], false, false), { kind: 'issues', label: 'NEEDS REVIEW' });
jeq('a blocked row is a review', qkBadge([{ status: 'passed' }, { status: 'blocked' }], false, false), { kind: 'issues', label: 'NEEDS REVIEW' });
jeq('all passes pass', qkBadge([{ status: 'passed' }, { status: 'passed' }], false, false), { kind: 'pass', label: 'PASS' });
jeq('a pass beside a not-tested row passes', qkBadge([{ status: 'passed' }, { status: 'not-tested' }], false, false), { kind: 'pass', label: 'PASS' });
jeq('only not-tested rows are inconclusive', qkBadge([{ status: 'not-tested' }], false, false), { kind: 'skip', label: 'INCONCLUSIVE' });
jeq('no rows are inconclusive', qkBadge([], false, false), { kind: 'skip', label: 'INCONCLUSIVE' });
var srt = qkSortRows([
  { id: 'a', status: 'passed' }, { id: 'b', status: 'not-tested' }, { id: 'c', status: 'failed' }, { id: 'd', status: 'in-progress' },
  { id: 'e', status: 'not-tested', platform: true }, { id: 'f', status: 'failed' }, { id: 'g', status: 'passed' }, { id: 'h', status: 'blocked' },
]);
jeq('sort order is Fail, PGM, Platform, Not Tested, Pass, stable', srt.map(function (r) { return r.id; }), ['c', 'f', 'd', 'e', 'b', 'h', 'a', 'g']);
var before = [{ id: 'p', status: 'passed' }, { id: 'q', status: 'failed' }];
qkSortRows(before);
eq('sorting does not change the input', before[0].id, 'p');

// ── CSV and HTML ───────────────────────────────────────────────────────────
section('qkCsvField / qkCsv / qkFileName');
eq('a formula is guarded', qkCsvField('=SUM(A1)'), '"\'=SUM(A1)"');
eq('+ is guarded', qkCsvField('+1'), '"\'+1"');
eq('@ is guarded', qkCsvField('@x'), '"\'@x"');
eq('a tab is guarded', qkCsvField('\tx'), '"\'\tx"');
eq('a CR is guarded', qkCsvField('\rx'), '"\'\rx"');
eq('-12 stays a number', qkCsvField('-12'), '"-12"');
eq('-1.5 stays a number', qkCsvField('-1.5'), '"-1.5"');
eq('-x is guarded', qkCsvField('-x'), '"\'-x"');
eq('a lone - is guarded', qkCsvField('-'), '"\'-"');
eq('a quote is doubled', qkCsvField('a"b'), '"a""b"');
eq('a comma stays inside the quotes', qkCsvField('a,b'), '"a,b"');
eq('null is an empty field', qkCsvField(null), '""');
eq('a number is a field', qkCsvField(7), '"7"');
var cols = QK_COLUMNS.concat([{ key: 'gapPx', label: 'Gap px' }, { key: 'tile', label: 'Tile' }]);
var csvRows = [
  qkRow({ id: 'a', check: 'Check A', expected: 'e', observed: 'o', status: 'failed', evidence: 'ev, with comma', emulated: true, tile: 'T1', extra: { gapPx: -12 } }),
  qkRow({ id: 'b', check: '=evil', expected: '', observed: '', status: 'passed', evidence: '' }),
];
var csv = qkCsv(cols, csvRows);
var lines = csv.split('\r\n');
eq('header row', lines[0], '"Check","Expected","Observed","Verdict","Evidence","Gap px","Tile"');
eq('three lines and the empty end', lines.length, 4);
eq('ends with CRLF', csv.slice(-2), '\r\n');
eq('the verdict cell is the label with (emulated)', lines[1].split(',')[3], '"Fail (emulated)"');
ok('a negative gap stays a number', lines[1].indexOf('"-12"') >= 0, lines[1]);
ok('the tile id is in the Tile column', /"T1"$/.test(lines[1]), lines[1]);
ok('an evidence comma stays in its field', lines[1].indexOf('"ev，') < 0 && lines[1].indexOf('"ev, with comma"') >= 0, lines[1]);
ok('a leading = never survives as a formula', lines[2].indexOf('"=') < 0, lines[2]);
ok('every CSV cell is masked', qkCsv(cols, [{ id: 'x', status: 'failed', check: 'https://a.com/?optimizely_force_tracking=true&q=1', expected: '', observed: '', evidence: '' }]).indexOf('force') < 0);
eq('CSV of no rows is the header and CRLF', qkCsv(QK_COLUMNS, []), '"Check","Expected","Observed","Verdict","Evidence"\r\n');
eq('cell value: verdict', qkCellValue({ status: 'failed', emulated: true }, 'verdict'), 'Fail (emulated)');
eq('cell value: check', qkCellValue({ check: 'c' }, 'check'), 'c');
eq('cell value: tile', qkCellValue({ tile: 'T3' }, 'tile'), 'T3');
eq('cell value: no tile', qkCellValue({}, 'tile'), '');
eq('cell value: extra', qkCellValue({ extra: { width: 360 } }, 'width'), 360);
eq('cell value: missing extra', qkCellValue({ extra: {} }, 'width'), '');
eq('cell value: no extra at all', qkCellValue({}, 'width'), '');
var ts = new Date(2026, 10, 5, 9, 7).getTime();
eq('file name', qkFileName('itw-activation', 'QK-12', ts, 'csv'), 'itw-activation-QK-12-20261105-0907.csv');
eq('key reduced', qkFileName('responsiveness', 'QK 12/../x', ts, 'html'), 'responsiveness-QK12..x-20261105-0907.html'.replace('..x', 'x'));
eq('an empty key is run', qkFileName('b', '', ts, 'csv'), 'b-run-20261105-0907.csv');
eq('a null key is run', qkFileName('b', null, ts, 'csv'), 'b-run-20261105-0907.csv');

section('qkTableHtml / qkResultsHtml / qkTilesHtmlFile');
var JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
var xrows = [
  qkRow({ id: 'a', check: '<script>alert(1)</script>', expected: 'x', observed: '"q" & <b>', status: 'failed', evidence: 'ev', tile: 'T1' }),
  qkRow({ id: 'b', check: 'ok one', status: 'passed', evidence: 'fine' }),
  qkRow({ id: 'c', check: 'needs', status: 'in-progress', evidence: 'p' }),
];
var th = qkTableHtml(QK_COLUMNS, xrows, { tiles: [{ id: 'T1', img: JPG }] });
ok('a cell is escaped', th.indexOf('<script>') < 0 && th.indexOf('&lt;script&gt;') >= 0, th);
ok('a quote and ampersand are escaped', th.indexOf('&quot;q&quot; \uff06 &lt;b&gt;') >= 0, th);
ok('the table class', th.indexOf('<table class="qk-table">') === 0, th.slice(0, 40));
ok('the head has the five labels', th.indexOf('<th>Check</th>') >= 0 && th.indexOf('<th>Evidence</th>') >= 0);
ok('the verdict cell is coloured', th.indexOf('<span style="color:#c62828;font-weight:700">Fail</span>') >= 0, th);
ok('a Pass is green', th.indexOf('<span style="color:#2e7d32;font-weight:700">Pass</span>') >= 0);
ok('a valid tile is shown', th.indexOf('<img class="qk-tile" alt="T1" src="' + JPG + '"') >= 0, th);
ok('only the tile row gets an image', th.split('<img').length === 2);
ok('a report table has the rpt-table class', qkTableHtml(QK_COLUMNS, xrows, { report: true }).indexOf('class="qk-table rpt-table"') >= 0);
ok('a javascript: tile src is dropped', qkTableHtml(QK_COLUMNS, xrows, { tiles: [{ id: 'T1', img: 'javascript:alert(1)' }] }).indexOf('<img') < 0);
ok('a png tile src is dropped', qkTableHtml(QK_COLUMNS, xrows, { tiles: [{ id: 'T1', img: 'data:image/png;base64,AAAA' }] }).indexOf('<img') < 0);
ok('a tile src with a quote is dropped', qkTableHtml(QK_COLUMNS, xrows, { tiles: [{ id: 'T1', img: 'data:image/jpeg;base64,AA" onerror="x' }] }).indexOf('<img') < 0);
ok('a tile that is not in opts.tiles shows no image', qkTableHtml(QK_COLUMNS, xrows, { tiles: [{ id: 'T9', img: JPG }] }).indexOf('<img') < 0);
ok('no opts.tiles shows no image', qkTableHtml(QK_COLUMNS, xrows, {}).indexOf('<img') < 0);
ok('a tiles map works too', qkTableHtml(QK_COLUMNS, xrows, { tiles: { T1: JPG } }).indexOf('<img') >= 0);
ok('the table masks a URL cell', qkTableHtml(QK_COLUMNS, [qkRow({ id: 'x', status: 'failed', check: 'https://a.com/?optimizely_force_tracking=true' })], {}).indexOf('force') < 0);
var rh = qkResultsHtml(QK_COLUMNS, xrows, {});
ok('the panel form is wrapped for horizontal scroll', rh.indexOf('<div style="overflow-x:auto">') === 0 && /<\/div>$/.test(rh));
ok('the passing rows are folded', rh.indexOf('<details><summary>Passing rows (1)</summary>') >= 0, rh);
ok('the Pass row is inside the details', rh.indexOf('ok one') > rh.indexOf('<details>'));
ok('the failing row is before the details', rh.indexOf('&lt;script&gt;') < rh.indexOf('<details>'));
ok('Fail comes before Needs PGM', rh.indexOf('Fail') < rh.indexOf('Needs PGM'));
var rr = qkResultsHtml(QK_COLUMNS, xrows, { report: true });
ok('the report form is one table', rr.indexOf('<table') === 0 && rr.split('<table').length === 2 && rr.indexOf('<details>') < 0);
ok('the report form keeps every row', rr.indexOf('ok one') >= 0 && rr.indexOf('needs') >= 0);
ok('the report form is sorted', rr.indexOf('Fail') < rr.indexOf('Needs PGM') && rr.indexOf('Needs PGM') < rr.indexOf('>Pass<'));
ok('all Pass: no empty failing table', qkResultsHtml(QK_COLUMNS, [qkRow({ id: 'p', status: 'passed' })], {}).split('<table').length === 2);
ok('no rows: one empty table, no details', qkResultsHtml(QK_COLUMNS, [], {}).indexOf('<details>') < 0);
var tf = qkTilesHtmlFile('Run <1>', [{ id: 'T1', target: 'v1 <x>', width: 360, gapPx: -12, side: 'right', text: 't', img: JPG }, { id: 'T2', target: 'v2', width: 375, gapPx: -3, img: 'javascript:x' }], [{ id: 'rs.v1.360.0', tile: 'T1' }, { id: 'rs.v1.360.1', tile: 'T1' }]);
ok('the file is an HTML document', tf.indexOf('<!doctype html>') === 0 && tf.indexOf('<meta charset="utf-8">') > 0);
ok('the title is escaped', tf.indexOf('<title>Run &lt;1&gt;</title>') > 0, tf);
ok('there is an h1', tf.indexOf('<h1>Run &lt;1&gt;</h1>') > 0);
ok('a figure per tile', tf.indexOf('<figure id="T1"') > 0 && tf.indexOf('<figure id="T2"') > 0);
ok('the caption says where and how far', tf.indexOf('T1 · v1 &lt;x&gt; · 360 px · gap −12 px · rows: rs.v1.360.0, rs.v1.360.1') > 0, tf);
ok('a valid image is shown', tf.indexOf('src="' + JPG + '"') > 0);
ok('an invalid image is dropped', tf.split('<img').length === 2 && tf.indexOf('javascript') < 0);
ok('qkTilesHtmlFile takes the tile list only: a map gives no figure and no throw', (function () { try { return qkTilesHtmlFile('t', { T1: JPG }, []).indexOf('<figure') < 0; } catch (e) { return false; } })());
ok('no raw < from a field', tf.indexOf('<x>') < 0);

// ── debug feed ─────────────────────────────────────────────────────────────
section('debug feed');
var de = qkDebugEntry('worker', 'warn', 'loaded https://a.com/p?optimizely_force_tracking=true&q=1#h', 5);
eq('entry time', de.t, 5);
eq('entry src', de.src, 'worker');
eq('entry level', de.level, 'warn');
ok('entry text is masked', de.text.indexOf('force') < 0 && !/[?&=#]/.test(de.text), de.text);
eq('an unknown source is panel', qkDebugEntry('x', 'info', 't', 1).src, 'panel');
eq('an unknown level is info', qkDebugEntry('panel', 'loud', 't', 1).level, 'info');
eq('a null text is empty', qkDebugEntry('panel', 'info', null, 1).text, '');
var feed = [];
for (var di = 0; di < QK_DEBUG_MAX_LINES + 20; di++) qkDebugPush(feed, qkDebugEntry('panel', 'info', 'l' + di, di));
eq('the feed is capped', feed.length, QK_DEBUG_MAX_LINES);
eq('the first line (the start) is kept', feed[0].text, 'l0');
eq('the newest line is kept', feed[feed.length - 1].text, 'l' + (QK_DEBUG_MAX_LINES + 19));
eq('merge orders by time, panel first on a tie', qkDebugMerge([{ t: 2, text: 'p2' }, { t: 1, text: 'p1' }], [{ t: 1, text: 'w1' }]).map(function (e) { return e.text; }).join(','), 'p1,w1,p2');
eq('secs', qkDebugSecs(1500), '1.5s');
ok('text has one line per entry', qkDebugText([{ t: 0, src: 'panel', level: 'info', text: 'a' }, { t: 1000, src: 'worker', level: 'warn', text: 'b' }]).split('\n').length === 2);
ok('html escapes', qkDebugHtml([{ t: 0, src: 'panel', level: 'info', text: '<b>' }]).indexOf('&lt;b&gt;') > 0);
var L0 = { id: 'L3', role: 'audience', label: 'ITW', width: 1440, path: 'https://a.com/p', keepState: false, ok: true, ms: 1234, settle: { stable: true, polls: 2 }, final: 'https://a.com/p', loadError: null, blocked: null };
eq('load name', qkDebugLoadName(L0), 'L3 audience · ITW · 1440px · https://a.com/p');
eq('load name keeps state', qkDebugLoadName(Object.assign({}, L0, { keepState: true })), 'L3 audience · ITW · 1440px · https://a.com/p · keeps state');
eq('load name with no address', qkDebugLoadName(Object.assign({}, L0, { path: '' })), 'L3 audience · ITW · 1440px · (no address)');
jeq('load result ok', qkDebugLoadResult(L0), { level: 'info', text: 'L3 loaded in 1.2s · settled after 2 poll(s)' });
eq('load result: a redirect says where', qkDebugLoadResult(Object.assign({}, L0, { final: 'https://www.a.com/p' })).text, 'L3 loaded in 1.2s · settled after 2 poll(s) · landed on https://www.a.com/p');
eq('load result: an error', qkDebugLoadResult(Object.assign({}, L0, { loadError: 'timeout' })).level, 'error');
eq('load result: a bot check', qkDebugLoadResult(Object.assign({}, L0, { blocked: { reason: 'bot-check', signal: 'cf' } })).text, 'L3 was stopped by a bot check (cf) after 1.2s');
eq('load result: not finished', qkDebugLoadResult(Object.assign({}, L0, { ok: false })).level, 'warn');
eq('load result: a Chrome error page', qkDebugLoadResult(Object.assign({}, L0, { final: 'chrome-error://chromewebdata/' })).level, 'error');
eq('load result: unsettled warns', qkDebugLoadResult(Object.assign({}, L0, { settle: { stable: false, polls: 12 } })).level, 'warn');
eq('load result: settle not read warns', qkDebugLoadResult(Object.assign({}, L0, { settle: null })).level, 'warn');
var st1 = qkStateSummary({ platform: 'optimizely', experimentId: '7001', isActive: true, variationName: 'Var A', variationId: '7101' }, []);
eq('state line: active', qkDebugStateLine('ITW', st1).text, 'ITW: optimizely · experiment 7001 active · serves Var A');
eq('state line: active is info', qkDebugStateLine('ITW', st1).level, 'info');
eq('state line: not active', qkDebugStateLine('ITW', qkStateSummary({ platform: 'optimizely', experimentId: '7001', isActive: false }, [])).text, 'ITW: optimizely · experiment 7001 NOT active · serves nothing');
eq('state line: unreadable warns', qkDebugStateLine('ITW', { readable: false, error: 'boom' }).level, 'warn');
ok('state line: unreadable names the error', qkDebugStateLine('ITW', { readable: false, error: 'boom' }).text.indexOf('boom') > 0);
eq('state line: nothing at all warns', qkDebugStateLine('ITW', null).level, 'warn');
var sb = qkStateSummary({ platform: 'optimizely', experimentId: '7001', isActive: false, variationId: '7102', variationName: 'Var B' }, []);
eq('state line: bucketed but not active names the bucket and serves nothing', qkDebugStateLine('ITW', sb).text, 'ITW: optimizely · experiment 7001 NOT active (bucketed only: Var B) · serves nothing');
eq('state line: bucketed is info', qkDebugStateLine('ITW', sb).level, 'info');
eq('state line: a bucket without a name shows its id', qkDebugStateLine('ITW', qkStateSummary({ platform: 'optimizely', experimentId: '7001', isActive: false, variationId: '7102' }, [])).text, 'ITW: optimizely · experiment 7001 NOT active (bucketed only: 7102) · serves nothing');

section('bytes');
eq('base64 of Man', qkBase64([77, 97, 110]), 'TWFu');
eq('base64 pads once', qkBase64([77, 97]), 'TWE=');
eq('base64 pads twice', qkBase64([77]), 'TQ==');
eq('base64 of nothing', qkBase64([]), '');
jeq('base64 decode', qkBase64Decode('TWFu'), [77, 97, 110]);
jeq('base64 decode tolerates missing padding', qkBase64Decode('TQ'), [77]);
eq('base64 decode of junk is null', qkBase64Decode('a$b'), null);
var bytes = []; for (var bi = 0; bi < 300; bi++) bytes.push((bi * 7) & 255);
jeq('base64 round-trips 300 bytes', qkBase64Decode(qkBase64(bytes)), bytes);

// ── run helpers ────────────────────────────────────────────────────────────
section('qkNewLoad / halt / qkLoadInto');
var nl = qkNewLoad({ role: 'baseline', label: 'ITW', url: 'https://a.com/p?optimizely_x=5&token=abc#h', width: 1440, keepState: false }, 3);
jeq('the load record has the 15 keys in order', Object.keys(nl), ['id', 'role', 'label', 'url', 'path', 'final', 'width', 'keepState', 'forced', 'ok', 'loadError', 'blocked', 'ms', 'settle', 'cleared']);
eq('load id', nl.id, 'L3');
eq('load path is origin and path', nl.path, 'https://a.com/p');
ok('load url is masked', !/[?&=#]/.test(nl.url) && nl.url.indexOf('abc') < 0, nl.url);
eq('forced when optimizely_x is present', nl.forced, true);
eq('not forced without it', qkNewLoad({ url: 'https://a.com/p?cro_mode=qa' }, 1).forced, false);
eq('final starts null', nl.final, null);
eq('ok starts false', nl.ok, false);
eq('blocked starts null', nl.blocked, null);
eq('cleared starts null', nl.cleared, null);
eq('keepState is a boolean', qkNewLoad({ url: 'https://a.com/', keepState: 1 }, 1).keepState, true);
eq('a non-http url has no path', qkNewLoad({ url: 'nonsense' }, 1).path, '');
var he = qkHaltError({ id: 'L4', path: 'https://a.com/p', blocked: { reason: 'bot-check', signal: 'cf-challenge' } });
eq('a halt error is an Error', he instanceof Error, true);
eq('it carries qkHalt', he.qkHalt, true);
jeq('it carries what rec.halted keeps', he.halted, { loadId: 'L4', path: 'https://a.com/p', signal: 'cf-challenge' });
eq('qkIsHalt', qkIsHalt(he), true);
eq('qkIsHalt on a plain error', qkIsHalt(new Error('x')), false);
eq('qkIsHalt on null', qkIsHalt(null), false);
eq('qkIsStop', qkIsStop({ qkStop: true }), true);
eq('qkIsStop on a halt', qkIsStop(he), false);
eq('qkIsFatal', qkIsFatal(Object.assign(new Error('x'), { qkFatal: true })), true);
eq('qkIsFatal on a plain error', qkIsFatal(new Error('x')), false);
eq('a halt from a click result takes its final path', qkHaltError({ blocked: { signal: 's' }, final: 'https://a.com/q?x=1' }).halted.path, 'https://a.com/q');
eq('qkHaltIfBlocked passes a clean click through', qkHaltIfBlocked({ ok: true }).ok, true);
var thrown = null;
try { qkHaltIfBlocked({ blocked: { signal: 'x' }, final: 'https://a.com/' }); } catch (e) { thrown = e; }
ok('qkHaltIfBlocked throws on a block', qkIsHalt(thrown));
eq('qkHaltIfBlocked on null is null', qkHaltIfBlocked(null), null);

var loadLog = [];
var fakeIo = { load: function (spec) { loadLog.push(spec.url); return Promise.resolve(Object.assign(qkNewLoad(spec, loadLog.length), { ok: true, blocked: spec.bot ? { reason: 'bot-check', signal: 'cf' } : null })); } };
var rec = { loads: [] };
var res = null, err = null;
qkLoadInto(fakeIo, rec, { url: 'https://a.com/1', role: 'r', label: 'l', width: 1440 }).then(function (L) { res = L; }, function (e) { err = e; });
drainMicrotasks();
eq('qkLoadInto returns the load', res && res.id, 'L1');
eq('and records it', rec.loads.length, 1);
eq('without an error', err, null);
var res2 = null, err2 = null;
qkLoadInto(fakeIo, rec, { url: 'https://a.com/2', bot: true }).then(function (L) { res2 = L; }, function (e) { err2 = e; });
drainMicrotasks();
eq('a bot page still records the load', rec.loads.length, 2);
ok('and halts the run', qkIsHalt(err2));
eq('the halt names the load', err2 && err2.halted.loadId, 'L2');
var capRec = { loads: [] };
for (var ci = 0; ci < QK_MAX_LOADS_KEPT; ci++) capRec.loads.push({ id: 'x' });
var capErr = null;
qkLoadInto(fakeIo, capRec, { url: 'https://a.com/3' }).then(function () {}, function (e) { capErr = e; });
drainMicrotasks();
eq('loads kept stop at the cap', capRec.loads.length, QK_MAX_LOADS_KEPT);
eq('a capped load still returns', capErr, null);
var noArr = {};
qkLoadInto(fakeIo, noArr, { url: 'https://a.com/4' }).then(function () {}, function () {});
drainMicrotasks();
eq('a record with no loads list gets one', Array.isArray(noArr.loads) && noArr.loads.length === 1, true);

section('qkStateSummary');
jeq('null', qkStateSummary(null, []), { readable: false, error: 'no result (the page script failed)' });
jeq('undefined', qkStateSummary(undefined, []), { readable: false, error: 'no result (the page script failed)' });
jeq('an error is masked', qkStateSummary({ error: 'bad https://a.com/?x=1' }, []), { readable: false, error: 'bad https://a.com/？x＝1' });
jeq('no platform', qkStateSummary({ ok: true, platform: null }, []), { readable: true, platform: null, activated: false, activeIds: [] });
var raw1 = { ok: true, platform: 'optimizely', experimentId: '7001', source: 'given', inData: true, inState: true, isActive: true, variationId: '7101', variationName: 'Var A', reason: 'ok', pageIds: ['7201'], pageTypes: ['callback'], variationIds: ['7100', '7101'], activeIds: ['7001'] };
var s1 = qkStateSummary(raw1, ['7101']);
eq('platform', s1.platform, 'optimizely');
eq('readable', s1.readable, true);
eq('experiment id', s1.experimentId, '7001');
eq('id source', s1.experimentIdSource, 'given');
eq('in snippet', s1.inSnippet, true);
eq('in state', s1.inState, true);
eq('activated', s1.activated, true);
eq('variation id', s1.variationId, '7101');
eq('variation name', s1.variationName, 'Var A');
eq('a conditional page gives its type', s1.activationType, 'callback');
eq('conditional', s1.conditional, true);
eq('page id', s1.pageId, '7201');
jeq('page ids', s1.pageIds, ['7201']);
jeq('variation ids', s1.variationIds, ['7100', '7101']);
jeq('active ids', s1.activeIds, ['7001']);
eq('served forced is true', s1.servedForced, true);
eq('served forced is false for another variation', qkStateSummary(raw1, ['7100']).servedForced, false);
eq('served forced is null with none given', qkStateSummary(raw1, []).servedForced, null);
eq('served forced is null with no list', qkStateSummary(raw1).servedForced, null);
eq('served forced is false when not active', qkStateSummary(Object.assign({}, raw1, { isActive: false }), ['7101']).servedForced, false);
var imm = qkStateSummary(Object.assign({}, raw1, { pageTypes: ['immediate'] }), []);
eq('an immediate page', imm.activationType, 'immediate');
eq('an immediate page is not conditional', imm.conditional, false);
eq('a page whose type is a non-listed word is immediate', qkStateSummary(Object.assign({}, raw1, { pageTypes: ['onload'] }), []).activationType, 'immediate');
var mixedTypes = qkStateSummary(Object.assign({}, raw1, { pageTypes: ['immediate', 'polling'] }), []);
eq('a mixed set takes the conditional type', mixedTypes.activationType, 'polling');
eq('and is conditional', mixedTypes.conditional, true);
var nop = qkStateSummary(Object.assign({}, raw1, { pageIds: [], pageTypes: [] }), []);
eq('no pages: no activation type', nop.activationType, null);
eq('no pages: conditional unknown', nop.conditional, null);
eq('no pages: no page id', nop.pageId, null);
var unk = qkStateSummary(Object.assign({}, raw1, { pageTypes: [null] }), []);
eq('an unknown page type: no activation type', unk.activationType, null);
eq('an unknown page type: conditional unknown', unk.conditional, null);
eq('not active is not activated', qkStateSummary(Object.assign({}, raw1, { isActive: false }), []).activated, false);
eq('a null isActive is not activated', qkStateSummary(Object.assign({}, raw1, { isActive: null }), []).activated, false);
eq('a bucket is not activation', qkStateSummary({ platform: 'optimizely', experimentId: '7001', isActive: false, variationId: '7101', variationName: 'Var A', inState: true }, []).activated, false);
eq('a reason is masked', qkStateSummary(Object.assign({}, raw1, { reason: 'a=b' }), []).reason, 'a＝b');
eq('a null reason stays null', qkStateSummary(Object.assign({}, raw1, { reason: null }), []).reason, null);
eq('the summary of a platform page has the 18 keys', Object.keys(s1).length, 18);

section('fresh visitors / console lines');
eq('fresh count: neither keepState nor forced', qkFreshCount([{ keepState: false, forced: false }, { keepState: true, forced: false }, { keepState: false, forced: true }, { keepState: false, forced: false }]), 2);
eq('fresh count of nothing', qkFreshCount(null), 0);
eq('fresh text', qkFreshText(3), 'Fresh visitors: 3 load(s) of the live site as a new visitor (Selenite clears the Optimizely cookies before each).');
var crec = { ticketKey: 'QK-7', input: { sources: { itwUrl: 'ticket', experimentId: 'ticket', controlUrl: 'typed', activation: 'none', subPages: 'derived' } }, startedAt: 1000, finishedAt: 4250, rows: [{ status: 'passed' }, { status: 'failed' }], halted: null, error: null, stopped: false };
jeq('console start', qkConsoleStart('ITW Activation', crec), { level: 'INFO', text: '[ITW Activation] Run started · ticket QK-7 · 2 input(s) from the ticket, 1 typed' });
eq('console start without a ticket', qkConsoleStart('X', { input: { sources: {} } }).text, '[X] Run started · ticket none · 0 input(s) from the ticket, 0 typed');
eq('console start without an input', qkConsoleStart('X', {}).text, '[X] Run started · ticket none · 0 input(s) from the ticket, 0 typed');
jeq('console end: finished', qkConsoleEnd('ITW Activation', crec), { level: 'INFO', text: '[ITW Activation] Run finished in 3.3s · 1 Fail · 1 Pass · 0 Needs PGM · 0 Needs Platform Access · 0 Not Tested' });
var cs = qkConsoleEnd('X', Object.assign({}, crec, { stopped: true }));
eq('console end: stopped level', cs.level, 'WARNING');
ok('console end: stopped text', cs.text.indexOf('Run stopped by the tester in 3.3s · ') > 0, cs.text);
var ch = qkConsoleEnd('X', Object.assign({}, crec, { halted: { loadId: 'L2', path: 'https://a.com/p', signal: 'cf' } }));
eq('console end: halted level', ch.level, 'WARNING');
ok('console end: halted names the path', ch.text.indexOf('Run halted by a bot check on https://a.com/p in 3.3s · ') > 0, ch.text);
var ce = qkConsoleEnd('X', Object.assign({}, crec, { error: 'boom' }));
eq('console end: error level', ce.level, 'ERROR');
ok('console end: error says the seconds', ce.text.indexOf('Run ended on an error in 3.3s · ') > 0, ce.text);
eq('console end: seconds have one decimal', qkConsoleEnd('X', Object.assign({}, crec, { error: 'e', finishedAt: 2000 })).text.indexOf('in 1.0s') > 0, true);
ok('console end: a halt wins over a stop', qkConsoleEnd('X', Object.assign({}, crec, { stopped: true, halted: { path: 'https://a.com/' } })).text.indexOf('halted') > 0);
ok('console lines are masked', qkConsoleStart('X', { ticketKey: 'a=b' }).text.indexOf('=') < 0);

// ── page functions and the hygiene shim (part B) ───────────────────────────
section('page functions: parity');
function qpToQk(s) { return s.replace(/\bqp([A-Z])/g, 'qk$1').replace(/\bQP_/g, 'QK_'); }
[['qkPageFactsFn', 'qpPageFactsFn'], ['qkSettleFn', 'qpSettleFn'], ['qkSnippetProbeFn', 'qpSnippetProbeFn']].forEach(function (pr) {
  ok('parity: ' + pr[0], globalThis[pr[0]].toString() === qpToQk(globalThis[pr[1]].toString()));
});
ok('the settle copy keeps its __qp_freeze id', qkSettleFn.toString().indexOf("'__qp_freeze'") > 0);
// The clip scan is the original plus exactly the three edits of A.5.
var clipOrig = qpToQk(qpClipScanFn.toString());
var igLine = clipOrig.match(/^      var IGNORE = '[^']*';\n/m);
ok('the original IGNORE line is found', !!igLine);
var clipExpected = clipOrig.replace(igLine[0], igLine[0]
  + '      var ignoreInvalid = [];\n'
  + '      if (Array.isArray(opts.ignoreList)) {\n'
  + '        var okSel = [];\n'
  + '        for (var q = 0; q < opts.ignoreList.length; q++) {\n'
  + "          var s0 = String(opts.ignoreList[q] || '').trim();\n"
  + '          if (!s0) continue;\n'
  + '          try { document.documentElement.matches(s0); okSel.push(s0); } catch (_) { ignoreInvalid.push(s0.slice(0, 120)); }\n'
  + '        }\n'
  + "        IGNORE = okSel.join(',');\n"
  + '      }\n');
var e2old = '        if (el.closest(IGNORE)) { ignored.carousel++; continue; }';
ok('edit 2 anchor occurs once', clipExpected.split(e2old).length === 2);
clipExpected = clipExpected.replace(e2old, '        if (IGNORE && el.closest(IGNORE)) { ignored.carousel++; continue; }');
var e3old = 'offenders: offenders.slice(0, 25), ignored: ignored, ms:';
ok('edit 3 anchor occurs once', clipExpected.split(e3old).length === 2);
clipExpected = clipExpected.replace(e3old, 'offenders: offenders.slice(0, 25), ignored: ignored, ignoreInvalid: ignoreInvalid, ms:');
ok('qkClipScanFn is qpClipScanFn plus the three A.5 edits', qkClipScanFn.toString() === clipExpected);
var igSrc = qpClipScanFn.toString().match(/var IGNORE = '([^']*)'/)[1];
eq('QK_IGNORE_DEFAULTS joins to the original IGNORE literal', QK_IGNORE_DEFAULTS.join(','), igSrc);
eq('there are 16 default ignore selectors', QK_IGNORE_DEFAULTS.length, 16);
ok('QK_IGNORE_DEFAULTS is an array of strings', Array.isArray(QK_IGNORE_DEFAULTS) && QK_IGNORE_DEFAULTS.every(function (s) { return typeof s === 'string'; }));

// A harness that evaluates a page function with ONLY the fakes it is given in scope: any other free name throws a
// ReferenceError (a with-scope Proxy), so a reference to anything outside the function's own body is caught.
var PAGE_ALLOW = ['Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Promise', 'Map', 'Set', 'Date', 'RegExp', 'Error',
  'undefined', 'NaN', 'Infinity', 'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent', 'decodeURIComponent'];
var pageLeaks = [];
function pageFn(fn, fakes) {
  var scope = new Proxy({}, {
    has: function (t, k) { return typeof k === 'string'; },
    get: function (t, k) {
      if (typeof k !== 'string') return undefined;
      if (fakes && Object.prototype.hasOwnProperty.call(fakes, k)) return fakes[k];
      if (PAGE_ALLOW.indexOf(k) >= 0) return globalThis[k];
      pageLeaks.push(k);
      throw new ReferenceError('page function reached outside its body: ' + k);
    },
  });
  return new Function('__s', 'with (__s) { return (' + fn.toString() + '); }')(scope);
}
function throwing(name) { var o = {}; Object.defineProperty(o, name, { get: function () { throw new Error('boom ' + name); } }); return o; }
function throwAll() {
  return new Proxy({}, { get: function (t, k) { if (typeof k === 'string') throw new Error('boom ' + k); return undefined; }, set: function () { throw new Error('boom set'); } });
}

section('page functions: self-containment and failure as a value');
var PAGE_FNS = [qkPageFactsFn, qkSettleFn, qkSnippetProbeFn, qkClipScanFn, qkTileMarkFn, qkExperimentStateFn, qkClickTargetFn, qkClearedFn, qkStorageNamesFn];
PAGE_FNS.forEach(function (fn) {
  var failures0 = fail;
  var res, err = null;
  try {
    // Everything throws: the function must return {error}/{ok:false}, never throw and never reach outside itself.
    var f = pageFn(fn, { window: throwAll(), document: throwAll(), location: throwAll(), localStorage: throwAll(), sessionStorage: throwAll(),
      NodeFilter: { SHOW_TEXT: 4 }, performance: throwAll(), getComputedStyle: function () { throw new Error('boom'); }, setTimeout: function (g) { g(); } });
    res = f('a', 1);
  } catch (e) { err = e; }
  var done = false, val;
  if (res && typeof res.then === 'function') { res.then(function (v) { val = v; done = true; }, function (e) { err = e; done = true; }); drainMicrotasks(); } else { val = res; done = true; }
  ok(fn.name + ': does not throw and does not reach outside itself', !err, String(err));
  ok(fn.name + ': resolves', done);
  if (fn === qkStorageNamesFn) {
    jeq(fn.name + ': every access throwing gives empty name lists', val, { local: [], session: [], cookies: [] });
  } else {
    ok(fn.name + ': returns a failure as a value', val && (typeof val.error === 'string' || val.ok === false), val);
  }
});
// qkClearedFn alone (it reads only window): a throwing window.
(function () {
  var f = pageFn(qkClearedFn, { window: throwing('__qkCleared') });
  ok('qkClearedFn: window throwing gives {error}', typeof f().error === 'string');
})();

section('qkExperimentStateFn');
function fakeOptimizely(o) {
  o = o || {};
  var data = o.data || {
    experiments: [{ id: '7001', layerId: '7500', variations: [{ id: '7101', name: 'Original' }, { id: '7102', name: 'Var A' }] },
      { id: '7002', variations: [{ id: '7201', name: 'Other' }] }],
    campaigns: [{ id: '7500', experimentIds: ['7001'], pageIds: ['P1'] }],
    pages: { P1: { id: 'P1', activationType: 'callback' } },
  };
  var states = o.states === undefined ? { '7001': { isActive: true, variation: { id: '7102', name: 'Var A' }, reason: 'bucketed' } } : o.states;
  var active = o.active === undefined ? ['7001'] : o.active;
  return {
    get: function (k) {
      if (k === 'data') return data;
      if (k === 'state') return o.noState ? null : { getExperimentStates: function () { return states; }, getActiveExperimentIds: function () { return active; } };
      return undefined;
    },
  };
}
function readState(args, o) { return pageFn(qkExperimentStateFn, { window: { optimizely: fakeOptimizely(o) } })(args); }
var s1 = readState({ experimentId: '7001' });
eq('state: platform optimizely', s1.platform, 'optimizely');
eq('state: the given id is used', s1.experimentId, '7001');
eq('state: source given', s1.source, 'given');
eq('state: in data', s1.inData, true);
eq('state: in state', s1.inState, true);
eq('state: active', s1.isActive, true);
eq('state: variation name', s1.variationName, 'Var A');
eq('state: variation id', s1.variationId, '7102');
jeq('state: variation ids from the definition', s1.variationIds, ['7101', '7102']);
jeq('state: page ids through the campaign', s1.pageIds, ['P1']);
jeq('state: page types', s1.pageTypes, ['callback']);
jeq('state: active ids', s1.activeIds, ['7001']);
var s2 = readState({ forcedIds: ['7102'] });
eq('state: derived by a forced variation id', s2.experimentId, '7001');
eq('state: source forced-variation', s2.source, 'forced-variation');
var s2b = readState({ forcedIds: ['9999'] });
eq('state: an unknown forced id derives nothing', s2b.experimentId, null);
var s3 = readState({ experimentId: '7001' }, { states: { '7001': { isActive: false, variation: null } }, active: [] });
eq('state: a null variation does not throw', s3.ok, true);
eq('state: a null variation has no name', s3.variationName, null);
eq('state: a null variation has no id', s3.variationId, null);
eq('state: not active', s3.isActive, false);
var s4 = readState({ experimentId: '7001' }, { states: {}, active: ['7001'] });
eq('state: getActiveExperimentIds alone makes it active', s4.isActive, true);
eq('state: and it is not in the state list', s4.inState, false);
var s5 = readState({ experimentId: '7001' }, { states: {}, active: [] });
eq('state: in the snippet but never evaluated is not active', s5.isActive, false);
var s5b = readState({ experimentId: '7777' }, { states: {}, active: [] });
eq('state: an experiment not in the snippet has no verdict', s5b.isActive, null);
eq('state: and is not in data', s5b.inData, false);
var arrPages = { experiments: [{ id: '7001', layerId: '7500', variations: [] }], campaigns: [{ id: '7500', experimentIds: ['7001'], pageIds: ['P1', 'P2'] }],
  pages: [{ id: 'P1', activationType: 'polling' }, { id: 'P2', activationType: null }] };
var s6 = readState({ experimentId: '7001' }, { data: arrPages });
jeq('state: pages as an array, types', s6.pageTypes, ['polling', 'immediate']);
jeq('state: pages as an array, ids', s6.pageIds, ['P1', 'P2']);
var objPages = { experiments: { a: { id: '7001', variations: {} } }, campaigns: { c: { id: '7500', experimentIds: ['7001'], pageIds: ['P1'] } }, pages: { P1: { id: 'P1', activationType: null } } };
var s7 = readState({ experimentId: '7001' }, { data: objPages });
jeq('state: a page activationType null is immediate', s7.pageTypes, ['immediate']);
eq('state: experiments given as an object are read', s7.inData, true);
var s8 = readState({ experimentId: '7001' }, { noState: true });
eq('state: a missing state API does not throw', s8.ok, true);
var s9 = pageFn(qkExperimentStateFn, { window: {} })({ experimentId: '7001' });
jeq('state: optimizely missing', s9, { ok: true, platform: null });
var s10 = pageFn(qkExperimentStateFn, { window: { optimizely: { get: function () { throw new Error('nope'); } } } })({ experimentId: '7001' });
eq('state: get() throwing is recorded, not thrown', s10.ok, true);
ok('state: the errors are listed', s10.errors.length >= 1, s10.errors);
eq('state: no argument at all does not throw', pageFn(qkExperimentStateFn, { window: { optimizely: fakeOptimizely() } })().experimentId, null);
// the summary of a real read
var sum = qkStateSummary(s1, ['7102']);
eq('summary of the read: activated', sum.activated, true);
eq('summary of the read: forced variation served', sum.servedForced, true);
eq('summary of the read: conditional page', sum.conditional, true);
eq('summary of the read: activation type', sum.activationType, 'callback');

section('qkClickTargetFn');
function mkEl(o) {
  o = o || {};
  var el = {
    tagName: o.tag || 'BUTTON', id: o.id || '', className: o.cls || '', innerText: o.text === undefined ? 'Open' : o.text, value: o.value, scrolled: 0,
    getBoundingClientRect: function () { return o.rect || { left: 100, top: 100, width: 100, height: 40 }; },
    checkVisibility: function () { return o.hidden ? false : true; },
    getAttribute: function (n) { return n === 'aria-label' ? (o.aria || null) : null; },
    scrollIntoView: function () { el.scrolled++; },
    contains: function (x) { return x === el || (o.kids || []).indexOf(x) >= 0; },
    closest: function () { return o.link || null; },
  };
  return el;
}
function clickIn(sel, list, hit, loc) {
  var doc = {
    querySelectorAll: function (s) { if (s === 'bad[') throw new Error('is not a valid selector'); return list; },
    elementFromPoint: hit,
  };
  return pageFn(qkClickTargetFn, { document: doc, window: { innerWidth: 1440, innerHeight: 900 }, location: loc || { origin: 'https://shop.example' } })(sel);
}
var tgt = mkEl({ id: 'go', text: 'Open menu' });
var over = mkEl({ tag: 'DIV', cls: 'overlay big' });
var c0 = clickIn('#none', [], function () { return null; });
jeq('click: not found', [c0.ok, c0.reason, c0.matches], [false, 'not-found', 0]);
var c1 = clickIn('bad[', [], function () { return null; });
jeq('click: a bad selector', [c1.ok, c1.reason], [false, 'bad-selector']);
ok('click: a bad selector carries the message', c1.error.indexOf('not a valid selector') >= 0, c1);
var c2 = clickIn('#go', [mkEl({ rect: { left: 0, top: 0, width: 0, height: 0 } })], function () { return null; });
jeq('click: not visible (zero box)', [c2.ok, c2.reason], [false, 'not-visible']);
var c2b = clickIn('#go', [mkEl({ hidden: true })], function () { return null; });
jeq('click: not visible (checkVisibility false)', [c2b.ok, c2b.reason], [false, 'not-visible']);
var c3 = clickIn('#go', [tgt], function () { return over; });
jeq('click: covered at all five points', [c3.ok, c3.reason, c3.coveredBy], [false, 'covered', 'div.overlay.big']);
ok('click: covered returns no coordinates', !('x' in c3) && !('y' in c3), c3);
var pts = [];
clickIn('#go', [tgt], function (x, y) { pts.push([x, y]); return over; });
jeq('click: the five points tested are the centre then the four quarter points', pts, [[150, 120], [125, 110], [175, 110], [125, 130], [175, 130]]);
var c4 = clickIn('#go', [tgt], function (x, y) { return x === 125 && y === 110 ? tgt : over; });
jeq('click: the centre covered but a corner free: that corner', [c4.ok, c4.x, c4.y], [true, 125, 110]);
var kid = mkEl({ tag: 'SPAN' });
var withKid = mkEl({ id: 'go2', kids: [kid] });
var c5 = clickIn('#go2', [withKid], function () { return kid; });
jeq('click: a hit inside the target counts', [c5.ok, c5.x, c5.y], [true, 150, 120]);
var c6 = clickIn('#go', [tgt], function () { return tgt; });
jeq('click: ok at the centre', [c6.ok, c6.x, c6.y, c6.matches, c6.label], [true, 150, 120, 1, 'button#go']);
jeq('click: the rect is returned', c6.rect, { x: 100, y: 100, w: 100, h: 40 });
ok('click: the target is scrolled into view', tgt.scrolled >= 1);
var c7 = clickIn('#go', [mkEl({ text: 'Place order' })], function () { return null; });
jeq('click: unsafe text', [c7.ok, c7.reason], [false, 'unsafe']);
ok('click: unsafe names its words', c7.why.indexOf('Place order') >= 0, c7);
['Buy now', 'Pay', 'Unsubscribe', 'Delete', 'Sign out', 'Log out', 'Complete my purchase', 'Remove my account'].forEach(function (w) {
  eq('click: "' + w + '" is unsafe', clickIn('#go', [mkEl({ text: w })], function () { return null; }).reason, 'unsafe');
});
eq('click: aria-label is read when there is no text', clickIn('#go', [mkEl({ text: '', aria: 'Buy now' })], function () { return null; }).reason, 'unsafe');
var buyerEl = mkEl({ text: 'Find a buyer' });
eq('click: "buyer" is not "buy"', clickIn('#go', [buyerEl], function () { return buyerEl; }).ok, true);
var c8 = clickIn('#go', [mkEl({ text: 'Read more', link: { origin: 'https://other.example' } })], function () { return null; });
jeq('click: a link to another origin is unsafe', [c8.ok, c8.reason], [false, 'unsafe']);
ok('click: that says it is another site', c8.why.indexOf('another site') >= 0, c8);
var ownLink = mkEl({ text: 'Read more', link: { origin: 'https://shop.example' } });
eq('click: a same-origin link is fine', clickIn('#go', [ownLink], function () { return ownLink; }).ok, true);
var c9 = clickIn('#go', [mkEl({ hidden: true }), tgt], function () { return tgt; });
eq('click: the first VISIBLE match is used', c9.ok, true);
eq('click: matches counts them all', c9.matches, 2);
var offscreen = mkEl({ rect: { left: 5000, top: 100, width: 100, height: 40 } });
var c10 = clickIn('#go', [offscreen], function () { return offscreen; });
jeq('click: every point off the viewport is covered, never clicked', [c10.ok, c10.reason], [false, 'covered']);

section('qkTileMarkFn and qkClipScanFn on a small fake page');
(function () {
  var el = { style: {}, scrolled: 0, scrollIntoView: function () { this.scrolled++; } };
  var nodes = [{ nodeValue: '  Other  text', parentElement: { style: {}, scrollIntoView: function () {} } }, { nodeValue: 'Free   shipping on orders', parentElement: el }];
  var scrolled = [];
  var doc = {
    body: {}, createTreeWalker: function () { var i = 0; return { nextNode: function () { return nodes[i++] || null; } }; },
    createRange: function () { return { selectNodeContents: function () {}, getBoundingClientRect: function () { return { left: 10.4, top: 20.6, width: 30.2, height: 10 }; } }; },
  };
  var win = { innerWidth: 360, innerHeight: 640, scrollY: 0, scrollTo: function (x, y) { scrolled.push(y); } };
  var f = pageFn(qkTileMarkFn, { document: doc, window: win, NodeFilter: { SHOW_TEXT: 4 } });
  var m = f('Free shipping on', 100);
  eq('tile mark: found', m.found, true);
  jeq('tile mark: the rect is rounded', m.rect, { x: 10, y: 21, w: 30, h: 10 });
  jeq('tile mark: the viewport is returned', [m.vw, m.vh], [360, 640]);
  eq('tile mark: the element is outlined', el.style.outline, '2px solid #e00');
  eq('tile mark: and brought to the centre', el.scrolled, 1);
  var m2 = f('Not on the page', 900);
  eq('tile mark: not found', m2.found, false);
  jeq('tile mark: not found scrolls to y and returns a y rect', [scrolled[0], m2.rect.y, m2.vh], [580, 900, 640]);
  eq('tile mark: no text is not found', f('', 0).found, false);
})();
(function () {
  var tested = [];
  var doc = {
    body: {}, createTreeWalker: function () { return { nextNode: function () { return null; } }; }, createRange: function () { return {}; },
    documentElement: { clientWidth: 360, scrollWidth: 360, matches: function (s) { tested.push(s); if (s.indexOf('bad[') === 0) throw new Error('bad'); return false; } },
  };
  var win = { innerWidth: 360, devicePixelRatio: 1, scrollY: 0 };
  var fk = pageFn(qkClipScanFn, { document: doc, window: win, NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 }, performance: { now: function () { return 1; } }, getComputedStyle: function () { return {}; } });
  var r = fk({ ignoreList: ['.a', 'bad[', '  ', '.b'] });
  jeq('clip scan: invalid ignore entries are reported', r.ignoreInvalid, ['bad[']);
  eq('clip scan: the valid ones were tested', tested.join('|'), '.a|bad[|.b');
  jeq('clip scan: no ignore list means none invalid', fk({}).ignoreInvalid, []);
  eq('clip scan: an empty page has no offenders', fk({}).offenderCount, 0);
  eq('clip scan: an empty ignore list is accepted', fk({ ignoreList: [] }).offenderCount, 0);
})();

section('qkHygieneShim, qkStorageNamesFn, qkClearedFn');
function fakeStore(obj) {
  var keys = Object.keys(obj);
  return {
    get length() { return keys.length; },
    key: function (i) { return i < keys.length ? keys[i] : null; },
    getItem: function (k) { return obj[k] === undefined ? null : obj[k]; },
    removeItem: function (k) { var i = keys.indexOf(k); if (i >= 0) keys.splice(i, 1); delete obj[k]; },
    names: function () { return keys.slice(); },
  };
}
function runShim(appKeys, o) {
  o = o || {};
  var writes = [];
  var local = fakeStore(o.local || { optimizelyEndUserId: 'x', qk_quiz_progress: '3', keep_me: '1', Optimizely_Data: 'd' });
  var session = fakeStore(o.session || { optimizelyPendingLogEvents: '[]', qk_quiz_step: '2', other: '1' });
  var doc = { get cookie() { return o.cookie === undefined ? 'a=1; optimizelyEndUserId=abc; qk_quiz_p=2; _conv_v=9; other=3' : o.cookie; }, set cookie(v) { writes.push(v); } };
  var win = {};
  var src = qkHygieneShim(appKeys);
  new Function('window', 'document', 'location', 'localStorage', 'sessionStorage', src)(win, doc, { hostname: o.host || 'www.shop.example' }, local, session);
  return { writes: writes, local: local.names(), session: session.names(), cleared: win.__qkCleared, src: src };
}
var sh = runShim(['qk_quiz_*']);
jeq('shim: localStorage keeps only what does not match', sh.local, ['keep_me']);
jeq('shim: sessionStorage keeps only what does not match', sh.session, ['other']);
ok('shim: names of removed local keys recorded', sh.cleared.indexOf('local:optimizelyEndUserId') >= 0 && sh.cleared.indexOf('local:qk_quiz_progress') >= 0 && sh.cleared.indexOf('local:Optimizely_Data') >= 0, sh.cleared);
ok('shim: names of removed session keys recorded', sh.cleared.indexOf('session:optimizelyPendingLogEvents') >= 0 && sh.cleared.indexOf('session:qk_quiz_step') >= 0, sh.cleared);
ok('shim: names of cookies recorded', sh.cleared.indexOf('cookie:optimizelyEndUserId') >= 0 && sh.cleared.indexOf('cookie:qk_quiz_p') >= 0 && sh.cleared.indexOf('cookie:_conv_v') >= 0, sh.cleared);
ok('shim: an unmatched key or cookie is not recorded', ['local:keep_me', 'session:other', 'cookie:other', 'cookie:a'].every(function (n) { return sh.cleared.indexOf(n) < 0; }), sh.cleared);
// cookies: once without a domain and once per parent domain
var cw = sh.writes.filter(function (w) { return w.indexOf('qk_quiz_p=') === 0; });
eq('shim: a matching cookie is expired three times for www.shop.example', cw.length, 3);
ok('shim: once without a domain', cw.filter(function (w) { return w.indexOf('domain=') < 0; }).length === 1, cw);
ok('shim: once for the host', cw.filter(function (w) { return w.indexOf('; domain=www.shop.example') >= 0; }).length === 1, cw);
ok('shim: once for the parent domain', cw.filter(function (w) { return w.indexOf('; domain=.shop.example') >= 0; }).length === 1, cw);
ok('shim: every write expires the cookie at path /', cw.every(function (w) { return /; Max-Age=0; path=\//.test(w); }), cw);
ok('shim: an unmatched cookie is never written', sh.writes.every(function (w) { return w.indexOf('other=') !== 0 && w.indexOf('a=') !== 0; }), sh.writes);
var ip = runShim([], { host: '127.0.0.1' });
eq('shim: an IP host gets only the no-domain write', ip.writes.filter(function (w) { return w.indexOf('optimizelyEndUserId=') === 0; }).length, 1);
var lh = runShim([], { host: 'localhost' });
eq('shim: a one-label host gets only the no-domain write', lh.writes.filter(function (w) { return w.indexOf('optimizelyEndUserId=') === 0; }).length, 1);
var nok = runShim([], { cookie: '' });
jeq('shim: no cookies means no cookie writes', nok.writes, []);
// the patterns travel as JSON, so a quote of either kind stays inside one string
var weird = "it's\"x";
var wsh = runShim([weird], { local: { "it's\"x": '1', keep: '2' }, cookie: '' });
jeq('shim: a pattern with \' and " removes exactly that key', wsh.local, ['keep']);
ok('shim: the source embeds the cleaned patterns as JSON', wsh.src.indexOf(JSON.stringify(qkCleanPatterns([weird]))) > 0, wsh.src);
ok('shim: the source has no ES6 arrow, let or const', !/=>|\blet\b|\bconst\b/.test(wsh.src));
ok('shim: a lone * removes nothing but the Optimizely keys', (function () {
  var r = runShim(['*', 'ab*']);
  return r.local.indexOf('keep_me') >= 0 && r.local.indexOf('qk_quiz_progress') >= 0 && r.session.indexOf('other') >= 0 && r.local.indexOf('optimizelyEndUserId') < 0;
})());
ok('shim: a prefix of 3 characters is a prefix', (function () {
  var r = runShim(['qk_*']);
  return r.local.indexOf('qk_quiz_progress') < 0 && r.local.indexOf('keep_me') >= 0;
})());
ok('shim: a throwing storage does not stop the cookie pass', (function () {
  var writes = [];
  var bad = { get length() { throw new Error('denied'); }, key: function () { return null; }, removeItem: function () {} };
  var doc = { get cookie() { return 'optimizelyEndUserId=1'; }, set cookie(v) { writes.push(v); } };
  var win = {};
  new Function('window', 'document', 'location', 'localStorage', 'sessionStorage', qkHygieneShim([]))(win, doc, { hostname: 'shop.example' }, bad, bad);
  return writes.length === 2 && win.__qkCleared.indexOf('cookie:optimizelyEndUserId') >= 0;
})());
ok('shim: running it twice keeps appending to one list', (function () {
  var win = {};
  var doc = { cookie: '' };
  var st = fakeStore({ optimizely_a: '1' });
  var src = qkHygieneShim([]);
  var f = new Function('window', 'document', 'location', 'localStorage', 'sessionStorage', src);
  f(win, doc, { hostname: 'shop.example' }, st, fakeStore({}));
  var st2 = fakeStore({ optimizely_b: '1' });
  f(win, doc, { hostname: 'shop.example' }, st2, fakeStore({}));
  return win.__qkCleared.join(',') === 'local:optimizely_a,local:optimizely_b';
})());

// qkStorageNamesFn: names only
var sn = pageFn(qkStorageNamesFn, {
  localStorage: fakeStore({ optimizelyEndUserId: 'SECRETVAL', qk_quiz_progress: 'SECRETVAL', keep: 'x' }),
  sessionStorage: fakeStore({ qk_quiz_step: 'SECRETVAL', other: 'x' }),
  document: { cookie: 'qk_quiz_p=SECRETVAL; optimizelyX=SECRETVAL; zzz=1' },
})(['qk_quiz_*']);
jeq('storage names: local', sn.local, ['optimizelyEndUserId', 'qk_quiz_progress']);
jeq('storage names: session', sn.session, ['qk_quiz_step']);
jeq('storage names: cookies', sn.cookies, ['qk_quiz_p', 'optimizelyX']);
ok('storage names: no value is in the result', JSON.stringify(sn).indexOf('SECRETVAL') < 0);
var sn2 = pageFn(qkStorageNamesFn, { localStorage: throwAll(), sessionStorage: fakeStore({ a: '1' }), document: { cookie: '' } })(['a']);
jeq('storage names: one store throwing empties only that list', [sn2.local, sn2.session, sn2.cookies], [[], ['a'], []]);
var many = {};
for (var mi = 0; mi < 150; mi++) many['qk_quiz_' + mi] = '1';
eq('storage names: capped at 100 names', pageFn(qkStorageNamesFn, { localStorage: fakeStore(many), sessionStorage: fakeStore({}), document: { cookie: '' } })(['qk_quiz_*']).local.length, 100);
eq('storage names: a non-list of patterns is accepted', pageFn(qkStorageNamesFn, { localStorage: fakeStore({ optimizelyZ: '1' }), sessionStorage: fakeStore({}), document: { cookie: '' } })(null).local.length, 1);

// qkClearedFn: returns and resets
var cwin = { __qkCleared: ['local:a', 'cookie:b'] };
var cf = pageFn(qkClearedFn, { window: cwin });
jeq('cleared: returns the names', cf(), { names: ['local:a', 'cookie:b'] });
jeq('cleared: and resets the list', cwin.__qkCleared, []);
jeq('cleared: a second read is empty', cf(), { names: [] });
jeq('cleared: nothing recorded is an empty list', pageFn(qkClearedFn, { window: {} })(), { names: [] });
eq('cleared: capped at 100', pageFn(qkClearedFn, { window: { __qkCleared: new Array(150).join('x,').split(',') } })().names.length, 100);

section('page functions: the section as a whole');
jeq('no page function reached a name outside its own body or the fakes (any run above)', pageLeaks, []);
var kitSrc = readFile('../qa-kit.js');
var pfSrc = kitSrc.slice(kitSrc.indexOf('// ── Page functions and the hygiene shim'), kitSrc.indexOf('// ── Run helpers')).replace(/\/\/.*$/gm, '');
ok('no user-agent or touch emulation in the page functions', !/setUserAgentOverride|setTouchEmulationEnabled/.test(pfSrc));
ok('no page function writes a cookie or storage key', !/document\.cookie\s*=[^=]/.test(pfSrc.replace(/qkHygieneShim[\s\S]*$/, '')) && !/setItem\s*\(/.test(pfSrc));
ok('no page function clicks or submits', !/\.click\s*\(|\.submit\s*\(|dispatchEvent/.test(pfSrc));
ok('no page function references force tracking', !/optimizely_force_tracking|_conv_eforce/.test(pfSrc));
ok('every page function is a plain function declaration', PAGE_FNS.every(function (f) { return /^(async )?function qk/.test(f.toString()); }));

// ── self-containment of the file ───────────────────────────────────────────
section('the file');
var src = readFile('../qa-kit.js');
ok('no non-comment line names a qp, QP_, ec or EC_ symbol', src.split('\n').every(function (l) { return /^\s*\/\//.test(l) || !/\bqp[A-Z]|\bQP_|\bec[A-Z]|\bEC_/.test(l); }));
ok('no chrome. reference', !/\bchrome\./.test(src.replace(/\/\/.*$/gm, '')));
var srcNoPageFns = src.slice(0, src.indexOf('// ── Page functions and the hygiene shim')) + src.slice(src.indexOf('// ── Run helpers'));
ok('the page-function section is found and bounded', src.indexOf('// ── Page functions and the hygiene shim') > 0 && src.indexOf('// ── Run helpers') > src.indexOf('// ── Page functions and the hygiene shim'));
ok('no document or window reference outside comments and the page-function section', !/\b(document|window)\./.test(srcNoPageFns.replace(/\/\/.*$/gm, '')));
ok('the file ends by exporting onto the global', /Object\.keys\(EXPORTS\)\.forEach\(function \(k\) \{ g\[k\] = EXPORTS\[k\]; \}\);\n\}\)\(typeof globalThis/.test(src));
ok('no user-agent or touch emulation', !/setUserAgentOverride|setTouchEmulationEnabled/.test(src));

// ── report ─────────────────────────────────────────────────────────────────
print('');
if (failures.length) {
  print('FAILURES:');
  failures.forEach(function (f) { print('  - ' + f); });
}
print('=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
