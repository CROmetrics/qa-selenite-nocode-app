# Changelog

All notable changes to Selenite are documented here.

## 2026-10-16 — 0.7.21

The Test Agent report's summary moves to the current Opus. The rule for models is that anything that acts or perceives (the Test Agent engine, Funnel Crawl, the agentic vision checks, reading a Figma comp) runs on Sonnet, and only analysis runs on Opus. This call is analysis: its prompt reviews every mode's results and separates real issues from likely noise. It had been on `claude-opus-4-8` since the Test Agent tab was added (2a5f20c), and the later move of the other Opus calls to `claude-opus-5` missed it.

### Changed

- **`background.js`:** `summarizeTestAgentResults` (Agentic Analysis) requests `claude-opus-5`, the same model as `runVisualReport` and `aiExtractInitFields`. The request is otherwise unchanged (`max_tokens` 1024, one user message, no `temperature`), so nothing the current family rejects is sent. Every Claude call now uses `claude-sonnet-5` or `claude-opus-5`, all with the one Anthropic key from Settings.

### Verification

- **jsc:** all nine CI suites pass. No test pins this call's model, so none of them can catch a wrong model here.
- **Not run against the API.** The first Test Agent report with Agentic Analysis on is the real check. The worker needs an extension reload to pick it up.

## 2026-10-16 — 0.7.20

A test-fixture refresh; nothing under `extension/` outside `tests/` changes. `regen-fixtures.py --write` was run on 2026-10-14 against the debug logs in `~/Downloads`, after verify-only had shown every existing fixture reproduced. The diff is insertions only: no existing record moved.

### Changed

- **Fixtures:** captures 63 → 74, clusters 43 → 76, runs 31 → 42, specs 51 → 64, funnel 12 → 15. A sixth site enters the corpus: starz.com, thirteen spec logs, all STRZ-1658 (two of them second downloads of the same run). `fixtures-funnel-sentences.json` gains the three new walks' sentences (real 12 → 15); its 35 cases and every existing sentence are unchanged.
- **`real-runs.test.js`, spec suppression census:** graded 28 → 41. Each of the thirteen STRZ-1658 logs was checked against the fixture before the pin moved: the spec is present, its source is `ticket`, and `specTicketKey === activeTicketKey === 'STRZ-1658'`. The other two buckets (graded-unverified 17, none 6) are unmoved.
- **`real-runs.test.js`, funnel `type` actions:** the assertion "none moved the page structurally" is replaced. Three Sept-18 walks (1789760985258, 1789761071265, 1789761141108) have four blind `type` actions (no delivery, "nothing at that point") that recorded 10, 81, 5 and 2 structural mutations, while every quiet action in the same walks (20 screenshot, wait, scroll and key actions) recorded none. So the typing landed there although delivery read false: delivery and the probe are the blind readings, the mutation count is not. The old assertion held only because the earlier logs happened to be quieter. The four are pinned by name, so a fifth gets looked at rather than absorbed; `fnDidSomething` already counts them as progress, which is right.

### Verification

- **jsc:** real-runs.test.js 972 → 1665. All nine CI suites pass (19 / 104 / 1355 / 719 / 1665 / 182 / 10 / 169 / 778).
- **`regen-fixtures.py` verify-only** on 2026-10-16: all five fixtures reproduced, +0 pending.

## 2026-10-14 — 0.7.19

A Prompt Function's instruction is capped at 120 characters. The work was written on `main` on 2026-10-09 and kept in a stash while the checkout was on the BrowserStack branch; it is committed here on top of the 0.7.18 merge, unchanged.

### Changed

- **`popup.js`:** the Prompt Function's prompt box has `maxlength` 120 (`PROMPT_FUNCTION_MAX_CHARS`) and a live counter, "57/120", red with "too long, shorten it to run" for a prompt already over the limit. `maxlength` stops typing and trims a paste, but never shortens a value already there (a queue saved or imported before the limit), which is why the worker checks too. The step's description says "Up to 120 characters".
- **`background.js`:** `runQueue` checks every enabled Prompt Function before any step acts (`fnPromptTooLong`, `FN_PROMPT_MAX_CHARS` 120, counted untrimmed as the panel counts it) and refuses the run with "Prompt Function #1: the prompt is 132 characters and the limit is 120. Shorten it and run again." The message names the step and the length, never the prompt. A disabled step is not checked; an empty prompt is not this check's to refuse.
- The README says so where it describes Prompt Function.

### Verification

- **jsc:** queue-agent.test.js 163 → 169 (an over-limit prompt stops the queue with every step not attempted, the error in the Console, no model call, and the prompt absent from what is stored; a disabled long prompt does not block, and one of exactly 120 runs) and vd-diff.test.js 1350 → 1355 (`fnPromptTooLong` at 120, 121, empty, untrimmed, and never quoting the prompt). All nine CI suites pass on the merged `main`.
- **Not run in real Chrome**, and not against the real model (as for the rest of the Test Agent queue).

## 2026-10-14 — 0.7.18

Merges `main` into the BrowserStack line. `main`'s one release since 0.7.6, the Function Queue through the Test Agent, was numbered 0.7.7 there (2026-10-07), as was the first BrowserStack release here (2026-10-06), so it ships in this build as 0.7.18. Its notes follow as they were written for `main`, after the merge's own.

### The merge

- **Conflicts, resolved as a union:** CI runs both new suites (`queue-agent` and `browserstack`). In Functional Testing's Target section the order is Tab Target, **Cross-browser — BrowserStack Live** (collapsed), **Engine**, then Save/Execute, so Engine sits next to the Execute it governs and the Live block stays inside Target before Save/Execute, as the gate checks; popup.html and sidepanel.html differ only as before (55 cosmetic lines). `persistQueue` calls both hooks: `syncEngineControl()` and `renderBsLiveGrid('ft')`. vd-diff.test.js keeps both lines' new sections. The README's Functional Testing section has the Cross-browser paragraph, then the Engine section.
- **Auto-merged `background.js` and `popup.js` checked:** every function and message handler either line added is present, none is defined twice, and the Anthropic messages URL still appears once.
- **One semantic conflict, in a test:** queue-agent.test.js loaded the worker's imports by a hand-kept list (its harness's `importScripts` does nothing) that predates `browserstack.js`. In the merged worker `doFollow` calls `bsIsLiveDashboardUrl` before attaching the console mirror, so in the test the mirror never attached and a heal took its own debugger session (4 failures). Real Chrome loads `browserstack.js`; the test now reads the list from `background.js`'s `importScripts` line.

### Verification of the merged build

- **jsc, all nine CI suites:** jira-extract 19, figma 104, vd-diff 1350 (981 at the split, +341 from `main`, +28 from the BrowserStack line), qa-report 719, real-runs 972, matrix 182, floating 10, queue-agent 163 (as on `main`), browserstack 778 (as on the BrowserStack line).
- **Real Chrome against the fake Live:** 121 of 121, the real panel booting in both UI files with Execute and A/B Run bound.
- **Real Chrome, a Classic queue:** Open URL, a Click that navigates, and a Click on a selector that does not exist: the page was reached, `main`'s new warning appeared ("⚠ CSS selector not found: #nope — the step did nothing, and Classic goes on."), and the run completed. The Engine control showed Classic. The Test Agent engine was not run (it needs the API key, and `main`'s own real-Chrome gate for it was not kept).
- **Real Live:** a Galaxy S26 from the Cross-browser block: running, the console mirror connected, `location.href` from the phone exact, and "Live ended the session" after Stop.

The Function Queue can run through the Test Agent. A step that fails because its selector no longer finds anything is done by the agent instead, and the run says so in a report. Two new steps are the agent itself.

### Added

- **Engine: Classic / Test Agent** in Functional Testing → Target. Classic is unchanged. With the Test Agent, each step still runs from its saved selector first; only an error that proves the step did nothing (`ID / Name / CSS selector / XPath / Link text / Element / Select ... not found`, or `Autofill matched no fields`) hands that one step to the agent. A disabled control, a submit with no form around it, a navigation mid-step, or any step that is not a click, fill, submit, autofill or dropdown is never healed. After a lookup failure it first retries twice, a second apart, so a late element does not cost an agent run.
  - The agent shares the console mirror's debugger session and never detaches it. It is limited to 5 heals a run and 90 seconds a heal, and the first heal that fails stops the queue.
  - **A heal is a finding, never a pass.** Statuses are `passed`, `healed`, `healed-unverified`, `done-agent-reported`, `failed`, `blocked`, `stopped`, `skipped` and `not-attempted`. `healed` needs a measurement (a delivered click that moved the page, text that reads back exactly, a dropdown that holds the wanted option); a click no element received is a failure whatever the agent said.
  - The agent ends a goal by calling a `report_result` tool, so the outcome is a field and not a regex over prose; the loop handles that call before it touches any other block in the turn, because an unanswered `tool_use` makes the next request a 400.
- **Navigate to (Test Agent)** — the funnel crawl as a queue step. Passes when the tab arrives, comparing host and path (the Open URL step adds `cro_mode=qa`, which `funnelUrlKey` would not match).
- **Prompt Function** — a typed instruction carried out by the agent. Its only inputs are the instruction and the step's usual Delay. Nothing measures what a free-text instruction asked for, so a finished step is `done-agent-reported`, never `passed`. (A measured *Done when* was built for it and removed before release: the step needs no other inputs.)
- **Open as Function Queue** in the Test Agent tab's Funnel Crawl card.
- A report section for the run, a `function-queue` block in Run Diagnostics, and a `queue` key in the debug log. They carry labels, statuses and URLs without their query, and nothing a tester typed: not a Fill value, a Prompt or a Notes field.
- `typed` on a Funnel Crawl `type` action: whether the text landed. An `input` event, or a value that grew, is delivery; an unchanged value that does not contain the text is a measured failure; a password is never read, and `null` is not `false`. 11 of 11 recorded `type` actions had been identical whether or not the text landed. The agent is told only on a measured failure.

### Found

- **A step whose element does not exist has always "passed".** Measured in Chrome 154 against this extension: `chrome.scripting.executeScript` does not reject when the injected function throws. A sync throw, an async throw, a rejected promise, a thrown string and a `ReferenceError` all resolve as `[{documentId, frameId, result: null}]`, with no `error` key. So every `throw new Error('ID not found: x')` in Click, Fill, Submit and Select Dropdown, and the `Element is disabled, click ignored` check, was swallowed inside the page, and the step reported success.
  - **Classic's outcome is unchanged**, because making a long-"passing" queue start failing is the owner's call, not a side effect of this release. It is no longer silent: the Console now says `⚠ CSS selector not found: #x — the step did nothing, and Classic goes on.`
  - **The Test Agent engine is strict**: the step functions now *return* their failure (`{ __selError }`) instead of throwing in the page, and the worker throws it. That is what lets a failed lookup hand the step to the agent, and what makes a disabled control or a missing form fail the step instead of vanishing.
  - **To make Classic fail such a step too** it is a one-line change: set `_stepsStrict` in `runQueue` regardless of `healOn`.

### Changed

- A queue run now keeps a record (`queueRun`), written before `running` flips false. Classic runs keep one too, but only a Test Agent run opens a report.
- A second **Execute** while a queue is running is refused instead of starting a second queue. The guard is the in-memory `_running`, not `_runWin`, which is persisted and restored after a worker restart.
- The queue's MV3 heartbeat now runs inside `runQueue`, which also covers `Wait` steps and long delays.
- `fnPreClickProbeFn` reports `nothingAtPoint: null` with `notProbed: 'no-coordinate'` for an action with no coordinate; it used to say there was nothing at (-1, -1), which `fnStopSentence` could turn into a claim about the page. A `type` action now waits 400 ms before it is read back.
- `fnChooseOptionFn` takes an optional third argument, the option a dropdown step must end on. The funnel passes none and still picks at random.

### Verification

- `queue-agent.test.js` (new, in CI): the whole of `background.js` run as a service worker against a fake page and a scripted model. It covers the heal inside the console mirror's session, the cap, Stop mid-heal, a missing key, a stale persisted run window, Prompt Function and Navigate, and that Funnel Crawl itself is unchanged.
- `fixtures-funnel-sentences.json`: every branch of `fnStopSentence` and every real recorded segment, generated from the build before this change. The funnel's sentences are byte-identical (the generator reproduces the file exactly).
- Mutation-checked: each guard above was removed in a scratch copy and a suite failed.
- **Real Chrome 154** (system Chrome, the real unpacked extension loaded over a pipe, a Retina page, a scripted model in place of the API): 39 checks pass. Heal inside the console mirror's session (Active tab), New tab, New tab after `SPA: Resize`, a fill that replaces a pre-filled field and reads back exactly, a native `<select>`, Prompt Function (run before its Done-when was removed), Navigate (host + path), a disabled control not healed, Funnel Crawl unchanged, one queue at a time, Classic's missing selector, and **Execute from the panel opening the report tab by itself**.
- **The jsc harness had the one thing wrong that mattered.** It modelled `executeScript` as rejecting on a throw, so every "not found" test passed for a step that could never have failed in a browser. The real-Chrome gate found it; the harness now swallows throws as Chrome does.
- Not yet verified on a real run: the model itself. The vision loop needs an Anthropic key and a reloaded extension; everything around it has run in real Chrome.
## 2026-10-14 — 0.7.17

A Live tab's own address is not a device name either.

### Measured (2026-10-14)

- On a real Mac Safari launch the Browser Console line read "○ Open DevTools in the Live session to mirror live.browserstack.com's console" for about 3 s.
- Opening Live links in a tab and reading its title every 25 ms: in 1 of 4 loads `chrome.tabs.get` gave "live.browserstack.com/dashboard#os=android…" (the tab's address without the scheme) between "" and "Dashboard"; `tabs.onUpdated` reported only "Dashboard". Chrome titles a page with its address until the page sets one, and the dashboard sets its title from script.

### Changed

- **`browserstack.js`:** `bsTitleNamesNothing`: 0.7.16's idle countdown, or a title that is Live's own host or address (`live.browserstack.com`, optionally with a scheme, then a path, query, fragment or nothing).
- **`background.js`, `popup.js`:** the four places that name the device from the tab's title (the `tabs.onUpdated` title-follow, `captureTitle` for follows and refreshes, the `bsDeviceLog` label, `bcDeviceName`) use it in place of the countdown check alone, so the device keeps the name it had, or none.

### Verification

- **jsc:** browserstack.test.js 770 → 778 assertions: the measured address, the host, with a scheme or capitals; the countdown still; device names, "Dashboard" and other hosts not caught; `captureTitle`, the real title-follow branch and the real `bsDeviceLog` branch with the address; `bcDeviceName`. 9 mutations of the change (back to the countdown check at each use, the pattern unanchored, needing a scheme, a path, or the case) all fail the suite. All eight CI suites pass.
- **Real Chrome against the fake Live:** 121 checks (118 before). `fake_live.TITLE_LATE` serves the dashboard without its `<title>`, as the real one is titled from script; the new `loading-title` scenario launches Mac Safari under it, checks the tab really was titled with its address, and that nothing in the panel named it so. On 0.7.16 it fails: the console line carried the whole launch link, the page's own URL inside it.
- **Real Live:** three Mac Safari launches, the console line sampled every 100 ms: it never named the address. The raw tab titles were not sampled, so these runs show the glitch gone without proving it was triggered; the gate scenario forces it.

## 2026-10-14 — 0.7.16

Live's idle countdown no longer takes the device's name.

### Measured on real Live (2026-10-14)

- The account's `BrowserStack.user.idle_timeout_for_devices` is 10. A Galaxy S26 session left untouched: about 9 minutes after the last input Live retitled the tab "60 seconds to session timeout", then "59 …" down to "1 seconds to session timeout" (Live's spelling), once a second, with the session toolbar gone and the device picker still hidden; then the title "Dashboard", the picker back, and "Your remote session has been closed due to inactivity."
- 0.7.15's launch line handled it: "running" through the countdown (the picker never came back, so no false end), then "Live ended the session on the start URL on Galaxy S26." a second after Live closed it, and the watch stopped. But the worker follows the tab's title to name the device, so for that minute the Browser Console line read "○ Open DevTools in the Live session to mirror 37 seconds to session timeout's console", changing every second, and a device line logged then would have been labelled with the countdown.

### Changed

- **`browserstack.js`:** `bsIsCountdownTitle`, the countdown's title as measured (`<n> second(s) to session timeout`, whole title, any case).
- **`background.js`:** the `tabs.onUpdated` title-follow leaves the captured tab's name as it was when the new title is the countdown; `captureTitle`, used where a follow or a refresh copies the tab's title in, keeps the name that tab had (or none, for a tab not named before); `bsDeviceLog` labels device lines with that name while the tab's own title is the countdown.
- **`popup.js`:** `bcDeviceName` treats the countdown as no name ("this session"), for a status that was stored before this change.

### Verification

- **jsc:** browserstack.test.js 753 → 770 assertions: all sixty measured titles and near misses; the real title-follow branch kept on the device's name through 60 → 1 and following "Dashboard" afterwards; `captureTitle`; the real `refreshBsLive` run mid-countdown; the real `bsDeviceLog` branch labelling a line during the countdown, with no stored name, and with another tab's; `bcDeviceName`. 10 mutations of the change all fail the suite. All eight CI suites pass.
- **Real Chrome against the fake Live:** 118 checks (114 before), including a new `countdown` scenario that retitles the fake dashboard through a countdown and logs a device line during it. It fails 3 of its 4 checks on 0.7.15 (captureStatus, the console line, and the line's label all "56 seconds to session timeout").
- **Real Live:** a Galaxy S26 left untouched until Live closed it "due to inactivity": Browser Console said "mirroring Samsung Galaxy S26 v16.0" up to the close, and the 18 device lines logged from 13:55:30 to 13:58:20, the countdown minute among them, were all labelled "Samsung Galaxy S26 v16.0". Live's own tab title was not sampled in that run; the countdown is inferred from the inactivity close, which it preceded in the measured run.

## 2026-10-14 — 0.7.15

The A/B capture now records the JS errors a variant throws while its page is loading, the blind spot 0.7.14 left open.

### Measured in Chrome 154 (2026-10-14), before the change

- A local page that throws while it parses, rejects a promise while it parses, and throws again 1.5 s later. With the collector injected after load only, as before, 3 of 3 loads recorded only the later error. Registered at `document_start` in the MAIN world and injected again after load, 5 of 5 loads recorded all three, once each, and nothing was left registered.

### Changed

- **`ab-error-collector.js`** (new): the collector that was a `func` inside `injectAbErrorCollector`, unchanged (`window.__abErrors`, uncaught errors with file and line, unhandled rejections), because a registered content script must be a file. It records once however many times it runs.
- **`background.js`:** `injectAbErrorCollector` runs that file after load, and `registerAbEarlyCapture` registers it beside 0.7.14's console scripts (`selenite-ab-early-errors`, MAIN world, `document_start`, top frame, not kept across restarts), with the same clean-up: taken away when the capture ends and cleared by a starting worker. Other tabs on the same host that load during a capture get an error list nothing reads.
- The README's A/B section says console lines and JS errors are both caught from the start of the load.

### Verification

- **jsc:** vd-diff.test.js 1005 → 1009 assertions: the collector file against a fake window (the three errors measured above, in order, once each though it ran twice; one listener of each kind; a missing message, file or reason reading as before), the post-load injection running the same file in the MAIN world, and the early registration now three scripts. 7 mutations of the change all fail the suite. All eight CI suites pass.
- **Real Chrome, the real extension, a real A/B run:** the throwing page gave both variants all three errors (the later one only, before); the 0.7.14 console page still gave its `[CRO]`/`[PJS]` lines and no errors; nothing was left registered. The BrowserStack gate passes 114 of 114.

## 2026-10-14 — 0.7.14

The A/B capture now catches the console lines a variant logs while its page is loading.

### Found (2026-10-13)

- Field-checking 0.7.9's console fix in a real A/B run: a local page that logs `[CRO]`/`[PJS]` lines only while it parses read `consoleLineCount` 0 for both variants; the same lines logged 1 s and 2.5 s after load were caught. `captureVariant` injects the capture scripts right after `tabs.create` (before the page has a document Selenite can script) and again after load, so anything logged in between was lost. An experiment snippet in the page's head logs exactly then.

### Measured in Chrome 154 (2026-10-14), before the change

- `chrome.scripting.registerContentScripts` with console-capture.js in the MAIN world at `document_start` and console-bridge.js beside it caught both tagged lines of a page that logs only while it parses, in 16 of 16 loads.
- A match pattern without a port (`http://localhost/*`) matched a page on `localhost:8777`, as did one with the port.
- `tabs.create` resolved 5 to 15 ms after the call and the first line reached the worker 25 to 55 ms after it: 20 to 40 ms later, every time. So `_abCapture` is set before the first line arrives, and no buffering of lines from a not-yet-known tab is needed.

### Changed

- **`background.js`:** `captureVariant` registers both capture scripts for the variant's host (`scheme://host/*`, top frame only, `document_start`, the bridge first, not kept across browser restarts) before it opens the tab, and takes them away in its `finally`, so a capture that fails or a tab that never opens leaves nothing registered. A worker that starts clears any it finds, since one stopped mid-capture would have left them. A registration Chrome refuses leaves the capture as it was. The post-load injection stays, for a variant that redirects to another host, which the early hook does not cover. Both scripts are idempotent, so a line is captured once.
- Other tabs on the same host that load during a capture get the same tag-only hook a followed tab already gets; the `browserLog` branch keeps only the variant tab's lines for the run.
- The README's A/B section says lines are caught from the start of the load.

### Verification

- **jsc:** vd-diff.test.js 991 → 1005 assertions. The real `abEarlyCaptureMatches`, `registerAbEarlyCapture`, `unregisterAbEarlyCapture` and `captureVariant`, sliced out of background.js, run against a stubbed `chrome` with an event log: registered before the tab opens and taken away after it closes; the registration's shape; taken away when the page never loads and when the tab cannot be opened; a refused registration costing nothing; a leftover half cleared before registering; a starting worker clearing leftovers. 13 mutations of the change all fail the suite. All eight CI suites pass.
- **Real Chrome, the real extension, a real A/B run:** the page that logs only while loading gave v0 `[CRO] page ready 0` and v1 `[CRO] page ready 1` + `[PJS] variation 1 applied` (0 and 0 before); a page logging both while loading and 2 s later gave each variant both lines, once each; no registration was left after either run. The BrowserStack gate passes 114 of 114.

### Not changed

- JS errors a page throws while loading have the same blind spot: `injectAbErrorCollector` still attaches after load.

## 2026-10-13 — 0.7.13

When Live's DevTools breaks, Browser Console now says so instead of blaming its own reading of it.

### Measured on a real session (2026-10-13)

- A Galaxy S26 launched with Local, which Live started without it (the phone was on Live's "Unable to connect… Trying to test a private URL or localhost?" page). Live's DevTools pane opened to "Developer tools have experienced an unexpected issue. Please try a new session." That text is in the dashboard's `document.body.innerText`, over two lines. The `iframe.devtools-iframe` kept a same-origin `src` path but its document was cross-origin: reading anything in it threw SecurityError.
- 0.7.12's tap could not hook that frame, and it only looked for Live's notice when there was no frame at all or a hooked one with no device. So the status line read "○ Open DevTools in the Live session to mirror Samsung Galaxy S26 v16.0's console" for 30 s, then "○ Can't read this version of Live's DevTools (unknown version)", and a command answered "The device page has no script context yet… reload it on the device".
- A second launch set up the same way did not break: DevTools opened, was readable, and Selenite mirrored the phone. The failure is not reproducible on demand.

### Changed

- **`bs-live-tap.js`:** when a DevTools frame is on the page but none can be read, Live's notice is checked before anything else, and if it is there the state is **failed** with Live's sentence, at once, and stays failed (never "unsupported", which is about a frontend Selenite doesn't know). A device attached with no page context while the notice is up is also **failed**, without reading the page. A device with a page context stays connected whatever the notice says, so a notice left over from earlier cannot hide a working mirror.
- **Commands** on a frame that cannot be read answer "Live's DevTools failed: <Live's sentence>" when the notice is up, "Live's DevTools is still opening. Try again in a moment." in its first 30 s otherwise, and after that "Selenite can't read this version of Live's DevTools, so commands can't run through it." A device with no page context and the notice up gets Live's sentence too.
- The README's Browser Console section has a line on it.

### Verification

- **jsc:** browserstack.test.js 740 → 753 assertions, against the page as measured: a frame whose window throws SecurityError on every property and the notice split over two lines of body text. The notice from the start, arriving later, absent for 30 scans (still "unsupported"), with a pageless device, and with a working one; the command replies in each case; and the frame's `src` (the token) never read. 7 mutations of this change all fail the suite. All eight CI suites pass.
- **Real Chrome against the fake Live:** 114 checks (109 before), including a new `mirror-failed` scenario whose fake DevTools is a sandboxed frame (same `src` path, cross-origin document) with Live's notice on the dashboard: failed in Live's words within seconds, the panel line, the input disabled, a command refused with Live's reason, and still failed 32 s on. It fails 4 of its 5 checks on 0.7.12 ("closed", then "unsupported", and "no script context yet").

### Not yet verified

- The fixed path on a real broken DevTools: it did not break again when tried.

## 2026-10-13 — 0.7.12

On an iPhone 17 (iOS 26) Browser Console said "● Live — mirroring iPhone 17 v26.6" and enabled the command input while Live's DevTools was attached to an empty tab. This release says so instead.

### Measured on real sessions (2026-10-13)

- **iPhone 17, three sessions (iOS 26.5 and 26.6):** choosing **Chrome DevTools** in Live's DevTools menu attaches it to the device (one target, 0.2 s later), but for the 40 s sampled the frontend never had a selected execution context, its target's inspected URL stayed empty, and its console model had no messages. `location.href`, read through the target's runtime agent (`runtimeAgent().invoke_evaluate`, which answers without a selected context), was `about:blank`: Safari's Start Page, not the page under test. A reload through DevTools changed nothing. The old status line called this "connected" because a target existed, and a command answered "The device page has no script context yet… reload it on the device", which did not help.
- **Galaxy S26, the working case, sampled every 100 ms:** the target appears 0.4 s after DevTools opens and the page's context and URL 0.2 s after that; a reload leaves the page without a context for 0.1 s, with its URL kept; a navigation showed no gap. The runtime agent's `location.href` read works there too.

### Changed

- **"Connected" needs a page to run in** (`bs-live-tap.js`). A device whose frontend has no selected context is reported as **attaching** for up to three scans (a session already connected stays connected through them, which covers the Galaxy's reload gap), then the tap reads `location.href` once through the runtime agent and reports a new state, **nopage**, with `page: 'blank'` (about:blank or empty) or `'other'`. It reads again every 10 scans in case the tab is navigated, gives a read 5 s, and keeps the last answer when a later read fails. A context that arrives later turns it back to connected. This is the only expression the tap evaluates of its own accord.
- **The status line** (`bcDeviceLine`): "○ Live's DevTools on iPhone 17 v26.6 is attached to an empty tab (about:blank), not the page under test, so there's nothing to mirror and commands can't run." For a page other than about:blank it claims less: "○ Live's DevTools is attached to … but gives Selenite no page to run commands in." The command input stays disabled ("> Live's DevTools has no page on the device to run commands in"), and a command that still reaches the device on an empty tab is refused with that reason rather than "wait, or reload".
- `bs-live-bridge.js` and the worker's `bsDeviceState` handler accept `nopage`, and pass `page` only as `blank` or `other` (never a URL).

### Also tested on real Live (2026-10-13, 0.7.11)

- **Functional Testing's Cross-browser block**, until then run only against the fake Live: its buttons are disabled while the Open URL step is blank; with a URL, parameters and QA Mode set, a Galaxy S26 launch opened exactly the start URL (`https://` added, `cro_mode=qa` last, read back from the phone with `location.href` through Selenite's console), its own line followed the session to "Live ended the session", and the A/B line and record were untouched.
- **The side panel and the floating window**, the two surfaces a tester launches from (there is no toolbar popup since 0.7.3, so 0.7.10's "the `bsWatchLaunch` message from the toolbar popup" no longer applies): a launch from each opened the Live tab in the browser window Selenite belongs to, the line followed the session from start to end, and the console mirror connected within about a second of DevTools opening. The 📌 button moved Selenite from the floating window to the side panel.
- **iOS 27** (iPhone 18 Pro, iPad Pro 13) through the extension: "Live has no DevTools for …" with Live's reason, the input disabled, held through the toolbar's absence.

### Verification

- **jsc:** browserstack.test.js 687 → 740 assertions: the tap against the measured timelines (the Galaxy's attach and reload gaps, the iPhone's 40 s without a context and its about:blank answer), reads that are refused, throw, answer a thrown value, never answer, or answer a page later; the bridge; the panel line; and the worker's `bsDeviceState` branch, sliced out of background.js (its state list had no test). 18 mutations of this change all fail the suite, each with readable failures. All eight CI suites pass.
- **Real Chrome against the fake Live:** 109 checks (101 before), including a new `mirror-nopage` scenario whose fake DevTools has a device, no context and an about:blank answer. It fails 6 checks on 0.7.11, showing what real Live showed: "mirroring", the input enabled, the old advice.
- **Real Live:** on an iPhone 17 (iOS 26.6) the line read "waiting for it to attach", then, about 4 s after Chrome DevTools was chosen, the empty-tab line, with the input disabled. On a Galaxy S26 the mirror connected, `location.href` and `location.reload()` ran from Selenite's input, and the reload did not change the line.

### Not yet verified

- Whether a Live iOS session loads the link's page at all: screenshots of the device stream froze in the test harness (the device clock stopped), so they cannot show it. Someone has to look at the Live window.
- Whether **Safari Web Inspector**, the other item in Live's iOS DevTools menu, attaches to the right tab. Selenite cannot read that inspector either way.

## 2026-10-09 — 0.7.11

0.7.10 was tested on real BrowserStack Live with the extension itself for the first time (until then the real pieces had been run inside Live pages by hand). It held up, apart from two things this release fixes.

### Tested on real Live (2026-10-09)

- **In Will's own Chrome:** a Galaxy S26 launched from the A/B tab; the status line, the console mirror (a `[cro]` line logged on the phone appeared in Browser Console) and a command typed into Selenite's console that ran on the phone.
- **In a separate Chrome driven over its debugging pipe** (`extension/tests/browserstack-gate/live.py`, signed in once): the Check button against the real Local app; a Galaxy S26 with Local on ("Waiting", then "running" at 5.6 s with no claim about Local, then at 7.6 s "Live started it before it found your BrowserStack Local app" with the manual button; the phone really showed BrowserStack's "Unable to connect" for a page served only on this Mac); the manual button's link (Local on, no `start=true`) and line; the console mirror and a command from Selenite's input on a Galaxy S26 Ultra; a Windows Chrome session with no false "ended" while Live's toolbar was away; a real refusal on Windows Chrome ("Connection to the remote device failed", reported as didn't start); and a tab closed before the session started.
- **Found:** (1) the watch stopped 40 s after a session started, so Stop Session pressed at about 50 s left the line saying "running"; (2) a device picked by hand through the manual route, after Live had detected the Local app (`LocalTesting.bsLocalSuccess` true), still started without Local: Live never completed its handshake with the app (`commandLineTunnelExists` stayed false) and the phone could not reach this Mac. On 2026-10-08, in an everyday Chrome profile (which also has the BrowserStack extension), the same route did reach it.

### Changed

- **The launch watch follows a running session to its end** (`bsWatchLaunch`): every second for the first 40 s as before, then every 5 s (`BS_LAUNCH_SLOW_POLL_MS`) until the session ends, drops or its tab closes, with a 4-hour cap (`BS_LAUNCH_WATCH_MAX_MS`). An end that is not yet believed is read again a second later, so the report comes 1 to 6 s after the session stops.
- **The manual route's line no longer promises Local:** "When Live's Local Testing panel shows Local connected, pick the device in its list, then check that the page loads on it: Live doesn't always attach Local to a session started this way."
- **`extension/tests/browserstack-gate/live.py`** (new): runs the real extension against real Live in a persistent Chrome profile of its own and exposes a small control server (`panel`, `ev`, `shot`, `tabs`, `open`, `front`, `stop`). Each start uninstalls and reloads the extension, because that profile otherwise reuses the background script it cached on the previous run (it ran 0.7.10's worker under 0.7.11's panel until this was added). Two one-time steps for a fresh profile: a password manager for passkeys, and allowing Local network access on live.browserstack.com, without which the page's requests to the Local app hang and Live never finds it.

### Verification

- **jsc:** browserstack.test.js 679 → 687 assertions (the watch after the 40 s: an end, a drop, a closed tab, one odd reading, the 4-hour cap; the manual-route line). 18 mutations of this change and of the 0.7.10 rules all fail the suite. All eight CI suites pass.
- **Real Chrome 154 against the fake Live:** 101 checks, including a new `ended-late` scenario (Stop Session 45 s in).
- **Real Live:** a Windows Chrome session launched from Selenite in the separate Chrome; 55 s in the watch was still on, and Stop Session pressed then gave "Live ended the session on v0 on Windows Chrome." 2.5 s later.

### Not yet verified

- The manual route in Will's everyday Chrome since this release; why Live attaches Local there and not in a fresh profile.
- A session dropped by Live (rather than stopped) more than 40 s in, on real Live.

## 2026-10-08 — 0.7.10

BrowserStack Live launches now report what Live did with them. The 0.7.7 and 0.7.8 changelogs listed Local, force-local, `start=true` and the device console as "not yet verified"; on 2026-10-08 they were run for the first time on real sessions (an iPhone 18 Pro, iPhone 17, Galaxy S26, Pixel 10, iPad Pro 13, Galaxy Tab S11 and Mac Safari, Windows Chrome, Edge and Firefox) with the Local app connected, and several of them did not do what they claimed.

### Measured on real sessions (2026-10-08)

- **`start=true`** starts the session. Lowercase `os=ios|android`, `device_browser`, `device=Samsung+Galaxy+S26` and `os_version=27.0` are accepted, and Live rewrites the hash to `os=iOS…` once it has read it. It reads the link at page load only: changing the fragment afterwards does nothing.
- **Local through a link failed in all 6 launches checked on the device**, cold and warm browser, with and without `force-local=true`, and with `use_cmd_local=true` added: the device showed BrowserStack's "Unable to connect to the page you requested… Trying to test a private URL or localhost?" and a server on this Mac saw nothing. Cause, from the dashboard's own source: it starts the session about 6.5 s after load, while its Local check (first `https://bs-local.com:45690`, which fails in ~25 ms, then `http://127.0.0.1:45691`) only completes at about 7.6 s. Its wait-for-Local mode needs `always_enable_force_local && waitForPollingInIntegrationFlow`; this account has the second off, so it gets a 5 s hold on a single pre-start request and then starts anyway. The same page loaded without `start=true` detects the app in ~7 s, and a device picked by hand afterwards reaches a server on this Mac (the log showed the request).
- **Two things that did not help:** applying the app's answer early through the dashboard's own `commandLineTunnel` callback turned the dashboard's "Local at start" on, but the phone then landed on Google (the page URL was dropped), with or without `use_cmd_local`; and calling its legacy `startSessionWithPolling()` left the session booting indefinitely.
- **`force-local=true` in a link** set the dashboard's legacy flag but not the state behind its "Resolve all URLs through my network" switch, and the device's public IP was not this Mac's. Flipping the switch by hand turned the state on and reconnected the session, after which DevTools showed "Developer tools have experienced an unexpected issue." The effect on the device's IP was **not** verified.
- **The real Local signal** is the binary's own port, which the dashboard polls every 2 s: `GET http://127.0.0.1:45691/?_=<ts>` answers JSONP, `commandLineTunnel('<key-masked>-nativeapp:<id>', …)`. The app console's `/status` on 45454 only says it is signed in.
- **A session that ran without Local is detectable** from the page: `Reactor.localTesting.getLocalStatusAtStart()` is the dashboard's own record, `false` after a lost race. It read `true` in 5 of the 8 launches read this way (iPhone 18 Pro, iPad, and three desktop sessions, none of which asked for Local) and `false` in 3 (Galaxy S26, iPhone 17, Tab S11): the race is sometimes won, so Selenite only reports what it reads.
- **iPhone 17 at `os_version=26.1`** (in BrowserStack's catalogue) was refused every time with "Device is temporarily disabled. Please try again in some time."; `26.0` starts (the tab read "iPhone 17 v26.5"), once dropping ~10 s in with "Connection to the remote device failed."
- **DevTools.** iOS 27: the toolbar item `li.switchDevtools-menu-wrapper` has `aria-disabled="true"`, the tooltip reads "Currently DevTools is unavailable for iOS 27.0 Safari" and `#devtools_message` reads "Developer tools are disabled because of multiple browser tabs on iOS 27.0 devices. Please close all other tabs to enable." (Safari opens two tabs: a default Google tab and the link's page). Desktop browsers (Mac Safari, Windows Chrome, Edge, Firefox): a toolbar of eleven items and none for DevTools. Pixel 10: "unavailable for Android 16.0 Chrome", while the Galaxy S26 on the same had it. A frame can be on screen with `SDK.targetManager.targets().length === 0` (no device behind it) while its console model exists, which the tap reported as connected; this happened in 2 of 5 Android DevTools opens (one right after the force-local switch).
- **A desktop session keeps the tab title "Dashboard"**; a phone or tablet renames it "<device> v<os>" seconds after it starts.
- **How a session's page unfolds, sampled every 100 ms** on an iPhone 18 Pro (iOS 27, three runs), a Galaxy S26 and Windows Chrome: the device picker's search box (`#device-search-field`, 101×24 on screen) is there at first, gone from boot until the session ends, and back, with the title "Dashboard", within 2.5 s of Stop Session. A phone's tab is renamed "<device> v<os>" **5 to 10 s before anything else**. The session toolbar then appears (7 or 15 items on iOS 27, 11 on desktop, 15 on Android), and **only at that moment does `getLocalStatusAtStart()` read true**: it reads false from page load. On iOS 27 and on desktop the toolbar is rendered, **goes away for about 4 s, and comes back** (its first appearance lasted 1 s); on the Android 16 session it stayed.
- **What that would have done** (found by running the watcher on those timelines, not by any earlier test): a desktop session, whose only "running" sign is its toolbar, would have been reported "Live ended the session" about 2 s in, and the watch would have stopped; and a phone that gets Local would have shown "Live started it before it found your BrowserStack Local app" with the manual button for 5 to 10 s, because the title said running while Local still read false.

### Changed

- **The launch status line follows the session.** `launchBsLiveTab` no longer reports success when the tab opens. The worker (`bsWatchLaunch`) reads the Live tab every second (`bsLiveReadOutcome`, run in the page) until the session has settled, and writes the result as `bsLaunch_<place>` (`ab` or `ft`) in the window's session storage; the panel renders it (`bsLaunchLine`): waiting, running, refused with Live's own banner text, dropped (it had started), closed (the tab went), left (Live sent the tab to sign in, host only), ended, timed out after 75 s, or lost (the watch died and nothing reported). It runs in the worker because the toolbar popup closes when the tab takes focus.
- **What it will and won't believe.** *Refused* and *ended* need two readings in a row (the dashboard re-renders and raises toasts of its own); an unbelieved reading leaves the record as it was. An error banner counts only when no session is running, because a toast beside a running session (a recording that would not start) is some other business. **Once a session has started, "ended" and "dropped" also need the device picker to be visibly back on screen**: "not running" alone is what a toolbar that is re-rendering looks like for seconds. **Local, force-local and the DevTools verdict are read only once the session toolbar is on the page**, since the dashboard's Local-at-start record is false until then, and what the toolbar said is kept while it is away. A phone is "running" from its title, so the line says that without a word about Local until the toolbar can say it. A tab that has gone elsewhere is reported as *left* and watched on, because a signed-out tester returns from sign-in and the session starts; once a session had started, a tab elsewhere is *ended*. A watch writes only while its launch is the newest from its place; a later launch's record is never overwritten. It settles 40 s after the session starts: in the three iPhone runs the toolbar was final about 15 s after the title said running, and 40 s leaves room for a slower start.
- **Launches are serialized and each place has its own report.** Two quick clicks run one after the other (the later closes the earlier's tab, including one that has only a `pendingUrl` yet), a launch from the A/B tab never overwrites Functional Testing's report, a report is shown only while its Live tab is still the one opened last (or says it was closed), and one more than ten minutes old is history.
- **"Open anyway"** (Local not found before the launch) asks the watcher about Local like any other launch and says, if the session lacks it, that Local wasn't connected when it was opened, instead of offering a manual route that could not help.
- **Started without Local** is reported, with the manual route: **Open Live and pick the device myself** opens Live with Local and the page in the link but no `start=true`.
- **The Local check asks the binary's port** as well as the console; a signed-in console with a silent binary port is "not connected", where `/status` alone passed it. The README and the toggles' tooltips no longer promise that force-local works from a link.
- **Console mirror states.** `bs-live-tap.js` reports `attaching` (a frame with no device; `late` after ~15 s), `unavailable` (with Live's reason, from the toolbar item or, for desktop sessions, a rendered toolbar with no DevTools item on two scans in a row, since a phone's toolbar renders item by item) and `failed` (Live's own notice), and `connected` only when a target exists. While the toolbar is away (above) an `unavailable` is kept for 8 scans, and an item-less toolbar needs two scans in a row, so the status line does not flip to "open DevTools" and back. Commands on a frame with no device, or with a device but no script context (iOS 26.5, one target and no execution context), say so and what to try. The panel's device wording is a tested pure function (`bcDeviceLine`; on an iPhone or iPad it says to choose Chrome DevTools in Live's menu), and the checklist marks the iOS 27 and desktop presets "no console mirror".
- **iPhone 17** is `os_version=26.0`.
- **Fixed:** `captureStatus.title` followed the page load only, so the panel named a phone "Dashboard" once Live renamed its tab. The worker now keeps it current.
- **Fixed:** a Live tab that was still loading when Selenite first looked at it (no committed `url` yet, as with Live's real first-load delay) was recorded as not capturable and never looked at again, so a tab Selenite opened itself never got its console mirror. `followedWinFor` finds it again when its page finishes loading. Found by the real-Chrome gate and again by review.

### Verification

- **jsc:** browserstack.test.js 238 → 679 assertions: the page reader, verdict and status line against pages shaped as measured; the real `bsWatchLaunch` (debounce, supersession, closed, left and back, the 75 s deadline), its message handler and the title branch sliced out of background.js and run against a fake `chrome` with a virtual clock; the real `openBsLive`, `launchBsLiveTab` (serialization), `renderBsLaunch`, `bsCheckLaunchLost`, `openBsLiveManual`, the status-line buttons and the report listener sliced out of popup.js; the tap against fake Live pages with a target list. The measured timelines above are fed through the real watcher (a desktop toolbar away for 4 s and for 12 s, a phone whose title runs 10 s ahead of its toolbar, a drop that waits for the picker). 154 mutations of the code (each fix reverted, each claim weakened, each guard removed) all fail the suite; three passes of them left ten alive in total, each a missing test, now written. All eight CI suites pass.
- **Real Chrome 154, the real extension, a fake Live built from the measurements above** (the harness is `extension/tests/browserstack-gate/`, with a README; it builds its own certificate and fake Local app and takes about five minutes; CI does not run it because it needs branded Chrome; 97 checks, all passing on the final code, including the toolbar vanishing for 4 s, a phone's title running ahead of its toolbar, and Stop Session): the real panel (popup.html and sidepanel.html) boots with no exception and the Check button asks this Mac's real Local app; a launch ends in the right line for Local missed (with the manual button, which opens a link without `start=true`), iOS 27, refused, dropped after starting, a desktop session, "Open anyway", the tab closed before and after it started, the tab sent to sign in and back (the line follows the session when it starts), an error toast beside a running session, two quick launches (one tab, no "closed" for the earlier), and a Functional Testing launch with its own record; the worker follows the Live tab, injects the real tap and bridge, and the panel shows closed → connected → attaching → late → connected, with the device's console line in the feed and a command refused while detached. This found three bugs in the first version: the watcher judged a just-created tab by its empty `url` and quit before starting (fixed: judge by `pendingUrl` until it has finished loading), a desktop session was never recognised as running, and a stored report outlived its closed tab.
- **Real BrowserStack Live:** the page reader returned what the unit tests assume on the real picker, a refused launch, a running iOS 27, iPad, iPhone 17, Tab S11, Pixel 10 and Android session, and the four desktop sessions; the new tap on the real iOS 27 session posted `unavailable` with Live's sentence, and on a real Android session went `closed` → `connected realios 91.0.4472.101` with one target. All ten presets started on real Live (the Pixel 10 on its second try: the first showed neither a session nor a banner after 20 s). **The real, unmodified watcher, verdict, reader and status line** (sliced out of background.js and browserstack.js, run inside real Live pages) were then driven through four launches: Windows Chrome (starting → started with Local from the toolbar → ended 4 s after Stop; nothing during the toolbar's absence), iPhone 18 Pro (running with no claim about Local at 5 s, Local and the iOS 27 sentence at 20 and 22 s, ended after Stop), Galaxy S26 with Local requested (running at 5 s, then the "started before it found your Local app" warning with the manual button at 10 s, once the toolbar existed) and iPhone 17 at 26.1 (refused in 5 s with Live's words).

### Not yet verified

- The panel's own buttons driving a **real** Live session end to end (the gate used a fake Live; the real watcher, verdict and line were run on real Live pages, but not through the extension's worker and panel).
- A real **drop after start** ("Connection to the remote device failed") under the new rule that it needs the picker back on screen: that is what a session ending looks like (measured), but a drop has not been reproduced on demand since.
- Whether switching "Resolve all URLs through my network" on actually makes the device's IP this Mac's, and whether DevTools can be used after it.
- The tap's `attaching` state on a real frame with no target, and the DOM where Live draws its "unexpected issue" notice (it is matched by its text).
- The `bsWatchLaunch` message from the toolbar **popup**, which can close before it is sent; the side panel and the floating window stay open.

## 2026-10-07 — 0.7.9

The A/B tab's per-variant console was empty on every run, and counting it in the badge would have made it wrong the moment it filled.

### Fixed

- **A/B captures never held a console line.** All 208 captures in the 106 recorded logs read `consoleLineCount` 0, back to 36a0022. A run owns its window, so `followTab` never maps the variant tab, and the `browserLog` handler returned at its window lookup before it reached the per-variant buffer. The buffer is now filled first, synchronously, so a line is either in `captureVariant`'s copy or arrives after it and is dropped. Which window a line feeds is unchanged.

### Changed

- **Console lines no longer count toward the A/B badge.** A variant logging a line control doesn't (`[PJS] variation 2 applied`) is what a working variant does, and lines are compared by exact text, so a timestamp or an id differs on every run. With the buffer working, one differing line turned PASS into ISSUES FOUND, and the report renders no console lines that could explain why. Page basics, watched selectors and metrics still count: whether a conversion event fires differently is a QA result. The summary now reads "difference(s) in page basics, watched selectors and metrics".

### Verification

- **jsc (CI):** qa-report.test.js and vd-diff.test.js each gain a block. They run the real `rptAbSection` and `diffAbCaptures`, and the real `browserLog` branch sliced out of background.js. They fail without the fix (3 and 2 assertions) and pass with it. All eight CI suites pass.
- **Not yet verified:** a real A/B run in Chrome with this build, and whether a variant's tagged lines now arrive in the debug log.

## 2026-10-07 — 0.7.8

Browser Console now mirrors a BrowserStack Live device. On a Live tab it shows the iPhone's or Android's console, labelled with the device, instead of the Live page's own, and the command input and Quick Commands run on the device. Before this, focusing a Live tab mirrored BrowserStack's dashboard page, and a Quick Command ran there.

### Added

- **The device's console, read from Live's own DevTools.** Measured on real iOS and Android sessions (2026-10-06):
  - Live's DevTools is a same-origin iframe in the Live tab (`iframe.devtools-iframe`). It holds a pinned Chrome DevTools 91 frontend at `/devtools/realios/91.0.4472.101/` (`realdroid` on Android).
  - Its console model (`SDK.ConsoleModel.instance()`, event `MessageAdded`) is where the device's console arrives: `console.log('[cro] test')` on the iPhone is `{source:'console-api', level:'info', type:'log'}`.
- **`bs-live-tap.js` (MAIN world) and `bs-live-bridge.js` (ISOLATED).** Injected into a captured Live tab instead of the console-capture scripts.
  - **Hooking:** the tap polls for the DevTools frame, since it can be opened and closed at any time. When the frame comes up it replays what the device already logged (the last 200 lines), then subscribes.
  - **Relaying:** it sends lines in batches (200 ms, 50 at most), and posts `connected`, `closed` or `unsupported` with the frontend's version.
  - **The token:** the iframe's `wss=` parameter carries a session token, and nothing reads it. The version comes from the frame's own `location.pathname`.
  - **The bridge** accepts only messages the page posted to itself, under its own marker. console-bridge.js trusts any `__selenite` message, so the separate marker keeps the two apart.
- **Device lines in the feed** (`bsDeviceEntry` in browserstack.js; the worker now loads browserstack.js).
  - Each line is labelled with the Live tab's title, which Live sets to the device: "iPhone 14 16.3".
  - Levels follow the local mapping. Network, violation and other lines read `[network] …`, like local `Log.entryAdded` lines.
  - `[PJS]`/`[cro]` lines are tagged, so the CRO toggle keeps them. Live's own command and result echoes are dropped, and a line is cut at 4,000 characters.
  - Device lines don't feed the Tracker: that would fire probes and notices at the dashboard, not the device.
- **Commands on the device** (`bsDeviceEval`). The command input and Quick Commands run through Live's DevTools, in its selected execution context (the page under test), with the console API, awaiting promises.
  - Results read like local ones ("Object {123: Object}", `ƒ name()`). A device exception is an ERROR line.
  - `$click`/`$hover` are refused with a reason, and nothing on a device is expandable.
  - A device that doesn't answer within 15 s says so.
- **Status line.** On a Live tab it reads one of:
  - "● Live — mirroring iPhone 14 16.3 through BrowserStack Live's DevTools"
  - "○ Open DevTools in the Live session to mirror …"
  - "○ Can't read this version of Live's DevTools (…)" when the frontend changes
  - "○ Reload Selenite in chrome://extensions …" when the worker predates this

  The command input and Quick Commands are enabled only while the device is connected.

### Changed

- **Device only on a Live tab.** The dashboard page's own console (BrowserStack's app logging) is no longer mirrored, and the dashboard no longer gets the console-capture scripts.
- **The Live flag survives a worker restart.** It is kept in `_wins`, so device lines keep landing after the worker sleeps and wakes. The worker also re-injects the tap when the dashboard reloads, which `doFollow` had skipped for a tab it was already attached to.

### Fixed

- **Browser Console lost lines in a burst.** The debugger handler wrote the feed without awaiting, so two events landing together read the same array, and the second write dropped the first's line. Writes are now queued per window, and a device batch is one write. In the worker harness, 30 events in a burst landed one line before and all 30 now.
- **Browser Console froze at 1,000 lines.** The panel re-rendered only when the length changed, and the cap holds the length at 1,000, so the view stopped until Clear. It now also watches the newest entry; the worker numbers entries with `seq`.
- **sidepanel.html had no style for the `[tag]` label.** popup.html had one; both do now, plus the device label.

### Verification

- **jsc (CI):** browserstack.test.js now has 238 assertions. They run the real `bs-live-tap.js` and `bs-live-bridge.js` against a fake Live page whose frontend has the measured shapes, and cover:
  - the replay, the cap of 200, the batches, and close/reopen with a new frame
  - the unsupported report, and `eval` results and exceptions
  - the token never being read
  - the bridge's filters
  - the entry mapping, and the panel's state reading

  They fail against seven broken copies: hooking twice, reading the frame's `src`, no replay cap, no state de-duplication, no command-line API, a bridge that trusts any source, and command echoes kept. All eight CI suites pass.
- **jsc, the whole worker:** 28 checks drive the real background.js through its own listeners:
  - Live follow, injection order, and lines from the captured tab only
  - the dashboard's console hidden
  - commands routed to the device, and `$click` refused
  - re-injection after a reload, and a worker restart
  - leaving the Live tab
  - a 30-event burst

  It fails against the 0.7.7 worker and against four single changes (no write queue, `bsLive` not persisted, no dashboard suppression, no re-inject on reload).
- **Real Chrome:** system Chrome 154 with the real extension. `live.browserstack.com` was mapped to a local HTTPS server serving a fake dashboard and a fake DevTools 91 frontend, and the real panel was bound to the dashboard's window. 28 checks pass, covering:
  - status "open DevTools", then connected, closed and unsupported
  - the replayed history, device lines with labels and tags, and the dashboard's noise hidden
  - the CRO filter
  - a typed command, an object result, an exception, and the Optimizely "Variations (table)" Quick Command running in the device frame
  - `$click` refused
  - the view still moving past 1,000 lines
  - the token absent everywhere

  On 0.7.7 the same gate fails from the first device check: the feed shows the dashboard's "dashboard noise".
- **Not yet verified:** a real Live session end to end with this build.

## 2026-10-06 — 0.7.7

The A/B tab can open any variant, and Functional Testing's Target section a queue's start URL, on a real phone, tablet or another desktop browser in BrowserStack Live. Until now QA covered those device columns by pasting each preview URL into a Live session's console (the "Open URL (BrowserStack)" Quick Command). This is the first BrowserStack milestone: Live only, through BrowserStack Local. Automate comes later.

### Added

- **Devices — BrowserStack Live, in the A/B tab.** A collapsed section under the A/B card: a checklist of ten device presets in three groups, Desktop, Mobile and Tablet, and for each ticked device a row with a button per variant target. The rows come out in the same groups. A button builds the variant's URL exactly as the comparison does (`abComposeUrl`: the target's URL or the Base URL, the override, `cro_mode=qa`), wraps it in a Live link, and opens it in a new tab.
  - **The link** is Live's documented integration URL: `live.browserstack.com/dashboard#os=…&os_version=…`, then `device=…&device_browser=…` (mobile) or `browser=…&browser_version=…` (desktop), `url=…`, `start=true`, and `local=true` / `force-local=true` when they are on. Values are form-encoded, so a preview URL's own `?`, `&` and `#` stay inside `url=`. A forcing query cut off at its first `&` would open the page un-forced, which looks like the variant failing on that device.
  - **Presets** are pinned from BrowserStack's Live catalogue as of 2026-10-06, spelled exactly as it lists them, because the dashboard matches on those strings. Desktop: Safari 27 on macOS Golden Gate, and Edge 154, Chrome 154 and Firefox 157 on Windows 11. Mobile: iPhone 18 Pro, iPhone 17, Galaxy S26, Pixel 10. Tablet: iPad Pro 13, Galaxy Tab S11. `browserstack.js` has the one-liner that refreshes them.
  - **One Live session at a time.** Live runs one session per user, so before opening a new tab Selenite closes the Live tab it opened last, but only while that tab is still on the dashboard.
  - **No credentials.** The links open in the user's own logged-in Live session.
- **Cross-browser — BrowserStack Live, in Functional Testing's Target.** A collapsed block between Tab Target and Save/Execute, with one button per ticked device. A button opens the queue's start URL on that device: the Open URL step's URL, with its parameters and QA Mode.
  - **The start URL** is built by `queueStartUrl`, by the same rules the worker's `ACTIONS.open_url` uses to navigate: parameters trimmed and blanks dropped, and with QA Mode any `cro_mode=` replaced by `cro_mode=qa`, last. The worker is unchanged. The test suite slices the worker's lines out of background.js and checks that the two agree.
  - **A blank Open URL step** (locally, "use the active tab") gives Live nothing to open, so the buttons are disabled and say why.
  - **Live can't run the steps.** The tester walks them by hand on the device, and Execute still runs the queue in this browser.
  - **One selection, two places.** The device checklist and both Local toggles are shared with the A/B tab: one `bsLivePrefs` record, and a change made in either place is redrawn in both. Each place has its own status line. They also share the one Live tab per window: a launch from either place closes the Live tab Selenite opened last.
  - The two places are one component in popup.js: each section is a root marked `data-bs-live` (`ab`, `ft`), with its parts marked `data-bs-role`.
- **A BrowserStack Local check before every launch.** With **Use BrowserStack Local** on (the default), Selenite first asks the BrowserStack Local app on this Mac whether it is running: `GET http://localhost:45454/status`, the app's own console API, which needs no auth. In the console's own code `status: true` means running and signed in. If it isn't, Selenite says what to do and offers **Open anyway** instead of opening a session that could not reach the page. That response also carries a session token and a user id. Only `status` is read, and nothing else from the response is kept.
- **All traffic through this Mac** (`force-local`, on by default, needs Local). Every request from the session goes through this Mac, so an experiment whose QA audience is our IP counts the device's visits as ours.
- **`browserstack.js`.** Pure: no DOM, no network, no URL/URLSearchParams, the figma.js convention. It is loaded before popup.js in both UIs, and uses nothing panel-only, so the Automate milestone can `importScripts` it into the worker.
- **`tests/browserstack.test.js`**, added to CI. 156 assertions:
  - exact links
  - preview URLs round-tripping (query, fragment, a space, a literal `+`, non-ASCII)
  - force-local never sent without local
  - https normalization
  - every preset well-formed, and listed group by group, so the rows of buttons can't interleave the groups
  - the status reader returning only its two booleans
  - the queue's start URL, against explicit expectations and against the worker's own `open_url` lines, sliced from background.js

### Not changed

- No new permissions: `<all_urls>` already covers the console and the dashboard.
- No service-worker change. Everything runs in the panel.

### Verification

- **jsc:** the new suite passes. It fails named cases against five broken copies of browserstack.js:
  - spaces not written as `+`
  - force-local sent without local
  - the token leaking into the status result
  - `encodeURI` in place of `encodeURIComponent`
  - a desktop preset listed after the tablets

  It also fails against a popup.js without the `cro_mode=` filter, and against a background.js whose `open_url` stops trimming parameters.

  All eight CI suites pass.
- **Real Chrome:** system Chrome 154, headless, with the real unpacked extension. The real `sidepanel.html` was driven over CDP, with `live.browserstack.com` mapped to localhost so no launch reached BrowserStack. 46 checks pass, covering:
  - both places rendering with the same grouped defaults; the Functional Testing block inside Target, before Save/Execute
  - one selection: a device ticked in Functional Testing appears in A/B, one unticked in A/B disappears from Functional Testing, and the Local toggles follow both ways
  - Functional Testing's buttons disabled while the Open URL step is blank, enabled once its URL, a parameter and QA Mode are set, and disabled again when it's cleared
  - a Functional Testing launch opening exactly the start-URL link (https added, `cro_mode=qa` last), with its status in Functional Testing's line only
  - the A/B grid following the Base URL, overrides, relabels, and added or removed variants
  - an A/B launch, override included, closing the Live tab a Functional Testing launch opened
  - with Local off, an exact link carrying neither `local` nor `force-local`
  - the extension page reaching the running BrowserStack Local app (`running`, `signedIn`)
  - a closed console port blocking a Functional Testing launch, Open anyway opening the same link without claiming a tunnel, and the A/B line left alone
  - one shared preferences record
  - the token and user id absent from every storage area and from the page
  - the init chain still running, with Execute and A/B Run still holding their click listeners (read with `DOMDebugger.getEventListeners`)

  It fails named checks against a build without the `persistQueue` hook and against one that redraws only the place a change was made in. On 0.7.6 it fails at its first check.
- **Isolation:** with `browserstack.js` removed, both Live sections stay empty, and everything else still works: Execute and A/B Run keep their listeners, Settings opens, Open URL edits save, and Add Variant renders. 10 checks pass.
- **Not yet verified:** a real Live session. Whether `start=true` auto-starts the session, the lowercase `ios`/`android`, `device_browser` and `force-local=true` all need a launch from a logged-in BrowserStack account.

## 2026-10-06 — 0.7.6

The two picker bugs that predate 0.7.5 are fixed. The session that took the poller-race task found both.

### Fixed

- **Two Selenite windows picking at once.** The worker kept a single owner pointer, `_pickWin`, the window of whichever panel started a pick last. A result or an Esc from window 1's page went to window 2's namespace: it filled window 2's step and left window 1 stuck on "…". On 0.7.5 in a real Chrome, window 1's click filled window 2's step, and Esc on window 1's page cancelled window 2's pick.
  - **The owner now travels with the picker.** `startPicker` stores the starting window in the page's isolated world (`window.__selenitePickWin`) before injecting picker.js. picker.js sends it back with `pickerResult` and `pickerCancel`, and `pickOwner` writes to that window's namespace.
  - **Not the sender tab's window:** that would send a click in a tab dragged to another window mid-pick to the wrong panel. The owner stays with the page, so a moved tab's result still reaches the window that started it, and so does one sent after a worker restart.
  - **A picker injected by an older worker** sends no owner, so `pickOwner` falls back to `_pickWin` as before. The fix needs the extension reloaded: until then the old worker doesn't record an owner.
- **Closing the tab mid-pick** takes picker.js with it, without a message, which left the button on "…" until Esc in Selenite. popup.js now ends the pick on `chrome.tabs.onRemoved` for the picker's tab.

### Verification

- **jsc harness:** real picker.js and selector.js on fake pages, one per tab, the whole background.js, and one popup.js picker block and Esc handler per Selenite window. Its 29 checks cover:
  - 0.7.5's cases.
  - A closed tab, and another tab closing.
  - Two windows picking, with Esc on one page, with a tab moved between windows, and with a worker restart.
  - A picker with no owner.
  - **Results:** all 29 pass. On 0.7.5, 8 fail. With the 0.7.6 panel on a 0.7.5 worker (the extension not reloaded), the closed tab passes and the 7 two-window checks fail, as expected.
- **Real Chrome:** system Chrome 154, two browser windows, each with its own floating Selenite, and 🎯 clicked with real mouse events inside each Selenite.
  - **Two picks at once:** both windows picked, and each click filled its own window's step.
  - **Esc** on window 1's page cancelled window 1's pick only.
  - **A closed tab** gave 🎯 back by itself.
  - **A tab dragged** from window 1 to window 2 mid-pick still sent its click to window 1.
  - **Results:** all 10 checks pass. On 0.7.5, 6 fail. 0.7.5's own 21 real-Chrome checks still pass.
- **Tests:** all seven CI suites pass.

## 2026-10-06 — 0.7.5

Esc now cancels a pick from Selenite, where the keyboard actually is. 0.7.4 made Esc on the page give the 🎯 button back, but clicking 🎯 leaves keyboard focus in Selenite, so a real Esc went to Selenite and did nothing. This release also closes the other two ways 0.7.4 listed for a pick to get stuck.

### Fixed

- **Esc in Selenite cancels a pick in progress.** popup.js's Esc handler still closes Settings first. Otherwise it calls `cancelPick`, which gives the 🎯 button back and closes the picker on the page. picker.js exposes its cleanup as `__selenitePickerClose`, and the panel runs it in the picker's tab with `chrome.scripting.executeScript`. That close sends no `pickerCancel`: the pick is already over, and a late cancel could land in a newer pick.
- **A second 🎯 during a pick no longer strands the first or misfiles the next pick.** `startPicker` kept one module-level `_pickerPoller` and overwrote it on a second 🎯. Each poller then cleared whatever interval that variable held, not its own. Step 1's button stayed on "…", and its poller kept running and took later picks. On 0.7.4 in a real Chrome, one click on the page filled both steps.
  - `_pick` now holds the pick's button, poller, tab and document.
  - A newer 🎯 ends the old pick first, and each pick stops only its own poller.
  - A tick that finds `_pick` changed does nothing, so overlapping ticks apply a result once.
- **A page that reloads or navigates mid-pick** takes picker.js with it, without a message, which left the button on "…". Right after injecting, the panel records the document picker.js went into: the `documentId` an `executeScript` reports. On any status change of that tab, `loading` or `complete`, the pick ends only if the tab now shows a different document or can't be scripted.
  - **Why not the status alone.** This release first ended the pick on `status: 'loading'`. Chrome reports the same for pushState, replaceState, a hash change and any iframe navigating, so live picks were cancelled on single-page sites and on pages with ad frames. A reload's `changeInfo` is identical to an iframe navigation's, so no `changeInfo` test can tell them apart. The session that took the poller-race task measured this in a real Chrome before the release was pushed, and wrote the document check.
  - **A Back to a cached page is a different document**, even when it ran an earlier pick. A never-cleared "picker was here" marker failed this case, which is why the check compares document ids.
  - **A slow reload** can report `loading` while the old document still answers, so the check runs again on `complete`.
- **The picker's tab.** The worker's `startPicker` reply now includes the `tabId` it injected into. A worker from before this release keeps running until the extension is reloaded, and it doesn't send the tab. So the panel also notes its window's active tab, the tab that worker injects into.

### Verification

- **jsc harness:** the real picker.js and selector.js on a fake page with document ids, the whole background.js, and popup.js's picker block and Esc handler. Its 38 checks cover:
  - Esc on the page, a worker restart mid-pick, a click, and two windows (0.7.4's cases).
  - Esc in Selenite, Esc with Settings open, a second 🎯, and a reload, with and without the tab event.
  - Esc while the picker is still being injected, overlapping ticks, a closed tab, and the worker's tab winning over the panel's.
  - In-page navigations, a slow reload, and a Back to a cached page that ran an earlier pick.
  - **Results:** all 38 pass. On 0.7.4, 19 fail. On this release's first version, the status-only check, 3 fail: the in-page and slow-reload cases. With a 0.7.5 panel on a 0.7.4 worker (the extension not reloaded), only a tab switch between the two lookups fails.
- **Real Chrome:** system Chrome 154, the unpacked extension loaded through `Extensions.loadUnpacked`, Selenite in its floating window. 🎯 was clicked with real mouse events inside Selenite, which left keyboard focus in Selenite's frame.
  - **Esc** sent to Selenite's window closed the picker on the page and gave 🎯 back.
  - **With Settings open**, the first Esc closed Settings and the second cancelled the pick.
  - **A second 🎯** gave step 1 its button back, and the click went to step 2 only.
  - **A page reload** gave 🎯 back by itself.
  - **pushState, replaceState, a hash change and an iframe navigating** left the pick open.
  - **Unchanged:** Esc on the page and a click still work.
  - **Results:** all 21 checks pass. On 0.7.4, 8 of the 16 non-navigation checks fail. On the status-only version, the 4 in-page cases fail.
- **The poller-race session's own checks:**
  - **Its jsc harness:** 106 checks, with five mutations, one per guard, each failing a specific case.
  - **Its real-Chrome probe:** a delayed (1.2 s) reload and a Back to a bfcached page each end the pick. Same- and cross-origin iframe navigations keep it, and a click afterwards fills the step.
- **Tests:** all seven CI suites pass.

### Not changed

- **"…" stays disabled during a pick**, so a pick is cancelled with Esc, not a click. If a click on "…" cancelled, a double-click on 🎯 would start a pick and cancel it at once.

## 2026-10-06 — 0.7.4

Esc in the element picker never reached the panel. picker.js sends `pickerCancel` on Esc, but the worker handled only `pickerResult`, so the panel's poller never saw the cancel. The 🎯 button stayed disabled, showing "…", and the poller kept running until Selenite was reopened.

### Fixed

- **A `pickerCancel` branch beside `pickerResult`** writes `{ cancelled: true }` as the picker result into the owner window's namespace, with the same `restoreWins` recovery after a worker restart. popup.js already had the `cancelled` branch that re-enables the button, but nothing wrote it.

### Verification

- **The fixing session's harness**, with the whole worker in jsc, covered Esc, a worker restart mid-pick, the normal click path and two windows. 22 checks passed with the fix; on 0.7.2, 9 failed.
- **Real Chrome on 0.7.3's code:** system Chrome 154, with the extension loaded through `Extensions.loadUnpacked`.
  - **Esc:** the real `startPicker`, run in the floating window, injected the picker into the browser window's page. A CDP Escape on the page closed it and gave the 🎯 button back, with nothing filled in.
  - **Click:** a click on the page still picked `h1`.
  - **Without the fix**, the same run left the button showing "…".
- **Tests:** all seven CI suites pass.
- **Still open:**
  - **Keyboard focus.** Esc reaches the picker only when the page has keyboard focus. After 🎯 is clicked in Selenite, focus stays in Selenite, so a real Esc probably doesn't reach the page. The CDP Escape above was sent to the page directly, so it couldn't show this.
  - **A second 🎯 mid-pick** leaves a poller running, which takes the next pick for the wrong step (reproduced by the fixing session).
  - **Navigating mid-pick** destroys the picker without a message, so the button sticks. This was read from the code, not tested.

## 2026-10-06 — 0.7.3

Accessibility is now part of the A/B run. Auditing an experiment's variants used to mean configuring them twice: once in the A/B tab, and again in Test Agent's Cross-Variant Accessibility mode, which had its own target list, saved sets and "Fill from ticket", and loaded every page a second time. 838cb35 removed A/B from Test Agent for the same reason, one feature with two run buttons.

Selenite can also stop narrowing the page it tests. The docked side panel takes its width out of the tab's viewport, so pages reflow while it is open and are captured narrower than their window: STRZ-1658's report reads "Captured at 1084 px". Unpinned, Selenite now floats over the page instead.

### Added

**A floating window for an unpinned Selenite.** `openFloating` opens `floating.html` as a popup window of its own over the right edge of the browser window (`floatDefaultBounds`). It holds the real UI, `sidepanel.html` with `popup.js`, in a frame bound to that browser window by `?win=`. Nothing is added to the page, so the page keeps its full width and captures are taken at the window's width.
- **📌 switches between Chrome's side panel and the floating window. Pinned, in the side panel, is the default**, so the icon opens Selenite docked, as before.
  - **Unpinning** (`unpinToFloating`) stores `selenitePinned: false`, opens the floating window and closes the panel with `chrome.sidePanel.close`. `applyPanelBehavior` then turns `openPanelOnActionClick` off, so the icon opens the floating window.
  - **Pinning** (`pinToSidePanel`) calls `chrome.sidePanel.open` first thing in the click, because it needs the user's gesture, and stores `true`.
  - **Pinned means the side panel**, not an always-on-top floating window, because Will wants a pinned Selenite to behave as a browser sidebar.
- **One Selenite per browser window.** A side panel that loads closes its window's floating window (`closeFloating`), however the panel was opened, and opening the floating window closes the side panel.
- **Pinning reloads the UI**, since the UI moves to another document. So 📌 refuses while a run is in progress: the A/B, Perf, Funnel, Matrix and Test Agent loops live in that document.
- **Capture stays attached through a pin.** The newcomer says hello before the other closes, and the worker now ignores a disconnect from a port that is no longer the window's registered panel. Before, any disconnect released the window's capture.
- **Remembered placement.** Where the window is moved and how big it is made is saved (`floatBounds`) for the next one. Closing the browser window closes its floating window. Alt+Shift+S does what the icon does, which brings the window back after Chrome covers it.
- **The panel reopens on its last tab** and Console subtab, since a pin, unpin or reopen reloads it.
- **Why not an overlay drawn inside the page:** the run loops above live in the panel document, and the worker opens each run page as a new active tab. A frame inside the page would be torn down by those tab switches and by every navigation, and it would be in every CDP screenshot.

**An "Accessibility audit" option on the A/B tab, on by default.** `captureVariant` runs `performWcagAudit`, the standalone WCAG mode's own routine, on each variant tab in the page load it already makes. The audit runs all 19 checks plus axe-core on the whole page. The 14 automated checks are compared across the variants; the five manual ones are reported once.
- **It runs before the full-page capture.** `stabilizeForCapture` pauses video by clearing `autoplay` and injects a freeze stylesheet, after which the `motion` check would pass every page.
- **It does not change the capture.** The audit only reads the page: the heuristics run in an isolated-world exec, and so does axe-core.
- **A failed audit is best-effort**, like the capture: it is recorded as that variant's audit error and never becomes the capture's `loadError`.

**An "Accessibility (WCAG)" section in the A/B report**, after Visual Diff and before Run Diagnostics. It is never folded into the A/B badge, which is the Visual Diff verdict.
- **What it shows:** the depth of a standalone WCAG report, for every page. The first field run (`r_1791222173138`) printed three counts per variant, "10 introduced" with none of the ten named, where the WCAG report on the same page (`r_1790972743184`) listed every check, every issue, the manual checks and an Agentic Testing note. The section now has five parts:
  - **By check:** every automated check with its success criteria, each page's status, and a variant's "+N worse" / "−N better" against Control.
  - **Each variant compared with Control:** every introduced and resolved issue written out, or a line saying nothing changed. A variant whose changes are identical to an earlier variant's reads "Same changes as v2" (or "Same issues as" without a baseline) instead of repeating the table, because STRZ-1658's v2 and v3 share the new UI and `r_1791225305511` printed the same ten issues twice, a page each. The review prompt says the same, so the model sees each finding once.
  - **Control's full audit:** laid out as the WCAG report lays out a page.
  - **Manual review:** once, with a page whose guidance differs named under it.
  - **Agentic Accessibility Review (Sonnet):** with Agentic Testing on, one vision call over every page's viewport screenshot, already taken for Agentic Testing in the same load. The prompt (`abA11yReviewPrompt`, pure) gives the screenshot order, Control, Control's own issues by check, and each variant's actual new issues. A failed call is a warning in `problems`, and the note is in the debug log's `crossVariant.agenticNote`.
    - **Scoped to barriers.** The prompt says who the barriers are for (screen reader, keyboard, zoom, low vision, colour blindness, cognitive). It rules out judging the experiment's design, copy, pricing or emphasis, and visual polish that doesn't affect use. The first real review (`r_1791225305511`) spent its v1 paragraph arguing the badge sat on the wrong plan, which is the experiment's intended change, and two more on a tag's corner overlapping its card.
    - **Readable.** `rptAgenticNoteHtml`, shared by every Agentic note in the report, now prints a note's paragraphs as paragraphs and its `**bold**` as bold. It escapes first, so nothing in a note can become markup. That review had printed as one block with the asterisks showing.
- **A count that moved is one changed issue.** Five heuristic lines lead with a count ("2 <img> missing an alt attribute …"). Matched as exact strings, STRZ-1658 v2's "43 <img> …" against Control's "2 <img> …" read as one fixed and one new, and the report printed "−1 fixed" for a page with 41 more images missing alt text. `diffCvaRuns` now pairs a resolved and an introduced line that differ only in a leading count into `changed` (`{ from, to, worse }`). A rise counts as introduced and a fall as resolved, and the report shows "43 <img> … (v0 had 2)". Only a leading count pairs, so two different elements whose selectors contain different digits are still two issues.
- **How it is built:** `abA11yEntry` shapes the run's captures as the old mode's report entry (mode 5). So the renderer (`rptCvaSection`), `problems`, the debug log's `crossVariant` section, and the cover URLs (deduplicated against the captures' own) all carry over.
- **Variants that weren't served their variation.** When Visual Diff's `notServed` says a pair was not served its variations, the variant's audit is Control's page audited twice, and "0 introduced" would be a PASS nobody earned. Such a variant is shown as not compared, left out of the total, and warned about in `problems`.
- **The badge order follows the A/B ladder.** A regression on a served variant still reads ISSUES FOUND; otherwise any not-compared, unloaded or unaudited variant makes it NOT COMPARED, never PASS. The last case, a variant with no audit reading as PASS, was already a hole in the Cross-Variant report.
- **An unanswered request is reported, not mistaken for a clean page.** The worker sets `a11y` only when asked, and it also returns how many checks it received (`a11yRequested`), every time. If no capture that loaded carries an audit, the section is FAILED, and the acknowledgement names the cause:
  - **No acknowledgement:** the worker predates the request, so reload the extension.
  - **An acknowledgement:** the worker had the request and still audited nothing, which a reload will not fix.

### Removed

**Cross-Variant Accessibility as a Test Agent mode**, which also leaves the Also Run list.
- **Gone:** its markup in both `popup.html` and `sidepanel.html`, its state, saved sets, live panel, highlight, export, and fill-target entry, and the worker's `runCrossVariantAudit` and its handler.
- **Kept:** `diffCvaRuns`, `cvaRunNotes` and `rptCvaSection`, which A/B now uses.
- **Old storage:** `cvaModeState`, `cvaVariantSets` and `cvaProgress` are left in storage, unread.
- **The WCAG / Accessibility mode is unchanged**, for auditing a single page.

### Changed

- **The toolbar icon follows the pin.** `openPanelOnActionClick` is on unless `selenitePinned` is `false`, so the icon opens the side panel, as before, until Selenite is unpinned.
- **Captures are taken at the full window width** while Selenite is unpinned, so they are wider than runs captured beside the panel.
- **The worker no longer uses the last-focused window.** In a service worker `currentWindow` means the last-focused window, which is now often Selenite's own. The picker, WCAG audit, issue highlight, candidate overlay and session overlay and recording now use the panel's window (`activeTabFor`), and every one of those messages carries it. Run tabs open in the run's window (`runTabWindow`), and reports open in the panel's (`reportTabWindow`).
- **`autofillAbSummary` runs one pass at a time.** Init and a restored A/B tab can both start one on the same load, and the Figma half makes paid calls.
- `problems` entries for the accessibility section are filed under `accessibility/<label>` (were `cross-variant/<label>`).
- The debug log's `crossVariant` section now comes from an A/B run, and each run in it carries `notServed`. The readme says so.

### Verification

- **The real worker on real pages.** Chrome 154 loaded the unpacked extension (via CDP `Extensions.loadUnpacked`, because branded Chrome ignores `--load-extension`). `runVariantComparison` ran on W3C's accessibility demo pair, with the fixed "after" page as Control and the inaccessible "before" page as v1.
  - Both captures came back with the audit (14 checks, axe-core ran) and with their full-page capture.
  - v1 showed what the demo was built to show: screen reader 28 issues vs 1, ARIA 8 vs 0, link purpose 9 vs 0, contrast 2 vs 0.
- **The audit leaves the capture alone.** Four runs alternated the audit off, on, off, on. Every variant's DOM candidates were byte-identical in all four, and v1's screenshot was identical in all four. Control's screenshot also differed between two audit-off runs, so that variation is the page's own noise. The audit added about 0.1 s per variant on these pages.
- **The UI**, in the Browser pane with a chrome stub over the real `popup.html` and `sidepanel.html`:
  - The option shows in both files, ticked by default, and survives a reload when unticked.
  - The payload carries the 14 automated checks when it is on and `null` when it is off.
  - The Test Mode list is WCAG, Performance and Funnel Crawl, and Also Run offers only Performance beside WCAG.
  - The init chain completed with no errors.
- **The report**, from `openReportTab` with an A/B entry and an accessibility entry, in the real `qa-report.html`: the section sits between A/B and Run Diagnostics, a not-served v2 is excluded and named in diagnostics, and the cover lists the page once.
- **Tests:** all six CI suites pass (2,884 assertions, 92 new). Mutation-checked in a scratch copy: each of these fails its own assertions:
  - dropping the not-compared badge rung, or `notServed`
  - moving the audit after the capture
  - guessing the failure cause, or dropping the acknowledgement from the reply
  - removing any of the section's five parts, or the matrix marks
  - dropping the introduced issues from the review prompt
  - turning off count pairing
  - reverting the note renderer, or the prompt's scope
  - turning off the "Same changes as" line
- **The detailed section on real data:** rendered from `r_1791222173138`'s own audits and printed with the report stylesheet. The By-check table carries all 14 checks for v0–v3, and v2 and v3 read "+10 worse" on Screen Reader Announcements with no false "fixed". Each variant's table lists the nine missing-alt axe nodes and "43 <img> … (v0 had 2)", and Control's full audit lists its 9 issues.
- **The second full real path**, side panel to report, on the W3C pair: 19 checks sent and 19 acknowledged, all five parts rendered, and the review call made with both screenshots. It answered "No API key configured" in the scratch profile, which `problems` carried as a warning.
- **First field run, `r_1791221055240` (STRZ-1658, four variants), unresolved.** The Visual Diff half ran normally, and the platform confirmed all four variations. The accessibility section came back FAILED because no capture carried an audit, and the reason it printed, "the service worker is older than this popup", is contradicted by its own log:
  - `extensionVersion` reads 0.7.3, and that comes from the loaded manifest, which Chrome refreshes only on a reload (tested: an edit on disk changes neither the manifest nor the worker, even across a worker restart). The manifest was bumped at 12:17:41 and `background.js` last changed at 12:06:07, so the extension was reloaded after the worker change.
  - The same build, loaded into a clean Chrome and driven through the real side panel, Run button, worker and report, audited both pages and produced the section.

  The cause is not established. This build replaces the guess with the worker's acknowledgement, so the next such log says which it was.
- **Second field run, `r_1791222173138` (STRZ-1658, after a reload): the audit ran.** All four variants were audited with axe-core. v1 matched Control exactly (9 pre-existing); v2 and v3 each added 9 axe "Images must have alternative text" nodes (title-card images, six of them in the Trending Now rail, and the Watch Anywhere logo row) and raised the heuristic missing-alt count from 2 to 43. It ran on the counts-only renderer, so the detailed section and the Agentic review have not yet been seen on a real experiment run.
- **Third field run, `r_1791225305511` (STRZ-1658, full build): the detailed section is field-verified.** All five parts rendered: 19 checks per page, the five manual items once, and a real Sonnet review. v2 and v3 read "+10 worse" with 0 resolved, and their tables carry "43 <img> … (v0 had 2)", so the false "fixed" is gone in the field. Every page's automated results were byte-identical to `r_1791222173138` an hour earlier. The review's formatting and scope (above) were fixed from this run's PDF, so a narrowed review has not yet been seen.
- **Not yet field-exercised:** the not-served path on a real contradicted probe, and the narrowed review prompt.
- **The floating window and the pin in a real Chrome:** system Chrome 154 with the extension loaded through `Extensions.loadUnpacked`, and 📌 pressed with trusted CDP clicks. All 16 checks passed, and an earlier run covered the window's placement.
  - **Opening:** the page kept its full width (inner and outer width both 1400). The window opened at 988,136, 440×780, over the browser window's right edge, and two quick clicks opened one window.
  - **Default:** on a fresh profile the icon opens the side panel.
  - **Pinning:** 📌 opened Selenite in Chrome's side panel, closed the floating window, and made the icon open the panel. The page narrowed to 1029 of 1400. Console capture stayed attached, and the panel opened on the tab the floating window had shown.
  - **Unpinning:** 📌 in the panel brought the floating window back, closed the panel, and gave the page its full width again, with capture still attached.
  - **With the floating window focused:** a WCAG audit audited the browser window's page, and a queue run opened its tab in the browser window.
  - **Closing** the browser window closed the floating one.
- **Tests for the floating window:** `floating.test.js` checks the placement (10 assertions), and the qa-report suite checks that the WCAG request carries the window id. All seven CI suites pass (2,895 assertions).
- **Not field-verified:** this 📌 hasn't been used in Will's Chrome yet. The first version, which pinned Selenite on top in a Picture-in-Picture window, didn't work for him, and he wanted a pinned Selenite to act as a sidebar anyway.

## 2026-10-05 — 0.7.2

Found from `r_1790970413550`, a WCAG-only Test Agent run on 0.7.1. Its debug log contained nothing about WCAG: `problems: []`, `captures: []`, `pageUrls: []`, and the A/B tab's settings. `buildDebugLog` only ever read A/B and Funnel Crawl, and A/B has not been a Test Agent mode since 2026-09-21, so every WCAG, Cross-Variant or Performance log has been this empty, and none of them could show whether the run was sound. Running the real Test Agent code against a failing audit turned up two worse defects underneath.

### Fixed

**A Test Agent mode that failed could put an earlier run in the report as if it had just happened.** When a WCAG, Cross-Variant or Performance run fails, the mode shows the error in its own panel and leaves its last result in memory. `runTestAgent` then recorded the mode as `ran` with that leftover result, so an hour-old audit, of whatever page it covered, went into the report and the AI summary as this run's result. With nothing in memory the report crashed instead, after the status line had already said "Done — report opened in a new tab." A mode now counts as run only if it produced a result after it started. Otherwise the report shows it as FAILED with the error, `problems` carries it as an error, and the status line names it. A mode stopped before it produced a result is recorded as skipped. The status line is set only after the report tab opens, and says so if the report could not be built.

**The WCAG report said "Scoped to" when the scope had matched nothing.** If the scope selector matches nothing, or is invalid, the audit covers the whole page. The live panel said so; the report printed "Scoped to: <selector>" from the setting alone. It now uses the panel's wording. The Cross-Variant report printed none of the panel's per-variant notes, so a variant audited without axe-core, or across its whole page, was diffed against a baseline audited the other way with nothing in the report saying so. Both now print the notes from one shared function, `cvaRunNotes`.

**The cover read "No page URLs recorded." on every WCAG, Cross-Variant and Performance report**, directly above a section naming the page. `abPageUrls` only read A/B captures and Funnel segments. It now also takes the page WCAG audited, each Cross-Variant variant's `finalUrl` (never its `url`, which is the forced preview link), and each measured Performance page.

**Every cover URL is now a page, not a link.** The cover printed each URL with its query string, on the assumption that `finalUrl` is clean once the platform's redirect strips the forcing parameters. Measured over all 71 A/B runs on disk, that held on one of six sites, ondeck (40 runs). On the other five (zapier, wowway, starz, toryburch and unicefusa: 31 runs, 103 cover lines) every line kept `optimizely_x` and `optimizely_force_tracking=true`, one per variant, and each is a link that registers a real tracked exposure for anyone who pastes it. The first real WCAG cover (`r_1790972328425`) did the same with the tab's URL. The cover now drops the query and fragment from every URL, whichever mode it came from, so each of those runs lists its page once (STRZ-1658: four links become `https://www.starz.com/us/en/buy`). No run lost a distinct page: in all 71 the new line count equals the number of distinct paths. The Page Basics table, each section's body, and the captures and per-mode sections of the debug log still carry the exact URLs.

**Agentic Testing's screenshot failed on the tab the console mirror was following.** The live console mirror attaches the debugger to the focused tab whenever a panel is open and console capture is on, which is the default. Chrome allows one client per extension per tab, and `captureViewportScreenshot` attached a second one, so WCAG's Agentic Testing, which runs on that same tab, failed with "Another debugger is already attached to the tab", under a message asking whether DevTools was open (`r_1790972328425`). Chrome raises that error when this extension already holds the tab. The screenshot now goes through `withVariantDebugger`, which full-page capture already used: it reuses the mirror's session when one is attached and never detaches a session it did not open. A/B's viewport screenshot (Agentic Testing with Visual Diff off) used the same helper and swallowed the same error silently.

### Added

**The debug log has a section for each Test Agent mode**: `wcag`, `crossVariant` and `performance`, following `funnel`'s convention (null when the mode was not in the run; only `status` and `reason` when it did not produce a result). Each carries the raw per-check or per-run numbers rather than the rendered verdicts: the page, the scope and any scope error, any axe-core error, per-check issue counts and the issues themselves, a selected check that returned nothing (kept as `missing`), Cross-Variant introduced/resolved/pre-existing counts per check, every Performance attempt including failed ones, and when the result was produced (`completedAt`), so its age against `generatedAt` is visible.

**`problems` covers them**, so "nothing degraded this run" means it. WCAG: a scope that fell back to the full page, axe-core not running, a selected check with no result (usually a popup newer than its service worker), and a failed Agentic Testing call. Cross-Variant: a baseline or variant that failed to load, and, as errors, axe-core or the scope working on some variants and not others, since introduced and resolved then compare two different audits. Performance: a page with no successful run (error), some failed runs, a page stopped part-way, and a failed vision call.

### Changed

- `run.settings` in the debug log is null on a run without A/B. It is the A/B tab's live state, so on the WCAG run above it read `visualDiff: true` and `agenticTesting: true` about a tab that never ran.
- A log without A/B now gives Visual Diff's absence as "Not part of this run: Visual Diff is a step of A/B Variant Comparison, which runs from the A/B tab", instead of "A/B Variant Comparison did not run", which read like a failure.
- The AI summary calls a failed mode failed (`background.js`); until the extension is reloaded the old worker calls it skipped.
- `vd-diff.test.js` sliced `buildDebugLog` up to a marker that 0.7.0 removed. `indexOf` returned -1, so the slice silently ran to the end of `popup.js`. It now stops at the real marker; nothing depended on the overrun.

### Verification

- The real `runTestAgent`, `TA_MODES` and `runWcagAudit`, run in `jsc` against a stub worker that fails the audit. Before the fix: with an hour-old run in memory, the mode was recorded `ran` with that run and the report body carried its URL and issues; with nothing in memory, report generation threw `TypeError: null is not an object (evaluating 'run.checks')` while the status line read "Done — report opened in a new tab."; and a scope that matched nothing rendered "Scoped to: .hero". All three are now assertions in `qa-report.test.js`.
- All six CI suites pass (2,792 assertions, 63 new). Each of the thirteen guards was mutation-checked in a scratch copy, and reverting any one fails its own assertions. Moving the status line back before the report await survived, because with the new `catch` it changes nothing, so the `catch` is the guard that is pinned. Reverting the screenshot helper reproduces the field error exactly: one `attach`, rejected with "Another debugger is already attached".
- **The debug log is field-verified** on `r_1790972328425`, a WCAG run of STRZ-1658 v2 on the reloaded build. `wcag` carries the page, all 19 checks with their issues, and `completedAt` 7.4 s before `generatedAt`, so the result was this run's. `run.settings` is null, Visual Diff's reason names the A/B tab, and `problems` holds exactly one entry, the Agentic Testing failure above, which the old log format had no way to show. The run before it (`r_1790972207743`) came from a page still running the old `popup.js`, most likely a side panel opened before the edit: the same four fields were in their old form, though the file on disk was ten minutes newer.
- **The screenshot fix and the WCAG cover are field-verified** on `r_1790972743184`, the same page on the build with both. `problems` is empty, Agentic Testing returned a real note, and the cover reads `https://www.starz.com/us/en/buy` while `wcag.url` keeps the full link. The log cannot show whether the screenshot reused the mirror's session, but the only change since the run that failed is the build. All 19 checks came back byte-identical to `r_1790972328425`, seven minutes earlier.
- The cover rule was driven, as the real `abPageUrls`, over the captures of every A/B log on disk (71 runs, 6 sites; figures above). On `r_1791216757295` and `r_1790966163146` (STRZ-1658) it gives one line where the reports had four.
- **The A/B cover is field-verified** on `r_1791218328696`, the first A/B run on this build: one line, `https://www.starz.com/us/en/buy`, where `r_1791216757295` that morning had four forcing links. Everything else in the two runs is identical, at an equal 2692 px, apart from the live countdown timer's one finding per variant.
- Not field-exercised: the failed-mode path (every run since the fix succeeded), and the cover rule on a Cross-Variant or Funnel report, which rests on the replay over 71 real logs above.

## 2026-10-02 — 0.7.1

Three fixes found on STRZ-1658: a correction to 0.7.0's sticky change, which was right about the header and wrong about the hero; requirement scoping for a spec section shared by two variants; and a report line that described a removed string as unchanged.

### Fixed

**Bottom-anchored sticky elements were still dropped, on a premise that was never measured.** 0.7.0 walked sticky elements anchored by top or left and kept excluding those anchored by bottom or right, reasoning that `captureBeyondViewport` lays the page out again in an enlarged viewport, where a bottom-pinned element drops back into flow. It does not. Measured on Chrome 154 (headless, windowed, and under the geometry pin's `setDeviceMetricsOverride`) by checking each rect against the pixels of a real capture: the capture paints the current layout, so top-, bottom- and right-anchored sticky elements, and a bottom-anchored fixed bar, are all painted exactly at their scroll-0 rect, and `50vh` stays half the real viewport. 0.7.0's evidence was a fixture resized to full height in the Browser pane, which is a different operation.

That premise is what kept STRZ-1658 broken. On the 0.7.0 rerun (`r_1790959147029`) the header came back: `fixedOrSticky` went from 2 to 1 in Control and v1 and from 3 to 2 in v2/v3, and v2/v3 now find the spec'd GET STARTED. The hero did not, because the variation's CSS (read from the public Optimizely snippet) is `position:sticky; bottom:32px`, and the 0.7.0 fixture had modeled it as top-anchored. So the same failure repeated: nothing was walked in the variant between the header and y=2174, Control's plan picker came back "removed" and graded unexpected (six times in v2, four in v3), v3's only spec'd copy ("Best Value") counted absent, and 10 of v2's 13 absent spec strings (the headline, the three hero bullets, both plan labels, Save 58%, Select Plan, Most Popular, the Offer Terms line) are inside that one div.

The walk now keeps every sticky element at the scroll origin, whichever edge anchors it. `position:fixed` stays excluded, as a policy rather than for geometry: the capture paints a fixed element where its rect says, but it is an overlay (a chat widget, a cookie banner, a slide-out menu) whose presence depends on consent and load timing, not on the experiment. A pinned element's position does follow the viewport height, so two captures of different heights would disagree about it. The geometry pin holds every capture to the first one's height (of 65 runs in the corpus, the only 2 with unequal heights predate the pin), and `validateVisualDiffGeometry` reports a capture where it fails. The "N fixed or sticky element(s) were excluded" note no longer names bottom-anchored sticky bars, and `vd-diff.test.js` pins that.

**A spec section shared by two variants was checked against the first one only.** STRZ-1658's ticket heads its shared block "V2 and V3:"; the Jira parse takes the leading V2 as the id, so the summary carries `v2: and V3:`, and requirement scoping, which reads one label per header, gave the whole block to v2. v3 was checked against a single string ("Best Value", from its own short section) while 27 were reported as stated for other variants, so the shared plan cards, legal line, content library, devices section and final CTA went unchecked on v3. v2, meanwhile, was held to v3's badge: the shared block's badge line reads `v2: "Most Popular" … v3: "Best Value" …`, and v2 reported "Best Value" absent on every run. Two narrow rules fix it. A header whose tail is nothing but further labels and connectors (`and V3:`, `& v3`, `, v3`) belongs to every label it names; a header with prose after it (`v2: Same as v1, plus a new CTA`) still names only its first. A quoted string belongs to the nearest inline `vN:` before it on its line, but only when that line names two or more different variants inline; a lone `Same as v1: "…"` changes nothing. Unscoped extraction (the whole-spec total) is unaffected.

**The report called a correctly removed string "unchanged".** When a required string is missing from the variant but present on Control, the copy line said "Still present in Control, so the old copy did not change." That describes neither case the flag can mean. On STRZ-1658 v1 the spec says `"BEST DEAL" badge moves off the Annual card`, the extractor requires BEST DEAL, and v1 correctly drops it, so the report told the reader the opposite of what happened. The line now says Control has it, so it may be the old copy the spec says to replace, in which case its absence is correct. It still counts as unmet copy: whether quoted replacement copy should count at all is a separate decision, not made here.

### Verification

- **The real `domCandidateWalkFn`, 0.7.0's and this one, run in Chrome 154 over CDP** against a fixture with STRZ-1658's hero geometry from the snippet (pagelet `aspect-ratio:16/9`, `margin-top:-60px`, `justify-content:flex-end`, `padding:48px 64px`; overlay `sticky; bottom:32px`; a sticky header; a fixed sidebar) at the run's 2763×1225 viewport, after a real `captureBeyondViewport` capture. 0.7.0 walked 7 of 24 leaves and dropped all 14 in the hero. This build walks 22, excluding only the two fixed elements, and every rect matches the painted pixels, identically headless and windowed, pinned and unpinned. One rect, the Offer Terms line, is painted under the fixture's own pinned sticky footer bar; with the bar removed it matches as well.
- **The sticky walk is field-verified** on two STRZ-1658 reruns (`r_1790961049985`, `r_1790961823925`). v2/v3 exclude only the fixed sidebar, variant elements went from 48 to 68, and v2's unexpected findings from 7 to 0; v3's from 4 to 1, and that one is real (its Annual badge reads "Best Deal" where the spec says "Best Value", a string the variation code never sets). The hero's rects sit exactly where the pinned geometry predicts (the headline at y=715 = 1225 − 32 − 478). The two reruns are deterministically identical apart from the live countdown. ENOC-97's `/soc/b` header is Bootstrap `sticky-top`, which is top-anchored, so its rerun will already differ from the five-run baseline under 0.7.0; the page uses no bottom- or right-anchored sticky, so this change should not move it further. That rerun is still pending.
- **The scoping rules were measured over every spec on record** (97 spec × label combinations across the debug-log corpus), old extractor against new. Exactly four change, all STRZ-1658 (both versions of its spec): v2 goes from 27 to 26 requirements, losing only "Best Value", and v3 from 1 to 20, gaining the shared block without v2's "Most Popular". Every other list is byte-identical, including order, pass and line, and ENOC-97 stays at 70 in every log. Field-verified on the next STRZ-1658 rerun (`r_1790963410722`): v2 checked 26 strings with no "Best Value", and v3 checked 20 (16 verbatim; "Save 58% for the first 3 months" near; "Best Value", "Gritty Crime Dramas" and the FPQ placeholder absent), with every finding apart from the live countdown identical to the run before it.
- All six CI suites pass (2,729 assertions). The sticky note's new assertion fails against 0.7.0's wording, three of the twelve scoping assertions fail against the old extractor, and each piece is pinned separately: disabling either rule fails its own two assertions, and loosening either narrowing guard fails its own one. Two of the three new report-line assertions fail against the old sentence.

## 2026-10-02 — 0.7.0

One big update, released as one version: the Browser Console gets Quick Commands and a layout that holds still, the QA report stops being lost to a storage quota, and the Visual Diff stops discarding sticky blocks. The three share a release, not a cause.

### Added

**Quick Commands in the Browser Console.** One-click buttons for the commands the team otherwise pastes from a text expander (the "QA - Console Commands and Parameters" reference): 28 of them in four tabs — Optimizely (Web and Edge), Convert, AB Tasty, and General (Dynamic Yield, Google Optimize, VWO, and the CRO/PJS QA helpers). They run through the same `bcEval` path as the command input, so a command lands in ArrowUp history, and a saved `$click(...)` or `$hover(...)` works from a button exactly as it does typed. Two rows of the reference are left out on purpose. `;abtdebug` holds the identical command as `;abtresults`, which the reference itself flags as likely needing its real debug command. `;monfilter` is the `[PJS]|[cro]|[MT_PJS]` console regex, a filter rather than a command: the CRO toggle is that filter for two of its three tags. It matches `[PJS]` and `[cro]` (`MT_TAGS`, which also drives metric capture) but not `[MT_PJS]`, so a line carrying only that tag is still not covered.

**Commands that need a value fill the input instead of running.** Optimizely's Audiences, Google Optimize's Get bucket, Open URL (BrowserStack) and Query selector each need an experiment ID, a selector or a URL, so clicking one writes the snippet into the command input with the caret on the placeholder (or between empty quotes) rather than executing something meaningless. They carry a ✎ and a dashed border so the difference is visible before the click.

**The reference's URL-parameter rows became one-click buttons, and only in the opt-out direction.** The reference lists `?convert_optout=1`, `optimizely_opt_out=true`, `?vwo_opt_out=1`, `#abtastyoptout=1`, `cro_mode=log` and `cro-debug=true` as things to type into the address bar. Each is now a button that rewrites the URL (AB Tasty sets a hash, so reload to apply). None of the built-ins force a variation or set tracking parameters: that registers a real exposure in a client's live account, which is a different class of action from opting out.

**+ Add saves your own commands.** A label and an expression, stored in `chrome.storage.local`, shown under every tab, removed with a two-click ×, and kept in step between the popup and the side panel. The save form takes the place of the tabs and buttons while it is open. It first stacked under a grid that already filled the card, so Save and Cancel landed outside the card and the whole tab started scrolling.

### Changed

**The CRO filter keeps what you ran.** With CRO on, a button press looked like it did nothing: `bcEval` writes the command echo and its result with `source` `eval-input` and `eval-result` and no `tagged` flag, so the filter hid them with everything else. It now passes `tagged` lines and entries from those two sources. `source` is the discriminator rather than `level` (a result can be BROWSER or ERROR) or the text (a page line can read like a command). What this does not cover: console output a command merely *triggers* in the page, such as a `console.table` or the Metrics listener's later `console.log`, is page-originated and untagged and stays hidden under CRO. Covering it would take a change in `background.js`, for instance marking output produced while an eval is in flight.

**A click now answers on the button.** `bcEval` returns `{ok:false}` before logging anything when the console is not attached, and the caller ignored the reply, so a failed click was indistinguishable from a successful one. Buttons now flash `✓ Ran` or `✕ <reason>`, which also covers a result landing in a feed squeezed to a few pixels.

**The Console tab holds still.** The command input moved from below Quick Commands to directly under the feed. The feed is 60% of the Browser Console panel and scrolls inside itself, Quick Commands is `flex:1` (the complement of the feed) and the same size on every tab, and nothing else in the tab scrolls. Three approaches did not work and are worth recording. A fixed pixel height per box can only be right for one popup height, and left the feed at 2px once Quick Commands got a real size. Two independent explicit sizes asked for more room than the panel has, which is what made the whole tab scroll. And CSS `height:60%` does not resolve here at all: `html,body` is sized with `min-height`/`max-height` rather than a single `height`, which leaves it `auto` for percentage purposes and makes every descendant percentage compute to 0 however many `flex:1` levels sit in between (reproduced in an isolated two-level flex test, not assumed). `sizeBcFeed()` measures the subpanel and sets pixels instead, on init, on resize, on a subtab switch and on an 800ms poll.

**The popup's height cap is 720px, up from 600px.** Unverified against a real popup: Chrome may cap extension popups lower, which a plain browser tab cannot show, and the bottom of the tab would be clipped rather than scrolled.

**`sidepanel.html` gains two rules `popup.html` already had:** `min-height:0` on `#panel-console` and `#console-wrap`. Harmless while every box had a fixed pixel height; it broke the moment Quick Commands became `flex:1`, because `min-height:auto` lets an item refuse to shrink below its content.

### Fixed

**A finished run could lose its report.** The report body inlines every Visual Diff crop as a base64 PNG of up to 1024×800, and `chrome.storage.session` is capped at 10 MB for the whole extension. STRZ-1658 (Control and three variants, two full redesigns at 41 findings each) completed its entire pipeline and then lost the report to `Session storage quota bytes exceeded` on the one set that stored it. `openImageInTab`'s 6 MB budget shares that same 10 MB. `openReportTab` now writes to a new `reports` object store (IndexedDB schema v3; existing installs upgrade from v2 in place and `sessions` and `figma` are untouched) and prunes to the newest five exactly as before. `qa-report.js` reads it back, opening the database with no version because `popup.js` owns the schema and has upgraded it before that tab exists, and closing straight after so an open report can never block a later upgrade. A report tab left open from before the upgrade says "Report data not found"; nothing is migrated.

**The Visual Diff dropped every sticky element, not only fixed ones.** (The reasoning below about bottom- and right-anchored sticky is wrong, and 0.7.1 corrects it: the capture does not enlarge the viewport.) A sticky element is in normal flow. At the scroll origin one anchored by top or left sits where it would sit anyway, and `captureBeyondViewport` only makes the viewport bigger, which can loosen a top/left constraint but never tighten it, so the rect the walk reads is where the screenshot paints it. Anchored by bottom or right it is the other way round (the normal viewport can pin it to its far edge while the enlarged capture viewport leaves it in flow), so those stay excluded along with `position:fixed`. On STRZ-1658 the New UI hero (headline, both plan cards, the badge, both Select Plan buttons) is one sticky div and the site header carrying the spec'd GET STARTED button is another. Dropped, the diff saw nothing in the variant's top 2157px: Control's plan picker came back "removed" (graded unexpected six times), 9 of v2's 14 "absent" spec strings were on the page, and v2 and v3, which differ only inside that div, produced byte-identical crops. The rule is only sound at the scroll origin, which is where `stabilizeForCapture` leaves the page, so that is read once (`atScrollOrigin`) and a walk that starts anywhere else keeps excluding sticky as before. The three user-facing notes no longer name a sticky header as the example of what is excluded, and say what the exclusion costs: whatever it replaced on the other page can show up as removed.

### Verification

- **Report storage** was exercised in a browser harness (seven 30 MB reports pruned to the newest five, existing v2 data surviving the upgrade) and then in the field on 2026-09-29: two real STRZ-1658 reports, about 45 MB each on disk against a 10 MB session-storage quota, stored and opened.
- **The sticky walk** was measured on a fixture page, old and new walk side by side (5 to 14 candidates, every new rect equal to its live rect), not on a live run. It still needs STRZ-1658 and ENOC-97 reruns, ENOC-97 as the regression check. All six CI suites pass, but none of them runs the walk itself, which needs a real DOM.
- **The 720px popup** has not been checked in a loaded extension.
- **Quick Commands and the Console layout** were verified in a browser harness that slices the real functions out of `popup.js` and runs them against the real markup of both UI files, and by the CI suites; not in a loaded extension. No committed test covers the Console UI, since CI names its suites explicitly and nothing here has one yet.

## 2026-09-21

### Removed

**A/B Variant Comparison is no longer a Test Agent mode.** It is gone from the **Test Mode** dropdown and from the **Also Run** list; the **A/B** tab is the only place it is configured, run, or reported from. The tab itself is untouched — same engine, same standalone report, same Recent Runs.

The mode had already stopped being a mode. When A/B moved into its own tab, `TA_MODES['2']` lost its settings body and became a pointer card reading *"Settings and results live in the A/B tab now"* plus a button that navigated away — one feature with two run buttons, two report shapes, and a `fromTestAgent` flag existing only to stop the queued path opening a second report tab for one run. Removing the entry point removes the fork.

**Test Agent's Stop no longer reaches into an A/B run.** `stopTestAgent` set `_abVisualDiffStopRequested` because "runAbComparison also runs as a Test Agent mode." It doesn't, so that line could only ever have halted a Visual Diff started from the A/B tab in another panel — interference, not a stop.

**What was deliberately left in place.** The queued path's plumbing is now unreached but still wired: `fromTestAgent` (always false — every run takes the standalone branch), the metadata-only `_abLastRun.visualDiff` mirror, and the `visualDiffFull || visualDiff` fallback its three consumers read through. That mirror is where `f529775`'s false-PASS guards live on the queued side, along with `notServed`/`notVerified`, the `notWalked` counters, and `gradingFailed` — all of it pinned by `qa-report.test.js`. Tearing it out is a separate change with its own verification, not a side effect of deleting a dropdown option. Each comment now says the path is unreached rather than describing a caller that no longer exists.

## 2026-09-18

### Fixed

**Funnel Crawl now says what stopped it.** Two runs against lesschwab.com failed identically: the agent repeated one click ten times, nothing changed, the budget ran out, and the report said only *"Did not reach End — broke going from X to Y after 10 agent step(s)"*. Neither named a blocker, because the segment carried no stop cause at all — `data.stop_reason` was read once, compared to `'tool_use'`, and discarded, so a CAPTCHA wall, a payment gate, a login wall, a `max_tokens` truncation, an API refusal and "the model ran out of ideas" all returned byte-identical `{reached:false, error:null}`. The prompt explicitly instructs the model to stop and *report* the first three; that report had nowhere to go. The same file already knew better — the Figma path comments *"surface the real stop reason rather than letting an empty parse masquerade as a model that had nothing to say."*

Segments now carry `stopReason`, the raw `apiStopReason`, the model's terminal sentence verbatim in `finalText`, and a one-sentence `summary` from `fnStopSentence`. `note`'s truncation kept its head, so the closing "I'm stopping because…" sentence — the one the whole report exists to carry — was always the first casualty; `fnTrimNote` now keeps both ends.

**What was actually under the click.** A pre-click probe records `document.elementsFromPoint` (the full z-ordered stack), and a capturing listener plus a MutationObserver record whether the click was *delivered* and whether the page reacted. Point-based hit-testing is the only thing that works here: OneTrust's banner is `#onetrust-banner-sdk` / `.onetrust-pc-dark-filter` and carries neither `role="dialog"` nor `aria-modal`, so the existing WCAG `modalescape` check reports "No modal/dialog in the current DOM" on the very run a banner blocked.

**Three guards, because a confidently wrong blocker is worse than none.** An intercept is only claimed when the click reached something *other* than the element measured on top — both real failures were the agent clicking the consent banner's own dismiss button, where naming the banner is exactly backwards. An `<iframe>` is never classified, only reported as unreachable, because one filling the viewport is indistinguishable from a full-screen overlay by every other criterion. And "the site did not respond" is stated as the measurement, never as a verdict: delivery is confirmable but *intent* is not, and a delegated handler is unprovable from the page.

**The no-progress detector counts only dispatched clicks**, because the loop was fabricating its own stuck signature: `type` cannot move a text-length fingerprint (an input's value is not a text node), so filling name/email/phone read as three unchanged steps on a working form. An unknown reading never matches another unknown, so a failed probe caused by *navigation* — the strongest evidence something happened — can no longer read as "nothing changed".

**The click coordinate stopped being converted, silently.** The first funnel run that carried per-action evidence (`r_1789744771634`, lesschwab.com) recorded seven clicks, detected the no-progress run, and concluded *"The click reached an element, so this is not a targeting problem."* It was a targeting problem. Six of the seven coordinates were never converted from the screenshot's pixel space into CSS pixels and were dispatched raw, ~113px and ~134px off-target.

The segment measured the viewport **once** and the screenshot **every step**, so the ratio between them mixed a stale numerator with a fresh denominator. The bitmap lost ~56 CSS px of height between the first capture and the second — the image aspect went 2.172 to 2.264 against a viewport aspect of 2.165, so the viewport genuinely changed rather than the device pixel ratio — and from then on the two axes implied 1.076 across and 1.126 down. `fnCoordToCss` correctly refuses to convert when the axes disagree by more than 2%; it just had no way to say so. Both halves of the ratio now come from one capture: `captureClipped` reads `Page.getLayoutMetrics` next to `Page.captureScreenshot` and returns the viewport the bitmap actually covers.

**The safety net was built for the opposite sign of the same error.** `fnCoordInViewport` was added for `r_1789678299756`, where a Retina capture was *larger* than the viewport and an unconverted coordinate overflowed it. `FN_MAX_IMAGE_EDGE` downscales a wide capture, so the image is now *smaller* than the viewport in CSS px — and every coordinate inside a smaller image is inside the viewport by construction. It returned "in range" for all six wrong clicks and could never have done otherwise. `fnCoordToCss` now reports `converted` and a `reason` of its own, a coordinate it declined is **not dispatched** (the point would be unknown, and a click at an unknown point manufactures evidence), and two consecutive declines end the segment as `coord-space` rather than burning the budget.

**The stop sentence can no longer rule targeting out on evidence that cannot bear it.** "Not a targeting problem" rested on `delivered: true`, which only proves the click hit *something*. A no-progress run containing an unconverted coordinate is now named as a Selenite coordinate-space failure, ahead of every hit-test reading — a wrong point makes all of them describe the wrong element. This tightens the guards above rather than relaxing them.

**And the log can now be read without solving for it.** Diagnosing this run meant recovering step 1's image height by inversion — 1186 is the unique integer that reproduces its output — because `geometry` is one object mutated per capture and holds only the last screenshot's numbers for the whole segment. Every action now carries the geometry it actually used, its `coordConverted` verdict and the reason, and `problems` names a conversion failure directly.

**The cause was the debugger infobar, and the instrumentation proved it.** Re-running the same funnel confirmed every prediction: the viewport drops 1281 → 1225 CSS px once, immediately after `chrome.debugger.attach`, and then holds for the rest of the segment. Fifty-six pixels, which is Chrome's "started debugging this browser" bar — so this was never about lesschwab, and it would have fired on the first segment of every funnel run on this host. The same run also settled the open question the `innerW`/`innerH` probe was added for: `window.innerHeight` and `cssVisualViewport.clientHeight` are the *same number* on every settled capture, so there is no scrollbar correction to make.

**The seed capture is taken while that bar is still animating.** With both halves measured together the funnel now completes — seven steps, `arrived` — but the *first* click still landed 42px low, on the cookie banner's container instead of its button, because the bitmap (1186 tall) and the measurement beside it (1265) caught different frames of the animation and the viewport was 1225 by the time the click went out. It converted, so `fnCoordToCss` could not be the thing that catches it: converting asks *"is this the same viewport at all"*, and this is *"was it holding still"*. Two questions, two thresholds.

`captureClipped` now retries once when a bitmap and its measurement disagree by more than 0.5%, and `crawlSegment` waits for two consecutive identical `Page.getLayoutMetrics` readings before the seed capture — attaching the debugger is itself what moves the viewport, so the one capture guaranteed to be taken mid-animation is the first one. The 0.5% threshold is measured rather than chosen: the same run separates moving from settled by more than two orders of magnitude, 0.99% against 0.0025%.

**Nothing in the crawl loop had a time bound.** The vision call carried only the Stop button's `AbortController` and `exec()`/CDP sends carried nothing at all, so a request that never came back stalled the segment for as long as the tab stayed open — no error, no step recorded, and nothing in the log to say which of the two it was waiting on. There is now a bound on each vision call (90s), each browser action (15s), and each waypoint-to-waypoint hop (5 min).

They are deliberately generous, because they exist to end a hang rather than to hurry a slow page: a bound that fires on ordinary slowness converts working runs into false failures, which is worse than waiting. A timeout is never reported as a site finding, and the three causes stay apart because they have three different fixes — the model did not answer (re-run), the tab stopped answering the debugger (check the browser), or the hop is simply longer than the time allowed (give it more room). A timeout must also never read as a user Stop: both arrive as `AbortError`, but one says the tester chose this and the other says nothing answered.

**Every action now records its own time**, because "the run is slow" had two causes and no log could tell them apart. `modelMs` is the wait for the vision call and `ms` is carrying the action out, and the wall-clock sentence reports the split — *"90s of that was spent waiting for the model and 15s on the page"* — which is the part that says which half to fix. The thresholds above are first principles for now; no log on record carried any timing at all, so these are what the next runs will replace with measured numbers, the way the capture threshold already was.

**The settle wait paid for itself immediately.** The same lesschwab funnel that took seven steps now takes **three**: the seed capture is settled from the first frame, its two axes are 390× closer to agreeing (0.009865 → 0.0000252), the viewport never moves mid-segment, and the wasted first click on the cookie banner's container is gone.

**A native dropdown is the one control a click can never operate.** A run against healthypaws spent **five of its ten steps** clicking `#petBirthYear` and ran out of budget, and the report could only say *"the page was still changing, so raising the step budget may get further."* Raising it would not have helped. A native `<select>`'s option list is drawn by the browser, outside the page — absent from the DOM, absent from `Page.captureScreenshot`, unreachable by `Input.dispatchMouseEvent`. Clicking it can only ever focus it, so the model saw an unchanged screenshot and tried again.

The same form proves the distinction. `#petBreed` is *also* a native `<select>`, 594 options, but select2 wraps it — collapsing it to 1×1px and rendering real DOM options — so the bot selected a breed in two steps and moved on. One form, two dropdowns, opposite outcomes.

A click that lands on a native `<select>` now picks a random valid option instead, applies it through the prototype `value` setter (never `el.value =`, which defeats React's value tracker), fires `input` then `change`, and reads the value back rather than assuming it stuck. Placeholder options with an empty value and disabled group headers are excluded — both are on that real form, and choosing either is the same as not choosing. The model is told which value was chosen and can click again for another. `el.closest('select')` is the discriminator and needs no size heuristic: a select2-style widget puts its own span at the click point, so a wrapped dropdown is never intercepted and keeps working the way it already did.

The choice is random by design — the job is to get through the funnel, not to test a particular value — so the resolved pick, the option counts and a capped sample of the list are recorded. That is this codebase's standing rule for variance it introduces on purpose: export the exact input, so two runs can be compared rather than argued about.

**The probe could not report what it hit**, which is why nothing downstream could have noticed. `brief()` returns `'#' + el.id` as its first branch, so `hit.top` was `"#petBirthYear"` and the tag name was gone. It now carries a `control` block naming the select, its option count and how many of them are choosable.

**Attribute-only churn is no longer progress.** `fnNoProgressRun` broke its streak on `mutations > 0`, and each of those five clicks produced three to five mutations — a focus ring, an `aria-expanded` flip — so the detector scored a run of zero every time and the nudge never fired. The observer now counts `childList`/`characterData` records separately from `attributes`, and the streak consults the structural count.

This is not a relaxed guard. It is never consulted alone: a streak also requires the action key to match, and that key carries `document.body.innerText.length`, which *excludes hidden text* — so a click that reveals a menu by toggling a class moves `textLen` and breaks the streak regardless. Attribute-only churn together with an identical URL, title and visible text is the page acknowledging a click and doing nothing with it. A log from a build that never split the counts falls back to the old total and reads exactly as it always did. The nudge's claim that *"no DOM change was observed"* became false under the new rule and changed with it.

**The step budget is gone — the clock is the budget.** A funnel is as long as it is. The next healthypaws run filled a name, a breed, an age, an email and a ZIP and ran out at ten steps with the form complete and unsubmitted, reported as *"the page was still changing, so raising the step budget may get further."* A fixed step count cannot tell a long-but-healthy funnel from a stuck one, and everything that *can* now exists: the segment wall clock, the no-progress detector, an unconvertible coordinate, a wedged tab, a model that stops, or arrival.

What remains is a runaway guard, not a budget: at the ~4s per step these runs actually take, the 5-minute segment clock lands near 75 steps, so reaching 500 means one of those guards is broken. It gets its own `runaway` stop reason saying exactly that, rather than inheriting `budget`'s advice to raise a limit that no longer exists. Logs from builds that *had* a step budget keep reading the way they were written.

**The dropdown fix worked on its first real run**, in one action: `"8 years"` chosen from 15 options (14 usable), `applied: true` read back from the control, `previousText: "Pet's Age"`, no repeat. The select2-wrapped dropdown on the same form was left alone and clicked through as before, which is the distinction the interception was built around.

**A defect in the previous change, found by that same log and fixed here.** `structuralMutations` shipped with the observer counting it and the debug log exporting it — and nothing in between copying it from the probe onto the action record. So `fnDidSomething` fell back to the undifferentiated total on every real run and the attribute-churn fix was inert, while every unit test stayed green because they all feed the predicate hand-built objects. The log is unambiguous about it: `hit.control` populated, `structuralMutations` null on all ten actions. The suite now asserts that **every field the post-action probe returns is copied onto the record**, which is the shape of the failure rather than the instance of it.

**The crawl's vision call had no retry, so one blip cost the whole segment.** A toryburch run made four good calls and lost everything to a single `Failed to fetch` on the fifth — four working steps and 25 seconds, discarded, with the tester left to start again. The report path has retried since `7e38210`, and the comment there already describes this exact failure: from inside a page context, a 429 whose error response arrives without CORS headers is indistinguishable from a dead connection. The crawl makes one call per *step* rather than one per variant, so it meets that more often, not less.

It now gets the same three attempts with exponential backoff and jitter, through the same predicate — renamed from `vdShouldRetryReport` to `shouldRetryApiCall`, because a `vd` prefix on something the crawl depends on would be a lie about who owns it.

Two failures must never be retried, and they are stated in one place rather than implied by control flow: a **Stop** is the tester's decision, and a **timeout** has already spent 90 seconds, so two more attempts would put one step over the segment's entire clock. Both surface as `AbortError`, so only an explicit policy keeps them apart from a network blip. Stop is also honoured *during* a backoff — the step loop checks it at the top, which a retry sits underneath, and without that check a Stop pressed mid-wait still spent another call.

The call moved into `fnVisionCall`, which returns a result rather than throwing, so the retry loop can never be confused with the step loop. `modelMs` now spans every attempt, which is the honest number: that is how long the step actually waited. The response body read is bounded too — it was previously covered by the abort signal and no longer is.

Tests pin the policy and, separately, **that something consults it**: the crawl must not contain a raw API call site any more. A second one is exactly how one of them ends up without a retry, which is the whole defect.

**One place calls the Anthropic API now, and it retries.** There were six call sites and four had no retry at all. The same failure has cost real runs twice — the Visual Diff report path got a retry in `7e38210`, the funnel crawl got one earlier today — and both times the other call sites kept the gap. A third per-site fix would have guaranteed a fourth.

`anthropicFetch()` owns the fetch, the retry and the body read; every caller keeps its own error handling and response shape, because three of them are message handlers with their own. `callClaudeVision` (three callers behind it), the Figma comp summary, the Test Agent summary and the AI field extraction all gained a retry they never had. The policy moved with it: `vdShouldRetryReport` became `shouldRetryApiCall` and `fnRetryableFailure` became `retryableFailure`, since a `vd`/`fn` prefix on something every path depends on lies about who owns it. The suite now asserts `api.anthropic.com` appears **exactly once** in the file — that is what stops a seventh call site being written without a retry.

The two outcomes that must never be retried are still stated in one place: a **Stop** is the tester's decision, a **timeout** has already spent the caller's whole allowance. Both arrive as `AbortError`, and the helper composes each caller's own signal with its own per-attempt timeout rather than reaching for a module global — a Stop on a funnel must not abort an unrelated Figma summary.

**A retry that succeeds now leaves a trace.** It left none: `modelMs` spans every attempt, so a fast failure plus a retry read as one slow call, and the toryburch run that reached its destination could not say whether the retry shipped an hour earlier had ever fired. Every call now reports `attempts` and `transient` — the failures it retried *past* — recorded per funnel action and on the Visual Diff report result. That is the signal that says the API is flaky *before* it costs a run.

**A gate-blocked funnel is a caveat, not a failure.** A CAPTCHA, login wall or payment step now reports `warn` rather than `error`, so it no longer badges the section DEGRADED. *"This funnel cannot be crawled past step 1 without solving a bot check"* is a complete, correct answer — the crawl did exactly its job. Everything else stays `error`. The gate classification is now stored on the segment instead of being computed for a sentence and thrown away, using the same pure function `fnStopSentence` already calls, so the two cannot disagree and `popup.js` never re-implements the patterns.

**And the closing quote printed twice.** `fnStopSentence` already embeds the agent's last words via *"In its own words:"*, and the problems builder appended them again — the same text twice in one 837-character entry. It is appended only when the summary does not already carry it.

**A scroll is not a click.** The big-target notice added above fired on `scroll` actions, whose coordinate is a wheel *origin* rather than a target — so the first run written by that build opened with two scrolls over a 91% hero link and was told about the link twice, about an element the action never addressed. The click-action list had been written out three times and the fourth copy simply omitted it; it is `FN_CLICK_ACTIONS` now, used by the notice, `fnCountsForProgress`, the select interception and the click dispatch alike.

That run settled three things the audit fixes shipped unproven. The attempt counters are **wired**, not merely computed — `modelAttempts: 1` on 9 of 9 actions, which is the check that matters, because a field the probe computes and nothing copies is exactly how `structuralMutations` stayed inert for a commit. The overlay probe was fixing something real: five of nine clicks sit inside a fixed ancestor and the leaf is `static`/`absolute` at 0–1% on every one, so the old fixed-and-large fallback could not have fired once; `#locale-popup` reads at 100%. And the intercept gate is load-bearing exactly as the audit warned — four of those overlays are large enough to be named a blocker, including the modal the crawl was successfully *operating*, and `deliveredTo !== hit.top` is the only thing that stops the claim.

### Found by auditing a run that succeeded

Four independent lenses over `r_1789755806034` (toryburch, reached in 12 steps), each finding adversarially verified by three refuters on separate angles. Twenty findings, eleven survived. The five below were re-measured against the real functions before being acted on.

**A click that navigated was counted as a click that did nothing.** `fnNoProgressRun`'s own comment says it returns null on unknown evidence, because *"treating null as 'same as the previous null' would make NAVIGATION, the strongest possible evidence that something happened, read as a stuck run."* It tested the wrong field. `fnPostActionProbeFn` fills `page` unconditionally from `location`/`document`, while the mutation counts come from the armed probe state that a replaced document destroys — so a navigating click arrived with a live fingerprint and null counts, and read as "nothing happened". Measured on the real predicates: five dead clicks plus one navigation reached `FN_STUCK_ABORT`, and six navigations alone did. `fnActionKey` now returns null when the counts are unknown, which is what it always claimed to do.

**The failing vision call's retry cost was computed, returned and discarded.** The error break took `error` and `stopReason` and dropped `attempts`/`transient` — so for the one call class where the retry is the point, a 429 retried three times and a 429 never retried stayed byte-identical in an exported log. The segment carries both now.

**The blocker namer was reading a leaf.** It scans `hit.top` plus a four-deep *paint-order* slice, and `stack[0]` is an inner `svg`/`use`/`span` on 10 of 12 clicks — so it never reached the element carrying the vendor id. Replayed offline it scored **0 of 4** on that run's real popups and **0 of 7** on the one run that actually got stuck; the fixed-and-large fallback could not fire either, because the leaf inside a fixed overlay is itself `static` at 0%. The probe now records the nearest fixed/sticky **ancestor** with its own coverage, plus the ancestor chain, and the namer reads both. Logs written before those fields keep reading exactly as they did.

**The select interception keyed on `kind` alone.** A `<select multiple>` would have had its entire selection collapsed to one random option by the native value setter, and a `size>1` listbox renders its options into the page where they can simply be clicked — neither is the case the interception exists for. Both are excluded now. Separately, a dropdown already sitting on its only real option — a single-country Country field — reported an error on every click forever, and `fnCountsForProgress` excludes errored actions, so nothing would ever have noticed the loop. That is `alreadySet`, not an error.

**The agent was never told what it was about to click.** The probe measures `hit.top` and `coversPct` at the exact point, immediately before dispatch, and writes them to the log — and the model only ever hears what its click *did*. Step 1 of that run clicked a link wrapping a hero video at **91% of the viewport** while narrating "closing the promotional popup in the corner". A target at or above 50% coverage is now reported back as an observation. The threshold is measured, not chosen: across the 57 corpus clicks carrying a coverage reading, exactly one is at or above it — that one. `interactive === false` was the obvious alternative and fires on 30% of the same clicks.

### Also fixed, found while instrumenting

- **`key` was a no-op that reported success.** It slept 100ms and dispatched nothing, and `rec.error` stayed null, so the model was told every Enter-to-submit worked. Now dispatches `rawKeyDown`/`keyUp` for Enter/Tab/Escape; anything else is reported as unsupported rather than silently skipped. Unhandled actions (`hover`, `wait`, `double_click`, `left_click_drag`…) no longer fall through claiming success.
- **Abandoned waypoints are recorded.** `if (!seg.reached) break` dropped every remaining hop, so a five-waypoint funnel that broke at hop two rendered as a two-row table with nothing saying the other three were never tried.
- **The post-click settle is load-aware.** A flat 1200ms with no load check meant a slow SPA route change read as "nothing happened" — a false accusation against the page. `waitForLoadTimeout` is what the rest of the file uses; the crawl was the one place that didn't.
- **Arrival checks stopped swallowing their errors.** A throw from `chrome.tabs.get` reported a segment that *did* arrive as broken, silently.
- **Out-of-range clicks were described with the wrong segment's screenshot.** The problem line looked up `segs.find(s => s.geometry)` — the *first* segment that had any — to report dimensions for clicks that may have come from a different one.
- **`visualDiff.reason: "not run"` read like a decision.** It is the fallback for "there was no mode-2 entry to read a reason off": Visual Diff is a step inside A/B Variant Comparison, never a mode of its own, so it never appears in `modes`. It now says that. (`settings.visualDiff` is live UI state read at report time and reads `true` on every log, including funnel-only runs.)
- **A stale service worker is named.** Recording steps while recording no per-action evidence is structurally impossible in the current build, so it now says so: Chrome re-reads `popup.js` when the panel opens but keeps the running worker, and that split cost a full diagnosis cycle on run `r_1789742354610`.

### Tests

`extension/tests/fixtures-real-funnel.json` joins the real-run corpus, projected by `regen-fixtures.py` alongside the four Visual Diff fixtures and under the same all-or-nothing byte-identity guard. It pins the two walks that recorded actions — the failure and the fix — out of four funnel runs in 69 logs, and exists so walks join it as they land. Three traps are written into the generator: `steps > 0` with no actions is the stale-worker shape and not a parse failure; `coordConverted: null` (a worker predating the field) is a third state that must not collapse into `false`; and `hit: null` (the probe could not run) is not a hit whose `top` is null.

The verdict corpus now also requires that the A/B comparison actually ran. Funnel runs land in the same id range as A/B runs and carry no verdict at all, so four of them projected as runs whose every count was zero — which the suite read as *clean* rather than *absent*, firing `allClean` and the control-duplicate identity on runs that had compared nothing.

## 2026-08-24

### Changed

**Visual Diff: the LLM is out of parsing and diffing entirely.** The 3-stage pipeline shipped on 2026-08-21 (Sonnet scrape → local diff → Opus report) ran against a real page for the first time and produced mostly noise: a hero-copy-only A/B test reported 11 added / 5 removed / 26 modified / 2 style-changed against just 3 unchanged blocks. Opus spent its output budget explaining why its own inputs weren't real changes — *"the caption was not deleted — it was re-parsed into the template list block"*, *"replaces an em dash with a period"*, *"unchanged apart from line-break formatting and shifts up 209px"*.

Three root causes, all architectural and none tunable away: Sonnet's semantic grouping is non-deterministic, so re-grouping between two runs manufactures phantom findings (and `temperature: 0` is rejected outright by the API for this model); one real change shifts everything below it, so a single edit cascades into ~25 "moved" findings; and raw text comparison flags punctuation and whitespace as content changes.

The parse and diff stages are now deterministic. One model call remains, for judgment only.

#### New: `extension/vd-diff.js` — the deterministic matching engine

- Nine tiered exact-match passes over per-element identity keys (testid, stable id, path+text, text, href, aria, path, numeric shape) plus one narrow fuzzy fallback. Every tier except `path` is read off the element itself and cannot change because a *different* element changed. Replaces `needlemanWunschAlign` + `blockSimilarity` + the reorder pass, which existed only because Sonnet's blocks had no identity at all.
- **Pass ordering is load-bearing, not incidental.** Text-identity passes run *before* path-only. Path-only doesn't fail cleanly on a shifted subtree — it *misfires*, confidently pairing an element with whatever unrelated content now occupies its old structural slot. Text-only can't misfire that way: a text with no matching count on the other side simply defers. Caught by hand-simulating a wrapper-div insertion; the first draft had these two swapped.
- **Piecewise reflow suppression.** Real reflow is piecewise constant (content above a shortened hero has Δy=0, below has Δy=−259), so a single global median reports half the page as moved. `vdDeriveShiftSegments` run-length segments the Δy sequence instead. On the 39-pair simulation of the real failure: 38 suppressed into one aggregate, 1 real finding — *and* an element that moved against the local reflow still survives, which the old pipeline couldn't distinguish at all.
- **Grouping moved to after matching.** A grouping error can now only merge or split real findings, never manufacture one. The entire "re-parsed into / split out of / merged into" noise class is gone by construction rather than by tuning.
- Style-field comparison is now the primary CSS-change detector — free, exact, and it names the property that changed. The walk was already capturing `backgroundImage`/`border`/`boxShadow`/`opacity` and **nothing had ever compared them**. The per-block pixel check is demoted to a capped backstop for rendering differences with no style, text, or size delta at all.

#### Deleted

`VIS_SCRAPE_SCHEMA`, `buildVisualScrapePrompt`/`Content`, `runOneScrapeBand`, `scrapeVisualDiffPage` and its handler, all six banding constants, `diffPageScrapes`/`blockSimilarity`/`needlemanWunschAlign`/`vdChangeSignals`, the `vdDebugScrapeStability` handler and `scrapeStabilityCheck` (it measured model variance that no longer exists), and the whole cross-run Control-scrape cache including the **Force fresh Control scrape** checkbox in both panel files — that cache existed only to avoid re-paying for Sonnet calls, and parsing is now free. Per-variant round trips drop from 4 to 3, and the deleted one was the expensive one.

#### Fixed

- **A regression introduced by this rearchitecture's own first step, reported from a live run:** `Error: GAP_PENALTY is not defined`. Rewriting `vd-config.js` deleted the six DP-alignment constants while `diffPageScrapes`/`blockSimilarity` in `popup.js` still referenced them, so Visual Diff couldn't run at all. The earlier steps had been recorded as "ships no behavior change" — they didn't. Fixed by completing the swap-over rather than restoring the constants.
- **Digit-group separators read as copy changes.** `$1,000` → `$1000` normalized to `"1 000"` vs `"1000"` and reported as a real text change — a steady source of phantom findings on any page with prices or stat counters. `vdNormText` now strips a separator sitting between a digit and exactly three more digits, leaving decimal commas and ordinary commas alone. Caught by the jsc suite, not on a page.

#### First gate run against the real page — the cascade fix that mattered

The 4-variant Zapier case was re-run against a loaded extension. The old noise classes were gone outright: added dropped 11 → 1, removed 5 → 4, the hero copy swap was correctly named as the first finding on every variant, and the entire "re-parsed into / split out of / merged into" family had disappeared. All three variants returned byte-identical counts, which is the determinism the rearchitecture was for. But ~49 "modified" findings per variant still leaked, all of them layout shifts — and the model's own notes named them as cascade: *"shifted up 35px, consistent with the removed label above it."*

- **`vdDeriveShiftSegments` collapsed whenever two reflow bands overlapped in y.** It sorted by document position and broke a run the moment Δy changed. That sounds equivalent to clustering and isn't: overlapping bands are the *normal* case — a section that loses a label shifts its own children by one amount and everything after it by another — and inside the overlap, consecutive elements alternate between the two amounts, so every run terminated after one element and nothing reached the 3-element trust threshold. Measured on the real page's shape: **97 segments, 95 of them untrusted singletons**, suppressing only the bands that happened to sit alone in their y-range. Now clusters on the shift *amount* and uses position only to bound where that amount applies: **3 clusters, 0 leaked**, with a planted rogue move still correctly reported.
- **Horizontal shifts cascade too.** The design assumed they didn't and skipped banding for them. Removing one chip from a wrapping template-link grid re-flowed every chip after it and re-wrapped the rows, producing six findings per variant reading "a row of twelve template links shifted right by 126px". Whether a shift cascades is a property of the container, not the axis — both axes now get the same clustering, and a shift is only reflow when *both* components are explained.
- **Autoplaying video defeated capture stabilization.** `stabilizeForCapture` froze CSS animation but not video playback, so each capture caught a different frame — surfacing as `style-changed` for the hero video and, through grouping, for the button beside it. Videos are now pinned to their first frame, before and after the lazy-load scroll pass.

#### Visual Diff and Agentic Testing are always on; heatmap checkbox retired

Both were opt-in checkboxes that had to be ticked every session. They are now on by default with the checkboxes removed. The interaction-heatmap checkbox is also gone and its state pinned off — the feature and its code are untouched and can be revisited, it simply has no UI.

The A/B options row is now just **Keep tabs open** and **Show crop images in report**. That crop checkbox was previously `disabled` until Visual Diff was ticked; with Visual Diff always on it is always enabled, and its title no longer claims a dependency that can't be unmet.

- **Persisted session state is overridden, not merged.** `abState` is built as `{...defaults, ...saved}`, so a session saved before this change carries `visualDiff:false` / `agenticTesting:false` and would have beaten the new defaults — with no checkbox left to fix it, the features would look permanently broken for exactly the users who had run before. The three fields are now forced after the merge. Every other preference, including the user's crop choice, still comes from the saved session.
- All three `addEventListener` bindings for the removed inputs were deleted along with the elements. This matters more than it sounds: the panel's init is a single unguarded `await` chain, so one `addEventListener` on a null element throws and silently kills every listener bound after it.

*Verified in a browser*, not just by parsing: the panel was loaded against a stubbed `chrome` API and checked for (a) zero init errors, (b) `initAbCompare` completing — it renders the variant-target rows, which sit downstream of where the removed bindings were, so their rendering proves the chain survived, and (c) a seeded stale session with both features off and heatmap on coming out as on/on/off while its unrelated fields were preserved.

Worth recording: the first run of that harness *did* throw — at `ensureOpenUrlFirst`, because the stub returned no `functions` map — and it took out `initAbCompare` several hundred lines later, leaving the target list empty. A live demonstration of the fragility described above, from an unrelated cause.

#### Root-caused: the walk was dropping horizontally off-canvas elements

The previous entry's `clipped` rule removed three phantom removals per variant but not all of them. The next run showed why: **"Repurpose content" sits at x=2650..2814, comfortably inside a 2847px page in Control**, so no edge test could flag it — yet it was reported removed in v1 and v3 and *not* v2. The tell was that instability. Which chips leaked was a function of where the marquee happened to stop, and the offsets differ run to run (−148/+151/+163/+250 one run, −208/+213/+230/+353 the next).

`clipped` was a geometric proxy. The actual cause is that `domCandidateWalkFn` **discarded** anything outside the page's horizontal bounds. An auto-scrolling marquee pauses wherever it is, so a chip is on-canvas in one capture and past the edge in the other — discarded from only one list, with nothing left to match against, and reported as removed. The filter's premise was inverted: dropping is what manufactures the phantom findings it was written to prevent, because the two captures drop *different* elements.

This is the same asymmetric-drop root cause fixed earlier on the vertical axis, and the same remedy: stop dropping, start flagging.

- The walk keeps horizontally off-canvas elements and marks them `offCanvas` — a strict superset of `clipped`, which could only ever see straddlers and never an element the drop had already removed. A scrolled chip is now present on both sides, matches on text, and its dx is explained by the page's own horizontal reflow band, so it suppresses as ordinary reflow.
- The three pixel-dependent stages skip it, mirroring `belowCapture` exactly: the per-pair backstop, the wire block, and the crop. The screenshot is clipped to the page width, so reading out there would throw or silently compare the wrong column.
- **The `clipped` suppression is deleted rather than kept alongside.** It was a workaround for the drop; with the drop fixed it is redundant, and keeping it would hide genuine carousel changes — which a variant might legitimately make.
- `suppression.offCanvas` is replaced by an `offCanvas` **coverage** counter next to `belowCapture` in the debug log, with the same reportable-findings-only guard that counter had to learn once already.

Also closed a pre-existing test gap surfaced while tracing this: `belowCaptureStillDiffs` built its finding list without the `!c.clipped` filter production applied, so test and production could disagree silently. With the filter gone they match, and the test now asserts it.

178 assertions.

#### Two fixes from the first run of the shared-findings change

**Text-less elements collided in the shared-finding key.** The identity was `(changeClass, control text, variant text)`, so two different removed images — both with empty text — produced `('removed','','')` and merged into a single row. Two real removals reported as one: data loss, introduced by the previous entry's change.

The key now includes the **control-side rect**. Control is captured once and reused for every variant, so anything on its side is perfectly stable across them, which makes its position the ideal tiebreaker. The variant side still contributes only its *size*, never its position, because that legitimately moves — a taller hero pushes "Contact sales" 50px down in one variant and it is still the same change. Verified against the two real images from the run: distinct identities, two rows instead of one.

**A horizontally-scrolling carousel manufactured phantom removals.** "Repurpose content", "Generate posts" and "Implement IT support" were reported as removed — "Repurpose content" in one variant only, which is what gave it away. All of them straddle a horizontal page edge, and the run's own horizontal shift bands (−148 / +151 / +163 / +250px, 12–14 elements each) show a template-chip carousel resting at a different offset in each capture. A chip past the edge is dropped by the candidate walk, so it looks removed; the same chip inside the edge in another capture does not.

The walk now marks any element straddling a horizontal page bound as `clipped` — real page content does not hang off the side of the document, so it is a reliable marker for "visibility here depends on scroll position" — and an *unmatched* clipped element is suppressed rather than reported. Counted in the aggregate and named in the report's suppression line, never silent. On the captured run this removes 4 phantom removals from one variant and 3 from each of the others, leaving 4 real removals identical across all three.

**Not claimed as fixed:** one text-less logo image in that same carousel row sits *inside* the bounds and is still reported. It is plausibly the same class of artifact — a logo strip re-ordering — but its rect is legitimately on-canvas and there is nothing in this run's data that proves it either way.

#### Changes common to every variant are reported once, not once per variant

On a four-variant run the report showed **27 finding rows, 15 of which were 5 changes repeated three times** — the same eyebrow removed, the same heading removed, the same CTA relocated, in each variant's section. Only 12 rows were the copy differences that actually distinguished the variants.

Shared changes are now lifted into a **"Common to all variants"** section ahead of the per-variant ones. Confirmed on a live run: **33 rows becomes 7 shared + 12 variant-specific = 19**, with nothing lost — the diff produced 11 findings per variant, and 7 shared + 4 unique accounts for all of them. What survives in each variant's own section is exactly the experiment: the hero heading, the subhead, a new h2, and the body copy.

- **Not suppressed, only consolidated.** A change every variant makes is still a change from Control, and "all three variants dropped the same CTA" is a regression worth seeing. Hiding it would repeat the mistake that let a run with zero findings read as a pass — so the shared findings also count toward the section's issue tally, or a run whose only findings were universal would badge PASS.
- **Identity is `(changeClass, control text, variant text)` with no rect.** The same change lands at a different y in different variants when a taller hero pushes it down (v3's "Contact sales" sits 50px lower than v1's), and a `moved` finding varies by a few px between them — including position would defeat the grouping in exactly the cases it matters most.
- A change must appear in **every** analysed variant to qualify; errored and skipped variants don't count as agreeing, and the same change appearing twice within one variant can't masquerade as appearing across two.
- A variant left with nothing unique now says so explicitly rather than falling through to "No differences detected", which would have been actively misleading.

*Tooling note:* the edit that introduced this landed a literal NUL byte inside a `join()` separator — the transmission artifact this project has seen before. It made `grep` treat the whole 408KB file as binary and silently return nothing, while the code itself parsed and ran fine. Worth remembering that a grep returning *no output at all* (rather than "no match") on a known-good file is the tell.

#### Control-vs-Control is now an error that stops the analysis

Comparing Control against itself yields zero findings, and zero findings is indistinguishable from a clean pass. That made it the most dangerous outcome the tool could produce: a misconfigured run that reports success. The pipeline used to emit exactly that, as an ordinary result — *"No differences detected against control."*

Three ways it can happen, all now caught, and none of them proceed to analysis:

- **Same configured URL as Control** — a duplicated target row. Caught before any work is done, comparing normalized URLs so a trailing slash or capitalized host can't hide it.
- **Redirected onto Control's final URL** — the forced-variant parameter was dropped en route. Caught on the same pre-flight check against `finalUrl`.
- **Rendered identically to Control** — configured correctly, but the experiment never applied. Caught after the diff: zero findings *and* nothing added, removed, changed or restyled anywhere. This is the one that used to sail through as a pass.

Each stops that variant, records `Analysis stopped — …`, and is reported as an **error** in Run Diagnostics that outranks every other note for the variant, ending with *"No QA result exists for this variant — do not read the absence of findings as a pass."* If every variant resolves to Control, the run itself bails with one message rather than a list of per-variant errors.

The report badge needed fixing alongside it: `variantIssueCount` returns 0 for any errored variant, so a run where the experiment never applied would have shown a green **PASS**. The section now badges **NOT COMPARED** whenever any variant was a Control duplicate, and says so in the summary line. A judgment left in place deliberately: `redesign` mode is never assessed by this rule, since a low match rate has its own diagnosis and would otherwise be double-reported.

#### Confirmed on a real page: full-page coverage, and both fixes hold

Same page, same width, immediately before and after — the walk went from **201 to 521 control elements**, and the deepest element it can see moved from y=7960 to y=9698 on a 15140px page. 320 of those 521 elements sit past the screenshot's 8000px line and had never been part of any comparison.

It paid for itself on the first run: **two real removals that were previously invisible** — the "Repurpose content" and "Implement IT support" template links at y≈9600, gone in every variant and detectable only now.

The pixel-backstop fix held too: the variant that reported 31 false `style-changed` findings now reports **zero**, and all three variants land on the same **11 findings** — every one real, no noise. The two new deep-page removals are the difference between 9 and 11.

- **Fixed a miscount in the new diagnostic itself.** `belowCapture.findings` counted every below-capture pair still in the working set, unchanged ones included, so it read **281** on a variant whose true answer was **2** — purely because a page-wide 4px shift (under `VD_MOVE_MIN_PX`) leaves pairs sitting as `unchanged` rather than being suppressed as reflow. A diagnostic that swings two orders of magnitude on whether a page happened to shift 4px or 47px is worse than none. It now counts reportable findings only.
- The note also leads with coverage rather than caveat — "320 of 521 elements sit below the screenshot's reach and were compared from the DOM alone" — since the headline is how much of the page is newly being checked, not what is missing from it.

#### Fixed: the pixel backstop fired on pairs that had moved

A run where one variant reported 24 findings against its siblings' 10 — the extra 14 all `style-changed`, all with identical text, none naming a style property, with pixel ratios up to **1.000** on a paragraph whose content had not changed at all.

The mechanism needed two variants of the same page to straddle a threshold before it became visible. That variant's lower page shifted a uniform **4px** — below `VD_MOVE_MIN_PX` (8), so nothing counted as "moved", the reflow-suppression branch never ran, and 146 pairs stayed `unchanged` and reached the pixel check. Its siblings shifted 47px, which cleared the move floor, so their pairs were suppressed as reflow and never arrived. Same page, same code, opposite outcomes.

Once there, the check compared Control at `y` against Variant at `y+4`. Rects are rounded to integers, so a true shift of 4.4px stores as 4 and leaves sub-pixel residue — and against text that re-renders nearly every antialiased pixel, which is exactly how a ratio of 1.000 arises on identical copy.

The backstop now runs only on pairs that have not moved at all (`dx` and `dy` both zero). That is what it was always for: CSS changes the style-field diff cannot see — a swapped background image, a dropped shadow, a gradient — none of which move an element. Replayed against the captured run, all 15 false findings disappear and that variant reports **9**, in line with its siblings' 10. The accepted cost: a real pixel-only change on an element that also moved will now be missed by this check, leaving the style-field diff and the unsuppressible whole-page ratio as its coverage.

This also retires the open question from two runs earlier — four pixel-only `style-changed` findings that could not be attributed at the time. Same class, same cause.

#### The whole page is now compared, not just the screenshot

Control is the reference and must be scanned in full; variants only need to be checked for deviations against it. That was not what was happening: the DOM candidate walk was clamped to `capturedH` — the screenshot's 8000px ceiling — so on a 19845px page **60% of the document was never walked on either side**. A copy change, a removed button, or a restyled section below the fold could not be reported, because those elements were never recorded as candidates at all.

The clamp was never necessary. The walk reads `getBoundingClientRect` and `getComputedStyle`; it does not read the screenshot. Text, colors, layout, and element presence — every category the deterministic diff actually detects — need no image. Only two consumers genuinely need pixels: the per-pair pixel backstop and report crops.

- The walk now covers the entire document. Candidates past the capture line are diffed normally and carry `belowCapture` so the two pixel-dependent stages skip them rather than reading past the bitmap (which would either throw or, worse, silently compare whatever the clamped image holds at that coordinate).
- Genuinely off-canvas content is still dropped — a carousel slide parked beyond the page width or above the origin, which no user and no screenshot ever sees. That was the filter's real job; the vertical clamp was collateral.
- The truncation notice was rewritten and downgraded to a note, because the old wording is now false. It no longer claims the bottom "was never compared" — it says text, colors, layout and element presence *were* compared over the whole page, and that only the pixel backstop and crops are unavailable down there.
- Two new diagnostics: the count of findings that have no image, and a warning when the walk hits its `VD_MAX_CANDIDATES` ceiling — previously unreachable behind the 8000px clamp, now genuinely possible on a very long page, and it truncates from the bottom.

#### Fourth run: diff is clean, and it caught a real defect

Geometry consistent across all four captures (877×738). 93.2% element match, normal mode on every variant, 101 reflow elements suppressed, and the single reported move is genuine — a CTA that really did relocate 3856px up the page. All 14 findings per variant are real changes; none are artifacts. With a Summary of Changes supplied for the first time, spec classification worked end to end and flagged **placeholder Lorem ipsum copy shipped in v3's live body text** as `unexpected` / `high`. `style-changed` findings now name the properties that changed (`color`, `backgroundColor`, `border`, `fontWeight`, `borderRadius`) rather than reporting a bare pixel delta.

- **Fixed: React 19 `useId` values were accepted as stable ids.** Zapier's MCP/SDK/CLI tab buttons carried `id="_R_84qnmlb_-MCP"` on one run and `id="_r_5_-MCP"` on another — same elements, regenerated id. Neither form was caught by the existing reject list (no leading colon, fewer than four consecutive digits), so both were used as structural path **anchors**, which poisons the path key for the entire subtree beneath them. Text-tier matching happened to cover for it here, but `path` was carrying only 3 of 110 matches. Added `_R_`/`_r_`, React's legacy `«r0»`, and MUI/Chakra/Mantine prefixes.
- **Truncation now states the fraction missed.** "Only the top 8000px was captured" reads as a technicality; "59% of the page was never compared, so no finding below that point can exist" is the actual blind spot. When the capture is under 1200px wide it also notes that a wider window makes a responsive page shorter — this run was 877px wide and 19845px tall, which is what pushed 60% of it out of range.

#### Added: committed regression suite

`extension/tests/vd-diff.test.js` — 114 assertions, `jsc vd-diff.test.js` from that directory. Previously these lived in a scratch directory and were re-derived from scratch each session, having already caught four real bugs. Each assertion's comment names the real-world failure it guards, and the two functions that live in `popup.js`/`background.js` are sliced out of those files rather than copied, so a rename breaks the suite loudly instead of silently testing a stale duplicate. Not wired into `.github/workflows/run-tests.yml`, which runs pytest against a `tests/` directory that does not exist in this repo — left alone deliberately, since the Python backend is out of scope for extension work.

#### Fixed: captures were never pinned to a common viewport — found by the debug log on its first use

The very first exported debug log showed Control captured at **1693×1281** and all three variants at **1470×802**. The window geometry changed partway through the run, and nothing noticed. On a responsive page that is not a comparison at all — it compares two different layouts — and it fails silently in the worst way: element matching collapsed to 12–14%, all three variants were misclassified as wholesale redesigns, reflow clustering produced a "trusted" 4844px band out of the relayout, and the run still finished and still presented a tidy two-finding result per variant. `captureWidth` had been recorded in the checkpoint since 2026-08-21 and was never once compared against anything.

- Every capture in a run is now pinned to the **first** capture's viewport via `Emulation.setDeviceMetricsOverride`, re-stabilizing after the override since it reflows the page. The override is cleared in a `finally` rather than relying on detach — `withVariantDebugger` reuses an already-attached console-mirror session without detaching it, so an override left behind would follow the user's own tab.
- A residual width mismatch, or a failed pin, is now an **error** in Run Diagnostics and the debug log, worded so the reader knows the findings are suspect rather than clean.
- A redesign verdict is cross-referenced against it: when both are present, the report says the redesign classification is most likely the geometry mismatch rather than a real change, instead of letting a capture bug read as a finding about the experiment.

This is exactly the class of failure the debug log was added for, and it surfaced on the first run — the previous run's 98% match rate had made the whole failure mode invisible.

#### New: exportable debug log + Run Diagnostics section

Prompted directly by how the cascade bug above was found: the report said "180 suppressed as page reflow" and nothing else, which was enough to know something was wrong and not enough to say what — the cause had to be located by rebuilding the page's geometry by hand, offline, from prose in a PDF. The run already had the data; it just wasn't kept.

- **Run Diagnostics** — a new report section collecting every way a run was degraded: pages truncated at the 8000px capture limit, watched selectors that never matched, page JS errors, capped or unclassified findings, redesign-mode fallback, missing spec text. Individually most of these were already mentioned somewhere in per-section prose; scattered and interleaved with findings, they read as incidental, which is how a run with a truncated page and twelve dropped findings can still look clean. A clean run badges CLEAN with an empty table.
- **Download debug log** — a button on the report page exporting the whole run as JSON (blob + `<a download>`, no new permission). Includes per-variant match-tier counts, the derived reflow bands for both axes, per-finding geometry and originating match tier, the unmatched residue, and any fuzzy pairings.
- **The specific thing that was missing:** `movesByDelta` beside `shiftClusters`. A shift amount appearing repeatedly among *reported* moves while having no *trusted* cluster is the exact signature of reflow suppression under-matching — the whole diagnosis, straight off the run. `vdCollectProblems` checks for that pattern itself and writes it into `problems` in plain language rather than leaving it to be noticed.

Severity is about whether the run's output can be trusted, not about how bad the page is: a page JS error is a finding *about the page* and stays `warn`, while `error` is reserved for a page that never loaded, a capture that failed, or a model response cut off mid-JSON.

#### Verified

53 jsc assertions across the engine and the wire adapter, all passing: identity matching (including the critical wrapper-div-insertion case that defeats path-based matching), the full normalization ladder, reflow segmentation and suppression, grouping, redesign-mode rollup, ranking, framework-id rejection, and a 3000×3000 perf guard. Both panel HTML files verified in sync.

Plus an end-to-end regression simulation built from the real page's measured shape — overlapping −35/−58/−68 vertical bands, a horizontally re-wrapping link grid, one link removed and one added, and a planted rogue move. It reduces to **6 findings, every one real**, with 112 vertical and 24 horizontal reflow elements suppressed and the rogue move surviving.

17 further assertions cover the debug log, fed the broken-cascade shape to confirm it names the cause rather than merely recording numbers. The report page itself was rendered in a browser against a stubbed storage record: the button enables, the count line matches the payload, and the click produces a blob download named `selenite-debug-<id>.json`.

#### MEASURE GATE: passed

Third run of the Zapier 4-variant case, with geometry consistent across all four captures (1587px; v3's capture was actively pinned, so the fix demonstrably fired on a real drift):

| | old pipeline (v2 run) | this run |
|---|---|---|
| non-unchanged findings | 11 added / 5 removed / 26 modified / 2 style = **44** | 1–2 added / 1 removed / 2 modified / 4 style = **8–9** |
| unchanged blocks | 3 | 36 |
| element match rate | n/a (semantic blocks) | **99.2–99.6%** |
| reflow suppressed | none — it cascaded into findings | 214–217 |
| cascade leaked as false "moved" | ~25 (v2), ~49 (first gate run) | **0** |

The hero copy swap is finding `f0`/`f1` on every variant, named exactly. `matchTierCounts` is `path+text 257, path 2` — and those two `path` matches are precisely the hero heading and subheadline, which is the copy-change pass doing exactly the job it was designed for. `movesByDelta` is empty on all three variants: the piecewise clustering explains every shift on the page.

**Still open.** All four remaining `style-changed` findings per variant are pixel-backstop only — no named style property fired on any of them, so the deterministic style diff sees nothing and only raw pixels differ. Three vary in ratio across variants; one (a 24×24 icon) is identical to twelve decimal places on all three, which is suspicious but not conclusive: variants sharing a real change against Control is normal in an A/B test, so "identical across variants" does not by itself prove a capture artifact. The plan's own second acceptance test — Control vs Control, expecting zero findings — measures this directly and has not been run yet. Also unchanged: crops still render blank or off-target (the crop fix is a later step, deliberately not attempted here), and the page is 14166px against an 8000px capture limit, so ~43% of it is never compared. The report prompt, crops, and renderer internals remain on the old finding shape via a temporary adapter carrying `changeClass` alongside the legacy `status`.

## 2026-08-21

### Changed

**Gap-fill follow-on to the 2026-08-18 pipeline rearchitecture, closing the gaps it left open without adding a step to the A/B workflow.** The 3-stage design (Sonnet scrape → local diff → Opus report, plus the coarse pixel backstop) is unchanged; this closes real gaps identified against an external gap-fill proposal, corrected against the actual code before building (the proposal's item 4 targeted a block type that structurally can't be pixel-hashed, item 3's pseudocode called `pixelmatch()` on data it didn't have, and two "cheap diagnostic" items assumed a debug affordance that didn't exist — see the approved plan for the full correction).

#### New: hidden diagnostics (`popup.js`, `background.js`, `vd-overlay.js`)

- `window.__vdDebug` — console-only, callable from the panel's own DevTools (right-click the side panel → Inspect). No new storage key, checkbox, or settings surface: a normal user never opens DevTools on this panel, so this is a genuinely zero-footprint hidden affordance.
- `scrapeStabilityCheck(n=3)`: captures the active tab once, then re-scrapes that SAME screenshot/candidate list `n` times (new debug message `vdDebugScrapeStability`) to isolate Stage 1's model non-determinism from capture non-determinism. Reports % of candidates whose block membership changed across passes.
- `showCandidateOverlay()`: draws every `domCandidateWalkFn` candidate as a labeled rect on the live page (new message `vdShowCandidateOverlay`, new file `vd-overlay.js`) for eyeballing leaf-block extraction on real pages. A new sibling file rather than an edit to `picker.js` — that file is a live feature (the step-builder element picker), not overlay scaffolding.
- Also free: `scrapeVisualDiffPage`'s block sort gained an `x` tiebreak (was `y`-only), reducing alignment-destabilizing non-determinism at zero cost. `temperature: 0` was tried on Stage 1's Sonnet call for the same reason but reverted the same day — a real run against a live page showed the API rejects it outright for this model/call shape ("`temperature` is deprecated for this model"), which broke Stage 1 entirely and skipped Visual Diff end-to-end. This model doesn't accept a temperature parameter here at all; determinism has to come from prompt tightening or the other fixes in this entry instead.

#### `domCandidateWalkFn` — two new filters (`background.js`)

- `position:fixed`/`sticky` elements (sticky headers, cookie banners, chat widgets) are now excluded — their rect is viewport-relative, so in a full-page beyond-viewport capture it lands at the wrong document position, and CDP only paints them once at their normal viewport position rather than repeating them down the page.
- Candidates entirely outside the captured page bounds are now dropped — e.g. an off-screen carousel slide that exists in the DOM but was never actually visible at capture time, which previously could generate phantom findings whenever Control and Variant happened to rest on different slides.

#### New: per-block pixel check (`background.js`, `popup.js`) — closes the real capability gap

- New Stage 2.5, `computeUnchangedBlockPromotions` (background.js) + a new per-variant message `pixelCheckVisualDiffFindings`, inserted between `diffPageScrapes` and `rankAndCapDiffFindings` so a promotion can compete for the finding cap. For every Stage-2 `'unchanged'` pairing with a same-sized rect on both sides, compares raw pixels (`makeReadContext` → `getImageData`, no PNG round-trip) and promotes to a new status, `'style-changed'`, when the difference exceeds `VIS_BLOCK_PIXEL_RATIO` (0.02) — the only coverage for a CSS-only regression (wrong background-image, missing box-shadow, color shift) that changes neither text nor position, previously invisible to the semantic pipeline entirely.
- This is a genuinely new per-variant round trip, not a cost-neutral consolidation — said so explicitly rather than presented as free. The coarse whole-page backstop (`computeCoarsePixelDiffRatio`) moved into this same new message (it only needs the two screenshots, already being decoded here), which in exchange lets `reportVisualDiffFindings` shrink to a single, clean Opus call with no `Promise.all`.
- `rankAndCapDiffFindings` ranks `style-changed` below structural changes (modified/added/removed) but above literal `unchanged`. `buildVisualReportPrompt` notes explicitly, for these findings, that text/position are identical and only rendering differs. `VIS_WHOLE_PAGE_RATIO`'s role is demoted (comment-only) to a "something changed broadly enough to look closer" sanity flag now that the precise case has real coverage.

#### New: capture-width recording and two cost/latency reductions

- The checkpoint root and cross-run cache now record `captureWidth` (`base.fullPage.pageW`, already captured, just not previously surfaced) — provenance for cross-run/resume comparisons, where widths can actually drift (never a risk within one run, since every variant shares one capture window by construction).
- Stage 3 (Opus) is now skipped entirely when a variant has zero non-`unchanged` findings (`kept.length === 0`) — `overallSummary` is synthesized locally. The coarse backstop already ran in the earlier pixel-check message, so it's never a casualty of this optimization.
- Control's scrape is now cached across separate runs, not just within one run: a new `chrome.storage.local` key (`visualDiffControlScrapeCache`, TTL ~1hr, keyed by url+width+settle) extends the existing checkpoint-caching machinery rather than introducing IndexedDB — the codebase's existing IndexedDB scaffolding (screenshots/recorded sessions) turned out to be dead code with no working precedent to build on, and `controlScrape` is small JSON, not an image, so the quota pressure IndexedDB exists for doesn't apply. New checkbox **Force fresh Control scrape** (`#ab-force-rescrape-control`, both `popup.html`/`sidepanel.html`, gated alongside the crops toggle) opts out per run; a cache hit is surfaced in the report summary line, never silently load-bearing.

#### Grid reorder pairing — crossing-rejection (`popup.js`)

- Pass 2's reorder recovery (`diffPageScrapes`) now rejects a pairing that crosses an already-established one UNLESS it wins by a clear margin (0.1) over the best order-preserving alternative — ties resolve to document order, which is right far more often than greedy-first for a grid of near-identical siblings. Narrows, doesn't eliminate, the known sibling-mismatch risk the function's own header comment already flagged.
- Caught by writing the test for it before shipping: the first draft rejected a crossing pairing outright whenever no non-crossing alternative existed at all, turning one strong match into a spurious remove+add pair. Fixed to only prefer an alternative when one actually exists AND is competitive — with nothing to lose to, the crossing match is strictly better than leaving both sides unmatched.

#### Stage 2 sweepable thresholds (`popup.js`, `background.js`) — new shared module

- New `extension/vd-config.js`, following the exact `metric-match.js`/`pixelmatch.js` global-attachment convention (loaded via `importScripts` in `background.js`, via `<script src>` in both panel HTML files). Hoists `MATCH_THRESHOLD`/`REORDER_THRESHOLD`/`GAP_PENALTY` (previously function-local consts inside `diffPageScrapes`, not module-level as an earlier account assumed) and `blockSimilarity`'s weights (previously inline numeric literals, not named constants at all) alongside the new pixel-check constants and the existing `VIS_WHOLE_PAGE_RATIO`/`VIS_BAND_HEIGHT_PX`/`VIS_PIXELMATCH_THRESHOLD`/`VIS_PIXELMATCH_INCLUDE_AA`/`VIS_CROP_PAD` (previously scattered `background.js`-only consts). Stage 2 is pure JS with no network call — this is what makes it sweepable against a saved scrape corpus with zero API cost per iteration, once such a corpus exists.

#### First real runs against a loaded extension — four bugs found and fixed across several iterations

The pipeline had never run against a real, loaded extension until today (unchanged caveat since 2026-08-18) — a QA report against a live page (Zapier's homepage, 4 variants), re-run several times as each bug was fixed, surfaced four real bugs within the same session that shipped them:

- **`temperature: 0`** (added above for determinism) is rejected outright by the API for this model/call shape (`` `temperature` is deprecated for this model ``) — reverted. This model doesn't accept a temperature parameter on Stage 1's call at all; determinism has to come from the other fixes in this entry instead.
- **Stage 1's `max_tokens` (now `VIS_SCRAPE_MAX_TOKENS`) was too tight for a real, content-rich page at its old value of 4096.** A run showed Control's own scrape getting cut off mid-JSON (`stop_reason: 'max_tokens'`) — masked by the generic "invalid JSON" error until `runOneScrapeBand` was taught to check `stop_reason` before surfacing that message. Raised to 8192.
- With that fixed, a run reached Stage 2/3 for the first time ever, for 2 of 3 variants — real `style-changed` findings appeared, confirming Stage 2.5's pixel-check promotions fire correctly on a real page, and Opus's classifications read as sound. The third variant's failure looked, from the report alone, like it could still be a Stage 1 problem (same bare "invalid JSON" message) — it wasn't.
- **Stage 3's `max_tokens` (now `VIS_REPORT_MAX_TOKENS`) had the exact same 4096 problem, one call over.** `runOneScrapeBand`'s fix makes it structurally impossible for that function to return the bare, undiagnosed error string anymore — so when a later run showed exactly that bare string again, it meant the failure had moved to `runVisualReport` (Stage 3, Opus) instead, which nothing had touched yet. A variant with up to `VIS_MAX_DIFF_FINDINGS` (60, popup.js) findings needs a `{findingId, classification, severity, note}` for every one of them plus an `overallSummary` — the same cap, undersized the same way, one stage later. Fixed identically: raised to 8192, same `stop_reason`-aware diagnostics added.

Also notable, not a bug: the same live runs' Agentic Testing notes (Sonnet) correctly identified the four variants as an intentional headline/copy test on every pass, and separately flagged a "How did you hear about us?" survey widget shuffling its option order between variants as a likely-unintended side effect unrelated to the test — exactly the kind of judgment call that stage exists for. Also unresolved, not yet a bug: several template-card findings' crop thumbnails rendered blank or showed what looked like the wrong region of the page — flagged for follow-up, not fixed blind, since the actual rect/coordinate data behind them isn't visible from a rendered report.

#### Verified so far — static tests plus the live run above

New jsc functional tests (not committed to the repo — see the 2026-08-18 entry's own note on why; recreated each session) covering: control-vs-control yields zero non-unchanged findings, the 0.45 same-slot-text-rewrite threshold still holds after hoisting into `vd-config.js`, a genuine insertion doesn't cascade into false findings, the crossing-rejection fix (both the bug caught above and the intended margin-based override), `rankAndCapDiffFindings`'s new three-tier ranking, and `computeUnchangedBlockPromotions`'s gating logic (mocked `pixelmatch`/canvas context, since jsc has no DOM/canvas). Deferred: item 4 (pixel signature for weak-text blocks) — the plan's own premise (`blockSimilarity`'s text term is starved by empty `text`) turned out to double-count with `label`, which is always populated; building it needs a real-page check first to confirm labels don't already disambiguate.

Real-page coverage as of today: Stage 2's diff, the new pixel-check promotions, and Stage 3's Opus report have now run for real (2 of 3 variants in the live run above). Not yet exercised on a real page: skip-Opus-on-zero-findings (every real variant so far has had non-`unchanged` findings), the cross-run control-scrape cache, and the crop toggle. One variant's scrape still fails with an unexplained non-truncation JSON error — see above.

## 2026-08-18

### Changed

**Visual Diff's pixel pipeline is fully replaced with a 3-stage LLM pipeline: Sonnet scrapes each page, a deterministic local diff compares the two scrapes, Opus classifies the findings and writes the report.** Requested after watching the pixel/row-hash pipeline (the one hardened by the whole 2026-08-17 punch list, immediately below) struggle with a real, wholesale page redesign — pixel/row-hash alignment inherently fragments a large structural change into noisy region churn, where a semantic, DOM-grounded comparison can describe *what* changed coherently instead. See `VISUAL_DIFF_ISSUES.md`'s new top section and the approved plan this was built from for the full design rationale, cost/capability tradeoffs, and accepted risks.

#### Stage 1 — Sonnet scrape (`background.js`)

- `captureFullPageAndViewport` gained an `extractDomCandidates` option: inside the same attached-debugger session used for the screenshot (not a separate pre-attach `exec()` — the debugger's DevTools infobar reflows the page, so a pre-attach measurement can disagree with what the screenshot actually captured), it now also runs `domCandidateWalkFn`, a new leaf-block DOM walk (via `exec`) — a pure layout wrapper with no text of its own emits nothing and recurses into its children instead, so a card of `<img><h3>…</h3><button>…</button>` yields three leaf candidates, never a fourth for the wrapping div. Capped at `VIS_SCRAPE_MAX_CANDIDATES` (400), broader style capture than the old per-selector check (`backgroundImage`, `border`, `boxShadow`, `opacity` — the only mechanism left, besides the coarse backstop below, that can catch a pure-CSS-looking change).
- New `scrapeVisualDiffPage` message + `VIS_SCRAPE_SCHEMA`: pages at or under `VIS_SCRAPE_SINGLE_CALL_MAX_PX` (4000px — the common case for real landing/marketing pages) cost exactly one Sonnet call; taller pages split into overlapping `VIS_SCRAPE_BAND_PX` bands (run in **parallel**, not sequentially like the old per-variant vision batches — a deliberate latency-over-Stop-granularity tradeoff, since Stop can now only land before/after the whole set of band calls). **Sonnet never reports a pixel coordinate** — it groups DOM candidates by id into semantic blocks (`type`, `label`, `text`, `memberCandidateIds`, `confidence`); `background.js` computes each block's real rect deterministically as the union bounding box of its members' own ground-truth DOM rects, since vision models are unreliable at coordinate estimation.
- `vdState` (per-window Visual Diff state) drops `noiseCaptures`/`noiseMaskCache` (the old baseline-subtraction machinery) in favor of `domCandidates` and a `controlScrape` cache — Control is scraped exactly once per run and reused for every variant.

#### Stage 2 — local diff (`popup.js`, pure JS, no network call)

- New `diffPageScrapes`: a two-pass block alignment replacing row-hash/pixelmatch alignment entirely. Pass 1 is a Needleman-Wunsch global alignment (`needlemanWunschAlign`) over the two block lists in document order — same shape as the old `alignRowHashes` DP, but score-weighted (`blockSimilarity`: 0.5 text-token-overlap + 0.3 type-match + 0.2 position-proximity) instead of binary hash-equality, and at block granularity (dozens per page) rather than hundreds of pixel-row bands. Pass 2 is a stricter, position-agnostic greedy pass (same-type-gated) that recovers blocks a pure reorder would otherwise report as a spurious remove+add pair.
- **Bug caught by the new unit tests before this ever ran for real**: the initial match threshold (0.55) rejected a same-slot, same-type pair whose text was completely rewritten (e.g. a button relabeled "Buy Now" → "Add to Cart") — since text dominates the similarity score, a full content rewrite at an unchanged position scored exactly 0.5 (type + position only), just under threshold, and was reported as a false `removed` + `added` pair instead of one `modified` finding — the exact class of bug the old pipeline's `collapseAdjacentModifiedPairs` existed to prevent. Fixed by lowering the threshold to 0.45.
- Findings carry deterministic `changeSignals` (text-changed, type-changed, moved-vertically, resized) as concrete grounding for Opus, rather than raw text blobs — reduces hallucination risk in Stage 3's classification.
- New `rankAndCapDiffFindings` caps non-`unchanged` findings at `VIS_MAX_DIFF_FINDINGS` (60 — far higher than the old per-image cap of 12, since there's no per-image cost driving it down).

#### Stage 3 — Opus report (`background.js`)

- New `reportVisualDiffFindings` message + `VIS_REPORT_SCHEMA`: one **Opus** (`claude-opus-5`) call per variant — Visual Diff's first use of Opus; every other model in this feature was Sonnet. Input is only the capped diff findings (never the full page scrapes) plus the same ticket-spec-text resolution as before. Same validation conventions as the old `runOneVisionBatch` (findingId filtering/dedup, no-spec-text coercion to `'unclear'`, `stop_reason==='refusal'`/JSON-parse/`max_tokens` handling, the `getPlatformInfo` heartbeat). Also now writes one `overallSummary` narrative per variant, rendered above its findings.
- Bundled into the same round trip: `computeCoarsePixelDiffRatio`, a new, deliberately simple non-AI backstop kept specifically because the semantic pipeline cannot catch a purely-visual CSS regression (wrong background-image, missing box-shadow, z-index overlap) that changes neither text, position, nor the captured style subset. `pixelmatch.js` is **kept** (not removed) for exactly this — no row-hash alignment, no region detection, just a banded whole-page pixel-difference ratio flagged above `VIS_WHOLE_PAGE_RATIO`. Known, accepted limitation: with no alignment, a page with one large inserted/removed block shows a high ratio for everything below that point even if otherwise unchanged — a rough sanity flag, not a regression detector.

#### Stage 4 — crop-image toggle (opt-in, `background.js` + UI)

- New checkbox **Show crop images in report** (`#ab-visual-diff-crops`, both `popup.html`/`sidepanel.html`, mirroring the existing `#ab-record-heatmap`/`#ab-keep-tabs` enable/disable pattern), default on. New `reportVisualDiffFindings`-adjacent message `cropVisualDiffFindings`: when the toggle is on, crops each finding's available side(s) from the already-captured full-page screenshots using the block's own DOM-derived rect (`VIS_CROP_PAD`, smaller than the old pipeline's `VIS_PAD` since a block rect is already tight to real content, not a pixel-diff blob needing centering room). No `yOffset` concept survives — each side's rect is independent and already correct in its own page's space; `yOffset` was purely an artifact of row-hash alignment. Turning the toggle off skips these calls entirely, keeping the report's `chrome.storage.session` payload smaller for large multi-variant runs.

#### Checkpointing / resume

- New per-stage-per-variant granularity: `controlScrape` cached once at the checkpoint root; each variant's entry tracks `status: 'pending'|'scraped'|'done'|'error'|'stopped'` plus `scrape`/`diffAndReport` payloads. A worker restart between Control's scrape and a variant's Opus call resumes at exactly the right step instead of re-paying for work already done. Same `vdCheckpointTx`/`patchVisualDiffCheckpoint` serialized-queue plumbing from the 2026-08-17 fix, unchanged.

#### Report renderer (`popup.js`)

- `rptAbVisualDiffSection` adapted to the new finding shape: derives a `copy`/`layout`/`style`/`other` type label from `status`/`changeSignals` (keeping the same vocabulary the old renderer used), renders each variant's `overallSummary`, a structural-block-count line (added/removed/modified/unchanged), and the coarse pixel-diff note when flagged. The crop-unavailable fallback now branches three ways (toggle off / no DOM-anchored rect on either side / resumed-from-checkpoint) instead of one.

#### What was deleted

The entire row-hash-alignment + pixelmatch region-detection + per-region-vision-batch pipeline: `computeRowHashes`/`alignRowHashes`/`collapseAdjacentModifiedPairs`/`opsToBlocks`/`buildStructuralFindings`, `labelBandComponents`/`stitchBandComponents`/`dilateMaskBand`/`diffBlockBanded`/`subtractNoiseFromMask`/`computeControlNoiseMask`/`getOrComputeControlNoiseMask`, `findChangedRegions`/`rankAndCapRegions`/`unionOverlappingBoxes`/`buildRegionCrops`, `runOneVisionBatch`/`buildVisualDiffPrompt`/`buildVisualDiffContent`/`VIS_DIFF_SCHEMA`/`splitEven`/`planBatches`/`flattenBox`/`stripCropFields`/`stripCropsForCheckpoint`, `captureControlNoiseShot`, and the old `compareVisualRegions` message handler — effectively every fix from the 2026-08-17 punch list below, since that entire pipeline is what it was hardening. `cropToCanvas`/`canvasToDataUrl`/`cropAndDownscale`/`clampBox`/`decodeDataUrl`/`makeReadContext` survive as generic image utilities, now reused by the crop toggle and the coarse backstop.

#### Cost — a real tradeoff, confirmed with the user before implementation

Roughly 2x more API calls than before in the common case (most real pages qualify for Stage 1's single-call mode): a 3-variant run costs about `1 (Control scrape) + 3×1 (variant scrapes) + 3×1 (Opus reports) = 7` calls versus the old pipeline's typical ~3-4, worse (~19 vs ~9) for pages near the 8000px capture cap. Also introduces Opus as a new, pricier model tier — Visual Diff never used it before. Accepted explicitly after the user saw these numbers, alongside the semantic-vs-pixel capability tradeoff (a pure-CSS regression with no text/position change can now only be caught by the coarse backstop, not a precise region).

#### Verified so far — static only, not yet run against a real page

New jsc unit tests for `diffPageScrapes` (pure reorder produces no false adds/removes; a real add and a real remove are both found; a same-slot text rewrite reports as one `modified` finding, not a false remove+add pair — this is what caught the 0.55→0.45 threshold bug above; a grid of near-identical items doesn't throw, documenting the known sibling-mismatch risk rather than asserting a specific pairing) plus a full parse check of both files. The manual end-to-end verification matrix from the approved plan (the real OnDeck redesign from 2026-08-17, the crop toggle on and off, a pure-CSS-only change to confirm the coarse-backstop note actually fires, a Stop-mid-run resume check) has not been run — nothing in Visual Diff has ever been confirmed against the real, loaded extension, the same caveat every entry below already carries.

### Changed — v0/v1/v2 default variant labels, standalone Summary of Changes

**Default variant labels now follow the `v0`/`v1`/`v2`… convention** used everywhere else in the codebase (Initialize's own "+ Add Variant," the ticket-forced-variant-id resolution, `isControl: id==='v0'`), replacing `Control`/`Variant A`/`Variant B`. Four edit sites, each a literal duplicate of the other (not shared): `abDefaultState()`/`cvaDefaultState()`'s default target arrays, and the A/B tab's/Cross-Variant Accessibility's "+ Add Variant" handlers (`'v' + targets.length`, same length-based mechanism as before — not a scan of existing labels). Included CVA since it's the structurally identical pattern, not just A/B.

**Visual Diff no longer requires an Initialize ticket at all.** A new **Summary of Changes** textarea (A/B tab, `abState.summaryOfChanges`, both `popup.html`/`sidepanel.html`) is now the single spec text sent to Opus for every variant's classification, replacing the old per-variant ticket-resolved text — `runVisualDiffPipeline`'s `if (!ctx?.reviewed) return bail(...)` hard gate is gone entirely. When an Initialize ticket *is* active and the box is still empty, `autofillAbSummaryFromTicket()` fills it in (concatenating each variant's already-extracted Test Specifications text via new `buildSummaryFromTicketVariants`) — only when empty, so a manual edit is never silently overwritten; hooked into the same two call sites `checkForResumableVisualDiff()` already uses (`showTab('abtest')`, `initAbCompare()`'s panel-load), so a ticket committed after the A/B tab was already open still populates it on return.

Decoupling this surfaced a real latent bug: `ctx.ticketKey` (no optional chaining) inside the checkpoint-root write would have thrown `TypeError` the moment `ctx` was ever null — previously unreachable since the hard gate guaranteed `ctx` was always present by that point, now a real path with the gate removed. Fixed to `ctx?.ticketKey`. The Control-resolution fallback warning ("Control could not be identified from the ticket…") is also now conditioned on `ctx` actually existing — a standalone run with no ticket at all falls back to the first target the same way, but silently; that fallback is only worth flagging as a warning when a ticket existed and genuinely failed to resolve it.

## 2026-08-17

### Changed

**A/B Variant Comparison's results move to a report tab, matching Test Agent's run → report pattern, instead of rendering live in the side panel.** Requested after live testing of the Visual Diff fixes above surfaced that the side panel's incremental rendering made results easy to misread (see the punch-list entries above).

- `runAbComparison` (`popup.js`) no longer calls `renderAbResults`/renders anything incrementally — `#ab-results` now shows a single status line (`setAbStatus`, mirroring `runTestAgent`'s own `status.textContent` pattern: "Loading variants…" → per-variant progress → "Comparing visuals…" → "Building report…" → "Done — report opened in a new tab."). Once the run (including any Visual Diff pass) finishes, the whole result — Page Basics, Console, selector/metric deltas, and Visual Diff findings with crop images — opens in one new tab, reusing the existing Test Agent report infrastructure (`openReportTab`/`buildReportBody`/`qa-report.html`, the same `chrome.storage.session` + bundled-extension-page pattern already used for the Matrix Auditor's report and Test Agent's combined report — a blob: URL was rejected early on, per the existing comment at `buildReportBody`, since recent Chrome blocks top-level navigation to extension-created blob: URLs).
- `rptAbSection` gained a new `rptAbVisualDiffSection` sibling that renders Visual Diff findings — including the actual before/after crop images — as a report section. This reads from a NEW `entry.data.visualDiffFull` field that the standalone A/B tab populates with the live `runVisualDiffPass` result (crops included); it is deliberately never populated on the Test-Agent-queued path (`getData()` → `_abLastRun`, whose `visualDiff` field stays metadata-only, no images), so crop data still never reaches the AI summarize-results prompt or that combined report — unchanged from before this session.
- A new `fromTestAgent` flag on `runAbComparison`'s options (set only by `TA_MODES['2'].run`) skips opening A/B's own report tab when running as a queued Test Agent mode, since `runTestAgent()` already opens one combined tab at the end of its whole sequence — without this, queuing A/B in Test Agent would pop two tabs for one run.
- `renderAbResults`, `renderAbVisualDiff`, and `abSection` (the live, collapsible inline renderers) are deleted along with the now-dead `_abVisualDiffCrops` map (write-only even before this change — the "click a crop to view full-size" affordance it was built for, `openImageInTab`, was never wired to anything).
- `qa-report.html` gained a handful of small CSS rules (`.ab-line`, `.ab-cline`, `.ab-warn`, `.ab-err`, `.ab-delta`) for the new report section, following the file's own hardcoded-hex + `prefers-color-scheme` convention rather than the side panel's CSS-variable system, which doesn't exist on that page.
- **Scoping decision**: the Interaction Heatmap's "record walk"/overlay controls stay inline in the side panel, not moved into the report. Recording is a live tool tied to currently-open variant tabs (only meaningful with **Keep tabs open** checked) — it doesn't fit a "here's what happened" report the way static findings do, so `renderAbHeatmapBlock` is untouched and still renders into a permanent `#ab-heatmap-block` sibling of the new status line.
- **Known risk, not yet hit in testing**: `chrome.storage.session` (where report bodies are stashed for the new tab to read) has a fixed ~10MB quota not liftable by `unlimitedStorage`. Crop images were deliberately kept out of every report payload until now specifically to avoid this; a run with many regions across several variants could push a single report close to that ceiling, and up to 5 recent reports are kept. If `chrome.storage.session.set` ever rejects for size, `openReportTab`'s throw surfaces as a plain "Error: …" status line — worth revisiting (fewer/smaller crops in the report, or a lower retention count) if it comes up in practice.

### Added

**A/B Variant Comparison got a full-page, AI-powered Visual Diff, built in two passes, plus its own top-level tab.** This entry is deliberately more of a debug log than the usual changelog style — it records what was tried, what broke, and what's still unverified, since this is the largest and most algorithmically involved feature in the codebase.

#### Pass 1 — full-page capture + single-call region diff

- New `captureFullPageAndViewport()` (`background.js`) — full-page screenshot via CDP `Page.captureScreenshot` + `captureBeyondViewport`, no scroll-and-stitch (same technique the old, deleted Visual Regression mode used). `stabilizeForCapture()` freezes CSS animation/transitions and does one bottom→top scroll to force lazy-loaded content to mount before the shot. `withVariantDebugger()` reuses an already-attached debugger session (the console mirror's) instead of throwing when one exists, mirroring the precedent in `clear_session_data`.
- Region detection (`findChangedRegions`, later fully rewritten — see Pass 2) started as a naive 48px-cell pixel grid: flag changed cells, 4-connected-merge into boxes, cap at 6, one Claude vision call per variant with all regions interleaved (`buildVisualDiffContent`, `VIS_DIFF_SCHEMA` for structured output).
- All pixel work (`OffscreenCanvas`, `getImageData`, cropping) runs in `background.js` — the service worker — not in `popup.js`, and not via a separate offscreen document. **This was empirically verified, not assumed**: registered a real `ServiceWorkerGlobalScope` (not just a generic Worker) on a throwaway localhost page and confirmed `OffscreenCanvas.getContext('2d')` → `drawImage` from a decoded bitmap → `getImageData` all work. Load-bearing for Pass 2 too (see below).
- New `#ab-visual-diff-block` in `renderAbResults`'s output, `runVisualDiffPass`/`renderAbVisualDiff` in `popup.js` orchestrate one `compareVisualRegions` message per variant.

#### Pass 2 — rewrite per a revised spec: pixelmatch, alignment, baseline subtraction, batching, checkpointing

A second spec revision replaced the comparison/region-extraction approach entirely. Two independent Plan-agent design passes fed this rewrite; **where they conflicted, the region cap was moved out of `findChangedRegions` entirely** — one design kept a `VIS_MAX_REGIONS` cap inside it, the other needed the full uncapped candidate list to rank correctly, and capping early would have silently discarded regions a better ranking tier should have preferred. `findChangedRegions` now returns every merged box; `rankAndCapRegions` is the only place a cap happens.

- **Row-hash alignment** (`computeRowHashes`, `alignRowHashes`, `collapseAdjacentModifiedPairs`, `opsToBlocks`, `buildStructuralFindings`) runs before any pixel diffing. Rows are hashed in 8px bands (loose, quantized FNV-1a fold — tolerant of antialiasing) and aligned via a plain O(N·M) LCS DP (not full Myers — banding hard-bounds the sequence to ~1000 entries, so the simpler algorithm is fast enough and easier to get right). Insertions/deletions above a height threshold become **structural findings** (text only, no crop, no vision call) instead of shifting every pixel-diffed row below them. **`collapseAdjacentModifiedPairs` exists to fix a real correctness gap**: a plain LCS diff represents an ordinary same-height in-place edit (changed headline text) identically to a genuine structural delete+insert — without collapsing an adjacent delete/insert pair of similar height back into one `'modified'` block, that edit would either get misreported as structural or silently dropped as sub-threshold noise, in both cases *never reaching the vision call at all*. If a real visual change goes unreported, check `VIS_MODIFY_PAIR_TOLERANCE_PX` (24px) first.
- **pixelmatch** (`extension/pixelmatch.js`, new file) replaces the hand-rolled diff loop — vendored verbatim from the real published v5.3.0 (ISC license; confirmed byte-identical to upstream modulo two mechanical edits: `module.exports` deleted, wrapped in the same `(function(g){...})(globalThis)` pattern `metric-match.js` already uses, since `module` doesn't exist in a classic worker). Diffing runs in `VIS_BAND_HEIGHT_PX` (400px) bands via `diffBlockBanded`, with cross-band component stitching (`labelBandComponents`/`stitchBandComponents`, union-find over same-column seam-adjacent components) so peak per-band memory stays ~8MB regardless of page height, versus ~88MB for both images at once in Pass 1's whole-image approach.
- **Baseline subtraction**: Control is captured twice per run (`captureControlNoiseShot`, a lighter capture than the full `captureVariant` — no selector checks, no console injection) and the two loads are diffed against each other (`computeControlNoiseMask`) to build a per-run noise mask, subtracted from every variant's raw diff mask *before* dilation (`subtractNoiseFromMask`) — subtracting after dilation would let a dilated noise blob eat real signal at its edge. **Unvalidated judgment call**: if Control's own reload isn't structurally stable near some point, there's no real "noise pixel range" for that unpaired insert/delete — a `VIS_NOISE_STRUCTURAL_MARGIN_PX` (60px) buffer around the anchor is marked fully-noisy instead. Watch this if a run is silently dropping real regions near a dynamic-but-stable-looking element.
- **Ranking** (`rankAndCapRegions`): 4 tiers — watched-selector overlap, above-the-fold, diff density, area (tiebreak only). **Tier 1 is a heuristic, not a real parse of the ticket's variant description** — no cheap non-vision mechanism exists for that, so it approximates "ticket relevance" via Control-space watched-selector rects (`captureVariant`'s selector `exec()` now also returns `rect`, previously computed-and-discarded for the `visible` flag). When no selectors are configured it's a no-op and ranking degrades to tier 2 — this is the common case, not a fallback edge case. **Known gap**: selector rects are read *before* `stabilizeForCapture`'s lazy-load scroll, so a watched element that only mounts on scroll can read as not-yet-visible.
- **Batching**: up to `VIS_MAX_REGIONS_TOTAL` (12) ranked regions split into up to `VIS_MAX_CALLS_PER_VARIANT` (3) sequential Claude calls (`planBatches`/`runOneVisionBatch`), all inside one `compareVisualRegions` handler invocation — not fanned out as separate messages, so the existing per-variant message contract and Stop-handling (`_visionAbortController`, already aborted by the shared `stop` action) didn't need to change shape. **Deliberate behavior change from Pass 1**: a non-abort batch failure now returns `ok:true` with `batchError` set and whatever regions already classified, instead of failing the whole variant — a network blip on batch 3 no longer discards batches 1-2's paid-for results.
- **Checkpointing**: findings (never crops — enforced once at `stripCropFields`, the single write chokepoint) patch into `chrome.storage.local` (`visualDiffCheckpoints`, one entry per window, guarded by a `runId` so a stale/superseded run's writes can never resurrect an old entry) after every batch. **What "resume" actually means, stated plainly so it isn't oversold later**: closing the side panel kills `runVisualDiffPass`'s loop regardless of where the pixel work happens (popup.js still drives the per-variant sequencing either way), and the full-page captures a resume would need are gone from the worker within ~30s of idle regardless. Resume can only skip re-calling Claude for variants already checkpointed `done` — real savings, not seamless continuation.
- All `VIS_*` calibration constants (row-hash band size/stride/quantization, min in/out block height, modify-pair tolerance, band height, dilate radius, pixelmatch threshold, batching sizes) are **first-guess defaults, not tuned against real pages** — if false positives/negatives show up, these are the first place to look, per the rev2 spec's own "needs real pages, not paper" framing.

#### A/B promoted to its own top-level tab

- A/B Variant Comparison's settings card (`tm2-body` → renamed `ab-body`) moved out of Test Agent's `#ta-mode-homes` into a new permanent `#panel-abtest`, with its own `A/B` tab (short label + `title=` tooltip, matching the `Tracker`/"Metric Tracker" precedent — the tab bar has no wrap/scroll, so long labels double its height). New `ab-agentic-testing` checkbox lets a standalone run enable the Sonnet vision pass without going through Test Agent.
- `TA_MODES['2']` lost its `bodyId`/`homeParentId` (a DOM node can't be in two places) and gained a `renderSlot` — Test Agent's dropdown, "Also Run" batching, and combined-report section (`rptAbSection`, keyed by `builders[2]`) all still work unchanged; selecting A/B there now shows a pointer card back to the A/B tab instead of the settings themselves. Same shape Funnel Crawl has always used.
- **Bug found and fixed during this move**: `taShowPrimary()` did `slot.appendChild(document.getElementById(mode.bodyId))` with **no null guard** — any registry entry without a `bodyId` would throw `appendChild(null)` and silently abort the rest of the function (including `taRenderMultiList()`). Funnel only ever avoided this via a separate hardcoded branch. Fixed with a generic `if (mode.bodyId) … else if (mode.renderSlot) …` — worth checking first if "Also Run"'s checkbox list ever stops updating after selecting a mode.
- **Bug found and fixed**: the Run button was bound as `addEventListener('click', runAbComparison)`, handing the click `Event` straight into `runAbComparison(opts = {})` — harmless only because every field it read off `opts` happened to be absent on an `Event`. Fixed to `() => runAbComparison()` before it could silently break the next option added to that function.
- `showTab('abtest')` triggers a resume-banner check on entry, mirroring the existing Tracker on-entry-refresh precedent, so a run that died while a different tab was open surfaces its checkpoint immediately rather than only on next panel load.

#### Fixed — the 10-item Visual Diff punch list

A code review triggered by "the A/B tab's comparison results are wrong" (crops misaligned between Control and Variant, verdict text not matching what changed) produced a 10-finding punch list, kept in full — original findings plus a per-item note on what was actually done — in `VISUAL_DIFF_ISSUES.md`. All 10 are now fixed. The ones that plausibly explain the reported symptom:

- **Padded crop boxes could bleed into a neighbouring block.** `diffBlockBanded` clamped the `VIS_PAD`-expanded box only against the whole image, never against the block it came from. A neighbouring block can carry a different `yOffset` (its own control↔variant vertical shift), so a box whose padding reached into one got cropped on the variant side with the wrong shift — Control and Variant crops for a single region showing unrelated parts of the page. **This is the most likely cause of the "misaligned crops" report.** Boxes are now clamped to `block.aY0 … block.aY0 + blockH`, using the shorter side so the variant-side crop stays inside the block too.
- **A height-mismatched `'modified'` merge silently swallowed the taller side's tail.** `collapseAdjacentModifiedPairs` merged a delete+insert pair differing by up to `VIS_MODIFY_PAIR_TOLERANCE_PX` (24px), but `diffBlockBanded` clamps to `min(aHeight, bHeight)` — so on any text reflow, the taller side's last ~24px was never read, diffed, or cropped. The merge now claims only the shared-height prefix and emits the tail as its own insert/delete op. (It lands under `VIS_MIN_INOUT_BLOCK_PX` and is dropped as an artifact, same as any other sub-threshold structural block — but it's now explicitly accounted for rather than falling outside every block.) This forced a companion change in `computeControlNoiseMask`: the unconditional ±`VIS_NOISE_STRUCTURAL_MARGIN_PX` (60px) noise band would now fire on ordinary jitter and blank 120px of the page per occurrence, so the full margin applies only to blocks `buildStructuralFindings` would also consider real.
- **Two disagreeing answers to "which target is Control."** The deterministic sections always treated `captures[0]` as the baseline and printed `Baseline: X`; Visual Diff resolved Control independently from the ticket's forced-variant-id convention and printed `Visual Diff vs Y`. Nothing sorted Control to index 0 — "Fill from ticket" populates targets in `ctx.previewLinks` order — so one panel could name two different baselines. `runAbComparison` now moves the ticket-resolved Control to index 0 before rendering, so one resolution governs both.
- **Self-contradicting "No visible differences detected."** Hardcoded whenever there were zero boxes, even with structural findings present — so a variant that only adds a content block showed that line directly above "The variant adds ~200px of content around y=1200". Both the handler and the renderer's separate copy of that sentence now check `structuralFindings`.

The rest, lower odds of being this specific symptom: the noise mask anchored an insert block in the *second* Control capture's coordinate space while indexing a mask sized in the first's; region indices were offset by `batchStart` twice, corrupting the checkpoint's one mechanism for correlating a resumed finding back to its region; a failed batch still recorded the variant `'done'`, so Resume permanently skipped the un-run batch's regions (now `'partial'`); Stop used `continue` rather than `break` and always finalized the checkpoint `'completed'`, meaning the one interruption a user controls got none of the checkpointing feature's benefit; `_visualDiffCaptures`/`_visualDiffNoiseMaskCache` were unscoped module state that a second side panel's run would wipe mid-comparison (now keyed by `winId` via `vdState`); and checkpoint writes raced between `popup.js` and `background.js`, each doing an unlocked get → mutate → set on the same blob (all mutations now run in `background.js` through one serialized queue, `vdCheckpointTx`, with `popup.js` sending messages).

#### Not yet verified

Neither the original feature nor the 10 fixes above have run against the real, loaded extension — `chrome://extensions` and `chrome-extension://` pages are outside the environment this was built in (a hard sandbox boundary, not a workaround-able gap). Verification so far is static only: JS syntax checks on every file, the two hand-synced HTML files diffed to confirm only pre-existing cosmetic drift survived, the row-hash alignment's LCS backtrace hand-traced against a synthetic insertion case, and — for the punch-list fixes — a jsc unit test over `collapseAdjacentModifiedPairs`/`opsToBlocks` covering both delete/insert orderings, both taller sides, past-tolerance pass-through, and contiguous block tiling. The acceptance criteria in the rev2 spec (control-vs-control yields zero regions after subtraction; an inserted banner reports as one structural finding, not a full-page diff; etc.) still need a real run.

## 2026-07-17

### Changed

The Test Modes tab is retired. Every capability it held either relocated or was folded into an existing feature — no engine (`runVariantComparison`, `performWcagAudit`, `runPerfMode`/`runPerfMeasurement`, `runCrossVariantAudit`, `runVisualCapture`/`captureFullPage`, `recorder.js`, `sessionShowOverlay`) changed behavior; this was a relocation/wiring pass.

- **Build tab renamed "Functional Testing"** (display label only — `panel-build` and its element ids are unchanged).
- **Visual Regression** moved into the Functional Testing tab as its own accordion (`#acc-vr`), alongside the function queue. Same ids, same pixel-diff logic (`vrDiffImages`), same IndexedDB baselines — only the DOM host moved. `#testmode-sub-3` is gone.
- **Cross-Variant Accessibility** is now a first-class Test Agent mode (`TA_MODES['5']`), selectable in the **Test Mode** dropdown and batchable via **Also Run**, with its own report section. Its settings UI was wrapped in a new `#tm5-body` (mirroring the existing `tm2-body`/`tm4-body`/`tm6-body` pattern) so Test Agent can reparent it the same way. The standalone **Run Cross-Variant Audit** button stays inside `tm5-body` (same convention as A/B's and WCAG's own inline run buttons — hidden via existing CSS while parked in `#ta-settings-slot`).
- **A/B Variant Comparison** gained an opt-in **interaction heatmap**: with **Keep tabs open** checked, a new **Record interaction heatmap** toggle lets the tester record a walk on each kept-open variant tab (via the retained `sessionRecordStart`/`sessionRecordStop`/`recorder.js` pipeline) and view it as a click/scroll overlay (`sessionShowOverlay`) per variant. Off by default; a normal A/B run is unaffected. Recordings live in memory only for the current run.
- **Session Replay's timeline and saved-sessions browser were dropped** (`sr-session-list`, `sr-viewer`, filter buttons, and their rendering code) — that review UI is no longer wanted. The underlying recorder and overlay-drawing engine survive as the mechanism behind A/B's new heatmap.
- **Mode 1 (Functional Testing Mode)** and the whole Test Modes shell — `#testmodes-menu`, `#testmode-sub-1`..`7`, `#panel-testmodes`, the `testmodes` tab, `btn-run-all-report`/`runAllModesAndReport()` (the old 7-mode combined report) — are deleted. The Test Agent tab's own report (`runTestAgent()` → `buildFullReportHtml`) covers the modes that moved there.
- The four reparented mode bodies (`tm2-body`, `tm4-body`, `tm5-body`, `tm6-body`) now live permanently in a new hidden `#ta-mode-homes` inside the Test Agent panel (each mode's `homeParentId` in `TA_MODES` points there) instead of a Test Modes subpage — `taShowPrimary()`/`taMoveBodyHome()` needed no logic change, just updated `homeParentId` values.
- Dead code removed along the way: `showTestModeSub()`, the old standalone `srShowOverlay()`/timeline/session-browser functions, `rptQueueSection`/`rptSrSection` (both now unreachable), and `runQueueAndWait()` (its only caller was `runAllModesAndReport`).
- All markup changes were applied to **both** `popup.html` and `sidepanel.html` — the two hand-synced UI files that share `popup.js` (`sidepanel.html` is the actual side-panel per the manifest's `side_panel.default_path`). They keep cosmetic CSS differences but must stay structurally identical, since `popup.js` targets the same element ids in both.

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
