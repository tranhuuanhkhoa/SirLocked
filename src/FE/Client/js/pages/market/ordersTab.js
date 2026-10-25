import { marketApi } from '../../api/marketApi.js';
import { tr } from '../../services/i18n.js';
import { escapeHtml } from '../../utils/dom.js';
import { toast } from '../../utils/toast.js';
import { defName, errorText, itemTile, shortDate, signed, xu } from './marketKit.js';

/** LỆNH CỦA TÔI: my active listings and buy orders, and my recent sales and purchases. */
export function mountOrdersTab(ctx) {
  const { panel, state } = ctx;
  panel.innerHTML = `<div class="bpa-mk-orders" id="mk-orders"><p class="bpa-mk-wait">${tr('Opening your ledger…', 'Đang mở sổ của bạn…')}</p></div>`;
  const box = panel.querySelector('#mk-orders');

  const itemCell = (def) => `<span class="bpa-mk-cellitem">${itemTile(def, 36, 28)}<span>${escapeHtml(defName(def))}</span></span>`;

  function render() {
    const mine = state.mine;
    const listings = mine.listings.map((listing) => `
      <tr>
        <td>${itemCell(listing.def)}</td>
        <td class="bpa-mk-num">${xu(listing.price)}</td>
        <td class="bpa-mk-num is-teal bpa-mk-hide-sm">${xu(listing.proceeds)}</td>
        <td class="bpa-mk-hide-sm">${escapeHtml(shortDate(listing.createdAt))}</td>
        <td class="bpa-mk-right">${listing.status === 'ACTIVE'
    ? `<button type="button" class="bpa-btn bpa-btn--ink bpa-btn--sm" data-act="unlist" data-id="${escapeHtml(listing.listingId)}">${tr('Withdraw', 'Gỡ xuống')}<span class="bpa-sr"> ${escapeHtml(defName(listing.def))}</span></button>`
    : `<span class="bpa-mk-mini">${tr('selling…', 'đang bán…')}</span>`}</td>
      </tr>`).join('');
    const orders = mine.orders.map((order) => `
      <tr>
        <td>${itemCell(order.def)}</td>
        <td class="bpa-mk-num">${xu(order.price)}</td>
        <td class="bpa-mk-num is-rust bpa-mk-hide-sm">${xu(order.price)}</td>
        <td class="bpa-mk-hide-sm">${escapeHtml(shortDate(order.createdAt))}</td>
        <td class="bpa-mk-right">${order.status === 'ACTIVE'
    ? `<button type="button" class="bpa-btn bpa-btn--ink bpa-btn--sm" data-act="cancel-order" data-id="${escapeHtml(order.orderId)}">${tr('Cancel', 'Hủy lệnh')}<span class="bpa-sr"> ${escapeHtml(defName(order.def))}</span></button>`
    : `<span class="bpa-mk-mini">${tr('filling…', 'đang khớp…')}</span>`}</td>
      </tr>`).join('');
    const history = mine.history.map((sale) => `
      <tr>
        <td class="bpa-mk-when">${escapeHtml(shortDate(sale.at))}</td>
        <td>${itemCell(sale.def)}</td>
        <td><span class="bpa-mk-status ${sale.role === 'SOLD' ? 'is-ok' : 'is-muted'}">${sale.role === 'SOLD' ? tr('Sold', 'Bán') : tr('Bought', 'Mua')}</span></td>
        <td class="bpa-mk-num bpa-mk-hide-sm">${xu(sale.price)}</td>
        <td class="bpa-mk-num bpa-mk-hide-sm">${sale.role === 'SOLD' ? `− ${xu(sale.fee)}` : '—'}</td>
        <td class="bpa-mk-num bpa-mk-right ${sale.net >= 0 ? 'is-teal' : 'is-red'}">${signed(sale.net)} xu</td>
      </tr>`).join('');
    box.innerHTML = `
      <section aria-labelledby="mk-ol-h">
        <h2 class="bpa-mk-h2" id="mk-ol-h">${tr('Your listings', 'Đang rao bán')}</h2>
        ${listings ? `<table class="bpa-mk-table"><thead><tr><th>${tr('ITEM', 'VẬT PHẨM')}</th><th>${tr('PRICE', 'GIÁ')}</th><th class="bpa-mk-hide-sm">${tr('YOU GET', 'BẠN NHẬN')}</th><th class="bpa-mk-hide-sm">${tr('LISTED', 'NGÀY ĐĂNG')}</th><th><span class="bpa-sr">${tr('Actions', 'Thao tác')}</span></th></tr></thead><tbody>${listings}</tbody></table>`
    : `<p class="bpa-mk-empty">${tr('Nothing for sale. List an item from the SELL tab.', 'Bạn chưa rao bán gì. Hãy đăng bán ở tab BÁN.')}</p>`}
      </section>
      <section aria-labelledby="mk-oo-h">
        <h2 class="bpa-mk-h2" id="mk-oo-h">${tr('Your buy orders', 'Lệnh mua đang chờ')}</h2>
        ${orders ? `<table class="bpa-mk-table"><thead><tr><th>${tr('ITEM', 'VẬT PHẨM')}</th><th>${tr('PRICE', 'GIÁ')}</th><th class="bpa-mk-hide-sm">${tr('HELD', 'ĐANG GIỮ')}</th><th class="bpa-mk-hide-sm">${tr('PLACED', 'NGÀY ĐẶT')}</th><th><span class="bpa-sr">${tr('Actions', 'Thao tác')}</span></th></tr></thead><tbody>${orders}</tbody></table>`
    : `<p class="bpa-mk-empty">${tr('No open buy orders. Place one from an item on the BUY tab.', 'Chưa có lệnh mua nào. Hãy đặt lệnh từ một vật phẩm ở tab MUA.')}</p>`}
      </section>
      <section aria-labelledby="mk-oh-h">
        <h2 class="bpa-mk-h2" id="mk-oh-h">${tr('Recent trades', 'Lịch sử giao dịch')}</h2>
        ${history ? `<table class="bpa-mk-table"><thead><tr><th>${tr('WHEN', 'THỜI GIAN')}</th><th>${tr('ITEM', 'VẬT PHẨM')}</th><th>${tr('TYPE', 'LOẠI')}</th><th class="bpa-mk-hide-sm">${tr('PRICE', 'GIÁ')}</th><th class="bpa-mk-hide-sm">${tr('FEE', 'PHÍ')}</th><th class="bpa-mk-right">${tr('WALLET', 'VÍ')}</th></tr></thead><tbody>${history}</tbody></table>`
    : `<p class="bpa-mk-empty">${tr('No sales or purchases yet.', 'Chưa có giao dịch mua bán nào.')}</p>`}
      </section>`;
  }

  async function load() {
    try {
      const mine = await marketApi.mine();
      if (!ctx.isActive()) return;
      state.mine = mine;
      render();
    } catch (error) {
      if (ctx.isActive()) box.innerHTML = `<p class="bpa-mk-empty" role="alert">${escapeHtml(errorText(error))}</p>`;
    }
  }

  panel.addEventListener('click', (event) => {
    const action = event.target.closest('[data-act]');
    if (!action) return;
    if (action.dataset.act === 'unlist') {
      ctx.run(action, async () => {
        await marketApi.cancelListing(action.dataset.id);
        toast(tr('Listing withdrawn; the item is back in your bag.', 'Đã gỡ tin rao bán, vật phẩm đã về túi đồ.'), 'success');
        await Promise.all([load(), ctx.refreshWallet()]);
      });
    } else if (action.dataset.act === 'cancel-order') {
      ctx.run(action, async () => {
        await marketApi.cancelOrder(action.dataset.id);
        toast(tr('Buy order cancelled; the coins are back in your wallet.', 'Đã hủy lệnh mua, xu đã trả về ví.'), 'success');
        await Promise.all([load(), ctx.refreshWallet()]);
      });
    }
  });

  if (state.mine) render();
  load();
  return { dispose() {} };
}
