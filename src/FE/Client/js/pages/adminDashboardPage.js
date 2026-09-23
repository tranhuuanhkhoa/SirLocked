import { adminApi } from '../api/adminApi.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';

function formatDuration(ms) {
  const total = Math.round(Number(ms) || 0);
  if (total < 1000) return `${total} ms`;
  const seconds = Math.round(total / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Playtest card markup, or an empty string when instrumentation is off. */
function playtestSection(summary) {
  if (!summary) return '';

  const waiting = summary.waitingMsByRole || {};
  const outcomes = summary.confrontationOutcomes || {};
  const tiers = Object.entries(summary.hintCountByTier || {});
  const imbalance = summary.waitingImbalancePct == null
    ? tr('not comparable yet', 'chưa so sánh được')
    : `${Number(summary.waitingImbalancePct).toFixed(1)}%`;

  const cards = [
    [tr('Sessions', 'Phiên chơi'), String(summary.sessionCount ?? 0)],
    [tr('Investigator waiting', 'Điều tra viên chờ'), formatDuration(waiting.INVESTIGATOR)],
    [tr('Interrogator waiting', 'Thẩm vấn viên chờ'), formatDuration(waiting.INTERROGATOR)],
    [tr('Waiting imbalance', 'Chênh lệch thời gian chờ'), imbalance],
    [
      tr('Confrontations', 'Đối chất'),
      `${outcomes.ResolvedCorrect ?? 0} ${tr('correct', 'đúng')}`
      + ` · ${outcomes.ResolvedIncorrect ?? 0} ${tr('wrong', 'sai')}`
      + ` · ${outcomes.Cancelled ?? 0} ${tr('cancelled', 'đã hủy')}`,
    ],
    [
      tr('Median stage time', 'Trung vị thời gian mỗi chặng'),
      summary.medianStageMs == null ? '—' : formatDuration(summary.medianStageMs),
    ],
    [
      tr('Hints by tier', 'Gợi ý theo bậc'),
      tiers.length ? tiers.map(([tier, count]) => `T${tier}×${count}`).join(' · ') : '—',
    ],
  ].map(([label, value]) => `
    <div class="stat-card"><span class="muted small">${label}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('');

  // The read side caps how many events one summary folds, so an over-wide window degrades visibly
  // instead of pulling an unbounded collection into the API process.
  const counted = escapeHtml(String(summary.eventCount ?? 0));
  const truncated = summary.isTruncated
    ? `<p class="notice">${tr(
      `Only the first ${counted} events in this range were counted. Narrow the range for exact numbers.`,
      `Chỉ ${counted} sự kiện đầu tiên trong khoảng này được tính. Hãy thu hẹp khoảng thời gian để có số chính xác.`,
    )}</p>`
    : '';

  return `
    <h3 class="section-title">${tr('Playtest telemetry', 'Đo đạc phiên chơi thử')}</h3>
    <p class="muted small">${tr(
      'Hashed per-room signals from V3 sessions only; no room, player, or case identifiers are stored.',
      'Tín hiệu đã băm theo từng phòng, chỉ từ các ván V3; không lưu định danh phòng, người chơi hay vụ án.',
    )}</p>
    ${truncated}
    <div class="stat-grid">${cards}</div>`;
}

export async function renderAdminDashboardPage(app) {
  render(app, `<div class="page"><p class="muted">${tr('Loading dashboard…', 'Đang tải bảng điều khiển…')}</p></div>`);

  let stats;
  let users;
  try {
    [stats, users] = await Promise.all([adminApi.dashboard(), adminApi.users()]);
  } catch (err) {
    render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
    return;
  }

  // Telemetry is opt-in; a 404/403 means the gate is closed, so the card is simply absent.
  let playtest = null;
  try {
    playtest = await adminApi.playtestSummary();
  } catch {
    playtest = null;
  }

  const statCards = [
    [tr('Users', 'Người dùng'), stats.totalUsers],
    [tr('Cases', 'Vụ án'), `${stats.publishedCases}/${stats.totalCases} ${tr('published', 'đã xuất bản')}`],
    [tr('Rooms', 'Phòng'), `${stats.activeRooms} ${tr('active', 'đang hoạt động')} / ${stats.totalRooms}`],
    [tr('Games finished', 'Ván đã kết thúc'), `${stats.wins} ${tr('won', 'thắng')} · ${stats.losses} ${tr('failed', 'thua')}`],
    [tr('AI drafts', 'Bản nháp AI'), stats.totalAiDrafts],
  ].map(([label, value]) => `
    <div class="stat-card"><span class="muted small">${label}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('');

  const userRows = users.map((u) => `
    <tr>
      <td>${escapeHtml(u.fullName)}</td>
      <td class="muted">${escapeHtml(u.email)}</td>
      <td><span class="chip ${u.role === 'ADMIN' || u.role === 'VIP' ? 'chip-gold' : ''}">${u.role}</span></td>
      <td><span class="chip ${u.status === 'ACTIVE' ? 'chip-ok' : 'chip-bad'}">${u.status}</span></td>
      <td>
        ${u.role === 'ADMIN' ? '' : `
          ${u.role === 'VIP'
            ? `<button class="btn btn-ghost btn-sm" data-role-user="${u.userId}" data-role="PLAYER">${tr('Make player', 'Đổi thành người chơi')}</button>`
            : `<button class="btn btn-ghost btn-sm" data-role-user="${u.userId}" data-role="VIP">${tr('Make VIP', 'Nâng lên VIP')}</button>`}
          ${u.status === 'ACTIVE'
            ? `<button class="btn btn-ghost btn-sm" data-lock="${u.userId}">${tr('Lock', 'Khóa')}</button>`
            : `<button class="btn btn-ghost btn-sm" data-unlock="${u.userId}">${tr('Unlock', 'Mở khóa')}</button>`}
        `}
      </td>
    </tr>`).join('');

  render(app, `
  <div class="page">
    <div class="page-head">
      <h2>${tr('Admin Dashboard', 'Bảng điều khiển quản trị')}</h2>
      <div class="case-actions">
        <button class="btn btn-primary" id="seed-sample">${tr('Seed + publish sample case', 'Tạo và xuất bản vụ án mẫu')}</button>
        <button class="btn btn-ghost" id="seed-demo">${tr('Seed demo cases', 'Tạo các vụ án demo')}</button>
        <button class="btn btn-ghost" id="seed-crack-demo">${tr('Seed Crack cases', 'Tạo các vụ án Crack')}</button>
        <a class="btn btn-ghost" href="#/admin/cases">${tr('Manage cases', 'Quản lý vụ án')}</a>
        <a class="btn btn-ghost" href="#/admin/ai">${tr('AI case creator', 'Tạo vụ án AI')}</a>
      </div>
    </div>
    <div class="stat-grid">${statCards}</div>
    ${playtestSection(playtest)}
    <h3 class="section-title">${tr('Users', 'Người dùng')}</h3>
    <table class="admin-table">
      <thead><tr><th>${tr('Name', 'Tên')}</th><th>Email</th><th>${tr('Role', 'Vai trò')}</th><th>${tr('Status', 'Trạng thái')}</th><th></th></tr></thead>
      <tbody>${userRows}</tbody>
    </table>
  </div>`);

  app.querySelector('#seed-sample').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const seeded = await adminApi.seedSample();
      toast(`"${seeded.title}" seeded and published.`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    e.target.disabled = false;
  });

  app.querySelector('#seed-demo').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const seeded = await adminApi.seedDemo();
      toast(`${seeded.length} demo case(s) seeded and published.`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    e.target.disabled = false;
  });

  app.querySelector('#seed-crack-demo').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const seeded = await adminApi.seedCrackDemo();
      toast(`${seeded.length} Crack case(s) seeded and published.`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    e.target.disabled = false;
  });

  const rebind = (selector, action) =>
    app.querySelectorAll(selector).forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await action(btn.dataset.lock || btn.dataset.unlock);
          renderAdminDashboardPage(app);
        } catch (err) {
          toast(err.message, 'error');
        }
      }));
  rebind('[data-lock]', adminApi.lockUser);
  rebind('[data-unlock]', adminApi.unlockUser);
  app.querySelectorAll('[data-role-user]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await adminApi.setUserRole(btn.dataset.roleUser, btn.dataset.role);
        renderAdminDashboardPage(app);
      } catch (err) {
        toast(err.message, 'error');
      }
    }));
}
