import { workshopApi } from '../api/workshopApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render, placeholderStyle } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { renderCaseOfWeekBanner } from './workshop/caseOfWeekBanner.js';

const SORTS = [
  { key: 'hot', label: 'Hot' },
  { key: 'new', label: 'Mới' },
  { key: 'top', label: 'Top điểm' },
  { key: 'hard', label: 'Khó nhất' },
];

function pct(fraction) {
  return `${Math.round((fraction ?? 0) * 100)}%`;
}

function cardHtml(c) {
  const teaser = c.totalPlays > 0
    ? `<span class="ws-teaser">${pct(c.wrongCulpritRate)} đội buộc tội nhầm</span>`
    : '<span class="ws-teaser ws-teaser-empty">Chưa có lượt chơi nào</span>';
  return `
    <article class="case-card card panel--dossier ws-card">
      <div class="case-cover card-media" style="${placeholderStyle(c.caseId)}">
        ${c.coverImageUrl ? `<img src="${escapeHtml(c.coverImageUrl)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
        <span class="case-cover-title">${escapeHtml(c.title)}</span>
      </div>
      <div class="case-body card-body">
        <div class="ws-card-by muted small">Tác giả: ${escapeHtml(c.author)}</div>
        <p class="case-summary card-text">${escapeHtml(c.summary)}</p>
        <div class="case-meta cluster">
          <span class="chip">${escapeHtml(String(c.estimatedMinutes))} phút</span>
          <span class="chip">${c.totalPlays} lượt chơi</span>
          ${c.mechanicsVersion === 3
            ? '<span class="chip chip-gold">V3 · Crack</span>'
            : c.mechanicsVersion === 2 ? '<span class="chip chip-gold">V2</span>' : ''}
        </div>
        <div class="ws-teaser-row">${teaser}</div>
      </div>
      <div class="case-actions card-foot">
        <button class="btn btn-primary btn-sm" data-create="${escapeHtml(c.caseId)}">Chơi</button>
        <a class="btn btn-ghost btn-sm" href="#/workshop/${encodeURIComponent(c.caseId)}">Thống kê</a>
      </div>
    </article>`;
}

export async function renderWorkshopPage(app) {
  const state = { search: '', sort: 'hot', page: 1, pageSize: 12 };
  let debounce = null;

  render(app, `
  <div class="page">
    <div class="page-head">
      <h2>Workshop màn chơi</h2>
      <div class="case-actions">
        <a class="btn btn-ghost" href="#/workshop/challenge">Thử thách tuần</a>
        <a class="btn btn-ghost" href="#/cases">Tất cả case</a>
      </div>
    </div>
    <div id="ws-cow-mount"></div>
    <div class="ws-toolbar">
      <input id="ws-search" class="field-input ws-search" type="search"
             placeholder="Tìm theo tên vụ án…" autocomplete="off" aria-label="Tìm vụ án">
      <div class="tab-row ws-tabs" role="tablist" aria-label="Sắp xếp">
        ${SORTS.map((s) => `<button class="ws-tab" type="button" data-sort="${s.key}">${s.label}</button>`).join('')}
      </div>
    </div>
    <div id="ws-results"><p class="muted">Đang tải…</p></div>
  </div>`);

  const resultsEl = app.querySelector('#ws-results');
  const searchEl = app.querySelector('#ws-search');
  const tabsEl = app.querySelector('.ws-tabs');

  renderCaseOfWeekBanner(app.querySelector('#ws-cow-mount'));

  function syncTabs() {
    tabsEl.querySelectorAll('.ws-tab').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.sort === state.sort));
  }

  async function load() {
    syncTabs();
    let data;
    try {
      data = await workshopApi.cases(state);
    } catch (err) {
      render(resultsEl, `<div class="empty-state">${escapeHtml(err.message)}</div>`);
      return;
    }
    const items = data.items || [];
    if (items.length === 0) {
      render(resultsEl, `<div class="empty-state">${state.search
        ? 'Không tìm thấy vụ án nào khớp tìm kiếm.'
        : 'Chưa có vụ án nào được phát hành.'}</div>`);
      return;
    }
    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    render(resultsEl, `
      <div class="case-grid grid-auto">${items.map(cardHtml).join('')}</div>
      ${totalPages > 1 ? `
        <div class="ws-pagination">
          <button class="btn btn-ghost btn-sm" type="button" data-page="prev" ${data.page <= 1 ? 'disabled' : ''}>← Trước</button>
          <span class="muted small">Trang ${data.page} / ${totalPages}</span>
          <button class="btn btn-ghost btn-sm" type="button" data-page="next" ${data.page >= totalPages ? 'disabled' : ''}>Sau →</button>
        </div>` : ''}`);
    state.page = data.page; // reflect the server-clamped page
  }

  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.ws-tab');
    if (!btn) return;
    state.sort = btn.dataset.sort;
    state.page = 1;
    load();
  });

  searchEl.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.search = searchEl.value.trim();
      state.page = 1;
      load();
    }, 250);
  });

  resultsEl.addEventListener('click', async (e) => {
    const pageBtn = e.target.closest('[data-page]');
    if (pageBtn) {
      state.page += pageBtn.dataset.page === 'next' ? 1 : -1;
      if (state.page < 1) state.page = 1;
      load();
      return;
    }
    const createBtn = e.target.closest('[data-create]');
    if (createBtn) {
      createBtn.disabled = true;
      try {
        const room = await roomApi.create(createBtn.dataset.create);
        toast(`Đã tạo phòng ${room.roomCode}.`, 'success');
        window.location.hash = `#/lobby/${room.roomId}`;
      } catch (err) {
        toast(err.message, 'error');
        createBtn.disabled = false;
      }
    }
  });

  await load();
  return () => clearTimeout(debounce);
}
