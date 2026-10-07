// Function Queue x Test Agent: the whole worker.
//
//   RUN:  cd extension/tests && jsc queue-agent.test.js
//   (jsc ships with macOS at
//    /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc)
//
// Unlike the other suites this one does not slice functions out of background.js:
// it runs the whole file as a service worker (queue-agent-harness.js) against a
// fake page and a scripted model, because what breaks in the queue's agent engine
// is the wiring between runQueue, crawlSegment, the console mirror and the Stop
// button, and none of that is a pure function. The pure verdicts and sentences are
// in vd-diff.test.js ("queue steps through the Test Agent").
//
// Each scenario is a fresh worker (its own module state), so every claim below is
// about a worker that has never seen another run. A second boot against the same
// storage is a worker restart.

load('queue-agent-harness.js');
['metric-match.js', 'pixelmatch.js', 'vd-config.js', 'vd-diff.js', 'figma.js'].forEach(function (f) { load('../' + f); });

var pass = 0, fail = 0, failures = [];
function ok(label, cond, detail) {
  if (cond) { pass++; return; }
  fail++; failures.push(label + (detail === undefined ? '' : '  -> ' + JSON.stringify(detail)));
}
function eq(label, actual, expected) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  fail++; failures.push(label + '  -> {"actual":' + a + ',"expected":' + e + '}');
}
function section(name) { print('  ' + name); }

var H = QA_HARNESS;

// ── fixtures ────────────────────────────────────────────────────────────────
// The saved selector (#old-cta) no longer exists; the control a visitor uses is
// #get-quote, which navigates. Everything else is added per scenario.
function shopPage(extra) {
  var page = H.makePage({ url: 'https://shop.example/', title: 'Shop', bodyText: 'Welcome to the shop' });
  page.add({ tag: 'button', id: 'get-quote', cls: ['btn-primary'], text: 'Get a quote', rect: { x: 100, y: 100, w: 200, h: 50 },
             onClick: function (p) { p.navigate('https://shop.example/quote?cro_mode=qa', 'Quote', 'Your quote is ready'); } });
  if (extra) extra(page);
  return page;
}
function world(opts, extra) {
  var w = H.makeWorld(Object.assign({ page: shopPage(extra) }, opts || {}));
  w.src = '../background.js';
  return w.boot();
}
function step(func, inputs, o) { return Object.assign({ func: func, enabled: true, delay: 0, inputs: inputs || {} }, o || {}); }
var OLD_CLICK = function () { return step('click', { method: 'css', selector: '#old-cta' }); };
var WAIT = function (s) { return step('wait_seconds', { seconds: String(s || 1) }); };
var statuses = function (rec) { return rec.steps.map(function (s) { return s.status; }).join(','); };
var cdp = function (w, name) { return w.calls.filter(function (c) { return c[0] === name; }).length; };
var attempts = function (w) { return cdp(w, 'attach'); };
// Every tool_use the model has been given an answer to must be answered in the
// NEXT user turn: an unanswered one is a 400 from the API.
function danglingToolUses(body) {
  var bad = [];
  var msgs = body.messages;
  for (var i = 0; i < msgs.length - 1; i++) {
    var m = msgs[i];
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    var uses = m.content.filter(function (b) { return b.type === 'tool_use'; }).map(function (b) { return b.id; });
    var next = msgs[i + 1];
    var answered = (Array.isArray(next.content) ? next.content : []).filter(function (b) { return b.type === 'tool_result'; }).map(function (b) { return b.tool_use_id; });
    uses.forEach(function (id) { if (answered.indexOf(id) === -1) bad.push(id); });
  }
  return bad;
}
var firstText = function (body) {
  var c = body.messages[0].content;
  return (Array.isArray(c) ? c.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n') : String(c));
};
var lastToolResultText = function (body) {
  var m = body.messages[body.messages.length - 1];
  return (Array.isArray(m.content) ? m.content : []).map(function (b) {
    return (Array.isArray(b.content) ? b.content : []).filter(function (x) { return x.type === 'text'; }).map(function (x) { return x.text; }).join(' ');
  }).join(' ');
};

// ════════════════════════════════════════════════════════════════════════════
section('classic engine: nothing changes');
(function () {
  var w = world();
  var page = w.page;
  page.add({ tag: 'button', id: 'old-cta', rect: { x: 400, y: 100, w: 100, h: 40 }, onClick: function (p) { p.navigate('https://shop.example/next', 'Next', 'next'); } });
  var r = w.run([step('click', { method: 'css', selector: '#old-cta' }), WAIT(1)]);
  ok('the run is accepted', r.response.res.ok === true);
  eq('every step passed', statuses(r.record), 'passed,passed');
  eq('  as a classic run', r.record.engine, 'classic');
  eq('  with nothing healed', r.record.healCount, 0);
  ok('  and no model call was made', w.requests.length === 0);
  ok('  and the page moved by its own selector', page.url === 'https://shop.example/next');
  ok('the record is written BEFORE `running` flips false (the panel builds its report on that flip)',
     (function () {
       var iRec = w.sets.indexOf('session:w1:queueRun');
       var iDone = w.sets.lastIndexOf('session:w1:running=false');
       return iRec !== -1 && iDone !== -1 && iRec < iDone;
     })(), w.sets);
  eq('the Console still reads as it always did', w.logs().filter(function (l) { return /^INFO (→|←|Complete|Started)/.test(l); }).length >= 3, true);
  w.restore();

  // MEASURED in Chrome 154: chrome.scripting.executeScript does not reject when the
  // injected function throws, so a step whose element does not exist has always
  // "passed" in Classic. That outcome is unchanged; it is no longer silent.
  var w2 = world();
  var r2 = w2.run([OLD_CLICK(), WAIT(1)], { engine: 'classic' });
  eq('Classic goes on after a step whose selector finds nothing, as it always did', statuses(r2.record), 'passed,passed');
  ok('  but says so now, as a warning, naming the selector', w2.logs().some(function (l) { return /^WARN ⚠ CSS selector not found: #old-cta — the step did nothing, and Classic goes on/.test(l); }), w2.logs());
  ok('  the run is not aborted', r2.record.aborted === false);
  ok('  and the Classic engine never asks the agent', w2.requests.length === 0);
  ok('  nor retries (that is only on the agent path)', w2.logs().filter(function (l) { return /^INFO → Click/.test(l); }).length === 1);
  w2.restore();

  // An error raised in the WORKER (not inside the page) does surface, and ends the run.
  var w2b = world();
  var r2b = w2b.run([step('click', { method: 'magic', selector: '#x' }), WAIT(1)], { engine: 'classic' });
  eq('an error the worker itself raises still fails the step and ends the run', statuses(r2b.record), 'failed,not-attempted');
  ok('  with the error that stopped it', /Unknown click method: magic/.test(r2b.record.steps[0].directError), r2b.record.steps[0].directError);
  ok('  and the run is marked aborted', r2b.record.aborted === true);
  ok('  and the failure reached the Console', w2b.logs().some(function (l) { return /^ERROR ✖ Click: Unknown click method: magic/.test(l); }));
  w2b.restore();

  var w3 = world();
  var r3 = w3.run([step('nope', {}), WAIT(1)]);
  eq('an unknown function is logged and the queue goes on, as it always did', statuses(r3.record), 'failed,passed');
  w3.restore();

  var w4 = world();
  var r4 = w4.run([step('click', { method: 'magic', selector: '#x' }), step('click', { method: 'css', selector: '#get-quote' }, { enabled: false }), WAIT(1)], {});
  eq('a disabled step is recorded as skipped', statuses(r4.record), 'failed,skipped,not-attempted');
  w4.restore();
})();

// ════════════════════════════════════════════════════════════════════════════
section('selector first: the agent is not asked while the script works');
(function () {
  var w = world({}, function (p) { p.add({ tag: 'button', id: 'old-cta', rect: { x: 400, y: 100, w: 100, h: 40 }, onClick: function (pg) { pg.navigate('https://shop.example/next', 'Next', 'n'); } }); });
  var r = w.run([step('click', { method: 'css', selector: '#old-cta' }), WAIT(1)], { engine: 'agent' });
  eq('a working step passes directly', statuses(r.record), 'passed,passed');
  eq('  as the agent engine', r.record.engine, 'agent');
  ok('  without one model call', w.requests.length === 0);
  eq('  and says it was direct', r.record.steps[0].engine, 'direct');
  w.restore();

  // An element that is merely late is not a heal.
  var w2 = world();
  w2.at(1500, function () { w2.page.add({ tag: 'button', id: 'old-cta', rect: { x: 400, y: 100, w: 100, h: 40 }, onClick: function (pg) { pg.navigate('https://shop.example/late', 'L', 'l'); } }); });
  var r2 = w2.run([OLD_CLICK(), WAIT(1)], { engine: 'agent' });
  eq('a step that passes on the retry is passed', statuses(r2.record), 'passed,passed');
  ok('  and no agent run was spent on it', w2.requests.length === 0);
  eq('  and it is still a direct step', r2.record.steps[0].engine, 'direct');
  ok('  having tried three times, a second apart', w2.logs().length > 0 && w2.page.url === 'https://shop.example/late');
  w2.restore();
})();

// ════════════════════════════════════════════════════════════════════════════
section('a heal: the agent takes over ONE step, inside the console mirror\'s session');
(function () {
  var w = world();
  w.replies = [w.click(200, 125, 'Clicking the Get a quote button.'), w.report('done', 'Clicked the Get a quote button.')];
  var r = w.run([OLD_CLICK(), WAIT(1)], { engine: 'agent' });
  var rec = r.record;
  eq('the broken step is healed and the next one runs', statuses(rec), 'healed,passed');
  eq('  as the agent engine', rec.engine, 'agent');
  eq('  one heal counted', rec.healCount, 1);
  ok('  and the run was not aborted', rec.aborted === false);
  eq('  the step says it was the agent', rec.steps[0].engine, 'agent-heal');
  ok('  and keeps what the script said was wrong', /CSS selector not found: #old-cta/.test(rec.steps[0].directError), rec.steps[0].directError);
  ok('  the page really went where the agent clicked', w.page.url === 'https://shop.example/quote?cro_mode=qa', w.page.url);

  // THE HAZARD. runQueue follows the tab, so the console mirror holds the one
  // debugger session; the agent has to use it and must never let go of it.
  eq('the mirror attached once, and the agent\'s own attach was refused', attempts(w), 2);
  eq('  the agent never detached (that would kill console capture for the rest of the run)', cdp(w, 'detach'), 0);
  ok('  so the mirror still holds the tab afterwards', w.held[1] === true);
  ok('  and the agent screenshotted over that session', cdp(w, 'Page.captureScreenshot') >= 2);
  ok('  and clicked over it', w.page.log.some(function (l) { return /^mouse@200,125->get-quote/.test(l); }), w.page.log);
  ok('  with the tab brought to the front first', w.tabUpdates.some(function (t) { return t && t.active === true; }));

  eq('two model calls: one action, one report', w.requests.length, 2);
  var tools = w.requests[0].tools.map(function (t) { return t.name; });
  eq('the agent is offered the computer AND the report tool', tools.join(','), 'computer,report_result');
  var t1 = firstText(w.requests[0]);
  ok('the goal names the selector that failed', t1.indexOf('"#old-cta"') !== -1, t1.slice(0, 400));
  ok('  says the lookup failed', /scripted lookup failed/.test(t1));
  ok('  names the step after it, as not the agent\'s', /Just after it, the script will do: "Wait \(seconds\)"/.test(t1) && /NOT yours to do/.test(t1), t1);
  ok('  and uses the heal prompt, not the funnel\'s', /ONE step/.test(t1) && t1.indexOf('Your task:') !== -1 && t1.indexOf('Your specific task: navigate') === -1);
  eq('no unanswered tool_use in what was sent', danglingToolUses(w.requests[1]).length, 0);
  eq('and the final report ended the loop without another call', w.requests.length, 2);

  var seg = rec.steps[0].segment;
  eq('the heal records what the agent aimed at', seg.actions[0].healTarget.selector, '#get-quote');
  eq('  its verdict', seg.verdict.status, 'healed');
  eq('  its own report', seg.report.summary, 'Clicked the Get a quote button.');
  eq('  how it ended', seg.stopReason, 'step-done');
  ok('  and that the step counted as reached', seg.reached === true);
  ok('the Console says the agent took over, then that it worked',
     w.logs().some(function (l) { return /^WARN ⟳ Click: .*CSS selector not found.*Test Agent is taking over/.test(l); })
     && w.logs().some(function (l) { return /^INFO ✔ Click \(agent\)/.test(l); }), w.logs());
  ok('  and shows each agent step', w.logs().some(function (l) { return /agent step 1: left_click \(200, 125\)/.test(l); }));
  ok('  and nothing typed ever reaches it', w.logs().every(function (l) { return l.indexOf('hunter2') === -1; }));
  var js = JSON.stringify(rec);
  ok('the stored record has no query string and no goal text', js.indexOf('cro_mode') === -1 && js.indexOf('scripted lookup') === -1, js.length);
  w.restore();
})();

// ════════════════════════════════════════════════════════════════════════════
section('a heal that cannot work stops the queue, says why, and does not pretend');
(function () {
  var w = world();
  w.replies = [w.report('could_not', 'There is no such button on this page.')];
  var r = w.run([OLD_CLICK(), WAIT(1)], { engine: 'agent' });
  eq('the step fails and the rest is not attempted', statuses(r.record), 'failed,not-attempted');
  ok('  the run is aborted', r.record.aborted === true);
  eq('  the agent was not asked to keep going', w.requests.length, 1);
  ok('  and the sentence calls it the agent\'s account, not a measurement', /its own account, not a measurement/.test(r.record.steps[0].segment.summary), r.record.steps[0].segment.summary);
  ok('  it reached the Console as an error', w.logs().some(function (l) { return /^ERROR ✖ Click:/.test(l); }));
  eq('  and the worker is free for the next run', w.send({ action: 'status' }).res.running, false);
  w.restore();

  var w2 = world();
  w2.replies = [w2.report('blocked', 'A CAPTCHA appeared.', 'captcha')];
  var r2 = w2.run([OLD_CLICK(), WAIT(1)], { engine: 'agent' });
  eq('a CAPTCHA is blocked, not failed', r2.record.steps[0].status, 'blocked');
  eq('  with the gate named', r2.record.steps[0].segment.blockedBy.gate, 'captcha');
  ok('  and the queue stops there', r2.record.aborted === true && r2.record.steps[1].status === 'not-attempted');
  w2.restore();

  // The agent says "done", but its click reached nothing at all: that is MEASURED,
  // so it is a failure and not a claim.
  var w3 = world();
  w3.replies = [w3.click(700, 700), w3.report('done', 'Clicked it.')];
  var r3 = w3.run([OLD_CLICK(), WAIT(1)], { engine: 'agent' });
  eq('a click no element received is a failed heal, whatever the agent said', r3.record.steps[0].status, 'failed');
  eq('  for that reason', r3.record.steps[0].segment.verdict.reason, 'click-not-delivered');
  ok('  and the queue stops', r3.record.aborted === true);
  w3.restore();

  // A click that reached an element but changed nothing: a claim, not a result.
  var w3b = world({}, function (p) { p.add({ tag: 'div', id: 'inert', rect: { x: 500, y: 500, w: 100, h: 40 } }); });
  w3b.replies = [w3b.click(520, 510), w3b.report('done', 'Clicked it.')];
  var r3b = w3b.run([OLD_CLICK(), WAIT(1)], { engine: 'agent' });
  eq('a click that landed but moved nothing is unverified, never healed', r3b.record.steps[0].status, 'healed-unverified');
  ok('  and the queue goes on, with the step flagged', statuses(r3b.record) === 'healed-unverified,passed', statuses(r3b.record));
  ok('  and the sentence says delivery is confirmable and intent is not', /intent is not/.test(r3b.record.steps[0].segment.summary), r3b.record.steps[0].segment.summary);
  w3b.restore();

  var w4 = world();
  w4.replies = [w4.say('I looked around but could not find it.')];
  var r4 = w4.run([OLD_CLICK(), WAIT(1)], { engine: 'agent' });
  eq('an agent that just stops talking, without reporting, fails the step', r4.record.steps[0].status, 'failed');
  eq('  as agent-stopped', r4.record.steps[0].segment.stopReason, 'agent-stopped');
  w4.restore();
})();

// ════════════════════════════════════════════════════════════════════════════
section('report_result ends the loop before anything else in the turn runs');
(function () {
  var w = world();
  // The model sends a click AND a report in one turn. The report wins, the click
  // is ignored, and nothing is left unanswered.
  w.replies = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', id: 'c1', name: 'computer', input: { action: 'left_click', coordinate: [200, 125] } },
    { type: 'tool_use', id: 'r1', name: 'report_result', input: { status: 'done', summary: 'did it' } },
  ] }];
  var r = w.run([OLD_CLICK(), WAIT(1)], { engine: 'agent' });
  eq('one call was made', w.requests.length, 1);
  ok('the click in the same turn was NOT dispatched', !w.page.log.some(function (l) { return /^mouse@/.test(l); }), w.page.log);
  eq('  so the step is unverified, not healed', r.record.steps[0].status, 'healed-unverified');
  ok('  and says nothing was measurable', /no click was recorded/.test(r.record.steps[0].segment.summary), r.record.steps[0].segment.summary);
  w.restore();

  // An unreadable report is a could_not.
  var w2 = world();
  w2.replies = [{ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'r2', name: 'report_result', input: { status: 'finished', summary: 'x' } }] }];
  var r2 = w2.run([OLD_CLICK(), WAIT(1)], { engine: 'agent' });
  eq('a status the tool does not know is a failure, not a guess', r2.record.steps[0].status, 'failed');
  w2.restore();
})();

// ════════════════════════════════════════════════════════════════════════════
section('only an error that proves nothing happened may start a heal');
(function () {
  var w = world({}, function (p) { p.add({ tag: 'button', id: 'old-cta', disabled: true, rect: { x: 400, y: 100, w: 100, h: 40 } }); });
  var r = w.run([OLD_CLICK(), WAIT(1)], { engine: 'agent' });
  eq('a disabled control is a finding, not a selector to heal', statuses(r.record), 'failed,not-attempted');
  ok('  so the agent was never asked', w.requests.length === 0);
  ok('  and the error is the real one', /Element is disabled/.test(r.record.steps[0].directError), r.record.steps[0].directError);
  w.restore();

  var w2 = world({}, function (p) { p.add({ tag: 'div', id: 'go', rect: { x: 400, y: 100, w: 100, h: 40 } }); });
  var r2 = w2.run([step('submit', { method: 'css', selector: '#go' }), WAIT(1)], { engine: 'agent' });
  eq('a submit with no form around it is the step\'s type, not a stale selector', r2.record.steps[0].status, 'failed');
  ok('  so the agent was never asked', w2.requests.length === 0, r2.record.steps[0].directError);
  w2.restore();

  var w3 = world();
  var r3 = w3.run([step('wait_seconds', { seconds: 'x' }), step('open_url', { url: '' })], { engine: 'agent' });
  ok('a step the agent may not take over is never healed', w3.requests.length === 0);
  w3.restore();

  // A step whose error LOOKS like a lookup failure but whose func is not on the
  // list: Trigger Metric clicks, then asserts, so a replacement click would leave
  // its assertion unmade.
  var w4 = world();
  var r4 = w4.run([step('trigger_metric', { method: 'css', selector: '#nope', metricId: '', metric: '', waitSeconds: '1' }), WAIT(1)], { engine: 'agent' });
  eq('Trigger Metric is not healed even though its click could not find its target', statuses(r4.record), 'failed,not-attempted');
  ok('  and the agent was never asked', w4.requests.length === 0);
  ok('  with a lookup error as the reason', /not found/.test(r4.record.steps[0].directError), r4.record.steps[0].directError);
  w4.restore();
})();

// ════════════════════════════════════════════════════════════════════════════
section('guards: the cap, the key, and one queue at a time');
(function () {
  // Six broken steps: the sixth is past the cap. Each heal's click goes to a NEW
  // page, so each one is measurably an effect (a click that navigates to the page it
  // is already on has nothing to measure).
  var hops = 0;
  var w = world({}, function (p) { p.find('#get-quote').onClick = function (pg) { pg.navigate('https://shop.example/q' + (++hops)); }; });
  for (var k = 0; k < 5; k++) { w.replies.push(w.click(200, 125)); w.replies.push(w.report('done', 'ok ' + k)); }
  var q = [];
  for (var i = 1; i <= 6; i++) q.push(step('click', { method: 'css', selector: '#gone-' + i }));
  var r = w.run(q, { engine: 'agent' });
  eq('five heals, then the sixth step fails as an ordinary failure', statuses(r.record), 'healed,healed,healed,healed,healed,failed');
  eq('  the heals are counted', r.record.healCount, 5);
  eq('  and only five agent runs were paid for', w.requests.length, 10);
  w.restore();

  var w2 = world({ apiKey: false });
  var r2 = w2.run([OLD_CLICK(), WAIT(1)], { engine: 'agent' });
  eq('with no API key the run behaves as Classic: the step goes on, saying so', statuses(r2.record), 'passed,passed');
  ok('  and says there is no key once, as a warning', w2.logs().filter(function (l) { return /^WARN Test Agent engine: no Anthropic API key/.test(l); }).length === 1, w2.logs());
  ok('  and says the step did nothing, as Classic does', w2.logs().some(function (l) { return /^WARN ⚠ CSS selector not found: #old-cta/.test(l); }));
  ok('  with no model call', w2.requests.length === 0);
  w2.restore();

  var w3 = world({ apiKey: false });
  var r3 = w3.run([WAIT(1), step('agent_prompt', { prompt: 'click the thing' })], { engine: 'agent' });
  eq('a queue with a Prompt Function and no key does nothing at all', statuses(r3.record), 'not-attempted,not-attempted');
  ok('  and says why', /API key/.test(r3.record.error || ''), r3.record.error);
  ok('  as an error in the Console', w3.logs().some(function (l) { return /^ERROR ✖ .*API key/.test(l); }));
  w3.restore();

  var w4 = world();
  var first = w4.send({ action: 'run', payload: { queue: [WAIT(5)], mode: 'close', targetTabId: 1, universalDelay: { enabled: false }, winId: 1, engine: 'classic' } });
  var second = w4.send({ action: 'run', payload: { queue: [WAIT(1)], mode: 'close', targetTabId: 1, universalDelay: { enabled: false }, winId: 1, engine: 'classic' } });
  ok('a second queue while one is running is refused', second.res && second.res.ok === false && /already running/.test(second.res.error), second.res);
  ok('  and the first was accepted', first.res && first.res.ok === true);
  w4.settle(function () { return w4.finished(); });
  var third = w4.run([WAIT(1)], {});
  eq('  and once it is over another is accepted', third.response.res.ok, true);
  w4.restore();

  // _runWin is persisted and restored across a worker restart. A guard built on it
  // would refuse every run until the browser was restarted.
  var w5 = world({ store: { session: { _wins: { run: 7, sr: null, pick: null, follow: {} } }, local: {}, sync: { anthropicApiKey: 'k' } } });
  // Any tab finishing a load restores it (the onUpdated listener calls restoreWins).
  w5.tabListeners.slice().forEach(function (fn) { fn(1, { status: 'complete' }, w5.tab); });
  drainMicrotasks();
  var r5 = w5.run([WAIT(1)], {});
  eq('a stale persisted run window does not refuse a run', r5.response.res.ok, true);
  eq('  and it ran', statuses(r5.record), 'passed');
  w5.restore();
})();

// ════════════════════════════════════════════════════════════════════════════
section('Stop in the middle of a heal');
(function () {
  var w = world();
  w.replies = [w.click(200, 125)];
  w.onRequest = function (body, n) { if (n === 1) w.send({ action: 'stop' }); };
  var r = w.run([OLD_CLICK(), WAIT(1)], { engine: 'agent' });
  eq('the step is stopped, not failed', r.record.steps[0].status, 'stopped');
  ok('  the run says it was stopped', r.record.stopped === true);
  ok('  and the later step never ran', r.record.steps[1].status === 'not-attempted');
  ok('  with no error in the Console for it', !w.logs().some(function (l) { return /^ERROR/.test(l); }), w.logs());
  ok('  and the Console ends on Stopped', w.logs()[w.logs().length - 1] === 'INFO Stopped', w.logs()[w.logs().length - 1]);
  eq('  the agent was not called again', w.requests.length, 1);
  w.restore();

  // A stop left over from an earlier funnel run must not end the next run's heal.
  var w2 = world();
  w2.send({ action: 'stop' });
  w2.replies = [w2.click(200, 125), w2.report('done', 'ok')];
  var r2 = w2.run([OLD_CLICK()], { engine: 'agent' });
  eq('a stale Stop does not kill the next run\'s first agent step', r2.record.steps[0].status, 'healed');
  w2.restore();
})();

// ════════════════════════════════════════════════════════════════════════════
section('heals of the other steps');
(function () {
  // fill: the field already holds text. Typing REPLACES it.
  var w = world({}, function (p) {
    p.add({ tag: 'input', id: 'email-field', type: 'text', value: 'old@example.com', rect: { x: 100, y: 200, w: 300, h: 30 } });
  });
  w.replies = [w.click(200, 215), w.type('qa@example.com'), w.report('done', 'Typed the email.')];
  var r = w.run([step('fill', { method: 'id', selector: 'email', text: 'qa@example.com' }), WAIT(1)], { engine: 'agent' });
  eq('a fill is healed when the field ends up holding exactly the step\'s text', r.record.steps[0].status, 'healed');
  eq('  the field holds the text, not old text plus new', w.page.find('#email-field').value, 'qa@example.com');
  eq('  the verdict rests on the read-back', r.record.steps[0].segment.verdict.reason, 'typed-exactly');
  var tAct = r.record.steps[0].segment.actions.filter(function (a) { return a.action === 'type'; })[0];
  eq('  which says the text landed, exactly', tAct.typed.landed + '/' + tAct.typed.match, 'true/exact');
  ok('  and the typed text is nowhere in the record', JSON.stringify(r.record).indexOf('qa@example.com') === -1);
  ok('the goal told the agent what to type, quoted', firstText(w.requests[0]).indexOf('"qa@example.com"') !== -1);
  w.restore();

  // fill: a field that swallows its input. Measured, so a failure.
  var w2 = world({}, function (p) { p.add({ tag: 'input', id: 'email-field', type: 'text', rejects: true, rect: { x: 100, y: 200, w: 300, h: 30 } }); });
  w2.replies = [w2.click(200, 215), w2.type('qa@example.com'), w2.report('done', 'Typed it.')];
  var r2 = w2.run([step('fill', { method: 'id', selector: 'email', text: 'qa@example.com' }), WAIT(1)], { engine: 'agent' });
  eq('typing that measurably went nowhere fails the step', r2.record.steps[0].status, 'failed');
  eq('  for that reason', r2.record.steps[0].segment.verdict.reason, 'typing-did-not-land');
  ok('  and the agent was TOLD, as an observation, on the next turn',
     w2.requests.some(function (b) { return /For information: after that typing, no element reported an input event and the focused field's value did not change/.test(lastToolResultText(b)); }));
  w2.restore();

  // fill: typed with nothing focused. Could not tell: never "failed".
  var w3 = world({}, function (p) { p.add({ tag: 'input', id: 'email-field', type: 'text', rect: { x: 100, y: 200, w: 300, h: 30 } }); });
  w3.replies = [w3.type('qa@example.com'), w3.report('done', 'Typed it.')];
  var r3 = w3.run([step('fill', { method: 'id', selector: 'email', text: 'qa@example.com' }), WAIT(1)], { engine: 'agent' });
  eq('typing with no field focused is unverified, not failed', r3.record.steps[0].status, 'healed-unverified');
  ok('  and the agent was NOT told it failed (null is not false)',
     !w3.requests.some(function (b) { return /no element reported an input event/.test(lastToolResultText(b)); }));
  w3.restore();

  // select_by_name: the native dropdown is set to the step's option, not a random one.
  var w4 = world({}, function (p) {
    p.add({ tag: 'select', id: 'yr', name: 'year', rect: { x: 100, y: 300, w: 200, h: 30 },
            options: [{ value: '', text: 'Age', disabled: false }, { value: '3', text: '3 years', disabled: false }, { value: '7', text: '7 years', disabled: false }, { value: '9', text: '9 years', disabled: false }], selectedIndex: 0 });
  });
  w4.replies = [w4.click(200, 315), w4.report('done', 'Chose 7 years.')];
  var r4 = w4.run([step('select_by_name', { name: 'petBirthYear', value: '7' }), WAIT(1)], { engine: 'agent' });
  eq('a dropdown step is healed by setting the option it names', r4.record.steps[0].status, 'healed');
  eq('  the select holds that option, not a random one', w4.page.find('#yr').value, '7');
  ok('  and the agent was told that is the option the step asks for', /That is the option this step asks for/.test(lastToolResultText(w4.requests[1])), lastToolResultText(w4.requests[1]));
  w4.restore();
})();

// ════════════════════════════════════════════════════════════════════════════
section('Prompt Function');
(function () {
  var promptStep = function (prompt, o) { return step('agent_prompt', { prompt: prompt }, o); };

  var w = world();
  w.replies = [w.click(200, 125, 'Opening the quote.'), w.report('done', 'Opened the quote page.')];
  var r = w.run([promptStep('Open the quote for the first product'), WAIT(1)], { engine: 'agent' });
  eq('a finished prompt is agent-reported, never passed: nothing measures what it asked for', statuses(r.record), 'done-agent-reported,passed');
  ok('  and the queue goes on', r.record.steps[1].status === 'passed' && r.record.aborted === false);
  ok('  with no Done-when check recorded', !('doneCheck' in r.record.steps[0]));
  eq('  as the agent', r.record.steps[0].engine, 'agent-prompt');
  eq('  named by its ordinal, not its words', r.record.steps[0].label, 'Prompt Function #1');
  var t1 = firstText(w.requests[0]);
  ok('  the agent was given the tester\'s words', /The tester's instruction: Open the quote for the first product/.test(t1), t1.slice(0, 300));
  ok('  and the prompt-function prompt, not the heal prompt', /A tester has written an instruction/.test(t1) && !/ONE step/.test(t1));
  eq('  with the report tool beside the computer', w.requests[0].tools.map(function (t) { return t.name; }).join(','), 'computer,report_result');
  w.restore();

  var w4 = world();
  w4.replies = [w4.report('blocked', 'This would place a real order.', 'payment')];
  var r4 = w4.run([promptStep('Complete the purchase'), WAIT(1)], { engine: 'agent' });
  eq('a prompt that would spend money is blocked, with the gate named', r4.record.steps[0].status + '/' + r4.record.steps[0].segment.blockedBy.gate, 'blocked/payment');
  ok('  and stops the queue', r4.record.aborted === true && r4.record.steps[1].status === 'not-attempted');
  w4.restore();

  var w5 = world();
  var r5 = w5.run([promptStep('   '), WAIT(1)], { engine: 'agent' });
  eq('an empty prompt fails before the agent is asked', r5.record.steps[0].status, 'failed');
  ok('  and says so', /needs a prompt/.test(r5.record.steps[0].directError), r5.record.steps[0].directError);
  ok('  with no model call', w5.requests.length === 0);
  w5.restore();

  // Nothing the tester wrote leaves the machine inside the record.
  var w6 = world();
  w6.replies = [w6.click(200, 125), w6.report('done', 'Done.')];
  var r6 = w6.run([promptStep('Log in with the password hunter2 then open the quote')], { engine: 'agent' });
  // The Console prints a step's args, as it always has; the RECORD is what is
  // exported, so that is what must be clean.
  var js6 = JSON.stringify(r6.record) + JSON.stringify(w6.store.session['w1:queueRun']);
  ok('the prompt and the page\'s query string are not in what is stored',
     js6.indexOf('hunter2') === -1 && js6.indexOf('cro_mode') === -1, js6.length);
  w6.restore();

  // Heals and prompts see the steps around them, skipping disabled ones.
  var w7 = world();
  w7.replies = [w7.click(200, 125), w7.report('done', 'ok')];
  var r7 = w7.run([step('wait_seconds', { seconds: '1' }), OLD_CLICK(), step('click', { method: 'css', selector: '#hidden-step' }, { enabled: false }),
                    step('fill', { method: 'id', selector: 'zip', text: '90210' })], { engine: 'agent' });
  var t7 = firstText(w7.requests[0]);
  ok('the context names the next ENABLED step', /"Fill Field · zip"/.test(t7), t7);
  ok('  and not a disabled one', t7.indexOf('#hidden-step') === -1);
  ok('  and what already passed', /"Wait \(seconds\)" \(passed\)/.test(t7), t7);
  w7.restore();
})();

// ════════════════════════════════════════════════════════════════════════════
section('Navigate to (Test Agent): the funnel\'s own goal, as a step');
(function () {
  var w = world();
  w.replies = [w.click(200, 125, 'Clicking the CTA.')];
  var r = w.run([step('agent_navigate', { url: 'https://shop.example/quote', notes: 'user qa / pass hunter2' })], { engine: 'agent' });
  eq('a Navigate step passes when the tab arrives (host and path; the page added ?cro_mode=qa)', statuses(r.record), 'passed');
  eq('  as the agent', r.record.steps[0].engine, 'agent-navigate');
  eq('  with the computer tool ONLY: a URL goal has no report', w.requests[0].tools.map(function (t) { return t.name; }).join(','), 'computer');
  var t1 = firstText(w.requests[0]);
  ok('  and the funnel prompt, unchanged', /Your specific task: navigate from "https:\/\/shop\.example\/" to "https:\/\/shop\.example\/quote"/.test(t1), t1.slice(t1.length - 300));
  ok('  carrying the tester\'s notes to the agent', t1.indexOf('Tester\'s notes:\nuser qa / pass hunter2') !== -1);
  ok('  and not into the record', JSON.stringify(r.record).indexOf('hunter2') === -1);
  eq('  nor the query string into its label', r.record.steps[0].label, 'Navigate to (Test Agent) · https://shop.example/quote');
  ok('  the agent used the console mirror\'s session and left it alone', cdp(w, 'detach') === 0 && w.held[1] === true);
  w.restore();

  var w2 = world();
  w2.replies = [w2.say('I cannot find a way to the quote page.')];
  var r2 = w2.run([step('agent_navigate', { url: 'https://shop.example/quote' }), WAIT(1)], { engine: 'agent' });
  eq('a Navigate step that does not arrive fails and stops the queue', statuses(r2.record), 'failed,not-attempted');
  w2.restore();

  var w3 = world();
  var r3 = w3.run([step('agent_navigate', { url: '' })], { engine: 'agent' });
  eq('a Navigate step with no URL fails before the agent is asked', r3.record.steps[0].status, 'failed');
  w3.restore();

  // It works in a "classic" run too: it has no classic form.
  var w4 = world();
  w4.replies = [w4.click(200, 125)];
  var r4 = w4.run([step('agent_navigate', { url: 'https://shop.example/quote' })], { engine: 'classic' });
  eq('a Navigate step runs even under the Classic engine', statuses(r4.record), 'passed');
  w4.restore();
})();

// ════════════════════════════════════════════════════════════════════════════
section('Funnel Crawl itself is untouched');
(function () {
  var w = world();
  w.replies = [w.click(200, 125, 'Clicking the CTA.')];
  var res = w.funnel(['https://shop.example/', 'https://shop.example/quote?cro_mode=qa']);
  ok('the crawl still reaches its End', res && res.ok === true && res.reachedEnd === true, res);
  eq('  offering the computer tool only', w.requests[0].tools.map(function (t) { return t.name; }).join(','), 'computer');
  var t1 = firstText(w.requests[0]);
  ok('  with the funnel prompt', /Your job is funnel crawling/.test(t1) && /Your specific task: navigate from/.test(t1));
  ok('  and no report instruction', t1.indexOf('report_result') === -1);
  eq('  attaching its own debugger on its own tab', cdp(w, 'attach'), 1);
  eq('  and detaching it afterwards', cdp(w, 'detach'), 1);
  ok('  recording a segment with no goal, report or verdict keys',
     res.segments[0] && !('goal' in res.segments[0]) && !('report' in res.segments[0]) && !('verdict' in res.segments[0]), Object.keys(res.segments[0] || {}));
  w.restore();
})();

// ════════════════════════════════════════════════════════════════════════════
section('the worker keeps itself alive, and lets go');
(function () {
  var w = world();
  var before = w.clock.timers.length;
  var r = w.run([WAIT(45)], {});
  ok('a long queue pings the worker so the MV3 idle timer does not end it',
     w.calls.filter(function (c) { return c[0] === 'getPlatformInfo'; }).length >= 2, w.calls.filter(function (c) { return c[0] === 'getPlatformInfo'; }).length);
  ok('  and the ping stops with the run', w.clock.timers.length === before, [before, w.clock.timers.length]);
  w.restore();

  // A Loop run has no end, so no record: it is stopped by hand.
  var w2 = world();
  w2.at(3000, function () { w2.send({ action: 'stop' }); });
  w2.send({ action: 'run', payload: { queue: [WAIT(1)], mode: 'loop', targetTabId: 1, universalDelay: { enabled: false }, winId: 1, engine: 'classic' } });
  w2.settle(function () { return w2.finished(); });
  ok('a Loop run writes no record', w2.session('queueRun') === undefined);
  ok('  and ends when stopped', w2.finished());
  w2.restore();
})();

// ── report ─────────────────────────────────────────────────────────────────
print('');
if (failures.length) {
  print('FAILURES:');
  failures.forEach(function (f) { print('  - ' + f); });
}
print('=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) throw new Error(fail + ' assertion(s) failed');
