import { adminApi } from '../api/adminApi.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

export async function renderAdminDashboardPage(app) {
  render(app, '<div class="page"><p class="muted">Loading dashboard…</p></div>');

  let stats;
  let users;
  try {
    [stats, users] = await Promise.all([adminApi.dashboard(), adminApi.users()]);
  } catch (err) {
    render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
    return;
  }

  const statCards = [
    ['Users', stats.totalUsers],
    ['Cases', `${stats.publishedCases}/${stats.totalCases} published`],
    ['Rooms', `${stats.activeRooms} active / ${stats.totalRooms}`],
    ['Games finished', `${stats.wins} won · ${stats.losses} failed`],
    ['AI drafts', stats.totalAiDrafts],
  ].map(([label, value]) => `
    <div class="stat-card"><span class="muted small">${label}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('');

  const userRows = users.map((u) => `
    <tr>
      <td>${escapeHtml(u.fullName)}</td>
      <td class="muted">${escapeHtml(u.email)}</td>
      <td><span class="chip ${u.role === 'ADMIN' ? 'chip-gold' : ''}">${u.role}</span></td>
      <td><span class="chip ${u.status === 'ACTIVE' ? 'chip-ok' : 'chip-bad'}">${u.status}</span></td>
      <td>
        ${u.role === 'ADMIN' ? '' : u.status === 'ACTIVE'
          ? `<button class="btn btn-ghost btn-sm" data-lock="${u.userId}">Lock</button>`
          : `<button class="btn btn-ghost btn-sm" data-unlock="${u.userId}">Unlock</button>`}
      </td>
    </tr>`).join('');

  render(app, `
  <div class="page">
    <div class="page-head">
      <h2>Admin Dashboard</h2>
      <div class="case-actions">
        <button class="btn btn-primary" id="seed-sample">Seed + publish sample case</button>
        <button class="btn btn-ghost" id="seed-demo">Seed demo cases</button>
        <a class="btn btn-ghost" href="#/admin/cases">Manage cases</a>
        <a class="btn btn-ghost" href="#/admin/ai">AI case creator</a>
      </div>
    </div>
    <div class="stat-grid">${statCards}</div>
    <h3 class="section-title">Users</h3>
    <table class="admin-table">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
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
}
