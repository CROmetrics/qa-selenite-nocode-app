// Selenite session recorder — injected into the recorded tab (ISOLATED world)
// by the Session Replay / Heatmap mode. Captures clicks, scroll behavior, and
// (optionally) low-rate sampled mouse movement, batching events to the
// background service worker, which owns the live session buffer. Keystrokes
// and input field values are deliberately never captured.
//
// Originally created and developed by William Wiley. Forked for Cro Metrics.
(function () {
  if (window.__seleniteRecorder) return;
  window.__seleniteRecorder = true;

  const captureMove = !!window.__seleniteRecMove;
  const buildSelector = window.__seleniteBuildSelector;
  let buf = [];

  function pageDims() {
    const doc = document.documentElement;
    return {
      pageW: Math.max(doc.scrollWidth, doc.clientWidth),
      pageH: Math.max(doc.scrollHeight, doc.clientHeight),
    };
  }

  function send(action, payload) {
    try { chrome.runtime.sendMessage({ action, ...payload }); } catch (_) {}
  }

  // Segment context — one per page visited during the session. The overlay
  // needs record-time page dimensions to place points after layout drift.
  send('sessionSegment', {
    segment: {
      url: location.href, t: Date.now(),
      viewportW: window.innerWidth, viewportH: window.innerHeight,
      ...pageDims(),
    },
  });

  function flush() {
    if (!buf.length) return;
    const events = buf;
    buf = [];
    send('sessionEvents', { events });
  }
  const flushTimer = setInterval(flush, 1000);

  function onClick(e) {
    let sel = '';
    try { sel = buildSelector ? (buildSelector(e.target).css || '') : ''; } catch (_) {}
    buf.push({ type: 'click', t: Date.now(), x: e.pageX, y: e.pageY, vx: e.clientX, vy: e.clientY, sel });
  }

  let lastScroll = 0;
  let maxDepth = 0;
  function onScroll() {
    const now = Date.now();
    if (now - lastScroll < 250) return;   // ~4 samples/sec
    lastScroll = now;
    const doc = document.documentElement;
    const depth = Math.min(100, Math.round(((window.scrollY + window.innerHeight) / Math.max(1, doc.scrollHeight)) * 100));
    if (depth > maxDepth) maxDepth = depth;
    buf.push({ type: 'scroll', t: now, y: window.scrollY, depth, maxDepth });
  }

  let lastMove = 0;
  function onMove(e) {
    const now = Date.now();
    if (now - lastMove < 200) return;     // 5 Hz — coarse attention trail
    lastMove = now;
    buf.push({ type: 'move', t: now, x: e.pageX, y: e.pageY });
  }

  window.addEventListener('click', onClick, true);
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  if (captureMove) window.addEventListener('mousemove', onMove, { capture: true, passive: true });

  window.__seleniteRecorderStop = () => {
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('scroll', onScroll, { capture: true });
    if (captureMove) window.removeEventListener('mousemove', onMove, { capture: true });
    clearInterval(flushTimer);
    flush();
    window.__seleniteRecorder = false;
    window.__seleniteRecorderStop = null;
  };
})();
