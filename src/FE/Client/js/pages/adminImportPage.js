import { adminApi } from '../api/adminApi.js';
import { icon } from '../components/admin/ui.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';

/** /admin/import: a page of its own, drawn as the design's "Nhập JSON" dialog inside one card. */
export async function renderAdminImportPage(app) {
  render(app, `
  <div class="page acs-page acs-import">
    <a class="adm-back-link" href="/admin/cases">${icon('arrowLeft', 16)}${tr('All cases', 'Tất cả vụ án')}</a>
    <section class="adm-card acs-import-card" aria-labelledby="acs-import-title">
      <div class="acs-import-head">
        <h1 id="acs-import-title">${tr('Import Case JSON', 'Nhập JSON vụ án')}</h1>
        <p class="adm-card-sub">${tr('Validate first, then import as a draft.', 'Kiểm tra trước, sau đó nhập dưới dạng bản nháp.')}</p>
      </div>
      <div class="acs-field">
        <label for="json-input">${tr('JSON document', 'Tài liệu JSON')}</label>
        <span class="field-hint" id="json-input-hint">${tr('Paste a full', 'Dán tài liệu JSON')} <code>GameCase</code> ${tr('JSON document (same shape as', 'đầy đủ (cùng cấu trúc với')} <code>ai-game-docs/samples/sample-case.json</code>).</span>
        <textarea id="json-input" class="json-input acs-json-input" rows="14" spellcheck="false" aria-describedby="json-input-hint" placeholder='{ "caseId": "case-...", "title": "...", ... }'></textarea>
      </div>
      <label class="acs-check-line"><input type="checkbox" id="overwrite-box"> ${tr('Overwrite if caseId exists', 'Ghi đè nếu caseId đã tồn tại')}</label>
      <div id="import-output"></div>
      <div class="acs-import-actions">
        <button type="button" class="btn" id="validate-btn">${tr('Validate', 'Kiểm tra')}</button>
        <button type="button" class="btn btn-primary" id="import-btn">${tr('Import as draft', 'Nhập dưới dạng bản nháp')}</button>
      </div>
    </section>
  </div>`);

  const output = qs('#import-output', app);

  function parseInput() {
    try {
      return JSON.parse(qs('#json-input', app).value);
    } catch (e) {
      output.innerHTML = `<div class="notice notice-bad" role="alert">${tr('Invalid JSON:', 'JSON không hợp lệ:')} ${escapeHtml(e.message)}</div>`;
      return null;
    }
  }

  function showErrors(errors) {
    output.innerHTML = `<div class="notice notice-bad" role="alert"><strong>${errors.length} ${tr('validation error(s):', 'lỗi kiểm tra:')}</strong>
      <ul>${errors.map((e) => `<li><code>${escapeHtml(e.code)}</code> ${escapeHtml(e.path)} — ${escapeHtml(e.message)}</li>`).join('')}</ul></div>`;
  }

  const okNotice = (html) => `<div class="notice notice-ok acs-banner" role="status">${icon('check', 18)}<span>${html}</span></div>`;

  /** Non-blocking findings, e.g. an existing case that predates the three-hint rule (VUAN-6). */
  const warningNotice = (warnings) => (Array.isArray(warnings) && warnings.length
    ? `<div class="notice notice-warn acs-import-warnings" role="status"><strong>${warnings.length} ${tr('warning(s), not blocking:', 'cảnh báo, không chặn:')}</strong>
      <ul>${warnings.map((w) => `<li><code>${escapeHtml(w.code)}</code> ${escapeHtml(w.path)} — ${escapeHtml(w.message)}</li>`).join('')}</ul></div>`
    : '');

  qs('#validate-btn', app).addEventListener('click', async () => {
    const json = parseInput();
    if (!json) return;
    try {
      const result = await adminApi.validateCase(json);
      if (result.isValid) output.innerHTML = okNotice(tr('Validation passed — ready to import.', 'Kiểm tra thành công — sẵn sàng nhập.')) + warningNotice(result.warnings);
      else showErrors(result.errors);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const importButton = qs('#import-btn', app);
  importButton.addEventListener('click', async () => {
    const json = parseInput();
    if (!json) return;
    importButton.disabled = true;
    try {
      const summary = await adminApi.importCase(json, qs('#overwrite-box', app).checked);
      output.innerHTML = okNotice(`${tr('Imported', 'Đã nhập')} "${escapeHtml(summary.title)}" ${tr('as draft.', 'dưới dạng bản nháp.')}
        <a href="/admin/cases/${encodeURIComponent(summary.caseId)}">${tr('Open it', 'Mở vụ án')}</a> ${tr('to review and publish.', 'để xem lại và xuất bản.')}`)
        + warningNotice(summary.validationWarnings);
      toast(tr('Case imported.', 'Đã nhập vụ án.'), 'success');
    } catch (err) {
      if (Array.isArray(err.errors)) showErrors(err.errors);
      else toast(err.message, 'error');
    }
    importButton.disabled = false;
  });
}
