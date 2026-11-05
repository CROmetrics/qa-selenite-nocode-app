"""The local fixture site for the modes gate (plan Appendix D.1/D.2), served on 127.0.0.1 only. All content is synthetic.

  /itw/ /itw-bad/ /itw-covered/   a shop page ("QK Shop") with #start-quiz; /itw-bad/ adds a QA ribbon for cro_mode=qa,
                                  /itw-covered/ adds a full-screen cookie wall over the trigger
  /itw/help/ /itw/step2/          sub pages ("QK Help", "QK Step 2")
  /landing/ /landing-ok/          "QK Landing" (only /landing/ is targeted by the fake test)
  /seed/                          sets localStorage qk_quiz_progress='1'
  /resp/ /resp-live/              the responsive-clip page (legal line clips below 328 px, the Hero variation's line below
                                  394 px, the carousel below 618 px; A10)
  /blocked/                       a Cloudflare-style "Just a moment..." page (the bot check)
  /beacon                         answers 204, logged
  /fake-optimizely.js

Every response is Cache-Control: no-store. Every request is recorded as (path, query) in `log`.

  python3 -I -u site.py        serves until Ctrl-C and prints the port
"""
import os, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))

HEAD = ('<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>%s</title><link rel="canonical" href="%s">'
        '<script src="/fake-optimizely.js"></script>%s</head><body>')

PARA = '<p>Plain synthetic copy that wraps inside the viewport at every width, with no surprises in it at all.</p>'

TITLES = {
    '/itw/': 'QK Shop', '/itw-bad/': 'QK Shop', '/itw-covered/': 'QK Shop',
    '/itw/help/': 'QK Help', '/itw/step2/': 'QK Step 2',
    '/landing/': 'QK Landing', '/landing-ok/': 'QK Landing',
}
SHOP_PAGES = ('/itw/', '/itw-bad/', '/itw-covered/')
# Fixed heights, so documentElement.scrollHeight is exactly D.2's model at the 900 px desktop viewport (qkHeightFor):
# 80 + 1120 = 1200 px, and 80 + 120 + 1120 = 1320 px with /itw-bad/'s ribbon. A page shorter than the viewport reads 900.
PAGE_CSS = '<style>body{margin:0} header{height:80px;display:flow-root} main{min-height:1120px;display:flow-root}</style>'

RESP_CSS = (
    '<style>body{margin:0;font:16px/1.4 sans-serif} .hero-box,.legal-box,.carousel-box{width:100%;overflow:hidden} '
    '.legal{display:inline-block;white-space:nowrap;width:330px;text-align:right} .hero-line{display:none} '
    '.v1 .hero-line{display:inline-block;white-space:nowrap;width:396px;text-align:right} '
    '.carousel-track{display:inline-block;white-space:nowrap;width:620px}</style>'
)

BLOCKED_HTML = '<!doctype html><title>Just a moment...</title><div id="challenge-form">Checking your browser</div>'


def page(path, query):
    title = TITLES[path]
    body = HEAD % (title, path, PAGE_CSS) + '<header><h1>%s</h1></header>' % title
    if path == '/itw-bad/' and query.get('cro_mode', [''])[0] == 'qa':
        body += '<div class="promo-banner qk-ribbon" style="height:120px">' + 'QA RIBBON ' * 22 + '</div>'
    body += '<main>' + PARA * 10
    if path in SHOP_PAGES:
        body += '<button id="start-quiz" type="button">Start quiz</button>'
    body += '</main>'
    if path == '/itw-covered/':
        body += ('<div id="cookie-wall" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);'
                 'color:#fff">Accept cookies</div>')
    return body + '</body></html>'


def resp_page(path):
    return (HEAD % ('QK Responsive', path, RESP_CSS)
            + '<div class="hero-box"><span class="hero-line">CLIPPED-HERO Start your free trial</span></div>'
            + PARA * 10
            + '<div class="legal-box"><span class="legal">LEGAL-LINE Terms apply</span></div>'
            + '<div class="carousel-box"><div class="carousel-track">CAROUSEL-TRACK slide one slide two slide three</div></div>'
            + '</body></html>')


SEED_HTML = ('<!doctype html><title>QK Seed</title><script>try{localStorage.setItem("qk_quiz_progress","1")}catch(e){}'
             '</script><p>seeded</p>')


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
                if ctype:
                    self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                if status != 204:
                    self.wfile.write(data)

            def do_GET(self):
                u = urlsplit(self.path)
                with site._lock:
                    site.log.append((u.path, u.query))
                html = 'text/html; charset=utf-8'
                if u.path in TITLES:
                    self._send(200, html, page(u.path, parse_qs(u.query)))
                elif u.path in ('/resp/', '/resp-live/'):
                    self._send(200, html, resp_page(u.path))
                elif u.path == '/seed/':
                    self._send(200, html, SEED_HTML)
                elif u.path == '/blocked/':
                    self._send(200, html, BLOCKED_HTML)
                elif u.path == '/beacon':
                    self._send(204, None, b'')
                elif u.path == '/fake-optimizely.js':
                    with open(os.path.join(HERE, 'fake-optimizely.js'), 'rb') as f:
                        self._send(200, 'application/javascript; charset=utf-8', f.read())
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
    print('serving %s  (/itw/, /itw-bad/, /itw-covered/, /landing/, /resp/, /resp-live/, /blocked/, /seed/)  Ctrl-C to stop' % s.base)
    try:
        while True:
            threading.Event().wait(3600)
    except KeyboardInterrupt:
        s.close()
