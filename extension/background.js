// Selenite — background service worker
// Handles queue execution; writes logs to session storage so popup can read them.

// ── Open side panel when toolbar icon is clicked ──────────────────────────
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

// ── Persistent console capture ────────────────────────────────────────────
// Re-inject both capture scripts whenever the captured tab finishes loading.
// console-capture.js runs in MAIN world (can override console.*).
// console-bridge.js runs in ISOLATED world (can call chrome.runtime.sendMessage).
async function injectCapture(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['console-capture.js'], world: 'MAIN' });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['console-bridge.js'] });
}

// ── Full live-console mirror (Browser Console tab) via chrome.debugger/CDP ──
// The console.* patch above only ever sees the 5 methods it overrides, and only
// after injection — it structurally cannot see uncaught exceptions, network/CSP
// errors, or native deprecation warnings. Attaching the debugger protocol gives
// the same event stream DevTools itself uses, so this is a genuine mirror, not
// an approximation.
const CDP_VERSION = '1.3';
const BROWSER_CONSOLE_CAP = 1000;
let debuggerTabId = null;

async function addBrowserConsoleLog(entry) {
  const { browserConsoleLogs = [] } = await chrome.storage.session.get('browserConsoleLogs');
  browserConsoleLogs.push({ ts: new Date().toLocaleTimeString(), ...entry });
  if (browserConsoleLogs.length > BROWSER_CONSOLE_CAP) {
    const evicted = browserConsoleLogs.splice(0, browserConsoleLogs.length - BROWSER_CONSOLE_CAP);
    // Release remote object handles for evicted expandable entries so long
    // sessions don't pin objects in the page's memory indefinitely.
    for (const e of evicted) {
      if (e.objectId && debuggerTabId) {
        chrome.debugger.sendCommand({ tabId: debuggerTabId }, 'Runtime.releaseObject', { objectId: e.objectId }).catch(() => {});
      }
    }
  }
  await chrome.storage.session.set({ browserConsoleLogs });
}

function formatRemoteArg(o) {
  if (!o) return '';
  if (o.unserializableValue) return o.unserializableValue;
  if ('value' in o) return typeof o.value === 'string' ? o.value : JSON.stringify(o.value);
  if (o.description) return o.description;
  return o.type || '';
}

// One-line preview for eval() return values — same RemoteObject shape as
// console args, but objects/arrays get a constructor-labeled property preview
// (closer to what DevTools shows) instead of just their bare "description".
function formatEvalResult(o) {
  if (!o || o.type === 'undefined') return 'undefined';
  if (o.subtype === 'null') return 'null';
  if (o.unserializableValue) return o.unserializableValue;
  if (o.type === 'function') {
    const name = (o.description || '').match(/^(?:function\s*\*?\s*|get\s+|set\s+|class\s+|async\s+)*([\w$]*)/)?.[1] || '';
    return `ƒ ${name}()`;
  }
  if ('value' in o) return typeof o.value === 'string' ? JSON.stringify(o.value) : String(o.value);
  if (o.preview) {
    const props = (o.preview.properties || []).map(p => `${p.name}: ${p.value ?? p.type}`).join(', ');
    const overflow = o.preview.overflow ? ', …' : '';
    return o.subtype === 'array' ? `[${props}${overflow}]` : `${o.className || o.subtype || o.type} {${props}${overflow}}`;
  }
  if (o.description) return o.description;
  return o.type || 'undefined';
}

// Kept in sync with console-capture.js's tag list/casing and %c-stripping —
// the Browser Console's own CRO toggle filters on this "tagged" flag.
const TAGS = ['[pjs]', '[cro]'];
function formatConsoleArgs(args) {
  if (args.length && typeof args[0].value === 'string' && args[0].value.includes('%c')) {
    const cCount = (args[0].value.match(/%c/g) || []).length;
    const label  = args[0].value.replace(/%c/g, '').trim();
    const rest   = args.slice(1 + cCount).map(formatRemoteArg);
    return [label, ...rest].join(' ').trim();
  }
  return args.map(formatRemoteArg).join(' ');
}

const CONSOLE_TYPE_MAP = { error: 'ERROR', assert: 'ERROR', warning: 'WARNING', info: 'INFO', table: 'INFO', count: 'INFO' };
const LOG_LEVEL_MAP    = { verbose: 'BROWSER', info: 'INFO', warning: 'WARNING', error: 'ERROR' };

async function setDebuggerStatus(status) {
  await chrome.storage.session.set({ debuggerStatus: status });
}

async function attachDebugger(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, CDP_VERSION);
  } catch (e) {
    throw new Error(`Could not attach (is DevTools open on this tab?): ${e.message}`);
  }
  await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
  await chrome.debugger.sendCommand({ tabId }, 'Log.enable');
  debuggerTabId = tabId;
  await setDebuggerStatus({ attached: true, tabId, error: null });
}

async function detachDebugger(tabId) {
  if (!tabId) return;
  try { await chrome.debugger.detach({ tabId }); } catch (_) {}
  if (debuggerTabId === tabId) debuggerTabId = null;
  await setDebuggerStatus({ attached: false, tabId: null, error: null });
}

// ── Trusted input helpers ($click/$hover in the eval REPL) ─────────────────
// Runtime.evaluate runs JS *in the page*, so el.click()/dispatchEvent() there
// produces an untrusted event (isTrusted: false) — browsers won't open a native
// <select> popup from that, and some custom widgets gate on trusted input too.
// The Input domain instead simulates real OS-level mouse input, which Chrome
// treats as trusted — the same mechanism Puppeteer/Playwright rely on.
async function resolveElementCenter(tabId, selector) {
  const expression = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`;
  const res = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'evaluate failed');
  return res.result?.value || null;
}

async function dispatchTrustedHover(tabId, x, y) {
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
}

async function dispatchTrustedClick(tabId, x, y) {
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== debuggerTabId) return;
  if (method === 'Runtime.consoleAPICalled') {
    const level  = CONSOLE_TYPE_MAP[params.type] || 'BROWSER';
    const text   = formatConsoleArgs(params.args || []);
    const tagged = TAGS.some(tag => text.toLowerCase().includes(tag));
    // Only a single-arg call (e.g. console.log(myObject)) maps cleanly onto one
    // expandable reference — multi-arg calls keep the flattened text only.
    const single   = params.args && params.args.length === 1 ? params.args[0] : null;
    const objectId = single?.objectId || null;
    addBrowserConsoleLog({ level, text, source: 'console', tagged, objectId, expandable: !!objectId });
  } else if (method === 'Runtime.exceptionThrown') {
    const d    = params.exceptionDetails || {};
    const text = d.exception?.description || d.text || 'Uncaught exception';
    addBrowserConsoleLog({ level: 'ERROR', text: `Uncaught: ${text.split('\n')[0]}`, source: 'exception' });
  } else if (method === 'Log.entryAdded') {
    const e     = params.entry || {};
    const level = LOG_LEVEL_MAP[e.level] || 'BROWSER';
    addBrowserConsoleLog({ level, text: `[${e.source}] ${e.text}`, source: 'log' });
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId !== debuggerTabId) return;
  debuggerTabId = null;
  setDebuggerStatus({ attached: false, tabId: null, error: `Disconnected (${reason})` });
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const { captureTabId } = await chrome.storage.session.get('captureTabId');
  if (tabId !== captureTabId) return;
  try { await injectCapture(tabId); } catch (_) {}
  if (debuggerTabId !== tabId) {
    try { await attachDebugger(tabId); } catch (_) {}
  } else {
    // The CDP session survives navigation, but re-enabling defensively covers
    // the case where a new execution context drops domain state.
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
      await chrome.debugger.sendCommand({ tabId }, 'Log.enable');
    } catch (_) {}
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { captureTabId } = await chrome.storage.session.get('captureTabId');
  if (tabId === captureTabId) await chrome.storage.session.remove('captureTabId');
  if (tabId === debuggerTabId) await detachDebugger(tabId);
});

// ── Logging ───────────────────────────────────────────────────────────────
async function addLog(level, text, meta) {
  const { logs = [] } = await chrome.storage.session.get('logs');
  logs.push({ level, text, ts: new Date().toLocaleTimeString(), ...(meta || {}) });
  await chrome.storage.session.set({ logs });
}

// ── URL normalization ─────────────────────────────────────────────────────
function normalizeUrl(url) {
  if (!url) return url;
  url = url.trim();
  if (/^https?:\/\//i.test(url)) return url;
  return 'https://' + url;
}

// ── Tab helpers ───────────────────────────────────────────────────────────
function waitForLoad(tabId) {
  return new Promise((resolve) => {
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    // Resolve immediately if tab is already complete
    chrome.tabs.get(tabId, (tab) => {
      if (tab && tab.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

async function exec(tabId, fn, args) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: fn,
    args,
  });
  return results?.[0]?.result;
}

// ── Action implementations ────────────────────────────────────────────────
const ACTIONS = {

  open_url: async (tabId, { url }) => {
    await chrome.tabs.update(tabId, { url: normalizeUrl(url) });
    await waitForLoad(tabId);
  },

  get_current_url: async (tabId) => {
    const tab = await chrome.tabs.get(tabId);
    return tab.url;
  },

  get_title: async (tabId) => {
    const tab = await chrome.tabs.get(tabId);
    return tab.title;
  },

  back: async (tabId) => {
    await chrome.tabs.goBack(tabId);
    await waitForLoad(tabId);
  },

  forward: async (tabId) => {
    await chrome.tabs.goForward(tabId);
    await waitForLoad(tabId);
  },

  refresh: async (tabId) => {
    await chrome.tabs.reload(tabId);
    await waitForLoad(tabId);
  },

  maximize_window: async (tabId) => {
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { state: 'maximized' });
  },

  minimize_window: async (tabId) => {
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { state: 'minimized' });
  },

  implicit_wait: async (_tabId, { seconds }) => {
    await new Promise(r => setTimeout(r, parseFloat(seconds) * 1000));
  },

  wait_seconds: async (_tabId, { seconds }) => {
    await new Promise(r => setTimeout(r, parseFloat(seconds) * 1000));
  },

  explicit_wait: async (tabId, { css_selector, timeout }) => {
    const deadline = Date.now() + parseFloat(timeout) * 1000;
    while (Date.now() < deadline) {
      const found = await exec(tabId, (sel) => !!document.querySelector(sel), [css_selector]);
      if (found) return;
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error(`Timed out waiting for: ${css_selector}`);
  },

  click: async (tabId, { method, selector }) => {
    switch (method) {
      case 'id':
        await exec(tabId, (v) => {
          const el = document.getElementById(v);
          if (!el) throw new Error(`ID not found: ${v}`);
          el.click();
        }, [selector]);
        break;
      case 'name':
        await exec(tabId, (v) => {
          const el = document.querySelector(`[name="${v}"]`);
          if (!el) throw new Error(`Name not found: ${v}`);
          el.click();
        }, [selector]);
        break;
      case 'css':
        await exec(tabId, (v) => {
          const el = document.querySelector(v);
          if (!el) throw new Error(`CSS selector not found: ${v}`);
          // Surface the common silent failure: a submit CTA still disabled
          // because the form isn't valid yet (e.g. a field didn't register).
          if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
            throw new Error(`Element is disabled, click ignored: ${v} — check that prior fields filled & validated`);
          }
          // Some CTAs only respond to a full pointer/mouse sequence (they listen
          // on pointerdown/mousedown), not a bare programmatic click(). Fire the
          // realistic sequence, then click() as the final trigger.
          const opts = { bubbles: true, cancelable: true, view: window };
          el.scrollIntoView({ block: 'center' });
          el.focus();
          for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
            el.dispatchEvent(new MouseEvent(type, opts));
          }
          el.click();
        }, [selector]);
        break;
      case 'xpath':
        await exec(tabId, (v) => {
          const el = document.evaluate(v, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (!el) throw new Error(`XPath not found: ${v}`);
          el.click();
        }, [selector]);
        break;
      case 'link_text':
        await exec(tabId, (v) => {
          const el = [...document.querySelectorAll('a')].find(a => a.textContent.trim() === v);
          if (!el) throw new Error(`Link text not found: ${v}`);
          el.click();
        }, [selector]);
        break;
      default:
        throw new Error(`Unknown click method: ${method}`);
    }
  },

  fill: async (tabId, { method, selector, text }) => {
    await exec(tabId, (m, v, val) => {
      let el;
      if      (m === 'id')    el = document.getElementById(v);
      else if (m === 'name')  el = document.querySelector(`[name="${v}"]`);
      else if (m === 'css')   el = document.querySelector(v);
      else if (m === 'xpath') el = document.evaluate(v, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (!el) throw new Error(`Element not found (${m}): ${v}`);
      el.focus();
      // Set the value through the *native* prototype setter. Frameworks like
      // React override the element's value setter and track their own copy;
      // assigning el.value directly leaves their state thinking the field is
      // still empty, so the form stays invalid and its submit CTA won't fire.
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, val); else el.value = val;
      // Fire keyboard events too, so keyboard-driven widgets (autocomplete,
      // typeaheads) register the typing — input/change alone isn't enough.
      const kbd = { bubbles: true, cancelable: true, key: 'a', keyCode: 65 };
      el.dispatchEvent(new KeyboardEvent('keydown', kbd));
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', kbd));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      // Let any autocomplete dropdown render, then dismiss it with Escape so
      // its overlay doesn't swallow the next step's click/submit. Escape keeps
      // the typed value while closing the suggestion list.
      return new Promise((resolve) => {
        setTimeout(() => {
          const esc = { bubbles: true, cancelable: true, key: 'Escape', code: 'Escape', keyCode: 27, which: 27 };
          el.dispatchEvent(new KeyboardEvent('keydown', esc));
          el.dispatchEvent(new KeyboardEvent('keyup', esc));
          resolve();
        }, 150);
      });
    }, [method, selector, text]);
  },

  submit: async (tabId, { method, selector }) => {
    switch (method) {
      case 'id':
        await exec(tabId, (v) => {
          const el = document.getElementById(v);
          if (!el) throw new Error(`ID not found: ${v}`);
          el.closest('form').submit();
        }, [selector]);
        break;
      case 'xpath':
        await exec(tabId, (v) => {
          const el = document.evaluate(v, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (!el) throw new Error(`XPath not found: ${v}`);
          el.closest('form').submit();
        }, [selector]);
        break;
      case 'css':
        await exec(tabId, (v) => {
          const el = document.querySelector(v);
          if (!el) throw new Error(`CSS not found: ${v}`);
          el.closest('form').submit();
        }, [selector]);
        break;
      default:
        throw new Error(`Unknown submit method: ${method}`);
    }
  },

  select_by_name: async (tabId, { name, value }) => {
    await exec(tabId, (n, val) => {
      const el = document.querySelector(`select[name="${n}"]`);
      if (!el) throw new Error(`Select not found: ${n}`);
      el.value = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, [name, value]);
  },

  send_keys_action: async (tabId, { keys_sequence }) => {
    await exec(tabId, (keys) => {
      document.activeElement.value += keys;
      document.activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    }, [keys_sequence]);
  },

  switch_to: async (_tabId, { target, value }) => {
    switch (target) {
      case 'frame':
        await addLog('INFO', `Frame switching is not required in extension mode — scripting targets all frames. (Frame: ${value})`);
        break;
      case 'main':
        await addLog('INFO', 'Switch to main page — no-op in extension mode.');
        break;
      case 'parent':
        await addLog('INFO', 'Switch to parent frame — no-op in extension mode.');
        break;
      case 'window': {
        const tabs = await chrome.tabs.query({ title: value });
        if (tabs.length) await chrome.tabs.update(tabs[0].id, { active: true });
        else throw new Error(`Window not found: ${value}`);
        break;
      }
      default:
        throw new Error(`Unknown switch target: ${target}`);
    }
  },

  alert: async (_tabId, { action }) => {
    switch (action) {
      case 'accept':
        await addLog('WARNING', 'Accept alert: alerts are auto-dismissed in extensions. Use explicit_wait before this step if timing is needed.');
        break;
      case 'dismiss':
        await addLog('WARNING', 'Dismiss alert: alerts are auto-dismissed in extensions.');
        break;
      case 'get_text':
        await addLog('WARNING', 'Get alert text: not available in extensions — alerts are handled by the browser natively.');
        break;
      default:
        throw new Error(`Unknown alert action: ${action}`);
    }
  },

  close_browser: async (tabId) => {
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.remove(tab.windowId);
  },
};

// ── Execution loop ─────────────────────────────────────────────────────────
let _running = false;
let _stopRequested = false;

async function runQueue({ url, queue, mode, targetTabId, universalDelay }) {
  _running = true;
  _stopRequested = false;
  await chrome.storage.session.set({ running: true });

  // Resolve target tab — use provided tabId or open a new tab
  let tabId = targetTabId;
  if (!tabId) {
    const tab = await chrome.tabs.create({ url: url ? normalizeUrl(url) : 'about:blank', active: true });
    tabId = tab.id;
    await waitForLoad(tabId);
  } else {
    if (url) {
      await chrome.tabs.update(tabId, { url: normalizeUrl(url) });
      await waitForLoad(tabId);
    }
  }

  // Reset console feed and auto-attach capture to the test tab
  await chrome.storage.session.set({ logs: [], captureTabId: tabId });
  try { await injectCapture(tabId); } catch (_) {}

  await addLog('INFO', `Started on tab ${tabId}`);

  const fullQueue = [...queue];

  try {
    do {
      for (const step of fullQueue) {
        if (_stopRequested) break;
        if (!step.enabled) continue;

        const delaySec = universalDelay?.enabled
          ? parseFloat(universalDelay.seconds) || 0
          : parseFloat(step.delay) || 0;
        if (delaySec > 0) await new Promise(r => setTimeout(r, delaySec * 1000));

        const fn = ACTIONS[step.func];
        if (!fn) { await addLog('ERROR', `Unknown function: ${step.func}`); continue; }

        const argNames = ARG_NAMES[step.func] || [];
        const argMap = {};
        for (const a of argNames) argMap[a] = step.inputs?.[a] ?? '';

        const label = DISPLAY_NAMES[step.func] || step.func;
        const argStr = argNames.map(a => `${a}=${JSON.stringify(argMap[a])}`).join(', ');
        await addLog('INFO', `→ ${label}(${argStr})`);

        try {
          const result = await fn(tabId, argMap);
          if (result != null) await addLog('INFO', `← ${result}`);
        } catch (err) {
          await addLog('ERROR', `✖ ${label}: ${err.message}`);
          throw err;
        }
      }
      if (_stopRequested) break;
    } while (mode === 'loop');

    await addLog('INFO', 'Complete');
  } catch (e) {
    // already logged
  } finally {
    _running = false;
    _stopRequested = false;
    await chrome.storage.session.set({ running: false });
  }
}

// ── Arg name map (mirrors functions.py signatures) ─────────────────────────
const ARG_NAMES = {
  open_url:                  ['url'],
  implicit_wait:             ['seconds'],
  explicit_wait:             ['css_selector', 'timeout'],
  click:                     ['method', 'selector'],
  fill:                      ['method', 'selector', 'text'],
  submit:                    ['method', 'selector'],
  select_by_name:            ['name', 'value'],
  send_keys_action:          ['keys_sequence'],
  switch_to:                 ['target', 'value'],
  alert:                     ['action'],
  wait_seconds:              ['seconds'],
};

// ── Descriptions (shown as tooltips in the UI) ────────────────────────────
const DESCRIPTIONS = {
  open_url:                  'Navigates the browser to the specified URL and waits for the page to finish loading.',
  get_current_url:           'Returns the full URL of the currently loaded page and logs it to the console.',
  get_title:                 'Returns the <title> of the current page and logs it to the console.',
  back:                      'Clicks the browser Back button and waits for the previous page to load.',
  forward:                   'Clicks the browser Forward button and waits for the next page to load.',
  refresh:                   'Reloads the current page and waits for it to fully load again.',
  maximize_window:           'Expands the browser window to fill the entire screen.',
  minimize_window:           'Minimises the browser window to the taskbar.',
  implicit_wait:             'Pauses all subsequent steps by the given number of seconds before looking up any element.',
  explicit_wait:             'Waits up to "timeout" seconds until a CSS selector matches an element on the page. Fails if it never appears.',
  click:                     'Clicks an element on the page. Choose a method (CSS Selector, ID, Name, XPath, or Link Text) and enter the value, or use the picker (🎯) to select the element visually.',
  fill:                      'Clears an input field and types text into it. Choose a method (CSS Selector, ID, Name, or XPath) and enter the value, or use the picker (🎯) to select the field visually.',
  submit:                    'Submits the form containing the matched element. Choose a method (ID, CSS Selector, or XPath) and enter the value, or use the picker (🎯) to select any field inside the form.',
  select_by_name:            'Selects an option in a <select> dropdown found by name, matching by option value.',
  send_keys_action:          'Appends keystrokes to the currently focused element — useful for special keys or shortcuts.',
  switch_to:                 'Changes the active context. Choose Frame (by name), Main Page, Parent Frame, or Window (by title).',
  alert:                     'Handles a JavaScript alert dialog. Choose Accept (OK), Dismiss (Cancel), or Get Text to log the message.',
  wait_seconds:              'Pauses execution for an exact number of seconds before running the next step.',
  close_browser:             'Closes the entire browser window and ends the session.',
};

// ── Display names ──────────────────────────────────────────────────────────
const DISPLAY_NAMES = {
  open_url:                  'Open URL',
  get_current_url:           'Get Current URL',
  get_title:                 'Get Page Title',
  back:                      'Go Back',
  forward:                   'Go Forward',
  refresh:                   'Refresh Page',
  maximize_window:           'Maximize Window',
  minimize_window:           'Minimize Window',
  implicit_wait:             'Set Implicit Wait',
  explicit_wait:             'Wait for Element (CSS)',
  click:                     'Click',
  fill:                      'Fill Field',
  submit:                    'Submit Form',
  select_by_name:            'Select Dropdown Option — By Name',
  send_keys_action:          'Send Keyboard Input',
  switch_to:                 'Switch To',
  alert:                     'Alert',
  wait_seconds:              'Wait (seconds)',
  close_browser:             'Close Browser',
};

// ── Message listener ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'run') {
    runQueue(msg.payload).catch(() => {});
    sendResponse({ ok: true });

  } else if (msg.action === 'stop') {
    _stopRequested = true;
    sendResponse({ ok: true });

  } else if (msg.action === 'status') {
    sendResponse({ running: _running });

  } else if (msg.action === 'getFunctions') {
    const data = {};
    for (const name of Object.keys(ACTIONS)) {
      data[name] = {
        label: DISPLAY_NAMES[name] || name,
        doc:   DESCRIPTIONS[name] || '',
        args:  ARG_NAMES[name] || [],
      };
    }
    sendResponse({ functions: data });

  } else if (msg.action === 'getTabs') {
    chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (tabs) => {
      sendResponse({ tabs: tabs.map(t => ({ id: t.id, title: t.title || '', url: t.url || '' })) });
    });
    return true;

  } else if (msg.action === 'startCapture') {
    (async () => {
      const tabId = msg.tabId;
      if (!tabId) { sendResponse({ ok: false, error: 'No tab specified' }); return; }
      try {
        await injectCapture(tabId);
        await chrome.storage.session.set({ captureTabId: tabId });
        let debuggerError = null;
        try { await attachDebugger(tabId); } catch (e) { debuggerError = e.message; }
        sendResponse({ ok: true, tabId, debuggerError });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;

  } else if (msg.action === 'stopCapture') {
    (async () => {
      const { captureTabId } = await chrome.storage.session.get('captureTabId');
      await chrome.storage.session.remove('captureTabId');
      if (captureTabId) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: captureTabId },
            func: () => { if (window.__seleniteCaptureRestore) window.__seleniteCaptureRestore(); }
          });
        } catch (_) {}
        await detachDebugger(captureTabId);
      }
      sendResponse({ ok: true });
    })();
    return true;

  } else if (msg.action === 'browserLog') {
    addLog(msg.level, `[browser] ${msg.text}`, { browser: true, tagged: !!msg.tagged });
    sendResponse({ ok: true });

  } else if (msg.action === 'bcEval') {
    (async () => {
      if (!debuggerTabId) { sendResponse({ ok: false, error: 'Not attached' }); return; }
      const tabId = debuggerTabId;
      await addBrowserConsoleLog({ level: 'CMD', text: msg.expression, source: 'eval-input' });
      try {
        // $click('sel') / $hover('sel') — trusted-input helpers, handled here
        // (not passed to Runtime.evaluate) because they need chrome.debugger's
        // Input domain, which isn't reachable from page-side JS.
        const helper = msg.expression.trim().match(/^\$(click|hover)\(\s*(['"])(.*)\2\s*\)$/);
        if (helper) {
          const [, action, , selector] = helper;
          const center = await resolveElementCenter(tabId, selector);
          if (!center) {
            await addBrowserConsoleLog({ level: 'ERROR', text: `No element matches: ${selector}`, source: 'eval-result' });
          } else if (action === 'hover') {
            await dispatchTrustedHover(tabId, center.x, center.y);
            await addBrowserConsoleLog({ level: 'BROWSER', text: `Hovered (${Math.round(center.x)}, ${Math.round(center.y)})`, source: 'eval-result' });
          } else {
            await dispatchTrustedClick(tabId, center.x, center.y);
            await addBrowserConsoleLog({ level: 'BROWSER', text: `Clicked (${Math.round(center.x)}, ${Math.round(center.y)})`, source: 'eval-result' });
          }
          sendResponse({ ok: true });
          return;
        }
        const res = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
          expression: msg.expression,
          generatePreview: true,
          awaitPromise: true,
        });
        if (res.exceptionDetails) {
          const d = res.exceptionDetails;
          const text = d.exception?.description || d.text || 'Error';
          await addBrowserConsoleLog({ level: 'ERROR', text, source: 'eval-result' });
        } else {
          const objectId = res.result?.objectId || null;
          await addBrowserConsoleLog({
            level: 'BROWSER', text: formatEvalResult(res.result), source: 'eval-result',
            objectId, expandable: !!objectId,
          });
        }
        sendResponse({ ok: true });
      } catch (e) {
        await addBrowserConsoleLog({ level: 'ERROR', text: e.message, source: 'eval-result' });
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;

  } else if (msg.action === 'bcExpand') {
    (async () => {
      if (!debuggerTabId) { sendResponse({ ok: false, error: 'Not attached' }); return; }
      try {
        const res = await chrome.debugger.sendCommand({ tabId: debuggerTabId }, 'Runtime.getProperties', {
          objectId: msg.objectId,
          ownProperties: true,
          generatePreview: true,
        });
        // Match DevTools' full expansion: include non-enumerable own properties
        // (array .length, etc), accessor get/set pairs (e.g. __proto__), and the
        // internal [[Prototype]] link — not just enumerable data properties.
        // The chain terminates naturally at Object.prototype's [[Prototype]]: null.
        const props = [];
        for (const p of (res.result || [])) {
          if (p.value) {
            props.push({ name: p.name, text: formatEvalResult(p.value), objectId: p.value.objectId || null, expandable: !!p.value.objectId });
          }
          if (p.get && p.get.type !== 'undefined') {
            props.push({ name: `get ${p.name}`, text: formatEvalResult(p.get), objectId: null, expandable: false });
          }
          if (p.set && p.set.type !== 'undefined') {
            props.push({ name: `set ${p.name}`, text: formatEvalResult(p.set), objectId: null, expandable: false });
          }
        }
        for (const ip of (res.internalProperties || [])) {
          if (!ip.value) continue;
          props.push({ name: ip.name, text: formatEvalResult(ip.value), objectId: ip.value.objectId || null, expandable: !!ip.value.objectId });
        }
        sendResponse({ ok: true, props });
      } catch (e) {
        sendResponse({ ok: false, error: `Could not expand (reference expired?): ${e.message}` });
      }
    })();
    return true;

  } else if (msg.action === 'startPicker') {
    // Inject picker into the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) { sendResponse({ ok: false, error: 'No active tab' }); return; }
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['picker.js'] });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    });
    return true; // async

  } else if (msg.action === 'pickerResult') {
    // Content script sends result → store in session so popup can poll for it
    chrome.storage.session.set({ pickerResult: { selector: msg.selector, ts: Date.now() } });
    sendResponse({ ok: true });

  } else if (msg.action === 'runConversionAudit') {
    (async () => {
      const checks = msg.checks || [];
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) { sendResponse({ ok: false, error: 'No active tab' }); return; }
      try {
        const results = await exec(tabId, function(checks) {

          const CTA_SIGNALS = ['sign up','signup','get started','start free','start now','try free','try now','buy now','buy','subscribe','join now','join','create account','register','get access','start trial','free trial','request demo','book demo','get demo','donate','donate now','give now','shop now','order now','add to cart','checkout'];

          function brief(el) {
            if (el.id) return '#' + el.id;
            const cls = [...el.classList].filter(c => c.length < 20).slice(0,2).join('.');
            return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
          }

          function isCTA(el) {
            const text = (el.textContent || el.getAttribute('value') || el.getAttribute('aria-label') || '').trim().toLowerCase();
            return CTA_SIGNALS.some(s => text === s || text.startsWith(s + ' ') || text.endsWith(' ' + s));
          }

          function absY(el) {
            return el.getBoundingClientRect().top + window.scrollY;
          }

          const out = {};

          // 1. Click-to-goal
          if (checks.includes('ctg')) {
            const vh = window.innerHeight;
            const pageH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 1);
            const ctaEls = [...document.querySelectorAll('a,button,[role="button"],[type="submit"]')]
              .filter(el => el.offsetParent !== null && isCTA(el));
            const issues = [];

            if (ctaEls.length === 0) {
              issues.push('No primary CTA detected — check that button/link text matches common patterns (Sign up, Get started, Buy, etc.)');
            } else {
              const firstCTA = ctaEls.reduce((a, b) => absY(a) < absY(b) ? a : b);
              const firstY = absY(firstCTA);
              const aboveFold = ctaEls.filter(el => absY(el) <= vh);

              if (aboveFold.length === 0) {
                const pct = Math.round((firstY / pageH) * 100);
                issues.push('No CTA visible above fold — nearest "' + firstCTA.textContent.trim().slice(0,30) + '" is ' + Math.round(firstY) + 'px from top (' + pct + '% down page)');
              }

              const allInteractive = [...document.querySelectorAll('a[href],button')].filter(el => el.offsetParent !== null);
              const distractors = allInteractive.filter(el => absY(el) < firstY && !isCTA(el)).length;
              if (distractors > 7) {
                issues.push(distractors + ' non-CTA interactive elements appear before the first CTA — high choice friction');
              }
            }

            out.ctg = { label: 'Click-to-goal', issues };
          }

          // 2. Form usability
          if (checks.includes('forms')) {
            const issues = [];
            const forms = [...document.querySelectorAll('form')];

            if (forms.length === 0) {
              const loose = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit])')].filter(el => !el.closest('form'));
              if (loose.length > 0) issues.push(loose.length + ' input(s) outside a <form> — submission handling unclear');
            }

            forms.forEach((form, i) => {
              const lbl = form.id ? '#' + form.id : 'form[' + i + ']';

              if (form.hasAttribute('novalidate')) {
                const hasCustom = form.querySelector('[aria-describedby],[aria-errormessage],.error,.invalid,.field-error,.form-error');
                if (!hasCustom) issues.push(lbl + ': novalidate set but no custom validation indicators found');
              }

              const required = [...form.querySelectorAll('[required]')];
              const noError = required.filter(inp => {
                const desc = inp.getAttribute('aria-describedby');
                if (desc && document.getElementById(desc)) return false;
                const err = inp.getAttribute('aria-errormessage');
                if (err && document.getElementById(err)) return false;
                return true;
              });
              if (noError.length > 0) issues.push(lbl + ': ' + noError.length + ' required field(s) have no linked error message element');

              const textInputs = [...form.querySelectorAll('input[type=text],input[type=email],input[type=tel],input[type=password],textarea')];
              if (textInputs.length > 0 && required.length === 0) {
                issues.push(lbl + ': ' + textInputs.length + ' text input(s) with no required attributes — validation intent unclear');
              }

              if (!form.querySelector('[type=submit],button:not([type=button])')) {
                issues.push(lbl + ': no submit button found');
              }
            });

            out.forms = { label: 'Form usability', issues };
          }

          // 3. Dead-button detection
          if (checks.includes('dead')) {
            const issues = [];

            [...document.querySelectorAll('a')]
              .filter(a => a.offsetParent !== null && a.textContent.trim().length > 0)
              .filter(a => {
                const href = a.getAttribute('href');
                return href === null || href === '' || href === '#' || /^javascript\s*:/i.test(href);
              })
              .slice(0, 10)
              .forEach(a => {
                const href = a.getAttribute('href');
                issues.push('"' + a.textContent.trim().slice(0,30) + '" — ' + (href === null ? 'no href' : 'href="' + href + '"'));
              });

            [...document.querySelectorAll('button[type=button],button:not([type])')]
              .filter(btn => btn.offsetParent !== null && !btn.closest('form'))
              .filter(btn => {
                if (btn.hasAttribute('onclick')) return false;
                if ([...btn.attributes].some(a => a.name.startsWith('data-'))) return false;
                if (btn.hasAttribute('aria-controls') || btn.hasAttribute('aria-expanded') || btn.hasAttribute('aria-haspopup')) return false;
                return true;
              })
              .slice(0, 10)
              .forEach(btn => {
                issues.push(brief(btn) + ' "' + btn.textContent.trim().slice(0,30) + '" — no detectable handler (note: JS frameworks may bind externally)');
              });

            out.dead = { label: 'Dead-button detection', issues };
          }

          // 4. CTA above fold across breakpoints
          if (checks.includes('fold')) {
            const BREAKPOINTS = [
              { name: 'Mobile (375×667)', h: 667 },
              { name: 'Tablet (768×1024)', h: 1024 },
              { name: 'Desktop (1280×800)', h: 800 },
            ];
            const ctaEls = [...document.querySelectorAll('a,button,[role="button"],[type="submit"]')]
              .filter(el => el.offsetParent !== null && isCTA(el));
            const issues = [];

            if (ctaEls.length === 0) {
              issues.push('No primary CTA detected on page');
            } else {
              ctaEls.slice(0, 4).forEach(el => {
                const y = absY(el);
                const text = '"' + el.textContent.trim().slice(0,25) + '"';
                const hidden = BREAKPOINTS.filter(bp => y > bp.h).map(bp => bp.name);
                if (hidden.length > 0) {
                  issues.push(text + ' at ' + Math.round(y) + 'px — below fold at: ' + hidden.join(', '));
                }
              });
            }

            out.fold = { label: 'CTA above fold (breakpoints)', issues };
          }

          return out;
        }, [checks]);

        sendResponse({ ok: true, results });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;

  } else if (msg.action === 'runContentAudit') {
    (async () => {
      const checks = msg.checks || [];
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) { sendResponse({ ok: false, error: 'No active tab' }); return; }
      try {
        const results = await exec(tabId, function(checks) {

          // Extract visible body text, skipping script/style/nav chrome
          function visibleText() {
            const skip = new Set(['SCRIPT','STYLE','NOSCRIPT','NAV','HEADER','FOOTER','SVG','CODE','PRE','TEXTAREA']);
            let text = '';
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
              acceptNode(node) {
                const p = node.parentElement;
                if (!p || skip.has(p.tagName)) return NodeFilter.FILTER_REJECT;
                if (p.offsetParent === null && p.tagName !== 'BODY') return NodeFilter.FILTER_REJECT;
                return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
              }
            });
            let n;
            while ((n = walk.nextNode())) text += ' ' + n.textContent.trim();
            return text.replace(/\s+/g, ' ').trim();
          }

          function countSyllables(word) {
            word = word.toLowerCase().replace(/[^a-z]/g, '');
            if (word.length <= 3) return word.length ? 1 : 0;
            word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
            const m = word.match(/[aeiouy]{1,2}/g);
            return m ? m.length : 1;
          }

          const out = {};
          const text = visibleText();

          // 1. Readability (Flesch Reading Ease)
          if (checks.includes('readability')) {
            const issues = [];
            const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
            const words = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];
            if (words.length < 100) {
              issues.push('Only ' + words.length + ' words of body copy — too little to score reliably');
            } else {
              const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
              const wps = words.length / Math.max(sentences.length, 1);
              const spw = syllables / words.length;
              const score = 206.835 - 1.015 * wps - 84.6 * spw;
              let band;
              if (score >= 70) band = 'easy';
              else if (score >= 60) band = 'plain English';
              else if (score >= 50) band = 'fairly difficult';
              else if (score >= 30) band = 'difficult (college level)';
              else band = 'very difficult (graduate level)';
              const detail = 'Flesch ' + score.toFixed(0) + '/100 — ' + band + ' (' + wps.toFixed(1) + ' words/sentence, ' + words.length + ' words)';
              if (score < 50) issues.push(detail + '. Aim for 60+ for general web audiences.');
              else issues.push(detail);
            }
            out.readability = { label: 'Readability (Flesch)', issues, infoOnly: true };
          }

          // 2. Placeholder / Lorem ipsum
          if (checks.includes('placeholder')) {
            const issues = [];
            const haystack = text.toLowerCase();
            const patterns = [
              ['lorem ipsum', /lorem ipsum/g],
              ['dolor sit amet', /dolor sit amet/g],
              ['"Lorem" filler', /\blorem\b/g],
              ['placeholder text', /\bplaceholder text\b/g],
              ['"insert ... here"', /insert\s+\w+\s+here/g],
              ['TODO marker', /\btodo\b/g],
              ['FIXME marker', /\bfixme\b/g],
              ['XXX marker', /\bxxx\b/g],
              ['Lighthouse "your text"', /\byour (?:text|content|headline|title) here\b/g],
              ['"sample text"', /\bsample text\b/g],
              ['dummy content', /\bdummy (?:text|content|data)\b/g],
            ];
            for (const [label, re] of patterns) {
              const matches = haystack.match(re);
              if (matches) issues.push(label + ' — ' + matches.length + ' occurrence' + (matches.length !== 1 ? 's' : ''));
            }
            // Attribute placeholders that look like dev leftovers
            [...document.querySelectorAll('[alt],[title],[placeholder]')].forEach(el => {
              ['alt','title','placeholder'].forEach(attr => {
                const v = (el.getAttribute(attr) || '').toLowerCase();
                if (/lorem|placeholder|todo|fixme|sample text|your text here/.test(v)) {
                  issues.push(el.tagName.toLowerCase() + ' @' + attr + '="' + el.getAttribute(attr).slice(0,40) + '"');
                }
              });
            });
            out.placeholder = { label: 'Placeholder / Lorem ipsum', issues: issues.slice(0, 20) };
          }

          // 3. Title & meta description
          if (checks.includes('meta')) {
            const issues = [];
            const titles = [...document.querySelectorAll('title')];
            const title = (document.title || '').trim();

            if (titles.length === 0 || !title) issues.push('Missing <title> — every page needs a unique, descriptive title');
            else {
              if (titles.length > 1) issues.push(titles.length + ' <title> elements found — there must be exactly one');
              if (title.length < 10) issues.push('Title too short (' + title.length + ' chars): "' + title + '"');
              if (title.length > 60) issues.push('Title too long (' + title.length + ' chars) — may truncate in search results');
            }

            const metaDescs = [...document.querySelectorAll('meta[name="description" i]')];
            if (metaDescs.length === 0) issues.push('Missing <meta name="description"> — used for search/social snippets');
            else {
              if (metaDescs.length > 1) issues.push(metaDescs.length + ' meta descriptions found — there should be only one');
              const desc = (metaDescs[0].getAttribute('content') || '').trim();
              if (!desc) issues.push('Meta description is empty');
              else if (desc.length < 50) issues.push('Meta description short (' + desc.length + ' chars) — aim for 120–160');
              else if (desc.length > 160) issues.push('Meta description long (' + desc.length + ' chars) — may truncate around 160');
            }
            out.meta = { label: 'Title & meta description', issues };
          }

          // 4. Basic spellcheck (common-error dictionary)
          if (checks.includes('spelling')) {
            const COMMON = {
              'teh':'the','adn':'and','recieve':'receive','recieved':'received','seperate':'separate',
              'definately':'definitely','occured':'occurred','occurence':'occurrence','accomodate':'accommodate',
              'untill':'until','wich':'which','thier':'their','alot':'a lot','arguement':'argument',
              'begining':'beginning','beleive':'believe','calender':'calendar','catagory':'category',
              'cemetary':'cemetery','collegue':'colleague','commitee':'committee','concious':'conscious',
              'enviroment':'environment','existance':'existence','experiance':'experience','familar':'familiar',
              'finaly':'finally','foriegn':'foreign','goverment':'government','grammer':'grammar',
              'gaurd':'guard','harrass':'harass','independant':'independent','knowlege':'knowledge',
              'liason':'liaison','maintainance':'maintenance','neccessary':'necessary','noticable':'noticeable',
              'occassion':'occasion','persistant':'persistent','posession':'possession','prefered':'preferred',
              'priviledge':'privilege','publically':'publicly','recomend':'recommend','refered':'referred',
              'relevent':'relevant','succesful':'successful','sucessful':'successful','tommorow':'tomorrow',
              'truely':'truly','unfortunatly':'unfortunately','usefull':'useful','wierd':'weird',
              'writting':'writing','accross':'across','agressive':'aggressive','appearence':'appearance',
              'basicly':'basically','buisness':'business','completly':'completely','embarass':'embarrass',
              'guarentee':'guarantee','immediatly':'immediately','occuring':'occurring','paralel':'parallel',
              'recieving':'receiving','reccomend':'recommend','succesfully':'successfully','wether':'whether'
            };
            const issues = [];
            const seen = {};
            const words = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];
            for (const w of words) {
              const lower = w.toLowerCase();
              if (COMMON[lower] && !seen[lower]) {
                seen[lower] = true;
                issues.push('"' + w + '" → did you mean "' + COMMON[lower] + '"?');
              }
            }
            out.spelling = { label: 'Basic spellcheck', issues: issues.slice(0, 25) };
          }

          return out;
        }, [checks]);

        sendResponse({ ok: true, results });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;

  } else if (msg.action === 'pickerCancel') {
    chrome.storage.session.set({ pickerResult: { cancelled: true, ts: Date.now() } });
    sendResponse({ ok: true });

  } else if (msg.action === 'runA11yAudit') {
    (async () => {
      const checks = msg.checks || [];
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) { sendResponse({ ok: false, error: 'No active tab' }); return; }
      try {
        const results = await exec(tabId, function(checks) {

          function brief(el) {
            if (el.id) return '#' + el.id;
            const name = el.getAttribute('name');
            if (name) return '[name="' + name + '"]';
            const cls = [...el.classList].slice(0,2).join('.');
            return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
          }

          const out = {};

          // 1. Missing alt text
          if (checks.includes('alt')) {
            const issues = [...document.querySelectorAll('img')]
              .filter(img => !img.hasAttribute('alt'))
              .map(img => '<img src="' + ((img.getAttribute('src') || '').split('/').pop() || '?').slice(0,50) + '">');
            out.alt = { label: 'Missing alt text', issues, wcag: '1.1.1' };
          }

          // 2. Unlabeled form inputs
          if (checks.includes('labels')) {
            const sel = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea';
            const issues = [...document.querySelectorAll(sel)]
              .filter(inp => {
                if (inp.id && document.querySelector('label[for="' + inp.id + '"]')) return false;
                if ((inp.getAttribute('aria-label') || '').trim()) return false;
                if (inp.getAttribute('aria-labelledby')) {
                  const ids = inp.getAttribute('aria-labelledby').trim().split(/\s+/);
                  if (ids.some(id => id && document.getElementById(id))) return false;
                }
                if (inp.closest('label')) return false;
                if ((inp.getAttribute('title') || '').trim()) return false;
                return true;
              })
              .map(inp => brief(inp));
            out.labels = { label: 'Unlabeled form inputs', issues, wcag: '1.3.1' };
          }

          // 3. Heading hierarchy
          if (checks.includes('headings')) {
            const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
              .map(h => ({ level: parseInt(h.tagName[1]), text: h.textContent.trim().slice(0,50) }));
            const issues = [];
            const h1s = headings.filter(h => h.level === 1);
            if (h1s.length === 0) issues.push('No <h1> found on page');
            if (h1s.length > 1) issues.push(h1s.length + ' <h1> elements: ' + h1s.map(h => '"' + h.text + '"').join(', '));
            for (let i = 1; i < headings.length; i++) {
              if (headings[i].level > headings[i-1].level + 1) {
                issues.push('h' + headings[i-1].level + '→h' + headings[i].level + ' skip after "' + headings[i-1].text.slice(0,30) + '"');
              }
            }
            out.headings = { label: 'Heading hierarchy', issues, wcag: '1.3.1' };
          }

          // 4. Missing landmark regions
          if (checks.includes('landmarks')) {
            const issues = [];
            if (!document.querySelector('main,[role="main"]'))        issues.push('No <main> or role="main"');
            if (!document.querySelector('nav,[role="navigation"]'))   issues.push('No <nav> or role="navigation"');
            if (!document.querySelector('header,[role="banner"]'))    issues.push('No <header> or role="banner"');
            if (!document.querySelector('footer,[role="contentinfo"]')) issues.push('No <footer> or role="contentinfo"');
            out.landmarks = { label: 'Missing landmark regions', issues, wcag: '1.3.6' };
          }

          // 5. Invalid ARIA roles
          if (checks.includes('aria')) {
            const valid = new Set(['alert','alertdialog','application','article','banner','button','cell','checkbox','columnheader','combobox','complementary','contentinfo','definition','dialog','directory','document','feed','figure','form','grid','gridcell','group','heading','img','link','list','listbox','listitem','log','main','marquee','math','menu','menubar','menuitem','menuitemcheckbox','menuitemradio','navigation','none','note','option','presentation','progressbar','radio','radiogroup','region','row','rowgroup','rowheader','scrollbar','search','searchbox','separator','slider','spinbutton','status','switch','tab','table','tablist','tabpanel','term','textbox','timer','toolbar','tooltip','tree','treegrid','treeitem']);
            const issues = [...document.querySelectorAll('[role]')]
              .filter(el => !valid.has(el.getAttribute('role')))
              .map(el => brief(el) + ': role="' + el.getAttribute('role') + '"');
            out.aria = { label: 'Invalid ARIA roles', issues, wcag: '4.1.2' };
          }

          // 6. Low-quality link text
          if (checks.includes('links')) {
            const bad = new Set(['click here','here','read more','more','link','this','click','learn more','details','more info','info','go','go here','this link','continue','see more']);
            const issues = [...document.querySelectorAll('a[href]')]
              .filter(a => !a.getAttribute('aria-label') && bad.has(a.textContent.trim().toLowerCase()))
              .map(a => '"' + a.textContent.trim() + '" → ' + (a.href || '').slice(0,60));
            out.links = { label: 'Low-quality link text', issues, wcag: '2.4.4' };
          }

          // 7. Color contrast (WCAG AA)
          if (checks.includes('contrast')) {
            function getBg(el) {
              let cur = el;
              while (cur && cur.tagName !== 'HTML') {
                const bg = getComputedStyle(cur).backgroundColor;
                if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
                cur = cur.parentElement;
              }
              return 'rgb(255,255,255)';
            }
            function parseRGB(s) {
              const m = s.match(/\d+/g);
              return m ? [+m[0], +m[1], +m[2]] : null;
            }
            function lum(r,g,b) {
              let t = 0;
              const w = [0.2126,0.7152,0.0722];
              [r,g,b].forEach((c,i) => {
                const s = c/255;
                t += (s <= 0.04045 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4)) * w[i];
              });
              return t;
            }
            function contrastRatio(c1,c2) {
              const l1=lum(...c1), l2=lum(...c2);
              return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
            }

            const issues = [];
            const seen = new Set();
            const els = [...document.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,td,th,a,button,label')]
              .filter(el => el.offsetParent !== null && el.textContent.trim().length > 1)
              .slice(0, 80);

            for (const el of els) {
              const st = getComputedStyle(el);
              const fg = parseRGB(st.color);
              const bg = parseRGB(getBg(el));
              if (!fg || !bg) continue;
              const r = contrastRatio(fg, bg);
              const fs = parseFloat(st.fontSize);
              const bold = parseInt(st.fontWeight) >= 700;
              const large = fs >= 18 || (bold && fs >= 14);
              const minAA = large ? 3 : 4.5;
              if (r < minAA) {
                const key = brief(el) + st.color;
                if (!seen.has(key)) {
                  seen.add(key);
                  issues.push(brief(el) + ': ' + r.toFixed(2) + ':1 (need ' + minAA + ':1' + (large ? ', large text' : '') + ')');
                }
              }
            }
            out.contrast = { label: 'Color contrast (WCAG AA)', issues: issues.slice(0,15), wcag: '1.4.3' };
          }

          // 8. Touch target size
          if (checks.includes('touch')) {
            const issues = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="link"]')]
              .filter(el => el.offsetParent !== null)
              .filter(el => { const r = el.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
              .slice(0, 15)
              .map(el => { const r = el.getBoundingClientRect(); return brief(el) + ': ' + Math.round(r.width) + '×' + Math.round(r.height) + 'px'; });
            out.touch = { label: 'Touch targets <44×44px', issues, wcag: '2.5.5' };
          }

          // 9. Keyboard reachability
          if (checks.includes('keyboard')) {
            const issues = [];
            [...document.querySelectorAll('a[href],button,input,select,textarea,[role="button"]')]
              .filter(el => !el.hasAttribute('disabled') && el.getAttribute('tabindex') === '-1')
              .slice(0, 10)
              .forEach(el => issues.push(brief(el) + ' — tabindex="-1" (removed from tab order)'));
            [...document.querySelectorAll('a[href],button,input,select,textarea')]
              .filter(el => /outline\s*:\s*(none|0\b)/.test(el.getAttribute('style') || ''))
              .slice(0, 10)
              .forEach(el => issues.push(brief(el) + ' — inline outline:none (hides focus ring)'));
            out.keyboard = { label: 'Keyboard reachability', issues, wcag: '2.1.1' };
          }

          return out;
        }, [checks]);

        sendResponse({ ok: true, results });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  return true; // keep channel open for async
});
