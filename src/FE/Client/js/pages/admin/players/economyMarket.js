import { adminPlayersApi } from '../../../api/adminPlayersApi.js';
import { escapeHtml } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { defName, itemTile } from '../../market/marketKit.js';
import { tradesTable } from './playerDetail.js';
import { actionDialog, coins, dateTime, num, pagedList, playerLink, priceFlag, sectionCard, tableHtml, TRADE_STATUS } from './shared.js';

const itemCell = (def) => `
  <span class="adp-item">${itemTile(def, 36, 28)}<span class="adp-item-text"><strong>${escapeHtml(defName(def))}</strong><span class="adp-code">${escapeHtml(def.id)}</span></span></span>`;

const priceCell = (row) => `<strong class="adp-strong">${coins(row.price)}</strong>${priceFlag(row.priceFlag)}<br><span class="adp-muted">Tham chiếu ${num(row.referencePrice)}</span>`;

const dateCell = (iso) => `<span class="adp-date">${escapeHtml(dateTime(iso))}</span>`;

function priceFilters(prefix, userLabel) {
  return `
    <div class="adp-filter">
      <label class="field-label" for="${prefix}-def">Mã vật phẩm</label>
      <input class="field-input" id="${prefix}-def" name="defId">
    </div>
    <div class="adp-filter">
      <label class="field-label" for="${prefix}-user">${escapeHtml(userLabel)}</label>
      <input class="field-input" id="${prefix}-user" name="user" maxlength="100">
    </div>
    <div class="adp-filter adp-filter--num">
      <label class="field-label" for="${prefix}-min">Giá từ</label>
      <input class="field-input" id="${prefix}-min" name="minPrice" type="number" min="0" inputmode="numeric">
    </div>
    <div class="adp-filter adp-filter--num">
      <label class="field-label" for="${prefix}-max">Giá đến</label>
      <input class="field-input" id="${prefix}-max" name="maxPrice" type="number" min="0" inputmode="numeric">
    </div>`;
}

const formValues = (form) => Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, String(value).trim()]));

/** A card with a filter form above a server-paged list: submitting asks the server again from the first page. */
function filtered(host, { id, title, sub, headExtra = '', filterAttr, formHtml, listAttr, signal, ...options }) {
  host.insertAdjacentHTML('beforeend', sectionCard({
    id,
    title,
    sub,
    headExtra,
    body: `
      <form class="adp-filters" ${filterAttr}>${formHtml}<button class="btn btn-primary adp-filter-go" type="submit">Lọc</button></form>
      <div class="adp-rows" ${listAttr} aria-live="polite"></div>`,
  }));
  const form = host.querySelector(`[${filterAttr}]`);
  const body = host.querySelector(`[${listAttr}]`);
  const state = { filters: {} };
  const list = pagedList(body, {
    signal,
    ...options,
    load: (page) => options.load({ ...state.filters, page }),
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    state.filters = formValues(form);
    list.refresh(1);
  }, { signal });
  list.refresh();
  return { list, filters: () => state.filters };
}

/** What is for sale and what is being bid for, with the two things an admin can do about them. */
export function mountMarket(host, { signal }) {
  host.innerHTML = '';
  const listings = filtered(host, {
    signal,
    id: 'adp-listings-title',
    title: 'Tin rao đang mở',
    sub: 'Vật phẩm đang bán trên chợ. Gỡ tin thì vật phẩm về lại kho người bán.',
    filterAttr: 'data-adp-listings-filter',
    listAttr: 'data-adp-listings',
    formHtml: priceFilters('adp-ls', 'Người bán'),
    noun: 'tin rao',
    empty: 'Không có tin rao nào khớp bộ lọc này.',
    load: (filters) => adminPlayersApi.listings(filters),
    draw: (items) => tableHtml([
      { label: 'Vật phẩm', cell: (row) => itemCell(row.def) },
      { label: 'Giá', cell: priceCell },
      { label: 'Người bán', cell: (row) => playerLink(row.userId, row.userName) },
      { label: 'Đăng lúc', cell: (row) => dateCell(row.createdAt) },
      { label: 'Thao tác', className: 'adp-actions', cell: () => '<button class="btn btn-ghost btn-sm adm-btn-danger" type="button" data-act="remove">Gỡ</button>' },
    ], items, { minWidth: 820 }),
    actions: {
      remove: async (row) => {
        const answer = await actionDialog({
          signal,
          danger: true,
          title: `Gỡ tin rao ${defName(row.def)}`,
          message: `Tin rao ${coins(row.price)} của ${row.userName} bị hủy, vật phẩm về lại kho người bán.`,
          confirmLabel: 'Gỡ tin rao',
          submit: ({ reason }) => adminPlayersApi.removeListing(row.id, reason.trim()),
        });
        if (answer === null) return;
        toast('Đã gỡ tin rao.', 'success');
        listings.list.refresh();
      },
    },
  });

  const orders = filtered(host, {
    signal,
    id: 'adp-orders-title',
    title: 'Lệnh mua đang mở',
    sub: 'Người chơi đặt sẵn xu để mua. Hủy lệnh thì xu đang giữ được trả lại.',
    filterAttr: 'data-adp-orders-filter',
    listAttr: 'data-adp-orders',
    formHtml: priceFilters('adp-or', 'Người mua'),
    noun: 'lệnh mua',
    empty: 'Không có lệnh mua nào khớp bộ lọc này.',
    load: (filters) => adminPlayersApi.orders(filters),
    draw: (items) => tableHtml([
      { label: 'Vật phẩm', cell: (row) => itemCell(row.def) },
      { label: 'Giá', cell: priceCell },
      { label: 'Người mua', cell: (row) => playerLink(row.userId, row.userName) },
      { label: 'Đặt lúc', cell: (row) => dateCell(row.createdAt) },
      { label: 'Thao tác', className: 'adp-actions', cell: () => '<button class="btn btn-ghost btn-sm adm-btn-danger" type="button" data-act="cancel">Hủy lệnh</button>' },
    ], items, { minWidth: 820 }),
    actions: {
      cancel: async (row) => {
        const answer = await actionDialog({
          signal,
          danger: true,
          title: `Hủy lệnh mua ${defName(row.def)}`,
          message: `${coins(row.price)} đang giữ được trả lại cho ${row.userName}, cùng ô kho đã giữ chỗ.`,
          confirmLabel: 'Hủy lệnh mua',
          submit: ({ reason }) => adminPlayersApi.cancelOrder(row.id, reason.trim()),
        });
        if (answer === null) return;
        toast('Đã hủy lệnh mua và trả xu.', 'success');
        orders.list.refresh();
      },
    },
  });
  host.dataset.adpLoaded = 'true';
}

/** The whole market's past: sales, which can be exported with the same filter, and recent trade offers. */
export function mountHistory(host, { signal }) {
  host.innerHTML = '';
  const sales = filtered(host, {
    signal,
    id: 'adp-sales-title',
    title: 'Lịch sử bán',
    sub: 'Mọi lần bán trên chợ. Xuất CSV theo đúng bộ lọc bên dưới, tối đa 10.000 dòng mới nhất.',
    headExtra: '<button class="btn btn-ghost btn-sm" type="button" data-adp-export>Xuất CSV</button>',
    filterAttr: 'data-adp-sales-filter',
    listAttr: 'data-adp-sales',
    formHtml: `${priceFilters('adp-sa', 'Người mua hoặc bán')}
      <div class="adp-filter">
        <label class="field-label" for="adp-sa-from">Từ ngày</label>
        <input class="field-input" id="adp-sa-from" name="fromDay" type="date">
      </div>
      <div class="adp-filter">
        <label class="field-label" for="adp-sa-to">Đến ngày</label>
        <input class="field-input" id="adp-sa-to" name="toDay" type="date">
      </div>`,
    noun: 'giao dịch',
    empty: 'Không có giao dịch nào khớp bộ lọc này.',
    load: (filters) => adminPlayersApi.marketSales(salesQuery(filters)),
    draw: (items) => tableHtml([
      { label: 'Vật phẩm', cell: (row) => itemCell(row.def) },
      { label: 'Giá', cell: (row) => `<strong class="adp-strong">${coins(row.price)}</strong>${priceFlag(row.priceFlag)}<br><span class="adp-muted">Phí ${num(row.fee)}</span>` },
      { label: 'Người bán', cell: (row) => playerLink(row.sellerId, row.sellerName) },
      { label: 'Người mua', cell: (row) => playerLink(row.buyerId, row.buyerName) },
      { label: 'Lúc', cell: (row) => dateCell(row.at) },
    ], items, { minWidth: 820 }),
  });

  host.querySelector('[data-adp-export]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const blob = await adminPlayersApi.exportSales(salesQuery(sales.filters()));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `lich-su-ban-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast('Không xuất được CSV. Hãy thử lại.', 'error');
    }
    button.disabled = false;
  }, { signal });

  filtered(host, {
    signal,
    id: 'adp-trades-title',
    title: 'Đề nghị trao đổi gần đây',
    sub: 'Người chơi đổi đồ hoặc xu trực tiếp với nhau.',
    filterAttr: 'data-adp-trades-filter',
    listAttr: 'data-adp-trades',
    formHtml: `
      <div class="adp-filter">
        <label class="field-label" for="adp-tr-user">Một trong hai bên</label>
        <input class="field-input" id="adp-tr-user" name="user" maxlength="100">
      </div>
      <div class="adp-filter">
        <label class="field-label" for="adp-tr-status">Trạng thái đề nghị</label>
        <select class="field-input" id="adp-tr-status" name="status">
          <option value="">Mọi trạng thái</option>
          ${Object.entries(TRADE_STATUS).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('')}
        </select>
      </div>`,
    noun: 'đề nghị',
    empty: 'Chưa có đề nghị trao đổi nào.',
    load: (filters) => adminPlayersApi.marketTrades(filters),
    draw: (items) => tradesTable(items),
  });
  host.dataset.adpLoaded = 'true';
}

// Days on the players' calendar (UTC+7), sent as the UTC instants they start and end at.
function salesQuery({ fromDay, toDay, ...filters } = {}) {
  return {
    ...filters,
    from: fromDay ? new Date(`${fromDay}T00:00:00.000+07:00`).toISOString() : '',
    to: toDay ? new Date(`${toDay}T23:59:59.999+07:00`).toISOString() : '',
  };
}

