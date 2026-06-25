# Selenite — No-Code QA Runner

A Chrome extension for building and running QA test scripts directly in your browser — no code required. Selenite lets you build a queue of browser automation steps via a side panel UI, save and reload scripts, and watch execution logs in real time.

## Features

- Side panel UI — build and run test queues without leaving the page
- Visual step builder — add, reorder, and remove automation steps
- Element picker — click any element on the page to capture its CSS selector
- Save and load named scripts (stored in Chrome sync storage)
- Universal delay override — set a single delay across all steps
- Two execution modes: **close after run** or **loop continuously**
- Tab targeting: run on the **active tab** or open a **new tab**
- Console log with live output and INFO / WARN / ERR filtering
- Stop execution at any time

## Installation

1. Clone or download this repo.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (top right toggle).
4. Click **Load unpacked** and select the `extension/` folder.
5. Click the Selenite icon in the toolbar to open the side panel.

## Usage

### Building a Queue

1. Open the Selenite side panel by clicking the extension icon.
2. In the **Target** section:
   - Optionally enter a URL to open before the queue runs (leave blank to use the active tab).
   - Choose an execution mode: **Close after run** or **Loop continuously**.
   - Choose a tab target: **Active tab** or **New tab**.
3. Click **+ Add Step** to add automation steps to the queue.
4. For each step:
   - Select a function from the dropdown.
   - Fill in any required arguments (use the picker button `⊕` to capture selectors from the page).
   - Optionally set a per-step delay (seconds).
   - Use the checkbox to enable/disable individual steps.
5. Click **Execute** to run the queue.

### Saving and Loading Scripts

- Enter a name in the **Script name** field and click **Save** to store the queue.
- Open the **Load Script** accordion to load or delete a saved script.
- Scripts are saved to Chrome sync storage and persist across sessions.

## Available Functions

| Function | Description |
|---|---|
| `open_url` | Navigates to a URL and waits for the page to load |
| `click` | Clicks an element (CSS selector, ID, name, XPath, or link text) |
| `fill` | Clears and types into an input field (CSS selector, ID, name, or XPath) |
| `submit` | Submits the form containing the matched element |
| `select_by_name` | Selects a dropdown option by element name and option value |
| `send_keys_action` | Sends keystrokes to the currently focused element |
| `explicit_wait` | Waits up to N seconds until a CSS selector is present |
| `implicit_wait` | Pauses all subsequent steps by N seconds |
| `wait_seconds` | Pauses for an exact number of seconds |
| `back` | Navigates back in browser history |
| `forward` | Navigates forward in browser history |
| `refresh` | Reloads the current page |
| `get_current_url` | Logs the current page URL to the console |
| `get_title` | Logs the current page title to the console |
| `maximize_window` | Maximizes the browser window |
| `minimize_window` | Minimizes the browser window |
| `switch_to` | Switches context to a frame, parent frame, main page, or window |
| `alert` | Accepts, dismisses, or reads a browser alert dialog |
| `close_browser` | Closes the browser window and ends the session |

## Project Structure

```
extension/
├── manifest.json      # Chrome extension manifest (MV3)
├── sidepanel.html     # Side panel UI
├── popup.js           # Queue builder, execution engine, UI logic
├── background.js      # Service worker (side panel + tab management)
├── picker.js          # In-page element picker (injected on demand)
└── icons/             # Extension icons (16, 48, 128px)
```

## Script Format

Scripts are stored as JSON arrays in Chrome sync storage:

```json
[
  {
    "func": "click",
    "enabled": true,
    "delay": "1",
    "inputs": {
      "selector": "#submit-btn"
    }
  }
]
```
