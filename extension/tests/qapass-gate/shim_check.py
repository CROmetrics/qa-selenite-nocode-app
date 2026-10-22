"""Real-Chrome check of QP_TRACK_SHIM (extension/qa-pass.js): the doc-start trackEvent listener.

Why it exists: the first QP_TRACK_SHIM did `window.optimizely = window.optimizely || []` at document
start. zapier.com's own loader only fetches the Optimizely snippet when that global is absent, so with
the shim installed the snippet never loaded (measured 2026-10-21). An accessor that armed the listener
on EVERY assignment let zapier load but registered it three times on starz (21 events instead of 7).
The shim this checks must (1) not create the global before the page does, (2) register the listener
exactly once, and (3) still be registered before the snippet fires its on-load events.

Two parts, each in a fresh headless Chrome profile:

  synthetic  four local pages with a fake snippet that behaves like Optimizely's (reads a queue array
             left in window.optimizely, replaces it with its API, replays the queue, fires one
             pageview): queue-first, snippet-only, a zapier-style loader that only loads the snippet
             when window.optimizely is absent, and a snippet that assigns the global twice. The shipped
             shim must see exactly 1 event and a working .get on every page. The LEGACY array shim is
             run too, and must reproduce the bug on the guarded loader (no .get), so the check proves
             it can fail.
  live       plain PROD, no query string: https://www.starz.com/us/en/ and https://zapier.com/. The
             shipped shim must leave the snippet loaded (.get is a function, a cdn.optimizely.com
             request was made, *.optimizely.com/js/, which is cdn-pci on starz) and the listener registered, and on starz must capture exactly as many
             on-load events as the legacy array shim does in the same run (starz builds no queue of its
             own, so the legacy shim registers once there; 7 events on 2026-10-21), with the same
             (type, name) multiset. Nothing scrolls before the read. Skipped (not failed) when the
             network is down.

    python3 -I -u extension/tests/qapass-gate/shim_check.py                 (shim taken from qa-pass.js)
    python3 -I -u extension/tests/qapass-gate/shim_check.py --candidate F   (shim source read from file F)
    python3 -I -u extension/tests/qapass-gate/shim_check.py --synthetic-only

Exit 0 = every assertion held.
"""
import json, os, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'extension', 'tests', 'browserstack-gate'))
from cdp import Browser  # noqa: E402

QP_JS = os.path.join(REPO, 'extension', 'qa-pass.js')

# The shim as first shipped (plan Step 4), kept here only as the reference that reproduces the bug
# and as the single-registration baseline on starz, which builds no queue of its own.
LEGACY_ARRAY_SHIM = ("(function(){try{if(window.__qpLst)return;window.__qpLst=true;window.__qpTrack=[];"
                     "var o=window.optimizely=window.optimizely||[];o.push({type:'addListener',filter:{type:'analytics',"
                     "name:'trackEvent'},handler:function(e){try{var d=(e&&e.data)||{};window.__qpTrack.push({t:Date.now(),"
                     "name:String(d.name||''),apiName:String(d.apiName||''),type:String(d.type||''),"
                     "category:String(d.category||'')});}catch(_){}}});}catch(_){}})();")

# A fake snippet: reads a queue array if one is there, installs its API, replays the queue, then fires
# one pageview through every trackEvent listener. DOUBLE assigns the global a second time afterwards.
FAKE = ("(function(){var q=window.optimizely;var hs=[];var api={get:function(k){return k==='data'?{experiments:{}}:null;},"
        "push:function(o){if(o&&o.type==='addListener'&&o.filter&&o.filter.name==='trackEvent'&&typeof o.handler==='function')hs.push(o.handler);}};"
        "if(Array.isArray(q))q.forEach(api.push);window.optimizely=api;%s"
        "hs.forEach(function(h){h({data:{name:'Fake page',apiName:'fake_page',type:'pageview',category:'other'}});});})();")
SNIPPET = FAKE % ''
SNIPPET_DOUBLE = FAKE % 'window.optimizely=api;'

PAGES = {
    'queue-first': "<script>window.optimizely=window.optimizely||[];window.optimizely.push({type:'page',pageName:'p'});</script><script>%s</script>" % SNIPPET,
    'snippet-only': "<script>%s</script>" % SNIPPET,
    'guarded-loader': ("<script>if(!window.optimizely){var s=document.createElement('script');s.text=%s;document.head.appendChild(s);}</script>"
                       % json.dumps(SNIPPET)),
    'double-assign': "<script>window.optimizely=window.optimizely||[];</script><script>%s</script>" % SNIPPET_DOUBLE,
}

READ = ("JSON.stringify({get: !!(window.optimizely && typeof window.optimizely.get === 'function'),"
        " listener: window.__qpLst === true,"
        " events: (window.__qpTrack || []).map(function (e) { return e.type + ':' + e.name; }),"
        " snippetReq: performance.getEntriesByType('resource').some(function (r) { return /optimizely\\.com\\/js\\//.test(r.name); }),"
        " logx: performance.getEntriesByType('resource').some(function (r) { return r.name.indexOf('logx.optimizely.com') !== -1; }),"
        " scrollY: window.scrollY})")

failures = []


def check(name, cond, detail=None):
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else '  -> ' + json.dumps(detail)[:400]))
    if not cond:
        failures.append(name)


def new_browser():
    return Browser(['--remote-debugging-pipe', '--headless=new', '--no-first-run',
                    '--user-data-dir=' + tempfile.mkdtemp(prefix='qp-shim-'), '--window-size=1440,900', 'about:blank'])


def shipped_shim():
    b = new_browser()
    try:
        s = b.attach(b.send('Target.createTarget', {'url': 'about:blank'})['targetId'])
        with open(QP_JS, encoding='utf8') as f:
            b.ev(s, f.read())
        return b.ev(s, 'QP_TRACK_SHIM')
    finally:
        b.close()


def load_with(shim, url, wait_ready=15, settle=4):
    """Fresh profile, shim registered at document start (None = no shim), plain navigation, no scroll."""
    b = new_browser()
    try:
        s = b.attach(b.send('Target.createTarget', {'url': 'about:blank'})['targetId'])
        b.send('Page.enable', session=s)
        b.send('Emulation.setDeviceMetricsOverride', {'width': 1440, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False}, session=s)
        if shim:
            b.send('Page.addScriptToEvaluateOnNewDocument', {'source': shim}, session=s)
        b.send('Page.navigate', {'url': url}, session=s)
        end = time.time() + wait_ready
        while time.time() < end:
            time.sleep(0.5)
            try:
                if b.ev(s, "document.readyState === 'complete' && !!(window.optimizely && typeof window.optimizely.get === 'function')"):
                    break
            except Exception:
                pass
        time.sleep(settle)
        return json.loads(b.ev(s, READ))
    finally:
        b.close()


def main():
    args = sys.argv[1:]
    if '--candidate' in args:
        with open(args[args.index('--candidate') + 1], encoding='utf8') as f:
            shim = f.read().strip()
        print('shim: candidate file')
    else:
        shim = shipped_shim()
        print('shim: QP_TRACK_SHIM from qa-pass.js')
    check('the shim is a non-empty string', isinstance(shim, str) and len(shim) > 100, shim)
    check('the shim does not assign window.optimizely = window.optimizely || []',
          'window.optimizely=window.optimizely||[]' not in shim.replace(' ', ''), shim[:200])

    # ── synthetic ─────────────────────────────────────────────────────────
    tmp = tempfile.mkdtemp(prefix='qp-shim-pages-')
    for name, body in PAGES.items():
        path = os.path.join(tmp, name + '.html')
        with open(path, 'w', encoding='utf8') as f:
            f.write('<!doctype html><html><head><title>%s</title></head><body><p>%s</p>%s</body></html>' % (name, name, body))
        url = 'file://' + path
        r = load_with(shim, url, wait_ready=3, settle=0.5)
        print('synthetic %-15s shipped: %s' % (name, json.dumps(r)))
        check('synthetic %s: the snippet installed its API (.get works)' % name, r['get'], r)
        check('synthetic %s: the listener is registered' % name, r['listener'], r)
        check('synthetic %s: exactly 1 event (registered once)' % name, len(r['events']) == 1, r['events'])
        legacy = load_with(LEGACY_ARRAY_SHIM, url, wait_ready=3, settle=0.5)
        print('synthetic %-15s legacy:  %s' % (name, json.dumps(legacy)))
        if name == 'guarded-loader':
            check('synthetic guarded-loader: the legacy array shim reproduces the bug (no .get)', not legacy['get'], legacy)

    if '--synthetic-only' in args:
        return

    # ── live ──────────────────────────────────────────────────────────────
    sites = {'starz': 'https://www.starz.com/us/en/', 'zapier': 'https://zapier.com/'}
    try:
        probe = load_with(None, sites['starz'])
    except Exception as e:
        print('SKIPPED live part: %s' % e)
        return
    if not probe['get']:
        print('SKIPPED live part: starz.com did not load its snippet without any shim (network or bot check?)')
        return
    for site, url in sites.items():
        r = load_with(shim, url)
        print('live %-7s shipped: get=%s snippetReq=%s logx=%s listener=%s events=%d scrollY=%s' % (site, r['get'], r['snippetReq'], r['logx'], r['listener'], len(r['events']), r['scrollY']))
        check('live %s: the snippet loaded with the shim installed (.get is a function)' % site, r['get'], r)
        check('live %s: the snippet file was requested (*.optimizely.com/js/...)' % site, r['snippetReq'], r)
        # The snippet only posts to logx when it tracked something; when it did, the listener must have
        # seen at least one event (otherwise it registered too late). zapier's home tracks nothing on
        # load (no logx request, 0 events, measured 2026-10-21), which is consistent, not a miss.
        if r['logx']:
            check('live %s: the snippet sent events (logx) and the listener saw them' % site, len(r['events']) > 0, r)
        else:
            print('             %s sent no events on load (no logx request); 0 events is consistent' % site)
        check('live %s: the listener is registered' % site, r['listener'], r)
        check('live %s: nothing scrolled before the read' % site, r['scrollY'] == 0, r['scrollY'])
        if site == 'starz':
            legacy = load_with(LEGACY_ARRAY_SHIM, url)
            print('live starz   legacy:  get=%s events=%d' % (legacy['get'], len(legacy['events'])))
            print('             shipped events: %s' % json.dumps(r['events']))
            print('             legacy events:  %s' % json.dumps(legacy['events']))
            check('live starz: on-load event count equals the single-registration legacy count',
                  len(r['events']) == len(legacy['events']), {'shipped': len(r['events']), 'legacy': len(legacy['events'])})
            check('live starz: same (type, name) multiset as the legacy shim',
                  sorted(r['events']) == sorted(legacy['events']), {'shipped': r['events'], 'legacy': legacy['events']})
            print('             (2026-10-21 reference: 7 events; this run: %d)' % len(r['events']))


main()
print('ALL PASSED' if not failures else '%d FAILED: %s' % (len(failures), '; '.join(failures)))
sys.exit(1 if failures else 0)
