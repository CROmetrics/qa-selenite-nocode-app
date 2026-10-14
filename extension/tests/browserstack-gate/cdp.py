"""A small CDP client over --remote-debugging-pipe, enough to load the REAL unpacked
extension into system Chrome 154 and drive its panel, worker and tabs.

Recipe (memory: reference_cdp-capture-harness): branded Chrome ignores --load-extension, so
launch with --remote-debugging-pipe --enable-unsafe-extension-debugging, wire fds 3/4, and send
Extensions.loadUnpacked on the pipe. Messages are NUL-terminated JSON.
"""
import json, os, subprocess, threading, time

# Branded Google Chrome. Chrome for Testing and Chromium take --load-extension and need none of this, but
# the extension is only ever run in branded Chrome, which ignores that flag. CHROME_BIN overrides the path.
CHROME = os.environ.get('CHROME_BIN') or '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


class Browser:
    def __init__(self, args):
        if not os.path.exists(CHROME):
            raise SystemExit('Chrome not found at %s (set CHROME_BIN to its executable)' % CHROME)
        r_cmd, w_cmd = os.pipe()
        r_res, w_res = os.pipe()
        cmd = ['/bin/sh', '-c', 'exec "$@" 3<&%d 4>&%d' % (r_cmd, w_res), 'sh', CHROME] + args
        self.proc = subprocess.Popen(cmd, pass_fds=(r_cmd, w_res), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.close(r_cmd)
        os.close(w_res)
        self.w = os.fdopen(w_cmd, 'wb', buffering=0)
        self.r = os.fdopen(r_res, 'rb', buffering=0)
        self._id = 0
        self._lock = threading.Lock()
        self._waiters = {}
        self.events = []
        self._buf = b''
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        while True:
            try:
                chunk = self.r.read(65536)
            except Exception:
                return
            if not chunk:
                return
            self._buf += chunk
            while b'\0' in self._buf:
                raw, self._buf = self._buf.split(b'\0', 1)
                if not raw:
                    continue
                try:
                    m = json.loads(raw.decode('utf8'))
                except Exception:
                    continue
                if 'id' in m:
                    w = self._waiters.pop(m['id'], None)
                    if w:
                        w['res'] = m
                        w['ev'].set()
                else:
                    self.events.append(m)

    def send(self, method, params=None, session=None, timeout=30):
        with self._lock:
            self._id += 1
            i = self._id
        w = {'ev': threading.Event(), 'res': None}
        self._waiters[i] = w
        msg = {'id': i, 'method': method, 'params': params or {}}
        if session:
            msg['sessionId'] = session
        self.w.write(json.dumps(msg).encode('utf8') + b'\0')
        if not w['ev'].wait(timeout):
            self._waiters.pop(i, None)
            raise TimeoutError('%s timed out' % method)
        res = w['res']
        if 'error' in res:
            raise RuntimeError('%s: %s' % (method, res['error']))
        return res.get('result', {})

    def load_extension(self, path):
        return self.send('Extensions.loadUnpacked', {'path': path})['id']

    def targets(self):
        return self.send('Target.getTargets')['targetInfos']

    def find_target(self, pred, timeout=15):
        end = time.time() + timeout
        while time.time() < end:
            for t in self.targets():
                if pred(t):
                    return t
            time.sleep(0.2)
        raise TimeoutError('target not found')

    def attach(self, target_id):
        return self.send('Target.attachToTarget', {'targetId': target_id, 'flatten': True})['sessionId']

    def ev(self, session, expr, await_promise=True, timeout=30):
        r = self.send('Runtime.evaluate', {'expression': expr, 'awaitPromise': await_promise, 'returnByValue': True}, session=session, timeout=timeout)
        if 'exceptionDetails' in r:
            d = r['exceptionDetails']
            raise RuntimeError('page error: ' + (d.get('exception', {}).get('description') or d.get('text', '?')))
        return r['result'].get('value')

    def close(self):
        try:
            self.send('Browser.close', timeout=5)
        except Exception:
            pass
        try:
            self.proc.terminate()
            self.proc.wait(timeout=5)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass
