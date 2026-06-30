// Selenite console bridge — runs in ISOLATED world
// Receives postMessage events from the MAIN-world capture script and forwards them to the background
(function () {
  if (window.__seleniteBridge) return;
  window.__seleniteBridge = true;

  window.addEventListener('message', (e) => {
    if (!e.data?.__selenite) return;
    try {
      chrome.runtime.sendMessage({ action: 'browserLog', level: e.data.level, text: e.data.text });
    } catch (_) {}
  });
})();
