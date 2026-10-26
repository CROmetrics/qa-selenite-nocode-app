#!/usr/bin/env python3
r"""The fake services for the Email Check gate, all on ONE ThreadingHTTPServer on 127.0.0.1.

    python3 -I -u fake_services.py --selftest          # start on a free port, answer the routes below, exit
    python3 -I -u fake_services.py --selftest --strict # the same, but a route still stubbed is exit 3
    python3 -I -u fake_services.py --serve             # serve until Ctrl-C and print the base URL (to look at pages by hand)

WHAT IS FAKED, AND WHY ONE SERVER. In the gate the worker's `globalThis.__ecGateOrigins` maps six real https
origins (mailtrap.io, marketing.example.org, www.example.org, app.emailonacid.com, images.emailonacid.com,
docs.googleapis.com) to this one http://127.0.0.1:PORT, so the server tells the services apart by PATH only. Nothing here
talks to a real host; everything served comes from the committed SYNTHETIC fixtures (`../fixtures-email-*.json`, made by
`../gen-email-fixtures.py`: org Example Relief, tickets EX-1 / EX-2, hosts under example.org / example.net).

  Mailtrap web   GET /sandboxes/<sb>/messages/<id>        200 with cookie `mt=1`, else 302 -> /signin  (the real app's behaviour)
                 GET /signin, /users/sign_in              200, title "Sign in | Mailtrap"
  Mailtrap API   GET /api/accounts                        200 [{id:111..},{id:222..}] with the cookie, else 401
                 GET /api/accounts/<a>/inboxes/<sb>       200 for the OWNING account (cfg owner, 222), 404 for any other
                 GET /api/accounts/<a>/inboxes/<sb>/messages/<id>[/<part>]   the message JSON and the five parts
  Pardot         GET /e/<acct>/<slug>/<linkId>/<prospect>/h/<hash>   the synthetic interstitial of that linkId; a linkId with no
                 fixture interstitial gets one generated in the same layout (destination https://www.example.org/<slug>/)
                 GET /webmail/..., /unsubscribeConfirm/...  200 "must never be fetched" body, LOGGED as kind pardot-guarded
  Destinations   GET <any other path>                      200 with a <title> (404 for cfg dead_paths); the gate asserts no query
  Email on Acid  GET /app/acidtest/<guid>...               the fixture list page (`var test = {...}`) plus one lazy <img> per client
                 GET /web/<guid>/<code>.png                a generated PNG (zlib; deterministic colour and height per client code)
  Google Docs    GET /v1/documents/<id>                    the EX-1 / EX-2 copy doc JSON; 404 for any other id

THE REQUEST LOG. Every request is appended (before the response is sent) as a dict: n, method, path, query, kind, status, auth
(an Authorization header was sent), cookie (a Cookie header was sent), dest (Sec-Fetch-Dest: `empty` = a fetch, `document` = a
tab navigation, `image` = an <img>), mode (Sec-Fetch-Mode). kind is one of mt-web, mt-api, mt-msg, pardot-e, pardot-guarded,
eoa-page, eoa-img, docs, chrome (favicon), dest. The gate reads it with mark() / since(mark).

SWITCHES (cfg, set per scenario by reset(**kw); anything else is a ValueError):
  accounts [111, 222]   what /api/accounts lists          owner 222        the account that owns the sandbox
  missing []            message ids that 404              dead_paths []    destination paths that 404
  challenge False       serve a "Just a moment..." page for every Mailtrap web route (no gate scenario uses it yet)
  txt_append {}         {messageId: text} appended to that message's body.txt (the `token` scenario)
  eoa_lazy True         the EoA <img> tags are loading=lazy and 700 px apart (the real page lazy-loads; the worker's scroll must cope)

EXIT CODES: 0 selftest ok; 1 a selftest check failed; 3 --strict and a route is still a stub; 64 usage.
STYLE: Python 3.9 compatible, stdlib only, run as `python3 -I`.
"""
import html as htmllib
import http.client
import json
import os
import quopri
import re
import struct
import sys
import threading
import zlib
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
TESTS = os.path.abspath(os.path.join(HERE, '..'))

FIXTURE_FILES = {
    'proofs': 'fixtures-email-proofs.json', 'interstitials': 'fixtures-email-interstitials.json',
    'eoa': 'fixtures-email-eoa.json', 'jira': 'fixtures-email-jira.json',
    'doc-ex1': 'fixtures-email-doc-ex1.json', 'doc-ex2': 'fixtures-email-doc-ex2.json',
}
DEFAULT_CFG = {'accounts': [111, 222], 'owner': 222, 'missing': [], 'dead_paths': [], 'challenge': False,
               'txt_append': {}, 'eoa_lazy': True}
# The Mailtrap API parts under /messages/<id>/ (the five sub-paths, plus the message JSON itself = no part).
MAILTRAP_PARTS = ('body.htmlsource', 'body.txt', 'body.raw', 'mail_headers', 'spam_report')

# The same pattern the extension uses on a link's path; the fake uses it to name a request "guarded".
GUARDED_PATH_RE = re.compile(r'/(webmail|unsubscribe\w*|emailPreference\w*|optout|preference\w*)/', re.I)
# The text/alt form (used here only to derive the number of Pardot GETs a run must make).
GUARD_TEXT_RE = re.compile(r'unsubscribe|opt.?out|view (this )?(email|message)? ?(in|on) (a |your )?browser|view online|web ?version'
                           r'|preferences|manage (your )?(subscription|email)', re.I)
PARDOT_HREF_RE = re.compile(r'^https://marketing\.example\.org/e/(?P<acct>\d+)/(?P<slug>[^/?#]+)/(?P<lid>[A-Za-z0-9]+)/\d+/h/[A-Za-z0-9]+$')
PARDOT_PATH_RE = re.compile(r'^/e/(?P<acct>\d+)/(?P<slug>[^/?#]+)/(?P<lid>[A-Za-z0-9]+)/(?P<pid>\d+)/h/(?P<hash>[A-Za-z0-9]+)$')


# ══ Fixtures ══════════════════════════════════════════════════════════════════════════════════════════

def decoded_html(proof):
    """The proof's HTML part as the email shows it: a quoted-printable one (the EX-2 Major v1 quirk: `=3D`, soft breaks) is decoded."""
    h = proof['htmlsource']
    if re.search(r'=3D|=\r?\n', h):
        h = quopri.decodestring(h.encode('utf-8')).decode('utf-8', 'replace')
    return h


def anchors_of(html):
    """[(href, text, alt)] for every <a href>, in document order (a regex reader, enough for the synthetic emails)."""
    out = []
    for m in re.finditer(r'<a\b[^>]*?\bhref\s*=\s*(["\'])(.*?)\1[^>]*>(.*?)</a>', html, re.S | re.I):
        inner = m.group(3)
        text = htmllib.unescape(re.sub(r'<[^>]+>', '', inner)).replace(' ', ' ').strip()
        alt = re.search(r'<img\b[^>]*?\balt\s*=\s*(["\'])(.*?)\1', inner, re.S | re.I)
        out.append((htmllib.unescape(m.group(2)), text, htmllib.unescape(alt.group(2)).strip() if alt else ''))
    return out


def load_fixtures(tests_dir=TESTS):
    """Reads the six committed synthetic fixtures and builds the indexes the routes use. Read-only; raises on a missing file."""
    fx = {}
    for key, name in FIXTURE_FILES.items():
        with open(os.path.join(tests_dir, name), 'r', encoding='utf-8') as fh:
            fx[key] = json.load(fh)
    fx['docs'] = {d['documentId']: d for d in (fx['doc-ex1'], fx['doc-ex2'])}
    fx['sandbox'] = None
    fx['messages'] = {}          # messageId -> {ticket, proof}
    fx['linkids'] = {}           # linkId -> {ticket, slug, acct, interstitial: html or None}
    for tk, t in fx['proofs']['tickets'].items():
        fx['sandbox'] = fx['sandbox'] or str(t['sandboxId'])
        for pr in t['proofs']:
            fx['messages'][str(pr['messageId'])] = {'ticket': tk, 'proof': pr}
            for href, _text, _alt in anchors_of(decoded_html(pr)):
                m = PARDOT_HREF_RE.match(href)
                if m and m.group('lid') not in fx['linkids']:
                    fx['linkids'][m.group('lid')] = {'ticket': tk, 'slug': m.group('slug'), 'acct': m.group('acct'), 'interstitial': None}
    template = None
    for tk, d in fx['interstitials'].items():
        for key, page in d.items():
            lid = key.rsplit('-', 1)[1]
            if lid in fx['linkids']:
                fx['linkids'][lid]['interstitial'] = page
            template = template or page
    fx['interstitial_template'] = template
    fx['eoa_pages'] = {}         # guid -> {ticket, variation, html, codes}
    for tk, d in fx['eoa'].items():
        for var, page in d.items():
            i = page.index('var test = ') + len('var test = ')
            test, _end = json.JSONDecoder().raw_decode(page[i:])
            fx['eoa_pages'][test['guid']] = {'ticket': tk, 'variation': var, 'html': page, 'codes': list(test['clients'].keys())}
    return fx


def expected_pardot_linkids(fx, ticket):
    """The distinct Pardot linkIds a run on `ticket` must GET once each: every /e/ link of its proofs that the guard rules do not guard
    (text/alt, path, or an empty anchor in the first/last two positions). The same linkId in two proofs counts once."""
    ids = []
    for pr in fx['proofs']['tickets'][ticket]['proofs']:
        anchors = anchors_of(decoded_html(pr))
        total = len(anchors)
        for i, (href, text, alt) in enumerate(anchors):
            guarded = (GUARD_TEXT_RE.search(text) or GUARD_TEXT_RE.search(alt) or GUARDED_PATH_RE.search(urlsplit(href).path)
                       or (not text and not alt and (i < 2 or i >= total - 2)))
            m = PARDOT_HREF_RE.match(href)
            if guarded or not m:
                continue
            if m.group('lid') not in ids:
                ids.append(m.group('lid'))
    return ids


def make_interstitial(fx, dest_url):
    """A Pardot "Tracked Link Successful" page in the fixture layout for `dest_url` (the `<a href>` HTML-escaped with &amp;, the
    `window.location.href` string with every non-alphanumeric character \\xNN-escaped, as the real page prints them)."""
    esc = htmllib.escape(dest_url, quote=False)
    page = re.sub(r"<a href='[^']*'>.*?</a>", lambda m: "<a href='%s'>%s</a>" % (esc, esc), fx['interstitial_template'], flags=re.S)
    js = ''.join(c if (c.isascii() and c.isalnum()) else '\\x%02x' % ord(c) for c in dest_url)
    return re.sub(r"(window\.location\.href = ')[^']*(')", lambda m: m.group(1) + js + m.group(2), page)


def sibling_query(fx, link_id):
    """The `?utm_...` query of the fixture destination of the same email version as `link_id` (the same ticket and the same linkId prefix `x<ticket>v<version>`,
    e.g. x2v0), or ''. A generated destination carries it: the tracked links the fixtures have no page for (the SMS banner is a content link) must carry the UTMs of their
    own email, as ecTestRecord gives them; a link outside that scheme gets no query."""
    info = fx['linkids'].get(link_id)
    m = re.match(r'x\d+v\d+', link_id)
    if not info or not m:
        return ''
    for lid in sorted(fx['linkids']):
        o = fx['linkids'][lid]
        if o['ticket'] == info['ticket'] and lid.startswith(m.group(0)) and o['interstitial']:
            h = re.search(r"<a href='([^']*)'", o['interstitial'])
            if h and '?' in h.group(1):
                return '?' + htmllib.unescape(h.group(1)).split('?', 1)[1]
    return ''


def make_png(width, height, rgb):
    """A valid solid-colour truecolour PNG (zlib; deterministic)."""
    row = b'\x00' + bytes(rgb) * width

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(row * height, 9)) + chunk(b'IEND', b''))


def png_for(code):
    """The render of one EoA client code: 600 px wide, 700-1000 px high, a colour from the code (so every client differs)."""
    h = zlib.crc32(code.encode('utf-8')) & 0xffffffff
    return make_png(600, 700 + 100 * (h % 4), (40 + (h >> 3) % 180, 40 + (h >> 11) % 180, 40 + (h >> 19) % 180))


def eoa_page(fx, guid, lazy=True):
    """The fixture EoA list page for `guid` with one <img> per client appended (src = this server's /web/<guid>/<code>.png)."""
    e = fx['eoa_pages'][guid]
    imgs = ''.join('<div style="min-height:700px"><img %s alt="%s" src="/web/%s/%s.png"></div>'
                   % ('loading="lazy"' if lazy else '', htmllib.escape(c), guid, c) for c in e['codes'])
    page = e['html']
    return page.replace('</body>', imgs + '</body>', 1) if '</body>' in page else page + imgs


# ══ The server ════════════════════════════════════════════════════════════════════════════════════════

def kind_of(path):
    """The request kind the log records (see the module docstring)."""
    if path == '/favicon.ico':
        return 'chrome'
    if path.startswith('/e/'):
        return 'pardot-e'
    if path.startswith(('/webmail/', '/unsubscribeConfirm/')) or GUARDED_PATH_RE.search(path):
        return 'pardot-guarded'
    if path in ('/signin', '/users/sign_in') or path.startswith(('/sandboxes/', '/inboxes/')):
        return 'mt-web'
    if re.match(r'^/api/accounts/\d+/inboxes/\d+/messages/', path):
        return 'mt-msg'
    if path.startswith('/api/accounts'):
        return 'mt-api'
    if path.startswith('/app/acidtest/'):
        return 'eoa-page'
    if path.startswith('/web/'):
        return 'eoa-img'
    if path.startswith('/v1/documents/'):
        return 'docs'
    return 'dest'


def is_guarded_request(entry):
    """True for a request the gate must never see: a guarded kind, or an /e/ link whose path the path guard matches."""
    return entry['kind'] == 'pardot-guarded' or (entry['kind'] == 'pardot-e' and bool(GUARDED_PATH_RE.search(entry['path'])))


JSON_CT = 'application/json; charset=utf-8'
HTML_CT = 'text/html; charset=utf-8'
CHALLENGE_HTML = '<!doctype html><title>Just a moment...</title><div id="challenge-form">Checking your browser</div>'


def _page(title, body=''):
    return '<!doctype html><html><head><meta charset="utf-8"><title>%s</title></head><body>%s</body></html>' % (htmllib.escape(title), body)


class Services(object):
    """The fake services on 127.0.0.1:<port> and their request log. Thread-safe; one instance per gate run."""

    def __init__(self, port=0, fixtures=None):
        self.fx = fixtures or load_fixtures()
        self.sandbox = self.fx['sandbox']
        self.cfg = dict(DEFAULT_CFG)
        self.log = []
        self._lock = threading.Lock()
        svc = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *a):
                pass

            def do_GET(self):
                svc._handle(self)

            def do_HEAD(self):
                svc._handle(self)

            def do_POST(self):
                svc._handle(self)

        self.httpd = ThreadingHTTPServer(('127.0.0.1', port), Handler)
        self.port = self.httpd.server_address[1]
        self.base = 'http://127.0.0.1:%d' % self.port
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    # -- configuration and the log ------------------------------------------------------------------
    def reset(self, **kw):
        """Back to DEFAULT_CFG, then the given switches. An unknown switch is a ValueError (a typo must not pass silently)."""
        bad = [k for k in kw if k not in DEFAULT_CFG]
        if bad:
            raise ValueError('unknown cfg switch(es): %s' % ', '.join(bad))
        self.cfg = dict(DEFAULT_CFG)
        self.cfg.update(kw)

    def mark(self):
        with self._lock:
            return len(self.log)

    def since(self, mark=0):
        with self._lock:
            return [dict(e) for e in self.log[mark:]]

    def count(self, kind, since=0):
        return sum(1 for e in self.since(since) if e['kind'] == kind)

    def close(self):
        try:
            self.httpd.shutdown()
            self.httpd.server_close()
        except Exception:
            pass

    # -- dispatch -----------------------------------------------------------------------------------
    def _signed_in(self, h):
        try:
            c = SimpleCookie()
            c.load(h.headers.get('Cookie', ''))
            return 'mt' in c and c['mt'].value == '1'
        except Exception:
            return False

    def _handle(self, h):
        u = urlsplit(h.path)
        try:
            status, ctype, body, extra = self._route(h, u)
        except NotImplementedError as e:
            status, ctype, body, extra = 501, JSON_CT, json.dumps({'stub': str(e)}), {'X-Stub': str(e)}
        except Exception as e:  # a bug in the fake must be visible, not a hung request
            status, ctype, body, extra = 500, JSON_CT, json.dumps({'error': '%s: %s' % (type(e).__name__, e)}), {}
        data = body.encode('utf-8') if isinstance(body, str) else body
        with self._lock:
            self.log.append({
                'n': len(self.log), 'method': h.command, 'path': u.path, 'query': u.query, 'kind': kind_of(u.path), 'status': status,
                'auth': 'Authorization' in h.headers, 'cookie': 'Cookie' in h.headers,
                'dest': h.headers.get('Sec-Fetch-Dest'), 'mode': h.headers.get('Sec-Fetch-Mode'),
            })
        h.send_response(status)
        h.send_header('Content-Type', ctype)
        h.send_header('Content-Length', str(len(data)))
        h.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items():
            h.send_header(k, v)
        h.end_headers()
        if h.command != 'HEAD':
            h.wfile.write(data)

    def _route(self, h, u):
        """Returns (status, content type, body str|bytes, extra headers). Routing is by path only (see the module docstring)."""
        p = u.path
        if h.command == 'POST':
            return 405, 'text/plain; charset=utf-8', 'method not allowed', {}
        if p == '/favicon.ico':
            return 404, 'text/plain; charset=utf-8', 'no icon', {}
        # Pardot: a tracked link, and the guarded paths nobody may fetch
        m = PARDOT_PATH_RE.match(p)
        if m:
            return self._pardot(m.group('lid'), m.group('slug'))
        if p.startswith('/e/'):
            return 404, 'text/plain; charset=utf-8', 'not a tracked link', {}
        if p.startswith(('/webmail/', '/unsubscribeConfirm/')) or GUARDED_PATH_RE.search(p):
            return 200, HTML_CT, _page('GUARDED LINK FETCHED', '<p>This path must never be requested by Email Check.</p>'), {}
        # Mailtrap web
        if p in ('/signin', '/users/sign_in'):
            return 200, HTML_CT, _page('Sign in | Mailtrap', '<form><input name="email"><input name="password" type="password"></form>'), {}
        m = re.match(r'^/(?:sandboxes|inboxes)/(\d+)/messages/(\d+)/?$', p)
        if m:
            if self.cfg['challenge']:
                return 200, HTML_CT, CHALLENGE_HTML, {}
            if not self._signed_in(h):
                return 302, HTML_CT, '', {'Location': '/signin'}
            if m.group(1) != self.sandbox or m.group(2) not in self.fx['messages'] or m.group(2) in [str(x) for x in self.cfg['missing']]:
                return 404, HTML_CT, _page('Not found | Mailtrap'), {}
            return 200, HTML_CT, _page('Mailtrap', '<main>message %s</main>' % m.group(2)), {}
        # Mailtrap API
        if p == '/api/accounts':
            if not self._signed_in(h):
                return 401, JSON_CT, json.dumps({'error': 'Unauthorized'}), {}
            return 200, JSON_CT, json.dumps([{'id': a, 'name': 'Gate account %d' % a, 'access_levels': [100]} for a in self.cfg['accounts']]), {}
        m = re.match(r'^/api/accounts/(\d+)/inboxes/(\d+)(?:/messages/(\d+)(?:/([A-Za-z0-9_.]+))?)?/?$', p)
        if m:
            if not self._signed_in(h):
                return 401, JSON_CT, json.dumps({'error': 'Unauthorized'}), {}
            acct, sb, mid, part = int(m.group(1)), m.group(2), m.group(3), m.group(4)
            if acct != self.cfg['owner'] or sb != self.sandbox:
                return 404, JSON_CT, json.dumps({'error': 'Not Found'}), {}
            if mid is None:
                return 200, JSON_CT, json.dumps({'id': int(sb), 'name': 'Gate sandbox'}), {}
            if mid not in self.fx['messages'] or mid in [str(x) for x in self.cfg['missing']]:
                return 404, JSON_CT, json.dumps({'error': 'Not Found'}), {}
            if part is not None and part not in MAILTRAP_PARTS:
                return 404, JSON_CT, json.dumps({'error': 'Not Found'}), {}
            return self._mailtrap_message(mid, part)
        # Email on Acid
        m = re.match(r'^/app/acidtest/([A-Za-z0-9]+)(?:/.*)?$', p)
        if m:
            if m.group(1) not in self.fx['eoa_pages']:
                return 404, HTML_CT, _page('Not found'), {}
            return 200, HTML_CT, eoa_page(self.fx, m.group(1), self.cfg['eoa_lazy']), {}
        m = re.match(r'^/web/([A-Za-z0-9]+)/([A-Za-z0-9_.-]+)\.png$', p)
        if m:
            e = self.fx['eoa_pages'].get(m.group(1))
            if not e or m.group(2) not in e['codes']:
                return 404, 'text/plain; charset=utf-8', 'no such render', {}
            return 200, 'image/png', png_for(m.group(2)), {}
        # Google Docs (the gate override fetches it with no token)
        m = re.match(r'^/v1/documents/([A-Za-z0-9_-]+)$', p)
        if m:
            d = self.fx['docs'].get(m.group(1))
            if not d:
                return 404, JSON_CT, json.dumps({'error': {'code': 404, 'status': 'NOT_FOUND'}}), {}
            return 200, JSON_CT, json.dumps(d), {}
        # Everything else is a destination page
        if p in self.cfg['dead_paths']:
            return 404, HTML_CT, _page('Page not found'), {}
        return 200, HTML_CT, _page('Example Relief | ' + (p.strip('/').split('/')[-1] or 'Home'), '<h1>Destination</h1>'), {}

    def _pardot(self, link_id, slug):
        info = self.fx['linkids'].get(link_id)
        if not info:
            return 404, 'text/plain; charset=utf-8', 'unknown link', {}
        if info['interstitial']:
            return 200, HTML_CT, info['interstitial'], {}
        return 200, HTML_CT, make_interstitial(self.fx, 'https://www.example.org/%s/%s' % (info['slug'], sibling_query(self.fx, link_id))), {}

    # -- the Mailtrap message routes ---------------------------------------------------------
    def _mailtrap_message(self, mid, part):
        """The message JSON (part None) and the five parts of message `mid`, from the proofs fixture (self.fx['messages'][mid]
        = {ticket, proof}); the caller has already authenticated and 404'd an unknown or `missing` id.

          part None             200 JSON  proof['message']
          'body.htmlsource'     200 text/html; charset=utf-8   proof['htmlsource']
          'body.txt'            200 text/plain; charset=utf-8  proof['text'] + self.cfg['txt_append'].get(mid, '')   (the token scenario)
          'body.raw'            200 text/plain; charset=utf-8  proof['raw']   (a header block: the fixture has no body of its own)
          'mail_headers'        200 JSON  proof['mailHeaders']
          'spam_report'         200 JSON  proof['spamReport']

        Returns (status, content type, body, {}) like _route. Nothing else in the fixture is served (the *_path fields hold
        /api/testing_message_parts/SYNTHETICTOKEN/... and are never routed). Check: selftest section "mailtrap messages"."""
        proof = self.fx['messages'][mid]['proof']
        if part is None:
            return 200, JSON_CT, json.dumps(proof['message']), {}
        if part == 'body.htmlsource':
            return 200, 'text/html; charset=utf-8', proof['htmlsource'], {}
        if part == 'body.txt':
            return 200, 'text/plain; charset=utf-8', proof['text'] + self.cfg['txt_append'].get(mid, ''), {}
        if part == 'body.raw':
            return 200, 'text/plain; charset=utf-8', proof['raw'], {}
        if part == 'mail_headers':
            return 200, JSON_CT, json.dumps(proof['mailHeaders']), {}
        if part == 'spam_report':
            return 200, JSON_CT, json.dumps(proof['spamReport']), {}
        return 404, JSON_CT, json.dumps({'error': 'Not Found'}), {}


# ══ Selftest ══════════════════════════════════════════════════════════════════════════════════════════

class _Self(object):
    def __init__(self):
        self.passed = self.failed = 0
        self.pending = []

    def chk(self, name, cond, detail=None):
        if cond:
            self.passed += 1
            print('  ok   ' + name)
        else:
            self.failed += 1
            print('  FAIL ' + name + ('   -> ' + json.dumps(detail, default=str)[:300] if detail is not None else ''))

    def pend(self, item, name):
        self.pending.append(item)
        print('  PEND %s  %s' % (item, name))


def _get(svc, path, headers=None, method='GET'):
    c = http.client.HTTPConnection('127.0.0.1', svc.port, timeout=10)
    try:
        c.request(method, path, headers=headers or {})
        r = c.getresponse()
        body = r.read()
        return r.status, dict((k.lower(), v) for k, v in r.getheaders()), body
    finally:
        c.close()


def selftest(strict=False):
    t = _Self()
    svc = Services(0)
    print('fake services on %s' % svc.base)
    try:
        fx = svc.fx
        t.chk('fixtures loaded: 8 messages, one sandbox, 2 docs, 4 EoA pages', len(fx['messages']) == 8 and fx['sandbox'] == '7000001'
              and len(fx['docs']) == 2 and len(fx['eoa_pages']) == 4, [len(fx['messages']), fx['sandbox'], len(fx['docs']), len(fx['eoa_pages'])])
        t.chk('EX-2 has 24 Pardot linkIds to GET (the plan\'s count) and EX-1 has 26', (len(expected_pardot_linkids(fx, 'EX-2')), len(expected_pardot_linkids(fx, 'EX-1'))) == (24, 26),
              (len(expected_pardot_linkids(fx, 'EX-2')), len(expected_pardot_linkids(fx, 'EX-1'))))
        mt = '7100000005'
        web = '/sandboxes/7000001/messages/' + mt
        s, h, _ = _get(svc, web)
        t.chk('mailtrap web without the cookie: 302 to /signin', s == 302 and h.get('location') == '/signin', (s, h.get('location')))
        s, h, b = _get(svc, web, {'Cookie': 'mt=1'})
        t.chk('mailtrap web with mt=1: 200 and a title that is not a bot check', s == 200 and b'<title>Mailtrap</title>' in b, s)
        s, _, _ = _get(svc, web, {'Cookie': 'mt=0'})
        t.chk('a wrong cookie value is signed out', s == 302, s)
        s, _, b = _get(svc, '/signin')
        t.chk('/signin: 200 "Sign in"', s == 200 and b'Sign in | Mailtrap' in b, s)
        s, _, _ = _get(svc, '/sandboxes/7000001/messages/9999999999', {'Cookie': 'mt=1'})
        t.chk('an unknown message page is 404', s == 404, s)
        svc.reset(challenge=True)
        s, _, b = _get(svc, web, {'Cookie': 'mt=1'})
        t.chk('challenge switch serves the "Just a moment..." page', s == 200 and b'Just a moment' in b, s)
        svc.reset()
        s, _, _ = _get(svc, '/api/accounts')
        t.chk('/api/accounts without the cookie: 401', s == 401, s)
        s, _, b = _get(svc, '/api/accounts', {'Cookie': 'mt=1'})
        t.chk('/api/accounts with the cookie lists 111 and 222', s == 200 and [a['id'] for a in json.loads(b)] == [111, 222], b[:80])
        svc.reset(accounts=[111])
        s, _, b = _get(svc, '/api/accounts', {'Cookie': 'mt=1'})
        t.chk('accounts=[111] (the personal scenario) lists only 111', [a['id'] for a in json.loads(b)] == [111], b[:80])
        svc.reset()
        s, _, _ = _get(svc, '/api/accounts/222/inboxes/7000001', {'Cookie': 'mt=1'})
        t.chk('the owning account (222) has the sandbox: 200', s == 200, s)
        s, _, _ = _get(svc, '/api/accounts/111/inboxes/7000001', {'Cookie': 'mt=1'})
        t.chk('the other account (111) gets 404', s == 404, s)
        s, _, _ = _get(svc, '/api/accounts/222/inboxes/7000001')
        t.chk('the inbox without the cookie is 401', s == 401, s)
        # the Mailtrap message routes
        s, h, b = _get(svc, '/api/accounts/222/inboxes/7000001/messages/' + mt, {'Cookie': 'mt=1'})
        if s == 501 and h.get('x-stub') == 'F-01':
            t.pend('F-01', 'mailtrap messages: the message JSON and the five parts are still a stub')
        else:
            p = fx['messages'][mt]['proof']
            t.chk('mailtrap messages: the message JSON is the fixture\'s', s == 200 and json.loads(b) == p['message'], s)
            for part, field, want_ct in (('body.htmlsource', 'htmlsource', 'text/html'), ('body.txt', 'text', 'text/plain'), ('body.raw', 'raw', 'text/plain')):
                s, h, b = _get(svc, '/api/accounts/222/inboxes/7000001/messages/%s/%s' % (mt, part), {'Cookie': 'mt=1'})
                t.chk('mailtrap messages: %s is the fixture\'s %s' % (part, field), s == 200 and h.get('content-type', '').startswith(want_ct) and b.decode('utf-8') == p[field], (s, h.get('content-type')))
            for part, field in (('mail_headers', 'mailHeaders'), ('spam_report', 'spamReport')):
                s, h, b = _get(svc, '/api/accounts/222/inboxes/7000001/messages/%s/%s' % (mt, part), {'Cookie': 'mt=1'})
                t.chk('mailtrap messages: %s is the fixture\'s %s' % (part, field), s == 200 and json.loads(b) == p[field], s)
            svc.reset(txt_append={mt: '\n{{{dynamic_content_101}}}\n'})
            s, _, b = _get(svc, '/api/accounts/222/inboxes/7000001/messages/%s/body.txt' % mt, {'Cookie': 'mt=1'})
            t.chk('mailtrap messages: txt_append lands at the end of body.txt only', s == 200 and b.decode('utf-8').endswith('{{{dynamic_content_101}}}\n') and b.decode('utf-8') != p['text'], s)
            svc.reset(missing=[mt])
            s, _, _ = _get(svc, '/api/accounts/222/inboxes/7000001/messages/' + mt, {'Cookie': 'mt=1'})
            t.chk('mailtrap messages: a missing id is 404', s == 404, s)
            svc.reset()
        # Pardot
        lid = 'x2v0dr'
        path = '/e/900001/v1-utm-term-701EX00000fghijAAA/%s/2000000002/h/SynthHash0' % lid
        s, _, b = _get(svc, path)
        t.chk('pardot: a fixture linkId serves its interstitial (the destination <a>, the JS fallback, the recipient line)',
              s == 200 and b'tracked link' in b and b"<a href='https://www.example.org/give/seed-kits/?utm_source=pardot&amp;" in b and b'window.location.href' in b, s)
        s, _, b = _get(svc, '/e/900001/examplerelief/x2v0fb/2000000002/h/SynthHash0')
        t.chk('pardot: a linkId with no fixture page gets a generated one in the same layout (destination /<slug>/, JS escaped)',
              s == 200 and b"<a href='https://www.example.org/examplerelief/?utm_source=pardot&amp;" in b and b'https\\x3a\\x2f\\x2fwww\\x2eexample\\x2eorg\\x2fexamplerelief\\x2f\\x3futm' in b, b[-400:])
        t.chk('pardot: and its destination carries the UTMs of the same email version (so a content link such as the SMS banner passes the UTM shape)',
              sibling_query(fx, 'x2v0sm') == sibling_query(fx, 'x2v0dr') != '' and sibling_query(fx, 'x2v1sm') == sibling_query(fx, 'x2v1dr') != sibling_query(fx, 'x2v0sm')
              and sibling_query(fx, 'nosuchlink') == '', (sibling_query(fx, 'x2v0sm'), sibling_query(fx, 'x2v1sm')))
        s, _, _ = _get(svc, '/e/900001/x/nosuchlink/2000000002/h/SynthHash0')
        t.chk('pardot: an unknown linkId is 404', s == 404, s)
        before = svc.mark()
        _get(svc, '/webmail/900001/2000000002/0123456789abcdef0123456789abcdef')
        _get(svc, '/unsubscribeConfirm/900001/0123456789abcdef0123456789abcdef/2000000002')
        g = svc.since(before)
        t.chk('guarded paths answer 200 and are logged as guarded requests', len(g) == 2 and all(e['status'] == 200 and is_guarded_request(e) for e in g), g)
        # destinations
        s, _, b = _get(svc, '/give/seed-kits/?utm_source=pardot')
        t.chk('a destination answers 200 with a title', s == 200 and b'<title>Example Relief | seed-kits</title>' in b, s)
        svc.reset(dead_paths=['/gone/'])
        s, _, _ = _get(svc, '/gone/')
        t.chk('dead_paths 404', s == 404, s)
        svc.reset()
        # EoA
        guid = [g for g, e in fx['eoa_pages'].items() if e['ticket'] == 'EX-2' and e['variation'] == 'v0'][0]
        s, _, b = _get(svc, '/app/acidtest/%s/list' % guid)
        txt = b.decode('utf-8')
        t.chk('eoa: the list page keeps `var test = ` and has one lazy <img> per client (16)', s == 200 and 'var test = ' in txt and txt.count('<img ') == 16 and txt.count('loading="lazy"') == 16, (s, txt.count('<img ')))
        code = fx['eoa_pages'][guid]['codes'][0]
        s, h, b = _get(svc, '/web/%s/%s.png' % (guid, code))
        w, ht = struct.unpack('>II', b[16:24]) if len(b) > 24 else (0, 0)
        t.chk('eoa: a render is a PNG 600 px wide, 700-1000 px high', s == 200 and b[:8] == b'\x89PNG\r\n\x1a\n' and w == 600 and 700 <= ht <= 1000 and h.get('content-type') == 'image/png', (s, w, ht))
        t.chk('eoa: two clients get different renders', png_for(fx['eoa_pages'][guid]['codes'][0]) != png_for(fx['eoa_pages'][guid]['codes'][1]))
        s, _, _ = _get(svc, '/web/%s/no_such_client.png' % guid)
        t.chk('eoa: an unknown client render is 404', s == 404, s)
        # Docs
        s, _, b = _get(svc, '/v1/documents/EXDOC_EX2_COPY_DOC_000000000002')
        t.chk('docs: the EX-2 copy doc', s == 200 and json.loads(b)['documentId'] == 'EXDOC_EX2_COPY_DOC_000000000002' and 'body' in json.loads(b), s)
        s, _, _ = _get(svc, '/v1/documents/EXDOC_NOPE_000000000000000')
        t.chk('docs: an unknown id is 404', s == 404, s)
        # the log
        log = svc.since(0)
        kinds = sorted(set(e['kind'] for e in log))
        t.chk('the log recorded every kind served', all(k in kinds for k in ('mt-web', 'mt-api', 'mt-msg', 'pardot-e', 'pardot-guarded', 'eoa-page', 'eoa-img', 'docs', 'dest')), kinds)
        t.chk('log entries carry the fields the gate reads', all(set(('n', 'method', 'path', 'query', 'kind', 'status', 'auth', 'cookie', 'dest', 'mode')) <= set(e) for e in log))
        t.chk('log numbering is 0..n-1 in arrival order', [e['n'] for e in log] == list(range(len(log))))
        try:
            svc.reset(nope=1)
            t.chk('reset() rejects an unknown switch', False)
        except ValueError:
            t.chk('reset() rejects an unknown switch', True)
    finally:
        svc.close()
    print('\n=== %d passed, %d failed, %d pending ===' % (t.passed, t.failed, len(t.pending)))
    for item in sorted(set(t.pending)):
        print('  - %s still a stub' % item)
    if t.failed:
        return 1
    if strict and t.pending:
        return 3
    return 0


def main(argv):
    args = argv[1:]
    if '--selftest' in args:
        return selftest(strict='--strict' in args)
    if '--serve' in args:
        svc = Services(0)
        print('serving %s  (Ctrl-C to stop; send "Cookie: mt=1" for the Mailtrap routes)' % svc.base)
        try:
            while True:
                threading.Event().wait(3600)
        except KeyboardInterrupt:
            svc.close()
        return 0
    sys.stderr.write(__doc__.split('WHAT IS FAKED')[0] + '\n')
    return 64


if __name__ == '__main__':
    sys.exit(main(sys.argv))
