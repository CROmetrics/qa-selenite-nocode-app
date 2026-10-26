"""End-to-end gate for Email Check (the Test Agent mode 'emailcheck'): the REAL Selenite extension (this checkout)
in REAL branded Chrome, driving the real panel and worker against fake Mailtrap / Pardot / destination / Email on Acid / Google
Docs services on 127.0.0.1 (fake_services.py), which serve ONLY the committed synthetic fixtures (../fixtures-email-*.json,
org Example Relief, tickets EX-1 / EX-2). Nothing here talks to a real host: Chrome is started with
`--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1`, so any name but an IP literal fails to resolve.

  python3 -I -u gate.py [scenario ...]       (no scenario: all eight)
  python3 -I -u gate.py --list
  python3 -I -u gate.py --selftest           (no Chrome: the scenario table's arithmetic and its cross-checks against the code)
  python3 -I -u gate.py --smoke              (Chrome WITHOUT the extension: the cookie, 302 and DNS-block behaviour the gate relies on)

Scenarios (`clean` = EX-2 + its copy doc + the rules Email Check suggests from the ticket's comments):
  clean           64 passed / 24 in progress / 0 / 0, NEEDS REVIEW, 24 Pardot GETs, 32 renders
  ex-1            the EX-1 context (inlineCard ADF, identical UTMs): altTags Failed on both v1 proofs, 60 / 26 / 0 / 2, ISSUES FOUND
  wrong-segment   a tester-set Regular path rule (the superseded give-regular): conditional Failed on both Regular proofs
  token           {{{dynamic_content_101}}} in Regular v0's text part: rawTokens + conditional Failed on regular-donors-v0 only
  no-eoa          no EoA links: the four visual/dark rows Blocked(eoa) on all four proofs, 0 EoA requests
  signed-out      no `mt` cookie: Mailtrap signed-out, 18 Blocked(mailtrap) + 4 In Progress per proof, 0 Pardot GETs, doc and EoA still read
  personal        /api/accounts lists only account 111: no-account, statuses as signed-out
  no-doc          no copyFileUrl: doc no-link, the seven copy-doc rows In Progress, the rest as clean

How it works (the qapass-gate pattern): branded Chrome (CHROME_BIN overrides the path) is launched headless with
--remote-debugging-pipe and a fresh throwaway profile; the unpacked extension is loaded with Extensions.loadUnpacked; the panel
(popup.html) is opened as a tab. Per scenario: the fake services are reconfigured, the `mt` cookie is set or cleared
(Storage.setCookies), `globalThis.__ecGateOrigins` is set in the WORKER over CDP (six https origins -> the one
127.0.0.1 server), the Test Context is built by the panel's own Initialize helpers (ecParseEmailLinks(adfTextWithHrefs(...)),
jiraContextComments) from the synthetic Jira fixture and written to chrome.storage.local, Email Check is selected with Agentic
Analysis OFF (no model is ever called), #btn-ta-run is clicked and the run is awaited. Then _ecLastRun, the newest report in
IndexedDB (debug log, problems, body HTML) and the report tab's text are read back and checked.

Shared assertions (every scenario): the record has exactly the 19 top-level keys and version 1; no forbidden string (ids, the
inbox address, header names) anywhere in the record, report, debug section or panel; 0 requests to a guarded link; each /e/ path
and each linkId at most once; destination requests carry no query and each path once; exactly one Mailtrap tab page load; no
cookie or Authorization header on a worker fetch to a non-Mailtrap route; no http(s) tab left; no unmapped-host error.

Needs: macOS or Linux with Google Chrome 154+, python3. This never touches your everyday Chrome or its profile.
  GATE_OUT      a directory to write each scenario's record, debug log and report text into (default: a temp dir, printed)
  GATE_PROFILE  the throwaway Chrome profile directory (default: <temp dir>/selenite_emailcheck_profile_<pid>); deleted at start and end

Exit codes: 0 ALL PASSED; 1 a check failed; 3 nothing failed but a check is still pending, so the gate is not complete.
Do not edit anything under extension/ while a run is in progress: an MV3 worker restart re-reads its files from disk.
"""
import hashlib, json, os, re, shutil, sys, tempfile, time
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'browserstack-gate'))
sys.path.insert(0, HERE)
import fake_services as fs

EXT = os.path.abspath(os.path.join(HERE, '..', '..'))          # extension/, loaded unpacked
PROFILE = os.environ.get('GATE_PROFILE') or os.path.join(tempfile.gettempdir(), 'selenite_emailcheck_profile_%d' % os.getpid())
OUT = os.environ.get('GATE_OUT')            # made on first use (--list and --selftest create nothing)
RUN_TIMEOUT_S = 6 * 60
CTX_KEY = 'EX'                              # the initContexts key the gate writes (a ticket-prefix key, as the panel's own)

# The six real https origins the worker's gate override maps to the fake server.
ORIGIN_HOSTS = ['mailtrap.io', 'marketing.example.org', 'www.example.org', 'app.emailonacid.com', 'images.emailonacid.com', 'docs.googleapis.com']

RECORD_KEYS = ['version', 'ts', 'startedAt', 'finishedAt', 'stopped', 'error', 'ticketKey', 'summary', 'profileId', 'settings',
               'sources', 'doc', 'proofs', 'links', 'renders', 'checks', 'notTested', 'explain', 'sheet']          # 19 keys
# None of these may appear in a stored record, a report, a debug section or the panel (the synthetic carriers of the
# real identifiers: prospect id, hash, hex tail, inbox address, raw header names, message-part paths, bounce address, client ip).
FORBIDDEN = ['@inbox.mailtrap.io', '2000000002', 'SynthHash0', '0123456789abcdef0123456789abcdef', '/h/', 'testing_message_parts',
             'bounce-', 'List-Unsubscribe', 'Received', 'SYNTHETICTOKEN', '192.0.2.1']
# The report's sub-headings, in order. All eleven are required for `clean`; any other scenario only has to keep the order.
HEADINGS = ['Failed', 'Needs a person', 'Blocked', 'Passed', 'Proofs', 'Links and UTMs', 'Copy differences', 'Email on Acid',
            'Analysis (Opus)', 'Not tested', 'Sheet changes']
# The eight fixed not-tested ids (ecFixedNotTested).
NOT_TESTED_IDS = ['X.unsubscribe', 'X.viewports', 'X.eoa-url-validation', 'X.fallback', 'X.doc-comments', 'X.jira', 'X.plan-setup', 'X.graphics-text']
# What an unmapped or unreachable host looks like in a stored error string (read from ecwFetch / ecwTabUrl in background.js): the worker's own refusal while
# the override is on is 'Refused: <origin> is not an allowed address for Email Check.' (and 'Refused: not opened (an unsubscribe, preferences or view-in-browser
# path).', which no scenario may produce either); a fetch that slipped past it dies at Chrome's DNS block as 'Failed to fetch' (net::ERR_NAME_NOT_RESOLVED).
# No scenario has a legitimate network failure, so none of these may appear in a record.
UNMAPPED_ERROR_RES = [re.compile(p, re.I) for p in (r'^Refused: ', r'is not an allowed address for Email Check', r'Failed to fetch', r'net::ERR_', r'ERR_NAME_NOT_RESOLVED', r'ERR_CONNECTION')]
# The panel's status line when a run ends without a record (read from runTestAgent and runEmailCheckMode in popup.js): runTestAgent prints
# '<mode label> failed: <reason>' (the reason is ecValidateContext's sentence, the stale-worker sentence, a rejected message) or 'Done - nothing configured to run.'
# (with an em dash) or 'The report could not be built: ...'. A run in progress prints 'Running <label>...' and 'Email Check - <phase> <label> (n/m)' only.
STATUS_FAIL_RE = re.compile(r' failed: |nothing configured to run|report could not be built', re.I)
# The sentences the panel and the report show for a Mailtrap source that could not be read; --selftest checks them
# against EC_MAILTRAP_MSG in email-check.js. {sb} is the sandbox id.
D4 = {
    'signed-out': 'Mailtrap: this Chrome is signed out. Sign in to the shared Mailtrap account in this Chrome, then run again.',
    'no-account': 'Mailtrap: the signed-in account does not own sandbox {sb} (a personal account?). Sign out of Mailtrap, sign in to the shared account, then run again.',
}

passed = failed = 0
fails = []
pending = []
# Pending checks: an entry keeps a full gate run from saying ALL PASSED (it says NOT COMPLETE instead). None is pending now.
ALIGN_PENDING = {}


def chk(name, cond, detail=None):
    global passed, failed
    if cond:
        passed += 1
        print('  ok   ' + name)
    else:
        failed += 1
        fails.append(name)
        print('  FAIL ' + name + ('   -> ' + json.dumps(detail, default=str)[:400] if detail is not None else ''))


def note(msg):
    print('  ..   ' + msg)


def pend(item, what):
    """An unimplemented check: printed, counted, and it keeps the gate from saying ALL PASSED."""
    if item not in pending:
        pending.append(item)
    print('  PEND %s  %s' % (item, what))


# ══ The scenario table as data ═══════════════════════════════════════════════════
# The 22 rows of one EMAIL Test Plan group, in EC_ROWS order (--selftest compares this list with email-check.js).
KEYS = ['subject', 'subjectTokens', 'senderName', 'senderSpelling', 'fromAddress', 'replyTo', 'preview', 'previewSpelling',
        'previewTokens', 'rawTokens', 'conditional', 'grammarBody', 'grammarGraphics', 'altTags', 'links', 'utms', 'visuals',
        'alignment', 'darkMode', 'darkReadability', 'signer', 'dkim']
VISUAL = ['visuals', 'alignment', 'darkMode', 'darkReadability']
# `clean`: per proof 16 Passed, 6 In Progress.
CLEAN_IN_PROGRESS = ['grammarGraphics', 'altTags'] + VISUAL
# The rows that need the copy doc (In Progress when there is no doc).
SPEC_ROWS = ['subject', 'senderName', 'fromAddress', 'preview', 'previewSpelling', 'grammarBody', 'signer']
NON_VISUAL = [k for k in KEYS if k not in VISUAL]
TOKEN_LINE = '\n{{{dynamic_content_101}}}\n'

# One entry per scenario. changes = [(selector, key, status[, blockedBy])] applied to `clean`'s per-proof table in order; a selector
# is '*', a variation ('v0'), a segment slug ('regular-donors') or a proof id ('regular-donors-v0'). counts = (passed,
# in-progress, blocked, failed) over all four proofs, written out by hand and cross-checked against the changes by
# --selftest. badge: the report badge (qpBadge: any failed -> ISSUES FOUND; else any in-progress/blocked -> NEEDS REVIEW).
SCENARIOS = {
    'clean': dict(
        what='EX-2 + its copy doc + the suggested rules: nothing failed, the build-only and spec rows pass',
        ticket='EX-2', doc='ex2', eoa=True, cookie=True, cfg={}, ui={}, changes=[],
        counts=(64, 24, 0, 0), badge='NEEDS REVIEW', mailtrap='ok', doc_state='ok', proof_state='ok',
        pardot='fixture', eoa_links=2, renders=32, docs=1, d4=None,
        prefill={'utm': 'suffix', 'seg': {'Regular Donors': 'seed-kits', 'Major Donors': 'seed-kits-major'}},
        settings={'profileId': 'example', 'utmRule': ('suffix', 'suggested', '420001'),
                  'segmentPaths': {'Regular Donors': ('seed-kits', 'suggested', '420003'), 'Major Donors': ('seed-kits-major', 'suggested', '420003')},
                  'onlyIn': ({'v0': ['DONATE NOW'], 'v1': ['HELP NOW']}, '420001')}),
    'ex-1': dict(
        what='EX-1: v1 has no CTA text anchor, so the hero and stat image are the only links to the story page and their alts lack the CTA label',
        ticket='EX-1', doc='jira', eoa=True, cookie=True, cfg={}, ui={},
        changes=[('*', 'conditional', 'in-progress'), ('v1', 'altTags', 'failed')],
        counts=(60, 26, 0, 2), badge='ISSUES FOUND', mailtrap='ok', doc_state='ok', proof_state='ok',
        pardot='fixture', eoa_links=2, renders=32, docs=1, d4=None,
        prefill={'utm': 'identical', 'seg': {'Regular Donors': '', 'Major Donors': ''}},
        settings={'profileId': 'example', 'utmRule': ('identical', 'suggested', '410001'),
                  'segmentPaths': {'Regular Donors': ('', None, None), 'Major Donors': ('', None, None)}, 'onlyIn': None}),
    'wrong-segment': dict(
        what='the Regular DONATE path rule is the superseded give-regular (tester-set): conditional Failed on both Regular proofs, Major unchanged',
        ticket='EX-2', doc='ex2', eoa=True, cookie=True, cfg={}, ui={'seg': {'Regular Donors': 'give-regular'}},
        changes=[('regular-donors', 'conditional', 'failed')],
        counts=(62, 24, 0, 2), badge='ISSUES FOUND', mailtrap='ok', doc_state='ok', proof_state='ok',
        pardot='fixture', eoa_links=2, renders=32, docs=1, d4=None, prefill=None,
        settings={'profileId': 'example', 'utmRule': ('suffix', 'suggested', '420001'),
                  'segmentPaths': {'Regular Donors': ('give-regular', 'tester', None), 'Major Donors': ('seed-kits-major', 'suggested', '420003')}}),
    'token': dict(
        what='{{{dynamic_content_101}}} left in Regular v0\'s text part: rawTokens and conditional Failed on regular-donors-v0 only',
        ticket='EX-2', doc='ex2', eoa=True, cookie=True,
        cfg=lambda fx: {'txt_append': {fs_msg(fx, 'EX-2', 'regular-donors', 'v0'): TOKEN_LINE}}, ui={},
        changes=[('regular-donors-v0', 'rawTokens', 'failed'), ('regular-donors-v0', 'conditional', 'failed')],
        counts=(62, 24, 0, 2), badge='ISSUES FOUND', mailtrap='ok', doc_state='ok', proof_state='ok',
        pardot='fixture', eoa_links=2, renders=32, docs=1, d4=None, prefill=None, settings=None),
    'no-eoa': dict(
        what='no Email on Acid links in the context: the four visual/dark rows are Blocked(eoa) on every proof; nothing asks EoA',
        ticket='EX-2', doc='ex2', eoa=False, cookie=True, cfg={}, ui={},
        changes=[('*', k, 'blocked', 'eoa') for k in VISUAL],
        counts=(64, 8, 16, 0), badge='NEEDS REVIEW', mailtrap='ok', doc_state='ok', proof_state='ok',
        pardot='fixture', eoa_links=0, renders=0, docs=1, d4=None, prefill=None, settings=None),
    'signed-out': dict(
        what='no mt cookie: the Mailtrap tab lands on /signin; every row but the four visual ones is Blocked(mailtrap); the doc and EoA are still read',
        ticket='EX-2', doc='ex2', eoa=True, cookie=False, cfg={}, ui={},
        changes=[('*', k, 'blocked', 'mailtrap') for k in NON_VISUAL],
        counts=(0, 16, 72, 0), badge='NEEDS REVIEW', mailtrap='signed-out', doc_state='ok', proof_state='not-read',
        pardot=0, eoa_links=2, renders=32, docs=1, d4='signed-out', prefill=None, settings=None),
    'personal': dict(
        what='signed in, but /api/accounts lists only a personal account (111) that does not own the sandbox: no-account, statuses as signed-out',
        ticket='EX-2', doc='ex2', eoa=True, cookie=True, cfg={'accounts': [111]}, ui={},
        changes=[('*', k, 'blocked', 'mailtrap') for k in NON_VISUAL],
        counts=(0, 16, 72, 0), badge='NEEDS REVIEW', mailtrap='no-account', doc_state='ok', proof_state='not-read',
        pardot=0, eoa_links=2, renders=32, docs=1, d4='no-account', prefill=None, settings=None),
    'no-doc': dict(
        what='no copyFileUrl: doc no-link; the seven copy-doc rows In Progress; senderSpelling, links, utms and conditional still Passed',
        ticket='EX-2', doc=None, eoa=True, cookie=True, cfg={}, ui={},
        changes=[('*', k, 'in-progress') for k in SPEC_ROWS],
        counts=(36, 52, 0, 0), badge='NEEDS REVIEW', mailtrap='ok', doc_state='no-link', proof_state='ok',
        pardot='fixture', eoa_links=2, renders=32, docs=0, d4=None, prefill=None, settings=None),
}


def fs_msg(fx, ticket, segment, variation):
    """The Mailtrap message id of one fixture proof (a `cfg` callable resolves ids from the fixtures at run time)."""
    for p in fx['proofs']['tickets'][ticket]['proofs']:
        if p['segment'] == segment and p['variation'] == variation:
            return str(p['messageId'])
    raise KeyError((ticket, segment, variation))


def proof_list(fx, ticket):
    """[(proofId, segment slug, variation, messageId)] of a fixture ticket; proofId = <segment>-<variation>."""
    return [('%s-%s' % (p['segment'], p['variation']), p['segment'], p['variation'], str(p['messageId'])) for p in fx['proofs']['tickets'][ticket]['proofs']]


def selects(sel, pid, seg, var):
    return sel == '*' or sel == pid or sel == var or sel == seg


def expected_map(fx, sc):
    """{proofId: {key: (status, blockedBy or None)}}: `clean`'s table with the scenario's changes applied in order."""
    out = {}
    for pid, seg, var, _mid in proof_list(fx, sc['ticket']):
        m = dict((k, ('in-progress' if k in CLEAN_IN_PROGRESS else 'passed', None)) for k in KEYS)
        for ch in sc['changes']:
            if selects(ch[0], pid, seg, var):
                m[ch[1]] = (ch[2], ch[3] if len(ch) > 3 else None)
        out[pid] = m
    return out


def tally(emap):
    """(passed, in-progress, blocked, failed) over every proof."""
    c = {'passed': 0, 'in-progress': 0, 'blocked': 0, 'failed': 0}
    for m in emap.values():
        for st, _by in m.values():
            c[st] += 1
    return (c['passed'], c['in-progress'], c['blocked'], c['failed'])


def scenario_cfg(fx, sc):
    c = sc['cfg']
    return c(fx) if callable(c) else dict(c)


def copy_file_from_jira(fx, ticket):
    """The Jira `Copy File` custom field of a fixture ticket (the field is found by NAME, as Initialize does), or None."""
    t = fx['jira'][ticket]
    for fid, name in t['names'].items():
        if name == 'Copy File':
            return t['fields'].get(fid) or None
    return None


def doc_url(fx, which, ticket):
    """The copyFileUrl a scenario's context carries: 'jira' = the ticket's own Copy File field, 'ex2' = the EX-2 doc (the Jira
    fixture has no Copy File for EX-2, so the gate gives the context one), None = no link."""
    if which is None:
        return None
    if which == 'jira':
        return copy_file_from_jira(fx, ticket)
    return 'https://docs.google.com/document/d/%s/edit?usp=sharing' % fx['doc-ex2']['documentId']


# ══ Helpers ═══════════════════════════════════════════════════════════════════════════════════════════

def tree_digest(root):
    """sha256 over every file under `root` (relative path + bytes), skipping __pycache__ and .DS_Store: the gate must leave
    extension/ byte-identical."""
    h = hashlib.sha256()
    for dp, dn, fn in os.walk(root):
        dn[:] = sorted(d for d in dn if d != '__pycache__')
        for f in sorted(fn):
            if f == '.DS_Store':
                continue
            p = os.path.join(dp, f)
            h.update(os.path.relpath(p, root).encode('utf-8') + b'\0')
            with open(p, 'rb') as fh:
                h.update(fh.read())
    return h.hexdigest()


def strip_images(s):
    """Drops base64 image payloads before a forbidden-string scan (random base64 can contain '/h/')."""
    return re.sub(r'data:image/[a-z]+;base64,[A-Za-z0-9+/=]+', 'data:image/…', s or '')


def by_id(rec):
    return dict((c['id'], c) for c in (rec or {}).get('checks') or [])


def heading_positions(text):
    """The line index of each of the HEADINGS in the report text (-1 when absent), searching forward in order."""
    lines = [l.strip() for l in (text or '').split('\n')]
    pos, start = [], 0
    for hd in HEADINGS:
        i = next((n for n in range(start, len(lines)) if lines[n] == hd or lines[n].startswith(hd + ' ')), -1)
        pos.append(i)
        if i >= 0:
            start = i + 1
    return pos


def ec_row_keys():
    """The `key:` values of EC_ROWS in extension/email-check.js, in order; None when the block cannot be found."""
    try:
        with open(os.path.join(EXT, 'email-check.js'), 'r', encoding='utf-8') as fh:
            src = fh.read()
        i = src.index('const EC_ROWS = [')
        block = src[i:src.index('];', i)]
        keys = re.findall(r"key: '(\w+)'", block)
        return keys or None
    except Exception:
        return None


# ══ The browser ═══════════════════════════════════════════════════════════════════════════════════════

CHROME_ARGS = [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb',
    # every name but an IP literal fails to resolve: a worker or tab that reached for a real host gets nothing
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
    '--window-size=1400,900',
]

# The Test Context, built by the PANEL's own Initialize helpers from the synthetic Jira fixture: the same
# ecParseEmailLinks(adfTextWithHrefs(description)) and jiraContextComments the real Initialize runs. copyFileUrl is set by Python.
CTX_JS = """(() => {
  const f = %s;
  const links = ecParseEmailLinks(adfTextWithHrefs(f.description));
  return {
    ticketKey: %s, ticketUrl: '', summary: f.summary, platform: null, experimentId: null, variants: [], previewLinks: [], itwLink: null,
    goals: [], qaTestPlanUrl: null, softcodedTests: [], concurrentTests: [], comments: jiraContextComments(f.comment),
    figmaUrl: null, figmaNodeId: null, copyFileUrl: null,
    emailProofs: links.proofs.map(p => ({ segment: p.segment, variation: p.variation, url: p.url })),
    emailEoa: links.eoa.map(e => ({ variation: e.variation, url: e.url })),
    reviewed: true,
  };
})()"""


class Gate:
    def __init__(self):
        self.b = None
        self.svc = None
        self.panel = None
        self.digest0 = tree_digest(EXT)
        try:
            self._start()
        except BaseException:
            self.close()
            raise

    # -- start / stop -------------------------------------------------------------------------------
    def _start(self):
        from cdp import Browser
        if os.path.exists(PROFILE):
            shutil.rmtree(PROFILE)
        self.fx = fs.load_fixtures()
        self.svc = fs.Services(0, fixtures=self.fx)
        self.b = Browser(CHROME_ARGS + ['--user-data-dir=' + PROFILE, 'about:blank'])
        self.ext = self.b.load_extension(EXT)
        self.attach_worker()
        t = self.b.send('Target.createTarget', {'url': 'chrome-extension://%s/popup.html' % self.ext})['targetId']
        self.panel_target = t
        self.panel = self.b.attach(t)
        self.b.send('Runtime.enable', session=self.panel)
        for _ in range(120):
            try:
                if self.pev("typeof TA_MODES === 'object' && !!TA_MODES.emailcheck && !!document.getElementById('ec-body') && typeof WIN_ID !== 'undefined' && WIN_ID != null"):
                    break
            except Exception:
                pass
            time.sleep(0.25)
        self.win = self.pev('WIN_ID')

    def attach_worker(self):
        """(Re)attaches to the extension's service worker and waits for the Email Check bindings (a worker is listed before they exist,
        and Chrome may restart an idle one: this is also the retry path of wev)."""
        w = self.b.find_target(lambda t: t['type'] == 'service_worker' and t['url'] == 'chrome-extension://%s/background.js' % self.ext)
        self.worker = self.b.attach(w['targetId'])
        for _ in range(80):
            try:
                if self.b.ev(self.worker, "typeof chrome !== 'undefined' && typeof runEmailCheck === 'function' && typeof ecwGateOrigins === 'function'"):
                    return
            except Exception:
                pass
            time.sleep(0.25)
        raise RuntimeError('the worker has no runEmailCheck / ecwGateOrigins: is the extension build complete (plan S9/S10)?')

    def pev(self, expr, **kw):
        return self.b.ev(self.panel, expr, **kw)

    def wev(self, expr, **kw):
        try:
            return self.b.ev(self.worker, expr, **kw)
        except Exception:
            self.attach_worker()
            return self.b.ev(self.worker, expr, **kw)

    def close(self):
        if self.b:
            self.b.close()
        if self.svc:
            self.svc.close()
        shutil.rmtree(PROFILE, ignore_errors=True)

    # -- per-scenario environment -------------------------------------------------------------------
    def set_mt_cookie(self, on):
        """The `mt` session cookie of the fake Mailtrap (Storage.setCookies). All six origins share one host, so it is the
        one cookie jar the worker's `credentials:'omit'` fetches must NOT send."""
        self.b.send('Storage.clearCookies')
        if on:
            self.b.send('Storage.setCookies', {'cookies': [{'name': 'mt', 'value': '1', 'url': self.svc.base + '/'}]})

    def set_gate_origins(self):
        """Sets globalThis.__ecGateOrigins in the worker and reads back what ecwGateOrigins() honours. Returns the value."""
        origins = dict(('https://' + h, self.svc.base) for h in ORIGIN_HOSTS)
        self.wev('globalThis.__ecGateOrigins = %s; true' % json.dumps(origins))
        raw = self.wev('JSON.stringify(ecwGateOrigins())')
        return json.loads(raw) if raw else None

    def build_context(self, sc):
        """The scenario's Test Context: the panel builds proofs, EoA links and comments from the Jira fixture; Python sets copyFileUrl
        and drops the EoA links for `no-eoa`."""
        fields = self.fx['jira'][sc['ticket']]['fields']
        ctx = self.pev(CTX_JS % (json.dumps(fields), json.dumps(sc['ticket'])))
        ctx['copyFileUrl'] = doc_url(self.fx, sc['doc'], sc['ticket'])
        if not sc['eoa']:
            ctx['emailEoa'] = []
        return ctx

    # -- one Email Check run through the real panel -------------------------------------------------
    def run_emailcheck(self, ctx, sc):
        ticket = sc['ticket']
        self.pev("""(async () => {
          await chrome.storage.local.set({ initContexts: { %s: %s }, activeInitContext: '%s' });
          await chrome.storage.local.remove(['ecTicketRules', 'ecSettings', 'ecSheetPrefs', 'ecSheetWriteLog']);
          try { await sessionNS.remove(['ecLastRun', 'ecProgress']); } catch (e) {}
          if (typeof _ecLastRun !== 'undefined') _ecLastRun = null;
          return true;
        })()""" % (CTX_KEY, json.dumps(ctx), CTX_KEY))
        show = """(() => {
          showTab('testagent');
          const sel = document.getElementById('ta-primary-select');
          sel.value = '%s'; sel.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()"""
        ready = """(() => { const slot = document.getElementById('ta-settings-slot'), body = document.getElementById('ec-body');
          return !!(slot && body && slot.contains(body)) && (document.getElementById('ec-ctx').textContent || '').includes(%s); })()""" % json.dumps(ticket)
        self.pev(show % 'emailcheck')
        ok = self._wait(ready, 6)
        if not ok:                      # the same mode re-shown did not refresh the context: leave the mode and come back
            self.pev(show % 'qapass')
            self.pev(show % 'emailcheck')
            ok = self._wait(ready, 8)
        out = {'ctx_shown': ok}
        want = sc.get('prefill')
        if want:                        # the rules Email Check suggests from the ticket's comments arrive after the context renders
            self._wait("document.getElementById('ec-utm-rule').value === %s" % json.dumps(want['utm']), 10)
        out['prefill'] = self.pev("""(() => ({
          utm: document.getElementById('ec-utm-rule').value,
          seg: Object.fromEntries([...document.querySelectorAll('#ec-seg-paths [data-ec-seg]')].map(i => [i.getAttribute('data-ec-seg'), i.value])),
          profile: document.getElementById('ec-profile').value,
          eoaRenders: document.getElementById('ec-eoa-renders').checked,
        }))()""")
        for seg, val in (sc['ui'].get('seg') or {}).items():       # a tester edit: the rule's source becomes 'tester'
            done = self.pev("""(() => { const i = document.querySelector('#ec-seg-paths [data-ec-seg=' + JSON.stringify(%s) + ']');
              if (!i) return false; i.value = %s; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()"""
                            % (json.dumps(seg), json.dumps(val)))
            chk('the segment rule input for %s exists and was set to %s' % (seg, val), done is True, done)
        self.pev("""(() => { const an = document.getElementById('ta-agentic-analysis'); an.checked = false; an.dispatchEvent(new Event('change', { bubbles: true }));
          document.getElementById('ta-status').textContent = ''; return true; })()""")
        keys_before = self._report_keys()
        origins = self.set_gate_origins()
        out['origins'] = origins
        t0 = time.time()
        t0_ms = int(t0 * 1000)
        self.pev("document.getElementById('btn-ta-run').click(); true")
        out.update(self._await_settle(t0, t0_ms, keys_before))
        out['seconds'] = round(time.time() - t0, 1)
        out['rec'] = json.loads(self.pev('JSON.stringify(typeof _ecLastRun === "undefined" ? null : _ecLastRun)') or 'null')
        out['slim'] = self.pev("""(async () => { try { return JSON.stringify((await sessionNS.get('ecLastRun')).ecLastRun || null); } catch (e) { return null; } })()""")
        out['status'] = self.pev("document.getElementById('ta-status').textContent") or ''
        out['panel_text'] = self.pev("(document.getElementById('ec-progress') || {}).innerText + '\\n' + (document.getElementById('ec-results') || {}).innerText") or ''
        out['panel_html'] = self.pev("(document.getElementById('ec-results') || {}).innerHTML") or ''
        out['report'] = self._newest_report(keys_before)
        out['report_text'] = None
        rep = out['report']
        if rep:
            try:
                tgt = self.b.find_target(lambda t: t['type'] == 'page' and ('qa-report.html?k=' + rep['key']) in t['url'], timeout=8)
                rs = self.b.attach(tgt['targetId'])
                for _ in range(40):
                    txt = self.b.ev(rs, 'document.body.innerText') or ''
                    if 'Selenite QA Report' in txt:
                        break
                    time.sleep(0.25)
                out['report_text'] = txt
            except Exception as e:
                out['report_text_error'] = str(e)
        out['tabs'] = self.pev('(async () => (await chrome.tabs.query({})).map(t => t.url || t.pendingUrl || ""))()')
        return out

    def _wait(self, expr, seconds):
        end = time.time() + seconds
        while time.time() < end:
            try:
                if self.pev(expr):
                    return True
            except Exception:
                pass
            time.sleep(0.25)
        return False

    def _report_keys(self):
        return self.pev("""(async () => (await idbReq((await idb()).transaction('reports').objectStore('reports').getAllKeys())).map(String))()""") or []

    def _newest_report(self, keys_before):
        return self.pev("""(async () => {
          const before = new Set(%s);
          const keys = (await idbReq((await idb()).transaction('reports').objectStore('reports').getAllKeys())).map(String).filter(k => !before.has(k)).sort();
          const k = keys[keys.length - 1];
          if (!k) return null;
          const r = await idbGet('reports', k);
          return { key: k, emailCheck: r.debugLog && r.debugLog.emailCheck, problems: r.debugLog && r.debugLog.problems, bodyHtml: r.bodyHtml };
        })()""" % json.dumps(keys_before))

    def _await_settle(self, t0, t0_ms, keys_before):
        """Waits until the run produced a record (_ecLastRun.ts newer than the click) AND a new report exists, or the status line
        shows the run ended without one, or RUN_TIMEOUT_S passes."""
        end = t0 + RUN_TIMEOUT_S
        last = ''
        while time.time() < end:
            time.sleep(1.5)
            try:
                # the panel keeps only the newest 5 reports (openReportTab), so a count stops growing from the sixth run on: look for a key that was not there before
                st = self.pev("""(async () => {
                  const before = new Set(%s);
                  return {
                    ts: (typeof _ecLastRun !== 'undefined' && _ecLastRun && _ecLastRun.ts) || 0,
                    status: document.getElementById('ta-status').textContent || '',
                    reports: (await idbReq((await idb()).transaction('reports').objectStore('reports').getAllKeys())).map(String).filter(k => !before.has(k)).length,
                  };
                })()""" % json.dumps(keys_before))
            except Exception:
                continue
            last = st['status']
            if st['ts'] >= t0_ms and st['reports'] > 0:
                return {'settled': 'record'}
            if time.time() - t0 > 8 and STATUS_FAIL_RE.search(last) and st['ts'] < t0_ms:
                return {'settled': 'status-only'}
        raise TimeoutError('Email Check did not settle in %d s (status: %s)' % (RUN_TIMEOUT_S, last))


# ══ Dump, shared assertions, expectations ═══════════════════════════════════════════════════════════════

def dump(name, res, requests):
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    json.dump(res.get('rec'), open(os.path.join(d, 'record.json'), 'w'), indent=1)
    rep = res.get('report') or {}
    json.dump({'status': res.get('status'), 'seconds': res.get('seconds'), 'settled': res.get('settled'), 'problems': rep.get('problems'),
               'emailCheck': rep.get('emailCheck'), 'tabs': res.get('tabs'), 'origins': res.get('origins'), 'prefill': res.get('prefill'),
               'requests': requests}, open(os.path.join(d, 'debug.json'), 'w'), indent=1)
    open(os.path.join(d, 'report.txt'), 'w').write(res.get('report_text') or '')
    open(os.path.join(d, 'report.html'), 'w').write(rep.get('bodyHtml') or '')
    open(os.path.join(d, 'panel.txt'), 'w').write(res.get('panel_text') or '')


def error_strings(rec):
    """Every error string a record holds (run, sources, links, renders): where an unmapped-host refusal would be written."""
    out = [rec.get('error')]
    src = rec.get('sources') or {}
    out += [(src.get('doc') or {}).get('error'), (src.get('mailtrap') or {}).get('error')]
    for e in src.get('eoa') or []:
        out += [e.get('error'), (e.get('renders') or {}).get('error')]
    out += [l.get('error') for l in rec.get('links') or []]
    out += [p.get('error') for p in rec.get('proofs') or []]
    return [s for s in out if isinstance(s, str) and s]


def shared_assertions(g, name, sc, res, reqs):
    """What every scenario must hold."""
    rec = res.get('rec') or {}
    chk('the run settled with a record and a new report', res.get('settled') == 'record' and isinstance(res.get('rec'), dict) and bool(res.get('report')), (res.get('settled'), res.get('status')))
    chk('the panel showed the ticket context before the run', res.get('ctx_shown') is True)
    o = res.get('origins')
    chk('the worker honours __ecGateOrigins: every mapped origin points at the fake server',
        isinstance(o, dict) and len(o) > 0 and all(v == g.svc.base for v in o.values()) or o is True, o)
    chk('the record has exactly the 19 keys of plan 1.4', sorted(rec.keys()) == sorted(RECORD_KEYS), sorted(set(rec.keys()) ^ set(RECORD_KEYS)))
    chk('version is 1', rec.get('version') == 1, rec.get('version'))
    chk('no run error and not stopped', rec.get('error') is None and rec.get('stopped') is False, (rec.get('error'), rec.get('stopped')))
    chk('the profile is the synthetic `example` one', rec.get('profileId') == 'example', rec.get('profileId'))
    rep = res.get('report') or {}
    blobs = {'record': json.dumps(rec), 'slim record': res.get('slim') or '', 'report text': res.get('report_text') or '', 'report html': rep.get('bodyHtml') or '',
             'debug section': json.dumps(rep.get('emailCheck')), 'problems': json.dumps(rep.get('problems')), 'panel text': res.get('panel_text') or '',
             'panel html': res.get('panel_html') or '', 'status line': res.get('status') or ''}
    hits = [(b, s) for b, txt in blobs.items() for s in FORBIDDEN if s in strip_images(txt)]
    chk('no forbidden string in the record, report, debug section or panel (%d strings x %d outputs)' % (len(FORBIDDEN), len(blobs)), not hits, hits[:6])
    chk('the stored (slim) session record carries no image data', 'data:image' not in (res.get('slim') or ''))
    chk('no stored error string reads like an unmapped-host refusal', not [s for s in error_strings(rec) if any(r.search(s) for r in UNMAPPED_ERROR_RES)], error_strings(rec)[:3])
    # requests
    guarded = [e for e in reqs if fs.is_guarded_request(e)]
    chk('0 requests to a guarded link (/webmail/, /unsubscribeConfirm/, an unsubscribe-like path)', not guarded, guarded[:3])
    pardot = [e for e in reqs if e['kind'] == 'pardot-e']
    paths = [e['path'] for e in pardot]
    chk('each /e/ path was requested at most once', len(paths) == len(set(paths)), [p for p in set(paths) if paths.count(p) > 1][:3])
    lids = [fs.PARDOT_PATH_RE.match(p).group('lid') for p in paths if fs.PARDOT_PATH_RE.match(p)]
    chk('and each linkId at most once (the same link in two proofs is one GET)', len(lids) == len(set(lids)), [x for x in set(lids) if lids.count(x) > 1][:3])
    want = len(fs.expected_pardot_linkids(g.fx, sc['ticket'])) if sc['pardot'] == 'fixture' else sc['pardot']
    chk('%d Pardot GETs (%s)' % (want, 'the distinct non-guarded linkIds of the proofs' if sc['pardot'] == 'fixture' else 'nothing is resolved'), len(pardot) == want, len(pardot))
    dest = [e for e in reqs if e['kind'] == 'dest' and e['method'] == 'GET']
    chk('destination requests carry no query string', not [e for e in dest if e['query']], [e['path'] + '?' + e['query'] for e in dest if e['query']][:3])
    dp = [e['path'] for e in dest]
    chk('and each destination path was fetched at most once', len(dp) == len(set(dp)), [p for p in set(dp) if dp.count(p) > 1][:3])
    if sc['pardot'] == 'fixture':
        chk('destinations were fetched (the interstitials led somewhere)', len(dest) >= 1, len(dest))
    else:
        chk('no destination was fetched (nothing was resolved)', not dest, dp[:3])
    sb = [e for e in reqs if e['kind'] == 'mt-web' and e['path'].startswith('/sandboxes/')]
    chk('exactly one Mailtrap tab page load (the first proof; the worker opens one tab of its own)', len(sb) == 1, [e['path'] for e in sb])
    bad = [e for e in reqs if e['dest'] == 'empty' and e['kind'] in ('pardot-e', 'dest', 'eoa-page', 'eoa-img', 'docs') and e['cookie']]
    chk('no worker fetch to a non-Mailtrap route carried a cookie (credentials omitted: all six origins share one cookie jar here)', not bad, [(e['kind'], e['path']) for e in bad][:3])
    note('requests whose Sec-Fetch-Dest was not sent: %d of %d' % (len([e for e in reqs if e['dest'] is None]), len(reqs)))
    chk('no Authorization header on any request (Mailtrap uses the tab session; the Docs read needs no token under the override)', not [e for e in reqs if e['auth']], [(e['kind'], e['path']) for e in reqs if e['auth']][:3])
    tabs = res.get('tabs') or []
    chk('after the run no http(s) tab is open (the run\'s Mailtrap and EoA tabs were closed; none to a real host)', not any(u.startswith('http') for u in tabs), tabs)
    chk('the record lists the eight fixed not-tested items', sorted(n.get('id') for n in rec.get('notTested') or []) == sorted(NOT_TESTED_IDS), sorted(n.get('id') for n in rec.get('notTested') or []))
    chk('the record\'s explain is null (Agentic Analysis was off; no model was called)', rec.get('explain') is None, rec.get('explain'))
    note('run took %s s; %d requests to the fake services' % (res.get('seconds'), len(reqs)))
    note('kinds: ' + json.dumps(dict((k, len([e for e in reqs if e['kind'] == k])) for k in sorted(set(e['kind'] for e in reqs)))))


def expectations(g, name, sc, res, reqs):
    """The scenario's own expected results, from the table above."""
    rec = res.get('rec') or {}
    emap = expected_map(g.fx, sc)
    exp_ids = ['%s@%s' % (k, pid) for pid in emap for k in KEYS]
    ck = by_id(rec)
    chk('88 checks, ids <key>@<proofId>, nothing else', sorted(ck) == sorted(exp_ids) and len(rec.get('checks') or []) == 88, (len(rec.get('checks') or []), sorted(set(ck) ^ set(exp_ids))[:4]))
    for pid, m in emap.items():
        diff = []
        for k, (st, by) in m.items():
            c = ck.get('%s@%s' % (k, pid)) or {}
            if c.get('status') != st or (by is not None and c.get('blockedBy') != by):
                diff.append((k, 'want %s%s' % (st, '/' + by if by else ''), 'got %s/%s' % (c.get('status'), c.get('blockedBy'))))
        chk('%s: all 22 statuses as expected' % pid, not diff, diff[:6])
    got = tally(dict((pid, dict((k, ((ck.get('%s@%s' % (k, pid)) or {}).get('status'), None)) for k in KEYS)) for pid in emap))
    chk('totals %d passed / %d in progress / %d blocked / %d failed' % sc['counts'], got == sc['counts'], got)
    for pid, m in emap.items():
        notes = [(k, (ck.get('%s@%s' % (k, pid)) or {}).get('note')) for k, (st, _b) in m.items() if st in ('failed', 'in-progress', 'blocked')]
        if any(not n for _k, n in notes):
            chk('%s: every non-passed check carries a note' % pid, False, [k for k, n in notes if not n][:6])
            break
    else:
        chk('every Failed / In Progress / Blocked check carries a note', True)
    src = rec.get('sources') or {}
    chk('sources.mailtrap is %s' % sc['mailtrap'], (src.get('mailtrap') or {}).get('state') == sc['mailtrap'], src.get('mailtrap'))
    chk('sources.doc is %s' % sc['doc_state'], (src.get('doc') or {}).get('state') == sc['doc_state'], src.get('doc'))
    eoa = src.get('eoa') or []
    chk('sources.eoa lists %d link(s)%s' % (sc['eoa_links'], ', each ok' if sc['eoa_links'] else ''), len(eoa) == sc['eoa_links'] and all(e.get('state') == 'ok' for e in eoa), eoa)
    chk('proofs: four, ids as the fixture, state %s' % sc['proof_state'],
        [p.get('id') for p in rec.get('proofs') or []] == [pid for pid in emap] and all(p.get('state') == sc['proof_state'] for p in rec.get('proofs') or []),
        [(p.get('id'), p.get('state')) for p in rec.get('proofs') or []])
    chk('%d EoA renders in the record' % sc['renders'], len(rec.get('renders') or []) == sc['renders'], len(rec.get('renders') or []))
    chk('renders are JPEG data URLs', all(re.match(r'^data:image/jpeg;base64,[A-Za-z0-9+/=]+$', r.get('img') or '') for r in rec.get('renders') or []))
    # request counts
    chk('EoA list pages: %d worker fetch(es)' % sc['eoa_links'], len([e for e in reqs if e['kind'] == 'eoa-page' and e['dest'] != 'document']) == sc['eoa_links'] if sc['eoa_links'] else not [e for e in reqs if e['kind'] in ('eoa-page', 'eoa-img')],
        [(e['kind'], e['dest']) for e in reqs if e['kind'] in ('eoa-page', 'eoa-img')][:4])
    if sc['renders']:
        imgs = [e for e in reqs if e['kind'] == 'eoa-img']
        chk('at least %d EoA image requests (one per client image)' % sc['renders'], len(imgs) >= sc['renders'], len(imgs))
    chk('%d Google Docs fetch(es)' % sc['docs'], len([e for e in reqs if e['kind'] == 'docs']) == sc['docs'], len([e for e in reqs if e['kind'] == 'docs']))
    msg_ids = set(re.search(r'/messages/(\d+)', e['path']).group(1) for e in reqs if e['kind'] == 'mt-msg')
    if sc['mailtrap'] == 'ok':
        chk('every proof message was read from the Mailtrap API', msg_ids == set(m for _p, _s, _v, m in proof_list(g.fx, sc['ticket'])), sorted(msg_ids))
    else:
        chk('no message was read (the tab could not sign in / the account does not own the sandbox)', not msg_ids, sorted(msg_ids))
    # badge, headings, notTested in the report
    text = res.get('report_text') or ''
    chk('the report says %s' % sc['badge'], sc['badge'] in text, [l for l in text.split('\n') if l.strip().isupper()][:4])
    pos = heading_positions(text)
    if name == 'clean':
        chk('the report shows the eleven sub-headings in order', all(p >= 0 for p in pos) and pos == sorted(pos), list(zip(HEADINGS, pos)))
    else:
        found = [p for p in pos if p >= 0]
        chk('the report\'s sub-headings that are present keep the plan order', found == sorted(found) and len(found) >= 1, list(zip(HEADINGS, pos)))
    # Mailtrap not-ok: the Mailtrap sentence in the status line and in the problems
    if sc['d4']:
        sentence = D4[sc['d4']].replace('{sb}', g.fx['sandbox'])
        chk('the D4 sentence for %s is in the status line' % sc['mailtrap'], sentence in (res.get('status') or '') or sentence in (res.get('panel_text') or ''), (res.get('status') or '')[:200])
        probs = (res.get('report') or {}).get('problems') or []
        chk('and in Run Diagnostics as an error', any(p.get('severity') == 'error' and sentence in (p.get('detail') or '') for p in probs), [(p.get('severity'), p.get('where')) for p in probs])
    else:
        probs = (res.get('report') or {}).get('problems') or []
        chk('Run Diagnostics holds no error', not [p for p in probs if p.get('severity') == 'error'], [(p.get('severity'), p.get('where'), (p.get('detail') or '')[:80]) for p in probs if p.get('severity') == 'error'])
        note('run diagnostics: ' + json.dumps([(p.get('severity'), p.get('where')) for p in probs]))
    if sc.get('prefill'):
        pf = res.get('prefill') or {}
        chk('the panel pre-filled the suggested rules (UTMs %s; segment paths %s)' % (sc['prefill']['utm'], json.dumps(sc['prefill']['seg'])),
            pf.get('utm') == sc['prefill']['utm'] and (pf.get('seg') or {}) == sc['prefill']['seg'], pf)
    if sc.get('settings'):
        check_settings(rec, sc['settings'])


def check_settings(rec, want):
    """rec.settings against the scenario's expectation: value, source and commentId per rule (None = not asserted)."""
    st = rec.get('settings') or {}
    chk('settings.profileId is %s' % want.get('profileId'), st.get('profileId') == want.get('profileId'), st.get('profileId'))
    if 'utmRule' in want:
        v, s, c = want['utmRule']
        r = st.get('utmRule') or {}
        chk('settings.utmRule = %s from the %s%s' % (v, s, ' (comment %s)' % c if c else ''), r.get('value') == v and r.get('source') == s and (c is None or str(r.get('commentId')) == c), r)
    for seg, (v, s, c) in (want.get('segmentPaths') or {}).items():
        r = (st.get('segmentPaths') or {}).get(seg) or {}
        # an empty path is not recorded at all (ecNewRecord keeps only rules with a value), so "" means absent
        chk('settings.segmentPaths[%s] = "%s"%s' % (seg, v, ' (%s)' % s if s else ''), (r.get('value') or '') == v and (s is None or r.get('source') == s) and (c is None or str(r.get('commentId')) == c), r)
    if 'onlyIn' in want:
        o = st.get('onlyIn')
        if want['onlyIn'] is None:
            chk('settings.onlyIn is null (no "Only in" comment)', o is None, o)
        else:
            exp, c = want['onlyIn']
            chk('settings.onlyIn = %s (comment %s)' % (json.dumps(exp), c), isinstance(o, dict) and o.get('expect') == exp and str(o.get('commentId')) == c, o)


# ── Per-scenario extras: what each scenario shows beyond the shared and table-driven checks ──
# Pure reads of rec / res / reqs and the fixtures. The note wording is the extension's: a substring that the built code does
# not print is a FAIL, which is a finding for the integration pass, never an edit here.

def pids(g, ticket):
    """The proof ids of a fixture ticket, in fixture order (`<segment>-<variation>`)."""
    return [pid for pid, _seg, _var, _mid in proof_list(g.fx, ticket)]


def proof_rows(g, ticket):
    """[(proofId, variation, messageId)] of a fixture ticket, in fixture order."""
    return [(pid, var, mid) for pid, _seg, var, mid in proof_list(g.fx, ticket)]


def proof_of(rec, pid):
    return next((p for p in rec.get('proofs') or [] if p.get('id') == pid), {})


def check_of(rec, cid):
    return by_id(rec).get(cid) or {}


def norm_text(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def report_part(text, title):
    """The report lines under heading `title`, from the heading to the next of HEADINGS; '' when the heading is absent."""
    lines = (text or '').split('\n')
    pos = heading_positions(text)
    k = HEADINGS.index(title)
    if pos[k] < 0:
        return ''
    end = min([p for p in pos if p > pos[k]] or [len(lines)])
    return '\n'.join(lines[pos[k] + 1:end])


def doc_email_number(doc):
    """The number of a copy doc's one `Email N` heading. A doc with no such heading is one email (ecParseDoc's rule, pinned by
    email-check.test.js: "a document with no Email heading is one email"): 1. None when the headings are ambiguous."""
    nums = []
    for el in (doc.get('body') or {}).get('content') or []:
        p = el.get('paragraph') or {}
        if not str((p.get('paragraphStyle') or {}).get('namedStyleType') or '').startswith('HEADING_'):
            continue
        t = ''.join(((e.get('textRun') or {}).get('content') or '') for e in p.get('elements') or []).strip()
        m = re.match(r'^email\s*(\d+)\b', t, re.I)
        if m:
            nums.append(int(m.group(1)))
    return nums[0] if len(nums) == 1 else (1 if not nums else None)


def extras_clean(g, sc, res, reqs):
    rec = res.get('rec') or {}
    links = rec.get('links') or []
    doc = (rec.get('sources') or {}).get('doc') or {}
    chk('sources.doc.title is the EX-2 copy doc\'s title', doc.get('title') == g.fx['doc-ex2']['title'], doc.get('title'))
    want = doc_email_number(g.fx['doc-ex2'])
    chk('sources.doc.chosen is %s, the one email of the EX-2 doc (not null)' % want, want is not None and doc.get('chosen') == want, doc.get('chosen'))
    lids = fs.expected_pardot_linkids(g.fx, 'EX-2')

    def resolved(lid):
        return any(l.get('linkId') == lid and l.get('pardotStatus') == 200 and (l.get('dest') or {}).get('origin') == 'https://www.example.org'
                   and l.get('destStatus') == 200 and not l.get('error') for l in links)
    miss = [lid for lid in lids if not resolved(lid)]
    chk('each of the %d distinct Pardot linkIds has a link: Pardot 200, destination https://www.example.org, destination 200, no error' % len(lids),
        not miss, miss[:6])
    guarded = []
    for pid, _var, mid in proof_rows(g, 'EX-2'):
        for href, text, alt in fs.anchors_of(fs.decoded_html(g.fx['messages'][mid]['proof'])):
            if re.match(r'^https?://[^/]+/(webmail|unsubscribeConfirm)/', href):
                guarded.append((pid, norm_text(text or alt)))
    bad = []
    for pid, label in guarded:
        ls = [l for l in links if l.get('proofId') == pid and label in (l.get('labels') or [])]
        if not any(l.get('guard') and l.get('dest') is None for l in ls):
            bad.append((pid, label))
    chk('each /webmail/ and /unsubscribeConfirm/ anchor (%d in the four proofs) is a link with a non-empty guard and no destination' % len(guarded),
        bool(guarded) and not bad, bad[:4])
    subj = check_of(rec, 'subject@regular-donors-v0')
    fyi = subj.get('fyi') or ''
    chk('subject@regular-donors-v0 is Passed, its note names the matched copy doc option (option 1 of 2) and its fyi says it is the doc\'s bold (primary) one',
        subj.get('status') == 'passed' and re.search(r'option 1 of 2', subj.get('note') or '', re.I) is not None and re.search(r'option 1 of 2', fyi, re.I) is not None
        and re.search(r'\b(bold|primary)\b', fyi, re.I) is not None, (subj.get('status'), subj.get('note'), fyi[:200]))
    long = [c.get('id') for c in rec.get('checks') or [] if len(c.get('note') or '') > 400]
    chk('no check has a note over 400 characters', not long, long[:6])


def extras_ex_1(g, sc, res, reqs):
    rec = res.get('rec') or {}
    files = ['image_1200x800_story_hero_v1.jpg', 'image_1200x468_story_stat.jpg', "See What's in the Van"]
    for pid in ('regular-donors-v1', 'major-donors-v1'):
        note = check_of(rec, 'altTags@' + pid).get('note') or ''
        chk('altTags@%s names the v1 hero file, the stat file and the CTA label "See What\'s in the Van" (straight apostrophe)' % pid,
            all(f in note for f in files), [f for f in files if f not in note] or note[:200])
    for pid in ('regular-donors-v0', 'major-donors-v0'):
        c = check_of(rec, 'altTags@' + pid)
        chk('altTags@%s is In Progress' % pid, c.get('status') == 'in-progress', c.get('status'))
    cbad = []
    for pid in pids(g, 'EX-1'):
        c = check_of(rec, 'conditional@' + pid)
        if c.get('status') != 'in-progress' or not re.search(r'No DONATE path is stated for segment', c.get('note') or ''):
            cbad.append(pid)
    chk('conditional is In Progress on all four proofs, and each note says no DONATE path is stated for the segment', not cbad, cbad)
    ubad = [pid for pid in pids(g, 'EX-1') if check_of(rec, 'utms@' + pid).get('status') != 'passed']
    chk('utms is Passed on all four proofs', not ubad, ubad)
    rule = (rec.get('settings') or {}).get('utmRule') or {}
    chk('settings.utmRule.value is identical', rule.get('value') == 'identical', rule)


def extras_wrong_segment(g, sc, res, reqs):
    rec = res.get('rec') or {}
    for pid in ('regular-donors-v0', 'regular-donors-v1'):
        note = check_of(rec, 'conditional@' + pid).get('note') or ''
        chk('conditional@%s names the rule give-regular, says it came from the tester, and names the path the DONATE link reaches (/give/seed-kits/)' % pid,
            'give-regular' in note and re.search(r'tester', note, re.I) is not None and '/give/seed-kits/' in note, note[:200])
    for pid in ('major-donors-v0', 'major-donors-v1'):
        c = check_of(rec, 'conditional@' + pid)
        chk('conditional@%s is Passed (the Major rule is not the one the tester set)' % pid, c.get('status') == 'passed', c.get('status'))
    sp = (rec.get('settings') or {}).get('segmentPaths') or {}
    reg, maj = sp.get('Regular Donors') or {}, sp.get('Major Donors') or {}
    chk('settings.segmentPaths["Regular Donors"] is give-regular, from the tester', reg.get('value') == 'give-regular' and reg.get('source') == 'tester', reg)
    chk('settings.segmentPaths["Major Donors"] is seed-kits-major, suggested', maj.get('value') == 'seed-kits-major' and maj.get('source') == 'suggested', maj)


TOKEN = '{{{dynamic_content_101}}}'


def extras_token(g, sc, res, reqs):
    rec = res.get('rec') or {}
    raw = check_of(rec, 'rawTokens@regular-donors-v0').get('note') or ''
    chk('rawTokens@regular-donors-v0 quotes %s and names the text part' % TOKEN, TOKEN in raw and re.search(r'text part', raw, re.I) is not None, raw[:200])
    cond = check_of(rec, 'conditional@regular-donors-v0').get('note') or ''
    chk('conditional@regular-donors-v0 mentions dynamic_content_', 'dynamic_content_' in cond, cond[:200])
    others = [p for p in pids(g, 'EX-2') if p != 'regular-donors-v0']
    quiet = [p for p in others if check_of(rec, 'rawTokens@' + p).get('status') != 'passed' or 'dynamic_content' in (check_of(rec, 'rawTokens@' + p).get('note') or '')]
    chk('rawTokens is Passed on the other three proofs, and no note of theirs mentions the token', not quiet, quiet)
    toks = (proof_of(rec, 'regular-donors-v0').get('facts') or {}).get('tokens') or []
    chk('facts.tokens of regular-donors-v0 holds the token', any('dynamic_content_101' in (t.get('token') or '') for t in toks), toks)
    filled = [p for p in others if (proof_of(rec, p).get('facts') or {}).get('tokens')]
    chk('the other three proofs have an empty facts.tokens', not filled, filled)

    def html_derived(p):
        return json.dumps(dict((k, v) for k, v in (proof_of(rec, p).get('facts') or {}).items() if k not in ('tokens', 'txtLines')))
    leak = [p for p in others if 'dynamic_content_101' in html_derived(p)]
    chk('the token string appears in no other proof\'s html-derived facts', not leak, leak)


def extras_no_eoa(g, sc, res, reqs):
    rec = res.get('rec') or {}
    bad = []
    for pid in pids(g, 'EX-2'):
        var = proof_of(rec, pid).get('variation') or ''
        for k in VISUAL:
            c = check_of(rec, '%s@%s' % (k, pid))
            note = c.get('note') or ''
            if c.get('status') != 'blocked' or c.get('blockedBy') != 'eoa' or 'Email on Acid' not in note or not (var and re.search(r'\b%s\b' % re.escape(var), note, re.I)):
                bad.append('%s@%s' % (k, pid))
    chk('the 16 visual/dark checks are Blocked(eoa), and each note names Email on Acid and the proof\'s variation', not bad, bad[:6])
    src = rec.get('sources') or {}
    chk('sources.eoa is [] and rec.renders is []', src.get('eoa') == [] and rec.get('renders') == [], (src.get('eoa'), len(rec.get('renders') or [])))
    sec = report_part(res.get('report_text'), 'Email on Acid')
    chk('the report\'s Email on Acid section says there is no Email on Acid link', 'no email on acid link' in sec.lower(), sec[:200])


def extras_signed_out(g, sc, res, reqs):
    rec = res.get('rec') or {}
    signin = [e for e in reqs if e['kind'] == 'mt-web' and e['path'] == '/signin']
    chk('exactly one /signin request (the Mailtrap tab was sent to the sign-in page once)', len(signin) == 1, [e['path'] for e in signin])
    d4 = D4['signed-out']
    bad = []
    for pid in pids(g, 'EX-2'):
        for k in NON_VISUAL:
            if d4 not in (check_of(rec, '%s@%s' % (k, pid)).get('note') or ''):
                bad.append('%s@%s' % (k, pid))
    chk('the 18 non-visual checks of each proof carry the D4 signed-out sentence in their note', not bad, bad[:6])
    counts = dict((e.get('variation'), len(e.get('clients') or [])) for e in (rec.get('sources') or {}).get('eoa') or [])
    bad = []
    for pid in pids(g, 'EX-2'):
        var = proof_of(rec, pid).get('variation')
        for k in VISUAL:
            c = check_of(rec, '%s@%s' % (k, pid))
            if c.get('status') != 'in-progress' or str(counts.get(var)) not in (c.get('note') or ''):
                bad.append('%s@%s' % (k, pid))
    chk('the four visual/dark checks of each proof are In Progress, with a note quoting the client count of its Email on Acid list in sources.eoa',
        not bad, bad[:6])
    txt = res.get('report_text') or ''
    chk('the report\'s Blocked section holds the D4 signed-out sentence', d4 in report_part(txt, 'Blocked'), report_part(txt, 'Blocked')[:200])
    hay = ' '.join([txt, res.get('status') or '', res.get('panel_text') or '']).lower()
    chk('no text in the report, status or panel mentions Cloudflare or a browser check (the challenge was never served)',
        'cloudflare' not in hay and 'browser check' not in hay, [w for w in ('cloudflare', 'browser check') if w in hay])
    doc = (rec.get('sources') or {}).get('doc') or {}
    eoa = (rec.get('sources') or {}).get('eoa') or []
    chk('the copy doc and both Email on Acid sources are ok', doc.get('state') == 'ok' and len(eoa) == 2 and all(e.get('state') == 'ok' for e in eoa),
        (doc.get('state'), [e.get('state') for e in eoa]))


def extras_personal(g, sc, res, reqs):
    rec = res.get('rec') or {}
    sb = g.fx['sandbox']
    acc = [e for e in reqs if e['kind'] == 'mt-api' and e['path'] == '/api/accounts']
    chk('exactly one /api/accounts request (kind mt-api)', len(acc) == 1, [(e['kind'], e['path']) for e in reqs if e['path'].startswith('/api/accounts')][:4])
    a222 = [e['path'] for e in reqs if e['path'].startswith('/api/accounts/222/')]
    chk('no request under /api/accounts/222/ (222 was never listed, so it was never probed)', not a222, a222[:3])
    p111 = [e['status'] for e in reqs if e['path'] == '/api/accounts/111/inboxes/%s' % sb]
    chk('the one listed account (111) was probed for sandbox %s and answered 404' % sb, p111 == [404], p111)
    d4 = D4['no-account'].replace('{sb}', sb)
    bad = []
    for pid in pids(g, 'EX-2'):
        for k in NON_VISUAL:
            if d4 not in (check_of(rec, '%s@%s' % (k, pid)).get('note') or ''):
                bad.append('%s@%s' % (k, pid))
    chk('the 18 non-visual checks of each proof carry the D4 no-account sentence, with sandbox %s' % sb, not bad, bad[:6])


def extras_no_doc(g, sc, res, reqs):
    rec = res.get('rec') or {}
    chk('rec.doc is null (no copy doc was read)', rec.get('doc') is None, rec.get('doc'))
    bad = []
    for pid in pids(g, 'EX-2'):
        for k in SPEC_ROWS:
            c = check_of(rec, '%s@%s' % (k, pid))
            if c.get('status') != 'in-progress' or 'no copy doc' not in (c.get('note') or '').lower():
                bad.append('%s@%s' % (k, pid))
    chk('the seven copy-doc checks are In Progress on every proof, and each note says there is no copy doc', not bad, bad[:6])
    sp = []
    for pid in pids(g, 'EX-2'):
        c = check_of(rec, 'senderSpelling@' + pid)
        if c.get('status') != 'passed' or 'Example Relief' not in (c.get('note') or '') + ' ' + (c.get('fyi') or ''):
            sp.append(pid)
    chk('senderSpelling is Passed on every proof, and its note says the sender is Example Relief, the profile\'s organisation name', not sp, sp)
    other = ['%s@%s' % (k, pid) for k in ('links', 'utms', 'conditional') for pid in pids(g, 'EX-2') if check_of(rec, '%s@%s' % (k, pid)).get('status') != 'passed']
    chk('links, utms and conditional are Passed on every proof', not other, other[:6])
    dbg = (res.get('report') or {}).get('emailCheck') or {}
    dbg_doc = (dbg.get('sources') or {}).get('doc') or {}
    chk('the debug section records the copy doc as no-link', dbg_doc.get('state') == 'no-link', dbg_doc)
    needs = report_part(res.get('report_text'), 'Needs a person')
    chk('the report\'s Needs a person section names the missing copy doc', 'no copy doc' in needs.lower(), needs[:200])




EXTRAS = {'clean': extras_clean, 'ex-1': extras_ex_1, 'wrong-segment': extras_wrong_segment, 'token': extras_token,
          'no-eoa': extras_no_eoa, 'signed-out': extras_signed_out, 'personal': extras_personal, 'no-doc': extras_no_doc}


def run_scenario(g, name):
    sc = SCENARIOS[name]
    print('%s: %s' % (name, sc['what']))
    g.svc.reset(**scenario_cfg(g.fx, sc))
    g.set_mt_cookie(sc['cookie'])
    ctx = g.build_context(sc)
    chk('the panel\'s Initialize helpers parsed 4 distinct Mailtrap proofs from the Jira fixture', len(set(p['url'] for p in ctx['emailProofs'])) == 4, ctx['emailProofs'])
    chk('and %d Email on Acid link(s)' % (2 if sc['eoa'] else 0), len(set(e['url'] for e in ctx['emailEoa'])) == (2 if sc['eoa'] else 0), ctx['emailEoa'])
    chk('and the ticket\'s comments (%d)' % len(g.fx['jira'][sc['ticket']]['fields']['comment']['comments']), len(ctx['comments']) == len(g.fx['jira'][sc['ticket']]['fields']['comment']['comments']), len(ctx['comments']))
    if sc['doc'] == 'jira':
        chk('EX-1\'s Copy File field names the EX-1 copy doc', (ctx['copyFileUrl'] or '').find(g.fx['doc-ex1']['documentId']) >= 0, ctx['copyFileUrl'])
    mark = g.svc.mark()
    res = g.run_emailcheck(ctx, sc)
    reqs = g.svc.since(mark)
    dump(name, res, reqs)
    shared_assertions(g, name, sc, res, reqs)
    if res.get('settled') == 'record':
        expectations(g, name, sc, res, reqs)
        EXTRAS[name](g, sc, res, reqs)
    return res


# ══ Selftest (no Chrome) and smoke (Chrome, no extension) ═══════════════════════════════════════════════

def selftest():
    print('selftest: the scenario table against the fixtures and the code')
    fx = fs.load_fixtures()
    chk('eight scenarios, in the plan order', list(SCENARIOS) == ['clean', 'ex-1', 'wrong-segment', 'token', 'no-eoa', 'signed-out', 'personal', 'no-doc'], list(SCENARIOS))
    chk('the 22 keys are distinct', len(set(KEYS)) == 22 and len(KEYS) == 22)
    ec = ec_row_keys()
    chk('EC_ROWS can be read from email-check.js', ec is not None)
    if ec is not None:
        chk('KEYS equals EC_ROWS in email-check.js, in order', ec == KEYS, [k for k in ec if k not in KEYS] + [k for k in KEYS if k not in ec])
    for name, sc in SCENARIOS.items():
        emap = expected_map(fx, sc)
        chk('%s: the derived table tallies to the plan\'s counts %s' % (name, sc['counts']), tally(emap) == sc['counts'], tally(emap))
        chk('%s: %d proofs x 22 keys = 88' % (name, len(emap)), sum(len(m) for m in emap.values()) == 88, len(emap))
        chk('%s: the totals add to 88' % name, sum(sc['counts']) == 88, sc['counts'])
        sel_ok = all(any(selects(ch[0], pid, seg, var) for pid, seg, var, _m in proof_list(fx, sc['ticket'])) for ch in sc['changes'])
        chk('%s: every change selector matches a proof' % name, sel_ok)
        cfg = scenario_cfg(fx, sc)
        chk('%s: the services cfg is valid' % name, all(k in fs.DEFAULT_CFG for k in cfg), cfg)
    chk('clean: Appendix C.1 per proof: 16 Passed + 6 In Progress', all(sum(1 for s, _b in m.values() if s == 'passed') == 16 for m in expected_map(fx, SCENARIOS['clean']).values()))
    chk('token: only regular-donors-v0 differs from clean', [pid for pid, m in expected_map(fx, SCENARIOS['token']).items() if m != expected_map(fx, SCENARIOS['clean'])[pid]] == ['regular-donors-v0'])
    chk('ex-1: altTags Failed only on the v1 proofs', [pid for pid, m in expected_map(fx, SCENARIOS['ex-1']).items() if m['altTags'][0] == 'failed'] == ['regular-donors-v1', 'major-donors-v1'])
    chk('signed-out: 18 Blocked(mailtrap) + 4 In Progress per proof', all(sum(1 for s, b in m.values() if (s, b) == ('blocked', 'mailtrap')) == 18 and sum(1 for s, _b in m.values() if s == 'in-progress') == 4
                                                                         for m in expected_map(fx, SCENARIOS['signed-out']).values()))
    chk('proof ids are the plan\'s <segment>-<variation>', [p[0] for p in proof_list(fx, 'EX-2')] == ['regular-donors-v0', 'regular-donors-v1', 'major-donors-v0', 'major-donors-v1'], [p[0] for p in proof_list(fx, 'EX-2')])
    chk('EX-2 has no Copy File in its Jira fixture; EX-1 names the EX-1 doc', copy_file_from_jira(fx, 'EX-2') is None and fx['doc-ex1']['documentId'] in (copy_file_from_jira(fx, 'EX-1') or ''), copy_file_from_jira(fx, 'EX-1'))
    chk('the EX-2 doc url the gate gives its context carries the EX-2 doc id', fx['doc-ex2']['documentId'] in doc_url(fx, 'ex2', 'EX-2'))
    chk('the six mapped hosts are the plan\'s', sorted(ORIGIN_HOSTS) == sorted(['mailtrap.io', 'marketing.example.org', 'www.example.org', 'app.emailonacid.com', 'images.emailonacid.com', 'docs.googleapis.com']))
    chk('the record keys are 19', len(RECORD_KEYS) == 19 and len(set(RECORD_KEYS)) == 19)
    chk('every extras function is registered for a scenario', sorted(EXTRAS) == sorted(SCENARIOS))
    try:
        with open(os.path.join(EXT, 'email-check.js'), 'r', encoding='utf-8') as fh:
            src = fh.read()
        for k, v in D4.items():
            chk('D4 "%s" is verbatim in email-check.js (EC_MAILTRAP_MSG)' % k, v.replace(fx['sandbox'], '{sb}') in src or v in src, v[:60])
    except Exception as e:
        chk('email-check.js can be read for the D4 cross-check', False, str(e))
    chk('forbidden strings are plain strings and include the prospect id, hash, hex tail and inbox domain', all(isinstance(s, str) and s for s in FORBIDDEN) and '2000000002' in FORBIDDEN and 'SynthHash0' in FORBIDDEN and '@inbox.mailtrap.io' in FORBIDDEN)
    for s in FORBIDDEN:         # the fixtures really do carry each carrier (a forbidden string nothing could leak is a dead check)
        blob = json.dumps(fx['proofs']) + json.dumps(fx['interstitials'])
        chk('the synthetic fixtures carry %s (so its absence from a record means something)' % s, s in blob, s)
    chk('heading list is the 11 of plan 1.11', len(HEADINGS) == 11)


def smoke():
    """Chrome WITHOUT the extension against the fake services: the cookie, the 302, same-origin fetch and the DNS block the gate
    relies on, and the Sec-Fetch-* headers the gate's cookie assertion reads."""
    from cdp import Browser
    print('smoke: Chrome (no extension) against the fake services')
    profile = PROFILE + '_smoke'
    shutil.rmtree(profile, ignore_errors=True)
    svc = fs.Services(0)
    b = Browser(CHROME_ARGS + ['--user-data-dir=' + profile, 'about:blank'])
    try:
        web = svc.base + '/sandboxes/7000001/messages/7100000005'
        b.send('Storage.clearCookies')
        t = b.send('Target.createTarget', {'url': web})['targetId']
        s = b.attach(t)
        b.send('Runtime.enable', session=s)

        def wait_path(p, secs=8):
            end = time.time() + secs
            while time.time() < end:
                try:
                    if b.ev(s, 'location.pathname') == p:
                        return True
                except Exception:
                    pass
                time.sleep(0.2)
            return False
        chk('no cookie: the Mailtrap message page lands on /signin', wait_path('/signin'), b.ev(s, 'location.href'))
        b.send('Storage.setCookies', {'cookies': [{'name': 'mt', 'value': '1', 'url': svc.base + '/'}]})
        b.ev(s, 'location.href = %s' % json.dumps(web))
        chk('with Storage.setCookies mt=1: the same URL stays on the message page', wait_path('/sandboxes/7000001/messages/7100000005'), b.ev(s, 'location.href'))
        st = b.ev(s, "fetch('/api/accounts', {credentials: 'same-origin'}).then(r => r.status)")
        chk('a same-origin fetch from that tab sends the cookie: /api/accounts is 200', st == 200, st)
        b.send('Storage.clearCookies')
        st = b.ev(s, "fetch('/api/accounts', {credentials: 'same-origin'}).then(r => r.status)")
        chk('after Storage.clearCookies the same fetch is 401', st == 401, st)
        b.send('Storage.setCookies', {'cookies': [{'name': 'mt', 'value': '1', 'url': svc.base + '/'}]})
        st = b.ev(s, "fetch('/api/accounts', {credentials: 'omit'}).then(r => r.status)")
        chk('credentials:omit never sends the cookie even when one is set (401)', st == 401, st)
        r = b.ev(s, "fetch('https://example.org/x', {mode: 'no-cors'}).then(() => 'reached', () => 'blocked')", timeout=40)
        chk('an unmapped real host does not resolve (--host-resolver-rules MAP * ~NOTFOUND)', r == 'blocked', r)
        r = b.ev(s, "fetch('https://marketing.example.org/e/1/x/y/1/h/z', {mode: 'no-cors'}).then(() => 'reached', () => 'blocked')", timeout=40)
        chk('and so does a Pardot host name (only the worker override may map it)', r == 'blocked', r)
        log = svc.since(0)
        doc = [e for e in log if e['kind'] == 'mt-web' and e['path'].startswith('/sandboxes/')]
        api = [e for e in log if e['kind'] == 'mt-api']
        chk('Sec-Fetch-Dest: a tab navigation is `document`, a fetch is `empty` (the gate\'s cookie assertion reads this)',
            bool(doc) and all(e['dest'] == 'document' for e in doc) and bool(api) and all(e['dest'] == 'empty' for e in api), [(e['path'], e['dest']) for e in log][:6])
        chk('the Cookie header was on the first same-origin fetch only (after the clear, and under omit, none)', [e['cookie'] for e in api] == [True, False, False], [(e['status'], e['cookie']) for e in api])
        chk('the DNS-blocked fetches never reached the server', not [e for e in log if e['path'].startswith('/e/')], [e['path'] for e in log if e['path'].startswith('/e/')])
    finally:
        b.close()
        svc.close()
        shutil.rmtree(profile, ignore_errors=True)


# ══ main ═══════════════════════════════════════════════════════════════════════════════════════════

def finish(strict=True):
    print('\n=== %d passed, %d failed, %d pending ===' % (passed, failed, len(pending)))
    for f in fails:
        print('  - FAIL ' + f)
    for p in pending:
        print('  - %s still a stub' % p)
    if failed:
        return 1
    if pending and strict:
        print('NOT COMPLETE: nothing failed, but the checks above are not implemented')
        return 3
    if strict:
        print('ALL PASSED')
    return 0


if __name__ == '__main__':
    args = sys.argv[1:]
    if '--list' in args:
        print('\n'.join(SCENARIOS))
        sys.exit(0)
    if '--selftest' in args:
        selftest()
        sys.exit(finish(strict=False))
    if '--smoke' in args:
        smoke()
        sys.exit(finish(strict=False))
    names = args or list(SCENARIOS)
    unknown = [n for n in names if n not in SCENARIOS]
    if unknown:
        sys.exit('unknown scenario(s): %s (try --list)' % ', '.join(unknown))
    if not OUT:
        OUT = tempfile.mkdtemp(prefix='selenite_emailcheck_out_')
    print('output directory: ' + OUT)
    g = Gate()
    try:
        print('extension %s loaded, panel window %s, fake services %s' % (g.ext, g.win, g.svc.base))
        for n in names:
            try:
                run_scenario(g, n)
            except Exception as e:
                chk('%s: the scenario ran to the end' % n, False, '%s: %s' % (type(e).__name__, e))
        after = tree_digest(EXT)
        chk('extension/ is byte-identical after the run (the gate wrote nothing there)', after == g.digest0, (g.digest0[:12], after[:12]))
    finally:
        g.close()
    for k, v in ALIGN_PENDING.items():
        pend(k, v)
    sys.exit(finish())
