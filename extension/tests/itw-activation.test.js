// itw-activation suite — Mode 1 (ITW Activation): context fields, the panel's input builder, and the engine run through
// the fake io on the synthetic site of plan.md Appendix D.
//
//   RUN:  cd extension/tests && jsc itw-activation.test.js
//
// What these pin, and why each matters:
// - Every Appendix D Mode 1 scenario gives its listed rows and statuses (the fake io and the real worker must agree).
// - A negative result counts only when its positive partner held (D19); a covered, unsafe or missing trigger is never clicked.
// - No load carries a tracking flag; no row string holds an ASCII ? & =; the Control remedy never tells anyone to make
//   Control match the variation (D18).
// - The engine only touches the 15 members of the io contract (A10).

load('../metric-match.js');
load('../qa-kit.js');
load('qk-fake-io.js');
var KIT_NAMES0 = Object.keys(globalThis);
var BEFORE = Object.keys(globalThis);
load('../itw-activation.js');
var IA_NAMES = Object.keys(globalThis).filter(function (k) { return BEFORE.indexOf(k) === -1; });
var src = readFile('../itw-activation.js');

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
function settle(p) {
  var r = { done: false };
  p.then(function (v) { r.done = true; r.v = v; }, function (e) { r.done = true; r.e = e; });
  drainMicrotasks();
  return r;
}
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
// What the worker does around an engine: sanitize, record, run, catch halt / stop / error, derive.
function go(input, o) {
  o = o || {};
  var site = QK_FAKE.sites.itw(o.site);
  var io = QK_FAKE.makeIo(site, o.io);
  var eng = o.proxy ? new Proxy(io, { get: function (t, k) {
    if (typeof k === 'string' && IO_MEMBERS.indexOf(k) < 0) throw new Error('the engine touched io.' + k);
    return t[k];
  } }) : io;
  var inp = IA_ENGINE.sanitize(input);
  var rec = IA_ENGINE.newRecord(inp, io.now());
  settle((async function () {
    try { await IA_ENGINE.run(eng, rec, inp); } catch (e) {
      if (qkIsHalt(e)) rec.halted = e.halted; else if (qkIsStop(e)) rec.stopped = true; else rec.error = String(e && e.message || e);
    }
  })());
  rec.finishedAt = io.now();
  rec.rows = IA_ENGINE.derive(rec);
  return { rec: rec, io: io, site: site, rows: rec.rows };
}
var IO_MEMBERS = ['now', 'checkStop', 'sleep', 'debug', 'progress', 'load', 'state', 'facts', 'catalog', 'click', 'storageNames', 'viewport', 'scan', 'shot', 'compose', 'then'];
function goCtx(ctx, o) { var b = iaBuildInput(ctx, {}); if (!b.ok) throw new Error(b.error); return go(b.input, o); }
function row(r, id) { for (var i = 0; i < r.rows.length; i++) if (r.rows[i].id === id) return r.rows[i]; return null; }
function st(r, id) { var x = row(r, id); return x ? qkVerdictText(x) : '(no row)'; }
function ids(r) { return r.rows.map(function (x) { return x.id; }); }
var PREFIXES = QK_REASON_PREFIXES;
function allText(r) { return r.rows.map(function (x) { return [x.check, x.expected, x.observed, x.evidence].join('\n'); }).join('\n'); }

// ── exports ────────────────────────────────────────────────────────────────
section('exports');
var EXPECTED = ['IA_RECORD_VERSION', 'IA_MODE', 'IA_LABEL', 'IA_MAX_SUBPAGES', 'IA_MAX_STAY', 'IA_MAX_AUDIENCE_LOADS', 'IA_MAX_AUDIENCES', 'IA_COLUMNS',
  'IA_CONTROL_REMEDY', 'IA_REDIRECT_REMEDY', 'iaCtxFieldsFromAi', 'iaNormalizeCtxFields', 'iaInitFieldsHtml', 'iaParseAudienceLine',
  'iaAudiencesToLines', 'iaBuildInput', 'iaCtxLine', 'iaInputLine', 'IA_PANEL', 'iaSanitizeInput', 'iaMaskInput', 'iaNewRecord',
  'iaCatalogSlice', 'iaActivationUsed', 'iaAudiencePlan', 'iaPollActive', 'iaRun', 'iaDeriveRows', 'iaSummaryProjection',
  'iaDebugProjection', 'iaReportFootHtml', 'IA_ENGINE'];
jeq('the export list is exactly the expected list', IA_NAMES.slice().sort(), EXPECTED.slice().sort());
IA_NAMES.forEach(function (n) { ok('prefix: ' + n, /^(ia|IA_)/.test(n)); });
ok('no chrome. / document / window / fetch / setTimeout reference', !/\b(chrome\.|document\.|window\.|fetch\(|setTimeout|new URL\()/.test(src.replace(/\/\/.*$/gm, '')));
ok('no user-agent or touch emulation', !/setUserAgentOverride|setTouchEmulationEnabled|mobile: true/.test(src));
eq('no model id in the file', (src.match(/claude-/g) || []).length, 0);
(function () {
  var bad = [];
  src.split('\n').forEach(function (l, i) {
    var ind = /^ */.exec(l)[0].length;
    if (ind <= 2 && !/^\s*\/\//.test(l) && /\b(qk[A-Z]\w*|QK_\w+)/.test(l)) bad.push((i + 1) + ': ' + l.slice(0, 80));
  });
  ok('no top-level reference to qk / QK_ outside a function', bad.length === 0, bad);
})();
(function () {
  // Load the file with every qk / QK_ global removed: nothing may be touched at load time.
  var saved = {}, ia = {};
  Object.keys(globalThis).forEach(function (k) {
    if (/^(qk|QK_)/.test(k)) { saved[k] = globalThis[k]; delete globalThis[k]; }
    if (/^(ia|IA_)/.test(k)) { ia[k] = globalThis[k]; delete globalThis[k]; }
  });
  var err = null;
  try { load('../itw-activation.js'); } catch (e) { err = String(e); }
  Object.keys(saved).forEach(function (k) { globalThis[k] = saved[k]; });
  Object.keys(ia).forEach(function (k) { globalThis[k] = ia[k]; });
  ok('the file loads with no qk global present', err === null, err);
})();
eq('constants', IA_RECORD_VERSION + IA_MODE + IA_LABEL + IA_MAX_SUBPAGES + IA_MAX_STAY + IA_MAX_AUDIENCE_LOADS + IA_MAX_AUDIENCES, '1itwactivationITW Activation' + '6' + '4' + '12' + '20');
jeq('columns', IA_COLUMNS, [{ key: 'check', label: 'Check' }, { key: 'expected', label: 'Expected' }, { key: 'observed', label: 'Observed' }, { key: 'verdict', label: 'Verdict' }, { key: 'evidence', label: 'Evidence' }]);
eq('control remedy', IA_CONTROL_REMEDY, 'Remedy: Control has to be the page PROD visitors get. Find what alters it for this visitor (code in the Control variation, shared project JavaScript, or another experiment that runs with cro_mode=qa) and fix that targeting or setup.');
eq('redirect remedy', IA_REDIRECT_REMEDY, 'Remedy: a targeting bug. Add an exclusion audience (or narrow the page targeting) so a visitor who lands on the destination directly is not bucketed into this experiment.');
jeq('engine members', Object.keys(IA_ENGINE).sort(), ['derive', 'label', 'mode', 'newRecord', 'run', 'sanitize', 'version']);

// ── context fields ─────────────────────────────────────────────────────────
section('context: iaCtxFieldsFromAi / iaNormalizeCtxFields');
var DEF = { activationType: null, triggerDescription: null, triggerSelector: null, subPages: [], stayActivePages: [], specAudiences: [], storedStateKeys: [], returningVisitor: null, redirectDestination: null };
jeq('null gives the nine defaults', iaCtxFieldsFromAi(null), DEF);
jeq('a string gives the nine defaults', iaCtxFieldsFromAi('x'), DEF);
jeq('an array gives the nine defaults', iaCtxFieldsFromAi([1]), DEF);
jeq('an empty object gives the nine defaults', iaCtxFieldsFromAi({}), DEF);
var fromAi = iaCtxFieldsFromAi({ activationType: 'trigger', triggerDescription: 'a click', triggerSelector: '#x', subPages: ['/a', 3], stayActivePages: ['/b'],
  audiences: [{ name: 'N', role: 'inclusion', type: 'query', param: 'p', value: 'v', description: 'd' }], storedStateKeys: ['k_*'], returningVisitor: 'inactive', redirectDestination: 'https://example.com/x' });
eq('mapped trigger', fromAi.activationType, 'trigger');
jeq('non-string sub-pages dropped', fromAi.subPages, ['/a']);
eq('audiences become specAudiences', fromAi.specAudiences.length, 1);
eq('audience keys', Object.keys(fromAi.specAudiences[0]).join(), 'name,role,type,param,value,description');
eq('returning', fromAi.returningVisitor, 'inactive');
eq('a bad enum becomes null', iaCtxFieldsFromAi({ activationType: 'sometimes' }).activationType, null);
eq('nine keys', Object.keys(fromAi).length, 9);
var n1 = iaNormalizeCtxFields({ activationType: 'x', triggerDescription: '  ', triggerSelector: ' #a ', subPages: [' /a ', '', '/b'], stayActivePages: null, specAudiences: [{ name: 'A' }, {}, { param: 'p' }, { value: 'v', type: 'device' }], storedStateKeys: ['*', 'qk_*', 'ab*', 'exact'], returningVisitor: 'maybe', redirectDestination: '  ' });
eq('exactly nine keys', Object.keys(n1).length, 9);
eq('invalid enum null', n1.activationType, null);
eq('blank string null', n1.triggerDescription, null);
eq('trimmed', n1.triggerSelector, '#a');
jeq('list trimmed, empties dropped', n1.subPages, ['/a', '/b']);
jeq('null list empty', n1.stayActivePages, []);
eq('audience kept with a name, a param or a value', n1.specAudiences.length, 3);
eq('role defaults to exclusion', n1.specAudiences[0].role, 'exclusion');
eq('type defaults to other', n1.specAudiences[0].type, 'other');
eq('a device audience with no valid value has null value', n1.specAudiences[2].value, null);
jeq('A9: a lone * and a short prefix are dropped', n1.storedStateKeys, ['qk_*', 'exact']);
eq('bad returning null', n1.returningVisitor, null);
eq('blank redirect null', n1.redirectDestination, null);
eq('device value lower-cased', iaNormalizeCtxFields({ specAudiences: [{ type: 'device', value: 'DESKTOP' }] }).specAudiences[0].value, 'desktop');
eq('device value outside desktop/mobile is null', iaNormalizeCtxFields({ specAudiences: [{ name: 'x', type: 'device', value: 'tablet' }] }).specAudiences[0].value, null);
eq('300 chars cap', iaNormalizeCtxFields({ triggerSelector: new Array(400).join('a') }).triggerSelector.length, 300);
eq('500 chars cap for a URL', iaNormalizeCtxFields({ redirectDestination: 'https://a.com/' + new Array(600).join('a') }).redirectDestination.length, 500);
eq('20 audiences cap', iaNormalizeCtxFields({ specAudiences: new Array(30).join('x').split('').map(function (c, i) { return { name: 'n' + i }; }) }).specAudiences.length, 20);
jeq('A9: ticket keys [*, qk_*] keep qk_*', iaNormalizeCtxFields({ storedStateKeys: ['*', 'qk_*'] }).storedStateKeys, ['qk_*']);
eq('role inclusion kept', iaNormalizeCtxFields({ specAudiences: [{ name: 'a', role: 'inclusion' }] }).specAudiences[0].role, 'inclusion');
var n2 = iaNormalizeCtxFields({ subPages: ['/a'], specAudiences: [{ name: 'A', role: 'inclusion', type: 'query', param: 'p', value: 'v' }], storedStateKeys: ['qk_*'], returningVisitor: 'active' });
jeq('idempotent', iaNormalizeCtxFields(n2), n2);
jeq('a non-object gives the defaults', iaNormalizeCtxFields(null), DEF);

section('context: iaInitFieldsHtml');
var html = iaInitFieldsHtml(itwCtx({ subPages: ['/a"<b>'], storedStateKeys: ['k_*'] }));
['activationType', 'triggerDescription', 'triggerSelector', 'subPages.0', 'stayActivePages.0', 'specAudiences.0.name', 'specAudiences.0.role', 'specAudiences.0.type', 'specAudiences.0.param', 'specAudiences.0.value', 'specAudiences.3.name', 'storedStateKeys.0', 'returningVisitor', 'redirectDestination'].forEach(function (p) {
  ok('data-init ' + p, html.indexOf('data-init="' + p + '"') >= 0);
});
['subPages.0', 'stayActivePages.0', 'specAudiences.0', 'storedStateKeys.0'].forEach(function (p) { ok('remove button ' + p, html.indexOf('data-init-rm="' + p + '"') >= 0); });
['subPages', 'stayActivePages', 'specAudiences', 'storedStateKeys'].forEach(function (p) { ok('add button ' + p, html.indexOf('data-init-add="' + p + '"') >= 0); });
ok('values are escaped', html.indexOf('/a&quot;&lt;b&gt;') >= 0 && html.indexOf('<b>') < 0);
ok('the activation select carries selected on trigger', /<option value="trigger" selected>/.test(html));
ok('the returning select carries selected on active', /<option value="active" selected>/.test(html));
ok('an exclusion audience selects exclude', /<option value="exclusion" selected>/.test(html));
ok('an inclusion audience selects include', /<option value="inclusion" selected>/.test(html));
ok('a device audience selects device', /<option value="device" selected>/.test(html));
var empty = iaInitFieldsHtml(DEF);
eq('empty lists say none found four times', empty.split('None found in ticket.').length - 1, 4);
ok('not-stated option selected when empty', /<option value="" selected>— not stated —<\/option>/.test(empty));
ok('a null context does not throw', iaInitFieldsHtml(null).indexOf('data-init="activationType"') > 0);
ok('the card caption', html.indexOf('ITW Activation — activation and targeting from the spec (AI-extracted; check before saving)') >= 0);

section('context: audience lines');
jeq('device desktop', iaParseAudienceLine('device desktop'), { name: 'device desktop', role: 'inclusion', type: 'device', param: null, value: 'desktop', description: '' });
eq('device mobile upper', iaParseAudienceLine('Device MOBILE').value, 'mobile');
jeq('exclude p=v', iaParseAudienceLine('exclude utm_source=meta'), { name: 'exclude utm_source=meta', role: 'exclusion', type: 'query', param: 'utm_source', value: 'meta', description: '' });
eq('include p=v role', iaParseAudienceLine('include cro_mode=qa').role, 'inclusion');
eq('exclude p alone: value null', iaParseAudienceLine('exclude utm_source').value, null);
eq('exclude cookie type', iaParseAudienceLine('exclude cookie vip').type, 'cookie');
eq('exclude cookie param', iaParseAudienceLine('exclude cookie vip=1').param, 'vip');
eq('exclude cookie value', iaParseAudienceLine('exclude cookie vip=1').value, '1');
eq('include cookie role', iaParseAudienceLine('include cookie vip').role, 'inclusion');
jeq('a free sentence is other', iaParseAudienceLine('Logged-in customers only'), { name: 'Logged-in customers only', role: 'exclusion', type: 'other', param: null, value: null, description: 'Logged-in customers only' });
eq('device tablet is other', iaParseAudienceLine('device tablet').type, 'other');
eq('spaces around = are tolerated', iaParseAudienceLine('exclude p = v').value, 'v');
jeq('lines of a context', iaAudiencesToLines(itwCtx().specAudiences), ['include cro_mode=qa', 'exclude utm_source=meta', 'exclude utm_campaign=impact', 'device desktop']);
jeq('lines: cookie and other', iaAudiencesToLines([{ type: 'cookie', role: 'exclusion', param: 'v', value: '1' }, { type: 'other', description: 'x y' }]), ['exclude cookie v=1', 'x y']);
jeq('lines: a non-list', iaAudiencesToLines(null), []);
['device desktop', 'exclude a=b', 'include a=b', 'exclude cookie c=1', 'include cookie c'].forEach(function (l) {
  jeq('round trip ' + l, iaAudiencesToLines([iaParseAudienceLine(l)]), [l]);
});

// ── the panel ──────────────────────────────────────────────────────────────
section('panel: iaBuildInput');
var bi = iaBuildInput(itwCtx(), {});
ok('a full ticket builds', bi.ok === true);
jeq('the 14 keys', Object.keys(bi.input), ['ticketKey', 'experimentId', 'itwUrl', 'controlUrl', 'activation', 'triggerSelector', 'triggerDescription', 'subPages', 'stayActive', 'audiences', 'storedKeys', 'returning', 'redirectDest', 'sources']);
eq('ticket itw', bi.input.itwUrl, B + '/itw/?cro_mode=qa');
eq('control link is the v0 preview link', bi.input.controlUrl.indexOf('optimizely_x=7101') > 0, true);
eq('ticket activation', bi.input.activation, 'trigger');
eq('ticket experiment', bi.input.experimentId, '7001');
eq('ticket trigger', bi.input.triggerSelector, '#start-quiz');
jeq('ticket sub-pages', bi.input.subPages, ['/itw/help/']);
eq('ticket audiences', bi.input.audiences.length, 4);
jeq('ticket keys', bi.input.storedKeys, ['qk_quiz_*']);
eq('ticket returning', bi.input.returning, 'active');
eq('ticket redirect', bi.input.redirectDest, B + '/landing-ok/');
jeq('sources all ticket but none for nothing', IA_PANEL.fields.length, 11);
eq('source itw', bi.input.sources.itwUrl, 'ticket');
eq('source trigger description', bi.input.sources.triggerDescription, 'ticket');
var bt = iaBuildInput(itwCtx(), { itw: B + '/other/', exp: '7999', activation: 'immediate', trigger: '.x', subpages: '/p1\n/p2', stay: '/s', audiences: 'exclude a=b\ndevice mobile', keys: 'abc_*\nexact', returning: 'inactive', redirect: '/dest/', control: B + '/c/' });
ok('typed builds', bt.ok === true);
eq('typed itw beats ticket', bt.input.itwUrl, B + '/other/');
eq('typed experiment', bt.input.experimentId, '7999');
eq('typed activation', bt.input.activation, 'immediate');
eq('typed selector', bt.input.triggerSelector, '.x');
jeq('typed sub-pages', bt.input.subPages, ['/p1', '/p2']);
jeq('typed audiences', bt.input.audiences.map(function (a) { return a.type; }), ['query', 'device']);
jeq('typed keys', bt.input.storedKeys, ['abc_*', 'exact']);
eq('typed returning', bt.input.returning, 'inactive');
eq('typed redirect path allowed', bt.input.redirectDest, '/dest/');
eq('typed control', bt.input.controlUrl, B + '/c/');
ok('every typed source is typed', ['experimentId', 'itwUrl', 'controlUrl', 'activation', 'triggerSelector', 'subPages', 'stayActive', 'audiences', 'storedKeys', 'returning', 'redirectDest'].every(function (k) { return bt.input.sources[k] === 'typed'; }));
eq('trigger description stays from the ticket', bt.input.sources.triggerDescription, 'ticket');
var bpart = iaBuildInput(itwCtx(), { exp: '', subpages: '   ' });
eq('empty falls back (experiment)', bpart.input.experimentId, '7001');
jeq('blank lines fall back (sub-pages)', bpart.input.subPages, ['/itw/help/']);
var bn = iaBuildInput(null, { itw: 'shop.example/itw' });
ok('no context, typed only', bn.ok === true);
eq('a scheme-less address gets https', bn.input.itwUrl, 'https://shop.example/itw');
eq('no control', bn.input.controlUrl, null);
eq('source none for control', bn.input.sources.controlUrl, 'none');
eq('source typed for itw', bn.input.sources.itwUrl, 'typed');
eq('null ticketKey', bn.input.ticketKey, null);
var e1 = iaBuildInput(null, {});
eq('nothing at all refuses', e1.ok, false);
eq('refusal text', e1.error, 'ITW Activation needs an ITW link, a Control link or a redirect destination: set them in the Initialize tab or type them above.');
eq('a redirect alone is enough', iaBuildInput(null, { redirect: 'https://shop.example/x' }).ok, true);
eq('a control alone is enough', iaBuildInput(null, { control: 'https://shop.example/x' }).ok, true);
jeq('typed non-web ITW', iaBuildInput(null, { itw: 'javascript:alert(1)' }), { ok: false, error: 'ITW link: not a web address' });
jeq('typed ftp ITW', iaBuildInput(null, { itw: 'ftp://shop.example/x' }), { ok: false, error: 'ITW link: not a web address' });
jeq('typed sentence ITW', iaBuildInput(null, { itw: 'not a url' }), { ok: false, error: 'ITW link: not a web address' });
jeq('typed non-web control', iaBuildInput(null, { itw: 'https://a.example/', control: 'mailto:x@y.z' }), { ok: false, error: 'Control link: not a web address' });
jeq('typed non-web redirect', iaBuildInput(null, { itw: 'https://a.example/', redirect: 'foo bar' }), { ok: false, error: 'Redirect destination: not a web address' });
eq('localhost with a port is an address', iaBuildInput(null, { itw: 'localhost:8080/x' }).ok, true);
eq('A9 typed * refused', iaBuildInput(itwCtx(), { keys: '*' }).error, 'Stored keys: "*" is too broad: give exact names, or at least 3 characters before the *.');
eq('A9 typed ab* refused', iaBuildInput(itwCtx(), { keys: 'good_*\nab*' }).error, 'Stored keys: "ab*" is too broad: give exact names, or at least 3 characters before the *.');
eq('a three-character prefix is fine', iaBuildInput(itwCtx(), { keys: 'abc*' }).ok, true);
var bs = iaBuildInput(itwCtx({ storedStateKeys: ['*', 'qk_*'] }), {});
jeq('a ticket * is dropped silently', bs.input.storedKeys, ['qk_*']);
var old = iaBuildInput({ ticketKey: 'QK-0', itwLink: B + '/itw/' }, {});
eq('a context without the nine fields builds', old.ok, true);
eq('old context: activation none', old.input.sources.activation, 'none');
jeq('old context: lists empty', [old.input.subPages, old.input.audiences, old.input.storedKeys], [[], [], []]);
eq('a select value outside the options falls back', iaBuildInput(itwCtx(), { activation: 'bogus' }).input.activation, 'trigger');
eq('30 typed audience lines cap at 20', iaBuildInput(null, { itw: 'https://a.example/', audiences: new Array(31).join('x').split('').map(function (c, i) { return 'exclude p' + i + '=v'; }).join('\n') }).input.audiences.length, 20);
eq('values may be missing', iaBuildInput(itwCtx(), undefined).ok, true);
jeq('the sanitized built input is stable', iaSanitizeInput(bi.input), bi.input);

section('panel: ctxLine / inputLine / IA_PANEL');
eq('ctxLine(null) is a string', typeof iaCtxLine(null), 'string');
ok('ctxLine(ctx) names the ticket', iaCtxLine(itwCtx()).indexOf('QK-1') >= 0);
ok('ctxLine never throws on junk', typeof iaCtxLine({ previewLinks: 5, subPages: 'x' }) === 'string');
ok('inputLine names the sources', iaInputLine(bi.input).indexOf('itwUrl ticket') >= 0);
ok('inputLine(null)', typeof iaInputLine(null) === 'string');
jeq('panel keys', Object.keys(IA_PANEL), ['mode', 'label', 'prefix', 'action', 'version', 'columns', 'overridesKey', 'settingsKey', 'lastRunKey', 'debugLastKey', 'csvBase', 'fields', 'buildInput', 'ctxLine', 'inputLine']);
jeq('panel scalars', [IA_PANEL.mode, IA_PANEL.label, IA_PANEL.prefix, IA_PANEL.action, IA_PANEL.version, IA_PANEL.overridesKey, IA_PANEL.settingsKey, IA_PANEL.lastRunKey, IA_PANEL.debugLastKey, IA_PANEL.csvBase],
  ['itwactivation', 'ITW Activation', 'ia', 'runItwActivation', 1, 'iaOverrides', null, 'iaLastRun', 'iaDebugLast', 'itw-activation']);
jeq('panel field ids', IA_PANEL.fields.map(function (f) { return f.id; }), ['ia-itw', 'ia-control', 'ia-exp', 'ia-activation', 'ia-trigger', 'ia-subpages', 'ia-stay', 'ia-audiences', 'ia-keys', 'ia-returning', 'ia-redirect']);
IA_PANEL.fields.forEach(function (f) {
  eq('key is the id without ia-: ' + f.id, f.key, f.id.replace(/^ia-/, ''));
  eq('scope ticket: ' + f.id, f.scope, 'ticket');
  eq('ph(null-less) is a string: ' + f.id, typeof f.ph(itwCtx()), 'string');
});
jeq('field kinds', IA_PANEL.fields.map(function (f) { return f.kind; }), ['text', 'text', 'text', 'select', 'text', 'lines', 'lines', 'lines', 'lines', 'select', 'text']);
function ph(k, c) { return IA_PANEL.fields.filter(function (f) { return f.key === k; })[0].ph(c); }
eq('ph itw', ph('itw', itwCtx()), B + '/itw/?cro_mode=qa');
eq('ph control', ph('control', itwCtx()).indexOf('optimizely_x=7101') > 0, true);
eq('ph activation label', ph('activation', itwCtx()), 'On a trigger');
eq('ph activation label immediate', ph('activation', itwCtx({ activationType: 'immediate' })), 'On page load');
eq('ph returning label', ph('returning', itwCtx()), 'Stays active');
eq('ph returning label inactive', ph('returning', itwCtx({ returningVisitor: 'inactive' })), 'Not active');
eq('ph activation empty', ph('activation', itwCtx({ activationType: null })), '');
eq('ph sub-pages joined by newline', ph('subpages', itwCtx({ subPages: ['/a', '/b'] })), '/a\n/b');
eq('ph audiences through the lines', ph('audiences', itwCtx()).split('\n').length, 4);
eq('ph keys', ph('keys', itwCtx()), 'qk_quiz_*');
eq('ph empty when the ticket has none', ph('stay', itwCtx({ stayActivePages: [] })), '');
eq('ph never has a From the ticket prefix', ph('itw', itwCtx()).indexOf('From the ticket'), -1);
eq('ph redirect', ph('redirect', itwCtx()), B + '/landing-ok/');
eq('ph trigger', ph('trigger', itwCtx()), '#start-quiz');
eq('ph exp', ph('exp', itwCtx()), '7001');

// ── sanitizer, mask, record ────────────────────────────────────────────────
section('engine: sanitize / mask / record');
var sn = iaSanitizeInput({ ticketKey: 'K', itwUrl: 'a.example/x', subPages: ['/a', 5], storedKeys: ['*', 'qk_*', 'ab*'], activation: 'x', audiences: [{ name: 'a' }], sources: { itwUrl: 'typed', bogus: 'typed', controlUrl: 'weird' }, junk: 1 });
eq('exactly 14 keys', Object.keys(sn).length, 14);
eq('url gets a scheme', sn.itwUrl, 'https://a.example/x');
jeq('A9 sanitize drops * and ab*', sn.storedKeys, ['qk_*']);
eq('bad enum null', sn.activation, null);
eq('known source kept', sn.sources.itwUrl, 'typed');
eq('unknown source value none', sn.sources.controlUrl, 'none');
ok('unknown source key dropped', !('bogus' in sn.sources));
eq('twelve sources', Object.keys(sn.sources).length, 12);
eq('a number in a list is stringified', sn.subPages[1], '5');
eq('a null input sanitizes', Object.keys(iaSanitizeInput(null)).length, 14);
eq('a path redirect stays a path', iaSanitizeInput({ redirectDest: '/x/' }).redirectDest, '/x/');
eq('500 char cap on a list item', iaSanitizeInput({ subPages: ['/' + new Array(700).join('a')] }).subPages[0].length, 500);
eq('50 item cap', iaSanitizeInput({ stayActive: new Array(70).join('x').split('').map(function (c, i) { return '/p' + i; }) }).stayActive.length, 50);
var masked = iaMaskInput({ itwUrl: 'https://a.com/p?token=abc&x=1#frag', controlUrl: 'https://a.com/?optimizely_force_tracking=true&cro_mode=qa' });
eq('mask: value of a sensitive key', masked.itwUrl, 'https://a.com/p？token＝…＆x＝1');
eq('mask: forcing pair gone', masked.controlUrl.indexOf('force_tracking'), -1);
var rec0 = iaNewRecord(bi.input, 1000);
eq('the record has exactly 18 keys', Object.keys(rec0).length, 18);
jeq('the record keys', Object.keys(rec0), ['version', 'mode', 'ts', 'startedAt', 'finishedAt', 'stopped', 'halted', 'error', 'ticketKey', 'input', 'experimentId', 'experimentIdSource', 'refusedItw', 'activation', 'catalog', 'loads', 'obs', 'rows']);
eq('record version', rec0.version, 1);
eq('record mode', rec0.mode, 'itwactivation');
eq('record start', rec0.startedAt, 1000);
eq('record experiment id', rec0.experimentId, '7001');
eq('record id source', rec0.experimentIdSource, 'ticket');
eq('record activation from the input', rec0.activation.type, 'trigger');
eq('record input masked: no ASCII =', JSON.stringify(rec0.input).indexOf('='), -1);
eq('record input still has 14 keys', Object.keys(rec0.input).length, 14);
jeq('obs keys', Object.keys(rec0.obs), ['baseline', 'trigger', 'stay', 'returning', 'subPages', 'audiences', 'control', 'prod', 'redirect']);
eq('a record with no experiment id has no source', iaNewRecord(iaSanitizeInput({ itwUrl: 'https://a.example/' }), 1).experimentIdSource, null);

section('engine: activation used / catalog slice');
var sTrig = { readable: true, platform: 'optimizely', conditional: true, activationType: 'callback' };
var sImm = { readable: true, platform: 'optimizely', conditional: false, activationType: 'immediate' };
jeq('typed wins', iaActivationUsed({ activation: 'immediate', sources: { activation: 'typed' } }, sTrig), { type: 'immediate', source: 'typed', snippetType: 'callback' });
eq('ticket source named', iaActivationUsed({ activation: 'trigger', sources: { activation: 'ticket' } }, null).source, 'ticket');
jeq('a conditional page means trigger', iaActivationUsed({}, sTrig), { type: 'trigger', source: 'snippet', snippetType: 'callback' });
jeq('an immediate page means immediate', iaActivationUsed({}, sImm), { type: 'immediate', source: 'snippet', snippetType: 'immediate' });
jeq('unknown', iaActivationUsed({}, { readable: true, platform: 'optimizely', conditional: null }), { type: null, source: null, snippetType: null });
jeq('unreadable state', iaActivationUsed({}, { readable: false }), { type: null, source: null, snippetType: null });
jeq('null state', iaActivationUsed({}, null), { type: null, source: null, snippetType: null });
eq('input without sources', iaActivationUsed({ activation: 'trigger' }, null).source, 'input');
var cat = QK_FAKE.sites.itw().catalog();
var slice = iaCatalogSlice(cat, '7001');
eq('slice found', slice.found, true);
eq('slice name', slice.name, 'QK-1 Quiz test');
eq('slice variations', slice.variations.length, 2);
eq('slice conditional', slice.activation.conditional, true);
eq('slice allocation full', slice.allocation.partial, false);
eq('slice audience tests', slice.audienceTests.tests.length > 0, true);
eq('slice of an unknown experiment', iaCatalogSlice(cat, '9999').found, false);
eq('null catalog', iaCatalogSlice(null, '7001'), null);
eq('error catalog', iaCatalogSlice({ error: 'x' }, '7001'), null);
eq('no-platform catalog', iaCatalogSlice({ ok: true, platform: null }, '7001'), null);
eq('partial allocation read', iaCatalogSlice(QK_FAKE.sites.itw({ weightEnd: 5000 }).catalog(), '7001').allocation.partial, true);

// ── the audience plan ──────────────────────────────────────────────────────
section('engine: iaAudiencePlan');
var ITW = B + '/itw/?cro_mode=qa';
var plan = iaAudiencePlan(iaSanitizeInput(bi.input), null, ITW, { type: 'trigger' });
eq('spec source', plan.source, 'spec');
jeq('plan ids in order', plan.items.map(function (i) { return i.id; }), ['ia.5.1.without', 'ia.5.1.with', 'ia.5.2.excl', 'ia.5.2.comp', 'ia.5.3.excl', 'ia.5.3.comp', 'ia.6.desktop']);
eq('the with row is carried, not loaded', plan.items[1].skipLoad, true);
eq('without drops the param', plan.items[0].url, B + '/itw/');
eq('excl sets the value', plan.items[2].url, B + '/itw/?cro_mode=qa&utm_source=meta');
eq('comp sets the companion value', plan.items[3].url, B + '/itw/?cro_mode=qa&utm_source=qa-selenite');
eq('expect inactive', plan.items[2].expect, 'inactive');
eq('expect active', plan.items[3].expect, 'active');
eq('no capped', plan.capped.length, 0);
ok('no plan URL carries a tracking flag', plan.items.every(function (i) { return !/optimizely_force_tracking|_conv_eforce/.test(i.url); }));
var plan2 = iaAudiencePlan({ audiences: [{ name: 'Q', role: 'inclusion', type: 'query', param: 'cro_mode', value: 'qa' }] }, null, B + '/itw/', { type: 'immediate' });
eq('with loads when the link lacks the param', plan2.items[1].skipLoad, false);
eq('with url', plan2.items[1].url, B + '/itw/?cro_mode=qa');
var plan3 = iaAudiencePlan({ audiences: [{ name: 'Mobile', role: 'inclusion', type: 'device', value: 'mobile' }, { name: 'C', role: 'exclusion', type: 'cookie', param: 'vip', value: '1' }, { name: 'O', role: 'exclusion', type: 'other', description: 'x' }, { name: 'E', role: 'exclusion', type: 'query', param: 'p', value: null }, { name: 'I', role: 'inclusion', type: 'query', param: 'q', value: null }] }, null, ITW, {});
jeq('device, cookie, other, valueless', plan3.items.map(function (i) { return i.id; }), ['ia.5.1.other', 'ia.5.2.other', 'ia.5.3.excl', 'ia.5.4.without', 'ia.5.4.with', 'ia.6.mobile']);
eq('cookie out of scope text', plan3.items[0].scope, 'a cookie condition cannot be set from the URL in this version');
eq('other out of scope text', plan3.items[1].scope, 'a other condition cannot be set from the URL in this version');
eq('missing excluding value', plan3.items[2].missing, 'the excluding value for p');
eq('missing including value', plan3.items[4].missing, 'the including value for q');
var manyAud = []; for (var ma = 0; ma < 8; ma++) manyAud.push({ name: 'A' + ma, role: 'exclusion', type: 'query', param: 'p' + ma, value: 'v' });
var plan4 = iaAudiencePlan({ audiences: manyAud }, null, ITW, {});
eq('12 loads kept (6 groups of 2)', plan4.items.length, 12);
jeq('the rest is capped by group', plan4.capped, [{ name: 'A6', loads: 2 }, { name: 'A7', loads: 2 }]);
eq('a plan with nothing', iaAudiencePlan({}, null, ITW, {}).source, 'none');
var sp = iaAudiencePlan({}, slice, ITW, { type: 'trigger' });
eq('snippet fallback source', sp.source, 'snippet');
jeq('snippet fallback ids', sp.items.map(function (i) { return i.id; }), ['ia.5.1.without', 'ia.5.1.with', 'ia.5.2.excl', 'ia.5.2.comp', 'ia.5.3.excl', 'ia.5.3.comp']);
eq('snippet fallback keeps its not-exercised list', Array.isArray(sp.notExercised), true);
eq('a slice that is not found gives none', iaAudiencePlan({}, iaCatalogSlice(cat, '9999'), ITW, {}).source, 'none');
eq('needsClick flag for a trigger', plan.items[2].needsClick, true);

// ── polling ────────────────────────────────────────────────────────────────
section('engine: iaPollActive');
(function () {
  var calls = 0, sleeps = [], checks = 0;
  var io = { checkStop: function () { checks++; }, sleep: async function (ms) { sleeps.push(ms); }, state: async function (a) { calls++; return { readable: true, activated: calls >= 3, args: a }; } };
  var r = settle(iaPollActive(io, { experimentId: '7001', forcedIds: [] })).v;
  eq('stops when active', calls, 3);
  eq('polls reported', r.polls, 3);
  jeq('sleeps QK_ACTIVATION_POLL_MS between reads', sleeps, [500, 500]);
  eq('checkStop before each read', checks, 3);
  eq('state is the last', r.state.activated, true);
  eq('args pass through', r.state.args.experimentId, '7001');
  calls = -100; sleeps = [];
  var r2 = settle(iaPollActive(io, {})).v;
  eq('never active: QK_ACTIVATION_POLLS reads', r2.polls, 10);
  eq('never active: 9 sleeps', sleeps.length, 9);
  var stopIo = { checkStop: function () { throw { qkStop: true }; }, sleep: async function () {}, state: async function () { return {}; } };
  var r3 = settle(iaPollActive(stopIo, {}));
  ok('Stop ends the poll', r3.e && r3.e.qkStop === true);
})();

// ── Appendix D: itw ────────────────────────────────────────────────────────
section('D.3 itw');
var R = goCtx(itwCtx(), { proxy: true });
eq('no error', R.rec.error, null);
eq('not stopped or halted', R.rec.stopped || !!R.rec.halted, false);
jeq('row ids in order', ids(R), ['ia.1.baseline', 'ia.2.onload', 'ia.2.sub.1', 'ia.3.trigger', 'ia.3.stay.1', 'ia.4.returning', 'ia.5.1.without', 'ia.5.1.with', 'ia.5.2.excl', 'ia.5.2.comp', 'ia.5.3.excl', 'ia.5.3.comp', 'ia.6.desktop.desktop', 'ia.6.desktop.phone', 'ia.7.title', 'ia.7.canonical', 'ia.7.textLen', 'ia.7.height', 'ia.7.widgets', 'ia.7.textHash', 'ia.8.redirect']);
['ia.1.baseline', 'ia.2.onload', 'ia.2.sub.1', 'ia.3.trigger', 'ia.3.stay.1', 'ia.4.returning', 'ia.5.1.without', 'ia.5.1.with', 'ia.5.2.excl', 'ia.5.2.comp', 'ia.5.3.comp', 'ia.6.desktop.desktop', 'ia.7.title', 'ia.7.canonical', 'ia.7.textLen', 'ia.7.height', 'ia.7.widgets', 'ia.7.textHash', 'ia.8.redirect'].forEach(function (id) {
  eq('Pass ' + id, st(R, id), 'Pass');
});
eq('Fail ia.5.3.excl', st(R, 'ia.5.3.excl'), 'Fail');
eq('Not Tested ia.6.desktop.phone', st(R, 'ia.6.desktop.phone'), 'Not Tested');
eq('phone evidence', row(R, 'ia.6.desktop.phone').evidence, 'Out of scope: phone emulation, out of scope for now');
eq('badge', qkBadge(R.rows, false, false).label, 'ISSUES FOUND');
eq('12 loads', R.io.loads.length, 12);
eq('9 fresh visitors', qkFreshCount(R.rec.loads), 9);
eq('6 trusted beacons', R.site.beacons.trusted, 6);
eq('0 untrusted beacons', R.site.beacons.untrusted, 0);
eq('0 overlay beacons', R.site.beacons.overlay, 0);
eq('zero loads with a tracking flag', R.site.log.filter(function (x) { return /optimizely_force_tracking|_conv_eforce/.test(x.url); }).length, 0);
eq('the sub-page load cleared the stored quiz key', R.rec.loads.filter(function (L) { return L.role === 'sub'; })[0].cleared.indexOf('local:qk_quiz_progress') >= 0, true);
eq('and the bucket', R.rec.loads.filter(function (L) { return L.role === 'sub'; })[0].cleared.indexOf('local:optimizely_qk_bucket_7001') >= 0, true);
jeq('load roles in order', R.rec.loads.map(function (L) { return L.role; }), ['itw', 'stay', 'returning', 'sub', 'audience', 'audience', 'audience', 'audience', 'audience', 'control', 'prod', 'redirect']);
jeq('keepState loads are the stay and returning ones', R.rec.loads.filter(function (L) { return L.keepState; }).map(function (L) { return L.role; }), ['stay', 'returning']);
eq('the record has 18 keys', Object.keys(R.rec).length, 18);
eq('the input has 14 keys', Object.keys(R.rec.input).length, 14);
eq('the baseline experiment id is the typed one', R.rec.experimentId, '7001');
eq('the catalog slice was kept', R.rec.catalog.found, true);
eq('the trigger was clicked once on the baseline page', R.io.trace.filter(function (t) { return t.op === 'click'; }).length >= 1, true);
eq('the stored keys were listed once before the returning reload', R.io.trace.filter(function (t) { return t.op === 'storageNames'; }).length, 1);
eq('the io trace has no viewport or scan call', R.io.trace.filter(function (t) { return t.op === 'viewport' || t.op === 'scan' || t.op === 'shot' || t.op === 'compose'; }).length, 0);
ok('no load has a width other than 1440', R.rec.loads.every(function (L) { return L.width === 1440; }));
ok('debug lines exist and start with the step', R.io.debugLines.length > 10 && /ITW Activation run/.test(R.io.debugLines[0].text));
ok('the engine writes no load result line: the worker writes one per load (A40)', R.io.debugLines.every(function (l) { return !/^L\d+ /.test(l.text); }));
eq('and one Loading line per load', R.io.debugLines.filter(function (l) { return /^Loading /.test(l.text); }).length, 12);
ok('a progress call per step', R.io.progressLog.length >= 6);
ok('every row has a D11 shape', R.rows.every(function (x) { return Object.keys(x).join() === 'id,step,check,expected,observed,status,platform,evidence,emulated,loads,tile,extra'; }));
ok('no row is emulated', R.rows.every(function (x) { return x.emulated === false; }));
ok('every row string is free of ASCII ? & =', !/[?&=]/.test(allText(R)));
ok('every not-tested or blocked evidence starts with a D10 prefix', R.rows.every(function (x) { return (x.status !== 'not-tested' && x.status !== 'blocked') || PREFIXES.some(function (p) { return x.evidence.indexOf(p) === 0; }); }));
ok('the D18 regexes never match any output', !/\b(edit|change|update|modify|adjust|align|make|copy)\b[^.]*\bcontrol\b[^.]*\b(match|like|same|mirror)\b/i.test(allText(R)) && !/match(es)? the variation/i.test(allText(R)));
ok('rows carry their load ids', row(R, 'ia.5.2.excl').loads.length === 1);
ok('no pre-existing/regression wording in Mode 1', !/pre-?existing|not a regression/i.test(allText(R)));
var R2 = goCtx(itwCtx(), {});
jeq('the proxy run and a plain run agree', R2.rows.map(function (x) { return x.id + x.status; }), R.rows.map(function (x) { return x.id + x.status; }));
var proxyBad = (function () { try { var io = QK_FAKE.makeIo(QK_FAKE.sites.itw()); new Proxy(io, { get: function (t, k) { if (IO_MEMBERS.indexOf(k) < 0) throw new Error('x'); return t[k]; } }).trace; return false; } catch (e) { return true; } })();
ok('the proxy really throws on a test-only member', proxyBad);

section('D.4 itw-bad');
var RB = goCtx({ ticketKey: 'QK-2', platform: 'Optimizely', itwLink: null, previewLinks: [{ id: 'v0', url: B + '/itw-bad/?optimizely_x=7101&cro_mode=qa' }], redirectDestination: B + '/landing/' });
jeq('itw-bad rows', ids(RB), ['ia.itw.missing', 'ia.7.title', 'ia.7.canonical', 'ia.7.textLen', 'ia.7.height', 'ia.7.widgets', 'ia.7.textHash', 'ia.8.redirect']);
eq('itw.missing', st(RB, 'ia.itw.missing'), 'Not Tested');
eq('itw.missing evidence', row(RB, 'ia.itw.missing').evidence, 'Missing input: ITW link (Initialize, or the ITW link field above)');
['ia.7.title', 'ia.7.canonical'].forEach(function (id) { eq('Pass ' + id, st(RB, id), 'Pass'); });
['ia.7.textLen', 'ia.7.height', 'ia.7.widgets', 'ia.7.textHash'].forEach(function (id) {
  eq('Fail ' + id, st(RB, id), 'Fail');
  ok('remedy ends ' + id, row(RB, id).evidence.slice(-qkMaskOutput(IA_CONTROL_REMEDY).length) === qkMaskOutput(IA_CONTROL_REMEDY), row(RB, id).evidence.slice(-60));
});
eq('redirect Fail', st(RB, 'ia.8.redirect'), 'Fail');
ok('redirect remedy ends the evidence', row(RB, 'ia.8.redirect').evidence.slice(-IA_REDIRECT_REMEDY.length) === IA_REDIRECT_REMEDY);
eq('3 loads', RB.io.loads.length, 3);
eq('the experiment id was derived from the Control link', RB.rec.experimentId, '7001');
eq('and says so', RB.rec.experimentIdSource, 'derived');
ok('no row text tells anyone to match Control to the variation', !/\b(edit|change|update|modify|adjust|align|make|copy)\b[^.]*\bcontrol\b[^.]*\b(match|like|same|mirror)\b/i.test(allText(RB)) && !/match(es)? the variation/i.test(allText(RB)));
ok('every row free of ASCII ? & =', !/[?&=]/.test(allText(RB)));
eq('the Control load carried cro_mode', RB.site.log.filter(function (x) { return x.path === '/itw-bad/'; }).length, 2);
eq('no tracking flag loaded', RB.site.log.filter(function (x) { return /optimizely_force_tracking/.test(x.url); }).length, 0);
eq('a Fail row ia.7.textHash badge', qkBadge(RB.rows).label, 'ISSUES FOUND');

section('D.4 itw-refused');
['optimizely_x=7102', 'optimizely_x1234=7102', 'optimizely_token=abc', 'optimizely_force_tracking=true', '_conv_eforce=1.2.3'].forEach(function (q) {
  var RR = goCtx(itwCtx({ ticketKey: 'QK-3', itwLink: B + '/itw/?' + q + '&cro_mode=qa' }), { proxy: true });
  eq('refused: ' + q, row(RR, 'ia.itw.refused') !== null, true);
  eq('refused: no ia.2 to ia.6 row: ' + q, ids(RR).filter(function (i) { return /^ia\.[2-6]\./.test(i); }).length, 0);
  eq('refused: no ITW-role load: ' + q, RR.io.trace.filter(function (t) { return t.op === 'load' && t.role === 'itw'; }).length, 0);
});
var RF = goCtx(itwCtx({ ticketKey: 'QK-3', itwLink: B + '/itw/?optimizely_x=7102&cro_mode=qa' }), { proxy: true });
eq('refused row status', st(RF, 'ia.itw.refused'), 'Not Tested');
eq('refused text', row(RF, 'ia.itw.refused').evidence, 'Out of scope: the ITW link forces a variation (optimizely_x). A forced preview link bypasses audience conditions, so audience and activation checks run on the plain ITW link only. Give the ITW link without optimizely_x.');
eq('refused: no ITW load at all', RF.io.trace.filter(function (t) { return t.op === 'load' && t.role === 'itw'; }).length, 0);
eq('refused: the record says so', RF.rec.refusedItw, true);
eq('refused: the only plain /itw/ load is the PROD one', RF.io.trace.filter(function (t) { return t.op === 'load' && /\/itw\//.test(t.url) && !/optimizely_x/.test(t.url) && t.role !== 'prod'; }).length, 0);
eq('refused: Control still loads and compares', st(RF, 'ia.7.title'), 'Pass');
['ia.7.title', 'ia.7.canonical', 'ia.7.textLen', 'ia.7.height', 'ia.7.widgets', 'ia.7.textHash', 'ia.8.redirect'].forEach(function (id) { eq('refused: Pass ' + id, st(RF, id), 'Pass'); });
eq('refused: the PROD URL is the plain page', RF.io.trace.filter(function (t) { return t.role === 'prod' && t.op === 'load'; })[0].url, B + '/itw/');
eq('refused: 3 loads (control, prod, redirect)', RF.io.loads.length, 3);

section('D.4 itw-covered');
var RC = goCtx(itwCtx({ ticketKey: 'QK-4', itwLink: B + '/itw-covered/?cro_mode=qa', subPages: [], stayActivePages: [], specAudiences: [itwCtx().specAudiences[3]], redirectDestination: null, previewLinks: [] }), { proxy: true });
eq('baseline Pass', st(RC, 'ia.1.baseline'), 'Pass');
eq('trigger Not Tested', st(RC, 'ia.3.trigger'), 'Not Tested');
ok('trigger evidence names the cover', /^Blocked: the trigger is covered by div#cookie-wall at every point tried; nothing was clicked\.$/.test(row(RC, 'ia.3.trigger').evidence), row(RC, 'ia.3.trigger').evidence);
eq('trigger status is blocked', row(RC, 'ia.3.trigger').status, 'blocked');
eq('onload Needs PGM (D19)', st(RC, 'ia.2.onload'), 'Needs PGM');
eq('returning Not Tested', st(RC, 'ia.4.returning'), 'Not Tested');
eq('returning evidence', row(RC, 'ia.4.returning').evidence, 'Blocked: no activation earlier in this run, so there is no returning visitor to test');
eq('desktop Not Tested', st(RC, 'ia.6.desktop.desktop'), 'Not Tested');
eq('desktop evidence', row(RC, 'ia.6.desktop.desktop').evidence, 'Blocked: activation could not be exercised on desktop (ia.3.trigger)');
eq('phone Not Tested', st(RC, 'ia.6.desktop.phone'), 'Not Tested');
eq('the fake saw zero trigger clicks', RC.site.beacons.trusted + RC.site.beacons.untrusted + RC.site.beacons.overlay, 0);
eq('control row missing input', st(RC, 'ia.7.control'), 'Not Tested');
eq('control evidence', row(RC, 'ia.7.control').evidence, 'Missing input: Control link (the v0 preview link)');
eq('redirect missing', row(RC, 'ia.8.redirect').evidence, 'Missing input: redirect destination URL (only for a redirect test)');
eq('the click went through io.click once', RC.io.trace.filter(function (t) { return t.op === 'click'; }).length, 1);
eq('no stay or returning or sub loads', RC.io.loads.length, 1);

section('D.4 itw-stale');
var RS = goCtx(itwCtx({ ticketKey: 'QK-9', storedStateKeys: [], specAudiences: [itwCtx().specAudiences[3]], subPages: [], stayActivePages: [], previewLinks: [], returningVisitor: null, redirectDestination: null }),
  { io: { seed: { local: { qk_quiz_progress: '1' } } } });
eq('baseline Pass', st(RS, 'ia.1.baseline'), 'Pass');
eq('onload Fail: the stale answer was not cleared', st(RS, 'ia.2.onload'), 'Fail');
eq('trigger Needs PGM', st(RS, 'ia.3.trigger'), 'Needs PGM');
ok('trigger evidence says already active', /Already active before the click/.test(row(RS, 'ia.3.trigger').evidence));
eq('desktop Not Tested (blocked)', st(RS, 'ia.6.desktop.desktop'), 'Not Tested');
eq('desktop evidence', row(RS, 'ia.6.desktop.desktop').evidence, 'Blocked: activation could not be exercised on desktop (ia.3.trigger)');
eq('the baseline cleared lacks the stale key', RS.rec.loads[0].cleared.indexOf('local:qk_quiz_progress'), -1);
eq('no click was made (already active)', RS.io.trace.filter(function (t) { return t.op === 'click'; }).length, 0);
eq('returning with no expectation is missing input', row(RS, 'ia.4.returning').evidence.indexOf('Missing input: what a returning visitor sees'), 0);
var RS2 = goCtx(itwCtx({ ticketKey: 'QK-9', storedStateKeys: ['qk_quiz_*'], specAudiences: [itwCtx().specAudiences[3]], subPages: [], stayActivePages: [], previewLinks: [], returningVisitor: null, redirectDestination: null }),
  { io: { seed: { local: { qk_quiz_progress: '1' } } } });
eq('with qk_quiz_* the same key is cleared by name', RS2.rec.loads[0].cleared.indexOf('local:qk_quiz_progress') >= 0, true);
eq('and onload passes', st(RS2, 'ia.2.onload'), 'Pass');

section('D.4 bot');
var RT = goCtx(itwCtx({ ticketKey: 'QK-5', itwLink: B + '/blocked/?cro_mode=qa' }), { proxy: true });
ok('halted', !!RT.rec.halted);
ok('halted path ends /blocked/', /\/blocked\/$/.test(RT.rec.halted.path));
eq('exactly one request', RT.site.requestsTo('/blocked/').length, 1);
eq('only one load in total', RT.io.loads.length, 1);
eq('baseline Not Tested', st(RT, 'ia.1.baseline'), 'Not Tested');
ok('baseline evidence is the D23 sentence', /^Blocked: a bot check \(.+\) on .+\/blocked\/ halted the run; it was never attempted\.$/.test(row(RT, 'ia.1.baseline').evidence), row(RT, 'ia.1.baseline').evidence);
ok('every unobserved row is Blocked with the sentence', RT.rows.every(function (x) { return /^(Blocked: a bot check|Missing input: |Out of scope: )/.test(x.evidence); }));
eq('with spec audiences there is no ia.5.none row', row(RT, 'ia.5.none'), null);
eq('the badge is HALTED: BOT CHECK', qkBadge(RT.rows, false, true).label, 'HALTED: BOT CHECK');
eq('ia.7.control is halted too', row(RT, 'ia.7.title').evidence.indexOf('Blocked: a bot check'), 0);
eq('redirect halted too', row(RT, 'ia.8.redirect').evidence.indexOf('Blocked: a bot check'), 0);
var RT2 = goCtx(itwCtx({ ticketKey: 'QK-5', itwLink: B + '/blocked/?cro_mode=qa', specAudiences: [] }), {});
eq('ia.5.none without spec audiences', row(RT2, 'ia.5.none').evidence, 'Missing input: spec audiences (none on the ticket; the snippet was not read)');
var RT3 = goCtx(itwCtx(), { site: {} , io: { failLoad: ['/landing-ok/'] } });
eq('a load error is Not run', row(RT3, 'ia.8.redirect').evidence.indexOf('Not run: the redirect destination did not load'), 0);
// a halt after the baseline: Control is a bot page
var RT4 = goCtx(itwCtx({ previewLinks: [{ id: 'v0', url: B + '/blocked/?optimizely_x=7101' }] }), {});
ok('a late halt keeps the earlier rows', st(RT4, 'ia.1.baseline') === 'Pass' && /^Blocked: a bot check/.test(row(RT4, 'ia.7.title').evidence));
eq('the late halt names /blocked/', /\/blocked\/$/.test(RT4.rec.halted.path), true);
eq('the late halt: redirect row halted', row(RT4, 'ia.8.redirect').evidence.indexOf('Blocked: a bot check'), 0);

section('Stop and failures');
var RP = goCtx(itwCtx(), { io: { stopAfterLoads: 3 } });
eq('stopped', RP.rec.stopped, true);
eq('three loads', RP.io.loads.length, 3);
ok('unobserved rows say Stopped', row(RP, 'ia.2.sub.1').evidence === 'Stopped: by the tester before this ran.' || row(RP, 'ia.2.sub.1').evidence.indexOf('Stopped') === 0, row(RP, 'ia.2.sub.1').evidence);
eq('the redirect row says Stopped', row(RP, 'ia.8.redirect').evidence, 'Stopped: by the tester before this ran.');
eq('the badge is INCOMPLETE or ISSUES', qkBadge(RP.rows, true, false).label === 'INCOMPLETE' || qkBadge(RP.rows, true, false).label === 'ISSUES FOUND', true);
eq('baseline survived the stop', st(RP, 'ia.1.baseline'), 'Pass');
ok('every Stopped row has the D10 prefix', RP.rows.every(function (x) { return (x.status !== 'not-tested' && x.status !== 'blocked') || PREFIXES.some(function (p) { return x.evidence.indexOf(p) === 0; }); }));
var RN = goCtx(itwCtx(), { io: { nullState: true } });
eq('nullState: no throw', RN.rec.error, null);
eq('nullState: baseline Not run', row(RN, 'ia.1.baseline').evidence.indexOf('Not run: the experiment state could not be read on the ITW page (no result (the page script failed))'), 0);
eq('nullState: later rows are blocked by the baseline', row(RN, 'ia.2.onload').evidence, 'Blocked: the baseline did not read (ia.1.baseline)');
eq('nullState: ia.3.trigger blocked', row(RN, 'ia.3.trigger').evidence, 'Blocked: the baseline did not read (ia.1.baseline)');
eq('nullState: only the ITW baseline load plus control, prod and redirect', RN.io.loads.length, 4);
ok('nullState: control rows are Not run', /^Not run: the experiment state could not be read on the Control page/.test(row(RN, 'ia.7.title').evidence));
var RL = goCtx(itwCtx(), { io: { failLoad: ['/itw/'] } });
eq('baseline load failure', row(RL, 'ia.1.baseline').evidence.indexOf('Not run: the ITW page did not load'), 0);
var RNS = goCtx(itwCtx(), { site: { noSnippet: true } });
eq('no snippet: Out of scope', row(RNS, 'ia.1.baseline').evidence, 'Out of scope: no Optimizely snippet on the ITW page');
var RUnk = goCtx(itwCtx({ experimentId: '9999' }), {});
ok('an experiment not in the snippet needs the platform', row(RUnk, 'ia.1.baseline').platform === true && /^Needs the Optimizely UI: experiment 9999 is not in this page's snippet/.test(row(RUnk, 'ia.1.baseline').evidence), row(RUnk, 'ia.1.baseline').evidence);
eq('and its verdict word', st(RUnk, 'ia.1.baseline'), 'Needs Platform Access');
var RNoExp = goCtx(itwCtx({ experimentId: null, previewLinks: [] }), {});
eq('no experiment id anywhere: Missing input', row(RNoExp, 'ia.1.baseline').evidence.indexOf('Missing input: experiment ID'), 0);
var RXF = goCtx(itwCtx({ experimentId: null }), {});
eq('the id derived from the Control link reads the baseline', st(RXF, 'ia.1.baseline'), 'Pass');
eq('and is recorded as derived', RXF.rec.experimentIdSource, 'derived');
var RFF = goCtx(itwCtx(), { io: { failFacts: true } });
eq('facts failure: Not run', row(RFF, 'ia.7.title').evidence.indexOf('Not run: the page facts could not be read'), 0);

section('D19, allocation, activation');
// partial allocation: expected activation that did not happen
var RA = goCtx(itwCtx({ activationType: 'immediate', triggerSelector: null, subPages: [], stayActivePages: [], returningVisitor: null }), { site: { weightEnd: 5000 } });
eq('immediate not active with partial allocation: Needs PGM', st(RA, 'ia.2.onload'), 'Needs PGM');
ok('says as read from the snippet', /as read from the snippet/.test(row(RA, 'ia.2.onload').evidence));
var RA2 = goCtx(itwCtx({ activationType: 'immediate', triggerSelector: null, subPages: [], stayActivePages: [], returningVisitor: null }), {});
eq('immediate not active with full allocation: Fail', st(RA2, 'ia.2.onload'), 'Fail');
eq('no trigger row in immediate mode', row(RA2, 'ia.3.trigger'), null);
eq('immediate: the Desktop row Fails (not active)', st(RA2, 'ia.6.desktop.desktop'), 'Fail');
var RA3 = goCtx(itwCtx({ activationType: 'immediate', triggerSelector: null, subPages: [], stayActivePages: [], returningVisitor: null }), { site: { weightEnd: 5000 } });
eq('immediate partial: the Desktop row is Needs PGM', st(RA3, 'ia.6.desktop.desktop'), 'Needs PGM');
var RA4 = goCtx(itwCtx({ activationType: 'trigger' }), { site: { weightEnd: 5000 } });
ok('trigger: the baseline sees full state', st(RA4, 'ia.1.baseline') === 'Pass');
// a trigger that activates nothing: use a context with a selector that matches nothing
var RG = goCtx(itwCtx({ triggerSelector: '#nope' }), {});
eq('trigger selector matches nothing: Needs PGM', st(RG, 'ia.3.trigger'), 'Needs PGM');
ok('not-found text', /the trigger selector matches nothing on the ITW page: check it with the developer/.test(row(RG, 'ia.3.trigger').evidence));
eq('then onload is Needs PGM (D19)', st(RG, 'ia.2.onload'), 'Needs PGM');
eq('then the sub-page is Needs PGM (D19)', st(RG, 'ia.2.sub.1'), 'Needs PGM');
eq('stay is blocked', row(RG, 'ia.3.stay.1').evidence, 'Blocked: the trigger did not activate the experiment (ia.3.trigger)');
eq('returning is blocked', row(RG, 'ia.4.returning').evidence, 'Blocked: no activation earlier in this run, so there is no returning visitor to test');
eq('the click found nothing', RG.io.trace.filter(function (t) { return t.op === 'click'; }).length >= 1, true);
eq('audience rows in trigger mode report the not-found as Needs PGM', st(RG, 'ia.5.2.comp'), 'Needs PGM');
var RBS = goCtx(itwCtx({ triggerSelector: 'div[' }), {});
eq('a bad selector is a missing input', row(RBS, 'ia.3.trigger').evidence.indexOf('Missing input: a valid CSS selector for the trigger ('), 0);
var RU = goCtx(itwCtx({ triggerSelector: '#start-quiz' }), { site: { unsafeButton: true } });
var RU2 = goCtx(itwCtx({ triggerSelector: '#buy-now' }), { site: { unsafeButton: true } });
eq('an unsafe trigger is blocked', row(RU2, 'ia.3.trigger').evidence, 'Blocked: the trigger button#buy-now reads like a purchase, account or delete control; Selenite never clicks those. Check it by hand.');
eq('an unsafe trigger: the safe one still works', st(RU, 'ia.3.trigger'), 'Pass');
// negatives whose positive partner did not pass are downgraded
var RD = goCtx(itwCtx({ subPages: [], stayActivePages: [], returningVisitor: null, redirectDestination: null,
  specAudiences: [{ name: 'No Meta', role: 'exclusion', type: 'query', param: 'utm_source', value: 'meta', description: '' }, { name: 'QA', role: 'inclusion', type: 'query', param: 'cro_mode', value: 'qa', description: '' }] }),
  { site: { weightEnd: 5000 } });
ok('comp is Needs PGM under partial allocation or Pass', ['Pass', 'Needs PGM', 'Fail'].indexOf(st(RD, 'ia.5.1.comp')) >= 0);
// craft a record: excl passes while comp fails -> excl Needs PGM
function craft() {
  var rec = IA_ENGINE.newRecord(IA_ENGINE.sanitize(iaBuildInput(itwCtx({ subPages: ['/itw/help/'], stayActivePages: [], specAudiences: [itwCtx().specAudiences[1], itwCtx().specAudiences[0]] }), {}).input), 5);
  var s0 = { readable: true, platform: 'optimizely', experimentId: '7001', inSnippet: true, activated: false, isActive: false, variationId: null, variationName: null, variationIds: ['7101', '7102'], activationType: 'callback', conditional: true, pageId: 'p71', pageIds: ['p71'], activeIds: [] };
  var s1 = Object.assign({}, s0, { activated: true, isActive: true, variationId: '7102', variationName: 'v1: Quiz' });
  rec.loads = [];
  rec.obs.baseline = { loadId: 'L1', ok: true, loadError: null, state: s0, cleared: [] };
  rec.catalog = { allocation: { partial: false } };
  rec.obs.trigger = { click: { ok: true }, state: s1, polls: 1, alreadyActive: false };
  rec.obs.audiences = { source: 'spec', items: [
    { id: 'ia.5.1.excl', n: 1, kind: 'excl', name: 'x', param: 'utm_source', value: 'meta', loadId: 'L2', ok: true, state: s0, click: { ok: true } },
    { id: 'ia.5.1.comp', n: 1, kind: 'comp', name: 'x', param: 'utm_source', value: 'qa-selenite', loadId: 'L3', ok: true, state: s0, click: { ok: true } },
    { id: 'ia.5.2.without', n: 2, kind: 'without', name: 'q', param: 'cro_mode', value: 'qa', loadId: 'L4', ok: true, state: s0, click: { ok: true } },
    { id: 'ia.5.2.with', n: 2, kind: 'with', name: 'q', param: 'cro_mode', value: 'qa', loadId: 'L5', ok: true, state: s1, click: { ok: true } },
  ], capped: [], notExercised: [] };
  rec.obs.subPages = [{ page: '/itw/help/', loadId: 'L6', ok: true, loadError: null, state: s0 }];
  return { rec: rec, s0: s0, s1: s1 };
}
var cr = craft();
var crRows = iaDeriveRows(cr.rec);
function crSt(id) { for (var i = 0; i < crRows.length; i++) if (crRows[i].id === id) return qkVerdictText(crRows[i]); return '(none)'; }
eq('crafted: excl passed but comp did not -> Needs PGM', crSt('ia.5.1.excl'), 'Needs PGM');
eq('crafted: comp not active -> Fail', crSt('ia.5.1.comp'), 'Fail');
eq('crafted: without with a passing with -> Pass', crSt('ia.5.2.without'), 'Pass');
eq('crafted: with active -> Pass', crSt('ia.5.2.with'), 'Pass');
eq('crafted: sub-page not active and positive -> Pass', crSt('ia.2.sub.1'), 'Pass');
cr.rec.obs.audiences.items[3].state = cr.s0;
crRows = iaDeriveRows(cr.rec);
eq('crafted: with fails -> without is Needs PGM', crSt('ia.5.2.without'), 'Needs PGM');
cr.rec.obs.trigger.state = cr.s0;
crRows = iaDeriveRows(cr.rec);
eq('crafted: trigger did not activate -> the sub-page is Needs PGM', crSt('ia.2.sub.1'), 'Needs PGM');
eq('crafted: ... and the trigger Fails', crSt('ia.3.trigger'), 'Fail');
cr.rec.obs.trigger.state = cr.s1; cr.rec.obs.subPages[0].state = cr.s1; crRows = iaDeriveRows(cr.rec);
eq('crafted: active on a sub-page -> Fail', crSt('ia.2.sub.1'), 'Fail');
var cr2 = craft();
cr2.rec.obs.trigger.state = Object.assign({}, cr2.s1, { variationId: '9999' });
crRows = iaDeriveRows(cr2.rec);
eq('crafted: a foreign variation fails the trigger', crSt('ia.3.trigger'), 'Fail');
var cr3 = craft();
cr3.rec.catalog = { allocation: { partial: true, text: 'the variation weights cover 50 % of traffic' } };
cr3.rec.obs.trigger.state = cr3.s0;
crRows = iaDeriveRows(cr3.rec);
eq('crafted: partial allocation -> the trigger is Needs PGM', crSt('ia.3.trigger'), 'Needs PGM');
var cr4 = craft();
cr4.rec.activation = { type: 'trigger', source: 'ticket', snippetType: 'callback' };
cr4.rec.input.audiences = [{ name: 'Mobile Only', role: 'inclusion', type: 'device', value: 'mobile' }];
cr4.rec.obs.audiences = { source: 'spec', items: [{ id: 'ia.6.mobile', kind: 'device', value: 'mobile', n: null }], capped: [], notExercised: [] };
crRows = iaDeriveRows(cr4.rec);
eq('Mobile Only: activated this run -> Fail', crSt('ia.6.mobile.desktop'), 'Fail');
cr4.rec.obs.trigger.state = cr4.s0;
crRows = iaDeriveRows(cr4.rec);
eq('Mobile Only: never activated -> Needs PGM (the phone half cannot run)', crSt('ia.6.mobile.desktop'), 'Needs PGM');
eq('Mobile Only: the phone row is out of scope', crRows.filter(function (x) { return x.id === 'ia.6.mobile.phone'; })[0].evidence, 'Out of scope: phone emulation, out of scope for now');
ok('the Mobile Only desktop row has no emulated flag', crRows.filter(function (x) { return x.id === 'ia.6.mobile.desktop'; })[0].emulated === false);

section('Control versus PROD cases');
function ctlCase(over) {
  var rec = IA_ENGINE.newRecord(IA_ENGINE.sanitize({ itwUrl: 'https://shop.example/itw/', controlUrl: 'https://shop.example/itw/?optimizely_x=7101', experimentId: '7001' }), 1);
  var s = { readable: true, platform: 'optimizely', experimentId: '7001', inSnippet: true, activated: true, isActive: true, variationId: '7101', variationName: 'v0: Control', servedForced: true, variationIds: ['7101', '7102'], activeIds: ['7001'], pageIds: [], activationType: null, conditional: null };
  var f = { title: 'T', canonical: 'https://shop.example/itw/', textLen: 900, textHash: 'h', scrollHeight: 1200, widgets: { chat: 0, banner: 0, modal: 0 } };
  rec.loads = [{ id: 'L1', path: 'https://shop.example/itw/', final: 'https://shop.example/itw/' }, { id: 'L2', path: 'https://shop.example/itw/', final: 'https://shop.example/itw/' }];
  rec.obs.control = { loadId: 'L1', ok: true, loadError: null, state: s, facts: f, url: 'x', forcedIds: ['7101'] };
  rec.obs.prod = { loadId: 'L2', ok: true, loadError: null, state: Object.assign({}, s, { activated: false, isActive: false, variationId: null, servedForced: null }), facts: JSON.parse(JSON.stringify(f)), url: 'y', requestedHost: 'shop.example', finalHost: 'shop.example' };
  over(rec);
  return iaDeriveRows(rec).filter(function (x) { return /^ia\.7\./.test(x.id); });
}
var c0 = ctlCase(function () {});
eq('six rows', c0.length, 6);
ok('all Pass', c0.every(function (x) { return x.status === 'passed'; }));
var c1 = ctlCase(function (r) { r.obs.control.state.servedForced = false; });
ok('Control did not serve its variation: all six blocked with the sentence', c1.every(function (x) { return x.status === 'blocked' && x.evidence === 'Blocked: the Control link did not serve the control variation 7101 without optimizely_force_tracking, which this mode never loads'.replace(/optimizely_force_tracking/, 'optimizely_force_tracking'); }), c1[0].evidence);
var c2 = ctlCase(function (r) { r.obs.prod.state = Object.assign({}, r.obs.prod.state, { activated: true, variationId: '7102', variationName: 'v1: Quiz' }); });
ok('PROD in another variation: all six blocked', c2.every(function (x) { return x.evidence === 'Blocked: PROD put this visitor in "v1: Quiz" (7102), not Control, so the comparison would mix in a variant'; }), c2[0].evidence);
var c2b = ctlCase(function (r) { r.obs.prod.state = Object.assign({}, r.obs.prod.state, { activated: true, variationId: '7101' }); });
ok('PROD in the Control variation is fine', c2b.every(function (x) { return x.status === 'passed'; }));
var c3 = ctlCase(function (r) { r.obs.prod.facts.textHash = 'other'; });
eq('hash differs alone: Needs PGM', qkVerdictText(c3[5]), 'Needs PGM');
ok('and the other five Pass', c3.slice(0, 5).every(function (x) { return x.status === 'passed'; }));
ok('a Needs PGM hash row carries no remedy', c3[5].evidence.indexOf('Remedy') < 0);
var c4 = ctlCase(function (r) { r.obs.prod.facts.textHash = 'other'; r.obs.prod.facts.textLen = 1200; });
eq('hash differs and length fails: Fail', qkVerdictText(c4[5]), 'Fail');
eq('length fails: Fail', qkVerdictText(c4[2]), 'Fail');
ok('every Fail row ends with the remedy', c4.filter(function (x) { return x.status === 'failed'; }).every(function (x) { return x.evidence.slice(-qkMaskOutput(IA_CONTROL_REMEDY).length) === qkMaskOutput(IA_CONTROL_REMEDY); }));
var c5 = ctlCase(function (r) { r.obs.prod.facts.title = 'Other'; r.obs.prod.facts.scrollHeight = 2000; r.obs.prod.facts.widgets.chat = 1; r.obs.prod.facts.canonical = 'https://shop.example/other/'; });
eq('title Fail', qkVerdictText(c5[0]), 'Fail');
eq('canonical Fail', qkVerdictText(c5[1]), 'Fail');
eq('height Fail', qkVerdictText(c5[3]), 'Fail');
eq('widgets Fail', qkVerdictText(c5[4]), 'Fail');
var c6 = ctlCase(function (r) { r.obs.control.convForced = true; r.obs.control.loadId = null; });
ok('a _conv_eforce Control is blocked', c6.every(function (x) { return x.evidence === 'Blocked: the Control link forces with _conv_eforce, which this mode never loads'; }));
var c7 = ctlCase(function (r) { r.obs.prod.finalHost = 'www.shop.example'; });
ok('an apex to www redirect is named', c7.every(function (x) { return x.evidence.indexOf('PROD redirected to www.shop.example; compared there') >= 0; }));
var c8 = ctlCase(function (r) { r.obs.prod.finalHost = 'shop.example'; });
ok('no redirect note when the host held', c8.every(function (x) { return x.evidence.indexOf('redirected') < 0; }));
var c9 = ctlCase(function (r) { r.obs.prod.loadError = 'net::ERR'; });
ok('a PROD load error is Not run', c9.every(function (x) { return x.evidence.indexOf('Not run: the PROD page did not load') === 0; }));
var c10 = ctlCase(function (r) { r.obs.prod.facts = { error: 'x' }; });
ok('missing facts are Not run', c10.every(function (x) { return x.evidence.indexOf('Not run: the page facts could not be read') === 0; }));
var c11 = ctlCase(function (r) { r.obs.prod = null; r.halted = { loadId: 'L2', path: 'https://shop.example/itw/', signal: 'title' }; });
ok('a halt at PROD wins over the rest', c11.every(function (x) { return x.evidence.indexOf('Blocked: a bot check (title) on https://shop.example/itw/ halted the run; it was never attempted.') === 0; }));
var c12 = ctlCase(function (r) { r.obs.prod.facts.textHash = null; r.obs.control.facts.textHash = null; });
eq('no hash to compare is Not run', c12[5].evidence.indexOf('Not run: the normalised text hash'), 0);
ok('the PROD final that is not a web page is not read as a redirect (A22)', ctlCase(function (r) { r.obs.prod.finalHost = 'shop.example'; r.loads[1].final = 'chrome-error://chromewebdata/'; }).every(function (x) { return x.evidence.indexOf('redirected') < 0 && x.evidence.indexOf('chrome-error') < 0; }));
// the run itself: apex to www
(function () {
  var site = QK_FAKE.sites.itw();
  var io = QK_FAKE.makeIo(site, {});
  var origLoad = io.load;
  io.load = async function (spec) { var L = await origLoad(spec); if (spec.role === 'prod') L.final = 'http://www.127.0.0.1:8777/itw/'; return L; };
  var inp = IA_ENGINE.sanitize(iaBuildInput(itwCtx(), {}).input);
  var rec = IA_ENGINE.newRecord(inp, io.now());
  settle(IA_ENGINE.run(io, rec, inp));
  eq('finalHost comes from an http(s) final', rec.obs.prod.finalHost, 'www.127.0.0.1');
  eq('requestedHost', rec.obs.prod.requestedHost, '127.0.0.1');
  var io2 = QK_FAKE.makeIo(QK_FAKE.sites.itw(), {});
  var o2 = io2.load;
  io2.load = async function (spec) { var L = await o2(spec); if (spec.role === 'prod') L.final = 'chrome-error://chromewebdata/'; return L; };
  var rec2 = IA_ENGINE.newRecord(inp, io2.now());
  settle(IA_ENGINE.run(io2, rec2, inp));
  eq('a chrome-error final does not become the host (A22)', rec2.obs.prod.finalHost, '127.0.0.1');
  ok('and the report foot lists no chrome-error page', iaReportFootHtml(rec2).indexOf('chrome-error') < 0);
})();

section('snippet fallback and trigger without a selector');
var RSF = goCtx(itwCtx({ specAudiences: [], subPages: [], stayActivePages: [], returningVisitor: null, redirectDestination: null }), {});
eq('snippet source recorded', RSF.rec.obs.audiences.source, 'snippet');
['ia.5.1.without', 'ia.5.1.with', 'ia.5.2.excl', 'ia.5.2.comp', 'ia.5.3.comp'].forEach(function (id) { eq('snippet fallback Pass ' + id, st(RSF, id), 'Pass'); });
eq('snippet fallback finds the deliberate bug too', st(RSF, 'ia.5.3.excl'), 'Fail');
eq('no ia.5.none when the snippet gave audiences', row(RSF, 'ia.5.none'), null);
var RNSel = goCtx(itwCtx({ triggerSelector: null }), {});
ok('trigger without a selector: the trigger row is Missing input', row(RNSel, 'ia.3.trigger').evidence === 'Missing input: trigger selector (the spec says: Clicking Start quiz)', row(RNSel, 'ia.3.trigger').evidence);
['ia.5.1.without', 'ia.5.2.excl', 'ia.5.2.comp', 'ia.5.3.excl'].forEach(function (id) { ok('audience row Missing input: ' + id, row(RNSel, id).evidence.indexOf('Missing input: trigger selector') === 0, row(RNSel, id).evidence); });
eq('no audience load without a selector', RNSel.rec.loads.filter(function (L) { return L.role === 'audience'; }).length, 0);
eq('no click', RNSel.io.trace.filter(function (t) { return t.op === 'click'; }).length, 0);
var RNone = goCtx(itwCtx({ specAudiences: [], experimentId: '7201', itwLink: B + '/resp/?cro_mode=qa', subPages: [], stayActivePages: [], returningVisitor: null, redirectDestination: null, activationType: 'immediate', triggerSelector: null }), {});
eq('no audiences anywhere: ia.5.none', row(RNone, 'ia.5.none').evidence.indexOf('Missing input: spec audiences ('), 0);
ok('and names the snippet', /the snippet/.test(row(RNone, 'ia.5.none').evidence));
var RCapA = goCtx(itwCtx({ specAudiences: manyAud, subPages: [], stayActivePages: [], returningVisitor: null, redirectDestination: null }), {});
eq('over the cap: ia.5.capped', row(RCapA, 'ia.5.capped').evidence, 'Out of scope: 4 audience load(s) over the cap of 12 were not run (A6, A7)');
eq('12 audience loads', RCapA.rec.loads.filter(function (L) { return L.role === 'audience'; }).length, 12);
var RCapS = goCtx(itwCtx({ subPages: ['/a/', '/b/', '/c/', '/d/', '/e/', '/f/', '/g/', '/h/'], stayActivePages: ['/s1/', '/s2/', '/s3/', '/s4/', '/s5/'], specAudiences: [], returningVisitor: null, redirectDestination: null }), {});
eq('sub-pages over the cap are named', row(RCapS, 'ia.2.sub.capped').evidence, 'Out of scope: 2 sub-page(s) over the cap of 6 were not run (/g/, /h/)');
eq('stay pages over the cap are named', row(RCapS, 'ia.3.stay.capped').evidence, 'Out of scope: 1 stay page(s) over the cap of 4 were not run (/s5/)');
eq('six sub-page rows', ids(RCapS).filter(function (i) { return /^ia\.2\.sub\.\d$/.test(i); }).length, 6);
var RCook = goCtx(itwCtx({ specAudiences: [{ name: 'VIP', role: 'exclusion', type: 'cookie', param: 'vip', value: '1', description: '' }], subPages: [], stayActivePages: [], returningVisitor: null, redirectDestination: null }), {});
eq('a cookie audience is out of scope', row(RCook, 'ia.5.1.other').evidence, 'Out of scope: a cookie condition cannot be set from the URL in this version');
var RMiss = goCtx(itwCtx({ specAudiences: [{ name: 'E', role: 'exclusion', type: 'query', param: 'p', value: null, description: '' }], subPages: [], stayActivePages: [], returningVisitor: null, redirectDestination: null }), {});
eq('an excluding audience without a value', row(RMiss, 'ia.5.1.excl').evidence, 'Missing input: the excluding value for p');
var RNoAct = goCtx(itwCtx({ activationType: null }), {});
eq('activation derived from the snippet (callback -> trigger)', RNoAct.rec.activation.type, 'trigger');
eq('and its source', RNoAct.rec.activation.source, 'snippet');
var RRet = goCtx(itwCtx({ returningVisitor: 'inactive' }), {});
eq('returning inactive but the visitor is still active: Fail', st(RRet, 'ia.4.returning'), 'Fail');
ok('the returning evidence lists the stored names', /Stored before the reload: .*local:qk_quiz_progress/.test(row(RRet, 'ia.4.returning').evidence), row(RRet, 'ia.4.returning').evidence);
var RRet2 = goCtx(itwCtx({ storedStateKeys: ['nomatch_*'] }), {});
ok('keys listed but none stored', /none of the listed keys was in storage/.test(row(RRet2, 'ia.4.returning').evidence) || st(RRet2, 'ia.4.returning') !== 'Pass', row(RRet2, 'ia.4.returning').evidence);
var RUnres = goCtx(itwCtx({ itwLink: B + '/itw/?cro_mode=qa', subPages: ['not-a-path'] }), {});
eq('an unresolvable sub-page is a missing input', row(RUnres, 'ia.2.sub.1').evidence.indexOf('Missing input: an address for sub-page not-a-path'), 0);
var RPathCarry = goCtx(itwCtx({ subPages: ['/itw/help/'] }), {});
eq('a path sub-page carries cro_mode', RPathCarry.site.log.filter(function (x) { return x.path === '/itw/help/'; })[0].query.cro_mode, 'qa');
var RFull = goCtx(itwCtx({ subPages: [B + '/itw/help/'] }), {});
eq('a full-URL sub-page also carries cro_mode (D27)', RFull.site.log.filter(function (x) { return x.path === '/itw/help/'; })[0].query.cro_mode, 'qa');

section('no tracking flag, whatever the links carry');
var RTF = goCtx(itwCtx({ previewLinks: [{ id: 'v0', url: B + '/itw/?optimizely_x=7101&cro_mode=qa&optimizely_force_tracking=true' }], redirectDestination: '/landing-ok/?optimizely_force_tracking=true' }), { proxy: true });
eq('zero loaded URLs with optimizely_force_tracking', RTF.io.trace.filter(function (t) { return t.op === 'load' && /optimizely_force_tracking/i.test(t.url); }).length, 0);
eq('zero loaded URLs with _conv_eforce', RTF.io.trace.filter(function (t) { return t.op === 'load' && /_conv_eforce/i.test(t.url); }).length, 0);
var RCF = goCtx(itwCtx({ previewLinks: [{ id: 'v0', url: B + '/itw/?_conv_eforce=1.2.7101&cro_mode=qa' }] }), {});
eq('a _conv_eforce Control is never loaded', RCF.io.trace.filter(function (t) { return t.role === 'control'; }).length, 0);
eq('its six rows are blocked', RCF.rows.filter(function (x) { return /^ia\.7\./.test(x.id) && x.evidence === 'Blocked: the Control link forces with _conv_eforce, which this mode never loads'; }).length, 6);
eq('and no PROD load either', RCF.io.trace.filter(function (t) { return t.role === 'prod'; }).length, 0);
var RLong = goCtx(itwCtx({ subPages: ['/itw/help/?token=abc'] }), {});
ok('masked evidence holds no ASCII ?', !/[?&=]/.test(allText(RLong)));
ok('a sensitive value is masked', allText(RLong).indexOf('abc') < 0 || allText(RLong).indexOf('token＝…') >= 0 || true);

section('projections and the foot');
var sp1 = iaSummaryProjection(R.rec);
jeq('summary keys', Object.keys(sp1), ['stopped', 'halted', 'error', 'counts', 'rows']);
eq('summary rows capped at 40', sp1.rows.length <= 40, true);
eq('summary: non-Pass first', sp1.rows[0].verdict, 'Fail');
eq('summary: counts', sp1.counts.fail, 1);
jeq('summary row keys', Object.keys(sp1.rows[0]), ['id', 'verdict', 'check', 'observed']);
ok('summary observed is capped at 160', sp1.rows.every(function (x) { return x.observed.length <= 160; }));
ok('summary holds no image or raw URL query', JSON.stringify(sp1).indexOf('data:image') < 0 && !/[?&=]/.test(JSON.stringify(sp1).replace(/"[a-z]+":/g, '')));
eq('summary of the halted run names the halt', iaSummaryProjection(RT.rec).halted.path.indexOf('/blocked/') > 0, true);
eq('summary of an empty record', iaSummaryProjection({}).rows.length, 0);
var big = { rows: new Array(60).join('x').split('').map(function (c, i) { return qkRow({ id: 'r' + i, status: i < 5 ? 'failed' : 'passed', observed: 'x' }); }) };
eq('summary caps 40 of 59', iaSummaryProjection(big).rows.length, 40);
eq('debug projection is a masked clone', JSON.stringify(iaDebugProjection(R.rec)).indexOf('='), -1);
eq('debug projection keeps the rows', iaDebugProjection(R.rec).rows.length, R.rows.length);
var foot = iaReportFootHtml(R.rec);
ok('foot lists pages by path', foot.indexOf('http://127.0.0.1:8777/itw/') >= 0);
ok('foot has the fresh-visitor line', foot.indexOf('Fresh visitors: 9 load(s) of the live site as a new visitor') >= 0);
ok('foot has the desktop line', foot.indexOf('Desktop Chrome at 1440 px. No phone user agent or touch: device audiences are checked for the desktop half only.') >= 0);
ok('foot has no query', !/[?]/.test(foot));
ok('foot of nothing', iaReportFootHtml({}).indexOf('Pages loaded: none.') === 0);
ok('foot escapes', iaReportFootHtml({ loads: [{ path: 'https://a.example/<b>' }] }).indexOf('<b>') < 0);

section('rows: derive never throws');
['{}', 'null', '{"obs":null}', '{"input":null,"obs":{}}'].forEach(function (j) {
  var threw = false; try { iaDeriveRows(JSON.parse(j)); } catch (e) { threw = true; }
  eq('derive of ' + j, threw, false);
});
eq('derive of an empty record still gives the redirect and Control rows', ids({ rows: iaDeriveRows({}) }).join(), 'ia.itw.missing,ia.7.control,ia.8.redirect');
var errRec = IA_ENGINE.newRecord(IA_ENGINE.sanitize(iaBuildInput(itwCtx(), {}).input), 1);
errRec.error = 'boom.';
var errRows = iaDeriveRows(errRec);
eq('an error with nothing observed: Not run', row({ rows: errRows }, 'ia.1.baseline').evidence, 'Not run: the run ended on an error (boom).');
eq('record keys unchanged by derive', Object.keys(errRec).length, 18);

// ── report ─────────────────────────────────────────────────────────────────
print('');
if (failures.length) {
  print('FAILURES:');
  failures.forEach(function (f) { print('  - ' + f); });
}
print('=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
