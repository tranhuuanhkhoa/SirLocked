import { adminChestsApi } from '../../../api/adminChestsApi.js';
import { stateBox } from '../../../components/admin/ui.js';
import { escapeHtml, render } from '../../../utils/dom.js';
import { RARITY_COLOR, RARITY_TEXT, dateTime, errorMessages, errorsHtml, itemThumb, mountThumbs, number, percent, rarityBadge, xu } from './shared.js';

const barWidth = (value) => Math.min(100, Math.max(0, Number(value) || 0));

/** One chest over the last 7 or 30 days: what it sold, and whether it paid out what its table promises. */
export async function renderChestStats(host, chestId, { signal } = {}) {
  let days = 7;

  async function load() {
    render(host, stateBox('loading', 'Đang tải thống kê…'));
    let stats;
    try {
      stats = await adminChestsApi.stats(chestId, days);
    } catch (error) {
      if (!signal?.aborted) render(host, errorsHtml(errorMessages(error)));
      return;
    }
    if (signal?.aborted || !stats) return;
    // The tile of ui.js, with a hook on its number.
    const statTile = (key, label, value) => `
      <div class="adm-tile"><span class="adm-tile-label">${escapeHtml(label)}</span><span class="adm-tile-value" data-ac-stat="${key}">${escapeHtml(value)}</span></div>`;
    render(host, `
      <div class="ac-stats">
        <div class="adm-seg ac-range" role="group" aria-label="Khoảng thời gian">
          ${[7, 30].map((value) => `<button type="button" class="ac-chip${value === days ? ' is-active' : ''}" data-ac-days="${value}" aria-pressed="${value === days}">${value} ngày</button>`).join('')}
        </div>
        <div class="adm-grid adm-grid--tiles ac-stat-tiles">
          ${statTile('opens', 'Lượt mở', number(stats.opens))}
          ${statTile('chests', 'Xu từ bán hòm', xu(stats.coinsFromChests))}
          ${statTile('keys', 'Xu từ bán chìa', xu(stats.coinsFromKeys))}
        </div>

        <section class="adm-card adm-card--flush" aria-labelledby="ac-rates-real-title">
          <div class="adm-card-head">
            <div>
              <h2 class="adm-card-title" id="ac-rates-real-title">Tỉ lệ rơi thực tế so với cấu hình</h2>
              ${stats.opens === 0 ? '<p class="adm-card-sub">Chưa có lượt mở nào trong khoảng này.</p>' : ''}
            </div>
          </div>
          <div class="adm-table-wrap">
            <table class="adm-table ac-rates">
              <thead><tr><th>Độ hiếm</th><th class="adm-num">Số lượt</th><th class="adm-num">Thực tế</th><th class="adm-num">Cấu hình</th><th>So sánh</th></tr></thead>
              <tbody>
                ${stats.rates.map((rate) => `
                  <tr data-rate="${rate.rarity}">
                    <td>${rarityBadge(rate.rarity)}</td>
                    <td class="adm-num">${number(rate.count)}</td>
                    <td class="adm-num">${percent(rate.actualPercent)}</td>
                    <td class="adm-num">${percent(rate.configuredPercent)}</td>
                    <td class="ac-bars" aria-hidden="true">
                      <span class="ac-bar-track"><span class="ac-bar" data-bar="actual" style="width: ${barWidth(rate.actualPercent)}%; background: ${RARITY_COLOR[rate.rarity]}"></span></span>
                      <span class="ac-bar-track"><span class="ac-bar ac-bar--configured" data-bar="configured" style="width: ${barWidth(rate.configuredPercent)}%"></span></span>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <p class="ac-bars-legend"><span class="ac-key ac-key--actual"></span>Thực tế <span class="ac-key ac-key--configured"></span>Cấu hình</p>
        </section>

        <div class="ac-stat-columns">
          <section class="adm-card" data-ac-top aria-labelledby="ac-top-title">
            <h2 class="adm-card-title" id="ac-top-title">Món ra nhiều nhất</h2>
            ${stats.topItems.length ? `<ol class="ac-rank">${stats.topItems.map((row) => `<li>${itemThumb(row.def, 32)}<span class="ac-rank-name">${escapeHtml(row.def.name)}</span>${rarityBadge(row.def.rarity)}<strong>${number(row.count)}</strong></li>`).join('')}</ol>` : '<p class="ac-card-note">Chưa có.</p>'}
          </section>
          <section class="adm-card" data-ac-rare-drops aria-labelledby="ac-rare-title">
            <h2 class="adm-card-title" id="ac-rare-title">${escapeHtml(RARITY_TEXT.LEGENDARY)} và ${escapeHtml(RARITY_TEXT.MYSTERY)} gần đây</h2>
            ${stats.rareDrops.length ? `<ol class="ac-rank">${stats.rareDrops.map((row) => `<li>${itemThumb(row.def, 32)}<span class="ac-rank-name">${escapeHtml(row.def.name)}<small>${escapeHtml(row.playerName)} · ${dateTime(row.at)}</small></span>${rarityBadge(row.def.rarity)}</li>`).join('')}</ol>` : '<p class="ac-card-note">Chưa có.</p>'}
          </section>
        </div>
      </div>`);
    mountThumbs(host, signal);
    host.querySelectorAll('[data-ac-days]').forEach((button) => button.addEventListener('click', () => {
      days = Number(button.dataset.acDays);
      load();
    }));
  }

  await load();
}
