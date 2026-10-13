"""A fake https://live.browserstack.com for the Selenite gate.

Everything here is a stand-in for what was MEASURED on the real dashboard on
2026-10-08 (CHANGELOG.md, "Measured on real sessions"):

  - a refused device: a red .notification-message-banner--error, title stays "Dashboard"
  - a running phone/tablet: the tab is renamed "<device> v<os>", a toolbar of
    li.toolbar-list-item items, one of them li.switchDevtools-menu-wrapper
    (aria-disabled="true" on iOS 27 with #devtools_message and a tooltip)
  - a running desktop browser: the title stays "Dashboard", the same toolbar without the DevTools item
  - the dashboard's own Local record: Reactor.localTesting.getLocalStatusAtStart()
  - Live's DevTools: a same-origin iframe.devtools-iframe holding a frontend with
    SDK.ConsoleModel / SDK.targetManager / UI.context (targets() is empty while it has not attached; with
    __state.noctx a target has no page context, as on iOS 26, and its runtimeAgent says the tab is about:blank)

The scenario is chosen by the `device` / `browser` in the link's hash, exactly as the
real dashboard reads its own link. A `sim` parameter (unknown to the real dashboard)
picks a variant of a scenario.
"""
import http.server, os, ssl, subprocess, sys, threading, time

# Seconds the dashboard takes to answer. The real one needs DNS, TLS and a round trip, so a tab
# opened for it has no committed url for a while (tab.url is '' and only pendingUrl is set).
DELAY = 0.0

DASHBOARD = r"""<!doctype html>
<html><head><meta charset="utf-8"><title>Dashboard</title></head>
<body>
<div id="app"></div>
<script>
(function () {
  var q = new URLSearchParams(location.hash.slice(1));
  var device = q.get('device') || '';
  var browser = q.get('browser') || '';
  var osv = q.get('os_version') || '';
  var sim = q.get('sim') || '';
  var STATE = { local: sim.indexOf('localok') > -1, force: false, targets: [{ name: 'page' }] };
  window.__state = STATE;
  window.Reactor = { localTesting: {
    getLocalStatusAtStart: function () { return STATE.local; },
    getIsForceLocalEnable: function () { return STATE.force; },
  } };
  var app = document.getElementById('app');
  function showPicker() {
    if (document.getElementById('device-search-field')) return;
    var i = document.createElement('input');
    i.id = 'device-search-field'; i.setAttribute('aria-label', 'Search devices and browsers'); i.placeholder = 'iPhone 15 iOS 17';
    i.style.cssText = 'width:101px;height:24px;display:block';
    app.insertBefore(i, app.firstChild);
  }
  function hidePicker() { var i = document.getElementById('device-search-field'); if (i) i.remove(); }
  showPicker();
  if (device || browser) setTimeout(hidePicker, 300);
  // the end of a session: the toolbar goes, the title is "Dashboard" and the picker is back
  window.__endSession = function () {
    var ul = document.querySelector('.toolbar__list'); if (ul) ul.remove();
    var dv = document.getElementById('devtools'); if (dv) dv.remove();
    document.title = 'Dashboard'; showPicker();
  };

  function banner(text) {
    var d = document.createElement('div');
    d.className = 'notification-message-banner notification-message-banner--error';
    var h = document.createElement('div'); h.className = 'notification-message-banner__header';
    var p = document.createElement('p'); p.textContent = text; h.appendChild(p); d.appendChild(h);
    document.body.appendChild(d);
  }
  function toolbar(opts) {
    var ul = document.createElement('ul'); ul.className = 'toolbar__list'; ul.setAttribute('role', 'menu');
    var names = ['switch-browser', 'recommend-browser', 'local-testing', 'video-recording'];
    names.forEach(function (n) { var li = document.createElement('li'); li.className = 'toolbar-list-item ' + n + '-menu-wrapper'; li.setAttribute('role', 'menuitem'); ul.appendChild(li); });
    if (opts.devtools) {
      var li = document.createElement('li');
      li.className = 'toolbar-list-item switchDevtools-menu-wrapper' + (opts.devtools === 'disabled' ? ' toolbar-list-item--disabled' : '');
      li.setAttribute('role', 'menuitem');
      li.setAttribute('aria-disabled', opts.devtools === 'disabled' ? 'true' : 'false');
      var btn = document.createElement('div'); btn.id = 'switchDevtools'; btn.setAttribute('role', 'button'); btn.setAttribute('aria-label', 'DevTools');
      var tip = document.createElement('div'); tip.id = 'tooltip-switchDevtools'; tip.className = '__react_component_tooltip';
      tip.textContent = opts.devtools === 'disabled' ? (opts.tip || '') : 'DevTools';
      li.appendChild(btn); li.appendChild(tip); ul.appendChild(li);
    }
    var stop = document.createElement('li'); stop.className = 'toolbar-list-item stop-session-menu-wrapper'; stop.setAttribute('role', 'menuitem');
    var sb = document.createElement('div'); sb.id = 'stop-session'; sb.setAttribute('role', 'button'); sb.setAttribute('aria-label', 'Stop Session');
    sb.addEventListener('click', function () { window.__endSession(); });
    stop.appendChild(sb); ul.appendChild(stop);
    app.appendChild(ul);
    if (opts.message) {
      var root = document.createElement('div'); root.id = 'devtools'; root.className = 'ui-widget-content hide';
      var ov = document.createElement('div'); ov.id = 'devtools_overlay';
      var m = document.createElement('span'); m.id = 'devtools_message'; m.textContent = opts.message;
      ov.appendChild(m); root.appendChild(ov); app.appendChild(root);
    }
  }
  // The DevTools frame, opened by the tester (the test calls this).
  window.__openDevtools = function () {
    var f = document.createElement('iframe');
    f.className = 'devtools-iframe';
    f.src = '/devtools/' + (device.indexOf('iPhone') > -1 || device.indexOf('iPad') > -1 ? 'realios' : 'realdroid') + '/91.0.4472.101/inspector.html?wss=FAKE_JWT_DO_NOT_READ';
    document.body.appendChild(f);
  };
  window.__closeDevtools = function () { var f = document.querySelector('iframe.devtools-iframe'); if (f) f.remove(); };
  // Live's DevTools broken, as measured 2026-10-13: the frame keeps its same-origin src path but its
  // document is cross-origin (a sandboxed frame here), and Live's notice is drawn on the dashboard.
  window.__openDevtoolsBroken = function () {
    var f = document.createElement('iframe');
    f.className = 'devtools-iframe';
    f.setAttribute('sandbox', '');
    f.src = '/devtools/realios/91.0.4472.101/inspector.html?wss=FAKE_JWT_DO_NOT_READ';
    document.body.appendChild(f);
    var n = document.createElement('div'); n.id = 'fake-devtools-error';
    var a = document.createElement('p'); a.textContent = 'Developer tools have experienced an unexpected issue.';
    var b = document.createElement('p'); b.textContent = 'Please try a new session.';
    n.appendChild(a); n.appendChild(b); document.body.appendChild(n);
  };

  function start(title, extra) {
    document.title = title;
    toolbar(extra || {});
    if (sim.indexOf('vanish') > -1) {
      setTimeout(function () { var ul = document.querySelector('.toolbar__list'); if (ul) ul.remove(); }, 1000);
      setTimeout(function () { if (document.title !== 'Dashboard' || window.__desktop) toolbar(extra || {}); }, 5000);
    }
  }

  // Scenarios, as measured.
  if (device === 'iPhone 17' && osv === '26.1') {
    setTimeout(function () { banner('Device is temporarily disabled. Please try again in some time.'); }, 1200);
  } else if (device === 'iPhone 18 Pro' || device === 'iPad Pro 13 2024') {
    setTimeout(function () { document.title = device; }, 500);
    setTimeout(function () {
      STATE.local = true;   // measured: sometimes the dashboard wins its own race
      start(device + ' v27.0', { devtools: 'disabled',
        message: 'Developer tools are disabled because of multiple browser tabs on iOS 27.0 devices.Please close all other tabs to enable.',
        tip: 'Currently DevTools is unavailable for iOS 27.0 Safari' });
    }, 1800);
  } else if (device === 'Google Pixel 10') {
    // starts, then drops ~3 s in (the real one dropped about ten seconds in)
    setTimeout(function () { document.title = device; }, 500);
    setTimeout(function () { start(device + ' v16.0', { devtools: 'enabled' }); }, 1500);
    setTimeout(function () {
      app.innerHTML = ''; document.title = 'Dashboard';
      showPicker();   // the dashboard falls back to its picker as it raises the banner
      banner('Connection to the remote device failed. Please try again.');
    }, 4500);
  } else if (device && sim.indexOf('signin') > -1) {
    // a signed-out tester: Live sends the tab to sign in before anything starts
    setTimeout(function () { location.replace('https://www.browserstack.com/users/sign_in'); }, 600);
  } else if (device) {
    // an ordinary phone: Galaxy S26. Local is missed unless sim=localok.
    if (sim.indexOf('lag') > -1) {
      // measured: the title says running first; the toolbar renders later and only then does Local-at-start read true
      setTimeout(function () { document.title = device; }, 500);
      setTimeout(function () { document.title = device + ' v16.0'; }, 1000);
      setTimeout(function () { STATE.local = true; start(device + ' v16.0', { devtools: 'enabled' }); }, 3500);
    } else {
      setTimeout(function () { document.title = device; }, 500);
      setTimeout(function () { start(device + ' v16.0', { devtools: 'enabled' }); }, 1500);
    }
    // sim=toast: Live raises an error toast of its own while the session runs (seen: a recording that would not start)
    if (sim.indexOf('toast') > -1) setTimeout(function () { banner('Unable to start the recording. Please try again.'); }, 3500);
  } else if (browser) {
    // a desktop browser session: title stays "Dashboard", no DevTools item
    window.__desktop = true;
    setTimeout(function () { STATE.local = true; start('Dashboard', {}); }, 1500);
  }
})();
</script>
</body></html>
"""

FRAME = r"""<!doctype html><html><head><meta charset="utf-8"><title>devtools</title></head><body>
<script>
// A stand-in for Live's pinned DevTools 91 frontend: the shapes measured on real sessions.
(function () {
  var listeners = [];
  var msgs = [];
  function ExecutionContext() {}
  var ctx = { evaluate: function (options) {
    return Promise.resolve({ object: { type: 'string', value: 'device:' + options.expression } });
  } };
  var targets = function () { try { return parent.__state.targets; } catch (e) { return []; } };
  window.SDK = {
    ConsoleModel: {
      instance: function () { return { messages: function () { return msgs.slice(); }, addEventListener: function (t, fn) { listeners.push({ t: t, fn: fn }); } }; },
      Events: { MessageAdded: 'MessageAdded' },
    },
    ExecutionContext: ExecutionContext,
    targetManager: { targets: function () { return targets(); } },
  };
  // __state.noctx: a device with no page to run in, as an iPhone 17 on iOS 26.5/26.6 was (measured 2026-10-13):
  // a target, never a selected context; its runtimeAgent answers location.href with "about:blank".
  var noctx = function () { try { return !!parent.__state.noctx; } catch (e) { return false; } };
  window.UI = { context: { flavor: function (c) { return c === ExecutionContext && targets().length && !noctx() ? ctx : null; } } };
  window.fire = function (text, level, type) {
    var m = { source: 'console-api', level: level || 'info', type: type || 'log', messageText: text, parameters: [{ type: 'string', value: text }] };
    msgs.push(m);
    listeners.forEach(function (l) { l.fn({ data: m }); });
  };
})();
</script></body></html>"""


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        path = self.path.split('?')[0]
        if path.startswith('/dashboard'):
            if DELAY: time.sleep(DELAY)
            body, ctype = DASHBOARD, 'text/html; charset=utf-8'
        elif path.startswith('/devtools/'):
            body, ctype = FRAME, 'text/html; charset=utf-8'
        elif path.startswith('/users/sign_in'):
            body, ctype = '<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title></head><body>Sign in</body></html>', 'text/html; charset=utf-8'
        elif path == '/ping':
            body, ctype = 'ok', 'text/plain'
        else:
            self.send_response(404); self.end_headers(); return
        b = body.encode('utf8')
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(b)


def make_cert(directory):
    """A throwaway self-signed certificate for live.browserstack.com / www.browserstack.com. Generated
    into `directory` (a temp dir) every run, so no key material lives in the repo."""
    cert, key = os.path.join(directory, 'cert.pem'), os.path.join(directory, 'key.pem')
    if not (os.path.exists(cert) and os.path.exists(key)):
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
                        '-keyout', key, '-out', cert, '-subj', '/CN=live.browserstack.com',
                        '-addext', 'subjectAltName=DNS:live.browserstack.com,DNS:www.browserstack.com'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return cert, key


def serve(port=8443, directory='.'):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), H)
    cert, key = make_cert(directory)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


# A stand-in for the BrowserStack Local app, so the gate needs no app on the machine. The real one answers
# the two things Selenite asks (measured, Local app 3.7.8): the binary's port that Live itself polls, with a
# JSONP call, and the console's /status, which also carries a token that must never be read.
BINARY_JSONP = ("commandLineTunnel('0000masked-nativeapp:00000000-0000-0000-0000-000000000000', ['http://*:*'], 0, "
                "'node', 8.9, true, 'App-appVersion:3.7.8-binVersion:8.9', 'x:x', 1)")
CONSOLE_STATUS = '{"status": true, "token": "fake-token-nothing-may-read-this", "userId": "fake-user"}'


class LocalApp(http.server.BaseHTTPRequestHandler):
    kind = 'binary'

    def log_message(self, *a): pass

    def do_GET(self):
        path = self.path.split('?')[0]
        if self.kind == 'binary' and path == '/':
            body, ctype = BINARY_JSONP, 'application/javascript'
        elif self.kind == 'console' and path == '/status':
            body, ctype = CONSOLE_STATUS, 'application/json'
        else:
            self.send_response(404); self.end_headers(); return
        b = body.encode('utf8')
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(b)


def serve_local():
    """The fake Local app on two free ports. Returns (binary_url, console_url, servers)."""
    servers = []
    urls = []
    for kind in ('binary', 'console'):
        handler = type('LocalApp_' + kind, (LocalApp,), {'kind': kind})
        srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        servers.append(srv)
        urls.append('http://127.0.0.1:%d' % srv.server_address[1])
    return urls[0], urls[1], servers
