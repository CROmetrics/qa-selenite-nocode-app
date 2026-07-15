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

  // Test Modes: WCAG / Accessibility Mode
  document.getElementById('btn-run-wcag')?.addEventListener('click', runWcagAudit);
  initSuiteTooltips();
  await initWcagMode();
  // Test Modes: A/B Variant Comparison Mode
  await initAbCompare();

  // Test Modes tab — each mode button opens its submenu, Back returns to the menu
  document.querySelectorAll('.testmode-btn').forEach(b => {
    b.addEventListener('click', () => showTestModeSub(b.dataset.testmode));
  });
  document.querySelectorAll('.testmode-back').forEach(b => {
    b.addEventListener('click', () => showTestModeSub(null));
  });
  await initTestModePages();

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

// Each Test Mode submenu carries its own list of page areas — the same layout
// and controls as the mandatory "Open URL" first step of the Build queue, but
// held per mode. Scope drives the list shape: Single shows just "Start Page";
// Multi shows "Start Page" … "End Page" with user-added pages in between.
const tmModes = {};   // { modeNum: { scope, pages: [step-like objects] } }

function tmNewPage(saved) {
  return {
    func: OPEN_URL_FUNC,
    enabled: saved?.enabled ?? true,
    delay: saved?.delay ?? '0',
    inputs: { url: '', qa_mode: false, params: [], ...(saved?.inputs || {}) },
  };
}

async function initTestModePages() {
  const { tmPagesState } = await chrome.storage.session.get('tmPagesState');
  document.querySelectorAll('.tm-pages').forEach(cont => {
    const n = cont.dataset.mode;
    const saved = tmPagesState?.[n] || {};
    const mode = {
      scope: saved.scope === 'multi' ? 'multi' : 'single',
      pages: (saved.pages || []).map(tmNewPage),
    };
    if (!mode.pages.length) mode.pages.push(tmNewPage());
    tmModes[n] = mode;

    document.querySelectorAll(`input[name="tm-scope-${n}"]`).forEach(r => {
      r.checked = r.value === mode.scope;
      r.addEventListener('change', () => {
        if (!r.checked) return;
        mode.scope = r.value;
        renderTmPages(n);
        persistTmPages();
      });
    });

    document.querySelector(`.tm-add-page[data-mode="${n}"]`)?.addEventListener('click', () => {
      mode.pages.splice(mode.pages.length - 1, 0, tmNewPage());   // insert before End Page
      renderTmPages(n);
      persistTmPages();
    });

    renderTmPages(n);
  });
}

function renderTmPages(n) {
  const mode   = tmModes[n];
  const cont   = document.querySelector(`.tm-pages[data-mode="${n}"]`);
  const addBtn = document.querySelector(`.tm-add-page[data-mode="${n}"]`);
  if (!mode || !cont) return;

  const multi = mode.scope === 'multi';
  if (multi && mode.pages.length < 2) mode.pages.push(tmNewPage());
  const shown = multi ? mode.pages : mode.pages.slice(0, 1);
  if (addBtn) addBtn.style.display = multi ? '' : 'none';

  cont.innerHTML = '';
  shown.forEach((page, i) => {
    const isEnd = multi && i === shown.length - 1;
    const label = i === 0 ? 'Start Page' : isEnd ? 'End Page' : `Page ${i + 1}`;
    const removable = multi && i > 0 && !isEnd;
    // Start and End pages always run — no enable checkbox, and any persisted
    // disabled state is overridden.
    const fixed = i === 0 || isEnd;
    if (fixed) page.enabled = true;

    const el = document.createElement('div');
    el.className = 'step step-locked';
    el.innerHTML = `
      ${fixed ? '' : `
      <div class="step-ctrl">
        <input type="checkbox" class="en-chk"${page.enabled ? ' checked' : ''}>
      </div>`}
      <div class="step-main">
        <div class="step-fn-row">
          <span class="fn-locked">🔒 ${label}</span>
          ${removable ? '<button class="btn-icon tm-rm-page" style="color:var(--err)" title="Remove page">✕</button>' : ''}
        </div>
        <div class="step-args"></div>
        <div class="delay-row">
          <span class="arg-lbl">Delay (s)</span>
          <input type="text" class="delay-in" value="${esc(page.delay || '0')}">
        </div>
      </div>`;
    el.querySelector('.step-args').innerHTML = buildOpenUrlArgsHTML(page);
    wireArgs(el, page);

    el.querySelector('.en-chk')?.addEventListener('change', e => { page.enabled = e.target.checked; });
    el.querySelector('.delay-in').addEventListener('input', e => { page.delay = e.target.value; });
    el.querySelector('.tm-rm-page')?.addEventListener('click', () => {
      mode.pages.splice(i, 1);
      renderTmPages(n);
      persistTmPages();
    });

    // wireArgs/wireOpenUrlArgs already keep page.inputs current; these
    // delegated listeners just persist after any edit in the area.
    el.addEventListener('input', persistTmPages);
    el.addEventListener('change', persistTmPages);
    el.addEventListener('click', e => {
      if (e.target.closest('.add-open-url-param, .rm-open-url-param')) persistTmPages();
    });

    cont.appendChild(el);
  });
}

function persistTmPages() {
  const state = {};
  for (const [n, m] of Object.entries(tmModes)) {
    state[n] = {
      scope: m.scope,
      pages: m.pages.map(p => ({ enabled: p.enabled, delay: p.delay, inputs: p.inputs })),
    };
  }
  chrome.storage.session.set({ tmPagesState: state });
}

// Show one Test Mode submenu (by its data-testmode number), or pass null to
// return to the mode menu.
function showTestModeSub(n) {
  const menu = document.getElementById('testmodes-menu');
  if (menu) menu.style.display = n ? 'none' : '';
  document.querySelectorAll('.testmode-sub').forEach(s => {
    s.style.display = (n && s.id === 'testmode-sub-' + n) ? '' : 'none';
  });
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

// ── WCAG results renderer ─────────────────────────────────────────────────────
// Try to derive a CSS selector from an issue string so clicking the row can
// highlight the element on the audited page. axe issues carry a real selector
// after " — "; heuristic issues embed brief()'s '#id' / '[name="…"]' /
// 'tag.class' shorthand. Returns null when nothing usable is found.
const _LOC_TAGS = 'a|button|input|select|textarea|div|span|img|video|audio|ul|ol|li|p|h[1-6]|form|nav|header|footer|section|article|dialog|td|th|tr|table|label|iframe|svg|main|aside|marquee';
function extractIssueTarget(text) {
  const axeM = /^axe · .*? — (.+)$/.exec(text);
  if (axeM) return axeM[1].trim();
  const m = new RegExp(`(^|[\\s:])(#[A-Za-z][\\w-]*|\\[name="[^"]+"\\]|(?:${_LOC_TAGS})(?:\\.[A-Za-z0-9_-]+)+)`).exec(text);
  return m ? m[2] : null;
}

function renderSuiteResults(containerId, results, order) {
  const el = document.getElementById(containerId);
  if (!el) return;

  let passed = 0, withIssues = 0, manual = 0, totalIssues = 0;

  const issueHtml = (text) => {
    const target = extractIssueTarget(text);
    return target
      ? `<div class="a11y-issue a11y-issue-loc" data-loc="${esc(target).replace(/"/g, '&quot;')}" title="Click to highlight this element on the page">${esc(text)}</div>`
      : `<div class="a11y-issue">${esc(text)}</div>`;
  };

  const rows = order
    .filter(k => results[k])
    .map(k => {
      const { label, issues, infoOnly } = results[k];
      const count = issues.length;
      const guide = infoOnly ? (WCAG_MANUAL_GUIDE[k] || []) : [];

      let dotCls, countLabel;
      if (infoOnly) {
        manual++;
        dotCls = 'a11y-info-dot';
        countLabel = 'Manual';
      } else {
        totalIssues += count;
        if (count === 0) passed++; else withIssues++;
        dotCls = count === 0 ? 'a11y-pass-dot' : 'a11y-fail-dot';
        countLabel = count === 0 ? 'Pass' : count + ' issue' + (count !== 1 ? 's' : '');
      }
      const hasBody = count > 0 || guide.length > 0;
      const isOpen = !infoOnly && count > 0;

      const body = hasBody ? `
        ${issues.map(issueHtml).join('')}
        ${guide.length ? `
          <div class="a11y-guide-title">Verify by hand:</div>
          ${guide.map(g => `<div class="a11y-guide-item">${esc(g)}</div>`).join('')}` : ''}` : '';

      return `
        <div class="a11y-row${isOpen ? ' open' : ''}" data-suite-row>
          <div class="a11y-row-hdr">
            <span class="a11y-dot ${dotCls}"></span>
            <span class="a11y-row-label">${esc(label)}</span>
            <span class="a11y-count">${countLabel}</span>
            ${hasBody ? '<span class="a11y-chevron">›</span>' : ''}
          </div>
          ${hasBody ? `<div class="a11y-body">${body}</div>` : ''}
        </div>`;
    });

  const summaryColor = withIssues === 0 ? 'var(--ok)' : 'var(--err)';
  const summaryText = withIssues === 0
    ? 'No automated issues'
    : `${totalIssues} issue${totalIssues !== 1 ? 's' : ''}`;

  el.innerHTML = `
    <div class="a11y-summary-bar">
      <span>${passed} passed · ${withIssues} with issues · ${manual} manual review</span>
      <div class="row" style="gap:8px">
        <span class="a11y-summary-total" style="color:${summaryColor}">${summaryText}</span>
        <button class="btn ghost btn-icon" data-export-results title="Download results as JSON">Export</button>
        <button class="btn ghost btn-icon" data-clear-results title="Clear results">Clear</button>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px">${rows.join('')}</div>`;

  el.querySelectorAll('[data-suite-row] .a11y-row-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => hdr.closest('[data-suite-row]').classList.toggle('open'));
  });
  el.querySelector('[data-clear-results]')?.addEventListener('click', () => { el.innerHTML = ''; });
  el.querySelector('[data-export-results]')?.addEventListener('click', exportWcagResults);
  el.querySelectorAll('.a11y-issue-loc').forEach(row => {
    row.addEventListener('click', () => wcagHighlight(row.dataset.loc, row));
  });
}

// Highlight an issue's element in the audited tab (or the active tab as a
// fallback for history views). On failure, notes it inline on the row.
async function wcagHighlight(selector, rowEl) {
  let res = null;
  try {
    res = await chrome.runtime.sendMessage({
      action: 'highlightElement',
      tabId: _wcagCurrentRun?.tabId || null,
      selector,
    });
  } catch (_) {}
  if ((!res?.ok || !res.found) && rowEl && !rowEl.querySelector('.a11y-loc-miss')) {
    const note = document.createElement('span');
    note.className = 'a11y-loc-miss';
    note.textContent = ' — not found on the current page';
    note.style.color = 'var(--fg3)';
    rowEl.appendChild(note);
    setTimeout(() => note.remove(), 2500);
  }
}

// ── WCAG mode: per-criterion explanations (shown as hover tooltips) ───────────
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

// ── Test Modes: WCAG / Accessibility Mode subpage ─────────────────────────────
// The audit engine (heuristics + axe-core merge) lives in background.js and is
// unchanged; this side owns scoping, presets, run history, export, and the
// results view. Fully independent of the Build tab queue.

// Manual-check guidance — one actionable checklist per infoOnly check, kept
// alongside WCAG_INFO so all criterion copy lives in one place.
const WCAG_MANUAL_GUIDE = {
  modalescape: [
    'Open each modal/dialog on the page.',
    'Press Escape — the dialog should close.',
    'Tab forward and backward inside the open dialog — focus must stay within it until it closes.',
    'When it closes, focus should return to the control that opened it.',
  ],
  sessiontiming: [
    'Stay idle until near session expiry — a warning should appear before you are logged out.',
    'The warning offers a way to extend the session without losing your place (2.2.1).',
    'After extending or re-authenticating, previously entered form data is still intact (2.2.6).',
  ],
  destructive: [
    'Trigger each destructive or consequential action found above.',
    'Confirm it only finalizes after an explicit confirmation step, or can be undone (3.3.4).',
    'For legal/financial submissions, confirm the user can review and correct data before the final submit (3.3.6).',
  ],
  redundant: [
    'Walk any multi-step flow (checkout, signup, booking) end to end.',
    'Information entered in an earlier step (name, email, address) should be auto-populated or selectable later, not re-typed (3.3.7).',
    'Re-entry is acceptable only when essential or for security (e.g. password confirmation).',
  ],
  realworld: [
    'Using only the keyboard, complete each key task end to end (sign up, checkout, find content).',
    'Repeat the same tasks with a screen reader (VoiceOver, NVDA, or JAWS).',
    'Confirm there are no dead ends, focus traps, or silent state changes that block completion.',
  ],
};

// The manual/infoOnly checks — used by the built-in "Automated only" preset.
const WCAG_MANUAL_KEYS = Object.keys(WCAG_MANUAL_GUIDE);

let _wcagCurrentRun = null;   // whatever run is currently rendered (fresh or from history)

function wcagCheckboxes() {
  return [...document.querySelectorAll('input[name="wcag-check"]')];
}

async function runWcagAudit() {
  const btn = document.getElementById('btn-run-wcag');
  const resultsEl = document.getElementById('wcag-results');
  const checks = wcagCheckboxes().filter(cb => cb.checked).map(cb => cb.value);
  if (!checks.length) {
    resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Select at least one check.</div>';
    return;
  }
  const scope = (document.getElementById('wcag-scope')?.value || '').trim();

  btn.disabled = true;
  btn.textContent = 'Running…';
  resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Auditing page…</div>';

  try {
    const res = await chrome.runtime.sendMessage({ action: 'runWcagAudit', checks, scope });
    if (!res?.ok) throw new Error(res?.error || 'Audit failed');
    _wcagCurrentRun = {
      url: res.url || '', ts: Date.now(), tabId: res.tabId || null,
      checks, scope, results: res.results,
      axeError: res.axeError || null, scopeError: res.scopeError || null,
    };
    renderWcagRun(_wcagCurrentRun);
    await saveWcagHistory(_wcagCurrentRun);
    await renderWcagHistoryList();
  } catch (e) {
    resultsEl.innerHTML = '<div style="color:var(--err);font-size:12px;padding:6px 0">Error: ' + esc(e.message) + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Audit';
  }
}

function renderWcagRun(run) {
  renderSuiteResults('wcag-results', run.results, run.checks);
  const resultsEl = document.getElementById('wcag-results');
  const notes = [];
  if (run.scopeError) notes.push(run.scopeError);
  else if (run.scope)  notes.push('Scoped to: ' + run.scope);
  if (run.axeError)    notes.push('axe-core could not run on this page (' + run.axeError + '). Heuristic checks were used instead.');
  if (run.url)         notes.push('Audited ' + run.url + ' at ' + new Date(run.ts).toLocaleString());
  if (notes.length) {
    const note = document.createElement('div');
    note.style.cssText = 'color:var(--fg3);font-size:11px;padding:6px 2px 0';
    note.textContent = notes.join(' · ');
    resultsEl.prepend(note);
  }
}

// ── Check presets (chrome.storage.sync, like saved scripts) ───────────────────
// Two built-ins are always present; user presets also store the scope selector.
const WCAG_BUILTIN_PRESETS = {
  '__full': 'Full audit (all checks)',
  '__auto': 'Automated only (no manual checks)',
};

async function refreshWcagPresets() {
  const { wcagPresets = {} } = await chrome.storage.sync.get('wcagPresets');
  const names = Object.keys(wcagPresets).sort();
  const sel = document.getElementById('wcag-preset-select');
  if (!sel) return;
  sel.innerHTML =
    Object.entries(WCAG_BUILTIN_PRESETS).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('') +
    names.map(n => `<option value="u:${esc(n)}">${esc(n)}</option>`).join('');
}

async function loadWcagPreset() {
  const sel = document.getElementById('wcag-preset-select');
  const v = sel?.value || '';
  let checks = null, scope = '';
  if (v === '__full') {
    checks = wcagCheckboxes().map(cb => cb.value);
  } else if (v === '__auto') {
    checks = wcagCheckboxes().map(cb => cb.value).filter(k => !WCAG_MANUAL_KEYS.includes(k));
  } else if (v.startsWith('u:')) {
    const { wcagPresets = {} } = await chrome.storage.sync.get('wcagPresets');
    const p = wcagPresets[v.slice(2)];
    if (!p) return;
    checks = p.checks || [];
    scope = p.scope || '';
  } else return;
  wcagCheckboxes().forEach(cb => { cb.checked = checks.includes(cb.value); });
  const scopeInput = document.getElementById('wcag-scope');
  if (scopeInput) scopeInput.value = scope;
}

async function saveWcagPreset() {
  const name = document.getElementById('wcag-preset-name').value.trim();
  if (!name) { alert('Enter a preset name.'); return; }
  const { wcagPresets = {} } = await chrome.storage.sync.get('wcagPresets');
  wcagPresets[name] = {
    checks: wcagCheckboxes().filter(cb => cb.checked).map(cb => cb.value),
    scope: (document.getElementById('wcag-scope')?.value || '').trim(),
  };
  await chrome.storage.sync.set({ wcagPresets });
  await refreshWcagPresets();
  document.getElementById('wcag-preset-select').value = 'u:' + name;
  document.getElementById('wcag-preset-name').value = '';
  alert(`"${name}" saved.`);
}

async function deleteWcagPreset() {
  const v = document.getElementById('wcag-preset-select')?.value || '';
  if (!v.startsWith('u:')) { alert('Built-in presets can\'t be deleted.'); return; }
  const name = v.slice(2);
  if (!confirm(`Delete "${name}"?`)) return;
  const { wcagPresets = {} } = await chrome.storage.sync.get('wcagPresets');
  delete wcagPresets[name];
  await chrome.storage.sync.set({ wcagPresets });
  await refreshWcagPresets();
}

// ── Run history (chrome.storage.local — results can be large) ─────────────────
const WCAG_HISTORY_PER_URL = 5;
const WCAG_HISTORY_URLS = 15;

async function saveWcagHistory(run) {
  if (!run.url) return;
  const { wcagHistory = {} } = await chrome.storage.local.get('wcagHistory');
  const arr = wcagHistory[run.url] || [];
  arr.unshift({ ts: run.ts, checks: run.checks, scope: run.scope, results: run.results, axeError: run.axeError, scopeError: run.scopeError });
  wcagHistory[run.url] = arr.slice(0, WCAG_HISTORY_PER_URL);
  const urls = Object.keys(wcagHistory);
  if (urls.length > WCAG_HISTORY_URLS) {
    urls.sort((a, b) => (wcagHistory[b][0]?.ts || 0) - (wcagHistory[a][0]?.ts || 0));
    for (const u of urls.slice(WCAG_HISTORY_URLS)) delete wcagHistory[u];
  }
  await chrome.storage.local.set({ wcagHistory });
}

async function renderWcagHistoryList() {
  const sel = document.getElementById('wcag-history-select');
  if (!sel) return;
  const { wcagHistory = {} } = await chrome.storage.local.get('wcagHistory');
  const opts = [];
  for (const [url, runs] of Object.entries(wcagHistory)) {
    runs.forEach((r, i) => opts.push({ url, i, ts: r.ts, scope: r.scope }));
  }
  opts.sort((a, b) => b.ts - a.ts);
  sel.innerHTML = opts.length
    ? opts.map(o => {
        let short = o.url;
        try { const u = new URL(o.url); short = u.host + u.pathname; } catch (_) {}
        return `<option value="${encodeURIComponent(o.url)}|${o.i}">${new Date(o.ts).toLocaleString()} — ${esc(short)}${o.scope ? ' (scoped)' : ''}</option>`;
      }).join('')
    : '<option disabled>&lt;no past runs&gt;</option>';
}

async function viewWcagHistoryRun() {
  const v = document.getElementById('wcag-history-select')?.value || '';
  const bar = v.lastIndexOf('|');
  if (bar < 0) return;
  const url = decodeURIComponent(v.slice(0, bar));
  const idx = +v.slice(bar + 1);
  const { wcagHistory = {} } = await chrome.storage.local.get('wcagHistory');
  const run = wcagHistory[url]?.[idx];
  if (!run) return;
  // tabId is intentionally null — highlighting falls back to the active tab.
  _wcagCurrentRun = { url, ts: run.ts, tabId: null, checks: run.checks, scope: run.scope, results: run.results, axeError: run.axeError, scopeError: run.scopeError };
  renderWcagRun(_wcagCurrentRun);
}

// ── Export (plain JSON file download) ─────────────────────────────────────────
function exportWcagResults() {
  const r = _wcagCurrentRun;
  if (!r) { alert('Run an audit first.'); return; }
  const data = {
    url: r.url || null,
    timestamp: new Date(r.ts).toISOString(),
    scope: r.scope || null,
    axeError: r.axeError || null,
    checks: r.checks.filter(k => r.results[k]).map(k => {
      const c = r.results[k];
      return {
        key: k,
        label: c.label,
        wcag: c.wcag || '',
        status: c.infoOnly ? 'manual review' : (c.issues.length ? 'issues' : 'pass'),
        issues: c.issues,
      };
    }),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = 'wcag-audit-' + new Date(r.ts).toISOString().replace(/[:.]/g, '-') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

// One-time wiring for the accessibility subpage's controls.
async function initWcagMode() {
  if (!document.getElementById('btn-run-wcag')) return;
  document.getElementById('btn-wcag-scope-pick')?.addEventListener('click', () => {
    const row = document.getElementById('wcag-scope-row');
    startPicker(row, null, 'wcag-scope', (selector) => {
      document.getElementById('wcag-scope').value =
        selector.css || (selector.idValue ? '#' + selector.idValue : '');
    });
  });
  document.getElementById('btn-wcag-load-preset')?.addEventListener('click', loadWcagPreset);
  document.getElementById('btn-wcag-save-preset')?.addEventListener('click', saveWcagPreset);
  document.getElementById('btn-wcag-delete-preset')?.addEventListener('click', deleteWcagPreset);
  document.getElementById('btn-wcag-view-history')?.addEventListener('click', viewWcagHistoryRun);
  await refreshWcagPresets();
  await renderWcagHistoryList();
}

// ── Test Modes: A/B Variant Comparison Mode subpage ──────────────────────────
// Static load-and-compare mode: opens each variant target once (background owns
// the tab lifecycle and capture), then diffs every variant against the first
// target — the baseline, typically Control. Differences are surfaced neutrally:
// a variant is *supposed* to differ from control, so only JS errors and load
// failures are styled as errors. This mode never reads or executes the Build
// tab queue.

let abState = null;   // { baseUrl, qaMode, settleSec, keepTabs, targets: [{label,url,override}], selectors: [] }

function abDefaultState() {
  return {
    baseUrl: '', qaMode: false, settleSec: '3', keepTabs: false,
    targets: [
      { label: 'Control',   url: '', override: '' },
      { label: 'Variant A', url: '', override: '' },
    ],
    selectors: [],
  };
}

async function initAbCompare() {
  if (!document.getElementById('ab-target-list')) return;
  const { abCompareState } = await chrome.storage.session.get('abCompareState');
  abState = { ...abDefaultState(), ...(abCompareState || {}) };
  if (!Array.isArray(abState.targets) || !abState.targets.length) abState.targets = abDefaultState().targets;
  if (!Array.isArray(abState.selectors)) abState.selectors = [];

  applyAbStateToInputs();

  document.getElementById('ab-base-url').addEventListener('input',   e => { abState.baseUrl  = e.target.value;   persistAbState(); });
  document.getElementById('ab-qa-mode').addEventListener('change',   e => { abState.qaMode   = e.target.checked; persistAbState(); });
  document.getElementById('ab-settle').addEventListener('input',     e => { abState.settleSec = e.target.value;  persistAbState(); });
  document.getElementById('ab-keep-tabs').addEventListener('change', e => { abState.keepTabs = e.target.checked; persistAbState(); });

  document.getElementById('btn-ab-add-target').addEventListener('click', () => {
    // Default labels continue the sequence: Control, Variant A, Variant B, …
    abState.targets.push({ label: 'Variant ' + String.fromCharCode(64 + abState.targets.length), url: '', override: '' });
    renderAbTargets();
    persistAbState();
  });
  document.getElementById('btn-ab-add-selector').addEventListener('click', () => {
    abState.selectors.push('');
    renderAbSelectors();
    persistAbState();
    const inputs = document.querySelectorAll('#ab-selector-list [data-ab-sel-input]');
    inputs[inputs.length - 1]?.focus();
  });

  document.getElementById('btn-ab-save-set').addEventListener('click', saveAbSet);
  document.getElementById('btn-ab-load-set').addEventListener('click', loadAbSet);
  document.getElementById('btn-ab-delete-set').addEventListener('click', deleteAbSet);
  document.getElementById('btn-run-abcompare').addEventListener('click', runAbComparison);
  document.getElementById('btn-stop-abcompare').addEventListener('click', () =>
    chrome.runtime.sendMessage({ action: 'stop' }));

  renderAbTargets();
  renderAbSelectors();
  await refreshAbSets();
}

function applyAbStateToInputs() {
  document.getElementById('ab-base-url').value    = abState.baseUrl || '';
  document.getElementById('ab-qa-mode').checked   = !!abState.qaMode;
  document.getElementById('ab-settle').value      = abState.settleSec || '3';
  document.getElementById('ab-keep-tabs').checked = !!abState.keepTabs;
}

function persistAbState() {
  chrome.storage.session.set({ abCompareState: abState });
}

function renderAbTargets() {
  const list = document.getElementById('ab-target-list');
  const q = s => esc(s || '').replace(/"/g, '&quot;');
  list.innerHTML = abState.targets.map((t, i) => `
    <div class="ab-target" data-ab-target="${i}">
      <div class="arg-row">
        <span class="arg-lbl">Label</span>
        <input type="text" data-ab-field="label" value="${q(t.label)}" placeholder="e.g. Variant A">
        <button class="btn-icon" data-ab-rm-target title="Remove variant" style="color:var(--err)">✕</button>
      </div>
      <div class="arg-row">
        <span class="arg-lbl">URL</span>
        <input type="text" data-ab-field="url" value="${q(t.url)}" placeholder="(uses base URL)">
      </div>
      <div class="arg-row">
        <span class="arg-lbl">Override</span>
        <input type="text" data-ab-field="override" value="${q(t.override)}" placeholder="e.g. optimizely_x=123456">
      </div>
    </div>`).join('');

  list.querySelectorAll('[data-ab-target]').forEach(block => {
    const i = +block.dataset.abTarget;
    block.querySelectorAll('[data-ab-field]').forEach(inp => {
      inp.addEventListener('input', () => {
        abState.targets[i][inp.dataset.abField] = inp.value;
        persistAbState();
      });
    });
    block.querySelector('[data-ab-rm-target]').addEventListener('click', () => {
      abState.targets.splice(i, 1);
      renderAbTargets();
      persistAbState();
    });
  });
}

function renderAbSelectors() {
  const list = document.getElementById('ab-selector-list');
  const q = s => esc(s || '').replace(/"/g, '&quot;');
  if (!abState.selectors.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--fg3)">None — the automatic captures (title, console, metrics) still compare.</div>';
    return;
  }
  list.innerHTML = abState.selectors.map((s, i) => `
    <div class="ab-sel-row" data-ab-sel="${i}">
      <input type="text" data-ab-sel-input value="${q(s)}" placeholder=".hero .cta, #banner …">
      <button class="btn-pick" data-pick-arg="ab-sel" title="Pick element from page">&#x1F3AF;</button>
      <button class="btn-icon" data-ab-rm-sel title="Remove" style="color:var(--err)">✕</button>
    </div>`).join('');

  list.querySelectorAll('[data-ab-sel]').forEach(row => {
    const i = +row.dataset.abSel;
    row.querySelector('[data-ab-sel-input]').addEventListener('input', e => {
      abState.selectors[i] = e.target.value;
      persistAbState();
    });
    // Same picker flow as the Build tab; the callback routes the result into
    // this row instead of a queue step.
    row.querySelector('.btn-pick').addEventListener('click', () => {
      startPicker(row, null, 'ab-sel', (selector) => {
        const val = selector.css || (selector.idValue ? '#' + selector.idValue : '');
        abState.selectors[i] = val;
        row.querySelector('[data-ab-sel-input]').value = val;
        persistAbState();
      });
    });
    row.querySelector('[data-ab-rm-sel]').addEventListener('click', () => {
      abState.selectors.splice(i, 1);
      renderAbSelectors();
      persistAbState();
    });
  });
}

// ── Saved variant target sets (chrome.storage.sync, like saved scripts) ──────
async function refreshAbSets() {
  const { abVariantSets = {} } = await chrome.storage.sync.get('abVariantSets');
  const names = Object.keys(abVariantSets).sort();
  const sel = document.getElementById('ab-set-select');
  sel.innerHTML = names.length
    ? names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')
    : '<option disabled>&lt;no saved sets&gt;</option>';
}

async function saveAbSet() {
  const name = document.getElementById('ab-set-name').value.trim();
  if (!name) { alert('Enter a set name.'); return; }
  const { abVariantSets = {} } = await chrome.storage.sync.get('abVariantSets');
  abVariantSets[name] = JSON.parse(JSON.stringify(abState));
  await chrome.storage.sync.set({ abVariantSets });
  await refreshAbSets();
  document.getElementById('ab-set-select').value = name;
  document.getElementById('ab-set-name').value = '';
  alert(`"${name}" saved.`);
}

async function loadAbSet() {
  const name = document.getElementById('ab-set-select').value || '';
  if (!name) { alert('Select a saved set first.'); return; }
  const { abVariantSets = {} } = await chrome.storage.sync.get('abVariantSets');
  if (!abVariantSets[name]) return;
  abState = { ...abDefaultState(), ...abVariantSets[name] };
  applyAbStateToInputs();
  renderAbTargets();
  renderAbSelectors();
  persistAbState();
}

async function deleteAbSet() {
  const name = document.getElementById('ab-set-select').value || '';
  if (!name) return;
  if (!confirm(`Delete "${name}"?`)) return;
  const { abVariantSets = {} } = await chrome.storage.sync.get('abVariantSets');
  delete abVariantSets[name];
  await chrome.storage.sync.set({ abVariantSets });
  await refreshAbSets();
}

// ── Run orchestration ─────────────────────────────────────────────────────────
// Compose the final URL for one target: per-target URL (or the shared base),
// plus the override query string, plus cro_mode=qa last — mirroring the Build
// tab's Open URL behavior.
function abComposeUrl(target) {
  let url = (target.url || abState.baseUrl || '').trim();
  if (!url) return '';
  let params = [];
  const override = (target.override || '').trim().replace(/^[?&]/, '');
  if (override) params.push(override);
  if (abState.qaMode) {
    params = params.filter(p => !p.toLowerCase().startsWith('cro_mode='));
    params.push('cro_mode=qa');
  }
  if (params.length) url += (url.includes('?') ? '&' : '?') + params.join('&');
  return url;
}

let _abProgressPoller = null;

async function runAbComparison() {
  const btn       = document.getElementById('btn-run-abcompare');
  const stopBtn   = document.getElementById('btn-stop-abcompare');
  const resultsEl = document.getElementById('ab-results');

  const targets = abState.targets
    .map(t => ({ label: (t.label || '').trim() || 'Variant', url: abComposeUrl(t) }))
    .filter(t => t.url);
  if (targets.length < 2) {
    resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Define at least two variant targets with a URL (or set a base URL).</div>';
    return;
  }

  const metricsList = metrics.map(m => m.trim()).filter(Boolean);
  const selectors   = abState.selectors.map(s => s.trim()).filter(Boolean);

  btn.disabled = true;
  btn.textContent = 'Running…';
  if (stopBtn) stopBtn.style.display = '';
  resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Loading variants…</div>';

  _abProgressPoller = setInterval(async () => {
    const { abProgress } = await chrome.storage.session.get('abProgress');
    if (abProgress?.running) {
      btn.textContent = `Running ${abProgress.index + 1}/${abProgress.total}…`;
      resultsEl.innerHTML = `<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Loading ${esc(abProgress.label)} (${abProgress.index + 1} of ${abProgress.total})…</div>`;
    }
  }, 400);

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'runVariantComparison',
      payload: { targets, settleSeconds: abState.settleSec, keepTabs: abState.keepTabs, selectors },
    });
    if (!res?.ok) throw new Error(res?.error || 'Comparison failed');
    renderAbResults(res.results, metricsList, selectors);
  } catch (e) {
    resultsEl.innerHTML = '<div style="color:var(--err);font-size:12px;padding:6px 0">Error: ' + esc(e.message) + '</div>';
  } finally {
    clearInterval(_abProgressPoller);
    _abProgressPoller = null;
    btn.disabled = false;
    btn.textContent = 'Run Comparison';
    if (stopBtn) stopBtn.style.display = 'none';
  }
}

// ── Diffing ───────────────────────────────────────────────────────────────────
// All comparison logic lives here; captures[0] is the baseline. Returns a
// structure the renderer walks — no DOM concerns in this function.
function diffAbCaptures(captures, metricsList, selectors) {
  const texts = c => (c.console || []).map(l => l.text);
  const stripUrl = (u) => {
    try { const p = new URL(u); return p.origin + p.pathname; } catch (_) { return u || ''; }
  };
  const base = captures[0];

  // Page basics — override params make full URLs differ by design, so URL
  // mismatch means origin+path, not query string.
  const basics = captures.map((c, i) => ({
    label: c.label, title: c.title || '', finalUrl: c.finalUrl || '', loadError: c.loadError || null,
    titleDiff: i > 0 && !c.loadError && c.title !== base.title,
    urlDiff:   i > 0 && !c.loadError && stripUrl(c.finalUrl) !== stripUrl(base.finalUrl),
  }));

  // Watched selectors — per selector, one flattened fact row per variant, with
  // the list of fact keys that differ from the baseline row.
  const FACT_KEYS = ['exists', 'visible', 'text', 'display', 'visibility', 'color', 'background-color'];
  const flat = f => f && {
    exists: f.exists, visible: f.visible, text: f.text || '',
    display: f.styles?.display ?? '', visibility: f.styles?.visibility ?? '',
    color: f.styles?.color ?? '', 'background-color': f.styles?.['background-color'] ?? '',
  };
  const selectorRows = selectors.map((sel, si) => {
    const rows  = captures.map(c => flat((c.selectors || [])[si]));
    const diffs = rows.map((r, i) => {
      if (i === 0 || !r || !rows[0]) return [];
      return FACT_KEYS.filter(k => String(r[k]) !== String(rows[0][k]));
    });
    const missing = rows.map(r => !r);
    const allSame = rows.every(Boolean) && diffs.every(d => !d.length);
    return { selector: sel, rows, diffs, missing, allSame };
  });

  // Metrics — case-insensitive substring fire counts against tagged lines,
  // the same matching rule as the Build tab's Track Metric step.
  const metricRows = metricsList.map(m => {
    const needle = m.toLowerCase();
    const counts = captures.map(c => texts(c).filter(t => t.toLowerCase().includes(needle)).length);
    const fired    = counts.map(c => c > 0);
    return {
      metric: m, counts,
      allSame: counts.every(c => c === counts[0]),
      mixedFiring: fired.some(Boolean) && !fired.every(Boolean),   // fired somewhere but not everywhere
    };
  });

  // Console — added/missing tagged lines per variant vs baseline; lines present
  // in every variant are the collapsed "shared" set.
  const baseSet = new Set(texts(base));
  const consoleRows = captures.map((c, i) => {
    if (i === 0) return { label: c.label, added: [], missing: [] };
    const set = new Set(texts(c));
    return {
      label: c.label,
      added:   [...set].filter(t => !baseSet.has(t)),
      missing: [...baseSet].filter(t => !set.has(t)),
    };
  });
  const shared = [...baseSet].filter(t =>
    captures.slice(1).every(c => texts(c).includes(t)));

  // Errors — always flagged regardless of diff status.
  const errors = captures.map(c => ({
    label: c.label,
    loadError: c.loadError || null,
    jsErrors: c.errors || [],
  })).filter(e => e.loadError || e.jsErrors.length);

  return { basics, selectorRows, metricRows, consoleRows, shared, errors };
}

// ── Results rendering ─────────────────────────────────────────────────────────
function abSection(title, deltaCount, body, { error = false, extra = '' } = {}) {
  const dot = error ? 'a11y-fail-dot' : deltaCount ? 'a11y-info-dot' : 'a11y-pass-dot';
  const countLabel = error
    ? `${deltaCount} error${deltaCount !== 1 ? 's' : ''}`
    : deltaCount ? `${deltaCount} delta${deltaCount !== 1 ? 's' : ''}` : 'Identical';
  return `
    <div class="a11y-row${deltaCount ? ' open' : ''}" data-suite-row>
      <div class="a11y-row-hdr">
        <span class="a11y-dot ${dot}"></span>
        <span class="a11y-row-label">${esc(title)}${extra}</span>
        <span class="a11y-count">${countLabel}</span>
        <span class="a11y-chevron">›</span>
      </div>
      <div class="a11y-body">${body}</div>
    </div>`;
}

function renderAbResults(allCaptures, metricsList, selectors) {
  const el = document.getElementById('ab-results');
  const captures = (allCaptures || []).filter(c => !c.skipped);
  const skippedCount = (allCaptures || []).length - captures.length;
  if (captures.length < 2) {
    el.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Stopped before two variants were captured — nothing to compare.</div>';
    return;
  }

  const d = diffAbCaptures(captures, metricsList, selectors);
  const q = esc;
  const mark = (val, isDiff) => isDiff ? `<span class="ab-delta">${q(String(val))}</span>` : q(String(val));

  const sections = [];

  // Errors — only shown when present, always red.
  if (d.errors.length) {
    const count = d.errors.reduce((n, e) => n + (e.loadError ? 1 : 0) + e.jsErrors.length, 0);
    sections.push(abSection('Errors', count, d.errors.map(e => `
      <div class="ab-line">
        <b>${q(e.label)}</b>
        ${e.loadError ? `<div class="ab-cline ab-err">Load failure: ${q(e.loadError)}</div>` : ''}
        ${e.jsErrors.map(x => `<div class="ab-cline ab-err">${q(x)}</div>`).join('')}
      </div>`).join(''), { error: true }));
  }

  // Page basics
  const basicsDeltas = d.basics.filter(b => b.titleDiff || b.urlDiff).length;
  sections.push(abSection('Page Basics', basicsDeltas, d.basics.map((b, i) => `
    <div class="ab-line${!b.titleDiff && !b.urlDiff && i > 0 ? ' ab-same-row' : ''}">
      <b>${q(b.label)}</b>${i === 0 ? ' <span style="color:var(--fg3)">(baseline)</span>' : ''}
      ${b.loadError ? '<span class="ab-err"> — not captured (load failed)</span>' : `
      <div class="ab-cline">title: ${mark(b.title, b.titleDiff)}</div>
      <div class="ab-cline">url: ${mark(b.finalUrl, b.urlDiff)}</div>`}
    </div>`).join('')));

  // Watched selectors
  if (selectors.length) {
    const selDeltas = d.selectorRows.filter(s => !s.allSame).length;
    sections.push(abSection('Watched Selectors', selDeltas, d.selectorRows.map(s => `
      <div class="ab-sel-block${s.allSame ? ' ab-same-row' : ''}">
        <div class="ab-sel-name">${q(s.selector)}${s.allSame ? ' <span style="color:var(--fg3)">— identical in all variants</span>' : ''}</div>
        ${s.rows.map((r, i) => {
          if (!r) return `<div class="ab-cline"><b>${q(captures[i].label)}</b> <span class="ab-err">not captured</span></div>`;
          const df = new Set(s.diffs[i]);
          const facts = [
            `exists ${mark(r.exists ? '✓' : '✗', df.has('exists'))}`,
            `visible ${mark(r.visible ? '✓' : '✗', df.has('visible'))}`,
            `text ${mark(JSON.stringify(r.text.slice(0, 80)), df.has('text'))}`,
            `display:${mark(r.display, df.has('display'))}`,
            `visibility:${mark(r.visibility, df.has('visibility'))}`,
            `color:${mark(r.color, df.has('color'))}`,
            `bg:${mark(r['background-color'], df.has('background-color'))}`,
          ];
          return `<div class="ab-cline"><b>${q(captures[i].label)}</b> — ${facts.join(' · ')}</div>`;
        }).join('')}
      </div>`).join('') || '<div class="ab-line ab-same-row">No watched selectors.</div>'));
  }

  // Metrics
  if (metricsList.length) {
    const metricDeltas = d.metricRows.filter(m => !m.allSame).length;
    sections.push(abSection('Metrics', metricDeltas, d.metricRows.map(m => `
      <div class="ab-line${m.allSame ? ' ab-same-row' : ''}">
        ${m.mixedFiring ? '<span class="ab-warn">⚠ </span>' : ''}<b>${q(m.metric)}</b> —
        ${m.counts.map((c, i) => mark(`${captures[i].label} ×${c}`, !m.allSame && c !== m.counts[0])).join(' · ')}
        ${m.mixedFiring ? '<div class="ab-cline ab-warn">Fired in some variants but not others</div>' : ''}
      </div>`).join('')));
  }

  // Console
  const consoleDeltas = d.consoleRows.filter(v => v.added.length || v.missing.length).length;
  sections.push(abSection('Console (tagged lines)', consoleDeltas, `
    ${d.consoleRows.slice(1).map(v => (v.added.length || v.missing.length) ? `
      <div class="ab-line"><b>${q(v.label)}</b> — vs baseline
        ${v.added.map(t => `<div class="ab-cline ab-line-add">${q(t)}</div>`).join('')}
        ${v.missing.map(t => `<div class="ab-cline ab-line-miss">${q(t)}</div>`).join('')}
      </div>` : `<div class="ab-line ab-same-row"><b>${q(v.label)}</b> — no differences vs baseline</div>`).join('')}
    <div class="ab-line ab-same-row">${d.shared.length} shared line${d.shared.length !== 1 ? 's' : ''} across all variants${d.shared.length ? ':' : ''}
      ${d.shared.map(t => `<div class="ab-cline">${q(t)}</div>`).join('')}
    </div>`));

  const totalDeltas =
    basicsDeltas +
    d.selectorRows.filter(s => !s.allSame).length +
    d.metricRows.filter(m => !m.allSame).length +
    consoleDeltas;
  const errCount = d.errors.reduce((n, e) => n + (e.loadError ? 1 : 0) + e.jsErrors.length, 0);
  const summaryColor = errCount ? 'var(--err)' : 'var(--info)';
  const summaryText = (errCount ? `${errCount} error${errCount !== 1 ? 's' : ''} · ` : '')
    + `${totalDeltas} difference${totalDeltas !== 1 ? 's' : ''} vs baseline`;

  el.innerHTML = `
    <div class="a11y-summary-bar">
      <span>Baseline: ${q(captures[0].label)}</span>
      <div class="row" style="gap:8px">
        <span class="a11y-summary-total" style="color:${summaryColor}">${summaryText}</span>
        <button class="btn ghost btn-icon" data-clear-results title="Clear results">Clear</button>
      </div>
    </div>
    <div style="font-size:10px;color:var(--fg3);padding:0 2px 6px">Differences are expected in an A/B test — review whether each delta matches the intended variant change. Only errors and load failures are defects.${skippedCount ? ` · ${skippedCount} variant${skippedCount !== 1 ? 's' : ''} skipped (stopped)` : ''}${abState.keepTabs ? ' · Variant tabs were left open for inspection.' : ''}</div>
    <div style="display:flex;flex-direction:column;gap:4px">${sections.join('')}</div>`;

  el.querySelectorAll('[data-suite-row] .a11y-row-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => hdr.closest('[data-suite-row]').classList.toggle('open'));
  });
  el.querySelector('[data-clear-results]')?.addEventListener('click', () => { el.innerHTML = ''; });
}
