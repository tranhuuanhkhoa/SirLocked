import { adminPlayersApi } from '../../../api/adminPlayersApi.js';
import { escapeHtml } from '../../../utils/dom.js';
import { categoryLabel, rarityLabel } from '../../market/marketKit.js';
import { alertBox, coins, routeParams, num, playerLink, tableHtml, writeRouteParams } from './shared.js';

const signedIn = (value) => (value ? `+${num(value)}` : '0');
const signedOut = (value) => (value ? `−${num(value)}` : '0');
const signed = (value) => (value > 0 ? `+${num(value)}` : value < 0 ? `−${num(-value)}` : '0');

const dayLabel = (day) => {
  const [year, month, date] = String(day).split('-');
  return date ? `${date}/${month}/${year}` : String(day);
};

function flowTable(days, totals) {
  const columns = [
    { label: 'Ngày', cell: (row) => escapeHtml(dayLabel(row.day)) },
    { label: 'Quà khởi đầu', cell: (row) => signedIn(row.starter) },
    { label: 'Thưởng trận', cell: (row) => signedIn(row.gameRewards) },
    { label: 'Admin cộng', cell: (row) => signedIn(row.adminIn) },
    { label: 'Mua hòm, chìa', cell: (row) => signedOut(row.chestShop) },
    { label: 'Phí chợ', cell: (row) => signedOut(row.marketFees) },
    { label: 'Admin trừ', cell: (row) => signedOut(row.adminOut) },
    { label: 'Tăng / giảm', cell: (row) => `<strong>${signed(row.net)}</strong>` },
  ];
  // Newest first: the day that needs looking at is usually today.
  const rows = [...(days ?? [])].reverse();
  const total = totals ? `
    <p class="muted small adp-flow-total">Cả kỳ: vào ${num(totals.starter + totals.gameRewards + totals.adminIn)} xu, ra ${num(totals.chestShop + totals.marketFees + totals.adminOut)} xu, chênh lệch ${signed(totals.net)} xu.</p>` : '';
  return `${total}${tableHtml(columns, rows, { attrs: 'data-adp-flow' })}`;
}

const countList = (rows, label) => (rows ?? []).map((row) => `
  <li><span>${escapeHtml(label(row.key))}</span><strong>${num(row.count)}</strong></li>`).join('');

/** Coins in circulation and held, items by rarity and group, daily flows by source, and the richest players. */
export function mountOverview(host, { signal }) {
  let days = routeParams().get('days') === '30' ? 30 : 7;
  let latest = 0;

  const draw = async () => {
    const mine = ++latest;
    host.setAttribute('aria-busy', 'true');
    let data;
    try {
      data = await adminPlayersApi.overview(days);
    } catch (error) {
      if (mine === latest && !signal?.aborted) {
        host.innerHTML = alertBox(error);
        host.dataset.adpLoaded = 'true';
      }
      return;
    }
    if (mine !== latest || signal?.aborted) return;
    host.removeAttribute('aria-busy');
    host.dataset.adpLoaded = 'true';
    if (!data) {
      host.innerHTML = '<div class="empty-state">Chưa có số liệu.</div>';
      return;
    }
    host.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><span class="muted small">Xu đang lưu hành</span><strong>${num(data.coinsInCirculation)}</strong></div>
        <div class="stat-card"><span class="muted small">Xu giữ cho lệnh mua</span><strong>${num(data.coinsHeld)}</strong></div>
      </div>

      <h3 class="section-title">Vật phẩm đang có</h3>
      <div class="adp-counts">
        <div><h4 class="adp-subtitle">Theo độ hiếm</h4><ul class="adp-count-list">${countList(data.itemsByRarity, (key) => (key === 'UNKNOWN' ? 'Không rõ' : rarityLabel(key)))}</ul></div>
        <div><h4 class="adp-subtitle">Theo nhóm</h4><ul class="adp-count-list">${countList(data.itemsByCategory, (key) => (key === 'UNKNOWN' ? 'Không rõ' : categoryLabel(key)))}</ul></div>
      </div>

      <div class="adp-section-head">
        <h3 class="section-title">Xu vào và ra theo ngày</h3>
        <div class="adp-toggle" role="group" aria-label="Khoảng thời gian">
          ${[7, 30].map((value) => `<button class="btn btn-sm ${value === days ? 'btn-primary' : 'btn-ghost'}" type="button" data-days="${value}" aria-pressed="${value === days}">${value} ngày</button>`).join('')}
        </div>
      </div>
      ${flowTable(data.days, data.totals)}

      <h3 class="section-title">Người giàu nhất</h3>
      ${(data.richest ?? []).length ? tableHtml([
    { label: 'Hạng', cell: (_row, index) => num(index + 1) },
    { label: 'Người chơi', cell: (row) => playerLink(row.userId, row.fullName) },
    { label: 'Số dư', cell: (row) => coins(row.balance) },
    { label: 'Đang giữ', cell: (row) => coins(row.held) },
  ], data.richest) : '<div class="empty-state small">Chưa có ai có ví.</div>'}`;
  };

  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-days]');
    if (!button || Number(button.dataset.days) === days) return;
    days = Number(button.dataset.days);
    writeRouteParams({ days: days === 30 ? '30' : '' });
    draw();
  }, { signal });

  host.innerHTML = '<p class="muted">Đang tải số liệu…</p>';
  draw();
}
