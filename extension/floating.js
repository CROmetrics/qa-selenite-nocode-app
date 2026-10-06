// Selenite floating window — the page background.js openFloating opens when
// the toolbar icon is clicked and Selenite is not pinned.
//
// Chrome's side panel docks beside the page and shrinks the tab's viewport, so
// the page under test reflows while it is open and is captured narrower than
// its window. This page is a popup window of its own instead, and holds the
// real UI (sidepanel.html + popup.js) in an iframe bound to the browser window
// it was opened for (?win=). Nothing is injected into the page.
//
// Pinning (📌, popup.js) docks Selenite into Chrome's side panel instead, and
// the side panel's own load closes this window, so one window never has two
// copies of the UI.

const WIN = parseInt(new URLSearchParams(location.search).get('win'), 10);

// The toolbar icon, clicked while this window is already open: Chrome covers
// it whenever the page is clicked, so bring it back.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.action !== 'floatFocus' || msg.winId !== WIN) return;
  chrome.windows.getCurrent()
    .then(w => chrome.windows.update(w.id, { state: 'normal', focused: true }))
    .catch(() => {});
});

if (Number.isInteger(WIN)) {
  const f = document.createElement('iframe');
  f.src = chrome.runtime.getURL('sidepanel.html') + '?win=' + WIN + '&host=window';
  f.title = 'Selenite';
  f.style.cssText = 'display:block;width:100%;height:100%;border:0';
  document.body.appendChild(f);
} else {
  document.body.textContent = 'Selenite: no browser window to attach to. Close this window and click the Selenite icon again.';
}
