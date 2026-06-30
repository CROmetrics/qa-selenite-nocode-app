// Selenite popup logic

let FN_META = {};     // { funcName: { label, args } }
let steps = [];       // [{ id, enabled, func, delay, inputs }]
let nextId = 1;
let logData = [];
let filterLevel = null;
let logOffset = 0;
let _wasRunning = false;

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Load function metadata from background
  const res = await chrome.runtime.sendMessage({ action: 'getFunctions' });
  FN_META = res.functions;

  // Restore saved queue state
  const { queueState } = await chrome.storage.session.get('queueState');
  if (queueState?.length) queueState.forEach(s => addStep(s));

  await refreshScripts();
  await syncLogs();

  // Poll for log updates and running state
  setInterval(syncLogs, 600);
  setInterval(syncRunState, 800);

  await loadUniversalDelay();
  await restoreCaptureState();
  initAccordions();

  // Tab clicks
  document.querySelectorAll('.tab[data-tab]').forEach(t => {
    t.addEventListener('click', () => showTab(t.dataset.tab));
  });

  // Test Suites tab
  document.getElementById('btn-run-a11y')?.addEventListener('click', runA11yAudit);
  document.getElementById('btn-run-conv')?.addEventListener('click', runConversionAudit);
  document.getElementById('btn-run-content')?.addEventListener('click', runContentAudit);

  // Queue buttons
  document.getElementById('btn-add-step').addEventListener('click', () => addStep());
  document.getElementById('btn-run').addEventListener('click', runQueue);
  document.getElementById('btn-stop').addEventListener('click', stopQueue);

  // Script buttons
  document.getElementById('btn-save-script').addEventListener('click', saveScript);
  document.getElementById('btn-load-script').addEventListener('click', loadScript);
  document.getElementById('btn-delete-script').addEventListener('click', deleteScript);

  // URL parameter fields
  if (document.getElementById('param-list')) addParamField();
  document.getElementById('btn-add-param')?.addEventListener('click', () => addParamField());

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
    }
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

// ── URL parameters ────────────────────────────────────────────────────────
function addParamField(value = '') {
  const list = document.getElementById('param-list');
  const row  = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;align-items:center';
  row.innerHTML = `
    <input type="text" class="url-param-input" placeholder="key=value" value="${esc(value)}"
      style="flex:1">
    <button class="btn-icon rm-param" title="Remove" style="color:var(--err);flex-shrink:0">✕</button>`;
  row.querySelector('.rm-param').addEventListener('click', () => {
    row.remove();
    if (!document.querySelectorAll('.url-param-input').length) addParamField();
  });
  list.appendChild(row);
}

function collectParams() {
  return [...document.querySelectorAll('.url-param-input')]
    .map(i => i.value.trim())
    .filter(Boolean);
}

// ── Run / Stop ────────────────────────────────────────────────────────────
async function runQueue() {
  let url         = document.getElementById('url-input').value.trim();
  const paramParts = collectParams();
  if (url && paramParts.length) {
    const sep = url.includes('?') ? '&' : '?';
    url = url + sep + paramParts.join('&');
  }
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
    payload: { url, queue, mode, targetTabId, universalDelay }
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
    ? names.map(n => `<option value="${n}">${n}</option>`).join('')
    : '<option>&lt;no scripts&gt;</option>';
}

async function saveScript() {
  const name = document.getElementById('save-name').value.trim();
  if (!name) { alert('Enter a script name.'); return; }
  const { scripts = {} } = await chrome.storage.local.get('scripts');
  scripts[name] = steps.map(s => ({
    func: s.func, enabled: s.enabled, delay: s.delay, inputs: { ...s.inputs }
  }));
  await chrome.storage.local.set({ scripts });
  await refreshScripts();
  document.getElementById('save-name').value = '';
  alert(`"${name}" saved.`);
}

async function loadScript() {
  const name = document.getElementById('script-select').value;
  if (!name || name === '<no scripts>') return;
  const { scripts = {} } = await chrome.storage.local.get('scripts');
  const data = scripts[name];
  if (!data) { alert(`Script "${name}" not found.`); return; }
  document.getElementById('step-list').innerHTML = '';
  steps = [];
  nextId = 1;
  data.forEach(s => addStep(s));
  openAccordion('acc-queue');
}

async function deleteScript() {
  const name = document.getElementById('script-select').value;
  if (!name || name === '<no scripts>') return;
  if (!confirm(`Delete "${name}"?`)) return;
  const { scripts = {} } = await chrome.storage.local.get('scripts');
  delete scripts[name];
  await chrome.storage.local.set({ scripts });
  await refreshScripts();
}

// ── Queue steps ───────────────────────────────────────────────────────────
function addStep(data) {
  const fnNames = Object.keys(FN_META).sort((a, b) =>
    (FN_META[a].label || a).localeCompare(FN_META[b].label || b)
  );
  const id   = nextId++;
  const func = data?.func || fnNames[0];
  const step = {
    id,
    enabled: data?.enabled ?? true,
    func,
    delay:  data?.delay ?? '0',
    inputs: { ...(data?.inputs || {}) },
  };
  steps.push(step);

  const el = document.createElement('div');
  el.className = 'step';
  el.id = 'step-' + id;
  el.innerHTML = buildStepHTML(step, fnNames);
  document.getElementById('step-list').appendChild(el);

  // Wire events
  el.querySelector('.fn-select').addEventListener('change', e => {
    step.func = e.target.value;
    step.inputs = {};
    el.querySelector('.step-args').innerHTML = buildArgsHTML(step);
    el.querySelector('.step-tooltip-slot').innerHTML = buildTooltipHTML(step.func);
    wireArgs(el, step);
    persistQueue();
  });
  el.querySelector('.en-chk').addEventListener('change', e => {
    step.enabled = e.target.checked;
    persistQueue();
  });
  el.querySelector('.delay-in').addEventListener('input', e => {
    step.delay = e.target.value;
    persistQueue();
  });
  el.querySelector('.rm-btn').addEventListener('click', () => removeStep(id));
  el.querySelector('.up-btn').addEventListener('click', () => moveStep(id, -1));
  el.querySelector('.dn-btn').addEventListener('click', () => moveStep(id, 1));
  wireArgs(el, step);

  updateCount();
  persistQueue();
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
  const opts = fnNames
    .map(n => `<option value="${n}"${n === step.func ? ' selected' : ''}>${FN_META[n]?.label || n}</option>`)
    .join('');
  return `
    <div class="step-ctrl">
      <input type="checkbox" class="en-chk"${step.enabled ? ' checked' : ''}>
      <button class="btn-icon up-btn" title="Move up">↑</button>
      <button class="btn-icon dn-btn" title="Move down">↓</button>
    </div>
    <div class="step-main">
      <div class="step-fn-row">
        <select class="fn-select">${opts}</select>
        <span class="step-tooltip-slot">${buildTooltipHTML(step.func)}</span>
        <button class="btn-icon rm-btn" style="color:var(--err)" title="Remove">✕</button>
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

function buildArgsHTML(step) {
  if (step.func === 'click')     return buildMethodArgsHTML(step, CLICK_METHODS,  false);
  if (step.func === 'fill')      return buildMethodArgsHTML(step, FILL_METHODS,   true);
  if (step.func === 'submit')    return buildMethodArgsHTML(step, SUBMIT_METHODS, false);
  if (step.func === 'switch_to') return buildSwitchArgsHTML(step);
  if (step.func === 'alert')     return buildAlertArgsHTML(step);

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
  if (i >= 0) steps.splice(i, 1);
  document.getElementById('step-' + id)?.remove();
  updateCount();
  persistQueue();
}

function moveStep(id, dir) {
  const i = steps.findIndex(s => s.id === id);
  const j = i + dir;
  if (j < 0 || j >= steps.length) return;
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

// ── Test Suites: Accessibility audit ─────────────────────────────────────────
async function runA11yAudit() {
  const btn = document.getElementById('btn-run-a11y');
  const resultsEl = document.getElementById('a11y-results');
  if (!resultsEl) return;

  const checks = [...document.querySelectorAll('input[name="a11y-check"]:checked')]
    .map(cb => cb.value);

  if (!checks.length) {
    resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Select at least one check.</div>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Running…';
  resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Auditing page…</div>';

  try {
    const res = await chrome.runtime.sendMessage({ action: 'runA11yAudit', checks });
    if (!res?.ok) throw new Error(res?.error || 'Audit failed');
    renderA11yResults(res.results, checks);
  } catch (e) {
    resultsEl.innerHTML = '<div style="color:var(--err);font-size:12px;padding:6px 0">Error: ' + esc(e.message) + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Audit';
  }
}

function renderA11yResults(results, checks) {
  const ORDER = ['alt','labels','headings','landmarks','aria','links','contrast','touch','keyboard'];
  renderSuiteResults('a11y-results', results, ORDER.filter(k => checks.includes(k)));
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
  } catch (e) {
    resultsEl.innerHTML = '<div style="color:var(--err);font-size:12px;padding:6px 0">Error: ' + esc(e.message) + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Audit';
  }
}

// ── Test Suites: Conversion / Friction audit ──────────────────────────────────
function runConversionAudit() {
  return runSuiteAudit({ action: 'runConversionAudit', checkName: 'conv-check', btnId: 'btn-run-conv', resultsId: 'conv-results' });
}

// ── Test Suites: Content & Copy audit ─────────────────────────────────────────
function runContentAudit() {
  return runSuiteAudit({ action: 'runContentAudit', checkName: 'content-check', btnId: 'btn-run-content', resultsId: 'content-results' });
}
