// Real-run regression suite — the verdict and badge code driven by the SHAPES
// PRODUCTION ACTUALLY PRODUCED, not by fixtures written alongside the fix.
//
// Why this file exists. Two regressions shipped in one day and BOTH passed their
// own tests:
//   - the f529775 badge ladder checked `ungraded` before `issues`, and the
//     assertion pinned only "above PASS", so the inversion passed;
//   - the f529775 Test-Agent fallback handed the metadata mirror to a renderer
//     that had never seen one, and no fixture had ever been a mirror.
// In both cases the fixture encoded the same assumption as the bug, so the test
// agreed with the bug. Hand-authored fixtures cannot catch that class.
//
// fixtures-real-runs.json is a reduced projection of every debug log on record —
// only the fields the verdict reads. Invariants below are derived FROM the log
// (count the classifications, count the unmet requirements) rather than from an
// expected value someone typed, so they stay true as the data changes.
//
// When a run surfaces a new shape, add its log to the fixture. That is the point.

// vdReorderContradiction and the thresholds come from the real sources, sliced
// the same way every other suite does it.
load('../vd-config.js');
load('../vd-diff.js');

function readFile(p) { return read(p); }
var _pu = readFile('../popup.js');
function slicePopup(from, to) {
  var a = _pu.indexOf(from), b = _pu.indexOf(to, a + 1);
  if (a === -1 || b === -1) throw new Error('slice marker missing: ' + from);
  return _pu.slice(a, b);
}
eval(slicePopup('function vdUnmetRequirements(v) {', '\n// The pages this run actually tested'));
// Capture parity. Sliced separately because it sits above that block, next
// to vdScaleMismatch — its sibling on the other capture-parity axis.
eval(slicePopup('function vdCaptureWidthMismatch(captures, tolPx) {',
                'function vdScaleMismatch(sc) {'));
// The cover line that reports the same quantity to the reader. Sliced here too
// so it is driven by the same real capture sets the parity guard is.
eval(slicePopup('function abCaptureWidths(modes) {', '\nfunction abPageUrls(modes) {'));

var RUNS = JSON.parse(readFile('fixtures-real-runs.json'));

// The Funnel Crawl walk each run recorded, and the worker helpers that produced
// it. This suite reads popup.js everywhere else; the crawl lives in
// background.js, so it is sliced the same way vd-diff.test.js slices it.
var FUNNEL = JSON.parse(readFile('fixtures-real-funnel.json'));
var _bg = readFile('../background.js');
eval(_bg.slice(_bg.indexOf('const FN_MAX_IMAGE_EDGE'),
                _bg.indexOf('// Returns { dataUrl, width, height')));
eval(_bg.slice(_bg.indexOf('const FN_STUCK_NUDGE'),
                _bg.indexOf('// Injected, so fully self-contained')));

// Kept in its own file on purpose. fixtures-real-runs.json is a verdict
// projection whose invariants are derived by counting classifications; bolting
// geometry onto it muddles a file with one clear job. This one carries the
// shiftClusters each run recorded, verbatim.
//
// It exists because you CANNOT re-run vdSuppressFindings from a debug log — the
// log carries no candidate lists, only capped 40-item samples. So the only way
// to check the reordering rule against real pages is to feed the recorded
// clusters back through the predicate, which is what this does.
var CLUSTERS = JSON.parse(readFile('fixtures-real-clusters.json'));
// Capture geometry per run — the only fixture that can exercise capture PARITY,
// which is a property of the capture set and invisible in the verdict projection.
var CAPTURES = JSON.parse(readFile('fixtures-real-captures.json'));
// The spec PROVENANCE of every run on record that carries a designReference —
// no spec text, only the five fields the suppression decision reads. Keyed by
// FILENAME STEM, not run id: two logs on record share run id 1787851821352
// (one is a "(1)" copy), and keying by id silently drops one and moves the
// census by one.
var SPECS = JSON.parse(readFile('fixtures-real-specs.json'));
eval(slicePopup('function vdSpecTicketMismatch(source, specKey, activeKey, hasText) {',
                '\nasync function runVisualDiffPipeline'));
eval(slicePopup('function buildDesignReferenceDebug(ctx, state, hasFigmaPat) {', '\nfunction '));

var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++; failures.push(name + (detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 240) : ''));
}
function eq(name, a, b) { ok(name, a === b, { actual: a, expected: b }); }
function section(t) { print('\n' + t); }

// What the log itself says, counted rather than asserted from memory.
function fromLog(run) {
  var o = { findings: 0, unexpected: 0, unclear: 0, ungraded: 0, unmet: 0, errored: 0, skipped: 0, dup: 0, deadGrade: 0, notServed: 0 };
  (run.perVariant || []).forEach(function (v) {
    if (v.error) { o.errored++; return; }
    if (v.skipped) { o.skipped++; return; }
    if (v.controlDuplicate) o.dup++;
    // The platform said this page bucketed into NO variation, so whatever the
    // diff found is not evidence about the experiment. Counted as "something
    // wrong" for the same reason controlDuplicate is: the comparison did not
    // happen, whatever the findings say.
    if (v.notServed) o.notServed++;
    if (v.gradingFailed) o.deadGrade++;
    var fs = v.findings || [];
    o.findings += fs.length;
    fs.forEach(function (f) {
      if (f.classification === 'unexpected') o.unexpected++;
      else if (f.classification === 'unclear') o.unclear++;
      else if (!f.classification) o.ungraded++;
    });
    var rq = v.requirements;
    if (rq && rq.items) {
      o.unmet += (rq.absent || 0)
        + rq.items.filter(function (i) { return i.status === 'near' && !i.fragment; }).length;
    }
  });
  // Shared findings are graded exactly like per-variant ones and must be
  // counted the same way. Five runs in the corpus carry a shared pool, but only
  // ONE of them can tell whether this counts it: 1787686041687 and its three
  // siblings (3 variants each) have every per-variant finding unclear as well,
  // so vdVariantClean is already false there and the shared terms are redundant.
  // 1788538681655 is the only recorded run whose variants are individually clean
  // while its shared pool is not -- both carry zero findings of their own and
  // all 8 sit in the pool, 2 unclear -- so it is the only run that catches a
  // miscount here. Measured: reverting the shared terms fails exactly one
  // assertion across all 19 runs, that one.
  (run.sharedFindings || []).forEach(function (f) {
    o.findings++;
    if (f.classification === 'unexpected') o.unexpected++;
    else if (f.classification === 'unclear') o.unclear++;
    else if (!f.classification) o.ungraded++;
  });
  return o;
}

var ids = Object.keys(RUNS).sort();

section('every recorded run: the verdict must match its own log (' + ids.length + ' runs)');
ids.forEach(function (rid) {
  var run = RUNS[rid], v = vdVerdict(run), L = fromLog(run);
  eq(rid + ' findings match the log', v.findings, L.findings);
  eq(rid + '   needsReview == unexpected + unclear', v.needsReview, L.unexpected + L.unclear);
  eq(rid + '   unmetCopy == absent + non-fragment near', v.unmetCopy, L.unmet);
  eq(rid + '   failed == errored variants', v.failed, L.errored);
  eq(rid + '   notRun == skipped variants', v.notRun, L.skipped);
  eq(rid + '   notCompared == control duplicates', v.notCompared, L.dup);
});

section('PASS must be EARNED on every recorded run');
ids.forEach(function (rid) {
  var run = RUNS[rid], v = vdVerdict(run), L = fromLog(run);
  var label = vdBadgeLabel(v, {});
  var nothingWrong = L.unexpected === 0 && L.unclear === 0 && L.ungraded === 0
    && L.unmet === 0 && L.errored === 0 && L.skipped === 0 && L.dup === 0 && L.deadGrade === 0
    && L.notServed === 0;
  ok(rid + ' badges PASS only when the log shows nothing wrong',
     label !== 'PASS' || nothingWrong, { badge: label, log: L });
  // And the converse: a clean log must not be scared into a non-PASS.
  ok(rid + '   a wholly clean log is not badged as a problem',
     !nothingWrong || label === 'PASS', { badge: label, log: L });
  // A log carrying an error-severity problem must never read PASS.
  ok(rid + '   a run with an error-severity problem is never PASS',
     !(run.errorProblems || []).length || label !== 'PASS',
     { badge: label, errors: run.errorProblems });
  // allClean itself, not just the badge it feeds. The badge assertions above
  // stayed green through the whole life of the allClean-ignores-sharedFindings
  // bug, because the ladder checks `issues` first and ISSUES FOUND is the right
  // badge either way -- so the disagreement was invisible from the outside.
  // This is the assertion that catches it, from real data on the real 2-variant
  // shape: over these runs it is 0 mismatches with the fix and 1 without it.
  eq(rid + '   allClean agrees with the log', v.allClean, nothingWrong);
});

section('the real runs that used to be badged wrong');
// 1788193353815 carried error:"Failed to fetch" on the variant. Every counter
// correctly returned 0 for an errored variant and notCompared only counted
// control duplicates, so the ladder fell through to PASS.
var dead = RUNS['1788193353815'];
ok('the errored run is on record', !!dead);
if (dead) {
  eq('  it is reported as failed', vdVerdict(dead).failed, 1);
  eq('  and badges FAILED, not PASS', vdBadgeLabel(vdVerdict(dead), {}), 'FAILED');
}
// 1788372126965 had one finding the model omitted alongside 4 unmet copy strings
// and 5 review items. f529775 badged it NOT GRADED and buried all nine.
var partial = RUNS['1788372126965'];
ok('the partially-graded run is on record', !!partial);
if (partial) {
  var pv = vdVerdict(partial);
  eq('  the omitted finding is still counted', pv.ungraded, 1);
  eq('  the copy misses are still counted', pv.unmetCopy, 4);
  eq('  and the badge names the issues', vdBadgeLabel(pv, {}), 'ISSUES FOUND');
  ok('  with the gap still stated in the summary', /1 ungraded/.test(vdVerdictSummary(pv)));
}
// 1788360614883 lost its whole grading pass.
var nograde = RUNS['1788360614883'];
if (nograde) {
  var nv = vdVerdict(nograde);
  eq('a run that lost its grading reports every finding ungraded', nv.ungraded, 67);
  ok('  and does not badge PASS', vdBadgeLabel(nv, {}) !== 'PASS');
}

section('the summary line cannot contradict the verdict');
ids.forEach(function (rid) {
  var v = vdVerdict(RUNS[rid]), sm = vdVerdictSummary(v) || '';
  ok(rid + ' states its finding count', v.findings === 0 || sm.indexOf(String(v.findings)) !== -1, sm);
  ok(rid + '   omits copy when there are none', v.unmetCopy !== 0 || sm.indexOf('copy string') === -1, sm);
  ok(rid + '   omits review when there are none', v.needsReview !== 0 || sm.indexOf('needing review') === -1, sm);
  ok(rid + '   omits ungraded when there are none', v.ungraded !== 0 || sm.indexOf('ungraded') === -1, sm);
});

section('the copy check\'s real-world verdicts are pinned');

// A guard for a change I have NOT made yet. The copy check calls indexOf on a
// case-folded, punctuation-stripped string, so "$29/mo" matches "€29/mo",
// "Free shipping" matches "No free shipping on orders under $50", and "$99"
// matches inside "1996". Fixing that needs word boundaries — NOT a length
// floor: real requirements here normalise to "25b" (3 chars, from
// "$25 Billion+") and "185k" (4 chars) and are legitimately verbatim, so a
// floor would flip genuine finds to absent and inflate unmetCopy.
//
// So this pins what the matcher concludes on every recorded run. When the
// boundary fix lands, whatever moves here must be justified against real data
// rather than against a fixture written alongside it.
(function requirementVerdictsAcrossEveryRecordedRun() {
  var seen = 0, byStatus = {};
  ids.forEach(function (rid) {
    (RUNS[rid].perVariant || []).forEach(function (v) {
      var rq = v.requirements;
      if (!rq || !rq.items) return;
      seen++;
      // The three published totals must equal the item statuses that produced them.
      var counts = { verbatim: 0, near: 0, absent: 0 };
      rq.items.forEach(function (i) {
        counts[i.status] = (counts[i.status] || 0) + 1;
        byStatus[i.status] = (byStatus[i.status] || 0) + 1;
      });
      eq(rid + ' verbatim total matches its items', counts.verbatim, rq.verbatim);
      eq(rid + '   near total matches its items', counts.near, rq.near);
      eq(rid + '   absent total matches its items', counts.absent, rq.absent);
      eq(rid + '   and the three sum to total',
         counts.verbatim + counts.near + counts.absent, rq.total);
      // unmetCopy is absent + non-fragment near, and nothing else.
      var nonFragNear = rq.items.filter(function (i) { return i.status === 'near' && !i.fragment; }).length;
      eq(rid + '   unmetCopy is absent + non-fragment near',
         vdUnmetRequirements(v), (rq.absent || 0) + nonFragNear);
    });
  });
  ok('at least one recorded run carries a requirement set', seen > 0);
  // The distribution itself, so a matcher change cannot quietly shift it.
  print('    recorded item statuses: ' + JSON.stringify(byStatus));
  ok('every recorded item has one of the three known statuses',
     Object.keys(byStatus).sort().join(',') === 'absent,near,verbatim',
     Object.keys(byStatus).sort().join(','));
})();

section('the reordering rule, checked against every recorded run');

(function theReorderingRuleOnEveryRecordedClusterSet() {
  // This section used to assert the rule contradicts NOTHING on every recorded
  // cluster set, and printed "no recorded run can fire the rule". Both were
  // false, and the falsehood was load-bearing: VD_REORDER_DETECTION has been
  // held off waiting for a multi-cluster log that was already on disk. The
  // corpus only held 13 SINGLE-variant runs, all with one vertical cluster;
  // four 3-variant runs were never projected into it. Twelve of the 27 entries
  // now here carry >= 2 trusted vertical clusters.
  var ids = Object.keys(CLUSTERS).sort();
  ok('there are recorded cluster sets to check', ids.length > 0);

  var multi = 0, annotated = 0, vertSeen = 0, fired = 0, census = {};
  ids.forEach(function (rid) {
    var run = CLUSTERS[rid];
    var sc = run.shiftClusters || {};
    var vert = sc.vertical || [], horz = sc.horizontal || [];
    vertSeen += vert.length;
    var trustedVert = vert.filter(function (c) { return c.trusted; }).length;
    if (trustedVert >= 2) multi++;

    // Feed the recorded geometry back through the LIVE predicate. This works on
    // logs from before the rule shipped, because cluster geometry is cluster
    // geometry.
    var copy = JSON.parse(JSON.stringify(vert));
    copy.forEach(function (c) { delete c.contradictedBy; });
    vdReorderContradiction(copy, VD_SHIFT_TOL_PX, VD_MOVE_MIN_PX);
    var hits = copy.filter(function (c) { return c.trusted && c.contradictedBy; });
    if (hits.length) fired++;
    census[rid] = hits.map(function (c) {
      return c.delta + 'x' + c.count + '<-' + c.contradictedBy.delta + 'x' + c.contradictedBy.count;
    }).join(',');

    // A cluster with fewer than 2 trusted peers can never be contradicted --
    // that is the structural floor the old assertion was really testing, and it
    // still holds. Kept as its own claim so the two are not conflated again.
    if (trustedVert < 2) {
      copy.forEach(function (c, i) {
        eq(rid + ' a lone trusted cluster is never contradicted [' + i + ']',
           c.contradictedBy || null, null);
      });
    }
    // An UNTRUSTED cluster is never reported whatever the geometry says.
    copy.forEach(function (c, i) {
      if (!c.trusted) {
        ok(rid + ' an untrusted cluster is not reported [' + i + ']',
           !(c.trusted && c.contradictedBy), c);
      }
    });

    if (!run.annotated) return;
    annotated++;
    vert.forEach(function (c) {
      ok(rid + '   vertical cluster carries contradictedBy', 'contradictedBy' in c, c);
    });
    // AXIS SCOPING, proven from production rather than asserted: the rule is
    // vertical-only, so horizontal clusters must carry no annotation at all.
    horz.forEach(function (c) {
      ok(rid + '   horizontal cluster is NOT annotated', !('contradictedBy' in c), c);
    });
  });

  // CHARACTERISATION, not a correctness claim. These are the conclusions the
  // four terms reach on real geometry; pinning them means any change to the rule
  // shows up here as a visible diff that has to be justified against a page
  // rather than against this file. Two earlier versions of this rule were killed
  // by measurement, so a silent change of conclusions is the thing to prevent.
  //
  // The pattern across all four runs is the same and is what the rule was for:
  // a 16-element block at +50 against a ~496-element page reflow at -47, so the
  // block is reported and the reflow stays suppressed. In each run's v3 the big
  // cluster is +4 -- the SAME direction as the block -- and nothing is
  // contradicted. The answer flips with the sign, which is the intended
  // semantics and could not be observed until these runs were in the corpus.
  // Measured, by reverting each of the four terms in vdReorderContradiction and
  // running both suites (mutation -> vd-diff synthetic / real-runs production):
  //
  //   term 1  opposite directions      1 fail  /  0
  //   term 2  D must have MOVED        4 fail  /  4 fail
  //   term 3  destination crossing     2 fail  /  0
  //   term 4  o.count >= c.count       2 fail  /  8 fail
  //
  // TWO of the four terms are now pinned by production, not one. When the rule
  // shipped I had to amend its commit to admit term 2 could not be shown to
  // bite: every log on record had ONE vertical cluster, so the inner loop never
  // executed. These four runs execute it.
  //
  //   term 2 -- removing it contradicts the +100x16 block in every v3 with the
  //     +4x~496 page cluster, which has not MOVED at all (|4| <= moveMinPx). A
  //     cluster that sits still cannot be evidence that something swapped past
  //     it, and v3 is where the corpus says so.
  //
  //   term 4 -- removing it makes the two clusters contradict EACH OTHER
  //     ('-47x496<-50x16,50x16<--47x496'), so the ~496-element page reflow is
  //     reported alongside the 16-element block. That is precisely the
  //     inversion 4b4e236 recorded as the worst measured failure of an earlier
  //     draft -- 40 findings where 3 were right -- and it now reproduces on
  //     real geometry rather than on a synthetic shape. This term is pinned
  //     HARDER by production (8) than by the synthetic suite (2).
  //
  // Terms 1 and 3 remain synthetic-only, which is worth knowing rather than
  // glossing: no recorded page yet has same-direction bands large enough to
  // need term 1, or a non-crossing destination to need term 3.
  var EXPECTED = {
    '1787686041687#v1': '50x16<--47x496', '1787686041687#v2': '50x16<--47x496', '1787686041687#v3': '',
    '1787687832083#v1': '50x16<--47x496', '1787687832083#v2': '50x16<--47x497', '1787687832083#v3': '',
    '1787688438071#v1': '50x16<--47x496', '1787688438071#v2': '50x16<--47x497', '1787688438071#v3': '',
    '1787689543404#v1': '50x16<--47x527', '1787689543404#v2': '50x16<--47x527', '1787689543404#v3': '',
  };
  Object.keys(EXPECTED).forEach(function (rid) {
    ok(rid + ' is in the cluster corpus', rid in census, Object.keys(census).slice(0, 3));
    eq(rid + '   the rule reaches the recorded conclusion', census[rid], EXPECTED[rid]);
  });
  ids.forEach(function (rid) {
    if (rid in EXPECTED) return;
    eq(rid + ' contradicts nothing', census[rid], '');
  });

  print('    ' + vertSeen + ' vertical clusters across ' + ids.length + ' cluster sets; '
        + annotated + ' carry the annotation; ' + multi + ' have >= 2 trusted vertical clusters; '
        + fired + ' would fire the rule');
  ok('at least one set was produced by a build carrying the rule', annotated > 0,
     'no annotated run yet — reload the extension and re-run');
  if (fired) {
    print('    NOTE: ' + fired + ' cluster set(s) would report a cluster instead of'
          + ' suppressing it.');
    print('          VD_REORDER_DETECTION is ' + VD_REORDER_DETECTION
          + (VD_REORDER_DETECTION ? ', so these are LIVE.' : ', so this is annotation only.'));
  }
})();

section('fixture entries that the shipped code can no longer reproduce');
(function staleRequirementProjection() {
  // The corpus header promises these are shapes PRODUCTION ACTUALLY PRODUCED,
  // never values written alongside a fix. One entry now breaks that promise and
  // it is better named than quietly trusted.
  //
  // Run 1788538681655 recorded requirements {total: 0} for both variants because
  // the extractor could not read the spec's curly-single-quoted requirement at
  // all. That is exactly the defect the two-pass vdSpecRequirements fixed, so
  // the shipped extractor cannot produce total: 0 for that spec any more -- it
  // yields one requirement, "See All".
  //
  // What the entry SHOULD say is not derivable from the artifact: the log keeps
  // only capped unmatched samples, not the candidate list, so whether "See All"
  // grades verbatim or absent cannot be recomputed. All three of that run's
  // error-severity problems say the page never bucketed into the variation it
  // was asked for, which makes `absent` the likely truth -- but likely is not
  // recorded, and guessing it here is precisely the thing this file exists to
  // prevent. It needs a re-run of TB-1078, not a reasoned-out number.
  var stale = RUNS['1788538681655'];
  ok('the affected run is on record', !!stale);
  if (!stale) return;
  var totals = (stale.perVariant || []).map(function (v) {
    return v.requirements ? v.requirements.total : null;
  });
  // Pinned so that re-capturing the run FAILS here and forces this note to be
  // revisited, rather than leaving a stale zero to be read as a real result.
  eq('  its requirement totals are still the pre-fix zeros',
     JSON.stringify(totals), '[0,0]');
  print('    NOTE: 1788538681655.requirements is a PRE-FIX projection — the shipped');
  print('          extractor yields 1 requirement for that spec, not 0. Re-run TB-1078');
  print('          to replace it; do not hand-edit a number in.');
})();

(function staleCrossVariantRequirementProjection() {
  // The SECOND entry of this class, and the one that matters more, because the
  // run carrying it is the corpus's only capture set from a fifth site.
  //
  // Run 1789419453332 (UUSAF-250, unicefusa.org) recorded 17 requirements for
  // v2 and graded 10 of them absent. Ten is not a copy result. Six of the
  // seventeen are HTML lifted out of a pasted form embed -- '<a href="',
  // 'style="', 'display: none', '#XSCEEUTK', '></a>', 'input with' -- and most
  // of the rest are v1's copy, because ONE flat requirement list was graded
  // against every variant. Both defects are fixed above this commit (b177615
  // stopped treating a pasted embed as copy the page must carry, fcd7104 grades
  // a variant against what the ticket says about THAT variant), so the shipped
  // extractor can no longer produce 17 for this spec.
  //
  // Unlike 1788538681655 the truth here IS derivable, and was measured rather
  // than reasoned: driving HEAD's vdSpecRequirements over the spec bytes the
  // log itself carries yields TWO requirements for v2 -- 'SAVE THE LIFE OF A
  // CHILD TODAY' and 'Your gift delivers lifesaving nutrition...' -- and the
  // log records BOTH of them verbatim. So this run's real copy result is 0 of
  // 2, not 10 of 17, and the 10 unmetCopy the entry feeds into the verdict is
  // an artifact of the build that captured it.
  //
  // The entry is kept anyway, because every OTHER field on the run is real and
  // is the only fifth-site data on record: the skipped variant (the corpus's
  // first), the served-variation check, the findings and the badge.
  var bleed = RUNS['1789419453332'];
  ok('the fifth-site run is on record', !!bleed);
  if (!bleed) return;
  var cmp = (bleed.perVariant || []).filter(function (v) { return !v.skipped; })[0];
  ok('  its compared variant carries a requirement set', !!(cmp && cmp.requirements));
  if (!cmp || !cmp.requirements) return;
  // Pinned so a re-capture of UUSAF-250 FAILS here and forces this note to be
  // revisited, rather than leaving a 10-copy-miss verdict to be read as real.
  eq('  it still carries the pre-fix cross-variant totals',
     JSON.stringify([cmp.requirements.total, cmp.requirements.absent]), '[17,10]');
  print('    NOTE: 1789419453332.requirements is a PRE-FIX projection — HEAD scopes the');
  print('          list per variant and drops the pasted form embed, leaving v2 TWO');
  print('          requirements, both recorded verbatim. Its real copy result is 0 of 2,');
  print('          not 10 of 17. Re-run UUSAF-250 to replace it; do not hand-edit it.');
})();

section('runs where the page served no variation');
(function variantsThatServedNoVariation() {
  // Two runs on record have every capture `contradicted` -- the platform's own
  // answer that the page bucketed into NO variation, so all three URLs served
  // the same experience. Both are TB-1078.
  //
  // Before notServed existed, 1788900763308 badged ISSUES FOUND and told the
  // client "10 visual differences · 2 specified copy strings not on the page ·
  // 8 findings needing review", with 7 findings graded `unexpected`. Every one
  // of them was a randomized product-recommendations carousel serving different
  // products between the two loads. The three error-severity problems in that
  // same log already said "no verdict from it applies to the experiment"; the
  // verdict was simply blind to them, because the verification lived on the
  // capture and vdVerdict only ever sees visualDiff.
  var hits = ids.filter(function (rid) {
    return (RUNS[rid].perVariant || []).some(function (v) { return v.notServed; });
  });
  eq('exactly two recorded runs served no variation', hits.length, 2);
  eq('  and they are the two TB-1078 runs',
     hits.join(','), '1788538681655,1788900763308');
  hits.forEach(function (rid) {
    var v = vdVerdict(RUNS[rid]);
    eq(rid + ' counts both variants as not served', v.notServed, 2);
    eq(rid + '   is not clean', v.allClean, false);
    eq(rid + '   badges NOT COMPARED, not ISSUES FOUND', vdBadgeLabel(v, {}), 'NOT COMPARED');
    ok(rid + '   and says so before any count',
       /^\d+ variant\(s\) served no variation at all/.test(vdVerdictSummary(v)), vdVerdictSummary(v));
  });
  // Absent evidence is not evidence of absence: 96 captures on record predate
  // the verification field and 4 recorded 'unknown'. Neither may set notServed,
  // or most of the corpus would be declared uncompared.
  var falsePositives = ids.filter(function (rid) {
    return hits.indexOf(rid) === -1
        && (RUNS[rid].perVariant || []).some(function (v) { return v.notServed; });
  });
  eq('no run without a contradicted capture is marked not-served', falsePositives.length, 0);
  print('    ' + hits.length + ' of ' + ids.length + ' recorded runs served no variation');
})();

section('capture width parity across every recorded run');
(function captureParityOnRealRuns() {
  // The guard is only worth anything if it fires on the real failure and stays
  // silent on every real success. Both halves are asserted here from the
  // recorded capture geometry, because a predicate validated on synthetic
  // fixtures alone is how this project has shipped green bugs before.
  if (typeof vdCaptureWidthMismatch !== 'function') {
    ok('vdCaptureWidthMismatch is available to this suite', false); return;
  }
  var ids = Object.keys(CAPTURES).sort();
  ok('there are recorded capture sets', ids.length > 20, ids.length);
  var fired = [], subFloorQuiet = 0;
  ids.forEach(function (rid) {
    var run = CAPTURES[rid];
    var m = vdCaptureWidthMismatch(run.captures);
    if (m) {
      fired.push(rid + ':' + m.field + ':' + m.base.fullPage[m.field]
                 + '->' + m.offenders.map(function (c) { return c.fullPage[m.field]; }).join(','));
    } else if (run.worstMatchedFraction != null && run.worstMatchedFraction < 0.5) {
      subFloorQuiet++;
    }
  });
  // Exactly one run on record was captured at two widths: Control 1693px and
  // all three variants 1470px. Its comparisons collapsed to 12-14% matched and
  // were reported as a wholesale redesign.
  eq('exactly one recorded run has a width mismatch', fired.length, 1);
  eq('  and it is the run with the known window change',
     fired[0], '1787604099659:pageW:1693->1470,1470,1470');
  // Specificity is the half that matters most: the ondeck runs sit at 24.3%
  // matched because ENOC-97 genuinely is a "Full Rebuild", and their widths
  // agree to the pixel. If the guard fired on those it would relabel every real
  // redesign as a capture fault.
  ok('  and every OTHER sub-floor run stays quiet', subFloorQuiet > 15, subFloorQuiet);
  // The fixture carries viewportH precisely so this can be asserted from real
  // data: heights vary benignly between captures (the 99.6%-matching zapier run
  // records 1281/1225/1281/1225), so a predicate that measured height would
  // void healthy runs. Counted from the corpus, not assumed.
  var hSpread = [];
  ids.forEach(function (rid) {
    var hs = CAPTURES[rid].captures
      .filter(function (c) { return c.fullPage && c.fullPage.viewportH != null; })
      .map(function (c) { return c.fullPage.viewportH; });
    if (hs.length > 1 && Math.max.apply(null, hs) - Math.min.apply(null, hs) > VD_VIEWPORT_TOL_PX) {
      hSpread.push(rid + ':' + (Math.max.apply(null, hs) - Math.min.apply(null, hs)));
    }
  });
  // Two runs on record vary in height beyond tolerance, and they are the whole
  // argument for excluding the axis: one is the broken run (535px) and the other
  // is the 99.6%-matching healthy run (56px). A predicate measuring height
  // cannot tell them apart, so it would void a good run to catch a bad one.
  eq('exactly two recorded runs vary in HEIGHT beyond tolerance',
     hSpread.join(' '), '1787604099659:535 1787605375396:56');
  eq('  and only ONE of them is a width mismatch — height cannot discriminate',
     fired.length, 1);
  print('    height varies beyond tolerance in ' + hSpread.length
        + ' run(s) (one broken, one at 99.6% matched) and is correctly ignored');
  print('    1 of ' + ids.length + ' recorded runs has a width mismatch; '
        + subFloorQuiet + ' sub-floor run(s) correctly left alone');
})();

section('every real comparison carries its completion token');
(function completionTokenOnRealRuns() {
  // The false-negative guard. vdVariantClean now requires POSITIVE evidence that
  // a deterministic pass completed, so the risk this introduces is the opposite
  // of the one it fixes: a real, validly-compared variant wrongly marked
  // unclean. Measured here rather than argued — every LIVE variant on record
  // must carry the token.
  if (typeof vdVariantChecked !== 'function') { ok('vdVariantChecked is available', false); return; }
  var live = 0, missing = [], notLive = 0;
  ids.forEach(function (rid) {
    (RUNS[rid].perVariant || []).forEach(function (v) {
      if (v.skipped || v.error || v.controlDuplicate) { notLive++; return; }
      live++;
      if (!vdVariantChecked(v)) missing.push(rid + '/' + v.label);
    });
  });
  ok('there are live comparisons on record', live > 20, live);
  eq('every live comparison carries the completion token', missing.join(', '), '');
  // And the converse, so the token is not vacuously true: the shapes that are
  // NOT live are exactly the ones allowed to lack it.
  ok('  while non-live variants exist to contrast against', notLive > 0, notLive);
  print('    ' + live + ' live comparison(s) all carry diffMode+matchedFraction; '
        + notLive + ' skipped/errored/duplicate variant(s) contrast');
})();

section('the badge cannot move with the model, on every recorded run');
(function badgeIsDeterministicOnRealRuns() {
  // The reproducibility guarantee, from real data rather than synthetic shapes.
  // Two claims:
  //   1. On every recorded run, re-badging with a different grade vector gives
  //      the same badge. That is what makes a re-run trustworthy.
  //   2. Runs sharing an identical DETERMINISTIC state share a badge. Before
  //      this change one family of 12 recorded runs did not: the ondeck
  //      7-finding comparison badged ISSUES FOUND x9 / PASS x3 on a
  //      hash-identical deterministic half.
  var fams = {}, moved = [];
  ids.forEach(function (rid) {
    var run = RUNS[rid];
    var vv = vdVerdict(run);
    var badge = vdBadgeLabel(vv, {});
    // Perturb ONLY the model half. needsReview is unexpected+unclear and
    // allClean falls the moment a finding is not 'expected', so they move
    // together with the grades and nothing else here does.
    [0, 1, 2, 99].forEach(function (nr) {
      var alt = vdBadgeLabel(Object.assign({}, vv, {
        needsReview: nr, issues: nr + vv.unmetCopy, allClean: nr === 0 && vv.allClean }), {});
      if (alt !== badge) moved.push(rid + ': ' + badge + ' -> ' + alt + ' at needsReview=' + nr);
    });
    var key = [vv.findings, vv.unmetCopy, vv.ungraded, vv.notServed,
               vv.notCompared, vv.failed, vv.notRun, vv.ran].join('|');
    (fams[key] = fams[key] || { badges: {}, n: 0 });
    fams[key].badges[badge] = true; fams[key].n++;
  });
  eq('no recorded run changes badge when the grade vector changes', moved.join('; '), '');

  var repeats = 0, split = [];
  Object.keys(fams).forEach(function (k) {
    if (fams[k].n < 2) return;
    repeats++;
    var b = Object.keys(fams[k].badges);
    if (b.length > 1) split.push(k + ' -> ' + b.join('/'));
  });
  ok('there are families of runs sharing a deterministic state', repeats > 0, repeats);
  eq('  and every one of them badges identically', split.join('; '), '');
  print('    ' + repeats + ' family(ies) of runs share a deterministic state; all badge identically');
})();

section('the badge is ONE implementation, not a copy per caller');
// Both sections must call vdBadgeLabel. Every previous test and harness I wrote
// hardcoded its own copy of the order and so validated my intent, not the code.
var ab = _pu.slice(_pu.indexOf('function rptAbSection(entry) {'),
                   _pu.indexOf('function rptAbVisualDiffSection(vd) {'));
var vdsec = _pu.slice(_pu.indexOf('function rptAbVisualDiffSection(vd) {'),
                      _pu.indexOf('function rptWcagSection('));
ok('the A/B section calls vdBadgeLabel', /vdBadgeLabel\(vv,/.test(ab), ab.slice(0, 200));
ok('the Visual Diff section calls vdBadgeLabel', /vdBadgeLabel\(vv,/.test(vdsec));
ok('neither builds its own ladder', !/rptBadge\('pass', 'PASS'\)/.test(ab + vdsec), 'inline ladder remains');
eq('PASS is the last thing vdBadgeLabel can return, and needs allClean',
   vdBadgeLabel({ ran: true, failed: 0, notRun: 0, notCompared: 0, issues: 0, ungraded: 0, allClean: false }, {}),
   'INCONCLUSIVE');
eq('  an unrecognised state is INCONCLUSIVE, never PASS',
   vdBadgeLabel({ ran: true, allClean: false }, {}), 'INCONCLUSIVE');
eq('  and a positively clean run is PASS',
   vdBadgeLabel({ ran: true, allClean: true }, {}), 'PASS');

// A void comparison on ONE variant must not hide a confirmed copy miss on
// ANOTHER. vdVerdict sums notCompared and unmetCopy across every variant
// independently, and the ladder read the sums -- so v1 resolving to Control's
// own URL outranked v2's properly-served, deterministic copy miss, and the
// badge a client skims contradicted the prose beneath it.
//
// The ordering the comment at the ladder defends is preserved: notCompared
// still sits above PASS, which is the f529775 false-PASS hole. What changed is
// that the issues rung now asks whether a VALIDLY COMPARED variant produced
// them, which is a question the summed counter could not express.
eq('a served variant\'s copy miss outranks another variant\'s void comparison',
   vdBadgeLabel({ ran: true, notCompared: 1, unmetCopy: 2, comparedUnmetCopy: 2 }, {}),
   'ISSUES FOUND');
eq('  but copy misses from the void variant itself do not',
   vdBadgeLabel({ ran: true, notServed: 1, unmetCopy: 2, comparedUnmetCopy: 0 }, {}),
   'NOT COMPARED');
eq('  and a wholly not-compared run is unchanged',
   vdBadgeLabel({ ran: true, notCompared: 2, unmetCopy: 0, comparedUnmetCopy: 0 }, {}),
   'NOT COMPARED');
eq('  the single-variant served case is unchanged',
   vdBadgeLabel({ ran: true, notCompared: 0, unmetCopy: 1, comparedUnmetCopy: 1 }, {}),
   'ISSUES FOUND');
eq('  and notCompared still outranks PASS, which is the f529775 hole',
   vdBadgeLabel({ ran: true, notCompared: 1, allClean: true, comparedUnmetCopy: 0 }, {}),
   'NOT COMPARED');

section('spec suppression cause across every recorded run');
(function theGradingCauseOverTheWholeCorpus() {
  // Run 1787945015802 graded 61 of 67 ENOC-97 findings 'unexpected' against a
  // 1,808-char Zapier spec (1030c21). Its log records source 'ticket' and NO
  // spec ticket key, because summaryTicketKey did not exist yet — so
  // vdSpecTicketMismatch is silent and a boolean "stale" field would read
  // false on it. So would the 19 correct ENOC-97 runs. This is the assertion
  // that says the motivating run is not recorded as clean.
  var census = {};
  Object.keys(SPECS).forEach(function (stem) {
    var s = SPECS[stem];
    var d = buildDesignReferenceDebug(
      s.activeTicketKey ? { ticketKey: s.activeTicketKey } : null,
      { summaryOfChanges: s.present ? new Array(s.length + 1).join('x') : '',
        summarySource: s.source, summaryTicketKey: s.specTicketKey }, false);
    var g = d.summaryOfChanges.grading;
    census[g] = (census[g] || 0) + 1;
    if (stem === '1787945015802') {
      eq('the run graded against another ticket is not recorded as clean', g, 'graded-unverified');
    }
  });
  // Compared over SORTED keys, never by stringifying the accumulator against a
  // typed literal: census is filled in corpus order, so JSON.stringify would
  // pin key insertion order and fail on correct counts.
  //
  // graded went 20 -> 21 when the corpus gained its fifth site, then +1 for
  // each of the seven ENOC-97 reruns recorded on 2026-09-16 (1789567065599,
  // 1789569031354, 1789570575661, 1789577773154, 1789582254335 -- the first
  // 0.6.5 log -- 1789585563500 and 1789590772186, the first carrying the
  // region/coverage/notWalked fixes). Every one is DERIVED, not bumped: each
  // spec was auto-filled from the active ticket, so summaryTicketKey is
  // present AND equal to ticketKey, which clears both the withheld and the
  // graded-unverified rungs. The other two buckets are unmoved throughout --
  // nothing new arrived without a spec, and no ticket mismatch. A new run
  // that does NOT follow that pattern must fail here rather than be absorbed.
  eq('every recorded run resolves to a cause',
     Object.keys(census).sort().map(function (k) { return k + '=' + census[k]; }).join(','),
     'graded=28,graded-unverified=17,none=6');
  eq('  and every log carrying a designReference is accounted for',
     Object.keys(census).reduce(function (n, k) { return n + census[k]; }, 0),
     Object.keys(SPECS).length);
  // Pinned so the first real ticket-mismatch run to land FAILS here and forces
  // this note to be revisited. No log on record carries a spec ticket key that
  // differs from its active one, so 'withheld' is covered synthetically only,
  // in qa-report.test.js.
  eq('no recorded run was ever withheld', census.withheld || 0, 0);
})();


// ── The identity split, against every recorded verification on the corpus ──
// The old single `unknown` became `unchecked` (the platform could have answered
// and we failed to read it) and `unverifiable` (there was never anything to
// read). Only the first reaches the NOT VERIFIED badge rung.
//
// The logs record the PROJECTION, not the raw expProbe, so these states cannot
// be re-derived from source the way notServed can. What CAN be checked on real
// data — and is the thing that actually matters — is that the split covers the
// corpus: every reason string production ever emitted is still emitted by the
// current source, and lands on a definite side. A reason that no current exit
// produces is an exit that was deleted or reworded out from under real data.
//
// Deliberately NOT a copy of the classification rule. The test enumerates what
// the SOURCE emits and checks the recorded strings against that; it never says
// which side a reason belongs on.
(function theIdentitySplitCoversTheCorpus() {
  var VERIF = JSON.parse(readFile('fixtures-real-verification.json'));
  var RUNS_V = VERIF.runs, INDEX = VERIF.reasonIndex;

  // Every exit of vdVariantVerification that yields an unresolved state, driven
  // through the real function. The shapes are the minimum each exit needs.
  var probes = [
    null,                                                             // no probe at all
    { ok: false },                                                    // probe failed
    { ok: true, detected: {}, forced: { optimizely_x: '474' } },      // no platform
    { ok: true, detected: { optimizely: true }, forced: {} },         // nothing forced
    { ok: true, detected: { optimizely: true }, forced: { optimizely_x: ',' } },
    { ok: true, detected: { optimizely: true }, catalogComplete: false,
      forced: { optimizely_x: '474' }, experiments: [] },
  ];
  var emitted = {};
  probes.forEach(function (p) { emitted[vdVariantVerification(p).reason] = vdVariantVerification(p).state; });
  var states = {};
  Object.keys(emitted).forEach(function (k) { states[emitted[k]] = true; });
  eq('the source emits exactly two unresolved states',
     Object.keys(states).sort().join(','), 'unchecked,unverifiable');
  ok('and "unknown" is not one of them', !states.unknown);

  // Recorded reason -> the state the CURRENT source gives that exit. Matched on
  // the fixture's own key, never on the full sentence: the wording drifted once
  // already ("the URL" -> "the configured URL" on the nothing-forced exit), and
  // a rewording is not a deleted exit. The key lives in the fixture so this test
  // holds no rule about which side anything belongs on.
  function currentStateFor(reason) {
    var key = INDEX[reason];
    if (!key) return null;
    var hits = Object.keys(emitted).filter(function (r) { return r.indexOf(key) !== -1; });
    return hits.length === 1 ? emitted[hits[0]] : null;
  }

  var recorded = {}, capCount = 0;
  Object.keys(RUNS_V).forEach(function (stem) {
    RUNS_V[stem].captures.forEach(function (c) {
      capCount++;
      if (c.state === 'unknown' || c.state === 'unchecked' || c.state === 'unverifiable') {
        recorded[c.reason] = (recorded[c.reason] || 0) + 1;
      }
    });
  });
  var orphans = Object.keys(recorded).filter(function (r) { return !currentStateFor(r); });
  eq('every unresolved reason on record still resolves to exactly one current exit',
     orphans.join(' | '), '');
  // The split is TOTAL over real data, and both sides are actually represented —
  // a partition that put everything on one side would pass the check above.
  var census = { unchecked: 0, unverifiable: 0 };
  Object.keys(recorded).forEach(function (r) { census[currentStateFor(r)] += recorded[r]; });
  eq('the recorded unresolved captures partition 3 unchecked / 2 unverifiable',
     'unchecked=' + census.unchecked + ',unverifiable=' + census.unverifiable,
     'unchecked=3,unverifiable=2');
  eq('  over every capture carrying a verification result', capCount, 46);

  // The Control case that makes the split necessary. This is the most common
  // unresolved reason on record, it is emitted by a NORMAL run, and gating the
  // old `unknown` would have voided it.
  eq('a Control that forces nothing is unverifiable, not a gap',
     currentStateFor('the URL did not force a variation, so there is nothing to verify against'),
     'unverifiable');
  eq('a probe that never ran IS a gap',
     currentStateFor('the experiment-platform probe did not run'), 'unchecked');

  // Badge impact, on the real corpus rather than a synthetic verdict. Exactly
  // one run of the 20 moves, and it is the one where BOTH captures are
  // unchecked. Measured before the rung was written; if a future change makes
  // this number grow, the rung got louder than the evidence supports.
  var moved = Object.keys(RUNS_V).filter(function (stem) {
    var anyUnchecked = RUNS_V[stem].captures.some(function (c) {
      return currentStateFor(c.reason) === 'unchecked';
    });
    if (!anyUnchecked) return false;
    var run = RUNS[stem.replace('selenite-debug-r_', '')];
    if (!run) return false;
    var vv = vdVerdict(run);
    return vdBadgeLabel(vv, { allowNotRan: true })
        !== vdBadgeLabel(Object.assign({}, vv, { notVerified: 1 }), { allowNotRan: true });
  });
  eq('exactly one recorded run changes badge under the new rung', moved.length, 1);
  eq('  and it is the run whose every capture went unchecked',
     moved.join(','), 'selenite-debug-r_1788191807035');
  print('    ' + Object.keys(recorded).length + ' distinct unresolved reasons on record, 0 orphaned');
})();

// ── The cover's width line, over every recorded capture set ───────────────
// The synthetic cases live in qa-report.test.js. This one checks the property
// that only real data can: the line resolves on the whole corpus, and it agrees
// with the parity guard on every run — two readings of one quantity that must
// never contradict each other, which is how the badge ladder inverted.
(function theCoverWidthAgreesWithTheParityGuard() {
  var ids = Object.keys(CAPTURES).sort();
  var rendered = 0, blank = 0, plural = 0, disagreements = [];
  ids.forEach(function (rid) {
    var caps = CAPTURES[rid].captures || [];
    var line = abCaptureWidths([{ mode: 2, data: { captures: caps } }]);
    if (!line) { blank++; return; }
    rendered++;
    var saysDiffer = /widths differ/.test(line);
    if (saysDiffer) plural++;
    // vdCaptureWidthMismatch allows VD_VIEWPORT_TOL_PX of slack; the cover
    // reports distinct values exactly. So the guard firing MUST imply the cover
    // saying widths differ, but not the reverse -- a sub-tolerance spread is a
    // real difference worth printing and not worth erroring on.
    var guard = vdCaptureWidthMismatch(caps);
    if (guard && !saysDiffer) disagreements.push(rid + ' guard fired, cover silent: ' + line);
  });
  eq('the cover width resolves on every recorded run', blank, 0);
  eq('  all of them', rendered, ids.length);
  eq('no run has the parity guard firing while the cover stays silent',
     disagreements.join(' | '), '');
  // The one recorded mismatch, named. If this ever reads 0 the fixture lost it,
  // and the cover line stopped being tested against the case it exists for.
  eq('exactly one recorded run prints differing widths', plural, 1);
  ok('  and it is the zapier redesign-misread run',
     /widths differ/.test(abCaptureWidths([{ mode: 2, data: { captures: CAPTURES['1787604099659'].captures } }])));
  print('    cover width rendered on ' + rendered + ' of ' + ids.length + ' recorded runs, 1 flagged');
})();


// ── Funnel Crawl: the coordinate space, driven by the recorded walk ─────────
// Run 1789744771634 clicked six times at raw screenshot coordinates, reported
// every one as delivered, and concluded the SITE was at fault. None of that was
// visible in the log: the conversion failed silently, the out-of-range net
// could not see it, and the segment's own geometry did not describe the step
// that worked. This drives the real converter with the real recorded numbers.
section('funnel crawl coordinate space (real runs)');
(function funnelCoordinateSpace() {
  if (typeof fnCoordToCss !== 'function' || typeof fnStopSentence !== 'function') {
    ok('funnel helpers are exported from background.js', false, 'slice markers stale?');
    return;
  }
  var fids = Object.keys(FUNNEL).sort();
  ok('the funnel corpus is not empty', fids.length > 0);

  // TRAP 4, pinned: `steps > 0` with no actions is the stale-service-worker
  // shape, not a parse failure. Two runs on record carry it, and the popup
  // detects exactly this to tell the tester to reload the extension.
  var staleWorker = 0, withActions = 0;
  fids.forEach(function (rid) {
    (FUNNEL[rid].segments || []).forEach(function (sg) {
      if ((sg.steps || 0) > 0 && !(sg.actions || []).length) staleWorker++;
      if ((sg.actions || []).length) withActions++;
    });
  });
  // Exact, and it stays exact: the stale-worker shape cannot recur now that the
  // current build always records per-action evidence, so a third would mean a
  // worker older than this popup is running again.
  eq('two recorded walks are the stale-worker shape', staleWorker, 2);
  // NOT exact. This corpus gains runs faster than the suite is edited, and a
  // census that breaks on every successful funnel teaches people to loosen
  // assertions. The runs that carry a claim are named individually below.
  ok('and the rest recorded actions', withActions >= 4, withActions);

  // TRAP 7, pinned. Every log on record predates the crawl having any time
  // bound, so all of its timing reads null -- which means "not measured", not
  // "instant". The stop sentence sums these to say which half of a slow hop to
  // fix, and a null summed as 0 would silently report the wrong half.
  var timed = 0, untimed = 0;
  fids.forEach(function (rid) {
    (FUNNEL[rid].segments || []).forEach(function (sg) {
      (sg.actions || []).forEach(function (a) {
        if (a.ms === null && a.modelMs === null) untimed++; else timed++;
      });
    });
  });
  // Both vintages now exist, and that IS the assertion -- when this was written
  // every log predated the bounds, and the first timed log arrived the same day.
  // Requiring "all null" would have to be loosened on every run from here on.
  ok('the corpus carries both vintages', timed > 0 && untimed > 0, { timed: timed, untimed: untimed });
  eq('  and the run that first carried timing is timed throughout',
     (FUNNEL['1789750056464'].segments[0].actions || [])
       .filter(function (a) { return a.ms !== null && a.modelMs !== null; }).length, 10);
  ok('  with a segment wall clock to match', FUNNEL['1789750056464'].segments[0].elapsedMs > 0);

  // THE RUN. Replaying the converter over the SEGMENT geometry reproduces steps
  // 2-7 byte for byte and canNOT reproduce step 1 — which is the whole
  // diagnosis. out.geometry is one object mutated per capture, so it holds only
  // the last screenshot's numbers; step 1 ran against a taller image whose
  // dimensions the log never recorded.
  var seg = FUNNEL['1789744771634'].segments[0];
  var g = seg.geometry;
  eq('the recorded segment geometry is the LAST capture', g.imageH, 1138);
  var reproduced = 0, notReproduced = [];
  (seg.actions || []).forEach(function (a) {
    if (!a.modelCoord || !a.cssCoord) return;
    var c = fnCoordToCss(a.modelCoord[0], a.modelCoord[1], g.imageW, g.imageH, g.viewportW, g.viewportH);
    if (c.x === a.cssCoord[0] && c.y === a.cssCoord[1]) reproduced++;
    else notReproduced.push(a.step);
  });
  eq('the segment geometry reproduces every step but the first', reproduced, 6);
  eq('  and the one it cannot is step 1', notReproduced.join(','), '1');

  // Step 1's real image height, recovered the only way the log allows: by
  // solving backwards. 1186 is the unique integer that reproduces its output.
  var a1 = seg.actions[0];
  var solved = null;
  for (var h = 1100; h <= 1281; h++) {
    var c1 = fnCoordToCss(a1.modelCoord[0], a1.modelCoord[1], g.imageW, h, g.viewportW, g.viewportH);
    if (c1.x === a1.cssCoord[0] && c1.y === a1.cssCoord[1]) { solved = solved === null ? h : -1; }
  }
  eq('step 1 ran against a uniquely determined, unrecorded image height', solved, 1186);
  ok('  which is TALLER than every later capture', solved > g.imageH);

  // Replaying the segment geometry declines ALL SEVEN, including the step that
  // demonstrably converted. That is not a contradiction, it is the same fact
  // again: this geometry never described step 1, so it cannot be used to decide
  // what step 1 did. Pinned, because reading it as per-action is the trap.
  var conv = (seg.actions || []).map(function (a) {
    return a.modelCoord
      ? fnCoordToCss(a.modelCoord[0], a.modelCoord[1], g.imageW, g.imageH, g.viewportW, g.viewportH)
      : null;
  });
  eq('under the segment geometry every step declines',
     conv.filter(function (c) { return c && c.converted === false; }).length, 7);
  eq('  all for the same reason', conv[1].reason, 'axes-disagree');

  // What ACTUALLY happened is recoverable only from the outputs: a converted
  // coordinate moved, a declined one came back identical. (Sound here because
  // the scale is 1.076, not 1.0 — a 1x host would make the two indistinguishable,
  // which is exactly why coordConverted is now recorded rather than inferred.)
  var moved = function (a) {
    return !!(a.modelCoord && a.cssCoord
      && (a.cssCoord[0] !== a.modelCoord[0] || a.cssCoord[1] !== a.modelCoord[1]));
  };
  var converted = (seg.actions || []).filter(moved);
  var declined = (seg.actions || []).filter(function (a) { return !moved(a); });
  eq('exactly one recorded step was converted', converted.length, 1);
  eq('  and it is step 1', converted[0].step, 1);
  eq('the other six were left in screenshot space', declined.length, 6);

  // THE HOLE the fix exists to close. Every declined coordinate was dispatched
  // anyway, landed inside the viewport, and came back `delivered: true`.
  eq('all six were dispatched and reported delivered',
     declined.filter(function (a) { return a.delivered === true; }).length, 6);
  eq('  and none was flagged out of range', declined.filter(function (a) { return a.outOfRange; }).length, 0);
  eq('  because the downscaled image fits inside the viewport',
     declined.filter(function (a) { return fnCoordInViewport(a.cssCoord[0], a.cssCoord[1], g.viewportW, g.viewportH); }).length, 6);

  // What the run actually told the tester, kept verbatim so the regression is
  // a record rather than a memory.
  ok('the run concluded it was NOT a targeting problem',
     /not a\s+targeting problem/.test(seg.summary), seg.summary);

  // And what the current build says about the same walk. The recorded actions
  // predate coordConverted, so it is DERIVED here by the real converter over
  // the recorded geometry — not hand-written — and fed back through the real
  // sentence builder.
  var asFixed = {
    from: seg.from, to: seg.to, reached: false, steps: seg.steps, error: null,
    geometry: g, stopReason: seg.stopReason, apiStopReason: null, finalText: '',
    actions: (seg.actions || []).map(function (a, i) {
      var o = {};
      for (var k in a) o[k] = a[k];
      // Converted-ness from what the run RECORDED; the reason from the real
      // converter. Neither is hand-written.
      o.coordConverted = a.modelCoord ? moved(a) : null;
      o.coordReason = a.modelCoord ? (moved(a) ? null : (conv[i] || {}).reason) : 'no-coordinate';
      o.hit = a.hit || {};
      o.page = a.page || null;
      return o;
    }),
  };
  var now = fnStopSentence(asFixed);
  ok('the current build no longer calls it a targeting-free failure',
     now.indexOf('not a targeting problem') === -1, now);
  ok('  it names the coordinate space', /could not be converted out of the screenshot/.test(now), now);
  ok('  and says the fault is ours', /Selenite/.test(now), now);
  ok('  counting the six that failed, not all seven', /^6 of 7 actions/.test(now), now);
  print('    was: ' + seg.summary.slice(0, 96) + '...');
  print('    now: ' + now.slice(0, 96) + '...');

  // ---- the same funnel, after the fix ----
  // 1789747242103 is 1789744771634 re-run against the current build: same two
  // waypoints, same site, 40 minutes later. It is the only post-fix walk on
  // record and the only real data exercising coordConverted and per-action
  // geometry, so what it proves it proves once.
  var ok2 = FUNNEL['1789747242103'].segments[0];
  ok('the same funnel now reaches the end', ok2.reached === true);
  eq('  and says so', ok2.stopReason, 'arrived');
  eq('every action converted its coordinate',
     (ok2.actions || []).filter(function (a) { return a.coordConverted === true; }).length, ok2.actions.length);
  eq('  with no reason to report',
     (ok2.actions || []).filter(function (a) { return a.coordReason === null; }).length, ok2.actions.length);
  eq('  and every one carries the geometry it used',
     (ok2.actions || []).filter(function (a) { return a.geometry && a.geometry.imageH; }).length, ok2.actions.length);

  // THE DIAGNOSIS, confirmed by instrumentation rather than argued. The viewport
  // drops once, right after the debugger attaches, and then holds -- which is
  // what a browser infobar does and what a site cannot do on cue.
  var vps = (ok2.actions || []).map(function (a) { return a.geometry.viewportH; });
  eq('the viewport moves exactly once, on the first capture', new Set(vps.slice(1)).size, 1);
  ok('  downward', vps[0] > vps[1], vps.join(','));
  eq('  by the 56px the pre-fix run lost between its first two captures', 1281 - vps[1], 56);

  // And the answer to the question the innerW/innerH probe was added to settle:
  // window.innerHeight and cssVisualViewport.clientHeight are the SAME number on
  // every settled capture, so there is no scrollbar correction to make.
  var agree = (ok2.actions || []).slice(1).every(function (a) {
    return a.hit && a.hit.innerH === a.geometry.viewportH && a.hit.innerW === a.geometry.viewportW;
  });
  ok('the two viewport primitives agree on every settled capture', agree);

  // The residual this run exposed, and what now prevents it. Step 1's capture
  // and its measurement were taken either side of the infobar animation; both
  // convert, so fnCoordToCss cannot be the thing that catches it.
  var a1ok = ok2.actions[0], a2ok = ok2.actions[1];
  ok('the seed capture was taken while the viewport was moving',
     !fnCaptureAxesAgree(a1ok.geometry.imageW, a1ok.geometry.imageH,
                         a1ok.geometry.viewportW, a1ok.geometry.viewportH));
  ok('  but it converted, so only the capture check can see it', a1ok.coordConverted === true);
  ok('  and every later capture was settled',
     (ok2.actions || []).slice(1).every(function (a) {
       return fnCaptureAxesAgree(a.geometry.imageW, a.geometry.imageH,
                                 a.geometry.viewportW, a.geometry.viewportH);
     }));
  // What it cost: the first click missed the button and hit its container.
  eq('the first click reached only the banner container', a1ok.deliveredTo, '#meru-cm');
  eq('  and changed nothing', a1ok.mutations, 0);
  eq('  while the settled step hit the button itself', a2ok.deliveredTo, '#c-rall-bn');
  ok('  which was interactive', a2ok.hit.interactive === true);
  ok('  and dismissed the banner', a2ok.mutations > 0 && a2ok.page.textLen < a1ok.page.textLen);
  var frac = a1ok.modelCoord[1] / a1ok.geometry.imageH;
  eq('the miss is exactly the viewport delta, not a targeting error',
     a1ok.cssCoord[1] - Math.round(frac * a1ok.hit.innerH), 37);
  print('    post-fix: reached in ' + ok2.steps + ' steps, ' + ok2.actions.length + '/'
        + ok2.actions.length + ' converted, viewport ' + vps[0] + ' -> ' + vps[1]);

  // ---- and once the seed capture waits for the viewport to settle ----
  // 1789747941369 is the SAME lesschwab funnel as the two above, run again with
  // waitForStableViewport in front of the seed capture. The whole point is that
  // the first capture is no longer taken mid-animation.
  var settled = FUNNEL['1789747941369'].segments[0];
  var seed = function (sg) { return sg.actions[0].geometry; };
  ok('before the settle wait, the seed capture was moving',
     !fnCaptureAxesAgree(seed(ok2).imageW, seed(ok2).imageH, seed(ok2).viewportW, seed(ok2).viewportH));
  ok('after it, the seed capture is settled',
     fnCaptureAxesAgree(seed(settled).imageW, seed(settled).imageH,
                        seed(settled).viewportW, seed(settled).viewportH));
  // The viewport no longer moves mid-segment at all, because the segment now
  // starts after it has stopped.
  eq('and it holds from the very first capture',
     new Set((settled.actions || []).map(function (a) { return a.geometry.viewportH; })).size, 1);
  eq('  at the post-infobar height', settled.actions[0].geometry.viewportH, ok2.actions[1].geometry.viewportH);
  // What it bought: the wasted first click is gone. Same two waypoints, same
  // site, same build otherwise.
  ok('the same funnel now takes fewer steps', settled.steps < ok2.steps, {
    before: ok2.steps, after: settled.steps });
  var before = Math.abs(seed(ok2).coordScaleX - seed(ok2).coordScaleY);
  var after = Math.abs(seed(settled).coordScaleX - seed(settled).coordScaleY);
  ok('  and the seed capture is orders of magnitude closer to agreeing', after < before / 100,
     { before: before, after: after });
  print('    settled: same funnel in ' + settled.steps + ' steps (was ' + ok2.steps
        + '), seed axes ' + before.toFixed(6) + ' -> ' + after.toFixed(8));

  // ---- the dropdown that could not be clicked ----
  // r_1789750056464 (healthypaws) spent five of ten steps on ONE native
  // <select>, because a native select's option list is drawn by the browser
  // outside the page: absent from the DOM, absent from the screenshot,
  // unreachable by Input.dispatchMouseEvent. Clicking it can only focus it.
  var dd = FUNNEL['1789750056464'].segments[0];
  eq('the run ran out of budget rather than being caught', dd.stopReason, 'budget');
  ok('  and never reached the destination', dd.reached === false);
  var onSelect = (dd.actions || []).filter(function (a) { return a.deliveredTo === '#petBirthYear'; });
  eq('five consecutive clicks landed on the same dropdown', onSelect.length, 5);
  eq('  half the whole budget', onSelect.length * 2, dd.steps);
  // The page was provably unmoved: identity is the half of the predicate that
  // was already right.
  eq('  with one single page fingerprint across all five',
     new Set(onSelect.map(function (a) { return a.page.url + '|' + a.page.title + '|' + a.page.textLen; })).size, 1);
  ok('  and yet every one of them reported mutations',
     onSelect.every(function (a) { return a.mutations > 0; }),
     onSelect.map(function (a) { return a.mutations; }));

  // WHY THE DETECTOR STAYED SILENT, shown rather than asserted. The recorded
  // actions predate structuralMutations, so fnDidSomething falls back to the
  // total and scores them exactly as the old build did.
  eq('under the recorded evidence the streak is 0', fnNoProgressRun(onSelect), 0);
  // The counterfactual, built by adding the ONE field the build now records --
  // nothing else about these actions is touched.
  var withSplit = onSelect.map(function (a) {
    var o = {}; for (var k in a) o[k] = a[k];
    o.structuralMutations = 0;   // what a focus ring and an aria-expanded flip are
    return o;
  });
  eq('  and with the split recorded it is a run of 5', fnNoProgressRun(withSplit), 5);
  ok('  which would have nudged the agent', 5 >= 3);

  // The same form proves the fix is aimed at the right thing: its OTHER
  // dropdown is a native select wrapped by select2, so its options are real DOM
  // and the click path worked. Two dropdowns, one form, opposite outcomes.
  var breed = (dd.actions || []).filter(function (a) {
    return a.deliveredTo && a.deliveredTo.indexOf('select2') !== -1;
  });
  eq('the select2-wrapped dropdown took exactly one click to open', breed.length, 1);
  ok('  and it moved the page, unlike the native one', breed[0].mutations > 1000, breed[0].mutations);

  // TRAP 7 again, at the consumer: this log predates every field the fix adds.
  ok('the recorded actions carry no control report',
     (dd.actions || []).every(function (a) { return !a.hit || a.hit.control === null; }));
  ok('  and no choice', (dd.actions || []).every(function (a) { return a.choice === null; }));
  print('    dropdown: ' + onSelect.length + ' of ' + dd.steps + ' steps on #petBirthYear, '
        + 'streak 0 as recorded / ' + fnNoProgressRun(withSplit) + ' with the split');

  // ---- and the same dropdown once the crawl could choose ----
  // r_1789751164165 is the same funnel on the build that intercepts a native
  // select. One click, one choice, no repeat.
  var ch = FUNNEL['1789751164165'].segments[0];
  var picked = (ch.actions || []).filter(function (a) { return a.choice; });
  eq('the dropdown now takes exactly one action', picked.length, 1);
  var c = picked[0].choice;
  eq('  on the control that cost five steps before', c.id, 'petBirthYear');
  ok('  and the value stuck, read back rather than assumed', c.applied === true, c);
  ok('  it is a real option, not the placeholder', c.chosenIndex > 0 && c.chosenText, c);
  eq('  which is what was there before', c.previousText, "Pet's Age");
  eq('  chosen from the same list the probe counted', c.optionCount, 15);
  eq('  minus the empty-valued placeholder', c.usableCount, 14);
  ok('  first time, so no re-roll', c.repeat === false);
  // The probe now names the control, which is the thing brief() had discarded.
  eq('the probe reports it as a select', picked[0].hit.control.kind, 'select');
  eq('  and agrees with the chooser on what was choosable', picked[0].hit.control.usable, c.usableCount);
  // The select2-wrapped dropdown on the same form is NOT intercepted — its
  // options are real DOM and clicking already worked.
  var s2 = (ch.actions || []).filter(function (a) {
    return a.deliveredTo && a.deliveredTo.indexOf('select2') !== -1;
  });
  ok('the wrapped dropdown is still clicked, never intercepted',
     s2.length > 0 && s2.every(function (a) { return a.choice === null && (!a.hit || a.hit.control === null); }));

  // THE BUG THIS RUN EXPOSED. hit.control landed; structuralMutations did not,
  // because nothing copied it from the probe onto the record. Pinned as the
  // recorded past, so the shape of that failure stays legible.
  ok('the same run carries hit.control on the select',
     picked[0].hit.control !== null);
  ok('  while structuralMutations was null on every action — the wire was missing',
     (ch.actions || []).every(function (a) { return a.structuralMutations === null; }));
  print('    chose: "' + c.chosenText + '" (' + (c.chosenIndex + 1) + ' of ' + c.optionCount
        + ', ' + c.usableCount + ' usable) in 1 action, applied=' + c.applied);

  // ---- and what the log's own "start here" list says about it ----
  // vdCollectProblems is 500+ lines with its own dependencies, so only its
  // funnel branch is sliced. It is self-contained: `sections` and `add` in,
  // strings out.
  var funnelProblems = new Function('sections', 'add',
    slicePopup('// Funnel Crawl: this whole mode IS the AI-vision agent walking one waypoint',
               '  return problems;'));
  var collect = function (segments) {
    var got = [];
    funnelProblems({ modes: [{ mode: 'funnel', status: 'ran', data: { segments: segments } }] },
                   function (sev, where, detail) { got.push({ sev: sev, where: where, detail: detail }); });
    return got;
  };

  // TRAP 5, pinned at the consumer. The recorded actions predate
  // coordConverted, so it reads null — which must NOT be treated as false, or
  // every pre-fix run turns into a fabricated conversion failure.
  var asRecorded = collect([seg]);
  eq('the recorded run reports its stop',
     asRecorded.filter(function (p) { return /not a\s+targeting problem/.test(p.detail); }).length, 1);
  eq('  and a null coordConverted raises nothing',
     asRecorded.filter(function (p) { return /could not be converted/.test(p.detail); }).length, 0);

  // The same walk as the current build would record it.
  var afterFix = collect([asFixed]);
  var conversion = afterFix.filter(function (p) { return /could not be converted/.test(p.detail); });
  eq('a post-fix run names the conversion failure', conversion.length, 1);
  eq('  as an error', conversion[0].sev, 'error');
  ok('  quoting both scales', /1\.076 across and 1\.126 down/.test(conversion[0].detail), conversion[0].detail);
  ok('  and saying whose fault it is', /Selenite/.test(conversion[0].detail), conversion[0].detail);

  // The stale-worker shape reaches the reader as an instruction, not a mystery.
  var stale = collect(FUNNEL['1789742354610'].segments);
  eq('a steps-but-no-actions walk is named as an old background build',
     stale.filter(function (p) { return /older background build/.test(p.detail); }).length, 1);

  // Out-of-range used to be described with the FIRST segment's geometry, whoever
  // the clicks belonged to. Two segments, different sizes, offender in the second.
  var segA = { from: 'a', to: 'b', reached: true, stopReason: 'arrived', steps: 1, actions: [],
               geometry: { viewportW: 1280, viewportH: 800, imageW: 1280, imageH: 800 } };
  var segB = { from: 'b', to: 'c', reached: false, stopReason: 'stuck', steps: 1, summary: 'x',
               geometry: { viewportW: 1171, viewportH: 760, imageW: 2342, imageH: 1520 },
               actions: [{ step: 1, action: 'left_click', outOfRange: true, cssCoord: [2342, 673],
                           geometry: { viewportW: 1171, viewportH: 760, imageW: 2342, imageH: 1520 } }] };
  var crossSeg = collect([segA, segB]).filter(function (p) { return /OUTSIDE the/.test(p.detail); });
  eq('an out-of-range click is reported once', crossSeg.length, 1);
  ok('  against ITS OWN viewport, not the first segment\'s',
     crossSeg[0].detail.indexOf('1171x760') !== -1 && crossSeg[0].detail.indexOf('1280x800') === -1,
     crossSeg[0].detail);
})();


print('');
if (failures.length) { print('FAILURES:'); failures.forEach(function (f) { print('  - ' + f); }); }
print('=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
