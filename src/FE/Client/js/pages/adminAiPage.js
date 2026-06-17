import { aiCaseApi } from '../api/aiCaseApi.js';
import { session } from '../services/session.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

const STATUS_AWAITING_APPROVAL = 'STORY_AWAITING_APPROVAL';
const STATUS_PUBLISHED = 'PUBLISHED';
const STATUS_GENERATED_INVALID = 'GENERATED_INVALID';
const TERMINAL_STATUSES = new Set([STATUS_PUBLISHED, STATUS_GENERATED_INVALID]);
const PROGRESS_STATES = {
  GENERATING_STORY: {
    percent: 8,
    title: 'Creating the case premise',
    detail: 'GPT is preparing a spoiler-free mystery outline.',
  },
  STORY_AWAITING_APPROVAL: {
    percent: 18,
    title: 'Story premise ready',
    detail: 'Starting full case generation automatically.',
  },
  GENERATING_FULL_CASE: {
    percent: 35,
    title: 'Building the full investigation',
    detail: 'Generating the culprit, suspects, clues, dialogue, and case logic.',
  },
  OPENAI_GENERATED_VALID: {
    percent: 52,
    title: 'Case logic validated',
    detail: 'The investigation is consistent. Preparing visual assets.',
  },
  GENERATING_ASSETS: {
    percent: 68,
    title: 'Generating scenes and assets',
    detail: 'Creating backgrounds, placement plans, characters, and evidence.',
  },
  ASSETS_GENERATED: {
    percent: 92,
    title: 'Assets ready',
    detail: 'Importing and publishing the playable case.',
  },
  IMPORTED: {
    percent: 97,
    title: 'Case imported',
    detail: 'Publishing the case.',
  },
  PUBLISHED: {
    percent: 100,
    title: 'Case published',
    detail: 'The new case is ready to play.',
  },
  GENERATED_INVALID: {
    percent: 100,
    title: 'Generation failed',
    detail: 'Fix the account or validation issue, then continue this draft.',
  },
};

export async function renderAdminAiPage(app) {
  render(app, '<div class="page"><p class="muted">Loading AI case creator...</p></div>');

  let drafts = [];
  const canManageDrafts = session.isAdmin();
  let pollTimer = null;
  let progressClock = null;
  let runStartedAt = 0;
  let runVersion = 0;
  let currentProgressStatus = 'GENERATING_STORY';
  let disposed = false;

  try {
    if (canManageDrafts) drafts = await aiCaseApi.drafts();
  } catch {
    /* drafts list is non-critical */
  }

  draw();

  function isSuccessStatus(status) {
    return status === STATUS_AWAITING_APPROVAL || status === STATUS_PUBLISHED || status === 'OPENAI_GENERATED_VALID' || status === 'ASSETS_GENERATED';
  }

  function canContinueDraft(d) {
    return Boolean(d.canContinue);
  }

  function continueButton(d, style = 'btn-primary') {
    return canContinueDraft(d)
      ? `<button class="btn ${style} btn-sm" type="button" data-continue="${escapeHtml(d.draftId)}">Continue</button>`
      : '';
  }

  function draftRow(d) {
    const title = d.caseTitle || d.storyPreview?.title || '(preview)';
    const prompt = d.prompt || 'AI-generated original mystery';
    return `
    <tr>
      <td>${escapeHtml(title)}<br><span class="muted small">${escapeHtml(prompt.slice(0, 70))}</span></td>
      <td><span class="chip">${escapeHtml(d.provider)}</span></td>
      <td><span class="chip ${isSuccessStatus(d.status) ? 'chip-ok' : 'chip-bad'}">${escapeHtml(d.status)}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm" data-view="${d.draftId}">View</button>
        ${continueButton(d)}
        ${d.status === STATUS_PUBLISHED || d.importedCaseId
          ? `<a class="btn btn-ghost btn-sm" href="#/cases/${encodeURIComponent(d.importedCaseId ?? d.caseId)}">Open case</a>`
          : ''}
      </td>
    </tr>`;
  }

  function draw(activeDraft = null) {
    render(app, `
    <div class="page">
      <h2>AI Case Creator</h2>
      <p class="muted">Create a complete SirLocked mystery with fixed pixel-art direction. The case is generated, validated, imported, and published automatically.</p>

      <div class="ai-quick-create">
        <button class="btn btn-gold" type="button" id="quick-create-btn">Create new case</button>
        <span class="muted small">4 scenes · medium difficulty · automatic publish</span>
      </div>

      <section class="generation-progress" id="generation-progress" hidden aria-live="polite">
        <div class="generation-progress-heading">
          <strong id="generation-progress-title">Preparing...</strong>
          <span id="generation-progress-percent">0%</span>
        </div>
        <div class="generation-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="generation-progress-fill" id="generation-progress-fill"></div>
        </div>
        <p class="muted small" id="generation-progress-detail"></p>
      </section>

      <div id="ai-output">${activeDraft ? draftDetail(activeDraft) : ''}</div>

      ${canManageDrafts ? '<h3 class="section-title">Recent AI drafts</h3>' : ''}
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
    const preview = d.storyPreview;
    const statusOk = isSuccessStatus(d.status);
    const published = d.publishedCase || d.importedCaseId || d.status === STATUS_PUBLISHED;
    const caseId = d.publishedCase?.caseId || d.importedCaseId || d.caseId;
    const resumeAction = continueButton(d);
    const cannotResume = d.status === STATUS_GENERATED_INVALID && !d.hasGeneratedJson && !published;
    return `
    <div class="notice ${statusOk ? 'notice-ok' : 'notice-bad'}">
      <strong>${escapeHtml(d.caseTitle || preview?.title || d.caseId || 'AI draft')}</strong> - ${escapeHtml(d.status)} (${escapeHtml(d.provider)})
      ${d.jsonFolderPath ? `<br><span class="muted small">Bundle: ${escapeHtml(d.jsonFolderPath)}</span>` : ''}
      ${d.assetManifest?.assetRootUrl
        ? `<br><span class="muted small">Assets: ${escapeHtml(d.assetManifest.assetRootUrl)} (${d.assetManifest.assets?.length ?? 0})</span>`
        : ''}
      ${d.validationErrors?.length
        ? `<ul>${d.validationErrors.slice(0, 12).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
        : ''}
      ${cannotResume
        ? '<p class="muted small">This failed draft has no saved case JSON checkpoint, so continuing would regenerate it. Create a new case after fixing the billing issue.</p>'
        : ''}
      ${published && caseId
        ? `<div class="case-actions">
            <a class="btn btn-primary btn-sm" href="#/cases/${encodeURIComponent(caseId)}">Open published case</a>
            ${session.isAdmin() ? `<a class="btn btn-ghost btn-sm" href="#/admin/cases/${encodeURIComponent(caseId)}">Admin review</a>` : ''}
          </div>`
        : resumeAction
        ? `<div class="case-actions">${resumeAction}</div>`
        : ''}
    </div>
    ${preview ? previewCard(preview, d) : ''}
    ${d.generatedJson && session.isAdmin()
      ? `<details class="json-details"><summary>Generated JSON</summary><pre class="json-view">${escapeHtml(d.generatedJson)}</pre></details>`
      : ''}`;
  }

  function previewCard(preview, draft) {
    return `
    <section class="notice">
      <h3>${escapeHtml(preview.title)}</h3>
      <p>${escapeHtml(preview.summary)}</p>
      <p><strong>Setting:</strong> ${escapeHtml(preview.setting || 'Pending')}</p>
      <p><strong>Opening incident:</strong> ${escapeHtml(preview.openingIncident || 'Pending')}</p>
      <p><strong>Tone:</strong> ${escapeHtml(preview.tone || 'Pending')}</p>
      <p><strong>Player promise:</strong> ${escapeHtml(preview.playerPromise || 'Pending')}</p>
      ${preview.keyLocations?.length
        ? `<p><strong>Locations:</strong> ${preview.keyLocations.map(escapeHtml).join(', ')}</p>`
        : ''}
      ${preview.suspectTeasers?.length
        ? `<p><strong>Suspects:</strong> ${preview.suspectTeasers.map(escapeHtml).join(', ')}</p>`
        : ''}
    </section>`;
  }

  function updateProgress(status, overrideDetail = '') {
    const panel = qs('#generation-progress', app);
    if (!panel) return;
    currentProgressStatus = status;

    const state = PROGRESS_STATES[status] || {
      percent: 5,
      title: 'Generating case',
      detail: status || 'Waiting for the backend.',
    };
    const elapsed = runStartedAt ? Math.max(0, Math.floor((Date.now() - runStartedAt) / 1000)) : 0;
    const detail = overrideDetail || state.detail;
    const fill = qs('#generation-progress-fill', panel);
    const track = panel.querySelector('[role="progressbar"]');

    panel.hidden = false;
    qs('#generation-progress-title', panel).textContent = state.title;
    qs('#generation-progress-percent', panel).textContent = `${state.percent}%`;
    qs('#generation-progress-detail', panel).textContent = `${detail} Elapsed: ${elapsed}s.`;
    fill.style.width = `${state.percent}%`;
    track.setAttribute('aria-valuenow', String(state.percent));
    panel.classList.toggle('generation-progress-error', status === 'GENERATED_INVALID');
  }

  function stopPolling() {
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function startProgressClock() {
    if (progressClock) window.clearInterval(progressClock);
    progressClock = window.setInterval(() => {
      if (!disposed && runStartedAt) updateProgress(currentProgressStatus);
    }, 1000);
  }

  function stopProgressClock() {
    if (progressClock) window.clearInterval(progressClock);
    progressClock = null;
  }

  function startPolling(draftId, version) {
    stopPolling();

    const poll = async () => {
      if (disposed || version !== runVersion) return;
      try {
        const current = await aiCaseApi.draft(draftId);
        if (disposed || version !== runVersion) return;
        updateProgress(current.status);
        if (TERMINAL_STATUSES.has(current.status)) return;
      } catch {
        if (disposed || version !== runVersion) return;
        updateProgress('GENERATING_FULL_CASE', 'Still generating. Waiting for the next status update.');
      }
      if (!disposed && version === runVersion) pollTimer = window.setTimeout(poll, 1500);
    };

    pollTimer = window.setTimeout(poll, 500);
  }

  function bind() {
    qs('#quick-create-btn', app).addEventListener('click', async () => {
      const button = qs('#quick-create-btn', app);
      const version = ++runVersion;
      let activeDraftId = null;
      runStartedAt = Date.now();
      button.disabled = true;
      button.textContent = 'Creating case...';
      updateProgress('GENERATING_STORY');
      startProgressClock();

      try {
        const previewDraft = await aiCaseApi.generate('', 4, 'medium');
        activeDraftId = previewDraft.draftId;
        if (disposed || version !== runVersion) return;
        updateProgress(previewDraft.status);
        startPolling(previewDraft.draftId, version);

        const draft = await aiCaseApi.approveDraft(previewDraft.draftId);
        if (disposed || version !== runVersion) return;
        stopPolling();
        stopProgressClock();
        updateProgress(draft.status);
        if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
        draw(draft);
        const title = draft.publishedCase?.title || draft.caseTitle || draft.storyPreview?.title || 'Case';
        if (draft.status === STATUS_PUBLISHED) {
          toast(`"${title}" published.`, 'success', 7000);
        } else {
          toast('Case generation finished but did not publish. Check validation details.', 'error', 9000);
        }
      } catch (err) {
        if (disposed || version !== runVersion) return;
        stopPolling();
        stopProgressClock();
        let latest = null;
        if (activeDraftId) {
          try {
            latest = await aiCaseApi.draft(activeDraftId);
          } catch {
            /* fall back to the normal page if the failed draft cannot be reloaded */
          }
        }
        if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
        toast(err.message, 'error', 7000);
        draw(latest);
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

    app.querySelectorAll('[data-continue]').forEach((btn) =>
      btn.addEventListener('click', () => continueDraft(btn.dataset.continue, btn)));
  }

  async function continueDraft(draftId, button) {
    const version = ++runVersion;
    runStartedAt = Date.now();
    button.disabled = true;
    button.textContent = 'Continuing...';
    updateProgress('GENERATING_ASSETS', 'Continuing from the saved checkpoint.');
    startProgressClock();
    startPolling(draftId, version);

    try {
      const draft = await aiCaseApi.continueDraft(draftId);
      if (disposed || version !== runVersion) return;
      stopPolling();
      stopProgressClock();
      updateProgress(draft.status);
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      draw(draft);
      const title = draft.publishedCase?.title || draft.caseTitle || draft.storyPreview?.title || 'Case';
      if (draft.status === STATUS_PUBLISHED) {
        toast(`"${title}" published.`, 'success', 7000);
      } else {
        toast('Draft continued but did not publish. Check validation details.', 'error', 9000);
      }
    } catch (err) {
      if (disposed || version !== runVersion) return;
      stopPolling();
      stopProgressClock();
      let latest = null;
      try {
        latest = await aiCaseApi.draft(draftId);
      } catch {
        /* keep the current page if the draft cannot be reloaded */
      }
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      toast(err.message, 'error', 9000);
      draw(latest);
    }
  }

  return () => {
    disposed = true;
    runVersion += 1;
    stopPolling();
    stopProgressClock();
  };
}
