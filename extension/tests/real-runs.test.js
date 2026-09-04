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

var RUNS = JSON.parse(readFile('fixtures-real-runs.json'));

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

var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++; failures.push(name + (detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 240) : ''));
}
function eq(name, a, b) { ok(name, a === b, { actual: a, expected: b }); }
function section(t) { print('\n' + t); }

// What the log itself says, counted rather than asserted from memory.
function fromLog(run) {
  var o = { findings: 0, unexpected: 0, unclear: 0, ungraded: 0, unmet: 0, errored: 0, skipped: 0, dup: 0, deadGrade: 0 };
  (run.perVariant || []).forEach(function (v) {
    if (v.error) { o.errored++; return; }
    if (v.skipped) { o.skipped++; return; }
    if (v.controlDuplicate) o.dup++;
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
  o.findings += (run.sharedFindings || []).length;
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
    && L.unmet === 0 && L.errored === 0 && L.skipped === 0 && L.dup === 0 && L.deadGrade === 0;
  ok(rid + ' badges PASS only when the log shows nothing wrong',
     label !== 'PASS' || nothingWrong, { badge: label, log: L });
  // And the converse: a clean log must not be scared into a non-PASS.
  ok(rid + '   a wholly clean log is not badged as a problem',
     !nothingWrong || label === 'PASS', { badge: label, log: L });
  // A log carrying an error-severity problem must never read PASS.
  ok(rid + '   a run with an error-severity problem is never PASS',
     !(run.errorProblems || []).length || label !== 'PASS',
     { badge: label, errors: run.errorProblems });
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

(function theReorderingRuleIsInertOnEveryRecordedRun() {
  var ids = Object.keys(CLUSTERS).sort();
  ok('there are recorded cluster sets to check', ids.length > 0);

  var multi = 0, annotated = 0, vertSeen = 0;
  ids.forEach(function (rid) {
    var run = CLUSTERS[rid];
    var sc = run.shiftClusters || {};
    var vert = sc.vertical || [], horz = sc.horizontal || [];
    vertSeen += vert.length;
    if (vert.filter(function (c) { return c.trusted; }).length >= 2) multi++;

    // EVERY run, annotated or not: feed the recorded geometry back through the
    // live predicate. This is the check that matters, and it works on logs from
    // before the rule shipped because cluster geometry is cluster geometry.
    var copy = JSON.parse(JSON.stringify(vert));
    vdReorderContradiction(copy, VD_SHIFT_TOL_PX, VD_MOVE_MIN_PX);
    copy.forEach(function (c, i) {
      eq(rid + ' the live predicate contradicts nothing recorded [' + i + ']',
         c.contradictedBy, null);
    });

    // Only logs produced by a build carrying the rule can be checked for the
    // annotation itself. Twelve of these predate 4b4e236 — asserting the key on
    // those would be asserting that history changed.
    if (!run.annotated) return;
    annotated++;
    vert.forEach(function (c) {
      ok(rid + '   vertical cluster carries contradictedBy', 'contradictedBy' in c, c);
      eq(rid + '   and it is null — the rule ran and cleared it', c.contradictedBy, null);
    });
    // AXIS SCOPING, proven from production rather than asserted: the rule is
    // vertical-only, so horizontal clusters must carry no annotation at all.
    horz.forEach(function (c) {
      ok(rid + '   horizontal cluster is NOT annotated', !('contradictedBy' in c), c);
    });
  });

  print('    ' + vertSeen + ' vertical clusters across ' + ids.length + ' runs; '
        + annotated + ' run(s) carry the annotation; '
        + multi + ' run(s) have >= 2 trusted vertical clusters');
  ok('at least one run was produced by a build carrying the rule', annotated > 0,
     'no annotated run yet — reload the extension and re-run');
  // Said out loud rather than implied. The rule needs two trusted vertical
  // clusters to fire at all, so while this is 0 the corpus CANNOT exercise it:
  // the inertness above is structural, not evidence of correctness. The first
  // multi-cluster log is the one the flag is waiting for.
  if (multi === 0) {
    print('    NOTE: no recorded run can fire the rule (needs >= 2 trusted vertical');
    print('          clusters). Inertness above is STRUCTURAL, not proof of correctness.');
  }
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

print('');
if (failures.length) { print('FAILURES:'); failures.forEach(function (f) { print('  - ' + f); }); }
print('=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
