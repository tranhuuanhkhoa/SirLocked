import { adminPlayersApi } from '../../../api/adminPlayersApi.js';
import { escapeHtml } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { actionDialog, coins, dateTime, hashParams, num, pageParam, pagedList, playerLink, roleChip, statusChip, tableHtml, writeHashParams } from './shared.js';

const ROLES = [['', 'Mọi vai trò'], ['PLAYER', 'Người chơi'], ['VIP', 'VIP'], ['ADMIN', 'Quản trị']];
const STATUSES = [['', 'Mọi trạng thái'], ['ACTIVE', 'Đang hoạt động'], ['LOCKED', 'Bị khóa'], ['UNVERIFIED', 'Chưa xác minh email']];
const SORTS = [['created', 'Ngày tạo'], ['level', 'Cấp'], ['coins', 'Số xu']];

const options = (list, value) => list.map(([id, label]) => `<option value="${id}"${id === value ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');

/** The list: every filter and every page is a question for the server, and the address remembers them. */
export function mountPlayerList(host, { signal }) {
  const params = hashParams();
  const filters = {
    q: params.get('q') ?? '',
    role: params.get('role') ?? '',
    status: params.get('status') ?? '',
    sort: params.get('sort') ?? 'created',
    asc: params.get('asc') === 'true',
  };

  host.innerHTML = `
    <form class="adp-filters" data-adp-player-filter role="search">
      <div class="adp-filter adp-filter--wide">
        <label class="field-label" for="adp-q">Tìm theo tên hoặc email</label>
        <input class="field-input" id="adp-q" type="search" aria-label="Tìm người chơi" value="${escapeHtml(filters.q)}" maxlength="100">
      </div>
      <div class="adp-filter">
        <label class="field-label" for="adp-role">Vai trò</label>
        <select class="field-input" id="adp-role">${options(ROLES, filters.role)}</select>
      </div>
      <div class="adp-filter">
        <label class="field-label" for="adp-status">Trạng thái</label>
        <select class="field-input" id="adp-status">${options(STATUSES, filters.status)}</select>
      </div>
      <div class="adp-filter">
        <label class="field-label" for="adp-sort">Sắp xếp</label>
        <select class="field-input" id="adp-sort">${options(SORTS, filters.sort)}</select>
      </div>
      <div class="adp-filter">
        <label class="field-label" for="adp-order">Chiều</label>
        <select class="field-input" id="adp-order">${options([['desc', 'Giảm dần'], ['asc', 'Tăng dần']], filters.asc ? 'asc' : 'desc')}</select>
      </div>
      <button class="btn btn-primary adp-filter-go" type="submit">Tìm</button>
    </form>
    <div data-adp-player-rows aria-live="polite"></div>`;

  const rows = host.querySelector('[data-adp-player-rows]');

  const columns = [
    { label: 'Người chơi', cell: (player) => `${playerLink(player.userId, player.fullName)}<br><span class="muted small adp-break">${escapeHtml(player.email)}</span>` },
    { label: 'Vai trò', cell: (player) => roleChip(player.role) },
    { label: 'Trạng thái', cell: (player) => `${statusChip(player.status)}${player.isEmailVerified ? '' : ' <span class="chip">Chưa xác minh</span>'}` },
    { label: 'Cấp', cell: (player) => num(player.level) },
    { label: 'Số xu', cell: (player) => coins(player.balance) },
    { label: 'Ngày tạo', cell: (player) => escapeHtml(dateTime(player.createdAt)) },
    {
      label: 'Thao tác',
      className: 'adp-actions',
      cell: (player) => {
        if (player.role === 'ADMIN') return '<span class="muted small">Không áp dụng</span>';
        const name = escapeHtml(player.fullName);
        return `
          <button class="btn btn-ghost btn-sm" type="button" data-act="role" aria-label="${player.role === 'VIP' ? 'Đổi thành người chơi' : 'Nâng lên VIP'}: ${name}">${player.role === 'VIP' ? 'Về người chơi' : 'Lên VIP'}</button>
          ${player.status === 'ACTIVE'
    ? `<button class="btn btn-ghost btn-sm" type="button" data-act="lock" aria-label="Khóa ${name}">Khóa</button>`
    : `<button class="btn btn-ghost btn-sm" type="button" data-act="unlock" aria-label="Mở khóa ${name}">Mở khóa</button>`}`;
      },
    },
  ];

  const change = async (player, dialog, call, done) => {
    const answer = await actionDialog({ signal, danger: true, ...dialog, submit: ({ reason }) => call(reason.trim()) });
    if (answer === null) return;
    toast(done, 'success');
    list.refresh();
  };

  const list = pagedList(rows, {
    signal,
    startPage: pageParam(),
    empty: 'Không có người chơi nào khớp bộ lọc này.',
    load: (page) => adminPlayersApi.list({ ...filters, asc: filters.asc ? 'true' : '', sort: filters.sort === 'created' ? '' : filters.sort, page }),
    draw: (items) => tableHtml(columns, items),
    onPage: (page) => writeHashParams({ page }),
    actions: {
      lock: (player) => change(player,
        { title: `Khóa ${player.fullName}`, message: 'Người chơi bị đăng xuất ngay và không vào được game cho tới khi mở khóa.', confirmLabel: 'Khóa tài khoản' },
        (reason) => adminPlayersApi.lock(player.userId, reason), 'Đã khóa tài khoản.'),
      unlock: (player) => change(player,
        { title: `Mở khóa ${player.fullName}`, message: 'Người chơi đăng nhập lại được.', confirmLabel: 'Mở khóa', danger: false },
        (reason) => adminPlayersApi.unlock(player.userId, reason), 'Đã mở khóa tài khoản.'),
      role: (player) => {
        const next = player.role === 'VIP' ? 'PLAYER' : 'VIP';
        return change(player,
          { title: `Đổi vai trò của ${player.fullName}`, message: next === 'VIP' ? 'VIP được dùng công cụ tạo vụ án AI. Người chơi cần đăng nhập lại.' : 'Người chơi mất quyền tạo vụ án AI và cần đăng nhập lại.', confirmLabel: 'Đổi vai trò' },
          (reason) => adminPlayersApi.setRole(player.userId, next, reason), 'Đã đổi vai trò.');
      },
    },
  });

  const apply = () => {
    writeHashParams({ q: filters.q, role: filters.role, status: filters.status, sort: filters.sort === 'created' ? '' : filters.sort, asc: filters.asc ? 'true' : '', page: 1 });
    list.refresh(1);
  };
  const bind = (id, read) => host.querySelector(id).addEventListener('change', (event) => {
    read(event.target.value);
    apply();
  }, { signal });
  bind('#adp-role', (value) => { filters.role = value; });
  bind('#adp-status', (value) => { filters.status = value; });
  bind('#adp-sort', (value) => { filters.sort = value; });
  bind('#adp-order', (value) => { filters.asc = value === 'asc'; });
  host.querySelector('[data-adp-player-filter]').addEventListener('submit', (event) => {
    event.preventDefault();
    filters.q = host.querySelector('#adp-q').value.trim();
    apply();
  }, { signal });

  list.refresh();
}
