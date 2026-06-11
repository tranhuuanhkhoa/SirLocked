import { adminApi } from '../api/adminApi.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

export async function renderAdminImportPage(app) {
  render(app, `
  <div class="page">
    <h2>Import Case JSON</h2>
    <p class="muted">Paste a full <code>GameCase</code> JSON document (same shape as <code>ai-game-docs/samples/sample-case.json</code>). Validate first, then import as a draft.</p>
    <textarea id="json-input" class="json-input" rows="18" spellcheck="false" placeholder='{ "caseId": "case-...", "title": "...", ... }'></textarea>
    <div class="case-actions">
      <label class="checkbox-label"><input type="checkbox" id="overwrite-box"> Overwrite if caseId exists</label>
      <button class="btn btn-ghost" id="validate-btn">Validate</button>
      <button class="btn btn-primary" id="import-btn">Import as draft</button>
    </div>
    <div id="import-output"></div>
  </div>`);

  const output = qs('#import-output', app);

  function parseInput() {
    try {
      return JSON.parse(qs('#json-input', app).value);
    } catch (e) {
      output.innerHTML = `<div class="notice notice-bad">Invalid JSON: ${escapeHtml(e.message)}</div>`;
      return null;
    }
  }

  function showErrors(errors) {
    output.innerHTML = `<div class="notice notice-bad"><strong>${errors.length} validation error(s):</strong>
      <ul>${errors.map((e) => `<li><code>${escapeHtml(e.code)}</code> ${escapeHtml(e.path)} — ${escapeHtml(e.message)}</li>`).join('')}</ul></div>`;
  }

  qs('#validate-btn', app).addEventListener('click', async () => {
    const json = parseInput();
    if (!json) return;
    try {
      const result = await adminApi.validateCase(json);
      if (result.isValid) output.innerHTML = '<div class="notice notice-ok">Validation passed — ready to import.</div>';
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
      output.innerHTML = `<div class="notice notice-ok">Imported "${escapeHtml(summary.title)}" as draft.
        <a href="#/admin/cases/${encodeURIComponent(summary.caseId)}">Open it</a> to review and publish.</div>`;
      toast('Case imported.', 'success');
    } catch (err) {
      if (Array.isArray(err.errors)) showErrors(err.errors);
      else toast(err.message, 'error');
    }
    e.target.disabled = false;
  });
}
