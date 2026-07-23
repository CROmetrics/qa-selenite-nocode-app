// Renders a screenshot (a large data: URL) in its own bundled extension page.
// The panel stashes the image under chrome.storage.session['taImages'][id] and
// opens image.html?k=<id>; this reads it back and sets it as the <img> src.
// Bundled (script-src 'self') to satisfy the MV3 extension-page CSP, and needed
// because recent Chrome blocks opening a data: or extension-created blob: URL
// as a top-level navigation (the tab loads with an error). A data: URL as an
// <img> src is a subresource, not a navigation, so it renders fine.
(async () => {
  const img = document.getElementById('ta-image');
  const msg = document.getElementById('ta-image-msg');
  const fail = (text) => { msg.textContent = text; msg.style.display = ''; img.style.display = 'none'; };

  const id = new URLSearchParams(location.search).get('k');
  if (!id) { fail('No image id in the URL.'); return; }
  try {
    const { taImages = {} } = await chrome.storage.session.get('taImages');
    const dataUrl = taImages[id];
    if (!dataUrl) { fail('Image data not found — it may have expired. Click the thumbnail again.'); return; }
    img.onload = () => { msg.style.display = 'none'; img.style.display = ''; };
    img.onerror = () => fail('Could not decode the image.');
    img.src = dataUrl;
  } catch (e) {
    fail('Could not load image: ' + (e && e.message ? e.message : String(e)));
  }
})();
