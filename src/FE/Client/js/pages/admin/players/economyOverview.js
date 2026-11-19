import { adminPlayersApi } from '../../../api/adminPlayersApi.js';
import { kpiCard, stateBox } from '../../../components/admin/ui.js';
import { escapeHtml } from '../../../utils/dom.js';
import { categoryLabel, rarityLabel } from '../../market/marketKit.js';
import { alertBox, num, routeParams, sectionCard, tableHtml, writeRouteParams } from './shared.js';

const signedIn = (value) => (value ? `+${num(value)}` : '0');
const signedOut = (value) => (value ? `−${num(value)}` : '0');
const signed = (value) => (value > 0 ? `+${num(value)}` : value < 0 ? `−${num(-value)}` : '0');

const dayLabel = (day) => {
  const [year, month, date] = String(day).split('-');
  return date ? `${date}/${month}/${year}` : String(day);
};
const shortDay = (day) => {
  const [, month, date] = String(day).split('-');
  return date ? `${date}/${month}` : String(day);
};

const rarityName = (key) => (key === 'UNKNOWN' ? 'Không rõ' : rarityLabel(key));
const categoryName = (key) => (key === 'UNKNOWN' ? 'Không rõ' : categoryLabel(key));

/** Each day's net change as a bar: up (teal) when more came in than went out, down (rust) otherwise. Same numbers as the table below. */
function flowChart(days) {
  const list = days ?? [];
  if (!list.length) return stateBox('empty', 'Chưa có số liệu trong khoảng này.');
  const dense = list.length > 14;
  const biggest = Math.max(1, ...list.map((row) => Math.abs(Number(row.net) || 0)));
  const hasUp = list.some((row) => row.net > 0);
  const hasDown = list.some((row) => row.net < 0);
  const up = hasUp ? (dense ? 84 : 104) : (dense ? 4 : 24);
  const down = hasDown ? (dense ? 84 : 104) : 4;
  const height = (value) => Math.max(3, Math.round((Math.abs(value) / biggest) * 80));

  const columns = list.map((row, index) => {
    const net = Number(row.net) || 0;
    // On 30 days only every fifth day is named, counted back from today so the last bar always is.
    const named = !dense || (list.length - 1 - index) % 5 === 0;
    return `
      <div class="adp-bar-col" title="${escapeHtml(`${dayLabel(row.day)}: ${signed(net)} xu`)}">
        <div class="adp-bar-up">
          ${net >= 0 ? `<span class="adp-bar-val">${signed(net)}</span>` : ''}
          ${net > 0 ? `<span class="adp-bar adp-bar--up" style="height: ${height(net)}px"></span>` : ''}
        </div>
        <div class="adp-bar-axis"></div>
        <div class="adp-bar-down">
          ${net < 0 ? `<span class="adp-bar adp-bar--down" style="height: ${height(net)}px"></span><span class="adp-bar-val">${signed(net)}</span>` : ''}
        </div>
        <span class="adp-bar-day"${named ? '' : ' aria-hidden="true"'}>${named ? escapeHtml(shortDay(row.day)) : '&nbsp;'}</span>
      </div>`;
  }).join('');

  const moved = list.filter((row) => row.net);
  const summary = moved.length === 0
    ? 'không ngày nào thay đổi'
    : moved.length <= 7
      ? moved.map((row) => `${shortDay(row.day)} ${row.net > 0 ? 'tăng' : 'giảm'} ${num(Math.abs(row.net))}`).join(', ')
      : `${moved.length} ngày có thay đổi, xem bảng Chi tiết theo ngày`;
  const label = `Biểu đồ chênh lệch xu theo ngày từ ${shortDay(list[0].day)} đến ${shortDay(list[list.length - 1].day)}: ${summary}.`;

  return `
    <div class="adp-chart${dense ? ' adp-chart--dense' : ''}" role="img" aria-label="${escapeHtml(label)}"
      style="--adp-cols: ${list.length}; --adp-up-h: ${up}px; --adp-down-h: ${down}px">${columns}</div>
    <div class="adp-legend" aria-hidden="true">
      <span><span class="adp-swatch adp-swatch--up"></span>Vào nhiều hơn ra (tăng)</span>
      <span><span class="adp-swatch adp-swatch--down"></span>Ra nhiều hơn vào (giảm)</span>
    </div>`;
}

function flowTable(days) {
  const columns = [
    { label: 'Ngày', cell: (row) => `<strong class="adp-strong">${escapeHtml(dayLabel(row.day))}</strong>` },
    { label: 'Quà khởi đầu', num: true, cell: (row) => signedIn(row.starter) },
    { label: 'Thưởng trận', num: true, cell: (row) => signedIn(row.gameRewards) },
    { label: 'Admin cộng', num: true, cell: (row) => signedIn(row.adminIn) },
    { label: 'Mua hòm, chìa', num: true, cell: (row) => signedOut(row.chestShop) },
    { label: 'Phí chợ', num: true, cell: (row) => signedOut(row.marketFees) },
    { label: 'Admin trừ', num: true, cell: (row) => signedOut(row.adminOut) },
    { label: 'Tăng / giảm', num: true, cell: (row) => `<strong>${signed(row.net)}</strong>` },
  ];
  // Newest first: the day that needs looking at is usually today.
  const rows = [...(days ?? [])].reverse();
  return tableHtml(columns, rows, { attrs: 'data-adp-flow', minWidth: 900 });
}

/** Counts as horizontal bars, each measured against the largest of its group. */
function countBars(rows, label) {
  const list = rows ?? [];
  if (!list.length) return '<p class="adp-muted">Chưa có.</p>';
  const biggest = Math.max(1, ...list.map((row) => Number(row.count) || 0));
  return `
    <ul class="adp-hbars">
      ${list.map((row) => `
        <li>
          <span class="adp-hbar-label">${escapeHtml(label(row.key))}</span>
          <span class="adp-hbar" aria-hidden="true"><span style="width: ${Math.max(2, ((Number(row.count) || 0) / biggest) * 100)}%"></span></span>
          <strong>${num(row.count)}</strong>
        </li>`).join('')}
    </ul>`;
}

function itemsNote(data, total) {
  const rarities = data.itemsByRarity ?? [];
  if (!total) return 'chưa có vật phẩm nào';
  if (rarities.length === 1) return `tất cả độ hiếm ${rarityName(rarities[0].key)}`;
  return `${num(rarities.length)} độ hiếm · ${num((data.itemsByCategory ?? []).length)} nhóm`;
}

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
      host.innerHTML = stateBox('empty', 'Chưa có số liệu.');
      return;
    }
    const totalItems = (data.itemsByRarity ?? []).reduce((sum, row) => sum + (Number(row.count) || 0), 0);
    const totals = data.totals;
    const totalLine = totals ? `
      <p class="adp-flow-total">Cả kỳ: vào <strong>${num(totals.starter + totals.gameRewards + totals.adminIn)} xu</strong>,
        ra <strong>${num(totals.chestShop + totals.marketFees + totals.adminOut)} xu</strong>,
        chênh lệch <strong>${signed(totals.net)} xu</strong>.</p>` : '';
    const toggle = `
      <div class="adm-seg adp-seg-sm" role="group" aria-label="Khoảng thời gian">
        ${[7, 30].map((value) => `<button type="button" data-days="${value}" aria-pressed="${value === days}"${value === days ? ' class="is-active"' : ''}>${value} ngày</button>`).join('')}
      </div>`;
    const richest = data.richest ?? [];

    host.innerHTML = `
      <div class="adm-grid adp-eco-kpis">
        ${kpiCard({ label: 'Xu đang lưu hành', value: num(data.coinsInCirculation), note: 'xu trong ví người chơi', iconName: '', dark: true })}
        ${kpiCard({ label: 'Xu giữ cho lệnh mua', value: num(data.coinsHeld), note: 'xu', iconName: '' })}
        ${kpiCard({ label: 'Vật phẩm đang có', value: num(totalItems), note: itemsNote(data, totalItems), iconName: '' })}
      </div>

      <div class="adp-eco-row">
        <section class="adm-card adp-flow-card" aria-labelledby="adp-flow-title">
          <div class="adm-card-head">
            <h2 class="adm-card-title" id="adp-flow-title">Xu vào và ra theo ngày</h2>
            ${toggle}
          </div>
          ${totalLine}
          ${flowChart(data.days)}
        </section>
        <section class="adm-card adp-items-card" aria-labelledby="adp-items-title">
          <h2 class="adm-card-title" id="adp-items-title">Vật phẩm đang có</h2>
          <h3 class="adp-mini-label">Theo độ hiếm</h3>
          ${countBars(data.itemsByRarity, rarityName)}
          <h3 class="adp-mini-label">Theo nhóm</h3>
          ${countBars(data.itemsByCategory, categoryName)}
        </section>
      </div>

      ${sectionCard({ id: 'adp-daily-title', title: 'Chi tiết theo ngày', body: flowTable(data.days) })}

      ${sectionCard({
    id: 'adp-rich-title',
    title: 'Người giàu nhất',
    body: richest.length ? tableHtml([
      { label: 'Hạng', className: 'adp-col-rank', cell: (_row, index) => `<span class="adp-rank${index < 3 ? ' adp-rank--top' : ''}">${num(index + 1)}</span>` },
      { label: 'Người chơi', cell: (row) => `<a class="adp-person-name" href="/admin/players/${encodeURIComponent(row.userId)}">${escapeHtml(row.fullName || row.userId)}</a>` },
      { label: 'Số dư', num: true, cell: (row) => `<strong class="adp-strong">${num(row.balance)} xu</strong>` },
      { label: 'Đang giữ', num: true, cell: (row) => `<span class="adp-muted">${num(row.held)} xu</span>` },
    ], richest, { minWidth: 560 }) : stateBox('empty', 'Chưa có ai có ví.'),
  })}`;
  };

  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-days]');
    if (!button || Number(button.dataset.days) === days) return;
    days = Number(button.dataset.days);
    writeRouteParams({ days: days === 30 ? '30' : '' });
    draw();
  }, { signal });

  host.innerHTML = stateBox('loading', 'Đang tải số liệu…');
  draw();
}
