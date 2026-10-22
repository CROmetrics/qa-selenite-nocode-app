(function () {
  // With QP_TRACK_SHIM installed, window.optimizely reads undefined here (the accessor holds nothing
  // yet), so q = []; the assignment below arms the listener on `api` (Step 6b).
  var q = Array.isArray(window.optimizely) ? window.optimizely : [];
  var qs = new URLSearchParams(location.search);
  var strict = location.pathname.indexOf('/shop-strict/') === 0;
  var live = location.pathname.indexOf('/shop-live/') === 0;   // QP-OTHER (9002) runs for every visitor there, as a launched test does
  var forced = (qs.get('optimizely_x') || '').split(',').filter(Boolean);
  var tracking = qs.get('optimizely_force_tracking') === 'true';
  var mobile = /iPhone|Android|Mobile/i.test(navigator.userAgent);
  var DATA = {
    projectId: '111', revision: '7',
    experiments: {
      '9001': { id: '9001', name: 'QP-1 Hero test', audienceIds: ['and', 'aud-qa', 'aud-nometa', 'aud-noimpact', 'aud-desktop'], audienceName: 'QA, no meta, no impact, desktop',
                weightDistributions: [{ entityId: '9101', endOfRange: 5000 }, { entityId: '9102', endOfRange: 10000 }],
                experimentMetadata: { allocationPolicy: 'manual', layerId: 'c1' }, variations: [{ id: '9101', name: 'v0: Control' }, { id: '9102', name: 'v1: Hero' }] },
      '9002': { id: '9002', name: 'QP-OTHER Live banner test', audienceIds: null, audienceName: 'Everyone else', weightDistributions: null,
                experimentMetadata: { allocationPolicy: 'manual', layerId: 'c2' }, variations: [{ id: '9201', name: 'Original' }, { id: '9202', name: 'Banner' }] },
      '9003': { id: '9003', name: 'QP-2 Softcoded promo', audienceIds: null, audienceName: 'Everyone else', weightDistributions: null,
                experimentMetadata: { allocationPolicy: 'manual', layerId: 'c3' }, variations: [{ id: '9301', name: 'Original' }] }
    },
    audiences: {
      'aud-qa': { id: 'aud-qa', name: '[QA] test cookie', conditions: ['and', ['or', ['or', { type: 'cookies', name: 'cro_mode', value: 'qa', match: 'exact' }], ['or', { type: 'query', name: 'cro_mode', value: 'qa', match: 'exact' }]]] },
      'aud-nometa': { id: 'aud-nometa', name: 'Exclude meta', conditions: ['and', ['or', ['not', ['or', { type: 'query', name: 'utm_source', value: 'meta', match: 'exact' }]]]] },
      'aud-noimpact': { id: 'aud-noimpact', name: 'Exclude impact', conditions: ['and', ['or', ['not', ['or', { type: 'query', name: 'utm_campaign', value: 'impact', match: 'exact' }]]]] },
      'aud-desktop': { id: 'aud-desktop', name: 'Desktop only', conditions: ['and', ['or', ['or', { type: 'device', name: null, value: 'desktop', match: null }]]] }
    },
    pages: { 'p1': { id: 'p1', name: 'Shop', apiName: '111_shop', category: 'other', staticConditions: ['and', ['or', { type: 'url', match: 'substring', value: '/shop' }]] } },
    // Real campaigns carry `experiments` (objects), not `experimentIds` (amended after chunk 1, log D-1.2); qpSnippetProbeFn derives the ids.
    campaigns: { 'c1': { id: 'c1', name: 'QP-1 Hero test', pageIds: ['p1'], experiments: [{ id: '9001' }] }, 'c2': { id: 'c2', name: 'QP-OTHER', pageIds: ['p1'], experiments: [{ id: '9002' }] }, 'c3': { id: 'c3', name: 'QP-2', pageIds: ['p1'], experiments: [{ id: '9003' }] } },
    events: {
      'e1': { id: 'e1', name: 'Hero CTA Click', apiName: 'hero_cta_click', eventType: 'click', category: 'other', pageId: 'p1', eventFilter: { filterType: 'target_selector', selector: '.hero-line' } },
      'e2': { id: 'e2', name: 'Purchase', apiName: 'purchase', eventType: 'custom', category: 'other', pageId: null, eventFilter: null }
    },
    variations: {}
  };
  // The deliberate D bug: utm_campaign=impact is NOT honoured.
  // /shop-strict/ serves the v1 variation (9102) only with optimizely_force_tracking=true;
  // Control (9101) is served without it, so only v1 takes the resize-sweep path there.
  var has9101 = forced.indexOf('9101') >= 0, has9102 = forced.indexOf('9102') >= 0;
  var a9001 = forced.length ? (has9101 || has9102) && (!strict || tracking || !has9102)
                            : (qs.get('cro_mode') === 'qa' && qs.get('utm_source') !== 'meta' && !mobile);
  var v9001 = a9001 ? (forced.indexOf('9102') >= 0 ? '9102' : '9101') : null;
  var a9002 = live || qs.get('cro_mode') === 'qa' || forced.indexOf('9201') >= 0 || forced.indexOf('9202') >= 0;
  var v9002 = a9002 ? (forced.indexOf('9202') >= 0 ? '9202' : '9201') : null;
  function vname(e, id) { var v = DATA.experiments[e].variations.filter(function (x) { return x.id === id; })[0]; return v ? v.name : null; }
  var states = {
    '9001': { id: '9001', experimentName: DATA.experiments['9001'].name, isActive: !!a9001, variation: v9001 ? { id: v9001, name: vname('9001', v9001) } : null },
    '9002': { id: '9002', experimentName: DATA.experiments['9002'].name, isActive: !!a9002, variation: v9002 ? { id: v9002, name: vname('9002', v9002) } : null }
  };
  var listeners = [];
  var api = {
    get: function (k) {
      if (k === 'data') return DATA;
      if (k === 'visitor') return { custom: { 'a1': { id: 'a1', name: 'qp_attr', value: 'x' } } };
      if (k === 'state') return {
        getExperimentStates: function () { return states; },
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
  function fire(d) { listeners.forEach(function (h) { try { h({ data: d }); } catch (_) {} }); }
  fire({ name: 'Shop', apiName: '111_shop', type: 'pageview', category: 'other', tags: {}, metrics: {} });
  if (v9001 === '9102') {
    document.documentElement.classList.add('v1');
    fire({ name: 'hero_cta_click', apiName: 'hero_cta_click', type: 'click', category: 'other', tags: {}, metrics: {} });   // the deliberate F bug
  }
})();
