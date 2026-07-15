// Selenite shared selector builder — derives a readable, unique CSS selector
// for an element. Used by both the element picker (picker.js) and the session
// recorder (recorder.js); background injects this file before either of them.
//
// Originally created and developed by William Wiley. Forked for Cro Metrics.
(function () {
  if (window.__seleniteBuildSelector) return;

  const SKIP = new Set(['HTML', 'BODY', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'SECTION', 'ARTICLE']);

  window.__seleniteBuildSelector = function buildSelector(el) {
    if (el.id) return { idValue: el.id, css: '#' + CSS.escape(el.id) };

    // For <a> tags, try href-based selector first (very readable)
    if (el.tagName === 'A' && el.getAttribute('href')) {
      const href = el.getAttribute('href');
      try {
        if (document.querySelectorAll(`a[href="${href}"]`).length === 1) {
          return { idValue: null, css: `a[href="${href}"]` };
        }
      } catch (_) {}
    }

    // Walk up building a unique CSS path
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      let seg = cur.tagName.toLowerCase();
      const cls = [...cur.classList].filter(c => !/^\d/.test(c) && c.length < 40).slice(0, 2);
      if (cls.length) seg += cls.map(c => '.' + CSS.escape(c)).join('');
      const siblings = cur.parentElement
        ? [...cur.parentElement.children].filter(c => c.tagName === cur.tagName)
        : [];
      if (siblings.length > 1) {
        seg += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
      }
      parts.unshift(seg);
      if (!SKIP.has(cur.tagName) && document.querySelectorAll(parts.join(' > ')).length === 1) break;
      cur = cur.parentElement;
    }
    return { idValue: null, css: parts.join(' > ') };
  };
})();
