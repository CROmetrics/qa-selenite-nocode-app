"""
Selenite — No-Code QA Runner
Web-based UI: starts a local HTTP server and opens the browser.
Works identically on Windows and macOS with no extra dependencies.

Originally created and developed by William Wiley. Forked for Cro Metrics.
"""
import os, json, inspect, threading, time, webbrowser, platform
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import functions
from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.firefox.options import Options as FirefoxOptions
from selenium.webdriver.edge.options import Options as EdgeOptions

# ── App state ─────────────────────────────────────────────────────────────
available_functions = {
    name: func
    for name, func in inspect.getmembers(functions, inspect.isfunction)
}
function_args = {
    name: list(inspect.signature(func).parameters.keys())[1:]
    for name, func in available_functions.items()
}
function_docs = {
    name: func.__doc__ or "No description."
    for name, func in available_functions.items()
}

# ── Friendly display names (internal key → label shown in UI) ─────────────
DISPLAY_NAMES = {
    "open_url":                  "Open URL",
    "get_current_url":           "Get Current URL",
    "get_title":                 "Get Page Title",
    "back":                      "Go Back",
    "forward":                   "Go Forward",
    "refresh":                   "Refresh Page",
    "maximize_window":           "Maximize Window",
    "minimize_window":           "Minimize Window",
    "implicit_wait":             "Set Implicit Wait",
    "explicit_wait":             "Wait for Element (CSS)",
    "click_by_id":               "Click — By ID",
    "click_by_name":             "Click — By Name",
    "click_by_xpath":            "Click — By XPath",
    "click_by_css":              "Click — By CSS Selector",
    "click_by_link_text":        "Click — By Link Text",
    "fill_by_id":                "Fill Field — By ID",
    "fill_by_name":              "Fill Field — By Name",
    "fill_by_xpath":             "Fill Field — By XPath",
    "fill_by_css":               "Fill Field — By CSS Selector",
    "submit_by_id":              "Submit Form — By ID",
    "submit_by_xpath":           "Submit Form — By XPath",
    "select_by_name":            "Select Dropdown Option — By Name",
    "send_keys_action":          "Send Keyboard Input",
    "switch_to_frame_by_name":   "Switch to Frame",
    "switch_to_default_content": "Switch to Main Page",
    "switch_to_parent_frame":    "Switch to Parent Frame",
    "switch_to_window":          "Switch to Window",
    "accept_alert":              "Accept Alert",
    "dismiss_alert":             "Dismiss Alert",
    "get_alert_text":            "Get Alert Text",
    "wait_seconds":              "Wait (seconds)",
    "close_browser":             "Close Browser",
}
log_entries  = []
stop_event   = threading.Event()
_active_driver = None
_lock = threading.Lock()

CUSTOM_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "custom")
os.makedirs(CUSTOM_DIR, exist_ok=True)

PORT = 8765

# ── Selenium helpers ─────────────────────────────────────────────────────
def _get_driver(browser):
    if browser == "Chrome":
        o = ChromeOptions()
        o.set_capability("goog:loggingPrefs", {"browser": "ALL"})
        return webdriver.Chrome(options=o)
    if browser == "Firefox":
        return webdriver.Firefox(options=FirefoxOptions())
    if browser == "Edge":
        return webdriver.Edge(options=EdgeOptions())
    raise Exception(f"Unsupported browser: {browser}")

def _log(level, msg):
    log_entries.append({"level": level, "text": msg, "ts": time.strftime("%H:%M:%S")})

def _poll_browser(driver, stop_evt):
    while not stop_evt.is_set():
        try:
            for e in driver.get_log("browser"):
                raw = e.get("level", "INFO").upper()
                lv  = "ERROR" if raw == "SEVERE" else (raw if raw in ("INFO", "WARNING") else "INFO")
                _log("BROWSER", f"{lv}  {e.get('message', '')}")
        except Exception:
            pass
        time.sleep(0.5)

def _exec(browser, queue, mode):
    global _active_driver
    try:
        _log("INFO", f"Starting {browser}")
        driver = _get_driver(browser)
        with _lock:
            _active_driver = driver
        if browser == "Chrome":
            threading.Thread(
                target=_poll_browser, args=(driver, stop_event), daemon=True
            ).start()
        while not stop_event.is_set():
            for step in queue:
                if not step.get("enabled", True) or stop_event.is_set():
                    continue
                fn   = step["func"]
                args = [step["inputs"].get(a, "") for a in function_args[fn]]
                d    = int(step.get("delay", 0)) if str(step.get("delay", "0")).isdigit() else 0
                if d:
                    time.sleep(d)
                _log("INFO", f"→ {fn}({', '.join(str(a) for a in args)})")
                try:
                    r = available_functions[fn](driver, *args)
                    if r is not None:
                        _log("INFO", f"← {r}")
                except Exception as err:
                    _log("ERROR", f"✖ {fn}: {err}")
                    raise
            if mode == "close":
                break
        _log("INFO", "Complete")
        if mode == "close":
            driver.quit()
    except Exception as exc:
        _log("ERROR", f"Error: {exc}")
    finally:
        with _lock:
            _active_driver = None

# ── HTML template ─────────────────────────────────────────────────────────
HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Selenite — No-Code QA Runner</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{
    --canvas:#1C1C1C;--surface:#242424;--card:#2C2C2C;--overlay:#3D3D3D;
    --stroke:#444;--brand:#0078D4;--brand-h:#106EBE;
    --fg1:#F0F0F0;--fg2:#AAAAAA;--fg3:#666;
    --err:#F48771;--warn:#CCA700;--ok:#89D185;--info:#4FC1FF;
    --radius:8px;--font:'Segoe UI',system-ui,-apple-system,sans-serif;
  }
  html,body{height:100%;background:var(--canvas);color:var(--fg1);font-family:var(--font);font-size:14px}
  body{display:flex;flex-direction:column;height:100vh;overflow:hidden}

  /* Header */
  #hdr{background:var(--brand);padding:10px 20px;flex-shrink:0}
  #hdr h1{font-size:20px;font-weight:700;color:#fff}
  #hdr p{font-size:12px;color:#BFD9EF;margin-top:2px}

  /* Main split */
  #main{display:flex;flex-direction:column;flex:1;overflow:hidden;gap:0}
  #top{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
  #bottom{height:220px;flex-shrink:0;padding:0 12px 12px}

  /* Cards */
  .card{background:var(--card);border-radius:var(--radius);border:1px solid var(--stroke);padding:14px 16px}
  .card-title{font-size:14px;font-weight:600;text-align:center;padding-bottom:8px;
    border-bottom:1px solid var(--stroke);margin-bottom:10px}

  /* Form elements */
  label.cap{font-size:10px;color:var(--fg2);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px}
  input[type=text],input[type=url]{
    width:100%;background:var(--overlay);border:1px solid var(--stroke);border-radius:4px;
    color:var(--fg1);padding:6px 10px;font-size:14px;outline:none;font-family:var(--font);
    transition:border .15s;
  }
  input[type=text]:focus,input[type=url]:focus{border-color:var(--brand)}
  select{background:var(--overlay);border:1px solid var(--stroke);border-radius:4px;
    color:var(--fg1);padding:6px 10px;font-size:14px;outline:none;cursor:pointer}
  select:focus{border-color:var(--brand)}

  /* Toggle radio buttons */
  .radio-group{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
  .radio-group input{display:none}
  .radio-group label{
    background:var(--overlay);color:var(--fg2);border:1px solid var(--stroke);
    border-radius:4px;padding:5px 14px;cursor:pointer;font-size:13px;
    transition:background .15s,color .15s,border .15s;
  }
  .radio-group input:checked+label{background:var(--brand);color:#fff;border-color:var(--brand)}
  .radio-group label:hover{background:var(--stroke)}

  /* Buttons */
  .btn{
    background:var(--overlay);color:var(--fg1);border:1px solid var(--stroke);
    border-radius:4px;padding:6px 14px;cursor:pointer;font-size:13px;font-family:var(--font);
    transition:background .1s;white-space:nowrap;
  }
  .btn:hover{background:var(--stroke)}
  .btn.primary{background:var(--brand);color:#fff;border-color:var(--brand)}
  .btn.primary:hover{background:var(--brand-h)}
  .btn.primary:disabled{background:#333;color:#666;border-color:#333;cursor:not-allowed}
  .btn.danger{background:#3A1010;color:var(--err);border-color:#5A1A1A}
  .btn.danger:hover{background:#5A1A1A}
  .btn.danger:disabled{background:#222;color:#555;border-color:#333;cursor:not-allowed}
  .btn.ghost{background:transparent;color:var(--fg2);border-color:transparent}
  .btn.ghost:hover{background:var(--overlay)}
  .btn.active-filter{background:var(--brand);color:#fff;border-color:var(--brand)}
  .btn-icon{background:transparent;color:var(--fg2);border:none;border-radius:4px;
    padding:2px 7px;cursor:pointer;font-size:14px;line-height:1.5;transition:background .1s}
  .btn-icon:hover{background:var(--overlay)}

  /* Row layouts */
  .row{display:flex;align-items:center;gap:8px}
  .row-spread{display:flex;align-items:center;justify-content:space-between;gap:8px}

  /* Script row */
  .script-row{display:flex;gap:8px;margin-top:4px}
  .script-row input,.script-row select{flex:1}

  /* Queue */
  #q-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
  #q-hdr-left{display:flex;align-items:center;gap:8px}
  #step-count{font-size:11px;color:var(--fg2)}
  #step-list{display:flex;flex-direction:column;gap:6px;min-height:60px}
  #empty-msg{color:var(--fg3);text-align:center;padding:20px;font-size:13px}

  /* Step card */
  .step{background:var(--surface);border:1px solid var(--stroke);border-radius:6px;padding:10px 12px;display:flex;gap:10px;align-items:flex-start}
  .step-ctrl{display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0}
  .step-ctrl input[type=checkbox]{width:16px;height:16px;cursor:pointer;accent-color:var(--brand)}
  .step-fn{flex-shrink:0;min-width:190px}
  .step-doc{font-size:11px;color:var(--fg2);margin-top:3px;max-width:200px}
  .step-delay{display:flex;align-items:center;gap:6px;margin-top:6px}
  .step-delay input{width:60px}
  .step-args{flex:1;display:flex;flex-direction:column;gap:4px}
  .arg-row{display:flex;align-items:center;gap:6px}
  .arg-row .cap{min-width:90px;margin-bottom:0}
  .arg-row input{flex:1}
  .no-args{font-size:12px;color:var(--fg3);padding-top:4px}
  .step-rm{flex-shrink:0;align-self:flex-start}

  /* Console */
  #console-card{background:var(--card);border:1px solid var(--stroke);border-radius:var(--radius);
    height:100%;display:flex;flex-direction:column;padding:10px 14px}
  #con-hdr{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}
  #con-hdr .title{font-size:14px;font-weight:600}
  #filter-input{flex:1;min-width:120px;max-width:200px}
  #filter-btns{display:flex;gap:3px;margin-left:auto}
  #log-out{flex:1;overflow-y:auto;background:#141414;border-radius:4px;
    font-family:'Cascadia Code','Menlo','Courier New',monospace;font-size:12px;
    padding:8px 10px;line-height:1.6}
  .log-INFO{color:#89D185}
  .log-WARNING{color:#CCA700}
  .log-ERROR{color:#F48771}
  .log-BROWSER{color:#4FC1FF}

  @media (prefers-color-scheme: light){
    :root{--canvas:#F3F3F3;--surface:#fff;--card:#fff;--overlay:#E8E8E8;--stroke:#D0D0D0;
      --fg1:#1A1A1A;--fg2:#555;--fg3:#AAA}
    #log-out{background:#1A1A1A}
  }
</style>
</head>
<body>
<div id="hdr">
  <h1>Selenite</h1>
  <p>No-Code QA Runner</p>
</div>
<div id="main">
  <div id="top">

    <!-- Browser & URL -->
    <div class="card">
      <div class="card-title">Browser &amp; Target URL</div>
      <div class="radio-group" style="margin-bottom:12px">
        <input type="radio" name="browser" id="br-chrome" value="Chrome" checked>
        <label for="br-chrome">Chrome</label>
        <input type="radio" name="browser" id="br-firefox" value="Firefox">
        <label for="br-firefox">Firefox</label>
        <input type="radio" name="browser" id="br-edge" value="Edge">
        <label for="br-edge">Edge</label>
      </div>
      <label class="cap" for="url-input">Target URL</label>
      <input type="url" id="url-input" value="https://" placeholder="https://example.com" style="margin-bottom:12px">
      <div style="text-align:center;margin-bottom:4px"><span class="cap" style="display:inline">Execution Mode</span></div>
      <div class="radio-group">
        <input type="radio" name="mode" id="mode-close" value="close" checked>
        <label for="mode-close">Close after run</label>
        <input type="radio" name="mode" id="mode-loop" value="loop">
        <label for="mode-loop">Loop continuously</label>
      </div>
    </div>

    <!-- Scripts -->
    <div class="card">
      <div class="card-title">Scripts</div>
      <label class="cap">Save Script</label>
      <div class="script-row" style="margin-bottom:10px">
        <input type="text" id="save-name" placeholder="script name">
        <button class="btn" onclick="saveScript()">Save</button>
      </div>
      <label class="cap">Load Script</label>
      <div class="script-row">
        <select id="script-select"><option>Loading…</option></select>
        <button class="btn" onclick="loadScript()">Load</button>
      </div>
    </div>

    <!-- Function Queue -->
    <div class="card" style="flex:1">
      <div id="q-hdr">
        <div id="q-hdr-left">
          <span class="card-title" style="border:none;padding:0;margin:0">Function Queue</span>
          <span id="step-count">0 steps</span>
        </div>
        <div class="row">
          <button class="btn" onclick="addStep()">+ Add Step</button>
          <button id="btn-run" class="btn primary" onclick="runQueue()">Execute</button>
          <button id="btn-stop" class="btn danger" onclick="stopQueue()" disabled>Stop</button>
        </div>
      </div>
      <div id="step-list">
        <div id="empty-msg">No steps yet — click + Add Step to begin</div>
      </div>
    </div>

  </div><!-- /top -->

  <!-- Console -->
  <div id="bottom">
    <div id="console-card">
      <div id="con-hdr">
        <span class="title">Console Log</span>
        <input type="text" class="btn" id="filter-input" placeholder="Filter…" oninput="renderLog()" style="padding:4px 10px;font-size:12px">
        <div id="filter-btns">
          <button class="btn btn-icon active-filter" onclick="setFilter(null,this)">ALL</button>
          <button class="btn btn-icon" onclick="setFilter('INFO',this)">INFO</button>
          <button class="btn btn-icon" onclick="setFilter('WARNING',this)">WARN</button>
          <button class="btn btn-icon" onclick="setFilter('ERROR',this)">ERR</button>
          <button class="btn btn-icon" onclick="setFilter('BROWSER',this)">BRW</button>
          <button class="btn ghost btn-icon" onclick="clearLog()">Clear</button>
        </div>
      </div>
      <div id="log-out"></div>
    </div>
  </div>
</div>

<script>
const FN_META = {};       // filled on init
let steps = [];           // [{id, enabled, func, delay, inputs:{}}]
let nextId = 1;
let logData = [];
let filterLevel = null;
let logOffset = 0;
let pollTimer;

// ── Init ─────────────────────────────────────────────────────────────────
async function init(){
  const r = await fetch('/api/functions');
  const data = await r.json();
  Object.assign(FN_META, data);
  await refreshScripts();
  pollTimer = setInterval(pollLogs, 500);
}

// ── Log polling ───────────────────────────────────────────────────────────
async function pollLogs(){
  const r = await fetch('/api/logs?offset='+logOffset);
  const data = await r.json();
  if(data.entries.length){
    logData.push(...data.entries);
    logOffset = data.next_offset;
    renderLog();
  }
}

function renderLog(){
  const needle = document.getElementById('filter-input').value.trim().toLowerCase();
  const out = document.getElementById('log-out');
  const atBottom = out.scrollHeight - out.scrollTop <= out.clientHeight + 4;
  out.innerHTML = logData
    .filter(e => (!filterLevel || e.level===filterLevel) && (!needle||e.text.toLowerCase().includes(needle)))
    .map(e=>`<div class="log-${e.level}">[${e.level}] ${escHtml(e.text)}</div>`)
    .join('');
  if(atBottom) out.scrollTop = out.scrollHeight;
}

function escHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function setFilter(lv, btn){
  filterLevel = lv;
  document.querySelectorAll('#filter-btns .btn-icon').forEach(b=>{b.classList.remove('active-filter')});
  btn.classList.add('active-filter');
  renderLog();
}

function clearLog(){
  fetch('/api/logs/clear',{method:'POST'});
  logData=[];logOffset=0;
  document.getElementById('log-out').innerHTML='';
}

// ── Run / Stop ────────────────────────────────────────────────────────────
async function runQueue(){
  const url = document.getElementById('url-input').value.trim();
  if(!url.startsWith('http')){ alert('URL must start with http or https.'); return; }
  const browser = document.querySelector('input[name=browser]:checked').value;
  const mode    = document.querySelector('input[name=mode]:checked').value;
  document.getElementById('btn-run').disabled = true;
  document.getElementById('btn-stop').disabled = false;
  const payload = { url, browser, mode, queue: steps.map(s=>({
    func: s.func, enabled: s.enabled, delay: s.delay,
    inputs: s.inputs
  }))};
  const r = await fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!r.ok) alert(await r.text());
}

async function stopQueue(){
  await fetch('/api/stop',{method:'POST'});
}

// ── Status polling for run state ──────────────────────────────────────────
setInterval(async ()=>{
  const r = await fetch('/api/status');
  const d = await r.json();
  document.getElementById('btn-run').disabled  = d.running;
  document.getElementById('btn-stop').disabled = !d.running;
}, 800);

// ── Scripts ───────────────────────────────────────────────────────────────
async function refreshScripts(){
  const r = await fetch('/api/scripts');
  const files = await r.json();
  const sel = document.getElementById('script-select');
  sel.innerHTML = files.length
    ? files.map(f=>`<option value="${f}">${f}</option>`).join('')
    : '<option>&lt;no scripts&gt;</option>';
}

async function saveScript(){
  const name = document.getElementById('save-name').value.trim();
  if(!name){alert('Enter a script name.');return;}
  const payload = steps.map(s=>({func:s.func,enabled:s.enabled,delay:s.delay,inputs:s.inputs}));
  const r = await fetch('/api/scripts/save',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name,steps:payload})
  });
  if(r.ok){ alert(`'${name}' saved.`); await refreshScripts(); }
  else alert(await r.text());
}

async function loadScript(){
  const name = document.getElementById('script-select').value;
  if(!name||name==='<no scripts>') return;
  const r = await fetch('/api/scripts/load?name='+encodeURIComponent(name));
  if(!r.ok){alert(await r.text());return;}
  const data = await r.json();
  steps = [];
  nextId = 1;
  document.getElementById('step-list').innerHTML = '';
  data.forEach(s=>addStep(s));
}

// ── Queue steps ───────────────────────────────────────────────────────────
function addStep(data){
  const fnNames = Object.keys(FN_META).sort((a,b)=>(FN_META[a].label||a).localeCompare(FN_META[b].label||b));
  const id = nextId++;
  const fn = data?.func || fnNames[0];
  const step = {id, enabled: data?.enabled ?? true, func: fn,
                delay: data?.delay ?? '0', inputs: data?.inputs ?? {}};
  steps.push(step);

  const el = document.createElement('div');
  el.className = 'step';
  el.id = 'step-'+id;
  el.innerHTML = buildStepHTML(step, fnNames);
  document.getElementById('step-list').appendChild(el);

  // wire up events
  el.querySelector('.fn-select').addEventListener('change', e=>{
    step.func = e.target.value;
    step.inputs = {};
    el.querySelector('.step-args').innerHTML = buildArgsHTML(step);
    el.querySelector('.step-doc').textContent = FN_META[step.func]?.doc||'';
    wireArgs(el, step);
  });
  el.querySelector('.en-chk').addEventListener('change', e=>{ step.enabled = e.target.checked; });
  el.querySelector('.delay-in').addEventListener('input',  e=>{ step.delay = e.target.value; });
  el.querySelector('.rm-btn').addEventListener('click', ()=> removeStep(id));
  el.querySelector('.up-btn').addEventListener('click', ()=> moveStep(id,-1));
  el.querySelector('.dn-btn').addEventListener('click', ()=> moveStep(id,1));
  wireArgs(el, step);

  // restore saved inputs
  if(data?.inputs){
    for(const [k,v] of Object.entries(data.inputs)){
      const inp = el.querySelector(`[data-arg="${k}"]`);
      if(inp){ inp.value=v; step.inputs[k]=v; }
    }
  }
  updateCount();
}

function buildStepHTML(step, fnNames){
  const opts = fnNames.map(n=>`<option value="${n}"${n===step.func?' selected':''}>${FN_META[n]?.label||n}</option>`).join('');
  return `
    <div class="step-ctrl">
      <input type="checkbox" class="en-chk"${step.enabled?' checked':''}>
      <button class="btn-icon up-btn">↑</button>
      <button class="btn-icon dn-btn">↓</button>
    </div>
    <div class="step-fn">
      <label class="cap">Function</label>
      <select class="fn-select">${opts}</select>
      <div class="step-doc">${FN_META[step.func]?.doc||''}</div>
      <div class="step-delay">
        <label class="cap" style="margin:0">Delay (s)</label>
        <input type="text" class="delay-in" value="${step.delay||0}" style="width:55px">
      </div>
    </div>
    <div class="step-args">${buildArgsHTML(step)}</div>
    <button class="btn-icon rm-btn step-rm" style="color:#F48771">✕</button>
  `;
}

function buildArgsHTML(step){
  const args = FN_META[step.func]?.args || [];
  if(!args.length) return '<div class="no-args">No arguments</div>';
  return args.map(a=>`
    <div class="arg-row">
      <label class="cap" style="margin:0;min-width:90px">${a}</label>
      <input type="text" data-arg="${a}" value="${escHtml(step.inputs[a]||'')}">
    </div>`).join('');
}

function wireArgs(el, step){
  el.querySelectorAll('[data-arg]').forEach(inp=>{
    inp.addEventListener('input', e=>{ step.inputs[inp.dataset.arg] = e.target.value; });
  });
}

function removeStep(id){
  const i = steps.findIndex(s=>s.id===id);
  if(i>=0) steps.splice(i,1);
  document.getElementById('step-'+id)?.remove();
  updateCount();
}

function moveStep(id, dir){
  const i = steps.findIndex(s=>s.id===id);
  const j = i+dir;
  if(j<0||j>=steps.length) return;
  [steps[i],steps[j]]=[steps[j],steps[i]];
  const list = document.getElementById('step-list');
  const all  = [...list.children].filter(c=>c.id.startsWith('step-'));
  const a = all[i], b = all[j];
  if(dir<0) list.insertBefore(a,b); else list.insertBefore(b,a);
}

function updateCount(){
  const n = steps.length;
  document.getElementById('step-count').textContent = n+' step'+(n!==1?'s':'');
  const empty = document.getElementById('empty-msg');
  if(empty) empty.style.display = n?'none':'block';
}

init();
</script>
</body>
</html>"""

# ── HTTP handler ─────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # suppress server-side request logs

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text, status=200):
        body = text.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path   = parsed.path

        if path == "/":
            body = HTML.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", len(body))
            self.end_headers()
            self.wfile.write(body)

        elif path == "/api/functions":
            data = {
                name: {
                    "args":  function_args[name],
                    "doc":   (function_docs[name] or "")[:80],
                    "label": DISPLAY_NAMES.get(name, name.replace("_", " ").title()),
                }
                for name in available_functions
            }
            self.send_json(data)

        elif path == "/api/logs":
            qs     = parse_qs(parsed.query)
            offset = int(qs.get("offset", ["0"])[0])
            chunk  = log_entries[offset:]
            self.send_json({"entries": chunk, "next_offset": offset + len(chunk)})

        elif path == "/api/scripts":
            files = sorted(f for f in os.listdir(CUSTOM_DIR) if f.endswith(".json"))
            self.send_json(files)

        elif path.startswith("/api/scripts/load"):
            qs   = parse_qs(parsed.query)
            name = qs.get("name", [""])[0]
            fpath = os.path.join(CUSTOM_DIR, name)
            if not os.path.isfile(fpath):
                self.send_text(f"Script '{name}' not found.", 404); return
            with open(fpath) as f:
                self.send_json(json.load(f))

        elif path == "/api/status":
            self.send_json({"running": not stop_event.is_set() and _active_driver is not None})

        else:
            self.send_text("Not found", 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body   = self.rfile.read(length)

        if self.path == "/api/run":
            payload = json.loads(body)
            url     = payload.get("url", "")
            if not url.startswith("http"):
                self.send_text("URL must start with http or https.", 400); return
            # Build full queue with the URL-open step prepended
            queue = [{"func": "open_url", "enabled": True, "delay": "0",
                      "inputs": {"url": url}}] + payload.get("queue", [])
            stop_event.clear()
            threading.Thread(
                target=_exec,
                args=(payload.get("browser", "Chrome"), queue, payload.get("mode", "close")),
                daemon=True
            ).start()
            self.send_json({"ok": True})

        elif self.path == "/api/stop":
            stop_event.set()
            _log("WARNING", "Terminated by user")
            self.send_json({"ok": True})

        elif self.path == "/api/logs/clear":
            log_entries.clear()
            self.send_json({"ok": True})

        elif self.path == "/api/scripts/save":
            payload = json.loads(body)
            name    = payload.get("name", "").strip()
            if not name:
                self.send_text("Name required.", 400); return
            fpath = os.path.join(CUSTOM_DIR, f"{name}.json")
            with open(fpath, "w") as f:
                json.dump(payload.get("steps", []), f, indent=2)
            self.send_json({"ok": True})

        else:
            self.send_text("Not found", 404)

# ── Main ──────────────────────────────────────────────────────────────────
def main():
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Selenite running at http://127.0.0.1:{PORT}")
    print("Press Ctrl+C to quit.")
    # Open browser slightly after server starts
    threading.Timer(0.8, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    print("Shutting down.")

if __name__ == "__main__":
    main()
