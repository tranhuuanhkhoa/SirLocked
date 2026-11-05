import { adminChestsApi } from '../../../api/adminChestsApi.js';
import { escapeHtml, render } from '../../../utils/dom.js';
import { RARITY_COLOR, RARITY_TEXT, dateTime, errorMessages, errorsHtml, itemThumb, mountThumbs, number, percent, rarityBadge, xu } from './shared.js';

const barWidth = (value) => Math.min(100, Math.max(0, Number(value) || 0));

/** One chest over the last 7 or 30 days: what it sold, and whether it paid out what its table promises. */
export async function renderChestStats(host, chestId, { signal } = {}) {
  let days = 7;

  async function load() {
    render(host, '<p class="muted">Đang tải thống kê…</p>');
    let stats;
    try {
      stats = await adminChestsApi.stats(chestId, days);
    } catch (error) {
      if (!signal?.aborted) render(host, errorsHtml(errorMessages(error)));
      return;
    }
    if (signal?.aborted || !stats) return;
    render(host, `
      <div class="ac-range" role="group" aria-label="Khoảng thời gian">
        ${[7, 30].map((value) => `<button type="button" class="ac-chip${value === days ? ' is-active' : ''}" data-ac-days="${value}" aria-pressed="${value === days}">${value} ngày</button>`).join('')}
      </div>
      <div class="ac-stat-cards">
        <div class="ac-stat"><span>Lượt mở</span><strong data-ac-stat="opens">${number(stats.opens)}</strong></div>
        <div class="ac-stat"><span>Xu từ bán hòm</span><strong data-ac-stat="chests">${xu(stats.coinsFromChests)}</strong></div>
        <div class="ac-stat"><span>Xu từ bán chìa</span><strong data-ac-stat="keys">${xu(stats.coinsFromKeys)}</strong></div>
      </div>

      <h3 class="ac-section-title">Tỉ lệ rơi thực tế so với cấu hình</h3>
      <table class="admin-table ac-table ac-rates">
        <thead><tr><th>Độ hiếm</th><th>Số lượt</th><th>Thực tế</th><th>Cấu hình</th><th>So sánh</th></tr></thead>
        <tbody>
          ${stats.rates.map((rate) => `
            <tr data-rate="${rate.rarity}">
              <td data-label="Độ hiếm">${rarityBadge(rate.rarity)}</td>
              <td data-label="Số lượt">${number(rate.count)}</td>
              <td data-label="Thực tế">${percent(rate.actualPercent)}</td>
              <td data-label="Cấu hình">${percent(rate.configuredPercent)}</td>
              <td data-label="So sánh" class="ac-bars" aria-hidden="true">
                <span class="ac-bar" data-bar="actual" style="width: ${barWidth(rate.actualPercent)}%; background: ${RARITY_COLOR[rate.rarity]}"></span>
                <span class="ac-bar ac-bar--configured" data-bar="configured" style="width: ${barWidth(rate.configuredPercent)}%"></span>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${stats.opens === 0 ? '<p class="muted ac-small">Chưa có lượt mở nào trong khoảng này.</p>' : ''}

      <div class="ac-stat-columns">
        <section data-ac-top>
          <h3 class="ac-section-title">Món ra nhiều nhất</h3>
          ${stats.topItems.length ? `<ol class="ac-rank">${stats.topItems.map((row) => `<li>${itemThumb(row.def, 32)}<span>${escapeHtml(row.def.name)}</span>${rarityBadge(row.def.rarity)}<strong>${number(row.count)}</strong></li>`).join('')}</ol>` : '<p class="muted">Chưa có.</p>'}
        </section>
        <section data-ac-rare-drops>
          <h3 class="ac-section-title">${escapeHtml(RARITY_TEXT.LEGENDARY)} và ${escapeHtml(RARITY_TEXT.MYSTERY)} gần đây</h3>
          ${stats.rareDrops.length ? `<ol class="ac-rank">${stats.rareDrops.map((row) => `<li>${itemThumb(row.def, 32)}<span>${escapeHtml(row.def.name)}<br><span class="muted ac-small">${escapeHtml(row.playerName)} · ${dateTime(row.at)}</span></span>${rarityBadge(row.def.rarity)}</li>`).join('')}</ol>` : '<p class="muted">Chưa có.</p>'}
        </section>
      </div>`);
    mountThumbs(host, signal);
    host.querySelectorAll('[data-ac-days]').forEach((button) => button.addEventListener('click', () => {
      days = Number(button.dataset.acDays);
      load();
    }));
  }

  await load();
}
