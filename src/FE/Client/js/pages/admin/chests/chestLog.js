import { adminChestsApi } from '../../../api/adminChestsApi.js';
import { escapeHtml, render } from '../../../utils/dom.js';
import { RARITIES, RARITY_TEXT, dateTime, errorMessages, errorsHtml, itemThumb, mountThumbs, number, rarityBadge } from './shared.js';

const STATE_TEXT = { DONE: 'Xong', PENDING: 'Đang xử lý', ROLLING_BACK: 'Đang hoàn lại' };

/** The start or the end of a chosen day, in UTC for the server. */
const dayBound = (value, end) => (value ? new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : undefined);

/** Every opening, newest first, searchable by player, chest, date and rarity. */
export async function renderChestLog(host, { signal } = {}) {
  let chests = [];
  try {
    chests = (await adminChestsApi.chests())?.chests ?? [];
  } catch {
    // The log still works without the chest filter's names.
  }
  if (signal?.aborted) return;

  const filters = { page: 1 };

  render(host, `
    <div class="page-head"><h2>Nhật ký mở hòm</h2></div>
    <form class="ac-toolbar ac-log-filters" data-ac-log-form>
      <input class="field-input" type="search" name="player" placeholder="Tên hoặc email người chơi" aria-label="Người chơi">
      <select class="field-input" name="chestId" aria-label="Hòm">
        <option value="">Mọi hòm</option>
        ${chests.map((chest) => `<option value="${escapeHtml(chest.id)}">${escapeHtml(chest.name)}</option>`).join('')}
      </select>
      <select class="field-input" name="rarity" aria-label="Độ hiếm">
        <option value="">Mọi độ hiếm</option>
        ${RARITIES.map((rarity) => `<option value="${rarity}">${RARITY_TEXT[rarity]}</option>`).join('')}
      </select>
      <label class="ac-inline-field">Từ <input class="field-input" type="date" name="from"></label>
      <label class="ac-inline-field">Đến <input class="field-input" type="date" name="to"></label>
      <button type="submit" class="btn btn-ghost" data-ac-log-apply>Lọc</button>
    </form>
    <div data-ac-log-rows></div>`);

  const rows = host.querySelector('[data-ac-log-rows]');

  async function load() {
    let data;
    try {
      data = await adminChestsApi.openings(filters);
    } catch (error) {
      if (!signal?.aborted) render(rows, errorsHtml(errorMessages(error)));
      return;
    }
    if (signal?.aborted) return;
    const items = data?.items ?? [];
    const total = data?.total ?? 0;
    const pageSize = data?.pageSize || 1;
    const page = data?.page ?? 1;
    render(rows, `
      <p class="muted ac-small">${number(total)} lượt mở</p>
      <table class="admin-table ac-table">
        <thead><tr><th>Lúc</th><th>Người chơi</th><th>Hòm</th><th></th><th>Vật phẩm</th><th>Độ hiếm</th><th>Trạng thái</th></tr></thead>
        <tbody>
          ${items.map((row) => `
            <tr data-opening="${escapeHtml(row.id)}">
              <td data-label="Lúc">${dateTime(row.at)}</td>
              <td data-label="Người chơi">${escapeHtml(row.playerName)}</td>
              <td data-label="Hòm">${escapeHtml(row.chestName)}</td>
              <td class="ac-cell-icon">${itemThumb(row.item, 32)}</td>
              <td data-label="Vật phẩm">${escapeHtml(row.item.name)}</td>
              <td data-label="Độ hiếm">${rarityBadge(row.item.rarity)}</td>
              <td data-label="Trạng thái">${escapeHtml(STATE_TEXT[row.state] ?? row.state)}</td>
            </tr>`).join('') || '<tr><td colspan="7" class="muted">Không có lượt mở nào khớp.</td></tr>'}
        </tbody>
      </table>
      <div class="ac-pager">
        <button type="button" class="btn btn-ghost btn-sm" data-ac-prev-page ${page <= 1 ? 'disabled' : ''}>Trang trước</button>
        <span class="muted ac-small">Trang ${number(page)} / ${number(Math.max(1, Math.ceil(total / pageSize)))}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-ac-next-page ${page * pageSize >= total ? 'disabled' : ''}>Trang sau</button>
      </div>`);
    mountThumbs(rows, signal);
    rows.querySelector('[data-ac-prev-page]').addEventListener('click', () => { filters.page = page - 1; load(); });
    rows.querySelector('[data-ac-next-page]').addEventListener('click', () => { filters.page = page + 1; load(); });
  }

  host.querySelector('[data-ac-log-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    filters.player = form.elements.player.value.trim() || undefined;
    filters.chestId = form.elements.chestId.value || undefined;
    filters.rarity = form.elements.rarity.value || undefined;
    filters.from = dayBound(form.elements.from.value, false);
    filters.to = dayBound(form.elements.to.value, true);
    filters.page = 1;
    load();
  });

  await load();
}
