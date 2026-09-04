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
eval(slicePopup('function abPageUrls(modes) {', '\n// Which configured metrics'));
eval(slicePopup('function rptAbVisualDiffSection(vd) {', '\nfunction rptWcagSection('));
eval(slicePopup('function abFiredMetricRows(metricRows) {', '\nfunction rptAbSection('));
var abState = { qaMode: false };

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
  ok('all requirements met and nothing unexpected badges PASS', /PASS/.test(clean), clean.slice(0, 300));
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
  ok('a fragment alone does NOT badge', /PASS/.test(fragmentRun), fragmentRun.slice(0, 300));
})();

(function noRequirementsIsSilent() {
  // No spec, or a spec with no quoted copy, must not render an empty coverage
  // line — and must leave the badge exactly as it was.
  var none = render([rollup('section', 'expected')]);
  ok('no requirements renders no coverage line', !/Specified copy:/.test(none));
  var empty = withReq({ total: 0, verbatim: 0, near: 0, absent: 0, items: [] });
  ok('a zero-total requirement set renders no coverage line', !/Specified copy:/.test(empty));
  ok('  and still badges PASS', /PASS/.test(empty), empty.slice(0, 300));
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
  eq('  and it is the clean post-redirect URL', got[0], clean);

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
  eq('a skipped one did not run', vdVerdict({ skipped: true, perVariant: [] }).ran, false);
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

  // A genuinely skipped run with nothing to account for still returns none.
  eq('a skipped run with an empty perVariant did not run',
     vdVerdict({ skipped: true, perVariant: [] }).ran, false);
  eq('a skipped run with no duplicates did not run',
     vdVerdict({ skipped: true, perVariant: [{ label: 'v1', skipped: true }] }).ran, false);
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
        noVerdictCount: 0, unmetCopyCount: 0 }, over)] }).allClean;
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
  // THE REGRESSION: real issues must outrank a partial grading gap.
  eq('real issues outrank a grading gap', at({ issues: 4, ungraded: 1, allClean: false }), 'ISSUES FOUND');
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

  // And the mirror must carry the fields the verdict now depends on.
  var proj = _pu.slice(_pu.indexOf('perVariant: (visualDiffResult.perVariant || []).map'),
                       _pu.indexOf('findingCount: v.findings'));
  var full = _pu.slice(_pu.indexOf('perVariant: (visualDiffResult.perVariant || []).map'));
  ok('the mirror carries gradingFailed', /gradingFailed: v\.gradingFailed/.test(full.slice(0, 2200)), 'missing');
  ok('  and a precomputed unmetCopyCount', /unmetCopyCount: vdUnmetRequirements\(v\)/.test(full.slice(0, 2200)), 'missing');
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

// ── report ─────────────────────────────────────────────────────────────────
print('\n' + (fail ? 'FAILURES:\n  - ' + failures.join('\n  - ') + '\n' : '') +
      '=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
