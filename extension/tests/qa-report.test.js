// QA report rendering suite — what the printed/shared report actually shows.
//
//   RUN:  cd extension/tests && jsc qa-report.test.js
//   (jsc ships with macOS at
//    /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
//    — add it to PATH or invoke by full path.)
//
// Same standing as vd-diff.test.js and figma.test.js: NOT wired into
// .github/workflows/run-tests.yml, which runs pytest against a `tests/`
// directory this repo does not have. The Python backend is out of scope.
//
// This suite exists because of one measured failure, not a hypothetical. Two
// runs of ENOC-97 (OnDeck) taken 106 seconds apart produced byte-identical
// deterministic diff output — 85 control / 140 variant elements, 34 matched
// pairs, matchedFraction 0.24285714285714285, pixelDiff 0.6694682506079291,
// the same seven region rollups with the same rects — and DIFFERENT grades:
//
//   run 1: expected ×7
//   run 2: expected ×5, unclear ×2  (regions `main` and `footer`)
//
// The report used to collapse every "expected" finding into a closed
// <details>, so run 1 rendered a PASS with all seven findings behind one
// triangle — including a footer that matched 11/11 against a ticket asking for
// new disclaimer copy, which run 2 surfaced as a question. Sampling variance
// cannot be tuned away here: `temperature` is not a parameter on
// claude-opus-5 (removed across the current family, returns 400). So the
// invariant this suite protects is that the grade decides ORDER and LABEL,
// never VISIBILITY.
//
// Findings below are wire-shaped (controlBlock/variantBlock), the shape
// vdFindingToWire emits and the renderer consumes — NOT the flattened
// controlRect/controlText shape the debug log stores. Getting that wrong makes
// every rect assertion silently exercise the no-rect branch and pass for the
// wrong reason.

// buildDesignReferenceDebug now hashes the spec with vdHash32, which lives in
// vd-diff.js and reaches popup.js as a bare global (popup.html and
// sidepanel.html both load vd-diff.js at :1303, before popup.js at :1305).
// This suite deliberately loaded nothing until now, so without these two the
// sliced builder throws ReferenceError on its first call and aborts all 457
// assertions with no failure list. Do not delete them as unused.
load('../vd-config.js');
load('../vd-diff.js');
load('../qa-pass.js');
// email-check.js: the Email Check panel and report sections below call its pure functions (loaded after qa-pass.js, as in both panels).
load('../email-check.js');

var _pu = readFile('../popup.js');
function slicePopup(from, to) {
  var a = _pu.indexOf(from), b = _pu.indexOf(to, a + 1);
  if (a === -1 || b === -1) throw new Error('slice marker missing: ' + from);
  return _pu.slice(a, b);
}
// Sliced, not copied, so renaming any of these breaks the suite loudly rather
// than leaving it to test a stale duplicate.
eval(slicePopup('function esc(s) {', '\nfunction '));
eval(slicePopup('function rptBadge(kind, label) {', 'function rptAgenticNoteHtml('));
// The run's ONE visual-diff verdict, shared by rptAbSection and
// rptAbVisualDiffSection so their badges cannot disagree.
eval(slicePopup('function vdUnmetRequirements(v) {', '\n// The pages this run actually tested'));
eval(slicePopup('function abCaptureWidths(modes) {', '\n// Which configured metrics'));
eval(slicePopup('function rptAbVisualDiffSection(vd) {', '\nfunction rptWcagSection('));
eval(slicePopup('function abFiredMetricRows(metricRows) {', '\nfunction rptAbSection('));
var abState = { qaMode: false };

// The Performance and A/B accessibility report sections. PERF_METRICS
// and WCAG_CHECKS are `const` arrays and so do not survive eval-slicing (the
// same trap that cost VIS_REPORT_RETRIES and VD_GRADES a test); stubbed here as
// `var` before the slices, because the sliced functions resolve globals at call
// time. The stubs are shaped like the real data, not simplified.
var PERF_METRICS = [
  { key: 'lcpMs', label: 'LCP', budget: 'lcpMs', unit: 'ms' },
  { key: 'clsScore', label: 'CLS', budget: 'clsScore', unit: 'num' },
];
var WCAG_CHECKS = [{ key: 'contrast', label: 'Colour contrast' }, { key: 'alt', label: 'Image alt text' }];
eval(slicePopup('function shortUrl(u) {', '\nfunction '));
eval(slicePopup('function fmtMetric(v, m) {', '\nfunction '));
eval(slicePopup('function diffCvaRuns(runs, checkKeys) {', '\nfunction '));
// The axe-core and scope notes rptCvaSection prints over an A/B accessibility
// entry, and the builder that turns an A/B run's captures into that entry.
eval(slicePopup('function cvaRunNotes(run) {', '\nfunction '));
eval(slicePopup('function abA11yEntry(captures, perVariant, autoChecks, ts, workerAck, manualChecks) {', '\n// ═══'));
// rptCvaSection prints the accessibility review through it, as rptWcagSection does.
eval(slicePopup('function rptAgenticNoteHtml(note, label) {', '\n// ── the run'));
eval(slicePopup('function rptCvaSection(entry) {', '\nfunction rptPerfSection'));
eval(slicePopup('function rptPerfSection(entry) {', '\nfunction rptFunnelSection'));
// QA Pass's report section: buildReportBody names it, so it is defined for every block below.
eval(slicePopup('function rptQaPassSection(entry) {', '\n// ── Report assembly'));
// Email Check's report section and its eleven helpers (they sit just before QA Pass's section): buildReportBody names rptEmailCheckSection too.
eval(slicePopup('function rptEmailCheckSection(entry) {', "\n// ── QA Pass (Test Agent mode 'qapass'): the report section"));

// ── harness ────────────────────────────────────────────────────────────────
var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 300) : ''));
}
function eq(name, actual, expected) { ok(name, actual === expected, { actual: actual, expected: expected }); }
function section(t) { print('\n' + t); }

// A region rollup as the wire adapter emits one: no text on either side, a
// union box per side, engineNote carrying the whole of its content.
var _fid = 0;
function rollup(region, grade, opts) {
  opts = opts || {};
  var block = function (rect) {
    return rect ? { type: 'region', label: region, text: null, rect: rect, rectSource: 'region-union' } : null;
  };
  return {
    findingId: 'f' + (_fid++), changeClass: 'region-rollup', status: 'modified',
    classification: grade, severity: grade === 'expected' ? null : 'low',
    region: region, synthetic: true, changeSignals: ['region-rollup'],
    controlBlock: block(opts.controlRect || { x: 695, y: 187, w: 1296, h: 3105 }),
    variantBlock: 'variantRect' in opts ? block(opts.variantRect) : block({ x: 80, y: 178, w: 2526, h: 5195 }),
    engineNote: region + ': 11 elements in Control, 11 in Variant, 11 matched.',
    note: opts.note || (region + ' rollup note'),
  };
}
function render(findings, over) {
  return rptAbVisualDiffSection(Object.assign({
    baselineLabel: 'v0', sharedFindings: [],
    perVariant: [Object.assign({
      label: 'v1', findings: findings, diffMode: 'redesign', matchedFraction: 0.243,
      overallSummary: 'A full landing-page rebuild.',
      structuralStats: { addedCount: 106, removedCount: 51, modifiedCount: 1, styleChangedCount: 11, unchangedCount: 0 },
      matchTierCounts: { 'path+text': 23, stableId: 5, text: 6 },
      aggregate: { reflow: 23, reflowPxMax: 2108 },
    }, (over || {}).variant || {})],
  }, (over || {}).vd || {}));
}
// Findings are <tr> in a THREE-column table. Image Ref holds two contained
// cells stacked (Control above Variant); Short Description holds the
// description and then the grade chip beneath it — no caption, no wrapper box.
// Counted by the type chip because every finding row carries one and the
// group-heading rows (which are also <tr>, colspan=4) do not — counting bare
// <tr> would include the header and the group headings.
function rowCount(h) { return (h.match(/class="ab-delta"/g) || []).length; }
function chipCount(h) { return (h.match(/text-transform:uppercase/g) || []).length; }

// ── 1. the grade must not gate visibility ──────────────────────────────────
section('grade decides order and label, never visibility');

// The exact run-1 shape: everything graded expected. This is the case that
// used to render as a single closed triangle.
(function allExpected() {
  var h = render(['section', 'form', 'main', 'nav#menu-footer', 'nav#menu-awards', 'footer', 'nav#menu-social']
    .map(function (r) { return rollup(r, 'expected'); }));
  ok('7/7 expected: no <details> gate', h.indexOf('<details') === -1);
  eq('7/7 expected: all seven render as rows', rowCount(h), 7);
  eq('7/7 expected: all seven carry a grade chip', chipCount(h), 7);
  ok('7/7 expected: the reader is told the grade is unstable',
     h.indexOf('move between runs') !== -1);
})();

// The run-2 shape over the SAME findings. What renders must not change.
(function twoUnclear() {
  var regions = ['section', 'form', 'main', 'nav#menu-footer', 'nav#menu-awards', 'footer', 'nav#menu-social'];
  var run1 = render(regions.map(function (r) { return rollup(r, 'expected'); }));
  var run2 = render(regions.map(function (r) {
    return rollup(r, (r === 'main' || r === 'footer') ? 'unclear' : 'expected');
  }));
  eq('regrading two findings does not change how many render', rowCount(run2), rowCount(run1));
  eq('regrading two findings does not change how many are labelled', chipCount(run2), chipCount(run1));
  // The rects a reader can see are the subject of each row. Identical diff
  // output must present identical subjects regardless of grade.
  function subjects(h) {
    var out = [], re = /near \((-?\d+), (-?\d+)\), (\d+)×(\d+)px/g, m;
    while ((m = re.exec(h))) out.push(m[1] + ',' + m[2] + ' ' + m[3] + 'x' + m[4]);
    return out.sort().join(' | ');
  }
  ok('identical diff output renders identical subjects under either grading',
     subjects(run1) === subjects(run2) && subjects(run1).length > 0,
     { run1: subjects(run1), run2: subjects(run2) });
  ok('the two gradings really do differ (else the assertions above prove nothing)',
     run1 !== run2);
})();

// ── 2. the grade is still visible, and still orders the list ───────────────
section('grade is still reported');

// Parse the grade chips out in document order rather than string-matching their
// closing tags — the chip's contents grew a severity suffix once severity
// started rendering, and three assertions here were pinned to `grade</span>`.
function chipTexts(h) {
  var out = [], re = /letter-spacing:\.03em;[^>]*>([^<]*)<\/span>/g, m;
  while ((m = re.exec(h))) out.push(m[1]);
  return out;
}

(function gradeStillShown() {
  var h = render([rollup('section', 'unexpected'), rollup('main', 'unclear'), rollup('footer', 'expected')]);
  var chips = chipTexts(h);
  eq('one chip per finding', chips.length, 3);
  // Severity-first reading order: unexpected, then unclear, then expected. The
  // chip text carries the grade and, for the two non-expected kinds, a severity.
  eq('rows are ordered unexpected -> unclear -> expected',
     chips.map(function (c) { return c.split(' \u00b7 ')[0]; }).join(','),
     'unexpected,unclear,expected');
})();

(function severityIsShown() {
  // severity was computed by the model, exported to the debug log, and rendered
  // nowhere — the only per-finding urgency signal the pipeline produces, thrown
  // away. It is shown but never sorted on: runs 5 and 6 of ENOC-97 returned
  // `low` then `medium` for the same finding from a byte-identical prompt.
  var chips = chipTexts(render([rollup('main', 'unclear'), rollup('footer', 'expected')]));
  eq('an unclear finding shows its severity beside the grade', chips[0], 'unclear \u00b7 low');
  eq('an expected finding shows no severity (the model emits null there)', chips[1], 'expected');
  // A junk severity must not reach the page, and must not cost the grade.
  var bad = rollup('main', 'unclear');
  bad.severity = 'catastrophic';
  eq('an unrecognized severity is dropped, grade still shown', chipTexts(render([bad]))[0], 'unclear');
  var none = rollup('main', 'unclear');
  none.severity = null;
  eq('a missing severity is dropped, grade still shown', chipTexts(render([none]))[0], 'unclear');
  ok('the honesty line now covers severity too',
     render([rollup('footer', 'expected')]).indexOf('severity are model judgments') !== -1);
})();

(function ungradedFindingStillRenders() {
  // Found by this suite: the three-bucket filter dropped anything that was
  // not exactly unexpected/unclear/expected, so a finding the model returned
  // no usable verdict for vanished from the report — while v.noVerdictCount
  // went on telling the reader it existed. The chip is what goes missing on
  // an ungraded finding, not the row.
  var f = rollup('section', null);
  f.classification = null;
  var h = render([f]);
  eq('an ungraded finding still renders', rowCount(h), 1);
  eq('an ungraded finding gets no chip', chipCount(h), 0);
  ok('an ungraded finding is called unjudged, not cleared',
     h.indexOf('unjudged, not cleared') !== -1);
  // A junk grade must take the same path as a missing one, not be trusted.
  var g = rollup('form', 'expected');
  g.classification = 'probably-fine';
  eq('an unrecognized grade still renders', rowCount(render([g])), 1);
})();

// ── 3. a rollup with one side missing still anchors ────────────────────────
section('one-sided rollups');

(function missingVariantSide() {
  // ENOC-97's `main` rollup had variantRect null — the region emptied out.
  // It must still render with the control-side rect as its anchor.
  var h = render([rollup('main', 'unclear', { controlRect: { x: 719, y: 1203, w: 1248, h: 136 }, variantRect: null })]);
  eq('a rollup with no variant side still renders', rowCount(h), 1);
  ok('it anchors on the control rect', h.indexOf('719, 1203') !== -1);
})();

// ── 4. suppression disclosure survives ─────────────────────────────────────
section('suppression disclosure');

(function suppressionLine() {
  var h = render([rollup('section', 'expected')]);
  ok('reflow suppression is still disclosed', h.indexOf('23 suppressed as page reflow') !== -1);
  ok('and names the largest shift', h.indexOf('2108px') !== -1);
})();

// ── the four-column findings table ─────────────────────────────────────────
section('four-column findings table');

function headers(h) {
  var out = [], re = /<th[^>]*>([^<]*)<\/th>/g, m;
  while ((m = re.exec(h))) out.push(m[1]);
  return out;
}
// The cells of the first FINDING row. Group headings are also <tr> with a
// single colspan=4 cell, and every group has one, so picking the first <tr>
// blindly returns a heading — which is what the first draft of these tests did.
function cellsOf(h) {
  var rows = h.split('<tr>').filter(function (r) { return r.indexOf('class="ab-delta"') !== -1; });
  if (!rows.length) return [];
  var out = [], re = /<td[^>]*>([\s\S]*?)<\/td>/g, m;
  while ((m = re.exec(rows[0]))) out.push(m[1]);
  return out;
}
// Just the short description: cell 0 also holds the type chip before it and,
// since the crops became their own cells, the rect locator in a <div> after it.
function shortText(cell) {
  var after = String(cell).split('<br>');
  var body = after.length > 1 ? after.slice(1).join('<br>') : after[0];
  return body.split('<div')[0].replace(/<[^>]*>/g, '').trim();
}

(function theFourColumns() {
  var f = rollup('section', 'unexpected');
  f.shortDescription = 'Hero headline replaced and a business-owner photo added';
  f.note = 'The hero was rebuilt per the ticket. Confirm the photo is the approved asset.';
  var h = render([f]);
  eq('three columns, in order',
     headers(h).join(' | '),
     'Short Description | Image Ref | Detailed Description');
  var c = cellsOf(h);
  eq('three cells per finding', c.length, 3);
  ok('col 1 carries the short description',
     /Hero headline replaced/.test(c[0]), c[0]);
  ok('col 1 also carries the change type', /class="ab-delta"/.test(c[0]));
  // The grade moved into col 1 — it had a column of its own at 8% width that was
  // 20% full, and Detailed needed that width.
  ok('col 1 carries the grade too', /unexpected/.test(c[0]), c[0]);
  ok('  below the description, not above it',
     c[0].indexOf('Hero headline replaced') < c[0].search(/text-transform:uppercase/), c[0]);
  // No caption and no wrapper: gradeChip already renders a self-contained chip
  // with its own border, so a bordered box round it was a box around a box and
  // the caption named something that names itself ("UNEXPECTED · HIGH").
  ok('  as a bare chip, with no box around it',
     (c[0].match(/border:1px solid #d8dbe0/g) || []).length === 0, c[0]);
  ok('no verdict column remains', headers(h).indexOf('Verdict') === -1, headers(h).join('|'));
  ok('col 3 carries the detailed description',
     /Confirm the photo is the approved asset/.test(c[2]), c[2]);
  ok('  and the deterministic facts under it', /Region:/.test(c[2]), c[2]);
  ok('the short description does NOT repeat the long one',
     !/Confirm the photo/.test(c[0]));
})();

(function shortDescriptionIsCappedAt120() {
  var f = rollup('section', 'unclear');
  // 200 characters of real prose.
  f.shortDescription = 'The hero section was replaced wholesale with a new headline, a new subhead, '
    + 'a right-aligned business-owner photograph, a checklist of three benefits, and a primary '
    + 'call to action that differs from control.';
  var text = shortText(cellsOf(render([f]))[0]);
  ok('over-long input is truncated to 120 or fewer', text.length <= 120, text.length);
  ok('  with an ellipsis', /…$/.test(text), text.slice(-24));
  ok('  and cut at a word boundary, not mid-word',
     /[^\s]…$/.test(text) && f.shortDescription.indexOf(text.slice(0, -1)) === 0, text.slice(-30));
  // Exactly 120 must survive intact.
  var g = rollup('form', 'unclear');
  g.shortDescription = 'x'.repeat(120);
  eq('exactly 120 characters is left alone', shortText(cellsOf(render([g]))[0]).length, 120);
})();

(function shortDescriptionFallsBackToTheDiff() {
  // A run whose report call failed keeps its findings and loses every model
  // field (7e38210). The column must still say something true.
  var f = element('added', 'section', 'See My Funding Options');
  f.shortDescription = null; f.note = null; f.classification = null; f.severity = null;
  var c = cellsOf(render([f], { variant: { gradingFailed: 'Failed to fetch' } }));
  ok('the column is derived from the diff, not left blank',
     /See My Funding Options/.test(c[0]), c[0]);
  ok('  and names the change type', /added/.test(c[0]), c[0]);
  ok('the verdict cell says unjudged rather than nothing, so it is never empty',
     /unjudged/.test(c[0]), c[0]);
})();

(function imageRefHoldsTwoContainedCellsStackedVertically() {
  // Stacking is what buys the legibility back: two boxes stacked in a 34%
  // column each get the FULL 34% (~248px at print width), where two cells side
  // by side in the same span got half of it (~124px). Crops are ~10:1 strips,
  // median 526x52 natural, so that is 47% scale against 24%.
  var f = rollup('section', 'expected');
  f.baselineCrop = 'data:image/png;base64,AAA';
  f.variantCrop = 'data:image/png;base64,BBB';
  var h = render([f]);
  var c = cellsOf(h);
  eq('three cells — Image Ref is one of them', c.length, 3);
  ok('both crops are in the Image Ref cell',
     /base64,AAA/.test(c[1]) && /base64,BBB/.test(c[1]), c[1]);
  ok('  each in its own contained cell', (c[1].match(/border:1px solid/g) || []).length === 2, c[1]);
  ok('  and the grade chip does not land in this column',
     !/text-transform:uppercase/.test(c[1]), c[1]);
  ok('  labelled Control and Variant', /Control/.test(c[1]) && /Variant/.test(c[1]));
  ok('Control stacks above Variant',
     c[1].indexOf('base64,AAA') < c[1].indexOf('base64,BBB'), c[1]);
  ok('  as blocks, not side by side — no flex row',
     !/display:flex/.test(c[1]), c[1]);
  ok('the cell also carries the locator', /695, 187/.test(c[1]), c[1]);
  eq('each crop appears exactly once in the report',
     (h.match(/base64,AAA/g) || []).length, 1);
  eq('  on both sides', (h.match(/base64,BBB/g) || []).length, 1);
  ok('no crop leaks into another column',
     !/base64/.test(c[0]) && !/base64/.test(c[2]));
  // Per box, and 160px rather than 220px BECAUSE they stack: two boxes make the
  // row twice as tall, and uncapped the section rollup's 1296x3105 crop renders
  // ~594px in a 248px box. A stacked pair of those is most of a page, and
  // page-break-inside then strands the rest — three pages of run 1788362945211
  // were 30-65% blank from that. At 248px wide the measured crops render ~25px
  // (median), ~27px (p75) and ~69px (p90), so the cap clamps almost nothing.
  ok('each crop box caps its own height',
     (c[1].match(/max-height:160px/g) || []).length === 2, c[1]);
  ok('  low enough that a stacked pair cannot eat a page',
     !/max-height:(?:[2-9]\d\d|\d{4,})px/.test(c[1]), c[1]);

  // ONE row per finding — no separate full-width crop row.
  ok('there is no separate full-width crop row',
     !/<td colspan="[45]"[^>]*style="padding-top:0"/.test(h));
  var tb = h.split('<tbody').filter(function (x) { return x.indexOf('class="ab-delta"') !== -1; });
  eq('one tbody per finding', tb.length, 1);
  eq('  holding exactly one row', (tb[0].match(/<tr>/g) || []).length, 1);
})();

(function aMissingCropSideJustOmitsItsBox() {
  // A removed element has no variant side, and vice versa. One box, not an
  // empty one — the column header no longer promises two.
  var f = element('removed', 'section', 'Move forward with fast business funding.');
  f.baselineCrop = 'data:image/png;base64,AAA';
  f.variantCrop = null;
  var c = cellsOf(render([f]));
  eq('still three cells', c.length, 3);
  ok('the Control box is there', /base64,AAA/.test(c[1]) && /Control/.test(c[1]), c[1]);
  ok('  and only one box', (c[1].match(/border:1px solid/g) || []).length === 1, c[1]);
  ok('  with no empty Variant box', !/Variant/.test(c[1]), c[1]);

  // No crops at all, and a checkpoint-restored finding says why.
  var g = rollup('footer', 'expected', { controlRect: { x: 695, y: 3912, w: 1296, h: 614 } });
  var gc = cellsOf(render([g]))[1];
  ok('with no crop the cell says so', /No crop/.test(gc), gc);
  ok('  and still anchors the finding by coordinates', /695, 3912/.test(gc), gc);
  var rc = cellsOf(render([g], { variant: { resumed: true } }))[1];
  ok('a checkpoint-restored finding says why', /checkpoint/.test(rc), rc);
})();

(function theModelsShortDescriptionIsActuallyUsed() {
  // It was added to the schema and the prompt in 5d934d2 but never copied into
  // the object leaving runVisualReport, so it came back on 0 of 67 findings in
  // a run whose grading fully succeeded, and column 1 silently fell back to raw
  // element text for every row. The renderer half is pinned here; the projection
  // half is pinned in vd-diff.test.js.
  var f = element('removed', 'section', 'By clicking "Get Started," I authorize OnDeck (ODK Capital, LLC, OnDeck Connect, LLC, and their affiliated entities) and its referral partners to contact me');
  f.shortDescription = 'TCPA/autodialer consent disclaimer removed from under the lead form.';
  var c = cellsOf(render([f]));
  ok('the model summary fills column 1', /TCPA\/autodialer consent disclaimer removed/.test(c[0]), c[0]);
  ok('  not the raw element text', !/ODK Capital/.test(c[0]), c[0]);
})();

(function theWordVerdictAppearsNowhere() {
  // Asked for directly: it was redundant everywhere it appeared in this table.
  // Scoped to this section's output, so the Performance section's OK/OVER column
  // header — a genuine column name, in a section that does not even render here
  // — is unaffected.
  var f = rollup('section', 'unexpected');
  f.shortDescription = 'Hero headline replaced';
  f.note = 'Rebuilt per the ticket.';
  var graded = render([f]);
  ok('not in a graded finding', !/[Vv]erdict/.test(graded), (/.{0,60}[Vv]erdict.{0,60}/.exec(graded) || [''])[0]);

  // The ungraded path carried it twice: the box caption and the group heading.
  var u = rollup('form', null);
  u.classification = null; u.severity = null;
  var ungraded = render([u], { variant: { noVerdictCount: 1 } });
  ok('not in an ungraded finding or its group heading',
     !/[Vv]erdict/.test(ungraded), (/.{0,80}[Vv]erdict.{0,80}/.exec(ungraded) || [''])[0]);
  // …and what replaced it still tells the reader the same thing.
  ok('  the finding still reads unjudged', /unjudged/.test(cellsOf(ungraded)[0]), cellsOf(ungraded)[0]);
  ok('  the group heading still says unjudged, not cleared',
     /unjudged, not cleared/.test(ungraded));
  ok('  and the count line still reports it', /returned without a grade/.test(ungraded), ungraded.slice(0, 200));
})();

(function sharedFindingsGetTheFourColumnsToo() {
  // 5d934d2 converted findings to <tr> but left this section emitting them with
  // no <table> around them, so every "Common to all variants" finding rendered
  // as a run of unlabelled text — the parser drops rows it cannot place. These
  // are the findings a reviewer most needs the Verdict column for, since they
  // are present in EVERY variant.
  var sh = rollup('nav', 'unexpected');
  sh.sharedAcross = ['v1', 'v2'];
  var h = render([], { vd: { sharedFindings: [sh] } });
  var i = h.indexOf('Common to all variants');
  ok('the shared section renders', i !== -1);
  var after = h.slice(i);
  var tableAt = after.indexOf('<table'), rowAt = after.indexOf('<tbody');
  ok('its rows are inside a table', tableAt !== -1 && tableAt < rowAt,
     'table@' + tableAt + ' tbody@' + rowAt);
  ok('  with the same three headers', /Short Description[\s\S]*?Image Ref[\s\S]*?Detailed Description/
     .test(after.slice(tableAt, rowAt)));
})();

(function findingAndItsCropsCannotBeSplitByAPageBreak() {
  // page-break-inside in the stylesheet is on `tr`, which would happily put a
  // finding on one page and its crops on the next.
  var f = rollup('section', 'expected');
  f.baselineCrop = 'data:image/png;base64,AAA';
  f.variantCrop = 'data:image/png;base64,BBB';
  var h = render([f]);
  ok('each finding is wrapped in its own tbody',
     /<tbody style="page-break-inside:avoid">/.test(h), h.slice(0, 300));
  var tb = h.split('<tbody').filter(function (x) { return x.indexOf('class="ab-delta"') !== -1; });
  eq('one tbody per finding', tb.length, 1);
  ok('  containing its single row', (tb[0].match(/<tr>/g) || []).length === 1, tb[0].slice(0, 80));
})();

(function derivedShortDescriptionStopsRepeatingItself() {
  // Run 1788360614883 rendered "Region / region: section" beside a detail
  // column that then said "Region: section" — the same word three times.
  var r = rollup('section', null);
  r.classification = null; r.shortDescription = null; r.note = null;
  r.engineNote = 'section: 45 elements in Control, 106 in Variant, 1 matched.';
  var rc = cellsOf(render([r]));
  ok('a rollup falls back to its COUNTS, not its region name',
     /45 elements in Control, 106 in Variant, 1 matched/.test(rc[0]), rc[0]);
  ok('  with no "region:" prefix duplicating the chip', !/region:\s*section/i.test(rc[0]), rc[0]);

  var e = element('removed', 'section', 'Move forward with fast business funding.');
  e.shortDescription = null; e.note = null; e.classification = null;
  var ec = cellsOf(render([e]));
  ok('an element falls back to its text with no "removed:" prefix',
     /Move forward with fast business funding/.test(ec[0]) && !/^\s*removed:/.test(shortText(ec[0])), shortText(ec[0]));
  ok('  and the detail column does not repeat it verbatim',
     !/Control text/.test(ec[3]), ec[3]);
})();

(function groupHeadingsStayInsideTheTable() {
  // Four separate tables would stop the columns lining up across the groups.
  var h = render([
    rollup('section', 'unexpected'),
    rollup('form', 'expected'),
  ]);
  eq('one table', (h.match(/<table/g) || []).length, 1);
  ok('the expected-group heading is a full-width row',
     /<td colspan="3"/.test(h), h.slice(0, 400));
  ok('  and still carries the instability caveat', /move between runs/.test(h));
})();

// ── a failed model call must not discard the diff ──────────────────────────
section('grading failure degrades, it does not erase');

(function gradingFailureKeepsEverythingDeterministic() {
  // Run 1788193353815: the deterministic diff completed and 70 requirements were
  // checked, then one "Failed to fetch" reaching api.anthropic.com discarded the
  // whole variant and the report showed nothing. The deterministic half needs no
  // network — losing the grader should cost the grades and nothing else.
  var findings = [rollup('section', 'expected'), rollup('footer', 'expected')]
    .map(function (f) { f.classification = null; f.severity = null; return f; });
  var h = render(findings, { variant: {
    gradingFailed: 'Failed to fetch',
    requirements: { total: 70, verbatim: 65, near: 1, absent: 4, items: [
      { required: 'Lump Sum Loan', norm: 'lump sum loan', status: 'near', score: 0.5,
        fragment: false, foundText: 'Lump-Sum Funding', inControl: null },
    ] },
  } });
  ok('the failure is stated plainly', /Not graded\./.test(h), h.slice(0, 400));
  ok('  naming the underlying error', /Failed to fetch/.test(h));
  ok('  and saying what DID survive', /specified-copy check all completed/.test(h));
  // The valuable half is still there.
  ok('requirement coverage still renders', /65 of 70 found verbatim/.test(h), h.slice(0, 700));
  ok('the unmet item still renders', /Lump-Sum Funding/.test(h));
  eq('both findings still render', rowCount(h), 2);
  // Ungraded, not cleared — the 5ed70e5 bucket.
  ok('findings are labelled unjudged rather than passed', /unjudged, not cleared/.test(h));
  ok('  and carry no grade chip', !/letter-spacing:\.03em/.test(h), h.slice(0, 700));
})();

// ── 4a. requirement coverage leads, and drives the badge ───────────────────
section('requirement coverage in the report');

function withReq(req, findings) {
  return render(findings || [rollup('section', 'expected')], {
    variant: { requirements: req },
  });
}
// The shape vdMatchRequirements returns.
function reqSet(items) {
  var c = function (st) { return items.filter(function (x) { return x.status === st; }).length; };
  return { total: items.length, verbatim: c('verbatim'), near: c('near'), absent: c('absent'), items: items };
}
function item(status, required, opts) {
  opts = opts || {};
  return {
    required: required, norm: required.toLowerCase(), status: status,
    score: opts.score == null ? (status === 'verbatim' ? 1 : 0.5) : opts.score,
    fragment: !!opts.fragment, foundText: opts.foundText || null,
    inControl: opts.inControl == null ? null : opts.inControl,
  };
}

(function coverageLineLeadsTheVariant() {
  // Run 1787947608728 put 3 actionable findings behind 64 rows graded
  // 'expected'. This line answers "does it match the spec?" without reading
  // any of them, and it does so reproducibly.
  var h = withReq(reqSet([
    item('verbatim', 'See My Funding Options'),
    item('verbatim', 'Apply in minutes'),
    item('near', 'Lump Sum Loan', { foundText: 'Lump-Sum Funding' }),
    item('absent', 'Repayment terms up to 24 months', { inControl: false }),
  ]));
  ok('the coverage line is present', /Specified copy:/.test(h), h.slice(0, 200));
  ok('  and reports verbatim over total', /2 of 4 found verbatim/.test(h), h.slice(0, 400));
  ok('  and counts the unmet', /2 unmet/.test(h));
  ok('altered copy shows both the spec and the page wording',
     /Lump Sum Loan/.test(h) && /Lump-Sum Funding/.test(h));
  ok('absent copy is named', /Not found on the page/.test(h));
  // The line must sit ABOVE the model's prose, since it is the reliable half.
  var iReq = h.indexOf('Specified copy:'), iSum = h.indexOf('A full landing-page rebuild.');
  ok('coverage precedes the model summary', iReq !== -1 && iSum !== -1 && iReq < iSum,
     { iReq: iReq, iSum: iSum });
})();

(function absentCopyThatControlHasIsNotCalledUnchanged() {
  // STRZ-1658 v1, real: the spec says `"BEST DEAL" badge moves off the Annual
  // card`, so the extractor requires BEST DEAL, the variant correctly drops it,
  // and Control still has it (inControl). The line used to read "Still present
  // in Control, so the old copy did not change", telling a client the opposite
  // of what happened.
  var h = withReq(reqSet([
    item('verbatim', 'Most Popular'),
    item('absent', 'BEST DEAL', { inControl: true }),
  ]));
  ok('an absent string Control has is not reported as unchanged copy', !/did not change/.test(h), h.slice(0, 600));
  ok('  it says the spec may be quoting the copy it replaces',
     /may be the old copy the spec says to replace/.test(h), h.slice(0, 600));
  var g = withReq(reqSet([item('absent', 'Brand New Line', { inControl: false })]));
  ok('  and says nothing of the kind when Control lacks it too', !/old copy/.test(g), g.slice(0, 600));
})();

(function fragmentsDoNotCountAsUnmet() {
  // A prefix relationship means the wording did not change — only how much of
  // it one element carries. Three of five near-matches on the real ENOC-97 data
  // were fragments, so counting them as defects would be a standing false alarm.
  var h = withReq(reqSet([
    item('verbatim', 'Present copy'),
    item('near', 'Once you apply with OnDeck we will review your application',
         { fragment: true, foundText: 'Once you apply with OnDeck we will' }),
  ]));
  ok('a fragment is reported as partially present', /1 partially present/.test(h), h.slice(0, 400));
  ok('  and is NOT counted as unmet', !/unmet/.test(h), h.slice(0, 400));
})();

(function coverageDrivesTheBadge() {
  // The whole point. Twelve runs produced four different classification vectors
  // on identical input, so a badge resting on the model alone moves for no
  // reason. A missing quoted requirement must badge regardless.
  var allExpected = [rollup('section', 'expected'), rollup('footer', 'expected')];
  var clean = withReq(reqSet([item('verbatim', 'All present')]), allExpected);
  // NEEDS REVIEW, not PASS. The badge no longer reads a grade, so "every finding
  // graded expected" is not a clearance — two differences exist and a human has
  // to look at them. PASS is now reserved for a run with no differences at all.
  ok('all requirements met and every finding expected still NEEDS REVIEW',
     /NEEDS REVIEW/.test(clean), clean.slice(0, 300));
  var unmetRun = withReq(reqSet([
    item('verbatim', 'All present'),
    item('absent', 'Repayment terms up to 24 months'),
  ]), allExpected);
  ok('an absent requirement badges ISSUES FOUND even with every finding "expected"',
     /ISSUES FOUND/.test(unmetRun), unmetRun.slice(0, 300));
  var fragmentRun = withReq(reqSet([
    item('verbatim', 'All present'),
    item('near', 'A long specified sentence that continues', { fragment: true, foundText: 'A long specified sentence' }),
  ]), allExpected);
  ok('a fragment alone does NOT badge ISSUES FOUND',
     !/ISSUES FOUND/.test(fragmentRun) && /NEEDS REVIEW/.test(fragmentRun), fragmentRun.slice(0, 300));
})();

(function theThreeCoverageStatesAreDistinguishable() {
  // This block used to be `noRequirementsIsSilent` and asserted that BOTH "no
  // spec" and "a spec with no quoted copy" render nothing. That conflated two
  // different facts into one silence, and the second one is a false reassurance:
  // a report with no coverage block reads as "every specified string was found",
  // which is the opposite of what the absence means.
  //
  // Measured on the six commonest ticket shapes, FOUR yield zero checkable
  // strings (prose, `label: value` where the label is not "copy", markdown bold,
  // a bullet list), so this is the normal case on a new client's tickets rather
  // than an edge.

  // 1. No spec at all — still silent here. It has its own note in the variant
  // body and its own info in Run Diagnostics; a second line would double-report.
  var none = render([rollup('section', 'expected')]);
  ok('no requirements at all renders no coverage line', !/Specified copy:/.test(none));

  // 2. A spec was read and produced nothing to check — now says so.
  var empty = withReq({ total: 0, verbatim: 0, near: 0, absent: 0, items: [] });
  ok('a zero-total requirement set SAYS the check did not run',
     /Specified copy:/.test(empty) && /produced no checkable strings/.test(empty),
     empty.slice(0, 400));
  ok('  and says whose judgment is left', /the model's alone/.test(empty), empty.slice(0, 400));
  ok('  and tells the reader what extraction reads, so the ticket can be fixed',
     /quoted text/.test(empty) && /Eyebrow copy/.test(empty), empty.slice(0, 400));
  ok('  at warning weight, not as a neutral note', /ab-warn/.test(empty));
  // The badge is deliberately untouched: nothing was established as wrong, one
  // check was unavailable. Same reasoning as vdScaleMismatch being warn.
  ok('  and does not raise ISSUES FOUND', !/ISSUES FOUND/.test(empty), empty.slice(0, 300));
  ok('  the badge still reads NEEDS REVIEW', /NEEDS REVIEW/.test(empty), empty.slice(0, 300));

  // 3. An older service worker with no requirements code at all — a different
  // fact with a different fix, and it used to appear ONLY in Run Diagnostics,
  // never in the part of the report a reviewer reads.
  var oldWorker = render([rollup('section', 'expected')], {
    variant: { requirementsUnsupported: true } });
  ok('an older background build says so in the variant body',
     /Specified copy:/.test(oldWorker) && /older background/.test(oldWorker),
     oldWorker.slice(0, 400));
  ok('  and tells the reader to reload the extension', /Reload the extension/.test(oldWorker));
  ok('  without claiming the spec produced nothing',
     !/produced no checkable strings/.test(oldWorker), oldWorker.slice(0, 400));

  // The three are mutually exclusive, so no run can show two of them.
  var both = render([rollup('section', 'expected')], {
    variant: { noSpecText: true, requirements: { total: 0, verbatim: 0, near: 0, absent: 0, items: [] } } });
  ok('noSpecText suppresses the produced-nothing line rather than contradicting it',
     !/produced no checkable strings/.test(both), both.slice(0, 400));
})();

(function coverageOfCoverageRendersCollapsed() {
  // Two more silences the coverage block used to have: a spec line no
  // extraction pass could turn into a string (ENOC-97's unquoted footer
  // footnotes), and a heading naming a page region where nothing was found on
  // either page (its "Header / Nav — new" section on 33 of 33 recorded ondeck
  // runs). Both are collapsed by default -- most reports have nothing here,
  // and an expanded list of skipped lines would bury the findings above it.
  // regionCounts is PER WORD (fixed 2026-09-16): 'nav' carries real matches
  // (footer navs, unrelated to the spec's header) while 'header' carries none
  // — the combined heading must still surface the header gap.
  var withGaps = withReq(Object.assign(reqSet([item('verbatim', 'Apply Now')]), {
    coverage: {
      uncheckedCount: 2,
      unchecked: [{ line: 1, heading: 'Footer', text: 'Change: unquoted footnote one' },
                  { line: 2, heading: 'Footer', text: 'Change: unquoted footnote two' }],
      unattributedUnchecked: 0,
      headings: [{ heading: 'Header / Nav — new', region: ['header', 'nav'], lines: 3, extracted: 1, unchecked: 0,
                   regionCounts: { header: 0, nav: 3 } }],
    },
  }));
  ok('the not-checked-as-written block is present and collapsed',
     /<details[^>]*><summary>.*Not checked as written \(2\)/.test(withGaps), withGaps.slice(0, 600));
  ok('  naming the heading and the line text of each',
     /Footer.*unquoted footnote one/.test(withGaps) && /unquoted footnote two/.test(withGaps),
     withGaps.slice(0, 800));
  ok('a region word with zero matches is called out even though its sibling word has real matches',
     /Header \/ Nav — new" section describes a header region, but no header elements were found on either page/
       .test(withGaps.replace(/\s+/g, ' ')),
     withGaps.slice(0, 900));

  var clean = withReq(Object.assign(reqSet([item('verbatim', 'Apply Now')]), {
    coverage: { uncheckedCount: 0, unchecked: [], unattributedUnchecked: 0,
                headings: [{ heading: 'Hero', region: [], lines: 1, extracted: 1, unchecked: 0 }] },
  }));
  ok('full coverage with a region heading that DID find elements renders neither block',
     !/Not checked as written/.test(clean) && !/describes a .* region, but no/.test(clean), clean.slice(0, 400));

  // Backward compatible: a log recorded before coverage existed has no such
  // key at all, and must render exactly as it always did.
  var noCoverage = withReq(reqSet([item('verbatim', 'Apply Now')]));
  ok('a requirement set with no coverage key renders neither block',
     !/Not checked as written/.test(noCoverage) && !/describes a .* region, but no/.test(noCoverage), noCoverage.slice(0, 400));
})();

// ── 4b. redesign mode's two tiers must be distinguishable ──────────────────
section('region rollups vs itemised findings');

// An element-level finding as vdFindingToWire emits one for an added/removed
// element — the tier redesign mode used to withhold entirely.
function element(status, region, label, opts) {
  opts = opts || {};
  var side = status === 'removed' ? 'controlBlock' : 'variantBlock';
  var f = {
    findingId: 'e' + (_fid++), changeClass: status, status: status,
    classification: opts.grade || 'unclear', severity: opts.grade === 'expected' ? null : 'low',
    region: region, changeSignals: [status], memberCount: opts.memberCount || null,
    note: label + ' was ' + status,
    controlBlock: null, variantBlock: null,
  };
  f[side] = { type: 'paragraph', label: label, text: label, rect: opts.rect || { x: 700, y: 900, w: 400, h: 40 } };
  return f;
}

(function rollupLabelledRegionNotOther() {
  // A rollup fell through findingType's chain to 'other', which is why a real
  // redesign report read "Other main —" for a whole-region summary. With both
  // tiers now in one report that label had to stop being a catch-all.
  var h = render([rollup('main', 'unclear'), element('added', 'main', 'Trust Stats Bar')]);
  var kinds = [];
  var re = /class="ab-delta">([^<]*)</g, m;
  while ((m = re.exec(h))) kinds.push(m[1]);
  eq('two findings, two type labels', kinds.length, 2);
  eq('the rollup is labelled region', kinds[0], 'region');
  eq('the element keeps its own type', kinds[1], 'added');
  ok('neither is the "other" catch-all', kinds.indexOf('other') === -1, kinds);
})();

(function bothTiersRender() {
  // The regression this guards: redesign mode reporting rollups only.
  var findings = [rollup('section', 'expected'), rollup('footer', 'expected')]
    .concat([element('added', 'section', 'Testimonial 1', { grade: 'expected' }),
             element('removed', 'main', '185K+ Businesses funded', { grade: 'expected' }),
             element('added', 'section', 'Feature grid', { grade: 'expected', memberCount: 6 })]);
  var h = render(findings);
  eq('all five render', rowCount(h), 5);
  var kinds = [];
  var re = /class="ab-delta">([^<]*)</g, m;
  while ((m = re.exec(h))) kinds.push(m[1]);
  eq('rollups precede the itemised findings within a grade bucket',
     kinds.join(','), 'region,region,added,removed,added');
})();

// ── 5. the debug export must carry the spec, not just its size ─────────────
section('debug export records the spec text');

// The builder derives the suppression cause from the SAME predicate the
// pipeline gates on, so the log and the decision cannot disagree. Sliced, not
// restated — this one slice picks up vdSpecTicketMismatch and vdSpecIsStale,
// which are adjacent in popup.js.
eval(slicePopup('function vdSpecTicketMismatch(source, specKey, activeKey, hasText) {',
                '\nasync function runVisualDiffPipeline'));
eval(slicePopup('function buildDesignReferenceDebug(ctx, state, hasFigmaPat) {', '\nfunction '));

(function specTextRecorded() {
  // Every expected/unexpected verdict is relative to this string, and both
  // model calls quote it back as justification. Recording only its length
  // meant a claim like "the ticket specifies updated disclaimer footnotes"
  // could not be checked against anything — which is exactly what happened
  // when the two ENOC-97 runs made opposite claims about the footer.
  var spec = 'Rebuild the hero. Update the \u2020/*/** disclaimer footnotes in the footer.';
  var d = buildDesignReferenceDebug(null, { summaryOfChanges: spec, summarySource: 'ticket' }, false);
  eq('the spec text is recorded verbatim', d.summaryOfChanges.text, spec);
  eq('length still agrees with the text', d.summaryOfChanges.length, spec.length);
  eq('source is still recorded', d.summaryOfChanges.source, 'ticket');
  ok('present is still true', d.summaryOfChanges.present === true);
})();

(function specProvenanceRecorded() {
  // `source: 'ticket'` was true and useless — it never said WHICH ticket, and
  // the Summary of Changes box persists across ticket switches. Run
  // 1787945015802 graded 61 of 67 findings "unexpected" on ENOC-97 against a
  // Zapier contact-sales form spec because of exactly that gap.
  var d = buildDesignReferenceDebug(null, {
    summaryOfChanges: 'Rebuild the hero.', summarySource: 'ticket', summaryTicketKey: 'ENOC-97',
  }, false);
  eq('the auto-filling ticket is recorded', d.summaryOfChanges.ticketKey, 'ENOC-97');
  var typed = buildDesignReferenceDebug(null, {
    summaryOfChanges: 'Typed by hand.', summarySource: 'manual', summaryTicketKey: null,
  }, false);
  eq('hand-typed text records no ticket', typed.summaryOfChanges.ticketKey, null);
  var legacy = buildDesignReferenceDebug(null, {
    summaryOfChanges: 'From before provenance existed.', summarySource: 'ticket',
  }, false);
  eq('state persisted before this existed records null, not undefined',
     legacy.summaryOfChanges.ticketKey, null);
  var none = buildDesignReferenceDebug(null, { summaryOfChanges: '   ' }, false);
  eq('no spec records no ticket', none.summaryOfChanges.ticketKey, null);
})();

(function noSpecRecordsNull() {
  var d = buildDesignReferenceDebug(null, { summaryOfChanges: '   ' }, false);
  eq('an empty spec records null rather than an empty string', d.summaryOfChanges.text, null);
  eq('and is not marked present', d.summaryOfChanges.present, false);
  eq('and reports zero length', d.summaryOfChanges.length, 0);
})();

(function specHashRecorded() {
  // The four specs on record differ inside their first 40 characters AND in
  // length, so no real-data assertion can tell a correct hash from a prefix
  // hash or from String(length). Both are wrong in the way that matters — a
  // spec edited in its fifth paragraph is exactly the case this field exists
  // for — so they are pinned here instead.
  var spec = 'Rebuild the hero. Update the \u2020/* disclaimer footnotes in the footer.';
  var d = buildDesignReferenceDebug(null, { summaryOfChanges: spec, summarySource: 'ticket' }, false);
  eq('the spec hash is recorded', d.summaryOfChanges.hash, vdHash32(spec));
  eq('  and it hashes the TRIMMED text, which is what the grader receives',
     buildDesignReferenceDebug(null, { summaryOfChanges: '  ' + spec + '\n', summarySource: 'ticket' }, false)
       .summaryOfChanges.hash, d.summaryOfChanges.hash);
  // vdHash32('') is the FNV offset basis 811c9dc5 — a real-looking value that
  // would give every spec-less run the same fingerprint.
  eq('no spec records no hash',
     buildDesignReferenceDebug(null, { summaryOfChanges: '   ' }, false).summaryOfChanges.hash, null);
  var head = new Array(401).join('a');
  var A = head + ' the footnote reads "Rates from 9.99%".';
  var B = head + ' the footnote reads "Rates from 8.99%".';
  var hA = buildDesignReferenceDebug(null, { summaryOfChanges: A, summarySource: 'ticket' }, false).summaryOfChanges.hash;
  var hB = buildDesignReferenceDebug(null, { summaryOfChanges: B, summarySource: 'ticket' }, false).summaryOfChanges.hash;
  ok('equal-length specs differing only past character 300 hash differently', hA !== hB,
     { a: hA, b: hB });
  ok('  and they really are the same length, so length cannot separate them',
     A.length === B.length);
})();

(function specGradingCauseRecorded() {
  // Run 1787945015802 is the case a boolean would have missed: source
  // 'ticket', an active ENOC-97 context, no summaryTicketKey, and a Zapier
  // spec that graded 61 of 67 findings 'unexpected'. vdSpecTicketMismatch
  // needs BOTH keys, so "stale" is false there.
  var unverified = buildDesignReferenceDebug({ ticketKey: 'ENOC-97' }, {
    summaryOfChanges: 'v1: Two-Step Form Progression', summarySource: 'ticket',
  }, false);
  eq('a ticket-sourced spec with no recorded key is unverified, never clean',
     unverified.summaryOfChanges.grading, 'graded-unverified');
  var stale = buildDesignReferenceDebug({ ticketKey: 'ENOC-97' }, {
    summaryOfChanges: 'v1: Two-Step Form Progression', summarySource: 'ticket',
    summaryTicketKey: 'ZAP-441',
  }, false);
  eq('a spec from another ticket records that the grader got nothing',
     stale.summaryOfChanges.grading, 'withheld');
  ok('  while still keeping the wrong text and its hash, so it stays identifiable',
     stale.summaryOfChanges.text === 'v1: Two-Step Form Progression'
     && stale.summaryOfChanges.hash === vdHash32('v1: Two-Step Form Progression'));
  eq('a matching ticket records graded',
     buildDesignReferenceDebug({ ticketKey: 'ENOC-97' }, { summaryOfChanges: 'Rebuild the hero.',
       summarySource: 'ticket', summaryTicketKey: 'ENOC-97' }, false).summaryOfChanges.grading, 'graded');
  // The three cases the pipeline deliberately does NOT suppress. Each is a
  // 'graded' that must not be mistaken for an unverifiable one.
  eq('hand-typed is graded even against another key',
     buildDesignReferenceDebug({ ticketKey: 'ENOC-97' }, { summaryOfChanges: 'Typed by hand.',
       summarySource: 'manual', summaryTicketKey: 'ZAP-441' }, false).summaryOfChanges.grading, 'graded');
  // The ONLY shape that exercises the `!== 'manual'` guard: with a key set, the
  // `!summaryTicketKey` clause short-circuits first and the guard is never
  // reached. Dropping the guard left every other assertion here green.
  // Hand-typed text legitimately has no ticket key — that is no provenance
  // NEEDED, not provenance missing.
  eq('hand-typed text with no key at all is graded, not unverifiable',
     buildDesignReferenceDebug({ ticketKey: 'ENOC-97' }, { summaryOfChanges: 'Typed by hand.',
       summarySource: 'manual' }, false).summaryOfChanges.grading, 'graded');
  eq('no active ticket is graded, not unverifiable',
     buildDesignReferenceDebug(null, { summaryOfChanges: 'Standalone run.',
       summarySource: 'ticket' }, false).summaryOfChanges.grading, 'graded');
  eq('an empty box is its own cause, told apart from a withheld one',
     buildDesignReferenceDebug({ ticketKey: 'ENOC-97' }, { summaryOfChanges: '   ' }, false)
       .summaryOfChanges.grading, 'none');
  // vdCollectProblems re-derives staleness from the serialised blob. If the
  // builder compared keys itself the two could drift, and the log would carry
  // "grading was WITHHELD" beside grading:'graded'.
  var src = slicePopup('function buildDesignReferenceDebug(ctx, state, hasFigmaPat) {', '\nfunction ');
  ok('the builder uses the shared predicate, not its own comparison',
     /vdSpecIsStale\(state, ctx\)/.test(src));
  ok('  and does not re-implement the key comparison inline',
     !/summaryTicketKey[^\n]*!==[^\n]*ticketKey/.test(src));
})();

// ── the Detailed Description column ───────────────────────────────────────
section('the detail column stops setting every row height');

(function quotedTextIsCappedAt80() {
  // It was 45% of ALL the deterministic facts in the report — 4,377 chars across
  // 55 of 67 findings — and duplicated the crop, the note AND the Short
  // Description. On the FAQ rows it transcribed the same paragraph a fourth time.
  var long = 'Business line of credit. A small business line of credit can offer ongoing '
    + 'access to funds. If you are approved, you will be able to draw funds up to a certain '
    + 'credit limit. You will only pay interest on what you borrow.';
  ok('the fixture is long enough to exercise the cap', long.length > 200);

  // One-sided: an added element has no control text.
  var a = element('added', 'section', long);
  a.controlBlock = null;
  a.variantBlock = { label: 'p', text: long, rect: { x: 828, y: 4930, w: 860, h: 104 } };
  a.shortDescription = 'FAQ A4 line-of-credit detail paragraph added';
  a.note = 'Matches the ticket line-of-credit explanation.';
  var q1 = /Variant text: “([^”]*)”/.exec(cellsOf(render([a]))[2]);
  ok('a one-sided quote renders', !!q1, cellsOf(render([a]))[2]);
  ok('  capped at 80 or fewer', q1 && q1[1].length <= 80, q1 && q1[1].length);
  ok('  with an ellipsis, so truncation is visible', q1 && /…$/.test(q1[1]), q1 && q1[1]);
  ok('  and it is the START of the text, not the middle',
     q1 && long.indexOf(q1[1].replace(/…$/, '')) === 0, q1 && q1[1]);

  // Two-sided: a modified element quotes both.
  var m = element('modified', 'section', long);
  m.controlBlock = { label: 'p', text: long, rect: { x: 1, y: 2, w: 3, h: 4 } };
  m.variantBlock = { label: 'p', text: long.replace('Business', 'Small-business'), rect: { x: 1, y: 2, w: 3, h: 4 } };
  var cell = cellsOf(render([m]))[2];
  var both = cell.match(/“([^”]*)”/g) || [];
  eq('two-sided quotes both sides', both.length, 2);
  both.forEach(function (t, i) {
    ok('  side ' + (i + 1) + ' capped at 80 or fewer', t.replace(/[“”]/g, '').length <= 80, t.length);
  });
  ok('  joined on ONE line with an arrow, not two <br> lines',
     /Control: “[^”]*” → Variant: “[^”]*”/.test(cell), cell);

  // Short text must pass through untouched — the cap is not a reformat.
  var sh = element('added', 'hero', 'Apply Now');
  sh.controlBlock = null;
  sh.variantBlock = { label: 'a', text: 'Apply Now', rect: { x: 1, y: 2, w: 3, h: 4 } };
  ok('short text is left alone', /Variant text: “Apply Now”/.test(cellsOf(render([sh]))[2]),
     cellsOf(render([sh]))[2]);
})();

(function shortFactsShareOneLine() {
  // Emitting each fact on its own <br> is what made the rows tall, not their
  // length — most are short enough to sit together. Inlining is the single
  // biggest reduction available: 565 stacked lines across the report to 466.
  var f = element('modified', 'lead form', 'Email Address');
  f.controlBlock = { label: 'input', text: 'Email Address', rect: { x: 1, y: 2, w: 3, h: 4 } };
  f.variantBlock = { label: 'input', text: 'Email Address', rect: { x: 1, y: 2, w: 3, h: 4 } };
  f.changeSignals = ['moved-vertically'];
  f.dy = 192; f.matchTier = 'path+text'; f.pixelRatio = 0.42;
  var cell = cellsOf(render([f]))[2];
  ok('Region, Moved, pixels, Signals and Paired by share a line',
     /Region: lead form · Moved 192px vertically · 42% of its pixels differ · Signals: moved-vertically · Paired by path\+text/
       .test(cell.replace(/<[^>]*>/g, '')), cell.replace(/<[^>]*>/g, '').slice(0, 400));

  // engineNote is a sentence carrying counts and samples — it keeps its own line.
  var r = rollup('section', 'expected');
  r.engineNote = 'section: 45 elements in Control, 106 in Variant, 1 matched.';
  var rc = cellsOf(render([r]))[2];
  ok('engineNote is not inlined with the labels',
     !/·\s*section: 45 elements/.test(rc.replace(/<[^>]*>/g, '')), rc);
  ok('  and still renders', /45 elements in Control/.test(rc), rc);

  // The member list is a sentence's worth too.
  var g = rollup('section', 'expected');
  g.memberCount = 6;
  g.groupMembers = ['other "Features"', 'paragraph "Credit limits from $6K - $200K"', 'image'];
  var gc = cellsOf(render([g]))[2].replace(/<[^>]*>/g, '');
  ok('the member list gets its own line, not the inline run',
     !/·\s*6 adjacent/.test(gc), gc.slice(0, 300));
})();

// ── the cover page ─────────────────────────────────────────────────────────
section('the cover page says what was tested');

(function bothCallSitesActuallyDeriveThem() {
  // openReportTab's call sites are not reachable from this suite, and a correct
  // helper that nobody calls is exactly the bug that shipped here twice
  // (shortDescription in 5d934d2, the dead unmetRequirements alias in c197e87).
  var calls = _pu.match(/openReportTab\(\{[\s\S]{0,200}?pageUrls:[^,\n]*/g) || [];
  // Three: the A/B run, the Test Agent run, and the Function Queue's Test Agent
  // report. The point of the count is that EVERY site derives its page URLs, which
  // the loop below asserts.
  eq('all three call sites are present', calls.length, 3);
  calls.forEach(function (c, i) {
    ok('call site ' + (i + 1) + ' derives pageUrls', /abPageUrls\(/.test(c), c);
  });
  // Comments stripped: the helper's own doc comment quotes the old
  // `pageUrls: []` to explain what it replaced, and that must not read as code.
  var code = _pu.split('\n').filter(function (l) { return l.trim().indexOf('//') !== 0; }).join('\n');
  ok('no hardcoded empty pageUrls remain in code',
     !/pageUrls: \[\]/.test(code), 'still hardcoded');
})();

(function pageUrlsComeFromTheCaptures() {
  // pageUrls was hardcoded [] at BOTH openReportTab call sites, so the cover has
  // read "No page URLs recorded." in every report ever produced — directly above
  // a Page Basics table listing the real URL for every variant.
  var forced = 'http://ondeck.com/soc/b?optimizely_x=5542293380268032'
    + '&optimizely_token=c0a6a2659a2b5dac3f5653d94a31519cde057fe4deb5b5b4682bd0166a130c58'
    + '&optimizely_preview_layer_ids=6291814800424960&cro_mode=qa';
  var clean = 'https://www.ondeck.com/soc/b?cro_mode=qa';
  var modes = [{ mode: 2, data: { captures: [
    { label: 'v0', url: forced, finalUrl: clean },
    { label: 'v1', url: forced.replace('5542293380268032', '4749145360039936'), finalUrl: clean },
  ] } }];
  var got = abPageUrls(modes);
  eq('both variants resolved to one page, so one entry', got.length, 1);
  // Without its query: the cover lists pages, not links (see the Starz case below).
  eq('  and it is the post-redirect page, without its query', got[0], 'https://www.ondeck.com/soc/b');

  // The one that matters: cap.url is the forced-variation PREVIEW url and
  // carries the token. Publishing it on a client-facing cover page leaks it.
  ok('NO forced-variation preview token reaches the cover',
     got.every(function (u) { return u.indexOf('optimizely_token') === -1; }), got);
  ok('  nor any optimizely_ parameter at all',
     got.every(function (u) { return u.indexOf('optimizely_') === -1; }), got);

  // Genuinely different pages both get listed, in capture order.
  var two = abPageUrls([{ mode: 2, data: { captures: [
    { label: 'v0', finalUrl: 'https://a.example/x' },
    { label: 'v1', finalUrl: 'https://b.example/y' },
    { label: 'v2', finalUrl: 'https://a.example/x' },
  ] } }]);
  eq('distinct pages are both listed', two.length, 2);
  eq('  in capture order', two.join(','), 'https://a.example/x,https://b.example/y');

  // Skipped captures never loaded anything, and blanks must not become entries.
  eq('a skipped capture contributes nothing',
     abPageUrls([{ data: { captures: [{ skipped: true, finalUrl: clean }] } }]).length, 0);
  eq('a blank finalUrl contributes nothing',
     abPageUrls([{ data: { captures: [{ finalUrl: '' }, { finalUrl: '   ' }, {}] } }]).length, 0);

  // Reads whichever modes carry captures rather than assuming mode 2.
  var multi = abPageUrls([
    { mode: 1, data: { somethingElse: true } },
    { mode: 7, data: { captures: [{ finalUrl: 'https://c.example/z' }] } },
    { mode: 3, status: 'skipped' },
  ]);
  eq('captures are found on any mode that has them', multi.join(','), 'https://c.example/z');
  eq('no modes at all', abPageUrls([]).length, 0);
  eq('undefined', abPageUrls(undefined).length, 0);

  // finalUrl is only clean where the site redirects the forcing parameters
  // away. Starz does not: these are the four finalUrls of r_1791216757295
  // (STRZ-1658, 2026-10-05), and every STRZ-1658 cover printed them as four
  // links, each registering a real tracked exposure for anyone who pastes it.
  var starz = ['6219568484450304', '4911923798474752', '4780302780858368', '4816449225621504']
    .map(function (x, i) {
      return { label: 'v' + i, url: 'https://www.starz.com/us/en/buy?optimizely_x=' + x,
               finalUrl: 'https://www.starz.com/us/en/buy?optimizely_x=' + x + '&optimizely_force_tracking=true&cro_mode=qa' };
    });
  var cover = abPageUrls([{ mode: 2, data: { captures: starz } }]);
  eq('a site that keeps the forcing parameters still gets ONE cover line', JSON.stringify(cover),
     JSON.stringify(['https://www.starz.com/us/en/buy']));
  ok('  with no optimizely_ parameter in it', !/optimizely_/.test(cover.join(' ')), cover);

  // One rule for every source the cover reads, the funnel's waypoints included.
  eq('a funnel waypoint loses its query too',
     abPageUrls([{ mode: 'funnel', data: { segments: [
       { from: 'https://shop.example/lp?optimizely_x=1&optimizely_force_tracking=true', to: 'https://shop.example/cart#top' }] } }]).join(','),
     'https://shop.example/lp,https://shop.example/cart');
})();

// ── the two badges must agree ──────────────────────────────────────────────
section('one verdict shared by both sections');

// The OnDeck shape exactly: nothing wrong in page basics / selectors / metrics
// / console, and a visual diff full of findings with real issues in it.
function vdOf(over) {
  return Object.assign({
    baselineLabel: 'v0', sharedFindings: [],
    perVariant: [Object.assign({
      label: 'v1', structuralStats: {}, noSpecText: false,
      findings: [], requirements: null,
      // The completion token vdVariantChecked reads. A helper that stands for
      // "a comparison happened" has to carry the evidence that one did, or
      // every test built on it asserts against a shape production never makes.
      // Its ABSENCE is covered on purpose in passRequiresPositiveEvidence.
      diffMode: 'normal', matchedFraction: 0.99,
    }, (over || {}).variant || {})],
  }, (over || {}).vd || {});
}

(function theTwoHalvesAreCountedSeparately() {
  var quiet = vdOf({ variant: { findings: [{ classification: 'expected' }] } });
  eq('a run with only expected findings has nothing to review', vdVerdict(quiet).needsReview, 0);
  eq('  and no copy misses', vdVerdict(quiet).unmetCopy, 0);
  eq('  so the badge predicate is clean', vdVerdict(quiet).issues, 0);
  eq('  but it still reports its findings', vdVerdict(quiet).findings, 1);
  eq('  and ran', vdVerdict(quiet).ran, true);

  // Run 1788374677434 exactly: 0 unexpected, 6 unclear, 1 absent + 3
  // non-fragment near. The old rule reported the model as finding NOTHING.
  var real = vdOf({ variant: {
    findings: Array.apply(null, Array(6)).map(function () { return { classification: 'unclear' }; })
      .concat(Array.apply(null, Array(61)).map(function () { return { classification: 'expected' }; })),
    requirements: { absent: 1, items: [
      { status: 'near', fragment: false }, { status: 'near', fragment: false },
      { status: 'near', fragment: false },
      { status: 'near', fragment: true },      // wording unchanged — NOT a defect
      { status: 'verbatim' }] },
  } });
  var r = vdVerdict(real);
  eq('67 findings', r.findings, 67);
  eq('4 copy misses — 1 absent + 3 non-fragment near', r.unmetCopy, 4);
  eq('6 findings needing review, all of them unclear', r.needsReview, 6);
  ok('  the badge still trips', r.issues > 0);

  // The halves overlap in reality (2 of 4 on that run were the same defects as
  // 2 of the 6), so `issues` is a PREDICATE and must never be shown as a total.
  var ab = _pu.slice(_pu.indexOf('function rptAbSection(entry) {'),
                     _pu.indexOf('function rptAbVisualDiffSection(vd) {'));
  ok('the A/B summary does not render the summed issues count',
     !/vv\.issues[^?]*\}/.test((/const summary = [\s\S]*?;\n/.exec(ab) || [''])[0]),
     (/const summary = [\s\S]*?;\n/.exec(ab) || [''])[0]);

  // Mixed grades still add up across both kinds.
  var mixed = vdOf({ variant: { findings: [
    { classification: 'unexpected' }, { classification: 'unclear' }, { classification: 'expected' }] } });
  eq('unexpected and unclear both count as needing review', vdVerdict(mixed).needsReview, 2);

  // Not run / skipped / empty must be distinguishable from "ran and was clean".
  eq('no visual diff at all did not run', vdVerdict(undefined).ran, false);
  // A pipeline that bailed DID run — it just could not compare. Sharing the
  // `none` shape with "Visual Diff was off" is what let allowNotRan badge PASS
  // over "Control failed to load or capture".
  eq('a skipped one with a reason RAN and is not compared',
     vdVerdict({ skipped: true, reason: 'Control failed to capture', perVariant: [] }).ran, true);
  eq('  and reports notCompared',
     vdVerdict({ skipped: true, reason: 'x', perVariant: [] }).notCompared, 1);
  eq('a bare skipped flag counts the same way',
     vdVerdict({ skipped: true, perVariant: [] }).ran, true);
  eq('  and reports nothing', vdVerdict({ skipped: true }).issues, 0);
  eq('  on both halves', vdVerdict({ skipped: true }).needsReview + vdVerdict({ skipped: true }).unmetCopy, 0);
  eq('an empty perVariant did not run', vdVerdict({ perVariant: [] }).ran, false);
})();

(function anUnclearFindingCountsTheSameWhereverItSits() {
  // THE BUG. vdVerdict counted `unclear` unconditionally for SHARED findings but
  // only when noSpecText for PER-VARIANT ones, so one grade got two answers
  // depending purely on whether the shared-findings lifter had moved it out of
  // its variant. Before the fix these two gave 0 and 1.
  var inVariant = vdOf({ variant: { findings: [{ classification: 'unclear' }] } });
  var inShared  = vdOf({ vd: { sharedFindings: [{ classification: 'unclear' }] } });
  eq('unclear in a variant needs review', vdVerdict(inVariant).needsReview, 1);
  eq('unclear in the shared bucket needs review', vdVerdict(inShared).needsReview, 1);
  eq('  identically — that is the whole point',
     vdVerdict(inVariant).needsReview, vdVerdict(inShared).needsReview);

  // And it counts whether or not there was a spec. It used to depend on that.
  var withSpec = vdOf({ variant: { noSpecText: false, findings: [{ classification: 'unclear' }] } });
  var noSpec   = vdOf({ variant: { noSpecText: true,  findings: [{ classification: 'unclear' }] } });
  eq('with a spec', vdVerdict(withSpec).needsReview, 1);
  eq('without a spec', vdVerdict(noSpec).needsReview, 1);
  ok('the noSpecText branch is gone from the counter',
     !/noSpecText/.test(_pu.slice(_pu.indexOf('function vdVariantNeedsReview'),
                                  _pu.indexOf('function vdVariantIssueCount'))),
     'still conditional on noSpecText');
})();

(function theSummaryNamesBothHalvesAndOmitsEmptyOnes() {
  eq('both halves present',
     vdVerdictSummary({ ran: true, findings: 67, unmetCopy: 4, needsReview: 6 }),
     '67 visual differences · 4 specified copy strings not on the page · 6 findings needing review');
  eq('copy misses only',
     vdVerdictSummary({ ran: true, findings: 67, unmetCopy: 4, needsReview: 0 }),
     '67 visual differences · 4 specified copy strings not on the page');
  eq('review items only',
     vdVerdictSummary({ ran: true, findings: 67, unmetCopy: 0, needsReview: 6 }),
     '67 visual differences · 6 findings needing review');
  eq('a fully clean run says neither, rather than "0 · 0"',
     vdVerdictSummary({ ran: true, findings: 12, unmetCopy: 0, needsReview: 0 }),
     '12 visual differences');
  eq('singulars agree',
     vdVerdictSummary({ ran: true, findings: 1, unmetCopy: 1, needsReview: 1 }),
     '1 visual difference · 1 specified copy string not on the page · 1 finding needing review');
  eq('a run that did not happen says nothing at all',
     vdVerdictSummary({ ran: false, findings: 0, unmetCopy: 0, needsReview: 0 }), '');
})();

(function bothSectionsActuallyReadThatOneVerdict() {
  // This is the bug, and it lives in rptAbSection, which is not sliceable here
  // without dragging in diffAbCaptures and mtMatch. Pin it in the source.
  var ab = _pu.slice(_pu.indexOf('function rptAbSection(entry) {'),
                     _pu.indexOf('function rptAbVisualDiffSection(vd) {'));
  ok('the A/B section computes the visual verdict', /vdVerdict\(/.test(ab), ab.slice(0, 200));
  // The badge is one shared function now, so the assertion is that this section
  // DELEGATES rather than that its inline ternary is spelled correctly. Every
  // previous version of this test regexed the ternary and so pinned the spelling
  // while the f529775 clause inversion sailed through.
  ok('  and its badge delegates to the one shared ladder',
     /vdBadgeLabel\(vv,/.test(ab), ab.slice(0, 300));
  ok('  passing its own capture errors and totalDeltas in',
     /errCount, extraIssues: totalDeltas/.test(ab), ab.slice(0, 300));
  var summary = /const summary = [\s\S]*?;\n/.exec(ab);
  ok('  and the summary names its own scope rather than saying "vs baseline"',
     !!summary && /page basics/.test(summary[0]) && !/difference\(s\) vs baseline/.test(summary[0]),
     summary && summary[0]);
  ok('  and reports both halves through the shared helper',
     !!summary && /vdVerdictSummary\(vv\)/.test(summary[0]), summary && summary[0]);

  // Both summary lines must go through that ONE helper, or they drift apart
  // again — which is the failure c197e87 exists to prevent.
  var vdsec = _pu.slice(_pu.indexOf('function rptAbVisualDiffSection(vd) {'),
                        _pu.indexOf('function rptWcagSection('));
  ok('the Visual Diff summary uses the same helper',
     /vdVerdictSummary\(vv\)/.test(vdsec), 'not shared');
  eq('and nothing else builds one of its own',
     (_pu.match(/vdVerdictSummary\(/g) || []).length, 3);   // definition + 2 call sites

  // Neither section may compute its own tally any more.
  var vdsec = _pu.slice(_pu.indexOf('function rptAbVisualDiffSection(vd) {'),
                        _pu.indexOf('function rptWcagSection('));
  ok('the Visual Diff section reads the same verdict', /vdVerdict\(vd\)/.test(vdsec));
  ok('  and defines no local issue tally of its own',
     !/const\s+(totalIssues|variantIssueCount|unmetRequirements)\s*=/.test(vdsec), 'stale local tally');
})();

(function consoleLinesDoNotMoveTheAbBadge() {
  // Every recorded capture's console was empty until the browserLog fix in
  // background.js, so totalDeltas had never seen a console line. Once it did, a
  // variant logging its own variation turned PASS into ISSUES FOUND, with no
  // console line anywhere in the report to say why. This runs the REAL
  // rptAbSection, diffAbCaptures and metric matcher, not a copy of the count.
  // jsc has no URL, so diffAbCaptures' stripUrl would fall back to the whole URL
  // and count the forced-variation query as a page-basics difference that
  // Chrome strips. This local stand-in gives origin + pathname, as Chrome does.
  var URL = function (u) {
    var m = /^(https?:\/\/[^\/?#]+)([^?#]*)/.exec(String(u));
    if (!m) throw new TypeError('Invalid URL: ' + u);
    this.origin = m[1]; this.pathname = m[2] || '/';
  };
  load('../metric-match.js');
  eval(slicePopup('function diffAbCaptures(captures, metricsList, selectors) {',
                  '\n// ── Visual Diff (A/B Variant Comparison, opt-in)'));
  eval(slicePopup('function rptAbSection(entry) {', '\n// Static-report counterpart driven by'));
  // Same page, same title; only the forced-variation query differs, as in a real run.
  var cap = function (label, query, lines) {
    return { label: label, url: 'https://example.com/lp' + query, finalUrl: 'https://example.com/lp' + query,
             title: 'Landing page', loadError: null, errors: [], selectors: [],
             console: lines.map(function (t) { return { level: 'BROWSER', text: t }; }) };
  };
  var captures = [
    cap('v0', '?variation=0', ['[PJS] exp 123: control bucketed', '[CRO] metric: hero_cta_view']),
    cap('v1', '?variation=2', ['[PJS] exp 123: variation 2 applied', '[CRO] metric: hero_cta_view',
                               '[CRO] metric: hero_cta_click']),
  ];
  var run = function (metricsList) {
    var html = rptAbSection({ status: 'ran', name: 'A/B Variant Comparison',
      data: { captures: captures, metricsList: metricsList, selectors: [] } });
    return { html: html,
             badge: (/rpt-badge rpt-badge-[a-z]+">([^<]*)</.exec(html) || [])[1],
             summary: (/<div class="rpt-summary">([^<]*)</.exec(html) || [])[1] || '' };
  };

  var quiet = run(['hero_cta_view']);
  eq('console lines that differ do not move the A/B badge', quiet.badge, 'PASS');
  eq('  and are not counted as a difference', quiet.summary,
     'Baseline: v0 · 0 difference(s) in page basics, watched selectors and metrics');
  ok('  while the metric those lines carry IS counted from them',
     quiet.html.indexOf('<td>hero_cta_view</td><td>v0 ×1 · v1 ×1</td>') !== -1, quiet.html.slice(0, 600));

  var fired = run(['hero_cta_view', 'hero_cta_click']);
  eq('a metric firing in one variant only still raises ISSUES FOUND', fired.badge, 'ISSUES FOUND');
  eq('  as one difference', fired.summary,
     'Baseline: v0 · 1 difference(s) in page basics, watched selectors and metrics');
})();

(function aFragmentNearMatchMustNotBadge() {
  // The wording is unchanged, only how much of it one element carries.
  eq('a fragment near-match is not a defect',
     vdUnmetRequirements({ requirements: { absent: 0, items: [{ status: 'near', fragment: true }] } }), 0);
  eq('a real near-match is', 
     vdUnmetRequirements({ requirements: { absent: 0, items: [{ status: 'near', fragment: false }] } }), 1);
  eq('no requirements at all is not a defect', vdUnmetRequirements({}), 0);
})();

(function sharedAndDuplicateVariantsCountToo() {
  // Shared findings were lifted out of every variant, so a run whose only
  // findings are common to all variants must not tally zero and badge PASS.
  var sh = vdOf({ vd: { sharedFindings: [{ classification: 'unexpected' }, { classification: 'expected' }] } });
  eq('a shared unexpected finding needs review', vdVerdict(sh).needsReview, 1);
  eq('  and shared findings are counted in the total', vdVerdict(sh).findings, 2);

  // A Control-vs-Control variant produces no findings, so without this a run
  // where the experiment never applied badges a green PASS.
  var dup = vdOf({ variant: { controlDuplicate: true } });
  eq('a variant that resolved to Control is flagged as not compared',
     vdVerdict(dup).notCompared, 1);
  eq('  and contributes no issues, which is exactly the trap', vdVerdict(dup).issues, 0);
})();

(function anErroredVariantContributesNothing() {
  eq('skipped', vdVariantIssueCount({ skipped: true, findings: [{ classification: 'unexpected' }] }), 0);
  eq('errored', vdVariantIssueCount({ error: 'x', findings: [{ classification: 'unexpected' }] }), 0);
  eq('skipped, needs-review half', vdVariantNeedsReview({ skipped: true, findings: [{ classification: 'unclear' }] }), 0);
  eq('errored, needs-review half', vdVariantNeedsReview({ error: 'x', findings: [{ classification: 'unclear' }] }), 0);
  // A skipped variant must not contribute copy misses either, or a variant that
  // never loaded would badge on requirements it was never measured against.
  eq('skipped contributes no copy misses',
     vdVerdict(vdOf({ variant: { skipped: true, requirements: { absent: 3, items: [] } } })).unmetCopy, 0);
})();

(function theUnitCountIsStillTheSumOfBothHalves() {
  // vdVariantIssueCount stays the per-variant unit: deterministic + model.
  var v = { noSpecText: false,
    findings: [{ classification: 'unexpected' }, { classification: 'unclear' }],
    requirements: { absent: 2, items: [{ status: 'near', fragment: true }] } };
  eq('2 copy misses + 2 review items', vdVariantIssueCount(v), 4);
  eq('  the model half alone', vdVariantNeedsReview(v), 2);
  eq('  the deterministic half alone', vdUnmetRequirements(v), 2);
})();

// ── three routes to a green PASS on a run nobody validly compared ─────────
section('a run that was not validly compared must never badge PASS');

(function aFailedModelCallCannotBadgePass() {
  // The degraded push hands over `cropped` — the PRE-grade list — so every
  // finding carries no classification. That variant is neither `skipped` nor
  // `error`, so vdVariantNeedsReview returned 0, and with no unmet copy strings
  // both badges read PASS directly above the loud "Not graded." banner and N
  // `unjudged` rows. 7e38210 restored the findings and the banner; the verdict
  // was never taught the state exists.
  var dead = vdOf({ variant: {
    gradingFailed: 'Failed to fetch',
    requirements: null,                       // no spec, so unmetCopy is 0 too
    findings: Array.apply(null, Array(67)).map(function () {
      return { classification: null, severity: null };
    }),
  } });
  var v = vdVerdict(dead);
  eq('all 67 findings count as ungraded', v.ungraded, 67);
  eq('  none of them count as needing review — they were never judged', v.needsReview, 0);
  eq('  and there is no copy evidence either', v.unmetCopy, 0);
  ok('  so the badge cannot fall through to PASS', v.ungraded > 0);

  // A failed call that produced NO findings is still ungraded — the variant was
  // never judged, and that must not read as "nothing to report".
  eq('a failed call with zero findings still counts as ungraded',
     vdVerdict(vdOf({ variant: { gradingFailed: 'Stopped', findings: [] } })).ungraded, 1);

  // Individually omitted findings count too — the model returned, but skipped
  // some entries, so those keep no classification while neighbours have one.
  var partial = vdOf({ variant: { findings: [
    { classification: 'expected' }, { classification: null }, { classification: 'unclear' }] } });
  eq('a finding the model omitted counts as ungraded', vdVerdict(partial).ungraded, 1);
  eq('  without disturbing the graded ones', vdVerdict(partial).needsReview, 1);

  // A fully graded run reports none, or every clean run would badge NOT GRADED.
  eq('a fully graded run has nothing ungraded',
     vdVerdict(vdOf({ variant: { findings: [{ classification: 'expected' }] } })).ungraded, 0);
})();

(function anAllControlRunCannotBadgePass() {
  // The pipeline's all-duplicate exit returns skipped:true WITH a fully
  // populated perVariant of controlDuplicate entries, so bailing on `skipped`
  // returned before notCompared could be computed. And totalDeltas is 0 by
  // construction on that path — every target resolved to the same page, so same
  // title, same URL, no selector/metric/console delta — which landed the ladder
  // on a green PASS. The existing test used a NON-skipped vd, which is why this
  // shape was never caught.
  var allControl = { skipped: true, baselineLabel: 'v0', sharedFindings: [], perVariant: [
    { label: 'v1', controlDuplicate: true, findings: [], structuralStats: {} },
    { label: 'v2', controlDuplicate: true, findings: [], structuralStats: {} },
  ], reason: 'Every target resolved to the same page as Control' };
  var v = vdVerdict(allControl);
  eq('both duplicates are reported as not compared', v.notCompared, 2);
  eq('  and the verdict is NOT treated as "did not run"', v.ran, true);

  // "Nothing to account for" means Visual Diff was never requested — NOT that it
  // was requested and stopped. Only an absent vd is the former.
  eq('no visual diff object at all did not run', vdVerdict(undefined).ran, false);
  eq('an empty perVariant with no skip/reason did not run',
     vdVerdict({ perVariant: [] }).ran, false);
  eq('a skipped run with an empty perVariant DID run and is not compared',
     vdVerdict({ skipped: true, perVariant: [] }).notCompared, 1);
  eq('a skipped run with no duplicates did not run',
     vdVerdict({ skipped: true, perVariant: [{ label: 'v1', skipped: true }] }).ran, false);
})();

(function oneExportProjectionForEveryFinding() {
  // The debug log had TWO finding projections: the per-variant list carried
  // twenty fields, the shared list seven. Run 1788538681655 is where that bit
  // -- both variants hold zero findings of their own, all 8 are shared, so the
  // log carried no findingId, no matchTier, no geometry, no crop booleans, no
  // engineNote, no shortDescription and no note for ANY of its findings.
  //
  // Structural, not behavioural, on purpose: the defect is that a field list
  // exists twice, so what needs pinning is that it exists once. This is the
  // fifth misread caused by an export projection dropping a field, and every
  // one of the previous four was fixed by adding the field to one copy.
  var fn = slicePopup('function vdExportFinding(f) {', '\nfunction buildDebugLog(sections) {');
  ok('vdExportFinding exists as one named projection', fn.length > 200, fn.slice(0, 80));

  // Every field the report and the diagnosis need, named here so dropping one
  // fails loudly rather than showing up as an unanswerable log six runs later.
  // `identity` is the cross-run key. findingId is `'f' + i`, a positional index
  // that goes into the model prompt and comes back from it, so it cannot say
  // WHICH finding it is — two logs could not be compared finding by finding at
  // all, which is what blocks grade-churn detection and telling a capture
  // artifact from a real style regression.
  ['findingId', 'identity', 'changeClass', 'status', 'region', 'matchTier', 'dx', 'dy',
   'memberCount', 'signals', 'pixelRatio', 'classification', 'severity',
   'controlText', 'variantText', 'controlRect', 'variantRect',
   'hasControlCrop', 'hasVariantCrop', 'engineNote', 'shortDescription', 'note'
  ].forEach(function (k) {
    ok('  projects ' + k, new RegExp('(^|[^A-Za-z])' + k + ':').test(fn));
  });

  var log = _pu.slice(_pu.indexOf('function buildDebugLog(sections) {'));
  var pv = /findings: \(v\.findings \|\| \[\]\)\.map\(vdExportFinding\)/.test(log);
  var sh = /sharedFindings: \(vd\.sharedFindings \|\| \[\]\)\.map\(f => Object\.assign\(\s*vdExportFinding\(f\)/.test(log);
  ok('the per-variant list uses it', pv);
  ok('the shared list uses it too', sh);
  ok('neither builds its own field list',
     !/sharedFindings: \(vd\.sharedFindings \|\| \[\]\)\.map\(f => \(\{/.test(log),
     'the shared projection has an inline object literal again');
  // sharedAcross is the ONLY field that differs, and it belongs to the caller.
  ok('sharedAcross is added by the caller, not by the shared projection',
     /sharedAcross: f\.sharedAcross \|\| \[\]/.test(log) && !/sharedAcross/.test(fn));
})();

(function theSplitBuildSignalReachesTheLog() {
  // requirementsUnsupported is computed at popup.js:4040 and read by BOTH the
  // renderer and vdCollectProblems, but went unrecorded: a popup newer than its
  // service worker sent a spec, got no requirements key back, and the log
  // looked the same as a run whose spec simply produced fewer requirements.
  // That is one of exactly three reasons a requirement count can move, and it
  // was the only one invisible in the log — the other two are a changed spec
  // (summaryOfChanges.hash) and a changed extractor.
  var log = _pu.slice(_pu.indexOf('function buildDebugLog(sections) {'));
  ok('the per-variant projection records requirementsUnsupported',
     /requirementsUnsupported: v\.requirementsUnsupported \?\? null/.test(log));
  ok('  and records it beside requirements, where the count it explains lives',
     log.indexOf('requirementsUnsupported:') < log.indexOf('requirements: v.requirements'));
})();

(function whichVerificationStatesVoidThePair() {
  // The stamping rule itself, which had no test at all: it lived inline in the
  // async runVisualDiffPipeline, so mutating it to count every non-'confirmed'
  // state -- or to ignore the baseline entirely -- left both suites green on all
  // 20 recorded runs. Both recorded not-served runs have the variant AND the
  // baseline contradicted, so real data cannot separate the two terms.
  eval(_pu.slice(_pu.indexOf('function vdServedNoVariation(variantVer, baselineVer) {'),
                 _pu.indexOf('// The variation the CONFIGURED url asked for.')));
  var S = function (st) { return { state: st }; };
  eq('variant contradicted voids the pair',
     vdServedNoVariation(S('contradicted'), S('confirmed')), true);
  eq('BASELINE contradicted voids it too — a Control that served no Control is no baseline',
     vdServedNoVariation(S('confirmed'), S('contradicted')), true);
  eq('both contradicted', vdServedNoVariation(S('contradicted'), S('contradicted')), true);
  eq('both confirmed is fine', vdServedNoVariation(S('confirmed'), S('confirmed')), false);
  // Absent evidence is not evidence of absence. 96 of 126 recorded captures
  // predate the field; counting these would declare most of the corpus void.
  eq("'unchecked' is not a contradiction", vdServedNoVariation(S('unchecked'), S('unchecked')), false);
  eq("'unverifiable' is not a contradiction",
     vdServedNoVariation(S('unverifiable'), S('unverifiable')), false);
  eq("'unsupported' is not a contradiction",
     vdServedNoVariation(S('unsupported'), S('unsupported')), false);
  eq('a missing verification is not a contradiction', vdServedNoVariation(null, null), false);
  eq('  nor is a missing baseline alone', vdServedNoVariation(S('confirmed'), null), false);
  eq('  and a missing variant with a contradicted baseline still voids it',
     vdServedNoVariation(null, S('contradicted')), true);

  // ── the sibling predicate, on the other axis ─────────────────────────────
  // vdServedNoVariation is "the platform answered NO". This is "the platform
  // did not answer". The pair has to stay disjoint: every state belongs to at
  // most one of them, or one run reports both "served no variation" and "could
  // not be confirmed", which are different claims about the same capture.
  eq('an unchecked variant voids identification',
     vdVerificationUnchecked(S('unchecked'), S('confirmed')), true);
  eq('an unchecked BASELINE does too — same reason a contradicted one does',
     vdVerificationUnchecked(S('confirmed'), S('unchecked')), true);
  eq('both confirmed is fine', vdVerificationUnchecked(S('confirmed'), S('confirmed')), false);
  // The benign half of the old `unknown`. A Control URL forces nothing, so
  // there is nothing to confirm — gating on this would void a normal run, which
  // is precisely why the single `unknown` could never be gated at all.
  eq("'unverifiable' is NOT a gap",
     vdVerificationUnchecked(S('unverifiable'), S('unverifiable')), false);
  // Left out on purpose: it means the worker is a build behind and already
  // carries its own remediation, and 96 of 126 recorded captures predate the
  // probe — counting it would declare most of the corpus unverified.
  eq("'unsupported' is NOT a gap either",
     vdVerificationUnchecked(S('unsupported'), S('unsupported')), false);
  eq('a contradicted capture belongs to the OTHER predicate, not this one',
     vdVerificationUnchecked(S('contradicted'), S('contradicted')), false);
  eq('a missing verification is not a gap', vdVerificationUnchecked(null, null), false);
  ['confirmed', 'contradicted', 'unchecked', 'unverifiable', 'unsupported'].forEach(function (st) {
    ok('  the two predicates never both fire on ' + st,
       !(vdServedNoVariation(S(st), S(st)) && vdVerificationUnchecked(S(st), S(st))));
  });
})();

(function theMirrorCarriesNotServed() {
  // The Test-Agent-queued path reads only _abLastRun.visualDiff. Without
  // notServed on that projection the new rung is vacuously false there — which
  // is exactly how sharedFindingCount went wrong, so it is pinned structurally.
  var mirror = _pu.slice(_pu.indexOf('perVariant: (visualDiffResult.perVariant || []).map(v => ({'));
  mirror = mirror.slice(0, mirror.indexOf('})),'));
  ok('the mirror carries notServed', /notServed: v\.notServed/.test(mirror), mirror.slice(0, 400));
  ok('  and notVerified, for the same reason', /notVerified: v\.notVerified/.test(mirror), mirror.slice(0, 400));
  ok('  and the verification it derives from', /variantVerified: v\.variantVerified/.test(mirror));

  // And the pipeline must actually CALL the predicate. Structural because
  // runVisualDiffPipeline is async and cannot be sliced and driven: replacing
  // the assignment with `false` left every behavioural assertion green, since
  // the fixture derives notServed itself and the synthetic cases set it directly.
  var pipe = _pu.slice(_pu.indexOf('async function runVisualDiffPipeline'));
  ok('the pipeline stamps notServed from the predicate',
     /v\.notServed = vdServedNoVariation\(own, baselineVer\);/.test(pipe),
     'the pipeline no longer derives notServed from vdServedNoVariation');
  ok('  from the baseline capture, not a hardcoded state',
     /const baselineVer = vdCaptureVerification\(base\);/.test(pipe));
  ok('the pipeline stamps notVerified from ITS predicate',
     /v\.notVerified = vdVerificationUnchecked\(own, baselineVer\);/.test(pipe),
     'the pipeline no longer derives notVerified from vdVerificationUnchecked');
})();

(function servedNoVariationIsNotAVerdict() {
  // Run 1788900763308: every capture `contradicted`, so nothing bucketed and
  // all three URLs served the same page -- yet the report badged ISSUES FOUND
  // with 7 findings graded `unexpected`, all of them a randomized product
  // carousel. The verdict could not see the verification because it lives on
  // the capture and vdVerdict only ever receives visualDiff.
  if (typeof vdVerdict !== 'function') return;
  function verdictOf(over) {
    return vdVerdict(vdOf({ variant: Object.assign(
      { findings: [{ classification: 'expected' }], requirements: null }, over) }));
  }
  var ns = verdictOf({ notServed: true });
  eq('a variant that served no variation is counted', ns.notServed, 1);
  eq('  is not clean', ns.allClean, false);
  eq('  badges NOT COMPARED', vdBadgeLabel(ns, {}), 'NOT COMPARED');
  ok('  and the summary leads with it, before any count',
     /^1 variant\(s\) served no variation at all/.test(vdVerdictSummary(ns)), vdVerdictSummary(ns));

  // NOT COMPARED outranks ISSUES FOUND. This is the whole point: the counts can
  // be arithmetically right and the sentence still false, so the reader must be
  // told the comparison did not happen before being told how many differences
  // it found.
  var withIssues = vdVerdict(vdOf({ variant: {
    findings: [{ classification: 'unexpected' }, { classification: 'unclear' }],
    requirements: null, notServed: true } }));
  ok('  it outranks the issues rung', withIssues.needsReview > 0, withIssues);
  eq('  so a not-served run with real issues still reads NOT COMPARED',
     vdBadgeLabel(withIssues, {}), 'NOT COMPARED');

  // A clean run is untouched.
  var clean = verdictOf({});
  eq('a served variant is not counted', clean.notServed, 0);
  // Its findings are graded expected, so this reads NEEDS REVIEW now — the point
  // here is only that notServed did not fire, which the count above asserts.
  eq('  and is not marked not-compared', vdBadgeLabel(clean, {}), 'NEEDS REVIEW');
  eq('  with no not-served clause in the summary',
     /served no variation/.test(vdVerdictSummary(clean)), false);

  // Absent evidence is not evidence of absence. 96 captures on record predate
  // the verification field and 4 recorded 'unknown'; if either set notServed,
  // most of the corpus would be declared uncompared.
  eq('an undefined notServed is not counted', verdictOf({ notServed: undefined }).notServed, 0);
  eq('  nor is false', verdictOf({ notServed: false }).notServed, 0);
  // A skipped variant is already covered by notRun and must not be double-counted.
  eq('a skipped variant is not counted as not-served',
     vdVerdict(vdOf({ variant: { skipped: true, notServed: true, requirements: null } })).notServed, 0);
})();

(function sharedFindingsCountTowardClean() {
  // Run 1788538681655 (TB-1078) is the reason this exists: BOTH variants carry
  // zero findings of their own and all 8 findings live in the shared pool, 2
  // classified unclear. needsReview, ungraded and findings all counted the
  // shared pool; allClean did not, so it reported true over a run with two
  // unreviewed changes.
  //
  // Not the first multi-variant run on record -- four earlier 3-variant runs
  // carry shared pools too -- but the only one where the variants are
  // individually clean, which is what makes the shared terms load-bearing
  // rather than redundant. In the other four every per-variant finding is
  // unclear, so vdVariantClean is already false.
  //
  // SYNTHETIC shapes below, and one caveat about them: vdOf builds a
  // one-element perVariant, and a shared pool cannot actually arise on one
  // variant (vdExtractSharedFindings needs >= 2 analysed variants). These cases
  // exercise vdVerdict's arithmetic, not a producible run; the real 2-variant
  // shape is asserted from the corpus in real-runs.test.js.
  if (typeof vdVerdict !== 'function') return;
  function withShared(shared, variantOver) {
    var vd = vdOf({ variant: Object.assign(
      { findings: [{ classification: 'expected' }], requirements: null }, variantOver || {}) });
    vd.sharedFindings = shared;
    return vdVerdict(vd);
  }
  eq('no shared findings leaves a clean variant clean', withShared([]).allClean, true);
  eq('shared findings that are all graded expected stay clean',
     withShared([{ classification: 'expected' }, { classification: 'expected' }]).allClean, true);
  eq('an unclear shared finding is not clean',
     withShared([{ classification: 'expected' }, { classification: 'unclear' }]).allClean, false);
  eq('an unexpected shared finding is not clean',
     withShared([{ classification: 'unexpected' }]).allClean, false);
  eq('an UNGRADED shared finding is not clean',
     withShared([{ classification: null }]).allClean, false);

  // The recorded run's GRADE VECTOR (6 expected + 2 unclear), on a synthetic
  // one-variant vd -- see the caveat above. What is being pinned is that the two
  // counts cannot disagree, not that this object is a producible run.
  var real = withShared([
    { classification: 'expected' }, { classification: 'expected' },
    { classification: 'expected' }, { classification: 'expected' },
    { classification: 'expected' }, { classification: 'expected' },
    { classification: 'unclear' },  { classification: 'unclear' }
  ], { findings: [] });
  eq('the recorded run counts 2 findings needing review', real.needsReview, 2);
  eq('  and is therefore NOT clean', real.allClean, false);
  ok('  so allClean and needsReview cannot disagree',
     !(real.allClean && real.needsReview > 0), real);
  // PASS must not survive this even if the ladder is ever reordered -- which is
  // the whole risk: today `issues` is checked first and hides the disagreement.
  eq('  and the badge is not PASS', vdBadgeLabel(real, {}) === 'PASS', false);
})();

(function passRequiresPositiveEvidence() {
  // THE INVERSION. vdVariantClean was a chain of NEGATIVE tests, so every result
  // shape the main loop did not build was clean by default. Measured before this
  // change: vdVariantClean({}) === true and vdVariantClean({label:'v1'}) === true.
  //
  // These cases matter more than usual because vdOf now supplies the completion
  // token by default — correct for a helper standing in for a completed
  // comparison, but it means the token's ABSENCE is covered here and nowhere
  // else. If this block goes, the inversion is untested.
  if (typeof vdVariantChecked !== 'function') { ok('vdVariantChecked is exported', false); return; }

  eq('an empty object is not a checked comparison', vdVariantChecked({}), false);
  eq('  nor is a bare label', vdVariantChecked({ label: 'v1' }), false);
  eq('  nor is null', vdVariantChecked(null), false);
  // The real resume shape, field for field (popup.js ~3984). It carries findings
  // but none of the deterministic outputs — and no `requirements`, so the one
  // byte-reproducible half of the verdict silently read zero on a resumed run.
  var resumed = { label: 'v1', resumed: true, fullPageTruncated: false,
                  findings: [{ classification: 'expected' }], overallSummary: '', pixelDiff: null };
  eq('the resume shape is not a checked comparison', vdVariantChecked(resumed), false);
  eq('  so it is not clean either', vdVariantClean(resumed), false);
  eq('  even though every finding it carries is graded expected',
     resumed.findings.every(function (f) { return f.classification === 'expected'; }), true);

  // The guard has to reject the unrecognised without rejecting the real thing.
  eq('a full completed variant is checked',
     vdVariantChecked({ label: 'v1', diffMode: 'normal', matchedFraction: 0.99, findings: [] }), true);
  eq('  including redesign mode',
     vdVariantChecked({ label: 'v1', diffMode: 'redesign', matchedFraction: 0.24, findings: [] }), true);
  eq('  and the Test-Agent mirror, which carries both fields deliberately',
     vdVariantChecked({ label: 'v1', diffMode: 'normal', matchedFraction: 0.99, findingCount: 9 }), true);
  eq('matchedFraction 0 is a real answer, not a missing one',
     vdVariantChecked({ label: 'v1', diffMode: 'redesign', matchedFraction: 0 }), true);
  // BOTH fields, not either. A projection that copies one and forgets the other
  // must not pass — that is the exact class of bug this codebase has shipped six
  // times (sharedFindingCount, shortDescription, engineNote, note, viewportH,
  // and the mirror's notServed). Dropping the matchedFraction half of the
  // conjunction was invisible until these two cases existed.
  eq('diffMode without matchedFraction is not enough',
     vdVariantChecked({ label: 'v1', diffMode: 'normal' }), false);
  eq('  nor matchedFraction without diffMode',
     vdVariantChecked({ label: 'v1', matchedFraction: 0.99 }), false);

  eq('an unrecognised variant is NOT clean', vdVariantClean({}), false);
  eq('  nor a bare label', vdVariantClean({ label: 'v1' }), false);

  // End to end: the shapes that used to reach a green PASS.
  function verdictFor(pv) {
    return vdVerdict({ baselineLabel: 'v0', sharedFindings: [], perVariant: pv });
  }
  var bare = verdictFor([{ label: 'v1' }]);
  eq('a bare variant is not clean', bare.allClean, false);
  ok('  and cannot badge PASS', vdBadgeLabel(bare, {}) !== 'PASS', vdBadgeLabel(bare, {}));
  var res = verdictFor([resumed]);
  eq('a resumed variant is not clean', res.allClean, false);
  ok('  and cannot badge PASS', vdBadgeLabel(res, {}) !== 'PASS', vdBadgeLabel(res, {}));

  // bail(): `{ skipped: true, reason }` with NO perVariant. It shared the `none`
  // shape with "Visual Diff was off", so rptAbSection's allowNotRan clause
  // returned PASS over "Control failed to load or capture".
  var bailed = vdVerdict({ skipped: true, reason: 'Control failed to load or capture — nothing to compare against.' });
  eq('a bailed pipeline reports that it ran', bailed.ran, true);
  eq('  and that nothing was compared', bailed.notCompared, 1);
  eq('  so the Visual Diff section badges NOT COMPARED', vdBadgeLabel(bailed, {}), 'NOT COMPARED');
  eq('  and the A/B section cannot fall through to PASS',
     vdBadgeLabel(bailed, { allowNotRan: true }), 'NOT COMPARED');
  // The one shape that legitimately "did not run": no visual diff object at all.
  eq('Visual Diff switched off still resolves to PASS for the A/B section',
     vdBadgeLabel(vdVerdict(undefined), { allowNotRan: true }), 'PASS');
  eq('  and is still distinguishable from a bail', vdVerdict(undefined).ran, false);
})();

(function everyReasonAVariantIsNotCleanIsChecked() {
  // vdVariantClean is what makes PASS earned instead of fallen-into, so each of
  // its reasons needs its own case. SYNTHETIC on purpose: I regressed each line
  // and found that removing the gradingFailed check broke NOTHING, in either
  // suite — because in all 12 recorded runs a gradingFailed variant also carries
  // unclassified findings, so an earlier check catches it. A failed call that
  // produced zero findings is reachable and is not in the fixture, so the real
  // data cannot cover this one.
  function clean(over) {
    return vdVerdict(vdOf({ variant: Object.assign(
      { findings: [{ classification: 'expected' }], requirements: null }, over) })).allClean;
  }
  eq('a fully graded, clean variant IS clean', clean({}), true);
  eq('an errored variant is not', clean({ error: 'Failed to fetch' }), false);
  eq('a skipped variant is not', clean({ skipped: true }), false);
  eq('a control duplicate is not', clean({ controlDuplicate: true }), false);
  // The one nothing was guarding.
  eq('a variant whose grading died is not clean, even with no findings',
     clean({ gradingFailed: 'Failed to fetch', findings: [] }), false);
  eq('  nor with findings that somehow all carry grades',
     clean({ gradingFailed: 'Failed to fetch', findings: [{ classification: 'expected' }] }), false);
  eq('an unjudged finding makes it not clean',
     clean({ findings: [{ classification: 'expected' }, { classification: null }] }), false);
  eq('an unclear finding makes it not clean',
     clean({ findings: [{ classification: 'unclear' }] }), false);
  eq('an unexpected finding makes it not clean',
     clean({ findings: [{ classification: 'unexpected' }] }), false);
  eq('an unmet copy string makes it not clean',
     clean({ requirements: { absent: 1, items: [] } }), false);
  eq('  but a fragment near-match does not', clean({
     requirements: { absent: 0, items: [{ status: 'near', fragment: true }] } }), true);

  // A variant with NO variants at all is not a pass either.
  eq('an empty perVariant is not clean',
     vdVerdict({ baselineLabel: 'v0', perVariant: [], sharedFindings: [] }).allClean, false);

  // The did-not-run return and the success return must carry the SAME fields.
  // They did not: allClean was undefined on one branch and a boolean on the
  // other, which reads as falsy in one caller and as "not stated" in another.
  var ran = vdVerdict(vdOf({ variant: { findings: [{ classification: 'expected' }] } }));
  var notRan = vdVerdict({ baselineLabel: 'v0', perVariant: [], sharedFindings: [] });
  Object.keys(ran).sort().forEach(function (k) {
    ok('the did-not-run verdict also defines ' + k, k in notRan, Object.keys(notRan).sort().join(','));
    eq('  and ' + k + ' has the same type', typeof notRan[k], typeof ran[k]);
  });

  // The mirror branch has its own reasons.
  function mirrorClean(over) {
    return vdVerdict({ baselineLabel: 'v0', sharedFindings: [], perVariant: [Object.assign(
      { label: 'v1', findingCount: 9, unexpectedCount: 0, unclearCount: 0,
        noVerdictCount: 0, unmetCopyCount: 0,
        // The real Test-Agent mirror carries these two deliberately (popup.js
        // ~3313), so the mirror branch passes vdVariantChecked exactly as the
        // full shape does. Without them here the test would assert against a
        // mirror production does not build.
        diffMode: 'normal', matchedFraction: 0.99 }, over)] }).allClean;
  }
  eq('a clean mirror is clean', mirrorClean({}), true);
  eq('  an unexpected count is not', mirrorClean({ unexpectedCount: 1 }), false);
  eq('  an unclear count is not', mirrorClean({ unclearCount: 1 }), false);
  eq('  a no-verdict count is not', mirrorClean({ noVerdictCount: 1 }), false);
  eq('  an unmet copy count is not', mirrorClean({ unmetCopyCount: 1 }), false);
  eq('  and a dead call on that path is not', mirrorClean({ gradingFailed: 'x' }), false);
})();

(function oneBadgeLadderThatBothSectionsCall() {
  // There is no inline ternary to regex any more. vdBadgeLabel IS the ladder,
  // so test it directly — and assert both sections call it rather than keeping
  // a copy. A copy is how the f529775 inversion passed: the test and the
  // scratch harness each hardcoded the intended order.
  var ab = _pu.slice(_pu.indexOf('function rptAbSection(entry) {'),
                     _pu.indexOf('function rptAbVisualDiffSection(vd) {'));
  var vdsec = _pu.slice(_pu.indexOf('function rptAbVisualDiffSection(vd) {'),
                        _pu.indexOf('function rptWcagSection('));
  ok('the A/B section calls vdBadgeLabel', /vdBadgeLabel\(vv,/.test(ab));
  ok('the Visual Diff section calls vdBadgeLabel', /vdBadgeLabel\(vv,/.test(vdsec));
  ok('neither hardcodes a PASS rung of its own',
     !/rptBadge\('pass', 'PASS'\)/.test(ab + vdsec), 'inline ladder remains');

  var base = { ran: true, failed: 0, notRun: 0, notCompared: 0, issues: 0, ungraded: 0, allClean: true };
  function at(over) { return vdBadgeLabel(Object.assign({}, base, over), {}); }

  // Precedence, top to bottom.
  eq('an errored variant outranks everything', at({ failed: 1, notCompared: 1, issues: 9, ungraded: 9 }), 'FAILED');
  eq('a control duplicate outranks issues', at({ notCompared: 1, issues: 9, ungraded: 9 }), 'NOT COMPARED');

  // ── NOT VERIFIED, pinned on BOTH sides ───────────────────────────────────
  // The rung added 2026-09-15 for the `unchecked` half of the old `unknown`.
  // Its position is the whole design: one step too high and a deterministic
  // copy miss — wrong on any page, identified or not — gets hidden behind
  // "we could not tell what we compared"; one step too low and a page nobody
  // could identify reports its differences as if they were about the
  // experiment. Both neighbours are asserted so a future reorder cannot move it
  // silently, which is exactly how f529775 and f35bd5d each shipped.
  eq('NOT VERIFIED outranks a page-basics delta',
     vdBadgeLabel(Object.assign({}, base, { notVerified: 1, allClean: false }), { extraIssues: 3 }),
     'NOT VERIFIED');
  eq('  and outranks a grading gap and findings',
     at({ notVerified: 1, ungraded: 9, findings: 67, allClean: false }), 'NOT VERIFIED');
  eq('  but a deterministic copy miss still outranks IT',
     at({ notVerified: 1, unmetCopy: 4, comparedUnmetCopy: 4, allClean: false }), 'ISSUES FOUND');
  eq('  and so does a positively void comparison — the platform ANSWERED there',
     at({ notVerified: 1, notServed: 1, allClean: false }), 'NOT COMPARED');
  eq('  and a control duplicate',
     at({ notVerified: 1, notCompared: 1, allClean: false }), 'NOT COMPARED');
  // The benign half must never reach the rung: `unverifiable` sets no counter,
  // so a Control that forces nothing leaves the badge exactly where it was.
  eq('an unverifiable capture does not badge NOT VERIFIED',
     at({ findings: 0, allClean: true }), 'PASS');
  eq('NOT VERIFIED is amber, not red', vdBadgeKind('NOT VERIFIED'), 'issues');
  // THE REGRESSION: real issues must outrank a partial grading gap. Stated on
  // `unmetCopy`, which is what the deterministic rung reads — `issues` mixes in
  // the model's needsReview and the badge deliberately no longer touches it.
  // f35bd5d's lesson is unchanged: one omitted finding out of 67 must not
  // relabel a variant NOT GRADED and bury 4 real copy misses.
  // comparedUnmetCopy alongside unmetCopy: on a run with no void variant
  // vdVerdict emits them equal, and the badge reads the compared one so that
  // one variant's void comparison cannot hide another's confirmed miss.
  eq('real issues outrank a grading gap',
     at({ unmetCopy: 4, comparedUnmetCopy: 4, ungraded: 1, findings: 67, allClean: false }),
     'ISSUES FOUND');
  eq('  and `issues` alone no longer badges anything — it is not read',
     at({ issues: 9, findings: 0, allClean: false }), 'INCONCLUSIVE');

  // ── the property the whole change exists for ──────────────────────────────
  // With differences present, the badge must be independent of every grade on
  // them. Measured on real data before this change: 13 runs of one ondeck
  // comparison, deterministic half hash-identical, badge PASS x3 /
  // ISSUES FOUND x10 — two of the intervals 57s and 11min apart.
  var vectors = [0, 1, 2, 6, 7, 67];
  var badges = {};
  vectors.forEach(function (nr) {
    // needsReview is unexpected+unclear; allClean goes false the moment any
    // finding is not 'expected', so both move together with the grade vector.
    badges[nr] = at({ findings: 7, needsReview: nr, issues: nr, allClean: nr === 0 });
  });
  eq('the badge does not move with the grade vector',
     Object.keys(badges).map(function (k) { return badges[k]; }).join(','),
     'NEEDS REVIEW,NEEDS REVIEW,NEEDS REVIEW,NEEDS REVIEW,NEEDS REVIEW,NEEDS REVIEW');

  // ...while a DETERMINISTIC fact still moves it, or the badge would say nothing.
  eq('a reproducible copy miss does move it',
     at({ findings: 7, needsReview: 0, unmetCopy: 1, comparedUnmetCopy: 1, allClean: false }),
     'ISSUES FOUND');
  eq('an unjudged finding does move it',
     at({ findings: 7, needsReview: 0, ungraded: 1, allClean: false }), 'NOT GRADED');

  // PASS now means "nothing differed", not "the model blessed everything".
  eq('findings with perfect grades are NOT a pass', at({ findings: 1, allClean: true }), 'NEEDS REVIEW');
  eq('  only zero differences is', at({ findings: 0, allClean: true }), 'PASS');
  eq('a grading gap alone is NOT GRADED', at({ ungraded: 67, allClean: false }), 'NOT GRADED');
  eq('a stopped variant is INCOMPLETE', at({ notRun: 1, allClean: false }), 'INCOMPLETE');
  eq('a positively clean run is PASS', at({}), 'PASS');
  // The class-level guard: anything unaccounted for cannot reach PASS.
  eq('an unrecognised state is INCONCLUSIVE', at({ allClean: false }), 'INCONCLUSIVE');
  eq('  even with every known counter at zero',
     vdBadgeLabel({ ran: true, allClean: false }, {}), 'INCONCLUSIVE');

  // rptAbSection's extras.
  eq('capture errors outrank all of it', vdBadgeLabel(base, { errCount: 1 }), 'FAIL');
  eq('its own totalDeltas raise ISSUES FOUND',
     vdBadgeLabel(Object.assign({}, base, { allClean: false }), { extraIssues: 3 }), 'ISSUES FOUND');
  eq('and a run with no visual diff at all still resolves for it',
     vdBadgeLabel({ ran: false, allClean: false }, { allowNotRan: true }), 'PASS');

  // Badge colour tracks the label, so a new rung cannot render green by default.
  eq('PASS is the only green', vdBadgeKind('PASS'), 'pass');
  ['FAIL', 'FAILED', 'NOT COMPARED'].forEach(function (l) {
    eq('  ' + l + ' is a failure', vdBadgeKind(l), 'fail');
  });
  ['ISSUES FOUND', 'NOT GRADED', 'INCOMPLETE', 'INCONCLUSIVE'].forEach(function (l) {
    eq('  ' + l + ' is an issue', vdBadgeKind(l), 'issues');
  });
})();

(function theQueuedPathStillGetsItsVisualDiff() {
  // visualDiffFull exists only on the standalone path; the Test-Agent path gets
  // the metadata mirror on _abLastRun. Reading only the former dropped the whole
  // visual result on the queued path — where abState.visualDiff is FORCED on, so
  // the pipeline runs, one Opus call per variant — and printed PASS over it.
  var ab = _pu.slice(_pu.indexOf('function rptAbSection(entry) {'),
                     _pu.indexOf('function rptAbVisualDiffSection(vd) {'));
  ok('the section falls back to the mirror', /visualDiffFull \|\| entry\.data\.visualDiff/.test(ab), ab.slice(0, 300));
  eq('  and resolves it ONCE, so the verdict and the section cannot diverge',
     (ab.match(/visualDiffFull \|\| entry\.data\.visualDiff/g) || []).length, 1);
  ok('  the verdict reads that resolved value', /vdVerdict\(vdData\)/.test(ab), ab);
  ok('  and so does the section', /rptAbVisualDiffSection\(vdData\)/.test(ab), ab);
  // Same fallback vdCollectProblems has always used — they must not differ.
  ok('vdCollectProblems uses the same fallback',
     /visualDiffFull \|\| entry\.data\.visualDiff/.test(_pu.slice(_pu.indexOf('function vdCollectProblems'))));
})();

(function theTruncationLineDoesNotUnderstateCoverage() {
  // It used to read "content below the cutoff was not evaluated". False: the DOM
  // walk treats the capture height as a FLAG bound, not a rejection bound, so
  // text, colour, layout and element presence ARE compared down there. Only the
  // pixel comparison and the crops stop. The debug log always said this
  // correctly; the client-facing line did not, and would send a reviewer to
  // re-check content the tool already checked.
  var h = render([rollup('section', 'expected')], { variant: { fullPageTruncated: true } });
  ok('the line renders', /8000px/.test(h), 'no truncation line');
  ok('  and does NOT claim the content went uncompared', !/was not evaluated/.test(h),
     (/.{0,120}was not evaluated.{0,40}/.exec(h) || [''])[0]);
  ok('  it says what WAS still compared', /Text, layout and element presence were still compared/.test(h), h.slice(0, 200));
  ok('  and names what actually stops', /pixel comparison and the crop images/.test(h));
})();

(function theWithheldPixelFigureSaysSo() {
  var scale = { control: 1, variant: 2, controlImage: { w: 2936 }, variantImage: { w: 5872 },
                pageW: { control: 2936, variant: 2936 } };
  var withheld = render([rollup('section', 'expected')],
    { variant: { pixelDiff: null, diffDebug: { imageScale: scale } } });
  ok('the withheld figure is announced where the figure would have been',
     /Whole-page pixel comparison withheld/.test(withheld), 'silent');
  ok('  naming both scales', /Control 1×, Variant 2×/.test(withheld), withheld.slice(0, 300));
  ok('  and saying the rest is unaffected',
     /findings, the matching and the copy checks/.test(withheld));

  // Matched scales: the real figure renders and the withheld note does not.
  var ok2 = render([rollup('section', 'expected')], { variant: {
    pixelDiff: { flagged: true, ratio: 0.67 },
    diffDebug: { imageScale: { control: 1, variant: 1, controlImage: { w: 2936 },
                               variantImage: { w: 2936 }, pageW: { control: 2936, variant: 2936 } } } } });
  ok('a real figure still renders', /67% of pixels differ/.test(ok2));
  ok('  and the withheld note does not — the branches are exclusive',
     !/withheld/.test(ok2), ok2.slice(0, 200));

  // Neither appears when there is nothing to say.
  var quiet = render([rollup('section', 'expected')], { variant: { pixelDiff: null } });
  ok('no diffDebug at all: no note, and no throw',
     !/withheld/.test(quiet) && !/of pixels differ/.test(quiet));
})();

(function realIssuesOutrankAPartialGradingGap() {
  // NB this is a LOCAL copy of the intended order, so these assertions check the
  // COUNTS vdVerdict produces and what the intended ladder does with them — not
  // the ladder in popup.js. The real order is guarded by the source assertions in
  // bothBadgeLaddersRefusePassInThoseStates above, which is what caught the
  // f529775 inversion. Both halves are needed: counts here, order there.
  function ladder(v) {
    return v.notCompared ? 'NOT COMPARED' : v.issues ? 'ISSUES FOUND'
         : v.ungraded ? 'NOT GRADED' : 'PASS';
  }
  var REQS = { absent: 1, items: [
    { status: 'near', fragment: false }, { status: 'near', fragment: false },
    { status: 'near', fragment: false }, { status: 'near', fragment: true }] };
  function grade(n, cls) {
    return Array.apply(null, Array(n)).map(function () { return { classification: cls }; });
  }

  // THE REGRESSION: one finding the model omitted, alongside 4 unmet copy
  // strings and 5 review items. f529775 badged this NOT GRADED and buried all
  // nine actionable items. Run 1788372126965 had exactly this shape.
  var partial = vdOf({ variant: {
    findings: grade(1, null).concat(grade(5, 'unclear'), grade(61, 'expected')),
    requirements: REQS } });
  var pv = vdVerdict(partial);
  eq('one omitted finding is still reported as ungraded', pv.ungraded, 1);
  eq('  and the real issues are still counted', pv.unmetCopy, 4);
  eq('  as are the review items', pv.needsReview, 5);
  eq('  but the badge names the ISSUES, not the gap', ladder(pv), 'ISSUES FOUND');

  // A dead call WITH copy evidence: the copy defects are deterministic and do
  // not depend on the model, so they are the headline.
  var deadWithCopy = vdOf({ variant: {
    gradingFailed: 'Failed to fetch', findings: grade(67, null), requirements: REQS } });
  eq('a dead call alongside copy misses badges ISSUES FOUND',
     ladder(vdVerdict(deadWithCopy)), 'ISSUES FOUND');
  eq('  and still reports all 67 as ungraded', vdVerdict(deadWithCopy).ungraded, 67);

  // The case the ungraded rung exists for — nothing else to say. Must NOT be PASS.
  var deadNoSpec = vdOf({ variant: { gradingFailed: 'Failed to fetch', findings: grade(67, null) } });
  eq('a dead call with nothing else to report badges NOT GRADED',
     ladder(vdVerdict(deadNoSpec)), 'NOT GRADED');

  eq('a clean run still passes', ladder(vdVerdict(vdOf({ variant: { findings: grade(9, 'expected') } }))), 'PASS');
  eq('an all-Control run still outranks everything',
     ladder(vdVerdict({ skipped: true, baselineLabel: 'v0', sharedFindings: [],
       perVariant: [{ label: 'v1', controlDuplicate: true, findings: [], structuralStats: {} }] })),
     'NOT COMPARED');
})();

(function theTestAgentMirrorMustNotReadAsACleanRun() {
  // f529775 added the `visualDiffFull || visualDiff` fallback so the queued path
  // would stop dropping its visual diff — but handed the METADATA MIRROR to a
  // renderer that had only ever seen the full pipeline result. The mirror has no
  // `findings` array, only counts, so the verdict read every count as 0: PASS,
  // "0 visual differences", and the body printed "No differences detected." over
  // a run that found 67. A silent omission became a false claim.
  var mirror = { baselineLabel: 'v0', perVariant: [{
    label: 'v1', findingCount: 67, unexpectedCount: 0, unclearCount: 5,
    noVerdictCount: 0, unmetCopyCount: 4, requirementTotal: 70,
    structuralStats: { addedCount: 106, removedCount: 51 }, diffMode: 'redesign',
  }] };
  ok('the mirror shape is recognised', vdIsMirrorVariant(mirror.perVariant[0]));
  ok('  a full result is NOT', !vdIsMirrorVariant({ findings: [], findingCount: 0 }));
  var v = vdVerdict(mirror);
  eq('the finding count comes from findingCount', v.findings, 67);
  eq('  review items from the count fields', v.needsReview, 5);
  eq('  copy misses from the precomputed scalar', v.unmetCopy, 4);
  ok('  so it cannot badge PASS', v.issues > 0);
  eq('  and the renderer is told the detail is elsewhere', v.detailUnavailable, true);

  // A dead call on the queued path: gradingFailed now rides the mirror, so this
  // cannot read as clean either.
  var deadMirror = { baselineLabel: 'v0', perVariant: [{
    label: 'v1', findingCount: 67, unexpectedCount: 0, unclearCount: 0,
    noVerdictCount: 0, unmetCopyCount: 0, gradingFailed: 'Failed to fetch' }] };
  eq('a dead call on the queued path reports its findings as ungraded',
     vdVerdict(deadMirror).ungraded, 67);
  ok('  and does not badge PASS', vdVerdict(deadMirror).ungraded > 0);

  // And the mirror must carry the fields the verdict now depends on. Bounded by
  // the literal's own end marker, NOT by a byte count: a fixed window silently
  // stops covering the tail of the object as soon as a field or a comment is
  // added above it, which is a test that decays into passing by accident.
  var mirrorStart = _pu.indexOf('perVariant: (visualDiffResult.perVariant || []).map');
  var proj = _pu.slice(mirrorStart, _pu.indexOf('findingCount: v.findings'));
  var mirror = _pu.slice(mirrorStart, _pu.indexOf('if (fromTestAgent) {', mirrorStart));
  ok('the mirror literal end marker was found', mirror.length > 0 && mirror.length < 6000, mirror.length);
  ok('the mirror carries gradingFailed', /gradingFailed: v\.gradingFailed/.test(mirror), 'missing');
  ok('  and a precomputed unmetCopyCount', /unmetCopyCount: vdUnmetRequirements\(v\)/.test(mirror), 'missing');
  // The walk's own not-walked counters ride the mirror too, for exactly the
  // reason diffDebug does: a Test-Agent-queued run never sees visualDiffFull,
  // so leaving them off made the iframe/shadow/fixed-sticky disclosures dead
  // on that path while droppedByCap kept working.
  ok('  and the notWalked counters', /notWalked: v\.notWalked/.test(mirror), 'missing');
})();

// ── the Metrics section ────────────────────────────────────────────────────
section('Metrics section only earns a place when a metric fired');

(function metricsTableSuppressedWhenNothingFired() {
  // No typeof guard here: slicePopup already throws by design, naming the
  // missing marker, so this function is defined or the suite never starts.
  // The exact shape from an OnDeck run: ten metrics inherited from persisted
  // GLOBAL config, unrelated to the page under test, not one of them fired.
  var stale = ['OAM | WOW! Offer Card Clicks', 'OAM | Get YouTube TV CTA clicks',
               'Meta LP | Scroll Depth | 25%', 'Meta LP | Scroll Depth | 50%']
    .map(function (n) { return { metric: n, counts: [0, 0], allSame: true }; });
  eq('ten zeros earn no rows', abFiredMetricRows(stale).length, 0);

  // One that fired anywhere keeps its row — whether a conversion event fires on
  // both variants is exactly what the report should say.
  var mixed = stale.concat([{ metric: 'Lead form submit', counts: [3, 0], allSame: false }]);
  var kept = abFiredMetricRows(mixed);
  eq('a metric that fired keeps its row', kept.length, 1);
  eq('  and it is the right one', kept[0].metric, 'Lead form submit');

  // Fired in the BASELINE only is the interesting case, not a reason to hide it.
  eq('fired only in v0 still counts',
     abFiredMetricRows([{ metric: 'x', counts: [2, 0] }]).length, 1);
  eq('fired only in the variant still counts',
     abFiredMetricRows([{ metric: 'x', counts: [0, 2] }]).length, 1);
  eq('fired equally in both still counts',
     abFiredMetricRows([{ metric: 'x', counts: [4, 4] }]).length, 1);

  // Defensive: the caller passes d.metricRows, which is [] when no metrics are
  // configured at all, and a malformed row must not throw the whole report.
  eq('no metrics configured', abFiredMetricRows([]).length, 0);
  eq('undefined', abFiredMetricRows(undefined).length, 0);
  eq('a row with no counts', abFiredMetricRows([{ metric: 'x' }]).length, 0);
})();

// ── two sections that were making affirmatively false statements ──────────
section('Performance must not report budgets met on a page it never measured');

(function aPageThatMeasuredNothingIsNotAPass() {
  // perfSummarize nulls every median and every verdict when no run succeeded,
  // and `skipped` stays false because p.runs is full of error objects — so the
  // page survived the filter and `verdicts[k] === 'over' ? 'OVER' : 'OK'`
  // rendered null as "OK" under a summary reading "all budgets met".
  function perf(pages) {
    return rptPerfSection({ name: 'Performance', status: 'ran',
      data: { budgets: { lcpMs: 2500, clsScore: 0.1 }, pages: pages } });
  }
  var deadPage = { url: 'https://example.com/x', skipped: false,
    runs: [{ error: 'timeout' }, { error: 'timeout' }],
    summary: { runCount: 0, runErrors: ['Load event never fired (45s)'],
               medians: { lcpMs: null, clsScore: null },
               verdicts: { lcpMs: null, clsScore: null } } };
  var h = perf([deadPage]);
  ok('it does not claim all budgets met', !/all budgets met/.test(h), h.slice(0, 400));
  ok('  and does not badge PASS', !/>PASS</.test(h), h.slice(0, 300));
  ok('  it says no successful run', /No successful run/.test(h), h.slice(0, 600));
  ok('  and surfaces the reason', /Load event never fired/.test(h));
  ok('  and prints no OK for an unmeasured metric', !/— OK/.test(h), h);
  ok('  and reports 0 pages measured', /0 page\(s\) measured/.test(h), h.slice(0, 300));

  // A page that DID measure is unchanged — this must not scare a healthy run.
  var live = { url: 'https://example.com/y', skipped: false, runs: [{}],
    summary: { runCount: 3, runErrors: [], medians: { lcpMs: 1800, clsScore: 0.04 },
               verdicts: { lcpMs: 'ok', clsScore: 'ok' } } };
  var g = perf([live]);
  ok('a measured, in-budget page still passes', />PASS</.test(g), g.slice(0, 300));
  ok('  and reports its budgets met', /all budgets met/.test(g), g.slice(0, 300));
  ok('  with OK cells', /— OK/.test(g));
  var over = { url: 'https://example.com/z', skipped: false, runs: [{}],
    summary: { runCount: 3, runErrors: [], medians: { lcpMs: 4200, clsScore: 0.04 },
               verdicts: { lcpMs: 'over', clsScore: 'ok' } } };
  ok('an over-budget page still FAILs', />FAIL</.test(perf([over])));
  ok('  and says so', /1 metric\(s\) over budget/.test(perf([over])));

  // Mixed: one measured and clean, one dead. Must not read as a clean run.
  var mixed = perf([live, deadPage]);
  ok('a mixed run does not badge PASS', !/>PASS</.test(mixed), mixed.slice(0, 300));
  ok('  and counts the unmeasured page separately',
     /1 page\(s\) measured/.test(mixed) && /1 page\(s\) produced no successful run/.test(mixed),
     mixed.slice(0, 400));
  // A null verdict on an otherwise-measured page is a dash, matching the live panel.
  var partial = { url: 'https://example.com/p', skipped: false, runs: [{}],
    summary: { runCount: 2, runErrors: [], medians: { lcpMs: 1800, clsScore: null },
               verdicts: { lcpMs: 'ok', clsScore: null } } };
  ok('a null verdict renders as a dash, not OK', /— —/.test(perf([partial])), perf([partial]));
})();

section('Cross-Variant Accessibility must not blame the variant for the whole site');

(function aFailedBaselineIsDisclosed() {
  // diffCvaRuns does `base.loadError ? null : issuesOf(base, k)`, so bset is
  // empty and `introduced` becomes the variant's ENTIRE issue list. The live
  // renderer discloses this; the report had no branch for it.
  // CVA issues are plain STRINGS — diffCvaRuns normalises with
  // `String(s).replace(/\s+/g,' ').trim()`. My first attempt used
  // {selector, html, summary} objects, and every one stringified to
  // "[object Object]", so all five collapsed to one value and the assertion
  // failed with introduced:0 / preexisting:1. Worth keeping the note: a fixture
  // of the wrong shape is exactly how a test comes to agree with a bug.
  function issues(n) {
    return Array.apply(null, Array(n)).map(function (_, i) {
      return 'contrast: #e' + i + ' has insufficient ratio';
    });
  }
  function cva(baseOver) {
    return rptCvaSection({ name: 'Cross-Variant Accessibility', status: 'ran', data: {
      autoChecks: ['contrast'],
      runs: [
        Object.assign({ label: 'v0', url: 'https://example.com', loadError: null,
                        results: { contrast: { issues: issues(3) } } }, baseOver || {}),
        { label: 'v1', url: 'https://example.com?v=1', loadError: null,
          results: { contrast: { issues: issues(5) } } },
      ] } });
  }
  var broken = cva({ loadError: 'Navigation timeout', results: null });
  ok('a failed baseline is stated in the summary',
     /failed to load/.test(broken), broken.slice(0, 500));
  ok('  naming the error', /Navigation timeout/.test(broken));
  ok('  and saying the issues are TOTALS, not regressions',
     /not regressions introduced by them/.test(broken), broken.slice(0, 600));
  ok('  it does not badge ISSUES FOUND as though they were introduced',
     !/>ISSUES FOUND</.test(broken), broken.slice(0, 300));
  ok('  it carries the empty-baseline sentence',
     /shown against an empty baseline/.test(broken), broken.slice(0, 800));
  ok('  and never labels those issues "Introduced" or marks them worse',
     /<th>Issues<\/th>/.test(broken) && !/<th>Introduced<\/th>/.test(broken) && !/worse<\/span>/.test(broken), broken);
  ok('  listing each of them in full', /contrast: #e4 has insufficient ratio/.test(broken), broken);

  // A healthy baseline must be completely unchanged.
  var fine = cva(null);
  ok('a healthy baseline still reports introduced issues',
     />ISSUES FOUND</.test(fine), fine.slice(0, 300));
  ok('  with the original summary wording',
     /introduced issue\(s\) across/.test(fine), fine.slice(0, 300));
  ok('  under an Introduced column', /<th>Introduced<\/th>/.test(fine));
  ok('  and no empty-baseline warning', !/empty baseline/.test(fine));
})();

section('the copy check must not call itself an exact string comparison');

(function theCopyCheckDescribesWhatItActuallyDoes() {
  // Executed against the real vdNormText: "$29/mo" and "€29/mo" both normalise
  // to "29 mo"; "Free shipping" is contained in "No free shipping on orders
  // under $50"; "$99" normalises to "99" and is found inside "1996". Calling
  // that "exact" is why a reviewer would not double-check a verbatim line.
  var f = rollup('section', 'expected');
  var h = render([f], { variant: { requirements: {
    total: 70, verbatim: 65, near: 4, absent: 1,
    items: [{ status: 'absent', text: 'Questions? (888) 269-4246' }] } } });
  ok('the coverage line renders', /found verbatim/.test(h), h.slice(0, 400));
  ok('  and does NOT say "exact"', !/exact/i.test(h),
     (/.{0,90}exact.{0,60}/i.exec(h) || [''])[0]);
  ok('  it says case and punctuation are ignored',
     /case and punctuation are ignored/.test(h), h.slice(0, 700));
  ok('  and that a string inside a longer one counts as found',
     /inside a longer one/.test(h), h.slice(0, 700));
  // The claim also appears in Run Diagnostics; both must agree.
  ok('the word "exact" appears nowhere in popup.js any more',
     _pu.indexOf('exact string comparison') === -1, 'still present');
  ok('  and the true half of the claim survives',
     /reads the same on every run/.test(_pu), 'lost the reproducibility claim');
})();

// ── Capture width on the report cover ────────────────────────────────────
// Two reports are only comparable if they were captured at the same width, and
// that number lived only in the debug log. This is the line that makes the
// question answerable from the report itself.
(function theCoverStatesTheCaptureWidth() {
  var cap = function (w, f) {
    var fp = {}; if (w != null) fp[f || 'viewportW'] = w;
    return { label: 'v', skipped: false, fullPage: fp };
  };
  var M = function (caps) { return [{ mode: 2, data: { captures: caps } }]; };

  eq('one width reads plainly', abCaptureWidths(M([cap(2936), cap(2936)])), '2936 px');
  ok('differing widths say so, and say what it costs',
     /^1693 \/ 2936 px — widths differ/.test(abCaptureWidths(M([cap(2936), cap(1693)]))),
     abCaptureWidths(M([cap(2936), cap(1693)])));
  // viewportW is the harness's own quantity; pageW is the page's, so a run that
  // only has pageW must not pass it off as the same measurement.
  eq('a pre-pin run falls back to pageW and says so',
     abCaptureWidths(M([cap(1693, 'pageW'), cap(1693, 'pageW')])),
     '1693 px (page width — this run predates viewport recording)');
  // Never mixed: one side's viewport against the other's content width is two
  // unrelated numbers, which is the exact bug that broke the geometry pin.
  eq('viewportW and pageW are never mixed',
     abCaptureWidths(M([cap(2936), cap(1693, 'pageW')])), '');
  eq('no geometry at all renders no line', abCaptureWidths(M([cap(null)])), '');
  eq('no captures at all renders no line', abCaptureWidths([]), '');
  eq('and an undefined mode list does not throw', abCaptureWidths(undefined), '');
  // Skipped and errored captures were never photographed, so their geometry is
  // not this run's geometry — counting them would invent a width difference.
  eq('a skipped capture does not contribute a width',
     abCaptureWidths(M([cap(2936), { skipped: true, fullPage: { viewportW: 800 } }])), '2936 px');
  eq('nor does an errored one',
     abCaptureWidths(M([cap(2936), { fullPage: { viewportW: 800, error: 'boom' } }])), '2936 px');

  // Structural: the cover must actually render it, and derive it rather than
  // take it from `sections` — the mistake that left pageUrls hardcoded to [] in
  // every report ever produced.
  var body = slicePopup('function buildReportBody(sections) {', '\n// ── Debug log');
  ok('the cover derives the width itself', /abCaptureWidths\(modes\)/.test(body), body.slice(0, 300));
  ok('  and renders it', /\$\{widthHtml\}/.test(body));
  ok('  labelled, so a bare number cannot be misread', /Captured at \$\{esc\(widths\)\}/.test(body));
})();

// ── Test Agent: a mode that fails is reported as failed ────────────────────
section('Test Agent: a failed mode is FAILED, never its previous run');
(function () {
  // Found from r_1790970413550, a WCAG-only Test Agent run whose debug log
  // carried nothing about WCAG. Driving the code behind it showed that a failed
  // audit leaves _wcagCurrentRun where it was, and runTestAgent recorded the
  // mode 'ran' with whatever that was: an hour-old audit of another page went
  // into the report as this run's result, and with nothing in memory the
  // report crashed after the status line had said it opened.
  //
  // The real runTestAgent, TA_MODES and runWcagAudit against a worker stub.
  // TA_MODES is a `const`, re-declared as a var so it survives the eval (the
  // trap noted at PERF_METRICS above). Everything the slices reach for that
  // this suite does not otherwise define goes on globalThis for this block only.
  var els = {};
  var el = function (id) {
    return els[id] || (els[id] = { textContent: '', disabled: false, style: {}, innerHTML: '', checked: false, value: '' });
  };
  var reply = null, opened = null, openThrows = null, perfRun = null, wcagMsg = null;
  var stubs = {
    document: { getElementById: el },
    chrome: { runtime: { sendMessage: function (msg) {
      if (msg.action === 'runWcagAudit') wcagMsg = msg;
      return Promise.resolve(msg.action === 'runWcagAudit' ? reply : { ok: false, error: 'stub' });
    } } },
    wcagCheckboxes: function () { return [{ checked: true, value: 'contrast' }]; },
    taAgenticTestingEnabled: function () { return false; },
    renderWcagRun: function () {},
    saveWcagHistory: function () { return Promise.resolve(); },
    renderWcagHistoryList: function () { return Promise.resolve(); },
    getActiveContext: function () { return Promise.resolve(null); },
    rptAiSummarySection: function () { return ''; },
    openReportTab: function (sections) {
      if (openThrows) return Promise.reject(new Error(openThrows));
      opened = sections;
      return Promise.resolve();
    },
    rptAbSection: function () { return ''; },
    rptFunnelSection: function () { return ''; },
    _wcagCurrentRun: null, _taActiveBody: '4', taQueuedExtra: new Set(), _taStopRequested: false,
    // The panel's browser window id, which runWcagAudit sends so the worker
    // audits that window's tab and not the floating window's own.
    WIN_ID: 7,
  };
  Object.keys(stubs).forEach(function (k) { globalThis[k] = stubs[k]; });
  eval(slicePopup('async function runWcagAudit(opts = {}) {', '\nfunction renderWcagRun('));
  eval(slicePopup('const TA_MODES = {', '\nlet _taActiveBody').replace(/^const TA_MODES/, 'var TA_MODES'));
  eval(slicePopup('async function runTestAgent() {', '\nfunction stopTestAgent('));
  eval(slicePopup('function rptAgenticNoteHtml(note, label) {', '\n// ── the run'));
  eval(slicePopup('function rptWcagSection(entry) {', '\nfunction rptCvaSection('));
  eval(slicePopup('function buildReportBody(sections) {', '\n// ── Debug log'));

  var status = function () { return el('ta-status').textContent; };
  var run = function () {
    var out = { done: false, threw: null };
    runTestAgent().then(function () { out.done = true; }, function (e) { out.threw = e; out.done = true; });
    drainMicrotasks();
    return out;
  };
  var okResults = { contrast: { label: 'Colour contrast', issues: [] } };

  // 1. Nothing in memory, the audit fails.
  reply = { ok: false, error: 'No active tab' };
  var r = run();
  ok('the run settles without throwing', r.done && !r.threw, r.threw && String(r.threw));
  eq('nothing ran, so no report was opened', opened, null);
  eq('  and the status line names the failure instead of "report opened"', status(),
     'WCAG / Accessibility failed: No active tab');
  eq('  and the audit was asked for the panel\'s own browser window', wcagMsg && wcagMsg.winId, 7);

  // 2. An hour-old audit of another page in memory, the audit fails again.
  // Batched with a mode that does run, so a report opens and its modes are
  // visible.
  var hourAgo = Date.now() - 3600e3;
  _wcagCurrentRun = { url: 'https://old.example/', ts: hourAgo, checks: ['contrast'], scope: '',
                      results: { contrast: { label: 'Colour contrast', issues: ['an hour-old issue'] } } };
  TA_MODES['6'] = { label: 'Performance / Load', isConfigured: function () { return true; },
                    run: function () { perfRun = { ts: Date.now(), budgets: {}, pages: [] }; return Promise.resolve(); },
                    getData: function () { return perfRun; } };
  taQueuedExtra.add('6');
  r = run();
  var w = opened && opened.modes[0];
  ok('the batch settles', r.done && !r.threw, r.threw && String(r.threw));
  eq('the failed audit is recorded as failed', w && w.status, 'failed');
  eq('  with the worker\'s reason', w && w.reason, 'No active tab');
  ok('  and without the hour-old run', w && w.data === undefined, w && w.data);
  eq('the mode that did run is still reported', opened && opened.modes[1].status, 'ran');
  eq('the old page is not on the cover', opened && JSON.stringify(opened.pageUrls), '[]');
  var body = opened ? buildReportBody(opened) : '';
  ok('the report shows the audit as FAILED', /FAILED/.test(body) && /No active tab/.test(body), body.slice(0, 400));
  ok('  and nothing from the hour-old run', !/hour-old issue|old\.example/.test(body));

  // 3. The audit succeeds: recorded as ran, with the result it just produced.
  taQueuedExtra.clear();
  opened = null;
  reply = { ok: true, url: 'https://new.example/', tabId: 9, results: okResults };
  r = run();
  w = opened && opened.modes[0];
  eq('a completed audit is recorded as ran', w && w.status, 'ran');
  eq('  with its own result', w && w.data && w.data.url, 'https://new.example/');
  eq('  its page on the cover', opened && JSON.stringify(opened.pageUrls), '["https://new.example/"]');
  eq('  and the status line says the report opened', status(), 'Done — report opened in a new tab.');

  // 4. The report cannot be built: the status line says so.
  openThrows = 'quota exceeded';
  r = run();
  ok('a report that throws still settles the run', r.done && !r.threw, r.threw && String(r.threw));
  eq('  and the status line says it was not built', status(), 'The report could not be built: quota exceeded');
  openThrows = null;

  Object.keys(stubs).forEach(function (k) { delete globalThis[k]; });
})();

section('Report: WCAG and Cross-Variant say how the audit ran');
(function () {
  eval(slicePopup('function rptAgenticNoteHtml(note, label) {', '\n// ── the run'));
  eval(slicePopup('function rptWcagSection(entry) {', '\nfunction rptCvaSection('));
  var data = {
    url: 'https://p.example/', checks: ['contrast'], results: { contrast: { label: 'Colour contrast', issues: [] } },
    scope: '.hero', scopeError: 'Scope selector matched nothing — audited the full page instead: .hero',
  };
  var entry = { mode: 4, name: 'WCAG / Accessibility', status: 'ran', data: data };
  var html = rptWcagSection(entry);
  // The live panel always gave the scope error precedence; the report printed
  // "Scoped to" from the setting alone.
  ok('a scope that matched nothing is not reported as "Scoped to"', !/Scoped to/.test(html), html);
  ok('  the report says the whole page was audited', /audited the full page instead: \.hero/.test(html), html);
  data.scopeError = null;
  ok('a scope that matched still reads "Scoped to"', /Scoped to: \.hero/.test(rptWcagSection(entry)));

  // One variant audited without axe-core: the panel said so, the report did not.
  var cva = { scope: '', autoChecks: ['contrast'], includeManual: false, runs: [
    { label: 'Control', finalUrl: 'https://p.example/', results: { contrast: { label: 'Colour contrast', issues: ['axe · contrast — .a'] } } },
    { label: 'v1', finalUrl: 'https://p.example/', axeError: 'axe failed to load',
      results: { contrast: { label: 'Colour contrast', issues: ['heuristic contrast — .a'] } } },
  ] };
  html = rptCvaSection({ mode: 5, name: 'Cross-Variant Accessibility', status: 'ran', data: cva });
  ok('the Cross-Variant report says which variant ran without axe-core',
     /v1: axe-core could not run \(axe failed to load\)/.test(html), html.slice(0, 500));
  eq('  in cvaRunNotes\' words', cvaRunNotes(cva)[0], 'v1: axe-core could not run (axe failed to load) — heuristics only.');
})();

section('A/B: the accessibility audit is its own section, built from the captures');
(function () {
  // Captures as runVariantComparison returns them (background.js
  // captureVariant), Control first after runAbComparison's reorder; `a11y` is
  // performWcagAudit's { results, axeError, scopeError } for that same load.
  var at = Date.UTC(2026, 9, 5, 17, 0, 0);
  var auto = ['contrast', 'alt'];
  var audit = function (contrast, alt) {
    return { results: {
      contrast: { label: 'Colour contrast', wcag: '1.4.3, 1.4.11', issues: contrast },
      alt:      { label: 'Image alt text', wcag: '1.1.1', issues: alt || [] },
    }, axeError: null, scopeError: null };
  };
  var cap = function (label, o) {
    return Object.assign({ label: label, url: 'https://shop.example/?optimizely_x=' + label, finalUrl: 'https://shop.example/',
      title: 'Shop', loadError: null, console: [], errors: [], selectors: [], tabId: null, screenshot: null,
      fullPage: { pageW: 1280, pageH: 4000, capturedH: 4000, truncated: false }, expProbe: null }, o || {});
  };
  var control = cap('Control', { a11y: audit(['axe · contrast — .promo']) });
  var v1 = cap('v1', { a11y: audit(['axe · contrast — .promo', 'axe · contrast — .new-badge'], ['img.hero has no alt']) });

  var entry = abA11yEntry([control, v1], [{ label: 'v1', notServed: false }], auto, at);
  eq('an audited run is a mode-5 entry that ran', entry.mode + '/' + entry.status, '5/ran');
  eq('  named for the A/B report', entry.name, 'Accessibility (WCAG)');
  eq('  Control is the baseline', entry.data.runs[0].label, 'Control');
  eq('  timestamped by the caller', entry.data.ts, at);
  eq('  with no scope and no manual checks', entry.data.scope + '|' + entry.data.includeManual, '|false');
  eq('  each run keeps its finalUrl for the cover', entry.data.runs[1].finalUrl, 'https://shop.example/');
  var html = rptCvaSection(entry);
  ok('  and renders what v1 introduced', />ISSUES FOUND</.test(html) && /2 introduced · 0 resolved · 1 pre-existing/.test(html), html.slice(0, 700));
  ok('  under its own title', /Accessibility \(WCAG\)/.test(html));

  // The worker sets `a11y` only when asked. None on any loaded capture means
  // the request went unanswered — not "no issues". WHY is the worker's own
  // acknowledgement: run r_1791221055240 got "the service worker is older" on
  // a log whose version stamp showed the extension reloaded after the worker
  // change, so the reason may not be guessed from the captures alone.
  var stale = abA11yEntry([cap('Control'), cap('v1')], [], auto, at);
  eq('no audit on any loaded capture is a FAILED mode', stale.status, 'failed');
  ok('  with no acknowledgement, it is a stale worker and a reload fixes it',
     /did not acknowledge/.test(stale.reason) && /Reload the extension/.test(stale.reason), stale.reason);
  var acked = abA11yEntry([cap('Control'), cap('v1')], [], auto, at, 2);
  eq('an acknowledged request with no audit is still FAILED', acked.status, 'failed');
  ok('  but is not blamed on a stale worker', !/older|Reload/.test(acked.reason) && /received 2 of the 2 requested check/.test(acked.reason), acked.reason);
  ok('  a worker that received nothing says so', /received 0 of the 2/.test(abA11yEntry([cap('Control'), cap('v1')], [], auto, at, 0).reason));
  eq('  and an audited run ignores the acknowledgement', abA11yEntry([control, v1], [], auto, at, 2).status, 'ran');

  // A page that never loaded has no audit either, and that is its load error,
  // not a stale worker.
  var noLoad = abA11yEntry([control, cap('v1', { loadError: 'net::ERR_NAME_NOT_RESOLVED' })], [], auto, at);
  eq('a variant that did not load is not mistaken for a stale worker', noLoad.status, 'ran');
  eq('  it carries its load error', noLoad.data.runs[1].loadError, 'net::ERR_NAME_NOT_RESOLVED');
  html = rptCvaSection(noLoad);
  ok('  and the section cannot PASS on it', !/>PASS</.test(html) && />NOT COMPARED</.test(html), html.slice(0, 500));

  // A failed audit is best-effort in the worker; here it is that run's error.
  var threw = abA11yEntry([control, cap('v1', { a11y: { error: 'Cannot access contents of the page' } })], [], auto, at);
  ok('an audit that threw is that variant\'s error', /accessibility audit failed \(Cannot access contents of the page\)/.test(threw.data.runs[1].loadError),
     threw.data.runs[1]);
  eq('  with no results', threw.data.runs[1].results, null);

  var stopped = abA11yEntry([control, { label: 'v1', url: 'https://shop.example/?v=1', skipped: true }], [], auto, at);
  eq('a run stopped before a second capture is skipped', stopped.status, 'skipped');

  // A variant the platform says was not served is Control audited twice.
  var ns = abA11yEntry([control, cap('v1', { a11y: audit(['axe · contrast — .promo']) })], [{ label: 'v1', notServed: true }], auto, at);
  eq('notServed comes from Visual Diff\'s perVariant', ns.data.runs[1].notServed, true);
  html = rptCvaSection(ns);
  ok('a not-served variant never reads PASS', !/>PASS</.test(html) && />NOT COMPARED</.test(html), html.slice(0, 500));
  ok('  its row says why', /was not served its own variation/.test(html), html);
  ok('  and the summary counts it out', /0 introduced issue\(s\) across 0 variant\(s\) · 1 not compared/.test(html), html.slice(0, 500));

  // A served variant's regression still outranks another variant's void pair,
  // the A/B ladder's order (comparedUnmetCopy above notCompared).
  var v2 = cap('v2', { a11y: audit(['axe · contrast — .promo']) });
  var mixed = abA11yEntry([control, v1, v2], [{ label: 'v1', notServed: false }, { label: 'v2', notServed: true }], auto, at);
  html = rptCvaSection(mixed);
  ok('a served variant\'s regression outranks a not-served one', />ISSUES FOUND</.test(html), html.slice(0, 500));
  ok('  and only the served variant is counted', /2 introduced issue\(s\) across 1 variant\(s\) · 1 not compared/.test(html), html.slice(0, 500));

  var clean = abA11yEntry([control, cap('v1', { a11y: audit(['axe · contrast — .promo']) })], [{ label: 'v1', notServed: false }], auto, at);
  ok('an identical, served, audited variant still earns PASS', />PASS</.test(rptCvaSection(clean)));
  // Without Visual Diff there is no perVariant at all; nothing is invented.
  eq('no perVariant means nothing is marked not served', abA11yEntry([control, v1], undefined, auto, at).data.runs[1].notServed, false);

  // The wiring: the run asks for every automated check, and the entry joins the
  // report after the A/B section only when it asked.
  var run = slicePopup('async function runAbComparison(opts = {}) {', '\n// ── Diffing');
  ok('the run sends every check to the worker, automated and manual',
     /const a11yChecks = abState\.a11yAudit !== false \? \[\.\.\.a11yAuto, \.\.\.a11yManual\] : null;/.test(run) && /a11yChecks,\s*\n?\s*\}/.test(run), run.length);
  ok('  and adds the section only when the option was on, comparing the automated checks only',
     /if \(a11yChecks\) \{\s*const a11yEntry = abA11yEntry\(captures, visualDiffResult\?\.perVariant, a11yAuto, Date\.now\(\), res\.a11yRequested, a11yManual\);/.test(run));
  ok('  the visual review runs only on an audited run with Agentic Testing on',
     /if \(a11yEntry\.status === 'ran' && agenticTesting && !_abVisualDiffStopRequested\) \{[\s\S]{0,120}a11yEntry\.data\.agenticNote = await abA11yReview\(captures, a11yEntry\.data\);/.test(run));

  // The audit must run BEFORE the capture: stabilizeForCapture clears
  // video.autoplay, after which the motion check passes every page.
  var bg = readFile('../background.js');
  var cv = bg.slice(bg.indexOf('async function captureVariant('), bg.indexOf('async function runVariantComparison('));
  var ia = cv.indexOf('performWcagAudit('), ic = cv.indexOf('captureFullPageAndViewport(');
  ok('captureVariant audits before it captures', ia > 0 && ic > 0 && ia < ic, { audit: ia, capture: ic });
  ok('  and runVariantComparison passes the checks through',
     /a11yChecks: Array\.isArray\(a11yChecks\) \? a11yChecks : null/.test(bg));
  ok('the Cross-Variant mode\'s worker entry point is gone', bg.indexOf('runCrossVariantAudit') === -1);
  ok('the worker answers the visual review with the vision call',
     /msg\.action === 'a11yVisionReview'[\s\S]{0,700}sendResponse\(await callClaudeVision\(\{ images, prompt, maxTokens: 700 \}\)\)/.test(bg));
  // The acknowledgement must reach the popup on every run, asked or not:
  // its absence is what identifies an older worker.
  ok('the worker returns how many checks it received, unconditionally',
     /const a11yRequested = Array\.isArray\(a11yChecks\) \? a11yChecks\.length : 0;\s*return \{ results, agenticNote, a11yRequested \};/.test(bg));
  ok('  and the message handler passes it back', /sendResponse\(\{ ok: true, results, agenticNote, a11yRequested \}\)/.test(bg));
})();

section('A/B: the accessibility section is as detailed as the standalone WCAG report');
(function () {
  // r_1791222173138 (STRZ-1658, 0.7.3, first audited A/B run) printed three
  // counts per variant: "10 introduced" with not one of the ten named. The
  // standalone WCAG report on the same page (r_1790972743184) listed every
  // check with its criteria and status, every issue, the manual checks and an
  // Agentic Testing note. These pin each of those back, from real issue
  // strings of that run.
  var at = Date.UTC(2026, 9, 5, 17, 42, 53);
  var alt1 = 'axe · Images must have alternative text — .strz1658__active_H0WoI.strz1658__rfmPage_H0WoI[data-key="Trending Now"] > .strz1658__rfmCard_H0WoI[data-id="74649"] > img';
  var alt2 = 'axe · Images must have alternative text — div[data-id="74363"] > img';
  var logoName = 'a.Logo_logo-link__4rJsy.d-flex — control has no accessible name (4.1.2)';
  var nav = 'No <nav> / role="navigation" landmark found';
  var manualModal = 'No modal/dialog in the current DOM. Open each modal and confirm Escape (or a visible close control) exits it without trapping keyboard focus.';
  var res = function (screenreader, modal) {
    return {
      screenreader: { label: 'Screen Reader Announcements', wcag: '1.1.1, 4.1.3, 4.1.2', issues: screenreader },
      navconsistency: { label: 'Navigation Consistency', wcag: '3.2.3, 3.2.4, 3.2.6', issues: [nav] },
      titles: { label: 'Page Identity & Titles', wcag: '2.4.2', issues: [] },
      modalescape: { label: 'Modal & Dialog Escape', wcag: '2.1.2', infoOnly: true, issues: [modal || manualModal] },
    };
  };
  var cap = function (label, results, o) {
    return Object.assign({ label: label, url: 'https://www.starz.com/us/en/buy?optimizely_x=' + label, finalUrl: 'https://www.starz.com/us/en/buy',
      loadError: null, a11y: { results: results, axeError: null, scopeError: null } }, o || {});
  };
  var caps = [cap('v0', res([logoName])), cap('v1', res([logoName])), cap('v2', res([alt1, alt2]))];
  var auto = ['screenreader', 'navconsistency', 'titles'];
  var entry = abA11yEntry(caps, [], auto, at, 4, ['modalescape']);
  eq('manual checks ride along but are not compared', entry.data.includeManual + '|' + entry.data.autoChecks.join(','), 'true|screenreader,navconsistency,titles');
  var html = rptCvaSection(entry);

  ok('every automated check has a row, with its success criteria',
     /Page Identity &amp; Titles<br><span class="rpt-muted">2\.4\.2<\/span>/.test(html) && /Navigation Consistency/.test(html), html.slice(0, 1500));
  ok('  and each page\'s own status', /<td>Pass<\/td>/.test(html) && /<td>1 issue\(s\)<\/td>/.test(html));
  ok('  marking what a variant made worse and better', /2 issue\(s\)<br><span class="ab-err">\+2 worse<\/span> <span class="rpt-muted">−1 better<\/span>/.test(html), html);
  ok('every introduced issue is written out', html.indexOf('data-id=&quot;74649&quot;') !== -1 || html.indexOf('data-id="74649"') !== -1, html);
  ok('  under its variant', /v2 compared with v0/.test(html));
  ok('  with what it resolved', html.split(logoName).length - 1 >= 2, html);
  ok('a variant that changed nothing says so', /v1 compared with v0<\/h3><p class="rpt-muted">0 introduced · 0 resolved · 2 pre-existing\. No issue was added or removed on any check\./.test(html), html);
  ok('Control\'s own audit is laid out as the WCAG report lays out a page',
     /v0 \(Control\): full audit/.test(html) && /2 passed · 2 with issues · 2 total issue\(s\)/.test(html) === false && /1 passed · 2 with issues · 2 total issue\(s\)/.test(html), html);
  ok('  listing the issues every variant inherits', html.indexOf(esc(nav)) !== -1, html);
  ok('the manual checks are reported once', /<h3>Manual review<\/h3>/.test(html) && html.split(esc(manualModal)).length - 1 === 1, html);
  ok('  and never counted as issues', !/Modal &amp; Dialog Escape<br><span class="rpt-muted">2\.1\.2<\/span><\/td><td>Pass/.test(html) && entry.data.autoChecks.indexOf('modalescape') === -1);
  var caps2 = [cap('v0', res([logoName])), cap('v1', res([logoName], 'A dialog is open: confirm Escape closes it.'))];
  var html2 = rptCvaSection(abA11yEntry(caps2, [], auto, at, 4, ['modalescape']));
  ok('  a page whose manual guidance differs is named under it', /On v1:<\/p><ul><li>A dialog is open: confirm Escape closes it\.<\/li><\/ul>/.test(html2), html2);

  entry.data.agenticNote = 'v2 adds a row of poster images with no visible titles.';
  html = rptCvaSection(entry);
  ok('the Agentic accessibility review is printed, labelled', /Agentic Accessibility Review \(Sonnet\):<\/strong> v2 adds a row of poster images/.test(html), html.slice(-400));

  // What the model is told: the screenshots' order, Control, and the actual
  // new issues rather than counts.
  var prompt = abA11yReviewPrompt(entry.data, ['v0', 'v1', 'v2']);
  ok('the review prompt names the screenshot order and Control', /in this order: v0, v1, v2\. v0 is Control\./.test(prompt), prompt);
  var ctl = abA11yEntry([cap('Control', res([logoName])), cap('v1', res([logoName]))], [], auto, at, 4, []);
  var ctlHtml = rptCvaSection(ctl);
  ok('a target labelled Control is not called "Control (Control)"', !/Control \(Control\)/.test(ctlHtml) && /<h3>Control: full audit<\/h3>/.test(ctlHtml), ctlHtml.slice(0, 600));
  ok('  nor "Control is Control" to the model', /Control is the baseline\./.test(abA11yReviewPrompt(ctl.data, ['Control', 'v1'])) && !/Control is Control/.test(abA11yReviewPrompt(ctl.data, ['Control', 'v1'])));
  ok('  gives Control\'s own issues by check', /v0 \(Control\): Screen Reader Announcements \(1\), Navigation Consistency \(1\)\./.test(prompt), prompt);
  ok('  says when a variant changed nothing', /v1: no change from v0 on any automated check\./.test(prompt), prompt);
  ok('  and quotes what a variant introduced', prompt.indexOf('Screen Reader Announcements: 2 worse (e.g. ' + alt1) !== -1 && /, 1 better\./.test(prompt), prompt);
  var nsPrompt = abA11yReviewPrompt(abA11yEntry(caps, [{ label: 'v2', notServed: true }], auto, at, 4, []).data, ['v0', 'v1', 'v2']);
  ok('  and that a not-served variant was not compared', /v2: not compared — the experiment platform reports it was not served its variation\./.test(nsPrompt), nsPrompt);
})();

section('A/B accessibility: a count that moved is one changed issue, not a fix and a new one');
(function () {
  // r_1791222173138, STRZ-1658 v2 and v3: Control's heuristic line read
  // "2 <img> missing an alt attribute", the variants' "43 <img> …". Matched as
  // exact strings that is one resolved and one introduced, and the report
  // printed "−1 fixed" for a page with 41 more images missing alt text.
  var two = '2 <img> missing an alt attribute — no text alternative to announce (1.1.1)';
  var many = '43 <img> missing an alt attribute — no text alternative to announce (1.1.1)';
  var logo = 'a.Logo_logo-link__4rJsy.d-flex — control has no accessible name (4.1.2)';
  var alt = 'axe · Images must have alternative text — div[data-id="74363"] > img';
  var runs = function (variantIssues) {
    return [
      { label: 'v0', results: { screenreader: { label: 'Screen Reader Announcements', wcag: '1.1.1', issues: [two, logo] } } },
      { label: 'v2', results: { screenreader: { label: 'Screen Reader Announcements', wcag: '1.1.1', issues: variantIssues } } },
    ];
  };
  var d = diffCvaRuns(runs([alt, many, logo]), ['screenreader']);
  var pc = d.variants[0].perCheck[0];
  eq('the moved count is paired, not resolved', pc.resolved.length + '|' + pc.introduced.length + '|' + pc.changed.length, '0|1|1');
  eq('  as worse, from 2 to 43', JSON.stringify(pc.changed[0]), JSON.stringify({ from: two, to: many, worse: true }));
  eq('  and counted as one introduced, nothing resolved', d.variants[0].introduced + '/' + d.variants[0].resolved, '2/0');
  var fewer = diffCvaRuns(runs([logo, '1 <img> missing an alt attribute — no text alternative to announce (1.1.1)']), ['screenreader']);
  eq('a count that fell is better, counted as resolved', fewer.variants[0].introduced + '/' + fewer.variants[0].resolved + '/' + (fewer.variants[0].perCheck[0].changed[0] || {}).worse, '0/1/false');
  // Only a LEADING count pairs: two different elements are still two issues.
  var els = diffCvaRuns(runs([logo, alt.replace('74363', '1'), two]), ['screenreader']);
  eq('different elements are not paired by their digits', els.variants[0].perCheck[0].changed.length + '|' + els.variants[0].perCheck[0].introduced.length, '0|1');

  var html = rptCvaSection({ mode: 5, name: 'Accessibility (WCAG)', status: 'ran', data: { scope: '', autoChecks: ['screenreader'], runs: runs([alt, many, logo]) } });
  ok('the report shows the change with what Control had', html.indexOf(esc(many) + ' (v0 had 2)') !== -1, html);
  ok('  and does not call the 2 fixed', !/better<\/span>/.test(html) && /\+2 worse<\/span>/.test(html), html);
})();

section('A/B accessibility: a variant with the same changes as an earlier one says so');
(function () {
  // STRZ-1658's v2 and v3 share the new UI. r_1791225305511 printed their
  // identical ten introduced issues twice, a page each.
  var two = '2 <img> missing an alt attribute — no text alternative to announce (1.1.1)';
  var many = '43 <img> missing an alt attribute — no text alternative to announce (1.1.1)';
  var logo = 'a.Logo_logo-link__4rJsy.d-flex — control has no accessible name (4.1.2)';
  var alt = 'axe · Images must have alternative text — .strz1658__watchAnywhereLogos_H0WoI';
  var other = 'axe · Images must have alternative text — div[data-id="74363"] > img';
  var page = function (label, issues) {
    return { label: label, results: { screenreader: { label: 'Screen Reader Announcements', wcag: '1.1.1, 4.1.3, 4.1.2', issues: issues } } };
  };
  var data = function (pages) { return { mode: 5, name: 'Accessibility (WCAG)', status: 'ran', data: { scope: '', autoChecks: ['screenreader'], runs: pages } }; };
  var html = rptCvaSection(data([page('v0', [two, logo]), page('v1', [two, logo]), page('v2', [alt, many, logo]), page('v3', [alt, many, logo])]));
  ok('v3 points at v2 instead of repeating its table',
     /<h3>v3 compared with v0<\/h3><p class="rpt-muted">2 introduced · 0 resolved · 1 pre-existing\. Same changes as v2\.<\/p>/.test(html), html.slice(-700));
  eq('  so each issue is listed once', html.split(esc(alt)).length - 1, 1);
  eq('  and only one change table is printed', (html.match(/<th>Introduced<\/th>/g) || []).length, 1);
  ok('  v1, which changed nothing, still says so rather than "same as"', /v1 compared with v0<\/h3><p class="rpt-muted">0 introduced · 0 resolved · 2 pre-existing\. No issue was added or removed on any check\./.test(html), html);
  var diffr = rptCvaSection(data([page('v0', [two, logo]), page('v2', [alt, many, logo]), page('v3', [other, many, logo])]));
  ok('variants whose changes differ each get their own table', (diffr.match(/<th>Introduced<\/th>/g) || []).length === 2 && !/Same changes as/.test(diffr), diffr.slice(-600));
  var noBase = rptCvaSection(data([Object.assign(page('v0', []), { loadError: 'Navigation timeout', results: null }), page('v2', [alt, logo]), page('v3', [alt, logo])]));
  ok('without a baseline it says "Same issues as"', /<h3>v3: every issue \(no baseline\)<\/h3><p class="rpt-muted">2 issue\(s\) on this page\. Same issues as v2\.<\/p>/.test(noBase), noBase.slice(-500));
  var ns = rptCvaSection(data([page('v0', [two, logo]), Object.assign(page('v2', [alt, many, logo]), { notServed: true }), page('v3', [alt, many, logo])]));
  ok('a not-compared variant is never the one pointed at', !/Same changes as v2/.test(ns) && (ns.match(/<th>Introduced<\/th>/g) || []).length === 1, ns.slice(-600));
  var prompt = abA11yReviewPrompt(data([page('v0', [two, logo]), page('v1', [two, logo]), page('v2', [alt, many, logo]), page('v3', [alt, many, logo])]).data, ['v0', 'v1', 'v2', 'v3']);
  ok('the review prompt says the same', /\nv3: the same changes as v2\.$/.test(prompt) && prompt.split(alt).length - 1 === 1, prompt.slice(-400));
})();

section('Agentic notes print as paragraphs, not one block with asterisks');
(function () {
  // The accessibility review of r_1791225305511, verbatim: four **bold**-led
  // paragraphs that the report printed as one run-on block, asterisks and all.
  var note = "**v0 (Control) \u2013 Pricing page:** The plan cards rely on a radio button plus color-fill (teal) to show selection, but the radio circle is small and low-contrast against the dark card; users scanning quickly may miss which plan is \"selected\" vs. the \"BEST DEAL\" badge, creating competing visual signals for which option is recommended.\n\n**v1 \u2013 Pricing page:** \"BEST DEAL\" badge swapped for \"MOST POPULAR\" on the Monthly card instead of Annual. This creates a logical conflict: the cheaper per-month effective price (Annual, $2.50/mo) is visually de-emphasized while the costlier Monthly plan gets the attention badge \u2014 confusing hierarchy for decision-making, not just a copy change.\n\n**v2 \u2013 Hero/pricing page:** Background collage images (show stills) sit directly behind white/light headline text (\"Don't Miss Another Moment\") with insufficient dedicated scrim, so contrast varies by region of the busy photo collage even if a single color-contrast check passes on average. Also CTA buttons became text links \"SELECT PLAN\" in bright yellow boxes \u2014 good target size, but the \"Most Popular\" tag now floats oddly clipped at the card's top-right corner, overlapping the card border, looking visually broken.\n\n**v3 \u2013 Hero/pricing page:** Same image/text contrast concern as v2. Additionally \"Best Deal\" tag shifted to Annual card, which is clearer logically, but the tag again appears clipped/overlapping the rounded card edge, an alignment/visual-polish issue not caught by automated tools.";
  var html = rptAgenticNoteHtml(note, 'Agentic Accessibility Review (Sonnet)');
  eq('one paragraph per paragraph of the note', (html.match(/<p class="rpt-muted">/g) || []).length, 4);
  ok('  the label leads the first', /^<p class="rpt-muted"><strong>Agentic Accessibility Review \(Sonnet\):<\/strong> <strong>v0 \(Control\) – Pricing page:<\/strong>/.test(html), html.slice(0, 200));
  ok('  bold is bold, no asterisks left', !/\*\*/.test(html) && /<strong>v3 – Hero\/pricing page:<\/strong>/.test(html), html);
  ok('  and the text is still escaped', /&quot;BEST DEAL&quot;|"BEST DEAL"/.test(html) && !/<script/.test(rptAgenticNoteHtml('**x** <script>alert(1)</script>')), html.slice(0, 300));
  eq('a one-line note renders as before', rptAgenticNoteHtml('Looks fine.'), '<p class="rpt-muted"><strong>Agentic Testing Note (Sonnet):</strong> Looks fine.</p>');
  ok('markup inside bold stays escaped', rptAgenticNoteHtml('**<b>x</b>**').indexOf('<strong>&lt;b&gt;x&lt;/b&gt;</strong>') !== -1, rptAgenticNoteHtml('**<b>x</b>**'));
})();

section('The accessibility review is asked for barriers, not opinions on the experiment');
(function () {
  // The same review argued v1 badged the wrong plan and that a tag's corner
  // overlapped its card. The prompt now rules both out.
  var data = { autoChecks: ['contrast'], runs: [
    { label: 'v0', results: { contrast: { label: 'Color Contrast', wcag: '1.4.3', issues: [] } } },
    { label: 'v1', results: { contrast: { label: 'Color Contrast', wcag: '1.4.3', issues: [] } } },
  ] };
  var prompt = abA11yReviewPrompt(data, ['v0', 'v1']);
  ok('it names who the barriers are for', /screen reader, a keyboard or zoom, or with low vision, colour blindness or a cognitive disability/.test(prompt), prompt);
  ok('  rules out judging the experiment', /design, copy, pricing and which option they emphasise are the experiment's intended changes: do not judge them/.test(prompt), prompt);
  ok('  and polish that does not affect use', /do not report visual polish unless it affects perceiving or operating the page/.test(prompt), prompt);
  ok('  asks for a paragraph per page', /one short paragraph per page, starting with its label in bold/.test(prompt), prompt);
})();

section('Cover: the Test Agent modes name their pages');
(function () {
  // WCAG's url is the tab as the user loaded it. The first real WCAG cover,
  // r_1790972328425 (STRZ-1658 v2), printed this one whole: a forcing link that
  // registers a real tracked exposure for anyone who pastes it.
  var forcing = 'https://www.starz.com/us/en/buy?currentTime=1791259200001'
    + '&optimizely_x=4780302780858368&optimizely_force_tracking=true&cro_mode=qa';
  eq('a WCAG cover gets the page, not the forcing link',
     JSON.stringify(abPageUrls([{ mode: 4, status: 'ran', data: { url: forcing } }])),
     JSON.stringify(['https://www.starz.com/us/en/buy']));
  var urls = abPageUrls([
    { mode: 4, status: 'ran', data: { url: 'https://shop.example/cart?optimizely_x=9#reviews' } },
    { mode: 5, status: 'ran', data: { runs: [
      { label: 'Control', url: 'https://shop.example/?optimizely_x=1&optimizely_token=SECRET', finalUrl: 'https://shop.example/' },
      { label: 'v1', url: 'https://shop.example/?optimizely_x=2&optimizely_token=SECRET', finalUrl: 'https://shop.example/' },
    ] } },
    { mode: 6, status: 'ran', data: { pages: [
      { url: 'https://shop.example/pdp?optimizely_token=SECRET#top', skipped: false },
      { url: 'https://shop.example/never-reached', skipped: true },
    ] } },
    { mode: 4, status: 'failed', reason: 'No active tab' },
  ]);
  eq('WCAG, Cross-Variant and Performance each name their page, once', JSON.stringify(urls),
     JSON.stringify(['https://shop.example/cart', 'https://shop.example/', 'https://shop.example/pdp']));
  ok('no preview token or forcing parameter reaches the cover', !/SECRET|optimizely_/.test(JSON.stringify(urls)), urls);
})();

// ── the Function Queue's Test Agent run ─────────────────────────────────────
section('Function Queue: the engine control, the run, and the report it opens');

(function queueEngineAndRun() {
  var src = slicePopup('const QUEUE_AGENT_FUNCS', 'async function stopQueue() {');
  ok('the slice is the engine control and the run', src.indexOf('function effectiveEngine') !== -1 && src.indexOf('async function runQueue') !== -1
     && src.indexOf('async function maybeOpenQueueReport') !== -1, src.length);

  function build(o) {
    o = o || {};
    var state = { mode: o.mode || 'close', engine: o.engine || 'classic', tab: o.tab || 'new' };
    var agentRadio = { disabled: false };
    var note = { textContent: '', style: { display: 'none' } };
    var sent = [], alerts = [], tabs = [], opened = [];
    var steps = o.steps || [];
    var record = o.record || null;
    var stubs = {
      document: {
        querySelector: function (q) {
          if (q === 'input[name=mode]:checked') return { value: state.mode };
          if (q === 'input[name=engine]:checked') return { value: state.engine };
          if (q === 'input[name=tabtarget]:checked') return { value: state.tab };
          return null;
        },
        getElementById: function (id) { return id === 'engine-agent' ? agentRadio : id === 'engine-note' ? note : null; },
      },
      steps: steps,
      alert: function (m) { alerts.push(m); },
      WIN_ID: 7,
      chrome: {
        tabs: { query: function () { return Promise.resolve([{ id: 42 }]); } },
        storage: { local: { get: function (k) { return Promise.resolve(k === 'universalDelay' ? {} : {}); } } },
        runtime: { sendMessage: function (m) { sent.push(m); return Promise.resolve(o.reply === undefined ? { ok: true } : o.reply); } },
      },
      showTab: function (n) { tabs.push(n); },
      syncRunState: function () {},
      sessionNS: { get: function () { return Promise.resolve({ queueRun: record }); } },
      openReportTab: function (sec) { opened.push(sec); return o.openThrows ? Promise.reject(new Error(o.openThrows)) : Promise.resolve(); },
    };
    var names = Object.keys(stubs);
    var api = new Function(names.join(','), src + '\nreturn { runQueue: runQueue, maybeOpenQueueReport: maybeOpenQueueReport, '
      + 'effectiveEngine: effectiveEngine, syncEngineControl: syncEngineControl, queueHasAgentSteps: queueHasAgentSteps };')
      .apply(null, names.map(function (n) { return stubs[n]; }));
    api.state = state; api.sent = sent; api.alerts = alerts; api.tabs = tabs; api.opened = opened;
    api.agentRadio = agentRadio; api.note = note; api.steps = steps;
    api.setRecord = function (r) { record = r; };
    return api;
  }
  var step = function (func, extra) { return Object.assign({ func: func, enabled: true, delay: '0', inputs: {} }, extra || {}); };
  function settle() { drainMicrotasks(); }

  // ---- which engine runs ----
  var a = build({ steps: [step('click')] });
  eq('Classic is the default', a.effectiveEngine(), 'classic');
  a.state.engine = 'agent';
  eq('  the Test Agent when it is chosen', a.effectiveEngine(), 'agent');
  var b = build({ steps: [step('click'), step('agent_prompt')] });
  eq('a queue holding a Prompt Function runs on the agent whatever was chosen', b.effectiveEngine(), 'agent');
  eq('  as does one holding a Navigate step', build({ steps: [step('agent_navigate')] }).effectiveEngine(), 'agent');
  eq('  but not when that step is disabled', build({ steps: [step('agent_prompt', { enabled: false })] }).effectiveEngine(), 'classic');
  var c = build({ mode: 'loop', engine: 'agent', steps: [step('click')] });
  eq('a loop is always Classic, even with the agent chosen', c.effectiveEngine(), 'classic');

  // ---- what the control says ----
  var d = build({ steps: [step('click')] });
  d.syncEngineControl();
  eq('nothing to say normally', d.note.textContent, '');
  eq('  and the note is hidden', d.note.style.display, 'none');
  eq('  and the agent can be chosen', d.agentRadio.disabled, false);
  var e = build({ mode: 'loop', steps: [step('click')] });
  e.syncEngineControl();
  eq('a loop cannot use the agent', e.agentRadio.disabled, true);
  ok('  and says why', /Loop continuously always runs Classic/.test(e.note.textContent), e.note.textContent);
  var f = build({ mode: 'loop', steps: [step('agent_prompt')] });
  f.syncEngineControl();
  ok('a loop with an agent step says it cannot run', /would repeat it forever/.test(f.note.textContent), f.note.textContent);
  var g2 = build({ steps: [step('agent_navigate')] });
  g2.syncEngineControl();
  ok('an agent step under Classic says the run will use the agent', /so this run uses it/.test(g2.note.textContent), g2.note.textContent);
  eq('  and the note is shown', g2.note.style.display, '');
  var h = build({ engine: 'agent', steps: [step('agent_navigate')] });
  h.syncEngineControl();
  eq('  but not when the agent was chosen anyway', h.note.textContent, '');

  // ---- starting a run ----
  var r1 = build({ engine: 'agent', steps: [step('click', { groupName: 'Add to cart', inputs: { selector: '#x' } })] });
  r1.runQueue(); settle();
  eq('a Test Agent run says so to the worker', r1.sent[0].payload.engine, 'agent');
  eq('  and sends the group name (an agent step is named by it)', r1.sent[0].payload.queue[0].groupName, 'Add to cart');
  eq('  to the console, as before', r1.tabs.join(','), 'console');
  eq('  on the tab it was asked for', r1.sent[0].payload.targetTabId === null || r1.sent[0].payload.targetTabId === undefined, true);
  var r2 = build({ steps: [step('click')] });
  r2.runQueue(); settle();
  eq('a Classic run says so', r2.sent[0].payload.engine, 'classic');
  var r3 = build({ steps: [step('agent_prompt', { inputs: { prompt: 'x' } })] });
  r3.runQueue(); settle();
  eq('a queue with a Prompt Function is sent as an agent run, though Classic was chosen', r3.sent[0].payload.engine, 'agent');
  var r4 = build({ mode: 'loop', steps: [step('agent_navigate')] });
  r4.runQueue(); settle();
  eq('a loop with an agent step is refused, with nothing sent', r4.sent.length, 0);
  ok('  and told why', r4.alerts.length === 1 && /repeat it forever/.test(r4.alerts[0]), r4.alerts);
  var r5 = build({ engine: 'agent', steps: [step('click')], reply: { ok: false, error: 'A queue is already running. Stop it first.' } });
  r5.runQueue(); settle();
  ok('a refusal from the worker is shown', r5.alerts[0] === 'A queue is already running. Stop it first.', r5.alerts);
  eq('  and does not go to the console as if it had started', r5.tabs.length, 0);
  r5.setRecord({ engine: 'agent', startedAt: Date.now() + 10, steps: [] });
  r5.maybeOpenQueueReport(); settle();
  eq('  and no report is then owed for it', r5.opened.length, 0);

  // ---- the report, once the worker has written its record ----
  var run = function (o) { return Object.assign({ engine: 'agent', startedAt: Date.now() + 50, ts: Date.now() + 90, startUrl: 'https://shop.example/', steps: [] }, o || {}); };
  var q1 = build({ engine: 'agent', steps: [step('click')] });
  q1.runQueue(); settle();
  q1.setRecord(run({ startedAt: 1 }));
  q1.maybeOpenQueueReport(); settle();
  eq('a record from an EARLIER run is not this run\'s report', q1.opened.length, 0);
  q1.setRecord(null);
  q1.maybeOpenQueueReport(); settle();
  eq('  nor is no record at all', q1.opened.length, 0);
  q1.setRecord(run({ engine: 'classic' }));
  q1.maybeOpenQueueReport(); settle();
  eq('  nor a Classic one', q1.opened.length, 0);
  q1.setRecord(run({ steps: [{ i: 0, func: 'click', label: 'Click · #x', engine: 'direct', status: 'passed' }] }));
  q1.maybeOpenQueueReport(); settle();
  eq('this run\'s record opens ONE report', q1.opened.length, 1);
  eq('  of the Functional Queue', q1.opened[0].modes[0].name + '/' + q1.opened[0].modes[0].mode + '/' + q1.opened[0].modes[0].status, 'Functional Queue/queue/ran');
  eq('  carrying the record', q1.opened[0].modes[0].data.steps[0].label, 'Click · #x');
  eq('  with the cover derived from it, not hardcoded', q1.opened[0].pageUrls.join(','), 'https://shop.example/');
  q1.maybeOpenQueueReport(); settle();
  eq('  and asking again does not open a second', q1.opened.length, 1);

  var q2 = build({ engine: 'agent', steps: [step('click')], openThrows: 'IndexedDB is unavailable' });
  q2.runQueue(); settle();
  q2.setRecord(run());
  q2.maybeOpenQueueReport(); settle();
  ok('a report that cannot be built says so instead of failing silently', q2.alerts.length === 1 && /IndexedDB is unavailable/.test(q2.alerts[0]), q2.alerts);
  q2.maybeOpenQueueReport(); settle();
  eq('  and is not retried forever', q2.opened.length, 1);

  var q3 = build({ steps: [step('click')] });
  q3.runQueue(); settle();
  q3.setRecord(run({ engine: 'agent' }));
  q3.maybeOpenQueueReport(); settle();
  eq('a Classic run owes no report, whatever record is in storage', q3.opened.length, 0);
})();

(function queueReportSection() {
  var mk = function (steps, o) { return Object.assign({ engine: 'agent', startedAt: 1, ts: 2, startUrl: 'https://shop.example/', healCount: 0, aborted: false, stopped: false, error: null, steps: steps }, o || {}); };
  var st = function (i, status, o) { return Object.assign({ i: i, func: 'click', label: 'Click · #s' + i, group: null, engine: 'direct', status: status, directError: null, segment: null, ms: 10 }, o || {}); };
  var html = function (run) { return rptQueueSection({ mode: 'queue', name: 'Functional Queue', status: 'ran', data: run }); };
  var badgeOf = function (h) { var m = /rpt-badge rpt-badge-(\w+)">([^<]*)</.exec(h); return m ? m[1] + '/' + m[2] : null; };

  eq('every step passing is a PASS', badgeOf(html(mk([st(0, 'passed'), st(1, 'passed')]))), 'pass/PASSED');
  eq('a healed step makes it NEEDS REVIEW, never a pass', badgeOf(html(mk([st(0, 'passed'), st(1, 'healed', { engine: 'agent-heal' })]))), 'issues/NEEDS REVIEW');
  eq('  so does an unverified heal', badgeOf(html(mk([st(0, 'healed-unverified', { engine: 'agent-heal' })]))), 'issues/NEEDS REVIEW');
  eq('  and a prompt only the agent vouches for', badgeOf(html(mk([st(0, 'done-agent-reported', { func: 'agent_prompt', engine: 'agent-prompt' })]))), 'issues/NEEDS REVIEW');
  eq('a failed step is a FAIL', badgeOf(html(mk([st(0, 'passed'), st(1, 'failed'), st(2, 'not-attempted')], { aborted: true }))), 'fail/FAILED');
  eq('  and the worst step wins over a heal', badgeOf(html(mk([st(0, 'healed', { engine: 'agent-heal' }), st(1, 'failed')]))), 'fail/FAILED');
  eq('a blocked step is a FAIL', badgeOf(html(mk([st(0, 'blocked', { engine: 'agent-prompt' })], { aborted: true }))), 'fail/FAILED');
  eq('a stopped run is no result', badgeOf(html(mk([st(0, 'passed'), st(1, 'stopped'), st(2, 'not-attempted')], { stopped: true }))), 'skip/STOPPED');
  eq('a run that aborted before any step failed did not run', badgeOf(html(mk([st(0, 'not-attempted')], { aborted: true, error: 'No Anthropic API key' }))), 'fail/DID NOT RUN');
  ok('  and says why in its summary', html(mk([st(0, 'not-attempted')], { aborted: true, error: 'No Anthropic API key' })).indexOf('No Anthropic API key') !== -1);
  eq('nothing but skipped steps ran nothing', badgeOf(html(mk([st(0, 'skipped')]))), 'skip/NOTHING RAN');

  var h = html(mk([st(0, 'passed'), st(1, 'healed', { engine: 'agent-heal', directError: 'CSS selector not found: #old-cta',
    segment: { summary: 'The agent carried out the step "Click · #s1" in 2 agent step(s), and a click reached an element and the page changed.',
               actions: [{ healTarget: { tag: 'button', selector: '#get-quote', text: 'Get a quote' } }] } }),
    st(2, 'failed', { engine: 'agent-heal', directError: 'ID not found: email', segment: { summary: 'The agent reported it could not do the step.' } }),
    st(3, 'blocked', { func: 'agent_prompt', engine: 'agent-prompt', segment: { summary: 'Stopped at a CAPTCHA.', blockedBy: { gate: 'captcha' } } }),
    st(4, 'skipped'), st(5, 'not-attempted'), st(6, 'stopped')], { aborted: true }));
  ok('a healed step shows both what the saved step said and what the agent did',
     h.indexOf('The saved step failed: CSS selector not found: #old-cta. The Test Agent did it instead.') !== -1, h.slice(0, 200));
  ok('  and the control it acted on, as a suggestion', h.indexOf('It acted on #get-quote (&quot;Get a quote&quot;). If that is the right control, update this step&#39;s selector to match.') !== -1 ||
     h.indexOf('It acted on #get-quote') !== -1);
  ok('a failed heal shows the saved error and what the agent then tried', /The saved step failed: ID not found: email\. The Test Agent then tried: The agent reported it could not do the step\./.test(h));
  ok('every status has its own label', ['PASSED', 'HEALED', 'FAILED', 'BLOCKED', 'SKIPPED', 'NOT ATTEMPTED', 'STOPPED'].every(function (l) { return h.indexOf('<td>' + l + '</td>') !== -1; }));
  ok('and says how each step was done', h.indexOf('<td>Saved step</td>') !== -1 && h.indexOf('<td>Test Agent (healed)</td>') !== -1 && h.indexOf('<td>Test Agent (prompt)</td>') !== -1);
  ok('the summary counts them', /7 step\(s\) · 1 passed · 1 healed · 0 unverified · 2 failed · 3 not run/.test(h.replace(/&middot;/g, '·')), h.match(/rpt-summary">[^<]*/)[0]);
  ok('it explains what a heal and an unverified step mean', /A HEALED step is a finding/.test(h) && /Delivery is confirmable and intent is not/.test(h));

  var pr = html(mk([
    st(0, 'done-agent-reported', { func: 'agent_prompt', engine: 'agent-prompt', segment: { summary: 'The agent reports it did this: nothing measures what the prompt asked for.' } }),
  ]));
  ok('an agent-reported prompt says nothing measures it, once', (pr.match(/nothing measures what the prompt asked for/g) || []).length === 1, pr.slice(0, 200));
  ok('  and the report explains a prompt is always agent-reported', /a Prompt Function is always AGENT-REPORTED/.test(pr));
  ok('  with no Done-when anywhere in it', !/Done[- ]when/i.test(pr));

  // What a page or a model wrote must not become markup.
  var xs = html(mk([st(0, 'healed', { engine: 'agent-heal', label: '<img src=x onerror=alert(1)>', group: '<b>grp</b>', directError: '<script>1</script>',
    segment: { summary: '<i>said</i>', actions: [{ healTarget: { selector: '#a<script>', text: '"><svg onload=1>' } }] } })]));
  ok('markup in a label, group, error, summary or target is escaped', !/<img|<script|<svg|<b>grp|<i>said/.test(xs), xs.slice(0, 300));
  ok('  and still readable', xs.indexOf('&lt;img src=x') !== -1);

  eq('a skipped entry is a skipped section', rptQueueSection({ mode: 'queue', name: 'Functional Queue', status: 'skipped', reason: 'Not configured.' }).indexOf('SKIPPED') !== -1, true);
  ok('an empty record still renders', html(mk([])).indexOf('0 step(s)') !== -1);
  ok('no secret can be in it: the record holds none, and the table prints only record fields',
     html(mk([st(0, 'passed')])).indexOf('hunter2') === -1);
  ok('the section is registered with the report builder', /funnel: rptFunnelSection, queue: rptQueueSection,/.test(_pu));
})();

(function queueCover() {
  var urls = abPageUrls([{ mode: 'queue', name: 'Functional Queue', status: 'ran', data: {
    startUrl: 'https://shop.example/start',
    steps: [
      { segment: { kind: 'url', to: 'https://shop.example/quote' } },
      { segment: { kind: 'prompt', to: null } },
      { segment: { kind: 'url', to: 'https://shop.example/quote' } },
      { segment: null },
    ] } }]);
  eq('the cover names the page the run started on, then each Navigate target, once', urls.join(','), 'https://shop.example/start,https://shop.example/quote');
  eq('a queue with no URLs adds none', abPageUrls([{ mode: 'queue', status: 'ran', data: { steps: [] } }]).length, 0);
})();

(function funnelAsQueue() {
  var src = slicePopup('function fnOpenAsQueue() {', '\nfunction renderFunnelResults(');
  function build(o) {
    o = o || {};
    var stepsArr = o.steps || [];
    var added = [], first = [], alerts = [], confirms = [], shown = [], accordions = [];
    var list = { innerHTML: 'old' };
    var stubs = {
      steps: stepsArr, nextId: 9, nextGroupId: 9,
      funnelWaypoints: function () { return o.waypoints || []; },
      funnelState: { supplementalPrompt: o.notes || '' },
      alert: function (m) { alerts.push(m); },
      confirm: function (m) { confirms.push(m); return o.confirm !== false; },
      document: { getElementById: function () { return list; } },
      ensureOpenUrlFirst: function (d) { first.push(d); },
      addStep: function (d) { added.push(d); },
      renderGroups: function () {}, persistQueue: function () {},
      showTab: function (n) { shown.push(n); }, openAccordion: function (n) { accordions.push(n); },
    };
    var names = Object.keys(stubs);
    var api = new Function(names.join(','), src + '\nreturn { run: fnOpenAsQueue, steps: function () { return steps; } };')
      .apply(null, names.map(function (n) { return stubs[n]; }));
    return Object.assign(api, { added: added, first: first, alerts: alerts, confirms: confirms, shown: shown, accordions: accordions, list: list });
  }
  var f = build({ waypoints: ['https://shop.example/', 'https://shop.example/cart', 'https://shop.example/checkout'], notes: 'use qa@example.com' });
  f.run();
  eq('the Start becomes the locked Open URL step', f.first[0].inputs.url, 'https://shop.example/');
  eq('  with no params and QA Mode off', JSON.stringify([f.first[0].inputs.params, f.first[0].inputs.qa_mode]), '[[],false]');
  eq('every waypoint after it becomes a Navigate step, in order', f.added.map(function (d) { return d.func + ':' + d.inputs.url; }).join(' '),
     'agent_navigate:https://shop.example/cart agent_navigate:https://shop.example/checkout');
  eq('  carrying the Supplemental Instructions as notes', f.added[0].inputs.notes, 'use qa@example.com');
  eq('  and showing the queue', f.shown.join(',') + '|' + f.accordions.join(','), 'build|acc-queue');
  eq('  with the old list cleared first', f.list.innerHTML.indexOf('No steps yet') !== -1, true);
  eq('an empty queue is replaced without asking', f.confirms.length, 0);
  var g = build({ waypoints: ['https://shop.example/', 'https://shop.example/cart'], steps: [{ func: 'click', locked: false }] });
  g.run();
  eq('a queue with steps in it asks first', g.confirms.length, 1);
  ok('  and says the notes are copied and persist', /copied into each Navigate step's notes/.test(g.confirms[0]), g.confirms[0]);
  var c = build({ waypoints: ['https://shop.example/', 'https://shop.example/cart'], steps: [{ func: 'click', locked: false }], confirm: false });
  c.run();
  eq('declining changes nothing', c.added.length + c.first.length + c.shown.length, 0);
  var n = build({ waypoints: ['https://shop.example/'] });
  n.run();
  ok('fewer than two waypoints is refused, and says why', n.alerts.length === 1 && /Start and an End/.test(n.alerts[0]) && n.first.length === 0, n.alerts);
})();

// ── QA Pass: registration (Step 11) ────────────────────────────────────────
section('QA Pass: registration');
(function () {
  // qapass is a Test Agent mode that runs alone, like the funnel crawl: it is registered in TA_MODES,
  // it parks its settings body in #ta-mode-homes, it is never offered in "Also Run", and the init
  // chain starts it in its own try/catch so a fault there cannot take the Settings and Test Agent
  // bindings with it.
  var els = {};
  var el = function (id) { return els[id] || (els[id] = { textContent: '', disabled: false, style: {}, innerHTML: '', checked: false, value: '' }); };
  var opened = null, qpRec = null;
  var stubs = {
    document: { getElementById: el },
    chrome: { runtime: { sendMessage: function () { return Promise.resolve({ ok: false, error: 'stub' }); } } },
    getActiveContext: function () { return Promise.resolve(null); },
    rptAiSummarySection: function () { return ''; },
    openReportTab: function (sections) { opened = sections; return Promise.resolve(); },
    _taActiveBody: 'qapass', taQueuedExtra: new Set(), _taStopRequested: false,
  };
  Object.keys(stubs).forEach(function (k) { globalThis[k] = stubs[k]; });
  eval(slicePopup('const TA_MODES = {', '\nlet _taActiveBody').replace(/^const TA_MODES/, 'var TA_MODES'));
  var renderSrc = slicePopup('function taRenderMultiList() {', '\n// Sequential batch execution');
  eval(renderSrc);
  eval(slicePopup('async function runTestAgent() {', '\nfunction stopTestAgent('));

  var q = TA_MODES.qapass;
  ok('qapass is registered in TA_MODES', !!q);
  eq('  with its label', q && q.label, 'QA Pass (platform + layout)');
  eq('  parking its body #qp-body', q && q.bodyId, 'qp-body');
  eq('  in #ta-mode-homes', q && q.homeParentId, 'ta-mode-homes');
  eq('  as a standalone mode', q && q.standalone, true);
  eq('  with an onShow that renders the context and the sheet', typeof (q && q.onShow), 'function');
  eq('  always configured (the context is read when it runs)', q && q.isConfigured(), true);
  ok('  its run and getData are functions', q && typeof q.run === 'function' && typeof q.getData === 'function');
  eq('funnel is standalone too', TA_MODES.funnel.standalone, true);
  ok('the numbered modes are not standalone', !TA_MODES['4'].standalone && !TA_MODES['6'].standalone);
  eq('mode keys', Object.keys(TA_MODES).join(), '4,6,funnel,qapass,emailcheck');

  // "Also Run" is never offered for a standalone mode, and a standalone mode is never offered in it.
  var card = el('ta-multi-card'), list = el('ta-multi-list');
  globalThis._taActiveBody = 'qapass'; taQueuedExtra.add('6');
  taRenderMultiList();
  eq('active qapass: the Also Run card is hidden', card.style.display, 'none');
  eq('  the list is emptied', list.innerHTML, '');
  eq('  and anything queued is forgotten', taQueuedExtra.size, 0);
  globalThis._taActiveBody = 'funnel';
  taRenderMultiList();
  eq('active funnel: still hidden (the literal became the flag)', card.style.display, 'none');
  globalThis._taActiveBody = '4';
  taRenderMultiList();
  eq('active WCAG: the card is shown', card.style.display, '');
  ok('  and offers Performance', list.innerHTML.indexOf('data-mode="6"') >= 0, list.innerHTML);
  ok('  but not the funnel crawl', list.innerHTML.indexOf('funnel') < 0);
  ok('  and not QA Pass', list.innerHTML.indexOf('qapass') < 0 && list.innerHTML.indexOf('QA Pass') < 0);
  globalThis._taActiveBody = '6';
  taRenderMultiList();
  ok('active Performance: offers WCAG only', list.innerHTML.indexOf('data-mode="4"') >= 0 && list.innerHTML.indexOf('qapass') < 0 && list.innerHTML.indexOf('funnel') < 0);
  ok('taRenderMultiList no longer names funnel as a mode filter', !/n !== 'funnel'/.test(renderSrc));
  ok('  and asks the flag instead', /\.standalone/.test(renderSrc));
  ok('the whole popup.js has no n !== \'funnel\' left', _pu.indexOf("n !== 'funnel'") < 0);

  // runTestAgent drives it like any other mode: the key stays a string, the record decides ran/failed.
  taQueuedExtra.clear();
  globalThis._taActiveBody = 'qapass';
  TA_MODES.qapass = { label: 'QA Pass (platform + layout)', isConfigured: function () { return true; },
    run: function () { qpRec = { ts: Date.now(), version: 1, checks: [] }; return Promise.resolve({ ok: true }); },
    getData: function () { return qpRec; } };
  var out = { done: false, threw: null };
  runTestAgent().then(function () { out.done = true; }, function (e) { out.threw = e; out.done = true; });
  drainMicrotasks();
  ok('a qapass run settles', out.done && !out.threw, out.threw && String(out.threw));
  eq('  its mode key is the string qapass, not a number', opened && opened.modes[0].mode, 'qapass');
  eq('  recorded as ran', opened && opened.modes[0].status, 'ran');
  eq('  with the record the mode produced', opened && opened.modes[0].data && opened.modes[0].data.version, 1);
  qpRec = null; opened = null;
  TA_MODES.qapass.run = function () { return Promise.resolve({ ok: false, error: 'No active ticket context — set one in the Initialize tab.' }); };
  out = { done: false, threw: null };
  runTestAgent().then(function () { out.done = true; }, function (e) { out.threw = e; out.done = true; });
  drainMicrotasks();
  eq('a qapass run that fails (no context) says so in the status line', el('ta-status').textContent, 'QA Pass (platform + layout) failed: No active ticket context — set one in the Initialize tab.');
  eq('  and no report is opened for it', opened, null);
  Object.keys(stubs).forEach(function (k) { delete globalThis[k]; });

  // Structure: where it is started and what it binds.
  var handler = slicePopup("document.addEventListener('DOMContentLoaded', async () => {", "\n// ── Pin: dock in Chrome's side panel");
  ok('the init chain starts QA Pass in its own try/catch', /try \{\s*await initQaPass\(\);\s*\} catch \(e\) \{\s*console\.error\('Selenite: QA Pass failed to initialize/.test(handler));
  ok('  after the fill targets', handler.indexOf('await initQaPass()') > handler.indexOf('await initFillTargets()'));
  ok('  and before the Settings overlay is bound', handler.indexOf('await initQaPass()') < handler.indexOf("getElementById('settings-overlay')"));
  ok('the only await initQaPass in the handler is the guarded one', handler.split('await initQaPass()').length === 2);
  ok('the Google client id is a credential row (no verify)', /bindCredential\(\{\s*btnId: 'btn-set-google-save', inputId: 'set-google-client',\s*statusId: 'set-google-status', storageKey: 'googleOAuthClientId',\s*\}\);/.test(handler));
  var showSrc = slicePopup('function taShowPrimary() {', '\nfunction taRenderMultiList(');
  ok('taShowPrimary calls onShow, guarded', /if \(typeof mode\.onShow === 'function'\) \{ try \{ mode\.onShow\(\); \} catch \(_\) \{\} \}/.test(showSrc));
  ok('  after the body is parked in the slot', showSrc.indexOf('mode.onShow()') > showSrc.indexOf('slot.appendChild'));
  ok('both panels load qa-pass.js before popup.js', ['popup.html', 'sidepanel.html'].every(function (f) { var h = readFile('../' + f); return h.indexOf('<script src="qa-pass.js"></script>') > 0 && h.indexOf('<script src="qa-pass.js"></script>') < h.indexOf('<script src="popup.js"></script>'); }));
  var VISITOR_NOTE = '<div id="qp-visitor-note" style="font-size:10px;color:var(--warn);margin-bottom:8px">Every PROD, ITW and audience-test load is a new visitor to the live site. When the plain PROD page shows a live experiment, or check B is off, PROD is swept by resizing one tab per device instead of reloading once per width.</div>';
  ok('#5: both panels carry the same fresh-visitor warning once, after the sweep options and before the workarounds', ['popup.html', 'sidepanel.html'].every(function (f) { var h = readFile('../' + f), i = h.indexOf(VISITOR_NOTE); return i > h.indexOf('id="qp-clear-all"') && i < h.indexOf('id="qp-workarounds"') && h.indexOf(VISITOR_NOTE, i + 1) === -1; }));
})();

// ── Test Agent: clicking the tab it is already showing (pre-existing bug, fixed in fix loop 2) ──────────
// showTab('testagent') runs taShowPrimary every time. For a mode whose settings body is reparented into #ta-settings-slot
// (WCAG '4', Performance '6', QA Pass), a second run emptied the slot, which took the body out of the document;
// getElementById(bodyId) then answered null and slot.appendChild(null) threw, so the body was gone until the panel reloaded.
// A small DOM model stands in for the document: a node that is not under the root is not found by getElementById (as in a
// browser), appendChild refuses a non-node, and innerHTML = '' detaches the children.
section('Test Agent: re-showing the tab keeps the mode\'s settings body');
(function () {
  function mkNode(id, kids) {
    var n = { id: id, parent: null, children: [], style: {}, value: '', checked: false, disabled: false, textContent: '', _html: '', moves: 0, htmlSets: 0 };
    n.appendChild = function (c) {   // c.moves counts every detach and attach: a node that stays put has moved 0 times since it was parked
      if (!c || typeof c !== 'object' || !('children' in c)) throw new TypeError("Failed to execute 'appendChild' on 'Node': parameter 1 is not of type 'Node'.");
      if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1);
      c.parent = n; c.moves++; n.children.push(c); return c;
    };
    n.contains = function (c) { for (var p = c; p; p = p.parent) if (p === n) return true; return false; };
    Object.defineProperty(n, 'innerHTML', { get: function () { return n._html; }, set: function (v) { n.htmlSets++; n.children.forEach(function (k) { k.parent = null; k.moves++; }); n.children = []; n._html = String(v); } });
    (kids || []).forEach(function (k) { n.appendChild(k); });
    return n;
  }
  function world() {
    var inputs = {};
    var body = function (id, names) { return mkNode(id, names.map(function (nm) { var i = mkNode(nm); i.checked = true; inputs[nm] = i; return i; })); };
    var b4 = body('tm4-body', ['wcag-a', 'wcag-b']), b6 = body('tm6-body', ['perf-a']), bq = body('qp-body', ['qp-w', 'qp-c']);
    var homes = mkNode('ta-mode-homes', [b4, b6, bq]), slot = mkNode('ta-settings-slot'), sel = mkNode('ta-primary-select');
    var root = mkNode('root', [homes, slot, sel, mkNode('btn-ta-run'), mkNode('ta-agentic-testing'), mkNode('ta-agentic-analysis'), mkNode('ta-multi-card'), mkNode('ta-multi-list')]);
    var doc = { getElementById: function (id) { var hit = null; (function walk(n) { if (hit) return; if (n.id === id) { hit = n; return; } n.children.forEach(walk); })(root); return hit; },
      querySelectorAll: function () { return []; } };
    return { doc: doc, homes: homes, slot: slot, sel: sel, bodies: { '4': b4, '6': b6, 'qapass': bq }, inputs: inputs, root: root };
  }
  var calls = { funnel: 0, onShow: 0, sync: 0 };
  var W = world();
  var stubs = {
    document: W.doc, sessionNS: { set: function () { return Promise.resolve(); } },
    _taActiveBody: null, _taCheckboxPrior: null, taQueuedExtra: new Set(),
    taRenderFunnel: function () { calls.funnel++; }, syncFunnelRunEnabled: function () { calls.sync++; },
    checkForResumableVisualDiff: function () {}, autofillAbSummary: function () {}, syncAbDesignReference: function () {},   // what showTab('abtest') also does
  };
  Object.keys(stubs).forEach(function (k) { globalThis[k] = stubs[k]; });
  eval(slicePopup('const TA_MODES = {', '\nlet _taActiveBody').replace(/^const TA_MODES/, 'var TA_MODES'));
  eval(slicePopup('function showTab(name) {', '\n// ── Test Agent ──'));
  eval(slicePopup('function taMoveBodyHome(n) {', '\nfunction taShowPrimary() {'));
  eval(slicePopup('function taShowPrimary() {', '\nfunction taRenderMultiList('));
  eval(slicePopup('function taRenderMultiList() {', '\n// Sequential batch execution'));
  TA_MODES.qapass.onShow = function () { calls.onShow++; };   // the real one reads the ticket and the sheet
  var tryShow = function (name) { try { showTab(name); return null; } catch (e) { return e; } };
  var inSlot = function (n) { return W.slot.children.indexOf(n) >= 0 && n.parent === W.slot; };
  var atHome = function (n) { return n.parent === W.homes; };

  ['4', '6', 'qapass'].forEach(function (mode) {
    var nm = 'mode ' + mode + ': ';
    var body = W.bodies[mode], names = body.children.map(function (c) { return c.id; });
    W.sel.value = mode;
    var e1 = tryShow('testagent');
    ok(nm + 'the first show does not throw', e1 === null, e1 && String(e1));
    ok(nm + 'the body is in the slot, and is the one that was parked', inSlot(body) && W.doc.getElementById(body.id) === body);
    var onShowBefore = calls.onShow, movesBefore = body.moves, setsBefore = W.slot.htmlSets;
    var e2 = tryShow('testagent'), e3 = tryShow('testagent');
    ok(nm + 'showing it again twice does not throw', e2 === null && e3 === null, [e2 && String(e2), e3 && String(e3)]);
    ok(nm + 'the body is the same node, found by its id, and still inside #ta-settings-slot', W.doc.getElementById(body.id) === body && inSlot(body) && W.slot.contains(body));
    ok(nm + 'the slot holds only that body', W.slot.children.length === 1);
    ok(nm + 'the body was neither detached nor re-appended, and the slot was not rewritten (focus and scroll inside it would be lost)', body.moves === movesBefore && W.slot.htmlSets === setsBefore, [body.moves - movesBefore, W.slot.htmlSets - setsBefore]);
    ok(nm + 'its inputs are intact: the same nodes, in order, still checked', body.children.map(function (c) { return c.id; }).join() === names.join() && body.children.every(function (c) { return W.inputs[c.id] === c && c.checked === true && c.parent === body; }));
    eq(nm + 'the active body is still this mode', globalThis._taActiveBody, mode);
    ok(nm + 'the Run button is enabled', W.doc.getElementById('btn-ta-run').disabled === false);
    if (mode === 'qapass') eq(nm + 'its onShow refresh still ran on each show (the one per-mode refresh)', calls.onShow - onShowBefore, 2);
    // Another mode: the previous body goes home, the new one takes the slot.
    var other = mode === '4' ? '6' : '4';
    W.sel.value = other;
    var e4 = tryShow('testagent');
    ok(nm + 'switching to another mode does not throw', e4 === null, e4 && String(e4));
    ok(nm + 'the previous body is back in #ta-mode-homes, with its inputs', atHome(body) && W.doc.getElementById(body.id) === body && body.children.length === names.length);
    ok(nm + 'and the other mode\'s body is in the slot', inSlot(W.bodies[other]) && W.slot.children.length === 1);
    // Leaving the tab parks the body at home as before.
    var e5 = tryShow('abtest');
    ok(nm + 'leaving the Test Agent tab parks the body at home and clears the active mode', e5 === null && atHome(W.bodies[other]) && globalThis._taActiveBody === null && W.slot.children.length === 0);
    // And coming back after that is a first show again.
    W.sel.value = mode;
    var e6 = tryShow('testagent');
    ok(nm + 'coming back shows it again, intact', e6 === null && inSlot(body) && body.children.every(function (c) { return c.checked; }), e6 && String(e6));
    tryShow('abtest');
  });

  // Funnel behaves as before: it rebuilds the slot itself on every show, and owns no parked body.
  W.sel.value = 'funnel';
  var f0 = calls.funnel;
  var ef1 = tryShow('testagent'), ef2 = tryShow('testagent');
  ok('funnel: two shows do not throw', ef1 === null && ef2 === null, [ef1 && String(ef1), ef2 && String(ef2)]);
  eq('funnel: taRenderFunnel ran on each show, as before', calls.funnel - f0, 2);
  eq('funnel: it is the active mode', globalThis._taActiveBody, 'funnel');
  ok('funnel: every parked body is home', Object.keys(W.bodies).every(function (k) { return atHome(W.bodies[k]); }));
  W.sel.value = '4';
  var ef3 = tryShow('testagent');
  ok('funnel to WCAG: the body comes into the slot, intact', ef3 === null && inSlot(W.bodies['4']) && W.bodies['4'].children.every(function (c) { return c.checked; }), ef3 && String(ef3));
  W.sel.value = 'funnel';
  tryShow('testagent');
  ok('and WCAG to funnel: the body goes home', atHome(W.bodies['4']));
  tryShow('abtest');

  // A body that cannot be found must never throw (appendChild(null)): the slot is emptied and the mode is still active.
  var W2 = world();
  globalThis.document = W2.doc;
  W2.homes.children.splice(W2.homes.children.indexOf(W2.bodies['6']), 1); W2.bodies['6'].parent = null;   // gone from the document
  W2.sel.value = '6';
  var em = tryShow('testagent');
  ok('a missing body: showing the mode does not throw', em === null, em && String(em));
  eq('  the mode is still active', globalThis._taActiveBody, '6');
  eq('  and the slot is empty', W2.slot.children.length, 0);
  var em2 = tryShow('testagent');
  ok('  and showing it again does not throw either', em2 === null, em2 && String(em2));
  tryShow('abtest');

  // Funnel's Discover Path crawl awaits for as long as the crawl takes. A tester can switch to another mode meanwhile, and that
  // mode's body is then in the slot. Rendering the Funnel card on success rewrote the slot's innerHTML, which detached the shown
  // body (pre-existing, found in the final review as N9). The success branch now goes through refreshFunnelDom, which renders
  // only while Funnel is the active mode. The stub below does what the real taRenderFunnel does to the slot: rewrites it whole.
  var W3 = world();
  globalThis.document = W3.doc;
  var inSlot3 = function (n) { return W3.slot.children.indexOf(n) >= 0 && n.parent === W3.slot; };
  var atHome3 = function (n) { return n.parent === W3.homes; };
  var crawl = null, persisted = 0;
  var fnStubs = {
    funnelState: { start: 'https://shop.example/', middles: [], end: 'https://shop.example/thanks', supplementalPrompt: '', crawlMaxPages: 150, crawlMaxDepth: 6 },
    persistFunnel: function () { persisted++; },
    fnCrawlFindPath: function () { return new Promise(function (res) { crawl = res; }); },
    _fnCrawling: false, _fnCrawlStop: false,
    alert: function () { throw new Error('alert called'); }, confirm: function () { throw new Error('confirm called'); },
    taRenderFunnel: function () { calls.funnel++; W3.slot.innerHTML = '<div class="card">Funnel</div>'; },
  };
  Object.keys(fnStubs).forEach(function (k) { globalThis[k] = fnStubs[k]; });
  eval(slicePopup('function fnSetCrawlStatus(text) {', '\nfunction fnStopCrawl() {'));
  eval(slicePopup('async function runFnDiscoverPath() {', '\nfunction taRenderFunnel() {'));
  eval(slicePopup('function refreshFunnelDom() {', '\n// DOM ← mxState'));
  function discover() { var o = { done: false }; runFnDiscoverPath().then(function () { o.done = true; }, function (e) { o.done = true; o.err = e; }); drainMicrotasks(); return o; }
  var found = { found: true, path: ['https://shop.example/', 'https://shop.example/a', 'https://shop.example/b', 'https://shop.example/thanks'], scanned: 5, failed: 0 };

  W3.sel.value = 'funnel'; tryShow('testagent');
  var run1 = discover();
  ok('crawl after a mode switch: the crawl is pending', !run1.done && typeof crawl === 'function' && globalThis._fnCrawling === true);
  W3.sel.value = '4';
  var es = tryShow('testagent');
  ok('  switching to WCAG while it runs puts WCAG\'s body in the slot', es === null && inSlot3(W3.bodies['4']), es && String(es));
  var f1 = calls.funnel, sets1 = W3.slot.htmlSets, moves1 = W3.bodies['4'].moves;
  crawl(found); drainMicrotasks();
  ok('  the crawl finishes without throwing', run1.done && !run1.err, run1.err && String(run1.err));
  ok('  WCAG\'s body is the same node, still in the slot, never detached, the slot not rewritten', W3.doc.getElementById('tm4-body') === W3.bodies['4'] && inSlot3(W3.bodies['4']) && W3.bodies['4'].moves === moves1 && W3.slot.htmlSets === sets1, [W3.bodies['4'].moves - moves1, W3.slot.htmlSets - sets1]);
  ok('  its inputs are intact', W3.bodies['4'].children.length === 2 && W3.bodies['4'].children.every(function (c) { return c.checked && c.parent === W3.bodies['4']; }));
  eq('  the Funnel card was not rendered', calls.funnel - f1, 0);
  eq('  the found path is still saved as the middle waypoints', JSON.stringify(globalThis.funnelState.middles), JSON.stringify(['https://shop.example/a', 'https://shop.example/b']));
  ok('  and persisted, and the crawl is no longer running', persisted === 1 && globalThis._fnCrawling === false);
  W3.sel.value = 'funnel';
  var f2 = calls.funnel;
  tryShow('testagent');
  ok('  switching back to Funnel renders its card (from funnelState) and parks WCAG at home', calls.funnel - f2 === 1 && atHome3(W3.bodies['4']));

  // Funnel still on screen when the crawl ends: the card is rendered with the path, as before.
  globalThis.funnelState.middles = [];
  var run2 = discover();
  var f3 = calls.funnel, s3 = calls.sync;
  crawl(found); drainMicrotasks();
  ok('crawl with Funnel still shown: finishes without throwing', run2.done && !run2.err, run2.err && String(run2.err));
  ok('  the Funnel card is rendered once and the Run button resynced', calls.funnel - f3 === 1 && calls.sync - s3 === 1, [calls.funnel - f3, calls.sync - s3]);
  ok('  every parked body is still home', Object.keys(W3.bodies).every(function (k) { return atHome3(W3.bodies[k]); }));
  var dsp = slicePopup('async function runFnDiscoverPath() {', '\nfunction taRenderFunnel() {');
  ok('runFnDiscoverPath renders through refreshFunnelDom, never taRenderFunnel directly', /refreshFunnelDom\(\);/.test(dsp) && !/taRenderFunnel\(\)/.test(dsp));
  tryShow('abtest');
  Object.keys(fnStubs).forEach(function (k) { delete globalThis[k]; });

  // The call path: a click on a tab runs showTab(dataset.tab); showTab runs taShowPrimary for the Test Agent tab, and nothing else does.
  ok('the tab click handler calls showTab with the tab name', /t\.addEventListener\('click', \(\) => showTab\(t\.dataset\.tab\)\)/.test(_pu));
  ok('showTab is the only caller of taShowPrimary besides the mode selector\'s change handler', (_pu.match(/function taShowPrimary\(\)/g) || []).length === 1 && (_pu.match(/taShowPrimary\(\)/g) || []).length === 2 && /getElementById\('ta-primary-select'\)\.addEventListener\('change', taShowPrimary\)/.test(_pu) && /if \(name === 'testagent'\) \{\s*taShowPrimary\(\);/.test(_pu));
  var tsp = slicePopup('function taShowPrimary() {', '\nfunction taRenderMultiList(');
  ok('taShowPrimary keeps a body that is in the slot (no clear, no re-append) and guards the append', /if \(!\(body && slot\.contains\(body\)\)\) \{\s*slot\.innerHTML = '';/.test(tsp) && /if \(body\) slot\.appendChild\(body\);/.test(tsp) && tsp.indexOf('slot.appendChild(document.getElementById') < 0);
  Object.keys(stubs).forEach(function (k) { delete globalThis[k]; });
})();

// ── QA Pass: panel (Step 12) ────────────────────────────────────────────────
section('QA Pass: panel');
(function () {
  function jeq(name, actual, expected) { var a = JSON.stringify(actual), e = JSON.stringify(expected); ok(name, a === e, { actual: a, expected: e }); }
  // The panel code of the mode, sliced out of popup.js and run against stubs: the worker is a scripted
  // sendMessage, the DOM is a table of plain objects, storage is two maps. Nothing here talks to a browser.
  var els = {}, nodes = {};
  function mkEl(id) {
    var listeners = {};
    return { id: id, textContent: '', innerHTML: '', value: '', checked: false, disabled: false, style: {},
      addEventListener: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }, listeners: listeners,
      closest: function () { return null; } };
  }
  function el(id) { return els[id] || (els[id] = mkEl(id)); }
  var sent = [], replies = {}, store = { local: {}, sync: {} }, sessionSets = [], sessionGets = {}, confirmAnswer = true, confirms = [], clipboard = [];
  function area(name) {
    return {
      get: function (keys) {
        var o = {};
        (typeof keys === 'string' ? [keys] : keys).forEach(function (k) { if (k in store[name]) o[k] = store[name][k]; });
        return Promise.resolve(o);
      },
      set: function (o) { Object.assign(store[name], JSON.parse(JSON.stringify(o))); return Promise.resolve(); },
    };
  }
  var ctx = null;
  var stubs = {
    document: { getElementById: function (id) { return nodes[id] === null ? null : el(id); }, querySelector: function (sel) { return nodes[sel] || null; } },
    chrome: { runtime: { sendMessage: function (msg) {
        sent.push(msg);
        var r = replies[msg.action];
        return Promise.resolve(typeof r === 'function' ? r(msg) : r);
      } },
      storage: { local: area('local'), sync: area('sync') },
      identity: { getRedirectURL: function () { return 'https://abc.chromiumapp.org/'; } } },
    navigator: { clipboard: { writeText: function (t) { clipboard.push(t); return Promise.resolve(); } } },
    getActiveContext: function () { return Promise.resolve(ctx); },
    sessionNS: { get: function (k) { var o = {}; if (k in sessionGets) o[k] = sessionGets[k]; return Promise.resolve(o); }, set: function (o) { sessionSets.push(o); return Promise.resolve(); } },
    WIN_ID: 7, _taStopRequested: false,
    setInterval: function () { return 1; }, clearInterval: function () {},
    confirm: function (m) { confirms.push(m); return confirmAnswer; },
    _qpLastRun: null,
  };
  Object.keys(stubs).forEach(function (k) { globalThis[k] = stubs[k]; });
  function settle(p) {
    var o = { done: false, v: undefined, err: undefined };
    p.then(function (v) { o.done = true; o.v = v; }, function (e) { o.done = true; o.err = e; });
    drainMicrotasks();
    return o;
  }
  function reset() {
    sent.length = 0; replies = {}; store.local = {}; store.sync = {}; sessionSets.length = 0; sessionGets = {}; confirms.length = 0; clipboard.length = 0;
    els = {}; nodes = {}; globalThis._qpLastRun = null; globalThis._taStopRequested = false; confirmAnswer = true;
  }
  var wctx = function (over) {
    return Object.assign({ reviewed: true, ticketKey: 'QP-1', experimentId: '9001', platform: 'Optimizely', summary: 'Hero test',
      variants: [{ id: 'v0', isControl: true, rawDescription: 'Control' }, { id: 'v1', isControl: false, rawDescription: 'Hero line' }],
      previewLinks: [{ id: 'v0', url: 'https://shop.example/p?optimizely_x=1' }, { id: 'v1', url: 'https://shop.example/p?optimizely_x=2&optimizely_force_tracking=true' }],
      itwLink: 'https://shop.example/p?cro_mode=qa', goals: [{ text: 'Hero CTA click' }], softcodedTests: [], concurrentTests: [],
      comments: [{ id: '10001', created: '2026-10-14T10:00:00.000-0400', text: 'Timer set on purpose' }],
      qaTestPlanUrl: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=5' }, over || {});
  };
  function mkc(id, status, note, blockedBy) {
    return { id: id, group: id.charAt(0), title: id, status: status, severity: null, note: note, alsoOnProd: false, blockedBy: blockedBy || null, evidence: { loads: [], widths: [] } };
  }
  function wrec(over) {
    return Object.assign({ version: 1, ts: null, startedAt: 1000, finishedAt: 2000, stopped: false, error: null, ticketKey: 'QP-1', experimentId: '9001',
      settings: {}, platform: 'optimizely', loads: [{ id: 'L1', role: 'preview', label: 'v0', path: 'https://shop.example/p', ok: true }], links: [], catalog: null, catalogFrom: null,
      controlVsProd: null, combos: [], audiences: null, sweep: { plan: { targets: [], profiles: [], widths: [] }, rows: [], tiles: [] },
      checks: [mkc('E.v1.1', 'failed', 'hero clipped'), mkc('B.control-prod', 'passed', 'matches'), mkc('A.v1', 'passed', 'served')],
      notTested: [], explain: null, sheet: null, abReport: null }, over || {});
  }

  // ── runQaPassMode (the plan's five cases) ──
  var runSrc = slicePopup('async function runQaPassMode() {', '\nasync function qpUiPrepareSheet(');
  var rendered = [], prepared = [], abAsked = [];
  var runStubs = {
    qpUiReadSettings: function () { return { checks: { A: true, B: true, C: true, D: true, E: true, F: true }, widths: [375], quickSweep: false, prodMobile: true, combos: true, clearAllSiteData: false, workarounds: 'secret handoff text' }; },
    qpUiRenderResults: function (r) { rendered.push(r); },
    qpUiLastAbReport: function (k) { abAsked.push(k); return Promise.resolve(null); },
    qpUiPrepareSheet: function (r, c, on) { prepared.push(on); return Promise.resolve({ connected: false, reason: 'no-test-plan-link', paste: [] }); },
    qpUiSlim: function (r) { return JSON.parse(JSON.stringify(r)); },
    qpUiEl: function (id) { return el(id); },
  };
  Object.keys(runStubs).forEach(function (k) { globalThis[k] = runStubs[k]; });
  eval(runSrc);
  function runMode() { return settle(runQaPassMode()); }

  reset(); ctx = null;
  var r1 = runMode();
  jeq('(a) no context: ok false with the Initialize wording', r1.v, { ok: false, error: 'No active ticket context — set one in the Initialize tab.' });
  eq('(a) and no message was sent', sent.length, 0);
  ok('(a) the error is shown in the results box', /No active ticket context/.test(el('qp-results').innerHTML));
  reset(); ctx = wctx({ previewLinks: [] });
  eq('(a) a context with no preview links says so', runMode().v.error, 'The active ticket context has no preview links.');

  reset(); ctx = wctx(); replies.runQaPass = { ok: true, record: wrec({ version: undefined }) };
  var r2 = runMode();
  eq('(b) a worker record without a version: the reload wording', r2.v && r2.v.error, 'The service worker is older than this panel — reload Selenite in chrome://extensions and run again.');
  ok('(b) nothing was explained, prepared or stored', sent.length === 1 && prepared.length === 0 && globalThis._qpLastRun === null);
  reset(); ctx = wctx(); replies.runQaPass = { ok: false, error: 'Boom' };
  eq('a worker error is passed through', runMode().v.error, 'Boom');
  // Fix loop 1, #7a: a worker that has no runQaPass (the panel is newer than its worker) never answers, and Chrome REJECTS the
  // message. That used to reach the tester as "The message port closed before a response was received." Chrome rejects the same
  // way when it stops the worker mid-run, so the rejection has its own sentence naming both causes (the follow-up run's #7a).
  var STALE = 'The service worker is older than this panel — reload Selenite in chrome://extensions and run again.';
  var NO_ANSWER = 'The service worker did not answer the run: it is older than this panel, or Chrome stopped it mid-run. Reload Selenite in chrome://extensions and run again.';
  ['The message port closed before a response was received.', 'Could not establish connection. Receiving end does not exist.', 'receiving end does not exist', 'THE MESSAGE PORT CLOSED BEFORE A RESPONSE WAS RECEIVED.'].forEach(function (m) {
    reset(); ctx = wctx(); replies.runQaPass = function () { return Promise.reject(new Error(m)); };
    prepared.length = 0;
    var rj = runMode();
    jeq('a rejected runQaPass (' + m.slice(0, 40) + '): ok false with the did-not-answer wording', rj.v, { ok: false, error: NO_ANSWER });
    ok('  nothing was explained, prepared or stored, and the run did not throw', rj.err === undefined && sent.length === 1 && prepared.length === 0 && globalThis._qpLastRun === null);
  });
  reset(); ctx = wctx(); replies.runQaPass = function () { throw new Error('The message port closed before a response was received.'); };
  jeq('a synchronous throw of the same error gets the same wording', runMode().v, { ok: false, error: NO_ANSWER });
  reset(); ctx = wctx(); replies.runQaPass = function () { return Promise.reject(new Error('Extension context invalidated.')); };
  jeq('any other rejection keeps its own message', runMode().v, { ok: false, error: 'Extension context invalidated.' });
  reset(); ctx = wctx(); replies.runQaPass = function () { return Promise.reject('plain string'); };
  jeq('and a rejection that is not an Error is reported as text', runMode().v, { ok: false, error: 'plain string' });
  reset(); ctx = wctx(); replies.runQaPass = function () { return Promise.reject(new Error('The message port closed before a response was received.')); };
  rendered.length = 0; var rjNo = runMode();
  ok('a rejected run renders no results and stores no record', rendered.length === 0 && sessionSets.every(function (o) { return !o.qpLastRun; }) && (rjNo.v || {}).ok === false);
  var runFnSrc = slicePopup('async function runQaPassMode() {', '\nasync function qpUiPrepareSheet(');
  ok('each sentence is written once: STALE_WORKER for a record of another version, NO_ANSWER for a message nobody answered', runFnSrc.split(STALE).length - 1 === 1 && runFnSrc.split(NO_ANSWER).length - 1 === 1 && runFnSrc.split('STALE_WORKER').length - 1 === 2 && runFnSrc.split('NO_ANSWER').length - 1 === 2, [runFnSrc.split('STALE_WORKER').length - 1, runFnSrc.split('NO_ANSWER').length - 1]);
  reset(); ctx = wctx(); replies.runQaPass = { ok: true, record: wrec({ error: 'The debugger was detached', loads: [] }) };
  eq('a record with an error and no loads is a failed run', runMode().v.error, 'The debugger was detached');
  reset(); ctx = wctx(); replies.runQaPass = { ok: true, record: wrec({ error: 'The debugger was detached' }) };
  ok('a record with an error and some loads still produces results', runMode().v.ok === true && globalThis._qpLastRun && globalThis._qpLastRun.error === 'The debugger was detached');

  reset(); ctx = wctx(); el('ta-agentic-analysis').checked = true; prepared.length = 0;
  replies.runQaPass = { ok: true, record: wrec({ stopped: true }) };
  var t0 = Date.now(); rendered.length = 0;
  var r3 = runMode();
  eq('(c) a stopped run is ok', r3.v && r3.v.ok, true);
  ok('(c) its record is stamped (ts >= the start)', globalThis._qpLastRun && globalThis._qpLastRun.ts >= t0, globalThis._qpLastRun && globalThis._qpLastRun.ts);
  ok('(c) no qpExplain message with a stopped record, even with Analysis on', sent.every(function (m) { return m.action !== 'qpExplain'; }), sent.map(function (m) { return m.action; }));
  eq('(c) explain is null', globalThis._qpLastRun.explain, null);
  eq('(c) the sheet step still ran, told analysis was on', prepared.join(), 'true');
  ok('(c) results were rendered and the slim record stored in the session', rendered.length === 1 && sessionSets.some(function (o) { return o.qpLastRun && o.qpLastRun.version === 1; }));

  reset(); ctx = wctx(); el('ta-agentic-analysis').checked = false;
  replies.runQaPass = { ok: true, record: wrec() };
  runMode();
  ok('(d) Analysis unchecked: no qpExplain message', sent.every(function (m) { return m.action !== 'qpExplain'; }));
  eq('(d) explain is null', globalThis._qpLastRun.explain, null);
  eq('the ticket key is passed to the A/B report lookup', abAsked.slice(-1)[0], 'QP-1');

  reset(); ctx = wctx(); el('ta-agentic-analysis').checked = true;
  replies.runQaPass = { ok: true, record: wrec() };
  replies.qpExplain = { ok: true, explain: { ok: true, bugs: [], pgmQuestions: [], noise: [], commentChecks: [], dropped: 0 } };
  runMode();
  var explainMsg = sent.filter(function (m) { return m.action === 'qpExplain'; })[0];
  ok('Analysis on: the explain message carries the checks, the comments and the workarounds', explainMsg && explainMsg.payload.checks.length === 3 && explainMsg.payload.comments.length === 1 && explainMsg.payload.workarounds === 'secret handoff text', explainMsg);
  eq('the explain result is kept on the record', globalThis._qpLastRun.explain.ok, true);
  reset(); ctx = wctx(); el('ta-agentic-analysis').checked = true;
  replies.runQaPass = { ok: true, record: wrec() }; replies.qpExplain = { ok: false, error: 'No API key configured' };
  runMode();
  jeq('a failed explain is recorded as {ok:false,error}', globalThis._qpLastRun.explain, { ok: false, error: 'No API key configured' });
  reset(); ctx = wctx(); el('ta-agentic-analysis').checked = true; globalThis._taStopRequested = true;
  replies.runQaPass = { ok: true, record: wrec() };
  runMode();
  ok('the Test Agent Stop flag also skips the explain', sent.every(function (m) { return m.action !== 'qpExplain'; }));

  reset(); ctx = wctx();
  replies.runQaPass = { ok: true, record: wrec() };
  runMode();
  var runMsg = sent.filter(function (m) { return m.action === 'runQaPass'; })[0];
  ok('(e) the payload sent to runQaPass has no workarounds text', runMsg && runMsg.payload.settings.workarounds === undefined && JSON.stringify(runMsg.payload).indexOf('secret handoff') < 0, runMsg);
  eq('(e) only its length', runMsg.payload.settings.workaroundsLength, 'secret handoff text'.length);
  ok('(e) and no comments, no summary', runMsg.payload.ctx.comments === undefined && JSON.stringify(runMsg.payload).indexOf('Timer set on purpose') < 0 && runMsg.payload.ctx.summary === undefined);
  jeq('the worker context has exactly the nine keys', Object.keys(runMsg.payload.ctx).sort(), ['concurrentTests', 'controlId', 'experimentId', 'goals', 'itwLink', 'platform', 'previewLinks', 'softcodedTests', 'ticketKey']);
  eq('the window id rides along', runMsg.payload.winId, 7);
  ok('the settings carry the checks and widths', runMsg.payload.settings.checks.E === true && runMsg.payload.settings.widths.join() === '375');
  Object.keys(runStubs).forEach(function (k) { delete globalThis[k]; });

  // ── the whole section, for everything else ──
  var secSrc = slicePopup('let _qpLastRun = null;', '\nfunction taMoveBodyHome(n) {').replace(/^let _qpLastRun = null;/, 'var _qpLastRun = null;');
  var abKeys = [], abRecs = {}, idbFails = false;
  var idbStubs = {
    idb: function () { if (idbFails) return Promise.reject(new Error('no idb')); return Promise.resolve({ transaction: function () { return { objectStore: function () { return { getAllKeys: function () { return abKeys.slice(); } }; } }; } }); },
    idbReq: function (x) { return Promise.resolve(x); },
    idbGet: function (s, k) { return Promise.resolve(abRecs[k]); },
  };
  Object.keys(idbStubs).forEach(function (k) { globalThis[k] = idbStubs[k]; });
  delete globalThis._qpLastRun;
  eval(secSrc);

  // settings
  reset(); delete globalThis._qpLastRun; _qpLastRun = null;
  var boxes = {};
  ['A', 'B', 'C', 'D', 'E', 'F'].forEach(function (g) { boxes[g] = { value: g, checked: g !== 'D' }; nodes['#qp-body .qp-check[value="' + g + '"]'] = boxes[g]; });
  el('qp-widths').value = '375, 1280 50 9999 375'; el('qp-quick-sweep').checked = true; el('qp-prod-mobile').checked = false; el('qp-combos').checked = true;
  el('qp-clear-all').checked = false; el('qp-workarounds').value = 'note';
  var rs = qpUiReadSettings();
  jeq('settings: checks read from the boxes', rs.checks, { A: true, B: true, C: true, D: false, E: true, F: true });
  jeq('settings: widths parsed (200-3000, deduped, ascending)', rs.widths, [375, 1280]);
  jeq('settings: the toggles', [rs.quickSweep, rs.prodMobile, rs.combos, rs.clearAllSiteData, rs.workarounds], [true, false, true, false, 'note']);
  qpUiSaveSettings(); drainMicrotasks();
  eq('settings are persisted to storage.local qpSettings (raw widths text kept)', store.local.qpSettings && store.local.qpSettings.widthsText, '375, 1280 50 9999 375');
  boxes.D.checked = true; boxes.A.checked = false; el('qp-widths').value = ''; el('qp-prod-mobile').checked = true;
  qpUiApplySettings(store.local.qpSettings);
  ok('settings: applied back onto the boxes', boxes.D.checked === false && boxes.A.checked === true && el('qp-widths').value === '375, 1280 50 9999 375' && el('qp-prod-mobile').checked === false);
  nodes = {};
  eq('settings: with no boxes the groups default on', qpUiReadSettings().checks.D, true);

  // context line
  reset(); ctx = wctx();
  settle(qpUiRenderCtx());
  eq('the context line', el('qp-ctx').textContent, 'QP-1 · 2 preview link(s) · ITW yes · experiment 9001 · test plan: Google Sheet · 1 comment(s)');
  ctx = wctx({ itwLink: null, experimentId: null, qaTestPlanUrl: 'https://drive.google.com/file/d/abc/view', comments: undefined });
  settle(qpUiRenderCtx());
  eq('the context line for a bare ticket', el('qp-ctx').textContent, 'QP-1 · 2 preview link(s) · ITW no · experiment none · test plan: other link · 0 comment(s)');
  ctx = null; settle(qpUiRenderCtx());
  eq('no context: the validation error', el('qp-ctx').textContent, 'No active ticket context — set one in the Initialize tab.');

  // the last A/B report
  reset();
  abKeys = ['r_100', 'r_300', 'r_200'];
  var probs = []; for (var pi = 0; pi < 12; pi++) probs.push({ severity: 'warn', where: 'w' + pi, detail: new Array(400).join('x') });
  abRecs = { r_300: { debugLog: { run: { modes: [{ mode: 4 }] }, designReference: { ticketContext: { ticketKey: 'QP-1' } } } },
    r_200: { debugLog: { generatedAt: '2026-10-14T10:00:00.000Z', run: { modes: [{ mode: 2 }] }, designReference: { ticketContext: { ticketKey: 'QP-1' } }, problems: probs } },
    r_100: { debugLog: { run: { modes: [{ mode: 2 }] }, designReference: { ticketContext: { ticketKey: 'OTHER-9' } }, problems: [] } } };
  var ab = settle(qpUiLastAbReport('QP-1')).v;
  eq('the newest A/B report of this ticket is found (r_300 is not A/B, r_100 is another ticket)', ab && ab.id, 'r_200');
  eq('its date is kept as ms', ab && ab.generatedAt, Date.parse('2026-10-14T10:00:00.000Z'));
  eq('only the first 8 problems', ab && ab.problems.length, 8);
  ok('each problem detail is cut at 200', ab && ab.problems[0].detail.length === 200);
  eq('another ticket has no report', settle(qpUiLastAbReport('NOPE-1')).v, null);
  idbFails = true;
  eq('any failure is null, not a throw', settle(qpUiLastAbReport('QP-1')).v, null);
  idbFails = false;

  // the sheet
  var PLAN = [['Case', 'Windows Chrome', 'Android Chrome', 'Notes'], ['Hero text is not cut off on mobile', 'Backlog', '', ''], ['Control matches PROD', 'Backlog', '', ''], ['Screenshots attached', 'Backlog', '', '']];
  var VT = [['Status'], ['Backlog'], ['In Progress'], ['Passed'], ['Failed'], ['Blocked'], ['Excluded']];
  function prep(record, c, analysisOn, setup) {
    reset(); if (setup) setup();
    return settle(qpUiPrepareSheet(record, c, analysisOn)).v;
  }
  function googleOk() {
    replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: true };
    replies.qpSheetRead = { ok: true, values: PLAN, valuesTab: VT, readAt: 5, tabs: [] };
    el('qp-sheet-tab').value = 'QA Pass 1'; el('qp-write-notes').checked = true;
    el('qp-sheet-col').disabled = true;   // not populated yet, as in the markup: the default column applies
  }
  var recA = wrec();
  var sA = prep(recA, wctx({ qaTestPlanUrl: null }), true);
  eq('no test plan link: its reason', sA.reason, 'no-test-plan-link');
  ok('  and the paste table is there anyway (3 checks, none not-tested)', sA.paste.length === 3 && sA.connected === false && sA.proposal === null);
  eq('a Drive file is not a Google Sheet', prep(recA, wctx({ qaTestPlanUrl: 'https://drive.google.com/file/d/abc/view' }), true).reason, 'not-a-google-sheet-link');
  eq('no client id', prep(recA, wctx(), true, function () { replies.qpGoogleStatus = { ok: true, clientIdSet: false, connected: false }; }).reason, 'no-client-id');
  eq('not connected', prep(recA, wctx(), true, function () { replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: false }; }).reason, 'not-connected');
  var sNT = prep(recA, wctx(), true, function () { googleOk(); el('qp-sheet-tab').value = ''; });
  eq('no tab picked', sNT.reason, 'no-tab-picked');
  ok('  and nothing was read from the sheet', sent.every(function (m) { return m.action !== 'qpSheetRead'; }));
  var sRF = prep(recA, wctx(), true, function () { googleOk(); replies.qpSheetRead = { ok: false, error: 'The sheet has no tab titled "X".' }; });
  jeq('a failed read is an error, not connected', [sRF.connected, sRF.error], [false, 'The sheet has no tab titled "X".']);
  var sNH = prep(recA, wctx(), true, function () { googleOk(); replies.qpSheetRead = { ok: true, values: [['a', 'b']], valuesTab: null, readAt: 1 }; });
  eq('a sheet with no header row is an error', sNH.error, 'No header row with browser columns in the first 15 rows');
  var sOK = prep(recA, wctx(), true, function () { googleOk(); replies.qpMapRows = { ok: true, mappings: [{ row: 2, checkIds: ['E.v1.1'] }, { row: 3, checkIds: ['B.control-prod'] }] }; });
  ok('connected: the model, status column and vocabulary are filled', sOK.connected === true && sOK.model.headerRow === 1 && sOK.vocab.Passed === 'Passed' && sOK.readAt === 5);
  jeq('the default status column is Windows Chrome (letter B), never Android Chrome', sOK.statusCol, { col: 1, header: 'Windows Chrome', letter: 'B' });
  eq('the mapping came from Opus', sOK.mappingSource, 'opus');
  eq('two entries in the proposal', sOK.proposal.entries.length, 2);
  var wr = qpWritesFromProposal(sOK);
  ok('every write is on column B or the Notes column D', wr.length === 3 && wr.every(function (w) { return /^(B|D)\d+$/.test(w.a1); }), wr.map(function (w) { return w.a1; }));
  ok('the Screenshots row is skipped by rule', sOK.proposal.skippedByRule.length === 1 && sOK.proposal.skippedByRule[0].row === 4);
  eq('paste rows ride along', sOK.paste.length, 3);
  eq('the mapping request carried the rows and checks', sent.filter(function (m) { return m.action === 'qpMapRows'; })[0].payload.checks.length, 3);
  var sNA = prep(recA, wctx(), false, function () { googleOk(); });
  ok('Analysis off: no mapping call, source none, an empty proposal and the Backlog rows as coverage', sent.every(function (m) { return m.action !== 'qpMapRows'; }) && sNA.mappingSource === 'none' && sNA.proposal.entries.length === 0 && sNA.proposal.unmapped.length === 2);
  var sST = prep(wrec({ stopped: true }), wctx(), true, function () { googleOk(); });
  ok('a stopped record is not mapped', sent.every(function (m) { return m.action !== 'qpMapRows'; }) && sST.mappingSource === 'none');
  var sMF = prep(recA, wctx(), true, function () { googleOk(); replies.qpMapRows = { ok: false, error: 'No API key configured' }; });
  ok('a failed mapping keeps its error and still gives a (hand-mappable) proposal', sMF.mapError === 'No API key configured' && !!sMF.proposal && sMF.mappingSource === 'none');
  var sNo = prep(recA, wctx(), false, function () { googleOk(); el('qp-sheet-col').disabled = false; el('qp-sheet-col').value = ''; });
  eq('an enabled status picker left on "don\'t write statuses" means no status column', sNo.statusCol, null);
  var sAn = prep(recA, wctx(), false, function () { googleOk(); el('qp-sheet-col').disabled = false; el('qp-sheet-col').value = 'Android Chrome'; });
  eq('a picked column that is not desktop Chrome falls back to the default', sAn.statusCol.header, 'Windows Chrome');
  var sNN = prep(recA, wctx(), true, function () { googleOk(); el('qp-write-notes').checked = false; replies.qpMapRows = { ok: true, mappings: [{ row: 2, checkIds: ['E.v1.1'] }] }; });
  ok('notes off: the writes are status only', qpWritesFromProposal(sNN).every(function (w) { return /^B\d+$/.test(w.a1); }) && sNN.notesOn === false);
  var sThrow = prep(recA, wctx(), true, function () { googleOk(); replies.qpSheetRead = function () { throw new Error('kaboom'); }; });
  ok('a throw inside is an error on the sheet, never a rejection', typeof sThrow.error === 'string' && /kaboom/.test(sThrow.error) && sThrow.paste.length === 3);

  // rendering
  reset(); globalThis._qpLastRun = null; _qpLastRun = null;
  var recR = wrec({ sheet: sOK }); recR.sheet.proposal.entries.forEach(function (e) { e.include = e.include; });
  qpUiRenderResults(recR);
  var html = el('qp-results').innerHTML;
  ok('the badge', html.indexOf('ISSUES FOUND') >= 0);
  ok('the counts line', /1 failed · 2 passed · 0 in progress · 0 blocked · 0 not tested/.test(html), html.slice(0, 600));
  ok('the failed check and its note', /<b>E\.v1\.1<\/b> — hero clipped/.test(html));
  ok('the proposal editor has a row select and an include box', /data-qp-row="2"/.test(html) && /data-qp-include="2"/.test(html));
  ok('the Apply button names the tab and the cell count', html.indexOf('Apply ' + qpWritesFromProposal(sOK).length + ' change(s) to "QA Pass 1"') > 0, html.match(/Apply [^<]*/));
  ok('an apply status line exists', /id="qp-apply-status"/.test(html));
  var recNC = wrec({ sheet: Object.assign({}, sOK, { connected: false, reason: 'not-connected', proposal: null }) });
  qpUiRenderResults(recNC);
  html = el('qp-results').innerHTML;
  ok('not connected: the reason line and the paste table, no editor, no Apply', /Google is not connected/.test(html) && /Auto QA \(/.test(html) && html.indexOf('<select') < 0 && html.indexOf('btn-qp-apply') < 0, html.slice(0, 300));
  qpUiRenderResults(wrec({ sheet: Object.assign({}, sOK, { connected: false, error: 'boom <b>', proposal: null }) }));
  ok('a read error is shown escaped', /could not be read: boom &lt;b&gt;/.test(el('qp-results').innerHTML));
  qpUiRenderResults(wrec({ stopped: true, checks: [mkc('A.v1', 'not-tested', 'Stopped by the tester before this check ran')], sheet: null }));
  ok('a stopped run reads INCOMPLETE', /INCOMPLETE/.test(el('qp-results').innerHTML) && /· stopped/.test(el('qp-results').innerHTML));
  var recApplied = wrec({ sheet: Object.assign({}, skCopyPlain(sOK), { applied: { at: 1, ok: true, written: 3, verified: 3, dropped: [{ a1: 'B2' }], mismatches: [], foreign: [] } }) });
  qpUiRenderResults(recApplied);
  html = el('qp-results').innerHTML;
  ok('after a successful apply the editor is read-only and the button is gone', html.indexOf('<select') < 0 && html.indexOf('btn-qp-apply') < 0);
  eq('and the outcome is written out', el('qp-apply-status').textContent, 'Wrote 3 cell(s), verified 3. Left alone, changed since read: B2.');
  qpUiRenderResults(wrec({ sheet: Object.assign({}, skCopyPlain(sOK), { applied: { at: 1, ok: false, error: 'Nothing was written: boom', needsConnect: true } }) }));
  ok('after a FAILED apply the editor stays open and the button stays (a refused write can be retried)', el('qp-results').innerHTML.indexOf('btn-qp-apply') > 0 && el('qp-results').innerHTML.indexOf('<select') > 0);
  ok('  and the error is shown', /Not written: Nothing was written: boom \(use Connect Google, then Apply again\)/.test(el('qp-apply-status').textContent));
  function skCopyPlain(x) { return JSON.parse(JSON.stringify(x)); }
  // N5: a record restored from chrome.storage.session, or answered by an older worker, can hold a raw note or run error.
  var UE_PANEL = 'Cannot access contents of url "https://shop.example/p?optimizely_x=2&optimizely_force_tracking=true&optimizely_token=SECRET". Extension manifest must request permission to access this host.';
  qpUiRenderResults(wrec({ error: UE_PANEL, checks: [mkc('E.v1.1', 'failed', 'hero clipped (' + UE_PANEL + ')')], sheet: null }));
  var rawBox = el('qp-results').innerHTML;
  ok('N5: the results box prints no forcing text from a raw note or run error', !/optimizely_|SECRET/.test(rawBox), (rawBox.match(/.{40}(optimizely_|SECRET).{40}/) || [])[0]);
  eq('N5: and still shows the cleaned run error and the cleaned note', (rawBox.match(/Cannot access contents of url &quot;https:\/\/shop\.example\/p&quot;/g) || []).length, 2);

  // the editor
  reset(); _qpLastRun = null;
  var recE = wrec({ sheet: skCopyPlain(sOK) });
  _qpLastRun = recE;
  function selEv(row, value) { return { target: { matches: function (s) { return s === 'select[data-qp-row]'; }, getAttribute: function () { return String(row); }, value: value } }; }
  function incEv(row, checked) { return { target: { matches: function (s) { return s === 'input[data-qp-include]'; }, getAttribute: function () { return String(row); }, checked: checked } }; }
  var before = recE.sheet.proposal.entries.filter(function (e) { return e.row === 2; })[0];
  eq('row 2 starts as failed', before.derived, 'failed');
  qpUiOnResultsChange(selEv(2, 'B.control-prod'));
  var after = recE.sheet.proposal.entries.filter(function (e) { return e.row === 2; })[0];
  eq('re-mapping row 2 to a passing check makes it passed', after.derived, 'passed');
  ok('the mapping list follows', recE.sheet.mapping.filter(function (m) { return m.row === 2; })[0].checkIds.join() === 'B.control-prod');
  ok('the Apply count follows (a passed row has no note)', el('qp-results').innerHTML.indexOf('Apply ' + qpWritesFromProposal(recE.sheet).length + ' change(s)') > 0);
  qpUiOnResultsChange(selEv(2, ''));
  eq('"leave untouched" leaves the row with no result', recE.sheet.proposal.entries.filter(function (e) { return e.row === 2; })[0].derived, null);
  qpUiOnResultsChange(selEv(2, 'E.v1.1'));
  qpUiOnResultsChange(incEv(3, false));
  eq('unticking a row excludes it', recE.sheet.proposal.entries.filter(function (e) { return e.row === 3; })[0].include, false);
  eq('and the writes lose its cell', qpWritesFromProposal(recE.sheet).filter(function (w) { return w.row === 3; }).length, 0);
  eq('the stored count follows', recE.sheet.proposal.counts.statusWrites, qpWritesFromProposal(recE.sheet).filter(function (w) { return /^B/.test(w.a1); }).length);
  ok('every edit persists the slim record to the session', sessionSets.length >= 4);
  qpUiOnResultsChange({ target: { matches: function () { return false; } } });
  qpUiOnResultsChange(selEv(99, 'E.v1.1'));
  eq('a row that is not in the sheet changes nothing', recE.sheet.proposal.entries.filter(function (e) { return e.row === 99; }).length, 0);
  recE.sheet.applied = { ok: true }; var nBefore = sessionSets.length;
  qpUiOnResultsChange(incEv(2, false));
  eq('after a successful apply the editor ignores changes', sessionSets.length, nBefore);

  // apply
  reset(); _qpLastRun = null;
  var recP = wrec({ sheet: skCopyPlain(sOK) });
  _qpLastRun = recP;
  var nWrites = qpWritesFromProposal(recP.sheet).length;
  confirmAnswer = false;
  settle(qpUiApply());
  ok('a cancelled confirm sends nothing and changes nothing', sent.length === 0 && !recP.sheet.applied && /Write 3 cell\(s\) to the tab "QA Pass 1" of the QA test plan\?/.test(confirms[0]) && /anything changed since is left alone/.test(confirms[0]), confirms[0]);
  confirmAnswer = true;
  replies.qpSheetApply = { ok: true, written: 2, verified: 2, dropped: [{ a1: 'B2', expected: 'Backlog', found: 'Passed', reason: 'changed since read' }, { a1: 'D2', expected: '', found: 'x', reason: 'changed since read' }], mismatches: [], foreign: [], updatedCells: 2 };
  settle(qpUiApply());
  var am = sent.filter(function (m) { return m.action === 'qpSheetApply'; })[0];
  ok('the apply message carries the sheet, the tab, the text columns and exactly the proposed writes', am && am.payload.spreadsheetId === sOK.spreadsheetId && am.payload.tabTitle === 'QA Pass 1' && am.payload.textCols.join() === '0' && am.payload.writes.length === nWrites, am && am.payload);
  // Fix loop 1, #7c: the worker refuses a write outside the columns the panel names; the panel names the picked status column and the Notes column.
  jeq('the apply message names the status column letter and the Notes column letter', am.payload.allowedCols, ['B', 'D']);
  ok('every proposed write is inside that list (so the worker\'s refusal never fires on a normal Apply)', am.payload.writes.every(function (w) { return (am.payload.allowedCols || []).indexOf(w.a1.replace(/\d+/g, '')) >= 0; }), am.payload.writes.map(function (w) { return w.a1; }));
  eq('the result is kept on the sheet', recP.sheet.applied.ok && recP.sheet.applied.written, 2);
  eq('and written out with what was left alone', el('qp-apply-status').textContent, 'Wrote 2 cell(s), verified 2. Left alone, changed since read: B2, D2.');
  var log = store.local.qpSheetWriteLog;
  ok('the outcome is logged to qpSheetWriteLog', log && log.length === 1 && log[0].written === 2 && log[0].dropped.length === 2 && log[0].tabTitle === 'QA Pass 1' && log[0].error === null, log);
  var nSent = sent.length;
  settle(qpUiApply());
  eq('after a successful apply, Apply does nothing more', sent.length, nSent);
  var recQ = wrec({ sheet: skCopyPlain(sOK) }); _qpLastRun = recQ; sent.length = 0;
  replies.qpSheetApply = { ok: false, error: 'Nothing was written: the tab could not be re-read first (Connect Google again.).', needsConnect: true, written: 0 };
  settle(qpUiApply());
  ok('a refused write is recorded as not ok, logged with its error, and can be retried', recQ.sheet.applied.ok === false && store.local.qpSheetWriteLog.length === 2 && /Connect Google/.test(store.local.qpSheetWriteLog[1].error));
  replies.qpSheetApply = { ok: true, written: 3, verified: 3, dropped: [], mismatches: [], foreign: [] };
  settle(qpUiApply());
  eq('the retry goes through', recQ.sheet.applied.ok, true);
  var recZ = wrec({ sheet: skCopyPlain(sOK) }); recZ.sheet.proposal.entries.forEach(function (e) { e.include = false; }); _qpLastRun = recZ; sent.length = 0; confirms.length = 0;
  settle(qpUiApply());
  ok('nothing selected: no confirm, no message, a line saying so', confirms.length === 0 && sent.length === 0 && el('qp-apply-status').textContent === 'Nothing selected to write.');
  var recNC = wrec({ sheet: skCopyPlain(sOK) }); recNC.sheet.statusCol = null; recNC.sheet.proposal.entries.forEach(function (e) { e.status = null; });
  _qpLastRun = recNC; sent.length = 0; confirmAnswer = true; replies.qpSheetApply = { ok: true, written: 2, verified: 2, dropped: [], mismatches: [], foreign: [] };
  settle(qpUiApply());
  jeq('with no status column picked, only the Notes column letter is named', sent.filter(function (m) { return m.action === 'qpSheetApply'; })[0].payload.allowedCols, ['D']);
  var recNN = wrec({ sheet: skCopyPlain(sOK) }); recNN.sheet.model.notesCol = null; recNN.sheet.proposal.entries.forEach(function (e) { e.note = null; });
  _qpLastRun = recNN; sent.length = 0;
  settle(qpUiApply());
  jeq('with no Notes column, only the status column letter is named', sent.filter(function (m) { return m.action === 'qpSheetApply'; })[0].payload.allowedCols, ['B']);
  _qpLastRun = recZ; settle(qpUiApply());   // back to the nothing-selected record the next check clicks on
  qpUiOnResultsClick({ target: { closest: function (s) { return s === '#btn-qp-apply' ? {} : null; } } });
  eq('a click on Apply reaches qpUiApply (nothing selected here)', el('qp-apply-status').textContent, 'Nothing selected to write.');
  _qpLastRun = null;
  eq('with no run there is nothing to apply', (function () { sent.length = 0; settle(qpUiApply()); return sent.length; })(), 0);

  // the test plan block
  reset();
  ctx = wctx();
  replies.qpGoogleStatus = { ok: true, clientIdSet: false, connected: false };
  settle(qpUiRefreshSheet());
  ok('no client id: the Settings hint, Connect hidden', /Add a Google OAuth client ID in Settings \(gear\)/.test(el('qp-sheet-status').textContent) && el('btn-qp-google-connect').style.display === 'none');
  replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: false };
  settle(qpUiRefreshSheet());
  ok('not connected: Connect shown, Disconnect hidden, pickers off', el('btn-qp-google-connect').style.display === '' && el('btn-qp-google-disconnect').style.display === 'none' && el('qp-sheet-tab').disabled === true);
  replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: true };
  replies.qpSheetMeta = { ok: true, title: 'QA Test Plan', tabs: [{ sheetId: 0, title: 'Values', index: 0, hidden: false }, { sheetId: 5, title: 'QA Pass 1', index: 1, hidden: false }, { sheetId: 9, title: 'Old', index: 2, hidden: true }] };
  replies.qpSheetRead = { ok: true, values: [['Case', 'Windows Chrome', 'Mac Safari', 'Android Chrome', 'iOS Safari', 'Windows Firefox', 'Notes'], ['x', '', '', '', '', '', '']], valuesTab: null, readAt: 1 };
  settle(qpUiRefreshSheet());
  ok('connected: Disconnect shown, Connect hidden', el('btn-qp-google-connect').style.display === 'none' && el('btn-qp-google-disconnect').style.display === '');
  ok('the tab list has the visible tabs only', /value="QA Pass 1"/.test(el('qp-sheet-tab').innerHTML) && /value="Values"/.test(el('qp-sheet-tab').innerHTML) && !/Old/.test(el('qp-sheet-tab').innerHTML));
  eq('the tab whose id is the link gid (5) is preselected', el('qp-sheet-tab').value, 'QA Pass 1');
  ok('the Status column picker offers desktop-Chrome columns only (Windows Chrome), never Android Chrome, Safari or Firefox', /value="Windows Chrome"/.test(el('qp-sheet-col').innerHTML) && !/Android|Safari|Firefox/.test(el('qp-sheet-col').innerHTML), el('qp-sheet-col').innerHTML);
  ok('  plus "don\'t write statuses"', /don't write statuses/.test(el('qp-sheet-col').innerHTML));
  eq('  with Windows Chrome preselected', el('qp-sheet-col').value, 'Windows Chrome');
  ok('the picks are remembered per spreadsheet', store.local.qpSheetPrefs && store.local.qpSheetPrefs['1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'].tabTitle === 'QA Pass 1' && store.local.qpSheetPrefs['1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'].statusHeader === 'Windows Chrome');
  ctx = wctx({ qaTestPlanUrl: 'https://drive.google.com/file/d/abc/view' });
  settle(qpUiRefreshSheet());
  ok('a link that is not a Google Sheet says so and turns the pickers off', /not a Google Sheet/.test(el('qp-sheet-status').textContent) && el('qp-sheet-tab').disabled === true);
  ctx = wctx();
  replies.qpSheetMeta = { ok: false, error: 'The caller does not have permission' };
  settle(qpUiRefreshSheet());
  ok('a tab-list failure is shown', /could not be listed: The caller does not have permission/.test(el('qp-sheet-status').textContent));
  replies.qpGoogleConnect = { ok: false, error: 'Google sign-in was cancelled or denied.' };
  replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: false };
  settle(qpUiConnectGoogle());
  ok('Connect: a refused sign-in is shown after the refresh', /Google is not connected\. Sign-in: Google sign-in was cancelled or denied\./.test(el('qp-sheet-status').textContent), el('qp-sheet-status').textContent);
  sent.length = 0; settle(qpUiDisconnectGoogle());
  ok('Disconnect asks the worker and refreshes', sent.map(function (m) { return m.action; }).join() === 'qpGoogleDisconnect,qpGoogleStatus');

  // init
  reset(); ctx = wctx();
  store.sync.googleOAuthClientId = 'cid.apps.googleusercontent.com';
  store.local.qpSettings = { checks: { E: false }, widthsText: '375', quickSweep: false, prodMobile: true, combos: true, clearAllSiteData: false, workarounds: 'saved' };
  sessionGets.qpLastRun = wrec({ ts: 5 });
  replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: false };
  var iOut = settle(initQaPass());
  ok('init settles without throwing', iOut.done && !iOut.err, iOut.err && String(iOut.err));
  eq('the saved widths are applied', el('qp-widths').value, '375');
  eq('the saved workarounds text is applied', el('qp-workarounds').value, 'saved');
  eq('the OAuth client id fills the Settings row', el('set-google-client').value, 'cid.apps.googleusercontent.com');
  eq('the redirect URL is shown for this install', el('set-google-redirect').textContent, 'https://abc.chromiumapp.org/');
  eq('#qp-results gets one change and one click listener', (el('qp-results').listeners.change || []).length + '|' + (el('qp-results').listeners.click || []).length, '1|1');
  eq('#qp-body listens for change and input once each', (el('qp-body').listeners.change || []).length + '|' + (el('qp-body').listeners.input || []).length, '1|1');
  eq('the Connect, Disconnect, tab and column controls are bound', ['btn-qp-google-connect', 'btn-qp-google-disconnect', 'qp-sheet-tab', 'qp-sheet-col', 'qp-write-notes', 'qp-retest-inprogress'].map(function (i) { return (el(i).listeners.click || el(i).listeners.change || []).length; }).join(), '1,1,1,1,1,1');
  eq('the last run is restored (ts kept) and rendered', _qpLastRun && _qpLastRun.ts, 5);
  ok('  into the results box', /ISSUES FOUND/.test(el('qp-results').innerHTML));
  el('btn-set-google-copy').listeners.click[0]();
  drainMicrotasks();
  eq('the Copy button copies the redirect URL', clipboard.join(), 'https://abc.chromiumapp.org/');
  el('qp-workarounds').value = 'changed';
  el('qp-body').listeners.input[0]({ target: { closest: function (s) { return /#qp-results/.test(s) ? el('qp-results') : null; } } });
  eq('an edit inside the results box does not save the settings', store.local.qpSettings.workarounds, 'saved');
  el('qp-widths').value = '412';
  el('qp-body').listeners.input[0]({ target: { closest: function () { return null; } } }); drainMicrotasks();
  eq('an edit of a setting saves it', store.local.qpSettings.widthsText + '|' + store.local.qpSettings.workarounds, '412|changed');
  reset(); nodes['qp-body'] = null;
  var nOut = settle(initQaPass());
  ok('init without the panel markup returns quietly', nOut.done && !nOut.err && sent.length === 0);
  reset(); sessionGets.qpLastRun = wrec({ version: 99 }); _qpLastRun = null;
  settle(initQaPass());
  eq('a stored run from another record version is not restored', _qpLastRun, null);

  Object.keys(stubs).forEach(function (k) { delete globalThis[k]; });
  Object.keys(idbStubs).forEach(function (k) { delete globalThis[k]; });
})();

// ── QA Pass: report (Step 14) ───────────────────────────────────────────────
section('QA Pass: report');
(function () {
  // rptQaPassSection itself is sliced at the top of the file (buildReportBody names it). The two
  // functions that read a record's problems and its debug section are sliced here.
  eval(slicePopup('function taModeProblems(entry, add) {', '\n// The debug-log section for a WCAG'));
  eval(slicePopup('function taDebugSection(entry) {', '\n// ONE projection for a finding'));
  // The other modes' sections are not under test here: buildReportBody only names them.
  var rptAbSection = function () { return ''; }, rptWcagSection = function () { return ''; }, rptFunnelSection = function () { return ''; };
  eval(slicePopup('function buildReportBody(sections) {', '\n// ── Debug log'));
  var jeq = function (name, a, b) { eq(name, JSON.stringify(a), JSON.stringify(b)); };

  function ck(id, group, title, status, severity, note, extra) {
    return Object.assign({ id: id, group: group, title: title, status: status, severity: severity, note: note,
                           alsoOnProd: false, blockedBy: null, evidence: { loads: [], widths: [] } }, extra || {});
  }
  var GIF = 'data:image/jpeg;base64,AAAA';
  var ctx = { ticketKey: 'QP-1', experimentId: '9001', platform: 'Optimizely', controlId: 'v0',
              previewLinks: [{ id: 'v0', url: 'https://shop.example/shop/?optimizely_x=9101' }, { id: 'v1', url: 'https://shop.example/shop/?optimizely_x=9102&optimizely_force_tracking=true&optimizely_token=SECRET' }],
              itwLink: 'https://shop.example/shop/?cro_mode=qa', goals: [], softcodedTests: [], concurrentTests: [] };
  function build() {
    var rec = qpNewRecord(ctx, { checks: { A: true, B: true, C: true, D: true, E: true, F: true }, widths: [300, 375, 1280] }, 1700000000000);
    rec.ts = 1700000100000; rec.finishedAt = 1700000090000; rec.platform = 'optimizely';
    rec.catalog = { ok: true, platform: 'optimizely', projectId: '111', revision: '7', counts: { experiments: 0 }, experiments: {}, audiences: {}, pages: {}, events: [], campaigns: {} };
    rec.links = [
      { label: 'v0', role: 'preview', isControl: true, forcedIds: ['9101'], trackingFlags: [], loadId: 'L1', finalUrl: 'https://shop.example/shop/?optimizely_x=9101', loadError: null, blocked: null, probe: null, probeNote: null, track: { listener: true, optimizely: true, events: [] }, facts: null, noTrackServes: null },
      // The forcing link as the ticket gives it: url carries the tracking flag and a token; finalUrl is where it ended up.
      { label: 'v1', role: 'preview', isControl: false, forcedIds: ['9102'], trackingFlags: ['optimizely_force_tracking'], url: ctx.previewLinks[1].url, loadId: 'L2', finalUrl: 'https://shop.example/shop/?optimizely_x=1&optimizely_force_tracking=true', loadError: null, blocked: null, probe: null, probeNote: null, track: { listener: true, optimizely: true, events: [] }, facts: null, noTrackServes: false },
      { label: 'ITW', role: 'itw', isControl: false, forcedIds: [], trackingFlags: [], loadId: 'L3', finalUrl: 'https://shop.example/shop/?cro_mode=qa', loadError: null, blocked: null, probe: null, probeNote: null, track: null, facts: null, noTrackServes: null },
    ];
    rec.controlVsProd = { controlLabel: 'v0', prodPath: 'https://shop.example/shop/', prodFinalUrl: 'https://shop.example/shop/?optimizely_x=7', control: null, prod: null, prodProbe: null, compare: null, skipped: null };
    rec.sweep = {
      plan: { targets: [], profiles: ['desktop', 'iphone'], widths: [300, 375, 1280] },
      rows: [
        { target: 'v1', role: 'variant', profile: 'iphone', width: 375, mode: 'reload', loadId: 'L9', ok: true, loadError: null, blocked: null, scan: { offenderCount: 1, pageOverflowPx: 0, offenders: [{ text: 'CLIPPED-HERO Start your free trial', gapPx: -25, side: 'right' }] }, tile: 1 },
        { target: 'v1', role: 'variant', profile: 'iphone', width: 300, mode: 'reload', loadId: 'L8', ok: true, loadError: null, blocked: null, scan: { offenderCount: 1, pageOverflowPx: 0, offenders: [{ text: 'CLIPPED-HERO Start your free trial', gapPx: -96, side: 'right' }] }, tile: 2 },
      ],
      tiles: [
        { target: 'PROD', profile: 'iphone', width: 375, gapPx: 0, text: 'CLIPPED-HERO Start your free trial', img: GIF },
        { target: 'v1', profile: 'iphone', width: 375, gapPx: -25, text: 'CLIPPED-HERO Start your free trial', img: GIF },
        { target: 'v1', profile: 'iphone', width: 300, gapPx: -96, text: 'CLIPPED-HERO "Start" your free trial', img: 'https://evil.example/x.png' },
      ],
    };
    rec.checks = [
      ck('A.v0', 'A', 'Link map — v0', 'passed', null, 'served v0'),
      ck('A.v1', 'A', 'Link map — v1', 'passed', null, 'served v1'),
      ck('A.itw', 'A', 'Link map — ITW', 'passed', null, 'ITW active'),
      ck('B.control-prod', 'B', 'Control matches PROD', 'passed', null, 'matches'),
      ck('C.goal.1', 'C', 'Goal "Hero CTA click" in the snippet', 'passed', null, 'found'),
      ck('C.goal.2', 'C', 'Goal "Purchase completed" in the snippet', 'in-progress', null, 'metric list only visible in the Optimizely UI'),
      ck('C.unlisted.9002', 'C', 'Unlisted live test QP-OTHER', 'in-progress', null, 'live test on ITW not listed <script>alert(1)</script>'),
      ck('D.1', 'D', 'Audience: ITW with utm_source=meta', 'passed', null, 'ok'),
      ck('D.2', 'D', 'Audience: ITW with utm_campaign=impact', 'failed', null, 'ITW with utm_campaign=impact: expected the experiment NOT to activate, it activated'),
      ck('E.v0.1', 'E', 'Clipping — v0: "LEGAL-LINE Terms apply"', 'failed', 'low', '"LEGAL-LINE Terms apply" clipped at 300, 320 px (iPhone), worst −30 px at 300 px; also on PROD at 300, 320 px', { alsoOnProd: true }),
      ck('E.v1.1', 'E', 'Clipping — v1: "CLIPPED-HERO Start"', 'failed', 'high', '"CLIPPED-HERO Start your free…" clipped at 360, 375, 390 px (iPhone), worst −96 px at 300 px; also on PROD: no'),
      ck('E.v1.2', 'E', 'Clipping — v1: "Other"', 'failed', 'medium', 'Other text clipped at 480 px'),
      ck('E.v2', 'E', 'Clipping — v2', 'blocked', null, 'A bot check stopped this page (title: Just a moment...)', { blockedBy: 'bot' }),
      ck('E.v3', 'E', 'Clipping — v3', 'blocked', null, 'v3 was not served', { blockedBy: 'A.v3' }),
      ck('F.v0', 'F', 'Metrics on load — v0', 'passed', null, 'nothing fired'),
      ck('F.v1', 'F', 'Metrics on load — v1', 'failed', null, 'Click metric "hero_cta_click" fired on load (1×)'),
      ck('D.setup', 'D', 'Audience setup', 'not-tested', null, 'no catalog'),
    ];
    rec.notTested = [{ id: 'X.traffic', what: 'Total traffic allocation', reason: 'Not in the snippet' }];
    return rec;
  }
  var rec = build();
  var entry = function (r, o) { return Object.assign({ mode: 'qapass', name: 'QA Pass (platform + layout)', status: 'ran', data: r }, o || {}); };
  var html = rptQaPassSection(entry(rec));
  var at = function (s, needle) { return s.indexOf(needle); };
  var heads = ['>Bugs</h3>', '>Passed</h3>', '>Needs PGM</h3>', '>Not tested</h3>', '>Sheet changes</h3>'];
  var pos = heads.map(function (h) { return at(html, h); });
  ok('all five headings are present', pos.every(function (p) { return p !== -1; }), pos);
  ok('in the order Bugs, Passed, Needs PGM, Not tested, Sheet changes', pos.every(function (p, i) { return i === 0 || p > pos[i - 1]; }), pos);
  eq('and there are exactly five <h3> headings', (html.match(/<h3/g) || []).length, 5);
  var seg = function (a, b) { return html.slice(at(html, a), at(html, b)); };
  var bugsHtml = seg('>Bugs</h3>', '>Passed</h3>');
  var passedHtml = seg('>Passed</h3>', '>Needs PGM</h3>');
  var pgmHtml = seg('>Needs PGM</h3>', '>Not tested</h3>');
  var ntHtml = seg('>Not tested</h3>', '>Sheet changes</h3>');
  var sheetHtml = html.slice(at(html, '>Sheet changes</h3>'));

  // The report rules (memory reference_qa-report-rendering).
  ok('no optimizely_ text anywhere in the section', html.indexOf('optimizely_') === -1);
  ok('the token in the link url is not printed', html.indexOf('SECRET') === -1);
  ok('no ?optimizely query is printed', html.indexOf('?optimizely') === -1);
  ok('no query string is printed at all (every URL is a path)', !/https?:\/\/[^\s<"]*\?/.test(html));
  ok('the <script> in a note appears only escaped', html.indexOf('<script') === -1 && html.indexOf('&lt;script&gt;') !== -1);
  ok('the pages loaded are listed by where they ended up', html.indexOf('Pages loaded: v0 https://shop.example/shop/ · v1 https://shop.example/shop/') !== -1, html.slice(html.indexOf('Pages loaded'), html.indexOf('Pages loaded') + 200));
  ok('and PROD by its final url', html.indexOf('PROD https://shop.example/shop/') !== -1);

  // Bugs: the failed checks, and only they.
  var failedIds = rec.checks.filter(function (c) { return c.status === 'failed'; }).map(function (c) { return c.id; });
  ok('every failed check id is in the Bugs table', failedIds.every(function (id) { return bugsHtml.indexOf('<td>' + id + '<br>') !== -1; }), failedIds);
  var others = rec.checks.filter(function (c) { return c.status !== 'failed'; }).map(function (c) { return c.id; });
  ok('no passed, in-progress, blocked or not-tested id is in it', others.every(function (id) { return bugsHtml.indexOf('<td>' + id + '<br>') === -1; }));
  var tbody = function (h) { return h.slice(h.indexOf('<tbody>'), h.indexOf('</tbody>')); };
  eq('the Bugs rows equal the number of failed checks', (tbody(bugsHtml).match(/<tr>/g) || []).length, failedIds.length);
  var withExplain = build();
  withExplain.explain = { ok: true,
    bugs: [{ checkIds: ['E.v1.1'], summary: 'Hero is clipped on phones', severity: 'high', commentIds: ['10001'] }, { checkIds: ['D.2'], summary: 'Impact exclusion not honoured', severity: 'medium', commentIds: [] }, { checkIds: ['F.v1'], summary: 'Click fires on load', severity: 'low', commentIds: [] }, { checkIds: ['E.v1.2'], summary: 'Another', severity: 'low', commentIds: [] }, { checkIds: ['E.v0.1'], summary: 'More', severity: 'low', commentIds: [] }],
    pgmQuestions: [{ question: 'Is the timer date deliberate?', checkIds: ['C.goal.2'], commentIds: ['10001'] }],
    noise: [{ checkIds: ['C.unlisted.9002'], reason: 'A live banner test may rotate' }],
    commentChecks: [{ commentId: '10001', reproduced: 'yes', checkIds: ['E.v1.1'], summary: 'Seen at 375 px' }, { commentId: '10002', reproduced: 'not-checked', checkIds: [], summary: 'Needs a real device' }],
    dropped: 0 };
  var hx = rptQaPassSection(entry(withExplain));
  var rowsOf = function (h) { var b = h.slice(h.indexOf('>Bugs</h3>'), h.indexOf('>Passed</h3>')); return (tbody(b).match(/<tr>/g) || []).length; };
  eq('five analysis bugs against four failed checks: the table still has one row per failed check', rowsOf(hx), failedIds.length);
  var fewer = build();
  fewer.explain = { ok: true, bugs: [], pgmQuestions: [], noise: [], commentChecks: [], dropped: 0 };
  eq('an analysis with no bugs at all: the same rows', rowsOf(rptQaPassSection(entry(fewer))), failedIds.length);
  eq('no analysis at all: the same rows', rowsOf(rptQaPassSection(entry(build()))), failedIds.length);
  ok('the analysis block says it only groups', hx.indexOf('Analysis (Opus): grouping only, statuses above are unchanged') !== -1);
  ok('it lists the analysis bug with its cited check and comment', hx.indexOf('Hero is clipped on phones') !== -1 && hx.indexOf('E.v1.1; comment 10001; high') !== -1);
  ok('comments are cited by id, never linked', hx.indexOf('comment 10001') !== -1 && hx.indexOf('<a ') === -1 && hx.indexOf('href') === -1);
  ok('environment noise is advisory', hx.indexOf('Possible environment noise (advisory)') !== -1 && hx.indexOf('A live banner test may rotate') !== -1);
  ok('a PGM question is under Needs PGM', hx.slice(hx.indexOf('>Needs PGM</h3>'), hx.indexOf('>Not tested</h3>')).indexOf('Is the timer date deliberate?') !== -1);
  ok('comment checks print reproduced yes / not checked', /comment 10001: reproduced yes — Seen at 375 px/.test(hx) && /comment 10002: reproduced not checked — Needs a real device/.test(hx));
  ok('the analysis never changes the badge', hx.indexOf('ISSUES FOUND') !== -1);
  var failedExplain = build();
  failedExplain.explain = { ok: false, error: 'No API key configured' };
  var hf = rptQaPassSection(entry(failedExplain));
  ok('a failed analysis says so under Needs PGM', hf.slice(hf.indexOf('>Needs PGM</h3>'), hf.indexOf('>Not tested</h3>')).indexOf('Analysis unavailable: No API key configured') !== -1);
  ok('and the Bugs table is unchanged', rowsOf(hf) === failedIds.length);

  // Severity order, then "—", and the also-on-PROD mark.
  var order = failedIds.map(function (id) { return bugsHtml.indexOf('<td>' + id + '<br>'); });
  var idx = function (id) { return bugsHtml.indexOf('<td>' + id + '<br>'); };
  ok('high comes before medium, medium before low, low before no severity', idx('E.v1.1') < idx('E.v1.2') && idx('E.v1.2') < idx('E.v0.1') && idx('E.v0.1') < idx('D.2'), order);
  ok('failed checks with no severity are sorted by id after the rest', idx('D.2') < idx('F.v1'));
  ok('no severity prints a dash', /<td>D\.2<br>[^]*?<td>—<\/td>/.test(bugsHtml));
  ok('an alsoOnProd check shows also on PROD', bugsHtml.indexOf('also on PROD') !== -1);
  var noProd = build();
  noProd.checks.forEach(function (c) { c.alsoOnProd = false; });
  ok('and none is shown when no check is also on PROD', rptQaPassSection(entry(noProd)).indexOf('<strong>also on PROD</strong>') === -1);

  // Tiles: the PROD tile above the variant's, only real data URLs rendered.
  var figs = bugsHtml.match(/<figure[^]*?<\/figure>/g) || [];
  eq('three tiles, three figures', figs.length, 3);
  ok('the PROD figure precedes the variant figure at the same width', /^<figure[^>]*>[^]*PROD · iPhone · 375 px/.test(figs[0]) && figs[1].indexOf('v1 · iPhone · 375 px') !== -1);
  ok('the variant caption names the edge, the gap and the text', figs[1].indexOf('right edge −25 px') !== -1 && figs[1].indexOf('CLIPPED-HERO Start your free trial') !== -1, figs[1]);
  eq('only the two data-URL tiles render an <img>', (bugsHtml.match(/<img /g) || []).length, 2);
  ok('a tile whose img is not a data URL renders no img, and its url is not printed', bugsHtml.indexOf('evil.example') === -1);
  ok('its caption is still printed, with the quote escaped in the alt text', figs[2].indexOf('v1 · iPhone · 300 px') !== -1 && figs[2].indexOf('−96 px') !== -1);
  ok('a quote in the tile text cannot break out of an attribute', !/alt="[^"]*"[^>]*"Start"/.test(bugsHtml));
  var shared = build();
  shared.sweep.tiles.push({ target: 'v2', profile: 'iphone', width: 375, gapPx: -10, text: 'X', img: GIF });
  var sharedHtml = rptQaPassSection(entry(shared));
  eq('a PROD tile shared by two variants is printed once', (sharedHtml.match(/<figcaption[^>]*>PROD/g) || []).length, 1);
  eq('and all three variant tiles are printed', (sharedHtml.match(/<figcaption[^>]*>v[12] /g) || []).length, 3);
  var data = rec.sweep.tiles[1].img;
  ok('the tile image is the stored data URL', bugsHtml.indexOf('src="' + data + '"') !== -1);

  // Passed / Needs PGM / Not tested.
  ok('Passed prints one line per group', passedHtml.indexOf('A · Link map: v0, v1, ITW') !== -1, passedHtml);
  ok('B and F are named too', passedHtml.indexOf('B · Control matches PROD') !== -1 && passedHtml.indexOf('F · Metrics on load: v0') !== -1);
  ok('Passed does not list a failed id', passedHtml.indexOf('D.2') === -1 && passedHtml.indexOf('v1 clipped') === -1);
  ok('Needs PGM lists the in-progress checks', pgmHtml.indexOf('C.goal.2: metric list only visible in the Optimizely UI') !== -1 && pgmHtml.indexOf('C.unlisted.9002') !== -1);
  ok('and not a passed one', pgmHtml.indexOf('A.v0') === -1);
  ok('Not tested lists a bot-blocked check as a bot check', /E\.v2[^<]*bot check \(never attempted\)/.test(ntHtml), ntHtml);
  ok('a check blocked by another check says which', ntHtml.indexOf('blocked by A.v3') !== -1);
  ok('a not-tested check gives its reason', ntHtml.indexOf('D.setup') !== -1 && ntHtml.indexOf('no catalog') !== -1);
  ok('and the fixed list follows', ntHtml.indexOf('Total traffic allocation: Not in the snippet') !== -1);
  ok('a bot-blocked check is not under Bugs', bugsHtml.indexOf('E.v2') === -1);
  ok('the summary line counts them', html.indexOf('5 bug(s) · 7 passed · 2 need PGM · 2 blocked · 2 not tested') !== -1, (html.match(/rpt-summary">([^<]*)</) || [])[1]);

  // Sheet changes.
  ok('without Google the paste table is printed', sheetHtml.indexOf('Auto QA (') !== -1 && sheetHtml.indexOf('Paste-ready rows') !== -1, sheetHtml.slice(0, 300));
  var noLink = build(); noLink.sheet = { connected: false, reason: 'no-test-plan-link', error: null, paste: qpPasteRows(noLink.checks, new Date(2026, 9, 21)) };
  var hn = rptQaPassSection(entry(noLink)).slice(rptQaPassSection(entry(noLink)).indexOf('>Sheet changes</h3>'));
  ok('no test plan link: its reason and the paste rows', hn.indexOf('The ticket has no QA test plan link.') !== -1 && hn.indexOf('Auto QA (10/21)') !== -1);
  ok('the paste table is a report table', hn.indexOf('<table class="rpt-table qp-paste">') !== -1);
  var connected = build();
  connected.sheet = { connected: true, reason: null, error: null, spreadsheetId: 'x', gid: '1', tabTitle: 'QA Pass 1', readAt: 1,
    statusCol: { col: 5, letter: 'F', header: 'Windows Chrome' }, notesOn: true, retestInProgress: false,
    proposal: { entries: [{ row: 4, rowText: 'Hero shows <b>on mobile</b>', checkIds: ['E.v1.1'], derived: 'failed', include: true,
      status: { a1: 'F4', col: 5, old: 'Backlog', next: 'Failed', writable: true, reason: null },
      note: { a1: 'M4', col: 12, old: '', next: 'Auto QA (10/21): clipped' } }], unmapped: [{ row: 9, rowText: 'Unmapped row', status: 'Backlog' }], skippedByRule: [], counts: { statusWrites: 1, noteWrites: 1 } },
    paste: [], applied: null };
  var hc = rptQaPassSection(entry(connected));
  var sc = hc.slice(hc.indexOf('>Sheet changes</h3>'));
  ok('connected: proposed counts, tab, column', sc.indexOf('Proposed 1 status change(s) and 1 note(s) to "QA Pass 1", column F "Windows Chrome"') !== -1, sc.slice(0, 300));
  ok('connected: says it was not applied', sc.indexOf('not applied when this report was built; apply from the QA Pass panel.') !== -1);
  ok('connected: the old and new cell values are shown', sc.indexOf('Backlog') !== -1 && sc.indexOf('Failed') !== -1 && sc.indexOf('Auto QA (10/21): clipped') !== -1);
  ok('connected: no form controls', sc.indexOf('<select') === -1 && sc.indexOf('<input') === -1 && sc.indexOf('<button') === -1);
  ok('connected: the row text is escaped', sc.indexOf('<b>') === -1 && sc.indexOf('&lt;b&gt;on mobile') !== -1);
  ok('connected: the proposal is a report table', sc.indexOf('<table class="rpt-table qp-proposal">') !== -1);
  var readErr = build(); readErr.sheet = { connected: true, reason: null, error: 'The sheet has no tab titled "X"', paste: [] };
  ok('a read error is printed with the paste table', rptQaPassSection(entry(readErr)).indexOf('The test plan could not be read: The sheet has no tab titled &quot;X&quot;') !== -1
     || rptQaPassSection(entry(readErr)).indexOf('The test plan could not be read: The sheet has no tab titled "X"') !== -1);

  // Badge and summary.
  var badgeOf = function (r) { return (rptQaPassSection(entry(r)).match(/rpt-badge rpt-badge-([a-z]+)">([^<]*)</) || []).slice(1).join(':'); };
  eq('a failed check: ISSUES FOUND', badgeOf(rec), 'fail:ISSUES FOUND');
  var allPass = build(); allPass.checks = allPass.checks.filter(function (c) { return c.status === 'passed'; });
  eq('only passed checks: PASS', badgeOf(allPass), 'pass:PASS');
  var stoppedOnly = build(); stoppedOnly.stopped = true; stoppedOnly.checks = stoppedOnly.checks.filter(function (c) { return c.status === 'passed'; });
  eq('stopped with nothing failed: INCOMPLETE', badgeOf(stoppedOnly), 'issues:INCOMPLETE');
  ok('and the summary says it was stopped', rptQaPassSection(entry(stoppedOnly)).indexOf('stopped by the tester') !== -1);
  var inProgOnly = build(); inProgOnly.checks = inProgOnly.checks.filter(function (c) { return c.status === 'passed' || c.status === 'in-progress'; });
  eq('in-progress and no failure: NEEDS REVIEW', badgeOf(inProgOnly), 'issues:NEEDS REVIEW');
  var empty = build(); empty.checks = [];
  eq('no checks: INCONCLUSIVE', badgeOf(empty), 'skip:INCONCLUSIVE');
  ok('a section with no failures says none failed', rptQaPassSection(entry(empty)).indexOf('No check failed.') !== -1);
  ok('the footer names the widths and says the emulation is not real devices', html.indexOf('emulated viewport widths 300, 375, 1280') !== -1 && html.indexOf('not real devices') !== -1);
  var nowidths = build(); nowidths.settings.widths = [];
  ok('with no widths recorded the footer falls back to the 18 defaults', rptQaPassSection(entry(nowidths)).indexOf('emulated viewport widths 300, 320, 340') !== -1);
  // #5 (D8): the foot names the run's fresh visitors to the live page and how PROD was swept.
  var fvRec = build();
  fvRec.loads = [{ id: 'L1', role: 'itw', label: 'ITW' }, { id: 'L2', role: 'prod', label: 'PROD' }, { id: 'L3', role: 'audience', label: 'ITW' }, { id: 'L4', role: 'sweep', label: 'PROD' }, { id: 'L5', role: 'preview', label: 'v0' }];
  fvRec.controlVsProd.prodProbe = { activeIds: [] };
  fvRec.sweep.rows = fvRec.sweep.rows.concat([{ target: 'PROD', role: 'prod', profile: 'iphone', width: 375, mode: 'reload', loadId: 'L4', ok: true, scan: { offenders: [] } }]);
  var fvHtml = rptQaPassSection(entry(fvRec));
  ok('#5: the foot names the fresh visitors and how PROD was swept', fvHtml.indexOf('<p class="rpt-muted">Fresh visitors: 4 load(s) of the live page as a new visitor (Selenite clears the Optimizely cookies before each): PROD 1, ITW 1, audience tests 1, PROD sweep 1. PROD was swept by reloading once per width: the plain PROD load showed no live experiment.</p>') !== -1, fvHtml.slice(fvHtml.indexOf('Pages loaded'), fvHtml.indexOf('Pages loaded') + 600));
  ok('#5: between the pages loaded and the emulation note', fvHtml.indexOf('Fresh visitors') > fvHtml.indexOf('Pages loaded') && fvHtml.indexOf('Fresh visitors') < fvHtml.indexOf('Local Chrome, emulated'));
  eq('#5: a record with no loads prints no fresh-visitor line', html.indexOf('Fresh visitors'), -1);
  ok('a skipped entry is a skipped section', rptQaPassSection({ mode: 'qapass', name: 'QA Pass (platform + layout)', status: 'skipped', reason: 'Not configured.' }).indexOf('SKIPPED') !== -1);
  ok('an entry with no data does not throw', typeof rptQaPassSection({ mode: 'qapass', name: 'QA Pass', status: 'ran' }) === 'string');
  ok('the section is wrapped by the shared section shell', /^\s*<section class="rpt-section">/.test(html) && html.indexOf('<h2>QA Pass (platform + layout)</h2>') !== -1);

  // The cover.
  eq('the cover lists the pages by final url, without the query', JSON.stringify(abPageUrls([{ mode: 'qapass', data: { links: [{ finalUrl: 'https://a.com/p?optimizely_x=1' }], controlVsProd: { prodFinalUrl: 'https://a.com/p' } } }])), '["https://a.com/p"]');
  eq('and for the whole record, deduplicated', JSON.stringify(abPageUrls([{ mode: 'qapass', data: rec }])), '["https://shop.example/shop/"]');
  eq('a record with nothing loaded adds none', abPageUrls([{ mode: 'qapass', data: { links: [] } }]).length, 0);

  // taModeProblems: what degraded the run.
  var problems = function (r) { var out = []; taModeProblems({ mode: 'qapass', data: r }, function (sev, where, detail) { out.push({ sev: sev, where: where, detail: detail }); }); return out; };
  var findP = function (list, re) { return list.filter(function (p) { return re.test(p.sev + ' ' + p.where + ' ' + p.detail); }); };
  var stale = JSON.parse(JSON.stringify(rec)); delete stale.version;
  var ps = problems(stale);
  eq('a record without a version is an error', findP(ps, /^error qa-pass This record came from an older service worker: reload Selenite in chrome:\/\/extensions/).length, 1);
  eq('a record with its version has no such error', findP(problems(rec), /older service worker/).length, 0);
  var withErr = build(); withErr.error = 'The debugger was detached';
  eq('a worker error is an error', findP(problems(withErr), /^error qa-pass The debugger was detached/).length, 1);
  var stoppedRec = build(); stoppedRec.stopped = true;
  eq('a stop is an info', findP(problems(stoppedRec), /^info qa-pass Stopped by the tester/).length, 1);
  var loadErr = build(); loadErr.links[1].loadError = 'Page load timed out after 30s';
  eq('a link that failed to load is a warning with its label', findP(problems(loadErr), /^warn qa-pass\/v1 Failed to load \(Page load timed out after 30s\)/).length, 1);
  var botRec = build(); botRec.loads = [{ id: 'L4', label: 'v2', path: 'https://shop.example/blocked/', blocked: { reason: 'bot-check', signal: 'title: Just a moment...' } }];
  eq('a bot check is a warning that names the page and the signal', findP(problems(botRec), /^warn qa-pass\/v2 A bot check stopped https:\/\/shop\.example\/blocked\/ \(title: Just a moment\.\.\.\); it was never attempted\./).length, 1);
  var noCat = build(); noCat.catalog = null;
  eq('Optimizely with no catalog says C and D did not run', findP(problems(noCat), /^warn qa-pass The Optimizely catalog could not be read, so C and D did not run\./).length, 1);
  var hasCat = build(); hasCat.catalog = { platform: 'optimizely', experiments: {} };
  eq('with a catalog it does not', findP(problems(hasCat), /catalog could not be read/).length, 0);
  var convert = build(); convert.platform = 'convert'; convert.catalog = null;
  eq('Convert with no catalog is not flagged', findP(problems(convert), /catalog could not be read/).length, 0);
  var resize = build(); resize.sweep.rows = [{ target: 'v1', role: 'variant', profile: 'iphone', width: 375, mode: 'resize' }, { target: 'v1', role: 'variant', profile: 'iphone', width: 300, mode: 'resize' }];
  var rp = findP(problems(resize), /^info qa-pass\/sweep "v1" was swept by resizing one load per device, because their preview link registers an exposure on every load and the no-tracking link did not serve the variation\./);
  eq('a resize row is an info with the exposure reason, once per label', rp.length, 1);
  var quick = build(); quick.settings.quickSweep = true; quick.sweep.rows = resize.sweep.rows;
  eq('with Quick sweep on the reason is Quick sweep, not an exposure', findP(problems(quick), /swept by resizing one load per device, because Quick sweep was on\./).length, 1);
  eq('and the exposure reason is not claimed', findP(problems(quick), /registers an exposure/).length, 0);
  // #5 (D8): PROD swept by resizing gets its own line, with why and the fresh-visitor count; the variants' line never lists PROD.
  var prodLive = build();
  prodLive.loads = [{ id: 'L1', role: 'prod', label: 'PROD', path: 'https://shop.example/shop/' }, { id: 'L2', role: 'sweep', label: 'PROD', path: 'https://shop.example/shop/' }];
  prodLive.controlVsProd.prodProbe = { activeIds: ['9002'], servedVariationId: null };
  prodLive.sweep.rows = [{ target: 'PROD', role: 'prod', profile: 'desktop', width: 1280, mode: 'resize', loadId: 'L2', ok: true }, { target: 'PROD', role: 'prod', profile: 'desktop', width: 375, mode: 'resize', loadId: 'L2', ok: true }];
  var plp = findP(problems(prodLive), /^info qa-pass\/sweep Fresh visitors: 2 load\(s\) of the live page as a new visitor/);
  eq('#5: a PROD swept by resizing is ONE info line that starts with the fresh-visitor count', plp.length, 1);
  ok('#5: it names the live experiment as the reason', plp.length === 1 && /PROD was swept by resizing one tab per device, because the plain PROD load showed 1 live experiment\(s\) \(9002\)\.$/.test(plp[0].detail), plp[0] && plp[0].detail);
  eq('#5: and PROD is not named in the variants\' resize line', findP(problems(prodLive), /"PROD"/).length, 0);
  var quickAll = build(); quickAll.settings.quickSweep = true;
  quickAll.sweep.rows = resize.sweep.rows.concat([{ target: 'PROD', role: 'prod', profile: 'desktop', width: 1280, mode: 'resize' }]);
  eq('#5: under Quick sweep the variants keep their own line, without PROD', findP(problems(quickAll), /^info qa-pass\/sweep "v1" was swept by resizing one load per device, because Quick sweep was on\./).length, 1);
  eq('#5: and PROD has its own, with Quick sweep as the reason', findP(problems(quickAll), /PROD was swept by resizing one tab per device, because Quick sweep was on\.$/).length, 1);
  var prodReload = build(); prodReload.controlVsProd.prodProbe = { activeIds: [] };
  prodReload.sweep.rows = [{ target: 'PROD', role: 'prod', profile: 'desktop', width: 1280, mode: 'reload' }];
  eq('#5: a PROD reloaded per width raises no line', findP(problems(prodReload), /Fresh visitors|"PROD"/).length, 0);
  var swErr = build(); swErr.sweep.rows = [{ target: 'v1', role: 'variant', profile: 'iphone', width: 375, mode: 'reload', loadError: 'net::ERR_FAILED' }, { target: 'v1', role: 'variant', profile: 'iphone', width: 300, mode: 'reload', loadError: 'x' }];
  eq('sweep load errors are one warning with the count and the first error', findP(problems(swErr), /^warn qa-pass\/sweep 2 sweep load\(s\) failed \(net::ERR_FAILED\)/).length, 1);
  var trunc = build(); trunc.sweep.rows = [{ target: 'v1', role: 'variant', profile: 'desktop', width: 1280, mode: 'reload', scan: { truncated: true } }];
  eq('a truncated scan is an info with the count', findP(problems(trunc), /^info qa-pass\/sweep 1 clipping scan\(s\) stopped at the text-node cap/).length, 1);
  var bucketed = build(); bucketed.controlVsProd.prodProbe = { servedVariationId: '9102', servedVariationName: 'v1: Hero', bucketed: true };
  eq('PROD bucketed into a variation that is not Control is a warning', findP(problems(bucketed), /^warn qa-pass\/PROD PROD was bucketed into "v1: Hero" \(9102\), not Control/).length, 1);
  var bucketedCtl = build(); bucketedCtl.controlVsProd.prodProbe = { servedVariationId: '9101', servedVariationName: 'v0: Control', bucketed: true };
  eq('PROD bucketed into Control is not', findP(problems(bucketedCtl), /bucketed/).length, 0);
  var exFail = build(); exFail.explain = { ok: false, error: 'The model declined to answer.' };
  eq('a failed analysis is a warning', findP(problems(exFail), /^warn qa-pass\/analysis Analysis \(Opus\) failed: The model declined to answer\./).length, 1);
  var shErr = build(); shErr.sheet = { connected: true, error: 'HTTP 403', applied: { ok: false, error: 'Connect Google again.' } };
  eq('a sheet read error is a warning', findP(problems(shErr), /^warn qa-pass\/sheet Test plan not read: HTTP 403/).length, 1);
  eq('and so is a refused write', findP(problems(shErr), /^warn qa-pass\/sheet Writing to the test plan failed: Connect Google again\./).length, 1);
  var okApplied = build(); okApplied.sheet = { connected: true, error: null, applied: { ok: true } };
  eq('a successful write is not a problem', findP(problems(okApplied), /Writing to the test plan failed/).length, 0);
  var shimOff = build(); shimOff.links[0].track = { disabled: 'The metrics listener stopped the Optimizely snippet from loading on /shop/, so it was removed for the rest of the run' }; shimOff.links[1].track = { disabled: 'same' };
  var mp = findP(problems(shimOff), /^warn qa-pass\/metrics /);
  eq('a removed metrics listener is ONE warning (the first link\'s text)', mp.length, 1);
  ok('  with the worker\'s sentence', /stopped the Optimizely snippet from loading/.test(mp[0] && mp[0].detail));
  var pn = build(); pn.links[1].probeNote = 'The snippet did not load while the metrics listener was installed';
  eq('a probe note is a warning under the link', findP(problems(pn), /^warn qa-pass\/v1 The snippet did not load while the metrics listener was installed/).length, 1);
  eq('a clean record has no problems at all', problems(rec).length, 0);
  eq('and none of the messages carry a query or a forcing parameter', JSON.stringify(ps.concat(problems(withErr), problems(botRec), problems(resize))).indexOf('optimizely_'), -1);

  // The debug section.
  var dbg = taDebugSection({ mode: 'qapass', name: 'QA Pass (platform + layout)', status: 'ran', data: rec });
  eq('the debug section carries the status', dbg.status, 'ran');
  ok('and when the record was completed', typeof dbg.completedAt === 'string' && dbg.completedAt.indexOf('2023-') === 0, dbg.completedAt);
  var projKeys = Object.keys(qpDebugProjection(rec));
  ok('and every key of the QA Pass debug projection', projKeys.every(function (k) { return k in dbg; }), projKeys.filter(function (k) { return !(k in dbg); }));
  eq('the projection has the 19 keys', projKeys.length, 19);
  var dj = JSON.stringify(dbg);
  ok('no image data in the debug section', dj.indexOf('data:image') === -1);
  ok('no tracking parameter in any url, no token (the link\'s flag NAMES are listed, as the plan has them)', dj.indexOf('optimizely_force_tracking=') === -1 && dj.indexOf('SECRET') === -1);
  ok('the tiles are listed with hasImage', dbg.sweep.tiles.length === 3 && dbg.sweep.tiles.every(function (t) { return t.hasImage === true || t.hasImage === false; }));
  jeq('a mode that did not run has only its status', taDebugSection({ mode: 'qapass', status: 'failed', reason: 'No active ticket context' }), { status: 'failed', reason: 'No active ticket context' });
  eq('and an absent entry is null', taDebugSection(undefined), null);

  // Fix loop 1, #6: a model reply that carries a status ('passed' on a failed check's bug, on a PGM question) changes
  // nothing in the report: the validator drops it, so the Bugs table, the Passed list and the badge stay as the checks say.
  var xin = { checks: rec.checks.map(function (c) { return { id: c.id, status: c.status }; }), comments: [{ id: '10001' }] };
  var xBug = { checkIds: ['E.v1.1'], summary: 'Hero is clipped on phones', severity: 'high', commentIds: ['10001'] };
  var xQ = { question: 'Is the timer date deliberate?', checkIds: ['C.goal.2'], commentIds: [] };
  var xWith = build(), xWithout = build();
  xWith.explain = qpValidateExplain({ bugs: [Object.assign({ status: 'passed' }, xBug)], pgmQuestions: [Object.assign({ status: 'passed' }, xQ)], noise: [], commentChecks: [] }, xin);
  xWithout.explain = qpValidateExplain({ bugs: [xBug], pgmQuestions: [xQ], noise: [], commentChecks: [] }, xin);
  var xHtmlWith = rptQaPassSection(entry(xWith)), xHtmlWithout = rptQaPassSection(entry(xWithout));
  ok('the explain block is really in the report (not vacuous)', xHtmlWith.indexOf('Hero is clipped on phones') !== -1 && xHtmlWith.indexOf('Is the timer date deliberate?') !== -1);
  eq('a reply with statuses renders byte-identically to the same reply without', xHtmlWith === xHtmlWithout, true);
  ok('the failed check is still one row in the Bugs table and is not listed as passed',
     xHtmlWith.slice(xHtmlWith.indexOf('>Bugs</h3>'), xHtmlWith.indexOf('>Passed</h3>')).indexOf('<td>E.v1.1<br>') !== -1
     && xHtmlWith.slice(xHtmlWith.indexOf('>Passed</h3>'), xHtmlWith.indexOf('>Needs PGM</h3>')).indexOf('E.v1.1') === -1);
  eq('the counts line is the one of the checks', (xHtmlWith.match(/rpt-summary">([^<]*)</) || [])[1], (html.match(/rpt-summary">([^<]*)</) || [])[1]);
  ok('the badge still says ISSUES FOUND', /rpt-badge-fail">ISSUES FOUND</.test(xHtmlWith));
  ok('the record still holds the checks\' own statuses', xWith.checks.filter(function (c) { return c.id === 'E.v1.1'; })[0].status === 'failed');

  // Fix loop 1, #1: a canonical that echoes the page URL. The Control page's canonical carries the preview link's
  // forcing query; compared raw it failed B and printed optimizely_force_tracking into the report. By path: B passes,
  // and when the path really differs the report prints the paths only.
  var ECHO = 'https://shop.example/shop/?optimizely_x=9101&optimizely_force_tracking=true&optimizely_token=SECRET#h';
  var ECHO_OTHER = 'https://shop.example/other/?optimizely_x=9101&optimizely_force_tracking=true&optimizely_token=SECRET';
  function echoRecord(controlCanonical, controlOver) {
    var r = qpNewRecord(ctx, { checks: { A: false, B: true, C: false, D: false, E: false, F: false }, widths: [300, 375, 1280] }, 1700000000000);
    r.ts = 1700000100000; r.finishedAt = 1700000090000; r.platform = 'optimizely';
    var facts = function (canonical, over) {
      return Object.assign({ title: 'Shop', href: ECHO, canonical: canonical, textLen: 1000, textHash: 'h', scrollHeight: 2000, widgets: { chat: 0, banner: 0, modal: 0 } }, over || {});
    };
    r.links = [{ label: 'v0', role: 'preview', isControl: true, forcedIds: ['9101'], trackingFlags: [], loadId: 'L1', finalUrl: 'https://shop.example/shop/?optimizely_x=9101', loadError: null, blocked: null,
      probe: null, probeNote: null, track: null, facts: facts(controlCanonical, controlOver), noTrackServes: null }];
    r.controlVsProd = { controlLabel: 'v0', prodPath: 'https://shop.example/shop/', prodFinalUrl: 'https://shop.example/shop/', control: facts(controlCanonical, controlOver),
      prod: facts('https://shop.example/shop/', { href: 'https://shop.example/shop/' }), prodProbe: null, compare: null, skipped: null };
    r.controlVsProd.compare = qpCompareFacts(r.controlVsProd.control, r.controlVsProd.prod);
    r.checks = qpDeriveChecks(r, ctx);
    return r;
  }
  var echoPass = echoRecord(ECHO);
  var bPassCheck = echoPass.checks.filter(function (c) { return c.id === 'B.control-prod'; })[0];
  eq('an echoing canonical passes B', bPassCheck && bPassCheck.status, 'passed');
  var echoPassHtml = rptQaPassSection(entry(echoPass));
  ok('the report of that run has no optimizely_ text, no token and no fragment', !/optimizely_|SECRET|#h/.test(echoPassHtml), (echoPassHtml.match(/.{40}optimizely_.{40}/) || [])[0]);
  ok('B is in the Passed section', echoPassHtml.slice(echoPassHtml.indexOf('>Passed</h3>'), echoPassHtml.indexOf('>Needs PGM</h3>')).indexOf('B · Control matches PROD') !== -1);
  var echoFail = echoRecord(ECHO_OTHER, { title: 'Other shop' });
  var bFailCheck = echoFail.checks.filter(function (c) { return c.id === 'B.control-prod'; })[0];
  eq('a canonical on another path still fails B', bFailCheck && bFailCheck.status, 'failed');
  var echoFailHtml = rptQaPassSection(entry(echoFail));
  var echoBugs = echoFailHtml.slice(echoFailHtml.indexOf('>Bugs</h3>'), echoFailHtml.indexOf('>Passed</h3>'));
  ok('the Bugs section prints both canonical paths', echoBugs.indexOf('canonical &quot;https://shop.example/other/&quot; vs &quot;https://shop.example/shop/&quot;') !== -1
     || echoBugs.indexOf('canonical "https://shop.example/other/" vs "https://shop.example/shop/"') !== -1, echoBugs.slice(0, 600));
  ok('and no optimizely_ text, token or query anywhere in that report', !/optimizely_|SECRET/.test(echoFailHtml), (echoFailHtml.match(/.{40}optimizely_.{40}/) || [])[0]);
  var echoFull = buildReportBody({ ts: 1700000100000, pageUrls: abPageUrls([{ mode: 'qapass', data: echoFail }]), modes: [entry(echoFail)], extraHtml: '' });
  ok('the whole report of the failing run has none either', !/optimizely_|SECRET/.test(echoFull), (echoFull.match(/.{40}optimizely_.{40}/) || [])[0]);
  var echoDbg = JSON.stringify(taDebugSection(entry(echoFail)));
  ok('and the debug-log section has none (the Control facts\' canonical and href are by path)', !/optimizely_|SECRET/.test(echoDbg), (echoDbg.match(/.{40}optimizely_.{40}/) || [])[0]);
  ok('the debug section is not vacuous: it names the canonical path', echoDbg.indexOf('https://shop.example/other/') !== -1);

  // Fix loop 2, N1: error text that embeds the page's own URL. Chrome words some errors around it (executeScript:
  // `Cannot access contents of url "<URL>"` when the tester restricted Selenite's site access), and the URL of a preview link
  // carries optimizely_force_tracking, optimizely_x, _conv_eforce and a token. The worker stores the text scrubbed (the first
  // pass below); a record an older worker stored holds it raw (the second pass), and the notes, the problems list, the debug
  // section and the report must be clean for it too.
  var UE_FULL = 'https://shop.example/shop/?optimizely_x=9101&optimizely_force_tracking=true&_conv_eforce=1.2.9101&optimizely_token=SECRET#h';
  var UE_RAW = 'Cannot access contents of url "' + UE_FULL + '". Extension manifest must request permission to access this host.';
  var UE_CLEAN = 'Cannot access contents of url "https://shop.example/shop/". Extension manifest must request permission to access this host.';
  var UE_LEAK = /optimizely_|SECRET|_conv_eforce|#h\b/;
  var ueNoFlags = function (x) { return JSON.stringify(x, function (k, v) { return k === 'trackingFlags' ? undefined : v; }); };
  function urlErrRecord(scrubbed) {
    var T = scrubbed ? qpScrubUrls : function (x) { return x; };   // what the worker stores: scrubbed, or raw (an older worker)
    var r = build();
    r.error = T(UE_RAW);
    r.loads = [{ id: 'L1', role: 'preview', label: 'v0', path: 'https://shop.example/shop/', profile: 'desktop', width: 1440, ok: false, loadError: T(UE_RAW), blocked: null, finalUrl: null, ms: 5, settle: null, cleared: 0 }];
    r.links[0].loadError = T(UE_RAW);
    r.links[1].probeNote = T('The snippet probe could not be read after the page loaded (' + UE_RAW + ').');
    r.controlVsProd.skipped = T('The PROD page could not be read after the page loaded (' + UE_RAW + ').');
    r.controlVsProd.probeNote = T(UE_RAW);
    r.audiences = { experimentId: '9001', baselineActive: null, skipped: T('The ITW page did not load: ' + UE_RAW), tests: [{ n: 'x', probeNote: T(UE_RAW) }], notExercised: [] };
    r.combos = [{ link: 'v0', experimentId: '9002', variationId: '9201', url: 'https://shop.example/shop/?optimizely_x=9101,9201', loadId: 'L2', underTestActive: null, otherActive: null, textHash: null, aloneTextHash: null, changed: false, probeNote: T(UE_RAW) }];
    r.sweep.rows.push({ target: 'v0', role: 'variant', profile: 'desktop', width: 1280, mode: 'reload', loadId: 'L5', ok: false, loadError: T(UE_RAW), blocked: null, scan: null, tile: null },
      { target: 'v0', role: 'variant', profile: 'desktop', width: 1024, mode: 'reload', loadId: 'L6', ok: true, loadError: null, blocked: null, tile: null,
        scan: { error: T('The clipping scan could not run after the page loaded (' + UE_RAW + ')') } });
    r.checks = qpDeriveChecks(r, ctx);
    return r;
  }
  [true, false].forEach(function (scrubbed) {
    var nm = scrubbed ? 'stored scrubbed: ' : 'stored raw (older worker): ';
    var ue = urlErrRecord(scrubbed);
    ok(nm + 'the record holds what the worker stored (the raw one really holds the token)', scrubbed ? (!UE_LEAK.test(ue.links[0].loadError) && !UE_LEAK.test(ue.error) && ue.links[0].loadError === UE_CLEAN) : (/optimizely_token=SECRET/.test(ue.links[0].loadError) && /optimizely_token=SECRET/.test(ue.error)));
    var ueNotes = ue.checks.map(function (c) { return c.note; }).filter(function (n) { return typeof n === 'string'; });
    ok(nm + 'the derived check notes carry no forcing text', ueNotes.every(function (n) { return !UE_LEAK.test(n); }), ueNotes.filter(function (n) { return UE_LEAK.test(n); }));
    ok(nm + 'and the cleaned message is in at least four of them (not vacuous)', ueNotes.filter(function (n) { return n.indexOf(UE_CLEAN) !== -1; }).length >= 4, ueNotes.filter(function (n) { return n.indexOf('Cannot access') !== -1; }).length);
    var ueHtml = rptQaPassSection(entry(ue));
    ok(nm + 'the report section has no optimizely_ text, token, _conv_eforce or fragment', !UE_LEAK.test(ueHtml), (ueHtml.match(/.{40}(optimizely_|SECRET|_conv_eforce).{40}/) || [])[0]);
    ok(nm + 'it prints the cleaned message under Not tested', /Cannot access contents of url (&quot;|")https:\/\/shop\.example\/shop\/(&quot;|")\. Extension manifest must request permission/.test(ueHtml));
    ok(nm + 'and no query string anywhere in it', !/https?:\/\/[^\s<"]*\?/.test(ueHtml));
    var ueFull = buildReportBody({ ts: 1700000100000, pageUrls: abPageUrls([{ mode: 'qapass', data: ue }]), modes: [entry(ue)], extraHtml: '' });
    ok(nm + 'the whole report has none either', !UE_LEAK.test(ueFull), (ueFull.match(/.{40}(optimizely_|SECRET|_conv_eforce).{40}/) || [])[0]);
    var ueProblems = problems(ue);
    ok(nm + 'Run Diagnostics (the problems list) has none', !UE_LEAK.test(JSON.stringify(ueProblems)), JSON.stringify(ueProblems).match(/.{40}optimizely_.{40}/));
    ok(nm + 'and it still says what went wrong: the run error, the failed load, the sweep load, a probe note',
      findP(ueProblems, /^error qa-pass Cannot access contents of url "https:\/\/shop\.example\/shop\/"\./).length === 1
      && findP(ueProblems, /^warn qa-pass\/v0 Failed to load \(Cannot access contents of url "https:\/\/shop\.example\/shop\/"\./).length === 1
      && findP(ueProblems, /^warn qa-pass\/sweep 1 sweep load\(s\) failed \(Cannot access contents of url "https:\/\/shop\.example\/shop\/"\./).length === 1
      && findP(ueProblems, /^warn qa-pass\/v1 The snippet probe could not be read after the page loaded \(Cannot access contents of url "https:\/\/shop\.example\/shop\/"\./).length === 1, ueProblems.map(function (p) { return p.where + ' ' + p.detail.slice(0, 60); }));
    var ueDbg = ueNoFlags(taDebugSection(entry(ue)));
    ok(nm + 'the debug-log section has none (the flag NAMES a link lists apart)', !UE_LEAK.test(ueDbg), (ueDbg.match(/.{40}(optimizely_|SECRET|_conv_eforce).{40}/) || [])[0]);
    ok(nm + 'and is not vacuous: it holds the cleaned error', ueDbg.indexOf(JSON.stringify(UE_CLEAN).slice(1, -1)) !== -1);
    ok(nm + 'the summary projection (the AI summary reads it) has none', !UE_LEAK.test(JSON.stringify(qpSummaryProjection(ue))));
    ok(nm + 'nor the explain and mapping inputs', !UE_LEAK.test(JSON.stringify(qpExplainInput(ue, ctx, null, ''))) && !UE_LEAK.test(JSON.stringify(qpMapInput({ rows: [{ row: 4, text: 'Hero shows on mobile' }] }, ue.checks))));
  });

  // N5: a check note an older worker stored raw (its qpMk did not scrub). Every reader of c.note in the report scrubs it again:
  // Bugs, Needs PGM, Not tested, and the Sheet block's paste rows (qpPasteRows).
  var rawNote = build();
  rawNote.checks.forEach(function (c) { if (c.status !== 'passed') c.note = c.note + ' (' + UE_RAW + ')'; });
  ok('N5: the record really holds raw check notes (not vacuous)', rawNote.checks.filter(function (c) { return UE_LEAK.test(c.note); }).length >= 5);
  var rnHtml = rptQaPassSection(entry(rawNote));
  var rnSeg = function (a, b) { return rnHtml.slice(rnHtml.indexOf(a), b ? rnHtml.indexOf(b) : undefined); };
  var UE_CLEAN_RE = /Cannot access contents of url (&quot;|")https:\/\/shop\.example\/shop\/(&quot;|")/;
  ok('N5: the report section prints no forcing text from a raw check note', !UE_LEAK.test(rnHtml), (rnHtml.match(/.{40}(optimizely_|SECRET|_conv_eforce).{40}/) || [])[0]);
  ok('N5: Bugs prints the cleaned note', UE_CLEAN_RE.test(rnSeg('>Bugs</h3>', '>Passed</h3>')));
  ok('N5: Needs PGM prints the cleaned note', UE_CLEAN_RE.test(rnSeg('>Needs PGM</h3>', '>Not tested</h3>')));
  ok('N5: Not tested prints the cleaned note', UE_CLEAN_RE.test(rnSeg('>Not tested</h3>', '>Sheet changes</h3>')));
  ok('N5: the Sheet block\'s paste rows print the cleaned note', UE_CLEAN_RE.test(rnSeg('>Sheet changes</h3>')));

  // Wiring.
  var rb = slicePopup('function buildReportBody(sections) {', '\n// ── Debug log');
  ok('buildReportBody registers the section', rb.indexOf('qapass: rptQaPassSection,') !== -1);
  var bd = _pu.slice(_pu.indexOf('function buildDebugLog(sections) {'));
  ok('buildDebugLog carries the qaPass section', bd.indexOf("qaPass: taDebugSection(modeEntry('qapass'))") !== -1);
  ok('and describes it in the readme', bd.indexOf("The qaPass section is the Test Agent\\'s QA Pass record") !== -1);
  ok('vdCollectProblems routes the qapass entry to taModeProblems', _pu.slice(_pu.indexOf('function vdCollectProblems'), _pu.indexOf('function taModeProblems')).indexOf("entry.mode === 'qapass'") !== -1);
  ok('the existing queue registration is unchanged', /funnel: rptFunnelSection, queue: rptQueueSection,/.test(_pu));
  var full = buildReportBody({ ts: 1700000100000, pageUrls: abPageUrls([{ mode: 'qapass', data: rec }]), modes: [entry(rec)], extraHtml: '' });
  ok('the whole report builds with the section in it', full.indexOf('<h2>QA Pass (platform + layout)</h2>') !== -1 && full.indexOf('<li>https://shop.example/shop/</li>') !== -1);
  ok('and still prints no optimizely_ text', full.indexOf('optimizely_') === -1);
})();

// ── QA Pass: a record from the gate (Step 16) ───────────────────────────────
section('QA Pass: a record from the gate');
(function () {
  // fixtures-qapass-record.json is the `main` scenario's _qpLastRun from the real-Chrome gate
  // (tests/qapass-gate/gate.py: the real extension in real Chrome against the local fixture shop), with every
  // tile image replaced by a 4-byte stand-in. The expectations below are the status table the gate asserted
  // against the live page; the checks are COUNTED from the record, not typed. Regenerate by running the gate and
  // saving that scenario's record the same way.
  eval(slicePopup('function taModeProblems(entry, add) {', '\n// The debug-log section for a WCAG'));
  eval(slicePopup('function taDebugSection(entry) {', '\n// ONE projection for a finding'));
  eval(slicePopup('function buildReportBody(sections) {', '\n// ── Debug log'));
  var rptAbSection = function () { return ''; }, rptWcagSection = function () { return ''; }, rptFunnelSection = function () { return ''; };
  var rec = JSON.parse(readFile('fixtures-qapass-record.json'));
  var entry = { mode: 'qapass', name: 'QA Pass (platform + layout)', status: 'ran', data: rec };
  var html = rptQaPassSection(entry);
  var count = function (st) { return rec.checks.filter(function (c) { return c.status === st; }).length; };

  eq('the record is the 23-key shape', Object.keys(rec).length, 23);
  eq('written by version 1 of the worker', rec.version, 1);
  eq('the gate saw 19 checks', rec.checks.length, 19);
  eq('12 passed', count('passed'), 12);
  eq('5 failed', count('failed'), 5);
  eq('2 in progress', count('in-progress'), 2);
  eq('none blocked or not tested', count('blocked') + count('not-tested'), 0);
  eq('76 sweep rows (18 + 18 + 18 + 11 + 11)', rec.sweep.rows.length, 76);
  ok('the summary line carries the counted numbers', html.indexOf('5 bug(s) · 12 passed · 2 need PGM · 0 blocked · ' + rec.notTested.length + ' not tested') !== -1,
     (html.match(/rpt-summary">([^<]*)</) || [])[1]);
  ok('the badge says ISSUES FOUND', /rpt-badge-fail">ISSUES FOUND</.test(html));
  var heads = ['>Bugs</h3>', '>Passed</h3>', '>Needs PGM</h3>', '>Not tested</h3>', '>Sheet changes</h3>'].map(function (h) { return html.indexOf(h); });
  ok('the five headings are in order', heads.every(function (p, i) { return p !== -1 && (i === 0 || p > heads[i - 1]); }), heads);
  ok('no optimizely_ text anywhere (the real links carry optimizely_x and optimizely_force_tracking)', html.indexOf('optimizely_') === -1);
  ok('no query string in any printed url', !/https?:\/\/[^\s<"]*\?/.test(html));
  ok('the real link\'s forcing link is in the record, so the check above is not vacuous', JSON.stringify(rec.links).indexOf('optimizely_force_tracking') !== -1);
  var bugs = html.slice(html.indexOf('>Bugs</h3>'), html.indexOf('>Passed</h3>'));
  var order = ['E.v1.1', 'E.v0.1', 'E.v1.2', 'D.2', 'F.v1'].map(function (id) { return bugs.indexOf('<td>' + id + '<br>'); });
  ok('the five bugs are ordered high, low, low, then the two without a severity', order.every(function (p, i) { return p !== -1 && (i === 0 || p > order[i - 1]); }), order);
  var bugRow = function (id) { var i = bugs.indexOf('<td>' + id + '<br>'); return bugs.slice(i, bugs.indexOf('</tr>', i)); };
  ok('the legal line (E.v0.1, E.v1.2) carries the also-on-PROD marker and the hero (E.v1.1) does not',
     bugRow('E.v0.1').indexOf('<strong>also on PROD</strong>') !== -1 && bugRow('E.v1.2').indexOf('<strong>also on PROD</strong>') !== -1 && bugRow('E.v1.1').indexOf('<strong>also on PROD</strong>') === -1);
  var figs = bugs.match(/<figure[^]*?<\/figure>/g) || [];
  eq('every tile is a figure with its image', figs.length, rec.sweep.tiles.length);
  eq('eight tiles: four variant, four PROD', rec.sweep.tiles.length, 8);
  eq('every figure has an img', (bugs.match(/<img /g) || []).length, rec.sweep.tiles.length);
  var first = figs.findIndex(function (f) { return f.indexOf('v1 · iPhone · 360 px') !== -1; });
  ok('the PROD tile at 360 px comes right before the variant tile at 360 px', first > 0 && figs[first - 1].indexOf('PROD · iPhone · 360 px') !== -1, first);
  ok('the variant caption has the measured gap, the edge and the clipped text', /v1 · iPhone · 375 px · right edge −21 px · "CLIPPED-HERO/.test(bugs));
  var cover = abPageUrls([entry]);
  eq('the cover lists the one page', cover.length, 1);
  ok('by path, with no query', /^http:\/\/127\.0\.0\.1:\d+\/shop\/$/.test(cover[0]), cover);
  var problems = [];
  taModeProblems(entry, function (sev, where, detail) { problems.push([sev, where, detail]); });
  eq('the real run raised no problem (the gate saw none)', problems.length, 0);
  // #5 (D8): the gate's main run: 48 fresh visitors to the live page, PROD reloaded because its plain load showed no live experiment.
  var fvOf = typeof qpFreshVisitors === 'function' ? qpFreshVisitors : function () { return {}; };
  var fvG = fvOf(rec);
  eq('#5: the gate record made 48 fresh visitors (PROD 1, ITW 1, audience 6, PROD sweep 40), PROD reloaded', JSON.stringify([fvG.prod, fvG.itw, fvG.audience, fvG.prodSweep, fvG.total, fvG.prodMode, fvG.why]), JSON.stringify([1, 1, 6, 40, 48, 'reload', 'not-live']));
  ok('#5: and its report says so in the foot', html.indexOf('Fresh visitors: 48 load(s) of the live page as a new visitor (Selenite clears the Optimizely cookies before each): PROD 1, ITW 1, audience tests 6, PROD sweep 40. PROD was swept by reloading once per width: the plain PROD load showed no live experiment.') !== -1);
  var dbg = taDebugSection(entry);
  ok('the debug section carries every key of the projection', Object.keys(qpDebugProjection(rec)).every(function (k) { return k in dbg; }));
  ok('no image data in it, and no forcing parameter in any url', JSON.stringify(dbg).indexOf('data:image') === -1 && JSON.stringify(dbg).indexOf('optimizely_force_tracking=') === -1);
  eq('its tiles are listed with hasImage', dbg.sweep.tiles.filter(function (t) { return t.hasImage; }).length, 8);
  ok('the sheet block is the paste table (the gate context has no test plan link)', rec.sheet.connected === false && rec.sheet.reason === 'no-test-plan-link' && html.indexOf('The ticket has no QA test plan link.') !== -1 && html.indexOf('Auto QA (') !== -1);
  // The checks are a pure function of the recorded evidence: deriving them again from the real record gives what the worker stored.
  var wctx = { ticketKey: 'QP-1', experimentId: '9001', platform: 'Optimizely', controlId: 'v0',
    previewLinks: [{ id: 'v0', url: 'x' }, { id: 'v1', url: 'x' }], itwLink: 'x',
    goals: [{ text: 'Hero CTA click' }, { text: 'Purchase completed' }], softcodedTests: [{ ticketKey: 'QP-2', label: 'Softcoded promo' }], concurrentTests: [] };
  var recCopy = JSON.parse(JSON.stringify(rec));
  var again = qpDeriveChecks(recCopy, wctx);
  eq('qpDeriveChecks over the real record reproduces the stored checks', JSON.stringify(again), JSON.stringify(rec.checks));
  // Fix loop 2 (N4): the record was re-captured from a gate run of the final code, so its fixed Not-tested rows are today's 14, not the ten of the first run.
  eq('and the stored Not-tested rows too (the record is as current as the code that derives them)', JSON.stringify(recCopy.notTested), JSON.stringify(rec.notTested));
  eq('the record lists the 14 fixed rows', rec.notTested.length, 14);
  ok('among them the four of fix loop 1 (#7d)', ['X.custom-attributes', 'X.softcoded-ids', 'X.spec-page-id', 'X.concurrency-params'].every(function (id) { return rec.notTested.some(function (x) { return x.id === id; }); }));
  ok('with the softcoded row saying key or label, not "key only"', /ticket key \(or by label, when there is no key\)/.test((rec.notTested.filter(function (x) { return x.id === 'X.softcoded-ids'; })[0] || {}).reason || ''));
  ok('no error field of the real record carries a forcing parameter or a token (the stored text is scrubbed)', [rec.error].concat(rec.loads.map(function (l) { return l.loadError; }), rec.links.map(function (l) { return l.loadError; }), rec.links.map(function (l) { return l.probeNote; }),
    rec.sweep.rows.map(function (r) { return r.loadError || (r.scan && r.scan.error); }), rec.checks.map(function (c) { return c.note; })).every(function (t) { return !t || !/optimizely_|_conv_eforce|SECRET/.test(String(t)); }));
  var full = buildReportBody({ ts: rec.ts, pageUrls: cover, modes: [entry], extraHtml: '' });
  ok('and the whole report builds around it', full.indexOf('<h2>QA Pass (platform + layout)</h2>') !== -1 && full.indexOf('optimizely_') === -1);
})();

// ═══════════════════════════════════════════════════════════════════════════
// Email Check (Test Agent mode 'emailcheck'): the panel markup, the panel code and the report
// ═══════════════════════════════════════════════════════════════════════════
// SYNTHETIC DATA ONLY (the repository is public): tickets EX-1 and EX-2 of fixtures-email-*.json, org Example Relief, hosts under example.org.
// Every section below runs inside TE(): a function that throws (a bug) is ONE failure and the next section still runs.
function TE(title, fn) {
  section(title);
  var p0 = pass, f0 = fail;
  try { fn(); } catch (e) { fail++; failures.push(title + '  THREW ' + String(e && e.message ? e.message : e).slice(0, 200)); }
  print('  [' + (pass - p0) + ' passed, ' + (fail - f0) + ' failed]');
}
function jeqE(name, actual, expected) { var a = JSON.stringify(actual), e = JSON.stringify(expected); ok(name, a === e, { actual: a, expected: e }); }
// Sets the stubs as globals for the duration of fn (a promise-returning step is settled with settleE inside fn) and always restores them.
function withGlobals(stubs, fn) {
  var saved = {}, had = {};
  Object.keys(stubs).forEach(function (k) { had[k] = Object.prototype.hasOwnProperty.call(globalThis, k); saved[k] = globalThis[k]; globalThis[k] = stubs[k]; });
  try { return fn(); } finally { Object.keys(stubs).forEach(function (k) { if (had[k]) globalThis[k] = saved[k]; else delete globalThis[k]; }); }
}
function settleE(p) {
  var o = { done: false, v: undefined, err: undefined };
  Promise.resolve(p).then(function (v) { o.done = true; o.v = v; }, function (e) { o.done = true; o.err = e; });
  drainMicrotasks();
  // An async step that rejects instead of throwing is named in the failure list.
  if (o.err && /^stub DE-/.test(String(o.err && o.err.message))) { fail++; failures.push('an async step rejected: ' + o.err.message); }
  return o;
}
var EC_SRC_PANEL_FROM = "// ── Email Check (Test Agent mode 'emailcheck') — panel side", EC_SRC_PANEL_TO = "// ── QA Pass (Test Agent mode 'qapass') — panel side";
function ecPanelSrc() { return slicePopup(EC_SRC_PANEL_FROM, EC_SRC_PANEL_TO).replace(/^let _ecLastRun = null;/m, 'var _ecLastRun = null;'); }
function ecItemSrc(from) { var a = _pu.indexOf(from), b = _pu.indexOf('\n}\n', a + 1); if (a === -1 || b === -1) throw new Error('slice marker missing: ' + from); return _pu.slice(a, b) + '\n}'; }   // one function: from its signature to its closing brace at column 0

// adfText / adfTextWithHrefs as the Jira fixtures need them (the same slice email-check.test.js makes).
eval(_pu.slice(_pu.indexOf('function adfText(node) {'), _pu.indexOf('\n// Jira comments kept on the Test Context')));
function fxE(name) { return JSON.parse(readFile('fixtures-email-' + name + '.json')); }
var EC_JIRA = fxE('jira'), EC_PLANS = fxE('plans'), EC_PROOFS = fxE('proofs').tickets, EC_INTER = fxE('interstitials'), EC_EOA = fxE('eoa');
var EC_DOCS = { 'EX-1': fxE('doc-ex1'), 'EX-2': fxE('doc-ex2') };
var EC_REC_LOADED = false;
try { load('email-check-fixture-record.js'); EC_REC_LOADED = typeof ecTestRecord === 'function'; } catch (e) { EC_REC_LOADED = false; }
function ecFx() { return { proofs: EC_PROOFS, interstitials: EC_INTER, eoa: EC_EOA, jira: EC_JIRA, docs: EC_DOCS }; }

// A saved Test Context for a synthetic ticket, shaped as Initialize saves it (the Jira fixture parsed with the same functions extractTestContext uses).
function exCtx(tk, over) {
  var j = EC_JIRA[tk], jf = j.fields, links = ecParseEmailLinks(adfTextWithHrefs(jf.description));
  var copyKey = Object.keys(j.names).filter(function (k) { return j.names[k] === 'Copy File'; })[0];
  return Object.assign({
    reviewed: true, ticketKey: tk, summary: jf.summary, copyFileUrl: copyKey ? jf[copyKey] : null,
    emailProofs: links.proofs.map(function (p) { return { segment: p.segment, variation: p.variation, url: p.url }; }),
    emailEoa: links.eoa.map(function (e) { return { variation: e.variation, url: e.url }; }),
    comments: jf.comment.comments.map(function (c) { return { id: c.id, created: c.created, text: adfText(c.body) }; }),
    qaTestPlanUrl: jf.customfield_10686,
  }, over || {});
}

// The panel's world as plain objects: a DOM table, a scripted sendMessage, two storage maps, the session store.
function ecEnv() {
  var E = { els: {}, nodes: {}, all: {}, sent: [], replies: {}, store: { local: {}, sync: {} }, sessionSets: [], sessionGets: {}, confirms: [], confirmAnswer: true,
    ctx: null, intervals: [], cleared: 0, storageFails: false, setFails: false };
  function mkEl(id) {
    var listeners = {};
    return { id: id, textContent: '', innerHTML: '', value: '', checked: false, disabled: false, style: {}, dataset: {},
      addEventListener: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }, listeners: listeners,
      getAttribute: function (n) { return this.attrs ? this.attrs[n] : null; }, closest: function () { return null; }, matches: function () { return false; } };
  }
  E.mkEl = mkEl;
  E.el = function (id) { return E.els[id] || (E.els[id] = mkEl(id)); };
  function area(name) {
    return {
      get: function (keys) {
        if (E.storageFails) return Promise.reject(new Error('storage fault'));
        var o = {};
        (typeof keys === 'string' ? [keys] : keys).forEach(function (k) { if (k in E.store[name]) o[k] = JSON.parse(JSON.stringify(E.store[name][k])); });
        return Promise.resolve(o);
      },
      set: function (o) { if (E.setFails) return Promise.reject(new Error('quota')); Object.assign(E.store[name], JSON.parse(JSON.stringify(o))); return Promise.resolve(); },
    };
  }
  E.globals = function (extra) {
    return Object.assign({
      document: { getElementById: function (id) { return E.nodes[id] === null ? null : E.el(id); }, querySelectorAll: function (sel) { return E.all[sel] || []; }, querySelector: function (sel) { return E.nodes[sel] || null; } },
      chrome: { runtime: { sendMessage: function (msg) {
          E.sent.push(msg);
          var r = E.replies[msg.action];
          try { return Promise.resolve(typeof r === 'function' ? r(msg) : r); } catch (e) { return Promise.reject(e); }
        } },
        storage: { local: area('local'), sync: area('sync') },
        identity: { getRedirectURL: function () { return 'https://abc.chromiumapp.org/'; } } },
      getActiveContext: function () { return Promise.resolve(E.ctx); },
      sessionNS: { get: function (k) { var o = {}; if (k in E.sessionGets) o[k] = E.sessionGets[k]; return Promise.resolve(o); }, set: function (o) { E.sessionSets.push(o); return Promise.resolve(); } },
      WIN_ID: 7, _taStopRequested: false,
      setInterval: function (fn, ms) { E.intervals.push({ fn: fn, ms: ms }); return E.intervals.length; }, clearInterval: function () { E.cleared++; },
      confirm: function (m) { E.confirms.push(m); return E.confirmAnswer; },
    }, extra || {});
  };
  return E;
}

// ── Email Check: registration and panel ───────────────────────────────────
section('Email Check: registration and panel');

TE('Email Check panel: registration', function () {
  // emailcheck is a Test Agent mode that runs alone, like QA Pass and the funnel crawl: registered in TA_MODES, its settings body parked in
  // #ta-mode-homes, never offered in "Also Run", started by the init chain in its own try/catch.
  var E = ecEnv();
  withGlobals(E.globals({ rptAiSummarySection: function () { return ''; }, openReportTab: function (s) { E.opened = s; return Promise.resolve(); }, _taActiveBody: 'emailcheck', taQueuedExtra: new Set(), _ecLastRun: null }), function () {
    eval(slicePopup('const TA_MODES = {', '\nlet _taActiveBody').replace(/^const TA_MODES/, 'var TA_MODES'));
    eval(slicePopup('function taRenderMultiList() {', '\n// Sequential batch execution'));
    eval(slicePopup('async function runTestAgent() {', '\nfunction stopTestAgent('));
    var m = TA_MODES.emailcheck;
    ok('emailcheck is registered in TA_MODES', !!m);
    eq('  with its label', m && m.label, 'Email Check (Mailtrap + copy doc)');
    eq('  parking its body #ec-body', m && m.bodyId, 'ec-body');
    eq('  in #ta-mode-homes', m && m.homeParentId, 'ta-mode-homes');
    eq('  as a standalone mode', m && m.standalone, true);
    eq('  with an onShow', typeof (m && m.onShow), 'function');
    eq('  always configured (the context is read when it runs)', m && m.isConfigured(), true);
    ok('  its run and getData are functions', m && typeof m.run === 'function' && typeof m.getData === 'function');
    eq('the mode keys end with emailcheck, after qapass', Object.keys(TA_MODES).join(), '4,6,funnel,qapass,emailcheck');
    eq('  and its getData answers the last run (null before any)', m.getData(), null);
    var card = E.el('ta-multi-card'), list = E.el('ta-multi-list');
    globalThis._taActiveBody = 'emailcheck'; globalThis.taQueuedExtra.add('6');
    taRenderMultiList();
    eq('active emailcheck: the Also Run card is hidden', card.style.display, 'none');
    eq('  and anything queued is forgotten', globalThis.taQueuedExtra.size, 0);
    globalThis._taActiveBody = '4';
    taRenderMultiList();
    ok('active WCAG: Also Run offers Performance but not Email Check', list.innerHTML.indexOf('data-mode="6"') >= 0 && list.innerHTML.indexOf('emailcheck') < 0 && list.innerHTML.indexOf('Email Check') < 0, list.innerHTML);
    // runTestAgent drives it like any mode: the key stays a string and the record decides ran / failed.
    globalThis._taActiveBody = 'emailcheck'; globalThis.taQueuedExtra.clear();
    var rec = null;
    TA_MODES.emailcheck = { label: 'Email Check (Mailtrap + copy doc)', isConfigured: function () { return true; },
      run: function () { rec = { ts: Date.now(), version: 1, checks: [] }; return Promise.resolve({ ok: true }); }, getData: function () { return rec; } };
    var out = settleE(runTestAgent());
    ok('an emailcheck run settles', out.done && !out.err, out.err && String(out.err));
    eq('  its mode key is the string emailcheck', E.opened && E.opened.modes[0].mode, 'emailcheck');
    eq('  recorded as ran', E.opened && E.opened.modes[0].status, 'ran');
    rec = null; E.opened = null;
    TA_MODES.emailcheck.run = function () { return Promise.resolve({ ok: false, error: 'No active ticket context — set one in the Initialize tab.' }); };
    settleE(runTestAgent());
    eq('a run that fails (no context) says so in the status line', E.el('ta-status').textContent, 'Email Check (Mailtrap + copy doc) failed: No active ticket context — set one in the Initialize tab.');
    eq('  and no report is opened for it', E.opened, null);
  });
  var real = slicePopup('const TA_MODES = {', '\nlet _taActiveBody');
  ok('the registration calls runEmailCheckMode, ecUiOnShow and _ecLastRun (the names the panel block defines)', /run: \(\) => runEmailCheckMode\(\)/.test(real) && /ecUiOnShow\(\)\.catch\(\(\) => \{\}\)/.test(real) && /getData: \(\) => _ecLastRun/.test(real));
  // The init chain.
  var handler = slicePopup("document.addEventListener('DOMContentLoaded', async () => {", "\n// ── Pin: dock in Chrome's side panel");
  ok('the init chain starts Email Check in its own try/catch', /try \{\s*await initEmailCheck\(\);\s*\} catch \(e\) \{\s*console\.error\('Selenite: Email Check failed to initialize/.test(handler));
  ok('  after QA Pass', handler.indexOf('await initEmailCheck()') > handler.indexOf('await initQaPass()'));
  ok('  and before the Settings overlay is bound', handler.indexOf('await initEmailCheck()') < handler.indexOf("getElementById('settings-overlay')"));
  ok('the only await initEmailCheck in the handler is the guarded one', handler.split('await initEmailCheck()').length === 2);
  ok('initQaPass is still started once, guarded', handler.split('await initQaPass()').length === 2);
  // Structure: where the block sits and what names it defines.
  var all = _pu;
  ok('the panel block starts with its heading and declares `let _ecLastRun = null;`', all.indexOf(EC_SRC_PANEL_FROM) >= 0 && all.indexOf('let _ecLastRun = null;') > all.indexOf(EC_SRC_PANEL_FROM) && all.indexOf('let _ecLastRun = null;') < all.indexOf(EC_SRC_PANEL_TO));
  ok('  immediately before QA Pass\'s panel block (outside every existing slice)', all.indexOf(EC_SRC_PANEL_FROM) < all.indexOf(EC_SRC_PANEL_TO) && all.indexOf(EC_SRC_PANEL_FROM) > all.indexOf('async function runFunnelCrawl()'));
  var names = ['ecUiEl', 'ecUiReadSettings', 'ecUiApplyPrefs', 'ecUiSavePrefs', 'ecUiRenderCtx', 'ecUiRenderRules', 'ecUiSaveRules', 'runEmailCheckMode', 'ecUiPrepareSheet', 'ecUiRecount',
    'ecUiRenderResults', 'ecUiShowApplied', 'ecUiPersistLast', 'ecUiOnResultsChange', 'ecUiOnResultsClick', 'ecUiApply', 'ecUiRefreshSheet', 'ecUiConnectGoogle', 'ecUiDisconnectGoogle', 'ecUiOnShow', 'initEmailCheck'];
  names.forEach(function (n) { ok('popup.js defines ' + n + ' exactly once', new RegExp('(^|\\n)(?:async )?function ' + n + '\\(').test(all) && all.split(new RegExp('(?:^|\\n)(?:async )?function ' + n + '\\(')).length === 2); });
  ok('no top-level ec[A-Z] or EC_ definition other than ecUi* and the listed names', !/(^|\n)(?:async )?function ec(?!Ui)[A-Z]\w*\(/.test(all) && !/(^|\n)(?:const|let|var) (?:EC_|ec(?!Ui)[A-Z])/.test(all));
  ok('the panel block names no model id and no Jira write route', !/claude-|\/rest\/api\/|transitionIssue|addComment/.test(ecPanelSrc()));
});

TE('Email Check panel: markup (both panels)', function () {
  var files = { 'popup.html': readFile('../popup.html'), 'sidepanel.html': readFile('../sidepanel.html') };
  var region = function (h) { var a = h.indexOf('id="ec-body"'), b = h.indexOf('id="ec-results"'); return a < 0 || b < 0 ? '' : h.slice(h.lastIndexOf('<div', a), h.indexOf('</div>', b) + 6); };
  var A = region(files['popup.html']), B = region(files['sidepanel.html']);
  ok('the #ec-body region is found in both panels and is byte-identical', A.length > 2000 && A === B, [A.length, B.length]);
  Object.keys(files).forEach(function (f) {
    var h = files[f];
    eq(f + ': one email-check.js script tag', h.split('<script src="email-check.js"></script>').length - 1, 1);
    ok(f + ': between qa-pass.js and popup.js', h.indexOf('<script src="qa-pass.js"></script>') < h.indexOf('<script src="email-check.js"></script>') && h.indexOf('<script src="email-check.js"></script>') < h.indexOf('<script src="popup.js"></script>'));
    eq(f + ': one emailcheck option, right after qapass, with its label', h.split('<option value="emailcheck">Email Check (Mailtrap + copy doc)</option>').length - 1, 1);
    ok('  ' + f + ': the option follows the qapass one', h.indexOf('<option value="qapass">') < h.indexOf('<option value="emailcheck">') && h.indexOf('<option value="emailcheck">') < h.indexOf('</select>', h.indexOf('<option value="emailcheck">')));
    ok(f + ': #ec-body sits inside #ta-mode-homes, after #qp-body and before the Also Run card', h.indexOf('id="ta-mode-homes"') < h.indexOf('id="qp-body"') && h.indexOf('id="qp-results"') < h.indexOf('id="ec-body"') && h.indexOf('id="ec-results"') < h.indexOf('id="ta-multi-card"'));
    ['ec-body', 'ec-ctx', 'ec-profile', 'ec-utm-rule', 'ec-utm-hint', 'ec-seg-paths', 'ec-rule-hint', 'ec-doc-email', 'ec-eoa-renders', 'ec-sheet-status', 'btn-ec-google-connect', 'btn-ec-google-disconnect', 'ec-sheet-tab', 'ec-write-notes', 'ec-retest-inprogress', 'ec-progress', 'ec-results'].forEach(function (id) {
      eq(f + ': id ' + id + ' once', h.split('id="' + id + '"').length - 1, 1);
    });
    ok(f + ': the profile select holds only the automatic option (the others are filled from EC_PROFILES at runtime)', /<select id="ec-profile">\s*<option value="" selected>Auto \(from ticket\)<\/option>\s*<\/select>/.test(h));
    Object.keys(EC_PROFILES).forEach(function (k) {
      var pr = EC_PROFILES[k];
      ok(f + ': the markup carries no label, name, domain or id of the "' + k + '" profile', [pr.label, pr.orgName, pr.orgDomain].filter(Boolean).every(function (s) { return h.indexOf(s) < 0; }) && A.indexOf('value="' + pr.id + '"') < 0, pr.label);
    });
    var names = [];
    Object.keys(EC_PROFILES).forEach(function (k) { var pr = EC_PROFILES[k]; [pr.id, pr.label, pr.orgName, pr.orgDomain].concat((pr.segments || []).map(function (s) { return s.name; }), (pr.segments || []).map(function (s) { return s.greeting; }), pr.pardotHosts || []).forEach(function (s) { if (s && names.indexOf(s) < 0) names.push(s); }); });
    ok(f + ': nothing a profile names (id, label, organisation, domain, segment, greeting, host) appears in the ec region', names.length > 6 && names.every(function (s) { return A.toLowerCase().indexOf(String(s).toLowerCase()) < 0; }), names.filter(function (s) { return A.toLowerCase().indexOf(String(s).toLowerCase()) >= 0; }));
    ok(f + ': the UTM select has the three rules', /<select id="ec-utm-rule">\s*<option value="" selected>Not stated \(UTM row stays In Progress\)<\/option>\s*<option value="identical">Identical between versions<\/option>\s*<option value="suffix">utm_content ends -v0 \/ -v1 per version<\/option>\s*<\/select>/.test(h));
    ok(f + ': the copy-doc email is a number input, min 1, placeholder auto', /<input type="number" id="ec-doc-email" min="1" placeholder="auto"/.test(h));
    ok(f + ': EoA renders on by default, notes on, re-test off', /id="ec-eoa-renders" checked>Capture Email on Acid renders for the report \(opens each EoA page in a tab\)/.test(h) && /id="ec-write-notes" checked>Write notes \(V0 \/ Segment \| Device \| finding\)/.test(h) && /<input type="checkbox" id="ec-retest-inprogress">Re-test In Progress cells/.test(h));
    ok(f + ': Disconnect starts hidden, the tab select starts disabled', /id="btn-ec-google-disconnect" type="button" style="display:none"/.test(h) && /<select id="ec-sheet-tab" disabled><option value="">—<\/option><\/select>/.test(h));
    ok(f + ': the card says nothing is written until Apply and never to Jira', h.indexOf('Nothing is written to the sheet until you review the proposed changes after a run and click Apply. Selenite never writes to Jira.') > 0);
    ok(f + ': the description states the never-open promise', h.indexOf("Uses this Chrome's own Mailtrap sign-in (never signs in for you), resolves each Pardot link once, never opens Unsubscribe or View-in-browser links.") > 0);
    ok(f + ': #set-google is retitled and carries the Docs sentence once', h.indexOf('<div class="card-title">Google Sheets and Docs (QA Pass, Email Check)</div>') > 0 && h.split("Email Check also reads the ticket's copy doc (Google Docs, read-only); after this permission was added, connect once more.").length === 2 && h.indexOf('Google Sheets (QA Pass)') < 0);
    ok(f + ': the QA Pass body is untouched (still one #qp-body, one #qp-results)', h.split('id="qp-body"').length === 2 && h.split('id="qp-results"').length === 2);
  });
  // popup.html and sidepanel.html differ only in the layout CSS and the markup the side panel adds; the DOM contract of the mode is the same.
  ok('both panels hold the same number of ec- ids', (files['popup.html'].match(/id="(?:btn-)?ec-/g) || []).length === (files['sidepanel.html'].match(/id="(?:btn-)?ec-/g) || []).length);
});

TE('Email Check panel: the profile options come from EC_PROFILES', function () {
  var E = ecEnv();
  withGlobals(E.globals(), function () {
    eval(ecPanelSrc());
    // ecUiFillProfiles is the only source of the select's options.
    var offered = Object.keys(EC_PROFILES).map(function (k) { return EC_PROFILES[k]; }).filter(function (p) { return !p.hidden; });
    ok('EC_PROFILES has a hidden profile (the synthetic organisation) and at least two offered ones', offered.length >= 2 && offered.length < Object.keys(EC_PROFILES).length, offered.map(function (p) { return p.id; }));
    E.el('ec-profile').value = '';
    ecUiFillProfiles();
    var want = '<option value="">Auto (from ticket)</option>' + offered.map(function (p) { return '<option value="' + qpEsc(p.id) + '">' + qpEsc(p.label) + '</option>'; }).join('');
    eq('the options are the automatic one, then every profile that is not hidden, in EC_PROFILES order', E.el('ec-profile').innerHTML, want);
    ok('  a hidden profile is never offered', Object.keys(EC_PROFILES).every(function (k) { return !EC_PROFILES[k].hidden || E.el('ec-profile').innerHTML.indexOf('value="' + EC_PROFILES[k].id + '"') < 0 && E.el('ec-profile').innerHTML.indexOf(EC_PROFILES[k].label) < 0; }));
    ok('  the generic profile is offered by its label', E.el('ec-profile').innerHTML.indexOf('<option value="generic">' + EC_PROFILES.generic.label + '</option>') >= 0);
    // a label is escaped
    var saved = EC_PROFILES.generic.label; EC_PROFILES.generic.label = 'A <b>"x"</b> & y';
    try { ecUiFillProfiles(); ok('  labels and ids are escaped', E.el('ec-profile').innerHTML.indexOf('<b>') < 0 && E.el('ec-profile').innerHTML.indexOf('A &lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y') >= 0, E.el('ec-profile').innerHTML); }
    finally { EC_PROFILES.generic.label = saved; }
    // a chosen profile that is still offered is kept; one that is not is dropped
    E.el('ec-profile').value = 'generic'; ecUiFillProfiles();
    eq('a stored choice that is still offered is kept', E.el('ec-profile').value, 'generic');
    E.el('ec-profile').value = 'example'; ecUiFillProfiles();
    ok('the hidden profile can never be kept as a choice', E.el('ec-profile').value !== 'example', E.el('ec-profile').value);
    E.nodes['ec-profile'] = null;
    var threw = false; try { ecUiFillProfiles(); } catch (e) { threw = true; }
    ok('a missing select is not an error', !threw);
  });
});

TE('Email Check panel: settings', function () {
  var E = ecEnv();
  withGlobals(E.globals(), function () {
    eval(ecPanelSrc());
    var ctx = exCtx('EX-2');
    function seg(name, value, source, comment) { var i = E.mkEl('seg-' + name); i.value = value; i.dataset = { ecSeg: name, source: source, comment: comment }; return i; }
    // ecUiReadSettings: the record's settings, read from the DOM and the ticket comments
    E.el('ec-profile').value = ''; E.el('ec-doc-email').value = ' 2 '; E.el('ec-eoa-renders').checked = true;
    E.el('ec-utm-rule').value = 'suffix'; E.el('ec-utm-rule').dataset = { source: 'suggested', comment: '420001' };
    E.all['#ec-seg-paths input[data-ec-seg]'] = [seg('Regular Donors', ' seed-kits ', 'suggested', '420003'), seg('Major Donors', '', 'suggested', '420003')];
    var s = ecUiReadSettings(ctx);
    jeqE('settings: exactly the six keys of the record settings', Object.keys(s).sort(), ['docEmail', 'eoaRenders', 'onlyIn', 'profileId', 'segmentPaths', 'utmRule']);
    eq('settings: profileId is the select value (auto = empty)', s.profileId, '');
    eq('settings: docEmail is a positive integer', s.docEmail, 2);
    eq('settings: eoaRenders from the checkbox', s.eoaRenders, true);
    jeqE('settings: a suggested UTM rule keeps its comment', s.utmRule, { value: 'suffix', source: 'suggested', commentId: '420001' });
    jeqE('settings: segment paths: trimmed, empty ones left out, provenance kept', s.segmentPaths, { 'Regular Donors': { value: 'seed-kits', source: 'suggested', commentId: '420003' } });
    jeqE('settings: onlyIn comes from the comments (read-only hint)', s.onlyIn, { expect: { v0: ['DONATE NOW'], v1: ['HELP NOW'] }, commentId: '420001' });
    // a tester's edit, and the odd values
    E.el('ec-utm-rule').value = 'identical'; E.el('ec-utm-rule').dataset = { source: 'tester', comment: '' };
    E.all['#ec-seg-paths input[data-ec-seg]'] = [seg('Regular Donors', 'give-regular', 'tester', ''), seg('Major Donors', 'x', undefined, undefined)];
    E.el('ec-profile').value = 'generic'; E.el('ec-doc-email').value = '1.5'; E.el('ec-eoa-renders').checked = false;
    s = ecUiReadSettings(ctx);
    jeqE('settings: a tester\'s UTM rule has no comment', s.utmRule, { value: 'identical', source: 'tester', commentId: null });
    jeqE('settings: tester paths, and an input with no provenance counts as the tester\'s', s.segmentPaths, { 'Regular Donors': { value: 'give-regular', source: 'tester', commentId: null }, 'Major Donors': { value: 'x', source: 'tester', commentId: null } });
    eq('settings: profile generic', s.profileId, 'generic');
    eq('settings: a non-integer doc email is null', s.docEmail, null);
    eq('settings: renders off', s.eoaRenders, false);
    ['0', '-3', 'abc', ''].forEach(function (v) { E.el('ec-doc-email').value = v; eq('settings: doc email "' + v + '" is null', ecUiReadSettings(ctx).docEmail, null); });
    E.el('ec-utm-rule').value = 'bogus'; E.el('ec-utm-rule').dataset = { source: 'tester' };
    jeqE('settings: an unknown UTM value is "not stated"', ecUiReadSettings(ctx).utmRule, { value: '', source: 'none', commentId: null });
    E.el('ec-utm-rule').value = ''; E.el('ec-utm-rule').dataset = { source: 'suggested', comment: '9' };
    jeqE('settings: an empty UTM rule has source none whatever its provenance', ecUiReadSettings(ctx).utmRule, { value: '', source: 'none', commentId: null });
    jeqE('settings: with no context onlyIn is null', ecUiReadSettings(null).onlyIn, null);
    E.nodes['ec-profile'] = null; E.nodes['ec-eoa-renders'] = null; E.nodes['ec-doc-email'] = null; E.nodes['ec-utm-rule'] = null;
    var bare = ecUiReadSettings(ctx);
    ok('settings: with every control missing: auto profile, renders on, no doc email, no UTM rule', bare.profileId === '' && bare.eoaRenders === true && bare.docEmail === null && bare.utmRule.value === '', bare);
    E.nodes = {};
    // ecUiApplyPrefs
    ecUiApplyPrefs({ profileChoice: 'generic', eoaRenders: false, writeNotes: false, retestInProgress: true });
    ok('prefs: the select and the three boxes are applied', E.el('ec-profile').value === 'generic' && E.el('ec-eoa-renders').checked === false && E.el('ec-write-notes').checked === false && E.el('ec-retest-inprogress').checked === true);
    E.el('ec-write-notes').checked = true; E.el('ec-profile').value = '';
    ecUiApplyPrefs({ profileChoice: 7, eoaRenders: 'yes', writeNotes: null });
    ok('prefs: wrong types are skipped', E.el('ec-profile').value === '' && E.el('ec-eoa-renders').checked === false && E.el('ec-write-notes').checked === true);
    ecUiApplyPrefs(undefined); ecUiApplyPrefs(null); ecUiApplyPrefs('x');
    ok('prefs: nothing stored is fine', true);
    E.nodes['ec-write-notes'] = null;
    var threw = false; try { ecUiApplyPrefs({ writeNotes: true, eoaRenders: true }); } catch (e) { threw = true; }
    ok('prefs: a missing element never throws', !threw);
    E.nodes = {};
    // ecUiSavePrefs
    E.ctx = exCtx('EX-1');
    E.store.local.ecSheetPrefs = { OTHERSHEET0000000000000: { tabTitle: 'Keep me' } };
    E.el('ec-profile').value = 'generic'; E.el('ec-eoa-renders').checked = true; E.el('ec-write-notes').checked = false; E.el('ec-retest-inprogress').checked = true; E.el('ec-sheet-tab').value = 'QA Round 1';
    var p = settleE(ecUiSavePrefs());
    ok('save prefs: resolves', p.done && !p.err, p.err && String(p.err));
    jeqE('save prefs: ecSettings holds the four values', E.store.local.ecSettings, { profileChoice: 'generic', eoaRenders: true, writeNotes: false, retestInProgress: true });
    var sid = 'EXPLAN_EX1_TEST_PLAN_00000000001';
    jeqE('save prefs: the picked tab is remembered for this spreadsheet', E.store.local.ecSheetPrefs[sid], { tabTitle: 'QA Round 1' });
    jeqE('save prefs: other spreadsheets are kept', E.store.local.ecSheetPrefs.OTHERSHEET0000000000000, { tabTitle: 'Keep me' });
    E.el('ec-sheet-tab').value = '';
    settleE(ecUiSavePrefs());
    jeqE('save prefs: no tab picked keeps the previous entry', E.store.local.ecSheetPrefs[sid], { tabTitle: 'QA Round 1' });
    E.ctx = null; E.store.local = {};
    settleE(ecUiSavePrefs());
    ok('save prefs: with no context only ecSettings is written', !!E.store.local.ecSettings && !E.store.local.ecSheetPrefs);
    E.setFails = true;
    var rj = settleE(ecUiSavePrefs());
    ok('save prefs: a failing write never rejects', rj.done && !rj.err, rj.err && String(rj.err));
    E.setFails = false;
  });
});

TE('Email Check panel: context and rules', function () {
  var E = ecEnv();
  withGlobals(E.globals(), function () {
    eval(ecPanelSrc());
    // ecUiRenderCtx
    E.ctx = exCtx('EX-1');
    var r = settleE(ecUiRenderCtx());
    eq('ctx line: EX-1 (4 proofs, 2 EoA, a copy doc, a sheet, 5 comments, the synthetic profile)', E.el('ec-ctx').textContent, 'EX-1 · 4 Mailtrap proof(s) · 2 Email on Acid link(s) · copy doc: yes · test plan: Google Sheet · profile: Example Relief (synthetic test data) · 5 comment(s)');
    eq('  it returns the context', r.v && r.v.ticketKey, 'EX-1');
    E.ctx = exCtx('EX-2');
    settleE(ecUiRenderCtx());
    eq('ctx line: EX-2 has no Copy File', E.el('ec-ctx').textContent, 'EX-2 · 4 Mailtrap proof(s) · 2 Email on Acid link(s) · copy doc: no · test plan: Google Sheet · profile: Example Relief (synthetic test data) · 4 comment(s)');
    E.ctx = exCtx('EX-2', { copyFileUrl: 'https://www.example.org/not-a-doc', qaTestPlanUrl: 'https://www.example.org/plan', comments: undefined });
    E.el('ec-profile').value = 'generic';
    settleE(ecUiRenderCtx());
    eq('ctx line: a non-doc link, a non-sheet link, no comments, the chosen profile', E.el('ec-ctx').textContent, 'EX-2 · 4 Mailtrap proof(s) · 2 Email on Acid link(s) · copy doc: not a Google Doc link · test plan: other link · profile: Generic email · 0 comment(s)');
    E.ctx = exCtx('EX-2', { qaTestPlanUrl: null });
    settleE(ecUiRenderCtx());
    ok('ctx line: no test plan link says none', /test plan: none/.test(E.el('ec-ctx').textContent));
    E.ctx = null;
    r = settleE(ecUiRenderCtx());
    eq('ctx line: no context', E.el('ec-ctx').textContent, 'No active ticket context — set one in the Initialize tab.');
    eq('  and it returns null', r.v, null);
    E.ctx = exCtx('EX-1'); delete E.ctx.emailProofs;
    settleE(ecUiRenderCtx());
    eq('ctx line: a context saved before Email Check', E.el('ec-ctx').textContent, 'Re-run Initialize on the ticket: this saved context has no Mailtrap proof links.');
    E.ctx = exCtx('EX-1', { emailProofs: [] });
    settleE(ecUiRenderCtx());
    eq('ctx line: no proofs', E.el('ec-ctx').textContent, 'The active ticket context lists no Mailtrap proofs: add them in the Initialize tab.');
    E.nodes['ec-ctx'] = null; E.ctx = exCtx('EX-1');
    eq('ctx line: a missing element still returns the context', (settleE(ecUiRenderCtx()).v || {}).ticketKey, 'EX-1');
    E.nodes = {}; E.els = {};

    // ecUiRenderRules: suggestions from the comments (EX-2: the newer comment's paths, onlyIn from the first)
    E.el('ec-profile').value = '';
    var ex2 = exCtx('EX-2');
    var rr = settleE(ecUiRenderRules(ex2));
    ok('rules: resolves', rr.done && !rr.err, rr.err && String(rr.err));
    eq('rules: the UTM select takes the suggested rule', E.el('ec-utm-rule').value, 'suffix');
    jeqE('  with its comment as provenance', [E.el('ec-utm-rule').dataset.source, E.el('ec-utm-rule').dataset.comment], ['suggested', '420001']);
    eq('  and says where it came from', E.el('ec-utm-hint').textContent, 'suggested from comment 420001');
    var h = E.el('ec-seg-paths').innerHTML;
    ok('rules: one row per segment, in the documented markup', h.indexOf('<div class="arg-row"><span class="arg-lbl">Regular Donors DONATE</span><input type="text" data-ec-seg="Regular Donors" value="seed-kits" data-source="suggested" data-comment="420003" placeholder="path or last segment"></div>') >= 0, h);
    ok('  the second segment likewise, from the same (newer) comment', h.indexOf('data-ec-seg="Major Donors" value="seed-kits-major" data-source="suggested" data-comment="420003"') >= 0, h);
    eq('  exactly two rows', h.split('<div class="arg-row">').length - 1, 2);
    var hint = E.el('ec-rule-hint').innerHTML;
    ok('rules: the hint names each segment\'s source', hint.indexOf('Regular Donors: suggested from comment 420003') >= 0 && hint.indexOf('Major Donors: suggested from comment 420003') >= 0, hint);
    ok('  and the onlyIn rule with its comment', hint.indexOf('Only in V0: DONATE NOW; only in V1: HELP NOW (comment 420001)') >= 0, hint);
    ok('  parts are joined by <br>', hint.split('<br>').length === 3, hint);
    eq('rules: no stored doc email leaves the field empty', E.el('ec-doc-email').value, '');
    // EX-1: identical, nothing else
    settleE(ecUiRenderRules(exCtx('EX-1')));
    eq('rules EX-1: identical', E.el('ec-utm-rule').value, 'identical');
    eq('  suggested from its comment', E.el('ec-utm-hint').textContent, 'suggested from comment 410001');
    hint = E.el('ec-rule-hint').innerHTML;
    ok('  both segments say no path was found', hint.indexOf('Regular Donors: no path found in the ticket comments') >= 0 && hint.indexOf('Major Donors: no path found in the ticket comments') >= 0, hint);
    ok('  and no onlyIn rule was found', hint.indexOf('No &quot;only in&quot; rule found in the comments.') >= 0, hint);
    ok('  the rows are empty with no provenance', E.el('ec-seg-paths').innerHTML.indexOf('value="" data-source="" data-comment=""') >= 0);
    // a stored rule beats a suggestion
    E.store.local.ecTicketRules = { 'EX-2': { utmRule: 'identical', segmentPaths: { 'Regular Donors': 'give-regular', 'Major Donors': '' }, docEmail: 2 } };
    settleE(ecUiRenderRules(ex2));
    eq('stored: the UTM rule wins', E.el('ec-utm-rule').value, 'identical');
    jeqE('  as the tester\'s', [E.el('ec-utm-rule').dataset.source, E.el('ec-utm-rule').dataset.comment], ['tester', '']);
    eq('  hint', E.el('ec-utm-hint').textContent, 'set by you');
    h = E.el('ec-seg-paths').innerHTML;
    ok('stored: a stored path wins over the newer comment\'s suggestion', h.indexOf('data-ec-seg="Regular Donors" value="give-regular" data-source="tester"') >= 0, h);
    ok('  and a stored empty path stays empty (a deliberate choice)', h.indexOf('data-ec-seg="Major Donors" value="" data-source=""') >= 0, h);
    eq('stored: the doc email', E.el('ec-doc-email').value, '2');
    E.store.local.ecTicketRules = { 'EX-2': { utmRule: '' } };
    settleE(ecUiRenderRules(ex2));
    jeqE('stored: an empty UTM rule is "not stated", not the suggestion', [E.el('ec-utm-rule').value, E.el('ec-utm-rule').dataset.source], ['', '']);
    ok('  paths not stored fall back to the suggestions', E.el('ec-seg-paths').innerHTML.indexOf('value="seed-kits" data-source="suggested"') >= 0);
    E.store.local.ecTicketRules = { 'EX-1': { utmRule: 'suffix' } };
    settleE(ecUiRenderRules(ex2));
    eq('stored: another ticket\'s rules are not used', E.el('ec-utm-rule').value, 'suffix');
    // escaping: a segment name with markup
    var evil = exCtx('EX-2'); evil.emailProofs = evil.emailProofs.map(function (p, i) { return { segment: i < 2 ? 'A"><img src=x>' : p.segment, variation: p.variation, url: p.url }; });
    settleE(ecUiRenderRules(evil));
    ok('rules: a segment name is escaped in the label and the attribute', E.el('ec-seg-paths').innerHTML.indexOf('<img') < 0 && E.el('ec-seg-paths').innerHTML.indexOf('A&quot;&gt;&lt;img src=x&gt;') >= 0, E.el('ec-seg-paths').innerHTML);
    // a storage fault leaves the suggestions in place
    E.store.local = {}; E.storageFails = true;
    var sf = settleE(ecUiRenderRules(ex2));
    ok('rules: a storage fault does not reject and the suggestions still show', sf.done && !sf.err && E.el('ec-utm-rule').value === 'suffix', sf.err && String(sf.err));
    E.storageFails = false;
    // no / invalid context clears everything
    settleE(ecUiRenderRules(null));
    ok('rules: no context clears the rows, hints, rule and doc email', E.el('ec-seg-paths').innerHTML === '' && E.el('ec-utm-hint').textContent === '' && E.el('ec-rule-hint').innerHTML === '' && E.el('ec-utm-rule').value === '' && E.el('ec-doc-email').value === '');
    E.el('ec-seg-paths').innerHTML = 'x'; settleE(ecUiRenderRules(exCtx('EX-2', { emailProofs: [] })));
    eq('rules: a context with no proofs clears too', E.el('ec-seg-paths').innerHTML, '');

    // ecUiSaveRules
    E.ctx = ex2; E.store.local = { ecTicketRules: { 'EX-9': { utmRule: 'identical' } } };
    E.el('ec-utm-rule').value = 'suffix'; E.el('ec-doc-email').value = '3';
    function seg(name, value) { var i = E.mkEl('s-' + name); i.value = value; i.dataset = { ecSeg: name }; return i; }
    E.all['#ec-seg-paths input[data-ec-seg]'] = [seg('Regular Donors', ' seed-kits '), seg('Major Donors', '')];
    settleE(ecUiSaveRules());
    jeqE('save rules: the ticket\'s rules, empty paths included', E.store.local.ecTicketRules['EX-2'], { utmRule: 'suffix', segmentPaths: { 'Regular Donors': 'seed-kits', 'Major Donors': '' }, docEmail: 3 });
    jeqE('save rules: other tickets are kept', E.store.local.ecTicketRules['EX-9'], { utmRule: 'identical' });
    E.el('ec-doc-email').value = ''; settleE(ecUiSaveRules());
    eq('save rules: no doc email is null', E.store.local.ecTicketRules['EX-2'].docEmail, null);
    E.ctx = null; E.store.local = {};
    var rs = settleE(ecUiSaveRules());
    ok('save rules: with no context nothing is written and nothing rejects', rs.done && !rs.err && !E.store.local.ecTicketRules);
  });
});

// A hand-built record (19 keys, version 1): two proofs of EX-2's first segment, four checks. Independent of the code that derives real ones.
function ecCk(key, proofId, status, note, over) {
  return Object.assign({ id: key + '@' + proofId, key: key, proofId: proofId, title: 'Title of ' + key, status: status, note: note || '', fyi: null, blockedBy: null, evidence: {} }, over || {});
}
function ecHandRecord(over) {
  var rec = {
    version: 1, ts: null, startedAt: 1800000000000, finishedAt: 1800000001000, stopped: false, error: null, ticketKey: 'EX-2', summary: 'Spring Seed Kits: Last Call', profileId: 'example',
    settings: { profileId: '', docEmail: null, eoaRenders: true, utmRule: { value: 'suffix', source: 'suggested', commentId: '420001' }, segmentPaths: {}, onlyIn: null },
    sources: { doc: { state: 'ok', title: 'Spring seed kits copy', emails: [], chosen: 1, error: null }, mailtrap: { state: 'ok', error: null },
      eoa: [{ variation: 'v0', state: 'ok', subject: 'Last call: order a kit today', clients: [{ code: 'a', name: 'Client A', os: '', category: 'Webmail', dark: false, completed: true }, { code: 'b_dm', name: 'Client B', os: '', category: 'App', dark: true, completed: true }, { code: 'c', name: 'Client C', os: '', category: 'App', dark: false, completed: false }], renders: { state: 'ok', count: 2, error: null } }] },
    doc: { subject: { options: [{ text: 'Last call: order a kit today', bold: true }] } },
    proofs: [
      { id: 'regular-donors-v0', segment: 'Regular Donors', variation: 'v0', sandboxId: '7000001', messageId: '7100000005', state: 'ok', error: null,
        facts: { subject: { built: 'Last call: order a kit today', prefix: 'Proof - ', header: '' }, from: { name: 'Example Relief', email: 'info@example.org' }, headerFrom: { name: 'Example Relief', email: 'info@example.org' }, replyTo: null, senderHeader: false,
          rcptTag: 'regular', dkim: ['example.org', 's1.mta.example.net'], encodings: { html: '8bit', text: '8bit' }, spam: { responseCode: 0, score: 0.6, threshold: 5, spam: false, rules: [] }, blacklist: null,
          preheader: { html: 'Packing stops Friday noon.', txt: 'Packing stops Friday noon.' }, tokens: [], colorScheme: { meta: false, media: false }, images: [], anchors: [], paragraphs: ['Hello,'], txtLines: [], greeting: 'Hello,', signoff: null, sizes: { html: 1000, txt: 100 }, truncated: false } },
      { id: 'regular-donors-v1', segment: 'Regular Donors', variation: 'v1', sandboxId: '7000001', messageId: '7100000006', state: 'not-found', error: null, facts: null },
    ],
    links: [
      { proofId: 'regular-donors-v0', linkId: '8001', slug: 'v1-utm-term-701EX00000abcdeAAQ', labels: ['DONATE NOW'], role: 'donate', kind: 'pardot', guard: null, method: 'interstitial-a', pardotStatus: 200,
        dest: { origin: 'https://www.example.org', path: '/give/seed-kits/', utm: { utm_source: 'pardot', utm_medium: 'email', utm_content: '02.01.27_EML_Seed_Kits_CRO-v0' }, otherKeys: ['sid'] }, destStatus: 200, destTitle: 'Example Relief | Give', error: null },
      { proofId: 'regular-donors-v0', linkId: '8002', slug: 'unsub', labels: ['Unsubscribe'], role: 'guarded', kind: 'pardot', guard: 'unsubscribe link', method: null, pardotStatus: null, dest: null, destStatus: null, destTitle: null, error: null },
      { proofId: 'regular-donors-v0', linkId: '8003', slug: 'story', labels: ['Read more'], role: 'cta', kind: 'pardot', guard: null, method: null, pardotStatus: null, dest: null, destStatus: null, destTitle: null, error: 'not resolved: cap' },
    ],
    renders: [{ variation: 'v0', code: 'a', name: 'Client A', dark: false, img: 'data:image/jpeg;base64,/9j/AAAA' }, { variation: 'v0', code: 'b_dm', name: 'Client B', dark: true, img: 'javascript:alert(1)' }],
    checks: [
      ecCk('subject', 'regular-donors-v0', 'passed', '', { fyi: 'matches option 1' }), ecCk('rawTokens', 'regular-donors-v0', 'passed', ''),
      ecCk('altTags', 'regular-donors-v0', 'failed', 'V0 image hero.jpg has no alt (see /e/900001/slug/8001/2000000002/h/SynthHash0)'),
      ecCk('preview', 'regular-donors-v0', 'in-progress', 'Preview text differs by one word', { evidence: { diffs: [{ doc: 'Please give today <b>', build: 'Please give tonight <b>' }] } }),
      ecCk('dkim', 'regular-donors-v1', 'blocked', 'Proof not found in sandbox 7000001 (message 7100000006)', { blockedBy: 'proof' }),
      ecCk('visuals', 'regular-donors-v0', 'not-tested', 'Stopped by the tester before this check ran'),
    ],
    notTested: [{ id: 'X.unsubscribe', what: 'Unsubscribe / View in browser', reason: 'never opened: check by hand' }],
    explain: null, sheet: null,
  };
  return Object.assign(rec, over || {});
}

TE('Email Check panel: runEmailCheckMode', function () {
  var E = ecEnv(), rendered = [], prepared = [], settingsRead = 0;
  var STALE = 'The service worker is older than this panel — reload Selenite in chrome://extensions and run again.';
  var NO_ANSWER = 'The service worker did not answer the run: it is older than this panel, or Chrome stopped it mid-run. Reload Selenite in chrome://extensions and run again.';
  var runSrc = ecItemSrc('async function runEmailCheckMode() {');
  var stubs = E.globals({
    ecUiReadSettings: function (c) { settingsRead++; return { profileId: '', docEmail: null, eoaRenders: true, utmRule: { value: 'suffix', source: 'tester', commentId: null }, segmentPaths: {}, onlyIn: null }; },
    ecUiRenderResults: function (r) { rendered.push(r); },
    ecUiPrepareSheet: function (r, c) { prepared.push(c && c.ticketKey); return Promise.resolve({ connected: false, reason: 'no-test-plan-link', paste: [] }); },
    ecUiEl: function (id) { return E.el(id); },
    ecExplainInput: function (r, c) { return { ticketKey: c.ticketKey, checks: (r.checks || []).length }; },
    ecSlim: function (r) { return JSON.parse(JSON.stringify(r)); },
  });
  withGlobals(stubs, function () {
    eval(runSrc);
    function reset() { E.sent.length = 0; E.replies = {}; E.store = { local: {}, sync: {} }; E.sessionSets.length = 0; E.sessionGets = {}; E.els = {}; E.intervals.length = 0; E.cleared = 0; rendered.length = 0; prepared.length = 0; settingsRead = 0; globalThis._taStopRequested = false; _ecLastRun = null; }
    function runMode() { return settleE(runEmailCheckMode()); }
    var first = function (a) { return E.sent.filter(function (m) { return m.action === a; })[0]; };

    reset(); E.ctx = null;
    var r = runMode();
    jeqE('(a) no context: ok false with the Initialize wording', r.v, { ok: false, error: 'No active ticket context — set one in the Initialize tab.' });
    eq('(a) no message was sent', E.sent.length, 0);
    ok('(a) the error is shown in the results box', /No active ticket context/.test(E.el('ec-results').innerHTML) && /color:var\(--err\)/.test(E.el('ec-results').innerHTML), E.el('ec-results').innerHTML);
    reset(); E.ctx = exCtx('EX-2', { emailProofs: [] });
    eq('(a) a context with no proofs says so', runMode().v.error, 'The active ticket context lists no Mailtrap proofs: add them in the Initialize tab.');
    reset(); E.ctx = exCtx('EX-2'); delete E.ctx.emailProofs;
    eq('(a) a context saved before Email Check says to re-run Initialize', runMode().v.error, 'Re-run Initialize on the ticket: this saved context has no Mailtrap proof links.');
    ok('(a) and sends nothing', E.sent.length === 0);

    reset(); E.ctx = exCtx('EX-2'); E.replies.runEmailCheck = { ok: true, record: ecHandRecord({ version: undefined }) };
    r = runMode();
    eq('(b) a record without a version: the reload wording', r.v && r.v.error, STALE);
    ok('(b) nothing was explained, prepared, rendered or stored', E.sent.length === 1 && prepared.length === 0 && rendered.length === 0 && E.sessionSets.length === 0 && _ecLastRun === null);
    reset(); E.ctx = exCtx('EX-2'); E.replies.runEmailCheck = { ok: true, record: ecHandRecord({ version: 2 }) };
    eq('(b) a record of another version is stale too', runMode().v.error, STALE);
    reset(); E.ctx = exCtx('EX-2'); E.replies.runEmailCheck = { ok: false, error: 'Boom' };
    eq('a worker error is passed through', runMode().v.error, 'Boom');
    reset(); E.ctx = exCtx('EX-2'); E.replies.runEmailCheck = { ok: true };
    eq('an answer with no record is a failure', runMode().v.error, 'Email Check failed');
    reset(); E.ctx = exCtx('EX-2'); E.replies.runEmailCheck = undefined;
    eq('no answer at all is a failure too', runMode().v.error, 'Email Check failed');
    ['The message port closed before a response was received.', 'Could not establish connection. Receiving end does not exist.', 'receiving end does not exist', 'THE MESSAGE PORT CLOSED BEFORE A RESPONSE WAS RECEIVED.'].forEach(function (m) {
      reset(); E.ctx = exCtx('EX-2'); E.replies.runEmailCheck = function () { return Promise.reject(new Error(m)); };
      var rj = runMode();
      jeqE('a rejected runEmailCheck (' + m.slice(0, 36) + '): the did-not-answer wording', rj.v, { ok: false, error: NO_ANSWER });
      ok('  nothing was explained, prepared or stored, and the run did not throw', rj.err === undefined && E.sent.length === 1 && prepared.length === 0 && _ecLastRun === null);
    });
    reset(); E.ctx = exCtx('EX-2'); E.replies.runEmailCheck = function () { throw new Error('The message port closed before a response was received.'); };
    jeqE('a synchronous throw of the same error gets the same wording', runMode().v, { ok: false, error: NO_ANSWER });
    reset(); E.ctx = exCtx('EX-2'); E.replies.runEmailCheck = function () { return Promise.reject(new Error('Extension context invalidated.')); };
    jeqE('any other rejection keeps its own message', runMode().v, { ok: false, error: 'Extension context invalidated.' });
    reset(); E.ctx = exCtx('EX-2'); E.replies.runEmailCheck = function () { return Promise.reject('plain string'); };
    jeqE('and a rejection that is not an Error is reported as text', runMode().v, { ok: false, error: 'plain string' });
    ok('each sentence is written once in the function', runSrc.split(STALE).length - 1 === 1 && runSrc.split(NO_ANSWER).length - 1 === 1, [runSrc.split(STALE).length - 1, runSrc.split(NO_ANSWER).length - 1]);

    reset(); E.ctx = exCtx('EX-2'); E.replies.runEmailCheck = { ok: true, record: ecHandRecord({ error: 'Boom at https://mailtrap.io/sandboxes/7000001/messages/7100000005?token=abc', checks: [] }) };
    r = runMode();
    ok('a record with an error and no checks is a failed run, its error scrubbed (no query)', r.v && r.v.ok === false && /Boom at https:\/\/mailtrap\.io\/sandboxes\/7000001\/messages\/7100000005/.test(r.v.error) && r.v.error.indexOf('token=') < 0, r.v);
    reset(); E.ctx = exCtx('EX-2'); E.replies.runEmailCheck = { ok: true, record: ecHandRecord({ error: 'The doc failed' }) };
    ok('a record with an error and some checks still produces results', runMode().v.ok === true && _ecLastRun && _ecLastRun.error === 'The doc failed');

    // (c) a stopped run, Analysis on: no explain, the sheet step still ran
    reset(); E.ctx = exCtx('EX-2'); E.el('ta-agentic-analysis').checked = true;
    E.replies.runEmailCheck = { ok: true, record: ecHandRecord({ stopped: true }) };
    var t0 = Date.now();
    r = runMode();
    eq('(c) a stopped run is ok', r.v && r.v.ok, true);
    ok('(c) its record is stamped (ts >= the start)', _ecLastRun && _ecLastRun.ts >= t0, _ecLastRun && _ecLastRun.ts);
    ok('(c) no ecExplain message with a stopped record, even with Analysis on', E.sent.every(function (m) { return m.action !== 'ecExplain'; }), E.sent.map(function (m) { return m.action; }));
    eq('(c) explain is null', _ecLastRun.explain, null);
    eq('(c) the sheet step still ran, for this ticket', prepared.join(), 'EX-2');
    ok('(c) results were rendered once and the slim record stored in the session', rendered.length === 1 && E.sessionSets.some(function (o) { return o.ecLastRun && o.ecLastRun.version === 1; }));
    eq('(c) the sheet is on the record', _ecLastRun.sheet.reason, 'no-test-plan-link');
    // (d) Analysis off
    reset(); E.ctx = exCtx('EX-2'); E.el('ta-agentic-analysis').checked = false; E.replies.runEmailCheck = { ok: true, record: ecHandRecord() };
    runMode();
    ok('(d) Analysis unchecked: no ecExplain message', E.sent.every(function (m) { return m.action !== 'ecExplain'; }));
    eq('(d) explain is null', _ecLastRun.explain, null);
    // Analysis on
    reset(); E.ctx = exCtx('EX-2'); E.el('ta-agentic-analysis').checked = true;
    E.replies.runEmailCheck = { ok: true, record: ecHandRecord() }; E.replies.ecExplain = { ok: true, explain: { ok: true, bugs: [], pgmQuestions: [], commentChecks: [], copyNotes: [], dropped: 0 } };
    runMode();
    var ex = first('ecExplain');
    jeqE('Analysis on: the explain message carries ecExplainInput(record, ctx)', ex && ex.payload, { ticketKey: 'EX-2', checks: 6 });
    eq('the explain result is kept on the record', _ecLastRun.explain.ok, true);
    reset(); E.ctx = exCtx('EX-2'); E.el('ta-agentic-analysis').checked = true; E.replies.runEmailCheck = { ok: true, record: ecHandRecord() }; E.replies.ecExplain = { ok: false, error: 'No API key configured' };
    runMode();
    jeqE('a failed explain is recorded as {ok:false,error}', _ecLastRun.explain, { ok: false, error: 'No API key configured' });
    reset(); E.ctx = exCtx('EX-2'); E.el('ta-agentic-analysis').checked = true; E.replies.runEmailCheck = { ok: true, record: ecHandRecord() }; E.replies.ecExplain = function () { return Promise.reject(new Error('port closed')); };
    runMode();
    jeqE('a rejected explain is recorded the same way', _ecLastRun.explain, { ok: false, error: 'port closed' });
    reset(); E.ctx = exCtx('EX-2'); E.el('ta-agentic-analysis').checked = true; globalThis._taStopRequested = true; E.replies.runEmailCheck = { ok: true, record: ecHandRecord() };
    runMode();
    ok('the Test Agent Stop flag also skips the explain', E.sent.every(function (m) { return m.action !== 'ecExplain'; }));
    reset(); E.ctx = exCtx('EX-2'); E.el('ta-agentic-analysis').checked = true; E.replies.runEmailCheck = { ok: true, record: ecHandRecord() }; E.replies.ecExplain = { ok: true, explain: { ok: true, bugs: [], pgmQuestions: [], commentChecks: [], copyNotes: [], dropped: 0 } };
    runMode();
    eq('a store fault is swallowed: the run still succeeds', (function () { E.setFails = false; return _ecLastRun.explain.ok; })(), true);

    // (e) what rides in the message
    reset(); E.ctx = exCtx('EX-2'); E.replies.runEmailCheck = { ok: true, record: ecHandRecord() };
    runMode();
    var msg = first('runEmailCheck');
    jeqE('the payload has exactly ctx, settings and winId', Object.keys(msg.payload).sort(), ['ctx', 'settings', 'winId']);
    jeqE('the worker context has exactly the five keys of ecCtxForWorker', Object.keys(msg.payload.ctx).sort(), ['copyFileUrl', 'eoa', 'proofs', 'summary', 'ticketKey']);
    ok('no comments, no Jira text, no inbox address in the message', JSON.stringify(msg.payload).indexOf('420001') < 0 && JSON.stringify(msg.payload).indexOf('Ready for review') < 0 && JSON.stringify(msg.payload).indexOf('@') < 0, JSON.stringify(msg.payload).slice(0, 300));
    eq('the window id rides along', msg.payload.winId, 7);
    eq('the settings are what ecUiReadSettings returned (read once, with the context)', msg.payload.settings.utmRule.value + '|' + settingsRead, 'suffix|1');
    eq('four proofs and two EoA tests for EX-2', msg.payload.ctx.proofs.length + '/' + msg.payload.ctx.eoa.length, '4/2');

    // the progress tick
    reset(); E.ctx = exCtx('EX-2'); E.replies.runEmailCheck = { ok: true, record: ecHandRecord() };
    runMode();
    ok('a progress tick every 800 ms, and it is cleared when the run ends', E.intervals.length === 1 && E.intervals[0].ms === 800 && E.cleared === 1, [E.intervals.length, E.intervals[0] && E.intervals[0].ms, E.cleared]);
    eq('the progress line is emptied after the run', E.el('ec-progress').textContent, '');
    var tick = E.intervals[0].fn;
    E.sessionGets.ecProgress = { running: true, phase: 'links', label: 'regular-donors-v0', done: 3, total: 8 };
    settleE(tick());
    eq('the tick writes the phase, label and counts to the panel line', E.el('ec-progress').textContent, 'Email Check — links regular-donors-v0 (3/8)');
    eq('  and to the Test Agent status line', E.el('ta-status').textContent, 'Email Check — links regular-donors-v0 (3/8)');
    E.sessionGets.ecProgress = { running: true, phase: 'doc', label: '' };
    settleE(tick());
    eq('the tick without counts prints none', E.el('ec-progress').textContent.replace(/\s+$/, ''), 'Email Check — doc');
    E.el('ec-progress').textContent = 'keep'; E.sessionGets.ecProgress = { running: false };
    settleE(tick());
    eq('a finished progress record prints nothing', E.el('ec-progress').textContent, 'keep');
  });
});

TE('Email Check panel: the stored record has no images (needs B2: ecSlim)', function () {
  var E = ecEnv();
  var stubs = E.globals({ ecUiReadSettings: function () { return { profileId: '', docEmail: null, eoaRenders: true, utmRule: { value: '', source: 'none', commentId: null }, segmentPaths: {}, onlyIn: null }; },
    ecUiRenderResults: function () {}, ecUiPrepareSheet: function () { return Promise.resolve({ connected: false, reason: 'no-test-plan-link', paste: [] }); }, ecUiEl: function (id) { return E.el(id); } });
  withGlobals(stubs, function () {
    eval(ecItemSrc('async function runEmailCheckMode() {'));
    E.ctx = exCtx('EX-2'); E.replies.runEmailCheck = { ok: true, record: ecHandRecord() };
    settleE(runEmailCheckMode());
    var stored = E.sessionSets.filter(function (o) { return o.ecLastRun; })[0];
    ok('the session copy exists and holds no data:image', !!stored && JSON.stringify(stored).indexOf('data:image') < 0, stored && JSON.stringify(stored).slice(0, 200));
    ok('  while the in-memory record keeps the render images for the report', JSON.stringify(_ecLastRun).indexOf('data:image/jpeg') >= 0);
    ok('  and the stored record keeps its checks and its version', stored && stored.ecLastRun.version === 1 && stored.ecLastRun.checks.length === 6);
  });
});

TE('Email Check panel: prepare sheet', function () {
  var E = ecEnv(), calls = {};
  var src = ecItemSrc('async function ecUiPrepareSheet(record, ctx) {');
  var stubs = E.globals({
    ecUiEl: function (id) { return E.el(id); },
    ecPasteRows: function (checks, proofs) { calls.paste = [checks.length, proofs.length]; return [{ row: 'paste' }]; },
    ecSheetModel: function (values) { calls.model = values; return values === 'BAD' ? { error: 'No Desktop / Mobile / Web-Based header row in the first 15 rows: this does not look like an EMAIL Test Plan.' } : { headerRows: [6, 7], cols: { description: 2, desktop: 4, mobile: 5, webBased: 6, notes: 7 }, textCols: [2], groups: [] }; },
    ecRowMap: function (model, proofs, profile) { calls.rowMap = { proofs: proofs, profile: profile && profile.id }; return { mapping: [{ row: 9, key: 'subject' }], unmappedGroups: [{ row: 42, label: 'x', reason: 'y' }] }; },
    ecBuildProposal: function (o) { calls.build = o; return { entries: [{ row: 9, include: true, cells: [], note: null }], unmapped: [], warnings: [], counts: { statusWrites: 0, noteWrites: 0 } }; },
  });
  withGlobals(stubs, function () {
    eval(src);
    var rec = ecHandRecord();
    function reset() { E.sent.length = 0; E.replies = {}; E.els = {}; calls = {}; E.ctx = null; }
    function prep(ctx) { return settleE(ecUiPrepareSheet(rec, ctx)); }
    function actions() { return E.sent.map(function (m) { return m.action; }).join(); }
    var base = ['connected', 'reason', 'error', 'spreadsheetId', 'gid', 'tabTitle', 'title', 'readAt', 'model', 'vocab', 'mapping', 'unmappedGroups', 'notesOn', 'retestInProgress', 'proposal', 'paste', 'applied'];
    reset();
    var s = prep(exCtx('EX-2', { qaTestPlanUrl: null })).v;
    jeqE('the sheet carries the 17 keys of plan 1.4', Object.keys(s).sort(), base.slice().sort());
    ok('no test plan link: reason no-test-plan-link, not connected, and a paste table', s.connected === false && s.reason === 'no-test-plan-link' && s.paste.length === 1 && E.sent.length === 0);
    eq('  the paste rows come from the record\'s checks and proofs', calls.paste.join(), '6,2');
    s = prep(exCtx('EX-2', { qaTestPlanUrl: 'https://www.example.org/plan' })).v;
    eq('a link that is not a Google Sheet', s.reason, 'not-a-google-sheet-link');
    reset(); E.replies.qpGoogleStatus = { ok: true, clientIdSet: false, connected: false };
    s = prep(exCtx('EX-2')).v;
    jeqE('no OAuth client id', [s.reason, s.spreadsheetId, s.gid], ['no-client-id', 'EXPLAN_EX2_TEST_PLAN_00000000002', '100']);
    reset(); E.replies.qpGoogleStatus = null;
    eq('no answer from the worker counts as no client id', prep(exCtx('EX-2')).v.reason, 'no-client-id');
    reset(); E.replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: false };
    eq('not connected', prep(exCtx('EX-2')).v.reason, 'not-connected');
    reset(); E.replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: true }; E.el('ec-sheet-tab').value = '';
    s = prep(exCtx('EX-2')).v;
    eq('no tab picked', s.reason, 'no-tab-picked');
    eq('  and the plan was not read', actions(), 'qpGoogleStatus');
    reset(); E.replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: true }; E.el('ec-sheet-tab').value = 'QA Round 1';
    E.replies.qpSheetMeta = { ok: true, title: '[EX-2] EMAIL Test Plan', tabs: [] }; E.replies.qpSheetRead = { ok: false, error: 'HTTP 403' };
    s = prep(exCtx('EX-2')).v;
    ok('a failed read is an error with the paste table, not connected', s.connected === false && s.error === 'HTTP 403' && s.tabTitle === 'QA Round 1' && s.paste.length === 1, s);
    E.replies.qpSheetRead = null;
    eq('no answer to the read says the plan could not be read', prep(exCtx('EX-2')).v.error, 'The test plan could not be read.');
    E.replies.qpSheetRead = { ok: true, values: 'BAD', valuesTab: [], readAt: 5 };
    s = prep(exCtx('EX-2')).v;
    ok('a sheet that is not an EMAIL Test Plan: the model\'s error, readAt kept, not connected', /does not look like an EMAIL Test Plan/.test(s.error) && s.readAt === 5 && s.connected === false, s);
    // the connected path
    reset(); E.replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: true }; E.el('ec-sheet-tab').value = 'QA Round 1'; E.el('ec-write-notes').checked = true; E.el('ec-retest-inprogress').checked = true;
    E.replies.qpSheetMeta = { ok: true, title: '[EX-2] EMAIL Test Plan', tabs: [] };
    E.replies.qpSheetRead = { ok: true, values: [['x']], valuesTab: [['Statuses', 'Passed', 'In Progress', 'Failed', 'Blocked', 'Backlog', 'Excluded']], readAt: 77 };
    s = prep(exCtx('EX-2')).v;
    eq('connected: the messages sent, in order', actions(), 'qpGoogleStatus,qpSheetMeta,qpSheetRead');
    jeqE('  the meta and read payloads', [E.sent[1].payload, E.sent[2].payload], [{ spreadsheetId: 'EXPLAN_EX2_TEST_PLAN_00000000002' }, { spreadsheetId: 'EXPLAN_EX2_TEST_PLAN_00000000002', tabTitle: 'QA Round 1' }]);
    ok('  connected, with the model, readAt, title, tab, the proposal and the paste table', s.connected === true && s.readAt === 77 && s.title === '[EX-2] EMAIL Test Plan' && s.tabTitle === 'QA Round 1' && !!s.model && !!s.proposal && s.paste.length === 1 && s.reason === null && s.error === null, s);
    jeqE('  the vocabulary is the sheet\'s own words', s.vocab, { Passed: 'Passed', Failed: 'Failed', 'In Progress': 'In Progress', Blocked: 'Blocked', Backlog: 'Backlog', Excluded: 'Excluded' });
    jeqE('  the row map and the unmapped groups are kept', [s.mapping, s.unmappedGroups], [[{ row: 9, key: 'subject' }], [{ row: 42, label: 'x', reason: 'y' }]]);
    ok('  the boxes are read', s.notesOn === true && s.retestInProgress === true);
    eq('  ecRowMap got the proofs as {id, segment, variation} and the ticket\'s profile', JSON.stringify(calls.rowMap), JSON.stringify({ proofs: [{ id: 'regular-donors-v0', segment: 'Regular Donors', variation: 'v0' }, { id: 'regular-donors-v1', segment: 'Regular Donors', variation: 'v1' }], profile: 'example' }));
    var o = calls.build;
    jeqE('  ecBuildProposal got the ten fields', Object.keys(o).sort(), ['checks', 'mapping', 'model', 'notesOn', 'proofs', 'retestInProgress', 'ticketKey', 'title', 'unmappedGroups', 'vocab']);
    ok('  with the record\'s checks, the ticket key and the plan title', o.checks.length === 6 && o.ticketKey === 'EX-2' && o.title === '[EX-2] EMAIL Test Plan' && o.notesOn === true && o.retestInProgress === true);
    E.el('ec-write-notes').checked = false; E.el('ec-retest-inprogress').checked = false;
    s = prep(exCtx('EX-2')).v;
    ok('  the boxes unchecked', s.notesOn === false && s.retestInProgress === false);
    E.replies.qpSheetMeta = { ok: false, error: 'HTTP 500' };
    s = prep(exCtx('EX-2')).v;
    ok('a failing title read is not an error: connected, title null', s.connected === true && s.title === null && s.error === null, s);
    // anything thrown is an error on the sheet
    calls.model = null;
    var broke = Object.assign({}, stubs.ecBuildProposal);
    globalThis.ecBuildProposal = function () { throw new Error('proposal boom'); };
    var sb = prep(exCtx('EX-2'));
    ok('a throw inside is caught: the sheet carries the error, the promise does not reject', sb.done && !sb.err && /proposal boom/.test(sb.v.error) && sb.v.paste.length === 1, sb.err && String(sb.err));
    globalThis.ecBuildProposal = stubs.ecBuildProposal;
    reset(); E.replies.qpGoogleStatus = function () { throw new Error('status boom'); };
    sb = prep(exCtx('EX-2'));
    ok('a worker call that throws is caught the same way', sb.done && !sb.err && /status boom/.test(sb.v.error), sb.err && String(sb.err));
  });
});

TE('Email Check panel: prepare sheet on the synthetic plan (needs B2: ecSheetModel, ecRowMap, ecBuildProposal, ecPasteRows)', function () {
  ok('ecTestRecord is available (tests/email-check-fixture-record.js, B2)', EC_REC_LOADED);
  var rec = ecTestRecord(ecFx(), 'EX-1');
  var plan = EC_PLANS['EX-1'];
  var E = ecEnv();
  withGlobals(E.globals({ ecUiEl: function (id) { return E.el(id); } }), function () {
    eval(ecItemSrc('async function ecUiPrepareSheet(record, ctx) {'));
    E.replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: true }; E.el('ec-sheet-tab').value = 'QA Round 1'; E.el('ec-write-notes').checked = true;
    E.replies.qpSheetMeta = { ok: true, title: plan.title, tabs: plan.tabs.map(function (t) { return { sheetId: t.sheetId, title: t.title, index: t.index, hidden: false }; }) };
    E.replies.qpSheetRead = { ok: true, values: plan.values, valuesTab: plan.legend, readAt: 9 };
    var s = settleE(ecUiPrepareSheet(rec, exCtx('EX-1'))).v;
    ok('connected on the EX-1 plan', s && s.connected === true && !s.error, s && s.error);
    ok('the four groups map to the four proofs, nothing unmapped', s.unmappedGroups.length === 0 && s.mapping.length > 0, s.unmappedGroups);
    ok('the proposal has entries, and no F/G cell outside the four visual rows', s.proposal.entries.length > 0 && s.proposal.entries.every(function (e) { return e.cells.every(function (c) { return /^E/.test(c.a1) || ecIsVisualRowText(e.rowText); }); }));
    ok('the paste table is carried too', s.paste.length > 0);
  });
});

// A connected sheet with a proposal, in the shape ecBuildProposal returns; the writes helper below is the contract of ecWritesFromProposal.
function ecSheetOK(over) {
  var vocab = { Passed: 'Passed', Failed: 'Failed', 'In Progress': 'In Progress', Blocked: 'Blocked', Backlog: 'Backlog', Excluded: 'Excluded' };
  return Object.assign({
    connected: true, reason: null, error: null, spreadsheetId: 'EXPLAN_EX2_TEST_PLAN_00000000002', gid: '100', tabTitle: 'QA Round 1', title: '[EX-2] EMAIL Test Plan', readAt: 5,
    model: { headerRows: [6, 7], cols: { testGroup: 0, description: 2, totalMinutes: 3, desktop: 4, mobile: 5, webBased: 6, notes: 7 }, a1: '', a1Placeholder: false, textCols: [2], groups: [], problems: [] },
    vocab: vocab, mapping: [], unmappedGroups: [], notesOn: true, retestInProgress: false,
    proposal: { entries: [
      { row: 9, rowText: 'Is the subject line rendering correctly?', key: 'subject', proofId: 'regular-donors-v0', checkId: 'subject@regular-donors-v0', derived: 'passed', include: true,
        cells: [{ col: 4, a1: 'E9', old: '', next: 'Passed', writable: true, reason: null }], note: { col: 7, a1: 'H9', old: '', next: 'V0 / Regular Donors | Desktop | matches option 1', line: 'V0 / Regular Donors | Desktop | matches option 1' } },
      { row: 33, rowText: 'Verify the overall visuals of the email', key: 'visuals', proofId: 'regular-donors-v0', checkId: 'visuals@regular-donors-v0', derived: 'in-progress', include: true,
        cells: [{ col: 4, a1: 'E33', old: '', next: 'In Progress', writable: true, reason: null }, { col: 5, a1: 'F33', old: '', next: 'In Progress', writable: true, reason: null }, { col: 6, a1: 'G33', old: '', next: 'In Progress', writable: true, reason: null }], note: null },
      { row: 10, rowText: 'Is personalized content rendering correctly within the subject line?', key: 'subjectTokens', proofId: 'regular-donors-v0', checkId: 'subjectTokens@regular-donors-v0', derived: 'passed', include: false,
        cells: [{ col: 4, a1: 'E10', old: 'Passed', next: 'Passed', writable: false, reason: 'already Passed' }], note: null },
    ], unmapped: [], warnings: [], counts: { statusWrites: 4, noteWrites: 1 } },
    paste: [{ checkId: 'subject@regular-donors-v0', group: 'Reqs - Regular Donors v0', row: 'Is the subject line rendering correctly?', status: 'Passed', note: '' }], applied: null,
  }, over || {});
}
// ecWritesFromProposal's contract: for every entry with include === true, its writable cells in column order, then its note; the QA Pass write shape.
function ecWritesStub(sheet) {
  var out = [];
  if (!sheet || !sheet.proposal) return out;
  sheet.proposal.entries.forEach(function (e) {
    if (e.include !== true) return;
    e.cells.forEach(function (c) { if (c.writable) out.push({ row: e.row, col: c.col, a1: c.a1, old: c.old, next: c.next, rowText: e.rowText }); });
    if (e.note) out.push({ row: e.row, col: e.note.col, a1: e.note.a1, old: e.note.old, next: e.note.next, rowText: e.rowText });
  });
  return out;
}
function ecHtmlStubs() {
  return {
    ecProposalHtml: function (sh, o) { return '<table class="ec-proposal" data-editable="' + !!(o && o.editable) + '"><tr><td>proposal</td></tr></table>'; },
    ecPasteHtml: function (rows) { return '<table class="ec-paste" data-rows="' + (rows || []).length + '"><tr><td>paste</td></tr></table>'; },
    ecWritesFromProposal: ecWritesStub,
    ecSlim: function (r) { return JSON.parse(JSON.stringify(r)); },
  };
}

TE('Email Check panel: results', function () {
  var E = ecEnv();
  withGlobals(E.globals(ecHtmlStubs()), function () {
    eval(ecPanelSrc());
    function render(rec) { E.els = {}; ecUiRenderResults(rec); return E.el('ec-results').innerHTML; }
    // ecUiRecount
    var prop = ecSheetOK().proposal; prop.counts = null;
    ecUiRecount(prop);
    jeqE('recount: the writable cells and the notes of the included entries', prop.counts, { statusWrites: 4, noteWrites: 1 });
    prop.entries[0].include = false; ecUiRecount(prop);
    jeqE('recount: an excluded entry counts nothing (its note neither)', prop.counts, { statusWrites: 3, noteWrites: 0 });
    prop.entries[2].include = true; ecUiRecount(prop);
    jeqE('recount: an included entry whose cells are not writable adds nothing', prop.counts, { statusWrites: 3, noteWrites: 0 });
    ecUiRecount({ entries: [] });
    ok('recount: no entries is fine', true);

    // ecUiRenderResults
    var rec = ecHandRecord({ sheet: ecSheetOK() });
    var h = render(rec);
    ok('results: a <style> for the results tables and the ec-* classes', /<style>/.test(h) && /#ec-results/.test(h) && /ec-sub/.test(h) && /ec-list/.test(h) && /ec-empty/.test(h) && /ec-warn/.test(h), h.slice(0, 200));
    ok('results: the badge', h.indexOf('ISSUES FOUND') >= 0 && /color:var\(--err\)/.test(h));
    ok('results: the counts line', h.indexOf('1 failed · 2 passed · 1 in progress · 1 blocked · 1 not tested') >= 0, h.slice(0, 600));
    ok('results: the failed check with its id and note', h.indexOf('<b>altTags@regular-donors-v0</b>') >= 0 && h.indexOf('V0 image hero.jpg has no alt') >= 0);
    ok('results: the note is scrubbed again (no prospect id, no hash)', h.indexOf('2000000002') < 0 && h.indexOf('SynthHash0') < 0 && h.indexOf('[prospect]') >= 0, h);
    ok('results: no href and no url is printed', h.indexOf('href=') < 0 && h.indexOf('http') < 0);
    ok('results: the sheet block says nothing is written yet and offers Apply with the count and the tab', h.indexOf('Test plan changes (not written yet)') >= 0 && h.indexOf('<table class="ec-proposal" data-editable="true">') >= 0 && h.indexOf('id="btn-ec-apply"') >= 0 && h.indexOf('Apply 5 change(s) to "QA Round 1"') >= 0 && h.indexOf('id="ec-apply-status"') >= 0, h);
    ok('results: the Apply button is visible when there are writes', !/id="btn-ec-apply"[^>]*display:none/.test(h));
    var rec2 = ecHandRecord({ stopped: true, checks: [ecCk('subject', 'regular-donors-v0', 'passed', ''), ecCk('dkim', 'regular-donors-v0', 'in-progress', 'x')], sheet: null });
    h = render(rec2);
    ok('results: a stopped record says so, and without a failure the badge is INCOMPLETE', h.indexOf('INCOMPLETE') >= 0 && h.indexOf(' · stopped') >= 0, h.slice(0, 500));
    ok('results: no sheet at all prints no test-plan block', h.indexOf('Test plan') < 0 && h.indexOf('Paste-ready') < 0);
    h = render(ecHandRecord({ checks: [ecCk('subject', 'regular-donors-v0', 'passed', '')], sheet: null }));
    ok('results: all passed is PASS, in the ok colour', h.indexOf('>PASS<') >= 0 && /color:var\(--ok\)/.test(h));
    h = render(ecHandRecord({ checks: [ecCk('subject', 'regular-donors-v0', 'in-progress', 'x')], sheet: null }));
    ok('results: in progress is NEEDS REVIEW, in the warn colour', h.indexOf('NEEDS REVIEW') >= 0 && /color:var\(--warn\)/.test(h));
    h = render(ecHandRecord({ error: 'Doc failed at https://docs.googleapis.com/v1/documents/abc?key=SECRET <b>', sheet: null }));
    ok('results: the run error is scrubbed (no query) and escaped', h.indexOf('key=SECRET') < 0 && h.indexOf('&lt;b&gt;') >= 0 && h.indexOf('Doc failed at https://docs.googleapis.com/v1/documents/abc') >= 0, h);
    // sources the tester must act on
    var mt = function (state, error) { return render(ecHandRecord({ sources: Object.assign({}, ecHandRecord().sources, { mailtrap: { state: state, error: error || null } }), sheet: null })); };
    ok('results: Mailtrap signed out', mt('signed-out').indexOf('Mailtrap: this Chrome is signed out. Sign in to the shared Mailtrap account in this Chrome, then run again.') >= 0);
    ok('results: Mailtrap no-account names the sandbox of the first proof', mt('no-account').indexOf('the signed-in account does not own sandbox 7000001 (a personal account?)') >= 0);
    ok('results: Mailtrap challenge', mt('challenge').indexOf('Mailtrap shows a browser check. Open mailtrap.io in this Chrome, let it finish, then run again.') >= 0);
    ok('results: Mailtrap error carries its text, escaped', mt('error', 'boom <b>').indexOf('Mailtrap could not be read: boom &lt;b&gt;') >= 0);
    ok('results: an ok Mailtrap source prints nothing', mt('ok').indexOf('Mailtrap') < 0);
    h = render(ecHandRecord({ sources: Object.assign({}, ecHandRecord().sources, { doc: { state: 'needs-connect', title: null, emails: [], chosen: null, error: null } }), sheet: null }));
    ok('results: the Docs permission sentence', h.indexOf('Connect Google again: the Docs permission was added after you connected.') >= 0);
    // the sheet block in its other forms
    var locked = ecSheetOK({ applied: { at: 1, ok: true, written: 5, verified: 5, dropped: [], mismatches: [], foreign: [] } });
    h = render(ecHandRecord({ sheet: locked }));
    ok('results: after a good Apply the proposal is not editable and there is no button', h.indexOf('data-editable="false"') >= 0 && h.indexOf('btn-ec-apply') < 0, h);
    eq('  and the outcome is shown in the status line', E.el('ec-apply-status').textContent, 'Wrote 5 cell(s), verified 5.');
    h = render(ecHandRecord({ sheet: ecSheetOK({ applied: { at: 1, ok: false, error: 'Nothing was written: boom', needsConnect: true } }) }));
    ok('results: a failed Apply keeps the button and shows the error', h.indexOf('id="btn-ec-apply"') >= 0 && /Not written: Nothing was written: boom \(use Connect Google, then Apply again\)/.test(E.el('ec-apply-status').textContent), E.el('ec-apply-status').textContent);
    var sh0 = ecSheetOK(); sh0.proposal.entries.forEach(function (e) { e.include = false; });
    h = render(ecHandRecord({ sheet: sh0 }));
    ok('results: with nothing selected the Apply button is hidden', /id="btn-ec-apply"[^>]*display:none/.test(h) && h.indexOf('Apply 0 change(s)') >= 0, h);
    var reasons = { 'no-test-plan-link': 'The active ticket has no QA test plan link.', 'not-a-google-sheet-link': 'The QA test plan link is not a Google Sheet.', 'no-client-id': 'Add a Google OAuth client ID in Settings to read and write the test plan.',
      'not-connected': 'Google is not connected: use Connect Google above.', 'no-tab-picked': 'Pick the test plan tab above to get a proposal.' };
    Object.keys(reasons).forEach(function (k) {
      h = render(ecHandRecord({ sheet: { connected: false, reason: k, error: null, paste: [{ a: 1 }] } }));
      ok('results: reason ' + k, h.indexOf(reasons[k] + ' Paste-ready results:') >= 0 && h.indexOf('<table class="ec-paste" data-rows="1">') >= 0 && h.indexOf('>Test plan<') >= 0, h.slice(0, 300));
    });
    h = render(ecHandRecord({ sheet: { connected: false, reason: null, error: 'boom <b>', paste: [] } }));
    ok('results: a read error is shown, escaped, with the paste table', h.indexOf('The test plan could not be read: boom &lt;b&gt;. Paste-ready results:') >= 0 || h.indexOf('The test plan could not be read: boom &lt;b&gt; Paste-ready results:') >= 0, h);
    ok('results: markup in a note is escaped', render(ecHandRecord({ checks: [ecCk('subject', 'regular-donors-v0', 'failed', '<script>alert(1)</script>')], sheet: null })).indexOf('<script>alert') < 0);
    h = render(ecHandRecord({ sheet: ecSheetOK({ tabTitle: 'Tab "x" <i>' }) }));
    ok('results: the tab title in the Apply button is escaped', h.indexOf('Apply 5 change(s) to "Tab &quot;x&quot; &lt;i&gt;"') >= 0 && h.indexOf('<i>') < 0, h);
    E.nodes['ec-results'] = null;
    var threw = false; try { ecUiRenderResults(rec); } catch (e) { threw = true; }
    ok('results: a missing #ec-results is a no-op', !threw);
    E.nodes = {};
    try { ecUiRenderResults(null); } catch (e) { threw = true; }
    ok('results: a null record is a no-op', !threw);

    // ecUiShowApplied
    E.els = {};
    ecUiShowApplied({ ok: false, error: 'boom' });
    jeqE('applied: a failure', [E.el('ec-apply-status').textContent, E.el('ec-apply-status').style.color], ['Not written: boom', 'var(--err)']);
    ecUiShowApplied({ ok: false, error: 'boom', needsConnect: true });
    eq('applied: a failure that needs Google again', E.el('ec-apply-status').textContent, 'Not written: boom (use Connect Google, then Apply again)');
    ecUiShowApplied({ ok: false });
    eq('applied: a failure with no text', E.el('ec-apply-status').textContent, 'Not written: unknown error');
    ecUiShowApplied({ ok: true, written: 3, verified: 3, dropped: [], mismatches: [], foreign: [] });
    jeqE('applied: a clean write', [E.el('ec-apply-status').textContent, E.el('ec-apply-status').style.color], ['Wrote 3 cell(s), verified 3.', 'var(--ok)']);
    ecUiShowApplied({ ok: true, written: 3, verified: 1, dropped: [{ a1: 'E9' }, { a1: 'H9' }], mismatches: [{ a1: 'F33', found: 'X' }], foreign: [{ a1: 'G33' }] });
    jeqE('applied: dropped, mismatched and foreign cells are named', [E.el('ec-apply-status').textContent, E.el('ec-apply-status').style.color],
      ['Wrote 3 cell(s), verified 1. Left alone, changed since read: E9, H9. Mismatches: F33 holds "X". Also changed by someone else meanwhile: G33.', 'var(--err)']);
    ecUiShowApplied({ ok: true, written: 2, verified: null, verifyError: 'HTTP 500' });
    jeqE('applied: not re-read', [E.el('ec-apply-status').textContent, E.el('ec-apply-status').style.color], ['Wrote 2 cell(s), not re-read (HTTP 500).', 'var(--err)']);
    ecUiShowApplied({ ok: true });
    eq('applied: nothing written', E.el('ec-apply-status').textContent, 'Wrote 0 cell(s), not re-read (unknown).');
    E.nodes['ec-apply-status'] = null;
    threw = false; try { ecUiShowApplied({ ok: true, written: 1, verified: 1 }); } catch (e) { threw = true; }
    ok('applied: no element is a no-op', !threw);
    E.nodes = {};

    // ecUiPersistLast
    _ecLastRun = null; ecUiPersistLast();
    eq('persist: nothing to store', E.sessionSets.length, 0);
    _ecLastRun = ecHandRecord({ ts: 5 }); ecUiPersistLast(); drainMicrotasks();
    ok('persist: the slim record goes to the session store under ecLastRun', E.sessionSets.length === 1 && E.sessionSets[0].ecLastRun && E.sessionSets[0].ecLastRun.ts === 5);

    // ecUiOnResultsChange: one include checkbox per proposal entry
    var rendered = 0, persisted = 0;
    ecUiRenderResults = function () { rendered++; }; ecUiPersistLast = function () { persisted++; };
    function incEv(row, checked) { return { target: { checked: checked, matches: function (s) { return s === 'input[data-ec-include]'; }, getAttribute: function (n) { return n === 'data-ec-include' ? String(row) : null; } } }; }
    _ecLastRun = ecHandRecord({ sheet: ecSheetOK() });
    ecUiOnResultsChange(incEv(9, false));
    var ent = _ecLastRun.sheet.proposal.entries;
    ok('include: unticking row 9 excludes it', ent[0].include === false && ent[1].include === true);
    jeqE('  the counts follow', _ecLastRun.sheet.proposal.counts, { statusWrites: 3, noteWrites: 0 });
    ok('  the results are rendered again and the record persisted', rendered === 1 && persisted === 1);
    ecUiOnResultsChange(incEv(9, true));
    ok('include: ticking it again includes it', ent[0].include === true && _ecLastRun.sheet.proposal.counts.statusWrites === 4);
    ecUiOnResultsChange(incEv(99, false));
    ok('include: an unknown row changes nothing', ent.every(function (e) { return e.include === (e.row !== 10); }));
    var r0 = rendered; ecUiOnResultsChange({ target: { matches: function () { return false; } } });
    ok('include: another control changes nothing and renders nothing', rendered === r0);
    _ecLastRun.sheet.applied = { ok: true }; ecUiOnResultsChange(incEv(9, false));
    ok('include: a locked (applied) sheet changes nothing', ent[0].include === true);
    _ecLastRun = ecHandRecord({ sheet: null }); ecUiOnResultsChange(incEv(9, false));
    ok('include: no sheet is fine', true);
    // ecUiOnResultsClick
    var applyCalls = 0; ecUiApply = function () { applyCalls++; return Promise.resolve(); };
    ecUiOnResultsClick({ target: { closest: function (s) { return s === '#btn-ec-apply' ? {} : null; } } });
    eq('click: a click on Apply reaches ecUiApply', applyCalls, 1);
    ecUiOnResultsClick({ target: { closest: function () { return null; } } });
    eq('click: a click elsewhere does nothing', applyCalls, 1);
    threw = false; try { ecUiOnResultsClick({ target: {} }); ecUiOnResultsClick({}); } catch (e) { threw = true; }
    ok('click: a target with no closest is fine', !threw);
  });
});

TE('Email Check panel: apply', function () {
  var E = ecEnv();
  withGlobals(E.globals(ecHtmlStubs()), function () {
    eval(ecPanelSrc());
    var renders = 0; ecUiRenderResults = function () { renders++; };
    function reset(sheetOver) {
      E.sent.length = 0; E.replies = {}; E.store.local = {}; E.sessionSets.length = 0; E.confirms.length = 0; E.confirmAnswer = true; E.els = {}; renders = 0;
      _ecLastRun = ecHandRecord({ sheet: ecSheetOK(sheetOver) });
    }
    function apply() { return settleE(ecUiApply()); }
    var CONFIRM = 'Write 5 cell(s) to the tab "QA Round 1" of the EMAIL Test Plan?\n\nOnly cells that still hold what Selenite read are written; anything changed since is left alone.';
    reset(); E.replies.ecSheetApply = function (m) { E.btnWasDisabled = E.el('btn-ec-apply').disabled; return { ok: true, written: 5, verified: 5, dropped: [], mismatches: [], foreign: [] }; };
    apply();
    eq('apply: the confirm names the cell count and the tab, and the rule for changed cells', E.confirms[0], CONFIRM);
    var m = E.sent[0];
    eq('apply: one ecSheetApply message', E.sent.length + ':' + m.action, '1:ecSheetApply');
    jeqE('apply: the payload has exactly the eight documented fields', Object.keys(m.payload).sort(), ['descCol', 'eCol', 'fgCols', 'notesCol', 'spreadsheetId', 'tabTitle', 'textCols', 'writes']);
    jeqE('apply: sheet, tab and text columns (the description column as an index)', [m.payload.spreadsheetId, m.payload.tabTitle, m.payload.textCols], ['EXPLAN_EX2_TEST_PLAN_00000000002', 'QA Round 1', [2]]);
    jeqE('apply: descCol is the Description column as an INDEX (the worker takes its letter itself); desktop E, notes H, mobile and web-based F and G are letters', [m.payload.descCol, m.payload.eCol, m.payload.notesCol, m.payload.fgCols], [2, 'E', 'H', ['F', 'G']]);
    ok('apply: textCols contains descCol (ecwSheetApply refuses F/G writes otherwise: integration decision I-9)', m.payload.textCols.indexOf(m.payload.descCol) >= 0 && typeof m.payload.descCol === 'number');
    eq('apply: exactly the proposed writes, in order', m.payload.writes.map(function (w) { return w.a1; }).join(), 'E9,H9,E33,F33,G33');
    ok('apply: every write in F or G sits on a visual / dark-mode row', m.payload.writes.filter(function (w) { return /^[FG][0-9]/.test(w.a1); }).every(function (w) { return /overall visuals|al+ignment|spacing|overlap|dark mode/i.test(w.rowText); }));
    ok('apply: the button was disabled while writing', E.btnWasDisabled === true);
    ok('apply: the outcome is on the sheet (ok, with a timestamp)', _ecLastRun.sheet.applied.ok === true && typeof _ecLastRun.sheet.applied.at === 'number' && _ecLastRun.sheet.applied.written === 5);
    var log = E.store.local.ecSheetWriteLog;
    ok('apply: the write log gets the outcome', log && log.length === 1 && log[0].written === 5 && log[0].verified === 5 && log[0].tabTitle === 'QA Round 1' && log[0].spreadsheetId === 'EXPLAN_EX2_TEST_PLAN_00000000002' && log[0].error === null && Array.isArray(log[0].dropped) && Array.isArray(log[0].mismatches), log);
    ok('apply: the record is persisted and the results rendered again', renders >= 1 && E.sessionSets.some(function (o) { return o.ecLastRun && o.ecLastRun.sheet && o.ecLastRun.sheet.applied; }));
    E.sent.length = 0; E.confirms.length = 0; apply();
    ok('apply: a second click after a good write sends nothing and asks nothing', E.sent.length === 0 && E.confirms.length === 0);
    // declined
    reset(); E.confirmAnswer = false; apply();
    ok('apply: a declined confirm sends nothing and changes nothing', E.sent.length === 0 && !_ecLastRun.sheet.applied && E.confirms.length === 1);
    // nothing selected
    reset(); _ecLastRun.sheet.proposal.entries.forEach(function (e) { e.include = false; }); apply();
    ok('apply: nothing selected: no confirm, no message, the status says so', E.sent.length === 0 && E.confirms.length === 0 && E.el('ec-apply-status').textContent === 'Nothing selected to write.', E.el('ec-apply-status').textContent);
    // failures
    reset(); E.replies.ecSheetApply = { ok: false, error: 'Nothing was written: boom', needsConnect: true };
    apply();
    ok('apply: a failed write is on the sheet, not ok, and can be retried', _ecLastRun.sheet.applied.ok === false && _ecLastRun.sheet.applied.error === 'Nothing was written: boom' && _ecLastRun.sheet.applied.needsConnect === true);
    ok('  and logged with its error', E.store.local.ecSheetWriteLog[0].error === 'Nothing was written: boom' && E.store.local.ecSheetWriteLog[0].written === 0);
    E.sent.length = 0; apply();
    eq('  the retry sends again', E.sent.length, 1);
    reset(); E.replies.ecSheetApply = function () { return Promise.reject(new Error('port closed')); };
    apply();
    eq('apply: a rejected message is the error', _ecLastRun.sheet.applied.error, 'port closed');
    reset(); E.replies.ecSheetApply = undefined;
    apply();
    eq('apply: no answer at all', _ecLastRun.sheet.applied.error, 'No answer from the service worker.');
    // columns the plan lacks
    reset(); _ecLastRun.sheet.model.cols = { description: 2, desktop: 4, mobile: null, webBased: null, notes: null }; E.replies.ecSheetApply = { ok: true, written: 5, verified: 5 };
    apply();
    jeqE('apply: a plan with no Mobile, Web-Based or Notes column: no F/G letters and a null notes column', [E.sent[0].payload.fgCols, E.sent[0].payload.notesCol], [[], null]);
    reset(); _ecLastRun.sheet.model.cols = { description: 2, desktop: 4, mobile: 5, webBased: null, notes: 7 }; E.replies.ecSheetApply = { ok: true, written: 5, verified: 5 };
    apply();
    jeqE('apply: only a Mobile column: fgCols is [F]', E.sent[0].payload.fgCols, ['F']);
    // the log keeps the last 20
    reset(); E.store.local.ecSheetWriteLog = []; for (var i = 0; i < 25; i++) E.store.local.ecSheetWriteLog.push({ at: i, written: i });
    E.replies.ecSheetApply = { ok: true, written: 5, verified: 5 };
    apply();
    var l2 = E.store.local.ecSheetWriteLog;
    ok('apply: the write log keeps the last 20, newest last', l2.length === 20 && l2[19].written === 5 && l2[0].at === 6, [l2.length, l2[0] && l2[0].at]);
    // a storage fault on the log is swallowed
    reset(); E.setFails = true; E.replies.ecSheetApply = { ok: true, written: 5, verified: 5 };
    var sf = apply();
    ok('apply: a failing log write does not reject and the outcome is kept', sf.done && !sf.err && _ecLastRun.sheet.applied.ok === true, sf.err && String(sf.err));
    E.setFails = false;
    // no run / no sheet / not connected
    _ecLastRun = null; E.sent.length = 0; apply();
    ok('apply: with no run there is nothing to apply', E.sent.length === 0);
    reset({ connected: false }); apply();
    ok('apply: an unconnected sheet is not applied', E.sent.length === 0);
    reset({ proposal: null }); apply();
    ok('apply: a sheet with no proposal is not applied', E.sent.length === 0);
  });
});

TE('Email Check panel: Google', function () {
  var E = ecEnv();
  var PLAN = EC_PLANS['EX-2'] || EC_PLANS['EX-1'];
  var tabs = [{ sheetId: 100, title: 'QA Round 1', index: 0, hidden: false }, { sheetId: 101, title: 'Legend/Values [DO NOT REMOVE]', index: 1, hidden: false }, { sheetId: 102, title: 'Old round', index: 2, hidden: true }];
  withGlobals(E.globals(), function () {
    eval(ecPanelSrc());
    function reset() { E.sent.length = 0; E.replies = {}; E.store = { local: {}, sync: {} }; E.els = {}; E.ctx = exCtx('EX-2'); }
    function refresh(msg) { return settleE(ecUiRefreshSheet(msg)); }
    var st = function () { return E.el('ec-sheet-status').textContent; };
    reset(); E.replies.qpGoogleStatus = null;
    refresh();
    eq('google: no answer from the worker', st(), 'Google status unavailable: no answer from the service worker.');
    ok('  both buttons hidden, the tab list reset', E.el('btn-ec-google-connect').style.display === 'none' && E.el('btn-ec-google-disconnect').style.display === 'none' && E.el('ec-sheet-tab').disabled === true);
    reset(); E.replies.qpGoogleStatus = { ok: false, error: 'boom' }; refresh('tail');
    eq('google: a status error, with the caller\'s tail', st(), 'Google status unavailable: boom tail');
    reset(); E.replies.qpGoogleStatus = { ok: true, clientIdSet: false, connected: false }; refresh();
    eq('google: no OAuth client id', st(), 'Add a Google OAuth client ID in Settings (gear) to read and write the test plan. Without it Email Check gives a paste-ready table.');
    ok('  no buttons', E.el('btn-ec-google-connect').style.display === 'none' && E.el('btn-ec-google-disconnect').style.display === 'none');
    reset(); E.replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: false }; refresh();
    eq('google: not connected', st(), 'Google is not connected.');
    ok('  Connect shown, Disconnect hidden', E.el('btn-ec-google-connect').style.display === '' && E.el('btn-ec-google-disconnect').style.display === 'none');
    reset(); E.ctx = exCtx('EX-2', { qaTestPlanUrl: null }); E.replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: true }; refresh();
    eq('google: connected, no test plan link', st(), 'Google connected. The active ticket\'s QA test plan link is missing, so Email Check gives a paste-ready table.');
    ok('  Connect hidden, Disconnect shown', E.el('btn-ec-google-connect').style.display === 'none' && E.el('btn-ec-google-disconnect').style.display === '');
    reset(); E.ctx = exCtx('EX-2', { qaTestPlanUrl: 'https://www.example.org/plan' }); E.replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: true }; refresh();
    eq('google: connected, the link is not a sheet', st(), 'Google connected. The active ticket\'s QA test plan link is not a Google Sheet, so Email Check gives a paste-ready table.');
    reset(); E.replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: true }; E.replies.qpSheetMeta = { ok: false, error: 'HTTP 500' }; refresh();
    eq('google: the tabs could not be listed', st(), 'Google connected, but the test plan tabs could not be listed: HTTP 500');
    E.replies.qpSheetMeta = { ok: false, error: 'expired', needsConnect: true }; refresh();
    eq('google: ... and the token needs a reconnect', st(), 'Google connected, but the test plan tabs could not be listed: expired Use Connect Google.');
    ok('  so Connect is shown', E.el('btn-ec-google-connect').style.display === '');
    reset(); E.replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: true }; E.replies.qpSheetMeta = { ok: true, title: '[EX-2] EMAIL Test Plan', tabs: tabs }; refresh();
    eq('google: the plan is named', st(), 'Google connected. Test plan: "[EX-2] EMAIL Test Plan".');
    ok('  the tab list holds the visible tabs only', /value="QA Round 1"/.test(E.el('ec-sheet-tab').innerHTML) && /value="Legend\/Values \[DO NOT REMOVE\]"/.test(E.el('ec-sheet-tab').innerHTML) && E.el('ec-sheet-tab').innerHTML.indexOf('Old round') < 0 && E.el('ec-sheet-tab').disabled === false);
    eq('  the tab whose id is the link gid (100) is preselected', E.el('ec-sheet-tab').value, 'QA Round 1');
    reset(); E.ctx = exCtx('EX-2', { qaTestPlanUrl: 'https://docs.google.com/spreadsheets/d/EXPLAN_EX2_TEST_PLAN_00000000002/edit' });
    E.replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: true }; E.replies.qpSheetMeta = { ok: true, title: 'T', tabs: [tabs[1], tabs[0]] }; refresh();
    eq('google: with no gid the first QA-looking tab that is not the Values tab', E.el('ec-sheet-tab').value, 'QA Round 1');
    E.store.local.ecSheetPrefs = { EXPLAN_EX2_TEST_PLAN_00000000002: { tabTitle: 'Legend/Values [DO NOT REMOVE]' } }; refresh();
    eq('google: a remembered tab beats the gid and the guess', E.el('ec-sheet-tab').value, 'Legend/Values [DO NOT REMOVE]');
    E.store.local.ecSheetPrefs = {}; E.replies.qpSheetMeta = { ok: true, title: 'T', tabs: [tabs[1]] }; refresh();
    eq('google: only a Values tab: nothing is preselected', E.el('ec-sheet-tab').value, '');
    // the Docs permission
    reset(); E.replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: true, docsGranted: false }; E.replies.qpSheetMeta = { ok: true, title: '[EX-2] EMAIL Test Plan', tabs: tabs }; refresh();
    eq('google: connected without the Docs permission says to connect again', st(), 'Google connected. Test plan: "[EX-2] EMAIL Test Plan". Connect Google again: the Docs permission was added after you connected.');
    ok('  and keeps Connect visible next to Disconnect', E.el('btn-ec-google-connect').style.display === '' && E.el('btn-ec-google-disconnect').style.display === '');
    E.replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: true, docsGranted: true }; refresh();
    ok('google: with the Docs permission nothing is added and Connect is hidden', st().indexOf('Docs permission') < 0 && E.el('btn-ec-google-connect').style.display === 'none');
    E.replies.qpGoogleStatus = { ok: true, clientIdSet: true, connected: true }; refresh();
    ok('google: a worker that does not report docsGranted adds nothing', st().indexOf('Docs permission') < 0);
    ok('google: the write-notes and re-test boxes are not touched here (ecSettings holds them)', E.els['ec-write-notes'] === undefined && E.els['ec-retest-inprogress'] === undefined);
    // connect / disconnect / onShow with the refresh stubbed
    var calls = [];
    ecUiRefreshSheet = function (m) { calls.push(m === undefined ? 'undef' : m); return Promise.resolve(); };
    reset(); E.replies.qpGoogleConnect = { ok: true };
    settleE(ecUiConnectGoogle());
    jeqE('connect: asks the worker, then refreshes with no message', [E.sent.map(function (x) { return x.action; }), calls], [['qpGoogleConnect'], ['']]);
    calls.length = 0; E.replies.qpGoogleConnect = { ok: false, error: 'popup closed' }; settleE(ecUiConnectGoogle());
    jeqE('connect: a failure is the refresh message', calls, ['Sign-in: popup closed']);
    calls.length = 0; E.replies.qpGoogleConnect = null; settleE(ecUiConnectGoogle());
    jeqE('connect: no answer is "failed."', calls, ['Sign-in: failed.']);
    calls.length = 0; E.replies.qpGoogleConnect = function () { return Promise.reject(new Error('port closed')); }; settleE(ecUiConnectGoogle());
    jeqE('connect: a rejection is its message', calls, ['Sign-in: port closed']);
    eq('connect: the status line announced the sign-in first', E.el('ec-sheet-status').textContent, 'Opening Google sign-in…');
    calls.length = 0; E.sent.length = 0; E.replies.qpGoogleDisconnect = function () { return Promise.reject(new Error('x')); };
    var dj = settleE(ecUiDisconnectGoogle());
    jeqE('disconnect: asks the worker (a rejection is swallowed), then refreshes', [E.sent.map(function (x) { return x.action; }), calls, dj.err === undefined], [['qpGoogleDisconnect'], ['undef'], true]);
    // onShow
    var order = [], seenCtx = null;
    ecUiRenderCtx = function () { order.push('ctx'); return Promise.resolve({ ticketKey: 'EX-2' }); };
    ecUiRenderRules = function (c) { order.push('rules'); seenCtx = c; return Promise.resolve(); };
    ecUiRefreshSheet = function () { order.push('sheet'); return Promise.resolve(); };
    settleE(ecUiOnShow());
    jeqE('onShow: context, then rules (given the context), then the sheet', [order, seenCtx && seenCtx.ticketKey], [['ctx', 'rules', 'sheet'], 'EX-2']);
    order.length = 0; ecUiRenderCtx = function () { order.push('ctx'); return Promise.reject(new Error('a')); };
    var o1 = settleE(ecUiOnShow());
    jeqE('onShow: a failing context read does not skip the rules or the sheet, and does not reject', [order, o1.err === undefined], [['ctx', 'rules', 'sheet'], true]);
    order.length = 0; ecUiRenderCtx = function () { order.push('ctx'); return Promise.resolve(null); }; ecUiRenderRules = function () { order.push('rules'); throw new Error('b'); };
    var o2 = settleE(ecUiOnShow());
    jeqE('onShow: a throwing rules step does not skip the sheet', [order, o2.err === undefined], [['ctx', 'rules', 'sheet'], true]);
  });
});

TE('Email Check panel: initEmailCheck', function () {
  var E = ecEnv(), ids = [];
  var g = E.globals(ecHtmlStubs());
  var inner = g.document.getElementById;
  g.document.getElementById = function (id) { ids.push(id); return inner(id); };
  withGlobals(g, function () {
    eval(ecPanelSrc());
    var order = [], saved = { rules: 0, prefs: 0 }, rendered = [];
    ecUiFillProfiles = function () { order.push('fill'); };
    ecUiApplyPrefs = function (p) { order.push('apply:' + JSON.stringify(p)); };
    ecUiSaveRules = function () { saved.rules++; return Promise.resolve(); };
    ecUiSavePrefs = function () { saved.prefs++; return Promise.resolve(); };
    ecUiRenderResults = function (r) { rendered.push(r); };
    var connected = 0, disconnected = 0, rc = [], rk = [];
    ecUiConnectGoogle = function () { connected++; return Promise.resolve(); }; ecUiDisconnectGoogle = function () { disconnected++; return Promise.resolve(); };
    ecUiOnResultsChange = function (e) { rc.push(e); }; ecUiOnResultsClick = function (e) { rk.push(e); };
    function reset() { E.els = {}; E.nodes = {}; E.sent.length = 0; E.store = { local: {}, sync: {} }; E.sessionGets = {}; order.length = 0; saved.rules = 0; saved.prefs = 0; rendered.length = 0; ids.length = 0; _ecLastRun = null; }
    // an event target as the DOM gives one: it knows its id, its dataset and what it matches
    function target(id, ds, inside) {
      var t = { id: id, dataset: ds || {}, checked: false };
      t.matches = function (sel) { return (id && sel.indexOf('#' + id) >= 0) || (t.dataset.ecSeg !== undefined && /data-ec-seg/.test(sel)); };
      t.closest = function (sel) { return t.matches(sel) || (inside && sel.indexOf(inside) >= 0) ? t : null; };
      return t;
    }
    // no #ec-body: nothing is bound, nothing is read
    reset(); E.nodes['ec-body'] = null;
    var r = settleE(initEmailCheck());
    ok('init: without #ec-body it returns quietly and reads nothing', r.done && !r.err && E.sent.length === 0 && order.length === 0 && Object.keys(E.els).length === 0, r.err && String(r.err));
    // the normal start
    reset(); E.store.local.ecSettings = { profileChoice: 'generic', eoaRenders: false }; E.sessionGets.ecLastRun = ecHandRecord({ ts: 5 });
    r = settleE(initEmailCheck());
    ok('init: resolves', r.done && !r.err, r.err && String(r.err));
    eq('init: the profile options are filled BEFORE the stored choice is applied', order.join('|'), 'fill|apply:' + JSON.stringify({ profileChoice: 'generic', eoaRenders: false }));
    var body = E.el('ec-body');
    ok('init: #ec-body listens for change and input, once each', (body.listeners.change || []).length === 1 && (body.listeners.input || []).length === 1, Object.keys(body.listeners));
    ok('init: Google connect, disconnect, the tab select and the results box are bound', (E.el('btn-ec-google-connect').listeners.click || []).length === 1 && (E.el('btn-ec-google-disconnect').listeners.click || []).length === 1 && (E.el('ec-sheet-tab').listeners.change || []).length >= 1 && (E.el('ec-results').listeners.change || []).length === 1 && (E.el('ec-results').listeners.click || []).length === 1);
    ok('init: it never touches the Settings Google fields (initQaPass owns them)', ids.every(function (i) { return !/^set-google|^btn-set-google/.test(i); }), ids.filter(function (i) { return /set-google/.test(i); }));
    eq('init: the last run is restored and rendered', rendered.length === 1 && rendered[0].ts === 5 && _ecLastRun && _ecLastRun.ts === 5, true);
    // what a change does
    var onChange = body.listeners.change[0], onInput = body.listeners.input[0];
    var utm = target('ec-utm-rule', { source: 'suggested', comment: '420001' });
    onChange({ target: utm });
    ok('change on the UTM rule: it becomes the tester\'s, loses its comment, and the rules are saved', utm.dataset.source === 'tester' && utm.dataset.comment === '' && saved.rules === 1 && saved.prefs === 0, [utm.dataset, saved]);
    var seg = target(null, { ecSeg: 'Regular Donors', source: 'suggested', comment: '420003' });
    onInput({ target: seg });
    ok('input on a segment path: the same', seg.dataset.source === 'tester' && seg.dataset.comment === '' && saved.rules === 2 && saved.prefs === 0, [seg.dataset, saved]);
    var doc = target('ec-doc-email', {});
    onInput({ target: doc });
    ok('input on the doc email: it saves the rules too', saved.rules === 3 && saved.prefs === 0);
    onChange({ target: target('ec-eoa-renders', {}) });
    ok('change on any other control saves the prefs, not the rules', saved.prefs === 1 && saved.rules === 3);
    onChange({ target: target('ec-profile', {}) });
    ok('  the profile select too', saved.prefs === 2);
    onChange({ target: target('ec-sheet-tab', {}, '#ec-sheet-tab') });
    onChange({ target: target('x-inside-results', {}, '#ec-results') });
    ok('a target inside the results box or the tab select is ignored by the body handler', saved.prefs === 2 && saved.rules === 3);
    E.el('ec-sheet-tab').listeners.change[0]({ target: E.el('ec-sheet-tab') });
    eq('the tab select has its own handler: it saves the prefs', saved.prefs, 3);
    E.el('btn-ec-google-connect').listeners.click[0](); E.el('btn-ec-google-disconnect').listeners.click[0]();
    eq('the buttons call connect and disconnect', connected + ':' + disconnected, '1:1');
    E.el('ec-results').listeners.change[0]({ a: 1 }); E.el('ec-results').listeners.click[0]({ b: 2 });
    jeqE('the results box delegates change and click to the two results handlers', [rc, rk], [[{ a: 1 }], [{ b: 2 }]]);
    // a stored run of another version is not restored; a missing one neither
    reset(); E.sessionGets.ecLastRun = ecHandRecord({ version: 99 });
    settleE(initEmailCheck());
    ok('init: a stored run of another record version is not restored', _ecLastRun === null && rendered.length === 0);
    reset(); settleE(initEmailCheck());
    ok('init: no stored run, no stored settings: still fine', _ecLastRun === null && order[0] === 'fill');
    // optional elements may be missing
    reset(); E.nodes['btn-ec-google-connect'] = null; E.nodes['btn-ec-google-disconnect'] = null; E.nodes['ec-sheet-tab'] = null; E.nodes['ec-results'] = null;
    var rm = settleE(initEmailCheck());
    ok('init: missing optional elements do not throw', rm.done && !rm.err, rm.err && String(rm.err));
  });
});

// ── Email Check: report ───────────────────────────────────────────────────
section('Email Check: report');

var EC_NAME = 'Email Check (Mailtrap + copy doc)';
// The two readers of a record's problems and debug section (QA Pass's report test slices the same two inside its own scope).
eval(slicePopup('function taModeProblems(entry, add) {', '\n// The debug-log section for a WCAG'));
eval(slicePopup('function taDebugSection(entry) {', '\n// ONE projection for a finding'));
function ecEntry(rec, over) { return Object.assign({ mode: 'emailcheck', name: EC_NAME, status: 'ran', data: rec }, over || {}); }
// What the report must never carry. '/h/' is checked only where no scrubbed Pardot path is meant to appear.
var EC_FORBIDDEN = ['@inbox.mailtrap.io', '2000000002', 'SynthHash0', '0123456789abcdef0123456789abcdef', 'testing_message_parts', 'bounce-', 'List-Unsubscribe', 'Received'];
function ecLeaks(text, extra) { return EC_FORBIDDEN.concat(extra || []).filter(function (s) { return String(text).indexOf(s) >= 0; }); }
function ecH3s(html) { var out = [], re = /<h3[^>]*>([^<]*)<\/h3>/g, m; while ((m = re.exec(html))) out.push(m[1]); return out; }
// The sub-section bodies, keyed by heading: the text between one <h3> and the next (the section ends at </section>).
function ecParts(html) {
  var out = {}, re = /<h3[^>]*>([^<]*)<\/h3>/g, m, last = null, lastIdx = 0;
  while ((m = re.exec(html))) { if (last !== null) out[last] = html.slice(lastIdx, m.index); last = m[1]; lastIdx = m.index + m[0].length; }
  if (last !== null) out[last] = html.slice(lastIdx, html.indexOf('</section>', lastIdx) < 0 ? html.length : html.indexOf('</section>', lastIdx));
  return out;
}
var EC_HEADINGS = ['Failed', 'Needs a person', 'Blocked', 'Passed', 'Proofs', 'Links and UTMs', 'Copy differences', 'Email on Acid', 'Analysis (Opus)', 'Not tested', 'Sheet changes'];
// A record that is complete and clean enough for the wiring tests: no failed check, nothing unresolved, every source ok.
function ecCleanRecord(over) {
  var r = ecHandRecord();
  r.proofs = [r.proofs[0]]; r.links = r.links.slice(0, 2);
  r.checks = [ecCk('subject', 'regular-donors-v0', 'passed', ''), ecCk('visuals', 'regular-donors-v0', 'in-progress', 'Look at each render')];
  return Object.assign(r, over || {});
}

TE('Email Check report: the section, its badge and its eleven headings', function () {
  var h = rptEmailCheckSection(ecEntry(ecHandRecord()));
  jeqE('the eleven sub-headings, in order', ecH3s(h), EC_HEADINGS);
  ok('wrapped by the shared section shell with the mode name', /^\s*<section class="rpt-section">/.test(h) && h.indexOf('<h2>' + EC_NAME + '</h2>') >= 0);
  ok('badge: a failed check is ISSUES FOUND', h.indexOf('rpt-badge-fail') >= 0 && h.indexOf('ISSUES FOUND') >= 0);
  ok('the summary counts failed, passed, need a person, blocked and not tested (checks + the fixed rows)', h.indexOf('1 failed · 2 passed · 1 need a person · 1 blocked · 2 not tested') >= 0, h.slice(0, 500));
  var clean = rptEmailCheckSection(ecEntry(ecCleanRecord()));
  ok('badge: nothing failed but something in progress is NEEDS REVIEW', clean.indexOf('NEEDS REVIEW') >= 0 && clean.indexOf('rpt-badge-issues') >= 0, clean.slice(0, 300));
  ok('badge: every check passed is PASS', rptEmailCheckSection(ecEntry(ecCleanRecord({ checks: [ecCk('subject', 'regular-donors-v0', 'passed', '')] }))).indexOf('rpt-badge-pass') >= 0);
  var st = rptEmailCheckSection(ecEntry(ecCleanRecord({ stopped: true })));
  ok('badge: a stopped run with no failure is INCOMPLETE, and the summary says so', st.indexOf('INCOMPLETE') >= 0 && st.indexOf(' · stopped by the tester') >= 0);
  ok('a skipped entry is a skipped section', rptEmailCheckSection({ mode: 'emailcheck', name: EC_NAME, status: 'skipped', reason: 'Not configured.' }).indexOf('SKIPPED') >= 0);
  var bare = rptEmailCheckSection({ mode: 'emailcheck', name: EC_NAME, status: 'ran' });
  ok('an entry with no data does not throw and still prints the eleven headings', typeof bare === 'string' && ecH3s(bare).length === 11, ecH3s(bare));
  // (the sheet part's two table builders are stubbed here so that this check is about the helpers tolerating an empty record)
  var bare2 = withGlobals({ ecPasteRows: function () { return []; }, ecPasteHtml: function () { return '<div class="ec-empty">Nothing to paste.</div>'; } }, function () { return rptEmailCheckSection(ecEntry({ version: 1 })); });
  ok('a record with only a version too: eleven headings and no helper failed', ecH3s(bare2).length === 11 && bare2.indexOf('could not be built') < 0, bare2.indexOf('could not be built'));
  // one bad part never costs the rest
  withGlobals({ rptEmailCheckProofs: function () { throw new Error('boom <b>'); } }, function () {
    var h2 = rptEmailCheckSection(ecEntry(ecHandRecord()));
    ok('a helper that throws is replaced by one line naming the error (escaped)', h2.indexOf('This part of the report could not be built: boom &lt;b&gt;') >= 0 && h2.indexOf('<b>') < 0, h2.slice(0, 200));
    jeqE('  and every heading is still there, in order', ecH3s(h2), EC_HEADINGS);
  });
  var src = slicePopup('function rptEmailCheckSection(entry) {', '\n// ── QA Pass (Test Agent mode \'qapass\'): the report section');
  ok('the section function is defined before QA Pass\'s section and names no QA Pass function', _pu.indexOf('function rptEmailCheckSection(') < _pu.indexOf('function rptQaPassSection(') && !/\bqp(?:Scrub|PathOnly|Fresh)/.test(src));
  ok('the report names no model id and no Jira write route', !/claude-|\/rest\/api\/|transitionIssue|addComment/.test(src));
});

TE('Email Check report: Failed, Needs a person, Blocked, Passed', function () {
  var h = rptEmailCheckSection(ecEntry(ecHandRecord())), P = ecParts(h);
  ok('Failed: a table row with the title, the id, the proof and the note', /<table class="rpt-table">/.test(P.Failed) && P.Failed.indexOf('Title of altTags') >= 0 && P.Failed.indexOf('altTags@regular-donors-v0') >= 0 && P.Failed.indexOf('<td>regular-donors-v0</td>') >= 0 && P.Failed.indexOf('V0 image hero.jpg has no alt') >= 0, P.Failed);
  ok('Failed: the note is scrubbed again (a Pardot path loses its prospect id and hash)', P.Failed.indexOf('2000000002') < 0 && P.Failed.indexOf('SynthHash0') < 0 && P.Failed.indexOf('[prospect]') >= 0, P.Failed);
  ok('Failed lists only the failed check', P.Failed.indexOf('subject@') < 0 && P.Failed.indexOf('preview@') < 0 && P.Failed.indexOf('dkim@') < 0);
  eq('Needs a person: one item per in-progress check', (P['Needs a person'].match(/<li>/g) || []).length, 1);
  ok('  with its id and note', P['Needs a person'].indexOf('<li>preview@regular-donors-v0: Preview text differs by one word</li>') >= 0, P['Needs a person']);
  ok('Blocked: id, title, who blocked it and why', P.Blocked.indexOf('<li>dkim@regular-donors-v1 — Title of dkim: blocked by proof: Proof not found in sandbox 7000001 (message 7100000006)</li>') >= 0, P.Blocked);
  ok('Passed: one line per key, the proofs that passed', P.Passed.indexOf('<li>subject: regular-donors-v0</li>') >= 0 && P.Passed.indexOf('<li>rawTokens: regular-donors-v0</li>') >= 0 && (P.Passed.match(/<li>/g) || []).length === 2, P.Passed);
  ok('  in the order of the test plan rows (subject before rawTokens)', P.Passed.indexOf('subject:') < P.Passed.indexOf('rawTokens:'));
  var two = ecHandRecord({ checks: [ecCk('rawTokens', 'regular-donors-v0', 'passed', ''), ecCk('rawTokens', 'regular-donors-v1', 'passed', ''), ecCk('subject', 'regular-donors-v1', 'passed', ''), ecCk('subject', 'regular-donors-v0', 'passed', ''), ecCk('dkim', 'regular-donors-v0', 'failed', 'x')] });
  var P2 = ecParts(rptEmailCheckSection(ecEntry(two)));
  ok('Passed: the proofs of a key are joined in record order; keys follow the plan\'s row order, not the record\'s', P2.Passed.indexOf('<li>subject: regular-donors-v1, regular-donors-v0</li>') >= 0 && P2.Passed.indexOf('subject:') < P2.Passed.indexOf('rawTokens:') && P2.Passed.indexOf('<li>rawTokens: regular-donors-v0, regular-donors-v1</li>') >= 0, P2.Passed);
  // the empty forms, helper by helper
  var none = { checks: [] };
  ok('empty: Failed', rptEmailCheckFailed(none) === '<p class="rpt-muted">No check failed.</p>');
  ok('empty: Needs a person', rptEmailCheckNeedsPerson(none) === '<p class="rpt-muted">Nothing is waiting on a person.</p>');
  ok('empty: Blocked', rptEmailCheckBlocked(none) === '<p class="rpt-muted">Nothing is blocked.</p>');
  ok('empty: Passed', rptEmailCheckPassed(none) === '<p class="rpt-muted">No check passed.</p>');
  ok('empty: all four tolerate a record with no checks key', rptEmailCheckFailed({}) === rptEmailCheckFailed(none) && rptEmailCheckPassed({}) === rptEmailCheckPassed(none));
  // markup in a note, a title and an id is escaped everywhere
  var evil = ecHandRecord({ checks: [ecCk('subject', 'p"><i>', 'failed', '<script>x</script>', { title: 'T <img>' }), ecCk('rawTokens', 'p"><i>', 'in-progress', '<script>y</script>'), ecCk('dkim', 'p"><i>', 'blocked', '<script>z</script>', { blockedBy: '<b>' }), ecCk('preview', 'p"><i>', 'passed', '')] });
  var he = rptEmailCheckFailed(evil) + rptEmailCheckNeedsPerson(evil) + rptEmailCheckBlocked(evil) + rptEmailCheckPassed(evil);
  ok('Failed, Needs a person, Blocked and Passed escape what they print', he.indexOf('<script>') < 0 && he.indexOf('<i>') < 0 && he.indexOf('<img>') < 0 && he.indexOf('<b>') < 0 && he.indexOf('&lt;script&gt;x&lt;/script&gt;') >= 0, he);
  ok('the statuses come from the checks alone: an analysis that claims a check passed changes nothing here', (function () {
    var rec = ecHandRecord({ explain: { ok: true, bugs: [{ summary: 'all fine, altTags passed', status: 'passed', checkIds: ['altTags@regular-donors-v0'], commentIds: [], severity: 'low' }], pgmQuestions: [], commentChecks: [], copyNotes: [], dropped: 0 } });
    var Pp = ecParts(rptEmailCheckSection(ecEntry(rec)));
    return Pp.Failed.indexOf('altTags@regular-donors-v0') >= 0 && Pp.Passed.indexOf('altTags') < 0;
  })());
});

TE('Email Check report: Proofs, Links and UTMs', function () {
  var rec = ecHandRecord();
  var P = ecParts(rptEmailCheckSection(ecEntry(rec)));
  ok('Proofs: the table header names the nine columns', P.Proofs.indexOf('<th>Proof</th><th>Subject</th><th>From</th><th>Reply-To</th><th>Preheader</th><th>DKIM</th><th>Spam</th><th>Links resolved</th><th>Email on Acid</th>') >= 0, P.Proofs);
  ok('Proofs: the subject and the copy doc option it matches', P.Proofs.indexOf('Last call: order a kit today') >= 0 && P.Proofs.indexOf('copy doc option 1, exact') >= 0, P.Proofs);
  ok('Proofs: From, Reply-To, preheader, DKIM domains, spam score', P.Proofs.indexOf('Example Relief info@example.org') >= 0 && P.Proofs.indexOf('none') >= 0 && P.Proofs.indexOf('Packing stops Friday noon.') >= 0 && P.Proofs.indexOf('example.org, s1.mta.example.net') >= 0 && P.Proofs.indexOf('score 0.6 / 5') >= 0, P.Proofs);
  ok('Proofs: links resolved is n/m over the unguarded Pardot links of the proof (one of two resolved)', P.Proofs.indexOf('1/2') >= 0, P.Proofs);
  ok('Proofs: the EoA clients and how many completed', P.Proofs.indexOf('3 clients, 2 completed') >= 0, P.Proofs);
  ok('Proofs: a proof that was not read shows its state across the row', /<td>regular-donors-v1<\/td><td colspan="8">not-found/.test(P.Proofs), P.Proofs);
  var bad = ecHandRecord(); bad.proofs[1].state = 'error'; bad.proofs[1].error = 'HTTP 500 for tester+regular@inbox.mailtrap.io <b>';
  var Pb = ecParts(rptEmailCheckSection(ecEntry(bad)));
  ok('Proofs: an error is scrubbed and escaped', /colspan="8">error: /.test(Pb.Proofs) && Pb.Proofs.indexOf('@inbox.mailtrap.io') < 0 && Pb.Proofs.indexOf('[mailtrap inbox]') >= 0 && Pb.Proofs.indexOf('<b>') < 0, Pb.Proofs);
  var noDoc = ecHandRecord({ doc: null }); var Pn = ecParts(rptEmailCheckSection(ecEntry(noDoc)));
  ok('Proofs: without a copy doc no option is claimed', Pn.Proofs.indexOf('copy doc option') < 0 && Pn.Proofs.indexOf('Last call: order a kit today') >= 0);
  var diff = ecHandRecord(); diff.proofs[0].facts.subject.built = 'Last chance: triple your gift';
  ok('Proofs: a subject close to an option says closest', ecParts(rptEmailCheckSection(ecEntry(diff))).Proofs.indexOf('copy doc option 1, closest') >= 0);
  var rp = ecHandRecord(); rp.proofs[0].facts.replyTo = 'help@example.org'; rp.proofs[0].facts.spam = null; rp.proofs[0].facts.dkim = [];
  var Pr = ecParts(rptEmailCheckSection(ecEntry(rp))).Proofs;
  ok('Proofs: a Reply-To is printed; no spam report and no DKIM are marked', Pr.indexOf('help@example.org') >= 0 && Pr.indexOf('score') < 0 && Pr.indexOf('none') >= 0, Pr);
  ok('Proofs: none read', rptEmailCheckProofs({ proofs: [] }) === '<p class="rpt-muted">No proof was read.</p>' && rptEmailCheckProofs({}) === '<p class="rpt-muted">No proof was read.</p>');
  // links
  ok('Links: one block per proof that has links, headed by the proof id', P['Links and UTMs'].indexOf('<p><strong>regular-donors-v0</strong></p>') >= 0 && P['Links and UTMs'].indexOf('<strong>regular-donors-v1</strong>') < 0, P['Links and UTMs']);
  ok('Links: the header', P['Links and UTMs'].indexOf('<th>Link</th><th>Role</th><th>Destination</th><th>UTM</th><th>Status</th>') >= 0);
  ok('Links: label, linkId, role, destination origin + path', P['Links and UTMs'].indexOf('DONATE NOW') >= 0 && P['Links and UTMs'].indexOf('8001') >= 0 && P['Links and UTMs'].indexOf('donate') >= 0 && P['Links and UTMs'].indexOf('https://www.example.org/give/seed-kits/') >= 0, P['Links and UTMs']);
  ok('Links: the UTM keys, one per line', P['Links and UTMs'].indexOf('utm_source=pardot<br>utm_medium=email<br>utm_content=02.01.27_EML_Seed_Kits_CRO-v0') >= 0, P['Links and UTMs']);
  ok('Links: the statuses and the destination title', P['Links and UTMs'].indexOf('200 → 200') >= 0 && P['Links and UTMs'].indexOf('Example Relief | Give') >= 0);
  ok('Links: a guarded link is listed as not opened, with nothing resolved', P['Links and UTMs'].indexOf('not opened: check by hand') >= 0 && P['Links and UTMs'].indexOf('unsubscribe link') >= 0, P['Links and UTMs']);
  ok('Links: an unresolved link shows its error', P['Links and UTMs'].indexOf('not resolved: cap') >= 0);
  ok('Links: no href is ever printed and no query string either', P['Links and UTMs'].indexOf('href=') < 0 && P['Links and UTMs'].indexOf('?') < 0, P['Links and UTMs']);
  ok('Links: none listed', rptEmailCheckLinks({ links: [] }) === '<p class="rpt-muted">No link was listed.</p>' && rptEmailCheckLinks({}) === '<p class="rpt-muted">No link was listed.</p>');
  var lk = ecHandRecord(); lk.links[0].labels = ['<i>x</i>']; lk.links[0].dest.utm = { utm_content: '"><b>' }; lk.links[0].destTitle = 'T <script>';
  var Pl = ecParts(rptEmailCheckSection(ecEntry(lk)))['Links and UTMs'];
  ok('Links: labels, UTM values and titles are escaped', Pl.indexOf('<i>') < 0 && Pl.indexOf('<b>') < 0 && Pl.indexOf('<script>') < 0 && Pl.indexOf('&lt;i&gt;x&lt;/i&gt;') >= 0, Pl);
  var dl = ecHandRecord(); dl.links = [{ proofId: 'regular-donors-v0', linkId: null, slug: null, labels: [], role: 'social', kind: 'direct', guard: null, method: 'direct', pardotStatus: null, dest: { origin: 'https://www.example.net', path: '/page/', utm: {}, otherKeys: [] }, destStatus: 404, destTitle: null, error: null }];
  var Pd = ecParts(rptEmailCheckSection(ecEntry(dl)))['Links and UTMs'];
  ok('Links: a direct link has no linkId and no UTM; its status is the destination\'s', Pd.indexOf('https://www.example.net/page/') >= 0 && Pd.indexOf('404') >= 0 && Pd.indexOf('null') < 0, Pd);
});

TE('Email Check report: Copy differences, Email on Acid, Analysis, Not tested', function () {
  var rec = ecHandRecord({ explain: { ok: true, bugs: [{ summary: 'The hero image has no alt <b>text</b>', checkIds: ['altTags@regular-donors-v0'], commentIds: ['420001'], severity: 'medium' }],
    pgmQuestions: [{ question: 'Which address should replies reach?', checkIds: ['replyTo@regular-donors-v0'], commentIds: [] }],
    commentChecks: [{ commentId: '420001', reproduced: 'not-checked', summary: 'No check covers it' }, { commentId: '420002', reproduced: 'yes', summary: 'Seen' }],
    copyNotes: [{ checkId: 'preview@regular-donors-v0', note: 'Looks like a typo.' }, { checkId: 'subject@regular-donors-v0', note: 'NOT SHOWN' }], dropped: 0 } });
  var P = ecParts(rptEmailCheckSection(ecEntry(rec)));
  ok('Copy: the word diff marks the removed and the added word, tokens escaped', P['Copy differences'].indexOf('<del>today</del>') >= 0 && P['Copy differences'].indexOf('<ins>tonight</ins>') >= 0 && P['Copy differences'].indexOf('<b>') < 0 && P['Copy differences'].indexOf('&lt;') >= 0, P['Copy differences']);
  ok('Copy: the check is named', P['Copy differences'].indexOf('<strong>preview@regular-donors-v0</strong>') >= 0);
  ok('Copy: the Opus note of that check is marked advisory, and a note for a check with no diff is not shown', P['Copy differences'].indexOf('(Opus, advisory) Looks like a typo.') >= 0 && P['Copy differences'].indexOf('NOT SHOWN') < 0, P['Copy differences']);
  var noEx = ecParts(rptEmailCheckSection(ecEntry(ecHandRecord())))['Copy differences'];
  ok('Copy: without an analysis there is no advisory line', noEx.indexOf('Opus') < 0 && noEx.indexOf('<del>today</del>') >= 0);
  var failedEx = ecParts(rptEmailCheckSection(ecEntry(ecHandRecord({ explain: { ok: false, error: 'x' } }))))['Copy differences'];
  ok('Copy: a failed analysis adds no advisory line', failedEx.indexOf('Opus') < 0);
  ok('Copy: none differ', rptEmailCheckCopy({ checks: [ecCk('subject', 'p', 'passed', '')] }) === '<p class="rpt-muted">No copy differs from the copy doc.</p>');
  ok('Copy: a diff whose text is not a string is skipped', rptEmailCheckCopy({ checks: [ecCk('preview', 'p', 'in-progress', '', { evidence: { diffs: [{ doc: 1, build: null }] } })] }).indexOf('<del>') < 0);
  // Email on Acid
  var E1 = P['Email on Acid'];
  ok('EoA: the variation, subject and inventory counts', E1.indexOf('<strong>v0</strong>') >= 0 && E1.indexOf('Last call: order a kit today') >= 0 && E1.indexOf('3 clients, 2 completed, 1 dark mode') >= 0, E1);
  ok('EoA: a valid JPEG data URL is printed as an image with its alt', E1.indexOf('<img src="data:image/jpeg;base64,/9j/AAAA" alt="Client A"') >= 0, E1);
  ok('EoA: any other value is never an image, only its caption', E1.indexOf('javascript:') < 0 && E1.indexOf('Client B (b_dm) · dark mode') >= 0 && (E1.match(/<img /g) || []).length === 1, E1);
  var inj = ecHandRecord(); inj.renders = [{ variation: 'v0', code: 'a', name: 'A', dark: false, img: 'data:image/jpeg;base64,AAAA" onerror="alert(1)' }, { variation: 'v0', code: 'b', name: 'B', dark: false, img: 'data:image/png;base64,AAAA' }, { variation: 'v0', code: 'c', name: 'C', dark: false, img: 5 }];
  var Ei = ecParts(rptEmailCheckSection(ecEntry(inj)))['Email on Acid'];
  ok('EoA: an injected attribute, a PNG and a non-string print no <img>', Ei.indexOf('<img') < 0 && Ei.indexOf('onerror') < 0, Ei);
  ['off', 'none', 'capped', 'error'].forEach(function (s) {
    var r2 = ecHandRecord(); r2.sources.eoa[0].renders = { state: s, count: 0, error: s === 'error' ? 'canvas <b>' : null };
    var T = ecParts(rptEmailCheckSection(ecEntry(r2)))['Email on Acid'];
    var want = { off: 'Renders were turned off.', none: 'No renders were captured.', capped: 'Renders were capped: some clients have no image.', error: 'Renders could not be captured: canvas &lt;b&gt;' }[s];
    ok('EoA: renders state ' + s, T.indexOf(want) >= 0, T);
  });
  var e3 = ecHandRecord(); e3.sources.eoa[0].state = 'error'; e3.sources.eoa[0].error = 'HTTP 403';
  ok('EoA: an unreadable page shows its state and error', ecParts(rptEmailCheckSection(ecEntry(e3)))['Email on Acid'].indexOf('error: HTTP 403') >= 0);
  ok('EoA: no link was given', rptEmailCheckEoa({ sources: { eoa: [] } }) === '<p class="rpt-muted">No Email on Acid link was given.</p>' && rptEmailCheckEoa({}) === '<p class="rpt-muted">No Email on Acid link was given.</p>');
  // Analysis
  var A = P['Analysis (Opus)'];
  ok('Analysis: the heading line says statuses are unchanged', A.indexOf('Analysis (Opus): grouping only, statuses above are unchanged.') >= 0, A);
  ok('Analysis: a bug, escaped, with its citations (check ids, comment ids, severity)', A.indexOf('The hero image has no alt &lt;b&gt;text&lt;/b&gt;') >= 0 && A.indexOf('(altTags@regular-donors-v0; comment 420001; medium)') >= 0, A);
  ok('Analysis: the questions and the comment checks (not-checked is spelled with a space)', A.indexOf('Which address should replies reach?') >= 0 && A.indexOf('comment 420001: reproduced not checked — No check covers it') >= 0 && A.indexOf('comment 420002: reproduced yes — Seen') >= 0, A);
  ok('Analysis: nothing of it leaks into the status sections', P.Failed.indexOf('hero image has no alt') < 0);
  ok('Analysis: not run', rptEmailCheckAnalysis({ explain: null }).indexOf('The analysis did not run') >= 0 && rptEmailCheckAnalysis({}).indexOf('The analysis did not run') >= 0);
  eq('Analysis: unavailable', rptEmailCheckAnalysis({ explain: { ok: false, error: 'No API key configured' } }), '<p class="rpt-muted">Analysis unavailable: No API key configured</p>');
  ok('Analysis: an empty bug list says so', rptEmailCheckAnalysis({ explain: { ok: true, bugs: [], pgmQuestions: [], commentChecks: [], copyNotes: [] } }).indexOf('The analysis grouped no failed check into a bug.') >= 0);
  var leak = rptEmailCheckAnalysis({ explain: { ok: true, bugs: [{ summary: 'see /e/900001/slug/8001/2000000002/h/SynthHash0 and tester+regular@inbox.mailtrap.io', checkIds: [], commentIds: [] }], pgmQuestions: [], commentChecks: [], copyNotes: [] } });
  ok('Analysis: model text is scrubbed too', ecLeaks(leak, ['/h/SynthHash0']).length === 0, leak);
  // Not tested
  ok('Not tested: the not-tested check and the fixed rows', P['Not tested'].indexOf('visuals@regular-donors-v0 — Title of visuals: Stopped by the tester before this check ran') >= 0 && P['Not tested'].indexOf('Unsubscribe / View in browser: never opened: check by hand') >= 0, P['Not tested']);
  ok('Not tested: nothing left untested', rptEmailCheckNotTested({ checks: [], notTested: [] }) === '<p class="rpt-muted">Everything this version checks was tested.</p>' && rptEmailCheckNotTested({}) === '<p class="rpt-muted">Everything this version checks was tested.</p>');
});

TE('Email Check report: Sheet changes', function () {
  var tbl = { ecProposalHtml: function (sh, o) { return '<table class="ec-proposal"><tr><td>proposal ' + !!(o && o.editable) + '</td></tr></table>'; }, ecPasteHtml: function (rows) { return '<table class="ec-paste"><tr><td>paste ' + (rows || []).length + '</td></tr></table>'; },
    ecPasteRows: function (checks, proofs) { return [{ row: 'derived from ' + checks.length + ' checks' }]; } };
  withGlobals(tbl, function () {
    var P = ecParts(rptEmailCheckSection(ecEntry(ecHandRecord({ sheet: ecSheetOK() }))))['Sheet changes'];
    ok('connected: counts, tab and the not-applied sentence', P.indexOf('Proposed 4 status change(s) and 1 note(s) to "QA Round 1" — not applied when this report was built; apply from the Email Check panel.') >= 0, P);
    ok('connected: the proposal table is read-only and gets the report table class', P.indexOf('<table class="rpt-table ec-proposal"><tr><td>proposal false</td></tr></table>') >= 0, P);
    ok('connected: nothing can be applied from the report', P.indexOf('<button') < 0 && P.indexOf('<input') < 0);
    var reasons = { 'no-test-plan-link': 'The ticket has no QA test plan link.', 'not-a-google-sheet-link': 'The QA test plan link is not a Google Sheet.', 'no-client-id': 'No Google OAuth client ID is set, so the test plan was not read.',
      'not-connected': 'Google is not connected, so the test plan was not read.', 'no-tab-picked': 'No test-plan tab was picked, so the test plan was not read.' };
    Object.keys(reasons).forEach(function (k) {
      var Q = ecParts(rptEmailCheckSection(ecEntry(ecHandRecord({ sheet: { connected: false, reason: k, error: null, paste: [{ a: 1 }, { a: 2 }] } }))))['Sheet changes'];
      ok('reason ' + k, Q.indexOf('<p>' + reasons[k] + ' Paste-ready rows:</p>') >= 0 && Q.indexOf('<table class="rpt-table ec-paste"><tr><td>paste 2</td></tr></table>') >= 0, Q);
    });
    var E1 = ecParts(rptEmailCheckSection(ecEntry(ecHandRecord({ sheet: { connected: false, error: 'boom <b>', paste: [] } }))))['Sheet changes'];
    ok('a read error is printed, escaped', E1.indexOf('The test plan could not be read: boom &lt;b&gt; Paste-ready rows:') >= 0 && E1.indexOf('<b>') < 0, E1);
    var N1 = ecParts(rptEmailCheckSection(ecEntry(ecHandRecord({ sheet: null }))))['Sheet changes'];
    ok('no sheet at all: the generic sentence and the paste table derived from the checks', N1.indexOf('The test plan was not read. Paste-ready rows:') >= 0 && N1.indexOf('paste 1') >= 0, N1);
  });
});

TE('Email Check report: problems (taModeProblems)', function () {
  function probs(rec) { var out = []; taModeProblems(ecEntry(rec), function (sev, where, detail) { out.push({ sev: sev, where: where, detail: detail }); }); return out; }
  function has(list, sev, where, text) { return list.some(function (p) { return p.sev === sev && p.where === where && (text === undefined || p.detail.indexOf(text) >= 0); }); }
  jeqE('a clean record raises nothing', probs(ecCleanRecord()), []);
  var p = probs(ecCleanRecord({ version: undefined }));
  ok('no version: an error asking for a reload', has(p, 'error', 'email-check', 'This record came from an older service worker: reload Selenite in chrome://extensions and run again.'), p);
  p = probs(ecCleanRecord({ error: 'Doc broke at https://docs.googleapis.com/v1/documents/abc?key=SECRET' }));
  ok('a run error is an error, scrubbed (no query)', has(p, 'error', 'email-check', 'Doc broke at https://docs.googleapis.com/v1/documents/abc') && JSON.stringify(p).indexOf('key=SECRET') < 0, p);
  ok('a stop is a note', has(probs(ecCleanRecord({ stopped: true })), 'info', 'email-check', 'Stopped by the tester: every check that had not run is Not tested.'));
  var mtMsg = { 'signed-out': 'Mailtrap: this Chrome is signed out. Sign in to the shared Mailtrap account in this Chrome, then run again.',
    'no-account': 'Mailtrap: the signed-in account does not own sandbox 7000001 (a personal account?). Sign out of Mailtrap, sign in to the shared account, then run again.',
    challenge: 'Mailtrap shows a browser check. Open mailtrap.io in this Chrome, let it finish, then run again.', error: 'Mailtrap could not be read: boom' };
  Object.keys(mtMsg).forEach(function (s) {
    var r = ecCleanRecord(); r.sources.mailtrap = { state: s, error: s === 'error' ? 'boom' : null };
    var q = probs(r);
    ok('Mailtrap ' + s + ': an error with the documented sentence', has(q, 'error', 'email-check/mailtrap', mtMsg[s]), q);
  });
  var rs = ecCleanRecord(); rs.sources.mailtrap = { state: 'stopped', error: null };
  ok('Mailtrap stopped: no Mailtrap error (the stop note covers it)', !probs(rs).some(function (x) { return x.where === 'email-check/mailtrap'; }));
  var rd = ecCleanRecord(); rd.sources.doc = { state: 'needs-connect', error: null };
  ok('doc needs-connect: a warning that says to connect again', has(probs(rd), 'warn', 'email-check/doc', 'Connect Google again: the Docs permission was added after you connected.'));
  rd.sources.doc = { state: 'error', error: 'HTTP 403 at https://docs.googleapis.com/v1/documents/abc?key=S' };
  var qd = probs(rd);
  ok('doc error: a warning with the scrubbed reason', has(qd, 'warn', 'email-check/doc', 'The copy doc could not be read: HTTP 403') && JSON.stringify(qd).indexOf('key=S') < 0, qd);
  ['no-link', 'not-a-doc-link', 'ok'].forEach(function (s) { var r = ecCleanRecord(); r.sources.doc = { state: s, error: null }; ok('doc ' + s + ' raises nothing (the rows say it)', probs(r).length === 0); });
  var rp = ecCleanRecord(); rp.proofs.push({ id: 'regular-donors-v1', segment: 'Regular Donors', variation: 'v1', sandboxId: '7000001', messageId: '7100000006', state: 'not-found', error: null, facts: null });
  rp.proofs.push({ id: 'major-donors-v0', segment: 'Major Donors', variation: 'v0', sandboxId: '7000001', messageId: '7100000007', state: 'error', error: 'HTTP 500', facts: null });
  var qp = probs(rp);
  ok('a proof not found: a warning naming the sandbox and the message', has(qp, 'warn', 'email-check/regular-donors-v1', 'Proof not found in sandbox 7000001 (message 7100000006).'), qp);
  ok('a proof that failed: a warning with its reason', has(qp, 'warn', 'email-check/major-donors-v0', 'The proof could not be read: HTTP 500'), qp);
  var re = ecCleanRecord(); re.sources.eoa[0].state = 'error'; re.sources.eoa[0].error = 'HTTP 404';
  ok('an unreadable EoA page: a warning', has(probs(re), 'warn', 'email-check/eoa v0', 'The Email on Acid page could not be read: HTTP 404'));
  var rc = ecCleanRecord(); rc.sources.eoa[0].renders = { state: 'capped', count: 16, error: null };
  ok('capped renders: a note', has(probs(rc), 'info', 'email-check/eoa v0', 'Renders were capped'));
  rc.sources.eoa[0].renders = { state: 'error', count: 0, error: 'canvas failed' };
  ok('failed renders: a note with the reason', has(probs(rc), 'info', 'email-check/eoa v0', 'Renders could not be captured: canvas failed'));
  ok('renders off or none raise nothing', (function () { var r = ecCleanRecord(); r.sources.eoa[0].renders = { state: 'off', count: 0, error: null }; var a = probs(r).length; r.sources.eoa[0].renders = { state: 'none', count: 0, error: null }; return a === 0 && probs(r).length === 0; })());
  var rl = ecCleanRecord(); rl.links.push({ proofId: 'regular-donors-v0', linkId: '8003', slug: 's', labels: [], role: 'cta', kind: 'pardot', guard: null, method: null, pardotStatus: null, dest: null, destStatus: null, destTitle: null, error: 'not resolved: cap' },
    { proofId: 'regular-donors-v0', linkId: '8004', slug: 's', labels: [], role: 'cta', kind: 'pardot', guard: null, method: null, pardotStatus: null, dest: null, destStatus: null, destTitle: null, error: null },
    { proofId: 'regular-donors-v0', linkId: '8005', slug: 's', labels: [], role: 'guarded', kind: 'pardot', guard: 'unsubscribe link', method: null, pardotStatus: null, dest: null, destStatus: null, destTitle: null, error: 'x' },
    { proofId: 'regular-donors-v0', linkId: null, slug: null, labels: [], role: 'social', kind: 'direct', guard: null, method: 'direct', pardotStatus: null, dest: null, destStatus: null, destTitle: null, error: 'y' });
  var ql = probs(rl);
  ok('unresolved links: one warning with the count and the first reason (guarded and direct links are not counted)', ql.length === 1 && has(ql, 'warn', 'email-check/links', '2 link(s) could not be resolved (not resolved: cap)'), ql);
  ok('an analysis failure is a warning', has(probs(ecCleanRecord({ explain: { ok: false, error: 'No API key configured' } })), 'warn', 'email-check/analysis', 'Analysis (Opus) failed: No API key configured'));
  ok('a test plan read failure is a warning', has(probs(ecCleanRecord({ sheet: { connected: false, error: 'HTTP 403', paste: [] } })), 'warn', 'email-check/sheet', 'Test plan not read: HTTP 403'));
  ok('a failed Apply is a warning', has(probs(ecCleanRecord({ sheet: ecSheetOK({ applied: { ok: false, error: 'boom' } }) })), 'warn', 'email-check/sheet', 'Writing to the test plan failed: boom'));
  ok('a good Apply raises nothing', probs(ecCleanRecord({ sheet: ecSheetOK({ applied: { ok: true } }) })).length === 0);
  ok('every recorded text in the problems is scrubbed (no inbox address, no prospect id)', ecLeaks(JSON.stringify(probs(ecCleanRecord({ error: 'x tester+regular@inbox.mailtrap.io /e/900001/slug/8001/2000000002/h/SynthHash0' }))), ['/h/SynthHash0']).length === 0);
  // the routing
  var vdSrc = _pu.slice(_pu.indexOf('function vdCollectProblems'), _pu.indexOf('function taModeProblems'));
  ok('vdCollectProblems routes the emailcheck entry to taModeProblems', vdSrc.indexOf("entry.mode === 'emailcheck'") !== -1);
  ok('and still routes the qapass and the numbered modes', vdSrc.indexOf("entry.mode === 'qapass'") !== -1 && /entry\.mode === 4 \|\| entry\.mode === 5 \|\| entry\.mode === 6/.test(vdSrc));
});

TE('Email Check report: the debug section and the builders (wiring)', function () {
  var rec = ecHandRecord({ ts: 1800000005000 });
  withGlobals({ ecDebugProjection: function (d) { return { marker: d.ticketKey, hasProjection: true }; } }, function () {
    var dbg = taDebugSection(ecEntry(rec));
    ok('the debug section is status, reason, completedAt and the projection', dbg.status === 'ran' && dbg.reason === null && dbg.completedAt === new Date(1800000005000).toISOString() && dbg.marker === 'EX-2' && dbg.hasProjection === true, dbg);
    jeqE('an entry that did not run keeps only its status and reason', taDebugSection({ mode: 'emailcheck', status: 'failed', reason: 'No active tab' }), { status: 'failed', reason: 'No active tab' });
    eq('no entry is null', taDebugSection(undefined), null);
  });
  var src = _pu;
  ok('buildDebugLog carries emailCheck: taDebugSection(modeEntry(\'emailcheck\')), after qaPass', /qaPass: taDebugSection\(modeEntry\('qapass'\)\),\s*emailCheck: taDebugSection\(modeEntry\('emailcheck'\)\),/.test(src));
  ok('the builders map names rptEmailCheckSection under the string key emailcheck', /qapass: rptQaPassSection,\s*emailcheck: rptEmailCheckSection,/.test(src));
  ok('the cover (abPageUrls) adds no page for Email Check', slicePopup('function abPageUrls(modes) {', '\n// Which configured metrics').indexOf('emailcheck') < 0);
  // through buildReportBody: the section appears among the others
  var rptAbSection = function () { return ''; }, rptWcagSection = function () { return ''; }, rptFunnelSection = function () { return ''; };
  eval(slicePopup('function buildReportBody(sections) {', '\n// ── Debug log'));
  var body = buildReportBody({ ts: 1800000005000, pageUrls: [], modes: [ecEntry(ecHandRecord())], extraHtml: '' });
  ok('buildReportBody builds the Email Check section for the emailcheck mode key', body.indexOf('<h2>' + EC_NAME + '</h2>') >= 0 && ecH3s(body).slice(0, 11).join('|') === EC_HEADINGS.join('|'), ecH3s(body));
  ok('a failed Email Check entry is the shared FAILED section, not this builder', buildReportBody({ ts: 1, pageUrls: [], modes: [{ mode: 'emailcheck', name: EC_NAME, status: 'failed', reason: 'No active tab' }], extraHtml: '' }).indexOf('No active tab') >= 0);
  ok('the cover lists no Email Check page', body.indexOf('No page URLs recorded.') >= 0);
  ok('the report carries none of the forbidden strings (scrub list of the synthetic data)', ecLeaks(body, ['/h/SynthHash0']).length === 0, ecLeaks(body, ['/h/SynthHash0']));
});

TE('Email Check report: records built from the synthetic fixtures (needs B2: ecTestRecord, ecDeriveChecks, projections)', function () {
  ok('ecTestRecord is available (tests/email-check-fixture-record.js)', EC_REC_LOADED);
  var clean = ecTestRecord(ecFx(), 'EX-2');
  var h = rptEmailCheckSection(ecEntry(clean));
  jeqE('clean EX-2: the eleven headings in order', ecH3s(h), EC_HEADINGS);
  ok('clean EX-2 (64 passed, 24 in progress, none failed): NEEDS REVIEW', h.indexOf('NEEDS REVIEW') >= 0 && h.indexOf('64 passed') >= 0, h.slice(0, 400));
  ok('  no sub-section failed to build', h.indexOf('could not be built') < 0);
  ok('  the four proofs and sixteen passed keys are listed', (ecParts(h).Passed.match(/<li>/g) || []).length === 16 && (ecParts(h).Proofs.match(/regular-donors-v0|major-donors-v0/g) || []).length >= 2, ecParts(h).Passed);
  ok('  none of the forbidden strings, and no raw "/h/" path', ecLeaks(h, ['/h/']).length === 0, ecLeaks(h, ['/h/']));
  var ex1 = ecTestRecord(ecFx(), 'EX-1');
  var h1 = rptEmailCheckSection(ecEntry(ex1));
  ok('EX-1 (altTags failed on both v1 proofs): ISSUES FOUND, 2 failed', h1.indexOf('ISSUES FOUND') >= 0 && h1.indexOf('2 failed') >= 0, h1.slice(0, 400));
  ok('  Failed names both v1 proofs', ecParts(h1).Failed.indexOf('altTags@') >= 0 && (ecParts(h1).Failed.match(/altTags@[a-z-]+-v1/g) || []).length === 2, ecParts(h1).Failed);
  var withR = ecTestRecord(ecFx(), 'EX-2', { renders: true });
  var hr = ecParts(rptEmailCheckSection(ecEntry(withR)))['Email on Acid'];
  ok('renders: every printed image is a validated data URL', (hr.match(/<img src="([^"]*)"/g) || []).length === 32 && (hr.match(/<img src="data:image\/jpeg;base64,[A-Za-z0-9+\/=]+"/g) || []).length === 32, (hr.match(/<img /g) || []).length);
  var sig = ecTestRecord(ecFx(), 'EX-2', { mailtrap: 'signed-out' });
  var hs = rptEmailCheckSection(ecEntry(sig));
  ok('Mailtrap signed out: Blocked lists 18 per proof, Needs a person the 4 that need no inbox', (ecParts(hs).Blocked.match(/<li>/g) || []).length === 72 && hs.indexOf('could not be built') < 0, (ecParts(hs).Blocked.match(/<li>/g) || []).length);
  var tok = ecTestRecord(ecFx(), 'EX-2', { mutateProofs: function (pf) { pf[0].text = (pf[0].text || '') + '\n{{{dynamic_content_101}}}'; } });
  var Pt = ecParts(rptEmailCheckSection(ecEntry(tok)));
  ok('a token in one proof: rawTokens and conditional are failed on that proof only', /rawTokens@regular-donors-v0/.test(Pt.Failed) && /conditional@regular-donors-v0/.test(Pt.Failed) && Pt.Failed.indexOf('regular-donors-v1') < 0, Pt.Failed);
  // the stored record must survive the report: nothing in the printed text can be a forbidden string even when the notes are re-scrubbed
  var dirty = ecTestRecord(ecFx(), 'EX-2'); dirty.checks[0].note = 'leak tester+regular@inbox.mailtrap.io /api/testing_message_parts/SYNTHETICTOKEN/x bounce-SYNTH@bounce.example.net';
  ok('a note carrying an inbox address, a message part and a bounce address is scrubbed on the way out', ecLeaks(rptEmailCheckSection(ecEntry(dirty))).length === 0, ecLeaks(rptEmailCheckSection(ecEntry(dirty))));
  // the debug section through the real projection
  var dbg = taDebugSection(ecEntry(withR));
  ok('the debug section: renders became hasImage, no image data, no forbidden string', JSON.stringify(dbg).indexOf('data:image') < 0 && JSON.stringify(dbg).indexOf('hasImage') >= 0 && ecLeaks(JSON.stringify(dbg)).length === 0, Object.keys(dbg));
  ok('the debug section keeps the status and the completion time', dbg.status === 'ran' && typeof dbg.completedAt === 'string');
  ok('a stale record (no version) gives the error problem through the real checks', (function () { var rec = ecTestRecord(ecFx(), 'EX-2'); delete rec.version; var out = []; taModeProblems(ecEntry(rec), function (a, b, c) { out.push(a + ':' + b); }); return out.indexOf('error:email-check') >= 0; })());
});

// ── report ─────────────────────────────────────────────────────────────────
print('\n' + (fail ? 'FAILURES:\n  - ' + failures.join('\n  - ') + '\n' : '') +
      '=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
