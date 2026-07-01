// Selenite console capture — runs in MAIN world to intercept the page's console.
// Lightweight, always tag-only: this feeds the Test Results panel with CRO/PJS
// signal (metric fires, variant activations, etc). The genuine full mirror of
// everything lives in the Browser Console tab via chrome.debugger/CDP instead.
(function () {
  if (window.__seleniteCapture) return;
  window.__seleniteCapture = true;

  // Matched case-insensitively — Optimizely emits "[PJS]" (all caps), not "[PjS]".
  const TAGS     = ['[pjs]', '[cro]'];
  const LEVEL_MAP = { log: 'BROWSER', info: 'INFO', warn: 'WARNING', error: 'ERROR', debug: 'BROWSER' };
  const originals = {};

  function stringify(a) {
    if (typeof a === 'object' && a !== null) { try { return JSON.stringify(a); } catch (_) {} }
    return String(a);
  }

  function relay(level, args) {
    // Tagged logs are typically console.log('%c[PJS]', 'color:...', 'message').
    // The %c directive consumes the next arg as a CSS string that DevTools uses
    // to style a badge — strip both so stored text doesn't carry raw CSS noise.
    let text;
    if (typeof args[0] === 'string' && args[0].includes('%c')) {
      const cCount = (args[0].match(/%c/g) || []).length;
      const label  = args[0].replace(/%c/g, '').trim();
      const rest   = args.slice(1 + cCount);
      text = [label, ...rest.map(stringify)].join(' ').trim();
    } else {
      text = args.map(stringify).join(' ');
    }
    if (!TAGS.some(tag => text.toLowerCase().includes(tag))) return;
    window.postMessage({ __selenite: true, level, text, tagged: true }, '*');
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
