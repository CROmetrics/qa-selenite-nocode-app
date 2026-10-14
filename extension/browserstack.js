// browserstack.js -- BrowserStack Live launch links, the device presets they
// open, and the reading of BrowserStack Local's status. Pure JS: no DOM, no
// network. Same global-attachment convention as figma.js / vd-diff.js:
// (function(g){...})(globalThis), loaded via <script src> in both popup.html
// and sidepanel.html, BEFORE popup.js. Nothing here is panel-specific either,
// so the Automate milestone can importScripts it into background.js as-is.
//
// Deliberately no URL/URLSearchParams, for the same reason as figma.js: jsc,
// which runs the unit suite, has neither, and a link builder that can only be
// exercised inside Chrome is one whose encoding never gets tested.
//
// This milestone is BrowserStack LIVE: interactive sessions opened in the
// user's own logged-in browser tab, so nothing here needs a username or an
// access key. The fetch to the Local console lives in popup.js; this file
// builds the link and interprets the answer. The worker loads it too
// (importScripts), for the device-console helpers near the end.
(function (g) {
  'use strict';

  // Documented at https://www.browserstack.com/docs/live/integration-url-params:
  // parameters go after '#', joined by '&'. `start` defaults to false, so a
  // link without start=true only pre-selects the device.
  var BS_LIVE_DASHBOARD = 'https://live.browserstack.com/dashboard';

  // The BrowserStack Local app (and the BrowserStackLocal binary) serve a
  // console here. Measured 2026-10-06 against app 3.7.8: GET /status needs no
  // auth and answers {status, token, userId}. See bsLocalStatusFrom.
  var BS_LOCAL_CONSOLE = 'http://localhost:45454';
  var BS_LOCAL_DOWNLOAD = 'https://www.browserstack.com/docs/local-testing/releases-and-downloads';
  // The Local binary's own port, the address the Live dashboard itself polls
  // every two seconds (measured 2026-10-08): GET /?_=<ts> answers JSONP,
  // commandLineTunnel('<key>-nativeapp:<id>', …). That is the signal that
  // matters to Live, which a signed-in console on 45454 is not.
  var BS_LOCAL_BINARY = 'http://127.0.0.1:45691';

  // Pinned 2026-10-06 from the Live catalogue — the public (but undocumented)
  // data behind browserstack.com/list-of-browsers-and-platforms/live. Every
  // os / os_version / device / browser / browser_version below is a value that
  // file listed that day, spelled exactly as it lists it: the dashboard matches
  // on these strings, so a near-miss ("iPhone 18Pro", "27") opens the wrong
  // device or none. To refresh:
  //   curl -s https://www.browserstack.com/list-of-browsers-and-platforms/live.json | python3 -c "import json,sys; d=json.load(sys.stdin); [print(o['os'], repr(x['device']), x['os_version']) for o in d['mobile'] for x in o['devices'] if x.get('real_mobile')]; [print(o['os'], repr(o['os_version']), b['browser'], b['browser_version']) for o in d['desktop'] for b in o['browsers']]"
  //
  // Mobile presets name their browser with `device_browser`. That parameter is
  // not in BrowserStack's table; it is what the dashboard itself put in a real
  // session URL (webcompat/web-bugs#92409), and Safari / Chrome are each
  // platform's default anyway.
  //
  // For the Automate milestone these map onto `bstack:options` as os -> os,
  // os_version -> osVersion, device -> deviceName, browser / device_browser ->
  // browserName, browser_version -> browserVersion.
  //
  // Listed group by group, in BS_LIVE_KINDS order: bsSelectedPresets keeps
  // this order, so the rows of buttons come out in the same groups as the
  // checklist.
  var BS_LIVE_PRESETS = [
    { id: 'mac-safari',     kind: 'desktop', label: 'Mac Safari',      detail: 'Golden Gate · 27',
      os: 'OS X', os_version: 'Golden Gate', browser: 'safari', browser_version: '27.0' },
    { id: 'win-edge',       kind: 'desktop', label: 'Windows Edge',    detail: 'Win 11 · 154',
      os: 'Windows', os_version: '11', browser: 'edge', browser_version: '154.0' },
    { id: 'win-chrome',     kind: 'desktop', label: 'Windows Chrome',  detail: 'Win 11 · 154',
      os: 'Windows', os_version: '11', browser: 'chrome', browser_version: '154.0' },
    { id: 'win-firefox',    kind: 'desktop', label: 'Windows Firefox', detail: 'Win 11 · 157',
      os: 'Windows', os_version: '11', browser: 'firefox', browser_version: '157.0' },
    { id: 'iphone-18-pro',  kind: 'phone',   label: 'iPhone 18 Pro',   detail: 'iOS 27 · Safari',
      os: 'ios', os_version: '27.0', device: 'iPhone 18 Pro', device_browser: 'safari' },
    // Live's own list calls this "26", and "26.1" (which the catalogue also
    // lists) was refused on a real launch every time (2026-10-08): "Device is
    // temporarily disabled". "26.0" starts, on whatever 26.x build is current.
    { id: 'iphone-17',      kind: 'phone',   label: 'iPhone 17',       detail: 'iOS 26 · Safari',
      os: 'ios', os_version: '26.0', device: 'iPhone 17', device_browser: 'safari' },
    { id: 'galaxy-s26',     kind: 'phone',   label: 'Galaxy S26',      detail: 'Android 16 · Chrome',
      os: 'android', os_version: '16.0', device: 'Samsung Galaxy S26', device_browser: 'chrome' },
    { id: 'pixel-10',       kind: 'phone',   label: 'Pixel 10',        detail: 'Android 16 · Chrome',
      os: 'android', os_version: '16.0', device: 'Google Pixel 10', device_browser: 'chrome' },
    { id: 'ipad-pro-13',    kind: 'tablet',  label: 'iPad Pro 13',     detail: 'iOS 27 · Safari',
      os: 'ios', os_version: '27.0', device: 'iPad Pro 13 2024', device_browser: 'safari' },
    { id: 'galaxy-tab-s11', kind: 'tablet',  label: 'Galaxy Tab S11',  detail: 'Android 16 · Chrome',
      os: 'android', os_version: '16.0', device: 'Samsung Galaxy Tab S11', device_browser: 'chrome' },
  ];

  // The checklist's groups, in display order. A phone's kind is 'phone' and
  // its group reads "Mobile": BrowserStack's own catalogue files tablets under
  // "mobile" too, so the code keeps the narrower word.
  var BS_LIVE_KINDS = [
    { kind: 'desktop', label: 'Desktop' },
    { kind: 'phone',   label: 'Mobile' },
    { kind: 'tablet',  label: 'Tablet' },
  ];

  // A phone, a tablet, Android, and the other desktop engine — the device
  // columns a QA test plan most often carries beyond the desktop Chrome
  // Selenite already runs in.
  var BS_LIVE_DEFAULT_DEVICES = ['iphone-18-pro', 'ipad-pro-13', 'galaxy-s26', 'mac-safari'];

  function bsPresetById(id) {
    for (var i = 0; i < BS_LIVE_PRESETS.length; i++) {
      if (BS_LIVE_PRESETS[i].id === id) return BS_LIVE_PRESETS[i];
    }
    return null;
  }

  // Known ids only, in preset order, each once. Saved prefs can carry an id a
  // later build dropped from the list; that one is skipped rather than
  // rendered as a row that opens nothing.
  function bsSelectedPresets(ids) {
    var want = {};
    (Array.isArray(ids) ? ids : []).forEach(function (id) { want[id] = true; });
    return BS_LIVE_PRESETS.filter(function (p) { return want[p.id]; });
  }

  // Same rule as background.js normalizeUrl, which the A/B run applies to the
  // same target URLs: a bare host gets https://. Live given a scheme-less url
  // would otherwise treat it however the dashboard sees fit.
  function bsNormalizePageUrl(url) {
    var u = String(url == null ? '' : url).trim();
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    return 'https://' + u;
  }

  // Form-style, as the dashboard writes its own links (device=Google+Pixel+5):
  // spaces as '+', everything else percent-encoded, so a preview URL's own
  // ?, & and # stay inside the url= value instead of splitting the hash.
  function bsFormEncode(v) {
    return encodeURIComponent(String(v)).replace(/%20/g, '+');
  }

  // The link that opens `pageUrl` on `preset` in Live and starts the session.
  // local: route the session through BrowserStack Local. forceLocal: send ALL
  // of its traffic through this machine (Live's "Resolve all URLs through my
  // network"), which is what makes an IP-targeted QA audience see this Mac's
  // IP. forceLocal means nothing without the tunnel, so it is only emitted
  // with local. Returns '' when there is nothing to open.
  //
  // opts.start === false leaves `start=true` out. Live then loads the
  // dashboard with the page URL and Local already in place and waits for the
  // tester to pick the device. That is the one route that gets Local on this
  // account: with start=true Live starts the session about a second before its
  // own check finds the Local app (see bsLaunchLine).
  function bsLiveUrl(preset, pageUrl, opts) {
    if (!preset || !preset.os || !preset.os_version) return '';
    if (!preset.device && !preset.browser) return '';
    var target = bsNormalizePageUrl(pageUrl);
    if (!target) return '';
    var o = opts || {};
    var pairs = [['os', preset.os], ['os_version', preset.os_version]];
    if (preset.device) {
      pairs.push(['device', preset.device]);
      if (preset.device_browser) pairs.push(['device_browser', preset.device_browser]);
    } else {
      pairs.push(['browser', preset.browser]);
      if (preset.browser_version) pairs.push(['browser_version', preset.browser_version]);
    }
    pairs.push(['url', target]);
    if (o.start !== false) pairs.push(['start', 'true']);
    if (o.local) {
      pairs.push(['local', 'true']);
      if (o.forceLocal) pairs.push(['force-local', 'true']);
    }
    return BS_LIVE_DASHBOARD + '#' + pairs.map(function (p) {
      return p[0] + '=' + bsFormEncode(p[1]);
    }).join('&');
  }

  // A tab Selenite opened for Live is only closed again while it is still on
  // the Live dashboard, so a tab the user has since taken elsewhere is left
  // alone.
  function bsIsLiveUrl(url) {
    return /^https:\/\/live\.browserstack\.com(\/|$)/i.test(String(url || ''));
  }

  // The Live dashboard: the page a Live session runs in, and the only page
  // whose DevTools frame bs-live-tap.js reads.
  function bsIsLiveDashboardUrl(url) {
    return /^https:\/\/live\.browserstack\.com\/dashboard(?:[/?#]|$)/i.test(String(url || ''));
  }

  // One device-console line, as bs-live-tap.js relays it from Live's DevTools
  // ({level, type, source, text}), turned into a Browser Console entry.
  //   - Level follows the worker's own mapping for a local tab: by console
  //     type first, as CONSOLE_TYPE_MAP does (error/assert ERROR, warning
  //     WARNING, info/table/count INFO, anything else BROWSER). A message whose
  //     own level is error or warning keeps it: an exception, a failed request.
  //   - A line that is not a console call or an exception reads like the
  //     worker's Log.entryAdded lines: "[network] …".
  //   - `tags` is MT_TAGS, passed in so this file needs nothing else loaded. It
  //     makes the CRO toggle work on device lines.
  //   - No objectId: a device object lives in the DevTools frame, where the
  //     worker's debugger can't expand it.
  //   - Commands typed into Live's own console come back as command and result
  //     echoes; those are Live's business, not the device's output.
  var BS_TYPE_LEVEL = { error: 'ERROR', assert: 'ERROR', warning: 'WARNING', info: 'INFO', table: 'INFO', count: 'INFO' };
  var BS_SKIP_TYPES = { command: true, result: true, endGroup: true, clear: true };
  var BS_DEVICE_TEXT_MAX = 4000;
  function bsDeviceEntry(line, device, tags) {
    if (!line || typeof line !== 'object') return null;
    var type = String(line.type || '');
    if (BS_SKIP_TYPES[type]) return null;
    var source = String(line.source || '');
    var text = String(line.text == null ? '' : line.text);
    if (source && source !== 'console-api' && source !== 'javascript') text = '[' + source + '] ' + text;
    if (text.length > BS_DEVICE_TEXT_MAX) text = text.slice(0, BS_DEVICE_TEXT_MAX) + ' … (truncated)';
    var level = BS_TYPE_LEVEL[type] || 'BROWSER';
    if (line.level === 'error') level = 'ERROR';
    else if (line.level === 'warning' && level !== 'ERROR') level = 'WARNING';
    var lower = text.toLowerCase();
    var tagged = (Array.isArray(tags) ? tags : []).some(function (t) {
      return lower.indexOf(String(t).toLowerCase()) > -1;
    });
    return { level: level, text: text, source: 'bs-device', device: String(device || ''), tagged: tagged };
  }

  // reachable: the console answered at all. json: its parsed /status body,
  // or null. In the console's own code (its React app, read 2026-10-06)
  // status:true means the app is running and signed in to an account — it
  // shows the sign-in page otherwise. It does not say the tunnel is connected;
  // Live connects to the app by itself once the dashboard is open.
  //
  // Reads ONLY `status`. The same body carries a session token and a user id,
  // which Selenite has no use for and must never keep: nothing else from it is
  // copied into the result, so nothing else can reach storage or a log.
  function bsLocalStatusFrom(json, reachable) {
    if (!reachable) return { running: false, signedIn: false };
    var signedIn = !!(json && typeof json === 'object' && json.status === true);
    return { running: true, signedIn: signedIn };
  }

  // What answers on the binary's port (BS_LOCAL_BINARY). The JSONP body names
  // a tunnel identifier and a version, none of which Selenite needs, so only
  // whether it has the shape Live waits for comes back; the text is not kept.
  function bsLocalBinaryAnswer(text) {
    return { up: typeof text === 'string' && /^\s*commandLineTunnel\(/.test(text) };
  }

  // Whether Live can see Local. Live's own check is the binary port
  // (binaryUp); the console's /status (consoleStatus, from bsLocalStatusFrom)
  // can only say why it isn't answering. A signed-in console with a silent
  // binary port is the case the console alone passed as "running".
  function bsLocalReadiness(binaryUp, consoleStatus) {
    var c = consoleStatus || { running: false, signedIn: false };
    if (binaryUp) return { ready: true, state: 'ready' };
    if (c.running && c.signedIn) return { ready: false, state: 'not-connected' };
    if (c.running) return { ready: false, state: 'not-signed-in' };
    return { ready: false, state: 'not-running' };
  }

  // Live has no DevTools on iOS 27: its toolbar item is disabled with "Currently
  // DevTools is unavailable for iOS 27.0 Safari" (measured 2026-10-08, an iPhone
  // 18 Pro). The device console mirror reads that DevTools, so it cannot run.
  //
  // Nor in desktop browser sessions: the toolbar of a Mac Safari and a Windows
  // Chrome, Edge and Firefox session had eleven items and none for DevTools.
  // Anything else is decided at run time from Live's own toolbar (the tap's
  // `unavailable`), because it varies by device: on 2026-10-08 the Galaxy S26
  // on Android 16.0 Chrome had DevTools and the Pixel 10 on the same did not.
  function bsDevtoolsSupport(preset) {
    if (preset && preset.os === 'ios' && parseFloat(preset.os_version) >= 27) {
      return { mirror: false, why: "Live has no DevTools on iOS 27, so the device's console can't be mirrored." };
    }
    if (preset && preset.kind === 'desktop') {
      return { mirror: false, why: "Live doesn't offer DevTools in desktop browser sessions, so there is no console to mirror." };
    }
    return { mirror: true, why: '' };
  }

  // What a Live dashboard tab says about a launch. Runs INSIDE the page
  // (chrome.scripting.executeScript, MAIN world), so it must stand alone: no
  // reference to anything outside its own body. Every read is guarded and it
  // always returns an object, because executeScript swallows a throw into
  // {result: null}. Selectors are the ones measured on real sessions
  // (2026-10-08):
  //   - an error banner, .notification-message-banner--error, with text like
  //     "Device is temporarily disabled. Please try again in some time." or
  //     "Connection to the remote device failed. Please try again."
  //   - the toolbar's DevTools item, li.switchDevtools-menu-wrapper, with
  //     aria-disabled="true" when Live has none for this device, and the
  //     reason in #devtools_message or the item's tooltip
  //   - the dashboard's own record that Local was on when the session started,
  //     Reactor.localTesting.getLocalStatusAtStart(), and its force-local
  //     switch state, getIsForceLocalEnable()
  //   - the device picker's search box, #device-search-field
  //
  // How a real session unfolds on the page (measured 2026-10-08, sampled every
  // 100 ms on iOS 27, Android 16 and Windows Chrome): the picker's search box is
  // on screen at first, then gone from boot until the session ends, when it is
  // back with the title "Dashboard". A phone's tab is renamed "<device> v<os>"
  // about 5 to 10 s before anything else. The session toolbar then appears, and
  // only then does the dashboard's Local-at-start record read true (it reads
  // false from page load until that moment). On iOS 27 and on desktop the
  // toolbar is rendered, goes away for about 4 s, and comes back.
  function bsLiveReadOutcome() {
    var out = { title: '', session: false, picker: false, errors: [], local: null, forceLocal: null, devtools: { present: false, disabled: null, reason: '' } };
    function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 200); }
    try { out.title = clean(document.title); } catch (e) {}
    // The session toolbar's Stop Session control exists only while a session
    // runs. A phone or tablet also renames the tab to "<device> v<os>"; a desktop
    // browser session leaves the title as "Dashboard" (measured 2026-10-08, Mac
    // Safari), so the title alone would call it "not started" until the timeout.
    try { out.session = !!document.querySelector('[aria-label="Stop Session"]'); } catch (e) {}
    // The only sign that the picker itself is back on screen (a hidden or
    // detached search box has no size).
    try {
      var ps = document.querySelector('#device-search-field');
      if (ps) { var rc = ps.getBoundingClientRect(); out.picker = rc.width > 0 && rc.height > 0; }
    } catch (e) {}
    try {
      var banners = document.querySelectorAll('.notification-message-banner--error');
      for (var i = 0; i < banners.length && out.errors.length < 3; i++) {
        var t = clean(banners[i].textContent);
        if (t && out.errors.indexOf(t) < 0) out.errors.push(t);
      }
    } catch (e) {}
    try {
      var li = document.querySelector('li.switchDevtools-menu-wrapper');
      if (li) {
        out.devtools.present = true;
        out.devtools.disabled = li.getAttribute('aria-disabled') === 'true';
        if (out.devtools.disabled) {
          var msg = document.querySelector('#devtools_message');
          var tip = document.querySelector('#tooltip-switchDevtools');
          out.devtools.reason = clean((msg && msg.textContent) || (tip && tip.textContent) || '');
        }
      }
    } catch (e) {}
    try {
      // Only a real boolean counts: anything else means the dashboard changed
      // under this, and "Local was off" must never be reported on a guess.
      var lt = window.Reactor && window.Reactor.localTesting;
      if (lt && typeof lt.getLocalStatusAtStart === 'function') {
        var atStart = lt.getLocalStatusAtStart();
        if (typeof atStart === 'boolean') out.local = atStart;
      }
      if (lt && typeof lt.getIsForceLocalEnable === 'function') {
        var forced = lt.getIsForceLocalEnable();
        if (typeof forced === 'boolean') out.forceLocal = forced;
      }
    } catch (e) {}
    return out;
  }

  // A running Live session names its tab "<device> v<os>" ("iPhone 18 Pro
  // v27.0"); the picker and the boot screen do not carry a version.
  var BS_TITLE_RUNNING = /\s+v?\d+(?:\.\d+)+$/;
  // Live's tab title while it counts an idle session down to its end, measured
  // 2026-10-14: "60 seconds to session timeout" … "1 seconds to session
  // timeout", once a second, about 9 minutes after the last input (the account's
  // idle_timeout_for_devices is 10). It names no device, so whatever names the
  // device from the tab's title keeps the name it had.
  var BS_TITLE_COUNTDOWN = /^\s*\d+\s+seconds?\s+to\s+session\s+timeout\s*$/i;
  function bsIsCountdownTitle(title) { return BS_TITLE_COUNTDOWN.test(String(title == null ? '' : title)); }
  // Chrome's title for a Live tab that has not set its own yet: the tab's
  // address without the scheme. Measured 2026-10-14: chrome.tabs.get read
  // "live.browserstack.com/dashboard#os=android…" for a moment between "" and
  // "Dashboard" in 1 of 4 loads, and a Mac Safari launch's console line read
  // "mirror live.browserstack.com's console" for about 3 s.
  var BS_TITLE_LIVE_ADDRESS = /^\s*(?:https?:\/\/)?live\.browserstack\.com(?:[\/?#:]|\s*$)/i;
  // A Live tab's title that names no device: the idle countdown, or the
  // tab's own address while it loads. Whatever names the device from the
  // title keeps the name it had.
  function bsTitleNamesNothing(title) {
    var t = String(title == null ? '' : title);
    return BS_TITLE_COUNTDOWN.test(t) || BS_TITLE_LIVE_ADDRESS.test(t);
  }
  var BS_LAUNCH_GIVE_UP_MS = 75000;
  // The panel shows a stored launch report only this long (a reopened panel
  // reads it back): a "running" line from an hour ago is not what is on screen.
  var BS_LAUNCH_REPORT_MAX_AGE_MS = 10 * 60 * 1000;
  function bsClip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // One reading (bsLiveReadOutcome's, or null when the page could not be
  // read) turned into the state of the launch. opts: elapsedMs since the tab
  // opened; wasStarted when an earlier reading already saw it running; seen,
  // the last verdict that was made with the session toolbar on screen.
  //   starting  nothing decisive yet
  //   started   the tab is named for a running session, or the session
  //             toolbar's Stop Session control is on the page (a desktop browser
  //             session keeps the title "Dashboard"). Local and DevTools are
  //             read only once that toolbar is up, because the dashboard's
  //             Local-at-start record reads false until then, and carried over
  //             from `seen` while the toolbar is briefly gone.
  //   refused   Live put up an error banner while no session is running. After
  //             it had started (`afterStart`: a device can drop out ~10 s in with
  //             "Connection to the remote device failed") the picker must also be
  //             back on screen, because a desktop session shows nothing else of
  //             itself while its toolbar is away. A banner while a session IS
  //             running is some other toast and is ignored.
  //   ended     it was running, the picker is back on screen, and there is no
  //             banner. Not enough: "not running" alone, which is what a toolbar
  //             that has been re-rendering looks like for seconds.
  //   timeout   still nothing after BS_LAUNCH_GIVE_UP_MS
  function bsLaunchVerdict(read, opts) {
    opts = opts || {};
    var v = { state: 'starting', error: '', local: null, forceLocal: null, devtoolsOff: '', devtoolsPresent: false, toolbar: false };
    var seen = opts.seen && opts.seen.toolbar === true ? opts.seen : null;
    // What a toolbar reading learned about the session stands while the toolbar is away.
    function carry() {
      if (!seen) return;
      v.toolbar = true; v.local = seen.local; v.forceLocal = seen.forceLocal;
      v.devtoolsOff = seen.devtoolsOff; v.devtoolsPresent = seen.devtoolsPresent;
    }
    var r = read && typeof read === 'object' ? read : null;
    if (r) {
      var errors = Array.isArray(r.errors) ? r.errors : [];
      var running = BS_TITLE_RUNNING.test(String(r.title || '')) || r.session === true;
      // An error banner counts only when no session is running. Both measured
      // refusals ("Device is temporarily disabled", "Connection to the remote
      // device failed") put the dashboard back on the device picker as they
      // appear; a toast while a session is up (a recording that would not
      // start, say) belongs to something else and must not end the launch.
      if (errors.length && !running && (!opts.wasStarted || r.picker === true)) {
        v.state = 'refused';
        v.error = bsClip(errors[0], 200);
        v.afterStart = !!opts.wasStarted;
        return v;
      }
      if (running) {
        v.state = 'started';
        if (r.session === true) {
          v.toolbar = true;
          v.local = typeof r.local === 'boolean' ? r.local : null;
          v.forceLocal = typeof r.forceLocal === 'boolean' ? r.forceLocal : null;
          var d = r.devtools && typeof r.devtools === 'object' ? r.devtools : {};
          v.devtoolsPresent = d.present === true;
          // Live's own sentence, with the space it leaves out after "devices."
          if (d.disabled === true) v.devtoolsOff = bsClip(d.reason || "Live's DevTools is unavailable for this device.", 200).replace(/([a-z0-9])\.([A-Z])/g, '$1. $2');
        } else {
          carry();
        }
        return v;
      }
    }
    // It was running and this reading says it is not. Only the picker being back
    // on screen says it ended; a page that could not be read at all, or one with
    // nothing recognisable on it (the toolbar re-rendering), says nothing, so it
    // stays "started".
    if (opts.wasStarted) {
      if (r && r.picker === true) v.state = 'ended'; else { v.state = 'started'; carry(); }
      return v;
    }
    if ((opts.elapsedMs || 0) >= BS_LAUNCH_GIVE_UP_MS) v.state = 'timeout';
    return v;
  }

  // The Live tab finished loading somewhere that is not the dashboard before the
  // session started: Live sends a signed-out tester to a sign-in page. Only the
  // host is kept; the rest of the URL can carry anything.
  function bsLaunchLeft(url) {
    var m = /^([a-z][a-z0-9+.-]*):\/\/([^\/?#]*)/i.exec(String(url || ''));
    // chrome-error://chromewebdata/ is Chrome's page for a load that failed, not a place.
    if (m && m[1].toLowerCase() === 'chrome-error') return { state: 'left', host: 'chrome-error' };
    // The authority can carry credentials (user:pass@host); keep only what follows the last @.
    var host = m ? m[2].replace(/^.*@/, '') : '';
    return { state: 'left', host: bsClip(host, 80) };
  }

  // The status line for a launch. Plain text (the panel escapes it) and a tone:
  // ok, warn, err or info. offerManual asks for the "pick the device yourself"
  // button, shown when Live started the session without Local.
  //
  // Why that happens (measured 2026-10-08, Will's account): with start=true the
  // dashboard starts the session about 6.5 s after it loads, but its own check
  // for the Local app (first https://bs-local.com:45690, then
  // http://127.0.0.1:45691) only finishes at about 7.6 s. Its documented
  // wait-for-Local needs two account flags, and this account has the second
  // (waitForPollingInIntegrationFlow) off. So the session runs without Local
  // even though the app is connected, and the device shows BrowserStack's
  // "Unable to connect to the page you requested" for localhost and staging.
  function bsLaunchLine(v, ctx) {
    v = v || { state: 'starting' };
    ctx = ctx || {};
    var what = ctx.what || 'The device';
    // It had started and Live then took it away: "didn't start" would be false.
    if (v.state === 'refused' && v.afterStart) return { tone: 'err', offerManual: false, text: 'Live dropped the session on ' + what + '. Live says: ' + v.error };
    if (v.state === 'refused') return { tone: 'err', offerManual: false, text: what + " didn't start. Live says: " + v.error };
    if (v.state === 'closed') return { tone: 'info', offerManual: false, text: 'The Live tab for ' + what + ' was closed' + (v.wasStarted ? '.' : ' before it started.') };
    // The watch itself died (the worker was reloaded, say); the page can still be looked at.
    if (v.state === 'lost') return { tone: 'warn', offerManual: false, text: 'Selenite stopped watching this launch. Look at the Live tab.' };
    if (v.state === 'timeout') return { tone: 'warn', offerManual: false, text: what + " hasn't started after " + Math.round(BS_LAUNCH_GIVE_UP_MS / 1000) + ' s. Look at the Live tab.' };
    if (v.state === 'ended') return { tone: 'warn', offerManual: false, text: 'Live ended the session on ' + what + '.' };
    if (v.state === 'left' && v.host === 'chrome-error') return { tone: 'warn', offerManual: false, text: "The Live tab couldn't load (Chrome showed an error page). Check your connection, then open " + what + ' again.' };
    if (v.state === 'left') return { tone: 'warn', offerManual: false, text: 'The Live tab went to ' + (v.host || 'another page') + ' instead of the dashboard. If that is a sign-in page, sign in to BrowserStack there; if Live then starts the device, this line follows it. If not, open ' + what + ' again.' };
    if (v.state !== 'started') return { tone: 'info', offerManual: false, text: 'Opened ' + what + ' in BrowserStack Live. Waiting for Live to start the session…' };
    var tone = 'ok';
    var offerManual = false;
    var parts = [what + ' is running in BrowserStack Live.'];
    if (ctx.wantLocal) {
      if (v.local === true) {
        parts.push('Local was on when it started.');
      } else if (v.local === false && ctx.unconfirmed) {
        // "Open anyway": Selenite had already found that Live could not see the
        // Local app, so it was not a race Live lost; and picking the device by
        // hand would not help either.
        tone = 'warn';
        parts.push("BrowserStack Local wasn't connected when you opened it, so pages on localhost, staging or a VPN won't load.");
      } else if (v.local === false) {
        tone = 'warn';
        offerManual = true;
        parts.push("Live started it before it found your BrowserStack Local app, so pages on localhost, staging or a VPN won't load.");
      }
      if (v.local !== false && ctx.wantForceLocal && v.forceLocal === false) {
        tone = 'warn';
        parts.push('Live ignored "all traffic through this Mac"; switch it on in the session\'s Local panel (that reconnects the session).');
      }
    }
    if (v.devtoolsOff) parts.push("The console mirror can't run on it: " + v.devtoolsOff);
    return { tone: tone, offerManual: offerManual, text: parts.join(' ') };
  }

  g.BS_LIVE_DASHBOARD = BS_LIVE_DASHBOARD;
  g.BS_LOCAL_CONSOLE = BS_LOCAL_CONSOLE;
  g.BS_LOCAL_BINARY = BS_LOCAL_BINARY;
  g.BS_LOCAL_DOWNLOAD = BS_LOCAL_DOWNLOAD;
  g.BS_LAUNCH_GIVE_UP_MS = BS_LAUNCH_GIVE_UP_MS;
  g.BS_LAUNCH_REPORT_MAX_AGE_MS = BS_LAUNCH_REPORT_MAX_AGE_MS;
  g.BS_LIVE_PRESETS = BS_LIVE_PRESETS;
  g.BS_LIVE_KINDS = BS_LIVE_KINDS;
  g.BS_LIVE_DEFAULT_DEVICES = BS_LIVE_DEFAULT_DEVICES;
  g.bsPresetById = bsPresetById;
  g.bsSelectedPresets = bsSelectedPresets;
  g.bsNormalizePageUrl = bsNormalizePageUrl;
  g.bsFormEncode = bsFormEncode;
  g.bsLiveUrl = bsLiveUrl;
  g.bsIsLiveUrl = bsIsLiveUrl;
  g.bsIsLiveDashboardUrl = bsIsLiveDashboardUrl;
  g.bsIsCountdownTitle = bsIsCountdownTitle;
  g.bsTitleNamesNothing = bsTitleNamesNothing;
  g.bsDeviceEntry = bsDeviceEntry;
  g.bsLocalStatusFrom = bsLocalStatusFrom;
  g.bsLocalBinaryAnswer = bsLocalBinaryAnswer;
  g.bsLocalReadiness = bsLocalReadiness;
  g.bsDevtoolsSupport = bsDevtoolsSupport;
  g.bsLiveReadOutcome = bsLiveReadOutcome;
  g.bsLaunchVerdict = bsLaunchVerdict;
  g.bsLaunchLine = bsLaunchLine;
  g.bsLaunchLeft = bsLaunchLeft;
})(typeof globalThis !== 'undefined' ? globalThis : this);
