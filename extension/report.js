// Renders a Matrix Auditor report in its own bundled extension page. The popup
// stashes the report body under chrome.storage.session['mxReports'][id] and
// opens report.html?k=<id>; this script reads it back and injects it. Bundled
// (script-src 'self') so it satisfies the MV3 extension-page CSP — an inline
// <script> or a blob: page would not.
(async () => {
  const content = document.getElementById('mx-report-content');
  const printBtn = document.getElementById('mx-print-btn');
  printBtn?.addEventListener('click', () => window.print());

  const id = new URLSearchParams(location.search).get('k');
  if (!id) {
    content.innerHTML = '<p class="rpt-muted">No report id in the URL.</p>';
    return;
  }
  try {
    const { mxReports = {} } = await chrome.storage.session.get('mxReports');
    const report = mxReports[id];
    if (!report) {
      content.innerHTML = '<p class="rpt-muted">Report data not found — it may have expired (only the most recent few are kept). Re-run the audit or click View Report again.</p>';
      return;
    }
    if (report.title) document.title = report.title;
    content.innerHTML = report.bodyHtml || '';
  } catch (e) {
    content.innerHTML = '<p class="rpt-muted">Could not load report: ' + (e && e.message ? e.message : String(e)) + '</p>';
  }
})();
