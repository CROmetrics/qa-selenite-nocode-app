# Selenite — No-Code QA Runner

A Chrome extension for building and running QA test scripts directly in your browser — no code required. Selenite lets you build a queue of browser automation steps in a side panel, or in a window floating over the page, save and reload scripts, and watch execution logs in real time.

## Features

- Side panel or floating window — build and run test queues beside the page, or unpin Selenite to float over it so the page keeps its full width
- Visual step builder — add, reorder, and remove automation steps
- Element picker — click any element on the page to capture its CSS selector
- Metrics section — define the metric values that fire in the browser output (often prefixed `[PJS]` or `[cro]`) and assert them during runs with the **Track Metric** step
- Save and load named scripts (stored in Chrome sync storage)
- Universal delay override — set a single delay across all steps
- Two execution modes: **close after run** or **loop continuously**
- Tab targeting: run on the **active tab** or open a **new tab**
- Console tab — a live step-execution log with INFO / WARN / ERR filtering, plus a live mirror of the captured tab's browser console (or, on a BrowserStack Live tab, the device's) with a CRO (`[PJS]`/`[cro]`) filter, a JavaScript command input, and **Quick Commands**: one-click buttons for the Optimizely, Convert, AB Tasty and other platform debugging commands QA runs all day
- Visual Regression — full-page screenshot baselines per URL with pixel diffing, ignore regions, and a mismatch threshold (Functional Testing tab)
- **Test Agent** tab — run WCAG, Performance, Funnel Crawl, or QA Pass one at a time, batch WCAG and Performance together via **Also Run**, and get a single combined report with an optional AI-written summary
- **A/B** tab — load each experiment variant once and diff page state, metric fires, and tagged console output against control, with an optional per-variant interaction heatmap, an AI-powered full-page visual diff, and a WCAG audit of every variant diffed against control (introduced / resolved / pre-existing)
- **BrowserStack Live** (A/B tab and Functional Testing's Target) — open any variant, or a queue's start URL, on a real iPhone, iPad or Android device, or in Safari, Edge or Firefox, in your own BrowserStack Live session, optionally through BrowserStack Local so the device can reach staging pages, and Selenite tells you what Live actually did with the launch
- WCAG / Accessibility mode — full WCAG 2.2 audit (heuristics + axe-core) with region scoping, check presets, click-to-highlight findings, JSON export, and per-URL run history
- Performance/Load mode — median page-load metrics (TTFB, FCP, LCP, CLS, long tasks, resources) over N runs, checked against Core Web Vitals budgets, with per-URL history
- Funnel Crawl — an AI agent clicks through Start → Middle waypoint(s) → End to verify a funnel actually connects
- QA Pass (Test Agent) — checks the active ticket's preview links in this Chrome: which variation each link serves, Control vs PROD, the snippet's goals, softcoded and concurrent tests, audience exclusions on the ITW link, a clipping sweep over 18 widths (desktop, emulated iPhone and Android), and metrics firing on load; explains results with Opus and, after you click Apply, writes statuses and notes to the QA test plan in Google Sheets
- **Test Agent engine** for the Function Queue — each step still runs from its saved selector first; when a selector no longer finds anything, an AI agent does that one step by looking at the page, and the run opens a report that lists every heal as a finding. Two steps are the agent itself: **Navigate to (Test Agent)** (the funnel crawl as one step) and **Prompt Function** (type an instruction; the agent carries it out)
- Agentic Testing (Sonnet) and Agentic Analysis (Opus) — optional AI-powered vision judgment and result summaries via Anthropic's API
- Stop execution at any time

## Version History

Feature changes by release, newest first. [`CHANGELOG.md`](CHANGELOG.md) has the reasoning behind each change and the evidence it was built on. The version is shown in the footer of the panel and is read from `extension/manifest.json`.

### 0.7.23 — 2026-10-26

**Test Agent**
- **Email Check**, a new mode. For a ticket's email proofs it checks the subject, preview text, sender, From and Reply-To, personalisation tokens, conditional content, body copy and alt text against the copy doc, resolves each Pardot tracked link once to check its destination and UTMs, reads the DKIM and spam results, and shows the Email on Acid renders. Mailtrap is read through your own signed-in session; Selenite never signs in, and never opens unsubscribe or view-in-browser links. Deterministic code decides every status; Opus only writes the analysis. After a run you review a proposal, and only **Apply** writes statuses and notes to the EMAIL test plan. Setup and limits are under [Email Check](#email-check).
- Google sign-in now also asks for read-only Google Docs access, for the copy doc. Enable the Google Docs API in your Cloud project and click **Connect Google** once more; QA Pass keeps working with the old token until then.
- QA Pass finds a test plan's vocabulary tab by the exact name `Values` first, then by a tab whose name contains "Values".
- Needs an extension reload: the worker code loads only then.

### 0.7.22 — 2026-10-22

**Test Agent**
- **QA Pass**, a new mode. It checks the active ticket's preview links in this Chrome: which variation each link serves, Control against PROD, the snippet's goals, softcoded and concurrent tests, audience exclusions on the ITW link, a clipping sweep over 18 widths, and metrics that fire on load. Deterministic code decides every status; Opus only groups bugs, asks PGM questions and maps test-plan rows. After a run you review a proposal, and only **Apply** writes statuses and notes to the QA test plan in Google Sheets. Setup, the exposure rule and the fresh-visitor rule are under [QA Pass](#qa-pass).
- Clicking the Test Agent tab while it is already showing, or a Funnel Discover Path crawl that finishes after you switch modes, no longer wipes the shown mode's settings.
- Needs an extension reload: the new `identity` permission and the worker code load only then.

### 0.7.21 — 2026-10-16

**Test Agent**
- **Agentic Analysis**, the AI-written summary in the Test Agent report, now runs on Claude Opus 5, the same model as the Visual Diff report. It was still on Opus 4.8.

### 0.7.20 — 2026-10-16

No change to the extension. The tests now cover the debug logs recorded since mid-September, including starz.com (STRZ-1658) as a sixth site.

### 0.7.19 — 2026-10-14

**Function Queue**
- **Prompt Function** instructions are at most 120 characters. The box stops typing at 120 and shows a counter; a queue saved or imported with a longer prompt is refused before any step runs, with the step named and the length given (never the prompt itself).

### 0.7.18 — 2026-10-14

Brings in `main`'s Test Agent queue (released on `main` as 0.7.7) alongside the BrowserStack releases below.

The Function Queue can run through the Test Agent: a step whose selector no longer finds anything is done by an AI agent, and the run opens a report that lists every heal as a finding.

**Function Queue**
- **Engine: Classic / Test Agent** beside Execute. Classic is unchanged. The Test Agent runs each step from its saved selector first and takes over only a step whose element was not found (at most 5 a run). A heal is a finding, never a pass.
- **Navigate to (Test Agent)** and **Prompt Function** are two new steps that are the agent itself. Prompt Function is a typed instruction and a delay, nothing else. **Open as Function Queue** in the Funnel Crawl card builds a queue from a funnel's waypoints.
- A Test Agent run opens a report. Exports carry labels, statuses and URLs without their query, and never a Fill value, Prompt or Notes text.

**Found**
- **A step whose element does not exist has always passed in Classic.** Chrome swallows the error the page throws. Classic's result is unchanged (it now says so in the Console); the Test Agent engine treats the step as failed.

**Funnel Crawl**
- A `type` action now records whether the text landed.
### 0.7.17 — 2026-10-14

**BrowserStack Live**
- **Fixed:** for a few seconds while a Live tab loaded, Browser Console could name the session by the tab's own address ("mirror live.browserstack.com's console", or the whole launch link, your page's address in it). The address is no longer taken as a device name.

### 0.7.16 — 2026-10-14

**BrowserStack Live**
- **Fixed:** in the last minute before Live closes an idle session, it retitles the tab "60 seconds to session timeout", "59 seconds…", and Browser Console used that as the device's name ("mirror 37 seconds to session timeout's console"), as did the label on device console lines. The device keeps its name now.

### 0.7.15 — 2026-10-14

**A/B**
- **Fixed:** JS errors a variant throws while its page is still loading (and promises it rejects then) were missing from its errors; only errors after the page had loaded were recorded. They are now caught from the moment the page starts loading, like console lines in 0.7.14.

### 0.7.14 — 2026-10-14

**A/B**
- **Fixed:** console lines a variant logs while its page is still loading (a `[PJS] variation applied` from a snippet in the page's head, say) were never captured; only lines logged after the page had loaded were. They are now caught from the moment the page starts loading.

### 0.7.13 — 2026-10-13

**BrowserStack Live**
- **Fixed:** when Live's DevTools broke ("Developer tools have experienced an unexpected issue. Please try a new session."), Browser Console said "Open DevTools in the Live session" for 30 seconds and then "Can't read this version of Live's DevTools", and a command said the page had no script context. It now says Live's DevTools failed, in Live's words, as soon as Live shows the notice, and a command gives the same reason.

### 0.7.12 — 2026-10-13

**BrowserStack Live**
- **Fixed:** on an iPhone 17 (iOS 26) Browser Console said it was mirroring the device and enabled the command input, but Live's Chrome DevTools was attached to an empty Safari tab (about:blank), not the page under test, so nothing could be read and every command failed with advice to reload. The status line now says DevTools is on an empty tab and keeps the input disabled. It switches to mirroring by itself if a page ever comes up. Android devices are unchanged.

### 0.7.11 — 2026-10-09

First test of 0.7.10 on real BrowserStack Live with the extension itself; it held up apart from the two things below.

**BrowserStack Live**
- **Fixed:** the status line went on saying "running" after you stopped the session in Live, or Live dropped it, more than 40 seconds in. Selenite now keeps checking a running session every 5 seconds, until it ends, the tab is closed, or 4 hours pass.
- **Changed:** **Open Live and pick the device myself** no longer promises that the device you pick starts with Local. On one Chrome profile it did, on another it didn't, so the line now tells you to check that the page loads on the device, and to look at Live's Local Testing panel.

### 0.7.10 — 2026-10-08

BrowserStack Live launches report what Live did with them, instead of announcing success when the tab opens. Found on real Live sessions (an iPhone 18 Pro, iPhone 17, Galaxy S26, Pixel 10, an iPad Pro, a Galaxy Tab and four desktop browsers).

**BrowserStack Live**
- **The status line follows the session.** After a launch it says whether Live started the device, refused it with its own words ("Device is temporarily disabled…"), dropped it after it had started ("Connection to the remote device failed…"), or started it **without Local**. It also says when you closed the Live tab, or when Live sent the tab to a sign-in page (and then follows the session if you sign in and it starts). It no longer says "through BrowserStack Local" because the tab opened.
- **One odd reading changes nothing.** A refusal or an end is reported only when two readings a second apart agree, and an error toast Live raises while a session is running (a recording that wouldn't start, say) is not treated as the launch failing. Once a session has started, "ended" also waits for the device picker to be back on screen, because Live takes its toolbar away for a few seconds early in a session (measured on iOS 27 and on desktop browsers). The A/B tab and Functional Testing each keep their own report, so a launch from one never overwrites the other's.
- **Local is only reported once Live can say.** A phone's tab says it is running 5 to 10 s before Live records whether Local was on, so the status line says "running" and nothing about Local until the session toolbar is up; it no longer shows the "started without Local" warning in that gap.
- **Local is checked where Live checks it.** The check asks the Local app's own port (`127.0.0.1:45691`, which Live polls every two seconds) as well as its console. A signed-in app that Live can't see is now reported as not connected, where it used to pass as running.
- **Started without Local.** On the account this was measured on, Live starts a session about a second before its own check finds the Local app, so `localhost`, staging and VPN pages show BrowserStack's "Unable to connect" page. Selenite says so and offers **Open Live and pick the device myself**: Live opens with Local and the page ready, and you pick the device once Live shows Local connected (in 0.7.11 this stopped promising that the device starts with Local).
- **All traffic through this Mac** is only a request. Live does not apply it from a link, and Selenite says when it didn't; you can switch it on in the session's Local panel (it reconnects the session).
- **iPhone 17** now opens (it was refused every time at iOS 26.1; it opens at 26).
- **Console mirror, the real states.** No DevTools on iOS 27, on desktop browser sessions or on some Android devices: the status line says so in Live's words, and the checklist marks the iOS 27 and desktop presets. A DevTools frame with no device behind it reads as attaching, not connected. On an iPhone or iPad Live's DevTools item opens a menu; choose **Chrome DevTools**, the only one Selenite can read.
- **Fixed:** the device's name in the status line was "Dashboard" once Live renamed the tab. A Live tab that was still loading when Selenite first looked at it was never followed, so its console mirror never started.

### 0.7.9 — 2026-10-07

**A/B**
- **Fixed:** a variant's tagged console lines (`[PJS]`, `[cro]`) now reach the capture. They never had, so every A/B run showed an empty console per variant.
- **Changed:** console lines no longer count toward the badge. A variant that logs its own variation line is working, and the lines differ run to run. Page basics, watched selectors and metrics still do.

### 0.7.8 — 2026-10-07

Browser Console mirrors a BrowserStack Live device.

**Browser Console**
- **The device's console.** On a Live tab on an iPhone or Android device, Browser Console shows the device's console, labelled with the device, instead of the Live page's own. It reads Live's DevTools, so open it in the session first; what the device logged earlier is replayed.
- **Commands run on the device.** The command input and Quick Commands answer from the phone. `$click` and `$hover` don't work there.
- **Fixed:** the feed no longer drops lines that arrive in a burst, and no longer freezes at 1,000 lines.

### 0.7.7 — 2026-10-06

Open an A/B variant, or a queue's start URL, on a real phone, tablet or another desktop browser in BrowserStack Live, through BrowserStack Local.

**A/B**
- **Devices — BrowserStack Live.** A new section under the A/B card. Tick the browsers and devices you QA on, grouped Desktop, Mobile and Tablet, and each gets a button per variant that opens that variant's URL in your own BrowserStack Live session. No more pasting preview links into a Live session's console.

**Functional Testing**
- **Cross-browser — BrowserStack Live**, in the Target section. A button per ticked device opens the queue's start URL (the Open URL step, with its parameters and QA Mode) in Live, so you can walk the steps on that device. Execute still runs the queue here. The device selection is the same one the A/B tab uses.

**BrowserStack Local**
- **Through your Mac.** On by default, so the device can reach staging, VPN and allowlisted pages. With **All traffic through this Mac**, its visits also come from your IP, as an IP-targeted QA audience needs. You start the BrowserStack Local app, and Selenite checks it's running and signed in before each launch.

### 0.7.6 — 2026-10-06

Two Selenite windows can pick elements at the same time, and closing the tab you're picking in ends the pick.

**Element picker**
- **Picking in two windows at once.** Each window's pick now fills its own step. Before, a click in one window's page could fill the other window's step and leave the first stuck on "…". This holds even if you drag the tab to another window mid-pick. It needs the extension reloaded in `chrome://extensions` after you update.
- **Closing the tab during a pick** gives the 🎯 button back.

### 0.7.5 — 2026-10-06

Esc cancels the element picker from Selenite, and a pick no longer gets stuck.

**Element picker**
- **Esc in Selenite cancels a pick.** After you click 🎯, the keyboard stays in Selenite, so in 0.7.4 Esc worked only after you clicked into the page. Now Esc in Selenite closes the picker on the page and gives the 🎯 button back. If Settings is open, the first Esc closes Settings.
- **Clicking 🎯 on another step during a pick** ends the first pick and starts the new one. Before, the first button stayed on "…", and the next click on the page could fill the wrong step, or both.
- **Reloading or leaving the page during a pick** gives the 🎯 button back.

### 0.7.4 — 2026-10-06

Esc cancels the element picker.

**Element picker**
- **Esc gives the 🎯 button back.** Pressing Esc closed the picker on the page, but the step's 🎯 button stayed disabled, showing "…", until Selenite was reopened. Esc now cancels the pick and the button comes back. The page has to have keyboard focus for Esc to reach the picker.

### 0.7.3 — 2026-10-06

Accessibility moved into the A/B run, and Selenite can be unpinned to float over the page instead of docking beside it.

**Window**
- **📌 unpins Selenite into a floating window.** Selenite still opens docked in Chrome's side panel. Press 📌 to unpin it into its own window over the right side of Chrome; the toolbar icon (or Alt+Shift+S) then opens it there until you press 📌 again. The docked panel takes its width out of the page, so pages reflow while it's open and are captured narrower than their window. While Selenite floats, the page keeps its full width and captures are taken at the window's width, so they will differ in width from earlier runs. Move or resize the floating window and the next one opens the same way.
- **Switching reloads Selenite**, so 📌 waits until a run has finished, and Selenite reopens on the tab you were on.

**A/B**
- **Accessibility audit.** A new option, on by default, runs the WCAG audit (all 19 checks plus axe-core) on each variant in the same page load as its capture. The report gains an **Accessibility (WCAG)** section after Visual Diff with the detail of a standalone WCAG report: every check with its criteria and each page's status, every issue each variant introduced or resolved, Control's full audit, the manual review items, and an Agentic accessibility review of the screenshots. A variant the platform says was not served its variation is marked not compared, and the section cannot PASS while one is.

**Test Agent**
- **Cross-Variant Accessibility is gone.** It ran the same audit against the same variants, with its own target list and a second load of every page. The WCAG / Accessibility mode is unchanged and still audits a single page.

### 0.7.2 — 2026-10-05

Test Agent reports and debug logs say what actually ran, and no report cover prints a forcing link.

**Test Agent**
- **A mode that fails is reported as FAILED.** A WCAG, Cross-Variant or Performance run that failed used to be reported with that mode's previous result, of whatever page it covered, as if it had just run, or, with no earlier result, lost the report while the status line said it had opened. The report now shows the mode as FAILED with its error, and the status line says what happened.
- **Agentic Testing works on WCAG.** Its screenshot clashed with the Browser Console's own connection to the tab, so it failed whenever the console was following that tab (the default), with a message blaming DevTools.

**QA report**
- **The cover lists pages, not links.** On five of the six sites tested so far the forcing parameters stay in the URL, so covers printed one link per variant carrying `optimizely_force_tracking=true`, which registers a tracked visit for anyone who pastes it. The cover now shows each page once, without its query string; the Page Basics table still has every variant's exact URL. WCAG, Cross-Variant and Performance reports now list their pages at all, instead of "No page URLs recorded."
- **WCAG and Cross-Variant say how the audit ran.** A scope that matched nothing no longer reads "Scoped to …" (the whole page was audited), and a Cross-Variant variant audited without axe-core or across the whole page is noted, as in the panel.

**Debug log**
- **WCAG, Cross-Variant and Performance runs are in it.** Each has its own section with the page, every check or measurement, and when it finished, and `problems` names what degraded the run. The A/B tab's settings appear only on A/B runs.

### 0.7.1 — 2026-10-02

Three fixes found on STRZ-1658: two in Visual Diff, one in the QA report.

**Visual Diff**
- **Sticky elements are compared whichever edge they are anchored to**, not only top or left. 0.7.0 still skipped bottom-anchored ones on the belief that a full-page capture paints them somewhere else; measured, it paints every sticky element exactly where the comparison reads it. STRZ-1658's hero and plan picker are one bottom-anchored sticky block, so on 0.7.0 they still read as missing from the variant and Control's plan picker as "removed". Fixed elements (chat widgets, cookie banners, slide-out menus) are still excluded, and the run's notes say so.
- **A spec section written for two variants is checked against both.** A ticket section headed "V2 and V3:" used to count for v2 only, so v3 was checked against almost none of its copy. A line that lists each variant's copy ("v2: … v3: …") now gives each variant only its own.

**QA report**
- **A required string that Control has and the variant correctly dropped is no longer called unchanged.** When the spec quotes the copy it replaces, the copy line now says so instead of "the old copy did not change".

### 0.7.0 — 2026-10-02

One big update: the Console gets Quick Commands and a layout that holds still, the QA report stops being lost to a storage quota, and Visual Diff stops discarding sticky blocks.

**Browser Console**
- **Quick Commands** — 28 one-click buttons in four tabs (Optimizely, Convert, AB Tasty, General) for the commands the team otherwise pastes from a text expander. Buttons that need a value fill the command input for you to finish instead of running blind, opt-out and debug-flag buttons rewrite the URL in one click, a button reports `✓ Ran` or the reason it failed, and **+ Add** saves your own commands. See [Console](#console).
- **The CRO filter keeps your own commands.** With CRO on, the feed shows `[PJS]`/`[cro]` lines *and* every command you ran and what it returned, so a button press no longer looks like it did nothing.
- **The tab holds still.** The command input now sits directly under the feed, the feed is 60% of the panel and scrolls inside itself, Quick Commands is the same size on every tab, and nothing else in the Console tab scrolls.
- The popup's height cap is raised from 600px to 720px (Chrome may clamp extension popups below that; the side panel is unaffected).

**QA report**
- Reports are stored in IndexedDB instead of session storage. A large multi-variant Visual Diff report used to be lost to `Session storage quota bytes exceeded` after a run had already finished. The five most recent reports are kept; a report tab left open from before the upgrade shows "Report data not found".

**Visual Diff**
- Sticky elements anchored at the top or left are now compared instead of skipped. A page whose whole hero or header is one sticky block used to read as missing content in the variant, with identical crops for variants that differ only inside it. Fixed and bottom/right-anchored sticky elements are still excluded, and the run's notes say so.

### 0.6.6.2 — 2026-09-21

- **A/B Variant Comparison is no longer a Test Agent mode.** It is gone from the **Test Mode** dropdown and the **Also Run** list; the **A/B** tab is the only place it is configured, run and reported from.

### 0.6.6.1 — 2026-09-18

- **Funnel Crawl hardening.** A failed segment now names what stopped the agent (a consent or CAPTCHA wall, a login or payment gate, a truncated or refused model call) instead of reporting only that it did not arrive; clicks are converted from screenshot to page coordinates correctly and the viewport is allowed to settle before the first capture; native `<select>` dropdowns are handled; the step budget was replaced by time bounds; every Anthropic call shares one retry.

Earlier versions: see [`CHANGELOG.md`](CHANGELOG.md) and `git log`. The version number first appeared in the panel footer at 0.5.0.

## Installation

1. Clone or download this repo.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (top right toggle).
4. Click **Load unpacked** and select the `extension/` folder.
5. Click the Selenite icon in the toolbar (or press Alt+Shift+S) to open Selenite in Chrome's side panel. 📌 in its header unpins it into a floating window, which leaves the page its full width.

## Usage

### Building a Queue

1. Open Selenite by clicking the extension icon.
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

**Cross-browser (BrowserStack Live)** — the Target section's **Cross-browser — BrowserStack Live** block opens the queue's start URL on another browser or a real device in BrowserStack Live. The start URL is the Open URL step's URL, with its parameters and QA Mode. Tick the browsers and devices you QA on (Desktop, Mobile, Tablet) and click one to open it. Live can't run the steps, so walk them by hand on the device; **Execute** still runs the queue here. A device can't be opened while the Open URL step's URL is blank. The selection, the BrowserStack Local check and both toggles work as in the A/B tab's Devices section (see [A/B Variant Comparison](#ab-variant-comparison)), and are shared with it.

#### Engine: Classic or Test Agent

The **Engine** setting in the Target section chooses how a failing step is handled.

- **Classic** (default) runs every step by its saved selector and stops at the first error, exactly as before. Nothing leaves your machine.
- **Test Agent** runs each step the same way first. When a step fails because its selector no longer finds anything (`... not found`, or Autofill matching no fields), an AI agent (Sonnet) does *that one step* by looking at the page, then the queue goes on. It never takes over a step that failed for another reason (a disabled button, a form that does not exist, a page that navigated away), and never a step that is not a click, fill, submit, autofill or dropdown. At most five steps are healed per run, and the first heal that fails stops the queue.
- A **Test Agent** run opens a report. A step is **PASSED** only when its own saved selector worked. A **HEALED** step is a finding: the saved step is out of date, and the report names the control the agent used so you can update the selector. **HEALED · UNVERIFIED** and **DONE · AGENT-REPORTED** mean the agent says it did the step and nothing measurable confirms it; they are never counted as passed.
- It needs an **Anthropic API key**. Screenshots, any **Fill** text, **Notes** and **Prompt** text go to Anthropic when the Test Agent is used; a report never contains them.
- It cannot run with **Loop continuously**, which has no end to report on.
- **Classic and a missing selector.** In Chrome a step whose element does not exist does not fail: the page swallows the error, so Classic goes on to the next step (it now says so in the Console with a `⚠`). The Test Agent engine treats the same step as failed and hands it to the agent.

**Navigate to (Test Agent)** takes a URL and optional notes, and gets the tab there by clicking the page's real UI, the way Funnel Crawl does. It passes when the tab arrives (host and path). **Prompt Function** takes a free-text instruction of up to 120 characters and runs it where it sits in the queue. It has the instruction and the step's usual **Delay (s)**, and nothing else. The box stops at 120 and counts as you type; a queue saved with a longer prompt is refused before any step runs, naming the step. Nothing measures what a free-text instruction asked for, so a finished step reads *done (agent-reported)*, never *passed*. A queue that contains either step always runs on the Test Agent. In the Test Agent tab, **Open as Function Queue** turns a funnel's waypoints into a queue of these steps, so other steps can sit between them.

### Tracking Metrics

1. Open the **Metrics** section at the top of the Functional Testing tab and click **+ Add Metric** for each console value you want to track (e.g. `Tagging: hero_cta_click`). Metrics persist across sessions.
2. Add a **Track Metric** step to the queue and pick a metric from the dropdown.
3. When the step runs, it checks the `[PJS]`/`[cro]`-tagged console output captured during the current run for that value (case-insensitive substring match). A hit logs how many times it fired; a miss logs an error without stopping the queue.

### Saving and Loading Scripts

- Enter a name in the **Script name** field and click **Save** to store the queue.
- Open the **Load Script** accordion to load or delete a saved script.
- Scripts are saved to Chrome sync storage and persist across sessions.

### Console

The **Console** tab has two views, switched by the buttons under the **Capture** toggle. **Test Results** is the step-execution log for queue runs. **Browser Console** is a live mirror of the captured tab's own console. Capture follows whichever tab is focused in the window; the **Capture** toggle only pauses and resumes it, and the status line under the buttons says whether the feed is attached.

In **Browser Console**, top to bottom:

- **Filter row** — a text filter, **INFO / WARN / ERR** level buttons, **Clear**, and the **CRO** toggle. With CRO on, the feed shows only `[PJS]`/`[cro]`-tagged lines plus the commands you run and what they return. Console output that a command merely *triggers* in the page (a `console.table`, a listener's later `console.log`) is not tagged and stays hidden while CRO is on.
- **Feed** — newest line last, and the only thing in the tab that scrolls. Object and array results expand in place.
- **Command input** — type a JavaScript expression and press Enter; ↑ / ↓ recall earlier commands. `$click('selector')` and `$hover('selector')` send a *trusted* click or hover, which is what opens native `<select>` dropdowns and menus gated on real input. The input and the Quick Commands buttons are disabled until the console is attached.
- **Quick Commands** — one-click buttons for platform debugging commands, in four tabs: **Optimizely** (Web and Edge), **Convert**, **AB Tasty** and **General** (Dynamic Yield, Google Optimize, VWO, and CRO/PJS QA helpers such as setting the `cro_mode=qa` cookie). The active tab is remembered.
  - A plain button runs on click and flashes `✓ Ran`, or `✕` with the reason if it could not run (for example, the console is not attached). The result lands in the feed.
  - A button marked `✎` with a dashed border needs a value from you (an experiment ID, a selector, a URL). It fills the command input with the cursor on the placeholder instead of running; edit it and press Enter.
  - Opt-out and debug-flag buttons (the Convert, Optimizely, VWO and AB Tasty opt-outs, **Enable CRO logs**, **Cro-debug param**) set the matching URL parameter or hash for you. AB Tasty uses a hash, so reload to apply; the others navigate. (Optimizely Edge's opt-out calls its API instead.) None of the built-in buttons force a variation or register a tracked exposure.
  - **+ Add** saves your own command: a label and a JavaScript expression (or `$click(...)` / `$hover(...)`). Saved commands appear under every tab, are stored in Chrome local storage, and are removed with a two-click **×**. While the form is open it replaces the tabs and buttons.

**BrowserStack Live devices.** When the captured tab is a BrowserStack Live session on an iPhone or Android device, Browser Console mirrors the device's console instead of the Live page's own.
- Open Live's **DevTools** (in the session's toolbar). The device's console lines then appear here, each labelled with the device (📱 iPhone 14 16.3). That includes what the device logged before you opened DevTools. The CRO toggle and the level filters work on them as usual.
- The command input and Quick Commands run on the device, through Live's DevTools, so an Optimizely or Convert Quick Command answers from the iPhone or Android page. `$click` and `$hover` don't work on a device, and a device result can't be expanded.
- The status line says which device is mirrored, or that DevTools needs opening, and the input is disabled until it is open. If DevTools is open but has no device behind it, it says it is waiting for it to attach, and after about 15 seconds to close and reopen it in Live.
- Live has no DevTools on iOS 27, in desktop browser sessions, or on some Android devices (the Pixel 10 had none when it was checked, the Galaxy S26 on the same Android did). Then the status line says Live has none, in Live's words, and commands can't run; there is nothing to read.
- On iOS 26 (the iPhone 17) Live's Chrome DevTools does attach to the device, but to an empty Safari tab (about:blank) rather than the page under test, so there is nothing to mirror. The status line says so and the input stays disabled. It switches to mirroring by itself if a page ever comes up in DevTools.
- When Live's DevTools breaks ("Developer tools have experienced an unexpected issue. Please try a new session."), the status line says so in Live's words as soon as Live shows it, and a command answers with the same reason. It was seen on a session Live had started without Local, with the phone on Live's "Unable to connect" page.

### Visual Regression

Lives in the **Functional Testing** tab, alongside the function queue. Catches unintended visual changes on a page over time: capture full-page screenshots as a named baseline, then diff later runs against it — layout shifts, broken styling, missing elements.

1. Add the page URL(s) to test (Single or Multi scope). Each page row carries its own QA Mode toggle and URL params; a shared **Settle** delay waits for experiment scripts and lazy content.
2. Optionally add **Ignore Regions** (CSS selectors, pickable with `🎯`) — matched regions are masked out of the comparison, for carousels, timestamps, ads, and other legitimately dynamic content.
3. Click **Set Baseline** to capture and store the reference screenshots (kept per URL in IndexedDB; replace any page's baseline with its ✕ reset control).
4. Click **Run Comparison** to capture fresh screenshots and diff pixel-by-pixel against the baseline. A page fails when its mismatch percentage exceeds the editable **Threshold** (default 0.1%). Results show pass/fail, mismatch %, and baseline/current/diff images (click to open full size), with changed pixels highlighted in red.
5. If the window width differs from the baseline's, the page is flagged with a viewport warning and the pixel diff is skipped — dimension-mismatched diffs are noise. Height changes are diffed over the shared region and the delta counts toward the mismatch.

Screenshots are captured over CDP (`Page.captureScreenshot` with `captureBeyondViewport`) — no scrolling and stitching, no new permissions. **Export** downloads the run's verdicts as JSON (images stay in the panel).

### Test Agent

The **Test Agent** tab runs one testing mode at a time: pick it from the **Test Mode** dropdown, configure its settings, and click **Execute Test**. Every automated mode except Funnel Crawl and QA Pass (those two run alone) can also be batched together via **Also Run** — check any additional modes and they run in sequence after the primary one, each skipped automatically if it isn't configured. Once at least one mode has run, Selenite compiles a single report (opened in a new tab) covering every mode that ran, optionally with an AI-written plain-English summary.

A/B Variant Comparison is not a Test Agent mode. It is configured, run and reported entirely from its own **A/B** tab, and appears neither in the **Test Mode** dropdown nor in the **Also Run** list. The same goes for auditing an experiment's variants for accessibility: that is the A/B tab's **Accessibility audit** option. The WCAG mode here audits one page.

- **Agentic Testing** (Sonnet) — lets a mode capture a screenshot per page/variant and asks Claude to judge whether a visual difference looks like an intended change or a likely bug. Off by default.
- **Agentic Analysis** (Opus) — summarizes the full set of results in the report. On by default.
- Both require an **Anthropic API key** (saved locally in Chrome sync storage; calls go directly from the extension to `api.anthropic.com`). Funnel Crawl forces both on, since the agent's navigation *is* the test.

#### WCAG / Accessibility Mode

Runs a WCAG 2.2 accessibility audit (19 heuristic check suites plus axe-core as the authoritative engine) against the active tab. Pick the criteria to check and click **Run Audit**; rows marked **Manual** include a hand-check list of what to verify yourself.

- **Scoping** — enter a CSS selector (or pick one with `🎯`) to audit only that region of the page. Both the heuristic checks and the axe-core run are constrained to the subtree, so you can audit only the DOM an experiment variant touches. Leave empty for the full page.
- **Presets** — save named check configurations (enabled checks + scope) to Chrome sync storage. Two built-ins are always available: **Full audit** (all 19) and **Automated only** (excludes the manual checks).
- **Highlighting** — clicking an issue row that references a page element scrolls to and flashes that element in the audited tab.
- **Export** — the **Export** button in the results header downloads the run as a JSON file (per check: label, WCAG SCs, status, issues).
- **Run history** — the last 5 runs per page URL are kept in local storage; pick one under **Recent Runs** and click **View** to re-view its results.

#### Performance/Load Mode

Measures page-load performance so experiment work that "visually passes" doesn't silently tank speed or stability. Each configured page is loaded fresh N times (default 3, sequential — never parallel) and the **median** per metric is reported; individual runs are viewable on expand.

- **Metrics per run**: TTFB, DOMContentLoaded, load event, First Contentful Paint, LCP, CLS, long-task count/time (a rough main-thread-blocking signal), request count and transfer size by type (script/css/img/font/other), resources arriving *after* the load event (experiment scripts often inject late), and JS errors during the load window.
- **Budgets**: editable thresholds with Core Web Vitals defaults (LCP ≤ 2.5 s, CLS ≤ 0.1, plus TTFB and load). Over-budget medians render red, under-budget green. Budgets persist in sync storage.
- **Disable cache** (default on) gives a fair "first visit" measurement via CDP `Network.setCacheDisabled` — no new permissions.
- **Run history**: the last 10 measurement summaries per URL (medians and verdicts) are kept in local storage under **Recent Runs**.
- Because pages are just URLs, compare experiment variants by adding the same page twice with different override params.

Numbers come from a real browser on your machine and network — useful for relative comparison (page vs page, run vs run, before vs after), not lab-grade absolutes.

#### Funnel Crawl

An AI agent (Sonnet) clicks through the live page to verify a funnel actually connects, end to end — Start → each Middle waypoint (in order) → End.

1. Enter the **Start** and **End** waypoint URLs (both required); optionally add **Middle** waypoints in between, in order.
2. Optionally add **Supplemental Instructions** — free-text notes for the agent (test credentials, paths to avoid, form field mappings, etc.).
3. Click **Execute Test**. Agentic Testing and Analysis are forced on for this mode and require an Anthropic API key.
4. Results show each segment (Start→Middle, Middle→Middle, Middle→End) as reached or not, with step counts and any error. Funnel Crawl always runs alone — it isn't batchable via Also Run.

#### QA Pass

Checks the active ticket's preview links in this Chrome: platform, targeting, layout and metrics on load. It needs a reviewed Test Context (Initialize tab) with at least one preview link, and it runs alone, like Funnel Crawl. It complements the **A/B** tab and does not repeat it: copy, markup, visual and accessibility differences between variants are the A/B tab's job, QA Pass never captures variants for a diff, and its report cites the last A/B report for the ticket when there is one.

Each check can be turned off:

- **A · Link map** — loads each preview link and the ITW link once, reads the platform snippet, and says which variation each link served, against the variation the link forces and the experiment on the ticket. Activation that waits for a trigger is left *In Progress* for the PGM.
- **B · Control matches PROD** — the Control link against the plain production page: title, canonical, chat/banner/modal widgets, text length, page height. A PROD load that was bucketed into a variation is reported, not compared.
- **C · Snippet vs ticket** — the ticket's goals against the snippet's events, softcoded tests against the experiment names in the snippet, and live tests on the ITW page that the ticket does not list (tried in pairs with the test's variations, on links that carry no tracking flag).
- **D · Audience targeting** — the experiment's audience conditions that can be set from the URL (query parameters, desktop vs iPhone), tried on the ITW link: an exclusion must switch the experiment off, a companion value must leave it on. Each audience load is a new visitor, so when the snippet shows traffic under 100 % (a campaign holdback, or variation weights that end below 100 %), a test that expected the experiment to activate and it did not is *In Progress*, not *Failed*, with the allocation named as read from the snippet.
- **E · Breakpoint and clipping sweep** — every variant and PROD at 18 widths from 300 to 2080 px (desktop; an emulated iPhone below 768 px; PROD also as an emulated Android). Text that sticks out of the viewport or out of an overflow-hidden box is a bug with a severity (360–430 px high, 320 px and below low), a note on whether PROD has the same problem, and, for the worst few, a screenshot with PROD above the variant at the same width.
- **F · Metrics on load** — a listener registered before the page loads records which analytics events fire on load. A click metric firing on load, or a goal firing twice, is a bug; a goal firing once is left for the PGM ("is load its trigger?").

What it never does: it never adds `optimizely_force_tracking` or `_conv_eforce` to a URL it builds (a preview link is loaded as the ticket gives it, once, in phase A); it never attempts a CAPTCHA (a bot-check page marks that link *Blocked* and is not loaded again); and it never tests what only the platform's UI shows (metric order, traffic allocation, integrations, results), click-through, time-based content or the BrowserStack device matrix. Those are listed under *Not tested*.

How statuses are decided: deterministic code decides every status (*Passed*, *Failed*, *In Progress*, *Blocked*, *Not tested*). With **Agentic Analysis (Opus)** on, Opus only groups the failed checks into bugs, asks the PGM questions, flags possible environment noise, cites the ticket's Jira comments (kept on the context as id, date and text, with no author) and connects test-plan rows to checks. It cannot change a status.

Exposure rule: a preview link with `optimizely_force_tracking` or `_conv_eforce` registers a real exposure on every load. QA Pass loads it once as given, then tries its no-tracking form once; if that serves the variation, the sweep uses it (no more exposures). Otherwise the sweep loads the link once per device profile and resizes the viewport between widths (at most two extra exposures per variant). **Quick sweep** resizes for everything.

Fresh visitors: every PROD, ITW and audience-test load is a new visitor to the live site (the Optimizely cookies are cleared first, and the visitor cookie is never kept). When the plain PROD load shows a live experiment, or **B** is off so PROD was never probed, PROD is swept by resizing one tab per device instead of reloading once per width. The report's foot gives the run's fresh-visitor count and how PROD was swept, and the settings card says so before a run.

State hygiene: before each load QA Pass deletes the site's Optimizely and Convert cookies (`optimizely…`, `_conv_…`) and `optimizely…` storage keys, not your login. **Clear all site data between loads** clears everything for the site and signs you out of it.

Sheet and Apply: with Google connected and the ticket's QA test plan link pointing at a Google Sheet, QA Pass reads the tab you pick and proposes cell changes after the run; nothing is written until you click **Apply**. The proposal lists each row, the checks it maps to, the old and new cell, and an include box; you can change a row's mapping or untick it. Statuses go to one column only, a desktop Chrome column you choose (never an Android, Safari, Firefox or Edge column), and notes are appended to the Notes column as `Auto QA (M/D): …`, never replacing what is there. Apply re-reads the sheet first and leaves alone any row whose cells changed since the read, writes the rest as plain values (RAW), then re-reads to verify and reports anything that did not match. Without Google, or when a write fails, the report carries a paste-ready table instead.

##### Google Sheets setup (one time)

1. Reload Selenite in `chrome://extensions` (the service worker only picks up the new code and the `identity` permission on reload). Open Settings (the gear): the **Google Sheets (QA Pass)** card shows `Redirect URL for this install: https://<extension-id>.chromiumapp.org/`. Copy it. Every install has its own extension ID, so each teammate adds their own URL in step 5.
2. Go to https://console.cloud.google.com and select or create a project (for example "Selenite QA").
3. APIs & Services → Library → **Google Sheets API** → Enable, and **Google Docs API** → Enable (Email Check reads the copy doc).
4. Google Auth Platform (OAuth consent screen) → Get started: app name "Selenite", a support email, **Audience: Internal** (crometrics.com Workspace; no verification needed. If Internal is not offered, choose External, keep it in Testing and add each teammate as a test user). Data access → add the scopes `https://www.googleapis.com/auth/spreadsheets` and `https://www.googleapis.com/auth/documents.readonly`.
5. Clients → Create client → Application type **Web application**, name "Selenite (extension)". Authorized JavaScript origins: none. **Authorized redirect URIs**: paste the URL from step 1. Create, then copy the **Client ID** (`…apps.googleusercontent.com`). No client secret is used.
6. In Selenite Settings, paste it into **OAuth client ID** and Save.
7. Test Agent → Test Mode **QA Pass** → **Connect Google** → pick your account → Allow. The panel says "Google connected" and lists the test plan's tabs in the **Tab** picker (the QA Test Plan link on the active ticket must be a Google Sheet).

The access token lives in this browser session only and lasts an hour; it is renewed silently, or the panel asks you to click **Connect Google** again.

#### Email Check

Checks an email proof for the active ticket against its copy doc, reads its Email on Acid renders, and proposes changes to the EMAIL test plan: the plan is written to, never checked against. It is a Test Agent mode that runs alone, like QA Pass. It needs a reviewed Test Context (Initialize tab) that holds the ticket's Mailtrap proof links; a context saved before this mode has none, so run Initialize on the ticket again.

**Mailtrap.** Email Check reads each proof from your own Mailtrap session in this Chrome, so it needs no API token. A run opens one Mailtrap tab of its own, reads the proofs there and closes it. It never signs in and never clicks a browser check. When Mailtrap cannot be read, the proof checks are Blocked with one of these messages; the copy doc and the Email on Acid list still read:

- Signed out: "Mailtrap: this Chrome is signed out. Sign in to the shared Mailtrap account in this Chrome, then run again."
- A personal account: "Mailtrap: the signed-in account does not own sandbox <id> (a personal account?). Sign out of Mailtrap, sign in to the shared account, then run again." (<id> is the ticket's sandbox number.)
- A browser check: "Mailtrap shows a browser check. Open mailtrap.io in this Chrome, let it finish, then run again."

**Links.** Each Pardot tracked link is followed once per run to read where it goes. That counts as a click on the test prospect. The destination's status and title are checked, with the query string left off the request. Unsubscribe, view-in-browser, preference and webmail links are never opened; they are listed as "not opened: check by hand". A link or destination that cannot be read is In Progress, not Failed. Only a link on one of the organisation profile's Pardot hosts is followed as a tracked link: a link shaped like one on any other host (a profile with no Pardot hosts, a host the client added) is listed as not resolved and never requested, because each request would be a click. A redirect is followed by Chrome hop by hop, so a hop cannot be refused before it is made; when the chain ends on an unsubscribe, preferences or view-in-browser path the answer is dropped unread and the link is marked not resolved.

**Copy doc and renders.** The copy doc is read through the Google Docs API, which needs one more read-only Google permission: click **Connect Google** once after this update. If Google answers that the Docs API has not been used in the project or is disabled, the doc source says "Enable the Google Docs API in the Cloud project, then run again."; any other 403 means the doc is not shared with the connected account. Comments in the doc are not read. With **Email on Acid renders** on (the default), each variation's Email on Acid list is opened, its images are loaded, and up to 16 per variation go into the report. With it off, the client list still reads.

**Rules.** Each ticket has three rules: how the UTMs differ between versions (none, identical, or a suffix per version), the destination path each segment's donate links reach, and which email to check when the copy doc holds several. Email Check suggests the first two from the ticket's comments and names the comment it used. Confirm or change them before the run. The rule used and its source (you, or a ticket comment) are named in the check notes and kept in the debug log, and the rules are kept per ticket in this browser.

**What it decides.** Email Check decides the subject and preview (text and spelling), the sender, From address and Reply-To, personalisation tokens, conditional content, the body and image alt text against the copy doc, the UTMs, the links, the signature, and the DKIM and spam results. It never decides the visual, alignment and dark-mode rows or the text inside the graphics. Those stay In Progress with the renders and facts for a person to check, or are Blocked when the ticket has no Email on Acid link for that variation. Statuses come only from code, and a check that compares versions (the UTMs, the conditional content) is never Passed while the other version of the segment was not read: it is In Progress and says so. The conditional content of a proof with no segment, on a ticket with one version, has nothing to compare and is In Progress too, and so is a token row with nothing to scan (a proof with no subject, a message with no preview text). With **Agentic Analysis (Opus)** on, Opus writes the analysis and advisory copy notes and cannot change a status. What no proof can show (unsubscribe links, the phone and tablet views, the doc's comments) is listed under *Not tested*.

**Test plan.** Apply writes only after you click it, and only to the Desktop, Mobile, Web-Based and Notes columns (E to H on the EMAIL test plan). Mobile and Web-Based are written only on the four visual and dark-mode rows. Rows are matched by their text and group label, not by position. Apply re-reads the sheet, leaves alone any row that changed since the read, and appends notes without replacing what is there. Nothing is written to Jira: post the findings there yourself.

**Stored.** The settings and ticket rules stay in this browser (`chrome.storage.local`), and the last run stays in the browser session. Not kept or shown: the HTML and text bodies, raw headers, recipient addresses (only the tag is kept), the client IP, Pardot prospect ids and tracked-link hashes, and Mailtrap account ids. The report, debug log and AI summary are built from the same reduced record.

**Tests.** The committed fixtures are synthetic: an organisation called "Example Relief", with the tickets EX-1 and EX-2. The tests that check real proofs run only in a local suite outside the repository.

### A/B Variant Comparison

The **A/B** tab QAs an A/B experiment (Optimizely, Convert, or similar) by loading the same page once per variant and diffing the captures — no interaction steps, just load and compare. Differences are shown neutrally (a variant is *supposed* to differ from control); only JS errors and load failures are styled as errors.

1. Set the **Base URL** the variants share (each target can override it with its own URL).
2. Define at least two **Variant Targets**. The first is the baseline (typically Control). Each target has a label and an **Override** — the query string that forces the variant, e.g. Optimizely's `optimizely_x=<variationId>`.
3. Optionally add **Watched Selectors** (use `🎯` to pick them from the page) — each is compared across variants for existence, visibility, text, and key computed styles.
4. Optional settings: **QA Mode** appends `cro_mode=qa` to every variant URL; **Settle** waits after load so experiment scripts can apply changes (default 3s); **Keep tabs open** leaves each variant tab open for manual inspection; **Accessibility audit** (on by default) runs the WCAG audit on each variant, described below; **Agentic Testing (Sonnet)** takes a viewport screenshot per variant and asks Claude to judge whether a visual difference looks intended or like a bug; **Visual Diff (AI)** does a full-page, region-level AI visual comparison against Control, requires an active reviewed ticket context.
5. Click **Run Comparison**. Each variant loads sequentially in its own tab; captures include page title/URL, `[PJS]`/`[cro]`-tagged console lines, Metrics fires (from the Functional Testing tab's Metrics list), JS errors, and watched-selector state. Console lines and JS errors are caught from the moment the page starts loading, so a snippet that logs or throws while the page loads is caught too.
6. Results are grouped diffs vs the baseline — identical facts are greyed and collapsed, deltas are highlighted, and errors are always flagged red.

Variant target sets can be saved by name (stored in Chrome sync storage) and re-run in one click. The comparison never touches the Functional Testing tab's queue.

**Accessibility audit** — answers the question the standalone WCAG audit can't: did a variant introduce, or fix, accessibility issues compared with Control? Each variant is audited in the same page load as its capture, before the screenshot, using the WCAG mode's engine: all 19 checks plus axe-core, on the whole page. The report's **Accessibility (WCAG)** section has the same depth as a standalone WCAG report, for every page:
- **By check** — every automated check, with its WCAG success criteria, and each page's status: Pass, or its issue count, with what a variant made worse or better than Control.
- **Each variant compared with Control** — every issue it introduced and every issue it resolved, written out in full. A variant that changed exactly what an earlier one did says "Same changes as v2" instead of repeating the list.
- **Control's full audit** — every check and every issue on Control: the issues every variant starts from.
- **Manual review** — the five checks no script can settle, once, with any page whose guidance differs named under it.
- **Agentic Accessibility Review** — with Agentic Testing on, Claude looks at each page's screenshot alongside these findings and flags barriers the automated checks can't see, one paragraph per page. It is told not to judge the experiment's design, copy or emphasis, which are the test's intended changes.

A variant the experiment platform says was not served its variation is marked not compared rather than counted, and the section never badges PASS while any variant was not compared. Issue matching is exact (normalized whitespace) within each check, so an axe node-target string that differs between runs for the same issue counts as introduced on one side and resolved on the other. The exception is a summary line that leads with a count ("2 <img> missing an alt attribute"): when only the count moved, it is one issue that got worse or better, not one fixed and one new. Untick the option for a visual-only run, a few seconds per variant faster.

**Optional: interaction heatmap** — with **Keep tabs open** checked, also check **Record interaction heatmap**. After the comparison, each variant's kept-open tab gets a small recorder control: click **Record walk**, interact with that tab the way a real visitor would, then **Stop Recording**; **Show heatmap overlay** draws click-density dots, a mouse-trail line, and a scroll-depth gutter onto that tab. Only one variant can record at a time, and recordings are kept in memory only for the current run (nothing is saved to disk, and nothing ever leaves the browser — keystrokes and typed values are never captured). Off by default; a normal A/B run is unaffected.

**Devices (BrowserStack Live)** — the **Devices — BrowserStack Live** section under the A/B card opens a variant on a real phone or tablet, or in another desktop browser, in BrowserStack Live. Tick the devices you QA on, grouped as **Desktop** (Safari on macOS; Edge, Chrome and Firefox on Windows 11), **Mobile** (iPhone 18 Pro, iPhone 17, Galaxy S26, Pixel 10) and **Tablet** (iPad Pro 13, Galaxy Tab S11). Each ticked device gets a row with a button per variant target. A button opens that variant's URL, with its override and QA Mode as the comparison would use them, in a new tab, and starts the Live session. You need to be signed in to BrowserStack in Chrome; Selenite needs no BrowserStack username or access key. Live runs one session at a time, so a new launch closes the Live tab Selenite opened before.
- **Use BrowserStack Local** (on by default) asks Live to route the session through BrowserStack Local, so the device can reach staging, VPN and allowlisted pages. You start the BrowserStack Local app on your Mac. Before every launch Selenite asks the address Live itself checks (`127.0.0.1:45691`) and the app's console (`localhost:45454`). If Live couldn't see the app, Selenite says why and offers **Open anyway** instead of opening. **Check** asks on demand.
- **What Live did.** After a launch the status line follows the session: running, refused or dropped (with Live's own words), the tab closed or sent to sign in, or running **without Local**. On the account this was measured on, Live starts a session about a second before its own check finds the Local app, and BrowserStack's wait-for-Local mode needs an account setting (`waitForPollingInIntegrationFlow`) that was off, so a link can't get Local there. Selenite then offers **Open Live and pick the device myself**: Live opens with Local and the page ready but doesn't start; once Live's Local Testing panel shows Local connected, pick the device in its list and check that the page loads on it. That worked in one Chrome profile and not in another (Live found the Local app but didn't attach it to the session), so it is a route to try, not a guarantee. BrowserStack support can say whether the account setting can be turned on, which would let the link do it. A running session is checked every 5 s after its first 40 s, so the line also follows a session you stop in Live later.
- **All traffic through this Mac** (on by default; needs Local) asks Live for "Resolve all URLs through my network", so the device's visits come from your IP. Live doesn't apply it from a link, so it is a request: the status line says when Live ignored it, and you can switch it on in the session's Local panel (that reconnects the session and closes DevTools).
- Your device choices and both toggles are remembered, and shared with the Functional Testing tab's Target section.

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
| `agent_navigate` | **Navigate to (Test Agent)** — an AI agent gets the tab to a URL by clicking the page's real UI (needs an Anthropic API key) |
| `agent_prompt` | **Prompt Function** — an AI agent carries out a typed instruction (up to 120 characters) at this point in the queue, (needs an Anthropic API key) |

## Project Structure

```
extension/
├── manifest.json       # Chrome extension manifest (MV3)
├── floating.html       # Floating window the toolbar icon opens when Selenite is unpinned; holds sidepanel.html in a frame
├── floating.js         # Floating window: hosts the UI; the toolbar icon brings it back
├── sidepanel.html      # Panel UI (Chrome's side panel, or the floating window when unpinned)
├── popup.html          # Popup UI (same layout as the side panel)
├── popup.js            # Queue builder, Metrics section, UI logic (shared by both UIs)
├── browserstack.js     # BrowserStack Live links, device presets, the Local check and what Live did with a launch (A/B tab's Devices section)
├── qa-pass.js          # QA Pass (Test Agent): checks, sweep, Sheets helpers, shared by the worker and the panel
├── background.js       # Service worker (queue execution, console capture, metrics)
├── picker.js           # In-page element picker (injected on demand)
├── selector.js         # Shared CSS-selector builder (used by picker.js and recorder.js)
├── recorder.js         # Interaction recorder for A/B's heatmap (clicks/scroll/movement, injected on demand)
├── console-capture.js  # MAIN-world console patch (relays [PJS]/[cro] tagged output)
├── console-bridge.js   # ISOLATED-world bridge to the service worker
├── bs-live-tap.js      # MAIN-world reader of a BrowserStack Live session's DevTools: the device's console, and commands run on the device
├── bs-live-bridge.js   # ISOLATED-world bridge from bs-live-tap.js to the service worker
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
