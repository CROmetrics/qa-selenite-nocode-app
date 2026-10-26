// email-check-fixture-record.js: builds an Email Check record from fixture OBJECTS the way the worker will, with no network.
// Shared by tests/email-check.test.js, tests/qa-report.test.js (the report section) and the git-excluded real-data suite; loaded with load() AFTER
// metric-match.js, qa-pass.js and email-check.js, and after `adfText` / `adfTextWithHrefs` exist as globals (the suites slice them out of popup.js).
//
//   ecTestRecord(fixtures, ticketKey, opts) -> a record: the 19 top-level keys, version 1, checks and notTested derived.
//
// fixtures = { proofs, interstitials, eoa, jira, docs }, each the parsed content of the fixture file of that name (fixtures-email-*.json for the synthetic data,
//   real-email-*.json for the local real data): proofs = the `tickets` map, interstitials / eoa / jira = the per-ticket maps, docs = { '<TICKET>': <Google Docs JSON> }.
// opts (all optional):
//   doc        false: the context has no Copy File; an object: that Docs JSON; undefined: fixtures.docs[ticketKey]. A doc with no Copy File field on the ticket is given a synthetic Copy File URL.
//   eoa        false: the context lists no Email on Acid link.
//   mailtrap   'ok' (default) | 'signed-out' | 'no-account' | 'challenge' | 'error': the source state; anything but 'ok' leaves every proof 'not-read'.
//   notFound   [messageId, ...]: those proofs get state 'not-found' (as a 404 would give).
//   rules      { utmRule: 'identical'|'suffix'|'', segmentPaths: { '<Segment>': path }, onlyIn: { v0: [...], v1: [...] } | null }: replaces what ecSuggestRules found, key by key
//              (segmentPaths per segment); an override is recorded with source 'tester'. rules: 'none' clears every rule.
//   profile    a profile id (default: by ticket prefix).
//   docEmail   the copy-doc email number.
//   mutateProofs  function (proofs) called with a deep copy of the ticket's fixture proofs before they are parsed (each: segment, variation, messageId, message, htmlsource, text, raw, mailHeaders, spamReport).
//   mutateLinks   function (links) called with rec.links before the checks are derived.
//   mutateRecord  function (rec) called after the sources, proofs and links are built and before the checks are derived.
//   renders    true: 16 synthetic renders per Email on Acid variation in rec.renders.
//   now        the clock (default 1800000000000).
// Links: every link of every proof comes from ecLinkPlan of its HTML. A guarded link is listed, not resolved. A tracked link whose interstitial is in fixtures.interstitials[ticket]
// (key '<segment code>-<variation>-<linkId>') is resolved through ecParseInterstitial; every other tracked link gets the generated destination https://www.<orgDomain>/<slug>/ (status 200,
// title '<org> | <path>'), carrying the UTM set of that proof's resolved links when its role is cta or donate and none when it is social or footer. A direct link keeps its own URL.

function ecTestRecord(fx, ticketKey, opts) {
  opts = opts || {};
  var now = opts.now || 1800000000000;
  var jira = fx.jira[ticketKey];
  var fields = jira.fields;
  var profile = ecProfileFor(ticketKey, opts.profile || '');
  var copyKey = Object.keys(jira.names || {}).filter(function (k) { return jira.names[k] === 'Copy File'; })[0];
  var ticketLinks = ecParseEmailLinks(adfTextWithHrefs(fields.description));
  var docJson = opts.doc === undefined ? (fx.docs || {})[ticketKey] : opts.doc;
  var copyFileUrl = opts.doc === false ? null : (copyKey && fields[copyKey]) || (docJson ? 'https://docs.google.com/document/d/EXDOC_' + String(ticketKey).replace(/[^A-Za-z0-9]/g, '') + '_COPY_DOC_0000000000/edit' : null);
  var wctx = ecCtxForWorker({
    ticketKey: ticketKey, summary: fields.summary, copyFileUrl: copyFileUrl,
    emailProofs: ticketLinks.proofs.map(function (p) { return { segment: p.segment, variation: p.variation, url: p.url }; }),
    emailEoa: opts.eoa === false ? [] : ticketLinks.eoa.map(function (e) { return { variation: e.variation, url: e.url }; }),
  });
  var comments = ((fields.comment && fields.comment.comments) || []).map(function (c) { return { id: c.id, created: c.created, text: adfText(c.body) }; });
  var segNames = [];
  wctx.proofs.forEach(function (p) { if (p.segment && segNames.indexOf(p.segment) < 0) segNames.push(p.segment); });
  var sug = opts.rules === 'none' ? { utmRule: null, segmentPaths: {}, onlyIn: null } : ecSuggestRules(comments, segNames, profile);
  var settings = {
    profileId: opts.profile || '', docEmail: opts.docEmail || null, eoaRenders: true,
    utmRule: sug.utmRule ? { value: sug.utmRule.value, source: 'suggested', commentId: sug.utmRule.commentId } : { value: '', source: 'none', commentId: null },
    segmentPaths: {}, onlyIn: sug.onlyIn,
  };
  Object.keys(sug.segmentPaths).forEach(function (k) { settings.segmentPaths[k] = { value: sug.segmentPaths[k].value, source: 'suggested', commentId: sug.segmentPaths[k].commentId }; });
  var ov = opts.rules && opts.rules !== 'none' ? opts.rules : null;
  if (ov) {
    if (ov.utmRule !== undefined) settings.utmRule = { value: ov.utmRule, source: ov.utmRule ? 'tester' : 'none', commentId: null };
    Object.keys(ov.segmentPaths || {}).forEach(function (k) { settings.segmentPaths[k] = { value: ov.segmentPaths[k], source: 'tester', commentId: null }; });
    if (ov.onlyIn !== undefined) settings.onlyIn = ov.onlyIn ? { expect: ov.onlyIn, commentId: null } : null;
  }
  var rec = ecNewRecord(wctx, settings, now);

  // the copy doc
  if (wctx.copyFileUrl && docJson) {
    var parsed = ecParseDoc(docJson, { emailNumber: rec.settings.docEmail, summary: wctx.summary });
    if (parsed.error) rec.sources.doc = { state: 'error', title: null, emails: [], chosen: null, error: parsed.error };
    else { rec.sources.doc = { state: 'ok', title: parsed.title, emails: parsed.emails, chosen: parsed.chosen, error: null }; rec.doc = parsed; }
  }

  // Mailtrap and the proofs
  var mt = opts.mailtrap || 'ok';
  rec.sources.mailtrap = { state: mt, error: mt === 'error' ? 'test error' : null };
  var htmls = {};
  if (mt === 'ok') {
    var pf = JSON.parse(JSON.stringify(fx.proofs[ticketKey].proofs));
    if (opts.mutateProofs) opts.mutateProofs(pf);
    rec.proofs.forEach(function (p) {
      var fp = pf.filter(function (x) { return x.messageId === p.messageId; })[0];
      if ((opts.notFound || []).indexOf(p.messageId) >= 0 || !fp) { p.state = 'not-found'; return; }
      var parts = { msg: fp.message, html: fp.htmlsource, txt: fp.text, raw: fp.raw, headers: fp.mailHeaders, spam: fp.spamReport };
      p.facts = ecParseProof(parts, p, profile);
      p.state = 'ok';
      htmls[p.id] = ecPartEncodings(fp.raw).html === 'quoted-printable' && /=3D|=\r?\n/i.test(fp.htmlsource) ? ecDecodeQP(fp.htmlsource) : fp.htmlsource;
    });
    // links
    var inter = (fx.interstitials || {})[ticketKey] || {};
    var interKeys = Object.keys(inter);
    var host = 'https://www.' + (profile.orgDomain || 'example.org');
    rec.proofs.forEach(function (p) {
      if (p.state !== 'ok') return;
      var plan = ecLinkPlan(ecVisibleText(htmls[p.id]).anchors, profile);
      var resolved = {}, proofUtm = null;
      plan.forEach(function (l) {
        if (l.guard || l.kind !== 'pardot') return;
        var key = interKeys.filter(function (k) { return k.slice(-(l.linkId.length + 1)) === '-' + l.linkId; })[0];
        if (!key) return;
        var r = ecParseInterstitial(inter[key], profile.pardotHosts);
        if (!r) return;
        resolved[l.linkId] = { method: r.method, dest: ecDestination(r.url) };
        if (!proofUtm && Object.keys(resolved[l.linkId].dest.utm).length) proofUtm = resolved[l.linkId].dest.utm;
      });
      plan.forEach(function (l) {
        var e = { proofId: p.id, linkId: l.linkId, slug: l.slug, labels: l.labels.slice(0, 4), role: l.role, kind: l.kind, guard: l.guard, method: null, pardotStatus: null, dest: null, destStatus: null, destTitle: null, error: null };
        if (!l.guard && l.kind === 'pardot') {
          var rs = resolved[l.linkId];
          if (rs) { e.method = rs.method; e.dest = rs.dest; }
          else {
            e.method = 'interstitial-a';
            e.dest = { origin: host, path: '/' + (l.slug || 'page') + '/', utm: l.role === 'cta' || l.role === 'donate' ? JSON.parse(JSON.stringify(proofUtm || {})) : {}, otherKeys: [] };
          }
          e.pardotStatus = 200; e.destStatus = 200; e.destTitle = (profile.orgName || 'Example') + ' | ' + e.dest.path;
        } else if (!l.guard) {
          e.method = 'direct'; e.dest = ecDestination(l.href); e.destStatus = 200; e.destTitle = (profile.orgName || 'Example') + ' | ' + (e.dest ? e.dest.path : '/');
        }
        rec.links.push(e);
      });
    });
  }
  if (opts.mutateLinks) opts.mutateLinks(rec.links);

  // Email on Acid
  var ev = (fx.eoa || {})[ticketKey] || {};
  rec.sources.eoa.forEach(function (e) {
    var page = ev[e.variation];
    var inv = page ? ecParseEoaPage(page) : { error: 'no page in the fixtures' };
    if (inv.error) { e.state = 'error'; e.error = inv.error; return; }
    e.state = 'ok'; e.subject = inv.subject; e.clients = inv.clients;
    if (opts.renders) {
      e.renders = { state: 'ok', count: Math.min(16, inv.clients.length), error: null };
      inv.clients.slice(0, 16).forEach(function (cl) { rec.renders.push({ variation: e.variation, code: cl.code, name: cl.name, dark: cl.dark, img: 'data:image/jpeg;base64,/9j/AAAA' }); });
    } else e.renders = { state: 'none', count: 0, error: null };
  });
  if (opts.mutateRecord) opts.mutateRecord(rec);

  rec.finishedAt = now + 1000;
  rec.ts = now + 1000;
  rec.checks = ecDeriveChecks(rec);
  rec.notTested = ecFixedNotTested(rec);
  return rec;
}
