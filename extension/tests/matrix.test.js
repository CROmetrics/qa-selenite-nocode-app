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

// Disjoint regions, in file order. Each ends at the next region's first line,
// so a function landing between two markers cannot be silently evaluated twice
// (or missed) — getting this wrong once already duplicated the whole sitemap
// block across two evals.
eval(slicePopup('const MX_CRAWL_STRIP_PARAMS', 'function mxCrawlBaseRedirect('));
eval(slicePopup('function mxCrawlBaseRedirect(', 'const MX_SITEMAP_PROBE_BATCH'));
eval(slicePopup('const MX_SITEMAP_PROBE_BATCH', '// \u2500\u2500 Forced-variation ids'));
eval(slicePopup('function mxParseVariationIds(', 'function mxComposeUrl('));
eval(slicePopup('function mxComposeUrl(', 'function mxCurrentTargets('));

// Real bytes, captured 2026-09-10 from www.imperva.com — see the fixture file's
// own _source / _whyThisMatters keys. Hand-written sitemap fixtures agree with
// whatever the parser already does; these did not. The modal image:loc
// assertion below is one no invented fixture would ever have contained.
var FX = JSON.parse(readFile('fixtures-real-sitemaps.json'));

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

// ── mxCrawlBaseRedirect — the imperva.com field failure ─────────────────────
// Measured, not imagined. A crawl of https://www.imperva.com/products/ reported
// 33 pages against a manual pass that found 43. Loading that base in a real
// browser shows it 301s to /learn/application-security/cyber-security/, and
// running the scoping rules over THAT page's 384 anchors yields exactly 32
// in-scope /products/ links — 32 + the base = the 33 that were reported. The
// crawl had scanned an unrelated article and harvested its global nav, and both
// the status line and the report cover still said it had crawled the base.
eq(mxCrawlBaseRedirect('https://www.imperva.com/products/',
                       'https://www.imperva.com/learn/application-security/cyber-security/'),
   { from: 'https://www.imperva.com/products',
     to:   'https://www.imperva.com/learn/application-security/cyber-security',
     outsideBase: true },
   'the imperva field case is reported, and flagged as outside the base');

eq(mxCrawlBaseRedirect('https://ex.com/learn/', 'https://ex.com/learn'), null,
   'a trailing-slash-only difference is not a redirect worth reporting');
eq(mxCrawlBaseRedirect('https://ex.com/learn', 'https://ex.com/learn?utm_source=x'), null,
   'a campaign param added by the redirect is not a redirect worth reporting');
eq(mxCrawlBaseRedirect('https://ex.com/learn', 'https://ex.com/learn/start'),
   { from: 'https://ex.com/learn', to: 'https://ex.com/learn/start', outsideBase: false },
   'a redirect that stays under the base is reported but NOT flagged');
eq(mxCrawlBaseRedirect('https://ex.com/learn', 'https://ex.com/about'),
   { from: 'https://ex.com/learn', to: 'https://ex.com/about', outsideBase: true },
   'a redirect to a sibling section is flagged');
eq(mxCrawlBaseRedirect('https://www.ex.com/learn', 'https://ex.com/learn'),
   { from: 'https://www.ex.com/learn', to: 'https://ex.com/learn', outsideBase: true },
   'a www -> apex canonical redirect is a different origin, so it IS flagged');
eq(mxCrawlBaseRedirect('https://ex.com/learn', ''), null, 'no final URL, nothing to report');
eq(mxCrawlBaseRedirect('https://ex.com/learn', 'about:blank'), null, 'a non-page final URL is not reported');

// ═══════════════════════════════════════════════════════════════════════════
// Sitemap discovery — driven by the REAL bytes in fixtures-real-sitemaps.json.
//
// The field case: a crawl of https://www.imperva.com/products/ found 33 pages
// where a manual pass found 43. Link-walking a nav finds a section's top level,
// never its depth — 17 of the sitemap's 41 pages are /products/data-security/*
// subpages that appear in no nav.
// ═══════════════════════════════════════════════════════════════════════════

var IMP = 'https://www.imperva.com/products/';

// ── robots.txt ──────────────────────────────────────────────────────────────
var smaps = mxParseRobotsSitemaps(FX.robots, 'https://www.imperva.com/');
eq(smaps.length, 21, 'all 21 Sitemap: lines parsed out of the real robots.txt');
ok(smaps.indexOf('https://www.imperva.com/products/sitemap_index.xml') !== -1,
   'the products sitemap is among them');

// THE load-bearing assertion of the whole feature: 21 declared sitemaps, and the
// one describing this base has to sort first or discovery fetches the wrong file.
eq(mxRankSitemaps(smaps, IMP)[0], 'https://www.imperva.com/products/sitemap_index.xml',
   'ranking puts the products sitemap first for a /products/ base');
eq(mxRankSitemaps(smaps, 'https://www.imperva.com/blog/')[0],
   'https://www.imperva.com/blog/sitemap_index.xml',
   'and the blog sitemap first for a /blog/ base — the rule is the base, not a hard-coded name');

eq(mxParseRobotsSitemaps('SITEMAP: https://e.com/a.xml', 'https://e.com/'),
   ['https://e.com/a.xml'], 'the key is case-insensitive');
eq(mxParseRobotsSitemaps('Sitemap: /rel.xml', 'https://e.com/'),
   ['https://e.com/rel.xml'], 'a root-relative sitemap resolves against the origin');
eq(mxParseRobotsSitemaps('Sitemap: https://e.com/a.xml # main', 'https://e.com/'),
   ['https://e.com/a.xml'], 'a trailing comment is stripped');
eq(mxParseRobotsSitemaps('Sitemap:\nDisallow:\nUser-agent: *', 'https://e.com/'), [],
   'valueless lines, including a bare Disallow:, yield nothing');
eq(mxParseRobotsSitemaps('Sitemap: https://e.com/a.xml\nSitemap: https://e.com/a.xml', 'https://e.com/'),
   ['https://e.com/a.xml'], 'duplicates collapse');

// ── kind detection ──────────────────────────────────────────────────────────
eq(mxSitemapKind(FX.sitemapIndex), 'index', 'the real index is an index');
eq(mxSitemapKind(FX.pageSitemap), 'urlset', 'the real page sitemap is a urlset');
eq(mxSitemapKind(''), 'empty', 'an empty body is empty');

// A 200 whose body is HTML must NOT read as an empty sitemap. Bot interstitials
// are exactly this shape, and "0 pages found" instead of "that was not XML" is
// the silent failure this feature exists to remove.
eq(mxSitemapKind(FX.htmlWhereXmlExpected), 'html',
   'a real HTML body where XML was expected is html, NOT empty');
eq(mxSitemapKind('\x1f\x8bmore'), 'binary', 'a gzip body is binary, not empty');
eq(mxParseSitemapXml(FX.htmlWhereXmlExpected).entries.length, 0,
   'and it yields no entries rather than a partial list');

// ── sitemap parsing ─────────────────────────────────────────────────────────
var idx = mxParseSitemapXml(FX.sitemapIndex);
eq(idx.kind, 'index', 'index kind');
eq(idx.entries, ['https://www.imperva.com/products/page-sitemap.xml',
                 'https://www.imperva.com/products/modal-sitemap.xml'],
   'both child sitemaps, in order');

var pg = mxParseSitemapXml(FX.pageSitemap);
eq(pg.kind, 'urlset', 'page sitemap kind');
eq(pg.entries.length, 41, '41 pages — the number the manual pass arrived at');

// The catch that only real bytes produced. modal-sitemap.xml has EIGHT <url>
// entries but NINE <loc> matches: cds-demo-popup carries a nested
// <image:image><image:loc>…Group-2554.svg</image:loc></image:image>. A <loc>
// regex that allows any namespace prefix hands that SVG to the auditor as a page.
var md = mxParseSitemapXml(FX.modalSitemap);
eq(md.entries.length, 8, 'modal sitemap yields 8 pages, not 9 — image:loc is not a page');
ok(md.entries.every(function (u) { return u.indexOf('.svg') === -1; }),
   'no asset URL survives from a media subtree');
eq(FX.modalSitemap.indexOf('<image:loc>') !== -1, true,
   'guard: the fixture really does contain the image:loc that makes this test mean something');

eq(mxParseSitemapXml('<urlset><loc>https://e.com/a?x=1&amp;y=2</loc></urlset>').entries,
   ['https://e.com/a?x=1&y=2'], '&amp; is decoded — sitemaps always escape it');
eq(mxParseSitemapXml('<urlset><loc><![CDATA[https://e.com/a]]></loc></urlset>').entries,
   ['https://e.com/a'], 'CDATA is unwrapped');
eq(mxParseSitemapXml('<urlset xmlns:sm="x"><sm:loc>https://e.com/a</sm:loc></urlset>').entries,
   ['https://e.com/a'], 'a namespaced loc on the sitemap itself still counts');
eq(mxParseSitemapXml('<urlset></urlset>').entries, [], 'an empty urlset is empty, not an error');

// ── scoping the entries ─────────────────────────────────────────────────────
var cand = mxSitemapCandidates(pg.entries, IMP);
eq(cand.inScope.length, 41, 'all 41 real pages are under the base');
// 17 pages in the data-security group: the section index plus 16 pages beneath
// it. The nav-only crawl saw 9 of these; the sitemap is where the rest live.
eq(cand.inScope.filter(function (l) { return l.group === 'data-security'; }).length,
   17, 'the data-security group holds 17 pages a nav crawl could not reach');
eq(cand.inScope.filter(function (l) { return l.url.indexOf('/products/data-security/') !== -1; }).length,
   16, '16 of those sit BENEATH the section index, which normalizes without its slash');

var modalCand = mxSitemapCandidates(md.entries, IMP);
eq(modalCand.inScope.length, 8, 'modal pages ARE under /products/ — ranking cannot exclude them');
ok(modalCand.inScope.every(function (l) { return l.group === 'modal'; }),
   'they all group as "modal", which is how a user excludes them in one click');

eq(mxSitemapCandidates(['https://www.imperva.com/blog/x'], IMP).outOfScope.length, 1,
   'an out-of-base entry is reported, not silently dropped');
// Assets are rejected outright. /feed/ is NOT — it is a path, not an extension,
// and a site may legitimately have a page there. It survives as its own `feed`
// group instead, which is the same one-click exclusion the modal pages get.
// Deliberately not hard-coded into mxNormalizeCrawlUrl: that function means "is
// this a page", ~20 assertions rest on it, and guessing there is what this
// feature is trying to stop doing.
var noise = mxSitemapCandidates(['https://www.imperva.com/products/a.pdf',
                                 'https://www.imperva.com/products/feed/'], IMP);
eq(noise.inScope.map(function (l) { return l.group; }), ['feed'],
   'the asset is dropped; /feed/ survives as an excludable group');

// ── the sitemap URL bypass ──────────────────────────────────────────────────
// Two halves of one invariant: sitemaps survive normalization, pages still do not.
eq(mxNormalizeSitemapUrl('https://e.com/sitemap.xml'), 'https://e.com/sitemap.xml',
   'a sitemap URL survives normalization');
eq(mxNormalizeCrawlUrl('https://e.com/sitemap.xml'), null,
   'while the PAGE rule still rejects .xml — the bypass is a separate path, not a loosening');

// ── merge ───────────────────────────────────────────────────────────────────
var mg = mxMergeDiscovery({
  sitemap: [{ url: 'https://e.com/p/a', group: 'a' }, { url: 'https://e.com/p/b', group: 'b' }],
  crawl:   [{ url: 'https://e.com/p/b', group: 'b' }, { url: 'https://e.com/p/c', group: 'c' }],
  baseUrl: 'https://e.com/p',
});
eq(mg.merged.length, 3, 'union, deduped');
eq(mg.onlyCrawl, ['https://e.com/p/c'],
   'onlyCrawl is the diagnostic: it is how you learn the sitemap is incomplete');
eq(mg.onlySitemap, ['https://e.com/p/a'], 'and onlySitemap the reverse');

// ── verdicts ────────────────────────────────────────────────────────────────
function verdict(probe) { return mxResolveVerdict('https://e.com/p/a', probe, 'https://e.com/p').verdict; }
eq(verdict({ status: 200, finalUrl: 'https://e.com/p/a' }), 'self', '200 to itself');
eq(verdict({ status: 200, finalUrl: 'https://e.com/p/a/' }), 'self', 'a trailing slash is still itself');
eq(verdict({ status: 200, finalUrl: 'https://e.com/p/b' }), 'redirect-in', 'redirect inside the base');
eq(verdict({ status: 200, finalUrl: 'https://e.com/other' }), 'redirect-out', 'redirect outside it');
eq(verdict({ status: 404, finalUrl: 'https://e.com/p/a' }), 'gone', '404');
eq(verdict({ status: 403, finalUrl: '' }), 'blocked', '403');
eq(verdict({ status: 200, finalUrl: 'https://e.com/p/a', prefix: 'Pardon Our Interruption' }),
   'blocked', 'a challenge body is blocked even on a 200');
eq(verdict({ error: 'network' }), 'error', 'a network failure');

// The asymmetry, stated as a test: an unverifiable URL is KEPT, and only a
// positively-disproved one is dropped. Dropping on a failed check would be the
// original under-counting bug in a new place.
var applied = mxApplyResolutions(
  [{ url: 'https://e.com/p/keep', group: 'p' }, { url: 'https://e.com/p/blocked', group: 'p' },
   { url: 'https://e.com/p/err', group: 'p' },  { url: 'https://e.com/p/away', group: 'p' },
   { url: 'https://e.com/p/dead', group: 'p' }],
  [{ url: 'https://e.com/p/keep', verdict: 'self', finalUrl: 'https://e.com/p/keep' },
   { url: 'https://e.com/p/blocked', verdict: 'blocked', finalUrl: '' },
   { url: 'https://e.com/p/err', verdict: 'error', finalUrl: '' },
   { url: 'https://e.com/p/away', verdict: 'redirect-out', finalUrl: 'https://e.com/gone' },
   { url: 'https://e.com/p/dead', verdict: 'gone', finalUrl: '', status: 404 }],
  'https://e.com/p');
eq(applied.links.map(function (l) { return l.url; }),
   ['https://e.com/p/keep', 'https://e.com/p/blocked', 'https://e.com/p/err'],
   'blocked and error are KEPT; only redirect-out and gone are dropped');
eq(applied.dropped.length, 2, 'and the dropped ones are listed by name, never silently');

// redirect-in must replace and re-dedupe, or two spellings of one page survive.
var collapsed = mxApplyResolutions(
  [{ url: 'https://e.com/p/a', group: 'p' }, { url: 'https://e.com/p/old', group: 'p' }],
  [{ url: 'https://e.com/p/a', verdict: 'self', finalUrl: 'https://e.com/p/a' },
   { url: 'https://e.com/p/old', verdict: 'redirect-in', finalUrl: 'https://e.com/p/a' }],
  'https://e.com/p');
eq(collapsed.links.length, 1, 'a redirect onto an existing page collapses instead of duplicating');

// Merge order is load-bearing for the page cap, which is why the driver caps
// AFTER verification rather than before. Sitemap entries come first, so a cap
// applied to the raw merge cuts precisely the link-only findings the
// cross-check exists to contribute — measured in the browser as "4 only from
// links" reported while none of the four survived into the list.
var ordered = mxMergeDiscovery({
  sitemap: [{ url: 'https://e.com/p/s1', group: 'p' }, { url: 'https://e.com/p/s2', group: 'p' }],
  crawl:   [{ url: 'https://e.com/p/only-from-links', group: 'p' }],
  baseUrl: 'https://e.com/p',
}).merged;
eq(ordered[ordered.length - 1].url, 'https://e.com/p/only-from-links',
   'the cross-check findings sit LAST, so any cap applied before verification eats them first');

eq(mxBatchSlices([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]], 'batching');
eq(mxBatchSlices([], 4), [], 'batching nothing');

// ── end to end, on the real bytes ───────────────────────────────────────────
// robots -> rank -> index -> children -> candidates, exactly as the driver runs it.
var chosen = mxRankSitemaps(mxParseRobotsSitemaps(FX.robots, 'https://www.imperva.com/'), IMP)[0];
eq(chosen, 'https://www.imperva.com/products/sitemap_index.xml', 'step 1: pick the sitemap');
var children = mxParseSitemapXml(FX.sitemapIndex).entries;
eq(children.length, 2, 'step 2: two children');
var all = [].concat(mxParseSitemapXml(FX.pageSitemap).entries,
                    mxParseSitemapXml(FX.modalSitemap).entries);
var final = mxSitemapCandidates(all, IMP);
eq(final.inScope.length, 49, 'step 3: 41 pages + 8 modals, and the SVG is not among them');
eq(final.inScope.filter(function (l) { return l.group !== 'modal'; }).length, 41,
   'excluding the modal group leaves exactly the 41 the manual pass counted');

print('=== ' + passed + ' passed, ' + failed + ' failed ===');
if (failed) throw new Error(failed + ' assertion(s) failed');
