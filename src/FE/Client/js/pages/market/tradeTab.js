import { marketApi } from '../../api/marketApi.js';
import { tr } from '../../services/i18n.js';
import { escapeHtml } from '../../utils/dom.js';
import { toast } from '../../utils/toast.js';
import { ARROW_SWAP, defName, errorText, failReasonText, fmt, itemIcon, itemTile, rarityLabel, shortDate, xu } from './marketKit.js';

const MAX_ITEMS = 6;
const MAX_COINS = 1_000_000;
const POLL_MS = 15_000;

function emptyDraft() {
  return { partner: null, partnerItems: null, give: [], get: [], giveCoins: '', getCoins: '', message: '', counterOf: null, picker: null };
}

/** TRAO ĐỔI: build an offer (items + coins each side, message) and answer incoming offers. */
export function mountTradeTab(ctx) {
  const { panel, state } = ctx;
  if (!state.trade) state.trade = emptyDraft();
  const draft = state.trade;
  let searchTimer = 0;
  let searchSeq = 0;
  let pollTimer = 0;
  let loading = false;

  panel.innerHTML = `
    <div class="bpa-mk-trade">
      <form class="bpa-mk-tradeform" id="mk-tradeform" novalidate>
        <div>
          <h2 class="bpa-mk-h2" id="mk-trade-h" tabindex="-1">${tr('New trade offer', 'Đề nghị trao đổi mới')}</h2>
          <p class="bpa-mk-sub">${tr('Pick your items and the ones you want. The trade completes when the other detective accepts.', 'Chọn đồ của bạn và đồ bạn muốn nhận. Đối phương xác nhận thì giao dịch hoàn tất.')}</p>
        </div>
        <div id="mk-counterbanner"></div>
        <div class="bpa-mk-to">
          <label for="mk-to" class="bpa-mk-label">${tr('SEND TO', 'GỬI CHO')}</label>
          <div id="mk-to-chosen"></div>
          <div class="bpa-mk-towrap" id="mk-to-wrap">
            <input id="mk-to" class="bpa-mk-text" type="text" autocomplete="off" maxlength="40" spellcheck="false"
                   placeholder="${tr('Type a detective’s name…', 'Nhập tên thám tử…')}" aria-autocomplete="list" aria-controls="mk-to-results" aria-expanded="false">
            <ul class="bpa-mk-results" id="mk-to-results" hidden></ul>
          </div>
        </div>
        <div class="bpa-mk-swap">
          <div class="bpa-mk-swapside is-give">
            <p class="bpa-mk-label is-teal" id="mk-give-h">${tr('YOU GIVE', 'BẠN ĐƯA')}</p>
            <div class="bpa-mk-slots" id="mk-give" role="group" aria-labelledby="mk-give-h"></div>
            <label class="bpa-mk-coinin"><span>${tr('+ coins', '+ xu')}</span><input id="mk-give-coins" class="bpa-mk-field is-sm" type="number" inputmode="numeric" min="0" max="${MAX_COINS}" step="1" placeholder="0" value="${escapeHtml(draft.giveCoins)}"></label>
          </div>
          <span class="bpa-mk-swaparrow">${ARROW_SWAP(44)}</span>
          <div class="bpa-mk-swapside is-get">
            <p class="bpa-mk-label is-rust" id="mk-get-h">${tr('YOU GET', 'BẠN NHẬN')}</p>
            <div class="bpa-mk-slots" id="mk-get" role="group" aria-labelledby="mk-get-h"></div>
            <label class="bpa-mk-coinin"><span>${tr('+ coins', '+ xu')}</span><input id="mk-get-coins" class="bpa-mk-field is-sm" type="number" inputmode="numeric" min="0" max="${MAX_COINS}" step="1" placeholder="0" value="${escapeHtml(draft.getCoins)}"></label>
          </div>
        </div>
        <div class="bpa-mk-picker" id="mk-picker" hidden></div>
        <div>
          <label for="mk-note" class="bpa-mk-label">${tr('MESSAGE', 'LỜI NHẮN')}</label>
          <textarea id="mk-note" class="bpa-mk-text" rows="2" maxlength="200" placeholder="${tr('Swap my magnifier for your watch?', 'Đổi kính lúp lấy đồng hồ của bạn nhé?')}">${escapeHtml(draft.message)}</textarea>
        </div>
        <p class="bpa-mk-formerr" id="mk-trade-err" role="alert"></p>
        <button type="submit" class="bpa-btn bpa-btn--red bpa-mk-big bpa-mk-send" id="mk-trade-send">${tr('SEND OFFER', 'GỬI ĐỀ NGHỊ')}</button>
      </form>
      <div class="bpa-mk-offers" id="mk-offers"><p class="bpa-mk-wait">${tr('Loading offers…', 'Đang tải đề nghị…')}</p></div>
    </div>`;

  const $ = (selector) => panel.querySelector(selector);
  const errorEl = $('#mk-trade-err');

  function myItems() {
    return (state.inventory?.items || []).filter((item) => item.def.tradable !== false);
  }

  function itemById(side, itemId) {
    const source = side === 'give' ? myItems() : (draft.partnerItems || []);
    return source.find((item) => item.itemId === itemId);
  }

  // ----- recipient

  function renderRecipient() {
    const chosen = $('#mk-to-chosen');
    const wrap = $('#mk-to-wrap');
    if (draft.partner) {
      chosen.innerHTML = `
        <span class="bpa-mk-partner">
          <span class="bpa-avatar" aria-hidden="true">${escapeHtml(initialsOf(draft.partner.name))}</span>
          <strong>${escapeHtml(draft.partner.name)}</strong>
          ${draft.counterOf ? '' : `<button type="button" class="bpa-link bpa-mk-change" data-act="change-partner">${tr('Change', 'Đổi người')}</button>`}
        </span>`;
      wrap.hidden = true;
    } else {
      chosen.innerHTML = '';
      wrap.hidden = false;
    }
  }

  function initialsOf(name) {
    const words = String(name || '?').split(/\s+/).filter(Boolean);
    return (words.length > 2 ? [words[0], words[words.length - 1]] : words).map((word) => word[0].toUpperCase()).join('');
  }

  function renderResults(results, query) {
    const list = $('#mk-to-results');
    const input = $('#mk-to');
    if (!query) {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    list.innerHTML = results.length
      ? results.map((user) => `<li><button type="button" class="bpa-mk-result" data-user="${escapeHtml(user.userId)}" data-name="${escapeHtml(user.username)}"><span class="bpa-avatar" aria-hidden="true">${escapeHtml(initialsOf(user.username))}</span>${escapeHtml(user.username)}</button></li>`).join('')
      : `<li class="bpa-mk-mini bpa-mk-noresult">${tr('No detective found.', 'Không tìm thấy thám tử nào.')}</li>`;
  }

  async function choosePartner(userId, name, { keep = false } = {}) {
    draft.partner = { userId, name };
    draft.partnerItems = null;
    if (!keep) draft.get = [];
    renderRecipient();
    renderResults([], '');
    renderSlots();
    try {
      const inventory = await marketApi.userInventory(userId);
      if (!ctx.isActive() || draft.partner?.userId !== userId) return;
      draft.partnerItems = inventory.items;
      draft.get = draft.get.filter((id) => inventory.items.some((item) => item.itemId === id && !item.locked));
    } catch (error) {
      draft.partnerItems = [];
      errorEl.textContent = errorText(error);
    }
    renderSlots();
    if (draft.picker === 'get') renderPicker();
  }

  // ----- item slots & picker

  function slotTile(side, itemId) {
    const item = itemById(side, itemId);
    if (!item) return '';
    const name = defName(item.def);
    return `<button type="button" class="bpa-mk-slotitem" data-remove="${side}" data-id="${escapeHtml(itemId)}" title="${escapeHtml(name)}" aria-label="${escapeHtml(tr(`Remove ${name}`, `Bỏ ${name}`))}">${itemTile(item.def, 54, 44)}<span class="bpa-mk-slotx" aria-hidden="true">×</span></button>`;
  }

  function renderSlots() {
    for (const side of ['give', 'get']) {
      const ids = draft[side];
      const disabled = side === 'get' && !draft.partner;
      const full = ids.length >= MAX_ITEMS;
      $(side === 'give' ? '#mk-give' : '#mk-get').innerHTML = ids.map((id) => slotTile(side, id)).join('') + (full ? '' : `
        <button type="button" class="bpa-mk-add" data-picker="${side}" aria-expanded="${draft.picker === side}" aria-controls="mk-picker" ${disabled ? 'disabled' : ''}
                aria-label="${side === 'give' ? tr('Add an item to give', 'Thêm vật phẩm') : tr('Add an item to receive', 'Thêm vật phẩm muốn nhận')}">+</button>`)
        + (disabled ? `<p class="bpa-mk-mini bpa-mk-slothint">${tr('Choose a recipient first.', 'Chọn người nhận trước.')}</p>` : '');
    }
  }

  function renderPicker() {
    const picker = $('#mk-picker');
    const side = draft.picker;
    if (!side) {
      picker.hidden = true;
      picker.innerHTML = '';
      return;
    }
    const source = side === 'give' ? myItems() : (draft.partnerItems || []);
    const owner = side === 'give' ? tr('your bag', 'túi đồ của bạn') : (draft.partner?.name || '');
    const loadingItems = side === 'get' && draft.partnerItems === null;
    picker.hidden = false;
    picker.innerHTML = `
      <div class="bpa-mk-pickerhead">
        <p class="bpa-mk-label">${side === 'give' ? tr('PICK FROM YOUR BAG', 'CHỌN TỪ TÚI ĐỒ CỦA BẠN') : tr(`PICK FROM ${owner.toUpperCase()}'S BAG`, `CHỌN TỪ TÚI ĐỒ CỦA ${owner.toUpperCase()}`)}</p>
        <button type="button" class="bpa-btn bpa-btn--ink bpa-btn--sm" data-act="picker-done">${tr('Done', 'Xong')}</button>
      </div>
      ${loadingItems ? `<p class="bpa-mk-wait">${tr('Opening the bag…', 'Đang mở túi đồ…')}</p>` : source.length ? `
      <div class="bpa-mk-pickgrid">
        ${source.map((item) => {
    const chosen = draft[side].includes(item.itemId);
    const name = defName(item.def);
    return `<button type="button" class="bpa-mk-pick" data-pick="${side}" data-id="${escapeHtml(item.itemId)}" aria-pressed="${chosen}" ${item.locked ? 'disabled' : ''}>
            ${itemIcon(item.def, 40)}<span>${escapeHtml(name)}</span><span class="bpa-sr">, ${escapeHtml(rarityLabel(item.def.rarity))}</span>${item.locked ? `<small>${tr('locked', 'đang khóa')}</small>` : ''}
          </button>`;
  }).join('')}
      </div>` : `<p class="bpa-mk-mini">${tr('This bag is empty.', 'Túi đồ này đang trống.')}</p>`}`;
  }

  function renderCounterBanner() {
    const banner = $('#mk-counterbanner');
    if (!draft.counterOf) {
      banner.innerHTML = '';
      $('#mk-trade-h').textContent = tr('New trade offer', 'Đề nghị trao đổi mới');
      $('#mk-trade-send').textContent = tr('SEND OFFER', 'GỬI ĐỀ NGHỊ');
      return;
    }
    $('#mk-trade-h').textContent = tr('Counter-offer', 'Phản đề nghị');
    $('#mk-trade-send').textContent = tr('SEND COUNTER-OFFER', 'GỬI PHẢN ĐỀ NGHỊ');
    banner.innerHTML = `
      <p class="bpa-mk-banner">${tr(
    `You are answering <strong>${escapeHtml(draft.counterOf.from.name)}</strong> with new terms. Their offer closes when you send this.`,
    `Bạn đang trả lời <strong>${escapeHtml(draft.counterOf.from.name)}</strong> bằng điều kiện mới. Đề nghị cũ sẽ đóng khi bạn gửi.`)}
        <button type="button" class="bpa-link" data-act="cancel-counter">${tr('Discard counter-offer', 'Bỏ phản đề nghị')}</button></p>`;
  }

  function renderForm() {
    renderCounterBanner();
    renderRecipient();
    renderSlots();
    renderPicker();
  }

  // ----- offers

  function sideTiles(items, coins, coinClass) {
    const tiles = items.map((item) => {
      const name = defName(item.def);
      const label = item.available ? name : tr(`${name} (no longer available)`, `${name} (không còn)`);
      return `<span class="bpa-mk-offertile${item.available ? '' : ' is-gone'}" title="${escapeHtml(label)}">${itemTile(item.def, 44, 34, label)}</span>`;
    }).join('');
    const coin = coins ? `<span class="bpa-mk-coins ${coinClass}">${coinClass === 'is-plus' ? '+' : '−'} ${xu(coins)}</span>` : '';
    return tiles + coin || `<span class="bpa-mk-mini">${tr('nothing', 'không có gì')}</span>`;
  }

  function offerCard(offer) {
    const incoming = offer.direction === 'INCOMING';
    const other = incoming ? offer.from.name : offer.to.name;
    // From the viewer's side: what they receive and what they give.
    const receive = incoming ? sideTiles(offer.fromItems, offer.fromCoins, 'is-plus') : sideTiles(offer.toItems, offer.toCoins, 'is-plus');
    const give = incoming ? sideTiles(offer.toItems, offer.toCoins, 'is-minus') : sideTiles(offer.fromItems, offer.fromCoins, 'is-minus');
    const anyGone = offer.fromItems.concat(offer.toItems).some((item) => !item.available);
    const title = incoming
      ? (offer.parentId
        ? tr(`<strong>${escapeHtml(other)}</strong> sent a counter-offer`, `<strong>${escapeHtml(other)}</strong> phản đề nghị`)
        : tr(`<strong>${escapeHtml(other)}</strong> wants to trade with you`, `<strong>${escapeHtml(other)}</strong> muốn đổi với bạn`))
      : tr(`Waiting for <strong>${escapeHtml(other)}</strong>`, `Đang chờ <strong>${escapeHtml(other)}</strong>`);
    const busy = offer.status === 'ACCEPTING';
    return `
      <article class="bpa-mk-offer" data-offer="${escapeHtml(offer.offerId)}">
        <p class="bpa-mk-offertitle"><span>${title}</span><span class="bpa-mk-mini">${escapeHtml(shortDate(offer.createdAt))}</span></p>
        <div class="bpa-mk-offerrow">
          <div class="bpa-mk-offerside"><span class="bpa-mk-mini is-teal">${tr('YOU GET', 'BẠN NHẬN')}</span><div>${receive}</div></div>
          ${ARROW_SWAP(22)}
          <div class="bpa-mk-offerside"><span class="bpa-mk-mini is-rust">${tr('YOU GIVE', 'BẠN ĐƯA')}</span><div>${give}</div></div>
        </div>
        ${offer.message ? `<p class="bpa-mk-msg">“${escapeHtml(offer.message)}”</p>` : ''}
        ${anyGone ? `<p class="bpa-mk-warn">${tr('Some items are no longer available; accepting will fail.', 'Có vật phẩm không còn sẵn sàng; chấp nhận sẽ không thành công.')}</p>` : ''}
        <div class="bpa-mk-offeracts">
          ${busy ? `<span class="bpa-mk-mini">${tr('Completing…', 'Đang hoàn tất…')}</span>` : incoming ? `
            <button type="button" class="bpa-btn bpa-btn--red bpa-btn--sm" data-act="accept" data-id="${escapeHtml(offer.offerId)}">${tr('ACCEPT', 'CHẤP NHẬN')}</button>
            <button type="button" class="bpa-btn bpa-btn--ink bpa-btn--sm" data-act="decline" data-id="${escapeHtml(offer.offerId)}">${tr('DECLINE', 'TỪ CHỐI')}</button>
            <button type="button" class="bpa-btn bpa-btn--ink bpa-btn--sm" data-act="counter" data-id="${escapeHtml(offer.offerId)}">${tr('COUNTER', 'PHẢN ĐỀ NGHỊ')}</button>` : `
            <button type="button" class="bpa-btn bpa-btn--ink bpa-btn--sm" data-act="cancel-offer" data-id="${escapeHtml(offer.offerId)}">${tr('CANCEL OFFER', 'HỦY ĐỀ NGHỊ')}</button>`}
        </div>
      </article>`;
  }

  const STATUS = {
    ACCEPTED: ['Accepted', 'Đã chấp nhận', 'is-ok'],
    DECLINED: ['Declined', 'Bị từ chối', 'is-bad'],
    CANCELLED: ['Cancelled', 'Đã hủy', 'is-muted'],
    COUNTERED: ['Countered', 'Đã phản đề nghị', 'is-muted'],
    FAILED: ['Failed', 'Không thành', 'is-bad'],
  };

  function historyRow(offer) {
    const [en, vi, cls] = STATUS[offer.status] || [offer.status, offer.status, 'is-muted'];
    const other = offer.direction === 'INCOMING' ? offer.from.name : offer.to.name;
    const reason = offer.status === 'FAILED' && offer.failReason ? ` — ${escapeHtml(failReasonText(offer.failReason))}` : '';
    return `<li><span class="bpa-mk-status ${cls}">${tr(en, vi)}</span><span>${offer.direction === 'INCOMING' ? tr('from', 'từ') : tr('to', 'tới')} <strong>${escapeHtml(other)}</strong>${reason}</span><span class="bpa-mk-mini">${escapeHtml(shortDate(offer.respondedAt || offer.createdAt))}</span></li>`;
  }

  function renderOffers() {
    const trades = state.trades;
    const box = $('#mk-offers');
    if (!trades) return;
    box.innerHTML = `
      <h2 class="bpa-mk-h2">${tr('Waiting for you', 'Đề nghị đang chờ')}</h2>
      ${trades.incoming.length ? trades.incoming.map(offerCard).join('') : `<p class="bpa-mk-empty">${tr('No offers for you right now.', 'Chưa có đề nghị nào gửi tới bạn.')}</p>`}
      <h3 class="bpa-mk-h3">${tr('You sent', 'Bạn đã gửi')}</h3>
      ${trades.outgoing.length ? trades.outgoing.map(offerCard).join('') : `<p class="bpa-mk-empty">${tr('No pending offers sent.', 'Chưa gửi đề nghị nào.')}</p>`}
      ${trades.history.length ? `<h3 class="bpa-mk-h3">${tr('Closed', 'Đã xử lý')}</h3><ul class="bpa-mk-history">${trades.history.slice(0, 8).map(historyRow).join('')}</ul>` : ''}`;
  }

  async function loadTrades() {
    if (loading) return;
    loading = true;
    try {
      const trades = await marketApi.trades();
      if (!ctx.isActive()) return;
      state.trades = trades;
      renderOffers();
    } catch (error) {
      if (ctx.isActive() && !state.trades) $('#mk-offers').innerHTML = `<p class="bpa-mk-empty" role="alert">${escapeHtml(errorText(error))}</p>`;
    } finally {
      loading = false;
    }
  }

  async function loadInventory() {
    try {
      const inventory = await marketApi.inventory();
      if (!ctx.isActive()) return;
      state.inventory = inventory;
      ctx.setWallet(inventory.wallet);
      draft.give = draft.give.filter((id) => inventory.items.some((item) => item.itemId === id && !item.locked));
      renderSlots();
      if (draft.picker === 'give') renderPicker();
    } catch {
      // Slots stay as they are; sending re-validates on the server anyway.
    }
  }

  function resetDraft() {
    Object.assign(draft, emptyDraft());
    $('#mk-give-coins').value = '';
    $('#mk-get-coins').value = '';
    $('#mk-note').value = '';
    $('#mk-to').value = '';
    renderForm();
  }

  function startCounter(offer) {
    Object.assign(draft, emptyDraft(), {
      counterOf: offer,
      give: offer.toItems.filter((item) => item.available).map((item) => item.itemId),
      get: offer.fromItems.filter((item) => item.available).map((item) => item.itemId),
      giveCoins: offer.toCoins ? String(offer.toCoins) : '',
      getCoins: offer.fromCoins ? String(offer.fromCoins) : '',
    });
    $('#mk-give-coins').value = draft.giveCoins;
    $('#mk-get-coins').value = draft.getCoins;
    $('#mk-note').value = '';
    errorEl.textContent = '';
    choosePartner(offer.from.userId, offer.from.name, { keep: true });
    renderForm();
    $('#mk-trade-h').focus();
    $('#mk-tradeform').scrollIntoView({ behavior: ctx.reducedMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function coinsValue(id) {
    const raw = $(id).value.trim();
    if (raw === '') return 0;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 && value <= MAX_COINS ? value : NaN;
  }

  // ----- events

  panel.addEventListener('input', (event) => {
    const { id } = event.target;
    if (id === 'mk-to') {
      clearTimeout(searchTimer);
      const query = event.target.value.trim();
      if (query.length < 2) {
        renderResults([], '');
        return;
      }
      searchTimer = setTimeout(async () => {
        const current = ++searchSeq;
        let results = [];
        try {
          results = await marketApi.searchUsers(query);
        } catch {
          results = [];
        }
        if (current === searchSeq && ctx.isActive() && !draft.partner) renderResults(results, query);
      }, 250);
    } else if (id === 'mk-give-coins') {
      draft.giveCoins = event.target.value;
    } else if (id === 'mk-get-coins') {
      draft.getCoins = event.target.value;
    } else if (id === 'mk-note') {
      draft.message = event.target.value;
    }
  });

  panel.addEventListener('keydown', (event) => {
    if (event.target.id === 'mk-to' && event.key === 'ArrowDown') {
      const first = $('#mk-to-results .bpa-mk-result');
      if (first) {
        event.preventDefault();
        first.focus();
      }
    } else if (event.target.classList?.contains('bpa-mk-result') && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const items = [...panel.querySelectorAll('.bpa-mk-result')];
      const index = items.indexOf(event.target) + (event.key === 'ArrowDown' ? 1 : -1);
      if (index < 0) $('#mk-to').focus();
      else items[Math.min(index, items.length - 1)].focus();
    } else if (event.key === 'Escape' && !$('#mk-to-results').hidden) {
      renderResults([], '');
      $('#mk-to').focus();
    }
  });

  panel.addEventListener('submit', (event) => {
    if (event.target.id !== 'mk-tradeform') return;
    event.preventDefault();
    errorEl.textContent = '';
    const giveCoins = coinsValue('#mk-give-coins');
    const getCoins = coinsValue('#mk-get-coins');
    if (!draft.partner) {
      errorEl.textContent = tr('Choose who receives the offer.', 'Hãy chọn người nhận đề nghị.');
      $('#mk-to').focus();
      return;
    }
    if (Number.isNaN(giveCoins) || Number.isNaN(getCoins)) {
      errorEl.textContent = tr('Coins must be whole numbers from 0 to 1,000,000.', 'Số xu phải là số nguyên từ 0 đến 1.000.000.');
      return;
    }
    if (!draft.give.length && !draft.get.length && !giveCoins && !getCoins) {
      errorEl.textContent = tr('Add at least one item or some coins.', 'Hãy thêm ít nhất một vật phẩm hoặc một ít xu.');
      return;
    }
    if (state.wallet && giveCoins > state.wallet.balance) {
      errorEl.textContent = tr(`You only have ${fmt(state.wallet.balance)} coins.`, `Bạn chỉ có ${fmt(state.wallet.balance)} xu.`);
      return;
    }
    const terms = {
      offerItemIds: draft.give,
      offerCoins: giveCoins,
      requestItemIds: draft.get,
      requestCoins: getCoins,
      message: $('#mk-note').value.trim(),
    };
    const button = $('#mk-trade-send');
    const counterOf = draft.counterOf;
    ctx.run(button, async () => {
      if (counterOf) await marketApi.counterTrade(counterOf.offerId, terms);
      else await marketApi.createTrade({ ...terms, toUserId: draft.partner.userId });
      toast(counterOf
        ? tr('Counter-offer sent.', 'Đã gửi phản đề nghị.')
        : tr(`Offer sent to ${draft.partner.name}.`, `Đã gửi đề nghị cho ${draft.partner.name}.`), 'success');
      resetDraft();
      await loadTrades();
    }, errorEl);
  });

  panel.addEventListener('click', (event) => {
    const result = event.target.closest('[data-user]');
    if (result) {
      $('#mk-to').value = '';
      choosePartner(result.dataset.user, result.dataset.name);
      return;
    }
    const opener = event.target.closest('[data-picker]');
    if (opener) {
      draft.picker = draft.picker === opener.dataset.picker ? null : opener.dataset.picker;
      renderSlots();
      renderPicker();
      if (draft.picker) $('#mk-picker .bpa-mk-pick:not([disabled])')?.focus();
      return;
    }
    const pick = event.target.closest('[data-pick]');
    if (pick) {
      const side = pick.dataset.pick;
      const ids = draft[side];
      const index = ids.indexOf(pick.dataset.id);
      if (index >= 0) ids.splice(index, 1);
      else if (ids.length < MAX_ITEMS) ids.push(pick.dataset.id);
      else {
        toast(tr('At most 6 items per side.', 'Mỗi bên tối đa 6 vật phẩm.'), 'error');
        return;
      }
      pick.setAttribute('aria-pressed', String(index < 0));
      renderSlots();
      return;
    }
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      const ids = draft[remove.dataset.remove];
      const index = ids.indexOf(remove.dataset.id);
      if (index >= 0) ids.splice(index, 1);
      renderSlots();
      if (draft.picker) renderPicker();
      return;
    }
    const action = event.target.closest('[data-act]');
    if (!action) return;
    const offer = [...(state.trades?.incoming || []), ...(state.trades?.outgoing || [])]
      .find((candidate) => candidate.offerId === action.dataset.id);
    switch (action.dataset.act) {
      case 'picker-done':
        draft.picker = null;
        renderSlots();
        renderPicker();
        break;
      case 'change-partner':
        draft.partner = null;
        draft.partnerItems = null;
        draft.get = [];
        if (draft.picker === 'get') draft.picker = null;
        renderForm();
        $('#mk-to').focus();
        break;
      case 'cancel-counter':
        resetDraft();
        break;
      case 'counter':
        if (offer) startCounter(offer);
        break;
      case 'accept':
        ctx.run(action, async () => {
          await marketApi.acceptTrade(action.dataset.id);
          toast(tr('Trade complete — items and coins have changed hands.', 'Giao dịch hoàn tất — vật phẩm và xu đã được trao đổi.'), 'success');
          await Promise.all([loadTrades(), loadInventory(), ctx.refreshWallet()]);
        }, null, () => loadTrades());
        break;
      case 'decline':
        ctx.run(action, async () => {
          await marketApi.declineTrade(action.dataset.id);
          toast(tr('Offer declined.', 'Đã từ chối đề nghị.'), 'success');
          await loadTrades();
        });
        break;
      case 'cancel-offer':
        ctx.run(action, async () => {
          await marketApi.cancelTrade(action.dataset.id);
          toast(tr('Offer cancelled.', 'Đã hủy đề nghị.'), 'success');
          await loadTrades();
        });
        break;
      default:
        break;
    }
  });

  renderForm();
  if (state.trades) renderOffers();
  loadTrades();
  loadInventory();
  if (draft.partner && draft.partnerItems === null) choosePartner(draft.partner.userId, draft.partner.name, { keep: true });
  pollTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    loadTrades();
    ctx.refreshWallet();
  }, POLL_MS);

  return {
    dispose() {
      clearTimeout(searchTimer);
      clearInterval(pollTimer);
    },
  };
}
