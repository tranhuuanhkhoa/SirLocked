import { aiCaseApi } from '../api/aiCaseApi.js';
import { session } from '../services/session.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';

const STATUS_AWAITING_APPROVAL = 'STORY_AWAITING_APPROVAL';
const STATUS_FULL_LOGIC_AWAITING_APPROVAL = 'FULL_LOGIC_AWAITING_APPROVAL';
const STATUS_SCENE_LAYOUT_AWAITING_APPROVAL = 'SCENE_LAYOUT_AWAITING_APPROVAL';
const STATUS_READY_TO_PUBLISH = 'READY_TO_PUBLISH';
const STATUS_PUBLISHED = 'PUBLISHED';
const STATUS_GENERATED_INVALID = 'GENERATED_INVALID';
const TERMINAL_STATUSES = new Set([STATUS_READY_TO_PUBLISH, STATUS_PUBLISHED, STATUS_GENERATED_INVALID]);
const PRESETS = {
  NORMAL_RANDOM: {
    label: 'Normal random',
    stageCount: 4,
    difficulty: 'medium',
    description: 'Balanced generation; AI picks a sensible mix of mechanics.',
  },
  FULL_FEATURE: {
    label: 'Full Feature Case',
    stageCount: 6,
    difficulty: 'hard',
    description: 'Max scope: all puzzle types, item use, combine, camera, dialogue, challenges, deductions.',
  },
  SHORT_DEMO: {
    label: 'Short Demo',
    stageCount: 2,
    difficulty: 'easy',
    description: 'Compact case for quick testing and demos.',
  },
  PUZZLE_HEAVY: {
    label: 'Puzzle Heavy',
    stageCount: 5,
    difficulty: 'hard',
    description: 'Forces code, sequence, symbol, item-use, and combine mechanics.',
  },
  DIALOGUE_HEAVY: {
    label: 'Dialogue Heavy',
    stageCount: 5,
    difficulty: 'medium',
    description: 'Focuses on conversation trees, testimony, contradictions, and deductions.',
  },
};
const PROGRESS_STATES = {
  GENERATING_STORY: {
    percent: 8,
    title: 'Creating the case premise',
    detail: 'GPT is preparing a spoiler-free mystery outline.',
  },
  STORY_AWAITING_APPROVAL: {
    percent: 18,
    title: 'Story premise ready',
    detail: 'Approve the premise to generate full case logic.',
  },
  GENERATING_FULL_CASE: {
    percent: 35,
    title: 'Building the full investigation',
    detail: 'Generating the culprit, suspects, clues, dialogue, and case logic.',
  },
  OPENAI_GENERATED_VALID: {
    percent: 52,
    title: 'Case logic validated',
    detail: 'The investigation is consistent. Preparing scene layout.',
  },
  FULL_LOGIC_AWAITING_APPROVAL: {
    percent: 50,
    title: 'Full logic ready',
    detail: 'Review the case logic before generating scene layouts.',
  },
  GENERATING_SCENE_LAYOUT: {
    percent: 68,
    title: 'Generating scene layouts',
    detail: 'Creating embedded clue backgrounds and detecting clue regions.',
  },
  SCENE_LAYOUT_AWAITING_APPROVAL: {
    percent: 82,
    title: 'Scene layout ready',
    detail: 'Review clue zones and scene metadata before publishing.',
  },
  GENERATING_FINAL_ASSETS: {
    percent: 90,
    title: 'Generating final assets',
    detail: 'Preparing character assets and the final runtime bundle.',
  },
  READY_TO_PUBLISH: {
    percent: 96,
    title: 'Ready to publish',
    detail: 'Final assets are ready. Publish is a separate manual action.',
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
  let selectedLanguage = window.localStorage.getItem('sirlocked.aiCaseLanguage') === 'vi' ? 'vi' : 'en';

  try {
    if (canManageDrafts) drafts = await aiCaseApi.drafts();
  } catch {
    /* drafts list is non-critical */
  }

  draw();

  function isSuccessStatus(status) {
    return status === STATUS_AWAITING_APPROVAL ||
      status === STATUS_FULL_LOGIC_AWAITING_APPROVAL ||
      status === STATUS_SCENE_LAYOUT_AWAITING_APPROVAL ||
      status === STATUS_READY_TO_PUBLISH ||
      status === STATUS_PUBLISHED ||
      status === 'OPENAI_GENERATED_VALID' ||
      status === 'ASSETS_GENERATED';
  }

  function canContinueDraft(d) {
    return Boolean(d.canContinue);
  }

  function continueButton(d, style = 'btn-primary') {
    if (d.status === STATUS_GENERATED_INVALID && ['FULL_LOGIC_JSON', 'PRE_ASSET_VALIDATION'].includes(d.failurePhase)) {
      return `<button class="btn ${style} btn-sm" type="button" data-retry-json="${escapeHtml(d.draftId)}">Retry JSON repair</button>`;
    }
    if (d.status === STATUS_GENERATED_INVALID && d.failurePhase === 'VISUAL_QA') {
      return `<button class="btn ${style} btn-sm" type="button" data-regenerate-failed-assets="${escapeHtml(d.draftId)}">Regenerate failed scene</button>`;
    }
    if (d.status === STATUS_AWAITING_APPROVAL) {
      return `<button class="btn ${style} btn-sm" type="button" data-approve-story="${escapeHtml(d.draftId)}">Approve story preview</button>`;
    }
    if (d.status === STATUS_FULL_LOGIC_AWAITING_APPROVAL) {
      return `<button class="btn ${style} btn-sm" type="button" data-approve-full-logic="${escapeHtml(d.draftId)}">Approve full logic</button>`;
    }
    if (d.status === STATUS_SCENE_LAYOUT_AWAITING_APPROVAL) {
      return `<button class="btn ${style} btn-sm" type="button" data-approve-scene-layout="${escapeHtml(d.draftId)}">Approve layout</button>`;
    }
    if (d.status === STATUS_READY_TO_PUBLISH && session.isAdmin()) {
      return `<button class="btn ${style} btn-sm" type="button" data-publish-draft="${escapeHtml(d.draftId)}">Publish</button>`;
    }
    return canContinueDraft(d)
      ? `<button class="btn ${style} btn-sm" type="button" data-continue="${escapeHtml(d.draftId)}">Continue</button>`
      : '';
  }

  function draftRow(d) {
    const title = d.caseTitle || d.storyPreview?.title || '(preview)';
    const prompt = d.prompt || 'AI-generated original mystery';
    const preset = presetLabel(d.settings?.generationPreset);
    const language = d.settings?.language === 'vi' ? 'Tiếng Việt' : 'English';
    return `
    <tr>
      <td>${escapeHtml(title)}<br><span class="muted small">${escapeHtml(prompt.slice(0, 70))}</span></td>
      <td><span class="chip">${escapeHtml(d.provider)}</span></td>
      <td><span class="chip">${escapeHtml(preset)}</span><br><span class="muted small">${escapeHtml(language)}</span></td>
      <td><span class="chip ${isSuccessStatus(d.status) ? 'chip-ok' : 'chip-bad'}">${escapeHtml(d.status)}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm" data-view="${d.draftId}">${tr('View', 'Xem')}</button>
        ${continueButton(d)}
        ${d.status === STATUS_PUBLISHED || d.importedCaseId
          ? `<a class="btn btn-ghost btn-sm" href="#/cases/${encodeURIComponent(d.importedCaseId ?? d.caseId)}">${tr('Open case', 'Mở vụ án')}</a>`
          : ''}
      </td>
    </tr>`;
  }

  function draw(activeDraft = null) {
    render(app, `
    <div class="page">
      <h2>${tr('AI Case Creator', 'Tạo vụ án bằng AI')}</h2>
      <p class="muted">${tr('Create rooms with natural camera evidence; NPC and interactive item sprites are placed afterwards.', 'Tạo vụ án với chứng cứ ảnh tự nhiên; NPC và vật phẩm tương tác sẽ được bố trí sau.')}</p>

      <div class="ai-quick-create">
        <label class="ai-preset-field">
          <span>${tr('Generation preset', 'Cấu hình tạo')}</span>
          <select class="field-input" id="ai-preset-select">
            ${Object.entries(PRESETS).map(([value, preset]) => `<option value="${value}">${escapeHtml(preset.label)}</option>`).join('')}
          </select>
        </label>
        <label class="ai-preset-field ai-language-field">
          <span>${tr('Case language', 'Ngôn ngữ nội dung vụ án')}</span>
          <select class="field-input" id="ai-language-select">
            <option value="en" ${selectedLanguage === 'en' ? 'selected' : ''}>English</option>
            <option value="vi" ${selectedLanguage === 'vi' ? 'selected' : ''}>Tiếng Việt</option>
          </select>
          <small class="muted">Áp dụng cho tiêu đề, cốt truyện, manh mối, hội thoại và kết thúc.</small>
        </label>
        <button class="btn btn-gold" type="button" id="quick-create-btn">${tr('Create new case', 'Tạo vụ án mới')}</button>
        <span class="muted small" id="ai-preset-help">${escapeHtml(PRESETS.NORMAL_RANDOM.description)}</span>
      </div>

      <section class="generation-progress" id="generation-progress" hidden aria-live="polite">
        <div class="generation-progress-heading">
          <strong id="generation-progress-title">${tr('Preparing...', 'Đang chuẩn bị...')}</strong>
          <span id="generation-progress-percent">0%</span>
        </div>
        <div class="generation-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="generation-progress-fill" id="generation-progress-fill"></div>
        </div>
        <p class="muted small" id="generation-progress-detail"></p>
      </section>

      <div id="ai-output">${activeDraft ? draftDetail(activeDraft) : ''}</div>

      ${canManageDrafts ? `<h3 class="section-title">${tr('Recent AI drafts', 'Bản nháp AI gần đây')}</h3>` : ''}
      ${!canManageDrafts
        ? ''
        : drafts.length === 0
        ? `<div class="empty-state small">${tr('No drafts yet.', 'Chưa có bản nháp.')}</div>`
        : `<table class="admin-table">
            <thead><tr><th>${tr('Draft', 'Bản nháp')}</th><th>${tr('Provider', 'Nhà cung cấp')}</th><th>${tr('Preset', 'Cấu hình')}</th><th>${tr('Status', 'Trạng thái')}</th><th></th></tr></thead>
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
      <br><span class="muted small">Preset: ${escapeHtml(presetLabel(d.settings?.generationPreset))} · Language: ${d.settings?.language === 'vi' ? 'Tiếng Việt' : 'English'}</span>
      ${d.jsonFolderPath ? `<br><span class="muted small">Bundle: ${escapeHtml(d.jsonFolderPath)}</span>` : ''}
      ${d.assetManifest?.assetRootUrl
        ? `<br><span class="muted small">Assets: ${escapeHtml(d.assetManifest.assetRootUrl)} (${d.assetManifest.assets?.length ?? 0})</span>`
        : ''}
      ${d.failurePhase && d.failurePhase !== 'NONE'
        ? `<br><span class="muted small">Failure phase: ${escapeHtml(d.failurePhase)}${d.failedAssetIds?.length ? ` · Failed assets: ${d.failedAssetIds.map(escapeHtml).join(', ')}` : ''}</span>`
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
    ${repairPanel(d)}
    ${generationDiagnostics(d)}
    ${d.generatedJson && session.isAdmin()
      ? `<details class="json-details">
          <summary>Generated JSON</summary>
          <p class="muted small">Replacing JSON validates the complete case, snapshots the current JSON, and resets layout/assets for v5 regeneration. Existing v4 files are not deleted.</p>
          <textarea class="field-input json-editor" rows="24" data-json-editor="${escapeHtml(d.draftId)}" spellcheck="false">${escapeHtml(d.generatedJson)}</textarea>
          <div class="case-actions">
            <button class="btn btn-primary btn-sm" type="button" data-replace-json="${escapeHtml(d.draftId)}">Validate and replace JSON</button>
          </div>
        </details>`
      : ''}`;
  }

  function generationDiagnostics(d) {
    const attempts = d.generationAttempts || [];
    if (!attempts.length) return '';
    const inputTokens = attempts.reduce((sum, attempt) => sum + (attempt.inputTokens || 0), 0);
    const outputTokens = attempts.reduce((sum, attempt) => sum + (attempt.outputTokens || 0), 0);
    return `<details class="json-details">
      <summary>Generation diagnostics (${attempts.length})</summary>
      <p class="muted small">Prompt: ${escapeHtml(d.promptVersion || 'unknown')} · Schema: ${escapeHtml(d.schemaVersion || 'unknown')} · Tokens: ${inputTokens} in / ${outputTokens} out</p>
      <ul>${attempts.slice(-10).map((attempt) => `<li>${escapeHtml(attempt.step)} #${attempt.attemptNumber}: ${escapeHtml(attempt.status)}${attempt.failureCategory ? ` — ${escapeHtml(attempt.failureCategory)}` : ''}</li>`).join('')}</ul>
    </details>`;
  }

  function repairPanel(d) {
    if (d.status !== STATUS_FULL_LOGIC_AWAITING_APPROVAL && d.status !== STATUS_GENERATED_INVALID) return '';
    const hasCandidate = Boolean(d.repairedCandidateJson);
    return `
    <section class="notice">
      <h3>Full logic repair</h3>
      <p class="muted small">Creates a camera-first repair candidate without overwriting the current draft.</p>
      <div class="case-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-repair-full-logic="${escapeHtml(d.draftId)}">Repair item evidence</button>
        ${hasCandidate && d.repairStatus === 'CANDIDATE_READY'
          ? `<button class="btn btn-primary btn-sm" type="button" data-accept-repair="${escapeHtml(d.draftId)}">Accept repair</button>
             <button class="btn btn-ghost btn-sm" type="button" data-reject-repair="${escapeHtml(d.draftId)}">Reject repair</button>`
          : ''}
      </div>
      ${d.repairStatus ? `<p class="muted small">Repair status: ${escapeHtml(d.repairStatus)}</p>` : ''}
      ${d.repairValidationReport?.length
        ? `<ul>${d.repairValidationReport.slice(0, 12).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
        : ''}
      ${hasCandidate && session.isAdmin()
        ? `<details class="json-details"><summary>Repaired candidate JSON</summary><pre class="json-view">${escapeHtml(d.repairedCandidateJson)}</pre></details>`
        : ''}
    </section>`;
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
    const presetSelect = qs('#ai-preset-select', app);
    const languageSelect = qs('#ai-language-select', app);
    const presetHelp = qs('#ai-preset-help', app);
    presetSelect?.addEventListener('change', () => {
      const preset = PRESETS[presetSelect.value] ?? PRESETS.NORMAL_RANDOM;
      presetHelp.textContent = preset.description;
    });
    languageSelect?.addEventListener('change', () => {
      selectedLanguage = languageSelect.value === 'vi' ? 'vi' : 'en';
      window.localStorage.setItem('sirlocked.aiCaseLanguage', selectedLanguage);
    });

    qs('#quick-create-btn', app).addEventListener('click', async () => {
      const button = qs('#quick-create-btn', app);
      const presetKey = presetSelect?.value ?? 'NORMAL_RANDOM';
      const preset = PRESETS[presetKey] ?? PRESETS.NORMAL_RANDOM;
      const language = selectedLanguage;
      const version = ++runVersion;
      let activeDraftId = null;
      runStartedAt = Date.now();
      button.disabled = true;
      button.textContent = 'Creating case...';
      updateProgress('GENERATING_STORY');
      startProgressClock();

      try {
        const previewDraft = await aiCaseApi.generate('', preset.stageCount, preset.difficulty, presetKey, language);
        activeDraftId = previewDraft.draftId;
        if (disposed || version !== runVersion) return;
        updateProgress(previewDraft.status);
        stopPolling();
        stopProgressClock();
        updateProgress(previewDraft.status);
        if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
        draw(previewDraft);
        toast('Story preview is ready for manual approval.', 'success', 7000);
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

    app.querySelectorAll('[data-retry-json]').forEach((btn) =>
      btn.addEventListener('click', () => retryFailedDraft(btn.dataset.retryJson, btn, 'json')));

    app.querySelectorAll('[data-regenerate-failed-assets]').forEach((btn) =>
      btn.addEventListener('click', () => retryFailedDraft(btn.dataset.regenerateFailedAssets, btn, 'assets')));

    app.querySelectorAll('[data-approve-story]').forEach((btn) =>
      btn.addEventListener('click', () => approveStory(btn.dataset.approveStory, btn)));

    app.querySelectorAll('[data-approve-full-logic]').forEach((btn) =>
      btn.addEventListener('click', () => approveGate(btn.dataset.approveFullLogic, btn, 'full-logic')));

    app.querySelectorAll('[data-approve-scene-layout]').forEach((btn) =>
      btn.addEventListener('click', () => approveGate(btn.dataset.approveSceneLayout, btn, 'scene-layout')));

    app.querySelectorAll('[data-publish-draft]').forEach((btn) =>
      btn.addEventListener('click', () => publishDraft(btn.dataset.publishDraft, btn)));

    app.querySelectorAll('[data-repair-full-logic]').forEach((btn) =>
      btn.addEventListener('click', () => repairFullLogic(btn.dataset.repairFullLogic, btn)));

    app.querySelectorAll('[data-accept-repair]').forEach((btn) =>
      btn.addEventListener('click', () => acceptRepair(btn.dataset.acceptRepair, btn)));

    app.querySelectorAll('[data-reject-repair]').forEach((btn) =>
      btn.addEventListener('click', () => rejectRepair(btn.dataset.rejectRepair, btn)));

    app.querySelectorAll('[data-replace-json]').forEach((btn) =>
      btn.addEventListener('click', () => replaceDraftJson(btn.dataset.replaceJson, btn)));
  }

  function presetLabel(value) {
    return PRESETS[value]?.label ?? PRESETS.NORMAL_RANDOM.label;
  }

  async function approveStory(draftId, button) {
    const version = ++runVersion;
    runStartedAt = Date.now();
    button.disabled = true;
    button.textContent = 'Generating logic...';
    updateProgress('GENERATING_FULL_CASE');
    startProgressClock();
    startPolling(draftId, version);

    try {
      const draft = await aiCaseApi.approveDraft(draftId);
      if (disposed || version !== runVersion) return;
      stopPolling();
      stopProgressClock();
      updateProgress(draft.status);
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      draw(draft);
      toast('Full case logic is ready for review.', 'success', 7000);
    } catch (err) {
      if (disposed || version !== runVersion) return;
      stopPolling();
      stopProgressClock();
      let latest = null;
      try {
        latest = await aiCaseApi.draft(draftId);
      } catch {
        /* keep current page if reload fails */
      }
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      toast(err.message, 'error', 9000);
      draw(latest);
    }
  }

  async function approveGate(draftId, button, gate) {
    const version = ++runVersion;
    runStartedAt = Date.now();
    button.disabled = true;
    button.textContent = gate === 'full-logic' ? 'Generating layout...' : 'Generating final assets...';
    updateProgress(gate === 'full-logic' ? 'GENERATING_SCENE_LAYOUT' : 'GENERATING_FINAL_ASSETS');
    startProgressClock();
    startPolling(draftId, version);

    try {
      const draft = gate === 'full-logic'
        ? await aiCaseApi.approveFullLogic(draftId)
        : await aiCaseApi.approveSceneLayout(draftId);
      if (disposed || version !== runVersion) return;
      stopPolling();
      stopProgressClock();
      updateProgress(draft.status);
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      draw(draft);
      if (draft.status === STATUS_SCENE_LAYOUT_AWAITING_APPROVAL) {
        toast('Scene layout is ready for review.', 'success', 7000);
      } else if (draft.status === STATUS_READY_TO_PUBLISH) {
        toast('Final assets are ready. Publish manually when you are ready.', 'success', 7000);
      } else {
        toast('Draft advanced to the next gate.', 'info', 7000);
      }
    } catch (err) {
      if (disposed || version !== runVersion) return;
      stopPolling();
      stopProgressClock();
      let latest = null;
      try {
        latest = await aiCaseApi.draft(draftId);
      } catch {
        /* keep current page if reload fails */
      }
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      toast(err.message, 'error', 9000);
      draw(latest);
    }
  }

  async function publishDraft(draftId, button) {
    const version = ++runVersion;
    runStartedAt = Date.now();
    button.disabled = true;
    button.textContent = 'Publishing...';
    updateProgress('IMPORTED', 'Publishing the approved draft.');
    startProgressClock();

    try {
      const published = await aiCaseApi.publishDraft(draftId, true);
      if (disposed || version !== runVersion) return;
      stopProgressClock();
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      const latest = await aiCaseApi.draft(draftId).catch(() => null);
      draw(latest);
      toast(`"${published.title || 'Case'}" published.`, 'success', 7000);
    } catch (err) {
      if (disposed || version !== runVersion) return;
      stopProgressClock();
      let latest = null;
      try {
        latest = await aiCaseApi.draft(draftId);
      } catch {
        /* keep current page if reload fails */
      }
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      toast(err.message, 'error', 9000);
      draw(latest);
    }
  }

  async function repairFullLogic(draftId, button) {
    button.disabled = true;
    button.textContent = 'Repairing...';
    try {
      const draft = await aiCaseApi.repairFullLogic(
        draftId,
        'Normalize final evidence into natural scene-scale camera clues while keeping IDs and logic stable.'
      );
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      draw(draft);
      toast(draft.repairStatus === 'CANDIDATE_READY' ? 'Repair candidate is ready.' : 'Repair candidate needs review.', 'info', 7000);
    } catch (err) {
      const latest = await aiCaseApi.draft(draftId).catch(() => null);
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      toast(err.message, 'error', 9000);
      draw(latest);
    }
  }

  async function acceptRepair(draftId, button) {
    button.disabled = true;
    button.textContent = 'Accepting...';
    try {
      const draft = await aiCaseApi.acceptRepair(draftId);
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      draw(draft);
      toast('Repair accepted. Review full logic before layout generation.', 'success', 7000);
    } catch (err) {
      const latest = await aiCaseApi.draft(draftId).catch(() => null);
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      toast(err.message, 'error', 9000);
      draw(latest);
    }
  }

  async function rejectRepair(draftId, button) {
    button.disabled = true;
    button.textContent = 'Rejecting...';
    try {
      const draft = await aiCaseApi.rejectRepair(draftId);
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      draw(draft);
      toast('Repair rejected. Original logic remains unchanged.', 'info', 7000);
    } catch (err) {
      const latest = await aiCaseApi.draft(draftId).catch(() => null);
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      toast(err.message, 'error', 9000);
      draw(latest);
    }
  }

  async function replaceDraftJson(draftId, button) {
    const editor = app.querySelector(`[data-json-editor="${CSS.escape(draftId)}"]`);
    if (!editor) return;

    let caseJson;
    try {
      caseJson = JSON.parse(editor.value);
    } catch (err) {
      toast(`Invalid JSON: ${err.message}`, 'error', 9000);
      return;
    }

    if (!window.confirm('Replace this draft JSON and reset its layout/assets? The previous JSON will be kept as a snapshot.')) return;
    button.disabled = true;
    button.textContent = 'Validating...';
    try {
      const draft = await aiCaseApi.replaceJson(draftId, caseJson);
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      draw(draft);
      toast('Draft JSON replaced. Review full logic before regenerating v5 layout and assets.', 'success', 8000);
    } catch (err) {
      const latest = await aiCaseApi.draft(draftId).catch(() => null);
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      toast(err.message, 'error', 9000);
      draw(latest);
    }
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

  async function retryFailedDraft(draftId, button, mode) {
    button.disabled = true;
    button.textContent = mode === 'json' ? 'Repairing JSON...' : 'Regenerating scene...';
    try {
      const draft = mode === 'json'
        ? await aiCaseApi.retryJson(draftId)
        : await aiCaseApi.regenerateFailedAssets(draftId);
      if (canManageDrafts) drafts = await aiCaseApi.drafts().catch(() => drafts);
      draw(draft);
      toast(mode === 'json' ? 'JSON checkpoint repaired and revalidated.' : 'Failed scene regenerated and revalidated.', 'success', 8000);
    } catch (err) {
      const latest = await aiCaseApi.draft(draftId).catch(() => null);
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
