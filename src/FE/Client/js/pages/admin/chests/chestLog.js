import { adminChestsApi } from '../../../api/adminChestsApi.js';
import { pager, pill, stateBox } from '../../../components/admin/ui.js';
import { escapeHtml, render } from '../../../utils/dom.js';
import { RARITIES, RARITY_TEXT, dateTime, errorMessages, errorsHtml, itemThumb, mountThumbs, rarityBadge } from './shared.js';

const STATE_TEXT = { DONE: 'Xong', PENDING: 'Đang xử lý', ROLLING_BACK: 'Đang hoàn lại' };
const STATE_TONE = { DONE: 'ok', PENDING: 'gold', ROLLING_BACK: 'bad' };

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
  let ticket = 0;

  render(host, `
    <section class="adm-card adm-card--flush ac-log" aria-label="Nhật ký mở hòm">
      <form class="ac-log-filters" data-ac-log-form>
        <label class="ac-field ac-field--wide"><span>Người chơi</span>
          <input class="field-input ac-input-soft" type="search" name="player" placeholder="Tên hoặc email người chơi">
        </label>
        <label class="ac-field"><span>Hòm</span>
          <select class="field-input" name="chestId">
            <option value="">Mọi hòm</option>
            ${chests.map((chest) => `<option value="${escapeHtml(chest.id)}">${escapeHtml(chest.name)}</option>`).join('')}
          </select>
        </label>
        <label class="ac-field"><span>Độ hiếm</span>
          <select class="field-input" name="rarity">
            <option value="">Mọi độ hiếm</option>
            ${RARITIES.map((rarity) => `<option value="${rarity}">${RARITY_TEXT[rarity]}</option>`).join('')}
          </select>
        </label>
        <label class="ac-field"><span>Từ</span><input class="field-input" type="date" name="from"></label>
        <label class="ac-field"><span>Đến</span><input class="field-input" type="date" name="to"></label>
        <button type="submit" class="btn btn-primary" data-ac-log-apply>Lọc</button>
      </form>
      <div data-ac-log-rows>${stateBox('loading', 'Đang tải nhật ký…')}</div>
    </section>`);

  const rows = host.querySelector('[data-ac-log-rows]');

  async function load() {
    const mine = ++ticket;
    let data;
    try {
      data = await adminChestsApi.openings(filters);
    } catch (error) {
      if (!signal?.aborted && mine === ticket) render(rows, `<div class="ac-pad">${errorsHtml(errorMessages(error))}</div>`);
      return;
    }
    // Only the latest search may draw: an older one can answer last.
    if (signal?.aborted || mine !== ticket) return;
    const items = data?.items ?? [];
    const total = data?.total ?? 0;
    const pageSize = data?.pageSize || 1;
    const page = data?.page ?? 1;
    render(rows, `
      <div class="adm-table-wrap">
        <table class="adm-table ac-log-table">
          <thead><tr><th>Lúc</th><th>Người chơi</th><th>Hòm</th><th>Vật phẩm</th><th>Trạng thái</th></tr></thead>
          <tbody>
            ${items.map((row) => `
              <tr data-opening="${escapeHtml(row.id)}">
                <td class="ac-nowrap ac-muted-cell">${dateTime(row.at)}</td>
                <td>${escapeHtml(row.playerName)}</td>
                <td>${escapeHtml(row.chestName)}</td>
                <td><span class="ac-item-cell">${itemThumb(row.item, 32)}<span>${escapeHtml(row.item.name)}</span>${rarityBadge(row.item.rarity)}</span></td>
                <td>${pill(STATE_TEXT[row.state] ?? row.state, STATE_TONE[row.state] ?? '', { small: true })}</td>
              </tr>`).join('') || '<tr><td colspan="5" class="ac-empty-cell">Không có lượt mở nào khớp.</td></tr>'}
          </tbody>
        </table>
      </div>
      ${pager({ page, pageSize, total, noun: 'lượt mở' })}`);
    rows.querySelector('.adm-pager-nav > button:first-of-type')?.setAttribute('data-ac-prev-page', '');
    rows.querySelector('.adm-pager-nav > button:last-of-type')?.setAttribute('data-ac-next-page', '');
    mountThumbs(rows, signal);
    rows.querySelectorAll('[data-adm-page]').forEach((button) => button.addEventListener('click', () => {
      filters.page = Number(button.dataset.admPage);
      load();
    }));
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
