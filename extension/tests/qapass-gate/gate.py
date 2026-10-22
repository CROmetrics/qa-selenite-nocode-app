"""End-to-end gate for QA Pass (the Test Agent mode 'qapass'): the REAL Selenite extension (this checkout) in REAL
branded Chrome, driving the real panel and worker against a local fixture shop on 127.0.0.1 (site.py, fake-optimizely.js;
plan Appendix B). Nothing here talks to a real site unless GATE_ALLOW_REAL_SITE=1 is set for the `starz` scenario.

  python3 -I -u gate.py [scenario ...]       (no scenario: main, strict, bot, live, and starz if allowed)
  python3 -I -u gate.py --list

Scenarios:
  main    the fixture shop, every check, default widths (76 sweep rows), PROD swept as iPhone and Android too
  strict  /shop-strict/ serves the v1 variation only with optimizely_force_tracking=true, so the no-tracking probe
          fails and the sweep takes the resize path (checks A and E, widths 360 and 375); with B off PROD is resized too
  bot     a Cloudflare-style "Just a moment..." page: the bot check is named, never attempted again
  live    /shop-live/ runs an experiment for every visitor, as a launched test does: the plain PROD load shows it, so PROD
          is swept by resizing one tab per device (checks A, B and E, widths 360 and 375: 3 PROD sweep loads instead of 6)
  starz   (network; loads https://www.starz.com/us/en/ with NO query string, a REAL client site) only with
          GATE_ALLOW_REAL_SITE=1; without it the scenario prints SKIPPED and counts nothing

How it works: Chrome (branded; CHROME_BIN overrides the path) is launched headless with --remote-debugging-pipe and a
fresh throwaway profile; the unpacked extension is loaded with Extensions.loadUnpacked (branded Chrome ignores
--load-extension); the panel (popup.html) is opened as a tab; per scenario the active context is written to
chrome.storage.local, the Test Agent is switched to QA Pass with Agentic Analysis OFF (no model is ever called), the
settings controls are set, #btn-ta-run is clicked and #ta-status is polled until the run settles (15 minutes at most).
The record (_qpLastRun), the newest report in IndexedDB (debug log) and the report tab's text are then read back.

Needs: macOS or Linux with Google Chrome 154+, python3. This never touches your everyday Chrome or its profile.
  GATE_OUT              a directory to write each scenario's record, debug log and report text into (default: a temp dir, printed)
  GATE_ALLOW_REAL_SITE  set to 1 to let the `starz` scenario load the real starz.com home page (no query string)
  GATE_PROFILE          the throwaway Chrome profile directory (default: <temp dir>/selenite_qapass_profile_<pid>); deleted at start and end

Do not edit anything under extension/ while a run is in progress: an MV3 worker restart re-reads its files from disk.
"""
import importlib.util, json, os, shutil, sys, tempfile, time
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'browserstack-gate'))
from cdp import Browser

# site.py shares its name with the stdlib's `site` (already imported at start-up), so it is loaded by path.
_spec = importlib.util.spec_from_file_location('qapass_site', os.path.join(HERE, 'site.py'))
qapass_site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(qapass_site)

EXT = os.path.abspath(os.path.join(HERE, '..', '..'))          # extension/, loaded unpacked
PROFILE = os.environ.get('GATE_PROFILE') or os.path.join(tempfile.gettempdir(), 'selenite_qapass_profile_%d' % os.getpid())
OUT = os.environ.get('GATE_OUT')            # made on first use (a --list run creates nothing)
RUN_TIMEOUT_S = 15 * 60

RECORD_KEYS = ['version', 'ts', 'startedAt', 'finishedAt', 'stopped', 'error', 'ticketKey', 'experimentId', 'settings',
               'platform', 'loads', 'links', 'catalog', 'catalogFrom', 'controlVsProd', 'combos', 'audiences', 'sweep',
               'checks', 'notTested', 'explain', 'sheet', 'abReport']
DEBUG_KEYS = ['version', 'startedAt', 'finishedAt', 'stopped', 'error', 'settings', 'platform', 'loads', 'links', 'catalog',
              'controlVsProd', 'combos', 'audiences', 'sweep', 'checks', 'notTested', 'explain', 'sheet', 'abReport']
HEADINGS = ['Bugs', 'Passed', 'Needs PGM', 'Not tested', 'Sheet changes']
ALL_WIDTHS = '300,320,340,360,375,390,402,412,430,480,600,768,820,1024,1280,1440,1920,2080'
# The report foot's fresh-visitor line (qpFreshVisitorsText in qa-pass.js), as each scenario's loads make it.
FV_LINE = ('Fresh visitors: %d load(s) of the live page as a new visitor (Selenite clears the Optimizely cookies before each): '
           'PROD %d, ITW %d, audience tests %d, PROD sweep %d.')
FV_RELOAD_NOT_LIVE = ' PROD was swept by reloading once per width: the plain PROD load showed no live experiment.'
FV_RESIZE_B_OFF = ' PROD was swept by resizing one tab per device, because check B was off, so the plain PROD page was not probed for live experiments.'
FV_RESIZE_LIVE_9002 = ' PROD was swept by resizing one tab per device, because the plain PROD load showed 1 live experiment(s) (9002).'

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
        print('  FAIL ' + name + ('   -> ' + json.dumps(detail, default=str)[:400] if detail is not None else ''))


def note(msg):
    print('  ..   ' + msg)


# ── contexts (plan Appendix B.4) ───────────────────────────────────────────────────────────────────
def base_ctx(key, exp, base, links, itw, goals, soft):
    return {
        'ticketKey': key, 'ticketUrl': '', 'summary': 'QA Pass gate', 'platform': 'Optimizely', 'experimentId': exp,
        'variants': [{'id': 'v0', 'isControl': True, 'rawDescription': 'Control'}] + (
            [{'id': 'v1', 'isControl': False, 'rawDescription': 'Hero line'}] if len(links) > 1 else []),
        'previewLinks': links, 'itwLink': itw,
        'goals': [{'text': g, 'isNew': False, 'convertMetricId': None, 'resolutionNeeded': False} for g in goals],
        'qaTestPlanUrl': None, 'softcodedTests': soft, 'concurrentTests': [], 'comments': [],
        'figmaUrl': None, 'figmaNodeId': None, 'reviewed': True,
    }


def ctx_main(B, path='/shop/'):
    return base_ctx('QP-1', '9001', B, [
        {'id': 'v0', 'url': B + path + '?optimizely_x=9101&cro_mode=qa'},
        {'id': 'v1', 'url': B + path + '?optimizely_x=9102&cro_mode=qa&optimizely_force_tracking=true'},
    ], B + path + '?cro_mode=qa', ['Hero CTA click', 'Purchase completed'], [{'ticketKey': 'QP-2', 'label': 'Softcoded promo'}])


def ctx_bot(B):
    return base_ctx('QP-3', '9001', B, [{'id': 'v0', 'url': B + '/blocked/?optimizely_x=9101'}], None, [], [])


def ctx_live(B):
    return base_ctx('QP-5', '9001', B, [
        {'id': 'v0', 'url': B + '/shop-live/?optimizely_x=9101&cro_mode=qa'},
        {'id': 'v1', 'url': B + '/shop-live/?optimizely_x=9102&cro_mode=qa'},
    ], B + '/shop-live/?cro_mode=qa', ['Hero CTA click'], [])


def ctx_starz():
    return base_ctx('QP-4', None, None, [{'id': 'v0', 'url': 'https://www.starz.com/us/en/'}], None, ['Sitewide scroll goals 25%'], [])


# ── the browser ────────────────────────────────────────────────────────────────────────────────────
class Gate:
    def __init__(self):
        self.b = None
        self.site = None
        self.panel = None
        try:
            self._start()
        except BaseException:
            self.close()
            raise

    def _start(self):
        if os.path.exists(PROFILE):
            shutil.rmtree(PROFILE)
        self.site = qapass_site.Site(0)
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
                if self.b.ev(self.worker, "typeof chrome !== 'undefined' && typeof runQaPass === 'function'"):
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
                if self.b.ev(self.panel, "typeof TA_MODES === 'object' && !!document.getElementById('qp-body') && typeof WIN_ID !== 'undefined' && WIN_ID != null"):
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

    # one QA Pass run through the real panel
    def run_qapass(self, ctx, settings):
        js = """(async () => {
          const ctx = %s, st = %s;
          await chrome.storage.local.set({ initContexts: { QP: ctx }, activeInitContext: 'QP' });
          // Show the Test Agent tab and select QA Pass every time, without leaving the tab first. From the second scenario on
          // this re-shows a tab that is already showing and re-selects the mode it already has: taShowPrimary's re-show path,
          // where a settings body that is already in #ta-settings-slot stays put. The body must still be there afterwards.
          showTab('testagent');
          const sel = document.getElementById('ta-primary-select');
          sel.value = 'qapass'; sel.dispatchEvent(new Event('change', { bubbles: true }));
          const slot = document.getElementById('ta-settings-slot'), qpBody = document.getElementById('qp-body');
          if (!(slot && qpBody && slot.contains(qpBody))) return 'qp-body is not in #ta-settings-slot after the tab and the mode were shown again';
          const an = document.getElementById('ta-agentic-analysis');
          an.checked = false; an.dispatchEvent(new Event('change', { bubbles: true }));
          document.querySelectorAll('.qp-check').forEach(c => { c.checked = !!st.checks[c.value]; c.dispatchEvent(new Event('change', { bubbles: true })); });
          const set = (id, v) => { const e = document.getElementById(id); if (e.type === 'checkbox') { e.checked = !!v; e.dispatchEvent(new Event('change', { bubbles: true })); } else { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
          set('qp-widths', st.widths); set('qp-quick-sweep', st.quickSweep); set('qp-prod-mobile', st.prodMobile);
          set('qp-combos', st.combos); set('qp-clear-all', st.clearAll);
          document.getElementById('ta-status').textContent = '';
          document.getElementById('btn-ta-run').click();
          return true;
        })()""" % (json.dumps(ctx), json.dumps(settings))
        t0 = time.time()
        shown = self.pev(js)
        chk('the QA Pass settings body is in the slot after the tab and the mode were shown again', shown is True, shown)
        if shown is not True:
            raise RuntimeError('QA Pass was not started: %s' % shown)
        last = ''
        end = t0 + RUN_TIMEOUT_S
        while time.time() < end:
            time.sleep(2)
            s = self.pev("document.getElementById('ta-status').textContent") or ''
            if s != last:
                last = s
            if s.startswith('Done') or 'failed' in s or 'could not' in s:
                break
        else:
            raise TimeoutError('QA Pass did not settle in %d s (status: %s)' % (RUN_TIMEOUT_S, last))
        out = {'status': last, 'seconds': round(time.time() - t0, 1)}
        out['rec'] = json.loads(self.pev('JSON.stringify(typeof _qpLastRun === "undefined" ? null : _qpLastRun)') or 'null')
        rep = self.pev("""(async () => {
          const keys = (await idbReq((await idb()).transaction('reports').objectStore('reports').getAllKeys())).sort();
          const k = keys[keys.length - 1];
          if (!k) return null;
          const r = await idbGet('reports', k);
          return { key: k, qaPass: r.debugLog && r.debugLog.qaPass, problems: r.debugLog && r.debugLog.problems, bodyHtml: r.bodyHtml };
        })()""")
        out['report'] = rep
        out['report_text'] = None
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
        out['dbg_targets'] = self.pev('(async () => (await chrome.debugger.getTargets()).map(t => ({ url: t.url, attached: !!t.attached, type: t.type })))()')
        return out


def dump(name, res, requests):
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    json.dump(res.get('rec'), open(os.path.join(d, 'record.json'), 'w'), indent=1)
    json.dump({'status': res['status'], 'seconds': res['seconds'], 'problems': (res.get('report') or {}).get('problems'),
               'qaPass': (res.get('report') or {}).get('qaPass'), 'tabs': res.get('tabs'), 'dbg_targets': res.get('dbg_targets'),
               'requests': requests}, open(os.path.join(d, 'debug.json'), 'w'), indent=1)
    open(os.path.join(d, 'report.txt'), 'w').write(res.get('report_text') or '')
    open(os.path.join(d, 'report.html'), 'w').write((res.get('report') or {}).get('bodyHtml') or '')


def by_id(rec):
    return {c['id']: c for c in (rec or {}).get('checks') or []}


def heading_order(text):
    """The line index of each of the five headings in the report's text (-1 when absent), searching forward in order."""
    lines = [l.strip() for l in (text or '').split('\n')]
    pos, start = [], 0
    for h in HEADINGS:
        i = next((n for n in range(start, len(lines)) if lines[n] == h), -1)
        pos.append(i)
        if i >= 0:
            start = i + 1
    return pos


def settings(checks='ABCDEF', widths=ALL_WIDTHS, prod_mobile=True, combos=True, quick=False, clear_all=False):
    return {'checks': {g: (g in checks) for g in 'ABCDEF'}, 'widths': widths, 'quickSweep': quick,
            'prodMobile': prod_mobile, 'combos': combos, 'clearAll': clear_all}


def common_after_run(res, g):
    """Assertions every scenario shares: nothing left behind in the user's browser."""
    chk('the run settled and the report opened', res['status'].startswith('Done'), res['status'])
    chk('a record was produced', isinstance(res.get('rec'), dict))
    tabs = res.get('tabs') or []
    chk('after the run no open tab is on 127.0.0.1 (the run tab was closed)', not any('127.0.0.1' in (u or '') for u in tabs), tabs)
    att = [t for t in (res.get('dbg_targets') or []) if t.get('attached') and '127.0.0.1' in (t.get('url') or '')]
    chk('and no debugger target on 127.0.0.1 is still attached', not att, att)


# ── scenarios ──────────────────────────────────────────────────────────────────────────────────────
def scen_main(g):
    print('main: the fixture shop, every check, default widths')
    B = g.site.base
    mark = g.site.mark()
    res = g.run_qapass(ctx_main(B), settings())
    reqs = g.site.since(mark)
    dump('main', res, reqs)
    common_after_run(res, g)
    rec = res.get('rec') or {}
    note('run took %s s, %d loads' % (res['seconds'], len(rec.get('loads') or [])))
    chk('the record has exactly the 23 keys of plan 3.2', sorted(rec.keys()) == sorted(RECORD_KEYS), sorted(set(rec.keys()) ^ set(RECORD_KEYS)))
    chk('version is 1', rec.get('version') == 1, rec.get('version'))
    chk('no run error', rec.get('error') is None, rec.get('error'))
    chk('not stopped', rec.get('stopped') is False)
    ck = by_id(rec)
    want = {'A.v0': 'passed', 'A.v1': 'passed', 'A.itw': 'passed', 'B.control-prod': 'passed', 'C.goal.1': 'passed',
            'C.goal.2': 'in-progress', 'C.softcoded.QP-2': 'passed', 'C.unlisted.9002': 'in-progress', 'F.v0': 'passed', 'F.v1': 'failed'}
    for cid, st in want.items():
        chk('%s is %s' % (cid, st), (ck.get(cid) or {}).get('status') == st, ck.get(cid))
    dids = sorted(k for k in ck if k.startswith('D.'))
    chk('six D checks', len(dids) == 6, dids)
    dfail = [ck[k] for k in dids if ck[k]['status'] == 'failed']
    chk('exactly one D check failed', len(dfail) == 1, [(k, ck[k]['status']) for k in dids])
    chk('and it is the utm_campaign=impact exclusion', len(dfail) == 1 and 'utm_campaign=impact' in dfail[0]['title'] and 'companion' not in dfail[0]['title'], dfail and dfail[0]['title'])
    chk('the other five D checks passed', sum(1 for k in dids if ck[k]['status'] == 'passed') == 5)
    e0, e1, e2 = ck.get('E.v0.1') or {}, ck.get('E.v1.1') or {}, ck.get('E.v1.2') or {}
    chk('E.v0.1 failed, low, also on PROD (the legal line)', (e0.get('status'), e0.get('severity'), e0.get('alsoOnProd')) == ('failed', 'low', True) and 'LEGAL-LINE' in e0.get('note', ''), e0)
    chk('E.v1.1 failed, high, not on PROD (the hero)', (e1.get('status'), e1.get('severity'), e1.get('alsoOnProd')) == ('failed', 'high', False) and 'CLIPPED-HERO' in e1.get('note', ''), e1)
    chk('E.v1.2 failed, low, also on PROD (the legal line)', (e2.get('status'), e2.get('severity'), e2.get('alsoOnProd')) == ('failed', 'low', True) and 'LEGAL-LINE' in e2.get('note', ''), e2)
    expected_ids = set(want) | set(dids) | {'E.v0.1', 'E.v1.1', 'E.v1.2'}
    chk('no other check exists', set(ck) == expected_ids, sorted(set(ck) ^ expected_ids))
    links = [l for l in rec.get('links') or [] if l.get('role') == 'preview']
    chk('every preview link has the metrics listener armed', len(links) == 2 and all((l.get('track') or {}).get('listener') is True for l in links), [l.get('track') for l in links])
    chk('and none had it disabled', not any((l.get('track') or {}).get('disabled') for l in links))
    rows = (rec.get('sweep') or {}).get('rows') or []
    chk('sweep.rows = 18 + 18 + 18 + 11 + 11 = 76', len(rows) == 76, len(rows))
    tiles = (rec.get('sweep') or {}).get('tiles') or []
    chk('at least two tiles were taken', len(tiles) >= 2, len(tiles))
    prod = {(t['profile'], t['width']) for t in tiles if t['target'] == 'PROD'}
    mob = [t for t in tiles if t['target'] != 'PROD' and t['width'] < 768]
    chk('every variant tile below 768 px has a PROD tile at the same profile and width', all((t['profile'], t['width']) in prod for t in mob), [(t['target'], t['profile'], t['width']) for t in mob])
    chk('every tile carries a JPEG data URL', all(str(t.get('img', '')).startswith('data:image/jpeg;base64,') for t in tiles))
    prod_rows = [r for r in rows if r.get('role') == 'prod']
    chk('PROD is swept by reloading once per width: the plain PROD load showed no live experiment (40 rows, 40 loads)',
        len(prod_rows) == 40 and all(r.get('mode') == 'reload' for r in prod_rows)
        and sum(1 for l in rec.get('loads') or [] if l.get('role') == 'sweep' and l.get('label') == 'PROD') == 40, [r.get('mode') for r in prod_rows][:3])
    flagged = [r for r in reqs if 'optimizely_force_tracking' in r[1]]
    chk('exactly ONE request carried optimizely_force_tracking (phase A of v1)', len(flagged) == 1, flagged)
    chk('and it was the v1 link', len(flagged) == 1 and 'optimizely_x=9102' in flagged[0][1], flagged)
    plain = [r for r in reqs if r[0] == '/shop/' and 'optimizely_x' not in r[1]]
    chk('no ITW, PROD or audience request carried it', plain and not any('optimizely_force_tracking' in r[1] for r in plain), plain[:3])
    combos = [r for r in reqs if r[0] == '/shop/' and 'optimizely_x=9101,92' in r[1]]
    chk('exactly two combo requests, each with optimizely_x=9101,92..', len(combos) == 2, combos)
    chk('and the record lists two combos', len(rec.get('combos') or []) == 2, rec.get('combos'))
    text = res.get('report_text') or ''
    pos = heading_order(text)
    chk('the report shows the five headings in order', all(p >= 0 for p in pos) and pos == sorted(pos), pos)
    chk('and says ISSUES FOUND', 'ISSUES FOUND' in text)
    chk('and prints no optimizely_ text', 'optimizely_' not in text)
    fv = FV_LINE % (48, 1, 1, 6, 40) + FV_RELOAD_NOT_LIVE
    chk('the report foot names the 48 fresh visitors and how PROD was swept', fv in text, [l for l in text.split('\n') if 'Fresh visitors' in l])
    qp = (res.get('report') or {}).get('qaPass') or {}
    chk('the debug log qaPass section has every projection key', all(k in qp for k in DEBUG_KEYS), [k for k in DEBUG_KEYS if k not in qp])
    chk('and carries no image data', 'data:image' not in json.dumps(qp))
    problems = (res.get('report') or {}).get('problems') or []
    note('run diagnostics: ' + json.dumps([(p['severity'], p['where']) for p in problems]))
    cleared = [l.get('cleared') for l in rec.get('loads') or []]
    note('Network.getCookies through chrome.debugger: loads with cleared !== null = %d of %d (values %s)' % (
        sum(1 for c in cleared if c is not None), len(cleared), sorted({str(c) for c in cleared})))
    note('catalog: ' + json.dumps((rec.get('catalog') or {}).get('counts')))
    note('loads by role: ' + json.dumps({r: sum(1 for l in rec.get('loads') or [] if l.get('role') == r) for r in sorted({l.get('role') for l in rec.get('loads') or []})}))
    return res


def scen_strict(g):
    print('strict: v1 is served only with the tracking parameter, so the sweep resizes instead of reloading')
    B = g.site.base
    mark = g.site.mark()
    res = g.run_qapass(ctx_main(B, '/shop-strict/'), settings(checks='AE', widths='360,375', prod_mobile=False))
    reqs = g.site.since(mark)
    dump('strict', res, reqs)
    common_after_run(res, g)
    rec = res.get('rec') or {}
    note('run took %s s, %d loads' % (res['seconds'], len(rec.get('loads') or [])))
    rows = (rec.get('sweep') or {}).get('rows') or []
    v1 = [r for r in rows if r.get('target') == 'v1']
    chk('v1 has sweep rows', len(v1) >= 2, len(v1))
    chk('every v1 sweep row is in resize mode', v1 and all(r.get('mode') == 'resize' for r in v1), [r.get('mode') for r in v1])
    l1 = next((l for l in rec.get('links') or [] if l.get('label') == 'v1'), {})
    chk('links[v1].noTrackServes is false', l1.get('noTrackServes') is False, l1.get('noTrackServes'))
    flagged = [r for r in reqs if 'optimizely_force_tracking' in r[1]]
    chk('exactly 2 requests carried optimizely_force_tracking (phase A + one resize load)', len(flagged) == 2, flagged)
    ck = by_id(rec)
    e1 = ck.get('E.v1.1') or {}
    chk('E.v1.1 failed, high', (e1.get('status'), e1.get('severity')) == ('failed', 'high'), e1)
    v0 = [r for r in rows if r.get('target') == 'v0']
    chk('v0 (flag-free) is still swept by reload', v0 and all(r.get('mode') == 'reload' for r in v0), [r.get('mode') for r in v0])
    prod_rows = [r for r in rows if r.get('role') == 'prod']
    chk('B is off, so PROD is swept by resizing: 2 rows, 1 load', len(prod_rows) == 2 and all(r.get('mode') == 'resize' for r in prod_rows)
        and sum(1 for l in rec.get('loads') or [] if l.get('role') == 'sweep' and l.get('label') == 'PROD') == 1, [r.get('mode') for r in prod_rows])
    plain = [r for r in reqs if r[0] == '/shop-strict/' and r[1] == '']
    chk('and the site saw exactly 1 plain PROD request', len(plain) == 1, plain)
    text = res.get('report_text') or ''
    fv = FV_LINE % (2, 0, 1, 0, 1) + FV_RESIZE_B_OFF
    chk('the report foot names the 2 fresh visitors and check B as the reason', fv in text, [l for l in text.split('\n') if 'Fresh visitors' in l])
    return res


def scen_bot(g):
    print('bot: a "Just a moment..." page is named, never attempted again, never faked')
    B = g.site.base
    mark = g.site.mark()
    res = g.run_qapass(ctx_bot(B), settings(widths='375'))
    reqs = g.site.since(mark)
    dump('bot', res, reqs)
    common_after_run(res, g)
    rec = res.get('rec') or {}
    ck = by_id(rec)
    for cid in ('A.v0', 'E.v0', 'F.v0'):
        c = ck.get(cid) or {}
        chk('%s is blocked by a bot check' % cid, (c.get('status'), c.get('blockedBy')) == ('blocked', 'bot'), c)
    b = ck.get('B.control-prod') or {}
    chk('B.control-prod is blocked or not tested', b.get('status') in ('blocked', 'not-tested'), b)
    blocked = [r for r in reqs if r[0] == '/blocked/']
    chk('/blocked/ was requested at most once per role (preview, PROD)', 1 <= len(blocked) <= 2, blocked)
    sweep_loads = [l for l in rec.get('loads') or [] if l.get('role') == 'sweep']
    chk('and no sweep load followed the block', not sweep_loads, len(sweep_loads))
    text = res.get('report_text') or ''
    nt = [i for i, l in enumerate(text.split('\n')) if l.strip() == 'Not tested']
    after = '\n'.join(text.split('\n')[nt[0]:]) if nt else ''
    chk('the report lists the bot check under Not tested', bool(nt) and 'bot check' in after, after[:300])
    chk('and prints no optimizely_ text', 'optimizely_' not in text)
    paste_ids = [p.get('checkId') for p in (rec.get('sheet') or {}).get('paste') or []]
    chk('the bot-blocked checks are not in the paste table (an environment fact, never a build bug)', not ({'A.v0', 'E.v0', 'F.v0'} & set(paste_ids)), paste_ids)
    return res


def scen_live(g):
    print('live: a live experiment buckets every plain visitor, so PROD is swept by resizing one tab per device')
    B = g.site.base
    mark = g.site.mark()
    res = g.run_qapass(ctx_live(B), settings(checks='ABE', widths='360,375', prod_mobile=True))
    reqs = g.site.since(mark)
    dump('live', res, reqs)
    common_after_run(res, g)
    rec = res.get('rec') or {}
    note('run took %s s, %d loads' % (res['seconds'], len(rec.get('loads') or [])))
    pp = (rec.get('controlVsProd') or {}).get('prodProbe') or {}
    chk('live: the plain PROD load showed the live experiment 9002', pp.get('activeIds') == ['9002'], pp)
    rows = (rec.get('sweep') or {}).get('rows') or []
    prod_rows = [r for r in rows if r.get('role') == 'prod']
    chk('live: every PROD sweep row is in resize mode (6 rows: desktop, iPhone, Android at 360 and 375)',
        len(prod_rows) == 6 and all(r.get('mode') == 'resize' for r in prod_rows), [(r.get('profile'), r.get('mode')) for r in prod_rows])
    tgt = next((t for t in ((rec.get('sweep') or {}).get('plan') or {}).get('targets') or [] if t.get('label') == 'PROD'), {})
    chk('live: the sweep plan names PROD in resize mode', tgt.get('mode') == 'resize', tgt)
    prod_sweep = [l for l in rec.get('loads') or [] if l.get('role') == 'sweep' and l.get('label') == 'PROD']
    chk('live: PROD was loaded 3 times for the sweep (one per device profile), not 6', len(prod_sweep) == 3, len(prod_sweep))
    var_rows = [r for r in rows if r.get('role') == 'variant']
    chk('live: the variants are still swept by reload (4 rows)', len(var_rows) == 4 and all(r.get('mode') == 'reload' for r in var_rows),
        [(r.get('target'), r.get('mode')) for r in var_rows])
    plain = [r for r in reqs if r[0] == '/shop-live/' and r[1] == '']
    chk('live: the site saw exactly 4 plain PROD requests (phase B + 3 sweep loads)', len(plain) == 4, plain)
    flagged = [r for r in reqs if 'optimizely_force_tracking' in r[1]]
    chk('live: no request carried optimizely_force_tracking', not flagged, flagged)
    text = res.get('report_text') or ''
    fv = FV_LINE % (5, 1, 1, 0, 3) + FV_RESIZE_LIVE_9002
    chk('live: the report foot names the 5 fresh visitors and the live experiment as the reason', fv in text, [l for l in text.split('\n') if 'Fresh visitors' in l])
    problems = (res.get('report') or {}).get('problems') or []
    chk('live: Run Diagnostics carries the same line as an info under qa-pass/sweep',
        any(p.get('severity') == 'info' and p.get('where') == 'qa-pass/sweep' and p.get('detail') == fv for p in problems),
        [(p.get('severity'), p.get('where')) for p in problems])
    chk('live: and the report prints no optimizely_ text', 'optimizely_' not in text)
    return res


def scen_starz(g):
    print('starz: a real Optimizely site, plain home page, no query string')
    if os.environ.get('GATE_ALLOW_REAL_SITE') != '1':
        print('  SKIPPED starz: it loads a real client site (https://www.starz.com/us/en/); set GATE_ALLOW_REAL_SITE=1 to run it')
        return None
    res = g.run_qapass(ctx_starz(), settings(checks='ACEF', widths='375,1280', prod_mobile=False))
    dump('starz', res, [])
    common_after_run(res, g)
    rec = res.get('rec') or {}
    ck = by_id(rec)
    chk('the record has the 23 keys', sorted(rec.keys()) == sorted(RECORD_KEYS))
    chk('catalog.counts.events > 0', ((rec.get('catalog') or {}).get('counts') or {}).get('events', 0) > 0, (rec.get('catalog') or {}).get('counts'))
    chk('C.goal.1 passed', (ck.get('C.goal.1') or {}).get('status') == 'passed', ck.get('C.goal.1'))
    chk('A.v0 is in progress (forces no variation)', (ck.get('A.v0') or {}).get('status') == 'in-progress', ck.get('A.v0'))
    rows = (rec.get('sweep') or {}).get('rows') or []
    chk('4 sweep rows, each ok or with a load error', len(rows) == 4 and all(r.get('ok') or isinstance(r.get('loadError'), str) for r in rows), rows)
    for r in rows:
        note('%s %s %spx: offenders=%s' % (r.get('target'), r.get('profile'), r.get('width'), (r.get('scan') or {}).get('offenderCount')))
    return res


SCENARIOS = {'main': scen_main, 'strict': scen_strict, 'bot': scen_bot, 'live': scen_live, 'starz': scen_starz}

if __name__ == '__main__':
    if '--list' in sys.argv[1:]:
        print('\n'.join(SCENARIOS))
        sys.exit(0)
    names = sys.argv[1:] or list(SCENARIOS)
    unknown = [n for n in names if n not in SCENARIOS]
    if unknown:
        sys.exit('unknown scenario(s): %s (try --list)' % ', '.join(unknown))
    if not OUT:
        OUT = tempfile.mkdtemp(prefix='selenite_qapass_out_')
    print('output directory: ' + OUT)
    g = Gate()
    try:
        print('extension %s loaded, panel window %s, fixture shop %s' % (g.ext, g.win, g.site.base))
        for n in names:
            SCENARIOS[n](g)
    finally:
        g.close()
    print('\n=== %d passed, %d failed ===' % (passed, failed))
    for f in fails:
        print('  -', f)
    sys.exit(1 if failed else 0)
