// Matrix Auditor suite — forced-link composition.
//
//   RUN:  cd extension/tests && jsc matrix.test.js
//   (jsc ships with macOS at
//    /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
//    — add it to PATH or invoke by full path.)
//
// Slices the functions out of ../popup.js by marker string rather than copying
// them, same as every other suite here: a rename breaks this loudly instead of
// leaving it to test a stale duplicate.
//
// Why this suite exists — a measured failure, not a hypothetical. The Variation
// ID field is a free-text box that people paste lists into, and the composer
// ran a single encodeURIComponent over the whole field. Every separator became
// an escape, so what actually reached the address bar was:
//
//   "123,456"    ->  optimizely_x=123%2C456
//   "123, 456"   ->  optimizely_x=123%2C%20456
//   "123 456"    ->  optimizely_x=123%20456
//
// Optimizely reads each of those as ONE opaque id, which matches no variation —
// so the audit loaded the unforced page and every selector the variation was
// supposed to inject reported NOT FOUND. A false failure across the whole run,
// with nothing in the report pointing at the URL as the cause. The invariant
// below is therefore about the SEPARATOR, not the ids: the comma between ids
// must survive to the address bar as a literal comma.

var _pu = readFile('../popup.js');
function slicePopup(from, to) {
  var a = _pu.indexOf(from), b = _pu.indexOf(to, a + 1);
  if (a === -1 || b === -1) throw new Error('slice marker missing: ' + from);
  return _pu.slice(a, b);
}

eval(slicePopup('const MX_CRAWL_STRIP_PARAMS', 'function mxParseVariationIds('));
eval(slicePopup('function mxParseVariationIds(', 'function mxComposeUrl('));
eval(slicePopup('function mxComposeUrl(', 'function mxCurrentTargets('));

var passed = 0, failed = 0;
function eq(actual, expected, label) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  print('FAIL: ' + label + '\n  expected ' + e + '\n  actual   ' + a);
}
function ok(cond, label) { eq(!!cond, true, label); }

var BASE = 'https://example.com/page';
function forced(v) { return mxComposeUrl(BASE, 'forced', v); }

// ── mxParseVariationIds ─────────────────────────────────────────────────────
eq(mxParseVariationIds('5291718573031424'), ['5291718573031424'], 'single id');
eq(mxParseVariationIds('123,456'), ['123', '456'], 'comma-separated');
eq(mxParseVariationIds('123, 456'), ['123', '456'], 'comma + space');
eq(mxParseVariationIds('123 456'), ['123', '456'], 'space-separated');
eq(mxParseVariationIds('123;456'), ['123', '456'], 'semicolon-separated');
eq(mxParseVariationIds('123&456'), ['123', '456'], 'ampersand-separated');
eq(mxParseVariationIds('123|456'), ['123', '456'], 'pipe-separated');
eq(mxParseVariationIds('123\n456'), ['123', '456'], 'newline-separated');
eq(mxParseVariationIds('  123 ,, 456  '), ['123', '456'], 'stray whitespace and empty fields');
eq(mxParseVariationIds(''), [], 'empty string');
eq(mxParseVariationIds(null), [], 'null');
eq(mxParseVariationIds('  ,  ;  '), [], 'separators only');
eq(mxParseVariationIds('123,123,456'), ['123', '456'], 'dedupes, preserving first-seen order');

// Pasted fragments — the field is a text box and people paste what they copied.
eq(mxParseVariationIds('optimizely_x=123'), ['123'], 'bare key=value');
eq(mxParseVariationIds('?optimizely_x=123'), ['123'], 'leading ? stripped');
eq(mxParseVariationIds('&optimizely_x=123'), ['123'], 'leading & stripped');
eq(mxParseVariationIds('_conv_eforce=abc'), ['abc'], 'Convert forcing key');
eq(mxParseVariationIds('OPTIMIZELY_X=123'), ['123'], 'key match is case-insensitive');
eq(mxParseVariationIds('https://x.com/p?optimizely_x=123&cro_mode=qa'), ['123'],
   'full preview URL yields only the forced id');
eq(mxParseVariationIds('https://x.com/p?optimizely_x=123, https://x.com/q?optimizely_x=456'),
   ['123', '456'], 'two pasted preview URLs');
eq(mxParseVariationIds('https://x.com/page'), [],
   'a URL with no forcing param contributes nothing');
eq(mxParseVariationIds('cro_mode=qa'), [], 'some other key contributes nothing');
eq(mxParseVariationIds('a=1&optimizely_x=123&b=2'), ['123'],
   'only the forcing key survives a query string');

// ── mxComposeUrl, forced mode ───────────────────────────────────────────────
// The regression itself: the separator between ids reaches the address bar as
// a literal comma, and NOTHING in the composed URL is a percent escape.
eq(forced('123,456'),
   BASE + '?optimizely_x=123,456&optimizely_force_tracking=true&cro_mode=qa',
   'two ids compose to one comma-separated optimizely_x');
eq(forced('123, 456'), forced('123,456'), 'comma+space composes identically to comma');
eq(forced('123 456'),  forced('123,456'), 'space composes identically to comma');
eq(forced('123;456'),  forced('123,456'), 'semicolon composes identically to comma');

['123,456', '123, 456', '123 456', '123;456', '123|456', '123\n456'].forEach(function (raw) {
  ok(forced(raw).indexOf('%2C') === -1, 'no %2C for input ' + JSON.stringify(raw));
  ok(forced(raw).indexOf('%20') === -1, 'no %20 for input ' + JSON.stringify(raw));
});

eq(forced('5291718573031424'),
   BASE + '?optimizely_x=5291718573031424&optimizely_force_tracking=true&cro_mode=qa',
   'single id is unchanged by the list handling');

// Exactly one "?" in the composed URL, whatever went into the field — a pasted
// preview URL used to arrive as %3Foptimizely_x%3D123 inside the value.
['123', '?optimizely_x=123', 'https://x.com/p?optimizely_x=123&cro_mode=qa'].forEach(function (raw) {
  var u = forced(raw);
  eq(u.split('?').length - 1, 1, 'exactly one ? for input ' + JSON.stringify(raw));
  ok(u.indexOf('%3F') === -1 && u.indexOf('%3D') === -1,
     'no escaped ?/= for input ' + JSON.stringify(raw));
  ok(u.indexOf('optimizely_x=123&') !== -1, 'id extracted for input ' + JSON.stringify(raw));
});

// An id with a character that genuinely needs escaping still gets escaped —
// per-id encoding is not the same as no encoding.
eq(forced('a b'), forced('a,b'), 'a space is a separator, not part of an id');
eq(forced('a+b'), BASE + '?optimizely_x=a%2Bb&optimizely_force_tracking=true&cro_mode=qa',
   'a + inside a single id is still escaped');

// No ids: the empty optimizely_x is omitted rather than sent blank. The run
// guard in runMatrixAuditStart refuses to start in this state; the live link
// preview just shows what a link would actually look like.
eq(forced(''), BASE + '?optimizely_force_tracking=true&cro_mode=qa',
   'blank field omits optimizely_x entirely');
eq(forced('cro_mode=qa'), forced(''), 'a field with no usable id omits optimizely_x');

// ── mxComposeUrl, the other modes and param hygiene ─────────────────────────
eq(mxComposeUrl(BASE, 'none', '123'), BASE, 'none mode returns the URL as pasted');
eq(mxComposeUrl(BASE, 'itw', '123'), BASE + '?cro_mode=qa', 'itw mode stamps cro_mode only');
eq(mxComposeUrl('', 'forced', '123'), '', 'empty base URL stays empty');

// Params we own are stripped before re-stamping, so toggling a mode never
// stacks duplicates onto a URL the user pasted with its own forcing params.
eq(mxComposeUrl(BASE + '?optimizely_x=999&utm=keep', 'forced', '123,456'),
   BASE + '?utm=keep&optimizely_x=123,456&optimizely_force_tracking=true&cro_mode=qa',
   'an existing optimizely_x is replaced, a foreign param is kept');
eq(mxComposeUrl(BASE + '?cro_mode=qa', 'itw', ''), BASE + '?cro_mode=qa',
   'itw does not stack a second cro_mode');

// ═══════════════════════════════════════════════════════════════════════════
// Crawl mode — the Links panel's second source.
//
// The scoping rules are the whole risk surface here, and both directions of
// error are silent. Too broad and a "audit the /learn section" crawl walks the
// entire site, opening a tab per page until it hits the cap. Too narrow and it
// reports zero pages with nothing to say about why. Neither shows up as an
// error; both show up as a wrong number in the link count.
// ═══════════════════════════════════════════════════════════════════════════

// ── mxSplitUrl — the parser everything else is built on ─────────────────────
eq(mxSplitUrl('https://ex.com/learn/a?b=1#frag'),
   { origin: 'https://ex.com', path: '/learn/a', query: 'b=1' }, 'splits and drops the hash');
eq(mxSplitUrl('https://EX.com/Learn'), { origin: 'https://ex.com', path: '/Learn', query: '' },
   'host lowercased, path case preserved');
eq(mxSplitUrl('https://ex.com'), { origin: 'https://ex.com', path: '/', query: '' },
   'bare origin gets a root path');
eq(mxSplitUrl('mailto:a@b.com'), null, 'mailto is not a page');
eq(mxSplitUrl('javascript:void(0)'), null, 'javascript: is not a page');
eq(mxSplitUrl('tel:+15551234'), null, 'tel: is not a page');
eq(mxSplitUrl('/relative/path'), null, 'a relative path is not an absolute page URL');
eq(mxSplitUrl(''), null, 'empty is not a page');
eq(mxSplitUrl('ftp://ex.com/x'), null, 'non-http scheme is not a page');

// ── mxNormalizeCrawlUrl — the identity a crawl dedupes on ───────────────────
eq(mxNormalizeCrawlUrl('https://ex.com/learn/'), 'https://ex.com/learn',
   'trailing slash collapsed');
eq(mxNormalizeCrawlUrl('https://ex.com/'), 'https://ex.com/', 'root keeps its slash');
eq(mxNormalizeCrawlUrl('https://ex.com/a#top'), 'https://ex.com/a', 'hash dropped');
eq(mxNormalizeCrawlUrl('https://ex.com/a?utm_source=x&utm_medium=y'), 'https://ex.com/a',
   'campaign params dropped');
eq(mxNormalizeCrawlUrl('https://ex.com/a?gclid=1&fbclid=2&ref=3'), 'https://ex.com/a',
   'click ids and ref dropped');
eq(mxNormalizeCrawlUrl('https://ex.com/a?optimizely_x=999&cro_mode=qa'), 'https://ex.com/a',
   'a forcing param on a crawled link is NOT inherited — mxComposeUrl re-stamps it');
eq(mxNormalizeCrawlUrl('https://ex.com/a?page=2'), 'https://ex.com/a?page=2',
   'a meaningful param is kept');
eq(mxNormalizeCrawlUrl('https://ex.com/a?b=2&a=1'), mxNormalizeCrawlUrl('https://ex.com/a?a=1&b=2'),
   'param order does not create two identities');
eq(mxNormalizeCrawlUrl('https://ex.com/a?utm_source=x&page=2'), 'https://ex.com/a?page=2',
   'noise dropped, signal kept, in one pass');

['file.pdf', 'img.JPG', 'a/b.png', 'style.css', 'app.js', 'data.json', 'font.woff2',
 'clip.mp4', 'sheet.xlsx', 'feed.xml'].forEach(function (leaf) {
  eq(mxNormalizeCrawlUrl('https://ex.com/' + leaf), null, 'asset rejected: ' + leaf);
});
eq(mxNormalizeCrawlUrl('https://ex.com/pdf-guides'), 'https://ex.com/pdf-guides',
   'a page whose name merely contains an extension word is still a page');
eq(mxNormalizeCrawlUrl('https://ex.com/a.pdf?x=1'), null,
   'an asset with a query is still an asset');

// ── mxIsUnderBase — the scoping rule ────────────────────────────────────────
var B = 'https://ex.com/learn';
ok(mxIsUnderBase('https://ex.com/learn', B), 'the base page is in scope');
ok(mxIsUnderBase('https://ex.com/learn/a', B), 'a direct child is in scope');
ok(mxIsUnderBase('https://ex.com/learn/a/b/c', B), 'a deep descendant is in scope');
ok(!mxIsUnderBase('https://ex.com/learning', B),
   'THE prefix trap: /learning is NOT under /learn');
ok(!mxIsUnderBase('https://ex.com/learn-more', B), '/learn-more is not under /learn');
ok(!mxIsUnderBase('https://ex.com/about', B), 'a sibling section is out of scope');
ok(!mxIsUnderBase('https://other.com/learn/a', B), 'another origin is out of scope');
ok(!mxIsUnderBase('http://ex.com/learn/a', B), 'another scheme is a different origin');
ok(!mxIsUnderBase('https://sub.ex.com/learn/a', B), 'a subdomain is a different origin');
ok(mxIsUnderBase('https://ex.com/learn/', B), 'a trailing slash does not change scope');
ok(!mxIsUnderBase('mailto:a@b.com', B), 'a non-page is never in scope');

// A base with no path is a deliberate whole-origin crawl.
ok(mxIsUnderBase('https://ex.com/anything/at/all', 'https://ex.com/'), 'root base admits the origin');
ok(mxIsUnderBase('https://ex.com/anything', 'https://ex.com'), 'pathless base admits the origin');
ok(!mxIsUnderBase('https://other.com/x', 'https://ex.com/'), 'root base still respects the origin');

// ── mxCrawlGroup — sections, so the group chips are useful on arrival ───────
eq(mxCrawlGroup('https://ex.com/learn', B), 'root', 'the base page itself is root');
eq(mxCrawlGroup('https://ex.com/learn/security', B), 'security', 'first segment below the base');
eq(mxCrawlGroup('https://ex.com/learn/security/phishing', B), 'security',
   'deeper pages group under the same section');
eq(mxCrawlGroup('https://ex.com/blog/post', 'https://ex.com/'), 'blog',
   'with a root base the first path segment is the section');
eq(mxCrawlGroup('https://ex.com/', 'https://ex.com/'), 'root', 'the root page is root');

// ── mxCrawlAbsorb — one page's worth of state transition ────────────────────
function absorb(hrefs, opts) {
  var st = {
    baseUrl: B, depth: 0, maxDepth: 2, maxPages: 50,
    visited: new Set([B]), found: [{ url: B, group: 'root' }], queue: [],
  };
  for (var k in (opts || {})) st[k] = opts[k];
  mxCrawlAbsorb(hrefs, st);
  return st;
}

var st = absorb(['https://ex.com/learn/a', 'https://ex.com/learn/b', 'https://ex.com/about']);
eq(st.found.map(function (f) { return f.url; }),
   [B, 'https://ex.com/learn/a', 'https://ex.com/learn/b'],
   'in-scope links collected, out-of-scope dropped');
eq(st.queue.length, 2, 'both in-scope pages queued for the next depth');

st = absorb(['https://ex.com/learn/a', 'https://ex.com/learn/a/', 'https://ex.com/learn/a?utm_source=x',
             'https://ex.com/learn/a#top']);
eq(st.found.length, 2, 'four spellings of one page collapse to one target');

st = absorb(['https://ex.com/learn/a'], { depth: 1, maxDepth: 2 });
eq(st.found.length, 2, 'a page found at the depth limit is still collected');
eq(st.queue.length, 0, 'but it is NOT queued for scanning past the limit');

st = absorb(['https://ex.com/learn/a', 'https://ex.com/learn/b', 'https://ex.com/learn/c'],
            { maxPages: 2 });
eq(st.found.length, 2, 'the cap bounds what is collected');
eq(st.queue.length, 3, 'the walk itself is not truncated by the cap');

st = absorb(['mailto:a@b.com', 'javascript:void(0)', '#anchor', 'https://ex.com/learn/x.pdf', '']);
eq(st.found.length, 1, 'non-pages and assets never enter the queue');

st = absorb([B, 'https://ex.com/learn/'], {});
eq(st.found.length, 1, 'a self-link does not re-add the base');
eq(st.queue.length, 0, 'nor re-queue it');

eq(absorb(null).found.length, 1, 'a page that returned no hrefs is survivable');

print('=== ' + passed + ' passed, ' + failed + ' failed ===');
if (failed) throw new Error(failed + ' assertion(s) failed');
