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
eval(slicePopup('function rptAbVisualDiffSection(vd) {', '\nfunction rptWcagSection('));
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
// Findings are <tr> in a four-column table now, not <div class="ab-line">.
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
// Just the short description, without the type chip that shares the cell.
function shortText(cell) {
  var after = String(cell).split('<br>');
  return (after.length > 1 ? after.slice(1).join('<br>') : after[0]).replace(/<[^>]*>/g, '').trim();
}

(function theFourColumns() {
  var f = rollup('section', 'unexpected');
  f.shortDescription = 'Hero headline replaced and a business-owner photo added';
  f.note = 'The hero was rebuilt per the ticket. Confirm the photo is the approved asset.';
  var h = render([f]);
  eq('exactly four columns, in the requested order',
     headers(h).join(' | '),
     'Short Description | Image Ref | Verdict | Detailed Description');
  var c = cellsOf(h);
  eq('four cells per finding', c.length, 4);
  ok('col 1 carries the short description',
     /Hero headline replaced/.test(c[0]), c[0]);
  ok('col 1 also carries the change type', /class="ab-delta"/.test(c[0]));
  ok('col 3 carries the verdict chip', /unexpected/.test(c[2]), c[2]);
  ok('col 4 carries the detailed description',
     /Confirm the photo is the approved asset/.test(c[3]), c[3]);
  ok('  and the deterministic facts under it', /Region:/.test(c[3]), c[3]);
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
  ok('the verdict cell says unjudged rather than nothing',
     /unjudged/.test(c[2]), c[2]);
})();

(function imageRefColumnAndTheFullWidthPair() {
  // The pre-table format's crops were ~250px side by side and LEGIBLE — its
  // form before/after visibly showed Email Address moving down the field order.
  // A quarter-width column capped at 120px cannot carry that, so the pair gets
  // its own full-width row.
  var f = rollup('section', 'expected');
  f.baselineCrop = 'data:image/png;base64,AAA';
  f.variantCrop = 'data:image/png;base64,BBB';
  var h = render([f]);
  var c = cellsOf(h);
  // NO thumbnail. It was the same picture as the pair below it, shrunk to 64px
  // — measured across run 1788362945211, 90% of crops render under 120px tall
  // (median 27px), so the thumbnail was a smaller, often illegible duplicate.
  ok('Image Ref carries NO thumbnail', !/base64/.test(c[1]), c[1]);
  ok('  only the coordinates, as a locator', /695, 187/.test(c[1]), c[1]);
  eq('  so each crop appears exactly once in the report',
     (h.match(/base64,AAA/g) || []).length, 1);
  eq('  on both sides', (h.match(/base64,BBB/g) || []).length, 1);

  // Row two: the pair, full width, side by side.
  // Anchored on padding-top, not just colspan — the GROUP HEADING row is also
  // a colspan=4 and matches first, which is how this assertion first failed.
  var pair = /<tr><td colspan="4" style="padding-top:0">[\s\S]*?<\/tr>/.exec(h);
  ok('a full-width second row carries both crops',
     !!pair && /base64,AAA/.test(pair[0]) && /base64,BBB/.test(pair[0]), pair && pair[0].slice(0, 120));
  ok('  labelled Control and Variant', !!pair && /Control/.test(pair[0]) && /Variant/.test(pair[0]));
  ok('  side by side', !!pair && /display:flex/.test(pair[0]));
  // Height IS capped, generously. Uncapped, the section rollup's 1296x3105
  // crop rendered 659px tall at a 275px column and page-break-inside on the
  // tbody stranded the rest of the page — three pages of run 1788362945211
  // were 30-65% blank for exactly this.
  ok('  height-capped so one tall crop cannot eat a page',
     !!pair && /max-height:320px/.test(pair[0]), pair && pair[0].slice(0, 300));
  ok('  but far above the 120px the column had, so it stays legible',
     !!pair && !/max-height:(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-9])px/.test(pair[0]));
  ok('  and min-width:0, or a wide crop would refuse to shrink to its half',
     !!pair && /min-width:0/.test(pair[0]));

  // No crops: one row only, and the cell still anchors the finding.
  var g = rollup('footer', 'expected', { controlRect: { x: 695, y: 3912, w: 1296, h: 614 } });
  var gh = render([g]);
  ok('with no crop it falls back to coordinates', /695, 3912/.test(cellsOf(gh)[1]), cellsOf(gh)[1]);
  ok('  and says so', /No crop/.test(cellsOf(gh)[1]));
  ok('  and emits no second row', !/<tr><td colspan="4"[^>]*style="padding-top:0"/.test(gh));
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
  ok('  with the same four headers', /Short Description[\s\S]*?Image Ref[\s\S]*?Verdict[\s\S]*?Detailed Description/
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
  ok('  containing both of its rows', (tb[0].match(/<tr>/g) || []).length === 2, tb[0].slice(0, 80));
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
     /<td colspan="4"/.test(h), h.slice(0, 400));
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

// ── report ─────────────────────────────────────────────────────────────────
print('\n' + (fail ? 'FAILURES:\n  - ' + failures.join('\n  - ') + '\n' : '') +
      '=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
