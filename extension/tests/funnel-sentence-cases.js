// Synthetic Funnel Crawl segments, one per branch of fnStopSentence, shared by the
// suite that pins them and by whoever regenerates fixtures-funnel-sentences.json.
//
// WHY THIS EXISTS. fnStopSentence is the one sentence the funnel report and debug
// log carry for a failed hop, and its wording is built from evidence under four
// guards that must not be relaxed. It was extended so that a step or Prompt
// Function goal can reuse its branches, which touched six of its seven `${s.to}`
// sites. The only way to know a funnel sentence did not move is to compare every
// branch before and after, and the real fixtures (12 segments) reach only a
// handful of them. So each branch gets a segment here, and the sentence the
// BASELINE build produced for it is frozen in fixtures-funnel-sentences.json.
//
// Loaded with jsc's load(), so this defines one global and nothing else.
var FN_SENTENCE_CASES = (function () {
  var geom = { viewportW: 1000, viewportH: 800, imageW: 1000, imageH: 800, coordScaleX: 1, coordScaleY: 1 };
  function act(o) {
    return Object.assign({
      action: 'left_click', error: null, outOfRange: false, coordConverted: true, coordReason: 'scaled',
      delivered: true, deliveredTo: '#cta', mutations: 0, structuralMutations: 0,
      hit: { top: '#cta', stack: ['#cta'], coversPct: 1, interactive: true },
      page: { url: 'https://x.test/a', title: 'T', textLen: 100 }, modelMs: 2000, ms: 1500,
    }, o || {});
  }
  function acts(n, o) { var r = []; for (var i = 0; i < n; i++) r.push(act(o)); return r; }
  function seg(o) {
    return Object.assign({
      from: 'https://x.test/', to: 'https://x.test/end', reached: false, steps: 3, stopReason: null,
      apiStopReason: null, finalText: '', error: null, actions: [], geometry: geom, elapsedMs: 12000, blockedBy: null,
    }, o || {});
  }
  var banner = { top: '#onetrust-banner-sdk', stack: ['#onetrust-banner-sdk'], coversPct: 40, interactive: true,
                 chain: ['#onetrust-banner-sdk'], overlay: { brief: '#onetrust-banner-sdk', position: 'fixed', coversPct: 40 } };
  var c = {};
  c.reached = seg({ reached: true, stopReason: 'arrived', steps: 4 });
  c.notAttempted = seg({ stopReason: 'not-attempted', steps: 0 });
  c.userStopped = seg({ stopReason: 'user-stopped', steps: 2 });
  c.attachFailed = seg({ stopReason: 'attach-failed', steps: 0, error: 'Could not attach for crawl (is DevTools open?): boom' });
  c.apiError = seg({ stopReason: 'api-error', steps: 4, error: 'Failed to fetch' });
  c.exception = seg({ stopReason: 'exception', steps: 1, error: 'x is not defined' });
  c.modelTimeout = seg({ stopReason: 'model-timeout', steps: 2, error: 'The model did not respond within 90s' });
  c.actionTimeout = seg({ stopReason: 'action-timeout', steps: 2, error: 'The screenshot did not finish within 15s' });
  c.timeout = seg({ stopReason: 'timeout', steps: 5, elapsedMs: 300000, actions: acts(5, { modelMs: 40000, ms: 2000 }) });
  c.timeoutNoTimes = seg({ stopReason: 'timeout', steps: 5, elapsedMs: null, actions: [] });
  c.unconverted = seg({ stopReason: 'stuck', steps: 4, actions: acts(4, { coordConverted: false, coordReason: 'axes-disagree' }) });
  c.offViewport = seg({ stopReason: 'budget', steps: 4, actions: acts(4, { outOfRange: true }) });
  c.noop = seg({ stopReason: 'agent-stopped', steps: 3, actions: acts(3, { action: 'hover', error: 'Action "hover" is not implemented — nothing was dispatched.' }) });
  c.gateCaptcha = seg({ stopReason: 'agent-stopped', steps: 3, finalText: 'A reCAPTCHA blocks the path, so I am stopping here.' });
  c.gateLogin = seg({ stopReason: 'agent-stopped', steps: 3, finalText: 'This needs a login wall to be passed, which I will not attempt.' });
  c.gatePayment = seg({ stopReason: 'agent-stopped', steps: 3, finalText: 'The next step is to place the order, which would be a real transaction.' });
  c.maxTokens = seg({ stopReason: 'agent-stopped', steps: 2, apiStopReason: 'max_tokens' });
  c.refusal = seg({ stopReason: 'agent-stopped', steps: 2, apiStopReason: 'refusal', finalText: 'I cannot continue with this.' });
  c.stuckIframe = seg({ stopReason: 'stuck', steps: 6, actions: acts(6, { hit: { top: 'iframe', stack: ['iframe'], isIframe: true } }) });
  c.stuckNothing = seg({ stopReason: 'stuck', steps: 6, actions: acts(6, { hit: { top: null, stack: [], nothingAtPoint: true } }) });
  c.stuckDisabled = seg({ stopReason: 'stuck', steps: 6, actions: acts(6, { hit: { top: '#go', stack: ['#go'], disabled: true } }) });
  c.stuckIntercept = seg({ stopReason: 'stuck', steps: 6, actions: acts(6, { hit: banner, deliveredTo: '#other' }) });
  c.stuckOwnDismiss = seg({ stopReason: 'stuck', steps: 6, actions: acts(6, { hit: banner, deliveredTo: '#onetrust-banner-sdk' }) });
  c.stuckDelivered = seg({ stopReason: 'stuck', steps: 6, actions: acts(6, { delivered: true }) });
  c.stuckNotDelivered = seg({ stopReason: 'stuck', steps: 6, actions: acts(6, { delivered: false, deliveredTo: null }) });
  c.stuckUnknown = seg({ stopReason: 'stuck', steps: 6, actions: acts(6, { delivered: null, deliveredTo: null }) });
  c.coordSpace = seg({ stopReason: 'coord-space', steps: 3 });
  c.stuckReason = seg({ stopReason: 'stuck', steps: 6 });
  c.agentStopped = seg({ stopReason: 'agent-stopped', steps: 3, finalText: 'I could not find the next button.' });
  c.agentStoppedBare = seg({ stopReason: 'agent-stopped', steps: 3 });
  c.runaway = seg({ stopReason: 'runaway', steps: 500 });
  c.legacyBudget = seg({ stopReason: 'budget', steps: 10 });
  c.unknownReason = seg({ stopReason: 'something-new', steps: 2 });
  c.noReason = seg({ stopReason: null, steps: 2 });
  c.empty = {};
  return c;
})();
