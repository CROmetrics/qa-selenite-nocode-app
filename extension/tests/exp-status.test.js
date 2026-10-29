// Experiment Status suite — the Tracker tab's live card, and the probe that
// feeds it.
//
//   RUN:  cd extension/tests && jsc exp-status.test.js
//   (jsc ships with macOS at
//    /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
//    — add it to PATH or invoke by full path.)
//
// Slices expProbeFn out of ../background.js and the card's evaluator and
// renderer out of ../popup.js by marker string, like every other suite here: a
// rename breaks this loudly instead of leaving it to test a stale duplicate.
//
// Why it exists: a visitor bucketed into a variation is not necessarily in the
// experiment on this page. Optimizely keeps the variation decision on every
// page once made, and only getExperimentStates()'s isActive says whether the
// experiment applies here. 32 probe rows in the recorded debug logs are exactly
// that (a STRZ experiment, isActive false, variation "v0: Control"), and the
// card showed each one as a green "Bucketed into v0". The ids below are
// synthetic; the shapes are the real ones.

load('../metric-match.js');

var _bg = readFile('../background.js');
var _pu = readFile('../popup.js');
function slice(src, from, to) {
  var a = src.indexOf(from), b = src.indexOf(to, a + 1);
  if (a === -1 || b === -1) throw new Error('slice marker missing: ' + from + ' … ' + to);
  return src.slice(a, b);
}

// The page globals expProbeFn reads. jsc has no URLSearchParams, and without
// one the probe's forced-params read lands in `errors` and every forced id is
// null — so a minimal one, enough for `?a=b&c=d`.
var window = {};
var location = { href: 'https://shop.test/p', search: '' };
var document = { querySelector: function () { return null; }, getElementById: function () { return null; } };
function URLSearchParams(s) {
  var m = {};
  String(s || '').replace(/^\?/, '').split('&').forEach(function (kv) {
    if (!kv) return;
    var i = kv.indexOf('=');
    m[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1));
  });
  this.get = function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; };
}

eval(slice(_bg, 'function expProbeFn() {', '\nfunction formatRemoteArg('));
eval(slice(_pu, 'function esc(s) {', '\n// A link target taken from data'));
eval(slice(_pu, 'function expExtractForcedVarId(url) {', '// ── Rendering'));
eval(slice(_pu, 'function expRenderRelatedList(', '// ── Row mutations'));
var expStatus = null, expCtx = null, expSettings = { watch: true };

var passed = 0, failed = 0;
function eq(actual, expected, label) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  print('FAIL: ' + label + '\n  expected ' + e + '\n  actual   ' + a);
}
function ok(label, cond, detail) {
  if (cond === true) { passed++; return; }
  failed++;
  print('FAIL: ' + label + (detail === undefined ? '' : '\n  got ' + JSON.stringify(detail)));
}
function section(s) { print('\n' + s); }

// ── A fake Optimizely, shaped like the real get('data') / get('state') ──────
// `states` is what getExperimentStates() returns, keyed by experiment id. The
// three other reads are derived from it the way the real snippet derives them.
var EXP = 'E1';
function fakeOptimizely(states, opts) {
  opts = opts || {};
  var data = { projectId: 'P', revision: '9', experiments: {} };
  Object.keys(states).forEach(function (id) {
    data.experiments[id] = { id: id, name: states[id].experimentName,
      variations: [{ id: 'V0', name: 'v0: Control' }, { id: 'V1', name: 'v1: Hero' }] };
  });
  return {
    get: function (what) {
      if (what === 'data') return data;
      if (what !== 'state') return null;
      return {
        getExperimentStates: function () { if (opts.statesThrow) throw new Error('boom'); return states; },
        getVariationMap: function () {
          var m = {};
          Object.keys(states).forEach(function (id) { if (states[id].variation) m[id] = states[id].variation; });
          return m;
        },
        getActiveExperimentIds: function () {
          if (opts.activeThrow) throw new Error('boom');
          return Object.keys(states).filter(function (id) { return states[id].isActive; });
        },
      };
    },
  };
}
function st(isActive, variationId, reason) {
  var o = { id: EXP, experimentName: 'QA-1 Hero test', isActive: isActive, isInExperimentHoldback: false,
            audiences: [], visitorRedirected: false,
            variation: variationId ? { id: variationId, name: variationId === 'V0' ? 'v0: Control' : 'v1: Hero' } : null };
  if (reason !== undefined) o.reason = reason;
  return o;
}
function runProbe(states, search, opts) {
  window = { optimizely: fakeOptimizely(states, opts) };
  location = { href: 'https://shop.test/p' + (search || ''), search: search || '' };
  return expProbeFn();
}
function rowOf(probe) { return probe.experiments.filter(function (r) { return r.id === EXP; })[0]; }

// ── the probe ────────────────────────────────────────────────────────────────
section('expProbeFn: isActive is read raw, beside the bucket');

var pOn = runProbe({ E1: st(true, 'V1', 'force') }, '?optimizely_x=V1');
eq(pOn.errors, [], 'the fake reads without errors');
eq([rowOf(pOn).isActive, rowOf(pOn).active, rowOf(pOn).bucketed, rowOf(pOn).reason], [true, true, true, 'force'],
   'active and bucketed: isActive true, reason force');

var pSticky = runProbe({ E1: st(false, 'V0') });
eq([rowOf(pSticky).isActive, rowOf(pSticky).active, rowOf(pSticky).bucketed, rowOf(pSticky).variationId], [false, false, true, 'V0'],
   'a bucket held where the experiment is not active: isActive false, still bucketed (the measured case)');
eq(rowOf(pSticky).reason, null, '  and no reason, as on the real rows');

var pOff = runProbe({ E1: st(false, null) });
eq([rowOf(pOff).isActive, rowOf(pOff).bucketed], [false, false], 'not active, no bucket');

var pBlind = runProbe({ E1: st(false, 'V0') }, '', { statesThrow: true });
eq([rowOf(pBlind).isActive, rowOf(pBlind).active, rowOf(pBlind).bucketed], [null, false, true],
   'getExperimentStates() throws: isActive null (unread), the bucket still comes from getVariationMap');
ok('  and the failure is named in errors', pBlind.errors.some(function (e) { return /getExperimentStates/.test(e); }), pBlind.errors);

var noField = st(false, 'V0');
delete noField.isActive;
var pNoField = runProbe({ E1: noField });
eq(rowOf(pNoField).isActive, null, 'a state row with no isActive field reads as unread, never as isActive false');

var pIds = runProbe({ E1: st(true, 'V1') }, '', { statesThrow: true });
eq([rowOf(pIds).isActive, rowOf(pIds).active], [null, true],
   'getActiveExperimentIds can still say active when getExperimentStates() cannot be read');

// ── the verdict ──────────────────────────────────────────────────────────────
section('expEvaluate: the card says whether the experiment is active, not just the bucket');

var CTX = { ticketKey: 'QA-1', platform: 'Optimizely', experimentId: EXP, reviewed: true,
  previewLinks: [{ id: 'v0', url: 'https://shop.test/p?optimizely_x=V0' }, { id: 'v1', url: 'https://shop.test/p?optimizely_x=V1' }],
  variants: [{ id: 'v0', rawDescription: 'Control' }, { id: 'v1', rawDescription: 'New hero' }] };
var SET = { watch: true };
function statusOf(probe) { return { tabId: 1, probedAt: Date.now(), url: probe.url, probe: probe, error: null }; }
function ev(probe, ctx) { return expEvaluate(statusOf(probe), ctx || CTX, SET); }

var vOn = ev(pOn);
eq([vOn.state, vOn.severity], ['BUCKETED', 'ok'], 'active and bucketed is the green state');
eq(vOn.headline, 'Active · bucketed into v1 — v1: Hero', '  and its headline leads with Active');
eq(expActivityText(vOn.activity), 'Yes — isActive: true, reason: force', '  the Active line quotes isActive and reason');

var vSticky = ev(pSticky);
eq([vSticky.state, vSticky.severity], ['BUCKETED_INACTIVE', 'warn'], 'a bucket on an inactive experiment is NOT the green state');
eq(vSticky.headline, 'QA-1 Hero test is not active on this page', '  the headline says not active');
ok('  the sub still names the bucket, and why it does not apply',
   /bucketed into v0 — v0: Control/.test(vSticky.sub) && /isActive is false/.test(vSticky.sub), vSticky.sub);
eq(vSticky.actual, null, '  and "On page" shows nothing, because the bucket is not on the page');
eq(expActivityText(vSticky.activity), 'No — isActive: false, reason: —', '  Active line: No');

var pStickyForced = runProbe({ E1: st(false, 'V0') }, '?optimizely_x=V1');
eq(ev(pStickyForced).state, 'BUCKETED_INACTIVE',
   'forcing v1 while the held bucket is v0 on an inactive experiment is "not active", not "forced v1 but showing v0"');

var vOff = ev(pOff);
eq(vOff.state, 'EXPERIMENT_NOT_RUNNING', 'not active and not bucketed');
eq(vOff.headline, 'QA-1 Hero test is not active on this page', '  says not active, in the same words');
eq(expActivityText(vOff.activity), 'No — isActive: false, reason: —', '  Active line: No');

// The debug log's projection drops `known`. Over the recorded captures, 739
// unbucketed inactive rows without it fell past the not-running guard and read
// as "forced v1 but showing null" or "Bucketed into null".
var unknownRow = JSON.parse(JSON.stringify(pOff));
unknownRow.experiments.forEach(function (r) { delete r.known; });
eq(ev(unknownRow).state, 'EXPERIMENT_NOT_RUNNING', 'an inactive, unbucketed row is not running whether or not it says `known`');

var vNotIn = ev(runProbe({ E1: st(true, null) }));
eq(vNotIn.state, 'NOT_BUCKETED', 'active, visitor excluded');
eq(vNotIn.headline, "QA-1 Hero test is active, but this visitor isn't bucketed", '  says active');
eq(expActivityText(vNotIn.activity), 'Yes — isActive: true, reason: —', '  Active line: Yes');

var vBlind = ev(pBlind);
eq([vBlind.state, vBlind.severity], ['ACTIVE_UNKNOWN', 'warn'],
   'a bucket with isActive unread is neither confirmed nor called inactive');
eq(expActivityText(vBlind.activity), 'Unknown — getExperimentStates() couldn’t be read', '  Active line: Unknown, and why');

eq(ev(pNoField).state, 'ACTIVE_UNKNOWN', '  so the card does not claim "isActive is false" for a field the page never sent');

var vIds = ev(pIds);
eq(vIds.state, 'BUCKETED', 'active per getActiveExperimentIds, bucketed: green even with isActive unread');
eq(expActivityText(vIds.activity), 'Yes', '  Active line: Yes, quoting no field it did not read');

var vMissing = ev(runProbe({ E9: { id: 'E9', experimentName: 'Other', isActive: true, variation: null } }));
eq(vMissing.state, 'EXPERIMENT_NOT_IN_SNIPPET', 'an id not in the catalog');
eq(expActivityText(vMissing.activity), 'No — not in this page’s snippet', '  Active line: No, not in the snippet');

var partial = runProbe({ E9: { id: 'E9', experimentName: 'Other', isActive: true, variation: null } });
partial.catalogComplete = false;
var vPartial = ev(partial);
eq(vPartial.state, 'EXPERIMENT_UNKNOWN', 'an incomplete catalog');
eq(expActivityText(vPartial.activity), 'Unknown — the snippet’s catalog couldn’t be fully read', '  Active line: Unknown');

// A Convert row has no isActive; currentData's presence is the active signal.
var conv = { ok: true, platform: 'convert', detected: { optimizely: false, convert: true, convertScript: true },
  catalogComplete: true, forced: {}, errors: [],
  experiments: [{ id: EXP, name: 'Conv test', known: true, active: true, bucketed: true, variationId: 'V1',
    variationName: 'v1: Hero', variations: [{ id: 'V0' }, { id: 'V1' }], reason: null, forced: false, source: 'currentData.variation_id' }] };
var vConv = ev(conv, Object.assign({}, CTX, { platform: 'Convert' }));
eq(vConv.state, 'BUCKETED', 'a bucketed Convert row is active');
eq(expActivityText(vConv.activity), 'Yes', '  Active line: Yes, with no Optimizely fields');

// A worker that has not been reloaded (popup.js reloads per open, the worker
// only on extension reload) sends rows with no isActive field at all. Its
// `active` was already read from isActive, so it decides.
var old = JSON.parse(JSON.stringify(pSticky));
old.experiments.forEach(function (r) { delete r.isActive; });
eq(ev(old).state, 'BUCKETED_INACTIVE', 'an older worker\'s row (no isActive field) still reads as not active');

eq(expEvaluate({ tabId: null }, CTX, SET).activity, null, 'before there is a page, there is no Active claim');
eq(expActivityText(null), '—', '  and the line shows a dash');

// ── the ticket's related tests ───────────────────────────────────────────────
section('Softcoded / Concurrent rows say when a bucket is not active');

function fakeEl() {
  var cls = {};
  return { textContent: '', innerHTML: '', style: {}, dataset: {},
    classList: {
      add: function () { for (var i = 0; i < arguments.length; i++) cls[arguments[i]] = true; },
      remove: function () { for (var i = 0; i < arguments.length; i++) delete cls[arguments[i]]; },
      toggle: function (c, on) { if (on === undefined ? !cls[c] : on) cls[c] = true; else delete cls[c]; },
      contains: function (c) { return !!cls[c]; },
    } };
}
var els = {};
document.getElementById = function (id) { return els[id] || (els[id] = fakeEl()); };

expRenderRelatedList('exp-softcoded-wrap', 'exp-softcoded', [
  { ticketKey: 'QA-2', found: true, active: false, bucketed: true, variationName: 'v0: Control' },
  { ticketKey: 'QA-3', found: true, active: true, bucketed: true, variationName: 'v1: Promo' },
  { ticketKey: 'QA-4', found: true, active: true, bucketed: false },
]);
var rel = els['exp-softcoded'].innerHTML;
ok('a held bucket on an inactive test says so', /v0: Control \(bucketed, not active\)/.test(rel), rel);
ok('  and is styled as a warning, not a hit', /exp-rel-warn[^]*QA-2/.test(rel) && !/exp-rel-hit[^]*QA-2/.test(rel), rel);
ok('an active bucket names its variation, as before', /exp-rel-hit[^]*QA-3[^]*v1: Promo/.test(rel), rel);
ok('active but not bucketed says active', /active, not bucketed/.test(rel), rel);

// ── the rendered card ────────────────────────────────────────────────────────
section('expRender: the Active line is on the card');

function render(probe) {
  els = {};
  expStatus = statusOf(probe); expCtx = CTX; expSettings = SET;
  expRender();
  return els;
}
var rSticky = render(pSticky);
eq(rSticky['exp-active-v'].textContent, 'No — isActive: false, reason: —', 'the card shows Active: No for the held bucket');
ok('  in the "no" colour', rSticky['exp-active-v'].classList.contains('exp-act-no') && !rSticky['exp-active-v'].classList.contains('exp-act-yes'));
ok('  on a warning card', rSticky['exp-card'].classList.contains('exp-warn'));
eq(rSticky['exp-actual-v'].textContent, '—', '  with nothing under "On page"');

var rOn = render(pOn);
eq(rOn['exp-active-v'].textContent, 'Yes — isActive: true, reason: force', 'Active: Yes on the green card');
ok('  in the "yes" colour, and the previous "no" class is gone',
   rOn['exp-active-v'].classList.contains('exp-act-yes') && !rOn['exp-active-v'].classList.contains('exp-act-no'));
eq(rOn['exp-actual-v'].textContent, 'v1 — v1: Hero', '  with the variation under "On page"');

// popup.html and sidepanel.html both load popup.js: the row the renderer
// writes must exist in both, or one of them silently shows no Active line.
['../popup.html', '../sidepanel.html'].forEach(function (f) {
  var html = readFile(f);
  ok(f + ' has the Active row', /<div id="exp-active"><span class="exp-k">Active<\/span><span class="exp-v" id="exp-active-v">/.test(html));
  ok(f + ' styles it like its neighbours', html.indexOf('#exp-expected,#exp-active,#exp-actual{') !== -1);
});

print('\n=== ' + passed + ' passed, ' + failed + ' failed ===');
if (failed) throw new Error(failed + ' assertion(s) failed');
