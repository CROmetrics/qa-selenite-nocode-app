# BrowserStack Live gate

An end-to-end check for the BrowserStack Live work, not a unit test: the **real extension** (this checkout, loaded
unpacked) in **real Chrome**, against a **fake `live.browserstack.com`** built from what was measured on the real
dashboard. It drives the real side panel, service worker, page reader, launch watcher and DevTools tap.

The jsc suites (`../browserstack.test.js`) cover the logic. This covers what they cannot see: a tab that has no `url`
yet when the worker first looks at it, Chrome's real `executeScript` and tab events, both panel pages booting, the
page-to-bridge-to-worker-to-panel path, and a page whose state changes over seconds. It found three bugs the jsc
suites could not (a watcher that quit on a just-created tab, a desktop session never read as running, and a Live tab
that was never followed because it was still loading).

CI does not run it: it needs branded Chrome. Run it before landing a change to `bs-live-tap.js`,
`bs-live-bridge.js`, `browserstack.js` or the Live parts of `popup.js` and `background.js`.

## Run

```
python3 -I -u extension/tests/browserstack-gate/gate.py            # all scenarios, about five minutes, headless
python3 -I -u extension/tests/browserstack-gate/gate.py vanish ended
python3 -I -u extension/tests/browserstack-gate/gate.py --list
```

Needs macOS or Linux, Google Chrome 154 or later (`CHROME_BIN` points at the executable if it is not in the
macOS default place), Python 3 and `openssl`; nothing else is installed. It prints `ok` / `FAIL` per check and
exits non-zero on any failure.

| Setting | Meaning |
|---|---|
| `GATE_PORT` | port of the fake Live (default 8443) |
| `GATE_REAL_LOCAL` | use the BrowserStack Local app on this machine instead of the built-in fake one |

## How it works

- Branded Chrome ignores `--load-extension`, so Chrome is started with `--remote-debugging-pipe
  --enable-unsafe-extension-debugging` and sent `Extensions.loadUnpacked` over the pipe (`cdp.py`, about 110 lines).
- `fake_live.py` serves a self-signed `https://live.browserstack.com` and `www.browserstack.com` on 127.0.0.1;
  Chrome maps both hosts there with `--host-resolver-rules` and ignores certificate errors. The certificate is
  generated into a temp directory every run (no key material is kept). The same file has a fake Local app, on two free
  ports, which the panel is pointed at.
- `gate.py` opens `popup.html` as a tab (it connects like the side panel), changes what it needs through the page's
  own globals, clicks the real buttons, and reads the status line, the worker's records and the Live tab itself.
- The fake dashboard picks a scenario from the link's `device` / `browser`, as the real one does. A `sim=` value
  (unknown to the real dashboard) picks a variant: `lag`, `vanish`, `signin`, `toast`, `localok`.

## What the fake models

All of it measured on real sessions (2026-10-08; see CHANGELOG.md, "Measured on real sessions"):

- the device picker's search box on screen at first, gone from boot, and back when a session ends;
- a phone's tab renamed `<device> v<os>` before its toolbar exists, and the dashboard's Local-at-start record reading
  false until that toolbar renders (`sim=lag`);
- the session toolbar rendering, going away for about 4 s, and coming back (`sim=vanish`);
- a desktop session keeping the title "Dashboard", with a toolbar of eleven items and no DevTools item;
- iOS 27's disabled DevTools item, with Live's own message and tooltip;
- a refused device (`iPhone 17` at 26.1), a session that drops after starting (`Pixel 10`), an error toast beside a
  running session (`sim=toast`), and a redirect to sign in (`sim=signin`);
- Live's DevTools: a same-origin `iframe.devtools-iframe` holding a frontend with `SDK.ConsoleModel`,
  `SDK.targetManager` and `UI.context`, which can have a console and no device behind it.

## Scenarios

| Scenario | What it proves |
|---|---|
| `smoke` | the extension loads and the panel has its Live sections |
| `check` | the Check button asks the Local app's binary port, not just its console |
| `local-missed` | Live starting a session without Local is reported, with the manual route, and the manual button opens a link without `start=true` |
| `ios27` | iOS 27: running, Local state, and why there is no console mirror, in Live's words |
| `refused` | a refused device ends the watch with Live's own banner text |
| `dropped` | a session that starts and then drops is reported as dropped, not as never started |
| `desktop` | a desktop session is recognised as running by its Stop Session control |
| `not-ready` | Local not connected holds the launch; "Open anyway" does not claim Local |
| `mirror` | the console mirror end to end: closed, connected, attaching, late, a command refused while detached, and run when attached |
| `mirror-slow` | a Live tab still loading when Selenite first looks at it is followed anyway |
| `mirror-unavailable` | iOS 27 and desktop: no DevTools, and the panel says so and why |
| `panels` | `popup.html` and `sidepanel.html` both boot without an error and mark the presets with no mirror |
| `closed` | closing the Live tab before and after it started is reported |
| `left` | Live sending the tab to sign in is reported by host, and the line follows the session when it starts |
| `toast` | an error toast beside a running session is not a refusal |
| `relaunch` | two quick launches leave one tab and never report the earlier one as closed |
| `places` | a Functional Testing launch has its own record and line |
| `vanish` | a desktop session whose toolbar goes away for 4 s is not reported as ended |
| `early-title` | a phone whose title says running before its toolbar makes no claim about Local until the toolbar can say it |
| `ended` | stopping the session in Live is reported once the picker is back |

## Limits and traps

- It is a model of the dashboard. The last check of a change to the launch watcher should still be the real page:
  the CHANGELOG ("Real BrowserStack Live") describes running the real functions inside a signed-in Live tab.
- Run it with `python3 -u` when redirecting output; stdout is block-buffered otherwise and the file stays empty.
- Do not edit `extension/` while it runs: a service worker that restarts re-reads its files from disk.
- A scenario starts from a clean slate (it clears `bsLaunch_*` and `bsLiveTabId` and waits for the watchers of the
  scenario before to end), because session storage lasts for the whole browser run.
