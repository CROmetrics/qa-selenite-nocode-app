// Email Check worker suite: the worker side of the Test Agent mode 'emailcheck' (the ecw* section of background.js), run as a
// service worker would run it, against fakes: a scripted chrome.tabs and chrome.scripting.executeScript, a fetch router that
// plays Mailtrap-less web (Pardot, destinations, Email on Acid, the Docs API, the Sheets API), a scripted model.
//
//   RUN:  cd extension/tests && jsc email-check-worker.test.js
//   (jsc ships with macOS at
//    /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
//    - add it to PATH or invoke by full path.)
//
// DATA RULE. The repository is public: this suite runs on the SYNTHETIC fixtures only (fixtures-email-*.json, written by
// gen-email-fixtures.py: org Example Relief, tickets EX-1 and EX-2, hosts under example.org). It quotes no real copy, ticket
// text, id or URL. The real-data counterpart lives in a git-excluded local suite.
//
// What these pin, and why each matters:
// - NEVER-FETCH. A link guarded in ANY proof (text, path or position: Unsubscribe, View in browser, preferences, an empty first or
//   last anchor) is never requested, whichever proof it comes up in; each tracked linkId is requested at most once per run; the
//   caps hold (20 distinct linkIds per proof, 80 tracked-link GETs per run); destinations are requested WITHOUT their query and
//   without cookies; Stop is checked before every request.
// - THE GATE OVERRIDE. globalThis.__ecGateOrigins is honoured only for http://127.0.0.1:<port> values, refuses every origin it does
//   not map, fails closed when malformed, is never assigned in extension/*.js, and in production localhost / private addresses are refused.
// - A PAGE SCRIPT THAT THROWS resolves {result:null} in Chrome (measured, 154): every read of the page treats it as "no data" and the
//   run goes on. Nothing here rejects for a throw.
// - THE SHEET. ecSheetApply writes F and G only on visual or dark-mode rows, checked against the sheet as it is NOW; one violation
//   refuses the whole apply; row 1 is never written.
// - SCRUB. Nothing identifying (inbox address, prospect id, tracked hash, message-part path, bounce address, token) survives into a record.
//
// Every section runs inside T(), so a throw (a bug) is ONE failure and the next section still runs. A throwing assertion in a plain script would abort the whole suite.

// jsc has no URL: a two-field stand-in is enough for originOf() in the worker.
globalThis.URL = function URL(u) {
  var m = /^(https?:)\/\/([^\/?#]+)/.exec(String(u));
  if (!m) throw new TypeError('Invalid URL');
  this.protocol = m[1]; this.origin = m[1] + '//' + m[2];
};
globalThis.crypto = { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = i * 7 + 1; return a; } };
load('queue-agent-harness.js');
// Exactly what the worker imports, in its order (background.js's importScripts line): the libraries, then qa-pass.js and email-check.js.
var WORKER_SRC = readFile('../background.js');
(function () {
  var m = /importScripts\(([^)]*)\)/.exec(WORKER_SRC);
  if (!m) throw new Error('importScripts line not found in background.js');
  m[1].match(/'[^']+'/g).map(function (s) { return s.slice(1, -1); }).forEach(function (f) { load('../' + f); });
})();

// adfText and adfTextWithHrefs are sliced out of popup.js (it is not loadable in jsc).
var _pu = readFile('../popup.js');
eval(_pu.slice(_pu.indexOf('function adfText(node) {'), _pu.indexOf('\n// Jira comments kept on the Test Context')));

function fx(name) { return JSON.parse(readFile('fixtures-email-' + name + '.json')); }
var PROOFS = fx('proofs').tickets, INTER = fx('interstitials'), EOA = fx('eoa'), JIRA = fx('jira'), DOCS = { 'EX-1': fx('doc-ex1'), 'EX-2': fx('doc-ex2') }, PLANS = fx('plans');
var X = EC_PROFILES.example;

// ── harness ────────────────────────────────────────────────────────────────
var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 300) : ''));
}
function eq(name, actual, expected) { ok(name, actual === expected, { actual: actual, expected: expected }); }
function jeq(name, actual, expected) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(name, a === e, { actual: a, expected: e });
}
function section(t) { print('\n' + t); }
function T(title, fn) {
  section(title);
  var p0 = pass, f0 = fail;
  try { fn(); } catch (e) { fail++; failures.push(title + '  THREW ' + String(e && e.message ? e.message : e).slice(0, 200)); }
  print('  [' + (pass - p0) + ' passed, ' + (fail - f0) + ' failed]');
}
function count(arr, pred) { return arr.filter(pred).length; }
function distinct(arr) { var s = {}; arr.forEach(function (x) { s[x] = 1; }); return Object.keys(s); }

// ═══ The fixtures, as a run sees them ═══════════════════════════════════════════════════════════════════════════
var SK_BOTH = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/documents.readonly';
var DOC_URL = { 'EX-1': 'https://docs.google.com/document/d/EXDOC_EX1_COPY_DOC_000000000001/edit', 'EX-2': 'https://docs.google.com/document/d/EXDOC_EX2_COPY_DOC_000000000002/edit' };
var MT_ORIGIN = 'https://mailtrap.io', PARDOT = 'https://marketing.example.org', DEST = 'https://www.example.org', EOA_HOST = 'https://app.emailonacid.com', IMG_HOST = 'https://images.emailonacid.com', DOCS_HOST = 'https://docs.googleapis.com', SHEETS = 'https://sheets.googleapis.com/';

// The worker context of a ticket, as the panel sends it (ecCtxForWorker of the Initialize tab's parse of the ticket).
function mkCtx(tk, over) {
  var parsed = ecParseEmailLinks(adfTextWithHrefs(JIRA[tk].fields.description));
  var ctx = ecCtxForWorker({ reviewed: true, ticketKey: tk, summary: JIRA[tk].fields.summary, copyFileUrl: DOC_URL[tk], emailProofs: parsed.proofs, emailEoa: parsed.eoa });
  return Object.assign(ctx, over || {});
}
// The settings the panel sends: the rules ecSuggestRules suggests from the ticket's comments (source 'suggested').
function mkSettings(tk, over) {
  var comments = JIRA[tk].fields.comment.comments.map(function (c) { return { id: c.id, created: c.created, text: adfText(c.body) }; });
  var r = ecSuggestRules(comments, ['Regular Donors', 'Major Donors'], X), seg = {};
  Object.keys(r.segmentPaths).forEach(function (k) { seg[k] = { value: r.segmentPaths[k].value, source: 'suggested', commentId: r.segmentPaths[k].commentId }; });
  var s = { profileId: '', docEmail: null, eoaRenders: true,
    utmRule: r.utmRule ? { value: r.utmRule.value, source: 'suggested', commentId: r.utmRule.commentId } : { value: '', source: 'none', commentId: null },
    segmentPaths: seg, onlyIn: r.onlyIn };
  return Object.assign(s, over || {});
}
// The html a proof's tab would return, with the quoted-printable rule of the worker: decoded only when the part says so AND the text shows =3D or a soft break.
function htmlOfProof(p, extra) {
  var h = p.htmlsource, enc = ecPartEncodings(p.raw).html;
  if (/quoted-printable/i.test(String(enc || '')) && (/=3D/.test(h) || /=\r?\n/.test(h))) h = ecDecodeQP(h);
  return extra ? h.replace('</body>', extra + '</body>') : h;
}
// The tracked linkIds a run must request, computed from the fixtures with the plain parsing functions only: distinct, in no proof guarded.
function expectedPardotIds(tk, injected) {
  var seen = {}, guarded = {};
  PROOFS[tk].proofs.forEach(function (p) {
    ecLinkPlan(ecVisibleText(htmlOfProof(p, injected && injected[p.messageId])).anchors, X).forEach(function (l) {
      if (l.kind !== 'pardot') return;
      if (l.guard) guarded[l.linkId] = 1; else seen[l.linkId] = 1;
    });
  });
  return Object.keys(seen).filter(function (id) { return !guarded[id]; });
}
// A tracked linkId that two proofs of EX-2 share (the footer and social links of the two v0 proofs): the same link, one request.
var SHARED_ID = (function () {
  var seen = {}, shared = [];
  PROOFS['EX-2'].proofs.forEach(function (p) {
    distinct(ecLinkPlan(ecVisibleText(htmlOfProof(p)).anchors, X).filter(function (l) { return l.kind === 'pardot' && !l.guard; }).map(function (l) { return l.linkId; })).forEach(function (id) {
      if (seen[id]) shared.push(id); seen[id] = 1;
    });
  });
  return shared[0];
})();
function eoaGuid(html) { return /"guid":"([A-Za-z0-9]+)"/.exec(html)[1]; }
var EOA_BY_GUID = {};
Object.keys(EOA).forEach(function (tk) { Object.keys(EOA[tk]).forEach(function (v) { EOA_BY_GUID[eoaGuid(EOA[tk][v])] = EOA[tk][v]; }); });
function eoaCodes(html) { var out = [], re = /"image_folder":"([^"]+)"/g, m; while ((m = re.exec(html))) out.push(m[1]); return out; }

var FORBIDDEN = ['@inbox.mailtrap.io', '2000000002', 'SynthHash0', '0123456789abcdef0123456789abcdef', '/h/', 'testing_message_parts', 'SYNTHETICTOKEN', 'bounce-', 'List-Unsubscribe', 'Received', '192.0.2.1', 'Bearer', 'tok1', 'tok2'];
function leaks(x) { var s = typeof x === 'string' ? x : JSON.stringify(x); return FORBIDDEN.filter(function (f) { return s.indexOf(f) >= 0; }); }

// ═══ The worker world ═══════════════════════════════════════════════════════════════════════════════════════════
// One fresh worker (queue-agent-harness) with: chrome.tabs scripted (a tab completes 400 ms after it is created; Mailtrap redirects to /signin
// when signed out; a challenge title for o.challengeMs), chrome.scripting.executeScript answered by function name over the synthetic proofs (it
// resolves {result:null} for a function that "throws", never rejects, like Chrome), and a fetch router (st.reqs logs every request).
// o: ticket, signedIn (true), noAccount, challengeMs, neverComplete, missing {messageId:true}, execNull {fnName | fnName@messageId: 'null' | 'reject'},
//    inject {messageId: html}, proofs (custom message parts by id), eoa500, eoaImages (count), imgJpegBytes, imgFail, token (false | scope), docStatus (+ docError: the JSON body of that answer),
//    gate (an object assigned to globalThis.__ecGateOrigins), onRequest(req, st) (a hook per fetch request), pardot {linkId: {status, body, url}} (the answer of a tracked link; url = where its redirects ended),
//    destFinal(path) (the address a destination request ends at after redirects, or a falsy value for none).
function ecWorld(o) {
  o = o || {};
  var tk = o.ticket || 'EX-2';
  var w = QA_HARNESS.makeWorld({ page: QA_HARNESS.makePage({ url: 'about:blank' }), apiKey: o.apiKey });
  w.src = '../background.js';
  var st = { reqs: [], created: [], removed: [], tabs: {}, tabSeq: 100, execs: [], tabGets: 0, signedIn: o.signedIn !== false, foreign: [], reads: 0, docReqs: 0, pardotReqs: [], eoaGuidByTab: {}, docToken: o.docToken, getsById: {} };
  w.st = st;
  var byMsg = {};
  PROOFS[tk].proofs.forEach(function (p) { byMsg[p.messageId] = p; });
  Object.keys(o.proofs || {}).forEach(function (id) { byMsg[id] = o.proofs[id]; });
  st.byMsg = byMsg;

  w.store.sync.googleOAuthClientId = 'cid.apps.googleusercontent.com';
  if (o.token !== false) w.store.session.qpGoogleToken = { accessToken: 'tok1', expiresAt: w.clock.now + 3600000, scope: typeof o.token === 'string' ? o.token : SK_BOTH };
  if (o.identity) w.chrome.identity = o.identity(w, st);

  // tabs
  w.chrome.tabs.create = function (props) {
    var id = ++st.tabSeq, url = String(props.url);
    var t = { id: id, url: 'about:blank', title: '', status: 'loading', active: !!props.active, windowId: props.windowId, doneAt: null };
    var u = /^(https?:\/\/[^\/]+)(\/[^?#]*)?/.exec(url) || [url, url, '/'];
    var finalUrl = url;
    if (/^https?:\/\/(?:mailtrap\.io|127\.0\.0\.1:\d+)\/sandboxes\//.test(url) && !st.signedIn) finalUrl = u[1] + '/signin';
    st.created.push({ id: id, props: props, t: w.clock.now });
    st.tabs[id] = t;
    t.pendingUrl = url;
    var eg = /acidtest\/([A-Za-z0-9]+)/.exec(url);
    if (eg) st.eoaGuidByTab[id] = eg[1];
    if (!(o.neverComplete && /\/sandboxes\//.test(url))) w.at(400, function () { if (!st.tabs[id]) return; t.url = finalUrl; t.status = 'complete'; t.doneAt = w.clock.now; });
    return Promise.resolve({ id: id, url: t.url, status: 'loading' });
  };
  w.chrome.tabs.get = function (id, cb) {
    st.tabGets++;
    st.getsById[id] = (st.getsById[id] || 0) + 1;
    var t = st.tabs[id], r = null;
    if (t) {
      var inChallenge = t.doneAt != null && (w.clock.now - t.doneAt) < (o.challengeMs || 0);
      r = { id: id, url: t.url, status: t.status, title: t.status !== 'complete' ? '' : (inChallenge ? 'Just a moment...' : 'Sandbox'), active: t.active, windowId: t.windowId };
    }
    if (cb) { cb(r); return undefined; }
    return r ? Promise.resolve(r) : Promise.reject(new Error('No tab with id: ' + id + '.'));
  };
  w.chrome.tabs.remove = function (id) { st.removed.push(id); delete st.tabs[id]; return Promise.resolve(); };

  // the page functions, answered by name (the real ones live in email-check.js)
  var EXEC = {
    ecMailtrapProbeFn: function (args) {
      if (!st.signedIn) return { ok: false, state: 'signed-out', error: 'not signed in' };
      if (o.noAccount) return { ok: false, state: 'no-account', error: 'no such sandbox' };
      return { ok: true, acct: '222' };
    },
    ecMailtrapReadFn: function (args) {
      st.reads++;
      var p = byMsg[String(args[2])];
      if (o.missing && o.missing[String(args[2])] || !p) return { ok: false, state: 'not-found', error: 'HTTP 404' };
      // the shape of the real ecMailtrapReadFn: the message parts at the top level of the answer
      return { ok: true, state: 'ok', msg: p.message, html: htmlOfRaw(p, o.inject && o.inject[String(args[2])]), txt: p.text, raw: p.raw, headers: p.mailHeaders, spam: p.spamReport, truncated: !!(o.truncated && o.truncated[String(args[2])]), status: { msg: 200, html: 200, txt: 200, raw: 200, headers: 200, spam: 200 } };
    },
    ecEoaImagesFn: function (args, tabId) {
      var guid = st.eoaGuidByTab[tabId], codes = eoaCodes(EOA_BY_GUID[guid] || '');
      var n = o.eoaImages || codes.length, imgs = [];
      for (var i = 0; i < n; i++) imgs.push({ src: String(args[0]) + '/web/' + guid + '/' + codes[i % codes.length] + (i >= codes.length ? '_x' + i : '') + '.png', w: 340, h: 800 });
      return { ok: true, state: 'ok', images: imgs, count: n, loaded: n };
    },
  };
  function htmlOfRaw(p, extra) { return extra ? p.htmlsource.replace('</body>', extra + '</body>') : p.htmlsource; }
  w.chrome.scripting.executeScript = function (opts) {
    var name = opts.func && opts.func.name;
    if (!name) return Promise.resolve([]);
    var tabId = opts.target && opts.target.tabId, args = opts.args || [];
    st.execs.push({ name: name, tabId: tabId, args: args });
    var key = name + '@' + String(args[2]), mode = (o.execNull && (o.execNull[key] || o.execNull[name])) || null;
    if (mode === 'reject') return Promise.reject(new Error('Frame with ID 0 was removed.'));
    if (mode === 'null') return Promise.resolve([{ documentId: 'd', frameId: 0, result: null }]);
    var f = EXEC[name], r = null;
    try { r = f ? f(args, tabId) : null; } catch (e) { r = null; }
    if (name === 'ecMailtrapReadFn' && o.afterRead) o.afterRead(st.reads, w, st);
    return Promise.resolve([{ documentId: 'd', frameId: 0, result: r === undefined ? null : r }]);
  };

  // the fetch router
  w.boot();
  var inner = w.fetch;
  function resp(status, body, url, kind) {
    return { ok: status >= 200 && status < 300, status: status, statusText: 'status ' + status, url: url,
      text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); },
      json: function () { return Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body); },
      arrayBuffer: function () { var n = typeof body === 'number' ? body : 8; return Promise.resolve(new Uint8Array(n).buffer); } };
  }
  function interstitialFor(linkId, slug) {
    var keys = Object.keys(INTER[tk] || {}).filter(function (k) { return k.slice(-(linkId.length + 1)) === '-' + linkId; });
    if (keys.length) return INTER[tk][keys[0]];
    // A link the fixtures have no page for gets a generated destination. It carries the UTM set of the fixture destinations of the same email version (the linkId prefix
    // x<ticket>v<version>), as ecTestRecord gives a content link (the SMS banner is one); a linkId outside that scheme gets generic, well-formed UTMs.
    var q = '?utm_source=pardot&utm_medium=email&utm_campaign=Gen_Campaign&utm_content=00.00.00_EML_Gen_CRO&utm_term=';
    var pre = /^x\d+v\d+/.exec(linkId), sib = pre ? Object.keys(INTER[tk] || {}).filter(function (k) { return k.slice(k.lastIndexOf('-') + 1).indexOf(pre[0]) === 0; }) : [];
    var sr = sib.length ? ecParseInterstitial(INTER[tk][sib[0]], X.pardotHosts) : null;
    var d = /^p\d+l\d+$/.test(linkId) ? DEST + '/cap/' + q + linkId
      : DEST + '/give/' + linkId + '/' + (sr && sr.url.indexOf('?') > 0 ? sr.url.slice(sr.url.indexOf('?')) : q + '701EX00000genabAAA');
    return '<html><head><title>Tracked Link Successful</title></head><body><p>If this were a real email, <strong>tester+regular@inbox.mailtrap.io</strong> would be redirected to <a href=\'' + d.replace(/&/g, '&amp;') + '\'>x</a></p></body></html>';
  }
  var router = function (url, init) {
    url = String(url);
    var req = { url: url, init: init || {}, n: st.reqs.length + 1, t: w.clock.now };
    st.reqs.push(req);
    if (/api\.anthropic\.com/.test(url)) return inner(url, init);
    if (o.onRequest) o.onRequest(req, st, w);
    if (o.hang && o.hang(url)) {   // a request that never answers: it ends only when the worker aborts it (the signal is polled on the virtual clock)
      return new Promise(function (res, rej) { var poll = function () { if (req.init.signal && req.init.signal.aborted) rej(new Error('The operation was aborted.')); else w.at(500, poll); }; poll(); });
    }
    var host = /^(https?:\/\/[^\/?#]+)/.exec(url), origin = host ? host[1] : '', path = url.slice(origin.length).split(/[?#]/)[0], viaGate = /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
    if (!viaGate && !/^https:\/\/(?:mailtrap\.io|marketing\.example\.org|www\.example\.org|app\.emailonacid\.com|images\.emailonacid\.com|docs\.googleapis\.com|sheets\.googleapis\.com|oauth2\.googleapis\.com)$/.test(origin)) st.foreign.push(url);
    var m;
    if (/^\/(webmail|unsubscribeConfirm|preferences?)\//.test(path)) return Promise.resolve(resp(200, '<html>never</html>', url));
    if ((m = /^\/e\/\d+\/([^\/]+)\/([A-Za-z0-9]+)\/\d+\/h\/[A-Za-z0-9]+$/.exec(path)) && (viaGate || origin === PARDOT)) {
      st.pardotReqs.push(m[2]);
      if (o.pardotFail && o.pardotFail(m[2])) return Promise.reject(new Error('Load failed: ' + url));
      if (o.pardot && o.pardot[m[2]]) { var po = o.pardot[m[2]]; return Promise.resolve(resp(po.status || 200, po.body || '<html>x</html>', po.url || url)); }
      return Promise.resolve(resp(200, interstitialFor(m[2], m[1]), url));
    }
    if ((m = /^\/app\/acidtest\/([A-Za-z0-9]+)\/list$/.exec(path)) && (viaGate || origin === EOA_HOST)) {
      if (o.eoa500) return Promise.resolve(resp(500, 'oops', url));
      return Promise.resolve(resp(200, EOA_BY_GUID[m[1]] || '<html>none</html>', url));
    }
    if (/^\/web\//.test(path) && (viaGate || origin === IMG_HOST)) {
      if (o.imgFail) return Promise.reject(new Error('Load failed: ' + url));
      if (o.img403 && !(init && init.credentials === 'include')) return Promise.resolve(resp(403, 'no', url));
      return Promise.resolve(resp(200, 64, url));
    }
    if ((m = /^\/v1\/documents\/([A-Za-z0-9_-]+)$/.exec(path)) && (viaGate || origin === DOCS_HOST)) {
      st.docReqs++;
      var auth = init && init.headers && init.headers.Authorization;
      if (!viaGate && auth !== 'Bearer ' + (st.docToken || 'tok1')) return Promise.resolve(resp(401, { error: { message: 'Invalid Credentials' } }, url));
      if (o.docStatus) return Promise.resolve(resp(o.docStatus, o.docError || { error: { message: 'nope' } }, url));
      var d = DOCS[tk];
      return Promise.resolve(d && d.documentId === m[1] ? resp(200, d, url) : resp(404, { error: { message: 'not found' } }, url));
    }
    if (url.indexOf(SHEETS) === 0 && o.sheets) return Promise.resolve(o.sheets.handle(url, init));
    if (url.indexOf('https://oauth2.googleapis.com/revoke') === 0) return Promise.resolve(resp(200, {}, url));
    if (viaGate || origin === DEST) {
      if (o.destFail && o.destFail(path)) return Promise.reject(new Error('Failed to fetch ' + url + '?utm_term=SECRETVALUE'));
      return Promise.resolve(resp(200, '<html><head><title>Example page ' + path + '</title></head><body>ok</body></html>', (o.destFinal && o.destFinal(path)) || url));
    }
    return Promise.reject(new Error('not a fetchable url: ' + url));
  };
  globalThis.fetch = router;
  // image conversion stubs (jsc has none of these)
  globalThis.Blob = function Blob(parts) { this.parts = parts; };
  globalThis.createImageBitmap = function () { return o.bitmapFail ? Promise.reject(new Error('The source image could not be decoded.')) : Promise.resolve({ width: 680, height: 1600, close: function () {} }); };
  globalThis.OffscreenCanvas = function OffscreenCanvas(wd, ht) {
    this.width = wd; this.height = ht;
    this.getContext = function () { return { drawImage: function () {}, fillRect: function () {}, set fillStyle(v) {} }; };
    this.convertToBlob = function () { var n = o.imgJpegBytes || 6; return Promise.resolve({ size: n, arrayBuffer: function () { var a = new Uint8Array(n); a[0] = 255; a[1] = 216; return Promise.resolve(a.buffer); } }); };
  };
  if (o.gate) globalThis.__ecGateOrigins = o.gate;
  return w;
}
function ecSend(w, msg, sender) {
  var out = { done: false, res: undefined };
  w.listeners[0](msg, sender === undefined ? { url: 'chrome-extension://x/sidepanel.html' } : sender, function (r) { out.done = true; out.res = r; });
  return out;
}
function ecCall(w, msg, sender) { var out = ecSend(w, msg, sender); w.settle(function () { return out.done; }); return out.res; }
function ecRun(w, ctx, settings) {
  var out = ecSend(w, { action: 'runEmailCheck', payload: { ctx: ctx, settings: settings, winId: 1 } });
  var t0 = w.clock.now;
  w.settle(function () { return out.done; });
  out.ms = w.clock.now - t0;
  out.rec = (out.res && out.res.record) || {};
  delete globalThis.__ecGateOrigins;
  return out;
}
function mtExecs(st) { return st.execs.filter(function (e) { return e.name === 'ecMailtrapProbeFn' || e.name === 'ecMailtrapReadFn'; }); }
function reqsTo(w, re) { return w.st.reqs.filter(function (r) { return re.test(r.url); }); }

// ═══ wiring ═════════════════════════════════════════════════════════════════════════════════════════════════

T('wiring: importScripts, the stop flag, names, the gate variable', function () {
  eq('exactly one line of background.js holds \'email-check.js\' (the importScripts line)', WORKER_SRC.split('\n').filter(function (l) { return l.indexOf("'email-check.js'") >= 0; }).length, 1);
  ok('email-check.js is imported right after qa-pass.js', /importScripts\([^)]*'qa-pass\.js', 'email-check\.js'\)/.test(WORKER_SRC));
  ok('the stop action sets the Email Check flag, on the line after the QA Pass one', /_qpStopRequested = true;[^\n]*\n\s+_ecStopRequested = true;\s+\/\/ …and any Email Check run/.test(WORKER_SRC));
  ok('background.js has no top-level ec[A-Z] or EC_ definition (email-check.js owns those names)', !/^\s*(?:async\s+)?(?:function|const|let|var)\s+(?:ec[A-Z]|EC_)/m.test(WORKER_SRC));
  ok('and no line of it starts with an ec*/EC_/qp*/QP_ reference outside a function', !/^(?:ec[A-Z]|EC_|qp[A-Z]|QP_)/m.test(WORKER_SRC));
  var names = [], re = /^(?:async\s+)?function\s+(ecw\w*|runEmailCheck)\b|^let\s+(_ec\w+)/gm, m;
  while ((m = re.exec(WORKER_SRC))) names.push(m[1] || m[2]);
  var EXPECT = ['_ecStopRequested', '_ecTabIds', 'ecwStopError', 'ecwIsStop', 'ecwCheckStop', 'ecwErr', 'ecwProgress', 'ecwGateOrigins', 'ecwMapUrl', 'ecwOriginOf', 'ecwNeverFetch', 'ecwTabUrl', 'ecwFetch',
    'ecwExec', 'ecwOpenTab', 'ecwCloseTab', 'ecwLinkPlanOf', 'ecwReadMailtrap', 'ecwPardotGet', 'ecwDestGet', 'ecwDestFor', 'ecwResolveLinks', 'ecwReadEoa', 'ecwRender', 'ecwDocReadGoogle', 'ecwDocRead',
    'ecwReadDoc', 'ecwMarkStopped', 'runEmailCheck', 'ecwSheetApply'];
  jeq('the Email Check section defines exactly these names (a new one needs a line here and a reason in the log)', names.slice().sort(), EXPECT.slice().sort());
  ['ecwFetch', 'ecwOpenTab', 'ecwExec', 'ecwSheetApply', 'ecwResolveLinks', 'ecwGateOrigins'].forEach(function (n) { ok(n + ' is declared async or plain as the contract says', new RegExp('^(?:async )?function ' + n + '\\(', 'm').test(WORKER_SRC)); });
  ['background.js', 'popup.js', 'email-check.js', 'qa-pass.js', 'metric-match.js', 'figma.js', 'browserstack.js', 'vd-config.js', 'vd-diff.js', 'floating.js', 'qa-report.js', 'report.js', 'picker.js', 'recorder.js', 'selector.js', 'image.js',
    'console-bridge.js', 'console-capture.js', 'ab-error-collector.js', 'bs-live-bridge.js', 'bs-live-tap.js', 'vd-overlay.js'].forEach(function (f) {
    var src = readFile('../' + f);
    ok(f + ' never assigns __ecGateOrigins (only a CDP client attached to the worker may)', !/__ecGateOrigins\s*=[^=]/.test(src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  });
  eq('the gate variable is read in ONE function: ecwGateOrigins', WORKER_SRC.split('__ecGateOrigins').length - 1 >= 1 && count(WORKER_SRC.split('\n'), function (l) { return /globalThis\.__ecGateOrigins/.test(l) && !/^\s*\/\//.test(l); }), 1);
  ok('no direct fetch( or chrome.tabs.create( in the Email Check section outside ecwFetch / ecwOpenTab', (function () {
    var a = WORKER_SRC.indexOf('// ── Email Check (Test Agent mode'), z = WORKER_SRC.indexOf('// ── Message listener');
    var sec = WORKER_SRC.slice(a, z).replace(/^\s*\/\/.*$/gm, '').replace(/^ \* .*$/gm, '');
    var fetchLines = sec.split('\n').filter(function (l) { return /(?:^|[^.\w])fetch\(/.test(l); });
    var tabLines = sec.split('\n').filter(function (l) { return /chrome\.tabs\.create\(/.test(l); });
    return fetchLines.length === 1 && /ecwFetch|await fetch\(target/.test(fetchLines[0]) && tabLines.length <= 1;
  })());
});

T('wiring: the summary prompt uses ecSummaryProjection for the emailcheck mode (B:7047)', function () {
  var a = WORKER_SRC.indexOf('function buildTestAgentSummaryPrompt(modeResults, ticketContext) {'), z = WORKER_SRC.indexOf('\n// Assembles the ticket-content half');
  ok('the prompt builder was found in background.js', a > 0 && z > a);
  var build = (0, eval)('(' + WORKER_SRC.slice(a, z) + ')');
  var saved = globalThis.ecSummaryProjection;
  globalThis.ecSummaryProjection = function (d) { return { projected: true, n: d && d.n }; };
  var p1 = build([{ name: 'Email Check', mode: 'emailcheck', status: 'ran', data: { n: 7, secret: 'RAWDATA' } }], null);
  ok('an emailcheck entry goes through ecSummaryProjection', /"projected":true,"n":7/.test(p1) && p1.indexOf('RAWDATA') < 0, p1.slice(0, 200));
  var p2 = build([{ name: 'Other', mode: 2, status: 'ran', data: { n: 7, secret: 'RAWDATA' } }], null);
  ok('another mode keeps its raw data', p2.indexOf('RAWDATA') > 0 && p2.indexOf('projected') < 0);
  var p3 = build([{ name: 'QA Pass', mode: 'qapass', status: 'ran', data: { n: 1 } }], null);
  ok('the QA Pass projection is untouched by it', p3.indexOf('"projected"') < 0);
  globalThis.ecSummaryProjection = undefined;
  var p4 = build([{ name: 'Email Check', mode: 'emailcheck', status: 'ran', data: { n: 7, secret: 'RAWDATA' } }], null);
  ok('without the function (typeof guard) it falls back to the raw data, never throws', p4.indexOf('RAWDATA') > 0);
  if (saved === undefined) delete globalThis.ecSummaryProjection; else globalThis.ecSummaryProjection = saved;
});

// ═══ the gate override and the address guards (the functions sliced out of background.js: they use only globalThis) ═══
var ECW = (function () {
  var a = WORKER_SRC.indexOf('function ecwGateOrigins() {'), z = WORKER_SRC.indexOf('// The one network call of Email Check.');
  if (a < 0 || z < a) throw new Error('the gate functions were not found in background.js');
  return (0, eval)('(function () {\n' + WORKER_SRC.slice(a, z) + '\nreturn { gate: ecwGateOrigins, map: ecwMapUrl, never: ecwNeverFetch, tab: ecwTabUrl, origin: ecwOriginOf };\n})()');
})();

T('gate override: ecwGateOrigins honours only 127.0.0.1 values and fails closed', function () {
  var G = ECW.gate;
  delete globalThis.__ecGateOrigins;
  eq('production: not defined -> null', G(), null);
  globalThis.__ecGateOrigins = null;
  eq('null -> null', G(), null);
  var good = { 'https://mailtrap.io': 'http://127.0.0.1:8123', 'https://www.example.org': 'http://127.0.0.1:8123', 'https://host.example.net:8443': 'http://127.0.0.1:99' };
  globalThis.__ecGateOrigins = good;
  jeq('a plain object of https origins -> 127.0.0.1 values is honoured as given', G(), good);
  ok('and the result is a NEW object (editing it never reaches the variable)', (function () { var r = G(); r['https://x.example'] = 'http://127.0.0.1:1234'; return !('https://x.example' in globalThis.__ecGateOrigins); })());
  [['an https value', 'https://evil.example'], ['another host', 'http://evil.example:8123'], ['localhost, not the address', 'http://localhost:8123'], ['no port', 'http://127.0.0.1'], ['one-digit port', 'http://127.0.0.1:1'],
    ['six-digit port', 'http://127.0.0.1:123456'], ['a userinfo trick', 'http://127.0.0.1:8123@evil.example'], ['a path after the port', 'http://127.0.0.1:8123/x'], ['a trailing dot host', 'http://127.0.0.1.:8123'],
    ['127.0.0.2', 'http://127.0.0.2:8123'], ['a number', 5], ['null', null], ['an object', { a: 1 }]].forEach(function (c) {
    globalThis.__ecGateOrigins = { 'https://mailtrap.io': c[1], 'https://www.example.org': 'http://127.0.0.1:8123' };
    jeq('a value that is ' + c[0] + ' is DROPPED, the valid entry stays', G(), { 'https://www.example.org': 'http://127.0.0.1:8123' });
  });
  [['http key', 'http://mailtrap.io'], ['key with a path', 'https://mailtrap.io/x'], ['upper-case key', 'https://MAILTRAP.IO'], ['key with userinfo', 'https://a@mailtrap.io'], ['bare host', 'mailtrap.io'], ['empty key', '']].forEach(function (c) {
    var o = {}; o[c[1]] = 'http://127.0.0.1:8123';
    globalThis.__ecGateOrigins = o;
    jeq('a ' + c[0] + ' is DROPPED', G(), {});
  });
  ['a string', 12, true, ['https://mailtrap.io'], function () {}].forEach(function (v, i) {
    globalThis.__ecGateOrigins = v;
    jeq('a non-object (' + i + ') puts the gate ON with nothing mapped: {}', G(), {});
  });
  globalThis.__ecGateOrigins = {};
  jeq('an empty object is the gate ON with nothing mapped', G(), {});
  delete globalThis.__ecGateOrigins;
});

T('gate override: ecwMapUrl and ecwTabUrl map, pass 127.0.0.1, refuse the rest', function () {
  var M = ECW.map, TU = ECW.tab;
  delete globalThis.__ecGateOrigins;
  eq('production: an https URL passes unchanged (query kept: the caller decides)', M('https://www.example.org/give/x/?a=1#h'), 'https://www.example.org/give/x/?a=1#h');
  eq('production: surrounding space is trimmed', M('  https://www.example.org/x  '), 'https://www.example.org/x');
  eq('production: http passes', M('http://www.example.org/x'), 'http://www.example.org/x');
  [['mailto:', 'mailto:a@example.org'], ['javascript:', 'javascript:alert(1)'], ['data:', 'data:text/html,x'], ['file:', 'file:///etc/passwd'], ['chrome:', 'chrome://settings'], ['no scheme', 'www.example.org/x'], ['empty', ''], ['non-string', null], ['userinfo', 'https://user:pw@www.example.org/x'], ['userinfo trick', 'https://www.example.org@evil.example/x']].forEach(function (c) {
    eq('production: ' + c[0] + ' is refused (null)', M(c[1]), null);
  });
  ['http://localhost/x', 'https://localhost:8080/x', 'https://app.localhost/x', 'http://127.0.0.1/x', 'http://127.0.0.1:9222/json', 'http://127.1.2.3/x', 'http://10.0.0.5/x', 'http://192.168.1.1/x', 'http://172.16.0.1/x', 'http://172.31.255.255/x',
    'http://169.254.169.254/latest/meta-data', 'http://0.0.0.0/x', 'http://[::1]/x', 'https://[fe80::1]:8443/x'].forEach(function (u) { eq('production: the local or private address ' + u + ' is refused', M(u), null); });
  ['http://172.32.0.1/x', 'http://172.15.0.1/x', 'http://11.0.0.1/x', 'http://193.168.1.1/x', 'https://www.example.org.evil.example/x'].forEach(function (u) { eq('production: the public address ' + u + ' passes', M(u), u); });

  globalThis.__ecGateOrigins = { 'https://mailtrap.io': 'http://127.0.0.1:8123', 'https://www.example.org': 'http://127.0.0.1:8123', 'https://host.example.net:8443': 'http://127.0.0.1:8124' };
  eq('gate: a mapped origin is rewritten, path and query kept', M('https://mailtrap.io/sandboxes/7/messages/9?x=1#y'), 'http://127.0.0.1:8123/sandboxes/7/messages/9?x=1#y');
  eq('gate: the origin match is case-insensitive', M('https://MAILTRAP.io/a'), 'http://127.0.0.1:8123/a');
  eq('gate: a mapped origin with a port', M('https://host.example.net:8443/a'), 'http://127.0.0.1:8124/a');
  eq('gate: an origin with no path', M('https://mailtrap.io'), 'http://127.0.0.1:8123');
  eq('gate: an origin with only a query', M('https://mailtrap.io?x=1'), 'http://127.0.0.1:8123?x=1');
  ['https://marketing.example.org/e/1/s/l/2/h/H', 'https://mailtrap.io.evil.example/x', 'https://mailtrap.io:8443/x', 'http://mailtrap.io/x', 'https://evil.example/x', 'https://host.example.net/x', 'https://docs.googleapis.com/v1/documents/x', 'https://accounts.google.com/o/oauth2/v2/auth'].forEach(function (u) {
    eq('gate: the unmapped ' + u + ' is REFUSED', M(u), null);
  });
  eq('gate: an address already on 127.0.0.1:port passes as is', M('http://127.0.0.1:9999/x?y=1'), 'http://127.0.0.1:9999/x?y=1');
  ['http://127.0.0.1/x', 'http://127.0.0.1:9999@evil.example/x', 'http://127.0.0.1:9999.evil.example/x', 'https://127.0.0.1:9999/x', 'http://127.0.0.2:9999/x', 'http://localhost:9999/x', 'http://127.0.0.1:1/x'].forEach(function (u) {
    eq('gate: ' + u + ' is refused (not exactly http://127.0.0.1:<2-5 digits>)', M(u), null);
  });
  globalThis.__ecGateOrigins = { 'https://mailtrap.io': 'https://evil.example' };
  eq('gate with only an invalid entry: nothing is mapped, mailtrap.io is REFUSED (fails closed)', M('https://mailtrap.io/x'), null);
  eq('and every other origin as well', M('https://www.example.org/x'), null);
  globalThis.__ecGateOrigins = { 'https://mailtrap.io': 'http://127.0.0.1:8123' };
  jeq('ecwTabUrl: a mapped tab URL', TU('https://mailtrap.io/sandboxes/7/messages/9'), { ok: true, url: 'http://127.0.0.1:8123/sandboxes/7/messages/9' });
  var r = TU('https://app.emailonacid.com/app/acidtest/X/list');
  ok('ecwTabUrl: an unmapped one is refused with the origin in the message and no path', r.ok === false && r.refused === true && /app\.emailonacid\.com/.test(r.error) && r.error.indexOf('acidtest') < 0, r);
  ok('ecwTabUrl: never-open paths are refused too', TU('https://mailtrap.io/webmail/1/2/abc').ok === false && TU('https://mailtrap.io/unsubscribeConfirm/1/abc/2').refused === true);
  delete globalThis.__ecGateOrigins;
  eq('ecwTabUrl: production passes a normal URL', TU('https://mailtrap.io/sandboxes/7/messages/9').url, 'https://mailtrap.io/sandboxes/7/messages/9');
  eq('ecwOriginOf: the origin only', ECW.origin('https://a.example.org/x/y?z=1'), 'https://a.example.org');
  eq('ecwOriginOf: never prints userinfo', ECW.origin('https://user:pw@a.example.org/x'), 'that address');
  eq('ecwOriginOf: a non-URL', ECW.origin('nope'), 'that address');
});

T('never-fetch: ecwNeverFetch by PATH, whatever the query', function () {
  var N = ECW.never;
  ['https://m.example.org/webmail/900001/2000000002/abc', 'https://m.example.org/unsubscribeConfirm/900001/abc/2', 'https://m.example.org/unsubscribe/x', 'https://m.example.org/emailPreferenceCenter/x',
    'https://m.example.org/optout/x', 'https://m.example.org/preferences/x', 'https://m.example.org/preference/x', 'https://m.example.org/a/UNSUBSCRIBE', 'https://m.example.org/a/webmail?x=1', 'https://m.example.org/WEBMAIL/x'].forEach(function (u) {
    eq(u + ' is never opened', N(u), 'path');
  });
  ['https://m.example.org/give/spring/?next=/webmail/x', 'https://m.example.org/e/900001/slug/abc/2/h/H', 'https://m.example.org/stories/unsubscribed-people/', 'https://m.example.org/'].forEach(function (u) {
    eq(u + ' may be opened (the query is not read)', N(u), null);
  });
});

// ═══ the Email Check wiring of the router and its actions ═══════════════════════════════════════════

T('router: the actions exist, a web page cannot call the sheet apply, unknown record is not a crash', function () {
  var w = ecWorld({ token: false });
  var r = ecCall(w, { action: 'ecSheetApply', payload: { spreadsheetId: 'SHEET0123456789abcdefghij', writes: [{ a1: 'E9' }] } }, { url: 'https://evil.example/page' });
  jeq('ecSheetApply from a web page is refused like the QA Pass actions', r, { ok: false, error: 'Not allowed from a web page.' });
  eq('and from a sender with no url', ecCall(w, { action: 'ecSheetApply', payload: {} }, { tab: { id: 3 } }).error, 'Not allowed from a web page.');
  eq('nothing was requested for a refused call', w.st.reqs.length, 0);
  ok('ecSheetApply with no writes answers ok, 0 written, from an extension page', (function () { var q = ecCall(w, { action: 'ecSheetApply', payload: { writes: [] } }); return q.ok === true && q.written === 0; })());
});

// ═══ the runs ══════════════════════════════════════════════════════════════════════════════════════════════

var REC_KEYS = ['checks', 'doc', 'error', 'explain', 'finishedAt', 'links', 'notTested', 'profileId', 'proofs', 'renders', 'settings', 'sheet', 'sources', 'startedAt', 'stopped', 'summary', 'ticketKey', 'ts', 'version'];
var PROOF_IDS = ['regular-donors-v0', 'regular-donors-v1', 'major-donors-v0', 'major-donors-v1'];

var CLEAN = null;
T('scenario: clean (EX-2: doc, Mailtrap, tracked links, Email on Acid, renders)', function () {
  var w = ecWorld({ ticket: 'EX-2' });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  CLEAN = { w: w, out: out };
  var rec = out.rec, st = w.st;
  ok('the run answers ok with a record', out.done && out.res && out.res.ok === true && !!out.res.record, out.res && out.res.error);
  eq('record version 1 (D2)', rec.version, 1);
  jeq('the 19 top-level keys of plan 1.4 (ecNewRecord, B2)', Object.keys(rec).sort(), REC_KEYS);
  eq('no error', rec.error, null);
  eq('not stopped', rec.stopped, false);
  eq('startedAt is the worker clock at the start', typeof rec.startedAt, 'number');
  ok('finishedAt follows startedAt', rec.finishedAt >= rec.startedAt);
  eq('the ticket key', rec.ticketKey, 'EX-2');
  eq('the profile is the synthetic organisation, picked by the EX- prefix', rec.profileId, 'example');
  // sources
  eq('copy doc source: ok', rec.sources.doc.state, 'ok');
  eq('Mailtrap source: ok', rec.sources.mailtrap.state, 'ok');
  jeq('Email on Acid: two variations, both read', (rec.sources.eoa || []).map(function (e) { return [e.variation, e.state, e.renders.state, e.renders.count]; }), [['v0', 'ok', 'ok', 16], ['v1', 'ok', 'ok', 16]]);
  eq('each EoA page lists the 16 clients', (rec.sources.eoa || []).map(function (e) { return e.clients.length; }).join(), '16,16');
  // proofs
  jeq('four proofs in the context order', rec.proofs.map(function (p) { return p.id; }), PROOF_IDS);
  ok('every proof was read (state ok, facts set)', rec.proofs.every(function (p) { return p.state === 'ok' && p.facts && typeof p.facts === 'object'; }), rec.proofs.map(function (p) { return p.state; }));
  eq('four reads, one per proof', st.reads, 4);
  // the tab
  eq('ONE Mailtrap tab and two Email on Acid tabs were opened', st.created.length, 3);
  eq('the Mailtrap tab is the first proof\'s message page', st.created[0] && st.created[0].props.url, 'https://mailtrap.io/sandboxes/7000001/messages/7100000005');
  ok('every tab is active (background tabs are throttled) and in the run window (winId 1)', st.created.every(function (c) { return c.props.active === true && c.props.windowId === 1; }), st.created.map(function (c) { return c.props; }));
  jeq('every tab the run opened was closed again, and none is left', [distinct(st.removed).sort(), Object.keys(st.tabs)], [st.created.map(function (c) { return String(c.id); }).sort(), []]);
  eq('the page functions ran in the Mailtrap tab only (probe once, read four times)', st.execs.filter(function (e) { return e.tabId === st.created[0].id; }).map(function (e) { return e.name; }).join(), 'ecMailtrapProbeFn,ecMailtrapReadFn,ecMailtrapReadFn,ecMailtrapReadFn,ecMailtrapReadFn');
  jeq('the probe asked about the sandbox of the proofs', st.execs[0] && st.execs[0].args, ['7000001']);
  jeq('each read: account, sandbox, message, the body cap (EC_MAX_BODY_BYTES)', st.execs.filter(function (e) { return e.name === 'ecMailtrapReadFn'; }).map(function (e) { return e.args; }),
    ['7100000005', '7100000006', '7100000007', '7100000008'].map(function (id) { return ['222', '7000001', id, 2000000]; }));
  // tracked links
  var want = expectedPardotIds('EX-2');
  eq('24 tracked-link GETs: the distinct non-guarded linkIds of the run (Appendix C.1)', want.length, 24);
  eq('the run made exactly that many Pardot requests', st.pardotReqs.length, 24);
  jeq('each linkId was requested once (and they are the expected ones)', st.pardotReqs.slice().sort(), want.slice().sort());
  eq('no request to /webmail/ or /unsubscribeConfirm/', reqsTo(w, /\/(webmail|unsubscribeConfirm)\//).length, 0);
  ok('every Pardot request: no cookies, follow, no-store, a GET', reqsTo(w, /\/e\/\d+\//).every(function (r) { return r.init.credentials === 'omit' && r.init.redirect === 'follow' && r.init.cache === 'no-store' && (!r.init.method || r.init.method === 'GET'); }), reqsTo(w, /\/e\/\d+\//)[0]);
  ok('every request has an abort signal (the timeout)', st.reqs.every(function (r) { return !!r.init.signal; }));
  // destinations
  var dest = reqsTo(w, /^https:\/\/www\.example\.org\//);
  ok('destinations were requested', dest.length > 0);
  ok('every destination request is WITHOUT its query, without cookies', dest.every(function (r) { return r.url.indexOf('?') < 0 && r.init.credentials === 'omit'; }), dest.map(function (r) { return r.url; }));
  eq('and each distinct origin + path once', distinct(dest.map(function (r) { return r.url; })).length, dest.length);
  ok('no request went to a host the run has no business with', st.foreign.length === 0, st.foreign);
  // links in the record
  var plans = PROOFS['EX-2'].proofs.map(function (p) { return ecLinkPlan(ecVisibleText(htmlOfProof(p)).anchors, X); });
  eq('rec.links holds one entry per plan entry of every proof', rec.links.length, plans.reduce(function (n, pl) { return n + pl.length; }, 0));
  ok('no link entry keeps an href, and none holds a tracked path', rec.links.every(function (l) { return !('href' in l); }) && JSON.stringify(rec.links).indexOf('/e/900001/') < 0);
  ok('the link entries have the 13 fields of plan 1.4', rec.links.every(function (l) { return Object.keys(l).sort().join() === ['dest', 'destStatus', 'destTitle', 'error', 'guard', 'kind', 'labels', 'linkId', 'method', 'pardotStatus', 'proofId', 'role', 'slug'].join(); }), rec.links[0] && Object.keys(rec.links[0]));
  var guarded = rec.links.filter(function (l) { return l.guard; });
  eq('the guarded links (View email in browser, Unsubscribe) are listed once per proof', guarded.length, 8);
  ok('and have no method, no status, no destination: they were not opened', guarded.every(function (l) { return l.method === null && l.pardotStatus === null && l.dest === null && l.destStatus === null; }));
  var open = rec.links.filter(function (l) { return !l.guard; });
  ok('every other link was resolved (a method, a 200, a destination, a status, no error)', open.every(function (l) { return l.method && l.pardotStatus === 200 && l.dest && l.dest.origin === DEST && l.destStatus === 200 && l.error === null; }), open.filter(function (l) { return !l.method || l.error; }).slice(0, 2));
  ok('destinations carry only utm_* values and the names of other keys (ecDestination)', open.every(function (l) { return Object.keys(l.dest.utm).every(function (k) { return k.indexOf('utm_') === 0; }); }));
  ok('a destination title was kept', open.every(function (l) { return /^Example page /.test(l.destTitle || ''); }), open[0]);
  // the same linkId in two proofs is one request and one answer
  var byId = {};
  open.forEach(function (l) { (byId[l.linkId] = byId[l.linkId] || []).push(l); });
  var shared = Object.keys(byId).filter(function (id) { return byId[id].length > 1; });
  ok('linkIds shared by two proofs exist in this fixture (the footer, the social links)', shared.length > 0);
  ok('each shared linkId carries one answer in every proof that lists it', shared.every(function (id) { return JSON.stringify(byId[id][0].dest) === JSON.stringify(byId[id][byId[id].length - 1].dest) && byId[id][0].method === byId[id][byId[id].length - 1].method; }));
  // doc
  eq('one request to the Docs API', st.docReqs, 1);
  ok('with the stored token', (reqsTo(w, /docs\.googleapis\.com/)[0] || { init: {} }).init.headers && reqsTo(w, /docs\.googleapis\.com/)[0].init.headers.Authorization === 'Bearer tok1');
  ok('the doc was parsed (rec.doc)', !!rec.doc && rec.doc.chosen === 1, rec.doc && rec.doc.chosen);
  // Email on Acid
  eq('the two Email on Acid list pages were fetched (the inventory) with no cookies, once each', count(reqsTo(w, /app\.emailonacid\.com\/app\/acidtest\/[A-Za-z0-9]+\/list/), function (r) { return r.init.credentials === 'omit'; }), 2);
  eq('32 renders (16 clients x 2 variations)', rec.renders.length, 32);
  ok('every render is a JPEG data URL with its client code, name and dark flag', rec.renders.every(function (r) { return /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(r.img) && r.code && r.name !== undefined && typeof r.dark === 'boolean'; }), rec.renders[0] && Object.keys(rec.renders[0]));
  jeq('renders are grouped by variation, 16 each', [count(rec.renders, function (r) { return r.variation === 'v0'; }), count(rec.renders, function (r) { return r.variation === 'v1'; })], [16, 16]);
  ok('no render keeps the source image URL', JSON.stringify(rec.renders).indexOf('images.emailonacid.com') < 0 && JSON.stringify(rec).indexOf('/web/EXEOA') < 0);
  // progress and scrub
  eq('the progress is cleared at the end', (w.session('ecProgress') || {}).running, false);
  ok('the progress was written during the run', w.sets.some(function (s) { return /ecProgress/.test(s); }));
  eq('nothing identifying is left anywhere in the record', leaks(rec).join('|'), '');
  eq('the model was not called', w.requests.length, 0);
  eq('the stop flag was not set by a finished run', (function () { return rec.stopped; })(), false);
});

T('progress: phase and label, and per proof done / total (the panel prints "(done/total)"); one shape between the worker and the panel (integration)', function () {
  var seen = [];
  var snap = function (ww) { seen.push(JSON.parse(JSON.stringify(ww.session('ecProgress') || {}))); };
  var w = ecWorld({ afterRead: function (n, ww) { snap(ww); }, onRequest: function (req, st, ww) { if (/\/e\/\d+\//.test(req.url)) snap(ww); } });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  ok('the run answers ok', out.res && out.res.ok === true, out.res && out.res.error);
  jeq('Mailtrap: one write per proof read, done 1..4 of 4', seen.filter(function (p) { return p.phase === 'mailtrap'; }).map(function (p) { return p.done + '/' + p.total; }), ['1/4', '2/4', '3/4', '4/4']);
  var lk = seen.filter(function (p) { return p.phase === 'links'; });
  ok('links: done and total are numbers, total is the number of proofs read', lk.length > 0 && lk.every(function (p) { return typeof p.done === 'number' && p.total === 4 && p.done >= 1 && p.done <= 4; }), lk[0]);
  ok('every write says running and names its phase', seen.every(function (p) { return p.running === true && typeof p.phase === 'string' && typeof p.label === 'string'; }), seen[0]);
  jeq('the last write clears it', [(w.session('ecProgress') || {}).running], [false]);
});

T('the shape between the page function and the worker: `truncated` reaches the proof\'s facts (integration)', function () {
  var w = ecWorld({ truncated: { '7100000005': true } });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var by = {};
  (out.rec.proofs || []).forEach(function (p) { by[p.messageId] = p.facts && p.facts.truncated; });
  jeq('only the cut message says so', [by['7100000005'], by['7100000006'], by['7100000007'], by['7100000008']], [true, false, false, false]);
});

T('Email on Acid: an unexpected throw while reading an inventory is that source\'s error, with its message, and the run goes on (integration: the shell starts as stopped)', function () {
  var keep = globalThis.ecParseEoaPage, out;
  globalThis.ecParseEoaPage = function () { throw new Error('parser blew up'); };
  try { out = ecRun(ecWorld({}), mkCtx('EX-2'), mkSettings('EX-2')); } finally { globalThis.ecParseEoaPage = keep; }
  var eo = (out.rec.sources && out.rec.sources.eoa) || [];
  jeq('both sources: error, the message on the source and on renders, renders none', eo.map(function (e) { return [e.state, e.error, e.renders.state, e.renders.error]; }),
    [['error', 'parser blew up', 'none', 'parser blew up'], ['error', 'parser blew up', 'none', 'parser blew up']]);
  eq('the run still answered with a record and no run error', out.res && out.res.ok === true && out.rec.error === null, true);
});

T('scenario: clean, derived results (needs B2: ecDeriveChecks, ecFixedNotTested)', function () {
  var rec = CLEAN.out.rec;
  eq('B2: 88 checks (22 rows x 4 proofs)', (rec.checks || []).length, 88);
  var c = { passed: 0, failed: 0, 'in-progress': 0, blocked: 0, 'not-tested': 0 };
  (rec.checks || []).forEach(function (x) { c[x.status] = (c[x.status] || 0) + 1; });
  jeq('B2: 64 passed / 24 in progress / 0 failed (Appendix C.1)', [c.passed, c['in-progress'], c.failed, c.blocked], [64, 24, 0, 0]);
  ok('B2: the check ids are <key>@<proofId>', (rec.checks || []).every(function (x) { return x.id === x.key + '@' + x.proofId; }));
  ok('B2: the fixed not-tested list is there (X.unsubscribe, X.jira ...)', (rec.notTested || []).length === 8 && rec.notTested.some(function (n) { return /unsubscribe/.test(n.id); }), (rec.notTested || []).map(function (n) { return n.id; }));
  eq('B2: the stored record is clean after derivation', leaks(rec).join('|'), '');
});

T('scenario: EX-1 (inlineCard ADF, identical UTMs, image-only CTA): the run, then the derived results (B2)', function () {
  var w = ecWorld({ ticket: 'EX-1' });
  var out = ecRun(w, mkCtx('EX-1'), mkSettings('EX-1'));
  var rec = out.rec, st = w.st;
  ok('the run answers ok', out.res && out.res.ok === true, out.res && out.res.error);
  eq('four proofs read', count(rec.proofs || [], function (p) { return p.state === 'ok'; }), 4);
  var want = expectedPardotIds('EX-1');
  jeq('the tracked-link GETs are the distinct non-guarded linkIds of the ticket, each once', st.pardotReqs.slice().sort(), want.slice().sort());
  eq('no webmail / unsubscribe request', reqsTo(w, /\/(webmail|unsubscribeConfirm)\//).length, 0);
  eq('the copy doc of EX-1 was read through the Docs API', rec.sources.doc.state, 'ok');
  eq('EX-1 mentions no segment path: the rules are the suggested ones, nothing more', JSON.stringify(rec.settings.segmentPaths), '{}');
  var alt = function (id) { return (rec.checks || []).filter(function (c) { return c.id === 'altTags@' + id; })[0] || {}; };
  eq('B2: altTags FAILED on regular-donors-v1 (hero and stat image are the only links to the story page)', alt('regular-donors-v1').status, 'failed');
  eq('B2: altTags FAILED on major-donors-v1', alt('major-donors-v1').status, 'failed');
  eq('B2: altTags In Progress on a v0 proof', alt('regular-donors-v0').status, 'in-progress');
  var c = { passed: 0, failed: 0, 'in-progress': 0 };
  (rec.checks || []).forEach(function (x) { c[x.status] = (c[x.status] || 0) + 1; });
  jeq('B2: 60 passed / 26 in progress / 2 failed (Appendix C.1)', [c.passed, c['in-progress'], c.failed], [60, 26, 2]);
  eq('scrub', leaks(rec).join('|'), '');
});

// ── Mailtrap sign-in, browser check, account, missing proof, a page script that throws ──────────────────────
T('scenario: signed out (the tab lands on /signin): D4 wording, no probe, no read, no tracked link, doc and EoA still read', function () {
  var w = ecWorld({ signedIn: false });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec, st = w.st;
  ok('the run answers ok with a record', out.res && out.res.ok === true, out.res && out.res.error);
  eq('the Mailtrap source is signed-out', rec.sources.mailtrap.state, 'signed-out');
  eq('its message is the D4 sentence', rec.sources.mailtrap.error, EC_MAILTRAP_MSG['signed-out']);
  ok('no proof was read', rec.proofs.every(function (p) { return p.state === 'not-read'; }), rec.proofs.map(function (p) { return p.state; }));
  eq('no Mailtrap page function ran (the /signin path ends the step before the probe)', mtExecs(st).length, 0);
  eq('no tracked link was requested', st.pardotReqs.length, 0);
  eq('and no link was listed', rec.links.length, 0);
  eq('the copy doc was still read', rec.sources.doc.state, 'ok');
  eq('Email on Acid was still read (both pages)', (rec.sources.eoa || []).map(function (e) { return e.state; }).join(), 'ok,ok');
  jeq('every tab was closed', [distinct(st.removed).length, Object.keys(st.tabs).length], [st.created.length, 0]);
  eq('the error is not set (a signed-out Mailtrap is a state, not a failure of the run)', rec.error, null);
  eq('scrub', leaks(rec).join('|'), '');
  var c = rec.checks || [];
  eq('B2: 72 Blocked by mailtrap (18 rows x 4 proofs)', count(c, function (x) { return x.status === 'blocked' && x.blockedBy === 'mailtrap'; }), 72);
  eq('B2: the 16 visual and dark-mode rows stay In Progress (the EoA inventory is there)', count(c, function (x) { return x.status === 'in-progress'; }), 16);
});

T('scenario: a browser check (Cloudflare title) is waited out for 15 s, never clicked; one that clears is not a failure', function () {
  var w = ecWorld({ challengeMs: Infinity });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec, st = w.st;
  eq('the Mailtrap source is challenge', rec.sources.mailtrap.state, 'challenge');
  eq('its message is the D4 sentence', rec.sources.mailtrap.error, EC_MAILTRAP_MSG.challenge);
  var eoaT = (reqsTo(w, /emailonacid/)[0] || {}).t, span = eoaT - st.created[0].t;
  ok('it waited EC_CHALLENGE_WAIT_MS (15 s of the virtual clock) between opening the tab and the next step, and not much more', span >= 15000 && span < 17500, span);
  ok('the title was re-read about once a second (tabs.get of the Mailtrap tab)', st.getsById[st.created[0].id] >= 15, st.getsById[st.created[0].id]);
  eq('nothing was run in the Mailtrap page: no probe, no read, nothing clicked', mtExecs(st).length, 0);
  eq('and the debugger was never attached (no click, no key)', count(w.calls, function (c) { return c[0] === 'attach'; }), 0);
  eq('no proof was read', count(rec.proofs, function (p) { return p.state === 'ok'; }), 0);
  eq('the tab was closed', Object.keys(st.tabs).length, 0);
  eq('the doc and Email on Acid were still read', rec.sources.doc.state + '|' + (rec.sources.eoa || []).map(function (e) { return e.state; }).join(), 'ok|ok,ok');
  var w2 = ecWorld({ challengeMs: 5000 });
  var out2 = ecRun(w2, mkCtx('EX-2'), mkSettings('EX-2'));
  eq('a check that clears after 5 s: Mailtrap ok', out2.rec.sources.mailtrap.state, 'ok');
  eq('and the four proofs were read', count(out2.rec.proofs, function (p) { return p.state === 'ok'; }), 4);
  var span2 = (reqsTo(w2, /emailonacid/)[0] || {}).t - w2.st.created[0].t;
  ok('after about 5 s of waiting, not 15', span2 >= 5000 && span2 < 8000, span2);
});

T('scenario: the signed-in account does not own the sandbox (a personal account): no-account, D4 wording with the sandbox id', function () {
  var w = ecWorld({ noAccount: true });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec;
  eq('the Mailtrap source is no-account', rec.sources.mailtrap.state, 'no-account');
  eq('its message names the sandbox', rec.sources.mailtrap.error, EC_MAILTRAP_MSG['no-account'].replace('{sb}', '7000001'));
  eq('the probe ran once, no proof was read', mtExecs(w.st).map(function (e) { return e.name; }).join(), 'ecMailtrapProbeFn');
  eq('no tracked link requested', w.st.pardotReqs.length, 0);
  eq('the tab was closed', Object.keys(w.st.tabs).length, 0);
  eq('the doc was still read', rec.sources.doc.state, 'ok');
});

T('scenario: one proof is not in the sandbox (404): that proof is not-found, the others are read and resolved', function () {
  var w = ecWorld({ missing: { '7100000006': true } });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec, st = w.st;
  eq('Mailtrap itself is ok (the account owns the sandbox)', rec.sources.mailtrap.state, 'ok');
  jeq('proof states', rec.proofs.map(function (p) { return p.state; }), ['ok', 'not-found', 'ok', 'ok']);
  eq('the not-found proof says where', rec.proofs[1].error, 'Proof not found in sandbox 7000001 (message 7100000006)');
  eq('the not-found proof has no facts', rec.proofs[1].facts, null);
  ok('no link of the missing proof is listed', rec.links.every(function (l) { return l.proofId !== 'regular-donors-v1'; }));
  var ids = distinct(rec.links.filter(function (l) { return !l.guard && l.kind === 'pardot'; }).map(function (l) { return l.linkId; }));
  jeq('the tracked links of the three proofs that were read were requested, once each', st.pardotReqs.slice().sort(), ids.slice().sort());
  eq('all four proofs were asked for', st.reads, 4);
  eq('the error of the run is not set', rec.error, null);
  var c = rec.checks || [];
  eq('B2: 18 Blocked by proof on the missing one', count(c, function (x) { return x.proofId === 'regular-donors-v1' && x.status === 'blocked' && x.blockedBy === 'proof'; }), 18);
});

T('scenario: executeScript resolves {result:null} (the page script threw) or rejects: "no data", never a crash', function () {
  var w = ecWorld({ execNull: { ecMailtrapProbeFn: 'null' } });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  ok('the probe result null: the run still answers ok with a record', out.res && out.res.ok === true && !!out.res.record, out.res && out.res.error);
  eq('the Mailtrap source is an error', out.rec.sources.mailtrap.state, 'error');
  ok('and says what happened', /no result \(the page script failed\)/.test(out.rec.sources.mailtrap.error || ''), out.rec.sources.mailtrap.error);
  eq('no proof was read and no tracked link requested', count(out.rec.proofs, function (p) { return p.state === 'ok'; }) + w.st.pardotReqs.length, 0);
  eq('the tab was closed', Object.keys(w.st.tabs).length, 0);

  var w2 = ecWorld({ execNull: { 'ecMailtrapReadFn@7100000006': 'null' } });
  var out2 = ecRun(w2, mkCtx('EX-2'), mkSettings('EX-2'));
  jeq('a read that returns null costs that proof only', out2.rec.proofs.map(function (p) { return p.state; }), ['ok', 'error', 'ok', 'ok']);
  ok('with the reason on the proof', /no result \(the page script failed\)/.test(out2.rec.proofs[1].error || ''), out2.rec.proofs[1].error);
  eq('Mailtrap itself stays ok', out2.rec.sources.mailtrap.state, 'ok');
  eq('three reads reached the page (the one that returned null did not count)', w2.st.reads, 3);

  var w3 = ecWorld({ execNull: { 'ecMailtrapReadFn@7100000007': 'reject' } });
  var out3 = ecRun(w3, mkCtx('EX-2'), mkSettings('EX-2'));
  jeq('a read whose executeScript REJECTS (a frame removed) costs that proof only', out3.rec.proofs.map(function (p) { return p.state; }), ['ok', 'ok', 'error', 'ok']);
  ok('with the scrubbed message', /Frame with ID 0 was removed/.test(out3.rec.proofs[2].error || ''), out3.rec.proofs[2].error);

  var w4 = ecWorld({ execNull: { ecMailtrapProbeFn: 'reject' } });
  var out4 = ecRun(w4, mkCtx('EX-2'), mkSettings('EX-2'));
  eq('a probe whose executeScript rejects: Mailtrap error, record returned', out4.rec.sources.mailtrap.state + '|' + (out4.res && out4.res.ok), 'error|true');

  var w5 = ecWorld({ execNull: { ecEoaImagesFn: 'null' } });
  var out5 = ecRun(w5, mkCtx('EX-2'), mkSettings('EX-2'));
  eq('Email on Acid: the images function returning null is a renders error, the inventory stays ok', (out5.rec.sources.eoa || []).map(function (e) { return e.state + '/' + e.renders.state; }).join(), 'ok/error,ok/error');
  ok('with the same reason', (out5.rec.sources.eoa || []).every(function (e) { return /no result \(the page script failed\)/.test(e.renders.error || ''); }), (out5.rec.sources.eoa || []).map(function (e) { return e.renders.error; }));
  eq('and no render', out5.rec.renders.length, 0);
  eq('the run still answers ok', out5.res && out5.res.ok, true);
});

T('tabs: a page that never finishes loading ends the step after EC_TAB_TIMEOUT_MS, polled every 250 ms, and the tab is closed', function () {
  var w = ecWorld({ neverComplete: true });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  eq('Mailtrap is an error', out.rec.sources.mailtrap.state, 'error');
  ok('saying the page did not finish loading', /did not finish loading/.test(out.rec.sources.mailtrap.error || ''), out.rec.sources.mailtrap.error);
  var span = (reqsTo(w, /emailonacid/)[0] || {}).t - w.st.created[0].t;
  ok('after about 30 s of the virtual clock (EC_TAB_TIMEOUT_MS)', span >= 30000 && span < 33000, span);
  ok('polled about every 250 ms (tabs.get of that tab)', w.st.getsById[w.st.created[0].id] >= 100 && w.st.getsById[w.st.created[0].id] <= 135, w.st.getsById[w.st.created[0].id]);
  eq('every tab it opened was closed', Object.keys(w.st.tabs).length, 0);
  eq('nothing was run in the Mailtrap page', mtExecs(w.st).length, 0);
});

// ── Stop ────────────────────────────────────────────────────────────────────────────────────────────────────
T('scenario: Stop after the 2nd proof: the step ends stopped, nothing more is read, requested or opened, tabs closed', function () {
  var w = ecWorld({ afterRead: function (n, w) { if (n === 2) ecSend(w, { action: 'stop' }); } });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec, st = w.st;
  ok('the run answers ok with a record (a Stop is not an error)', out.res && out.res.ok === true && !!out.res.record, out.res && out.res.error);
  eq('stopped is set', rec.stopped, true);
  eq('and no error', rec.error, null);
  eq('the Mailtrap source is stopped', rec.sources.mailtrap.state, 'stopped');
  jeq('two proofs were read, two were not', rec.proofs.map(function (p) { return p.state; }), ['ok', 'ok', 'not-read', 'not-read']);
  eq('only two reads happened', st.reads, 2);
  eq('no tracked link was requested', st.pardotReqs.length, 0);
  eq('no link was listed', rec.links.length, 0);
  eq('the doc (read first) is ok', rec.sources.doc.state, 'ok');
  eq('Email on Acid never started: both sources stopped', (rec.sources.eoa || []).map(function (e) { return e.state; }).join(), 'stopped,stopped');
  eq('and no Email on Acid tab or request', st.created.length + reqsTo(w, /emailonacid/).length, 1);
  eq('the one tab was closed', Object.keys(st.tabs).length, 0);
  eq('the progress was cleared', (w.session('ecProgress') || {}).running, false);
  ok('the checks were still derived (an array)', Array.isArray(rec.checks));
  // a Stop that arrives while NO run is going does not carry into the next run
  var w2 = ecWorld({});
  ecCall(w2, { action: 'stop' });
  var out2 = ecRun(w2, mkCtx('EX-2'), mkSettings('EX-2'));
  eq('a Stop sent before a run does not stop it (the flag is reset at the start)', out2.rec.stopped + '|' + out2.rec.sources.mailtrap.state, 'false|ok');
});

T('scenario: Stop while resolving links: no request leaves after it', function () {
  var w = ecWorld({ onRequest: function (req, st, w) { if (/\/e\/\d+\//.test(req.url) && reqsTo(w, /\/e\/\d+\//).length === 3) ecSend(w, { action: 'stop' }); } });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec, st = w.st;
  eq('stopped', rec.stopped, true);
  eq('exactly three tracked-link requests were made', reqsTo(w, /\/e\/\d+\//).length, 3);
  ok('and the last request of the whole run is the third one (nothing after the Stop: no destination, no Email on Acid)', /\/e\/\d+\//.test(st.reqs[st.reqs.length - 1].url), st.reqs[st.reqs.length - 1].url);
  eq('Email on Acid never started', (rec.sources.eoa || []).map(function (e) { return e.state; }).join(), 'stopped,stopped');
  eq('the Mailtrap source is ok (it finished before the Stop)', rec.sources.mailtrap.state, 'ok');
  ok('the links listed so far are kept, not all of them', rec.links.length > 0 && rec.links.length < 40, rec.links.length);
  eq('the tab was closed', Object.keys(st.tabs).length, 0);
});

// ── NEVER-FETCH: guards, dedupe, caps ───────────────────────────────────────────────────────────────────────
var INJ_A = '<a href="https://marketing.example.org/e/900001/slug-a/zzunsub1/2000000002/h/SynthHash0">Unsubscribe from these emails</a>'
  + '<a href="https://marketing.example.org/e/900001/slug-b/zzview1/2000000002/h/SynthHash0">View this email in your browser</a>'
  + '<a href="https://marketing.example.org/preferences/900001/abc123">Click here</a>'
  + '<a href="https://marketing.example.org/e/900001/slug-c/zzpos1/2000000002/h/SynthHash0"></a>';
var INJ_B = '<a href="https://marketing.example.org/e/900001/slug-a/zzunsub1/2000000002/h/SynthHash0">Learn more about our work</a>'
  + '<a href="https://marketing.example.org/e/900001/slug-d/zzok1/2000000002/h/SynthHash0">Read our annual report</a>';
T('never-fetch: a link guarded in ANY proof (text, position, path) is not requested, whichever proof it comes up in', function () {
  var inj = { '7100000005': INJ_A, '7100000006': INJ_B };
  var w = ecWorld({ inject: inj });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec, st = w.st;
  var want = expectedPardotIds('EX-2', inj);
  ok('the fixture check itself: the injected control link is wanted, the guarded ones are not', want.indexOf('zzok1') >= 0 && want.indexOf('zzunsub1') < 0 && want.indexOf('zzview1') < 0 && want.indexOf('zzpos1') < 0, want.filter(function (x) { return /^zz/.test(x); }));
  eq('25 tracked-link GETs: the 24 of the clean run plus the control link', st.pardotReqs.length, 25);
  jeq('exactly the expected linkIds were requested, each once', st.pardotReqs.slice().sort(), want.slice().sort());
  ['zzunsub1', 'zzview1', 'zzpos1'].forEach(function (id) { eq(id + ' was never requested', st.pardotReqs.indexOf(id), -1); });
  eq('the control link was requested once', count(st.pardotReqs, function (x) { return x === 'zzok1'; }), 1);
  eq('nothing was requested at /preferences/, /webmail/ or /unsubscribeConfirm/', reqsTo(w, /\/(preferences?|webmail|unsubscribeConfirm)\//).length, 0);
  var inA = rec.links.filter(function (l) { return l.proofId === 'regular-donors-v0' && l.linkId === 'zzunsub1'; })[0], inB = rec.links.filter(function (l) { return l.proofId === 'regular-donors-v1' && l.linkId === 'zzunsub1'; })[0];
  ok('the "Unsubscribe" link is listed in proof A with its guard (text)', inA && inA.guard === 'text' && inA.method === null && inA.dest === null, inA);
  ok('and in proof B, where its text is harmless, it is guarded too (guarded in ANY proof) and not opened', inB && !!inB.guard && inB.method === null && inB.dest === null && inB.pardotStatus === null, inB);
  var pos = rec.links.filter(function (l) { return l.linkId === 'zzpos1'; })[0];
  ok('the empty last anchor is guarded by position', pos && pos.guard === 'position', pos);
  var pref = rec.links.filter(function (l) { return l.kind === 'direct' && l.guard === 'path'; });
  ok('the /preferences/ link is listed as a guarded direct link (path)', pref.length === 1 && pref[0].method === null, pref);
  var ok1 = rec.links.filter(function (l) { return l.linkId === 'zzok1'; })[0];
  ok('the control link was resolved (method, 200, destination)', ok1 && ok1.method && ok1.pardotStatus === 200 && ok1.dest && ok1.dest.origin === DEST, ok1);
  eq('every guarded link of the record has no request behind it', count(rec.links, function (l) { return l.guard && (l.method !== null || l.dest !== null || l.error !== null); }), 0);
  eq('scrub', leaks(rec).join('|'), '');
});

function jsEsc(u) { return u.replace(/[^A-Za-z0-9]/g, function (c) { var h = c.charCodeAt(0).toString(16); return '\\x' + (h.length < 2 ? '0' : '') + h; }); }
T('tracked links: a redirect, a JS-only interstitial, a page with no destination, a 404; a destination on an unsubscribe path is not opened', function () {
  function anchor(id, text) { return '<a href="https://marketing.example.org/e/900001/s-' + id + '/' + id + '/2000000002/h/SynthHash0">' + text + '</a>'; }
  var inj = { '7100000005': anchor('zzred1', 'Our story') + anchor('zzjs1', 'Our impact') + anchor('zzempty1', 'Our team') + anchor('zz4041', 'Our partners') + anchor('zzbad1', 'Our policies') };
  var q = '?utm_source=pardot&utm_medium=email&utm_campaign=Gen_Campaign&utm_content=00.00.00_EML_Gen_CRO&utm_term=701EX00000genabAAA';
  var pardot = {
    zzred1: { status: 200, body: '<html>dest</html>', url: DEST + '/stories/redirected/' + q },
    zzjs1: { status: 200, body: '<html><body><script>window.location.href = \'' + jsEsc(DEST + '/stories/jsonly/' + q) + '\';</script></body></html>' },
    zzempty1: { status: 200, body: '<html><body><p>nothing here</p></body></html>' },
    zz4041: { status: 404, body: '<html><body>Not Found</body></html>' },
    zzbad1: { status: 200, body: '<html><body><a href=\'' + (DEST + '/unsubscribe/now/' + q).replace(/&/g, '&amp;') + '\'>x</a></body></html>' },
  };
  var w = ecWorld({ inject: inj, pardot: pardot });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec, st = w.st;
  function L(id) { return rec.links.filter(function (l) { return l.linkId === id; })[0] || {}; }
  eq('a redirect off the tracking host: method redirect, 200, the destination path', [L('zzred1').method, L('zzred1').pardotStatus, (L('zzred1').dest || {}).path].join(), 'redirect,200,/stories/redirected/');
  eq('its utm_* parameters were kept, others only by name', JSON.stringify(Object.keys((L('zzred1').dest || {}).utm || {})), '["utm_source","utm_medium","utm_campaign","utm_content","utm_term"]');
  eq('an interstitial with only the JS redirect: method interstitial-js, the \\xNN escapes decoded', [L('zzjs1').method, (L('zzjs1').dest || {}).path, (L('zzjs1').dest || {}).origin].join(), 'interstitial-js,/stories/jsonly/,' + DEST);
  eq('a page with no destination: no method, no dest, the sentence', [L('zzempty1').method, L('zzempty1').dest, L('zzempty1').error].join(), ',,not resolved: the tracked link gave no destination');
  eq('a tracked link that answers 404: its status is kept (the checks fail it), nothing else', [L('zz4041').pardotStatus, L('zz4041').dest].join(), '404,');
  eq('every one of them was requested exactly once', ['zzred1', 'zzjs1', 'zzempty1', 'zz4041', 'zzbad1'].map(function (id) { return count(st.pardotReqs, function (x) { return x === id; }); }).join(), '1,1,1,1,1');
  eq('a destination on an /unsubscribe/ path is NOT requested (the network layer refuses it, whatever the plan said)', reqsTo(w, /\/unsubscribe\//).length, 0);
  ok('the link says why: destStatus null and a "not opened" error', L('zzbad1').dest && L('zzbad1').dest.path === '/unsubscribe/now/' && L('zzbad1').destStatus === null && /not opened/.test(L('zzbad1').error || ''), L('zzbad1'));
  ok('and the redirect and JS destinations were each requested once, without query', reqsTo(w, /\/stories\/(redirected|jsonly)\//).length === 2 && reqsTo(w, /\/stories\/(redirected|jsonly)\//).every(function (r) { return r.url.indexOf('?') < 0; }));
});

T('never-fetch: a tracked-link path on a host outside the profile\'s pardotHosts is refused, never fetched as a destination (N4)', function () {
  var anchor = '<p><a href="https://track.example.net/e/900001/slug-u/zzunk1/2000000002/h/SynthHash0">Unknown host link</a></p>';
  var w = ecWorld({ inject: { '7100000005': anchor } });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec, mine = rec.links.filter(function (l) { return l.labels.indexOf('Unknown host link') >= 0; })[0];
  ok('the link is listed, as a direct link with the reason and nothing resolved', !!mine && mine.kind === 'direct' && mine.error === 'not resolved: tracked link of an unknown host' && mine.dest === null && mine.method === null && mine.destStatus === null && mine.pardotStatus === null, mine);
  eq('no request went to that host (neither as a tracked link nor as a destination)', reqsTo(w, /track\.example\.net/).length, 0);
  eq('and nothing foreign was requested', w.st.foreign.length, 0);
  eq('the 24 tracked-link GETs of the run are unchanged', w.st.pardotReqs.length, 24);
  eq('the record holds no prospect id, hash or tracked path of it', leaks(rec).join('|'), '');
  ok('and no zzunk1', JSON.stringify(rec).indexOf('zzunk1') < 0);
  var c = rec.checks.filter(function (x) { return x.key === 'links' && x.proofId === 'regular-donors-v0'; })[0];
  ok('the links row of that proof is In Progress and says it was not resolved', c.status === 'in-progress' && /Unknown host link was not resolved \(not resolved: tracked link of an unknown host\)/.test(c.note), c);
  ok('the other proofs\' links rows are as before', rec.checks.filter(function (x) { return x.key === 'links' && x.proofId !== 'regular-donors-v0'; }).every(function (x) { return x.status === 'passed'; }));
  // a profile with no Pardot hosts at all (the generic one): every tracked-shaped link is "unknown": no tracked-link GET, no destination GET of a tracked path
  var wg = ecWorld({});
  var og = ecRun(wg, mkCtx('EX-2'), mkSettings('EX-2', { profileId: 'generic' }));
  eq('generic profile: the run used the generic profile', og.rec.profileId, 'generic');
  eq('generic profile: no request to the tracking host at all', reqsTo(wg, /marketing\.example\.org/).length, 0);
  ok('generic profile: every tracked-shaped link says why, none was resolved', og.rec.links.filter(function (l) { return !l.guard && l.kind === 'direct' && l.error === 'not resolved: tracked link of an unknown host'; }).length > 20 && og.rec.links.every(function (l) { return l.guard || l.dest === null; }), og.rec.links.length);
  eq('generic profile: nothing foreign, nothing leaked', wg.st.foreign.length + '|' + leaks(og.rec).join(','), '0|');
});

T('never-fetch: where a followed redirect ENDS is checked against the never-open list; such an answer is dropped unread (N5)', function () {
  var anchors = '<p><a href="https://marketing.example.org/e/900001/slug-r/zzredir/2000000002/h/SynthHash0">Redirect link</a></p>';
  var w = ecWorld({ inject: { '7100000005': anchors }, pardot: { zzredir: { status: 200, body: '<html><head><title>Unsubscribe</title></head></html>', url: 'https://marketing.example.org/unsubscribeConfirm/900001/0123456789abcdef0123456789abcdef/2000000002' } } });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec, l = rec.links.filter(function (x) { return x.linkId === 'zzredir'; })[0];
  eq('the tracked link was requested once (the redirect itself cannot be refused before it is made)', w.st.pardotReqs.filter(function (id) { return id === 'zzredir'; }).length, 1);
  ok('its answer was refused: the link says it redirected to a never-open path, with no destination, no status, no method', !!l && l.error === 'Refused: the address redirected to an unsubscribe, preferences or view-in-browser path (not read).' && l.dest === null && l.method === null && l.pardotStatus === null && l.destStatus === null, l);
  eq('it was not followed any further by us: no request to a webmail or unsubscribe path', reqsTo(w, /\/(webmail|unsubscribe\w*)\//).length, 0);
  eq('and the record holds no unsubscribe path, id or hash', leaks(rec).join('|') + '|' + (JSON.stringify(rec).indexOf('unsubscribeConfirm') >= 0), '|false');
  var c = rec.checks.filter(function (x) { return x.key === 'links' && x.proofId === 'regular-donors-v0'; })[0];
  ok('the links row of that proof is In Progress', c.status === 'in-progress' && /Redirect link was not resolved/.test(c.note), c);
  eq('the other tracked links were resolved as before', w.st.pardotReqs.length, 25);
  // a destination that redirects to such a path
  var w2 = ecWorld({ destFinal: function (path) { return /\/give\/seed-kits\/$/.test(path) ? 'https://www.example.org/preferences/center/' : null; } });
  var out2 = ecRun(w2, mkCtx('EX-2'), mkSettings('EX-2'));
  var dl = out2.rec.links.filter(function (x) { return x.dest && x.dest.path === '/give/seed-kits/'; });
  ok('a destination whose redirects end on a preferences path: status null, title null, the refusal as the error', dl.length > 0 && dl.every(function (x) { return x.destStatus === null && x.destTitle === null && /redirected to an unsubscribe, preferences or view-in-browser path/.test(x.error || ''); }), dl[0]);
  eq('and is requested once, as before', reqsTo(w2, /\/give\/seed-kits\/$/).length, 1);
  // the same redirect that stays on a normal path is not touched
  var w3 = ecWorld({ destFinal: function (path) { return /\/give\/seed-kits\/$/.test(path) ? 'https://www.example.org/give/seed-kits/thanks/' : null; } });
  var out3 = ecRun(w3, mkCtx('EX-2'), mkSettings('EX-2'));
  ok('a redirect that ends on an ordinary path is kept', out3.rec.links.filter(function (x) { return x.dest && x.dest.path === '/give/seed-kits/'; }).every(function (x) { return x.destStatus === 200 && !x.error; }));
});

T('never-fetch: the cap of 20 distinct tracked linkIds per proof', function () {
  var base = PROOFS['EX-2'].proofs[0], proofs = {};
  var anchors = []; for (var k = 1; k <= 25; k++) anchors.push('<a href="https://marketing.example.org/e/900001/cap-slug/p1l' + k + '/2000000002/h/SynthHash0">Cap link ' + k + '</a>');
  proofs['7100000101'] = Object.assign({}, base, { messageId: '7100000101', htmlsource: '<html><body><div style="display:none">Preview text for the cap test.</div><p>Hello,</p>' + anchors.join('') + '</body></html>' });
  var ctx = ecCtxForWorker({ ticketKey: 'EX-2', summary: 's', emailProofs: [{ segment: 'Cap One', variation: 'v0', url: 'https://mailtrap.io/sandboxes/7000001/messages/7100000101' }], emailEoa: [] });
  var w = ecWorld({ proofs: proofs });
  var out = ecRun(w, ctx, mkSettings('EX-2'));
  var rec = out.rec;
  eq('25 links listed', rec.links.length, 25);
  eq('20 tracked-link GETs', w.st.pardotReqs.length, 20);
  eq('the first 20, in page order, were resolved', rec.links.filter(function (l) { return l.method; }).map(function (l) { return l.linkId; }).join(), w.st.pardotReqs.join());
  var capped = rec.links.filter(function (l) { return l.error === 'not resolved: cap'; });
  eq('the other 5 say "not resolved: cap" and nothing else', capped.length, 5);
  ok('and have no request behind them', capped.every(function (l) { return w.st.pardotReqs.indexOf(l.linkId) < 0 && l.method === null && l.dest === null; }));
  eq('one destination request (all twenty point at the same path), without a query', reqsTo(w, /^https:\/\/www\.example\.org\//).map(function (r) { return r.url; }).join(), DEST + '/cap/');
});

T('never-fetch: the per-proof cap is 20 DISTINCT linkIds: 20 pass, the 21st does not, a repeated linkId counts once (N9, P2)', function () {
  function runWith(anchorsHtml) {
    var base = PROOFS['EX-2'].proofs[0], proofs = {};
    proofs['7100000201'] = Object.assign({}, base, { messageId: '7100000201', htmlsource: '<html><body><div style="display:none">Preview text for the cap test.</div><p>Hello,</p>' + anchorsHtml + '</body></html>' });
    var ctx = ecCtxForWorker({ ticketKey: 'EX-2', summary: 's', emailProofs: [{ segment: 'Cap One', variation: 'v0', url: 'https://mailtrap.io/sandboxes/7000001/messages/7100000201' }], emailEoa: [] });
    var w = ecWorld({ proofs: proofs });
    var out = ecRun(w, ctx, mkSettings('EX-2'));
    return { w: w, rec: out.rec };
  }
  function a(k) { return '<a href="https://marketing.example.org/e/900001/cap-slug/q1l' + k + '/2000000002/h/SynthHash0">Link ' + k + '</a>'; }
  var h20 = ''; for (var k = 1; k <= 20; k++) h20 += a(k);
  var r20 = runWith(h20);
  eq('exactly 20 distinct links: 20 requests and none capped', r20.w.st.pardotReqs.length + '|' + count(r20.rec.links, function (l) { return l.error === 'not resolved: cap'; }), '20|0');
  var r21 = runWith(h20 + a(21));
  eq('a 21st distinct link: still 20 requests, the 21st is capped', r21.w.st.pardotReqs.length + '|' + count(r21.rec.links, function (l) { return l.error === 'not resolved: cap'; }), '20|1');
  ok('and it is the 21st in page order that is capped, with no request behind it', r21.rec.links.filter(function (l) { return l.error === 'not resolved: cap'; })[0].linkId === 'q1l21' && r21.w.st.pardotReqs.indexOf('q1l21') < 0);
  var rRep = runWith(h20 + a(1) + a(2) + a(3));
  eq('a linkId that appears again is one link: 20 requests, nothing capped, 20 listed', rRep.w.st.pardotReqs.length + '|' + count(rRep.rec.links, function (l) { return l.error === 'not resolved: cap'; }) + '|' + rRep.rec.links.length, '20|0|20');
});

T('never-fetch: every tracked-link GET omits cookies and sends no referrer (N9, P4)', function () {
  var w = ecWorld({ ticket: 'EX-2' });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var reqs = reqsTo(w, /\/e\/\d+\//);
  eq('there were 24 of them', reqs.length, 24);
  eq('credentials is omit on every one', count(reqs, function (r) { return r.init.credentials === 'omit'; }), 24);
  eq('and none uses include or same-origin', count(reqs, function (r) { return r.init.credentials === 'include' || r.init.credentials === 'same-origin'; }), 0);
  eq('referrerPolicy is no-referrer on every one', count(reqs, function (r) { return r.init.referrerPolicy === 'no-referrer'; }), 24);
  eq('and the method is GET (or the default) on every one', count(reqs, function (r) { return !r.init.method || r.init.method === 'GET'; }), 24);
  eq('no request of the run sends an Authorization header except to the Docs API', count(w.st.reqs, function (r) { return r.init.headers && r.init.headers.Authorization && !/docs\.googleapis\.com/.test(r.url); }), 0);
  var dest = reqsTo(w, /^https:\/\/www\.example\.org\//);
  eq('the destination requests omit cookies as well', count(dest, function (r) { return r.init.credentials === 'omit'; }), dest.length);
});

T('never-fetch: the cap of 80 tracked-link GETs per run (5 proofs x 25 links)', function () {
  var base = PROOFS['EX-2'].proofs[0], proofs = {}, entries = [], names = ['Cap One', 'Cap Two', 'Cap Three', 'Cap Four', 'Cap Five'];
  for (var n = 1; n <= 5; n++) {
    var anchors = []; for (var k = 1; k <= 25; k++) anchors.push('<a href="https://marketing.example.org/e/900001/cap-slug/p' + n + 'l' + k + '/2000000002/h/SynthHash0">Cap link ' + k + '</a>');
    var id = '71000001' + (10 + n);
    proofs[id] = Object.assign({}, base, { messageId: id, htmlsource: '<html><body><div style="display:none">Preview text for the cap test.</div><p>Hello,</p>' + anchors.join('') + '</body></html>' });
    entries.push({ segment: names[n - 1], variation: 'v0', url: 'https://mailtrap.io/sandboxes/7000001/messages/' + id });
  }
  var w = ecWorld({ proofs: proofs });
  var out = ecRun(w, ecCtxForWorker({ ticketKey: 'EX-2', summary: 's', emailProofs: entries, emailEoa: [] }), mkSettings('EX-2'));
  var rec = out.rec;
  eq('125 links listed', rec.links.length, 125);
  eq('EXACTLY 80 tracked-link GETs (EC_MAX_RESOLVES)', w.st.pardotReqs.length, 80);
  eq('each linkId once', distinct(w.st.pardotReqs).length, 80);
  eq('45 links say "not resolved: cap" (5 per proof for the first four, all 25 of the fifth)', count(rec.links, function (l) { return l.error === 'not resolved: cap'; }), 45);
  eq('the fifth proof got none of the 80', count(rec.links, function (l) { return l.proofId === 'cap-five-v0' && l.method; }), 0);
  eq('the destination is requested once, without a query', reqsTo(w, /^https:\/\/www\.example\.org\//).length, 1);
  eq('the run is not an error', rec.error, null);
});

T('ecwFetch: a request that never answers is aborted after EC_FETCH_TIMEOUT_MS (15 s), reported, and not retried', function () {
  var w = ecWorld({ hang: function (url) { return /\/give\/seed-kits\/$/.test(url); } });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec;
  var hung = reqsTo(w, /\/give\/seed-kits\/$/);
  eq('the hanging destination was requested once, without a query', hung.length + '|' + (hung[0] && hung[0].url.indexOf('?')), '1|-1');
  var dst = rec.links.filter(function (l) { return l.dest && l.dest.path === '/give/seed-kits/'; });
  ok('every link that leads there says the request timed out, with no status', dst.length > 0 && dst.every(function (l) { return l.destStatus === null && l.error === 'Timed out after 15 s.'; }), dst[0]);
  ok('the rest of the run is unaffected (4 proofs, 24 tracked-link GETs, the other destinations answered)', count(rec.proofs, function (p) { return p.state === 'ok'; }) === 4 && w.st.pardotReqs.length === 24 && rec.links.some(function (l) { return l.destStatus === 200; }));
  ok('the wait was about 15 s of the virtual clock, not more', (function () { var t = hung[0].t, next = w.st.reqs.filter(function (r) { return r.t > t + 1000; })[0]; return !!next && next.t - t >= 15000 && next.t - t < 17000; })());
  eq('the run answers ok', out.res && out.res.ok, true);
});

T('never-fetch: the same linkId in two proofs is one request; a failed one is not retried; errors are scrubbed', function () {
  var w = ecWorld({ pardotFail: function (id) { return id === SHARED_ID; }, destFail: function (path) { return /\/give\/seed-kits\/?$/.test(path); } });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec, st = w.st;
  eq('still one request per linkId (24)', st.pardotReqs.length, 24);
  var failed = rec.links.filter(function (l) { return l.linkId === SHARED_ID; });
  ok('the failed tracked link is listed in every proof that holds it, with the same error', failed.length >= 2 && failed.every(function (l) { return l.method === null && l.dest === null && /Load failed/.test(l.error || ''); }), failed.slice(0, 2));
  eq('requested once (no retry)', count(st.pardotReqs, function (x) { return x === SHARED_ID; }), 1);
  ok('the error text (a browser message that quotes the tracked address) holds no prospect id and no hash: the path tail is scrubbed', JSON.stringify(failed).indexOf('2000000002') < 0 && JSON.stringify(failed).indexOf('SynthHash0') < 0 && /\[prospect\]\/h\/\[hash\]/.test(failed[0].error || ''), failed[0]);
  var dst = rec.links.filter(function (l) { return l.dest && l.dest.path === '/give/seed-kits/'; });
  ok('a destination that cannot be fetched keeps the link resolved but its status null with the error', dst.length > 0 && dst.every(function (l) { return l.destStatus === null && /Failed to fetch/.test(l.error || ''); }), dst[0]);
  ok('and a browser error that quotes the page address with its query is cut to origin + path (qpScrubUrls)', JSON.stringify(rec).indexOf('SECRETVALUE') < 0 && JSON.stringify(rec).indexOf('?utm_term') < 0, dst[0]);
  ok('the shared linkId is one fixture linkId of two proofs', typeof SHARED_ID === 'string' && failed.length >= 2, SHARED_ID);
});

// ── The gate override, end to end ───────────────────────────────────────────────────────────────────────────
var GATE_PORT = 'http://127.0.0.1:7777';
function gateAll(skip, over) {
  var g = {};
  [MT_ORIGIN, PARDOT, DEST, EOA_HOST, IMG_HOST, DOCS_HOST].forEach(function (o) { if (skip !== o) g[o] = GATE_PORT; });
  return Object.assign(g, over || {});
}
T('gate override, end to end: every origin mapped to 127.0.0.1, no real address touched, no Google sign-in', function () {
  var w = ecWorld({ gate: gateAll(), token: false, identity: function () { return { getRedirectURL: function () { throw new Error('the gate must not touch Google sign-in'); }, launchWebAuthFlow: function () { throw new Error('no sign-in in the gate'); } }; } });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec, st = w.st;
  ok('the run answers ok', out.res && out.res.ok === true, out.res && out.res.error);
  ok('EVERY request went to 127.0.0.1:7777', st.reqs.length > 0 && st.reqs.every(function (r) { return r.url.indexOf(GATE_PORT + '/') === 0; }), st.reqs.filter(function (r) { return r.url.indexOf(GATE_PORT + '/') !== 0; }).map(function (r) { return r.url; }));
  ok('and every tab it opened', st.created.length === 3 && st.created.every(function (c) { return c.props.url.indexOf(GATE_PORT + '/') === 0; }), st.created.map(function (c) { return c.props.url; }));
  eq('no request reached a real address', st.foreign.length, 0);
  eq('the Mailtrap tab path is the sandbox message page', st.created[0].props.url, GATE_PORT + '/sandboxes/7000001/messages/7100000005');
  eq('the doc was read with NO token and no authorization header', rec.sources.doc.state + '|' + (reqsTo(w, /\/v1\/documents\//)[0].init.headers || {}).Authorization, 'ok|undefined');
  eq('Mailtrap ok, four proofs read', rec.sources.mailtrap.state + '|' + count(rec.proofs, function (p) { return p.state === 'ok'; }), 'ok|4');
  eq('24 tracked-link GETs, through the gate', st.pardotReqs.length, 24);
  ok('the record reports the ORIGINS the pages asked for, not the gate address', JSON.stringify(rec).indexOf('127.0.0.1') < 0 && rec.links.filter(function (l) { return !l.guard; }).every(function (l) { return l.dest && l.dest.origin === DEST && l.method === 'interstitial-a'; }), rec.links[0]);
  eq('the renders were captured through the gate', rec.renders.length, 32);
  eq('every EoA source ok', (rec.sources.eoa || []).map(function (e) { return e.state; }).join(), 'ok,ok');
  eq('never-fetch holds in the gate too', reqsTo(w, /\/(webmail|unsubscribeConfirm)\//).length, 0);
  eq('the variable is removed again after the test', typeof globalThis.__ecGateOrigins, 'undefined');
});

T('gate override, end to end: an origin the gate does not map is REFUSED (no request), the run goes on', function () {
  var w = ecWorld({ gate: gateAll(DEST), token: false });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec, st = w.st;
  ok('the run answers ok', out.res && out.res.ok === true, out.res && out.res.error);
  eq('no request for the unmapped destination host (the router would log it as 127.0.0.1/<path>, so count the paths)', count(st.reqs, function (r) { return /\/give\/|\/cap\//.test(r.url); }), 0);
  eq('nothing reached a real address', st.foreign.length, 0);
  var open = rec.links.filter(function (l) { return !l.guard && l.dest; });
  ok('tracked links were still resolved (their destinations are known)', open.length > 0 && open.every(function (l) { return !!l.method; }));
  ok('every destination check says Refused, with the origin and nothing more', open.every(function (l) { return l.destStatus === null && /^Refused: https:\/\/www\.example\.org is not an allowed address/.test(l.error || ''); }), open[0]);
  eq('the rest of the run is unaffected: 4 proofs, 24 GETs', count(rec.proofs, function (p) { return p.state === 'ok'; }) + '|' + st.pardotReqs.length, '4|24');
});

T('gate override, end to end: only invalid values (https, userinfo trick) = nothing mapped = every call refused, no tab, no request', function () {
  var g = {}; [MT_ORIGIN, PARDOT, DEST, EOA_HOST, IMG_HOST, DOCS_HOST].forEach(function (o) { g[o] = 'https://evil.example'; });
  g[PARDOT] = 'http://127.0.0.1:7777@evil.example';
  var w = ecWorld({ gate: g, token: false });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec, st = w.st;
  ok('the run still answers ok with a record (refusals are states)', out.res && out.res.ok === true && !!out.res.record, out.res && out.res.error);
  eq('NO request at all', st.reqs.length, 0);
  eq('NO tab at all', st.created.length, 0);
  eq('Mailtrap is an error that says Refused', rec.sources.mailtrap.state + '|' + /Refused/.test(rec.sources.mailtrap.error || ''), 'error|true');
  eq('the doc is an error that says Refused', rec.sources.doc.state + '|' + /Refused/.test(rec.sources.doc.error || ''), 'error|true');
  eq('Email on Acid is an error for both variations, saying Refused', (rec.sources.eoa || []).map(function (e) { return e.state + ':' + /Refused/.test(e.renders.error || ''); }).join(), 'error:true,error:true');
  ok('nothing in the record names evil.example', JSON.stringify(rec).indexOf('evil.example') < 0);
  eq('the gate variable is gone again', typeof globalThis.__ecGateOrigins, 'undefined');
});

T('gate override, end to end: the Pardot entry replaced by a userinfo trick is dropped: tracked links refused, the rest works', function () {
  var w = ecWorld({ gate: gateAll(PARDOT, (function () { var o = {}; o[PARDOT] = 'http://127.0.0.1:7777@evil.example'; return o; })()), token: false });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec, st = w.st;
  eq('no tracked-link request', st.pardotReqs.length, 0);
  eq('no request to evil.example', count(st.reqs, function (r) { return /evil\.example/.test(r.url); }), 0);
  ok('every open link says Refused', rec.links.filter(function (l) { return !l.guard; }).every(function (l) { return l.method === null && /Refused/.test(l.error || ''); }));
  eq('Mailtrap and the doc still work', rec.sources.mailtrap.state + '|' + rec.sources.doc.state, 'ok|ok');
});

// ── The copy doc: tokens and states ─────────────────────────────────────────────────────────────────────────
function authCtl(script) {
  return function (w, st) {
    var A = { calls: [] }; st.auth = A;
    return { getRedirectURL: function () { return 'https://abc.chromiumapp.org/'; }, launchWebAuthFlow: function (opts) { A.calls.push(opts); return script(opts, A.calls.length); } };
  };
}
function stateOf(url) { var m = /[?&]state=([^&]+)/.exec(url); return m ? m[1] : ''; }
function authOk(token, scope) { return function (o) { return Promise.resolve('https://abc.chromiumapp.org/#access_token=' + token + '&token_type=Bearer&expires_in=3599&scope=' + encodeURIComponent(scope) + '&state=' + stateOf(o.url)); }; }
function authErr(code) { return function (o) { return Promise.resolve('https://abc.chromiumapp.org/#error=' + code + '&state=' + stateOf(o.url)); }; }

T('doc: a token without the Docs permission is needs-connect, with no Docs request; the rest of the run goes on (D9)', function () {
  var w = ecWorld({ token: 'https://www.googleapis.com/auth/spreadsheets' });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  var rec = out.rec;
  eq('the doc source is needs-connect', rec.sources.doc.state, 'needs-connect');
  eq('with the sentence', rec.sources.doc.error, 'Connect Google again: the Docs permission was added after you connected.');
  eq('and no request went to the Docs API', w.st.docReqs, 0);
  eq('rec.doc is null', rec.doc, null);
  eq('Mailtrap and the links are unaffected', rec.sources.mailtrap.state + '|' + w.st.pardotReqs.length, 'ok|24');
  eq('the token is not in the record', leaks(rec).join('|'), '');
  var c = rec.checks || [];
  ok('B2: the copy-doc rows are In Progress (no doc), the build-only rows are decided', c.some(function (x) { return x.key === 'subject' && x.status === 'in-progress'; }) && c.some(function (x) { return x.key === 'rawTokens' && x.status === 'passed'; }));
});

T('doc: a 401 drops the token and retries ONCE with a silent renewal; a 404 is an error; no token + a flow that needs the user is needs-connect', function () {
  var w = ecWorld({ docToken: 'tok2', identity: authCtl(authOk('tok2', SK_BOTH)) });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  eq('the doc was read after one renewal', out.rec.sources.doc.state, 'ok');
  eq('two Docs requests', w.st.docReqs, 2);
  jeq('the first used the stored token, the second the renewed one', reqsTo(w, /\/v1\/documents\//).map(function (r) { return r.init.headers.Authorization; }), ['Bearer tok1', 'Bearer tok2']);
  eq('the renewal was silent (one non-interactive flow)', w.st.auth.calls.map(function (c) { return c.interactive; }).join(), 'false');
  eq('the new token is stored with its scope', w.store.session.qpGoogleToken.accessToken + '|' + w.store.session.qpGoogleToken.scope, 'tok2|' + SK_BOTH);
  var w2 = ecWorld({ docStatus: 404 });
  var out2 = ecRun(w2, mkCtx('EX-2'), mkSettings('EX-2'));
  eq('a 404 is an error that says so', out2.rec.sources.doc.state + '|' + out2.rec.sources.doc.error, 'error|The copy doc was not found.');
  eq('and is not retried', w2.st.docReqs, 1);
  var w3 = ecWorld({ token: false, identity: authCtl(authErr('interaction_required')) });
  var out3 = ecRun(w3, mkCtx('EX-2'), mkSettings('EX-2'));
  eq('no token and a silent flow that needs the user: needs-connect', out3.rec.sources.doc.state, 'needs-connect');
  eq('without a Docs request and without opening the chooser', w3.st.docReqs + '|' + w3.st.auth.calls.map(function (c) { return c.interactive; }).join(), '0|false');
  eq('the rest of the run is unaffected', out3.rec.sources.mailtrap.state, 'ok');
});

T('doc: a 403 says why: the Docs API is not enabled in the Cloud project, a missing scope, or a doc that is not shared (N2)', function () {
  var ENABLE = 'Enable the Google Docs API in the Cloud project, then run again.';
  var disabled = { error: { code: 403, message: 'Google Docs API has not been used in project 123456789012 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/docs.googleapis.com/overview?project=123456789012 then retry.', status: 'PERMISSION_DENIED' } };
  var w = ecWorld({ docStatus: 403, docError: disabled });
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2'));
  eq('the API not enabled: an error with the instruction', out.rec.sources.doc.state + '|' + out.rec.sources.doc.error, 'error|' + ENABLE);
  eq('one request, not retried', w.st.docReqs, 1);
  ok('Google\'s own text (it names the project) is not kept', JSON.stringify(out.rec).indexOf('123456789012') < 0 && JSON.stringify(out.rec).indexOf('console.developers') < 0);
  ok('and the rest of the run is unaffected', out.rec.sources.mailtrap.state === 'ok' && w.st.pardotReqs.length === 24);
  var byReason = { error: { code: 403, message: 'Forbidden', status: 'PERMISSION_DENIED', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED', domain: 'googleapis.com' }] } };
  var out2 = ecRun(ecWorld({ docStatus: 403, docError: byReason }), mkCtx('EX-2'), mkSettings('EX-2'));
  eq('the reason SERVICE_DISABLED in the details counts too', out2.rec.sources.doc.error, ENABLE);
  var out2b = ecRun(ecWorld({ docStatus: 403, docError: { error: { code: 403, message: 'Forbidden', errors: [{ reason: 'accessNotConfigured', domain: 'usageLimits' }] } } }), mkCtx('EX-2'), mkSettings('EX-2'));
  eq('and the reason accessNotConfigured in errors', out2b.rec.sources.doc.error, ENABLE);
  var out3 = ecRun(ecWorld({ docStatus: 403, docError: { error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED' } } }), mkCtx('EX-2'), mkSettings('EX-2'));
  eq('insufficient scopes is still needs-connect', out3.rec.sources.doc.state + '|' + out3.rec.sources.doc.error, 'needs-connect|Connect Google again.');
  var out4 = ecRun(ecWorld({ docStatus: 403 }), mkCtx('EX-2'), mkSettings('EX-2'));
  eq('any other 403 is a doc that is not shared', out4.rec.sources.doc.state + '|' + out4.rec.sources.doc.error, 'error|The copy doc is not shared with this Google account.');
  var out5 = ecRun(ecWorld({ docStatus: 403, docError: 'not json' }), mkCtx('EX-2'), mkSettings('EX-2'));
  eq('a 403 whose body is not JSON is a doc that is not shared too', out5.rec.sources.doc.error, 'The copy doc is not shared with this Google account.');
});

T('doc: no Copy File = no-link, a link that is not a Docs link = not-a-doc-link; neither makes a request', function () {
  var w = ecWorld({});
  var out = ecRun(w, mkCtx('EX-2', { copyFileUrl: null }), mkSettings('EX-2'));
  eq('no Copy File: no-link', out.rec.sources.doc.state, 'no-link');
  eq('no Docs request', w.st.docReqs, 0);
  eq('rec.doc is null', out.rec.doc, null);
  var w2 = ecWorld({});
  var out2 = ecRun(w2, mkCtx('EX-2', { copyFileUrl: 'https://www.example.org/not-a-doc' }), mkSettings('EX-2'));
  eq('a URL that is not a Docs link: not-a-doc-link', out2.rec.sources.doc.state, 'not-a-doc-link');
  eq('no Docs request', w2.st.docReqs, 0);
  eq('the run goes on', out2.rec.sources.mailtrap.state, 'ok');
  var out3 = ecRun(ecWorld({}), mkCtx('EX-2', { copyFileUrl: null }), mkSettings('EX-2'));
  var c = out3.rec.checks || [];
  eq('B2: without a doc, subject is In Progress and senderSpelling is decided by the profile', (c.filter(function (x) { return x.id === 'subject@regular-donors-v0'; })[0] || {}).status + '|' + (c.filter(function (x) { return x.id === 'senderSpelling@regular-donors-v0'; })[0] || {}).status, 'in-progress|passed');
});

// ── Email on Acid ───────────────────────────────────────────────────────────────────────────────────────────
T('Email on Acid: renders off, no links, a failing page, a failing image, a refused image, the caps (D8)', function () {
  var w = ecWorld({});
  var out = ecRun(w, mkCtx('EX-2'), mkSettings('EX-2', { eoaRenders: false }));
  eq('renders off: the inventory is still read', (out.rec.sources.eoa || []).map(function (e) { return e.state + '/' + e.renders.state + '/' + e.clients.length; }).join(), 'ok/off/16,ok/off/16');
  eq('no EoA tab (only the Mailtrap one) and no image request', w.st.created.length + reqsTo(w, /images\.emailonacid\.com/).length, 1);
  eq('no renders', out.rec.renders.length, 0);

  var w2 = ecWorld({});
  var out2 = ecRun(w2, mkCtx('EX-2', { eoa: [] }), mkSettings('EX-2'));
  eq('no Email on Acid links: no sources, no request, no tab but the Mailtrap one', (out2.rec.sources.eoa || []).length + '|' + reqsTo(w2, /emailonacid/).length + '|' + w2.st.created.length, '0|0|1');
  var c2 = out2.rec.checks || [];
  eq('B2: visuals, alignment, darkMode and darkReadability are Blocked(eoa) on all four proofs (16)', count(c2, function (x) { return x.status === 'blocked' && x.blockedBy === 'eoa'; }), 16);

  var w3 = ecWorld({ eoa500: true });
  var out3 = ecRun(w3, mkCtx('EX-2'), mkSettings('EX-2'));
  eq('an EoA page that answers 500: both sources error, no renders, the run goes on', (out3.rec.sources.eoa || []).map(function (e) { return e.state; }).join() + '|' + out3.rec.renders.length + '|' + out3.res.ok, 'error,error|0|true');
  ok('the message names the status (on the source AND in renders.error: the panel reads the first), and renders is none', (out3.rec.sources.eoa || []).every(function (e) { return /500/.test(e.renders.error || '') && e.renders.state === 'none' && e.error === e.renders.error; }), (out3.rec.sources.eoa || []).map(function (e) { return e.renders; }));
  eq('Mailtrap and the links are unaffected', out3.rec.sources.mailtrap.state + '|' + w3.st.pardotReqs.length, 'ok|24');

  var w4 = ecWorld({ img403: true });
  var out4 = ecRun(w4, mkCtx('EX-2'), mkSettings('EX-2'));
  var imgs = reqsTo(w4, /\/web\//);
  eq('an image answered 403 is asked once more WITH credentials: 64 requests for 32 images', imgs.length, 64);
  ok('first omit, then include', imgs.every(function (r, i) { return r.init.credentials === (i % 2 === 0 ? 'omit' : 'include'); }), imgs.slice(0, 3).map(function (r) { return r.init.credentials; }));
  eq('all 32 renders were captured', out4.rec.renders.length, 32);

  var w5 = ecWorld({ imgFail: true });
  var out5 = ecRun(w5, mkCtx('EX-2'), mkSettings('EX-2'));
  eq('an image that cannot be fetched: renders error for both, inventory ok', (out5.rec.sources.eoa || []).map(function (e) { return e.state + '/' + e.renders.state; }).join(), 'ok/error,ok/error');
  eq('and the run continues', out5.res.ok + '|' + out5.rec.renders.length, 'true|0');

  var w6 = ecWorld({ bitmapFail: true });
  var out6 = ecRun(w6, mkCtx('EX-2'), mkSettings('EX-2'));
  eq('an image that cannot be decoded: renders error, inventory ok, run ok', (out6.rec.sources.eoa || []).map(function (e) { return e.state + '/' + e.renders.state; }).join() + '|' + out6.res.ok, 'ok/error,ok/error|true');

  var w7 = ecWorld({ eoaImages: 20 });
  var out7 = ecRun(w7, mkCtx('EX-2'), mkSettings('EX-2'));
  eq('a page with 20 images: 16 are kept per variation (EC_RENDER_MAX_PER_VARIATION), 32 renders in all', (out7.rec.sources.eoa || []).map(function (e) { return e.renders.count; }).join() + '|' + out7.rec.renders.length, '16,16|32');
  eq('and only 32 images were fetched', reqsTo(w7, /\/web\//).length, 32);

  var w8 = ecWorld({ imgJpegBytes: 480000 });
  var out8 = ecRun(w8, mkCtx('EX-2'), mkSettings('EX-2'));
  var total = out8.rec.renders.reduce(function (n, r) { return n + r.img.length - 'data:image/jpeg;base64,'.length; }, 0);
  ok('the byte cap (EC_RENDER_BYTES_CAP = 6 MB of base64) stops the renders', out8.rec.renders.length === 9 && total <= EC_RENDER_BYTES_CAP && total > 5000000, [out8.rec.renders.length, total]);
  eq('the variation it stopped in is capped with 9, the next one is capped with 0', (out8.rec.sources.eoa || []).map(function (e) { return e.renders.state + ':' + e.renders.count; }).join(), 'capped:9,capped:0');
  eq('the inventory of both is ok', (out8.rec.sources.eoa || []).map(function (e) { return e.state; }).join(), 'ok,ok');
});

// ── Opus: ecExplain ──────────────────────────────────────────────────────────────────────────────────────────
// The input is built by hand (what ecExplainInput would give for a failed altTags on one proof): this section pins what the WORKER does with the
// model (the request, the validator call, the answer), not the input builder.
var XIN = {
  ticketKey: 'EX-1', summary: 'Cold Route - Message 1', rules: { utm: { value: 'identical', source: 'suggested', commentId: '410001' } },
  checks: [{ id: 'altTags@regular-donors-v1', title: 'Do all images have proper alt-tags that describe the image?', status: 'failed', note: 'V1 image hero.jpg is the only link to /stories/route-nine/, and its alt does not mention "See What\'s in the Van".' },
    { id: 'subject@regular-donors-v0', title: 'Is the subject line rendering correctly?', status: 'passed', note: '' }],
  comments: [{ id: '410001', created: '2027-01-08T12:00:00.000-0400', text: 'The UTMs are identical across v0 and v1.' }], copyDiffs: [], variationDiff: null,
};
function xReply(parsed, stop) { return { stop_reason: stop || 'end_turn', content: [{ type: 'text', text: typeof parsed === 'string' ? parsed : JSON.stringify(parsed) }] }; }
T('ecExplain: one Opus call with the Email Check prompt and schema; the reply is validated; no status is ever taken from the model', function () {
  var w = ecWorld({});
  w.replies.push(xReply({
    bugs: [{ checkIds: ['altTags@regular-donors-v1', 'nope@x'], summary: 'The v1 hero image is the only link to the story page and its alt lacks the call to action.', severity: 'high', commentIds: ['410001', '9'], status: 'passed' },
      { checkIds: ['subject@regular-donors-v0'], summary: 'cites only a passed check', severity: 'low', commentIds: [] }],
    pgmQuestions: [{ question: 'Should the alt copy of the hero image name the call to action?', checkIds: ['altTags@regular-donors-v1'], commentIds: [] }, { question: 'cites nothing known', checkIds: ['zz@zz'], commentIds: ['0'] }],
    commentChecks: [{ commentId: '410001', reproduced: 'yes', checkIds: ['altTags@regular-donors-v1'], summary: 'agrees' }], copyNotes: [{ checkId: 'subject@regular-donors-v0', note: 'not a listed diff' }], status: 'passed',
  }));
  var r = ecCall(w, { action: 'ecExplain', payload: XIN });
  ok('B2: answers ok with the validated analysis (ecValidateExplain)', r && r.ok === true && r.explain && r.explain.ok === true, r);
  eq('B2: an unknown check id is removed from a bug', JSON.stringify(((r.explain || {}).bugs || [{}])[0].checkIds), '["altTags@regular-donors-v1"]');
  eq('B2: a bug citing only a passed check is dropped', ((r.explain || {}).bugs || []).length, 1);
  eq('B2: a question that cites nothing known is dropped', ((r.explain || {}).pgmQuestions || []).length, 1);
  ok('B2: a copy note for a check that has no listed diff is dropped', ((r.explain || {}).copyNotes || []).length === 0, (r.explain || {}).copyNotes);
  ok('B2: NO status anywhere in the answer, although the model sent some', JSON.stringify(r.explain).indexOf('"status"') < 0);
  eq('one model call', w.requests.length, 1);
  var body = w.requests[0] || {};
  eq('on Opus 5 (the only model call this mode adds)', body.model, 'claude-opus-5');
  eq('asking for json_schema output', body.output_config && body.output_config.format && body.output_config.format.type, 'json_schema');
  jeq('B2: with the Email Check explain schema (EC_EXPLAIN_SCHEMA)', body.output_config && body.output_config.format.schema, EC_EXPLAIN_SCHEMA);
  eq('and 4096 tokens', body.max_tokens, 4096);
  eq('B2: the system prompt is ecExplainSystem()', body.system, ecExplainSystem());
  eq('B2: the user turn is ecExplainUser(payload)', body.messages && body.messages[0].content, ecExplainUser(XIN));
  ok('no sonnet', JSON.stringify(body).indexOf('sonnet') < 0);
  var wn = ecWorld({ apiKey: false });
  eq('no API key: said so, no request', ecCall(wn, { action: 'ecExplain', payload: XIN }).error + '|' + wn.requests.length, 'No API key configured|0');
  var wr = ecWorld({}); wr.replies.push(xReply({}, 'refusal'));
  ok('B2: a refusal is an error, not a throw', ecCall(wr, { action: 'ecExplain', payload: XIN }).ok === false);
  var wm = ecWorld({}); wm.replies.push(xReply('{"bugs": [', 'max_tokens'));
  ok('B2: invalid JSON is an error, not a throw', ecCall(wm, { action: 'ecExplain', payload: XIN }).ok === false);
  var wo = ecWorld({}); wo.replies.push(xReply('"just a string"'));
  eq('B2: a non-object answer is an error, not a throw', ecCall(wo, { action: 'ecExplain', payload: XIN }).ok, false);
});

// ── The sheet: ecSheetApply and its F/G refusal ──────────────────────────────────────────────────────────────
var PLAN = PLANS['EX-1'], PLAN_ID = PLAN.spreadsheetId, TAB = 'QA Round 1';
function planNorm(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }
function ecSheets(plan) {
  var S = { reqs: [], token: 'tok1', grid: JSON.parse(JSON.stringify(plan.values)), tabs: plan.tabs.map(function (t) { return { sheetId: t.sheetId, title: t.title, index: t.index, hidden: !!t.hidden }; }) };
  function rangeOf(s) { var m = /^'((?:[^']|'')*)'!(.+)$/.exec(s); return { tab: m[1].replace(/''/g, "'"), a1: m[2] }; }
  function cellOf(a1) { var m = /^([A-Z]+)(\d+)$/.exec(a1); return { c: qpColIndex(m[1]), r: +m[2] - 1 }; }
  function resp(status, body) { return { ok: status >= 200 && status < 300, status: status, statusText: 's' + status, json: function () { return Promise.resolve(body); } }; }
  S.handle = function (url, init) {
    var rest = url.slice('https://sheets.googleapis.com/v4/spreadsheets/'.length), qi = rest.indexOf('?'), path = qi < 0 ? rest : rest.slice(0, qi), query = qi < 0 ? '' : rest.slice(qi + 1);
    var req = { url: url, path: path, method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : null };
    S.reqs.push(req);
    if (!init || !init.headers || init.headers.Authorization !== 'Bearer ' + S.token) return resp(401, { error: { message: 'Invalid Credentials' } });
    if (path.indexOf('/') < 0) return resp(200, { properties: { title: plan.title }, sheets: S.tabs.map(function (t) { return { properties: t }; }) });
    if (/\/values:batchGet$/.test(path)) {
      var ranges = query.split('&').filter(function (p) { return p.indexOf('ranges=') === 0; }).map(function (p) { return decodeURIComponent(p.slice(7)); });
      return resp(200, { valueRanges: ranges.map(function (rs) {
        var r = rangeOf(rs), m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(r.a1), c0 = qpColIndex(m[1]), c1 = qpColIndex(m[3]), r0 = +m[2] - 1, r1 = +m[4] - 1, rows = [];
        for (var i = r0; i <= r1; i++) { var row = []; for (var j = c0; j <= c1; j++) row.push((S.grid[i] && S.grid[i][j] != null) ? S.grid[i][j] : ''); rows.push(row); }
        return { range: rs, majorDimension: 'ROWS', values: rows };
      }) });
    }
    if (/\/values:batchUpdate$/.test(path)) {
      var n = 0;
      req.body.data.forEach(function (d) { var r = rangeOf(d.range), c = cellOf(r.a1); while (S.grid.length <= c.r) S.grid.push([]); while (S.grid[c.r].length <= c.c) S.grid[c.r].push(''); S.grid[c.r][c.c] = d.values[0][0]; n++; });
      return resp(200, { totalUpdatedCells: n });
    }
    return resp(404, { error: { message: 'not found' } });
  };
  S.cell = function (a1) { var c = cellOf(a1); return (S.grid[c.r] && S.grid[c.r][c.c] != null) ? S.grid[c.r][c.c] : ''; };
  S.gets = function () { return S.reqs.filter(function (r) { return /batchGet$/.test(r.path); }).length; };
  S.posts = function () { return S.reqs.filter(function (r) { return r.method === 'POST'; }); };
  return S;
}
// A write for the plan's cell (row, column letter): `old` is what the sheet holds, rowText the Description of that row as the panel read it.
function sw(S, row, col, next) { return { row: row, col: qpColIndex(col), a1: col + row, old: String(S.cell(col + row)), next: next, rowText: planNorm(S.cell('C' + row)) }; }
function sheetApply(over, S, wo) {
  var w = ecWorld(Object.assign({ sheets: S }, wo || {}));
  var r = ecCall(w, { action: 'ecSheetApply', payload: Object.assign({ spreadsheetId: PLAN_ID, tabTitle: TAB, textCols: [2], descCol: 2, eCol: 'E', notesCol: 'H', fgCols: ['F', 'G'], writes: [] }, over) });
  return { r: r, w: w };
}
// Rows of the first group of the EX-1 plan (label row 8): +1 subject, +25 overall visuals, +28 dark mode, +33 DKIM.
T('ecSheetApply: the sheet itself is what the fixture says (rows 9, 33, 36, 41 of the EX-1 plan)', function () {
  var S = ecSheets(PLAN);
  ok('row 9 is the subject row', /subject line/i.test(S.cell('C9')), S.cell('C9'));
  ok('row 33 is the overall visuals row', /overall visuals/i.test(S.cell('C33')), S.cell('C33'));
  ok('row 36 is the dark mode row', /dark mode/i.test(S.cell('C36')), S.cell('C36'));
  ok('row 41 is the DKIM row (not a visual row)', /dkim/i.test(S.cell('C41')) && !/visual|dark|alignment/i.test(S.cell('C41')), S.cell('C41'));
  ok('E, F, G of row 33 and E of row 9 hold status words', S.cell('E33') !== '' && S.cell('F33') !== '' && S.cell('G33') !== '' && S.cell('E9') !== '');
});

T('ecSheetApply: an F write on a content row refuses the WHOLE apply: nothing written, no request (D15, plan 6.8)', function () {
  var S = ecSheets(PLAN);
  var res = sheetApply({ writes: [sw(S, 33, 'E', 'In Progress'), sw(S, 9, 'F', 'In Progress')] }, S);
  var r = res.r;
  ok('refused', r && r.ok === false && r.written === 0, r);
  ok('the error names the cell and the rule', /F9/.test(r.error || '') && /overall visuals|dark mode/i.test(r.error || ''), r.error);
  eq('NO request was made (the row text of the write itself already says it is not a visual row)', S.reqs.length, 0);
  eq('the E write of the same apply was not written either', S.cell('E33') === PLAN.values[32][4] ? 'unchanged' : 'CHANGED', 'unchanged');
  var res2 = sheetApply({ writes: [sw(S, 9, 'G', 'Passed')] }, ecSheets(PLAN));
  ok('and a G write on a content row', res2.r.ok === false && /G9/.test(res2.r.error), res2.r);
  var res3 = sheetApply({ writes: [sw(S, 41, 'F', 'Passed')] }, ecSheets(PLAN));
  ok('and an F write on the DKIM row', res3.r.ok === false && /F41/.test(res3.r.error), res3.r);
});

T('ecSheetApply: F and G on the visual and dark-mode rows pass, with E and the note; verified by the re-read', function () {
  var S = ecSheets(PLAN);
  var writes = [sw(S, 33, 'E', 'In Progress'), sw(S, 33, 'F', 'In Progress'), sw(S, 33, 'G', 'In Progress'), sw(S, 36, 'F', 'In Progress'), sw(S, 9, 'E', 'Passed'), sw(S, 9, 'H', 'V0 / Regular Donors | Desktop | checked')];
  var res = sheetApply({ writes: writes }, S);
  var r = res.r;
  ok('applied: 6 written and verified (B2: ecIsVisualRowText)', r && r.ok === true && r.written === 6 && r.verified === 6 && r.dropped.length === 0 && r.mismatches.length === 0 && r.foreign.length === 0, r);
  eq('one write request', S.posts().length, 1);
  jeq('with RAW values on the tab that was read', [S.posts()[0] && S.posts()[0].body.valueInputOption, S.posts()[0] && S.posts()[0].body.data.every(function (d) { return d.range.indexOf("'QA Round 1'!") === 0; })], ['RAW', true]);
  eq('F33 now holds the new status', S.cell('F33'), 'In Progress');
  eq('G33 too', S.cell('G33'), 'In Progress');
  eq('F36 (the dark mode row)', S.cell('F36'), 'In Progress');
  eq('E9 (a content row takes E)', S.cell('E9'), 'Passed');
  ok('the note landed in the Notes column', /checked/.test(S.cell('H9')));
  eq('the ticket link cell A1 is untouched', S.cell('A1'), PLAN.values[0][0]);
  eq('the description of the F/G rows was re-read once before the write (1 extra read), then qpwSheetApply read before and after: 3 reads', S.gets(), 3);
});

T('ecSheetApply: a payload that LIES about the row text is caught by the re-read of the sheet; a changed sheet too', function () {
  var S = ecSheets(PLAN);
  var lie = Object.assign(sw(S, 9, 'F', 'In Progress'), { rowText: 'Verify the overall visuals of the email' });
  var res = sheetApply({ writes: [lie] }, S);
  ok('refused although the write says it is a visual row', res.r.ok === false && res.r.written === 0 && /F9/.test(res.r.error || ''), res.r);
  eq('the sheet was read (once), nothing was written', S.gets() + '|' + S.posts().length, '1|0');
  var S2 = ecSheets(PLAN), w2 = sw(S2, 33, 'F', 'In Progress');
  S2.grid[32][2] = 'A content question now, edited by a person';
  var res2 = sheetApply({ writes: [w2] }, S2);
  ok('a row whose text was changed to a content row since the proposal is refused for F', res2.r.ok === false && res2.r.written === 0 && S2.posts().length === 0, res2.r);
  var S3 = ecSheets(PLAN), w3 = sw(S3, 33, 'E', 'In Progress');
  S3.grid[32][2] = 'A content question now, edited by a person';
  var res3 = sheetApply({ writes: [w3] }, S3);
  ok('and for E the row loses its writes (qpwSheetApply: row text changed), nothing is written', res3.r.ok === true && res3.r.written === 0 && res3.r.dropped.length === 1 && S3.posts().length === 0, res3.r);
});

T('ecSheetApply: fails closed (no ecIsVisualRowText, no descCol, textCols without it, unreadable sheet)', function () {
  var saved = globalThis.ecIsVisualRowText;
  globalThis.ecIsVisualRowText = undefined;
  var S = ecSheets(PLAN);
  var res = sheetApply({ writes: [sw(S, 33, 'F', 'In Progress')] }, S);
  ok('without ecIsVisualRowText every F/G write is refused', res.r.ok === false && res.r.written === 0 && S.reqs.length === 0, res.r);
  var res2 = sheetApply({ writes: [sw(S, 33, 'E', 'In Progress')] }, ecSheets(PLAN));
  ok('and an E write still goes through', res2.r.ok === true && res2.r.written === 1, res2.r);
  if (saved === undefined) delete globalThis.ecIsVisualRowText; else globalThis.ecIsVisualRowText = saved;
  var S3 = ecSheets(PLAN);
  var a = sheetApply({ descCol: undefined, writes: [sw(S3, 33, 'F', 'Passed')] }, S3);
  ok('F/G with no descCol: refused, no request', a.r.ok === false && /Description column/.test(a.r.error || '') && S3.reqs.length === 0, a.r);
  var S4 = ecSheets(PLAN);
  var b = sheetApply({ textCols: [3], writes: [sw(S4, 33, 'F', 'Passed')] }, S4);
  ok('F/G with textCols that do not hold descCol: refused, no request', b.r.ok === false && S4.reqs.length === 0, b.r);
  var S5 = ecSheets(PLAN);
  var c = sheetApply({ spreadsheetId: '../../x', writes: [sw(S5, 33, 'F', 'Passed')] }, S5);
  ok('F/G with a spreadsheet id that is not an id: refused, no request', c.r.ok === false && S5.reqs.length === 0, c.r);
  var S6 = ecSheets(PLAN); S6.token = 'other';
  var d = sheetApply({ writes: [sw(S6, 33, 'F', 'Passed')] }, S6, { token: false });
  ok('F/G with no Google connection: refused (nothing written), says why', d.r.ok === false && d.r.written === 0 && S6.posts().length === 0, d.r);
});

T('ecSheetApply: E-only applies need no extra read; row 1 and columns outside E, Notes, F, G are never written', function () {
  var S = ecSheets(PLAN);
  var res = sheetApply({ writes: [sw(S, 9, 'E', 'Passed'), sw(S, 41, 'E', 'Passed')] }, S);
  ok('E on content rows: written', res.r.ok === true && res.r.written === 2, res.r);
  eq('only qpwSheetApply\'s own two reads (before and after): no extra read for the Description', S.gets(), 2);
  [['H1', 'H'], ['A1', 'A']].forEach(function (c) {
    var S2 = ecSheets(PLAN);
    var wr = { row: 1, col: qpColIndex(c[1]), a1: c[0], old: S2.cell(c[0]), next: 'x', rowText: '' };
    var r = sheetApply({ writes: [wr] }, S2).r;
    ok('a write to ' + c[0] + ' is refused, nothing written, no request', r.ok === false && r.written === 0 && S2.reqs.length === 0, r);
  });
  // N9 (A3): row 1 is refused on its own, in every column the apply may write, and one such write takes the rest of the batch down with it
  ['E1', 'F1', 'G1'].forEach(function (a1) {
    var S1 = ecSheets(PLAN);
    var w1 = { row: 1, col: qpColIndex(a1.charAt(0)), a1: a1, old: S1.cell(a1), next: 'Passed', rowText: 'Overall visuals' };
    var r1 = sheetApply({ writes: [w1] }, S1).r;
    ok('a write to ' + a1 + ' (the first row, an allowed column) is refused, naming the row, with no request and nothing written', r1.ok === false && r1.written === 0 && /first row/.test(r1.error || '') && S1.reqs.length === 0, r1);
  });
  var SB = ecSheets(PLAN);
  var rB = sheetApply({ writes: [sw(SB, 9, 'E', 'Passed'), { row: 1, col: qpColIndex('E'), a1: 'E1', old: SB.cell('E1'), next: 'Passed', rowText: '' }, sw(SB, 41, 'E', 'Passed')] }, SB).r;
  ok('E1 in a batch with two good writes refuses the whole batch: nothing written, no request', rB.ok === false && rB.written === 0 && SB.reqs.length === 0 && SB.posts().length === 0, rB);
  var SR = ecSheets(PLAN);
  var rR = sheetApply({ writes: [sw(SR, 9, 'E', 'Passed'), sw(SR, 41, 'E', 'Passed')] }, SR).r;
  ok('and the same two good writes alone are written (the refusal above was the row, not the batch)', rR.ok === true && rR.written === 2, rR);
  var S3 = ecSheets(PLAN);
  var rD = sheetApply({ writes: [sw(S3, 9, 'D', '9')] }, S3).r;
  ok('a write to the Total Minutes column (D) is refused by the allowed-columns rule of QA Pass', rD.ok === false && /D9/.test(rD.error || '') && S3.reqs.length === 0, rD);
  var S4 = ecSheets(PLAN);
  var rC = sheetApply({ writes: [sw(S4, 9, 'C', 'rewritten test text')] }, S4).r;
  ok('a write to the Description column (C) is refused', rC.ok === false && S4.reqs.length === 0, rC);
  var S5 = ecSheets(PLAN);
  var rN = sheetApply({ notesCol: null, writes: [sw(S5, 9, 'H', 'a note')] }, S5).r;
  ok('with no Notes column known, a write to H is refused', rN.ok === false && S5.reqs.length === 0, rN);
  var S6 = ecSheets(PLAN);
  var rX = sheetApply({ fgCols: ['E', 'F'], eCol: 'E', writes: [sw(S6, 9, 'E', 'Passed')] }, S6).r;
  ok('a column named both as E and as F/G counts as E: no Description re-read for it', rX.ok === true && S6.gets() === 2, rX);
});

// ── The scrub of everything a run can return ───────────────────────────────────────────────────────────────────────
T('scrub: every record the scenarios above returned is free of identifiers, secrets and raw URLs', function () {
  ok('the clean record was captured', !!(CLEAN && CLEAN.out && CLEAN.out.rec && CLEAN.out.rec.version === 1));
  var rec = (CLEAN && CLEAN.out.rec) || {};
  eq('none of the forbidden strings is in the clean record', leaks(rec).join('|'), '');
  ok('data:image only inside renders[].img', JSON.stringify(Object.assign({}, rec, { renders: [] })).indexOf('data:image') < 0);
  ok('no http(s) URL with a query string anywhere in the record', !/https?:\/\/[^"\s]*\?/.test(JSON.stringify(Object.assign({}, rec, { renders: [] }))));
  ok('no raw html, text part or header block (no <html, no Content-Type:, no MIME-Version:)', JSON.stringify(rec).indexOf('<html') < 0 && JSON.stringify(rec).indexOf('Content-Type:') < 0 && JSON.stringify(rec).indexOf('MIME-Version') < 0);
  ok('the record survives a JSON round trip (it is what the panel stores)', JSON.stringify(JSON.parse(JSON.stringify(rec))) === JSON.stringify(rec));
});

// ── report ─────────────────────────────────────────────────────────────
print('');
if (failures.length) {
  print('FAILURES:');
  failures.forEach(function (f) { print('  - ' + f); });
}
print('=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
