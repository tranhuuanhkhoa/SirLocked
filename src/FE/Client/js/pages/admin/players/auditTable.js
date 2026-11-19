import { icon, pill } from '../../../components/admin/ui.js';
import { escapeHtml } from '../../../utils/dom.js';
import { dateTime, pagedList } from './shared.js';

/** Every leaf of a JSON value as dotted path → value, so two versions can be laid side by side. */
export function flatten(value, prefix = '', into = new Map()) {
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((entry, index) => [String(index), entry]) : Object.entries(value);
    if (entries.length === 0) into.set(prefix, Array.isArray(value) ? '[]' : '{}');
    for (const [key, entry] of entries) flatten(entry, prefix ? `${prefix}.${key}` : key, into);
  } else if (prefix) {
    into.set(prefix, value);
  }
  return into;
}

const show = (value) => (value === undefined ? '—' : escapeHtml(value === null ? 'null' : String(value)));

/** Before and after, row by row. What changed is marked in words as well as colour. */
export function diffHtml(before, after) {
  const left = flatten(before);
  const right = flatten(after);
  const paths = [...new Set([...left.keys(), ...right.keys()])].sort();
  if (paths.length === 0) return '<p class="adp-muted adp-diff-none">Thao tác này không lưu dữ liệu trước và sau.</p>';
  return `
    <div class="adp-diff-wrap" data-adp-diff>
      <table class="adp-diff">
        <thead><tr><th scope="col">Trường</th><th scope="col">Trước</th><th scope="col">Sau</th></tr></thead>
        <tbody>
          ${paths.map((path) => {
    const changed = left.get(path) !== right.get(path);
    return `<tr${changed ? ' class="is-changed"' : ''}>
            <th scope="row">${changed ? '<span class="bpa-sr">Đã đổi: </span>' : ''}${escapeHtml(path)}</th>
            <td><span class="adp-diff-val">${show(left.get(path))}</span></td>
            <td><span class="adp-diff-val">${show(right.get(path))}</span></td>
          </tr>`;
  }).join('')}
        </tbody>
      </table>
    </div>`;
}

/** What each kind of target is called, for the filter and the label on each entry. */
export const TARGET_TYPES = [
  ['', 'Mọi đối tượng'], ['user', 'Người chơi'], ['listing', 'Tin rao'], ['order', 'Lệnh mua'], ['room', 'Phòng'], ['review', 'Đánh giá'], ['economy', 'Kinh tế'],
  ['catalogItem', 'Vật phẩm'], ['chest', 'Hòm'], ['levelReward', 'Thưởng theo cấp'], ['achievement', 'Thành tích'], ['gameSettings', 'Cài đặt game'], ['asset', 'Ảnh tải lên'],
];
const TARGET_LABEL = Object.fromEntries(TARGET_TYPES.filter(([value]) => value));

/** Each action written to the log: [what to call it, icon, colour]. An action not listed shows its code. */
const ACTIONS = {
  'player.coins': ['Cộng / trừ xu', 'coin', 'gold'],
  'player.grant': ['Cấp vật phẩm', 'gem', 'blue'],
  'player.revoke': ['Thu hồi vật phẩm', 'gem', 'bad'],
  'player.progress': ['Đặt cấp / KN', 'trophy', 'gold'],
  'player.avatar.remove': ['Xóa ảnh đại diện', 'user', 'bad'],
  'player.avatar.approve': ['Duyệt ảnh đại diện', 'check', 'ok'],
  'player.logout': ['Ép đăng xuất', 'logout', 'bad'],
  'player.lock': ['Khóa tài khoản', 'user', 'bad'],
  'player.unlock': ['Mở khóa tài khoản', 'user', 'ok'],
  'player.role': ['Đổi vai trò', 'user', 'violet'],
  'listing.remove': ['Gỡ tin rao', 'coins', 'bad'],
  'order.cancel': ['Hủy lệnh mua', 'coins', 'bad'],
  'economy.recover': ['Chạy khôi phục giao dịch', 'refresh', 'gold'],
  'room.close': ['Đóng phòng', 'users', 'bad'],
  'review.hide': ['Ẩn đánh giá', 'star', 'bad'],
  'review.unhide': ['Hiện lại đánh giá', 'star', 'ok'],
  'review.delete': ['Xóa đánh giá', 'star', 'bad'],
  'asset.upload': ['Tải ảnh lên', 'folder', ''],
  'item.create': ['Tạo vật phẩm', 'gem', 'blue'],
  'item.update': ['Sửa vật phẩm', 'gem', 'blue'],
  'item.acquisition': ['Đổi cách nhận vật phẩm', 'gem', 'blue'],
  'item.retire': ['Ngừng phát hành', 'gem', 'blue'],
  'item.unretire': ['Phát hành lại', 'gem', 'blue'],
  'item.delete': ['Xóa vật phẩm', 'gem', 'bad'],
  'chest.update': ['Sửa hòm', 'chest', 'violet'],
  'chest.restore': ['Khôi phục phiên bản hòm', 'chest', 'violet'],
  'chest.clone': ['Nhân bản hòm', 'chest', 'violet'],
  'chest.grant': ['Cấp hòm và chìa', 'chest', 'violet'],
  'gameSettings.update': ['Sửa cài đặt game', 'grid', ''],
};

function entryHtml(entry, index) {
  const [title, iconName, tone] = ACTIONS[entry.action] ?? [entry.action, 'clock', ''];
  const known = Boolean(ACTIONS[entry.action]);
  const reason = entry.reason ? `Lý do: “${escapeHtml(entry.reason)}”` : 'Không ghi lý do';
  return `
    <tr data-adp-entry data-row="${index}">
      <td>
        <div class="adp-entry">
          <span class="adp-entry-icon${tone ? ` adp-tone--${tone}` : ''}">${icon(iconName, 20)}</span>
          <div class="adp-entry-text">
            <span class="adp-entry-title">
              <strong>${escapeHtml(title)}</strong>
              ${pill(TARGET_LABEL[entry.targetType] ?? entry.targetType ?? '—', '', { small: true })}
              <code class="adp-entry-target">${escapeHtml(entry.targetId ?? '')}</code>
            </span>
            <span class="adp-entry-meta">
              <span>${escapeHtml(dateTime(entry.at))}</span> · <span>${escapeHtml(entry.adminName ?? entry.adminId ?? '—')}</span>${known ? ` · <code class="adp-entry-code">${escapeHtml(entry.action)}</code>` : ''} · <span class="adp-entry-reason">${reason}</span>
            </span>
          </div>
          <button class="btn btn-ghost btn-sm adp-entry-toggle" type="button" data-act="detail" aria-expanded="false">Xem chi tiết</button>
        </div>
      </td>
    </tr>`;
}

/**
 * A paged log in `host`: one card per action with its before/after on demand. The entries are rows of a one-column table,
 * so every list of the log (this page, a player's tab, the specs) finds them the same way.
 */
export function auditTable(host, { load, signal, empty, emptyNote = '', startPage, onPage, sizes, startSize, onSize }) {
  return pagedList(host, {
    signal,
    empty,
    emptyNote,
    noun: 'thao tác',
    startPage,
    onPage,
    sizes,
    startSize,
    onSize,
    load,
    draw: (items) => `
      <table class="adp-log" aria-label="Thao tác đã ghi">
        <tbody>${items.map(entryHtml).join('')}</tbody>
      </table>`,
    actions: {
      detail: (entry, button) => {
        const cell = button.closest('td');
        const open = cell.querySelector('.adp-entry-diff');
        if (open) {
          open.remove();
          button.setAttribute('aria-expanded', 'false');
          button.textContent = 'Xem chi tiết';
          return;
        }
        cell.insertAdjacentHTML('beforeend', `<div class="adp-entry-diff">${diffHtml(entry.before, entry.after)}</div>`);
        button.setAttribute('aria-expanded', 'true');
        button.textContent = 'Ẩn chi tiết';
      },
    },
  });
}
