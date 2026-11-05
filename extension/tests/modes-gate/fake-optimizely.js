(function () {
  // The synthetic Optimizely snippet for the modes gate (plan Appendix D.1/D.2). Everything here is invented.
  // With a tracking shim installed, window.optimizely may read undefined; the queue below is replayed into `api`.
  var q = Array.isArray(window.optimizely) ? window.optimizely : [];
  var qs = new URLSearchParams(location.search);
  var path = location.pathname;
  var query = {};
  qs.forEach(function (v, k) { query[k] = v; });
  var forced = (qs.get('optimizely_x') || '').split(',').filter(Boolean);
  function has(id) { return forced.indexOf(id) >= 0; }
  function store(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function setStore(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  var TARGETED = ['/itw/', '/itw-bad/', '/itw-covered/', '/itw/step2/'];
  function targeted(p) { return TARGETED.indexOf(p) >= 0; }
  function eligible(x) { return x.cro_mode === 'qa' && x.utm_source !== 'meta'; }   // utm_campaign is ignored: the deliberate bug

  function urlConds(paths) {
    return ['and', ['or'].concat(paths.map(function (p) { return { type: 'url', match: 'substring', value: p }; }))];
  }
  var DATA = {
    projectId: '700', revision: '1',
    experiments: {
      '7001': { id: '7001', name: 'QK-1 Quiz test', audienceIds: ['and', 'aud-qa', 'aud-nometa', 'aud-noimpact'],
                audienceName: 'QA, no meta, no impact',
                weightDistributions: [{ entityId: '7101', endOfRange: 5000 }, { entityId: '7102', endOfRange: 10000 }],
                experimentMetadata: { allocationPolicy: 'manual', layerId: 'c71' },
                variations: [{ id: '7101', name: 'v0: Control' }, { id: '7102', name: 'v1: Quiz' }] },
      '7201': { id: '7201', name: 'QK-2 Hero test', audienceIds: null, audienceName: 'Everyone else', weightDistributions: null,
                experimentMetadata: { allocationPolicy: 'manual', layerId: 'c72' },
                variations: [{ id: '7301', name: 'v0: Control' }, { id: '7302', name: 'v1: Hero' }] },
      '7202': { id: '7202', name: 'QK-LIVE Banner', audienceIds: null, audienceName: 'Everyone else', weightDistributions: null,
                experimentMetadata: { allocationPolicy: 'manual', layerId: 'c73' },
                variations: [{ id: '7401', name: 'Banner' }] }
    },
    audiences: {
      'aud-qa': { id: 'aud-qa', name: 'QA param', conditions: ['and', ['or', { type: 'query', name: 'cro_mode', value: 'qa', match: 'exact' }]] },
      'aud-nometa': { id: 'aud-nometa', name: 'No Meta', conditions: ['and', ['or', ['not', ['or', { type: 'query', name: 'utm_source', value: 'meta', match: 'exact' }]]]] },
      'aud-noimpact': { id: 'aud-noimpact', name: 'No Impact', conditions: ['and', ['or', ['not', ['or', { type: 'query', name: 'utm_campaign', value: 'impact', match: 'exact' }]]]] }
    },
    pages: {
      'p71': { id: 'p71', name: 'Quiz', apiName: '700_quiz', category: 'other', activationType: 'callback', staticConditions: urlConds(TARGETED) },
      'p72': { id: 'p72', name: 'Landing', apiName: '700_landing', category: 'other', activationType: null, staticConditions: urlConds(['/landing/']) },
      'p74': { id: 'p74', name: 'Responsive', apiName: '700_resp', category: 'other', activationType: null, staticConditions: urlConds(['/resp/', '/resp-live/']) },
      'p75': { id: 'p75', name: 'Live', apiName: '700_live', category: 'other', activationType: null, staticConditions: urlConds(['/resp-live/']) }
    },
    campaigns: {
      'c71': { id: 'c71', name: 'QK-1 Quiz test', holdback: 0, pageIds: ['p71', 'p72'], experiments: [{ id: '7001' }] },
      'c72': { id: 'c72', name: 'QK-2 Hero test', holdback: 0, pageIds: ['p74'], experiments: [{ id: '7201' }] },
      'c73': { id: 'c73', name: 'QK-LIVE Banner', holdback: 0, pageIds: ['p75'], experiments: [{ id: '7202' }] }
    },
    events: {},
    variations: {}
  };

  function vname(e, id) {
    var v = DATA.experiments[e].variations.filter(function (x) { return x.id === id; })[0];
    return v ? v.name : null;
  }
  var states = {};
  function setState(e, active, vid) {
    states[e] = { id: e, experimentName: DATA.experiments[e].name, isActive: !!active,
                  variation: active && vid ? { id: vid, name: vname(e, vid) } : null };
  }

  // 7001 (D.2)
  (function () {
    var vid = null;
    var fx = has('7101') ? '7101' : has('7102') ? '7102' : null;
    if (fx && targeted(path)) vid = fx;                                       // forced: audiences bypassed
    else if (path === '/landing/' && eligible(query)) vid = '7102';
    else if (targeted(path) && eligible(query) && (store('optimizely_qk_bucket_7001') || store('qk_quiz_progress'))) {
      vid = store('optimizely_qk_bucket_7001') || '7102';                      // the returning path
    }
    setState('7001', !!vid, vid);
  })();
  // 7201: active only when forced, on the responsive pages
  (function () {
    var on = (path === '/resp/' || path === '/resp-live/') && (has('7301') || has('7302'));
    setState('7201', on, on ? (has('7302') ? '7302' : '7301') : null);
  })();
  // 7202: active for every visitor on /resp-live/
  setState('7202', path === '/resp-live/', '7401');

  var listeners = [];
  var api = {
    get: function (k) {
      if (k === 'data') return DATA;
      if (k === 'visitor') return { custom: {} };
      if (k === 'state') return {
        getExperimentStates: function () { return states; },                    // read live: a trigger click changes it
        getVariationMap: function () { var m = {}; Object.keys(states).forEach(function (k2) { if (states[k2].variation) m[k2] = states[k2].variation; }); return m; },
        getActiveExperimentIds: function () { return Object.keys(states).filter(function (k2) { return states[k2].isActive; }); },
        getPageStates: function () { return {}; }
      };
      return null;
    },
    push: function (o) { if (o && o.type === 'addListener' && o.filter && o.filter.name === 'trackEvent' && typeof o.handler === 'function') listeners.push(o.handler); }
  };
  q.forEach(api.push);
  window.optimizely = api;

  function beacon(qstr) { try { new Image().src = '/beacon?' + qstr + '&_=' + Date.now(); } catch (_) {} }

  // The responsive pages: the forced Hero variation marks <html>.
  if (states['7201'].isActive && states['7201'].variation.id === '7302') document.documentElement.classList.add('v1');

  // #start-quiz and the cookie wall (D.2); the click handlers need the document, so they bind on DOMContentLoaded.
  function bind() {
    var btn = document.getElementById('start-quiz');
    if (btn) btn.addEventListener('click', function (ev) {
      beacon('hit=trigger&trusted=' + (ev.isTrusted ? '1' : '0'));
      if (ev.isTrusted && targeted(path) && eligible(query)) {
        setStore('optimizely_qk_bucket_7001', '7102');
        setStore('qk_quiz_progress', '1');
        setState('7001', true, '7102');
      }
    });
    var wall = document.getElementById('cookie-wall');
    if (wall) wall.addEventListener('click', function () { beacon('hit=overlay'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
