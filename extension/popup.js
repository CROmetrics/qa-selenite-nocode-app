// Selenite popup logic

let FN_META = {};     // { funcName: { label, args } }
let steps = [];       // [{ id, enabled, func, delay, inputs }]
let nextId = 1;
let logData = [];
let filterLevel = null;
let bcLogData = [];
let bcFilterLevel = null;
let bcTagOnly = false;   // Browser Console "CRO" toggle: narrow the live mirror to [PjS]/[cro] tagged lines
let metrics = [];        // User-defined metric values (Build tab → Metrics), persisted in storage.local
let logOffset = 0;
let _wasRunning = false;

// The queue always starts with this function, which carries the target URL
// and its parameters. This first step cannot be removed or reassigned.
const OPEN_URL_FUNC = 'open_url';

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Load function metadata from background
  const res = await chrome.runtime.sendMessage({ action: 'getFunctions' });
  FN_META = res.functions;

  // Restore saved queue state. The first step is always the mandatory
  // "Open URL" step; seed it from the saved state if present, otherwise
  // create a fresh one.
  const { queueState } = await chrome.storage.session.get('queueState');
  const rest = [...(queueState || [])];
  const firstData = (rest[0]?.func === OPEN_URL_FUNC) ? rest.shift() : null;
  ensureOpenUrlFirst(firstData);
  rest.forEach(s => addStep(s));

  await refreshScripts();
  await syncLogs();
  await syncBcLogs();
  await syncBcStatus();
  await loadMetrics();

  // Poll for log updates and running state. Test Results and Browser Console
  // are polled independently so one panel's updates never block the other's.
  setInterval(syncLogs, 600);
  setInterval(syncBcLogs, 600);
  setInterval(syncBcStatus, 800);
  setInterval(syncRunState, 800);

  await loadUniversalDelay();
  await loadBcTagFilter();
  await restoreCaptureState();
  initAccordions();

  // Tab clicks
  document.querySelectorAll('.tab[data-tab]').forEach(t => {
    t.addEventListener('click', () => showTab(t.dataset.tab));
  });

  // Test Suites tab
  document.getElementById('btn-run-wcag')?.addEventListener('click', runWcagAudit);
  initSuiteTooltips();

  // Metrics section
  document.getElementById('btn-add-metric')?.addEventListener('click', () => addMetricRow());
  const metricList = document.getElementById('metric-list');
  metricList?.addEventListener('input', onMetricInput);
  metricList?.addEventListener('click', onMetricRemove);

  // Queue buttons
  document.getElementById('btn-add-step').addEventListener('click', () => addStep());
  document.getElementById('btn-clear-steps')?.addEventListener('click', clearSteps);
  document.getElementById('btn-run').addEventListener('click', runQueue);
  document.getElementById('btn-stop').addEventListener('click', stopQueue);

  // Script buttons
  document.getElementById('btn-save-script').addEventListener('click', saveScript);
  document.getElementById('btn-append-script')?.addEventListener('click', appendScripts);
  document.getElementById('btn-load-script').addEventListener('click', loadScript);
  document.getElementById('btn-delete-script').addEventListener('click', deleteScript);

  // Universal delay toggle + input
  document.getElementById('udel-enabled').addEventListener('change', saveUniversalDelay);
  document.getElementById('udel-seconds').addEventListener('input', saveUniversalDelay);

  // Console filter input
  document.getElementById('filter-input').addEventListener('input', renderLog);

  // Console filter buttons
  document.getElementById('fb-all').addEventListener('click',     function() { setFilter(null,      this); });
  document.getElementById('fb-info').addEventListener('click',    function() { setFilter('INFO',    this); });
  document.getElementById('fb-warn').addEventListener('click',    function() { setFilter('WARNING', this); });
  document.getElementById('fb-err').addEventListener('click',     function() { setFilter('ERROR',   this); });
  document.getElementById('fb-browser').addEventListener('click', function() { setFilter('BROWSER', this); });
  document.getElementById('btn-clear-log').addEventListener('click', clearLog);

  // Console subtabs
  document.querySelectorAll('.console-subtab').forEach(b => {
    b.addEventListener('click', () => showConsoleSubtab(b.dataset.subtab));
  });

  // Browser Console filter input/buttons
  document.getElementById('bc-filter-input')?.addEventListener('input', renderBcLog);
  document.getElementById('bcfb-all')?.addEventListener('click',  function() { setBcFilter(null,      this); });
  document.getElementById('bcfb-info')?.addEventListener('click', function() { setBcFilter('INFO',    this); });
  document.getElementById('bcfb-warn')?.addEventListener('click', function() { setBcFilter('WARNING', this); });
  document.getElementById('bcfb-err')?.addEventListener('click',  function() { setBcFilter('ERROR',   this); });
  document.getElementById('btn-clear-bc-log')?.addEventListener('click', clearBcLog);
  document.getElementById('bc-tag-filter-enabled')?.addEventListener('change', onBcTagFilterToggle);
  document.getElementById('bc-eval-input')?.addEventListener('keydown', onBcEvalKeydown);
  document.getElementById('bc-log-out')?.addEventListener('click', onBcLogClick);

  // Console capture toggle + tab selector
  document.getElementById('capture-enabled').addEventListener('change', onCaptureToggle);
  document.getElementById('capture-tab-select').addEventListener('change', () => {
    if (document.getElementById('capture-enabled').checked) onCaptureToggle();
  });
  document.getElementById('btn-refresh-tabs').addEventListener('click', loadTabList);
});

// ── Tabs ──────────────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab[data-tab]').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name)?.classList.add('active');
}

// ── Accordions ────────────────────────────────────────────────────────────
function toggleAccordion(id) {
  document.getElementById(id)?.classList.toggle('open');
}

function openAccordion(id) {
  document.getElementById(id)?.classList.add('open');
}

function initAccordions() {
  document.querySelectorAll('.acc-hdr[data-acc]').forEach(hdr => {
    hdr.addEventListener('click', () => toggleAccordion(hdr.dataset.acc));
  });
}

// ── Run state sync ────────────────────────────────────────────────────────
async function syncRunState() {
  const { running } = await chrome.storage.session.get('running');
  document.getElementById('btn-run').disabled  = !!running;
  document.getElementById('btn-stop').disabled = !running;
  document.getElementById('run-indicator').style.display = running ? 'inline-block' : 'none';

  if (running && !_wasRunning) {
    // Test just started — reset log view and update tab selector to show the test tab
    logData = [];
    document.getElementById('log-out').innerHTML = '';
    const { captureTabId } = await chrome.storage.session.get('captureTabId');
    if (captureTabId) {
      await loadTabList();
      const sel = document.getElementById('capture-tab-select');
      if (sel) sel.value = String(captureTabId);
      document.getElementById('capture-enabled').checked = true;
    }
  }
  _wasRunning = !!running;
}

// ── Log sync ──────────────────────────────────────────────────────────────
async function syncLogs() {
  const { logs = [] } = await chrome.storage.session.get('logs');
  if (logs.length > logData.length) {
    logData = logs;
    renderLog();
  }
}

function renderLog() {
  const needle = (document.getElementById('filter-input')?.value || '').trim().toLowerCase();
  const out = document.getElementById('log-out');
  if (!out) return;
  const atBottom = out.scrollHeight - out.scrollTop <= out.clientHeight + 4;
  out.innerHTML = logData
    .filter(e => (!filterLevel || e.level === filterLevel) && (!needle || e.text.toLowerCase().includes(needle)))
    .map(e => `<div class="log-${e.level}">[${e.ts}] [${e.level}] ${esc(e.text)}</div>`)
    .join('');
  if (atBottom) out.scrollTop = out.scrollHeight;
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setFilter(lv, btn) {
  filterLevel = lv;
  document.querySelectorAll('#filter-btns .btn-icon').forEach(b => {
    b.style.background = '';
    b.style.color = '';
  });
  btn.style.background = 'var(--brand)';
  btn.style.color = '#fff';
  renderLog();
}

// ── Browser Console (genuine live mirror, via chrome.debugger/CDP) ──────────
// Kept as a fully separate data stream/render cycle from the Test Results log
// above, so the two panels never clobber each other and update independently.
async function syncBcLogs() {
  const { browserConsoleLogs = [] } = await chrome.storage.session.get('browserConsoleLogs');
  if (browserConsoleLogs.length !== bcLogData.length) {
    bcLogData = browserConsoleLogs;
    renderBcLog();
  }
}

function renderBcLog() {
  const needle = (document.getElementById('bc-filter-input')?.value || '').trim().toLowerCase();
  const out = document.getElementById('bc-log-out');
  if (!out) return;
  const atBottom = out.scrollHeight - out.scrollTop <= out.clientHeight + 4;
  out.innerHTML = bcLogData
    .filter(e => (!bcFilterLevel || e.level === bcFilterLevel)
              && (!needle || e.text.toLowerCase().includes(needle))
              && (!bcTagOnly || e.tagged))
    .map(e => {
      const badge  = e.level === 'CMD' ? '&gt;' : (e.source === 'eval-result' ? '&#8626;' : e.level);
      const toggle = e.expandable ? `<button class="bc-expand-toggle" data-object-id="${e.objectId}">&#9656;</button>` : '';
      const { tag, rest } = splitBcTag(e.text);
      const tagHtml = tag ? `<span class="bc-tag">${esc(tag)}</span>` : '';
      return `<div class="bc-entry bc-${e.level}">
        <span class="bc-ts">${e.ts}</span>
        <span class="bc-badge">${badge}</span>
        ${toggle}
        ${tagHtml}
        <span class="bc-text">${esc(rest)}</span>
      </div>`;
    })
    .join('');
  if (atBottom) out.scrollTop = out.scrollHeight;
}

// Pulls a leading "[tag] " prefix (e.g. "[javascript]", "[network]", "[PJS]",
// "[cro]") off a log line's text so it renders as its own label instead of
// being embedded in the message text.
function splitBcTag(text) {
  const m = /^\[([^\]]+)\]\s*(.*)$/s.exec(text);
  return m ? { tag: m[1], rest: m[2] } : { tag: null, rest: text };
}

// Lazily expands object/array values via Runtime.getProperties (bcExpand).
// Delegated on #bc-log-out so it survives re-renders without re-binding.
// Note: a full renderBcLog() re-render (triggered by a *new* log line arriving)
// rebuilds innerHTML from bcLogData and does not preserve expanded state.
async function onBcLogClick(e) {
  const btn = e.target.closest('.bc-expand-toggle');
  if (!btn) return;
  const objectId = btn.dataset.objectId;
  // Nested (tiered) toggles live inside .bc-child-row, not .bc-entry — match
  // either so drilling into a second/third level of nesting works the same
  // way as the top level.
  const entryRow = btn.closest('.bc-entry, .bc-child-row');
  if (!entryRow) return;
  const existing = entryRow.nextElementSibling;
  if (existing && existing.classList.contains('bc-children') && existing.dataset.parentFor === objectId) {
    const nowHidden = existing.style.display === 'none';
    existing.style.display = nowHidden ? '' : 'none';
    btn.classList.toggle('bc-expanded', nowHidden);
    return;
  }
  btn.disabled = true;
  const res = await chrome.runtime.sendMessage({ action: 'bcExpand', objectId });
  btn.disabled = false;
  const container = document.createElement('div');
  container.className = 'bc-children';
  container.dataset.parentFor = objectId;
  if (!res?.ok) {
    container.innerHTML = `<div class="bc-child-row" style="color:var(--err)">${esc(res?.error || 'Could not expand')}</div>`;
  } else {
    btn.classList.add('bc-expanded');
    container.innerHTML = res.props.map(p => {
      const childToggle = p.expandable
        ? `<button class="bc-expand-toggle" data-object-id="${p.objectId}">&#9656;</button>`
        : '';
      return `<div class="bc-child-row">
        ${childToggle}
        <span class="bc-key">${esc(p.name)}:</span>
        <span class="bc-text">${esc(p.text)}</span>
      </div>`;
    }).join('') || '<div class="bc-child-row">(no own properties)</div>';
  }
  entryRow.insertAdjacentElement('afterend', container);
}

async function loadBcTagFilter() {
  const { bcTagFilterEnabled = false } = await chrome.storage.local.get('bcTagFilterEnabled');
  bcTagOnly = bcTagFilterEnabled;
  const chk = document.getElementById('bc-tag-filter-enabled');
  if (chk) chk.checked = bcTagOnly;
  renderBcLog();
}

async function onBcTagFilterToggle() {
  bcTagOnly = document.getElementById('bc-tag-filter-enabled').checked;
  await chrome.storage.local.set({ bcTagFilterEnabled: bcTagOnly });
  renderBcLog();
}

function setBcFilter(lv, btn) {
  bcFilterLevel = lv;
  document.querySelectorAll('#bc-filter-btns .btn-icon').forEach(b => {
    b.style.background = '';
    b.style.color = '';
  });
  btn.style.background = 'var(--brand)';
  btn.style.color = '#fff';
  renderBcLog();
}

async function clearBcLog() {
  bcLogData = [];
  await chrome.storage.session.set({ browserConsoleLogs: [] });
  document.getElementById('bc-log-out').innerHTML = '';
}

// ── Metrics (Build tab) ─────────────────────────────────────────────────────
// User-entered metric values — the strings that fire in the browser output,
// typically prefixed [PJS] or [cro] (the same values the Console tab's CRO
// toggle surfaces). Stored in storage.local as `metricsList`; a tracking
// mechanism consuming these is planned as follow-up work.
async function loadMetrics() {
  const { metricsList = [] } = await chrome.storage.local.get('metricsList');
  metrics = metricsList;
  renderMetrics();
  // The queue is restored before this runs — give any restored Track Metric
  // steps their dropdown options now that the list is in memory.
  refreshTrackMetricSteps();
}

function persistMetrics() {
  chrome.storage.local.set({ metricsList: metrics });
}

function renderMetrics() {
  const list = document.getElementById('metric-list');
  if (!list) return;
  const countEl = document.getElementById('metric-count');
  if (countEl) countEl.textContent = `${metrics.length} metric${metrics.length === 1 ? '' : 's'}`;

  if (!metrics.length) {
    list.innerHTML = '<div id="metrics-empty">No metrics yet — click + Add Metric to track a value</div>';
    return;
  }
  list.innerHTML = metrics.map((m, i) => `
    <div class="metric-row">
      <input type="text" data-metric-idx="${i}" placeholder="Metric value, e.g. Tagging: hero_cta_click" value="${esc(m).replace(/"/g, '&quot;')}">
      <button class="btn-icon" data-metric-remove="${i}" title="Remove metric">✕</button>
    </div>`).join('');
}

function addMetricRow() {
  metrics.push('');
  persistMetrics();
  renderMetrics();
  document.querySelector(`#metric-list input[data-metric-idx="${metrics.length - 1}"]`)?.focus();
}

// Delegated on #metric-list: typing updates in place (no re-render, so focus
// is preserved); the ✕ button removes the row. Track Metric steps in the
// queue mirror this list, so their dropdowns refresh on every change.
function onMetricInput(e) {
  const idx = e.target?.dataset?.metricIdx;
  if (idx === undefined) return;
  metrics[+idx] = e.target.value;
  persistMetrics();
  refreshTrackMetricSteps();
}

function onMetricRemove(e) {
  const btn = e.target.closest('[data-metric-remove]');
  if (!btn) return;
  metrics.splice(+btn.dataset.metricRemove, 1);
  persistMetrics();
  renderMetrics();
  refreshTrackMetricSteps();
}

async function syncBcStatus() {
  const { debuggerStatus } = await chrome.storage.session.get('debuggerStatus');
  const attached = !!debuggerStatus?.attached;
  const input = document.getElementById('bc-eval-input');
  if (input) {
    input.disabled = !attached;
    input.placeholder = attached ? '> Type a JS expression and press Enter…' : '> Not attached';
  }
  const el = document.getElementById('bc-status');
  if (!el) return;
  if (attached) {
    el.textContent = '● Live — mirroring the captured tab';
    el.style.color = 'var(--brand)';
  } else if (debuggerStatus?.error) {
    el.textContent = `○ Not attached — ${debuggerStatus.error}`;
    el.style.color = 'var(--err)';
  } else {
    el.textContent = '○ Not attached — enable Capture above';
    el.style.color = 'var(--fg3)';
  }
}

// ── Browser Console eval REPL (Runtime.evaluate over CDP) ───────────────────
let bcEvalHistory = [];
let bcEvalHistoryIdx = -1;

async function sendBcEval() {
  const input = document.getElementById('bc-eval-input');
  const expr = input.value.trim();
  if (!expr) return;
  bcEvalHistory.push(expr);
  bcEvalHistoryIdx = bcEvalHistory.length;
  input.value = '';
  await chrome.runtime.sendMessage({ action: 'bcEval', expression: expr });
  await syncBcLogs();
}

function onBcEvalKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendBcEval();
  } else if (e.key === 'ArrowUp' && bcEvalHistory.length) {
    e.preventDefault();
    bcEvalHistoryIdx = Math.max(0, bcEvalHistoryIdx - 1);
    e.target.value = bcEvalHistory[bcEvalHistoryIdx] || '';
  } else if (e.key === 'ArrowDown' && bcEvalHistory.length) {
    e.preventDefault();
    bcEvalHistoryIdx = Math.min(bcEvalHistory.length, bcEvalHistoryIdx + 1);
    e.target.value = bcEvalHistory[bcEvalHistoryIdx] || '';
  }
}

function showConsoleSubtab(name) {
  document.querySelectorAll('.console-subtab').forEach(b => {
    const active = b.dataset.subtab === name;
    b.style.background = active ? 'var(--brand)' : '';
    b.style.color = active ? '#fff' : '';
  });
  document.getElementById('subpanel-test-results')?.classList.toggle('active', name === 'test-results');
  document.getElementById('subpanel-browser-console')?.classList.toggle('active', name === 'browser-console');
}

// ── Console capture ───────────────────────────────────────────────────────
async function loadTabList() {
  const res = await chrome.runtime.sendMessage({ action: 'getTabs' });
  const tabs = res?.tabs || [];
  const sel = document.getElementById('capture-tab-select');
  if (!sel) return;
  const prevVal = sel.value;
  sel.innerHTML = tabs.length
    ? tabs.map(t => {
        const label = (t.title || t.url || 'Tab').substring(0, 50);
        return `<option value="${t.id}">${label}</option>`;
      }).join('')
    : '<option value="">No tabs available</option>';
  if (prevVal && [...sel.options].some(o => o.value === prevVal)) sel.value = prevVal;
}

async function restoreCaptureState() {
  await loadTabList();
  const { captureTabId } = await chrome.storage.session.get('captureTabId');
  const chk = document.getElementById('capture-enabled');
  if (chk) chk.checked = !!captureTabId;
  if (captureTabId) {
    const sel = document.getElementById('capture-tab-select');
    if (sel) sel.value = String(captureTabId);
  }
}

async function onCaptureToggle() {
  const enabled = document.getElementById('capture-enabled').checked;
  if (enabled) {
    const tabId = parseInt(document.getElementById('capture-tab-select').value);
    if (!tabId) { document.getElementById('capture-enabled').checked = false; return; }
    const res = await chrome.runtime.sendMessage({ action: 'startCapture', tabId });
    if (!res?.ok) {
      document.getElementById('capture-enabled').checked = false;
      alert('Could not inject console capture. Make sure the selected tab is a regular webpage.');
    } else if (res.debuggerError) {
      alert(`Test Results capture is active, but the full Browser Console mirror could not attach:\n${res.debuggerError}`);
    }
    await syncBcStatus();
  } else {
    await chrome.runtime.sendMessage({ action: 'stopCapture' });
  }
}

async function clearLog() {
  logData = [];
  logOffset = 0;
  await chrome.storage.session.set({ logs: [] });
  document.getElementById('log-out').innerHTML = '';
}

// ── Universal Delay ───────────────────────────────────────────────────────
function setUniversalDelayUI(enabled) {
  const row = document.getElementById('udel-row');
  if (!row) return;
  row.style.opacity       = enabled ? '1'    : '.4';
  row.style.pointerEvents = enabled ? 'auto' : 'none';
}

async function loadUniversalDelay() {
  const { universalDelay = { enabled: false, seconds: '1' } } =
    await chrome.storage.local.get('universalDelay');
  const chk = document.getElementById('udel-enabled');
  const inp = document.getElementById('udel-seconds');
  if (!chk) return;
  chk.checked = universalDelay.enabled;
  inp.value   = universalDelay.seconds;
  setUniversalDelayUI(universalDelay.enabled);
}

async function saveUniversalDelay() {
  const chk     = document.getElementById('udel-enabled');
  const inp     = document.getElementById('udel-seconds');
  const enabled = chk.checked;
  setUniversalDelayUI(enabled);
  await chrome.storage.local.set({
    universalDelay: { enabled, seconds: inp.value || '1' }
  });
}

// ── Target info (execution mode + tab target) ───────────────────────────────
// The target URL and its parameters now live on the mandatory leading
// "Open URL" queue step (see OPEN_URL_FUNC below) rather than here.
// Snapshot the current Target accordion so it can be persisted with a script.
function collectTarget() {
  return {
    mode:      document.querySelector('input[name=mode]:checked')?.value || 'close',
    tabTarget: document.querySelector('input[name=tabtarget]:checked')?.value || 'active',
  };
}

// Restore a saved target snapshot back into the Target accordion.
function applyTarget(target) {
  if (!target) return;
  if (target.mode) {
    const m = document.querySelector(`input[name=mode][value="${target.mode}"]`);
    if (m) m.checked = true;
  }
  if (target.tabTarget) {
    const t = document.querySelector(`input[name=tabtarget][value="${target.tabTarget}"]`);
    if (t) t.checked = true;
  }
}

// Saved scripts are stored either as a bare step array (legacy format) or as
// { steps, target } (current format). These normalize access across both.
function scriptSteps(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.steps)) return data.steps;
  return [];
}
function scriptTarget(data) {
  return (data && !Array.isArray(data) && data.target) ? data.target : null;
}

// ── Run / Stop ────────────────────────────────────────────────────────────
async function runQueue() {
  const mode       = document.querySelector('input[name=mode]:checked').value;
  const tabTarget  = document.querySelector('input[name=tabtarget]:checked').value;

  // Get the active tab id if needed
  let targetTabId = null;
  if (tabTarget === 'active') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    targetTabId = tab?.id || null;
  }

  const queue = steps.map(s => ({
    func: s.func, enabled: s.enabled, delay: s.delay, inputs: { ...s.inputs }
  }));

  const { universalDelay = { enabled: false, seconds: '1' } } =
    await chrome.storage.local.get('universalDelay');

  await chrome.runtime.sendMessage({
    action: 'run',
    payload: { queue, mode, targetTabId, universalDelay }
  });

  showTab('console');
  syncRunState();
}

async function stopQueue() {
  await chrome.runtime.sendMessage({ action: 'stop' });
}

// ── Scripts ───────────────────────────────────────────────────────────────
async function refreshScripts() {
  const { scripts = {} } = await chrome.storage.local.get('scripts');
  const names = Object.keys(scripts).sort();
  const sel = document.getElementById('script-select');
  sel.innerHTML = names.length
    ? names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')
    : '<option disabled>&lt;no scripts&gt;</option>';
}

// The single script name currently selected in the list, or '' if none.
function getSelectedScriptName() {
  const sel = document.getElementById('script-select');
  return sel.value || '';
}

async function saveScript() {
  const name = document.getElementById('save-name').value.trim();
  if (!name) { alert('Enter a script name.'); return; }
  const { scripts = {} } = await chrome.storage.local.get('scripts');
  scripts[name] = {
    steps: steps.map(s => ({
      func: s.func, enabled: s.enabled, delay: s.delay, inputs: { ...s.inputs }
    })),
    target: collectTarget(),
  };
  await chrome.storage.local.set({ scripts });
  await refreshScripts();
  document.getElementById('save-name').value = '';
  alert(`"${name}" saved.`);
}

// Append the selected script to the end of the current queue.
async function appendScripts() {
  const name = getSelectedScriptName();
  if (!name) { alert('Select a saved script first.'); return; }
  const { scripts = {} } = await chrome.storage.local.get('scripts');
  const stepArr = scriptSteps(scripts[name]);
  if (!stepArr.length) { alert('The selected script had no steps.'); return; }
  stepArr.forEach(s => addStep(s));
  openAccordion('acc-queue');
}

// Replace the current queue with the selected script.
async function loadScript() {
  const name = getSelectedScriptName();
  if (!name) { alert('Select a saved script first.'); return; }
  const { scripts = {} } = await chrome.storage.local.get('scripts');
  document.getElementById('step-list').innerHTML =
    '<div id="empty-msg">No steps yet — click + Add Step to begin</div>';
  steps = [];
  nextId = 1;
  const rest = [...scriptSteps(scripts[name])];
  const firstData = (rest[0]?.func === OPEN_URL_FUNC) ? rest.shift() : null;
  ensureOpenUrlFirst(firstData);
  rest.forEach(s => addStep(s));
  // Restore Target info saved with the script, if any.
  applyTarget(scriptTarget(scripts[name]));
  updateCount();
  persistQueue();
  openAccordion('acc-queue');
}

async function deleteScript() {
  const name = getSelectedScriptName();
  if (!name) return;
  if (!confirm(`Delete "${name}"?`)) return;
  const { scripts = {} } = await chrome.storage.local.get('scripts');
  delete scripts[name];
  await chrome.storage.local.set({ scripts });
  await refreshScripts();
}

// ── Queue steps ───────────────────────────────────────────────────────────
// opts.locked marks the mandatory leading "Open URL" step — it cannot be
// removed, reassigned to another function, or moved out of position 0.
function addStep(data, opts = {}) {
  const locked = !!opts.locked;
  const fnNames = Object.keys(FN_META).sort((a, b) =>
    (FN_META[a].label || a).localeCompare(FN_META[b].label || b)
  );
  const id   = nextId++;
  const func = locked ? OPEN_URL_FUNC : (data?.func || fnNames[0]);
  const step = {
    id,
    enabled: data?.enabled ?? true,
    func,
    delay:  data?.delay ?? '0',
    inputs: { ...(data?.inputs || {}) },
    locked,
  };
  steps.push(step);

  const el = document.createElement('div');
  el.className = 'step' + (locked ? ' step-locked' : '');
  el.id = 'step-' + id;
  el.innerHTML = buildStepHTML(step, fnNames);
  document.getElementById('step-list').appendChild(el);

  // Wire events
  if (!locked) {
    el.querySelector('.fn-select').addEventListener('change', e => {
      step.func = e.target.value;
      step.inputs = {};
      el.querySelector('.step-args').innerHTML = buildArgsHTML(step);
      el.querySelector('.step-tooltip-slot').innerHTML = buildTooltipHTML(step.func);
      wireArgs(el, step);
      persistQueue();
    });
    el.querySelector('.rm-btn').addEventListener('click', () => removeStep(id));
    el.querySelector('.up-btn').addEventListener('click', () => moveStep(id, -1));
    el.querySelector('.dn-btn').addEventListener('click', () => moveStep(id, 1));
    el.querySelector('.dup-btn').addEventListener('click', () => duplicateStep(id));
  }
  el.querySelector('.en-chk').addEventListener('change', e => {
    step.enabled = e.target.checked;
    persistQueue();
  });
  el.querySelector('.delay-in').addEventListener('input', e => {
    step.delay = e.target.value;
    persistQueue();
  });
  wireArgs(el, step);

  updateCount();
  persistQueue();
  return step;
}

// Guarantee the queue's first step is the locked "Open URL" step, seeding it
// with previously-saved data (if any). Must be called before any other
// addStep() calls populate the (currently empty) queue.
function ensureOpenUrlFirst(data) {
  return addStep(data, { locked: true });
}

function buildTooltipHTML(func) {
  const doc = FN_META[func]?.doc || '';
  if (!doc) return '';
  return `<span class="tooltip-wrap">
    <span class="tooltip-icon">ⓘ</span>
    <span class="tooltip-box">${esc(doc)}</span>
  </span>`;
}

function buildStepHTML(step, fnNames) {
  const locked = !!step.locked;

  const fnControl = locked
    ? `<span class="fn-locked" title="This step always runs first and can't be removed">🔒 ${esc(FN_META[step.func]?.label || step.func)}</span>`
    : `<select class="fn-select">${fnNames
        .map(n => `<option value="${n}"${n === step.func ? ' selected' : ''}>${FN_META[n]?.label || n}</option>`)
        .join('')}</select>`;

  const moveButtons = locked ? '' : `
      <button class="btn-icon up-btn" title="Move up">↑</button>
      <button class="btn-icon dn-btn" title="Move down">↓</button>`;

  const dupButton = locked ? '' : `<button class="btn-icon dup-btn" title="Duplicate">⧉</button>`;
  const rmButton  = locked ? '' : `<button class="btn-icon rm-btn" style="color:var(--err)" title="Remove">✕</button>`;

  return `
    <div class="step-ctrl">
      <input type="checkbox" class="en-chk"${step.enabled ? ' checked' : ''}>${moveButtons}
    </div>
    <div class="step-main">
      <div class="step-fn-row">
        ${fnControl}
        <span class="step-tooltip-slot">${buildTooltipHTML(step.func)}</span>
        ${dupButton}
        ${rmButton}
      </div>
      <div class="step-args">${buildArgsHTML(step)}</div>
      <div class="delay-row">
        <span class="arg-lbl">Delay (s)</span>
        <input type="text" class="delay-in" value="${step.delay || 0}">
      </div>
    </div>`;
}

// Args that benefit from the element picker
const PICKER_ARGS = new Set(['css', 'element_id', 'css_selector', 'xpath']);

// Method options for consolidated click/fill functions
const CLICK_METHODS = [
  { value: 'css',       label: 'CSS Selector', doc: 'Finds the element using a CSS selector string, e.g. `.btn-primary` or `#submit-btn`. Use the 🎯 picker to generate one automatically.' },
  { value: 'id',        label: 'ID',           doc: 'Finds the element by its `id` attribute — the fastest and most reliable method when an id is present.' },
  { value: 'name',      label: 'Name',         doc: 'Finds the element by its `name` attribute — commonly used on form inputs and buttons.' },
  { value: 'xpath',     label: 'XPath',        doc: 'Finds the element using an XPath expression — powerful and flexible, but more verbose than CSS.' },
  { value: 'link_text', label: 'Link Text',    doc: 'Finds an <a> link whose visible text exactly matches the value you enter.' },
];

const FILL_METHODS = [
  { value: 'css',   label: 'CSS Selector', doc: 'Finds the input using a CSS selector string, e.g. `input[name="email"]`. Use the 🎯 picker to generate one automatically.' },
  { value: 'id',    label: 'ID',           doc: 'Finds the input by its `id` attribute — the fastest and most reliable method when an id is present.' },
  { value: 'name',  label: 'Name',         doc: 'Finds the input by its `name` attribute — the most common way to target form fields.' },
  { value: 'xpath', label: 'XPath',        doc: 'Finds the input using an XPath expression — useful when no id or name is available.' },
];

const SUBMIT_METHODS = [
  { value: 'css',   label: 'CSS Selector', doc: 'Finds any element inside the form using a CSS selector, then submits that form.' },
  { value: 'id',    label: 'ID',           doc: 'Finds an element by its `id` inside the target form, then submits that form.' },
  { value: 'xpath', label: 'XPath',        doc: 'Finds an element using XPath inside the target form, then submits that form.' },
];

const SWITCH_TARGETS = [
  { value: 'frame',  label: 'Frame (by Name)',  hasValue: true,  doc: 'Switches the scripting context into an iframe identified by its name or id attribute.' },
  { value: 'main',   label: 'Main Page',         hasValue: false, doc: 'Returns to the top-level page context, exiting any active iframe.' },
  { value: 'parent', label: 'Parent Frame',      hasValue: false, doc: 'Moves up one level from a nested iframe to its parent frame.' },
  { value: 'window', label: 'Window (by Title)', hasValue: true,  doc: 'Switches focus to a different browser tab or window whose title matches the value.' },
];

const ALERT_ACTIONS = [
  { value: 'accept',   label: 'Accept (OK)',      doc: 'Clicks the OK button on a JavaScript alert, confirm, or prompt dialog.' },
  { value: 'dismiss',  label: 'Dismiss (Cancel)', doc: 'Clicks the Cancel button on a JavaScript confirm or prompt dialog.' },
  { value: 'get_text', label: 'Get Text',         doc: 'Logs the message text from the current alert dialog to the console.' },
];

// Build a tooltip for a sub-option select based on the currently selected value
function buildSubTooltipHTML(options, currentValue) {
  const opt = options.find(o => o.value === currentValue) || options[0];
  if (!opt?.doc) return '';
  return `<span class="tooltip-wrap">
    <span class="tooltip-icon">ⓘ</span>
    <span class="tooltip-box">${esc(opt.doc)}</span>
  </span>`;
}

function buildMethodArgsHTML(step, methods, hasText) {
  const method   = step.inputs.method   || methods[0].value;
  const selector = step.inputs.selector || '';
  const methodOpts = methods.map(m =>
    `<option value="${m.value}"${m.value === method ? ' selected' : ''}>${m.label}</option>`
  ).join('');
  const textRow = hasText ? `
    <div class="arg-row">
      <span class="arg-lbl">Text</span>
      <input type="text" data-arg="text" value="${esc(step.inputs.text || '')}">
    </div>` : '';
  return `
    <div class="arg-row">
      <span class="arg-lbl">Method</span>
      <select data-arg="method" class="method-select">${methodOpts}</select>
      <span class="sub-tooltip-slot">${buildSubTooltipHTML(methods, method)}</span>
    </div>
    <div class="arg-row">
      <span class="arg-lbl">Value</span>
      <input type="text" data-arg="selector" value="${esc(selector)}">
      <button class="btn-pick" data-pick-arg="selector" title="Pick element from page">&#x1F3AF;</button>
    </div>${textRow}`;
}

function buildSwitchArgsHTML(step) {
  const target     = step.inputs.target || 'frame';
  const value      = step.inputs.value  || '';
  const targetInfo = SWITCH_TARGETS.find(t => t.value === target) || SWITCH_TARGETS[0];
  const targetOpts = SWITCH_TARGETS.map(t =>
    `<option value="${t.value}"${t.value === target ? ' selected' : ''}>${t.label}</option>`
  ).join('');
  return `
    <div class="arg-row">
      <span class="arg-lbl">Target</span>
      <select data-arg="target" class="method-select">${targetOpts}</select>
      <span class="sub-tooltip-slot">${buildSubTooltipHTML(SWITCH_TARGETS, target)}</span>
    </div>
    <div class="arg-row switch-value-row" style="display:${targetInfo.hasValue ? 'flex' : 'none'}">
      <span class="arg-lbl">Name / Title</span>
      <input type="text" data-arg="value" value="${esc(value)}">
    </div>`;
}

function buildAlertArgsHTML(step) {
  const action     = step.inputs.action || 'accept';
  const actionOpts = ALERT_ACTIONS.map(a =>
    `<option value="${a.value}"${a.value === action ? ' selected' : ''}>${a.label}</option>`
  ).join('');
  return `
    <div class="arg-row">
      <span class="arg-lbl">Action</span>
      <select data-arg="action" class="method-select">${actionOpts}</select>
      <span class="sub-tooltip-slot">${buildSubTooltipHTML(ALERT_ACTIONS, action)}</span>
    </div>`;
}

// The mandatory leading step: URL to open first + its URL parameters.
// These previously lived in the Target accordion; they now travel with the
// queue (and with saved scripts) as this step's inputs.
function buildOpenUrlArgsHTML(step) {
  if (!Array.isArray(step.inputs.params)) {
    step.inputs.params = step.inputs.params ? [step.inputs.params] : [];
  }
  const params = step.inputs.params.length ? step.inputs.params : [''];
  const rows = params.map((v, i) => `
    <div class="arg-row open-url-param-row">
      <span class="arg-lbl">${i === 0 ? 'Params' : ''}</span>
      <input type="text" class="open-url-param-input" data-idx="${i}" placeholder="key=value" value="${esc(v)}">
      <button class="btn-icon rm-open-url-param" data-idx="${i}" title="Remove" style="color:var(--err)">✕</button>
    </div>`).join('');
  return `
    <div class="arg-row">
      <span class="arg-lbl">URL</span>
      <input type="text" data-arg="url" value="${esc(step.inputs.url || '')}" placeholder="https://example.com (optional — leave blank to use active tab)">
    </div>
    <div class="arg-row">
      <span class="arg-lbl">QA Mode</span>
      <label class="toggle-wrap" title="Append cro_mode=qa as a parameter on the executed URL">
        <input type="checkbox" class="qa-mode-chk"${step.inputs.qa_mode ? ' checked' : ''}>
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    </div>
    <div class="open-url-params">${rows}</div>
    <button class="btn ghost sm add-open-url-param" type="button" style="align-self:flex-start;margin:4px 0 0;padding:3px 8px;font-size:12px">+ Add parameter</button>`;
}

// Dropdown of the user-defined metric values from the Metrics section. A value
// saved on the step but since removed from the list is kept selectable so the
// step still shows (and runs with) what it was configured to track.
function buildTrackMetricArgsHTML(step) {
  const values  = metrics.map(m => m.trim()).filter(Boolean);
  const current = (step.inputs.metric || '').trim();
  if (current && !values.includes(current)) values.unshift(current);
  if (!values.length) {
    return '<div class="no-args">No metrics defined — add one in the Metrics section first</div>';
  }
  if (!current) step.inputs.metric = values[0];
  const opts = values.map(v =>
    `<option value="${esc(v).replace(/"/g, '&quot;')}"${v === step.inputs.metric ? ' selected' : ''}>${esc(v)}</option>`
  ).join('');
  return `
    <div class="arg-row">
      <span class="arg-lbl">Metric</span>
      <select data-arg="metric" class="method-select">${opts}</select>
    </div>`;
}

// Rebuild every Track Metric step's dropdown so it reflects the current
// Metrics list — called whenever that list changes.
function refreshTrackMetricSteps() {
  for (const step of steps) {
    if (step.func !== 'track_metric') continue;
    const el = document.getElementById('step-' + step.id);
    if (el) rerenderStepArgs(el, step);
  }
}

function buildArgsHTML(step) {
  if (step.func === 'click')          return buildMethodArgsHTML(step, CLICK_METHODS,  false);
  if (step.func === 'fill')           return buildMethodArgsHTML(step, FILL_METHODS,   true);
  if (step.func === 'submit')         return buildMethodArgsHTML(step, SUBMIT_METHODS, false);
  if (step.func === 'switch_to')      return buildSwitchArgsHTML(step);
  if (step.func === 'alert')          return buildAlertArgsHTML(step);
  if (step.func === 'track_metric')   return buildTrackMetricArgsHTML(step);
  if (step.func === OPEN_URL_FUNC)    return buildOpenUrlArgsHTML(step);

  const args = FN_META[step.func]?.args || [];
  if (!args.length) return '<div class="no-args">No arguments</div>';
  return args.map(a => {
    const pickBtn = PICKER_ARGS.has(a)
      ? `<button class="btn-pick" data-pick-arg="${a}" title="Pick element from page">&#x1F3AF;</button>`
      : '';
    return `
    <div class="arg-row">
      <span class="arg-lbl">${a}</span>
      <input type="text" data-arg="${a}" value="${esc(step.inputs[a] || '')}">
      ${pickBtn}
    </div>`;
  }).join('');
}

function wireArgs(el, step) {
  // Map each sub-select arg to its options list for tooltip updates
  const SUB_OPTION_MAP = {
    click:     { method:  CLICK_METHODS   },
    fill:      { method:  FILL_METHODS    },
    submit:    { method:  SUBMIT_METHODS  },
    switch_to: { target:  SWITCH_TARGETS  },
    alert:     { action:  ALERT_ACTIONS   },
  };

  el.querySelectorAll('[data-arg]').forEach(inp => {
    const isSelect = inp.tagName === 'SELECT';
    inp.addEventListener(isSelect ? 'change' : 'input', e => {
      step.inputs[inp.dataset.arg] = e.target.value;

      // Update sub-tooltip when a method/target/action select changes
      const subOpts = SUB_OPTION_MAP[step.func]?.[inp.dataset.arg];
      if (subOpts) {
        const slot = inp.closest('.arg-row')?.querySelector('.sub-tooltip-slot');
        if (slot) slot.innerHTML = buildSubTooltipHTML(subOpts, e.target.value);
      }

      // For switch_to: show/hide value row based on target selection
      if (step.func === 'switch_to' && inp.dataset.arg === 'target') {
        const info = SWITCH_TARGETS.find(t => t.value === e.target.value);
        const row  = el.querySelector('.switch-value-row');
        if (row) row.style.display = info?.hasValue ? 'flex' : 'none';
      }

      persistQueue();
    });
  });

  el.querySelectorAll('.btn-pick').forEach(btn => {
    const argName = btn.dataset.pickArg;
    const onResult = ['click', 'fill', 'submit'].includes(step.func) ? applyPickerToMethod : null;
    btn.addEventListener('click', () => startPicker(el, step, argName, onResult));
  });

  if (step.func === OPEN_URL_FUNC) wireOpenUrlArgs(el, step);
}

// Rebuild and rewire a step's argument area in place — used whenever the
// number of inputs changes (e.g. adding/removing a URL parameter row).
function rerenderStepArgs(el, step) {
  el.querySelector('.step-args').innerHTML = buildArgsHTML(step);
  wireArgs(el, step);
  persistQueue();
}

function wireOpenUrlArgs(el, step) {
  el.querySelector('.qa-mode-chk')?.addEventListener('change', e => {
    step.inputs.qa_mode = e.target.checked;
    persistQueue();
  });
  el.querySelectorAll('.open-url-param-input').forEach(inp => {
    inp.addEventListener('input', e => {
      step.inputs.params[Number(inp.dataset.idx)] = e.target.value;
      persistQueue();
    });
  });
  el.querySelectorAll('.rm-open-url-param').forEach(btn => {
    btn.addEventListener('click', () => {
      step.inputs.params.splice(Number(btn.dataset.idx), 1);
      rerenderStepArgs(el, step);
    });
  });
  el.querySelector('.add-open-url-param')?.addEventListener('click', () => {
    step.inputs.params.push('');
    rerenderStepArgs(el, step);
  });
}

// ── Element picker ────────────────────────────────────────────────────────────
let _pickerPoller = null;

async function startPicker(stepEl, step, argName, onResult) {
  await chrome.storage.session.remove('pickerResult');

  const btn = stepEl.querySelector(`.btn-pick[data-pick-arg="${argName}"]`);
  if (btn) { btn.textContent = '…'; btn.disabled = true; }

  const res = await chrome.runtime.sendMessage({ action: 'startPicker' });
  if (!res?.ok) {
    if (btn) { btn.textContent = '🎯'; btn.disabled = false; }
    alert('Could not inject picker. Make sure you are on a regular webpage (not a chrome:// page).');
    return;
  }

  _pickerPoller = setInterval(async () => {
    const { pickerResult } = await chrome.storage.session.get('pickerResult');
    if (!pickerResult) return;

    clearInterval(_pickerPoller);
    _pickerPoller = null;
    await chrome.storage.session.remove('pickerResult');

    if (btn) { btn.textContent = '🎯'; btn.disabled = false; }
    if (pickerResult.cancelled) return;

    if (onResult) {
      onResult(pickerResult.selector, stepEl, step);
    } else {
      const { selector } = pickerResult;
      const value = (argName === 'element_id' && selector.idValue)
        ? selector.idValue
        : selector.css;
      const inp = stepEl.querySelector(`[data-arg="${argName}"]`);
      if (inp) { inp.value = value; step.inputs[argName] = value; persistQueue(); }
    }
  }, 300);
}

function applyPickerToMethod(selector, stepEl, step) {
  const method = selector.idValue ? 'id' : 'css';
  const value  = selector.idValue || selector.css;
  step.inputs.method   = method;
  step.inputs.selector = value;
  const methodEl = stepEl.querySelector('[data-arg="method"]');
  const valueEl  = stepEl.querySelector('[data-arg="selector"]');
  if (methodEl) methodEl.value = method;
  if (valueEl)  valueEl.value  = value;
  persistQueue();
}

function removeStep(id) {
  const i = steps.findIndex(s => s.id === id);
  if (i < 0 || steps[i].locked) return;
  steps.splice(i, 1);
  document.getElementById('step-' + id)?.remove();
  updateCount();
  persistQueue();
}

function clearSteps() {
  const removable = steps.filter(s => !s.locked);
  if (!removable.length) return;
  if (!confirm(`Remove all ${removable.length} step${removable.length !== 1 ? 's' : ''} from the queue?`)) return;
  steps = steps.filter(s => s.locked);
  document.querySelectorAll('#step-list .step:not(.step-locked)').forEach(el => el.remove());
  updateCount();
  persistQueue();
}

function duplicateStep(id) {
  const i = steps.findIndex(s => s.id === id);
  if (i < 0) return;
  const src = steps[i];

  // Create the copy (deep-clone inputs so nested arrays/objects aren't shared).
  const copy = addStep({
    func:    src.func,
    enabled: src.enabled,
    delay:   src.delay,
    inputs:  structuredClone(src.inputs),
  });

  // addStep() appends to the end; move the copy to sit right after its source.
  const from = steps.length - 1;
  const to   = i + 1;
  if (to !== from) {
    steps.splice(from, 1);
    steps.splice(to, 0, copy);
    const srcEl = document.getElementById('step-' + id);
    const copyEl = document.getElementById('step-' + copy.id);
    srcEl.after(copyEl);
  }

  persistQueue();
}

function moveStep(id, dir) {
  const i = steps.findIndex(s => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= steps.length) return;
  if (steps[i].locked || steps[j].locked) return;
  [steps[i], steps[j]] = [steps[j], steps[i]];
  const list = document.getElementById('step-list');
  const all  = [...list.querySelectorAll('.step')];
  const a = all[i], b = all[j];
  if (dir < 0) list.insertBefore(a, b); else list.insertBefore(b, a);
  persistQueue();
}

function updateCount() {
  const n = steps.length;
  document.getElementById('step-count').textContent = n + ' step' + (n !== 1 ? 's' : '');
  const empty = document.getElementById('empty-msg');
  if (empty) empty.style.display = n ? 'none' : 'block';
}

function persistQueue() {
  chrome.storage.session.set({
    queueState: steps.map(s => ({
      func: s.func, enabled: s.enabled, delay: s.delay, inputs: { ...s.inputs }
    }))
  });
}

// ── Test Suites shared renderer ───────────────────────────────────────────────
function renderSuiteResults(containerId, results, order) {
  const el = document.getElementById(containerId);
  if (!el) return;

  let totalIssues = 0, totalChecks = 0, passed = 0;

  const rows = order
    .filter(k => results[k])
    .map(k => {
      const { label, issues, infoOnly } = results[k];
      const count = issues.length;
      totalChecks++;

      let dotCls, countLabel, isOpen;
      if (infoOnly) {
        // Informational only — never counts as a failure
        passed++;
        dotCls = 'a11y-info-dot';
        countLabel = 'Info';
        isOpen = count > 0;
      } else {
        totalIssues += count;
        if (count === 0) passed++;
        dotCls = count === 0 ? 'a11y-pass-dot' : 'a11y-fail-dot';
        countLabel = count === 0 ? 'Pass' : count + ' issue' + (count !== 1 ? 's' : '');
        isOpen = count > 0;
      }
      const body = count > 0
        ? issues.map(i => `<div class="a11y-issue">${esc(i)}</div>`).join('')
        : '';

      return `
        <div class="a11y-row${isOpen ? ' open' : ''}" data-suite-row>
          <div class="a11y-row-hdr">
            <span class="a11y-dot ${dotCls}"></span>
            <span class="a11y-row-label">${esc(label)}</span>
            <span class="a11y-count">${countLabel}</span>
            ${count > 0 ? '<span class="a11y-chevron">›</span>' : ''}
          </div>
          ${count > 0 ? `<div class="a11y-body">${body}</div>` : ''}
        </div>`;
    });

  const failed = totalChecks - passed;
  const summaryColor = failed === 0 ? 'var(--ok)' : 'var(--err)';
  const summaryText = failed === 0
    ? 'All checks passed'
    : `${totalIssues} issue${totalIssues !== 1 ? 's' : ''} across ${failed} check${failed !== 1 ? 's' : ''}`;

  el.innerHTML = `
    <div class="a11y-summary-bar">
      <span>${passed}/${totalChecks} checks passed</span>
      <div class="row" style="gap:8px">
        <span class="a11y-summary-total" style="color:${summaryColor}">${summaryText}</span>
        <button class="btn ghost btn-icon" data-clear-results title="Clear results">Clear</button>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px">${rows.join('')}</div>`;

  el.querySelectorAll('[data-suite-row] .a11y-row-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => hdr.closest('[data-suite-row]').classList.toggle('open'));
  });
  el.querySelector('[data-clear-results]')?.addEventListener('click', () => { el.innerHTML = ''; });
}

// ── Generic suite runner ──────────────────────────────────────────────────────
async function runSuiteAudit({ action, checkName, btnId, resultsId }) {
  const btn = document.getElementById(btnId);
  const resultsEl = document.getElementById(resultsId);
  if (!resultsEl) return;

  const checks = [...document.querySelectorAll(`input[name="${checkName}"]:checked`)]
    .map(cb => cb.value);

  if (!checks.length) {
    resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Select at least one check.</div>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Running…';
  resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Auditing page…</div>';

  try {
    const res = await chrome.runtime.sendMessage({ action, checks });
    if (!res?.ok) throw new Error(res?.error || 'Audit failed');
    renderSuiteResults(resultsId, res.results, checks);
    if (res.axeError) {
      const note = document.createElement('div');
      note.style.cssText = 'color:var(--fg3);font-size:11px;padding:6px 2px 0';
      note.textContent = 'Note: axe-core could not run on this page (' + res.axeError + '). Heuristic checks were used instead.';
      resultsEl.prepend(note);
    }
  } catch (e) {
    resultsEl.innerHTML = '<div style="color:var(--err);font-size:12px;padding:6px 0">Error: ' + esc(e.message) + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Audit';
  }
}

// ── Test Suites: per-criterion explanations (shown as hover tooltips) ─────────
const WCAG_INFO = {
  titles: 'Every page needs a unique, descriptive <title>. It is the first thing a screen reader announces and how users tell browser tabs and history entries apart. (WCAG 2.4.2)',
  navconsistency: 'Navigation, header, footer, and help links should stay in the same place with the same labels on every page, so users can rely on a consistent mental model. (WCAG 3.2.3, 3.2.4, 3.2.6)',
  multipleways: 'Offer at least two ways to reach content — e.g. a navigation menu plus site search or a sitemap — so users are not forced through a single path. (WCAG 2.4.5)',
  skiplink: 'A "skip to main content" link lets keyboard and screen-reader users jump past repeated navigation straight to the page’s main region. (WCAG 2.4.1)',
  keyboardpath: 'All functionality must be operable with the keyboard alone, and the tab/focus order must follow a logical sequence. Positive tabindex values break that order. (WCAG 2.1.1, 2.4.3)',
  modalescape: 'Users must never get trapped in a component. A modal or dialog should always be closable with a standard method such as the Escape key. (WCAG 2.1.2)',
  formerror: 'When a submission fails, the error must be clearly identified, described in text with a suggested fix, and announced to assistive technology. (WCAG 3.3.1, 3.3.3, 4.1.3)',
  sessiontiming: 'If a session can expire, warn the user before it does and let them extend it without losing any data they have entered. (WCAG 2.2.1, 2.2.6)',
  destructive: 'Actions with real consequences — delete, cancel, payment — should require explicit confirmation or be reversible, to prevent costly mistakes. (WCAG 3.3.4, 3.3.6)',
  linkpurpose: 'Link text should make sense on its own. Generic phrases like "click here" or "read more" are meaningless to someone scanning links out of context. (WCAG 2.4.4, 2.4.9)',
  formlabels: 'Every field needs a real, persistent label that is programmatically associated with it. Placeholder text disappears on input and does not count as a label. (WCAG 3.3.2, 1.3.1)',
  redundant: 'In a multi-step flow, do not make users re-enter information they already provided — auto-populate it or let them reuse it. (WCAG 3.3.7)',
  focusvis: 'A visible focus indicator must appear when an element is focused by keyboard, and must not be removed by CSS or hidden behind sticky headers or overlays. (WCAG 2.4.7, 2.4.11)',
  ariastate: 'Custom widgets (accordions, tabs, dropdowns, toggles) must expose and update their state — e.g. aria-expanded or aria-selected — so assistive tech knows what happened. (WCAG 4.1.2)',
  contrast: 'Text and meaningful UI elements need enough contrast against their background: 4.5:1 for normal text, 3:1 for large text and non-text elements. (WCAG 1.4.3, 1.4.11)',
  reflow: 'Content must reflow into a single column and stay usable at 400% zoom or a 320px-wide viewport, without forcing two-dimensional scrolling. (WCAG 1.4.10, 1.4.4)',
  motion: 'Nothing should flash more than three times per second, and any auto-playing motion must be pausable, stoppable, or hideable. (WCAG 2.2.2, 2.3.1)',
  screenreader: 'Assistive tech must be able to announce each element’s name, role, and state, plus dynamic status updates — via alt text, accessible names, and live regions. (WCAG 1.1.1, 4.1.2, 4.1.3)',
  realworld: 'A holistic check: using only a keyboard or a screen reader, can someone actually complete the key tasks (sign up, checkout, find content) without excessive friction? (cross-cutting)'
};

// Attach an info tooltip to every WCAG audit criterion. Sourced from one map so
// the popup and side panel stay in sync. Flips up/down to avoid clipping in the
// scrollable panel.
function initSuiteTooltips() {
  const scroller = document.getElementById('panels');
  document.querySelectorAll('input[name="wcag-check"]').forEach(cb => {
    const label = cb.closest('.suite-check');
    const text = WCAG_INFO[cb.value];
    if (!label || !text || label.querySelector('.tooltip-wrap')) return;

    const wrap = document.createElement('span');
    wrap.className = 'tooltip-wrap';
    wrap.style.marginLeft = 'auto';

    const icon = document.createElement('span');
    icon.className = 'tooltip-icon';
    icon.textContent = 'ⓘ';
    icon.setAttribute('aria-label', 'What this checks');

    const box = document.createElement('span');
    box.className = 'tooltip-box';
    box.textContent = text;

    wrap.appendChild(icon);
    wrap.appendChild(box);
    label.appendChild(wrap);

    // Clicking the icon shouldn't toggle the checkbox it lives inside.
    wrap.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });

    // Open downward when there isn't room above within the scroll container.
    wrap.addEventListener('mouseenter', () => {
      const top = (scroller || document.documentElement).getBoundingClientRect().top;
      box.classList.toggle('tt-down', wrap.getBoundingClientRect().top - top < 140);
    });
  });
}

// ── Test Suites: WCAG 2.2 audit ───────────────────────────────────────────────
function runWcagAudit() {
  return runSuiteAudit({ action: 'runWcagAudit', checkName: 'wcag-check', btnId: 'btn-run-wcag', resultsId: 'wcag-results' });
}
