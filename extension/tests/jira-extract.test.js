// Jira ticket extraction — custom-field resolution and the Test Specifications
// variant parse.
//
//   RUN:  cd extension/tests && jsc jira-extract.test.js
//
// Same standing as the other suites: not wired into the repo's pytest CI.
//
// This file exists because of a specific, expensive failure. Five Visual Diff
// runs across two unrelated tickets (WOW-1160, ENOC-97) all reported
// variantCount:0, which left Summary of Changes empty and made EVERY finding
// "unclear" by construction — the report graded nothing at all. Three rounds of
// debugging went into it, and the diagnosis kept landing on "the Test
// Specifications parser is broken."
//
// It was not. Both tickets return `description: null`. Their content lives in
// NAMED CUSTOM FIELDS — customfield_10041 is literally titled "Test
// Specifications" and holds 9,735 characters of ADF. The parser was reading a
// field these tickets do not populate. Preview links kept working the whole
// time only because those come from the AI pass, which reads the RENDERED page
// where custom fields are visible; that asymmetry was the symptom.
//
// The fixtures below are the REAL field shapes, taken from WOW-1160 over the
// Jira API. Notably that site has TWO fields named "Goals" — one populated,
// one empty — which is why resolution has to prefer content over iteration
// order.

var _pu = readFile('../popup.js');
eval(_pu.slice(_pu.indexOf('function resolveJiraAdfField(names, fields, label)'),
                _pu.indexOf('function extractConvertMetricId')));
eval(_pu.slice(_pu.indexOf('function adfText(node)'),
                _pu.indexOf('function parseRelatedTestBullets(lines)')));

// Email Check: extractTestContext now reads the copy doc link and the Mailtrap / Email on Acid links. It needs email-check.js (loaded after
// qa-pass.js, as in both panels), figma.js (the design-link helpers it calls) and the helpers sliced here.
load('../qa-pass.js');
load('../email-check.js');
load('../figma.js');
var _initDraft = null, _initWarnings = [];
eval(_pu.slice(_pu.indexOf('function parseRelatedTestBullets(lines)'), _pu.indexOf('\n// Flattens the whole ADF description')));
eval(_pu.slice(_pu.indexOf('function extractTestContext('), _pu.indexOf('\n// ── ADF (Atlassian Document Format) utilities')));

// ── harness ────────────────────────────────────────────────────────────────
var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 400) : ''));
}
function eq(name, actual, expected) { ok(name, actual === expected, { actual: actual, expected: expected }); }
function section(t) { print('\n' + t); }

function para(text) { return { type: 'paragraph', content: [{ type: 'text', text: text }] }; }
function doc(paras) { return { type: 'doc', version: 1, content: paras }; }

// ── field resolution ───────────────────────────────────────────────────────
section('custom field resolution');

// The real name map from this Jira site, trimmed to what matters.
var NAMES = {
  description: 'Description',
  customfield_10041: 'Test Specifications',
  customfield_10040: 'Goals',
  customfield_10821: 'Goals',            // a SECOND field with the same name
  customfield_10044: 'Preview Links',
  customfield_10112: 'Platform Experiment Id',
  customfield_10686: 'QA Test Plan',
};

var SPEC = doc([para('EXPERIMENT REQUIREMENTS'), para('v0: Control (WOW-1160)'), para('No Change')]);

eq('resolves an ADF field by display name',
  resolveJiraAdfField(NAMES, { customfield_10041: SPEC }, 'Test Specifications'), SPEC);

eq('name match is case-insensitive',
  resolveJiraAdfField(NAMES, { customfield_10041: SPEC }, 'test specifications'), SPEC);

// The duplicate-"Goals" case. Object iteration order would hand back whichever
// key came first, and an empty pick is indistinguishable from a ticket that
// genuinely has nothing to say — the exact failure mode this whole file is
// about.
var populated = doc([para('1. [PJS] Successful application')]);
eq('prefers the POPULATED field when two share a name',
  resolveJiraAdfField(NAMES, { customfield_10821: doc([]), customfield_10040: populated }, 'Goals'), populated);
eq('...regardless of key order',
  resolveJiraAdfField(NAMES, { customfield_10040: populated, customfield_10821: doc([]) }, 'Goals'), populated);
ok('falls back to an empty doc when that is all there is',
  resolveJiraAdfField(NAMES, { customfield_10821: doc([]) }, 'Goals') !== null);

// Non-ADF values must never be returned as documents — QA Test Plan is a URL
// string on this site, and handing a string to the section parser would throw.
ok('a string field is not returned as ADF',
  resolveJiraAdfField(NAMES, { customfield_10686: 'https://docs.google.com/x' }, 'QA Test Plan') === null);
ok('a null field yields null', resolveJiraAdfField(NAMES, { customfield_10041: null }, 'Test Specifications') === null);
ok('an unknown label yields null', resolveJiraAdfField(NAMES, {}, 'Nonexistent Field') === null);
ok('null names yields null', resolveJiraAdfField(null, {}, 'Test Specifications') === null);
ok('null fields yields null', resolveJiraAdfField(NAMES, null, 'Test Specifications') === null);

// ── the real Test Specifications content ───────────────────────────────────
section('variant parse over the real field');

// Verbatim shape from WOW-1160's customfield_10041.
var REAL = doc([
  para('EXPERIMENT REQUIREMENTS'),
  para('v0: Control (WOW-1160)'),
  para('No Change'),
  para('v1: Detailed Offer Cards'),
  para('Same as WOW-1134, but on a different page - Locked LP'),
  para('In the offer card row below the "Check WOW! Internet Availability" section, replace the 3 existing cards with 4 cards.'),
  para('Bullet 1: 99.9% Network Reliability*'),
]);

// When the section is its own FIELD, the whole field is the section — there is
// no heading to locate inside it, which is why the caller passes
// field.content directly rather than through adfSectionNodes.
var variants = splitVariantBlocks(adfSectionLines(REAL.content));

eq('both variants parse from the field', variants.length, 2);
eq('control id', variants[0].id, 'v0');
eq('variant id', variants[1].id, 'v1');
// v0 is control BY CONVENTION, never inferred from content — the extractor
// asserts b.id === 'v0' rather than reading the word "Control".
ok('v0 carries its description', /No Change/.test(variants[0].texts.join('\n')));
ok('v1 carries the real spec text', /replace the 3 existing cards with 4 cards/.test(variants[1].texts.join('\n')));

// The finding this whole exercise was supposed to surface: the spec says
// 99.9%, the built page shipped 99%. That is a real defect, and it is only
// visible once the spec is actually read.
ok('spec text reaches the summary verbatim, including "99.9%"',
  /99\.9% Network Reliability/.test(variants[1].texts.join('\n')), variants[1].texts);

// ── the description path still works ───────────────────────────────────────
section('description fallback');

// Tickets that DO use a description must keep working — the custom field is
// preferred, not required.
var DESC = doc([
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Test Specifications' }] },
  para('v0: Control'),
  para('Baseline'),
  para('v1: New Hero'),
  para('Bigger headline'),
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Goals' }] },
  para('not a variant'),
]);
var descVariants = splitVariantBlocks(adfSectionLines(adfSectionNodes(DESC, 'Test Specifications')));
eq('heading-based section still parses two variants', descVariants.length, 2);
eq('...and stops at the next heading', descVariants[1].texts.join(' ').indexOf('not a variant'), -1);

ok('a missing heading is distinguishable from an empty one',
  adfSectionNodes(DESC, 'Nonexistent') === null);

// ── Jira comments kept on the context ──────────────────────────────────────
section('Jira comments for the QA Pass analysis');

// A comment as Jira returns it: an author object, an ADF body, a mention node
// (which carries its text in attrs, not in content).
var REAL_COMMENTS = {
  comments: [{
    id: '10001',
    author: { displayName: 'Jane Doe', emailAddress: 'j@x' },
    created: '2026-10-14T10:00:00.000-0400',
    body: { type: 'doc', content: [
      para('Timer set to 10/09 on purpose'),
      { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'abc', text: '@Jane Doe' } }, { type: 'text', text: ' please check' }] },
    ] },
  }],
  total: 1,
};
var cm = jiraContextComments(REAL_COMMENTS);
eq('one comment comes out', cm.length, 1);
eq('its id is kept, as a string', cm[0].id, '10001');
eq('its created timestamp is kept', cm[0].created, '2026-10-14T10:00:00.000-0400');
ok('its text carries the first paragraph', cm[0].text.indexOf('Timer set to 10/09 on purpose') !== -1, cm[0].text);
ok('and the text after the mention', cm[0].text.indexOf('please check') !== -1, cm[0].text);
var cmJson = JSON.stringify(cm);
ok('the author\'s name is nowhere in the result', cmJson.indexOf('Jane') === -1, cmJson);
ok('there is no author key', cmJson.indexOf('author') === -1);
ok('the mention\'s @ is dropped with it', cmJson.indexOf('@') === -1);
ok('the email address is not kept', cmJson.indexOf('j@x') === -1);
eq('only id, created and text are kept', Object.keys(cm[0]).join(','), 'id,created,text');
eq('a numeric id becomes a string', jiraContextComments({ comments: [{ id: 7, created: 'c', body: doc([para('x')]) }] })[0].id, '7');

eq('null is no comments', jiraContextComments(null).length, 0);
eq('undefined is no comments', jiraContextComments(undefined).length, 0);
eq('an empty field is no comments', jiraContextComments({}).length, 0);
eq('a comments value that is not a list is no comments', jiraContextComments({ comments: 'x' }).length, 0);
eq('a comment with no id is dropped', jiraContextComments({ comments: [{ body: doc([para('x')]) }] }).length, 0);
eq('a comment with no text is dropped', jiraContextComments({ comments: [{ id: '1', body: doc([]) }, { id: '2' }] }).length, 0);
eq('a comment that is only a mention is dropped', jiraContextComments({ comments: [{ id: '3', body: doc([{ type: 'paragraph', content: [{ type: 'mention', attrs: { text: '@A' } }] }]) }] }).length, 0);
eq('a null entry in the list does not throw', jiraContextComments({ comments: [null, { id: '4', body: doc([para('kept')]) }] }).length, 1);
eq('a missing created becomes null', jiraContextComments({ comments: [{ id: '5', body: doc([para('x')]) }] })[0].created, null);

var many = [];
for (var i = 1; i <= 60; i++) many.push({ id: String(10000 + i), created: 'c' + i, body: doc([para('comment ' + i)]) });
var capped = jiraContextComments({ comments: many });
eq('sixty comments are cut to fifty', capped.length, 50);
eq('the newest is kept', capped[capped.length - 1].id, '10060');
eq('the oldest ten are the ones dropped', capped[0].id, '10011');
eq('the order stays oldest first', capped[1].id, '10012');
eq('a 5000-character body is cut to 2000', jiraContextComments({ comments: [{ id: '6', body: doc([para(new Array(5001).join('a'))]) }] })[0].text.length, 2000);
eq('trailing spaces before a line break are removed and blank runs collapse',
   jiraContextComments({ comments: [{ id: '8', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a  ' }, { type: 'hardBreak' }, { type: 'hardBreak' }, { type: 'hardBreak' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] } }] })[0].text,
   'a\n\nb');
ok('extractTestContext puts them on the draft', /comments: jiraContextComments\(f\.comment\),/.test(_pu));
ok('and jiraContextComments is defined between adfText and the section locator',
   _pu.indexOf('function adfText(node)') < _pu.indexOf('function jiraContextComments(commentField)') &&
   _pu.indexOf('function jiraContextComments(commentField)') < _pu.indexOf('// Section locator (shared by all three sections)'));

// ── Email Check: Initialize ─────────────────────────────────────
// SYNTHETIC DATA ONLY: the tickets are EX-1 and EX-2 of fixtures-email-jira.json (org Example Relief, hosts under example.org). A throwing section here is
// one failure (T) and the next still runs.
function T(title, fn) {
  section(title);
  var p0 = pass, f0 = fail;
  try { fn(); } catch (e) { fail++; failures.push(title + '  THREW ' + String(e && e.message ? e.message : e).slice(0, 200)); }
  print('  [' + (pass - p0) + ' passed, ' + (fail - f0) + ' failed]');
}
function jeq(name, actual, expected) { var a = JSON.stringify(actual), e = JSON.stringify(expected); ok(name, a === e, { actual: a, expected: e }); }
var EXJ = JSON.parse(readFile('fixtures-email-jira.json'));
function exIssue(tk, over) { var j = EXJ[tk]; return Object.assign({ key: tk, names: j.names, fields: j.fields }, over || {}); }
function extract(issue) { _initDraft = null; _initWarnings = []; extractTestContext(issue, 'https://jira.example.org', null, []); return { draft: _initDraft, warnings: _initWarnings }; }
var NO_COPY = 'No Copy File on this ticket: Email Check\'s copy rows will stay In Progress.';
var MT = function (n) { return 'https://mailtrap.io/sandboxes/7000001/messages/' + n; };

T('Initialize: Email Check fields from EX-1 (inlineCard links, a Copy File field)', function () {
  var r = extract(exIssue('EX-1')), d = r.draft;
  eq('the copy doc link is the Copy File field', d.copyFileUrl, 'https://docs.google.com/document/d/EXDOC_EX1_COPY_DOC_000000000001/edit?usp=sharing');
  eq('four Mailtrap proofs', d.emailProofs.length, 4);
  jeq('  segment, version and url, in the ticket\'s order', d.emailProofs, [
    { segment: 'Regular Donors', variation: 'v0', url: MT('7100000001') }, { segment: 'Regular Donors', variation: 'v1', url: MT('7100000002') },
    { segment: 'Major Donors', variation: 'v0', url: MT('7100000003') }, { segment: 'Major Donors', variation: 'v1', url: MT('7100000004') }]);
  jeq('  exactly three keys each (no ids, no sandbox)', d.emailProofs.map(function (p) { return Object.keys(p).join(); }), ['segment,variation,url', 'segment,variation,url', 'segment,variation,url', 'segment,variation,url']);
  jeq('two Email on Acid tests, version and url', d.emailEoa.map(function (e) { return [e.variation, /^https:\/\/app\.emailonacid\.com\/app\/acidtest\/EXEOA1V[01]0+\/list$/.test(e.url), Object.keys(e).join()]; }), [['v0', true, 'variation,url'], ['v1', true, 'variation,url']]);
  ok('no Copy File warning, and no label warning', r.warnings.indexOf(NO_COPY) < 0 && !r.warnings.some(function (w) { return /Mailtrap link|Email on Acid link/.test(w); }), r.warnings);
  eq('the existing fields are still extracted (key, summary, comments)', d.ticketKey + '|' + d.summary + '|' + d.comments.length, 'EX-1|Cold Route - Message 1|5');
  ok('the QA test plan link is still read', /^https:\/\/docs\.google\.com\/spreadsheets\/d\/EXPLAN_EX1_TEST_PLAN_00000000001\//.test(d.qaTestPlanUrl), d.qaTestPlanUrl);
});

T('Initialize: Email Check fields from EX-2 (link marks, no Copy File field)', function () {
  var r = extract(exIssue('EX-2')), d = r.draft;
  eq('no Copy File field: the link is null', d.copyFileUrl, null);
  ok('the warning says the copy rows stay In Progress', r.warnings.indexOf(NO_COPY) >= 0, r.warnings);
  eq('the warning is there once', r.warnings.filter(function (w) { return w === NO_COPY; }).length, 1);
  jeq('four proofs from link marks, one paragraph per line', d.emailProofs, [
    { segment: 'Regular Donors', variation: 'v0', url: MT('7100000005') }, { segment: 'Regular Donors', variation: 'v1', url: MT('7100000006') },
    { segment: 'Major Donors', variation: 'v0', url: MT('7100000007') }, { segment: 'Major Donors', variation: 'v1', url: MT('7100000008') }]);
  jeq('two Email on Acid tests', d.emailEoa.map(function (e) { return e.variation; }), ['v0', 'v1']);
  ok('the misleading slug in the link text never decides a version (labels do)', d.emailProofs.map(function (p) { return p.variation; }).join() === 'v0,v1,v0,v1');
});

T('Initialize: Email Check fields on tickets that are not email tickets, and odd inputs', function () {
  // A/B ticket: Test Specifications in the description, nothing about email.
  var ab = { type: 'doc', version: 1, content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Test Specifications' }] }, para('v0: Control'), para('Baseline'), para('v1: New Hero'), para('Bigger headline')] };
  var r = extract({ key: 'EX-9', names: { description: 'Description' }, fields: { summary: 'Hero test', description: ab } }), d = r.draft;
  jeq('an A/B ticket gets empty lists and no copy file', [d.emailProofs, d.emailEoa, d.copyFileUrl], [[], [], null]);
  ok('  and no Email Check warning', !r.warnings.some(function (w) { return /Copy File|Mailtrap|Email on Acid/.test(w); }), r.warnings);
  eq('  the variants are still parsed from it', d.variants.length, 2);
  r = extract({ key: 'EX-9', names: {}, fields: { summary: 'No description' } });
  jeq('a ticket with no description at all', [r.draft.emailProofs, r.draft.emailEoa, r.draft.copyFileUrl], [[], [], null]);
  ok('  and no Email Check warning', !r.warnings.some(function (w) { return /Copy File|Mailtrap|Email on Acid/.test(w); }));
  r = extract({ key: 'EX-9', names: {}, fields: { summary: 's', description: 'plain string description' } });
  jeq('a description that is a plain string is not read for links', [r.draft.emailProofs, r.draft.copyFileUrl], [[], null]);
  // a Mailtrap link with no v0 / v1 label: skipped, with the parser's warning, and no Copy File warning (no proof was parsed)
  var nolabel = { type: 'doc', version: 1, content: [para('Mailtrap'), para('Regular Donors'), para('see ' + MT('7100000009'))] };
  r = extract({ key: 'EX-9', names: {}, fields: { summary: 's', description: nolabel } });
  eq('a link with no label is skipped', r.draft.emailProofs.length, 0);
  ok('  the parser\'s warning is shown on the review card', r.warnings.indexOf('A Mailtrap link has no v0/v1 label and was skipped.') >= 0, r.warnings);
  ok('  and with no proof parsed there is no Copy File warning', r.warnings.indexOf(NO_COPY) < 0);
  // a Copy File field that exists but is empty, or holds ADF
  var j = EXJ['EX-1'];
  r = extract(exIssue('EX-1', { fields: Object.assign({}, j.fields, { customfield_90591: '   ' }) }));
  ok('an empty Copy File field is null, with the warning (proofs were parsed)', r.draft.copyFileUrl === null && r.warnings.indexOf(NO_COPY) >= 0);
  r = extract(exIssue('EX-1', { fields: Object.assign({}, j.fields, { customfield_90591: doc([para('  https://docs.google.com/document/d/EXDOC_ADF_COPY_DOC_0000000000001/edit  ')]) }) }));
  eq('a Copy File field that is a rich-text doc gives its text, trimmed', r.draft.copyFileUrl, 'https://docs.google.com/document/d/EXDOC_ADF_COPY_DOC_0000000000001/edit');
  r = extract(exIssue('EX-1', { names: Object.assign({}, j.names, { customfield_90591: 'copy file' }) }));
  ok('the field name matches without regard to case', r.draft.copyFileUrl && /EXDOC_EX1/.test(r.draft.copyFileUrl));
  var dup = { type: 'doc', version: 1, content: [para('Mailtrap'), para('Regular Donors'), para('v0: ' + MT('7100000001')), para('v0: ' + MT('7100000001'))] };
  eq('the same message listed twice is one proof', extract({ key: 'EX-9', names: {}, fields: { summary: 's', description: dup } }).draft.emailProofs.length, 1);
  ok('extractTestContext takes the links from the description through adfTextWithHrefs, not adfText', /ecParseEmailLinks\(adfTextWithHrefs\(f\.description\)\)/.test(_pu));
  ok('and puts the three fields on the draft', /copyFileUrl,\s*\n\s*emailProofs: emailLinks\.proofs\.map/.test(_pu) && /emailEoa: emailLinks\.eoa\.map/.test(_pu));
});

T('Initialize: normalizeInitEmail (what Save stores)', function () {
  eval(_pu.slice(_pu.indexOf('function normalizeInitEmail(d) {'), _pu.indexOf('\n// Save is the only path that writes into initContexts')));
  var n = normalizeInitEmail({ copyFileUrl: '  https://docs.google.com/document/d/EXDOC_X_COPY_DOC_00000000000000/edit ',
    emailProofs: [{ segment: '  Regular Donors ', variation: ' V1 ', url: ' ' + MT('1') + ' ' }, { segment: '', variation: 'v0', url: '' }, { segment: null, variation: 'V0', url: 'u' }, null, { variation: 'v2', url: '  ' }],
    emailEoa: [{ variation: ' V0', url: ' e ' }, { variation: 'v1', url: '  ' }, undefined] });
  jeq('exactly the three fields', Object.keys(n), ['copyFileUrl', 'emailProofs', 'emailEoa']);
  eq('the copy file link is trimmed', n.copyFileUrl, 'https://docs.google.com/document/d/EXDOC_X_COPY_DOC_00000000000000/edit');
  jeq('proofs: segment trimmed or null, version lower-cased and trimmed, url trimmed, an entry with no url dropped', n.emailProofs, [{ segment: 'Regular Donors', variation: 'v1', url: MT('1') }, { segment: null, variation: 'v0', url: 'u' }]);
  jeq('Email on Acid: version lower-cased, url trimmed, empty urls dropped', n.emailEoa, [{ variation: 'v0', url: 'e' }]);
  jeq('empty and missing fields', normalizeInitEmail({ copyFileUrl: '', emailProofs: 'x' }), { copyFileUrl: null, emailProofs: [], emailEoa: [] });
  jeq('a draft made before Email Check', normalizeInitEmail({ ticketKey: 'EX-1' }), { copyFileUrl: null, emailProofs: [], emailEoa: [] });
  var src = _pu.slice(_pu.indexOf('async function commitInitContext() {'), _pu.indexOf('async function clearActiveContext() {'));
  ok('commitInitContext merges it into the draft after the related tests', /Object\.assign\(d, normalizeInitEmail\(d\)\);/.test(src) && src.indexOf('normalizeInitEmail') > src.indexOf('d.concurrentTests = normalizeRelated'), src.length);
  // round trip: what Save stores is what Email Check accepts
  var saved = Object.assign({ reviewed: true, ticketKey: 'EX-1', summary: 's' }, normalizeInitEmail(extract(exIssue('EX-1')).draft));
  jeq('a saved EX-1 context is valid for Email Check', ecValidateContext(saved), { ok: true });
  var w = ecCtxForWorker(saved);
  eq('  and gives the worker four proofs and two Email on Acid tests', w.proofs.length + '/' + w.eoa.length + '/' + (w.copyFileUrl ? 'doc' : 'nodoc'), '4/2/doc');
  jeq('a context saved before Email Check is refused with the Initialize sentence', ecValidateContext({ reviewed: true, ticketKey: 'EX-1' }), { ok: false, error: 'Re-run Initialize on the ticket: this saved context has no Mailtrap proof links.' });
});

T('Initialize: the review card (Copy File row, guarded lists)', function () {
  eval(_pu.slice(_pu.indexOf('function esc(s) {'), _pu.indexOf('\nfunction ', _pu.indexOf('function esc(s) {') + 5)));
  var host = { innerHTML: '' };
  globalThis.document = { getElementById: function (id) { return id === 'init-review' ? host : null; } };
  eval(_pu.slice(_pu.indexOf('function initEmailListsHtml(d, q) {'), _pu.indexOf('\n// ── Review / Commit UI')));
  eval(_pu.slice(_pu.indexOf('function renderInitReview() {'), _pu.indexOf('\nfunction setInitPath(')));
  try {
    var r = extract(exIssue('EX-1'));
    renderInitReview();
    var h = host.innerHTML;
    ok('the card renders and still offers Save and Discard', h.indexOf('id="btn-init-commit"') >= 0 && h.indexOf('id="btn-init-discard"') >= 0 && h.indexOf('data-init="summary"') >= 0);
    ok('Copy File is an editable row with its value, after QA Test Plan and before the variants', h.indexOf('data-init="copyFileUrl" value="https://docs.google.com/document/d/EXDOC_EX1_COPY_DOC_000000000001/edit?usp=sharing"') > h.indexOf('data-init="qaTestPlanUrl"') && h.indexOf('data-init="copyFileUrl"') < h.indexOf('Variants (Test Specifications)'), h.indexOf('copyFileUrl'));
    ok('  with an open link next to it', /<span class="arg-lbl">Copy File<\/span>[\s\S]*?open ↗/.test(h));
    ok('the Email proof rows and the Email on Acid rows are editable, after the Concurrent Tests and before Save as', h.indexOf('data-init="emailProofs.3.url"') > h.indexOf('data-init-add="concurrentTests"') && h.indexOf('data-init="emailEoa.1.url"') < h.indexOf('id="init-save-name"'), h.indexOf('emailProofs'));
    ok('  one row per proof, with the three fields, a remove and an add button', ['segment', 'variation', 'url'].every(function (f) { return h.indexOf('data-init="emailProofs.0.' + f + '"') >= 0; }) && h.indexOf('data-init-rm="emailProofs.3"') >= 0 && h.indexOf('data-init-add="emailProofs"') >= 0);
    ok('  and one per Email on Acid test', h.indexOf('data-init="emailEoa.0.variation"') >= 0 && h.indexOf('data-init-rm="emailEoa.1"') >= 0 && h.indexOf('data-init-add="emailEoa"') >= 0 && h.indexOf('data-init-rm="emailEoa.2"') < 0);
    // a draft made before Email Check
    _initDraft = Object.assign({}, r.draft); delete _initDraft.copyFileUrl; delete _initDraft.emailProofs; delete _initDraft.emailEoa;
    renderInitReview();
    h = host.innerHTML;
    ok('a draft without the new fields renders: an empty Copy File, empty lists, both add buttons', /data-init="copyFileUrl" value=""/.test(h) && h.indexOf('data-init-add="emailProofs"') >= 0 && h.indexOf('data-init-add="emailEoa"') >= 0 && h.indexOf('data-init-rm="emailProofs') < 0 && h.split('None found in ticket.').length >= 3, h.length);
    // hostile values are escaped
    _initDraft = Object.assign({}, r.draft, { copyFileUrl: '"><script>x</script>', emailProofs: [{ segment: '"><i>', variation: 'v0', url: '"><script>y</script>' }], emailEoa: [{ variation: 'v0', url: '"><b>' }] });
    renderInitReview();
    ok('values are escaped in the attributes', host.innerHTML.indexOf('<script>') < 0 && host.innerHTML.indexOf('<i>') < 0 && host.innerHTML.indexOf('"><b>') < 0 && host.innerHTML.indexOf('&quot;&gt;&lt;script&gt;') >= 0, host.innerHTML.length);
    // the guard: a fault in the list markup must not take the review card down
    var real = initEmailListsHtml;   // the binding renderInitReview resolves (both were eval'd into this scope)
    initEmailListsHtml = function () { throw new Error('boom <b>'); };
    _initDraft = r.draft; host.innerHTML = '';
    var threw = false; try { renderInitReview(); } catch (e) { threw = true; }
    ok('a throwing list builder does not break the card', !threw && host.innerHTML.indexOf('id="btn-init-commit"') >= 0 && host.innerHTML.indexOf('data-init="copyFileUrl"') >= 0);
    ok('  it says what failed, escaped', host.innerHTML.indexOf('Email proof links could not be shown: boom &lt;b&gt;') >= 0 && host.innerHTML.indexOf('<b>') < 0, host.innerHTML.slice(0, 80));
    initEmailListsHtml = real;
  } finally { delete globalThis.document; }
});

T('Initialize: the list builder (DE-01)', function () {
  eval(_pu.slice(_pu.indexOf('function initEmailListsHtml(d, q) {'), _pu.indexOf('\n// ── Review / Commit UI')));
  var q = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var d = extract(exIssue('EX-1')).draft;
  var h = initEmailListsHtml(d, q);
  ok('the two captions', h.indexOf('<label class="cap">Email proofs (Mailtrap)') >= 0 && h.indexOf('<label class="cap">Email on Acid') >= 0 && h.indexOf('Email proofs (Mailtrap)') < h.indexOf('<label class="cap">Email on Acid'));
  eq('four proof rows (a remove button each) and two Email on Acid rows', (h.match(/data-init-rm="emailProofs\.\d"/g) || []).length + ':' + (h.match(/data-init-rm="emailEoa\.\d"/g) || []).length, '4:2');
  ok('each proof row: segment, variation and url inputs with their values', h.indexOf('data-init="emailProofs.2.segment" value="Major Donors"') >= 0 && h.indexOf('data-init="emailProofs.2.variation" value="v0"') >= 0 && h.indexOf('data-init="emailProofs.2.url" value="' + MT('7100000003') + '"') >= 0, h.slice(0, 300));
  ok('the placeholders and widths of the documented shape', h.indexOf('placeholder="Segment" style="max-width:110px;flex:0 1 auto"') >= 0 && h.indexOf('placeholder="v0" style="max-width:50px;flex:0 1 auto"') >= 0 && h.indexOf('style="flex:2 1 200px"') >= 0);
  ok('remove buttons are the btn-icon shape, add buttons the btn sm shape with their captions', h.indexOf('<button class="btn-icon" data-init-rm="emailProofs.0" title="Remove" style="color:var(--err)">✕</button>') >= 0 && h.indexOf('<button class="btn sm" data-init-add="emailProofs" style="margin:5px 0 10px">+ Add Email Proof</button>') >= 0 && h.indexOf('<button class="btn sm" data-init-add="emailEoa" style="margin:5px 0 10px">+ Add Email on Acid Test</button>') >= 0);
  var e = initEmailListsHtml({ emailProofs: [], emailEoa: [] }, q);
  eq('empty lists say none found, twice, and still offer both add buttons', e.split('None found in ticket.').length - 1 + ':' + (e.match(/data-init-add="/g) || []).length, '2:2');
  jeq('missing lists behave as empty', initEmailListsHtml({}, q), e);
  var x = initEmailListsHtml({ emailProofs: [{ segment: null, variation: undefined, url: '"><script>' }], emailEoa: [{ variation: '<i>', url: null }] }, q);
  ok('null and undefined parts become empty values, markup is escaped through q', x.indexOf('<script>') < 0 && x.indexOf('<i>') < 0 && x.indexOf('data-init="emailProofs.0.segment" value=""') >= 0 && x.indexOf('&lt;i&gt;') >= 0, x);
});

T('Initialize: add, remove and edit on the review card', function () {
  eval(_pu.slice(_pu.indexOf('function setInitPath(path, value) {'), _pu.indexOf('\nfunction onInitReviewInput(e) {')));
  eval(_pu.slice(_pu.indexOf('function onInitReviewClick(e) {'), _pu.indexOf('\n// ── Initialize tab — AI field extraction')));
  var rendered = 0;
  globalThis.renderInitReview = function () { rendered++; };
  globalThis.confirm = function () { return true; };
  try {
    function click(attr, val) { var tgt = { dataset: {} }; tgt.dataset[attr] = val; _initDraft = _initDraft; onInitReviewClick({ target: { closest: function () { return tgt; } } }); }
    _initDraft = extract(exIssue('EX-1')).draft;
    click('initAdd', 'emailProofs');
    jeq('adding a proof appends an empty row with version v0', _initDraft.emailProofs[4], { segment: '', variation: 'v0', url: '' });
    click('initAdd', 'emailEoa');
    jeq('adding an Email on Acid test appends an empty row with version v0', _initDraft.emailEoa[2], { variation: 'v0', url: '' });
    eq('each add re-renders the card', rendered, 2);
    click('initRm', 'emailProofs.1');
    ok('removing a proof removes exactly that row', _initDraft.emailProofs.length === 4 && _initDraft.emailProofs[1].segment === 'Major Donors' && _initDraft.emailProofs[0].variation === 'v0', _initDraft.emailProofs.map(function (p) { return p.url; }));
    click('initRm', 'emailEoa.0');
    jeq('removing an Email on Acid test removes exactly that row', _initDraft.emailEoa.map(function (e) { return e.variation; }), ['v1', 'v0']);
    eq('each removal re-renders too', rendered, 4);
    _initDraft = { ticketKey: 'EX-1' };
    click('initAdd', 'emailProofs'); click('initAdd', 'emailEoa');
    ok('adding to a draft made before Email Check creates the lists', _initDraft.emailProofs.length === 1 && _initDraft.emailEoa.length === 1);
    // editing through data-init paths (the generic handler)
    _initDraft = extract(exIssue('EX-1')).draft;
    setInitPath('emailProofs.2.url', 'https://mailtrap.io/sandboxes/7000001/messages/7100000099');
    setInitPath('emailProofs.2.segment', 'Other');
    setInitPath('emailEoa.1.variation', 'v9');
    setInitPath('copyFileUrl', 'https://docs.google.com/document/d/EXDOC_NEW_COPY_DOC_000000000001/edit');
    ok('edits land on the draft', _initDraft.emailProofs[2].url.slice(-2) === '99' && _initDraft.emailProofs[2].segment === 'Other' && _initDraft.emailEoa[1].variation === 'v9' && /EXDOC_NEW/.test(_initDraft.copyFileUrl));
    ok('the other add / remove branches are untouched', /list === 'variants'/.test(_pu) && /list === 'concurrentTests'/.test(_pu) && /if \(list === 'emailProofs'\)/.test(_pu) && /if \(list === 'emailEoa'\)/.test(_pu));
  } finally { delete globalThis.renderInitReview; delete globalThis.confirm; }
});

// ── report ─────────────────────────────────────────────────────────────────
print('');
if (failures.length) {
  print('FAILURES:');
  failures.forEach(function (f) { print('  - ' + f); });
}
print('=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
