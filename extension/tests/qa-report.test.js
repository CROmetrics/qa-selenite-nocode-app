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
  eq('both call sites are present', calls.length, 2);
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

// ── report ─────────────────────────────────────────────────────────────────
print('\n' + (fail ? 'FAILURES:\n  - ' + failures.join('\n  - ') + '\n' : '') +
      '=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
