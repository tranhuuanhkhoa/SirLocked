import { tr, uiLanguage } from '../../services/i18n.js';
import { escapeHtml } from '../../utils/dom.js';
import { pixelIconUrl } from '../chest/chestSprites.js';

/* Shared pieces of Chợ đồ: labels, number formatting, error texts, rarity-tinted item icons, sparklines. */

export const CATEGORIES = ['MAGNIFIER', 'STAMP', 'PINS', 'FOLDER', 'BADGE', 'BOARD', 'WATCH', 'CHEST', 'KEY', 'CURIO', 'FRAME', 'TITLE', 'ENTRANCE'];
export const RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYSTERY'];
export const SLOT_CAP = 12;
export const FEE_PERCENT = 5;
export const MIN_PRICE = 2;
export const MAX_PRICE = 1_000_000;

const CATEGORY_LABELS = {
  MAGNIFIER: ['Magnifiers', 'Kính lúp'],
  STAMP: ['Stamps', 'Con dấu'],
  PINS: ['Thread & pins', 'Chỉ & ghim'],
  FOLDER: ['Case folders', 'Bìa hồ sơ'],
  BADGE: ['Badges', 'Huy hiệu'],
  BOARD: ['Evidence boards', 'Bảng điều tra'],
  WATCH: ['Watches', 'Đồng hồ'],
  CHEST: ['Chests', 'Hòm'],
  KEY: ['Keys', 'Chìa'],
  CURIO: ['Collectibles', 'Vật phẩm sưu tầm'],
  FRAME: ['Avatar frames', 'Viền avatar'],
  TITLE: ['Titles', 'Danh hiệu'],
  ENTRANCE: ['Lobby entrances', 'Hiệu ứng vào sảnh'],
};

/** Same rule as the server: chests, keys and collectibles only sit in the bag. */
const NOT_EQUIPPABLE = new Set(['CHEST', 'KEY', 'CURIO']);
const COSMETIC_CATEGORIES = new Set(['FRAME', 'TITLE', 'ENTRANCE']);

export function isEquippable(category) {
  return !NOT_EQUIPPABLE.has(category);
}

/** Rarity colours: `metal` tints the icon, `marker` reads on dark, `bar` is the inventory strip. */
export const RARITY = {
  COMMON: { label: ['Common', 'Thường'], cls: 'common', metal: '#b9ad97', deep: '#5f574b', marker: '#c9bfa8', bar: '#a39885', glow: 'rgba(201,191,168,.22)' },
  RARE: { label: ['Rare', 'Hiếm'], cls: 'rare', metal: '#62b3b0', deep: '#1f4a4a', marker: '#8fd0cf', bar: '#4f9a9a', glow: 'rgba(79,154,154,.34)' },
  EPIC: { label: ['Epic', 'Quý'], cls: 'epic', metal: '#9d87d8', deep: '#3b2d66', marker: '#b9a6e6', bar: '#7a62b8', glow: 'rgba(122,98,184,.4)' },
  LEGENDARY: { label: ['Legendary', 'Huyền thoại'], cls: 'legend', metal: '#e6c463', deep: '#5e4a1c', marker: '#efd486', bar: '#c7a24b', glow: 'rgba(239,212,134,.42)' },
  MYSTERY: { label: ['Mystery', 'Bí ẩn'], cls: 'mystery', metal: '#E8B53A', deep: '#5e4a1c', marker: '#E8B53A', bar: '#E8B53A', glow: 'rgba(232,181,58,.5)' },
};

export function categoryLabel(category) {
  const label = CATEGORY_LABELS[category];
  return label ? tr(label[0], label[1]) : category;
}

export function rarityOf(rarity) {
  return RARITY[rarity] || RARITY.COMMON;
}

export function rarityLabel(rarity) {
  const { label } = rarityOf(rarity);
  return tr(label[0], label[1]);
}

export function defName(def) {
  return def ? tr(def.nameEn || def.name, def.name) : '';
}

export function defDescription(def) {
  return def ? tr(def.descriptionEn || def.description, def.description) : '';
}

export function fmt(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString(uiLanguage() === 'vi' ? 'vi-VN' : 'en-US');
}

export function xu(value) {
  return `${fmt(value)} xu`;
}

/** Same rule as the server and Market.dc.html: 5% rounded half up, at least 1 xu. */
export function feeFor(price) {
  const value = Math.floor(Number(price) || 0);
  if (value <= 0) return 0;
  return Math.max(1, Math.floor((value * FEE_PERCENT + 50) / 100));
}

export function signed(value) {
  const n = Number(value) || 0;
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
}

export function shortDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(uiLanguage() === 'vi' ? 'vi-VN' : 'en-GB', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

const ERRORS = {
  MARKET_INVALID_PRICE: [`Price must be between ${MIN_PRICE} and 1,000,000 xu.`, `Giá phải từ ${MIN_PRICE} đến 1.000.000 xu.`],
  MARKET_UNKNOWN_ITEM_TYPE: ['This item no longer exists.', 'Vật phẩm này không còn tồn tại.'],
  MARKET_ITEM_NOT_FOUND: ['This item is not in your inventory any more.', 'Vật phẩm này không còn trong túi đồ của bạn.'],
  MARKET_ITEM_LOCKED: ['This item is for sale or inside a trade.', 'Vật phẩm đang rao bán hoặc đang nằm trong một giao dịch.'],
  MARKET_LISTING_NOT_FOUND: ['This listing was not found.', 'Không tìm thấy tin rao bán này.'],
  MARKET_LISTING_UNAVAILABLE: ['Someone else got there first — this listing is gone.', 'Đã có người nhanh tay hơn — tin rao bán này không còn.'],
  MARKET_CANNOT_BUY_OWN: ['You cannot buy your own listing.', 'Bạn không thể mua món đồ của chính mình.'],
  MARKET_INSUFFICIENT_FUNDS: ['You do not have enough coins.', 'Bạn không đủ xu.'],
  MARKET_INVENTORY_FULL: ['Your inventory is full (12 slots).', 'Túi đồ đã đầy (12 ô).'],
  MARKET_NO_LISTING_AT_PRICE: ['Nothing is for sale at this price any more.', 'Không còn ai bán ở mức giá này.'],
  MARKET_ORDER_NOT_FOUND: ['This buy order was not found.', 'Không tìm thấy lệnh mua này.'],
  MARKET_ORDER_UNAVAILABLE: ['This buy order is already closed.', 'Lệnh mua này đã đóng.'],
  MARKET_TOO_MANY_LISTINGS: ['You have too many items for sale.', 'Bạn đang rao bán quá nhiều vật phẩm.'],
  MARKET_TOO_MANY_ORDERS: ['You have too many open buy orders (10).', 'Bạn có quá nhiều lệnh mua đang chờ (tối đa 10).'],
  MARKET_TRADE_NOT_FOUND: ['This trade offer was not found.', 'Không tìm thấy đề nghị trao đổi này.'],
  MARKET_TRADE_CLOSED: ['This offer is no longer open.', 'Đề nghị này không còn mở.'],
  MARKET_TRADE_SELF: ['Choose another detective to trade with.', 'Hãy chọn một thám tử khác để trao đổi.'],
  MARKET_TRADE_EMPTY: ['Add at least one item or some coins.', 'Hãy thêm ít nhất một vật phẩm hoặc một ít xu.'],
  MARKET_TRADE_TOO_MANY_ITEMS: ['At most 6 items per side.', 'Mỗi bên tối đa 6 vật phẩm.'],
  MARKET_TRADE_INVALID_COINS: ['Coins must be between 0 and 1,000,000.', 'Số xu phải từ 0 đến 1.000.000.'],
  MARKET_TRADE_DUPLICATE_ITEM: ['An item is listed twice.', 'Có vật phẩm bị chọn hai lần.'],
  MARKET_TRADE_MESSAGE_TOO_LONG: ['The message is too long (200 characters).', 'Lời nhắn quá dài (tối đa 200 ký tự).'],
  MARKET_TRADE_ITEM_UNAVAILABLE: ['An item in this offer is no longer available.', 'Một vật phẩm trong đề nghị không còn sẵn sàng.'],
  MARKET_TRADE_SENDER_FUNDS: ['The sender no longer has the offered coins.', 'Người gửi không còn đủ số xu đã đề nghị.'],
  MARKET_TRADE_SENDER_INVENTORY: ["The sender's inventory is full.", 'Túi đồ của người gửi đã đầy.'],
  MARKET_TRADE_RECIPIENT_FUNDS: ['You do not have the coins this offer asks for.', 'Bạn không đủ số xu mà đề nghị yêu cầu.'],
  MARKET_TRADE_RECIPIENT_INVENTORY: ['Your inventory is full — free a slot first.', 'Túi đồ của bạn đã đầy — hãy bỏ bớt một món trước.'],
  MARKET_TRADE_TOO_MANY_PENDING: ['You have too many pending offers (10).', 'Bạn có quá nhiều đề nghị đang chờ (tối đa 10).'],
  MARKET_USER_NOT_FOUND: ['That detective was not found.', 'Không tìm thấy thám tử này.'],
  MARKET_REQUEST_IN_PROGRESS: ['Still working on your last request…', 'Yêu cầu trước vẫn đang được xử lý…'],
  MARKET_EMAIL_NOT_VERIFIED: ['Verify your e-mail (Profile page) before trading on the market.', 'Hãy xác minh email (trang Hồ sơ) trước khi giao dịch trên chợ.'],
  MARKET_BUSY: ['Someone is dealing with this right now — try again in a moment.', 'Có người đang giao dịch món này — thử lại sau giây lát.'],
  MARKET_ITEM_NOT_EQUIPPABLE: ['Chests, keys and collectibles cannot be put in use.', 'Hòm, chìa và vật phẩm sưu tầm không dùng để trang bị được.'],
  MARKET_INVALID_REQUEST_ID: ['Please try that again.', 'Vui lòng thử lại.'],
  CHEST_NONE: ['You have no chest of this type left.', 'Bạn không còn hòm loại này.'],
  MARKET_ITEM_NOT_TRADABLE: ['This item was earned and cannot be sold or traded.', 'Vật phẩm này do bạn đạt được nên không bán hay trao đổi được.'],
  XP_MAX_LEVEL: ['You are already at the highest level.', 'Bạn đã đạt cấp cao nhất.'],
  XP_NO_ITEMS: ['Choose the items to exchange.', 'Hãy chọn vật phẩm để đổi.'],
  XP_ITEM_NOT_FOUND: ['This item is no longer in your bag.', 'Vật phẩm này không còn trong túi của bạn.'],
  XP_ITEM_LOCKED: ['Items for sale or in a trade cannot be exchanged.', 'Vật phẩm đang rao bán hoặc đang giao dịch không đổi được.'],
  XP_ITEM_EQUIPPED: ['Take the item off before exchanging it.', 'Hãy bỏ dùng vật phẩm trước khi đổi.'],
  XP_ITEM_NOT_EXCHANGEABLE: ['Only rare and epic items can be exchanged.', 'Chỉ đổi được vật phẩm Hiếm và Quý.'],
  AVATAR_UNKNOWN: ['Choose one of the avatars on offer.', 'Hãy chọn một trong các ảnh có sẵn.'],
  AVATAR_TOO_LARGE: ['The picture must be 2 MB or smaller.', 'Ảnh phải từ 2 MB trở xuống.'],
  AVATAR_BAD_IMAGE: ['Use a JPG, PNG or WebP picture.', 'Hãy dùng ảnh JPG, PNG hoặc WebP.'],
  AVATAR_UNAVAILABLE: ['Uploading a picture is not available right now.', 'Hiện chưa thể tải ảnh lên.'],
  KEY_NONE: ['You have no key for this chest left.', 'Bạn không còn chìa cho loại hòm này.'],
  FUNDS: ['You do not have enough coins.', 'Bạn không đủ xu.'],
  SLOTS_FULL: ['Your inventory is full (12 slots) — free a slot first.', 'Túi đồ đã đầy (12 ô) — hãy bán bớt một món trước.'],
  IN_PROGRESS: ['Still working on your last request…', 'Yêu cầu trước vẫn đang được xử lý…'],
};

export function errorText(error) {
  const code = error?.errors?.code;
  if (code && ERRORS[code]) return tr(ERRORS[code][0], ERRORS[code][1]);
  if (error?.status === 0) return tr('Cannot reach the server.', 'Không kết nối được máy chủ.');
  if (error?.status === 400) return tr('Please check what you entered.', 'Hãy kiểm tra lại thông tin bạn nhập.');
  if (error?.status === 401 || error?.status === 403) return tr('Please sign in again.', 'Hãy đăng nhập lại.');
  if (error?.status === 429) return tr('Too many attempts. Please wait a minute.', 'Bạn thao tác quá nhanh. Vui lòng đợi một phút.');
  return tr('The market could not complete that. Please try again.', 'Chợ chưa thực hiện được thao tác này. Vui lòng thử lại.');
}

export function failReasonText(code) {
  return ERRORS[code] ? tr(ERRORS[code][0], ERRORS[code][1]) : '';
}

/* ---------- icons: one drawing per category, tinted by rarity ---------- */

const SPARKLE = '<path d="M51 5l1.6 3.8L56.4 10.4l-3.8 1.6L51 15.8l-1.6-3.8L45.6 10.4l3.8-1.6z" fill="#efd486"/><path d="M8 47l1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1z" fill="#fff1c2" opacity=".8"/>';

const DRAW = {
  FRAME: (r) => `
    <circle cx="32" cy="32" r="22" fill="none" stroke="${r.deep}" stroke-width="9"/>
    <circle cx="32" cy="32" r="22" fill="none" stroke="${r.metal}" stroke-width="5"/>
    <circle cx="32" cy="32" r="13" fill="#1d2a3a"/>
    <circle cx="32" cy="10" r="4" fill="${r.metal}"/><circle cx="32" cy="54" r="4" fill="${r.metal}"/><circle cx="10" cy="32" r="4" fill="${r.metal}"/><circle cx="54" cy="32" r="4" fill="${r.metal}"/>`,
  TITLE: (r) => `
    <path d="M12 20H52L60 32L52 44H12L4 32Z" fill="${r.deep}" stroke="${r.metal}" stroke-width="3"/>
    <path d="M18 29H46M22 36H42" stroke="${r.metal}" stroke-width="3" stroke-linecap="round"/>`,
  ENTRANCE: (r) => `
    <circle cx="32" cy="32" r="24" fill="${r.deep}"/>
    <path d="M32 12c10 8 10 14 0 20s-10 12 0 20M16 22c8 2 10 6 8 10M48 42c-8-2-10-6-8-10" fill="none" stroke="${r.metal}" stroke-width="3.4" stroke-linecap="round"/>`,
  MAGNIFIER: (r, legendary) => `
    <path d="M38 38L52 52" stroke="#3b2716" stroke-width="9" stroke-linecap="round"/>
    <path d="M38 38L52 52" stroke="${legendary ? '#d3dade' : '#8a5a34'}" stroke-width="${legendary ? 3 : 4}" stroke-linecap="round"/>
    <circle cx="27" cy="27" r="14" fill="${legendary ? 'rgba(200,230,255,.38)' : 'rgba(190,225,235,.22)'}" stroke="${r.metal}" stroke-width="4.5"/>
    <circle cx="27" cy="27" r="16.6" fill="none" stroke="${r.deep}" stroke-width="1"/>
    ${legendary ? '<path d="M27 13L34 27L27 41L20 27Z" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="1"/><path d="M13 27H41" stroke="rgba(255,255,255,.45)" stroke-width="1"/>' : ''}
    <path d="M19 23a9 9 0 0 1 8-7" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="2" stroke-linecap="round"/>`,
  STAMP: (r) => `
    <circle cx="32" cy="15" r="8" fill="#7a5232"/>
    <circle cx="29.5" cy="12.5" r="2.4" fill="rgba(255,255,255,.22)"/>
    <path d="M27 21h10l2 12H25z" fill="#5a3b22"/>
    <rect x="16" y="33" width="32" height="10" rx="1.5" fill="${r.metal}"/>
    <rect x="16" y="33" width="32" height="3" rx="1.5" fill="rgba(255,255,255,.2)"/>
    <rect x="18" y="43" width="28" height="4" fill="#3b2a1a"/>
    <path d="M14 54h36" stroke="#d0533e" stroke-width="3" stroke-linecap="round"/>`,
  PINS: (r) => `
    <path d="M18 28l-4 16M34 22v18M48 32l4 15" stroke="#b9c1c6" stroke-width="2" stroke-linecap="round"/>
    ${[[18, 24], [34, 18], [48, 28]].map(([x, y]) => `
      <circle cx="${x}" cy="${y}" r="8" fill="${r.metal}" stroke="${r.deep}" stroke-width="1.2"/>
      <circle cx="${x - 2.6}" cy="${y - 2.6}" r="2.6" fill="rgba(255,255,255,.55)"/>`).join('')}`,
  SPOOL: (r) => `
    <ellipse cx="32" cy="14" rx="16" ry="5" fill="${r.metal}"/>
    <rect x="20" y="14" width="24" height="34" fill="#b8382b"/>
    <path d="M20 20h24M20 26h24M20 32h24M20 38h24M20 44h24" stroke="#7d2219" stroke-width="1.4"/>
    <ellipse cx="32" cy="48" rx="16" ry="5" fill="${r.deep}"/>
    <path d="M44 30c8 4 6 14 12 18" fill="none" stroke="#d0533e" stroke-width="2" stroke-linecap="round"/>`,
  FOLDER: (r, legendary, rarity) => `
    <path d="M10 18h18l4 5h22v27H10z" fill="${rarity === 'COMMON' ? '#a17c4b' : '#7a4126'}" stroke="${r.metal}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M10 28h44" stroke="${rarity === 'COMMON' ? '#5d4426' : '#3d2112'}" stroke-width="2"/>
    <path d="M14 33h20M14 38h16" stroke="rgba(255,255,255,.16)" stroke-width="1.6"/>
    <rect x="42" y="34" width="7" height="12" rx="1" fill="${r.metal}"/>`,
  BADGE: (r) => `
    <path d="M22 34L16 56l9-4 5 8 4-22z" fill="#4f9a9a"/>
    <path d="M42 34l6 22-9-4-5 8-4-22z" fill="#b8382b"/>
    <circle cx="32" cy="26" r="16" fill="${r.metal}" stroke="${r.deep}" stroke-width="2"/>
    <circle cx="32" cy="26" r="11" fill="none" stroke="${r.deep}" stroke-width="1.4" opacity=".7"/>
    <path d="M25 22h14M23 27h18M26 32h12" stroke="${r.deep}" stroke-width="1.8" stroke-linecap="round"/>`,
  BOARD: (r) => `
    <path d="M20 50l-4 9M44 50l4 9" stroke="#5a4230" stroke-width="3" stroke-linecap="round"/>
    <rect x="8" y="12" width="48" height="38" fill="#6a4d36" stroke="${r.metal}" stroke-width="3"/>
    <rect x="15" y="18" width="12" height="10" fill="#e9dcc0"/>
    <rect x="36" y="22" width="13" height="11" fill="#e9dcc0"/>
    <rect x="22" y="35" width="12" height="9" fill="#e9dcc0"/>
    <path d="M21 19L42 23L28 36Z" fill="none" stroke="#d0533e" stroke-width="1.4"/>
    <circle cx="21" cy="19" r="2.2" fill="#d0533e"/><circle cx="42" cy="23" r="2.2" fill="#d0533e"/><circle cx="28" cy="36" r="2.2" fill="#d0533e"/>`,
  WATCH: (r) => `
    <circle cx="32" cy="9" r="4" fill="none" stroke="${r.metal}" stroke-width="2.4"/>
    <rect x="29" y="12" width="6" height="5" fill="${r.metal}"/>
    <circle cx="32" cy="36" r="19" fill="${r.metal}" stroke="${r.deep}" stroke-width="2"/>
    <circle cx="32" cy="36" r="15" fill="#f4ecd8"/>
    <path d="M32 23v3M45 36h-3M32 49v-3M19 36h3" stroke="#5e4a1c" stroke-width="1.6"/>
    <path d="M32 36V27M32 36l6 4" stroke="#1d2a3a" stroke-width="2" stroke-linecap="round"/>
    <circle cx="32" cy="36" r="1.6" fill="#1d2a3a"/>`,
};

function drawingKey(def) {
  if (def?.id && def.id.startsWith('thread')) return 'SPOOL';
  return DRAW[def?.category] ? def.category : 'MAGNIFIER';
}

/**
 * Inline SVG for an item type, or its pixel sprite when the API names one (`iconKey`).
 * Decorative by default; pass `label` to expose it as an image. No character art: only objects.
 */
export function itemIcon(def, size = 34, label = '') {
  const imageUrl = COSMETIC_CATEGORIES.has(def?.category) ? '' : def?.visual?.imageUrl;
  if (imageUrl) {
    const alt = label ? `alt="${escapeHtml(label)}"` : 'alt="" aria-hidden="true"';
    return `<img class="bpa-mk-icon" src="${escapeHtml(imageUrl)}" width="${size}" height="${size}" style="object-fit:contain" ${alt} draggable="false" loading="lazy">`;
  }
  // A frame an admin painted has its own picture; other cosmetics use the category drawing below.
  if (def?.category === 'FRAME' && def.visual?.template === 'painted' && def.visual.imageUrl) {
    const alt = label ? `alt="${escapeHtml(label)}"` : 'alt="" aria-hidden="true"';
    return `<img class="bpa-mk-icon" data-frame-rarity="${escapeHtml(def.rarity ?? '')}" src="${escapeHtml(def.visual.imageUrl)}" width="${size}" height="${size}" ${alt} draggable="false" style="object-fit:contain">`;
  }
  const pixel = def?.iconKey && !COSMETIC_CATEGORIES.has(def.category) ? pixelIconUrl(def.iconKey) : '';
  if (pixel) {
    const alt = label ? `alt="${escapeHtml(label)}"` : 'alt="" aria-hidden="true"';
    return `<img class="bpa-mk-icon bpa-mk-icon--pixel" src="${pixel}" width="${size}" height="${size}" ${alt} draggable="false">`;
  }
  const rarity = rarityOf(def?.rarity);
  const legendary = def?.rarity === 'LEGENDARY';
  const a11y = label
    ? `role="img" aria-label="${escapeHtml(label)}"`
    : 'aria-hidden="true"';
  return `<svg class="bpa-mk-icon" width="${size}" height="${size}" viewBox="0 0 64 64" ${a11y} focusable="false">${DRAW[drawingKey(def)](rarity, legendary, def?.rarity)}${legendary ? SPARKLE : ''}</svg>`;
}

// A painted frame whose picture cannot load falls back to the drawing every other frame uses.
document.addEventListener('error', (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.dataset.frameRarity !== undefined) {
    image.outerHTML = itemIcon({ category: 'FRAME', rarity: image.dataset.frameRarity }, image.width);
  }
}, true);

/** Dark tile with a rarity glow around the icon. */
export function itemTile(def, size = 42, iconSize = 34, label = '') {
  const rarity = rarityOf(def?.rarity);
  return `<span class="bpa-mk-tile is-${rarity.cls}" style="width:${size}px;height:${size}px">${itemIcon(def, iconSize, label)}</span>`;
}

export const COIN_SVG = (size = 18) => `<svg class="bpa-mk-coin" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="#c7a24b" stroke="#5e4a1c" stroke-width="1.2"/><circle cx="12" cy="12" r="7" fill="none" stroke="#8a6e2e" stroke-width="1"/><path d="M12 7.8a1.9 1.9 0 0 1 1.1 3.5l.7 3.9h-3.6l.7-3.9A1.9 1.9 0 0 1 12 7.8z" fill="#5e4a1c"/></svg>`;

export const ARROW_SWAP = (size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#9e3f2a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 8h14l-3-3M20 16H6l3 3"/></svg>`;

/* ---------- price lines ---------- */

function points(values, width, height, padX, padTop, padBottom) {
  const known = values.map((value, index) => ({ value, index })).filter((point) => point.value !== null && point.value !== undefined);
  if (known.length === 0) return [];
  const min = Math.min(...known.map((point) => point.value));
  const max = Math.max(...known.map((point) => point.value));
  const span = max - min || 1;
  const step = values.length > 1 ? (width - padX * 2) / (values.length - 1) : 0;
  return known.map(({ value, index }) => ({
    x: padX + index * step,
    y: max === min ? (padTop + height - padBottom) / 2 : padTop + (1 - (value - min) / span) * (height - padTop - padBottom),
  }));
}

function trendUp(values) {
  const known = values.filter((value) => value !== null && value !== undefined);
  return known.length < 2 || known[known.length - 1] >= known[0];
}

/** 10-day sparkline (88×28) for a market row; flat dashed rule when there is no history yet. */
export function sparkline(values = [], width = 88, height = 28) {
  const pts = points(values, width, height, 3, 3, 3);
  if (pts.length < 2) {
    return `<svg class="bpa-mk-spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false"><path d="M3 ${height / 2}H${width - 3}" stroke="rgba(91,82,72,.45)" stroke-width="1.2" stroke-dasharray="3 3"/>${pts.length === 1 ? `<circle cx="${pts[0].x.toFixed(1)}" cy="${height / 2}" r="2" fill="#2f6363"/>` : ''}</svg>`;
  }
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return `<svg class="bpa-mk-spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="${trendUp(values) ? '#2f6363' : '#9e3f2a'}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

/** 30-day price chart (300×100 viewBox, stretched) with a filled area under the line. */
export function priceChart(values = [], label = '') {
  const pts = points(values, 300, 100, 4, 6, 6);
  const grid = '<path d="M0 25H300M0 50H300M0 75H300" stroke="rgba(79,154,154,.35)" stroke-width="1"/>';
  if (pts.length === 0) {
    return `<svg class="bpa-mk-chart" viewBox="0 0 300 100" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(label)}">${grid}</svg>`;
  }
  const line = pts.length === 1
    ? `M4 ${pts[0].y.toFixed(1)} L296 ${pts[0].y.toFixed(1)}`
    : pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const first = pts.length === 1 ? 4 : pts[0].x;
  const last = pts.length === 1 ? 296 : pts[pts.length - 1].x;
  const area = `${line} L${last.toFixed(1)} 100 L${first.toFixed(1)} 100 Z`;
  return `<svg class="bpa-mk-chart" viewBox="0 0 300 100" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(label)}">${grid}<path d="${area}" fill="rgba(158,63,42,.12)"/><path d="${line}" fill="none" stroke="#9e3f2a" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

export function changeText(percent) {
  if (percent === null || percent === undefined) return { text: '—', up: true };
  const up = percent >= 0;
  return { text: `${up ? '▲' : '▼'} ${Math.abs(percent)}%`, up };
}
