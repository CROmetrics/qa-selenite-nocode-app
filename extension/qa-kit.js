// qa-kit.js — the shared kit of the Test Agent modes that run on a live page through the run tab's debugger
// (ITW Activation, Responsiveness, and the modes that follow). Shared by background.js (importScripts) and both panels
// (<script src> before popup.js). Classic script, no module syntax. This part is the pure layer: constants, URL
// helpers, masking, analysis, rows, tables and CSV, the debug feed, run helpers. Nothing here touches chrome.* or the
// DOM outside a qk*Fn page function.
//
// Naming (three loading contexts, one global scope each):
//   qk* / QK_*  defined only here
//   qkw*        defined only in background.js (the worker side)
//   qkUi*       defined only in popup.js (the panel side)
// A top-level qkX in background.js would silently overwrite the global of the same name from this file.
//
// The `io` contract: a mode's engine never touches the browser itself. The worker hands it an `io` object (now,
// checkStop, sleep, debug, progress, load, state, facts, catalog, click, storageNames, viewport, scan, shot, compose)
// and the engine only orchestrates and records what it observed; the rows are derived later, from the record alone.
//
// Never optimizely_force_tracking and never _conv_eforce: every URL a mode loads is built by qkBuildUrl, which strips
// both (either one registers a real exposure on a live site).
//
// The functions in the parity sections are copies of their QA Pass originals (renamed qp -> qk, bodies unchanged); the
// copies are pinned to the originals by tests/qa-kit.test.js, so a drift of either one is loud.
//
// Deliberately no WHATWG URL parsing outside the injected page functions: jsc, which runs the unit suite, has none.
(function (g) {
  'use strict';

  const EXPORTS = {};

  // ── Constants ────────────────────────────────────────────────────────────
  const QK_WIDTHS = [300, 320, 340, 360, 375, 390, 402, 412, 430, 480, 600, 768, 820, 1024, 1280, 1440, 1920, 2080];
  const QK_PHASE_WIDTH = 1440;
  const QK_LOAD_TIMEOUT_MS = 30000;
  const QK_SETTLE = { firstWaitMs: 1200, pollMs: 250, maxPolls: 12, scrollWaitMs: 400, resizeWaitMs: 400 };
  const QK_CLIP_MIN_PX = 2;
  const QK_TRACKING_PARAMS = ['optimizely_force_tracking', '_conv_eforce'];
  const QK_COMPANION_VALUE = 'qa-selenite';
  const QK_QA_PARAM = ['cro_mode', 'qa'];
  const QK_MAX_AUDIENCE_TESTS = 12;
  const QK_MAX_LOADS_KEPT = 200;
  const QK_ACTIVATION_POLLS = 10;
  const QK_ACTIVATION_POLL_MS = 500;
  const QK_CLICK_NAV_WAIT_MS = 1200;
  const QK_DEBUG_MAX_LINES = 1500;
  const QK_CONDITIONAL_ACTIVATION = ['callback', 'polling', 'manual', 'dom_changed', 'url_changed'];
  const QK_MINUS = '−';
  // The stored statuses; the verdict words below are a display layer over them.
  const QK_STATUSES = ['passed', 'failed', 'in-progress', 'blocked', 'not-tested'];
  // Also the sort order of a results table.
  const QK_VERDICT_LABELS = ['Fail', 'Needs PGM', 'Needs Platform Access', 'Not Tested', 'Pass'];
  // Every not-tested / blocked row's evidence starts with exactly one of these.
  const QK_REASON_PREFIXES = ['Missing input: ', 'Out of scope: ', 'Blocked: ', 'Stopped: ', 'Not run: ', 'Needs the Optimizely UI: '];
  const QK_COLUMNS = [
    { key: 'check', label: 'Check' },
    { key: 'expected', label: 'Expected' },
    { key: 'observed', label: 'Observed' },
    { key: 'verdict', label: 'Verdict' },
    { key: 'evidence', label: 'Evidence' },
  ];
  // A URL query key whose value is never kept in output.
  const QK_SENSITIVE_KEY_RE = /(token|secret|password|passwd|auth|session|sid|key|sig|signature|email|phone)/i;
  const QK_VERDICT_COLORS = { 'Fail': '#c62828', 'Pass': '#2e7d32', 'Needs PGM': '#b26a00', 'Needs Platform Access': '#6a1b9a', 'Not Tested': '#616161' };

  Object.assign(EXPORTS, {
    QK_WIDTHS, QK_PHASE_WIDTH, QK_LOAD_TIMEOUT_MS, QK_SETTLE, QK_CLIP_MIN_PX, QK_TRACKING_PARAMS, QK_COMPANION_VALUE,
    QK_QA_PARAM, QK_MAX_AUDIENCE_TESTS, QK_MAX_LOADS_KEPT, QK_ACTIVATION_POLLS, QK_ACTIVATION_POLL_MS,
    QK_CLICK_NAV_WAIT_MS, QK_DEBUG_MAX_LINES, QK_CONDITIONAL_ACTIVATION, QK_MINUS, QK_STATUSES, QK_VERDICT_LABELS,
    QK_REASON_PREFIXES, QK_COLUMNS, QK_SENSITIVE_KEY_RE, QK_VERDICT_COLORS,
  });

  // ── URL helpers ──────────────────────────────────────────────────────────
  // Parity copies of qa-pass.js (renamed qp -> qk; bodies and inner comments unchanged), pinned by tests/qa-kit.test.js.
  // ── URL helpers (part 1) ─────────────────────────────────────────────────
  function qkDecode(s) {
    try { return decodeURIComponent(String(s)); } catch (e) { return String(s); }
  }
  function qkKeyOf(rawKey) { return qkDecode(rawKey).toLowerCase(); }
  // { base, params:[[rawKey, rawValue]], hash } or null. A piece with no '='
  // keeps rawValue null (so qkJoinUrl gives back 'flag', not 'flag='); empty
  // pieces are dropped. Only http(s) URLs parse.
  function qkSplitUrl(u) {
    if (typeof u !== 'string') return null;
    const m = /^(https?:\/\/[^?#]*)(\?[^#]*)?(#.*)?$/i.exec(u.trim());
    if (!m) return null;
    const params = [];
    if (m[2]) {
      m[2].slice(1).split('&').forEach(function (piece) {
        if (!piece) return;
        const i = piece.indexOf('=');
        params.push(i < 0 ? [piece, null] : [piece.slice(0, i), piece.slice(i + 1)]);
      });
    }
    return { base: m[1], params: params, hash: m[3] || '' };
  }
  function qkJoinUrl(parts) {
    const q = parts.params.map(function (p) { return p[1] === null ? p[0] : p[0] + '=' + p[1]; }).join('&');
    return parts.base + (parts.params.length ? '?' + q : '') + (parts.hash || '');
  }
  function qkIsTrackingKey(rawKey) { return QK_TRACKING_PARAMS.indexOf(qkKeyOf(rawKey)) >= 0; }
  function qkTrackingFlags(u) {
    const parts = qkSplitUrl(u);
    if (!parts) return [];
    return QK_TRACKING_PARAMS.filter(function (name) {
      return parts.params.some(function (p) { return qkKeyOf(p[0]) === name; });
    });
  }
  // The plain production form of a preview link: no Optimizely / Convert /
  // QA parameter of any kind, no hash.
  function qkProdUrl(u) {
    const parts = qkSplitUrl(u);
    if (!parts) return u;
    parts.params = parts.params.filter(function (p) {
      return !/^(optimizely_[a-z_]*|_conv_[a-z_]*|cro_mode|crometrics_test_cookie)$/i.test(qkDecode(p[0]));
    });
    parts.hash = '';
    return qkJoinUrl(parts);
  }
  function qkOptimizelyXIds(parts) {
    for (let i = 0; i < parts.params.length; i++) {
      if (qkKeyOf(parts.params[i][0]) === 'optimizely_x') {
        return qkDecode(parts.params[i][1] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      }
    }
    return [];
  }
  // Variation ids a preview link forces: optimizely_x, else the part of
  // _conv_eforce after its last '.'.
  function qkForcedIds(u) {
    const parts = qkSplitUrl(u);
    if (!parts) return [];
    const ids = qkOptimizelyXIds(parts);
    if (ids.length) return ids;
    for (let i = 0; i < parts.params.length; i++) {
      if (qkKeyOf(parts.params[i][0]) === '_conv_eforce') {
        const v = qkDecode(parts.params[i][1] || '').trim();
        const id = v.slice(v.lastIndexOf('.') + 1).trim();
        return id ? [id] : [];
      }
    }
    return [];
  }
  function qkPathOnly(u) {
    const parts = qkSplitUrl(u);
    return parts ? parts.base : '';
  }
  // background.js normalizeUrl, for the links a person typed into the Initialize editor: a link with no scheme is
  // loaded as https://<link>. Every helper must see that form: qkSplitUrl parses http(s) only, so on the typed form a
  // forcing flag goes undetected (the sweep would reload the link once per width, each load an exposure, and the PROD
  // address derived from it would keep the flag).
  function qkAbsUrl(u) {
    const t = String(u == null ? '' : u).trim();
    if (!t) return t;
    return /^https?:\/\//i.test(t) ? t : 'https://' + t;
  }
  // Widths a person typed: 200-3000 only, unique, ascending. Nothing usable
  // (including an empty box) means the default list.
  function qkParseWidths(s) {
    const seen = {};
    const out = [];
    String(s == null ? '' : s).split(/[\s,]+/).forEach(function (t) {
      const n = parseInt(t, 10);
      if (n >= 200 && n <= 3000 && !seen[n]) { seen[n] = true; out.push(n); }
    });
    out.sort(function (a, b) { return a - b; });
    return out.length ? out : QK_WIDTHS.slice();
  }
  // ── Context helpers (part 1) ─────────────────────────────────────────────
  function qkControlId(ctx) {
    if (!ctx) return null;
    if (ctx.controlId) return ctx.controlId;
    const v = (ctx.variants || []).filter(function (x) { return x && x.isControl; })[0];
    return v ? v.id : null;
  }
  // The preview link of the control variation: the isControl variant's id (or
  // the worker context's controlId), else the link named 'v0', else null.
  function qkControlLink(ctx) {
    const links = ((ctx && ctx.previewLinks) || []).filter(function (l) { return l && l.url; });
    const id = qkControlId(ctx);
    const byId = id ? links.filter(function (l) { return l.id === id; })[0] : null;
    return byId || links.filter(function (l) { return l.id === 'v0'; })[0] || null;
  }
  // popup.js esc(), plus the double quote (attribute values).
  function qkEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // EVERY URL the mode builds goes through here, so the two forcing/tracking
  // parameters can never ride along. `set` is [[key, value]]; a value is
  // percent-encoded unless the pair carries a third element `true` (already
  // encoded, used for the literal-comma optimizely_x list). An existing key
  // (case-insensitive) is replaced in place, never duplicated. A base that is
  // not an http(s) URL builds ''. `drop` is a list of keys to remove (case-insensitive), applied after the tracking
  // filter and before `set`.
  function qkBuildUrl(base, set, drop) {
    const parts = qkSplitUrl(base);
    if (!parts) return '';
    parts.params = parts.params.filter(function (p) { return !qkIsTrackingKey(p[0]); });
    if (drop && drop.length) { const d = drop.map(function (k) { return qkKeyOf(encodeURIComponent(String(k))); }); parts.params = parts.params.filter(function (p) { return d.indexOf(qkKeyOf(p[0])) < 0; }); }
    (set || []).forEach(function (pair) {
      const key = String(pair[0]);
      const val = pair[2] === true ? String(pair[1]) : encodeURIComponent(String(pair[1]));
      const want = qkKeyOf(encodeURIComponent(key));
      let at = -1;
      for (let i = 0; i < parts.params.length; i++) {
        if (qkKeyOf(parts.params[i][0]) === want) { at = i; break; }
      }
      if (at < 0) { parts.params.push([encodeURIComponent(key), val]); return; }
      parts.params[at] = [parts.params[at][0], val];
      parts.params = parts.params.filter(function (p, i) { return i <= at || qkKeyOf(p[0]) !== want; });
    });
    return qkJoinUrl(parts);
  }

  // ── URL helpers (new) ────────────────────────────────────────────────────
  // True when a link forces a variation or carries a preview token: audience and activation checks mean nothing on it.
  function qkIsPreviewUrl(u) {
    const parts = qkSplitUrl(u);
    if (!parts) return false;
    return parts.params.some(function (p) {
      return /^(optimizely_x\d*|optimizely_token|optimizely_force_tracking|_conv_eforce)$/i.test(qkDecode(p[0]));
    });
  }
  function qkOriginOf(u) {
    const m = /^https?:\/\/[^\/?#]+/i.exec(String(u == null ? '' : u).trim());
    return m ? m[0] : '';
  }
  // An http(s) address as it is, a path against the base's origin, anything else ''.
  function qkResolve(pathOrUrl, base) {
    const t = String(pathOrUrl == null ? '' : pathOrUrl).trim();
    if (/^https?:\/\//i.test(t)) return qkAbsUrl(t);
    if (t.charAt(0) === '/') {
      const origin = qkOriginOf(base);
      return origin ? origin + t : '';
    }
    return '';
  }
  // Every query parameter of `fromUrl` that `url` lacks (case-insensitive key), so a negative is not passed for the
  // wrong reason (a missing QA parameter). The forcing and tracking keys and the preview tokens never carry.
  function qkCarryParams(url, fromUrl) {
    const to = qkSplitUrl(url);
    const from = qkSplitUrl(fromUrl);
    if (!to || !from) return url;
    from.params.forEach(function (p) {
      const key = qkKeyOf(p[0]);
      if (qkIsTrackingKey(p[0]) || /^(optimizely_x\d*|optimizely_token)$/i.test(key)) return;
      if (to.params.some(function (q) { return qkKeyOf(q[0]) === key; })) return;
      to.params.push([p[0], p[1]]);
    });
    return qkJoinUrl(to);
  }
  // Lines of a textarea: trimmed, no empty line, no duplicate, at most 50 lines of 500 characters.
  function qkLines(s) {
    const out = [];
    String(s == null ? '' : s).split('\n').forEach(function (line) {
      const t = line.trim().slice(0, 500);
      if (t && out.indexOf(t) < 0 && out.length < 50) out.push(t);
    });
    return out;
  }

  // ── Masking ──────────────────────────────────────────────────────────────
  // Everything a mode writes to output goes through here. In every http(s) URL the fragment is dropped, the forcing
  // pairs are dropped and the value of a sensitive key becomes '…'; a bare forcing pair outside a URL is removed;
  // then every ? & = in the whole string becomes its fullwidth twin (readable, not clickable). Idempotent.
  function qkMaskOutput(v) {
    if (v === null || v === undefined) return '';
    let s = String(v);
    s = s.replace(/https?:\/\/[^\s"'`<>\\“”‘’]*/gi, function (m) {
      const tail = /[.,;:!)\]}]*$/.exec(m)[0];
      let u = m.slice(0, m.length - tail.length);
      const h = u.indexOf('#');
      if (h >= 0) u = u.slice(0, h);
      const q = u.indexOf('?');
      if (q < 0) return u + tail;
      const kept = [];
      u.slice(q + 1).split('&').forEach(function (piece) {
        if (!piece) return;
        const i = piece.indexOf('=');
        const key = i < 0 ? piece : piece.slice(0, i);
        if (qkIsTrackingKey(key)) return;
        kept.push(i >= 0 && QK_SENSITIVE_KEY_RE.test(qkDecode(key)) ? key + '=…' : piece);
      });
      return u.slice(0, q) + (kept.length ? '?' + kept.join('&') : '') + tail;
    });
    s = s.replace(/[?&]?(?:optimizely_force_tracking|_conv_eforce)=[^\s&"'`<>\\“”‘’]*/gi, '');
    return s.replace(/\?/g, '？').replace(/&/g, '＆').replace(/=/g, '＝');
  }
  // A clone with every string masked.
  function qkMaskDeep(o) {
    if (typeof o === 'string') return qkMaskOutput(o);
    if (Array.isArray(o)) return o.map(qkMaskDeep);
    if (o && typeof o === 'object') {
      const out = {};
      Object.keys(o).forEach(function (k) {
        if (o[k] !== undefined) out[k] = qkMaskDeep(o[k]);
      });
      return out;
    }
    return o === undefined || typeof o === 'function' ? null : o;
  }
  // Cookie names only (never a value), unique, at most 50. Takes cookie objects ({name}) or strings.
  function qkCookieNames(list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach(function (c) {
      let n = typeof c === 'string' ? c.split('=')[0] : (c && c.name);
      n = String(n == null ? '' : n).trim();
      if (n && out.indexOf(n) < 0 && out.length < 50) out.push(n);
    });
    return out;
  }
  // Exact name, or a prefix when the pattern ends in '*' (at least 3 characters before it: a shorter prefix matches
  // nothing). Patterns only: the ^optimizely default is not applied here.
  function qkKeyMatches(name, patterns) {
    const n = String(name == null ? '' : name);
    return (patterns || []).some(function (p) {
      p = String(p == null ? '' : p);
      if (!p) return false;
      if (p.charAt(p.length - 1) === '*') return p.length > 3 && n.indexOf(p.slice(0, -1)) === 0;
      return n === p;
    });
  }
  // Trimmed, no empty one; a '*' survives only as the last character; at most 20 patterns of 100 characters. A prefix
  // needs at least 3 characters before its '*': the run tab is the tester's own Chrome profile, and a lone '*' (or 'a*')
  // would wipe every cookie and storage key the client site keeps there.
  function qkCleanPatterns(list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach(function (p) {
      const t = String(p == null ? '' : p).trim();
      const body = t.replace(/\*/g, '');
      const prefix = t.charAt(t.length - 1) === '*';
      if (!body || (prefix && body.length < 3)) return;
      const s = (body + (prefix ? '*' : '')).slice(0, 100);
      if (out.length < 20) out.push(s);
    });
    return out;
  }

  Object.assign(EXPORTS, {
    qkDecode, qkKeyOf, qkSplitUrl, qkJoinUrl, qkIsTrackingKey, qkTrackingFlags, qkProdUrl, qkOptimizelyXIds, qkForcedIds,
    qkPathOnly, qkAbsUrl, qkParseWidths, qkControlId, qkControlLink, qkEsc, qkBuildUrl, qkIsPreviewUrl, qkOriginOf,
    qkResolve, qkCarryParams, qkLines, qkMaskOutput, qkMaskDeep, qkCookieNames, qkKeyMatches, qkCleanPatterns,
  });

  // ── Analysis (parity copies) ─────────────────────────────────────────────
  // ── Snippet analysis (part 2) ────────────────────────────────────────────
  // `catalog` is what qkSnippetProbeFn returns: experiments / audiences / pages /
  // campaigns keyed by id, events as a list.
  function qkNul(x) { return x === undefined ? null : x; }
  function qkEscRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Every leaf condition of an audience expression: [op, ...children] nodes with
  // op and | or | not; `negated` flips under each not; `path` is the {op, n}
  // chain from the root (n = that node's child count).
  function qkCondLeaves(expr) {
    const out = [];
    (function walk(node, negated, path) {
      if (Array.isArray(node)) {
        const op = node[0];
        if (op !== 'and' && op !== 'or' && op !== 'not') return;
        const kids = node.slice(1);
        const p = path.concat([{ op: op, n: kids.length }]);
        const neg = op === 'not' ? !negated : negated;
        kids.forEach(function (k) { walk(k, neg, p); });
        return;
      }
      if (node && typeof node === 'object') {
        out.push({ type: qkNul(node.type), name: qkNul(node.name), value: qkNul(node.value), match: qkNul(node.match), negated: negated, path: path });
      }
    })(expr, false, []);
    return out;
  }
  // A leaf decides the audience when no OR on its path offers an alternative:
  // every `or` has exactly one child, except an `or` that is the direct operand
  // of a `not` (not(a or b) is still decided by each of a and b).
  function qkIsDecisive(leaf) {
    const p = leaf.path;
    for (let i = 0; i < p.length; i++) {
      if (p[i].op === 'or' && p[i].n !== 1 && !(i > 0 && p[i - 1].op === 'not')) return false;
    }
    return true;
  }
  function qkDecisiveLeaves(expr) { return qkCondLeaves(expr).filter(qkIsDecisive); }
  function qkExperimentList(catalog) {
    const m = (catalog && catalog.experiments) || {};
    return Object.keys(m).map(function (k) { return m[k]; });
  }
  function qkExperimentById(catalog, id) {
    if (id == null) return null;
    const m = (catalog && catalog.experiments) || {};
    return m[String(id)] || null;
  }
  // Which audience conditions can be exercised from the URL, and which cannot (and why).
  function qkAudienceTests(exp, audiencesById) {
    const byId = audiencesById || {};
    const ids = exp && exp.audienceIds;
    const everyone = { tests: [], notExercised: [{ audienceId: null, audienceName: null, reason: 'Everyone else (no audience)' }] };
    if (!Array.isArray(ids)) return everyone;
    const headed = ids[0] === 'and' || ids[0] === 'or';
    const head = headed ? ids[0] : 'and';
    const list = (headed ? ids.slice(1) : ids).map(String);
    if (!list.length) return everyone;
    const notExercised = [];
    if (head === 'or' && list.length > 1) {
      list.forEach(function (id) {
        notExercised.push({ audienceId: id, audienceName: byId[id] ? byId[id].name : null, reason: "the experiment's audiences are OR-combined" });
      });
      return { tests: [], notExercised: notExercised };
    }
    const all = [];
    const exclusionParams = [];
    list.forEach(function (id) {
      const aud = byId[id];
      if (!aud) { notExercised.push({ audienceId: id, audienceName: null, reason: 'audience not in the snippet' }); return; }
      const reasons = [];
      const types = [];
      function skip(leaf, reason) {
        if (reasons.indexOf(reason) < 0) reasons.push(reason);
        const t = String(leaf.type);
        if (types.indexOf(t) < 0) types.push(t);
      }
      qkCondLeaves(aud.conditions).forEach(function (leaf) {
        if (!qkIsDecisive(leaf)) { skip(leaf, 'not decisive: OR-ed with other conditions'); return; }
        const base = { audienceId: String(aud.id != null ? aud.id : id), audienceName: qkNul(aud.name) };
        if (leaf.type === 'query' && (leaf.match === null || leaf.match === 'exact' || leaf.match === 'substring')
            && leaf.name && leaf.value !== null && leaf.value !== '') {
          all.push(Object.assign({ kind: 'query', param: String(leaf.name), value: String(leaf.value), profile: 'desktop',
            expect: leaf.negated ? 'inactive' : 'active', role: leaf.negated ? 'exclusion' : 'inclusion' }, base));
          if (leaf.negated && !exclusionParams.some(function (x) { return x.param.toLowerCase() === String(leaf.name).toLowerCase(); })) {
            exclusionParams.push({ param: String(leaf.name), base: base });
          }
          return;
        }
        if (leaf.type === 'device' && (leaf.value === 'desktop' || leaf.value === 'mobile')) {
          ['desktop', 'iphone'].forEach(function (profile) {
            const matches = (leaf.value === 'desktop') === (profile === 'desktop');
            const active = leaf.negated ? !matches : matches;
            all.push(Object.assign({ kind: 'device', param: null, value: leaf.value, profile: profile,
              expect: active ? 'active' : 'inactive', role: active ? 'inclusion' : 'exclusion' }, base));
          });
          return;
        }
        if (leaf.type === 'device') { skip(leaf, 'device value ' + leaf.value + ' not exercised'); return; }
        skip(leaf, 'cannot be set from the URL');
      });
      if (reasons.length) notExercised.push({ audienceId: String(id), audienceName: qkNul(aud.name), types: types, reason: reasons.join('; ') });
    });
    exclusionParams.forEach(function (x) {
      all.push(Object.assign({ kind: 'query', param: x.param, value: QK_COMPANION_VALUE, profile: 'desktop', expect: 'active', role: 'companion' }, x.base));
    });
    const tests = all.slice(0, QK_MAX_AUDIENCE_TESTS).map(function (t, i) { return Object.assign({ n: i + 1 }, t); });
    const overAud = {};
    all.slice(QK_MAX_AUDIENCE_TESTS).forEach(function (t) {
      if (overAud[t.audienceId]) return;
      overAud[t.audienceId] = true;
      notExercised.push({ audienceId: t.audienceId, audienceName: t.audienceName, reason: 'over the ' + QK_MAX_AUDIENCE_TESTS + '-test cap' });
    });
    return { tests: tests, notExercised: notExercised };
  }
  function qkExperimentActivation(catalog, exp) {
    const none = { pages: [], conditional: null };
    if (!catalog || !exp) return none;
    const camp = (catalog.campaigns || {})[String(exp.layerId)];
    if (!camp || !Array.isArray(camp.pageIds)) return none;
    const pages = [];
    camp.pageIds.forEach(function (pid) {
      const pg = (catalog.pages || {})[String(pid)];
      if (pg) pages.push({ id: String(pg.id != null ? pg.id : pid), name: qkNul(pg.name), activationType: qkNul(pg.activationType) });
    });
    if (!pages.length) return none;
    return { pages: pages, conditional: pages.some(function (x) { return QK_CONDITIONAL_ACTIVATION.indexOf(x.activationType) >= 0; }) };
  }
  // #7b (D9): the experiment's traffic allocation as the snippet carries it. `holdback` is its campaign's, in basis points
  // (null or 0: nothing held back); `weightsEnd` is the last endOfRange of its weight distribution (10000: every visitor).
  // Neither reading was measured on a page with partial allocation, so every note built from it says "as read from the snippet".
  function qkAllocation(catalog, exp) {
    const none = { partial: false, holdback: null, weightsEnd: null, text: null };
    if (!catalog || !exp) return none;
    const camp = (catalog.campaigns || {})[String(exp.layerId)] || null;
    const hbN = camp && camp.holdback != null ? Number(camp.holdback) : NaN;
    const hb = Number.isFinite(hbN) && hbN > 0 ? hbN : null;
    const w = Array.isArray(exp.weightDistributions) && exp.weightDistributions.length ? exp.weightDistributions[exp.weightDistributions.length - 1] : null;
    const endN = w && w.endOfRange != null ? Number(w.endOfRange) : NaN;
    const end = Number.isFinite(endN) && endN < 10000 ? endN : null;
    if (hb === null && end === null) return none;
    const parts = [];
    if (hb !== null) parts.push('the campaign holds back ' + (hb / 100) + ' % of traffic');
    if (end !== null) parts.push('the variation weights cover ' + (end / 100) + ' % of traffic');
    return { partial: true, holdback: hb, weightsEnd: end, text: parts.join(' and ') };
  }
  // Control page against plain PROD. Tolerances: text length 1 % (at least 50 chars),
  // page height 2 % (at least 40 px). Widgets compare by presence.
  function qkCompareFacts(control, prod) {
    const out = { diffs: [], identicalText: false };
    if (!control || !prod) return out;
    const trim = function (s) { return String(s == null ? '' : s).trim(); };
    if (trim(control.title) !== trim(prod.title)) out.diffs.push({ field: 'title', control: trim(control.title), prod: trim(prod.title) });
    // A canonical URL is compared and printed by path only: a site whose canonical echoes the page URL carries the
    // forcing query of the link it was loaded from, which would fail B for a difference no visitor can see and put
    // optimizely_force_tracking into the note (the report, both Opus prompts, the Sheet). Not an http(s) URL: as is.
    const canonKey = function (s) { const t = trim(s); return qkSplitUrl(t) ? qkPathOnly(t) : t; };
    if (control.canonical != null && prod.canonical != null && canonKey(control.canonical) !== canonKey(prod.canonical)) {
      out.diffs.push({ field: 'canonical', control: canonKey(control.canonical), prod: canonKey(prod.canonical) });
    }
    ['chat', 'banner', 'modal'].forEach(function (k) {
      const a = ((control.widgets || {})[k]) || 0, b = ((prod.widgets || {})[k]) || 0;
      if ((a > 0) !== (b > 0)) out.diffs.push({ field: 'widgets.' + k, control: a, prod: b });
    });
    const cl = control.textLen || 0, pl = prod.textLen || 0;
    if (Math.abs(cl - pl) > Math.max(50, cl * 0.01)) out.diffs.push({ field: 'textLen', control: cl, prod: pl });
    const ch = control.scrollHeight || 0, ph = prod.scrollHeight || 0;
    if (Math.abs(ch - ph) > Math.max(40, ch * 0.02)) out.diffs.push({ field: 'scrollHeight', control: ch, prod: ph });
    out.identicalText = !!control.textHash && control.textHash === prod.textHash;
    return out;
  }
  function qkStripQuery(u) { return typeof u === 'string' && qkSplitUrl(u) ? qkPathOnly(u) : u; }
  // ── Sweep evaluation, record, checks, badge, projections (part 4) ────────
  function qkHeightFor(w) { return w <= 767 ? 844 : w < 1024 ? 1024 : 900; }
  function qkSeverity(w) { return (w >= 360 && w <= 430) ? 'high' : (w <= 320 ? 'low' : 'medium'); }
  function qkSeverityRank(sev) { return sev === 'high' ? 3 : sev === 'medium' ? 2 : sev === 'low' ? 1 : 0; }
  // The most severe widths first, so the few tile slots go to the worst cases.
  function qkWidthOrder(widths) {
    const asc = (widths || []).slice().sort(function (a, b) { return a - b; });
    return ['high', 'medium', 'low'].reduce(function (acc, sev) {
      return acc.concat(asc.filter(function (w) { return qkSeverity(w) === sev; }));
    }, []);
  }
  function qkOffenderKey(text) { return String(text == null ? '' : text).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 30); }
  function qkMinus(n) { return (n < 0 ? QK_MINUS : '') + Math.abs(n); }
  function qkCut(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }
  function qkUniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  Object.assign(EXPORTS, {
    qkNul, qkEscRe, qkCondLeaves, qkIsDecisive, qkDecisiveLeaves, qkExperimentList, qkExperimentById, qkAudienceTests, qkExperimentActivation, qkAllocation, qkCompareFacts, qkStripQuery, qkHeightFor, qkSeverity, qkSeverityRank, qkWidthOrder, qkOffenderKey, qkMinus, qkCut, qkUniq,
  });

  // ── Rows ─────────────────────────────────────────────────────────────────
  // One row per assertion. Strings are masked and capped; an unknown status is a not-tested row that says so.
  function qkRow(o) {
    o = o || {};
    const cap = function (v, n) { return qkMaskOutput(v).slice(0, n); };
    const valid = QK_STATUSES.indexOf(o.status) >= 0;
    return {
      id: cap(o.id, 80),
      step: o.step == null ? null : cap(o.step, 40),
      check: cap(o.check, 160),
      expected: cap(o.expected, 240),
      observed: cap(o.observed, 400),
      status: valid ? o.status : 'not-tested',
      platform: o.platform === true,
      evidence: valid ? cap(o.evidence, 700) : 'Not run: invalid status',
      emulated: o.emulated === true,
      loads: Array.isArray(o.loads) ? o.loads.map(function (x) { return cap(x, 20); }).slice(0, 20) : [],
      tile: o.tile ? cap(o.tile, 20) : null,
      extra: qkMaskDeep(o.extra && typeof o.extra === 'object' && !Array.isArray(o.extra) ? o.extra : {}),
    };
  }
  // The display word for a stored status. Only a not-tested row can need platform access.
  function qkVerdictLabel(row) {
    const s = row && row.status;
    if (s === 'passed') return 'Pass';
    if (s === 'failed') return 'Fail';
    if (s === 'in-progress') return 'Needs PGM';
    if (s === 'not-tested' && row.platform === true) return 'Needs Platform Access';
    return 'Not Tested';
  }
  function qkVerdictText(row) {
    return qkVerdictLabel(row) + (row && row.emulated === true ? ' (emulated)' : '');
  }
  function qkCounts(rows) {
    const c = { fail: 0, pgm: 0, platform: 0, notTested: 0, pass: 0 };
    (rows || []).forEach(function (r) {
      const l = qkVerdictLabel(r);
      if (l === 'Fail') c.fail++;
      else if (l === 'Needs PGM') c.pgm++;
      else if (l === 'Needs Platform Access') c.platform++;
      else if (l === 'Pass') c.pass++;
      else c.notTested++;
    });
    return c;
  }
  function qkCountsLine(c) {
    c = c || {};
    return (c.fail || 0) + ' Fail · ' + (c.pass || 0) + ' Pass · ' + (c.pgm || 0) + ' Needs PGM · '
      + (c.platform || 0) + ' Needs Platform Access · ' + (c.notTested || 0) + ' Not Tested';
  }
  function qkBadge(rows, stopped, halted) {
    const c = qkCounts(rows);
    const blocked = (rows || []).some(function (r) { return r && r.status === 'blocked'; });
    if (c.fail) return { kind: 'fail', label: 'ISSUES FOUND' };
    if (halted) return { kind: 'issues', label: 'HALTED: BOT CHECK' };
    if (stopped) return { kind: 'issues', label: 'INCOMPLETE' };
    if (c.pgm || c.platform || blocked) return { kind: 'issues', label: 'NEEDS REVIEW' };
    if (c.pass) return { kind: 'pass', label: 'PASS' };
    return { kind: 'skip', label: 'INCONCLUSIVE' };
  }
  // Fail, Needs PGM, Needs Platform Access, Not Tested, Pass; rows of one verdict keep their order.
  function qkSortRows(rows) {
    return (rows || []).map(function (r, i) { return { r: r, i: i, k: QK_VERDICT_LABELS.indexOf(qkVerdictLabel(r)) }; })
      .sort(function (a, b) { return (a.k - b.k) || (a.i - b.i); })
      .map(function (x) { return x.r; });
  }

  // ── CSV and HTML ─────────────────────────────────────────────────────────
  // Every field quoted. A field that starts with = + @ tab or CR, or with - that is not a plain number, gets a leading '
  // so a spreadsheet never reads it as a formula.
  function qkCsvField(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+@\t\r]/.test(s) || (s.charAt(0) === '-' && !/^-\d+(\.\d+)?$/.test(s))) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function qkCellValue(row, key) {
    row = row || {};
    if (key === 'verdict') return qkVerdictText(row);
    if (key === 'check' || key === 'expected' || key === 'observed' || key === 'evidence') return row[key];
    if (key === 'tile') return row.tile || '';
    return row.extra && row.extra[key] != null ? row.extra[key] : '';
  }
  // The header row of the column labels, then every row (Pass included); CRLF line ends and a trailing CRLF.
  function qkCsv(columns, rows) {
    const lines = [(columns || []).map(function (c) { return qkCsvField(c.label); }).join(',')];
    (rows || []).forEach(function (row) {
      lines.push((columns || []).map(function (c) { return qkCsvField(qkMaskOutput(qkCellValue(row, c.key))); }).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }
  // <base>-<ticket key>-<YYYYMMDD-HHMM>.<ext>, local time; the key reduced to letters, digits and '-', else 'run'.
  function qkFileName(base, ticketKey, ts, ext) {
    const key = String(ticketKey == null ? '' : ticketKey).replace(/[^A-Za-z0-9-]/g, '') || 'run';
    const d = new Date(ts);
    const p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    const stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes());
    return base + '-' + key + '-' + stamp + '.' + ext;
  }
  const QK_TILE_SRC_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/;
  // The data URL of a tile id, only when it is a JPEG data URL; else ''. `tiles` is the record's list ({id, img}) or an
  // id -> src map.
  function qkTileSrc(tiles, id) {
    if (!tiles || !id) return '';
    let src = '';
    if (Array.isArray(tiles)) {
      for (let i = 0; i < tiles.length; i++) { if (tiles[i] && tiles[i].id === id) { src = tiles[i].img; break; } }
    } else if (typeof tiles === 'object') {
      const t = tiles[id];
      src = t && typeof t === 'object' ? t.img : t;
    }
    return typeof src === 'string' && QK_TILE_SRC_RE.test(src) ? src : '';
  }
  function qkTableHtml(columns, rows, opts) {
    opts = opts || {};
    columns = columns || [];
    const head = '<thead><tr>' + columns.map(function (c) { return '<th>' + qkEsc(qkMaskOutput(c.label)) + '</th>'; }).join('') + '</tr></thead>';
    const body = (rows || []).map(function (row) {
      return '<tr>' + columns.map(function (c) {
        let inner;
        if (c.key === 'verdict') {
          inner = '<span style="color:' + (QK_VERDICT_COLORS[qkVerdictLabel(row)] || '#616161') + ';font-weight:700">'
            + qkEsc(qkMaskOutput(qkVerdictText(row))) + '</span>';
        } else {
          inner = qkEsc(qkMaskOutput(qkCellValue(row, c.key)));
          const src = c.key === 'evidence' ? qkTileSrc(opts.tiles, row.tile) : '';
          if (src) inner += '<img class="qk-tile" alt="' + qkEsc(row.tile) + '" src="' + qkEsc(src) + '" style="max-width:100%;display:block;margin-top:3px">';
        }
        return '<td>' + inner + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<table class="qk-table' + (opts.report ? ' rpt-table' : '') + '">' + head + '<tbody>' + body + '</tbody></table>';
  }
  // The panel form: the rows that are not a Pass first (sorted), then the passing rows folded away, all inside a
  // horizontally scrollable wrapper. The report form (opts.report): one sorted table with every row.
  function qkResultsHtml(columns, rows, opts) {
    opts = opts || {};
    const sorted = qkSortRows(rows);
    if (opts.report) return qkTableHtml(columns, sorted, opts);
    const open = sorted.filter(function (r) { return qkVerdictLabel(r) !== 'Pass'; });
    const passed = sorted.filter(function (r) { return qkVerdictLabel(r) === 'Pass'; });
    let html = '<div style="overflow-x:auto">';
    if (open.length || !passed.length) html += qkTableHtml(columns, open, opts);
    if (passed.length) html += '<details><summary>Passing rows (' + passed.length + ')</summary>' + qkTableHtml(columns, passed, opts) + '</details>';
    return html + '</div>';
  }
  // One self-contained HTML document: a figure per tile, captioned with where and how far the text is clipped.
  function qkTilesHtmlFile(title, tiles, rows) {
    const t = qkEsc(qkMaskOutput(title));
    const figs = (Array.isArray(tiles) ? tiles : []).filter(Boolean).map(function (tile) {
      const id = String(tile && tile.id != null ? tile.id : '');
      const ids = (rows || []).filter(function (r) { return r && r.tile === id; }).map(function (r) { return r.id; });
      const src = qkTileSrc([tile], id);
      const cap = id + ' · ' + (tile.target || '') + ' · ' + tile.width + ' px · gap ' + qkMinus(tile.gapPx || 0) + ' px · rows: ' + ids.join(', ');
      return '<figure id="' + qkEsc(id.replace(/[^A-Za-z0-9_-]/g, '')) + '" style="margin:0 0 24px">'
        + (src ? '<img alt="' + qkEsc(id) + '" src="' + qkEsc(src) + '" style="max-width:100%;display:block">' : '')
        + '<figcaption>' + qkEsc(qkMaskOutput(cap)) + '</figcaption></figure>';
    }).join('');
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + t + '</title></head>'
      + '<body style="font-family:system-ui,sans-serif;margin:16px"><h1>' + t + '</h1>' + figs + '</body></html>';
  }

  Object.assign(EXPORTS, {
    qkRow, qkVerdictLabel, qkVerdictText, qkCounts, qkCountsLine, qkBadge, qkSortRows, qkCsvField, qkCellValue, qkCsv,
    qkFileName, qkTableHtml, qkResultsHtml, qkTilesHtmlFile,
  });

  // ── Debug feed ───────────────────────────────────────────────────────────
  // Copies of qa-pass.js's feed (renamed; every line goes through qkMaskOutput instead of qpScrubUrls).
  function qkDebugEntry(src, level, text, t) {
    return {
      t: typeof t === 'number' ? t : Date.now(),
      src: src === 'worker' ? 'worker' : 'panel',
      level: level === 'warn' || level === 'error' ? level : 'info',
      text: qkMaskOutput(String(text == null ? '' : text)),
    };
  }
  // Appends in place. Past the cap the oldest lines go, except the first (the run's start).
  function qkDebugPush(lines, entry, max) {
    lines.push(entry);
    const cap = Math.max(2, max || QK_DEBUG_MAX_LINES);
    if (lines.length > cap) lines.splice(1, lines.length - cap);
    return lines;
  }
  // The panel's lines and the worker's, in time order; a panel line and a worker line of the same millisecond keep the
  // order they were given in (panel first).
  function qkDebugMerge(panel, worker) {
    return (panel || []).concat(worker || []).map(function (e, i) { return { e: e, i: i }; })
      .sort(function (x, y) { return (x.e.t - y.e.t) || (x.i - y.i); })
      .map(function (x) { return x.e; });
  }
  function qkDebugPad(n) { return (n < 10 ? '0' : '') + n; }
  // "HH:MM:SS  +m:ss.s  worker  WARN text": clock time, time since the first line, source, level when not info.
  function qkDebugLineText(e, t0) {
    const d = new Date(e.t);
    const ms = Math.max(0, e.t - t0);
    const s = Math.floor(ms / 1000);
    const since = Math.floor(s / 60) + ':' + qkDebugPad(s % 60) + '.' + Math.floor((ms % 1000) / 100);
    return qkDebugPad(d.getHours()) + ':' + qkDebugPad(d.getMinutes()) + ':' + qkDebugPad(d.getSeconds())
      + '  +' + since + '  ' + (e.src === 'worker' ? 'worker' : 'panel ') + '  ' + (e.level === 'info' ? '' : e.level.toUpperCase() + ' ') + e.text;
  }
  function qkDebugText(lines) {
    lines = lines || [];
    const t0 = lines.length ? lines[0].t : 0;
    return lines.map(function (e) { return qkDebugLineText(e, t0); }).join('\n');
  }
  function qkDebugHtml(lines) {
    lines = lines || [];
    const t0 = lines.length ? lines[0].t : 0;
    return lines.map(function (e) {
      const color = e.level === 'error' ? ' style="color:var(--err)"' : e.level === 'warn' ? ' style="color:var(--warn)"' : '';
      return '<div' + color + '>' + qkEsc(qkDebugLineText(e, t0)) + '</div>';
    }).join('');
  }
  function qkDebugSecs(ms) { return (Math.max(0, ms || 0) / 1000).toFixed(1) + 's'; }
  // One load, before and after (the worker's load record L, §3.2 of the plan).
  function qkDebugLoadName(L) {
    return L.id + ' ' + L.role + ' · ' + L.label + ' · ' + L.width + 'px · ' + (L.path || '(no address)') + (L.keepState ? ' · keeps state' : '');
  }
  function qkDebugLoadResult(L) {
    const took = qkDebugSecs(L.ms);
    if (L.loadError) return { level: 'error', text: L.id + ' did not load (' + took + '): ' + L.loadError };
    if (L.blocked) return { level: 'warn', text: L.id + ' was stopped by a bot check (' + (L.blocked.signal || L.blocked.reason || 'challenge') + ') after ' + took };
    if (!L.ok) return { level: 'warn', text: L.id + ' did not finish (' + took + ')' };
    const fin = L.final ? (qkPathOnly(L.final) || String(L.final).split(/[?#]/)[0]) : null;
    if (fin && /^chrome-error:/i.test(fin)) return { level: 'error', text: L.id + ' ended on a Chrome error page (' + took + ')' };
    const settle = L.settle ? (L.settle.stable ? 'settled after ' + L.settle.polls + ' poll(s)' : 'still changing after ' + L.settle.polls + ' poll(s)') : 'settle not read';
    return {
      level: L.settle && L.settle.stable ? 'info' : 'warn',
      text: L.id + ' loaded in ' + took + ' · ' + settle + (fin && fin !== L.path ? ' · landed on ' + fin : ''),
    };
  }
  // What one state read found (qkStateSummary); warn when it could not be read. A bucket without activation is named
  // but never called served: Optimizely keeps the bucket on pages where the experiment is not active.
  function qkDebugStateLine(label, s) {
    if (!s || s.readable === false) return { level: 'warn', text: label + ': the experiment state could not be read' + (s && s.error ? ' (' + s.error + ')' : '') };
    if (s.platform == null) return { level: 'info', text: label + ': no testing platform found' };
    return {
      level: 'info',
      text: label + ': ' + s.platform + ' · experiment ' + (s.experimentId == null ? 'not given' : s.experimentId)
        + (s.activated ? ' active' : ' NOT active' + (s.variationName || s.variationId ? ' (bucketed only: ' + (s.variationName || s.variationId) + ')' : ''))
        + ' · serves ' + (s.activated ? (s.variationName || s.variationId || 'nothing') : 'nothing'),
    };
  }

  Object.assign(EXPORTS, {
    qkDebugEntry, qkDebugPush, qkDebugMerge, qkDebugPad, qkDebugLineText, qkDebugText, qkDebugHtml, qkDebugSecs,
    qkDebugLoadName, qkDebugLoadResult, qkDebugStateLine,
  });

  // ── Bytes ────────────────────────────────────────────────────────────────
  // Standard base64 of a byte array, no line breaks. jsc has no btoa.
  function qkBase64(bytes) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const n = bytes ? bytes.length : 0;
    let out = '';
    for (let i = 0; i < n; i += 3) {
      const b1 = i + 1 < n ? bytes[i + 1] : 0, b2 = i + 2 < n ? bytes[i + 2] : 0;
      const v = (bytes[i] << 16) | (b1 << 8) | b2;
      out += A.charAt((v >> 18) & 63) + A.charAt((v >> 12) & 63);
      out += i + 1 < n ? A.charAt((v >> 6) & 63) : '=';
      out += i + 2 < n ? A.charAt(v & 63) : '=';
    }
    return out;
  }

  // Bytes from base64 text. Whitespace and missing '=' padding are tolerated; any other bad character gives null.
  function qkBase64Decode(str) {
    if (typeof str !== 'string') return null;
    const s = str.replace(/\s+/g, '').replace(/=+$/, '');
    if (!/^[A-Za-z0-9+\/]*$/.test(s)) return null;
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const out = [];
    let buf = 0, bits = 0;
    for (let i = 0; i < s.length; i++) {
      buf = ((buf << 6) | A.indexOf(s.charAt(i))) & 0xffff;
      bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
    }
    return out;
  }

  Object.assign(EXPORTS, { qkBase64, qkBase64Decode });

  // ── Page functions and the hygiene shim ──────────────────────────────────
  // Each qk*Fn is shipped to the page as source text by chrome.scripting.executeScript (or Runtime.evaluate in the
  // real-Chrome gate), so it must be SELF-CONTAINED: no reference to any name outside its own body. It must also RETURN
  // a failure as a value ({error} / {ok:false}), because executeScript resolves {result: null} when the injected
  // function throws. The suite pins both properties. qkPageFactsFn, qkSettleFn and qkSnippetProbeFn are verbatim copies
  // of QA Pass's; qkClipScanFn is QA Pass's plus an ignore-list option.

  // The 16 selectors qkClipScanFn ignores by default (carousels, tickers, marquees); the panel seeds its list from them.
  const QK_IGNORE_DEFAULTS = [
    "marquee",
    "[role=\"marquee\"]",
    "[aria-roledescription=\"carousel\" i]",
    "[aria-roledescription=\"slide\" i]",
    "[class*=\"marquee\" i]",
    "[class*=\"ticker\" i]",
    "[class*=\"carousel\" i]",
    "[class*=\"slider\" i]",
    "[class*=\"swiper\" i]",
    "[class*=\"slick\" i]",
    "[class*=\"splide\" i]",
    "[class*=\"glide\" i]",
    "[class*=\"flickity\" i]",
    "[class*=\"owl-\" i]",
    "[class*=\"embla\" i]",
    "[data-carousel]",
  ];

  // Facts about the page that Control-vs-PROD compares, plus the bot-check signal.
  function qkPageFactsFn() {
    try {
      var norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); };
      var text = norm(document.body ? document.body.innerText : '');
      var h = 0x811c9dc5;
      for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      var hash = ('00000000' + (h >>> 0).toString(16)).slice(-8);
      var visible = function (el) {
        try { return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true; } catch (e) { return true; }
      };
      var count = function (sel) {
        var n = 0, list = document.querySelectorAll(sel);
        for (var j = 0; j < list.length; j++) { if (visible(list[j])) n++; }
        return n;
      };
      var title = document.title || '';
      var canon = document.querySelector('link[rel="canonical"]');
      var textLen = text.length;
      var titleHit = /just a moment|attention required|verify you are human|are you a robot|access denied|security check|captcha/i.test(title);
      var selHit = !!document.querySelector('#challenge-form,#cf-challenge-running,.cf-browser-verification,#challenge-stage,iframe[src*="challenges.cloudflare.com"],#px-captcha,iframe[src*="captcha-delivery.com"]');
      var challenge = (titleHit || selHit) && textLen < 3000;
      return {
        title: title,
        href: location.href,
        canonical: canon ? canon.href : null,
        textLen: textLen,
        textHash: hash,
        scrollHeight: document.documentElement.scrollHeight,
        widgets: {
          chat: count('iframe[title*="chat" i],iframe[src*="chat" i],[id*="chat-widget" i],[class*="chat-widget" i],#drift-widget,.intercom-launcher,#hubspot-messages-iframe-container,[id*="qualified" i]'),
          banner: count('#onetrust-banner-sdk,[id*="cookie-banner" i],[class*="cookie-banner" i],[class*="promo-banner" i]'),
          modal: count('dialog[open],[role="dialog"][aria-modal="true"],.modal.show'),
        },
        bot: { challenge: challenge, signal: challenge ? (titleHit ? 'title: ' + title.slice(0, 60) : 'challenge element') : null },
      };
    } catch (e) { return { error: String(e && e.message || e) }; }
  }

  // The experiment catalog the snippet carries (MAIN world). Capped; functions and long
  // strings are cut. A page without window.optimizely.get is {ok:true, platform:null}.
  function qkSnippetProbeFn(opts) {
    try {
      opts = opts || {};
      var errors = [];
      var CUT = 200;
      var safe = function (label, fn) {
        try { return fn(); } catch (e) { errors.push(label + ': ' + (e && e.message || e)); return undefined; }
      };
      var str = function (v) { return v == null ? null : String(v); };
      var cap = function (v, n) { return typeof v === 'string' && v.length > n ? v.slice(0, n) : v; };
      var clean = function (v, depth) {
        if (typeof v === 'function') return '[fn]';
        if (typeof v === 'string') return v.length > CUT ? v.slice(0, CUT) + '…' : v;
        if (v === null || typeof v !== 'object') return v === undefined ? null : v;
        if (depth > 12) return '[deep]';
        if (Array.isArray(v)) return v.map(function (x) { return clean(x, depth + 1); });
        var o = {};
        Object.keys(v).forEach(function (k) { o[k] = clean(v[k], depth + 1); });
        return o;
      };
      var vals = function (x) {
        if (Array.isArray(x)) return x;
        if (x && typeof x === 'object') return Object.keys(x).map(function (k) { return x[k]; });
        return [];
      };
      var opt = typeof window !== 'undefined' ? window.optimizely : null;
      if (!opt || typeof opt !== 'object' || typeof opt.get !== 'function') return { ok: true, platform: null };
      var data = safe('get(data)', function () { return opt.get('data'); }) || {};
      var exps = vals(data.experiments), auds = vals(data.audiences), pages = vals(data.pages);
      var evs = vals(data.events), camps = vals(data.campaigns);
      var out = {
        ok: true, platform: 'optimizely', projectId: str(data.projectId), revision: str(data.revision),
        counts: { experiments: exps.length, audiences: auds.length, pages: pages.length, events: evs.length, campaigns: camps.length },
        experiments: {}, audiences: {}, pages: {}, events: [], campaigns: {}, visitorCustom: [], errors: errors,
      };
      exps.slice(0, 60).forEach(function (e, i) {
        if (!e) return;
        var id = str(e.id != null ? e.id : i);
        var meta = e.experimentMetadata || {};
        out.experiments[id] = {
          id: id, name: cap(str(e.name), 300), audienceIds: clean(e.audienceIds === undefined ? null : e.audienceIds, 0),
          audienceName: cap(str(e.audienceName), 300), weightDistributions: clean(e.weightDistributions === undefined ? null : e.weightDistributions, 0),
          layerId: str(meta.layerId), allocationPolicy: str(meta.allocationPolicy),
          variations: vals(e.variations).slice(0, 12).map(function (v) { return { id: str(v && v.id), name: cap(str(v && v.name), 200) }; }),
        };
      });
      auds.slice(0, 80).forEach(function (a, i) {
        if (!a) return;
        var id = str(a.id != null ? a.id : i);
        out.audiences[id] = { id: id, name: cap(str(a.name), 300), conditions: clean(a.conditions, 0) };
      });
      pages.slice(0, 150).forEach(function (p, i) {
        if (!p) return;
        var id = str(p.id != null ? p.id : i);
        out.pages[id] = {
          id: id, name: cap(str(p.name), 300), apiName: cap(str(p.apiName), 200), activationType: str(p.activationType),
          hasActivationCode: !!p.activationCode, staticConditions: clean(p.staticConditions === undefined ? null : p.staticConditions, 0),
        };
      });
      evs.slice(0, 400).forEach(function (e) {
        if (!e) return;
        out.events.push({
          id: str(e.id), name: cap(str(e.name), 300), apiName: cap(str(e.apiName), 200), eventType: str(e.eventType),
          pageId: str(e.pageId != null ? e.pageId : e.viewId), selector: cap(str(e.eventFilter && e.eventFilter.selector), 300),
        });
      });
      camps.slice(0, 80).forEach(function (c, i) {
        if (!c) return;
        var id = str(c.id != null ? c.id : i);
        out.campaigns[id] = {
          id: id, name: cap(str(c.name), 300), pageIds: clean(c.pageIds === undefined ? [] : c.pageIds, 0),
          experimentIds: Array.isArray(c.experiments) ? c.experiments.map(function (x) { return str(x && x.id); }) : clean(c.experimentIds === undefined ? [] : c.experimentIds, 0),
          holdback: c.holdback === undefined ? null : c.holdback,
        };
      });
      var visitor = safe('get(visitor)', function () { return opt.get('visitor'); }) || {};
      vals(visitor.custom).slice(0, 50).forEach(function (v) {
        if (v) out.visitorCustom.push({ id: str(v.id), name: cap(str(v.name), 200), value: clean(v.value, 0) });
      });
      return out;
    } catch (e) { return { error: String(e && e.message || e) }; }
  }

  // Wait for the page to stop moving (height steady, fonts loaded), optionally scroll
  // to the bottom and back to wake lazy content, optionally freeze animations. Async:
  // the executeScript call awaits it.
  async function qkSettleFn(opts) {
    try {
      opts = opts || {};
      var firstWait = typeof opts.firstWaitMs === 'number' ? opts.firstWaitMs : 1200, pollMs = opts.pollMs || 250, maxPolls = opts.maxPolls || 12;
      var scrollWait = opts.scrollWaitMs || 400;
      var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      var height = function () { return document.documentElement.scrollHeight; };
      await sleep(firstWait);
      var prev = height(), polls = 0, stable = false;
      while (polls < maxPolls) {
        await sleep(pollMs);
        polls++;
        var cur = height();
        var fontsDone = !document.fonts || document.fonts.status === 'loaded';
        if (cur === prev && fontsDone) { stable = true; break; }
        prev = cur;
      }
      if (opts.scroll) {
        window.scrollTo(0, height());
        await sleep(scrollWait);
        window.scrollTo(0, 0);
        await sleep(300);
      }
      if (opts.freeze && !document.getElementById('__qp_freeze')) {
        var st = document.createElement('style');
        st.id = '__qp_freeze';
        st.textContent = '*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
        (document.head || document.documentElement).appendChild(st);
      }
      return { stable: stable, polls: polls, scrollHeight: height() };
    } catch (e) { return { error: String(e && e.message || e) }; }
  }

  // Text that runs past the viewport or past an overflow:hidden ancestor. Carousels,
  // marquees, ellipsis, screen-reader-only, off-canvas and hidden text are counted in
  // `ignored`, not reported. Measured with the Range of each text node, not its element.
  function qkClipScanFn(opts) {
    try {
      opts = opts || {};
      var t0 = performance.now();
      var de = document.documentElement;
      var vw = de.clientWidth, iw = window.innerWidth, sw = de.scrollWidth;
      var MAX_NODES = opts.maxNodes || 6000, MIN = opts.minGapPx || 2;
      var IGNORE = 'marquee,[role="marquee"],[aria-roledescription="carousel" i],[aria-roledescription="slide" i],[class*="marquee" i],[class*="ticker" i],[class*="carousel" i],[class*="slider" i],[class*="swiper" i],[class*="slick" i],[class*="splide" i],[class*="glide" i],[class*="flickity" i],[class*="owl-" i],[class*="embla" i],[data-carousel]';
      var ignoreInvalid = [];
      if (Array.isArray(opts.ignoreList)) {
        var okSel = [];
        for (var q = 0; q < opts.ignoreList.length; q++) {
          var s0 = String(opts.ignoreList[q] || '').trim();
          if (!s0) continue;
          try { document.documentElement.matches(s0); okSel.push(s0); } catch (_) { ignoreInvalid.push(s0.slice(0, 120)); }
        }
        IGNORE = okSel.join(',');
      }
      var label = function (el) {
        if (!el || !el.tagName) return null;
        var s = el.tagName.toLowerCase();
        if (el.id) { s += '#' + el.id; } else {
          var cn = typeof el.className === 'string' ? el.className : ((el.getAttribute && el.getAttribute('class')) || '');
          var cl = cn.split(/\s+/).filter(Boolean).slice(0, 2);
          if (cl.length) s += '.' + cl.join('.');
        }
        return s.slice(0, 80);
      };
      var boxCache = new Map();
      var clipBoxes = function (el) {
        if (!el || el === de) return [];
        if (boxCache.has(el)) return boxCache.get(el);
        var own = [];
        var cs = getComputedStyle(el);
        if (cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.overflow === 'hidden' || cs.overflow === 'clip') {
          var r = el.getBoundingClientRect();
          var left = r.left + el.clientLeft;
          own.push({ left: left, right: left + el.clientWidth, ellipsis: cs.textOverflow === 'ellipsis', el: el, viewport: false });
        }
        var res = el === document.body ? own : own.concat(clipBoxes(el.parentElement));
        boxCache.set(el, res);
        return res;
      };
      var srOnly = function (el) {
        var n = el;
        for (var i = 0; i < 5 && n && n.nodeType === 1; i++, n = n.parentElement) {
          var r = n.getBoundingClientRect();
          if (r.width <= 2 || r.height <= 2) return true;
          var s = getComputedStyle(n);
          if ((s.clip && s.clip !== 'auto') || (s.clipPath && s.clipPath !== 'none')) return true;
        }
        return false;
      };
      var ignored = { carousel: 0, ellipsis: 0, srOnly: 0, offCanvas: 0, hidden: 0 };
      var offenders = [], nodes = 0, truncated = false;
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) { return /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; },
      });
      var range = document.createRange();
      var node;
      while ((node = walker.nextNode())) {
        if (nodes >= MAX_NODES) { truncated = true; break; }
        nodes++;
        var el = node.parentElement;
        if (!el || el.closest('script,style,noscript,template,svg')) continue;
        if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) { ignored.hidden++; continue; }
        if (IGNORE && el.closest(IGNORE)) { ignored.carousel++; continue; }
        range.selectNodeContents(node);
        var raw = range.getClientRects(), rects = [];
        for (var k = 0; k < raw.length; k++) { if (raw[k].width > 0.5 && raw[k].height > 0.5) rects.push(raw[k]); }
        if (!rects.length) continue;
        var boxes = [{ left: 0, right: vw, viewport: true, ellipsis: false, el: null }].concat(clipBoxes(el));
        var worst = null, anyInside = false;
        for (var a = 0; a < rects.length; a++) {
          var rc = rects[a];
          for (var b = 0; b < boxes.length; b++) {
            var bx = boxes[b];
            if (rc.right <= bx.left || rc.left >= bx.right) continue;
            anyInside = true;
            var gr = bx.right - rc.right, gl = rc.left - bx.left;
            var gap = Math.min(gr, gl);
            if (gap < -MIN && (!worst || gap < worst.gap || (gap === worst.gap && !bx.viewport && worst.box.viewport))) {
              worst = { gap: gap, side: gr <= gl ? 'right' : 'left', box: bx, rect: rc };
            }
          }
        }
        var text = (node.nodeValue || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        var pack = function (gapPx, side, by, clipEl, rc2) {
          return {
            text: text, gapPx: Math.round(gapPx), side: side, by: by, clipBy: label(clipEl), el: label(el),
            rect: { x: Math.round(rc2.left), y: Math.round(rc2.top + window.scrollY), w: Math.round(rc2.width), h: Math.round(rc2.height) },
          };
        };
        if (!anyInside) {
          var r0 = rects[0];
          if (sw > vw + MIN && r0.left >= vw && r0.left < sw) offenders.push(pack(vw - r0.right, 'right', 'page-overflow', null, r0));
          else ignored.offCanvas++;
          continue;
        }
        if (worst) {
          if (worst.box.ellipsis) ignored.ellipsis++;
          else if (srOnly(el)) ignored.srOnly++;
          else offenders.push(pack(worst.gap, worst.side, worst.box.viewport ? 'viewport' : 'overflow', worst.box.el, worst.rect));
        }
      }
      offenders.sort(function (x, y) { return x.gapPx - y.gapPx; });
      return {
        vw: vw, iw: iw, sw: sw, pageOverflowPx: Math.max(0, sw - vw), dpr: window.devicePixelRatio, nodes: nodes,
        truncated: truncated, offenderCount: offenders.length, worstGapPx: offenders.length ? offenders[0].gapPx : 0,
        offenders: offenders.slice(0, 25), ignored: ignored, ignoreInvalid: ignoreInvalid, ms: Math.round(performance.now() - t0),
      };
    } catch (e) { return { error: String(e && e.message || e) }; }
  }

  // Outline the offending text of a tile and bring it to the middle of the viewport; returns its rect and the viewport.
  function qkTileMarkFn(text, y) {
    try {
      var want = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      var vw = window.innerWidth, vh = window.innerHeight;
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var n;
      while (want && (n = walker.nextNode())) {
        var t = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (t && t.indexOf(want) === 0 && n.parentElement) {
          n.parentElement.style.outline = '2px solid #e00';
          n.parentElement.scrollIntoView({ block: 'center' });
          var range = document.createRange();
          range.selectNodeContents(n);
          var r = range.getBoundingClientRect();
          return { found: true, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, vw: vw, vh: vh };
        }
      }
      window.scrollTo(0, Math.max(0, (y || 0) - vh / 2));
      return { found: false, rect: { x: 0, y: Math.round(Math.max(0, (y || 0) - window.scrollY)), w: 0, h: 0 }, vw: vw, vh: vh };
    } catch (e) { return { error: String(e && e.message || e) }; }
  }

  // The state of one experiment (MAIN world): the state API, the snippet's data, the pages it targets. A bucket (variation)
  // is read null-guarded; activated means isActive === true, which is not the same as having a bucket.
  function qkExperimentStateFn(args) {
    try {
      args = args || {};
      var opt = window.optimizely;
      if (!opt || typeof opt !== 'object' || typeof opt.get !== 'function') return { ok: true, platform: null };
      var errors = [];
      var safe = function (label, fn) { try { return fn(); } catch (e) { errors.push(label + ': ' + String(e && e.message || e).slice(0, 200)); return undefined; } };
      var str = function (v) { return v == null ? null : String(v); };
      var vals = function (x) { if (Array.isArray(x)) return x; if (x && typeof x === 'object') return Object.keys(x).map(function (k) { return x[k]; }); return []; };
      var data = safe('get(data)', function () { return opt.get('data'); }) || {};
      var api = safe('get(state)', function () { return opt.get('state'); }) || null;
      var states = (api && typeof api.getExperimentStates === 'function' && safe('getExperimentStates', function () { return api.getExperimentStates(); })) || {};
      var activeList = (api && typeof api.getActiveExperimentIds === 'function' && safe('getActiveExperimentIds', function () { return api.getActiveExperimentIds(); })) || [];
      var activeIds = [];
      Object.keys(states).forEach(function (k) { if (states[k] && states[k].isActive === true && activeIds.indexOf(String(k)) < 0) activeIds.push(String(k)); });
      vals(activeList).forEach(function (k) { if (activeIds.indexOf(String(k)) < 0) activeIds.push(String(k)); });
      var exps = vals(data.experiments);
      var expId = args.experimentId != null && String(args.experimentId) !== '' ? String(args.experimentId) : null;
      var source = expId ? 'given' : null;
      var forced = (args.forcedIds || []).map(String);
      if (!expId && forced.length) {
        for (var i = 0; i < exps.length && !expId; i++) {
          var vs = vals(exps[i] && exps[i].variations);
          for (var j = 0; j < vs.length; j++) { if (vs[j] && forced.indexOf(str(vs[j].id)) >= 0) { expId = str(exps[i].id); source = 'forced-variation'; break; } }
        }
      }
      var out = { ok: true, platform: 'optimizely', experimentId: expId, source: source, inData: false, inState: false, isActive: null,
        variationId: null, variationName: null, reason: null, pageIds: [], pageTypes: [], variationIds: [], activeIds: activeIds.slice(0, 50), errors: errors };
      if (!expId) return out;
      var def = null;
      for (var a = 0; a < exps.length; a++) { if (exps[a] && str(exps[a].id) === expId) { def = exps[a]; break; } }
      out.inData = !!def;
      if (def) {
        out.variationIds = vals(def.variations).map(function (v) { return str(v && v.id); }).filter(Boolean).slice(0, 20);
        var layer = str(def.layerId != null ? def.layerId : (def.experimentMetadata && def.experimentMetadata.layerId));
        var camps = vals(data.campaigns), camp = null;
        for (var c = 0; c < camps.length; c++) {
          var cp = camps[c]; if (!cp) continue;
          var ids = Array.isArray(cp.experimentIds) ? cp.experimentIds.map(String) : vals(cp.experiments).map(function (x) { return str(x && x.id); });
          if ((layer && str(cp.id) === layer) || ids.indexOf(expId) >= 0) { camp = cp; break; }
        }
        var pages = data.pages || {}, pageList = vals(pages);
        (camp && Array.isArray(camp.pageIds) ? camp.pageIds : []).slice(0, 20).forEach(function (pid) {
          var pg = (pages && !Array.isArray(pages) && pages[pid]) || pageList.filter(function (p) { return p && str(p.id) === str(pid); })[0] || null;
          out.pageIds.push(str(pid));
          out.pageTypes.push(pg ? (pg.activationType == null ? 'immediate' : String(pg.activationType)) : null);
        });
      }
      var st = states[expId] || null;
      out.inState = !!st;
      if (st) {
        out.isActive = typeof st.isActive === 'boolean' ? st.isActive : null;
        out.variationId = str((st.variation || {}).id);
        out.variationName = str((st.variation || {}).name);
        out.reason = st.reason == null ? null : String(st.reason).slice(0, 200);
      } else {
        out.isActive = def ? false : null;
      }
      if (out.isActive !== true && activeIds.indexOf(expId) >= 0) out.isActive = true;
      return out;
    } catch (e) { return { error: String(e && e.message || e) }; }
  }

  // Pick the first visible match of a selector, test five points for what is on top, and refuse a covered or purchase-like
  // target (isolated world). Never clicks: the worker dispatches the mouse events at the coordinates returned.
  function qkClickTargetFn(selector) {
    try {
      var label = function (el) {
        if (!el || !el.tagName) return null;
        var s = el.tagName.toLowerCase();
        if (el.id) { s += '#' + el.id; } else {
          var cn = typeof el.className === 'string' ? el.className : ((el.getAttribute && el.getAttribute('class')) || '');
          var cl = cn.split(/\s+/).filter(Boolean).slice(0, 2);
          if (cl.length) s += '.' + cl.join('.');
        }
        return s.slice(0, 80);
      };
      var list;
      try { list = document.querySelectorAll(String(selector)); } catch (e) { return { ok: false, reason: 'bad-selector', error: String(e && e.message || e).slice(0, 200) }; }
      if (!list.length) return { ok: false, reason: 'not-found', matches: 0 };
      var el = null;
      for (var i = 0; i < list.length; i++) {
        var r0 = list[i].getBoundingClientRect();
        var vis = typeof list[i].checkVisibility === 'function' ? list[i].checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true;
        if (vis && r0.width > 0 && r0.height > 0) { el = list[i]; break; }
      }
      if (!el) return { ok: false, reason: 'not-visible', matches: list.length, label: label(list[0]) };
      var words = String(el.innerText || el.value || (el.getAttribute && el.getAttribute('aria-label')) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (/\b(buy now|buy|purchase|pay now|pay|place (?:my )?order|complete (?:my )?(?:order|purchase)|submit (?:my )?(?:order|payment)|unsubscribe|delete|remove (?:my )?account|sign out|log ?out)\b/i.test(words)) {
        return { ok: false, reason: 'unsafe', why: 'its text reads "' + words.slice(0, 60) + '"', matches: list.length, label: label(el) };
      }
      var link = el.closest ? el.closest('a[href]') : null;
      if (link && link.origin && link.origin !== location.origin) return { ok: false, reason: 'unsafe', why: 'it is a link to another site', matches: list.length, label: label(el) };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      var r = el.getBoundingClientRect();
      var pts = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
      var first = null;
      for (var p = 0; p < pts.length; p++) {
        var x = r.left + r.width * pts[p][0], y = r.top + r.height * pts[p][1];
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
        var hit = document.elementFromPoint(x, y);
        if (p === 0) first = hit;
        if (hit && (hit === el || el.contains(hit))) {
          return { ok: true, x: Math.round(x), y: Math.round(y), matches: list.length, label: label(el), rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
        }
      }
      return { ok: false, reason: 'covered', matches: list.length, label: label(el), coveredBy: label(first) || 'something on top' };
    } catch (e) { return { ok: false, reason: 'error', error: String(e && e.message || e).slice(0, 200) }; }
  }

  // What the hygiene shim recorded (names only), reset after reading.
  function qkClearedFn() { try { var a = window.__qkCleared || []; window.__qkCleared = []; return { names: a.slice(0, 100).map(String) }; } catch (e) { return { error: String(e && e.message || e) }; } }

  // Storage and cookie names (never values) that match the patterns or the Optimizely default.
  function qkStorageNamesFn(patterns) {
    try {
      var A = Array.isArray(patterns) ? patterns.map(String) : [];
      var hit = function (n) {
        if (/^optimizely/i.test(n)) return true;
        for (var i = 0; i < A.length; i++) {
          var p = A[i];
          if (p.charAt(p.length - 1) === '*') { if (n.indexOf(p.slice(0, -1)) === 0) return true; } else if (n === p) return true;
        }
        return false;
      };
      var names = function (st) {
        var out = [];
        try { for (var i = 0; i < st.length && out.length < 100; i++) { var k = st.key(i); if (k && hit(k)) out.push(String(k)); } } catch (_) { return []; }
        return out;
      };
      var local = [], session = [], cookies = [];
      try { local = names(localStorage); } catch (_) { local = []; }
      try { session = names(sessionStorage); } catch (_) { session = []; }
      try {
        var cs = document.cookie ? document.cookie.split(';') : [];
        for (var c = 0; c < cs.length && cookies.length < 100; c++) {
          var n = cs[c].split('=')[0].replace(/^\s+|\s+$/g, '');
          if (n && hit(n)) cookies.push(n);
        }
      } catch (_) { cookies = []; }
      return { local: local, session: session, cookies: cookies };
    } catch (e) { return { error: String(e && e.message || e) }; }
  }

  // The document-start hygiene shim for one run's app keys (D6): removes the Optimizely storage keys and the keys that
  // match the (cleaned) patterns from both storages, and expires the matching readable cookies, once without a domain and
  // once per parent domain; each name goes into window.__qkCleared. Raw ES5, registered with
  // Page.addScriptToEvaluateOnNewDocument and removed right after the load event.
  function qkHygieneShim(appKeys) {
    const P = JSON.stringify(qkCleanPatterns(appKeys));
    return [
      "(function(){var A=",
      P,
      ",out=window.__qkCleared=window.__qkCleared||[];",
      "function hit(n){if(/^optimizely/i.test(n))return true;for(var i=0;i<A.length;i++){var p=A[i];if(p.charAt(p.length-1)==='*'){if(n.indexOf(p.slice(0,-1))===0)return true;}else if(n===p)return true;}return false;}",
      "function wipe(st,label){try{var ks=[],i,k;for(i=0;i<st.length;i++){k=st.key(i);if(k&&hit(k))ks.push(k);}for(i=0;i<ks.length;i++){st.removeItem(ks[i]);out.push(label+':'+ks[i]);}}catch(_){}}",
      "try{wipe(localStorage,'local');}catch(_){}",
      "try{wipe(sessionStorage,'session');}catch(_){}",
      "try{var cs=document.cookie?document.cookie.split(';'):[],c,n,d,names=[];for(c=0;c<cs.length;c++){n=cs[c].split('=')[0].replace(/^\\s+|\\s+$/g,'');if(n&&(/^(optimizely|_conv_)/i.test(n)||hit(n)))names.push(n);}",
      "var host=location.hostname,parts=host.split('.'),doms=[''];if(!/^[0-9.]+$/.test(host)&&host.indexOf(':')<0){for(d=0;d<parts.length-1;d++){doms.push(d===0?host:'.'+parts.slice(d).join('.'));}}",
      "for(c=0;c<names.length;c++){for(d=0;d<doms.length;d++){document.cookie=names[c]+'=; Max-Age=0; path=/'+(doms[d]?'; domain='+doms[d]:'');}out.push('cookie:'+names[c]);}}catch(_){}",
      "})();",
    ].join('');
  }

  Object.assign(EXPORTS, {
    qkPageFactsFn, qkSettleFn, qkSnippetProbeFn, qkClipScanFn, qkTileMarkFn, qkExperimentStateFn, qkClickTargetFn,
    qkClearedFn, qkStorageNamesFn, qkHygieneShim, QK_IGNORE_DEFAULTS,
  });

  // ── Run helpers ──────────────────────────────────────────────────────────
  // The record of one page load (exactly 15 keys); the worker fills it in.
  function qkNewLoad(spec, n) {
    spec = spec || {};
    const url = String(spec.url == null ? '' : spec.url);
    const parts = qkSplitUrl(url);
    return {
      id: 'L' + n,
      role: spec.role == null ? null : spec.role,
      label: spec.label == null ? null : qkMaskOutput(spec.label),
      url: qkMaskOutput(url),
      path: qkPathOnly(url),
      final: null,
      width: spec.width == null ? null : spec.width,
      keepState: !!spec.keepState,
      forced: !!parts && parts.params.some(function (p) { return qkKeyOf(p[0]) === 'optimizely_x'; }),
      ok: false,
      loadError: null,
      blocked: null,
      ms: 0,
      settle: null,
      cleared: null,
    };
  }
  // A bot check ends the whole run: the error carries what rec.halted keeps. `x` is a load record or a click result.
  function qkHaltError(x) {
    x = x || {};
    const signal = (x.blocked && (x.blocked.signal || x.blocked.reason)) || 'challenge';
    const path = qkMaskOutput(x.path || (x.final ? (qkPathOnly(x.final) || String(x.final).split(/[?#]/)[0]) : ''));
    const e = new Error('a bot check (' + signal + ') on ' + (path || '(no address)') + ' halted the run');
    e.qkHalt = true;
    e.halted = { loadId: x.id || null, path: path, signal: signal };
    return e;
  }
  function qkIsHalt(e) { return !!(e && e.qkHalt); }
  function qkIsStop(e) { return !!(e && e.qkStop); }
  function qkIsFatal(e) { return !!(e && e.qkFatal); }
  // io.load, recorded in rec.loads (under the cap); a bot page halts the run.
  async function qkLoadInto(io, rec, spec) {
    const L = await io.load(spec);
    if (!Array.isArray(rec.loads)) rec.loads = [];
    if (L && rec.loads.length < QK_MAX_LOADS_KEPT) rec.loads.push(L);
    if (L && L.blocked) throw qkHaltError(L);
    return L;
  }
  function qkHaltIfBlocked(r) {
    if (r && r.blocked) throw qkHaltError(r);
    return r;
  }
  // The page function's answer reduced to what the rows need. `activated` is isActive === true: a bucket is not activation.
  function qkStateSummary(raw, forcedIds) {
    if (raw === null || raw === undefined) return { readable: false, error: 'no result (the page script failed)' };
    if (raw.error) return { readable: false, error: qkMaskOutput(raw.error) };
    if (raw.platform == null) return { readable: true, platform: null, activated: false, activeIds: [] };
    const types = (raw.pageTypes || []).filter(function (t) { return t != null; });
    const cond = types.filter(function (t) { return QK_CONDITIONAL_ACTIVATION.indexOf(t) >= 0; })[0] || null;
    const forced = Array.isArray(forcedIds) ? forcedIds.map(String) : [];
    const pageIds = raw.pageIds || [];
    return {
      readable: true,
      platform: 'optimizely',
      experimentId: raw.experimentId == null ? null : raw.experimentId,
      experimentIdSource: raw.source == null ? null : raw.source,
      inSnippet: !!raw.inData,
      inState: !!raw.inState,
      activated: raw.isActive === true,
      isActive: raw.isActive === undefined ? null : raw.isActive,
      variationId: raw.variationId == null ? null : raw.variationId,
      variationName: raw.variationName == null ? null : raw.variationName,
      reason: raw.reason == null ? null : qkMaskOutput(raw.reason),
      activationType: cond || (types.length ? 'immediate' : null),
      conditional: types.length ? !!cond : null,
      pageId: pageIds[0] || null,
      pageIds: pageIds,
      variationIds: raw.variationIds || [],
      activeIds: raw.activeIds || [],
      servedForced: forced.length ? (raw.isActive === true && forced.indexOf(String(raw.variationId)) >= 0) : null,
    };
  }
  // Loads that were neither a returning visitor (keepState) nor a forced preview: each is a new visitor to the live site.
  function qkFreshCount(loads) {
    return (loads || []).filter(function (L) { return L && !L.keepState && !L.forced; }).length;
  }
  function qkFreshText(n) {
    return 'Fresh visitors: ' + n + ' load(s) of the live site as a new visitor (Selenite clears the Optimizely cookies before each).';
  }
  function qkCountSources(input) {
    const src = (input && input.sources) || {};
    const c = { ticket: 0, typed: 0 };
    Object.keys(src).forEach(function (k) { if (src[k] === 'ticket' || src[k] === 'typed') c[src[k]]++; });
    return c;
  }
  // The two Console lines of a run: {level, text}; the text carries the [label] prefix, and B's qkwConsole writes it
  // as given (masked), adding no prefix of its own. Every end line says how long the run took.
  function qkConsoleStart(label, rec) {
    rec = rec || {};
    const c = qkCountSources(rec.input);
    return {
      level: 'INFO',
      text: '[' + label + '] Run started · ticket ' + (rec.ticketKey ? qkMaskOutput(rec.ticketKey) : 'none') + ' · ' + c.ticket + ' input(s) from the ticket, ' + c.typed + ' typed',
    };
  }
  function qkConsoleEnd(label, rec) {
    rec = rec || {};
    const counts = qkCountsLine(qkCounts(rec.rows));
    const secs = (Math.max(0, (rec.finishedAt || 0) - (rec.startedAt || 0)) / 1000).toFixed(1);
    let level = 'INFO', what = 'finished';
    if (rec.halted) { level = 'WARNING'; what = 'halted by a bot check on ' + (qkMaskOutput(rec.halted.path) || '(no address)'); }
    else if (rec.error) { level = 'ERROR'; what = 'ended on an error'; }
    else if (rec.stopped) { level = 'WARNING'; what = 'stopped by the tester'; }
    return { level: level, text: '[' + label + '] Run ' + what + ' in ' + secs + 's · ' + counts };
  }

  Object.assign(EXPORTS, {
    qkNewLoad, qkHaltError, qkIsHalt, qkIsStop, qkIsFatal, qkLoadInto, qkHaltIfBlocked, qkStateSummary, qkFreshCount,
    qkFreshText, qkConsoleStart, qkConsoleEnd,
  });

  Object.keys(EXPORTS).forEach(function (k) { g[k] = EXPORTS[k]; });
})(typeof globalThis !== 'undefined' ? globalThis : this);
