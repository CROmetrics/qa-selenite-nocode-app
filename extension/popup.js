// Selenite popup logic

let FN_META = {};     // { funcName: { label, args } }
let steps = [];       // [{ id, enabled, func, delay, inputs }]
let nextId = 1;
let logData = [];
let filterLevel = null;
let logOffset = 0;

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

  // Tab clicks
  document.querySelectorAll('.tab[data-tab]').forEach(t => {
    t.addEventListener('click', () => showTab(t.dataset.tab));
  });

  // Queue buttons
  document.getElementById('btn-add-step').addEventListener('click', () => addStep());
  document.getElementById('btn-run').addEventListener('click', runQueue);
  document.getElementById('btn-stop').addEventListener('click', stopQueue);

  // Script buttons
  document.getElementById('btn-save-script').addEventListener('click', saveScript);
  document.getElementById('btn-load-script').addEventListener('click', loadScript);
  document.getElementById('btn-delete-script').addEventListener('click', deleteScript);

  // Console filter input
  document.getElementById('filter-input').addEventListener('input', renderLog);

  // Console filter buttons
  document.getElementById('fb-all').addEventListener('click', function() { setFilter(null, this); });
  document.getElementById('fb-info').addEventListener('click', function() { setFilter('INFO', this); });
  document.getElementById('fb-warn').addEventListener('click', function() { setFilter('WARNING', this); });
  document.getElementById('fb-err').addEventListener('click', function() { setFilter('ERROR', this); });
  document.getElementById('btn-clear-log').addEventListener('click', clearLog);
});

// ── Tabs ──────────────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    const panels = ['queue', 'scripts', 'settings', 'console'];
    t.classList.toggle('active', panels[i] === name);
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
}

// ── Run state sync ────────────────────────────────────────────────────────
async function syncRunState() {
  const { running } = await chrome.storage.session.get('running');
  document.getElementById('btn-run').disabled  = !!running;
  document.getElementById('btn-stop').disabled = !running;
  document.getElementById('run-indicator').style.display = running ? 'inline-block' : 'none';
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

async function clearLog() {
  logData = [];
  logOffset = 0;
  await chrome.storage.session.set({ logs: [] });
  document.getElementById('log-out').innerHTML = '';
}

// ── Run / Stop ────────────────────────────────────────────────────────────
async function runQueue() {
  const url        = document.getElementById('url-input').value.trim();
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

  await chrome.runtime.sendMessage({
    action: 'run',
    payload: { url, queue, mode, targetTabId }
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

function buildArgsHTML(step) {
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
  el.querySelectorAll('[data-arg]').forEach(inp => {
    inp.addEventListener('input', e => {
      step.inputs[inp.dataset.arg] = e.target.value;
      persistQueue();
    });
  });

  el.querySelectorAll('.btn-pick').forEach(btn => {
    btn.addEventListener('click', () => startPicker(el, step, btn.dataset.pickArg));
  });
}

// ── Element picker ────────────────────────────────────────────────────────────
let _pickerPoller = null;

async function startPicker(stepEl, step, argName) {
  // Clear any old result
  await chrome.storage.session.remove('pickerResult');

  const btn = stepEl.querySelector(`.btn-pick[data-pick-arg="${argName}"]`);
  if (btn) { btn.textContent = '…'; btn.disabled = true; }

  const res = await chrome.runtime.sendMessage({ action: 'startPicker' });
  if (!res?.ok) {
    if (btn) { btn.textContent = '🎯'; btn.disabled = false; }
    alert('Could not inject picker. Make sure you are on a regular webpage (not chrome:// pages).');
    return;
  }

  // Poll session storage for the result
  _pickerPoller = setInterval(async () => {
    const { pickerResult } = await chrome.storage.session.get('pickerResult');
    if (!pickerResult) return;

    clearInterval(_pickerPoller);
    _pickerPoller = null;
    await chrome.storage.session.remove('pickerResult');

    if (btn) { btn.textContent = '🎯'; btn.disabled = false; }
    if (pickerResult.cancelled) return;

    const { selector } = pickerResult;
    // Fill the right value: id args get the raw id, css/css_selector args get the full CSS
    const value = (argName === 'element_id' && selector.idValue)
      ? selector.idValue
      : selector.css;

    const inp = stepEl.querySelector(`[data-arg="${argName}"]`);
    if (inp) {
      inp.value = value;
      step.inputs[argName] = value;
      persistQueue();
    }
  }, 300);
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
