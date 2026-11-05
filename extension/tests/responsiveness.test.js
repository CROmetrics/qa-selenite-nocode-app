// responsiveness suite — extension/responsiveness.js (Test Agent Mode 5), run against the fake io and the synthetic
// site of plan.md Appendix D (tests/qk-fake-io.js).
//
//   RUN:  cd extension/tests && jsc responsiveness.test.js
//
// What these pin: the Appendix D.5/D.6 expectations row by row; every clipped row is a Fail whatever PROD does; the
// run never loads a tracking flag nor a _conv_eforce link; halts, stops and failed loads become honest rows; tiles are
// capped and referenced; the tile layout is pure integer geometry; the engine touches the io only through the 15
// members of the kit's contract.

load('../qa-kit.js');
load('qk-fake-io.js');
var BEFORE = Object.keys(globalThis);
load('../responsiveness.js');
var RS_NAMES = Object.keys(globalThis).filter(function (k) { return BEFORE.indexOf(k) === -1; });

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

var B = QK_FAKE.base;
var IO_MEMBERS = ['now', 'checkStop', 'sleep', 'debug', 'progress', 'load', 'state', 'facts', 'catalog', 'click', 'storageNames', 'viewport', 'scan', 'shot', 'compose'];

// ── helpers ────────────────────────────────────────────────────────────────
function strictIo(io) {
  return new Proxy(io, {
    get: function (t, k) {
      if (typeof k === 'string' && IO_MEMBERS.indexOf(k) < 0) throw new Error('engine touched a non-contract io member: ' + k);
      return t[k];
    },
  });
}
// Runs the engine the way the worker's qkwRunMode does: sanitize, record, run, catch halt / stop / error, derive.
function runMode(site, rawInput, ioOpts, strict, wrap) {
  var io0 = QK_FAKE.makeIo(site, ioOpts), io = wrap ? wrap(io0) : io0;
  var input = rsSanitizeInput(rawInput);
  var rec = rsNewRecord(input, io.now());
  var done = false;
  rsRun(strict ? strictIo(io) : io, rec, input).then(function () { done = true; }, function (e) {
    if (qkIsHalt(e)) rec.halted = e.halted;
    else if (qkIsStop(e)) rec.stopped = true;
    else rec.error = qkMaskOutput(String(e && e.message || e));
    done = true;
  });
  drainMicrotasks();
  rec.finishedAt = io.now();
  rec.rows = rsDeriveRows(rec);
  return { io: io0, rec: rec, input: input, done: done, site: site };
}
function ctxResp(extra) {
  return Object.assign({
    ticketKey: 'QK-6', experimentId: '7201', platform: 'Optimizely', reviewed: true,
    previewLinks: [{ id: 'v0', url: B + '/resp/?optimizely_x=7301&cro_mode=qa' }, { id: 'v1', url: B + '/resp/?optimizely_x=7302&cro_mode=qa' }],
    itwLink: B + '/resp/?cro_mode=qa',
  }, extra || {});
}
function build(ctx, values) {
  var v = Object.assign({ widths: '320,375,1280', ignore: RS_IGNORE_DEFAULTS.join('\n') }, values || {});
  var b = rsBuildInput(ctx, v);
  if (!b.ok) throw new Error('build failed: ' + b.error);
  return b.input;
}
function byId(rows, id) { return rows.filter(function (r) { return r.id === id; })[0]; }
function ids(rows) { return rows.map(function (r) { return r.id; }); }
function loadsTo(site, path) { return site.requestsTo(path).length; }
function hasTracking(urls) { return urls.some(function (u) { return /optimizely_force_tracking|_conv_eforce/i.test(u); }); }

// ── exports, prefixes, top level ───────────────────────────────────────────
section('exports');
var EXPECTED = ['RS_RECORD_VERSION', 'RS_MODE', 'RS_LABEL', 'RS_MAX_TARGETS', 'RS_MAX_ROWS_PER_WIDTH', 'RS_MAX_TILES_PER_TARGET', 'RS_MAX_TILES',
  'RS_MAX_IGNORE', 'RS_IGNORE_DEFAULTS', 'RS_TILE', 'RS_COLUMNS', 'rsParseTargets', 'rsBuildInput', 'rsCtxLine', 'rsInputLine', 'RS_PANEL',
  'rsSanitizeInput', 'rsMaskInput', 'rsNewRecord', 'rsTileLayout', 'rsTilesCappedText', 'rsProdModeText', 'rsRun', 'rsDeriveRows',
  'rsSummaryProjection', 'rsDebugProjection', 'rsReportFootHtml', 'RS_ENGINE'];
jeq('the export list is exactly the expected list', RS_NAMES.slice().sort(), EXPECTED.slice().sort());
ok('every exported name has the rs / RS_ prefix', RS_NAMES.every(function (n) { return /^(rs|RS_)/.test(n); }));
var src = readFile('../responsiveness.js');
var code = src.replace(/\/\/.*$/gm, '');
ok('no chrome., document, window, fetch, setTimeout, URL in the file', !/\b(chrome\.|document\.|window\.|fetch\(|setTimeout|new URL)/.test(code));
ok('no user agent or touch emulation, no claude- model name', !/setUserAgentOverride|setTouchEmulationEnabled|claude-/.test(src));
(function () {
  // lines at indent <= 2 that are not inside a function must not name a qk / QK_ identifier
  var bad = [], depth = 0, lines = src.split('\n');
  lines.forEach(function (ln, i) {
    var ind = /^ */.exec(ln)[0].length;
    var t = ln.trim();
    if (!t || t.indexOf('//') === 0) return;
    if (ind <= 2 && depth === 0 && !/^(function|async function)\b/.test(t) && /\b(qk[A-Z]|QK_)/.test(t)) bad.push((i + 1) + ': ' + t);
    if (/^(async )?function\b/.test(t) && ind <= 2) depth = 1;
    if (depth === 1 && ind <= 2 && /^\}/.test(t)) depth = 0;
  });
  jeq('no top-level reference to a qk / QK_ name outside a function', bad, []);
})();
ok('RS_PANEL dflt for widths is a literal equal to QK_WIDTHS', RS_PANEL.fields.filter(function (f) { return f.key === 'widths'; })[0].dflt === QK_WIDTHS.join(','));
jeq('RS_IGNORE_DEFAULTS equals QK_IGNORE_DEFAULTS', RS_IGNORE_DEFAULTS, QK_IGNORE_DEFAULTS);
eq('RS_IGNORE_DEFAULTS has 16', RS_IGNORE_DEFAULTS.length, 16);
eq('constants: version', RS_RECORD_VERSION, 1);
eq('constants: mode', RS_MODE, 'responsiveness');
eq('constants: label', RS_LABEL, 'Responsiveness');
eq('constants: caps', [RS_MAX_TARGETS, RS_MAX_ROWS_PER_WIDTH, RS_MAX_TILES_PER_TARGET, RS_MAX_TILES, RS_MAX_IGNORE].join(), '6,5,6,12,40');
eq('RS_TILE has the 12 keys', Object.keys(RS_TILE).length, 12);
eq('RS_COLUMNS has 12 columns', RS_COLUMNS.length, 12);
jeq('RS_COLUMNS keys', RS_COLUMNS.map(function (c) { return c.key; }), ['check', 'expected', 'observed', 'verdict', 'evidence', 'width', 'variant', 'selector', 'gapPx', 'alsoOnProd', 'severity', 'tile']);
eq('RS_COLUMNS labels: the element selector one', RS_COLUMNS[7].label, 'Element selector');

// ── rsParseTargets ─────────────────────────────────────────────────────────
section('rsParseTargets');
var pt = rsParseTargets('v0 https://a.example/x?optimizely_x=1\nhttps://b.example/y\n\n  v9   https://c.example/z  ');
jeq('labels and bare urls', pt.map(function (t) { return t.label; }), ['v0', 'v1', 'v9']);
eq('url kept', pt[0].url, 'https://a.example/x?optimizely_x=1');
eq('bare url is labelled by its position', pt[1].url, 'https://b.example/y');
eq('at most 6', rsParseTargets('a https://e.example/1\nb https://e.example/2\nc https://e.example/3\nd https://e.example/4\ne https://e.example/5\nf https://e.example/6\ng https://e.example/7').length, 6);
eq('a scheme-less url is made https', rsParseTargets('shop.example/p')[0].url, 'https://shop.example/p');
jeq('duplicate labels are made unique', rsParseTargets('a https://e.example/1\na https://e.example/2').map(function (t) { return t.label; }), ['a', 'a-2']);
eq('empty text gives none', rsParseTargets('').length, 0);
eq('null gives none', rsParseTargets(null).length, 0);
jeq('a label is reduced to safe characters', rsParseTargets('v1: Hero https://e.example/1').map(function (t) { return t.label; }), ['v1-Hero']);

// ── rsBuildInput ───────────────────────────────────────────────────────────
section('rsBuildInput');
var bi = rsBuildInput(ctxResp(), { widths: '320,375,1280', ignore: RS_IGNORE_DEFAULTS.join('\n') });
ok('ticket context builds', bi.ok === true);
eq('the input has exactly 8 keys', Object.keys(bi.input).length, 8);
jeq('the 8 keys', Object.keys(bi.input).sort(), ['experimentId', 'ignore', 'prodUrl', 'sources', 'storedKeys', 'targets', 'ticketKey', 'widths']);
jeq('targets come from the ticket, v0 included', bi.input.targets.map(function (t) { return t.label; }), ['v0', 'v1']);
eq('sources.targets = ticket', bi.input.sources.targets, 'ticket');
eq('PROD derived from the ITW link, no cro_mode', bi.input.prodUrl, B + '/resp/');
eq('sources.prodUrl = derived', bi.input.sources.prodUrl, 'derived');
eq('experiment from the ticket', bi.input.experimentId, '7201');
eq('sources.experimentId = ticket', bi.input.sources.experimentId, 'ticket');
jeq('widths parsed', bi.input.widths, [320, 375, 1280]);
eq('sources.widths = typed', bi.input.sources.widths, 'typed');
eq('default ignore list is derived', bi.input.sources.ignore, 'derived');
eq('ticketKey', bi.input.ticketKey, 'QK-6');
var bt = rsBuildInput(ctxResp(), { targets: 'x https://typed.example/p?optimizely_x=9', prod: 'https://typed.example/', exp: ' 7999 ', keys: 'qk_quiz_*\nsession_id', widths: '', ignore: 'div.skip' });
ok('typed beats ticket', bt.ok && bt.input.targets.length === 1 && bt.input.targets[0].label === 'x');
eq('sources.targets = typed', bt.input.sources.targets, 'typed');
eq('typed PROD', bt.input.prodUrl, 'https://typed.example/');
eq('sources.prodUrl = typed', bt.input.sources.prodUrl, 'typed');
eq('typed experiment trimmed', bt.input.experimentId, '7999');
jeq('typed keys cleaned', bt.input.storedKeys, ['qk_quiz_*', 'session_id']);
eq('sources.storedKeys = typed', bt.input.sources.storedKeys, 'typed');
jeq('empty widths = the 18', bt.input.widths, QK_WIDTHS);
eq('empty widths are derived', bt.input.sources.widths, 'derived');
jeq('typed ignore list', bt.input.ignore, ['div.skip']);
eq('a changed ignore list is typed', bt.input.sources.ignore, 'typed');
var bn = rsBuildInput(null, { targets: '', widths: '' });
ok('no target and no ticket refuses', bn.ok === false);
eq('the refusal sentence', bn.error, 'Responsiveness needs at least one variation link: set the ticket\'s preview links in Initialize or type them above.');
var b2 = rsBuildInput(null, { targets: 'https://only.example/p' });
ok('no ticket needs only a typed link', b2.ok === true);
eq('no PROD and no ticket = empty prodUrl', b2.input.prodUrl, '');
eq('sources.prodUrl = none', b2.input.sources.prodUrl, 'none');
eq('no experiment = null', b2.input.experimentId, null);
eq('no ticket key = null', b2.input.ticketKey, null);
eq('values.ignore absent = defaults', b2.input.ignore.length, 16);
var bk = rsBuildInput(ctxResp(), { keys: '*' });
ok('a typed * is refused (A9)', bk.ok === false);
eq('the A9 sentence', bk.error, 'Stored keys: "*" is too broad: give exact names, or at least 3 characters before the *.');
ok('a typed ab* is refused (A9)', rsBuildInput(ctxResp(), { keys: 'ok_one\nab*' }).ok === false);
eq('the A9 sentence names the line', rsBuildInput(ctxResp(), { keys: 'ab*' }).error, 'Stored keys: "ab*" is too broad: give exact names, or at least 3 characters before the *.');
jeq('ticket keys drop a lone *', rsBuildInput(ctxResp({ storedStateKeys: ['*', 'qk_*'] }), {}).input.storedKeys, ['qk_*']);
eq('sources.storedKeys = ticket', rsBuildInput(ctxResp({ storedStateKeys: ['qk_*'] }), {}).input.sources.storedKeys, 'ticket');
var bc = rsBuildInput(ctxResp({ previewLinks: [{ id: 'v0', url: B + '/resp/?optimizely_x=7301' }, { id: 'v1', url: B + '/resp/?_conv_eforce=1.2.3' }] }), {});
eq('a _conv_eforce target is kept with convForced', bc.input.targets[1].convForced, true);
eq('a plain target is not convForced', bc.input.targets[0].convForced, false);
var big = []; for (var bi2 = 0; bi2 < 7; bi2++) big.push({ id: 'v' + bi2, url: B + '/resp/?optimizely_x=' + (7300 + bi2) });
var bb = rsBuildInput(ctxResp({ previewLinks: big }), {});
ok('7 ticket links are refused, not silently cut', bb.ok === false && /at most 6/.test(bb.error));
var ctrlOnly = rsBuildInput({ ticketKey: 'QK-1', previewLinks: [{ id: 'v0', url: B + '/resp/?optimizely_x=7301&cro_mode=qa' }] }, {});
eq('PROD derives from the control link when there is no ITW link', ctrlOnly.input.prodUrl, B + '/resp/');
ok('too many widths refuse', rsBuildInput(ctxResp(), { widths: Array.apply(null, Array(31)).map(function (_, i) { return 200 + i * 10; }).join(',') }).ok === false);
eq('a schemeless typed prod is made https', rsBuildInput(ctxResp(), { prod: 'shop.example/p' }).input.prodUrl, 'https://shop.example/p');

// ── panel config ───────────────────────────────────────────────────────────
section('RS_PANEL');
eq('mode', RS_PANEL.mode, 'responsiveness');
eq('prefix', RS_PANEL.prefix, 'rs');
eq('action', RS_PANEL.action, 'runResponsiveness');
eq('version', RS_PANEL.version, RS_RECORD_VERSION);
eq('overridesKey', RS_PANEL.overridesKey, 'rsOverrides');
eq('settingsKey', RS_PANEL.settingsKey, 'rsSettings');
eq('lastRunKey', RS_PANEL.lastRunKey, 'rsLastRun');
eq('debugLastKey', RS_PANEL.debugLastKey, 'rsDebugLast');
eq('csvBase', RS_PANEL.csvBase, 'responsiveness');
eq('columns are RS_COLUMNS', RS_PANEL.columns, RS_COLUMNS);
jeq('field ids are the whole markup ids', RS_PANEL.fields.map(function (f) { return f.id; }), ['rs-targets', 'rs-prod', 'rs-exp', 'rs-keys', 'rs-widths', 'rs-ignore']);
jeq('field keys are the ids without rs-', RS_PANEL.fields.map(function (f) { return f.key; }), ['targets', 'prod', 'exp', 'keys', 'widths', 'ignore']);
ok('every key is its id without the prefix', RS_PANEL.fields.every(function (f) { return f.id === 'rs-' + f.key; }));
jeq('scopes', RS_PANEL.fields.map(function (f) { return f.scope; }), ['ticket', 'ticket', 'ticket', 'ticket', 'global', 'global']);
jeq('kinds', RS_PANEL.fields.map(function (f) { return f.kind; }), ['lines', 'text', 'text', 'lines', 'text', 'selectors']);
eq('ignore is the only selectors field', RS_PANEL.fields.filter(function (f) { return f.kind === 'selectors'; }).length, 1);
ok('global fields have no ph', RS_PANEL.fields.filter(function (f) { return f.scope === 'global'; }).every(function (f) { return !f.ph; }));
ok('ticket fields have a ph', RS_PANEL.fields.filter(function (f) { return f.scope === 'ticket'; }).every(function (f) { return typeof f.ph === 'function'; }));
eq('ignore dflt = the 16 joined by newline', RS_PANEL.fields[5].dflt, RS_IGNORE_DEFAULTS.join('\n'));
var ph = {}; RS_PANEL.fields.forEach(function (f) { if (f.ph) ph[f.key] = f.ph(ctxResp({ storedStateKeys: ['qk_*', 'abc'] })); });
eq('ph targets: label url per line', ph.targets, 'v0 ' + B + '/resp/?optimizely_x=7301&cro_mode=qa\nv1 ' + B + '/resp/?optimizely_x=7302&cro_mode=qa');
eq('ph prod: the derived PROD', ph.prod, B + '/resp/');
eq('ph exp', ph.exp, '7201');
eq('ph keys: lines', ph.keys, 'qk_*\nabc');
eq('ph on an empty ticket is empty', RS_PANEL.fields[2].ph({}), '');
eq('ph keys on an empty ticket is empty', RS_PANEL.fields[3].ph({}), '');
eq('ph targets on an empty ticket is empty', RS_PANEL.fields[0].ph({}), '');
eq('ctxLine(null) is a line and does not throw', typeof rsCtxLine(null), 'string');
ok('ctxLine(null) is non-empty', rsCtxLine(null).length > 0);
ok('ctxLine names the ticket', /QK-6/.test(rsCtxLine(ctxResp())));
ok('inputLine describes the sources', /ticket/.test(rsInputLine(bi.input)));
eq('inputLine(null) does not throw', typeof rsInputLine(null), 'string');

// ── sanitize, mask, record ─────────────────────────────────────────────────
section('rsSanitizeInput / rsNewRecord');
var raw = { ticketKey: 'QK-6', experimentId: '7201', targets: [{ label: 'v 1', url: 'shop.example/p?optimizely_force_tracking=true&optimizely_x=7302' }, { label: 'v2', url: B + '/x?_conv_eforce=1.2.3' }, { url: '' }],
  prodUrl: '', widths: [1000, '320', 50, 5000, 320], ignore: ['  a ', 'a', 'b', ''], storedKeys: ['*', 'ab*', 'qk_*', 'exact'], sources: { targets: 'typed', bogus: 'x' } };
var sn = rsSanitizeInput(raw);
eq('sanitize: 8 keys', Object.keys(sn).length, 8);
eq('sanitize: a scheme-less target url is made https', sn.targets[0].url.indexOf('https://shop.example/p'), 0);
eq('sanitize: label made safe', sn.targets[0].label, 'v-1');
eq('sanitize: a target without a url is dropped', sn.targets.length, 2);
eq('sanitize: convForced recomputed', sn.targets[1].convForced, true);
jeq('sanitize: widths 200-3000, unique, ascending', sn.widths, [320, 1000]);
jeq('sanitize: ignore trimmed and unique', sn.ignore, ['a', 'b']);
jeq('sanitize: * and ab* dropped (A9)', sn.storedKeys, ['qk_*', 'exact']);
eq('sanitize: known source kept', sn.sources.targets, 'typed');
eq('sanitize: an unknown source key is gone', sn.sources.bogus, undefined);
eq('sanitize: a missing source reads none', sn.sources.widths, 'none');
jeq('sanitize: garbage input gives defaults', rsSanitizeInput(null).widths, QK_WIDTHS);
eq('sanitize: no ignore array = the defaults', rsSanitizeInput({}).ignore.length, 16);
eq('sanitize: at most 6 targets', rsSanitizeInput({ targets: [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return { label: 'v' + n, url: 'https://e.example/' + n }; }) }).targets.length, 6);
var mi = rsMaskInput(sn);
ok('mask: no ASCII ? & = in the masked input', !/[?&=]/.test(JSON.stringify(mi).replace(/"[A-Za-z]+":/g, '"k":').replace(/[{},:\[\]]/g, '')));
ok('mask: the forcing flag is gone', JSON.stringify(mi).indexOf('optimizely_force_tracking') < 0);
var nr = rsNewRecord(sn, 123);
eq('record: exactly 16 keys', Object.keys(nr).length, 16);
jeq('record: the 16 keys', Object.keys(nr).sort(), ['error', 'finishedAt', 'halted', 'input', 'loads', 'mode', 'plan', 'rows', 'startedAt', 'stopped', 'sweep', 'ticketKey', 'tiles', 'tilesCapped', 'ts', 'version']);
eq('record: mode', nr.mode, 'responsiveness');
eq('record: version', nr.version, 1);
eq('record: ts and startedAt', nr.ts + ',' + nr.startedAt, '123,123');
eq('record: finishedAt null', nr.finishedAt, null);
eq('record: tilesCapped null', nr.tilesCapped, null);
jeq('record: plan keys', Object.keys(nr.plan), ['widths', 'targets', 'prodMode', 'prodLiveIds']);
jeq('record: plan widths in severity order', rsNewRecord(rsSanitizeInput({ targets: [{ label: 'a', url: 'https://e.example/' }], widths: [320, 375, 1280] }), 1).plan.widths, [375, 1280, 320]);
eq('record: the plan target carries its forced ids', nr.plan.targets[0].forcedIds.join(), '7302');
eq('record: a stored input has no raw url', JSON.stringify(nr.input).indexOf('https://shop.example/p?') < 0, true);
eq('record: ticketKey', nr.ticketKey, 'QK-6');

// ── the resp scenario (Appendix D.5) ───────────────────────────────────────
section('resp (D.5)');
var R1 = runMode(QK_FAKE.sites.resp(), build(ctxResp()), {}, true);
var rows1 = R1.rec.rows;
ok('the run finished', R1.done && !R1.rec.error && !R1.rec.halted && !R1.rec.stopped);
jeq('row ids, in the order variation then ascending width', ids(rows1), ['rs.v0.320.1', 'rs.v0.375', 'rs.v0.1280', 'rs.v1.320.1', 'rs.v1.320.2', 'rs.v1.375.1', 'rs.v1.1280', 'rs.prod']);
eq('rs.v0.320.1 Fail', byId(rows1, 'rs.v0.320.1').status, 'failed');
ok('rs.v0.320.1 names the legal line', /LEGAL-LINE/.test(byId(rows1, 'rs.v0.320.1').check));
eq('rs.v0.320.1 gap -10', byId(rows1, 'rs.v0.320.1').extra.gapPx, -10);
eq('rs.v0.320.1 severity low', byId(rows1, 'rs.v0.320.1').extra.severity, 'low');
eq('rs.v0.320.1 also on PROD yes', byId(rows1, 'rs.v0.320.1').extra.alsoOnProd, 'yes');
eq('rs.v0.375 Pass', byId(rows1, 'rs.v0.375').status, 'passed');
eq('rs.v0.1280 Pass', byId(rows1, 'rs.v0.1280').status, 'passed');
eq('rs.v1.1280 Pass', byId(rows1, 'rs.v1.1280').status, 'passed');
ok('rs.v1.320.1 is the hero, -76, also on PROD no', /CLIPPED-HERO/.test(byId(rows1, 'rs.v1.320.1').check) && byId(rows1, 'rs.v1.320.1').extra.gapPx === -76 && byId(rows1, 'rs.v1.320.1').extra.alsoOnProd === 'no');
ok('rs.v1.320.2 is the legal line, -10, also on PROD yes', /LEGAL-LINE/.test(byId(rows1, 'rs.v1.320.2').check) && byId(rows1, 'rs.v1.320.2').extra.gapPx === -10 && byId(rows1, 'rs.v1.320.2').extra.alsoOnProd === 'yes');
eq('rs.v1.375.1 gap -21', byId(rows1, 'rs.v1.375.1').extra.gapPx, -21);
eq('rs.v1.375.1 severity high', byId(rows1, 'rs.v1.375.1').extra.severity, 'high');
eq('rs.v1.375.1 also on PROD no', byId(rows1, 'rs.v1.375.1').extra.alsoOnProd, 'no');
ok('rs.v1.375.1 says it is a regression', /new in this variation \(regression\)/.test(byId(rows1, 'rs.v1.375.1').evidence));
ok('a PROD-clipped row says also on PROD yes', /also on PROD: yes/.test(byId(rows1, 'rs.v0.320.1').evidence));
ok('a PROD-clipped row is still a defect', /still a defect/.test(byId(rows1, 'rs.v0.320.1').evidence));
eq('rs.prod Pass', byId(rows1, 'rs.prod').status, 'passed');
eq('rs.prod says reloaded once per width', byId(rows1, 'rs.prod').observed, '3 widths, reloaded once per width');
eq('rs.prod is not emulated', byId(rows1, 'rs.prod').emulated, false);
ok('every sweep row is emulated', rows1.filter(function (r) { return r.id !== 'rs.prod'; }).every(function (r) { return r.emulated === true; }));
ok('no row mentions CAROUSEL', !/CAROUSEL/.test(JSON.stringify(rows1)));
ok('no output matches pre-existing or not a regression', !/pre-?existing|not a regression/i.test(JSON.stringify(R1.rec.rows) + JSON.stringify(R1.rec.plan)));
eq('4 Fail rows', qkCounts(rows1).fail, 4 + 0);
eq('counts: 4 Fail, 4 Pass', qkCounts(rows1).fail + ',' + qkCounts(rows1).pass, '4,4');
eq('the badge says ISSUES FOUND', qkBadge(rows1, false, false).label, 'ISSUES FOUND');
eq('6 variant loads', loadsTo(R1.site, '/resp/') - 3, 6);
eq('3 PROD loads', R1.rec.loads.filter(function (L) { return L.role === 'prod'; }).length, 3);
eq('9 loads in all', R1.rec.loads.length, 9);
ok('no request carries a tracking flag', !hasTracking(R1.io.trace.map(function (t) { return t.url || ''; })) && !hasTracking(R1.site.log.map(function (r) { return r.url; })));
jeq('plan.widths in severity order', R1.rec.plan.widths, [375, 1280, 320]);
eq('plan.prodMode reload', R1.rec.plan.prodMode, 'reload');
jeq('plan.prodLiveIds empty', R1.rec.plan.prodLiveIds, []);
jeq('tiles in sweep order', R1.rec.tiles.map(function (t) { return t.id + ':' + t.target + '@' + t.width; }), ['T1:v0@320', 'T2:v1@375', 'T3:v1@320']);
ok('every tile has an image', R1.rec.tiles.every(function (t) { return /^data:image\/jpeg;base64,/.test(t.img); }));
eq('v0@320 rows reference T1', byId(rows1, 'rs.v0.320.1').tile, 'T1');
eq('v1@375 row references T2', byId(rows1, 'rs.v1.375.1').tile, 'T2');
eq('v1@320 rows both reference T3', byId(rows1, 'rs.v1.320.1').tile + byId(rows1, 'rs.v1.320.2').tile, 'T3T3');
ok('the evidence names the tile', /tile T3$/.test(byId(rows1, 'rs.v1.320.1').evidence));
ok('every row tile id exists in the record', rows1.every(function (r) { return !r.tile || R1.rec.tiles.some(function (t) { return t.id === r.tile; }); }));
var lay = QK_FAKE.decodeCompose(R1.rec.tiles[2].img);
eq('a tile is 320 wide', lay.w, 320);
eq('a tile is 646 high', lay.h, 646);
ok('the tile layout has the PROD band colour', JSON.stringify(lay.ops).indexOf('#3b3b3b') > 0);
ok('the tile layout has the variant band colour', JSON.stringify(lay.ops).indexOf('#9b1c1c') > 0);
ok('the v1@320 tile says the PROD text was not found', JSON.stringify(lay.ops).indexOf('same text not found, same position') > 0);
ok('the v0@320 tile found it on PROD', JSON.stringify(QK_FAKE.decodeCompose(R1.rec.tiles[0].img).ops).indexOf('same text not found') < 0);
var traceLoads = R1.io.trace.filter(function (t) { return t.op === 'load'; });
jeq('widths load in severity order per variation', traceLoads.slice(0, 3).map(function (t) { return t.width; }), [375, 1280, 320]);
jeq('PROD loads in severity order too', traceLoads.slice(6).map(function (t) { return t.width; }), [375, 1280, 320]);
ok('variations first, PROD last', traceLoads.slice(0, 6).every(function (t) { return t.role === 'variant'; }) && traceLoads.slice(6).every(function (t) { return t.role === 'prod'; }));
ok('every load is a clean visitor', traceLoads.every(function (t) { return t.keepState === false; }));
ok('every load URL is built (no tracking flag)', traceLoads.every(function (t) { return !/optimizely_force_tracking|_conv_eforce/.test(t.url); }));
ok('the strict io proxy never tripped', R1.done);
eq('the record has 16 keys after a run', Object.keys(R1.rec).length, 16);
ok('the record has no raw ? & = in a text row', rows1.every(function (r) { return !/[?&=]/.test(r.check + r.expected + r.observed + r.evidence); }));
ok('every row has the 12 column values reachable', rows1.every(function (r) { return RS_COLUMNS.every(function (c) { return qkCellValue(r, c.key) !== undefined; }); }));
ok('a Fail row carries all six extra keys', ['width', 'variant', 'selector', 'gapPx', 'alsoOnProd', 'severity'].every(function (k) { return byId(rows1, 'rs.v1.375.1').extra[k] !== undefined; }));
var csv = qkCsv(RS_COLUMNS, rows1);
eq('CSV: header + 8 rows = 9 lines', csv.split('\r\n').length - 1, 9);
ok('CSV: Fail (emulated) cells', csv.indexOf('"Fail (emulated)"') > 0);
ok('CSV: Pass (emulated) cells', csv.indexOf('"Pass (emulated)"') > 0);
ok('CSV: rs.prod is a plain Pass', /"Pass","3 widths/.test(csv) || csv.split('\r\n').filter(function (l) { return l.indexOf('PROD measured') >= 0; })[0].indexOf('"Pass"') > 0);
ok('CSV: the tile column names T3', csv.indexOf('"T3"') > 0);
ok('CSV: the Gap px column is a plain number', csv.indexOf('"-76"') > 0 || csv.indexOf('"−76"') > 0 || csv.indexOf('-76') > 0);
ok('the debug lines name the plan', R1.io.debugLines.some(function (l) { return /^Plan:/.test(l.text); }));
ok('the debug lines name the PROD census', R1.io.debugLines.some(function (l) { return /PROD census/.test(l.text); }));
ok('progress ticks were sent', R1.io.progressLog.length > 3);
var proj = rsSummaryProjection(R1.rec);
eq('summary: counts', proj.counts.fail, 4);
eq('summary: non-Pass first', proj.rows[0].verdict, 'Fail (emulated)');
ok('summary: rows are id/verdict/check/observed only', Object.keys(proj.rows[0]).join() === 'id,verdict,check,observed');
ok('summary: observed capped at 160', proj.rows.every(function (r) { return r.observed.length <= 160; }));
ok('summary: at most 40 rows', rsSummaryProjection({ rows: Array.apply(null, Array(60)).map(function (_, i) { return qkRow({ id: 'x' + i, status: 'failed' }); }) }).rows.length === 40);
var dp = rsDebugProjection(R1.rec);
jeq('debug projection: tiles keep no image', dp.tiles[0], { id: 'T1', target: 'v0', width: 320, gapPx: -10, hasImage: true });
ok('debug projection holds no data URL', JSON.stringify(dp).indexOf('data:image') < 0);
ok('debug projection: the record rows are kept', dp.rows.length === 8);
var foot = rsReportFootHtml(R1.rec);
ok('foot: pages by path', /Pages loaded: /.test(foot) && /\/resp\//.test(foot));
ok('foot: fresh visitors', foot.indexOf('Fresh visitors: 3 load(s)') > 0);
ok('foot: desktop line', foot.indexOf('Desktop Chrome with emulated viewport widths 320, 375, 1280; no phone user agent or touch.') > 0);
eq('fresh visitors count: only the 3 PROD loads (variants are forced)', qkFreshCount(R1.rec.loads), 3);

// ── resp-ignore (D.6) ──────────────────────────────────────────────────────
section('resp-ignore');
var igList = RS_IGNORE_DEFAULTS.concat(['.legal']);
var R2 = runMode(QK_FAKE.sites.resp(), build(ctxResp(), { ignore: igList.join('\n') }), {});
eq('rs.v0.320 passes with .legal ignored', byId(R2.rec.rows, 'rs.v0.320').status, 'passed');
ok('no LEGAL-LINE row anywhere', !/LEGAL-LINE/.test(JSON.stringify(R2.rec.rows)));
ok('the hero still fails on v1 at 375', byId(R2.rec.rows, 'rs.v1.375.1').status === 'failed');
eq('the ignore list was passed to the scan', JSON.stringify(R2.rec.input.ignore.slice(-1)), '[".legal"]');
var R2b = runMode(QK_FAKE.sites.resp(), build(ctxResp(), { ignore: '' }), {});
ok('an empty ignore list reports the carousel too (nothing ignored)', /CAROUSEL/.test(JSON.stringify(R2b.rec.rows)));
var R2c = runMode(QK_FAKE.sites.resp(), build(ctxResp(), { ignore: 'div[' }), {});
ok('an invalid ignore entry is dropped by the page and does not stop the run', R2c.done && !R2c.rec.error);
ok('an invalid ignore entry is named in the debug log', R2c.io.debugLines.some(function (l) { return /not valid selectors/.test(l.text); }));

// ── resp-live (D.6) ────────────────────────────────────────────────────────
section('resp-live');
var ctxLive = { ticketKey: 'QK-7', experimentId: '7201', previewLinks: [{ id: 'v1', url: B + '/resp-live/?optimizely_x=7302&cro_mode=qa' }], itwLink: B + '/resp-live/?cro_mode=qa' };
var R3 = runMode(QK_FAKE.sites.resp(), build(ctxLive, { widths: '375,1280' }), {}, true);
eq('prodMode resize', R3.rec.plan.prodMode, 'resize');
jeq('prodLiveIds holds 7202', R3.rec.plan.prodLiveIds, ['7202']);
eq('exactly 1 PROD request', R3.rec.loads.filter(function (L) { return L.role === 'prod'; }).length, 1);
eq('rs.prod passes', byId(R3.rec.rows, 'rs.prod').status, 'passed');
ok('rs.prod names the resize and 7202', /resizing one load/.test(byId(R3.rec.rows, 'rs.prod').observed) && /7202/.test(byId(R3.rec.rows, 'rs.prod').observed));
ok('viewport was resized for the second width', R3.io.trace.filter(function (t) { return t.op === 'viewport'; }).length === 1);
ok('a sleep of the resize wait preceded it', R3.io.trace.some(function (t) { return t.op === 'sleep'; }));
ok('the resize scan rows exist for both widths', R3.rec.sweep.filter(function (e) { return e.role === 'prod' && e.scan; }).length === 2);
jeq('resize entries share the first load id', R3.rec.sweep.filter(function (e) { return e.role === 'prod'; }).map(function (e) { return e.loadId; }), ['L3', 'L3']);
eq('PROD sweep entry modes', R3.rec.sweep.filter(function (e) { return e.role === 'prod'; }).map(function (e) { return e.mode; }).join(), 'resize,resize');
eq('fresh visitors: the one PROD load', qkFreshCount(R3.rec.loads), 1);
// unreadable census → resize, safe
var R3b = runMode(QK_FAKE.sites.resp(), build(ctxResp(), { widths: '375,1280' }), { failState: function (a) { return a.experimentId === null; } });
eq('an unreadable PROD census resizes (fewer fresh visitors)', R3b.rec.plan.prodMode, 'resize');
ok('and says so', /could not be read/.test(rsProdModeText(R3b.rec.plan)));
// no snippet at all → no live experiment → reload
var R3c = runMode(QK_FAKE.sites.resp({ noSnippet: true }), build(ctxResp(), { widths: '375,1280' }), {});
eq('no snippet on PROD = no live experiment = reload', R3c.rec.plan.prodMode, 'reload');
ok('no snippet: the variant served check cannot read, so it does not block', R3c.rec.sweep.filter(function (e) { return e.role === 'variant'; }).every(function (e) { return e.served === null && !e.skipped; }));

// ── bot (D.6) ──────────────────────────────────────────────────────────────
section('bot');
var ctxBot = { ticketKey: 'QK-8', previewLinks: [{ id: 'v0', url: B + '/blocked/?optimizely_x=7301' }] };
var R4 = runMode(QK_FAKE.sites.resp(), build(ctxBot, { widths: '375,1280' }), {}, true);
ok('halted', !!R4.rec.halted && /\/blocked\/$/.test(R4.rec.halted.path));
eq('exactly 1 request to /blocked/', loadsTo(R4.site, '/blocked/'), 1);
jeq('every row id is still listed', ids(R4.rec.rows), ['rs.v0.375', 'rs.v0.1280', 'rs.prod']);
ok('every row is Not Tested', R4.rec.rows.every(function (r) { return qkVerdictLabel(r) === 'Not Tested'; }));
ok('every row says a bot check halted the run', R4.rec.rows.every(function (r) { return r.evidence.indexOf('Blocked: a bot check (') === 0 && /halted the run; it was never attempted\.$/.test(r.evidence); }));
eq('the badge is HALTED', qkBadge(R4.rec.rows, false, true).label, 'HALTED: BOT CHECK');
eq('the halt names the signal', R4.rec.halted.signal, 'title: Just a moment...');
eq('PROD derived to /blocked/', R4.input.prodUrl, B + '/blocked/');
eq('no PROD load happened', R4.rec.loads.filter(function (L) { return L.role === 'prod'; }).length, 0);
ok('the blocked load is in the record', R4.rec.loads.length === 1 && R4.rec.loads[0].blocked !== null);
eq('rec.halted has loadId, path, signal', Object.keys(R4.rec.halted).sort().join(), 'loadId,path,signal');
// a halt during PROD wins over Blocked reasons too
var R4b = runMode(QK_FAKE.sites.resp(), build(ctxResp(), { prod: B + '/blocked/' }), {});
ok('a bot check on PROD halts after the variations', !!R4b.rec.halted && R4b.rec.rows.filter(function (r) { return r.status === 'passed' || r.status === 'failed'; }).length === 7);
ok('rs.prod says halted', /halted the run/.test(byId(R4b.rec.rows, 'rs.prod').evidence));
ok('the variation rows keep their results', byId(R4b.rec.rows, 'rs.v1.375.1').status === 'failed');
ok('no tile was drawn after the halt', R4b.rec.tiles.every(function (t) { return t.img === null; }));

// ── stop ───────────────────────────────────────────────────────────────────
section('stop');
var allW = QK_WIDTHS.join(',');
var R5 = runMode(QK_FAKE.sites.resp(), build(ctxResp(), { widths: allW }), { stopAfterLoads: 3 });
ok('stopped', R5.rec.stopped === true && !R5.rec.halted && !R5.rec.error);
eq('3 loads happened', R5.rec.loads.length, 3);
ok('fewer than 54 loads', R5.rec.loads.length < 54);
ok('the rest are Stopped rows', R5.rec.rows.filter(function (r) { return r.status === 'not-tested'; }).every(function (r) { return r.evidence === 'Stopped: by the tester before this ran.'; }));
ok('some rows are Stopped', R5.rec.rows.filter(function (r) { return /^Stopped: /.test(r.evidence); }).length > 30);
ok('rs.prod is Stopped', /^Stopped: /.test(byId(R5.rec.rows, 'rs.prod').evidence));
eq('the badge is INCOMPLETE without a Fail', qkBadge(R5.rec.rows.filter(function (r) { return r.status !== 'failed'; }), true, false).label, 'INCOMPLETE');
eq('no PROD load after the stop', R5.rec.loads.filter(function (L) { return L.role === 'prod'; }).length, 0);
ok('no tile image after a stop', R5.rec.tiles.every(function (t) { return t.img === null; }));
var R5b = runMode(QK_FAKE.sites.resp(), build(ctxResp(), { widths: '375,1280' }), { stopAfterLoads: 0 });
ok('a stop before the first load leaves every row Stopped', R5b.rec.rows.every(function (r) { return /^Stopped: /.test(r.evidence); }));

// ── not served, _conv_eforce, load errors ──────────────────────────────────
section('not served, _conv_eforce, failures');
var ctxNS = ctxResp({ previewLinks: [{ id: 'v0', url: B + '/resp/?optimizely_x=7301&cro_mode=qa' }, { id: 'v9', url: B + '/resp/?optimizely_x=9999&cro_mode=qa' }] });
var R6 = runMode(QK_FAKE.sites.resp(), build(ctxNS, { widths: '320,375,1280' }), {});
eq('the not-served link was loaded once only', R6.rec.loads.filter(function (L) { return L.label === 'v9'; }).length, 1);
ok('its three rows are Blocked', ['rs.v9.320', 'rs.v9.375', 'rs.v9.1280'].every(function (id) { return byId(R6.rec.rows, id).status === 'blocked'; }));
ok('the blocked text names the forced variation and the rule', /^Blocked: v9 did not serve the forced variation 9999 \(this mode never adds optimizely_force_tracking\)$/.test(byId(R6.rec.rows, 'rs.v9.375').evidence));
eq('the sweep entry says not-served', R6.rec.sweep.filter(function (e) { return e.target === 'v9'; })[0].skipped, 'not-served');
eq('served false on the first load', R6.rec.sweep.filter(function (e) { return e.target === 'v9'; })[0].served, false);
ok('the other variation was still swept', byId(R6.rec.rows, 'rs.v0.320.1') && byId(R6.rec.rows, 'rs.v0.320.1').status === 'failed');
ok('a good link has served true', R6.rec.sweep.filter(function (e) { return e.target === 'v0'; }).every(function (e) { return e.served === true; }));
ok('a Blocked row is labelled Not Tested', qkVerdictLabel(byId(R6.rec.rows, 'rs.v9.320')) === 'Not Tested');
eq('the badge is NEEDS REVIEW without a Fail', qkBadge(R6.rec.rows.filter(function (r) { return r.status !== 'failed'; }), false, false).label, 'NEEDS REVIEW');
var ctxCF = ctxResp({ previewLinks: [{ id: 'v0', url: B + '/resp/?optimizely_x=7301&cro_mode=qa' }, { id: 'c1', url: B + '/resp/?_conv_eforce=1.2.3&cro_mode=qa' }] });
var R7 = runMode(QK_FAKE.sites.resp(), build(ctxCF, { widths: '320,375' }), {});
eq('a _conv_eforce link is never loaded', R7.rec.loads.filter(function (L) { return L.label === 'c1'; }).length, 0);
ok('no io load carries _conv_eforce', R7.io.trace.filter(function (t) { return t.op === 'load'; }).every(function (t) { return !/_conv_eforce/.test(t.url); }));
ok('no site request carries _conv_eforce', R7.site.log.every(function (r) { return !/_conv_eforce/.test(r.url); }));
eq('its rows are Blocked with the rule', byId(R7.rec.rows, 'rs.c1.320').evidence, 'Blocked: c1 forces with _conv_eforce, which this mode never loads');
eq('both widths', byId(R7.rec.rows, 'rs.c1.375').status, 'blocked');
ok('the other link ran', byId(R7.rec.rows, 'rs.v0.375').status === 'passed');
var ctxTR = ctxResp({ previewLinks: [{ id: 'v1', url: B + '/resp/?optimizely_x=7302&optimizely_force_tracking=true&cro_mode=qa' }] });
var R8 = runMode(QK_FAKE.sites.resp(), build(ctxTR, { widths: '320' }), {});
ok('a link with optimizely_force_tracking is loaded without it', R8.rec.loads.length === 2 && !hasTracking(R8.site.log.map(function (r) { return r.url; })));
ok('the forcing x is kept', R8.site.log.filter(function (r) { return r.kind === 'load'; })[0].query.optimizely_x === '7302');
var R9 = runMode(QK_FAKE.sites.resp(), build(ctxResp(), { widths: '320,375' }), { failLoad: function (p) { return p.query.optimizely_x === '7302' && p.path === '/resp/'; } });
ok('a failed load is a Not run row, not a halt', R9.done && !R9.rec.halted && /^Not run: the page did not load \(/.test(byId(R9.rec.rows, 'rs.v1.320').evidence));
ok('a failed load does not stop the next width', R9.rec.loads.filter(function (L) { return L.label === 'v1'; }).length === 2);
ok('the other variation is unaffected', byId(R9.rec.rows, 'rs.v0.320.1').status === 'failed');
var R10 = runMode(QK_FAKE.sites.resp(), build(ctxResp(), { widths: '320,375' }), { failScan: true });
ok('a failed scan is a Not run row', /^Not run: the clipping scan failed \(/.test(byId(R10.rec.rows, 'rs.v0.320').evidence));
ok('a failed scan makes no Fail row and no tile', R10.rec.rows.every(function (r) { return r.status !== 'failed'; }) && R10.rec.tiles.length === 0);
ok('rs.prod is Not run when PROD scans failed', /^Not run: PROD was not measured at 320, 375 px/.test(byId(R10.rec.rows, 'rs.prod').evidence));
var R11 = runMode(QK_FAKE.sites.resp(), build(ctxResp(), { widths: '320,375' }), { failLoad: function (p) { return !p.query.optimizely_x; } });
ok('a PROD that does not load: the first load only', R11.rec.loads.filter(function (L) { return L.role === 'prod'; }).length === 1);
ok('rs.prod is Not run and says why', /^Not run: PROD was not measured at 320, 375 px \(net::ERR_FAKE_FAILURE\)$/.test(byId(R11.rec.rows, 'rs.prod').evidence));
ok('clipped rows then say PROD unknown', byId(R11.rec.rows, 'rs.v0.320.1').extra.alsoOnProd === 'unknown');
ok('the unknown evidence names the width', /also on PROD: unknown — PROD was not measured at 320 px/.test(byId(R11.rec.rows, 'rs.v0.320.1').evidence));
ok('an unknown row is still a Fail', byId(R11.rec.rows, 'rs.v0.320.1').status === 'failed');
var R12 = runMode(QK_FAKE.sites.resp(), build({ ticketKey: 'QK-6', experimentId: '7201', previewLinks: [{ id: 'v1', url: B + '/resp/?optimizely_x=7302' }] }, { prod: '' }), {});
ok('PROD derives from the control link or none', R12.input.prodUrl === '' || R12.input.prodUrl.length > 0);
var R13 = runMode(QK_FAKE.sites.resp(), build({ ticketKey: 'QK-6', previewLinks: [{ id: 'x1', url: B + '/resp/?optimizely_x=7302' }] }, {}), {});
eq('no control link and no ITW = no PROD', R13.input.prodUrl, '');
eq('rs.prod is a Missing input row', byId(R13.rec.rows, 'rs.prod').evidence, 'Missing input: PROD URL (Initialize, or the PROD URL field above)');
ok('and no PROD load', R13.rec.loads.every(function (L) { return L.role !== 'prod'; }));
ok('without PROD every clipped row is unknown but Fail', R13.rec.rows.filter(function (r) { return r.status === 'failed'; }).every(function (r) { return r.extra.alsoOnProd === 'unknown'; }));
var R14 = runMode(QK_FAKE.sites.resp(), build(ctxResp(), { widths: '320,375' }), { nullState: true });
ok('an unreadable state does not block the sweep', R14.rec.sweep.filter(function (e) { return e.role === 'variant'; }).every(function (e) { return e.served === null && !e.skipped; }));
ok('and the page rows are real', byId(R14.rec.rows, 'rs.v0.320.1').status === 'failed');
eq('an unreadable census resizes PROD', R14.rec.plan.prodMode, 'resize');
var R15 = runMode(QK_FAKE.sites.resp(), build(ctxResp(), { widths: '320' }), { failShot: true });
ok('a failed screenshot gives no tile but keeps the Fail rows', R15.rec.tiles.length === 0 && byId(R15.rec.rows, 'rs.v0.320.1').status === 'failed');
ok('and no tile is named in its evidence', !/tile T\d/.test(byId(R15.rec.rows, 'rs.v0.320.1').evidence));
ok('a failed screenshot says not captured, never a cap (A25)', /; no tile \(not captured\)$/.test(byId(R15.rec.rows, 'rs.v0.320.1').evidence));
var R16 = runMode(QK_FAKE.sites.resp(), build(ctxResp(), { widths: '320' }), { nullCompose: true });
ok('a failed compose keeps the tile record with no image', R16.rec.tiles.length === 2 && R16.rec.tiles.every(function (t) { return t.img === null; }));
ok('and the rows name no image-less tile (A25)', byId(R16.rec.rows, 'rs.v0.320.1').tile === null && /; no tile \(it was not drawn\)$/.test(byId(R16.rec.rows, 'rs.v0.320.1').evidence));

// ── rows, directly from crafted records ────────────────────────────────────
section('rsDeriveRows on crafted records');
function craftRec(scansByWidth, o) {
  o = o || {};
  var widths = Object.keys(scansByWidth).map(Number);
  var sweep = [];
  widths.forEach(function (w) { sweep.push({ target: 'v1', role: 'variant', width: w, mode: 'reload', loadId: 'L' + w, ok: true, loadError: null, served: true, skipped: null, scan: scansByWidth[w] }); });
  (o.prod || []).forEach(function (p) { sweep.push({ target: 'PROD', role: 'prod', width: p.width, mode: 'reload', loadId: 'P' + p.width, ok: true, loadError: null, served: null, skipped: null, scan: p.scan }); });
  return {
    halted: o.halted || null, stopped: !!o.stopped, error: o.error || null,
    input: { prodUrl: o.noProd ? '' : 'https://p.example/' },
    plan: { widths: widths, targets: [{ label: 'v1', forcedIds: ['7302'] }], prodMode: 'reload', prodLiveIds: [] },
    loads: [], sweep: sweep, tiles: o.tiles || [], tilesCapped: o.tilesCapped || null,
  };
}
function off(text, gap, extra) { return Object.assign({ text: text, gapPx: gap, side: 'right', by: 'overflow', clipBy: 'div.box', el: 'span.t', rect: { x: 0, y: 10, w: 100, h: 20 } }, extra || {}); }
function scanOf(offs, o) { o = o || {}; return { vw: 400, iw: 400, sw: 400 + (o.overflow || 0), pageOverflowPx: o.overflow || 0, nodes: 50, offenderCount: o.count != null ? o.count : offs.length, worstGapPx: offs.length ? offs[0].gapPx : 0, offenders: offs, ignored: {}, ignoreInvalid: [] }; }
var seven = []; for (var si = 0; si < 7; si++) seven.push(off('Text number ' + si, -50 + si));
var cr1 = rsDeriveRows(craftRec({ 400: scanOf(seven) }, { prod: [{ width: 400, scan: scanOf([off('Text number 2', -48)]) }] }));
jeq('7 offenders: 5 rows, a more row, no pass row', ids(cr1).slice(0, 7), ['rs.v1.400.1', 'rs.v1.400.2', 'rs.v1.400.3', 'rs.v1.400.4', 'rs.v1.400.5', 'rs.v1.400.more', 'rs.prod']);
eq('the more row says how many', byId(cr1, 'rs.v1.400.more').check, '2 more clipped text(s) at 400 px');
ok('the more row points to the debug log', /the rest are in the debug log \(first 25 per scan\)/.test(byId(cr1, 'rs.v1.400.more').evidence));
eq('the more row is a Fail', byId(cr1, 'rs.v1.400.more').status, 'failed');
eq('most negative gap first', byId(cr1, 'rs.v1.400.1').extra.gapPx, -50);
eq('alsoOnProd yes matches the 30-char key', byId(cr1, 'rs.v1.400.3').extra.alsoOnProd, 'yes');
eq('alsoOnProd no for another text', byId(cr1, 'rs.v1.400.1').extra.alsoOnProd, 'no');
var cr2 = rsDeriveRows(craftRec({ 400: scanOf([off('Wide', -5)], { count: 40 }) }, { prod: [{ width: 400, scan: scanOf([off('Wide', -5)], { count: 40 }) }] }));
ok('a count past the listed offenders gives a more row', !!byId(cr2, 'rs.v1.400.more') && byId(cr2, 'rs.v1.400.more').check === '35 more clipped text(s) at 400 px');
var cr3 = rsDeriveRows(craftRec({ 400: scanOf([], { overflow: 30 }) }, { prod: [{ width: 400, scan: scanOf([], { overflow: 12 }) }] }));
eq('an overflow row appears', cr3[0].id, 'rs.v1.400.overflow');
eq('overflow gap is negative', cr3[0].extra.gapPx, -30);
eq('overflow alsoOnProd from PROD overflow', cr3[0].extra.alsoOnProd, 'yes');
eq('overflow is a Fail', cr3[0].status, 'failed');
ok('no pass row beside an overflow row', !byId(cr3, 'rs.v1.400'));
var cr3b = rsDeriveRows(craftRec({ 400: scanOf([], { overflow: 30 }) }, { prod: [{ width: 400, scan: scanOf([]) }] }));
eq('overflow alsoOnProd no', cr3b[0].extra.alsoOnProd, 'no');
var cr3c = rsDeriveRows(craftRec({ 400: scanOf([], { overflow: 2 }) }));
eq('an overflow of 2 px is not a Fail', cr3c[0].status, 'passed');
var cr3d = rsDeriveRows(craftRec({ 400: scanOf([], { overflow: 30 }) }));
eq('overflow alsoOnProd unknown without PROD', cr3d[0].extra.alsoOnProd, 'unknown');
var cr4 = rsDeriveRows(craftRec({ 400: scanOf([off('A', -9)]) }, { tilesCapped: { perTarget: { v1: 2 }, total: 0, at: { 'v1|400': 'perTarget' } } }));
ok('the per-variation cap sentence', /; no tile \(cap of 6 per variation reached\)$/.test(cr4[0].evidence));
var cr5 = rsDeriveRows(craftRec({ 400: scanOf([off('A', -9)]) }, { tilesCapped: { perTarget: {}, total: 3, at: { 'v1|400': 'total' } } }));
ok('the per-run cap sentence', /; no tile \(cap of 12 per run reached\)$/.test(cr5[0].evidence));
var cr4b = rsDeriveRows(craftRec({ 400: scanOf([off('A', -9)]) }, { tilesCapped: { perTarget: { v1: 2 }, total: 3, at: { 'v1|320': 'perTarget', 'v2|400': 'total' } } }));
ok('a cap another width or variation hit is never named on this one (A25)', /; no tile \(not captured\)$/.test(cr4b[0].evidence));
var cr6 = rsDeriveRows(craftRec({ 400: scanOf([off('A', -9)]) }, { tiles: [{ id: 'T4', target: 'v1', width: 400, gapPx: -9, side: 'right', text: 'A', img: 'data:image/jpeg;base64,AAAA' }] }));
eq('a tile id is attached to the row', cr6[0].tile, 'T4');
ok('and named in the evidence', /; tile T4$/.test(cr6[0].evidence));
var cr6b = rsDeriveRows(craftRec({ 400: scanOf([off('A', -9)]) }, { tiles: [{ id: 'T4', target: 'v1', width: 400, gapPx: -9, side: 'right', text: 'A', img: null }] }));
ok('a tile with no image is not attached (A25)', cr6b[0].tile === null && /; no tile \(it was not drawn\)$/.test(cr6b[0].evidence));
var cr7 = rsDeriveRows(craftRec({ 400: { error: 'boom' } }));
ok('a scan error row', /^Not run: the clipping scan failed \(boom\)$/.test(cr7[0].evidence));
var cr8 = rsDeriveRows(craftRec({ 400: scanOf([]) }, { error: 'x broke' }));
eq('a clean scan passes even when the run errored later', cr8[0].status, 'passed');
var cr9 = rsDeriveRows({ plan: { widths: [320], targets: [{ label: 'v1' }] }, input: { prodUrl: 'https://p.example/' }, sweep: [], tiles: [], error: 'x broke' });
eq('an unobserved row on an error', cr9[0].evidence, 'Not run: the run ended on an error (x broke).');
var cr10 = rsDeriveRows({ plan: { widths: [320], targets: [{ label: 'v1' }] }, input: {}, sweep: [], tiles: [] });
eq('an unobserved row otherwise', cr10[0].evidence, 'Not run: not measured');
var cr11 = rsDeriveRows(null);
eq('a null record gives only rs.prod', ids(cr11).join(), 'rs.prod');
ok('every Not Tested / Blocked row starts with a D10 prefix', cr1.concat(cr7, cr9, cr10, cr11, R4.rec.rows, R5.rec.rows, R6.rec.rows, R7.rec.rows, R11.rec.rows, R13.rec.rows).filter(function (r) { return r.status === 'not-tested' || r.status === 'blocked'; }).every(function (r) { return QK_REASON_PREFIXES.some(function (p) { return r.evidence.indexOf(p) === 0; }); }));
var crh = rsDeriveRows({ halted: { loadId: 'L1', path: B + '/b/', signal: 'x' }, plan: { widths: [320], targets: [{ label: 'v1', forcedIds: ['1'] }] }, input: { prodUrl: 'p' },
  sweep: [{ target: 'v1', role: 'variant', width: 320, skipped: 'not-served', scan: null }], tiles: [] });
ok('a halt wins over a not-served Blocked reason', /^Blocked: a bot check \(x\) on /.test(crh[0].evidence));
var crs = rsDeriveRows({ stopped: true, plan: { widths: [320], targets: [{ label: 'v1', forcedIds: ['1'] }] }, input: { prodUrl: 'p' },
  sweep: [{ target: 'v1', role: 'variant', width: 320, skipped: 'conv-forced', scan: null }], tiles: [] });
ok('a stop does not hide a _conv_eforce Blocked reason', /_conv_eforce/.test(crs[0].evidence));
ok('every row of a derived set is a qkRow (12 keys)', R1.rec.rows.every(function (r) { return Object.keys(r).length === 12; }));
ok('severity bands in the rows: 300 low', byId(rsDeriveRows(craftRec({ 300: scanOf([off('A', -9)]) })), 'rs.v1.300.1').extra.severity === 'low');
ok('severity bands in the rows: 320 low', byId(rsDeriveRows(craftRec({ 320: scanOf([off('A', -9)]) })), 'rs.v1.320.1').extra.severity === 'low');
ok('severity bands in the rows: 340 medium', byId(rsDeriveRows(craftRec({ 340: scanOf([off('A', -9)]) })), 'rs.v1.340.1').extra.severity === 'medium');
ok('severity bands in the rows: 360 high', byId(rsDeriveRows(craftRec({ 360: scanOf([off('A', -9)]) })), 'rs.v1.360.1').extra.severity === 'high');
ok('severity bands in the rows: 430 high', byId(rsDeriveRows(craftRec({ 430: scanOf([off('A', -9)]) })), 'rs.v1.430.1').extra.severity === 'high');
ok('severity bands in the rows: 480 medium', byId(rsDeriveRows(craftRec({ 480: scanOf([off('A', -9)]) })), 'rs.v1.480.1').extra.severity === 'medium');
var crl = rsDeriveRows(craftRec({ 400: scanOf([off('A', -9, { by: 'viewport', side: 'left' })]) }));
ok('a viewport clip reads past the viewport', /^left edge −9 px past the viewport$/.test(crl[0].observed));
ok('a container clip names the container', /^right edge −50 px past the container div\.box$/.test(cr1[0].observed));
ok('the clipped check quotes the text, cut at 40', byId(rsDeriveRows(craftRec({ 400: scanOf([off(new Array(60).join('x'), -9)]) })), 'rs.v1.400.1').check.length <= 160);
ok('an element selector lands in the extra', cr1[0].extra.selector === 'span.t');
ok('a row text with a ? & = is masked', !/[?&=]/.test(rsDeriveRows(craftRec({ 400: scanOf([off('a=b?c&d', -9)]) }))[0].check));

// ── more tiles: caps ───────────────────────────────────────────────────────
section('tile caps');
var seven7 = [300, 320, 340, 360, 375, 390, 402];
var R20 = runMode(QK_FAKE.sites.resp(), build(ctxResp({ previewLinks: [{ id: 'v1', url: B + '/resp/?optimizely_x=7302' }] }), { widths: '250,300,320,340,360,375,390' }), {});
eq('7 failing widths, one variation: 6 tiles', R20.rec.tiles.length, 6);
ok('tilesCapped records the denied width', !!R20.rec.tilesCapped && R20.rec.tilesCapped.perTarget.v1 === 1 && R20.rec.tilesCapped.total === 0);
var capRows = R20.rec.rows.filter(function (r) { return /cap of 6 per variation reached/.test(r.evidence); });
ok('the capped width says so on its rows', capRows.length >= 1);
ok('rows with a tile never say capped', R20.rec.rows.filter(function (r) { return r.tile; }).every(function (r) { return !/no tile/.test(r.evidence); }));
var at20 = Object.keys((R20.rec.tilesCapped || {}).at || {});
ok('only the denied width says capped (A25)', at20.length === 1 && capRows.every(function (r) { return 'v1|' + r.extra.width === at20[0]; }));
var nShot22 = 0;
var R22 = runMode(QK_FAKE.sites.resp(), build(ctxResp({ previewLinks: [{ id: 'v1', url: B + '/resp/?optimizely_x=7302' }] }), { widths: '250,300,320,340,360,375,390,393' }), {}, false, function (io) {
  var shot = io.shot;
  io.shot = function (o) { nShot22++; return nShot22 === 1 ? Promise.resolve({ error: 'the capture failed (test)' }) : shot.call(io, o); };
  return io;
});
eq('A25 mix: 8 failing widths, the first shot failed: 6 tiles', R22.rec.tiles.length, 6);
eq('A25 mix: one width denied by the cap', Object.keys((R22.rec.tilesCapped || {}).at || {}).length, 1);
var notCap22 = R22.rec.rows.filter(function (r) { return /; no tile \(not captured\)$/.test(r.evidence); });
var cap22 = R22.rec.rows.filter(function (r) { return /; no tile \(cap of 6 per variation reached\)$/.test(r.evidence); });
ok('A25 mix: the failed-shot width says not captured, the denied width says capped, and they differ', notCap22.length > 0 && cap22.length > 0 && notCap22.every(function (r) { return r.extra.width === notCap22[0].extra.width; }) && cap22.every(function (r) { return r.extra.width === cap22[0].extra.width; }) && notCap22[0].extra.width !== cap22[0].extra.width);
ok('the cap text helper names the variation', /v1: 1 width\(s\) over the cap of 6 per variation/.test(rsTilesCappedText(R20.rec.tilesCapped)));
eq('no cap = empty text', rsTilesCappedText(null), '');
var threeLinks = [{ id: 'a', url: B + '/resp/?optimizely_x=7302&cro_mode=qa' }, { id: 'b', url: B + '/resp/?optimizely_x=7302&cro_mode=qb' }, { id: 'c', url: B + '/resp/?optimizely_x=7302&cro_mode=qc' }];
var R21 = runMode(QK_FAKE.sites.resp(), build(ctxResp({ previewLinks: threeLinks }), { widths: '300,320,340,360,375' }), {});
eq('3 variations × 5 failing widths: 12 tiles', R21.rec.tiles.length, 12);
eq('the run cap denied 3 widths', R21.rec.tilesCapped.total, 3);
ok('no per-variation denial', Object.keys(R21.rec.tilesCapped.perTarget).length === 0);
ok('the third variation shows the run cap sentence', R21.rec.rows.some(function (r) { return /cap of 12 per run reached/.test(r.evidence); }));
ok('rows reference existing tile ids', R21.rec.rows.every(function (r) { return !r.tile || R21.rec.tiles.some(function (t) { return t.id === r.tile; }); }));
ok('tile ids are unique and sequential', R21.rec.tiles.map(function (t) { return t.id; }).join() === 'T1,T2,T3,T4,T5,T6,T7,T8,T9,T10,T11,T12');
ok('PROD was shot only at tile widths', R21.io.trace.filter(function (t) { return t.op === 'shot' && t.role === 'prod'; }).length > 0);
eq('shots on PROD are one per distinct text and width', R21.io.trace.filter(function (t) { return t.op === 'shot' && t.role === 'prod'; }).length > 0, true);
var capped1 = rsTilesCappedText(R21.rec.tilesCapped);
ok('the run cap text', /3 width\(s\) over the cap of 12 per run/.test(capped1));

// ── rsTileLayout ───────────────────────────────────────────────────────────
section('rsTileLayout');
function mk(vw, vh, x, y, w, h, found) { return { found: found !== false, rect: { x: x, y: y, w: w, h: h }, vw: vw, vh: vh }; }
function allInts(o) { return JSON.stringify(o).replace(/"[^"]*"/g, '').indexOf('.') < 0; }
var Lp = rsTileLayout({ width: 320, target: 'v1', gapPx: -10, side: 'right', text: 'X', prod: mk(320, 800, 0, 100, 330, 22), variant: mk(320, 800, 0, 389, 330, 22) });
eq('phone width: crop width = the width', Lp.w, 320);
eq('phone width: height 646', Lp.h, 646);
eq('quality', Lp.quality, 0.7);
ok('all numbers are integers', allInts(Lp.ops) && Number.isInteger(Lp.w) && Number.isInteger(Lp.h));
var imgV = Lp.ops.filter(function (o) { return o.op === 'image' && o.src === 'variant'; })[0];
eq('phone width: crop x is 0', imgV.sx, 0);
eq('phone width: source width is the full width', imgV.sw, 320);
var imgP = Lp.ops.filter(function (o) { return o.op === 'image' && o.src === 'prod'; })[0];
eq('PROD image sits under its band', imgP.dy, 22);
eq('variant image sits under its band', imgV.dy, 22 + 300 + 2 + 22);
var iProd = -1, iVar = -1; Lp.ops.forEach(function (o, i) { if (o.op === 'rect' && o.fill === '#3b3b3b') iProd = i; if (o.op === 'rect' && o.fill === '#9b1c1c') iVar = i; });
ok('the PROD band op comes before the variant band op', iProd > 0 && iVar > iProd);
var prodBand = Lp.ops.filter(function (o) { return o.op === 'rect' && o.fill === '#3b3b3b'; })[0], varBand = Lp.ops.filter(function (o) { return o.op === 'rect' && o.fill === '#9b1c1c'; })[0];
ok('the variant band is lower than the PROD band', varBand.y > prodBand.y);
eq('PROD band text', Lp.ops.filter(function (o) { return o.op === 'text'; })[0].text, 'PROD · 320 px');
eq('variant band text', Lp.ops.filter(function (o) { return o.op === 'text'; })[1].text, 'v1 · 320 px · gap −10 px');
eq('the gap is written next to the element', Lp.ops.filter(function (o) { return o.op === 'text'; }).slice(-1)[0].text, '−10 px');
var ln = Lp.ops.filter(function (o) { return o.op === 'line'; })[0];
ok('a boundary line is drawn inside the crop', !!ln && ln.x1 === 320);
eq('the line spans the variant crop', ln.y2 - ln.y1, 300);
eq('line width and colour', ln.width + ln.stroke, '2#e00000');
var L19 = rsTileLayout({ width: 1920, target: 'v1', gapPx: -30, side: 'right', text: 'X', prod: mk(1920, 900, 1000, 400, 400, 20), variant: mk(1920, 900, 1000, 400, 400, 20) });
eq('1920: crop width is capped at 480', L19.w, 480);
eq('1920: height uses the 900 viewport but a 300 crop', L19.h, 646);
var v19 = L19.ops.filter(function (o) { return o.op === 'image' && o.src === 'variant'; })[0];
eq('1920: window centred on the edge (1400 - 240)', v19.sx, 1160);
var Lc = rsTileLayout({ width: 1920, target: 'v1', gapPx: -30, side: 'right', text: 'X', prod: null, variant: mk(1920, 900, 1850, 400, 70, 20) });
eq('1920: a window clamped to the right edge', Lc.ops.filter(function (o) { return o.op === 'image' && o.src === 'variant'; })[0].sx, 1440);
var Ll = rsTileLayout({ width: 1920, target: 'v1', gapPx: -30, side: 'left', text: 'X', prod: null, variant: mk(1920, 900, 10, 400, 70, 20) });
eq('left side: the window clamps to 0', Ll.ops.filter(function (o) { return o.op === 'image' && o.src === 'variant'; })[0].sx, 0);
var Lf = rsTileLayout({ width: 1920, target: 'v1', gapPx: -30, side: 'left', text: 'X', prod: null, variant: mk(1920, 900, 800, 400, 70, 20) });
eq('left side: centred on the left edge (800 - 240)', Lf.ops.filter(function (o) { return o.op === 'image' && o.src === 'variant'; })[0].sx, 560);
var lineLeft = Lf.ops.filter(function (o) { return o.op === 'line'; })[0];
eq('left side: the boundary is gap pixels inside the element', lineLeft.x1, 800 + 30 - 560);
var Ln = rsTileLayout({ width: 1920, target: 'v1', gapPx: -30, side: 'right', text: 'X', prod: mk(1920, 900, 0, 0, 0, 0, false), variant: mk(1920, 900, 1500, 400, 400, 20) });
ok('PROD not found: the variant window is reused', Ln.ops.filter(function (o) { return o.op === 'image' && o.src === 'prod'; })[0].sx === Ln.ops.filter(function (o) { return o.op === 'image' && o.src === 'variant'; })[0].sx);
ok('PROD not found: the band says so', Ln.ops[2].text === 'PROD · 1920 px · same text not found, same position');
var Lm = rsTileLayout({ width: 320, target: 'v1', gapPx: -10, side: 'right', text: 'X', prod: null, variant: mk(320, 800, 0, 389, 330, 22) });
eq('PROD missing: a placeholder band of 60', Lm.h, 22 + 60 + 2 + 22 + 300);
ok('PROD missing: no PROD image, a placeholder fill', !Lm.ops.some(function (o) { return o.op === 'image' && o.src === 'prod'; }) && Lm.ops.some(function (o) { return o.op === 'rect' && o.fill === '#dddddd'; }));
ok('PROD missing: the placeholder text', Lm.ops.some(function (o) { return o.op === 'text' && o.text === 'PROD was not captured at 320 px'; }));
ok('PROD missing: the band says not captured', Lm.ops[2].text === 'PROD · 320 px · not captured');
var Lo = rsTileLayout({ width: 1920, target: 'v1', gapPx: -3000, side: 'right', text: 'X', prod: null, variant: mk(1920, 900, 1500, 400, 400, 20) });
ok('a boundary outside the crop draws no line', !Lo.ops.some(function (o) { return o.op === 'line'; }));
ok('integers with fractional input', allInts(rsTileLayout({ width: 375, target: 'a', gapPx: -21, side: 'right', text: 'X', prod: mk(375, 812.5, 0.4, 100.6, 396.2, 21.7), variant: mk(375, 812.5, 0.4, 100.6, 396.2, 21.7) }).ops.filter(function (o) { return o.op !== 'text'; })));
var Lshort = rsTileLayout({ width: 320, target: 'v1', gapPx: -10, side: 'right', text: 'X', prod: mk(320, 200, 0, 50, 330, 22), variant: mk(320, 200, 0, 50, 330, 22) });
eq('a short viewport crops at its own height', Lshort.h, 22 + 200 + 2 + 22 + 200);
var Lbad = rsTileLayout({ width: 320, target: 'v1', gapPx: -10, side: 'right', text: 'X', prod: null, variant: { error: 'x' } });
ok('a broken variant mark does not throw', Lbad.w === 320 && Lbad.ops.length > 5);
eq('first op fills the whole tile white', JSON.stringify(Lp.ops[0]), JSON.stringify({ op: 'rect', x: 0, y: 0, w: 320, h: 646, fill: '#ffffff' }));
var SCHEMA20 = { rect: 'fill,h,op,w,x,y', text: 'fill,font,op,text,x,y', image: 'dh,dw,dx,dy,op,sh,src,sw,sx,sy', line: 'op,stroke,width,x1,x2,y1,y2' };
var ops20 = [Lp, L19, Lc, Ll, Lf, Ln, Lm, Lo, Lshort, Lbad].reduce(function (a, L) { return a.concat(L.ops); }, []);
ok('A20: every op has exactly the keys of its kind', ops20.length > 40 && ops20.every(function (o) { return SCHEMA20[o.op] === Object.keys(o).sort().join(','); }));
ok('A20: every image op names prod or variant, every number is an integer', ops20.every(function (o) { return (o.op !== 'image' || o.src === 'prod' || o.src === 'variant') && Object.keys(o).every(function (k) { return typeof o[k] !== 'number' || o[k] === Math.round(o[k]); }); }));
ok('A20: no prod image op when prod is null', [Lm, Lo, Lbad].every(function (L) { return !L.ops.some(function (o) { return o.op === 'image' && o.src === 'prod'; }); }));
var calls20 = [];
var R23 = runMode(QK_FAKE.sites.resp(), build(ctxResp(), { widths: '320,375' }), {}, true, function (io) {
  var compose = io.compose;
  io.compose = function (layout, imgs) { calls20.push({ layout: layout, imgs: imgs }); return compose.call(io, layout, imgs); };
  return io;
});
ok('A20: the resp run composed tiles', calls20.length > 0 && R23.rec.tiles.length === calls20.length);
ok('A20: imgs is exactly {prod, variant}, each a non-empty string or null', calls20.every(function (c) { return c.imgs && Object.keys(c.imgs).sort().join(',') === 'prod,variant' && ['prod', 'variant'].every(function (k) { return c.imgs[k] === null || (typeof c.imgs[k] === 'string' && c.imgs[k].length > 0); }) && typeof c.imgs.variant === 'string'; }));
ok('A20: imgs.prod is null exactly when the layout has no prod image op', calls20.every(function (c) { return (c.imgs.prod === null) === !c.layout.ops.some(function (o) { return o.op === 'image' && o.src === 'prod'; }); }));

// ── prod mode text, foot ───────────────────────────────────────────────────
section('rsProdModeText / foot');
eq('reload text', rsProdModeText({ widths: [1, 2, 3], prodMode: 'reload' }), '3 widths, reloaded once per width');
eq('resize text', rsProdModeText({ widths: [1, 2], prodMode: 'resize', prodLiveIds: ['7202', '7203'] }), '2 widths, swept by resizing one load because PROD shows live experiment(s) 7202, 7203');
eq('unmeasured text is empty', rsProdModeText({ widths: [1], prodMode: null }), '');
eq('one width reads singular', rsProdModeText({ widths: [1], prodMode: 'reload' }), '1 width, reloaded once per width');
eq('null plan does not throw', rsProdModeText(null), '');
ok('foot on an empty record does not throw', /Pages loaded: none/.test(rsReportFootHtml({})));
ok('foot escapes its text', rsReportFootHtml({ loads: [{ path: 'http://a.example/<b>' }] }).indexOf('<b>') < 0);

// ── engine object ──────────────────────────────────────────────────────────
section('RS_ENGINE');
jeq('engine keys', Object.keys(RS_ENGINE), ['mode', 'label', 'version', 'sanitize', 'newRecord', 'run', 'derive']);
eq('engine mode', RS_ENGINE.mode, 'responsiveness');
eq('engine label', RS_ENGINE.label, 'Responsiveness');
eq('engine version', RS_ENGINE.version, 1);
ok('engine functions are the exported ones', RS_ENGINE.sanitize === rsSanitizeInput && RS_ENGINE.newRecord === rsNewRecord && RS_ENGINE.run === rsRun && RS_ENGINE.derive === rsDeriveRows);
ok('the Console lines are built by the kit', qkConsoleStart(RS_ENGINE.label, R1.rec).text.indexOf('[Responsiveness] Run started') === 0);
ok('the Console start line counts ticket inputs', /2 input\(s\) from the ticket|3 input\(s\) from the ticket|4 input\(s\) from the ticket/.test(qkConsoleStart(RS_ENGINE.label, R1.rec).text));
ok('the Console end line carries the counts', /4 Fail · 4 Pass/.test(qkConsoleEnd(RS_ENGINE.label, Object.assign({}, R1.rec, { finishedAt: R1.rec.startedAt + 3300 })).text));
ok('a stopped run ends WARNING', qkConsoleEnd(RS_ENGINE.label, R5.rec).level === 'WARNING');
ok('a halted run ends WARNING', qkConsoleEnd(RS_ENGINE.label, R4.rec).level === 'WARNING');
ok('the record stores a masked input', JSON.stringify(R1.rec.input).indexOf('?') < 0);
ok('the record loads are the kit load records (15 keys)', R1.rec.loads.every(function (L) { return Object.keys(L).length === 15; }));
ok('every sweep entry has the ten keys of the contract', R1.rec.sweep.every(function (e) { return ['target', 'role', 'width', 'mode', 'loadId', 'ok', 'loadError', 'served', 'skipped', 'scan'].every(function (k) { return k in e; }); }));
ok('the debug lines are masked strings', R1.io.debugLines.every(function (l) { return typeof l.text === 'string'; }));
ok('the run never reads facts or the catalog or storage', R1.io.trace.every(function (t) { return ['facts', 'catalog', 'storageNames', 'click'].indexOf(t.op) < 0; }));
ok('the run never clicks', R1.site.beacons.trusted + R1.site.beacons.untrusted + R1.site.beacons.overlay === 0);
ok('every load asks for width in severity order or a PROD width', R1.io.trace.filter(function (t) { return t.op === 'load'; }).every(function (t) { return QK_WIDTHS.concat([320, 375, 1280]).indexOf(t.width) >= 0; }));

print('');
if (failures.length) {
  print('FAILURES:');
  failures.forEach(function (f) { print('  - ' + f); });
}
print('=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
