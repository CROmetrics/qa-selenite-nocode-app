"""Real-Chrome check of qpClipScanFn (extension/qa-pass.js) against scan.html, no extension needed.

The function source is taken from qa-pass.js itself (the file only assigns globals, so evaluating it
in a blank page is safe) and evaluated in each scan page, exactly as the worker injects it. Asserts
the numbers the planner measured: at 375 px (mobile) the 500 px block overflows the page by 125 px and
two texts are offenders; the sr-only, ellipsis, off-canvas and carousel texts are ignored; at 1280 px
nothing is an offender.

    python3 -I -u extension/tests/qapass-gate/scan_check.py        (exit 0 = all assertions hold)
"""
import json, os, shutil, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'extension', 'tests', 'browserstack-gate'))
from cdp import Browser  # noqa: E402

PAGE = 'file://' + os.path.join(HERE, 'scan.html')
QP_JS = os.path.join(REPO, 'extension', 'qa-pass.js')


def scan(b, sess, width, height, mobile):
    b.send('Emulation.setDeviceMetricsOverride',
           {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': mobile}, session=sess)
    b.send('Page.navigate', {'url': PAGE}, session=sess)
    for _ in range(50):
        time.sleep(0.2)
        if b.ev(sess, 'document.readyState') == 'complete':
            break
    time.sleep(0.3)
    return json.loads(b.ev(sess, 'JSON.stringify((' + SRC + ')({}))'))


failures = []


def check(name, cond, detail=None):
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else '  -> ' + json.dumps(detail)[:300]))
    if not cond:
        failures.append(name)


prof = tempfile.mkdtemp(prefix='qp-scan-')
b = Browser(['--remote-debugging-pipe', '--headless=new', '--no-first-run',
             '--user-data-dir=' + prof, '--window-size=1280,900', 'about:blank'])
try:
    tid = b.send('Target.createTarget', {'url': 'about:blank'})['targetId']
    sess = b.attach(tid)
    b.send('Page.enable', session=sess)
    with open(QP_JS, encoding='utf8') as f:
        b.ev(sess, f.read())
    SRC = b.ev(sess, 'qpClipScanFn.toString()')
    check('qpClipScanFn source extracted from qa-pass.js', isinstance(SRC, str) and SRC.startswith('function qpClipScanFn'), SRC[:60] if SRC else SRC)

    r = scan(b, sess, 375, 812, True)
    print('375:', json.dumps({k: r.get(k) for k in ('vw', 'sw', 'pageOverflowPx', 'offenderCount', 'worstGapPx', 'ignored', 'ms')}))
    check('375: no error', 'error' not in r, r)
    check('375: pageOverflowPx == 125', r.get('pageOverflowPx') == 125, r.get('pageOverflowPx'))
    over = [o for o in r.get('offenders', []) if o['text'].startswith('OVERFLOW-BLOCK')]
    hero = [o for o in r.get('offenders', []) if o['text'].startswith('CLIPPED-HERO')]
    check('375: OVERFLOW-BLOCK offender with gapPx <= -100', bool(over) and over[0]['gapPx'] <= -100, over)
    check('375: CLIPPED-HERO offender with -25 <= gapPx <= -15', bool(hero) and -25 <= hero[0]['gapPx'] <= -15, hero)
    check('375: exactly those two offenders', r.get('offenderCount') == 2, r.get('offenders'))
    ig = r.get('ignored', {})
    check('375: ignored.srOnly == 1', ig.get('srOnly') == 1, ig)
    check('375: ignored.ellipsis == 1', ig.get('ellipsis') == 1, ig)
    check('375: ignored.offCanvas == 1', ig.get('offCanvas') == 1, ig)
    check('375: ignored.carousel == 1', ig.get('carousel') == 1, ig)
    check('375: worst offender is the overflow block', r.get('offenders') and r['offenders'][0]['text'].startswith('OVERFLOW-BLOCK'), r.get('offenders'))
    if hero:
        check('375: the hero is clipped by its overflow box (by=overflow, clipBy=div.box)', hero[0]['by'] == 'overflow' and hero[0]['clipBy'] == 'div.box', hero[0])

    r = scan(b, sess, 1280, 900, False)
    print('1280:', json.dumps({k: r.get(k) for k in ('vw', 'sw', 'pageOverflowPx', 'offenderCount', 'ignored', 'ms')}))
    check('1280: no error', 'error' not in r, r)
    check('1280: offenderCount == 0', r.get('offenderCount') == 0, r.get('offenders'))
finally:
    b.close()
    shutil.rmtree(prof, ignore_errors=True)

print('FAILED: ' + ', '.join(failures) if failures else 'ALL PASSED')
sys.exit(1 if failures else 0)
