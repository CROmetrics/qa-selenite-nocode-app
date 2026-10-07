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
    { id: 'iphone-17',      kind: 'phone',   label: 'iPhone 17',       detail: 'iOS 26.1 · Safari',
      os: 'ios', os_version: '26.1', device: 'iPhone 17', device_browser: 'safari' },
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
    pairs.push(['start', 'true']);
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

  g.BS_LIVE_DASHBOARD = BS_LIVE_DASHBOARD;
  g.BS_LOCAL_CONSOLE = BS_LOCAL_CONSOLE;
  g.BS_LOCAL_DOWNLOAD = BS_LOCAL_DOWNLOAD;
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
  g.bsDeviceEntry = bsDeviceEntry;
  g.bsLocalStatusFrom = bsLocalStatusFrom;
})(typeof globalThis !== 'undefined' ? globalThis : this);
