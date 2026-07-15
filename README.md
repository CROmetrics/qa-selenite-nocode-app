# Selenite — No-Code QA Runner

A Chrome extension for building and running QA test scripts directly in your browser — no code required. Selenite lets you build a queue of browser automation steps via a side panel UI, save and reload scripts, and watch execution logs in real time.

## Features

- Side panel UI — build and run test queues without leaving the page
- Visual step builder — add, reorder, and remove automation steps
- Element picker — click any element on the page to capture its CSS selector
- Metrics section — define the metric values that fire in the browser output (often prefixed `[PJS]` or `[cro]`) and assert them during runs with the **Track Metric** step
- Save and load named scripts (stored in Chrome sync storage)
- Universal delay override — set a single delay across all steps
- Two execution modes: **close after run** or **loop continuously**
- Tab targeting: run on the **active tab** or open a **new tab**
- Console log with live output and INFO / WARN / ERR filtering, plus a live browser-console mirror with a CRO (`[PJS]`/`[cro]`) filter
- **Test Modes** tab — a menu of self-contained testing modes, each on its own subpage
- WCAG / Accessibility mode — full WCAG 2.2 audit (heuristics + axe-core) with region scoping, check presets, click-to-highlight findings, JSON export, and per-URL run history
- A/B Variant Comparison mode — load each experiment variant once and diff page state, metric fires, and tagged console output against control
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
   - Choose an execution mode: **Close after run** or **Loop continuously**.
   - Choose a tab target: **Active tab** or **New tab**.
3. Every queue starts with a locked **Open URL** step — enter the URL to open (leave blank to use the active tab), plus any URL parameters and the QA Mode toggle (`cro_mode=qa`).
4. Click **+ Add Step** to add automation steps to the queue.
5. For each step:
   - Select a function from the dropdown.
   - Fill in any required arguments (use the picker button `🎯` to capture selectors from the page).
   - Optionally set a per-step delay (seconds).
   - Use the checkbox to enable/disable individual steps.
6. Click **Execute** to run the queue.

### Tracking Metrics

1. Open the **Metrics** section at the top of the Build tab and click **+ Add Metric** for each console value you want to track (e.g. `Tagging: hero_cta_click`). Metrics persist across sessions.
2. Add a **Track Metric** step to the queue and pick a metric from the dropdown.
3. When the step runs, it checks the `[PJS]`/`[cro]`-tagged console output captured during the current run for that value (case-insensitive substring match). A hit logs how many times it fired; a miss logs an error without stopping the queue.

### Saving and Loading Scripts

- Enter a name in the **Script name** field and click **Save** to store the queue.
- Open the **Load Script** accordion to load or delete a saved script.
- Scripts are saved to Chrome sync storage and persist across sessions.

### Test Modes

The **Test Modes** tab lists the available testing modes; clicking one opens its subpage (use **‹ Back** to return to the list). Modes are fully independent of the Build tab's queue.

#### WCAG / Accessibility Mode

Runs a WCAG 2.2 accessibility audit (19 heuristic check suites plus axe-core as the authoritative engine) against the active tab. Pick the criteria to check and click **Run Audit**; rows marked **Manual** include a hand-check list of what to verify yourself.

- **Scoping** — enter a CSS selector (or pick one with `🎯`) to audit only that region of the page. Both the heuristic checks and the axe-core run are constrained to the subtree, so you can audit only the DOM an experiment variant touches. Leave empty for the full page.
- **Presets** — save named check configurations (enabled checks + scope) to Chrome sync storage. Two built-ins are always available: **Full audit** (all 19) and **Automated only** (excludes the manual checks).
- **Highlighting** — clicking an issue row that references a page element scrolls to and flashes that element in the audited tab.
- **Export** — the **Export** button in the results header downloads the run as a JSON file (per check: label, WCAG SCs, status, issues).
- **Run history** — the last 5 runs per page URL are kept in local storage; pick one under **Recent Runs** and click **View** to re-view its results.

#### A/B Variant Comparison Mode

Open the **Test Modes** tab and choose **A/B Variant Comparison Mode**. This mode QAs an A/B experiment (Optimizely, Convert, or similar) by loading the same page once per variant and diffing the captures — no interaction steps, just load and compare. Differences are shown neutrally (a variant is *supposed* to differ from control); only JS errors and load failures are styled as errors.

1. Set the **Base URL** the variants share (each target can override it with its own URL).
2. Define at least two **Variant Targets**. The first is the baseline (typically Control). Each target has a label and an **Override** — the query string that forces the variant, e.g. Optimizely's `optimizely_x=<variationId>`.
3. Optionally add **Watched Selectors** (use `🎯` to pick them from the page) — each is compared across variants for existence, visibility, text, and key computed styles.
4. Optional settings: **QA Mode** appends `cro_mode=qa` to every variant URL; **Settle** waits after load so experiment scripts can apply changes (default 3s); **Keep tabs open** leaves each variant tab open for manual inspection.
5. Click **Run Comparison**. Each variant loads sequentially in its own tab; captures include page title/URL, `[PJS]`/`[cro]`-tagged console lines, Metrics fires (from the Build tab's Metrics list), JS errors, and watched-selector state.
6. Results are grouped diffs vs the baseline — identical facts are greyed and collapsed, deltas are highlighted, and errors are always flagged red.

Variant target sets can be saved by name (stored in Chrome sync storage) and re-run in one click. The comparison never touches the Build tab's queue.

## Available Functions

| Function | Description |
|---|---|
| `open_url` | Navigates to a URL and waits for the page to load (always the first step) |
| `click` | Clicks an element (CSS selector, ID, name, XPath, or link text) |
| `fill` | Clears and types into an input field (CSS selector, ID, name, or XPath) |
| `submit` | Submits the form containing the matched element |
| `select_by_name` | Selects a dropdown option by element name and option value |
| `send_keys_action` | Sends keystrokes to the currently focused element |
| `wait_seconds` | Pauses for an exact number of seconds |
| `back` | Navigates back in browser history |
| `forward` | Navigates forward in browser history |
| `refresh` | Reloads the current page |
| `switch_to` | Switches context to a frame, parent frame, main page, or window |
| `alert` | Accepts, dismisses, or reads a browser alert dialog |
| `track_metric` | Checks the run's console output for a metric defined in the Metrics section |

## Project Structure

```
extension/
├── manifest.json       # Chrome extension manifest (MV3)
├── sidepanel.html      # Side panel UI
├── popup.html          # Popup UI (same layout as the side panel)
├── popup.js            # Queue builder, Metrics section, UI logic (shared by both UIs)
├── background.js       # Service worker (queue execution, console capture, metrics)
├── picker.js           # In-page element picker (injected on demand)
├── console-capture.js  # MAIN-world console patch (relays [PJS]/[cro] tagged output)
├── console-bridge.js   # ISOLATED-world bridge to the service worker
├── axe.min.js          # axe-core, used by the WCAG audit suite
└── icons/              # Extension icons (16, 48, 128px)
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
