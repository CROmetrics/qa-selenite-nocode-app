"""End-to-end gate for the two shared-kit Test Agent modes, ITW Activation and Responsiveness: the REAL Selenite extension
(this checkout) in REAL branded Chrome, driving the real panel and worker against the synthetic fixture site on 127.0.0.1
(site.py + fake-optimizely.js; plan Appendix D). Nothing here ever loads a real site, and there is no switch that lets it.

  python3 -I -u gate.py [scenario ...]       (no scenario: all ten)
  python3 -I -u gate.py --list

Scenarios (plan Appendix D.3 to D.6):
  itw          Mode 1 on the full context: every row of D.3, 12 loads, the trigger beacons, the clean-load names
  itw-bad      Control differs from PROD (a QA ribbon) and a redirect that buckets a direct visitor: the Fail rows and remedies
  itw-refused  the typed ITW link forces a variation (optimizely_x): refused, never loaded; the override is saved
  itw-covered  a cookie wall covers the trigger: it is never clicked, so no beacon of either kind
  itw-stale    a stored answer from an earlier visit is NOT cleared when its key is not listed: active on load is a Fail
  resp         Mode 5 at 320, 375 and 1280 on two variations: the clipped rows, severity, also-on-PROD, 3 tiles, the CSV
  resp-ignore  an invalid ignore selector refuses the run; a valid extra one removes the legal-line row
  resp-live    a live experiment on PROD: PROD is swept by resizing one load
  bot          a "Just a moment..." page halts each mode at its first load; nothing after it is attempted
  stop         Stop pressed during an 18-width sweep: stopped, the rest Stopped, the tab closed, nothing attached

How it works: Chrome (branded; CHROME_BIN overrides the path) is launched headless with --remote-debugging-pipe and a fresh
throwaway profile; the unpacked extension is loaded with Extensions.loadUnpacked; the panel (popup.html) is opened as a tab;
per run the active context is written to chrome.storage.local, the Test Agent is switched to the mode with Agentic Analysis OFF
(no model is ever called), the typed fields are set (dispatching input), #btn-ta-run is clicked and #ta-status is polled until
the run settles (10 minutes at most). The record (qkUiState(mode).last), the newest report (IndexedDB) and its tab's text, the
Live debug box, the Console log, the CSV, the tabs and the debugger targets are then read back.

Needs: macOS or Linux with Google Chrome 154+, python3. This never touches your everyday Chrome or its profile.
  GATE_OUT      a directory to write each scenario's record, debug box, report text and requests into (default: a temp dir)
  GATE_PROFILE  the throwaway Chrome profile directory (default: <temp dir>/selenite_modes_profile_<pid>); deleted at start and end

Do not edit anything under extension/ while a run is in progress: an MV3 worker restart re-reads its files from disk, and the
gate asserts that the sha256 tree of extension/ is the same at the end as at the start.
"""
import hashlib, importlib.util, json, os, re, shutil, sys, tempfile, time
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'browserstack-gate'))
from cdp import Browser

# site.py shares its name with the stdlib's `site` (already imported at start-up), so it is loaded by path.
_spec = importlib.util.spec_from_file_location('modes_site', os.path.join(HERE, 'site.py'))
modes_site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(modes_site)

EXT = os.path.abspath(os.path.join(HERE, '..', '..'))          # extension/, loaded unpacked
PROFILE = os.environ.get('GATE_PROFILE') or os.path.join(tempfile.gettempdir(), 'selenite_modes_profile_%d' % os.getpid())
OUT = os.environ.get('GATE_OUT')            # made on first use (a --list run creates nothing)
RUN_TIMEOUT_S = 10 * 60

IA_KEYS = ['version', 'mode', 'ts', 'startedAt', 'finishedAt', 'stopped', 'halted', 'error', 'ticketKey', 'input', 'experimentId',
           'experimentIdSource', 'refusedItw', 'activation', 'catalog', 'loads', 'obs', 'rows']
RS_KEYS = ['version', 'mode', 'ts', 'startedAt', 'finishedAt', 'stopped', 'halted', 'error', 'ticketKey', 'input', 'plan', 'loads',
           'sweep', 'tiles', 'tilesCapped', 'rows']
MODES = {
    'itw': {'key': 'itwactivation', 'prefix': 'ia', 'label': 'ITW Activation', 'keys': IA_KEYS, 'panel': 'IA_PANEL'},
    'resp': {'key': 'responsiveness', 'prefix': 'rs', 'label': 'Responsiveness', 'keys': RS_KEYS, 'panel': 'RS_PANEL'},
}
ALL_WIDTHS = '300,320,340,360,375,390,402,412,430,480,600,768,820,1024,1280,1440,1920,2080'
STATUS_OF = {'Pass': 'passed', 'Fail': 'failed', 'Needs PGM': 'in-progress', 'Not Tested': 'not-tested'}

# a forcing or tracking parameter in printed text (a stored key NAME such as optimizely_qk_bucket_7001 is not one)
FLAG_RE = re.compile(r'optimizely_x|optimizely_force_tracking|optimizely_token|_conv_eforce')
passed = failed = 0
fails = []


def chk(name, cond, detail=None):
    global passed, failed
    if cond:
        passed += 1
        print('  ok   ' + name)
    else:
        failed += 1
        fails.append(name)
        print('  FAIL ' + name + ('   -> ' + json.dumps(detail, default=str)[:500] if detail is not None else ''))


def note(msg):
    print('  ..   ' + msg)


def tree_digests(root):
    """{relative path: sha256 of its bytes} for every file under `root` (skipping __pycache__ and .DS_Store)."""
    out = {}
    for dp, dn, fn in os.walk(root):
        dn[:] = sorted(d for d in dn if d != '__pycache__')
        for f in sorted(fn):
            if f == '.DS_Store':
                continue
            p = os.path.join(dp, f)
            with open(p, 'rb') as fh:
                out[os.path.relpath(p, root)] = hashlib.sha256(fh.read()).hexdigest()
    return out


def tree_digest(digests):
    h = hashlib.sha256()
    for k in sorted(digests):
        h.update(k.encode('utf-8') + b'\0' + digests[k].encode('ascii'))
    return h.hexdigest()


# ── contexts (plan Appendix D) ─────────────────────────────────────────────────────────────────────
def base_ctx(key, exp, links, itw, **itwf):
    c = {
        'ticketKey': key, 'ticketUrl': '', 'summary': 'Modes gate', 'platform': 'Optimizely', 'experimentId': exp,
        'variants': [{'id': l['id'], 'isControl': l['id'] == 'v0', 'rawDescription': 'Control' if l['id'] == 'v0' else 'Variation'} for l in links],
        'previewLinks': links, 'itwLink': itw, 'goals': [], 'qaTestPlanUrl': None, 'softcodedTests': [], 'concurrentTests': [],
        'comments': [], 'figmaUrl': None, 'figmaNodeId': None, 'reviewed': True,
        'activationType': None, 'triggerDescription': None, 'triggerSelector': None, 'subPages': [], 'stayActivePages': [],
        'specAudiences': [], 'storedStateKeys': [], 'returningVisitor': None, 'redirectDestination': None,
    }
    c.update(itwf)
    return c


def spec_audiences():
    return [
        {'name': 'QA param', 'role': 'inclusion', 'type': 'query', 'param': 'cro_mode', 'value': 'qa', 'description': ''},
        {'name': 'No Meta', 'role': 'exclusion', 'type': 'query', 'param': 'utm_source', 'value': 'meta', 'description': ''},
        {'name': 'No Impact', 'role': 'exclusion', 'type': 'query', 'param': 'utm_campaign', 'value': 'impact', 'description': ''},
        {'name': 'Desktop Only', 'role': 'inclusion', 'type': 'device', 'param': None, 'value': 'desktop', 'description': ''},
    ]


DESKTOP_ONLY = {'name': 'Desktop Only', 'role': 'inclusion', 'type': 'device', 'param': None, 'value': 'desktop', 'description': ''}


def ctx_itw(B, key='QK-1'):
    return base_ctx(key, '7001', [
        {'id': 'v0', 'url': B + '/itw/?optimizely_x=7101&cro_mode=qa&optimizely_force_tracking=true'},
        {'id': 'v1', 'url': B + '/itw/?optimizely_x=7102&cro_mode=qa'},
    ], B + '/itw/?cro_mode=qa', activationType='trigger', triggerDescription='Clicking Start quiz', triggerSelector='#start-quiz',
        subPages=['/itw/help/'], stayActivePages=['/itw/step2/'], specAudiences=spec_audiences(), storedStateKeys=['qk_quiz_*'],
        returningVisitor='active', redirectDestination=B + '/landing-ok/')


def ctx_itw_bad(B):
    return base_ctx('QK-2', None, [{'id': 'v0', 'url': B + '/itw-bad/?optimizely_x=7101&cro_mode=qa'}], None,
                    redirectDestination=B + '/landing/')


def ctx_itw_covered(B):
    return base_ctx('QK-4', '7001', [], B + '/itw-covered/?cro_mode=qa', activationType='trigger', triggerSelector='#start-quiz',
                    returningVisitor='active', specAudiences=[DESKTOP_ONLY])


def ctx_itw_stale(B):
    return base_ctx('QK-9', '7001', [], B + '/itw/?cro_mode=qa', activationType='trigger', triggerDescription='Clicking Start quiz',
                    triggerSelector='#start-quiz', specAudiences=[DESKTOP_ONLY], storedStateKeys=[])


def ctx_itw_bot(B):
    return base_ctx('QK-5', '7001', [], B + '/blocked/?cro_mode=qa', activationType='trigger', triggerSelector='#start-quiz')


def ctx_resp(B):
    return base_ctx('QK-6', '7201', [
        {'id': 'v0', 'url': B + '/resp/?optimizely_x=7301&cro_mode=qa'},
        {'id': 'v1', 'url': B + '/resp/?optimizely_x=7302&cro_mode=qa'},
    ], B + '/resp/?cro_mode=qa')


def ctx_resp_live(B):
    return base_ctx('QK-7', '7201', [{'id': 'v1', 'url': B + '/resp-live/?optimizely_x=7302&cro_mode=qa'}], B + '/resp-live/?cro_mode=qa')


def ctx_resp_bot(B):
    return base_ctx('QK-8', None, [{'id': 'v0', 'url': B + '/blocked/?optimizely_x=7301'}], None)


# ── the browser ────────────────────────────────────────────────────────────────────────────────────
class Gate:
    def __init__(self):
        self.b = None
        self.site = None
        self.panel = None
        self.digest0 = tree_digests(EXT)
        try:
            self._start()
        except BaseException:
            self.close()
            raise

    def _start(self):
        if os.path.exists(PROFILE):
            shutil.rmtree(PROFILE)
        self.site = modes_site.Site(0)
        self.b = Browser([
            '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
            '--user-data-dir=' + PROFILE, '--no-first-run', '--no-default-browser-check',
            '--force-color-profile=srgb', '--window-size=1400,900', 'about:blank',
        ])
        self.ext = self.b.load_extension(EXT)
        w = self.b.find_target(lambda t: t['type'] == 'service_worker' and t['url'] == 'chrome-extension://%s/background.js' % self.ext)
        self.worker = self.b.attach(w['targetId'])
        for _ in range(80):                       # the worker can be listed before its bindings exist
            try:
                if self.b.ev(self.worker, "typeof chrome !== 'undefined' && typeof qkwRunMode === 'function'"):
                    break
            except Exception:
                pass
            time.sleep(0.25)
        t = self.b.send('Target.createTarget', {'url': 'chrome-extension://%s/popup.html' % self.ext})['targetId']
        self.panel_target = t
        self.panel = self.b.attach(t)
        self.b.send('Runtime.enable', session=self.panel)
        for _ in range(120):
            try:
                if self.b.ev(self.panel, "typeof TA_MODES === 'object' && !!document.getElementById('ia-body') && !!document.getElementById('rs-body') && typeof IA_PANEL === 'object' && typeof RS_PANEL === 'object' && typeof WIN_ID !== 'undefined' && WIN_ID != null"):
                    break
            except Exception:
                pass
            time.sleep(0.25)
        self.win = self.b.ev(self.panel, 'WIN_ID')

    def pev(self, expr, **kw):
        return self.b.ev(self.panel, expr, **kw)

    def close(self):
        if self.b:
            self.b.close()
        if self.site:
            self.site.close()
        shutil.rmtree(PROFILE, ignore_errors=True)

    def clear_site_data(self):
        """Every scenario starts from a visitor the fixture site has never seen (storage and cookies of its origin only)."""
        tid = None
        try:
            tid = self.b.send('Target.createTarget', {'url': self.site.base + '/fake-optimizely.js'})['targetId']
            s = self.b.attach(tid)
            left = None
            for _ in range(40):
                try:
                    left = self.b.ev(s, "document.readyState === 'complete' ? (localStorage.clear(), sessionStorage.clear(), localStorage.length) : null")
                except Exception:
                    left = None
                if left is not None:
                    break
                time.sleep(0.25)
            if left != 0:
                note('could not clear the fixture origin (%r)' % (left,))
        except Exception as e:
            note('could not clear the fixture origin: %s' % e)
        finally:
            if tid:
                try:
                    self.b.send('Target.closeTarget', {'targetId': tid})
                except Exception:
                    pass

    def seed_stale_answer(self):
        """itw-stale: a tab on /seed/ leaves qk_quiz_progress='1' in the fixture origin's localStorage, then closes."""
        tid = self.b.send('Target.createTarget', {'url': self.site.base + '/seed/'})['targetId']
        try:
            s = self.b.attach(tid)
            val = None
            for _ in range(40):
                try:
                    val = self.b.ev(s, "document.readyState === 'complete' ? localStorage.getItem('qk_quiz_progress') : null")
                except Exception:
                    val = None
                if val:
                    break
                time.sleep(0.25)
            return val
        finally:
            try:
                self.b.send('Target.closeTarget', {'targetId': tid})
            except Exception:
                pass

    # one mode run through the real panel. typed: {field id: value} for ticket-scope fields, glob: {field id: value} for globals.
    def run_mode(self, mode, ctx, typed=None, glob=None, stop_when=None):
        m = MODES[mode]
        key = ctx['ticketKey']
        before = self.pev("(async () => { const { browserConsoleLogs = [] } = await sessionNS.get('browserConsoleLogs'); return browserConsoleLogs.reduce((n, e) => Math.max(n, e.seq || 0), 0); })()") or 0
        js = """(async () => {
          const ctx = %s, key = %s, mode = %s, typed = %s, glob = %s, cfg = %s;
          await chrome.storage.local.set({ initContexts: { [key]: ctx }, activeInitContext: key });
          showTab('testagent');
          const sel = document.getElementById('ta-primary-select');
          sel.value = mode; sel.dispatchEvent(new Event('change', { bubbles: true }));
          for (let i = 0; i < 100 && qkUiState(mode).loadedFor !== key; i++) await new Promise(r => setTimeout(r, 50));
          if (qkUiState(mode).loadedFor !== key) return 'the ' + mode + ' card did not load the overrides of ' + key;
          const slot = document.getElementById('ta-settings-slot'), body = document.getElementById(cfg.prefix + '-body');
          if (!(slot && body && slot.contains(body))) return cfg.prefix + '-body is not in #ta-settings-slot';
          const an = document.getElementById('ta-agentic-analysis');
          an.checked = false; an.dispatchEvent(new Event('change', { bubbles: true }));
          const set = (id, v) => { const e = document.getElementById(id); if (!e) throw new Error('no element #' + id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
          cfg.fields.filter(f => f.scope === 'ticket').forEach(f => set(f.id, typed[f.id] != null ? typed[f.id] : ''));
          Object.keys(glob).forEach(id => set(id, glob[id]));
          document.getElementById('ta-status').textContent = '';
          document.getElementById('btn-ta-run').click();
          return true;
        })()""" % (json.dumps(ctx), json.dumps(key), json.dumps(m['key']), json.dumps(typed or {}), json.dumps(glob or {}),
                   m['panel'])
        t0 = time.time()
        mark = self.site.mark()
        out_t0_ms = int(t0 * 1000)
        shown = self.pev(js)
        chk('%s: the %s card was shown with its body in the slot, fields set and the run started' % (mode, m['label']), shown is True, shown)
        if shown is not True:
            raise RuntimeError('%s was not started: %s' % (m['label'], shown))
        last, mid, stopped_at = '', [], None
        dbg_js = "(() => { const o = document.getElementById('%s-debug-out'); return o ? o.innerText : null; })()" % m['prefix']
        end = t0 + RUN_TIMEOUT_S
        while time.time() < end:
            time.sleep(1.5 if stop_when else 2)
            s = self.pev("document.getElementById('ta-status').textContent") or ''
            last = s
            if s.startswith('Done') or re.search(r' failed: ', s) or s.startswith('The report could not') or 'could not' in s:
                break
            if stop_when and stopped_at is None and stop_when(self.site.since(mark)):
                stopped_at = self.site.since(mark)
                self.pev("document.getElementById('btn-ta-stop').click()")
            d = self.pev(dbg_js) or ''
            ls = [x for x in d.split('\n') if x.strip()]
            mid.append((sum(1 for x in ls if '  worker  ' in x), len(ls), 'Results shown below' in d))
        else:
            raise TimeoutError('%s did not settle in %d s (status: %s)' % (m['label'], RUN_TIMEOUT_S, last))
        out = {'t0_ms': out_t0_ms, 'status': last, 'seconds': round(time.time() - t0, 1), 'mid': mid, 'stopped_at': stopped_at, 'mode': mode}
        out['reqs'] = self.site.since(mark)
        out['debug_text'] = self.pev(dbg_js) or ''
        out['rec'] = json.loads(self.pev('JSON.stringify(qkUiState(%s).last)' % json.dumps(m['key'])) or 'null')
        out['counts_line'] = self.pev('(() => { const r = qkUiState(%s).last; return r ? qkCountsLine(qkCounts(r.rows)) : null; })()' % json.dumps(m['key']))
        out['badge'] = self.pev('(() => { const r = qkUiState(%s).last; return r ? qkBadge(r.rows, r.stopped, r.halted).label : null; })()' % json.dumps(m['key']))
        out['fresh'] = self.pev('(() => { const r = qkUiState(%s).last; return r ? qkFreshCount(r.loads) : null; })()' % json.dumps(m['key']))
        out['csv'] = self.pev('(() => { const r = qkUiState(%s).last; return r ? qkCsv(%s.columns, r.rows) : null; })()' % (json.dumps(m['key']), m['panel']))
        out['results_html'] = self.pev("(document.getElementById('%s-results') || {}).innerHTML || ''" % m['prefix'])
        out['console'] = self.pev("""(async () => {
          const { browserConsoleLogs = [] } = await sessionNS.get('browserConsoleLogs');
          return browserConsoleLogs.filter(e => (e.seq || 0) > %d && e.source === 'selenite-mode');
        })()""" % int(before))
        out['report'] = None
        out['report_text'] = None
        if out['status'].startswith('Done'):
            rep = self.pev("""(async () => {
              const keys = (await idbReq((await idb()).transaction('reports').objectStore('reports').getAllKeys())).sort();
              const k = keys[keys.length - 1];
              if (!k) return null;
              const r = await idbGet('reports', k);
              return { key: k, debug: r.debugLog && r.debugLog[%s], problems: r.debugLog && r.debugLog.problems, bodyHtml: r.bodyHtml };
            })()""" % json.dumps({'itw': 'itwActivation', 'resp': 'responsiveness'}[mode]))
            out['report'] = rep
            if rep:
                try:
                    tgt = self.b.find_target(lambda t: t['type'] == 'page' and ('qa-report.html?k=' + rep['key']) in t['url'], timeout=8)
                    rs = self.b.attach(tgt['targetId'])
                    txt = ''
                    for _ in range(40):
                        txt = self.b.ev(rs, 'document.body.innerText') or ''
                        if 'Selenite QA Report' in txt:
                            break
                        time.sleep(0.25)
                    out['report_text'] = txt
                except Exception as e:
                    out['report_text_error'] = str(e)
        out['tabs'] = self.pev('(async () => (await chrome.tabs.query({})).map(t => t.url || t.pendingUrl || ""))()')
        out['dbg_targets'] = self.pev('(async () => (await chrome.debugger.getTargets()).map(t => ({ url: t.url, attached: !!t.attached, type: t.type })))()')
        return out


def dump(name, res):
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    json.dump(res.get('rec'), open(os.path.join(d, 'record.json'), 'w'), indent=1)
    json.dump({'status': res['status'], 'seconds': res['seconds'], 'badge': res.get('badge'), 'counts': res.get('counts_line'),
               'console': res.get('console'), 'tabs': res.get('tabs'), 'dbg_targets': res.get('dbg_targets'),
               'problems': (res.get('report') or {}).get('problems'), 'reqs': res.get('reqs')},
              open(os.path.join(d, 'debug.json'), 'w'), indent=1)
    open(os.path.join(d, 'report.txt'), 'w').write(res.get('report_text') or '')
    open(os.path.join(d, 'live-debug.txt'), 'w').write(res.get('debug_text') or '')
    open(os.path.join(d, 'results.csv'), 'w').write(res.get('csv') or '')


# ── shared assertions ──────────────────────────────────────────────────────────────────────────────
def str_leaves(o, path=''):
    if isinstance(o, str):
        yield path, o
    elif isinstance(o, dict):
        for k, v in o.items():
            for x in str_leaves(v, path + '.' + str(k)):
                yield x
    elif isinstance(o, list):
        for i, v in enumerate(o):
            for x in str_leaves(v, path + '[%d]' % i):
                yield x


def parse_csv(text):
    """RFC 4180 with every field quoted (D13): a list of rows of cells."""
    rows, row, cell, q, i = [], [], '', False, 0
    while i < len(text):
        c = text[i]
        if q:
            if c == '"':
                if text[i + 1:i + 2] == '"':
                    cell += '"'
                    i += 1
                else:
                    q = False
            else:
                cell += c
        elif c == '"':
            q = True
        elif c == ',':
            row.append(cell)
            cell = ''
        elif c == '\r' and text[i + 1:i + 2] == '\n':
            row.append(cell)
            rows.append(row)
            row, cell = [], ''
            i += 1
        else:
            cell += c
        i += 1
    if cell or row:
        row.append(cell)
        rows.append(row)
    return rows


def by_id(rec):
    return {r['id']: r for r in (rec or {}).get('rows') or []}


def check_live_debug(res, label, ends_with_results=True):
    mid, text = res['mid'], res['debug_text']
    live = [m for m in mid if m[0] > 0 and not m[2]]
    chk('live debug: worker steps were in the box while the run was still going (when it lasted long enough to sample)',
        len(live) > 0 or res['seconds'] < 8, mid[:6])
    line = re.compile(r'^\d\d:\d\d:\d\d  \+\d+:\d\d\.\d  (?:panel |worker)  (?:WARN |ERROR )?(.*)$')
    ls = [x for x in text.split('\n') if x.strip()]
    body = [(line.match(x).group(1) if line.match(x) else '?? ' + x) for x in ls]
    chk('live debug: every line has the clock, elapsed, source, level format', not any(b.startswith('?? ') for b in body), [b for b in body if b.startswith('?? ')][:3])
    chk('live debug: the box starts with the click', bool(body) and body[0].startswith('Run clicked'), body[:1])
    if ends_with_results:
        chk('live debug: and ends with the results', bool(body) and body[-1] == 'Results shown below', body[-1:])
    chk('live debug: the worker started the %s run' % label, ('The worker started the %s run' % label) in body, body[:6])
    chk('live debug: and closed (or never opened) the run tab', any(b.startswith('Closed the run tab after ') or b.startswith('The run tab was never opened after ') for b in body))
    starts = sum(1 for b in body if b.startswith('→ L'))
    ends = sum(1 for b in body if re.match(r'^L\d+ (loaded in|did not|was stopped|ended on) ', b))
    chk('live debug: every load that started has its result line (a Stop may cut the one in flight)',
        starts > 0 and (starts == ends or (res['rec'] or {}).get('stopped') and 0 <= starts - ends <= 1), (starts, ends))
    chk('live debug: no ASCII ?, & or = in the box', not re.search(r'[?&=]', text), re.findall(r'.{0,30}[?&=].{0,30}', text)[:3])
    chk('live debug: no forcing or tracking flag in the box', not re.search(r'optimizely_force_tracking|_conv_eforce', text))
    chk('live debug: the panel does not call this worker older than itself', 'older code than this panel' not in text and 'worker is older' not in text)


def check_console(res, label):
    rec = res['rec'] or {}
    lines = res.get('console') or []
    chk('console: exactly two selenite-mode lines for the run', len(lines) == 2, [l.get('text') for l in lines])
    if len(lines) != 2:
        return
    st, en = lines
    chk('console: the start line is INFO and reads the plan', st.get('level') == 'INFO' and bool(re.match(
        r'^\[%s\] Run started · ticket \S+ · \d+ input\(s\) from the ticket, \d+ typed$' % re.escape(label), st.get('text') or '')), st)
    outcome = ('halted by a bot check on ' if rec.get('halted') else 'ended on an error' if rec.get('error')
               else 'stopped by the tester' if rec.get('stopped') else 'finished')
    level = 'ERROR' if rec.get('error') and not rec.get('halted') else 'WARNING' if (rec.get('halted') or rec.get('stopped')) else 'INFO'
    pat = r'^\[%s\] Run %s(?:/\S+)? in \d+\.\ds · (.+)$' % (re.escape(label), re.escape(outcome) + (r'\S*' if rec.get('halted') else ''))
    m = re.match(pat, en.get('text') or '')
    chk('console: the end line says "Run %s in <s>s · <counts>" at level %s' % (outcome.strip(), level), bool(m) and en.get('level') == level, en)
    chk('console: and its counts are the record\'s', bool(m) and m.group(1) == res.get('counts_line'), (en.get('text'), res.get('counts_line')))
    chk('console: the label is on each line once', all((l.get('text') or '').count('[' + label + ']') == 1 for l in lines))
    chk('console: no ASCII ?, & or = in either line', not any(re.search(r'[?&=]', l.get('text') or '') for l in lines))


def common_after_run(res, mode, ctx_key, expect_status_done=True):
    m = MODES[mode]
    rec = res.get('rec') or {}
    if expect_status_done:
        chk('%s: the run settled and the report opened' % mode, res['status'].startswith('Done'), res['status'])
    chk('%s: a record was produced' % mode, isinstance(res.get('rec'), dict))
    chk('%s: the record has exactly its %d keys' % (mode, len(m['keys'])), sorted(rec.keys()) == sorted(m['keys']), sorted(set(rec.keys()) ^ set(m['keys'])))
    chk('%s: version is 1, mode and ticket are named, ts is set' % mode,
        rec.get('version') == 1 and rec.get('mode') == m['key'] and rec.get('ticketKey') == ctx_key and isinstance(rec.get('ts'), (int, float)) and rec['ts'] > 0,
        (rec.get('version'), rec.get('mode'), rec.get('ticketKey'), rec.get('ts')))
    chk('%s: no run error' % mode, rec.get('error') is None, rec.get('error'))
    bad = [(p, s) for r in rec.get('rows') or [] for p, s in str_leaves(r) if re.search(r'[?&=]', s)]
    chk('%s: no ASCII ?, & or = in any row string' % mode, not bad, bad[:3])
    flagged = [r for r in res['reqs'] if 'optimizely_force_tracking' in r[1] or '_conv_eforce' in r[1]]
    chk('%s: no request carried optimizely_force_tracking or _conv_eforce' % mode, not flagged, flagged[:3])
    nonloop = [r for r in res['reqs'] if r[0] not in ('/itw/', '/itw-bad/', '/itw-covered/', '/itw/help/', '/itw/step2/', '/landing/',
                                                       '/landing-ok/', '/seed/', '/resp/', '/resp-live/', '/blocked/', '/beacon', '/fake-optimizely.js',
                                                       '/favicon.ico')]    # the last: Chrome's own request for a tab icon
    chk('%s: the site saw only the fixture paths' % mode, not nonloop, nonloop[:3])
    cells = [c for row in parse_csv(res.get('csv') or '') for c in row]
    chk('%s: no ASCII ?, & or = in any CSV cell' % mode, not any(re.search(r'[?&=]', c) for c in cells), [c for c in cells if re.search(r'[?&=]', c)][:3])
    tabs = res.get('tabs') or []
    chk('%s: after the run no open tab is on 127.0.0.1 (the run tab was closed)' % mode, not any('127.0.0.1' in (u or '') for u in tabs), tabs)
    att = [t for t in (res.get('dbg_targets') or []) if t.get('attached') and '127.0.0.1' in (t.get('url') or '')]
    chk('%s: and no debugger target on 127.0.0.1 is still attached' % mode, not att, att)
    check_console(res, m['label'])


def expect_rows(rec, want, name):
    ck = by_id(rec)
    for rid, st in want.items():
        chk('%s: %s is %s' % (name, rid, st), (ck.get(rid) or {}).get('status') == STATUS_OF.get(st, st), {k: (ck.get(rid) or {}).get(k) for k in ('status', 'observed', 'evidence')})
    extra = sorted(set(ck) - set(want))
    chk('%s: no other row exists' % name, not extra, extra)
    missing = sorted(set(want) - set(ck))
    chk('%s: and none is missing' % name, not missing, missing)


def not_run_evidence_ok(rec, name):
    prefixes = ('Missing input: ', 'Out of scope: ', 'Blocked: ', 'Stopped: ', 'Not run: ', 'Needs the Optimizely UI: ')
    bad = [(r['id'], r.get('evidence')) for r in rec.get('rows') or [] if r.get('status') in ('not-tested', 'blocked') and not (r.get('evidence') or '').startswith(prefixes)]
    chk('%s: every not-tested or blocked row\'s evidence starts with a D10 prefix' % name, not bad, bad[:3])
    bl = [(r['id'], r.get('status')) for r in rec.get('rows') or [] if (r.get('evidence') or '').startswith('Blocked: ') != (r.get('status') == 'blocked')]
    chk('%s: and a row is blocked exactly when its evidence starts with "Blocked: " (A30)' % name, not bl, bl[:3])


def beacons(reqs):
    out = {'trusted': 0, 'untrusted': 0, 'overlay': 0}
    for p, q in reqs:
        if p != '/beacon':
            continue
        if 'hit=overlay' in q:
            out['overlay'] += 1
        elif 'hit=trigger' in q:
            out['trusted' if 'trusted=1' in q else 'untrusted'] += 1
    return out


# ── scenarios: Mode 1 ──────────────────────────────────────────────────────────────────────────────
def scen_itw(g):
    print('itw: Mode 1 on the full context (Appendix D.3)')
    B = g.site.base
    g.clear_site_data()
    ctx = ctx_itw(B)
    res = g.run_mode('itw', ctx)
    dump('itw', res)
    rec = res.get('rec') or {}
    note('run took %s s, %d loads' % (res['seconds'], len(rec.get('loads') or [])))
    common_after_run(res, 'itw', 'QK-1')
    check_live_debug(res, 'ITW Activation')
    want = {r: 'Pass' for r in ['ia.1.baseline', 'ia.2.onload', 'ia.2.sub.1', 'ia.3.trigger', 'ia.3.stay.1', 'ia.4.returning',
                                'ia.5.1.without', 'ia.5.1.with', 'ia.5.2.excl', 'ia.5.2.comp', 'ia.5.3.comp', 'ia.6.desktop.desktop',
                                'ia.7.title', 'ia.7.canonical', 'ia.7.textLen', 'ia.7.height', 'ia.7.widgets', 'ia.7.textHash', 'ia.8.redirect']}
    want['ia.5.3.excl'] = 'Fail'
    want['ia.6.desktop.phone'] = 'Not Tested'
    expect_rows(rec, want, 'itw')
    not_run_evidence_ok(rec, 'itw')
    chk('itw: the badge reads ISSUES FOUND', res.get('badge') == 'ISSUES FOUND', res.get('badge'))
    loads = rec.get('loads') or []
    chk('itw: 12 loads', len(loads) == 12, [(l.get('role')) for l in loads])
    chk('itw: the loads are itw, stay, returning, sub, 5 audience, control, prod, redirect',
        sorted(l.get('role') for l in loads) == sorted(['itw', 'stay', 'returning', 'sub'] + ['audience'] * 5 + ['control', 'prod', 'redirect']),
        sorted(l.get('role') for l in loads))
    chk('itw: 9 fresh visitors', res.get('fresh') == 9, res.get('fresh'))
    b = beacons(res['reqs'])
    chk('itw: 6 trusted trigger beacons, 0 untrusted, 0 overlay', b == {'trusted': 6, 'untrusted': 0, 'overlay': 0}, b)
    sub = next((l for l in loads if l.get('role') == 'sub'), {})
    chk('itw: the sub-page load cleared local:qk_quiz_progress and local:optimizely_qk_bucket_7001',
        {'local:qk_quiz_progress', 'local:optimizely_qk_bucket_7001'} <= set(sub.get('cleared') or []), sub.get('cleared'))
    chk('itw: the activation row names the baseline kind (record.activation is set)', isinstance(rec.get('activation'), dict) and bool(rec['activation']), rec.get('activation'))
    ev = ' '.join((r.get('evidence') or '') for r in rec.get('rows') or [])
    chk('itw: the Control remedy text never appears on a passing run, nor does "make Control match"',
        'Remedy: Control has to be' not in ev and not re.search(r'match(es)? the variation', ev, re.I))
    text = res.get('report_text') or ''
    chk('itw: the report names ITW Activation and ISSUES FOUND, and prints no optimizely_ text', 'ITW Activation' in text and 'ISSUES FOUND' in text and not FLAG_RE.search(text), text[:200])
    dbg = (res.get('report') or {}).get('debug')
    chk('itw: the report\'s debug log has an itwActivation section without images', dbg is not None and 'data:image' not in json.dumps(dbg), type(dbg).__name__)
    return res


def scen_itw_bad(g):
    print('itw-bad: Control differs from PROD and the redirect destination buckets a direct visitor (D.4)')
    B = g.site.base
    g.clear_site_data()
    res = g.run_mode('itw', ctx_itw_bad(B))
    dump('itw-bad', res)
    rec = res.get('rec') or {}
    common_after_run(res, 'itw', 'QK-2')
    check_live_debug(res, 'ITW Activation')
    ck = by_id(rec)
    chk('itw-bad: ia.itw.missing is not tested', (ck.get('ia.itw.missing') or {}).get('status') == 'not-tested', ck.get('ia.itw.missing'))
    for rid in ('ia.7.title', 'ia.7.canonical'):
        chk('itw-bad: %s passes' % rid, (ck.get(rid) or {}).get('status') == 'passed', ck.get(rid))
    for rid in ('ia.7.textLen', 'ia.7.height', 'ia.7.widgets', 'ia.7.textHash'):
        r = ck.get(rid) or {}
        chk('itw-bad: %s fails and ends with IA_CONTROL_REMEDY' % rid, r.get('status') == 'failed' and (r.get('evidence') or '').endswith('Remedy: Control has to be the page PROD visitors get. Find what alters it for this visitor (code in the Control variation, shared project JavaScript, or another experiment that runs with cro_mode＝qa) and fix that targeting or setup.'), r)
    r = ck.get('ia.8.redirect') or {}
    chk('itw-bad: ia.8.redirect fails with IA_REDIRECT_REMEDY', r.get('status') == 'failed' and (r.get('evidence') or '').endswith('so a visitor who lands on the destination directly is not bucketed into this experiment.'), r)
    chk('itw-bad: 3 loads', len(rec.get('loads') or []) == 3, [l.get('role') for l in rec.get('loads') or []])
    ev = ' '.join((x.get('evidence') or '') for x in rec.get('rows') or [])
    chk('itw-bad: no "edit Control to match" phrasing anywhere',
        not re.search(r'\b(edit|change|update|modify|adjust|align|make|copy)\b[^.]*\bcontrol\b[^.]*\b(match|like|same|mirror)\b', ev, re.I) and not re.search(r'match(es)? the variation', ev, re.I))
    not_run_evidence_ok(rec, 'itw-bad')
    return res


def scen_itw_refused(g):
    print('itw-refused: the typed ITW link forces a variation, so audience and activation checks are refused (D.4, D16, A32)')
    B = g.site.base
    g.clear_site_data()
    link = B + '/itw/?optimizely_x=7102&cro_mode=qa'
    res = g.run_mode('itw', ctx_itw(B, 'QK-3'), typed={'ia-itw': link})
    dump('itw-refused', res)
    rec = res.get('rec') or {}
    common_after_run(res, 'itw', 'QK-3')
    check_live_debug(res, 'ITW Activation')
    ck = by_id(rec)
    r = ck.get('ia.itw.refused') or {}
    chk('itw-refused: ia.itw.refused is Not Tested with the D16 text', r.get('status') == 'not-tested' and (r.get('evidence') or '').startswith('Out of scope: the ITW link forces a variation (optimizely_x).'), r)
    chk('itw-refused: no audience or activation row ran (only ia.itw.refused, ia.7.*, ia.8.redirect)',
        all(k == 'ia.itw.refused' or k.startswith('ia.7.') or k == 'ia.8.redirect' for k in ck), sorted(ck))
    chk('itw-refused: ia.7.* and ia.8.redirect pass', all(ck.get(k, {}).get('status') == 'passed' for k in ck if k.startswith('ia.7.') or k == 'ia.8.redirect') and len([k for k in ck if k.startswith('ia.7.')]) == 6, {k: ck[k].get('status') for k in ck})
    refused = [r for r in res['reqs'] if 'optimizely_x=7102' in r[1]]
    chk('itw-refused: no request carried the refused link (optimizely_x=7102)', not refused, refused)
    plain = [r for r in res['reqs'] if r[0] == '/itw/' and 'optimizely_x' not in r[1]]
    chk('itw-refused: the only /itw/ request without optimizely_x is the one PROD load, with no query at all', plain == [('/itw/', '')], plain)
    b = beacons(res['reqs'])
    chk('itw-refused: no trigger was clicked', b == {'trusted': 0, 'untrusted': 0, 'overlay': 0}, b)
    saved = g.pev("chrome.storage.local.get('iaOverrides').then(o => ((o.iaOverrides || {})['QK-3'] || {}).values || null)")
    chk('itw-refused: iaOverrides["QK-3"].itw was saved', bool(saved) and saved.get('itw') == link, saved)
    not_run_evidence_ok(rec, 'itw-refused')
    return res


def scen_itw_covered(g):
    print('itw-covered: a cookie wall covers the trigger; it is never clicked (D.4, D8)')
    B = g.site.base
    g.clear_site_data()
    res = g.run_mode('itw', ctx_itw_covered(B))
    dump('itw-covered', res)
    rec = res.get('rec') or {}
    common_after_run(res, 'itw', 'QK-4')
    check_live_debug(res, 'ITW Activation')
    ck = by_id(rec)
    chk('itw-covered: ia.1.baseline passes', (ck.get('ia.1.baseline') or {}).get('status') == 'passed', ck.get('ia.1.baseline'))
    r = ck.get('ia.3.trigger') or {}
    chk('itw-covered: ia.3.trigger is Not Tested: "Blocked: the trigger is covered by div#cookie-wall"',
        r.get('status') == 'blocked' and (r.get('evidence') or '').startswith('Blocked: the trigger is covered by div#cookie-wall'), r)
    chk('itw-covered: ia.2.onload is Needs PGM (D19)', (ck.get('ia.2.onload') or {}).get('status') == 'in-progress', ck.get('ia.2.onload'))
    r = ck.get('ia.4.returning') or {}
    chk('itw-covered: ia.4.returning is Not Tested (Blocked)', r.get('status') == 'blocked', r)
    r = ck.get('ia.6.desktop.desktop') or {}
    chk('itw-covered: ia.6.desktop.desktop is Not Tested: "Blocked: activation could not be exercised on desktop (ia.3.trigger)"',
        r.get('status') == 'blocked' and (r.get('evidence') or '').startswith('Blocked: activation could not be exercised on desktop (ia.3.trigger)'), r)
    chk('itw-covered: ia.6.desktop.phone is Not Tested', (ck.get('ia.6.desktop.phone') or {}).get('status') == 'not-tested', ck.get('ia.6.desktop.phone'))
    b = beacons(res['reqs'])
    chk('itw-covered: zero beacons of either kind (the wall and the button were never clicked)', b == {'trusted': 0, 'untrusted': 0, 'overlay': 0}
        and not [r for r in res['reqs'] if r[0] == '/beacon'], [r for r in res['reqs'] if r[0] == '/beacon'])
    not_run_evidence_ok(rec, 'itw-covered')
    return res


def scen_itw_stale(g):
    print('itw-stale: a stored answer from an earlier visit is not cleared when its key is not listed (D.4)')
    B = g.site.base
    g.clear_site_data()
    val = g.seed_stale_answer()
    chk('itw-stale: the /seed/ tab stored qk_quiz_progress=1 and closed', val == '1', val)
    res = g.run_mode('itw', ctx_itw_stale(B))
    dump('itw-stale', res)
    rec = res.get('rec') or {}
    common_after_run(res, 'itw', 'QK-9')
    check_live_debug(res, 'ITW Activation')
    ck = by_id(rec)
    chk('itw-stale: ia.1.baseline passes', (ck.get('ia.1.baseline') or {}).get('status') == 'passed', ck.get('ia.1.baseline'))
    chk('itw-stale: ia.2.onload FAILS (active on load: the stale answer was not cleared)', (ck.get('ia.2.onload') or {}).get('status') == 'failed', ck.get('ia.2.onload'))
    chk('itw-stale: ia.3.trigger is Needs PGM (already active before the click)', (ck.get('ia.3.trigger') or {}).get('status') == 'in-progress', ck.get('ia.3.trigger'))
    r = ck.get('ia.6.desktop.desktop') or {}
    chk('itw-stale: ia.6.desktop.desktop is Not Tested (Blocked)', r.get('status') in ('blocked', 'not-tested') and (r.get('evidence') or '').startswith('Blocked: '), r)
    base = next((l for l in rec.get('loads') or [] if l.get('role') == 'itw'), {})
    chk('itw-stale: the baseline load\'s cleared names lack local:qk_quiz_progress', 'local:qk_quiz_progress' not in (base.get('cleared') or []), base.get('cleared'))
    not_run_evidence_ok(rec, 'itw-stale')
    return res


# ── scenarios: Mode 5 ──────────────────────────────────────────────────────────────────────────────
def decode_tiles(g, rec):
    """Decode every tile of the record in the panel (Image + canvas): natural size and two band pixels."""
    tiles = [{'id': t['id'], 'img': t['img'], 'width': t['width']} for t in rec.get('tiles') or []]
    return g.pev("""(async () => {
      const out = [];
      for (const t of %s) {
        const im = new Image(); im.src = t.img;
        try { await im.decode(); } catch (e) { out.push({ id: t.id, error: String(e) }); continue; }
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
        const px = (x, y) => Array.from(cx.getImageData(x, y, 1, 1).data).slice(0, 3);
        out.push({ id: t.id, w: im.naturalWidth, h: im.naturalHeight, top: px(4, 4), variantBand: px(4, 22 + 300 + 2 + 4), want: t.width });
      }
      return out;
    })()""" % json.dumps(tiles))


def near(px, rgb, tol=40):
    return px is not None and all(abs(a - b) <= tol for a, b in zip(px, rgb))


def scen_resp(g):
    print('resp: Mode 5 at 320, 375 and 1280 on two variations (D.5)')
    B = g.site.base
    g.clear_site_data()
    default_ignore = g.pev("RS_PANEL.fields.find(f => f.key === 'ignore').dflt")
    res = g.run_mode('resp', ctx_resp(B), glob={'rs-widths': '320,375,1280', 'rs-ignore': default_ignore})
    dump('resp', res)
    rec = res.get('rec') or {}
    note('run took %s s, %d loads' % (res['seconds'], len(rec.get('loads') or [])))
    common_after_run(res, 'resp', 'QK-6')
    check_live_debug(res, 'Responsiveness')
    want = {'rs.v0.320.1': 'Fail', 'rs.v0.375': 'Pass', 'rs.v0.1280': 'Pass', 'rs.v1.1280': 'Pass', 'rs.v1.320.1': 'Fail',
            'rs.v1.320.2': 'Fail', 'rs.v1.375.1': 'Fail', 'rs.prod': 'Pass'}
    expect_rows(rec, want, 'resp')
    ck = by_id(rec)
    e = ck.get('rs.v0.320.1') or {}
    x = e.get('extra') or {}
    chk('resp: rs.v0.320.1 is the legal line, gap -10, low, also on PROD yes',
        'LEGAL-LINE' in (e.get('check') or '') and x.get('gapPx') == -10 and x.get('severity') == 'low' and x.get('alsoOnProd') == 'yes', e)
    hero = [ck.get('rs.v1.320.1') or {}, ck.get('rs.v1.320.2') or {}]
    h = next((r for r in hero if 'CLIPPED-HERO' in (r.get('check') or '')), {})
    l = next((r for r in hero if 'LEGAL-LINE' in (r.get('check') or '')), {})
    chk('resp: v1 at 320 clips the hero (-76, low, also on PROD no) ...',
        (h.get('extra') or {}).get('gapPx') == -76 and (h.get('extra') or {}).get('severity') == 'low' and (h.get('extra') or {}).get('alsoOnProd') == 'no', h)
    chk('resp: ... and the legal line (-10, low, also on PROD yes)',
        (l.get('extra') or {}).get('gapPx') == -10 and (l.get('extra') or {}).get('severity') == 'low' and (l.get('extra') or {}).get('alsoOnProd') == 'yes', l)
    r = ck.get('rs.v1.375.1') or {}
    x = r.get('extra') or {}
    chk('resp: rs.v1.375.1 is the hero, -21, high, not on PROD, "new in this variation (regression)"',
        'CLIPPED-HERO' in (r.get('check') or '') and x.get('gapPx') == -21 and x.get('severity') == 'high' and x.get('alsoOnProd') == 'no'
        and 'new in this variation (regression)' in (r.get('evidence') or ''), r)
    chk('resp: rs.prod passes and says "reloaded once per width"', 'reloaded once per width' in ((ck.get('rs.prod') or {}).get('observed') or ''), ck.get('rs.prod'))
    allrows = json.dumps(rec.get('rows'))
    chk('resp: no row mentions CAROUSEL (the default ignore list drops it)', 'CAROUSEL' not in allrows)
    chk('resp: no output says pre-existing or not a regression', not re.search(r'pre-?existing|not a regression', allrows + json.dumps(res.get('report_text') or ''), re.I))
    sweep_w = [s['width'] for s in (rec.get('sweep') or []) if s.get('role') == 'variant']
    chk('resp: the widths were swept in severity order 375, 1280, 320 (per variation)', [w for i, w in enumerate(sweep_w) if i == 0 or w != sweep_w[i - 1]][:3] == [375, 1280, 320], sweep_w)
    # tiles
    tiles = rec.get('tiles') or []
    chk('resp: three tiles, T1 v0@320, T2 v1@375, T3 v1@320',
        [(t.get('id'), t.get('target'), t.get('width')) for t in tiles] == [('T1', 'v0', 320), ('T2', 'v1', 375), ('T3', 'v1', 320)],
        [(t.get('id'), t.get('target'), t.get('width')) for t in tiles])
    chk('resp: each failing row references its tile',
        [ck[k].get('tile') for k in ('rs.v0.320.1', 'rs.v1.375.1', 'rs.v1.320.1', 'rs.v1.320.2')] == ['T1', 'T2', 'T3', 'T3'],
        [ck[k].get('tile') for k in ('rs.v0.320.1', 'rs.v1.375.1', 'rs.v1.320.1', 'rs.v1.320.2')])
    chk('resp: every tile image is a data:image/jpeg;base64, URL', all(str(t.get('img', '')).startswith('data:image/jpeg;base64,') for t in tiles))
    dec = decode_tiles(g, rec) or []
    for d in dec:
        ok = 'error' not in d and d['w'] == d['want'] and d['w'] <= 480 and d['h'] == 22 + 300 + 2 + 22 + 300
        chk('resp: tile %s decodes to %s x 646 (the layout)' % (d.get('id'), d.get('want')), ok, d)
        chk('resp: tile %s has the dark grey PROD band at (4,4) (#3b3b3b)' % d.get('id'), near(d.get('top'), (0x3b, 0x3b, 0x3b)), d.get('top'))
        chk('resp: and the dark red variant band below the PROD half at (4, 328) (#9b1c1c)', near(d.get('variantBand'), (0x9b, 0x1c, 0x1c)), d.get('variantBand'))
    imgs = g.pev("Array.from(document.querySelectorAll('#rs-results img.qk-tile')).map(i => i.getAttribute('src'))") or []
    chk('resp: the panel shows the tiles (every shown image is one of the record\'s)', len(imgs) >= 3 and set(imgs) == {t['img'] for t in tiles}, len(imgs))
    # requests
    reqs = res['reqs']
    var = [r for r in reqs if r[0] == '/resp/' and 'optimizely_x' in r[1]]
    prod = [r for r in reqs if r[0] == '/resp/' and r[1] == '']
    chk('resp: 6 variant loads and 3 PROD loads (PROD reloaded once per width, no query)', len(var) == 6 and len(prod) == 3, (len(var), len(prod)))
    # csv
    rows = parse_csv(res.get('csv') or '')
    chk('resp: the CSV has 9 lines (header + 8 rows)', len(rows) == 9, len(rows))
    hdr = rows[0] if rows else []
    vi = hdr.index('Verdict') if 'Verdict' in hdr else -1
    verdicts = [r[vi] for r in rows[1:]] if vi >= 0 else []
    chk('resp: the Verdict cells are Fail (emulated) x4, Pass (emulated) x3 and a plain Pass for rs.prod',
        sorted(verdicts) == sorted(['Fail (emulated)'] * 4 + ['Pass (emulated)'] * 3 + ['Pass']), verdicts)
    chk('resp: the CSV header is the 12 columns', len(hdr) == 12 and hdr[:5] == ['Check', 'Expected', 'Observed', 'Verdict', 'Evidence'], hdr)
    text = res.get('report_text') or ''
    chk('resp: the report names Responsiveness and ISSUES FOUND, and prints no optimizely_ text', 'Responsiveness' in text and 'ISSUES FOUND' in text and not FLAG_RE.search(text), text[:200])
    not_run_evidence_ok(rec, 'resp')
    return res


def scen_resp_ignore(g):
    print('resp-ignore: an invalid ignore selector refuses the run; a valid extra one removes the legal-line row (D.6, D20)')
    B = g.site.base
    g.clear_site_data()
    default_ignore = g.pev("RS_PANEL.fields.find(f => f.key === 'ignore').dflt")
    # 1: the invalid line
    res = g.run_mode('resp', ctx_resp(B), glob={'rs-widths': '320,375,1280', 'rs-ignore': default_ignore + '\ndiv['})
    dump('resp-ignore-refused', res)
    chk('resp-ignore: the run is refused: "Ignore list: not a valid CSS selector: div["', 'Ignore list: not a valid CSS selector: div[' in res['status'], res['status'])
    chk('resp-ignore: no request reached the site', not res['reqs'], res['reqs'][:3])
    chk('resp-ignore: no new record was produced and no console line written', (res.get('rec') is None or res['rec'].get('ts', 0) < res['t0_ms']) and not res.get('console'), (res.get('rec') or {}).get('ts'))
    chk('resp-ignore: the card names the refusal', 'Ignore list: not a valid CSS selector: div[' in re.sub(r'<[^>]+>', '', res.get('results_html') or ''), (res.get('results_html') or '')[:200])
    chk('resp-ignore: the box ends with the refusal', 'Ignore list: not a valid CSS selector: div[' in res['debug_text'].split('\n')[-1], res['debug_text'][-200:])
    chk('resp-ignore: no tab on 127.0.0.1 and nothing attached', not any('127.0.0.1' in (u or '') for u in res['tabs']) and not [t for t in res['dbg_targets'] if t.get('attached') and '127.0.0.1' in (t.get('url') or '')])
    # 2: the defaults plus .legal
    res = g.run_mode('resp', ctx_resp(B), glob={'rs-widths': '320,375,1280', 'rs-ignore': default_ignore + '\n.legal'})
    dump('resp-ignore', res)
    rec = res.get('rec') or {}
    common_after_run(res, 'resp', 'QK-6')
    check_live_debug(res, 'Responsiveness')
    ck = by_id(rec)
    chk('resp-ignore: rs.v0.320 passes (the legal line is ignored)', (ck.get('rs.v0.320') or {}).get('status') == 'passed', ck.get('rs.v0.320'))
    chk('resp-ignore: no LEGAL-LINE row anywhere', 'LEGAL-LINE' not in json.dumps(rec.get('rows')))
    chk('resp-ignore: the hero (v1) still fails at 320 and 375 (it was not ignored)',
        'CLIPPED-HERO' in ((ck.get('rs.v1.320.1') or {}).get('check') or '') and 'CLIPPED-HERO' in ((ck.get('rs.v1.375.1') or {}).get('check') or ''), sorted(ck))
    chk('resp-ignore: the record keeps the list used (the defaults plus .legal)', '.legal' in ((rec.get('input') or {}).get('ignore') or []), (rec.get('input') or {}).get('ignore'))
    return res


def scen_resp_live(g):
    print('resp-live: a live experiment on PROD, so PROD is swept by resizing one load (D.6)')
    B = g.site.base
    g.clear_site_data()
    default_ignore = g.pev("RS_PANEL.fields.find(f => f.key === 'ignore').dflt")
    res = g.run_mode('resp', ctx_resp_live(B), glob={'rs-widths': '375,1280', 'rs-ignore': default_ignore})
    dump('resp-live', res)
    rec = res.get('rec') or {}
    common_after_run(res, 'resp', 'QK-7')
    check_live_debug(res, 'Responsiveness')
    plan = rec.get('plan') or {}
    chk('resp-live: plan.prodMode is resize', plan.get('prodMode') == 'resize', plan)
    chk('resp-live: plan.prodLiveIds holds 7202', '7202' in [str(i) for i in plan.get('prodLiveIds') or []], plan.get('prodLiveIds'))
    prod = [r for r in res['reqs'] if r[0] == '/resp-live/' and r[1] == '']
    chk('resp-live: exactly 1 PROD request', len(prod) == 1, prod)
    ck = by_id(rec)
    p = ck.get('rs.prod') or {}
    chk('resp-live: rs.prod passes, naming the resize and 7202', p.get('status') == 'passed' and 'resiz' in (p.get('observed') or '') and '7202' in (p.get('observed') or ''), p)
    chk('resp-live: the variation rows exist for 375 and 1280', {'rs.v1.375', 'rs.v1.1280'} <= set(k for k in ck) or any(k.startswith('rs.v1.375') for k in ck), sorted(ck))
    probs = (res.get('report') or {}).get('problems') or []
    note('run diagnostics: ' + json.dumps([(p.get('severity'), p.get('where')) for p in probs]))
    chk('resp-live: Run Diagnostics carries an info line naming 7202 for Responsiveness',
        any(p.get('severity') == 'info' and '7202' in (p.get('detail') or '') and 'esponsiveness' in (p.get('where') or '') for p in probs), probs[:4])
    not_run_evidence_ok(rec, 'resp-live')
    return res


# ── scenarios: both modes ──────────────────────────────────────────────────────────────────────────
def scen_bot(g):
    print('bot: a "Just a moment..." page halts each mode at its first load; nothing after it is attempted (D.4, D.6, D23)')
    B = g.site.base
    g.clear_site_data()
    res = g.run_mode('itw', ctx_itw_bot(B))
    dump('bot-itw', res)
    rec = res.get('rec') or {}
    common_after_run(res, 'itw', 'QK-5')
    check_live_debug(res, 'ITW Activation')
    chk('bot itw: rec.halted.path ends /blocked/', ((rec.get('halted') or {}).get('path') or '').endswith('/blocked/'), rec.get('halted'))
    ck = by_id(rec)
    b = ck.get('ia.1.baseline') or {}
    chk('bot itw: ia.1.baseline is Not Tested "Blocked: a bot check"', b.get('status') == 'blocked' and (b.get('evidence') or '').startswith('Blocked: a bot check'), b)
    ok = all((r.get('evidence') or '').startswith(('Blocked: a bot check', 'Missing input: ', 'Out of scope: ')) and r.get('status') in ('blocked', 'not-tested') for r in rec.get('rows') or [])
    chk('bot itw: every row is Not Tested: the D23 sentence or an absent input', ok, [(r['id'], r.get('status'), (r.get('evidence') or '')[:50]) for r in rec.get('rows') or [] if not ok][:3])
    blocked = [r for r in res['reqs'] if r[0] == '/blocked/']
    chk('bot itw: exactly 1 request to /blocked/ and exactly 1 load', len(blocked) == 1 and len(rec.get('loads') or []) == 1, (blocked, len(rec.get('loads') or [])))
    chk('bot itw: nothing but the one page was requested (no beacon, no other path)', all(r[0] in ('/blocked/', '/fake-optimizely.js') for r in res['reqs']) or all(r[0] == '/blocked/' for r in res['reqs']), res['reqs'])
    chk('bot itw: the panel shows the halted banner', 'halted the run' in re.sub(r'<[^>]+>', '', res.get('results_html') or ''), (res.get('results_html') or '')[:200])
    chk('bot itw: the badge is HALTED: BOT CHECK', res.get('badge') == 'HALTED: BOT CHECK', res.get('badge'))
    en = (res.get('console') or [{}])[-1]
    chk('bot itw: the Console end line is WARNING "halted by a bot check on"', en.get('level') == 'WARNING' and 'halted by a bot check on' in (en.get('text') or ''), en)
    not_run_evidence_ok(rec, 'bot itw')
    # Mode 5
    default_ignore = g.pev("RS_PANEL.fields.find(f => f.key === 'ignore').dflt")
    res = g.run_mode('resp', ctx_resp_bot(B), glob={'rs-widths': '375,1280', 'rs-ignore': default_ignore})
    dump('bot-resp', res)
    rec = res.get('rec') or {}
    common_after_run(res, 'resp', 'QK-8')
    check_live_debug(res, 'Responsiveness')
    chk('bot resp: halted at the first load', ((rec.get('halted') or {}).get('path') or '').endswith('/blocked/') and len(rec.get('loads') or []) == 1, (rec.get('halted'), len(rec.get('loads') or [])))
    ck = by_id(rec)
    chk('bot resp: rs.v0.375, rs.v0.1280 and rs.prod are all there', {'rs.v0.375', 'rs.v0.1280', 'rs.prod'} <= set(ck), sorted(ck))
    chk('bot resp: every row is Not Tested with the D23 sentence', rec.get('rows') and all((r.get('evidence') or '').startswith('Blocked: a bot check') and r.get('status') == 'blocked' for r in rec['rows']),
        [(r['id'], r.get('status'), (r.get('evidence') or '')[:50]) for r in rec.get('rows') or []][:4])
    blocked = [r for r in res['reqs'] if r[0] == '/blocked/']
    chk('bot resp: exactly 1 request to /blocked/', len(blocked) == 1, blocked)
    en = (res.get('console') or [{}])[-1]
    chk('bot resp: the Console end line is WARNING "halted by a bot check on"', en.get('level') == 'WARNING' and 'halted by a bot check on' in (en.get('text') or ''), en)
    not_run_evidence_ok(rec, 'bot resp')
    return res


def scen_stop(g):
    print('stop: Stop pressed during an 18-width sweep (D.6)')
    B = g.site.base
    g.clear_site_data()
    default_ignore = g.pev("RS_PANEL.fields.find(f => f.key === 'ignore').dflt")
    res = g.run_mode('resp', ctx_resp(B), glob={'rs-widths': ALL_WIDTHS, 'rs-ignore': default_ignore},
                     stop_when=lambda reqs: sum(1 for r in reqs if r[0] == '/resp/') >= 3)
    dump('stop', res)
    rec = res.get('rec') or {}
    at_stop = sum(1 for r in res['stopped_at'] or [] if r[0] == '/resp/')
    total = sum(1 for r in res['reqs'] if r[0] == '/resp/')
    note('stop pressed with %d /resp/ requests; %d after it settled; %d loads' % (at_stop, total, len(rec.get('loads') or [])))
    common_after_run(res, 'resp', 'QK-6')
    check_live_debug(res, 'Responsiveness')
    chk('stop: the Stop button was pressed', res['stopped_at'] is not None)
    chk('stop: stopped is true', rec.get('stopped') is True, rec.get('stopped'))
    chk('stop: fewer than 54 loads', len(rec.get('loads') or []) < 54, len(rec.get('loads') or []))
    left = [r for r in rec.get('rows') or [] if (r.get('evidence') or '').startswith('Stopped: by the tester before this ran.')]
    chk('stop: the remaining rows say "Stopped: by the tester before this ran."', len(left) >= 1 and all(r.get('status') == 'not-tested' for r in left), len(left))
    chk('stop: at most one /resp/ request after the stop (the one in flight)', total - at_stop <= 1, (at_stop, total))
    en = (res.get('console') or [{}])[-1]
    chk('stop: the Console end line is WARNING "Run stopped by the tester"', en.get('level') == 'WARNING' and 'Run stopped by the tester' in (en.get('text') or ''), en)
    chk('stop: the badge is INCOMPLETE or ISSUES FOUND', res.get('badge') in ('INCOMPLETE', 'ISSUES FOUND'), res.get('badge'))
    not_run_evidence_ok(rec, 'stop')
    return res


SCENARIOS = {'itw': scen_itw, 'itw-bad': scen_itw_bad, 'itw-refused': scen_itw_refused, 'itw-covered': scen_itw_covered,
             'itw-stale': scen_itw_stale, 'resp': scen_resp, 'resp-ignore': scen_resp_ignore, 'resp-live': scen_resp_live,
             'bot': scen_bot, 'stop': scen_stop}

if __name__ == '__main__':
    if '--list' in sys.argv[1:]:
        print('\n'.join(SCENARIOS))
        sys.exit(0)
    names = sys.argv[1:] or list(SCENARIOS)
    unknown = [n for n in names if n not in SCENARIOS]
    if unknown:
        sys.exit('unknown scenario(s): %s (try --list)' % ', '.join(unknown))
    if not OUT:
        OUT = tempfile.mkdtemp(prefix='selenite_modes_out_')
    os.makedirs(OUT, exist_ok=True)
    print('output directory: ' + OUT)
    g = Gate()
    try:
        print('extension %s loaded, panel window %s, fixture site %s' % (g.ext, g.win, g.site.base))
        for n in names:
            SCENARIOS[n](g)
    finally:
        g.close()
    after = tree_digests(EXT)
    changed = sorted(k for k in set(after) | set(g.digest0) if after.get(k) != g.digest0.get(k))
    chk('extension/ is byte-identical across the gate (sha256 tree %s)' % tree_digest(g.digest0)[:12], not changed, changed[:10])
    print('\n=== %d passed, %d failed ===' % (passed, failed))
    for f in fails:
        print('  -', f)
    print('ALL PASSED' if not failed else 'FAILED')
    sys.exit(1 if failed else 0)
