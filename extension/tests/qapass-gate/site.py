"""The local fixture shop for the QA Pass gate (plan Appendix B.2), served on 127.0.0.1 only.

  /shop/           a page with a fake Optimizely snippet (fake-optimizely.js), a hero line that only the v1 variation
                   shows (clipped at 300-390 px) and a legal line (clipped at 300 and 320 px); the DELIBERATE bugs the
                   gate expects QA Pass to find: utm_campaign=impact is not honoured (D), and the v1 variation fires a
                   click metric on load (F)
  /shop-strict/    the same page, but the v1 variation is served only with optimizely_force_tracking=true (so the
                   no-tracking probe fails and the sweep takes the resize path)
  /shop-live/      the same page, with the QP-OTHER test (9002) active for every visitor, as a launched experiment is
                   (the plain PROD load shows a live experiment, so QA Pass sweeps PROD by resizing)
  /blocked/        a Cloudflare-style "Just a moment..." page (the bot check)
  /shop.css, /fake-optimizely.js

Every response is Cache-Control: no-store. Every request is recorded as (path, query) in `log`, which the gate reads to
count exactly how many requests carried a forcing parameter.

  python3 -I -u site.py        serves until Ctrl-C and prints the port (for looking at the pages by hand)
"""
import os, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))


def shop_html(canonical):
    paras = ''.join('<p>Normal copy that wraps within the viewport at every width.</p>' for _ in range(10))
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>QP Shop</title>'
        '<link rel="canonical" href="%s">'
        '<script src="/fake-optimizely.js"></script>'
        '<link rel="stylesheet" href="/shop.css">'
        '</head><body>'
        '<header><h1>QP Shop</h1></header>'
        '<div class="hero-box"><span class="hero-line">CLIPPED-HERO Start your free trial</span></div>'
        '%s'
        '<div class="legal-box"><span class="legal">LEGAL-LINE Terms apply</span></div>'
        '</body></html>' % (canonical, paras)
    )


SHOP_CSS = (
    'body{margin:0;font:16px/1.4 sans-serif}'
    '.hero-box,.legal-box{width:100%;overflow:hidden}'
    '.hero-line{display:none}'
    '.v1 .hero-line{display:inline-block;white-space:nowrap;width:396px;text-align:right}'
    '.legal{display:inline-block;white-space:nowrap;width:330px;text-align:right}'
)

BLOCKED_HTML = '<!doctype html><title>Just a moment...</title><div id="challenge-form">Checking your browser</div>'


class Site:
    """A ThreadingHTTPServer on 127.0.0.1 and its request log."""

    def __init__(self, port=0):
        self.log = []                      # [(path, query)], in arrival order
        self._lock = threading.Lock()
        site = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *a):     # quiet
                pass

            def _send(self, status, ctype, body):
                data = body.encode('utf8') if isinstance(body, str) else body
                self.send_response(status)
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                u = urlsplit(self.path)
                with site._lock:
                    site.log.append((u.path, u.query))
                if u.path in ('/shop/', '/shop-strict/', '/shop-live/'):
                    self._send(200, 'text/html; charset=utf-8', shop_html(u.path))
                elif u.path == '/shop.css':
                    self._send(200, 'text/css; charset=utf-8', SHOP_CSS)
                elif u.path == '/fake-optimizely.js':
                    with open(os.path.join(HERE, 'fake-optimizely.js'), 'rb') as f:
                        self._send(200, 'application/javascript; charset=utf-8', f.read())
                elif u.path == '/blocked/':
                    self._send(200, 'text/html; charset=utf-8', BLOCKED_HTML)
                else:
                    self._send(404, 'text/plain; charset=utf-8', 'not found')

        self.httpd = ThreadingHTTPServer(('127.0.0.1', port), Handler)
        self.port = self.httpd.server_address[1]
        self.base = 'http://127.0.0.1:%d' % self.port
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def requests(self, path_prefix=None):
        with self._lock:
            out = list(self.log)
        return [r for r in out if path_prefix is None or r[0].startswith(path_prefix)]

    def mark(self):
        """How many requests so far (a scenario counts the ones after its mark)."""
        with self._lock:
            return len(self.log)

    def since(self, mark):
        with self._lock:
            return list(self.log[mark:])

    def close(self):
        try:
            self.httpd.shutdown()
            self.httpd.server_close()
        except Exception:
            pass


if __name__ == '__main__':
    s = Site(0)
    print('serving %s  (/shop/, /shop-strict/, /shop-live/, /blocked/)  Ctrl-C to stop' % s.base)
    try:
        while True:
            threading.Event().wait(3600)
    except KeyboardInterrupt:
        s.close()
