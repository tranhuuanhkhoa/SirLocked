import { adminAuditApi } from '../api/adminAuditApi.js';
import { adminPlayersApi } from '../api/adminPlayersApi.js';
import { escapeHtml, render } from '../utils/dom.js';
import { auditTable } from './admin/players/auditTable.js';
import { hashParams, pageParam, writeHashParams } from './admin/players/shared.js';

const TARGET_TYPES = [
  ['', 'Mọi đối tượng'], ['user', 'Người chơi'], ['listing', 'Tin rao'], ['order', 'Lệnh mua'], ['room', 'Phòng'], ['review', 'Đánh giá'], ['economy', 'Kinh tế'],
  ['catalogItem', 'Vật phẩm'], ['chest', 'Hòm'], ['levelReward', 'Thưởng theo cấp'], ['achievement', 'Thành tích'], ['gameSettings', 'Cài đặt game'], ['asset', 'Ảnh tải lên'],
];
const KNOWN_ACTIONS = [
  'player.coins', 'player.grant', 'player.revoke', 'player.progress', 'player.avatar.remove', 'player.avatar.approve', 'player.logout', 'player.lock', 'player.unlock', 'player.role',
  'listing.remove', 'order.cancel', 'economy.recover', 'room.close', 'review.hide', 'review.unhide', 'review.delete', 'asset.upload',
];

// The log stores UTC; these dates are days on the players' calendar (UTC+7), like every other "day" in the economy pages.
const dayStart = (day) => (day ? new Date(`${day}T00:00:00.000+07:00`).toISOString() : '');
const dayEnd = (day) => (day ? new Date(`${day}T23:59:59.999+07:00`).toISOString() : '');

/** #/admin/audit: everything admins did, filtered on the server, each entry with its before and after. */
export async function renderAdminAuditPage(app, { signal } = {}) {
  const params = hashParams();
  const filters = {
    adminId: params.get('adminId') ?? '',
    action: params.get('action') ?? '',
    targetType: params.get('targetType') ?? '',
    targetId: params.get('targetId') ?? '',
    fromDay: params.get('from') ?? '',
    toDay: params.get('to') ?? '',
  };

  render(app, `
    <div class="page adp-page">
      <div class="page-head"><h2>Nhật ký admin</h2></div>
      <form class="adp-filters" data-adp-audit-filter>
        <div class="adp-filter">
          <label class="field-label" for="adp-a-admin">Mã admin</label>
          <input class="field-input" id="adp-a-admin" name="adminId" list="adp-a-admins" value="${escapeHtml(filters.adminId)}">
          <datalist id="adp-a-admins"></datalist>
        </div>
        <div class="adp-filter">
          <label class="field-label" for="adp-a-action">Thao tác</label>
          <input class="field-input" id="adp-a-action" name="action" list="adp-a-actions" value="${escapeHtml(filters.action)}">
          <datalist id="adp-a-actions">${KNOWN_ACTIONS.map((action) => `<option value="${action}"></option>`).join('')}</datalist>
        </div>
        <div class="adp-filter">
          <label class="field-label" for="adp-a-type">Loại đối tượng</label>
          <select class="field-input" id="adp-a-type" name="targetType">
            ${TARGET_TYPES.map(([value, label]) => `<option value="${value}"${value === filters.targetType ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </select>
        </div>
        <div class="adp-filter">
          <label class="field-label" for="adp-a-target">Mã đối tượng</label>
          <input class="field-input" id="adp-a-target" name="targetId" value="${escapeHtml(filters.targetId)}">
        </div>
        <div class="adp-filter">
          <label class="field-label" for="adp-a-from">Từ ngày</label>
          <input class="field-input" id="adp-a-from" name="fromDay" type="date" value="${escapeHtml(filters.fromDay)}">
        </div>
        <div class="adp-filter">
          <label class="field-label" for="adp-a-to">Đến ngày</label>
          <input class="field-input" id="adp-a-to" name="toDay" type="date" value="${escapeHtml(filters.toDay)}">
        </div>
        <button class="btn btn-primary adp-filter-go" type="submit">Lọc</button>
      </form>
      <div data-adp-audit aria-live="polite"></div>
    </div>`);

  const log = auditTable(app.querySelector('[data-adp-audit]'), {
    signal,
    startPage: pageParam(),
    empty: 'Không có thao tác nào khớp bộ lọc này.',
    onPage: (page) => writeHashParams({ page }),
    load: (page) => adminAuditApi.list({
      adminId: filters.adminId,
      action: filters.action,
      targetType: filters.targetType,
      targetId: filters.targetId,
      from: dayStart(filters.fromDay),
      to: dayEnd(filters.toDay),
      page,
    }),
  });

  app.querySelector('[data-adp-audit-filter]').addEventListener('submit', (event) => {
    event.preventDefault();
    const values = new FormData(event.target);
    for (const key of Object.keys(filters)) filters[key] = String(values.get(key) ?? '').trim();
    writeHashParams({
      adminId: filters.adminId, action: filters.action, targetType: filters.targetType, targetId: filters.targetId, from: filters.fromDay, to: filters.toDay, page: 1,
    });
    log.refresh(1);
  }, signal ? { signal } : undefined);

  log.refresh();

  // Offering the admins by name is a convenience: the filter works without it.
  adminPlayersApi.list({ role: 'ADMIN', pageSize: 100 }).then((data) => {
    const list = app.querySelector('#adp-a-admins');
    if (list) list.innerHTML = (data?.items ?? []).map((admin) => `<option value="${escapeHtml(admin.userId)}">${escapeHtml(admin.fullName)}</option>`).join('');
  }).catch(() => {});
}
