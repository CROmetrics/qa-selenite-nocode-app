// Renders the Test Agent "Selenite QA Report" in its own bundled extension page.
// runTestAgent stashes the report body under chrome.storage.session['taReports'][id]
// and opens qa-report.html?k=<id>; this script reads it back and injects it.
// Bundled (script-src 'self') so it satisfies the MV3 extension-page CSP — an
// inline <script>, an inline onclick, or a blob: page would not. Deliberately a
// sibling of report.js (Matrix Auditor) rather than shared: the two reports
// have distinct .rpt-* CSS shells living in their own HTML files.
(async () => {
  const content = document.getElementById('qa-report-content');
  const printBtn = document.getElementById('qa-print-btn');
  printBtn?.addEventListener('click', () => window.print());

  const id = new URLSearchParams(location.search).get('k');
  if (!id) {
    content.innerHTML = '<p class="rpt-muted">No report id in the URL.</p>';
    return;
  }
  try {
    const { taReports = {} } = await chrome.storage.session.get('taReports');
    const report = taReports[id];
    if (!report) {
      content.innerHTML = '<p class="rpt-muted">Report data not found — it may have expired (only the most recent few are kept). Re-run the Test Agent to generate a fresh report.</p>';
      return;
    }
    if (report.title) document.title = report.title;
    content.innerHTML = report.bodyHtml || '';
  } catch (e) {
    content.innerHTML = '<p class="rpt-muted">Could not load report: ' + (e && e.message ? e.message : String(e)) + '</p>';
  }
})();
