import '../../../css/47-chest.css';
import { chestApi } from '../api/chestApi.js';
import { newRequestId } from '../api/marketApi.js';
import { publishWallet } from '../components/walletChip.js';
import { tr, uiLanguage } from '../services/i18n.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { AU } from './chest/chestAudio.js';
import { chestLook, defSprite, paintSprite } from './chest/chestSprites.js';
import { createChestStage } from './chest/chestStage.js';
import { errorText, fmt, rarityLabel } from './market/marketKit.js';

const FONTS_ID = 'qh-fonts';
const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800&family=IBM+Plex+Mono:wght@400;600&family=Jura:wght@500;600;700&display=swap';

/** The stage keeps the mock-up's rarity ids and colours; the API speaks in market rarities. */
const RARITY_LOOK = {
  COMMON: { r: 'common', color: '#8E9AAE' },
  RARE: { r: 'rare', color: '#4F80DE' },
  EPIC: { r: 'myth', color: '#9A66F0' },
  LEGENDARY: { r: 'leg', color: '#E0463A' },
  MYSTERY: { r: 'gold', color: '#E8B53A' },
};
const SHOW_ORDER = ['MYSTERY', 'LEGENDARY', 'EPIC', 'RARE', 'COMMON'];

/** How long a retry keeps the reel waiting: long enough for the recovery sweep to finish a crashed request. */
const RETRY_WINDOW_MS = 90_000;
const RETRY_MAX_DELAY_MS = 8_000;
/** Blocks the second click of a double click once a purchase turns the main button into "Mở". */
const DOUBLE_CLICK_GUARD_MS = 400;
const SWIPE_PX = 50;

function loadFonts() {
  if (document.getElementById(FONTS_ID)) return;
  const link = document.createElement('link');
  link.id = FONTS_ID;
  link.rel = 'stylesheet';
  link.href = FONTS_URL;
  document.head.append(link);
}

function percentText(value) {
  return `${Number(value).toLocaleString(uiLanguage() === 'vi' ? 'vi-VN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/** A retry may still succeed: the network dropped, the server is restarting, or the same key is mid-flight. */
function isTransient(error) {
  return error?.status === 0 || error?.status >= 500 || error?.status === 429 || error?.errors?.code === 'IN_PROGRESS';
}

/** Errors only this page can get, on top of the market's. */
function chestErrorText(error) {
  const code = error?.errors?.code;
  if (code === 'CHEST_PRICE_CHANGED') return tr('The price has just changed. Check it, then buy again.', 'Giá vừa thay đổi. Hãy xem lại rồi mua.');
  if (code === 'CHEST_NOT_FOR_SALE') return tr('This chest is no longer on sale.', 'Hòm này đã ngừng bán.');
  return errorText(error);
}

/**
 * /kho-ruong — Mở hòm. The server decides everything; this page only shows what it answers.
 * `api` and `preview` are for the admin's "try it out": the same screen against an API that stores nothing, without a wallet or a shop.
 */
export async function renderChestPage(app, { signal, api = chestApi, preview = false } = {}) {
  loadFonts();
  const rarities = Object.fromEntries(Object.entries(RARITY_LOOK).map(([rarity, look]) =>
    [look.r, { color: look.color, name: rarityLabel(rarity) }]));

  render(app, `
    <div class="qh-app" data-mode="idle"${preview ? ' data-preview' : ''}>
      <canvas class="qh-stage" id="qh-stage" role="img" aria-label="${tr(
    'The selected chest under the lamp. Use the left and right arrows to change chest.',
    'Rương đang chọn dưới ánh đèn. Dùng mũi tên trái phải để đổi loại rương.')}"></canvas>
      <header class="qh-bar" data-qh-ready hidden>
        <div class="qh-case">
          <h1><span id="qh-caseName"></span><small id="qh-nChest"></small></h1>
          <p id="qh-caseSub"></p>
        </div>
        <div class="qh-wallet">
          <span class="qh-pill" title="${tr('Keys', 'Chìa khóa')}"><canvas id="qh-chipKey" width="42" height="20" aria-hidden="true"></canvas><b id="qh-nKey"></b></span>
          <span class="qh-pill qh-coin" title="${tr('Coins', 'Xu')}"><b id="qh-nCoin"></b> xu</span>
          <a class="qh-pill qh-inv" href="/market/sell" title="${tr('Items in your bag', 'Vật phẩm trong kho')}">${tr('Bag', 'Kho')} <b id="qh-nInv"></b></a>
          <button class="qh-pill qh-soundBtn" id="qh-soundBtn" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path class="qh-wave" d="M16.5 8.5a5 5 0 0 1 0 7"/><path class="qh-wave" d="M19 6a8.5 8.5 0 0 1 0 12"/><path class="qh-x" d="M17 9l5 6M22 9l-5 6"/></svg>
          </button>
        </div>
      </header>

      <div class="qh-spot" id="qh-spot">
        <button class="qh-nav" id="qh-prevBtn" type="button" data-qh-ready hidden aria-label="${tr('Previous chest', 'Rương trước')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
        <button class="qh-nav" id="qh-nextBtn" type="button" data-qh-ready hidden aria-label="${tr('Next chest', 'Rương sau')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>

      <div class="qh-empty" id="qh-empty" role="status">${tr('Opening the evidence room…', 'Đang mở kho vật chứng…')}</div>

      <footer class="qh-dock" data-qh-ready hidden>
        <p class="qh-net" id="qh-net" role="status" hidden>${tr('Unstable connection, trying again…', 'Mạng chập chờn, đang thử lại…')}</p>
        <div class="qh-stack">
          <div class="qh-cta qh-cta-idle">
            <div class="qh-dots" id="qh-dots" role="group" aria-label="${tr('Choose a chest', 'Chọn loại rương')}"></div>
            <button class="qh-btn-open" id="qh-openBtn" type="button"><canvas id="qh-btnKey" width="42" height="20" aria-hidden="true"></canvas><span id="qh-openLbl"></span></button>
            <p class="qh-meta" id="qh-meta"></p>
            <p class="qh-buy" id="qh-buy">
              <button class="qh-link" type="button" data-qh-buy="key"></button>
              <button class="qh-link" type="button" data-qh-buy="chest"></button>
            </p>
          </div>
          <div class="qh-cta qh-cta-reveal qh-result">
            <h2 id="qh-gotName">—</h2>
            <p class="qh-rar" id="qh-gotRar"></p>
            <div class="qh-row2">
              <button class="qh-btn-ghost" id="qh-againBtn" type="button">${tr('Open another', 'Mở tiếp')}</button>
              <button class="qh-btn-open" id="qh-keepBtn" type="button" style="min-width:0">${tr('Put in the bag', 'Cất vào kho')}</button>
            </div>
          </div>
          <button class="qh-skip" id="qh-skipBtn" type="button">${tr('Fast-forward · Esc', 'Tua nhanh · Esc')}</button>
        </div>
        <section class="qh-contents" aria-labelledby="qh-h-contents">
          <div class="qh-contents-head"><span id="qh-h-contents">${tr('You may get', 'Có thể nhận được')}</span><button class="qh-link" id="qh-oddsBtn" type="button" aria-expanded="false" aria-controls="qh-odds">${tr('Drop rates', 'Tỉ lệ rơi')}</button></div>
          <div class="qh-row" id="qh-contents"></div>
          <ul class="qh-odds" id="qh-odds" hidden></ul>
        </section>
      </footer>
      <div class="qh-sr" aria-live="assertive" id="qh-live"></div>
    </div>`);

  const root = app.querySelector('.qh-app');
  const $ = (id) => root.querySelector(`#qh-${id}`);
  const listeners = new AbortController();
  const on = (target, type, handler) => target.addEventListener(type, handler, { signal: listeners.signal });
  const say = (text) => { $('live').textContent = text; };

  // The shell stays on screen: the page fills whatever height the header leaves.
  const navRoot = document.getElementById('nav-root');
  const measureNav = () => root.style.setProperty('--qh-nav', `${preview ? 0 : navRoot?.offsetHeight ?? 0}px`);
  measureNav();
  const navObserver = navRoot && !preview ? new ResizeObserver(measureNav) : null;
  navObserver?.observe(navRoot);

  const page = {
    chests: [], wallet: null, index: 0,
    opening: false, buying: false, guardUntil: 0, loaded: false,
  };
  let stage = null;
  let disposed = false;
  const pendingSleeps = new Set();
  const timers = new Set();

  const cur = () => page.chests[page.index];
  const has = () => ({ chest: cur().chestCount, key: cur().keyCount });
  const canAfford = (price) => (page.wallet?.balance ?? 0) >= price;

  function itemFor(def) {
    const look = RARITY_LOOK[def.rarity] ?? RARITY_LOOK.COMMON;
    return { id: def.id, name: tr(def.nameEn || def.name, def.name), r: look.r, rarity: def.rarity, sp: defSprite(def), def };
  }

  /** One cosmetic card for the reel, weighted like the published odds. The result never comes from here. */
  function fillerItem() {
    const { items, odds } = cur();
    let ticket = Math.random() * odds.reduce((sum, odd) => sum + Number(odd.percent), 0);
    const odd = odds.find((entry) => (ticket -= Number(entry.percent)) < 0) ?? odds[0];
    const pool = items.filter((item) => item.rarity === odd?.rarity);
    const from = pool.length ? pool : items;
    return from[Math.floor(Math.random() * from.length)];
  }

  function applyList(data) {
    const previous = cur()?.id;
    // After them, the chests switched off that this player still holds a copy of: those can still be opened.
    page.chests = [...data.chests, ...(data.offSale ?? [])].map((chest) => ({
      ...chest,
      ...chestLook(chest.iconKey, chest.keyIconKey, chest.look),
      onSale: chest.active !== false,
      odds: (chest.odds ?? data.odds ?? []).filter((odd) => Number(odd.percent) > 0),
      displayName: tr(chest.nameEn || chest.name, chest.name),
      displaySub: tr(chest.subtitleEn || chest.subtitle, chest.subtitle),
      displayKey: tr(chest.keyNameEn || chest.keyName, chest.keyName),
      items: chest.contents.map(itemFor),
    }));
    page.index = Math.max(0, page.chests.findIndex((chest) => chest.id === previous));
    setWallet(data.wallet);
  }

  function setWallet(wallet) {
    if (!wallet) return;
    page.wallet = wallet;
    if (!preview) publishWallet(wallet);
  }

  /** The server's answer to a purchase or an opening is the only thing that changes these numbers. */
  function applyCounts(result) {
    const chest = page.chests.find((entry) => entry.id === result.chestId);
    if (chest) {
      chest.chestCount = result.chestCount;
      chest.keyCount = result.keyCount;
    }
    setWallet(result.wallet);
    syncWallet();
  }

  async function refresh() {
    try {
      const data = await api.list();
      if (disposed) return;
      if (data.chests.length + (data.offSale?.length ?? 0) === 0) return;
      // Sprites and the selection survive; only numbers and contents are replaced. Chests may have come or gone.
      const shown = cur();
      applyList(data);
      renderDots();
      if (shown && cur().id !== shown.id) stage?.showChest(cur(), shown, 1);
      else stage?.setChest(cur());
      renderCase();
      syncWallet();
    } catch {
      // Keep the last known numbers; the next action will report a real problem.
    }
  }

  function setNetworkNotice(visible) {
    const notice = $('net');
    if (notice) notice.hidden = !visible;
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      const entry = { resolve };
      entry.id = setTimeout(() => { pendingSleeps.delete(entry); resolve(); }, ms);
      pendingSleeps.add(entry);
    });
  }

  /** Same idempotency key on every attempt, so however many reach the server only one counts. */
  async function withRetry(call) {
    const deadline = Date.now() + RETRY_WINDOW_MS;
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await call();
        if (!disposed) setNetworkNotice(false);
        return result;
      } catch (error) {
        if (disposed || !isTransient(error) || Date.now() >= deadline) {
          if (!disposed) setNetworkNotice(false);
          throw error;
        }
        setNetworkNotice(true);
        await sleep(Math.min(800 * 2 ** attempt, RETRY_MAX_DELAY_MS));
        if (disposed) throw error;
      }
    }
  }

  function failureMessage(error) {
    return isTransient(error)
      ? tr(
        'The connection is too unstable to confirm. If the chest was spent, the item will be in your bag within a few minutes.',
        'Mạng chập chờn nên chưa xác nhận được. Nếu hòm đã bị trừ, vật phẩm sẽ có trong kho sau ít phút.')
      : chestErrorText(error);
  }

  /* ---------- rendering ---------- */

  function renderCase() {
    const chest = cur();
    $('caseName').textContent = chest.displayName;
    $('caseSub').textContent = chest.displaySub;
    paintSprite($('chipKey'), chest.sp.key);
    paintSprite($('btnKey'), chest.sp.key);
    const contents = $('contents');
    contents.innerHTML = '';
    const ordered = [...chest.items].sort((a, b) => SHOW_ORDER.indexOf(a.rarity) - SHOW_ORDER.indexOf(b.rarity));
    for (const item of ordered) {
      const look = RARITY_LOOK[item.rarity] ?? RARITY_LOOK.COMMON;
      const el = document.createElement('div');
      el.className = 'qh-it';
      el.style.setProperty('--rc', look.color);
      el.title = `${item.name} · ${rarityLabel(item.rarity)}`;
      const canvas = document.createElement('canvas');
      canvas.width = 72;
      canvas.height = 72;
      canvas.setAttribute('aria-hidden', 'true');
      paintSprite(canvas, item.sp);
      // An uploaded picture arrives after this.
      item.sp.ready?.then(() => { if (!disposed && canvas.isConnected) paintSprite(canvas, item.sp); });
      const name = document.createElement('span');
      name.textContent = item.name;
      el.append(canvas, name);
      contents.append(el);
    }
    [...$('dots').children].forEach((dot, index) => dot.setAttribute('aria-current', String(index === page.index)));
    root.style.setProperty('--glow', `rgb(${chest.light})`);
    $('odds').innerHTML = chest.odds.map((odd) => {
      const look = RARITY_LOOK[odd.rarity] ?? RARITY_LOOK.COMMON;
      return `<li style="--rc:${look.color}"><i></i>${escapeHtml(rarityLabel(odd.rarity))} <b>${percentText(odd.percent)}</b></li>`;
    }).join('');
  }

  function syncWallet() {
    if (!page.loaded) return;
    const chest = cur();
    const { chest: chests, key: keys } = has();
    $('nChest').textContent = `×${chests}`;
    $('nKey').textContent = keys;
    $('nCoin').textContent = fmt(page.wallet?.balance ?? 0);
    $('nInv').textContent = fmt(page.wallet?.itemCount ?? 0);

    const button = $('openBtn'), label = $('openLbl'), meta = $('meta');
    const busy = page.opening || page.buying;
    $('buy').hidden = preview || !chest.onSale;
    if ((chests < 1 || keys < 1) && !chest.onSale) {
      // What is left can still be opened with what the player finds on the market, but the shop has closed.
      label.textContent = tr('Open', 'Mở');
      button.disabled = true;
      meta.textContent = tr('No longer on sale', 'Đã ngừng bán');
    } else if (chests < 1) {
      label.textContent = tr(`Buy chest · ${fmt(chest.chestPrice)} xu`, `Mua hòm · ${fmt(chest.chestPrice)} xu`);
      button.disabled = busy || !canAfford(chest.chestPrice);
      meta.textContent = canAfford(chest.chestPrice)
        ? tr(`No ${chest.displayName} left`, `Hết ${chest.displayName}`)
        : tr('Not enough coins', 'Không đủ xu');
    } else if (keys < 1) {
      label.textContent = tr(`Buy key · ${fmt(chest.keyPrice)} xu`, `Mua chìa · ${fmt(chest.keyPrice)} xu`);
      button.disabled = busy || !canAfford(chest.keyPrice);
      meta.textContent = canAfford(chest.keyPrice)
        ? tr(`No ${chest.displayKey} left`, `Hết ${chest.displayKey}`)
        : tr('Not enough coins', 'Không đủ xu');
    } else {
      label.textContent = tr('Open', 'Mở');
      button.disabled = busy;
      meta.textContent = tr(`Uses 1 ${chest.displayKey} · ${keys} left`, `Dùng 1 ${chest.displayKey} · còn ${keys}`);
    }

    const buyKey = root.querySelector('[data-qh-buy="key"]');
    const buyChest = root.querySelector('[data-qh-buy="chest"]');
    buyKey.textContent = tr(`Buy key · ${fmt(chest.keyPrice)} xu`, `Mua chìa · ${fmt(chest.keyPrice)} xu`);
    buyChest.textContent = tr(`Buy chest · ${fmt(chest.chestPrice)} xu`, `Mua hòm · ${fmt(chest.chestPrice)} xu`);
    buyKey.disabled = busy;
    buyChest.disabled = busy;
  }

  function syncSound() {
    const button = $('soundBtn'), muted = AU.isMuted();
    const label = muted ? tr('Sound on', 'Bật âm thanh') : tr('Sound off', 'Tắt âm thanh');
    button.setAttribute('aria-pressed', String(!muted));
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  /* ---------- actions ---------- */

  function selectCase(next) {
    if (!stage || stage.mode() !== 'idle') return;
    const total = page.chests.length;
    const index = (next + total) % total;
    if (index === page.index) return;
    let dir = index > page.index ? 1 : -1;
    if (Math.abs(index - page.index) === total - 1) dir *= -1;
    const from = cur();
    page.index = index;
    stage.showChest(cur(), from, dir);
    renderCase();
    syncWallet();
    AU.init();
    AU.whoosh();
    say(cur().displayName);
  }

  async function startOpen() {
    if (!stage || stage.mode() !== 'idle' || page.opening || page.buying) return;
    const chest = cur();
    if (chest.chestCount < 1 || chest.keyCount < 1) return;
    if (!stage.start()) return;
    page.opening = true;
    const idempotencyKey = newRequestId();
    try {
      const result = await withRetry(() => api.open(chest.id, idempotencyKey));
      if (disposed) return;
      page.opening = false;
      applyCounts(result);
      stage.resolve(itemFor(result.item));
    } catch (error) {
      if (disposed) return;
      page.opening = false;
      const message = failureMessage(error);
      stage.abort(() => {
        toast(message, 'error');
        refresh();
      });
    }
  }

  async function buy(kind) {
    if (!stage || stage.mode() !== 'idle' || page.opening || page.buying) return;
    const chest = cur();
    page.buying = true;
    syncWallet();
    const idempotencyKey = newRequestId();
    const price = kind === 'key' ? chest.keyPrice : chest.chestPrice;
    try {
      const result = await withRetry(() => (kind === 'key'
        ? api.buyKey(chest.id, idempotencyKey, price)
        : api.buyChest(chest.id, idempotencyKey, price)));
      if (disposed) return;
      page.buying = false;
      page.guardUntil = performance.now() + DOUBLE_CLICK_GUARD_MS;
      applyCounts(result);
      AU.init();
      AU.clack();
      say(kind === 'key'
        ? tr(`Bought 1 ${chest.displayKey}.`, `Đã mua 1 ${chest.displayKey}.`)
        : tr(`Bought 1 ${chest.displayName}.`, `Đã mua 1 ${chest.displayName}.`));
    } catch (error) {
      if (disposed) return;
      page.buying = false;
      page.guardUntil = performance.now() + DOUBLE_CLICK_GUARD_MS;
      syncWallet();
      toast(failureMessage(error), 'error');
      refresh();
    }
  }

  function onMainButton() {
    if (performance.now() < page.guardUntil) return;
    const { chest, key } = has();
    if ((chest < 1 || key < 1) && !cur().onSale) return;
    if (chest < 1) buy('chest');
    else if (key < 1) buy('key');
    else startOpen();
  }

  function onModeChange(mode) {
    syncWallet();
    // A retry notice only makes sense while the reel is waiting for the server.
    if (mode === 'idle' || mode === 'reveal') setNetworkNotice(false);
  }

  function onReveal(item) {
    const rarity = RARITY_LOOK[item.rarity] ?? RARITY_LOOK.COMMON;
    $('gotName').textContent = item.name;
    $('gotRar').textContent = rarityLabel(item.rarity);
    $('gotRar').style.color = rarity.color;
    say(tr(`You received ${item.name}, ${rarityLabel(item.rarity)}.`, `Bạn nhận được ${item.name}, hạng ${rarityLabel(item.rarity)}.`));
    const id = setTimeout(() => {
      timers.delete(id);
      $('keepBtn').focus({ preventScroll: true });
    }, 450);
    timers.add(id);
  }

  function bindControls() {
    on($('prevBtn'), 'click', () => selectCase(page.index - 1));
    on($('nextBtn'), 'click', () => selectCase(page.index + 1));
    on($('openBtn'), 'click', onMainButton);
    on($('buy'), 'click', (event) => {
      const button = event.target.closest('[data-qh-buy]');
      if (button && !button.disabled) buy(button.dataset.qhBuy);
    });
    on($('keepBtn'), 'click', () => {
      stage.toIdle();
      $('openBtn').focus({ preventScroll: true });
    });
    on($('againBtn'), 'click', () => {
      stage.toIdle();
      const { chest, key } = has();
      if (chest > 0 && key > 0) startOpen();
      else $('openBtn').focus({ preventScroll: true });
    });
    on($('skipBtn'), 'click', () => stage.skip());
    on($('soundBtn'), 'click', () => {
      AU.setMuted(!AU.isMuted());
      AU.init();
      syncSound();
    });
    on($('oddsBtn'), 'click', () => {
      const odds = $('odds');
      odds.hidden = !odds.hidden;
      $('oddsBtn').setAttribute('aria-expanded', String(!odds.hidden));
      stage.relayout();
    });

    // A swipe also ends in a click on the same element; it must only change the chest, never spend one.
    const canvas = $('stage');
    let downX = null;
    let swiped = false;
    on(canvas, 'pointerdown', (event) => {
      downX = event.clientX;
      swiped = false;
    });
    on(canvas, 'pointerup', (event) => {
      if (downX !== null && Math.abs(event.clientX - downX) > SWIPE_PX && stage.mode() === 'idle') {
        swiped = true;
        selectCase(page.index + (event.clientX < downX ? 1 : -1));
      }
      downX = null;
    });
    on(canvas, 'click', () => {
      if (swiped) {
        swiped = false;
        return;
      }
      if (stage.mode() !== 'idle') stage.skip();
      else if (performance.now() >= page.guardUntil) startOpen();
    });
    on(document, 'keydown', (event) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return;
      if (event.key === 'Escape') stage.skip();
      else if (event.key === 'ArrowLeft') selectCase(page.index - 1);
      else if (event.key === 'ArrowRight') selectCase(page.index + 1);
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    listeners.abort();
    navObserver?.disconnect();
    timers.forEach(clearTimeout);
    timers.clear();
    pendingSleeps.forEach((entry) => {
      clearTimeout(entry.id);
      entry.resolve();
    });
    pendingSleeps.clear();
    stage?.dispose();
    stage = null;
  }

  function renderDots() {
    const dots = $('dots');
    dots.replaceChildren();
    page.chests.forEach((chest, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'qh-dot';
      dot.setAttribute('aria-label', chest.displayName);
      on(dot, 'click', () => selectCase(index));
      dots.append(dot);
    });
  }

  function showLoadError(error) {
    const empty = $('empty');
    empty.innerHTML = `<span>${escapeHtml(chestErrorText(error))}</span><button class="qh-btn-ghost" type="button" id="qh-retry">${tr('Try again', 'Thử lại')}</button>`;
    on($('retry'), 'click', () => {
      empty.textContent = tr('Opening the evidence room…', 'Đang mở kho vật chứng…');
      load();
    });
  }

  async function load() {
    try {
      const data = await api.list();
      if (disposed) return;
      applyList(data);
      if (page.chests.length === 0) {
        $('empty').textContent = tr('No chests on sale at the moment.', 'Chưa có hòm nào đang bán.');
        return;
      }
      page.loaded = true;
      $('empty').hidden = true;
      root.querySelectorAll('[data-qh-ready]').forEach((el) => { el.hidden = false; });
      renderDots();
      renderCase();
      stage = createChestStage({
        app: root,
        canvas: $('stage'),
        spot: $('spot'),
        keyIcon: $('btnKey'),
        chest: cur(),
        rarities,
        filler: fillerItem,
        onMode: onModeChange,
        onReveal,
      });
      bindControls();
      syncSound();
      syncWallet();
    } catch (error) {
      if (!disposed) showLoadError(error);
    }
  }

  signal?.addEventListener('abort', dispose, { once: true });
  load();
  return dispose;
}
