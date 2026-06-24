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

  click_by_id: async (tabId, { element_id }) => {
    await exec(tabId, (id) => document.getElementById(id).click(), [element_id]);
  },

  click_by_name: async (tabId, { name }) => {
    await exec(tabId, (n) => document.querySelector(`[name="${n}"]`).click(), [name]);
  },

  click_by_xpath: async (tabId, { xpath }) => {
    await exec(tabId, (xp) => {
      const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (!el) throw new Error(`XPath not found: ${xp}`);
      el.click();
    }, [xpath]);
  },

  click_by_css: async (tabId, { css }) => {
    await exec(tabId, (sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`CSS selector not found: ${sel}`);
      el.click();
    }, [css]);
  },

  click_by_link_text: async (tabId, { text }) => {
    await exec(tabId, (txt) => {
      const el = [...document.querySelectorAll('a')].find(a => a.textContent.trim() === txt);
      if (!el) throw new Error(`Link text not found: ${txt}`);
      el.click();
    }, [text]);
  },

  fill_by_id: async (tabId, { element_id, text }) => {
    await exec(tabId, (id, val) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`ID not found: ${id}`);
      el.focus(); el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, [element_id, text]);
  },

  fill_by_name: async (tabId, { name, text }) => {
    await exec(tabId, (n, val) => {
      const el = document.querySelector(`[name="${n}"]`);
      if (!el) throw new Error(`Name not found: ${n}`);
      el.focus(); el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, [name, text]);
  },

  fill_by_xpath: async (tabId, { xpath, text }) => {
    await exec(tabId, (xp, val) => {
      const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (!el) throw new Error(`XPath not found: ${xp}`);
      el.focus(); el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, [xpath, text]);
  },

  fill_by_css: async (tabId, { css, text }) => {
    await exec(tabId, (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`CSS not found: ${sel}`);
      el.focus(); el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, [css, text]);
  },

  submit_by_id: async (tabId, { element_id }) => {
    await exec(tabId, (id) => document.getElementById(id).closest('form').submit(), [element_id]);
  },

  submit_by_xpath: async (tabId, { xpath }) => {
    await exec(tabId, (xp) => {
      const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      el.closest('form').submit();
    }, [xpath]);
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

  switch_to_frame_by_name: async (tabId, { frame_name }) => {
    // Extensions don't need frame switching — scripting API targets all frames
    await addLog('INFO', `Note: frame switching not required in extension mode (targeting all frames). Frame: ${frame_name}`);
  },

  switch_to_default_content: async () => {
    await addLog('INFO', 'Switch to main page — no-op in extension mode.');
  },

  switch_to_parent_frame: async () => {
    await addLog('INFO', 'Switch to parent frame — no-op in extension mode.');
  },

  switch_to_window: async (_tabId, { handle_or_name }) => {
    const tabs = await chrome.tabs.query({ title: handle_or_name });
    if (tabs.length) await chrome.tabs.update(tabs[0].id, { active: true });
    else throw new Error(`Window not found: ${handle_or_name}`);
  },

  accept_alert: async (tabId) => {
    // Override window.confirm/alert before it fires via content script
    await addLog('WARNING', 'accept_alert: alerts are auto-dismissed in extensions. Use explicit_wait before this if timing is needed.');
  },

  dismiss_alert: async (tabId) => {
    await addLog('WARNING', 'dismiss_alert: alerts are auto-dismissed in extensions.');
  },

  get_alert_text: async (tabId) => {
    await addLog('WARNING', 'get_alert_text: not available in extensions (alerts are handled by the browser).');
    return null;
  },

  close_browser: async (tabId) => {
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.remove(tab.windowId);
  },
};

// ── Execution loop ─────────────────────────────────────────────────────────
let _running = false;
let _stopRequested = false;

async function runQueue({ url, queue, mode, targetTabId }) {
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

        const delay = parseInt(step.delay, 10) || 0;
        if (delay > 0) await new Promise(r => setTimeout(r, delay * 1000));

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
  click_by_id:               ['element_id'],
  click_by_name:             ['name'],
  click_by_xpath:            ['xpath'],
  click_by_css:              ['css'],
  click_by_link_text:        ['text'],
  fill_by_id:                ['element_id', 'text'],
  fill_by_name:              ['name', 'text'],
  fill_by_xpath:             ['xpath', 'text'],
  fill_by_css:               ['css', 'text'],
  submit_by_id:              ['element_id'],
  submit_by_xpath:           ['xpath'],
  select_by_name:            ['name', 'value'],
  send_keys_action:          ['keys_sequence'],
  switch_to_frame_by_name:   ['frame_name'],
  switch_to_window:          ['handle_or_name'],
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
  click_by_id:               'Finds an element by its HTML id attribute and clicks it.',
  click_by_name:             'Finds an element by its name attribute and clicks it.',
  click_by_xpath:            'Finds an element using an XPath expression and clicks it.',
  click_by_css:              'Finds an element using a CSS selector (e.g. ".btn-primary") and clicks it.',
  click_by_link_text:        'Finds an <a> tag whose visible text exactly matches the value and clicks it.',
  fill_by_id:                'Clears an input field found by id, then types the given text into it.',
  fill_by_name:              'Clears an input field found by name attribute, then types the given text into it.',
  fill_by_xpath:             'Clears an input field found by XPath, then types the given text into it.',
  fill_by_css:               'Clears an input field found by CSS selector, then types the given text into it.',
  submit_by_id:              'Submits the form that contains the element with the given id.',
  submit_by_xpath:           'Submits the form that contains the element found by the given XPath.',
  select_by_name:            'Selects an option in a <select> dropdown found by name, matching by option value.',
  send_keys_action:          'Appends keystrokes to the currently focused element — useful for special keys or shortcuts.',
  switch_to_frame_by_name:   'Switches the scripting context into an iframe identified by its name or id.',
  switch_to_default_content: 'Exits any active iframe and returns to the main page context.',
  switch_to_parent_frame:    'Moves the scripting context up one level from a nested iframe.',
  switch_to_window:          'Switches focus to a different open browser window by its title.',
  accept_alert:              'Accepts (clicks OK on) a JavaScript alert, confirm, or prompt dialog.',
  dismiss_alert:             'Dismisses (clicks Cancel on) a JavaScript confirm or prompt dialog.',
  get_alert_text:            'Reads and logs the message text displayed in the current alert dialog.',
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
  click_by_id:               'Click — By ID',
  click_by_name:             'Click — By Name',
  click_by_xpath:            'Click — By XPath',
  click_by_css:              'Click — By CSS Selector',
  click_by_link_text:        'Click — By Link Text',
  fill_by_id:                'Fill Field — By ID',
  fill_by_name:              'Fill Field — By Name',
  fill_by_xpath:             'Fill Field — By XPath',
  fill_by_css:               'Fill Field — By CSS Selector',
  submit_by_id:              'Submit Form — By ID',
  submit_by_xpath:           'Submit Form — By XPath',
  select_by_name:            'Select Dropdown Option — By Name',
  send_keys_action:          'Send Keyboard Input',
  switch_to_frame_by_name:   'Switch to Frame',
  switch_to_default_content: 'Switch to Main Page',
  switch_to_parent_frame:    'Switch to Parent Frame',
  switch_to_window:          'Switch to Window',
  accept_alert:              'Accept Alert',
  dismiss_alert:             'Dismiss Alert',
  get_alert_text:            'Get Alert Text',
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
