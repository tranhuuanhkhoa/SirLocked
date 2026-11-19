import { adminApi } from '../api/adminApi.js';
import { aiCaseApi } from '../api/aiCaseApi.js';
import { icon, pageHead, pager, pill, stateBox } from '../components/admin/ui.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';
import { replaceAddress } from '../services/navigation.js';
import { gateReasonText, isV3, v3PublishGate } from './adminV3Gates.js';

// Older (non-pixel) cases are hidden by the server; this switch asks for them too. Per browser tab, never saved.
let showLegacy = false;

const PAGE_SIZES = [10, 20, 50];

/* ---- small pieces the case detail page uses too (acs- = admin cases) ---- */

const STATUS = {
  PUBLISHED: { label: () => tr('Published', 'Đã xuất bản'), tone: 'ok' },
  DRAFT: { label: () => tr('Draft', 'Bản nháp'), tone: '' },
  ARCHIVED: { label: () => tr('Archived', 'Đã lưu trữ'), tone: 'gold' },
};

export const caseStatusLabel = (status) => STATUS[status]?.label() ?? status;

/** The status of a case as a pill with a dot ("● Đã xuất bản"). */
export function caseStatusPill(status) {
  return `<span class="adm-pill adm-dot acs-status${STATUS[status]?.tone ? ` adm-pill--${STATUS[status].tone}` : ''}">${escapeHtml(caseStatusLabel(status))}</span>`;
}

export const pixelPill = () => '<span class="adm-pill adm-pill--sm acs-pill-pixel">PIXEL</span>';
export const v3Pill = () => '<span class="adm-pill adm-pill--sm adm-pill--line">V3 · Crack</span>';

/** The cover picture, or a navy box that says there is none. A picture that fails to load falls back to the box. */
export function caseCover(url, title, extraClass = '') {
  const empty = `<div class="acs-cover acs-cover--empty${extraClass ? ` ${extraClass}` : ''}">${icon('folder', 24)}<span>${escapeHtml(tr('No cover image', 'Chưa có ảnh bìa'))}</span></div>`;
  if (!url) return empty;
  return `<img class="acs-cover${extraClass ? ` ${extraClass}` : ''}" src="${escapeHtml(url)}" alt="${escapeHtml(tr(`Cover of ${title}`, `Ảnh bìa ${title}`))}" loading="lazy" data-acs-empty="${escapeHtml(empty)}">`;
}

/** Swaps every cover under `root` that cannot load for the "no cover" box. */
export function watchCovers(root) {
  root.querySelectorAll('img.acs-cover').forEach((img) => {
    const fallback = () => { img.outerHTML = img.dataset.acsEmpty; };
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) fallback();
    else img.addEventListener('error', fallback, { once: true });
  });
}

/** Changes ?q= in the address without running the router, so the search box keeps its focus. */
function setQueryParam(value) {
  const params = new URLSearchParams(window.location.search);
  if (value) params.set('q', value);
  else params.delete('q');
  const text = params.toString();
  replaceAddress(`${window.location.pathname}${text ? `?${text}` : ''}`);
}

const FILTERS = [
  { key: 'all', label: () => tr('All', 'Tất cả') },
  { key: 'PUBLISHED', label: () => tr('Published', 'Đã xuất bản') },
  { key: 'DRAFT', label: () => tr('Drafts', 'Bản nháp') },
  // Unpublishing turns a case back into a draft, so there is no separate "unpublished" state to filter on.
  { key: 'ARCHIVED', label: () => tr('Archived', 'Đã lưu trữ'), onlyWhenPresent: true },
];

function matchesSearch(c, text) {
  if (!text) return true;
  const needle = text.toLocaleLowerCase('vi');
  return [c.title, c.caseId].some((value) => String(value ?? '').toLocaleLowerCase('vi').includes(needle));
}

function caseCard(c, capabilities) {
  const gate = v3PublishGate(c, capabilities);
  const href = `/admin/cases/${encodeURIComponent(c.caseId)}`;
  const titleId = `acs-case-${String(c.caseId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const blocked = c.status !== 'PUBLISHED' && !gate.canPublish;
  const reason = blocked ? gateReasonText(gate) : '';
  const publishControl = c.status === 'PUBLISHED'
    ? `<button type="button" class="btn btn-sm adm-btn-danger" data-unpublish="${escapeHtml(c.caseId)}">${tr('Unpublish', 'Gỡ xuất bản')}</button>`
    : gate.canPublish
      ? `<button type="button" class="btn btn-sm adm-btn-ok" data-publish="${escapeHtml(c.caseId)}">${tr('Publish', 'Xuất bản')}</button>`
      : `<button type="button" class="btn btn-sm" disabled title="${escapeHtml(reason)}">${tr('Publish blocked', 'Chưa thể xuất bản')}</button>`;
  const legacyHidden = !c.isPixel && c.status === 'PUBLISHED' && c.playerVisible === false;
  const v3 = isV3(c);
  const stat = (value, label) => `<span class="acs-mini"><strong>${escapeHtml(String(value ?? 0))}</strong><span>${escapeHtml(label)}</span></span>`;
  return `
    <article class="adm-card acs-case" aria-labelledby="${titleId}">
      ${caseCover(c.coverImageUrl, c.title)}
      <div class="acs-case-main">
        <a class="acs-case-title" id="${titleId}" href="${href}">${escapeHtml(c.title)}</a>
        <span class="acs-code">${escapeHtml(c.caseId)}</span>
        <span class="acs-pills">
          ${c.isPixel ? pixelPill() : ''}
          ${legacyHidden ? `<span class="adm-pill adm-pill--sm adm-pill--bad" title="${escapeHtml(tr('Still in the database and in old rooms, but players cannot pick it.', 'Vẫn còn trong dữ liệu và các phòng cũ, nhưng người chơi không chọn được.'))}">${tr('OLD · hidden from players', 'CŨ · ẩn với người chơi')}</span>` : ''}
          ${v3 ? v3Pill() : ''}
          ${v3 && c.hasSourceAiDraft ? `<span class="adm-pill adm-pill--sm ${c.aiSemanticReviewStatus === 'PASSED' ? 'adm-pill--ok' : 'adm-pill--bad'}">Review ${escapeHtml(c.aiSemanticReviewStatus || 'NOT_RUN')}</span>` : ''}
        </span>
      </div>
      <div class="acs-case-stats">
        ${stat(c.stageCount, tr('stages', 'giai đoạn'))}
        ${stat(c.sceneCount, tr('scenes', 'hiện trường'))}
        ${stat(c.clueCount, tr('clues', 'manh mối'))}
      </div>
      <div class="acs-case-status">${caseStatusPill(c.status)}</div>
      <div class="acs-case-actions">
        <a class="btn btn-sm" href="${href}" aria-label="${escapeHtml(tr(`Open ${c.title}`, `Mở ${c.title}`))}">${tr('Open', 'Mở')}</a>
        <a class="btn btn-sm" href="/admin/editor/${encodeURIComponent(c.caseId)}" data-editor-link
          aria-label="${escapeHtml(tr(`Edit ${c.title} in Case Studio`, `Sửa ${c.title} trong Case Studio`))}"
          title="${escapeHtml(c.status === 'PUBLISHED'
    ? tr('Published: Case Studio shows it read-only. Unpublish it to edit.', 'Đã xuất bản: Case Studio chỉ cho xem. Gỡ xuất bản để sửa.')
    : tr('Edit in Case Studio', 'Sửa trong Case Studio'))}">${tr('Edit', 'Sửa')}</a>
        ${publishControl}
      </div>
      ${blocked ? `<p class="acs-case-reason v3-gate-reason">${escapeHtml(reason)}</p>` : ''}
    </article>`;
}

export async function renderAdminCasesPage(app) {
  const state = {
    cases: null,
    capabilities: null,
    // The search on the top bar sends people here with ?q=.
    q: new URLSearchParams(window.location.search).get('q') ?? '',
    status: 'all',
    page: 1,
    pageSize: PAGE_SIZES[0],
  };

  render(app, `
  <div class="page acs-page acs-cases">
    ${pageHead({
    title: tr('Cases', 'Vụ án'),
    sub: tr('Check, publish and manage the cases players can pick.', 'Kiểm tra, xuất bản và quản lý các vụ án người chơi được chọn.'),
    actionsHtml: `
        <a class="btn" href="/admin/import">${icon('download', 18)}${tr('Import JSON', 'Nhập JSON')}</a>
        <a class="btn btn-primary acs-ai-btn" href="/admin/ai">${icon('sparkle', 18)}${tr('AI creator', 'Tạo bằng AI')}</a>`,
  })}
    <section class="adm-card acs-filter-card" aria-label="${tr('Filters', 'Bộ lọc')}">
      <div class="acs-filter-row">
        <label class="adm-search-box acs-search">
          ${icon('search', 18)}
          <span class="bpa-sr">${tr('Search cases', 'Tìm vụ án')}</span>
          <input type="search" data-acs-search placeholder="${tr('Search by title or case id', 'Tìm theo tên hoặc mã vụ án')}" value="${escapeHtml(state.q)}" autocomplete="off">
        </label>
        <div class="adm-filters" role="group" aria-label="${tr('Filter by status', 'Lọc theo trạng thái')}" data-acs-filters></div>
      </div>
      <label class="acs-legacy legacy-toggle">
        <input type="checkbox" id="show-legacy"${showLegacy ? ' checked' : ''}>
        <span>${tr('Show older cases', 'Hiện cả vụ án cũ')}</span>
        <small>· ${tr('hidden from players and from this list', 'đang ẩn khỏi người chơi và khỏi danh sách này')}</small>
      </label>
    </section>
    <section class="acs-case-list" aria-label="${tr('Case list', 'Danh sách vụ án')}" data-acs-list>
      ${stateBox('loading', tr('Loading cases…', 'Đang tải vụ án…'))}
    </section>
  </div>`);

  const list = app.querySelector('[data-acs-list]');
  const filtersHost = app.querySelector('[data-acs-filters]');

  function paintFilters() {
    const all = state.cases ?? [];
    filtersHost.innerHTML = FILTERS
      .map((filter) => ({ ...filter, count: filter.key === 'all' ? all.length : all.filter((c) => c.status === filter.key).length }))
      .filter((filter) => !filter.onlyWhenPresent || filter.count > 0 || state.status === filter.key)
      .map((filter) => `<button type="button" class="adm-filter" data-acs-status="${filter.key}" aria-pressed="${state.status === filter.key}">${escapeHtml(filter.label())}<small>${filter.count}</small></button>`)
      .join('');
  }

  function paintList() {
    const all = state.cases ?? [];
    if (all.length === 0) {
      list.innerHTML = stateBox('empty', tr('No cases yet — seed the sample from the dashboard or import JSON.', 'Chưa có vụ án — hãy tạo vụ án mẫu từ bảng điều khiển hoặc nhập JSON.'));
      return;
    }
    const shown = all.filter((c) => (state.status === 'all' || c.status === state.status) && matchesSearch(c, state.q.trim()));
    if (shown.length === 0) {
      list.innerHTML = stateBox('empty', tr('No case matches the filters.', 'Không có vụ án nào khớp bộ lọc.'), tr('Try other words, or pick “All” again.', 'Thử từ khoá khác, hoặc chọn lại “Tất cả”.'));
      return;
    }
    const pages = Math.max(1, Math.ceil(shown.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * state.pageSize;
    list.innerHTML = `
      ${shown.slice(start, start + state.pageSize).map((c) => caseCard(c, state.capabilities)).join('')}
      <nav class="adm-card acs-pager-card" aria-label="${tr('Pages', 'Phân trang')}">
        ${pager({
    page: state.page,
    pageSize: state.pageSize,
    total: shown.length,
    noun: tr('cases', 'vụ án'),
    perPageHtml: `
            <label class="acs-per-page">${tr('Per page', 'Mỗi trang')}
              <select data-acs-page-size>
                ${PAGE_SIZES.map((size) => `<option value="${size}"${size === state.pageSize ? ' selected' : ''}>${size}</option>`).join('')}
              </select>
            </label>`,
  })}
      </nav>`;
    watchCovers(list);
  }

  // A later load always wins, so flipping the switch quickly never shows an older answer.
  let loadSeq = 0;
  async function load() {
    const seq = ++loadSeq;
    let cases;
    let capabilities = null;
    try {
      cases = await adminApi.cases(showLegacy);
      capabilities = await aiCaseApi.capabilities().catch(() => null);
    } catch (err) {
      if (seq !== loadSeq) return;
      state.cases = null;
      paintFilters();
      list.innerHTML = stateBox('error', tr('The cases could not load', 'Không tải được danh sách vụ án'), err.message);
      return;
    }
    if (seq !== loadSeq) return;
    state.cases = cases ?? [];
    state.capabilities = capabilities;
    paintFilters();
    paintList();
  }

  app.querySelector('#show-legacy').addEventListener('change', (event) => {
    showLegacy = event.target.checked;
    void load();
  });

  app.querySelector('[data-acs-search]').addEventListener('input', (event) => {
    state.q = event.target.value;
    state.page = 1;
    setQueryParam(event.target.value.trim());
    if (state.cases) paintList();
  });

  filtersHost.addEventListener('click', (event) => {
    const button = event.target.closest('[data-acs-status]');
    if (!button) return;
    state.status = button.dataset.acsStatus;
    state.page = 1;
    filtersHost.querySelectorAll('[data-acs-status]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    paintList();
  });

  list.addEventListener('change', (event) => {
    if (!event.target.matches('[data-acs-page-size]')) return;
    state.pageSize = Number(event.target.value) || PAGE_SIZES[0];
    state.page = 1;
    paintList();
  });

  list.addEventListener('click', async (event) => {
    const pageButton = event.target.closest('[data-adm-page]');
    if (pageButton && !pageButton.disabled) {
      state.page = Number(pageButton.dataset.admPage);
      paintList();
      // The buttons are under the list: bring the first case of the new page back into view.
      const top = list.getBoundingClientRect().top;
      if (top < 0) window.scrollBy(0, top - 96);
      return;
    }
    const btn = event.target.closest('[data-publish], [data-unpublish]');
    if (!btn || btn.disabled) return;
    const publishing = btn.hasAttribute('data-publish');
    const label = publishing ? tr('published', 'đã xuất bản') : tr('unpublished', 'đã gỡ xuất bản');
    btn.disabled = true;
    try {
      await (publishing ? adminApi.publishCase : adminApi.unpublishCase)(btn.dataset.publish || btn.dataset.unpublish);
      toast(`Case ${label}.`, 'success');
      void load();
    } catch (err) {
      toast(err.errors?.code ? `${err.errors.code}: ${err.message}` : err.message, 'error');
      btn.disabled = false;
    }
  });

  await load();
}
