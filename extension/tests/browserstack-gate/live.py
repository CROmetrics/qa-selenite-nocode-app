"""Drive the REAL Selenite against REAL BrowserStack Live, in a Chrome of its own.

The gate (gate.py) runs against a fake Live. This runs the same real extension against the real
dashboard, in a separate, persistent Chrome profile that you sign in to BrowserStack once. Nothing
in your everyday Chrome is touched, and no Chrome setting there needs changing.

  python3 -I -u live.py serve              start Chrome (a visible window) with Selenite loaded, and keep
                                           running; the first time, sign in to BrowserStack in that window
  python3 -I live.py panel                 open Selenite's panel as a tab (it works like the side panel)
  python3 -I live.py open <url>            open a tab
  python3 -I live.py front                 bring that Chrome's window to the front
  python3 -I live.py tabs                  list the open targets
  python3 -I live.py ev <where> '<js>'     run JavaScript and print the result; <where> is panel, worker,
                                           or any part of a tab's URL (live.browserstack.com, ...)
  python3 -I live.py shot <where> <file>   save a screenshot of that tab
  python3 -I live.py stop                  close that Chrome

The profile is kept in ~/Library/Application Support/Selenite Live Test (LIVE_PROFILE overrides it).
It holds your BrowserStack sign-in: delete the folder to sign out. Commands reach the running Chrome
through a small control server on 127.0.0.1 (LIVE_CTL_PORT, default 8790); only this machine can reach it.
"""
import base64, http.server, json, os, subprocess, sys, threading, urllib.request
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.abspath(os.path.join(HERE, '..', '..'))
PROFILE = os.environ.get('LIVE_PROFILE') or os.path.expanduser('~/Library/Application Support/Selenite Live Test')
CTL = int(os.environ.get('LIVE_CTL_PORT', '8790'))


class Driver:
    def __init__(self):
        from cdp import Browser
        os.makedirs(PROFILE, exist_ok=True)
        self.b = Browser([
            '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
            '--user-data-dir=' + PROFILE, '--no-first-run', '--no-default-browser-check',
            '--window-size=1500,950', 'https://live.browserstack.com/dashboard',
        ])
        # The profile remembers the extension between runs, and Chrome then reuses the background script
        # it cached last time even when the files have changed (seen: panel 0.7.11, worker still 0.7.10).
        # Uninstall what it remembers and load the files again, so every run tests the code on disk.
        ext = self.b.load_extension(EXT)
        try:
            self.b.send('Extensions.uninstall', {'id': ext})
            ext = self.b.load_extension(EXT)
        except RuntimeError as e:
            print('warning: could not reload the extension fresh (%s); the background script may be stale' % e, flush=True)
        self.ext = ext
        self.sessions = {}
        self.lock = threading.Lock()

    def targets(self):
        return [t for t in self.b.targets() if t['type'] in ('page', 'service_worker')]

    def find(self, where):
        ts = self.targets()
        if where == 'panel':
            m = [t for t in ts if t['type'] == 'page' and t['url'].startswith('chrome-extension://%s/popup.html' % self.ext)]
        elif where == 'worker':
            m = [t for t in ts if t['type'] == 'service_worker' and t['url'] == 'chrome-extension://%s/background.js' % self.ext]
        else:
            m = [t for t in ts if t['type'] == 'page' and where in t['url']]
        if not m:
            raise LookupError('no target matching %r' % where)
        return m[0]

    def session(self, t):
        sid = self.sessions.get(t['targetId'])
        if not sid:
            sid = self.b.attach(t['targetId'])
            self.sessions[t['targetId']] = sid
        return sid

    def ev(self, where, js):
        t = self.find(where)
        try:
            return self.b.ev(self.session(t), js, timeout=60)
        except RuntimeError as e:
            if 'session' not in str(e).lower():
                raise
            self.sessions.pop(t['targetId'], None)       # the target was re-created: attach again
            return self.b.ev(self.session(t), js, timeout=60)

    def shot(self, where, path):
        t = self.find(where)
        data = self.b.send('Page.captureScreenshot', {'format': 'png'}, session=self.session(t))['data']
        with open(path, 'wb') as f:
            f.write(base64.b64decode(data))
        return path

    def panel(self):
        return self.open('chrome-extension://%s/popup.html' % self.ext)

    def open(self, url):
        return self.b.send('Target.createTarget', {'url': url})['targetId']

    def front(self):
        # This Chrome is a second instance of the same app, so "activate Google Chrome" would raise the
        # everyday one. Activate it by process id instead (macOS).
        js = 'ObjC.import("AppKit"); $.NSRunningApplication.runningApplicationWithProcessIdentifier(%d).activateWithOptions(3)' % self.b.proc.pid
        subprocess.run(['osascript', '-l', 'JavaScript', '-e', js], capture_output=True)
        return 'front'

    def handle(self, cmd):
        with self.lock:
            op = cmd.get('op')
            if op == 'tabs':
                return [{'type': t['type'], 'title': t.get('title', ''), 'url': t['url']} for t in self.targets()]
            if op == 'ev':
                return self.ev(cmd['where'], cmd['js'])
            if op == 'shot':
                return self.shot(cmd['where'], cmd['path'])
            if op == 'panel':
                return self.panel()
            if op == 'open':
                return self.open(cmd['url'])
            if op == 'front':
                return self.front()
            if op == 'stop':
                threading.Thread(target=lambda: (self.b.close(), os._exit(0)), daemon=True).start()
                return 'stopping'
            raise ValueError('unknown op %r' % op)


def serve():
    holder = {}

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            try:
                out = {'ok': True, 'result': holder['d'].handle(json.loads(body))}
            except Exception as e:
                out = {'ok': False, 'error': '%s: %s' % (type(e).__name__, e)}
            b = json.dumps(out).encode('utf8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(b)))
            self.end_headers()
            self.wfile.write(b)

    # The port first, so a second `serve` fails before it starts a Chrome it cannot control.
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', CTL), H)
    d = holder['d'] = Driver()

    # When that Chrome is quit (Cmd+Q, or its last window closed), stop serving and free the port.
    def watch():
        d.b.proc.wait()
        os._exit(0)
    threading.Thread(target=watch, daemon=True).start()

    d.front()
    print('Selenite %s loaded; control on 127.0.0.1:%d; profile %s' % (d.ext, CTL, PROFILE), flush=True)
    srv.serve_forever()


def call(cmd):
    req = urllib.request.Request('http://127.0.0.1:%d/' % CTL, data=json.dumps(cmd).encode('utf8'),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=90) as r:
        out = json.loads(r.read())
    if not out['ok']:
        sys.exit(out['error'])
    res = out['result']
    print(res if isinstance(res, str) else json.dumps(res, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a or a[0] in ('-h', '--help'):
        print(__doc__)
    elif a[0] == 'serve':
        serve()
    elif a[0] == 'ev':
        call({'op': 'ev', 'where': a[1], 'js': a[2]})
    elif a[0] == 'shot':
        call({'op': 'shot', 'where': a[1], 'path': os.path.abspath(a[2])})
    elif a[0] == 'open':
        call({'op': 'open', 'url': a[1]})
    elif a[0] in ('tabs', 'panel', 'front', 'stop'):
        call({'op': a[0]})
    else:
        sys.exit('unknown command %r (see --help)' % a[0])
