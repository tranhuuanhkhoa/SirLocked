import { adminApi } from '../api/adminApi.js';
import { aiCaseApi } from '../api/aiCaseApi.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';
import { isV3, v3PublishGate } from './adminV3Gates.js';

export async function renderAdminCaseDetailPage(app, caseId) {
  render(app, `<div class="page"><p class="muted">${tr('Loading case…', 'Đang tải vụ án…')}</p></div>`);

  let gameCase;
  let capabilities = null;
  let validation = null;
  try {
    gameCase = await adminApi.caseDetail(decodeURIComponent(caseId));
    [capabilities, validation] = await Promise.all([
      aiCaseApi.capabilities().catch(() => null),
      adminApi.validateCase(gameCase).catch(() => null),
    ]);
  } catch (err) {
    render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
    return;
  }

  const gate = v3PublishGate(gameCase, capabilities, validation?.isValid ?? false);
  const publishControl = gameCase.status === 'PUBLISHED'
    ? `<button class="btn btn-ghost" id="unpublish-btn">${tr('Unpublish', 'Gỡ xuất bản')}</button>`
    : gate.canPublish
      ? `<button class="btn btn-primary" id="publish-btn">${tr('Publish', 'Xuất bản')}</button>`
      : `<button class="btn btn-ghost" disabled title="${escapeHtml(gate.reason)}">${tr('Publish blocked', 'Chưa thể xuất bản')}</button>`;

  render(app, `
  <div class="page">
    <a class="muted small" href="#/admin/cases">&larr; ${tr('All cases', 'Tất cả vụ án')}</a>
    <div class="page-head">
      <h2>${escapeHtml(gameCase.title)} <span class="chip ${gameCase.status === 'PUBLISHED' ? 'chip-ok' : ''}">${escapeHtml(gameCase.status)}</span></h2>
      <div class="case-actions">
        <button class="btn btn-ghost" id="validate-btn">${tr('Validate', 'Kiểm tra')}</button>
        ${publishControl}
      </div>
    </div>
    <p class="muted">${escapeHtml(gameCase.summary)}</p>
    ${caseProfilePanel(gameCase)}
    ${publishGatePanel(gate)}
    <div id="validation-output">${validationResultHtml(validation)}</div>
    <h3 class="section-title">${tr('Case JSON', 'JSON vụ án')}</h3>
    <pre class="json-view">${escapeHtml(JSON.stringify(gameCase, null, 2))}</pre>
  </div>`);

  const output = qs('#validation-output', app);

  qs('#validate-btn', app).addEventListener('click', async () => {
    try {
      const result = await adminApi.validateCase(gameCase);
      output.innerHTML = validationResultHtml(result);
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
      toast(err.errors?.code ? `${err.errors.code}: ${err.message}` : err.message, 'error');
      output.innerHTML = apiFailureHtml(err);
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

function caseProfilePanel(gameCase) {
  if (!isV3(gameCase)) return '';
  const isAiPreset = Boolean(gameCase.hasSourceAiDraft || gameCase.sourceAiDraftId);
  return `<section class="notice v3-case-profile">
    <div class="page-head"><h3>V3 case profile</h3><span class="chip chip-gold">V3 · Crack</span></div>
    <p class="muted small">Mechanics ${escapeHtml(String(gameCase.mechanicsVersion ?? 'unknown'))} · ${escapeHtml(gameCase.generationMode || 'unknown')} · ${escapeHtml(gameCase.generationPreset || 'MANUAL_V3')}</p>
    ${isAiPreset ? `<p class="muted small">Semantic review: <strong>${escapeHtml(gameCase.aiSemanticReviewStatus || 'NOT_RUN')}</strong> · Source AI draft: <strong>${gameCase.sourceAiDraftId ? 'attached' : 'missing'}</strong></p>` : ''}
  </section>`;
}

function publishGatePanel(gate) {
  if (!gate.checks.length) return '';
  return `<section class="notice ${gate.canPublish ? 'notice-ok' : 'notice-bad'} v3-publish-gate">
    <div class="page-head"><h3>Publish gate</h3><span class="chip ${gate.canPublish ? 'chip-ok' : 'chip-bad'}">${gate.canPublish ? 'READY' : 'BLOCKED'}</span></div>
    <ul class="v3-gate-list">${gate.checks.map((check) => `<li class="${check.passed ? 'v3-gate-pass' : 'v3-gate-fail'}"><strong>${check.passed ? 'PASS' : 'BLOCK'} · ${escapeHtml(check.label)}</strong><br><span class="muted small">${escapeHtml(check.detail)}</span></li>`).join('')}</ul>
  </section>`;
}

function validationResultHtml(result) {
  if (!result) return '<div class="notice notice-bad">Deterministic validation could not be verified. Refresh before publishing.</div>';
  if (result.isValid) return `<div class="notice notice-ok">${tr('Validation passed — this case is playable.', 'Kiểm tra thành công — vụ án có thể chơi được.')}</div>`;
  return `<div class="notice notice-bad"><strong>${result.errors?.length ?? 0} ${tr('validation error(s):', 'lỗi kiểm tra:')}</strong>
    <ul>${(result.errors || []).map((error) => `<li><code>${escapeHtml(error.code)}</code> ${escapeHtml(error.path)} — ${escapeHtml(error.message)}</li>`).join('')}</ul></div>`;
}

function apiFailureHtml(error) {
  if (Array.isArray(error?.errors)) {
    return `<div class="notice notice-bad"><strong>${tr('Publish blocked by validation:', 'Không thể xuất bản do lỗi kiểm tra:')}</strong>
      <ul>${error.errors.map((item) => `<li><code>${escapeHtml(item.code)}</code> ${escapeHtml(item.path)} — ${escapeHtml(item.message)}</li>`).join('')}</ul></div>`;
  }
  const code = error?.errors?.code;
  const messageKey = error?.errors?.messageKey;
  return `<div class="notice notice-bad"><strong>${escapeHtml(code || 'PUBLISH_BLOCKED')}</strong><p>${escapeHtml(error?.message || 'Publish was blocked.')}</p>${messageKey ? `<p class="muted small">${escapeHtml(messageKey)}</p>` : ''}</div>`;
}
