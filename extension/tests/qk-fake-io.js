// The fake `io` and the two synthetic sites of plan.md Appendix D (S3). A helper loaded with load() after
// ../qa-kit.js; it defines the global QK_FAKE and nothing else.
//
//   QK_FAKE.makeIo(site, opts)   an `io` honouring plan §3.1, plus: io.trace, io.visit, io.site, io.loads,
//                                io.debugLines, io.progressLog, io.stop()
//   QK_FAKE.sites.itw(opts)      the synthetic site (Appendix D). Both constructors build the same site, which
//   QK_FAKE.sites.resp(opts)     serves every path of D.2 (the real fixture site serves all of them too); `kind` differs.
//                                opts: base, seed {local, session, cookies}, weightEnd (variation weights end, default
//                                10000), holdback (campaign holdback, default 0), noSnippet, unsafeButton
//   QK_FAKE.parse(url)           {url, origin, path, query}
//   QK_FAKE.decodeCompose(url)   the layout JSON that io.compose encoded into its data URL
//
// makeIo opts: stopAfterLoads (checkStop throws {qkStop:true} once that many loads happened), failState / nullState
// (state() answers qkStateSummary(null), as if the page function had failed; true, or a function (args, n) -> bool),
// failFacts, failScan, failShot, nullCatalog, nullCompose, failLoad (array of paths, or a function(parsed) -> bool),
// seed (merged over the site's), start (clock), width (initial viewport, default 1440).
// io.trace records every call made on the io, in order: {op, role, url, width, keepState, selector}; now() and
// debug() are not traced (debug lines go to io.debugLines). Page functions are modelled, not run: nothing here
// touches a DOM, a network or a timer; sleep() only advances the virtual clock.
var QK_FAKE = (function () {
  'use strict';

  var BASE = 'http://127.0.0.1:8777';
  var DEFAULT_IGNORE = [
    'marquee', '[role="marquee"]', '[aria-roledescription="carousel" i]', '[aria-roledescription="slide" i]',
    '[class*="marquee" i]', '[class*="ticker" i]', '[class*="carousel" i]', '[class*="slider" i]', '[class*="swiper" i]',
    '[class*="slick" i]', '[class*="splide" i]', '[class*="glide" i]', '[class*="flickity" i]', '[class*="owl-" i]',
    '[class*="embla" i]', '[data-carousel]',
  ];
  var VH = 800;

  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function dec(s) { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { return String(s); } }
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  // ── URL ──────────────────────────────────────────────────────────────────
  function parse(url) {
    url = String(url == null ? '' : url);
    var m = /^(https?:\/\/[^\/?#]+)?([^?#]*)(?:\?([^#]*))?/i.exec(url) || [];
    var query = {};
    (m[3] || '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = dec(i < 0 ? kv : kv.slice(0, i)), v = i < 0 ? '' : dec(kv.slice(i + 1));
      if (!Object.prototype.hasOwnProperty.call(query, k)) query[k] = v;
    });
    return { url: url, origin: m[1] || '', path: m[2] || '/', query: query };
  }

  // ── Bytes (UTF-8) for io.compose ─────────────────────────────────────────
  function utf8(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00); }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  function unutf8(b) {
    var s = '';
    for (var i = 0; i < b.length;) {
      var c = b[i++], n = 0, cp = c;
      if (c >= 0xf0) { n = 3; cp = c & 7; } else if (c >= 0xe0) { n = 2; cp = c & 15; } else if (c >= 0xc0) { n = 1; cp = c & 31; }
      while (n-- > 0 && i < b.length) cp = (cp << 6) | (b[i++] & 63);
      if (cp >= 0x10000) { cp -= 0x10000; s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023)); } else s += String.fromCharCode(cp);
    }
    return s;
  }
  function decodeCompose(url) {
    var m = /^data:image\/jpeg;base64,([A-Za-z0-9+\/=]+)$/.exec(String(url || ''));
    if (!m) return null;
    var bytes = qkBase64Decode(m[1]);
    return bytes ? JSON.parse(unutf8(bytes)) : null;
  }

  // ── A tiny selector matcher (the shapes the scenarios use) ───────────────
  function balanced(sel) {
    var s = String(sel), depth = 0, br = 0, q = null;
    if (!norm(s)) return false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (q) { if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") q = ch;
      else if (ch === '[') br++;
      else if (ch === ']') { br--; if (br < 0) return false; }
      else if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth < 0) return false; }
    }
    return !q && br === 0 && depth === 0;
  }
  // node = {tag, id, classes[], attrs{}}
  function nodeMatches(sel, node) {
    sel = norm(sel);
    var m = /^\[([\w-]+)(?:([*^$~|]?=)"([^"]*)"(?:\s+i)?)?\]$/i.exec(sel);
    if (m) {
      var name = m[1].toLowerCase();
      var val = name === 'class' ? node.classes.join(' ') : (node.attrs && node.attrs[name] != null ? String(node.attrs[name]) : null);
      if (val == null) return false;
      if (!m[2]) return true;
      val = val.toLowerCase();
      var want = m[3].toLowerCase();
      if (m[2] === '*=') return val.indexOf(want) >= 0;
      if (m[2] === '=') return val === want;
      return false;
    }
    m = /^([a-z][a-z0-9]*)?(?:#([\w-]+))?((?:\.[\w-]+)*)$/i.exec(sel);
    if (!m || (!m[1] && !m[2] && !m[3])) return false;
    if (m[1] && m[1].toLowerCase() !== node.tag) return false;
    if (m[2] && m[2] !== node.id) return false;
    var cls = (m[3] || '').split('.').filter(Boolean);
    for (var i = 0; i < cls.length; i++) { if (node.classes.indexOf(cls[i]) < 0) return false; }
    return true;
  }
  function listMatches(list, node) {
    for (var i = 0; i < list.length; i++) { if (nodeMatches(list[i], node)) return true; }
    return false;
  }
  function labelOf(node) {
    var s = node.tag;
    if (node.id) s += '#' + node.id; else if (node.classes.length) s += '.' + node.classes.slice(0, 2).join('.');
    return s.slice(0, 80);
  }

  // ── The snippet's data (D.1) ─────────────────────────────────────────────
  function catalogFor(o) {
    var weightEnd = o.weightEnd != null ? o.weightEnd : 10000;
    var hold = o.holdback != null ? o.holdback : 0;
    var cond = function (name, value, negated) {
      var leaf = { type: 'query', name: name, value: value, match: 'exact' };
      return ['and', ['or', negated ? ['not', ['or', leaf]] : leaf]];
    };
    return {
      ok: true, platform: 'optimizely', projectId: 'qk-1', revision: '1',
      counts: { experiments: 3, audiences: 3, pages: 4, events: 0, campaigns: 3 },
      experiments: {
        '7001': {
          id: '7001', name: 'QK-1 Quiz test', audienceIds: ['and', 'aud-qa', 'aud-nometa', 'aud-noimpact'], audienceName: null,
          weightDistributions: [{ entityId: '7101', endOfRange: 5000 }, { entityId: '7102', endOfRange: weightEnd }],
          layerId: 'c71', allocationPolicy: null, variations: [{ id: '7101', name: 'v0: Control' }, { id: '7102', name: 'v1: Quiz' }],
        },
        '7201': {
          id: '7201', name: 'QK-2 Hero test', audienceIds: null, audienceName: null,
          weightDistributions: [{ entityId: '7301', endOfRange: 5000 }, { entityId: '7302', endOfRange: 10000 }],
          layerId: 'c72', allocationPolicy: null, variations: [{ id: '7301', name: 'v0: Control' }, { id: '7302', name: 'v1: Hero' }],
        },
        '7202': {
          id: '7202', name: 'QK-LIVE Banner', audienceIds: null, audienceName: null,
          weightDistributions: [{ entityId: '7401', endOfRange: 10000 }],
          layerId: 'c73', allocationPolicy: null, variations: [{ id: '7401', name: 'Banner' }],
        },
      },
      audiences: {
        'aud-qa': { id: 'aud-qa', name: 'QA param', conditions: cond('cro_mode', 'qa', false) },
        'aud-nometa': { id: 'aud-nometa', name: 'No Meta', conditions: cond('utm_source', 'meta', true) },
        'aud-noimpact': { id: 'aud-noimpact', name: 'No Impact', conditions: cond('utm_campaign', 'impact', true) },
      },
      pages: {
        p71: { id: 'p71', name: 'QK Quiz', apiName: 'qk_quiz', activationType: 'callback', hasActivationCode: true, staticConditions: null },
        p72: { id: 'p72', name: 'QK Landing', apiName: 'qk_landing', activationType: null, hasActivationCode: false, staticConditions: null },
        p74: { id: 'p74', name: 'QK Responsive', apiName: 'qk_resp', activationType: null, hasActivationCode: false, staticConditions: null },
        p75: { id: 'p75', name: 'QK Live', apiName: 'qk_live', activationType: null, hasActivationCode: false, staticConditions: null },
      },
      events: [],
      campaigns: {
        c71: { id: 'c71', name: 'QK-1', pageIds: ['p71', 'p72'], experimentIds: ['7001'], holdback: hold },
        c72: { id: 'c72', name: 'QK-2', pageIds: ['p74'], experimentIds: ['7201'], holdback: hold },
        c73: { id: 'c73', name: 'QK-LIVE', pageIds: ['p75'], experimentIds: ['7202'], holdback: hold },
      },
      visitorCustom: [], errors: [],
    };
  }

  // ── The site (D.2) ───────────────────────────────────────────────────────
  var TARGETED = ['/itw/', '/itw-bad/', '/itw-covered/', '/itw/step2/', '/landing/'];
  var TITLES = {
    '/itw/': 'QK Shop', '/itw-bad/': 'QK Shop', '/itw-covered/': 'QK Shop', '/itw/help/': 'QK Help', '/itw/step2/': 'QK Step 2',
    '/landing/': 'QK Landing', '/landing-ok/': 'QK Landing', '/seed/': 'QK Seed', '/resp/': 'QK Responsive', '/resp-live/': 'QK Responsive',
  };
  var VAR_NAMES = { '7101': 'v0: Control', '7102': 'v1: Quiz', '7301': 'v0: Control', '7302': 'v1: Hero', '7401': 'Banner' };

  function node(tag, id, classes) { return { tag: tag, id: id || null, classes: classes || [], attrs: {} }; }

  function makeSite(kind, o) {
    o = o || {};
    var base = String(o.base || BASE).replace(/\/+$/, '');
    var cat = catalogFor(o);
    var site = { kind: kind, base: base, seed: clone(o.seed) || null, log: [], beacons: { trusted: 0, untrusted: 0, overlay: 0 } };

    function eligible(q) { return q.cro_mode === 'qa' && q.utm_source !== 'meta'; } // utm_campaign is ignored: the deliberate bug
    function targeted(path) { return TARGETED.indexOf(path) >= 0; }
    function inactive() { return { isActive: false, variationId: null }; }

    function states(pg, visit) {
      var q = pg.query, local = visit.store.local, s = {};
      var fx = q.optimizely_x;
      s['7001'] = inactive();
      if ((fx === '7101' || fx === '7102') && targeted(pg.path)) s['7001'] = { isActive: true, variationId: fx };
      else if (pg.path === '/landing/' && eligible(q)) s['7001'] = { isActive: true, variationId: '7102' };
      else if (targeted(pg.path) && eligible(q) && (local.optimizely_qk_bucket_7001 != null || local.qk_quiz_progress != null)) {
        var st = local.optimizely_qk_bucket_7001;
        s['7001'] = { isActive: true, variationId: st === '7101' || st === '7102' ? st : '7102' };
      }
      s['7201'] = inactive();
      if ((fx === '7301' || fx === '7302') && (pg.path === '/resp/' || pg.path === '/resp-live/')) s['7201'] = { isActive: true, variationId: fx };
      s['7202'] = pg.path === '/resp-live/' ? { isActive: true, variationId: '7401' } : inactive();
      return s;
    }

    function pageNorm(p) { return /\/$/.test(p) || /\.[a-z0-9]+$/i.test(p) ? p : p + '/'; }

    // A page object: what the "browser" holds after a load. Its state is read live, so a click changes it.
    site.load = function (parsed, visit) {
      var path = pageNorm(parsed.path);
      var pg = { url: parsed.url, rawPath: parsed.path, path: path, query: parsed.query, blocked: null, states: null, els: [], clips: [], facts: null };
      site.log.push({ kind: 'load', url: parsed.url, path: parsed.path, query: parsed.query });
      var known = !!TITLES[path] || path === '/blocked/';
      var title = path === '/blocked/' ? 'Just a moment...' : (TITLES[path] || 'QK Not Found');
      var bad = path === '/itw-bad/' && parsed.query.cro_mode === 'qa';
      var banner = bad ? 1 : 0;
      if (path === '/seed/') visit.store.local.qk_quiz_progress = '1';
      if (path === '/blocked/') {
        pg.blocked = { reason: 'bot-check', signal: 'title: Just a moment...' };
        pg.facts = { title: title, href: parsed.url, canonical: null, textLen: 26, textHash: 'h-block', scrollHeight: 300,
          widgets: { chat: 0, banner: 0, modal: 0 }, bot: { challenge: true, signal: pg.blocked.signal } };
      } else {
        pg.facts = { title: title, href: parsed.url, canonical: known ? base + path : null, textLen: known ? (bad ? 1120 : 900) : 20,
          textHash: bad ? 'h-ribbon' : (known ? 'h-base' : 'h-404'), scrollHeight: known ? (bad ? 1320 : 1200) : 300,
          widgets: { chat: 0, banner: banner, modal: 0 }, bot: { challenge: false, signal: null } };
      }
      if (path === '/itw/' || path === '/itw-bad/' || path === '/itw-covered/') {
        pg.els.push({ node: node('header', null, []), text: 'QK Shop' });
        for (var i = 0; i < 10; i++) pg.els.push({ node: node('p', null, []), text: 'Plain copy ' + (i + 1) });
        pg.els.push({ node: node('button', 'start-quiz', []), text: 'Start quiz', onClick: 'start' });
        if (o.unsafeButton) pg.els.push({ node: node('button', 'buy-now', []), text: 'Buy now', unsafe: true });
        if (path === '/itw-covered/') pg.els.push({ node: node('div', 'cookie-wall', []), text: 'Accept cookies', onClick: 'overlay', cover: true });
        if (bad) pg.els.push({ node: node('div', null, ['promo-banner', 'qk-ribbon']), text: 'QA RIBBON' });
      }
      if (path === '/resp/' || path === '/resp-live/') {
        var v1 = parsed.query.optimizely_x === '7302';
        var hero = { text: 'CLIPPED-HERO Start your free trial', el: node('span', null, ['hero-line']), box: node('div', null, ['hero-box']), size: 396, y: 20 };
        var legal = { text: 'LEGAL-LINE Terms apply', el: node('span', null, ['legal']), box: node('div', null, ['legal-box']), size: 330, y: 520 };
        var car = { text: 'CAROUSEL-TRACK slide one slide two slide three', el: node('div', null, ['carousel-track']), box: node('div', null, ['carousel-box']), size: 620, y: 560 };
        pg.clips = (v1 ? [hero] : []).concat([legal, car]);
      }
      pg.states = states(pg, visit);
      return pg;
    };

    site.rawState = function (pg, args) {
      if (o.noSnippet) return { ok: true, platform: null };
      args = args || {};
      var exps = cat.experiments, expIds = Object.keys(exps);
      var activeIds = expIds.filter(function (id) { return pg.states[id] && pg.states[id].isActive === true; });
      var expId = args.experimentId != null && String(args.experimentId) !== '' ? String(args.experimentId) : null;
      var source = expId ? 'given' : null;
      var forced = (args.forcedIds || []).map(String);
      if (!expId && forced.length) {
        expIds.forEach(function (id) {
          if (expId) return;
          if (exps[id].variations.some(function (v) { return forced.indexOf(v.id) >= 0; })) { expId = id; source = 'forced-variation'; }
        });
      }
      var out = { ok: true, platform: 'optimizely', experimentId: expId, source: source, inData: false, inState: false, isActive: null,
        variationId: null, variationName: null, reason: null, pageIds: [], pageTypes: [], variationIds: [], activeIds: activeIds, errors: [] };
      if (!expId) return out;
      var def = exps[expId] || null;
      out.inData = !!def;
      if (def) {
        out.variationIds = def.variations.map(function (v) { return v.id; });
        var camp = cat.campaigns[def.layerId] || null;
        (camp ? camp.pageIds : []).forEach(function (pid) {
          var p = cat.pages[pid];
          out.pageIds.push(pid);
          out.pageTypes.push(p ? (p.activationType == null ? 'immediate' : String(p.activationType)) : null);
        });
      }
      var st = pg.states[expId] || null;
      out.inState = !!st;
      if (st) {
        out.isActive = st.isActive;
        out.variationId = st.variationId;
        out.variationName = st.variationId ? (VAR_NAMES[st.variationId] || null) : null;
      } else out.isActive = def ? false : null;
      return out;
    };

    site.catalog = function () { return o.noSnippet ? { ok: true, platform: null } : clone(cat); };

    site.scan = function (pg, width, ignoreList) {
      var ignore = DEFAULT_IGNORE, invalid = [];
      if (typeof QK_IGNORE_DEFAULTS !== 'undefined' && QK_IGNORE_DEFAULTS && QK_IGNORE_DEFAULTS.length) ignore = QK_IGNORE_DEFAULTS;
      if (Array.isArray(ignoreList)) {
        ignore = [];
        ignoreList.forEach(function (s) {
          s = norm(s);
          if (!s) return;
          if (balanced(s)) ignore.push(s); else invalid.push(s.slice(0, 120));
        });
      }
      var ignored = { carousel: 0, ellipsis: 0, srOnly: 0, offCanvas: 0, hidden: 0 }, offenders = [];
      pg.clips.forEach(function (c) {
        var gap = width - c.size;
        if (!(gap < -2)) return;
        if (listMatches(ignore, c.el) || listMatches(ignore, c.box)) { ignored.carousel++; return; }
        offenders.push({ text: c.text.slice(0, 80), gapPx: gap, side: 'right', by: 'overflow', clipBy: labelOf(c.box), el: labelOf(c.el),
          rect: { x: 0, y: c.y, w: c.size, h: 22 } });
      });
      offenders.sort(function (a, b) { return a.gapPx - b.gapPx; });
      return { vw: width, iw: width, sw: width, pageOverflowPx: 0, dpr: 1, nodes: 40, truncated: false, offenderCount: offenders.length,
        worstGapPx: offenders.length ? offenders[0].gapPx : 0, offenders: offenders.slice(0, 25), ignored: ignored, ignoreInvalid: invalid, ms: 12 };
    };

    site.mark = function (pg, text, y, width) {
      var want = norm(text).slice(0, 40);
      for (var i = 0; want && i < pg.clips.length; i++) {
        if (norm(pg.clips[i].text).indexOf(want) === 0) {
          return { found: true, rect: { x: 0, y: Math.round(VH / 2 - 11), w: pg.clips[i].size, h: 22 }, vw: width, vh: VH };
        }
      }
      return { found: false, rect: { x: 0, y: Math.max(0, Math.round(y || 0)), w: 0, h: 0 }, vw: width, vh: VH };
    };

    site.click = function (pg, visit, selector) {
      var sel = String(selector == null ? '' : selector);
      if (!balanced(sel)) return { ok: false, reason: 'bad-selector', error: 'not a valid selector' };
      var hits = pg.els.filter(function (e) {
        return sel.split(',').some(function (part) { return nodeMatches(part, e.node); });
      });
      if (!hits.length) return { ok: false, reason: 'not-found', matches: 0 };
      var el = hits[0];
      var wall = pg.els.filter(function (e) { return e.cover; })[0] || null;
      if (el.unsafe) return { ok: false, reason: 'unsafe', why: 'its text reads "' + el.text + '"', matches: hits.length, label: labelOf(el.node) };
      if (wall && el !== wall) return { ok: false, reason: 'covered', matches: hits.length, label: labelOf(el.node), coveredBy: labelOf(wall.node) };
      if (el.onClick === 'start') {
        // the handler always beacons; a trusted click on a targeted page for an eligible visitor activates 7001 at once
        site.log.push({ kind: 'beacon', url: base + '/beacon?hit=trigger&trusted=1', path: '/beacon', query: { hit: 'trigger', trusted: '1' }, hit: 'trigger', trusted: true });
        site.beacons.trusted++;
        if (targeted(pg.path) && eligible(pg.query)) {
          visit.store.local.optimizely_qk_bucket_7001 = '7102';
          visit.store.local.qk_quiz_progress = '1';
          pg.states['7001'] = { isActive: true, variationId: '7102' };
        }
      } else if (el.onClick === 'overlay') {
        site.log.push({ kind: 'beacon', url: base + '/beacon?hit=overlay', path: '/beacon', query: { hit: 'overlay' }, hit: 'overlay', trusted: true });
        site.beacons.overlay++;
      }
      return { ok: true, x: 440, y: 420, matches: hits.length, label: labelOf(el.node), rect: { x: 380, y: 400, w: 120, h: 40 },
        navigated: false, final: null, blocked: null };
    };

    // request helpers for assertions
    site.requestsTo = function (path) { return site.log.filter(function (r) { return r.kind === 'load' && r.path === path; }); };
    site.loadsLog = function () { return site.log.filter(function (r) { return r.kind === 'load'; }); };
    return site;
  }

  // ── The io ───────────────────────────────────────────────────────────────
  function makeIo(site, opts) {
    opts = opts || {};
    var visit = { store: { local: {}, session: {}, cookies: {} } };
    [site.seed, opts.seed].forEach(function (sd) {
      if (!sd) return;
      ['local', 'session', 'cookies'].forEach(function (k) { Object.keys(sd[k] || {}).forEach(function (n) { visit.store[k][n] = String(sd[k][n]); }); });
    });
    var clock = opts.start != null ? opts.start : 1700000000000;
    var width = opts.width != null ? opts.width : 1440;
    var nLoads = 0, nState = 0, pg = null, curL = null, catalogCache, stopped = false;
    var io = { trace: [], visit: visit, site: site, loads: [], debugLines: [], progressLog: [] };

    function note(op, extra) {
      var e = { op: op, role: curL ? curL.role : null, url: curL ? curL.url : null, width: width, keepState: curL ? !!curL.keepState : false, selector: null };
      if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
      io.trace.push(e);
    }
    function check() {
      if (stopped || (opts.stopAfterLoads != null && nLoads >= opts.stopAfterLoads)) throw { qkStop: true };
    }
    function flag(v, a, n) { return typeof v === 'function' ? !!v(a, n) : !!v; }
    function hit(name, patterns) { return /^optimizely/i.test(name) || qkKeyMatches(name, patterns); }

    // D6: a clean load removes optimizely* and app-pattern keys from all three stores and names them, as the shim does.
    function hygiene(patterns) {
      var A = qkCleanPatterns(patterns), out = [];
      ['local', 'session'].forEach(function (label) {
        var st = visit.store[label];
        Object.keys(st).forEach(function (k) { if (hit(k, A)) { delete st[k]; out.push(label + ':' + k); } });
      });
      Object.keys(visit.store.cookies).forEach(function (n) {
        if (/^(optimizely|_conv_)/i.test(n) || hit(n, A)) { delete visit.store.cookies[n]; out.push('cookie:' + n); }
      });
      return out.slice(0, 100);
    }

    io.now = function () { return clock; };
    io.checkStop = function () { note('checkStop'); check(); };
    io.stop = function () { stopped = true; };
    io.sleep = async function (ms) { note('sleep'); check(); clock += Math.max(0, Number(ms) || 0); };
    io.debug = function (level, text) { io.debugLines.push({ level: level, text: String(text) }); };
    io.progress = async function (p) { note('progress'); check(); io.progressLog.push(clone(p)); };

    io.load = async function (spec) {
      spec = spec || {};
      note('load', { role: spec.role == null ? null : spec.role, url: String(spec.url == null ? '' : spec.url),
        width: spec.width != null ? spec.width : width, keepState: !!spec.keepState });
      check();
      var L = qkNewLoad(spec, ++nLoads);
      if (spec.width != null) width = spec.width;
      if (!spec.keepState) L.cleared = hygiene(spec.appKeys);
      var parsed = parse(spec.url);
      var fail = o_failLoad(parsed);
      clock += 120;
      L.ms = 120;
      curL = L;
      if (fail) {
        site.log.push({ kind: 'load', url: parsed.url, path: parsed.path, query: parsed.query });
        pg = null;
        L.ok = false;
        L.loadError = 'net::ERR_FAKE_FAILURE';
      } else {
        pg = site.load(parsed, visit);
        L.ok = true;
        L.final = L.path;
        L.settle = { stable: true, polls: 2 };
        if (pg.blocked) L.blocked = clone(pg.blocked);
      }
      io.loads.push(L);
      return L;
    };
    function o_failLoad(parsed) {
      var f = opts.failLoad;
      if (!f) return false;
      if (typeof f === 'function') return !!f(parsed);
      return Array.isArray(f) && f.indexOf(parsed.path) >= 0;
    }

    io.state = async function (args) {
      note('state');
      check();
      args = args || {};
      nState++;
      if (flag(opts.nullState, args, nState) || flag(opts.failState, args, nState) || !pg) return qkStateSummary(null);
      return qkStateSummary(site.rawState(pg, args), args.forcedIds);
    };
    io.facts = async function () {
      note('facts');
      check();
      clock += 1500;
      if (!pg) return { error: 'no page is loaded' };
      if (opts.failFacts) return { error: 'the page script failed (fake)' };
      return clone(pg.facts);
    };
    io.catalog = async function () {
      note('catalog');
      check();
      if (catalogCache !== undefined) return catalogCache;
      if (!pg) return null;
      catalogCache = opts.nullCatalog ? null : site.catalog();
      return catalogCache;
    };
    io.click = async function (selector) {
      note('click', { selector: String(selector == null ? '' : selector) });
      check();
      if (!pg) return { ok: false, reason: 'error', error: 'no page is loaded' };
      var r = site.click(pg, visit, selector);
      if (r.ok) clock += 1200;
      return r;
    };
    io.storageNames = async function (patterns) {
      note('storageNames');
      check();
      if (!pg) return { error: 'no page is loaded' };
      var A = qkCleanPatterns(patterns);
      var names = function (st) { return Object.keys(st).filter(function (k) { return hit(k, A); }).slice(0, 100); };
      return { local: names(visit.store.local), session: names(visit.store.session), cookies: names(visit.store.cookies) };
    };
    io.viewport = async function (w) { note('viewport'); check(); width = Number(w) || width; clock += 400; };
    io.scan = async function (o) {
      note('scan');
      check();
      clock += 1500;
      if (!pg) return { error: 'no page is loaded' };
      if (opts.failScan) return { error: 'the page script failed (fake)' };
      return site.scan(pg, width, o && o.ignoreList);
    };
    io.shot = async function (o) {
      note('shot');
      check();
      if (!pg) return { error: 'no page is loaded' };
      if (opts.failShot) return { error: 'the capture failed (fake)' };
      clock += 150;
      return { data: 'AAAA', mark: site.mark(pg, o && o.text, o && o.y, width) };
    };
    io.compose = async function (layout) {
      note('compose');
      check();
      if (opts.nullCompose) return null;
      return 'data:image/jpeg;base64,' + qkBase64(utf8(JSON.stringify(layout)));
    };
    return io;
  }

  return {
    base: BASE,
    parse: parse,
    makeIo: makeIo,
    decodeCompose: decodeCompose,
    sites: {
      itw: function (o) { return makeSite('itw', o); },
      resp: function (o) { return makeSite('resp', o); },
    },
  };
})();
