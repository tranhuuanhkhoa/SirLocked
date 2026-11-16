import { adminApi } from '../api/adminApi.js';
import { aiCaseApi } from '../api/aiCaseApi.js';
import { icon, stateBox } from '../components/admin/ui.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';
import { replaceAddress } from '../services/navigation.js';
import { gateCheckText, gateReasonText, isV3, v3PublishGate } from './adminV3Gates.js';
import { mountCutscenePanel } from './adminCutscene.js';
import { caseCover, caseStatusPill, pixelPill, v3Pill, watchCovers } from './adminCasesPage.js';

/** The tabs of the content card. The first one has no ?tab= in the address. */
const TABS = [
  { id: 'cutscene', slug: '', label: () => tr('Opening cutscene', 'Cutscene mở đầu') },
  { id: 'structure', slug: 'cau-truc', label: () => tr('Case structure', 'Cấu trúc vụ án') },
  { id: 'json', slug: 'json', label: () => tr('Case JSON', 'JSON vụ án') },
];

const COPY_ICON = '<svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>';

/** Same rule as the server's CaseCatalogRules.IsPixel: every scene that has a runtime renders in pixel mode. */
function isPixelCase(gameCase) {
  const runtimes = (gameCase.stages ?? []).flatMap((stage) => stage.scenes ?? []).map((scene) => scene.runtime).filter(Boolean);
  return runtimes.length > 0 && runtimes.every((runtime) => String(runtime.render?.mode ?? '').toLowerCase() === 'pixel');
}

const count = (list, fallback) => (Array.isArray(list) ? list.length : typeof fallback === 'number' ? fallback : '—');

function languageLabel(code) {
  const value = String(code ?? '').toLowerCase();
  if (!value) return '';
  if (value === 'vi') return tr('Vietnamese', 'Tiếng Việt');
  if (value === 'en') return tr('English', 'Tiếng Anh');
  return value;
}

export async function renderAdminCaseDetailPage(app, caseId) {
  render(app, `<div class="page acs-page">${stateBox('loading', tr('Loading case…', 'Đang tải vụ án…'))}</div>`);

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
    render(app, `<div class="page acs-page">
      <a class="adm-back-link" href="/admin/cases">${icon('arrowLeft', 16)}${tr('All cases', 'Tất cả vụ án')}</a>
      ${stateBox('error', tr('The case could not load', 'Không tải được vụ án'), err.message)}</div>`);
    return;
  }

  const gate = v3PublishGate(gameCase, capabilities, validation?.isValid ?? false);
  const blockedReason = gateReasonText(gate);
  const publishControl = gameCase.status === 'PUBLISHED'
    ? `<button type="button" class="btn adm-btn-danger" id="unpublish-btn">${tr('Unpublish', 'Gỡ xuất bản')}</button>`
    : gate.canPublish
      ? `<button type="button" class="btn adm-btn-ok" id="publish-btn">${tr('Publish', 'Xuất bản')}</button>`
      : `<button type="button" class="btn" disabled title="${escapeHtml(blockedReason)}">${tr('Publish blocked', 'Chưa thể xuất bản')}</button>`;

  const requested = new URLSearchParams(window.location.search).get('tab') ?? '';
  let activeTab = (TABS.find((tab) => tab.slug && tab.slug === requested) ?? TABS[0]).id;

  const meta = [
    languageLabel(gameCase.language),
    Number(gameCase.estimatedMinutes) > 0 ? tr(`about ${gameCase.estimatedMinutes} min`, `khoảng ${gameCase.estimatedMinutes} phút`) : '',
  ].filter(Boolean);

  render(app, `
  <div class="page acs-page acs-detail">
    <a class="adm-back-link" href="/admin/cases">${icon('arrowLeft', 16)}${tr('All cases', 'Tất cả vụ án')}</a>
    <section class="adm-card acs-hero" aria-labelledby="acs-case-title">
      ${caseCover(gameCase.coverImageUrl, gameCase.title, 'acs-hero-cover')}
      <div class="acs-hero-body">
        <div class="acs-hero-titlebar">
          <h1 id="acs-case-title">${escapeHtml(gameCase.title)}</h1>
          ${caseStatusPill(gameCase.status)}
        </div>
        <div class="acs-hero-meta">
          <span class="acs-code">${escapeHtml(gameCase.caseId)}</span>
          ${isPixelCase(gameCase) ? pixelPill() : ''}
          ${isV3(gameCase) ? v3Pill() : ''}
          ${meta.length ? `<span class="acs-hero-facts">· ${escapeHtml(meta.join(' · '))}</span>` : ''}
        </div>
        ${gameCase.summary ? `<p class="acs-hero-summary">${escapeHtml(gameCase.summary)}</p>` : ''}
        <div class="acs-hero-actions">
          <button type="button" class="btn" id="validate-btn">${icon('check', 18)}${tr('Validate', 'Kiểm tra')}</button>
          ${publishControl}
        </div>
      </div>
    </section>
    <div class="acs-stats">
      ${statCard(tr('Stages', 'Giai đoạn'), count(gameCase.stages, gameCase.stageCount))}
      ${statCard(tr('Scenes', 'Hiện trường'), count(Array.isArray(gameCase.stages) ? gameCase.stages.flatMap((stage) => stage.scenes ?? []) : null, gameCase.sceneCount))}
      ${statCard(tr('Clues', 'Manh mối'), count(gameCase.clues, gameCase.clueCount))}
      ${mechanicsCard(gameCase)}
    </div>
    ${publishGateCard(gate, validation)}
    <section class="adm-card adm-card--flush acs-content" aria-label="${tr('Case content', 'Nội dung vụ án')}">
      <div class="adm-tabs" role="tablist" aria-label="${tr('Case content', 'Nội dung vụ án')}">
        ${TABS.map((tab) => `<button type="button" role="tab" id="acs-tab-${tab.id}" aria-controls="acs-panel-${tab.id}" data-acs-tab="${tab.id}" aria-selected="${tab.id === activeTab}"${tab.id === activeTab ? ' class="is-active"' : ' tabindex="-1"'}>${escapeHtml(tab.label())}</button>`).join('')}
      </div>
      <div class="acs-tabpanel" id="acs-panel-cutscene" role="tabpanel" aria-labelledby="acs-tab-cutscene"${activeTab === 'cutscene' ? '' : ' hidden'}>
        <section class="cs-panel" id="cutscene-panel" aria-label="${tr('Opening cutscene', 'Cutscene mở đầu')}"></section>
      </div>
      <div class="acs-tabpanel" id="acs-panel-structure" role="tabpanel" aria-labelledby="acs-tab-structure"${activeTab === 'structure' ? '' : ' hidden'}>
        ${structureHtml(gameCase)}
      </div>
      <div class="acs-tabpanel" id="acs-panel-json" role="tabpanel" aria-labelledby="acs-tab-json"${activeTab === 'json' ? '' : ' hidden'}>
        <div class="acs-json-bar">
          <p>${tr('Read only. To change it,', 'Chỉ xem. Muốn thay nội dung,')} <a href="/admin/import">${tr('import new JSON', 'nhập JSON mới')}</a> ${tr('with “Overwrite if caseId exists” turned on.', 'và bật “Ghi đè nếu caseId đã tồn tại”.')}</p>
          <button type="button" class="btn btn-sm" data-acs-copy-json>${COPY_ICON}${tr('Copy JSON', 'Sao chép JSON')}</button>
        </div>
        <pre class="json-view acs-json" tabindex="0" aria-label="${tr('Case JSON', 'JSON vụ án')}" data-acs-json></pre>
      </div>
    </section>
  </div>`);

  watchCovers(app);
  const output = qs('#validation-output', app);
  mountCutscenePanel(qs('#cutscene-panel', app), gameCase.caseId);

  // The JSON of a case is large (a pixel case is ~230 KB): it is written into the page the first time its tab opens.
  const jsonText = () => JSON.stringify(gameCase, null, 2);
  const fillJson = () => {
    const pre = qs('[data-acs-json]', app);
    if (pre && !pre.textContent) pre.textContent = jsonText();
  };
  if (activeTab === 'json') fillJson();

  const showTab = (id, focus = false) => {
    activeTab = id;
    const params = new URLSearchParams(window.location.search);
    const slug = TABS.find((tab) => tab.id === id)?.slug;
    if (slug) params.set('tab', slug);
    else params.delete('tab');
    const text = params.toString();
    replaceAddress(`${window.location.pathname}${text ? `?${text}` : ''}`);
    app.querySelectorAll('[data-acs-tab]').forEach((button) => {
      const on = button.dataset.acsTab === id;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
      if (on && focus) button.focus();
    });
    TABS.forEach((tab) => { qs(`#acs-panel-${tab.id}`, app).hidden = tab.id !== id; });
    if (id === 'json') fillJson();
  };
  const tablist = qs('[role="tablist"]', app);
  tablist.addEventListener('click', (event) => {
    const button = event.target.closest('[data-acs-tab]');
    if (button) showTab(button.dataset.acsTab);
  });
  // Arrow keys move between the tabs, as a tab list should.
  tablist.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = TABS.findIndex((tab) => tab.id === activeTab);
    showTab(TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id, true);
  });

  qs('[data-acs-copy-json]', app).addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(jsonText());
      toast(tr('JSON copied.', 'Đã chép JSON.'), 'success');
    } catch {
      toast(tr('The browser did not allow copying. Select the text and copy it by hand.', 'Trình duyệt không cho chép. Hãy chọn chữ và tự chép.'), 'error');
    }
  });

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

function statCard(label, value) {
  return `<div class="adm-card acs-stat"><span class="acs-stat-label">${escapeHtml(label)}</span><strong class="acs-stat-value">${escapeHtml(String(value))}</strong></div>`;
}

/** "Cơ chế": mechanics version and how the case was made. On a V3 case it is the V3 case profile. */
function mechanicsCard(gameCase) {
  const v3 = isV3(gameCase);
  const isAiPreset = Boolean(gameCase.hasSourceAiDraft || gameCase.sourceAiDraftId);
  const how = v3
    ? `${gameCase.generationMode || 'unknown'} · ${gameCase.generationPreset || 'MANUAL_V3'}`
    : [gameCase.generationMode, gameCase.generationPreset].filter(Boolean).join(' · ');
  return `<div class="adm-card acs-stat${v3 ? ' v3-case-profile' : ''}">
    <span class="acs-stat-label">${tr('Mechanics', 'Cơ chế')}</span>
    <strong class="acs-stat-name">Mechanics ${escapeHtml(String(gameCase.mechanicsVersion ?? 'unknown'))}</strong>
    ${how ? `<span class="acs-code">${escapeHtml(how)}</span>` : ''}
    ${v3 && isAiPreset ? `<span class="acs-stat-note">${tr('Semantic review', 'Duyệt ngữ nghĩa')}: <strong>${escapeHtml(gameCase.aiSemanticReviewStatus || 'NOT_RUN')}</strong> · ${tr('Source AI draft', 'Bản nháp AI gốc')}: <strong>${gameCase.sourceAiDraftId ? tr('attached', 'có') : tr('missing', 'thiếu')}</strong></span>` : ''}
  </div>`;
}

const CHECK_PASS_ICON = icon('check', 16);
const CHECK_FAIL_ICON = icon('x', 16);

/** "Điều kiện xuất bản": every gate check, then the result of the last validation (#validation-output). */
function publishGateCard(gate, validation) {
  return `<section class="adm-card acs-gates v3-publish-gate" aria-labelledby="acs-gates-title">
    <div class="adm-card-head">
      <h2 class="adm-card-title" id="acs-gates-title">${tr('Publish gate', 'Điều kiện xuất bản')}</h2>
      ${gate.checks.length ? `<span class="adm-pill acs-gate-pill ${gate.canPublish ? 'adm-pill--ok' : 'adm-pill--bad'}">${gate.canPublish ? tr('READY', 'SẴN SÀNG') : tr('BLOCKED', 'CHƯA ĐẠT')}</span>` : ''}
    </div>
    ${gate.checks.length ? `<ul class="acs-checks">${gate.checks.map((check) => {
    const text = gateCheckText(check);
    return `<li class="acs-check ${check.passed ? 'v3-gate-pass' : 'v3-gate-fail'}">
        <span class="acs-check-mark" aria-hidden="true">${check.passed ? CHECK_PASS_ICON : CHECK_FAIL_ICON}</span>
        <span class="acs-check-text"><strong><span class="bpa-sr">${check.passed ? 'PASS' : 'BLOCK'} · </span>${escapeHtml(text.label)}</strong><span>${escapeHtml(text.detail)}</span></span>
      </li>`;
  }).join('')}</ul>` : ''}
    <div id="validation-output">${validationResultHtml(validation)}</div>
  </section>`;
}

/** The structure tab: each stage and its scenes, in play order. */
function structureHtml(gameCase) {
  const stages = [...(gameCase.stages ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!stages.length) return stateBox('empty', tr('This case has no stages yet.', 'Vụ án này chưa có giai đoạn nào.'));
  return `<div class="acs-stages">${stages.map((stage, index) => `
    <article class="acs-stage">
      <span class="acs-stage-kicker">${tr('Stage', 'Giai đoạn')} ${escapeHtml(String(stage.order ?? index + 1))}</span>
      <h3 class="acs-stage-title">${escapeHtml(stage.title || stage.stageId || '')}</h3>
      ${(stage.scenes ?? []).length ? `<ul class="acs-scenes">${stage.scenes.map((scene) => `
        <li><span>${escapeHtml(scene.title || scene.sceneId || '')}</span>${scene.sceneId ? `<span class="acs-code">${escapeHtml(scene.sceneId)}</span>` : ''}</li>`).join('')}</ul>`
    : `<p class="acs-stage-empty">${tr('No scenes.', 'Chưa có hiện trường.')}</p>`}
    </article>`).join('')}</div>`;
}

const OK_ICON = icon('check', 18);

function validationResultHtml(result) {
  if (!result) return `<div class="notice notice-bad" role="alert">${tr('Deterministic validation could not be verified. Refresh before publishing.', 'Chưa xác minh được kiểm tra tất định. Hãy tải lại trang trước khi xuất bản.')}</div>`;
  if (result.isValid) return `<div class="notice notice-ok acs-banner" role="status">${OK_ICON}<span>${tr('Validation passed — this case is playable.', 'Kiểm tra thành công — vụ án có thể chơi được.')}</span></div>${warningsHtml(result.warnings)}`;
  return `<div class="notice notice-bad" role="alert"><strong>${result.errors?.length ?? 0} ${tr('validation error(s):', 'lỗi kiểm tra:')}</strong>
    <ul>${(result.errors || []).map((error) => `<li><code>${escapeHtml(error.code)}</code> ${escapeHtml(error.path)} — ${escapeHtml(error.message)}</li>`).join('')}</ul></div>`;
}

/** Non-blocking findings, e.g. questions without three hint levels in a case that predates that rule (VUAN-6). */
function warningsHtml(warnings) {
  if (!Array.isArray(warnings) || !warnings.length) return '';
  return `<div class="notice notice-warn acs-import-warnings" role="status"><strong>${warnings.length} ${tr('warning(s), not blocking:', 'cảnh báo, không chặn:')}</strong>
    <ul>${warnings.map((item) => `<li><code>${escapeHtml(item.code)}</code> ${escapeHtml(item.path)} — ${escapeHtml(item.message)}</li>`).join('')}</ul></div>`;
}

function apiFailureHtml(error) {
  if (Array.isArray(error?.errors)) {
    return `<div class="notice notice-bad" role="alert"><strong>${tr('Publish blocked by validation:', 'Không thể xuất bản do lỗi kiểm tra:')}</strong>
      <ul>${error.errors.map((item) => `<li><code>${escapeHtml(item.code)}</code> ${escapeHtml(item.path)} — ${escapeHtml(item.message)}</li>`).join('')}</ul></div>`;
  }
  const code = error?.errors?.code;
  const messageKey = error?.errors?.messageKey;
  return `<div class="notice notice-bad" role="alert"><strong>${escapeHtml(code || 'PUBLISH_BLOCKED')}</strong><p>${escapeHtml(error?.message || 'Publish was blocked.')}</p>${messageKey ? `<p class="muted small">${escapeHtml(messageKey)}</p>` : ''}</div>`;
}
