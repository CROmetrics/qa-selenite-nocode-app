// Selenite A/B error collector — runs in the MAIN world of a variant tab while
// the A/B run captures it (background.js captureVariant). Records uncaught
// errors and unhandled rejections in window.__abErrors, which captureVariant
// reads once the page has settled. console-capture.js only sees console.*
// calls, so this fills the JS-error gap without the debugger attached.
//
// Registered at document_start for the length of a capture (so an error thrown
// while the page loads is caught) and injected again after load; it records
// once however many times it runs.
(function () {
  if (window.__abErrors) return;
  window.__abErrors = [];
  window.addEventListener('error', e =>
    window.__abErrors.push(String(e.message || 'Script error') + (e.filename ? ` (${e.filename}:${e.lineno})` : '')));
  window.addEventListener('unhandledrejection', e =>
    window.__abErrors.push('Unhandled rejection: ' + String((e.reason && e.reason.message) || e.reason || '')));
})();
