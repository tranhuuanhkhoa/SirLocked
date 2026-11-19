import { weeklyApi } from '../api/weeklyApi.js';
import { caseApi } from '../api/caseApi.js';
import { icon, pageHead, stateBox } from '../components/admin/ui.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

/**
 * Admin page (/admin/weekly) to set/clear the Case of the Week and the Weekly Challenge.
 * Admin-gated by the router (admin: true) and by the server ([Authorize(Roles="ADMIN")]).
 *
 * The challenge always runs a whole week (07:00 Wednesday to 07:00 Wednesday, Vietnam time), so its form asks for one
 * day and the server snaps it to that day's week; only the running week or the next one is accepted.
 */

const CHALLENGE = 'WEEKLY_CHALLENGE';
const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000; // Vietnam is UTC+7 all year

const TYPES = [
  { key: 'CASE_OF_WEEK', label: 'Vụ án của tuần', hint: 'Hiện trên banner trang chủ.', icon: 'star', tone: 'gold' },
  { key: CHALLENGE, label: 'Thử thách tuần', hint: 'Case người chơi được thách đấu trong tuần.', icon: 'trophy', tone: 'violet' },
];

const CHALLENGE_DAY_HINT = 'Tuần thử thách chạy từ 07:00 thứ Tư đến 07:00 thứ Tư tuần sau. Chọn một ngày trong tuần đang chạy hoặc tuần sau.';

const HEAD = () => pageHead({ title: 'Quản lý tuần', sub: 'Chọn case nổi bật cho banner và thử thách tuần.' });

export function renderWeeklyAdminPage(app) {
  return renderPage(app, null);
}

/** `saved` is the challenge week the server just stored, shown once on the challenge form after the page is drawn again. */
async function renderPage(app, saved) {
  render(app, `<div class="page acs-page ws-weekly-admin">${HEAD()}${stateBox('loading', 'Đang tải…')}</div>`);

  let cases;
  let active;
  try {
    const [list, cow, challenge] = await Promise.all([
      caseApi.published(),
      weeklyApi.caseOfWeek(),
      weeklyApi.challenge(),
    ]);
    cases = list || [];
    active = { CASE_OF_WEEK: cow, [CHALLENGE]: challenge };
  } catch (err) {
    toast(err.message || 'Không tải được dữ liệu.', 'error');
    render(app, `<div class="page acs-page ws-weekly-admin">${HEAD()}${stateBox('error', 'Không tải được dữ liệu admin.')}</div>`);
    return;
  }

  render(app, `
    <div class="page acs-page ws-weekly-admin">
      ${HEAD()}
      <div class="acs-weekly-grid">
        ${TYPES.map((t) => formHtml(t, cases, active[t.key], t.key === CHALLENGE ? saved : null)).join('')}
      </div>
    </div>`);

  TYPES.forEach((t) => wireForm(app, t.key));
}

function formHtml(type, cases, current, saved) {
  const options = cases.map((c) =>
    `<option value="${escapeHtml(c.caseId)}">${escapeHtml(c.title)}</option>`).join('');
  const challenge = type.key === CHALLENGE;
  const windowText = (feature) => (challenge
    ? weekWindowText(feature)
    : `${fmtDate(feature.weekStart)} – ${fmtDate(feature.weekEnd)}`);
  const currentLine = current
    ? `Đang chọn: <strong>${escapeHtml(current.caseTitle)}</strong> (${escapeHtml(windowText(current))})`
    : 'Chưa đặt.';
  const id = `ws-weekly-${type.key.toLowerCase()}`;

  const dates = challenge
    ? `
      <label class="ws-weekly-label"><span>Ngày trong tuần</span>
        <input class="ws-weekly-input" type="date" name="weekDay" required aria-describedby="${id}-day-hint">
      </label>
      <p class="ws-weekly-hint" id="${id}-day-hint">${escapeHtml(CHALLENGE_DAY_HINT)}</p>`
    : `
      <div class="ws-weekly-dates">
        <label class="ws-weekly-label"><span>Bắt đầu</span>
          <input class="ws-weekly-input" type="date" name="weekStart" required>
        </label>
        <label class="ws-weekly-label"><span>Kết thúc</span>
          <input class="ws-weekly-input" type="date" name="weekEnd" required>
        </label>
      </div>`;

  const messages = challenge
    ? `${saved ? `<p class="ws-weekly-saved" role="status" data-weekly-saved>Đã lưu: <strong>${escapeHtml(saved.caseTitle)}</strong> cho tuần ${escapeHtml(weekWindowText(saved))}.</p>` : ''}
      <p class="ws-weekly-error" role="alert" data-weekly-error hidden></p>`
    : '';

  return `
    <form class="adm-card ws-weekly-form" data-type="${type.key}" aria-labelledby="${id}-title">
      <div class="acs-weekly-head">
        <span class="acs-weekly-icon acs-weekly-icon--${type.tone}" aria-hidden="true">${icon(type.icon, 24)}</span>
        <div class="acs-weekly-heading">
          <h2 class="adm-card-title" id="${id}-title">${escapeHtml(type.label)}</h2>
          <p class="adm-card-sub">${escapeHtml(type.hint)}</p>
        </div>
      </div>
      <p class="ws-weekly-current acs-weekly-state${current ? ' is-set' : ''}" role="status"><span>${currentLine}</span></p>
      <label class="ws-weekly-label"><span>Case</span>
        <select class="ws-weekly-select" name="caseId" required>
          <option value="">— Chọn case —</option>
          ${options}
        </select>
      </label>
      ${dates}
      ${messages}
      <div class="ws-weekly-actions">
        <button type="submit" class="btn btn-primary ws-weekly-save">Lưu</button>
        <button type="button" class="btn adm-btn-danger ws-weekly-clear">Xóa</button>
      </div>
    </form>`;
}

function wireForm(app, type) {
  const form = app.querySelector(`.ws-weekly-form[data-type="${type}"]`);
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (type === CHALLENGE) void saveChallenge(app, form);
    else void saveCaseOfWeek(app, form, type);
  });

  form.querySelector('.ws-weekly-clear').addEventListener('click', async () => {
    try {
      await weeklyApi.clear(type);
      toast('Đã xóa.', 'success');
      renderWeeklyAdminPage(app);
    } catch (err) {
      toast(err.message || 'Không xóa được.', 'error');
    }
  });
}

/** One day names the week; weekEnd is that day plus seven days so the request keeps its old shape (the server does not read it). */
async function saveChallenge(app, form) {
  const caseId = form.elements.caseId.value;
  const day = form.elements.weekDay.value;
  const error = form.querySelector('[data-weekly-error]');
  const showError = (message) => {
    error.textContent = message;
    error.hidden = false;
  };
  error.hidden = true;
  form.querySelector('[data-weekly-saved]')?.remove();
  const start = Date.parse(day); // a yyyy-mm-dd date reads as 00:00 UTC = 07:00 in Vietnam
  if (!caseId || Number.isNaN(start)) {
    showError('Hãy chọn case và một ngày trong tuần.');
    return;
  }

  const save = form.querySelector('.ws-weekly-save');
  save.disabled = true;
  let stored;
  try {
    stored = await weeklyApi.set({
      type: CHALLENGE,
      caseId,
      weekStart: new Date(start).toISOString(),
      weekEnd: new Date(start + 7 * DAY_MS).toISOString(),
    });
  } catch (err) {
    showError(err?.status === 0 ? 'Không kết nối được máy chủ, thử lại sau.' : (err?.message || 'Không lưu được.'));
    save.disabled = false;
    return;
  }
  toast('Đã lưu.', 'success');
  renderPage(app, stored);
}

async function saveCaseOfWeek(app, form, type) {
  const caseId = form.elements.caseId.value;
  const weekStart = form.elements.weekStart.value;
  const weekEnd = form.elements.weekEnd.value;
  if (!caseId || !weekStart || !weekEnd) {
    toast('Hãy chọn case và khoảng thời gian.', 'error');
    return;
  }
  if (new Date(weekEnd) <= new Date(weekStart)) {
    toast('Ngày kết thúc phải sau ngày bắt đầu.', 'error');
    return;
  }
  const save = form.querySelector('.ws-weekly-save');
  save.disabled = true;
  try {
    await weeklyApi.set({
      type,
      caseId,
      weekStart: new Date(weekStart).toISOString(),
      weekEnd: new Date(`${weekEnd}T23:59:59`).toISOString(),
    });
    toast('Đã lưu.', 'success');
    renderWeeklyAdminPage(app);
  } catch (err) {
    toast(err.message || 'Không lưu được.', 'error');
    save.disabled = false;
  }
}

function fmtDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '?' : d.toLocaleDateString('vi-VN');
}

/** "07:00 18/11/2026" in Vietnam time, whatever the admin's own clock says. */
function fmtVietnamTime(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '?';
  const d = new Date(ms + VN_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

const weekWindowText = (feature) => `${fmtVietnamTime(feature?.weekStart)} – ${fmtVietnamTime(feature?.weekEnd)}`;
