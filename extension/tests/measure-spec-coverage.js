// Manual tuning tool for vdSpecCoverage — NOT a test, not wired into CI or
// regen-fixtures.py. Drives the real vd-diff.js against every real spec on
// disk and prints what the heading/unchecked classifier would say, so the
// thresholds in vdSpecCoverage (extension/vd-diff.js) can be tuned against
// actual ticket prose before the feature ships. No spec text is written back
// anywhere; this only prints to stdout.
//
//   cd extension/tests
//   jsc measure-spec-coverage.js -- ~/Downloads/selenite-debug-r_*.json
//
// (jsc ships with macOS at
//  /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc)
//
// The shell expands `~` and the glob before jsc ever sees the arguments, so
// this needs no directory-listing support from jsc itself.

load('../vd-config.js');
load('../vd-diff.js');

var files = Array.prototype.slice.call(arguments);
if (!files.length) {
  print('usage: jsc measure-spec-coverage.js -- ~/Downloads/selenite-debug-r_*.json');
  quit(1);
}

// Grouped by spec HASH, not by file: many logs on record are reruns of the
// same ticket against the same spec text, and the tuning question is "how
// does this classifier read this spec", not "how many files carry it".
var bySpec = {};
var unreadable = 0;
files.forEach(function (path) {
  var d;
  try { d = JSON.parse(read(path)); } catch (e) { unreadable++; return; }
  var soc = (d.designReference || {}).summaryOfChanges || {};
  var text = soc.text || '';
  if (!text) return;
  var hash = soc.hash || ('nohash:' + path);
  var labels = ((d.visualDiff || {}).perVariant || []).map(function (v) { return v.label; })
    .filter(function (l) { return l; });
  if (!bySpec[hash]) bySpec[hash] = { text: text, ticketKey: soc.ticketKey || null, labels: {}, fileCount: 0 };
  bySpec[hash].fileCount++;
  labels.forEach(function (l) { bySpec[hash].labels[l] = true; });
});

var hashes = Object.keys(bySpec).sort();
print('distinct specs: ' + hashes.length + '  (unreadable files skipped: ' + unreadable + ')');

var totalUnchecked = 0, totalHeadings = 0, totalExtracted = 0;
hashes.forEach(function (h) {
  var s = bySpec[h];
  var labels = Object.keys(s.labels);
  if (!labels.length) labels = [null]; // no headers in the spec -> whole-spec extraction
  print('\n== ' + h + '  ticket=' + s.ticketKey + '  runs=' + s.fileCount + '  specLen=' + s.text.length);
  labels.forEach(function (label) {
    var scoped = vdSpecScopeToVariant(s.text, label);
    var items = vdSpecRequirements(s.text, label);
    var cov = vdSpecCoverage(scoped, items);
    totalUnchecked += cov.uncheckedCount; totalHeadings += cov.headings.length; totalExtracted += items.length;
    print('  [' + (label || '(unlabeled)') + '] extracted=' + items.length
      + ' headings=' + cov.headings.length + ' unchecked=' + cov.uncheckedCount);
    cov.headings.forEach(function (hd) {
      if (!hd.lines) return; // heading with nothing under it is not interesting to review
      print('     - "' + hd.heading + '"  region=' + JSON.stringify(hd.region)
        + '  lines=' + hd.lines + ' extracted=' + hd.extracted + ' unchecked=' + hd.unchecked);
    });
    cov.unchecked.slice(0, 3).forEach(function (u) {
      print('     unchecked [' + (u.heading || '(no heading)') + ']: ' + u.text);
    });
  });
});

print('\n=== totals over ' + hashes.length + ' specs: ' + totalExtracted + ' extracted, '
  + totalHeadings + ' headings, ' + totalUnchecked + ' unchecked lines ===');
