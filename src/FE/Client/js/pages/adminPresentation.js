import { get, post, put } from '../api/http.js';
import { session } from '../services/session.js';
import { escapeHtml as esc } from '../utils/dom.js';
import { tr } from '../services/i18n.js';
import '../../../css/presentation-admin.css';

export function presentationPlaceholder(draft) {
  if (!draft.hasGeneratedJson && !draft.generatedJson && !draft.importedCaseId) return '';
  return `<section class="presentation-editor panel panel--dossier" data-presentation-host="${esc(draft.draftId)}">
    <h3>${tr('Cinematic presentation', 'Trình diễn cinematic')}</h3>
    <p>${tr('Plan the opening, ending and witness portraits before generating video.', 'Soạn mở đầu, kết thúc và chân dung nhân chứng trước khi tạo video.')}</p>
    <button class="btn btn-secondary" type="button" data-open-presentation>${tr('Open storyboard & costs', 'Mở storyboard và chi phí')}</button></section>`;
}

export function mountPresentationEditor(host, draftId) {
  const base = `/api/admin/ai-cases/${encodeURIComponent(draftId)}/presentation`;
  let state = null;
  let disposed = false;
  let busy = false;
  let timer;
  let revision = 0;
  let error = '';
  let notice = '';
  let urls = [];
  let controller = new AbortController();
  const money = (value) => typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(4)}` : tr('Unknown', 'Chưa xác định');
  function disposeMedia() {
    controller.abort(); controller = new AbortController();
    host.querySelectorAll('video').forEach((video) => { video.pause(); video.removeAttribute('src'); video.load(); });
    urls.forEach((url) => URL.revokeObjectURL(url)); urls = [];
  }
  const kindLabel = (kind) => ({ INTRO: tr('Opening', 'Mở đầu'), ENDING: tr('Ending', 'Kết thúc'), PORTRAIT: tr('Portrait idle', 'Chân dung idle'), REVEAL: tr('Reveal panel', 'Khung hé lộ') })[kind] || kind;
  const active = () => state?.status === 'GENERATING' || (state?.clips || []).some((clip) => ['QUEUED', 'PENDING', 'SUBMITTING', 'POLLING', 'RUNNING', 'DOWNLOADING', 'UPLOADING', 'GENERATING'].includes(clip.status));
  const needsRecovery = () => (state?.clips || []).some((clip) => clip.status === 'SUBMISSION_UNKNOWN');
  function clipHtml(clip) {
    return `<article class="presentation-clip" data-clip-id="${esc(clip.id)}">
      <header><strong>${esc(kindLabel(clip.kind))}${clip.targetId ? ` · ${esc(clip.targetId)}` : ''}</strong><span class="chip">${esc(clip.status || 'DRAFT')}</span></header>
      <div class="presentation-clip-fields">
      <label>${tr('Reference image', 'Ảnh tham chiếu')}<input class="field-input" data-clip-field="sourceImageUrl" value="${esc(clip.sourceImageUrl || '')}" ${active() ? 'disabled' : ''}></label>
      <label>${tr('Motion direction', 'Chỉ dẫn chuyển động')}<textarea class="field-input" rows="3" data-clip-field="prompt" ${active() ? 'disabled' : ''}>${esc(clip.prompt || '')}</textarea></label>
      <label>${tr('Caption', 'Lời dẫn')}<textarea class="field-input" rows="2" data-clip-field="caption" ${active() ? 'disabled' : ''}>${esc(clip.caption || '')}</textarea></label>
      <label>${tr('Duration (seconds)', 'Thời lượng (giây)')}<input type="number" min="1" max="${clip.kind === 'PORTRAIT' ? 4 : 6}" class="field-input" data-clip-field="durationSeconds" value="${Number(clip.durationSeconds) || 4}" ${active() || clip.kind === 'REVEAL' ? 'disabled' : ''}></label>
      <label><input type="checkbox" data-clip-field="generateVideo" ${clip.generateVideo ? 'checked' : ''} ${active() || clip.kind === 'REVEAL' ? 'disabled' : ''}> ${tr('Generate video', 'Tạo video')}</label></div>
      ${clip.videoUrl ? `<video class="presentation-preview" controls playsinline muted preload="none" data-media-url="${esc(clip.videoUrl)}"></video>` : ''}
      ${clip.posterUrl ? `<button class="btn btn-ghost btn-sm" type="button" data-preview-poster="${esc(clip.posterUrl)}">${tr('Preview reference', 'Xem ảnh tham chiếu')}</button>` : ''}
      ${clip.errorCode ? `<p class="notice notice-bad">${esc(clip.errorCode)}</p>` : ''}
      ${clip.approved ? `<span class="chip chip-ok">${tr('Approved', 'Đã duyệt')}</span>` : `<button class="btn btn-secondary btn-sm" type="button" data-approve-clip="${esc(clip.id)}" ${!['READY', 'FALLBACK_READY'].includes(clip.status) || !clip.posterUrl ? 'disabled' : ''}>${tr('Approve this clip', 'Duyệt clip này')}</button>`}
      <div class="presentation-clip-generation"><label><input type="checkbox" data-approve-clip-budget ${!state.generationEnabled || !state.version || active() || typeof clip.estimatedUsd !== 'number' ? 'disabled' : ''}> ${tr('Approve only this clip', 'Duyệt dự toán riêng clip này')}: ${money(clip.estimatedUsd)}</label>
      <button class="btn btn-ghost btn-sm" type="button" data-generate-clip="${esc(clip.id)}" disabled>${tr('Generate this clip', 'Tạo riêng clip này')}</button></div>
      ${clip.status === 'SUBMISSION_UNKNOWN' && session.isAdmin() ? `<details class="presentation-recovery"><summary>${tr('Recover provider request', 'Khôi phục yêu cầu provider')}</summary><p>${tr('Find the existing request ID in the provider dashboard. Recovery resumes polling without sending a new generation request.', 'Lấy request ID đã có từ dashboard provider. Khôi phục sẽ tiếp tục polling mà không gửi yêu cầu tạo video mới.')}</p><label>Provider request ID<input class="field-input" data-recovery-id maxlength="200" autocomplete="off"></label><button class="btn btn-secondary btn-sm" type="button" data-recover-clip="${esc(clip.id)}" disabled>${tr('Resume this request', 'Tiếp tục yêu cầu này')}</button></details>` : ''}
    </article>`;
  }
  function draw() {
    if (disposed) return;
    disposeMedia();
    host.innerHTML = `<h3>${tr('Cinematic presentation', 'Trình diễn cinematic')}</h3>
      <p class="muted">${tr('Pixel Victorian · opening 6s · ending 6s · up to three 4s portraits. Each player watches independently.', 'Pixel Victorian · mở đầu 6 giây · kết thúc 6 giây · tối đa ba chân dung 4 giây. Mỗi người xem độc lập.')}</p>
      ${error ? `<p class="notice notice-bad" role="alert">${esc(error)}</p>` : ''}
      ${notice ? `<p class="notice notice-ok" role="status">${esc(notice)}</p>` : ''}
      ${state ? `<div class="presentation-clips">${(state.clips || []).map(clipHtml).join('')}</div>
        <div class="presentation-budget"><strong>${tr('Video estimate', 'Dự toán video')}: ${money(state.estimate?.totalUsd)}</strong>
        <span class="muted small">${esc(state.estimate?.model || '')} · ${esc(state.estimate?.pricingVersion || '')}</span>
        ${state.disabledReason ? `<p>${esc(state.disabledReason)}</p>` : ''}
        ${!state.version ? `<p>${tr('Save this storyboard before approving generation.', 'Lưu storyboard này trước khi duyệt tạo video.')}</p>` : ''}
        <label><input type="checkbox" data-approve-budget ${!state.generationEnabled || !state.version || active() ? 'disabled' : ''}> ${tr('I approve this estimate for the saved storyboard.', 'Tôi duyệt dự toán này cho storyboard đã lưu.')}</label></div>
        <div class="case-actions"><button class="btn btn-secondary" data-save-storyboard ${active() ? 'disabled' : ''}>${tr('Save storyboard', 'Lưu storyboard')}</button>
        <button class="btn btn-primary" data-generate-video disabled>${tr('Generate approved videos', 'Tạo video đã duyệt dự toán')}</button>
        <button class="btn btn-secondary" data-approve-presentation ${active() || !(state.clips || []).length ? 'disabled' : ''}>${tr('Approve presentation', 'Duyệt bộ trình diễn')}</button>
        <button class="btn btn-ghost" data-refresh-presentation>${tr('Refresh', 'Làm mới')}</button></div>` : `<p role="status">${tr('Loading storyboard…', 'Đang tải storyboard…')}</p>`}
      <details class="presentation-usage"><summary>${tr('AI usage and cost', 'Token và chi phí AI')}</summary><button class="btn btn-ghost btn-sm" data-load-usage>${tr('Load usage', 'Xem số liệu')}</button><div data-usage-output></div></details>`;
    bind();
    if (needsRecovery()) {
      const message = document.createElement('p'); message.className = 'notice notice-bad';
      message.textContent = tr('Resolve the existing provider request before editing or generating more clips.', 'Khôi phục yêu cầu provider hiện tại trước khi sửa hoặc tạo thêm clip.');
      host.querySelector('h3')?.after(message);
      host.querySelectorAll('[data-clip-field], [data-approve-budget], [data-approve-clip-budget], [data-generate-video], [data-generate-clip], [data-save-storyboard], [data-approve-presentation], [data-approve-clip]').forEach((control) => control.disabled = true);
    }
  }
  function collect() {
    return (state.clips || []).map((clip) => {
      const container = Array.from(host.querySelectorAll('[data-clip-id]')).find((node) => node.dataset.clipId === clip.id);
      const result = { id: clip.id, kind: clip.kind, targetId: clip.targetId, speaker: clip.speaker };
      for (const name of ['sourceImageUrl', 'prompt', 'caption', 'durationSeconds', 'generateVideo']) {
        const input = container.querySelector(`[data-clip-field="${name}"]`);
        result[name] = name === 'generateVideo' ? input.checked : name === 'durationSeconds' ? Number(input.value) : input.value;
      }
      return result;
    });
  }
  async function perform(action, success = '') {
    if (busy || disposed) return;
    busy = true; error = ''; notice = ''; clearTimeout(timer);
    host.querySelectorAll('button').forEach((button) => button.disabled = true);
    try { state = await action(); notice = success; }
    catch (failure) { error = failure?.message || tr('Request failed.', 'Thao tác không thành công.'); }
    finally { busy = false; if (!disposed) { draw(); schedule(); } }
  }
  function schedule() {
    clearTimeout(timer);
    if (!disposed && active()) timer = setTimeout(() => perform(() => get(base)), 4000);
  }
  async function loadMedia(element, url) {
    // No credential is ever appended to a media URL or forwarded to a different origin.
    const parsed = new URL(url, location.origin);
    if (parsed.origin !== location.origin || !parsed.pathname.startsWith('/api/admin/ai-cases/')) return;
    const version = revision;
    try {
      const response = await fetch(parsed.pathname, { headers: { Authorization: `Bearer ${session.token()}` }, signal: controller.signal });
      if (!response.ok) throw new Error(tr('Media preview is unavailable.', 'Chưa xem được media.'));
      const blob = await response.blob();
      if (disposed || version !== revision || !element.isConnected) return;
      const objectUrl = URL.createObjectURL(blob); urls.push(objectUrl); element.src = objectUrl;
    } catch (failure) {
      if (failure.name !== 'AbortError' && element.isConnected) {
        const message = document.createElement('p'); message.className = 'muted'; message.textContent = failure.message; element.after(message);
      }
    }
  }
  function bind() {
    revision += 1;
    const options = { signal: controller.signal };
    host.querySelector('[data-save-storyboard]')?.addEventListener('click', () => {
      const clips = collect();
      void perform(() => put(base, { expectedVersion: state.version, clips }), tr('Storyboard saved. Review the updated estimate.', 'Đã lưu storyboard. Hãy kiểm tra dự toán mới.'));
    }, options);
    const budget = host.querySelector('[data-approve-budget]');
    budget?.addEventListener('change', () => { host.querySelector('[data-generate-video]').disabled = !budget.checked || !state.generationEnabled || active(); }, options);
    host.querySelectorAll('[data-clip-field]').forEach((field) => field.addEventListener('input', () => {
      budget.checked = false; budget.disabled = true;
      host.querySelector('[data-generate-video]').disabled = true;
      host.querySelector('[data-approve-presentation]').disabled = true;
      host.querySelectorAll('[data-approve-clip]').forEach((button) => button.disabled = true);
      host.querySelectorAll('[data-approve-clip-budget]').forEach((checkbox) => { checkbox.checked = false; checkbox.disabled = true; });
      host.querySelectorAll('[data-generate-clip]').forEach((button) => button.disabled = true);
    }, options));
    host.querySelector('[data-generate-video]')?.addEventListener('click', () => {
      if (!budget?.checked || !state.generationEnabled) return;
      void perform(() => post(`${base}/generate`, { expectedVersion: state.version, approvedBudgetUsd: state.estimate.totalUsd }), tr('Video generation queued.', 'Đã đưa video vào hàng đợi.'));
    }, options);
    host.querySelector('[data-refresh-presentation]')?.addEventListener('click', () => perform(() => get(base)), options);
    host.querySelector('[data-approve-presentation]')?.addEventListener('click', () => perform(() => post(`${base}/approve`, { expectedVersion: state.version }), tr('Presentation approved. Publish the case to apply it.', 'Đã duyệt trình diễn. Xuất bản case để áp dụng.')), options);
    host.querySelectorAll('[data-approve-clip]').forEach((button) => button.addEventListener('click', () => perform(() => post(`${base}/clips/${encodeURIComponent(button.dataset.approveClip)}/approve`, { expectedVersion: state.version })), options));
    host.querySelectorAll('[data-clip-id]').forEach((card) => {
      const checkbox = card.querySelector('[data-approve-clip-budget]');
      const generate = card.querySelector('[data-generate-clip]');
      checkbox.addEventListener('change', () => { generate.disabled = !checkbox.checked || !state.generationEnabled || active(); }, options);
      generate.addEventListener('click', () => {
        const clip = state.clips.find((entry) => entry.id === card.dataset.clipId);
        if (!checkbox.checked || checkbox.disabled || !state.generationEnabled || !clip) return;
        void perform(() => post(`${base}/clips/${encodeURIComponent(clip.id)}/generate`, { expectedVersion: state.version, approvedBudgetUsd: clip.estimatedUsd }), tr('Only this clip was queued.', 'Đã đưa riêng clip này vào hàng đợi.'));
      }, options);
      const recovery = card.querySelector('[data-recovery-id]');
      const recover = card.querySelector('[data-recover-clip]');
      recovery?.addEventListener('input', () => { recover.disabled = !recovery.value.trim(); }, options);
      recover?.addEventListener('click', () => {
        const providerRequestId = recovery.value.trim();
        if (providerRequestId) void perform(() => post(`${base}/clips/${encodeURIComponent(card.dataset.clipId)}/recover`, { providerRequestId }), tr('Resuming the existing provider request.', 'Đang tiếp tục yêu cầu provider đã có.'));
      }, options);
    });
    host.querySelectorAll('[data-media-url]').forEach((video) => {
      const start = () => {
        if (video.src || video.dataset.requested) return;
        video.dataset.requested = 'true';
        void loadMedia(video, video.dataset.mediaUrl).then(() => { if (video.isConnected && video.src) void video.play().catch(() => {}); });
      };
      video.addEventListener('pointerdown', start, options); video.addEventListener('focus', start, options);
      // One short clip at a time; preload does not begin until the user selects it.
      video.addEventListener('play', () => host.querySelectorAll('video').forEach((other) => { if (other !== video) other.pause(); }), options);
    });
    host.querySelectorAll('[data-preview-poster]').forEach((button) => button.addEventListener('click', () => {
      const img = document.createElement('img'); img.className = 'presentation-preview'; img.alt = tr('Reference frame', 'Khung hình tham chiếu');
      button.replaceWith(img); void loadMedia(img, button.dataset.previewPoster);
    }, options));
    host.querySelector('[data-load-usage]')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      const output = host.querySelector('[data-usage-output]');
      try {
        const usage = await get(`/api/admin/ai-cases/${encodeURIComponent(draftId)}/usage`);
        if (disposed || !output.isConnected) return;
        output.innerHTML = `<p>${usage.calls} ${tr('calls', 'lần gọi')} · ${usage.inputTokens} input / ${usage.outputTokens} output · ${usage.cachedInputTokens} cached</p>
          <p>${tr('Provider billed', 'Provider báo phí')}: ${money(usage.measuredCostUsd)} · ${tr('Calculated from usage', 'Tính theo usage')}: ${money(usage.calculatedCostUsd)} · ${tr('Unknown calls', 'Lần gọi chưa rõ phí')}: ${usage.unknownCalls} · ${tr('Reserved', 'Đang dự phòng')}: ${money(usage.reservedUsd)}</p>
          ${usage.isTruncated ? `<p>${tr('Only the latest 5,000 calls are shown.', 'Chỉ hiển thị 5.000 lần gọi gần nhất.')}</p>` : ''}
          <div class="table-scroll"><table class="admin-table"><thead><tr><th>${tr('Step', 'Bước')}</th><th>Model</th><th>Tokens</th><th>${tr('Cost', 'Chi phí')}</th></tr></thead><tbody>${(usage.events || []).slice(0, 30).map((row) => `<tr><td>${esc(row.step)}<br>${esc(row.state)}</td><td>${esc(row.model)}</td><td>${row.inputTokens ?? '—'} / ${row.outputTokens ?? '—'}</td><td>${money(row.costUsd)}<br><small>${esc(row.costSource)}</small></td></tr>`).join('')}</tbody></table></div>`;
      } catch (failure) { if (!disposed && output.isConnected) output.textContent = failure.message; }
      finally { if (host.isConnected) host.querySelector('[data-load-usage]').disabled = false; }
    }, options);
  }
  draw(); void perform(() => get(base));
  return () => { disposed = true; clearTimeout(timer); disposeMedia(); };
}
