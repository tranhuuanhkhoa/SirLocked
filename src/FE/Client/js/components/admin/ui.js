import { tr, uiLanguage } from '../../services/i18n.js';
import { escapeHtml, initials } from '../../utils/dom.js';
import { icon } from './icons.js';

/**
 * Mảnh giao diện dùng chung của các trang admin (CSS ở css/60-admin-theme.css).
 * Mọi hàm trả về chuỗi HTML; chữ truyền vào được escape, trừ các tham số tên `...Html`.
 */

/** Đầu trang: dòng nhỏ phía trên, tiêu đề lớn, mô tả và nút bên phải. */
export function pageHead({ title, eyebrow = '', sub = '', actionsHtml = '', backHref = '', backLabel = '' }) {
  return `
    ${backHref ? `<a class="adm-back-link" href="${escapeHtml(backHref)}">${icon('arrowLeft', 16)}${escapeHtml(backLabel)}</a>` : ''}
    <div class="adm-head">
      <div class="adm-head-text">
        ${eyebrow ? `<span class="adm-eyebrow">${escapeHtml(eyebrow)}</span>` : ''}
        <h1>${escapeHtml(title)}</h1>
        ${sub ? `<p class="adm-sub">${escapeHtml(sub)}</p>` : ''}
      </div>
      ${actionsHtml ? `<div class="adm-actions">${actionsHtml}</div>` : ''}
    </div>`;
}

/** Thẻ số lớn có icon và đường dẫn (khối "Hôm nay"). tone: '', 'ok', 'violet', 'bad'. */
export function kpiCard({ label, value, href = '', linkLabel = '', iconName = 'grid', tone = '', dark = false, note = '' }) {
  const tag = href ? 'a' : 'div';
  return `
    <${tag} class="adm-card adm-kpi${dark ? ' adm-kpi--dark' : ''}"${href ? ` href="${escapeHtml(href)}"` : ''}>
      <span class="adm-kpi-top">
        ${iconName ? `<span class="adm-kpi-icon${tone ? ` adm-kpi-icon--${tone}` : ''}">${icon(iconName, 20)}</span>` : ''}
        <span>${escapeHtml(label)}</span>
      </span>
      <span class="adm-kpi-value">${escapeHtml(String(value))}</span>
      ${note ? `<span class="adm-tile-note">${escapeHtml(note)}</span>` : ''}
      ${href && linkLabel ? `<span class="adm-kpi-link">${escapeHtml(linkLabel)}${icon('arrowRight', 16)}</span>` : ''}
    </${tag}>`;
}

/** Ô số nhỏ trong một thẻ (khối "Toàn hệ thống"). `meter` là phần trăm 0-100 để vẽ thanh. */
export function tile({ label, value, of = null, note = '', meter = null, gold = false }) {
  return `
    <div class="adm-tile">
      <span class="adm-tile-label">${escapeHtml(label)}</span>
      <span class="adm-tile-value${gold ? ' adm-tile-value--gold' : ''}">${escapeHtml(String(value))}${of === null ? '' : `<small> / ${escapeHtml(String(of))}</small>`}</span>
      ${meter === null ? '' : `<span class="adm-meter" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, Number(meter) || 0))}%"></span></span>`}
      ${note ? `<span class="adm-tile-note">${escapeHtml(note)}</span>` : ''}
    </div>`;
}

/** Thẻ trắng có tiêu đề. `flush` bỏ lề trong để bảng chạm mép thẻ. */
export function card({ title = '', sub = '', headExtraHtml = '', bodyHtml = '', flush = false, id = '', labelledBy = '' }) {
  const headingId = labelledBy || (title && id ? `${id}-title` : '');
  return `
    <section class="adm-card${flush ? ' adm-card--flush' : ''}"${id ? ` id="${escapeHtml(id)}"` : ''}${headingId ? ` aria-labelledby="${escapeHtml(headingId)}"` : ''}>
      ${title || headExtraHtml ? `
        <div class="adm-card-head">
          ${title ? `<div><h2 class="adm-card-title"${headingId ? ` id="${escapeHtml(headingId)}"` : ''}>${escapeHtml(title)}</h2>${sub ? `<p class="adm-card-sub">${escapeHtml(sub)}</p>` : ''}</div>` : ''}
          ${headExtraHtml}
        </div>` : ''}
      ${bodyHtml}
    </section>`;
}

/** Nhãn tròn. tone: '', 'ok', 'bad', 'gold', 'violet', 'navy', 'line'. */
export function pill(text, tone = '', { dot = false, small = false } = {}) {
  const classes = ['adm-pill', tone && `adm-pill--${tone}`, dot && 'adm-dot', small && 'adm-pill--sm'].filter(Boolean).join(' ');
  return `<span class="${classes}">${escapeHtml(text)}</span>`;
}

export const RARITY_LABEL = { COMMON: 'Thường', RARE: 'Hiếm', EPIC: 'Quý', LEGENDARY: 'Huyền thoại', MYSTERY: 'Bí ẩn' };

/** Huy hiệu độ hiếm theo bảng màu của thiết kế. */
export function rarityPill(rarity, label = RARITY_LABEL[rarity] ?? rarity) {
  return `<span class="adm-pill adm-rarity adm-rarity--${escapeHtml(String(rarity || 'COMMON'))}">${escapeHtml(label)}</span>`;
}

/** Ô người: avatar chữ cái đầu, tên, dòng phụ. */
export function person(name, sub = '', { avatarUrl = '' } = {}) {
  return `
    <span class="adm-person">
      <span class="adm-avatar" aria-hidden="true">${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="">` : escapeHtml(initials(name))}</span>
      <span class="adm-person-text"><strong>${escapeHtml(name)}</strong>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span>
    </span>`;
}

/**
 * Tab dạng khay. items: [{ label, href? , key?, active, count? }]. Có href thì là liên kết, không thì là nút
 * `data-adm-tab="key"`. Trang tự gắn sự kiện.
 */
export function segTabs(items, label) {
  return `
    <nav class="adm-seg" aria-label="${escapeHtml(label)}">
      ${items.map((item) => {
    const count = item.count === undefined || item.count === null ? '' : ` <span class="adm-count">${escapeHtml(String(item.count))}</span>`;
    return item.href
      ? `<a href="${escapeHtml(item.href)}"${item.active ? ' class="is-active" aria-current="page"' : ''}>${escapeHtml(item.label)}${count}</a>`
      : `<button type="button" data-adm-tab="${escapeHtml(item.key)}" aria-pressed="${item.active ? 'true' : 'false'}"${item.active ? ' class="is-active"' : ''}>${escapeHtml(item.label)}${count}</button>`;
  }).join('')}
    </nav>`;
}

/** Trạng thái trống, đang tải hoặc lỗi. kind: 'empty' | 'loading' | 'error'. */
export function stateBox(kind, title, note = '') {
  const cls = kind === 'error' ? 'adm-state adm-state--error' : kind === 'loading' ? 'adm-state adm-loading' : 'adm-state';
  const role = kind === 'error' ? ' role="alert"' : kind === 'loading' ? ' role="status"' : '';
  return `<div class="${cls}"${role}><strong>${escapeHtml(title)}</strong>${note ? `<span>${escapeHtml(note)}</span>` : ''}</div>`;
}

/**
 * Dải phân trang dưới bảng: "Hiển thị 1-10 / 42 ..." và các nút trang.
 * Nút mang data-adm-page="n"; trang tự gắn sự kiện. perPage là chuỗi HTML tùy chọn (ô chọn số dòng).
 */
export function pager({ page, pageSize, total, noun = 'mục', perPageHtml = '' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const numbers = [];
  for (let n = 1; n <= pages; n += 1) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 2) numbers.push(n);
    else if (numbers[numbers.length - 1] !== '…') numbers.push('…');
  }
  return `
    <div class="adm-pager">
      <span>${tr('Showing', 'Hiển thị')} <strong>${from}–${to}</strong> / ${total.toLocaleString('vi-VN')} ${escapeHtml(noun)}</span>
      <div class="adm-pager-nav">
        ${perPageHtml}
        <button type="button" class="adm-page-btn" data-adm-page="${page - 1}" aria-label="${tr('Previous page', 'Trang trước')}"${page <= 1 ? ' disabled' : ''}>${icon('chevronLeft', 16)}</button>
        ${numbers.map((n) => (n === '…'
    ? '<span aria-hidden="true">…</span>'
    : `<button type="button" class="adm-page-btn" data-adm-page="${n}"${n === page ? ' aria-current="page"' : ''} aria-label="${tr(`Page ${n}`, `Trang ${n}`)}">${n}</button>`)).join('')}
        <button type="button" class="adm-page-btn" data-adm-page="${page + 1}" aria-label="${tr('Next page', 'Trang sau')}"${page >= pages ? ' disabled' : ''}>${icon('chevronRight', 16)}</button>
      </div>
    </div>`;
}

/** Ngày giờ kiểu thiết kế: "THỨ SÁU · 06/11/2026" (tiếng Anh: "FRIDAY · 06/11/2026"). */
export function todayEyebrow(date = new Date()) {
  const locale = uiLanguage() === 'vi' ? 'vi-VN' : 'en-GB';
  const day = date.toLocaleDateString(locale, { weekday: 'long' });
  const stamp = date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${day} · ${stamp}`.toUpperCase();
}

export { icon };
