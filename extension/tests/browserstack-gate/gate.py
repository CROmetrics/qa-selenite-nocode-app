"""End-to-end gate for the BrowserStack Live work: the REAL Selenite extension (this checkout) in REAL branded
Chrome, against a fake live.browserstack.com built from what was measured on the real dashboard (see README.md).
It drives the real panel, worker, page reader, launch watcher and DevTools tap.

  python3 -I -u gate.py [scenario ...]       (no scenario: all of them)
  python3 -I -u gate.py --list

Needs: macOS or Linux with Google Chrome 154+ (CHROME_BIN to point at it), python3, openssl.
  GATE_PORT         port for the fake Live (default 8443)
  GATE_REAL_LOCAL   use the BrowserStack Local app on this machine instead of the built-in fake
"""
import json, os, shutil, sys, tempfile, time
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Browser
import fake_live

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.abspath(os.path.join(HERE, '..', '..'))          # extension/, loaded unpacked
PORT = int(os.environ.get('GATE_PORT', '8443'))
REAL_LOCAL = bool(os.environ.get('GATE_REAL_LOCAL'))
PROFILE = os.path.join(tempfile.gettempdir(), 'selenite_gate_profile_%d' % os.getpid())
REAL_BINARY = 'http://127.0.0.1:45691'

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
        print('  FAIL ' + name + ('   -> ' + json.dumps(detail)[:300] if detail is not None else ''))


class Gate:
    def __init__(self):
        self.b = None
        self.cert_dir = tempfile.mkdtemp(prefix='selenite_gate_cert_')
        try:
            self._start()
        except BaseException:
            self.close()
            raise

    def _start(self):
        if os.path.exists(PROFILE):
            shutil.rmtree(PROFILE)
        self.srv = fake_live.serve(PORT, self.cert_dir)
        # The Local app the panel talks to: a fake one on free ports, unless the real app is asked for.
        self.local_binary = self.local_console = None
        if not REAL_LOCAL:
            self.local_binary, self.local_console, self.local_servers = fake_live.serve_local()
        self.b = Browser([
            '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
            '--user-data-dir=' + PROFILE, '--no-first-run', '--no-default-browser-check',
            '--ignore-certificate-errors', '--force-color-profile=srgb',
            '--host-resolver-rules=MAP live.browserstack.com 127.0.0.1:%d,MAP www.browserstack.com 127.0.0.1:%d' % (PORT, PORT),
            '--window-size=1400,900', 'about:blank',
        ])
        self.ext = self.b.load_extension(EXT)
        w = self.b.find_target(lambda t: t['type'] == 'service_worker' and t['url'] == 'chrome-extension://%s/background.js' % self.ext)
        self.worker = self.b.attach(w['targetId'])
        # the worker can be listed before its bindings exist
        for _ in range(60):
            try:
                if self.b.ev(self.worker, "typeof chrome !== 'undefined' && typeof followTab !== 'undefined'"):
                    break
            except Exception:
                pass
            time.sleep(0.25)
        self.panel = None

    def open_panel(self):
        # one panel at a time, and no Live tab left over from the scenario before
        if getattr(self, 'panel_target', None):
            try:
                self.b.send('Target.closeTarget', {'targetId': self.panel_target})
            except Exception:
                pass
        self.close_live_tabs()
        end = time.time() + 6
        while time.time() < end and self.b.ev(self.worker, 'bsLaunchWatchers.size') != 0:
            time.sleep(0.25)
        t = self.b.send('Target.createTarget', {'url': 'chrome-extension://%s/popup.html' % self.ext})['targetId']
        self.panel_target = t
        self.panel = self.b.attach(t)
        self.b.send('Runtime.enable', session=self.panel)
        for _ in range(80):
            try:
                if self.b.ev(self.panel, "typeof bsLive !== 'undefined' && !!bsLive && typeof WIN_ID !== 'undefined' && WIN_ID != null"):
                    break
            except Exception:
                pass
            time.sleep(0.25)
        self.win = self.b.ev(self.panel, 'WIN_ID')
        self.restore_local()
        self.pev("sessionNS.remove(['bsLaunch_ab', 'bsLaunch_ft', 'bsLiveTabId']).then(() => { for (const k of ['ab', 'ft']) { _bsLastTab[k] = undefined; _bsRenderedAt[k] = 0; setBsLiveStatus(k, ''); } return true; })")
        return self.panel

    def pev(self, expr, **kw):
        return self.b.ev(self.panel, expr, **kw)

    def restore_local(self):
        """Point the panel at the Local app this gate uses (the fake, or the real one on 45691 and 45454)."""
        if self.local_binary:
            self.pev("window.BS_LOCAL_BINARY = %s; window.BS_LOCAL_CONSOLE = %s; true" % (json.dumps(self.local_binary), json.dumps(self.local_console)))
        else:
            self.pev("window.BS_LOCAL_BINARY = %s; true" % json.dumps(REAL_BINARY))

    def status(self, key='ab'):
        return self.pev("(document.querySelector('[data-bs-live=\"%s\"] [data-bs-role=\"status\"]') || {}).innerText || ''" % key)

    def status_html(self, key='ab'):
        return self.pev("(document.querySelector('[data-bs-live=\"%s\"] [data-bs-role=\"status\"]') || {}).innerHTML || ''" % key)

    def wait_status(self, pred, key='ab', timeout=40):
        end = time.time() + timeout
        last = ''
        while time.time() < end:
            last = self.status(key)
            if pred(last):
                return last
            time.sleep(0.4)
        return last

    def live_tabs(self):
        return [t for t in self.b.targets() if t['type'] == 'page' and t['url'].startswith('https://live.browserstack.com/')]

    def close_live_tabs(self):
        for t in self.live_tabs():
            try:
                self.b.send('Target.closeTarget', {'targetId': t['targetId']})
            except Exception:
                pass

    def setup_ab(self, devices, local=True, force=True):
        self.pev("""(() => {
          BS_LIVE_SURFACES.ab.targets = () => [{ key: '0', label: 'Control', url: 'https://example.com/', noUrl: 'none' }];
          bsLive.devices = %s; bsLive.local = %s; bsLive.forceLocal = %s;
          renderBsLiveAll(); return true; })()""" % (json.dumps(devices), json.dumps(local), json.dumps(force)))

    def click_open(self, preset, key='ab'):
        return self.pev("(() => { const b = document.querySelector('[data-bs-live=\"%s\"] [data-bs-open=\"%s\"]'); if (!b) return 'no button'; b.click(); return 'clicked'; })()" % (key, preset))

    def close(self):
        if self.b:
            self.b.close()
        shutil.rmtree(PROFILE, ignore_errors=True)
        shutil.rmtree(self.cert_dir, ignore_errors=True)


def scen_smoke(g):
    print('smoke: the real panel loaded with the BrowserStack section')
    g.open_panel()
    chk('the extension loaded and its panel has a window id', isinstance(g.win, int), g.win)
    chk('the A/B Devices section is in the panel', g.pev("!!document.querySelector('[data-bs-live=\"ab\"]')"))
    chk('the new functions are loaded (page reader, verdict, binary answer)', g.pev("typeof bsLiveReadOutcome === 'function' && typeof bsLaunchVerdict === 'function' && typeof bsLocalBinaryAnswer === 'function'"))
    chk('the worker has the watcher', g.b.ev(g.worker, "typeof bsWatchLaunch === 'function' && typeof bsLiveReadOutcome === 'function'"))
    bin_url = g.pev('BS_LOCAL_BINARY')
    chk('the panel is pointed at the Local app this gate uses (the fake, unless GATE_REAL_LOCAL)', bin_url == (g.local_binary or REAL_BINARY), bin_url)

def watchers(g):
    return g.b.ev(g.worker, 'bsLaunchWatchers.size')


def scen_check(g):
    print('the Check button asks the Local app (the fake one, or the real one with GATE_REAL_LOCAL)')
    g.open_panel(); g.setup_ab(['galaxy-s26'])
    g.pev("document.querySelector('[data-bs-live=\"ab\"] [data-bs-role=\"check\"]').click()")
    t = g.wait_status(lambda t: 'Checking' not in t and t != '', timeout=10)
    chk('the binary answers on the port Live checks: connected, naming that port', 'BrowserStack Local is connected' in t and '127.0.0.1:45691' in t, t)
    chk('and it promises nothing about the session', 'Selenite reports whether Live actually started it with Local' in t, t)
    # the binary port silent, the console up: the case /status alone called "running"
    g.pev("window.BS_LOCAL_BINARY = 'http://127.0.0.1:1'; true")
    g.pev("document.querySelector('[data-bs-live=\"ab\"] [data-bs-role=\"check\"]').click()")
    t = g.wait_status(lambda t: 'Checking' not in t and t != '', timeout=10)
    chk('binary port silent, console signed in: NOT ready, names the port', "nothing answers on the port Live checks (127.0.0.1:45691)" in t, t)
    chk('and says what to do', 'make sure it is connected' in t, t)
    g.restore_local()


def scen_local_missed(g):
    print('Galaxy S26 with Local requested: Live starts it without Local')
    g.open_panel(); g.setup_ab(['galaxy-s26'])
    r = g.click_open('galaxy-s26')
    chk('the button is there and clicks', r == 'clicked', r)
    seen = []
    end = time.time() + 30
    while time.time() < end:
        t = g.status()
        if not seen or seen[-1] != t:
            seen.append(t)
        if 'is running' in t:
            break
        time.sleep(0.25)
    chk('it first says it is waiting, not that it worked', any('Waiting for Live to start the session' in x for x in seen), seen)
    final = seen[-1]
    chk('then says Live started it before it found the Local app, in full, followed by the button',
        final == "Control on Galaxy S26 is running in BrowserStack Live. Live started it before it found your BrowserStack Local app, so pages on localhost, staging or a VPN won't load. Open Live and pick the device myself", final)
    chk('in a warning colour', g.pev("getComputedStyle(document.querySelector('[data-bs-live=\"ab\"] [data-bs-role=\"status\"]')).color") != '', None)
    chk('and offers to open Live so the tester picks the device', 'data-bs-open-manual' in g.status_html(), g.status_html())
    rec = g.pev("sessionNS.get('bsLaunch_ab').then(r => r.bsLaunch_ab)")
    chk('the worker recorded the launch under this window', rec and rec.get('key') == 'ab' and rec.get('presetId') == 'galaxy-s26' and rec.get('pageUrl') == 'https://example.com/' and rec['verdict']['state'] == 'started' and rec['verdict']['local'] is False, rec)
    time.sleep(1.5)
    chk('the watch has ended or is about to (it stops after the settle window, not before)', watchers(g) in (0, 1), watchers(g))
    # the manual route
    before = {t['targetId'] for t in g.live_tabs()}
    g.pev("document.querySelector('[data-bs-live=\"ab\"] [data-bs-open-manual]').click(); true")
    time.sleep(2)
    tabs = [t for t in g.live_tabs() if t['targetId'] not in before]
    chk('the manual button opens a new Live tab', len(tabs) == 1, [t['url'] for t in g.live_tabs()])
    url = tabs[0]['url'] if tabs else ''
    chk('with Local and the page in the link, and NO start=true', 'local=true' in url and 'url=https%3A%2F%2Fexample.com%2F' in url and 'start=' not in url, url)
    t = g.status()
    chk('and tells the tester to pick the device, without promising Local', "When Live's Local Testing panel shows Local connected, pick the device in its list, then check that the page loads on it" in t and 'starts with Local' not in t, t)
    g.close_live_tabs()


def scen_ios27(g):
    print('iPhone 18 Pro: iOS 27 has no DevTools')
    g.open_panel(); g.setup_ab(['iphone-18-pro'])
    g.click_open('iphone-18-pro')
    t = g.wait_status(lambda t: 'is running' in t, timeout=30)
    exp = 'Control on iPhone 18 Pro is running in BrowserStack Live. Local was on when it started. Live ignored "all traffic through this Mac"; switch it on in the session\'s Local panel (that reconnects the session). The console mirror can\'t run on it: Developer tools are disabled because of multiple browser tabs on iOS 27.0 devices. Please close all other tabs to enable.'
    chk('running, Local on, force-local ignored, and the mirror explained in Live\'s own words', t == exp, t)
    chk('no manual button: Local did start', 'data-bs-open-manual' not in g.status_html())
    g.close_live_tabs()


def scen_refused(g):
    print('iPhone 17 at 26.1: Live refuses the device')
    g.open_panel(); g.setup_ab(['iphone-17'])
    link = 'https://live.browserstack.com/dashboard#os=ios&os_version=26.1&device=iPhone+17&device_browser=safari&url=https%3A%2F%2Fexample.com%2F&start=true'
    g.pev("launchBsLiveTab('ab', %s, 'Control on iPhone 17', { presetId: 'iphone-17', pageUrl: 'https://example.com/' })" % json.dumps(link))
    t = g.wait_status(lambda t: "didn't start" in t, timeout=20)
    chk("refused, in Live's own words", t == "Control on iPhone 17 didn't start. Live says: Device is temporarily disabled. Please try again in some time.", t)
    time.sleep(1.5)
    chk('the watch ended', watchers(g) == 0, watchers(g))
    g.close_live_tabs()


def scen_dropped(g):
    print('Pixel 10: starts, then drops')
    g.open_panel(); g.setup_ab(['pixel-10'], local=False)
    g.click_open('pixel-10')
    seen = []
    end = time.time() + 25
    while time.time() < end:
        t = g.status()
        if not seen or seen[-1] != t:
            seen.append(t)
        if "dropped" in t:
            break
        time.sleep(0.2)
    chk('it was reported running first', any(x == 'Control on Pixel 10 is running in BrowserStack Live.' for x in seen), seen)
    chk('then reported dropped (not "didn\'t start": it had), with the banner Live put up', seen[-1] == "Live dropped the session on Control on Pixel 10. Live says: Connection to the remote device failed. Please try again.", seen[-1])
    chk('and never as "didn\'t start" along the way', not any("didn't start" in x for x in seen), seen)
    g.close_live_tabs()


def scen_desktop(g):
    print('Windows Chrome: a desktop session keeps the title "Dashboard"')
    g.open_panel(); g.setup_ab(['win-chrome'], local=False)
    g.click_open('win-chrome')
    t = g.wait_status(lambda t: 'is running' in t, timeout=20)
    chk('it is recognised as running (by its Stop Session control), not left to time out', t == 'Control on Windows Chrome is running in BrowserStack Live.', t)
    g.close_live_tabs()


def scen_not_ready(g):
    print('Local not ready: the launch is held, and "Open anyway" does not claim Local')
    g.open_panel(); g.setup_ab(['galaxy-s26'])
    g.pev("window.BS_LOCAL_BINARY = 'http://127.0.0.1:1'; true")
    g.click_open('galaxy-s26')
    t = g.wait_status(lambda t: 'nothing answers' in t, timeout=10)
    chk('held, with the reason', 'nothing answers on the port Live checks' in t, t)
    chk('and no Live tab was opened', len(g.live_tabs()) == 0, [x['url'] for x in g.live_tabs()])
    chk('"Open anyway" is offered', 'data-bs-open-anyway' in g.status_html(), g.status_html())
    g.pev("document.querySelector('[data-bs-live=\"ab\"] [data-bs-open-anyway]').click(); true")
    t = g.wait_status(lambda t: 'is running' in t, timeout=25)
    chk('after Open anyway the line says Local was not connected (it was not a race Live lost), and does not offer the manual route',
        t == "Control on Galaxy S26 is running in BrowserStack Live. BrowserStack Local wasn't connected when you opened it, so pages on localhost, staging or a VPN won't load.", t)
    chk('no manual button on it', 'data-bs-open-manual' not in g.status_html(), g.status_html())
    g.restore_local()
    g.close_live_tabs()

def poll(fn, cond, timeout=20, step=0.4):
    end = time.time() + timeout
    v = None
    while time.time() < end:
        v = fn()
        if cond(v):
            return v
        time.sleep(step)
    return v


def dev_status(g):
    return g.pev("sessionNS.get('bsDeviceStatus').then(r => r.bsDeviceStatus || null)")


def bc_line(g):
    return g.pev("syncBcStatus().then(() => document.getElementById('bc-status').textContent)")


def live_session(g):
    t = poll(lambda: g.live_tabs(), lambda x: len(x) == 1, 10)
    return g.b.attach(t[0]['targetId'])


def follow(g):
    """The worker follows the active tab by itself; nudge it once if headless Chrome did not activate it."""
    st = poll(lambda: dev_status(g), lambda s: s is not None, 8)
    if st is None:
        g.pev("chrome.runtime.sendMessage({ action: 'reconnectCapture', winId: WIN_ID })")
        st = poll(lambda: dev_status(g), lambda s: s is not None, 10)
    return st


def scen_mirror(g):
    print('the console mirror on an Android session, end to end')
    g.open_panel(); g.setup_ab(['galaxy-s26'], local=False)
    g.click_open('galaxy-s26')
    g.wait_status(lambda t: 'is running' in t, timeout=25)
    follow(g)
    st = poll(lambda: dev_status(g), lambda s: s and s.get('state') == 'closed', 12)
    chk('the worker followed the Live tab and the tap reported closed (DevTools not opened yet)', st and st.get('state') == 'closed', st)
    t = bc_line(g)
    chk('the panel says to open DevTools', t == "○ Open DevTools in the Live session to mirror Samsung Galaxy S26 v16.0's console", t)
    page = live_session(g)
    g.b.ev(page, '__openDevtools()')
    st = poll(lambda: dev_status(g), lambda s: s and s.get('state') == 'connected', 12)
    chk('DevTools opened with a device behind it: connected, with the frontend version', st and st.get('state') == 'connected' and st.get('version') == 'realdroid 91.0.4472.101', st)
    t = bc_line(g)
    chk('the panel says it is mirroring', t == "● Live — mirroring Samsung Galaxy S26 v16.0 through BrowserStack Live's DevTools", t)
    g.b.ev(page, "document.querySelector('iframe.devtools-iframe').contentWindow.fire('[cro] hello from the device')")
    logs = poll(lambda: g.pev("sessionNS.get('browserConsoleLogs').then(r => r.browserConsoleLogs || [])"), lambda l: any('hello from the device' in (e.get('text') or '') for e in l), 8)
    line = [e for e in logs if 'hello from the device' in (e.get('text') or '')]
    chk("the device's console line reached the Browser Console feed, labelled and tagged", line and line[0].get('source') == 'bs-device' and line[0].get('device') == 'Samsung Galaxy S26 v16.0' and line[0].get('tagged') is True, line)
    # a frame with no device behind it: what the old code called "connected"
    g.b.ev(page, '__state.targets = []')
    st = poll(lambda: dev_status(g), lambda s: s and s.get('state') == 'attaching', 8)
    chk('the frame loses its device: attaching, not connected', st and st.get('state') == 'attaching' and not st.get('late'), st)
    t = bc_line(g)
    chk('the panel says it is waiting for the device to attach', t == '○ DevTools is open in Live; waiting for it to attach to Samsung Galaxy S26 v16.0…', t)
    g.pev("chrome.runtime.sendMessage({ action: 'bcEval', winId: WIN_ID, expression: '1+1' })")
    logs = poll(lambda: g.pev("sessionNS.get('browserConsoleLogs').then(r => r.browserConsoleLogs || [])"), lambda l: any("hasn't attached" in (e.get('text') or '') for e in l), 8)
    chk('a command typed meanwhile is refused with a reason, not run into a void', any("hasn't attached to the device" in (e.get('text') or '') and e.get('level') == 'ERROR' for e in logs), [e.get('text') for e in logs][-3:])
    st = poll(lambda: dev_status(g), lambda s: s and s.get('late') is True, 22)
    chk('after about 15 s without a device it is late', st and st.get('state') == 'attaching' and st.get('late') is True, st)
    t = bc_line(g)
    chk('and the panel says what to do', t == "○ DevTools is open in Live but hasn't attached to Samsung Galaxy S26 v16.0 after 15 s. Close and reopen it in Live, or start a new session.", t)
    g.b.ev(page, '__state.targets = [{ name: "page" }]')
    st = poll(lambda: dev_status(g), lambda s: s and s.get('state') == 'connected', 8)
    chk('the device attaches: connected again', st and st.get('state') == 'connected' and not st.get('late'), st)
    g.pev("chrome.runtime.sendMessage({ action: 'bcEval', winId: WIN_ID, expression: '1+1' })")
    logs = poll(lambda: g.pev("sessionNS.get('browserConsoleLogs').then(r => r.browserConsoleLogs || [])"), lambda l: any(e.get('source') == 'eval-result' and 'device:1+1' in (e.get('text') or '') for e in l), 8)
    chk('and a command now runs on the device', any(e.get('source') == 'eval-result' and 'device:1+1' in (e.get('text') or '') for e in logs), [e.get('text') for e in logs][-3:])
    g.close_live_tabs()


def scen_mirror_nopage(g):
    print('the console mirror on iOS 26: DevTools attached to the device but on an empty tab (an iPhone 17, measured 2026-10-13)')
    g.open_panel(); g.setup_ab(['iphone-17'], local=False)
    g.click_open('iphone-17')
    g.wait_status(lambda t: 'is running' in t, timeout=25)
    follow(g)
    poll(lambda: dev_status(g), lambda s: s and s.get('state') == 'closed', 12)
    page = live_session(g)
    g.b.ev(page, """(() => { __state.noctx = true; __state.targets = [{ name: 'page', runtimeAgent: function () { return { invoke_evaluate: function (p) {
        window.__probes = (window.__probes || []).concat([p.expression]);
        return Promise.resolve({ result: { type: 'string', value: 'about:blank' }, wasThrown: false }); } }; } }]; return true; })()""")
    g.b.ev(page, '__openDevtools()')
    seen = []
    end = time.time() + 10
    while time.time() < end:
        t = bc_line(g)
        if not seen or seen[-1] != t:
            seen.append(t)
        if t.startswith("○ Live's DevTools on"):
            break
        time.sleep(0.3)
    chk('the panel never says it is mirroring a device that has no page', not any('mirroring' in x for x in seen), seen)
    st = poll(lambda: dev_status(g), lambda s: s and s.get('state') == 'nopage', 12)
    chk('the worker records nopage, on an empty tab', st and st.get('state') == 'nopage' and st.get('page') == 'blank' and st.get('version') == 'realios 91.0.4472.101', st)
    t = bc_line(g)
    chk('the panel line says DevTools is on an empty tab, not the page under test', t == "○ Live's DevTools on iPhone 17 v16.0 is attached to an empty tab (about:blank), not the page under test, so there's nothing to mirror and commands can't run.", t)
    inp = g.pev("(() => { const i = document.getElementById('bc-eval-input'); return { disabled: i.disabled, ph: i.placeholder }; })()")
    chk('the command box is off and says why', inp == {'disabled': True, 'ph': "> Live's DevTools has no page on the device to run commands in"}, inp)
    probes = g.b.ev(page, 'window.__probes || []')
    chk('the page was read with location.href, once', probes == ['location.href'], probes)
    g.pev("chrome.runtime.sendMessage({ action: 'bcEval', winId: WIN_ID, expression: '1+1' })")
    logs = poll(lambda: g.pev("sessionNS.get('browserConsoleLogs').then(r => r.browserConsoleLogs || [])"), lambda l: any('empty tab' in (e.get('text') or '') for e in l), 8)
    chk('a command sent anyway is refused: the tab is empty (not "wait, or reload")', any('attached to an empty tab (about:blank)' in (e.get('text') or '') and e.get('level') == 'ERROR' for e in logs), [e.get('text') for e in logs][-3:])
    g.b.ev(page, '__state.noctx = false')
    st = poll(lambda: dev_status(g), lambda s: s and s.get('state') == 'connected', 8)
    chk('a page context arriving: connected', st and st.get('state') == 'connected' and 'page' not in st, st)
    t = bc_line(g)
    chk('and the panel says it is mirroring', t == "● Live — mirroring iPhone 17 v16.0 through BrowserStack Live's DevTools", t)
    g.close_live_tabs()

def scen_mirror_failed(g):
    print("the console mirror when Live's DevTools breaks: its frame unreadable, Live's notice on the dashboard (measured 2026-10-13)")
    g.open_panel(); g.setup_ab(['galaxy-s26'], local=False)
    g.click_open('galaxy-s26')
    g.wait_status(lambda t: 'is running' in t, timeout=25)
    follow(g)
    poll(lambda: dev_status(g), lambda s: s and s.get('state') == 'closed', 12)
    page = live_session(g)
    g.b.ev(page, '__openDevtoolsBroken()')
    t0 = time.time()
    st = poll(lambda: dev_status(g), lambda s: s and s.get('state') == 'failed', 10)
    took = time.time() - t0
    notice = 'Developer tools have experienced an unexpected issue. Please try a new session.'
    chk("failed, in Live's words, within seconds (0.7.12 waited 30 s, then said unsupported)", st and st.get('state') == 'failed' and st.get('reason') == notice and took < 6, [st, round(took, 1)])
    t = bc_line(g)
    chk('the panel line says Live\'s DevTools failed, and why', t == "○ Live's DevTools failed on Samsung Galaxy S26 v16.0: " + notice, t)
    inp = g.pev("document.getElementById('bc-eval-input').disabled")
    chk('the command box is off', inp is True, inp)
    g.pev("chrome.runtime.sendMessage({ action: 'bcEval', winId: WIN_ID, expression: '1+1' })")
    logs = poll(lambda: g.pev("sessionNS.get('browserConsoleLogs').then(r => r.browserConsoleLogs || [])"), lambda l: any('DevTools failed' in (e.get('text') or '') for e in l), 8)
    chk("a command sent anyway is refused with Live's reason", any(e.get('text') == "Live's DevTools failed: " + notice and e.get('level') == 'ERROR' for e in logs), [e.get('text') for e in logs][-3:])
    seen = set()
    end = time.time() + 32
    while time.time() < end:
        s2 = dev_status(g) or {}
        seen.add(s2.get('state'))
        time.sleep(1)
    chk('past the 30 s a frame gets to come up, it is still failed, never unsupported', seen == {'failed'}, sorted(x for x in seen if x))
    g.close_live_tabs()

def scen_countdown(g):
    print("Live's idle countdown retitles the tab every second: the device keeps its name (measured 2026-10-14)")
    g.open_panel(); g.setup_ab(['galaxy-s26'], local=False)
    g.click_open('galaxy-s26')
    g.wait_status(lambda t: 'is running' in t, timeout=25)
    follow(g)
    page = live_session(g)
    g.b.ev(page, '__openDevtools()')
    poll(lambda: dev_status(g), lambda s: s and s.get('state') == 'connected', 12)
    titles, lines = set(), set()
    for n in range(60, 52, -1):
        g.b.ev(page, 'document.title = "%d seconds to session timeout"' % n)
        if n == 56:
            g.b.ev(page, "document.querySelector('iframe.devtools-iframe').contentWindow.fire('[cro] during the countdown')")
        time.sleep(0.9)
        cs = g.pev("sessionNS.get('captureStatus').then(r => r.captureStatus || null)") or {}
        titles.add(cs.get('title'))
        lines.add(bc_line(g))
    chk('the worker keeps the device name in captureStatus through the countdown', titles == {'Samsung Galaxy S26 v16.0'}, sorted(x for x in titles if x))
    chk('the console line names the device, never the countdown', lines == {"● Live — mirroring Samsung Galaxy S26 v16.0 through BrowserStack Live's DevTools"}, sorted(lines))
    logs = poll(lambda: g.pev("sessionNS.get('browserConsoleLogs').then(r => r.browserConsoleLogs || [])"), lambda l: any('during the countdown' in (e.get('text') or '') for e in l), 8)
    line = [e for e in logs if 'during the countdown' in (e.get('text') or '')]
    chk('a device line logged during the countdown is labelled with the device', line and line[0].get('device') == 'Samsung Galaxy S26 v16.0', line)
    g.b.ev(page, '__endSession()')
    t = g.wait_status(lambda t: 'ended the session' in t, timeout=15)
    chk('when Live closes the session the line says it ended', t == 'Live ended the session on Control on Galaxy S26.', t)
    g.close_live_tabs()

def scen_loading_title(g):
    print("a Live tab titled with its own address while it loads is not a device (measured 2026-10-14 on Mac Safari)")
    fake_live.TITLE_LATE = True
    try:
        g.open_panel(); g.setup_ab(['mac-safari'], local=False)
        g.click_open('mac-safari')
        named, titles, raw = set(), set(), set()
        end = time.time() + 25
        while time.time() < end:
            named.add(bc_line(g))
            cs = g.pev("sessionNS.get('captureStatus').then(r => r.captureStatus || null)") or {}
            titles.add(cs.get('title'))
            for t in g.live_tabs():
                raw.add(t.get('title'))
            if 'is running' in g.status():
                break
            time.sleep(0.1)
        chk("the tab really was titled with its address for a while (the condition is real)", any('live.browserstack.com' in (x or '') for x in raw), sorted(x for x in raw if x))
        chk('nothing in the panel named it by that address', not any('browserstack.com' in (x or '') for x in named | titles), sorted(x for x in named | titles if x and 'browserstack.com' in x))
        t = bc_line(g)
        chk('and the line ends on the desktop wording', t.startswith('○ Live has no DevTools for this session') or t.startswith("○ Open DevTools in the Live session to mirror this session's console"), t)
    finally:
        fake_live.TITLE_LATE = False
        g.close_live_tabs()

def scen_mirror_slow(g):
    print('the mirror when Live is slow to answer: the tab has no committed url when Selenite first looks at it')
    fake_live.DELAY = 1.3
    try:
        g.open_panel(); g.setup_ab(['galaxy-s26'], local=False)
        g.click_open('galaxy-s26')
        g.wait_status(lambda t: 'is running' in t, timeout=30)
        # no nudge: the worker has to follow the tab by itself, as it does for a tester
        st = poll(lambda: dev_status(g), lambda s: s and s.get('state') == 'closed', 15)
        chk('the worker follows, by itself, a tab that was still loading when it was first looked at', st and st.get('state') == 'closed', st)
        cs = g.pev("sessionNS.get('captureStatus').then(r => r.captureStatus || null)")
        chk('and its captureStatus names the device (Live renames the tab after it starts)', cs and cs.get('title') == 'Samsung Galaxy S26 v16.0' and cs.get('capturable') is True, cs)
        t = bc_line(g)
        chk('the panel says to open DevTools, naming the device', t == "○ Open DevTools in the Live session to mirror Samsung Galaxy S26 v16.0's console", t)
        page = live_session(g)
        g.b.ev(page, '__openDevtools()')
        st = poll(lambda: dev_status(g), lambda s: s and s.get('state') == 'connected', 12)
        chk('and DevTools opening is seen: connected', st and st.get('state') == 'connected', st)
    finally:
        fake_live.DELAY = 0.0
        g.close_live_tabs()


def scen_mirror_unavailable(g):
    print('the console mirror where Live has no DevTools: iOS 27, and a desktop browser')
    g.open_panel(); g.setup_ab(['iphone-18-pro'], local=False)
    g.click_open('iphone-18-pro')
    g.wait_status(lambda t: 'is running' in t, timeout=25)
    follow(g)
    st = poll(lambda: dev_status(g), lambda s: s and s.get('state') == 'unavailable', 12)
    exp = 'Developer tools are disabled because of multiple browser tabs on iOS 27.0 devices. Please close all other tabs to enable.'
    chk("iOS 27: unavailable, with Live's own reason (the missing space restored)", st and st.get('state') == 'unavailable' and st.get('reason') == exp, st)
    t = bc_line(g)
    chk('the panel line says Live has none and why', t == '○ Live has no DevTools for iPhone 18 Pro v27.0: ' + exp, t)
    ph = g.pev("document.getElementById('bc-eval-input').placeholder")
    chk('and the command box says commands cannot run there', ph == "> Live has no DevTools for this device, so commands can't run on it", ph)
    g.close_live_tabs()
    g.open_panel(); g.setup_ab(['win-chrome'], local=False)
    g.click_open('win-chrome')
    g.wait_status(lambda t: 'is running' in t, timeout=25)
    follow(g)
    st = poll(lambda: dev_status(g), lambda s: s and s.get('state') == 'unavailable', 12)
    chk('desktop browser: unavailable, saying only what was seen (two scans in a row)', st and st.get('state') == 'unavailable' and st.get('reason') == 'its toolbar has no DevTools item (desktop browser sessions have none).', st)
    t = bc_line(g)
    chk('and the panel does not call the tab "Dashboard"', t == "○ Live has no DevTools for this session: its toolbar has no DevTools item (desktop browser sessions have none).", t)
    g.close_live_tabs()

def scen_panels(g):
    print('both panel pages boot cleanly and render the new checklist marker')
    for page in ('popup.html', 'sidepanel.html'):
        t = g.b.send('Target.createTarget', {'url': 'chrome-extension://%s/%s' % (g.ext, page)})['targetId']
        sess = g.b.attach(t)
        n0 = len(g.b.events)
        g.b.send('Runtime.enable', session=sess)
        g.b.send('Log.enable', session=sess)
        for _ in range(80):
            try:
                if g.b.ev(sess, "typeof bsLive !== 'undefined' && !!bsLive && document.querySelectorAll('[data-bs-live]').length >= 1"):
                    break
            except Exception:
                pass
            time.sleep(0.25)
        time.sleep(1.5)
        n_sections = g.b.ev(sess, "document.querySelectorAll('[data-bs-live]').length")
        chk(page + ': the A/B Devices and Functional Testing sections both rendered', n_sections == 2, n_sections)
        marks = g.b.ev(sess, "document.querySelectorAll('[data-bs-live=\"ab\"] [data-bs-nomirror]').length")
        chk(page + ': the checklist marks the 6 presets with no console mirror (2 on iOS 27, 4 desktop)', marks == 6, marks)
        tips = g.b.ev(sess, "[...document.querySelectorAll('[data-bs-live=\"ab\"] [data-bs-nomirror]')].map(e => e.title)")
        chk(page + ': and each says why (the desktop ones and the iOS 27 ones in their own words)', len(tips) == 6 and sum('desktop browser sessions' in t for t in tips) == 4 and sum('iOS 27' in t for t in tips) == 2, tips)
        labels = g.b.ev(sess, "[...document.querySelectorAll('[data-bs-live=\"ab\"] [data-bs-dev]')].map(i => i.closest('label').innerText.replace(/\\s+/g, ' ').trim())")
        chk(page + ': the iPhone 17 row reads iOS 26 (not 26.1)', any(l.startswith('iPhone 17 iOS 26 · Safari') for l in labels), labels)
        mine = [e for e in g.b.events[n0:] if e.get('sessionId') == sess]
        errs = [e for e in mine if e['method'] == 'Runtime.exceptionThrown' or (e['method'] == 'Runtime.consoleAPICalled' and e['params'].get('type') == 'error')]
        chk(page + ': no uncaught exception and no console.error while booting', not errs, [json.dumps(e['params'])[:200] for e in errs][:3])
        tip2 = g.b.ev(sess, "(document.querySelector('[data-bs-live=\"ab\"] [data-bs-role=\"check\"]') || {}).title")
        chk(page + ': the Check button tooltip names the port Live checks', '127.0.0.1:45691' in tip2, tip2)
        g.b.send('Target.closeTarget', {'targetId': t})


def s26_link(extra=''):
    return ('https://live.browserstack.com/dashboard#os=android&os_version=16.0&device=Samsung+Galaxy+S26&device_browser=chrome'
            '&url=https%3A%2F%2Fexample.com%2F&start=true' + extra)


def launch(g, key, link, what, preset, page='https://example.com/', **opts):
    o = dict(opts); o['presetId'] = preset; o['pageUrl'] = page
    g.pev('launchBsLiveTab(%s, %s, %s, %s)' % (json.dumps(key), json.dumps(link), json.dumps(what), json.dumps(o)))


def record(g, key='ab'):
    return g.pev("sessionNS.get('bsLaunch_%s').then(r => r.bsLaunch_%s || null)" % (key, key))


def scen_closed(g):
    print('closing the Live tab says so: before it started, and after')
    g.open_panel(); g.setup_ab(['galaxy-s26'], local=False)
    g.click_open('galaxy-s26')
    t = g.wait_status(lambda t: 'Waiting for Live to start the session' in t, timeout=10)
    chk('waiting, as soon as the tab is open', 'Waiting for Live to start the session' in t, t)
    g.close_live_tabs()
    t = g.wait_status(lambda t: 'was closed' in t, timeout=10)
    chk('the tab is closed before Live started anything: the line says so', t == 'The Live tab for Control on Galaxy S26 was closed before it started.', t)
    rec = record(g)
    chk('recorded as closed, not started', rec and rec['verdict']['state'] == 'closed' and rec['verdict']['wasStarted'] is False, rec)
    chk('and the watch has ended', poll(lambda: watchers(g), lambda n: n == 0, 4) == 0, watchers(g))
    # after it started
    g.setup_ab(['galaxy-s26'], local=False)
    g.click_open('galaxy-s26')
    t = g.wait_status(lambda t: 'is running' in t, timeout=20)
    chk('a second launch starts', 'is running' in t, t)
    g.close_live_tabs()
    t = g.wait_status(lambda t: 'was closed' in t, timeout=10)
    chk('closed after it started: the line says so, without "before it started"', t == 'The Live tab for Control on Galaxy S26 was closed.', t)


def scen_left(g):
    print('Live sends the tab to sign in: say where, keep watching, and follow the session when it starts')
    g.open_panel(); g.setup_ab(['galaxy-s26'], local=False)
    launch(g, 'ab', s26_link('&sim=signin'), 'Control on Galaxy S26', 'galaxy-s26')
    t = g.wait_status(lambda t: 'went to' in t, timeout=15)
    chk('the line names the host it went to, and what to do', t == 'The Live tab went to www.browserstack.com instead of the dashboard. If that is a sign-in page, sign in to BrowserStack there; if Live then starts the device, this line follows it. If not, open Control on Galaxy S26 again.', t)
    rec = record(g)
    chk('the record holds the host only: nothing of the path or query', rec and rec['verdict'] == {'state': 'left', 'host': 'www.browserstack.com'}, rec)
    chk('and the watch goes on (the tab may come back)', watchers(g) == 1, watchers(g))
    tabs = g.live_tabs()
    other = [t for t in g.b.targets() if t['type'] == 'page' and 'www.browserstack.com' in t['url']]
    chk('the tab really is on the other host', len(other) == 1, [t['url'] for t in g.b.targets() if t['type'] == 'page'])
    # the tester signs in; Live brings them back and starts the device
    sess = g.b.attach(other[0]['targetId'])
    g.b.send('Runtime.enable', session=sess)
    g.b.send('Runtime.evaluate', {'expression': "location.href = %s" % json.dumps(s26_link())}, session=sess)
    t = g.wait_status(lambda t: 'is running' in t, timeout=25)
    chk('back on the dashboard and started: the same line follows it', t == 'Control on Galaxy S26 is running in BrowserStack Live.', t)
    g.close_live_tabs()


def scen_toast(g):
    print('an error toast while the session is running is not a refusal')
    g.open_panel(); g.setup_ab(['galaxy-s26'], local=False)
    launch(g, 'ab', s26_link('&sim=toast'), 'Control on Galaxy S26', 'galaxy-s26')
    seen = []
    end = time.time() + 12
    while time.time() < end:
        t = g.status()
        if not seen or seen[-1] != t:
            seen.append(t)
        time.sleep(0.2)
    page = live_session(g)
    banners = g.b.ev(page, "document.querySelectorAll('.notification-message-banner--error').length")
    chk('the toast really was on the page', banners == 1, banners)
    chk('and the line says running, and never refused or dropped', seen[-1] == 'Control on Galaxy S26 is running in BrowserStack Live.' and not any("didn't start" in x or 'dropped' in x for x in seen), seen)
    rec = record(g)
    chk('the record says started', rec and rec['verdict']['state'] == 'started', rec)
    g.close_live_tabs()


def scen_relaunch(g):
    print('two launches in quick succession from one place: one tab, the later one, and no "closed" for the earlier')
    g.open_panel(); g.setup_ab(['galaxy-s26', 'iphone-18-pro'], local=False)
    g.click_open('galaxy-s26')
    g.click_open('iphone-18-pro')
    seen = []
    end = time.time() + 14
    while time.time() < end:
        t = g.status()
        if not seen or seen[-1] != t:
            seen.append(t)
        time.sleep(0.1)
    chk('one Live tab is left, the later launch', len(g.live_tabs()) == 1 and 'iPhone+18+Pro' in g.live_tabs()[0]['url'], [x['url'] for x in g.live_tabs()])
    chk('the line never said the earlier tab was closed', not any('was closed' in x for x in seen), seen)
    chk('and ends on the later launch', seen[-1].startswith('Control on iPhone 18 Pro is running'), seen[-1])
    rec = record(g)
    chk('the record is the later launch\'s', rec and rec['what'] == 'Control on iPhone 18 Pro' and rec['verdict']['state'] == 'started', rec)
    g.close_live_tabs()


def scen_places(g):
    print('a launch from Functional Testing has its own record and its own line')
    g.open_panel(); g.setup_ab(['galaxy-s26'], local=False)
    launch(g, 'ft', s26_link(), 'the start URL on Galaxy S26', 'galaxy-s26')
    t = g.wait_status(lambda t: 'is running' in t, key='ft', timeout=20)
    chk('the Functional Testing line reports it', t == 'the start URL on Galaxy S26 is running in BrowserStack Live.', t)
    chk('the A/B line is untouched', g.status('ab') == '', g.status('ab'))
    ft, ab = record(g, 'ft'), record(g, 'ab')
    chk('one record under bsLaunch_ft, none under bsLaunch_ab', ft and ft['key'] == 'ft' and ab is None, [ft and ft['key'], ab])
    g.close_live_tabs()


def win_chrome_link(extra=''):
    return ('https://live.browserstack.com/dashboard#os=Windows&os_version=11&browser=chrome&browser_version=154.0'
            '&url=https%3A%2F%2Fexample.com%2F&start=true&local=true&force-local=true' + extra)


def sample_status(g, seconds, key='ab', step=0.15):
    seen = []
    end = time.time() + seconds
    while time.time() < end:
        t = g.status(key)
        if not seen or seen[-1] != t:
            seen.append(t)
        time.sleep(step)
    return seen


def scen_vanish(g):
    print('a desktop session whose toolbar goes away for 4 s is not "ended" (measured on Windows Chrome and iOS 27)')
    g.open_panel(); g.setup_ab(['win-chrome'], local=True)
    launch(g, 'ab', win_chrome_link('&sim=vanish'), 'Control on Windows Chrome', 'win-chrome', wantLocal=True, wantForceLocal=True)
    seen = sample_status(g, 14)
    page = live_session(g)
    chk('the toolbar really did go away and come back on the page', g.b.ev(page, "!!document.querySelector('[aria-label=\"Stop Session\"]')") is True, None)
    chk('the line never said Live ended the session', not any('ended the session' in x for x in seen), seen)
    chk('it ended up saying it is running, with Local from the toolbar', seen[-1] == 'Control on Windows Chrome is running in BrowserStack Live. Local was on when it started. Live ignored "all traffic through this Mac"; switch it on in the session\'s Local panel (that reconnects the session).', seen[-1])
    rec = record(g)
    chk('and the record says started, with the toolbar seen', rec and rec['verdict']['state'] == 'started' and rec['verdict']['toolbar'] is True and rec['verdict']['local'] is True, rec)
    g.close_live_tabs()


def scen_early_title(g):
    print('a phone whose title says running before its toolbar: no false "Live started it before it found Local"')
    g.open_panel(); g.setup_ab(['galaxy-s26'], local=True)
    launch(g, 'ab', s26_link('&local=true&force-local=true&sim=lag'), 'Control on Galaxy S26', 'galaxy-s26', wantLocal=True, wantForceLocal=False)
    seen = sample_status(g, 9)
    chk('the line never claimed Live started it before it found Local (that is only known once the toolbar is up)', not any('before it found' in x for x in seen), seen)
    chk('it said it was running before the toolbar came up', any(x == 'Control on Galaxy S26 is running in BrowserStack Live.' for x in seen), seen)
    chk('and settled on Local having been on', seen[-1] == 'Control on Galaxy S26 is running in BrowserStack Live. Local was on when it started.', seen[-1])
    chk('with no manual button', 'data-bs-open-manual' not in g.status_html(), g.status_html())
    g.close_live_tabs()


def scen_ended(g):
    print('stopping the session in Live: the picker comes back and the line says it ended')
    g.open_panel(); g.setup_ab(['galaxy-s26'], local=False)
    g.click_open('galaxy-s26')
    t = g.wait_status(lambda t: 'is running' in t, timeout=20)
    chk('running', 'is running' in t, t)
    page = live_session(g)
    g.b.ev(page, "document.querySelector('[aria-label=\"Stop Session\"]').click()")
    t = g.wait_status(lambda t: 'ended the session' in t, timeout=10)
    chk('the line says Live ended the session', t == 'Live ended the session on Control on Galaxy S26.', t)
    chk('and the watch ended', poll(lambda: watchers(g), lambda n: n == 0, 4) == 0, watchers(g))
    g.close_live_tabs()


def scen_ended_late(g):
    print('stopping the session in Live long after it settled: the line still follows it (seen stale on real Live)')
    g.open_panel(); g.setup_ab(['galaxy-s26'], local=False)
    g.click_open('galaxy-s26')
    t = g.wait_status(lambda t: 'is running' in t, timeout=20)
    chk('running', 'is running' in t, t)
    time.sleep(45)
    chk('45 s on, the watch is still on the tab (it slowed down, it did not stop)', watchers(g) == 1, watchers(g))
    page = live_session(g)
    g.b.ev(page, "document.querySelector('[aria-label=\"Stop Session\"]').click()")
    t = g.wait_status(lambda t: 'ended the session' in t, timeout=12)
    chk('stopped then: the line says Live ended the session', t == 'Live ended the session on Control on Galaxy S26.', t)
    chk('and the watch ended', poll(lambda: watchers(g), lambda n: n == 0, 4) == 0, watchers(g))
    g.close_live_tabs()


SCENARIOS = {'smoke': scen_smoke, 'check': scen_check, 'local-missed': scen_local_missed, 'ios27': scen_ios27,
             'refused': scen_refused, 'dropped': scen_dropped, 'desktop': scen_desktop, 'not-ready': scen_not_ready,
             'mirror': scen_mirror, 'mirror-unavailable': scen_mirror_unavailable, 'mirror-nopage': scen_mirror_nopage, 'mirror-failed': scen_mirror_failed, 'countdown': scen_countdown, 'loading-title': scen_loading_title, 'panels': scen_panels, 'mirror-slow': scen_mirror_slow,
             'closed': scen_closed, 'left': scen_left, 'toast': scen_toast, 'relaunch': scen_relaunch, 'places': scen_places,
             'vanish': scen_vanish, 'early-title': scen_early_title, 'ended': scen_ended, 'ended-late': scen_ended_late}

if __name__ == '__main__':
    if '--list' in sys.argv[1:]:
        print('\n'.join(SCENARIOS))
        sys.exit(0)
    names = sys.argv[1:] or list(SCENARIOS)
    unknown = [n for n in names if n not in SCENARIOS]
    if unknown:
        sys.exit('unknown scenario(s): %s (try --list)' % ', '.join(unknown))
    g = Gate()
    try:
        for n in names:
            SCENARIOS[n](g)
    finally:
        g.close()
    print('\n=== %d passed, %d failed ===' % (passed, failed))
    for f in fails:
        print('  -', f)
    sys.exit(1 if failed else 0)
