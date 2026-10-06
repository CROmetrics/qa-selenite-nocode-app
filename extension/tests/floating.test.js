// Floating window suite — where the toolbar icon puts Selenite's window.
//
//   RUN:  cd extension/tests && jsc floating.test.js
//   (jsc ships with macOS at
//    /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
//    — add it to PATH or invoke by full path.)
//
// Slices floatDefaultBounds out of ../background.js by marker string rather
// than copying it, same as every other suite here: a rename breaks this loudly
// instead of leaving it to test a stale duplicate.
//
// Why it matters: the floating window replaced the docked side panel because
// the panel shrank the page's viewport. A floating window placed on top of the
// whole page, or off the browser window's edge, trades that problem for a
// worse one, so the default must hug the browser window's right edge, and a
// position the user chose must come back exactly as they left it.
//
// The real-Chrome run of this placement (system Chrome 154, extension loaded
// through Extensions.loadUnpacked) produced left 988 / top 136 / 440 x 780 for
// a 1400 x 900 browser window at 40,40 — the first case below.

var _bg = readFile('../background.js');
function sliceBackground(from, to) {
  var a = _bg.indexOf(from), b = _bg.indexOf(to, a + 1);
  if (a === -1 || b === -1) throw new Error('slice marker missing: ' + from);
  return _bg.slice(a, b);
}
eval(sliceBackground('function floatDefaultBounds(', "// browser window id -> its floating window's id"));

var passed = 0, failed = 0;
function eq(actual, expected, label) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  print('FAIL: ' + label + '\n  expected ' + e + '\n  actual   ' + a);
}
function ok(cond, label) { eq(!!cond, true, label); }

var BROWSER = { left: 40, top: 40, width: 1400, height: 900 };

// ── default placement ───────────────────────────────────────────────────────
eq(floatDefaultBounds(BROWSER, undefined), { left: 988, top: 136, width: 440, height: 780 },
   'no saved bounds: 440 wide against the right edge, below the toolbar (matches the real Chrome run)');
var d = floatDefaultBounds(BROWSER, null);
eq(d.left + d.width, BROWSER.left + BROWSER.width - 12, 'right edge sits 12px inside the browser window');
ok(d.left > BROWSER.left, 'starts inside the browser window, so it floats over the page');

// ── a narrow browser window ─────────────────────────────────────────────────
var narrow = floatDefaultBounds({ left: 100, top: 50, width: 300, height: 500 }, null);
eq(narrow.width, 320, 'never narrower than 320, even when the browser window is');
eq(narrow.left, 100, 'a window wider than the browser starts at its left edge, not left of it');
eq(narrow.height, 400, 'never shorter than 400');

// ── the user's own position ─────────────────────────────────────────────────
eq(floatDefaultBounds(BROWSER, { left: 5, top: 6, width: 500, height: 700 }),
   { left: 5, top: 6, width: 500, height: 700 }, 'saved bounds come back exactly');
eq(floatDefaultBounds(BROWSER, { left: 5, top: 6, width: 500, height: 700, state: 'normal' }),
   { left: 5, top: 6, width: 500, height: 700 }, 'only the four bounds pass through to windows.create');
eq(floatDefaultBounds(BROWSER, { left: 5, top: 6, width: 500 }), floatDefaultBounds(BROWSER, null),
   'incomplete saved bounds fall back to the default');
eq(floatDefaultBounds(BROWSER, { left: 5, top: 6, width: NaN, height: 700 }), floatDefaultBounds(BROWSER, null),
   'a non-numeric saved bound falls back to the default');

print('=== ' + passed + ' passed, ' + failed + ' failed ===');
if (failed) throw new Error(failed + ' assertion(s) failed');
