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
  // Test Modes: Visual Regression / Cross-Variant Accessibility /
  // Performance / Session Replay (each is a no-op if its subpage is absent).
  await initVrMode();
  await initCvaMode();
  await initPerfMode();
  await initSrMode();

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
  // Visual Regression's baseline list reflects the Pages list above it, which
  // may have been edited since the last visit — refresh on entry.
  if (n === '3') renderVrBaselines();
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
// tab's Open URL behavior. Shared with the Cross-Variant Accessibility mode.
function composeVariantUrl(target, baseUrl, qaMode) {
  let url = (target.url || baseUrl || '').trim();
  if (!url) return '';
  let params = [];
  const override = (target.override || '').trim().replace(/^[?&]/, '');
  if (override) params.push(override);
  if (qaMode) {
    params = params.filter(p => !p.toLowerCase().startsWith('cro_mode='));
    params.push('cro_mode=qa');
  }
  if (params.length) url += (url.includes('?') ? '&' : '?') + params.join('&');
  return url;
}

function abComposeUrl(target) {
  return composeVariantUrl(target, abState.baseUrl, abState.qaMode);
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

// ═════════════════════════════════════════════════════════════════════════════
// Test Modes: shared helpers for the batch-style modes
// ═════════════════════════════════════════════════════════════════════════════

// One entry per WCAG check suite — mirrors the static checkbox list on the
// standalone WCAG subpage and background.js's check keys. The Cross-Variant
// mode builds its check list from this so the two stay in sync.
const WCAG_CHECKS = [
  { key: 'titles',         label: 'Page Identity & Titles',          sc: '2.4.2' },
  { key: 'navconsistency', label: 'Navigation Consistency',          sc: '3.2.3, 3.2.4, 3.2.6' },
  { key: 'multipleways',   label: 'Alternate Paths to Content',      sc: '2.4.5' },
  { key: 'skiplink',       label: 'Skip Link Functionality',         sc: '2.4.1' },
  { key: 'keyboardpath',   label: 'Keyboard Path Verification',      sc: '2.1.1, 2.4.3' },
  { key: 'modalescape',    label: 'Modal & Dialog Escape',           sc: '2.1.2', manual: true },
  { key: 'formerror',      label: 'Form Error Handling',             sc: '3.3.1, 3.3.3, 4.1.3' },
  { key: 'sessiontiming',  label: 'Session Timing',                  sc: '2.2.1, 2.2.6', manual: true },
  { key: 'destructive',    label: 'Destructive Action Confirmation', sc: '3.3.4, 3.3.6', manual: true },
  { key: 'linkpurpose',    label: 'Link Purpose',                    sc: '2.4.4, 2.4.9' },
  { key: 'formlabels',     label: 'Form Labeling',                   sc: '3.3.2, 1.3.1' },
  { key: 'redundant',      label: 'Redundant Entry',                 sc: '3.3.7', manual: true },
  { key: 'focusvis',       label: 'Focus Visibility',                sc: '2.4.7, 2.4.11' },
  { key: 'ariastate',      label: 'ARIA State Toggling',             sc: '4.1.2' },
  { key: 'contrast',       label: 'Color Contrast',                  sc: '1.4.3, 1.4.11' },
  { key: 'reflow',         label: 'Reflow & Zoom',                   sc: '1.4.10, 1.4.4' },
  { key: 'motion',         label: 'Motion & Flashing',               sc: '2.2.2, 2.3.1' },
  { key: 'screenreader',   label: 'Screen Reader Announcements',     sc: '1.1.1, 4.1.3, 4.1.2' },
  { key: 'realworld',      label: 'Real-World Task Usability',       sc: 'cross-cutting', manual: true },
];

// Compose the executable URL for a Test Modes page row — the same rules as the
// Build tab's Open URL step (params appended, cro_mode=qa always last).
function tmComposeUrl(page) {
  let url = (page.inputs.url || '').trim();
  if (!url) return '';
  let params = Array.isArray(page.inputs.params)
    ? page.inputs.params.map(p => String(p).trim()).filter(Boolean)
    : [];
  if (page.inputs.qa_mode) {
    params = params.filter(p => !p.toLowerCase().startsWith('cro_mode='));
    params.push('cro_mode=qa');
  }
  if (params.length) url += (url.includes('?') ? '&' : '?') + params.join('&');
  return url;
}

// The enabled, non-empty page URLs a mode's scaffold currently defines
// (respecting the Single/Multi scope radio).
function tmPagesFor(n) {
  const mode = tmModes[n];
  if (!mode) return [];
  const shown = mode.scope === 'multi' ? mode.pages : mode.pages.slice(0, 1);
  return shown.filter(p => p.enabled).map(p => ({ url: tmComposeUrl(p) })).filter(p => p.url);
}

function shortUrl(u) {
  try { const x = new URL(u); return x.host + x.pathname + (x.search ? x.search : ''); } catch (_) { return u || ''; }
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

function fmtBytes(n) {
  if (n == null) return '—';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return Math.round(n) + ' B';
}

// ── IndexedDB (screenshots + recorded sessions outgrow chrome.storage quotas) ─
const IDB_NAME = 'selenite';
let _idb = null;

function idb() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('vrImages')) db.createObjectStore('vrImages');
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => { _idb = req.result; resolve(_idb); };
    req.onerror = () => reject(req.error);
  });
}

function idbReq(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbPut(store, value, key) {
  const os = (await idb()).transaction(store, 'readwrite').objectStore(store);
  return idbReq(key === undefined ? os.put(value) : os.put(value, key));
}
async function idbGet(store, key) {
  return idbReq((await idb()).transaction(store).objectStore(store).get(key));
}
async function idbDelete(store, key) {
  return idbReq((await idb()).transaction(store, 'readwrite').objectStore(store).delete(key));
}
async function idbGetAll(store) {
  return idbReq((await idb()).transaction(store).objectStore(store).getAll());
}

// Data URLs can't be opened as a top-level navigation; hand the image to a new
// tab as a blob URL instead (same-origin with the panel, so it renders).
async function openImageInTab(dataUrl) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    chrome.tabs.create({ url: URL.createObjectURL(blob) });
  } catch (_) {}
}

// ═════════════════════════════════════════════════════════════════════════════
// Test Modes: Visual Regression Mode subpage (#testmode-sub-3)
// ═════════════════════════════════════════════════════════════════════════════
// Capture-and-diff regression testing for a page over time. Background owns the
// tab lifecycle and CDP full-page capture; this side owns config, IndexedDB
// image storage, the canvas pixel diff, and rendering. Never touches the Build
// tab queue.

let vrState = null;       // { settleSec, threshold, keepTabs, ignoreSelectors: [] }
let _vrLastRun = null;    // last comparison, for export (images stay in IndexedDB)
let _vrProgressPoller = null;

function vrDefaultState() {
  return { settleSec: '3', threshold: '0.1', keepTabs: false, ignoreSelectors: [] };
}

async function initVrMode() {
  if (!document.getElementById('btn-vr-run')) return;
  const { vrConfig } = await chrome.storage.local.get('vrConfig');
  vrState = { ...vrDefaultState(), ...(vrConfig || {}) };
  if (!Array.isArray(vrState.ignoreSelectors)) vrState.ignoreSelectors = [];

  document.getElementById('vr-settle').value      = vrState.settleSec;
  document.getElementById('vr-threshold').value   = vrState.threshold;
  document.getElementById('vr-keep-tabs').checked = !!vrState.keepTabs;

  document.getElementById('vr-settle').addEventListener('input',      e => { vrState.settleSec = e.target.value;  persistVrState(); });
  document.getElementById('vr-threshold').addEventListener('input',   e => { vrState.threshold = e.target.value;  persistVrState(); });
  document.getElementById('vr-keep-tabs').addEventListener('change',  e => { vrState.keepTabs = e.target.checked; persistVrState(); });

  document.getElementById('btn-vr-add-ignore').addEventListener('click', () => {
    vrState.ignoreSelectors.push('');
    renderVrIgnores();
    persistVrState();
    const inputs = document.querySelectorAll('#vr-ignore-list [data-vr-ignore-input]');
    inputs[inputs.length - 1]?.focus();
  });
  document.getElementById('btn-vr-baseline').addEventListener('click', () => runVrCapture('baseline'));
  document.getElementById('btn-vr-run').addEventListener('click', () => runVrCapture('compare'));
  document.getElementById('btn-vr-stop').addEventListener('click', () =>
    chrome.runtime.sendMessage({ action: 'stop' }));

  renderVrIgnores();
  await renderVrBaselines();
}

function persistVrState() {
  chrome.storage.local.set({ vrConfig: vrState });
}

function renderVrIgnores() {
  const list = document.getElementById('vr-ignore-list');
  if (!list) return;
  const q = s => esc(s || '').replace(/"/g, '&quot;');
  if (!vrState.ignoreSelectors.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--fg3)">None — use for carousels, timestamps, ads, and other legitimately dynamic content.</div>';
    return;
  }
  list.innerHTML = vrState.ignoreSelectors.map((s, i) => `
    <div class="ab-sel-row" data-vr-ignore="${i}">
      <input type="text" data-vr-ignore-input value="${q(s)}" placeholder=".carousel, #ad-slot …">
      <button class="btn-pick" data-pick-arg="vr-ignore" title="Pick element from page">&#x1F3AF;</button>
      <button class="btn-icon" data-vr-rm-ignore title="Remove" style="color:var(--err)">✕</button>
    </div>`).join('');

  list.querySelectorAll('[data-vr-ignore]').forEach(row => {
    const i = +row.dataset.vrIgnore;
    row.querySelector('[data-vr-ignore-input]').addEventListener('input', e => {
      vrState.ignoreSelectors[i] = e.target.value;
      persistVrState();
    });
    row.querySelector('.btn-pick').addEventListener('click', () => {
      startPicker(row, null, 'vr-ignore', (selector) => {
        const val = selector.css || (selector.idValue ? '#' + selector.idValue : '');
        vrState.ignoreSelectors[i] = val;
        row.querySelector('[data-vr-ignore-input]').value = val;
        persistVrState();
      });
    });
    row.querySelector('[data-vr-rm-ignore]').addEventListener('click', () => {
      vrState.ignoreSelectors.splice(i, 1);
      renderVrIgnores();
      persistVrState();
    });
  });
}

// Baseline status per configured page, with a per-page reset affordance.
// Run Comparison stays disabled until at least one page has a baseline.
async function renderVrBaselines() {
  const el = document.getElementById('vr-baseline-list');
  if (!el) return;
  const pages = tmPagesFor('3');
  const { vrMeta = {} } = await chrome.storage.local.get('vrMeta');
  const runBtn = document.getElementById('btn-vr-run');
  if (!pages.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--fg3)">Add a page URL above first.</div>';
    if (runBtn) runBtn.disabled = true;
    return;
  }
  let anyBaseline = false;
  el.innerHTML = pages.map(p => {
    const b = vrMeta[p.url]?.baseline;
    if (b) anyBaseline = true;
    return `
      <div class="ab-line">
        <b>${esc(shortUrl(p.url))}</b>
        <div class="ab-cline">${b
          ? `baseline captured ${new Date(b.ts).toLocaleString()} · ${b.viewportW}px viewport${b.truncated ? ' · <span class="ab-warn">capture truncated at ' + b.capturedH + 'px</span>' : ''}
             <button class="btn-icon" data-vr-reset="${esc(p.url).replace(/"/g, '&quot;')}" title="Reset baseline" style="color:var(--err)">✕ reset</button>`
          : '<span style="color:var(--fg3)">no baseline yet — Run Comparison will skip this page</span>'}</div>
      </div>`;
  }).join('');
  if (runBtn) runBtn.disabled = !anyBaseline;

  el.querySelectorAll('[data-vr-reset]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.vrReset;
      if (!confirm('Reset the stored baseline for this page?')) return;
      const { vrMeta = {} } = await chrome.storage.local.get('vrMeta');
      delete vrMeta[url];
      await chrome.storage.local.set({ vrMeta });
      for (const k of ['baseline|', 'current|', 'diff|']) { try { await idbDelete('vrImages', k + url); } catch (_) {} }
      await renderVrBaselines();
    });
  });
}

async function runVrCapture(kind) {
  const resultsEl = document.getElementById('vr-results');
  const baseBtn = document.getElementById('btn-vr-baseline');
  const runBtn  = document.getElementById('btn-vr-run');
  const stopBtn = document.getElementById('btn-vr-stop');

  const pages = tmPagesFor('3');
  if (!pages.length) {
    resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Add at least one page URL above.</div>';
    return;
  }
  const { vrMeta = {} } = await chrome.storage.local.get('vrMeta');
  let targets = pages;
  if (kind === 'compare') {
    targets = pages.filter(p => vrMeta[p.url]?.baseline);
    if (!targets.length) {
      resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">No baselines stored yet — click Set Baseline first.</div>';
      return;
    }
  }

  baseBtn.disabled = true;
  runBtn.disabled = true;
  stopBtn.style.display = '';
  resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Capturing…</div>';
  _vrProgressPoller = setInterval(async () => {
    const { vrProgress } = await chrome.storage.session.get('vrProgress');
    if (vrProgress?.running) {
      resultsEl.innerHTML = `<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Capturing ${esc(shortUrl(vrProgress.label || ''))} (${vrProgress.index + 1} of ${vrProgress.total})…</div>`;
    }
  }, 400);

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'runVisualCapture',
      payload: {
        pages: targets, settleSeconds: vrState.settleSec,
        keepTabs: vrState.keepTabs, ignoreSelectors: vrState.ignoreSelectors,
      },
    });
    if (!res?.ok) throw new Error(res?.error || 'Capture failed');
    if (kind === 'baseline') await vrStoreBaselines(res.results);
    else await vrCompare(res.results);
  } catch (e) {
    resultsEl.innerHTML = '<div style="color:var(--err);font-size:12px;padding:6px 0">Error: ' + esc(e.message) + '</div>';
  } finally {
    clearInterval(_vrProgressPoller);
    _vrProgressPoller = null;
    baseBtn.disabled = false;
    stopBtn.style.display = 'none';
    await renderVrBaselines();   // also re-enables Run Comparison when applicable
  }
}

async function vrStoreBaselines(captures) {
  const resultsEl = document.getElementById('vr-results');
  const { vrMeta = {} } = await chrome.storage.local.get('vrMeta');
  const lines = [];
  for (const c of captures) {
    if (c.skipped) { lines.push(`<div class="ab-line ab-same-row">${esc(shortUrl(c.url))} — skipped (stopped)</div>`); continue; }
    if (c.error)   { lines.push(`<div class="ab-line"><span class="ab-err">${esc(shortUrl(c.url))} — ${esc(c.error)}</span></div>`); continue; }
    await idbPut('vrImages', c.dataUrl, 'baseline|' + c.url);
    try { await idbDelete('vrImages', 'current|' + c.url); await idbDelete('vrImages', 'diff|' + c.url); } catch (_) {}
    vrMeta[c.url] = {
      baseline: {
        ts: c.ts, viewportW: c.viewportW, viewportH: c.viewportH,
        pageW: c.pageW, pageH: c.pageH, capturedH: c.capturedH,
        truncated: !!c.truncated, boxes: c.boxes || [],
      },
    };
    lines.push(`<div class="ab-line">${esc(shortUrl(c.url))} — <span style="color:var(--ok)">baseline stored</span>${c.truncated ? ' <span class="ab-warn">(page taller than ' + VR_MAX_H_NOTE + 'px — capture truncated)</span>' : ''}</div>`);
  }
  await chrome.storage.local.set({ vrMeta });
  resultsEl.innerHTML = `
    <div class="a11y-summary-bar"><span>Baseline capture</span></div>
    <div style="display:flex;flex-direction:column;gap:2px">${lines.join('')}</div>`;
}

const VR_MAX_H_NOTE = 8000;   // mirrors background's VR_MAX_CAPTURE_HEIGHT, for copy only

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });
}

// Dependency-free pixel diff. Small per-channel tolerance absorbs
// anti-aliasing; ignore-region boxes are blacked out of both images first;
// a height difference is diffed over the shared region and the delta itself
// counts toward the mismatch (tinted amber on the diff image).
async function vrDiffImages(baseSrc, curSrc, baseMeta, curCap, threshold) {
  const [bi, ci] = await Promise.all([loadImage(baseSrc), loadImage(curSrc)]);
  const w = Math.min(bi.naturalWidth, ci.naturalWidth);
  const sharedH = Math.min(bi.naturalHeight, ci.naturalHeight);
  const maxH = Math.max(bi.naturalHeight, ci.naturalHeight);

  const draw = (img, pageW) => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    // Mask ignore regions from BOTH captures onto this image, scaled from
    // page CSS px to image px.
    const s = pageW ? img.naturalWidth / pageW : 1;
    x.fillStyle = '#000';
    for (const b of [...(baseMeta.boxes || []), ...(curCap.boxes || [])]) {
      x.fillRect(Math.floor(b.x * s), Math.floor(b.y * s), Math.ceil(b.w * s), Math.ceil(b.h * s));
    }
    return x;
  };
  const bx = draw(bi, baseMeta.pageW);
  const cx = draw(ci, curCap.pageW);
  const bd = bx.getImageData(0, 0, w, sharedH).data;
  const cd = cx.getImageData(0, 0, w, sharedH).data;

  // Diff image: changed pixels in red over a dimmed copy of the baseline.
  const out = document.createElement('canvas');
  out.width = w; out.height = maxH;
  const ox = out.getContext('2d');
  ox.fillStyle = '#fff';
  ox.fillRect(0, 0, w, maxH);
  ox.globalAlpha = 0.25;
  ox.drawImage(bi, 0, 0);
  ox.globalAlpha = 1;
  const od = ox.getImageData(0, 0, w, maxH);
  const o = od.data;

  const TOL = 25;
  let changed = 0;
  const px = w * sharedH;
  for (let i = 0; i < px; i++) {
    const j = i * 4;
    if (Math.abs(bd[j] - cd[j]) > TOL || Math.abs(bd[j + 1] - cd[j + 1]) > TOL || Math.abs(bd[j + 2] - cd[j + 2]) > TOL) {
      changed++;
      o[j] = 229; o[j + 1] = 57; o[j + 2] = 53; o[j + 3] = 255;
    }
  }
  ox.putImageData(od, 0, 0);
  const deltaH = maxH - sharedH;
  if (deltaH > 0) {
    ox.fillStyle = 'rgba(255,170,0,.35)';
    ox.fillRect(0, sharedH, w, deltaH);
  }

  const total = w * maxH;
  const mismatchPct = total ? ((changed + w * deltaH) / total) * 100 : 0;
  return {
    mismatchPct: Math.round(mismatchPct * 1000) / 1000,
    pass: mismatchPct <= threshold,
    changedPixels: changed,
    heightDeltaPx: deltaH,
    baseH: bi.naturalHeight, curH: ci.naturalHeight, width: w,
    diffDataUrl: out.toDataURL('image/png'),
  };
}

async function vrCompare(captures) {
  const { vrMeta = {} } = await chrome.storage.local.get('vrMeta');
  const threshold = Math.max(0, parseFloat(vrState.threshold) || 0.1);
  const pageResults = [];
  for (const c of captures) {
    if (c.skipped) { pageResults.push({ url: c.url, skipped: true }); continue; }
    const meta = vrMeta[c.url] || {};
    const entry = {
      url: c.url, ts: c.ts, threshold,
      error: c.error || null,
      baselineTs: meta.baseline?.ts || null,
      truncated: !!(c.truncated || meta.baseline?.truncated),
    };
    if (!entry.error && meta.baseline) {
      if (c.viewportW !== meta.baseline.viewportW) {
        // Dimension-mismatched diffs are noise, not signal — flag and skip.
        entry.viewportMismatch = { baseline: meta.baseline.viewportW, current: c.viewportW };
      } else {
        const baseImg = await idbGet('vrImages', 'baseline|' + c.url);
        if (!baseImg) {
          entry.error = 'Baseline image missing from storage — set a new baseline';
        } else {
          try {
            const diff = await vrDiffImages(baseImg, c.dataUrl, meta.baseline, c, threshold);
            await idbPut('vrImages', c.dataUrl, 'current|' + c.url);
            await idbPut('vrImages', diff.diffDataUrl, 'diff|' + c.url);
            delete diff.diffDataUrl;   // images stay in IndexedDB, not in the result/export
            Object.assign(entry, diff, { hasImages: true });
          } catch (e) {
            entry.error = 'Diff failed: ' + e.message;
          }
        }
      }
      vrMeta[c.url] = {
        ...meta,
        lastRun: { ts: c.ts, viewportW: c.viewportW, pageH: c.pageH, mismatchPct: entry.mismatchPct ?? null, pass: entry.pass ?? null },
      };
    } else if (!entry.error) {
      entry.error = 'No baseline stored for this page';
    }
    pageResults.push(entry);
  }
  await chrome.storage.local.set({ vrMeta });
  _vrLastRun = { ts: Date.now(), threshold, pages: pageResults };
  await renderVrResults(pageResults);
}

async function renderVrResults(pages) {
  const el = document.getElementById('vr-results');
  const compared = pages.filter(p => !p.skipped);
  const passed = compared.filter(p => p.pass === true).length;
  const failed = compared.filter(p => p.pass === false).length;
  const warned = compared.filter(p => p.viewportMismatch || (p.error && !p.pass)).length;

  const blocks = [];
  for (const p of pages) {
    if (p.skipped) {
      blocks.push(`<div class="ab-line ab-same-row">${esc(shortUrl(p.url))} — skipped (stopped)</div>`);
      continue;
    }
    let hdr;
    if (p.viewportMismatch) {
      hdr = `<span class="ab-warn">⚠ Viewport changed</span> — baseline ${p.viewportMismatch.baseline}px, now ${p.viewportMismatch.current}px. Pixel diff skipped: resize the window to match (or set a new baseline).`;
    } else if (p.error) {
      hdr = `<span class="ab-err">${esc(p.error)}</span>`;
    } else {
      const verdict = p.pass
        ? '<span style="color:var(--ok);font-weight:700">PASS</span>'
        : '<span style="color:var(--err);font-weight:700">FAIL</span>';
      hdr = `${verdict} — ${p.mismatchPct}% mismatch (threshold ${p.threshold}%)`
        + (p.heightDeltaPx ? ` · page height changed by ${p.heightDeltaPx}px` : '')
        + (p.truncated ? ' · <span class="ab-warn">capture truncated</span>' : '');
    }
    const meta = `baseline ${p.baselineTs ? new Date(p.baselineTs).toLocaleString() : '—'} · compared ${new Date(p.ts).toLocaleString()}`;

    let imgs = '';
    if (p.hasImages) {
      const [b, c, d] = await Promise.all([
        idbGet('vrImages', 'baseline|' + p.url),
        idbGet('vrImages', 'current|' + p.url),
        idbGet('vrImages', 'diff|' + p.url),
      ]);
      const thumb = (src, lbl) => src ? `
        <div class="vr-thumb">
          <img src="${src}" data-vr-open title="Click to open full size">
          <div class="vr-thumb-lbl">${lbl}</div>
        </div>` : '';
      imgs = `<div class="vr-thumbs">${thumb(b, 'Baseline')}${thumb(c, 'Current')}${thumb(d, 'Diff')}</div>`;
    }

    blocks.push(`
      <div class="ab-line">
        <b>${esc(shortUrl(p.url))}</b>
        <div class="ab-cline">${hdr}</div>
        <div class="ab-cline" style="color:var(--fg3)">${meta}</div>
        ${imgs}
      </div>`);
  }

  const summaryColor = failed ? 'var(--err)' : 'var(--ok)';
  el.innerHTML = `
    <div class="a11y-summary-bar">
      <span>${passed} passed · ${failed} failed${warned ? ` · ${warned} warning${warned !== 1 ? 's' : ''}` : ''}</span>
      <div class="row" style="gap:8px">
        <span class="a11y-summary-total" style="color:${summaryColor}">${failed ? failed + ' page' + (failed !== 1 ? 's' : '') + ' over threshold' : 'All within threshold'}</span>
        <button class="btn ghost btn-icon" data-vr-export title="Download results as JSON (images excluded)">Export</button>
        <button class="btn ghost btn-icon" data-clear-results title="Clear results">Clear</button>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px">${blocks.join('')}</div>`;

  el.querySelector('[data-clear-results]')?.addEventListener('click', () => { el.innerHTML = ''; });
  el.querySelector('[data-vr-export]')?.addEventListener('click', () => {
    if (!_vrLastRun) return;
    downloadJson(_vrLastRun, 'visual-regression-' + new Date(_vrLastRun.ts).toISOString().replace(/[:.]/g, '-') + '.json');
  });
  el.querySelectorAll('[data-vr-open]').forEach(img => {
    img.addEventListener('click', () => openImageInTab(img.getAttribute('src')));
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Test Modes: Cross-Variant Accessibility Mode subpage (#testmode-sub-5)
// ═════════════════════════════════════════════════════════════════════════════
// Hybrid of the WCAG mode (audit engine — performWcagAudit in background) and
// the A/B mode (variant-loading machinery). Runs the same audit against every
// variant and diffs findings vs the baseline: Introduced / Resolved /
// Pre-existing. Never touches the Build tab queue.

let cvaState = null;
let _cvaLastRun = null;
let _cvaProgressPoller = null;

function cvaDefaultState() {
  return {
    baseUrl: '', qaMode: false, settleSec: '3', keepTabs: false, scope: '',
    includeManual: false,
    checks: WCAG_CHECKS.filter(c => !c.manual).map(c => c.key),
    targets: [
      { label: 'Control',   url: '', override: '' },
      { label: 'Variant A', url: '', override: '' },
    ],
  };
}

async function initCvaMode() {
  if (!document.getElementById('cva-target-list')) return;
  const { cvaModeState } = await chrome.storage.session.get('cvaModeState');
  cvaState = { ...cvaDefaultState(), ...(cvaModeState || {}) };
  if (!Array.isArray(cvaState.targets) || !cvaState.targets.length) cvaState.targets = cvaDefaultState().targets;
  if (!Array.isArray(cvaState.checks)) cvaState.checks = cvaDefaultState().checks;

  applyCvaStateToInputs();

  document.getElementById('cva-base-url').addEventListener('input',        e => { cvaState.baseUrl = e.target.value;          persistCvaState(); });
  document.getElementById('cva-qa-mode').addEventListener('change',        e => { cvaState.qaMode = e.target.checked;         persistCvaState(); });
  document.getElementById('cva-settle').addEventListener('input',          e => { cvaState.settleSec = e.target.value;        persistCvaState(); });
  document.getElementById('cva-keep-tabs').addEventListener('change',      e => { cvaState.keepTabs = e.target.checked;       persistCvaState(); });
  document.getElementById('cva-scope').addEventListener('input',           e => { cvaState.scope = e.target.value;            persistCvaState(); });
  document.getElementById('cva-include-manual').addEventListener('change', e => { cvaState.includeManual = e.target.checked;  persistCvaState(); });

  document.getElementById('btn-cva-scope-pick')?.addEventListener('click', () => {
    const row = document.getElementById('cva-scope-row');
    startPicker(row, null, 'cva-scope', (selector) => {
      const val = selector.css || (selector.idValue ? '#' + selector.idValue : '');
      document.getElementById('cva-scope').value = val;
      cvaState.scope = val;
      persistCvaState();
    });
  });

  document.getElementById('btn-cva-add-target').addEventListener('click', () => {
    cvaState.targets.push({ label: 'Variant ' + String.fromCharCode(64 + cvaState.targets.length), url: '', override: '' });
    renderCvaTargets();
    persistCvaState();
  });

  document.getElementById('btn-cva-save-set').addEventListener('click', saveCvaSet);
  document.getElementById('btn-cva-load-set').addEventListener('click', loadCvaSet);
  document.getElementById('btn-cva-delete-set').addEventListener('click', deleteCvaSet);
  document.getElementById('btn-run-cva').addEventListener('click', runCvaAudit);
  document.getElementById('btn-cva-stop').addEventListener('click', () =>
    chrome.runtime.sendMessage({ action: 'stop' }));

  renderCvaTargets();
  renderCvaChecks();
  await refreshCvaSets();
}

function applyCvaStateToInputs() {
  document.getElementById('cva-base-url').value          = cvaState.baseUrl || '';
  document.getElementById('cva-qa-mode').checked         = !!cvaState.qaMode;
  document.getElementById('cva-settle').value            = cvaState.settleSec || '3';
  document.getElementById('cva-keep-tabs').checked       = !!cvaState.keepTabs;
  document.getElementById('cva-scope').value             = cvaState.scope || '';
  document.getElementById('cva-include-manual').checked  = !!cvaState.includeManual;
}

function persistCvaState() {
  chrome.storage.session.set({ cvaModeState: cvaState });
}

function renderCvaTargets() {
  const list = document.getElementById('cva-target-list');
  const q = s => esc(s || '').replace(/"/g, '&quot;');
  list.innerHTML = cvaState.targets.map((t, i) => `
    <div class="ab-target" data-cva-target="${i}">
      <div class="arg-row">
        <span class="arg-lbl">Label</span>
        <input type="text" data-cva-field="label" value="${q(t.label)}" placeholder="e.g. Variant A">
        <button class="btn-icon" data-cva-rm-target title="Remove variant" style="color:var(--err)">✕</button>
      </div>
      <div class="arg-row">
        <span class="arg-lbl">URL</span>
        <input type="text" data-cva-field="url" value="${q(t.url)}" placeholder="(uses base URL)">
      </div>
      <div class="arg-row">
        <span class="arg-lbl">Override</span>
        <input type="text" data-cva-field="override" value="${q(t.override)}" placeholder="e.g. optimizely_x=123456">
      </div>
    </div>`).join('');

  list.querySelectorAll('[data-cva-target]').forEach(block => {
    const i = +block.dataset.cvaTarget;
    block.querySelectorAll('[data-cva-field]').forEach(inp => {
      inp.addEventListener('input', () => {
        cvaState.targets[i][inp.dataset.cvaField] = inp.value;
        persistCvaState();
      });
    });
    block.querySelector('[data-cva-rm-target]').addEventListener('click', () => {
      cvaState.targets.splice(i, 1);
      renderCvaTargets();
      persistCvaState();
    });
  });
}

// Automated checks only — the manual/infoOnly checks produce identical
// guidance on every variant, so they live behind the single "include manual
// checks" toggle instead of individual checkboxes.
function renderCvaChecks() {
  const list = document.getElementById('cva-check-list');
  if (!list) return;
  list.innerHTML = WCAG_CHECKS.filter(c => !c.manual).map(c => `
    <label class="suite-check">
      <input type="checkbox" name="cva-check" value="${c.key}"${cvaState.checks.includes(c.key) ? ' checked' : ''}>
      ${esc(c.label)} <span style="color:var(--fg3);font-size:10px">${esc(c.sc)}</span>
    </label>`).join('');
  list.querySelectorAll('input[name="cva-check"]').forEach(cb => {
    cb.addEventListener('change', () => {
      cvaState.checks = [...list.querySelectorAll('input[name="cva-check"]:checked')].map(x => x.value);
      persistCvaState();
    });
  });
}

// ── Saved variant target sets (chrome.storage.sync, namespaced to this mode
// so the list never collides with the A/B mode's sets) ────────────────────────
async function refreshCvaSets() {
  const { cvaVariantSets = {} } = await chrome.storage.sync.get('cvaVariantSets');
  const names = Object.keys(cvaVariantSets).sort();
  const sel = document.getElementById('cva-set-select');
  sel.innerHTML = names.length
    ? names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')
    : '<option disabled>&lt;no saved sets&gt;</option>';
}

async function saveCvaSet() {
  const name = document.getElementById('cva-set-name').value.trim();
  if (!name) { alert('Enter a set name.'); return; }
  const { cvaVariantSets = {} } = await chrome.storage.sync.get('cvaVariantSets');
  cvaVariantSets[name] = JSON.parse(JSON.stringify(cvaState));
  await chrome.storage.sync.set({ cvaVariantSets });
  await refreshCvaSets();
  document.getElementById('cva-set-select').value = name;
  document.getElementById('cva-set-name').value = '';
  alert(`"${name}" saved.`);
}

async function loadCvaSet() {
  const name = document.getElementById('cva-set-select').value || '';
  if (!name) { alert('Select a saved set first.'); return; }
  const { cvaVariantSets = {} } = await chrome.storage.sync.get('cvaVariantSets');
  if (!cvaVariantSets[name]) return;
  cvaState = { ...cvaDefaultState(), ...cvaVariantSets[name] };
  applyCvaStateToInputs();
  renderCvaTargets();
  renderCvaChecks();
  persistCvaState();
}

async function deleteCvaSet() {
  const name = document.getElementById('cva-set-select').value || '';
  if (!name) return;
  if (!confirm(`Delete "${name}"?`)) return;
  const { cvaVariantSets = {} } = await chrome.storage.sync.get('cvaVariantSets');
  delete cvaVariantSets[name];
  await chrome.storage.sync.set({ cvaVariantSets });
  await refreshCvaSets();
}

// ── Run ───────────────────────────────────────────────────────────────────────
async function runCvaAudit() {
  const btn       = document.getElementById('btn-run-cva');
  const stopBtn   = document.getElementById('btn-cva-stop');
  const resultsEl = document.getElementById('cva-results');

  const targets = cvaState.targets
    .map(t => ({ label: (t.label || '').trim() || 'Variant', url: composeVariantUrl(t, cvaState.baseUrl, cvaState.qaMode) }))
    .filter(t => t.url);
  if (targets.length < 2) {
    resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Define at least two variant targets with a URL (or set a base URL). The first target is the baseline.</div>';
    return;
  }
  const autoChecks = cvaState.checks.filter(k => WCAG_CHECKS.some(c => c.key === k && !c.manual));
  if (!autoChecks.length) {
    resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Select at least one check.</div>';
    return;
  }
  const checks = cvaState.includeManual ? [...autoChecks, ...WCAG_MANUAL_KEYS] : autoChecks;
  const scope = (cvaState.scope || '').trim();

  btn.disabled = true;
  btn.textContent = 'Running…';
  stopBtn.style.display = '';
  resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Auditing variants…</div>';
  _cvaProgressPoller = setInterval(async () => {
    const { cvaProgress } = await chrome.storage.session.get('cvaProgress');
    if (cvaProgress?.running) {
      btn.textContent = `Running ${cvaProgress.index + 1}/${cvaProgress.total}…`;
      resultsEl.innerHTML = `<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Auditing ${esc(cvaProgress.label)} (${cvaProgress.index + 1} of ${cvaProgress.total})…</div>`;
    }
  }, 400);

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'runCrossVariantAudit',
      payload: { targets, settleSeconds: cvaState.settleSec, keepTabs: cvaState.keepTabs, checks, scope },
    });
    if (!res?.ok) throw new Error(res?.error || 'Audit failed');
    const runs = (res.results || []).filter(r => !r.skipped);
    if (runs.length < 2) {
      resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Stopped before two variants were audited — nothing to compare.</div>';
      return;
    }
    _cvaLastRun = { ts: Date.now(), scope, autoChecks, includeManual: cvaState.includeManual, runs };
    renderCvaResults(_cvaLastRun);
  } catch (e) {
    resultsEl.innerHTML = '<div style="color:var(--err);font-size:12px;padding:6px 0">Error: ' + esc(e.message) + '</div>';
  } finally {
    clearInterval(_cvaProgressPoller);
    _cvaProgressPoller = null;
    btn.disabled = false;
    btn.textContent = 'Run Cross-Variant Audit';
    stopBtn.style.display = 'none';
  }
}

// ── Diff (pure function over the collected result sets) ──────────────────────
// Issue identity: normalized string (trim, collapse whitespace), matched
// exactly within its check. axe node-target strings can differ across runs for
// the same underlying issue — a known v1 limitation; no fuzzy matching.
function diffCvaRuns(runs, checkKeys) {
  const norm = s => String(s).replace(/\s+/g, ' ').trim();
  const issuesOf = (r, k) => {
    const c = r.results?.[k];
    return c && !c.infoOnly ? (c.issues || []).map(norm) : null;
  };
  const base = runs[0];
  const variants = runs.slice(1).map(r => {
    if (r.loadError || !r.results) {
      return { label: r.label, url: r.url, tabId: r.tabId || null, loadError: r.loadError || 'No results', perCheck: [], introduced: 0, resolved: 0, preexisting: 0 };
    }
    const perCheck = [];
    let ti = 0, tr = 0, tp = 0;
    for (const k of checkKeys) {
      const bv = base.loadError ? null : issuesOf(base, k);
      const cv = issuesOf(r, k);
      if (bv == null && cv == null) continue;
      const bset = new Set(bv || []);
      const cset = new Set(cv || []);
      const introduced  = [...cset].filter(x => !bset.has(x));
      const resolved    = [...bset].filter(x => !cset.has(x));
      const preexisting = [...cset].filter(x => bset.has(x));
      perCheck.push({ key: k, introduced, resolved, preexisting });
      ti += introduced.length; tr += resolved.length; tp += preexisting.length;
    }
    return { label: r.label, url: r.url, tabId: r.tabId || null, loadError: null, perCheck, introduced: ti, resolved: tr, preexisting: tp };
  });
  return { base, variants };
}

// Highlight an issue's element in the variant tab it was found in (kept open
// via keep-tabs), falling back to the active tab; degrades with an inline note.
async function cvaHighlight(selector, tabId, rowEl) {
  let res = null;
  try {
    res = await chrome.runtime.sendMessage({ action: 'highlightElement', tabId: tabId || null, selector });
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

function renderCvaResults(run) {
  const el = document.getElementById('cva-results');
  const checkMeta = Object.fromEntries(WCAG_CHECKS.map(c => [c.key, c]));
  const diff = diffCvaRuns(run.runs, run.autoChecks);
  const base = diff.base;

  const issueHtml = (text, cls, tabId) => {
    const target = extractIssueTarget(text);
    const locAttrs = target
      ? ` class="a11y-issue a11y-issue-loc ${cls}" data-loc="${esc(target).replace(/"/g, '&quot;')}" data-cva-tab="${tabId || ''}" title="Click to highlight this element on the page"`
      : ` class="a11y-issue ${cls}"`;
    return `<div${locAttrs}>${esc(text)}</div>`;
  };

  const blocks = [];
  const notes = [];
  for (const r of run.runs) {
    if (r.scopeError) notes.push(`${r.label}: ${r.scopeError}`);
    if (r.axeError)   notes.push(`${r.label}: axe-core could not run (${r.axeError}) — heuristics only.`);
  }
  if (run.scope && !notes.length) notes.push('Scoped to: ' + run.scope);

  // Baseline block — its findings as-is (everything here is "pre-existing" by
  // definition; the interesting buckets live on the variants below).
  if (base.loadError) {
    blocks.push(`<div class="ab-line"><b>${esc(base.label)}</b> <span style="color:var(--fg3)">(baseline)</span> — <span class="ab-err">Load failure: ${esc(base.loadError)}</span><div class="ab-cline ab-warn">Variants below are shown against an empty baseline — every issue counts as introduced.</div></div>`);
  } else {
    const rows = run.autoChecks.filter(k => base.results?.[k]).map(k => {
      const c = base.results[k];
      const count = c.issues.length;
      const dot = count ? 'a11y-fail-dot' : 'a11y-pass-dot';
      const body = count ? `<div class="a11y-body">${c.issues.map(t => issueHtml(t, '', base.tabId)).join('')}</div>` : '';
      return `
        <div class="a11y-row" data-suite-row>
          <div class="a11y-row-hdr">
            <span class="a11y-dot ${dot}"></span>
            <span class="a11y-row-label">${esc(checkMeta[k]?.label || k)}</span>
            <span class="a11y-wcag">${esc(checkMeta[k]?.sc || '')}</span>
            <span class="a11y-count">${count ? count + ' issue' + (count !== 1 ? 's' : '') : 'Pass'}</span>
            ${count ? '<span class="a11y-chevron">›</span>' : ''}
          </div>
          ${body}
        </div>`;
    });
    const baseTotal = run.autoChecks.reduce((n, k) => n + (base.results?.[k]?.issues.length || 0), 0);
    blocks.push(`
      <div class="a11y-summary-bar" style="margin-top:2px">
        <span><b>${esc(base.label)}</b> (baseline)</span>
        <span class="a11y-summary-total" style="color:${baseTotal ? 'var(--warn)' : 'var(--ok)'}">${baseTotal} issue${baseTotal !== 1 ? 's' : ''}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">${rows.join('')}</div>`);
  }

  // Variant blocks — Introduced expanded (error styling), Resolved positive,
  // Pre-existing collapsed/greyed but never hidden entirely.
  for (const v of diff.variants) {
    if (v.loadError) {
      blocks.push(`<div class="ab-line" style="margin-top:8px"><b>${esc(v.label)}</b> — <span class="ab-err">Load failure: ${esc(v.loadError)}</span></div>`);
      continue;
    }
    const sumColor = v.introduced ? 'var(--err)' : 'var(--ok)';
    const rows = v.perCheck
      .filter(pc => pc.introduced.length || pc.resolved.length || pc.preexisting.length)
      .map(pc => {
        const parts = [];
        if (pc.introduced.length)  parts.push(pc.introduced.length + ' introduced');
        if (pc.resolved.length)    parts.push(pc.resolved.length + ' resolved');
        if (pc.preexisting.length) parts.push(pc.preexisting.length + ' pre-existing');
        const dot = pc.introduced.length ? 'a11y-fail-dot' : (pc.resolved.length ? 'a11y-pass-dot' : 'a11y-skip-dot');
        const body = `
          ${pc.introduced.map(t => issueHtml(t, 'cva-issue-intro', v.tabId)).join('')}
          ${pc.resolved.map(t => `<div class="a11y-issue cva-issue-res">${esc(t)}</div>`).join('')}
          ${pc.preexisting.length ? `
            <details class="cva-pre">
              <summary>${pc.preexisting.length} pre-existing issue${pc.preexisting.length !== 1 ? 's' : ''} (identical to baseline)</summary>
              ${pc.preexisting.map(t => issueHtml(t, '', v.tabId)).join('')}
            </details>` : ''}`;
        return `
          <div class="a11y-row${pc.introduced.length ? ' open' : ''}" data-suite-row>
            <div class="a11y-row-hdr">
              <span class="a11y-dot ${dot}"></span>
              <span class="a11y-row-label">${esc(checkMeta[pc.key]?.label || pc.key)}</span>
              <span class="a11y-wcag">${esc(checkMeta[pc.key]?.sc || '')}</span>
              <span class="a11y-count">${parts.join(' · ')}</span>
              <span class="a11y-chevron">›</span>
            </div>
            <div class="a11y-body">${body}</div>
          </div>`;
      });
    blocks.push(`
      <div class="a11y-summary-bar" style="margin-top:8px">
        <span><b>${esc(v.label)}</b></span>
        <span class="a11y-summary-total" style="color:${sumColor}">${v.introduced} introduced · ${v.resolved} resolved · ${v.preexisting} pre-existing</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">${rows.join('') || '<div class="ab-line ab-same-row">No issues in this variant or the baseline for the selected checks.</div>'}</div>`);
  }

  // Manual checks render once — identical guidance on every variant.
  if (run.includeManual && !base.loadError) {
    const manualRows = WCAG_MANUAL_KEYS.filter(k => base.results?.[k]).map(k => {
      const c = base.results[k];
      const guide = WCAG_MANUAL_GUIDE[k] || [];
      return `
        <div class="a11y-row" data-suite-row>
          <div class="a11y-row-hdr">
            <span class="a11y-dot a11y-info-dot"></span>
            <span class="a11y-row-label">${esc(checkMeta[k]?.label || k)}</span>
            <span class="a11y-wcag">${esc(checkMeta[k]?.sc || '')}</span>
            <span class="a11y-count">Manual</span>
            <span class="a11y-chevron">›</span>
          </div>
          <div class="a11y-body">
            ${c.issues.map(t => `<div class="a11y-issue">${esc(t)}</div>`).join('')}
            ${guide.length ? `<div class="a11y-guide-title">Verify by hand (on every variant):</div>${guide.map(g => `<div class="a11y-guide-item">${esc(g)}</div>`).join('')}` : ''}
          </div>
        </div>`;
    });
    blocks.push(`
      <div class="a11y-summary-bar" style="margin-top:8px"><span>Manual checks — apply to every variant</span></div>
      <div style="display:flex;flex-direction:column;gap:4px">${manualRows.join('')}</div>`);
  }

  const totalIntroduced = diff.variants.reduce((n, v) => n + v.introduced, 0);
  el.innerHTML = `
    <div class="a11y-summary-bar">
      <span>Baseline: ${esc(base.label)}</span>
      <div class="row" style="gap:8px">
        <span class="a11y-summary-total" style="color:${totalIntroduced ? 'var(--err)' : 'var(--ok)'}">${totalIntroduced} introduced issue${totalIntroduced !== 1 ? 's' : ''} across variants</span>
        <button class="btn ghost btn-icon" data-cva-export title="Download results as JSON">Export</button>
        <button class="btn ghost btn-icon" data-clear-results title="Clear results">Clear</button>
      </div>
    </div>
    ${notes.length ? `<div style="color:var(--fg3);font-size:11px;padding:2px 2px 6px">${notes.map(esc).join(' · ')}</div>` : ''}
    ${blocks.join('')}`;

  el.querySelectorAll('[data-suite-row] .a11y-row-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => hdr.closest('[data-suite-row]').classList.toggle('open'));
  });
  el.querySelector('[data-clear-results]')?.addEventListener('click', () => { el.innerHTML = ''; });
  el.querySelector('[data-cva-export]')?.addEventListener('click', () => exportCvaResults(diff, run));
  el.querySelectorAll('.a11y-issue-loc').forEach(row => {
    row.addEventListener('click', () =>
      cvaHighlight(row.dataset.loc, parseInt(row.dataset.cvaTab, 10) || null, row));
  });
}

function exportCvaResults(diff, run) {
  const checkMeta = Object.fromEntries(WCAG_CHECKS.map(c => [c.key, c]));
  const data = {
    timestamp: new Date(run.ts).toISOString(),
    scope: run.scope || null,
    checks: run.autoChecks,
    baseline: {
      label: diff.base.label, url: diff.base.url, loadError: diff.base.loadError || null,
      issues: diff.base.loadError ? null : Object.fromEntries(run.autoChecks
        .filter(k => diff.base.results?.[k])
        .map(k => [k, diff.base.results[k].issues])),
    },
    variants: diff.variants.map(v => ({
      label: v.label, url: v.url, loadError: v.loadError,
      summary: { introduced: v.introduced, resolved: v.resolved, preexisting: v.preexisting },
      checks: v.perCheck.map(pc => ({
        key: pc.key,
        label: checkMeta[pc.key]?.label || pc.key,
        wcag: checkMeta[pc.key]?.sc || '',
        introduced: pc.introduced,
        resolved: pc.resolved,
        preexisting: pc.preexisting,
      })),
    })),
  };
  downloadJson(data, 'cross-variant-a11y-' + new Date(run.ts).toISOString().replace(/[:.]/g, '-') + '.json');
}

// ═════════════════════════════════════════════════════════════════════════════
// Test Modes: Performance/Load Mode subpage (#testmode-sub-6)
// ═════════════════════════════════════════════════════════════════════════════
// Background loads each page N times (fresh tab per run, sequential, cache
// optionally disabled over CDP) and returns raw per-run metrics; this side owns
// median math, budget evaluation, rendering, history, and export. Numbers come
// from a real browser on the user's machine — relative comparison, not lab
// absolutes. Never touches the Build tab queue.

const PERF_DEFAULT_BUDGETS = { lcp: 2500, cls: 0.1, ttfb: 800, load: 5000 };
const PERF_METRICS = [
  { key: 'ttfb', label: 'TTFB',                    unit: 'ms', budget: 'ttfb' },
  { key: 'fcp',  label: 'First Contentful Paint',  unit: 'ms' },
  { key: 'lcp',  label: 'LCP',                     unit: 'ms', budget: 'lcp' },
  { key: 'dcl',  label: 'DOMContentLoaded',        unit: 'ms' },
  { key: 'load', label: 'Load event',              unit: 'ms', budget: 'load' },
  { key: 'cls',  label: 'CLS',                     unit: '',   budget: 'cls', digits: 3 },
  { key: 'longTaskMs', label: 'Long-task time',    unit: 'ms' },
];

let perfState = null;      // { settleSec, runs, disableCache }
let perfBudgets = null;    // { lcp, cls, ttfb, load } — sync storage
let _perfLastRun = null;
let _perfProgressPoller = null;

function median(vals) {
  const v = vals.filter(x => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function fmtMetric(v, m) {
  if (v == null) return '—';
  const digits = m?.digits ?? 0;
  const n = digits ? v.toFixed(digits) : Math.round(v).toLocaleString();
  return n + (m?.unit ? ' ' + m.unit : '');
}

async function initPerfMode() {
  if (!document.getElementById('btn-perf-run')) return;
  const { perfModeState } = await chrome.storage.session.get('perfModeState');
  perfState = { settleSec: '3', runs: '3', disableCache: true, ...(perfModeState || {}) };
  const { perfBudgets: saved } = await chrome.storage.sync.get('perfBudgets');
  perfBudgets = { ...PERF_DEFAULT_BUDGETS, ...(saved || {}) };

  document.getElementById('perf-settle').value          = perfState.settleSec;
  document.getElementById('perf-runs').value            = perfState.runs;
  document.getElementById('perf-disable-cache').checked = !!perfState.disableCache;
  for (const k of ['lcp', 'cls', 'ttfb', 'load']) {
    const inp = document.getElementById('perf-budget-' + k);
    inp.value = perfBudgets[k];
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      if (!Number.isNaN(v) && v > 0) perfBudgets[k] = v;
      chrome.storage.sync.set({ perfBudgets });
    });
  }

  document.getElementById('perf-settle').addEventListener('input',          e => { perfState.settleSec = e.target.value;         persistPerfState(); });
  document.getElementById('perf-runs').addEventListener('input',            e => { perfState.runs = e.target.value;              persistPerfState(); });
  document.getElementById('perf-disable-cache').addEventListener('change',  e => { perfState.disableCache = e.target.checked;    persistPerfState(); });

  document.getElementById('btn-perf-run').addEventListener('click', runPerfMode);
  document.getElementById('btn-perf-stop').addEventListener('click', () =>
    chrome.runtime.sendMessage({ action: 'stop' }));
  document.getElementById('btn-perf-view-history')?.addEventListener('click', viewPerfHistoryRun);
  await renderPerfHistoryList();
}

function persistPerfState() {
  chrome.storage.session.set({ perfModeState: perfState });
}

async function runPerfMode() {
  const btn       = document.getElementById('btn-perf-run');
  const stopBtn   = document.getElementById('btn-perf-stop');
  const resultsEl = document.getElementById('perf-results');

  const pages = tmPagesFor('6');
  if (!pages.length) {
    resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Add at least one page URL above. Tip: add the same page twice with different override params to compare experiment variants.</div>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Running…';
  stopBtn.style.display = '';
  resultsEl.innerHTML = '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Measuring…</div>';
  _perfProgressPoller = setInterval(async () => {
    const { perfProgress } = await chrome.storage.session.get('perfProgress');
    if (perfProgress?.running) {
      const t = `page ${perfProgress.page}/${perfProgress.pages} · run ${perfProgress.run}/${perfProgress.runs}`;
      btn.textContent = `Running (${t})…`;
      resultsEl.innerHTML = `<div style="color:var(--fg3);font-size:12px;text-align:center;padding:10px 0">Measuring ${esc(shortUrl(perfProgress.label || ''))} — ${t}…</div>`;
    }
  }, 400);

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'runPerfMeasurement',
      payload: {
        pages, settleSeconds: perfState.settleSec,
        runsPerPage: perfState.runs, disableCache: perfState.disableCache,
      },
    });
    if (!res?.ok) throw new Error(res?.error || 'Measurement failed');
    const summarized = (res.results || []).map(p => ({
      url: p.url, ts: Date.now(), skipped: !!p.skipped && !p.runs.length,
      partial: !!p.skipped && p.runs.length > 0,
      runs: p.runs, summary: perfSummarize(p),
    }));
    _perfLastRun = { ts: Date.now(), budgets: { ...perfBudgets }, disableCache: perfState.disableCache, pages: summarized };
    renderPerfResults(_perfLastRun);
    await savePerfHistory(summarized);
  } catch (e) {
    resultsEl.innerHTML = '<div style="color:var(--err);font-size:12px;padding:6px 0">Error: ' + esc(e.message) + '</div>';
  } finally {
    clearInterval(_perfProgressPoller);
    _perfProgressPoller = null;
    btn.disabled = false;
    btn.textContent = 'Run Measurement';
    stopBtn.style.display = 'none';
  }
}

function perfSummarize(p) {
  const good = (p.runs || []).filter(r => !r.error);
  const medians = {};
  for (const m of PERF_METRICS) medians[m.key] = median(good.map(r => r[m.key]));
  medians.longTasks     = median(good.map(r => r.longTasks));
  medians.resourceCount = median(good.map(r => r.resourceCount));
  medians.transferBytes = median(good.map(r => r.transferBytes));
  medians.lateCount     = median(good.map(r => r.late?.count));
  medians.lateBytes     = median(good.map(r => r.late?.bytes));
  const byType = {};
  for (const t of ['script', 'css', 'img', 'font', 'other']) {
    byType[t] = {
      count: median(good.map(r => r.byType?.[t]?.count)),
      bytes: median(good.map(r => r.byType?.[t]?.bytes)),
    };
  }
  const verdicts = {};
  for (const m of PERF_METRICS) {
    if (!m.budget) continue;
    const v = medians[m.key];
    verdicts[m.key] = v == null ? null : (v <= perfBudgets[m.budget] ? 'ok' : 'over');
  }
  const jsErrors = [...new Set(good.flatMap(r => r.jsErrors || []))];
  const runErrors = (p.runs || []).map(r => r.error).filter(Boolean);
  return { medians, verdicts, byType, jsErrors, runErrors, runCount: good.length };
}

function perfPageBlock(pg, budgets, { compact = false } = {}) {
  const s = pg.summary;
  const overCount = Object.values(s.verdicts).filter(v => v === 'over').length;
  const bar = `
    <div class="a11y-summary-bar" style="margin-top:8px">
      <span><b>${esc(shortUrl(pg.url))}</b>${pg.partial ? ' <span class="ab-warn">(stopped early)</span>' : ''}</span>
      <span class="a11y-summary-total" style="color:${overCount ? 'var(--err)' : 'var(--ok)'}">${overCount ? overCount + ' metric' + (overCount !== 1 ? 's' : '') + ' over budget' : 'All budgets met'}</span>
    </div>`;
  if (!s.runCount) {
    return bar + `<div class="ab-line"><span class="ab-err">${esc(s.runErrors[0] || 'No successful runs')}</span></div>`;
  }

  const rows = PERF_METRICS.map(m => {
    const v = s.medians[m.key];
    const budget = m.budget ? budgets[m.budget] : null;
    const verdict = m.budget ? s.verdicts[m.key] : null;
    const verdictHtml = verdict === 'ok' ? '<span class="perf-ok">OK</span>'
      : verdict === 'over' ? '<span class="perf-over">OVER</span>'
      : '<span style="color:var(--fg3)">—</span>';
    const extra = m.key === 'longTaskMs' && s.medians.longTasks != null
      ? ` <span style="color:var(--fg3)">(${Math.round(s.medians.longTasks)} task${Math.round(s.medians.longTasks) !== 1 ? 's' : ''})</span>` : '';
    return `
      <tr>
        <td>${esc(m.label)}${extra}</td>
        <td style="${verdict === 'over' ? 'color:var(--err);font-weight:600' : verdict === 'ok' ? 'color:var(--ok)' : ''}">${fmtMetric(v, m)}</td>
        <td style="color:var(--fg2)">${budget != null ? '≤ ' + fmtMetric(budget, m) : '—'}</td>
        <td>${verdictHtml}</td>
      </tr>`;
  }).join('');

  const table = `
    <table class="perf-table">
      <tr><th>Metric</th><th>Median</th><th>Budget</th><th>Verdict</th></tr>
      ${rows}
    </table>`;

  let runsBlock = '';
  if (!compact && pg.runs?.length) {
    const runRows = pg.runs.map((r, i) => r.error
      ? `<div class="ab-cline ab-err">Run ${i + 1}: ${esc(r.error)}</div>`
      : `<div class="ab-cline">Run ${i + 1}: ${PERF_METRICS.map(m => `${esc(m.label)} ${fmtMetric(r[m.key], m)}`).join(' · ')}</div>`
    ).join('');
    runsBlock = `
      <div class="a11y-row" data-suite-row>
        <div class="a11y-row-hdr">
          <span class="a11y-dot a11y-info-dot"></span>
          <span class="a11y-row-label">Individual runs</span>
          <span class="a11y-count">${pg.runs.length} run${pg.runs.length !== 1 ? 's' : ''} · medians reported</span>
          <span class="a11y-chevron">›</span>
        </div>
        <div class="a11y-body">${runRows}</div>
      </div>`;
  }

  let resBlock = '';
  if (!compact) {
    const bt = s.byType;
    const parts = ['script', 'css', 'img', 'font', 'other']
      .filter(t => bt[t].count != null && bt[t].count > 0)
      .map(t => `${t} ${Math.round(bt[t].count)} (${fmtBytes(bt[t].bytes)})`);
    resBlock = `
      <div class="ab-line">
        Resources (median): ${s.medians.resourceCount != null ? Math.round(s.medians.resourceCount) : '—'} requests · ${fmtBytes(s.medians.transferBytes)}
        ${parts.length ? `<div class="ab-cline" style="color:var(--fg2)">${parts.join(' · ')}</div>` : ''}
        <div class="ab-cline ${s.medians.lateCount ? 'ab-warn' : ''}" title="Experiment scripts often inject resources late">After load event: ${s.medians.lateCount != null ? Math.round(s.medians.lateCount) : 0} request${Math.round(s.medians.lateCount || 0) !== 1 ? 's' : ''} · ${fmtBytes(s.medians.lateBytes || 0)}</div>
        ${s.jsErrors.length ? s.jsErrors.map(x => `<div class="ab-cline ab-err">JS error: ${esc(x)}</div>`).join('') : ''}
        ${s.runErrors.length ? s.runErrors.map(x => `<div class="ab-cline ab-err">Run failed: ${esc(x)}</div>`).join('') : ''}
      </div>`;
  }

  return bar + table + runsBlock + resBlock;
}

function renderPerfResults(run) {
  const el = document.getElementById('perf-results');
  const shown = run.pages.filter(p => !p.skipped);
  const skipped = run.pages.length - shown.length;
  const blocks = shown.map(p => perfPageBlock(p, run.budgets)).join('');
  const overTotal = shown.reduce((n, p) => n + Object.values(p.summary.verdicts).filter(v => v === 'over').length, 0);

  el.innerHTML = `
    <div class="a11y-summary-bar">
      <span>${shown.length} page${shown.length !== 1 ? 's' : ''} measured${skipped ? ` · ${skipped} skipped (stopped)` : ''}${run.disableCache ? ' · cache disabled' : ' · cache enabled'}</span>
      <div class="row" style="gap:8px">
        <span class="a11y-summary-total" style="color:${overTotal ? 'var(--err)' : 'var(--ok)'}">${overTotal ? overTotal + ' over budget' : 'All budgets met'}</span>
        <button class="btn ghost btn-icon" data-perf-export title="Download results as JSON">Export</button>
        <button class="btn ghost btn-icon" data-clear-results title="Clear results">Clear</button>
      </div>
    </div>
    <div style="font-size:10px;color:var(--fg3);padding:0 2px 4px">Measured in this browser on this machine and network — treat as relative comparison, not lab-grade absolutes.</div>
    ${blocks}`;

  el.querySelectorAll('[data-suite-row] .a11y-row-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => hdr.closest('[data-suite-row]').classList.toggle('open'));
  });
  el.querySelector('[data-clear-results]')?.addEventListener('click', () => { el.innerHTML = ''; });
  el.querySelector('[data-perf-export]')?.addEventListener('click', () => {
    downloadJson({
      timestamp: new Date(run.ts).toISOString(),
      budgets: run.budgets,
      cacheDisabled: !!run.disableCache,
      note: 'Measured in a real browser on the tester’s machine and network — relative comparison, not lab-grade absolutes.',
      pages: run.pages.map(p => ({
        url: p.url, skipped: !!p.skipped,
        medians: p.summary?.medians, verdicts: p.summary?.verdicts,
        byType: p.summary?.byType, jsErrors: p.summary?.jsErrors,
        runs: p.runs,
      })),
    }, 'perf-measurement-' + new Date(run.ts).toISOString().replace(/[:.]/g, '-') + '.json');
  });
}

// ── Run history (medians + verdicts only, last 10 per URL) ───────────────────
const PERF_HISTORY_PER_URL = 10;

async function savePerfHistory(pages) {
  const { perfHistory = {} } = await chrome.storage.local.get('perfHistory');
  for (const p of pages) {
    if (p.skipped || !p.summary.runCount) continue;
    const arr = perfHistory[p.url] || [];
    arr.unshift({ ts: p.ts, medians: p.summary.medians, verdicts: p.summary.verdicts, runs: p.summary.runCount, budgets: { ...perfBudgets } });
    perfHistory[p.url] = arr.slice(0, PERF_HISTORY_PER_URL);
  }
  await chrome.storage.local.set({ perfHistory });
  await renderPerfHistoryList();
}

async function renderPerfHistoryList() {
  const sel = document.getElementById('perf-history-select');
  if (!sel) return;
  const { perfHistory = {} } = await chrome.storage.local.get('perfHistory');
  const opts = [];
  for (const [url, runs] of Object.entries(perfHistory)) {
    runs.forEach((r, i) => opts.push({ url, i, ts: r.ts }));
  }
  opts.sort((a, b) => b.ts - a.ts);
  sel.innerHTML = opts.length
    ? opts.map(o => `<option value="${encodeURIComponent(o.url)}|${o.i}">${new Date(o.ts).toLocaleString()} — ${esc(shortUrl(o.url))}</option>`).join('')
    : '<option disabled>&lt;no past runs&gt;</option>';
}

async function viewPerfHistoryRun() {
  const v = document.getElementById('perf-history-select')?.value || '';
  const bar = v.lastIndexOf('|');
  if (bar < 0) return;
  const url = decodeURIComponent(v.slice(0, bar));
  const idx = +v.slice(bar + 1);
  const { perfHistory = {} } = await chrome.storage.local.get('perfHistory');
  const h = perfHistory[url]?.[idx];
  if (!h) return;
  const el = document.getElementById('perf-results');
  const pg = { url, ts: h.ts, runs: [], summary: { medians: h.medians, verdicts: h.verdicts, byType: {}, jsErrors: [], runErrors: [], runCount: h.runs } };
  el.innerHTML = `
    <div class="a11y-summary-bar">
      <span>History — ${new Date(h.ts).toLocaleString()} (${h.runs} run${h.runs !== 1 ? 's' : ''}, medians only)</span>
      <button class="btn ghost btn-icon" data-clear-results title="Clear results">Clear</button>
    </div>
    ${perfPageBlock(pg, h.budgets || perfBudgets, { compact: true })}`;
  el.querySelector('[data-clear-results]')?.addEventListener('click', () => { el.innerHTML = ''; });
}

// ═════════════════════════════════════════════════════════════════════════════
// Test Modes: Session Replay / Heatmap Mode subpage (#testmode-sub-7)
// ═════════════════════════════════════════════════════════════════════════════
// Records the tester's OWN session on the active tab (clicks, scroll, metric
// fires) and plays it back as an overlay + timeline. Background owns the live
// buffer (recording survives the panel closing); this side owns IndexedDB
// session storage, the saved-sessions list, timeline rendering, and overlay
// orchestration. No data ever leaves the browser.

const SR_SESSION_CAP = 20;
let _srViewedSession = null;
let _srFilter = '';
let _srStatusPoller = null;

function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

async function initSrMode() {
  if (!document.getElementById('btn-sr-record')) return;

  document.getElementById('btn-sr-record').addEventListener('click', srStartRecording);
  document.getElementById('btn-sr-stop').addEventListener('click', srStopRecording);
  document.getElementById('btn-sr-overlay-show').addEventListener('click', srShowOverlay);
  document.getElementById('btn-sr-overlay-hide').addEventListener('click', () =>
    chrome.runtime.sendMessage({ action: 'sessionHideOverlay' }));

  document.querySelectorAll('#sr-filter-btns [data-sr-filter]').forEach(b => {
    b.addEventListener('click', () => {
      _srFilter = b.dataset.srFilter;
      document.querySelectorAll('#sr-filter-btns [data-sr-filter]').forEach(x => {
        x.style.background = x === b ? 'var(--brand)' : '';
        x.style.color = x === b ? '#fff' : '';
      });
      renderSrTimeline();
    });
  });

  // Background is the source of truth for a live recording — the panel just
  // re-syncs on open and keeps polling, so recording survives close/reopen.
  await syncSrStatus();
  _srStatusPoller = setInterval(syncSrStatus, 800);
  await renderSrSessions();
}

async function srStartRecording() {
  const label = document.getElementById('sr-label').value.trim();
  const captureMove = document.getElementById('sr-capture-move').checked;
  const res = await chrome.runtime.sendMessage({ action: 'sessionRecordStart', label, captureMove });
  if (!res?.ok) alert('Could not start recording: ' + (res?.error || 'unknown error'));
  await syncSrStatus();
}

async function srStopRecording() {
  const res = await chrome.runtime.sendMessage({ action: 'sessionRecordStop' });
  if (res?.ok && res.session) await srSaveSession(res.session);
  await syncSrStatus();
}

async function syncSrStatus() {
  const { srStatus, srFinishedSession } = await chrome.storage.session.get(['srStatus', 'srFinishedSession']);
  // A recording whose tab was closed finalizes in background — pick it up here.
  if (srFinishedSession) {
    await chrome.storage.session.remove('srFinishedSession');
    await srSaveSession(srFinishedSession);
  }
  const rec = !!srStatus?.recording;
  const recordBtn = document.getElementById('btn-sr-record');
  const stopBtn   = document.getElementById('btn-sr-stop');
  const live      = document.getElementById('sr-live');
  if (!recordBtn) return;
  recordBtn.disabled = rec;
  stopBtn.disabled = !rec;
  if (rec) {
    live.innerHTML = `<span style="color:var(--err)">●</span> Recording${srStatus.label ? ' “' + esc(srStatus.label) + '”' : ''} — ${fmtDur(Date.now() - srStatus.startedAt)} · ${srStatus.eventCount} event${srStatus.eventCount !== 1 ? 's' : ''}${srStatus.capped ? ' · <span class="ab-warn">capped at 10k</span>' : ''}`;
  } else {
    live.textContent = '○ Not recording';
  }
}

async function srSaveSession(session) {
  const pages = [...new Set((session.segments || []).map(s => shortUrl(s.url)))];
  const rec = { ...session, pages, duration: (session.endedAt || Date.now()) - session.startedAt };
  try {
    await idbPut('sessions', rec);
    // Retention cap — oldest-first eviction.
    const all = await idbGetAll('sessions');
    if (all.length > SR_SESSION_CAP) {
      all.sort((a, b) => a.startedAt - b.startedAt);
      for (const s of all.slice(0, all.length - SR_SESSION_CAP)) await idbDelete('sessions', s.id);
    }
  } catch (e) {
    alert('Could not save session: ' + e.message);
  }
  await renderSrSessions();
}

async function renderSrSessions() {
  const el = document.getElementById('sr-session-list');
  if (!el) return;
  let sessions = [];
  try { sessions = await idbGetAll('sessions'); } catch (_) {}
  sessions.sort((a, b) => b.startedAt - a.startedAt);
  if (!sessions.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--fg3)">No saved sessions yet — click Record, walk the page, then Stop.</div>';
    return;
  }
  el.innerHTML = sessions.map(s => `
    <div class="sr-session-row" data-sr-id="${s.id}">
      <div class="sr-session-main">
        <div>${esc(s.label || 'Untitled session')}${s.capped ? ' <span class="ab-warn">(capped)</span>' : ''}</div>
        <div class="sr-session-sub">${new Date(s.startedAt).toLocaleString()} · ${fmtDur(s.duration || 0)} · ${(s.events || []).length} events · ${esc((s.pages || []).slice(0, 2).join(', '))}${(s.pages || []).length > 2 ? ' +' + (s.pages.length - 2) : ''}</div>
      </div>
      <button class="btn sm" data-sr-view>View</button>
      <button class="btn-icon" data-sr-export title="Export session JSON">⭳</button>
      <button class="btn-icon" data-sr-delete title="Delete session" style="color:var(--err)">✕</button>
    </div>`).join('');

  el.querySelectorAll('.sr-session-row').forEach(row => {
    const id = +row.dataset.srId;
    row.querySelector('[data-sr-view]').addEventListener('click', () => viewSrSession(id));
    row.querySelector('[data-sr-export]').addEventListener('click', async () => {
      const s = await idbGet('sessions', id);
      if (s) downloadJson(s, 'session-' + (s.label || 'untitled').replace(/[^\w-]+/g, '-').toLowerCase() + '-' + new Date(s.startedAt).toISOString().replace(/[:.]/g, '-') + '.json');
    });
    row.querySelector('[data-sr-delete]').addEventListener('click', async () => {
      if (!confirm('Delete this session?')) return;
      await idbDelete('sessions', id);
      if (_srViewedSession?.id === id) {
        _srViewedSession = null;
        document.getElementById('sr-viewer').style.display = 'none';
      }
      await renderSrSessions();
    });
  });
}

async function viewSrSession(id) {
  const s = await idbGet('sessions', id);
  if (!s) return;
  _srViewedSession = s;
  document.getElementById('sr-viewer').style.display = '';
  document.getElementById('sr-viewer-title').textContent =
    (s.label || 'Untitled session') + ' — ' + new Date(s.startedAt).toLocaleString();
  document.getElementById('sr-overlay-warn').textContent = '';
  renderSrTimeline();
}

// Chronological items for the timeline: navigations (from segments), clicks,
// scroll milestones, and metric fires. Mouse-movement samples are overlay-only.
function srTimelineItems(s) {
  const items = [];
  (s.segments || []).forEach((seg, i) => items.push({ type: 'nav', t: seg.t, text: seg.url, seg: i }));
  let lastDepth = -100;
  for (const e of (s.events || [])) {
    if (e.type === 'move') continue;
    if (e.type === 'scroll') {
      // Milestones only — raw samples arrive ~4/sec and would flood the list.
      if (Math.abs((e.depth || 0) - lastDepth) < 10) continue;
      lastDepth = e.depth || 0;
    }
    items.push(e);
  }
  items.sort((a, b) => a.t - b.t);
  return items;
}

function renderSrTimeline() {
  const el = document.getElementById('sr-timeline');
  const s = _srViewedSession;
  if (!el || !s) return;
  const items = srTimelineItems(s).filter(e => !_srFilter || e.type === _srFilter);
  if (!items.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--fg3);padding:8px">No events' + (_srFilter ? ' of this type' : '') + '.</div>';
    return;
  }
  const badge = { click: 'CLICK', scroll: 'SCROLL', metric: 'METRIC', nav: 'NAV' };
  el.innerHTML = items.map(e => {
    const ts = fmtDur(e.t - s.startedAt);
    let text, cls = '';
    if (e.type === 'click') {
      text = (e.sel ? e.sel + ' ' : '') + `(${Math.round(e.x)}, ${Math.round(e.y)})`;
      cls = ' sr-ev-click';
    } else if (e.type === 'scroll') {
      text = `scrolled to ${e.depth}% depth`;
    } else if (e.type === 'metric') {
      text = e.text;
    } else {
      text = e.text;
    }
    return `
      <div class="sr-ev${cls}"${e.type === 'click' && e.sel ? ` data-sr-sel="${esc(e.sel).replace(/"/g, '&quot;')}" title="Click to highlight this element on the page"` : ''}>
        <span class="sr-ev-ts">${ts}</span>
        <span class="sr-ev-badge${e.type === 'metric' ? ' sr-ev-metric-badge' : ''}">${badge[e.type] || e.type}</span>
        <span class="sr-ev-text">${esc(text || '')}</span>
      </div>`;
  }).join('');

  el.querySelectorAll('[data-sr-sel]').forEach(row => {
    row.addEventListener('click', async () => {
      const res = await chrome.runtime.sendMessage({ action: 'highlightElement', tabId: null, selector: row.dataset.srSel });
      if ((!res?.ok || !res.found) && !row.querySelector('.a11y-loc-miss')) {
        const note = document.createElement('span');
        note.className = 'a11y-loc-miss';
        note.textContent = ' — not found on the current page';
        note.style.color = 'var(--fg3)';
        row.appendChild(note);
        setTimeout(() => note.remove(), 2500);
      }
    });
  });
}

async function srShowOverlay() {
  const s = _srViewedSession;
  if (!s) return;
  const warnEl = document.getElementById('sr-overlay-warn');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const strip = u => { try { const x = new URL(u); return x.origin + x.pathname; } catch (_) { return u || ''; } };
  const cur = strip(tab?.url);

  // Prefer segments recorded at the current page's URL; fall back to all
  // segments with a warning if the tab is somewhere else.
  let segIdxs = (s.segments || []).map((seg, i) => (strip(seg.url) === cur ? i : -1)).filter(i => i >= 0);
  if (!segIdxs.length) {
    segIdxs = (s.segments || []).map((_, i) => i);
    warnEl.textContent = '⚠ The active tab is not at this session’s URL — overlay points may not line up.';
  } else {
    warnEl.textContent = '';
  }
  const segSet = new Set(segIdxs);
  const ref = (s.segments || [])[segIdxs[0]] || {};
  const events = s.events || [];
  const payload = {
    label: s.label || '',
    segPageW: ref.pageW, segPageH: ref.pageH,
    clicks: events.filter(e => e.type === 'click' && segSet.has(e.seg)).map(e => ({ x: e.x, y: e.y })),
    trail: events.filter(e => e.type === 'move' && segSet.has(e.seg)).slice(0, 3000).map(e => ({ x: e.x, y: e.y })),
    maxDepth: Math.max(0, ...events.filter(e => e.type === 'scroll' && segSet.has(e.seg)).map(e => e.maxDepth || e.depth || 0)),
  };
  const res = await chrome.runtime.sendMessage({ action: 'sessionShowOverlay', payload });
  if (!res?.ok) warnEl.textContent = 'Could not show overlay: ' + (res?.error || 'unknown error');
}
