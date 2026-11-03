import { marketApi } from '../../api/marketApi.js';
import { tr } from '../../services/i18n.js';
import { escapeHtml } from '../../utils/dom.js';
import { toast } from '../../utils/toast.js';
import {
  MAX_PRICE, MIN_PRICE, SLOT_CAP, categoryLabel, defName, errorText, feeFor, fmt, isEquippable, itemIcon, itemTile, rarityLabel, rarityOf, xu,
} from './marketKit.js';

/** BÁN: the 12-slot bag, equip one item per category ("ĐANG DÙNG"), list an item with the 5% fee shown live. */
export function mountSellTab(ctx) {
  const { panel, state } = ctx;
  const books = new Map();
  let seq = 0;

  panel.innerHTML = `
    <div class="bpa-mk-sell">
      <div class="bpa-mk-bag">
        <h2 class="bpa-mk-h2">${tr('Your bag', 'Túi đồ của bạn')}</h2>
        <p class="bpa-mk-sub" id="mk-bag-count">${tr('Opening your bag…', 'Đang mở túi đồ…')}</p>
        <div class="bpa-mk-grid" id="mk-grid" role="group" aria-label="${tr('Inventory', 'Túi đồ')}"></div>
      </div>
      <div class="bpa-mk-sellpanel" id="mk-sellpanel" aria-live="polite"></div>
    </div>`;

  const gridEl = panel.querySelector('#mk-grid');
  const countEl = panel.querySelector('#mk-bag-count');
  const sideEl = panel.querySelector('#mk-sellpanel');

  function selectedItem() {
    return state.inventory?.items.find((item) => item.itemId === state.selectedItemId) || null;
  }

  function renderGrid() {
    const inventory = state.inventory;
    const wallet = inventory.wallet;
    const reserved = wallet.reservedSlots || 0;
    countEl.innerHTML = `${tr('Pick an item to equip or sell', 'Chọn một vật phẩm để dùng hoặc rao bán trên chợ')} · <strong>${fmt(wallet.slotsUsed)}/${SLOT_CAP}</strong> ${tr('slots used', 'ô đã dùng')}${reserved
      ? tr(` (${reserved} held for buy orders)`, ` (${reserved} ô giữ cho lệnh mua)`) : ''}.`;
    const tiles = inventory.items.map((item) => {
      const rarity = rarityOf(item.def.rarity);
      const flag = item.equipped
        ? `<span class="bpa-mk-flag is-equipped">${tr('IN USE', 'ĐANG DÙNG')}</span>`
        : item.lockReason === 'LISTED' ? `<span class="bpa-mk-flag is-listed">${tr('FOR SALE', 'ĐANG RAO')}</span>`
          : item.lockReason === 'OPENING' ? `<span class="bpa-mk-flag is-listed">${tr('OPENING', 'ĐANG MỞ')}</span>`
            : item.locked ? `<span class="bpa-mk-flag is-listed">${tr('TRADING', 'ĐANG ĐỔI')}</span>` : '';
      return `
        <button type="button" class="bpa-mk-inv${item.locked ? ' is-locked' : ''}" data-item="${escapeHtml(item.itemId)}" aria-pressed="${item.itemId === state.selectedItemId}">
          ${flag}
          ${itemIcon(item.def, 56)}
          <span class="bpa-mk-invname">${escapeHtml(defName(item.def))}</span>
          <span class="bpa-sr">, ${escapeHtml(rarityLabel(item.def.rarity))}</span>
          <span class="bpa-mk-invbar" aria-hidden="true" style="background:${rarity.bar}"></span>
        </button>`;
    });
    const held = Array.from({ length: Math.min(reserved, Math.max(0, SLOT_CAP - inventory.items.length)) }, () =>
      `<span class="bpa-mk-slot is-held" aria-hidden="true">${tr('held', 'giữ chỗ')}</span>`);
    const empty = Array.from({ length: Math.max(0, SLOT_CAP - inventory.items.length - held.length) }, () =>
      '<span class="bpa-mk-slot" aria-hidden="true"></span>');
    gridEl.innerHTML = tiles.concat(held, empty).join('');
  }

  function defaultPrice(item, book) {
    if (book?.lowestAsk) return Math.max(MIN_PRICE, book.lowestAsk - 1);
    return Math.max(MIN_PRICE, item.def.referencePrice);
  }

  function renderPanel() {
    const item = selectedItem();
    if (!item) {
      sideEl.innerHTML = state.inventory.items.length
        ? `<p class="bpa-mk-empty">${tr('Pick an item in your bag.', 'Chọn một vật phẩm trong túi đồ.')}</p>`
        : `<p class="bpa-mk-empty">${tr('Your bag is empty — buy items on the BUY tab or receive them in a trade.', 'Túi đồ trống — hãy mua ở tab MUA hoặc nhận qua trao đổi.')}</p>`;
      return;
    }
    const book = books.get(item.def.id);
    const rarity = rarityOf(item.def.rarity);
    const price = state.price || defaultPrice(item, book);
    const bookLine = book
      ? tr(
        `Lowest ask now <strong>${book.lowestAsk != null ? xu(book.lowestAsk) : '—'}</strong> · highest bid <strong>${book.highestBid != null ? xu(book.highestBid) : '—'}</strong>.`,
        `Giá bán thấp nhất hiện tại <strong>${book.lowestAsk != null ? xu(book.lowestAsk) : '—'}</strong> · lệnh mua cao nhất <strong>${book.highestBid != null ? xu(book.highestBid) : '—'}</strong>.`)
      : tr('Checking the market…', 'Đang xem giá trên chợ…');
    const equip = item.locked || !isEquippable(item.def.category) ? ''
      : item.equipped
        ? `<div class="bpa-mk-equiprow"><span class="bpa-stamp bpa-stamp--teal bpa-mk-equipstamp">${tr('IN USE', 'ĐANG DÙNG')}</span><button type="button" class="bpa-btn bpa-btn--ink bpa-btn--sm" data-act="unequip">${tr('Stop using', 'Bỏ dùng')}</button></div>`
        : `<button type="button" class="bpa-btn bpa-btn--ink" data-act="equip">${tr('USE THIS ITEM', 'DÙNG VẬT PHẨM NÀY')}</button>`;
    let body;
    if (item.lockReason === 'LISTED') {
      body = `
        <p class="bpa-mk-sellstate">${tr(
    `For sale at <strong>${xu(item.listingPrice)}</strong> — you will receive ${xu((item.listingPrice || 0) - feeFor(item.listingPrice))}.`,
    `Đang rao bán với giá <strong>${xu(item.listingPrice)}</strong> — bạn sẽ nhận ${xu((item.listingPrice || 0) - feeFor(item.listingPrice))}.`)}</p>
        <button type="button" class="bpa-btn bpa-btn--ink bpa-btn--block" data-act="unlist" data-id="${escapeHtml(item.listingId || '')}">${tr('WITHDRAW', 'GỠ XUỐNG')}</button>`;
    } else if (item.locked) {
      body = `<p class="bpa-mk-sellstate">${tr('This item is inside a trade that is being completed.', 'Vật phẩm đang nằm trong một giao dịch đang hoàn tất.')}</p>`;
    } else if (item.def.tradable === false) {
      body = `<p class="bpa-mk-sellstate">${tr('This item was earned and cannot be sold or traded.', 'Vật phẩm này do bạn đạt được nên không bán hay trao đổi được.')}</p>`;
    } else {
      body = `
        <form class="bpa-mk-sellform" id="mk-sellform" novalidate>
          <div>
            <label for="mk-price" class="bpa-mk-label">${tr('BUYER PAYS (COINS)', 'NGƯỜI MUA TRẢ (XU)')}</label>
            <input id="mk-price" class="bpa-mk-field" type="number" inputmode="numeric" min="${MIN_PRICE}" max="${MAX_PRICE}" step="1" value="${price}">
          </div>
          <dl class="bpa-mk-fees">
            <div><dt>${tr('Market fee (5%)', 'Phí giao dịch (5%)')}</dt><dd class="bpa-mk-num">− <span id="mk-fee">${fmt(feeFor(price))}</span> xu</dd></div>
            <div class="is-total"><dt>${tr('You receive', 'Bạn nhận được')}</dt><dd class="bpa-mk-num"><span id="mk-receive">${fmt(Math.max(0, price - feeFor(price)))}</span> xu</dd></div>
          </dl>
          <p class="bpa-mk-instant" id="mk-instant" ${book?.highestBid != null && book.highestBid >= price ? '' : 'hidden'}>${book?.highestBid != null
    ? tr(`A buy order pays ${xu(book.highestBid)}: your item sells at once at that price.`, `Đang có lệnh mua ${xu(book.highestBid)}: vật phẩm sẽ bán ngay với giá đó.`) : ''}</p>
          <p class="bpa-mk-formerr" id="mk-sellerr" role="alert"></p>
          <button type="submit" class="bpa-btn bpa-btn--red bpa-btn--block bpa-mk-big">${tr('LIST FOR SALE', 'ĐĂNG BÁN')}</button>
          <p class="bpa-mk-note">${tr(
    'A listed item is locked: it cannot be used or traded until you withdraw it.',
    'Vật phẩm đang rao bán sẽ tạm khóa: không dùng hay trao đổi được cho tới khi bạn gỡ xuống.')}</p>
        </form>`;
    }
    sideEl.innerHTML = `
      <div class="bpa-mk-sellhead">
        ${itemTile(item.def, 64, 52)}
        <div><strong class="bpa-mk-sellname">${escapeHtml(defName(item.def))}</strong><span class="bpa-mk-rar is-${rarity.cls}">${escapeHtml(rarityLabel(item.def.rarity).toUpperCase())}</span> <span class="bpa-mk-mini">· ${escapeHtml(categoryLabel(item.def.category))}</span></div>
      </div>
      <p class="bpa-mk-bookline">${bookLine}</p>
      ${equip}
      ${body}`;
  }

  async function loadBook(defId) {
    if (books.has(defId)) return;
    try {
      const detail = await marketApi.item(defId);
      books.set(defId, { lowestAsk: detail.lowestAsk, highestBid: detail.highestBid });
    } catch {
      books.set(defId, { lowestAsk: null, highestBid: null });
    }
    if (ctx.isActive() && selectedItem()?.def.id === defId) renderPanel();
  }

  async function load() {
    const current = ++seq;
    let inventory;
    try {
      inventory = await marketApi.inventory();
    } catch (error) {
      if (current !== seq || !ctx.isActive()) return;
      countEl.textContent = errorText(error);
      return;
    }
    if (current !== seq || !ctx.isActive()) return;
    state.inventory = inventory;
    ctx.setWallet(inventory.wallet);
    if (!inventory.items.some((item) => item.itemId === state.selectedItemId)) {
      state.selectedItemId = inventory.items[0]?.itemId || null;
      state.price = '';
    }
    renderGrid();
    renderPanel();
    const item = selectedItem();
    if (item) loadBook(item.def.id);
  }

  function updateFees(input) {
    const price = Math.floor(Number(input.value) || 0);
    state.price = input.value === '' ? '' : price;
    const fee = feeFor(price);
    panel.querySelector('#mk-fee').textContent = fmt(fee);
    panel.querySelector('#mk-receive').textContent = fmt(Math.max(0, price - fee));
    const book = books.get(selectedItem()?.def.id);
    const instant = panel.querySelector('#mk-instant');
    if (instant) instant.hidden = !(book?.highestBid != null && price > 0 && book.highestBid >= price);
  }

  panel.addEventListener('input', (event) => {
    if (event.target.id === 'mk-price') updateFees(event.target);
  });

  panel.addEventListener('submit', (event) => {
    if (event.target.id !== 'mk-sellform') return;
    event.preventDefault();
    const item = selectedItem();
    const input = panel.querySelector('#mk-price');
    const errorEl = panel.querySelector('#mk-sellerr');
    const price = Number(input.value);
    errorEl.textContent = '';
    input.removeAttribute('aria-invalid');
    if (!item || !Number.isInteger(price) || price < MIN_PRICE || price > MAX_PRICE) {
      errorEl.textContent = tr(`Enter a whole number from ${MIN_PRICE} to 1,000,000.`, `Nhập số nguyên từ ${MIN_PRICE} đến 1.000.000.`);
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    const button = event.target.querySelector('button[type="submit"]');
    ctx.run(button, async () => {
      const result = await marketApi.createListing(item.itemId, price);
      ctx.setWallet(result.wallet);
      books.delete(item.def.id);
      state.price = '';
      toast(result.sale
        ? tr(`Sold at once to a buy order for ${fmt(result.sale.price)} coins (+${fmt(result.sale.net)}).`, `Đã bán ngay cho lệnh mua giá ${fmt(result.sale.price)} xu (+${fmt(result.sale.net)} xu).`)
        : tr(`Listed for ${fmt(price)} coins.`, `Đã đăng bán với giá ${fmt(price)} xu.`), 'success');
      await load();
    }, errorEl);
  });

  panel.addEventListener('click', (event) => {
    const tile = event.target.closest('[data-item]');
    if (tile) {
      state.selectedItemId = tile.dataset.item;
      state.price = '';
      gridEl.querySelectorAll('[data-item]').forEach((button) => button.setAttribute('aria-pressed', String(button === tile)));
      renderPanel();
      const item = selectedItem();
      if (item) loadBook(item.def.id);
      if (window.matchMedia('(max-width: 900px)').matches) sideEl.scrollIntoView({ behavior: ctx.reducedMotion ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    const action = event.target.closest('[data-act]');
    const item = selectedItem();
    if (!action || !item) return;
    if (action.dataset.act === 'equip') {
      ctx.run(action, async () => {
        state.inventory = await marketApi.equip(item.itemId);
        toast(tr(`Now using ${defName(item.def)}.`, `Đang dùng ${defName(item.def)}.`), 'success');
        renderGrid();
        renderPanel();
      });
    } else if (action.dataset.act === 'unequip') {
      ctx.run(action, async () => {
        state.inventory = await marketApi.unequip(item.def.category);
        renderGrid();
        renderPanel();
      });
    } else if (action.dataset.act === 'unlist') {
      ctx.run(action, async () => {
        await marketApi.cancelListing(action.dataset.id);
        books.delete(item.def.id);
        toast(tr('Listing withdrawn; the item is unlocked.', 'Đã gỡ tin rao bán, vật phẩm đã mở khóa.'), 'success');
        await load();
      });
    }
  });

  if (state.inventory) {
    renderGrid();
    renderPanel();
  }
  load();
  return { dispose() {} };
}
