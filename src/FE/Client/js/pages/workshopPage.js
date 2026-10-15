import '../../../css/34-bpa-workshop.css';
import { workshopApi } from '../api/workshopApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';
import { renderCaseOfWeekBanner, coverArtHtml, fmtInt, minutesLabel } from './workshop/caseOfWeekBanner.js';

const SORTS = [
  { key: 'hot', label: () => tr('Hot', 'Hot') },
  { key: 'new', label: () => tr('New', 'Mới') },
  { key: 'top', label: () => tr('Top rated', 'Top điểm') },
  { key: 'hard', label: () => tr('Hardest', 'Khó nhất') },
];

/** Backend placeholder until cases store authorship (WorkshopAuthors.Unknown). */
const UNKNOWN_AUTHOR = 'Unknown';

function pct(fraction) {
  return `${Math.round((fraction ?? 0) * 100)}%`;
}

function mechanicsChip(version) {
  if (version === 3) return `<span class="bpa-chip bpa-chip--dark">${tr('V3 · CRACK', 'V3 · CRACK')}</span>`;
  if (version === 2) return '<span class="bpa-chip">V2</span>';
  return '';
}

function cardHtml(c) {
  const author = String(c.author || '').trim();
  const showAuthor = author && author !== UNKNOWN_AUTHOR;
  const teaser = c.totalPlays > 0
    ? `<p class="bpa-ws-teaser">${tr(`${pct(c.wrongCulpritRate)} of teams accused the wrong culprit`, `${pct(c.wrongCulpritRate)} đội buộc tội nhầm`)}</p>`
    : `<p class="bpa-ws-teaser bpa-ws-teaser--empty">${tr('No plays yet', 'Chưa có lượt chơi nào')}</p>`;
  const title = escapeHtml(c.title);
  return `
    <li>
      <article class="bpa-ws-card">
        <div class="bpa-ws-cover">${coverArtHtml(c.caseId, c.coverImageUrl)}</div>
        <div class="bpa-ws-card-body">
          <h3 class="bpa-ws-card-title">${title}</h3>
          ${showAuthor ? `<p class="bpa-ws-by">${tr('Author', 'Tác giả')}: ${escapeHtml(author)}</p>` : ''}
          ${c.summary ? `<p class="bpa-ws-card-summary">${escapeHtml(c.summary)}</p>` : ''}
          <div class="bpa-ws-chips">
            ${c.estimatedMinutes ? `<span class="bpa-chip">${minutesLabel(c.estimatedMinutes)}</span>` : ''}
            <span class="bpa-chip">${fmtInt(c.totalPlays)} ${tr(c.totalPlays === 1 ? 'PLAY' : 'PLAYS', 'LƯỢT CHƠI')}</span>
            ${mechanicsChip(c.mechanicsVersion)}
          </div>
          ${teaser}
          <div class="bpa-ws-card-cta">
            <button class="bpa-btn bpa-btn--red" type="button" data-create="${escapeHtml(c.caseId)}">${tr('Play', 'Chơi')}<span class="bpa-sr"> — ${title}</span></button>
            <a class="bpa-btn bpa-btn--ink" href="#/workshop/${encodeURIComponent(c.caseId)}">${tr('Statistics', 'Thống kê')}<span class="bpa-sr"> — ${title}</span></a>
          </div>
        </div>
      </article>
    </li>`;
}

function noteHtml(message) {
  return `
    <div class="bpa-ws-note" role="status">
      <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
      <p>${escapeHtml(message)}</p>
    </div>`;
}

export async function renderWorkshopPage(app) {
  const state = { search: '', sort: 'hot', page: 1, pageSize: 12 };
  let debounce = null;
  let flip = false;

  render(app, `
  <div class="bpa-container bpa-ws-page">
    <div class="bpa-ws-titlerow">
      <div class="bpa-label bpa-ws-label">
        <p class="bpa-kicker">${tr('File 06 · Community', 'Hồ sơ 06 · Cộng đồng')}</p>
        <h1 class="bpa-ws-h1">Workshop</h1>
      </div>
      <p class="bpa-ws-intro">${tr('Cases written by the community. Play them, rate them, and compare notes with other detectives.', 'Vụ án do cộng đồng viết. Chơi, chấm điểm và so tài với các thám tử khác.')}</p>
      <div class="bpa-ws-actions">
        <a class="bpa-btn bpa-btn--gold" href="#/workshop/challenge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V10M9.5 3h5M12 3v3"/></svg>
          ${tr('Weekly challenge', 'Thử thách tuần')}
        </a>
        <a class="bpa-btn bpa-btn--gold" href="#/cases">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6h6.2l2 2.3h8.8v11.2h-17z"/><path d="M3.5 11h17"/></svg>
          ${tr('All cases', 'Tất cả vụ án')}
        </a>
      </div>
    </div>
    <div id="ws-cow-mount"></div>
    <div class="bpa-ws-toolbar">
      <div class="bpa-ws-searchbox">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/></svg>
        <label class="bpa-sr" for="ws-search">${tr('Search cases', 'Tìm vụ án')}</label>
        <input id="ws-search" class="bpa-ws-search" type="search"
               placeholder="${tr('Search by case title…', 'Tìm theo tên vụ án…')}" autocomplete="off">
      </div>
      <div class="bpa-ws-sorts" role="group" aria-label="${tr('Sort cases', 'Sắp xếp vụ án')}">
        ${SORTS.map((s) => `<button class="bpa-ws-sort" type="button" data-sort="${s.key}" aria-pressed="${s.key === state.sort}">${escapeHtml(s.label())}</button>`).join('')}
      </div>
    </div>
    <div id="ws-results" class="bpa-ws-results"><p class="bpa-ws-loading" role="status">${tr('Loading…', 'Đang tải…')}</p></div>
  </div>`);

  const resultsEl = app.querySelector('#ws-results');
  const searchEl = app.querySelector('#ws-search');
  const tabsEl = app.querySelector('.bpa-ws-sorts');

  renderCaseOfWeekBanner(app.querySelector('#ws-cow-mount'));

  function syncTabs() {
    tabsEl.querySelectorAll('[data-sort]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.sort === state.sort)));
  }

  async function load() {
    syncTabs();
    let data;
    try {
      data = await workshopApi.cases(state);
    } catch (err) {
      render(resultsEl, noteHtml(err.message));
      return;
    }
    const items = data.items || [];
    if (items.length === 0) {
      render(resultsEl, noteHtml(state.search
        ? tr('No case matches your search.', 'Không tìm thấy vụ án nào khớp tìm kiếm.')
        : tr('No case has been published yet.', 'Chưa có vụ án nào được phát hành.')));
      return;
    }
    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    flip = !flip;
    render(resultsEl, `
      <ul class="bpa-ws-grid ${flip ? 'bpa-wipe-b' : 'bpa-wipe-a'}">${items.map(cardHtml).join('')}</ul>
      ${totalPages > 1 ? `
        <nav class="bpa-ws-pager" aria-label="${tr('Pages', 'Phân trang')}">
          <button class="bpa-btn bpa-btn--gold" type="button" data-page="prev" ${data.page <= 1 ? 'disabled' : ''}>
            <span aria-hidden="true">←</span> ${tr('Previous', 'Trước')}
          </button>
          <span class="bpa-ws-pageinfo">${tr(`Page ${data.page} / ${totalPages}`, `Trang ${data.page} / ${totalPages}`)}</span>
          <button class="bpa-btn bpa-btn--gold" type="button" data-page="next" ${data.page >= totalPages ? 'disabled' : ''}>
            ${tr('Next', 'Sau')} <span aria-hidden="true">→</span>
          </button>
        </nav>` : ''}`);
    state.page = data.page; // reflect the server-clamped page
  }

  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sort]');
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
        toast(tr(`Room ${room.roomCode} created.`, `Đã tạo phòng ${room.roomCode}.`), 'success');
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
