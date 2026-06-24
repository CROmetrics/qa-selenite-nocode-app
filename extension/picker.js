// Selenite element picker — injected into the page on demand
(function () {
  if (window.__selenitePicker) return;
  window.__selenitePicker = true;

  // ── Elements ───────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647', 'cursor:crosshair',
  ].join(';');

  const highlight = document.createElement('div');
  highlight.style.cssText = [
    'position:fixed', 'z-index:2147483646', 'pointer-events:none',
    'border:2px solid #0078D4', 'background:rgba(0,120,212,0.12)',
    'border-radius:3px', 'box-sizing:border-box', 'display:none',
    'transition:none',
  ].join(';');

  const badge = document.createElement('div');
  badge.style.cssText = [
    'position:fixed', 'z-index:2147483647', 'pointer-events:none',
    'background:#0078D4', 'color:#fff', 'font:bold 11px/1.4 monospace',
    'padding:4px 8px', 'border-radius:4px', 'max-width:320px',
    'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
    'display:none', 'box-shadow:0 2px 8px rgba(0,0,0,.4)',
  ].join(';');

  const hint = document.createElement('div');
  hint.textContent = 'Click an element to select it   •   Esc to cancel';
  hint.style.cssText = [
    'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:2147483647', 'pointer-events:none',
    'background:rgba(0,0,0,.75)', 'color:#fff', 'font:12px/1.5 sans-serif',
    'padding:6px 14px', 'border-radius:20px',
    'box-shadow:0 2px 8px rgba(0,0,0,.4)',
  ].join(';');

  document.body.append(overlay, highlight, badge, hint);

  // ── Selector builder ───────────────────────────────────────────────────────
  function buildSelector(el) {
    // Prefer id
    if (el.id) return { idValue: el.id, css: '#' + CSS.escape(el.id) };

    // Walk up building a unique CSS path
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      const cls = [...cur.classList].filter(c => !/^\d/.test(c)).slice(0, 2);
      if (cls.length) seg += cls.map(c => '.' + CSS.escape(c)).join('');
      const siblings = cur.parentElement
        ? [...cur.parentElement.children].filter(c => c.tagName === cur.tagName)
        : [];
      if (siblings.length > 1) {
        seg += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
      }
      parts.unshift(seg);
      if (document.querySelectorAll(parts.join(' > ')).length === 1) break;
      cur = cur.parentElement;
    }
    return { idValue: null, css: parts.join(' > ') };
  }

  // ── Interaction ────────────────────────────────────────────────────────────
  function getTarget(e) {
    overlay.style.pointerEvents = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = '';
    return el;
  }

  overlay.addEventListener('mousemove', (e) => {
    const el = getTarget(e);
    if (!el) return;
    const r = el.getBoundingClientRect();
    Object.assign(highlight.style, {
      display: 'block',
      left:   r.left + 'px',
      top:    r.top  + 'px',
      width:  r.width  + 'px',
      height: r.height + 'px',
    });
    const { css } = buildSelector(el);
    badge.textContent = css;
    badge.style.display = 'block';
    const bx = Math.min(e.clientX + 12, window.innerWidth - 340);
    const by = e.clientY + 20 + badge.offsetHeight > window.innerHeight
      ? e.clientY - badge.offsetHeight - 8
      : e.clientY + 20;
    badge.style.left = bx + 'px';
    badge.style.top  = by + 'px';
  });

  overlay.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = getTarget(e);
    if (!el) return cleanup();
    const sel = buildSelector(el);
    cleanup();
    chrome.runtime.sendMessage({ action: 'pickerResult', selector: sel });
  });

  document.addEventListener('keydown', onKey, true);
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
      chrome.runtime.sendMessage({ action: 'pickerCancel' });
    }
  }

  function cleanup() {
    overlay.remove();
    highlight.remove();
    badge.remove();
    hint.remove();
    document.removeEventListener('keydown', onKey, true);
    window.__selenitePicker = false;
  }
})();
