// Selenite — background service worker
// Handles queue execution; writes logs to session storage so popup can read them.
//
// Originally created and developed by William Wiley. Forked for Cro Metrics.

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

  open_url: async (tabId, { url, params }) => {
    let fullUrl = (url || '').trim();
    if (!fullUrl) return; // Blank URL — leave the active tab as-is, don't navigate.

    const paramList = Array.isArray(params)
      ? params.map(p => String(p).trim()).filter(Boolean)
      : String(params || '').split('\n').map(p => p.trim()).filter(Boolean);
    if (paramList.length) {
      const sep = fullUrl.includes('?') ? '&' : '?';
      fullUrl = fullUrl + sep + paramList.join('&');
    }
    await chrome.tabs.update(tabId, { url: normalizeUrl(fullUrl) });
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

async function runQueue({ queue, mode, targetTabId, universalDelay }) {
  _running = true;
  _stopRequested = false;
  await chrome.storage.session.set({ running: true });

  // Resolve target tab — use provided tabId or open a new blank tab.
  // The queue's own leading "Open URL" step navigates it to the target URL.
  let tabId = targetTabId;
  if (!tabId) {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
    tabId = tab.id;
    await waitForLoad(tabId);
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
  open_url:                  ['url', 'params'],
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
  open_url:                  'Navigates the browser to the specified URL (with any URL parameters appended) and waits for the page to finish loading. This is always the first step in the queue.',
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

  } else if (msg.action === 'runWcagAudit') {
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
            const cls = [...el.classList].slice(0, 2).join('.');
            return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
          }
          function accName(el) {
            const al = (el.getAttribute('aria-label') || '').trim();
            if (al) return al;
            const lb = el.getAttribute('aria-labelledby');
            if (lb) {
              const t = lb.trim().split(/\s+/).map(id => { const n = document.getElementById(id); return n ? n.textContent.trim() : ''; }).join(' ').trim();
              if (t) return t;
            }
            const txt = (el.textContent || '').trim();
            if (txt) return txt;
            const ti = (el.getAttribute('title') || '').trim();
            if (ti) return ti;
            return (el.value || '').trim();
          }
          function cssEsc(s) { try { return CSS.escape(s); } catch (e) { return s.replace(/["\\\]]/g, '\\$&'); } }

          const out = {};

          // 1. Page Identity & Titles — 2.4.2
          if (checks.includes('titles')) {
            const issues = [];
            const t = (document.title || '').trim();
            if (!t) issues.push('Page has no <title> (document.title is empty)');
            else {
              const generic = ['untitled', 'document', 'home', 'page', 'new page', 'index', 'react app', 'vite app', 'title'];
              if (generic.includes(t.toLowerCase())) issues.push('Generic, non-descriptive title: "' + t + '"');
              if (t.length < 3) issues.push('Very short title: "' + t + '"');
            }
            out.titles = { label: 'Page Identity & Titles', issues, wcag: '2.4.2' };
          }

          // 2. Navigation Consistency — 3.2.3 / 3.2.4 / 3.2.6
          if (checks.includes('navconsistency')) {
            const issues = [];
            if (!document.querySelector('nav,[role="navigation"]')) issues.push('No <nav> / role="navigation" landmark found');
            if (!document.querySelector('header,[role="banner"]')) issues.push('No <header> / role="banner" region');
            if (!document.querySelector('footer,[role="contentinfo"]')) issues.push('No <footer> / role="contentinfo" region');
            const helpRe = /help|contact|support|faq/i;
            const hasHelp = [...document.querySelectorAll('a,button')]
              .some(el => helpRe.test(el.textContent || '') || helpRe.test(el.getAttribute('aria-label') || ''));
            if (!hasHelp) issues.push('No help / contact / support mechanism detected (3.2.6)');
            out.navconsistency = { label: 'Navigation Consistency', issues, wcag: '3.2.3, 3.2.4, 3.2.6' };
          }

          // 3. Alternate Paths to Content — 2.4.5
          if (checks.includes('multipleways')) {
            const issues = [];
            const hasSearch = !!document.querySelector('input[type="search"], [role="search"], form[role="search"], input[name*="search" i], input[name="q"], input[placeholder*="search" i]');
            const hasSitemap = [...document.querySelectorAll('a[href]')]
              .some(a => /sitemap/i.test(a.textContent || '') || /sitemap/i.test(a.getAttribute('href') || ''));
            const hasNav = document.querySelectorAll('nav a[href], [role="navigation"] a[href]').length > 0;
            const ways = [];
            if (hasNav) ways.push('navigation menu');
            if (hasSearch) ways.push('site search');
            if (hasSitemap) ways.push('sitemap');
            if (ways.length < 2) issues.push('Only ' + (ways.length ? ways.join(' + ') : 'no recognizable') + ' way(s) to find content; 2.4.5 needs ≥2 (e.g. nav + search or sitemap)');
            out.multipleways = { label: 'Alternate Paths to Content', issues, wcag: '2.4.5' };
          }

          // 4. Skip Link Functionality — 2.4.1
          if (checks.includes('skiplink')) {
            const issues = [];
            const anchors = [...document.querySelectorAll('a[href^="#"]')];
            const skip = anchors.find(a => /skip|jump to/i.test(a.textContent || '') || /skip/i.test(a.getAttribute('href') || ''));
            if (!skip) issues.push('No "skip to main content" link found (checked in-page # anchors)');
            else {
              const id = (skip.getAttribute('href') || '').slice(1);
              if (!id) issues.push('Skip link href is "#" — it points nowhere');
              else if (!document.getElementById(id) && !document.querySelector('a[name="' + cssEsc(id) + '"]')) {
                issues.push('Skip link target "#' + id + '" does not exist on the page');
              }
            }
            out.skiplink = { label: 'Skip Link Functionality', issues, wcag: '2.4.1' };
          }

          // 5. Keyboard Path Verification — 2.1.1 / 2.4.3
          if (checks.includes('keyboardpath')) {
            const issues = [];
            [...document.querySelectorAll('[tabindex]')]
              .filter(el => parseInt(el.getAttribute('tabindex'), 10) > 0)
              .slice(0, 15)
              .forEach(el => issues.push('Positive tabindex=' + el.getAttribute('tabindex') + ' on ' + brief(el) + ' — disrupts natural focus order (2.4.3)'));
            const badNeg = [...document.querySelectorAll('a[href],button,input,select,textarea')]
              .filter(el => el.getAttribute('tabindex') === '-1' && !el.hasAttribute('disabled'));
            if (badNeg.length) issues.push(badNeg.length + ' natively focusable control(s) removed from tab order via tabindex="-1"');
            out.keyboardpath = { label: 'Keyboard Path Verification', issues: issues.slice(0, 20), wcag: '2.1.1, 2.4.3' };
          }

          // 6. Modal & Dialog Escape — 2.1.2 (interaction required)
          if (checks.includes('modalescape')) {
            const dialogs = [...document.querySelectorAll('dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"]')];
            const issues = [];
            if (!dialogs.length) issues.push('No modal/dialog in the current DOM. Open each modal and confirm Escape (or a visible close control) exits it without trapping keyboard focus.');
            else dialogs.forEach(d => issues.push(brief(d) + ' — verify Escape closes it and focus is not trapped (2.1.2)'));
            out.modalescape = { label: 'Modal & Dialog Escape', issues, wcag: '2.1.2', infoOnly: true };
          }

          // 7. Form Error Handling — 3.3.1 / 3.3.3 / 4.1.3
          if (checks.includes('formerror')) {
            const issues = [];
            const forms = [...document.querySelectorAll('form')];
            if (!forms.length) issues.push('No <form> on the page to validate');
            else {
              if (!document.querySelector('[aria-live],[role="alert"],[role="status"]')) {
                issues.push('No aria-live / role="alert" region — validation & status messages may not be announced (4.1.3)');
              }
              const req = [...document.querySelectorAll('input[required],select[required],textarea[required],[aria-required="true"]')];
              const noDesc = req.filter(el => !el.getAttribute('aria-describedby') && !el.getAttribute('aria-errormessage'));
              if (noDesc.length) issues.push(noDesc.length + ' required field(s) lack aria-describedby / aria-errormessage to carry an error suggestion (3.3.1, 3.3.3)');
            }
            out.formerror = { label: 'Form Error Handling', issues, wcag: '3.3.1, 3.3.3, 4.1.3' };
          }

          // 8. Session Timing — 2.2.1 / 2.2.6 (not statically detectable)
          if (checks.includes('sessiontiming')) {
            out.sessiontiming = {
              label: 'Session Timing',
              issues: ['Cannot be auto-detected. Manually verify a warning appears before session expiry, the user can extend the session, and no entered data is lost (2.2.1, 2.2.6).'],
              wcag: '2.2.1, 2.2.6', infoOnly: true
            };
          }

          // 9. Destructive Action Confirmation — 3.3.4 / 3.3.6 (interaction required)
          if (checks.includes('destructive')) {
            const re = /\b(delete|remove|discard|cancel subscription|deactivate|close account|erase|clear all|pay now|place order|submit order|confirm purchase|buy now|checkout)\b/i;
            const found = [...document.querySelectorAll('button,a[href],input[type="submit"],[role="button"]')]
              .map(el => (accName(el) || '').trim())
              .filter(name => name && re.test(name))
              .map(name => '"' + name.slice(0, 40) + '"');
            const uniq = [...new Set(found)];
            const issues = uniq.length
              ? ['Verify each finalizes only after explicit confirmation, or is reversible/undoable (3.3.4, 3.3.6):', ...uniq.slice(0, 20)]
              : ['No obviously destructive/consequential actions detected on this view.'];
            out.destructive = { label: 'Destructive Action Confirmation', issues, wcag: '3.3.4, 3.3.6', infoOnly: true };
          }

          // 10. Link Purpose — 2.4.4 / 2.4.9
          if (checks.includes('linkpurpose')) {
            const bad = new Set(['click here', 'here', 'read more', 'more', 'link', 'this', 'click', 'learn more', 'details', 'more info', 'info', 'go', 'go here', 'this link', 'continue', 'see more', 'view', 'download']);
            const issues = [...document.querySelectorAll('a[href]')]
              .filter(a => !a.getAttribute('aria-label') && bad.has((a.textContent || '').trim().toLowerCase()))
              .map(a => '"' + a.textContent.trim() + '" → ' + (a.href || '').slice(0, 60));
            out.linkpurpose = { label: 'Link Purpose', issues: issues.slice(0, 25), wcag: '2.4.4, 2.4.9' };
          }

          // 11. Form Labeling — 3.3.2 / 1.3.1
          if (checks.includes('formlabels')) {
            const sel = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea';
            const issues = [...document.querySelectorAll(sel)]
              .filter(inp => {
                if (inp.id && document.querySelector('label[for="' + cssEsc(inp.id) + '"]')) return false;
                if ((inp.getAttribute('aria-label') || '').trim()) return false;
                const lb = inp.getAttribute('aria-labelledby');
                if (lb && lb.trim().split(/\s+/).some(id => id && document.getElementById(id))) return false;
                if (inp.closest('label')) return false;
                if ((inp.getAttribute('title') || '').trim()) return false;
                return true;
              })
              .map(inp => {
                const ph = (inp.getAttribute('placeholder') || '').trim();
                return brief(inp) + (ph ? ' — placeholder only, no persistent <label>' : ' — no associated label');
              });
            out.formlabels = { label: 'Form Labeling', issues: issues.slice(0, 25), wcag: '3.3.2, 1.3.1' };
          }

          // 12. Redundant Entry — 3.3.7 (multi-step flow, not statically detectable)
          if (checks.includes('redundant')) {
            out.redundant = {
              label: 'Redundant Entry',
              issues: ['Manual check: across a multi-step flow, information entered earlier (name, email, address) should be auto-populated or selectable later rather than re-entered (3.3.7).'],
              wcag: '3.3.7', infoOnly: true
            };
          }

          // 13. Focus Visibility — 2.4.7 / 2.4.11
          if (checks.includes('focusvis')) {
            const issues = [];
            const killed = [];
            for (const sheet of document.styleSheets) {
              let rules;
              try { rules = sheet.cssRules; } catch (e) { continue; }
              if (!rules) continue;
              for (const r of rules) {
                if (!r.selectorText || !r.style) continue;
                const s = r.selectorText;
                if (/:focus(?!-visible)/.test(s) || /(^|,)\s*\*/.test(s)) {
                  const o = (r.style.outlineStyle || r.style.outline || '').toLowerCase();
                  const ow = (r.style.outlineWidth || '').toLowerCase();
                  if ((/none/.test(o) || /^0/.test(ow)) && !/:focus-visible/.test(s)) {
                    killed.push(s.slice(0, 60));
                  }
                }
              }
            }
            const uniq = [...new Set(killed)];
            if (uniq.length) issues.push('Focus outline removed without a :focus-visible replacement in: ' + uniq.slice(0, 10).join('  ;  '));
            const inline = [...document.querySelectorAll('a[href],button,input,select,textarea')]
              .filter(el => /outline\s*:\s*(none|0\b)/.test(el.getAttribute('style') || ''));
            if (inline.length) issues.push(inline.length + ' element(s) hide the focus ring via inline outline:none');
            out.focusvis = { label: 'Focus Visibility', issues, wcag: '2.4.7, 2.4.11' };
          }

          // 14. ARIA State Toggling — 4.1.2
          if (checks.includes('ariastate')) {
            const togglers = [...document.querySelectorAll('button,[role="button"],[aria-haspopup],[data-toggle],[class*="accordion" i],[class*="dropdown" i],[class*="collapse" i]')];
            const missing = togglers
              .filter(el => {
                if (el.hasAttribute('aria-expanded') || el.hasAttribute('aria-pressed') || el.hasAttribute('aria-checked') || el.hasAttribute('aria-selected')) return false;
                return el.hasAttribute('aria-haspopup') || el.hasAttribute('data-toggle') || /accordion|dropdown|toggle|collapse/i.test(el.className);
              })
              .map(el => brief(el) + ' — interactive widget with no aria-expanded/aria-pressed state');
            const tabs = [...document.querySelectorAll('[role="tab"]')]
              .filter(el => !el.hasAttribute('aria-selected'))
              .map(el => brief(el) + ' — role="tab" without aria-selected');
            out.ariastate = { label: 'ARIA State Toggling', issues: [...missing, ...tabs].slice(0, 25), wcag: '4.1.2' };
          }

          // 15. Color Contrast — 1.4.3 / 1.4.11
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
            function parseRGB(s) { const m = s.match(/\d+/g); return m ? [+m[0], +m[1], +m[2]] : null; }
            function lum(r, g, b) {
              let t = 0; const w = [0.2126, 0.7152, 0.0722];
              [r, g, b].forEach((c, i) => { const s = c / 255; t += (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)) * w[i]; });
              return t;
            }
            function ratio(c1, c2) { const l1 = lum(...c1), l2 = lum(...c2); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
            const issues = [];
            const seen = new Set();
            const els = [...document.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,td,th,a,button,label,span')]
              .filter(el => el.offsetParent !== null && el.textContent.trim().length > 1)
              .slice(0, 90);
            for (const el of els) {
              const st = getComputedStyle(el);
              const fg = parseRGB(st.color);
              const bg = parseRGB(getBg(el));
              if (!fg || !bg) continue;
              const r = ratio(fg, bg);
              const fs = parseFloat(st.fontSize);
              const bold = parseInt(st.fontWeight) >= 700;
              const large = fs >= 18 || (bold && fs >= 14);
              const minAA = large ? 3 : 4.5;
              if (r < minAA) {
                const key = brief(el) + st.color;
                if (!seen.has(key)) { seen.add(key); issues.push(brief(el) + ': ' + r.toFixed(2) + ':1 (need ' + minAA + ':1' + (large ? ', large text' : '') + ')'); }
              }
            }
            out.contrast = { label: 'Color Contrast', issues: issues.slice(0, 20), wcag: '1.4.3, 1.4.11' };
          }

          // 16. Reflow & Zoom — 1.4.10 / 1.4.4
          if (checks.includes('reflow')) {
            const issues = [];
            const vp = document.querySelector('meta[name="viewport"]');
            if (vp) {
              const c = (vp.getAttribute('content') || '').toLowerCase();
              if (/user-scalable\s*=\s*(no|0)/.test(c)) issues.push('viewport meta sets user-scalable=no — blocks zoom (1.4.4)');
              const ms = c.match(/maximum-scale\s*=\s*([\d.]+)/);
              if (ms && parseFloat(ms[1]) < 2) issues.push('viewport meta caps maximum-scale=' + ms[1] + ' — prevents 200% zoom (1.4.4)');
            }
            if (document.documentElement.scrollWidth > window.innerWidth + 4) {
              issues.push('Page scrolls horizontally at current width (' + document.documentElement.scrollWidth + 'px > ' + window.innerWidth + 'px viewport) — check reflow at 320px / 400% (1.4.10)');
            }
            out.reflow = { label: 'Reflow & Zoom', issues, wcag: '1.4.10, 1.4.4' };
          }

          // 17. Motion & Flashing — 2.2.2 / 2.3.1
          if (checks.includes('motion')) {
            const issues = [];
            [...document.querySelectorAll('video[autoplay],audio[autoplay]')]
              .filter(m => !m.hasAttribute('controls'))
              .forEach(m => issues.push(brief(m) + ' — autoplaying ' + m.tagName.toLowerCase() + ' with no controls to pause/stop (2.2.2)'));
            if (document.querySelector('marquee,blink')) issues.push('<marquee>/<blink> element present — continuous motion with no pause (2.2.2)');
            let animated = 0;
            [...document.querySelectorAll('*')].slice(0, 2000).forEach(el => {
              const st = getComputedStyle(el);
              if (st.animationName && st.animationName !== 'none' && /infinite/.test(st.animationIterationCount)) animated++;
            });
            if (animated) issues.push(animated + ' element(s) with infinite CSS animation — ensure motion can be paused/stopped/hidden and never flashes >3×/sec (2.2.2, 2.3.1)');
            out.motion = { label: 'Motion & Flashing', issues, wcag: '2.2.2, 2.3.1' };
          }

          // 18. Screen Reader Announcements — 1.1.1 / 4.1.3 / 4.1.2
          if (checks.includes('screenreader')) {
            const issues = [];
            const noAlt = [...document.querySelectorAll('img')].filter(img => !img.hasAttribute('alt')).length;
            if (noAlt) issues.push(noAlt + ' <img> missing an alt attribute — no text alternative to announce (1.1.1)');
            const namelessBtns = [...document.querySelectorAll('button,[role="button"],a[href]')]
              .filter(el => el.offsetParent !== null && !accName(el))
              .slice(0, 15)
              .map(el => brief(el) + ' — control has no accessible name (4.1.2)');
            issues.push(...namelessBtns);
            if (!document.querySelector('[aria-live],[role="status"],[role="alert"],[role="log"]')) {
              issues.push('No live region (aria-live / role="status") — dynamic status updates will not be announced (4.1.3)');
            }
            out.screenreader = { label: 'Screen Reader Announcements', issues: issues.slice(0, 25), wcag: '1.1.1, 4.1.3, 4.1.2' };
          }

          // 19. Real-World Task Usability — cross-cutting (manual)
          if (checks.includes('realworld')) {
            out.realworld = {
              label: 'Real-World Task Usability',
              issues: ['Manual, holistic check: using only a keyboard and/or screen reader, complete each key task end to end (sign up, checkout, find content) and confirm it succeeds without excessive friction, confusion, or dead ends.'],
              wcag: 'cross-cutting', infoOnly: true
            };
          }

          return out;
        }, [checks]);

        // ── axe-core: authoritative engine, merged into the suites above by WCAG SC ──
        let axeError = null;
        const axeSuites = {
          titles: ['2.4.2'], skiplink: ['2.4.1'], keyboardpath: ['2.1.1', '2.4.3'],
          formerror: ['3.3.1', '3.3.3', '4.1.3'], linkpurpose: ['2.4.4', '2.4.9'],
          formlabels: ['3.3.2', '1.3.1'], ariastate: ['4.1.2'], contrast: ['1.4.3', '1.4.11'],
          reflow: ['1.4.10', '1.4.4'], motion: ['2.2.2', '2.3.1'],
          screenreader: ['1.1.1', '4.1.3', '4.1.2']
        };
        // axe is strictly better here — drop the heuristic issues when axe succeeds
        const axeReplace = new Set(['contrast']);

        if (Object.keys(axeSuites).some(k => checks.includes(k))) {
          let violations = [];
          try {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['axe.min.js'] });
            violations = await exec(tabId, async function () {
              if (typeof window.axe === 'undefined') return { __error: 'axe-core failed to load' };
              try {
                const r = await window.axe.run(document, {
                  resultTypes: ['violations'],
                  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }
                });
                return (r.violations || []).map(function (v) {
                  return {
                    id: v.id,
                    help: v.help,
                    sc: (v.tags || []).map(function (t) { const m = /^wcag(\d)(\d)(\d+)$/.exec(t); return m ? m[1] + '.' + m[2] + '.' + m[3] : null; }).filter(Boolean),
                    nodes: (v.nodes || []).slice(0, 10).map(function (n) { return (n.target || []).join(' '); })
                  };
                });
              } catch (e) { return { __error: e.message }; }
            }, []);
          } catch (e) {
            violations = { __error: e.message };
          }
          if (violations && violations.__error) { axeError = violations.__error; violations = []; }

          for (const key of Object.keys(axeSuites)) {
            if (!results[key] || !checks.includes(key)) continue;
            const scs = axeSuites[key];
            const axeIssues = [];
            for (const v of violations) {
              if (!v.sc.some(s => scs.includes(s))) continue;
              for (const target of v.nodes) axeIssues.push('axe · ' + v.help + (target ? ' — ' + target : ''));
            }
            if (axeReplace.has(key) && !axeError) {
              results[key].issues = axeIssues;
            } else if (axeIssues.length) {
              results[key].issues = [...axeIssues, ...results[key].issues];
            }
          }
        }

        sendResponse({ ok: true, results, axeError });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  return true; // keep channel open for async
});
