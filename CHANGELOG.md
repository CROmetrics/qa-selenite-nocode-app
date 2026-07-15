# Changelog

All notable changes to Selenite are documented here.

## 2026-07-15

### Added

Four Test Modes subpages are now fully built out. All follow the established conventions: self-contained subpages, sequential tab orchestration in `background.js`, no reads/writes/execution of the Build tab's function queue, and no new permissions or libraries.

- **Visual Regression Mode** (`#testmode-sub-3`). Full-page screenshots over CDP (`Page.captureScreenshot` + `captureBeyondViewport`, new `runVisualCapture` action), stored per URL in IndexedDB as **Set Baseline** / **Run Comparison** pairs. Dependency-free canvas pixel diff in the panel with a small per-channel tolerance, an editable mismatch **threshold** (default 0.1%), and **ignore regions** (picker-supported CSS selectors, masked out of both images at capture time). Viewport-width changes flag a warning and skip the diff; page-height changes diff the shared region and count the delta toward the mismatch. Results show pass/fail summary bars, baseline age, and baseline/current/diff images (click to open full size); Export downloads verdict JSON. Baselines are replaceable per page via a ✕ reset control.
- **Cross-Variant Accessibility Mode** (`#testmode-sub-5`). A deliberate hybrid: the WCAG mode's audit engine (extracted into a shared `performWcagAudit()` — the standalone mode's behavior is unchanged) driven by the A/B mode's variant-target machinery (base URL, per-variant override, QA Mode, settle, keep-tabs, saveable target sets namespaced as `cvaVariantSets`). New `runCrossVariantAudit` action loads each variant sequentially and audits it; the panel diffs findings per check vs the baseline into **Introduced** (expanded, error styling), **Resolved** (positive), and **Pre-existing** (collapsed/greyed, never hidden). Defaults to automated checks only; manual checks sit behind an "include manual checks" toggle and render once, not per variant. Supports the WCAG mode's scoped-audit field + 🎯 picker, per-variant summary bars, click-to-highlight into kept-open variant tabs, and structured JSON export.
- **Performance/Load Mode** (`#testmode-sub-6`). New `runPerfMeasurement` action loads each page N times (default 3) in fresh sequential tabs, with the cache disabled over CDP `Network.setCacheDisabled` (toggleable) and JS errors collected via `Runtime.exceptionThrown`. An injected collector reads buffered `PerformanceObserver` entries and the performance timeline after load + settle: TTFB, DOMContentLoaded, load, FCP, LCP, CLS, long-task count/time, and resource count/transfer size by type, plus resources arriving after the load event. The panel reports the **median** per metric (runs viewable on expand) against editable **budgets** with Core Web Vitals defaults (LCP ≤ 2500 ms, CLS ≤ 0.1, TTFB ≤ 800 ms, load ≤ 5000 ms; persisted in sync storage), with progress ("page 2/3 · run 1/3"), stop support, JSON export, and a last-10-per-URL run history in local storage.
- **Session Replay / Heatmap Mode** (`#testmode-sub-7`). Records the tester's own session on the active tab via a new `recorder.js` content script: clicks (with selectors derived by the shared selector builder), throttled scroll samples with max depth, optional 5 Hz mouse movement, and `[PJS]`/`[cro]` metric fires via the existing console-capture path. Background owns the live buffer (`sessionRecordStart`/`sessionEvents`/`sessionSegment`/`sessionRecordStop`), follows same-tab navigations by re-injecting the recorder (each page becomes a segment), caps sessions at 10k events with a visible flag, and survives the panel closing mid-recording. Sessions persist in IndexedDB (last 20, oldest-first eviction) with labels, View/Export/Delete, a filterable event timeline (click events highlight their element), and an injected on-page overlay: density-shaded click dots, mouse-trail polyline, and scroll-depth gutter, rescaled to the current page dimensions. Keystrokes and input values are never recorded; nothing leaves the browser.

### Changed

- The WCAG audit engine moved out of the `runWcagAudit` message handler into a shared top-level `performWcagAudit(tabId, checks, scope)` — behavior is byte-for-byte identical; the handler is now a thin wrapper.
- The element picker's selector-derivation logic moved from `picker.js` into a new shared `selector.js` (`window.__seleniteBuildSelector`), injected before both `picker.js` and `recorder.js`.
- The A/B mode's URL composition was generalized into `composeVariantUrl()` (shared with the Cross-Variant mode); `abComposeUrl` delegates to it.
- The `stop` action now also halts visual-regression, cross-variant, and performance runs (shared `_tmStopRequested` flag).

## 2026-07-08

### Added

- **Metrics section** in the Build tab, above Target. Users define the metric values that fire in the browser output (often prefixed `[PJS]` or `[cro]`, the same values the Console tab's CRO filter surfaces). Rows are added with **+ Add Metric**, removed with ✕, and persist across sessions in `chrome.storage.local` (`metricsList`).
- **`track_metric` ("Track Metric") queue function.** Presents a dropdown of the metrics defined in the Metrics section. When run, it checks the `[PJS]`/`[cro]`-tagged console output captured during the current run for the selected value (case-insensitive substring match). A hit logs `Metric fired ×N`; a miss logs an error without stopping the queue. Dropdowns refresh live as the Metrics list changes, and a metric deleted from the list stays selectable on steps already configured with it.
- **Background metric-fire collection.** Every `[PJS]`/`[cro]`-tagged console line is recorded to a dedicated timestamped `metricsLog` in session storage (capped at 500 entries), fed by the CDP console mirror with a per-tab-deduped fallback via the injected capture script. This is the data source for `track_metric` and for follow-up tracking work.

### Removed

Seven queue functions were removed from the extension:

- `close_browser`
- `maximize_window`
- `minimize_window`
- `get_title`
- `get_current_url`
- `explicit_wait`
- `implicit_wait` (duplicate of `wait_seconds`, which remains)

Saved scripts containing a removed step still load; at run time the step logs `ERROR: Unknown function: <name>` and the queue continues.

### Changed

- The alert-accept warning now recommends `wait_seconds` instead of the removed `explicit_wait`.
- README updated: current function list, Metrics/Track Metric usage, corrected Open URL flow, and full extension file structure.
