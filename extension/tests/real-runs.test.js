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

function readFile(p) { return read(p); }
var _pu = readFile('../popup.js');
function slicePopup(from, to) {
  var a = _pu.indexOf(from), b = _pu.indexOf(to, a + 1);
  if (a === -1 || b === -1) throw new Error('slice marker missing: ' + from);
  return _pu.slice(a, b);
}
eval(slicePopup('function vdUnmetRequirements(v) {', '\n// The pages this run actually tested'));

var RUNS = JSON.parse(readFile('fixtures-real-runs.json'));

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
