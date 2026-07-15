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

  // ── Interactive element preference ────────────────────────────────────────
  const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);

  // Walk up from el to find the nearest interactive ancestor (max 5 levels).
  // Falls back to el itself if none found.
  function preferInteractive(el) {
    let cur = el;
    for (let i = 0; i < 5; i++) {
      if (!cur || cur === document.body) break;
      if (INTERACTIVE.has(cur.tagName)) return cur;
      cur = cur.parentElement;
    }
    return el;
  }

  // ── Selector builder ───────────────────────────────────────────────────────
  // Shared with the session recorder — lives in selector.js, which background
  // injects alongside this file.
  const buildSelector = window.__seleniteBuildSelector;

  // ── Interaction ────────────────────────────────────────────────────────────
  function getTarget(e) {
    overlay.style.pointerEvents = 'none';
    const raw = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = '';
    return raw ? preferInteractive(raw) : null;
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
