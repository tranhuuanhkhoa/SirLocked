import { weeklyApi } from '../api/weeklyApi.js';
import { caseApi } from '../api/caseApi.js';
import { icon, pageHead, stateBox } from '../components/admin/ui.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

/**
 * Admin page (/admin/weekly) to set/clear the Case of the Week and the Weekly Challenge.
 * Admin-gated by the router (admin: true) and by the server ([Authorize(Roles="ADMIN")]).
 */

const TYPES = [
  { key: 'CASE_OF_WEEK', label: 'Vụ án của tuần', hint: 'Hiện trên banner trang chủ.', icon: 'star', tone: 'gold' },
  { key: 'WEEKLY_CHALLENGE', label: 'Thử thách tuần', hint: 'Case người chơi được thách đấu trong tuần.', icon: 'trophy', tone: 'violet' },
];

const HEAD = () => pageHead({ title: 'Quản lý tuần', sub: 'Chọn case nổi bật cho banner và thử thách tuần.' });

export async function renderWeeklyAdminPage(app) {
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
    active = { CASE_OF_WEEK: cow, WEEKLY_CHALLENGE: challenge };
  } catch (err) {
    toast(err.message || 'Không tải được dữ liệu.', 'error');
    render(app, `<div class="page acs-page ws-weekly-admin">${HEAD()}${stateBox('error', 'Không tải được dữ liệu admin.')}</div>`);
    return;
  }

  render(app, `
    <div class="page acs-page ws-weekly-admin">
      ${HEAD()}
      <div class="acs-weekly-grid">
        ${TYPES.map((t) => formHtml(t, cases, active[t.key])).join('')}
      </div>
    </div>`);

  TYPES.forEach((t) => wireForm(app, t.key, cases));
}

function formHtml(type, cases, current) {
  const options = cases.map((c) =>
    `<option value="${escapeHtml(c.caseId)}">${escapeHtml(c.title)}</option>`).join('');
  const currentLine = current
    ? `Đang chọn: <strong>${escapeHtml(current.caseTitle)}</strong> (${fmtDate(current.weekStart)} – ${fmtDate(current.weekEnd)})`
    : 'Chưa đặt.';
  const id = `ws-weekly-${type.key.toLowerCase()}`;

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
      <div class="ws-weekly-dates">
        <label class="ws-weekly-label"><span>Bắt đầu</span>
          <input class="ws-weekly-input" type="date" name="weekStart" required>
        </label>
        <label class="ws-weekly-label"><span>Kết thúc</span>
          <input class="ws-weekly-input" type="date" name="weekEnd" required>
        </label>
      </div>
      <div class="ws-weekly-actions">
        <button type="submit" class="btn btn-primary ws-weekly-save">Lưu</button>
        <button type="button" class="btn adm-btn-danger ws-weekly-clear">Xóa</button>
      </div>
    </form>`;
}

function wireForm(app, type, cases) {
  const form = app.querySelector(`.ws-weekly-form[data-type="${type}"]`);
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
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

function fmtDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '?' : d.toLocaleDateString('vi-VN');
}
