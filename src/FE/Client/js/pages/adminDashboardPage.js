import { adminApi } from '../api/adminApi.js';
import { adminPlayersApi } from '../api/adminPlayersApi.js';
import { shareAdminCounts } from '../components/admin/shell.js';
import { icon, kpiCard, pageHead, person, pill, stateBox, tile, todayEyebrow } from '../components/admin/ui.js';
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

const number = (value) => Number(value ?? 0).toLocaleString('vi-VN');

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
  ].map(([label, value]) => tile({ label, value })).join('');

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
    <section class="adm-card" aria-labelledby="adp-playtest-title">
      <div>
        <h2 class="adm-card-title" id="adp-playtest-title">${tr('Playtest telemetry', 'Đo đạc phiên chơi thử')}</h2>
        <p class="adm-card-sub">${tr(
    'Hashed per-room signals from V3 sessions only; no room, player, or case identifiers are stored.',
    'Tín hiệu đã băm theo từng phòng, chỉ từ các ván V3; không lưu định danh phòng, người chơi hay vụ án.',
  )}</p>
      </div>
      ${truncated}
      <div class="adm-grid adm-grid--tiles">${cards}</div>
    </section>`;
}

/** Today's counters, each one a link to where it can be acted on. */
function todayCards(counts) {
  if (!counts) return '';
  return `
    <section class="adm-stack adm-stack--tight" aria-labelledby="adp-today-title">
      <h2 class="adm-section-label" id="adp-today-title">${tr('Today', 'Hôm nay')}</h2>
      <div class="adm-grid">
        ${kpiCard({ label: tr('New players', 'Người chơi mới'), value: number(counts.newPlayersToday), href: '/admin/players', linkLabel: tr('See players', 'Xem người chơi'), iconName: 'userPlus', tone: 'ok' })}
        ${kpiCard({ label: tr('Games played', 'Trận đã chơi'), value: number(counts.gamesToday), href: '/admin/economy?tab=phong', linkLabel: tr('See rooms', 'Xem phòng'), iconName: 'magnifier' })}
        ${kpiCard({ label: tr('Chests opened', 'Lượt mở hòm'), value: number(counts.chestOpensToday), href: '/admin/economy', linkLabel: tr('See the economy', 'Xem kinh tế'), iconName: 'chest', tone: 'violet' })}
      </div>
    </section>`;
}

function systemCard(stats, counts) {
  const published = Number(stats.publishedCases) || 0;
  const total = Number(stats.totalCases) || 0;
  const tiles = [
    tile({ label: tr('Users', 'Người dùng'), value: number(stats.totalUsers), note: tr('accounts', 'tài khoản') }),
    tile({ label: tr('Cases', 'Vụ án'), value: number(published), of: number(total), meter: total ? (published / total) * 100 : 0, note: tr('published', 'đã xuất bản') }),
    tile({ label: tr('Rooms', 'Phòng'), value: number(stats.activeRooms), of: number(stats.totalRooms), note: tr('active', 'đang hoạt động') }),
    tile({
      label: tr('Games finished', 'Ván đã kết thúc'),
      value: number((Number(stats.wins) || 0) + (Number(stats.losses) || 0)),
      note: `${number(stats.wins)} ${tr('won', 'thắng')} · ${number(stats.losses)} ${tr('failed', 'thua')}`,
    }),
  ];
  const coins = counts
    ? `<a class="adm-tile adm-tile--link" href="/admin/economy" style="text-decoration:none">
         <span class="adm-tile-label">${tr('Coins in circulation', 'Xu lưu hành')}</span>
         <span class="adm-tile-value adm-tile-value--gold">${escapeHtml(number(counts.coinsInCirculation))}</span>
         <span class="adm-tile-note">${tr('coins in player wallets', 'xu trong ví người chơi')}</span>
       </a>`
    : '';
  return `
    <section class="adm-card adp-system" aria-labelledby="adp-system-title" style="flex: 2 1 520px">
      <h2 class="adm-card-title" id="adp-system-title">${tr('Whole system', 'Toàn hệ thống')}</h2>
      <div class="adm-grid adm-grid--tiles" data-adp-system>${tiles.join('')}${coins}</div>
    </section>`;
}

function todoCard(stats, counts) {
  const rows = [];
  if (counts) {
    rows.push(['Giao dịch kẹt', tr('Economy & market', 'Kinh tế & chợ'), counts.stuckOperations, '/admin/economy?tab=ket', true]);
    rows.push(['Ảnh chờ duyệt', tr('Pictures players uploaded', 'Ảnh người chơi tải lên'), counts.pendingAvatars, '/admin/players?tab=anh', true]);
  }
  rows.push([tr('AI drafts', 'Bản nháp AI'), tr('All drafts created so far', 'Tổng số bản nháp đã tạo'), stats.totalAiDrafts, '/admin/ai', false]);
  const waiting = rows.filter(([, , value, , urgent]) => urgent && Number(value) > 0).length;
  const summary = !counts
    ? ''
    : waiting === 0
      ? `<span class="adm-ok-line">${icon('check', 16)}${tr('Nothing waiting', 'Không có việc tồn đọng')}</span>`
      : `<span class="adm-ok-line" style="color: var(--adm-bad)">${tr(`${waiting} item(s) need you`, `${waiting} mục cần bạn xử lý`)}</span>`;
  return `
    <section class="adm-card" aria-labelledby="adp-todo-title" style="flex: 1 1 300px">
      <div>
        <h2 class="adm-card-title" id="adp-todo-title">${tr('To do', 'Cần xử lý')}</h2>
        ${summary}
      </div>
      ${rows.map(([label, note, value, href, urgent]) => `
        <a class="adm-todo" href="${href}">
          <span class="adm-todo-text"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(note)}</small></span>
          <span class="adm-count${urgent && Number(value) > 0 ? ' adm-count--alert' : ''}">${escapeHtml(number(value))}</span>
        </a>`).join('')}
    </section>`;
}

// Functions, not constants: the language switch re-renders the page without reloading the module.
const rolePill = (role) => ({ ADMIN: ['Admin', 'gold'], VIP: ['VIP', 'violet'], PLAYER: [tr('Player', 'Người chơi'), ''] })[role];
const statusPill = (status) => ({ ACTIVE: [tr('Active', 'Hoạt động'), 'ok'], LOCKED: [tr('Locked', 'Đã khóa'), 'bad'], DELETED: [tr('Deleted', 'Đã xóa'), ''] })[status];
const filters = () => [
  ['all', tr('All', 'Tất cả'), () => true],
  ['ADMIN', 'Admin', (u) => u.role === 'ADMIN'],
  ['VIP', 'VIP', (u) => u.role === 'VIP'],
  ['PLAYER', tr('Players', 'Người chơi'), (u) => u.role === 'PLAYER'],
  ['LOCKED', tr('Locked', 'Đã khóa'), (u) => u.status === 'LOCKED'],
];

function userRow(u) {
  const [roleLabel, roleTone] = rolePill(u.role) ?? [u.role, ''];
  const [statusLabel, statusTone] = statusPill(u.status) ?? [u.status, ''];
  const actions = u.role === 'ADMIN'
    ? `<span class="muted small">${tr('Admin account', 'Tài khoản quản trị')}</span>`
    : `
      ${u.role === 'VIP'
    ? `<button class="btn btn-ghost btn-sm" data-role-user="${u.userId}" data-role="PLAYER">${tr('Make player', 'Đổi thành người chơi')}</button>`
    : `<button class="btn btn-ghost btn-sm" data-role-user="${u.userId}" data-role="VIP">${tr('Make VIP', 'Nâng lên VIP')}</button>`}
      ${u.status === 'ACTIVE'
    ? `<button class="btn btn-ghost btn-sm adm-btn-danger" data-lock="${u.userId}">${tr('Lock', 'Khóa')}</button>`
    : `<button class="btn btn-ghost btn-sm adm-btn-ok" data-unlock="${u.userId}">${tr('Unlock', 'Mở khóa')}</button>`}`;
  return `
    <tr>
      <td>${person(u.fullName || u.email, u.email)}</td>
      <td>${pill(roleLabel, roleTone)}</td>
      <td>${pill(statusLabel, statusTone, { dot: true })}</td>
      <td><div class="adm-table-actions">${actions}</div></td>
    </tr>`;
}

function usersCard(users) {
  return `
    <section class="adm-card adm-card--flush" aria-labelledby="adp-users-title">
      <div class="adm-card-head">
        <div style="flex: 1 1 260px">
          <h2 class="adm-card-title" id="adp-users-title">${tr('Users', 'Người dùng')}</h2>
          <p class="adm-card-sub">${tr('Every account · full tools on the Players page', 'Mọi tài khoản · quản lý đầy đủ ở trang Người chơi')}</p>
        </div>
        <label class="adm-search-box" style="flex: 0 1 320px; background: var(--adm-paper-2)">
          ${icon('search', 18)}
          <span class="bpa-sr">${tr('Find a user', 'Tìm người dùng')}</span>
          <input type="search" data-adp-user-search placeholder="${tr('Search by name or email', 'Tìm theo tên hoặc email')}">
        </label>
      </div>
      <div class="adm-filters" role="group" aria-label="${tr('Filter by role', 'Lọc theo vai trò')}" style="padding: 0 22px 16px">
        ${filters().map(([key, label, match], index) => `
          <button type="button" class="adm-filter" data-adp-filter="${key}" aria-pressed="${index === 0}">${escapeHtml(label)}<small>${users.filter(match).length}</small></button>`).join('')}
      </div>
      <div class="adm-table-wrap">
        <table class="adm-table admin-table" style="min-width: 760px">
          <thead><tr><th>${tr('User', 'Người dùng')}</th><th>${tr('Role', 'Vai trò')}</th><th>${tr('Status', 'Trạng thái')}</th><th style="text-align:right">${tr('Actions', 'Thao tác')}</th></tr></thead>
          <tbody data-adp-users></tbody>
        </table>
      </div>
      <div data-adp-users-empty hidden style="padding: 0 22px 22px">${stateBox('empty', tr('No matching user', 'Không tìm thấy người dùng phù hợp'), tr('Try another word or clear the role filter.', 'Thử từ khóa khác hoặc bỏ bộ lọc vai trò.'))}</div>
      <div class="adm-pager">
        <span data-adp-users-shown></span>
        <a href="/admin/players" class="adm-kpi-link">${tr('Manage players', 'Quản lý người chơi')}${icon('arrowRight', 16)}</a>
      </div>
    </section>`;
}

export async function renderAdminDashboardPage(app) {
  render(app, `<div class="page">${stateBox('loading', tr('Loading dashboard…', 'Đang tải bảng điều khiển…'))}</div>`);

  let stats;
  let users;
  try {
    [stats, users] = await Promise.all([adminApi.dashboard(), adminApi.users()]);
  } catch (err) {
    render(app, `<div class="page">${stateBox('error', tr('The dashboard could not load', 'Không tải được bảng điều khiển'), err.message)}</div>`);
    return;
  }
  stats = stats || {};
  users = users || [];
  shareAdminCounts(stats);

  // Telemetry is opt-in; a 404/403 means the gate is closed, so the card is simply absent.
  let playtest = null;
  try {
    playtest = await adminApi.playtestSummary();
  } catch {
    playtest = null;
  }

  // The live counters are extras: if they cannot load, the rest of the dashboard still can.
  let counts = null;
  try {
    counts = await adminPlayersApi.dashboardCounts();
  } catch {
    counts = null;
  }

  const actions = `
    ${stats.legacyCasesHidden ? '' : `
    <button class="btn btn-ghost" id="seed-sample">${tr('Seed + publish sample case', 'Tạo và xuất bản vụ án mẫu')}</button>
    <button class="btn btn-ghost" id="seed-demo">${tr('Seed demo cases', 'Tạo các vụ án demo')}</button>
    <button class="btn btn-ghost" id="seed-crack-demo">${tr('Seed Crack cases', 'Tạo các vụ án Crack')}</button>`}
    <button class="btn btn-ghost" id="seed-pixel-demo">${icon('refresh', 18)}${tr('Create / refresh pixel cases', 'Tạo/cập nhật vụ án pixel')}</button>
    <a class="btn btn-ghost" href="/admin/cases">${tr('Manage cases', 'Quản lý vụ án')}</a>
    <a class="btn btn-primary" href="/admin/ai">${icon('sparkle', 18)}${tr('AI case creator', 'Tạo vụ án AI')}</a>`;

  render(app, `
  <div class="page">
    ${pageHead({
    eyebrow: todayEyebrow(),
    title: tr('Overview', 'Tổng quan'),
    sub: tr('How Sir Locked is doing today, and what needs you.', 'Tình hình Sir Locked hôm nay và những việc cần bạn xử lý.'),
    actionsHtml: actions,
  })}
    <div class="adm-stack"${counts ? ' data-adp-cards' : ''}>
      ${todayCards(counts)}
      <div class="adm-row">
        ${systemCard(stats, counts)}
        ${todoCard(stats, counts)}
      </div>
    </div>
    <div class="adm-stack" style="margin-top: 32px">
      ${playtestSection(playtest)}
      ${usersCard(users)}
    </div>
  </div>`);
  wireUsers(app, users);

  app.querySelector('#seed-sample')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      const seeded = await adminApi.seedSample();
      toast(`"${seeded.title}" seeded and published.`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    button.disabled = false;
  });

  app.querySelector('#seed-demo')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      const seeded = await adminApi.seedDemo();
      toast(`${seeded.length} demo case(s) seeded and published.`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    button.disabled = false;
  });

  app.querySelector('#seed-crack-demo')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      const seeded = await adminApi.seedCrackDemo();
      toast(`${seeded.length} Crack case(s) seeded and published.`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    button.disabled = false;
  });

  app.querySelector('#seed-pixel-demo').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      const seeded = await adminApi.seedPixelDemo();
      toast(tr(`${seeded.length} pixel case(s) created or refreshed and published.`, `Đã tạo/cập nhật và xuất bản ${seeded.length} vụ án pixel.`), 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    button.disabled = false;
  });
}

/** The users table: a search box and role filters on top of the list the API returned; actions reload the page. */
function wireUsers(app, users) {
  const body = app.querySelector('[data-adp-users]');
  const empty = app.querySelector('[data-adp-users-empty]');
  const shown = app.querySelector('[data-adp-users-shown]');
  const search = app.querySelector('[data-adp-user-search]');
  let filter = 'all';

  const draw = () => {
    const match = filters().find(([key]) => key === filter)?.[2] ?? (() => true);
    const q = search.value.trim().toLowerCase();
    const list = users.filter((u) => match(u)
      && (!q || String(u.fullName || '').toLowerCase().includes(q) || String(u.email || '').toLowerCase().includes(q)));
    render(body, list.map(userRow).join(''));
    empty.hidden = list.length > 0;
    shown.textContent = tr(`Showing ${list.length} of ${users.length} accounts`, `Hiển thị ${list.length} / ${users.length} tài khoản`);
    bindActions();
  };

  const bindActions = () => {
    const rebind = (selector, action) =>
      body.querySelectorAll(selector).forEach((btn) =>
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
    body.querySelectorAll('[data-role-user]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await adminApi.setUserRole(btn.dataset.roleUser, btn.dataset.role);
          renderAdminDashboardPage(app);
        } catch (err) {
          toast(err.message, 'error');
        }
      }));
  };

  app.querySelectorAll('[data-adp-filter]').forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.adpFilter;
    app.querySelectorAll('[data-adp-filter]').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
    draw();
  }));
  search.addEventListener('input', draw);
  draw();
}
