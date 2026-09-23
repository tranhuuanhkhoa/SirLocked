import { adminApi } from '../api/adminApi.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';

export async function renderAdminImportPage(app) {
  render(app, `
  <div class="page">
    <h2>${tr('Import Case JSON', 'Nhập JSON vụ án')}</h2>
    <p class="muted">${tr('Paste a full', 'Dán tài liệu JSON')} <code>GameCase</code> ${tr('JSON document (same shape as', 'đầy đủ (cùng cấu trúc với')} <code>ai-game-docs/samples/sample-case.json</code>). ${tr('Validate first, then import as a draft.', 'Kiểm tra trước, sau đó nhập dưới dạng bản nháp.')}</p>
    <textarea id="json-input" class="json-input" rows="18" spellcheck="false" placeholder='{ "caseId": "case-...", "title": "...", ... }'></textarea>
    <div class="case-actions">
      <label class="checkbox-label"><input type="checkbox" id="overwrite-box"> ${tr('Overwrite if caseId exists', 'Ghi đè nếu caseId đã tồn tại')}</label>
      <button class="btn btn-ghost" id="validate-btn">${tr('Validate', 'Kiểm tra')}</button>
      <button class="btn btn-primary" id="import-btn">${tr('Import as draft', 'Nhập dưới dạng bản nháp')}</button>
    </div>
    <div id="import-output"></div>
  </div>`);

  const output = qs('#import-output', app);

  function parseInput() {
    try {
      return JSON.parse(qs('#json-input', app).value);
    } catch (e) {
      output.innerHTML = `<div class="notice notice-bad">${tr('Invalid JSON:', 'JSON không hợp lệ:')} ${escapeHtml(e.message)}</div>`;
      return null;
    }
  }

  function showErrors(errors) {
    output.innerHTML = `<div class="notice notice-bad"><strong>${errors.length} ${tr('validation error(s):', 'lỗi kiểm tra:')}</strong>
      <ul>${errors.map((e) => `<li><code>${escapeHtml(e.code)}</code> ${escapeHtml(e.path)} — ${escapeHtml(e.message)}</li>`).join('')}</ul></div>`;
  }

  qs('#validate-btn', app).addEventListener('click', async () => {
    const json = parseInput();
    if (!json) return;
    try {
      const result = await adminApi.validateCase(json);
      if (result.isValid) output.innerHTML = `<div class="notice notice-ok">${tr('Validation passed — ready to import.', 'Kiểm tra thành công — sẵn sàng nhập.')}</div>`;
      else showErrors(result.errors);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  qs('#import-btn', app).addEventListener('click', async (e) => {
    const json = parseInput();
    if (!json) return;
    e.target.disabled = true;
    try {
      const summary = await adminApi.importCase(json, qs('#overwrite-box', app).checked);
      output.innerHTML = `<div class="notice notice-ok">${tr('Imported', 'Đã nhập')} "${escapeHtml(summary.title)}" ${tr('as draft.', 'dưới dạng bản nháp.')}
        <a href="#/admin/cases/${encodeURIComponent(summary.caseId)}">${tr('Open it', 'Mở vụ án')}</a> ${tr('to review and publish.', 'để xem lại và xuất bản.')}</div>`;
      toast(tr('Case imported.', 'Đã nhập vụ án.'), 'success');
    } catch (err) {
      if (Array.isArray(err.errors)) showErrors(err.errors);
      else toast(err.message, 'error');
    }
    e.target.disabled = false;
  });
}
