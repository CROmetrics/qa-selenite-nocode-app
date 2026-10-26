#!/usr/bin/env python3
r"""Generate the seven SYNTHETIC fixtures-email-*.json files (Email Check) and host the generic helpers.

    python3 -I extension/tests/gen-email-fixtures.py                  # verify only; exits 1 on drift
    python3 -I extension/tests/gen-email-fixtures.py --write          # rewrite all seven (all or none)
    python3 -I extension/tests/gen-email-fixtures.py --only NAME      # dry run of ONE fixture, never writes
    python3 -I extension/tests/gen-email-fixtures.py --selftest-gate  # prove the synthetic gate catches what it must
    python3 -I extension/tests/gen-email-fixtures.py --out DIR        # write/compare somewhere else

WHY THIS FILE IS COMMITTED AND SYNTHETIC. The repository is public. Real AAH test data (Mailtrap proofs, Pardot
pages, Jira text, the copy doc, plan notes, ids, links) must never enter it, so everything this script produces
is MADE UP: org "Example Relief", ticket keys EX-1 / EX-2, hosts under example.org / example.net, ids that
start with EX or are plainly artificial. It is deterministic (no clock, no randomness, no network, no
environment) and structurally faithful: every quirk the real captures showed has a synthetic carrier.
The real data lives only under a git-excluded local directory; its derived fixtures come from a
local derivation tool, which imports THIS file's generic helpers by path.

WHAT IS IN HERE
  1. Generic helpers shared with the local real-data tool: serialize, write_all, Src, the visible-text
     scanner (the Python twin of ecVisibleText's paragraph output), find_greeting, the command-line driver
     run_cli (arguments, generate, gate, verify-or-write, exit codes).
  2. The synthetic universe: constants, the ticket specs, link/UTM/id helpers, the email builders
     (build_html, build_text), ADF and Docs element helpers.   [do not touch]
  3. The synthetic gate (hosts, addresses, ticket keys, id spaces) and the cross-fixture invariants.
     [safety-critical, do not touch]
  4. The generators; each docstring is the whole contract.
  5. OUTPUTS (the seven files) and main.

EXIT CODES (the same in the local tool)
    0  clean (verify), written (--write), or a dry run / selftest that passed
    1  a required source is missing (local tool only) or the committed fixtures differ from the regenerated ones
    2  the gate found a violation (nothing compared, nothing written)
    3  a generation item is still a stub (NotImplementedError('<item id>')): nothing written
    64 usage error (argparse's own exit 2 is remapped so 2 only ever means "gate")

STYLE. Python 3.9 compatible (the system python), stdlib only, run as `python3 -I`, no annotations that need 3.10.
"""
import argparse
import copy
import difflib
import json
import os
import quopri
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# ══ 1. Generic helpers (shared with the local real-data derivation tool) ═══════════════════════

class Src(object):
    """Read-only view of a captures directory. Nothing in here writes."""

    def __init__(self, root):
        self.root = root

    def path(self, rel):
        """Returns the absolute path of `rel` (a '/'-separated path relative to the root)."""
        return os.path.join(self.root, *rel.split('/'))

    def exists(self, rel):
        """Returns True when `rel` is an existing file."""
        return os.path.isfile(self.path(rel))

    def text(self, rel):
        """Returns the file's content as str, decoded as UTF-8 with NO newline translation."""
        with open(self.path(rel), 'r', encoding='utf-8', newline='') as fh:
            return fh.read()

    def json(self, rel):
        """Returns the parsed JSON of `rel` (dict key order = file order)."""
        return json.loads(self.text(rel))

    def names(self, rel_dir):
        """Returns the sorted file names directly inside the directory `rel_dir`."""
        base = self.path(rel_dir)
        return sorted(n for n in os.listdir(base) if os.path.isfile(os.path.join(base, n)))


def serialize(obj):
    """Returns the committed bytes for one fixture: json.dumps(indent=1, ensure_ascii=True, sort_keys=False) +
    one trailing newline, ASCII only. ensure_ascii on purpose: the fixtures hold invisible characters (U+034F,
    U+2007, U+00AD, U+200B) that must be visible escapes in a reviewed file, and jsc's read() then never has an
    encoding question. Key order is insertion order, which every builder fixes."""
    return (json.dumps(obj, indent=1, ensure_ascii=True, sort_keys=False) + '\n').encode('ascii')


def write_all(blobs, out_dir):
    """Writes every {file name: bytes} into `out_dir` (created if missing): temp files first, then renames; the
    temp files are removed if anything fails midway. Returns None."""
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    staged = []
    try:
        for name, data in blobs.items():
            final = os.path.join(out_dir, name)
            tmp = final + '.tmp'
            with open(tmp, 'wb') as fh:
                fh.write(data)
            staged.append((tmp, final))
        for tmp, final in staged:
            os.replace(tmp, final)
    except BaseException:
        for tmp, _final in staged:
            if os.path.exists(tmp):
                os.remove(tmp)
        raise


# ── Visible-text scanner (the Python twin of ecVisibleText) ──
# Rules (nothing else): comments skipped; <head> <style> <script> <title> skipped with their content; void
# elements have no content; block tags (p div td th tr table tbody h1-h6 li ul ol br center blockquote section)
# end a paragraph; an element whose style (lower-cased, whitespace removed) contains display:none or
# mso-hide:all, or both max-height:0 and overflow:hidden, is hidden together with everything inside it, and
# its text is a preheader candidate instead of a paragraph; entities decode through the fixed table below only
# (an unknown named entity stays as written); then U+034F U+00AD U+2007 U+200B-U+200D U+2060 U+FEFF are removed,
# NBSP becomes a space and whitespace collapses; empty paragraphs are dropped.

_ENTITIES = {'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'", 'nbsp': '\u00a0',
             'rsquo': '’', 'lsquo': '‘', 'rdquo': '”', 'ldquo': '“',
             'ndash': '–', 'mdash': '—', 'hellip': '…', 'copy': '©',
             'reg': '®', 'trade': '™', 'zwnj': '\u200c', 'zwj': '\u200d', 'shy': '\u00ad',
             'middot': '·', 'bull': '•', 'laquo': '«', 'raquo': '»'}
_RE_ENTITY = re.compile(r'&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);')
_RE_INVISIBLE = re.compile('[\u034f\u00ad\u2007\u200b-\u200d\u2060\ufeff]')
_RE_TAG = re.compile(r'<!--.*?-->|<![^>]*>|<\?[^>]*>|<(/?)([A-Za-z][A-Za-z0-9:_-]*)((?:"[^"]*"|\'[^\']*\'|[^\'">])*)>', re.S)
_RE_ATTR = re.compile(r'([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s"\'>]+)))?')
_BLOCK_TAGS = frozenset('p div td th tr table tbody h1 h2 h3 h4 h5 h6 li ul ol br center blockquote section'.split())
_SKIP_TAGS = frozenset(['head', 'style', 'script', 'title'])
_VOID_TAGS = frozenset('area base br col embed hr img input link meta param source track wbr'.split())


def decode_entities(s):
    """Returns `s` with numeric (&#8217; &#x2019;) and the table's named entities decoded; any other named
    entity is left exactly as written."""
    def one(m):
        body = m.group(1)
        if body[0] == '#':
            try:
                return chr(int(body[2:], 16) if body[1] in 'xX' else int(body[1:]))
            except (ValueError, OverflowError):
                return m.group(0)
        return _ENTITIES.get(body, m.group(0))
    return _RE_ENTITY.sub(one, s)


def clean_text(s):
    """Returns `s` with the invisible characters removed, NBSP turned into a space, whitespace collapsed to
    single spaces and the ends trimmed."""
    return re.sub(r'\s+', ' ', _RE_INVISIBLE.sub('', s).replace('\u00a0', ' ')).strip()


def _style_hides(style):
    s = re.sub(r'\s+', '', style.lower())
    return 'display:none' in s or 'mso-hide:all' in s or ('max-height:0' in s and 'overflow:hidden' in s)


def scan_visible_paragraphs(html):
    """Returns (paragraphs, preheader): the list of non-empty visible paragraphs of `html` in document order,
    and the first non-empty hidden text (or None). See the rules above."""
    paras, hidden_text, cur, stack, pos = [], [], [], [], 0

    def flush():
        t = clean_text(''.join(cur))
        del cur[:]
        if t:
            (hidden_text if any(h for _n, h in stack) else paras).append(t)

    while True:
        m = _RE_TAG.search(html, pos)
        text = html[pos:(m.start() if m else len(html))]
        if text:
            cur.append(decode_entities(text))
        if not m:
            break
        pos = m.end()
        if m.group(2) is None:
            continue
        closing, name, rest = m.group(1) == '/', m.group(2).lower(), m.group(3)
        if not closing and name in _SKIP_TAGS:
            end = re.compile(r'</%s\s*>' % re.escape(name), re.I).search(html, pos)
            pos = end.end() if end else len(html)
            continue
        if name in _BLOCK_TAGS:
            flush()
        if closing:
            for i in range(len(stack) - 1, -1, -1):
                if stack[i][0] == name:
                    del stack[i:]
                    break
        elif name not in _VOID_TAGS and not rest.rstrip().endswith('/'):
            style = ''
            for a in _RE_ATTR.finditer(rest):
                if a.group(1).lower() == 'style':
                    style = decode_entities(next(g for g in (a.group(2), a.group(3), a.group(4), '') if g is not None))
            stack.append((name, _style_hides(style)))
    flush()
    return paras, (hidden_text[0] if hidden_text else None)


def find_greeting(paragraphs):
    """Returns the index of the greeting paragraph: the first of the first 12 paragraphs that ends with ',' and
    has at most 6 words; None when there is none."""
    for i, p in enumerate(paragraphs[:12]):
        if p.endswith(',') and len(p.split()) <= 6:
            return i
    return None


# ── The command-line driver both scripts use ───────────────────────────────────────────────────────────

class _Parser(argparse.ArgumentParser):
    def error(self, message):
        sys.stderr.write('%s\nusage error: %s\n' % (self.format_usage().rstrip(), message))
        sys.exit(64)


def generate(ctx, selected):
    """Runs the generators in `selected` (a list of (file name, fn) pairs; each fn takes `ctx`). Returns
    (outputs, pending): outputs maps file name -> object for every generator that finished; pending is a list of
    (file name, item id) for each generator that hit a NotImplementedError stub."""
    outputs, pending = {}, []
    for name, fn in selected:
        try:
            outputs[name] = fn(ctx)
        except NotImplementedError as e:
            pending.append((name, str(e) or '?'))
    return outputs, pending


def run_cli(prog, description, outputs, default_out, gate, selftest, src_default=None, missing=None, argv=None):
    """The whole command line of both generator scripts. `outputs` is the list of (file name, fn(ctx)); `gate`
    maps {file name: object} -> list of violation strings; `selftest()` returns an exit code; `src_default`
    (a directory, or None for the synthetic generator) turns on --src, builds ctx = Src(dir) and requires
    `missing(ctx)` to return []; otherwise ctx is None. Returns the process exit code (see the module
    docstring): verify-only by default, --write all or nothing, --only a dry run, --selftest-gate."""
    ap = _Parser(prog=prog, description=description)
    if src_default is not None:
        ap.add_argument('--src', default=src_default, help='directory of raw captures (default: %(default)s)')
    ap.add_argument('--out', default=default_out, help='directory the fixtures are written to / compared in (default: %(default)s)')
    ap.add_argument('--write', action='store_true', help='write all fixtures (all or nothing)')
    ap.add_argument('--only', choices=[n for n, _f in outputs], help='dry run of one fixture; never writes')
    ap.add_argument('--selftest-gate', action='store_true', dest='selftest_gate',
                    help='check that the gate catches what it must, then exit')
    args = ap.parse_args(sys.argv[1:] if argv is None else argv)
    if args.write and args.only:
        ap.error('--write regenerates all fixtures; it cannot be combined with --only')
    if args.selftest_gate:
        return selftest()
    ctx = None
    if src_default is not None:
        ctx = Src(os.path.abspath(args.src))
        lost = missing(ctx)
        if lost:
            print('required raw capture(s) missing under %s:' % ctx.root)
            for rel in lost:
                print('    ' + rel)
            print('Capture them (plan 3.1) or point --src at the directory that has them.')
            return 1
    out_dir = os.path.abspath(args.out)
    selected = [o for o in outputs if not args.only or o[0] == args.only]
    made, pending = generate(ctx, selected)
    if pending:
        print('generation item(s) not implemented yet:')
        for name, item in pending:
            print('    %-36s item %s' % (name, item))
        print('Nothing was written.')
        return 3
    problems = gate(made)
    if problems:
        print('GATE: %d violation(s); nothing was compared or written:' % len(problems))
        for line in problems[:50]:
            print('    ' + line)
        if len(problems) > 50:
            print('    ... and %d more' % (len(problems) - 50))
        return 2
    blobs = dict((name, serialize(made[name])) for name, _fn in selected)
    state = {}
    for name, data in blobs.items():
        path = os.path.join(out_dir, name)
        if not os.path.exists(path):
            state[name] = 'missing'
        else:
            with open(path, 'rb') as fh:
                state[name] = 'same' if fh.read() == data else 'differs'
    if args.write:
        write_all(blobs, out_dir)
        for name in blobs:
            print('%-36s %s (%d bytes)' % (name, 'unchanged' if state[name] == 'same' else 'written', len(blobs[name])))
        return 0
    for name in blobs:
        print('%-36s %s' % (name, {'same': 'reproduced', 'differs': 'DIFFERS from committed',
                                   'missing': 'not committed yet'}[state[name]]))
    if args.only:
        print('dry run of 1 of %d fixtures (gate clean); only a full verify counts' % len(outputs))
        return 0
    stale = [n for n, st in state.items() if st != 'same']
    if stale:
        for name in stale:
            if state[name] != 'differs':
                continue
            with open(os.path.join(out_dir, name), 'rb') as fh:
                old = fh.read().decode('ascii').splitlines()
            new = blobs[name].decode('ascii').splitlines()
            shown = 0
            for line in difflib.unified_diff(old, new, fromfile='committed', tofile='regenerated', lineterm='', n=0):
                print('    ' + line[:160])
                shown += 1
                if shown >= 30:
                    print('    ...')
                    break
        print('\n%d fixture(s) are stale or missing. Fix the generator, or re-run with --write.' % len(stale))
        return 1
    print('all %d fixtures reproduced' % len(outputs))
    return 0


# ══ 2. The synthetic universe ═══════════════════════════════════════════════════════════
# Nothing below is real. Every host is under example.org / example.net or is a tool host (mailtrap.io,
# app.emailonacid.com, images.emailonacid.com, docs.google.com, docs.googleapis.com); every id is artificial.

ORG_NAME = 'Example Relief'
ORG_DOMAIN = 'example.org'
SITE_HOST = 'www.example.org'
PARDOT_HOST = 'marketing.example.org'
PARDOT_ACCT = '900001'
PROSPECT = '2000000002'
HASH = 'SynthHash0'
HEX_TAIL = '0123456789abcdef0123456789abcdef'
SANDBOX = '7000001'
MAIL_FROM = 'info@example.org'
BOUNCE = 'bounce-SYNTH@bounce.example.net'
MSG_PARTS = '/api/testing_message_parts/SYNTHETICTOKEN'
CLIENT_IP = '192.0.2.1'
SYNTHETIC_TOKEN = 'SYNTHETICTOKEN'

VARIATIONS = ('v0', 'v1')
SEGMENTS = (
    {'name': 'Regular Donors', 'slug': 'regular-donors', 'tag': 'regular', 'key': 'rg',
     'greeting': 'Regular Donor Test', 'donate': 'dr'},
    {'name': 'Major Donors', 'slug': 'major-donors', 'tag': 'major', 'key': 'mj',
     'greeting': 'Major Donor Test', 'donate': 'dm'},
)
# The four proofs of a ticket, in fixture order: (segment index, variation index).
PROOF_INDEX = ((0, 0), (0, 1), (1, 0), (1, 1))
TICKET_KEYS = ('EX-1', 'EX-2')

SOCIAL_SLUGS = {'fb': 'examplerelief', 'tw': 'exrelief', 'yt': 'examplerelief', 'li': 'company-examplerelief',
                'ig': 'examplerelief', 'da': 'give-donor-advised-funds', 'cr': 'give-cryptocurrency-donations'}
SOCIAL_ORDER = ('fb', 'tw', 'yt', 'li', 'ig')
SOCIAL_NAMES = {'fb': 'facebook', 'tw': 'twitter', 'yt': 'youtube', 'li': 'linkedin', 'ig': 'instagram'}

# Shared email copy. HTML pieces use straight apostrophes and &nbsp; exactly as the real emails did.
ORG_PARAGRAPH = ('Example Relief is a made-up relief group that exists only to exercise email tooling. In its imagined '
                 'history it has run depots, clinics and schools in 30 invented regions.')
ADDRESS_HTML = 'Example Relief | PO Box 0000 | Sampletown,&nbsp;ST&nbsp;00000'
LEGAL_TEXT = '© 2027 Example Relief. Not a real organization; invented for software testing only. Tax ID 00-0000000.'
SMS_ALT = "a phone showing a message thread with the text 'Join the text club: send JOIN to 55555'"
BADGE_ALT = 'Four stars from Example Charity Rater and a Sample Registry gold seal'
LOGO_ALT = 'Example Relief'

TICKETS = {
    'EX-1': {
        'n': 1, 'layout': 'story', 'issue_id': 100001, 'issue_type': 'Message', 'issue_type_id': '10001',
        'avatar_id': 10501, 'summary': 'Cold Route - Message 1',
        'slug': 'RO-utm-term-701EX00000abcdeAAQ', 'term': '701EX00000abcdeAAQ',
        'utm_campaign': 'Field_Stories_Q1_2027',
        'utm_content': {'v0': '01.15.27_EML_Cold_Route_CRO', 'v1': '01.15.27_EML_Cold_Route_CRO'},
        'subject': {'v0': 'Proof - (Version A) Route 9 leaves before sunrise',
                    'v1': 'Proof - (Version B) Route 9 leaves before sunrise'},
        'eoa_subject': 'Proof - Route 9 leaves before sunrise',
        'preheader': "Odile's van is already on the river road.",
        'text_leading_blank': True,
        'sent': '2027-01-08T15:00:00.000Z', 'created': '2027-01-08T15:00:02.000Z', 'updated': '2027-01-11T14:00:00.000Z',
        'date_header': 'Fri, 08 Jan 2027 09:00:00 -0600', 'received_date': 'Fri, 08 Jan 2027 15:00:00 +0000',
        'message_base': 7100000000,
        'donate_path': ('/give/regular/', '/give/major/'), 'story_path': '/stories/route-nine/',
        'badge_slug': '2027-01-15', 'img_date': '2027-01-15',
        'doc_id': 'EXDOC_EX1_COPY_DOC_000000000001', 'plan_id': 'EXPLAN_EX1_TEST_PLAN_00000000001',
        'landing': 'https://www.example.org/stories/route-nine/',
        'qp_proof': None,
    },
    'EX-2': {
        'n': 2, 'layout': 'appeal', 'issue_id': 100002, 'issue_type': 'Email Message', 'issue_type_id': '10002',
        'avatar_id': 10502, 'summary': 'Spring Seed Kits: Last Call',
        'slug': 'v1-utm-term-701EX00000fghijAAA', 'term': '701EX00000fghijAAA',   # v1 on EVERY proof: misleading on purpose
        'utm_campaign': 'Seed_Kits_Q1_2027',
        'utm_content': {'v0': '02.01.27_EML_Seed_Kits_CRO-v0', 'v1': '02.01.27_EML_Seed_Kits_CRO-v1'},
        'subject': {'v0': 'Proof - Last call: seed kits ship Monday', 'v1': 'Proof - Last call: seed kits ship Monday'},
        'eoa_subject': 'Proof - Last call: seed kits ship Monday',
        'preheader': 'Kits ordered by Friday noon go out Monday.',
        'text_leading_blank': False,
        'sent': '2027-01-29T16:00:00.000Z', 'created': '2027-01-29T16:00:02.000Z', 'updated': '2027-02-01T14:00:00.000Z',
        'date_header': 'Fri, 29 Jan 2027 10:00:00 -0600', 'received_date': 'Fri, 29 Jan 2027 16:00:00 +0000',
        'message_base': 7100000004,
        'donate_path': ('/give/seed-kits/', '/give/seed-kits-major/'), 'story_path': None,
        'badge_slug': '2027-02-01', 'img_date': '2027-02-01',
        'doc_id': 'EXDOC_EX2_COPY_DOC_000000000002', 'plan_id': 'EXPLAN_EX2_TEST_PLAN_00000000002',
        'landing': 'https://www.example.org/give/seed-kits/',
        'qp_proof': (1, 1),      # Major Donors v1: the html part is quoted-printable (soft breaks and =3D)
    },
}

# ── EX-1 (story) copy ───────────────────────────────────────────────────────────────────────────────────
EX1_HERO_FILES = {'v0': 'image_1200x800_story_hero_v0.jpg', 'v1': 'image_1200x800_story_hero_v1.jpg'}
EX1_HERO_ALT = "a delivery driver lifting an insulated box into a van with the text 'Before the Fog Lifts'"   # unchanged in v1: the bug
EX1_STAT_FILE = 'image_1200x468_story_stat.jpg'
EX1_STAT_ALT = 'Since March, Odile' + chr(0x2019) + 's van has reached 62 clinics and pharmacies before nine in the morning.'
EX1_CTA_HTML = "SEE WHAT'S IN THE VAN"
EX1_PARAGRAPHS_HTML = [
    'The van leaves the Pine Street depot at 5:40, before the fog has cleared the river road.',
    "Odile's eleventh winter on Route 9 has taught her which bridge floods, which gate sticks and which porch light means somebody is waiting up.",
    'This season the back of the van carries insulated boxes that keep medicine cold for ten&nbsp;hours.',
]
EX1_LAST_PARAGRAPH_HTML = 'Two more valleys are on the waiting list, and each one needs a van, a driver and a cold box.'
EX1_CREDIT_HTML = '<em>Photo Credit: </em>Example Relief,&nbsp;Pine&nbsp;Street&nbsp;Depot'
# The same copy as the copy doc holds it (curly apostrophes; the third paragraph has a trailing space).
EX1_DOC_BODY = [
    'The van leaves the Pine Street depot at 5:40, before the fog has cleared the river road.',
    'Odile' + chr(0x2019) + 's eleventh winter on Route 9 has taught her which bridge floods, which gate sticks and which porch light means somebody is waiting up.',
    'This season the back of the van carries insulated boxes that keep medicine cold for ten hours. ',
    EX1_STAT_ALT,
    'Two more valleys are on the waiting list, and each one needs a van, a driver and a cold box.',
]
EX1_CTA_DOC = 'See What' + chr(0x2019) + 's in the Van'
EX1_SUBJECT_OPTIONS = [('Route 9 leaves before sunrise', True), ('Sixty-two stops and one cold van', False),
                       ('The boxes were delivered before the fog lifted', False)]
EX1_PREVIEW_OPTIONS = [('Sixty-two stops before breakfast.', False), ('Ride along before the fog lifts.', False),
                       ('Ten hours of cold on one winding road.', False),
                       ("Odile's van is already on the river road.", True)]
EX1_DOC_TITLE = 'Odile' + chr(0x2019) + 's Route'

# ── EX-2 (appeal) copy ──────────────────────────────────────────────────────────────────────────────────
EX2_HERO_FILE = 'image_1200x800_seed_hero.jpg'
EX2_HERO_ALT = "a grower holding a tray of seedlings with the text 'Plant Before the Rains'"
EX2_CALLOUT_FILE = 'image_1200x300_seed_callout.jpg'
EX2_CALLOUT_ALT = "a wide banner in green that reads 'Order by Friday noon and your seeds ship on Monday.'"
EX2_H3_1_HTML = 'A kit planted in May becomes a full garden bed by&nbsp;June.'
EX2_P1_HTML = ('Packing closes on Friday at noon. <strong>Every kit ordered before then leaves the warehouse on Monday</strong> '
               + chr(0x2014) + ' early enough to beat the first&nbsp;rains.')
EX2_P2_HTML = ('Each kit holds six varieties, two hand tools and a planting calendar printed in two languages. Growers who start '
               'in the first week of May can usually count on a first harvest by&nbsp;July.')
EX2_H3_2_HTML = '<strong>Kits are packed in the order they&nbsp;arrive.</strong>'
EX2_CTA_LABELS = {'v0': 'DONATE NOW', 'v1': 'HELP NOW'}
EX2_CREDIT_HTML = '<em>Photo Credit: </em>Example Relief,&nbsp;Willow&nbsp;Valley'
EX2_SUBJECT_OPTIONS = [('Last call: seed kits ship Monday', True), ('A garden bed full by June, from one box', False)]
EX2_PREVIEW_OPTION = 'Kits ordered by Friday noon go out Monday.'
SUBJECT_LIMIT_TEXT = 'no more than 9 words and 60 characters'
PREVIEW_LIMIT_TEXT = '50 characters or fewer to stay visible in the inbox'

# ── The 16 Email on Acid clients (EoA's own product names; code = image folder) ────────────────────────
EOA_CLIENTS = (
    ('applemail16', 'Apple Mail 16', 'macOS  13', 'Application'),
    ('applemail16_dm', 'Apple Mail 16', 'macOS 13 (Dark Mode)', 'Application'),
    ('android13_gmailapp_pixel7_lm', 'Gmail App Pixel 7', 'Android 13', 'Mobile'),
    ('android16_gmailapp_pixel10_dm', 'Gmail App Pixel 10', 'Android 16 (Dark Mode)', 'Mobile'),
    ('gmailcom-lm_chrcurrent_win10', 'Gmail.com Chrome', 'Windows 10', 'Web'),
    ('gmailcom-dm_edgecurrent_win10', 'Gmail.com Edge', 'Windows 10 (Dark Mode)', 'Web'),
    ('iphone16pro_18_dm', 'iPhone 16 Pro', 'iOS 18 (Dark Mode)', 'Mobile'),
    ('iphone17promax_26', 'iPhone 17 Pro Max', 'iOS 26', 'Mobile'),
    ('m365com-dm_chrcurrent_win10', 'Microsoft365.com Chrome', 'Windows 10 (Dark Mode)', 'Web'),
    ('m365com-lm_edgecurrent_win10', 'Microsoft365.com Edge', 'Windows 10', 'Web'),
    ('m365_mac13_lm_dt', 'Outlook Microsoft 365', 'macOS 13', 'Application'),
    ('m365_w11_lm_dt', 'Outlook Microsoft 365', 'Windows 11', 'Application'),
    ('outlook2021_win11_lm_dt', 'Outlook 2021', 'Windows 11', 'Application'),
    ('iphone13ol_15_dm', 'Outlook App iPhone 13', 'iOS 15 (Dark Mode)', 'Mobile'),
    ('outlookcom-dm_chrcurrent_win10', 'Outlook.com Chrome', 'Windows 10 (Dark Mode)', 'Web'),
    ('outlookcom-lm_edgecurrent_win10', 'Outlook.com Edge', 'Windows 10', 'Web'),
)

SPAM_DETAILS = (
    ('0.0', 'URIBL_BLOCKED', 'ADMINISTRATOR NOTICE: The query to URIBL was blocked. See https://wiki.example.org/DnsBlocklists for more information. [URI: example.org]'),
    ('-0.1', 'DKIM_VALID', 'Message has at least one valid DKIM or DK signature'),
    ('-0.1', 'DKIM_VALID_AU', "Message has a valid DKIM or DK signature from author's domain"),
    ('0.1', 'DKIM_SIGNED', 'Message has a DKIM or DK signature, not necessarily valid'),
    ('0.0', 'HTML_IMAGE_RATIO_04', 'BODY: HTML has a low ratio of text to image area'),
    ('0.0', 'HTML_MESSAGE', 'BODY: HTML included in message'),
    ('0.0', 'LOTS_OF_MONEY', 'Huge... sums of money'),
    ('0.6', 'LONG_INVISIBLE_TEXT', 'Long block of hidden text - bayes poison?'),
)


# ── ids, links, UTMs ─────────────────────────────────────────────────────────────────────────────────────

def message_ordinal(si, vi):
    """Returns 1..4: the proof's position within its ticket (regular v0, regular v1, major v0, major v1)."""
    return si * 2 + vi + 1


def message_id(tk, si, vi):
    """Returns the synthetic Mailtrap message id (str): EX-1 7100000001-7100000004, EX-2 7100000005-7100000008."""
    return str(TICKETS[tk]['message_base'] + message_ordinal(si, vi))


def message_number(tk, si, vi):
    """Returns 1..8: the proof's number across both tickets (used for boundaries and Received ids)."""
    return TICKETS[tk]['message_base'] - 7100000000 + message_ordinal(si, vi)


def boundary(tk, si, vi):
    """Returns the multipart boundary of the proof: 'EXsynth0N=_?:' (N = message_number, two digits)."""
    return 'EXsynth%02d=_?:' % message_number(tk, si, vi)


def to_address(si):
    """Returns the recipient address of segment `si`: tester+<tag>@inbox.mailtrap.io."""
    return 'tester+%s@inbox.mailtrap.io' % SEGMENTS[si]['tag']


def mailtrap_url(tk, si, vi):
    """Returns https://mailtrap.io/sandboxes/<SANDBOX>/messages/<id> for the proof."""
    return 'https://mailtrap.io/sandboxes/%s/messages/%s' % (SANDBOX, message_id(tk, si, vi))


def eoa_guid(tk, vi):
    """Returns the synthetic EoA test guid: 'EXEOA<n>V<vi>' padded with '0' to 45 characters."""
    return ('EXEOA%dV%d' % (TICKETS[tk]['n'], vi)).ljust(45, '0')


def eoa_url(tk, vi):
    """Returns https://app.emailonacid.com/app/acidtest/<guid>/list for the variation."""
    return 'https://app.emailonacid.com/app/acidtest/%s/list' % eoa_guid(tk, vi)


def link_id(tk, si, vi, slot):
    """Returns the 6-character Pardot linkId 'x<n>v<vi><code>'. Slots: lg logo, sm sms banner, fb tw yt li ig
    social, ch charity badge, da DAF, cr crypto, st story (EX-1), dn the segment's DONATE link (code dr/dm).
    Shared across segments except dn; different per variation."""
    code = SEGMENTS[si]['donate'] if slot == 'dn' else slot
    return 'x%dv%d%s' % (TICKETS[tk]['n'], vi, code)


def link_slug(tk, slot):
    """Returns the tracked-link slug: the ticket slug for lg dn st sm, the badge date for ch, SOCIAL_SLUGS else."""
    t = TICKETS[tk]
    if slot in ('lg', 'dn', 'st', 'sm'):
        return t['slug']
    if slot == 'ch':
        return t['badge_slug']
    return SOCIAL_SLUGS[slot]


def tracked_url(tk, si, vi, slot):
    """Returns https://marketing.example.org/e/900001/<slug>/<linkId>/2000000002/h/SynthHash0."""
    return 'https://%s/e/%s/%s/%s/%s/h/%s' % (PARDOT_HOST, PARDOT_ACCT, link_slug(tk, slot), link_id(tk, si, vi, slot), PROSPECT, HASH)


def webmail_url():
    """Returns the View-in-browser link: https://marketing.example.org/webmail/900001/2000000002/<HEX_TAIL>."""
    return 'https://%s/webmail/%s/%s/%s' % (PARDOT_HOST, PARDOT_ACCT, PROSPECT, HEX_TAIL)


def unsubscribe_url():
    """Returns the Unsubscribe link: https://marketing.example.org/unsubscribeConfirm/900001/<HEX_TAIL>/2000000002."""
    return 'https://%s/unsubscribeConfirm/%s/%s/%s' % (PARDOT_HOST, PARDOT_ACCT, HEX_TAIL, PROSPECT)


def dest_path(tk, si, slot):
    """Returns the destination path a content link resolves to: lg '/', dn the segment's donate path, st the
    story path, sm '/sms-signup/'."""
    t = TICKETS[tk]
    return {'lg': '/', 'dn': t['donate_path'][si], 'st': t['story_path'], 'sm': '/sms-signup/'}[slot]


def utm_query(tk, vi):
    """Returns 'utm_source=pardot&utm_medium=email&utm_campaign=<c>&utm_content=<content[v]>&utm_term=<term>'."""
    t = TICKETS[tk]
    return 'utm_source=pardot&utm_medium=email&utm_campaign=%s&utm_content=%s&utm_term=%s' % (
        t['utm_campaign'], t['utm_content']['v%d' % vi], t['term'])


def dest_url(tk, si, vi, slot):
    """Returns https://www.example.org<dest_path>?<utm_query> (the Pardot redirect target)."""
    return 'https://%s%s?%s' % (SITE_HOST, dest_path(tk, si, slot), utm_query(tk, vi))


def html_cte(tk, si, vi):
    """Returns the html part's Content-Transfer-Encoding: 'quoted-printable' for TICKETS[tk]['qp_proof'], else '8bit'."""
    return 'quoted-printable' if TICKETS[tk]['qp_proof'] == (si, vi) else '8bit'


def qp_encode(html):
    """Returns `html` quoted-printable encoded (UTF-8 bytes, '=3D', soft line breaks '=\\n' every 76 columns) as str."""
    return quopri.encodestring(html.encode('utf-8')).decode('ascii')


def html_text(fragment):
    """Returns the visible text of an inline html fragment: tags removed, entities decoded, cleaned."""
    return clean_text(decode_entities(re.sub(r'<[^>]*>', '', fragment)))


# ── The email: html and text builders ───────────────────────────────────────────────────────────────────

_FILLER_HTML = ('\u2007\u034f ' * 90) + ('\u00ad ' * 120)
_STYLE = """<style>
		* {
			box-sizing: border-box;
		}

		body {
			margin: 0;
			padding: 0;
		}

		a[x-apple-data-detectors] {
			color: inherit !important;
			text-decoration: inherit !important;
		}

		p {
			line-height: inherit
		}

		.desktop_hide,
		.desktop_hide table {
			mso-hide: all;
			display: none;
			max-height: 0px;
			overflow: hidden;
		}

		@media (max-width: 620px) {
			.row-content {
				width: 100% !important;
			}

			.stack .column {
				width: 100% !important;
				display: block;
			}
		}
	</style>"""
_TBL_STYLE = 'style="mso-table-lspace: 0pt; mso-table-rspace: 0pt;"'
_BTN_COLOR = '#1a6fb0'


def _esc_attr(s):
    return s.replace('&', '&amp;').replace('"', '&quot;').replace('<', '&lt;').replace('>', '&gt;')


def _block(cls, n, td_attrs, inner):
    return ('<table border="0" cellpadding="0" cellspacing="0" class="%s block-%d" role="presentation" %s width="100%%">\n'
            '<tbody>\n<tr>\n<td %s>\n%s\n</td>\n</tr>\n</tbody>\n</table>\n') % (cls, n, _TBL_STYLE, td_attrs, inner)


def _col(i, width, inner):
    return ('<td class="column column-%d" %s width="%s">\n<table border="0" cellpadding="0" cellspacing="0" '
            'role="presentation" %s width="100%%">\n<tbody>\n<tr>\n<td class="col-pad" '
            'style="padding-bottom:5px;padding-top:5px;">\n%s</td>\n</tr>\n</tbody>\n</table>\n</td>\n') % (
                i, _TBL_STYLE, width, _TBL_STYLE, inner)


def _row(n, cols, stack=True):
    return ('<table align="center" border="0" cellpadding="0" cellspacing="0" class="row row-%d" role="presentation" %s '
            'width="100%%">\n<tbody>\n<tr>\n<td>\n<table align="center" border="0" cellpadding="0" cellspacing="0" '
            'class="row-content%s" role="presentation" %s width="600">\n<tbody>\n<tr>\n%s</tr>\n</tbody>\n</table>\n'
            '</td>\n</tr>\n</tbody>\n</table>\n') % (n, _TBL_STYLE, ' stack' if stack else '', _TBL_STYLE, cols)


def _image(n, tk, fname, alt, href, width):
    src = 'https://%s/l/%s/%s/imgx01/%s/SYNTH0001/%s' % (PARDOT_HOST, PARDOT_ACCT, TICKETS[tk]['img_date'], PARDOT_ACCT, fname)
    img = ('<img alt="%s" height="auto" src="%s" style="display: block; height: auto; border: 0; width: 100%%;" '
           'title="%s" width="%d">') % (_esc_attr(alt), src, _esc_attr(alt), width)
    inner = '<div style="max-width: %dpx;"><a href="%s" target="_blank">%s</a></div>' % (width, href, img)
    return _block('image_block', n, 'align="center" class="pad" style="width:100%;padding-top:10px;padding-bottom:10px;"', inner)


def _paragraphs(n, items, attrs=None):
    ps = ''.join('<p style="margin: 0;">%s</p>\n' % h if attrs is None else '<p dir="ltr" style="margin: 0;">%s</p>\n' % h for h in items)
    div = '<div style="color:#333;direction:ltr;font-family:Arial, \'Helvetica Neue\', Helvetica, sans-serif;font-size:18px;">\n%s</div>' % ps
    return _block('paragraph_block', n, 'class="pad" style="padding-top:10px;padding-bottom:10px;"', div)


def _heading(n, html):
    h = ('<h3 style="margin: 0; color: #333; direction: ltr; font-family: \'Helvetica Neue\', Helvetica, Arial, sans-serif; '
         'font-size: 25px; font-weight: 700; line-height: 1.2; text-align: left;">%s</h3>') % html
    return _block('heading_block', n, 'align="center" class="pad" style="width:100%;padding-top:10px;padding-bottom:10px;"', h)


def _button(n, href, label, vml_href, big):
    h, w, fs = ('78px', '180px', 19) if big else ('22px', '88px', 19)
    color = '#ffffff' if big else _BTN_COLOR
    fill = ('fillcolor="%s"' % _BTN_COLOR) if big else 'fill="false"'
    bg = _BTN_COLOR if big else 'transparent'
    a = ('<a href="%s" style="color:%s;text-decoration:none;" target="_blank">\n<!--[if mso]>\n'
         '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"  '
         'href="%s"  style="height:%s;width:%s;v-text-anchor:middle;" arcsize="0%%" %s>\n'
         '<v:stroke dashstyle="Solid" weight="0px" color="%s"/>\n<w:anchorlock/>\n'
         '<v:textbox inset="0px,0px,0px,0px">\n<center dir="false" style="color:%s;font-family:Arial, sans-serif;font-size:%dpx">\n'
         '<![endif]--><span class="button" style="background-color: %s; display: inline-block;"><span class="btn-pad" '
         'style="padding-left: 25px; padding-right: 25px;"><span style="line-height: 38px;">%s</span></span></span>\n'
         ' <!--[if mso]></center></v:textbox></v:roundrect><![endif]--></a>') % (
             href, color, vml_href, h, w, fill, _BTN_COLOR, color, fs, bg, label)
    return _block('button_block', n, 'align="%s" class="pad" style="padding-top:10px;padding-bottom:10px;"' % ('center' if big else 'right'), a)


def _social(n, tk, si, vi):
    cells = ''
    for i, slot in enumerate(SOCIAL_ORDER):
        name = SOCIAL_NAMES[slot]
        img = ('<img alt="%s" height="auto" src="https://cdn.example.net/social/circle-color/%s@2x.png" '
               'style="display: block; height: auto; border: 0;" title="%s" width="32">') % (name, name, name)
        cells += '<td style="padding:0 0 0 %dpx;"><a href="%s" target="_blank">%s</a></td>\n' % (0 if i == 0 else 5, tracked_url(tk, si, vi, slot), img)
    inner = ('<table border="0" cellpadding="0" cellspacing="0" class="social-table" role="presentation" %s width="180px">\n'
             '<tbody>\n<tr>\n%s</tr>\n</tbody>\n</table>') % (_TBL_STYLE, cells)
    return _block('social_block', n, 'align="left" class="pad"', inner)


def _anchor(href, text):
    return '<strong><a href="%s" rel="noopener" style="text-decoration: underline; color: #333333;" target="_blank">%s</a></strong>' % (href, text)


def email_main_blocks(tk, si, vi):
    """Returns the main row's blocks (a list of tuples) for the proof: ('img', file, alt, slot, width),
    ('p', html), ('pp', [html, ...]), ('h3', html), ('button', label, slot). EX-1 (story): hero (slot st), the
    greeting, three paragraphs, the stat image (slot st; its alt carries a doc paragraph), the last paragraph and,
    in v0 only, the SEE WHAT'S IN THE VAN button (slot st): v1 has NO CTA text anchor. EX-2 (appeal): hero (slot dn),
    greeting, h3, two paragraphs, callout (slot dn), h3, then the DONATE NOW / HELP NOW button (slot dn)."""
    greeting = SEGMENTS[si]['greeting'] + ','
    if TICKETS[tk]['layout'] == 'story':
        out = [('img', EX1_HERO_FILES['v%d' % vi], EX1_HERO_ALT, 'st', 600), ('p', greeting)]
        out += [('p', h) for h in EX1_PARAGRAPHS_HTML]
        out += [('img', EX1_STAT_FILE, EX1_STAT_ALT, 'st', 600), ('p', EX1_LAST_PARAGRAPH_HTML)]
        if vi == 0:
            out.append(('button', EX1_CTA_HTML, 'st'))
        return out
    return [('img', EX2_HERO_FILE, EX2_HERO_ALT, 'dn', 600), ('p', greeting), ('h3', EX2_H3_1_HTML),
            ('pp', [EX2_P1_HTML, EX2_P2_HTML]), ('img', EX2_CALLOUT_FILE, EX2_CALLOUT_ALT, 'dn', 600),
            ('h3', EX2_H3_2_HTML), ('button', EX2_CTA_LABELS['v%d' % vi], 'dn')]


def _cta_label(tk, vi):
    """The org-row button label: EX-1 always DONATE NOW; EX-2 DONATE NOW (v0) / HELP NOW (v1)."""
    return EX2_CTA_LABELS['v%d' % vi] if TICKETS[tk]['layout'] == 'appeal' else 'DONATE NOW'


def _credit_html(tk):
    return EX1_CREDIT_HTML if TICKETS[tk]['layout'] == 'story' else EX2_CREDIT_HTML


def build_html(tk, si, vi):
    """Returns the proof's html source (str), as sent: DOCTYPE with VML namespaces, head (empty title, meta,
    conditional-comment xml, style), body = hidden preheader div, hidden filler row, header row (logo link +
    DONATE button), main row (email_main_blocks), credit row, SMS banner row, org row (button + paragraph), social +
    charity badge row, footer row (DAF/crypto, address, View email in browser | Unsubscribe, legal), the
    <!-- End --> comment and the 1x1 open pixel (file '1', alt ''). 11 images and 17 anchors (16 in an EX-1 v1
    proof: no CTA text anchor). Every anchor is a Pardot tracked link except the webmail and unsubscribe ones."""
    t = TICKETS[tk]

    def u(slot):
        return tracked_url(tk, si, vi, slot)

    def vml(slot):
        return 'https://%s%s' % (SITE_HOST, dest_path(tk, si, slot))

    parts = []
    parts.append('<!DOCTYPE html>\n<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en-US">\n\n<head>\n'
                 '\t<title></title>\n\t<meta http-equiv="Content-Type" content="text/html; charset=utf-8">\n'
                 '\t<meta name="viewport" content="width=device-width, initial-scale=1.0"><!--[if mso]>\n'
                 '<xml><w:WordDocument xmlns:w="urn:schemas-microsoft-com:office:word"><w:DontUseAdvancedTypographyReadingMail/></w:WordDocument>\n'
                 '<o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch><o:AllowPNG/></o:OfficeDocumentSettings></xml>\n'
                 '<![endif]--><!--[if !mso]><!--><!--<![endif]-->\n\t' + _STYLE + '<!--[if mso ]><style>sup, sub { font-size: 100% !important; } sup { mso-text-raise:10% } sub { mso-text-raise:-10% }</style> <![endif]-->\n'
                 '</head>\n\n<body class="body" style="margin: 0; padding: 0; -webkit-text-size-adjust: none; text-size-adjust: none; background-color: #FFFFFF;">\n')
    parts.append('<div class="preheader" style="display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">%s</div>\n\n' % t['preheader'])
    parts.append('<table border="0" cellpadding="0" cellspacing="0" class="nl-container" role="presentation" %s width="100%%">\n<tbody>\n<tr>\n<td>\n' % _TBL_STYLE)
    # row 1: the hidden filler
    parts.append(_row(1, _col(1, '100%', _block('html_block', 1, 'class="pad"', '<div align="center"><div style="display: none; max-height: 0px; overflow: hidden;">%s</div></div>' % _FILLER_HTML))))
    # row 2: logo + DONATE button
    parts.append(_row(2, _col(1, '41.666666666666664%', _image(1, tk, 'Example_Relief_Logo.png', LOGO_ALT, u('lg'), 150)) +
                      _col(2, '58.333333333333336%', _button(1, u('dn'), 'DONATE', vml('dn'), False)), stack=False))
    # row 3: the main blocks
    main = ''
    for i, b in enumerate(email_main_blocks(tk, si, vi), 1):
        if b[0] == 'img':
            main += _image(i, tk, b[1], b[2], u(b[3]), b[4])
        elif b[0] == 'p':
            main += _paragraphs(i, [b[1]])
        elif b[0] == 'pp':
            main += _paragraphs(i, b[1], attrs='ltr')
        elif b[0] == 'h3':
            main += _heading(i, b[1])
        else:
            main += _button(i, u(b[2]), b[1], vml(b[2]), True)
    parts.append(_row(3, _col(1, '100%', main)))
    # row 4: photo credit; row 5: SMS banner; row 6: org button + paragraph
    parts.append(_row(4, _col(1, '100%', _paragraphs(1, [_credit_html(tk)]))))
    parts.append(_row(5, _col(1, '100%', _image(1, tk, 'image_1200x648_sms_banner.jpg', SMS_ALT, u('sm'), 600))))
    parts.append(_row(6, _col(1, '100%', _button(1, u('dn'), _cta_label(tk, vi), vml('dn'), True) + _paragraphs(2, [ORG_PARAGRAPH]))))
    # row 7: social icons + charity badge
    parts.append(_row(7, _col(1, '50%', _social(1, tk, si, vi)) +
                      _col(2, '50%', _image(1, tk, 'image_822x200_charity_badges.png', BADGE_ALT, u('ch'), 225))))
    # row 8: footer
    foot = ('Planning a larger gift? Ask about a %s transfer, or about %s.<br>\n%s<br>\n%s &nbsp;| &nbsp;%s' % (
        _anchor(u('da'), 'Donor Advised Funds (DAF)'), _anchor(u('cr'), 'cryptocurrency'), ADDRESS_HTML,
        _anchor(webmail_url(), 'View email in browser'), _anchor(unsubscribe_url(), 'Unsubscribe')))
    parts.append(_row(8, _col(1, '100%', _paragraphs(1, [foot]) + _paragraphs(2, [LEGAL_TEXT]))))
    parts.append('</td>\n</tr>\n</tbody>\n</table>\n<!-- End -->\n<img alt="" src="https://%s/r/%s/1/%s/open/1" /></body>\n\n</html>\n' % (
        PARDOT_HOST, PARDOT_ACCT, PROSPECT))
    return ''.join(parts)


def build_text(tk, si, vi):
    """Returns the proof's text part (str), '\\n'-joined lines: [one blank line first when the ticket says so],
    the preheader, a blank line, 15 tabs + 'U+2007 U+034F ' x90 (trailing space stripped), a line of ' U+00AD' x64,
    then in document order each link as its own line (image links: the tracked URL; text links: the label, a
    blank line, the URL), headings with 15 leading tabs, the other paragraphs plain, the footer lines (15 tabs on
    the address and 'View email in browser'), the legal line and 3 trailing blank lines. It mirrors build_html's
    order and its 17 (EX-1 v1: 16) URLs."""
    t = TICKETS[tk]

    def u(slot):
        return tracked_url(tk, si, vi, slot)

    tabs = '\t' * 15
    lines = ([''] if t['text_leading_blank'] else []) + [t['preheader'], '', tabs + ('\u2007\u034f ' * 90).rstrip(), ' \u00ad' * 64, '']
    lines += [u('lg'), '', 'DONATE', '', u('dn'), '']
    for b in email_main_blocks(tk, si, vi):
        if b[0] == 'img':
            lines += [u(b[3]), '']
        elif b[0] == 'p':
            lines += [html_text(b[1]), '']
        elif b[0] == 'pp':
            for h in b[1]:
                lines += [html_text(h), '']
        elif b[0] == 'h3':
            lines += [tabs + html_text(b[1]), '']
        else:
            lines += [html_text(b[1]), '', u(b[2]), '']
    lines += [html_text(_credit_html(tk)), '', u('sm'), '', _cta_label(tk, vi), '', u('dn'), '', ORG_PARAGRAPH, '']
    for slot in SOCIAL_ORDER:
        lines += [u(slot), '']
    lines += [u('ch'), '', 'Planning a larger gift? Ask about a Donor Advised Funds (DAF)', '', u('da'), '',
              ' transfer, or about cryptocurrency', '', u('cr'), '', '.', '', tabs + html_text(ADDRESS_HTML), '',
              tabs + 'View email in browser', '', webmail_url(), '', '  |  Unsubscribe', '', unsubscribe_url(), '', LEGAL_TEXT, '', '', '']
    return '\n'.join(lines)


# ── ADF (Jira) and Docs element helpers ──────────────────────────────────────────────────────────────────

def adf_text(text, mark=None):
    """Returns {'type': 'text', 'text': text} plus 'marks': [{'type': mark}] when mark is 'strong' or 'em'."""
    node = {'type': 'text', 'text': text}
    if mark:
        node['marks'] = [{'type': mark}]
    return node


def adf_link_text(url):
    """Returns a text node whose text is `url` with one link mark: {'type': 'link', 'attrs': {'href': url}}."""
    return {'type': 'text', 'text': url, 'marks': [{'type': 'link', 'attrs': {'href': url}}]}


def adf_inline_card(url):
    """Returns {'type': 'inlineCard', 'attrs': {'url': url}}."""
    return {'type': 'inlineCard', 'attrs': {'url': url}}


def adf_hard_break():
    """Returns {'type': 'hardBreak'}."""
    return {'type': 'hardBreak'}


def adf_para(content):
    """Returns {'type': 'paragraph', 'content': content}."""
    return {'type': 'paragraph', 'content': content}


def adf_inline(x):
    """Converts one inline spec to an ADF node: a str -> text node; ('m',) -> a mention node with empty
    attrs {'id': '', 'text': '', 'accessLevel': ''}; ('hb',) -> hardBreak; ('b', s) -> text with a strong mark;
    ('c', s) -> text with a code mark ({'type': 'code'})."""
    if isinstance(x, str):
        return {'type': 'text', 'text': x}
    if x[0] == 'm':
        return {'type': 'mention', 'attrs': {'id': '', 'text': '', 'accessLevel': ''}}
    if x[0] == 'hb':
        return {'type': 'hardBreak'}
    if x[0] == 'b':
        return {'type': 'text', 'text': x[1], 'marks': [{'type': 'strong'}]}
    return {'type': 'text', 'text': x[1], 'marks': [{'type': 'code'}]}


def doc_run(text, bold=False, link=None, heading_id=None):
    """Returns {'textRun': {'content': text, 'textStyle': style}}; style is built in this order: {'bold': True}
    when bold, then {'link': {'url': link}} when link is not None, else {'link': {'headingId': heading_id}} when
    heading_id is not None; an empty dict when none apply."""
    style = {}
    if bold:
        style['bold'] = True
    if link is not None:
        style['link'] = {'url': link}
    elif heading_id is not None:
        style['link'] = {'headingId': heading_id}
    return {'textRun': {'content': text, 'textStyle': style}}


def doc_paragraph(runs, style='NORMAL_TEXT', list_id=None, heading_id=None):
    """Returns {'paragraph': {'elements': runs, 'paragraphStyle': {'namedStyleType': style[, 'headingId': heading_id]}}}
    and, when list_id is not None, 'bullet': {'listId': list_id, 'nestingLevel': 0} as the last key."""
    ps = {'namedStyleType': style}
    if heading_id is not None:
        ps['headingId'] = heading_id
    out = {'paragraph': {'elements': runs, 'paragraphStyle': ps}}
    if list_id is not None:
        out['paragraph']['bullet'] = {'listId': list_id, 'nestingLevel': 0}
    return out


def doc_blank():
    """Returns the empty-line paragraph: doc_paragraph([doc_run('\\n')])."""
    return doc_paragraph([doc_run('\n')])


def doc_hr():
    """Returns the horizontal-rule paragraph (a horizontalRule element then an empty run)."""
    return {'paragraph': {'elements': [{'horizontalRule': {}}, {'textRun': {'content': '\n', 'textStyle': {}}}],
                          'paragraphStyle': {'namedStyleType': 'NORMAL_TEXT'}}}


def doc_table(rows):
    """`rows` is a list of lists of cells; a cell is a str (one paragraph `cell + '\\n'`) or a list of paragraph
    elements. Returns {'table': {'rows': n, 'columns': m, 'tableRows': [{'tableCells': [{'content': [...]}]}]}}."""
    def cell(c):
        return {'content': [doc_paragraph([doc_run(c + '\n')])] if isinstance(c, str) else c}
    return {'table': {'rows': len(rows), 'columns': len(rows[0]),
                      'tableRows': [{'tableCells': [cell(c) for c in r]} for r in rows]}}


def trim_row(cells):
    """Returns the row list with trailing '' cells removed (a sheet export trims them)."""
    cells = list(cells)
    while cells and cells[-1] == '':
        cells.pop()
    return cells


# ── Jira comment specs (inline DSL in adf_inline; blocks: ('p', [inline...]), ('ul', [[inline...], ...]), ('code', text)) ──
JIRA_COMMENTS = {
    'EX-1': [
        {'id': '410001', 'created': '2027-01-08T12:00:00.000-0400', 'blocks': [
            ('p', [('m',), ' This one is yours for QA. Copy and art are both locked.']),
            ('p', ['Two things worth a close look: the credit line under the van photo and the numbers in the stat image.']),
            ('p', ['Reminder: the UTMs stay identical on both versions.'])]},
        {'id': '410002', 'created': '2027-01-08T13:30:00.000-0400', 'blocks': [
            ('p', [('m',), ' Scope question: should I open the unsubscribe link, or only check that it is there?'])]},
        {'id': '410003', 'created': '2027-01-08T15:00:00.000-0400', 'blocks': [
            ('p', [('m',), ' Only check that it is there. Opening it would unsubscribe the test address.'])]},
        {'id': '410004', 'created': '2027-01-11T09:00:00.000-0400', 'blocks': [
            ('p', [('m',), ' The credit line and the stat image both match the copy doc. Still working through the other proofs.'])]},
        {'id': '410005', 'created': '2027-01-11T11:30:00.000-0400', 'blocks': [
            ('p', [('m',), ' Good to hear. The send stays on the 15th, so there is no rush on my side.'])]},
    ],
    'EX-2': [
        {'id': '420001', 'created': '2027-01-29T13:00:00.000-0400', 'blocks': [
            ('p', [('m',), ' Here is the seed kit appeal, with two versions to review.']),
            ('p', ['The utm_content value ends in -v0 for V0 and -v1 for V1.']),
            ('p', ["Only in V0: 'DONATE NOW'. Only in V1: 'HELP NOW'. Each label appears twice, once under the closing heading and once in the org row."]),
            ('p', ['Donate destinations: regular donors to give-regular and major donors to give-major.'])]},
        {'id': '420002', 'created': '2027-01-29T14:30:00.000-0400', 'blocks': [
            ('p', [('m',), ' Thanks. The Regular Donors proofs come first.'])]},
        {'id': '420003', 'created': '2027-02-01T09:00:00.000-0400', 'blocks': [
            ('p', ['Change of plan for the donate buttons: both groups now land on the seed kit pages.']),
            ('p', ['Regular donors to seed-kits and major donors to seed-kits-major.'])]},
        {'id': '420004', 'created': '2027-02-01T10:30:00.000-0400', 'blocks': [
            ('p', [('m',), ' Seen. I am checking the buttons against the new pages.'])]},
    ],
}

# ── Copy doc EX-1 details table (rows of (label, [paragraph specs])); a paragraph spec is (text, bold, link url|None, list id|None) ──
EX1_DETAIL_ROWS = (
    ('Send Date', [('Jan 15, 2027', False, None, None)]),
    ('Send Time', [('10:00AM', False, None, None)]),
    ('Message Type', [('Engagement', False, None, None)]),
    ('Sender', [('Example Relief', False, None, None)]),
    ('Match', [('None', False, None, None)]),
    ('Goal', [('None', False, None, None)]),
    ('Segmentation', [('Sample segment', False, None, None)]),
    ('General Information', [
        ('Timeline: copy locked 8 Jan, art locked 11 Jan, proofs to QA 12 Jan.', True, None, None),
        ('Must not appear: product brand names, dosage figures, patient faces.', True, None, None),
        ('Mood board:', True, None, None),
        ('https://assets.example.org/library/asset-1', False, 'https://assets.example.org/library/asset-1', 'l2'),
        ('https://assets.example.org/library/asset-2', False, 'https://assets.example.org/library/asset-2', 'l2'),
        ('https://assets.example.org/library/asset-3', False, 'https://assets.example.org/library/asset-3', 'l2'),
        ('https://assets.example.org/library/asset-4', False, 'https://assets.example.org/library/asset-4', 'l2'),
        ('Sign-off: the comms lead approves the final proof before it is scheduled.', False, None, None),
        ('Fallback: if the van photo is not cleared, use the depot exterior.', False, None, None),
        ('Contact: the field team inbox, for quotes and consent forms.', False, None, None)]),
    ('Testing Strategy', [
        ('Test: 40/30/30', True, None, None),
        ('Primary Goal: Find out whether the button adds anything once the hero is linked.', False, None, None),
        ('Theme: Button plus linked hero against linked hero alone.', True, None, None),
        ('Hypothesis: A linked hero image on its own brings in as many clicks as the hero and the button together.', True, None, None),
        ('V0 (Control): Linked hero image, then a button after the story', True, None, None),
        ('V1: Linked hero image only', True, None, None),
        ('Win Metric: Click-through rate', True, None, None)]),
    ('Iris Link', [('EX-1: Cold Route - Message 1', False, 'https://jira.example.org/browse/EX-1', None)]),
    ('Figma Link', [('Example Relief Master', False, 'https://figma.example.org/design/EXFIGMA/Example-Master', None)]),
)

DOC_H3_ID = 'h.exsynth000001'
DOC_H4_ID = 'h.exsynth000002'

# ── Plans ───────────────────────────────────────────────────────────────────────────────────────────────
# One template group = 34 rows: (description text, total minutes, status code) with status code None (a heading
# row), 'X' (E Backlog, F Excluded, G Excluded) or 'V' (E, F, G all Backlog: the visual / dark-mode rows).
# The texts are Cro Metrics' generic EMAIL Test Plan template, typos included on purpose (the row map matches them).
TEMPLATE_GROUP = (
    ('Subject Line - ', '', None),
    ('Is the subject line rendering correctly with proper spelling, grammar, and emojis (if relevant)?', '2', 'X'),
    ('Is personalized content rendering correctly within the subject line?', '', 'X'),
    ('Sender Name', '', None),
    ('Does the sender name match the copy doc?', '2', 'X'),
    ('Is the sender name spelled correctly?', '', 'X'),
    ('Sender Addresses', '', None),
    ('Does the from address match the copy doc?', '2', 'X'),
    ('Does the reply-to email address match the copy doc?', '', 'X'),
    ('Preview Text - ', '', None),
    ('Does the preview text match the copy doc?', '2', 'X'),
    ('Does all spelling, punctuation, and grammar look correct?', '', 'X'),
    ('Is personalized content populating correctly?', '', 'X'),
    ('Body Copy Personalization', '', None),
    ("Is personalized content rendered correctly? (No |FIRSTNAME|'s anywhere)", '2', 'X'),
    ('Does conditional content within the email match the variation?', '', 'X'),
    ('Grammar', '', None),
    ('Are there grammatical, spelling, or punctuation errors throughout the email body?', '2', 'X'),
    ('Are there grammatical, spelling, or punctuation errors throughout the graphics?', '', 'X'),
    ('Image Alt Tags', '', None),
    ('Do all images have proper alt-tags that describe the image and match what is present in the copy doc?', '3', 'X'),
    ('Links', '', None),
    ('Are all links sourced properly and going to the correct place?', '2', 'X'),
    ("Remove if not appliclabe - Are all personalized UTM params matching the variation/treatment you're in?\n"
     'PGM will specify in the comments of that ticket if the UTMs differ between variations', '', 'X'),
    ('Visuals', '', None),
    ('Verify the overall visuals of the email, anything standing out as "off"?', '2', 'V'),
    ('Any allignment, spacing, overlapping issues?', '', 'V'),
    ('Dark Mode', '', None),
    ('Does the email hold up in dark mode?', '2', 'V'),
    ('Are any areas of copy/visuals hard to read/view when looking at dark mode?', '', 'V'),
    ('Signer', '', None),
    ('Does the email signature at the bottom of the body match what is present in the copy doc?', '2', 'X'),
    ('Authentification', '', None),
    ('Are all DKIM authentifications passing for this variation?', '2', 'X'),
)
TEMPLATE_GROUP_START_ROWS = (8, 42, 76, 110)
TEMPLATE_ROW_COUNT = 143
TEMPLATE_A1 = '[Insert Jira Ticket URL Here]'
TEMPLATE_NOTE_ROW5 = '❗ If you find that important test cases are missing, add as necessary to this test plan with a time estimate. ❗'
TEMPLATE_VARIATION_SUFFIX = '\nPersonalization\nVariation\nRemove if not-applicable'
TEMPLATE_ALT_TEXT_VARIANT = ('Do all images have proper alt-tags that describe the image? \n'
                             'The descriptions are not in the copy doc, but it should be relevant to the image and without typos.')
TEMPLATE_GRAMMAR_VARIANT = 'Grammar - Follow client-specific grammar guidelines wherever possible - EXAMPLE'
TEMPLATE_PREVIEW_VARIANT = ('Preview Text - \nNote that Litmus automation may pull the first few words of the email body into '
                            'the end of the preview text.  This is fine as-is')
TEMPLATE_PLAN_ID = 'EXPLAN_TEMPLATE_0000000000000001'
TEMPLATE_PLAN_TITLE = '[TEST #] EMAIL Test Plan [0.88 hrs]'
EX1_PLAN_TITLE = '[EX-1] EMAIL Test Plan [1.45 hrs]'
PLAN_TABS = ({'title': 'QA Round 1', 'sheetId': 100, 'index': 0, 'hidden': None},
             {'title': 'Legend/Values [DO NOT REMOVE]', 'sheetId': 101, 'index': 1, 'hidden': None})
PLAN_LEGEND = (('Statuses', 'Backlog', 'Needs to be tested', 'Backlog', 'Excluded'),
               ('', 'In Progress', 'Actively being tested'), ('', 'Failed', 'Failed QA pass'),
               ('', 'Passed', 'Passed QA pass'), ('', 'Excluded', 'Excluded from testing'),
               ('', 'Blocked', 'QA blocked from testing'))
PLAN_CAPTURED_AT = '2027-01-01T00:00:00.000Z'
PLAN_SOURCE = 'synthetic: generated by extension/tests/gen-email-fixtures.py'
# EX-1 plan: every E cell that the template holds as Backlog becomes Passed (so do F and G on the visual rows),
# then these overrides; notes go to column H.
EX1_PLAN_OVERRIDES = {(28, 'E'): 'In Progress', (96, 'E'): 'Failed', (130, 'E'): 'Failed', (99, 'E'): 'Excluded'}
EX1_PLAN_NOTES = {
    30: 'V0 / Regular Donors | Desktop | Every link was opened in a fresh tab from the proof. None redirected more than once and none landed on an error page.',
    31: 'V0 / Regular Donors | Desktop | Put the campaign links of both versions side by side: the query strings are the same, character for character.',
    41: 'V0 / Regular Donors | Desktop | The authentication headers show a valid signature from the sender\'s own domain.',
    75: 'V0 / Major Donors | Desktop | Same signature result as the Regular Donors proof.',
    96: 'V1 / Regular Donors | Desktop | Fails: the hero alt was copied from V0 and was not updated for this version.',
    130: 'V1 / Major Donors | Desktop | Fails: same as the Regular Donors proof, the hero alt was not updated.',
}

# ══ 3. The synthetic gate (safety-critical: do not touch) ═══════════════════════════════════
# Rule ids S1-S6 plus the cross-fixture invariants INV1-INV8. A hit prints the rule id, file, JSON path and the
# offending token; exit 2 and nothing is compared or written.

_TLDS = 'com|org|net|io|edu|gov|co|us|uk|info|biz|app|dev|ai|me|tv|fr|de|ca'
_RE_URL_HOST = re.compile(r'https?://([A-Za-z0-9.-]+)', re.I)
_RE_BARE_HOST = re.compile(r'(?<![\w@.-])((?:[A-Za-z0-9-]+\.)+(?:%s))(?![\w-])' % _TLDS, re.I)
_RE_ADDRESS = re.compile(r'[A-Za-z0-9._%%+\-]+@((?:[A-Za-z0-9-]+\.)+(?:%s))(?![\w-])' % _TLDS, re.I)
_RE_TICKET_KEY = re.compile(r'\b([A-Z]{2,10})-(\d+)\b')
_ALLOWED_EXACT = frozenset(['mailtrap.io', 'inbox.mailtrap.io', 'app.emailonacid.com', 'images.emailonacid.com',
                            'docs.google.com', 'docs.googleapis.com'])
_ALLOWED_ADDRESS_DOMAINS = frozenset(['example.org', 'inbox.mailtrap.io', 'bounce.example.net'])
_KEY_WHITELIST = frozenset(['UTF-8'])
# Email on Acid's own client display names read like hosts ('Gmail.com Chrome'): fine as bare text, never as a URL host.
_BARE_PRODUCT_NAMES = frozenset(['gmail.com', 'microsoft365.com', 'outlook.com'])
_RE_ID_DOC = re.compile(r'/document/d/([A-Za-z0-9_-]+)')
_RE_ID_SHEET = re.compile(r'/spreadsheets/d/([A-Za-z0-9_-]+)')
_RE_ID_EOA = re.compile(r'/acidtest/([A-Za-z0-9]+)')
_RE_ID_MAILTRAP = re.compile(r'/sandboxes/(\d+)/messages/(\d+)')
_RE_ID_PARDOT = re.compile(r'/e/(\d+)/[^/\s"\'<>]+/[A-Za-z0-9]+/([A-Za-z0-9]+)/h/([A-Za-z0-9]+)')
_RE_ID_PARTS = re.compile(r'/api/testing_message_parts/([^/\s"\'<>]+)')


def _host_ok(host):
    h = host.lower().rstrip('.')
    return (h in ('example.org', 'example.net') or h.endswith('.example.org') or h.endswith('.example.net')
            or h in _ALLOWED_EXACT)


def _s1_hosts(s):
    s = s.replace('=\n', '')          # a quoted-printable soft break must not split a host
    out = []
    for m in _RE_URL_HOST.finditer(s):
        if not _host_ok(m.group(1)):
            out.append((m.start(), 'host not allowed: ' + m.group(1)[:60]))
    for m in _RE_BARE_HOST.finditer(s):
        if not _host_ok(m.group(1)) and m.group(1).lower() not in _BARE_PRODUCT_NAMES:
            out.append((m.start(), 'host not allowed: ' + m.group(1)[:60]))
    return out


def _s2_addresses(s):
    s = s.replace('=\n', '')
    return [(m.start(), 'address domain not allowed: ' + m.group(1)[:60]) for m in _RE_ADDRESS.finditer(s)
            if m.group(1).lower() not in _ALLOWED_ADDRESS_DOMAINS]


def _s3_keys(s):
    s = s.replace('=\n', '')
    return [(m.start(), 'ticket key not EX-n: ' + m.group(0)) for m in _RE_TICKET_KEY.finditer(s)
            if m.group(0) not in _KEY_WHITELIST and m.group(1) != 'EX']


def _s4_ids(s):
    s = s.replace('=\n', '')
    out = []
    for m in _RE_ID_DOC.finditer(s):
        if not m.group(1).startswith('EXDOC'):
            out.append((m.start(), 'doc id outside the synthetic space (EXDOC...)'))
    for m in _RE_ID_SHEET.finditer(s):
        if not m.group(1).startswith('EXPLAN'):
            out.append((m.start(), 'sheet id outside the synthetic space (EXPLAN...)'))
    for m in _RE_ID_EOA.finditer(s):
        if not m.group(1).startswith('EXEOA'):
            out.append((m.start(), 'EoA guid outside the synthetic space (EXEOA...)'))
    for m in _RE_ID_MAILTRAP.finditer(s):
        if m.group(1) != SANDBOX or not m.group(2).startswith('71'):
            out.append((m.start(), 'sandbox/message id outside the synthetic space'))
    return out


def _s5_pardot(s):
    s = s.replace('=\n', '')          # a soft break inside the prospect or hash must not fake a violation (or hide a real one)
    out = []
    for m in _RE_ID_PARDOT.finditer(s):
        if (m.group(1), m.group(2), m.group(3)) != (PARDOT_ACCT, PROSPECT, HASH):
            out.append((m.start(), 'Pardot tracked link outside the synthetic account/prospect/hash'))
    return out


def _s6_parts(s):
    s = s.replace('=\n', '')
    return [(m.start(), 'message-part token is not SYNTHETICTOKEN') for m in _RE_ID_PARTS.finditer(s)
            if m.group(1) != SYNTHETIC_TOKEN]


SYNTHETIC_RULES = [('S1', _s1_hosts), ('S2', _s2_addresses), ('S3', _s3_keys), ('S4', _s4_ids), ('S5', _s5_pardot), ('S6', _s6_parts)]


def _walk(obj, path='$'):
    """Yields (json path, string) for every dict key and every string value in the tree."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            sub = '%s.%s' % (path, k if len(k) <= 40 else k[:40] + '...')
            yield sub, k
            for item in _walk(v, sub):
                yield item
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            for item in _walk(v, '%s[%d]' % (path, i)):
                yield item
    elif isinstance(obj, str):
        yield path, obj


def _ticket_proofs(outputs, tk):
    return outputs['fixtures-email-proofs.json']['tickets'][tk]['proofs']


def _decoded_html(p, tk, si, vi):
    """The html a proof really carries: its htmlsource, quoted-printable decoded when its html part says so."""
    if html_cte(tk, si, vi) == 'quoted-printable':
        return quopri.decodestring(p['htmlsource'].encode('ascii')).decode('utf-8')
    return p['htmlsource']


def check_invariants(outputs):
    """Cross-fixture consistency (INV0-INV8). Returns a list of problem strings (empty = consistent). It is what
    keeps a generator that assembles the wrong thing from reaching a committed file: proofs vs the Jira
    links, the EoA guids, the interstitial linkIds, the copy docs vs the emails, the plans vs the segments."""
    probs = []
    try:
        jira = outputs['fixtures-email-jira.json']
        inter = outputs['fixtures-email-interstitials.json']
        eoa = outputs['fixtures-email-eoa.json']
        plans = outputs['fixtures-email-plans.json']
        doc1 = outputs['fixtures-email-doc-ex1.json']
        doc2 = outputs['fixtures-email-doc-ex2.json']
        for tk in TICKET_KEYS:
            t = TICKETS[tk]
            proofs = _ticket_proofs(outputs, tk)
            desc = json.dumps(jira[tk]['fields']['description'])
            if [(p['segment'], p['variation']) for p in proofs] != [(SEGMENTS[si]['slug'], VARIATIONS[vi]) for si, vi in PROOF_INDEX]:
                probs.append('INV1 %s: proofs are not the four (segment, variation) pairs of PROOF_INDEX, in order' % tk)
                continue
            carried = []
            for p, (si, vi) in zip(proofs, PROOF_INDEX):
                who = '%s %s %s' % (tk, p['segment'], p['variation'])
                html = _decoded_html(p, tk, si, vi)
                carried.append(html)
                if p['messageId'] != message_id(tk, si, vi) or mailtrap_url(tk, si, vi) not in desc:
                    probs.append('INV1 %s: message id %s is not the one the Jira description links to' % (who, p['messageId']))
                if html != build_html(tk, si, vi):
                    probs.append('INV5 %s: htmlsource is not build_html (quoted-printable decoded)' % who)
                if html.count('<img ') != 11:
                    probs.append('INV5 %s: %d <img> tags, expected 11' % (who, html.count('<img ')))
                want = 16 if (tk == 'EX-1' and vi == 1) else 17
                if html.count('<a href=') != want:
                    probs.append('INV5 %s: %d anchors, expected %d' % (who, html.count('<a href='), want))
                if p['message']['to_email'] != to_address(si) or ('Content-Transfer-Encoding: %s\n' % html_cte(tk, si, vi)) not in p['raw']:
                    probs.append('INV5 %s: recipient or html transfer encoding is wrong' % who)
                if p['text'] != build_text(tk, si, vi):
                    probs.append('INV5 %s: text part is not build_text' % who)
                if (html_cte(tk, si, vi) == 'quoted-printable') != ('=3D' in p['htmlsource']):
                    probs.append('INV5 %s: quoted-printable marker (=3D) and the html part header disagree' % who)
            for vi in (0, 1):
                if eoa_guid(tk, vi) not in eoa[tk]['v%d' % vi] or eoa_url(tk, vi) not in desc:
                    probs.append('INV2 %s v%d: EoA guid in the page and in the Jira description disagree' % (tk, vi))
            for key in inter[tk]:
                lid = key.split('-')[-1]
                if not any(('/%s/%s/' % (lid, PROSPECT)) in h for h in carried):
                    probs.append('INV3 %s: interstitial %s names a linkId no proof carries' % (tk, key))
        # INV4/INV6: the EX-2 doc body is the EX-2 regular-v0 proof's own paragraphs; preview and subject agree
        paras, pre = scan_visible_paragraphs(_decoded_html(_ticket_proofs(outputs, 'EX-2')[0], 'EX-2', 0, 0))
        texts = []
        for el in doc2['body']['content']:
            if 'paragraph' in el and 'textRun' in el['paragraph']['elements'][0]:
                runs = ''.join(r['textRun']['content'] for r in el['paragraph']['elements'] if 'textRun' in r)
                if 'bullet' not in el['paragraph'] and not runs.startswith(('Subject Line', 'Preview Text', 'Landing Pages')):
                    texts.append(runs.strip())
        for x in texts:
            if x and not x.startswith('[V') and x != '{{Recipient.FirstName}},' and x not in paras:
                probs.append('INV4 EX-2 doc paragraph is not in the EX-2 proof: ' + x[:50])
        if pre != TICKETS['EX-2']['preheader'] or EX2_PREVIEW_OPTION != TICKETS['EX-2']['preheader']:
            probs.append('INV6 EX-2 preheader and the doc preview option disagree')
        if EX1_PREVIEW_OPTIONS[3][0] != TICKETS['EX-1']['preheader'] or max(len(TICKETS[k]['preheader']) for k in TICKET_KEYS) > 50:
            probs.append('INV6 EX-1 preview option 4 differs from its preheader, or a preheader is over 50 characters')
        if 'Proof - (Version A) ' + EX1_SUBJECT_OPTIONS[0][0] != TICKETS['EX-1']['subject']['v0'] \
                or 'Proof - ' + EX2_SUBJECT_OPTIONS[0][0] != TICKETS['EX-2']['subject']['v0']:
            probs.append('INV6 a bold subject option is not the proof subject without its prefix')
        if doc1['documentId'] != TICKETS['EX-1']['doc_id'] or doc2['documentId'] != TICKETS['EX-2']['doc_id']:
            probs.append('INV7 a copy doc id differs from TICKETS')
        vals = plans['EX-1']['values']
        for row, col, label in ((8, 0, 'Reqs - Regular Donors\nv0'), (76, 0, 'Reqs - Regular Donors\nv1'),
                                (42, 1, 'Reqs - Major Donors\nv0'), (110, 1, 'Reqs - Major Donors\nv1')):
            if len(vals) < row or len(vals[row - 1]) <= col or vals[row - 1][col] != label:
                probs.append('INV8 plan EX-1 row %d label is not %r' % (row, label))
        if len(plans['template']['values']) != TEMPLATE_ROW_COUNT or len(vals) != TEMPLATE_ROW_COUNT \
                or plans['template']['values'][0][0] != TEMPLATE_A1:
            probs.append('INV8 plan template shape (143 rows, A1 placeholder) is wrong')
    except (KeyError, IndexError, TypeError, ValueError, UnicodeError) as e:
        probs.append('INV0 a fixture does not have the expected shape: %s: %s' % (type(e).__name__, e))
    return probs


def synthetic_gate(outputs):
    """Checks every generated fixture against SYNTHETIC_RULES S1-S6 and, when all seven are present, the
    invariants INV1-INV8. `outputs` maps fixture file name -> object. Returns a list of violation strings (empty =
    clean), each 'RULE file path offset N: why'."""
    probs = []
    for name in sorted(outputs):
        for path, s in _walk(outputs[name]):
            for rule_id, fn in SYNTHETIC_RULES:
                for offset, why in fn(s):
                    probs.append('%s %s %s offset %d: %s' % (rule_id, name, path, offset, why))
    if all(n in outputs for n in OUTPUTS_SPEC):
        probs += check_invariants(outputs)
    return probs


def selftest_synthetic_gate():
    """Proves the rules: for each of S1-S6 one BAD sample the gate must flag and one GOOD sample it must not.
    Prints one line per case. Returns 0 when every case behaves, 1 otherwise."""
    cases = [
        ('S1', {'a': 'see https://www.real-charity.org/donate'}, {'a': 'see https://www.example.org/give/ and https://mailtrap.io/signin'}),
        ('S1', {'a': 'visit real-charity.org today'}, {'a': 'visit www.example.org today; image facebook@2x.png; e.g. this'}),
        ('S1', {'a': 'x https://example.org.evil.com/'}, {'a': 'x https://docs.googleapis.com/v1/documents/EXDOC_EX1'}),
        ('S1', {'a': 'x https://www.gmail.com/mail'}, {'a': 'EoA client Gmail.com Chrome on Outlook.com'}),
        ('S1', {'a': 'x https://ma=\nrketing.real-charity.org/e/1'}, {'a': 'x https://ma=\nrketing.example.org/e/1'}),
        ('S2', {'a': 'write to someone@real-charity.org'}, {'a': 'write to info@example.org and tester+regular@inbox.mailtrap.io'}),
        ('S2', {'a': 'bounce-X@bounce.real.net'}, {'a': 'bounce-SYNTH@bounce.example.net'}),
        ('S3', {'a': 'ticket ABC-123 is open'}, {'a': 'tickets EX-1 and EX-2 use UTF-8'}),
        ('S4', {'a': 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit'}, {'a': 'https://docs.google.com/document/d/EXDOC_EX1_COPY_DOC_000000000001/edit'}),
        ('S4', {'a': 'https://mailtrap.io/sandboxes/123456/messages/987654321'}, {'a': 'https://mailtrap.io/sandboxes/7000001/messages/7100000001'}),
        ('S4', {'a': 'https://app.emailonacid.com/app/acidtest/RealGuid123456789/list'}, {'a': 'https://app.emailonacid.com/app/acidtest/EXEOA1V0000/list'}),
        ('S4', {'a': 'https://docs.google.com/spreadsheets/d/1RealSheetIdRealSheetIdReal/edit'}, {'a': 'https://docs.google.com/spreadsheets/d/EXPLAN_EX1_TEST_PLAN_00000000001/edit'}),
        ('S5', {'a': 'https://marketing.example.org/e/404040/slug/abc123/1000000001/h/SCRUBBEDHASH'},
         {'a': 'https://marketing.example.org/e/900001/slug/x1v0lg/2000000002/h/SynthHash0'}),
        ('S6', {'a': '/api/testing_message_parts/QEVuQwFAEAC6pb/body.html'}, {'a': '/api/testing_message_parts/SYNTHETICTOKEN/body.html'}),
    ]
    bad = 0
    for rule_id, evil, fine in cases:
        flagged = [p for p in synthetic_gate({'selftest.json': evil}) if p.startswith(rule_id + ' ')]
        clean = synthetic_gate({'selftest.json': fine})
        ok = bool(flagged) and not clean
        print('  %-3s %s' % (rule_id, 'ok' if ok else 'FAILED (flagged bad: %s, flagged good: %s)' % (bool(flagged), clean)))
        bad += 0 if ok else 1
    print('synthetic gate selftest: %s' % ('all %d cases behave' % len(cases) if not bad else '%d case(s) FAILED' % bad))
    return 0 if not bad else 1


# ══ 4. The generators (each docstring is the whole contract) ═══════════
# Helpers and constants named in a docstring are defined above. "Keys in this order" means dict insertion
# order: the files are serialized without sorting.

INTERSTITIAL_TEMPLATE = (
    '\n<!DOCTYPE html>\n<html>\n\t<head>\n\t\t<base href="https://marketing.example.org" >\n\t\t<meta charset="utf-8"/>\n'
    '\t\t<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>\n'
    '\t\t<meta name="description" content="%%%%description%%%%"/>\n\t\t<title>Tracked Link Successful</title>\n'
    '\t<link rel="stylesheet" type="text/css" href="https://marketing.example.org/css/form.css?ver=2021-09-20" />\n</head>\n'
    '\t<body>\n\t\t<p>You have clicked a tracked link from a test email.</p><p>If this were a real email, '
    '<strong>%(addr)s</strong> would be cookied and redirected to <a href=\'%(href)s\'>%(href)s</a></p>'
    '<p>You will be redirected to that link (uncookied) in 5 seconds.</p><script>window.setTimeout(function() '
    '{window.location.href = \'%(js)s\';}, 5000);</script>\n\t</body>\n</html>\n')


# ── fixtures-email-proofs.json ──────────────────────────────────────────────────────────────────

def build_message_json(tk, si, vi, html, text):
    r"""Returns the Mailtrap message JSON for the proof as a dict, keys in this order:
    'id' int(message_id(tk, si, vi)); 'subject' TICKETS[tk]['subject']['v<vi>']; 'sent_at' t['sent']; 'from_email'
    MAIL_FROM; 'from_name' ORG_NAME; 'to_email' to_address(si); 'to_name' ''; 'email_size' = len(html.encode('utf-8'))
    + len(text.encode('utf-8')) + 1500; 'is_read' True; 'created_at' t['created']; 'updated_at' t['updated'];
    'template_id' None; 'template_variables' None; 'inbox_id' int(SANDBOX); 'html_body_size'
    len(html.encode('utf-8')); 'text_body_size' len(text.encode('utf-8')); 'human_size' '%d KB' % max(1,
    email_size // 1024); 'html_path' MSG_PARTS + '/body.html'; 'txt_path' MSG_PARTS + '/body.txt'; 'raw_path'
    MSG_PARTS + '/body.raw'; 'download_path' MSG_PARTS + '/body.eml'; 'html_source_path' MSG_PARTS +
    '/body.htmlsource'; 'blacklists_report_info' {'result': 'success', 'domain': ORG_DOMAIN, 'ip': CLIENT_IP,
    'report': [{'name': 'EXAMPLE_RBL_<i>', 'url': 'https://rbl<i>.example.net/', 'in_black_list': False} for i in
    1..10]}; 'smtp_information' {'ok': True, 'data': {'mail_from_addr': BOUNCE, 'rcpt_to_addrs': [to_address(si)],
    'client_ip': CLIENT_IP}}. `html` is the htmlsource string stored in the proof (possibly quoted-printable)."""
    t = TICKETS[tk]
    email_size = len(html.encode('utf-8')) + len(text.encode('utf-8')) + 1500
    return {
        'id': int(message_id(tk, si, vi)),
        'subject': t['subject']['v%d' % vi],
        'sent_at': t['sent'],
        'from_email': MAIL_FROM,
        'from_name': ORG_NAME,
        'to_email': to_address(si),
        'to_name': '',
        'email_size': email_size,
        'is_read': True,
        'created_at': t['created'],
        'updated_at': t['updated'],
        'template_id': None,
        'template_variables': None,
        'inbox_id': int(SANDBOX),
        'html_body_size': len(html.encode('utf-8')),
        'text_body_size': len(text.encode('utf-8')),
        'human_size': '%d KB' % max(1, email_size // 1024),
        'html_path': MSG_PARTS + '/body.html',
        'txt_path': MSG_PARTS + '/body.txt',
        'raw_path': MSG_PARTS + '/body.raw',
        'download_path': MSG_PARTS + '/body.eml',
        'html_source_path': MSG_PARTS + '/body.htmlsource',
        'blacklists_report_info': {
            'result': 'success',
            'domain': ORG_DOMAIN,
            'ip': CLIENT_IP,
            'report': [{'name': 'EXAMPLE_RBL_%d' % i, 'url': 'https://rbl%d.example.net/' % i, 'in_black_list': False}
                       for i in range(1, 11)],
        },
        'smtp_information': {
            'ok': True,
            'data': {'mail_from_addr': BOUNCE, 'rcpt_to_addrs': [to_address(si)], 'client_ip': CLIENT_IP},
        },
    }


def build_raw_header_block(tk, si, vi):
    r"""Returns the raw header block (str, no trailing newline) of the proof: these 18 logical headers
    joined with '\r\n' (so the header lines end CRLF), where a fold INSIDE one header is a bare '\n':
      1 'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; s=200608; d=example.org;\n h=From:To:Subject:Date:List-Help:MIME-Version:List-Unsubscribe:\n List-Unsubscribe-Post:Message-ID:Content-Type; i=info@example.org;\n bh=c3ludGhldGljYm9keWhhc2g=;\n b=c3ludGhldGljc2lnbmF0dXJl'
      2 'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; s=s1; d=s1.mta.example.net;\n h=From:To:Subject:Date:List-Help:MIME-Version:List-Unsubscribe:\n List-Unsubscribe-Post:Message-ID:Content-Type;\n bh=c3ludGhldGljYm9keWhhc2gy;\n b=c3ludGhldGljc2lnbmF0dXJlMg=='
      3 'Received: by mta1.example.net id synth<NNNN> for <TO>; <received_date> (envelope-from <BOUNCE>)'  (NNNN = message_number zero-padded to 4 digits, TO = to_address(si), received_date = t['received_date'])
      4 'From: "Example Relief" <info@example.org>'       5 'To: <TO>'       6 'Subject: ' + t['subject']['v<vi>']       7 'Date: ' + t['date_header']
      8 'List-Help: <https://marketing.example.org/help/SYNTHETICTOKEN>'      9 'MIME-Version: 1.0'      10 'x-messageKey: SYNTH-MESSAGE-KEY'
      11 'X-Delivery: SYNTH-DELIVERY'      12 'X-SFMC-Stack: SYNTH-STACK'      13 'x-job: SYNTH-JOB'
      14 'List-Unsubscribe: <https://marketing.example.org/unsub/SYNTHETICTOKEN>'      15 'List-Unsubscribe-Post: List-Unsubscribe=One-Click'
      16 'X-Report-Abuse-To: abuse@example.org'      17 'Message-ID: <synth.<message_id>@example.org>'
      18 'Content-Type: multipart/alternative;\n\tboundary="' + boundary(tk, si, vi) + '"'
    (BOUNCE is 'bounce-SYNTH@bounce.example.net'; the three 'List-' and 'Message-ID' lines carry the plain synthetic values above.)"""
    t = TICKETS[tk]
    to = to_address(si)
    num = '%04d' % message_number(tk, si, vi)
    lines = [
        'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; s=200608; d=example.org;\n'
        ' h=From:To:Subject:Date:List-Help:MIME-Version:List-Unsubscribe:\n'
        ' List-Unsubscribe-Post:Message-ID:Content-Type; i=info@example.org;\n'
        ' bh=c3ludGhldGljYm9keWhhc2g=;\n'
        ' b=c3ludGhldGljc2lnbmF0dXJl',
        'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; s=s1; d=s1.mta.example.net;\n'
        ' h=From:To:Subject:Date:List-Help:MIME-Version:List-Unsubscribe:\n'
        ' List-Unsubscribe-Post:Message-ID:Content-Type;\n'
        ' bh=c3ludGhldGljYm9keWhhc2gy;\n'
        ' b=c3ludGhldGljc2lnbmF0dXJlMg==',
        'Received: by mta1.example.net id synth%s for <%s>; %s (envelope-from <%s>)' % (num, to, t['received_date'], BOUNCE),
        'From: "%s" <%s>' % (ORG_NAME, MAIL_FROM),
        'To: <%s>' % to,
        'Subject: ' + t['subject']['v%d' % vi],
        'Date: ' + t['date_header'],
        'List-Help: <https://%s/help/%s>' % (PARDOT_HOST, SYNTHETIC_TOKEN),
        'MIME-Version: 1.0',
        'x-messageKey: SYNTH-MESSAGE-KEY',
        'X-Delivery: SYNTH-DELIVERY',
        'X-SFMC-Stack: SYNTH-STACK',
        'x-job: SYNTH-JOB',
        'List-Unsubscribe: <https://%s/unsub/%s>' % (PARDOT_HOST, SYNTHETIC_TOKEN),
        'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
        'X-Report-Abuse-To: abuse@%s' % ORG_DOMAIN,
        'Message-ID: <synth.%s@%s>' % (message_id(tk, si, vi), ORG_DOMAIN),
        'Content-Type: multipart/alternative;\n\tboundary="%s"' % boundary(tk, si, vi),
    ]
    return '\r\n'.join(lines)


def build_part_headers(bnd, html_cte):
    r"""Returns a list of the two MIME part header strings, LF line ends, each ending with '\n':
    ['--<bnd>\nContent-Type: text/plain;\n\tcharset="utf-8"\nContent-Transfer-Encoding: 8bit\n',
     '--<bnd>\nContent-Type: text/html;\n\tcharset="utf-8"\nContent-Transfer-Encoding: <html_cte>\n']."""
    return ['--%s\nContent-Type: text/plain;\n\tcharset="utf-8"\nContent-Transfer-Encoding: 8bit\n' % bnd,
            '--%s\nContent-Type: text/html;\n\tcharset="utf-8"\nContent-Transfer-Encoding: %s\n' % (bnd, html_cte)]


def build_raw(tk, si, vi):
    r"""Returns the proof's `raw` string: build_raw_header_block(tk, si, vi) + '\n\n' + ''.join(h +
    '\n[body not kept]\n' for h in build_part_headers(boundary(tk, si, vi), html_cte(tk, si, vi))) + '--' +
    boundary(tk, si, vi) + '--\n'."""
    bnd = boundary(tk, si, vi)
    parts = build_part_headers(bnd, html_cte(tk, si, vi))
    return (build_raw_header_block(tk, si, vi) + '\n\n'
            + ''.join(h + '\n[body not kept]\n' for h in parts)
            + '--' + bnd + '--\n')


def build_mail_headers(tk, si, vi):
    r"""Returns {'headers': {...}} (what Mailtrap's /mail_headers returns: ONE value per header name, so only
    the SECOND DKIM-Signature) with keys in this order: 'received' 'by mta1.example.net id synth<NNNN> for <TO>;
    <received_date>' (no envelope part); 'date' t['date_header']; 'from' 'Example Relief <info@example.org>'; 'to' TO
    (no angle brackets); 'message_id' '<synth.<message_id>@example.org>'; 'subject'; 'mime_version' '1.0';
    'content_type' 'multipart/alternative; boundary="<boundary>"'; 'dkim_signature' 'v=1; a=rsa-sha256;
    c=relaxed/relaxed; s=s1; d=s1.mta.example.net; h=From:To:Subject:Date:List-Help:MIME-Version:List-Unsubscribe:
    List-Unsubscribe-Post:Message-ID:Content-Type; bh=c3ludGhldGljYm9keWhhc2gy; b=c3ludGhldGljc2lnbmF0dXJlMg==' (one
    line); 'list_help' '<https://marketing.example.org/help/SYNTHETICTOKEN>'; 'x_messagekey' 'SYNTH-MESSAGE-KEY';
    'x_delivery' 'SYNTH-DELIVERY'; 'x_sfmc_stack' 'SYNTH-STACK'; 'x_job' 'SYNTH-JOB'; 'list_unsubscribe'
    '<https://marketing.example.org/unsub/SYNTHETICTOKEN>'; 'list_unsubscribe_post' 'List-Unsubscribe=One-Click';
    'x_report_abuse_to' 'abuse@example.org'; 'bcc' 'not found'. TO = to_address(si), NNNN as in G2."""
    t = TICKETS[tk]
    to = to_address(si)
    return {'headers': {
        'received': 'by mta1.example.net id synth%04d for <%s>; %s' % (message_number(tk, si, vi), to, t['received_date']),
        'date': t['date_header'],
        'from': '%s <%s>' % (ORG_NAME, MAIL_FROM),
        'to': to,
        'message_id': '<synth.%s@%s>' % (message_id(tk, si, vi), ORG_DOMAIN),
        'subject': t['subject']['v%d' % vi],
        'mime_version': '1.0',
        'content_type': 'multipart/alternative; boundary="%s"' % boundary(tk, si, vi),
        'dkim_signature': ('v=1; a=rsa-sha256; c=relaxed/relaxed; s=s1; d=s1.mta.example.net; '
                           'h=From:To:Subject:Date:List-Help:MIME-Version:List-Unsubscribe: '
                           'List-Unsubscribe-Post:Message-ID:Content-Type; '
                           'bh=c3ludGhldGljYm9keWhhc2gy; b=c3ludGhldGljc2lnbmF0dXJlMg=='),
        'list_help': '<https://%s/help/%s>' % (PARDOT_HOST, SYNTHETIC_TOKEN),
        'x_messagekey': 'SYNTH-MESSAGE-KEY',
        'x_delivery': 'SYNTH-DELIVERY',
        'x_sfmc_stack': 'SYNTH-STACK',
        'x_job': 'SYNTH-JOB',
        'list_unsubscribe': '<https://%s/unsub/%s>' % (PARDOT_HOST, SYNTHETIC_TOKEN),
        'list_unsubscribe_post': 'List-Unsubscribe=One-Click',
        'x_report_abuse_to': 'abuse@%s' % ORG_DOMAIN,
        'bcc': 'not found',
    }}


def build_spam_report():
    r"""Returns {'report': {'ResponseCode': 0, 'ResponseMessage': 'EX_OK', 'ResponseVersion': '1.1', 'Score':
    0.6, 'Spam': False, 'Threshold': 5, 'Details': [{'Pts': pts, 'RuleName': name, 'Description': desc} for (pts,
    name, desc) in SPAM_DETAILS]}} (keys in this order)."""
    return {'report': {
        'ResponseCode': 0,
        'ResponseMessage': 'EX_OK',
        'ResponseVersion': '1.1',
        'Score': 0.6,
        'Spam': False,
        'Threshold': 5,
        'Details': [{'Pts': pts, 'RuleName': name, 'Description': desc} for (pts, name, desc) in SPAM_DETAILS],
    }}


def build_proof(tk, si, vi):
    r"""Returns one proof dict, keys in this order: 'segment' SEGMENTS[si]['slug']; 'variation' 'v<vi>';
    'messageId' message_id(tk, si, vi); 'message' build_message_json(tk, si, vi, htmlsource, text); 'htmlsource'
    (= build_html(tk, si, vi), passed through qp_encode when html_cte(tk, si, vi) is 'quoted-printable'); 'text'
    build_text(tk, si, vi); 'raw' build_raw(tk, si, vi); 'mailHeaders' build_mail_headers(tk, si, vi); 'spamReport'
    build_spam_report()."""
    html = build_html(tk, si, vi)
    text = build_text(tk, si, vi)
    htmlsource = qp_encode(html) if html_cte(tk, si, vi) == 'quoted-printable' else html
    return {
        'segment': SEGMENTS[si]['slug'],
        'variation': 'v%d' % vi,
        'messageId': message_id(tk, si, vi),
        'message': build_message_json(tk, si, vi, htmlsource, text),
        'htmlsource': htmlsource,
        'text': text,
        'raw': build_raw(tk, si, vi),
        'mailHeaders': build_mail_headers(tk, si, vi),
        'spamReport': build_spam_report(),
    }


def gen_proofs(ctx):
    r"""Returns {'tickets': {'EX-1': {'sandboxId': SANDBOX, 'proofs': [...]}, 'EX-2': {...}}} where proofs =
    [build_proof(tk, si, vi) for (si, vi) in PROOF_INDEX] (ticket order EX-1, EX-2)."""
    tickets = {}
    for tk in TICKET_KEYS:
        tickets[tk] = {'sandboxId': SANDBOX,
                       'proofs': [build_proof(tk, si, vi) for (si, vi) in PROOF_INDEX]}
    return {'tickets': tickets}


# ── fixtures-email-interstitials.json ──────────────────────────────────────────────────────────

def js_escape(s):
    r"""Returns `s` with every character that is not an ASCII letter or digit replaced by a lower-case
    '\xNN' escape (two hex digits; e.g. ':' -> '\x3a', '/' -> '\x2f', '.' -> '\x2e', '_' -> '\x5f', '-' -> '\x2d',
    '&' -> '\x26', '=' -> '\x3d', '?' -> '\x3f'); letters and digits stay as they are. All characters are ASCII."""
    return re.sub(r'[^A-Za-z0-9]', lambda m: '\\x%02x' % ord(m.group(0)), s)


def build_interstitial(tag, url):
    r"""Returns INTERSTITIAL_TEMPLATE % {'addr': 'tester+' + tag + '@inbox.mailtrap.io', 'href':
    url.replace('&', '&amp;'), 'js': js_escape(url)} (the page Pardot shows a test prospect)."""
    return INTERSTITIAL_TEMPLATE % {'addr': 'tester+' + tag + '@inbox.mailtrap.io', 'href': url.replace('&', '&amp;'),
                                    'js': js_escape(url)}


def interstitial_entries(tk):
    r"""Returns the ticket's interstitial list [(key, url, tag)] sorted by key, where key =
    SEGMENTS[si]['key'] + '-v<vi>-' + link_id(tk, si, vi, slot), url = dest_url(tk, si, vi, slot), tag =
    SEGMENTS[si]['tag']. The (si, vi, slot) triples: EX-2: (0,0,'lg') (0,0,'dn') (0,1,'lg') (0,1,'dn') (1,0,'dn')
    (1,1,'dn'). EX-1: (0,0,'lg') (0,0,'st') (0,0,'dn') (0,1,'lg') (0,1,'st') (0,1,'dn') (1,0,'dn') (1,1,'dn')."""
    triples = {
        'EX-1': [(0, 0, 'lg'), (0, 0, 'st'), (0, 0, 'dn'), (0, 1, 'lg'), (0, 1, 'st'), (0, 1, 'dn'), (1, 0, 'dn'), (1, 1, 'dn')],
        'EX-2': [(0, 0, 'lg'), (0, 0, 'dn'), (0, 1, 'lg'), (0, 1, 'dn'), (1, 0, 'dn'), (1, 1, 'dn')],
    }[tk]
    out = []
    for si, vi, slot in triples:
        key = '%s-v%d-%s' % (SEGMENTS[si]['key'], vi, link_id(tk, si, vi, slot))
        out.append((key, dest_url(tk, si, vi, slot), SEGMENTS[si]['tag']))
    return sorted(out, key=lambda e: e[0])


def gen_interstitials(ctx):
    r"""Returns {'EX-1': {key: build_interstitial(tag, url) for each interstitial_entries('EX-1')}, 'EX-2':
    {...}} (keys in the entries' sorted order)."""
    out = {}
    for tk in TICKET_KEYS:
        out[tk] = dict((key, build_interstitial(tag, url)) for key, url, tag in interstitial_entries(tk))
    return out


# ── fixtures-email-eoa.json ───────────────────────────────────────────────────────────────────

def build_eoa_test(tk, vi):
    r"""Returns the reduced `test` dict, keys in this order: 'subject' TICKETS[tk]['eoa_subject']; 'guid'
    eoa_guid(tk, vi); 'from_addr' '"Example Relief" <info@example.org>'; 'clients' {code: {'image_folder': code,
    'display_name': name, 'os_fullname': os, 'category': category, 'screenshots': {'images': [{'completed':
    True}]}} for (code, name, os, category) in EOA_CLIENTS} (EOA_CLIENTS order)."""
    t = TICKETS[tk]
    return {
        'subject': t['eoa_subject'],
        'guid': eoa_guid(tk, vi),
        'from_addr': '"%s" <%s>' % (ORG_NAME, MAIL_FROM),
        'clients': {code: {'image_folder': code, 'display_name': name, 'os_fullname': os_name, 'category': category,
                           'screenshots': {'images': [{'completed': True}]}}
                    for (code, name, os_name, category) in EOA_CLIENTS},
    }


def build_eoa_page(test):
    r"""Returns exactly '<html><body><script>\n    var test = ' + json.dumps(test, separators=(',', ':'),
    ensure_ascii=True) + ',\n        client_data = {};\n</script></body></html>' (no trailing newline)."""
    return ('<html><body><script>\n    var test = ' + json.dumps(test, separators=(',', ':'), ensure_ascii=True)
            + ',\n        client_data = {};\n</script></body></html>')


def gen_eoa(ctx):
    r"""Returns {'EX-1': {'v0': page, 'v1': page}, 'EX-2': {'v0': page, 'v1': page}} with page =
    build_eoa_page(build_eoa_test(tk, vi))."""
    out = {}
    for tk in TICKET_KEYS:
        out[tk] = {}
        for vi in range(len(VARIATIONS)):
            out[tk][VARIATIONS[vi]] = build_eoa_page(build_eoa_test(tk, vi))
    return out


# ── fixtures-email-jira.json ──────────────────────────────────────────────────────────────────

def build_description(tk):
    r"""Returns the issue description as an ADF doc {'type': 'doc', 'version': 1, 'content': [paragraphs]}
    (paragraph = adf_para(list of nodes)). EX-1 (5 paragraphs): adf_text('QA Links'); adf_text('Mailtrap'); then for
    si in 0, 1: [adf_text(SEGMENTS[si]['name']), adf_hard_break(), adf_text('v0: '),
    adf_inline_card(mailtrap_url(tk, si, 0)), adf_text(' '), adf_hard_break(), adf_text('v1: '),
    adf_inline_card(mailtrap_url(tk, si, 1)), adf_text(' ')]; then [adf_text('Email on Acid'), adf_hard_break(),
    adf_text('v0: '), adf_link_text(eoa_url(tk, 0)), adf_hard_break(), adf_text('v1: '), adf_link_text(eoa_url(tk, 1))]
    (that is 2 + 2 + 1 = 5 paragraphs, each holding the node list shown). EX-2 (11 paragraphs, one node list each):
    [adf_text('QA Links', 'strong')]; [adf_text('Mailtrap', 'strong')]; then for si in 0, 1: [adf_text(segment name,
    'em')]; [adf_text('v0: '), adf_link_text(mailtrap_url(tk, si, 0))]; [adf_text('v1: '), adf_link_text(mailtrap_url(tk,
    si, 1))]; then [adf_text('Email on Acid', 'strong')]; [adf_text('v0: '), adf_link_text(eoa_url(tk, 0))];
    [adf_text('v1: '), adf_link_text(eoa_url(tk, 1))]."""
    if TICKETS[tk]['layout'] == 'story':
        content = [adf_para([adf_text('QA Links')]), adf_para([adf_text('Mailtrap')])]
        for si in (0, 1):
            content.append(adf_para([adf_text(SEGMENTS[si]['name']), adf_hard_break(), adf_text('v0: '),
                                     adf_inline_card(mailtrap_url(tk, si, 0)), adf_text(' '), adf_hard_break(),
                                     adf_text('v1: '), adf_inline_card(mailtrap_url(tk, si, 1)), adf_text(' ')]))
        content.append(adf_para([adf_text('Email on Acid'), adf_hard_break(), adf_text('v0: '),
                                 adf_link_text(eoa_url(tk, 0)), adf_hard_break(), adf_text('v1: '),
                                 adf_link_text(eoa_url(tk, 1))]))
    else:
        content = [adf_para([adf_text('QA Links', 'strong')]), adf_para([adf_text('Mailtrap', 'strong')])]
        for si in (0, 1):
            content.append(adf_para([adf_text(SEGMENTS[si]['name'], 'em')]))
            content.append(adf_para([adf_text('v0: '), adf_link_text(mailtrap_url(tk, si, 0))]))
            content.append(adf_para([adf_text('v1: '), adf_link_text(mailtrap_url(tk, si, 1))]))
        content.append(adf_para([adf_text('Email on Acid', 'strong')]))
        content.append(adf_para([adf_text('v0: '), adf_link_text(eoa_url(tk, 0))]))
        content.append(adf_para([adf_text('v1: '), adf_link_text(eoa_url(tk, 1))]))
    return {'type': 'doc', 'version': 1, 'content': content}


def build_comment(tk, i):
    r"""Returns the i-th comment of ticket tk (JIRA_COMMENTS[tk][i] = {'id', 'created', 'blocks'}) as {'self':
    'https://jira.example.org/rest/api/3/issue/<issue_id>/comment/<id>', 'id': id, 'body': {'type': 'doc',
    'version': 1, 'content': [node for each block]}, 'created': created, 'updated': created} (keys in this order).
    Block -> node: ('p', inlines) -> adf_para([adf_inline(x) for x in inlines]); ('ul', items) -> {'type':
    'bulletList', 'content': [{'type': 'listItem', 'content': [adf_para([adf_inline(x) for x in item])]} for item
    in items]}; ('code', text) -> {'type': 'codeBlock', 'attrs': {'wrap': True}, 'content': [{'type': 'text',
    'text': text}]}."""
    t = TICKETS[tk]
    c = JIRA_COMMENTS[tk][i]
    content = []
    for blk in c['blocks']:
        if blk[0] == 'p':
            content.append(adf_para([adf_inline(x) for x in blk[1]]))
        elif blk[0] == 'ul':
            content.append({'type': 'bulletList', 'content': [
                {'type': 'listItem', 'content': [adf_para([adf_inline(x) for x in item])]} for item in blk[1]]})
        else:
            content.append({'type': 'codeBlock', 'attrs': {'wrap': True}, 'content': [{'type': 'text', 'text': blk[1]}]})
    return {
        'self': 'https://jira.example.org/rest/api/3/issue/%d/comment/%s' % (t['issue_id'], c['id']),
        'id': c['id'],
        'body': {'type': 'doc', 'version': 1, 'content': content},
        'created': c['created'],
        'updated': c['created'],
    }


def build_issue(tk):
    r"""Returns {'names': names, 'fields': fields}. EX-1: names = {'summary': 'Summary', 'customfield_90591':
    'Copy File', 'issuetype': 'Issue Type', 'description': 'Description', 'comment': 'Comment', 'customfield_10686':
    'QA Test Plan'}; EX-2: the same without 'customfield_90591'. fields has exactly the names' keys in the names'
    order: 'summary' t['summary']; 'customfield_90591' (EX-1 only) 'https://docs.google.com/document/d/<doc_id>/edit?usp=sharing';
    'issuetype' {'self': 'https://jira.example.org/rest/api/3/issuetype/<issue_type_id>', 'id': issue_type_id,
    'description': 'For email campaigns', 'iconUrl': 'https://jira.example.org/rest/api/2/universal_avatar/view/type/issuetype/avatar/<avatar_id>?size=medium',
    'name': issue_type, 'subtask': False, 'avatarId': avatar_id, 'hierarchyLevel': 0}; 'description'
    build_description(tk); 'comment' {'comments': [build_comment(tk, i) for each of JIRA_COMMENTS[tk]], 'self':
    'https://jira.example.org/rest/api/3/issue/<issue_id>/comment', 'maxResults': 1048576, 'total': <count>,
    'startAt': 0}; 'customfield_10686' 'https://docs.google.com/spreadsheets/d/<plan_id>/edit?gid=100#gid=100'."""
    t = TICKETS[tk]
    names = {'summary': 'Summary'}
    fields = {'summary': t['summary']}
    if tk == 'EX-1':
        names['customfield_90591'] = 'Copy File'
        fields['customfield_90591'] = 'https://docs.google.com/document/d/%s/edit?usp=sharing' % t['doc_id']
    names['issuetype'] = 'Issue Type'
    names['description'] = 'Description'
    names['comment'] = 'Comment'
    names['customfield_10686'] = 'QA Test Plan'
    fields['issuetype'] = {
        'self': 'https://jira.example.org/rest/api/3/issuetype/%s' % t['issue_type_id'],
        'id': t['issue_type_id'],
        'description': 'For email campaigns',
        'iconUrl': 'https://jira.example.org/rest/api/2/universal_avatar/view/type/issuetype/avatar/%d?size=medium' % t['avatar_id'],
        'name': t['issue_type'],
        'subtask': False,
        'avatarId': t['avatar_id'],
        'hierarchyLevel': 0,
    }
    fields['description'] = build_description(tk)
    comments = [build_comment(tk, i) for i in range(len(JIRA_COMMENTS[tk]))]
    fields['comment'] = {
        'comments': comments,
        'self': 'https://jira.example.org/rest/api/3/issue/%d/comment' % t['issue_id'],
        'maxResults': 1048576,
        'total': len(comments),
        'startAt': 0,
    }
    fields['customfield_10686'] = 'https://docs.google.com/spreadsheets/d/%s/edit?gid=100#gid=100' % t['plan_id']
    return {'names': names, 'fields': fields}


def gen_jira(ctx):
    r"""Returns {'EX-1': build_issue('EX-1'), 'EX-2': build_issue('EX-2')}."""
    return {'EX-1': build_issue('EX-1'), 'EX-2': build_issue('EX-2')}


# ── fixtures-email-doc-ex1.json, fixtures-email-doc-ex2.json ──────────────────────────────────

def build_doc_ex1():
    r"""Returns the EX-1 copy doc {'documentId': TICKETS['EX-1']['doc_id'], 'title': 'Cold Route - Message
    1 (synthetic copy doc)', 'synthetic': True, 'body': {'content': C}} (keys in this order), C being, in this order:
      0 doc_blank(); 1 doc_table([['', '+', '']]); 2 doc_blank();
      3 {'tableOfContents': {'content': [doc_paragraph([doc_run('Messages\n', heading_id=DOC_H3_ID)]),
        doc_paragraph([doc_run('Email 1 - ', heading_id=DOC_H4_ID), doc_run(EX1_DOC_TITLE + '\n', heading_id=DOC_H4_ID)])]}};
      4 doc_blank(); 5 doc_hr(); 6 doc_blank();
      7 doc_paragraph([doc_run('Messages\n', bold=True)], 'HEADING_3', heading_id=DOC_H3_ID); 8 doc_blank();
      9 doc_paragraph([doc_run('Email 1 -'), doc_run(' ' + EX1_DOC_TITLE + '\n')], 'HEADING_4', heading_id=DOC_H4_ID); 10 doc_blank();
      11 the details table: doc_table([[label, cell] for (label, paras) in EX1_DETAIL_ROWS]) where cell = [doc_paragraph([doc_run(text + '\n', bold=bold, link=url)], list_id=list_id) for (text, bold, url, list_id) in paras] (the label stays a plain str cell);
      12 doc_blank(); 13 doc_blank();
      14 doc_paragraph([doc_run('Subject Line: ', bold=True), doc_run(SUBJECT_LIMIT_TEXT + '\n')]);
      15-17 one bullet per EX1_SUBJECT_OPTIONS (text, bold): doc_paragraph(runs, list_id='l1'); the BOLD first option is three runs, all bold: 'Route 9', ' leaves before ', 'sunrise\n'; the others one run doc_run(text + '\n');
      18 doc_blank();
      19 doc_paragraph([doc_run('Preview Text: ', bold=True), doc_run(PREVIEW_LIMIT_TEXT + '\n')]);
      20-23 one bullet per EX1_PREVIEW_OPTIONS (text, bold): doc_paragraph([doc_run(text + '\n', bold=bold)], list_id='l1');
      24 doc_blank();
      25 doc_paragraph([doc_run('Landing Pages: ', bold=True), doc_run(TICKETS['EX-1']['landing'] + '\n', link=TICKETS['EX-1']['landing'])]);
      26 doc_blank(); 27 doc_blank(); 28 doc_hr(); 29 doc_blank();
      30 doc_paragraph([doc_run('[V1] ' + EX1_CTA_DOC + ' [LINK]\n')]); 31 doc_blank();
      32 doc_paragraph([doc_run('{{Recipient.FirstName}},\n')]); 33 doc_blank();
      34..43 for each text of EX1_DOC_BODY: doc_paragraph([doc_run(text + '\n')]) then doc_blank();
      44 doc_paragraph([doc_run('[V0] ' + EX1_CTA_DOC + ' [LINK]\n')]); 45 doc_blank(); 46 doc_blank(); 47 doc_hr();
      48 doc_blank(); 49 doc_blank(); 50 doc_blank(); 51 doc_blank().
    52 elements in all. No '*' character anywhere (raise ValueError('asterisk') otherwise)."""
    content = [
        doc_blank(),
        doc_table([['', '+', '']]),
        doc_blank(),
        {'tableOfContents': {'content': [
            doc_paragraph([doc_run('Messages\n', heading_id=DOC_H3_ID)]),
            doc_paragraph([doc_run('Email 1 - ', heading_id=DOC_H4_ID), doc_run(EX1_DOC_TITLE + '\n', heading_id=DOC_H4_ID)]),
        ]}},
        doc_blank(),
        doc_hr(),
        doc_blank(),
        doc_paragraph([doc_run('Messages\n', bold=True)], 'HEADING_3', heading_id=DOC_H3_ID),
        doc_blank(),
        doc_paragraph([doc_run('Email 1 -'), doc_run(' ' + EX1_DOC_TITLE + '\n')], 'HEADING_4', heading_id=DOC_H4_ID),
        doc_blank(),
        doc_table([[label, [doc_paragraph([doc_run(text + '\n', bold=bold, link=url)], list_id=list_id)
                            for (text, bold, url, list_id) in paras]]
                   for (label, paras) in EX1_DETAIL_ROWS]),
        doc_blank(),
        doc_blank(),
        doc_paragraph([doc_run('Subject Line: ', bold=True), doc_run(SUBJECT_LIMIT_TEXT + '\n')]),
        # the bold first subject option is three bold runs; the others follow as plain bullets
        doc_paragraph([doc_run('Route 9', bold=True), doc_run(' leaves before ', bold=True), doc_run('sunrise\n', bold=True)], list_id='l1'),
    ]
    content += [doc_paragraph([doc_run(text + '\n', bold=bold)], list_id='l1') for (text, bold) in EX1_SUBJECT_OPTIONS[1:]]
    content.append(doc_blank())
    content.append(doc_paragraph([doc_run('Preview Text: ', bold=True), doc_run(PREVIEW_LIMIT_TEXT + '\n')]))
    content += [doc_paragraph([doc_run(text + '\n', bold=bold)], list_id='l1') for (text, bold) in EX1_PREVIEW_OPTIONS]
    content.append(doc_blank())
    content.append(doc_paragraph([doc_run('Landing Pages: ', bold=True),
                                  doc_run(TICKETS['EX-1']['landing'] + '\n', link=TICKETS['EX-1']['landing'])]))
    content += [doc_blank(), doc_blank(), doc_hr(), doc_blank()]
    content.append(doc_paragraph([doc_run('[V1] ' + EX1_CTA_DOC + ' [LINK]\n')]))
    content.append(doc_blank())
    content.append(doc_paragraph([doc_run('{{Recipient.FirstName}},\n')]))
    content.append(doc_blank())
    for text in EX1_DOC_BODY:
        content.append(doc_paragraph([doc_run(text + '\n')]))
        content.append(doc_blank())
    content.append(doc_paragraph([doc_run('[V0] ' + EX1_CTA_DOC + ' [LINK]\n')]))
    content += [doc_blank(), doc_blank(), doc_hr(), doc_blank(), doc_blank(), doc_blank(), doc_blank()]
    doc = {'documentId': TICKETS['EX-1']['doc_id'], 'title': 'Cold Route - Message 1 (synthetic copy doc)',
           'synthetic': True, 'body': {'content': content}}
    if '*' in json.dumps(doc):
        raise ValueError('asterisk')
    return doc


def body_paragraphs_ex2(proof_html):
    r"""Returns the EX-2 doc's body paragraphs from the EX-2 regular v0 proof's html: paragraphs, _ =
    scan_visible_paragraphs(proof_html); g = find_greeting(paragraphs); e = paragraphs.index('DONATE NOW', g); the
    result is ['{{Recipient.FirstName}},'] + paragraphs[g + 1:e] + ['[V0] DONATE NOW [LINK]', '[V1] HELP NOW [LINK]'].
    Raises ValueError('no greeting') when g is None and ValueError('no DONATE NOW') when 'DONATE NOW' is absent."""
    paragraphs, _pre = scan_visible_paragraphs(proof_html)
    g = find_greeting(paragraphs)
    if g is None:
        raise ValueError('no greeting')
    if 'DONATE NOW' not in paragraphs[g:]:
        raise ValueError('no DONATE NOW')
    e = paragraphs.index('DONATE NOW', g)
    return (['{{Recipient.FirstName}},'] + paragraphs[g + 1:e]
            + ['[V0] DONATE NOW [LINK]', '[V1] HELP NOW [LINK]'])


def build_doc_ex2(body_paragraphs):
    r"""Returns the EX-2 copy doc {'documentId': TICKETS['EX-2']['doc_id'], 'title': 'Spring Seed Kits: Last
    Call (synthetic copy doc)', 'synthetic': True, 'body': {'content': C}} (keys in this order), C being, in this order:
      doc_table([['Sender', ORG_NAME]]); doc_blank();
      doc_paragraph([doc_run('Subject Line: ', bold=True), doc_run(SUBJECT_LIMIT_TEXT + '\n')]);
      one bullet per EX2_SUBJECT_OPTIONS (text, bold): doc_paragraph([doc_run(text + '\n', bold=bold)], list_id='l1'); doc_blank();
      doc_paragraph([doc_run('Preview Text: ', bold=True), doc_run(PREVIEW_LIMIT_TEXT + '\n')]);
      doc_paragraph([doc_run(EX2_PREVIEW_OPTION + '\n', bold=True)], list_id='l1'); doc_blank();
      doc_paragraph([doc_run('Landing Pages: ', bold=True), doc_run(TICKETS['EX-2']['landing'] + '\n', link=TICKETS['EX-2']['landing'])]);
      doc_blank(); doc_hr(); doc_blank();
      for each text in body_paragraphs: doc_paragraph([doc_run(text + '\n')]); doc_blank();
      doc_hr(); doc_blank().
    No '*' character anywhere (raise ValueError('asterisk') otherwise)."""
    content = [doc_table([['Sender', ORG_NAME]]), doc_blank(),
               doc_paragraph([doc_run('Subject Line: ', bold=True), doc_run(SUBJECT_LIMIT_TEXT + '\n')])]
    content += [doc_paragraph([doc_run(text + '\n', bold=bold)], list_id='l1') for (text, bold) in EX2_SUBJECT_OPTIONS]
    content.append(doc_blank())
    content.append(doc_paragraph([doc_run('Preview Text: ', bold=True), doc_run(PREVIEW_LIMIT_TEXT + '\n')]))
    content.append(doc_paragraph([doc_run(EX2_PREVIEW_OPTION + '\n', bold=True)], list_id='l1'))
    content.append(doc_blank())
    content.append(doc_paragraph([doc_run('Landing Pages: ', bold=True),
                                  doc_run(TICKETS['EX-2']['landing'] + '\n', link=TICKETS['EX-2']['landing'])]))
    content += [doc_blank(), doc_hr(), doc_blank()]
    for text in body_paragraphs:
        content.append(doc_paragraph([doc_run(text + '\n')]))
        content.append(doc_blank())
    content += [doc_hr(), doc_blank()]
    doc = {'documentId': TICKETS['EX-2']['doc_id'], 'title': 'Spring Seed Kits: Last Call (synthetic copy doc)',
           'synthetic': True, 'body': {'content': content}}
    if '*' in json.dumps(doc):
        raise ValueError('asterisk')
    return doc


def gen_doc_ex1(ctx):
    r"""Returns build_doc_ex1()."""
    return build_doc_ex1()


def gen_doc_ex2(ctx):
    r"""Returns build_doc_ex2(body_paragraphs_ex2(build_html('EX-2', 0, 0)))."""
    return build_doc_ex2(body_paragraphs_ex2(build_html('EX-2', 0, 0)))


# ── fixtures-email-plans.json ─────────────────────────────────────────────────────────────────

def build_template_values():
    r"""Returns the template plan's 143 rows (list of 143 lists; columns A..H = indexes 0..7), each passed
    through trim_row. Rows 1-7: 1 ['[Insert Jira Ticket URL Here]' (TEMPLATE_A1) in A, '1st Pass Estimate' in H];
    2 ['0.82' in H]; 3 and 4 empty rows []; 5 [TEMPLATE_NOTE_ROW5 in A]; 6 ['Test Group' A, 'Description' C,
    'Preview Clients' E, 'Notes' H]; 7 ['Total Minutes\r' D, 'Desktop' E, 'Mobile' F, 'Web-Based' G]. Then four groups of
    34 rows (TEMPLATE_GROUP), starting at rows TEMPLATE_GROUP_START_ROWS = 8, 42, 76, 110. Row k of a group is
    (text C, minutes D, status code): C = text, D = minutes (group 1 and 3 only; group 3's alt-tags minutes are
    '2' instead of '3'; groups 2 and 4 have none), and for code 'X' E 'Backlog', F 'Excluded', G 'Excluded'; for 'V'
    E, F, G all 'Backlog'; no statuses for None. The group label sits on the group's first row: groups 1 and 3 in
    column A ('Reqs\nv0' and 'Reqs\nv1'), groups 2 and 4 in column B ('Reqs\nv0' + TEMPLATE_VARIATION_SUFFIX and
    'Reqs\nv1' + TEMPLATE_VARIATION_SUFFIX). Text variants (k = the 0-based position inside the group): in groups 2 and 4 the
    k=16 text ('Grammar') becomes TEMPLATE_GRAMMAR_VARIANT; in group 2 only, the alt-tags test row (the one starting
    'Do all images') becomes TEMPLATE_ALT_TEXT_VARIANT; in group 4 the k=9 text ('Preview Text - ') becomes
    TEMPLATE_PREVIEW_VARIANT; in group 3 the k=14 text "Is personalized content rendered correctly? (No
    |FIRSTNAME|'s anywhere)" has 'rendered' spelled 'renderd'."""
    rows = [
        [TEMPLATE_A1, '', '', '', '', '', '', '1st Pass Estimate'],
        ['', '', '', '', '', '', '', '0.82'],
        [],
        [],
        [TEMPLATE_NOTE_ROW5],
        ['Test Group', '', 'Description', '', 'Preview Clients', '', '', 'Notes'],
        ['', '', '', 'Total Minutes\r', 'Desktop', 'Mobile', 'Web-Based'],
    ]
    labels = ['Reqs\nv0', 'Reqs\nv0' + TEMPLATE_VARIATION_SUFFIX, 'Reqs\nv1', 'Reqs\nv1' + TEMPLATE_VARIATION_SUFFIX]
    for gi in range(len(TEMPLATE_GROUP_START_ROWS)):
        for k, (text, minutes, code) in enumerate(TEMPLATE_GROUP):
            row = [''] * 8
            if k == 0:
                row[0 if gi % 2 == 0 else 1] = labels[gi]
            out_text = text
            if gi == 1 and k == 20:
                out_text = TEMPLATE_ALT_TEXT_VARIANT
            if gi in (1, 3) and k == 16:
                out_text = TEMPLATE_GRAMMAR_VARIANT
            if gi == 3 and k == 9:
                out_text = TEMPLATE_PREVIEW_VARIANT
            if gi == 2 and k == 14:
                out_text = text.replace('rendered', 'renderd')
            row[2] = out_text
            if gi in (0, 2):
                row[3] = minutes
            if gi == 2 and k == 20:
                row[3] = '2'
            if code == 'X':
                row[4:7] = ['Backlog', 'Excluded', 'Excluded']
            elif code == 'V':
                row[4:7] = ['Backlog', 'Backlog', 'Backlog']
            rows.append(row)
    return [trim_row(r) for r in rows]


def build_ex1_values():
    r"""Returns the EX-1 plan's rows: a deep copy of build_template_values() then, in this order: A1 =
    'https://jira.example.org/browse/EX-1'; H2 = '1:45'; the four group labels: A8 'Reqs - Regular Donors\nv0', B42
    'Reqs - Major Donors\nv0', A76 'Reqs - Regular Donors\nv1', B110 'Reqs - Major Donors\nv1' (the label cell of
    that row, replacing the template label); every E cell that is 'Backlog' becomes 'Passed', and so do the F and G
    cells that are 'Backlog'; then EX1_PLAN_OVERRIDES {(row, 'E'): status}; then EX1_PLAN_NOTES {row: note} into
    column H of that row. Every row is re-trimmed with trim_row (pad with '' up to the column first when needed)."""
    v = copy.deepcopy(build_template_values())
    edits = [(1, 'A', 'https://jira.example.org/browse/EX-1'), (2, 'H', '1:45'),
             (8, 'A', 'Reqs - Regular Donors\nv0'), (42, 'B', 'Reqs - Major Donors\nv0'),
             (76, 'A', 'Reqs - Regular Donors\nv1'), (110, 'B', 'Reqs - Major Donors\nv1')]
    for r, col, val in edits:
        row = v[r - 1]
        c = 'ABCDEFGH'.index(col)
        row.extend([''] * (c + 1 - len(row)))
        row[c] = val
    for row in v:
        for c in (4, 5, 6):
            if c < len(row) and row[c] == 'Backlog':
                row[c] = 'Passed'
    for (r, col), status in EX1_PLAN_OVERRIDES.items():
        row = v[r - 1]
        c = 'ABCDEFGH'.index(col)
        row.extend([''] * (c + 1 - len(row)))
        row[c] = status
    for r, note in EX1_PLAN_NOTES.items():
        row = v[r - 1]
        row.extend([''] * (8 - len(row)))
        row[7] = note
    return [trim_row(row) for row in v]


def build_plan(spreadsheet_id, title, values):
    r"""Returns {'spreadsheetId': spreadsheet_id, 'title': title, 'tabs': a deep copy of the list(PLAN_TABS),
    'values': values, 'legend': [list(r) for r in PLAN_LEGEND], 'capturedAt': PLAN_CAPTURED_AT, 'source': PLAN_SOURCE}
    (keys in this order)."""
    return {
        'spreadsheetId': spreadsheet_id,
        'title': title,
        'tabs': copy.deepcopy(list(PLAN_TABS)),
        'values': values,
        'legend': [list(r) for r in PLAN_LEGEND],
        'capturedAt': PLAN_CAPTURED_AT,
        'source': PLAN_SOURCE,
    }


def gen_plans(ctx):
    r"""Returns {'template': build_plan(TEMPLATE_PLAN_ID, TEMPLATE_PLAN_TITLE, build_template_values()),
    'EX-1': build_plan(TICKETS['EX-1']['plan_id'], EX1_PLAN_TITLE, build_ex1_values())}."""
    return {
        'template': build_plan(TEMPLATE_PLAN_ID, TEMPLATE_PLAN_TITLE, build_template_values()),
        'EX-1': build_plan(TICKETS['EX-1']['plan_id'], EX1_PLAN_TITLE, build_ex1_values()),
    }


# ══ 5. The seven outputs and main ═══════════════════════════════════════════════════════════════════════

OUTPUTS = [
    ('fixtures-email-proofs.json', gen_proofs),
    ('fixtures-email-interstitials.json', gen_interstitials),
    ('fixtures-email-eoa.json', gen_eoa),
    ('fixtures-email-jira.json', gen_jira),
    ('fixtures-email-doc-ex1.json', gen_doc_ex1),
    ('fixtures-email-doc-ex2.json', gen_doc_ex2),
    ('fixtures-email-plans.json', gen_plans),
]
OUTPUTS_SPEC = tuple(n for n, _f in OUTPUTS)


def main(argv=None):
    return run_cli('gen-email-fixtures.py', 'Generate the synthetic fixtures-email-*.json files (verify only by default).',
                   OUTPUTS, HERE, synthetic_gate, selftest_synthetic_gate, argv=argv)


if __name__ == '__main__':
    sys.exit(main())
