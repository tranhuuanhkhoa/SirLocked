import { adminChestsApi } from '../api/adminChestsApi.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { openItemForm } from './admin/chests/itemForm.js';
import {
  CATEGORY_TEXT, RARITIES, RARITY_TEXT, confirmDialog, errorMessages, itemThumb, mountThumbs, number, rarityBadge, subNav, xu,
} from './admin/chests/shared.js';

/** Where an item that is not managed here is managed. */
function ownPage(item) {
  if (item.category === 'CHEST') return { href: `/admin/chests/${encodeURIComponent(item.id)}`, label: 'Sửa ở trang Hòm' };
  if (item.category === 'KEY') return { href: `/admin/chests/${encodeURIComponent(item.id.replace(/^key_/, 'chest_'))}`, label: 'Sửa ở trang Hòm' };
  return { href: `/admin/cosmetics/${encodeURIComponent(item.id)}`, label: 'Sửa ở trang Mỹ phẩm' };
}

const matches = (item, filters) => {
  const text = filters.search.trim().toLocaleLowerCase('vi');
  if (text && ![item.id, item.name, item.nameEn].some((value) => value.toLocaleLowerCase('vi').includes(text))) return false;
  if (filters.category && item.category !== filters.category) return false;
  if (filters.rarity && item.rarity !== filters.rarity) return false;
  if (filters.status === 'live' && item.retired) return false;
  if (filters.status === 'retired' && !item.retired) return false;
  return true;
};

function rowHtml(item) {
  const chests = item.chests.length
    ? item.chests.map((chest) => `<a href="/admin/chests/${encodeURIComponent(chest.id)}">${escapeHtml(chest.name)}</a>`).join(', ')
    : '<span class="muted">Không</span>';
  const actions = item.editable
    ? `
      <button type="button" class="btn btn-ghost btn-sm" data-ac-edit>Sửa</button>
      <button type="button" class="btn btn-ghost btn-sm" data-ac-retire>${item.retired ? 'Phát hành lại' : 'Ngừng phát hành'}</button>
      ${item.deletable ? '<button type="button" class="btn btn-ghost btn-sm" data-ac-delete>Xóa</button>' : ''}`
    : (() => {
      const page = ownPage(item);
      return `<a class="btn btn-ghost btn-sm" href="${page.href}">${escapeHtml(page.label)}</a>`;
    })();
  return `
    <tr data-item-id="${escapeHtml(item.id)}"${item.retired ? ' class="is-retired"' : ''}>
      <td class="ac-cell-icon">${itemThumb(item)}</td>
      <td data-label="Tên">
        <strong>${escapeHtml(item.name)}</strong>
        <div class="muted ac-small">${escapeHtml(item.id)} · ${escapeHtml(CATEGORY_TEXT[item.category] ?? item.category)}</div>
        ${item.retired ? '<span class="ac-tag ac-tag--off">Đã ngừng phát hành</span>' : ''}
      </td>
      <td data-label="Độ hiếm">${rarityBadge(item.rarity)}</td>
      <td data-label="Giá tham chiếu">${xu(item.referencePrice)}</td>
      <td data-label="Được bán">${item.tradable ? 'Có' : 'Không'}</td>
      <td data-label="Đang lưu hành"><span data-ac-copies>${number(item.circulating)}</span></td>
      <td data-label="Trong hòm">${chests}</td>
      <td class="ac-cell-actions">${actions}</td>
    </tr>`;
}

/** /admin/items: every item type. Curios and old gear are managed here; cosmetics, chests and keys only point at their page. */
export async function renderAdminItemsPage(app, { signal } = {}) {
  render(app, `<div class="page ac-page">${subNav('items')}<p class="muted">Đang tải vật phẩm…</p></div>`);

  let data;
  try {
    data = await adminChestsApi.items();
  } catch (error) {
    if (signal?.aborted) return;
    render(app, `<div class="page ac-page">${subNav('items')}<div class="empty-state">${escapeHtml(errorMessages(error)[0])}</div></div>`);
    return;
  }
  if (signal?.aborted) return;

  const state = {
    items: data?.items ?? [],
    nextId: data?.nextCurioId ?? '',
    problems: data?.problems ?? [],
    filters: { search: '', category: '', rarity: '', status: '' },
  };

  render(app, `
    <div class="page ac-page ac-items">
      ${subNav('items')}
      <div class="page-head">
        <h2>Vật phẩm</h2>
        <button type="button" class="btn btn-primary" data-ac-new-item>Tạo vật phẩm sưu tầm</button>
      </div>
      ${state.problems.length ? `<details class="ac-problems"><summary>Danh mục có ${state.problems.length} chỗ chưa khớp</summary><ul>${state.problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join('')}</ul></details>` : ''}
      <div class="ac-toolbar">
        <input class="field-input" type="search" placeholder="Tìm theo tên hoặc mã" aria-label="Tìm vật phẩm" data-ac-search>
        <select class="field-input" aria-label="Nhóm" data-ac-filter="category">
          <option value="">Mọi nhóm</option>
          ${Object.entries(CATEGORY_TEXT).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('')}
        </select>
        <select class="field-input" aria-label="Độ hiếm" data-ac-filter="rarity">
          <option value="">Mọi độ hiếm</option>
          ${RARITIES.map((rarity) => `<option value="${rarity}">${RARITY_TEXT[rarity]}</option>`).join('')}
        </select>
        <select class="field-input" aria-label="Trạng thái" data-ac-filter="status">
          <option value="">Mọi trạng thái</option>
          <option value="live">Đang dùng</option>
          <option value="retired">Đã ngừng phát hành</option>
        </select>
      </div>
      <p class="muted ac-small" data-ac-count></p>
      <table class="admin-table ac-table">
        <thead><tr><th></th><th>Tên</th><th>Độ hiếm</th><th>Giá tham chiếu</th><th>Được bán</th><th>Đang lưu hành</th><th>Trong hòm</th><th></th></tr></thead>
        <tbody data-ac-rows></tbody>
      </table>
    </div>`);

  const rows = app.querySelector('[data-ac-rows]');
  const count = app.querySelector('[data-ac-count]');

  function paintRows() {
    const shown = state.items.filter((item) => matches(item, state.filters));
    count.textContent = `${number(shown.length)} / ${number(state.items.length)} vật phẩm`;
    rows.innerHTML = shown.length
      ? shown.map(rowHtml).join('')
      : '<tr><td colspan="8" class="muted">Không có vật phẩm nào khớp.</td></tr>';
    mountThumbs(rows, signal);
  }

  /** The server worked out circulation and references, so a change reloads the whole list. */
  async function reload() {
    const next = await adminChestsApi.items();
    if (signal?.aborted) return;
    state.items = next?.items ?? [];
    state.nextId = next?.nextCurioId ?? '';
    paintRows();
  }

  const refreshAfter = async (message) => {
    toast(message, 'success');
    try {
      await reload();
    } catch (error) {
      toast(errorMessages(error)[0], 'error');
    }
  };

  app.querySelector('[data-ac-search]').addEventListener('input', (event) => {
    state.filters.search = event.target.value;
    paintRows();
  });
  app.querySelectorAll('[data-ac-filter]').forEach((select) => select.addEventListener('change', () => {
    state.filters[select.dataset.acFilter] = select.value;
    paintRows();
  }));

  app.querySelector('[data-ac-new-item]').addEventListener('click', () => {
    openItemForm({ nextId: state.nextId, signal, onSaved: (saved) => refreshAfter(`Đã tạo ${saved.id}.`) });
  });

  rows.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    const id = button?.closest('tr')?.dataset.itemId;
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;

    if (button.hasAttribute('data-ac-edit')) {
      openItemForm({ item, signal, onSaved: (saved) => refreshAfter(`Đã lưu ${saved.name}.`) });
    } else if (button.hasAttribute('data-ac-retire')) {
      const retiring = !item.retired;
      confirmDialog({
        title: retiring ? `Ngừng phát hành ${item.name}?` : `Phát hành lại ${item.name}?`,
        body: retiring
          ? `<p>Món này không còn rơi từ hòm và không còn trong cửa hàng. ${number(item.circulating)} bản đang có vẫn dùng và bán được bình thường.</p>`
          : '<p>Món này rơi lại từ những hòm đang chứa nó.</p>',
        confirmLabel: retiring ? 'Ngừng phát hành' : 'Phát hành lại',
        danger: retiring,
        reason: retiring ? 'required' : 'optional',
        signal,
        action: async (reason) => {
          await adminChestsApi.retireItem(item.id, retiring, reason);
          await refreshAfter(retiring ? `Đã ngừng phát hành ${item.name}.` : `Đã phát hành lại ${item.name}.`);
        },
      });
    } else if (button.hasAttribute('data-ac-delete')) {
      confirmDialog({
        title: `Xóa hẳn ${item.name}?`,
        body: `<p>Chưa ai sở hữu món này nên có thể xóa hẳn. Không hoàn tác được; mã ${escapeHtml(item.id)} có thể được dùng lại.</p>`,
        confirmLabel: 'Xóa hẳn',
        danger: true,
        signal,
        action: async (reason) => {
          await adminChestsApi.deleteItem(item.id, reason);
          await refreshAfter(`Đã xóa ${item.name}.`);
        },
      });
    }
  });

  paintRows();
}
