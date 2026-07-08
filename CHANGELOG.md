# Changelog

All notable changes to Selenite are documented here.

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
