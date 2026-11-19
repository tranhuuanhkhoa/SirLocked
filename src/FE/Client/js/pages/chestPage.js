import '../../../css/47-chest.css';
import { chestApi } from '../api/chestApi.js';
import { newRequestId } from '../api/marketApi.js';
import { publishWallet } from '../components/walletChip.js';
import { navigate } from '../services/navigation.js';
import { tr, uiLanguage } from '../services/i18n.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { AU } from './chest/chestAudio.js';
import { chestPictureUrl, defSprite, keyArtSprite, paintSprite, scenePictureUrl } from './chest/chestSprites.js';
import { createVaultParticles } from './chest/vaultParticles.js';
import { createVaultStage } from './chest/vaultStage.js';
import { isCosmeticDef } from '../cosmetics/icons.js';
import { categoryLabel, errorText, fmt, itemIcon, rarityLabel } from './market/marketKit.js';

const FONTS_ID = 'qh-fonts';
// index.html already loads these families; the design also needs the heavier and italic cuts.
const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;0,900;1,600;1,700&family=Crimson+Text:ital,wght@0,400;0,600;1,400&family=Source+Code+Pro:wght@500;600;700&display=swap';

/** The API speaks in market rarities; the design colours them C/R/E/L/M and the sound names them as the old stage did. */
const RARITY_LOOK = {
  COMMON: { r: 'common', letter: 'C', rgb: '142, 154, 174' },
  RARE: { r: 'rare', letter: 'R', rgb: '79, 128, 222' },
  EPIC: { r: 'myth', letter: 'E', rgb: '154, 102, 240' },
  LEGENDARY: { r: 'leg', letter: 'L', rgb: '224, 70, 58' },
  MYSTERY: { r: 'gold', letter: 'M', rgb: '232, 181, 58' },
};
const SHOW_ORDER = ['MYSTERY', 'LEGENDARY', 'EPIC', 'RARE', 'COMMON'];
const BAR_ORDER = [...SHOW_ORDER].reverse();
const rarityStyle = (rarity) => {
  const look = RARITY_LOOK[rarity] ?? RARITY_LOOK.COMMON;
  return `--c:var(--r-${look.letter});--crgb:${look.rgb};--tc:var(--r-${look.letter}-t)`;
};

/** The three rooms of the design. An admin's chest picks one through its template, or through its icon without one. */
const THEMES = {
  seal: {
    id: 'niem-phong', particles: 'dust', image: '/assets/chests/hom-niem-phong.png', size: [336, 301],
    stamp: ['SEALED', 'NIÊM PHONG'], stampColor: '#9e3f2a', c: '#e9b75a', rgb: '233, 183, 90', light: '240,164,58',
  },
  bank: {
    id: 'nha-bang', particles: 'coins', image: '/assets/chests/ket-nha-bang.png', size: [322, 301],
    stamp: ['SAFE', 'KÉT SẮT'], stampColor: '#2f6363', c: '#6fc2b0', rgb: '111, 194, 176', light: '120,190,230',
  },
  lacquer: {
    id: 'son-mai', particles: 'petals', image: '/assets/chests/trap-son-mai.png', size: [322, 301],
    stamp: ['LACQUER', 'SƠN MÀI'], stampColor: '#8a2a1f', c: '#e0574a', rgb: '224, 87, 74', light: '70,200,150',
  },
  // The outfits' own case: a night street in Whitechapel, a blood moon, gaslight and drifting embers.
  whitechapel: {
    id: 'whitechapel', particles: 'embers', image: '/assets/chests/hom-dem-whitechapel.png', size: [336, 301],
    stamp: ['WHITECHAPEL 1888', 'WHITECHAPEL 1888'], stampColor: '#9e1f33', c: '#d4566a', rgb: '212, 86, 106', light: '190,52,58',
  },
};
const ICON_TEMPLATE = { chest_seal: 'seal', chest_bank: 'bank', chest_lacquer: 'lacquer', chest_whitechapel: 'whitechapel' };
const RGB_TEXT = /^\d{1,3},\d{1,3},\d{1,3}$/;

function themeOf(chest) {
  if (chest.look?.scene) return sceneTheme(chest.look.scene);
  const key = THEMES[chest.look?.template] ? chest.look.template : ICON_TEMPLATE[chest.iconKey] ?? 'seal';
  return THEMES[key];
}

const SCENE_PARTICLES = new Set(['dust', 'coins', 'petals', 'embers', 'rise', 'fall', 'none']);

/** A room an admin made (look.scene): its own picture behind the chest, its particles, its colours and its stamp. */
function sceneTheme(scene) {
  const colour = (value, fallback) => (RGB_TEXT.test(String(value ?? '').replace(/\s/g, '')) ? String(value).replace(/\s/g, '') : fallback);
  const light = colour(scene.accent, '233,183,90');
  return {
    id: 'custom',
    custom: true,
    particles: SCENE_PARTICLES.has(scene.particles) ? scene.particles : 'dust',
    particleUrl: scenePictureUrl(scene.particleUrl),
    backdrop: scenePictureUrl(scene.backdropUrl),
    image: scenePictureUrl(scene.chestImageUrl),
    size: [336, 301],
    stamp: [scene.stampTextEn || scene.stampText || '', scene.stampText || ''],
    stampColor: `rgb(${colour(scene.stampColor, '158,63,42')})`,
    c: `rgb(${light})`,
    rgb: light.replace(/,/g, ', '),
    light,
    hi: colour(scene.accent2, light),
  };
}

/** A light colour an admin chose wins over the design's accent; the seeded default of the template means "as designed". */
function accentOf(chest, theme) {
  const light = chest.look?.light?.replace(/\s/g, '');
  if (!light || light === theme.light || !RGB_TEXT.test(light)) return null;
  const hi = chest.look?.hi?.replace(/\s/g, '');
  return { rgb: light, hi: hi && RGB_TEXT.test(hi) ? hi : light };
}

/** "Bến Sương · Nº 07" is the place and the number of the storage slip. */
function slipLabels(subtitle, index) {
  const parts = String(subtitle ?? '').split('·').map((part) => part.trim()).filter(Boolean);
  const at = parts.findIndex((part) => /^N[º°o.]?\s*\d+/i.test(part));
  const number = at >= 0 ? parts.splice(at, 1)[0] : `Nº ${String(index + 1).padStart(2, '0')}`;
  return { place: parts.join(' · '), number };
}

const TYPE_LABELS = {
  CURIO: ['Collectible', 'Sưu tầm'],
  FRAME: ['Avatar frame', 'Viền ảnh đại diện'],
  TITLE: ['Title', 'Danh hiệu'],
  ENTRANCE: ['Lobby entrance', 'Hiệu ứng vào sảnh'],
  SKIN_SHERLOCK: ['Sherlock outfit', 'Trang phục Sherlock'],
  SKIN_WATSON: ['Watson outfit', 'Trang phục Watson'],
};
function typeLabel(category) {
  const label = TYPE_LABELS[category];
  return label ? tr(label[0], label[1]) : categoryLabel(category);
}

/** How long a retry keeps the reel waiting: long enough for the recovery sweep to finish a crashed request. */
const RETRY_WINDOW_MS = 90_000;
const RETRY_MAX_DELAY_MS = 8_000;
/** Blocks the second click of a double click once a purchase turns the main button into "Mở hòm". */
const DOUBLE_CLICK_GUARD_MS = 400;
const SWIPE_PX = 50;
/** Cosmetic art may still be loading when a card is painted: these repaints pick it up. */
const REPAINT_MS = [250, 700, 1600, 3700];

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

const ICON = {
  pin: '<svg class="qh-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  bag: '<svg class="qh-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16v12H4zM2 4h20v4H2zM10 12h4"/></svg>',
  sound: '<svg class="qh-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path class="qh-wave" d="M16.5 8.5a5 5 0 0 1 0 7"/><path class="qh-x" d="M17 9l5 6M22 9l-5 6"/></svg>',
  prev: '<svg class="qh-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg class="qh-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
};

const BACKDROP = `
  <div class="qh-backdrop" aria-hidden="true">
    <div class="qh-wall"></div>
    <div class="qh-theme qh-theme-fog"><div class="qh-lamp"></div><div class="qh-fog qh-f1"></div><div class="qh-fog qh-f2"></div><div class="qh-fog qh-f3"></div></div>
    <div class="qh-theme qh-theme-ring"><div class="qh-ring"><svg viewBox="0 0 200 200" fill="none" stroke="rgba(111,194,176,.22)"><circle cx="100" cy="100" r="96" stroke-width="1.2"/><circle cx="100" cy="100" r="84" stroke-width="5" stroke="rgba(233,200,115,.10)"/><circle cx="100" cy="100" r="70" stroke-width="1"/><circle cx="100" cy="100" r="40" stroke-width="1" stroke-dasharray="2 4"/><g stroke-width="1.4"><path d="M100 30V60M100 140v30M30 100h30M140 100h30M50.5 50.5l21 21M128.5 128.5l21 21M149.5 50.5l-21 21M71.5 128.5l-21 21"/></g><g fill="rgba(233,200,115,.16)" stroke="none"><circle cx="100" cy="10" r="3"/><circle cx="100" cy="190" r="3"/><circle cx="10" cy="100" r="3"/><circle cx="190" cy="100" r="3"/><circle cx="36.4" cy="36.4" r="3"/><circle cx="163.6" cy="163.6" r="3"/><circle cx="163.6" cy="36.4" r="3"/><circle cx="36.4" cy="163.6" r="3"/></g></svg></div></div>
    <div class="qh-theme qh-theme-sun"><div class="qh-sun"><svg viewBox="0 0 200 200" fill="none" stroke="rgba(239,212,134,.5)" stroke-width="1"><path d="M30 120c10-12 26-12 34 0 6-10 22-10 28 0M110 70c10-12 26-12 34 0 6-10 22-10 28 0M40 60c8-10 20-10 26 0 5-8 16-8 21 0M120 140c8-10 20-10 26 0 5-8 16-8 21 0"/></svg></div><span class="qh-lantern" style="left:12%;animation-delay:-2s"></span><span class="qh-lantern" style="left:24%;animation-delay:-9s;scale:.7"></span><span class="qh-lantern" style="left:78%;animation-delay:-5s"></span><span class="qh-lantern" style="left:88%;animation-delay:-13s;scale:.8"></span><span class="qh-lantern" style="left:66%;animation-delay:-16s;scale:.6"></span></div>
    <div class="qh-theme qh-theme-custom"><div class="qh-custom-scene" id="qh-scene"></div></div>
    <div class="qh-theme qh-theme-wc">
      <div class="qh-wc-moon"></div>
      <svg class="qh-wc-roofs" viewBox="0 0 1200 220" preserveAspectRatio="none"><path d="M0 220V138h46v-26h18v26h40V96l34-30 34 30v42h28v-58h14V62h12v18h22v58h36V108l44-36 44 36v30h30V82h16V64h14v18h20v56h40v-28h56v28h24V92l40-32 40 32v46h26v-52h12V70h14v16h26v52h44v-36h70v36h22V100l36-30 36 30v38h34V86h16V66h12v20h18v52h46v-30h60v30h34v82z"/></svg>
      <div class="qh-wc-gas qh-wc-gas--l"></div><div class="qh-wc-gas qh-wc-gas--r"></div>
      <div class="qh-fog qh-f1"></div><div class="qh-fog qh-f2"></div>
    </div>
    <div class="qh-shaft"></div>
    <canvas class="qh-particles" id="qh-particles"></canvas>
  </div>`;

function markup(preview) {
  return `
    <div class="qh-app" data-mode="idle" data-chest="niem-phong"${preview ? ' data-preview' : ''}>
      ${BACKDROP}
      <div class="qh-empty" id="qh-empty" role="status">${tr('Opening the evidence room…', 'Đang mở kho vật chứng…')}</div>

      <div class="qh-bar" data-qh-ready hidden>
        <p class="qh-crumb">${tr('Chest vault', 'Kho rương')} · <b id="qh-crumbName"></b></p>
        <div class="qh-wallet" aria-label="${tr('Your balance', 'Số dư của bạn')}">
          <span class="qh-chip" title="${tr('Keys of the chosen chest', 'Chìa của hòm đang chọn')}"><canvas class="qh-px" id="qh-chipKey" width="42" height="20" aria-hidden="true"></canvas><b id="qh-nKey"></b><small>${tr('keys', 'chìa')}</small></span>
          <span class="qh-chip" title="${tr('Chests held', 'Hòm đang giữ')}"><b id="qh-nChest"></b><small>${tr('chests', 'hòm')}</small></span>
          <span class="qh-chip qh-w-xu" data-qh-wallet><span class="qh-coin" aria-hidden="true"></span><b id="qh-nCoin"></b><small>xu</small></span>
          <a class="qh-chip" href="/market/sell" data-qh-wallet title="${tr('Open your bag', 'Mở kho đồ')}">${ICON.bag}${tr('Bag', 'Kho')} <b id="qh-nInv"></b></a>
          <button class="qh-chip qh-soundBtn" type="button" id="qh-soundBtn">${ICON.sound}</button>
        </div>
      </div>

      <div class="qh-grid" data-qh-ready hidden>
        <article class="qh-slip" aria-labelledby="qh-caseName">
          <div class="qh-slip-head"><span>${tr('Storage slip', 'Phiếu lưu kho')}</span><span id="qh-slipNo"></span></div>
          <h1 id="qh-caseName"></h1>
          <div class="qh-slip-sub"><p class="qh-place">${ICON.pin}<span id="qh-place"></span></p><span class="qh-stamp" id="qh-stamp" aria-hidden="true"></span></div>
          <dl class="qh-rows">
            <div><dt>${tr('Held', 'Đang giữ')}</dt><dd><b id="qh-sChests"></b> ${tr('chests', 'hòm')} · <b id="qh-sKeys"></b> ${tr('keys', 'chìa')}</dd></div>
            <div><dt id="qh-sPriceLabel">${tr('Chest price', 'Giá hòm')}</dt><dd id="qh-sPriceValue"></dd></div>
            <div><dt>${tr('Opened with', 'Chìa mở')}</dt><dd><span id="qh-sKey"></span> · <b id="qh-sKeyPrice"></b> xu</dd></div>
            <div><dt>${tr('Inside', 'Đồ bên trong')}</dt><dd><b id="qh-sCount"></b> ${tr('items', 'món')}</dd></div>
          </dl>
          <div class="qh-odds-box">
            <p>${tr('Published drop rates', 'Tỉ lệ rơi công khai')}</p>
            <div class="qh-odds-bar" id="qh-oddsBar" role="img"></div>
            <ul class="qh-odds" id="qh-odds"></ul>
          </div>
        </article>

        <section class="qh-stage" aria-label="${tr('Chest display', 'Bục trưng bày hòm')}">
          <div class="qh-podium" id="qh-podium">
            <div class="qh-seal" aria-hidden="true"><svg viewBox="0 0 400 400"><defs><path id="qh-sealPath" d="M200 200m-176 0a176 176 0 1 1 352 0a176 176 0 1 1-352 0"/></defs><circle cx="200" cy="200" r="194" fill="none" style="stroke:rgba(var(--accent-rgb),.28)" stroke-width="1"/><circle cx="200" cy="200" r="160" fill="none" style="stroke:rgba(var(--accent-rgb),.22)" stroke-width="1.4" stroke-dasharray="1 6"/><text><textPath href="#qh-sealPath" id="qh-sealText" textLength="1100" lengthAdjust="spacing"></textPath></text></svg></div>
            <div class="qh-pedestal" aria-hidden="true"></div>
            <button class="qh-chest" id="qh-chest" type="button"><img class="qh-px" id="qh-chestImg" alt="" width="336" height="301" draggable="false"></button>
            <span class="qh-seam" aria-hidden="true"></span>
            <button class="qh-nav qh-prev" type="button" id="qh-prevBtn" aria-label="${tr('Previous chest', 'Hòm trước')}">${ICON.prev}</button>
            <button class="qh-nav qh-next" type="button" id="qh-nextBtn" aria-label="${tr('Next chest', 'Hòm sau')}">${ICON.next}</button>
          </div>
          <div class="qh-cta">
            <img class="qh-wc-figure qh-wc-figure--l qh-px" src="/assets/pixel/skins/whitechapel/icon-sherlock.png" alt="" aria-hidden="true" draggable="false">
            <img class="qh-wc-figure qh-wc-figure--r qh-px" src="/assets/pixel/skins/whitechapel/icon-watson.png" alt="" aria-hidden="true" draggable="false">
            <button class="qh-btn qh-btn-main" type="button" id="qh-openBtn"><canvas class="qh-px" id="qh-btnKey" width="42" height="20" aria-hidden="true"></canvas><span id="qh-openLbl"></span></button>
            <p class="qh-meta" id="qh-meta" aria-live="polite"></p>
            <div class="qh-links" id="qh-buy">
              <button class="qh-lnk" type="button" data-qh-buy="key"><canvas class="qh-px" id="qh-lnkKey" width="42" height="20" aria-hidden="true"></canvas><span></span></button>
              <button class="qh-lnk" type="button" data-qh-buy="chest"><span></span></button>
            </div>
            <button class="qh-demo" type="button" id="qh-demoBtn">${tr('Preview the opening effect', 'Xem thử hiệu ứng mở hòm')}</button>
          </div>
          <nav class="qh-drawer" id="qh-dots" aria-label="${tr('Choose a chest', 'Chọn hòm')}"></nav>
        </section>

        <aside class="qh-loot" aria-labelledby="qh-h-contents">
          <div class="qh-loot-head"><h2 id="qh-h-contents">${tr('You may get', 'Có thể nhận được')}</h2><span id="qh-lootCount"></span></div>
          <div class="qh-loot-scroll" id="qh-contents"></div>
        </aside>
      </div>

      <p class="qh-net" id="qh-net" role="status" hidden>${tr('Unstable connection, trying again…', 'Mạng chập chờn, đang thử lại…')}</p>

      <div class="qh-overlay" id="qh-reelLayer" hidden>
        <div class="qh-reel-wrap">
          <p class="qh-reel-title" id="qh-reelTitle"></p>
          <div class="qh-reel" id="qh-reel"><div class="qh-track" id="qh-track"></div><span class="qh-needle" aria-hidden="true"></span></div>
          <button class="qh-btn qh-btn-ghost qh-skip" type="button" id="qh-skipBtn">${tr('Fast-forward · Esc', 'Tua nhanh · Esc')}</button>
        </div>
      </div>

      <div class="qh-overlay" id="qh-revealLayer" hidden>
        <div class="qh-rays" aria-hidden="true"></div>
        <div class="qh-reveal" id="qh-reveal" role="dialog" aria-modal="true" aria-labelledby="qh-gotName">
          <div class="qh-rv-vis" id="qh-gotVis"></div>
          <p class="qh-rv-rar" id="qh-gotRar"></p>
          <h2 class="qh-rv-name" id="qh-gotName">—</h2>
          <p class="qh-rv-type" id="qh-gotType"></p>
          <div class="qh-rv-acts">
            <button class="qh-btn qh-btn-main" type="button" id="qh-againBtn">${tr('Open another', 'Mở tiếp')}</button>
            <button class="qh-btn qh-btn-ghost" type="button" id="qh-invBtn">${tr('See it in the bag', 'Xem trong kho')}</button>
            <button class="qh-btn qh-btn-ghost" type="button" id="qh-closeBtn">${tr('Close', 'Đóng')}</button>
          </div>
        </div>
      </div>
      <div class="qh-burst" id="qh-burst" aria-hidden="true"></div>
      <div class="qh-sr" aria-live="assertive" id="qh-live"></div>
    </div>`;
}

/**
 * /kho-ruong — Mở hòm, laid out as the evidence vault of kho-ruong-sirlocked.html. The server decides everything;
 * this page only shows what it answers. `api` and `preview` are for the admin's "try it out": the same screen against
 * an API that stores nothing, without a wallet or a shop.
 */
export async function renderChestPage(app, { signal, api = chestApi, preview = false } = {}) {
  loadFonts();
  render(app, markup(preview));

  const root = app.querySelector('.qh-app');
  const $ = (id) => root.querySelector(`#qh-${id}`);
  const listeners = new AbortController();
  const on = (target, type, handler) => target.addEventListener(type, handler, { signal: listeners.signal });
  const say = (text) => { $('live').textContent = text; };
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduce = () => reduceQuery.matches;

  // The shell stays on screen: the room fills at least what the header leaves.
  const navRoot = document.getElementById('nav-root');
  const measureNav = () => root.style.setProperty('--qh-nav', `${preview ? 0 : navRoot?.offsetHeight ?? 0}px`);
  measureNav();
  const navObserver = navRoot && !preview ? new ResizeObserver(measureNav) : null;
  navObserver?.observe(navRoot);

  const page = {
    chests: [], wallet: null, index: 0,
    opening: false, buying: false, demo: false, guardUntil: 0, loaded: false,
    // False: the shop sells keys only and chests come from the weekly challenge (Chests:SellChests on the server).
    chestsForSale: true,
  };
  let stage = null;
  let particles = null;
  let disposed = false;
  const pendingSleeps = new Set();
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!disposed) fn();
    }, ms);
    timers.add(id);
  };

  const cur = () => page.chests[page.index];
  const has = () => ({ chest: cur().chestCount, key: cur().keyCount });
  const canAfford = (price) => (page.wallet?.balance ?? 0) >= price;

  function itemFor(def) {
    const rarity = RARITY_LOOK[def.rarity] ? def.rarity : 'COMMON';
    // Case-file gear of the market (Hòm Đêm Whitechapel) has no pixel icon or picture: it keeps the drawing of its type
    // that the market and the admin show, instead of the magnifier every unknown icon falls back to.
    const gear = def.category !== 'TITLE' && !def.iconKey && !def.visual?.imageUrl && !isCosmeticDef(def);
    return {
      id: def.id, name: tr(def.nameEn || def.name, def.name), rarity, r: RARITY_LOOK[rarity].r, gear,
      category: def.category, type: typeLabel(def.category), sp: def.category === 'TITLE' || gear ? null : defSprite(def), def,
    };
  }

  /** One item for the reel, weighted like the published odds. The result never comes from here. */
  function fillerItem() {
    const { items, odds } = cur();
    let ticket = Math.random() * odds.reduce((sum, odd) => sum + Number(odd.percent), 0);
    const odd = odds.find((entry) => (ticket -= Number(entry.percent)) < 0) ?? odds[0];
    const pool = items.filter((item) => item.rarity === odd?.rarity);
    const from = pool.length ? pool : items;
    return from[Math.floor(Math.random() * from.length)];
  }

  /** The picture of an item: a nameplate for a title, else its sprite on a canvas sized for where it goes. */
  function visualOf(item, place) {
    if (item.gear) {
      const holder = document.createElement('template');
      holder.innerHTML = itemIcon(item.def, { tile: 52, card: 72, big: 150 }[place]);
      const svg = holder.content.firstElementChild;
      svg.classList.add('qh-svg');
      return svg;
    }
    if (item.category === 'TITLE' || !item.sp) {
      const plate = document.createElement('span');
      plate.className = 'qh-plate';
      plate.textContent = item.name;
      return plate;
    }
    const sprite = item.sp;
    const side = { tile: sprite.smooth ? 160 : 96, card: sprite.smooth ? 192 : 144, big: sprite.smooth ? 360 : 192 }[place];
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    canvas.setAttribute('aria-hidden', 'true');
    if (!sprite.smooth) canvas.className = 'qh-px';
    paintSprite(canvas, sprite);
    const repaint = () => { if (!disposed && canvas.isConnected) paintSprite(canvas, sprite); };
    // An uploaded picture says when it lands; a cosmetic's art repaints its own canvas a few times.
    if (sprite.ready) sprite.ready.then(repaint);
    else if (sprite.smooth) REPAINT_MS.forEach((ms) => later(repaint, ms));
    return canvas;
  }

  function makeCard(item) {
    const card = document.createElement('div');
    card.className = 'qh-rt';
    card.setAttribute('style', rarityStyle(item.rarity));
    const icon = document.createElement('span');
    icon.className = 'qh-ic';
    icon.append(visualOf(item, 'card'));
    const name = document.createElement('span');
    name.className = 'qh-rt-name';
    name.textContent = item.name;
    card.append(icon, name);
    return card;
  }

  function applyList(data) {
    const previous = cur()?.id;
    // After them, the chests switched off that this player still holds a copy of: those can still be opened.
    page.chests = [...data.chests, ...(data.offSale ?? [])].map((chest, index) => {
      const theme = themeOf(chest);
      return {
        ...chest,
        theme,
        // A scene's colours are its own: they are what the admin chose when making the room.
        accent: theme.custom ? { rgb: theme.light, hi: theme.hi } : accentOf(chest, theme),
        slip: slipLabels(tr(chest.subtitleEn || chest.subtitle, chest.subtitle), index),
        keySprite: keyArtSprite(chest),
        picture: chestPictureUrl(chest),
        onSale: chest.active !== false,
        odds: (chest.odds ?? data.odds ?? []).filter((odd) => Number(odd.percent) > 0),
        displayName: tr(chest.nameEn || chest.name, chest.name),
        displayKey: tr(chest.keyNameEn || chest.keyName, chest.keyName),
        items: chest.contents.map(itemFor),
      };
    });
    page.index = Math.max(0, page.chests.findIndex((chest) => chest.id === previous));
    page.chestsForSale = data.chestsForSale !== false;
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
      // The selection survives; numbers, contents and the list of chests are replaced.
      applyList(data);
      renderDots();
      renderCase();
      paintChest();
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

  function paintChest() {
    const image = $('chestImg');
    const { image: drawing, id, size } = cur().theme;
    // An admin's own picture of the chest takes the drawing's place, in the same box; the room around it stays the template's.
    const src = cur().picture || drawing;
    if (image.getAttribute('src') !== src) {
      image.src = src;
      image.width = size[0];
      image.height = size[1];
    }
    image.classList.toggle('qh-px', !cur().picture);
    image.classList.toggle('qh-custom', Boolean(cur().picture));
    image.dataset.id = id;
  }

  function renderOdds(chest) {
    const odds = [...chest.odds].sort((a, b) => BAR_ORDER.indexOf(a.rarity) - BAR_ORDER.indexOf(b.rarity));
    const swatch = (rarity) => `var(--r-${(RARITY_LOOK[rarity] ?? RARITY_LOOK.COMMON).letter})`;
    const bar = $('oddsBar');
    bar.innerHTML = odds.map((odd) => `<i style="flex:${Number(odd.percent)} 1 0;background:${swatch(odd.rarity)}"></i>`).join('');
    bar.setAttribute('aria-label', odds.map((odd) => `${rarityLabel(odd.rarity)} ${percentText(odd.percent)}`).join(', '));
    $('odds').innerHTML = odds.map((odd) =>
      `<li><i style="background:${swatch(odd.rarity)}"></i>${escapeHtml(rarityLabel(odd.rarity))}<b>${percentText(odd.percent)}</b></li>`).join('');
  }

  function renderContents(chest) {
    const box = $('contents');
    box.replaceChildren();
    for (const rarity of SHOW_ORDER) {
      const list = chest.items.filter((item) => item.rarity === rarity);
      if (!list.length) continue;
      const odd = chest.odds.find((entry) => entry.rarity === rarity);
      const tier = document.createElement('section');
      tier.className = 'qh-tier';
      tier.setAttribute('style', rarityStyle(rarity));
      tier.innerHTML = `<h3><i></i>${escapeHtml(rarityLabel(rarity))} <em>· ${list.length} ${tr('items', 'món')}</em><span class="qh-pct">${odd ? percentText(odd.percent) : '—'}</span></h3><ul class="qh-tiles"></ul>`;
      const tiles = tier.querySelector('ul');
      for (const item of list) {
        const tile = document.createElement('li');
        tile.className = 'qh-it';
        tile.title = `${item.name} — ${item.type}`;
        const icon = document.createElement('span');
        icon.className = 'qh-ic';
        icon.append(visualOf(item, 'tile'));
        const name = document.createElement('span');
        name.className = 'qh-nm';
        name.textContent = item.name;
        const type = document.createElement('span');
        type.className = 'qh-ty';
        type.textContent = item.type;
        tile.append(icon, name, type);
        tiles.append(tile);
      }
      box.append(tier);
    }
    box.scrollTop = 0;
    $('lootCount').textContent = `${chest.items.length} ${tr('items', 'món')}`;
  }

  function renderCase() {
    const chest = cur();
    root.dataset.chest = chest.theme.id;
    const scene = $('scene');
    if (scene) scene.style.backgroundImage = chest.theme.backdrop ? `url("${chest.theme.backdrop.replace(/"/g, '%22')}")` : '';
    if (chest.accent) {
      root.style.setProperty('--accent-rgb', chest.accent.rgb);
      root.style.setProperty('--accent', `rgb(${chest.accent.rgb})`);
      root.style.setProperty('--accent-2', `rgb(${chest.accent.hi})`);
    } else {
      ['--accent-rgb', '--accent', '--accent-2'].forEach((name) => root.style.removeProperty(name));
    }
    root.style.setProperty('--accent-stamp', chest.theme.stampColor);
    $('caseName').textContent = chest.displayName;
    $('crumbName').textContent = chest.displayName;
    $('place').textContent = chest.slip.place;
    $('place').parentElement.hidden = !chest.slip.place;
    $('slipNo').textContent = chest.slip.number;
    $('stamp').textContent = tr(chest.theme.stamp[0], chest.theme.stamp[1]);
    $('sealText').textContent = [tr('Sir Locked evidence store', 'Kho vật chứng Sir Locked'), chest.displayName, chest.slip.place, chest.slip.number]
      .filter(Boolean).join(' · ') + ' ·';
    if (page.chestsForSale) {
      $('sPriceLabel').textContent = tr('Chest price', 'Giá hòm');
      $('sPriceValue').innerHTML = `<span class="qh-coin" aria-hidden="true"></span><b>${fmt(chest.chestPrice)}</b> xu`;
    } else {
      $('sPriceLabel').textContent = tr('Chests from', 'Hòm có từ');
      $('sPriceValue').innerHTML = `<b>${tr('Weekly challenge', 'Thử thách tuần')}</b>`;
    }
    $('sKey').textContent = chest.displayKey;
    $('sKeyPrice').textContent = fmt(chest.keyPrice);
    $('sCount').textContent = chest.items.length;
    for (const id of ['chipKey', 'btnKey', 'lnkKey']) paintSprite($(id), chest.keySprite);
    // A key's own picture is still on its way the first time: paint it again when it lands, if this chest is still shown.
    chest.keySprite.ready?.then(() => {
      if (cur() === chest) for (const id of ['chipKey', 'btnKey', 'lnkKey']) paintSprite($(id), chest.keySprite);
    });
    $('chest').setAttribute('aria-label', tr(`${chest.displayName}: open or buy`, `${chest.displayName}: mở hoặc mua hòm`));
    [...$('dots').children].forEach((dot, index) => dot.setAttribute('aria-pressed', String(index === page.index)));
    renderOdds(chest);
    renderContents(chest);
    particles?.theme(chest.theme.particles, chest.theme.custom ? { image: chest.theme.particleUrl, rgb: chest.theme.light } : {});
  }

  function syncWallet() {
    if (!page.loaded) return;
    const chest = cur();
    const { chest: chests, key: keys } = has();
    $('nChest').textContent = fmt(chests);
    $('nKey').textContent = fmt(keys);
    $('sChests').textContent = fmt(chests);
    $('sKeys').textContent = fmt(keys);
    $('nCoin').textContent = fmt(page.wallet?.balance ?? 0);
    $('nInv').textContent = fmt(page.wallet?.itemCount ?? 0);
    root.querySelectorAll('[data-qh-wallet]').forEach((el) => { el.hidden = preview; });
    [...$('dots').children].forEach((dot, index) => {
      const entry = page.chests[index];
      if (entry) dot.querySelector('[data-qh-count]').textContent = `×${fmt(entry.chestCount)}`;
    });

    const button = $('openBtn'), label = $('openLbl'), meta = $('meta');
    const busy = page.opening || page.buying;
    const key = escapeHtml(chest.displayKey);
    button.classList.remove('qh-can-open');
    $('buy').hidden = preview || !chest.onSale;
    $('demoBtn').hidden = preview || chest.items.length === 0;
    if ((chests < 1 || keys < 1) && !chest.onSale) {
      // What is left can still be opened with what the player finds on the market, but the shop has closed.
      label.textContent = tr('Open chest', 'Mở hòm');
      button.disabled = true;
      meta.textContent = tr('No longer on sale', 'Đã ngừng bán');
    } else if (chests < 1 && !page.chestsForSale) {
      // Chests are not sold any more: they come from the weekly challenge, keys still come from the shop.
      label.textContent = tr('Open chest', 'Mở hòm');
      button.disabled = true;
      meta.textContent = tr(`No ${chest.displayName} yet · chests drop from the weekly challenge`, `Chưa có ${chest.displayName} · hòm rơi từ Thử thách tuần`);
    } else if (chests < 1) {
      label.textContent = tr(`Buy chest · ${fmt(chest.chestPrice)} xu`, `Mua hòm · ${fmt(chest.chestPrice)} xu`);
      button.disabled = busy || !canAfford(chest.chestPrice);
      meta.textContent = canAfford(chest.chestPrice)
        ? tr(`You have no ${chest.displayName}`, `Bạn chưa có ${chest.displayName}`)
        : tr(`Not enough coins for ${chest.displayName}`, `Không đủ xu để mua ${chest.displayName}`);
    } else if (keys < 1) {
      label.textContent = tr(`Buy key · ${fmt(chest.keyPrice)} xu`, `Mua chìa · ${fmt(chest.keyPrice)} xu`);
      button.disabled = busy || !canAfford(chest.keyPrice);
      meta.innerHTML = canAfford(chest.keyPrice)
        ? tr(`<b>${fmt(chests)}</b> chests, you still need a <b>${key}</b>`, `Có <b>${fmt(chests)}</b> hòm, cần thêm <b>${key}</b>`)
        : escapeHtml(tr(`Not enough coins for ${chest.displayKey}`, `Không đủ xu để mua ${chest.displayKey}`));
    } else {
      label.textContent = tr('Open chest', 'Mở hòm');
      button.disabled = busy;
      button.classList.toggle('qh-can-open', !busy);
      meta.innerHTML = tr(`Ready: <b>${fmt(chests)}</b> chests · <b>${fmt(keys)}</b> keys`, `Sẵn sàng: <b>${fmt(chests)}</b> hòm · <b>${fmt(keys)}</b> chìa`);
    }

    const buyKey = root.querySelector('[data-qh-buy="key"]');
    const buyChest = root.querySelector('[data-qh-buy="chest"]');
    buyKey.querySelector('span').textContent = tr(`Buy key · ${fmt(chest.keyPrice)} xu`, `Mua chìa · ${fmt(chest.keyPrice)} xu`);
    buyChest.querySelector('span').textContent = tr(`Buy chest · ${fmt(chest.chestPrice)} xu`, `Mua hòm · ${fmt(chest.chestPrice)} xu`);
    buyKey.disabled = busy || !canAfford(chest.keyPrice);
    buyChest.disabled = busy || !canAfford(chest.chestPrice);
    buyChest.hidden = !page.chestsForSale;
  }

  function syncSound() {
    const button = $('soundBtn'), muted = AU.isMuted();
    const label = muted ? tr('Sound on', 'Bật âm thanh') : tr('Sound off', 'Tắt âm thanh');
    button.setAttribute('aria-pressed', String(!muted));
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  function renderDots() {
    const dots = $('dots');
    dots.replaceChildren();
    page.chests.forEach((chest, index) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'qh-dot';
      const rgb = chest.accent ? chest.accent.rgb : chest.theme.rgb;
      card.style.setProperty('--c', chest.accent ? `rgb(${chest.accent.rgb})` : chest.theme.c);
      card.style.setProperty('--crgb', rgb);
      const price = !chest.onSale
        ? tr('Off sale', 'Ngừng bán')
        : page.chestsForSale ? `${fmt(chest.chestPrice)} xu` : tr(`Key ${fmt(chest.keyPrice)} xu`, `Chìa ${fmt(chest.keyPrice)} xu`);
      const place = chest.slip.place ? `<span class="qh-pl"> · ${escapeHtml(chest.slip.place)}</span>` : '';
      const art = chest.picture ? `class="qh-custom" src="${escapeHtml(chest.picture)}"` : `class="qh-px" src="${chest.theme.image}"`;
      card.innerHTML = `<img ${art} alt="" width="64" height="57" draggable="false"><b>${escapeHtml(chest.displayName)}</b><span>${price}${place}</span><em data-qh-count></em>`;
      on(card, 'click', () => selectCase(index));
      dots.append(card);
    });
  }

  /* ---------- actions ---------- */

  function selectCase(next) {
    if (!stage || stage.mode() !== 'idle') return;
    const total = page.chests.length;
    const index = (next + total) % total;
    if (index === page.index) return;
    let dir = index > page.index ? 1 : -1;
    if (Math.abs(index - page.index) === total - 1) dir *= -1;
    page.index = index;
    renderCase();
    syncWallet();
    stage.swapChest(dir, paintChest);
    AU.init();
    AU.whoosh();
    say(cur().displayName);
  }

  async function startOpen() {
    if (!stage || stage.mode() !== 'idle' || page.opening || page.buying) return;
    const chest = cur();
    if (chest.chestCount < 1 || chest.keyCount < 1) return;
    page.demo = false;
    $('reelTitle').textContent = tr(`Opening ${chest.displayName}`, `Đang mở ${chest.displayName}`);
    page.opening = true;
    if (!stage.start()) {
      page.opening = false;
      return;
    }
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

  /** The whole sequence with an item drawn here, for show: nothing is spent and nothing is received. */
  function startDemo() {
    if (!stage || stage.mode() !== 'idle' || page.opening || page.buying || cur().items.length === 0) return;
    page.demo = true;
    $('reelTitle').textContent = tr(`Preview · ${cur().displayName}`, `Xem thử · ${cur().displayName}`);
    if (stage.start()) stage.resolve(fillerItem());
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
    if (mode === 'spin') $('skipBtn').focus({ preventScroll: true });
  }

  function onReveal(item) {
    const style = rarityStyle(item.rarity);
    $('revealLayer').setAttribute('style', style);
    $('reveal').setAttribute('style', style);
    $('gotVis').replaceChildren(visualOf(item, 'big'));
    $('gotRar').textContent = rarityLabel(item.rarity);
    $('gotName').textContent = item.name;
    const from = tr(`from ${cur().displayName}`, `từ ${cur().displayName}`);
    $('gotType').textContent = [item.type, from, page.demo ? tr('preview', 'bản xem thử') : ''].filter(Boolean).join(' · ');
    const { chest, key } = has();
    const again = $('againBtn');
    if (page.demo) {
      again.hidden = false;
      again.textContent = tr('Preview again', 'Xem thử lần nữa');
    } else {
      const left = Math.min(chest, key);
      again.hidden = left < 1;
      again.textContent = tr(`Open another (${left})`, `Mở tiếp (${left})`);
    }
    $('invBtn').hidden = preview || page.demo;
    say(page.demo
      ? tr(`Preview: ${item.name}, ${rarityLabel(item.rarity)}.`, `Xem thử: ${item.name}, hạng ${rarityLabel(item.rarity)}.`)
      : tr(`You received ${item.name}, ${rarityLabel(item.rarity)}.`, `Bạn nhận được ${item.name}, hạng ${rarityLabel(item.rarity)}.`));
    later(() => (again.hidden ? $('closeBtn') : again).focus({ preventScroll: true }), 450);
  }

  function closeReveal() {
    if (!stage.toIdle()) return;
    $('openBtn').focus({ preventScroll: true });
  }

  function bindControls() {
    on($('prevBtn'), 'click', () => selectCase(page.index - 1));
    on($('nextBtn'), 'click', () => selectCase(page.index + 1));
    on($('openBtn'), 'click', onMainButton);
    on($('demoBtn'), 'click', startDemo);
    on($('buy'), 'click', (event) => {
      const button = event.target.closest('[data-qh-buy]');
      if (button && !button.disabled) buy(button.dataset.qhBuy);
    });
    on($('closeBtn'), 'click', closeReveal);
    on($('invBtn'), 'click', () => {
      stage.toIdle();
      navigate('/market/sell');
    });
    on($('againBtn'), 'click', () => {
      const demo = page.demo;
      if (!stage.toIdle()) return;
      if (demo) {
        startDemo();
        return;
      }
      const { chest, key } = has();
      if (chest > 0 && key > 0) startOpen();
      else $('openBtn').focus({ preventScroll: true });
    });
    // The fast-forward button and a click anywhere on the reel do the same.
    on($('reelLayer'), 'click', () => stage.skip());
    on($('soundBtn'), 'click', () => {
      AU.setMuted(!AU.isMuted());
      AU.init();
      syncSound();
    });

    // A swipe also ends in a click on the chest; it must only change the chest, never spend one.
    const podium = $('podium');
    let downX = null;
    let swiped = false;
    on(podium, 'pointerdown', (event) => {
      downX = event.clientX;
      swiped = false;
    });
    on(podium, 'pointerup', (event) => {
      if (downX !== null && Math.abs(event.clientX - downX) > SWIPE_PX && stage.mode() === 'idle' && !event.target.closest('.qh-nav')) {
        swiped = true;
        selectCase(page.index + (event.clientX < downX ? 1 : -1));
      }
      downX = null;
    });
    on($('chest'), 'click', () => {
      if (swiped) {
        swiped = false;
        return;
      }
      if (stage.mode() !== 'idle' || performance.now() < page.guardUntil) return;
      const { chest, key } = has();
      if (chest > 0 && key > 0) startOpen();
      else if (cur().onSale && !preview) {
        toast(page.chestsForSale
          ? tr('Buy a chest and a key first, then click the chest to open it.', 'Mua hòm và chìa trước, rồi bấm vào hòm để mở.')
          : tr('Chests drop from the weekly challenge. With a chest and a key, click the chest to open it.', 'Hòm rơi từ Thử thách tuần. Có hòm và chìa thì bấm vào hòm để mở.'));
      }
    });
    on(document, 'keydown', (event) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return;
      const mode = stage.mode();
      if (event.key === 'Escape') {
        if (mode === 'reveal') closeReveal();
        else stage.skip();
      } else if (mode === 'idle' && event.key === 'ArrowLeft') selectCase(page.index - 1);
      else if (mode === 'idle' && event.key === 'ArrowRight') selectCase(page.index + 1);
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
    particles?.dispose();
    particles = null;
    stage?.dispose();
    stage = null;
  }

  function showLoadError(error) {
    const empty = $('empty');
    empty.innerHTML = `<span>${escapeHtml(chestErrorText(error))}</span><button class="qh-btn qh-btn-ghost" type="button" id="qh-retry">${tr('Try again', 'Thử lại')}</button>`;
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
      particles = createVaultParticles($('particles'), { reduce });
      renderDots();
      renderCase();
      paintChest();
      stage = createVaultStage({
        root,
        chest: $('chest'),
        reel: $('reel'),
        track: $('track'),
        reelLayer: $('reelLayer'),
        revealLayer: $('revealLayer'),
        burst: $('burst'),
        makeCard,
        filler: fillerItem,
        reduce,
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
