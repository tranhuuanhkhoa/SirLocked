import { adminApi } from '../api/adminApi.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';

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
        <a class="btn btn-ghost" href="#/admin/cases">${tr('Manage cases', 'Quản lý vụ án')}</a>
        <a class="btn btn-ghost" href="#/admin/ai">${tr('AI case creator', 'Tạo vụ án AI')}</a>
      </div>
    </div>
    <div class="stat-grid">${statCards}</div>
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
