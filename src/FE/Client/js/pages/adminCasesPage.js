import { adminApi } from '../api/adminApi.js';
import { aiCaseApi } from '../api/aiCaseApi.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';
import { isV3, v3PublishGate } from './adminV3Gates.js';

// Older (non-pixel) cases are hidden by the server; this switch asks for them too. Per browser tab, never saved.
let showLegacy = false;

export async function renderAdminCasesPage(app) {
  render(app, `<div class="page"><p class="muted">${tr('Loading cases…', 'Đang tải vụ án…')}</p></div>`);

  let cases;
  let capabilities = null;
  try {
    cases = await adminApi.cases(showLegacy);
    capabilities = await aiCaseApi.capabilities().catch(() => null);
  } catch (err) {
    render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
    return;
  }

  const rows = cases.map((c) => {
    const gate = v3PublishGate(c, capabilities);
    const publishControl = c.status === 'PUBLISHED'
      ? `<button class="btn btn-ghost btn-sm" data-unpublish="${escapeHtml(c.caseId)}">${tr('Unpublish', 'Gỡ xuất bản')}</button>`
      : gate.canPublish
        ? `<button class="btn btn-primary btn-sm" data-publish="${escapeHtml(c.caseId)}">${tr('Publish', 'Xuất bản')}</button>`
        : `<button class="btn btn-ghost btn-sm" disabled title="${escapeHtml(gate.reason)}">${tr('Publish blocked', 'Chưa thể xuất bản')}</button>`;
    return `
    <tr>
      <td><a href="/admin/cases/${encodeURIComponent(c.caseId)}">${escapeHtml(c.title)}</a><br>
          <span class="muted small">${escapeHtml(c.caseId)}</span>
          ${c.isPixel ? `<br><span class="chip chip-ok">PIXEL</span>` : c.status === 'PUBLISHED' && c.playerVisible === false ? `<br><span class="chip chip-bad" title="${tr('Still in the database and in old rooms, but players cannot pick it.', 'Vẫn còn trong dữ liệu và các phòng cũ, nhưng người chơi không chọn được.')}">${tr('OLD · hidden from players', 'CŨ · ẩn với người chơi')}</span>` : ''}
          ${isV3(c) ? `<br><span class="chip chip-gold">V3 · Crack</span>${c.hasSourceAiDraft ? ` <span class="chip ${c.aiSemanticReviewStatus === 'PASSED' ? 'chip-ok' : 'chip-bad'}">Review ${escapeHtml(c.aiSemanticReviewStatus || 'NOT_RUN')}</span>` : ''}` : ''}</td>
      <td><span class="chip ${c.status === 'PUBLISHED' ? 'chip-ok' : ''}">${c.status}</span></td>
      <td class="muted small">${c.stageCount} ${tr('stages', 'giai đoạn')} · ${c.sceneCount} ${tr('scenes', 'hiện trường')} · ${c.clueCount} ${tr('clues', 'manh mối')}</td>
      <td>
        ${publishControl}
        ${c.status !== 'PUBLISHED' && !gate.canPublish ? `<div class="muted small v3-gate-reason">${escapeHtml(gate.reason)}</div>` : ''}
      </td>
    </tr>`;
  }).join('');

  render(app, `
  <div class="page">
    <div class="page-head">
      <h2>${tr('All Cases', 'Tất cả vụ án')}</h2>
      <div class="case-actions">
        <a class="btn btn-primary" href="/admin/import">${tr('Import JSON', 'Nhập JSON')}</a>
        <a class="btn btn-ghost" href="/admin/ai">${tr('AI creator', 'Tạo bằng AI')}</a>
      </div>
    </div>
    <label class="muted small legacy-toggle" style="display:block;margin:0 0 .75rem">
      <input type="checkbox" id="show-legacy"${showLegacy ? ' checked' : ''}>
      ${tr('Show older cases (hidden from players and from this list)', 'Hiện cả vụ án cũ (đang ẩn khỏi người chơi và khỏi danh sách này)')}
    </label>
    ${cases.length === 0
      ? `<div class="empty-state">${tr('No cases yet — seed the sample from the dashboard or import JSON.', 'Chưa có vụ án — hãy tạo vụ án mẫu từ bảng điều khiển hoặc nhập JSON.')}</div>`
      : `<table class="admin-table">
          <thead><tr><th>${tr('Case', 'Vụ án')}</th><th>${tr('Status', 'Trạng thái')}</th><th>${tr('Content', 'Nội dung')}</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`}
  </div>`);

  app.querySelector('#show-legacy')?.addEventListener('change', (event) => {
    showLegacy = event.target.checked;
    renderAdminCasesPage(app);
  });

  const bind = (selector, action, label) =>
    app.querySelectorAll(selector).forEach((btn) =>
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await action(btn.dataset.publish || btn.dataset.unpublish);
          toast(`Case ${label}.`, 'success');
          renderAdminCasesPage(app);
        } catch (err) {
          toast(err.errors?.code ? `${err.errors.code}: ${err.message}` : err.message, 'error');
          btn.disabled = false;
        }
      }));
  bind('[data-publish]', adminApi.publishCase, tr('published', 'đã xuất bản'));
  bind('[data-unpublish]', adminApi.unpublishCase, tr('unpublished', 'đã gỡ xuất bản'));
}
