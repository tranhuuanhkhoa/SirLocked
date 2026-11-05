import { escapeHtml } from '../../../utils/dom.js';
import { dateTime, pagedList, tableHtml } from './shared.js';

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

/** Before and after, row by row. What changed is marked, so it stays findable without relying on colour alone. */
export function diffHtml(before, after) {
  const left = flatten(before);
  const right = flatten(after);
  const paths = [...new Set([...left.keys(), ...right.keys()])].sort();
  if (paths.length === 0) return '<p class="muted small">Thao tác này không lưu dữ liệu trước và sau.</p>';
  return `
    <div class="adp-table-wrap" data-adp-diff>
      <table class="admin-table adp-diff">
        <thead><tr><th scope="col">Trường</th><th scope="col">Trước</th><th scope="col">Sau</th></tr></thead>
        <tbody>
          ${paths.map((path) => {
    const changed = left.get(path) !== right.get(path);
    return `<tr${changed ? ' class="is-changed"' : ''}>
            <th scope="row" class="adp-break">${changed ? '<span aria-label="Đã đổi">● </span>' : ''}${escapeHtml(path)}</th>
            <td class="adp-break">${show(left.get(path))}</td>
            <td class="adp-break">${show(right.get(path))}</td>
          </tr>`;
  }).join('')}
        </tbody>
      </table>
    </div>`;
}

const columns = [
  { label: 'Lúc', cell: (entry) => escapeHtml(dateTime(entry.at)) },
  { label: 'Admin', cell: (entry) => escapeHtml(entry.adminName) },
  { label: 'Thao tác', cell: (entry) => `<code class="adp-code">${escapeHtml(entry.action)}</code>` },
  { label: 'Đối tượng', cell: (entry) => `<span class="adp-break">${escapeHtml(entry.targetType)}: ${escapeHtml(entry.targetId)}</span>` },
  { label: 'Lý do', cell: (entry) => escapeHtml(entry.reason ?? '—') },
  {
    label: 'Chi tiết',
    className: 'adp-actions',
    cell: () => '<button class="btn btn-ghost btn-sm" type="button" data-act="detail" aria-expanded="false">Xem chi tiết</button>',
  },
];

/** A paged log in `host`. Each row opens its own before/after comparison. */
export function auditTable(host, { load, signal, empty, startPage, onPage }) {
  return pagedList(host, {
    signal,
    empty,
    startPage,
    onPage,
    load,
    draw: (items) => tableHtml(columns, items),
    actions: {
      detail: (entry, button) => {
        const row = button.closest('tr');
        const open = row.nextElementSibling?.classList.contains('adp-detail-row');
        if (open) {
          row.nextElementSibling.remove();
          button.setAttribute('aria-expanded', 'false');
          button.textContent = 'Xem chi tiết';
          return;
        }
        row.insertAdjacentHTML('afterend', `<tr class="adp-detail-row"><td colspan="${columns.length}">${diffHtml(entry.before, entry.after)}</td></tr>`);
        button.setAttribute('aria-expanded', 'true');
        button.textContent = 'Ẩn chi tiết';
      },
    },
  });
}
