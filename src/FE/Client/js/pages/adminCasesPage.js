import { adminApi } from '../api/adminApi.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

export async function renderAdminCasesPage(app) {
  render(app, '<div class="page"><p class="muted">Loading cases…</p></div>');

  let cases;
  try {
    cases = await adminApi.cases();
  } catch (err) {
    render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
    return;
  }

  const rows = cases.map((c) => `
    <tr>
      <td><a href="#/admin/cases/${encodeURIComponent(c.caseId)}">${escapeHtml(c.title)}</a><br>
          <span class="muted small">${escapeHtml(c.caseId)}</span></td>
      <td><span class="chip ${c.status === 'PUBLISHED' ? 'chip-ok' : ''}">${c.status}</span></td>
      <td class="muted small">${c.stageCount} stages · ${c.sceneCount} scenes · ${c.clueCount} clues</td>
      <td>
        ${c.status === 'PUBLISHED'
          ? `<button class="btn btn-ghost btn-sm" data-unpublish="${escapeHtml(c.caseId)}">Unpublish</button>`
          : `<button class="btn btn-primary btn-sm" data-publish="${escapeHtml(c.caseId)}">Publish</button>`}
      </td>
    </tr>`).join('');

  render(app, `
  <div class="page">
    <div class="page-head">
      <h2>All Cases</h2>
      <div class="case-actions">
        <a class="btn btn-primary" href="#/admin/import">Import JSON</a>
        <a class="btn btn-ghost" href="#/admin/ai">AI creator</a>
      </div>
    </div>
    ${cases.length === 0
      ? '<div class="empty-state">No cases yet — seed the sample from the dashboard or import JSON.</div>'
      : `<table class="admin-table">
          <thead><tr><th>Case</th><th>Status</th><th>Content</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`}
  </div>`);

  const bind = (selector, action, label) =>
    app.querySelectorAll(selector).forEach((btn) =>
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await action(btn.dataset.publish || btn.dataset.unpublish);
          toast(`Case ${label}.`, 'success');
          renderAdminCasesPage(app);
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
        }
      }));
  bind('[data-publish]', adminApi.publishCase, 'published');
  bind('[data-unpublish]', adminApi.unpublishCase, 'unpublished');
}
