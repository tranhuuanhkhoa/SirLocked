import { EN, FR, T, avatarImg, prepareCosmetics, reduce, setPlaqueMotion, titleHTML, warmEntranceArt, whenTitleFontReady } from '../../../cosmetics/index.js';
import { createPainter } from '../../../cosmetics/painter.js';
import { paintStageThumb } from '../../../cosmetics/stage.js';
import { icon, pager, rarityPill, stateBox } from '../../../components/admin/ui.js';
import { escapeHtml } from '../../../utils/dom.js';
import { RARITIES, acquisitionText, categoryOf, keyOf, rarityLabel } from './shared.js';

const STILL_SECONDS = 2.5;
const WAYS = [
  { id: '', label: 'Mọi cách nhận' },
  { id: 'level', label: 'Theo cấp' },
  { id: 'achievement', label: 'Thành tích' },
  { id: 'default', label: 'Mặc định' },
  { id: 'chest', label: 'Ra từ hòm' },
  { id: 'admin', label: 'Chỉ admin cấp' },
];
const STATES = [
  { id: 'live', label: 'Đang phát hành' },
  { id: 'retired', label: 'Đã retire' },
  { id: 'all', label: 'Tất cả' },
];
/**
 * Cards per page. The design pages by 12; 24 keeps every frame that ships (Kim Long is the 13th) on the first page,
 * where admins and the end-to-end suites look for them.
 */
const PAGE_SIZES = [12, 24, 48];
const DEFAULT_PAGE_SIZE = 24;
const FILTER_LABELS = { rarity: 'Lọc độ hiếm', way: 'Lọc cách nhận', state: 'Lọc trạng thái' };

/* Kept while moving between tabs and into an editor and back. */
const filters = { rarity: '', way: '', state: 'live', text: '' };
const paging = { size: DEFAULT_PAGE_SIZE, page: {} };

function matches(item) {
  if (filters.rarity && item.rarity !== filters.rarity) return false;
  if (filters.state === 'live' && item.retired) return false;
  if (filters.state === 'retired' && !item.retired) return false;
  if (filters.way === 'chest' && item.acquisition.chests.length === 0) return false;
  if (filters.way && filters.way !== 'chest' && item.acquisition.mode !== filters.way) return false;
  const text = filters.text.trim().toLowerCase();
  return !text || item.name.toLowerCase().includes(text) || item.id.toLowerCase().includes(text);
}

const previewHtml = (item) => {
  if (item.category === 'FRAME') return '<canvas class="acf-card-frame" width="160" height="160" aria-hidden="true"></canvas>';
  if (item.category === 'ENTRANCE') return '<canvas class="acf-card-stage" width="320" height="180" aria-hidden="true"></canvas>';
  return '<span class="acf-card-title" data-card-title></span>';
};

const cardHtml = (item) => {
  const notes = [item.tradable ? '' : 'không giao dịch', item.retired ? 'đã retire' : ''].filter(Boolean);
  return `
    <a class="acf-card${item.retired ? ' is-retired' : ''}" href="/admin/cosmetics/${encodeURIComponent(item.id)}" data-card="${escapeHtml(item.id)}">
      <span class="acf-card-art acf-card-art--${item.category.toLowerCase()} hs-root">${previewHtml(item)}</span>
      <span class="acf-card-body">
        <strong class="acf-card-name">${escapeHtml(item.name)}</strong>
        <span class="acf-card-tags">
          ${rarityPill(item.rarity, rarityLabel(item.rarity))}
          ${notes.length ? `<span class="acf-card-note">· ${escapeHtml(notes.join(' · '))}</span>` : ''}
        </span>
        <span class="acf-card-foot">
          <span class="acf-card-way" data-way>${escapeHtml(acquisitionText(item))}</span>
          <span class="acf-card-owners" data-owners>${Number(item.owners ?? 0).toLocaleString('vi-VN')} sở hữu</span>
        </span>
      </span>
    </a>`;
};

/** The grid of one category: every card on the page moves as players see it, while it is on screen. */
export function mountGrid(host, { page, category }) {
  prepareCosmetics();
  if (category === 'ENTRANCE') warmEntranceArt();
  const painter = createPainter();
  const noun = categoryOf(category)?.noun ?? '';
  let disposed = false;
  let stopStages = null;
  const plaqueWatch = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) setPlaqueMotion(entry.target, entry.isIntersecting);
    })
    : null;

  const select = (name, options, chosen) => `
    <label class="acf-select">
      <span class="bpa-sr">${FILTER_LABELS[name]}</span>
      <select class="field-input" data-filter="${name}">
        ${options.map((option) => `<option value="${option.id}"${chosen === option.id ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
      </select>
    </label>`;

  host.innerHTML = `
    <div class="acf-grid-area">
      <div class="acf-toolbar">
        <label class="adm-search-box acf-search">
          ${icon('search', 18)}
          <span class="bpa-sr">Tìm theo tên</span>
          <input type="search" data-filter="text" placeholder="Tìm theo tên" value="${escapeHtml(filters.text)}">
        </label>
        ${select('rarity', [{ id: '', label: 'Mọi độ hiếm' }, ...RARITIES], filters.rarity)}
        ${select('way', WAYS, filters.way)}
        ${select('state', STATES, filters.state)}
        <a class="btn btn-primary acf-new" href="/admin/cosmetics/new?type=${category}" data-new>${icon('plus', 18)}Tạo ${escapeHtml(noun)} mới</a>
      </div>
      <div class="acf-cards" data-cards></div>
      <nav class="acf-pager" data-pager aria-label="Phân trang"></nav>
    </div>`;

  const cards = host.querySelector('[data-cards]');
  const pagerHost = host.querySelector('[data-pager]');

  const drawCards = () => {
    painter.clear();
    plaqueWatch?.disconnect();
    stopStages?.();
    stopStages = null;
    const shown = page.items.filter((item) => item.category === category && matches(item));
    const pages = Math.max(1, Math.ceil(shown.length / paging.size));
    const current = Math.min(Math.max(1, paging.page[category] ?? 1), pages);
    paging.page[category] = current;
    const items = shown.slice((current - 1) * paging.size, current * paging.size);

    cards.innerHTML = items.length === 0 ? stateBox('empty', 'Không có món nào khớp bộ lọc.') : items.map(cardHtml).join('');
    cards.classList.toggle('is-empty', items.length === 0);
    pagerHost.hidden = shown.length === 0;
    pagerHost.innerHTML = shown.length === 0 ? '' : pager({
      page: current,
      pageSize: paging.size,
      total: shown.length,
      noun,
      perPageHtml: `
        <label class="acf-per-page">Mỗi trang
          <select class="field-input" data-page-size>
            ${PAGE_SIZES.map((size) => `<option value="${size}"${size === paging.size ? ' selected' : ''}>${size}</option>`).join('')}
          </select>
        </label>`,
    });

    const stages = [];
    for (const item of items) {
      const card = cards.querySelector(`[data-card="${CSS.escape(item.id)}"]`);
      const key = keyOf(item);
      if (item.category === 'FRAME') {
        painter.add(card.querySelector('canvas'), () => (FR[key] ? key : 'none'), () => avatarImg('nonla'));
      } else if (item.category === 'TITLE') {
        const slot = card.querySelector('[data-card-title]');
        const plaque = T[key] ?? T['tan-binh'];
        slot.innerHTML = titleHTML(plaque, { maxW: Math.max(180, (slot.clientWidth || 280) - 8) });
        if (plaqueWatch) plaqueWatch.observe(slot);
        else setPlaqueMotion(slot, true);
      } else if (EN[key]) {
        stages.push({ key, canvas: card.querySelector('canvas'), card });
      }
    }
    if (stages.length === 0) return;
    // A stage is the heaviest thing here, so one is drawn per paint and they take turns; the one being pointed at keeps moving.
    const seen = new Set();
    const watch = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) seen.add(entry.target);
          else seen.delete(entry.target);
        }
      })
      : null;
    let hovered = null;
    let turn = 0;
    for (const stage of stages) {
      watch?.observe(stage.canvas);
      if (!watch) seen.add(stage.canvas);
      stage.card.addEventListener('pointerenter', () => { hovered = stage; });
      stage.card.addEventListener('pointerleave', () => { if (hovered === stage) hovered = null; });
    }
    const stop = painter.onPaint((seconds) => {
      const visible = stages.filter((stage) => seen.has(stage.canvas));
      const stage = hovered ?? visible[turn++ % Math.max(1, visible.length)];
      if (stage) paintStageThumb(stage.canvas, stage.key, reduce.matches ? STILL_SECONDS : seconds);
    });
    stopStages = () => {
      stop();
      watch?.disconnect();
    };
  };

  host.querySelectorAll('[data-filter]').forEach((input) => input.addEventListener('input', () => {
    filters[input.dataset.filter] = input.value;
    paging.page[category] = 1;
    drawCards();
  }));
  pagerHost.addEventListener('click', (event) => {
    const button = event.target.closest('[data-adm-page]');
    if (!button || button.disabled) return;
    paging.page[category] = Number(button.dataset.admPage);
    drawCards();
    // The buttons are under the cards: bring the top of the new page back into view, below the sticky top bar.
    const top = cards.getBoundingClientRect().top;
    if (top < 0) window.scrollBy(0, top - 96);
  });
  pagerHost.addEventListener('change', (event) => {
    if (!event.target.matches('[data-page-size]')) return;
    paging.size = Number(event.target.value) || DEFAULT_PAGE_SIZE;
    paging.page[category] = 1;
    drawCards();
  });
  drawCards();
  // Plaques measure their text, so they are drawn again once the title font has come.
  if (category === 'TITLE') whenTitleFontReady().then(() => { if (!disposed) drawCards(); });

  return () => {
    disposed = true;
    stopStages?.();
    plaqueWatch?.disconnect();
    painter.dispose();
  };
}
