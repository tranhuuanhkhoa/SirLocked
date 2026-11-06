import { cosmeticSprite, isCosmeticDef } from '../../../cosmetics/icons.js';
import { icon, rarityPill, segTabs } from '../../../components/admin/ui.js';
import { escapeHtml } from '../../../utils/dom.js';
import { paintSprite } from '../../chest/chestSprites.js';
import { itemIcon } from '../../market/marketKit.js';
import { replaceAddress } from '../../../services/navigation.js';

/* What the chests and items admin pages share: words, numbers, dialogs and item thumbnails. Admin pages are in Vietnamese only. */

export const RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYSTERY'];
export const RARITY_TEXT = { COMMON: 'Thường', RARE: 'Hiếm', EPIC: 'Quý', LEGENDARY: 'Huyền thoại', MYSTERY: 'Bí ẩn' };
/** The text colour of each rarity's label in the admin design: bars and meters use it too, so they read as the same rarity. */
export const RARITY_COLOR = { COMMON: '#4d4538', RARE: '#245a92', EPIC: '#53409a', LEGENDARY: '#8a5a0c', MYSTERY: '#9b2f3a' };

export const CATEGORY_TEXT = {
  MAGNIFIER: 'Kính lúp', STAMP: 'Con dấu', PINS: 'Ghim', FOLDER: 'Bìa hồ sơ', BADGE: 'Huy hiệu', BOARD: 'Bảng', WATCH: 'Đồng hồ',
  CHEST: 'Hòm', KEY: 'Chìa', CURIO: 'Sưu tầm', FRAME: 'Viền', TITLE: 'Danh hiệu', ENTRANCE: 'Hiệu ứng vào sảnh',
};

export const rarityBadge = (rarity) => rarityPill(rarity, RARITY_TEXT[rarity] ?? rarity);

/** Icons this area needs that the shared set does not have yet. Same stroke as components/admin/icons.js. */
const LOCAL_ICONS = {
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
};
export function acIcon(name, size = 18) {
  if (!LOCAL_ICONS[name]) return icon(name, size);
  return `<svg aria-hidden="true" focusable="false" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${LOCAL_ICONS[name]}</svg>`;
}

export const number = (value) => Number(value ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 });
export const xu = (value) => `${number(value)} xu`;
export const percent = (value, digits = 2) => `${Number(value ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: digits })}%`;
export const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '');

/** A parameter of the current route: pages read them from the address. */
export function routeParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/** Changes the tab in the address without running the router, so whatever is being edited stays on screen. */
export function setRouteParam(name, value) {
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(name, value);
  else params.delete(name);
  const text = params.toString();
  replaceAddress(`${window.location.pathname}${text ? `?${text}` : ''}`);
}

const SUB_TABS = [
  { id: 'chests', href: '/admin/chests', label: 'Hòm' },
  { id: 'items', href: '/admin/items', label: 'Vật phẩm' },
  { id: 'log', href: '/admin/chests?tab=nhat-ky', label: 'Nhật ký mở hòm' },
  { id: 'grant', href: '/admin/chests?tab=cap', label: 'Cấp hòm & chìa' },
];

export const subNav = (active) => segTabs(SUB_TABS.map((tab) => ({ ...tab, active: tab.id === active })), 'Mục hòm và vật phẩm');

/** The head every page of this area shares: the area's title, its tabs, and buttons on the right (`actionsHtml`). */
export const areaHead = (active, actionsHtml = '') => `
  <div class="ac-area-head">
    <div class="ac-area-title">
      <h1>Hòm &amp; vật phẩm</h1>
      ${subNav(active)}
    </div>
    ${actionsHtml ? `<div class="adm-actions">${actionsHtml}</div>` : ''}
  </div>`;

// ------------------------------------------------------------------ errors

const CODE_TEXT = {
  ASSET_STORAGE_UNAVAILABLE: 'Máy chủ chưa cấu hình Cloudinary nên chưa tải ảnh lên được.',
  ASSET_TOO_LARGE: 'Ảnh phải từ 5 MB trở xuống.',
  ASSET_BAD_IMAGE: 'Hãy dùng ảnh PNG, WebP hoặc JPG không quá 8000 px mỗi cạnh.',
  SLOTS_FULL: 'Túi đồ của người chơi không đủ chỗ (tối đa 12 ô).',
  MARKET_USER_NOT_FOUND: 'Không tìm thấy người chơi này.',
};

/** Every message a refusal carries: the rules it broke, or what its code means here. */
export function errorMessages(error) {
  const violations = error?.errors?.violations;
  if (Array.isArray(violations) && violations.length > 0) return violations.map((violation) => violation.message);
  const known = CODE_TEXT[error?.errors?.code];
  if (known) return [known];
  if (error?.status === 0) return ['Không kết nối được máy chủ.'];
  return [error?.message || 'Không thực hiện được. Hãy thử lại.'];
}

export const errorsHtml = (messages) => (messages.length === 0 ? '' : `
  <ul class="ac-errors" role="alert">
    ${messages.map((message) => `<li>${escapeHtml(message)}</li>`).join('')}
  </ul>`);

// ------------------------------------------------------------------ dialogs

/**
 * A modal on top of the page, removed when closed. `signal` closes it when the page goes away, because a dialog lives
 * on the document and the router only replaces the page.
 */
let dialogCount = 0;

export function openDialog({ title, subHtml = '', body, wide = false, signal }) {
  const dialog = document.createElement('dialog');
  const titleId = `ac-dialog-title-${++dialogCount}`;
  dialog.className = `ac-dialog${wide ? ' ac-dialog--wide' : ''}`;
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.innerHTML = `
    <header class="ac-dialog-head">
      <div class="ac-dialog-heading">
        <h2 id="${titleId}">${escapeHtml(title)}</h2>
        ${subHtml ? `<p class="ac-dialog-sub">${subHtml}</p>` : ''}
      </div>
      <button type="button" class="ac-dialog-close" data-ac-dialog-close aria-label="Đóng" title="Đóng">${icon('x', 20)}</button>
    </header>
    <div class="ac-dialog-body">${body}</div>`;
  document.body.append(dialog);
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  dialog.querySelector('[data-ac-dialog-close]').addEventListener('click', close);
  dialog.addEventListener('close', () => dialog.remove());
  signal?.addEventListener('abort', close, { once: true });
  dialog.showModal();
  // Start where the typing starts (a reason, a name, a search), not on the close button.
  dialog.querySelector('.ac-dialog-body :is(input:not([type="hidden"]):not([hidden]):not([type="checkbox"]), textarea, select)')?.focus();
  return { dialog, close };
}

/**
 * Asks before something that matters. `action(reason)` runs on confirming: a refusal keeps the dialog open with its
 * reasons, success closes it. Resolves to whether it went through.
 */
export function confirmDialog({ title, body = '', confirmLabel = 'Xác nhận', danger = false, reason = 'required', reasonLabel = 'Lý do', extra = '', signal, action }) {
  return new Promise((resolve) => {
    const { dialog, close } = openDialog({
      title,
      signal,
      body: `
        ${body}
        ${extra}
        ${reason === 'none' ? '' : `
          <label class="ac-field">
            <span>${escapeHtml(reasonLabel)}${reason === 'required' ? '' : ' <small class="ac-optional">(không bắt buộc)</small>'}</span>
            <textarea class="field-input" name="reason" rows="2" maxlength="500"></textarea>
          </label>`}
        <div data-ac-errors></div>
        <div class="ac-dialog-actions">
          <button type="button" class="btn btn-ghost" data-ac-cancel>Hủy</button>
          <button type="button" class="btn ${danger ? 'ac-btn-danger' : 'btn-primary'}" data-ac-confirm>${escapeHtml(confirmLabel)}</button>
        </div>`,
    });
    let settled = false;
    const settle = (value) => { if (!settled) { settled = true; resolve(value); } };
    dialog.addEventListener('close', () => settle(false));
    const showErrors = (messages) => { dialog.querySelector('[data-ac-errors]').innerHTML = errorsHtml(messages); };
    dialog.querySelector('[data-ac-cancel]').addEventListener('click', close);
    const confirm = dialog.querySelector('[data-ac-confirm]');
    confirm.addEventListener('click', async () => {
      const text = dialog.querySelector('[name="reason"]')?.value.trim() ?? '';
      if (reason === 'required' && !text) {
        showErrors(['Hãy nhập lý do.']);
        return;
      }
      confirm.disabled = true;
      try {
        await action(text || null, dialog);
        settle(true);
        close();
      } catch (error) {
        showErrors(errorMessages(error));
        confirm.disabled = false;
      }
    });
  });
}

// ------------------------------------------------------------------ thumbnails

const COSMETIC_REPAINTS_MS = [300, 1000, 2000, 4000];

/** The icon of an item type. Cosmetics are painted art: mountThumbs draws them once they scroll into view. */
export function itemThumb(def, size = 36) {
  if (isCosmeticDef(def)) {
    return `<canvas class="ac-thumb" width="${size * 2}" height="${size * 2}" style="width:${size}px;height:${size}px" data-ac-thumb="${escapeHtml(def.id)}" data-ac-thumb-category="${escapeHtml(def.category)}" aria-hidden="true"></canvas>`;
  }
  return itemIcon(def, size);
}

/** Paints the cosmetic thumbnails under `root` when they first appear, and again while their art arrives. */
export function mountThumbs(root, signal) {
  const canvases = [...root.querySelectorAll('canvas[data-ac-thumb]')];
  if (canvases.length === 0) return;
  const paint = (canvas) => {
    const sprite = cosmeticSprite({ id: canvas.dataset.acThumb, category: canvas.dataset.acThumbCategory });
    const draw = () => { if (canvas.isConnected && !signal?.aborted) paintSprite(canvas, sprite); };
    draw();
    for (const delay of COSMETIC_REPAINTS_MS) setTimeout(draw, delay);
  };
  if (!('IntersectionObserver' in window)) {
    canvases.forEach(paint);
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      paint(entry.target);
    }
  });
  canvases.forEach((canvas) => observer.observe(canvas));
  signal?.addEventListener('abort', () => observer.disconnect(), { once: true });
}
