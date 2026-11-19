import { adminChestsApi } from '../api/adminChestsApi.js';
import { icon, pager, pill, stateBox } from '../components/admin/ui.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { openItemForm } from './admin/chests/itemForm.js';
import {
  CATEGORY_TEXT, RARITIES, RARITY_TEXT, acIcon, areaHead, confirmDialog, errorMessages, itemThumb, mountThumbs, number, rarityBadge, routeParam,
  setRouteParam, xu,
} from './admin/chests/shared.js';

/**
 * Rows per page. The whole catalogue is loaded at once and paged here; 50 keeps the seeded curios on the first page,
 * where admins (and the end-to-end suites) look for them first.
 */
const PAGE_SIZES = [20, 50, 100];
const DEFAULT_PAGE_SIZE = 50;

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
    : '<span class="ac-none">Không</span>';
  const actions = item.editable
    ? `
      <button type="button" class="btn btn-ghost btn-sm" data-ac-edit>Sửa</button>
      <button type="button" class="btn btn-ghost btn-sm ${item.retired ? 'adm-btn-ok' : 'adm-btn-danger'}" data-ac-retire>${item.retired ? 'Phát hành lại' : 'Ngừng phát hành'}</button>
      ${item.deletable ? `<button type="button" class="btn btn-ghost btn-sm adm-btn-danger ac-icon-btn" data-ac-delete aria-label="Xóa ${escapeHtml(item.name)}" title="Xóa">${acIcon('trash', 16)}</button>` : ''}`
    : (() => {
      const page = ownPage(item);
      return `<a class="ac-link" href="${page.href}">${escapeHtml(page.label)}</a>`;
    })();
  return `
    <tr data-item-id="${escapeHtml(item.id)}"${item.retired ? ' class="is-retired"' : ''}>
      <td>
        <span class="ac-item-name">
          <span class="ac-item-art">${itemThumb(item)}</span>
          <span class="ac-item-text">
            <strong>${escapeHtml(item.name)}</strong>
            <small><span class="adm-mono">${escapeHtml(item.id)}</span> · ${escapeHtml(CATEGORY_TEXT[item.category] ?? item.category)}</small>
            ${item.retired ? pill('Đã ngừng phát hành', 'bad', { small: true }) : ''}
          </span>
        </span>
      </td>
      <td>${rarityBadge(item.rarity)}</td>
      <td class="adm-num ac-price">${xu(item.referencePrice)}</td>
      <td>${item.tradable ? '<span class="ac-yes">Có</span>' : '<span class="ac-none">Không</span>'}</td>
      <td class="adm-num"><span data-ac-copies>${number(item.circulating)}</span></td>
      <td class="ac-in-chests">${chests}</td>
      <td><div class="adm-table-actions">${actions}</div></td>
    </tr>`;
}

/** /admin/items: every item type. Curios and old gear are managed here; cosmetics, chests and keys only point at their page. */
export async function renderAdminItemsPage(app, { signal } = {}) {
  const newButton = `<button type="button" class="btn btn-primary" data-ac-new-item>${icon('plus', 18)}Tạo vật phẩm sưu tầm</button>`;
  render(app, `<div class="page ac-page">${areaHead('items')}${stateBox('loading', 'Đang tải vật phẩm…')}</div>`);

  let data;
  try {
    data = await adminChestsApi.items();
  } catch (error) {
    if (signal?.aborted) return;
    render(app, `<div class="page ac-page">${areaHead('items')}${stateBox('error', 'Không tải được danh sách vật phẩm', errorMessages(error)[0])}</div>`);
    return;
  }
  if (signal?.aborted) return;

  const state = {
    items: data?.items ?? [],
    nextId: data?.nextCurioId ?? '',
    problems: data?.problems ?? [],
    // The search on the top bar sends people here with ?q=.
    filters: { search: routeParam('q') ?? '', category: '', rarity: '', status: '' },
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };

  render(app, `
    <div class="page ac-page ac-items">
      ${areaHead('items', newButton)}
      ${state.problems.length ? `<details class="ac-problems"><summary>Danh mục có ${state.problems.length} chỗ chưa khớp</summary><ul>${state.problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join('')}</ul></details>` : ''}
      <section class="adm-card adm-card--flush ac-items-card" aria-label="Danh sách vật phẩm">
        <div class="ac-toolbar ac-items-toolbar">
          <label class="adm-search-box ac-search">
            ${icon('search', 18)}
            <span class="bpa-sr">Tìm vật phẩm</span>
            <input type="search" placeholder="Tìm theo tên hoặc mã" data-ac-search value="${escapeHtml(state.filters.search)}">
          </label>
          <label class="ac-select"><span class="bpa-sr">Nhóm</span>
            <select class="field-input" data-ac-filter="category">
              <option value="">Mọi nhóm</option>
              ${Object.entries(CATEGORY_TEXT).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('')}
            </select>
          </label>
          <label class="ac-select"><span class="bpa-sr">Độ hiếm</span>
            <select class="field-input" data-ac-filter="rarity">
              <option value="">Mọi độ hiếm</option>
              ${RARITIES.map((rarity) => `<option value="${rarity}">${RARITY_TEXT[rarity]}</option>`).join('')}
            </select>
          </label>
          <label class="ac-select"><span class="bpa-sr">Trạng thái</span>
            <select class="field-input" data-ac-filter="status">
              <option value="">Mọi trạng thái</option>
              <option value="live">Đang dùng</option>
              <option value="retired">Đã ngừng phát hành</option>
            </select>
          </label>
        </div>
        <div class="adm-table-wrap">
          <table class="adm-table ac-items-table">
            <thead><tr><th>Tên</th><th>Độ hiếm</th><th class="adm-num">Giá tham chiếu</th><th>Được bán</th><th class="adm-num">Lưu hành</th><th>Trong hòm</th><th class="ac-th-actions">Thao tác</th></tr></thead>
            <tbody data-ac-rows></tbody>
          </table>
        </div>
        <div data-ac-pager></div>
      </section>
    </div>`);

  const rows = app.querySelector('[data-ac-rows]');
  const pagerHost = app.querySelector('[data-ac-pager]');

  function paintRows() {
    const shown = state.items.filter((item) => matches(item, state.filters));
    const pages = Math.max(1, Math.ceil(shown.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * state.pageSize;
    rows.innerHTML = shown.length
      ? shown.slice(start, start + state.pageSize).map(rowHtml).join('')
      : '<tr><td colspan="7" class="ac-empty-cell">Không có vật phẩm nào khớp.</td></tr>';
    const filtered = shown.length !== state.items.length;
    pagerHost.innerHTML = pager({
      page: state.page,
      pageSize: state.pageSize,
      total: shown.length,
      noun: filtered ? `vật phẩm (lọc từ ${number(state.items.length)})` : 'vật phẩm',
      perPageHtml: `
        <label class="ac-per-page">Mỗi trang
          <select class="field-input" data-ac-page-size>
            ${PAGE_SIZES.map((size) => `<option value="${size}"${size === state.pageSize ? ' selected' : ''}>${size}</option>`).join('')}
          </select>
        </label>`,
    });
    mountThumbs(rows, signal);
  }

  /** Turns to the page that holds `id`, so what was just made or changed is on screen. */
  function reveal(id) {
    const index = state.items.filter((item) => matches(item, state.filters)).findIndex((item) => item.id === id);
    if (index >= 0) state.page = Math.floor(index / state.pageSize) + 1;
  }

  /** The server worked out circulation and references, so a change reloads the whole list. */
  async function reload(revealId) {
    const next = await adminChestsApi.items();
    if (signal?.aborted) return;
    state.items = next?.items ?? [];
    state.nextId = next?.nextCurioId ?? '';
    if (revealId) reveal(revealId);
    paintRows();
  }

  const refreshAfter = async (message, revealId) => {
    toast(message, 'success');
    try {
      await reload(revealId);
    } catch (error) {
      toast(errorMessages(error)[0], 'error');
    }
  };

  app.querySelector('[data-ac-search]').addEventListener('input', (event) => {
    state.filters.search = event.target.value;
    state.page = 1;
    setRouteParam('q', event.target.value.trim() || null);
    paintRows();
  });
  app.querySelectorAll('[data-ac-filter]').forEach((select) => select.addEventListener('change', () => {
    state.filters[select.dataset.acFilter] = select.value;
    state.page = 1;
    paintRows();
  }));

  pagerHost.addEventListener('click', (event) => {
    const button = event.target.closest('[data-adm-page]');
    if (!button || button.disabled) return;
    state.page = Number(button.dataset.admPage);
    paintRows();
    // The buttons are under the table: bring the top of the new page back into view, below the sticky top bar.
    const top = app.querySelector('.ac-items-card')?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollBy(0, top - 96);
  });
  pagerHost.addEventListener('change', (event) => {
    if (!event.target.matches('[data-ac-page-size]')) return;
    state.pageSize = Number(event.target.value) || DEFAULT_PAGE_SIZE;
    state.page = 1;
    paintRows();
  });

  app.querySelector('[data-ac-new-item]').addEventListener('click', () => {
    openItemForm({ nextId: state.nextId, signal, onSaved: (saved) => refreshAfter(`Đã tạo ${saved.id}.`, saved.id) });
  });

  rows.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    const id = button?.closest('tr')?.dataset.itemId;
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;

    if (button.hasAttribute('data-ac-edit')) {
      openItemForm({ item, signal, onSaved: (saved) => refreshAfter(`Đã lưu ${saved.name}.`, saved.id) });
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
