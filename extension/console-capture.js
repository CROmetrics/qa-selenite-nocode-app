// Selenite console capture — runs in MAIN world to intercept the page's console
(function () {
  if (window.__seleniteCapture) return;
  window.__seleniteCapture = true;

  const TAGS     = ['[PjS]', '[cro]'];
  const LEVEL_MAP = { log: 'BROWSER', info: 'INFO', warn: 'WARNING', error: 'ERROR', debug: 'BROWSER' };
  const originals = {};

  function stringify(a) {
    if (typeof a === 'object' && a !== null) { try { return JSON.stringify(a); } catch (_) {} }
    return String(a);
  }

  function relay(level, args) {
    const text = args.map(stringify).join(' ');
    if (!TAGS.some(tag => text.includes(tag))) return;
    window.postMessage({ __selenite: true, level, text }, '*');
  }

  Object.keys(LEVEL_MAP).forEach(method => {
    originals[method] = console[method].bind(console);
    console[method] = function (...args) {
      originals[method](...args);
      relay(LEVEL_MAP[method], args);
    };
  });

  window.__seleniteCaptureRestore = () => {
    Object.keys(originals).forEach(m => { console[m] = originals[m]; });
    window.__seleniteCapture = false;
    window.__seleniteCaptureRestore = null;
  };
})();
