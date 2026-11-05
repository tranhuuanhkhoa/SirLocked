import { EN, FR, T, avatarImg, prepareCosmetics, rarOf, reduce, setPlaqueMotion, titleHTML, warmEntranceArt, whenTitleFontReady } from '../../../cosmetics/index.js';
import { createPainter } from '../../../cosmetics/painter.js';
import { paintStageThumb } from '../../../cosmetics/stage.js';
import { escapeHtml } from '../../../utils/dom.js';
import { CATEGORIES, RARITIES, acquisitionText, keyOf, rarityLabel } from './shared.js';

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
/* Kept while moving between tabs and into an editor and back. */
const filters = { rarity: '', way: '', state: 'live', text: '' };

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
  return '<div class="acf-card-title" data-card-title></div>';
};

const cardHtml = (item) => {
  const rar = rarOf(item.rarity);
  return `
    <a class="acf-card${item.retired ? ' is-retired' : ''}" href="#/admin/cosmetics/${encodeURIComponent(item.id)}" data-card="${escapeHtml(item.id)}" style="--rc:${rar.c}">
      <div class="acf-card-art hs-root">${previewHtml(item)}</div>
      <div class="acf-card-body">
        <b>${escapeHtml(item.name)}</b>
        <span class="acf-rarity">${escapeHtml(rarityLabel(item.rarity))}${item.retired ? ' · đã retire' : ''}${item.tradable ? '' : ' · không giao dịch'}</span>
        <small data-owners>${item.owners} người sở hữu</small>
        <small data-way>${escapeHtml(acquisitionText(item))}</small>
      </div>
    </a>`;
};

/** The grid of one category: every card moves as players see it, while it is on screen. */
export function mountGrid(host, { page, category }) {
  prepareCosmetics();
  if (category === 'ENTRANCE') warmEntranceArt();
  const painter = createPainter();
  const label = CATEGORIES.find((entry) => entry.id === category)?.label ?? '';
  let disposed = false;
  let stopStages = null;
  const plaqueWatch = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) setPlaqueMotion(entry.target, entry.isIntersecting);
    })
    : null;

  const drawCards = () => {
    painter.clear();
    plaqueWatch?.disconnect();
    stopStages?.();
    stopStages = null;
    const items = page.items.filter((item) => item.category === category && matches(item));
    const cards = host.querySelector('[data-cards]');
    cards.innerHTML = items.length === 0
      ? '<p class="empty-state small">Không có món nào khớp bộ lọc.</p>'
      : items.map(cardHtml).join('');
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

  const select = (name, options, chosen) => `
    <select class="field-input" data-filter="${name}" aria-label="${name === 'rarity' ? 'Lọc độ hiếm' : name === 'way' ? 'Lọc cách nhận' : 'Lọc trạng thái'}">
      ${options.map((option) => `<option value="${option.id}"${chosen === option.id ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
    </select>`;

  host.innerHTML = `
    <div class="acf-toolbar">
      <input class="field-input" type="search" data-filter="text" placeholder="Tìm theo tên" aria-label="Tìm theo tên" value="${escapeHtml(filters.text)}">
      ${select('rarity', [{ id: '', label: 'Mọi độ hiếm' }, ...RARITIES], filters.rarity)}
      ${select('way', WAYS, filters.way)}
      ${select('state', STATES, filters.state)}
      <a class="btn btn-primary" href="#/admin/cosmetics/new?type=${category}" data-new>Tạo ${escapeHtml(label.toLowerCase())} mới</a>
    </div>
    <div class="acf-cards" data-cards></div>`;

  host.querySelectorAll('[data-filter]').forEach((input) => input.addEventListener('input', () => {
    filters[input.dataset.filter] = input.value;
    drawCards();
  }));
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
