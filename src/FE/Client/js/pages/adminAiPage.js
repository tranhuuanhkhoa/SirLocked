import { aiCaseApi } from '../api/aiCaseApi.js';
import { session } from '../services/session.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

export async function renderAdminAiPage(app) {
  render(app, '<div class="page"><p class="muted">Loading AI case creator…</p></div>');

  let drafts = [];
  const canManageDrafts = session.isAdmin();
  try {
    if (canManageDrafts) drafts = await aiCaseApi.drafts();
  } catch {
    /* drafts list is non-critical */
  }

  draw();

  function draftRow(d) {
    const valid = d.status.endsWith('_GENERATED_VALID') || d.status === 'IMPORTED';
    return `
    <tr>
      <td>${escapeHtml(d.caseTitle || '(untitled)')}<br><span class="muted small">${escapeHtml(d.prompt.slice(0, 70))}…</span></td>
      <td><span class="chip">${escapeHtml(d.provider)}</span></td>
      <td><span class="chip ${valid ? 'chip-ok' : 'chip-bad'}">${escapeHtml(d.status)}</span></td>
      <td>
        ${canManageDrafts ? `<button class="btn btn-ghost btn-sm" data-view="${d.draftId}">View</button>` : ''}
        ${canManageDrafts && d.status === 'IMPORTED'
          ? `<a class="btn btn-ghost btn-sm" href="#/admin/cases/${encodeURIComponent(d.importedCaseId ?? d.caseId)}">Case</a>`
          : canManageDrafts && valid
            ? `<button class="btn btn-primary btn-sm" data-publish-draft="${d.draftId}">Import + publish</button>`
            : ''}
      </td>
    </tr>`;
  }

  function draw(activeDraft = null) {
    render(app, `
    <div class="page">
      <h2>AI Case Creator</h2>
      <p class="muted">Describe a mystery and generate a full playable case draft. With a Deepseek key configured the story is written by AI; without one a deterministic mock case is generated, so this always works.</p>
      ${canManageDrafts ? '' : '<p class="notice">VIP access can generate a draft. Admin review, import, and publish remain admin-only.</p>'}

      <form id="ai-form" class="ai-form">
        <textarea class="json-input" name="prompt" rows="3" required minlength="8"
          placeholder="A locked-room manor mystery with a poisoned drink and a missing ledger…"></textarea>
        <div class="ai-form-row">
          <label class="field-label">Stages
            <select class="field-input" name="stageCount">
              <option>2</option><option>3</option><option selected>4</option><option>5</option>
            </select>
          </label>
          <label class="field-label">Difficulty
            <select class="field-input" name="difficulty">
              <option>easy</option><option selected>medium</option><option>hard</option>
            </select>
          </label>
          <label class="field-label">Visual style
            <input class="field-input" name="visualStyle" value="cinematic detective">
          </label>
          <button class="btn btn-gold" type="submit" id="generate-btn">Generate case</button>
        </div>
      </form>

      <div id="ai-output">${activeDraft ? draftDetail(activeDraft) : ''}</div>

      ${canManageDrafts ? '<h3 class="section-title">Recent drafts</h3>' : ''}
      ${!canManageDrafts
        ? ''
        : drafts.length === 0
        ? '<div class="empty-state small">No drafts yet.</div>'
        : `<table class="admin-table">
            <thead><tr><th>Draft</th><th>Provider</th><th>Status</th><th></th></tr></thead>
            <tbody>${drafts.map(draftRow).join('')}</tbody>
          </table>`}
    </div>`);
    bind();
  }

  function draftDetail(d) {
    const valid = d.status.endsWith('_GENERATED_VALID') || d.status === 'IMPORTED';
    return `
    <div class="notice ${valid ? 'notice-ok' : 'notice-bad'}">
      <strong>${escapeHtml(d.caseTitle || d.caseId || 'Draft')}</strong> — ${escapeHtml(d.status)} (${escapeHtml(d.provider)})
      ${d.jsonFolderPath ? `<br><span class="muted small">Bundle: ${escapeHtml(d.jsonFolderPath)}</span>` : ''}
      ${d.validationErrors?.length
        ? `<ul>${d.validationErrors.slice(0, 12).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
        : ''}
      ${canManageDrafts && valid && d.status !== 'IMPORTED'
        ? `<div class="case-actions">
            <button class="btn btn-ghost btn-sm" data-import-draft="${d.draftId}">Import as draft case</button>
            <button class="btn btn-primary btn-sm" data-publish-draft="${d.draftId}">Import + publish</button>
          </div>` : ''}
    </div>
    ${d.generatedJson ? `<details class="json-details"><summary>Generated JSON</summary><pre class="json-view">${escapeHtml(d.generatedJson)}</pre></details>` : ''}`;
  }

  function bind() {
    qs('#ai-form', app).addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = qs('#generate-btn', app);
      button.disabled = true;
      button.textContent = 'Generating… (AI can take a few minutes)';
      const data = new FormData(e.target);
      try {
        const draft = await aiCaseApi.generate(
          data.get('prompt'), Number(data.get('stageCount')), data.get('difficulty'), data.get('visualStyle'));
        if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
        draw(draft);
        toast(draft.validationErrors?.length ? 'Generated, but the case failed validation.' : 'Case draft generated.', draft.validationErrors?.length ? 'error' : 'success');
      } catch (err) {
        toast(err.message, 'error', 7000);
        draw();
      }
    });

    app.querySelectorAll('[data-view]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          draw(await aiCaseApi.draft(btn.dataset.view));
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
          toast(err.message, 'error');
        }
      }));

    const bindDraftAction = (selector, action, label) =>
      app.querySelectorAll(selector).forEach((btn) =>
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const summary = await action(btn.dataset.importDraft || btn.dataset.publishDraft);
            toast(`"${summary.title}" ${label}.`, 'success');
            if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
            draw();
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
          }
        }));
    bindDraftAction('[data-import-draft]', (id) => aiCaseApi.importDraft(id), 'imported as draft');
    bindDraftAction('[data-publish-draft]', (id) => aiCaseApi.publishDraft(id), 'imported and published');
  }
}
