// Selenite — background service worker
// Handles queue execution; writes logs to session storage so popup can read them.

// ── Open side panel when toolbar icon is clicked ──────────────────────────
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {}); // guard for older Chrome versions

// ── Logging ───────────────────────────────────────────────────────────────
async function addLog(level, text) {
  const { logs = [] } = await chrome.storage.session.get('logs');
  logs.push({ level, text, ts: new Date().toLocaleTimeString() });
  await chrome.storage.session.set({ logs });
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
    await chrome.tabs.update(tabId, { url });
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
    const fn = (v, val) => {
      let el;
      if      (method === 'id')    el = document.getElementById(v);
      else if (method === 'name')  el = document.querySelector(`[name="${v}"]`);
      else if (method === 'css')   el = document.querySelector(v);
      else if (method === 'xpath') el = document.evaluate(v, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (!el) throw new Error(`Element not found (${method}): ${v}`);
      el.focus(); el.value = val;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    await exec(tabId, fn, [selector, text]);
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
    const tab = await chrome.tabs.create({ url: url || 'about:blank', active: true });
    tabId = tab.id;
    await waitForLoad(tabId);
  } else {
    if (url) {
      await chrome.tabs.update(tabId, { url });
      await waitForLoad(tabId);
    }
  }

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

  } else if (msg.action === 'pickerCancel') {
    chrome.storage.session.set({ pickerResult: { cancelled: true, ts: Date.now() } });
    sendResponse({ ok: true });
  }

  return true; // keep channel open for async
});
