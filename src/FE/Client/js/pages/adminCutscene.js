import '../../../css/46-admin-cutscene.css';
import { adminApi } from '../api/adminApi.js';
import { escapeHtml as esc } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';

// Same limits as the server's MotionComicRules; the server checks again on save.
const MAX_LINE = 90;
const MAX_SFX = 12;
const MAX_TITLE = 80;
const MAX_SUBTITLE = 140;

const STATUS_LABELS = {
  DRAFT: () => tr('Draft', 'Bản nháp'),
  APPROVED: () => tr('Approved', 'Đã duyệt'),
  DISABLED: () => tr('Hidden', 'Đã tắt'),
  SUPERSEDED: () => tr('Replaced', 'Bản cũ'),
};
/** Pill colour of each status (adm-pill--*); a draft and an old version stay neutral. */
const STATUS_TONES = { APPROVED: 'ok', DISABLED: 'bad' };

/** The admin block "Cutscene mở đầu": generate with AI, preview, edit the text, approve, hide. */
export function mountCutscenePanel(host, caseId) {
  let data = null;
  let busy = false;
  let editing = false;
  let message = null; // { kind: 'ok' | 'bad', text, items? }
  let disposed = false;

  const latest = () => data?.latest ?? null;
  const approved = () => (data?.versions ?? []).find((v) => v.status === 'APPROVED') ?? null;

  function speakerName(beat) {
    return data?.assets?.characters?.[beat.speakerId]?.title ?? beat.speakerId ?? '';
  }

  function beatsEditor() {
    const script = data.script;
    const rows = [];
    script.pages.forEach((page, pi) => page.panels.forEach((panel, qi) => panel.beats.forEach((beat, bi) => {
      const max = beat.type === 'sfx' ? MAX_SFX : MAX_LINE;
      const label = beat.type === 'sfx' ? tr('Sound effect', 'Chữ hiệu ứng') : beat.type === 'speech' ? `${tr('Speech', 'Thoại')} · ${esc(speakerName(beat))}` : tr('Narration', 'Lời dẫn');
      rows.push(`<label class="cs-row"><span class="cs-label">${tr('Page', 'Trang')} ${pi + 1} · ${tr('Panel', 'Khung')} ${qi + 1} · ${label}</span>
        <input class="field-input" data-beat="${pi}.${qi}.${bi}" maxlength="400" value="${esc(beat.text)}" aria-describedby="cs-count-${pi}-${qi}-${bi}">
        <span class="cs-count" id="cs-count-${pi}-${qi}-${bi}" data-count-for="${pi}.${qi}.${bi}" data-max="${max}"></span></label>`);
    })));
    return `<div class="cs-editor">
      <label class="cs-row"><span class="cs-label">${tr('Eyebrow', 'Dòng nhãn')}</span><input class="field-input" data-title-field="eyebrow" maxlength="${MAX_TITLE}" value="${esc(script.title.eyebrow)}"></label>
      <label class="cs-row"><span class="cs-label">${tr('Title', 'Tên vụ án')}</span><input class="field-input" data-title-field="title" maxlength="${MAX_TITLE}" value="${esc(script.title.title)}"></label>
      <label class="cs-row"><span class="cs-label">${tr('Subtitle', 'Câu mời vào cuộc')}</span><input class="field-input" data-title-field="subtitle" maxlength="${MAX_SUBTITLE}" value="${esc(script.title.subtitle)}"></label>
      ${rows.join('')}
      <div class="cs-actions cs-editor-actions"><button class="btn btn-primary" type="button" data-cs-save>${tr('Save text', 'Lưu chữ')}</button>
        <button class="btn btn-ghost" type="button" data-cs-cancel>${tr('Cancel', 'Hủy')}</button></div></div>`;
  }

  function summary() {
    const l = latest();
    if (!l) return `<p class="cs-note">${tr('No opening cutscene yet. The AI writes one from the public case data only (no solution).', 'Chưa có cutscene mở đầu. AI tự viết từ dữ liệu công khai của vụ án (không đọc lời giải).')}</p>`;
    const live = approved();
    return `<div class="cs-meta"><span class="adm-pill${STATUS_TONES[l.status] ? ` adm-pill--${STATUS_TONES[l.status]}` : ''}" data-cs-status>${esc(STATUS_LABELS[l.status]?.() ?? l.status)}</span>
      <span class="cs-meta-code">v${l.version} · ${esc(l.source)}${l.model ? ` · ${esc(l.model)}` : ''} · ${Number(l.estimatedSeconds).toFixed(0)}s</span></div>
      <p class="cs-note">${live ? tr(`Players see version ${live.version}.`, `Người chơi đang xem bản ${live.version}.`) : tr('Players do not see any opening cutscene right now.', 'Hiện người chơi không thấy cutscene mở đầu nào.')}</p>`;
  }

  function messageHtml() {
    if (!message) return '';
    return `<div class="notice ${message.kind === 'ok' ? 'notice-ok' : 'notice-bad'}" role="${message.kind === 'ok' ? 'status' : 'alert'}">${esc(message.text)}${message.items?.length ? `<ul>${message.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}</div>`;
  }

  function draw() {
    if (disposed) return;
    const l = latest();
    const dis = busy ? 'disabled' : '';
    // The tab above already names this block ("Cutscene mở đầu"), so it opens straight on the status line.
    host.innerHTML = `${summary()}${messageHtml()}
      <div class="cs-actions">
        <button class="btn ${l ? 'btn-ghost' : 'btn-primary'}" type="button" data-cs-generate ${dis}>${l ? tr('Generate again with AI', 'Tạo lại bằng AI') : tr('Generate with AI', 'Tạo bằng AI')}</button>
        <button class="btn btn-ghost" type="button" data-cs-preview ${dis || !data?.script ? 'disabled' : ''}>${tr('Preview', 'Xem thử')}</button>
        <button class="btn btn-ghost" type="button" data-cs-edit aria-pressed="${editing && data?.script ? 'true' : 'false'}" ${dis || !data?.script ? 'disabled' : ''}>${tr('Edit text', 'Sửa chữ')}</button>
        <button class="btn adm-btn-ok" type="button" data-cs-approve ${dis || !l || l.status === 'APPROVED' ? 'disabled' : ''}>${tr('Approve', 'Duyệt')}</button>
        <button class="btn adm-btn-danger" type="button" data-cs-disable ${dis || !approved() ? 'disabled' : ''}>${tr('Hide from players', 'Tắt')}</button>
      </div>
      ${editing && data?.script ? beatsEditor() : ''}`;
    if (editing) refreshCounts();
  }

  function refreshCounts() {
    host.querySelectorAll('[data-beat]').forEach((input) => {
      const span = host.querySelector(`[data-count-for="${input.dataset.beat}"]`);
      const max = Number(span.dataset.max);
      const length = Array.from(input.value.trim()).length;
      span.textContent = `${length}/${max}`;
      span.classList.toggle('cs-over', length > max);
      input.setAttribute('aria-invalid', String(length > max || length === 0));
    });
  }

  async function run(action, success) {
    if (busy) return;
    busy = true; message = null; draw();
    try {
      data = await action();
      if (success) message = { kind: 'ok', text: success };
    } catch (err) {
      const items = Array.isArray(err?.errors) ? err.errors.filter((i) => typeof i === 'string') : [];
      message = { kind: 'bad', text: err?.message || tr('Something went wrong.', 'Có lỗi xảy ra.'), items };
    } finally {
      busy = false; draw();
    }
  }

  function collectEdits() {
    const script = structuredClone(data.script);
    host.querySelectorAll('[data-title-field]').forEach((input) => { script.title[input.dataset.titleField] = input.value.trim(); });
    const problems = [];
    host.querySelectorAll('[data-beat]').forEach((input) => {
      const [pi, qi, bi] = input.dataset.beat.split('.').map(Number);
      const beat = script.pages[pi].panels[qi].beats[bi];
      beat.text = input.value.trim();
      const max = beat.type === 'sfx' ? MAX_SFX : MAX_LINE;
      const length = Array.from(beat.text).length;
      if (!length) problems.push(tr(`Page ${pi + 1}, panel ${qi + 1}: text is required.`, `Trang ${pi + 1}, khung ${qi + 1}: không được để trống.`));
      else if (length > max) problems.push(tr(`Page ${pi + 1}, panel ${qi + 1}: ${length} characters, the limit is ${max}.`, `Trang ${pi + 1}, khung ${qi + 1}: ${length} ký tự, tối đa ${max}.`));
    });
    return { script, problems };
  }

  async function preview() {
    if (!data?.script) return;
    try {
      const [{ playMotionComic }, { storedAudioSettings }] = await Promise.all([
        import('../game/cutscene/motionComic.js'), import('../game/cutscene/audioSettings.js'),
      ]);
      let handle = null;
      handle = await playMotionComic({
        cutscene: { caseId, trigger: 'INTRO', version: latest()?.version ?? 0, script: data.script, assets: data.assets },
        audio: storedAudioSettings(), finishLabel: tr('Close preview', 'Đóng xem thử'),
        onDone: () => { handle?.dispose(); host.querySelector('[data-cs-preview]')?.focus(); },
      });
    } catch {
      toast(tr('The preview could not be played.', 'Không phát được bản xem thử.'), 'error');
    }
  }

  host.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || busy) return;
    if (button.matches('[data-cs-generate]')) {
      const regenerate = Boolean(latest());
      if (regenerate && !window.confirm(tr('Generating again will use AI budget. Continue?', 'Tạo lại sẽ tốn phí AI. Tiếp tục?'))) return;
      editing = false;
      run(() => adminApi.generateCutscene(caseId, regenerate), tr('A new draft was created. Preview it, then approve.', 'Đã tạo bản nháp mới. Xem thử rồi duyệt.'));
    } else if (button.matches('[data-cs-preview]')) preview();
    else if (button.matches('[data-cs-edit]')) { editing = !editing; message = null; draw(); }
    else if (button.matches('[data-cs-cancel]')) { editing = false; message = null; draw(); }
    else if (button.matches('[data-cs-save]')) {
      const { script, problems } = collectEdits();
      if (problems.length) { message = { kind: 'bad', text: tr('Fix these before saving:', 'Sửa các lỗi này trước khi lưu:'), items: problems }; draw(); return; }
      editing = false;
      run(() => adminApi.saveCutscene(caseId, latest().id, script), tr('Saved. Approve it to show players.', 'Đã lưu. Bấm Duyệt để người chơi thấy.'));
    } else if (button.matches('[data-cs-approve]')) {
      run(() => adminApi.approveCutscene(caseId, latest().id), tr('Approved. Players now see this opening.', 'Đã duyệt. Người chơi sẽ thấy phần mở đầu này.'));
    } else if (button.matches('[data-cs-disable]')) {
      run(() => adminApi.disableCutscene(caseId), tr('Hidden. Players go straight to the investigation.', 'Đã tắt. Người chơi vào thẳng phần điều tra.'));
    }
  });
  host.addEventListener('input', (event) => { if (event.target.matches('[data-beat]')) refreshCounts(); });

  busy = true; draw();
  adminApi.cutscene(caseId).then((result) => { data = result; })
    .catch((err) => { message = { kind: 'bad', text: err?.message || tr('Could not load the cutscene.', 'Không tải được cutscene.') }; })
    .finally(() => { busy = false; draw(); });

  return () => { disposed = true; host.innerHTML = ''; };
}
