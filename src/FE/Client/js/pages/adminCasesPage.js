import { adminApi } from '../api/adminApi.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';

export async function renderAdminCasesPage(app) {
  render(app, `<div class="page"><p class="muted">${tr('Loading cases…', 'Đang tải vụ án…')}</p></div>`);

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
      <td class="muted small">${c.stageCount} ${tr('stages', 'giai đoạn')} · ${c.sceneCount} ${tr('scenes', 'hiện trường')} · ${c.clueCount} ${tr('clues', 'manh mối')}</td>
      <td>
        ${c.status === 'PUBLISHED'
          ? `<button class="btn btn-ghost btn-sm" data-unpublish="${escapeHtml(c.caseId)}">${tr('Unpublish', 'Gỡ xuất bản')}</button>`
          : `<button class="btn btn-primary btn-sm" data-publish="${escapeHtml(c.caseId)}">${tr('Publish', 'Xuất bản')}</button>`}
      </td>
    </tr>`).join('');

  render(app, `
  <div class="page">
    <div class="page-head">
      <h2>${tr('All Cases', 'Tất cả vụ án')}</h2>
      <div class="case-actions">
        <a class="btn btn-primary" href="#/admin/import">${tr('Import JSON', 'Nhập JSON')}</a>
        <a class="btn btn-ghost" href="#/admin/ai">${tr('AI creator', 'Tạo bằng AI')}</a>
      </div>
    </div>
    ${cases.length === 0
      ? `<div class="empty-state">${tr('No cases yet — seed the sample from the dashboard or import JSON.', 'Chưa có vụ án — hãy tạo vụ án mẫu từ bảng điều khiển hoặc nhập JSON.')}</div>`
      : `<table class="admin-table">
          <thead><tr><th>${tr('Case', 'Vụ án')}</th><th>${tr('Status', 'Trạng thái')}</th><th>${tr('Content', 'Nội dung')}</th><th></th></tr></thead>
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
  bind('[data-publish]', adminApi.publishCase, tr('published', 'đã xuất bản'));
  bind('[data-unpublish]', adminApi.unpublishCase, tr('unpublished', 'đã gỡ xuất bản'));
}
