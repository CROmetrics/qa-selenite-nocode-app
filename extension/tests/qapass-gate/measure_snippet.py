"""Measure the shapes of window.optimizely.get('data') on a real, plain PROD page and save them as
extension/tests/fixtures-qapass-snippet.json, the fixture qa-pass.test.js builds its snippet-analysis
tests from.

Never navigates with a query string: no forcing or tracking parameter ever reaches a real site.
Needs system Chrome and the network. Run:
    python3 -I -u extension/tests/qapass-gate/measure_snippet.py
"""
import json, os, shutil, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'extension', 'tests', 'browserstack-gate'))
from cdp import Browser  # noqa: E402

OUT = os.path.join(REPO, 'extension', 'tests', 'fixtures-qapass-snippet.json')
MAIN_URL = 'https://www.starz.com/us/en/'
SURVEY_URLS = ['https://zapier.com/', 'https://www.wowway.com/', 'https://www.toryburch.com/en-us/']

# Same text as QP_TRACK_SHIM in extension/qa-pass.js (registered on every new document).
QP_TRACK_SHIM = ("(function(){try{if(window.__qpLst)return;window.__qpLst=true;window.__qpTrack=[];"
                 "var o=window.optimizely=window.optimizely||[];o.push({type:'addListener',filter:{type:'analytics',"
                 "name:'trackEvent'},handler:function(e){try{var d=(e&&e.data)||{};window.__qpTrack.push({t:Date.now(),"
                 "name:String(d.name||''),apiName:String(d.apiName||''),type:String(d.type||''),"
                 "category:String(d.category||'')});}catch(_){}}});}catch(_){}})();")

READY_JS = ("(function(){try{var o=window.optimizely;return !!(o&&typeof o.get==='function'&&o.get('data')"
            "&&o.get('data').experiments);}catch(e){return false;}})()")

MEASURE_JS = r"""
(function () {
  var CUT = 160;
  function clean(v, depth) {
    if (typeof v === 'function') return '[fn]';
    if (typeof v === 'string') return v.length > CUT ? v.slice(0, CUT) + '…' : v;
    if (v === null || typeof v !== 'object') return v;
    if (depth > 8) return '[deep]';
    if (Array.isArray(v)) return v.map(function (x) { return clean(x, depth + 1); });
    var o = {};
    Object.keys(v).forEach(function (k) { o[k] = clean(v[k], depth + 1); });
    return o;
  }
  function vals(x) {
    if (Array.isArray(x)) return x;
    if (x && typeof x === 'object') return Object.keys(x).map(function (k) { return x[k]; });
    return [];
  }
  function nul(x) { return x === undefined ? null : x; }
  try {
    var opt = window.optimizely;
    if (!opt || typeof opt.get !== 'function') return JSON.stringify({ error: 'window.optimizely.get is not available' });
    var data = opt.get('data');
    var experiments = vals(data.experiments), audiences = vals(data.audiences), pages = vals(data.pages),
        events = vals(data.events), campaigns = vals(data.campaigns);
    var first4 = experiments.slice(0, 4).map(function (e) {
      return clean({
        id: e.id, name: e.name, audienceIds: nul(e.audienceIds), audienceName: nul(e.audienceName),
        weightDistributions: nul(e.weightDistributions), experimentMetadata: nul(e.experimentMetadata),
        deployed: nul(e.deployed),
        variations: (e.variations || []).map(function (v) { return { id: v.id, name: v.name }; })
      }, 0);
    });
    var camps = campaigns.slice(0, 4).map(function (c) {
      return clean({
        id: c.id, name: c.name, pageIds: nul(c.pageIds), viewIds: nul(c.viewIds), holdback: nul(c.holdback),
        policy: nul(c.policy), activation: nul(c.activation),
        // a real campaign has no experimentIds: it carries the experiment objects in c.experiments
        experimentIds: Array.isArray(c.experiments) ? c.experiments.map(function (x) { return x.id; }) : nul(c.experimentIds)
      }, 0);
    });
    var sel = [];
    function addPage(p) { if (p && sel.indexOf(String(p.id)) < 0) sel.push(String(p.id)); }
    pages.slice(0, 2).forEach(addPage);
    var byId = {};
    pages.forEach(function (p) { byId[String(p.id)] = p; });
    camps.forEach(function (c) { (c.pageIds || []).forEach(function (id) { addPage(byId[String(id)]); }); });
    pages.forEach(function (p) { if (p.activationType === 'callback') addPage(p); });
    sel = sel.slice(0, 8);
    var outPages = pages.filter(function (p) { return sel.indexOf(String(p.id)) >= 0; }).map(function (p) { return clean(p, 0); });
    function ev(e) {
      return clean({ id: e.id, viewId: nul(e.viewId), name: e.name, category: nul(e.category), apiName: nul(e.apiName),
                     eventType: nul(e.eventType), eventFilter: nul(e.eventFilter), pageId: nul(e.pageId) }, 0);
    }
    var outEvents = events.filter(function (e) { return e.eventType === 'custom'; }).slice(0, 2).map(ev)
      .concat(events.filter(function (e) { return e.eventType === 'click'; }).slice(0, 2).map(ev));
    var visitor = opt.get('visitor') || {};
    var state = opt.get('state') || {};
    var active = [];
    try { active = state.getActiveExperimentIds(); } catch (e) { active = []; }
    var track = (window.__qpTrack || []).slice(0, 8).map(function (e) {
      return { name: e.name, apiName: e.apiName, type: e.type, category: e.category };
    });
    return JSON.stringify({
      measuredAt: new Date().toISOString(),
      url: location.origin + location.pathname,
      userAgent: navigator.userAgent,
      topKeys: Object.keys(data),
      counts: { experiments: experiments.length, audiences: audiences.length, pages: pages.length,
                events: events.length, campaigns: campaigns.length },
      experiments: first4,
      audiences: audiences.map(function (a) { return clean({ id: a.id, name: a.name, conditions: a.conditions }, 0); }),
      pages: outPages,
      events: outEvents,
      campaigns: camps,
      visitorCustom: clean(visitor.custom, 0),
      visitorKeys: Object.keys(visitor),
      stateFns: Object.keys(state).filter(function (k) { return typeof state[k] === 'function'; }),
      activeExperimentIds: clean(active, 0),
      trackEventsOnLoad: track
    });
  } catch (e) {
    return JSON.stringify({ error: String(e && e.message || e) });
  }
})()
"""

SURVEY_JS = r"""
(function () {
  try {
    var opt = window.optimizely;
    if (!opt || typeof opt.get !== 'function') return JSON.stringify({ error: 'window.optimizely.get is not available' });
    var data = opt.get('data');
    var raw = data.audiences, list = Array.isArray(raw) ? raw : Object.keys(raw || {}).map(function (k) { return raw[k]; });
    var types = {}, examples = {};
    function cut(v) { return typeof v === 'string' && v.length > 160 ? v.slice(0, 160) + '…' : v; }
    function walk(node, nots) {
      if (Array.isArray(node)) {
        var n = nots + (node[0] === 'not' ? 1 : 0);
        for (var i = 1; i < node.length; i++) walk(node[i], n);
        return;
      }
      if (node && typeof node === 'object' && node.type) {
        var key = String(node.type) + (nots % 2 === 1 ? '(not)' : '');
        types[key] = (types[key] || 0) + 1;
        if (!examples[key]) {
          examples[key] = { type: node.type, name: node.name === undefined ? null : cut(node.name),
                            value: node.value === undefined ? null : cut(node.value),
                            match: node.match === undefined ? null : node.match };
        }
      }
    }
    list.forEach(function (a) { if (a) walk(a.conditions, 0); });
    return JSON.stringify({ types: types, examples: examples, audiences: list.length });
  } catch (e) {
    return JSON.stringify({ error: String(e && e.message || e) });
  }
})()
"""


def goto(b, sess, url, settle=12, extra=15):
    b.send('Page.navigate', {'url': url}, session=sess)
    time.sleep(settle)
    end = time.time() + extra
    while time.time() < end:
        try:
            if b.ev(sess, READY_JS):
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


def main():
    prof = tempfile.mkdtemp(prefix='qp-measure-')
    b = Browser(['--remote-debugging-pipe', '--headless=new', '--no-first-run',
                 '--user-data-dir=' + prof, '--window-size=1440,900', 'about:blank'])
    try:
        tid = b.send('Target.createTarget', {'url': 'about:blank'})['targetId']
        sess = b.attach(tid)
        b.send('Page.enable', session=sess)
        shim_id = b.send('Page.addScriptToEvaluateOnNewDocument', {'source': QP_TRACK_SHIM}, session=sess)['identifier']
        b.send('Emulation.setDeviceMetricsOverride',
               {'width': 1440, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False}, session=sess)
        ready = goto(b, sess, MAIN_URL)
        print('main page optimizely ready:', ready)
        out = json.loads(b.ev(sess, MEASURE_JS))
        if 'error' in out:
            raise SystemExit('measure failed: ' + out['error'])
        # The shim pre-creates window.optimizely = [], which stops some sites' own loader from ever fetching the
        # snippet (measured on zapier.com: no cdn.optimizely.com request at all). Remove it before the survey.
        b.send('Page.removeScriptToEvaluateOnNewDocument', {'identifier': shim_id}, session=sess)
        survey = {}
        for u in SURVEY_URLS:
            site = u.split('//', 1)[1].split('/', 1)[0]
            ok = goto(b, sess, u, settle=8, extra=15)
            try:
                survey[site] = json.loads(b.ev(sess, SURVEY_JS))
            except Exception as e:
                survey[site] = {'error': str(e)}
            print('survey', site, 'ready=%s' % ok, json.dumps(survey[site].get('types', survey[site].get('error'))))
        out['leafSurvey'] = survey
        with open(OUT, 'w', encoding='utf8') as f:
            json.dump(out, f, indent=1, ensure_ascii=False)
            f.write('\n')
        print('wrote', OUT)
        print('counts', out['counts'], 'trackEventsOnLoad', len(out['trackEventsOnLoad']))
    finally:
        b.close()
        shutil.rmtree(prof, ignore_errors=True)


if __name__ == '__main__':
    main()
