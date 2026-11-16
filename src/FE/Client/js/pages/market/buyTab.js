import { marketApi } from '../../api/marketApi.js';
import { tr } from '../../services/i18n.js';
import { escapeHtml } from '../../utils/dom.js';
import { toast } from '../../utils/toast.js';
import {
  CATEGORIES, MAX_PRICE, MIN_PRICE, RARITIES, categoryLabel, changeText, defDescription, defName, errorText, fmt,
  itemIcon, itemTile, priceChart, rarityLabel, rarityOf, sparkline, xu,
} from './marketKit.js';

const SEARCH_ICON = '<svg class="bpa-mk-searchicon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b5248" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/></svg>';
const RARITY_DIAMOND = { COMMON: '#a39885', RARE: '#4f9a9a', EPIC: '#7a62b8', LEGENDARY: '#c7a24b', MYSTERY: '#E8B53A' };

const SORTS = [
  ['popular', 'Popular', 'Phổ biến'],
  ['price_asc', 'Price: low to high', 'Giá: thấp → cao'],
  ['price_desc', 'Price: high to low', 'Giá: cao → thấp'],
  ['rarity', 'Rarity', 'Độ hiếm'],
  ['name', 'Name', 'Tên A–Z'],
];

/** Rows of the ledger per page: the server cuts the sorted list, so only one page of rows and sparklines travels. */
export const PAGE_SIZE = 12;

/**
 * The page numbers to show, with `null` for a gap: always the first and the last page, the current one and `near`
 * pages on each side. Near either end the window grows instead, so the row of buttons keeps its length and a gap
 * never hides a single page.
 */
export function pageList(current, total, near = 1) {
  const width = 2 * near + 1;
  if (total <= width + 4) return Array.from({ length: total }, (_, index) => index + 1);
  let from = Math.max(2, current - near);
  let to = Math.min(total - 1, current + near);
  if (from <= 3) {
    from = 2;
    to = Math.max(to, width + 2);
  }
  if (to >= total - 2) {
    to = total - 1;
    from = Math.min(from, total - width - 1);
  }
  const pages = [1];
  if (from > 2) pages.push(null);
  for (let page = from; page <= to; page += 1) pages.push(page);
  if (to < total - 1) pages.push(null);
  pages.push(total);
  return pages;
}

/** MUA: categories, rarity filter, search, sort, the ledger of item types (one page at a time) and the item detail with its chart. */
export function mountBuyTab(ctx) {
  const { panel, state } = ctx;
  let searchTimer = 0;
  let browseSeq = 0;
  let detailSeq = 0;
  let pageCount = 1;
  let pagerFocus = null;

  panel.innerHTML = `
    <div class="bpa-mk-buy">
      <div class="bpa-mk-side">
        <div class="bpa-mk-searchwrap">
          ${SEARCH_ICON}
          <label for="mk-q" class="bpa-sr">${tr('Search items', 'Tìm vật phẩm')}</label>
          <input id="mk-q" class="bpa-mk-search" type="search" placeholder="${tr('Search items…', 'Tìm vật phẩm…')}" autocomplete="off" maxlength="60" value="${escapeHtml(state.q)}">
        </div>
        <div>
          <h3 class="bpa-mk-sidehead" id="mk-cat-h">${tr('CATEGORIES', 'DANH MỤC')}</h3>
          <div class="bpa-mk-cats" id="mk-cats" role="group" aria-labelledby="mk-cat-h"></div>
        </div>
        <fieldset class="bpa-mk-rarities">
          <legend class="bpa-mk-sidehead">${tr('RARITY', 'ĐỘ HIẾM')}</legend>
          ${RARITIES.map((rarity) => `
            <label class="bpa-mk-check"><input type="checkbox" data-rarity="${rarity}" ${state.rarities.has(rarity) ? 'checked' : ''}><span class="bpa-mk-diamond" aria-hidden="true" style="background:${RARITY_DIAMOND[rarity]}"></span>${rarityLabel(rarity)}</label>`).join('')}
        </fieldset>
      </div>

      <div class="bpa-mk-listcol">
        <div class="bpa-mk-listhead">
          <h2 class="bpa-mk-h2">${tr('For sale', 'Đang rao bán')}</h2>
          <label class="bpa-mk-sort"><span>${tr('SORT', 'SẮP XẾP')}:</span>
            <select id="mk-sort">${SORTS.map(([value, en, vi]) => `<option value="${value}" ${state.sort === value ? 'selected' : ''}>${tr(en, vi)}</option>`).join('')}</select>
          </label>
        </div>
        <div class="bpa-mk-th" aria-hidden="true"><span></span><span>${tr('ITEM', 'VẬT PHẨM')}</span><span class="bpa-mk-hide-sm">${tr('RARITY', 'ĐỘ HIẾM')}</span><span class="bpa-mk-hide-sm">${tr('LISTED', 'ĐANG BÁN')}</span><span>${tr('FROM', 'GIÁ TỪ')}</span><span class="bpa-mk-hide-sm">${tr('10 DAYS', '10 NGÀY')}</span></div>
        <ul class="bpa-mk-rows" id="mk-rows" aria-busy="true"><li class="bpa-mk-wait">${tr('Opening the ledger…', 'Đang mở sổ giao dịch…')}</li></ul>
        <nav class="bpa-mk-pager" id="mk-pager" aria-label="${tr('Pages', 'Phân trang')}" hidden>
          <p class="bpa-mk-pageinfo" id="mk-pageinfo" aria-live="polite"></p>
          <div class="bpa-mk-pages" id="mk-pages"></div>
        </nav>
      </div>

      <aside class="bpa-mk-detail" id="mk-detail" aria-label="${tr('Item details', 'Chi tiết vật phẩm')}"></aside>
    </div>`;

  const rowsEl = panel.querySelector('#mk-rows');
  const catsEl = panel.querySelector('#mk-cats');
  const detailEl = panel.querySelector('#mk-detail');
  const pagerEl = panel.querySelector('#mk-pager');
  const pageInfoEl = panel.querySelector('#mk-pageinfo');
  const pagesEl = panel.querySelector('#mk-pages');

  function renderCategories(browse) {
    const counts = browse?.categoryCounts || {};
    const entries = [['', tr('All', 'Tất cả'), browse?.totalCount ?? '']]
      .concat(CATEGORIES.map((category) => [category, categoryLabel(category), counts[category] ?? '']));
    catsEl.innerHTML = entries.map(([key, label, count]) => `
      <button type="button" class="bpa-mk-cat" data-category="${key}" aria-pressed="${state.category === key}">
        <span>${escapeHtml(label)}</span><span>${count}</span>
      </button>`).join('');
  }

  function rowMarkup(row) {
    const def = row.def;
    const rarity = rarityOf(def.rarity);
    return `
      <li>
        <button type="button" class="bpa-mk-row" data-def="${escapeHtml(def.id)}" aria-pressed="${state.selectedDef === def.id}">
          ${itemTile(def, 42, 34)}
          <span class="bpa-mk-rowname"><strong>${escapeHtml(defName(def))}</strong><span>${escapeHtml(categoryLabel(def.category))}</span></span>
          <span class="bpa-mk-rar is-${rarity.cls} bpa-mk-hide-sm">${escapeHtml(rarityLabel(def.rarity).toUpperCase())}</span>
          <span class="bpa-mk-num is-soft bpa-mk-hide-sm"><span class="bpa-sr">${tr('Listed:', 'Đang bán:')} </span>${fmt(row.listedCount)}</span>
          <span class="bpa-mk-num">${row.lowestAsk != null ? xu(row.lowestAsk) : '—'}</span>
          <span class="bpa-mk-hide-sm">${sparkline(row.spark10)}</span>
        </button>
      </li>`;
  }

  function renderRows(browse) {
    rowsEl.removeAttribute('aria-busy');
    if (!browse.rows.length) {
      rowsEl.innerHTML = `<li class="bpa-mk-empty">${tr('No item matches this search.', 'Không có vật phẩm nào khớp tìm kiếm.')}</li>`;
      return;
    }
    rowsEl.innerHTML = browse.rows.map(rowMarkup).join('');
  }

  function pagerButton(key, label, content, { disabled = false, current = false } = {}) {
    return `<button type="button" class="bpa-mk-pg" data-page="${key}" aria-label="${escapeHtml(label)}"${current ? ' aria-current="page"' : ''}${disabled ? ' disabled' : ''}>${content}</button>`;
  }

  /** An older server, or a mocked one, sends no paging fields: then everything is one page and the pager stays hidden. */
  function renderPager(browse) {
    const size = browse.pageSize > 0 ? browse.pageSize : 0;
    const matches = browse.matchCount ?? browse.rows.length;
    pageCount = size ? Math.max(1, Math.ceil(matches / size)) : 1;
    const current = Math.min(Math.max(1, browse.page || 1), pageCount);
    pagerEl.hidden = pageCount <= 1;
    if (pageCount <= 1) {
      pagesEl.innerHTML = '';
      pageInfoEl.textContent = '';
      return;
    }
    const first = (current - 1) * size + 1;
    const last = first + browse.rows.length - 1;
    pageInfoEl.textContent = tr(`${fmt(first)}–${fmt(last)} of ${fmt(matches)} items`, `${fmt(first)}–${fmt(last)} trên ${fmt(matches)} vật phẩm`);
    const near = window.matchMedia('(max-width: 480px)').matches ? 0 : 1;
    pagesEl.innerHTML = [
      pagerButton('prev', tr('Previous page', 'Trang trước'), '<span aria-hidden="true">‹</span>', { disabled: current <= 1 }),
      ...pageList(current, pageCount, near).map((page) => (page == null
        ? '<span class="bpa-mk-pggap" aria-hidden="true">…</span>'
        : pagerButton(page, tr(`Page ${page}`, `Trang ${page}`), String(page), { current: page === current }))),
      pagerButton('next', tr('Next page', 'Trang sau'), '<span aria-hidden="true">›</span>', { disabled: current >= pageCount }),
    ].join('');
    // The clicked button was replaced: put the focus back on its successor, or on the current page once it is disabled.
    if (pagerFocus && (document.activeElement === document.body || pagerEl.contains(document.activeElement))) {
      const target = pagesEl.querySelector(`[data-page="${pagerFocus}"]:not(:disabled)`) || pagesEl.querySelector('[aria-current="page"]');
      target?.focus({ preventScroll: true });
    }
    pagerFocus = null;
  }

  function goToPage(key) {
    const target = key === 'prev' ? state.page - 1 : key === 'next' ? state.page + 1 : Number(key);
    if (!Number.isInteger(target) || target < 1 || target > pageCount || target === state.page) return;
    state.page = target;
    pagerFocus = key;
    loadBrowse({ keepDetail: true, keepSelection: true });
    // From the pager under a long list, the new page starts above the screen.
    const head = panel.querySelector('.bpa-mk-listhead');
    if (head && head.getBoundingClientRect().top < 0) {
      head.scrollIntoView({ behavior: ctx.reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }

  /**
   * keepSelection: the item in the detail stays even when it is not on this page (turning pages, re-sorting,
   * refreshing after a trade). A new search or filter still moves the detail to its first match.
   */
  async function loadBrowse({ keepDetail = false, keepSelection = false } = {}) {
    const seq = ++browseSeq;
    let browse;
    rowsEl.setAttribute('aria-busy', 'true');
    try {
      browse = await marketApi.browse({
        q: state.q, category: state.category, rarities: [...state.rarities], sort: state.sort, page: state.page, pageSize: PAGE_SIZE,
      });
    } catch (error) {
      if (seq !== browseSeq || !ctx.isActive()) return;
      rowsEl.removeAttribute('aria-busy');
      rowsEl.innerHTML = `<li class="bpa-mk-empty" role="alert">${escapeHtml(errorText(error))}</li>`;
      return;
    }
    if (seq !== browseSeq || !ctx.isActive()) return;
    state.browse = browse;
    // The server answers with the last page when the one asked for no longer exists.
    if (browse.page > 0) state.page = browse.page;
    renderCategories(browse);
    if (!browse.rows.some((row) => row.def.id === state.selectedDef) && !(keepSelection && state.selectedDef)) {
      state.selectedDef = browse.rows[0]?.def.id || null;
    }
    renderRows(browse);
    renderPager(browse);
    if (state.selectedDef) {
      if (!keepDetail || state.detail?.def.id !== state.selectedDef) loadDetail(state.selectedDef);
      else renderDetail(state.detail);
    } else {
      detailEl.innerHTML = '';
    }
  }

  async function loadDetail(defId, { animate = true } = {}) {
    const seq = ++detailSeq;
    if (!state.detail || state.detail.def.id !== defId) {
      detailEl.setAttribute('aria-busy', 'true');
    }
    let detail;
    try {
      detail = await marketApi.item(defId);
    } catch (error) {
      if (seq !== detailSeq || !ctx.isActive()) return;
      detailEl.removeAttribute('aria-busy');
      detailEl.innerHTML = `<p class="bpa-mk-empty" role="alert">${escapeHtml(errorText(error))}</p>`;
      return;
    }
    if (seq !== detailSeq || !ctx.isActive()) return;
    state.detail = detail;
    renderDetail(detail, animate);
  }

  function buyableListing(detail) {
    return detail.listings.find((listing) => !listing.isMine) || null;
  }

  function renderDetail(detail, animate = false) {
    const def = detail.def;
    const rarity = rarityOf(def.rarity);
    const history = detail.history;
    const change = changeText(history.changePercent);
    const buyable = buyableListing(detail);
    const ownOnly = !buyable && detail.listings.length > 0;
    const name = defName(def);
    const bidDefault = Math.max(MIN_PRICE, detail.highestBid ? detail.highestBid + 1 : Math.round((buyable?.price ?? def.referencePrice) * 0.9));
    state.detailFlip = animate ? !state.detailFlip : state.detailFlip;
    detailEl.removeAttribute('aria-busy');
    detailEl.className = `bpa-mk-detail${animate ? (state.detailFlip ? ' bpa-mk-pop-b' : ' bpa-mk-pop-a') : ''}`;
    detailEl.innerHTML = `
      <div class="bpa-mk-hero is-${rarity.cls}">
        ${itemIcon(def, 120)}
        <span class="bpa-mk-herotag" style="color:${rarity.marker}">${escapeHtml(rarityLabel(def.rarity).toUpperCase())}</span>
        ${detail.ownedCount ? `<span class="bpa-mk-owned">${tr(`YOU OWN ${detail.ownedCount}`, `BẠN CÓ ${detail.ownedCount}`)}</span>` : ''}
      </div>
      <div>
        <h2 class="bpa-mk-dname">${escapeHtml(name)}</h2>
        <p class="bpa-mk-ddesc">${escapeHtml(defDescription(def))}</p>
      </div>
      <div class="bpa-mk-chartbox">
        <div class="bpa-mk-charthead"><span>${tr('30-DAY PRICE', 'GIÁ 30 NGÀY')}</span><span class="${change.up ? 'is-up' : 'is-down'}">${change.text}</span></div>
        ${priceChart(history.line, tr(`Price chart for the last 30 days: low ${fmt(history.low)}, high ${fmt(history.high)}`, `Biểu đồ giá 30 ngày qua: thấp ${fmt(history.low)}, cao ${fmt(history.high)}`))}
        <div class="bpa-mk-chartfoot"><span>${tr('30 days ago', '30 ngày trước')}</span><span>${history.volume
    ? tr(`low ${fmt(history.low)} · high ${fmt(history.high)}`, `thấp ${fmt(history.low)} · cao ${fmt(history.high)}`)
    : tr('no sales yet', 'chưa có giao dịch')}</span><span>${tr('today', 'hôm nay')}</span></div>
      </div>
      <dl class="bpa-mk-book">
        <div class="is-ask"><dt>${tr('LOWEST ASK', 'GIÁ BÁN THẤP NHẤT')}</dt><dd class="bpa-mk-bookprice">${detail.lowestAsk != null ? xu(detail.lowestAsk) : '—'}</dd><dd>${tr(`${fmt(detail.listedCount)} for sale`, `${fmt(detail.listedCount)} đang bán`)}</dd></div>
        <div class="is-bid"><dt>${tr('HIGHEST BID', 'LỆNH MUA CAO NHẤT')}</dt><dd class="bpa-mk-bookprice">${detail.highestBid != null ? xu(detail.highestBid) : '—'}</dd><dd>${tr(`${fmt(detail.bidCount)} waiting`, `${fmt(detail.bidCount)} lệnh chờ`)}</dd></div>
      </dl>
      <button type="button" class="bpa-btn bpa-btn--red bpa-btn--block bpa-mk-buynow" data-act="buy-now" ${buyable ? '' : 'disabled'}>
        ${buyable
    ? tr(`BUY NOW · ${fmt(buyable.price)} COINS`, `MUA NGAY · ${fmt(buyable.price)} XU`)
    : ownOnly ? tr('ONLY YOUR OWN LISTINGS', 'CHỈ CÓ HÀNG CỦA BẠN') : tr('NOTHING FOR SALE YET', 'CHƯA CÓ AI RAO BÁN')}
      </button>
      <div class="bpa-mk-two">
        <button type="button" class="bpa-btn bpa-btn--ink" data-act="bid-toggle" aria-expanded="${state.bidOpen}" aria-controls="mk-bidform">${tr('PLACE BUY ORDER', 'ĐẶT LỆNH MUA')}</button>
        <button type="button" class="bpa-btn bpa-btn--ink" data-act="to-trade">${tr('OFFER A TRADE', 'ĐỀ NGHỊ ĐỔI')}</button>
      </div>
      <form class="bpa-mk-bidform" id="mk-bidform" ${state.bidOpen ? '' : 'hidden'} novalidate>
        <label for="mk-bidprice" class="bpa-mk-label">${tr('YOU PAY (COINS)', 'GIÁ BẠN TRẢ (XU)')}</label>
        <input id="mk-bidprice" class="bpa-mk-field" type="number" inputmode="numeric" min="${MIN_PRICE}" max="${MAX_PRICE}" step="1" value="${bidDefault}">
        <p class="bpa-mk-note">${tr(
    'The coins are held until the order fills or you cancel it. A listing at or below your price sells to you at once.',
    'Số xu được giữ lại cho tới khi lệnh khớp hoặc bạn hủy. Ai rao bán bằng hoặc thấp hơn giá này sẽ bán ngay cho bạn.',
  )}</p>
        <p class="bpa-mk-formerr" id="mk-biderr" role="alert"></p>
        <button type="submit" class="bpa-btn bpa-btn--red bpa-btn--block">${tr('PLACE ORDER', 'ĐẶT LỆNH')}</button>
      </form>
      ${mineMarkup(detail)}
      ${bookMarkup(detail)}`;
  }

  function mineMarkup(detail) {
    if (!detail.myListings.length && !detail.myOrders.length) return '';
    return `
      <div class="bpa-mk-minebox">
        <p class="bpa-mk-label">${tr('YOURS', 'CỦA BẠN')}</p>
        <ul class="bpa-mk-minelist">
          ${detail.myListings.map((listing) => `
            <li><span>${tr('For sale at', 'Đang bán giá')} <strong class="bpa-mk-num">${xu(listing.price)}</strong></span>
              ${listing.status === 'ACTIVE' ? `<button type="button" class="bpa-btn bpa-btn--ink bpa-btn--sm" data-act="unlist" data-id="${escapeHtml(listing.listingId)}">${tr('Withdraw', 'Gỡ xuống')}</button>` : `<span class="bpa-mk-mini">${tr('selling…', 'đang bán…')}</span>`}</li>`).join('')}
          ${detail.myOrders.map((order) => `
            <li><span>${tr('Buy order at', 'Lệnh mua giá')} <strong class="bpa-mk-num">${xu(order.price)}</strong></span>
              ${order.status === 'ACTIVE' ? `<button type="button" class="bpa-btn bpa-btn--ink bpa-btn--sm" data-act="cancel-order" data-id="${escapeHtml(order.orderId)}">${tr('Cancel', 'Hủy lệnh')}</button>` : `<span class="bpa-mk-mini">${tr('filling…', 'đang khớp…')}</span>`}</li>`).join('')}
        </ul>
      </div>`;
  }

  function bookMarkup(detail) {
    const listings = detail.listings.slice(0, 5);
    const bids = detail.bids.slice(0, 5);
    if (!listings.length && !bids.length) return '';
    return `
      <div class="bpa-mk-orderbook">
        <div>
          <p class="bpa-mk-label is-teal">${tr('LISTINGS', 'TIN RAO BÁN')}</p>
          ${listings.length ? `<ul>${listings.map((listing) => `
            <li><span class="bpa-mk-num">${xu(listing.price)}</span>
              ${listing.isMine
    ? `<span class="bpa-mk-mini">${tr('yours', 'của bạn')}</span>`
    : `<button type="button" class="bpa-mk-buyone" data-act="buy-listing" data-id="${escapeHtml(listing.listingId)}" data-price="${listing.price}">${tr('Buy', 'Mua')}<span class="bpa-sr"> ${xu(listing.price)}</span></button>`}</li>`).join('')}</ul>`
    : `<p class="bpa-mk-mini">${tr('none', 'chưa có')}</p>`}
        </div>
        <div>
          <p class="bpa-mk-label is-rust">${tr('BUY ORDERS', 'LỆNH MUA')}</p>
          ${bids.length ? `<ul>${bids.map((bid) => `<li><span class="bpa-mk-num">${xu(bid.price)}</span><span class="bpa-mk-mini">× ${fmt(bid.count)}</span></li>`).join('')}</ul>`
    : `<p class="bpa-mk-mini">${tr('none', 'chưa có')}</p>`}
        </div>
      </div>`;
  }

  async function refreshAfterTrade() {
    await Promise.all([loadBrowse({ keepDetail: true, keepSelection: true }), state.selectedDef ? loadDetail(state.selectedDef, { animate: false }) : null, ctx.refreshWallet()]);
  }

  // ----- events

  panel.addEventListener('input', (event) => {
    if (event.target.id === 'mk-q') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const q = event.target.value.trim();
        if (q === state.q) return;
        state.q = q;
        state.page = 1;
        loadBrowse();
      }, 250);
    }
  });

  panel.addEventListener('change', (event) => {
    const rarity = event.target.dataset?.rarity;
    if (rarity) {
      if (event.target.checked) state.rarities.add(rarity);
      else state.rarities.delete(rarity);
      state.page = 1;
      loadBrowse();
    } else if (event.target.id === 'mk-sort') {
      state.sort = event.target.value;
      state.page = 1;
      loadBrowse({ keepDetail: true, keepSelection: true });
    }
  });

  panel.addEventListener('submit', (event) => {
    if (event.target.id !== 'mk-bidform') return;
    event.preventDefault();
    const detail = state.detail;
    const input = panel.querySelector('#mk-bidprice');
    const errorEl = panel.querySelector('#mk-biderr');
    const price = Number(input.value);
    errorEl.textContent = '';
    input.removeAttribute('aria-invalid');
    if (!Number.isInteger(price) || price < MIN_PRICE || price > MAX_PRICE) {
      errorEl.textContent = tr(`Enter a whole number from ${MIN_PRICE} to 1,000,000.`, `Nhập số nguyên từ ${MIN_PRICE} đến 1.000.000.`);
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    if (state.wallet && price > state.wallet.balance) {
      errorEl.textContent = tr(`You have ${fmt(state.wallet.balance)} coins.`, `Bạn chỉ có ${fmt(state.wallet.balance)} xu.`);
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    const button = event.target.querySelector('button[type="submit"]');
    ctx.run(button, async () => {
      const result = await marketApi.placeOrder(detail.def.id, price);
      ctx.setWallet(result.wallet);
      state.bidOpen = false;
      toast(result.sale
        ? tr(`Filled at once: bought for ${fmt(result.sale.price)} coins.`, `Khớp ngay: đã mua với giá ${fmt(result.sale.price)} xu.`)
        : tr(`Buy order placed at ${fmt(price)} coins. The coins are held until it fills.`, `Đã đặt lệnh mua ${fmt(price)} xu. Số xu được giữ cho tới khi khớp lệnh.`), 'success');
      await refreshAfterTrade();
    }, errorEl);
  });

  panel.addEventListener('click', (event) => {
    const pageButton = event.target.closest('[data-page]');
    if (pageButton) {
      if (!pageButton.disabled) goToPage(pageButton.dataset.page);
      return;
    }
    const category = event.target.closest('[data-category]');
    if (category) {
      state.category = category.dataset.category;
      state.page = 1;
      catsEl.querySelectorAll('[data-category]').forEach((button) => button.setAttribute('aria-pressed', String(button === category)));
      loadBrowse();
      return;
    }
    const row = event.target.closest('[data-def]');
    if (row) {
      state.selectedDef = row.dataset.def;
      state.bidOpen = false;
      rowsEl.querySelectorAll('[data-def]').forEach((button) => button.setAttribute('aria-pressed', String(button === row)));
      loadDetail(row.dataset.def);
      if (window.matchMedia('(max-width: 1180px)').matches) {
        detailEl.scrollIntoView({ behavior: ctx.reducedMotion ? 'auto' : 'smooth', block: 'start' });
      }
      return;
    }
    const action = event.target.closest('[data-act]');
    if (!action || !state.detail) return;
    const detail = state.detail;
    switch (action.dataset.act) {
      case 'buy-now': {
        const listing = buyableListing(detail);
        if (!listing) return;
        ctx.run(action, async () => {
          const result = await marketApi.buyLowest(detail.def.id, listing.price);
          ctx.setWallet(result.wallet);
          toast(tr(`Bought ${defName(detail.def)} for ${fmt(result.sale.price)} coins.`, `Đã mua ${defName(detail.def)} với giá ${fmt(result.sale.price)} xu.`), 'success');
          await refreshAfterTrade();
        });
        break;
      }
      case 'buy-listing':
        ctx.run(action, async () => {
          const result = await marketApi.buyListing(action.dataset.id);
          ctx.setWallet(result.wallet);
          toast(tr(`Bought ${defName(detail.def)} for ${fmt(result.sale.price)} coins.`, `Đã mua ${defName(detail.def)} với giá ${fmt(result.sale.price)} xu.`), 'success');
          await refreshAfterTrade();
        });
        break;
      case 'bid-toggle': {
        state.bidOpen = !state.bidOpen;
        const form = panel.querySelector('#mk-bidform');
        form.hidden = !state.bidOpen;
        action.setAttribute('aria-expanded', String(state.bidOpen));
        if (state.bidOpen) panel.querySelector('#mk-bidprice')?.focus();
        break;
      }
      case 'to-trade':
        ctx.go('trade');
        break;
      case 'unlist':
        ctx.run(action, async () => {
          await marketApi.cancelListing(action.dataset.id);
          toast(tr('Listing withdrawn; the item is back in your bag.', 'Đã gỡ tin rao bán, vật phẩm đã về túi đồ.'), 'success');
          await refreshAfterTrade();
        });
        break;
      case 'cancel-order':
        ctx.run(action, async () => {
          await marketApi.cancelOrder(action.dataset.id);
          toast(tr('Buy order cancelled; the coins are back in your wallet.', 'Đã hủy lệnh mua, xu đã trả về ví.'), 'success');
          await refreshAfterTrade();
        });
        break;
      default:
        break;
    }
  });

  if (state.browse) {
    renderCategories(state.browse);
    renderRows(state.browse);
    renderPager(state.browse);
    if (state.detail && state.detail.def.id === state.selectedDef) renderDetail(state.detail);
  }
  loadBrowse({ keepDetail: true, keepSelection: true });

  return {
    dispose() {
      clearTimeout(searchTimer);
    },
  };
}
