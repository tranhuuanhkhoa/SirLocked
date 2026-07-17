import { adminApi } from '../api/adminApi.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';

export async function renderAdminCaseDetailPage(app, caseId) {
  render(app, `<div class="page"><p class="muted">${tr('Loading case…', 'Đang tải vụ án…')}</p></div>`);

  let gameCase;
  try {
    gameCase = await adminApi.caseDetail(decodeURIComponent(caseId));
  } catch (err) {
    render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
    return;
  }

  render(app, `
  <div class="page">
    <a class="muted small" href="#/admin/cases">&larr; ${tr('All cases', 'Tất cả vụ án')}</a>
    <div class="page-head">
      <h2>${escapeHtml(gameCase.title)} <span class="chip ${gameCase.status === 'PUBLISHED' ? 'chip-ok' : ''}">${gameCase.status}</span></h2>
      <div class="case-actions">
        <button class="btn btn-ghost" id="validate-btn">${tr('Validate', 'Kiểm tra')}</button>
        ${gameCase.status === 'PUBLISHED'
          ? `<button class="btn btn-ghost" id="unpublish-btn">${tr('Unpublish', 'Gỡ xuất bản')}</button>`
          : `<button class="btn btn-primary" id="publish-btn">${tr('Publish', 'Xuất bản')}</button>`}
      </div>
    </div>
    <p class="muted">${escapeHtml(gameCase.summary)}</p>
    <div id="validation-output"></div>
    <h3 class="section-title">${tr('Case JSON', 'JSON vụ án')}</h3>
    <pre class="json-view">${escapeHtml(JSON.stringify(gameCase, null, 2))}</pre>
  </div>`);

  const output = qs('#validation-output', app);

  qs('#validate-btn', app).addEventListener('click', async () => {
    try {
      const result = await adminApi.validateCase(gameCase);
      output.innerHTML = result.isValid
        ? `<div class="notice notice-ok">${tr('Validation passed — this case is playable.', 'Kiểm tra thành công — vụ án có thể chơi được.')}</div>`
        : `<div class="notice notice-bad"><strong>${result.errors.length} ${tr('validation error(s):', 'lỗi kiểm tra:')}</strong>
            <ul>${result.errors.map((e) => `<li><code>${escapeHtml(e.code)}</code> ${escapeHtml(e.path)} — ${escapeHtml(e.message)}</li>`).join('')}</ul></div>`;
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  qs('#publish-btn', app)?.addEventListener('click', async () => {
    try {
      await adminApi.publishCase(gameCase.caseId);
      toast(tr('Case published.', 'Đã xuất bản vụ án.'), 'success');
      renderAdminCaseDetailPage(app, caseId);
    } catch (err) {
      toast(err.message, 'error');
      if (err.errors) {
        output.innerHTML = `<div class="notice notice-bad"><strong>${tr('Publish blocked by validation:', 'Không thể xuất bản do lỗi kiểm tra:')}</strong>
          <ul>${(err.errors ?? []).map((e) => `<li><code>${escapeHtml(e.code)}</code> ${escapeHtml(e.path)} — ${escapeHtml(e.message)}</li>`).join('')}</ul></div>`;
      }
    }
  });

  qs('#unpublish-btn', app)?.addEventListener('click', async () => {
    try {
      await adminApi.unpublishCase(gameCase.caseId);
      toast(tr('Case unpublished.', 'Đã gỡ xuất bản vụ án.'), 'success');
      renderAdminCaseDetailPage(app, caseId);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
